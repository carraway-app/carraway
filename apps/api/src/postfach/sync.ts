import { and, eq, inArray, sql } from "drizzle-orm";
import { aktivitaet, aktivitaetSync, benutzer, deal, postfachVerbindung, syncAusschluss, type Db } from "@carraway/db";
import type { Logger } from "../beobachtung/protokoll";
import { GeheimnisFehler, type Schluesselring } from "../geheimnis/krypto";
import { schreibe } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";
import { adressHash, berlinerTag, externHash, externHashNeu, ladeBekannte, mailSchluessel, ordneZu, terminSchluessel, type Zuordnung } from "./abgleich";
import { kandidatenAusMails, kandidatenAusTerminen, kontakteAusAbgleich } from "./kontakte";
import { erneuere } from "./oauth";
import type { Abrufer } from "./http";
import type { PostfachKonfiguration } from "./konfiguration";
import { PostfachFehler, type MailKopf, type NachNeuenMails, type PostfachAnbieter, type Termin, type Zugang } from "./typen";
import { leseZugang, verschluesseleZugang } from "./zugang";

/**
 * Abgleich der Postfächer und Kalender (läuft im Worker). Ablauf je Verbindung:
 * 1. Die Verbindung wird übernommen (`gesperrt_bis`), damit nie zwei Worker dieselbe Verbindung abgleichen; das schützt auch das Erneuern
 *    des Refresh-Tokens (rotierende Tokens) vor Doppelaufrufen.
 * 2. Zugang entschlüsseln, Zugriffstoken bei Bedarf erneuern und sofort verschlüsselt speichern.
 * 3. Kopfdaten holen, gegen die Positivliste der bekannten Kontakte prüfen und alles andere verwerfen. Erst für passende Nachrichten (und nur wenn die
 *    Person es erlaubt hat) wird der Textauszug nachgeladen. Sind Kontakte aus Postfach und Kalender eingeschaltet und nimmt die Person teil, entstehen vorher
 *    aus echten Gegenübern Vorschläge oder Kontakte (`kontakte.ts`); mit `aus` bleibt dieser Schritt ohne Wirkung.
 * 4. In einer Transaktion schreiben: Dublettenprüfung über den Hash der Nachrichten- oder Termin-ID, Ausschlüsse der Person beachten.
 *
 * Verwaiste Aktivitäten: Wird die Verbindung einer Person getrennt, bleiben ihre synchronisierten Aktivitäten bestehen (Teil der Historie am Kontakt), haben aber
 * keine Besitzerin mehr, die sie abgleicht. Eine andere Person mit bestehender Verbindung im selben Bereich (Mail oder Kalender) übernimmt sie nur unter strengen
 * Bedingungen: Das gesehene Element passt zu den gespeicherten Angaben (Mail: Absender, Zeit, Betreff, zugeordnete Personen; Termin: Beginn, Ende, zugeordnete Personen),
 * und die eigene Adresse der Person gehört zu den gespeicherten Beteiligten (Prüfwerte, keine Adressen). Die Nachrichten- oder Termin-ID allein genügt nie: Sie bestimmt der
 * Absender oder Organisator selbst. Bei der Übernahme bleibt `anbieter_id` leer (Anhänge lassen sich nicht nachladen, nie wird die Nachricht eines anderen Postfachs gebunden),
 * und im selben Lauf wird nichts geändert oder gelöscht. Spätere Läufe der neuen Besitzerin dürfen den Termin aktualisieren; eine Absage löscht übernommene Termine nie, sie wird
 * nur vermerkt (`absage_gemeldet_am`). Solange die Besitzerin im Bereich verbunden ist, überschreibt nie eine andere Person etwas; hat die übernehmende Person das Element selbst
 * entfernt (Ausschluss), wird es nicht übernommen. Die Dublettenprüfung läuft über Hashes, die für neue Zeilen nach Anbieter (und beim Kalender nach Organisator) getrennt sind.
 */

