import { z } from "zod";

/**
 * Meldedefinition: Aufbau einer Förder- oder Meldeung als versionierte Konfiguration (kein Code). Die Definition nennt Abschnitte mit Feldern oder
 * Tabellen, zu jedem Wert eine Quelle aus einer geschlossenen Menge von Carraway-Quellen, Filter und Prüfregeln. Dieses Modul prüft nur den Aufbau
 * (Zod, eindeutige Bezeichner, Verweise, Zyklen, erlaubte Quellen je Abschnitt); ob eine Kennzahl im Katalog steht, prüft die API (`kennzahlSchluessel`).
 */

export const SCHEMA_VERSION = 1;

/** Bezeichner von Abschnitten, Feldern, Spalten und Regeln: klein, mit Ziffern und Unterstrich (auch Schlüssel der Typst-Daten). */
export const BEZEICHNER = /^[a-z][a-z0-9_]{0,59}$/;
const bezeichner = z.string().regex(BEZEICHNER, "Kleinbuchstaben, Ziffern und Unterstrich, höchstens 60 Zeichen, mit einem Buchstaben beginnen");
const text = z.strictObject({ de: z.string().trim().min(1).max(400), en: z.string().trim().min(1).max(400) });
const dezimal = z.string().regex(/^-?\d{1,18}(\.\d{1,6})?$/, "Dezimalzahl mit Punkt erwartet");

export const INSTRUMENTE = ["offene_beteiligung", "stille_beteiligung", "darlehen", "wandeldarlehen", "venture_debt", "gesellschafterdarlehen", "safe", "optionsschein"] as const;
export const BETEILIGUNG_STATUS = ["aktiv", "exit", "insolvent", "abgeschrieben"] as const;
export const MITTELARTEN = ["foerdermittel", "kofinanzierung", "eigenmittel", "rueckflussmittel"] as const;
/** Meldeart einer Mittelart des Fonds (Kategorie, nach der Definitionen filtern und gruppieren). */
export type Mittelart = (typeof MITTELARTEN)[number];
export const VORGANGSARTEN = ["zusage", "auszahlung", "rueckfluss", "zins", "tilgung", "wertberichtigung", "zinszahlung", "dividende"] as const;
export const FORMATE = ["betrag", "zahl", "ganzzahl", "prozent", "text", "datum", "ja_nein"] as const;
export const ZAHLENFORMATE: readonly Feldformat[] = ["betrag", "zahl", "ganzzahl", "prozent"];
export const GRUPPIERUNGEN = ["beteiligung", "programm", "instrument", "mittelart", "sitzland", "branche"] as const;
export const QUELLENARTEN = ["kennzahl", "vorgang", "fondsbewegung", "bestand", "beteiligungsanzahl", "stammdaten", "schluessel", "manuell", "berechnet"] as const;
export const BESTAENDE = ["zusage", "investiert", "rueckfluesse", "buchwert", "bewertung", "offene_zusage"] as const;
export const KENNZAHL_AGGREGATIONEN = ["summe", "durchschnitt", "minimum", "maximum", "anzahl", "anzahl_ja"] as const;
export const SCHLUESSELFELDER = ["projektnummer", "vertragsnummer", "partnernummer", "buchungskreis"] as const;
export const OPERATIONEN = ["summe", "differenz", "produkt", "quotient", "anteil_prozent"] as const;
export const OPERATOREN = ["=", "!=", "<", "<=", ">", ">="] as const;

/** Stammdatenfelder und die Abschnitte, in denen sie gelten: `fonds`, `periode` und `programm` überall, der Rest nur in Tabellen je Beteiligung oder je Gruppe. */
export const STAMMDATEN_ALLGEMEIN = ["fonds.name", "fonds.kurzname", "fonds.vintage", "fonds.zeichnungskapital", "fonds.waehrung", "periode.beginn", "periode.ende", "periode.kennung", "programm.schluessel", "programm.bezeichnung"] as const;
export const STAMMDATEN_BETEILIGUNG = ["organisation.name", "organisation.sektor", "organisation.nace", "organisation.ort", "organisation.sitzland", "organisation.region", "beteiligung.instrument", "beteiligung.status", "beteiligung.erstinvestment", "foerderung.programm", "foerderung.mittelart"] as const;
export const STAMMDATEN_GRUPPE = ["gruppe.schluessel", "gruppe.bezeichnung"] as const;
export const STAMMDATEN_FELDER = [...STAMMDATEN_ALLGEMEIN, ...STAMMDATEN_BETEILIGUNG, ...STAMMDATEN_GRUPPE] as const;

