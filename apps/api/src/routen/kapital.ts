import { portfolioAnApi } from "../portfolio-vertrag";
import { pruefePortfolio } from "../portfolio-pruefung";
import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { anteilsklasse, finanzierungsrunde, rundenposition, type Db } from "@carraway/db";
import { Decimal, wasserfall, wasserfallKnicke, wasserfallKurve, type Rechenschritt } from "@carraway/rechenkern";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { Fachfehler, type Feldfehler } from "../fehler";
import { ladeOffeneWandlungen, type OffeneWandlungen } from "../kapital/offene-wandlungen";
import { entschaerfeZeilen, fasseWasserfallZusammen, rechenwegHeikel, schritteFuerAnsicht, sichtbarFuer, verdeckeKapital, verdeckeZuteilungen, verdeckteZeilen, zuteilungenVerdeckt } from "../kapital/sichtbarkeit";
import { siehtEinzelzuteilungen } from "./mitarbeiterbeteiligung";
import { standardSicht } from "../kapital/sicht";
import { anteilBruch, kernEingabe, ladeBeteiligungKurz, ladeKapital, STAMM_ID, type Halter, type Kapital, type KlasseZeile, type MitarbeiterZeile, type OptionsscheinZeile } from "../kapital/wasserfall";
import { heute, idParam, ladeOrganisation, MINDESTENS_EIN_FELD, mindestensEins, nurGesetzte, schreibe, textEingabe, type Protokollant } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";

/**
 * Anteilsklassen, Kapitaltabelle und Exit-Wasserfall (Etappe 10). Die Berechtigungstabelle ordnet die Routen ein: Klassen lesen =
 * betrachter, anlegen und ändern = bearbeiter (jeweils an einem Fonds, der eine Beteiligung an der Organisation hält), Kapitaltabelle,
 * Wasserfall und Kurve = betrachter an der Beteiligung (reine Berechnung, es wird nichts geschrieben).
 */

/** Höchstzahl der Punkte der Kurve und Faktor auf die Post-Money-Bewertung der letzten Runde für den größten Exitwert. */
export const MAX_KURVENPUNKTE = 200;
export const MAX_EXIT_FAKTOR = 100;

const faktorEingabe = z.string().regex(/^\d{1,4}(\.\d{1,4})?$/, "Expected a factor from zero with at most four decimal places");
/** Zinssatz je Jahr als Bruch zwischen 0 und 1 (`0.08` = 8 %). */
const zinsEingabe = z.string().regex(/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/, "Expected a fraction from 0 to 1 with at most six decimal places");
const betragNullEingabe = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, "Expected an amount from zero with at most two decimal places");
/** Treuhandanteil: Bruch von 0 bis unter 1. */
const treuhandEingabe = z.string().regex(/^0(\.\d{1,4})?$/, "Expected a fraction from 0 to below 1 with at most four decimal places");

const klasseBasis = {
  name: textEingabe(100),
  rang: z.number().int().min(1).max(20),
  praeferenzFaktor: faktorEingabe,
  partizipierend: z.boolean(),
  capFaktor: faktorEingabe.nullable(),
  kumulierteVerzinsung: zinsEingabe.nullable(),
  umwandelbar: z.boolean(),
};
export const neueKlasse = z.object({
  name: klasseBasis.name,
  rang: klasseBasis.rang.default(1),
  praeferenzFaktor: klasseBasis.praeferenzFaktor.default("1"),
  partizipierend: klasseBasis.partizipierend.default(false),
  capFaktor: klasseBasis.capFaktor.optional(),
  kumulierteVerzinsung: klasseBasis.kumulierteVerzinsung.optional(),
  umwandelbar: klasseBasis.umwandelbar.default(true),
});
const klasseAenderung = z
  .object({
    name: klasseBasis.name.optional(),
    rang: klasseBasis.rang.optional(),
    praeferenzFaktor: klasseBasis.praeferenzFaktor.optional(),
    partizipierend: klasseBasis.partizipierend.optional(),
    capFaktor: klasseBasis.capFaktor.optional(),
    kumulierteVerzinsung: klasseBasis.kumulierteVerzinsung.optional(),
    umwandelbar: klasseBasis.umwandelbar.optional(),
  })
  .refine(mindestensEins, MINDESTENS_EIN_FELD);
const klassenParam = z.object({ id: z.uuid(), klasseId: z.uuid() });

function ungueltig(felder: Feldfehler[]): never {
  throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder });
}

/** Regeln über mehrere Felder: Ein Cap gibt es nur bei partizipierenden Klassen und nicht unter dem Präferenzfaktor. */
function pruefeKlasse(k: { partizipierend: boolean; praeferenzFaktor: string; capFaktor: string | null }) {
  const felder: Feldfehler[] = [];
  if (k.capFaktor !== null && !k.partizipierend) felder.push({ feld: "capFaktor", code: "cap_without_participation", meldung: "A cap only exists for participating classes" });
  if (k.capFaktor !== null && new Decimal(k.capFaktor).lessThan(k.praeferenzFaktor)) felder.push({ feld: "capFaktor", code: "cap_below_preference", meldung: "The cap must not be below the preference factor" });
  if (felder.length) ungueltig(felder);
}

