/**
 * Eingebaute Texte der Komponenten (Beschriftungen für Screenreader, Standardtexte).
 * Deutsch ist die Quelle und der Standard, Englisch ist britisches Englisch.
 * Daten (Namen, Eingaben) werden nie übersetzt.
 */
export type Sprache = "de" | "en";

export interface UiTexte {
  herkunftAnzeigen: (titel: string) => string;
  herkunftStichtag: string;
  herkunftQuellen: string;
  hauptnavigation: string;
  sortierenNach: (spalte: string) => string;
  anstieg: string;
  rueckgang: string;
  unveraendert: string;
  statusEntwurf: string;
  statusPruefung: string;
  statusFreigegeben: string;
  statusFehlt: string;
  statusBeispiel: string;
  leerTitel: string;
  leerBeschreibung: string;
  hinweisInfo: string;
  hinweisFehler: string;
  schrittErledigt: string;
  schrittAktuell: string;
  schrittOffen: string;
  schliessen: string;
  laedt: string;
  weitereAktionen: string;
  /** Auslöser für Reiter, die nicht mehr in die Leiste passen. */
  mehrReiter: string;
  erklaerung: string;
  markdownVorschau: string;
  markdownBearbeiten: string;
  markdownHilfe: string;
  markdownVorschauLeer: string;
}

export const texte: Record<Sprache, UiTexte> = {
  de: {
    herkunftAnzeigen: (titel) => `Herkunft von ${titel} anzeigen`,
    herkunftStichtag: "Stichtag",
    herkunftQuellen: "Quellen",
    hauptnavigation: "Hauptnavigation",
    sortierenNach: (spalte) => `Nach ${spalte} sortieren`,
    anstieg: "Anstieg",
    rueckgang: "Rückgang",
    unveraendert: "Unverändert",
    statusEntwurf: "Entwurf",
    statusPruefung: "In Prüfung",
    statusFreigegeben: "Freigegeben",
    statusFehlt: "Bewertung fehlt",
    statusBeispiel: "Beispieldaten",
    leerTitel: "Noch keine Einträge",
    leerBeschreibung: "Sobald Daten vorliegen, erscheinen sie hier.",
    hinweisInfo: "Hinweis",
    hinweisFehler: "Fehler",
    schrittErledigt: "erledigt",
    schrittAktuell: "aktueller Schritt",
    schrittOffen: "offen",
    schliessen: "Schließen",
    laedt: "Wird geladen",
    weitereAktionen: "Weitere Aktionen",
    mehrReiter: "Mehr",
    erklaerung: "Erklärung",
    markdownVorschau: "Vorschau",
    markdownBearbeiten: "Bearbeiten",
    markdownHilfe: "Markdown möglich: **fett**, *kursiv*, - Liste, [Text](https://…)",
    markdownVorschauLeer: "Nichts zur Vorschau",
  },
  en: {
    herkunftAnzeigen: (titel) => `Show origin of ${titel}`,
    herkunftStichtag: "As at",
    herkunftQuellen: "Sources",
    hauptnavigation: "Main navigation",
    sortierenNach: (spalte) => `Sort by ${spalte}`,
    anstieg: "Increase",
    rueckgang: "Decrease",
    unveraendert: "Unchanged",
    statusEntwurf: "Draft",
    statusPruefung: "In review",
    statusFreigegeben: "Approved",
    statusFehlt: "Valuation missing",
    statusBeispiel: "Sample data",
    leerTitel: "No entries yet",
    leerBeschreibung: "Once data is available, it will appear here.",
    hinweisInfo: "Note",
    hinweisFehler: "Error",
    schrittErledigt: "done",
    schrittAktuell: "current step",
    schrittOffen: "pending",
    schliessen: "Close",
    laedt: "Loading",
    weitereAktionen: "More actions",
    mehrReiter: "More",
    erklaerung: "Explanation",
    markdownVorschau: "Preview",
    markdownBearbeiten: "Edit",
    markdownHilfe: "Markdown supported: **bold**, *italic*, - list, [text](https://…)",
    markdownVorschauLeer: "Nothing to preview",
  },
};
