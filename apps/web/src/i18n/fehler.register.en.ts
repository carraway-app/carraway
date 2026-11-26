import type { registerFehlerDe } from "./fehler.register";

/** Britisches Englisch, Fehlertexte zum Bereich „register“ (siehe `fehler.register.ts`). */
export const registerFehlerEn: typeof registerFehlerDe = {
  REGISTER_EINTRAG_FEHLT: "There is no register entry for this organisation yet.",
  REGISTER_KEIN_UNTERSCHIED: "This field no longer differs from the register.",
  REGISTER_ANBIETER_FEHLT: "No provider for register data is configured.",
  REGISTER_ABRUF_FEHLGESCHLAGEN: "The request to the provider failed. Please try again later.",
  REGISTER_NICHT_GEFUNDEN: "The provider does not know this register entry.",
  REGISTER_REFERENZ_FEHLT: "Court, register type and number are missing. Please record a register status first.",
  REGISTER_IMPORT_UNGUELTIG: "The file contains errors, nothing was imported.",
  REGISTER_EREIGNIS_NICHT_GEFUNDEN: "The announcement does not exist.",
  REGISTER_EREIGNIS_ERLEDIGT: "The announcement is already done.",
  REGISTER_MELDUNG_NICHT_GEFUNDEN: "The notice does not exist.",
};