export type Feldformat = (typeof FORMATE)[number];
export type Gruppierung = (typeof GRUPPIERUNGEN)[number];

export const filterSchema = z.strictObject({
  foerderprogramm: z.array(bezeichner).min(1).optional(),
  mittelart: z.array(z.enum(MITTELARTEN)).min(1).optional(),
  instrument: z.array(z.enum(INSTRUMENTE)).min(1).optional(),
  sitzland: z.array(z.string().regex(/^[A-Z]{2}$/, "Zwei Großbuchstaben (ISO 3166-1) erwartet")).min(1).optional(),
  region: z.array(z.string().trim().min(1).max(100)).min(1).optional(),
  branche: z.array(z.string().trim().min(1).max(100)).min(1).optional(),
  /** NACE-Abschnitt (Buchstabe A bis U) der Organisation (Stammdatum der ESG-Auswertung). */
  nace: z.array(z.string().regex(/^[A-U]$/, "Buchstabe A bis U erwartet")).min(1).optional(),
  status: z.array(z.enum(BETEILIGUNG_STATUS)).min(1).optional(),
});
export type Filter = z.infer<typeof filterSchema>;

const zeitraumWahl = z.enum(["periode", "kumuliert"]);

export const quelleSchema = z.discriminatedUnion("art", [
  z.strictObject({
    art: z.literal("kennzahl"),
    schluessel: z.string().regex(/^[a-z][a-z0-9_]{1,59}$/, "Schlüssel einer Kennzahl des Katalogs erwartet"),
    szenario: z.enum(["ist", "plan"]).default("ist"),
    /** `periode`: Werte im Berichtszeitraum; `letzter`: zuletzt bestätigter Zeitraum bis zum Ende des Berichtszeitraums. */
    zeitraum: z.enum(["periode", "letzter"]).default("periode"),
    aggregation: z.enum(KENNZAHL_AGGREGATIONEN).default("summe"),
  }),
  z.strictObject({
    art: z.literal("vorgang"),
    vorgangsarten: z.array(z.enum(VORGANGSARTEN)).min(1).refine((a) => new Set(a).size === a.length, "Jede Art höchstens einmal"),
    zeitraum: zeitraumWahl,
    aggregation: z.enum(["summe", "anzahl"]).default("summe"),
    negieren: z.boolean().default(false),
  }),
  z.strictObject({ art: z.literal("fondsbewegung"), bewegung: z.enum(["abruf", "ausschuettung"]), zeitraum: zeitraumWahl }),
  z.strictObject({ art: z.literal("bestand"), groesse: z.enum(BESTAENDE) }),
  z.strictObject({ art: z.literal("beteiligungsanzahl"), umfang: z.enum(["bestand", "neu"]).default("bestand") }),
  z.strictObject({ art: z.literal("stammdaten"), feld: z.enum(STAMMDATEN_FELDER) }),
  z.strictObject({ art: z.literal("schluessel"), feld: z.enum(SCHLUESSELFELDER) }),
  z.strictObject({ art: z.literal("manuell") }),
  z.strictObject({ art: z.literal("berechnet"), operation: z.enum(OPERATIONEN), felder: z.array(bezeichner).min(1).max(20) }),
]);
export type Quelle = z.infer<typeof quelleSchema>;

