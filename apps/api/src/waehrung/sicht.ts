import { sql } from "drizzle-orm";
import {
  Decimal,
  faktorAlsZahl,
  konvertiere,
  RUECKFLUSS_ARTEN,
  sichtenFuerPosten,
  summeMitLuecken,
  zerlegeFxEffekt,
  type Kursluecke,
  type Kursweg,
  type SichtErgebnis,
  type Wechselkurs,
} from "@carraway/rechenkern";
import { ladeNavBestandteile, bisStand, offeneForderungen, standardStichtag, wirksameBewertung } from "../kennzahlen/fonds";
import { ermittleBeteiligungsstatus } from "../kennzahlen/beteiligungsstatus";
import type { Tx } from "../zeitlimit";
import { kursFuer, kursFenster, ladeGueltigeKurse } from "./kurse";
import { geldlos } from "../instrumente/geldfluss";
import { hauswaehrung } from "../manager/profil";

/**
 * Währungssicht auf Beteiligungen und Fonds (Etappe 21). Die gebuchten Beträge stehen in der Fondswährung; hier kommen die lokale Währung der Beteiligung und eine
 * wählbare Vergleichswährung dazu. Regeln (Rechenkern `waehrung.ts`, `docs/waehrung.md`):
 *
 * - **Kosten** (Auszahlungen, Rückflüsse, Tilgungen, gezahlte Zinsen, Dividenden) zum Kurs der Valuta, ein gebuchter lokaler Betrag gilt vor jeder Umrechnung.
 * - **Zeitwert** (Bewertung, offene Forderungen) zum Kurs des Bewertungsstichtags; Forderungen zum Kurs des Stichtags der Ansicht.
 * - **Lücke**: Fehlt ein Kurs, steht an der Stelle keine Zahl, sondern die Lücke mit Paar, Tag und Grund; eine Summe mit einer Lücke ist selbst eine Lücke.
 * - Die Fondssicht stimmt immer mit den Kennzahlen überein (gleiche Posten, gleiche Regeln für Exit und Wissensstand).
 * - **Hauswährung** (Manager-Profil, `manager/profil.ts`): eine weitere Sicht nach denselben Regeln wie die Vergleichswährung, immer dabei.
 */

export interface KursInfo {
  /** Tag des Postens, für den der Kurs gilt. */
  tag: string;
  von: string;
  nach: string;
  /** Einheiten `nach` je 1 Einheit `von`, höchstens acht Nachkommastellen. */
  kurs: string;
  /** Datum des Kurseintrags (bei mehreren Einträgen der älteste). */
  kursDatum: string;
  weg: Kursweg;
}

export interface SichtLuecke {
  verwendung: "kosten" | "zeitwert";
  tag: string;
  von: string;
  nach: string;
  grund: "kein_kurs" | "veraltet";
  letzterKursDatum: string | null;
}

export interface Betraege {
  fonds: string;
  lokal: string | null;
  vergleich: string | null;
  /** Betrag in der Hauswährung des Managers; `null` bei einer Lücke. */
  haus: string | null;
}

export interface SichtVorgang {
  id: string;
  art: string;
  valuta: string;
  betrag: Betraege;
  /** Gebuchter Kurs (Fondswährung je lokaler Einheit), wenn der lokale Betrag mitgebucht wurde. */
  gebuchterKurs: string | null;
  kurse: KursInfo[];
}

export interface SichtBewertung {
  stichtag: string;
  wert: Betraege;
  gebuchterKurs: string | null;
  kurse: KursInfo[];
  /** Zerlegung der Änderung des Fondswerts gegenüber der vorigen Bewertung in Wertänderung und Währungseffekt; `null` ohne Vorgängerin oder ohne lokalen Wert. */
  fx: { gesamt: string; wert: string; waehrung: string } | null;
}

export interface Waehrungen {
  fonds: string;
  lokal: string;
  vergleich: string | null;
  haus: string;
}

