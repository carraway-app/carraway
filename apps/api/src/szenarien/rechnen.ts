import { ladeKapitalstand } from "../instrumente/kapitalstand";
import { eq, sql } from "drizzle-orm";
import { Decimal, prognose, verteileAnteilig, wasserfall, type PrognoseBeteiligung, type Rechenschritt, type Zahlungsstrom } from "@carraway/rechenkern";
import { fonds } from "@carraway/db";
import { Fachfehler } from "../fehler";
import { kernEingabe, ladeKapital } from "../kapital/wasserfall";
import { berechneFondsUebersicht, bisStand } from "../kennzahlen/fonds";
import { heute } from "../schreiben";
import type { Tx } from "../zeitlimit";
import type { Annahmen } from "./annahmen";
import { rechneBewertungsszenario, type BewertungsszenarioErgebnis } from "./bewertung";
import { geldlos } from "../instrumente/geldfluss";

/**
 * Berechnung eines Szenarios: Ist-Stand des Fonds zum Basistag (Ledger, optional mit Wissensstand) und Annahmen darüber hinaus gehen in die
 * Prognose des Rechenkerns. Exit-Erlöse aus einem Exit-Wert laufen über den Exit-Wasserfall (Etappe 10), wenn der Fonds Anteile aus
 * Finanzierungsrunden hält; sonst gilt Quote × Erlös mit einem Befund. Das Ergebnis ist reines JSON (Zeichenketten, Zahlen, null).
 */

export type Schwere = "hinweis" | "warnung";

export interface Befund {
  code: string;
  schwere: Schwere;
  beteiligungId?: string;
  params?: Record<string, string | number>;
}

export interface JahrErgebnis {
  jahr: number;
  datum: string;
  ist: boolean;
  investitionen: string;
  gebuehren: string;
  abrufe: string;
  ausschuettungenBrutto: string;
  carry: string;
  ausschuettungenNetto: string;
  nav: string;
  navNetto: string;
  abgerufenKum: string;
  ausschuettungenKum: string;
  offeneZusage: string;
  dpi: string | null;
  tvpi: string | null;
  rvpi: string | null;
  irrNetto: string | null;
  tvpiBrutto: string | null;
  irrBrutto: string | null;
}

export interface BeteiligungErgebnis {
  id: string;
  name: string;
  wert: string;
  investiert: string;
  ausstiegsJahr: number | null;
  erloesBeiAusstieg: string;
  wahrscheinlichkeit: string;
  erwarteterErloes: string;
  folgeinvestitionen: string;
  /** Woher der Erlös kommt: `wasserfall`, `quote`, `multiple`, `abschreibung` oder `keine` (kein Ausstieg). */
  erloesQuelle: "wasserfall" | "quote" | "multiple" | "abschreibung" | "keine";
}

export interface SzenarioErgebnis {
  basisStichtag: string;
  endJahr: number;
  waehrung: string;
  zeichnungskapital: string;
  jahre: JahrErgebnis[];
  beteiligungen: BeteiligungErgebnis[];
  summen: Record<"investitionen" | "gebuehren" | "abrufe" | "ausschuettungenBrutto" | "carry" | "ausschuettungenNetto", string>;
  befunde: Befund[];
  schritte: Rechenschritt[];
  /** Bewertungsszenarien (Etappe 21); nur vorhanden, wenn die Annahmen den Abschnitt `bewertung` haben, sonst bleibt das Ergebnis wie vorher. */
  bewertungsszenario?: BewertungsszenarioErgebnis;
}

const ungueltig = (meldung: string, zusatz: Record<string, unknown> = {}) => new Fachfehler(422, "SZENARIO_ANNAHMEN_UNGUELTIG", meldung, zusatz);

const D = (w: Decimal.Value) => new Decimal(w);