const klasseAntwort = (k: KlasseZeile, verwendet?: number) => ({
  id: k.id,
  organisationId: k.organisationId,
  name: k.name,
  rang: k.rang,
  praeferenzFaktor: k.praeferenzFaktor,
  partizipierend: k.partizipierend,
  capFaktor: k.capFaktor,
  kumulierteVerzinsung: k.kumulierteVerzinsung,
  umwandelbar: k.umwandelbar,
  ...(verwendet === undefined ? {} : { verwendet }),
});

async function pruefeNameFrei(tx: Tx, organisationId: string, name: string, ausser?: string) {
  const [vorhanden] = await tx.select({ id: anteilsklasse.id }).from(anteilsklasse).where(and(eq(anteilsklasse.organisationId, organisationId), eq(anteilsklasse.name, name)));
  if (vorhanden && vorhanden.id !== ausser) throw new Fachfehler(409, "share_class_name_exists", "This organization already has a class with this name.");
}

/** Legt eine Anteilsklasse an (Route und Bestätigung einer Auslesung); die Rechte prüft der Aufrufer. */
export async function legeKlasseAn(tx: Tx, protokoll: Protokollant, organisationId: string, e: z.infer<typeof neueKlasse>): Promise<KlasseZeile> {
  const capFaktor = e.capFaktor ?? null;
  pruefeKlasse({ partizipierend: e.partizipierend, praeferenzFaktor: e.praeferenzFaktor, capFaktor });
  await ladeOrganisation(tx, organisationId);
  await pruefeNameFrei(tx, organisationId, e.name);
  const [zeile] = await tx
    .insert(anteilsklasse)
    .values({ organisationId, name: e.name, rang: e.rang, praeferenzFaktor: e.praeferenzFaktor, partizipierend: e.partizipierend, capFaktor, kumulierteVerzinsung: e.kumulierteVerzinsung ?? null, umwandelbar: e.umwandelbar })
    .returning();
  await protokoll("anlegen", "anteilsklasse", zeile!.id, null, zeile);
  return zeile!;
}

/** Mount unter `/organisationen/:id`. */
export function organisationAnteilsklassenRouten(db: Db) {
  return new Hono()
    .get("/share-classes", pruefePortfolio("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        await ladeOrganisation(tx, id);
        const klassen = await tx.select().from(anteilsklasse).where(eq(anteilsklasse.organisationId, id)).orderBy(asc(anteilsklasse.rang), asc(anteilsklasse.name));
        const zaehler = await tx
          .select({ klasse: rundenposition.anteilsklasseId, anzahl: sql<number>`count(*)::int` })
          .from(rundenposition)
          .innerJoin(finanzierungsrunde, eq(finanzierungsrunde.id, rundenposition.rundeId))
          .where(eq(finanzierungsrunde.organisationId, id))
          .groupBy(rundenposition.anteilsklasseId);
        return klassen.map((k) => klasseAntwort(k, zaehler.find((z) => z.klasse === k.id)?.anzahl ?? 0));
      });
      return c.json(portfolioAnApi({ daten }), 200);
    })
    .post("/share-classes", pruefePortfolio("param", idParam), pruefePortfolio("json", neueKlasse), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const neu = await schreibe(db, c, (tx, protokoll) => legeKlasseAn(tx, protokoll, id, e));
      return c.json(portfolioAnApi(klasseAntwort(neu)), 201);
    })
    .patch("/share-classes/:classId", pruefePortfolio("param", klassenParam), pruefePortfolio("json", klasseAenderung), async (c) => {
      const { id, klasseId } = c.req.valid("param");
      const e = c.req.valid("json");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const [vorher] = await tx.select().from(anteilsklasse).where(and(eq(anteilsklasse.id, klasseId), eq(anteilsklasse.organisationId, id))).for("update");
        if (!vorher) throw new Fachfehler(404, "share_class_not_found", "Share class not found.");
        const werte = nurGesetzte(e);
        const zusammen = { ...vorher, ...werte };
        pruefeKlasse({ partizipierend: zusammen.partizipierend, praeferenzFaktor: zusammen.praeferenzFaktor, capFaktor: zusammen.capFaktor ?? null });
        if (e.name !== undefined) await pruefeNameFrei(tx, id, e.name, klasseId);
        const [neu] = await tx.update(anteilsklasse).set(werte).where(eq(anteilsklasse.id, klasseId)).returning();
        await protokoll("aendern", "anteilsklasse", klasseId, vorher, neu);
        return neu!;
      });
      return c.json(portfolioAnApi(klasseAntwort(nachher)), 200);
    });
}

const positionAenderung = z.object({ anteilsklasseId: z.uuid().nullable() });

