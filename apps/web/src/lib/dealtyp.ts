export const DEALTYPEN = ["erstinvestment", "anschlussinvestment"] as const;
export type Dealtyp = (typeof DEALTYPEN)[number];

export const dealtypTexte = {
  de: {
    feld: "Dealtyp",
    bearbeiten: "Dealtyp bearbeiten",
    ohne: "Ohne Dealtyp",
    erstinvestment: "Erstinvestment",
    anschlussinvestment: "Anschlussinvestment",
  },
  en: {
    feld: "Deal type",
    bearbeiten: "Edit deal type",
    ohne: "No deal type",
    erstinvestment: "Initial investment",
    anschlussinvestment: "Follow-on investment",
  },
};

export function dealtypName(typ: Dealtyp | null, sprache: "de" | "en"): string {
  return dealtypTexte[sprache][typ ?? "ohne"];
}
