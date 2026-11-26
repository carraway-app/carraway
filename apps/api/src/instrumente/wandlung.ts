import { randomUUID } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { anteilsklasse, finanzierungsrunde, rundenposition, vorgang, wandlung, type Db } from "@carraway/db";
import { aufCent, Decimal, wandlung as rechneWandlung, type Wandlungsergebnis } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { letzteBewertung, setzeBewertung } from "./bewertung";
import { instrumenteVon, legeInstrumentAn, setzeInstrumentStatus, type InstrumentZeile } from "./instrumente";
import { pruefeStichtag } from "./stichtag";
import { ordneRundeZu } from "./vorgang-runde";
import { gebuchtePerioden, ladeZinskontexte, tagVor, versionAm } from "./zinsen";
import { alsFachfehler, berechneZustand, buchwertVon, ladeVorgaenge, verlangeAktiv, vorgaengeDesInstruments, type BeteiligungZeile } from "./zustand";

/**
 * Wandlung eines Wandeldarlehens (Entscheidung 63 bis 66). Quelle ist ein Wandeldarlehen-Instrument der Beteiligung (Status danach `gewandelt`),
 * Ziel ein neues Eigenkapital-Instrument derselben Beteiligung (Runde gesetzt); es entsteht keine zweite Beteiligung. Der Rechenkern liefert Zinsen bis zum Cut-off, Preis, Anteile,
 * Nominal, Agio und Spitzenbetrag ungerundet. Gebucht wird auf Cent:
 *   Spitzenbetrag gebucht = auf Cent gerundet, Wandelbetrag in Anteile = Wandlungsbetrag − Spitzenbetrag gebucht,
 *   Nominal = Anteile × Nennwert, Agio = Rest. So gehen die Buchungen auf den Cent auf.
 *
 * Vertraglich abweichende Beträge (Entscheidung 508): Die Abweichung gehört zur einzelnen Wandlung. Optional `gewandeltesDarlehen` und
 * `gewandelteZinsen` (je höchstens der errechnete Stand); Wandlungsbetrag = beides, Anteile = Wandlungsbetrag ÷ Preis wie bisher. Der Rest von
 * Darlehen und Zinsen wird `zurueckgezahlt` (Geldfluss: Tilgung bzw. Zinsbuchung mit Zinszahlung am Cut-off) oder `erlassen` (Darlehen: Tilgung
 * ohne Geldfluss, Schlüssel `darlehen_erlass_*`; Zinsen: gar nicht erst als Forderung gebucht, der Verzicht steht im Ergebnis der Wandlung).
 * Der Spitzenbetrag aus der Rundung bleibt der bar ausgezahlte Rest des gewandelten Darlehens.
 */

export interface WandlungsEingabe {
  cutoff: string;
  zinsenWandeln: boolean;
  preisregel: {
    rundenpreisJeAnteil?: string;
    discount?: string;
    bewertungsobergrenze?: { betrag: string; anteileVorRunde: string };
  };
  nennwertJeAnteil: string;
  runde: { id: string } | { neu: { bezeichnung: string; datum?: string; preMoney: string; postMoney: string; preisJeAnteil: string; anteileGesamtNach: string } };
  rolle: "lead" | "co_lead" | "co";
  /** Das Wandeldarlehen-Instrument; ohne Angabe das einzige aktive der Beteiligung (bei mehreren Pflicht). */
  instrumentId?: string | undefined;
  /** Anteilsklasse der neuen Anteile; ohne Angabe die eindeutige Klasse der übrigen Positionen der Runde (sonst keine). */
  anteilsklasseId?: string | undefined;
  /** Vertraglich abweichend gewandeltes Darlehen (0 bis zum Stand am Cut-off); ohne Angabe das ganze Darlehen. */
  gewandeltesDarlehen?: string | undefined;
  /** Vertraglich abweichend gewandelte Zinsen (0 bis zu den Zinsen bis zum Cut-off, nur mit `zinsenWandeln`); ohne Angabe alle, wenn `zinsenWandeln`. */
  gewandelteZinsen?: string | undefined;
  /** Was mit dem nicht gewandelten Darlehen geschieht; Standard `zurueckgezahlt`. */
  darlehenRest?: RestBehandlung | undefined;
  /** Was mit den nicht gewandelten Zinsen geschieht; Standard `zurueckgezahlt`. */
  zinsenRest?: RestBehandlung | undefined;
}

