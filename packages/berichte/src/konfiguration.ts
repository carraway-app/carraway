import { z } from "zod";

/**
 * Konfigurierbare Vorlagen je Fonds und Berichtsart: welche Abschnitte in welcher Reihenfolge, welche Kennzahlzeilen,
 * welche Spalten der Tabellen und Listen, Betragseinheit (EUR oder TEUR). Die Konfiguration wird beim Speichern und beim
 * Lesen geprüft; fehlende Felder füllt die Standardkonfiguration der Art.
 */

export type Einheit = "EUR" | "TEUR";
export const EINHEITEN: readonly Einheit[] = ["EUR", "TEUR"];

export const BERICHTSARTEN = ["fondsbericht", "quartalsbericht", "lp_bericht", "gremienvorlage", "portfolioliste", "exitliste", "pai_erklaerung", "szenariobericht"] as const;
export type Berichtsart = (typeof BERICHTSARTEN)[number];

/** Kennzahlen des Fonds, wählbar als Kacheln und Herkunftseinträge. */
export const KENNZAHLEN = ["nav", "tvpi", "dpi", "rvpi", "irr", "abgerufen", "eingezahlt", "offen", "ueberfaellig", "ungeklaert", "ausschuettungen", "zeichnungskapital"] as const;
/** Spalten der Portfoliotabelle in Fonds- und LP-Bericht. */
export const PORTFOLIO_SPALTEN = ["unternehmen", "instrument", "status", "investiert", "rueckfluesse", "bewertung", "multiple"] as const;
/** Spalten der Portfolioliste (Steuerungsliste). */
export const LISTEN_SPALTEN_PORTFOLIO = ["unternehmen", "sektor", "phase", "instrument", "betreuung", "zusage", "investiert", "buchwert", "wertberichtigung", "offeneZusage", "bewertung", "multiple"] as const;
/** Spalten der Exitliste. */
export const LISTEN_SPALTEN_EXIT = ["unternehmen", "art", "datum", "investiert", "erloes", "multiple", "irr", "offeneForderungen"] as const;

/** Freitextabschnitte des LP-Berichts: Schlüssel und Reihenfolge der möglichen Texte. */
export const FREITEXT_SCHLUESSEL = ["vorwort", "marktumfeld", "ausblick"] as const;

export const ABSCHNITTE: Record<Berichtsart, readonly string[]> = {
  fondsbericht: ["kennzahlen", "portfolio", "realisierungen", "herkunft"],
  quartalsbericht: ["bewertungsverlauf", "vorgaenge", "unternehmenskennzahlen"],
  lp_bericht: ["vorwort", "kennzahlen", "marktumfeld", "kapitalkonten", "portfolio", "realisierungen", "bewertung", "ausblick", "herkunft"],
  gremienvorlage: ["deals", "beschluesse"],
  portfolioliste: ["liste"],
  exitliste: ["liste"],
  pai_erklaerung: ["vorbemerkung", "tabelle", "befunde", "herkunft"],
  szenariobericht: [],
};

const SPALTEN: Record<Berichtsart, readonly string[]> = {
  fondsbericht: PORTFOLIO_SPALTEN,
  quartalsbericht: [],
  lp_bericht: PORTFOLIO_SPALTEN,
  gremienvorlage: [],
  portfolioliste: LISTEN_SPALTEN_PORTFOLIO,
  exitliste: LISTEN_SPALTEN_EXIT,
  pai_erklaerung: [],
  szenariobericht: [],
};

const KENNZAHLEN_ARTEN: readonly Berichtsart[] = ["fondsbericht", "lp_bericht"];
/** Arten mit Tabellenspalten, in die eigene Felder (Zusatzfelder) aufgenommen werden können. */
export const ZUSATZFELD_ARTEN: readonly Berichtsart[] = ["fondsbericht", "lp_bericht", "portfolioliste", "exitliste"];
/** Höchstzahl eigener Felder als Spalten (die Tabellen sind quer oder DIN A4 und müssen lesbar bleiben). */
export const MAX_ZUSATZFELDER = 8;

export interface Vorlagenkonfiguration {
  einheit: Einheit;
  /** Abschnitte in der Reihenfolge der Ausgabe. */
  abschnitte: string[];
  /** Kennzahlen in der Reihenfolge der Kacheln und der Herkunft. */
  kennzahlen: string[];
  /** Spalten der Tabellen oder Listen in der Reihenfolge der Ausgabe. */
  spalten: string[];
  /**
   * Nur Quartalsbericht: Schlüssel der Unternehmenskennzahlen im Abschnitt `unternehmenskennzahlen`. Leer = die Auswahl des Fonds.
   * Die Schlüssel stammen aus dem Katalog (Konfiguration, nicht Code); das Paket prüft nur die Form, die API den Katalog.
   */
  unternehmenskennzahlen: string[];
  /**
   * Eigene Felder (Zusatzfelder) von Fonds, Finanzierungsrunde, Instrument und Beteiligung als zusätzliche Spalten nach den festen Spalten, in dieser Reihenfolge.
   * Die Einträge sind IDs von Felddefinitionen; das Paket prüft nur die Form, die API, dass die Definition besteht und zu einem dieser Objekte gehört.
   */
  zusatzfelder: string[];
}

