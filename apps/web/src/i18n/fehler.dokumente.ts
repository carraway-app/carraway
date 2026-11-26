/** Fehlertexte der API zum Bereich „dokumente“ (Codes); eigenes Modul, damit sie ohne den ganzen Bereich geladen werden können (`fehlertexte`). */

export const dokumenteFehlerDe = {
  DOKUMENT_NICHT_GEFUNDEN: "Das Dokument wurde nicht gefunden.",
  DOKUMENTTYP_UNZULAESSIG: "Dieser Dateityp ist nicht erlaubt. Erlaubt sind PDF, PNG, JPEG, Word (.docx) und Excel (.xlsx).",
  DOKUMENT_UNSICHER: "Die Datei wird nicht angenommen: Sie ist beschädigt, ungewöhnlich stark gepackt oder enthält Makros.",
  PDF_VERSCHLUESSELT: "Verschlüsselte oder passwortgeschützte PDF-Dateien werden nicht angenommen. Bitte ohne Passwort speichern und erneut hochladen.",
  TEXTERKENNUNG_AUS: "Die Texterkennung ist in dieser Installation nicht eingeschaltet.",
  TEXTERKENNUNG_NICHT_MOEGLICH: "Für dieses Dokument ist keine Texterkennung nötig oder möglich.",
  DOKUMENT_ZU_GROSS: "Das Dokument ist zu groß (höchstens 25 MB).",
  DOKUMENT_VORHANDEN: "Dieses Dokument gibt es schon.",
  DOKUMENT_NICHT_AKTIV: "Das Dokument ist nicht mehr aktuell (ersetzt oder gelöscht).",
  DOKUMENT_ENDGUELTIG_GELOESCHT: "Die Datei wurde nach Ablauf der Aufbewahrungsfrist endgültig gelöscht.",
  ZIEL_NICHT_GEFUNDEN: "Das Ziel der Verknüpfung gibt es nicht.",
  DOKUMENT_LETZTE_VERKNUEPFUNG: "Die letzte Verknüpfung lässt sich nicht entfernen. Löschen Sie das Dokument stattdessen.",
  KI_AUS: "Die KI-Auslesung ist für diese Installation ausgeschaltet.",
  AUSLESUNG_NICHT_GEFUNDEN: "Die Auslesung wurde nicht gefunden.",
  AUSLESUNG_STATUS_UNGUELTIG: "Die Auslesung hat dafür nicht den richtigen Stand.",
  AUSLESUNG_KEIN_TEXT: "Das Dokument hat keinen auslesbaren Text.",
  AUSLESUNG_VERTRAULICH: "Das Dokument ist vertraulich und geht nur mit ausdrücklicher Freigabe an die KI.",
  AUSLESUNG_ZIEL_FEHLT: "Für die Daten fehlt das Ziel (Beteiligung oder Unternehmen).",
  AUSLESUNG_ART_PASST_NICHT: "Die Art der Bestätigung passt nicht zur Auslesung.",
  ZIEL_NICHT_AM_DOKUMENT: "Die Daten dürfen nur an ein Ziel, das mit dem Dokument verknüpft ist (oder an das Unternehmen davon).",
};