export interface Beteiligungssicht {
  beteiligungId: string;
  stichtag: string;
  stand: string | null;
  waehrungen: Waehrungen;
  kennzahlen: { investiert: Betraege | null; rueckfluesse: Betraege | null; bewertung: Betraege | null };
  /** Kurse hinter der Bewertung (Zeitwert) für die Anzeige „Kurs und Datum“. */
  bewertungKurse: KursInfo[];
  /** Kurse hinter Investiert und Rückflüssen (Kosten, Kurs der Valuta); die Berichte weisen sie mit Datum aus. */
  kostenKurse: KursInfo[];
  /** Die letzte Bewertung bis zum Stichtag allein (ohne offene Forderungen), zum Kurs ihres Stichtags; so zeigen die Berichte die Spalte „Bewertung“. */
  letzteBewertung: { wert: Betraege; kurse: KursInfo[] } | null;
  vorgaenge: SichtVorgang[];
  bewertungen: SichtBewertung[];
  luecken: SichtLuecke[];
  /** Lücken der Hauswährung, getrennt, damit sie die Sichten Lokal und Vergleich nicht stören. */
  hausLuecken: SichtLuecke[];
}

type Roh = {
  id: string;
  organisation_id: string;
  organisation_name: string;
  instrument: string;
  /** Wirksamer Status zum Stichtag und Wissensstand (nicht die Spalte `beteiligung.status`). */
  status: string;
  /** Der Ausstieg zum Stichtag ist ein Verkauf (dann zählt er auch ohne Rückfluss). */
  durch_verkauf: boolean;
  waehrung: string | null;
  fonds_waehrung: string;
};
type VorgangRoh = { id: string; beteiligung_id: string; art: string; valuta: string; betrag: string; betrag_lokal: string | null; kurs: string | null; geldlos?: boolean };
type BewertungRoh = { beteiligung_id: string; stichtag: string; wert: string; wert_lokal: string | null; kurs: string | null };

const text = (d: Decimal | null) => (d === null ? null : d.toFixed(2));

function kursInfo(tag: string, e: SichtErgebnis): KursInfo[] {
  return e.faktoren.map((f) => ({ tag, von: f.von, nach: f.nach, kurs: faktorAlsZahl(f, 8), kursDatum: f.kursDatum, weg: f.weg }));
}

function lueckenVon(verwendung: SichtLuecke["verwendung"], tag: string, l: readonly Kursluecke[]): SichtLuecke[] {
  return l.map((x) => ({ verwendung, tag, von: x.von, nach: x.nach, grund: x.grund, letzterKursDatum: x.letzterKursDatum }));
}

const doppelt = (a: SichtLuecke, b: SichtLuecke) => a.verwendung === b.verwendung && a.tag === b.tag && a.von === b.von && a.nach === b.nach;
const eindeutig = (l: SichtLuecke[]) => l.filter((x, i) => l.findIndex((y) => doppelt(x, y)) === i);

interface Eingang {
  roh: Roh;
  stichtag: string;
  stand: string | undefined;
  vorgaenge: VorgangRoh[];
  bewertungen: BewertungRoh[];
  forderungen: Decimal;
  kurse: readonly Wechselkurs[];
  vergleich: string | null;
  haus: string;
}

