import { Decimal } from "./decimal.js";
import { vergleiche, type Datum } from "./datum.js";
import type { Rechenschritt } from "./herkunft.js";
import { ersteAuszahlung, kapitalAm, kapitalverlauf, type Kapitalbewegung } from "./kapitalverlauf.js";
import type { MassgeblichePreisregel } from "./wandlung.js";
import { aufCent } from "./zins.js";
import { zinsenAufVerlauf, type Zinsbedingungen } from "./zinsrechnung.js";

/**
 * Schätzung der Anteile aus einem noch nicht gewandelten Wandeldarlehen zum Stichtag (voll verwässerte Sicht inklusive offener Wandlungen).
 *
 *   Ausstehender Betrag = offenes Kapital am Stichtag (mit kapitalisierten Zinsen) + noch nicht gebuchte Zinsen seit der letzten gebuchten
 *                         Periode bis zum Stichtag (nur, wenn die Zinsen mitwandeln; gebuchte, offene Zinsen bleiben eine Forderung wie bei der Wandlung).
 *   Wandlungspreis      = min(Bewertungsobergrenze ÷ voll verwässerte Anteile vor der Wandlung, Referenzpreis × (1 − Abschlag)),
 *                         jeweils nur, soweit angegeben; ohne Abschlag gilt der Referenzpreis selbst.
 *   Anteile             = Ausstehender Betrag ÷ Wandlungspreis, abgerundet auf ganze Anteile.
 *
 * Es wird nicht geraten: Fehlen Abschlag und Bewertungsobergrenze beide, oder fehlt die Grundlage des Preises (Referenzpreis bzw.
 * Anteile vor der Wandlung), ist das Ergebnis `offen` mit Grund. Fehlt nur eins von beiden, wird geschätzt und das Fehlende genannt.
 * Die Funktion wirft nicht; ungültige Angaben werden zu `offen`.
 */

export interface OffeneWandlungEingabe {
  /** Kapitalbewegungen des Instruments; berücksichtigt werden nur die bis zum Stichtag. */
  bewegungen: readonly Kapitalbewegung[];
  stichtag: Datum;
  /** Zinsbedingungen am Stichtag; fehlen sie, bleiben die Zinsen außen vor (Hinweis `ohne_zinsen`). */
  bedingungen?: Zinsbedingungen | undefined;
  /** Beginn der noch nicht gebuchten Zinsen (letztes gebuchtes Periodenende); Standard: erste Auszahlung. */
  zinsenAb?: Datum | undefined;
  /** Zinsen wandeln mit (Annahme, solange der Vertrag es nicht anders festhält). */
  zinsenWandeln: boolean;
  /** Preis je Anteil der letzten bekannten Runde. */
  referenzpreis?: Decimal.Value | null | undefined;
  /** Abschlag als Bruch (0.2 = 20 %), mindestens 0 und kleiner als 1. */
  abschlag?: Decimal.Value | null | undefined;
  /** Bewertungsobergrenze (Cap) als Betrag. */
  bewertungsobergrenze?: Decimal.Value | null | undefined;
  /** Voll verwässerte Anteile vor der Wandlung (ausgegeben plus Pool). */
  anteileVorWandlung: Decimal.Value;
}

export type OffeneWandlungGrund = "kein_kapital" | "keine_parameter" | "kein_referenzpreis" | "ungueltige_parameter";
export type OffeneWandlungParameter = "abschlag" | "bewertungsobergrenze";

interface Gemeinsam {
  /** Offenes Kapital am Stichtag. */
  kapital: Decimal;
  /** Mitgewandelte, noch nicht gebuchte Zinsen bis zum Stichtag (auf Cent); 0, wenn sie nicht mitwandeln oder Konditionen fehlen. */
  zinsen: Decimal;
  /** Ausstehender Betrag = Kapital + Zinsen. */
  betrag: Decimal;
  /** `ohne_zinsen`: keine Konditionen, Zinsen nicht berücksichtigt. */
  hinweise: "ohne_zinsen"[];
  schritte: Rechenschritt[];
}

export type OffeneWandlungErgebnis =
  | (Gemeinsam & {
      status: "geschaetzt";
      preisJeAnteil: Decimal;
      massgeblich: MassgeblichePreisregel;
      /** Ganze Anteile, abgerundet. */
      anteile: Decimal;
      /** Nicht erfasste Parameter, ohne die geschätzt wurde. */
      fehlend: OffeneWandlungParameter[];
    })
  | (Gemeinsam & { status: "offen"; grund: OffeneWandlungGrund; fehlend: OffeneWandlungParameter[] });

const leer = (x: Decimal.Value | null | undefined): x is null | undefined => x === null || x === undefined || (typeof x === "string" && x.trim() === "");

