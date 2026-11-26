import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { benutzer, benutzerEinstellung, beteiligung, investorBenutzer, investorZugang, organisation, person, wirksamesBereichsrecht } from "@carraway/db";
import { Fachfehler } from "../fehler";
import type { Bereich } from "../rechte/bereiche";
import { hatBereichSql } from "../rechte/aufloesung";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { legeMailAn, verlangeMail, type MailKontext } from "./auftraege";
import { ADRESSE } from "./konfiguration";
import type { Sprache } from "./vorlagen";

/**
 * Wo Fachaktionen Mails auslösen. Alle Funktionen laufen in der Transaktion der Aktion (Ausgangskorb) und senden nie selbst.
 * Keine Mail enthält Beträge oder Dokumente.
 */

const alsSprache = (s: string | null | undefined): Sprache => (s === "en" ? "en" : "de");

/** Kennzahlen-Abfrage und ESG-Fragebogen (`art`): der Link geht an eine Kontaktperson des Unternehmens der Beteiligung (mit Mailadresse, nicht zusammengeführt). */
export async function sendeKennzahlLink(
  tx: Tx,
  protokoll: Protokollant,
  kontext: MailKontext | undefined,
  e: { art?: "kennzahlen" | "esg"; abfrageId: string; beteiligungId: string; personId: string; sprache: Sprache; linkPfad: string; periodeBeginn: string; periodeEnde: string; faelligAm: string; hinweis: string | null },
): Promise<string> {
  verlangeMail(kontext);
  const [z] = await tx
    .select({ email: person.email, firma: organisation.name })
    .from(beteiligung)
    .innerJoin(organisation, eq(organisation.id, beteiligung.organisationId))
    .innerJoin(person, and(eq(person.organisationId, beteiligung.organisationId), eq(person.id, e.personId), isNull(person.zusammengefuehrtIn)))
    .where(eq(beteiligung.id, e.beteiligungId));
  if (!z?.email) throw new Fachfehler(400, "mail_recipient_invalid", "The person does not belong to the company or has no email address.");
  const link = `${kontext.appBasis}${e.linkPfad}`;
  const bezug = { art: "kennzahl_abfrage", id: e.abfrageId };
  // ESG-Fragebogen (`kennzahl_abfrage.art = esg`) hat eine eigene Vorlage; das Berichtsjahr ist das Jahr des Zeitraums.
  if (e.art === "esg") {
    return legeMailAn(tx, protokoll, kontext, { an: z.email, sprache: e.sprache, vorlage: "esg_abfrage", parameter: { unternehmen: z.firma, jahr: e.periodeEnde.slice(0, 4), faelligAm: e.faelligAm, link, hinweis: e.hinweis }, bezug });
  }
  return legeMailAn(tx, protokoll, kontext, {
    an: z.email,
    sprache: e.sprache,
    vorlage: "kennzahl_abfrage",
    parameter: { unternehmen: z.firma, periodeBeginn: e.periodeBeginn, periodeEnde: e.periodeEnde, faelligAm: e.faelligAm, link, hinweis: e.hinweis },
    bezug,
  });
}

/**
 * LP-Mitteilung: Hinweis an die aktiven Investor-Benutzer der genannten Organisationen. Die Mail nennt nur, dass etwas im Portal bereitliegt.
 * Gibt die Zahl der angelegten Aufträge zurück.
 */
export async function sendeLpHinweis(
  tx: Tx,
  protokoll: Protokollant,
  kontext: MailKontext | undefined,
  e: { fondsName: string; art: "abruf" | "ausschuettung"; organisationIds: string[]; bezugId: string; sprache: Sprache },
): Promise<number> {
  verlangeMail(kontext);
  if (e.organisationIds.length === 0) return 0;
  const empfaenger = await tx
    .selectDistinct({ id: benutzer.id, email: benutzer.email, sprache: benutzerEinstellung.sprache })
    .from(investorZugang)
    .innerJoin(investorBenutzer, eq(investorBenutzer.benutzerId, investorZugang.benutzerId))
    .innerJoin(benutzer, and(eq(benutzer.id, investorBenutzer.benutzerId), eq(benutzer.aktiv, true), eq(benutzer.technisch, false)))
    .leftJoin(benutzerEinstellung, eq(benutzerEinstellung.benutzerId, benutzer.id))
    .where(inArray(investorZugang.organisationId, e.organisationIds));
  let n = 0;
  for (const r of empfaenger) {
    // Eine unbrauchbare Adresse eines Kontos darf die Freigabe nicht zurückrollen: Diese Person bekommt dann keinen Hinweis.
    if (!ADRESSE.test(r.email)) continue;
    n++;
    await legeMailAn(tx, protokoll, kontext, {
      an: r.email,
      sprache: alsSprache(r.sprache ?? e.sprache),
      vorlage: "lp_mitteilung",
      parameter: { fonds: e.fondsName, art: e.art, link: `${kontext.appBasis}/portal` },
      bezug: { art: "fonds_bewegung", id: e.bezugId },
    });
  }
  return n;
}