/** Reine Rechnung einer Beteiligung aus den geladenen Zeilen. */
function rechne(e: Eingang): Beteiligungssicht {
  const f = e.roh.fonds_waehrung;
  const l = e.roh.waehrung ?? f;
  const kontext = { fondsWaehrung: f, lokalWaehrung: l, vergleichsWaehrung: e.vergleich, kurse: e.kurse };
  const hausKontext = { ...kontext, vergleichsWaehrung: e.haus };
  const luecken: SichtLuecke[] = [];
  const hausLuecken: SichtLuecke[] = [];
  /** Betrag eines Postens in der Hauswährung (gleiche Regeln wie die Vergleichswährung); Lücken landen in `hausLuecken`. */
  const inHaus = (verwendung: SichtLuecke["verwendung"], posten: Parameters<typeof sichtenFuerPosten>[0]) => {
    const h = sichtenFuerPosten(posten, hausKontext);
    hausLuecken.push(...lueckenVon(verwendung, posten.datum, h.luecken.filter((x) => x.nach === e.haus)));
    return h.vergleich;
  };

  const vorgaenge: SichtVorgang[] = e.vorgaenge.map((v) => {
    const posten = { datum: v.valuta, fonds: v.betrag, lokal: v.betrag_lokal };
    const s = sichtenFuerPosten(posten, kontext);
    luecken.push(...lueckenVon("kosten", v.valuta, s.luecken));
    return { id: v.id, art: v.art, valuta: v.valuta, betrag: { fonds: s.fonds.toFixed(2), lokal: text(s.lokal), vergleich: text(s.vergleich), haus: text(inHaus("kosten", posten)) }, gebuchterKurs: v.kurs === null ? null : new Decimal(v.kurs).toFixed(), kurse: kursInfo(v.valuta, s) };
  });
  const summe = (arten: readonly string[]): Betraege => {
    const zeilen = e.vorgaenge.map((v, i) => ({ v, s: vorgaenge[i]! })).filter((x) => arten.includes(x.v.art) && !x.v.geldlos);
    const fonds = zeilen.reduce((acc, x) => acc.plus(x.v.betrag), new Decimal(0));
    return {
      fonds: fonds.toFixed(2),
      lokal: text(summeMitLuecken(zeilen.map((x) => x.s.betrag.lokal))),
      vergleich: e.vergleich === null ? null : text(summeMitLuecken(zeilen.map((x) => x.s.betrag.vergleich))),
      haus: text(summeMitLuecken(zeilen.map((x) => x.s.betrag.haus))),
    };
  };

  // Bewertungen bis zum Stichtag, aufsteigend; die letzte gilt (wie in den Kennzahlen).
  const verlauf: SichtBewertung[] = [];
  let vorige: { lokal: Decimal; kurs: Decimal } | null = null;
  for (const w of e.bewertungen) {
    const posten = { datum: w.stichtag, fonds: w.wert, lokal: w.wert_lokal };
    const s = sichtenFuerPosten(posten, kontext);
    luecken.push(...lueckenVon("zeitwert", w.stichtag, s.luecken));
    const haus = inHaus("zeitwert", posten);
    // Effektiver Kurs dieser Bewertung (Fondswährung je lokaler Einheit): der festgehaltene, sonst aus den beiden Beträgen.
    const kurs = s.lokal !== null && !s.lokal.isZero() ? s.fonds.div(s.lokal) : null;
    let fx: SichtBewertung["fx"] = null;
    if (l !== f && s.lokal !== null && kurs !== null && vorige) {
      const z = zerlegeFxEffekt({ wertAltLokal: vorige.lokal, wertNeuLokal: s.lokal, kursAlt: vorige.kurs, kursNeu: kurs });
      fx = { gesamt: z.gesamt, wert: z.wert, waehrung: z.waehrung };
    }
    vorige = s.lokal !== null && kurs !== null ? { lokal: s.lokal, kurs } : null;
    verlauf.push({ stichtag: w.stichtag, wert: { fonds: s.fonds.toFixed(2), lokal: text(s.lokal), vergleich: text(s.vergleich), haus: text(haus) }, gebuchterKurs: w.kurs === null ? null : new Decimal(w.kurs).toFixed(), kurse: kursInfo(w.stichtag, s), fx });
  }

  const ausgeschieden = e.roh.status === "exit" && (e.roh.durch_verkauf || e.vorgaenge.some((v) => v.art === "rueckfluss" && new Decimal(v.betrag).gt(0)));
  const letzte = verlauf.length > 0 && !ausgeschieden ? verlauf[verlauf.length - 1]! : null;
  let bewertung: Betraege;
  let bewertungKurse: KursInfo[] = [];
  {
    // Zeitwert = letzte Bewertung (zum Kurs ihres Stichtags) plus offene Forderungen (zum Kurs des Stichtags der Ansicht); nach einem Exit 0.
    const teile: { fonds: Decimal; lokal: Decimal | null; vergleich: Decimal | null; haus: Decimal | null }[] = [];
    const dez = (x: string | null) => (x === null ? null : new Decimal(x));
    if (letzte) teile.push({ fonds: new Decimal(letzte.wert.fonds), lokal: dez(letzte.wert.lokal), vergleich: dez(letzte.wert.vergleich), haus: dez(letzte.wert.haus) });
    if (letzte) bewertungKurse = [...letzte.kurse];
    if (!e.forderungen.isZero()) {
      const posten = { datum: e.stichtag, fonds: e.forderungen, lokal: null };
      const s = sichtenFuerPosten(posten, kontext);
      luecken.push(...lueckenVon("zeitwert", e.stichtag, s.luecken));
      bewertungKurse.push(...kursInfo(e.stichtag, s));
      teile.push({ fonds: s.fonds, lokal: s.lokal, vergleich: s.vergleich, haus: inHaus("zeitwert", posten) });
    }
    bewertung = {
      fonds: teile.reduce((a, t) => a.plus(t.fonds), new Decimal(0)).toFixed(2),
      lokal: text(summeMitLuecken(teile.map((t) => t.lokal))),
      vergleich: e.vergleich === null ? null : text(summeMitLuecken(teile.map((t) => t.vergleich))),
      haus: text(summeMitLuecken(teile.map((t) => t.haus))),
    };
  }

  return {
    beteiligungId: e.roh.id,
    stichtag: e.stichtag,
    stand: e.stand ?? null,
    waehrungen: { fonds: f, lokal: l, vergleich: e.vergleich, haus: e.haus },
    kennzahlen: { investiert: summe(["auszahlung"]), rueckfluesse: summe([...RUECKFLUSS_ARTEN]), bewertung },
    bewertungKurse,
    kostenKurse: vorgaenge.filter((v, i) => ["auszahlung", ...RUECKFLUSS_ARTEN].includes(v.art) && !e.vorgaenge[i]!.geldlos).flatMap((v) => v.kurse),
    letzteBewertung: verlauf.length > 0 ? { wert: verlauf[verlauf.length - 1]!.wert, kurse: verlauf[verlauf.length - 1]!.kurse } : null,
    vorgaenge,
    bewertungen: verlauf,
    luecken: eindeutig(luecken),
    hausLuecken: eindeutig(hausLuecken),
  };
}

