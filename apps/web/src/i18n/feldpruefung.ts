import type { Sprache } from "@carraway/ui";

/**
 * Meldungen der Prüfung am Feld (`lib/feldpruefung.ts`). Beide Sprachen stehen hier und nicht im Rahmen der Wörterbücher: Sie kommen mit dem
 * Chunk der Formulare, nicht mit dem Start der Anwendung (Budget der Startgröße).
 */
export interface FeldpruefungTexte {
  pflicht: string;
  zahlFormat: string;
  negativ: string;
  positivNoetig: string;
  nichtNull: string;
  nachkomma: (n: number) => string;
  zuGross: string;
  ganzzahl: string;
  bereich: (min: number, max: number) => string;
  datumFormat: string;
  datumFrueh: (grenze: string) => string;
  datumSpaet: (grenze: string) => string;
  waehrung: string;
  waehrungGleich: string;
  waehrungWaehlen: string;
}

const deutsch: FeldpruefungTexte = {
    pflicht: "Bitte eine Angabe machen.",
    zahlFormat: "Bitte eine Zahl eingeben, zum Beispiel 1.250,50.",
    negativ: "Der Wert darf nicht negativ sein.",
    positivNoetig: "Der Wert muss größer als 0 sein.",
    nichtNull: "Der Wert darf nicht 0 sein.",
    nachkomma: (n) => (n === 0 ? "Bitte ohne Nachkommastellen eingeben." : `Höchstens ${n} Nachkommastellen.`),
    zuGross: "Der Wert ist zu groß.",
    ganzzahl: "Bitte eine ganze Zahl eingeben.",
    bereich: (min, max) => `Bitte einen Wert von ${min} bis ${max} eingeben.`,
    datumFormat: "Bitte ein gültiges Datum eingeben.",
    datumFrueh: (grenze) => `Das Datum darf nicht vor dem ${grenze} liegen.`,
    datumSpaet: (grenze) => `Das Datum darf nicht nach dem ${grenze} liegen.`,
    waehrung: "Bitte eine Währung aus der Liste wählen.",
    waehrungGleich: "Basis und Quote müssen verschiedene Währungen sein.",
    waehrungWaehlen: "Währung wählen",
};

const englisch: FeldpruefungTexte = {
    pflicht: "Please enter a value.",
    zahlFormat: "Please enter a number, for example 1,250.50.",
    negativ: "The value must not be negative.",
    positivNoetig: "The value must be greater than 0.",
    nichtNull: "The value must not be 0.",
    nachkomma: (n) => (n === 0 ? "Please enter without decimal places." : `At most ${n} decimal places.`),
    zuGross: "The value is too large.",
    ganzzahl: "Please enter a whole number.",
    bereich: (min, max) => `Please enter a value from ${min} to ${max}.`,
    datumFormat: "Please enter a valid date.",
    datumFrueh: (grenze) => `The date must not be before ${grenze}.`,
    datumSpaet: (grenze) => `The date must not be after ${grenze}.`,
    waehrung: "Please choose a currency from the list.",
    waehrungGleich: "Base and quote must be different currencies.",
    waehrungWaehlen: "Choose currency",
};

export const feldpruefungTexte: Record<Sprache, FeldpruefungTexte> = { de: deutsch, en: englisch };