/** Bericht, Meldelauf oder Beleg freigegeben (letzte Stufe, alle Arten): interne Hinweise an Personen mit Opt-in und Rolle am Fonds (oder globale Verwalter), außer der freigebenden Person. Ohne Mailversand still. */
export async function sendeBerichtFreigegeben(
  tx: Tx,
  protokoll: Protokollant,
  kontext: MailKontext | undefined,
  e: { berichtId: string; bericht: string; fondsId: string | null; fondsName: string | null; /** Ziel des Links (Standard: Bericht); Meldeläufe haben eine eigene Seite. */ linkPfad?: string; bezugArt?: string },
): Promise<number> {
  if (!kontext?.konfig || !kontext.ring) return 0;
  // Nur Personen mit dem Bereich der Freigabe (Rechtemodell): Beleg → Finanzen, Meldelauf → Meldewesen, sonst Berichte.
  const bereich: Bereich = e.bezugArt === "beleg" ? "finanzen" : e.bezugArt === "melde_lauf" ? "meldewesen" : "berichte";
  const optIn = await tx
    .select({ id: benutzer.id, email: benutzer.email, sprache: benutzerEinstellung.sprache })
    .from(benutzerEinstellung)
    .innerJoin(benutzer, and(eq(benutzer.id, benutzerEinstellung.benutzerId), eq(benutzer.aktiv, true), eq(benutzer.technisch, false)))
    // Bereiche je Fonds: Stufe an genau diesem Fonds im Bereich der Freigabe; ohne Fonds nur globale Verwalter.
    .where(and(eq(benutzerEinstellung.mailBerichtFreigegeben, true), e.fondsId ? hatBereichSql(benutzer.id, bereich, { fondsId: e.fondsId }) : eq(benutzer.globalVerwalter, true)));
  if (optIn.length === 0) return 0;
  const investoren = new Set((await tx.select({ id: investorBenutzer.benutzerId }).from(investorBenutzer)).map((r) => r.id));
  let n = 0;
  for (const r of optIn) {
    if (investoren.has(r.id) || r.id === protokoll.akteur) continue;
    // Ein Hinweis ist nie ein Grund, die Freigabe zurückzurollen: unbrauchbare Adressen werden übersprungen.
    if (!ADRESSE.test(r.email)) continue;
    await legeMailAn(tx, protokoll, kontext, {
      an: r.email,
      sprache: alsSprache(r.sprache),
      vorlage: "bericht_freigegeben",
      parameter: { bericht: e.bericht, fonds: e.fondsName, link: `${kontext.appBasis}${e.linkPfad ?? `/berichte/${e.berichtId}`}` },
      bezug: { art: e.bezugArt ?? "bericht", id: e.berichtId },
    });
    n++;
  }
  return n;
}

/**
 * Neues Registerereignis (Anbieter, Import, Abruf): interne Hinweise an Personen mit Opt-in, die eine Rolle an einem Fonds mit Beteiligung am Unternehmen haben
 * (oder globale Verwalter). Die Mail nennt nur Unternehmensname, Art des Ereignisses und den Link zum Unternehmen, keinen Registerinhalt. Ohne Mailversand still.
 */
export async function sendeRegisterEreignis(
  tx: Tx,
  protokoll: Protokollant,
  kontext: MailKontext | undefined,
  e: { organisationId: string; art: string; ereignisId: string },
): Promise<number> {
  if (!kontext?.konfig || !kontext.ring) return 0;
  const optIn = await tx
    .select({ id: benutzer.id, email: benutzer.email, global: benutzer.globalVerwalter, sprache: benutzerEinstellung.sprache })
    .from(benutzerEinstellung)
    .innerJoin(benutzer, and(eq(benutzer.id, benutzerEinstellung.benutzerId), eq(benutzer.aktiv, true), eq(benutzer.technisch, false)))
    // Registerereignisse gehören zu den Kontakten (Register liegt im Bereich Kontakte).
    .where(and(eq(benutzerEinstellung.mailRegisterEreignis, true), hatBereichSql(benutzer.id, "kontakte")));
  if (optIn.length === 0) return 0;
  // Der Name stammt aus den Stammdaten des Unternehmens, nicht aus dem Register.
  const [org] = await tx.select({ name: organisation.name }).from(organisation).where(eq(organisation.id, e.organisationId));
  if (!org) return 0;
  const mitRolle = new Set(
    (
      await tx
        .selectDistinct({ id: wirksamesBereichsrecht.benutzerId })
        .from(wirksamesBereichsrecht)
        .innerJoin(beteiligung, and(eq(beteiligung.fondsId, wirksamesBereichsrecht.fondsId), eq(beteiligung.organisationId, e.organisationId)))
        // Bereiche je Fonds: Kontakte an einem Fonds, der am Unternehmen beteiligt ist.
        .where(or(isNull(wirksamesBereichsrecht.bereich), eq(wirksamesBereichsrecht.bereich, "kontakte")))
    ).map((r) => r.id),
  );
  const investoren = new Set((await tx.select({ id: investorBenutzer.benutzerId }).from(investorBenutzer)).map((r) => r.id));
  let n = 0;
  for (const r of optIn) {
    if (investoren.has(r.id)) continue;
    if (!r.global && !mitRolle.has(r.id)) continue;
    if (!ADRESSE.test(r.email)) continue;
    await legeMailAn(tx, protokoll, kontext, {
      an: r.email,
      sprache: alsSprache(r.sprache),
      vorlage: "register_ereignis",
      parameter: { unternehmen: org.name, art: e.art, link: `${kontext.appBasis}/organisationen/${e.organisationId}` },
      bezug: { art: "register_ereignis", id: e.ereignisId },
    });
    n++;
  }
  return n;
}
