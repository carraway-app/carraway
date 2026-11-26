import { aufCent, type Decimal, kapitalverlauf, wandlung as rechneWandlung, zinsenAufVerlauf, type Kapitalbewegung } from "@carraway/rechenkern";
import type { NeueAnteilsklasse, NeueBewertung, NeueDarlehenKondition, NeueFinanzierungsrunde, NeueRundenposition, NeuerVorgang, NeuesInstrument, NeueTranche } from "../index";
import { INSTRUMENT_BEZEICHNUNG } from "../instrument";
import type { Demodaten } from "./erzeuge";
import type { DemoTexte } from "./texte";
import { vehikelFuer } from "./vehikel";
import { abgeleiteteId, euro, plusTage, tagesnummer } from "./zufall";

/**
 * Das Portfolio-Modell im Demo-Bestand (`docs/portfolio-modell.md`). Der Generator erzeugt je Beteiligung zuerst ein Hauptinstrument mit allen
 * Vorgängen und Runden aus den Tranchen aller Fonds; dieser Durchlauf richtet das Ergebnis nach dem Modell aus. Er läuft am Ende, mit eigenem
 * Zufallsstrom und abgeleiteten Ids, damit alle übrigen Demo-Daten unverändert bleiben:
 *
 * - Eigenkapital (offene und stille Beteiligung): je Position des Fonds in einer Runde ein Eigenkapital-Instrument der Runde (mit Anteilsklasse),
 *   Zusage und Tranchen darauf. Darlehen stehen nie in einer Eigenkapitalrunde.
 * - Darlehen, Wandeldarlehen, Venture Debt und Gesellschafterdarlehen: eigene Brückenrunde (ohne Bewertung), Tranchen mit Bedingung, Zinsen.
 * - Wandlung: wie `apps/api/src/instrumente/wandlung.ts` (Rechenkern, gleiche Buchungen), Ziel ist ein neues Eigenkapital-Instrument derselben Beteiligung.
 * - Ein Unternehmen mit vollständiger Kette (Seed, Wandeldarlehen, Serie A durch Wandlung, Venture Debt, Folgerunde).
 * - Am selben Unternehmen je ein Beispiel für weitere Instrumente und Vorgänge (Issue 148): Optionsscheine zur Venture Debt (ohne Kaufpreis, nicht
 *   ausgeübt), ein SAFE als Brückenfinanzierung nach der Folgerunde (Zusage und Auszahlung, Wandlung offen) und eine Anteilsübertragung aus den
 *   Stammanteilen an ein Vehikel eines Co-Investors (ohne Geldfluss des Fonds). Ids abgeleitet, keine Zufallszahlen; außer dem SAFE fließt kein Geld.
 */

type V = NeuerVorgang & { id: string };
type Runde = NeueFinanzierungsrunde & { id: string };
type Position = NeueRundenposition & { id: string };
type Instrument = NeuesInstrument & { id: string };
type Tranche = NeueTranche & { id: string };
type Beteiligung = Demodaten["beteiligungen"][number];

const EIGENKAPITAL = new Set(["offene_beteiligung", "stille_beteiligung"]);
const DARLEHEN = new Set(["darlehen", "wandeldarlehen", "venture_debt", "gesellschafterdarlehen"]);
const RUNDEN_NAMEN = ["Seed-Runde", "Serie-A-Runde", "Serie-B-Runde", "Serie-C-Runde"];
const KLASSEN_KURZ = ["Seed", "Serie A", "Serie B", "Serie C"];
const BEDINGUNGEN = ["Unterzeichneter Vertrag", "Erreichen des Umsatzziels", "Freigabe durch den Beirat", "Nachweis der Produktzulassung", "Unterzeichnetes Term Sheet der nächsten Runde"];
const HEUTE = "2026-11-20";
const BEWERTUNG_BIS = "2026-09-30";

const cent = (wert: string | null | undefined) => Math.round(Number(wert ?? 0) * 100);
const gruppiere = <T>(liste: readonly T[], schluessel: (x: T) => string): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const x of liste) {
    const k = schluessel(x);
    const l = m.get(k);
    if (l) l.push(x);
    else m.set(k, [x]);
  }
  return m;
};
const jahrVon = (datum: string) => datum.slice(0, 4);
const nachDatum = (a: { datum: string; id: string }, b: { datum: string; id: string }) => a.datum.localeCompare(b.datum) || a.id.localeCompare(b.id);
const instrumentStatus = (status: Beteiligung["status"]): NonNullable<NeuesInstrument["status"]> => (status === "aktiv" || status === undefined ? "aktiv" : status === "exit" ? "verkauft" : "abgeschrieben");

export interface ModellOptionen {
  seed: number;
  /** Index in `d.vorgaenge`, ab dem die Zahlungen des Mengen-Referenzdatensatzes stehen (neue Vorgänge kommen davor). */
  mengenStart: number;
  tx: DemoTexte;
}

/** Zusätzliche Zahlungen des Mengen-Referenzdatensatzes bleiben auf dem ersten Instrument (rein für Messungen). */
const MENGEN_BEMERKUNG = "Zahlung (Mengen-Referenz)";