export interface SyncOptionen {
  ring: Schluesselring;
  konfig: PostfachKonfiguration;
  abrufer: Abrufer;
  /** Liefert den Adapter für einen Anbieter; er wird je Verbindung und Durchlauf erzeugt und danach geschlossen. */
  anbieter: (anbieter: "microsoft" | "google" | "imap" | "demo", zugang: Zugang) => Promise<PostfachAnbieter>;
  jetzt?: () => Date;
  logger?: Logger;
  /** Höchstzahl Verbindungen je Durchlauf (Standard 10). */
  max?: number;
  /** Erweiterungspunkt: wird nach dem Speichern neuer eingehender Mails bekannter Personen aufgerufen (`ApiErweiterung.postfachMails`). Fehler halten den Abgleich nicht auf. */
  nachNeuenMails?: NachNeuenMails | undefined;
}

export interface SyncErgebnis {
  verbindungen: number;
  mails: number;
  termine: number;
  fehler: number;
}

const SPERRE_MS = 10 * 60_000;
const MAIL_NOTIZ_ZEICHEN = 500;
const TERMIN_ZURUECK_TAGE = 30;
const TERMIN_VOR_TAGE = 90;
/** Wartezeit nach einem vorübergehenden Fehler (Minuten). */
const FEHLER_WARTEZEIT_MINUTEN = 60;

type Zeile = typeof postfachVerbindung.$inferSelect;

/**
 * Was ins Änderungsprotokoll kommt: nie Betreff, Titel oder Textauszug. Das Protokoll ist nur anhängend; würde der Inhalt dort stehen, bliebe er nach dem
 * Löschen durch die Person erhalten.
 */
export const protokollSicht = (a: { id: string; art: string; datum: string; organisationId: string | null; personId: string | null; dealId: string | null }) => ({
  id: a.id,
  art: a.art,
  datum: a.datum,
  organisationId: a.organisationId,
  personId: a.personId,
  dealId: a.dealId,
});

/** Sucht in der Ursachenkette (Drizzle verpackt den Treiberfehler) nach einem Postgres-Fehlercode. */
function hatFehlercode(fehler: unknown, code: string): boolean {
  for (let e: unknown = fehler, tiefe = 0; e && tiefe < 5; tiefe++, e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === code) return true;
  }
  return false;
}

export async function gleicheAb(db: Db, opt: SyncOptionen): Promise<SyncErgebnis> {
  const jetzt = (opt.jetzt ?? (() => new Date()))();
  const ergebnis: SyncErgebnis = { verbindungen: 0, mails: 0, termine: 0, fehler: 0 };
  const ids = await schreibe(db, "system", async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(sql`
      UPDATE postfach_verbindung SET gesperrt_bis = ${new Date(jetzt.getTime() + SPERRE_MS).toISOString()}
      WHERE id IN (
        SELECT id FROM postfach_verbindung
        WHERE naechster_abgleich_am <= ${new Date(jetzt.getTime() + 1000).toISOString()} AND status <> 'erneut_anmelden'
          AND EXISTS (SELECT 1 FROM benutzer b WHERE b.id = postfach_verbindung.benutzer_id AND b.aktiv)
          AND (gesperrt_bis IS NULL OR gesperrt_bis < ${jetzt.toISOString()})
        ORDER BY naechster_abgleich_am LIMIT ${opt.max ?? 10} FOR UPDATE SKIP LOCKED)
      RETURNING id`);
    return rows.map((r) => r.id);
  });
  for (const id of ids) {
    const r = await gleicheVerbindungAb(db, id, opt);
    ergebnis.verbindungen++;
    ergebnis.mails += r.mails;
    ergebnis.termine += r.termine;
    if (r.fehler) ergebnis.fehler++;
  }
  return ergebnis;
}

