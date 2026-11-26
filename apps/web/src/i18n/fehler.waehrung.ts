/** Fehlertexte der API zum Bereich „Währung“ (Codes); eigenes Modul, damit sie ohne den ganzen Bereich geladen werden können (`fehlertexte`). */

export const waehrungFehlerDe = {
  rate_missing: "Für die Umrechnung liegt zum Stichtag kein ausreichend aktueller Wechselkurs vor. Bitte den Kurs erfassen oder importieren; es wird kein Kurs geschätzt.",
  currency_same: "Diese Beteiligung hat keine abweichende lokale Währung. Lokale Beträge sind nur bei einer anderen lokalen Währung zulässig.",
  rate_exists: "Für diesen Tag und dieses Währungspaar gibt es schon einen Kurs. Eine Änderung ist eine Korrektur mit Grund.",
  rate_not_found: "Dieser Wechselkurs existiert nicht oder gehört zu einem anderen Tag oder Währungspaar.",
  rate_file_invalid: "Die Kursdatei lässt sich nicht lesen. Bitte Aufbau und Trennzeichen prüfen.",
  currency_not_changeable: "Die lokale Währung lässt sich nicht mehr ändern, weil schon lokale Beträge erfasst sind.",
};