export const UNTERNEHMENSKENNZAHL_SCHLUESSEL = /^[a-z][a-z0-9_]{1,59}$/;
const DEFINITIONS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Standardkonfiguration: alle Abschnitte, Kennzahlen und Spalten der Art in der üblichen Reihenfolge, Beträge in Euro. */
export function standardKonfiguration(art: Berichtsart): Vorlagenkonfiguration {
  return {
    einheit: "EUR",
    abschnitte: [...ABSCHNITTE[art]],
    kennzahlen: KENNZAHLEN_ARTEN.includes(art) ? [...KENNZAHLEN] : [],
    spalten: [...SPALTEN[art]],
    unternehmenskennzahlen: [],
    zusatzfelder: [],
  };
}

function auswahl(feld: string, erlaubt: readonly string[]) {
  return z
    .array(z.string())
    .superRefine((liste, ctx) => {
      const unbekannt = liste.filter((x) => !erlaubt.includes(x));
      if (unbekannt.length) ctx.addIssue({ code: "custom", message: `Unbekannt: ${unbekannt.join(", ")} (erlaubt: ${erlaubt.join(", ") || "keine"})` });
      if (new Set(liste).size !== liste.length) ctx.addIssue({ code: "custom", message: `${feld}: Einträge doppelt` });
    });
}

/** Was eine Vorlage der Art enthalten darf: die Auswahllisten, aus denen die Konfiguration besteht (Quelle für API und Oberfläche). */
export interface ErlaubteAuswahl {
  abschnitte: string[];
  kennzahlen: string[];
  spalten: string[];
  einheiten: Einheit[];
  /** Die Art nimmt eigene Felder als Spalten auf (die wählbaren Felder liefert `GET /zusatzfelder/{objekt}/definitionen`). */
  zusatzfelder: boolean;
}

export function erlaubteAuswahl(art: Berichtsart): ErlaubteAuswahl {
  return {
    abschnitte: [...ABSCHNITTE[art]],
    kennzahlen: KENNZAHLEN_ARTEN.includes(art) ? [...KENNZAHLEN] : [],
    spalten: [...SPALTEN[art]],
    einheiten: [...EINHEITEN],
    zusatzfelder: ZUSATZFELD_ARTEN.includes(art),
  };
}

/** Zod-Schema der Konfiguration einer Art; alle Felder sind optional und werden mit der Standardkonfiguration ergänzt. */
export function konfigurationsSchema(art: Berichtsart) {
  const standard = standardKonfiguration(art);
  const nichtLeer = <T extends z.ZodType<string[]>>(schema: T, feld: string, leerErlaubt: boolean) =>
    leerErlaubt ? schema : schema.refine((l) => l.length > 0, { message: `${feld}: mindestens ein Eintrag` });
  return z
    .object({
      einheit: z.enum(["EUR", "TEUR"]).optional(),
      // Der Quartalsbericht hatte früher keine Abschnitte (leere Liste gespeichert): leer gilt dort als Standard.
      abschnitte: nichtLeer(auswahl("abschnitte", ABSCHNITTE[art]), "abschnitte", ABSCHNITTE[art].length === 0 || art === "quartalsbericht").optional(),
      kennzahlen: nichtLeer(auswahl("kennzahlen", KENNZAHLEN_ARTEN.includes(art) ? KENNZAHLEN : []), "kennzahlen", true).optional(),
      spalten: nichtLeer(auswahl("spalten", SPALTEN[art]), "spalten", SPALTEN[art].length === 0).optional(),
      unternehmenskennzahlen: z
        .array(z.string().regex(UNTERNEHMENSKENNZAHL_SCHLUESSEL, "Schlüssel aus Kleinbuchstaben, Ziffern und Unterstrich"))
        .max(50)
        .refine((l) => new Set(l).size === l.length, { message: "unternehmenskennzahlen: Einträge doppelt" })
        .refine((l) => art === "quartalsbericht" || l.length === 0, { message: "Unternehmenskennzahlen gibt es nur im Quartalsbericht" })
        .optional(),
      zusatzfelder: z
        .array(z.string().regex(DEFINITIONS_ID, "ID einer Felddefinition"))
        .max(MAX_ZUSATZFELDER, `höchstens ${MAX_ZUSATZFELDER} eigene Felder`)
        .refine((l) => new Set(l).size === l.length, { message: "zusatzfelder: Einträge doppelt" })
        .refine((l) => ZUSATZFELD_ARTEN.includes(art) || l.length === 0, { message: "Eigene Felder als Spalten gibt es nur in Fondsbericht, LP-Bericht, Portfolioliste und Exitliste" })
        .optional(),
    })
    .strict()
    .transform((k): Vorlagenkonfiguration => ({
      einheit: k.einheit ?? standard.einheit,
      abschnitte: k.abschnitte && k.abschnitte.length > 0 ? k.abschnitte : standard.abschnitte,
      kennzahlen: k.kennzahlen ?? standard.kennzahlen,
      spalten: k.spalten ?? standard.spalten,
      unternehmenskennzahlen: k.unternehmenskennzahlen ?? standard.unternehmenskennzahlen,
      zusatzfelder: k.zusatzfelder ?? standard.zusatzfelder,
    }));
}

/** Prüft eine Konfiguration (z. B. aus der Datenbank oder einer Eingabe) und ergänzt Standardwerte. Wirft einen Zod-Fehler. */
export function pruefeKonfiguration(art: Berichtsart, roh: unknown): Vorlagenkonfiguration {
  return konfigurationsSchema(art).parse(roh ?? {});
}
