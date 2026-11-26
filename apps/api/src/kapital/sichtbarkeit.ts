import { Decimal, type Rechenschritt, type WasserfallZeile } from "@carraway/rechenkern";
import { sichtbareFonds, type Akteur } from "../anmeldung/akteur";
import type { Halter, Kapital, KapitalZeile } from "./wasserfall";

/**
 * Sichtbarkeit der Zeilen aus Optionsscheinen, Ausübungen und Anteilsübertragungen nach Fondsrechten (wie `ladeOffeneWandlungen`): Details eines Fonds
 * sieht nur, wer an ihm den Bereich Portfolio sieht (`sichtbareFonds(akteur, "betrachter", "portfolio")`). Für alle anderen Fonds bleiben nur
 * zusammengefasste Anteilszahlen ohne Id, Name, Instrument, Preis, Kaufpreis und Laufzeit, damit Summen, Anteile und der Wasserfall weiter aufgehen.
 * Rundenpositionen zeigen den Fonds als Gesellschafter mit Klasse und Anteilen. Ihr Rundenbetrag stammt aus der Finanzierungsrunde.
 * Fondsinterne Bewertungen, Buchwerte und Kosten gehören zu den geschützten Fondsdaten.
 * Gerechnet wird immer mit allen Zeilen (`ladeKapital`, `kernEingabe`); verdeckt wird erst in der Antwort.
 */

export type Sichtbar = (fondsId: string | null | undefined) => boolean;

export function sichtbarFuer(akteur: Akteur): Sichtbar {
  const fonds = sichtbareFonds(akteur, "betrachter", "portfolio");
  if (fonds === "alle") return () => true;
  const menge = new Set(fonds);
  return (fondsId) => !fondsId || menge.has(fondsId);
}

const anonymerFonds: Halter = { art: "fonds", id: null, name: "", vehikel: null };
const anonymeOptionsscheine: Halter = { art: "optionsschein", id: null, name: "", vehikel: null };

/**
 * Zeilen der Kapitaltabelle, die zu verdecken sind, mit der Id und dem Halter der Sammelzeile: Ausübungen und Zugänge aus Übertragungen eines unsichtbaren
 * Fonds je Klasse (und Runde), offene Optionsscheine unsichtbarer Fonds in einer Zeile.
 */
export function verdeckteZeilen(k: Kapital, sichtbar: Sichtbar): Map<string, { id: string; halter: Halter }> {
  const aus = new Map<string, { id: string; halter: Halter }>();
  const fondsDerOptionsscheine = new Map(k.optionsscheine.map((o) => [o.id, o.fondsId] as const));
  for (const z of k.zeilen) {
    if (z.id.startsWith("ausuebung:") && !sichtbar(z.halter.id)) aus.set(z.id, { id: `ausuebung:verdeckt:${z.klasseId ?? "stamm"}`, halter: anonymerFonds });
    else if (z.id.startsWith("optionsschein:") && !sichtbar(fondsDerOptionsscheine.get(z.id))) aus.set(z.id, { id: "optionsschein:verdeckt", halter: anonymeOptionsscheine });
    else if (z.uebertragung && z.halter.art === "fonds" && !sichtbar(z.halter.id)) aus.set(z.id, { id: `uebertragung:verdeckt:${z.klasseId ?? "stamm"}:${z.runde?.id ?? ""}`, halter: anonymerFonds });
  }
  // Offene Optionsscheine im Wasserfall haben dieselbe Id wie in der Kapitaltabelle.
  for (const o of k.optionsscheine) if (!sichtbar(o.fondsId)) aus.set(o.id, { id: "optionsschein:verdeckt", halter: anonymeOptionsscheine });
  return aus;
}

/**
 * Kapitaltabelle für die Antwort: verdeckte Zeilen zu Sammelzeilen zusammengefasst (Anteile summiert). Investiert der Sammelzeilen aus Ausübungen ist 0
 * (er verriete den Ausübungspreis); bei Übertragungen bleibt die mitgenommene Präferenzbasis (sie stammt aus den Positionen der Runde), Kaufpreis und
 * Rechenschritte entfallen. Gesamtzahlen bleiben unverändert.
 */
export function verdeckeKapital(k: Kapital, sichtbar: Sichtbar): Kapital {
  const verdeckt = verdeckteZeilen(k, sichtbar);
  if (verdeckt.size === 0 && !k.zeilen.some((z) => z.uebertragung && !sichtbar(z.uebertragung.verkaeuferFondsId))) return k;
  const zeilen: KapitalZeile[] = [];
  const sammel = new Map<string, KapitalZeile>();
  for (const z of k.zeilen) {
    const v = verdeckt.get(z.id);
    if (!v) {
      // Zugang eines sichtbaren Käufers aus dem Bestand eines nicht sichtbaren Fonds: ohne Preis, Kaufpreis, Quelle und Rechenschritte.
      zeilen.push(z.uebertragung && !sichtbar(z.uebertragung.verkaeuferFondsId) ? { ...z, uebertragung: null } : z);
      continue;
    }
    const investiert = z.id.startsWith("uebertragung:") ? z.investiert : "0.00";
    const vorhanden = sammel.get(v.id);
    if (vorhanden) {
      vorhanden.anteile = new Decimal(vorhanden.anteile).plus(z.anteile).toFixed(0);
      vorhanden.investiert = new Decimal(vorhanden.investiert).plus(investiert).toFixed(2);
      continue;
    }
    const neu: KapitalZeile = { id: v.id, halter: v.halter, klasseId: z.klasseId, runde: z.runde, anteile: new Decimal(z.anteile).toFixed(0), investiert: new Decimal(investiert).toFixed(2), diesesFonds: false, ausgegeben: z.ausgegeben, datum: null, uebertragung: null };
    sammel.set(v.id, neu);
    zeilen.push(neu);
  }
  return { ...k, zeilen, optionsscheine: k.optionsscheine.filter((o) => sichtbar(o.fondsId)) };
}

