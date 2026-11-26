import ExcelJS from "exceljs";
import { Decimal } from "@carraway/rechenkern";
import { describe, expect, it } from "vitest";
import {
  anzeigeAus,
  erzeugeMeldeCsv,
  erzeugeMeldePdf,
  erzeugeMeldeXlsx,
  kennzahlSchluessel,
  ladeDefinition,
  letzterAbgeschlossenerZeitraum,
  meldeQuelle,
  meldeZeitraum,
  pruefeDefinition,
  pruefeManuellenWert,
  entschaerfe,
  pruefeRegeln,
  SCHRITT_BEZEICHNUNGEN,
  STANDARD_MELDEDEFINITIONEN,
  werteAus,
  type AuswertungsEingabe,
  type BeteiligungDaten,
  type DefinitionInhalt,
  type MeldeAusgabe,
  type Mittelart,
  type VorgangZeile,
} from "../index";

const t = (de: string, en = de) => ({ de, en });

let zaehler = 0;
const v = (art: VorgangZeile["art"], valuta: string, betrag: string, extra: Partial<VorgangZeile> = {}): VorgangZeile => ({ id: `v${++zaehler}`, art, valuta, betrag, kapitalisiert: false, storniertVorgangId: null, ...extra });

const basis: Omit<BeteiligungDaten, "id" | "organisationName" | "vorgaenge"> = {
  organisationId: "o",
  sektor: "Software",
  nace: "J",
  ort: "Musterstadt",
  sitzland: "DE",
  region: null,
  instrument: "darlehen",
  status: "aktiv",
  erstinvestment: "2026-01-10",
  programm: { schluessel: "p1", bezeichnung: "Programm Eins" },
  projektnummer: null,
  vertragsnummer: null,
  partnernummer: null,
  buchungskreis: null,
  bewertung: null,
  ausgeschieden: false,
  offeneForderungen: "0.00",
  buchwertAbgang: "0.00",
  kennzahlen: [],
};

/** Beträge ganz einer Meldeart zurechnen (der einfache Fall: eine Quote von 100 %). */
const ganz = (b: BeteiligungDaten, art: Mittelart): BeteiligungDaten => ({ ...b, vorgaenge: b.vorgaenge.map((x) => ({ ...x, anteile: { [art]: x.betrag } })) });

function beteiligungen(): BeteiligungDaten[] {
  zaehler = 0;
  const storniert = v("auszahlung", "2026-08-02", "10000.00");
  const alle: BeteiligungDaten[] = [
    {
      ...basis,
      id: "b1",
      organisationName: "Alpha GmbH",
      projektnummer: "P-001",
      vorgaenge: [v("zusage", "2026-01-10", "100000.00"), v("auszahlung", "2026-02-01", "60000.00"), v("auszahlung", "2026-08-15", "20000.00"), v("zins", "2026-09-30", "1000.00", { kapitalisiert: true }), v("tilgung", "2026-09-01", "5000.00")],
      kennzahlen: [
        { id: "k1", schluessel: "umsatz", szenario: "ist", periodeBeginn: "2026-07-01", periodeEnde: "2026-09-30", wert: "400000" },
        { id: "k2", schluessel: "mitarbeitende_vzae", szenario: "ist", periodeBeginn: "2026-01-01", periodeEnde: "2026-03-31", wert: "10" },
        { id: "k3", schluessel: "mitarbeitende_vzae", szenario: "ist", periodeBeginn: "2026-04-01", periodeEnde: "2026-06-30", wert: "12" },
      ],
    },
    {
      ...basis,
      id: "b2",
      organisationName: "Beta AG",
      instrument: "offene_beteiligung",
      erstinvestment: "2026-03-01",
      bewertung: { wert: "70000.00", stichtag: "2026-06-30" },
      vorgaenge: [v("zusage", "2026-03-01", "50000.00"), v("auszahlung", "2026-08-01", "50000.00"), storniert, v("auszahlung", "2026-08-03", "-10000.00", { storniertVorgangId: storniert.id })],
      kennzahlen: [
        { id: "k4", schluessel: "umsatz", szenario: "ist", periodeBeginn: "2026-07-01", periodeEnde: "2026-07-31", wert: "10000" },
        { id: "k5", schluessel: "umsatz", szenario: "ist", periodeBeginn: "2026-08-01", periodeEnde: "2026-08-31", wert: "20000" },
        { id: "k6", schluessel: "mitarbeitende_vzae", szenario: "ist", periodeBeginn: "2026-04-01", periodeEnde: "2026-06-30", wert: "30" },
      ],
    },
    {
      ...basis,
      id: "b3",
      organisationName: "Gamma KG",
      instrument: "stille_beteiligung",
      programm: null,
      sitzland: "AT",
      region: "Tirol",
      erstinvestment: "2026-09-15",
      status: "exit",
      ausgeschieden: true,
      bewertung: { wert: "5000.00", stichtag: "2026-06-30" },
      vorgaenge: [v("zusage", "2026-09-15", "30000.00"), v("auszahlung", "2026-09-20", "30000.00"), v("rueckfluss", "2026-09-25", "10000.00"), v("wertberichtigung", "2026-09-28", "2000.00"), v("auszahlung", "2026-10-05", "999.00")],
    },
  ];
  // Alpha: ganz Fördermittel, Beta: ganz Kofinanzierung, Gamma: Fonds ohne Mittelarten (keine Anteile)
  return [ganz(alle[0]!, "foerdermittel"), ganz(alle[1]!, "kofinanzierung"), alle[2]!];
}

const feld = (id: string, quelle: object, extra: object = {}) => ({ id, bezeichnung: t(id), format: "betrag", quelle, ...extra });
const def = (abschnitte: object[], regeln: object[] = [], extra: object = {}) => ({ schema: 1, abschnitte, regeln, ...extra });

function eingabe(definition: DefinitionInhalt, extra: Partial<AuswertungsEingabe> = {}): AuswertungsEingabe {
  return {
    definition,
    fonds: { name: "Beispielfonds", kurzname: "BF", vintage: 2024, zeichnungskapital: "1000000.00", waehrung: "EUR", bewegungen: [] },
    programm: null,
    periode: { beginn: "2026-07-01", ende: "2026-09-30", kennung: "2026-Q3" },
    beteiligungen: beteiligungen(),
    programme: [{ schluessel: "p1", bezeichnung: "Programm Eins" }],
    kennzahlVerdichtung: { umsatz: "summe", mitarbeitende_vzae: "stand" },
    manuell: {},
    ...extra,
  };
}

const ok = (roh: unknown): DefinitionInhalt => {
  const e = pruefeDefinition(roh);
  if (!e.ok) throw new Error(JSON.stringify(e.fehler));
  return e.definition;
};
const wertVon = (a: ReturnType<typeof werteAus>, schluessel: string) => a.werte.find((w) => w.schluessel === schluessel)?.wert;