/** Mount unter `/rundenpositionen`: Klasse einer Position setzen oder entfernen (Stammanteile). */
export function rundenpositionRouten(db: Db) {
  return new Hono().patch("/:id", pruefePortfolio("param", idParam), pruefePortfolio("json", positionAenderung), async (c) => {
    const { id } = c.req.valid("param");
    const { anteilsklasseId } = c.req.valid("json");
    const nachher = await schreibe(db, c, async (tx, protokoll) => {
      const [zeile] = await tx
        .select({ p: rundenposition, organisationId: finanzierungsrunde.organisationId })
        .from(rundenposition)
        .innerJoin(finanzierungsrunde, eq(finanzierungsrunde.id, rundenposition.rundeId))
        .where(eq(rundenposition.id, id))
        .for("update", { of: rundenposition });
      if (!zeile) throw new Fachfehler(404, "round_position_not_found", "Round position not found.");
      if (anteilsklasseId !== null) {
        const [k] = await tx.select().from(anteilsklasse).where(eq(anteilsklasse.id, anteilsklasseId));
        if (!k) throw new Fachfehler(404, "share_class_not_found", "Share class not found.");
        if (k.organisationId !== zeile.organisationId) throw new Fachfehler(409, "share_class_mismatch", "The class belongs to a different company than the round.");
      }
      const [neu] = await tx.update(rundenposition).set({ anteilsklasseId }).where(eq(rundenposition.id, id)).returning();
      await protokoll("aendern", "rundenposition", id, zeile.p, neu);
      return neu!;
    });
    return c.json(portfolioAnApi(nachher), 200);
  });
}

// Kapitaltabelle und Wasserfall -----------------------------------------------------------------------------------------------

const kapitalAbfrage = z.object({
  stichtag: z.iso.date().optional(),
  /** `true`: voll verwässert inklusive der geschätzten Anteile aus offenen Wandlungen (Zeilen mit `halter.art = "wandlung"`). */
  offeneWandlungen: z.enum(["true", "false"]).optional(),
});
const wasserfallEingabe = z.object({
  exitwert: betragNullEingabe,
  exitdatum: z.iso.date(),
  kosten: betragNullEingabe.optional(),
  treuhandAnteil: treuhandEingabe.optional(),
});
const kurveAbfrage = z.object({
  bis: z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, "Expected an amount greater than zero with at most two decimal places").optional(),
  punkte: z
    .string()
    .regex(/^\d{1,3}$/, "Expected an integer from 2 to 200")
    .optional(),
  exitdatum: z.iso.date().optional(),
});

const geld = (d: Decimal) => d.toFixed(2);
const mal = (d: Decimal | null) => (d === null ? null : d.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4));

function klassenName(k: Kapital, id: string | null): string | null {
  return id === null ? null : (k.klassen.find((x) => x.id === id)?.name ?? null);
}

/**
 * Kapitaltabelle in beiden Sichten: Jede Zeile hat ihren Anteil unverwässert (nur ausgegebene Anteile, beim Pool `null`) und voll verwässert
 * (mit dem Pool der Mitarbeiterbeteiligung). `standardSicht` sagt, welche Sicht die Oberfläche zuerst zeigt (je Installation).
 * `offeneWandlungen` listet die Schätzungen offener Wandlungen immer; mit `mitWandlungen` kommen die geschätzten Anteile als eigene Zeilen
 * (nicht ausgegeben) hinzu und die voll verwässerten Anteile beziehen sich auf die Gesamtzahl einschließlich dieser Schätzungen.
 */