const SUMMEN = ["anteile", "investiert", "anspruch", "praeferenz", "beteiligung", "gesamt", "treuhand", "sofort"] as const;
type WasserfallAusgabe = { id: string; halter: Halter; multiple: string | null; gedeckelt: boolean; diesesFonds: boolean; optionsschein: unknown } & Record<(typeof SUMMEN)[number], string>;

/**
 * Zeilen der Wasserfall-Antwort: verdeckte Zeilen (`verdeckteZeilen`) zu Sammelzeilen ohne Id, Name, Ausübungspreis und Laufzeit zusammengefasst; die
 * Beträge werden summiert, das Multiple entfällt. Die Verteilung selbst ist mit allen Zeilen gerechnet.
 */
export function fasseWasserfallZusammen<T extends WasserfallAusgabe>(zeilen: T[], verdeckt: Map<string, { id: string; halter: Halter }>): T[] {
  const aus: T[] = [];
  const sammel = new Map<string, T>();
  for (const z of zeilen) {
    const v = verdeckt.get(z.id);
    if (!v) {
      aus.push(z);
      continue;
    }
    const vorhanden = sammel.get(v.id);
    if (vorhanden) {
      for (const feld of SUMMEN) (vorhanden as Record<string, unknown>)[feld] = new Decimal(vorhanden[feld]).plus(z[feld]).toFixed(feld === "anteile" ? 0 : 2);
      vorhanden.gedeckelt = vorhanden.gedeckelt || z.gedeckelt;
      continue;
    }
    const neu = { ...z, id: v.id, halter: v.halter, multiple: null, diesesFonds: false, optionsschein: null };
    sammel.set(v.id, neu);
    aus.push(neu);
  }
  return aus;
}

const NULL = new Decimal(0);

/**
 * Wasserfall-Zeilen für die Antwort: Verdeckte Ausübungen ohne Investition, Anspruch und Präferenz (daraus ließe sich der Ausübungspreis zurückrechnen);
 * ihr Rückfluss steht ganz als Beteiligung, damit die Summen gleich bleiben. Ohne solche Zeilen dieselbe Liste.
 */
export function entschaerfeZeilen(zeilen: WasserfallZeile[], verdeckt: Map<string, { id: string; halter: Halter }>): WasserfallZeile[] {
  if (![...verdeckt.values()].some((v) => v.id.startsWith("ausuebung:"))) return zeilen;
  return zeilen.map((z) => (verdeckt.get(z.id)?.id.startsWith("ausuebung:") ? { ...z, investiert: NULL, anspruch: NULL, praeferenz: NULL, beteiligung: z.gesamt, multiple: null } : z));
}

/**
 * Rechenschritte für die Antwort: Gibt es verdeckte Ausübungen mit Anteilsklasse (Präferenz aus dem Ausübungspreis) oder verdeckte offene Optionsscheine
 * (Summe der Ausübungspreise im Geld), verrieten Anspruch, Präferenzen und Basispreise Einzelwerte; dann steht statt des Rechenwegs ein Hinweis.
 */
export function schritteFuerAnsicht(schritte: Rechenschritt[], verdeckt: Map<string, { id: string; halter: Halter }>): Rechenschritt[] {
  return rechenwegHeikel(verdeckt) ? [{ zeichen: "", bezeichnung: "Rechenweg nicht sichtbar: Er enthält Bestände von Fonds, die Sie nicht sehen.", wert: "" }] : schritte;
}

/**
 * Verrieten Rechenweg und Gesamtgrößen des Wasserfalls Einzelwerte verdeckter Zeilen? Ja bei verdeckten Ausübungen mit Anteilsklasse (Präferenz aus dem
 * Ausübungspreis) und bei verdeckten offenen Optionsscheinen (Ausübungspreis als Basispreis). Dann entfallen Rechenweg, Rest nach Präferenzen, Betrag je
 * Anteil und Minderungsfaktor; aus Erlös minus angezeigter Präferenzen ließe sich sonst der verdeckte Wert ableiten.
 */
export function rechenwegHeikel(verdeckt: Map<string, { id: string; halter: Halter }>): boolean {
  return [...verdeckt.values()].some((v) => v.id === "optionsschein:verdeckt" || (v.id.startsWith("ausuebung:verdeckt:") && v.id !== "ausuebung:verdeckt:stamm"));
}