export type RestBehandlung = "zurueckgezahlt" | "erlassen";

export interface GeplanterVorgang {
  /** `darlehen`: bucht auf das Quell-Instrument, `ziel`: auf das neue Eigenkapital-Instrument (beide in derselben Beteiligung). */
  beteiligung: "darlehen" | "ziel";
  art: "zins" | "tilgung" | "zusage" | "auszahlung" | "zinszahlung";
  valuta: string;
  betrag: string;
  bemerkung: string;
  /** Mittelteil des Schlüssels in `wandlung.vorgaenge` (Standard: die Art); `rueckzahlung` und `erlass` für den Rest des Darlehens. */
  schluessel?: string;
  /** Name, unter dem spätere Vorgänge diesen begleichen. */
  ref?: string;
  /** Die Zinszahlung begleicht die Zinsbuchung mit dieser `ref`. */
  begleicht?: string;
}

export interface Wandlungsplan {
  ergebnis: Wandlungsergebnis;
  /** Gebuchte Beträge in Cent. */
  gebucht: { zinsen: Decimal; spitzenbetrag: Decimal; umgewandelt: Decimal; nominal: Decimal; agio: Decimal };
  vorgaenge: GeplanterVorgang[];
  runde: { id: string | null; organisationId: string; preisJeAnteil: string };
  /** Anteilsklasse der neuen Anteile (angegeben oder aus der Runde abgeleitet), sonst `null`. */
  anteilsklasseId: string | null;
  /** Die Beteiligung (Quelle und Ziel sind Instrumente in ihr). */
  zielBeteiligungId: string;
  quellInstrumentId: string;
  /** Das Ziel-Instrument entsteht erst mit der Buchung. */
  zielInstrumentId: string | null;
  /** Behandlung des nicht gewandelten Rests von Darlehen und Zinsen; `null`, wo nichts übrig bleibt. */
  restbehandlung: { darlehen: RestBehandlung | null; zinsen: RestBehandlung | null };
}

/** Die Antwort ist JSON: Dezimalzahlen des Rechenkerns werden dabei zu Zeichenketten. */
export const alsJson = <T>(wert: T): T => JSON.parse(JSON.stringify(wert)) as T;

async function ladeRunde(tx: Tx, b: BeteiligungZeile, eingabe: WandlungsEingabe) {
  if ("neu" in eingabe.runde) {
    const r = eingabe.runde.neu;
    return { id: null, organisationId: b.organisationId, preisJeAnteil: r.preisJeAnteil, neu: r };
  }
  const [r] = await tx.select().from(finanzierungsrunde).where(eq(finanzierungsrunde.id, eingabe.runde.id));
  if (!r) throw new Fachfehler(404, "RUNDE_NICHT_GEFUNDEN", "Finanzierungsrunde nicht gefunden.");
  if (r.organisationId !== b.organisationId) {
    throw new Fachfehler(409, "RUNDE_PASST_NICHT", "Die Runde gehört zu einem anderen Unternehmen als das Darlehen.");
  }
  if (r.art !== "eigenkapital" || r.preisJeAnteil === null) {
    throw new Fachfehler(409, "RUNDE_KEINE_EIGENKAPITALRUNDE", "Die Zielrunde einer Wandlung muss eine Eigenkapitalrunde sein, keine Brückenrunde.", { rundeId: r.id });
  }
  if (r.status !== "abgeschlossen") throw new Fachfehler(409, "RUNDE_NICHT_ABGESCHLOSSEN", "Die Runde ist noch nicht abgeschlossen.");
  const [vorhanden] = await tx.select({ id: rundenposition.id }).from(rundenposition).where(and(eq(rundenposition.rundeId, r.id), eq(rundenposition.fondsId, b.fondsId)));
  if (vorhanden) throw new Fachfehler(409, "RUNDENPOSITION_VORHANDEN", "Der Fonds hat in dieser Runde bereits eine Position.");
  return { id: r.id, organisationId: r.organisationId, preisJeAnteil: r.preisJeAnteil, neu: null };
}

