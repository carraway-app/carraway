import { eq, sql } from "drizzle-orm";
import { kontaktDomain, kontaktHerkunft, kontaktVorschlag, organisation, person, postfachVerbindung, type Db } from "@carraway/db";
import type { Logger } from "../beobachtung/protokoll";
import { setzeHauptunternehmen } from "../crm/datensatz";
import { ladeRechte } from "../rechte/aufloesung";
import { legeOrganisationAn } from "../dubletten";
import { schreibe, type Protokollant } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";
import { istFreemail, istUnzulaessigeOrganisationsDomain, ladeBekannte, type Bekannte } from "./abgleich";
import type { MailKopf, Termin } from "./typen";

/**
 * Kontakte aus Postfach und Kalender. Ist die Funktion in der Installation eingeschaltet und nimmt die Person mit ihrem Postfach teil, entstehen aus echten Gegenübern
 * Vorschläge (`vorschlag`) oder sofort Personen und Unternehmen (`direkt`). Mit `aus` (Standard) oder ohne Teilnahme schreibt dieser Teil nichts; der Abgleich verhält sich
 * dann wie ohne ihn.
 *
 * Wer erfasst wird: nur Empfänger eigener gesendeter Mails und Teilnehmer gemeinsamer Termine. Nie: die eigene Adresse, bekannte Personen, Adressen der Installation
 * (eigene Domains, Benutzer), Sperrlisten der Installation und der Person, `no-reply` und ähnliche, Mails mit Listen- oder Massenkopfzeilen und Mails oder Termine mit
 * vielen Beteiligten. Freemail-Adressen ergeben eine Person ohne Unternehmen; Mehrmandanten-Hosts und öffentliche Suffixe nie ein Unternehmen.
 *
 * Keine Dubletten: Je Adresse gibt es genau eine Zeile in `kontakt_vorschlag` (eindeutig), je Domain höchstens ein Unternehmen in `kontakt_domain`. Angelegt wird in einer
 * kurzen Transaktion je Kontakt unter Sperren in fester Reihenfolge (erst Domain, dann Adresse); gleichzeitige Abgleiche mehrerer Postfächer warten aufeinander.
 */

export type KontaktModus = "aus" | "vorschlag" | "direkt";
export type Bereich = "mail" | "kalender";

export interface KontaktRegeln {
  modus: Exclude<KontaktModus, "aus">;
  /** Domains der Installation (klein, ohne `@`), Unterdomains zählen dazu. */
  eigeneDomains: string[];
  /** Sperrliste der Installation und der Person zusammen: Adressen (`name@domain`) oder Domains (`domain` bzw. `@domain`, Unterdomains zählen dazu). */
  sperrliste: string[];
  /** Adressen der Benutzer der Installation (ohne technische Benutzer und Investor-Benutzer). */
  interneAdressen: Set<string>;
}

export interface Kandidat {
  adresse: string;
  name: string | null;
}

/** Mails mit mehr Empfängern und Termine mit mehr Teilnehmern gelten als Massenversand bzw. Großveranstaltung. */
export const MAX_EMPFAENGER = 10;
export const MAX_TEILNEHMER = 20;

const NO_REPLY = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon|postmaster|bounces?|notifications?|notify|newsletters?|news|mailings?|unsubscribe|abmelden|automat|auto[-_.]?reply|alerts?|system)([-_.+].*)?$/;