describe("Definition: Aufbau und Prüfung", () => {
  it("die mitgelieferten Definitionen sind gültig und als Vorlage gekennzeichnet", () => {
    expect(STANDARD_MELDEDEFINITIONEN.map((d) => d.schluessel)).toEqual(["foerderbericht_quartal", "efre_indikatoren", "bundesbank_beteiligungsbestand"]);
    for (const d of STANDARD_MELDEDEFINITIONEN) {
      const e = pruefeDefinition(d.definition);
      expect(e.ok, JSON.stringify(e.ok ? [] : e.fehler)).toBe(true);
      expect(d.definition.hinweis?.de).toContain("fachlich zu prüfen");
      expect(d.bezeichnungDe).toMatch(/Vorlage|Strukturvorbereitung/);
    }
  });

  it("die EFRE-Vorlage nennt keine RCO- oder RCR-Codes, nur Platzhalter", () => {
    const efre = JSON.stringify(STANDARD_MELDEDEFINITIONEN.find((d) => d.schluessel === "efre_indikatoren")!.definition);
    expect(efre).not.toMatch(/RC[OR] ?\d/);
    expect(efre).toContain("nicht hinterlegt");
    expect(efre).toContain("Anhang XVII");
  });

  it("EFRE-Vorlage: SAFE und Optionsscheine zählen zum Beteiligungskapital, nicht zu den Darlehen", () => {
    const efre = STANDARD_MELDEDEFINITIONEN.find((d) => d.schluessel === "efre_indikatoren")!.definition;
    const finde = (knoten: unknown, id: string): { filter?: { instrument?: string[] } } | null => {
      if (Array.isArray(knoten)) return knoten.map((k) => finde(k, id)).find((x) => x !== null) ?? null;
      if (knoten && typeof knoten === "object") {
        if ((knoten as { id?: unknown }).id === id) return knoten as { filter?: { instrument?: string[] } };
        return Object.values(knoten).map((k) => finde(k, id)).find((x) => x !== null) ?? null;
      }
      return null;
    };
    expect(finde(efre, "ind_output_eigenkapital")?.filter?.instrument).toEqual(["offene_beteiligung", "stille_beteiligung", "safe", "optionsschein"]);
    expect(finde(efre, "ind_output_darlehen")?.filter?.instrument).toEqual(["darlehen", "wandeldarlehen"]);
  });

  it("ein Schema mit unbekannter Quelle wird mit Pfad und Meldung abgelehnt", () => {
    const e = pruefeDefinition(def([{ id: "a", typ: "felder", titel: t("A"), felder: [feld("x", { art: "orakel" })] }]));
    expect(e.ok).toBe(false);
    if (e.ok) return;
    expect(e.fehler[0]!.pfad).toBe("abschnitte.0.felder.0.quelle.art");
    expect(e.fehler[0]!.code).toBe("art_unbekannt");
  });

  it("falsche Werte nennen die erlaubten Werte und unbekannte Angaben werden benannt", () => {
    const e = pruefeDefinition(def([{ id: "a", typ: "felder", titel: t("A"), felder: [feld("x", { art: "bestand", groesse: "gewinn" }, { farbe: "rot" })] }]));
    expect(e.ok).toBe(false);
    if (e.ok) return;
    const codes = e.fehler.map((f) => `${f.pfad}:${f.code}`);
    expect(codes).toContain("abschnitte.0.felder.0.quelle.groesse:wert_nicht_erlaubt");
    expect(codes).toContain("abschnitte.0.felder.0:unbekanntes_feld");
    expect(e.fehler.find((f) => f.code === "wert_nicht_erlaubt")!.meldung).toContain("zusage");
  });

  it("ungültige Bezeichner, leere Abschnitte und fehlende Texte werden gemeldet", () => {
    const e = pruefeDefinition({ schema: 1, abschnitte: [{ id: "A-1", typ: "felder", titel: { de: "" }, felder: [] }] });
    expect(e.ok).toBe(false);
  });

  it("doppelte Bezeichner und unbekannte Verweise werden gemeldet", () => {
    const e = pruefeDefinition(
      def(
        [
          { id: "a", typ: "felder", titel: t("A"), felder: [feld("x", { art: "manuell" }), feld("x", { art: "manuell" }), feld("y", { art: "berechnet", operation: "summe", felder: ["x", "gibtesnicht"] })] },
          { id: "a", typ: "felder", titel: t("A2"), felder: [feld("z", { art: "manuell" })] },
        ],
        [{ id: "r", art: "pflicht", schwere: "fehler", felder: ["nirgends"], meldung: t("m") }],
      ),
    );
    expect(e.ok).toBe(false);
    if (e.ok) return;
    const codes = e.fehler.map((f) => f.code);
    expect(codes.filter((c) => c === "doppelte_id").length).toBe(2);
    expect(codes.filter((c) => c === "unbekannte_referenz").length).toBe(2);
  });

  it("zyklische Rechenfelder werden erkannt, auch über mehrere Felder", () => {
    const e = pruefeDefinition(
      def([
        {
          id: "a",
          typ: "felder",
          titel: t("A"),
          felder: [feld("x", { art: "berechnet", operation: "summe", felder: ["y"] }), feld("y", { art: "berechnet", operation: "summe", felder: ["z"] }), feld("z", { art: "berechnet", operation: "summe", felder: ["x"] })],
        },
      ]),
    );
    expect(e.ok).toBe(false);
    if (e.ok) return;
    const zyklus = e.fehler.find((f) => f.code === "zyklus")!;
    expect(zyklus.meldung).toMatch(/→/);
  });

  it("ein Feld, das auf sich selbst verweist, ist ein Zyklus; in Tabellen zählt dasselbe je Spalte", () => {
    const selbst = pruefeDefinition(def([{ id: "a", typ: "felder", titel: t("A"), felder: [feld("x", { art: "berechnet", operation: "summe", felder: ["x"] })] }]));
    expect(selbst.ok).toBe(false);
    const tabelle = pruefeDefinition(
      def([{ id: "t", typ: "tabelle", titel: t("T"), je: "beteiligung", spalten: [feld("s1", { art: "berechnet", operation: "summe", felder: ["s2"] }), feld("s2", { art: "berechnet", operation: "summe", felder: ["s1"] })] }]),
    );
    expect(tabelle.ok).toBe(false);
    if (!tabelle.ok) expect(tabelle.fehler.some((f) => f.code === "zyklus")).toBe(true);
  });

  it("Quellen sind nur dort erlaubt, wo sie Sinn haben", () => {
    const e = pruefeDefinition(
      def([
        {
          id: "a",
          typ: "felder",
          titel: t("A"),
          felder: [feld("p", { art: "schluessel", feld: "projektnummer" }, { format: "text" }), feld("o", { art: "stammdaten", feld: "organisation.name" }, { format: "text" }), feld("f", { art: "fondsbewegung", bewegung: "abruf", zeitraum: "periode" }, { filter: { status: ["aktiv"] } })],
        },
        { id: "t", typ: "tabelle", titel: t("T"), je: "programm", spalten: [feld("m", { art: "manuell" }), feld("g", { art: "stammdaten", feld: "organisation.name" }, { format: "text" })] },
      ]),
    );
    expect(e.ok).toBe(false);
    if (e.ok) return;
    expect(e.fehler.filter((f) => f.code === "quelle_nicht_erlaubt").length).toBe(4);
    expect(e.fehler.some((f) => f.code === "filter_nicht_erlaubt")).toBe(true);
  });

  it("Formate müssen zur Quelle passen und Pflicht gilt nur für Felder", () => {
    const e = pruefeDefinition(
      def([
        { id: "a", typ: "felder", titel: t("A"), felder: [feld("x", { art: "bestand", groesse: "zusage" }, { format: "text" }), feld("k", { art: "kennzahl", schluessel: "umsatz" }, { format: "datum" })] },
        { id: "t", typ: "tabelle", titel: t("T"), je: "beteiligung", spalten: [feld("s", { art: "bestand", groesse: "zusage" }, { pflicht: true })] },
      ]),
    );
    expect(e.ok).toBe(false);
    if (e.ok) return;
    expect(e.fehler.filter((f) => f.code === "format_passt_nicht").length).toBe(2);
    expect(e.fehler.some((f) => f.code === "pflicht_nur_felder")).toBe(true);
  });

  it("Regeln brauchen gültige Ziele; Spaltensummen nur mit summe: true", () => {
    const abschnitte = [
      { id: "a", typ: "felder", titel: t("A"), felder: [feld("x", { art: "manuell" })] },
      { id: "t", typ: "tabelle", titel: t("T"), je: "beteiligung", spalten: [feld("s", { art: "bestand", groesse: "zusage" }), feld("u", { art: "bestand", groesse: "zusage" }, { summe: true })] },
    ];
    const e = pruefeDefinition(
      def(abschnitte, [
        { id: "r1", art: "vergleich", schwere: "fehler", links: "t.s", operator: "=", rechts: "x", meldung: t("m") },
        { id: "r2", art: "vergleich", schwere: "fehler", links: "t.u", operator: "=", rechts: { wert: "1" }, meldung: t("m") },
        { id: "r3", art: "bereich", schwere: "fehler", feld: "x", meldung: t("m") },
        { id: "r4", art: "bereich", schwere: "fehler", feld: "x", minimum: "5", maximum: "1", meldung: t("m") },
      ]),
    );
    expect(e.ok).toBe(false);
    if (e.ok) return;
    expect(e.fehler.filter((f) => f.code === "unbekannte_referenz").length).toBe(1);
    expect(e.fehler.filter((f) => f.code === "bereich_leer").length).toBe(2);
  });

  it("ladeDefinition wirft bei ungültigem JSON, kennzahlSchluessel nennt alle gelesenen Kennzahlen mit Pfad", () => {
    expect(() => ladeDefinition({ schema: 2 })).toThrow(/ungültig/);
    const d = STANDARD_MELDEDEFINITIONEN.find((x) => x.schluessel === "efre_indikatoren")!.definition;
    const liste = kennzahlSchluessel(d);
    expect(liste.map((k) => k.schluessel).sort()).toEqual(["mitarbeitende_vzae", "umsatz"]);
    expect(liste[0]!.pfad).toMatch(/^abschnitte\.\d+\.felder\.\d+\.quelle\.schluessel$/);
  });
});