/**
 * Anteilsklasse der neuen Anteile: angegeben (muss zum selben Unternehmen gehören wie die Beteiligung) oder, bei vorhandener Runde, die Klasse,
 * die alle übrigen Positionen der Runde mit Klasse gemeinsam haben; gibt es keine oder mehrere, bleibt sie leer.
 */
async function ladeKlasse(tx: Tx, b: BeteiligungZeile, rundeId: string | null, angegeben: string | undefined): Promise<string | null> {
  if (angegeben) {
    const [k] = await tx.select().from(anteilsklasse).where(eq(anteilsklasse.id, angegeben));
    if (!k) throw new Fachfehler(404, "ANTEILSKLASSE_NICHT_GEFUNDEN", "Anteilsklasse nicht gefunden.");
    if (k.organisationId !== b.organisationId) throw new Fachfehler(409, "ANTEILSKLASSE_PASST_NICHT", "Die Klasse gehört zu einem anderen Unternehmen als die Beteiligung.");
    return k.id;
  }
  if (!rundeId) return null;
  const klassen = await tx.selectDistinct({ id: rundenposition.anteilsklasseId }).from(rundenposition).where(and(eq(rundenposition.rundeId, rundeId), isNotNull(rundenposition.anteilsklasseId)));
  return klassen.length === 1 ? (klassen[0]!.id ?? null) : null;
}

/**
 * Prüfung des Cut-off, gemeinsam für Vorschau und Buchung: Datum im Rahmen des Fonds (nicht vor dem ersten Vorgang, höchstens
 * 366 Tage nach heute). Die Buchung verlangt zusätzlich „nicht nach heute“; die Vorschau darf ein späteres Datum rechnen und
 * meldet dann `buchbar: false`. Eine andere Prüfung gibt es nicht, damit Vorschau und Buchung nicht auseinanderlaufen.
 */
export async function pruefeCutoff(tx: Tx, fondsId: string, cutoff: string, optionen: { nichtNachHeute: boolean }) {
  await pruefeStichtag(tx, fondsId, cutoff, "cutoff", optionen.nichtNachHeute ? { nichtNachHeute: true } : {});
}

/** Das Wandeldarlehen, das gewandelt wird: angegeben oder das einzige aktive der Beteiligung. */
async function ladeQuelle(tx: Tx, b: BeteiligungZeile, instrumentId: string | undefined): Promise<InstrumentZeile> {
  const alle = await instrumenteVon(tx, b.id);
  if (instrumentId) {
    const i = alle.find((x) => x.id === instrumentId);
    if (!i) throw new Fachfehler(409, "INSTRUMENT_FALSCHE_BETEILIGUNG", "Das Instrument gehört zu einer anderen Beteiligung.", { instrumentId });
    if (i.art !== "wandeldarlehen") throw new Fachfehler(409, "INSTRUMENT_PASST_NICHT", "Nur ein Wandeldarlehen lässt sich wandeln.", { instrument: i.art });
    return i;
  }
  const wandel = alle.filter((x) => x.art === "wandeldarlehen");
  const aktive = wandel.filter((x) => x.status === "aktiv");
  if (aktive.length > 1) {
    throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", { felder: [{ feld: "instrumentId", code: "instrument_erforderlich", meldung: "Die Beteiligung hat mehrere Wandeldarlehen; das Instrument ist anzugeben" }] });
  }
  if (aktive[0]) return aktive[0];
  if (wandel.some((x) => x.status === "gewandelt")) throw new Fachfehler(409, "BEREITS_GEWANDELT", "Das Darlehen ist bereits gewandelt.");
  throw new Fachfehler(409, "INSTRUMENT_PASST_NICHT", "Nur ein Wandeldarlehen lässt sich wandeln.", { instrument: b.instrument });
}

