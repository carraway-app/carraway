import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { aktivitaet, bericht, beleg, buchungsexport, kontenregel, saldenlauf, beschlussvorlage, beteiligung, bewertung, bewertungsrunde, deal, finanzierungsrunde, fondsBewegung, forderung, instrument, kennzahlAbfrage, kennzahlWert, tranche, meldeLauf, organisation, organisationsbeziehung, rundenposition, szenario, verkauf, vorgang, zinslauf, type Db } from "@carraway/db";
import { ermittleAkteur, fuerBereich, hatIrgendwoRolle, hatRolle, hatRolleOhneFonds, type Akteur } from "../anmeldung/akteur";
import type { Auth } from "../anmeldung/auth";
import { Fachfehler } from "../fehler";
import type { Konfiguration } from "../konfiguration";
import { lese, stapelSpeicher, type Tx } from "../zeitlimit";
import { hatBereich } from "./bereiche";
import { erstelleRegelwerk, type Aufloesung, type Regel, type Regelwerk, type Ziel } from "./tabelle";

const API_PRAEFIX = "/api/v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fonds eines Datensatzes. `undefined`: Datensatz gibt es nicht (der Handler antwortet 404, hier gibt es nichts zu
 * schützen); `null`: gehört zu keinem Fonds (z. B. ein Deal vor der Zuordnung, dann genügt die Rolle irgendwo).
 */