function kapitalAntwort(basis: Kapital, beteiligungId: string, wandlungen: OffeneWandlungen, mitWandlungen: boolean) {
  const wandlungsZeilen: Kapital["zeilen"] = mitWandlungen
    ? wandlungen.liste
        .filter((w) => w.anteile !== null)
        .map((w) => ({ id: `wandlung:${w.instrumentId}`, halter: { art: "wandlung", id: w.instrumentId, name: `${w.fonds.name} · ${w.bezeichnung}`, vehikel: null }, klasseId: null, runde: null, anteile: w.anteile!, investiert: "0.00", diesesFonds: w.diesesFonds, ausgegeben: false }))
    : [];
  const k: Kapital = { ...basis, zeilen: [...basis.zeilen, ...wandlungsZeilen] };
  const unverwaessert = new Decimal(k.anteileGesamt);
  const mitWandlungsAnteilen = new Decimal(k.anteileVollVerwaessert).plus(wandlungsZeilen.reduce((s, z) => s.plus(z.anteile), new Decimal(0)));
  const voll = mitWandlungsAnteilen;
  const summe = (zeilen: Kapital["zeilen"], feld: "anteile" | "investiert") => zeilen.reduce((s, z) => s.plus(z[feld]), new Decimal(0));
  const anteile = (wert: Decimal.Value, ausgegeben: boolean) => ({ anteilUnverwaessert: ausgegeben ? anteilBruch(wert, unverwaessert) : null, anteilVollVerwaessert: anteilBruch(wert, voll) });
  const gruppen: { art: "klasse" | "stamm" | "pool" | "wandlung" | "optionsschein"; id: string | null; mitglieder: Kapital["zeilen"] }[] = k.klassen.map((x) => ({ art: "klasse" as const, id: x.id, mitglieder: k.zeilen.filter((z) => z.klasseId === x.id && z.ausgegeben) }));
  const stamm = k.zeilen.filter((z) => z.klasseId === null && z.ausgegeben);
  if (stamm.length > 0) gruppen.push({ art: "stamm", id: null, mitglieder: stamm });
  const pool = k.zeilen.filter((z) => !z.ausgegeben && z.halter.art !== "wandlung" && z.halter.art !== "optionsschein");
  if (pool.length > 0) gruppen.push({ art: "pool", id: null, mitglieder: pool });
  const optionsscheine = k.zeilen.filter((z) => !z.ausgegeben && z.halter.art === "optionsschein");
  if (optionsscheine.length > 0) gruppen.push({ art: "optionsschein", id: null, mitglieder: optionsscheine });
  if (wandlungsZeilen.length > 0) gruppen.push({ art: "wandlung", id: null, mitglieder: wandlungsZeilen });
  const klassen = gruppen.map(({ art, id, mitglieder }) => {
    const klasse = id === null ? undefined : k.klassen.find((x) => x.id === id);
    const zahl = summe(mitglieder, "anteile");
    return {
      art,
      id,
      name: klasse?.name ?? null,
      rang: klasse?.rang ?? null,
      praeferenzFaktor: klasse?.praeferenzFaktor ?? null,
      partizipierend: klasse?.partizipierend ?? null,
      capFaktor: klasse?.capFaktor ?? null,
      kumulierteVerzinsung: klasse?.kumulierteVerzinsung ?? null,
      umwandelbar: klasse?.umwandelbar ?? null,
      anteile: zahl.toFixed(0),
      ...anteile(zahl, art !== "pool" && art !== "wandlung" && art !== "optionsschein"),
      investiert: geld(summe(mitglieder, "investiert")),
    };
  });
  const unser = k.zeilen.filter((z) => z.diesesFonds);
  // Gruppierung nach Inhaber: Fonds, Investor (über alle seine Vehikel) oder Stammanteile; nur Summen, der Wasserfall rechnet weiter je Position.
  const gruppe = new Map<string, Kapital["zeilen"]>();
  for (const z of k.zeilen) {
    const schluessel = `${z.halter.art}:${z.halter.id ?? ""}`;
    gruppe.set(schluessel, [...(gruppe.get(schluessel) ?? []), z]);
  }
  const inhaber = [...gruppe.values()].map((mitglieder) => {
    const erster = mitglieder[0]!;
    const zahl = summe(mitglieder, "anteile");
    const vehikel = new Map(mitglieder.flatMap((z) => (z.halter.vehikel ? [[z.halter.vehikel.id, z.halter.vehikel] as const] : [])));
    return {
      halter: { art: erster.halter.art, id: erster.halter.id, name: erster.halter.name },
      vehikel: [...vehikel.values()].sort((a, b) => a.name.localeCompare(b.name, "de")),
      positionen: erster.halter.art === "stamm" ? 0 : mitglieder.length,
      anteile: zahl.toFixed(0),
      ...anteile(zahl, erster.ausgegeben),
      investiert: geld(summe(mitglieder, "investiert")),
      diesesFonds: mitglieder.some((z) => z.diesesFonds),
      ausgegeben: erster.ausgegeben,
    };
  });
  return {
    beteiligungId,
    organisation: k.organisation,
    stichtag: k.stichtag,
    standardSicht: standardSicht(),
    letzteRunde: k.letzteRunde,
    /** Ausgegebene Anteile (unverwässert); gleich `anteileUnverwaessert`. */
    anteileGesamt: k.anteileGesamt,
    anteileUnverwaessert: k.anteileGesamt,
    anteileVollVerwaessert: k.anteileVollVerwaessert,
    /** Voll verwässert plus geschätzte Anteile aus offenen Wandlungen (gleich `anteileVollVerwaessert` ohne `mitWandlungen`); Bezug von `anteilVollVerwaessert`. */
    anteileMitWandlungen: mitWandlungsAnteilen.toFixed(0),
    mitWandlungen,
    /** Schätzungen je offenem Wandeldarlehen eines Fonds dieser Plattform, auch die offenen ohne Anteile. */
    offeneWandlungen: wandlungen,
    /** Gibt es einen Pool der Mitarbeiterbeteiligung, der die Sichten unterscheidet? */
    mitPool: pool.length > 0,
    /** Gibt es nicht ausgeübte Optionsscheine (voll verwässert)? */
    mitOptionsscheinen: optionsscheine.length > 0,
    klassen,
    zeilen: k.zeilen.map((z) => ({
      id: z.id,
      halter: z.halter,
      klasseId: z.klasseId,
      klasseName: klassenName(k, z.klasseId),
      runde: z.runde,
      anteile: new Decimal(z.anteile).toFixed(0),
      ...anteile(z.anteile, z.ausgegeben),
      investiert: geld(new Decimal(z.investiert)),
      diesesFonds: z.diesesFonds,
      ausgegeben: z.ausgegeben,
      /** Zeile aus einer Anteilsübertragung: Übertragung, Datum, Preis je Anteil, Kaufpreis und abgebende Zeile; `investiert` ist die mitgenommene Präferenzbasis. */
      uebertragung: z.uebertragung ? { id: z.uebertragung.id, datum: z.uebertragung.datum, preisJeAnteil: z.uebertragung.preisJeAnteil, kaufpreis: z.uebertragung.kaufpreis, quelleId: z.uebertragung.quelleId, schritte: z.uebertragung.schritte } : null,
    })),
    /** Je Inhaber (Fonds, Investor über alle Vehikel, Stammanteile, Pool) in der Reihenfolge des ersten Auftretens. */
    inhaber,
    diesesFonds: {
      anteile: summe(unser, "anteile").toFixed(0),
      anteilUnverwaessert: anteilBruch(summe(unser.filter((z) => z.ausgegeben), "anteile"), unverwaessert),
      anteilVollVerwaessert: anteilBruch(summe(unser, "anteile"), voll),
      investiert: geld(summe(unser, "investiert")),
    },
  };
}