export const feldSchema = z.strictObject({
  id: bezeichner,
  bezeichnung: text,
  einheit: z.string().trim().max(20).optional(),
  format: z.enum(FORMATE),
  quelle: quelleSchema,
  filter: filterSchema.optional(),
  /** Ein leerer Wert ist ein Fehler im Prüfbericht (nur bei Feldern in Abschnitten vom Typ `felder`). */
  pflicht: z.boolean().optional(),
  /** Nur bei Tabellenspalten: eine Summenzeile unter der Tabelle. */
  summe: z.boolean().optional(),
  hinweis: text.optional(),
});
export type Feld = z.infer<typeof feldSchema>;

const felderAbschnitt = z.strictObject({ id: bezeichner, typ: z.literal("felder"), titel: text, felder: z.array(feldSchema).min(1).max(200) });
const tabellenAbschnitt = z.strictObject({
  id: bezeichner,
  typ: z.literal("tabelle"),
  titel: text,
  je: z.enum(GRUPPIERUNGEN),
  spalten: z.array(feldSchema).min(1).max(40),
  filter: filterSchema.optional(),
  sortierung: z.strictObject({ spalte: bezeichner, richtung: z.enum(["auf", "ab"]).default("auf") }).optional(),
});
export const abschnittSchema = z.discriminatedUnion("typ", [felderAbschnitt, tabellenAbschnitt]);
export type Abschnitt = z.infer<typeof abschnittSchema>;

/** Verweis auf einen Wert: ein Feld eines Abschnitts vom Typ `felder` (`feld`) oder die Summe einer Tabellenspalte (`abschnitt.spalte`). */
const verweis = z.string().regex(/^[a-z][a-z0-9_]{0,59}(\.[a-z][a-z0-9_]{0,59})?$/, "Feld oder Abschnitt.Spalte erwartet");
const regelKopf = { id: bezeichner, schwere: z.enum(["fehler", "warnung"]), meldung: text };
export const regelSchema = z.discriminatedUnion("art", [
  z.strictObject({ ...regelKopf, art: z.literal("pflicht"), felder: z.array(verweis).min(1) }),
  z.strictObject({ ...regelKopf, art: z.literal("bereich"), feld: verweis, minimum: dezimal.optional(), maximum: dezimal.optional() }),
  z.strictObject({ ...regelKopf, art: z.literal("vergleich"), links: verweis, operator: z.enum(OPERATOREN), rechts: z.union([verweis, z.strictObject({ wert: dezimal })]), toleranz: dezimal.optional() }),
  z.strictObject({ ...regelKopf, art: z.literal("summe"), summanden: z.array(verweis).min(1), gleich: verweis, toleranz: dezimal.optional() }),
]);
export type Regel = z.infer<typeof regelSchema>;

export const definitionSchema = z.strictObject({
  schema: z.literal(SCHEMA_VERSION),
  /** Hinweis zur Fachlichkeit der Definition, steht in jeder Datei (z. B. „Vorlage, fachlich zu prüfen“). */
  hinweis: text.optional(),
  filter: filterSchema.optional(),
  abschnitte: z.array(abschnittSchema).min(1).max(40),
  regeln: z.array(regelSchema).max(200).default([]),
});
export type DefinitionInhalt = z.infer<typeof definitionSchema>;

// Prüfung ---------------------------------------------------------------------------------------------------------

/** Ein Fehler der Definition mit Pfad im JSON (`abschnitte.0.felder.2.quelle.schluessel`), stabilem Code und deutscher Meldung. */
export interface DefinitionsFehler {
  pfad: string;
  code: string;
  meldung: string;
  params?: Record<string, string | number>;
}

export type DefinitionsErgebnis = { ok: true; definition: DefinitionInhalt } | { ok: false; fehler: DefinitionsFehler[] };

const pfadText = (pfad: readonly PropertyKey[]) => pfad.map(String).join(".");

