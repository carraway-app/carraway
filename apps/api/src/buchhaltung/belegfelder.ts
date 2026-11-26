import { z } from "zod";
import { and, asc, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import {
  beteiligung,
  beteiligungBuchhaltung,
  belegArtEigen,
  belegVorlage,
  darlehenKondition,
  fonds,
  fondsBewegung,
  foerderprogramm,
  fondsMittelart,
  organisation,
  verkauf,
  vorgang,
  wandlung,
  zinslauf,
  zinslaufPosition,
  type Db,
} from "@carraway/db";
import { Decimal, verteileAnteilig } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import { ladeInstrumentdaten } from "../instrumente/daten";
import type { Tx } from "../zeitlimit";

/**
 * Felder der Belege (Etappe 14). Der Katalog nennt je Belegart, welche Geschäftsfelder es gibt; die Vorlage des Fonds wählt aus,
 * ordnet einem Abschnitt zu und bestimmt Pflichtfelder. `sammleBelegdaten` befüllt die Felder aus den Geschäftsdaten.
 */

export const BELEG_ARTEN = ["vertragsanlage", "auszahlung", "zinsbuchung", "verkauf", "wandlung", "kapitalabruf", "ausschuettung"] as const;
export type BelegArtName = (typeof BELEG_ARTEN)[number] | "frei";
export type BezugArt = "vorgang" | "zinslauf" | "verkauf" | "wandlung" | "beteiligung" | "fonds_bewegung";
export type FeldTyp = "text" | "betrag" | "datum" | "zahl" | "anteil";

export interface KatalogFeld {
  schluessel: string;
  typ: FeldTyp;
  bezeichnungDe: string;
  bezeichnungEn: string;
}

const f = (schluessel: string, typ: FeldTyp, bezeichnungDe: string, bezeichnungEn: string): KatalogFeld => ({ schluessel, typ, bezeichnungDe, bezeichnungEn });

const ALLGEMEIN: KatalogFeld[] = [
  f("fonds_name", "text", "Fonds", "Fund"),
  f("belegdatum", "datum", "Belegdatum", "Voucher date"),
  f("betrag", "betrag", "Betrag", "Amount"),
];
const BETEILIGUNG: KatalogFeld[] = [
  f("organisation_name", "text", "Unternehmen", "Company"),
  f("instrument", "text", "Instrument", "Instrument"),
  f("projektnummer", "text", "Projektnummer", "Project number"),
  f("vertragsnummer", "text", "Vertragsnummer", "Contract number"),
  f("partnernummer", "text", "Partnernummer", "Partner number"),
  f("buchungskreis", "text", "Buchungskreis", "Company code"),
  f("foerderprogramm", "text", "Förderprogramm", "Funding programme"),
];

/** Felder der Belege zu Fondsbewegungen (Abruf, Ausschüttung); es gibt keine einzelne Beteiligung. */
const BEWEGUNG: KatalogFeld[] = [
  f("zeichnungskapital", "betrag", "Zeichnungskapital", "Subscribed capital"),
  f("summe_bis_datum", "betrag", "Summe bis zum Belegdatum", "Total up to the voucher date"),
  f("bemerkung", "text", "Bemerkung", "Remark"),
];

export const KATALOG: Record<BelegArtName, KatalogFeld[]> = {
  frei: ALLGEMEIN,
  kapitalabruf: [...ALLGEMEIN, ...BEWEGUNG],
  ausschuettung: [...ALLGEMEIN, ...BEWEGUNG],
  vertragsanlage: [
    ...ALLGEMEIN,
    ...BETEILIGUNG,
    f("erstinvestment", "datum", "Erstinvestment", "First investment"),
    f("zusage", "betrag", "Zusage", "Commitment"),
    f("zinssatz", "anteil", "Zinssatz fix", "Fixed interest rate"),
    f("zinsmethode", "text", "Zinsmethode", "Day count method"),
    f("faellig_am", "datum", "Laufzeitende", "Maturity"),
  ],
  auszahlung: [
    ...ALLGEMEIN,
    ...BETEILIGUNG,
    f("zusage", "betrag", "Zusage", "Commitment"),
    f("ausgezahlt_gesamt", "betrag", "Ausgezahlt insgesamt", "Disbursed in total"),
    f("offene_zusage", "betrag", "Offene Zusage", "Open commitment"),
    f("bemerkung", "text", "Bemerkung", "Remark"),
  ],
  zinsbuchung: [
    ...ALLGEMEIN,
    ...BETEILIGUNG,
    f("stichtag", "datum", "Stichtag des Zinslaufs", "Interest run date"),
    f("anzahl_perioden", "zahl", "Anzahl Zinsperioden", "Number of interest periods"),
    f("summe_kapitalisiert", "betrag", "Davon kapitalisiert", "Of which capitalised"),
    f("bemerkung", "text", "Bemerkung", "Remark"),
  ],
  verkauf: [
    ...ALLGEMEIN,
    ...BETEILIGUNG,
    f("anteil_verkauft", "anteil", "Verkaufter Anteil", "Share sold"),
    f("kaufpreis", "betrag", "Kaufpreis", "Purchase price"),
    f("kosten", "betrag", "Kosten", "Costs"),
    f("treuhand_betrag", "betrag", "Treuhandbetrag", "Escrow amount"),
    f("verkaeuferdarlehen_betrag", "betrag", "Verkäuferdarlehen", "Vendor loan"),
    f("buchwert_abgang", "betrag", "Buchwertabgang", "Book value disposed"),
    f("erloes", "betrag", "Erlös", "Proceeds"),
    f("ergebnis", "betrag", "Ergebnis", "Gain or loss"),
    f("barzufluss", "betrag", "Barzufluss", "Cash inflow"),
  ],
  wandlung: [
    ...ALLGEMEIN,
    ...BETEILIGUNG,
    f("cutoff", "datum", "Stichtag der Wandlung", "Conversion cut-off"),
    f("wandlungsbetrag", "betrag", "Wandlungsbetrag", "Conversion amount"),
    f("anzahl_anteile", "zahl", "Anzahl Anteile", "Number of shares"),
    f("preis_je_anteil", "zahl", "Preis je Anteil", "Price per share"),
    f("nominal", "betrag", "Nominalbetrag", "Nominal amount"),
    f("agio", "betrag", "Agio", "Premium"),
    f("spitzenbetrag", "betrag", "Spitzenbetrag", "Fractional amount"),
    f("zinsen_gebucht", "betrag", "Gebuchte Zinsen", "Interest booked"),
  ],
};

export type Abschnitt = "kopf" | "details";

export interface VorlagenFeld {
  schluessel: string;
  abschnitt: Abschnitt;
  pflicht: boolean;
  manuell?: "text" | "betrag" | "datum";
  /** Eigene Bezeichnung; ohne Angabe gilt die des Katalogs. */
  bezeichnungDe?: string;
  bezeichnungEn?: string;
}

export interface Vorlage {
  felder: VorlagenFeld[];
  kopfDe: string;
  kopfEn: string;
  fussDe: string;
  fussEn: string;
}

const ohne = (art: BelegArtName, schluessel: string[]) => KATALOG[art].filter((k) => !schluessel.includes(k.schluessel));

/** Standardvorlage einer Art: alle Felder des Katalogs, die Kopfangaben als Pflicht. */
export function standardVorlage(art: BelegArtName): Vorlage {
  const kopf = new Set(["fonds_name", "belegdatum", "betrag", "organisation_name"]);
  const pflicht = new Set(["fonds_name", "belegdatum", "betrag"]);
  // Der Zinslauf umfasst viele Beteiligungen: Felder einer einzelnen Beteiligung entfallen.
  const felder = art === "zinsbuchung" ? ohne("zinsbuchung", BETEILIGUNG.map((b) => b.schluessel)) : KATALOG[art];
  return {
    felder: felder.map((k) => ({ schluessel: k.schluessel, abschnitt: kopf.has(k.schluessel) ? "kopf" : "details", pflicht: pflicht.has(k.schluessel) })),
    kopfDe: "",
    kopfEn: "",
    fussDe: "",
    fussEn: "",
  };
}

/** Erlaubte Bezüge je Art. */
export const ERLAUBTER_BEZUG: Record<BelegArtName, BezugArt[]> = {
  frei: ["vorgang"],
  vertragsanlage: ["beteiligung"],
  auszahlung: ["vorgang"],
  zinsbuchung: ["zinslauf", "vorgang"],
  verkauf: ["verkauf"],
  wandlung: ["wandlung"],
  kapitalabruf: ["fonds_bewegung"],
  ausschuettung: ["fonds_bewegung"],
};

export interface Belegdaten {
  beteiligungId: string | null;
  fondsId: string;
  datum: string;
  betrag: string | null;
  /** Werte je Feldschlüssel; Beträge und Zahlen als Dezimalzeichenkette, Daten als ISO, `null` = nicht vorhanden. */
  werte: Record<string, string | null>;
  mittelherkunft: { schluessel: string; bezeichnungDe: string; bezeichnungEn: string; quote: string; betrag: string }[];
}

const INSTRUMENT_TEXT: Record<string, string> = {
  offene_beteiligung: "Offene Beteiligung",
  stille_beteiligung: "Stille Beteiligung",
  darlehen: "Darlehen",
  wandeldarlehen: "Wandeldarlehen",
  venture_debt: "Venture Debt",
  gesellschafterdarlehen: "Gesellschafterdarlehen",
  safe: "SAFE",
  optionsschein: "Optionsscheine",
};

const dec = (w: string | number | null | undefined): string | null => (w === null || w === undefined ? null : new Decimal(w).toFixed(2));
const text = (w: string | null | undefined): string | null => (w === null || w === undefined || w.trim() === "" ? null : w);

/** Mittelarten eines Fonds, gültig am Datum. */
export async function mittelartenAm(tx: Tx, fondsId: string, datum: string) {
  return tx
    .select()
    .from(fondsMittelart)
    .where(and(eq(fondsMittelart.fondsId, fondsId), lte(fondsMittelart.gueltigAb, datum), or(isNull(fondsMittelart.gueltigBis), sql`${fondsMittelart.gueltigBis} >= ${datum}`)))
    .orderBy(asc(fondsMittelart.schluessel));
}

/** Teilt den Betrag nach den Quoten der Mittelarten am Datum auf den Cent genau auf (Methode des größten Rests). */
export async function mittelherkunft(tx: Tx, fondsId: string, datum: string, betrag: string | null): Promise<Belegdaten["mittelherkunft"]> {
  if (betrag === null) return [];
  const arten = await mittelartenAm(tx, fondsId, datum);
  if (arten.length === 0) return [];
  const teile = verteileAnteilig(betrag, arten.map((a) => a.quote));
  return arten.map((a, i) => ({ schluessel: a.schluessel, bezeichnungDe: a.bezeichnungDe, bezeichnungEn: a.bezeichnungEn, quote: a.quote, betrag: teile[i]!.toFixed(2) }));
}

async function beteiligungWerte(tx: Tx, beteiligungId: string): Promise<{ fondsId: string; werte: Record<string, string | null> }> {
  const [b] = await tx.select().from(beteiligung).where(eq(beteiligung.id, beteiligungId));
  if (!b) throw new Fachfehler(404, "investment_not_found", "Investment not found.");
  const [o] = await tx.select({ name: organisation.name }).from(organisation).where(eq(organisation.id, b.organisationId));
  const [fz] = await tx.select({ name: fonds.name }).from(fonds).where(eq(fonds.id, b.fondsId));
  const [k] = await tx.select().from(beteiligungBuchhaltung).where(eq(beteiligungBuchhaltung.beteiligungId, beteiligungId));
  const [programm] = k?.foerderprogrammId ? await tx.select({ bezeichnung: foerderprogramm.bezeichnung }).from(foerderprogramm).where(eq(foerderprogramm.id, k.foerderprogrammId)) : [];
  return {
    fondsId: b.fondsId,
    werte: {
      fonds_name: fz?.name ?? null,
      organisation_name: o?.name ?? null,
      instrument: INSTRUMENT_TEXT[b.instrument] ?? b.instrument,
      projektnummer: text(k?.projektnummer),
      vertragsnummer: text(k?.vertragsnummer),
      partnernummer: text(k?.partnernummer),
      buchungskreis: text(k?.buchungskreis),
      foerderprogramm: text(programm?.bezeichnung),
    },
  };
}

/**
 * Befüllt die Felder eines Belegs aus den Geschäftsdaten. Wirft 404 bei unbekanntem Bezug und 409 `voucher_reference_mismatch`, wenn
 * der Bezug nicht zur Art passt. Fehlende Angaben bleiben `null` (die Prüfung der Pflichtfelder macht der Aufrufer).
 */
export async function sammleBelegdaten(tx: Tx, art: BelegArtName, bezugArt: BezugArt, bezugId: string): Promise<Belegdaten> {
  if (!ERLAUBTER_BEZUG[art].includes(bezugArt)) throw new Fachfehler(409, "voucher_reference_mismatch", "The reference does not match the voucher type.", { art, bezugArt, erlaubt: ERLAUBTER_BEZUG[art] });
  const passt = (ok: boolean, grund: string) => {
    if (!ok) throw new Fachfehler(409, "voucher_reference_mismatch", "The reference does not match the voucher type.", { art, bezugArt, grund });
  };
  let beteiligungId: string | null = null;
  let datum: string;
  let betrag: string | null;
  let eigene: Record<string, string | null>;
  let fondsId: string | null = null;
  let allgemein: Record<string, string | null>;

  if (bezugArt === "beteiligung") {
    const daten = await ladeInstrumentdaten(tx, bezugId);
    if (!daten) throw new Fachfehler(404, "investment_not_found", "Investment not found.");
    beteiligungId = bezugId;
    const [kond] = await tx.select().from(darlehenKondition).where(eq(darlehenKondition.beteiligungId, bezugId)).orderBy(desc(darlehenKondition.gueltigAb)).limit(1);
    datum = daten.beteiligung.erstinvestment;
    betrag = dec(daten.zustand.zusage);
    eigene = { erstinvestment: daten.beteiligung.erstinvestment, zusage: dec(daten.zustand.zusage), zinssatz: kond ? new Decimal(kond.satzFix).toString() : null, zinsmethode: kond?.methode ?? null, faellig_am: kond?.faelligAm ?? null };
  } else if (bezugArt === "vorgang") {
    const [v] = await tx.select().from(vorgang).where(eq(vorgang.id, bezugId));
    if (!v) throw new Fachfehler(404, "transaction_not_found", "Transaction not found.");
    if (art !== "frei") passt(art === "auszahlung" ? v.art === "auszahlung" : v.art === "zins", "vorgangsart");
    beteiligungId = v.beteiligungId;
    datum = v.valuta;
    betrag = dec(v.betrag);
    if (art === "auszahlung") {
      const daten = await ladeInstrumentdaten(tx, v.beteiligungId);
      eigene = { zusage: dec(daten?.zustand.zusage), ausgezahlt_gesamt: dec(daten?.zustand.investiert), offene_zusage: dec(daten?.zustand.offeneZusage), bemerkung: text(v.bemerkung) };
    } else if (art === "frei") eigene = {};
    else eigene = { stichtag: v.valuta, anzahl_perioden: "1", summe_kapitalisiert: v.kapitalisiert ? dec(v.betrag) : "0.00", bemerkung: text(v.bemerkung) };
  } else if (bezugArt === "fonds_bewegung") {
    const [x] = await tx.select().from(fondsBewegung).where(eq(fondsBewegung.id, bezugId));
    if (!x) throw new Fachfehler(404, "fund_movement_not_found", "Fund movement not found.");
    passt(art === "kapitalabruf" ? x.art === "abruf" : x.art === "ausschuettung", "bewegungsart");
    fondsId = x.fondsId;
    datum = x.valuta;
    betrag = dec(x.betrag);
    const [fz] = await tx.select({ kapital: fonds.zeichnungskapital }).from(fonds).where(eq(fonds.id, x.fondsId));
    // Summe der Bewegungen dieser Art bis zum Belegdatum; ein Storno zählt negativ und hebt sein Original auf.
    const [summe] = await tx
      .select({ s: sql<string>`coalesce(sum(${fondsBewegung.betrag}), 0)` })
      .from(fondsBewegung)
      .where(and(eq(fondsBewegung.fondsId, x.fondsId), eq(fondsBewegung.art, x.art), lte(fondsBewegung.valuta, x.valuta)));
    eigene = { zeichnungskapital: dec(fz?.kapital), summe_bis_datum: dec(summe?.s ?? 0), bemerkung: text(x.bemerkung) };
  } else if (bezugArt === "zinslauf") {
    const [z] = await tx.select().from(zinslauf).where(eq(zinslauf.id, bezugId));
    if (!z) throw new Fachfehler(404, "interest_run_not_found", "Interest run not found.");
    passt(z.status !== "verworfen", "verworfen");
    fondsId = z.fondsId;
    datum = z.stichtag;
    const pos = await tx.select({ gebucht: zinslaufPosition.betragGebucht, kapitalisiert: zinslaufPosition.kapitalisiert }).from(zinslaufPosition).where(eq(zinslaufPosition.zinslaufId, bezugId));
    betrag = pos.reduce((s, p) => s.plus(p.gebucht), new Decimal(0)).toFixed(2);
    eigene = {
      stichtag: z.stichtag,
      anzahl_perioden: String(pos.length),
      summe_kapitalisiert: pos.filter((p) => p.kapitalisiert).reduce((s, p) => s.plus(p.gebucht), new Decimal(0)).toFixed(2),
      bemerkung: null,
    };
  } else if (bezugArt === "verkauf") {
    const [v] = await tx.select().from(verkauf).where(eq(verkauf.id, bezugId));
    if (!v) throw new Fachfehler(404, "sale_not_found", "Sale not found.");
    passt(v.storniertAm === null, "storniert");
    beteiligungId = v.beteiligungId;
    datum = v.datum;
    betrag = dec(v.barzufluss);
    eigene = {
      anteil_verkauft: new Decimal(v.anteilVerkauft).toString(),
      kaufpreis: dec(v.kaufpreis),
      kosten: dec(v.kosten),
      treuhand_betrag: dec(v.treuhandBetrag),
      verkaeuferdarlehen_betrag: dec(v.verkaeuferdarlehenBetrag),
      buchwert_abgang: dec(v.buchwertAbgang),
      erloes: dec(v.erloes),
      ergebnis: dec(v.ergebnis),
      barzufluss: dec(v.barzufluss),
    };
  } else {
    const [w] = await tx.select().from(wandlung).where(eq(wandlung.id, bezugId));
    if (!w) throw new Fachfehler(404, "investment_not_found", "Conversion not found.");
    beteiligungId = w.darlehenBeteiligungId;
    datum = w.cutoff;
    betrag = dec(w.wandlungsbetrag);
    eigene = {
      cutoff: w.cutoff,
      wandlungsbetrag: dec(w.wandlungsbetrag),
      anzahl_anteile: new Decimal(w.anzahlAnteile).toString(),
      preis_je_anteil: new Decimal(w.preisJeAnteil).toDecimalPlaces(6).toString(),
      nominal: dec(w.nominal),
      agio: dec(w.agio),
      spitzenbetrag: dec(w.spitzenbetrag),
      zinsen_gebucht: dec(w.zinsenGebucht),
    };
  }

  if (beteiligungId) {
    const b = await beteiligungWerte(tx, beteiligungId);
    fondsId = b.fondsId;
    allgemein = b.werte;
  } else {
    const [fz] = await tx.select({ name: fonds.name }).from(fonds).where(eq(fonds.id, fondsId!));
    allgemein = { fonds_name: fz?.name ?? null };
  }
  return {
    beteiligungId,
    fondsId: fondsId!,
    datum,
    betrag,
    werte: { ...allgemein, belegdatum: datum, betrag, ...eigene },
    mittelherkunft: await mittelherkunft(tx, fondsId!, datum, betrag),
  };
}

const manuellerWert = {
  text: z.string().max(2000),
  datum: z.iso.date(),
  betrag: z.string().regex(/^-?\d{1,16}(?:\.\d{1,2})?$/),
};

/** Nur manuelle Felder der gespeicherten Vorlage dürfen Geschäftsdaten ergänzen. */
export function setzeFeldwerte(vorlage: Vorlage, werte: Record<string, string | null>, eingabe: Record<string, string | null>) {
  const felder = new Map(vorlage.felder.filter((f) => f.manuell).map((f) => [f.schluessel, f]));
  for (const [schluessel, roh] of Object.entries(eingabe)) {
    const feld = felder.get(schluessel);
    const wert = roh?.trim() || null;
    if (!feld?.manuell || (wert !== null && !manuellerWert[feld.manuell].safeParse(wert).success)) {
      throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder: [{ feld: `werte.${schluessel}`, code: "ungueltig", meldung: "The value does not match the voucher field." }] });
    }
    werte[schluessel] = wert && feld.manuell === "betrag" ? new Decimal(wert).toFixed(2) : wert;
  }
}