describe("Berichtszeitraum", () => {
  it("Quartal, Halbjahr, Jahr und Stichtag", () => {
    expect(meldeZeitraum("quartal", { jahr: 2026, nummer: 3 })).toEqual({ beginn: "2026-07-01", ende: "2026-09-30", kennung: "2026-Q3" });
    expect(meldeZeitraum("quartal", { jahr: 2024, nummer: 1 })).toEqual({ beginn: "2024-01-01", ende: "2024-03-31", kennung: "2024-Q1" });
    expect(meldeZeitraum("halbjahr", { jahr: 2026, nummer: 2 })).toEqual({ beginn: "2026-07-01", ende: "2026-12-31", kennung: "2026-H2" });
    expect(meldeZeitraum("jahr", { jahr: 2026 })).toEqual({ beginn: "2026-01-01", ende: "2026-12-31", kennung: "2026" });
    expect(meldeZeitraum("stichtag", { stichtag: "2026-09-30" })).toEqual({ beginn: "2026-09-30", ende: "2026-09-30", kennung: "2026-09-30" });
    expect(meldeZeitraum("quartal", { jahr: 2026, nummer: 5 })).toBeNull();
    expect(meldeZeitraum("quartal", { jahr: 2026 })).toBeNull();
    expect(meldeZeitraum("jahr", { jahr: 2026, nummer: 1 })).toBeNull();
    expect(meldeZeitraum("stichtag", { stichtag: "2026-02-30" })).toBeNull();
  });

  it("der letzte abgeschlossene Zeitraum zu einem Datum", () => {
    expect(letzterAbgeschlossenerZeitraum("quartal", "2026-11-20").kennung).toBe("2026-Q3");
    expect(letzterAbgeschlossenerZeitraum("quartal", "2026-01-05").kennung).toBe("2025-Q4");
    expect(letzterAbgeschlossenerZeitraum("halbjahr", "2026-11-20").kennung).toBe("2026-H1");
    expect(letzterAbgeschlossenerZeitraum("jahr", "2026-11-20").kennung).toBe("2025");
  });
});