/** Gleicht eine (bereits übernommene oder direkt aufgerufene) Verbindung ab; Fehler landen als Code in der Verbindung, nie als Ausnahme beim Aufrufer. */
export async function gleicheVerbindungAb(db: Db, id: string, opt: SyncOptionen): Promise<{ mails: number; termine: number; fehler: string | null }> {
  const jetzt = opt.jetzt ?? (() => new Date());
  const [zeile] = await lese(db, (tx) => tx.select().from(postfachVerbindung).where(eq(postfachVerbindung.id, id)));
  if (!zeile) return { mails: 0, termine: 0, fehler: null };
  // Gesperrte Personen werden nicht mehr abgeglichen (Sicherheit), auch nicht bei direktem Aufruf.
  const [inhaber] = await lese(db, (tx) => tx.select({ aktiv: benutzer.aktiv }).from(benutzer).where(eq(benutzer.id, zeile.benutzerId)));
  if (!inhaber?.aktiv) {
    await schreibe(db, "system", async (tx) => {
      await tx.update(postfachVerbindung).set({ gesperrtBis: null }).where(eq(postfachVerbindung.id, id));
    });
    return { mails: 0, termine: 0, fehler: null };
  }
  let adapter: PostfachAnbieter | null = null;
  let nachholen = false;
  try {
    let zugang: Zugang;
    try {
      zugang = leseZugang(opt.ring, id, zeile.zugangVerschluesselt);
    } catch (e) {
      throw e instanceof GeheimnisFehler ? new PostfachFehler("GEHEIMNIS_FEHLER") : e;
    }
    zugang = await sichereZugang(db, opt, zeile, zugang, jetzt());
    adapter = await opt.anbieter(zeile.anbieter, zugang);
    let mails = 0;
    let termine = 0;
    let neuerStand = zeile.abgleichStand;
    if (zeile.bereich === "mail") {
      // Nach neuen Kontakten aus Postfach und Kalender schaut der Abgleich einmal wieder den ersten Zeitraum zurück (Merker atomar verbrauchen).
      nachholen = zeile.nachholen && (await schreibe(db, "system", (tx) => tx.update(postfachVerbindung).set({ nachholen: false }).where(and(eq(postfachVerbindung.id, id), eq(postfachVerbindung.nachholen, true))).returning({ id: postfachVerbindung.id }))).length > 0;
      const abruf = await adapter.holeMailKoepfe(zugang, nachholen ? null : zeile.abgleichStand);
      neuerStand = abruf.stand;
      mails = await verarbeiteMails(db, opt, zeile, zugang, adapter, abruf.koepfe);
    } else {
      const jetztWert = jetzt();
      const liste = await adapter.holeTermine(zugang, new Date(jetztWert.getTime() - TERMIN_ZURUECK_TAGE * 86_400_000), new Date(jetztWert.getTime() + TERMIN_VOR_TAGE * 86_400_000));
      termine = await verarbeiteTermine(db, zeile, zugang, liste, opt.logger);
    }
    await schreibe(db, "system", async (tx) => {
      await tx
        .update(postfachVerbindung)
        .set({
          status: "verbunden",
          letzterFehler: null,
          letzterAbgleichAm: jetzt(),
          abgleichStand: neuerStand,
          naechsterAbgleichAm: new Date(jetzt().getTime() + opt.konfig.intervallMinuten * 60_000),
          gesperrtBis: null,
        })
        .where(eq(postfachVerbindung.id, id));
    });
    return { mails, termine, fehler: null };
  } catch (e) {
    const fehler = e instanceof PostfachFehler ? e : new PostfachFehler("ABGLEICH_FEHLER");
    // Nur Code und Klasse in den Log, nie Anbieter-Antworten, Adressen oder Betreffzeilen.
    opt.logger?.("warn", "Abgleich fehlgeschlagen", { verbindungId: id, code: fehler.code, anbieter: zeile.anbieter, bereich: zeile.bereich, ...(e instanceof PostfachFehler ? {} : { fehlerArt: e instanceof Error ? e.name : typeof e }) });
    await schreibe(db, "system", async (tx) => {
      await tx
        .update(postfachVerbindung)
        .set({
          status: fehler.erneutAnmelden ? "erneut_anmelden" : "fehler",
          letzterFehler: fehler.code,
          naechsterAbgleichAm: new Date(jetzt().getTime() + FEHLER_WARTEZEIT_MINUTEN * 60_000),
          gesperrtBis: null,
          ...(nachholen ? { nachholen: true } : {}),
        })
        .where(eq(postfachVerbindung.id, id));
    });
    return { mails: 0, termine: 0, fehler: fehler.code };
  } finally {
    await adapter?.schliesse?.().catch(() => undefined);
  }
}

