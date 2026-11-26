import { kontaktJson, pruefeKontakt } from "../kontakte/http";
import { and, asc, eq, ilike, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { beteiligung, deal, fonds, kontaktrolle, organisation, organisationArt, person, vehikel, type Db } from "@carraway/db";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { findeDubletten, legeOrganisationAn } from "../dubletten";
import { geaendertSeitBedingung, geaendertSeitEingabe } from "../geaendert";
import { ladeBeziehungen } from "../kontakte/beziehungen";
import { fuehreOrganisationenZusammen, ORGANISATION_FELDER, vorschauOrganisationen } from "../kontakte/zusammenfuehren";
import { fehlerAntwort } from "../fehler";
import { dealSichtbar, fondsSichtbar } from "../rechte/sichtbarkeit";
import { organisationAnteilsklassenRouten } from "./kapital";
import { organisationMitarbeiterRouten } from "./mitarbeiterbeteiligung";
import { organisationRundenRouten } from "./runden";
import { organisationUebertragungRouten } from "./uebertragungen";
import { idParam, ladeOrganisation, MINDESTENS_EIN_FELD, mindestensEins, nurGesetzte, optionalerText, schreibe, websiteEingabe, textEingabe } from "../schreiben";
import { herkunftVon } from "../postfach/kontakte";
import { lese } from "../zeitlimit";

/** Der Cursor ist undurchsichtig für die Oberfläche: Name und Id der letzten Zeile, Base64-kodiert. */
const kodiere = (name: string, id: string) => Buffer.from(JSON.stringify([name, id])).toString("base64url");
function dekodiere(cursor: string): [string, string] | null {
  try {
    const wert: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(wert) && typeof wert[0] === "string" && typeof wert[1] === "string" && z.uuid().safeParse(wert[1]).success) return [wert[0], wert[1]];
  } catch {
    // ungültiger Cursor: unten als Eingabefehler gemeldet
  }
  return null;
}

const maskiere = (text: string) => text.replace(/[\\%_]/g, (zeichen) => `\\${zeichen}`);

const listenAbfrage = z.object({
  suche: z.string().trim().min(1).max(200).optional(),
  art: z.enum(organisationArt.enumValues).optional(),
  geaendertSeit: geaendertSeitEingabe,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z
    .string()
    .max(500)
    .refine((c) => dekodiere(c) !== null, { message: "Invalid cursor" })
    .optional(),
});

/** Abschnitt der NACE (Expected a letter from A to U), Grundlage der Energieintensität je klimaintensivem Sektor in der ESG-Auswertung. */
const naceEingabe = z.string().regex(/^[A-U]$/, "Expected a letter from A to U").nullable().optional();

const neueOrganisation = z.object({
  name: textEingabe(300),
  art: z.enum(organisationArt.enumValues),
  sektor: optionalerText(200),
  naceAbschnitt: naceEingabe,
  ort: optionalerText(200),
  rechtsform: optionalerText(100),
  website: websiteEingabe,
  /** Bestätigt, dass trotz ähnlicher Namen eine neue Organisation entstehen soll. */
  dubletteBestaetigt: z.boolean().optional(),
});

const aenderungOrganisation = z
  .object({
    name: textEingabe(300).optional(),
    art: z.enum(organisationArt.enumValues).optional(),
    sektor: optionalerText(200),
    naceAbschnitt: naceEingabe,
    ort: optionalerText(200),
    rechtsform: optionalerText(100),
    website: websiteEingabe,
  })
  .refine(mindestensEins, MINDESTENS_EIN_FELD);

const zusammenfuehrenEingabe = z.object({
  /** Die Organisation, die in die des Pfades zusammengeführt wird; sie bleibt als Datensatz erhalten. */
  quelleId: z.uuid(),
  /** Welcher Wert je Feld gilt; ohne Angabe der Vorschlag der Vorschau. */
  felder: z.partialRecord(z.enum(ORGANISATION_FELDER), z.enum(["ziel", "quelle"])).default({}),
});