function meldungAus(issue: z.core.$ZodIssue): DefinitionsFehler {
  const pfad = pfadText(issue.path);
  const roh = issue as z.core.$ZodIssue & { expected?: string; values?: unknown[]; keys?: string[]; minimum?: number | bigint; maximum?: number | bigint; origin?: string; options?: unknown[]; note?: string };
  switch (issue.code) {
    case "invalid_type":
      return { pfad, code: "falscher_typ", meldung: `Erwartet wird ${roh.expected ?? "ein anderer Typ"}.`, params: { erwartet: roh.expected ?? "" } };
    case "invalid_value": {
      const erlaubt = (roh.values ?? []).map(String).join(", ");
      return { pfad, code: "wert_nicht_erlaubt", meldung: `Erlaubt sind: ${erlaubt}.`, params: { erlaubt } };
    }
    case "unrecognized_keys": {
      const felder = (roh.keys ?? []).join(", ");
      return { pfad, code: "unbekanntes_feld", meldung: `Unbekannte Angaben: ${felder}.`, params: { felder } };
    }
    case "invalid_union": {
      // Unterscheidung nach `art` oder `typ`: Der Wert der Unterscheidung ist unbekannt.
      const unterscheidung = pfad.endsWith("art") ? "art" : "typ";
      return { pfad, code: "art_unbekannt", meldung: `Der Wert von „${unterscheidung}“ ist unbekannt oder fehlt.`, params: { feld: unterscheidung } };
    }
    case "too_small":
      return { pfad, code: "zu_klein", meldung: roh.origin === "array" ? `Mindestens ${roh.minimum} Einträge erforderlich.` : `Mindestens ${roh.minimum} Zeichen oder Wert erforderlich.`, params: { minimum: Number(roh.minimum) } };
    case "too_big":
      return { pfad, code: "zu_gross", meldung: roh.origin === "array" ? `Höchstens ${roh.maximum} Einträge erlaubt.` : `Höchstens ${roh.maximum} Zeichen oder Wert erlaubt.`, params: { maximum: Number(roh.maximum) } };
    case "invalid_format":
      return { pfad, code: "format_ungueltig", meldung: issue.message };
    default:
      return { pfad, code: "ungueltig", meldung: issue.message };
  }
}

export const ZAHLEN = new Set<string>(ZAHLENFORMATE);

/** Wert-Verweise der Regeln und Rechenfelder auflösen: `feld` (Abschnitt `felder`) oder `abschnitt.spalte` (Summe einer Tabellenspalte). */
interface Index {
  felder: Map<string, { abschnitt: string; pfad: string; feld: Feld }>;
  tabellen: Map<string, { pfad: string; abschnitt: Extract<Abschnitt, { typ: "tabelle" }> }>;
}

function baueIndex(d: DefinitionInhalt, fehler: DefinitionsFehler[]): Index {
  const index: Index = { felder: new Map(), tabellen: new Map() };
  const abschnittIds = new Set<string>();
  d.abschnitte.forEach((a, i) => {
    const pfad = `abschnitte.${i}`;
    if (abschnittIds.has(a.id)) fehler.push({ pfad: `${pfad}.id`, code: "doppelte_id", meldung: `Der Abschnitt „${a.id}“ kommt mehrfach vor.`, params: { id: a.id } });
    abschnittIds.add(a.id);
    if (a.typ === "felder") {
      a.felder.forEach((f, j) => {
        if (index.felder.has(f.id)) fehler.push({ pfad: `${pfad}.felder.${j}.id`, code: "doppelte_id", meldung: `Das Feld „${f.id}“ kommt mehrfach vor (Felder müssen in der ganzen Definition eindeutig sein).`, params: { id: f.id } });
        else index.felder.set(f.id, { abschnitt: a.id, pfad: `${pfad}.felder.${j}`, feld: f });
      });
    } else {
      index.tabellen.set(a.id, { pfad, abschnitt: a });
      const spalten = new Set<string>();
      a.spalten.forEach((s, j) => {
        if (spalten.has(s.id)) fehler.push({ pfad: `${pfad}.spalten.${j}.id`, code: "doppelte_id", meldung: `Die Spalte „${s.id}“ kommt in der Tabelle mehrfach vor.`, params: { id: s.id } });
        spalten.add(s.id);
      });
    }
  });
  const regelIds = new Set<string>();
  d.regeln.forEach((r, i) => {
    if (regelIds.has(r.id)) fehler.push({ pfad: `regeln.${i}.id`, code: "doppelte_id", meldung: `Die Regel „${r.id}“ kommt mehrfach vor.`, params: { id: r.id } });
    regelIds.add(r.id);
  });
  return index;
}