/** Lädt die Zeilen für mehrere Beteiligungen eines Fonds (oder eine) und die Kurse im nötigen Fenster. */
async function lade(tx: Tx, auswahl: { fondsId: string } | { beteiligungId: string }, stichtag: string, stand: string | undefined, vergleich: string | null, haus: string) {
  const { rows: stamm } = await tx.execute<Omit<Roh, "durch_verkauf">>(sql`
    SELECT b.id, b.organisation_id, o.name AS organisation_name, b.instrument::text AS instrument, b.status::text AS status, b.waehrung, f.waehrung AS fonds_waehrung
    FROM beteiligung b JOIN organisation o ON o.id = b.organisation_id JOIN fonds f ON f.id = b.fonds_id
    WHERE ${"fondsId" in auswahl ? sql`b.fonds_id = ${auswahl.fondsId} AND b.erstinvestment <= ${stichtag}::date` : sql`b.id = ${auswahl.beteiligungId}`}
    ORDER BY o.name, b.id`);
  // Status zum Stichtag und Wissensstand: dieselbe Entscheidung wie in Fondsübersicht und Exitliste.
  const wirksam = stamm.length === 0 ? new Map() : await ermittleBeteiligungsstatus(tx, auswahl, stichtag, stand);
  const roh: Roh[] = stamm.map((r) => ({ ...r, status: wirksam.get(r.id)?.status ?? r.status, durch_verkauf: wirksam.get(r.id)?.austritt?.durchVerkauf === true }));
  if (roh.length === 0) return { roh, vorgaenge: [] as VorgangRoh[], bewertungen: [] as BewertungRoh[], forderungen: new Map<string, Decimal>(), kurse: [] as Wechselkurs[] };
  const ids = roh.map((r) => r.id);
  const liste = sql`ANY(ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::uuid[])`;
  const { rows: vorgaenge } = await tx.execute<VorgangRoh>(sql`
    SELECT id, beteiligung_id, art::text AS art, valuta::text AS valuta, betrag::text AS betrag, betrag_lokal::text AS betrag_lokal, kurs::text AS kurs, ${geldlos("vorgang")} AS geldlos
    FROM vorgang WHERE beteiligung_id = ${liste} AND valuta <= ${stichtag}::date${bisStand(sql.raw("erfasst_am"), stand)} ORDER BY valuta, erfasst_am, id`);
  const { rows: bewertungen } = await tx.execute<BewertungRoh>(sql`
    SELECT w.beteiligung_id, w.stichtag::text AS stichtag, w.wert::text AS wert, w.wert_lokal::text AS wert_lokal, w.kurs::text AS kurs
    FROM bewertung w WHERE w.beteiligung_id = ${liste} AND w.stichtag <= ${stichtag}::date AND ${wirksameBewertung("w", stand)} ORDER BY w.stichtag`);
  const forderungen = new Map<string, Decimal>();
  const fr = await offeneForderungen(tx, "fondsId" in auswahl ? { fondsId: auswahl.fondsId } : { beteiligungId: auswahl.beteiligungId }, stichtag, stand);
  for (const x of fr) forderungen.set(x.beteiligung_id, new Decimal(x.summe));
  const tage = [stichtag, ...vorgaenge.map((v) => v.valuta), ...bewertungen.map((w) => w.stichtag)];
  const fenster = kursFenster(tage)!;
  const waehrungen = [...new Set([...roh.flatMap((r) => [r.fonds_waehrung, r.waehrung ?? r.fonds_waehrung]), ...(vergleich ? [vergleich] : []), haus, "EUR"])];
  // Nur nötig, wenn es überhaupt etwas umzurechnen gibt.
  const braucht = roh.some((r) => (r.waehrung ?? r.fonds_waehrung) !== r.fonds_waehrung || r.fonds_waehrung !== haus) || vergleich !== null;
  const kurse = braucht ? await ladeGueltigeKurse(tx, fenster.von, fenster.bis, { stand, waehrungen }) : [];
  return { roh, vorgaenge, bewertungen, forderungen, kurse };
}

