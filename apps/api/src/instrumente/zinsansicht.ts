import { inArray } from "drizzle-orm";
import { wandlung, zinslaufPosition } from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import type { Tx } from "../zeitlimit";
import { berechneAbgrenzung, berechneZinsstand, ladeZinskontexte, versionAm, tagVor, type Kondition, type Zinskontext } from "./zinsen";
import { berechneZustand, type VorgangDaten } from "./zustand";

/**
 * Zinsansicht (Portfolio-Modell, Abschnitt Zinsen): je darlehensartigem Instrument Konditionen, aufgelaufene, gebuchte, kapitalisierte, gezahlte und
 * offene Zinsen zu Stichtag und Wissensstand, die nächste Fälligkeit und die Perioden mit Status. Reine Lesesicht auf den Daten der Plattform; die
 * Zinsrechnung selbst liegt im Rechenkern (`berechneAbgrenzung`).
 *
 * - **gebucht**: Summe der Zinsbuchungen (`zins`, Storno-Paare heben sich auf) bis zum Stichtag, auch die kapitalisierten.
 * - **kapitalisiert**: der Teil davon, der dem Darlehenskapital zugeschlagen wurde; nie offen.
 * - **gezahlt**: Summe der Zinszahlungen (`zinszahlung`) bis zum Stichtag.
 * - **gewandelt**: Zinsbuchungen einer Wandlung mit `zinsen_wandeln` (Schlüssel `darlehen_zins_*` in `wandlung.vorgaenge`): Die Zinsen gehen in die
 *   Anteile über, sind also durch die Wandlung beglichen und kein Geld. Nie offen, nie gezahlt. Bei `zinsen_wandeln = false` bleibt die Zinsbuchung
 *   eine offene Forderung, bis die Auszahlung als Zinszahlung erfasst wird.
 * - **offen** = gebucht ohne kapitalisierte und gewandelte − gezahlt (negativ bei einer Überzahlung).
 * - **aufgelaufen**: noch nicht gebuchte fällige Perioden plus das laufende Stück bis zum Stichtag (Abgrenzung); nur bei aktivem Instrument.
 * - **Periodenstatus**: `aufgelaufen` (noch nicht gebucht), `gebucht` (kapitalisiert, also bereits Kapital), `offen` (gebucht, nicht kapitalisiert,
 *   noch nicht ganz bezahlt), `gezahlt` (gebucht und bezahlt), `gewandelt` (durch Wandlung beglichen). Eine Zinszahlung mit Verweis begleicht ihre Buchung, übrige Zahlungen die ältesten
 *   offenen Buchungen der Reihe nach.
 */

export type PeriodenStatus = "gebucht" | "offen" | "gezahlt" | "aufgelaufen" | "gewandelt";

export interface ZinsPeriode {
  von: string | null;
  bis: string;
  /** Zahlungsfälligkeit (Periodenende, bei Stundung der spätere Tag); `null` bei kapitalisierten Perioden und wenn sie sich nicht bestimmen lässt. */
  faellig: string | null;
  betrag: string;
  gezahlt: string;
  /** Durch Wandlung beglichen (Zinsen, die in Anteile gewandelt wurden); sonst 0. */
  gewandelt: string;
  offen: string;
  kapitalisiert: boolean;
  status: PeriodenStatus;
  /** Das laufende Stück bis zum Stichtag (noch keine volle Periode). */
  laufend: boolean;
  /** Die Zinsbuchung, wenn gebucht. */
  vorgangId: string | null;
}

export interface ZinsKonditionen {
  gueltigAb: string;
  satzFix: string;
  methode: string;
  zinsperiode: string;
  anker: string;
  kapitalisieren: boolean;
  gewinnabhaengigSatz: string | null;
  kappungSatz: string | null;
  stundungBis: string | null;
  /** Anzahl der Versionen der Konditionen (zum Stand). */
  versionen: number;
}

export interface ZinsInstrument {
  beteiligungId: string;
  instrumentId: string;
  organisation: { id: string; name: string };
  bezeichnung: string;
  art: string;
  status: string;
  konditionen: ZinsKonditionen | null;
  aufgelaufen: string | null;
  gebucht: string;
  kapitalisiert: string;
  gezahlt: string;
  /** Durch Wandlung beglichene Zinsen (in Anteile gewandelt); keine Zahlung, nicht offen. */
  gewandelt: string;
  offen: string;
  naechsteFaelligkeit: string | null;
  perioden: ZinsPeriode[];
  fehler: string | null;
  fehlerCode: string | null;
}