async function ladeFonds(tx: Tx, ueber: Aufloesung, id: string): Promise<string | null | undefined> {
  switch (ueber) {
    case "organisationHalter":
    case "rundenpositionHalter":
      return undefined; // wird in `pruefeRolle` über die Halter geprüft
    case "fonds":
      return id;
    case "beteiligung": {
      const [z] = await tx.select({ f: beteiligung.fondsId }).from(beteiligung).where(eq(beteiligung.id, id));
      return z?.f;
    }
    case "vorgang": {
      const [z] = await tx.select({ f: beteiligung.fondsId }).from(vorgang).innerJoin(beteiligung, eq(beteiligung.id, vorgang.beteiligungId)).where(eq(vorgang.id, id));
      return z?.f;
    }
    case "fondsbewegung": {
      const [z] = await tx.select({ f: fondsBewegung.fondsId }).from(fondsBewegung).where(eq(fondsBewegung.id, id));
      return z?.f;
    }
    case "meilenstein": {
      const [z] = await tx.select({ f: beteiligung.fondsId }).from(tranche).innerJoin(beteiligung, eq(beteiligung.id, tranche.beteiligungId)).where(eq(tranche.id, id));
      return z?.f;
    }
    case "instrument": {
      const [z] = await tx.select({ f: beteiligung.fondsId }).from(instrument).innerJoin(beteiligung, eq(beteiligung.id, instrument.beteiligungId)).where(eq(instrument.id, id));
      return z?.f;
    }
    case "forderung": {
      const [z] = await tx.select({ f: beteiligung.fondsId }).from(forderung).innerJoin(beteiligung, eq(beteiligung.id, forderung.beteiligungId)).where(eq(forderung.id, id));
      return z?.f;
    }
    case "zinslauf": {
      const [z] = await tx.select({ f: zinslauf.fondsId }).from(zinslauf).where(eq(zinslauf.id, id));
      return z?.f;
    }
    case "bewertung": {
      const [z] = await tx.select({ f: beteiligung.fondsId }).from(bewertung).innerJoin(beteiligung, eq(beteiligung.id, bewertung.beteiligungId)).where(eq(bewertung.id, id));
      return z?.f;
    }
    case "szenario": {
      const [z] = await tx.select({ f: szenario.fondsId }).from(szenario).where(eq(szenario.id, id));
      return z?.f;
    }
    case "bewertungsrunde": {
      const [z] = await tx.select({ f: bewertungsrunde.fondsId }).from(bewertungsrunde).where(eq(bewertungsrunde.id, id));
      return z?.f;
    }
    case "verkauf": {
      const [z] = await tx.select({ f: beteiligung.fondsId }).from(verkauf).innerJoin(beteiligung, eq(beteiligung.id, verkauf.beteiligungId)).where(eq(verkauf.id, id));
      return z?.f;
    }
    case "bericht": {
      const [z] = await tx.select({ f: bericht.fondsId, b: bericht.beteiligungId }).from(bericht).where(eq(bericht.id, id));
      if (!z) return undefined;
      if (z.f) return z.f;
      const [b] = z.b ? await tx.select({ f: beteiligung.fondsId }).from(beteiligung).where(eq(beteiligung.id, z.b)) : [];
      return b?.f ?? null;
    }
    case "meldelauf": {
      const [z] = await tx.select({ f: meldeLauf.fondsId }).from(meldeLauf).where(eq(meldeLauf.id, id));
      return z?.f;
    }
    case "kennzahlwert": {
      const [z] = await tx.select({ f: beteiligung.fondsId }).from(kennzahlWert).innerJoin(beteiligung, eq(beteiligung.id, kennzahlWert.beteiligungId)).where(eq(kennzahlWert.id, id));
      return z?.f;
    }
    case "beleg": {
      const [z] = await tx.select({ f: beleg.fondsId }).from(beleg).where(eq(beleg.id, id));
      return z?.f;
    }
    case "saldenlauf": {
      const [z] = await tx.select({ f: saldenlauf.fondsId }).from(saldenlauf).where(eq(saldenlauf.id, id));
      return z?.f;
    }
    case "kontenregel": {
      const [z] = await tx.select({ f: kontenregel.fondsId }).from(kontenregel).where(eq(kontenregel.id, id));
      return z?.f;
    }
    case "buchungsexport": {
      const [z] = await tx.select({ f: buchungsexport.fondsId }).from(buchungsexport).where(eq(buchungsexport.id, id));
      return z?.f;
    }
    case "kennzahlabfrage": {
      const [z] = await tx.select({ f: beteiligung.fondsId }).from(kennzahlAbfrage).innerJoin(beteiligung, eq(beteiligung.id, kennzahlAbfrage.beteiligungId)).where(eq(kennzahlAbfrage.id, id));
      return z?.f;
    }
    case "aktivitaet": {
      const [z] = await tx.select({ f: deal.fondsId }).from(aktivitaet).leftJoin(deal, eq(deal.id, aktivitaet.dealId)).where(eq(aktivitaet.id, id));
      return z === undefined ? undefined : z.f;
    }
    case "beschlussvorlage": {
      const [z] = await tx.select({ f: beschlussvorlage.fondsId }).from(beschlussvorlage).where(eq(beschlussvorlage.id, id));
      return z?.f;
    }
    case "beziehung": {
      const [z] = await tx.select({ f: organisationsbeziehung.fondsId }).from(organisationsbeziehung).where(eq(organisationsbeziehung.id, id));
      return z === undefined ? undefined : z.f;
    }
    case "deal": {
      const [z] = await tx.select({ f: deal.fondsId }).from(deal).where(eq(deal.id, id));
      return z === undefined ? undefined : z.f;
    }
  }
}

/**
 * Fonds, die eine Beteiligung an der Organisation halten (für Datensätze eines Unternehmens ohne einzelnen Fonds). `undefined`: Datensatz
 * oder Organisation gibt es nicht (der Handler antwortet 404).
 */
async function ladeHalter(tx: Tx, ueber: "organisationHalter" | "rundenpositionHalter", id: string): Promise<string[] | undefined> {
  let organisationId: string | undefined;
  if (ueber === "rundenpositionHalter") {
    const [z] = await tx.select({ o: finanzierungsrunde.organisationId }).from(rundenposition).innerJoin(finanzierungsrunde, eq(finanzierungsrunde.id, rundenposition.rundeId)).where(eq(rundenposition.id, id));
    organisationId = z?.o;
  } else {
    const [z] = await tx.select({ id: organisation.id }).from(organisation).where(eq(organisation.id, id));
    organisationId = z?.id;
  }
  if (organisationId === undefined) return undefined;
  const zeilen = await tx.selectDistinct({ f: beteiligung.fondsId }).from(beteiligung).where(eq(beteiligung.organisationId, organisationId));
  return zeilen.map((z) => z.f);
}