export function organisationRouten(db: Db) {
  return new Hono()
    .get("/duplicates", pruefeKontakt("query", z.object({ name: textEingabe(300) })), async (c) => {
      const { name } = c.req.valid("query");
      const kandidaten = await lese(db, (tx) => findeDubletten(tx, name));
      return kontaktJson(c, { daten: kandidaten }, 200);
    })
    .post("/:id/merge/preview", pruefeKontakt("param", idParam), pruefeKontakt("json", z.object({ quelleId: z.uuid() })), async (c) => {
      const { id } = c.req.valid("param");
      const { quelleId } = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      const vorschau = await lese(db, (tx) => vorschauOrganisationen(tx, akteur, id, quelleId));
      return kontaktJson(c, vorschau, 200);
    })
    .post("/:id/merge", pruefeKontakt("param", idParam), pruefeKontakt("json", zusammenfuehrenEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const { quelleId, felder } = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      const ergebnis = await schreibe(db, c, (tx, protokoll) => fuehreOrganisationenZusammen(tx, protokoll, akteur, id, quelleId, felder));
      return kontaktJson(c, ergebnis, 200);
    })
    .post("/", pruefeKontakt("json", neueOrganisation), async (c) => {
      const { dubletteBestaetigt, ...werte } = c.req.valid("json");
      const neu = await schreibe(db, c, (tx, protokoll) => legeOrganisationAn(tx, protokoll, werte, dubletteBestaetigt));
      return kontaktJson(c, neu, 201);
    })
    .patch("/:id", pruefeKontakt("param", idParam), pruefeKontakt("json", aenderungOrganisation), async (c) => {
      const { id } = c.req.valid("param");
      const aenderungen = nurGesetzte(c.req.valid("json"));
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeOrganisation(tx, id);
        const [nachher] = await tx.update(organisation).set(aenderungen).where(eq(organisation.id, id)).returning();
        await protokoll("aendern", "organisation", id, vorher, nachher);
        return nachher;
      });
      return kontaktJson(c, neu, 200);
    })
    .get("/", pruefeKontakt("query", listenAbfrage), async (c) => {
      const { suche, art, limit, cursor, geaendertSeit } = c.req.valid("query");
      const position = cursor ? dekodiere(cursor) : null;
      const bedingungen = [
        isNull(organisation.zusammengefuehrtIn),
        isNull(organisation.archiviertAm),
        suche ? ilike(organisation.name, `%${maskiere(suche)}%`) : undefined,
        art ? eq(organisation.art, art) : undefined,
        geaendertSeitBedingung("organisation", organisation.id, organisation.erstelltAm, geaendertSeit),
        position ? sql`(${organisation.name}, ${organisation.id}) > (${position[0]}, ${position[1]}::uuid)` : undefined,
      ];
      const zeilen = await lese(db, (tx) =>
        tx
          .select({
            id: organisation.id,
            name: organisation.name,
            art: organisation.art,
            sektor: organisation.sektor,
            ort: organisation.ort,
            website: organisation.website,
          })
          .from(organisation)
          .where(and(...bedingungen))
          .orderBy(asc(organisation.name), asc(organisation.id))
          .limit(limit + 1),
      );
      const seite = zeilen.slice(0, limit);
      const letzte = seite.at(-1);
      const naechsterCursor = zeilen.length > limit && letzte ? kodiere(letzte.name, letzte.id) : null;
      return kontaktJson(c, { daten: seite, naechsterCursor }, 200);
    })
    .get("/:id", pruefeKontakt("param", z.object({ id: z.uuid() })), async (c) => {
      const { id } = c.req.valid("param");
      const ergebnis = await lese(db, async (tx) => {
        const [org] = await tx.select().from(organisation).where(eq(organisation.id, id));
        if (!org) return null;
        const personen = await tx
          .select({ id: person.id, vorname: person.vorname, nachname: person.nachname, email: person.email, funktion: person.funktion })
          .from(person)
          .where(and(eq(person.organisationId, id), isNull(person.zusammengefuehrtIn)))
          .orderBy(asc(person.nachname), asc(person.vorname), asc(person.id));
        const deals = await tx
          .select({ id: deal.id, titel: deal.titel, phase: deal.phase, status: deal.status, ticket: deal.ticket, aktualisiertAm: deal.aktualisiertAm })
          .from(deal)
          .where(and(eq(deal.organisationId, id), dealSichtbar(c)))
          .orderBy(sql`${deal.aktualisiertAm} DESC`, asc(deal.id));
        const beteiligungen = await tx
          .select({
            id: beteiligung.id,
            fonds: { id: fonds.id, name: fonds.name, kurzname: fonds.kurzname },
            instrument: beteiligung.instrument,
            status: beteiligung.status,
            erstinvestment: beteiligung.erstinvestment,
          })
          .from(beteiligung)
          .innerJoin(fonds, eq(fonds.id, beteiligung.fondsId))
          .where(and(eq(beteiligung.organisationId, id), fondsSichtbar(c, beteiligung.fondsId, "portfolio")))
          .orderBy(asc(beteiligung.erstinvestment), asc(beteiligung.id));
        const rollen = await tx
          .select({
            id: kontaktrolle.id,
            rolle: kontaktrolle.rolle,
            von: kontaktrolle.von,
            bis: kontaktrolle.bis,
            person: { id: person.id, vorname: person.vorname, nachname: person.nachname },
          })
          .from(kontaktrolle)
          .innerJoin(person, eq(person.id, kontaktrolle.personId))
          .where(and(eq(kontaktrolle.organisationId, id), isNull(person.zusammengefuehrtIn)))
          .orderBy(asc(person.nachname), asc(person.vorname), asc(kontaktrolle.rolle), asc(kontaktrolle.id));
        const beziehungen = await ladeBeziehungen(tx, c, id);
        // Anzahl der Vehikel: Die Seite zeigt den Abschnitt „Vehikel“ bei Investoren und bei jeder Organisation, die schon Vehikel hat.
        const [{ anzahl: vehikelAnzahl } = { anzahl: 0 }] = await tx.select({ anzahl: sql<number>`count(*)::int` }).from(vehikel).where(eq(vehikel.investorId, id));
        return { ...org, personen, deals, beteiligungen, rollen, beziehungen, vehikelAnzahl, herkunft: await herkunftVon(tx, { organisationId: id }) };
      });
      if (!ergebnis) return fehlerAntwort(c, 404, "organization_not_found", "Organization not found.");
      return kontaktJson(c, ergebnis, 200);
    });
}

/** Portfolio-Unterpfade werden mit ihrem eigenen Bereich umgestellt. */
export function organisationPortfolioRouten(db: Db) {
  return new Hono()
    .route("/:id", organisationAnteilsklassenRouten(db))
    .route("/:id", organisationMitarbeiterRouten(db))
    .route("/:id", organisationRundenRouten(db))
    .route("/:id", organisationUebertragungRouten(db));
}