/** Halter und Angaben einer Zeile des Wasserfalls: Position der Kapitaltabelle oder Zuteilung der Mitarbeiterbeteiligung. */
function wasserfallQuellen(k: Kapital) {
  const quellen = new Map<string, { halter: Halter; runde: Kapital["zeilen"][number]["runde"]; mitarbeiter: MitarbeiterZeile | null; optionsschein: OptionsscheinZeile | null }>();
  for (const z of k.zeilen) if (z.ausgegeben) quellen.set(z.id, { halter: z.halter, runde: z.runde, mitarbeiter: null, optionsschein: null });
  for (const m of k.mitarbeiter) quellen.set(m.id, { halter: { art: "mitarbeiter", id: m.pool.id, name: m.bezeichnung ?? m.pool.bezeichnung, vehikel: null }, runde: null, mitarbeiter: m, optionsschein: null });
  for (const o of k.optionsscheine) quellen.set(o.id, { halter: { art: "optionsschein", id: o.instrumentId, name: o.name, vehikel: null }, runde: null, mitarbeiter: null, optionsschein: o });
  return quellen;
}

type WasserfallWert = ReturnType<typeof wasserfall>["wert"];
type Quellen = ReturnType<typeof wasserfallQuellen>;

interface WasserfallKlasseAntwort {
  art: "klasse" | "stamm" | "mitarbeiter" | "optionsschein";
  id: string | null;
  name: string | null;
  rang: number | null;
  anteile: string;
  investiert: string;
  anspruch: string;
  praeferenz: string;
  beteiligung: string;
  gesamt: string;
  multiple: string | null;
  gewandelt: boolean;
  gedeckelt: boolean;
}

/** Klassen des Wasserfalls; die Mitarbeiterbeteiligung steht als eigene Gruppe neben den Stammanteilen (`art`). */
function klassenDesWasserfalls(klassen: WasserfallWert["klassen"], zeilen: WasserfallWert["zeilen"], quellen: Quellen, ausZeilen = false) {
  const summe = (liste: WasserfallWert["zeilen"], feld: "anteile" | "investiert" | "anspruch" | "praeferenz" | "beteiligung" | "gesamt") => liste.reduce((s, z) => s.plus(z[feld]), new Decimal(0));
  const gruppe = (art: "stamm" | "mitarbeiter" | "optionsschein", liste: WasserfallWert["zeilen"]): WasserfallKlasseAntwort => {
    const investiert = summe(liste, "investiert");
    const gesamt = summe(liste, "gesamt");
    return {
      art,
      id: null,
      name: null,
      rang: null,
      anteile: summe(liste, "anteile").toFixed(0),
      investiert: geld(investiert),
      anspruch: geld(summe(liste, "anspruch")),
      praeferenz: geld(summe(liste, "praeferenz")),
      beteiligung: geld(summe(liste, "beteiligung")),
      gesamt: geld(gesamt),
      multiple: mal(investiert.greaterThan(0) ? gesamt.div(investiert) : null),
      gewandelt: false,
      gedeckelt: liste.some((z) => z.gedeckelt),
    };
  };
  const aus: WasserfallKlasseAntwort[] = [];
  for (const k of klassen) {
    if (k.id === null) continue;
    if (ausZeilen) {
      // Mit entschärften verdeckten Zeilen: Summen aus den Zeilen, damit keine Einzelwerte verdeckter Zeilen aus der Differenz folgen.
      aus.push({ ...gruppe("stamm", zeilen.filter((z) => z.klasseId === k.id)), art: "klasse", id: k.id, name: k.name === "" ? null : k.name, rang: k.rang, gewandelt: k.gewandelt, gedeckelt: k.gedeckelt });
      continue;
    }
    aus.push({ art: "klasse", id: k.id, name: k.name === "" ? null : k.name, rang: k.rang, anteile: k.anteile.toFixed(0), investiert: geld(k.investiert), anspruch: geld(k.anspruch), praeferenz: geld(k.praeferenz), beteiligung: geld(k.beteiligung), gesamt: geld(k.gesamt), multiple: mal(k.multiple), gewandelt: k.gewandelt, gedeckelt: k.gedeckelt });
  }
  const stamm = zeilen.filter((z) => z.klasseId === null && !quellen.get(z.id)?.mitarbeiter && !quellen.get(z.id)?.optionsschein);
  const mitarbeiter = zeilen.filter((z) => quellen.get(z.id)?.mitarbeiter);
  const optionsscheine = zeilen.filter((z) => quellen.get(z.id)?.optionsschein);
  if (stamm.length > 0) aus.push(gruppe("stamm", stamm));
  if (mitarbeiter.length > 0) aus.push(gruppe("mitarbeiter", mitarbeiter));
  if (optionsscheine.length > 0) aus.push(gruppe("optionsschein", optionsscheine));
  return aus;
}

/** Summe der Mitarbeiterbeteiligung im Wasserfall: Einheiten (gevestet oder beschleunigt), davon im Geld, Rückfluss. */
function mitarbeiterSumme(zeilen: WasserfallWert["zeilen"], quellen: Quellen) {
  const liste = zeilen.filter((z) => quellen.get(z.id)?.mitarbeiter);
  if (liste.length === 0) return null;
  return {
    einheiten: liste.reduce((s, z) => s.plus(z.anteile), new Decimal(0)).toFixed(0),
    imGeld: liste.filter((z) => z.imGeld).reduce((s, z) => s.plus(z.anteile), new Decimal(0)).toFixed(0),
    gesamt: geld(liste.reduce((s, z) => s.plus(z.gesamt), new Decimal(0))),
  };
}