/** Erneuert das Zugriffstoken, wenn es in der nächsten Minute abläuft, und speichert den neuen Zugang sofort (Refresh-Tokens können rotieren). */
async function sichereZugang(db: Db, opt: SyncOptionen, zeile: Zeile, zugang: Zugang, jetzt: Date): Promise<Zugang> {
  if (zugang.art !== "oauth" || zugang.ablaufMs - 60_000 > jetzt.getTime()) return zugang;
  const k = zeile.anbieter === "microsoft" ? opt.konfig.microsoft : zeile.anbieter === "google" ? opt.konfig.google : undefined;
  if (!k) throw new PostfachFehler("ANBIETER_NICHT_EINGERICHTET");
  const t = await erneuere(opt.abrufer, k, zugang.refreshToken, jetzt.getTime());
  const neu: Zugang = { ...zugang, accessToken: t.accessToken, refreshToken: t.refreshToken ?? zugang.refreshToken, ablaufMs: t.ablaufMs };
  await schreibe(db, "system", async (tx) => {
    await tx.update(postfachVerbindung).set({ zugangVerschluesselt: verschluesseleZugang(opt.ring, zeile.id, neu) }).where(eq(postfachVerbindung.id, zeile.id));
  });
  return neu;
}

interface Treffer {
  kopf: MailKopf;
  zuordnung: Zuordnung;
  hash: string;
  /** Früherer Hash (ohne Anbieter) für schon gespeicherte Zeilen. */
  altHash: string;
  text: string | null;
}

async function verarbeiteMails(db: Db, opt: SyncOptionen, zeile: Zeile, zugang: Zugang, adapter: PostfachAnbieter, koepfe: MailKopf[]): Promise<number> {
  if (koepfe.length === 0) return 0;
  const bekannte = await kontakteAusAbgleich(db, zeile.id, zeile.benutzerId, "mail", await lese(db, (tx) => ladeBekannte(tx)), (regeln, b) => kandidatenAusMails(koepfe, zugang.adresse, b, regeln), opt.logger);
  const treffer: Treffer[] = [];
  for (const kopf of koepfe) {
    const zuordnung = ordneZu([kopf.von, ...kopf.an, ...kopf.cc], zugang.adresse, bekannte);
    if (!zuordnung) continue; // unbekannte Kontakte: nichts speichern
    treffer.push({ kopf, zuordnung, hash: externHashNeu("mail", zeile.anbieter, mailSchluessel(kopf, zeile.anbieter)), altHash: externHash("mail", mailSchluessel(kopf, zeile.anbieter)), text: null });
  }
  if (treffer.length === 0) return 0;
  // Zuerst die Dublettenprüfung, damit für schon bekannte oder ausgeschlossene Nachrichten kein Text geholt wird.
  const { neu, waisen } = await lese(db, async (tx) => {
    const hashes = treffer.flatMap((t) => [t.hash, t.altHash]);
    const vorhanden = new Set((await tx.select({ h: aktivitaetSync.externHash }).from(aktivitaetSync).where(inArray(aktivitaetSync.externHash, hashes))).map((r) => r.h));
    const ausgeschlossen = new Set((await tx.select({ h: syncAusschluss.externHash }).from(syncAusschluss).where(and(eq(syncAusschluss.benutzerId, zeile.benutzerId), inArray(syncAusschluss.externHash, hashes)))).map((r) => r.h));
    const bekannt = (t: Treffer) => vorhanden.has(t.hash) || vorhanden.has(t.altHash);
    const entfernt = (t: Treffer) => ausgeschlossen.has(t.hash) || ausgeschlossen.has(t.altHash);
    const kandidaten = treffer.filter((t) => bekannt(t) && !entfernt(t));
    const verwaist = await verwaisteBesitzer(tx, kandidaten.flatMap((t) => [t.hash, t.altHash]), "mail", zeile.benutzerId);
    const waisen = kandidaten.flatMap((t) => {
      const w = verwaist.get(t.hash) ?? verwaist.get(t.altHash);
      return w && passtMail(w, t.kopf, t.zuordnung, zugang.adresse) ? [{ t, ...w }] : [];
    });
    return { neu: treffer.filter((t) => !bekannt(t) && !entfernt(t)), waisen };
  });
  if (zeile.inhaltSpeichern) {
    for (const t of neu) {
      try {
        t.text = (await adapter.holeMailText(zugang, t.kopf, MAIL_NOTIZ_ZEICHEN)).replace(/\s+/g, " ").trim().slice(0, MAIL_NOTIZ_ZEICHEN) || null;
      } catch {
        t.text = null; // Betreff genügt; ein Fehler beim Text hält den Abgleich nicht auf
      }
    }
  }
  const angelegt: Treffer[] = [];
  const anzahl = await schreibe(db, zeile.benutzerId, async (tx, protokoll) => {
    angelegt.length = 0; // bei einer Wiederholung der Transaktion
    if (!(await verbindungBesteht(tx, zeile.id))) return 0;
    // Mails, deren Besitzerin ihre Mailverbindung getrennt hat und die zu den gespeicherten Angaben passen, gehören jetzt dieser Person (ohne Anbieter-ID: keine Anhänge).
    for (const w of waisen) await uebernimmVerwaiste(tx, protokoll, { aktivitaetId: w.aktivitaetId, bisherigerBesitzer: w.benutzerId, bereich: "mail", benutzerId: zeile.benutzerId, anbieter: zeile.anbieter });
    const deals = await offeneDeals(tx, neu.map((t) => t.zuordnung.organisationId));
    let n = 0;
    for (const t of neu) {
      const org = t.zuordnung.organisationId;
      const dealId = org && deals.get(org)?.length === 1 ? deals.get(org)![0]! : null;
      const eingefuegt = await fuegeEin(tx, {
        art: "mail",
        titel: t.kopf.betreff.slice(0, 300) || "(ohne Betreff)",
        notiz: t.text,
        datum: berlinerTag(t.kopf.datum),
        zuordnung: t.zuordnung,
        dealId,
        benutzerId: zeile.benutzerId,
        anbieter: zeile.anbieter,
        hash: t.hash,
        absender: t.kopf.von,
        adressen: [t.kopf.von, ...t.kopf.an, ...t.kopf.cc],
        anbieterId: t.kopf.id,
        beginn: t.kopf.datum,
        ende: null,
        richtung: t.kopf.von.toLowerCase() === zugang.adresse.toLowerCase() ? "ausgehend" : "eingehend",
      });
      if (eingefuegt) {
        await protokoll("anlegen", "aktivitaet", eingefuegt.id, null, protokollSicht(eingefuegt));
        angelegt.push(t);
        n++;
      }
    }
    return n;
  });
  await rufeNachNeuenMailsAuf(opt, zeile, zugang, adapter, angelegt, bekannte);
  return anzahl;
}