export function schaetzeOffeneWandlung(e: OffeneWandlungEingabe): OffeneWandlungErgebnis {
  const null0 = new Decimal(0);
  const bis = e.bewegungen.filter((b) => vergleiche(b.datum, e.stichtag) <= 0);
  let kapital = null0;
  let zinsen = null0;
  const hinweise: "ohne_zinsen"[] = [];
  const schritte: Rechenschritt[] = [];
  const fehlend: OffeneWandlungParameter[] = [];
  if (leer(e.abschlag)) fehlend.push("abschlag");
  if (leer(e.bewertungsobergrenze)) fehlend.push("bewertungsobergrenze");
  const offen = (grund: OffeneWandlungGrund): OffeneWandlungErgebnis => ({ status: "offen", grund, fehlend, kapital, zinsen, betrag: kapital.plus(zinsen), hinweise, schritte });

  let verlauf;
  try {
    verlauf = kapitalverlauf(bis).wert;
  } catch {
    return offen("kein_kapital");
  }
  const erste = ersteAuszahlung(verlauf);
  if (erste === undefined) return offen("kein_kapital");
  kapital = kapitalAm(verlauf, e.stichtag);
  if (!kapital.greaterThan(0)) return offen("kein_kapital");
  schritte.push({ zeichen: "", bezeichnung: "Offenes Kapital am Stichtag", wert: kapital.toString() });

  if (e.zinsenWandeln) {
    if (!e.bedingungen) {
      hinweise.push("ohne_zinsen");
    } else {
      const ab = e.zinsenAb && vergleiche(e.zinsenAb, erste) > 0 ? e.zinsenAb : erste;
      if (vergleiche(ab, e.stichtag) < 0) {
        try {
          zinsen = aufCent(zinsenAufVerlauf(verlauf, ab, e.stichtag, e.bedingungen).betragGesamt);
        } catch {
          hinweise.push("ohne_zinsen");
        }
      }
      schritte.push({ zeichen: "+", bezeichnung: `Noch nicht gebuchte Zinsen ${ab} bis ${e.stichtag} (auf Cent)`, wert: zinsen.toString() });
    }
  }
  const betrag = kapital.plus(zinsen);
  schritte.push({ zeichen: "=", bezeichnung: e.zinsenWandeln ? "Ausstehender Betrag (Kapital plus Zinsen)" : "Ausstehender Betrag (nur Kapital)", wert: betrag.toString() });

  if (fehlend.length === 2) return offen("keine_parameter");

  let abschlag: Decimal | null;
  let cap: Decimal | null;
  let referenz: Decimal | null;
  let anteileVor: Decimal;
  try {
    abschlag = leer(e.abschlag) ? null : new Decimal(e.abschlag);
    cap = leer(e.bewertungsobergrenze) ? null : new Decimal(e.bewertungsobergrenze);
    referenz = leer(e.referenzpreis) ? null : new Decimal(e.referenzpreis);
    anteileVor = new Decimal(e.anteileVorWandlung);
  } catch {
    return offen("ungueltige_parameter");
  }
  if (abschlag && (abschlag.isNegative() || abschlag.greaterThanOrEqualTo(1))) return offen("ungueltige_parameter");
  if (cap && !cap.greaterThan(0)) return offen("ungueltige_parameter");
  if (referenz && !referenz.greaterThan(0)) referenz = null;

  const kandidaten: { preis: Decimal; regel: MassgeblichePreisregel }[] = [];
  if (referenz) {
    const preis = abschlag ? referenz.times(new Decimal(1).minus(abschlag)) : referenz;
    schritte.push({ zeichen: "", bezeichnung: "Referenzpreis je Anteil (letzte Runde)", wert: referenz.toString() });
    if (abschlag) schritte.push({ zeichen: "=", bezeichnung: `Preis mit Abschlag ${abschlag.toString()}`, wert: preis.toString() });
    kandidaten.push({ preis, regel: abschlag ? "abschlag" : "rundenpreis" });
  }
  if (cap && anteileVor.greaterThan(0)) {
    const preis = cap.div(anteileVor);
    schritte.push({ zeichen: "=", bezeichnung: "Preis aus Bewertungsobergrenze (Betrag ÷ voll verwässerte Anteile vor der Wandlung)", wert: preis.toString() });
    kandidaten.push({ preis, regel: "bewertungsobergrenze" });
  }
  // Ein Abschlag ohne Referenzpreis oder nur ein Kandidat ohne die Grundlage des anderen: nicht raten.
  if (kandidaten.length === 0 || (abschlag && !referenz) || (cap && !anteileVor.greaterThan(0))) return offen("kein_referenzpreis");
  const gewaehlt = kandidaten.reduce((a, b) => (b.preis.lessThan(a.preis) ? b : a));
  if (!gewaehlt.preis.greaterThan(0)) return offen("ungueltige_parameter");
  schritte.push({ zeichen: "=", bezeichnung: "Wandlungspreis je Anteil (kleinerer Wert)", wert: gewaehlt.preis.toString() });
  const anteile = betrag.div(gewaehlt.preis).floor();
  schritte.push({ zeichen: "=", bezeichnung: "Geschätzte Anteile (Betrag ÷ Preis, abgerundet)", wert: anteile.toString() });
  return { status: "geschaetzt", kapital, zinsen, betrag, preisJeAnteil: gewaehlt.preis, massgeblich: gewaehlt.regel, anteile, fehlend, hinweise, schritte };
}