/**
 * Rückflüsse je Inhaber: Fonds, Investor (über alle seine Vehikel), Stammanteile oder Pool der Mitarbeiterbeteiligung (je Pool eine Gruppe).
 * Nur Summen der Zeilen; gerechnet wird weiter je Position. Reihenfolge des ersten Auftretens, wie `inhaber` der Kapitaltabelle.
 */
function inhaberDesWasserfalls(zeilen: WasserfallWert["zeilen"], quellen: Quellen, eigene: Set<string>) {
  const gruppen = new Map<string, WasserfallWert["zeilen"]>();
  for (const z of zeilen) {
    const h = quellen.get(z.id)!.halter;
    const schluessel = `${h.art}:${h.id ?? ""}`;
    gruppen.set(schluessel, [...(gruppen.get(schluessel) ?? []), z]);
  }
  const summe = (liste: WasserfallWert["zeilen"], feld: "anteile" | "investiert" | "praeferenz" | "beteiligung" | "gesamt" | "treuhand" | "sofort") => liste.reduce((s, z) => s.plus(z[feld]), new Decimal(0));
  return [...gruppen.values()].map((mitglieder) => {
    const erster = quellen.get(mitglieder[0]!.id)!;
    const h = erster.halter;
    const vehikel = new Map(mitglieder.flatMap((z) => { const v = quellen.get(z.id)!.halter.vehikel; return v ? [[v.id, v] as const] : []; }));
    const investiert = summe(mitglieder, "investiert");
    const gesamt = summe(mitglieder, "gesamt");
    return {
      halter: { art: h.art, id: h.id, name: erster.mitarbeiter ? erster.mitarbeiter.pool.bezeichnung : h.name },
      vehikel: [...vehikel.values()].sort((a, b) => a.name.localeCompare(b.name, "de")),
      positionen: h.art === "stamm" ? 0 : mitglieder.length,
      anteile: summe(mitglieder, "anteile").toFixed(0),
      investiert: geld(investiert),
      praeferenz: geld(summe(mitglieder, "praeferenz")),
      beteiligung: geld(summe(mitglieder, "beteiligung")),
      gesamt: geld(gesamt),
      treuhand: geld(summe(mitglieder, "treuhand")),
      sofort: geld(summe(mitglieder, "sofort")),
      multiple: mal(investiert.greaterThan(0) ? gesamt.div(investiert) : null),
      diesesFonds: mitglieder.some((z) => z.id !== STAMM_ID && eigene.has(z.id)),
    };
  });
}

function verlangeAnteile(k: Kapital) {
  if (!k.zeilen.some((z) => z.diesesFonds)) {
    throw new Fachfehler(409, "waterfall_no_shares", "The fund holds no shares in this company from financing rounds.");
  }
}