const ADRESSE_FORM = /^[^\s@<>()",;]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

const klein = (a: string) => a.trim().toLowerCase();
const domainVon = (a: string) => a.slice(a.lastIndexOf("@") + 1);

/** Lokaler Teil wie `noreply`, `no-reply`, `mailer-daemon`, `newsletter`; auch mit Zusatz (`noreply+abc`) und wenn `noreply` irgendwo darin steht. */
export function istNoReply(adresse: string): boolean {
  const lokal = klein(adresse).slice(0, adresse.lastIndexOf("@"));
  return NO_REPLY.test(lokal) || lokal.includes("noreply") || lokal.includes("no-reply") || lokal.includes("donotreply");
}

const passtDomain = (domain: string, eintrag: string) => domain === eintrag || domain.endsWith(`.${eintrag}`);

/** Steht die Adresse auf der Sperrliste (genaue Adresse oder Domain samt Unterdomains)? */
export function istGesperrt(adresse: string, sperrliste: readonly string[]): boolean {
  const a = klein(adresse);
  const d = domainVon(a);
  return sperrliste.some((roh) => {
    const e = klein(roh);
    if (!e) return false;
    if (e.startsWith("@")) return passtDomain(d, e.slice(1));
    return e.includes("@") ? e === a : passtDomain(d, e);
  });
}

/** Normalisiert eine Liste von Adressen und Domains (klein, ohne Leerzeichen und Doppelungen); unbrauchbare Einträge fallen weg. */
export function normalisiereListe(eintraege: readonly string[]): string[] {
  const aus = new Set<string>();
  for (const roh of eintraege) {
    const e = klein(roh).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!e || /\s/.test(e)) continue;
    const domain = e.startsWith("@") ? e.slice(1) : e.includes("@") ? domainVon(e) : e;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) continue;
    aus.add(e.startsWith("@") ? domain : e);
  }
  return [...aus].sort();
}

function erlaubt(adresse: string, eigene: string, bekannte: Bekannte, regeln: KontaktRegeln): boolean {
  if (!ADRESSE_FORM.test(adresse) || adresse === eigene) return false;
  if (bekannte.personen.has(adresse) || regeln.interneAdressen.has(adresse)) return false;
  const d = domainVon(adresse);
  if (regeln.eigeneDomains.some((e) => passtDomain(d, e))) return false;
  // Die Domain der eigenen Adresse ist intern, außer bei Freemail (dort sind andere Adressen der Domain Fremde).
  const eigeneDomain = domainVon(eigene);
  if (d === eigeneDomain && !istFreemail(eigeneDomain)) return false;
  return !istNoReply(adresse) && !istGesperrt(adresse, regeln.sperrliste);
}

