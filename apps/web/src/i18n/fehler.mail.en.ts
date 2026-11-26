import type { mailFehlerDe } from "./fehler.mail";

/** Britisches Englisch, Fehlertexte zum Bereich „mail“ (siehe `fehler.mail.ts`). */
export const mailFehlerEn: typeof mailFehlerDe = {
  mail_not_configured: "Outgoing mail is not set up.",
  mail_address_invalid: "The e-mail address is invalid.",
  mail_recipient_invalid: "The person does not belong to the company or has no e-mail address.",
  mail_job_not_found: "This mail job does not exist.",
  secret_missing: "The key for encrypting credentials is missing in this installation.",
  mailbox_provider_disabled: "This provider is not set up in this installation.",
  mailbox_not_found: "This connection does not exist.",
  contact_ai_suggestion_not_found: "This suggestion no longer exists.",
  contact_ai_field_occupied: "The field already holds a value that did not come from a suggestion. It is never overwritten.",
  contact_ai_disabled: "Reading company websites is switched off for this installation.",
  contact_ai_website_missing: "The company has no public website that can be read.",
  contact_ai_website_failed: "The website could not be read.",
  contact_ai_provider_failed: "The AI provider could not be reached.",
  contact_suggestion_not_found: "This suggestion does not exist.",
  mailbox_connection_failed: "The connection to the mailbox failed. Please check the details.",
  mailbox_target_forbidden: "This target is not allowed (local and private addresses are blocked).",
  mailbox_state_invalid: "The process has expired or is invalid. Please start again.",
  not_synced_activity: "This activity does not come from a mailbox or calendar connection.",
  synced_activity_foreign: "Only the person whose mailbox or calendar created the entry can remove it.",
  attachment_not_supported: "Attachments cannot be loaded for this mail (only Microsoft 365 and Google, and the mail needs a deal or an organisation).",
  attachment_not_found: "This attachment no longer exists.",
  mailbox_access_expired: "Access has to be renewed first. Please try again in a minute.",
};