/** Mount unter `/beteiligungen/:id`. */
export function beteiligungKapitalRouten(db: Db) {
  return new Hono()
    /** Kapitaltabelle zum Stichtag: nach Klasse und Inhaber, Anteile unverwässert und voll verwässert (mit Pool), Position des Fonds markiert. */
    .get("/cap-table", pruefePortfolio("param", idParam, { query: kapitalAbfrage }), pruefePortfolio("query", kapitalAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { stichtag, offeneWandlungen } = c.req.valid("query");
      const antwort = await lese(db, async (tx) => {
        const b = await ladeBeteiligungKurz(tx, id);
        const k = await ladeKapital(tx, b, stichtag ?? heute());
        const akteur = aktuellerAkteur(c);
        // Gerechnet wird mit allen Zeilen; Optionsscheine, Ausübungen und Übertragungen nicht sichtbarer Fonds erscheinen nur zusammengefasst.
        return kapitalAntwort(verdeckeKapital(k, sichtbarFuer(akteur)), id, await ladeOffeneWandlungen(tx, akteur, k, b.fondsId), offeneWandlungen === "true" && k.letzteRunde !== null);
      });
      return c.json(portfolioAnApi(antwort), 200);
    })
    /** Wasserfall zu einem Exitwert; schreibt nichts. Der Erlös ist `exitwert − kosten`. */
    .post("/waterfall", pruefePortfolio("param", idParam), pruefePortfolio("json", wasserfallEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const kosten = new Decimal(e.kosten ?? 0);
      const netto = new Decimal(e.exitwert).minus(kosten);
      if (netto.isNegative()) ungueltig([{ feld: "kosten", code: "costs_exceed_exit_value", meldung: "The costs exceed the exit value" }]);
      const { kapital, ergebnis, verdeckt } = await lese(db, async (tx) => {
        const b = await ladeBeteiligungKurz(tx, id);
        const k = await ladeKapital(tx, b, e.exitdatum);
        verlangeAnteile(k);
        const akteur = aktuellerAkteur(c);
        const v = verdeckteZeilen(k, sichtbarFuer(akteur));
        // Ohne den Bereich Einzelzuteilungen: Zuteilungen je Pool zusammengefasst.
        if (!(await siehtEinzelzuteilungen(tx, akteur, b.organisationId))) verdeckeZuteilungen(k, v);
        // Namen verdeckter Zeilen auch in den Rechenschritten anonym.
        const kern = kernEingabe(k, new Set(v.keys()));
        return { kapital: k, verdeckt: v, ergebnis: wasserfall({ exitwert: netto, exitdatum: e.exitdatum, treuhandAnteil: e.treuhandAnteil ?? "0", ...kern }) };
      });
      const { wert: roh, schritte: rohSchritte } = ergebnis;
      // Zeilen und Rechenschritte für die Antwort: verdeckte Ausübungen ohne Investition und Präferenz, Rechenweg ohne Einzelwerte verdeckter Zeilen.
      const wert = { ...roh, zeilen: entschaerfeZeilen(roh.zeilen, verdeckt) };
      const schritte = zuteilungenVerdeckt(verdeckt)
        ? ([{ zeichen: "", bezeichnung: "Rechenweg nicht sichtbar: Er enthält Einzelzuteilungen der Mitarbeiterbeteiligung, die Sie nicht sehen.", wert: "" }] as Rechenschritt[])
        : schritteFuerAnsicht(rohSchritte, verdeckt);
      const ausZeilen = wert.zeilen !== roh.zeilen;
      const heikel = rechenwegHeikel(verdeckt);
      const eigene = new Set(kapital.zeilen.filter((z) => z.diesesFonds).map((z) => z.id));
      const nachId = wasserfallQuellen(kapital);
      // Halter verdeckter Zeilen anonym (auch für die Summen je Inhaber), ohne Angaben zum Optionsschein.
      for (const [zeilenId, v] of verdeckt) {
        const q = nachId.get(zeilenId);
        if (q) nachId.set(zeilenId, { ...q, halter: v.halter, optionsschein: null });
      }
      const eigeneZeilen = wert.zeilen.filter((z) => eigene.has(z.id));
      const summe = (feld: "investiert" | "praeferenz" | "beteiligung" | "gesamt" | "treuhand" | "sofort") => eigeneZeilen.reduce((s, z) => s.plus(z[feld]), new Decimal(0));
      const investiert = summe("investiert");
      return c.json(
        portfolioAnApi({
          beteiligungId: id,
          eingabe: { exitwert: geld(new Decimal(e.exitwert)), kosten: geld(kosten), nettoErloes: geld(netto), exitdatum: e.exitdatum, treuhandAnteil: new Decimal(e.treuhandAnteil ?? 0).toFixed(4) },
          zeilen: fasseWasserfallZusammen(wert.zeilen.map((z) => {
            const q = nachId.get(z.id)!;
            return {
              id: z.id,
              halter: q.halter,
              klasseId: z.klasseId,
              klasseName: klassenName(kapital, z.klasseId),
              runde: q.runde,
              anteile: z.anteile.toFixed(0),
              investiert: geld(z.investiert),
              anspruch: geld(z.anspruch),
              praeferenz: geld(z.praeferenz),
              beteiligung: geld(z.beteiligung),
              gesamt: geld(z.gesamt),
              treuhand: geld(z.treuhand),
              sofort: geld(z.sofort),
              multiple: mal(z.multiple),
              gewandelt: z.gewandelt,
              gedeckelt: z.gedeckelt,
              diesesFonds: z.id !== STAMM_ID && eigene.has(z.id),
              mitarbeiter: q.mitarbeiter
                ? verdeckt.has(z.id)
                  ? { poolId: q.mitarbeiter.pool.id, pool: q.mitarbeiter.pool.bezeichnung, art: q.mitarbeiter.pool.art, regel: q.mitarbeiter.pool.regel, kategorie: null, anzahl: null, basispreis: null, imGeld: z.imGeld === true }
                  : { poolId: q.mitarbeiter.pool.id, pool: q.mitarbeiter.pool.bezeichnung, art: q.mitarbeiter.pool.art, regel: q.mitarbeiter.pool.regel, kategorie: q.mitarbeiter.kategorie, anzahl: q.mitarbeiter.anzahl, basispreis: q.mitarbeiter.basispreis, imGeld: z.imGeld === true }
                : null,
              /** Nicht ausgeübte Optionsscheine: Instrument, Ausübungspreis und ob sie im Geld sind (je Anteil max(0, Betrag je Anteil − Ausübungspreis)). */
              optionsschein: q.optionsschein ? { instrumentId: q.optionsschein.instrumentId, ausuebungspreis: q.optionsschein.ausuebungspreis, laufzeitBis: q.optionsschein.laufzeitBis, imGeld: z.imGeld === true } : null,
            };
          }), verdeckt),
          klassen: klassenDesWasserfalls(wert.klassen, wert.zeilen, nachId, ausZeilen),
          /** Rückflüsse je Inhaber (Fonds, Investor über alle Vehikel, Stammanteile, Pool der Mitarbeiterbeteiligung). */
          inhaber: inhaberDesWasserfalls(wert.zeilen, nachId, eigene),
          fonds: {
            investiert: geld(investiert),
            praeferenz: geld(summe("praeferenz")),
            beteiligung: geld(summe("beteiligung")),
            gesamt: geld(summe("gesamt")),
            treuhand: geld(summe("treuhand")),
            sofort: geld(summe("sofort")),
            multiple: mal(investiert.greaterThan(0) ? summe("gesamt").div(investiert) : null),
          },
          mitarbeiter: mitarbeiterSumme(wert.zeilen, nachId),
          /** `null` auch, wenn Bestände nicht sichtbarer Fonds den Wert verrieten (siehe `kapital/sichtbarkeit.ts`); ebenso die beiden folgenden Felder. */
          minderungsfaktor: heikel || wert.minderungsfaktor === null ? null : wert.minderungsfaktor.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6),
          gewandelt: wert.gewandelt,
          restNachPraeferenzen: heikel ? null : geld(wert.restNachPraeferenzen),
          preisJeAnteil: heikel || wert.preisJeAnteil === null ? null : wert.preisJeAnteil.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6),
          nichtVerteilt: geld(wert.nichtVerteilt),
          schritte,
        }),
        200,
      );
    })
    /**
     * Rückfluss des Fonds über einen Bereich von Exitwerten (für das Diagramm): `punkte` gleichmäßige Punkte von 0 bis `bis` (2 bis 200,
     * Standard 50) und die Knickpunkte der Verteilung. `bis` höchstens das 100-Fache der Post-Money-Bewertung der letzten Runde bis zum
     * Exitdatum (Standard: das 5-Fache). Kosten und Treuhand spielen hier keine Rolle (Erlös = Exitwert).
     */
    .get("/waterfall/curve", pruefePortfolio("param", idParam, { query: kurveAbfrage }), pruefePortfolio("query", kurveAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const q = c.req.valid("query");
      const exitdatum = q.exitdatum ?? heute();
      const punkteZahl = q.punkte === undefined ? 50 : Number(q.punkte);
      if (punkteZahl < 2 || punkteZahl > MAX_KURVENPUNKTE) ungueltig([{ feld: "punkte", code: punkteZahl < 2 ? "too_small" : "too_big", meldung: `The number of points must be between 2 and ${MAX_KURVENPUNKTE}` }]);
      const ergebnisKapital = await lese(db, async (tx) => {
        const b = await ladeBeteiligungKurz(tx, id);
        const k = await ladeKapital(tx, b, exitdatum);
        verlangeAnteile(k);
        if (!k.letzteRunde) throw new Fachfehler(409, "waterfall_no_shares", "The fund holds no shares in this company from financing rounds.");
        const akteur = aktuellerAkteur(c);
        const verdeckt = verdeckteZeilen(k, sichtbarFuer(akteur));
        if (!(await siehtEinzelzuteilungen(tx, akteur, b.organisationId))) verdeckeZuteilungen(k, verdeckt);
        return { k, verdeckt };
      });
      const { k: antwort, verdeckt } = ergebnisKapital;
      const post = new Decimal(antwort.letzteRunde!.postMoney);
      const hoechstwert = post.times(MAX_EXIT_FAKTOR);
      const bis = new Decimal(q.bis ?? post.times(5).toFixed(2));
      if (!bis.greaterThan(0)) ungueltig([{ feld: "bis", code: "too_small", meldung: "The range must be greater than zero" }]);
      if (bis.greaterThan(hoechstwert)) ungueltig([{ feld: "bis", code: "too_big", meldung: `The range must not exceed ${MAX_EXIT_FAKTOR} times the post-money valuation of the last round (${hoechstwert.toFixed(2)})` }]);
      // Gerechnet wird mit allen Zeilen; Namen verdeckter Zeilen bleiben anonym.
      const kern = kernEingabe(antwort, new Set(verdeckt.keys()));
      const eigene = antwort.zeilen.filter((z) => z.diesesFonds).map((z) => z.id);
      const investiert = antwort.zeilen.filter((z) => z.diesesFonds).reduce((s, z) => s.plus(z.investiert), new Decimal(0));
      const rund = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const wertMitMal = (exitwert: Decimal, rueckfluss: Decimal) => ({ exitwert: geld(exitwert), rueckfluss: geld(rund(rueckfluss)), multiple: investiert.greaterThan(0) ? mal(rund(rueckfluss).div(investiert)) : null });

      const exitwerte = Array.from({ length: punkteZahl }, (_, i) => rund(bis.times(i).div(punkteZahl - 1)));
      const punkte = wasserfallKurve({ exitdatum, ...kern }, exitwerte, eigene).map((p) => wertMitMal(p.exitwert, p.rueckfluss));
      // Knickpunkte verrieten Ausübungspreise verdeckter Optionsscheine und Ausübungen (siehe `kapital/sichtbarkeit.ts`): dann entfallen sie.
      const knicke = rechenwegHeikel(verdeckt) || zuteilungenVerdeckt(verdeckt) ? [] : wasserfallKnicke({ exitdatum, ...kern }, bis);
      const knickWerte = wasserfallKurve({ exitdatum, ...kern }, knicke.map((x) => x.exitwert), eigene);
      return c.json(
        portfolioAnApi({
          beteiligungId: id,
          exitdatum,
          bis: geld(bis),
          hoechstwert: geld(hoechstwert),
          postMoney: geld(post),
          investiert: geld(investiert),
          punkte,
          knicke: knicke.map((x, i) => ({ ...wertMitMal(x.exitwert, knickWerte[i]!.rueckfluss), ereignisse: x.ereignisse.map((e) => ({ art: e.art, klasseId: e.klasseId, klasseName: klassenName(antwort, e.klasseId), rang: e.rang })) })),
        }),
        200,
      );
    });
}