/** Ist-Zahlungsströme des Fonds bis zum Basistag. */
async function ladeStroeme(tx: Tx, fondsId: string, basis: string, stand: string | undefined): Promise<{ fonds: Zahlungsstrom[]; brutto: Zahlungsstrom[] }> {
  const kapital = await ladeKapitalstand(tx, fondsId, basis, stand);
  const { rows: vor } = await tx.execute<{ valuta: string; aus: string; rueck: string }>(sql`
    SELECT v.valuta::text AS valuta,
           coalesce(sum(v.betrag) FILTER (WHERE v.art = 'auszahlung' AND NOT ${geldlos("v")}), 0)::text AS aus,
           coalesce(sum(v.betrag) FILTER (WHERE v.art IN ('rueckfluss', 'tilgung', 'zinszahlung', 'dividende') AND NOT ${geldlos("v")}), 0)::text AS rueck
    FROM vorgang v JOIN beteiligung b ON b.id = v.beteiligung_id
    WHERE b.fonds_id = ${fondsId} AND v.valuta <= ${basis}::date${bisStand(sql.raw("v.erfasst_am"), stand)}
    GROUP BY v.valuta ORDER BY valuta`);
  const brutto: Zahlungsstrom[] = [];
  for (const z of vor) {
    const netto = D(z.rueck).minus(z.aus);
    if (!netto.isZero()) brutto.push({ datum: z.valuta, betrag: netto });
  }
  return { fonds: kapital.zahlungsstrom, brutto };
}

/**
 * Gewichte für die Aufteilung des Fonds-Erlöses auf mehrere Beteiligungen am selben Unternehmen: nach Anschaffungskosten (bisher investiertes Kapital).
 * Sind alle Kosten null, zählen alle gleich. Die Kosten sind je Beteiligung bekannt, die Positionen einer Runde zeigen nicht auf ein Instrument.
 */
function kostenGewichte(bet: readonly { investiert: Decimal.Value }[]): Decimal[] {
  const kosten = bet.map((x) => Decimal.max(0, D(x.investiert)));
  return kosten.some((k) => k.greaterThan(0)) ? kosten : kosten.map(() => D(1));
}

const text = (w: Decimal | null) => (w === null ? null : w.toString());