export interface ZinsSummen {
  aufgelaufen: string;
  gebucht: string;
  kapitalisiert: string;
  gezahlt: string;
  gewandelt: string;
  offen: string;
}

export interface Zinsansicht {
  stichtag: string;
  stand: string | null;
  instrumente: ZinsInstrument[];
  summe: ZinsSummen;
}

const cent = (w: Decimal) => w.toFixed(2);
const D = (w: Decimal.Value) => new Decimal(w);

function plusTage(datum: string, tage: number): string {
  const [j, m, t] = datum.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(j, m - 1, t + tage)).toISOString().slice(0, 10);
}

/** Gültige Vorgänge einer Art: ohne Storno-Paare (Original und Storno), nur positive Beträge. */
function gueltige(vorgaenge: readonly VorgangDaten[], art: string): VorgangDaten[] {
  const aufgehoben = new Set<string>();
  for (const v of vorgaenge) {
    if (!v.storniertVorgangId) continue;
    aufgehoben.add(v.id);
    aufgehoben.add(v.storniertVorgangId);
  }
  return vorgaenge.filter((v) => v.art === art && !aufgehoben.has(v.id) && D(v.betrag).greaterThan(0));
}

/** Ids der Zinsbuchungen, die eine Wandlung mit `zinsen_wandeln` in Anteile gewandelt hat (Schlüssel `darlehen_zins_*` in `wandlung.vorgaenge`). */
export async function ladeGewandelteZinsIds(tx: Tx, instrumentIds: readonly string[]): Promise<Set<string>> {
  if (instrumentIds.length === 0) return new Set();
  const zeilen = await tx.select({ vorgaenge: wandlung.vorgaenge, zinsenWandeln: wandlung.zinsenWandeln }).from(wandlung).where(inArray(wandlung.quellInstrumentId, [...instrumentIds]));
  const ids = new Set<string>();
  for (const z of zeilen) {
    if (!z.zinsenWandeln) continue;
    for (const [schluessel, id] of Object.entries(z.vorgaenge as Record<string, string | null>)) {
      if (id && schluessel.startsWith("darlehen_zins_")) ids.add(id);
    }
  }
  return ids;
}

/** Summe der gültigen (nicht stornierten) gewandelten Zinsbuchungen unter den Vorgängen. */
export function gewandelteZinsen(vorgaenge: readonly VorgangDaten[], gewandelteIds: ReadonlySet<string>): Decimal {
  return gueltige(vorgaenge, "zins").filter((v) => gewandelteIds.has(v.id)).reduce((s, v) => s.plus(v.betrag), D(0));
}

/** Nächste Periode nach dem Stichtag (Ende und Fälligkeit); `null`, wenn sich keine bestimmen lässt. */
function naechstePeriode(k: Zinskontext, stichtag: string): { bis: string; faelligAm: string } | null {
  try {
    const stand = berechneZinsstand(k, plusTage(stichtag, 400));
    const p = stand.positionen.find((x) => x.position.bis > stichtag);
    if (p) return { bis: p.position.bis, faelligAm: p.position.faelligAm };
  } catch {
    // Eine Vorschau über den Stichtag hinaus ist nur eine Zugabe; ohne sie bleibt die Fälligkeit offen.
  }
  const version = versionAm(k.konditionen, tagVor(stichtag));
  if (version && version.zinsperiode === "endfaellig" && version.anker > stichtag) return { bis: version.anker, faelligAm: version.stundungBis !== null && version.stundungBis > version.anker ? version.stundungBis : version.anker };
  return null;
}

function alsKonditionen(version: Kondition, anzahl: number): ZinsKonditionen {
  return {
    gueltigAb: version.gueltigAb,
    satzFix: version.satzFix,
    methode: version.methode,
    zinsperiode: version.zinsperiode,
    anker: version.anker,
    kapitalisieren: version.kapitalisieren,
    gewinnabhaengigSatz: version.gewinnabhaengigSatz,
    kappungSatz: version.kappungSatz,
    stundungBis: version.stundungBis,
    versionen: anzahl,
  };
}