describe("Auswertung: Quellen gegen von Hand gerechnete Werte", () => {
  const abschnitt = (felder: object[]) => [{ id: "a", typ: "felder", titel: t("A"), felder }];

  it("Vorgangssummen nach Art und Zeitraum, mit Storno, Anzahl und Vorzeichen", () => {
    const d = ok(
      def(
        abschnitt([
          feld("auszahlung_q3", { art: "vorgang", vorgangsarten: ["auszahlung"], zeitraum: "periode" }),
          feld("auszahlung_kum", { art: "vorgang", vorgangsarten: ["auszahlung"], zeitraum: "kumuliert" }),
          feld("zusage_q3", { art: "vorgang", vorgangsarten: ["zusage"], zeitraum: "periode" }),
          feld("rueck_q3", { art: "vorgang", vorgangsarten: ["rueckfluss", "tilgung"], zeitraum: "periode" }),
          feld("anzahl_auszahlungen", { art: "vorgang", vorgangsarten: ["auszahlung"], zeitraum: "periode", aggregation: "anzahl" }, { format: "ganzzahl" }),
          feld("negiert", { art: "vorgang", vorgangsarten: ["tilgung"], zeitraum: "kumuliert", negieren: true }),
        ]),
      ),
    );
    const a = werteAus(eingabe(d));
    // Q3: b1 20000 + b2 (50000 + 10000 − 10000) + b3 30000; die Auszahlung vom 05.10. liegt nach dem Zeitraum
    expect(wertVon(a, "a.auszahlung_q3")).toBe("100000.00");
    expect(wertVon(a, "a.auszahlung_kum")).toBe("160000.00"); // 60000 + 20000 + 50000 + 30000
    expect(wertVon(a, "a.zusage_q3")).toBe("30000.00");
    expect(wertVon(a, "a.rueck_q3")).toBe("15000.00"); // 5000 Tilgung + 10000 Rückfluss
    // gültige Auszahlungen im Zeitraum: b1 eine, b2 eine (das Paar aus Original und Storno zählt nicht), b3 eine
    expect(wertVon(a, "a.anzahl_auszahlungen")).toBe("3");
    expect(wertVon(a, "a.negiert")).toBe("-5000.00");
    const h = a.werte.find((w) => w.schluessel === "a.auszahlung_q3")!.herkunft!;
    expect(h.beteiligungen.sort()).toEqual(["b1", "b2", "b3"]);
    expect(h.vorgaenge.length).toBe(5); // b1 eine, b2 drei (Original, Storno und die gültige), b3 eine
  });

  it("Bestand: Zusage, investiert, Rückflüsse, offene Zusage, Buchwert und Bewertung", () => {
    const d = ok(
      def(
        abschnitt([
          feld("zusage", { art: "bestand", groesse: "zusage" }),
          feld("investiert", { art: "bestand", groesse: "investiert" }),
          feld("rueckfluesse", { art: "bestand", groesse: "rueckfluesse" }),
          feld("offen", { art: "bestand", groesse: "offene_zusage" }),
          feld("buchwert", { art: "bestand", groesse: "buchwert" }),
          feld("bewertung", { art: "bestand", groesse: "bewertung" }),
        ]),
      ),
    );
    const daten = beteiligungen();
    daten[0]!.buchwertAbgang = "1000.00";
    daten[2]!.offeneForderungen = "300.00";
    const a = werteAus(eingabe(d, { beteiligungen: daten }));
    expect(wertVon(a, "a.zusage")).toBe("180000.00");
    expect(wertVon(a, "a.investiert")).toBe("160000.00");
    expect(wertVon(a, "a.rueckfluesse")).toBe("15000.00");
    expect(wertVon(a, "a.offen")).toBe("20000.00");
    // Buchwert = 160000 investiert + 1000 kapitalisierte Zinsen − 5000 Tilgung − 2000 Wertberichtigung − 1000 Abgang
    expect(wertVon(a, "a.buchwert")).toBe("153000.00");
    // Wertansatz: b2 70000; b3 ist ausgeschieden (zählt 0) und hat nur die offene Forderung 300
    expect(wertVon(a, "a.bewertung")).toBe("70300.00");
  });

  it("Buchungen einer Wandlung ohne Geldfluss zählen nicht zu Auszahlung, Rückfluss, Zusage und Investiert, wohl aber zum Buchwert; der Spitzenbetrag zählt", () => {
    const d = ok(
      def(
        abschnitt([
          feld("zusage", { art: "bestand", groesse: "zusage" }),
          feld("investiert", { art: "bestand", groesse: "investiert" }),
          feld("rueckfluesse", { art: "bestand", groesse: "rueckfluesse" }),
          feld("offen", { art: "bestand", groesse: "offene_zusage" }),
          feld("buchwert", { art: "bestand", groesse: "buchwert" }),
          feld("auszahlung_kum", { art: "vorgang", vorgangsarten: ["auszahlung"], zeitraum: "kumuliert" }),
          feld("rueck_kum", { art: "vorgang", vorgangsarten: ["rueckfluss", "tilgung"], zeitraum: "kumuliert" }),
        ]),
      ),
    );
    const daten = beteiligungen();
    daten[0]!.buchwertAbgang = "1000.00";
    const vorher = werteAus(eingabe(d, { beteiligungen: structuredClone(daten) }));
    daten[0]!.vorgaenge.push(
      v("tilgung", "2026-09-01", "400.00", { ohneGeldfluss: true }),
      v("tilgung", "2026-09-01", "7.00"),
      v("zusage", "2026-09-01", "400.00", { ohneGeldfluss: true }),
      v("auszahlung", "2026-09-01", "400.00", { ohneGeldfluss: true }),
    );
    const a = werteAus(eingabe(d, { beteiligungen: daten }));
    expect(wertVon(a, "a.zusage")).toBe(wertVon(vorher, "a.zusage"));
    expect(wertVon(a, "a.investiert")).toBe(wertVon(vorher, "a.investiert"));
    expect(wertVon(a, "a.offen")).toBe(wertVon(vorher, "a.offen"));
    expect(wertVon(a, "a.auszahlung_kum")).toBe(wertVon(vorher, "a.auszahlung_kum"));
    // nur der Spitzenbetrag (7) kommt zu den Rückflüssen
    expect(wertVon(a, "a.rueckfluesse")).toBe("15007.00");
    expect(wertVon(a, "a.rueck_kum")).toBe(new Decimal(wertVon(vorher, "a.rueck_kum")!).plus(7).toFixed(2));
    // Buchwert nach der Buchwertregel mit allen Buchungen: 160400 + 1000 − 5407 − 2000 − 1000
    expect(wertVon(a, "a.buchwert")).toBe("152993.00");
  });

  it("Bewertung ohne jede Bewertung ist k. A., nicht 0", () => {
    const d = ok(def(abschnitt([feld("bewertung", { art: "bestand", groesse: "bewertung" })])));
    const daten = beteiligungen().map((b) => ({ ...b, bewertung: null }));
    const a = werteAus(eingabe(d, { beteiligungen: daten }));
    expect(wertVon(a, "a.bewertung")).toBeNull();
  });

  it("Beteiligungsanzahl im Bestand und neu im Zeitraum", () => {
    const d = ok(def(abschnitt([feld("bestand", { art: "beteiligungsanzahl" }, { format: "ganzzahl" }), feld("neu", { art: "beteiligungsanzahl", umfang: "neu" }, { format: "ganzzahl" })])));
    const a = werteAus(eingabe(d));
    expect(wertVon(a, "a.bestand")).toBe("3");
    expect(wertVon(a, "a.neu")).toBe("1"); // nur b3 hat sein Erstinvestment im Q3
  });

  it("Kennzahl: Zeitraum, Verdichtung feiner Werte, letzter Wert, Aggregation und Beteiligungen ohne Wert", () => {
    const d = ok(
      def(
        abschnitt([
          feld("umsatz_summe", { art: "kennzahl", schluessel: "umsatz" }),
          feld("umsatz_schnitt", { art: "kennzahl", schluessel: "umsatz", aggregation: "durchschnitt" }),
          feld("umsatz_max", { art: "kennzahl", schluessel: "umsatz", aggregation: "maximum" }),
          feld("umsatz_min", { art: "kennzahl", schluessel: "umsatz", aggregation: "minimum" }),
          feld("umsatz_anzahl", { art: "kennzahl", schluessel: "umsatz", aggregation: "anzahl" }, { format: "ganzzahl" }),
          feld("vzae_letzter", { art: "kennzahl", schluessel: "mitarbeitende_vzae", zeitraum: "letzter" }, { format: "zahl" }),
          feld("vzae_periode", { art: "kennzahl", schluessel: "mitarbeitende_vzae", zeitraum: "periode" }, { format: "zahl" }),
          feld("plan", { art: "kennzahl", schluessel: "umsatz", szenario: "plan" }),
        ]),
      ),
    );
    const a = werteAus(eingabe(d));
    // b1: 400000 (Quartal); b2: Monate 10000 + 20000 nach Katalog „Summe“ = 30000; b3: kein Wert
    expect(wertVon(a, "a.umsatz_summe")).toBe("430000.00");
    expect(wertVon(a, "a.umsatz_schnitt")).toBe("215000.00");
    expect(wertVon(a, "a.umsatz_max")).toBe("400000.00");
    expect(wertVon(a, "a.umsatz_min")).toBe("30000.00");
    expect(wertVon(a, "a.umsatz_anzahl")).toBe("2");
    // letzter bestätigter Zeitraum bis 30.09.: b1 12 (Q2), b2 30 (Q2); Summe 42
    expect(wertVon(a, "a.vzae_letzter")).toBe("42");
    // im Q3 gibt es keine VZÄ-Werte: k. A.
    expect(wertVon(a, "a.vzae_periode")).toBeNull();
    expect(wertVon(a, "a.plan")).toBeNull();
    const h = a.werte.find((w) => w.schluessel === "a.umsatz_summe")!.herkunft!;
    expect(h.kennzahlWerte.sort()).toEqual(["k1", "k4", "k5"]);
    expect(h.schritte.find((s) => s.bezeichnung === "Beteiligungen ohne Wert, nicht gezählt (Anzahl)")!.wert).toBe("1");
  });

  it("Kennzahl mit Ja/Nein zählt nur Anzahl und Anzahl Ja; Zahlenaggregationen übergehen Text", () => {
    const daten = beteiligungen();
    daten[0]!.kennzahlen.push({ id: "j1", schluessel: "esg_verstoesse_ungc", szenario: "ist", periodeBeginn: "2026-01-01", periodeEnde: "2026-12-31", wert: "ja" });
    daten[1]!.kennzahlen.push({ id: "j2", schluessel: "esg_verstoesse_ungc", szenario: "ist", periodeBeginn: "2026-01-01", periodeEnde: "2026-12-31", wert: "nein" });
    const d = ok(
      def(
        abschnitt([
          feld("ja", { art: "kennzahl", schluessel: "esg_verstoesse_ungc", aggregation: "anzahl_ja" }, { format: "ganzzahl" }),
          feld("alle", { art: "kennzahl", schluessel: "esg_verstoesse_ungc", aggregation: "anzahl" }, { format: "ganzzahl" }),
          feld("summe", { art: "kennzahl", schluessel: "esg_verstoesse_ungc", aggregation: "summe" }, { format: "zahl" }),
        ]),
      ),
    );
    const a = werteAus(eingabe(d, { beteiligungen: daten, periode: { beginn: "2026-01-01", ende: "2026-12-31", kennung: "2026" } }));
    expect(wertVon(a, "a.ja")).toBe("1");
    expect(wertVon(a, "a.alle")).toBe("2");
    expect(wertVon(a, "a.summe")).toBeNull();
  });

  it("Fondsbewegungen, Stammdaten und Programm des Laufs", () => {
    const d = ok(
      def(
        abschnitt([
          feld("abruf_q3", { art: "fondsbewegung", bewegung: "abruf", zeitraum: "periode" }),
          feld("abruf_kum", { art: "fondsbewegung", bewegung: "abruf", zeitraum: "kumuliert" }),
          feld("aus_q3", { art: "fondsbewegung", bewegung: "ausschuettung", zeitraum: "periode" }),
          feld("name", { art: "stammdaten", feld: "fonds.name" }, { format: "text" }),
          feld("vintage", { art: "stammdaten", feld: "fonds.vintage" }, { format: "ganzzahl" }),
          feld("programm", { art: "stammdaten", feld: "programm.bezeichnung" }, { format: "text" }),
          feld("beginn", { art: "stammdaten", feld: "periode.beginn" }, { format: "datum" }),
        ]),
      ),
    );
    const fonds = { name: "Beispielfonds", kurzname: "BF", vintage: 2024, zeichnungskapital: "1000000.00", waehrung: "EUR", bewegungen: [
      { id: "m1", art: "abruf" as const, valuta: "2026-02-01", betrag: "100000.00" },
      { id: "m2", art: "abruf" as const, valuta: "2026-08-01", betrag: "50000.00" },
      { id: "m3", art: "ausschuettung" as const, valuta: "2026-09-01", betrag: "7000.00" },
      { id: "m4", art: "abruf" as const, valuta: "2026-10-01", betrag: "999.00" },
    ] };
    const a = werteAus(eingabe(d, { fonds, programm: { schluessel: "p1", bezeichnung: "Programm Eins" } }));
    expect(wertVon(a, "a.abruf_q3")).toBe("50000.00");
    expect(wertVon(a, "a.abruf_kum")).toBe("150000.00");
    expect(wertVon(a, "a.aus_q3")).toBe("7000.00");
    expect(wertVon(a, "a.name")).toBe("Beispielfonds");
    expect(wertVon(a, "a.vintage")).toBe("2024");
    expect(wertVon(a, "a.programm")).toBe("Programm Eins");
    expect(wertVon(a, "a.beginn")).toBe("2026-07-01");
    expect(a.werte.find((w) => w.schluessel === "a.abruf_kum")!.herkunft!.bewegungen).toEqual(["m1", "m2"]);
    const ohne = werteAus(eingabe(d, { fonds }));
    expect(wertVon(ohne, "a.programm")).toBeNull();
  });

  it("Rechenfelder: Reihenfolge unabhängig, k. A. bei fehlendem Operanden, Division durch null", () => {
    const d = ok(
      def(
        abschnitt([
          feld("rest", { art: "berechnet", operation: "differenz", felder: ["zeichnung", "gesamt"] }),
          feld("zeichnung", { art: "stammdaten", feld: "fonds.zeichnungskapital" }),
          feld("gesamt", { art: "bestand", groesse: "investiert" }),
          feld("quote", { art: "berechnet", operation: "anteil_prozent", felder: ["gesamt", "zeichnung"] }, { format: "prozent" }),
          feld("ohne", { art: "kennzahl", schluessel: "umsatz", szenario: "plan" }),
          feld("fehlt", { art: "berechnet", operation: "summe", felder: ["ohne", "gesamt"] }),
          feld("null", { art: "berechnet", operation: "quotient", felder: ["gesamt", "nullwert"] }, { format: "zahl" }),
          feld("nullwert", { art: "vorgang", vorgangsarten: ["zins"], zeitraum: "periode" }, { filter: { sitzland: ["AT"] } }),
          feld("produkt", { art: "berechnet", operation: "produkt", felder: ["gesamt", "nullwert"] }),
        ]),
      ),
    );
    const a = werteAus(eingabe(d));
    expect(wertVon(a, "a.rest")).toBe("840000.00");
    expect(wertVon(a, "a.quote")).toBe("16");
    expect(wertVon(a, "a.fehlt")).toBeNull();
    expect(wertVon(a, "a.null")).toBeNull();
    expect(wertVon(a, "a.produkt")).toBe("0.00");
    expect(a.werte.find((w) => w.schluessel === "a.rest")!.herkunft!.operanden).toEqual([
      { ref: "zeichnung", wert: "1000000.00" },
      { ref: "gesamt", wert: "160000.00" },
    ]);
  });

  it("manuelle Eingaben kommen aus der Eingabe; ohne Eingabe ist der Wert k. A.", () => {
    const d = ok(def(abschnitt([feld("hand", { art: "manuell" }, { format: "text" }), feld("zahl", { art: "manuell" })])));
    const a = werteAus(eingabe(d, { manuell: { "a.hand": "Text" } }));
    expect(wertVon(a, "a.hand")).toBe("Text");
    expect(a.werte.find((w) => w.schluessel === "a.hand")!.manuell).toBe(true);
    expect(wertVon(a, "a.zahl")).toBeNull();
  });

  it("Schlüsselfelder und Stammdaten der Beteiligung in Tabellen je Beteiligung", () => {
    const d = ok(
      def([
        {
          id: "t",
          typ: "tabelle",
          titel: t("T"),
          je: "beteiligung",
          spalten: [
            feld("projekt", { art: "schluessel", feld: "projektnummer" }, { format: "text" }),
            feld("name", { art: "stammdaten", feld: "organisation.name" }, { format: "text" }),
            feld("land", { art: "stammdaten", feld: "organisation.sitzland" }, { format: "text" }),
            feld("region", { art: "stammdaten", feld: "organisation.region" }, { format: "text" }),
            feld("programm", { art: "stammdaten", feld: "foerderung.programm" }, { format: "text" }),
          ],
        },
      ]),
    );
    const a = werteAus(eingabe(d));
    expect(a.abschnitte[0]!.typ === "tabelle" && a.abschnitte[0]!.zeilen.map((z) => z.zellen.name!.wert)).toEqual(["Alpha GmbH", "Beta AG", "Gamma KG"]);
    expect(wertVon(a, "t.b1.projekt")).toBe("P-001");
    expect(wertVon(a, "t.b2.projekt")).toBeNull();
    expect(wertVon(a, "t.b3.land")).toBe("AT");
    expect(wertVon(a, "t.b3.region")).toBe("Tirol");
    expect(wertVon(a, "t.b3.programm")).toBeNull();
    expect(wertVon(a, "t.b1.programm")).toBe("p1");
  });
});

