/** Fehlertexte der API zum Bereich „crm“ (Codes); eigenes Modul, damit sie ohne den ganzen Bereich geladen werden können (`fehlertexte`). */

export const crmFehlerDe = {
  ABFRAGE_UNGUELTIG: "Die Abfrage ist ungültig. Bitte Filter, Sortierung und Spalten prüfen.",
  FELDWERT_UNGUELTIG: "Mindestens ein Feldwert passt nicht zum Typ des Feldes. Bitte die Eingabe prüfen.",
  FELD_NICHT_GEFUNDEN: "Dieses Feld gibt es nicht.",
  FELDER_UNVERAENDERLICH: "Die Werte eines Vorgangs lassen sich nicht ändern. Ein Storno und ein neuer Vorgang tragen die richtigen Werte.",
  FELD_SCHLUESSEL_VORHANDEN: "Ein Feld mit diesem Namen gibt es schon (auch archivierte zählen).",
  FELD_TYP_FEST: "Der Typ dieses Feldes lässt sich nicht ändern. Neues Feld anlegen und das alte archivieren.",
  FELD_OPTION_IN_GEBRAUCH: "Eine entfernte Option wird noch von Datensätzen verwendet.",
  FELD_BERECHTIGUNG: "Eigene Felder legen globale Verwalter fest, Felder einer Liste auch deren Besitzerin oder Besitzer.",
  LISTE_NICHT_GEFUNDEN: "Diese Liste gibt es nicht (mehr).",
  LISTE_NAME_VORHANDEN: "Eine Liste mit diesem Namen gibt es schon.",
  LISTE_BERECHTIGUNG: "Eine Liste ändern nur ihre Besitzerin oder ihr Besitzer und globale Verwalter.",
  ANSICHT_NICHT_GEFUNDEN: "Diese Ansicht gibt es nicht.",
  ANSICHT_FREMD: "Geteilte Ansichten ändern nur ihre Besitzerin oder ihr Besitzer und globale Verwalter.",
  AUFGABE_NICHT_GEFUNDEN: "Diese Aufgabe gibt es nicht.",
  BESCHAEFTIGUNG_NICHT_GEFUNDEN: "Diese Verknüpfung zwischen Kontakt und Unternehmen gibt es nicht.",
  DATENSATZ_NICHT_GEFUNDEN: "Diesen Datensatz gibt es nicht oder er ist archiviert.",
  DATENSATZ_REFERENZIERT: "Das Unternehmen hat Beteiligungen, Deals oder Zugänge und lässt sich nicht archivieren.",
  MASSENAKTION_UNGUELTIG: "Diese Aktion ist hier nicht möglich.",
  CRM_IMPORT_UNGUELTIG: "Die Datei oder die Zuordnung der Spalten lässt sich nicht verarbeiten.",
};