/** Erweiterungspunkt für neue eingehende Mails bekannter Personen; ein Fehler dort hält den Abgleich nicht auf und nennt im Log nie Adressen. */
async function rufeNachNeuenMailsAuf(opt: SyncOptionen, zeile: Zeile, zugang: Zugang, adapter: PostfachAnbieter, angelegt: readonly Treffer[], bekannte: Awaited<ReturnType<typeof ladeBekannte>>): Promise<void> {
  if (!opt.nachNeuenMails || angelegt.length === 0) return;
  const eigene = zugang.adresse.trim().toLowerCase();
  const mails = angelegt.flatMap((t) => {
    const absender = t.kopf.von.trim().toLowerCase();
    const p = bekannte.personen.get(absender);
    if (!p || absender === eigene || t.kopf.gesendet === true || t.kopf.massenmail) return [];
    return [{ personId: p.id, absender, datum: t.kopf.datum, holeText: (max: number) => adapter.holeMailText(zugang, t.kopf, max) }];
  });
  if (mails.length === 0) return;
  try {
    await opt.nachNeuenMails({ verbindungId: zeile.id, benutzerId: zeile.benutzerId, anbieter: zeile.anbieter, mails });
  } catch (e) {
    opt.logger?.("warn", "Auswertung neuer Mails fehlgeschlagen", { verbindungId: zeile.id, fehlerArt: e instanceof Error ? e.name : typeof e });
  }
}