/** Findet den Wert, auf den ein Verweis zeigt, und sein Format; `null` bei unbekanntem Ziel. */
export function loeseVerweis(d: DefinitionInhalt, ref: string): { format: Feldformat; art: "feld" | "spaltensumme" } | null {
  const [a, b] = ref.split(".") as [string, string | undefined];
  if (b === undefined) {
    for (const abschnitt of d.abschnitte) if (abschnitt.typ === "felder") for (const f of abschnitt.felder) if (f.id === a) return { format: f.format, art: "feld" };
    return null;
  }
  const abschnitt = d.abschnitte.find((x) => x.id === a);
  if (!abschnitt || abschnitt.typ !== "tabelle") return null;
  const spalte = abschnitt.spalten.find((s) => s.id === b);
  return spalte && spalte.summe ? { format: spalte.format, art: "spaltensumme" } : null;
}

const STAMMDATEN_NUR_BETEILIGUNG = new Set<string>(STAMMDATEN_BETEILIGUNG);
const STAMMDATEN_NUR_GRUPPE = new Set<string>(STAMMDATEN_GRUPPE);

/** Prüft eine Quelle gegen den Ort, an dem sie steht (Abschnitt `felder` oder Tabelle je …). */
function pruefeQuelle(f: Feld, ort: { typ: "felder" } | { typ: "tabelle"; je: Gruppierung }, pfad: string, fehler: DefinitionsFehler[]) {
  const q = f.quelle;
  const nicht = (code: string, meldung: string, params?: Record<string, string | number>) => fehler.push({ pfad: `${pfad}.quelle`, code, meldung, ...(params ? { params } : {}) });
  switch (q.art) {
    case "manuell":
      if (ort.typ !== "felder") nicht("quelle_nicht_erlaubt", "Eine Eingabe von Hand ist nur in Abschnitten vom Typ „felder“ möglich.", { art: q.art });
      break;
    case "fondsbewegung":
      if (ort.typ !== "felder") nicht("quelle_nicht_erlaubt", "Kapitalabrufe und Ausschüttungen des Fonds sind nur in Abschnitten vom Typ „felder“ möglich.", { art: q.art });
      if (f.filter) fehler.push({ pfad: `${pfad}.filter`, code: "filter_nicht_erlaubt", meldung: "Kapitalabrufe und Ausschüttungen gehören dem Fonds, nicht einzelnen Beteiligungen; ein Filter ist hier nicht möglich." });
      break;
    case "schluessel":
      if (ort.typ !== "tabelle" || ort.je !== "beteiligung") nicht("quelle_nicht_erlaubt", "Buchhaltungsschlüssel gibt es nur in Tabellen je Beteiligung.", { art: q.art });
      break;
    case "stammdaten": {
      const feld: string = q.feld;
      if (STAMMDATEN_NUR_BETEILIGUNG.has(feld) && (ort.typ !== "tabelle" || ort.je !== "beteiligung")) nicht("quelle_nicht_erlaubt", `Das Stammdatenfeld „${feld}“ gibt es nur in Tabellen je Beteiligung.`, { feld });
      if (STAMMDATEN_NUR_GRUPPE.has(feld) && (ort.typ !== "tabelle" || ort.je === "beteiligung")) nicht("quelle_nicht_erlaubt", `Das Stammdatenfeld „${feld}“ gibt es nur in Tabellen je Gruppe (nicht je Beteiligung).`, { feld });
      break;
    }
    case "berechnet":
      if (!ZAHLEN.has(f.format)) nicht("format_passt_nicht", "Ein berechneter Wert braucht ein Zahlenformat (Betrag, Zahl, Ganzzahl, Prozent).");
      if ((q.operation === "quotient" || q.operation === "anteil_prozent") && q.felder.length !== 2) nicht("zahl_operanden", "Quotient und Anteil brauchen genau zwei Felder.", { operation: q.operation });
      if ((q.operation === "differenz" || q.operation === "produkt") && q.felder.length < 2) nicht("zahl_operanden", "Differenz und Produkt brauchen mindestens zwei Felder.", { operation: q.operation });
      break;
    case "kennzahl":
      if (f.format === "text" || f.format === "datum") nicht("format_passt_nicht", "Eine Kennzahl liefert eine Zahl oder Ja/Nein, kein Datum oder Text.");
      break;
    case "vorgang":
    case "bestand":
    case "beteiligungsanzahl":
      if (!ZAHLEN.has(f.format)) nicht("format_passt_nicht", "Dieser Wert ist eine Zahl; das Format muss Betrag, Zahl, Ganzzahl oder Prozent sein.");
      break;
  }
  if (f.pflicht && ort.typ !== "felder") fehler.push({ pfad: `${pfad}.pflicht`, code: "pflicht_nur_felder", meldung: "Pflicht gilt nur für Felder in Abschnitten vom Typ „felder“; für Tabellen gibt es Regeln." });
  if (f.summe && (ort.typ !== "tabelle" || !ZAHLEN.has(f.format))) fehler.push({ pfad: `${pfad}.summe`, code: "summe_nur_zahlen", meldung: "Eine Summenzeile gibt es nur für Zahlenspalten einer Tabelle." });
}

