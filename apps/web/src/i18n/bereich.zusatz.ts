/** Texte des Bereichs „zusatz“ (Abschnitt: zusatzfelder): eigene Felder an Fonds, Runde, Instrument, Beteiligung und Vorgang; kommt mit den Seiten, die ihn brauchen (`bereiche.ts`). */

export const zusatzBereichDe = {
  zusatzfelder: {
    titel: "Eigene Felder",
    tab: "Felder",
    beschreibung: "Eigene Felder halten fest, was die Standardfelder nicht abbilden. Globale Verwalter legen sie an; jeder Wert wird gegen den Typ des Feldes geprüft und mit Vorher und Nachher protokolliert.",
    leer: "Für dieses Objekt sind noch keine eigenen Felder angelegt.",
    leerVerwalter: "Für dieses Objekt sind noch keine eigenen Felder angelegt. Mit „Felder verwalten“ lässt sich das erste anlegen.",
    verwalten: "Felder verwalten",
    laedt: "Eigene Felder werden geladen",
    stand: "Die Ansicht zeigt einen früheren Wissensstand. Werte lassen sich nur im aktuellen Stand ändern.",
    bearbeiten: (name: string) => `Wert bearbeiten: ${name}`,
    leeren: (name: string) => `Wert entfernen: ${name}`,
    archiviert: "archiviert",
    vorgangHinweis: "Die Werte eines Vorgangs gelten ab dem Anlegen. Ein Storno übernimmt sie; zum Ändern den Vorgang stornieren und neu buchen.",
    formular: "Eigene Felder",
    formularHinweis: "Die Werte lassen sich nach dem Buchen nicht mehr ändern.",
    feldKnopf: "Felder",
    feldKnopfFuer: (name: string) => `Eigene Felder anzeigen: ${name}`,
    felderVon: (name: string) => `Eigene Felder: ${name}`,
    unterTabs: { beteiligung: "Beteiligung", instrument: "Instrument" },
    objekte: { fonds: "Fonds", runde: "Finanzierungsrunde", instrument: "Instrument", beteiligung: "Beteiligung", vorgang: "Vorgang" } as Record<string, string>,
    spalteFelder: "Felder",
    vorgangFelderZeile: (datum: string, art: string) => `Eigene Felder: ${art} vom ${datum}`,
  },
};
