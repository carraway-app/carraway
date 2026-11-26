import type { zusatzBereichDe } from "./bereich.zusatz";

/** Britisches Englisch, Bereich „zusatz“ (siehe `bereich.zusatz.ts`). */
export const zusatzBereichEn: typeof zusatzBereichDe = {
  zusatzfelder: {
    titel: "Custom fields",
    tab: "Fields",
    beschreibung: "Custom fields record what the standard fields do not cover. Global administrators define them; every value is checked against the field type and logged with before and after.",
    leer: "No custom fields have been defined for this object yet.",
    leerVerwalter: "No custom fields have been defined for this object yet. Use “Manage fields” to create the first one.",
    verwalten: "Manage fields",
    laedt: "Loading custom fields",
    stand: "The view shows an earlier state of knowledge. Values can only be changed in the current state.",
    bearbeiten: (name: string) => `Edit value: ${name}`,
    leeren: (name: string) => `Remove value: ${name}`,
    archiviert: "archived",
    vorgangHinweis: "The values of a transaction apply from the moment it is created. A reversal carries them over; to change them, reverse the transaction and book it again.",
    formular: "Custom fields",
    formularHinweis: "The values cannot be changed after booking.",
    feldKnopf: "Fields",
    feldKnopfFuer: (name: string) => `Show custom fields: ${name}`,
    felderVon: (name: string) => `Custom fields: ${name}`,
    unterTabs: { beteiligung: "Holding", instrument: "Instrument" },
    objekte: { fonds: "Fund", runde: "Financing round", instrument: "Instrument", beteiligung: "Holding", vorgang: "Transaction" },
    spalteFelder: "Fields",
    vorgangFelderZeile: (datum: string, art: string) => `Custom fields: ${art} of ${datum}`,
  },
};