async function verarbeiteTermine(db: Db, zeile: Zeile, zugang: Zugang, termine: Termin[], logger?: SyncOptionen["logger"]): Promise<number> {
  if (termine.length === 0) return 0;
  const bekannte = await kontakteAusAbgleich(db, zeile.id, zeile.benutzerId, "kalender", await lese(db, (tx) => ladeBekannte(tx)), (regeln, b) => kandidatenAusTerminen(termine, zugang.adresse, b, regeln), logger);
  return schreibe(db, zeile.benutzerId, async (tx, protokoll) => {
    if (!(await verbindungBesteht(tx, zeile.id))) return 0;
    const zugeordnet = termine.flatMap((t) => {
      const zuordnung = ordneZu(t.teilnehmer, zugang.adresse, bekannte);
      return zuordnung ? [{ t, zuordnung, hash: externHashNeu("kalender", zeile.anbieter, terminSchluessel(t), t.organisator), altHash: externHash("kalender", terminSchluessel(t)) }] : [];
    });
    if (zugeordnet.length === 0) return 0;
    const hashes = zugeordnet.flatMap((z) => [z.hash, z.altHash]);
    const vorhanden = new Map((await tx.select({ h: aktivitaetSync.externHash, id: aktivitaetSync.aktivitaetId }).from(aktivitaetSync).where(inArray(aktivitaetSync.externHash, hashes))).map((r) => [r.h, r.id]));
    const ausgeschlossen = new Set((await tx.select({ h: syncAusschluss.externHash }).from(syncAusschluss).where(and(eq(syncAusschluss.benutzerId, zeile.benutzerId), inArray(syncAusschluss.externHash, hashes)))).map((r) => r.h));
    const verwaist = await verwaisteBesitzer(tx, hashes, "kalender", zeile.benutzerId);
    const deals = await offeneDeals(tx, zugeordnet.map((z) => z.zuordnung.organisationId));
    let n = 0;
    for (const { t, zuordnung, hash, altHash } of zugeordnet) {
      const bestehende = vorhanden.get(hash) ?? vorhanden.get(altHash);
      if (bestehende) {
        const [alt] = await tx.select().from(aktivitaet).where(eq(aktivitaet.id, bestehende));
        const [altSync] = await tx.select().from(aktivitaetSync).where(eq(aktivitaetSync.aktivitaetId, bestehende));
        if (!alt || !altSync) continue;
        // Nur die Verbindung, die die Aktivität angelegt hat, darf sie ändern oder löschen: Dieselbe Termin-ID kann bei mehreren Personen
        // vorkommen (Einladung), aber Titel, Zeit und Absage einer anderen Person gelten nicht für die Aktivität der ersten.
        if (altSync.benutzerId !== zeile.benutzerId) {
          // Verwaiste Aktivität (die Besitzerin hat keine Kalenderverbindung mehr): nur bei passenden Angaben und wenn die eigene Adresse unter den Teilnehmern stand
          // übernehmen. Im selben Lauf wird nichts mehr geändert oder gelöscht; sonst bleibt alles wie bisher.
          const w = verwaist.get(hash) ?? verwaist.get(altHash);
          if (!w || ausgeschlossen.has(hash) || ausgeschlossen.has(altHash) || !passtTermin(w, t, zuordnung, zugang.adresse)) continue;
          await uebernimmVerwaiste(tx, protokoll, { aktivitaetId: bestehende, bisherigerBesitzer: altSync.benutzerId, bereich: "kalender", benutzerId: zeile.benutzerId, anbieter: zeile.anbieter });
          continue;
        }
        if (t.abgesagt) {
          // Übernommene Termine löscht eine Absage nie; sie wird nur vermerkt.
          if (altSync.uebernommenAm) {
            if (!altSync.absageGemeldetAm) {
              await tx.update(aktivitaetSync).set({ absageGemeldetAm: new Date() }).where(eq(aktivitaetSync.aktivitaetId, bestehende));
              await protokoll("absage_melden", "aktivitaet", bestehende, null, { aktivitaetId: bestehende });
            }
            continue;
          }
          await protokoll("loeschen", "aktivitaet", bestehende, protokollSicht(alt), null);
          await tx.delete(aktivitaet).where(eq(aktivitaet.id, bestehende));
          continue;
        }
        const titel = t.titel.slice(0, 300) || "(ohne Titel)";
        const datum = berlinerTag(t.beginn);
        const geaendert = alt.titel !== titel || alt.datum !== datum || altSync.beginn.getTime() !== t.beginn.getTime() || (altSync.ende?.getTime() ?? null) !== (t.ende?.getTime() ?? null) || altSync.personIds.join() !== zuordnung.personIds.join();
        if (!geaendert) continue;
        const [neu] = await tx.update(aktivitaet).set({ titel, datum }).where(eq(aktivitaet.id, bestehende)).returning();
        await tx.update(aktivitaetSync).set({ beginn: t.beginn, ende: t.ende, personIds: zuordnung.personIds }).where(eq(aktivitaetSync.aktivitaetId, bestehende));
        await protokoll("aendern", "aktivitaet", bestehende, protokollSicht(alt), protokollSicht(neu!));
        n++;
        continue;
      }
      if (t.abgesagt || ausgeschlossen.has(hash) || ausgeschlossen.has(altHash)) continue;
      const org = zuordnung.organisationId;
      const eingefuegt = await fuegeEin(tx, {
        art: "termin",
        titel: t.titel.slice(0, 300) || "(ohne Titel)",
        notiz: null,
        datum: berlinerTag(t.beginn),
        zuordnung,
        dealId: org && deals.get(org)?.length === 1 ? deals.get(org)![0]! : null,
        benutzerId: zeile.benutzerId,
        anbieter: zeile.anbieter,
        hash,
        absender: null,
        adressen: [...t.teilnehmer, ...(t.organisator ? [t.organisator] : [])],
        anbieterId: null,
        beginn: t.beginn,
        ende: t.ende,
        richtung: null,
      });
      if (eingefuegt) {
        await protokoll("anlegen", "aktivitaet", eingefuegt.id, null, protokollSicht(eingefuegt));
        n++;
      }
    }
    return n;
  });
}

