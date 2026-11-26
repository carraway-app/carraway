/** Fehlertexte der API zum Bereich „mail“ (Codes); eigenes Modul, damit sie ohne den ganzen Bereich geladen werden können (`fehlertexte`). */

export const mailFehlerDe = {
  MAIL_NICHT_EINGERICHTET: "Der Mailversand ist nicht eingerichtet.",
  MAIL_ADRESSE_UNGUELTIG: "Die Mailadresse ist ungültig.",
  MAIL_EMPFAENGER_UNGUELTIG: "Die Person gehört nicht zum Unternehmen oder hat keine Mailadresse.",
  MAIL_AUFTRAG_NICHT_GEFUNDEN: "Diesen Mailauftrag gibt es nicht.",
  GEHEIMNIS_FEHLT: "Der Schlüssel zum Verschlüsseln von Zugangsdaten fehlt in dieser Installation.",
  POSTFACH_ANBIETER_AUS: "Dieser Anbieter ist in dieser Installation nicht eingerichtet.",
  POSTFACH_NICHT_GEFUNDEN: "Diese Verbindung gibt es nicht.",
  POSTFACH_VERBINDUNG_FEHLGESCHLAGEN: "Die Verbindung zum Postfach ist fehlgeschlagen. Bitte Angaben prüfen.",
  POSTFACH_ZIEL_VERBOTEN: "Dieses Ziel ist nicht erlaubt (lokale und private Adressen sind gesperrt).",
  POSTFACH_ZUSTAND_UNGUELTIG: "Der Vorgang ist abgelaufen oder ungültig. Bitte noch einmal starten.",
  KEINE_SYNC_AKTIVITAET: "Diese Aktivität stammt nicht aus einer Postfach- oder Kalenderanbindung.",
  FREMDE_SYNC_AKTIVITAET: "Nur die Person, deren Postfach oder Kalender den Eintrag angelegt hat, kann ihn entfernen.",
  ANHANG_NICHT_UNTERSTUETZT: "Für diese Mail lassen sich Anhänge nicht laden (nur Microsoft 365 und Google, und die Mail braucht einen Deal oder eine Organisation).",
  ANHANG_NICHT_GEFUNDEN: "Diesen Anhang gibt es nicht mehr.",
  POSTFACH_ZUGANG_ABGELAUFEN: "Der Zugriff muss erst erneuert werden. Bitte in einer Minute noch einmal versuchen.",
} as Record<string, string>;
