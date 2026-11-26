import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { beteiligung, dokument, finanzierungsrunde, fonds, instrument, vorgang, wandlung, wertQuelle } from "@carraway/db";
import { Decimal, schaetzeOffeneWandlung, type MassgeblichePreisregel, type OffeneWandlungGrund, type OffeneWandlungParameter } from "@carraway/rechenkern";
import { sichtbareFonds, type Akteur } from "../anmeldung/akteur";
import { dokumentSichtbar } from "../dokumente/ziele";
import { berechneZustand } from "../instrumente/zustand";
import { gebuchtePerioden, ladeZinskontexte, tagVor, versionAm } from "../instrumente/zinsen";
import type { Tx } from "../zeitlimit";
import type { Kapital } from "./wasserfall";

/**
 * Offene Wandlungen zum Stichtag für die voll verwässerte Sicht der Kapitaltabelle (Schalter „inkl. offener Wandlungen“). Je Wandeldarlehen
 * eines Fonds dieser Plattform am Unternehmen, das am Stichtag noch Kapital hat, eine Schätzung der Anteile (Rechenkern `schaetzeOffeneWandlung`).
 * Wandeldarlehen Dritter kennt das Datenmodell nicht; sie fehlen. Rechte: nur Wandeldarlehen der Fonds, an denen die Person den Bereich Portfolio
 * sieht (wie die Positionen der Vehikel); Darlehen anderer Fonds fehlen ganz (keine Beträge, Namen oder Fundstellen, auch keine Anzahl).
 * Fundstellen nur aus Dokumenten, die die Person sieht (wie `ladeFundstellen`).
 *
 * Herkunft der Parameter: zuerst die Felder am Instrument (`wandlungsabschlag`, `bewertungsobergrenze`, `zinsen_wandeln`, Entscheidung 505), je Feld
 * einzeln. Nur was am Instrument fehlt, kommt als Rückfall aus den Fundstellen (`wert_quelle`, Felder `wandlungsabschlag` und `bewertungsobergrenze`)
 * an der Beteiligung (Entscheidung 236); die gelten nur, wenn die Beteiligung am Stichtag genau ein offenes Wandeldarlehen hat und die Fundstellen
 * eines Feldes übereinstimmen, sonst bleibt die Schätzung offen (`parameter_mehrdeutig`). Referenzpreis ist der Preis je Anteil der letzten Runde bis
 * zum Stichtag, die Bezugsgröße der Bewertungsobergrenze die voll verwässerte Anteilszahl vor der Wandlung (ausgegeben plus Pool). Zinsen wandeln
 * mit: das Feld am Instrument, ohne Angabe die Annahme „ja“ (`zinsenWandelnAngenommen`).
 * Jede Schätzung rechnet für sich auf derselben Bezugsgröße (gegenseitige Verwässerung der Wandlungen bleibt außen vor). Wirft nicht.
 *
 * SAFE (Issue 149): genauso, nur ohne Zinsen. „Zinsen wandeln“ ist bei einem SAFE immer nein (keine Annahme, kein Hinweis `ohne_zinsen`); das Kapital
 * sind die Auszahlungen auf das SAFE-Instrument.
 */

export type OffeneWandlungStatus = "geschaetzt" | "offen";

export interface OffeneWandlung {
  instrumentId: string;
  /** `wandeldarlehen` oder `safe`. */
  art: "wandeldarlehen" | "safe";
  bezeichnung: string;
  beteiligungId: string;
  fonds: { id: string; name: string };
  diesesFonds: boolean;
  status: OffeneWandlungStatus;
  /** Bei `offen`: warum nicht geschätzt wurde. */
  grund: OffeneWandlungGrund | "parameter_mehrdeutig" | null;
  /** Nicht erfasste Parameter. */
  fehlend: OffeneWandlungParameter[];
  /** `ohne_zinsen`: keine Konditionen, Zinsen nicht berücksichtigt. */
  hinweise: "ohne_zinsen"[];
  /** Zinsen wandeln mit: Angabe am Instrument oder, ohne Angabe, die Annahme „ja“. */
  zinsenWandeln: boolean;
  zinsenWandelnAngenommen: boolean;
  kapital: string;
  zinsen: string;
  betrag: string;
  abschlag: string | null;
  bewertungsobergrenze: string | null;
  preisJeAnteil: string | null;
  massgeblich: MassgeblichePreisregel | null;
  anteile: string | null;
}

export interface OffeneWandlungen {
  /** Annahme, wo das Instrument „Zinsen wandeln“ nicht festhält: Zinsen wandeln mit. */
  zinsenWandeln: boolean;
  referenzpreis: string | null;
  anteileVorWandlung: string;
  liste: OffeneWandlung[];
  /** Summe der geschätzten Anteile. */
  anteile: string;
}

