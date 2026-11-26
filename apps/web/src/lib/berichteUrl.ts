import { api } from "../api/client";

export interface BerichtParameter {
  sprache: "de" | "en";
  stichtag?: string | undefined;
  /** Wissensstand als ISO-Zeitstempel; ohne ihn gilt der Zeitpunkt des Downloads. */
  stand?: string | undefined;
  /** Währungssicht (nur Fondsbericht und Portfolioliste); ohne Angabe die Fondswährung. */
  waehrungssicht?: "lokal" | "vergleich" | undefined;
  vergleichswaehrung?: string | undefined;
}

const abfrage = ({ sprache, stichtag, stand }: BerichtParameter) => ({ language: sprache, ...(stichtag ? { asOf: stichtag } : {}), ...(stand ? { knowledgeDate: stand } : {}) });
const sichtAbfrage = ({ waehrungssicht, vergleichswaehrung }: BerichtParameter) => ({ ...(waehrungssicht ? { currencyView: waehrungssicht === "lokal" ? "local" as const : "comparison" as const } : {}), ...(vergleichswaehrung ? { comparisonCurrency: vergleichswaehrung } : {}) });
const relativ = (url: URL) => `${url.pathname}${url.search}`;

/** Adressen der Berichte als normale Links (`<a href download>`); die API liefert die Datei mit `Content-Disposition: attachment`. */
export const fondsberichtUrl = (fondsId: string, format: "pdf" | "xlsx", p: BerichtParameter) =>
  relativ(api.api.v1.funds[":id"].reports["fund-report"].$url({ param: { id: fondsId }, query: { ...abfrage(p), ...sichtAbfrage(p), format } }));
export const portfoliolisteUrl = (fondsId: string, p: BerichtParameter) =>
  relativ(api.api.v1.funds[":id"].reports["portfolio-list"].$url({ param: { id: fondsId }, query: { ...abfrage(p), ...sichtAbfrage(p), format: "xlsx" } }));
export const quartalsberichtUrl = (beteiligungId: string, p: BerichtParameter) =>
  relativ(api.api.v1.investments[":id"].reports["quarterly-report"].$url({ param: { id: beteiligungId }, query: { ...abfrage(p), format: "pdf" } }));
/** Die Gremienvorlage gilt für den heutigen Tag; ein Stichtag wird nicht gesendet. */
export const gremienvorlageUrl = (p: Pick<BerichtParameter, "sprache" | "stand">) =>
  relativ(api.api.v1.reports["committee-pack"].$url({ query: { language: p.sprache, ...(p.stand ? { knowledgeDate: p.stand } : {}), format: "pdf" } }));

/** Datei eines Berichts mit Freigabe: freigegeben genau die gespeicherten Bytes, sonst ein Entwurf mit Wasserzeichen. */
export const berichtDateiUrl = (berichtId: string) => relativ(api.api.v1.reports[":id"].file.$url({ param: { id: berichtId } }));
/** Ausfuhr des Trichters als CSV und die Vorlagen des Kontaktimports als normale Links. */
export const trichterExportUrl = (p: { sprache: "de" | "en"; von?: string | undefined; bis?: string | undefined; fondsId?: string | undefined }) =>
  relativ(api.api.v1.dealflow.funnel.export.$url({ query: { language: p.sprache, ...(p.von ? { from: p.von } : {}), ...(p.bis ? { to: p.bis } : {}), ...(p.fondsId ? { fundId: p.fondsId } : {}) } }));
export const importVorlageUrl = (sprache: "de" | "en", format: "csv" | "xlsx") => relativ(api.api.v1["contact-import"].template.$url({ query: { language: sprache, format } }));
