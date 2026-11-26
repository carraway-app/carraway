import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  beteiligung,
  fondsKennzahl,
  kennzahlAbfrage,
  kennzahlAbfragePosition,
  kennzahlAggregation,
  kennzahlDefinition,
  kennzahlKategorie,
  kennzahlPeriodizitaet,
  kennzahlSzenario,
  kennzahlTyp,
  kennzahlWert,
  organisation,
  type Db,
  type KennzahlDefinition,
} from "@carraway/db";
import { geltendeWerte, kpiAbweichung, kpiPeriodenart, kpiVerdichte, kpiZeitraumAus, kpiZeitraumPasst, type KpiTyp, type KpiZeile } from "@carraway/rechenkern";
import { Fachfehler, fehlerAntwort } from "../fehler";
import { geltendeDefinition, kanonischerWert, ohneToken, pruefeZeitraum } from "../kpi/wert";
import { sendeKennzahlLink } from "../mail/benachrichtigung";
import { pruefe } from "../pruefung";
import { heute, idParam, ladeFonds, optionalerText, schreibe } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";

/**
 * Kennzahlen der Portfoliounternehmen: Katalog, Auswahl je Fonds, Werte mit Bestätigung, Zeitreihen mit Abweichungen, Anfragen an
 * Unternehmen (Link ohne Konto; die öffentliche Seite steht in `extern.ts`) und die Übersicht je Fonds. Die Berechtigungstabelle
 * (`rechte/tabelle.ts`) ordnet die Routen ein: `kennzahlRouten` unter `/kennzahlen`, `beteiligungKennzahlRouten` unter `/beteiligungen/:id`,
 * `fondsKennzahlRouten` unter `/fonds/:id`.
 */

const SCHLUESSEL = z.string().regex(/^[a-z][a-z0-9_]{1,59}$/, "Schlüssel aus Kleinbuchstaben, Ziffern und Unterstrich");
const datum = z.iso.date();
const wertText = z.string().max(2100);

const definitionSchema = z.object({
  schluessel: SCHLUESSEL,
  bezeichnungDe: z.string().trim().min(1).max(200),
  bezeichnungEn: z.string().trim().min(1).max(200),
  einheit: z.string().trim().max(30),
  typ: z.enum(kennzahlTyp.enumValues),
  kategorie: z.enum(kennzahlKategorie.enumValues),
  periodizitaet: z.enum(kennzahlPeriodizitaet.enumValues),
  aggregation: z.enum(kennzahlAggregation.enumValues),
  pflicht: z.boolean().default(false),
  reihenfolge: z.number().int().min(0).max(100_000).default(0),
  gueltigAb: datum.optional(),
  regelwerk: optionalerText(300),
  erlaeuterungDe: optionalerText(1500),
  erlaeuterungEn: optionalerText(1500),
  fachlichGeprueft: z.boolean().optional(),
});
/** Neue Version: Schlüssel, Typ und Kategorie bleiben (Zeitreihen und Werte behalten ihre Bedeutung). */
const versionSchema = definitionSchema.omit({ schluessel: true, typ: true, kategorie: true }).partial();
const schluesselParam = z.object({ schluessel: SCHLUESSEL });
const katalogAbfrage = z.object({ alle: z.enum(["true", "false"]).default("false") });

const auswahlSchema = z.object({ schluessel: z.array(SCHLUESSEL).max(100) });

const neuerWertSchema = z.object({
  schluessel: SCHLUESSEL,
  periodeBeginn: datum,
  periodeEnde: datum,
  szenario: z.enum(kennzahlSzenario.enumValues),
  wert: wertText,
  kommentar: optionalerText(1000),
  /** Wert ist geschätzt (ESG-Datenpunkte) und die Quelle dazu. */
  geschaetzt: z.boolean().optional(),
  quellenangabe: optionalerText(500),
});
const wertAenderung = z.object({ wert: wertText.optional(), kommentar: optionalerText(1000), geschaetzt: z.boolean().optional(), quellenangabe: optionalerText(500) });

const reiheAbfrage = z.object({
  von: datum.optional(),
  bis: datum.optional(),
  szenario: z.enum(kennzahlSzenario.enumValues).optional(),
  stand: z.iso.datetime({ offset: true }).optional(),
});

const neueAbfrageSchema = z.object({
  periodeBeginn: datum,
  periodeEnde: datum,
  faelligAm: datum,
  /** Gewünschte Kennzahlen; ohne Angabe die Auswahl des Fonds. */
  schluessel: z.array(SCHLUESSEL).min(1).max(100).optional(),
  sprache: z.enum(["de", "en"]).default("de"),
  hinweis: optionalerText(500),
  /** Gültigkeit des Links in Tagen, höchstens 30. */
  gueltigTage: z.number().int().min(1).max(30).default(30),
  /** Link per Mail an diese Kontaktperson des Unternehmens senden (Etappe 17); der Link bleibt in der Antwort kopierbar. */
  empfaengerPersonId: z.uuid().optional(),
});
const perMailSchema = z.object({ personId: z.uuid() });
const uebersichtAbfrage = z.object({ periode: z.string().max(10) });
const abfrageListeAbfrage = z.object({ status: z.enum(["offen", "eingereicht", "bestaetigt", "widerrufen"]).optional() });

// Hilfen ----------------------------------------------------------------------------------------------------------

export const TAGE_MS = 86_400_000;
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
/** 256 Bit Zufall als Base64url (43 Zeichen). */
export const neuesToken = () => randomBytes(32).toString("base64url");
const tagDavor = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - TAGE_MS).toISOString().slice(0, 10);
const heuteIso = () => heute();