/** Prüft die vertraglich abweichenden Beträge gegen den errechneten Stand (Darlehen und Zinsen am Cut-off); Fehler als Feldfehler (400). */
function pruefeAbweichung(eingabe: WandlungsEingabe, stand: Wandlungsergebnis): void {
  const felder: { feld: string; code: string; meldung: string }[] = [];
  const de = (x: Decimal) => x.toFixed(2);
  if (eingabe.gewandeltesDarlehen !== undefined && new Decimal(eingabe.gewandeltesDarlehen).greaterThan(stand.restkapital)) {
    felder.push({ feld: "gewandeltesDarlehen", code: "ueber_ausstehend", meldung: `Das gewandelte Darlehen darf den ausstehenden Betrag (${de(stand.restkapital)}) nicht übersteigen` });
  }
  if (eingabe.gewandelteZinsen !== undefined) {
    if (!eingabe.zinsenWandeln && new Decimal(eingabe.gewandelteZinsen).greaterThan(0)) {
      felder.push({ feld: "gewandelteZinsen", code: "zinsen_nicht_gewandelt", meldung: "Zinsen werden nicht gewandelt; gewandelte Zinsen müssen null sein" });
    } else if (new Decimal(eingabe.gewandelteZinsen).greaterThan(stand.zinsenGebucht)) {
      felder.push({ feld: "gewandelteZinsen", code: "ueber_ausstehend", meldung: `Die gewandelten Zinsen dürfen die Zinsen bis zum Cut-off (${de(stand.zinsenGebucht)}) nicht übersteigen` });
    }
  }
  const darlehen = new Decimal(eingabe.gewandeltesDarlehen ?? stand.restkapital);
  const zinsen = new Decimal(eingabe.gewandelteZinsen ?? (eingabe.zinsenWandeln ? stand.zinsenGebucht : 0));
  if (felder.length === 0 && !darlehen.plus(zinsen).greaterThan(0)) {
    felder.push({ feld: "gewandeltesDarlehen", code: "nichts_gewandelt", meldung: "Es muss ein Betrag größer null gewandelt werden" });
  }
  if (felder.length > 0) throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", { felder });
}

