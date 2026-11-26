import type { dokumenteFehlerDe } from "./fehler.dokumente";

/** Britisches Englisch, Fehlertexte zum Bereich „dokumente“ (siehe `fehler.dokumente.ts`). */
export const dokumenteFehlerEn: Record<keyof typeof dokumenteFehlerDe, string> = {
  DOKUMENT_NICHT_GEFUNDEN: "The document was not found.",
  DOKUMENTTYP_UNZULAESSIG: "This file type is not allowed. Allowed are PDF, PNG, JPEG, Word (.docx) and Excel (.xlsx).",
  DOKUMENT_UNSICHER: "The file is not accepted: it is damaged, unusually heavily compressed or contains macros.",
  PDF_VERSCHLUESSELT: "Encrypted or password-protected PDF files are not accepted. Please save without a password and upload again.",
  TEXTERKENNUNG_AUS: "Text recognition is not switched on in this installation.",
  TEXTERKENNUNG_NICHT_MOEGLICH: "This document needs no text recognition, or it cannot be done.",
  DOKUMENT_ZU_GROSS: "The document is too large (25 MB at most).",
  DOKUMENT_VORHANDEN: "This document already exists.",
  DOKUMENT_NICHT_AKTIV: "The document is no longer current (replaced or deleted).",
  DOKUMENT_ENDGUELTIG_GELOESCHT: "The file was permanently deleted after the retention period ended.",
  ZIEL_NICHT_GEFUNDEN: "The target of the link does not exist.",
  DOKUMENT_LETZTE_VERKNUEPFUNG: "The last link cannot be removed. Delete the document instead.",
  KI_AUS: "AI extraction is switched off for this installation.",
  AUSLESUNG_NICHT_GEFUNDEN: "The extraction was not found.",
  AUSLESUNG_STATUS_UNGUELTIG: "The extraction is not in the right state for this.",
  AUSLESUNG_KEIN_TEXT: "The document has no readable text.",
  AUSLESUNG_VERTRAULICH: "The document is confidential and only goes to the AI with explicit approval.",
  AUSLESUNG_ZIEL_FEHLT: "The data has no target (holding or company).",
  AUSLESUNG_ART_PASST_NICHT: "The type of confirmation does not match the extraction.",
  ZIEL_NICHT_AM_DOKUMENT: "The data may only go to a target linked to the document (or to the company of one).",
};