/** Aktuelle Definition je Schlüssel: die höchste Version, die heute gilt. */
async function ladeAktuelle(tx: Tx, stichtag = heuteIso()): Promise<KennzahlDefinition[]> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    SELECT DISTINCT ON (schluessel) id FROM kennzahl_definition
    WHERE gueltig_ab <= ${stichtag}::date AND (gueltig_bis IS NULL OR gueltig_bis >= ${stichtag}::date)
    ORDER BY schluessel, katalog_version DESC`);
  if (rows.length === 0) return [];
  return tx.select().from(kennzahlDefinition).where(inArray(kennzahlDefinition.id, rows.map((r) => r.id))).orderBy(asc(kennzahlDefinition.reihenfolge), asc(kennzahlDefinition.schluessel));
}

/** Neueste Version je Schlüssel unabhängig von der Gültigkeit (Anzeige von Bezeichnung und Einheit alter Werte). */
async function ladeNeueste(tx: Tx, schluessel: string[]): Promise<Map<string, KennzahlDefinition>> {
  if (schluessel.length === 0) return new Map();
  const zeilen = await tx.select().from(kennzahlDefinition).where(inArray(kennzahlDefinition.schluessel, schluessel)).orderBy(asc(kennzahlDefinition.katalogVersion));
  return new Map(zeilen.map((d) => [d.schluessel, d]));
}

const definitionAntwort = (d: KennzahlDefinition) => ({
  id: d.id,
  schluessel: d.schluessel,
  katalogVersion: d.katalogVersion,
  bezeichnungDe: d.bezeichnungDe,
  bezeichnungEn: d.bezeichnungEn,
  einheit: d.einheit,
  typ: d.typ,
  kategorie: d.kategorie,
  periodizitaet: d.periodizitaet,
  aggregation: d.aggregation,
  pflicht: d.pflicht,
  reihenfolge: d.reihenfolge,
  regelwerk: d.regelwerk,
  erlaeuterungDe: d.erlaeuterungDe,
  erlaeuterungEn: d.erlaeuterungEn,
  fachlichGeprueft: d.fachlichGeprueft,
  gueltigAb: d.gueltigAb,
  gueltigBis: d.gueltigBis,
});

async function ladeBeteiligung(tx: Tx, id: string) {
  const [b] = await tx.select().from(beteiligung).where(eq(beteiligung.id, id));
  if (!b) throw new Fachfehler(404, "BETEILIGUNG_NICHT_GEFUNDEN", "Beteiligung nicht gefunden.");
  return b;
}

async function ladeWertGesperrt(tx: Tx, id: string) {
  const [w] = await tx.select().from(kennzahlWert).where(eq(kennzahlWert.id, id)).for("update");
  if (!w) throw new Fachfehler(404, "KENNZAHL_WERT_NICHT_GEFUNDEN", "Kennzahlenwert nicht gefunden.");
  return w;
}

const istOffen = (w: { status: string; verworfenAm: Date | null }) => w.status !== "bestaetigt" && w.verworfenAm === null;

/** Gibt Link-Token und Pfad der Formularseite einmalig aus; in der Datenbank steht nur der Hash. */
export const linkAntwort = (token: string, ablauf: Date) => ({ token, pfad: `/extern/abfrage/${token}`, ablauf: ablauf.toISOString() });

// Katalog, Werte und Anfragen unter /kennzahlen ---------------------------------------------------------------------------

export function kennzahlRouten(db: Db) {
  return new Hono()
    /** Katalog: je Kennzahl die heute gültige Version, mit `alle=true` jede Version. */
    .get("/katalog", pruefe("query", katalogAbfrage), async (c) => {
      const { alle } = c.req.valid("query");
      const daten = await lese(db, async (tx) =>
        alle === "true" ? tx.select().from(kennzahlDefinition).orderBy(asc(kennzahlDefinition.reihenfolge), asc(kennzahlDefinition.schluessel), desc(kennzahlDefinition.katalogVersion)) : ladeAktuelle(tx),
      );
      return c.json({ daten: daten.map(definitionAntwort) }, 200);
    })
    .post("/katalog", pruefe("json", definitionSchema), async (c) => {
      const e = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const [vorhanden] = await tx.select({ id: kennzahlDefinition.id }).from(kennzahlDefinition).where(eq(kennzahlDefinition.schluessel, e.schluessel)).limit(1);
        if (vorhanden) throw new Fachfehler(409, "KENNZAHL_VORHANDEN", "Diese Kennzahl gibt es schon; eine Änderung ist eine neue Version.", { schluessel: e.schluessel });
        const [zeile] = await tx
          .insert(kennzahlDefinition)
          .values({ ...e, gueltigAb: e.gueltigAb ?? heuteIso(), katalogVersion: 1, erstelltVon: protokoll.akteur })
          .returning();
        await protokoll("anlegen", "kennzahl_definition", zeile!.id, null, zeile);
        return zeile!;
      });
      return c.json(definitionAntwort(neu), 201);
    })
    /** Neue Version einer Kennzahl: die bisherige endet am Tag vor `gueltigAb`; Werte behalten ihre Version. */
    .post("/katalog/:schluessel/versionen", pruefe("param", schluesselParam), pruefe("json", versionSchema), async (c) => {
      const { schluessel } = c.req.valid("param");
      const e = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const [letzte] = await tx.select().from(kennzahlDefinition).where(eq(kennzahlDefinition.schluessel, schluessel)).orderBy(desc(kennzahlDefinition.katalogVersion)).limit(1).for("update");
        if (!letzte) throw new Fachfehler(404, "KENNZAHL_NICHT_GEFUNDEN", `Die Kennzahl „${schluessel}“ gibt es im Katalog nicht.`, { schluessel });
        const ab = e.gueltigAb ?? heuteIso();
        if (ab <= letzte.gueltigAb) throw new Fachfehler(409, "KENNZAHL_VERSION_ZEITRAUM", "Die neue Version muss nach dem Beginn der bisherigen gelten.", { gueltigAbBisher: letzte.gueltigAb });
        const { gueltigAb: _ab, ...felder } = e;
        const [zeile] = await tx
          .insert(kennzahlDefinition)
          .values({
            schluessel,
            katalogVersion: letzte.katalogVersion + 1,
            bezeichnungDe: felder.bezeichnungDe ?? letzte.bezeichnungDe,
            bezeichnungEn: felder.bezeichnungEn ?? letzte.bezeichnungEn,
            einheit: felder.einheit ?? letzte.einheit,
            typ: letzte.typ,
            kategorie: letzte.kategorie,
            periodizitaet: felder.periodizitaet ?? letzte.periodizitaet,
            aggregation: felder.aggregation ?? letzte.aggregation,
            pflicht: felder.pflicht ?? letzte.pflicht,
            reihenfolge: felder.reihenfolge ?? letzte.reihenfolge,
            regelwerk: felder.regelwerk !== undefined ? felder.regelwerk : letzte.regelwerk,
            erlaeuterungDe: felder.erlaeuterungDe !== undefined ? felder.erlaeuterungDe : letzte.erlaeuterungDe,
            erlaeuterungEn: felder.erlaeuterungEn !== undefined ? felder.erlaeuterungEn : letzte.erlaeuterungEn,
            fachlichGeprueft: felder.fachlichGeprueft ?? letzte.fachlichGeprueft,
            gueltigAb: ab,
            erstelltVon: protokoll.akteur,
          })
          .returning();
        const bis = tagDavor(ab);
        if (letzte.gueltigBis === null || letzte.gueltigBis > bis) {
          const [alt] = await tx.update(kennzahlDefinition).set({ gueltigBis: bis }).where(eq(kennzahlDefinition.id, letzte.id)).returning();
          await protokoll("begrenzen", "kennzahl_definition", letzte.id, letzte, alt);
        }
        await protokoll("anlegen", "kennzahl_definition", zeile!.id, null, zeile);
        return zeile!;
      });
      return c.json(definitionAntwort(neu), 201);
    })
    /** Nimmt eine Kennzahl außer Kraft (gilt ab heute nicht mehr, frühestens nach ihrem ersten Gültigkeitstag); Version und Werte bleiben erhalten. */
    .delete("/katalog/:schluessel", pruefe("param", schluesselParam), async (c) => {
      const { schluessel } = c.req.valid("param");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const [letzte] = await tx.select().from(kennzahlDefinition).where(eq(kennzahlDefinition.schluessel, schluessel)).orderBy(desc(kennzahlDefinition.katalogVersion)).limit(1).for("update");
        if (!letzte) throw new Fachfehler(404, "KENNZAHL_NICHT_GEFUNDEN", `Die Kennzahl „${schluessel}“ gibt es im Katalog nicht.`, { schluessel });
        const gestern = tagDavor(heuteIso());
        if (letzte.gueltigBis !== null && letzte.gueltigBis <= gestern) throw new Fachfehler(409, "KENNZAHL_BEREITS_AUSSER_KRAFT", "Die Kennzahl gilt schon nicht mehr.");
        const bis = letzte.gueltigAb > gestern ? letzte.gueltigAb : gestern;
        const [zeile] = await tx.update(kennzahlDefinition).set({ gueltigBis: bis }).where(eq(kennzahlDefinition.id, letzte.id)).returning();
        await protokoll("ausser_kraft", "kennzahl_definition", letzte.id, letzte, zeile);
        return zeile!;
      });
      return c.json(definitionAntwort(nachher), 200);
    })

    /** Ändert einen offenen Wert eigener Eingabe (Wert, Kommentar). Bestätigte Werte ändern sich nie; eine Korrektur ist ein neuer Wert. */
    .patch("/werte/:id", pruefe("param", idParam), pruefe("json", wertAenderung.refine((w) => w.wert !== undefined || w.kommentar !== undefined || w.geschaetzt !== undefined || w.quellenangabe !== undefined, { message: "Mindestens ein Feld muss angegeben werden" })), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const w = await ladeWertGesperrt(tx, id);
        if (w.status === "bestaetigt") throw new Fachfehler(409, "KENNZAHL_WERT_BESTAETIGT", "Ein bestätigter Wert ändert sich nicht; eine Korrektur ist ein neuer Wert.");
        if (w.verworfenAm !== null) throw new Fachfehler(409, "KENNZAHL_WERT_VERWORFEN", "Der Wert ist verworfen.");
        if (w.quelle !== "intern") throw new Fachfehler(409, "KENNZAHL_WERT_FREMD", "Werte aus der Abfrage ändern sich nicht; eine Korrektur ist ein neuer Wert.");
        const [d] = await tx.select().from(kennzahlDefinition).where(eq(kennzahlDefinition.id, w.definitionId));
        const set: Partial<typeof kennzahlWert.$inferInsert> = {};
        if (e.wert !== undefined) set.wert = kanonischerWert(d!.typ, e.wert);
        if (e.kommentar !== undefined) set.kommentar = e.kommentar;
        if (e.geschaetzt !== undefined) set.geschaetzt = e.geschaetzt;
        if (e.quellenangabe !== undefined) set.quellenangabe = e.quellenangabe;
        const [zeile] = await tx.update(kennzahlWert).set(set).where(eq(kennzahlWert.id, id)).returning();
        await protokoll("aendern", "kennzahl_wert", id, w, zeile);
        return zeile!;
      });
      return c.json(nachher, 200);
    })
    /** Bestätigt einen Wert (Bearbeiter, kein Vier-Augen-Prinzip). Werte aus der Abfrage müssen zuvor eingereicht sein. */
    .post("/werte/:id/bestaetigen", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const w = await ladeWertGesperrt(tx, id);
        const zeile = await bestaetige(tx, protokoll, w);
        if (w.abfrageId) await schliesseAbfrageAb(tx, protokoll, w.abfrageId);
        return zeile;
      });
      return c.json(nachher, 200);
    })
    .post("/werte/:id/verwerfen", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const w = await ladeWertGesperrt(tx, id);
        if (w.status === "bestaetigt") throw new Fachfehler(409, "KENNZAHL_WERT_BESTAETIGT", "Ein bestätigter Wert lässt sich nicht verwerfen.");
        if (w.verworfenAm !== null) throw new Fachfehler(409, "KENNZAHL_WERT_VERWORFEN", "Der Wert ist schon verworfen.");
        const [zeile] = await tx.update(kennzahlWert).set({ verworfenAm: new Date(), verworfenVon: protokoll.akteur }).where(eq(kennzahlWert.id, id)).returning();
        await protokoll("verwerfen", "kennzahl_wert", id, w, zeile);
        return zeile!;
      });
      return c.json(nachher, 200);
    })

    /** Eine Anfrage mit Werten zur Prüfung (ohne Token). */
    .get("/abfragen/:id", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        const [a] = await tx.select().from(kennzahlAbfrage).where(eq(kennzahlAbfrage.id, id));
        if (!a) return null;
        const [b] = await tx.select({ organisation: organisation.name, beteiligungId: beteiligung.id }).from(beteiligung).innerJoin(organisation, eq(organisation.id, beteiligung.organisationId)).where(eq(beteiligung.id, a.beteiligungId));
        const positionen = await tx
          .select({ d: kennzahlDefinition })
          .from(kennzahlAbfragePosition)
          .innerJoin(kennzahlDefinition, eq(kennzahlDefinition.id, kennzahlAbfragePosition.definitionId))
          .where(eq(kennzahlAbfragePosition.abfrageId, id))
          .orderBy(asc(kennzahlDefinition.reihenfolge), asc(kennzahlDefinition.schluessel));
        const werte = await tx.select().from(kennzahlWert).where(and(eq(kennzahlWert.abfrageId, id), isNull(kennzahlWert.verworfenAm)));
        return { abfrage: ohneToken(a), organisation: b!.organisation, kennzahlen: positionen.map(({ d }) => ({ ...definitionAntwort(d), wert: werte.find((w) => w.definitionId === d.id) ?? null })) };
      });
      if (!daten) return fehlerAntwort(c, 404, "ABFRAGE_NICHT_GEFUNDEN", "Anfrage nicht gefunden.");
      return c.json(daten, 200);
    })
    /** Zieht die Anfrage zurück: der Link gilt nicht mehr, offene Entwürfe der Anfrage werden verworfen. Nur solange nichts eingereicht ist. */
    .post("/abfragen/:id/widerrufen", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const a = await ladeAbfrageGesperrt(tx, id);
        if (a.status !== "offen") throw new Fachfehler(409, "ABFRAGE_STATUS_UNGUELTIG", "Nur eine offene Anfrage lässt sich widerrufen.", { status: a.status });
        const [zeile] = await tx.update(kennzahlAbfrage).set({ status: "widerrufen", widerrufenAm: new Date(), widerrufenVon: protokoll.akteur }).where(eq(kennzahlAbfrage.id, id)).returning();
        await tx.update(kennzahlWert).set({ verworfenAm: new Date(), verworfenVon: protokoll.akteur }).where(and(eq(kennzahlWert.abfrageId, id), isNull(kennzahlWert.verworfenAm), ne(kennzahlWert.status, "bestaetigt")));
        await protokoll("widerrufen", "kennzahl_abfrage", id, ohneToken(a), ohneToken(zeile!));
        return zeile!;
      });
      return c.json(ohneToken(nachher), 200);
    })
    /** Neuer Link: das bisherige Token ist sofort ungültig (je Anfrage gilt genau eines). Nur für offene Anfragen. */
    .post("/abfragen/:id/neuer-link", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const token = neuesToken();
      const ablauf = new Date(Date.now() + 30 * TAGE_MS);
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const a = await ladeAbfrageGesperrt(tx, id);
        if (a.status !== "offen") throw new Fachfehler(409, "ABFRAGE_STATUS_UNGUELTIG", "Nur eine offene Anfrage bekommt einen neuen Link.", { status: a.status });
        const [zeile] = await tx.update(kennzahlAbfrage).set({ tokenHash: tokenHash(token), tokenAblauf: ablauf, tokenErzeugtAm: new Date() }).where(eq(kennzahlAbfrage.id, id)).returning();
        await protokoll("neuer_link", "kennzahl_abfrage", id, ohneToken(a), ohneToken(zeile!));
        return zeile!;
      });
      return c.json({ abfrage: ohneToken(nachher), link: linkAntwort(token, ablauf) }, 200);
    })
    /**
     * Link per Mail senden (Etappe 17). Das Token ist nach dem Anlegen nicht mehr lesbar (nur der Hash steht in der Datenbank); darum erzeugt
     * dieser Weg wie `neuer-link` einen neuen Link, der bisherige ist sofort ungültig. Der Link steht zusätzlich in der Antwort (kopierbar).
     */
    .post("/abfragen/:id/per-mail", pruefe("param", idParam), pruefe("json", perMailSchema), async (c) => {
      const { id } = c.req.valid("param");
      const { personId } = c.req.valid("json");
      const token = neuesToken();
      const ablauf = new Date(Date.now() + 30 * TAGE_MS);
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const a = await ladeAbfrageGesperrt(tx, id);
        if (a.status !== "offen") throw new Fachfehler(409, "ABFRAGE_STATUS_UNGUELTIG", "Nur eine offene Anfrage bekommt einen neuen Link.", { status: a.status });
        await sendeKennzahlLink(tx, protokoll, c.get("mail"), {
          art: a.art, abfrageId: id, beteiligungId: a.beteiligungId, personId, sprache: a.sprache === "en" ? "en" : "de", linkPfad: linkAntwort(token, ablauf).pfad,
          periodeBeginn: a.periodeBeginn, periodeEnde: a.periodeEnde, faelligAm: a.faelligAm, hinweis: a.hinweis,
        });
        const [zeile] = await tx.update(kennzahlAbfrage).set({ tokenHash: tokenHash(token), tokenAblauf: ablauf, tokenErzeugtAm: new Date() }).where(eq(kennzahlAbfrage.id, id)).returning();
        await protokoll("neuer_link", "kennzahl_abfrage", id, ohneToken(a), ohneToken(zeile!));
        return zeile!;
      });
      return c.json({ abfrage: ohneToken(nachher), link: linkAntwort(token, ablauf) }, 200);
    })
    /** Bestätigt alle eingereichten Werte der Anfrage. */
    .post("/abfragen/:id/bestaetigen", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const a = await ladeAbfrageGesperrt(tx, id);
        if (a.status !== "eingereicht") throw new Fachfehler(409, "ABFRAGE_STATUS_UNGUELTIG", "Nur eine eingereichte Anfrage lässt sich bestätigen.", { status: a.status });
        const werte = await tx.select().from(kennzahlWert).where(and(eq(kennzahlWert.abfrageId, id), eq(kennzahlWert.status, "eingereicht"), isNull(kennzahlWert.verworfenAm))).for("update");
        for (const w of werte) await bestaetige(tx, protokoll, w);
        return (await schliesseAbfrageAb(tx, protokoll, id)) ?? a;
      });
      return c.json(ohneToken(nachher), 200);
    });
}

async function ladeAbfrageGesperrt(tx: Tx, id: string) {
  const [a] = await tx.select().from(kennzahlAbfrage).where(eq(kennzahlAbfrage.id, id)).for("update");
  if (!a) throw new Fachfehler(404, "ABFRAGE_NICHT_GEFUNDEN", "Anfrage nicht gefunden.");
  return a;
}

type Protokoll = Parameters<Parameters<typeof schreibe>[2]>[1];

async function bestaetige(tx: Tx, protokoll: Protokoll, w: typeof kennzahlWert.$inferSelect) {
  if (w.status === "bestaetigt") throw new Fachfehler(409, "KENNZAHL_WERT_BESTAETIGT", "Der Wert ist schon bestätigt.");
  if (w.verworfenAm !== null) throw new Fachfehler(409, "KENNZAHL_WERT_VERWORFEN", "Der Wert ist verworfen.");
  if (w.quelle === "unternehmen" && w.status !== "eingereicht") throw new Fachfehler(409, "KENNZAHL_WERT_NICHT_EINGEREICHT", "Ein Wert aus der Abfrage lässt sich erst bestätigen, wenn das Unternehmen ihn eingereicht hat.");
  const [zeile] = await tx.update(kennzahlWert).set({ status: "bestaetigt", bestaetigtVon: protokoll.akteur, bestaetigtAm: new Date() }).where(eq(kennzahlWert.id, w.id)).returning();
  await protokoll("bestaetigen", "kennzahl_wert", w.id, w, zeile);
  return zeile!;
}

/** Sind alle Werte einer eingereichten Anfrage bestätigt oder verworfen und mindestens einer bestätigt, gilt die Anfrage als bestätigt. */
async function schliesseAbfrageAb(tx: Tx, protokoll: Protokoll, abfrageId: string) {
  const a = await ladeAbfrageGesperrt(tx, abfrageId);
  if (a.status !== "eingereicht") return null;
  const werte = await tx.select({ status: kennzahlWert.status, verworfenAm: kennzahlWert.verworfenAm }).from(kennzahlWert).where(eq(kennzahlWert.abfrageId, abfrageId));
  if (werte.some(istOffen) || !werte.some((w) => w.status === "bestaetigt")) return null;
  const [zeile] = await tx.update(kennzahlAbfrage).set({ status: "bestaetigt", bestaetigtAm: new Date() }).where(eq(kennzahlAbfrage.id, abfrageId)).returning();
  await protokoll("bestaetigen", "kennzahl_abfrage", abfrageId, ohneToken(a), ohneToken(zeile!));
  return zeile!;
}

// Unter /beteiligungen/:id --------------------------------------------------------------------------------------------------

export function beteiligungKennzahlRouten(db: Db) {
  return new Hono()
    /**
     * Zeitreihen der Kennzahlen im Zeitraum `von` bis `bis` (Standard: die letzten zwei Jahre): je Kennzahl und Zeitraum Ist, Plan und Forecast
     * (nur bestätigte Werte, die zuletzt bestätigte zählt) und die Abweichung Ist gegen Plan mit Rechenweg. `stand` begrenzt auf Bestätigungen bis
     * dahin. Dazu die offenen Werte (Entwurf, eingereicht) zur Prüfung.
     */
    .get("/kennzahlen", pruefe("param", idParam, { query: reiheAbfrage }), pruefe("query", reiheAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { von, bis, szenario, stand } = c.req.valid("query");
      const bisTag = bis ?? heuteIso();
      const vonTag = von ?? `${Number(bisTag.slice(0, 4)) - 2}-01-01`;
      if (vonTag > bisTag) return fehlerAntwort(c, 400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", [{ feld: "von", code: "custom", meldung: "von liegt nach bis" }]);
      const daten = await lese(db, async (tx) => {
        const b = await ladeBeteiligung(tx, id);
        const ausgewaehlt = await tx.select({ schluessel: fondsKennzahl.schluessel }).from(fondsKennzahl).where(eq(fondsKennzahl.fondsId, b.fondsId));
        const zeilen = await tx
          .select({ w: kennzahlWert, schluessel: kennzahlDefinition.schluessel })
          .from(kennzahlWert)
          .innerJoin(kennzahlDefinition, eq(kennzahlDefinition.id, kennzahlWert.definitionId))
          .where(and(eq(kennzahlWert.beteiligungId, id), gte(kennzahlWert.periodeBeginn, vonTag), lte(kennzahlWert.periodeEnde, bisTag), isNull(kennzahlWert.verworfenAm)));
        const alsZeile = (z: (typeof zeilen)[number]): KpiZeile & { w: typeof kennzahlWert.$inferSelect } => ({
          id: z.w.id,
          schluessel: z.schluessel,
          periodeBeginn: z.w.periodeBeginn,
          periodeEnde: z.w.periodeEnde,
          szenario: z.w.szenario,
          wert: z.w.wert,
          status: z.w.status,
          bestaetigtAm: z.w.bestaetigtAm,
          folge: z.w.folge,
          w: z.w,
        });
        const alle = zeilen.map(alsZeile);
        const geltend = [...geltendeWerte(alle, stand).values()];
        const schluessel = [...new Set([...geltend.map((g) => g.schluessel), ...alle.filter((z) => z.status !== "bestaetigt").map((z) => z.schluessel), ...ausgewaehlt.map((a) => a.schluessel)])];
        const definitionen = await ladeNeueste(tx, schluessel);
        const reihen = schluessel
          .map((s) => definitionen.get(s))
          .filter((d): d is KennzahlDefinition => d !== undefined)
          .sort((a, x) => a.reihenfolge - x.reihenfolge || a.schluessel.localeCompare(x.schluessel))
          .map((d) => {
            const meine = geltend.filter((g) => g.schluessel === d.schluessel);
            const nachZeitraum = new Map<string, typeof meine>();
            for (const g of meine) {
              const k = `${g.periodeBeginn}|${g.periodeEnde}`;
              nachZeitraum.set(k, [...(nachZeitraum.get(k) ?? []), g]);
            }
            const punkte = [...nachZeitraum.entries()]
              .filter(([, gruppe]) => !szenario || gruppe.some((g) => g.szenario === szenario))
              .sort(([a], [x]) => a.localeCompare(x))
              .map(([, gruppe]) => {
                // Mit `szenario` zeigt die Antwort nur dieses; die Abweichung Ist gegen Plan bleibt bei `ist` (sie braucht den Plan) und entfällt sonst.
                const wertVon = (sz: string) => {
                  if (szenario && szenario !== sz) return null;
                  const g = gruppe.find((x) => x.szenario === sz);
                  return g ? { id: g.id, wert: g.wert, quelle: g.w.quelle, bestaetigtAm: g.bestaetigtAm, kommentar: g.w.kommentar, geschaetzt: g.w.geschaetzt, quellenangabe: g.w.quellenangabe } : null;
                };
                const ist = gruppe.find((x) => x.szenario === "ist");
                const plan = gruppe.find((x) => x.szenario === "plan");
                const abw = ist && plan && (!szenario || szenario === "ist") ? kpiAbweichung(d.typ as KpiTyp, ist.wert, plan.wert) : null;
                return {
                  periodeBeginn: gruppe[0]!.periodeBeginn,
                  periodeEnde: gruppe[0]!.periodeEnde,
                  ist: wertVon("ist"),
                  plan: wertVon("plan"),
                  forecast: wertVon("forecast"),
                  abweichung: abw?.wert ? { absolut: abw.wert.absolut.toString(), prozent: abw.wert.prozent === null ? null : abw.wert.prozent.toFixed(2), schritte: abw.schritte } : null,
                };
              });
            // Verdichtung über alle Ist-Werte gleicher Zeitraumlänge im Bereich (z. B. Quartale zur Jahressumme) nur bei Zahlenkennzahlen.
            // Nur Zeiträume der feinsten vorhandenen Länge (Quartalswerte und ein Jahreswert, der sie überdeckt, zählen nicht doppelt).
            const istAlle = meine.filter((g) => g.szenario === "ist");
            const feinste = istAlle.map((g) => kpiPeriodenart(g.periodeBeginn, g.periodeEnde)).sort((a, b) => ({ monat: 0, quartal: 1, jahr: 2 })[a ?? "jahr"] - ({ monat: 0, quartal: 1, jahr: 2 })[b ?? "jahr"])[0];
            const istWerte = istAlle.filter((g) => kpiPeriodenart(g.periodeBeginn, g.periodeEnde) === feinste);
            const verdichtung = d.typ === "betrag" || d.typ === "zahl" || d.typ === "prozent" ? kpiVerdichte(d.aggregation, istWerte) : null;
            return {
              ...definitionAntwort(d),
              angefordert: ausgewaehlt.some((a) => a.schluessel === d.schluessel),
              punkte,
              verdichtung: verdichtung?.wert ? { wert: verdichtung.wert.toString(), schritte: verdichtung.schritte, zeitraeume: istWerte.length } : null,
            };
          });
        const offenDefs = await ladeNeueste(tx, [...new Set(alle.filter((z) => z.status !== "bestaetigt").map((z) => z.schluessel))]);
        const offen = alle
          .filter((z) => z.status !== "bestaetigt")
          .map((z) => ({ ...z.w, schluessel: z.schluessel, bezeichnungDe: offenDefs.get(z.schluessel)?.bezeichnungDe ?? z.schluessel, bezeichnungEn: offenDefs.get(z.schluessel)?.bezeichnungEn ?? z.schluessel, typ: offenDefs.get(z.schluessel)?.typ ?? "text" }))
          .sort((a, x) => a.periodeBeginn.localeCompare(x.periodeBeginn) || a.schluessel.localeCompare(x.schluessel));
        return { beteiligungId: id, fondsId: b.fondsId, von: vonTag, bis: bisTag, stand: stand ?? null, kennzahlen: reihen, offen };
      });
      return c.json(daten, 200);
    })
    /** Legt einen Wert als Entwurf an. Eine Korrektur eines bestätigten Wertes ist ein neuer Wert für denselben Zeitraum. */
    .post("/kennzahlen/werte", pruefe("param", idParam), pruefe("json", neuerWertSchema), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await ladeBeteiligung(tx, id);
        const d = await geltendeDefinition(tx, e.schluessel, e.periodeEnde);
        pruefeZeitraum(e.periodeBeginn, e.periodeEnde, d);
        const wert = kanonischerWert(d.typ, e.wert);
        // Offene Einträge gleicher Kennzahl, Zeitraum und Szenario aus eigener Eingabe: bitte den vorhandenen ändern.
        const { rows: offen } = await tx.execute<{ id: string }>(sql`
          SELECT w.id FROM kennzahl_wert w JOIN kennzahl_definition k ON k.id = w.definition_id
          WHERE w.beteiligung_id = ${id} AND k.schluessel = ${e.schluessel} AND w.periode_beginn = ${e.periodeBeginn}::date AND w.periode_ende = ${e.periodeEnde}::date
            AND w.szenario = ${e.szenario} AND w.quelle = 'intern' AND w.status <> 'bestaetigt' AND w.verworfen_am IS NULL`);
        if (offen[0]) throw new Fachfehler(409, "KENNZAHL_WERT_OFFEN_VORHANDEN", "Für diesen Zeitraum gibt es schon einen offenen Wert; bitte den vorhandenen ändern.", { wertId: offen[0].id });
        const [zeile] = await tx
          .insert(kennzahlWert)
          .values({ beteiligungId: id, definitionId: d.id, periodeBeginn: e.periodeBeginn, periodeEnde: e.periodeEnde, szenario: e.szenario, wert, quelle: "intern", erfasstVon: protokoll.akteur, status: "entwurf", kommentar: e.kommentar ?? null, geschaetzt: e.geschaetzt ?? false, quellenangabe: e.quellenangabe ?? null })
          .returning();
        await protokoll("anlegen", "kennzahl_wert", zeile!.id, null, zeile);
        return zeile!;
      });
      return c.json(neu, 201);
    })
    .get("/kennzahlen/abfragen", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        await ladeBeteiligung(tx, id);
        return abfrageListe(tx, eq(kennzahlAbfrage.beteiligungId, id));
      });
      return c.json({ daten }, 200);
    })
    /** Legt eine Anfrage an das Unternehmen an und gibt den Link einmalig aus (nur der Hash wird gespeichert). */
    .post("/kennzahlen/abfragen", pruefe("param", idParam), pruefe("json", neueAbfrageSchema), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const token = neuesToken();
      const ablauf = new Date(Date.now() + e.gueltigTage * TAGE_MS);
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const b = await ladeBeteiligung(tx, id);
        pruefeZeitraum(e.periodeBeginn, e.periodeEnde);
        if (e.faelligAm < heuteIso()) throw new Fachfehler(400, "ABFRAGE_FAELLIG_VERGANGEN", "Das Fälligkeitsdatum liegt in der Vergangenheit.");
        const art = pruefeZeitraum(e.periodeBeginn, e.periodeEnde);
        let schluessel = e.schluessel;
        if (!schluessel) {
          // Ohne Angabe gilt die Auswahl des Fonds, soweit sie zum Zeitraum passt (eine Jahreskennzahl wird nicht für ein Quartal erfragt).
          const ausgewaehlt = (await tx.select({ s: fondsKennzahl.schluessel }).from(fondsKennzahl).where(eq(fondsKennzahl.fondsId, b.fondsId)).orderBy(asc(fondsKennzahl.reihenfolge), asc(fondsKennzahl.schluessel))).map((x) => x.s);
          schluessel = [];
          for (const s of ausgewaehlt) {
            const d = await geltendeDefinition(tx, s, e.periodeEnde).catch((f: unknown) => (f instanceof Fachfehler && f.status === 404 ? null : Promise.reject(f)));
            if (d && kpiZeitraumPasst(art, d.periodizitaet)) schluessel.push(s);
          }
        }
        if (schluessel.length === 0) throw new Fachfehler(400, "ABFRAGE_OHNE_KENNZAHLEN", "Für diesen Zeitraum ist keine Kennzahl des Fonds anzufragen; bitte Kennzahlen angeben oder die Auswahl des Fonds ändern.");
        if (new Set(schluessel).size !== schluessel.length) throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", { felder: [{ feld: "schluessel", code: "custom", meldung: "Einträge doppelt" }] });
        const definitionen: KennzahlDefinition[] = [];
        for (const s of schluessel) {
          const d = await geltendeDefinition(tx, s, e.periodeEnde);
          pruefeZeitraum(e.periodeBeginn, e.periodeEnde, d);
          definitionen.push(d);
        }
        const [vorhanden] = await tx
          .select({ id: kennzahlAbfrage.id })
          .from(kennzahlAbfrage)
          .where(and(eq(kennzahlAbfrage.beteiligungId, id), eq(kennzahlAbfrage.art, "kennzahlen"), eq(kennzahlAbfrage.periodeBeginn, e.periodeBeginn), eq(kennzahlAbfrage.periodeEnde, e.periodeEnde), inArray(kennzahlAbfrage.status, ["offen", "eingereicht"])));
        if (vorhanden) throw new Fachfehler(409, "ABFRAGE_VORHANDEN", "Für diesen Zeitraum gibt es schon eine laufende Anfrage.", { abfrageId: vorhanden.id });
        const [zeile] = await tx
          .insert(kennzahlAbfrage)
          .values({ beteiligungId: id, periodeBeginn: e.periodeBeginn, periodeEnde: e.periodeEnde, faelligAm: e.faelligAm, sprache: e.sprache, hinweis: e.hinweis ?? null, tokenHash: tokenHash(token), tokenAblauf: ablauf, erstelltVon: protokoll.akteur })
          .returning();
        await tx.insert(kennzahlAbfragePosition).values(definitionen.map((d) => ({ abfrageId: zeile!.id, definitionId: d.id })));
        await protokoll("anlegen", "kennzahl_abfrage", zeile!.id, null, { ...ohneToken(zeile!), schluessel });
        if (e.empfaengerPersonId) {
          await sendeKennzahlLink(tx, protokoll, c.get("mail"), {
            abfrageId: zeile!.id, beteiligungId: id, personId: e.empfaengerPersonId, sprache: e.sprache, linkPfad: linkAntwort(token, ablauf).pfad,
            periodeBeginn: e.periodeBeginn, periodeEnde: e.periodeEnde, faelligAm: e.faelligAm, hinweis: e.hinweis ?? null,
          });
        }
        return zeile!;
      });
      return c.json({ abfrage: ohneToken(ergebnis), link: linkAntwort(token, ablauf) }, 201);
    });
}

type AbfrageBedingung = SQL | undefined;

/** Anfragen mit Unternehmen, Zahl der Kennzahlen und Erinnerung (`ueberfaellig` oder `bald` innerhalb von sieben Tagen) für offene. */
export async function abfrageListe(tx: Tx, bedingung: AbfrageBedingung) {
  const zeilen = await tx
    .select({ a: kennzahlAbfrage, organisation: organisation.name, anzahl: sql<number>`(SELECT count(*)::int FROM kennzahl_abfrage_position p WHERE p.abfrage_id = ${kennzahlAbfrage.id})` })
    .from(kennzahlAbfrage)
    .innerJoin(beteiligung, eq(beteiligung.id, kennzahlAbfrage.beteiligungId))
    .innerJoin(organisation, eq(organisation.id, beteiligung.organisationId))
    .where(bedingung)
    .orderBy(desc(kennzahlAbfrage.periodeEnde), asc(organisation.name), asc(kennzahlAbfrage.id));
  const tag = heuteIso();
  const inSiebenTagen = new Date(Date.parse(`${tag}T00:00:00Z`) + 7 * TAGE_MS).toISOString().slice(0, 10);
  return zeilen.map((z) => ({
    ...ohneToken(z.a),
    organisation: z.organisation,
    anzahlKennzahlen: z.anzahl,
    abgelaufen: z.a.status === "offen" && z.a.tokenAblauf.getTime() < Date.now(),
    erinnerung: z.a.status !== "offen" ? null : z.a.faelligAm < tag ? ("ueberfaellig" as const) : z.a.faelligAm <= inSiebenTagen ? ("bald" as const) : null,
  }));
}

// Unter /fonds/:id ---------------------------------------------------------------------------------------------------------------

/** Anzahl der Zeilen und Zähler, damit die Übersicht ohne zweite Abfrage auskommt. */
export function fondsKennzahlRouten(db: Db) {
  return new Hono()
    .get("/kennzahlen/auswahl", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        const zeilen = await tx.select().from(fondsKennzahl).where(eq(fondsKennzahl.fondsId, id)).orderBy(asc(fondsKennzahl.reihenfolge), asc(fondsKennzahl.schluessel));
        const aktuell = new Map((await ladeAktuelle(tx)).map((d) => [d.schluessel, d]));
        const neueste = await ladeNeueste(tx, zeilen.map((z) => z.schluessel));
        return zeilen.map((z) => ({ schluessel: z.schluessel, reihenfolge: z.reihenfolge, gueltig: aktuell.has(z.schluessel), definition: definitionAntwort(aktuell.get(z.schluessel) ?? neueste.get(z.schluessel)!) }));
      });
      return c.json({ daten }, 200);
    })
    /** Ersetzt die Auswahl des Fonds (Reihenfolge = Reihenfolge der Liste). */
    .put("/kennzahlen/auswahl", pruefe("param", idParam), pruefe("json", auswahlSchema), async (c) => {
      const { id } = c.req.valid("param");
      const { schluessel } = c.req.valid("json");
      if (new Set(schluessel).size !== schluessel.length) return fehlerAntwort(c, 400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", [{ feld: "schluessel", code: "custom", meldung: "Einträge doppelt" }]);
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        const aktuell = new Set((await ladeAktuelle(tx)).map((d) => d.schluessel));
        const unbekannt = schluessel.filter((s) => !aktuell.has(s));
        if (unbekannt.length) throw new Fachfehler(404, "KENNZAHL_NICHT_GEFUNDEN", `Die Kennzahl „${unbekannt[0]}“ gibt es im Katalog nicht (oder sie gilt nicht mehr).`, { schluessel: unbekannt });
        const vorher = (await tx.select().from(fondsKennzahl).where(eq(fondsKennzahl.fondsId, id)).orderBy(asc(fondsKennzahl.reihenfolge))).map((z) => z.schluessel);
        await tx.delete(fondsKennzahl).where(eq(fondsKennzahl.fondsId, id));
        if (schluessel.length) await tx.insert(fondsKennzahl).values(schluessel.map((s, i) => ({ fondsId: id, schluessel: s, reihenfolge: i })));
        await protokoll("aendern", "fonds_kennzahl", id, { schluessel: vorher }, { schluessel });
        return schluessel;
      });
      return c.json({ schluessel: nachher }, 200);
    })
    /** Anfragen des Fonds mit Status je Unternehmen und Erinnerungen. */
    .get("/kennzahlen/abfragen", pruefe("param", idParam, { query: abfrageListeAbfrage }), pruefe("query", abfrageListeAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { status } = c.req.valid("query");
      const daten = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        return abfrageListe(tx, and(eq(beteiligung.fondsId, id), status ? eq(kennzahlAbfrage.status, status) : undefined));
      });
      return c.json({ daten }, 200);
    })
    /**
     * Vollständigkeit je Unternehmen für einen Zeitraum (`periode` = `JJJJ`, `JJJJ-Qn` oder `JJJJ-MM`): angefordert sind die ausgewählten
     * Kennzahlen, deren Erhebung nicht gröber als der Zeitraum ist; eingereicht zählt, was eingereicht oder bestätigt ist, bestätigt, was ein
     * bestätigter Ist-Wert für genau diesen Zeitraum hat.
     */
    .get("/kennzahlen/uebersicht", pruefe("param", idParam, { query: uebersichtAbfrage }), pruefe("query", uebersichtAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const zeitraum = kpiZeitraumAus(c.req.valid("query").periode);
      if (!zeitraum) return fehlerAntwort(c, 400, "KENNZAHL_PERIODE_UNGUELTIG", "Der Zeitraum muss ein ganzer Kalendermonat, ein Kalenderquartal oder ein Kalenderjahr sein (JJJJ, JJJJ-Qn oder JJJJ-MM).");
      const daten = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        return uebersicht(tx, id, zeitraum);
      });
      return c.json(daten, 200);
    });
}

async function uebersicht(tx: Tx, fondsId: string, zeitraum: { beginn: string; ende: string; art: string }) {
  const ausgewaehlt = await tx.select({ schluessel: fondsKennzahl.schluessel }).from(fondsKennzahl).where(eq(fondsKennzahl.fondsId, fondsId)).orderBy(asc(fondsKennzahl.reihenfolge), asc(fondsKennzahl.schluessel));
  const defs: KennzahlDefinition[] = [];
  for (const a of ausgewaehlt) {
    const d = await geltendeDefinition(tx, a.schluessel, zeitraum.ende).catch((e: unknown) => {
      if (e instanceof Fachfehler && e.status === 404) return null;
      throw e;
    });
    if (d && (zeitraum.art === "jahr" || (zeitraum.art === "quartal" && d.periodizitaet !== "jahr") || (zeitraum.art === "monat" && d.periodizitaet === "monat"))) defs.push(d);
  }
  const unternehmen = await tx
    .select({ id: beteiligung.id, organisation: organisation.name, organisationId: beteiligung.organisationId })
    .from(beteiligung)
    .innerJoin(organisation, eq(organisation.id, beteiligung.organisationId))
    .where(and(eq(beteiligung.fondsId, fondsId), eq(beteiligung.status, "aktiv")))
    .orderBy(asc(organisation.name), asc(beteiligung.id));
  const werte = defs.length
    ? await tx
        .select({ w: kennzahlWert, schluessel: kennzahlDefinition.schluessel })
        .from(kennzahlWert)
        .innerJoin(kennzahlDefinition, eq(kennzahlDefinition.id, kennzahlWert.definitionId))
        .innerJoin(beteiligung, eq(beteiligung.id, kennzahlWert.beteiligungId))
        .where(and(eq(beteiligung.fondsId, fondsId), eq(kennzahlWert.periodeBeginn, zeitraum.beginn), eq(kennzahlWert.periodeEnde, zeitraum.ende), eq(kennzahlWert.szenario, "ist"), isNull(kennzahlWert.verworfenAm), inArray(kennzahlDefinition.schluessel, defs.map((d) => d.schluessel))))
    : [];
  const abfragen = await abfrageListe(tx, and(eq(beteiligung.fondsId, fondsId), eq(kennzahlAbfrage.art, "kennzahlen"), eq(kennzahlAbfrage.periodeBeginn, zeitraum.beginn), eq(kennzahlAbfrage.periodeEnde, zeitraum.ende)));
  const zeilen = unternehmen.map((u) => {
    const meine = werte.filter((x) => x.w.beteiligungId === u.id);
    const bestaetigt = defs.filter((d) => meine.some((x) => x.schluessel === d.schluessel && x.w.status === "bestaetigt"));
    const eingereicht = defs.filter((d) => meine.some((x) => x.schluessel === d.schluessel && (x.w.status === "bestaetigt" || x.w.status === "eingereicht")));
    const abfrage = abfragen.find((a) => a.beteiligungId === u.id && a.status !== "widerrufen") ?? abfragen.find((a) => a.beteiligungId === u.id) ?? null;
    return {
      beteiligungId: u.id,
      organisation: u.organisation,
      organisationId: u.organisationId,
      angefordert: defs.length,
      eingereicht: eingereicht.length,
      bestaetigt: bestaetigt.length,
      fehlend: defs.filter((d) => !bestaetigt.includes(d)).map((d) => d.schluessel),
      abfrage: abfrage ? { id: abfrage.id, status: abfrage.status, faelligAm: abfrage.faelligAm, erinnerung: abfrage.erinnerung, abgelaufen: abfrage.abgelaufen } : null,
    };
  });
  return {
    fondsId,
    periode: { beginn: zeitraum.beginn, ende: zeitraum.ende, art: zeitraum.art },
    kennzahlen: defs.map(definitionAntwort),
    unternehmen: zeilen,
    summe: { angefordert: zeilen.reduce((s, z) => s + z.angefordert, 0), eingereicht: zeilen.reduce((s, z) => s + z.eingereicht, 0), bestaetigt: zeilen.reduce((s, z) => s + z.bestaetigt, 0) },
  };
}