/** Berechnet die Wandlung samt geplanter Vorgänge, ohne zu schreiben (Grundlage von Vorschau und Buchung). */
export async function planeWandlung(tx: Tx, b: BeteiligungZeile, eingabe: WandlungsEingabe): Promise<Wandlungsplan & { rundeNeu: WandlungsEingabeNeu | null; wandlungId: string; quelle: InstrumentZeile }> {
  const quelle = await ladeQuelle(tx, b, eingabe.instrumentId);
  verlangeAktiv(b);
  const [bereits] = await tx.select({ id: wandlung.id }).from(wandlung).where(eq(wandlung.quellInstrumentId, quelle.id));
  if (bereits || quelle.status === "gewandelt") throw new Fachfehler(409, "BEREITS_GEWANDELT", "Das Darlehen ist bereits gewandelt.");
  if (quelle.status !== "aktiv") throw new Fachfehler(409, "INSTRUMENT_NICHT_AKTIV", "Das Instrument ist nicht aktiv.", { instrumentId: quelle.id, status: quelle.status });

  const [kontext] = await ladeZinskontexte(tx, { instrumentIds: [quelle.id] });
  if (!kontext || kontext.konditionen.length === 0) throw new Fachfehler(409, "KEINE_KONDITIONEN", "Für die Zinsen bis zum Cut-off fehlen Konditionen.");
  const version = versionAm(kontext.konditionen, tagVor(eingabe.cutoff))!;
  const gebucht = gebuchtePerioden(kontext).filter((d) => d <= eingabe.cutoff);
  const zinsenAb = gebucht.at(-1);
  const runde = await ladeRunde(tx, b, eingabe);
  const anteilsklasseId = await ladeKlasse(tx, b, runde.id, eingabe.anteilsklasseId);

  const rundenpreis = eingabe.preisregel.rundenpreisJeAnteil ?? runde.preisJeAnteil;
  const rechne = (abweichung: { gewandeltesDarlehen?: string; gewandelteZinsen?: string }) =>
    rechneWandlung({
      bewegungen: berechneZustand(kontext.vorgaenge).bewegungen,
      bedingungen: {
        satzFix: version.satzFix,
        methode: version.methode,
        ...(version.gewinnabhaengigSatz !== null && version.kappungSatz !== null
          ? { gewinnabhaengig: { satz: version.gewinnabhaengigSatz, kappungSatz: version.kappungSatz, bemessung: kontext.ueberschuesse } }
          : {}),
      },
      cutoff: eingabe.cutoff,
      zinsenWandeln: eingabe.zinsenWandeln,
      preisregel: {
        rundenpreisJeAnteil: rundenpreis,
        ...(eingabe.preisregel.discount !== undefined ? { discount: eingabe.preisregel.discount } : {}),
        ...(eingabe.preisregel.bewertungsobergrenze ? { bewertungsobergrenze: eingabe.preisregel.bewertungsobergrenze } : {}),
      },
      nennwertJeAnteil: eingabe.nennwertJeAnteil,
      ...(zinsenAb ? { zinsenAb } : {}),
      ...abweichung,
    });
  let ergebnis = alsFachfehler(b.id, () => rechne({}));
  const abweichung = {
    ...(eingabe.gewandeltesDarlehen !== undefined ? { gewandeltesDarlehen: eingabe.gewandeltesDarlehen } : {}),
    ...(eingabe.gewandelteZinsen !== undefined ? { gewandelteZinsen: eingabe.gewandelteZinsen } : {}),
  };
  if (Object.keys(abweichung).length > 0) {
    pruefeAbweichung(eingabe, ergebnis);
    ergebnis = alsFachfehler(b.id, () => rechne(abweichung));
  }
  const darlehenRestArt = ergebnis.darlehenRest.greaterThan(0) ? (eingabe.darlehenRest ?? "zurueckgezahlt") : null;
  const zinsenRestArt = ergebnis.zinsenRest.greaterThan(0) ? (eingabe.zinsenRest ?? "zurueckgezahlt") : null;

  const spitz = aufCent(ergebnis.spitzenbetrag);
  const umgewandelt = ergebnis.wandlungsbetrag.minus(spitz);
  const nominal = ergebnis.nominal;
  const agio = umgewandelt.minus(nominal);
  if (agio.isNegative()) {
    throw new Fachfehler(409, "BERECHNUNG_FEHLGESCHLAGEN", "Der Nennwert liegt über dem Wandlungspreis (negatives Agio).", { beteiligungId: b.id, grund: "negatives Agio" });
  }

  const wandlungId = randomUUID();
  // Ohne Kennung im Text: die Zugehörigkeit steht in `wandlung.vorgaenge`.
  const kennung = "Wandlung";
  const zahl = (x: Decimal, stellen: number) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: stellen, maximumFractionDigits: stellen }).format(Number(x.toFixed(stellen)));
  const einzelheiten = `(${zahl(ergebnis.anzahlAnteile, 0)} Anteile, Nominal ${zahl(nominal, 2)} €, Agio ${zahl(agio, 2)} €)`;
  const vorgaenge: GeplanterVorgang[] = [];
  const plan = (beteiligungArt: "darlehen" | "ziel", art: GeplanterVorgang["art"], betrag: Decimal, bemerkung: string, zusatz: Pick<GeplanterVorgang, "schluessel" | "ref" | "begleicht"> = {}) => {
    if (betrag.greaterThan(0)) vorgaenge.push({ beteiligung: beteiligungArt, art, valuta: eingabe.cutoff, betrag: betrag.toFixed(2), bemerkung, ...zusatz });
  };
  const tilgungWandlung = ergebnis.darlehenGewandelt.minus(spitz);
  if (tilgungWandlung.isNegative()) {
    throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", {
      felder: [{ feld: "gewandeltesDarlehen", code: "unter_spitzenbetrag", meldung: `Das gewandelte Darlehen muss mindestens dem Spitzenbetrag (${spitz.toFixed(2)}) entsprechen` }],
    });
  }
  const zinsText = (zusatz: string) => `${kennung}: Zinsen bis zum Cut-off (${zusatz})`;
  if (!eingabe.zinsenWandeln) {
    plan("darlehen", "zins", ergebnis.zinsenGebucht, zinsText("werden ausgezahlt"));
  } else if (zinsenRestArt === null) {
    plan("darlehen", "zins", ergebnis.zinsenGebucht, zinsText("werden gewandelt"));
  } else {
    // Teilweise gewandelt: Der gewandelte Teil ist die Zinsbuchung `darlehen_zins_*`; der Rest wird zurückgezahlt (eigene Zinsbuchung samt Zahlung) oder
    // erlassen (keine Forderung, Verzicht im Ergebnis der Wandlung).
    plan("darlehen", "zins", ergebnis.zinsenGewandelt, zinsText("teilweise gewandelt"));
    if (zinsenRestArt === "zurueckgezahlt") {
      plan("darlehen", "zins", ergebnis.zinsenRest, zinsText("nicht gewandelt, werden zurückgezahlt"), { schluessel: "zinsrest", ref: "zinsrest" });
      plan("darlehen", "zinszahlung", ergebnis.zinsenRest, `${kennung}: Zinsen zurückgezahlt`, { schluessel: "zinszahlung", begleicht: "zinsrest" });
    }
  }
  plan("darlehen", "tilgung", tilgungWandlung, `${kennung}: Tilgung durch Wandlung in Anteile`);
  plan("darlehen", "tilgung", spitz, `${kennung}: Spitzenbetrag ausgezahlt`);
  if (darlehenRestArt === "zurueckgezahlt") plan("darlehen", "tilgung", ergebnis.darlehenRest, `${kennung}: nicht gewandeltes Darlehen zurückgezahlt`, { schluessel: "rueckzahlung" });
  if (darlehenRestArt === "erlassen") plan("darlehen", "tilgung", ergebnis.darlehenRest, `${kennung}: nicht gewandeltes Darlehen erlassen (Verzicht, ohne Geldfluss)`, { schluessel: "erlass" });
  plan("ziel", "zusage", umgewandelt, `${kennung}: Zusage aus Wandlung ${einzelheiten}`);
  plan("ziel", "auszahlung", umgewandelt, `${kennung}: Einlage aus Wandlung ${einzelheiten}`);

  return {
    ergebnis,
    gebucht: { zinsen: ergebnis.zinsenGebucht, spitzenbetrag: spitz, umgewandelt, nominal, agio },
    vorgaenge,
    runde: { id: runde.id, organisationId: runde.organisationId, preisJeAnteil: runde.preisJeAnteil },
    anteilsklasseId,
    zielBeteiligungId: b.id,
    quellInstrumentId: quelle.id,
    zielInstrumentId: null,
    rundeNeu: runde.neu,
    wandlungId,
    quelle,
    restbehandlung: { darlehen: darlehenRestArt, zinsen: zinsenRestArt },
  };
}

