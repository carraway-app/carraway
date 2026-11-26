import { formatDatum, type Sprache } from "@carraway/ui";
import { aufzaehlung, tabelleFuer } from "../i18n";

/** Anzeige der Werte einer Meldung nach dem Format des Feldes. Ein fehlender Wert ist „k. A.“, nie 0. */

export interface FeldKopf {
  format: string;
  einheit?: string | undefined;
  quelle: { art: string; feld?: string };
}

const LOCALE: Record<Sprache, string> = { de: "de-DE", en: "en-GB" };

function aufzaehlungArt(f: FeldKopf, je: string | null): "instrument" | "status" | "mittelart" | null {
  if (f.quelle.art !== "stammdaten") return null;
  switch (f.quelle.feld) {
    case "beteiligung.instrument": return "instrument";
    case "beteiligung.status": return "status";
    case "foerderung.mittelart": return "mittelart";
    case "gruppe.schluessel":
    case "gruppe.bezeichnung":
      return je === "instrument" ? "instrument" : je === "mittelart" ? "mittelart" : null;
    default: return null;
  }
}

export function formatMeldeWert(wert: string | null, f: FeldKopf, sprache: Sprache, waehrung: string, kontext: { je: string | null; ohne: boolean } = { je: null, ohne: false }): string {
  const t = tabelleFuer(sprache);
  if (wert === null) return kontext.ohne && f.quelle.feld?.startsWith("gruppe.") ? t.melde.ohneZuordnung : t.melde.kein;
  switch (f.format) {
    case "betrag":
    {
      const code = /^[A-Z]{3}$/.test(f.einheit ?? "") ? f.einheit! : waehrung;
      return new Intl.NumberFormat(LOCALE[sprache], { style: "currency", currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(wert));
    }
    case "zahl":
      return new Intl.NumberFormat(LOCALE[sprache], { maximumFractionDigits: 4 }).format(Number(wert));
    case "ganzzahl":
      return new Intl.NumberFormat(LOCALE[sprache], { maximumFractionDigits: 0 }).format(Number(wert));
    case "prozent":
      return `${new Intl.NumberFormat(LOCALE[sprache], { maximumFractionDigits: 2 }).format(Number(wert))}${sprache === "de" ? " %" : "%"}`;
    case "datum":
      return formatDatum(wert, sprache);
    case "ja_nein":
      return wert === "ja" ? (sprache === "de" ? "Ja" : "Yes") : wert === "nein" ? (sprache === "de" ? "Nein" : "No") : wert;
    default: {
      const art = aufzaehlungArt(f, kontext.je);
      if (art === "instrument") return aufzaehlung(t.instrument, wert);
      if (art === "status") return aufzaehlung(t.beteiligungStatus, wert);
      if (art === "mittelart") return wert.split(", ").map((w) => aufzaehlung(t.melde.mittelart, w)).join(", ");
      return wert;
    }
  }
}
