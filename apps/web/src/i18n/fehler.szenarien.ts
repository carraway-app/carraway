/** Fehlertexte der API zum Bereich „szenarien“ (Codes); eigenes Modul, damit sie ohne den ganzen Bereich geladen werden können (`fehlertexte`). */

export const szenarienFehlerDe = {
  scenario_not_found: "Das Szenario gibt es nicht.",
  scenario_not_locked: "Ein Szenariobericht lässt sich nur mit festgeschriebenen Szenarien freigeben.",
  scenario_locked: "Das Szenario ist festgeschrieben und nicht mehr änderbar.",
  scenario_name_exists: "In diesem Fonds gibt es schon ein Szenario mit diesem Namen.",
  scenario_assumptions_invalid: "Die Annahmen passen nicht zum Fonds oder liegen außerhalb des Zeitraums (Basistag nicht in der Zukunft, Jahre zwischen Basisjahr und Prognoseende).",
};
