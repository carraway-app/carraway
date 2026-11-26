import type { szenarienFehlerDe } from "./fehler.szenarien";

/** Britisches Englisch, Fehlertexte zum Bereich „szenarien“ (siehe `fehler.szenarien.ts`). */
export const szenarienFehlerEn: typeof szenarienFehlerDe = {
  scenario_not_found: "The scenario does not exist.",
  scenario_not_locked: "A scenario report can only be released with locked scenarios.",
  scenario_locked: "The scenario is locked and cannot be changed any more.",
  scenario_name_exists: "This fund already has a scenario with this name.",
  scenario_assumptions_invalid: "The assumptions do not fit the fund or lie outside the period (base date not in the future, years between the base year and the end of the projection).",
};
