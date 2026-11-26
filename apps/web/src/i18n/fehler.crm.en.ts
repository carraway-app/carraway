import type { crmFehlerDe } from "./fehler.crm";

/** Britisches Englisch, Fehlertexte zum Bereich „crm“ (siehe `fehler.crm.ts`). */
export const crmFehlerEn: typeof crmFehlerDe = {
  ABFRAGE_UNGUELTIG: "The query is invalid. Please check the filter, sort order and columns.",
  FELDWERT_UNGUELTIG: "At least one field value does not fit the type of the field. Please check the input.",
  FELD_NICHT_GEFUNDEN: "This field does not exist.",
  FELDER_UNVERAENDERLICH: "The values of a transaction cannot be changed. A reversal and a new transaction carry the right values.",
  FELD_SCHLUESSEL_VORHANDEN: "A field with this name already exists (archived ones count too).",
  FELD_TYP_FEST: "The type of this field cannot be changed. Create a new field and archive the old one.",
  FELD_OPTION_IN_GEBRAUCH: "A removed option is still used by records.",
  FELD_BERECHTIGUNG: "Custom fields are defined by global administrators; fields of a list also by its owner.",
  LISTE_NICHT_GEFUNDEN: "This list does not exist (any more).",
  LISTE_NAME_VORHANDEN: "A list with this name already exists.",
  LISTE_BERECHTIGUNG: "Only the owner of a list and global administrators can change it.",
  ANSICHT_NICHT_GEFUNDEN: "This view does not exist.",
  ANSICHT_FREMD: "Only the owner of a shared view and global administrators can change it.",
  AUFGABE_NICHT_GEFUNDEN: "This task does not exist.",
  BESCHAEFTIGUNG_NICHT_GEFUNDEN: "This link between contact and company does not exist.",
  DATENSATZ_NICHT_GEFUNDEN: "This record does not exist or is archived.",
  DATENSATZ_REFERENZIERT: "The company has holdings, deals or access and cannot be archived.",
  MASSENAKTION_UNGUELTIG: "This action is not possible here.",
  CRM_IMPORT_UNGUELTIG: "The file or the column mapping cannot be processed.",
};
