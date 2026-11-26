import type { Sprache } from "../sprache";

/**
 * Beschlussvorlagen: Text mit Platzhaltern in doppelten geschweiften Klammern. Die Ausgabe ist reiner Text. Ersetzt wird in
 * einem einzigen Durchgang, damit ein eingesetzter Wert, der selbst wie ein Platzhalter aussieht, nicht noch einmal
 * ersetzt wird; Klammern in Werten werden entschärft, und Steuerzeichen entfallen.
 */

export const PLATZHALTER = ["organisation", "titel", "ticket", "fonds", "instrument", "phase", "quelle", "betreuung", "sektor", "ort", "datum"] as const;
export type Platzhalter = (typeof PLATZHALTER)[number];

const MUSTER = /\{\{([^{}]*)\}\}/g;

/** Alle Platzhalter im Text, die es nicht gibt (leer, falsch geschrieben, mit Leerzeichen im Namen). */
export function unbekanntePlatzhalter(text: string): string[] {
  const bekannt: readonly string[] = PLATZHALTER;
  const unbekannt = new Set<string>();
  for (const treffer of text.matchAll(MUSTER)) {
    const name = (treffer[1] ?? "").trim();
    if (!bekannt.includes(name)) unbekannt.add(name === "" ? "(leer)" : name);
  }
  return [...unbekannt];
}

// eslint-disable-next-line no-control-regex -- die Zeichen sind genau das, was entfernt werden soll
const STEUERZEICHEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Entschärft einen Wert für den Einsatz: keine Steuerzeichen, keine zusammenhängenden doppelten Klammern. */
export function entschaerfe(wert: string): string {
  return wert.replace(STEUERZEICHEN, "").replaceAll("{{", "{ {").replaceAll("}}", "} }");
}

export type PlatzhalterWerte = Partial<Record<Platzhalter, string | null>>;

/** Setzt die Werte ein. Fehlende Werte erscheinen als „–“; unbekannte Platzhalter bleiben unverändert stehen. */
export function rendereVorlage(text: string, werte: PlatzhalterWerte): string {
  return text.replace(MUSTER, (treffer, roh: string) => {
    const name = roh.trim() as Platzhalter;
    if (!(PLATZHALTER as readonly string[]).includes(name)) return treffer;
    const wert = werte[name];
    return wert === null || wert === undefined || wert.trim() === "" ? "–" : entschaerfe(wert);
  });
}

/** Betrag aus einer Dezimalzeichenkette mit Tausendertrennung; Nachkommastellen nur, wenn sie nicht null sind. Ohne Gleitkomma. */
export function formatiereBetragText(betrag: string, waehrung: string, sprache: Sprache): string {
  const [ganz = "0", rest = ""] = betrag.split(".");
  const tausender = sprache === "de" ? "." : ",";
  const komma = sprache === "de" ? "," : ".";
  const gruppiert = ganz.replace(/\B(?=(\d{3})+(?!\d))/g, tausender);
  const gekuerzt = rest.replace(/0+$/, "");
  const nachkomma = gekuerzt === "" ? "" : gekuerzt.padEnd(2, "0");
  return `${gruppiert}${nachkomma ? `${komma}${nachkomma}` : ""} ${waehrung}`;
}

export const PHASEN_TEXT: Record<Sprache, Record<string, string>> = {
  de: { anfrage: "Anfrage", erstgespraech: "Erstgespräch", pruefung: "Prüfung", due_diligence: "Due Diligence", investitionsausschuss: "Investitionsausschuss", closing: "Closing" },
  en: { anfrage: "Enquiry", erstgespraech: "First meeting", pruefung: "Screening", due_diligence: "Due diligence", investitionsausschuss: "Investment committee", closing: "Closing" },
};

export const INSTRUMENT_TEXT: Record<Sprache, Record<string, string>> = {
  de: { offene_beteiligung: "Offene Beteiligung", stille_beteiligung: "Stille Beteiligung", darlehen: "Darlehen", wandeldarlehen: "Wandeldarlehen" },
  en: { offene_beteiligung: "Equity", stille_beteiligung: "Silent partnership", darlehen: "Loan", wandeldarlehen: "Convertible loan" },
};

/** Datum `JJJJ-MM-TT` im Format der Sprache. */
export function formatiereDatumText(iso: string, sprache: Sprache): string {
  const [j, m, t] = iso.split("-");
  return sprache === "de" ? `${t}.${m}.${j}` : `${t}/${m}/${j}`;
}
