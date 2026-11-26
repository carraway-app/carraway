import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { anteilsklasse, finanzierungsrunde, rundenposition, type Db } from "@carraway/db";
import { Decimal, wasserfall, wasserfallKnicke, wasserfallKurve } from "@carraway/rechenkern";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { Fachfehler, type Feldfehler } from "../fehler";
import { ladeOffeneWandlungen, type OffeneWandlungen } from "../kapital/offene-wandlungen";
import { standardSicht } from "../kapital/sicht";
import { anteilBruch, kernEingabe, ladeBeteiligungKurz, ladeKapital, STAMM_ID, type Halter, type Kapital, type KlasseZeile, type MitarbeiterZeile } from "../kapital/wasserfall";
import { pruefe } from "../pruefung";
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

const faktorEingabe = z.string().regex(/^\d{1,4}(\.\d{1,4})?$/, "Faktor von null an mit höchstens vier Nachkommastellen erwartet");
/** Zinssatz je Jahr als Bruch zwischen 0 und 1 (`0.08` = 8 %). */
const zinsEingabe = z.string().regex(/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/, "Bruch von 0 bis 1 mit höchstens sechs Nachkommastellen erwartet");
const betragNullEingabe = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, "Betrag von null an mit höchstens zwei Nachkommastellen erwartet");
/** Treuhandanteil: Bruch von 0 bis unter 1. */
const treuhandEingabe = z.string().regex(/^0(\.\d{1,4})?$/, "Bruch von 0 bis unter 1 mit höchstens vier Nachkommastellen erwartet");

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
  throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", { felder });
}

/** Regeln über mehrere Felder: Ein Cap gibt es nur bei partizipierenden Klassen und nicht unter dem Präferenzfaktor. */
function pruefeKlasse(k: { partizipierend: boolean; praeferenzFaktor: string; capFaktor: string | null }) {
  const felder: Feldfehler[] = [];
  if (k.capFaktor !== null && !k.partizipierend) felder.push({ feld: "capFaktor", code: "cap_ohne_partizipation", meldung: "Ein Cap gibt es nur bei partizipierenden Klassen" });
  if (k.capFaktor !== null && new Decimal(k.capFaktor).lessThan(k.praeferenzFaktor)) felder.push({ feld: "capFaktor", code: "cap_unter_praeferenz", meldung: "Der Cap darf nicht unter dem Präferenzfaktor liegen" });
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
  if (vorhanden && vorhanden.id !== ausser) throw new Fachfehler(409, "ANTEILSKLASSE_NAME_VORHANDEN", "Diese Organisation hat schon eine Klasse mit diesem Namen.");
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
    .get("/anteilsklassen", pruefe("param", idParam), async (c) => {
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
      return c.json({ daten }, 200);
    })
    .post("/anteilsklassen", pruefe("param", idParam), pruefe("json", neueKlasse), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const neu = await schreibe(db, c, (tx, protokoll) => legeKlasseAn(tx, protokoll, id, e));
      return c.json(klasseAntwort(neu), 201);
    })
    .patch("/anteilsklassen/:klasseId", pruefe("param", klassenParam), pruefe("json", klasseAenderung), async (c) => {
      const { id, klasseId } = c.req.valid("param");
      const e = c.req.valid("json");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const [vorher] = await tx.select().from(anteilsklasse).where(and(eq(anteilsklasse.id, klasseId), eq(anteilsklasse.organisationId, id))).for("update");
        if (!vorher) throw new Fachfehler(404, "ANTEILSKLASSE_NICHT_GEFUNDEN", "Anteilsklasse nicht gefunden.");
        const werte = nurGesetzte(e);
        const zusammen = { ...vorher, ...werte };
        pruefeKlasse({ partizipierend: zusammen.partizipierend, praeferenzFaktor: zusammen.praeferenzFaktor, capFaktor: zusammen.capFaktor ?? null });
        if (e.name !== undefined) await pruefeNameFrei(tx, id, e.name, klasseId);
        const [neu] = await tx.update(anteilsklasse).set(werte).where(eq(anteilsklasse.id, klasseId)).returning();
        await protokoll("aendern", "anteilsklasse", klasseId, vorher, neu);
        return neu!;
      });
      return c.json(klasseAntwort(nachher), 200);
    });
}

const positionAenderung = z.object({ anteilsklasseId: z.uuid().nullable() });