function sammle(ziel: Map<string, string | null>, adresse: string, name: string | null | undefined) {
  const n = name?.trim().replace(/^["']|["']$/g, "").trim() || null;
  const nameOk = n && !n.includes("@") ? n.slice(0, 200) : null;
  if (!ziel.has(adresse)) ziel.set(adresse, nameOk);
  else if (!ziel.get(adresse) && nameOk) ziel.set(adresse, nameOk);
}

const alsListe = (m: Map<string, string | null>): Kandidat[] => [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([adresse, name]) => ({ adresse, name }));

/**
 * Gegenüber aus Mails: Empfänger (An, Kopie) von Mails aus dem Gesendet-Ordner des Postfachs (`gesendet`, vom Anbieter, nie aus der fälschbaren From-Zeile).
 * Eingehende Mails allein ergeben nie einen Kontakt, auch nicht mit der eigenen Adresse als Absender. Mails mit Listen- oder
 * Massenkopfzeilen und mit mehr als `MAX_EMPFAENGER` Empfängern zählen nicht; wer im selben Abruf eine Massenmail geschickt hat, auch nicht.
 */
export function kandidatenAusMails(koepfe: readonly MailKopf[], eigeneAdresse: string, bekannte: Bekannte, regeln: KontaktRegeln): Kandidat[] {
  const eigene = klein(eigeneAdresse);
  const massenAbsender = new Set(koepfe.filter((k) => k.massenmail).map((k) => klein(k.von)));
  const aus = new Map<string, string | null>();
  for (const k of koepfe) {
    if (k.gesendet !== true || k.massenmail) continue;
    const empfaenger = [...new Set([...k.an, ...k.cc].map(klein))];
    if (empfaenger.length > MAX_EMPFAENGER) continue;
    for (const a of empfaenger) if (!massenAbsender.has(a) && erlaubt(a, eigene, bekannte, regeln)) sammle(aus, a, k.namen?.[a]);
  }
  return alsListe(aus);
}

/**
 * Gegenüber aus Terminen: andere Teilnehmer (und Organisator) nicht abgesagter Termine mit höchstens `MAX_TEILNEHMER` Beteiligten, die die Person selbst organisiert oder
 * ausdrücklich angenommen hat. Offene, mit Vorbehalt angenommene und abgelehnte Einladungen zählen nicht: Einladen kann jeder Fremde, mit beliebigen Adressen.
 */
export function kandidatenAusTerminen(termine: readonly Termin[], eigeneAdresse: string, bekannte: Bekannte, regeln: KontaktRegeln): Kandidat[] {
  const eigene = klein(eigeneAdresse);
  const aus = new Map<string, string | null>();
  for (const t of termine) {
    if (t.abgesagt || (t.eigeneAntwort !== "organisator" && t.eigeneAntwort !== "angenommen")) continue;
    const beteiligte = [...new Set([...t.teilnehmer, ...(t.organisator ? [t.organisator] : [])].map(klein))];
    if (!beteiligte.includes(eigene) || beteiligte.length > MAX_TEILNEHMER) continue;
    for (const a of beteiligte) if (erlaubt(a, eigene, bekannte, regeln)) sammle(aus, a, t.namen?.[a]);
  }
  return alsListe(aus);
}

const gross = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w);

/** Vor- und Nachname aus dem Anzeigenamen (`Vorname Nachname` oder `Nachname, Vorname`), sonst aus dem lokalen Teil der Adresse (`vorname.nachname`). */
export function namensteile(name: string | null, adresse: string): { vorname: string; nachname: string } {
  const n = name?.trim().replace(/\s+/g, " ");
  if (n) {
    if (n.includes(",")) {
      const [nach, ...vor] = n.split(",");
      return { vorname: vor.join(",").trim(), nachname: nach!.trim() };
    }
    const teile = n.split(" ");
    if (teile.length === 1) return { vorname: "", nachname: teile[0]! };
    return { vorname: teile.slice(0, -1).join(" "), nachname: teile.at(-1)! };
  }
  const lokal = adresse.slice(0, adresse.lastIndexOf("@")).replace(/\+.*$/, "");
  const teile = lokal.split(/[._-]+/).filter(Boolean).map(gross);
  if (teile.length >= 2) return { vorname: teile.slice(0, -1).join(" "), nachname: teile.at(-1)! };
  return { vorname: "", nachname: teile[0] ?? lokal };
}

/** Domain, die ein Unternehmen bezeichnen darf; `null` bei Freemail, Mehrmandanten-Hosts, öffentlichen Suffixen und einzelnen Labels. */
export function unternehmensDomain(adresse: string): string | null {
  const d = domainVon(klein(adresse));
  return istUnzulaessigeOrganisationsDomain(d) ? null : d;
}

/** Vorläufiger Name eines Unternehmens aus seiner Domain: das Label vor der Endung, groß geschrieben (`beispiel-gmbh.de` → `Beispiel-gmbh`). */
export function unternehmensname(domain: string): string {
  const teile = domain.split(".");
  const zweiStufig = teile.length >= 3 && /^(co|com|org|net|ac|gv|or|gov|edu)$/.test(teile.at(-2)!);
  const label = teile.at(zweiStufig ? -3 : -2) ?? domain;
  return gross(label);
}

const RANG = { betrachter: 1, bearbeiter: 2, freigeber: 3, verwalter: 4 } as const;

/**
 * Darf die Person Kontakte anlegen (Bearbeiter im Bereich Kontakte, an irgendeinem Fonds oder über eine Gruppe ohne Fonds, wie `POST /personen`)? Ohne dieses Recht
 * nimmt ihr Postfach nicht teil: Im Modus `direkt` entstünden sonst Kontakte, die sie selbst nicht anlegen dürfte, im Modus `vorschlag` Vorschläge, die niemand sieht.
 */
export async function darfKontakteAnlegen(tx: Tx, benutzerId: string, globalVerwalter: boolean): Promise<boolean> {
  if (globalVerwalter) return true;
  const r = await ladeRechte(tx, benutzerId);
  const genug = (s: keyof typeof RANG | undefined | null) => !!s && RANG[s] >= RANG.bearbeiter;
  if (r.stufen === null) return [...r.rollen.values()].some(genug);
  if (r.bereiche !== null && !r.bereiche.has("kontakte")) return false;
  return [...r.stufen.values()].some((jeBereich) => genug(jeBereich.get("kontakte"))) || genug(r.stufeOhneFondsJeBereich?.get("kontakte"));
}

/** Regeln für eine Person; `null`, wenn die Funktion aus ist, die Person nicht teilnimmt, nicht aktiv ist oder keine Kontakte anlegen darf (dann schreibt dieser Teil nichts). */
export async function ladeKontaktRegeln(tx: Tx, benutzerId: string): Promise<KontaktRegeln | null> {
  const { rows } = await tx.execute<{ modus: KontaktModus; eigene_domains: string[]; sperrliste: string[]; eigene_sperrliste: string[] | null; teilnehmen: boolean | null; global_verwalter: boolean }>(sql`
    SELECT e.modus, e.eigene_domains, e.sperrliste, t.sperrliste AS eigene_sperrliste, t.teilnehmen, b.global_verwalter
    FROM kontaktabgleich_einstellung e
    JOIN benutzer b ON b.id = ${benutzerId} AND b.aktiv AND NOT b.technisch
    LEFT JOIN kontaktabgleich_teilnahme t ON t.benutzer_id = b.id
    WHERE e.id = 1`);
  const z = rows[0];
  if (!z || z.modus === "aus" || !z.teilnehmen) return null;
  if (!(await darfKontakteAnlegen(tx, benutzerId, z.global_verwalter))) return null;
  const intern = await tx.execute<{ email: string }>(sql`SELECT lower(email) AS email FROM benutzer b WHERE NOT b.technisch AND NOT EXISTS (SELECT 1 FROM investor_benutzer i WHERE i.benutzer_id = b.id)`);
  return {
    modus: z.modus,
    eigeneDomains: normalisiereListe(z.eigene_domains).filter((e) => !e.includes("@")),
    sperrliste: normalisiereListe([...z.sperrliste, ...(z.eigene_sperrliste ?? [])]),
    interneAdressen: new Set(intern.rows.map((r) => r.email)),
  };
}

/**
 * Hängt Kontakte aus Postfach und Kalender in den Abgleich ein (vor der Zuordnung). Ohne Regeln: keine Schreibvorgänge, `bekannte` unverändert. `vorschlag`: Vorschläge
 * merken, `bekannte` unverändert (die Mail bleibt verworfen wie bisher). `direkt`: Personen und Unternehmen anlegen und `bekannte` neu laden, damit die Zuordnung sie schon
 * in diesem Lauf findet.
 */
export async function kontakteAusAbgleich(
  db: Db,
  verbindungId: string,
  benutzerId: string,
  bereich: Bereich,
  bekannte: Bekannte,
  kandidaten: (regeln: KontaktRegeln, bekannte: Bekannte) => Kandidat[],
  logger?: Logger,
): Promise<Bekannte> {
  const regeln = await lese(db, (tx) => ladeKontaktRegeln(tx, benutzerId));
  if (!regeln) return bekannte;
  const liste = kandidaten(regeln, bekannte);
  if (liste.length === 0) return bekannte;
  try {
    if (regeln.modus === "vorschlag") {
      await merkeVorschlaege(db, benutzerId, bereich, liste, verbindungId);
      return bekannte;
    }
    let neu = 0;
    for (const k of liste) {
      // Wurde die Verbindung während des Abgleichs getrennt, entsteht nichts mehr (gleiche Sperre wie beim Schreiben der Aktivitäten).
      const ergebnis = await schreibe(db, benutzerId, async (tx, protokoll) =>
        (await verbindungBesteht(tx, verbindungId)) ? legeKontaktAn(tx, protokoll, { ...k, herkunft: benutzerId, bereich, entschiedenVon: null, bekannte }) : { personId: null, neu: false },
      );
      if (ergebnis.neu) neu++;
    }
    if (neu === 0) return bekannte;
    await schreibe(db, "system", (tx) => holeNach(tx));
    return await lese(db, (tx) => ladeBekannte(tx));
  } catch (e) {
    // Ein Fehler hier hält den Abgleich der Mails und Termine nicht auf; der nächste Lauf versucht es erneut. Im Log nur die Art, nie Adressen.
    logger?.("warn", "Kontakte aus Postfach und Kalender fehlgeschlagen", { bereich, fehlerArt: e instanceof Error ? e.name : typeof e });
    return await lese(db, (tx) => ladeBekannte(tx));
  }
}

/** Merkt offene Vorschläge samt Quelle (Person und Bereich). Eine Anweisung je Adresse; gleichzeitige Abgleiche treffen sich an der eindeutigen Adresse. */
export async function merkeVorschlaege(db: Db, benutzerId: string, bereich: Bereich, kandidaten: readonly Kandidat[], verbindungId: string): Promise<void> {
  await schreibe(db, benutzerId, async (tx, protokoll) => {
    if (!(await verbindungBesteht(tx, verbindungId))) return;
    for (const k of kandidaten) {
      const { rows } = await tx.execute<{ id: string; neu: boolean }>(sql`
        WITH v AS (
          INSERT INTO kontakt_vorschlag (adresse, name) VALUES (${k.adresse}, ${k.name})
          ON CONFLICT (adresse) DO UPDATE SET name = coalesce(kontakt_vorschlag.name, excluded.name)
          RETURNING id, status, (xmax = 0) AS neu
        )
        INSERT INTO kontakt_vorschlag_quelle (vorschlag_id, benutzer_id, bereich)
        SELECT id, ${benutzerId}, ${bereich}::postfach_bereich FROM v WHERE status = 'offen'
        ON CONFLICT DO NOTHING
        RETURNING vorschlag_id AS id, (SELECT neu FROM v) AS neu`);
      // Im Protokoll nur Kennungen, nie Adresse oder Name: Das Protokoll ist nur anhängend und bliebe nach dem Entfernen des Vorschlags bestehen.
      for (const r of rows) if (r.neu) await protokoll("vorschlagen", "kontakt_vorschlag", r.id, null, { id: r.id, bereich });
    }
  });
}

/** Besteht die Verbindung noch? Sperrt sie bis zum Ende der Transaktion gegen Trennen (wie beim Schreiben der Aktivitäten in `sync.ts`). */
async function verbindungBesteht(tx: Tx, id: string): Promise<boolean> {
  const { rows } = await tx.execute(sql`SELECT 1 FROM postfach_verbindung WHERE id = ${id} FOR SHARE`);
  return rows.length > 0;
}

/** Sperre für die Dauer der Transaktion auf einen Schlüssel (Domain oder Adresse). */
const sperre = (tx: Tx, schluessel: string) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`kontakt:${schluessel}`}, 0))`);

/** Folgt Zusammenführungen bis zum Ziel. */
async function zielPerson(tx: Tx, id: string): Promise<string> {
  let aktuell = id;
  for (let i = 0; i < 5; i++) {
    const [p] = await tx.select({ in: person.zusammengefuehrtIn }).from(person).where(eq(person.id, aktuell));
    if (!p?.in) break;
    aktuell = p.in;
  }
  return aktuell;
}

async function zielOrganisation(tx: Tx, id: string): Promise<string> {
  let aktuell = id;
  for (let i = 0; i < 5; i++) {
    const [o] = await tx.select({ in: organisation.zusammengefuehrtIn }).from(organisation).where(eq(organisation.id, aktuell));
    if (!o?.in) break;
    aktuell = o.in;
  }
  return aktuell;
}

/** Vorhandene Person mit der Adresse (ohne Beachtung der Groß- und Kleinschreibung), zusammengeführte zeigen auf ihr Ziel. */
async function personMitAdresse(tx: Tx, adresse: string): Promise<string | null> {
  const [p] = await tx.select({ id: person.id }).from(person).where(sql`lower(trim(${person.email})) = ${adresse}`).orderBy(sql`${person.zusammengefuehrtIn} IS NOT NULL`, person.erstelltAm).limit(1);
  return p ? zielPerson(tx, p.id) : null;
}

/**
 * Unternehmen zur Domain: zuerst ein schon aus Postfach oder Kalender entstandenes (`kontakt_domain`), dann ein vorhandenes mit passender Website, sonst neu
 * (Name aus der Domain, Website = Domain). Läuft unter der Sperre der Domain.
 */
async function unternehmenZuDomain(tx: Tx, protokoll: Protokollant, domain: string, bekannte: Bekannte, herkunft: string | null, bereich: Bereich): Promise<string> {
  const [schon] = await tx.select({ id: kontaktDomain.organisationId }).from(kontaktDomain).where(eq(kontaktDomain.domain, domain));
  if (schon) return zielOrganisation(tx, schon.id);
  const vorhanden = bekannte.domains.get(domain);
  if (vorhanden) return vorhanden;
  const neu = await legeOrganisationAn(tx, protokoll, { name: unternehmensname(domain), art: "unternehmen", website: `https://${domain}` }, true);
  await tx.insert(kontaktDomain).values({ domain, organisationId: neu.id });
  await tx.insert(kontaktHerkunft).values({ organisationId: neu.id, benutzerId: herkunft, bereich });
  return neu.id;
}

