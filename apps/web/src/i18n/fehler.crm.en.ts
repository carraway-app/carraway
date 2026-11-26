import type { crmFehlerDe } from "./fehler.crm";

/** Britisches Englisch, Fehlertexte zum Bereich „crm“ (siehe `fehler.crm.ts`). */
export const crmFehlerEn: typeof crmFehlerDe = {
  query_invalid: "The query is invalid. Please check the filter, sort order and columns.",
  field_value_invalid: "At least one field value does not fit the type of the field. Please check the input.",
  field_not_found: "This field does not exist.",
  fields_immutable: "The values of a transaction cannot be changed. A reversal and a new transaction carry the right values.",
  field_key_exists: "A field with this name already exists (archived ones count too).",
  field_type_fixed: "The type of this field cannot be changed. Create a new field and archive the old one.",
  field_option_in_use: "A removed option is still used by records.",
  field_permission: "Custom fields are defined by global administrators; fields of a list also by its owner.",
  list_not_found: "This list does not exist (any more).",
  list_name_exists: "A list with this name already exists.",
  list_permission: "Only the owner of a list and global administrators can change it.",
  view_not_found: "This view does not exist.",
  view_foreign: "Only the owner of a shared view and global administrators can change it.",
  task_not_found: "This task does not exist.",
  employment_not_found: "This link between contact and company does not exist.",
  record_not_found: "This record does not exist or is archived.",
  record_referenced: "The company has holdings, deals or access and cannot be archived.",
  bulk_action_invalid: "This action is not possible here.",
  crm_import_invalid: "The file or the column mapping cannot be processed.",
};