/** Zahl einer Fundstelle in Normalform; eine nicht lesbare Zahl bleibt als Text stehen (und macht die Schätzung offen). */
function zahl(wert: string): string {
  try {
    return new Decimal(wert.trim()).toString();
  } catch {
    return wert;
  }
}

const PARAMETER = { wandlungsabschlag: "abschlag", bewertungsobergrenze: "bewertungsobergrenze" } as const;

export async function ladeOffeneWandlungen(tx: Tx, akteur: Akteur, k: Kapital, fondsId: string): Promise<OffeneWandlungen> {
  const stichtag = k.stichtag;
  const referenzpreis = k.letzteRunde?.preisJeAnteil ?? null;
  const anteileVorWandlung = k.anteileVollVerwaessert;
  const leer: OffeneWandlungen = { zinsenWandeln: true, referenzpreis, anteileVorWandlung, liste: [], anteile: "0" };
  const sichtbar = sichtbareFonds(akteur, "betrachter", "portfolio");
  if (sichtbar !== "alle" && sichtbar.length === 0) return leer;
  const kandidaten = await tx
    .select({ id: instrument.id, art: instrument.art, bezeichnung: instrument.bezeichnung, status: instrument.status, abschlag: instrument.wandlungsabschlag, obergrenze: instrument.bewertungsobergrenze, zinsenWandeln: instrument.zinsenWandeln, beteiligungId: beteiligung.id, fondsId: fonds.id, fondsName: fonds.name })
    .from(instrument)
    .innerJoin(beteiligung, eq(beteiligung.id, instrument.beteiligungId))
    .innerJoin(fonds, eq(fonds.id, beteiligung.fondsId))
    .where(
      and(
        eq(beteiligung.organisationId, k.organisation.id),
        inArray(instrument.art, ["wandeldarlehen", "safe"]),
        inArray(instrument.status, ["aktiv", "gewandelt"]),
        sichtbar === "alle" ? undefined : inArray(beteiligung.fondsId, sichtbar),
      ),
    );
  if (kandidaten.length === 0) return leer;
  const ids = kandidaten.map((x) => x.id);

  // Eine Wandlung bis zum Stichtag oder auf eine Runde, die zum Stichtag schon in der Tabelle steht, ist keine offene Wandlung mehr.
  const wandlungen = await tx
    .select({ quelle: wandlung.quellInstrumentId, cutoff: wandlung.cutoff, rundeDatum: finanzierungsrunde.datum })
    .from(wandlung)
    .innerJoin(finanzierungsrunde, eq(finanzierungsrunde.id, wandlung.rundeId))
    .where(inArray(wandlung.quellInstrumentId, ids));
  const erledigt = new Set(wandlungen.filter((w) => w.cutoff <= stichtag || w.rundeDatum <= stichtag).map((w) => w.quelle));
  const offen = kandidaten.filter((x) => !erledigt.has(x.id) && !(x.status === "gewandelt" && !wandlungen.some((w) => w.quelle === x.id)));
  if (offen.length === 0) return leer;

  const kontexte = new Map((await ladeZinskontexte(tx, { instrumentIds: offen.filter((x) => x.art === "wandeldarlehen").map((x) => x.id) })).map((c) => [c.instrument.id, c]));
  // Ein SAFE ist nicht darlehensartig und hat keinen Zinskontext: seine Vorgänge kommen direkt.
  const safeIds = offen.filter((x) => x.art === "safe").map((x) => x.id);
  const safeVorgaenge = safeIds.length ? await tx.select().from(vorgang).where(inArray(vorgang.instrumentId, safeIds)).orderBy(asc(vorgang.valuta), asc(vorgang.erfasstAm), asc(vorgang.id)) : [];
  const beteiligungIds = [...new Set(offen.map((x) => x.beteiligungId))];
  const quellen = await tx
    .select({ objektId: wertQuelle.objektId, feld: wertQuelle.feld, wert: wertQuelle.wert })
    .from(wertQuelle)
    .innerJoin(dokument, eq(dokument.id, wertQuelle.dokumentId))
    .where(
      and(
        eq(wertQuelle.objektTyp, "beteiligung"),
        inArray(wertQuelle.objektId, beteiligungIds),
        inArray(wertQuelle.feld, Object.keys(PARAMETER)),
        inArray(dokument.status, ["aktiv", "ersetzt"]),
        dokumentSichtbar(akteur, sql`${wertQuelle.dokumentId}`),
      ),
    );

  const vorlaeufig = offen.map((x) => {
    const kontext = kontexte.get(x.id);
    let bewegungen: ReturnType<typeof berechneZustand>["bewegungen"] = [];
    let bedingungen: Parameters<typeof schaetzeOffeneWandlung>[0]["bedingungen"];
    let zinsenAb: string | undefined;
    if (x.art === "safe") {
      try {
        bewegungen = berechneZustand(safeVorgaenge.filter((v) => v.instrumentId === x.id && v.valuta <= stichtag)).bewegungen;
      } catch {
        bewegungen = [];
      }
    } else if (kontext) {
      try {
        bewegungen = berechneZustand(kontext.vorgaenge.filter((v) => v.valuta <= stichtag)).bewegungen;
      } catch {
        bewegungen = [];
      }
      const version = kontext.konditionen.length > 0 ? versionAm(kontext.konditionen, tagVor(stichtag)) : undefined;
      if (version) {
        bedingungen = {
          satzFix: version.satzFix,
          methode: version.methode,
          ...(version.gewinnabhaengigSatz !== null && version.kappungSatz !== null ? { gewinnabhaengig: { satz: version.gewinnabhaengigSatz, kappungSatz: version.kappungSatz, bemessung: kontext.ueberschuesse } } : {}),
        };
      }
      zinsenAb = gebuchtePerioden(kontext).filter((d) => d <= stichtag).at(-1);
    }
    return { x, bewegungen, bedingungen, zinsenAb };
  });
  // Erst das Kapital am Stichtag (ohne Parameter), damit die Zuordnung der Fundstellen nur offene Wandeldarlehen zählt.
  const mitKapital = vorlaeufig.filter((v) => schaetzeOffeneWandlung({ bewegungen: v.bewegungen, stichtag, zinsenWandeln: false, anteileVorWandlung: 0 }).kapital.greaterThan(0));
  const jeBeteiligung = new Map<string, number>();
  for (const v of mitKapital) jeBeteiligung.set(v.x.beteiligungId, (jeBeteiligung.get(v.x.beteiligungId) ?? 0) + 1);

  const liste: OffeneWandlung[] = mitKapital.map(({ x, bewegungen, bedingungen, zinsenAb }) => {
    // Je Feld zuerst das Instrument; nur was dort fehlt, kommt aus den Fundstellen (Rückfall).
    const werte: { abschlag: string | null; bewertungsobergrenze: string | null } = { abschlag: x.abschlag === null ? null : zahl(x.abschlag), bewertungsobergrenze: x.obergrenze === null ? null : zahl(x.obergrenze) };
    let mehrdeutig = false;
    let rueckfall = false;
    for (const [feld, schluessel] of Object.entries(PARAMETER)) {
      if (werte[schluessel] !== null) continue;
      const verschieden = [...new Set(quellen.filter((q) => q.objektId === x.beteiligungId && q.feld === feld).map((q) => zahl(q.wert)))];
      if (verschieden.length > 1) mehrdeutig = true;
      else if (verschieden.length === 1) {
        werte[schluessel] = verschieden[0]!;
        rueckfall = true;
      }
    }
    if (rueckfall && (jeBeteiligung.get(x.beteiligungId) ?? 0) > 1) mehrdeutig = true;
    const safe = x.art === "safe";
    const zinsenWandeln = safe ? false : (x.zinsenWandeln ?? true);
    const e = schaetzeOffeneWandlung({
      bewegungen,
      stichtag,
      bedingungen,
      zinsenAb,
      zinsenWandeln,
      referenzpreis,
      abschlag: mehrdeutig ? null : werte.abschlag,
      bewertungsobergrenze: mehrdeutig ? null : werte.bewertungsobergrenze,
      anteileVorWandlung,
    });
    const geschaetzt = e.status === "geschaetzt" && !mehrdeutig;
    return {
      instrumentId: x.id,
      art: safe ? "safe" : "wandeldarlehen",
      bezeichnung: x.bezeichnung,
      beteiligungId: x.beteiligungId,
      fonds: { id: x.fondsId, name: x.fondsName },
      diesesFonds: x.fondsId === fondsId,
      status: geschaetzt ? "geschaetzt" : "offen",
      grund: mehrdeutig ? "parameter_mehrdeutig" : e.status === "offen" ? e.grund : null,
      fehlend: mehrdeutig ? [] : e.fehlend,
      hinweise: e.hinweise,
      zinsenWandeln,
      zinsenWandelnAngenommen: !safe && x.zinsenWandeln === null,
      kapital: e.kapital.toFixed(2),
      zinsen: e.zinsen.toFixed(2),
      betrag: e.betrag.toFixed(2),
      abschlag: mehrdeutig ? null : werte.abschlag,
      bewertungsobergrenze: mehrdeutig ? null : werte.bewertungsobergrenze,
      preisJeAnteil: geschaetzt && e.status === "geschaetzt" ? e.preisJeAnteil.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6) : null,
      massgeblich: geschaetzt && e.status === "geschaetzt" ? e.massgeblich : null,
      anteile: geschaetzt && e.status === "geschaetzt" ? e.anteile.toFixed(0) : null,
    };
  });
  const anteile = liste.reduce((s, w) => s.plus(w.anteile ?? 0), new Decimal(0));
  return { ...leer, liste, anteile: anteile.toFixed(0) };
}