describe("Auswertung: Filter, Gruppen, Summenzeilen", () => {
  const feldMitFilter = (filter: object) => def([{ id: "a", typ: "felder", titel: t("A"), felder: [feld("anzahl", { art: "beteiligungsanzahl" }, { format: "ganzzahl", filter }), feld("investiert", { art: "bestand", groesse: "investiert" }, { filter })] }]);

  it.each([
    ["Förderprogramm", { foerderprogramm: ["p1"] }, "2", "130000.00"],
    ["Mittelart", { mittelart: ["kofinanzierung"] }, "1", "50000.00"],
    ["Instrument", { instrument: ["darlehen", "stille_beteiligung"] }, "2", "110000.00"],
    ["Sitzland", { sitzland: ["AT"] }, "1", "30000.00"],
    ["Region", { region: ["Tirol"] }, "1", "30000.00"],
    ["Branche", { branche: ["Software"] }, "3", "160000.00"],
    ["NACE-Abschnitt", { nace: ["J"] }, "3", "160000.00"],
    ["anderer NACE-Abschnitt", { nace: ["C"] }, "0", "0.00"],
    ["Status", { status: ["exit"] }, "1", "30000.00"],
    ["kombiniert", { foerderprogramm: ["p1"], instrument: ["darlehen"] }, "1", "80000.00"],
    ["unbekanntes Programm", { foerderprogramm: ["xx"] }, "0", "0.00"],
  ])("Filter %s", (_n, filter, anzahl, investiert) => {
    const a = werteAus(eingabe(ok(feldMitFilter(filter))));
    expect(wertVon(a, "a.anzahl")).toBe(anzahl);
    expect(wertVon(a, "a.investiert")).toBe(investiert);
  });

  it("Filter von Lauf, Definition, Abschnitt und Feld wirken gemeinsam und stehen in der Herkunft", () => {
    const d = ok(def([{ id: "a", typ: "felder", titel: t("A"), felder: [feld("x", { art: "bestand", groesse: "investiert" }, { filter: { instrument: ["darlehen"] } })] }], [], { filter: { sitzland: ["DE"] } }));
    const a = werteAus(eingabe(d, { programm: { schluessel: "p1", bezeichnung: "Programm Eins" } }));
    expect(wertVon(a, "a.x")).toBe("80000.00");
    expect(a.werte[0]!.herkunft!.filter).toEqual([{ foerderprogramm: ["p1"] }, { sitzland: ["DE"] }, { instrument: ["darlehen"] }]);
  });

  it("Tabelle je Programm: Gruppe ohne Zuordnung zuletzt, Summenzeile und Zeilenbeschriftung", () => {
    const d = ok(
      def([
        {
          id: "t",
          typ: "tabelle",
          titel: t("T"),
          je: "programm",
          spalten: [feld("name", { art: "stammdaten", feld: "gruppe.bezeichnung" }, { format: "text" }), feld("anzahl", { art: "beteiligungsanzahl" }, { format: "ganzzahl", summe: true }), feld("investiert", { art: "bestand", groesse: "investiert" }, { summe: true })],
        },
      ]),
    );
    const a = werteAus(eingabe(d));
    const tab = a.abschnitte[0]!;
    if (tab.typ !== "tabelle") throw new Error("Tabelle erwartet");
    expect(tab.zeilen.map((z) => z.schluessel)).toEqual(["p1", "_ohne"]);
    expect(tab.zeilen[1]!.gruppeOhne).toBe(true);
    expect(wertVon(a, "t.p1.name")).toBe("Programm Eins");
    expect(wertVon(a, "t.p1.investiert")).toBe("130000.00");
    expect(wertVon(a, "t._ohne.investiert")).toBe("30000.00");
    expect(wertVon(a, "t._summe.investiert")).toBe("160000.00");
    expect(wertVon(a, "t._summe.anzahl")).toBe("3");
    expect(wertVon(a, "t._ohne.name")).toBeNull();
    // aus gespeicherten Werten lässt sich dieselbe Anzeige wieder aufbauen
    expect(anzeigeAus(d, a.werte)).toEqual(a.abschnitte);
  });

  it("Tabelle je Instrument, Mittelart, Sitzland und Branche; Sortierung nach Spalte", () => {
    const tabelle = (je: string) =>
      ok(def([{ id: "t", typ: "tabelle", titel: t("T"), je, sortierung: { spalte: "investiert", richtung: "ab" }, spalten: [feld("investiert", { art: "bestand", groesse: "investiert" })] }]));
    const zeilen = (je: string) => {
      const a = werteAus(eingabe(tabelle(je)));
      const tab = a.abschnitte[0]!;
      return tab.typ === "tabelle" ? tab.zeilen.map((z) => `${z.schluessel}=${z.zellen.investiert!.wert}`) : [];
    };
    expect(zeilen("instrument")).toEqual(["darlehen=80000.00", "offene_beteiligung=50000.00", "stille_beteiligung=30000.00"]);
    expect(zeilen("mittelart")).toEqual(["foerdermittel=80000.00", "kofinanzierung=50000.00", "_ohne=30000.00"]);
    expect(zeilen("sitzland")).toEqual(["DE=130000.00", "AT=30000.00"]);
    expect(zeilen("branche")).toEqual(["Software=160000.00"]);
  });

  it("Tabellenfilter und Spaltenfilter wirken je Zeile; berechnete Spalten rechnen je Zeile", () => {
    const d = ok(
      def([
        {
          id: "t",
          typ: "tabelle",
          titel: t("T"),
          je: "beteiligung",
          filter: { sitzland: ["DE"] },
          spalten: [
            feld("zusage", { art: "bestand", groesse: "zusage" }),
            feld("investiert", { art: "bestand", groesse: "investiert" }),
            feld("quote", { art: "berechnet", operation: "anteil_prozent", felder: ["investiert", "zusage"] }, { format: "prozent" }),
            feld("nur_kofi", { art: "vorgang", vorgangsarten: ["auszahlung"], zeitraum: "kumuliert" }, { filter: { mittelart: ["kofinanzierung"] } }),
          ],
        },
      ]),
    );
    const a = werteAus(eingabe(d));
    expect(wertVon(a, "t.b1.quote")).toBe("80");
    expect(wertVon(a, "t.b2.quote")).toBe("100");
    expect(wertVon(a, "t.b3.quote")).toBeUndefined(); // außerhalb des Tabellenfilters
    expect(wertVon(a, "t.b1.nur_kofi")).toBe("0.00");
    expect(wertVon(a, "t.b2.nur_kofi")).toBe("50000.00");
  });

  it("jede Herkunft nennt Beteiligungen und feste Schrittbezeichnungen", () => {
    const d = ok(STANDARD_MELDEDEFINITIONEN[0]!.definition);
    const a = werteAus(eingabe(d));
    const bekannt = new Set(SCHRITT_BEZEICHNUNGEN);
    for (const w of a.werte) for (const s of w.herkunft?.schritte ?? []) expect(bekannt.has(s.bezeichnung), s.bezeichnung).toBe(true);
  });
});

