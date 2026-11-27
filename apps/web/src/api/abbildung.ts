/**
 * Abbildung zwischen der englischen Schnittstelle und den Begriffen der Oberfläche (Entscheidung 520, Issue 184). Die API nennt
 * Fondsrollen `viewer`, `editor`, `approver`, `admin` und Bereiche `finance`, `metrics` …; die Oberfläche rechnet intern mit den
 * deutschen Namen (`betrachter`, `finanzen` …), die auch ihre Texte und Berechtigungsprüfungen tragen. Die Umrechnung geschieht
 * ausschließlich hier, im Api-Teil, damit Seiten und Komponenten davon nichts merken.
 */

export type Stufe = "betrachter" | "bearbeiter" | "freigeber" | "verwalter";
export type BereichName = "portfolio" | "finanzen" | "kennzahlen" | "berichte" | "meldewesen" | "dealflow" | "kontakte" | "dokumente" | "daten" | "fondsverwaltung" | "einzelzuteilungen";

export const themaVonApi = (t: "system" | "light" | "dark") => ({ thema: ({ system: "system", light: "hell", dark: "dunkel" } as const)[t] });
export const themaAnApi = (t: "system" | "hell" | "dunkel") => ({ system: "system", hell: "light", dunkel: "dark" } as const)[t];
