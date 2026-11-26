/** Fehlertexte der API zum Bereich „szenarien“ (Codes); eigenes Modul, damit sie ohne den ganzen Bereich geladen werden können (`fehlertexte`). */

export const szenarienFehlerDe = {
  SZENARIO_NICHT_GEFUNDEN: "Das Szenario gibt es nicht.",
  SZENARIO_NICHT_FESTGESCHRIEBEN: "Ein Szenariobericht lässt sich nur mit festgeschriebenen Szenarien freigeben.",
  SZENARIO_FESTGESCHRIEBEN: "Das Szenario ist festgeschrieben und nicht mehr änderbar.",
  SZENARIO_NAME_VORHANDEN: "In diesem Fonds gibt es schon ein Szenario mit diesem Namen.",
  SZENARIO_ANNAHMEN_UNGUELTIG: "Die Annahmen passen nicht zum Fonds oder liegen außerhalb des Zeitraums (Basistag nicht in der Zukunft, Jahre zwischen Basisjahr und Prognoseende).",
};