describe("Prüfregeln", () => {
  const abschnitte = [
    { id: "a", typ: "felder", titel: t("A"), felder: [feld("x", { art: "manuell" }, { pflicht: true }), feld("y", { art: "manuell" }), feld("z", { art: "manuell" }), feld("name", { art: "manuell" }, { format: "text" })] },
    { id: "t", typ: "tabelle", titel: t("T"), je: "beteiligung", spalten: [feld("s", { art: "bestand", groesse: "investiert" }, { summe: true })] },
  ];
  const werte = (o: Record<string, string | null>) => new Map(Object.entries(o));

  it("Pflichtfeld, Bereich, Vergleich, Summe und Spaltensumme", () => {
    const d = ok(
      def(abschnitte, [
        { id: "bereich", art: "bereich", schwere: "warnung", feld: "y", minimum: "0", maximum: "100", meldung: t("y außerhalb", "y outside") },
        { id: "vergleich", art: "vergleich", schwere: "fehler", links: "y", operator: "<=", rechts: "z", meldung: t("y über z") },
        { id: "summe", art: "summe", schwere: "fehler", summanden: ["y", "z"], gleich: "t.s", toleranz: "0.5", meldung: t("Summe weicht ab") },
        { id: "pflicht", art: "pflicht", schwere: "warnung", felder: ["name"], meldung: t("Name fehlt") },
      ]),
    );
    const leer = pruefeRegeln(d, werte({ "a.x": null, "a.y": "150", "a.z": "100", "a.name": "", "t._summe.s": "300" }));
    expect(leer.map((b) => `${b.regelId}:${b.code}:${b.schwere}`).sort()).toEqual(
      ["bereich:WERT_UEBER_MAXIMUM:warnung", "pflicht:PFLICHT_FEHLT:warnung", "pflicht_x:PFLICHT_FEHLT:fehler", "summe:SUMME_ABWEICHUNG:fehler", "vergleich:VERGLEICH_VERLETZT:fehler"].sort(),
    );
    expect(leer.find((b) => b.regelId === "pflicht_x")!.meldung.de).toContain("Pflichtfeld");
    expect(leer.find((b) => b.regelId === "summe")!.params).toEqual({ summe: "250", erwartet: "300", differenz: "-50" });
    const gut = pruefeRegeln(d, werte({ "a.x": "ja", "a.y": "-1", "a.z": "300.4", "a.name": "Eintrag", "t._summe.s": "299.5" }));
    expect(gut.map((b) => b.regelId)).toEqual(["bereich"]); // −1 unter dem Minimum; Summe 299,4 liegt innerhalb der Toleranz 0,5
    expect(gut[0]!.code).toBe("WERT_UNTER_MINIMUM");
  });

  it("eine Regel mit leerem Operanden bleibt still, Operatoren und Toleranz", () => {
    const d = ok(
      def(abschnitte, [
        { id: "gleich", art: "vergleich", schwere: "fehler", links: "y", operator: "=", rechts: "z", toleranz: "0.01", meldung: t("m") },
        { id: "ungleich", art: "vergleich", schwere: "warnung", links: "y", operator: "!=", rechts: { wert: "5" }, meldung: t("m") },
        { id: "gr", art: "vergleich", schwere: "warnung", links: "y", operator: ">", rechts: { wert: "5" }, meldung: t("m") },
        { id: "kl", art: "vergleich", schwere: "warnung", links: "y", operator: "<", rechts: { wert: "5" }, meldung: t("m") },
        { id: "gre", art: "vergleich", schwere: "warnung", links: "y", operator: ">=", rechts: { wert: "5" }, meldung: t("m") },
      ]),
    );
    expect(pruefeRegeln(d, werte({ "a.x": "1", "a.y": null, "a.z": "5" })).length).toBe(0);
    const f = pruefeRegeln(d, werte({ "a.x": "1", "a.y": "5", "a.z": "5.005" })).map((b) => b.regelId);
    expect(f.sort()).toEqual(["gr", "kl", "ungleich"].sort());
    expect(pruefeRegeln(d, werte({ "a.x": "1", "a.y": "5", "a.z": "5.1" })).map((b) => b.regelId)).toContain("gleich");
  });

  it("die mitgelieferten Regeln greifen auf echte Werte", () => {
    const d = ok(STANDARD_MELDEDEFINITIONEN[0]!.definition);
    const a = werteAus(eingabe(d));
    const befunde = pruefeRegeln(d, new Map(a.werte.map((w) => [w.schluessel, w.wert])));
    const ids = befunde.map((b) => b.regelId);
    expect(ids).toContain("pflicht_verantwortlich"); // Pflichtfeld von Hand, leer
    expect(ids).toContain("erlaeuterung_fehlt"); // Warnung
    expect(ids).toContain("auszahlungen_ueber_abrufen"); // ohne Kapitalabrufe liegen die Auszahlungen darüber
    expect(ids).not.toContain("tabelle_gleich_feld"); // Tabelle und Feld stimmen überein
  });
});

