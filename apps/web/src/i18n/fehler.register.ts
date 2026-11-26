/** Fehlertexte der API zum Bereich „register“ (Codes); eigenes Modul, damit sie ohne den ganzen Bereich geladen werden können (`fehlertexte`). */

export const registerFehlerDe = {
  REGISTER_EINTRAG_FEHLT: "Für diese Organisation gibt es noch keinen Registereintrag.",
  REGISTER_KEIN_UNTERSCHIED: "Für dieses Feld gibt es keinen Unterschied zum Register mehr.",
  REGISTER_ANBIETER_FEHLT: "Es ist kein Anbieter für Registerdaten eingerichtet.",
  REGISTER_ABRUF_FEHLGESCHLAGEN: "Der Abruf beim Anbieter ist fehlgeschlagen. Bitte später erneut versuchen.",
  REGISTER_NICHT_GEFUNDEN: "Der Anbieter kennt diesen Registereintrag nicht.",
  REGISTER_REFERENZ_FEHLT: "Gericht, Registerart und Nummer fehlen. Bitte zuerst einen Registerstand erfassen.",
  REGISTER_IMPORT_UNGUELTIG: "Die Datei enthält Fehler, es wurde nichts übernommen.",
  REGISTER_EREIGNIS_NICHT_GEFUNDEN: "Die Bekanntmachung gibt es nicht.",
  REGISTER_EREIGNIS_ERLEDIGT: "Die Bekanntmachung ist bereits erledigt.",
  REGISTER_MELDUNG_NICHT_GEFUNDEN: "Die Meldung gibt es nicht.",
};
