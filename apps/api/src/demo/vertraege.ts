import { literal, setzePdf } from "@carraway/berichte";

/**
 * Erfundene Demo-Verträge für die Auslesung (Typst, ohne Zugriff auf Kundendaten): ein Beteiligungsvertrag, ein Wandeldarlehensvertrag und ein
 * Bewertungsnachweis. Jede Seite ist eine Liste von Absätzen. Die Muster liest der regelbasierte KI-Anbieter `lokal` der Erweiterung KI.
 */

export type Absaetze = string[][];

export const beteiligungsvertragSeiten = (): Absaetze => [
  [
    "Beteiligungsvertrag",
    "Datum des Vertragsschlusses: 14. März 2025.",
    "Finanzierungsrunde: Serie A.",
    "Die Pre-Money-Bewertung der Gesellschaft beträgt 4.000.000,00 EUR.",
    "Der Preis je Anteil beträgt 12,50 EUR.",
  ],
  [
    "Beteiligung der Investoren",
    "Investor: Beispielfonds Eins, Betrag: 500.000,00 EUR.",
    "Investor: Muster Kapital GmbH, Betrag: 250.000,00 EUR.",
    "Anteilsklasse: Serie-A-Anteile.",
    "Liquidationspräferenz: 1,0-fach.",
  ],
];

export const wandeldarlehenSeiten = (): Absaetze => [
  ["Wandeldarlehensvertrag", "Datum des Vertragsschlusses: 2. Mai 2025.", "Darlehensart: Wandeldarlehen.", "Darlehensbetrag: 300.000,00 EUR."],
  [
    "Konditionen",
    "Zinssatz: 6,5 % pro Jahr.",
    "Zinsmethode: act/365.",
    "Laufzeit: 24 Monate.",
    "Fälligkeit: 2. Mai 2027.",
    "Wandlungsabschlag: 20 %.",
    "Bewertungsobergrenze: 6.000.000,00 EUR.",
    "Tranche 1: 200.000,00 EUR, fällig am 2. Juni 2025.",
    "Tranche 2: 100.000,00 EUR.",
  ],
];

export const bewertungsnachweisSeiten = (): Absaetze => [
  ["Bewertungsnachweis", "Bewertungsstichtag: 30. September 2025.", "Bewertungsmethode: Letzte Finanzierungsrunde."],
  ["Ergebnis", "Wert der Beteiligung: 1.800.000,00 EUR."],
];

/** Erfundener Registerauszug (Nummer und Namen sind frei erfunden); die Bezeichnungen liest der regelbasierte KI-Anbieter `lokal` der Erweiterung KI. */
export const registerauszugSeiten = (firma: string, sitz: string): Absaetze => [
  [
    "Handelsregisterauszug (Abdruck, erfundenes Beispiel)",
    `Firma: ${firma}`,
    `Sitz: ${sitz}`,
    "Rechtsform: GmbH",
    "Registergericht: Amtsgericht Beispielstadt",
    "Registernummer: HRB 99100",
  ],
  ["Vertretung und Kapital", "Geschäftsführer: Anna Musterfrau", "Geschäftsführer: Bernd Beispielmann", "Stammkapital: 25.000,00 EUR", "Stand: 30. September 2026"],
];

/** PDF mit festem Dokumentdatum: gleiche Eingabe ergibt gleiche Bytes. */
export function erzeugeDemoPdf(seiten: Absaetze, titel: string): Uint8Array {
  const kopf = `#set document(title: ${literal(titel)}, author: "Beispiel", date: datetime(year: 2025, month: 3, day: 14))\n#set page(paper: "a4", margin: 2.5cm)\n#set text(font: "Instrument Sans", lang: "de", size: 11pt)\n#set par(spacing: 1em)\n`;
  const absatz = (t: string, erster: boolean) => (erster ? `#text(size: 16pt, weight: "bold")[#(${literal(t)})]` : `#(${literal(t)})`);
  return setzePdf(kopf + seiten.map((s) => s.map((t, i) => absatz(t, i === 0)).join("\n\n")).join("\n#pagebreak()\n"));
}