describe("Eingaben von Hand und Entschärfung", () => {
  it("Zahlen, Ja/Nein, Datum und Text werden gegen das Format geprüft", () => {
    for (const f of ["betrag", "zahl", "prozent"] as const) {
      expect(pruefeManuellenWert(f, '=HYPERLINK("x")')).toBe("zahl_erwartet");
      expect(pruefeManuellenWert(f, "+1")).toBe("zahl_erwartet");
      expect(pruefeManuellenWert(f, "1e5")).toBe("zahl_erwartet");
      expect(pruefeManuellenWert(f, "-12.5")).toBeNull();
    }
    expect(pruefeManuellenWert("ganzzahl", "1.5")).toBe("ganzzahl_erwartet");
    expect(pruefeManuellenWert("ja_nein", "@SUM(1)")).toBe("ja_nein_erwartet");
    expect(pruefeManuellenWert("ja_nein", "ja")).toBeNull();
    expect(pruefeManuellenWert("datum", "2026-02-30")).toBe("datum_erwartet");
    expect(pruefeManuellenWert("text", "x".repeat(4001))).toBe("text_zu_lang");
    expect(pruefeManuellenWert("text", "  ")).toBe("leer");
  });

  it("entschaerfe maskiert =, +, -, @, Tabulator und Wagenrücklauf, lässt Zahlen unberührt", () => {
    for (const z of ["=1+1", "+1", "-a", "@x", "\tx", "\rx"]) expect(entschaerfe(z)).toBe(`'${z}`);
    expect(entschaerfe("-12.50")).toBe("-12.50");
    expect(entschaerfe("normal")).toBe("normal");
  });

  it("Beschriftungen und Texte mit Formelanfang sind in CSV und Excel entschärft", async () => {
    const definition = ok(def([{ id: "a", typ: "felder", titel: t("=Titel"), felder: [feld("x", { art: "manuell" }, { format: "text", bezeichnung: t("+Bezeichnung"), einheit: "@E" })] }]));
    const a = werteAus(eingabe(definition, { manuell: { "a.x": "\t-Text" } }));
    const aus: MeldeAusgabe = {
      sprache: "de",
      bezeichnung: "-Meldung",
      kennung: "x",
      fonds: { name: "=Fonds", kurzname: "F", waehrung: "EUR" },
      programm: null,
      periode: { beginn: "2026-07-01", ende: "2026-09-30", kennung: "2026-Q3" },
      stand: "2026-11-20T10:00:00.000Z",
      entwurf: true,
      definition,
      anzeige: anzeigeAus(definition, a.werte),
      werte: a.werte,
      befunde: [],
      kommentare: {},
    };
    const csv = Buffer.from(erzeugeMeldeCsv(aus)).toString("utf8");
    expect(csv).toContain("'+Bezeichnung");
    expect(csv).toContain("'@E");
    expect(csv).toContain("'\t-Text");
    expect(csv).not.toMatch(/;[=+@]/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await erzeugeMeldeXlsx(aus)) as unknown as ExcelJS.Buffer);
    const texte: string[] = [];
    for (const blatt of wb.worksheets) blatt.eachRow((r) => r.eachCell((c) => typeof c.value === "string" && texte.push(c.value)));
    expect(texte).toContain("'=Titel");
    expect(texte).toContain("'+Bezeichnung");
    expect(texte).toContain("'-Meldung");
    expect(texte.filter((x) => /^[=+@\t\r]/.test(x))).toEqual([]);
  });
});