/**
 * Übernimmt eine verwaiste synchronisierte Aktivität: Die bisherige Besitzerin hat im Bereich keine Verbindung mehr. Die Prüfung steht in derselben Anweisung wie die
 * Änderung (kein Überschreiben, wenn die Besitzerin inzwischen wieder verbunden ist). `anbieter_id` wird geleert. Wahr, wenn die Aktivität jetzt der Person gehört.
 */
async function uebernimmVerwaiste(
  tx: Tx,
  protokoll: Parameters<Parameters<typeof schreibe>[2]>[1],
  e: { aktivitaetId: string; bisherigerBesitzer: string; bereich: "mail" | "kalender"; benutzerId: string; anbieter: Zeile["anbieter"] },
): Promise<boolean> {
  const { rows } = await tx.execute<{ aktivitaet_id: string }>(sql`
    UPDATE aktivitaet_sync SET benutzer_id = ${e.benutzerId}, anbieter = ${e.anbieter}, anbieter_id = NULL, uebernommen_am = now(), absage_gemeldet_am = NULL
    WHERE aktivitaet_id = ${e.aktivitaetId} AND benutzer_id = ${e.bisherigerBesitzer}
      AND NOT EXISTS (SELECT 1 FROM postfach_verbindung v WHERE v.benutzer_id = ${e.bisherigerBesitzer} AND v.bereich = ${e.bereich}::postfach_bereich)
    RETURNING aktivitaet_id`);
  if (rows.length === 0) return false;
  await protokoll("uebernehmen", "aktivitaet", e.aktivitaetId, { besitzer: e.bisherigerBesitzer }, { besitzer: e.benutzerId });
  return true;
}

interface Verwaist {
  aktivitaetId: string;
  benutzerId: string;
  titel: string;
  beginn: Date;
  ende: Date | null;
  personIds: string[];
  absenderHash: string | null;
  teilnehmerHashes: string[];
}

/** Schon bekannte Elemente fremder Besitzerinnen, die im Bereich keine Verbindung mehr haben, nach gespeichertem Hash. */
async function verwaisteBesitzer(tx: Tx, hashes: string[], bereich: "mail" | "kalender", ichId: string): Promise<Map<string, Verwaist>> {
  if (hashes.length === 0) return new Map();
  const zeilen = await tx
    .select({ h: aktivitaetSync.externHash, s: aktivitaetSync, titel: aktivitaet.titel })
    .from(aktivitaetSync)
    .innerJoin(aktivitaet, eq(aktivitaet.id, aktivitaetSync.aktivitaetId))
    .where(
      and(
        inArray(aktivitaetSync.externHash, hashes),
        sql`${aktivitaetSync.benutzerId} <> ${ichId}`,
        sql`NOT EXISTS (SELECT 1 FROM postfach_verbindung v WHERE v.benutzer_id = ${aktivitaetSync.benutzerId} AND v.bereich = ${bereich}::postfach_bereich)`,
      ),
    );
  return new Map(
    zeilen.map((z) => [z.h, { aktivitaetId: z.s.aktivitaetId, benutzerId: z.s.benutzerId, titel: z.titel, beginn: z.s.beginn, ende: z.s.ende, personIds: z.s.personIds, absenderHash: z.s.absenderHash, teilnehmerHashes: z.s.teilnehmerHashes }]),
  );
}