export interface Anlegen extends Kandidat {
  /** Aus wessen Postfach der Kontakt stammt (Herkunft). */
  herkunft: string | null;
  bereich: Bereich;
  /** Wer den Vorschlag übernommen hat; `null` beim direkten Anlegen. */
  entschiedenVon: string | null;
  bekannte: Bekannte;
}

/**
 * Legt Person (und bei Bedarf Unternehmen) zu einer Adresse an, höchstens einmal je Adresse und Domain. Unter Sperren (Domain, dann Adresse) wird erneut geprüft, ob es die
 * Person schon gibt oder ein anderer Abgleich sie gerade angelegt hat. `neu` ist wahr, wenn eine Person entstanden ist; `null` als Person, wenn die Adresse verworfen ist.
 */
export async function legeKontaktAn(tx: Tx, protokoll: Protokollant, e: Anlegen): Promise<{ personId: string | null; neu: boolean }> {
  const adresse = klein(e.adresse);
  const domain = unternehmensDomain(adresse);
  if (domain) await sperre(tx, `domain:${domain}`);
  await sperre(tx, `adresse:${adresse}`);
  const [v] = await tx.select().from(kontaktVorschlag).where(eq(kontaktVorschlag.adresse, adresse));
  if (v && v.status !== "offen" && v.personId) return { personId: await zielPerson(tx, v.personId), neu: false };
  const vorhanden = await personMitAdresse(tx, adresse);
  if (vorhanden) return { personId: vorhanden, neu: false };
  // Verworfen ist ein Vorschlag, wenn alle seine Quellen ihn verworfen haben; direkt angelegt wird er dann nicht.
  if (v && e.entschiedenVon === null) {
    const { rows } = await tx.execute<{ offen: boolean }>(sql`SELECT bool_or(NOT verworfen) AS offen FROM kontakt_vorschlag_quelle WHERE vorschlag_id = ${v.id}`);
    if (rows[0]?.offen === false) return { personId: null, neu: false };
  }
  const organisationId = domain ? await unternehmenZuDomain(tx, protokoll, domain, e.bekannte, e.herkunft, e.bereich) : null;
  const { vorname, nachname } = namensteile(e.name ?? v?.name ?? null, adresse);
  const [p] = await tx.insert(person).values({ vorname, nachname, email: adresse, organisationId }).returning();
  await protokoll("anlegen", "person", p!.id, null, p);
  if (organisationId) await setzeHauptunternehmen(tx, p!.id, organisationId, null);
  await tx.insert(kontaktHerkunft).values({ personId: p!.id, benutzerId: e.herkunft, bereich: e.bereich });
  const [gemerkt] = await tx
    .insert(kontaktVorschlag)
    .values({ adresse, name: e.name, status: "uebernommen", personId: p!.id, entschiedenVon: e.entschiedenVon, entschiedenAm: new Date() })
    .onConflictDoUpdate({ target: kontaktVorschlag.adresse, set: { status: "uebernommen", personId: p!.id, entschiedenVon: e.entschiedenVon, entschiedenAm: new Date() } })
    .returning({ id: kontaktVorschlag.id });
  await protokoll("uebernehmen", "kontakt_vorschlag", gemerkt!.id, null, { id: gemerkt!.id, personId: p!.id });
  return { personId: p!.id, neu: true };
}