describe("Ausgabe: Excel, CSV und PDF", () => {
  function ausgabe(sprache: "de" | "en" = "de", entwurf = true): MeldeAusgabe {
    const definition = ok(STANDARD_MELDEDEFINITIONEN[0]!.definition);
    const a = werteAus(eingabe(definition, { manuell: { "stammdaten.verantwortlich": "=HYPERLINK(1)", "erlaeuterung.erlaeuterung_text": "Alles planmäßig; ein Zitat \"so\"; Zeilen\numbruch" } }));
    const werte = a.werte;
    return {
      sprache,
      bezeichnung: STANDARD_MELDEDEFINITIONEN[0]![sprache === "de" ? "bezeichnungDe" : "bezeichnungEn"],
      kennung: "foerderbericht_quartal Version 1",
      fonds: { name: "Beispielfonds", kurzname: "BF", waehrung: "EUR" },
      programm: null,
      periode: { beginn: "2026-07-01", ende: "2026-09-30", kennung: "2026-Q3" },
      stand: "2026-11-20T10:00:00.000Z",
      entwurf,
      definition,
      anzeige: anzeigeAus(definition, werte),
      werte,
      befunde: pruefeRegeln(definition, new Map(werte.map((w) => [w.schluessel, w.wert]))),
      kommentare: {},
    };
  }

  it("Excel: Zahlen als Zahlen, k. A. als Text, Rohdaten mit Herkunft, Befunde", async () => {
    const bytes = await erzeugeMeldeXlsx(ausgabe());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Meldung", "Rohdaten", "Befunde"]);
    const meldung = wb.getWorksheet("Meldung")!;
    const zeilen: Record<string, ExcelJS.CellValue[]> = {};
    meldung.eachRow((r) => {
      const schluessel = String(r.getCell(1).value);
      zeilen[schluessel] ??= (r.values as ExcelJS.CellValue[]).slice(1);
    });
    expect(zeilen["Auszahlungen an Unternehmen im Berichtszeitraum"]![1]).toBe(100000);
    expect(zeilen["Kapitalabrufe kumuliert"]![1]).toBe(0);
    expect(zeilen["Förderprogramm"]![1]).toBe("k. A.");
    const roh = wb.getWorksheet("Rohdaten")!;
    let gefunden = false;
    roh.eachRow((r) => {
      if (r.getCell(1).value === "mittelverwendung.auszahlungen_periode") {
        gefunden = true;
        expect(r.getCell(6).value).toBe(100000);
        expect(String(r.getCell(9).value)).toContain("Beteiligungen: 3");
      }
    });
    expect(gefunden).toBe(true);
    // Tabelle je Programm mit Summenzeile
    const summe = [...Array(meldung.rowCount).keys()].map((i) => meldung.getRow(i + 1).values as ExcelJS.CellValue[]).find((v) => v[1] === "Summe");
    expect(summe?.[4]).toBe(160000);
    // Formeltext wird als Text geschrieben, nicht als Formel
    const verantwortlich = zeilen["Verantwortliche Person für die Meldung"]![1];
    expect(verantwortlich).toBe("'=HYPERLINK(1)");
  });

  it("Excel in Englisch hat englische Blätter und Bezeichnungen", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await erzeugeMeldeXlsx(ausgabe("en"))) as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Report", "Raw data", "Findings"]);
    expect(wb.getWorksheet("Report")!.getRow(1).getCell(1).value).toBe("Funding report per quarter (template)");
  });

  it("CSV: lange Form, Semikolon, BOM, Punkt als Dezimaltrenner, Formeln entschärft, Quoting", () => {
    const text = Buffer.from(erzeugeMeldeCsv(ausgabe())).toString("utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const zeilen = text.slice(1).split("\r\n");
    expect(zeilen[0]).toBe("abschnitt;zeile;feld;bezeichnung;wert;einheit;format");
    expect(zeilen).toContain("mittelverwendung;;auszahlungen_periode;Auszahlungen an Unternehmen im Berichtszeitraum;100000.00;EUR;betrag");
    expect(zeilen.find((z) => z.startsWith("stammdaten;;programm;"))).toContain("k. A.");
    expect(zeilen.find((z) => z.startsWith("stammdaten;;verantwortlich;"))).toContain("'=HYPERLINK(1)");
    expect(text).toContain('"Alles planmäßig; ein Zitat ""so""; Zeilen\numbruch"');
    expect(zeilen.find((z) => z.startsWith("portfolio_programm;Summe;investiert;"))).toContain("160000.00");
    expect(zeilen.find((z) => z.startsWith("portfolio_programm;Ohne Zuordnung;programm;"))).toContain("Ohne Zuordnung");
  });

  it("PDF-Quelltext enthält die Texte, das Wasserzeichen im Entwurf und das Format der Zahlen", () => {
    const quelle = meldeQuelle(ausgabe());
    expect(quelle).toContain("Förderbericht je Quartal (Vorlage)");
    expect(quelle).toContain("100.000,00");
    expect(quelle).toContain("entwurf: true");
    expect(meldeQuelle(ausgabe("de", false))).toContain("entwurf: false");
    expect(meldeQuelle(ausgabe("en"))).toContain("Funding report per quarter (template)");
  });

  it("PDF wird mit Typst gesetzt", () => {
    const bytes = erzeugeMeldePdf(ausgabe());
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(2000);
  });
});