export async function ladeBeteiligungSicht(tx: Tx, beteiligungId: string, o: { stichtag?: string | undefined; stand?: string | undefined; vergleich?: string | null | undefined }): Promise<Beteiligungssicht | null> {
  const [vorab] = (await tx.execute<{ fonds_id: string }>(sql`SELECT fonds_id FROM beteiligung WHERE id = ${beteiligungId}`)).rows;
  if (!vorab) return null;
  const stichtag = o.stichtag ?? (await standardStichtag(tx, vorab.fonds_id, o.stand));
  const vergleich = o.vergleich ?? null;
  const haus = await hauswaehrung(tx);
  const d = await lade(tx, { beteiligungId }, stichtag, o.stand, vergleich, haus);
  const roh = d.roh[0]!;
  return rechne({ roh, stichtag, stand: o.stand, vorgaenge: d.vorgaenge, bewertungen: d.bewertungen, forderungen: d.forderungen.get(roh.id) ?? new Decimal(0), kurse: d.kurse, vergleich, haus });
}

export interface FondsSichtZeile {
  beteiligungId: string;
  organisation: { id: string; name: string };
  instrument: string;
  lokalWaehrung: string;
  investiert: Betraege;
  rueckfluesse: Betraege;
  bewertung: Betraege;
  luecken: SichtLuecke[];
  hausLuecken: SichtLuecke[];
  bewertungKurse: KursInfo[];
  kostenKurse: KursInfo[];
  letzteBewertung: { wert: Betraege; kurse: KursInfo[] } | null;
}

export interface Fondssicht {
  fondsId: string;
  stichtag: string;
  stand: string | null;
  waehrungen: { fonds: string; vergleich: string | null; haus: string };
  zeilen: FondsSichtZeile[];
  /** Summen in Fondswährung und Vergleichswährung; die Summe in lokalen Währungen gibt es nicht (verschiedene Einheiten). Eine Lücke in einer Zeile macht die Vergleichssumme zur Lücke. */
  navVergleich: string | null;
  /** NAV des Fonds in der Hauswährung (Kurs des Stichtags); `null` ohne NAV, bei fehlendem Kurs oder wenn die Hauswährung die Fondswährung ist (dann gilt die NAV der Kennzahlen). */
  navHaus: string | null;
  summen: { investiert: Summe; rueckfluesse: Summe; bewertung: Summe };
  luecken: SichtLuecke[];
  hausLuecken: SichtLuecke[];
}