/** Fehlende Pflichtfelder der Vorlage (`code`: `required_field_missing`). */
export function pruefePflicht(vorlage: Vorlage, werte: Record<string, string | null>): { feld: string; code: string }[] {
  return vorlage.felder.filter((fe) => fe.pflicht && (werte[fe.schluessel] === null || werte[fe.schluessel] === undefined || werte[fe.schluessel] === "")).map((fe) => ({ feld: fe.schluessel, code: "required_field_missing" }));
}

/**
 * Zuletzt gespeicherte Vorlage des Fonds oder die Standardvorlage der Basis-Art. Bei einer eigenen Belegart (`eigeneArtId`) gilt deren
 * eigene Vorlage, sonst die Standardvorlage der Basis-Art.
 */
export async function ladeBelegVorlage(db: Tx | Db, fondsId: string, art: BelegArtName, eigeneArtId: string | null = null): Promise<{ vorlage: Vorlage; standard: boolean }> {
  const bedingung = eigeneArtId ? and(eq(belegVorlage.fondsId, fondsId), eq(belegVorlage.eigeneArtId, eigeneArtId)) : and(eq(belegVorlage.fondsId, fondsId), eq(belegVorlage.art, art), isNull(belegVorlage.eigeneArtId));
  const [z] = await (db as Tx).select().from(belegVorlage).where(bedingung);
  if (!z) return { vorlage: standardVorlage(art), standard: true };
  return { vorlage: { felder: z.felder as VorlagenFeld[], kopfDe: z.kopfDe, kopfEn: z.kopfEn, fussDe: z.fussDe, fussEn: z.fussEn }, standard: false };
}