/** Rechnet ein Szenario. `stand` ist der Wissensstand der Eingangsdaten (leer = heute). */
export async function rechneSzenario(tx: Tx, fondsId: string, basisStichtag: string, annahmen: Annahmen, stand?: string): Promise<SzenarioErgebnis> {
  if (basisStichtag > heute()) throw ungueltig("Der Basistag darf nicht in der Zukunft liegen.", { feld: "basisStichtag" });
  const [f] = await tx.select().from(fonds).where(eq(fonds.id, fondsId));
  if (!f) throw new Fachfehler(404, "FONDS_NICHT_GEFUNDEN", "Fonds nicht gefunden.");
  const basisJahr = Number(basisStichtag.slice(0, 4));
  const endJahr = annahmen.endJahr ?? basisJahr + 10;
  if (endJahr < basisJahr || endJahr > basisJahr + 30) throw ungueltig("Das Prognoseende liegt außerhalb des Zeitraums (Basisjahr bis 30 Jahre danach).", { feld: "endJahr" });
  const imFenster = (jahr: number, feld: string) => {
    if (jahr < basisJahr || jahr > endJahr) throw ungueltig(`Jahr ${jahr} liegt außerhalb von ${basisJahr} bis ${endJahr}.`, { feld, jahr });
  };

  const ue = await berechneFondsUebersicht(tx, fondsId, basisStichtag, stand);
  const stroeme = await ladeStroeme(tx, fondsId, basisStichtag, stand);
  const befunde: Befund[] = [];

  for (const id of Object.keys(annahmen.beteiligungen)) {
    if (!ue.beteiligungen.some((b) => b.id === id)) throw ungueltig("Eine Annahme nennt eine Beteiligung, die es in diesem Fonds zum Basistag nicht gibt.", { feld: `beteiligungen.${id}`, beteiligungId: id });
  }

  // Erlös des Fonds aus dem Exit-Wasserfall je Unternehmen und Exit-Annahme (`null`: keine Positionen des Fonds in der Kapitaltabelle).
  const fondsErloese = new Map<string, Decimal | null>();
  const aktiveJeOrganisation = new Map<string, typeof ue.beteiligungen>();
  for (const b of ue.beteiligungen.filter((x) => x.status === "aktiv")) aktiveJeOrganisation.set(b.organisation.id, [...(aktiveJeOrganisation.get(b.organisation.id) ?? []), b]);
  const kernBeteiligungen: PrognoseBeteiligung[] = [];
  const quellen = new Map<string, BeteiligungErgebnis["erloesQuelle"]>();
  const bruttoErloes = new Map<string, Decimal>();
  const wahrscheinlichkeiten = new Map<string, string>();
  for (const b of ue.beteiligungen) {
    const a = annahmen.beteiligungen[b.id];
    if (b.status !== "aktiv") {
      if (a) befunde.push({ code: "BETEILIGUNG_NICHT_AKTIV", schwere: "hinweis", beteiligungId: b.id, params: { status: b.status } });
      continue;
    }
    if (!b.letzteBewertung) befunde.push({ code: "BEWERTUNG_FEHLT", schwere: "warnung", beteiligungId: b.id });
    const wert = D(b.letzteBewertung?.wert ?? 0);
    const folgen = (a?.folgeinvestitionen ?? []).map((x) => {
      imFenster(x.jahr, `beteiligungen.${b.id}.folgeinvestitionen`);
      return { jahr: x.jahr, betrag: x.betrag };
    });
    let ausstieg: PrognoseBeteiligung["ausstieg"] = null;
    let quelle: BeteiligungErgebnis["erloesQuelle"] = "keine";
    const x = a?.ausstieg;
    if (!x) {
      if (!a) befunde.push({ code: "KEINE_ANNAHME", schwere: "hinweis", beteiligungId: b.id });
      else befunde.push({ code: "KEIN_AUSSTIEG", schwere: "hinweis", beteiligungId: b.id });
    } else if (x.art === "abschreibung") {
      imFenster(x.jahr, `beteiligungen.${b.id}.ausstieg.jahr`);
      ausstieg = { jahr: x.jahr, erloes: 0, wahrscheinlichkeit: 1 };
      quelle = "abschreibung";
      wahrscheinlichkeiten.set(b.id, "1");
    } else {
      imFenster(x.jahr, `beteiligungen.${b.id}.ausstieg.jahr`);
      let erloes = D(0);
      if (x.multiple !== undefined) {
        const grundlage = wert.isZero() ? D(b.investiert) : wert;
        if (wert.isZero()) befunde.push({ code: "MULTIPLE_OHNE_WERT", schwere: "warnung", beteiligungId: b.id });
        erloes = grundlage.times(x.multiple);
        quelle = "multiple";
      } else {
        const exitwert = Decimal.max(0, D(x.wert!).minus(x.kosten));
        if (D(x.kosten).greaterThan(x.wert!)) befunde.push({ code: "KOSTEN_UEBER_EXITWERT", schwere: "warnung", beteiligungId: b.id });
        // Der Wasserfall gilt für das Unternehmen und alle Positionen des Fonds darin; er wird je Unternehmen und Exit-Annahme einmal gerechnet.
        const orgId = b.organisation.id;
        const schluessel = `${orgId}|${x.jahr}|${exitwert.toFixed()}`;
        if (!fondsErloese.has(schluessel)) {
          const kapital = await ladeKapital(tx, { fondsId, organisationId: orgId }, `${x.jahr}-12-31`);
          const eigene = new Set(kapital.zeilen.filter((z) => z.diesesFonds).map((z) => z.id));
          if (eigene.size === 0) fondsErloese.set(schluessel, null);
          else {
            const k = kernEingabe(kapital);
            const w = wasserfall({ exitwert, exitdatum: `${x.jahr}-12-31`, klassen: k.klassen, inhaber: k.inhaber }).wert;
            fondsErloese.set(schluessel, w.zeilen.filter((z) => eigene.has(z.id)).reduce((s, z) => s.plus(z.gesamt), D(0)));
          }
        }
        const fondsErloes = fondsErloese.get(schluessel) ?? null;
        if (fondsErloes !== null) {
          // Hält der Fonds mehrere Beteiligungen am Unternehmen (verschiedene Instrumente), verteilt sich sein Erlös auf sie; sonst bekäme jede den vollen Anteil.
          const geschwister = aktiveJeOrganisation.get(orgId) ?? [b];
          if (geschwister.length > 1) {
            const gerundet = fondsErloes.toDecimalPlaces(2);
            const teile = verteileAnteilig(gerundet, kostenGewichte(geschwister));
            erloes = teile[geschwister.findIndex((g) => g.id === b.id)] ?? D(0);
            befunde.push({ code: "WASSERFALL_AUFGETEILT", schwere: "hinweis", beteiligungId: b.id, params: { anzahl: geschwister.length } });
          } else erloes = fondsErloes;
          quelle = "wasserfall";
        } else if (a?.quote !== undefined) {
          erloes = exitwert.times(a.quote);
          quelle = "quote";
          befunde.push({ code: "WASSERFALL_FALLBACK_QUOTE", schwere: "hinweis", beteiligungId: b.id, params: { quote: a.quote } });
        } else {
          quelle = "quote";
          befunde.push({ code: "QUOTE_FEHLT", schwere: "warnung", beteiligungId: b.id });
        }
      }
      ausstieg = { jahr: x.jahr, erloes, wahrscheinlichkeit: x.wahrscheinlichkeit };
      wahrscheinlichkeiten.set(b.id, x.wahrscheinlichkeit);
    }
    quellen.set(b.id, quelle);
    bruttoErloes.set(b.id, D(ausstieg?.erloes ?? 0));
    kernBeteiligungen.push({ id: b.id, name: b.organisation.name, wert, investiert: b.investiert, folgeinvestitionen: folgen, ausstieg });
  }
  annahmen.neuinvestitionen.forEach((n, i) => {
    imFenster(n.jahr, `neuinvestitionen.${i}.jahr`);
    let ausstieg: PrognoseBeteiligung["ausstieg"] = null;
    if (n.ausstiegJahr !== undefined) {
      imFenster(n.ausstiegJahr, `neuinvestitionen.${i}.ausstiegJahr`);
      if (n.ausstiegJahr < n.jahr) throw ungueltig("Der Ausstieg einer Neuinvestition liegt vor der Investition.", { feld: `neuinvestitionen.${i}.ausstiegJahr` });
      ausstieg = { jahr: n.ausstiegJahr, erloes: D(n.betrag).times(n.multiple ?? 1), wahrscheinlichkeit: 1 };
    }
    const id = `neu-${i + 1}`;
    quellen.set(id, ausstieg ? "multiple" : "keine");
    bruttoErloes.set(id, D(ausstieg?.erloes ?? 0));
    wahrscheinlichkeiten.set(id, "1");
    kernBeteiligungen.push({ id, name: n.name, wert: 0, investiert: 0, folgeinvestitionen: [{ jahr: n.jahr, betrag: n.betrag }], ausstieg });
  });

  const g = annahmen.gebuehren;
  const ergebnis = prognose({
    basisStichtag,
    endJahr,
    zeichnungskapital: f.zeichnungskapital,
    eingezahlt: ue.kennzahlen.eingezahlt.wert ?? "0",
    abgerufen: ue.kennzahlen.abgerufen.wert ?? "0",
    ausschuettungen: ue.kennzahlen.ausschuettungen.wert ?? "0",
    navSonstiges: ue.beteiligungen.reduce((s, b) => s.plus(b.offeneForderungen), D(0)),
    investiertBisher: ue.beteiligungen.reduce((s, b) => s.plus(b.investiert), D(0)),
    rueckfluesseBisher: ue.beteiligungen.reduce((s, b) => s.plus(b.rueckfluesse), D(0)),
    stroemeFonds: stroeme.fonds,
    stroemeBrutto: stroeme.brutto,
    beteiligungen: kernBeteiligungen,
    gebuehren: { basis: g.basis, satz: g.satz, bisJahr: g.bisJahr, sonstigeJahr: g.sonstigeJahr },
    carrySatz: annahmen.carrySatz,
    wertpfad: annahmen.wertpfad,
  });

  const jahre: JahrErgebnis[] = ergebnis.wert.jahre.map((j) => ({
    jahr: j.jahr,
    datum: j.datum,
    ist: j.ist,
    investitionen: j.investitionen.toFixed(2),
    gebuehren: j.gebuehren.toFixed(2),
    abrufe: j.abrufe.toFixed(2),
    ausschuettungenBrutto: j.ausschuettungenBrutto.toFixed(2),
    carry: j.carry.toFixed(2),
    ausschuettungenNetto: j.ausschuettungenNetto.toFixed(2),
    nav: j.nav.toFixed(2),
    navNetto: j.navNetto.toFixed(2),
    abgerufenKum: j.abgerufenKum.toFixed(2),
    ausschuettungenKum: j.ausschuettungenKum.toFixed(2),
    offeneZusage: j.offeneZusage.toFixed(2),
    dpi: text(j.dpi?.toDecimalPlaces(4) ?? null),
    tvpi: text(j.tvpi?.toDecimalPlaces(4) ?? null),
    rvpi: text(j.rvpi?.toDecimalPlaces(4) ?? null),
    irrNetto: text(j.irrNetto),
    tvpiBrutto: text(j.tvpiBrutto?.toDecimalPlaces(4) ?? null),
    irrBrutto: text(j.irrBrutto),
  }));
  const ueberschritten = ergebnis.wert.jahre.find((j) => j.offeneZusage.isNegative());
  if (ueberschritten) befunde.push({ code: "ZUSAGE_UEBERSCHRITTEN", schwere: "warnung", params: { jahr: ueberschritten.jahr, betrag: ueberschritten.offeneZusage.neg().toFixed(2) } });

  return {
    basisStichtag,
    endJahr,
    waehrung: f.waehrung,
    zeichnungskapital: D(f.zeichnungskapital).toFixed(2),
    jahre,
    beteiligungen: ergebnis.wert.beteiligungen.map((b) => ({
      id: b.id,
      name: b.name,
      wert: D(kernBeteiligungen.find((k) => k.id === b.id)!.wert).toFixed(2),
      investiert: D(kernBeteiligungen.find((k) => k.id === b.id)!.investiert).toFixed(2),
      ausstiegsJahr: b.ausstiegsJahr,
      erloesBeiAusstieg: (bruttoErloes.get(b.id) ?? D(0)).toFixed(2),
      wahrscheinlichkeit: wahrscheinlichkeiten.get(b.id) ?? "1",
      erwarteterErloes: b.erwarteterErloes.toFixed(2),
      folgeinvestitionen: b.folgeinvestitionen.toFixed(2),
      erloesQuelle: quellen.get(b.id) ?? "keine",
    })),
    summen: {
      investitionen: ergebnis.wert.summen.investitionen.toFixed(2),
      gebuehren: ergebnis.wert.summen.gebuehren.toFixed(2),
      abrufe: ergebnis.wert.summen.abrufe.toFixed(2),
      ausschuettungenBrutto: ergebnis.wert.summen.ausschuettungenBrutto.toFixed(2),
      carry: ergebnis.wert.summen.carry.toFixed(2),
      ausschuettungenNetto: ergebnis.wert.summen.ausschuettungenNetto.toFixed(2),
    },
    befunde,
    schritte: ergebnis.schritte,
    ...(annahmen.bewertung ? { bewertungsszenario: await rechneBewertungsszenario(tx, fondsId, basisStichtag, annahmen.bewertung, ue, annahmen.carrySatz, stand) } : {}),
  };
}
