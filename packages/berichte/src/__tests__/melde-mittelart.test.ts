import { describe, expect, it } from "vitest";
import { pruefeDefinition, werteAus, type AuswertungsEingabe, type BeteiligungDaten, type DefinitionInhalt, type VorgangZeile } from "../index";

const t = (de: string) => ({ de, en: de });
const feld = (id: string, quelle: object, extra: object = {}) => ({ id, bezeichnung: t(id), format: "betrag", quelle, ...extra });
const def = (abschnitte: object[]) => ({ schema: 1, abschnitte, regeln: [] });
const ok = (roh: unknown): DefinitionInhalt => {
  const e = pruefeDefinition(roh);
  if (!e.ok) throw new Error(JSON.stringify(e.fehler));
  return e.definition;
};
const wertVon = (a: ReturnType<typeof werteAus>, schluessel: string) => a.werte.find((w) => w.schluessel === schluessel)?.wert;

let zaehler = 0;
const v = (valuta: string, betrag: string, extra: Partial<VorgangZeile> = {}): VorgangZeile => ({ id: `v${++zaehler}`, art: "auszahlung", valuta, betrag, kapitalisiert: false, storniertVorgangId: null, ...extra });

/**
 * Eine Beteiligung mit gesplitteten Beträgen: 60/40 (Fördermittel/Kofinanzierung) im Juli, 50/50 ab August. Ein Storno trägt die negierten Anteile seines
 * Originals; ein Betrag ohne Meldeart (Mittelart des Fonds ohne Kategorie) steht in keiner Meldeart.
 */
function mischfinanziert(): BeteiligungDaten {
  zaehler = 0;
  const original = v("2026-08-10", "1000.00", { anteile: { foerdermittel: "500.00", kofinanzierung: "500.00" } });
  return {
    id: "m1",
    organisationId: "o",
    organisationName: "Mischfinanziert GmbH",
    sektor: null,
    ort: null,
    sitzland: null,
    region: null,
    instrument: "darlehen",
    status: "aktiv",
    erstinvestment: "2026-01-10",
    programm: null,
    projektnummer: null,
    vertragsnummer: null,
    partnernummer: null,
    buchungskreis: null,
    bewertung: { wert: "1000.00", stichtag: "2026-09-30" },
    ausgeschieden: false,
    offeneForderungen: "100.00",
    buchwertAbgang: "0.00",
    kennzahlen: [],
    vorgaenge: [
      v("2026-07-15", "1000.00", { anteile: { foerdermittel: "600.00", kofinanzierung: "400.00" } }),
      original,
      v("2026-08-12", "-1000.00", { storniertVorgangId: original.id, anteile: { foerdermittel: "-500.00", kofinanzierung: "-500.00" } }),
      v("2026-09-01", "333.33", { anteile: { foerdermittel: "166.67", kofinanzierung: "166.66" } }),
      v("2026-09-05", "200.00", { anteile: {} }),
    ],
  };
}

const eingabe = (definition: DefinitionInhalt): AuswertungsEingabe => ({
  definition,
  fonds: { name: "Beispielfonds", kurzname: "BF", vintage: 2024, zeichnungskapital: "1000000.00", waehrung: "EUR", bewegungen: [] },
  programm: null,
  periode: { beginn: "2026-07-01", ende: "2026-09-30", kennung: "2026-Q3" },
  beteiligungen: [mischfinanziert()],
  mittelartQuoten: { foerdermittel: "0.5", kofinanzierung: "0.5" },
  programme: [],
  kennzahlVerdichtung: {},
  manuell: {},
});

const bestand = (filter: object | undefined) =>
  def([
    {
      id: "a",
      typ: "felder",
      titel: t("A"),
      felder: [feld("investiert", { art: "bestand", groesse: "investiert" }, { filter }), feld("bewertung", { art: "bestand", groesse: "bewertung" }, { filter }), feld("anzahl", { art: "beteiligungsanzahl" }, { format: "ganzzahl", filter })],
    },
  ]);
const rechne = (filter?: object) => werteAus(eingabe(ok(bestand(filter))));

describe("Mittelarten: Beträge nach Quoten je Zeitraum", () => {
  it("ohne Filter zählt der volle Betrag, mit Filter nur der Anteil der Meldeart", () => {
    expect(wertVon(rechne(), "a.investiert")).toBe("1533.33");
    // Fördermittel 600 + 500 - 500 + 166,67; Kofinanzierung 400 + 500 - 500 + 166,66
    expect(wertVon(rechne({ mittelart: ["foerdermittel"] }), "a.investiert")).toBe("766.67");
    expect(wertVon(rechne({ mittelart: ["kofinanzierung"] }), "a.investiert")).toBe("566.66");
    expect(wertVon(rechne({ mittelart: ["foerdermittel", "kofinanzierung"] }), "a.investiert")).toBe("1333.33");
    expect(wertVon(rechne({ mittelart: ["eigenmittel"] }), "a.investiert")).toBe("0.00");
  });

  it("Stichtagswerte ohne Datum folgen der Quote am Ende des Zeitraums; die Beteiligung zählt nur mit Beträgen in der Meldeart", () => {
    // Bewertung 1000 + offene Forderungen 100 = 1100; Quote 0,5 → 550
    expect(wertVon(rechne({ mittelart: ["kofinanzierung"] }), "a.bewertung")).toBe("550.00");
    expect(wertVon(rechne({ mittelart: ["kofinanzierung"] }), "a.anzahl")).toBe("1");
    expect(wertVon(rechne({ mittelart: ["eigenmittel"] }), "a.anzahl")).toBe("0");
  });

  it("Tabelle je Mittelart verteilt auf Gruppen; ein Filter in der Spalte schneidet mit der Gruppe", () => {
    const d = ok(
      def([
        {
          id: "t",
          typ: "tabelle",
          titel: t("T"),
          je: "mittelart",
          spalten: [feld("investiert", { art: "bestand", groesse: "investiert" }), feld("nur_kofi", { art: "bestand", groesse: "investiert" }, { filter: { mittelart: ["kofinanzierung"] } })],
        },
      ]),
    );
    const a = werteAus(eingabe(d));
    expect(wertVon(a, "t.foerdermittel.investiert")).toBe("766.67");
    expect(wertVon(a, "t.kofinanzierung.investiert")).toBe("566.66");
    expect(wertVon(a, "t.foerdermittel.nur_kofi")).toBe("0.00");
    expect(wertVon(a, "t.kofinanzierung.nur_kofi")).toBe("566.66");
    // der Rest ohne Meldeart steht in keiner Zeile, und die Beteiligung hat Beträge, also keine Gruppe „ohne Zuordnung“
    expect(a.werte.some((w) => w.schluessel === "t._ohne._zeile")).toBe(false);
  });

  it("Mittelart einer einzelnen Beteiligung nennt die Meldearten mit Beträgen", () => {
    const d = ok(def([{ id: "t", typ: "tabelle", titel: t("T"), je: "beteiligung", spalten: [feld("art", { art: "stammdaten", feld: "foerderung.mittelart" }, { format: "text" })] }]));
    expect(wertVon(werteAus(eingabe(d)), "t.m1.art")).toBe("foerdermittel, kofinanzierung");
  });
});
