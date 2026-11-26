import type { registerFehlerDe } from "./fehler.register";

/** Britisches Englisch, Fehlertexte zum Bereich „register“ (siehe `fehler.register.ts`). */
export const registerFehlerEn: typeof registerFehlerDe = {
  register_entry_missing: "There is no register entry for this organisation yet.",
  register_no_difference: "This field no longer differs from the register.",
  register_provider_missing: "No provider for register data is configured.",
  register_fetch_failed: "The request to the provider failed. Please try again later.",
  register_not_found: "The provider does not know this register entry.",
  register_reference_missing: "Court, register type and number are missing. Please record a register status first.",
  register_import_invalid: "The file contains errors, nothing was imported.",
  register_event_not_found: "The announcement does not exist.",
  register_event_done: "The announcement is already done.",
  register_notice_not_found: "The notice does not exist.",
};
