/** Fehlertexte der API zum Bereich „register“ (Codes); eigenes Modul, damit sie ohne den ganzen Bereich geladen werden können (`fehlertexte`). */

export const registerFehlerDe = {
  register_entry_missing: "Für diese Organisation gibt es noch keinen Registereintrag.",
  register_no_difference: "Für dieses Feld gibt es keinen Unterschied zum Register mehr.",
  register_provider_missing: "Es ist kein Anbieter für Registerdaten eingerichtet.",
  register_fetch_failed: "Der Abruf beim Anbieter ist fehlgeschlagen. Bitte später erneut versuchen.",
  register_not_found: "Der Anbieter kennt diesen Registereintrag nicht.",
  register_reference_missing: "Gericht, Registerart und Nummer fehlen. Bitte zuerst einen Registerstand erfassen.",
  register_import_invalid: "Die Datei enthält Fehler, es wurde nichts übernommen.",
  register_event_not_found: "Die Bekanntmachung gibt es nicht.",
  register_event_done: "Die Bekanntmachung ist bereits erledigt.",
  register_notice_not_found: "Die Meldung gibt es nicht.",
};
