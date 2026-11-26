import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { beteiligung, dokument, dokumentVerknuepfung, fonds, kontaktrolle, organisation, person, registerEreignis, registerMeldung, registereintrag } from "@carraway/db";
import { Fachfehler } from "../fehler";
import type { MailKontext } from "../mail/auftraege";
import { sendeRegisterEreignis } from "../mail/benachrichtigung";
import { heute, ladeOrganisation, type Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { personenSchluessel, vergleiche, zerlegeName, type Abweichung } from "./abgleich";
import { HINWEIS_ARTEN, type EintragWerte, type EreignisWerte, type UebernahmeFeld } from "./typen";

export type EintragZeile = typeof registereintrag.$inferSelect;
export type EreignisZeile = typeof registerEreignis.$inferSelect;

/**
 * Die Organisation und die in sie zusammengeführten: Registerzeilen sind unveränderlich und bleiben deshalb an der zusammengeführten
 * Organisation stehen; die Ansicht der Ziel-Organisation zählt sie dazu.
 */
export async function registerOrganisationen(tx: Tx, organisationId: string): Promise<string[]> {
  const weitere = await tx.select({ id: organisation.id }).from(organisation).where(eq(organisation.zusammengefuehrtIn, organisationId));
  return [organisationId, ...weitere.map((o) => o.id)];
}

/** Aktueller Registereintrag: jüngstes Stand-Datum, bei Gleichstand der zuletzt erfasste. */
export async function aktuellerEintrag(tx: Tx, organisationId: string): Promise<EintragZeile | undefined> {
  const [z] = await tx
    .select()
    .from(registereintrag)
    .where(inArray(registereintrag.organisationId, await registerOrganisationen(tx, organisationId)))
    .orderBy(desc(registereintrag.standDatum), desc(registereintrag.erfasstAm), desc(registereintrag.id))
    .limit(1);
  return z;
}

const inhalt = (e: Pick<EintragZeile, "gericht" | "registerart" | "nummer" | "firma" | "rechtsform" | "sitz" | "anschrift" | "gegenstand" | "kapital" | "kapitalWaehrung" | "vertretung" | "prokura">) =>
  JSON.stringify([e.gericht, e.registerart, e.nummer, e.firma, e.rechtsform ?? null, e.sitz ?? null, e.anschrift ?? null, e.gegenstand ?? null, e.kapital === null || e.kapital === undefined ? null : Number(e.kapital).toFixed(2), e.kapitalWaehrung, e.vertretung, e.prokura]);

/**
 * Legt einen neuen Registerstand an. Ist der Inhalt gleich dem aktuellen Stand, entsteht keine neue Zeile (`neu: false`): Die Historie
 * zeigt nur echte Änderungen, auch beim wiederholten Abruf oder Import.
 */
export async function legeEintragAn(
  tx: Tx,
  protokoll: Protokollant,
  organisationId: string,
  werte: EintragWerte,
  quelle: string,
  dokumentId: string | null = null,
): Promise<{ eintrag: EintragZeile; neu: boolean }> {
  if (dokumentId) {
    const [d] = await tx.select({ status: dokument.status }).from(dokument).where(eq(dokument.id, dokumentId));
    if (!d) throw new Fachfehler(404, "document_not_found", "Document not found.");
    if (d.status !== "aktiv") throw new Fachfehler(409, "document_not_active", "The document is not active.");
    // Nur ein Auszug, der an dieser Organisation hängt: sonst ließe sich über den Eintrag der Dateiname eines fremden Dokuments lesen.
    const [verknuepft] = await tx
      .select({ id: dokumentVerknuepfung.dokumentId })
      .from(dokumentVerknuepfung)
      .where(and(eq(dokumentVerknuepfung.dokumentId, dokumentId), eq(dokumentVerknuepfung.zielTyp, "organisation"), eq(dokumentVerknuepfung.zielId, organisationId)));
    if (!verknuepft) throw new Fachfehler(409, "target_not_on_document", "The document is not linked to this organization.");
  }
  const aktuell = await aktuellerEintrag(tx, organisationId);
  const zeile = {
    organisationId,
    gericht: werte.gericht,
    registerart: werte.registerart,
    nummer: werte.nummer,
    firma: werte.firma,
    rechtsform: werte.rechtsform ?? null,
    sitz: werte.sitz ?? null,
    anschrift: werte.anschrift ?? null,
    gegenstand: werte.gegenstand ?? null,
    kapital: werte.kapital ?? null,
    kapitalWaehrung: werte.kapitalWaehrung,
    vertretung: werte.vertretung,
    prokura: werte.prokura,
    standDatum: werte.standDatum,
    quelle,
    dokumentId,
    erfasstVon: protokoll.akteur,
  };
  if (aktuell && inhalt(aktuell) === inhalt(zeile as never) && !dokumentId) return { eintrag: aktuell, neu: false };
  // Wiederholte Abrufe derselben Quelle mit älterem Stand als ein späterer Eintrag einer anderen Quelle dürfen nicht jedes Mal eine Zeile anlegen.
  if (!dokumentId) {
    const [letzteQuelle] = await tx
      .select()
      .from(registereintrag)
      .where(and(eq(registereintrag.organisationId, organisationId), eq(registereintrag.quelle, quelle)))
      .orderBy(desc(registereintrag.erfasstAm), desc(registereintrag.id))
      .limit(1);
    if (letzteQuelle && inhalt(letzteQuelle) === inhalt(zeile as never)) return { eintrag: letzteQuelle, neu: false };
  }
  const [neu] = await tx.insert(registereintrag).values(zeile).returning();
  await protokoll("anlegen", "registereintrag", neu!.id, null, neu);
  return { eintrag: neu!, neu: true };
}

/** Ereignis anlegen. Von Anbietern und Importen stammende Ereignisse sind über `externeId` (sonst über einen Hash) wiederholbar. */
export async function legeEreignisAn(
  tx: Tx,
  protokoll: Protokollant,
  organisationId: string,
  e: EreignisWerte,
  quelle: string,
  registereintragId: string | null = null,
): Promise<{ ereignis: EreignisZeile; neu: boolean }> {
  const externeId = e.externeId ?? (quelle === "manuell" ? null : createHash("sha256").update(`${e.datum}|${e.art}|${e.text}`).digest("hex").slice(0, 32));
  if (externeId) {
    const [vorhanden] = await tx
      .select()
      .from(registerEreignis)
      .where(and(eq(registerEreignis.organisationId, organisationId), eq(registerEreignis.quelle, quelle), eq(registerEreignis.externeId, externeId)));
    if (vorhanden) return { ereignis: vorhanden, neu: false };
  }
  const [neu] = await tx.insert(registerEreignis).values({ organisationId, registereintragId, datum: e.datum, art: e.art, text: e.text, quelle, externeId }).returning();
  await protokoll("anlegen", "register_ereignis", neu!.id, null, neu);
  return { ereignis: neu!, neu: true };
}

/**
 * Meldung in der Oberfläche zu einem neuen Ereignis (Anbieter, Import). Mit `mail` gehen für Ereignisse der Hinweisarten (Insolvenz, Kapitalerhöhung, Löschung)
 * zusätzlich Mails an Personen mit Opt-in in den Ausgangskorb (Name des Unternehmens, Art, Link; kein Registerinhalt).
 */
export async function meldeEreignis(tx: Tx, organisationId: string, ereignis: EreignisZeile, firma: string, mail?: { protokoll: Protokollant; kontext: MailKontext | undefined }): Promise<void> {
  await tx.insert(registerMeldung).values({ organisationId, ereignisId: ereignis.id, art: "ereignis", text: `${firma}: ${ereignis.art} (${ereignis.datum}): ${ereignis.text}`.slice(0, 600) });
  if (mail && (HINWEIS_ARTEN as readonly string[]).includes(ereignis.art)) {
    await sendeRegisterEreignis(tx, mail.protokoll, mail.kontext, { organisationId, art: ereignis.art, ereignisId: ereignis.id });
  }
}

export async function meldeEintrag(tx: Tx, organisationId: string, firma: string, standDatum: string): Promise<void> {
  await tx.insert(registerMeldung).values({ organisationId, art: "eintrag", text: `${firma}: Registerdaten geändert (Stand ${standDatum}).` });
}

/** Stammdaten und Registerstand zum Vergleich. */
export async function ladeAbweichungen(tx: Tx, organisationId: string, eintrag: EintragZeile | undefined): Promise<Abweichung[]> {
  if (!eintrag) return [];
  const [org] = await tx.select().from(organisation).where(eq(organisation.id, organisationId));
  if (!org) return [];
  const gf = await aktiveGeschaeftsfuehrung(tx, organisationId);
  return vergleiche(
    { name: org.name, ort: org.ort, rechtsform: org.rechtsform, geschaeftsfuehrung: gf.map((g) => `${g.vorname} ${g.nachname}`.trim()) },
    { firma: eintrag.firma, sitz: eintrag.sitz, rechtsform: eintrag.rechtsform, vertretung: eintrag.vertretung as { name: string; funktion: string }[] },
  );
}

async function aktiveGeschaeftsfuehrung(tx: Tx, organisationId: string) {
  const tag = heute();
  return tx
    .select({ rolleId: kontaktrolle.id, personId: person.id, vorname: person.vorname, nachname: person.nachname, von: kontaktrolle.von, bis: kontaktrolle.bis })
    .from(kontaktrolle)
    .innerJoin(person, eq(person.id, kontaktrolle.personId))
    .where(and(eq(kontaktrolle.organisationId, organisationId), eq(kontaktrolle.rolle, "geschaeftsfuehrung"), isNull(person.zusammengefuehrtIn)))
    .orderBy(asc(person.nachname), asc(person.vorname))
    .then((zeilen) => zeilen.filter((z) => (z.bis === null || z.bis >= tag) && (z.von === null || z.von <= tag)));
}

/**
 * Übernimmt Felder aus dem aktuellen Registerstand in die Stammdaten. Jedes Feld mit Unterschied wird einzeln geändert und protokolliert
 * (Aktion `register_uebernehmen`, Akteur, Registereintrag). Felder ohne Unterschied sind 409 `register_no_difference`.
 */
export async function uebernehme(tx: Tx, protokoll: Protokollant, organisationId: string, felder: UebernahmeFeld[]): Promise<{ uebernommen: UebernahmeFeld[] }> {
  const org = await ladeOrganisation(tx, organisationId);
  const eintrag = await aktuellerEintrag(tx, organisationId);
  if (!eintrag) throw new Fachfehler(404, "register_entry_missing", "There is no register entry for this organization.");
  const abweichungen = await ladeAbweichungen(tx, organisationId, eintrag);
  const nachFeld = new Map(abweichungen.map((a) => [a.feld, a]));
  for (const f of felder) if (!nachFeld.has(f)) throw new Fachfehler(409, "register_no_difference", "There is no difference from the register for this field.", { feld: f });

  const aenderungen: Partial<typeof organisation.$inferInsert> = {};
  for (const f of felder) {
    if (f === "firma") aenderungen.name = eintrag.firma;
    if (f === "sitz") aenderungen.ort = eintrag.sitz;
    if (f === "rechtsform") aenderungen.rechtsform = eintrag.rechtsform;
  }
  if (Object.keys(aenderungen).length > 0) {
    const [nachher] = await tx.update(organisation).set(aenderungen).where(eq(organisation.id, organisationId)).returning();
    await protokoll("register_uebernehmen", "organisation", organisationId, org, { ...nachher, registereintragId: eintrag.id, felder: felder.filter((x) => x !== "geschaeftsfuehrung") });
  }
  if (felder.includes("geschaeftsfuehrung")) {
    const a = nachFeld.get("geschaeftsfuehrung")!;
    for (const name of a.fehltImCrm ?? []) {
      const schluessel = personenSchluessel(name);
      const kandidaten = (await tx.select().from(person).where(and(isNull(person.zusammengefuehrtIn), eq(person.organisationId, organisationId)))).filter((p) => personenSchluessel(`${p.vorname} ${p.nachname}`) === schluessel);
      let personId = kandidaten.length === 1 ? kandidaten[0]!.id : undefined;
      if (!personId) {
        const [neu] = await tx.insert(person).values({ ...zerlegeName(name), funktion: "Geschäftsführung", organisationId }).returning();
        await protokoll("anlegen", "person", neu!.id, null, { ...neu, registereintragId: eintrag.id });
        personId = neu!.id;
      }
      const [rolle] = await tx.insert(kontaktrolle).values({ personId, organisationId, rolle: "geschaeftsfuehrung", von: eintrag.standDatum }).returning();
      await protokoll("register_uebernehmen", "kontaktrolle", rolle!.id, null, { ...rolle, registereintragId: eintrag.id });
    }
    const aktive = await aktiveGeschaeftsfuehrung(tx, organisationId);
    for (const name of a.nichtImRegister ?? []) {
      const s = personenSchluessel(name);
      for (const z of aktive.filter((x) => personenSchluessel(`${x.vorname} ${x.nachname}`) === s && x.bis === null)) {
        const bis = z.von && z.von > eintrag.standDatum ? z.von : eintrag.standDatum;
        const [vorher] = await tx.select().from(kontaktrolle).where(eq(kontaktrolle.id, z.rolleId));
        const [nachher] = await tx.update(kontaktrolle).set({ bis }).where(eq(kontaktrolle.id, z.rolleId)).returning();
        await protokoll("register_uebernehmen", "kontaktrolle", z.rolleId, vorher, { ...nachher, registereintragId: eintrag.id });
      }
    }
  }
  return { uebernommen: felder };
}

export interface Hinweis {
  ereignisId: string;
  art: (typeof HINWEIS_ARTEN)[number];
  datum: string;
  text: string;
  beteiligungId: string;
  fondsId: string;
  fondsName: string;
  /** Wohin die Oberfläche verweist: Insolvenzablauf, Runde erfassen oder Beteiligung prüfen. */
  aktion: "insolvenz" | "runde" | "pruefen";
}

/**
 * Hinweise auf Beteiligungen aus offenen Registerereignissen (Insolvenz, Kapitalerhöhung, Löschung). Es wird nichts gebucht; der Hinweis
 * verweist auf den Ablauf. Eine Insolvenz erzeugt keinen Hinweis mehr, wenn die Beteiligung schon insolvent ist.
 */
export async function ladeHinweise(tx: Tx, filter: { organisationId?: string; beteiligungId?: string; fondsIds?: string[] | "alle" }): Promise<Hinweis[]> {
  const bedingungen = [isNull(registerEreignis.erledigtAm), inArray(registerEreignis.art, [...HINWEIS_ARTEN])];
  if (filter.organisationId) bedingungen.push(eq(beteiligung.organisationId, filter.organisationId));
  if (filter.beteiligungId) bedingungen.push(eq(beteiligung.id, filter.beteiligungId));
  if (filter.fondsIds && filter.fondsIds !== "alle") bedingungen.push(filter.fondsIds.length ? inArray(beteiligung.fondsId, filter.fondsIds) : eq(beteiligung.id, "00000000-0000-0000-0000-000000000000"));
  const zeilen = await tx
    .select({ e: registerEreignis, b: beteiligung, fondsName: fonds.name })
    .from(registerEreignis)
    // Ereignisse einer zusammengeführten Organisation gelten für die Beteiligungen der Ziel-Organisation.
    .innerJoin(organisation, eq(organisation.id, registerEreignis.organisationId))
    .innerJoin(beteiligung, eq(beteiligung.organisationId, sql`coalesce(${organisation.zusammengefuehrtIn}, ${organisation.id})`))
    .innerJoin(fonds, eq(fonds.id, beteiligung.fondsId))
    .where(and(...bedingungen))
    .orderBy(desc(registerEreignis.datum), asc(registerEreignis.id));
  return zeilen
    .filter(({ e, b }) => !(e.art === "insolvenz" && b.status !== "aktiv") && !(e.art === "kapitalerhoehung" && b.status !== "aktiv"))
    .map(({ e, b, fondsName }) => ({
      ereignisId: e.id,
      art: e.art as Hinweis["art"],
      datum: e.datum,
      text: e.text,
      beteiligungId: b.id,
      fondsId: b.fondsId,
      fondsName,
      aktion: e.art === "insolvenz" ? "insolvenz" : e.art === "kapitalerhoehung" ? "runde" : "pruefen",
    }));
}