/** Zyklen in den Verweisen der Rechenfelder: je Abschnitt vom Typ `felder` über alle Felder, je Tabelle über die Spalten. */
function findeZyklen(kanten: Map<string, string[]>, pfade: Map<string, string>, fehler: DefinitionsFehler[]) {
  const zustand = new Map<string, 1 | 2>();
  const stapel: string[] = [];
  const besuche = (knoten: string) => {
    zustand.set(knoten, 1);
    stapel.push(knoten);
    for (const ziel of kanten.get(knoten) ?? []) {
      if (!kanten.has(ziel)) continue;
      if (zustand.get(ziel) === 1) {
        const kreis = [...stapel.slice(stapel.indexOf(ziel)), ziel].map((k) => k.replace(/^.*\|/, ""));
        fehler.push({ pfad: `${pfade.get(knoten) ?? ""}.quelle.felder`, code: "zyklus", meldung: `Zyklische Verweise: ${kreis.join(" → ")}.`, params: { kreis: kreis.join(" → ") } });
      } else if (!zustand.has(ziel)) besuche(ziel);
    }
    stapel.pop();
    zustand.set(knoten, 2);
  };
  for (const k of kanten.keys()) if (!zustand.has(k)) besuche(k);
}

function pruefeStruktur(d: DefinitionInhalt): DefinitionsFehler[] {
  const fehler: DefinitionsFehler[] = [];
  const index = baueIndex(d, fehler);
  const kanten = new Map<string, string[]>();
  const pfade = new Map<string, string>();

  d.abschnitte.forEach((a, i) => {
    const basis = `abschnitte.${i}`;
    if (a.typ === "felder") {
      a.felder.forEach((f, j) => {
        const pfad = `${basis}.felder.${j}`;
        pruefeQuelle(f, { typ: "felder" }, pfad, fehler);
        if (f.quelle.art === "berechnet") {
          const knoten = `felder|${f.id}`;
          pfade.set(knoten, pfad);
          const ziele: string[] = [];
          for (const ref of f.quelle.felder) {
            const ziel = index.felder.get(ref);
            if (!ziel) fehler.push({ pfad: `${pfad}.quelle.felder`, code: "unbekannte_referenz", meldung: `Das Feld „${ref}“ gibt es nicht.`, params: { ref } });
            else if (!ZAHLEN.has(ziel.feld.format)) fehler.push({ pfad: `${pfad}.quelle.felder`, code: "format_passt_nicht", meldung: `Das Feld „${ref}“ ist keine Zahl und lässt sich nicht verrechnen.`, params: { ref } });
            else ziele.push(`felder|${ref}`);
          }
          kanten.set(knoten, ziele);
        }
      });
    } else {
      const spaltenIds = new Map(a.spalten.map((s) => [s.id, s]));
      a.spalten.forEach((s, j) => {
        const pfad = `${basis}.spalten.${j}`;
        pruefeQuelle(s, { typ: "tabelle", je: a.je }, pfad, fehler);
        if (s.quelle.art === "berechnet") {
          const knoten = `${a.id}|${s.id}`;
          pfade.set(knoten, pfad);
          const ziele: string[] = [];
          for (const ref of s.quelle.felder) {
            const ziel = spaltenIds.get(ref);
            if (!ziel) fehler.push({ pfad: `${pfad}.quelle.felder`, code: "unbekannte_referenz", meldung: `Die Spalte „${ref}“ gibt es in der Tabelle „${a.id}“ nicht.`, params: { ref } });
            else if (!ZAHLEN.has(ziel.format)) fehler.push({ pfad: `${pfad}.quelle.felder`, code: "format_passt_nicht", meldung: `Die Spalte „${ref}“ ist keine Zahl und lässt sich nicht verrechnen.`, params: { ref } });
            else ziele.push(`${a.id}|${ref}`);
          }
          kanten.set(knoten, ziele);
        }
      });
      if (a.sortierung && !spaltenIds.has(a.sortierung.spalte)) fehler.push({ pfad: `${basis}.sortierung.spalte`, code: "unbekannte_referenz", meldung: `Die Spalte „${a.sortierung.spalte}“ gibt es in der Tabelle nicht.`, params: { ref: a.sortierung.spalte } });
    }
  });
  findeZyklen(kanten, pfade, fehler);

  // Filter auf Programme: nur Schlüssel in Kleinbuchstaben (die Programme prüft die API bei der Anlage des Laufs nicht, ein unbekanntes Programm ergibt eine leere Menge).
  d.regeln.forEach((r, i) => {
    const pfad = `regeln.${i}`;
    const pruefe = (ref: string, feldname: string, zahl: boolean) => {
      const ziel = loeseVerweis(d, ref);
      if (!ziel) fehler.push({ pfad: `${pfad}.${feldname}`, code: "unbekannte_referenz", meldung: `„${ref}“ ist weder ein Feld noch die Summe einer Tabellenspalte (dafür braucht die Spalte „summe“: true).`, params: { ref } });
      else if (zahl && !ZAHLEN.has(ziel.format)) fehler.push({ pfad: `${pfad}.${feldname}`, code: "format_passt_nicht", meldung: `„${ref}“ ist keine Zahl.`, params: { ref } });
    };
    switch (r.art) {
      case "pflicht":
        r.felder.forEach((ref) => {
          if (ref.includes(".")) fehler.push({ pfad: `${pfad}.felder`, code: "unbekannte_referenz", meldung: `Pflicht gilt für Felder, nicht für Tabellenspalten („${ref}“).`, params: { ref } });
          else pruefe(ref, "felder", false);
        });
        break;
      case "bereich":
        pruefe(r.feld, "feld", true);
        if (r.minimum === undefined && r.maximum === undefined) fehler.push({ pfad, code: "bereich_leer", meldung: "Eine Bereichsregel braucht minimum oder maximum." });
        else if (r.minimum !== undefined && r.maximum !== undefined && Number(r.minimum) > Number(r.maximum)) fehler.push({ pfad, code: "bereich_leer", meldung: "Das Minimum liegt über dem Maximum." });
        break;
      case "vergleich":
        pruefe(r.links, "links", true);
        if (typeof r.rechts === "string") pruefe(r.rechts, "rechts", true);
        break;
      case "summe":
        r.summanden.forEach((ref) => pruefe(ref, "summanden", true));
        pruefe(r.gleich, "gleich", true);
        break;
    }
  });
  return fehler;
}