export type WandlungsEingabeNeu = Extract<WandlungsEingabe["runde"], { neu: unknown }>["neu"];

/** Führt die Wandlung in der laufenden Transaktion aus. */
export async function fuehreWandlungAus(tx: Tx, protokoll: Protokollant, b: BeteiligungZeile, eingabe: WandlungsEingabe) {
  const p = await planeWandlung(tx, b, eingabe);
  const { ergebnis, gebucht } = p;

  // Runde (vorhandene oder neue) und Position des Fonds
  let rundeId = p.runde.id;
  let rundenname: string;
  if (rundeId === null) {
    const r = p.rundeNeu!;
    const [neu] = await tx
      .insert(finanzierungsrunde)
      .values({
        organisationId: b.organisationId,
        bezeichnung: r.bezeichnung,
        datum: r.datum ?? eingabe.cutoff,
        preMoney: r.preMoney,
        postMoney: r.postMoney,
        preisJeAnteil: r.preisJeAnteil,
        anteileGesamtNach: r.anteileGesamtNach,
      })
      .returning();
    if (!neu) throw new Error("Runde nicht angelegt");
    rundeId = neu.id;
    rundenname = neu.bezeichnung;
    await protokoll("anlegen", "finanzierungsrunde", neu.id, null, neu);
  } else {
    const [r] = await tx.select({ bezeichnung: finanzierungsrunde.bezeichnung }).from(finanzierungsrunde).where(eq(finanzierungsrunde.id, rundeId));
    rundenname = r?.bezeichnung ?? "";
  }

  // Quelle: das Wandeldarlehen (gesperrt); Ziel: ein neues Eigenkapital-Instrument derselben Beteiligung
  const quelle = p.quelle;
  const quellVorgaenge = vorgaengeDesInstruments(await ladeVorgaenge(tx, b.id), quelle.id);
  const darlehenBuchwert = buchwertVon(berechneZustand(quellVorgaenge)).wert;
  const ziel = await legeInstrumentAn(tx, protokoll, b.id, { art: "offene_beteiligung", bezeichnung: `${rundenname}-Anteile`.trim(), rundeId, anteilsklasseId: p.anteilsklasseId });
  const quellInstrumentId = quelle.id;
  const zielInstrumentId = ziel.id;
  const [position] = await tx
    .insert(rundenposition)
    .values({ rundeId, fondsId: b.fondsId, instrumentId: zielInstrumentId, anteilsklasseId: p.anteilsklasseId, betrag: gebucht.umgewandelt.toFixed(2), anteile: ergebnis.anzahlAnteile.toFixed(0), rolle: eingabe.rolle })
    .returning();
  await protokoll("anlegen", "rundenposition", position!.id, null, position);

  // Vorgänge
  const ids: Record<string, string> = {};
  const nachRef = new Map<string, string>();
  let nummer = 0;
  for (const g of p.vorgaenge) {
    const [zeile] = await tx
      .insert(vorgang)
      .values({
        beteiligungId: b.id,
        instrumentId: g.beteiligung === "darlehen" ? quellInstrumentId : zielInstrumentId,
        art: g.art,
        valuta: g.valuta,
        betrag: g.betrag,
        bemerkung: g.bemerkung,
        ...(g.begleicht ? { beglichenVorgangId: nachRef.get(g.begleicht) ?? null } : {}),
      })
      .returning();
    if (g.ref) nachRef.set(g.ref, zeile!.id);
    await protokoll("anlegen", "vorgang", zeile!.id, null, zeile);
    // Alle Buchungen der Wandlung (Zinsen, Tilgung, Spitzenbetrag, Zusage und Einlage des Ziels) gehören zur Zielrunde.
    await ordneRundeZu(tx, protokoll, zeile!, { rundeId, quelle: "automatisch" });
    ids[`${g.beteiligung}_${g.schluessel ?? g.art}_${nummer++}`] = zeile!.id;
  }

  // Bewertung (je Beteiligung, eine am Cut-off): Der Wert des erloschenen Darlehens (Buchwert vor der Wandlung) fällt weg, der umgewandelte Betrag
  // kommt zu Anschaffungskosten dazu; was die Beteiligung sonst schon bewertet hatte (andere Instrumente), bleibt erhalten.
  const vorherBewertung = await letzteBewertung(tx, b.id, eingabe.cutoff);
  const bleibt = Decimal.max(new Decimal(vorherBewertung?.wert ?? 0).minus(darlehenBuchwert), 0);
  await setzeBewertung(tx, protokoll, b, eingabe.cutoff, bleibt.plus(gebucht.umgewandelt).toFixed(2), "anschaffungskosten", "Darlehen durch Wandlung erloschen, Zugang aus Wandlung zu Anschaffungskosten");

  const quelleNachher = await setzeInstrumentStatus(tx, protokoll, quelle, "gewandelt");
  await protokoll("wandlung", "instrument", quelle.id, quelle, quelleNachher);

  const [zeile] = await tx
    .insert(wandlung)
    .values({
      id: p.wandlungId,
      darlehenBeteiligungId: b.id,
      zielBeteiligungId: b.id,
      quellInstrumentId,
      zielInstrumentId,
      rundeId,
      cutoff: eingabe.cutoff,
      zinsenWandeln: eingabe.zinsenWandeln,
      preisregel: eingabe.preisregel,
      nennwertJeAnteil: eingabe.nennwertJeAnteil,
      anzahlAnteile: ergebnis.anzahlAnteile.toFixed(0),
      preisJeAnteil: ergebnis.preisJeAnteil.toFixed(),
      massgeblich: ergebnis.massgeblich,
      wandlungsbetrag: ergebnis.wandlungsbetrag.toFixed(2),
      nominal: gebucht.nominal.toFixed(2),
      agio: gebucht.agio.toFixed(2),
      spitzenbetrag: gebucht.spitzenbetrag.toFixed(2),
      zinsenGebucht: gebucht.zinsen.toFixed(2),
      ergebnis: alsJson({ ...ergebnis, restbehandlung: p.restbehandlung }),
      vorgaenge: ids,
    })
    .returning();
  await protokoll("anlegen", "wandlung", p.wandlungId, null, zeile);
  return { wandlung: zeile!, ergebnis: alsJson({ ...ergebnis, restbehandlung: p.restbehandlung }), gebucht: alsJson(gebucht), zielBeteiligungId: b.id, quellInstrumentId, zielInstrumentId, rundeId, vorgangIds: ids };
}

export type { Db };