/** Werte der Platzhalter im Pfad: In einer Middleware kennt Hono die Routenparameter noch nicht, hier werden sie aus dem Muster der Regel gelesen. */
export function pfadParameter(muster: string, pfad: string): Record<string, string> {
  const teile = pfad.split("/");
  const parameter: Record<string, string> = {};
  muster.split("/").forEach((teil, i) => {
    if (!teil.startsWith(":")) return;
    try {
      parameter[teil.slice(1)] = decodeURIComponent(teile[i] ?? "");
    } catch {
      parameter[teil.slice(1)] = "";
    }
  });
  return parameter;
}

async function wertAus(c: Context, ziel: Ziel, parameter: Record<string, string>): Promise<string | undefined> {
  let roh: unknown;
  if (ziel.ort === "pfad") roh = parameter[ziel.feld];
  else if (ziel.ort === "abfrage") roh = c.req.query(ziel.feld);
  else {
    // Der Körper wird zwischengespeichert; der Validator der Route liest ihn danach erneut.
    const koerper: unknown = await c.req.json().catch(() => undefined);
    roh = koerper && typeof koerper === "object" ? (koerper as Record<string, unknown>)[ziel.feld] : undefined;
  }
  return typeof roh === "string" && UUID.test(roh) ? roh : undefined;
}

const keineBerechtigung = () => new Fachfehler(403, "forbidden", "You lack permission for this.");

/**
 * Prüft die Rolle an allen Zielen der Regel; ohne Treffer genügt die Rolle an irgendeinem Fonds. `akteur` ist schon auf den Bereich der Regel
 * festgelegt (`fuerBereich`): Stufe und Bereich zählen nur zusammen an demselben Fonds, nie „Bereich an Fonds A, Stufe an Fonds B“.
 */
async function pruefeRolle(db: Db, c: Context, akteur: Akteur, regel: Regel, parameter: Record<string, string>) {
  const mindest = regel.rolle!;
  // Die Stufe der Gruppen ohne Fonds zählt nur an Regeln, die das ausdrücklich erlauben (Kontakte, Dealflow).
  if (!(regel.ohneFondsErlaubt ? hatRolleOhneFonds(akteur, mindest) : hatIrgendwoRolle(akteur, mindest))) throw keineBerechtigung();
  for (const ziel of regel.ziele ?? []) {
    const wert = await wertAus(c, ziel, parameter);
    if (wert === undefined) continue;
    if (ziel.ueber === "organisationHalter" || ziel.ueber === "rundenpositionHalter") {
      const ueber = ziel.ueber;
      const halter = await lese(db, (tx) => ladeHalter(tx, ueber, wert));
      if (halter === undefined) continue; // unbekannt: der Handler antwortet 404
      // Irgendein haltender Fonds mit ausreichender Rolle; globale Verwalter dürfen auch bei einer Organisation ohne Beteiligung.
      if (!akteur.globalVerwalter && !halter.some((f) => hatRolle(akteur, f, mindest))) throw keineBerechtigung();
      continue;
    }
    const fondsId = ziel.ueber === "fonds" ? wert : await lese(db, (tx) => ladeFonds(tx, ziel.ueber, wert));
    if (fondsId === undefined || fondsId === null) continue; // unbekannt oder ohne Fonds: die Rolle irgendwo genügt (oben geprüft)
    if (!hatRolle(akteur, fondsId, mindest)) throw keineBerechtigung();
  }
}

/** Pfad der Anfrage relativ zu `/api/v1`. */
export function relativerPfad(c: Context): string {
  const pfad = c.req.path;
  return pfad.startsWith(API_PRAEFIX) ? pfad.slice(API_PRAEFIX.length) || "/" : pfad;
}