/** Das Instrument zu Stichtag und Wissensstand zuschneiden (Vorgänge nach Valuta und Erfassung, Konditionen nach Erfassung). */
function zuschneiden(k: Zinskontext, stichtag: string, stand: string | undefined): Zinskontext {
  const grenze = stand === undefined ? null : new Date(stand).getTime();
  const bisStand = (z: Date | null) => grenze === null || z === null || z.getTime() <= grenze;
  return {
    ...k,
    vorgaenge: k.vorgaenge.filter((v) => v.valuta <= stichtag && bisStand(v.erfasstAm)),
    konditionen: k.konditionen.filter((x) => bisStand(x.erfasstAm)),
    // Marker gebuchter Perioden gehören zu Zinsbuchungen: nicht nach dem Stichtag, und nicht, wenn ihre Buchung erst nach dem Wissensstand erfasst wurde.
    markierte: k.markierte.filter((m) => m <= stichtag && !k.vorgaenge.some((v) => v.art === "zins" && v.valuta === m && !bisStand(v.erfasstAm))),
  };
}

export async function ladeZinsansicht(tx: Tx, auswahl: { fondsId: string } | { beteiligungIds: string[] }, stichtag: string, stand?: string): Promise<Zinsansicht> {
  const kontexte = await ladeZinskontexte(tx, auswahl);
  const zugeschnitten = kontexte.map((k) => zuschneiden(k, stichtag, stand));
  const gebuchteIds = zugeschnitten.flatMap((k) => gueltige(k.vorgaenge, "zins").map((v) => v.id));
  const gewandelteIds = await ladeGewandelteZinsIds(tx, kontexte.map((k) => k.instrument.id));
  const positionen = gebuchteIds.length > 0 ? await tx.select().from(zinslaufPosition).where(inArray(zinslaufPosition.vorgangId, gebuchteIds)) : [];
  const positionJeVorgang = new Map(positionen.filter((p) => p.vorgangId !== null).map((p) => [p.vorgangId as string, p]));

  const instrumente = zugeschnitten.map((k): ZinsInstrument => {
    const z = berechneZustand(k.vorgaenge);
    const gebucht = z.zinsen;
    const kapitalisiert = z.kapitalisiert;
    const gezahlt = z.zinszahlungen;
    const gewandelt = gewandelteZinsen(k.vorgaenge, gewandelteIds);
    const offen = gebucht.minus(kapitalisiert).minus(gewandelt).minus(gezahlt);
    const kopf = {
      beteiligungId: k.beteiligung.id,
      instrumentId: k.instrument.id,
      organisation: { id: k.beteiligung.organisationId, name: k.organisationName },
      bezeichnung: k.instrument.bezeichnung,
      art: k.instrument.art,
      status: k.instrument.status,
    };
    const version = k.konditionen.length > 0 ? (versionAm(k.konditionen, stichtag) as Kondition) : null;
    const konditionen = version ? alsKonditionen(version, k.konditionen.length) : null;

    // Gebuchte Perioden mit Zahlungsstand: Zahlungen mit Verweis begleichen ihre Buchung, die übrigen die ältesten offenen der Reihe nach.
    const buchungen = gueltige(k.vorgaenge, "zins").map((v) => {
      const pos = positionJeVorgang.get(v.id);
      const gewandeltDurch = gewandelteIds.has(v.id);
      return { v, gewandeltDurch, rest: v.kapitalisiert || gewandeltDurch ? D(0) : D(v.betrag), pos };
    });
    const zahlungen = gueltige(k.vorgaenge, "zinszahlung");
    let ueberhang = D(0);
    for (const zahlung of zahlungen) {
      let betrag = D(zahlung.betrag);
      const ziel = zahlung.beglichenVorgangId ? buchungen.find((b) => b.v.id === zahlung.beglichenVorgangId) : undefined;
      if (ziel) {
        const anteil = Decimal.min(betrag, ziel.rest);
        ziel.rest = ziel.rest.minus(anteil);
        betrag = betrag.minus(anteil);
      }
      ueberhang = ueberhang.plus(betrag);
    }
    for (const b of buchungen) {
      if (ueberhang.lessThanOrEqualTo(0)) break;
      const anteil = Decimal.min(ueberhang, b.rest);
      b.rest = b.rest.minus(anteil);
      ueberhang = ueberhang.minus(anteil);
    }

    const perioden: ZinsPeriode[] = [];
    let vorigesEnde: string | null = null;
    for (const b of buchungen) {
      const betrag = D(b.v.betrag);
      const bezahlt = b.v.kapitalisiert || b.gewandeltDurch ? D(0) : betrag.minus(b.rest);
      perioden.push({
        von: b.pos?.von ?? vorigesEnde,
        bis: b.v.valuta,
        faellig: b.v.kapitalisiert || b.gewandeltDurch ? null : (b.pos?.faelligAm ?? b.v.valuta),
        betrag: cent(betrag),
        gezahlt: cent(bezahlt),
        gewandelt: cent(b.gewandeltDurch ? betrag : D(0)),
        offen: cent(b.rest),
        kapitalisiert: b.v.kapitalisiert,
        status: b.v.kapitalisiert ? "gebucht" : b.gewandeltDurch ? "gewandelt" : b.rest.lessThanOrEqualTo(0) ? "gezahlt" : "offen",
        laufend: false,
        vorgangId: b.v.id,
      });
      vorigesEnde = b.v.valuta;
    }

    let aufgelaufen: string | null = null;
    let fehler: string | null = null;
    let fehlerCode: string | null = null;
    const rechnet = k.beteiligung.status === "aktiv" && k.instrument.status === "aktiv" && k.konditionen.length > 0;
    if (rechnet) {
      try {
        const a = berechneAbgrenzung(k, stichtag)!;
        aufgelaufen = a.gesamt;
        for (const p of a.offenePerioden) {
          const faellig = version && version.stundungBis !== null && version.stundungBis > p.bis ? version.stundungBis : p.bis;
          perioden.push({ von: null, bis: p.bis, faellig: p.kapitalisiert ? null : faellig, betrag: p.betragGebucht, gezahlt: "0.00", gewandelt: "0.00", offen: p.kapitalisiert ? "0.00" : p.betragGebucht, kapitalisiert: p.kapitalisiert, status: "aufgelaufen", laufend: false, vorgangId: null });
        }
        // Von-Daten der noch nicht gebuchten Perioden: Die Periode beginnt, wo die vorige endet.
        let von: string | null = vorigesEnde;
        for (const p of perioden.filter((x) => x.status === "aufgelaufen" && !x.laufend)) {
          p.von = von;
          von = p.bis;
        }
        if (D(a.laufend.betragGebucht).greaterThan(0) || a.laufend.von < a.laufend.bis) {
          perioden.push({ von: a.laufend.von, bis: a.laufend.bis, faellig: naechstePeriode(k, stichtag)?.faelligAm ?? null, betrag: a.laufend.betragGebucht, gezahlt: "0.00", gewandelt: "0.00", offen: a.laufend.betragGebucht, kapitalisiert: false, status: "aufgelaufen", laufend: true, vorgangId: null });
        }
      } catch (e) {
        fehler = (e as Error).message;
        fehlerCode = e instanceof Fachfehler ? e.code : "BERECHNUNG_FEHLGESCHLAGEN";
      }
    }

    // Nächste Fälligkeit: früheste Fälligkeit ab dem Stichtag unter den noch nicht gezahlten, nicht kapitalisierten Perioden.
    const faellige = perioden
      .filter((p) => !p.kapitalisiert && p.status !== "gezahlt" && p.faellig !== null && p.faellig >= stichtag)
      .map((p) => p.faellig as string)
      .sort();
    return {
      ...kopf,
      konditionen,
      aufgelaufen,
      gebucht: cent(gebucht),
      kapitalisiert: cent(kapitalisiert),
      gezahlt: cent(gezahlt),
      gewandelt: cent(gewandelt),
      offen: cent(offen),
      naechsteFaelligkeit: faellige[0] ?? null,
      perioden,
      fehler,
      fehlerCode,
    };
  });

  const summiere = (feld: "aufgelaufen" | "gebucht" | "kapitalisiert" | "gezahlt" | "gewandelt" | "offen") =>
    cent(instrumente.reduce((s, i) => (i[feld] !== null ? s.plus(i[feld] as string) : s), D(0)));
  return {
    stichtag,
    stand: stand === undefined ? null : new Date(stand).toISOString(),
    instrumente,
    summe: { aufgelaufen: summiere("aufgelaufen"), gebucht: summiere("gebucht"), kapitalisiert: summiere("kapitalisiert"), gezahlt: summiere("gezahlt"), gewandelt: summiere("gewandelt"), offen: summiere("offen") },
  };
}
