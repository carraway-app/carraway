import type { szenarienFehlerDe } from "./fehler.szenarien";

/** Britisches Englisch, Fehlertexte zum Bereich „szenarien“ (siehe `fehler.szenarien.ts`). */
export const szenarienFehlerEn: typeof szenarienFehlerDe = {
  SZENARIO_NICHT_GEFUNDEN: "The scenario does not exist.",
  SZENARIO_NICHT_FESTGESCHRIEBEN: "A scenario report can only be released with locked scenarios.",
  SZENARIO_FESTGESCHRIEBEN: "The scenario is locked and cannot be changed any more.",
  SZENARIO_NAME_VORHANDEN: "This fund already has a scenario with this name.",
  SZENARIO_ANNAHMEN_UNGUELTIG: "The assumptions do not fit the fund or lie outside the period (base date not in the future, years between the base year and the end of the projection).",
};