/** Mount unter `/rundenpositionen`: Klasse einer Position setzen oder entfernen (Stammanteile). */
export function rundenpositionRouten(db: Db) {
  return new Hono().patch("/:id", pruefe("param", idParam), pruefe("json", positionAenderung), async (c) => {
    const { id } = c.req.valid("param");
    const { anteilsklasseId } = c.req.valid("json");
    const nachher = await schreibe(db, c, async (tx, protokoll) => {
      const [zeile] = await tx
        .select({ p: rundenposition, organisationId: finanzierungsrunde.organisationId })
        .from(rundenposition)
        .innerJoin(finanzierungsrunde, eq(finanzierungsrunde.id, rundenposition.rundeId))
        .where(eq(rundenposition.id, id))
        .for("update", { of: rundenposition });
      if (!zeile) throw new Fachfehler(404, "RUNDENPOSITION_NICHT_GEFUNDEN", "Rundenposition nicht gefunden.");
      if (anteilsklasseId !== null) {
        const [k] = await tx.select().from(anteilsklasse).where(eq(anteilsklasse.id, anteilsklasseId));
        if (!k) throw new Fachfehler(404, "ANTEILSKLASSE_NICHT_GEFUNDEN", "Anteilsklasse nicht gefunden.");
        if (k.organisationId !== zeile.organisationId) throw new Fachfehler(409, "ANTEILSKLASSE_PASST_NICHT", "Die Klasse gehört zu einem anderen Unternehmen als die Runde.");
      }
      const [neu] = await tx.update(rundenposition).set({ anteilsklasseId }).where(eq(rundenposition.id, id)).returning();
      await protokoll("aendern", "rundenposition", id, zeile.p, neu);
      return neu!;
    });
    return c.json(nachher, 200);
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
  bis: z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, "Betrag größer als null mit höchstens zwei Nachkommastellen erwartet").optional(),
  punkte: z
    .string()
    .regex(/^\d{1,3}$/, "Ganze Zahl von 2 bis 200 erwartet")
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
  const gruppen: { art: "klasse" | "stamm" | "pool" | "wandlung"; id: string | null; mitglieder: Kapital["zeilen"] }[] = k.klassen.map((x) => ({ art: "klasse" as const, id: x.id, mitglieder: k.zeilen.filter((z) => z.klasseId === x.id) }));
  const stamm = k.zeilen.filter((z) => z.klasseId === null && z.ausgegeben);
  if (stamm.length > 0) gruppen.push({ art: "stamm", id: null, mitglieder: stamm });
  const pool = k.zeilen.filter((z) => !z.ausgegeben && z.halter.art !== "wandlung");
  if (pool.length > 0) gruppen.push({ art: "pool", id: null, mitglieder: pool });
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
      ...anteile(zahl, art !== "pool" && art !== "wandlung"),
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
  const quellen = new Map<string, { halter: Halter; runde: Kapital["zeilen"][number]["runde"]; mitarbeiter: MitarbeiterZeile | null }>();
  for (const z of k.zeilen) if (z.ausgegeben) quellen.set(z.id, { halter: z.halter, runde: z.runde, mitarbeiter: null });
  for (const m of k.mitarbeiter) quellen.set(m.id, { halter: { art: "mitarbeiter", id: m.pool.id, name: m.bezeichnung ?? m.pool.bezeichnung, vehikel: null }, runde: null, mitarbeiter: m });
  return quellen;
}

type WasserfallWert = ReturnType<typeof wasserfall>["wert"];
type Quellen = ReturnType<typeof wasserfallQuellen>;

interface WasserfallKlasseAntwort {
  art: "klasse" | "stamm" | "mitarbeiter";
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
function klassenDesWasserfalls(klassen: WasserfallWert["klassen"], zeilen: WasserfallWert["zeilen"], quellen: Quellen) {
  const summe = (liste: WasserfallWert["zeilen"], feld: "anteile" | "investiert" | "anspruch" | "praeferenz" | "beteiligung" | "gesamt") => liste.reduce((s, z) => s.plus(z[feld]), new Decimal(0));
  const gruppe = (art: "stamm" | "mitarbeiter", liste: WasserfallWert["zeilen"]): WasserfallKlasseAntwort => {
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
    aus.push({ art: "klasse", id: k.id, name: k.name === "" ? null : k.name, rang: k.rang, anteile: k.anteile.toFixed(0), investiert: geld(k.investiert), anspruch: geld(k.anspruch), praeferenz: geld(k.praeferenz), beteiligung: geld(k.beteiligung), gesamt: geld(k.gesamt), multiple: mal(k.multiple), gewandelt: k.gewandelt, gedeckelt: k.gedeckelt });
  }
  const stamm = zeilen.filter((z) => z.klasseId === null && !quellen.get(z.id)?.mitarbeiter);
  const mitarbeiter = zeilen.filter((z) => quellen.get(z.id)?.mitarbeiter);
  if (stamm.length > 0) aus.push(gruppe("stamm", stamm));
  if (mitarbeiter.length > 0) aus.push(gruppe("mitarbeiter", mitarbeiter));
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
    throw new Fachfehler(409, "WASSERFALL_KEINE_ANTEILE", "Der Fonds hält an diesem Unternehmen keine Anteile aus Finanzierungsrunden.");
  }
}

/** Mount unter `/beteiligungen/:id`. */
export function beteiligungKapitalRouten(db: Db) {
  return new Hono()
    /** Kapitaltabelle zum Stichtag: nach Klasse und Inhaber, Anteile unverwässert und voll verwässert (mit Pool), Position des Fonds markiert. */
    .get("/kapitaltabelle", pruefe("param", idParam, { query: kapitalAbfrage }), pruefe("query", kapitalAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { stichtag, offeneWandlungen } = c.req.valid("query");
      const antwort = await lese(db, async (tx) => {
        const b = await ladeBeteiligungKurz(tx, id);
        const k = await ladeKapital(tx, b, stichtag ?? heute());
        return kapitalAntwort(k, id, await ladeOffeneWandlungen(tx, aktuellerAkteur(c), k, b.fondsId), offeneWandlungen === "true" && k.letzteRunde !== null);
      });
      return c.json(antwort, 200);
    })
    /** Wasserfall zu einem Exitwert; schreibt nichts. Der Erlös ist `exitwert − kosten`. */
    .post("/wasserfall", pruefe("param", idParam), pruefe("json", wasserfallEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const kosten = new Decimal(e.kosten ?? 0);
      const netto = new Decimal(e.exitwert).minus(kosten);
      if (netto.isNegative()) ungueltig([{ feld: "kosten", code: "kosten_ueber_exitwert", meldung: "Die Kosten übersteigen den Exitwert" }]);
      const { kapital, ergebnis } = await lese(db, async (tx) => {
        const b = await ladeBeteiligungKurz(tx, id);
        const k = await ladeKapital(tx, b, e.exitdatum);
        verlangeAnteile(k);
        const kern = kernEingabe(k);
        return { kapital: k, ergebnis: wasserfall({ exitwert: netto, exitdatum: e.exitdatum, treuhandAnteil: e.treuhandAnteil ?? "0", ...kern }) };
      });
      const { wert, schritte } = ergebnis;
      const eigene = new Set(kapital.zeilen.filter((z) => z.diesesFonds).map((z) => z.id));
      const nachId = wasserfallQuellen(kapital);
      const eigeneZeilen = wert.zeilen.filter((z) => eigene.has(z.id));
      const summe = (feld: "investiert" | "praeferenz" | "beteiligung" | "gesamt" | "treuhand" | "sofort") => eigeneZeilen.reduce((s, z) => s.plus(z[feld]), new Decimal(0));
      const investiert = summe("investiert");
      return c.json(
        {
          beteiligungId: id,
          eingabe: { exitwert: geld(new Decimal(e.exitwert)), kosten: geld(kosten), nettoErloes: geld(netto), exitdatum: e.exitdatum, treuhandAnteil: new Decimal(e.treuhandAnteil ?? 0).toFixed(4) },
          zeilen: wert.zeilen.map((z) => {
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
                ? { poolId: q.mitarbeiter.pool.id, pool: q.mitarbeiter.pool.bezeichnung, art: q.mitarbeiter.pool.art, regel: q.mitarbeiter.pool.regel, kategorie: q.mitarbeiter.kategorie, anzahl: q.mitarbeiter.anzahl, basispreis: q.mitarbeiter.basispreis, imGeld: z.imGeld === true }
                : null,
            };
          }),
          klassen: klassenDesWasserfalls(wert.klassen, wert.zeilen, nachId),
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
          minderungsfaktor: wert.minderungsfaktor === null ? null : wert.minderungsfaktor.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6),
          gewandelt: wert.gewandelt,
          restNachPraeferenzen: geld(wert.restNachPraeferenzen),
          preisJeAnteil: wert.preisJeAnteil === null ? null : wert.preisJeAnteil.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6),
          nichtVerteilt: geld(wert.nichtVerteilt),
          schritte,
        },
        200,
      );
    })
    /**
     * Rückfluss des Fonds über einen Bereich von Exitwerten (für das Diagramm): `punkte` gleichmäßige Punkte von 0 bis `bis` (2 bis 200,
     * Standard 50) und die Knickpunkte der Verteilung. `bis` höchstens das 100-Fache der Post-Money-Bewertung der letzten Runde bis zum
     * Exitdatum (Standard: das 5-Fache). Kosten und Treuhand spielen hier keine Rolle (Erlös = Exitwert).
     */
    .get("/wasserfall/kurve", pruefe("param", idParam, { query: kurveAbfrage }), pruefe("query", kurveAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const q = c.req.valid("query");
      const exitdatum = q.exitdatum ?? heute();
      const punkteZahl = q.punkte === undefined ? 50 : Number(q.punkte);
      if (punkteZahl < 2 || punkteZahl > MAX_KURVENPUNKTE) ungueltig([{ feld: "punkte", code: punkteZahl < 2 ? "too_small" : "too_big", meldung: `Die Zahl der Punkte muss zwischen 2 und ${MAX_KURVENPUNKTE} liegen` }]);
      const antwort = await lese(db, async (tx) => {
        const b = await ladeBeteiligungKurz(tx, id);
        const k = await ladeKapital(tx, b, exitdatum);
        verlangeAnteile(k);
        if (!k.letzteRunde) throw new Fachfehler(409, "WASSERFALL_KEINE_ANTEILE", "Der Fonds hält an diesem Unternehmen keine Anteile aus Finanzierungsrunden.");
        return k;
      });
      const post = new Decimal(antwort.letzteRunde!.postMoney);
      const hoechstwert = post.times(MAX_EXIT_FAKTOR);
      const bis = new Decimal(q.bis ?? post.times(5).toFixed(2));
      if (!bis.greaterThan(0)) ungueltig([{ feld: "bis", code: "too_small", meldung: "Der Bereich muss größer als null sein" }]);
      if (bis.greaterThan(hoechstwert)) ungueltig([{ feld: "bis", code: "too_big", meldung: `Der Bereich darf höchstens das ${MAX_EXIT_FAKTOR}-Fache der Post-Money-Bewertung der letzten Runde betragen (${hoechstwert.toFixed(2)})` }]);
      const kern = kernEingabe(antwort);
      const eigene = antwort.zeilen.filter((z) => z.diesesFonds).map((z) => z.id);
      const investiert = antwort.zeilen.filter((z) => z.diesesFonds).reduce((s, z) => s.plus(z.investiert), new Decimal(0));
      const rund = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const wertMitMal = (exitwert: Decimal, rueckfluss: Decimal) => ({ exitwert: geld(exitwert), rueckfluss: geld(rund(rueckfluss)), multiple: investiert.greaterThan(0) ? mal(rund(rueckfluss).div(investiert)) : null });

      const exitwerte = Array.from({ length: punkteZahl }, (_, i) => rund(bis.times(i).div(punkteZahl - 1)));
      const punkte = wasserfallKurve({ exitdatum, ...kern }, exitwerte, eigene).map((p) => wertMitMal(p.exitwert, p.rueckfluss));
      const knicke = wasserfallKnicke({ exitdatum, ...kern }, bis);
      const knickWerte = wasserfallKurve({ exitdatum, ...kern }, knicke.map((x) => x.exitwert), eigene);
      return c.json(
        {
          beteiligungId: id,
          exitdatum,
          bis: geld(bis),
          hoechstwert: geld(hoechstwert),
          postMoney: geld(post),
          investiert: geld(investiert),
          punkte,
          knicke: knicke.map((x, i) => ({ ...wertMitMal(x.exitwert, knickWerte[i]!.rueckfluss), ereignisse: x.ereignisse.map((e) => ({ art: e.art, klasseId: e.klasseId, klasseName: klassenName(antwort, e.klasseId), rang: e.rang })) })),
        },
        200,
      );
    });
}
