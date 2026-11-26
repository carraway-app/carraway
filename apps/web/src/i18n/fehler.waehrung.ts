/** Fehlertexte der API zum Bereich „Währung“ (Codes); eigenes Modul, damit sie ohne den ganzen Bereich geladen werden können (`fehlertexte`). */

export const waehrungFehlerDe = {
  KURS_FEHLT: "Für die Umrechnung liegt zum Stichtag kein ausreichend aktueller Wechselkurs vor. Bitte den Kurs erfassen oder importieren; es wird kein Kurs geschätzt.",
  WAEHRUNG_GLEICH: "Diese Beteiligung hat keine abweichende lokale Währung. Lokale Beträge sind nur bei einer anderen lokalen Währung zulässig.",
  KURS_VORHANDEN: "Für diesen Tag und dieses Währungspaar gibt es schon einen Kurs. Eine Änderung ist eine Korrektur mit Grund.",
  KURS_NICHT_GEFUNDEN: "Dieser Wechselkurs existiert nicht oder gehört zu einem anderen Tag oder Währungspaar.",
  KURSDATEI_UNGUELTIG: "Die Kursdatei lässt sich nicht lesen. Bitte Aufbau und Trennzeichen prüfen.",
  WAEHRUNG_NICHT_AENDERBAR: "Die lokale Währung lässt sich nicht mehr ändern, weil schon lokale Beträge erfasst sind.",
};