export function richteModellAus(d: Demodaten, optionen: ModellOptionen): void {
  const { tx } = optionen;
  const modellId = (basis: string, schluessel: string) => abgeleiteteId(basis, `modell:${schluessel}`);

  const vorne = d.vorgaenge.slice(0, optionen.mengenStart) as V[];
  const hinten = d.vorgaenge.slice(optionen.mengenStart);
  const neu: V[] = [];
  const geloescht = new Set<string>();
  const betMap = new Map(d.beteiligungen.map((b) => [b.id, b]));
  const betJeFondsOrg = new Map(d.beteiligungen.map((b) => [`${b.fondsId}|${b.organisationId}`, b]));
  const fondsIndex = new Map(d.fonds.map((f, i) => [f.id, i]));
  const investoren = d.organisationen.filter((o) => o.art === "investor");
  const instJe = gruppiere(d.instrumente as Instrument[], (i) => i.beteiligungId);
  const vorgJe = gruppiere(vorne, (v) => v.beteiligungId);
  const trJe = gruppiere(d.tranchen as Tranche[], (t) => t.beteiligungId);
  const runden = d.finanzierungsrunden as Runde[];
  const rundeMap = new Map(runden.map((r) => [r.id, r]));
  const positionen = d.rundenpositionen as Position[];
  const klassen = d.anteilsklassen as (NeueAnteilsklasse & { id: string })[];
  const konv = new Map<string, (preis: string) => { betrag: string; anteile: string }>();
  const preFn = new Map<string, (davor: number, letztePost: number) => number>();
  const konvRunden = new Set<string>();
  const abrufDeltas: { fondsId: string; valuta: string; cent: number }[] = [];

  /**
   * Beispiele für SAFE, Optionsscheine und Anteilsübertragung am Schaufenster (nach dem Rechnen der Runden, damit Preise und Anteile feststehen).
   * Ids sind abgeleitet; Vorgänge kommen mit eigenen Schlüsseln dazu (der laufende Zähler der übrigen bleibt unberührt). Bewertungen und Abrufe
   * bleiben, wie sie sind.
   */
  const weitereInstrumente = (x: { b: Beteiligung; vd: Instrument; vdStart: string; r2: Runde; rb: Runde }) => {
    const { b, vd, vdStart, r2, rb } = x;
    const beispielId = (schluessel: string) => abgeleiteteId(b.id, `beispiel:${schluessel}`);
    // Optionsscheine zur Venture Debt: 15.000 Anteile zum Preis der Serie A, sieben Jahre Laufzeit, kein Kaufpreis (kein Vorgang).
    const ausgabe = vdStart;
    const laufzeit = `${Number(ausgabe.slice(0, 4)) + 7}${ausgabe.slice(4)}`;
    legeInstrumentAn(b, "optionsschein", {
      art: "optionsschein",
      bezeichnung: `Optionsscheine zur ${vd.bezeichnung}`,
      rundeId: vd.rundeId ?? null,
      status: "aktiv",
      optionsscheinAnzahl: "15000",
      ausuebungspreis: r2.preisJeAnteil as string,
      ausgabeAm: ausgabe,
      laufzeitBis: laufzeit,
      erstelltAm: new Date(`${ausgabe}T08:00:00Z`),
    });
    // SAFE als Brücke nach der Serie B: 150.000 mit 20 % Abschlag und Bewertungsobergrenze beim 1,2-Fachen des Post-Money der Serie B, noch nicht gewandelt.
    const safeDatum = plusTage(rb.datum, 45) <= BEWERTUNG_BIS ? plusTage(rb.datum, 45) : BEWERTUNG_BIS;
    const obergrenze = euro(Math.round((cent(rb.postMoney) * 1.2) / 100_000_000) * 100_000_000);
    const safe = legeInstrumentAn(b, "safe", { art: "safe", bezeichnung: `SAFE ${jahrVon(safeDatum)}`, status: "aktiv", wandlungsabschlag: "0.200000", bewertungsobergrenze: obergrenze, erstelltAm: new Date(`${safeDatum}T08:00:00Z`) });
    bruecke(b, safe.id, `SAFE ${jahrVon(safeDatum)}`, safeDatum);
    for (const art of ["zusage", "auszahlung"] as const) {
      const zeile: V = { id: beispielId(`safe-${art}`), beteiligungId: b.id, instrumentId: safe.id, art, valuta: safeDatum, betrag: euro(15_000_000), bemerkung: art === "zusage" ? "Zusage SAFE" : "Auszahlung SAFE" };
      neu.push(zeile);
      vorgJe.set(b.id, [...(vorgJe.get(b.id) ?? []), zeile]);
    }
    // Bewusst ohne Anpassung der Abrufe (anders als die übrigen Auszahlungen des Schaufensters): Ein zusätzlicher Abruf verschöbe die Zahlungen der
    // Investoren, auf die das Demo-Drehbuch Bezug nimmt. Die Auszahlung kommt aus der Liquidität des Fonds.
    // Anteilsübertragung: Gründer geben 30.000 Stammanteile zu 80 % des Preises der Serie A an ein Vehikel eines Co-Investors ab (Datum zwischen Serie A und B).
    const kaeufer = investoren[(Math.abs(tagesnummer(r2.datum)) + 1) % Math.max(1, investoren.length)];
    const uDatum = plusTage(r2.datum, 120) < rb.datum ? plusTage(r2.datum, 120) : plusTage(r2.datum, 1);
    if (kaeufer) {
      const preis = (Number(r2.preisJeAnteil) * 0.8).toFixed(4);
      const kaufpreis = euro(Math.round(30_000 * Number(preis) * 100));
      d.anteilsuebertragungen.push({ id: beispielId("uebertragung"), organisationId: b.organisationId, datum: uDatum, kaeuferVehikelId: vehikelFuer(d.vehikel, kaeufer.id, beispielId("uebertragung")), anzahl: "30000", preisJeAnteil: `${preis}00`, kaufpreis, bemerkung: tx.uebertragung });
    }
  };

  // Hilfen ------------------------------------------------------------------------------------------------------
  const hauptInstrument = (b: Beteiligung) => (instJe.get(b.id) ?? [])[0] as Instrument;
  let zaehler = 0;
  const vorgang = (b: Beteiligung, instrumentId: string, art: NonNullable<NeuerVorgang["art"]>, valuta: string, betragCent: number, bemerkung: string, extra: Partial<NeuerVorgang> = {}): V => {
    const zeile: V = { id: modellId(b.id, `vorgang-${zaehler++}`), beteiligungId: b.id, instrumentId, art, valuta, betrag: euro(betragCent), bemerkung, ...extra };
    neu.push(zeile);
    vorgJe.set(b.id, [...(vorgJe.get(b.id) ?? []), zeile]);
    return zeile;
  };
  const legeInstrumentAn = (b: Beteiligung, schluessel: string, werte: Omit<Instrument, "id" | "beteiligungId">): Instrument => {
    const i: Instrument = { id: modellId(b.id, `instrument-${schluessel}`), beteiligungId: b.id, ...werte };
    d.instrumente.push(i);
    instJe.set(b.id, [...(instJe.get(b.id) ?? []), i]);
    return i;
  };
  const trancheAnlegen = (b: Beteiligung, instrumentId: string, schluessel: string, werte: Omit<Tranche, "id" | "beteiligungId" | "instrumentId">): Tranche => {
    const t: Tranche = { id: modellId(b.id, `tranche-${schluessel}`), beteiligungId: b.id, instrumentId, ...werte };
    d.tranchen.push(t);
    trJe.set(b.id, [...(trJe.get(b.id) ?? []), t]);
    return t;
  };
  const neueRunde = (organisationId: string, schluessel: string, werte: Omit<Runde, "id" | "organisationId">): Runde => {
    const r: Runde = { id: modellId(organisationId, `runde-${schluessel}`), organisationId, ...werte };
    runden.push(r);
    rundeMap.set(r.id, r);
    return r;
  };
  const neuePosition = (rundeId: string, schluessel: string, werte: Omit<Position, "id" | "rundeId">): Position => {
    const p: Position = { id: modellId(rundeId, `position-${schluessel}`), rundeId, ...werte };
    positionen.push(p);
    return p;
  };
  const bruecke = (b: Beteiligung, instrumentId: string, bezeichnung: string, datum: string): Runde => {
    const r = neueRunde(b.organisationId, `bruecke-${instrumentId}`, { bezeichnung, datum, art: "bruecke" });
    d.instrumente.find((i) => i.id === instrumentId)!.rundeId = r.id;
    return r;
  };
  const kondition = (b: Beteiligung, instrumentId: string, werte: Omit<NeueDarlehenKondition, "beteiligungId" | "instrumentId">): void => {
    d.darlehenKonditionen.push({ id: modellId(instrumentId, "kondition"), beteiligungId: b.id, instrumentId, gewinnabhaengigSatz: null, kappungSatz: null, ...werte });
  };
  const rundeFuerVorgang = (vorgangId: string, rundeId: string) => d.vorgangRunden.push({ vorgangId, rundeId });

  /** Tranchen eines Instruments nach Datum nummerieren und benennen; die Auszahlungen mit dem alten Namen ziehen mit. */
  const nummeriere = (b: Beteiligung, instrumentId: string, erstauszahlung: boolean) => {
    const liste = (trJe.get(b.id) ?? []).filter((t) => t.instrumentId === instrumentId).sort((x, y) => (x.geplantAm ?? "").localeCompare(y.geplantAm ?? "") || x.id.localeCompare(y.id));
    liste.forEach((t, i) => {
      const alt = t.bezeichnung;
      t.nummer = i + 1;
      t.bezeichnung = erstauszahlung && i === 0 ? "Erstauszahlung" : `Tranche ${i + 1}`;
      if (alt !== t.bezeichnung) for (const v of vorne) if (v.trancheId === t.id && v.bemerkung === alt) v.bemerkung = t.bezeichnung;
    });
  };

  /** Zinsbuchungen je Periodenende mit dem Rechenkern (wie der Zinslauf); die Zahlung folgt 14 Tage später, die jüngste Buchung bleibt offen. */
  const zinsReihe = (b: Beteiligung, instrumentId: string, text: string, bewegungen: Kapitalbewegung[], von: string, enden: string[], satz: string, methode: "30E/360" | "act/365" | "act/360" | "act/act", bar: boolean) => {
    const verlauf = kapitalverlauf(bewegungen).wert;
    let vorher = von;
    const gebucht: V[] = [];
    for (const ende of enden) {
      const z = aufCent(zinsenAufVerlauf(verlauf, vorher, ende, { satzFix: satz, methode }).betragGesamt);
      vorher = ende;
      if (!z.greaterThan(0)) continue;
      const zeile = vorgang(b, instrumentId, "zins", ende, Math.round(Number(z.toFixed(2)) * 100), `${text} bis ${ende}`);
      gebucht.push(zeile);
    }
    if (bar) {
      for (const z of gebucht.slice(0, -1)) {
        if (plusTage(z.valuta, 14) > HEUTE) continue;
        vorgang(b, instrumentId, "zinszahlung", plusTage(z.valuta, 14), cent(z.betrag), `Zinszahlung zu den Zinsen bis ${z.valuta}`, { beglichenVorgangId: z.id });
      }
    }
    return gebucht;
  };

  // Planung: Beteiligungen, Positionen -----------------------------------------------------------------------------
  const posVonFonds = (b: Beteiligung) =>
    positionen
      .filter((p) => p.fondsId === b.fondsId && rundeMap.get(p.rundeId)?.organisationId === b.organisationId)
      .map((p) => ({ p, r: rundeMap.get(p.rundeId) as Runde }))
      .sort((x, y) => nachDatum(x.r, y.r));
  const gezahlt = (b: Beteiligung, instrumentId?: string) =>
    (vorgJe.get(b.id) ?? []).filter((v) => v.art === "auszahlung" && (instrumentId === undefined || v.instrumentId === instrumentId));

  // Schaufenster: Unternehmen mit der ganzen Kette. Ein aktives Wandeldarlehen mit zwei Runden des Fonds, bevorzugt im jüngsten Fonds.
  let schau: { b: Beteiligung; r1: Runde; p1: Position; r2: Runde; p2: Position } | undefined;
  for (const b of d.beteiligungen) {
    if (b.instrument !== "wandeldarlehen" || b.status !== "aktiv") continue;
    const ps = posVonFonds(b);
    const [e1, e2] = ps;
    if (!e1 || !e2 || ps.length !== 2 || (trJe.get(b.id) ?? []).length !== 2) continue;
    if (e2.r.datum < "2024-06-01" || e2.r.datum > "2025-12-31" || e2.r.datum < plusTage(e1.r.datum, 60)) continue;
    if (schau && (fondsIndex.get(schau.b.fondsId) ?? 0) >= (fondsIndex.get(b.fondsId) ?? 0)) continue;
    schau = { b, r1: e1.r, p1: e1.p, r2: e2.r, p2: e2.p };
  }

  // Darlehen verlieren ihre Positionen in Eigenkapitalrunden (nur der Schaufenster-Fonds behält seine); Runden ohne Position eines Fonds mit Eigenkapital fallen weg.
  const entfernePosition = new Set<string>();
  for (const p of positionen) {
    if (!p.fondsId) continue;
    const r = rundeMap.get(p.rundeId);
    const b = r ? betJeFondsOrg.get(`${p.fondsId}|${r.organisationId}`) : undefined;
    if (b && DARLEHEN.has(b.instrument ?? "") && b !== schau?.b) entfernePosition.add(p.id);
  }
  let rest = positionen.filter((p) => !entfernePosition.has(p.id));
  const mitFonds = new Set(rest.filter((p) => p.fondsId).map((p) => p.rundeId));
  const entfernteRunden = new Set(runden.filter((r) => !mitFonds.has(r.id)).map((r) => r.id));
  rest = rest.filter((p) => !entfernteRunden.has(p.rundeId));
  positionen.length = 0;
  positionen.push(...rest);
  runden.splice(0, runden.length, ...runden.filter((r) => !entfernteRunden.has(r.id)));
  const genutzt = new Set(positionen.map((p) => p.anteilsklasseId).filter(Boolean));
  klassen.splice(0, klassen.length, ...klassen.filter((k) => genutzt.has(k.id)));
  rundeMap.clear();
  for (const r of runden) rundeMap.set(r.id, r);

  const rundenJeOrg = () => gruppiere(runden.filter((r) => r.art !== "bruecke"), (r) => r.organisationId);
  const klasseFuerNeueRunde = (organisationId: string, rundeId: string, index: number) => {
    const namen = new Set(klassen.filter((k) => k.organisationId === organisationId).map((k) => k.name));
    let name = `${KLASSEN_KURZ[index] ?? `Runde ${index + 1}`}-Vorzugsanteile`;
    if (namen.has(name)) name = `${name} (${rundeId.slice(0, 4)})`;
    const klasse = { id: modellId(rundeId, "klasse"), organisationId, name, rang: 1, praeferenzFaktor: "1", partizipierend: false, capFaktor: null, kumulierteVerzinsung: null, umwandelbar: true };
    klassen.push(klasse);
    return klasse.id;
  };

  /** Wandlung wie die API: Rechenkern, Buchungen, Zeile `wandlung`, Position des Fonds in der Zielrunde, Quelle gewandelt. Läuft, sobald der Rundenpreis feststeht. */
  const wandle = (b: Beteiligung, quelle: Instrument, ziel: Instrument, runde: Runde, position: Position, cutoff: string, zinsenWandeln: boolean, discount: string) => (preis: string) => {
    const zeilen = (vorgJe.get(b.id) ?? []).filter((v) => v.instrumentId === quelle.id && !geloescht.has(v.id));
    const kond = d.darlehenKonditionen.find((k) => k.instrumentId === quelle.id)!;
    // Storno und stornierter Vorgang heben sich auf und bleiben außen vor.
    const storniert = new Set(zeilen.flatMap((v) => (v.storniertVorgangId ? [v.storniertVorgangId, v.id] : [])));
    const bewegungen: Kapitalbewegung[] = zeilen.filter((v) => !storniert.has(v.id)).filter((v) => v.art === "auszahlung" || v.art === "tilgung").map((v) => ({ datum: v.valuta, art: v.art === "auszahlung" ? "auszahlung" : "tilgung", betrag: v.betrag as string }));
    const gebuchtBis = zeilen.filter((v) => v.art === "zins" && v.valuta <= cutoff).map((v) => v.valuta).sort().at(-1);
    const e = rechneWandlung({
      bewegungen,
      bedingungen: { satzFix: kond.satzFix as string, methode: kond.methode as "30E/360" },
      cutoff,
      zinsenWandeln,
      preisregel: { rundenpreisJeAnteil: preis, discount },
      nennwertJeAnteil: "1",
      ...(gebuchtBis ? { zinsenAb: gebuchtBis } : {}),
    });
    for (const v of zeilen) if ((v.art === "zins" || v.art === "zinszahlung") && v.valuta > cutoff) geloescht.add(v.id);
    const spitz = aufCent(e.spitzenbetrag);
    const umgewandelt = e.wandlungsbetrag.minus(spitz);
    const nominal = e.nominal;
    const agio = umgewandelt.minus(nominal);
    const wandlungId = modellId(b.id, `wandlung-${quelle.id}`);
    const kennung = "Wandlung";
    const zahl = (x: Decimal, stellen: number) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: stellen, maximumFractionDigits: stellen }).format(Number(x.toFixed(stellen)));
    const ids: Record<string, string> = {};
    let nummer = 0;
    const plan = (seite: "darlehen" | "ziel", art: "zins" | "tilgung" | "zusage" | "auszahlung", betrag: Decimal, bemerkung: string) => {
      if (!betrag.greaterThan(0)) return;
      const zeile = vorgang(b, seite === "darlehen" ? quelle.id : ziel.id, art, cutoff, Math.round(Number(betrag.toFixed(2)) * 100), bemerkung);
      rundeFuerVorgang(zeile.id, runde.id);
      ids[`${seite}_${art}_${nummer++}`] = zeile.id;
    };
    plan("darlehen", "zins", e.zinsenGebucht, `${kennung}: Zinsen bis zum Cut-off${zinsenWandeln ? " (werden gewandelt)" : " (werden ausgezahlt)"}`);
    plan("darlehen", "tilgung", e.restkapital.minus(spitz), `${kennung}: Tilgung durch Wandlung in Anteile`);
    plan("darlehen", "tilgung", spitz, `${kennung}: Spitzenbetrag ausgezahlt`);
    const tail = `(${zahl(e.anzahlAnteile, 0)} Anteile, Nominal ${zahl(nominal, 2)} €, Agio ${zahl(agio, 2)} €)`;
    plan("ziel", "zusage", umgewandelt, `${kennung}: Zusage aus Wandlung ${tail}`);
    plan("ziel", "auszahlung", umgewandelt, `${kennung}: Einlage aus Wandlung ${tail}`);
    quelle.status = "gewandelt";
    d.wandlungen.push({
      id: wandlungId,
      darlehenBeteiligungId: b.id,
      zielBeteiligungId: b.id,
      quellInstrumentId: quelle.id,
      zielInstrumentId: ziel.id,
      rundeId: runde.id,
      cutoff,
      zinsenWandeln,
      preisregel: { discount },
      nennwertJeAnteil: "1.00",
      anzahlAnteile: e.anzahlAnteile.toFixed(0),
      preisJeAnteil: e.preisJeAnteil.toFixed(),
      massgeblich: e.massgeblich,
      wandlungsbetrag: e.wandlungsbetrag.toFixed(2),
      nominal: nominal.toFixed(2),
      agio: agio.toFixed(2),
      spitzenbetrag: spitz.toFixed(2),
      zinsenGebucht: e.zinsenGebucht.toFixed(2),
      ergebnis: JSON.parse(JSON.stringify(e)),
      vorgaenge: ids,
    });
    position.instrumentId = ziel.id;
    return { betrag: umgewandelt.toFixed(2), anteile: e.anzahlAnteile.toFixed(0) };
  };

  /** Das Ziel einer Wandlung: neues Eigenkapital-Instrument der Zielrunde, benannt wie in der API. */
  const zielInstrument = (b: Beteiligung, runde: Runde, klasseId: string | null, schluessel: string) =>
    legeInstrumentAn(b, schluessel, { art: "offene_beteiligung", bezeichnung: `${runde.bezeichnung}-Anteile`, rundeId: runde.id, anteilsklasseId: klasseId, status: "aktiv", erstelltAm: new Date(`${runde.datum}T08:00:00Z`) });

  // Schaufenster ------------------------------------------------------------------------------------------------
  const umgestellt = new Set<string>();
  let schauBewertung: (() => void) | undefined;
  let weitere: { b: Beteiligung; vd: Instrument; vdStart: string; r2: Runde; rb: Runde } | undefined;
  if (schau) {
    const { b, r1, p1, r2, p2 } = schau;
    const fonds = b.fondsId;
    const haupt = hauptInstrument(b);
    const alteTr = (trJe.get(b.id) ?? []).slice().sort((x, y) => (x.geplantAm ?? "").localeCompare(y.geplantAm ?? ""));
    const t1 = alteTr[0] as Tranche;
    const t2 = alteTr[1] as Tranche;
    // Zweite Tranche und ihre Auszahlung entfallen: an ihre Stelle tritt das Wandeldarlehen.
    const alteZusage = (vorgJe.get(b.id) ?? []).find((v) => v.art === "zusage") as V;
    const auszahlung2 = (vorgJe.get(b.id) ?? []).find((v) => v.trancheId === t2.id);
    if (auszahlung2) geloescht.add(auszahlung2.id);
    d.tranchen.splice(0, d.tranchen.length, ...d.tranchen.filter((t) => t.id !== t2.id));
    trJe.set(b.id, [t1]);
    // Zins- und Zahlungsbuchungen des Generators gehören zum alten Darlehen und entfallen.
    for (const v of vorgJe.get(b.id) ?? []) if (v.art === "zins" || v.art === "zinszahlung") geloescht.add(v.id);
    const altKond = d.darlehenKonditionen.findIndex((k) => k.beteiligungId === b.id);
    if (altKond >= 0) d.darlehenKonditionen.splice(altKond, 1);
    abrufDeltas.push({ fondsId: fonds, valuta: t2.geplantAm as string, cent: -cent(t2.betrag) });

    // 1. Seed-Anteile: Hauptinstrument wird Eigenkapital der Seed-Runde.
    haupt.art = "offene_beteiligung";
    haupt.bezeichnung = `${r1.bezeichnung}-Anteile`;
    haupt.rundeId = r1.id;
    haupt.anteilsklasseId = p1.anteilsklasseId ?? null;
    haupt.erstelltAm = new Date(`${r1.datum}T08:00:00Z`);
    p1.instrumentId = haupt.id;
    t1.instrumentId = haupt.id;
    nummeriere(b, haupt.id, true);
    for (const v of vorgJe.get(b.id) ?? []) if (v.art === "auszahlung" && v.trancheId === t1.id) v.instrumentId = haupt.id;
    alteZusage.betrag = euro(cent(t1.betrag));

    // 2. Wandeldarlehen 2024: zwei Tranchen mit Bedingung, 6 % nach 30E/360, Brückenrunde.
    const start = plusTage(r1.datum, 32);
    const zweite = plusTage(start, 28);
    const wd = legeInstrumentAn(b, "wandel", { art: "wandeldarlehen", bezeichnung: `Wandeldarlehen ${jahrVon(start)}`, status: "aktiv", erstelltAm: new Date(`${start}T08:00:00Z`) });
    bruecke(b, wd.id, `Wandeldarlehen ${jahrVon(start)}`, start);
    vorgang(b, wd.id, "zusage", start, 57_440_000, "Zusage Wandeldarlehen");
    const w1 = trancheAnlegen(b, wd.id, "w1", { nummer: 1, bezeichnung: "Tranche 1", betrag: "287200.00", geplantAm: start, bedingung: "Unterzeichnung des Vertrags", erfuelltAm: start });
    const w2 = trancheAnlegen(b, wd.id, "w2", { nummer: 2, bezeichnung: "Tranche 2", betrag: "287200.00", geplantAm: zweite, bedingung: "Unterzeichnetes Term Sheet der Serie A", erfuelltAm: plusTage(zweite, -4) });
    vorgang(b, wd.id, "auszahlung", start, 28_720_000, "Tranche 1", { trancheId: w1.id });
    vorgang(b, wd.id, "auszahlung", zweite, 28_720_000, "Tranche 2", { trancheId: w2.id });
    abrufDeltas.push({ fondsId: fonds, valuta: start, cent: 28_720_000 }, { fondsId: fonds, valuta: zweite, cent: 28_720_000 });
    kondition(b, wd.id, { gueltigAb: start, satzFix: "0.060000", methode: "30E/360", zinsperiode: "jaehrlich", anker: `${jahrVon(start)}-12-31`, faelligAm: plusTage(start, 730), kapitalisieren: false });

    // 3. Wandlung in die Serie A zum Cut-off der Runde (20 % Abschlag, Zinsen werden gewandelt).
    const klasseA = p2.anteilsklasseId ?? null;
    const ziel = zielInstrument(b, r2, klasseA, "serie-a");
    p2.anteilsklasseId = klasseA;
    p2.rolle = "co_lead";
    konv.set(p2.id, wandle(b, wd, ziel, r2, p2, r2.datum, true, "0.20"));
    konvRunden.add(r2.id);

    // 4. Venture Debt: Zusage 400.000, zwei Tranchen, 8 % act/360, Zinsen vierteljährlich in bar, Tilgung ab dem ersten Quartal 2026.
    const vdStart = plusTage(r2.datum, 134);
    const vdZweite = plusTage(vdStart, 121);
    const vd = legeInstrumentAn(b, "venture-debt", { art: "venture_debt", bezeichnung: `Venture Debt ${jahrVon(vdStart)}`, status: "aktiv", erstelltAm: new Date(`${vdStart}T08:00:00Z`) });
    bruecke(b, vd.id, `Venture Debt ${jahrVon(vdStart)}`, vdStart);
    vorgang(b, vd.id, "zusage", vdStart, 40_000_000, "Zusage Venture Debt");
    const v1 = trancheAnlegen(b, vd.id, "v1", { nummer: 1, bezeichnung: "Tranche 1", betrag: "250000.00", geplantAm: vdStart });
    const v2 = trancheAnlegen(b, vd.id, "v2", { nummer: 2, bezeichnung: "Tranche 2", betrag: "150000.00", geplantAm: vdZweite, bedingung: "Umsatzziel erreicht", erfuelltAm: plusTage(vdZweite, -5) });
    vorgang(b, vd.id, "auszahlung", vdStart, 25_000_000, "Tranche 1", { trancheId: v1.id });
    vorgang(b, vd.id, "auszahlung", vdZweite, 15_000_000, "Tranche 2", { trancheId: v2.id });
    abrufDeltas.push({ fondsId: fonds, valuta: vdStart, cent: 25_000_000 }, { fondsId: fonds, valuta: vdZweite, cent: 15_000_000 });
    const tilgungen = ["2026-03-31", "2026-06-30", "2026-09-30"].map((tag) => vorgang(b, vd.id, "tilgung", tag, 2_500_000, "Tilgungsrate Venture Debt"));
    kondition(b, vd.id, { gueltigAb: vdStart, satzFix: "0.080000", methode: "act/360", zinsperiode: "quartalsweise", anker: "2025-06-30", faelligAm: plusTage(vdStart, 1096), kapitalisieren: false });
    const enden = ["2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"].filter((tag) => tag > vdStart);
    const bew: Kapitalbewegung[] = [
      { datum: vdStart, art: "auszahlung", betrag: "250000" },
      { datum: vdZweite, art: "auszahlung", betrag: "150000" },
      ...tilgungen.map((t) => ({ datum: t.valuta, art: "tilgung" as const, betrag: t.betrag as string })),
    ];
    zinsReihe(b, vd.id, "Zinsen Venture Debt", bew, vdStart, enden, "0.08", "act/360", true);

    // 5. Folgerunde (Serie B) mit Anteilen des Fonds, zweite Tranche noch offen.
    const bDatum = plusTage(r2.datum, 512) <= "2026-09-30" ? plusTage(r2.datum, 512) : "2026-06-15";
    const rb = neueRunde(b.organisationId, "serie-b", { bezeichnung: RUNDEN_NAMEN[2] as string, datum: bDatum, art: "eigenkapital", preMoney: "0.00", postMoney: "0.00", preisJeAnteil: "0.0000", anteileGesamtNach: "0" });
    preFn.set(rb.id, (_davor, letztePost) => Math.round((letztePost * 1.35) / 10_000_000) * 10_000_000);
    const klasseB = klasseFuerNeueRunde(b.organisationId, rb.id, 2);
    const lead = investoren[Math.abs(tagesnummer(bDatum)) % Math.max(1, investoren.length)];
    if (lead) neuePosition(rb.id, "lead", { vehikelId: vehikelFuer(d.vehikel, lead.id, rb.id), betrag: "2500000.00", anteile: "0", rolle: "lead", anteilsklasseId: klasseB });
    const sb = legeInstrumentAn(b, "serie-b", { art: "offene_beteiligung", bezeichnung: `${rb.bezeichnung}-Anteile`, rundeId: rb.id, anteilsklasseId: klasseB, status: "aktiv", erstelltAm: new Date(`${bDatum}T08:00:00Z`) });
    const pb = neuePosition(rb.id, "fonds", { fondsId: fonds, betrag: "500000.00", anteile: "0", rolle: "co", anteilsklasseId: klasseB, instrumentId: sb.id });
    const bZweite = plusTage(bDatum, 183);
    vorgang(b, sb.id, "zusage", bDatum, 50_000_000, "Zusage Serie B");
    const s1 = trancheAnlegen(b, sb.id, "s1", { nummer: 1, bezeichnung: "Tranche 1", betrag: "300000.00", geplantAm: bDatum, erfuelltAm: bDatum });
    trancheAnlegen(b, sb.id, "s2", { nummer: 2, bezeichnung: "Tranche 2", betrag: "200000.00", geplantAm: bZweite, bedingung: "Meilenstein Produktfreigabe" });
    vorgang(b, sb.id, "auszahlung", bDatum, 30_000_000, "Tranche 1", { trancheId: s1.id });
    abrufDeltas.push({ fondsId: fonds, valuta: bDatum, cent: 30_000_000 });
    void pb;
    weitere = { b, vd, vdStart, r2, rb };

    // 6. Mitarbeiterbeteiligung: ESOP-Pool nach der Serie B (die Runden bleiben unverwässert gerechnet), Zuteilungen nach Kategorie ohne Namen.
    const poolDatum = plusTage(bDatum, 30);
    const poolId = modellId(b.organisationId, "esop");
    d.mitarbeiterpools.push({ id: poolId, organisationId: b.organisationId, art: "esop", bezeichnung: "ESOP", regel: "wie_anteile" });
    d.poolAenderungen.push({ id: modellId(poolId, "schaffung"), poolId, datum: poolDatum, anzahl: "120000", beschluss: "Gesellschafterbeschluss zur Schaffung des Pools" });
    d.mitarbeiterzuteilungen.push(
      { id: modellId(poolId, "fuehrung"), poolId, kategorie: "fuehrung", anzahl: "40000", basispreis: "1.0000", zugeteiltAm: poolDatum, cliffMonate: 12, vestingMonate: 48, beschleunigung: "1.0000", leaverRegel: "Good Leaver behält gevestete Optionen" },
      { id: modellId(poolId, "mitarbeitende"), poolId, kategorie: "mitarbeitende", anzahl: "35000", basispreis: "1.0000", zugeteiltAm: plusTage(poolDatum, 30), cliffMonate: 12, vestingMonate: 48 },
      { id: modellId(poolId, "beirat"), poolId, kategorie: "beirat", anzahl: "6000", basispreis: "0.0000", zugeteiltAm: poolDatum, cliffMonate: 0, vestingMonate: 24 },
    );

    // Bewertungen zum Quartalsende (Anschaffungskosten und Rundenpreis), nachdem die Runden gerechnet sind.
    schauBewertung = () => {
      const behalte = d.bewertungen.filter((x) => x.beteiligungId !== b.id);
      const posA = positionen.find((p) => p.id === p1.id) as Position;
      const posKonv = positionen.find((p) => p.id === p2.id) as Position;
      const posB = positionen.find((p) => p.rundeId === rb.id && p.fondsId === fonds) as Position;
      const rundenPreis = (datum: string) => {
        const gueltig = runden.filter((r) => r.organisationId === b.organisationId && r.art !== "bruecke" && r.datum <= datum).sort(nachDatum).at(-1);
        return gueltig ? Number(gueltig.preisJeAnteil) : 0;
      };
      const quartale = ["2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"].filter((q) => q > r1.datum && q <= BEWERTUNG_BIS);
      const aus: (NeueBewertung & { id: string })[] = quartale.map((q) => {
        const preis = rundenPreis(q);
        const anteile = Number(posA.anteile) + (r2.datum <= q ? Number(posKonv.anteile) : 0) + (bDatum <= q ? Number(posB.anteile) * (q >= bZweite ? 1 : 0.6) : 0);
        const wandelOffen = q >= start && q < r2.datum ? (q >= zweite ? 57_440_000 : 28_720_000) : 0;
        const vdKapital = (() => {
          let k = 0;
          if (q >= vdStart) k += 25_000_000;
          if (q >= vdZweite) k += 15_000_000;
          k -= 2_500_000 * tilgungen.filter((t) => t.valuta <= q).length;
          return k;
        })();
        const wertCent = Math.round(anteile * preis * 100 + wandelOffen + vdKapital);
        const methode: NonNullable<NeueBewertung["methode"]> = q < r2.datum ? "anschaffungskosten" : "letzte_runde";
        return {
          id: modellId(b.id, `bewertung-${q}`),
          beteiligungId: b.id,
          stichtag: q,
          wert: euro(Math.round(wertCent / 100) * 100),
          methode,
          begruendung: q < r2.datum ? tx.bewertung.anschaffungskosten : tx.bewertung.letzteRunde,
          status: "freigegeben" as const,
          erstelltVon: "demo",
          freigegebenVon: "demo",
        };
      });
      d.bewertungen.splice(0, d.bewertungen.length, ...behalte, ...aus);
    };
    umgestellt.add(b.id);
    b.instrument = "offene_beteiligung";
  }

  // Wandlung der übrigen Wandeldarlehen (jedes dritte, soweit der Cut-off in den Rahmen passt) ---------------------
  const wandelKandidaten = d.beteiligungen.filter((b) => b.instrument === "wandeldarlehen" && b.status === "aktiv" && b !== schau?.b).sort((x, y) => x.erstinvestment.localeCompare(y.erstinvestment) || x.id.localeCompare(y.id));
  wandelKandidaten.forEach((b, index) => {
    if (index % 3 !== 0) return;
    const zahlungen = gezahlt(b).filter((v) => !v.storniertVorgangId && cent(v.betrag) > 0);
    const letzte = zahlungen.map((v) => v.valuta).sort().at(-1);
    if (!letzte) return;
    const cutoff = plusTage(letzte, 150);
    const bestehend = rundenJeOrg().get(b.organisationId) ?? [];
    if (cutoff > BEWERTUNG_BIS || bestehend.some((r) => r.datum >= cutoff)) return;
    const quelle = hauptInstrument(b);
    const index2 = bestehend.length;
    const name = RUNDEN_NAMEN[index2] ?? `Runde ${index2 + 1}`;
    const r = neueRunde(b.organisationId, `wandlung-${b.id}`, { bezeichnung: name, datum: cutoff, art: "eigenkapital", preMoney: "0.00", postMoney: "0.00", preisJeAnteil: "0.0000", anteileGesamtNach: "0" });
    const investiert = zahlungen.reduce((s, v) => s + cent(v.betrag), 0);
    const faktor = 1.8 + (Math.abs(tagesnummer(cutoff)) % 20) / 10;
    preFn.set(r.id, (davor, letztePost) => (letztePost > 0 ? Math.round((letztePost * (1.15 + (Math.abs(tagesnummer(cutoff)) % 5) / 10)) / 10_000_000) * 10_000_000 : Math.max(1_000_000_000, Math.round((davor * 6.5 * 100) / 10_000_000) * 10_000_000)));
    const klasse = klasseFuerNeueRunde(b.organisationId, r.id, index2);
    const leadOrg = investoren[Math.abs(tagesnummer(cutoff)) % Math.max(1, investoren.length)];
    if (leadOrg) neuePosition(r.id, "lead", { vehikelId: vehikelFuer(d.vehikel, leadOrg.id, r.id), betrag: euro(Math.max(100_000_000, Math.round((investiert * faktor) / 10_000_000) * 10_000_000)), anteile: "0", rolle: "lead", anteilsklasseId: klasse });
    const ziel = zielInstrument(b, r, klasse, "wandlung");
    const pos = neuePosition(r.id, "fonds", { fondsId: b.fondsId, betrag: "0.00", anteile: "0", rolle: "co", anteilsklasseId: klasse, instrumentId: ziel.id });
    konv.set(pos.id, wandle(b, quelle, ziel, r, pos, cutoff, index % 2 === 0, "0.20"));
    konvRunden.add(r.id);
    umgestellt.add(b.id);
    b.instrument = "offene_beteiligung";
  });

  // Eigenkapital: je Position des Fonds ein Instrument der Runde -----------------------------------------------------
  for (const b of d.beteiligungen) {
    if (!EIGENKAPITAL.has(b.instrument ?? "") || umgestellt.has(b.id)) continue;
    const haupt = hauptInstrument(b);
    const ps = posVonFonds(b).filter((e) => e.p.instrumentId === undefined || e.p.instrumentId === haupt.id);
    const zeilen = (vorgJe.get(b.id) ?? []).filter((v) => v.bemerkung !== MENGEN_BEMERKUNG);
    const trs = trJe.get(b.id) ?? [];
    const status = instrumentStatus(b.status);
    if (ps.length === 0) {
      const erste = rundenJeOrg().get(b.organisationId)?.sort(nachDatum)[0];
      if (erste) {
        haupt.rundeId = erste.id;
        haupt.bezeichnung = EIGENKAPITAL.has(haupt.art) && haupt.art === "stille_beteiligung" ? `${INSTRUMENT_BEZEICHNUNG[haupt.art]} ${erste.bezeichnung}` : `${erste.bezeichnung}-Anteile`;
      }
      continue;
    }
    const instrumente = ps.map((e, k) => {
      const art = haupt.art;
      const bezeichnung = art === "stille_beteiligung" ? `${INSTRUMENT_BEZEICHNUNG[art]} ${e.r.bezeichnung}` : `${e.r.bezeichnung}-Anteile`;
      const werte = { art, bezeichnung, rundeId: e.r.id, anteilsklasseId: e.p.anteilsklasseId ?? null, status, erstelltAm: new Date(`${e.r.datum}T08:00:00Z`) };
      if (k === 0) {
        Object.assign(haupt, werte);
        return haupt;
      }
      return legeInstrumentAn(b, `eigenkapital-${k + 1}`, werte);
    });
    ps.forEach((e, k) => {
      e.p.instrumentId = (instrumente[k] as Instrument).id;
    });
    const fensterStart = ps.map((e) => e.r.datum);
    const fuerDatum = (datum: string) => {
      let k = 0;
      fensterStart.forEach((s, i) => {
        if (datum >= s) k = i;
      });
      return instrumente[k] as Instrument;
    };
    // Tranchen und Auszahlungen: nach dem Datum der Tranche
    const trancheInstrument = new Map<string, Instrument>();
    for (const t of trs) {
      const i = fuerDatum(t.geplantAm ?? b.erstinvestment);
      t.instrumentId = i.id;
      trancheInstrument.set(t.id, i);
    }
    const summeTr = new Map<string, { cent: number; erste: string }>();
    for (const t of trs) {
      const e = summeTr.get(t.instrumentId) ?? { cent: 0, erste: t.geplantAm ?? b.erstinvestment };
      e.cent += cent(t.betrag);
      if ((t.geplantAm ?? "") < e.erste) e.erste = t.geplantAm ?? e.erste;
      summeTr.set(t.instrumentId, e);
    }
    const originale = new Map(zeilen.map((v) => [v.id, v]));
    for (const v of zeilen) {
      let ziel: Instrument;
      if (v.trancheId) ziel = trancheInstrument.get(v.trancheId) ?? (instrumente[0] as Instrument);
      else if (v.storniertVorgangId && originale.get(v.storniertVorgangId)?.trancheId) ziel = trancheInstrument.get(originale.get(v.storniertVorgangId)?.trancheId as string) ?? (instrumente[0] as Instrument);
      else if (v.art === "rueckfluss") ziel = instrumente.at(-1) as Instrument;
      else ziel = fuerDatum(v.valuta);
      v.instrumentId = ziel.id;
    }
    // Zusage: der erste Instrument behält den Rest der ursprünglichen Zusage, die weiteren zusagen ihre Tranchen
    const zusage = zeilen.find((v) => v.art === "zusage");
    if (zusage) {
      let abgezogen = 0;
      instrumente.forEach((i, k) => {
        if (k === 0) return;
        const t = summeTr.get(i.id);
        if (!t) return;
        abgezogen += t.cent;
        vorgang(b, i.id, "zusage", t.erste, t.cent, "Zusage Folgerunde");
      });
      zusage.betrag = euro(cent(zusage.betrag) - abgezogen);
    }
    for (const i of instrumente) nummeriere(b, i.id, true);
  }

  // Darlehen: Brückenrunde, Bedingungen, Tilgung, Gesellschafterdarlehen ---------------------------------------------
  const plain = d.beteiligungen.filter((b) => b.instrument === "darlehen" && b.status === "aktiv" && b !== schau?.b).sort((x, y) => x.erstinvestment.localeCompare(y.erstinvestment) || x.id.localeCompare(y.id));
  const tilgungBei = new Set(plain.filter((b) => b.erstinvestment <= "2021-12-31" && (vorgJe.get(b.id) ?? []).some((v) => v.art === "zins")).slice(0, 2).map((b) => b.id));
  const gesellschafter = plain.filter((b) => !tilgungBei.has(b.id)).at(-1);
  for (const b of d.beteiligungen) {
    const haupt = hauptInstrument(b);
    if (!DARLEHEN.has(haupt.art) || b === schau?.b) continue;
    if (b === gesellschafter) {
      haupt.art = "gesellschafterdarlehen";
      b.instrument = "gesellschafterdarlehen";
    }
    const trs = (trJe.get(b.id) ?? []).filter((t) => t.instrumentId === haupt.id).sort((x, y) => (x.geplantAm ?? "").localeCompare(y.geplantAm ?? ""));
    const start = trs[0]?.geplantAm ?? b.erstinvestment;
    const name = `${INSTRUMENT_BEZEICHNUNG[haupt.art]} ${jahrVon(start)}`;
    haupt.bezeichnung = name;
    haupt.erstelltAm = new Date(`${start}T08:00:00Z`);
    const r = bruecke(b, haupt.id, name, start);
    void r;
    nummeriere(b, haupt.id, false);
    // Bedingungen: ab der zweiten Tranche, erfüllt vor der Auszahlung (bezahlte), die offenen bleiben offen
    const bezahlt = new Set((vorgJe.get(b.id) ?? []).filter((v) => v.art === "auszahlung" && v.trancheId).map((v) => v.trancheId));
    trs.forEach((t, i) => {
      if (i === 0) return;
      t.bedingung = BEDINGUNGEN[(Math.abs(tagesnummer(t.geplantAm ?? start)) + i) % BEDINGUNGEN.length] as string;
      if (bezahlt.has(t.id)) t.erfuelltAm = plusTage(t.geplantAm ?? start, -5);
      else delete t.erfuelltAm;
    });
    if (tilgungBei.has(b.id)) {
      const kapital = (vorgJe.get(b.id) ?? []).filter((v) => v.art === "auszahlung").reduce((s, v) => s + cent(v.betrag), 0);
      const rate = Math.round((kapital * 0.25) / 10_000) * 10_000;
      if (rate > 0) vorgang(b, haupt.id, "tilgung", "2026-03-31", rate, "Teiltilgung");
    }
  }

  // Stille Beteiligung: die erste aktive bekommt Konditionen und Zinsen (Beispiel).
  const stille = d.beteiligungen.find((b) => b.instrument === "stille_beteiligung" && b.status === "aktiv" && b.erstinvestment <= "2024-12-31");
  if (stille) {
    const i = hauptInstrument(stille);
    const zeilen = (vorgJe.get(stille.id) ?? []).filter((v) => v.instrumentId === i.id && v.art === "auszahlung" && !v.storniertVorgangId && cent(v.betrag) > 0);
    const erste = zeilen.map((v) => v.valuta).sort()[0];
    if (erste) {
      kondition(stille, i.id, { gueltigAb: erste, satzFix: "0.070000", methode: "30E/360", zinsperiode: "jaehrlich", anker: `${jahrVon(erste)}-12-31`, kapitalisieren: false });
      const enden: string[] = [];
      for (let j = Number(jahrVon(erste)); j <= 2025; j++) enden.push(`${j}-12-31`);
      zinsReihe(stille, i.id, "Zinsen stille Beteiligung", zeilen.map((v) => ({ datum: v.valuta, art: "auszahlung" as const, betrag: v.betrag as string })), erste, enden.filter((e) => e > erste), "0.07", "30E/360", true);
    }
  }

  // Runden rechnen: Preis, Anteile, Post-Money und Rollen neu, Kette je Unternehmen ----------------------------------------
  const posJeRunde = gruppiere(positionen, (p) => p.rundeId);
  for (const [, liste] of rundenJeOrg()) {
    liste.sort(nachDatum);
    let davor = 1_000_000;
    let letztePost = 0;
    for (const r of liste) {
      const pos = posJeRunde.get(r.id) ?? [];
      const pre0 = preFn.get(r.id)?.(davor, letztePost) ?? cent(r.preMoney);
      const preis = Math.round((pre0 / 100 / davor) * 10_000) / 10_000;
      for (const p of pos) {
        const f = konv.get(p.id);
        if (f) {
          const w = f(preis.toFixed(4));
          p.betrag = w.betrag;
          p.anteile = w.anteile;
        } else {
          p.anteile = String(Math.floor(cent(p.betrag) / 100 / preis));
        }
      }
      const volumen = pos.reduce((s, p) => s + cent(p.betrag), 0);
      const gesamt = davor + pos.reduce((s, p) => s + Number(p.anteile), 0);
      let post: number;
      let pre: number;
      if (konvRunden.has(r.id)) {
        post = Math.round(preis * gesamt * 100);
        pre = post - volumen;
      } else {
        pre = pre0;
        post = pre0 + volumen;
      }
      r.preMoney = euro(pre);
      r.postMoney = euro(post);
      r.preisJeAnteil = preis.toFixed(4);
      r.anteileGesamtNach = String(gesamt);
      const rang = pos.map((_, i) => i).sort((a, c) => cent((pos[c] as Position).betrag) - cent((pos[a] as Position).betrag) || a - c);
      pos.forEach((p, i) => {
        const platz = rang.indexOf(i);
        p.rolle = platz === 0 ? "lead" : platz === 1 && pos.length >= 3 ? "co_lead" : "co";
      });
      letztePost = post;
      davor = gesamt;
    }
  }
  schauBewertung?.();
  if (weitere) weitereInstrumente(weitere);

  // Abrufe des Fonds für geänderte Auszahlungen anpassen ------------------------------------------------------------
  for (const delta of abrufDeltas) {
    const jahr = delta.valuta.slice(0, 4);
    const q = Math.floor((Number(delta.valuta.slice(5, 7)) - 1) / 3);
    const valuta = `${jahr}-${String(q * 3 + 1).padStart(2, "0")}-05`;
    const abruf = d.fondsBewegungen.find((x) => x.fondsId === delta.fondsId && x.art === "abruf" && x.valuta === valuta);
    const zusatz = Math.round((delta.cent * 1.08) / 10_000) * 10_000;
    if (abruf) abruf.betrag = euro(Math.max(0, cent(abruf.betrag) + zusatz));
    else if (zusatz > 0) d.fondsBewegungen.push({ id: modellId(delta.fondsId, `abruf-${valuta}`), fondsId: delta.fondsId, art: "abruf", valuta, betrag: euro(zusatz), bemerkung: tx.abruf });
  }
  d.fondsBewegungen.splice(0, d.fondsBewegungen.length, ...d.fondsBewegungen.filter((x) => !(x.art === "abruf" && cent(x.betrag) === 0)));
  for (const f of d.fonds) {
    const abgerufen = d.fondsBewegungen.filter((x) => x.fondsId === f.id && x.art === "abruf").reduce((s, x) => s + cent(x.betrag), 0);
    if (abgerufen > cent(f.zeichnungskapital)) f.zeichnungskapital = euro(Math.ceil((abgerufen * 1.15) / 100_000_000) * 100_000_000);
  }

  // Beispiel für einen Vorgang ohne Runde: die letzte Zinszahlung des ersten einfachen Darlehens.
  const beispiel = [...vorne, ...neu]
    .filter((v) => v.art === "zinszahlung" && betMap.get(v.beteiligungId)?.instrument === "darlehen" && !geloescht.has(v.id))
    .sort((x, y) => x.valuta.localeCompare(y.valuta) || x.id.localeCompare(y.id))
    .at(-1);
  if (beispiel) d.vorgangOhneRunde.push(beispiel.id);

  d.vorgaenge = [...vorne.filter((v) => !geloescht.has(v.id)), ...neu, ...hinten];
}
