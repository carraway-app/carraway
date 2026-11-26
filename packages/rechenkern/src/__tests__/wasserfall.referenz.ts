// Erzeugt aus referenz/referenz_wasserfall.py (python3 -I referenz/referenz_wasserfall.py --json). Nicht von Hand ändern;
// die Werte stammen aus der unabhängigen Bruchrechnung, nicht aus dem TypeScript-Code. Alle Daten sind erfunden.

export interface ReferenzFall {
  name: string;
  eingabe: { exitwert: string; exitdatum: string; treuhandAnteil?: string; klassen: { id: string; name: string; rang: number; praeferenzFaktor: string; partizipierend: boolean; capFaktor: string | null; verzinsung: string | null; umwandelbar: boolean }[]; inhaber: { id: string; name: string; klasseId: string | null; anteile: string; investiert: string; datum: string | null; mitarbeiter?: { basispreis: string; regel: "wie_anteile" | "anteilig" } }[] };
  gewandelt: string[];
  zeilen: { id: string; praeferenz: string; beteiligung: string; gesamt: string; treuhand: string; sofort: string; multiple: string | null; gedeckelt: boolean }[];
  nichtVerteilt: string;
}

export const REFERENZ_FAELLE: ReferenzFall[] = [
  {
    name: "A1 Seriell A 1x nicht partizipierend, Exit 20 Mio (wandelt)",
    eingabe: {"exitwert": "20000000", "exitdatum": "2026-06-30", "klassen": [{"id": "SerieA", "name": "SerieA", "rang": 1, "praeferenzFaktor": "1", "partizipierend": false, "capFaktor": null, "verzinsung": null, "umwandelbar": true}], "inhaber": [{"id": "Gruender", "name": "Gruender", "klasseId": null, "anteile": "7000000", "investiert": "0", "datum": null}, {"id": "FondsA", "name": "FondsA", "klasseId": "SerieA", "anteile": "3000000", "investiert": "3000000", "datum": "2024-03-01"}]},
    gewandelt: ["SerieA"],
    zeilen: [
      {"id": "Gruender", "praeferenz": "0.00", "beteiligung": "14000000.00", "gesamt": "14000000.00", "treuhand": "0.00", "sofort": "14000000.00", "multiple": null, "gedeckelt": false},
      {"id": "FondsA", "praeferenz": "0.00", "beteiligung": "6000000.00", "gesamt": "6000000.00", "treuhand": "0.00", "sofort": "6000000.00", "multiple": "2.0000", "gedeckelt": false},
    ],
    nichtVerteilt: "0.00",
  },
  {
    name: "A2 dieselbe Struktur, Exit 8 Mio (Präferenz)",
    eingabe: {"exitwert": "8000000", "exitdatum": "2026-06-30", "klassen": [{"id": "SerieA", "name": "SerieA", "rang": 1, "praeferenzFaktor": "1", "partizipierend": false, "capFaktor": null, "verzinsung": null, "umwandelbar": true}], "inhaber": [{"id": "Gruender", "name": "Gruender", "klasseId": null, "anteile": "7000000", "investiert": "0", "datum": null}, {"id": "FondsA", "name": "FondsA", "klasseId": "SerieA", "anteile": "3000000", "investiert": "3000000", "datum": "2024-03-01"}]},
    gewandelt: [],
    zeilen: [
      {"id": "Gruender", "praeferenz": "0.00", "beteiligung": "5000000.00", "gesamt": "5000000.00", "treuhand": "0.00", "sofort": "5000000.00", "multiple": null, "gedeckelt": false},
      {"id": "FondsA", "praeferenz": "3000000.00", "beteiligung": "0.00", "gesamt": "3000000.00", "treuhand": "0.00", "sofort": "3000000.00", "multiple": "1.0000", "gedeckelt": false},
    ],
    nichtVerteilt: "0.00",
  },
  {
    name: "A3 Gleichstand bei 10 Mio: keine Umwandlung",
    eingabe: {"exitwert": "10000000", "exitdatum": "2026-06-30", "klassen": [{"id": "SerieA", "name": "SerieA", "rang": 1, "praeferenzFaktor": "1", "partizipierend": false, "capFaktor": null, "verzinsung": null, "umwandelbar": true}], "inhaber": [{"id": "Gruender", "name": "Gruender", "klasseId": null, "anteile": "7000000", "investiert": "0", "datum": null}, {"id": "FondsA", "name": "FondsA", "klasseId": "SerieA", "anteile": "3000000", "investiert": "3000000", "datum": "2024-03-01"}]},
    gewandelt: [],
    zeilen: [
      {"id": "Gruender", "praeferenz": "0.00", "beteiligung": "7000000.00", "gesamt": "7000000.00", "treuhand": "0.00", "sofort": "7000000.00", "multiple": null, "gedeckelt": false},
      {"id": "FondsA", "praeferenz": "3000000.00", "beteiligung": "0.00", "gesamt": "3000000.00", "treuhand": "0.00", "sofort": "3000000.00", "multiple": "1.0000", "gedeckelt": false},
    ],
    nichtVerteilt: "0.00",
  },
  {
    name: "B1 Exit unter den Präferenzen: Rang 1 voll, Rang 2 Rest",
    eingabe: {"exitwert": "10000000", "exitdatum": "2026-06-30", "klassen": [{"id": "SerieB", "name": "SerieB", "rang": 1, "praeferenzFaktor": "1.5", "partizipierend": false, "capFaktor": null, "verzinsung": null, "umwandelbar": true}, {"id": "SerieA", "name": "SerieA", "rang": 2, "praeferenzFaktor": "1", "partizipierend": false, "capFaktor": null, "verzinsung": null, "umwandelbar": true}], "inhaber": [{"id": "Gruender", "name": "Gruender", "klasseId": null, "anteile": "5000000", "investiert": "0", "datum": null}, {"id": "FondsB", "name": "FondsB", "klasseId": "SerieB", "anteile": "2500000", "investiert": "6000000", "datum": "2026-01-15"}, {"id": "FondsA", "name": "FondsA", "klasseId": "SerieA", "anteile": "2500000", "investiert": "4000000", "datum": "2024-03-01"}]},
    gewandelt: [],
    zeilen: [
      {"id": "Gruender", "praeferenz": "0.00", "beteiligung": "0.00", "gesamt": "0.00", "treuhand": "0.00", "sofort": "0.00", "multiple": null, "gedeckelt": false},
      {"id": "FondsB", "praeferenz": "9000000.00", "beteiligung": "0.00", "gesamt": "9000000.00", "treuhand": "0.00", "sofort": "9000000.00", "multiple": "1.5000", "gedeckelt": false},
      {"id": "FondsA", "praeferenz": "1000000.00", "beteiligung": "0.00", "gesamt": "1000000.00", "treuhand": "0.00", "sofort": "1000000.00", "multiple": "0.2500", "gedeckelt": false},
    ],
    nichtVerteilt: "0.00",
  },
  {
    name: "B2 Null-Exit",
    eingabe: {"exitwert": "0", "exitdatum": "2026-06-30", "klassen": [{"id": "SerieA", "name": "SerieA", "rang": 1, "praeferenzFaktor": "1", "partizipierend": false, "capFaktor": null, "verzinsung": null, "umwandelbar": true}], "inhaber": [{"id": "Gruender", "name": "Gruender", "klasseId": null, "anteile": "7000000", "investiert": "0", "datum": null}, {"id": "FondsA", "name": "FondsA", "klasseId": "SerieA", "anteile": "3000000", "investiert": "3000000", "datum": "2024-03-01"}]},
    gewandelt: [],
    zeilen: [
      {"id": "Gruender", "praeferenz": "0.00", "beteiligung": "0.00", "gesamt": "0.00", "treuhand": "0.00", "sofort": "0.00", "multiple": null, "gedeckelt": false},
      {"id": "FondsA", "praeferenz": "0.00", "beteiligung": "0.00", "gesamt": "0.00", "treuhand": "0.00", "sofort": "0.00", "multiple": "0.0000", "gedeckelt": false},
    ],
    nichtVerteilt: "0.00",
  },
  {
    name: "B3 Pari passu: gleicher Rang, Exit unter den Ansprüchen",
    eingabe: {"exitwert": "5000000", "exitdatum": "2026-06-30", "klassen": [{"id": "SerieA", "name": "SerieA", "rang": 1, "praeferenzFaktor": "1", "partizipierend": false, "capFaktor": null, "verzinsung": null, "umwandelbar": true}, {"id": "SerieB", "name": "SerieB", "rang": 1, "praeferenzFaktor": "1", "partizipierend": false, "capFaktor": null, "verzinsung": null, "umwandelbar": true}], "inhaber": [{"id": "Gruender", "name": "Gruender", "klasseId": null, "anteile": "5000000", "investiert": "0", "datum": null}, {"id": "FondsA", "name": "FondsA", "klasseId": "SerieA", "anteile": "2000000", "investiert": "4000000", "datum": "2024-03-01"}, {"id": "FondsB", "name": "FondsB", "klasseId": "SerieB", "anteile": "3000000", "investiert": "6000000", "datum": "2025-03-01"}]},
    gewandelt: [],
    zeilen: [
      {"id": "Gruender", "praeferenz": "0.00", "beteiligung": "0.00", "gesamt": "0.00", "treuhand": "0.00", "sofort": "0.00", "multiple": null, "gedeckelt": false},
      {"id": "FondsA", "praeferenz": "2000000.00", "beteiligung": "0.00", "gesamt": "2000000.00", "treuhand": "0.00", "sofort": "2000000.00", "multiple": "0.5000", "gedeckelt": false},
      {"id": "FondsB", "praeferenz": "3000000.00", "beteiligung": "0.00", "gesamt": "3000000.00", "treuhand": "0.00", "sofort": "3000000.00", "multiple": "0.5000", "gedeckelt": false},
    ],
    nichtVerteilt: "0.00",
  },
  {
    name: "C1 partizipierend ohne Cap, Exit 12 Mio",
    eingabe: {"exitwert": "12000000", "exitdatum": "2026-06-30", "klassen": [{"id": "SerieA", "name": "SerieA", "rang": 1, "praeferenzFaktor": "1", "partizipierend": true, "capFaktor": null, "verzinsung": null, "umwandelbar": true}], "inhaber": [{"id": "Gruender", "name": "Gruender", "klasseId": null, "anteile": "8000000", "investiert": "0", "datum": null}, {"id": "FondsA", "name": "FondsA", "klasseId": "SerieA", "anteile": "2000000", "investiert": "2000000", "datum": "2024-03-01"}]},
    gewandelt: [],
    zeilen: [
      {"id": "Gruender", "praeferenz": "0.00", "beteiligung": "8000000.00", "gesamt": "8000000.00", "treuhand": "0.00", "sofort": "8000000.00", "multiple": null, "gedeckelt": false},
      {"id": "FondsA", "praeferenz": "2000000.00", "beteiligung": "2000000.00", "gesamt": "4000000.00", "treuhand": "0.00", "sofort": "4000000.00", "multiple": "2.0000", "gedeckelt": false},
    ],
    nichtVerteilt: "0.00",
  },
  {
    name: "C2 partizipierend mit Cap 3x, Cap bindet (Exit 25 Mio)",
    eingabe: {"exitwert": "25000000", "exitdatum": "2026-06-30", "klassen": [{"id": "SerieA", "name": "SerieA", "rang": 1, "praeferenzFaktor": "1", "partizipierend": true, "capFaktor": "3", "verzinsung": null, "umwandelbar": true}], "inhaber": [{"id": "Gruender", "name": "Gruender", "klasseId": null, "anteile": "8000000", "investiert": "0", "datum": null}, {"id": "FondsA", "name": "FondsA", "klasseId": "SerieA", "anteile": "2000000", "investiert": "2000000", "datum": "2024-03-01"}]},
    gewandelt: [],
    zeilen: [
      {"id": "Gruender", "praeferenz": "0.00", "beteiligung": "19000000.00", "gesamt": "19000000.00", "treuhand": "0.00", "sofort": "19000000.00", "multiple": null, "gedeckelt": false},
      {"id": "FondsA", "praeferenz": "2000000.00", "beteiligung": "4000000.00", "gesamt": "6000000.00", "treuhand": "0.00", "sofort": "6000000.00", "multiple": "3.0000", "gedeckelt": true},
    ],
    nichtVerteilt: "0.00",
  },
  {
    name: "C3 partizipierend mit Cap 3x wandelt (Exit 40 Mio)",
    eingabe: {"exitwert": "40000000", "exitdatum": "2026-06-30", "klassen": [{"id": "SerieA", "name": "SerieA", "rang": 1, "praeferenzFaktor": "1", "partizipierend": true, "capFaktor": "3", "verzinsung": null, "umwandelbar": true}], "inhaber": [{"id": "Gruender", "name": "Gruender", "klasseId": null, "anteile": "8000000", "investiert": "0", "datum": null}, {"id": "FondsA", "name": "FondsA", "klasseId": "SerieA", "anteile": "2000000", "investiert": "2000000", "datum": "2024-03-01"}]},
    gewandelt: ["SerieA"],
    zeilen: [
      {"id": "Gruender", "praeferenz": "0.00", "beteiligung": "32000000.00", "gesamt": "32000000.00", "treuhand": "0.00", "sofort": "32000000.00", "multiple": null, "gedeckelt": false},
      {"id": "FondsA", "praeferenz": "0.00", "beteiligung": "8000000.00", "gesamt": "8000000.00", "treuhand": "0.00", "sofort": "8000000.00", "multiple": "4.0000", "gedeckelt": false},
    ],
    nichtVerteilt: "0.00",
  },
  {
    name: "D1 Verzinsung 8 % einfach, 912 Tage, Exit unter Anspruch",
    eingabe: {"exitwert": "3900000", "exitdatum": "2026-07-15", "klassen": [{"id": "SerieA", "name": "SerieA", "rang": 1, "praeferenzFaktor": "1", "partizipierend": false, "capFaktor": null, "verzinsung": "0.08", "umwandelbar": true}], "inhaber": [{"id": "Gruender", "name": "Gruender", "klasseId": null, "anteile": "7000000", "investiert": "0", "datum": null}, {"id": "FondsA", "name": "FondsA", "klasseId": "SerieA", "anteile": "3000000", "investiert": "3000000", "datum": "2024-01-15"}]},
    gewandelt: [],
    zeilen: [
      {"id": "Gruender", "praeferenz": "0.00", "beteiligung": "300328.77", "gesamt": "300328.77", "treuhand": "0.00", "sofort": "300328.77", "multiple": null, "gedeckelt": false},
      {"id": "FondsA", "praeferenz": "3599671.23", "beteiligung": "0.00", "gesamt": "3599671.23", "treuhand": "0.00", "sofort": "3599671.23", "multiple": "1.1999", "gedeckelt": false},
    ],
    nichtVerteilt: "0.00",
  },
  {
    name: "D2 Exitdatum vor Rundendatum: keine negativen Zinsen",
    eingabe: {"exitwert": "2000000", "exitdatum": "2024-01-01", "klassen": [{"id": "SerieA", "name": "SerieA", "rang": 1, "praeferenzFaktor": "1", "partizipierend": false, "capFaktor": null, "verzinsung": "0.08", "umwandelbar": true}], "inhaber": [{"id": "Gruender", "name": "Gruender", "klasseId": null, "anteile": "7000000", "investiert": "0", "datum": null}, {"id": "FondsA", "name": "FondsA", "klasseId": "SerieA", "anteile": "3000000", "investiert": "3000000", "datum": "2024-01-15"}]},
    gewandelt: [],
    zeilen: [
      {"id": "Gruender", "praeferenz": "0.00", "beteiligung": "0.00", "gesamt": "0.00", "treuhand": "0.00", "sofort": "0.00", "multiple": null, "gedeckelt": false},
      {"id": "FondsA", "praeferenz": "2000000.00", "beteiligung": "0.00", "gesamt": "2000000.00", "treuhand": "0.00", "sofort": "2000000.00", "multiple": "0.6667", "gedeckelt": false},
    ],
    nichtVerteilt: "0.00",
  },
  {
    name: "E1 zwei Klassen, nur die niedrigere Schwelle wandelt (Exit 30 Mio)",
    eingabe: {"exitwert": "30000000", "exitdatum": "2026-06-30", "klassen": [{"id": "SerieB", "name": "SerieB", "rang": 1, "praeferenzFaktor": "1", "partizipierend": false, "capFaktor": null, "verzinsung": null, "umwandelbar": true}, {"id": "SerieA", "name": "SerieA", "rang": 2, "praeferenzFaktor": "1", "partizipierend": false, "capFaktor": null, "verzinsung": null, "umwandelbar": true}], "inhaber": [{"id": "Gruender", "name": "Gruender", "klasseId": null, "anteile": "6000000", "investiert": "0", "datum": null}, {"id": "FondsA", "name": "FondsA", "klasseId": "SerieA", "anteile": "2000000", "investiert": "2000000", "datum": "2023-05-01"}, {"id": "FondsB", "name": "FondsB", "klasseId": "SerieB", "anteile": "2000000", "investiert": "10000000", "datum": "2026-02-01"}]},
    gewandelt: ["SerieA"],
    zeilen: [
      {"id": "Gruender", "praeferenz": "0.00", "beteiligung": "15000000.00", "gesamt": "15000000.00", "treuhand": "0.00", "sofort": "15000000.00", "multiple": null, "gedeckelt": false},
      {"id": "FondsA", "praeferenz": "0.00", "beteiligung": "5000000.00", "gesamt": "5000000.00", "treuhand": "0.00", "sofort": "5000000.00", "multiple": "2.5000", "gedeckelt": false},
      {"id": "FondsB", "praeferenz": "10000000.00", "beteiligung": "0.00", "gesamt": "10000000.00", "treuhand": "0.00", "sofort": "10000000.00", "multiple": "1.0000", "gedeckelt": false},
    ],
    nichtVerteilt: "0.00",
  },
  {
    name: "E2 dieselben Klassen, beide wandeln (Exit 80 Mio)",
    eingabe: {"exitwert": "80000000", "exitdatum": "2026-06-30", "klassen": [{"id": "SerieB", "name": "SerieB", "rang": 1, "praeferenzFaktor": "1", "partizipierend": false, "capFaktor": null, "verzinsung": null, "umwandelbar": true}, {"id": "SerieA", "name": "SerieA", "rang": 2, "praeferenzFaktor": "1", "partizipierend": false, "capFaktor": null, "verzinsung": null, "umwandelbar": true}], "inhaber": [{"id": "Gruender", "name": "Gruender", "klasseId": null, "anteile": "6000000", "investiert": "0", "datum": null}, {"id": "FondsA", "name": "FondsA", "klasseId": "SerieA", "anteile": "2000000", "investiert": "2000000", "datum": "2023-05-01"}, {"id": "FondsB", "name": "FondsB", "klasseId": "SerieB", "anteile": "2000000", "investiert": "10000000", "datum": "2026-02-01"}]},
    gewandelt: ["SerieA", "SerieB"],
    zeilen: [
      {"id": "Gruender", "praeferenz": "0.00", "beteiligung": "48000000.00", "gesamt": "48000000.00", "treuhand": "0.00", "sofort": "48000000.00", "multiple": null, "gedeckelt": false},
      {"id": "FondsA", "praeferenz": "0.00", "beteiligung": "16000000.00", "gesamt": "16000000.00", "treuhand": "0.00", "sofort": "16000000.00", "multiple": "8.0000", "gedeckelt": false},
      {"id": "FondsB", "praeferenz": "0.00", "beteiligung": "16000000.00", "gesamt": "16000000.00", "treuhand": "0.00", "sofort": "16000000.00", "multiple": "1.6000", "gedeckelt": false},
    ],
    nichtVerteilt: "0.00",
  },
  {
    name: "F1 nicht umwandelbar bei hohem Exit",
    eingabe: {"exitwert": "100000000", "exitdatum": "2026-06-30", "klassen": [{"id": "SerieA", "name": "SerieA", "rang": 1, "praeferenzFaktor": "1", "partizipierend": false, "capFaktor": null, "verzinsung": null, "umwandelbar": false}], "inhaber": [{"id": "Gruender", "name": "Gruender", "klasseId": null, "anteile": "7000000", "investiert": "0", "datum": null}, {"id": "FondsA", "name": "FondsA", "klasseId": "SerieA", "anteile": "3000000", "investiert": "3000000", "datum": "2024-03-01"}]},
    gewandelt: [],
    zeilen: [
      {"id": "Gruender", "praeferenz": "0.00", "beteiligung": "97000000.00", "gesamt": "97000000.00", "treuhand": "0.00", "sofort": "97000000.00", "multiple": null, "gedeckelt": false},
      {"id": "FondsA", "praeferenz": "3000000.00", "beteiligung": "0.00", "gesamt": "3000000.00", "treuhand": "0.00", "sofort": "3000000.00", "multiple": "1.0000", "gedeckelt": false},
    ],
    nichtVerteilt: "0.00",
  },
  {
    name: "G1 Treuhand 10 % und Dreierteilung mit Cent-Rest",
    eingabe: {"exitwert": "1000000.01", "exitdatum": "2026-06-30", "treuhandAnteil": "0.1", "klassen": [{"id": "SerieA", "name": "SerieA", "rang": 1, "praeferenzFaktor": "1", "partizipierend": true, "capFaktor": null, "verzinsung": null, "umwandelbar": true}], "inhaber": [{"id": "Gruender", "name": "Gruender", "klasseId": null, "anteile": "3", "investiert": "0", "datum": null}, {"id": "FondsA", "name": "FondsA", "klasseId": "SerieA", "anteile": "3", "investiert": "100000", "datum": "2024-03-01"}, {"id": "Angel", "name": "Angel", "klasseId": null, "anteile": "3", "investiert": "0", "datum": null}]},
    gewandelt: [],
    zeilen: [
      {"id": "Gruender", "praeferenz": "0.00", "beteiligung": "300000.01", "gesamt": "300000.01", "treuhand": "30000.00", "sofort": "270000.01", "multiple": null, "gedeckelt": false},
      {"id": "FondsA", "praeferenz": "100000.00", "beteiligung": "300000.00", "gesamt": "400000.00", "treuhand": "40000.00", "sofort": "360000.00", "multiple": "4.0000", "gedeckelt": false},
      {"id": "Angel", "praeferenz": "0.00", "beteiligung": "300000.00", "gesamt": "300000.00", "treuhand": "30000.00", "sofort": "270000.00", "multiple": null, "gedeckelt": false},
    ],
    nichtVerteilt: "0.00",
  },
  {
    name: "H1 alle am Cap und kein Stamm: Rest nicht verteilt",
    eingabe: {"exitwert": "5000000", "exitdatum": "2026-06-30", "klassen": [{"id": "SerieA", "name": "SerieA", "rang": 1, "praeferenzFaktor": "1", "partizipierend": true, "capFaktor": "2", "verzinsung": null, "umwandelbar": false}], "inhaber": [{"id": "FondsA", "name": "FondsA", "klasseId": "SerieA", "anteile": "100", "investiert": "1000000", "datum": "2024-03-01"}]},
    gewandelt: [],
    zeilen: [
      {"id": "FondsA", "praeferenz": "1000000.00", "beteiligung": "1000000.00", "gesamt": "2000000.00", "treuhand": "0.00", "sofort": "2000000.00", "multiple": "2.0000", "gedeckelt": true},
    ],
    nichtVerteilt: "3000000.00",
  },
  {
    name: "I1 eine Klasse, zwei Runden, Zins 6 %, partizipierend mit Cap 2,3x je Zeile",
    eingabe: {"exitwert": "14000000", "exitdatum": "2026-12-31", "treuhandAnteil": "0.05", "klassen": [{"id": "SerieA", "name": "SerieA", "rang": 1, "praeferenzFaktor": "1.5", "partizipierend": true, "capFaktor": "2.3", "verzinsung": "0.06", "umwandelbar": true}], "inhaber": [{"id": "Gruender", "name": "Gruender", "klasseId": null, "anteile": "6000000", "investiert": "0", "datum": null}, {"id": "FondsA", "name": "FondsA", "klasseId": "SerieA", "anteile": "1500000", "investiert": "2000000", "datum": "2024-06-30"}, {"id": "Angel", "name": "Angel", "klasseId": "SerieA", "anteile": "1000000", "investiert": "1500000", "datum": "2025-03-31"}, {"id": "Pool", "name": "Pool", "klasseId": null, "anteile": "500000", "investiert": "0", "datum": null}]},
    gewandelt: [],
    zeilen: [
      {"id": "Gruender", "praeferenz": "0.00", "beteiligung": "5530630.14", "gesamt": "5530630.14", "treuhand": "276531.51", "sofort": "5254098.63", "multiple": null, "gedeckelt": false},
      {"id": "FondsA", "praeferenz": "3450739.73", "beteiligung": "1149260.27", "gesamt": "4600000.00", "treuhand": "230000.00", "sofort": "4370000.00", "multiple": "2.3000", "gedeckelt": true},
      {"id": "Angel", "praeferenz": "2486712.33", "beteiligung": "921771.69", "gesamt": "3408484.02", "treuhand": "170424.20", "sofort": "3238059.82", "multiple": "2.2723", "gedeckelt": false},
      {"id": "Pool", "praeferenz": "0.00", "beteiligung": "460885.84", "gesamt": "460885.84", "treuhand": "23044.29", "sofort": "437841.55", "multiple": null, "gedeckelt": false},
    ],
    nichtVerteilt: "0.00",
  },
  {
    name: "M1 ESOP im Geld: Ausübungspreis mindert die Auszahlung",
    eingabe: {"exitwert": "13000000", "exitdatum": "2026-06-30", "klassen": [{"id": "SerieA", "name": "SerieA", "rang": 1, "praeferenzFaktor": "1", "partizipierend": false, "capFaktor": null, "verzinsung": null, "umwandelbar": true}], "inhaber": [{"id": "Gruender", "name": "Gruender", "klasseId": null, "anteile": "6000000", "investiert": "0", "datum": null}, {"id": "FondsA", "name": "FondsA", "klasseId": "SerieA", "anteile": "3000000", "investiert": "3000000", "datum": "2024-03-01"}, {"id": "ESOP", "name": "ESOP", "klasseId": null, "anteile": "1000000", "investiert": "0", "datum": null, "mitarbeiter": {"basispreis": "1", "regel": "wie_anteile"}}]},
    gewandelt: ["SerieA"],
    zeilen: [
      {"id": "Gruender", "praeferenz": "0.00", "beteiligung": "8400000.00", "gesamt": "8400000.00", "treuhand": "0.00", "sofort": "8400000.00", "multiple": null, "gedeckelt": false},
      {"id": "FondsA", "praeferenz": "0.00", "beteiligung": "4200000.00", "gesamt": "4200000.00", "treuhand": "0.00", "sofort": "4200000.00", "multiple": "1.4000", "gedeckelt": false},
      {"id": "ESOP", "praeferenz": "0.00", "beteiligung": "400000.00", "gesamt": "400000.00", "treuhand": "0.00", "sofort": "400000.00", "multiple": null, "gedeckelt": false},
    ],
    nichtVerteilt: "0.00",
  },
  {
    name: "M2 Option aus dem Geld bekommt nichts",
    eingabe: {"exitwert": "13000000", "exitdatum": "2026-06-30", "klassen": [{"id": "SerieA", "name": "SerieA", "rang": 1, "praeferenzFaktor": "1", "partizipierend": false, "capFaktor": null, "verzinsung": null, "umwandelbar": true}], "inhaber": [{"id": "Gruender", "name": "Gruender", "klasseId": null, "anteile": "6000000", "investiert": "0", "datum": null}, {"id": "FondsA", "name": "FondsA", "klasseId": "SerieA", "anteile": "3000000", "investiert": "3000000", "datum": "2024-03-01"}, {"id": "ESOP", "name": "ESOP", "klasseId": null, "anteile": "1000000", "investiert": "0", "datum": null, "mitarbeiter": {"basispreis": "2", "regel": "wie_anteile"}}]},
    gewandelt: ["SerieA"],
    zeilen: [
      {"id": "Gruender", "praeferenz": "0.00", "beteiligung": "8666666.67", "gesamt": "8666666.67", "treuhand": "0.00", "sofort": "8666666.67", "multiple": null, "gedeckelt": false},
      {"id": "FondsA", "praeferenz": "0.00", "beteiligung": "4333333.33", "gesamt": "4333333.33", "treuhand": "0.00", "sofort": "4333333.33", "multiple": "1.4444", "gedeckelt": false},
      {"id": "ESOP", "praeferenz": "0.00", "beteiligung": "0.00", "gesamt": "0.00", "treuhand": "0.00", "sofort": "0.00", "multiple": null, "gedeckelt": false},
    ],
    nichtVerteilt: "0.00",
  },
  {
    name: "M3 Präferenz frisst Erlös: Mitarbeiterbeteiligung leer",
    eingabe: {"exitwert": "2500000", "exitdatum": "2026-06-30", "klassen": [{"id": "SerieA", "name": "SerieA", "rang": 1, "praeferenzFaktor": "1", "partizipierend": false, "capFaktor": null, "verzinsung": null, "umwandelbar": false}], "inhaber": [{"id": "Gruender", "name": "Gruender", "klasseId": null, "anteile": "6000000", "investiert": "0", "datum": null}, {"id": "FondsA", "name": "FondsA", "klasseId": "SerieA", "anteile": "3000000", "investiert": "3000000", "datum": "2024-03-01"}, {"id": "VSOP", "name": "VSOP", "klasseId": null, "anteile": "1000000", "investiert": "0", "datum": null, "mitarbeiter": {"basispreis": "0", "regel": "wie_anteile"}}]},
    gewandelt: [],
    zeilen: [
      {"id": "Gruender", "praeferenz": "0.00", "beteiligung": "0.00", "gesamt": "0.00", "treuhand": "0.00", "sofort": "0.00", "multiple": null, "gedeckelt": false},
      {"id": "FondsA", "praeferenz": "2500000.00", "beteiligung": "0.00", "gesamt": "2500000.00", "treuhand": "0.00", "sofort": "2500000.00", "multiple": "0.8333", "gedeckelt": false},
      {"id": "VSOP", "praeferenz": "0.00", "beteiligung": "0.00", "gesamt": "0.00", "treuhand": "0.00", "sofort": "0.00", "multiple": null, "gedeckelt": false},
    ],
    nichtVerteilt: "0.00",
  },
  {
    name: "M4 zwei Tranchen, eine aus dem Geld, mit Cap",
    eingabe: {"exitwert": "30000000", "exitdatum": "2026-06-30", "klassen": [{"id": "SerieA", "name": "SerieA", "rang": 1, "praeferenzFaktor": "1", "partizipierend": true, "capFaktor": "2", "verzinsung": null, "umwandelbar": true}], "inhaber": [{"id": "Gruender", "name": "Gruender", "klasseId": null, "anteile": "6000000", "investiert": "0", "datum": null}, {"id": "FondsA", "name": "FondsA", "klasseId": "SerieA", "anteile": "2000000", "investiert": "4000000", "datum": "2024-03-01"}, {"id": "ESOP1", "name": "ESOP1", "klasseId": null, "anteile": "500000", "investiert": "0", "datum": null, "mitarbeiter": {"basispreis": "0.5", "regel": "wie_anteile"}}, {"id": "ESOP2", "name": "ESOP2", "klasseId": null, "anteile": "500000", "investiert": "0", "datum": null, "mitarbeiter": {"basispreis": "4", "regel": "wie_anteile"}}]},
    gewandelt: [],
    zeilen: [
      {"id": "Gruender", "praeferenz": "0.00", "beteiligung": "20538461.54", "gesamt": "20538461.54", "treuhand": "0.00", "sofort": "20538461.54", "multiple": null, "gedeckelt": false},
      {"id": "FondsA", "praeferenz": "4000000.00", "beteiligung": "4000000.00", "gesamt": "8000000.00", "treuhand": "0.00", "sofort": "8000000.00", "multiple": "2.0000", "gedeckelt": true},
      {"id": "ESOP1", "praeferenz": "0.00", "beteiligung": "1461538.46", "gesamt": "1461538.46", "treuhand": "0.00", "sofort": "1461538.46", "multiple": null, "gedeckelt": false},
      {"id": "ESOP2", "praeferenz": "0.00", "beteiligung": "0.00", "gesamt": "0.00", "treuhand": "0.00", "sofort": "0.00", "multiple": null, "gedeckelt": false},
    ],
    nichtVerteilt: "0.00",
  },
  {
    name: "M5 VSOP mit Basispreis, Auszahlung mindert alle Rückflüsse anteilig",
    eingabe: {"exitwert": "20000000", "exitdatum": "2026-06-30", "klassen": [{"id": "SerieA", "name": "SerieA", "rang": 1, "praeferenzFaktor": "1", "partizipierend": true, "capFaktor": null, "verzinsung": null, "umwandelbar": true}], "inhaber": [{"id": "Gruender", "name": "Gruender", "klasseId": null, "anteile": "7000000", "investiert": "0", "datum": null}, {"id": "FondsA", "name": "FondsA", "klasseId": "SerieA", "anteile": "2000000", "investiert": "4000000", "datum": "2024-03-01"}, {"id": "VSOP", "name": "VSOP", "klasseId": null, "anteile": "1000000", "investiert": "0", "datum": null, "mitarbeiter": {"basispreis": "0.8", "regel": "anteilig"}}]},
    gewandelt: [],
    zeilen: [
      {"id": "Gruender", "praeferenz": "0.00", "beteiligung": "11885714.29", "gesamt": "11885714.29", "treuhand": "0.00", "sofort": "11885714.29", "multiple": null, "gedeckelt": false},
      {"id": "FondsA", "praeferenz": "3820408.16", "beteiligung": "3395918.37", "gesamt": "7216326.53", "treuhand": "0.00", "sofort": "7216326.53", "multiple": "1.8041", "gedeckelt": false},
      {"id": "VSOP", "praeferenz": "0.00", "beteiligung": "897959.18", "gesamt": "897959.18", "treuhand": "0.00", "sofort": "897959.18", "multiple": null, "gedeckelt": false},
    ],
    nichtVerteilt: "0.00",
  },
  {
    name: "M6 VSOP anteilig aus dem Geld",
    eingabe: {"exitwert": "5000000", "exitdatum": "2026-06-30", "klassen": [{"id": "SerieA", "name": "SerieA", "rang": 1, "praeferenzFaktor": "1", "partizipierend": false, "capFaktor": null, "verzinsung": null, "umwandelbar": true}], "inhaber": [{"id": "Gruender", "name": "Gruender", "klasseId": null, "anteile": "7000000", "investiert": "0", "datum": null}, {"id": "FondsA", "name": "FondsA", "klasseId": "SerieA", "anteile": "3000000", "investiert": "3000000", "datum": "2024-03-01"}, {"id": "VSOP", "name": "VSOP", "klasseId": null, "anteile": "1000000", "investiert": "0", "datum": null, "mitarbeiter": {"basispreis": "1", "regel": "anteilig"}}]},
    gewandelt: [],
    zeilen: [
      {"id": "Gruender", "praeferenz": "0.00", "beteiligung": "2000000.00", "gesamt": "2000000.00", "treuhand": "0.00", "sofort": "2000000.00", "multiple": null, "gedeckelt": false},
      {"id": "FondsA", "praeferenz": "3000000.00", "beteiligung": "0.00", "gesamt": "3000000.00", "treuhand": "0.00", "sofort": "3000000.00", "multiple": "1.0000", "gedeckelt": false},
      {"id": "VSOP", "praeferenz": "0.00", "beteiligung": "0.00", "gesamt": "0.00", "treuhand": "0.00", "sofort": "0.00", "multiple": null, "gedeckelt": false},
    ],
    nichtVerteilt: "0.00",
  },
];

/** Knickpunkte in geschlossener Form (von Hand hergeleitet), Exitwerte auf Cent. */
export const REFERENZ_KNICKE: { name: string; knicke: { art: string; exitwert: string }[] }[] = [
  {
    "name": "A1/A2 Seriell A: Präferenz voll bei Präferenz, Umwandlung bei Präferenz ÷ Anteil",
    "knicke": [
      {
        "art": "praeferenz_voll",
        "exitwert": "3000000.00"
      },
      {
        "art": "umwandlung",
        "exitwert": "10000000.00"
      }
    ]
  },
  {
    "name": "C2 Cap 3x: Präferenz und Beteiligungsbeginn bei 2 Mio, Cap bei 22 Mio, Umwandlung bei 30 Mio",
    "knicke": [
      {
        "art": "praeferenz_voll",
        "exitwert": "2000000.00"
      },
      {
        "art": "beteiligung_beginn",
        "exitwert": "2000000.00"
      },
      {
        "art": "deckel",
        "exitwert": "22000000.00"
      },
      {
        "art": "umwandlung",
        "exitwert": "30000000.00"
      }
    ]
  }
];