type Summe = { fonds: string; vergleich: string | null; haus: string | null };

export async function ladeFondsSicht(tx: Tx, fondsId: string, o: { stichtag?: string | undefined; stand?: string | undefined; vergleich?: string | null | undefined }): Promise<Fondssicht> {
  const stichtag = o.stichtag ?? (await standardStichtag(tx, fondsId, o.stand));
  const vergleich = o.vergleich ?? null;
  const haus = await hauswaehrung(tx);
  const d = await lade(tx, { fondsId }, stichtag, o.stand, vergleich, haus);
  const zeilen: FondsSichtZeile[] = d.roh.map((roh) => {
    const s = rechne({
      roh,
      stichtag,
      stand: o.stand,
      vorgaenge: d.vorgaenge.filter((v) => v.beteiligung_id === roh.id),
      bewertungen: d.bewertungen.filter((w) => w.beteiligung_id === roh.id),
      forderungen: d.forderungen.get(roh.id) ?? new Decimal(0),
      kurse: d.kurse,
      vergleich,
      haus,
    });
    return {
      beteiligungId: roh.id,
      organisation: { id: roh.organisation_id, name: roh.organisation_name },
      instrument: roh.instrument,
      lokalWaehrung: s.waehrungen.lokal,
      investiert: s.kennzahlen.investiert!,
      rueckfluesse: s.kennzahlen.rueckfluesse!,
      bewertung: s.kennzahlen.bewertung!,
      luecken: s.luecken,
      hausLuecken: s.hausLuecken,
      bewertungKurse: s.bewertungKurse,
      kostenKurse: s.kostenKurse,
      letzteBewertung: s.letzteBewertung,
    };
  });
  const summe = (wahl: (z: FondsSichtZeile) => Betraege): Summe => ({
    fonds: zeilen.reduce((a, z) => a.plus(wahl(z).fonds), new Decimal(0)).toFixed(2),
    vergleich: vergleich === null ? null : text(summeMitLuecken(zeilen.map((z) => wahl(z).vergleich))),
    haus: text(summeMitLuecken(zeilen.map((z) => wahl(z).haus))),
  });
  const fonds = d.roh[0]?.fonds_waehrung ?? (await fondsWaehrung(tx, fondsId));
  let navVergleich: string | null = null;
  let navHaus: string | null = null;
  // Die NAV nur rechnen, wenn eine Umrechnung gefragt ist (Vergleich oder Hauswährung ungleich Fondswährung).
  const { nav } = vergleich !== null || haus !== fonds ? await ladeNavBestandteile(tx, fondsId, stichtag, o.stand) : { nav: null };
  if (nav !== null) {
    if (vergleich !== null) {
      const kurs = await kursFuer(tx, fonds, vergleich, stichtag, o.stand);
      if (kurs.ok) navVergleich = konvertiere(nav, kurs.faktor).toFixed(2);
    }
    const kurs = await kursFuer(tx, fonds, haus, stichtag, o.stand);
    if (kurs.ok) navHaus = konvertiere(nav, kurs.faktor).toFixed(2);
  }
  return {
    fondsId,
    stichtag,
    stand: o.stand === undefined ? null : new Date(o.stand).toISOString(),
    waehrungen: { fonds, vergleich, haus },
    navVergleich,
    navHaus,
    zeilen,
    summen: { investiert: summe((z) => z.investiert), rueckfluesse: summe((z) => z.rueckfluesse), bewertung: summe((z) => z.bewertung) },
    luecken: eindeutig(zeilen.flatMap((z) => z.luecken)),
    hausLuecken: eindeutig(zeilen.flatMap((z) => z.hausLuecken)),
  };
}

async function fondsWaehrung(tx: Tx, fondsId: string): Promise<string> {
  const { rows } = await tx.execute<{ waehrung: string }>(sql`SELECT waehrung FROM fonds WHERE id = ${fondsId}`);
  return rows[0]?.waehrung ?? "EUR";
}
