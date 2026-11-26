/** Texte des Abschnitts „Förderung und Buchhaltung“ an der Beteiligung (Zusammenführung der Etappen 14 und 15): alle Schlüssel an einer Stelle. */

export const schluesselDe = {
  titel: "Förderung und Buchhaltung",
  einleitung:
    "Diese Schlüssel gelten für Belege, den Buchungsexport und die Förder- und Meldeberichte. Es gilt immer der heutige Stand; ein Meldelauf hält die verwendeten Werte fest.",
  felder: {
    foerderprogramm: "Förderprogramm",
    projektnummer: "Projektnummer",
    vertragsnummer: "Vertragsnummer",
    partnernummer: "Partnernummer",
    buchungskreis: "Buchungskreis",
    sitzland: "Sitzland des Unternehmens (ISO-Code, z. B. DE)",
    region: "Region des Unternehmens",
  },
  stammdaten: {
    titel: "Stammdaten des Unternehmens (nur Ansicht)",
    land: "Sitzland",
    region: "Region",
    keine: "nicht erfasst",
    beiOrganisation: "Sitzland und Region bei der Organisation ändern",
  },
  keinProgramm: "Kein Förderprogramm",
  sitzlandHilfe: "Zwei Großbuchstaben nach ISO 3166-1. Gilt für das Unternehmen in allen Fonds.",
  programmeHinweis: "Neue Förderprogramme legen globale Verwalter in der Verwaltung an.",
  speichern: "Schlüssel speichern",
  gespeichert: "Die Schlüssel sind gespeichert.",
  geaendertVon: (wann: string) => `Zuletzt geändert am ${wann}`,
  lesen: "Sie haben nur Leserechte; die Schlüssel lassen sich nicht ändern.",
  laedt: "Schlüssel werden geladen",
};