const gleicheIds = (a: readonly string[], b: readonly string[]) => [...a].sort().join() === [...b].sort().join();
const gleicheZeit = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/** Passt die gesehene Mail zu den gespeicherten Angaben, und stand die eigene Adresse unter den Beteiligten? */
function passtMail(w: Verwaist, kopf: MailKopf, zuordnung: Zuordnung, eigeneAdresse: string): boolean {
  return (
    gleicheZeit(w.beginn, kopf.datum) &&
    w.titel === (kopf.betreff.slice(0, 300) || "(ohne Betreff)") &&
    gleicheIds(w.personIds, zuordnung.personIds) &&
    w.absenderHash !== null &&
    w.absenderHash === adressHash(w.aktivitaetId, kopf.von) &&
    w.teilnehmerHashes.includes(adressHash(w.aktivitaetId, eigeneAdresse))
  );
}

/** Passt der gesehene Termin zu den gespeicherten Angaben, und war die eigene Adresse unter den Teilnehmern? */
function passtTermin(w: Verwaist, t: Termin, zuordnung: Zuordnung, eigeneAdresse: string): boolean {
  return gleicheZeit(w.beginn, t.beginn) && gleicheZeit(w.ende, t.ende) && gleicheIds(w.personIds, zuordnung.personIds) && w.teilnehmerHashes.includes(adressHash(w.aktivitaetId, eigeneAdresse));
}

/** Besteht die Verbindung noch? Wurde sie während des Abgleichs getrennt, wird nichts mehr geschrieben. */
async function verbindungBesteht(tx: Tx, id: string): Promise<boolean> {
  const { rows } = await tx.execute(sql`SELECT 1 FROM postfach_verbindung WHERE id = ${id} FOR SHARE`);
  return rows.length > 0;
}

/** Offene Deals je Organisation: Hängt genau einer an der Organisation, wird die Aktivität auch ihm zugeordnet. */
async function offeneDeals(tx: Tx, organisationIds: (string | null)[]): Promise<Map<string, string[]>> {
  const ids = [...new Set(organisationIds.filter((x): x is string => x !== null))];
  const karte = new Map<string, string[]>();
  if (ids.length === 0) return karte;
  const zeilen = await tx.select({ id: deal.id, org: deal.organisationId }).from(deal).where(and(inArray(deal.organisationId, ids), eq(deal.status, "offen")));
  for (const z of zeilen) karte.set(z.org, [...(karte.get(z.org) ?? []), z.id]);
  return karte;
}

interface Einfuegen {
  art: "mail" | "termin";
  titel: string;
  notiz: string | null;
  datum: string;
  zuordnung: Zuordnung;
  dealId: string | null;
  benutzerId: string;
  anbieter: Zeile["anbieter"];
  hash: string;
  /** Absender einer Mail und alle Beteiligten: gehen nur als Prüfwert in die Herkunft (siehe `adressHash`). */
  absender: string | null;
  adressen: string[];
  anbieterId: string | null;
  beginn: Date;
  ende: Date | null;
  richtung: "eingehend" | "ausgehend" | null;
}

/** Legt Aktivität und Herkunft an; bei gleichzeitigem Abgleich derselben Nachricht durch eine andere Person gewinnt die erste (Savepoint, Duplikat wird übersprungen). */
async function fuegeEin(tx: Tx, e: Einfuegen) {
  try {
    return await tx.transaction(async (sp) => {
      const [a] = await sp
        .insert(aktivitaet)
        .values({ art: e.art, datum: e.datum, titel: e.titel, notiz: e.notiz, organisationId: e.zuordnung.organisationId, personId: e.zuordnung.personId, dealId: e.dealId })
        .returning();
      await sp.insert(aktivitaetSync).values({ aktivitaetId: a!.id, benutzerId: e.benutzerId, anbieter: e.anbieter, externHash: e.hash, anbieterId: e.anbieterId, beginn: e.beginn, ende: e.ende, personIds: e.zuordnung.personIds, richtung: e.richtung, absenderHash: e.absender ? adressHash(a!.id, e.absender) : null, teilnehmerHashes: [...new Set(e.adressen.map((x) => x.trim().toLowerCase()))].map((x) => adressHash(a!.id, x)) });
      return a!;
    });
  } catch (fehler) {
    if (hatFehlercode(fehler, "23505")) return null;
    throw fehler;
  }
}
