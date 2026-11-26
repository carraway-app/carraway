export const SILBEN = [
  "vel", "mo", "ra", "tin", "kor", "lu", "sa", "ben", "dra", "fi", "nex", "ur", "ol", "zi", "ar", "men",
  "ta", "qui", "bro", "la", "ve", "do", "chi", "pa", "gry", "sil", "mar", "jo", "ke", "wi",
] as const;

export const SEKTOREN = [
  ["Robotik", "Industrie"],
  ["Analytik", "Software"],
  ["Energie", "Energie"],
  ["Medizin", "Gesundheit"],
  ["Logistik", "Logistik"],
  ["Software", "Software"],
  ["Systeme", "Industrie"],
  ["Labs", "Forschung"],
  ["Werkstoffe", "Werkstoffe"],
  ["Agrar", "Landwirtschaft"],
  ["Mobilität", "Mobilität"],
  ["Bildung", "Bildung"],
  ["Sensorik", "Industrie"],
  ["Finanztechnik", "Finanzen"],
] as const;

export const INVESTOR_ZUSATZ = ["Capital", "Ventures", "Beteiligungen", "Partner", "Kapital"] as const;

export const VORNAMEN = [
  "Anna", "Jonas", "Mareike", "Tobias", "Katrin", "Felix", "Sabine", "Lukas", "Nadine", "Markus", "Julia", "Stefan",
  "Claudia", "Florian", "Petra", "Daniel", "Birgit", "Matthias", "Sandra", "Andreas", "Verena", "Christian", "Heike",
  "Moritz", "Larissa", "Thomas", "Svenja", "Jan", "Eva", "Philipp",
] as const;

export const NACHNAMEN = [
  "Berger", "Hoffmann", "Keller", "Lang", "Neumann", "Schröder", "Vogel", "Winter", "Brandt", "Engel", "Fuchs", "Graf",
  "Haas", "Jäger", "Kaiser", "Lorenz", "Möller", "Peters", "Roth", "Sommer", "Thiel", "Ullrich", "Voigt", "Wagner",
  "Ziegler", "Albrecht", "Beck", "Dietrich", "Ernst", "Franke",
] as const;

export const ORTE = ["Berlin", "Hamburg", "München", "Köln", "Leipzig", "Stuttgart", "Dresden", "Karlsruhe", "Bremen", "Münster"] as const;

export const FUNKTIONEN = ["Geschäftsführung", "Finanzleitung", "Technikleitung", "Vertriebsleitung", "Gründung"] as const;

export const QUELLEN = ["Empfehlung", "Netzwerk", "Eigene Recherche", "Veranstaltung", "Co-Investor", "Eingang per Mail"] as const;

export const BETREUUNG = ["Anna Berger", "Jonas Keller", "Mareike Vogel"] as const;

export const INSTRUMENT_GEWICHTE = [
  ["offene_beteiligung", 55],
  ["wandeldarlehen", 20],
  ["darlehen", 15],
  ["stille_beteiligung", 10],
] as const;

const UMLAUTE: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };
export const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[äöüß]/g, (z) => UMLAUTE[z] ?? z)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