/**
 * Meldet an und prüft Rechte für jede Anfrage unter `/api/v1`, nach der Tabelle in `tabelle.ts`:
 * unbekannte Routen → 401 ohne Anmeldung, sonst 403; ohne zweiten Faktor → 403 `two_factor_required` (außer `/me`);
 * Investor-Benutzer → nur die Portal-Routen, überall sonst 403 `portal_only`; Portal-Routen für alle anderen → 403 `forbidden`;
 * Freigaben durch technische Benutzer → 403 `technical_user`; Bereich nicht in den Rollen der Gruppen oder zu geringe Rolle → 403 `forbidden`.
 */
export function rechtePruefung(db: Db, auth: Auth, konfig: Konfiguration, regelwerk: Regelwerk = erstelleRegelwerk()): MiddlewareHandler {
  return async (c, next) => {
    const regel = regelwerk.finde(c.req.method, relativerPfad(c));
    if (regel?.zugriff === "oeffentlich") return next();

    const akteur = await ermittleAkteur(db, auth, konfig, c, regel?.werteSchreiben === true && regel.muster.startsWith("/values/"));
    c.set("akteur", akteur);
    // Werteschlüssel sind auf die Werte-Schnittstelle beschränkt. Schreibrollen gelten nur für ausdrücklich markierte Routen.
    if (akteur.quelle === "werteschluessel" && !regel?.muster.startsWith("/values/")) throw keineBerechtigung();
    if (!regel) throw keineBerechtigung();
    if (regel.zugriff === "angemeldet") return next();

    if (akteur.passwortAendern) {
      throw new Fachfehler(403, "password_change_required", "The initial password must be changed first (POST /auth/change-password).");
    }
    if (akteur.zweiFaktorFehlt) {
      throw new Fachfehler(403, "two_factor_required", "A second factor must be set up before access.");
    }
    if (regel.nurMensch && akteur.technisch) {
      throw new Fachfehler(403, "technical_user", "Approvals require a signed-in person; an API key may not approve.");
    }
    if (regel.zugriff === "investor") {
      // Portal: nur Investor-Benutzer (nie API-Schlüssel, nie interne Benutzer). Die Organisationen prüfen die Handler.
      if (!akteur.investor || akteur.technisch) throw keineBerechtigung();
      return next();
    }
    if (akteur.investor) {
      throw new Fachfehler(403, "portal_only", "This access belongs to the LP portal and has no access to internal data.");
    }
    if (regel.leseTransport) {
      if (akteur.quelle !== "schluessel") throw keineBerechtigung();
      // Ein Leseprotokoll darf weder im Idempotenzspeicher landen noch daraus mit früheren Rechten beantwortet werden.
      if (stapelSpeicher.getStore() || c.req.header("Idempotency-Key") !== undefined) {
        throw new Fachfehler(400, "invalid_input", "This transport requires a standalone request without an Idempotency-Key.");
      }
    }
    if (regel.zugriff === "globalverwalter") {
      if (!akteur.globalVerwalter) throw keineBerechtigung();
      return next();
    }
    // Bereich der Route (Rechtemodell): Personen in Nutzergruppen nur mit einer Rolle, die ihn enthält. Fehlt die Zuordnung, gilt „alle Bereiche“.
    if (!hatBereich(akteur, regel.bereich ?? "alle")) {
      throw new Fachfehler(403, "forbidden", "This area is not part of the person's roles.");
    }
    // Bereiche je Fonds: Ab hier gelten Stufen nur im Bereich der Route, auch für die Listen und Prüfungen in den Handlern.
    const imBereich = fuerBereich(akteur, regel.bereich ?? "alle");
    c.set("akteur", imBereich);
    await pruefeRolle(db, c, imBereich, regel, pfadParameter(regel.muster, relativerPfad(c)));
    return next();
  };
}