/** Prüft eine Definition (JSON) auf den Aufbau; Fehler tragen den Pfad im JSON, einen stabilen Code und eine deutsche Meldung. */
export function pruefeDefinition(roh: unknown): DefinitionsErgebnis {
  const ergebnis = definitionSchema.safeParse(roh);
  if (!ergebnis.success) return { ok: false, fehler: ergebnis.error.issues.map(meldungAus) };
  const fehler = pruefeStruktur(ergebnis.data);
  return fehler.length ? { ok: false, fehler } : { ok: true, definition: ergebnis.data };
}

/** Wirft mit der Meldung des ersten Fehlers; für gespeicherte Definitionen, die beim Anlegen schon geprüft wurden. */
export function ladeDefinition(roh: unknown): DefinitionInhalt {
  const e = pruefeDefinition(roh);
  if (!e.ok) throw new Error(`Meldedefinition ungültig: ${e.fehler[0]?.pfad}: ${e.fehler[0]?.meldung}`);
  return e.definition;
}

/** Alle Kennzahlschlüssel, die eine Definition liest (für die Prüfung gegen den Katalog in der API). */
export function kennzahlSchluessel(d: DefinitionInhalt): { schluessel: string; pfad: string }[] {
  const aus: { schluessel: string; pfad: string }[] = [];
  d.abschnitte.forEach((a, i) => {
    const liste = a.typ === "felder" ? a.felder : a.spalten;
    const name = a.typ === "felder" ? "felder" : "spalten";
    liste.forEach((f, j) => {
      if (f.quelle.art === "kennzahl") aus.push({ schluessel: f.quelle.schluessel, pfad: `abschnitte.${i}.${name}.${j}.quelle.schluessel` });
    });
  });
  return aus;
}

