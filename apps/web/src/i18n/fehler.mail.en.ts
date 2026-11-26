import type { mailFehlerDe } from "./fehler.mail";

/** Britisches Englisch, Fehlertexte zum Bereich „mail“ (siehe `fehler.mail.ts`). */
export const mailFehlerEn: typeof mailFehlerDe = {
  MAIL_NICHT_EINGERICHTET: "Outgoing mail is not set up.",
  MAIL_ADRESSE_UNGUELTIG: "The e-mail address is invalid.",
  MAIL_EMPFAENGER_UNGUELTIG: "The person does not belong to the company or has no e-mail address.",
  MAIL_AUFTRAG_NICHT_GEFUNDEN: "This mail job does not exist.",
  GEHEIMNIS_FEHLT: "The key for encrypting credentials is missing in this installation.",
  POSTFACH_ANBIETER_AUS: "This provider is not set up in this installation.",
  POSTFACH_NICHT_GEFUNDEN: "This connection does not exist.",
  POSTFACH_VERBINDUNG_FEHLGESCHLAGEN: "The connection to the mailbox failed. Please check the details.",
  POSTFACH_ZIEL_VERBOTEN: "This target is not allowed (local and private addresses are blocked).",
  POSTFACH_ZUSTAND_UNGUELTIG: "The process has expired or is invalid. Please start again.",
  KEINE_SYNC_AKTIVITAET: "This activity does not come from a mailbox or calendar connection.",
  FREMDE_SYNC_AKTIVITAET: "Only the person whose mailbox or calendar created the entry can remove it.",
  ANHANG_NICHT_UNTERSTUETZT: "Attachments cannot be loaded for this mail (only Microsoft 365 and Google, and the mail needs a deal or an organisation).",
  ANHANG_NICHT_GEFUNDEN: "This attachment no longer exists.",
  POSTFACH_ZUGANG_ABGELAUFEN: "Access has to be renewed first. Please try again in a minute.",
};