/**
 * Ordnet die Adresse eines Vorschlags einer vorhandenen Person zu. Ohne eigene Adresse bekommt die Person diese; sonst entsteht ein in die Person zusammengeführter
 * Datensatz mit der Adresse (der Abgleich ordnet Adressen zusammengeführter Personen ihrem Ziel zu, wie bisher).
 */
export async function fuehreKontaktZusammen(tx: Tx, protokoll: Protokollant, e: { vorschlagId: string; adresse: string; name: string | null; zielId: string; entschiedenVon: string }): Promise<void> {
  const adresse = klein(e.adresse);
  await sperre(tx, `adresse:${adresse}`);
  const zielId = await zielPerson(tx, e.zielId);
  const [ziel] = await tx.select().from(person).where(eq(person.id, zielId));
  if (!ziel) throw new Error("Person fehlt");
  const zielAdresse = ziel.email ? klein(ziel.email) : null;
  if (!zielAdresse) {
    const [nachher] = await tx.update(person).set({ email: adresse }).where(eq(person.id, zielId)).returning();
    await protokoll("aendern", "person", zielId, ziel, nachher);
  } else if (zielAdresse !== adresse && !(await personMitAdresse(tx, adresse))) {
    const { vorname, nachname } = namensteile(e.name, adresse);
    const [p] = await tx.insert(person).values({ vorname, nachname, email: adresse, zusammengefuehrtIn: zielId, zusammengefuehrtAm: new Date() }).returning();
    await protokoll("anlegen", "person", p!.id, null, p);
  }
  await tx.update(kontaktVorschlag).set({ status: "zusammengefuehrt", personId: zielId, entschiedenVon: e.entschiedenVon, entschiedenAm: new Date() }).where(eq(kontaktVorschlag.id, e.vorschlagId));
  await protokoll("zusammenfuehren", "kontakt_vorschlag", e.vorschlagId, null, { id: e.vorschlagId, personId: zielId });
}

