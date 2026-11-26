/** Fehlertexte der API zum Bereich „crm“ (Codes); eigenes Modul, damit sie ohne den ganzen Bereich geladen werden können (`fehlertexte`). */

export const crmFehlerDe = {
  query_invalid: "Die Abfrage ist ungültig. Bitte Filter, Sortierung und Spalten prüfen.",
  field_value_invalid: "Mindestens ein Feldwert passt nicht zum Typ des Feldes. Bitte die Eingabe prüfen.",
  field_not_found: "Dieses Feld gibt es nicht.",
  fields_immutable: "Die Werte eines Vorgangs lassen sich nicht ändern. Ein Storno und ein neuer Vorgang tragen die richtigen Werte.",
  field_key_exists: "Ein Feld mit diesem Namen gibt es schon (auch archivierte zählen).",
  field_type_fixed: "Der Typ dieses Feldes lässt sich nicht ändern. Neues Feld anlegen und das alte archivieren.",
  field_option_in_use: "Eine entfernte Option wird noch von Datensätzen verwendet.",
  field_permission: "Eigene Felder legen globale Verwalter fest, Felder einer Liste auch deren Besitzerin oder Besitzer.",
  list_not_found: "Diese Liste gibt es nicht (mehr).",
  list_name_exists: "Eine Liste mit diesem Namen gibt es schon.",
  list_permission: "Eine Liste ändern nur ihre Besitzerin oder ihr Besitzer und globale Verwalter.",
  view_not_found: "Diese Ansicht gibt es nicht.",
  view_foreign: "Geteilte Ansichten ändern nur ihre Besitzerin oder ihr Besitzer und globale Verwalter.",
  task_not_found: "Diese Aufgabe gibt es nicht.",
  employment_not_found: "Diese Verknüpfung zwischen Kontakt und Unternehmen gibt es nicht.",
  record_not_found: "Diesen Datensatz gibt es nicht oder er ist archiviert.",
  record_referenced: "Das Unternehmen hat Beteiligungen, Deals oder Zugänge und lässt sich nicht archivieren.",
  bulk_action_invalid: "Diese Aktion ist hier nicht möglich.",
  crm_import_invalid: "Die Datei oder die Zuordnung der Spalten lässt sich nicht verarbeiten.",
};