/** Alle Förderprogramm-Schlüssel, die Filter einer Definition nennen (für die Prüfung gegen die Programme in der API). */
export function programmSchluessel(d: DefinitionInhalt): { schluessel: string; pfad: string }[] {
  const aus: { schluessel: string; pfad: string }[] = [];
  const filter = (f: Filter | undefined, pfad: string) => f?.foerderprogramm?.forEach((s, i) => aus.push({ schluessel: s, pfad: `${pfad}.foerderprogramm.${i}` }));
  filter(d.filter, "filter");
  d.abschnitte.forEach((a, i) => {
    if (a.typ === "tabelle") filter(a.filter, `abschnitte.${i}.filter`);
    (a.typ === "felder" ? a.felder : a.spalten).forEach((f, j) => filter(f.filter, `abschnitte.${i}.${a.typ === "felder" ? "felder" : "spalten"}.${j}.filter`));
  });
  return aus;
}

/** Höchstlänge einer Eingabe von Hand bei Text. */
export const MAX_TEXT_EINGABE = 4000;

/**
 * Prüft eine Eingabe von Hand gegen das Format des Feldes: Zahlen, Beträge und Prozent nur als Dezimalzahl mit Punkt, Ja/Nein nur `ja` oder `nein`,
 * Datum nur `JJJJ-MM-TT`, Text höchstens {@link MAX_TEXT_EINGABE} Zeichen. `null` heißt gültig, sonst der Code des Fehlers.
 */
export function pruefeManuellenWert(format: Feldformat, wert: string): "zahl_erwartet" | "ganzzahl_erwartet" | "ja_nein_erwartet" | "datum_erwartet" | "text_zu_lang" | "leer" | null {
  if (wert.trim() === "") return "leer";
  switch (format) {
    case "betrag":
    case "zahl":
    case "prozent":
      return /^-?\d{1,18}(\.\d{1,6})?$/.test(wert) ? null : "zahl_erwartet";
    case "ganzzahl":
      return /^-?\d{1,18}$/.test(wert) ? null : "ganzzahl_erwartet";
    case "ja_nein":
      return wert === "ja" || wert === "nein" ? null : "ja_nein_erwartet";
    case "datum": {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(wert);
      if (!m) return "datum_erwartet";
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? null : "datum_erwartet";
    }
    case "text":
      return wert.length > MAX_TEXT_EINGABE ? "text_zu_lang" : null;
  }
}