/**
 * Nach neuen Kontakten: Der nächste Mailabgleich jeder Verbindung schaut wieder den ersten Zeitraum zurück (Merker `nachholen`, der Abgleich verbraucht ihn beim Start),
 * Kalender gleichen beim nächsten Durchlauf ab (sie schauen ohnehin jedes Mal über den ganzen Zeitraum). Dubletten verhindert der Hash der Nachricht.
 */
export async function holeNach(tx: Tx): Promise<void> {
  await tx
    .update(postfachVerbindung)
    .set({ nachholen: sql`${postfachVerbindung.nachholen} OR ${postfachVerbindung.bereich} = 'mail'`, naechsterAbgleichAm: sql`least(${postfachVerbindung.naechsterAbgleichAm}, now())` })
    .where(sql`${postfachVerbindung.status} <> 'erneut_anmelden'`);
}

/**
 * Trennt eine Person ein Postfach oder einen Kalender (oder verlässt sie die Installation): Ihre offenen, nicht verworfenen Quellen entfallen, und offene Vorschläge ohne
 * Quelle werden gelöscht. Übernommene Kontakte bleiben; verworfene Quellen bleiben als dauerhafte Ablehnung.
 */
export async function entferneOffeneVorschlaege(tx: Tx, benutzerId: string, bereich?: Bereich): Promise<number> {
  await tx.execute(sql`
    DELETE FROM kontakt_vorschlag_quelle q USING kontakt_vorschlag v
    WHERE q.vorschlag_id = v.id AND v.status = 'offen' AND NOT q.verworfen AND q.benutzer_id = ${benutzerId}
      ${bereich ? sql`AND q.bereich = ${bereich}::postfach_bereich` : sql``}`);
  const { rows } = await tx.execute<{ id: string }>(sql`
    DELETE FROM kontakt_vorschlag v WHERE v.status = 'offen' AND NOT EXISTS (SELECT 1 FROM kontakt_vorschlag_quelle q WHERE q.vorschlag_id = v.id) RETURNING v.id`);
  return rows.length;
}

/** Herkunft eines Kontakts für die Anzeige: Name der Person, aus deren Postfach oder Kalender er stammt, Bereich und Zeitpunkt. */
export async function herkunftVon(tx: Tx, ziel: { personId: string } | { organisationId: string }) {
  const bedingung = "personId" in ziel ? sql`h.person_id = ${ziel.personId}` : sql`h.organisation_id = ${ziel.organisationId}`;
  const { rows } = await tx.execute<{ bereich: Bereich; angelegt_am: string | Date; name: string | null }>(sql`
    SELECT h.bereich, h.angelegt_am, b.name FROM kontakt_herkunft h LEFT JOIN benutzer b ON b.id = h.benutzer_id
    WHERE ${bedingung} LIMIT 1`);
  const z = rows[0];
  return z ? { bereich: z.bereich, angelegtAm: new Date(z.angelegt_am).toISOString(), von: z.name } : null;
}