/** Eigene Belegart eines Fonds; `null`, wenn es sie in diesem Fonds nicht gibt. */
export async function ladeEigeneArt(tx: Tx, fondsId: string, id: string) {
  const [z] = await tx.select().from(belegArtEigen).where(and(eq(belegArtEigen.id, id), eq(belegArtEigen.fondsId, fondsId)));
  return z ?? null;
}

/**
 * Fonds des Datensatzes, auf den sich ein Beleg bezieht, ohne dessen Inhalt zu laden. `null`, wenn es ihn nicht gibt. So lässt sich die
 * Rolle prüfen, bevor Inhalte oder inhaltsabhängige Fehler erscheinen.
 */
export async function fondsVonBezug(tx: Tx, bezugArt: BezugArt, bezugId: string): Promise<string | null> {
  switch (bezugArt) {
    case "beteiligung": {
      const [z] = await tx.select({ f: beteiligung.fondsId }).from(beteiligung).where(eq(beteiligung.id, bezugId));
      return z?.f ?? null;
    }
    case "vorgang": {
      const [z] = await tx.select({ f: beteiligung.fondsId }).from(vorgang).innerJoin(beteiligung, eq(beteiligung.id, vorgang.beteiligungId)).where(eq(vorgang.id, bezugId));
      return z?.f ?? null;
    }
    case "zinslauf": {
      const [z] = await tx.select({ f: zinslauf.fondsId }).from(zinslauf).where(eq(zinslauf.id, bezugId));
      return z?.f ?? null;
    }
    case "verkauf": {
      const [z] = await tx.select({ f: beteiligung.fondsId }).from(verkauf).innerJoin(beteiligung, eq(beteiligung.id, verkauf.beteiligungId)).where(eq(verkauf.id, bezugId));
      return z?.f ?? null;
    }
    case "fonds_bewegung": {
      const [z] = await tx.select({ f: fondsBewegung.fondsId }).from(fondsBewegung).where(eq(fondsBewegung.id, bezugId));
      return z?.f ?? null;
    }
    case "wandlung": {
      const [z] = await tx.select({ f: beteiligung.fondsId }).from(wandlung).innerJoin(beteiligung, eq(beteiligung.id, wandlung.darlehenBeteiligungId)).where(eq(wandlung.id, bezugId));
      return z?.f ?? null;
    }
  }
}
