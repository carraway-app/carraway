import { buchhaltungAufsetzen, uebernehmeSalden } from "./hilfen-buchhaltung";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { heute } from "../schreiben";
import { json, leeren, oeffneTestdb, vehikelVon } from "./hilfen";
import { erstelleTestApp, legePersonAn, person } from "./hilfen-auth";
import { aufrufe, grundbestand, ID } from "./hilfen-instrumente";
import { vorgaengeEinfuegen } from "./instrument-hilfen";

/**
 * Bewertungsszenarien (Etappe 21). Die Rechenregeln prüfen der Rechenkern und seine Python-Referenz; hier geht es um die Eingaben aus der Datenbank (Kapitaltabelle, Kennzahlen),
 * Lücken statt Nullen, Gewichte, Festschreiben, Bericht und die Unveränderlichkeit älterer Szenarien. Alle Daten sind erfunden.
 */

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const { get, post, patch } = aufrufe(t);

const betrachter = person("bw-betrachter", { rollen: { [ID.fonds]: "betrachter" } });
const bearbeiter = person("bw-bearbeiter", { rollen: { [ID.fonds]: "bearbeiter" } });
const freigeber = person("bw-freigeber", { rollen: { [ID.fonds]: "freigeber" } });
const fremd = person("bw-fremd", { rollen: { [ID.anderer]: "bearbeiter" } });
const KLASSE = "00000000-0000-4000-8000-0000000000c1";
const BASIS = heute();

async function bestand(mitKennzahl = true) {
  await grundbestand(db);
  await buchhaltungAufsetzen(db, ID.fonds);
  await uebernehmeSalden(db, ID.fonds, BASIS, { "1200": "0.00" });
  for (const p of [betrachter, bearbeiter, freigeber, fremd]) await legePersonAn(db, p);
  await vorgaengeEinfuegen(db, [
    { beteiligungId: ID.eigen, art: "zusage", valuta: "2025-01-01", betrag: "2000000.00" },
    { beteiligungId: ID.eigen, art: "auszahlung", valuta: "2025-02-01", betrag: "1500000.00" },
    { beteiligungId: ID.darlehen, art: "zusage", valuta: "2025-01-01", betrag: "1000000.00" },
    { beteiligungId: ID.darlehen, art: "auszahlung", valuta: "2025-03-01", betrag: "800000.00" },
  ]);
  await db.insert(s.bewertung).values([
    { beteiligungId: ID.eigen, stichtag: "2026-06-30", wert: "2500000.00", methode: "sonstige", status: "freigegeben", freigegebenVon: "test", freigegebenAm: new Date() },
    { beteiligungId: ID.darlehen, stichtag: "2026-06-30", wert: "800000.00", methode: "anschaffungskosten", status: "freigegeben", freigegebenVon: "test", freigegebenAm: new Date() },
  ]);
  const [abruf] = await db.insert(s.fondsBewegung).values({ fondsId: ID.fonds, art: "abruf", valuta: "2025-01-15", betrag: "2500000.00" }).returning();
  const [investor] = await db.insert(s.organisation).values({ name: "Investor Beispiel", art: "investor" }).returning();
  const anteil = { bewegungId: abruf!.id, organisationId: investor!.id, betrag: abruf!.betrag };
  await db.insert(s.abrufAnteil).values(anteil);
  await db.insert(s.lpZahlung).values({ ...anteil, valuta: abruf!.valuta });
  // Kapitaltabelle von Alpha: der Fonds hält 150.000 von 1.000.000 Anteilen (15 %), Preis je Anteil 10,00.
  await db.insert(s.anteilsklasse).values({ id: KLASSE, organisationId: ID.orgA, name: "Serie A", rang: 1, praeferenzFaktor: "1", partizipierend: false, umwandelbar: true });
  const [runde] = await db
    .insert(s.finanzierungsrunde)
    .values({ organisationId: ID.orgA, bezeichnung: "Serie A", datum: "2025-02-01", preMoney: "7000000.00", postMoney: "10000000.00", preisJeAnteil: "10.0000", anteileGesamtNach: "1000000", status: "abgeschlossen" })
    .returning();
  await db.insert(s.rundenposition).values([
    { rundeId: runde!.id, fondsId: ID.fonds, betrag: "1500000.00", anteile: "150000", rolle: "lead", anteilsklasseId: KLASSE },
    { rundeId: runde!.id, vehikelId: await vehikelVon(db, ID.orgC), betrag: "1500000.00", anteile: "150000", rolle: "co", anteilsklasseId: KLASSE },
  ]);
  if (mitKennzahl) {
    const [def] = await db.select().from(s.kennzahlDefinition).where(sql`${s.kennzahlDefinition.schluessel} = 'umsatz'`).limit(1);
    await db.insert(s.kennzahlWert).values({
      beteiligungId: ID.eigen,
      definitionId: def!.id,
      periodeBeginn: "2026-07-01",
      periodeEnde: "2026-09-30",
      szenario: "ist",
      wert: "5000000.00",
      quelle: "intern",
      erfasstVon: "test",
      status: "bestaetigt",
      bestaetigtAm: new Date("2026-02-01T00:00:00Z"),
    });
  }
  await db.execute(sql`DELETE FROM snapshot_auftrag`);
}

const fall = (schluessel: string, gewicht: string, methode: Record<string, unknown>) => ({ schluessel, gewicht, methode });
const bewertung = (zusatz: Record<string, unknown> = {}) => ({
  beteiligungen: {
    [ID.eigen]: {
      faelle: [
        fall("bear", "0.25", { art: "wert", betrag: "1500000.00" }),
        fall("base", "0.5", { art: "letzte_runde", abschlag: "-0.2" }),
        fall("bull", "0.25", { art: "multiple", kennzahl: "umsatz", multiple: "8", abzug: "5000000.00" }),
      ],
    },
  },
  ...zusatz,
});
const annahmen = (zusatz: Record<string, unknown> = {}) => ({
  gebuehren: { basis: "zeichnungskapital", satz: "0", bisJahr: null, sonstigeJahr: "0" },
  carrySatz: "0.2",
  beteiligungen: {},
  ...zusatz,
});
const anlegen = (name: string, a: Record<string, unknown>, als = bearbeiter) => post(`/fonds/${ID.fonds}/szenarien`, { name, basisStichtag: BASIS, annahmen: a }, als);
const detail = async (id: string, als = betrachter) => json(await get(`/szenarien/${id}`, als));

beforeEach(async () => bestand());
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Bewertungsszenarien: Rechnung aus den Daten", () => {
  it("rechnet Fälle aus Wert, letzter Runde (Aufschlag) und Multiple auf die Kennzahl, mit dem Anteil aus der Kapitaltabelle; Erwartungswert und Fondswirkung", async () => {
    const neu = await anlegen("Bewertung A", annahmen({ bewertung: bewertung() }));
    expect(neu.status, await neu.clone().text()).toBe(201);
    const d = await detail((await json(neu)).id);
    const b = d.ergebnis.bewertungsszenario;
    expect(b.waehrung).toBe("EUR");
    const alpha = b.beteiligungen[0];
    expect(alpha).toMatchObject({ aktuell: "2500000.00", erwartet: "2587500.00", abweichung: "87500.00" });
    // bear: fester Wert; base: 10,00 × 150.000 × 1,2; bull: (5 Mio. × 8 − 5 Mio.) × 15 %
    expect(alpha.faelle.map((f: { schluessel: string; wert: string }) => [f.schluessel, f.wert])).toEqual([["bear", "1500000.00"], ["base", "1800000.00"], ["bull", "5250000.00"]]);
    expect(alpha.faelle[2].eingaben).toMatchObject({ kennzahlWert: "5000000.00", anteil: "0.15", anteilQuelle: "kapitaltabelle" });
    expect(alpha.faelle[1].eingaben).toMatchObject({ preisJeAnteil: "10.0000", anteile: "150000", runde: "Serie A" });
    // Fonds: NAV 3,3 Mio. (2,5 + 0,8), Abrufe 2,5 Mio., keine Ausschüttungen
    expect(b.aktuell).toEqual({ nav: "3300000.00", tvpi: "1.3200", dpi: "0.0000", rvpi: "1.3200", carry: "160000.00", navNetto: "3140000.00" });
    expect(b.faelle.find((f: { schluessel: string }) => f.schluessel === "base")).toMatchObject({ nav: "2600000.00", tvpi: "1.0400", carry: "20000.00", navNetto: "2580000.00" });
    expect(b.erwartet).toEqual({ nav: "3387500.00", tvpi: "1.3550", dpi: "0.0000", rvpi: "1.3550", carry: "177500.00", navNetto: "3210000.00" });
    expect(b.befunde).toEqual([]);
  });

  it("Gewichte müssen genau 100 % ergeben, mindestens zwei Fälle, eindeutige Schlüssel", async () => {
    const falsch = bewertung({ beteiligungen: { [ID.eigen]: { faelle: [fall("a", "0.5", { art: "wert", betrag: "1.00" }), fall("b", "0.49", { art: "wert", betrag: "2.00" })] } } });
    const r = await anlegen("Falsch", annahmen({ bewertung: falsch }));
    expect(r.status).toBe(400);
    expect(JSON.stringify(await json(r))).toContain("0.99");
    const einer = bewertung({ beteiligungen: { [ID.eigen]: { faelle: [fall("a", "1", { art: "wert", betrag: "1.00" })] } } });
    expect((await anlegen("Einer", annahmen({ bewertung: einer }))).status).toBe(400);
    const doppelt = bewertung({ beteiligungen: { [ID.eigen]: { faelle: [fall("a", "0.5", { art: "wert", betrag: "1.00" }), fall("a", "0.5", { art: "wert", betrag: "2.00" })] } } });
    expect((await anlegen("Doppelt", annahmen({ bewertung: doppelt }))).status).toBe(400);
    // exakt 1 mit sechs Nachkommastellen geht
    const exakt = bewertung({ beteiligungen: { [ID.eigen]: { faelle: [fall("a", "0.333333", { art: "wert", betrag: "1.00" }), fall("b", "0.666667", { art: "wert", betrag: "2.00" })] } } });
    expect((await anlegen("Exakt", annahmen({ bewertung: exakt }))).status).toBe(201);
    // eine Beteiligung, die der Fonds nicht hält
    const fremdBet = bewertung({ beteiligungen: { "00000000-0000-4000-8000-00000000dead": { faelle: [fall("a", "0.5", { art: "wert", betrag: "1.00" }), fall("b", "0.5", { art: "wert", betrag: "2.00" })] } } });
    const unbekannt = await anlegen("Unbekannt", annahmen({ bewertung: fremdBet }));
    expect(unbekannt.status).toBe(422);
    expect((await json(unbekannt)).fehler.code).toBe("SZENARIO_ANNAHMEN_UNGUELTIG");
  });

  it("fehlende Eingaben ergeben Lücken statt Nullen: Fall, Erwartungswert und Fondskennzahlen haben keinen Wert, die Befunde nennen den Grund", async () => {
    await db.delete(s.kennzahlWert);
    const a = {
      beteiligungen: {
        [ID.eigen]: bewertung().beteiligungen[ID.eigen],
        // das Darlehen hat weder Runde noch Anteile
        [ID.darlehen]: { faelle: [fall("base", "0.5", { art: "letzte_runde", abschlag: "0" }), fall("bear", "0.5", { art: "wert", betrag: "400000.00" })] },
      },
    };
    const neu = await anlegen("Lücken", annahmen({ bewertung: a }));
    expect(neu.status, await neu.clone().text()).toBe(201);
    const b = (await detail((await json(neu)).id)).ergebnis.bewertungsszenario;
    const alpha = b.beteiligungen.find((x: { id: string }) => x.id === ID.eigen);
    expect(alpha.faelle.find((f: { schluessel: string }) => f.schluessel === "bull").wert).toBeNull();
    expect(alpha.erwartet).toBeNull();
    expect(alpha.abweichung).toBeNull();
    const darlehen = b.beteiligungen.find((x: { id: string }) => x.id === ID.darlehen);
    expect(darlehen.faelle.find((f: { schluessel: string }) => f.schluessel === "base").wert).toBeNull();
    expect(darlehen.faelle.find((f: { schluessel: string }) => f.schluessel === "bear").wert).toBe("400000.00");
    expect(b.erwartet).toEqual({ nav: null, tvpi: null, dpi: null, rvpi: null, carry: null, navNetto: null });
    // bull (Kennzahl fehlt) und base (Darlehen ohne Runde) haben keinen Fondswert, bear schon (beide Beteiligungen mit festem Wert)
    expect(b.faelle.find((f: { schluessel: string }) => f.schluessel === "bull").nav).toBeNull();
    expect(b.faelle.find((f: { schluessel: string }) => f.schluessel === "base").nav).toBeNull();
    expect(b.faelle.find((f: { schluessel: string }) => f.schluessel === "bear").nav).toBe("1900000.00");
    const codes = b.befunde.map((x: { code: string; beteiligungId: string }) => `${x.code}:${x.beteiligungId === ID.eigen ? "alpha" : "darlehen"}`);
    expect(codes).toEqual(expect.arrayContaining(["BEWERTUNG_KENNZAHL_FEHLT:alpha", "BEWERTUNG_RUNDE_FEHLT:darlehen"]));
  });

  it("ein ausdrücklicher Anteil geht der Kapitaltabelle vor; ein Fall, den nicht jede Beteiligung hat, lässt die anderen auf ihrem aktuellen Wert", async () => {
    const a = {
      beteiligungen: {
        [ID.eigen]: { faelle: [fall("base", "0.5", { art: "multiple", kennzahl: "umsatz", multiple: "2", abzug: "0", anteil: "0.5" }), fall("bull", "0.5", { art: "wert", betrag: "4000000.00" })] },
        [ID.darlehen]: { faelle: [fall("base", "0.5", { art: "wert", betrag: "700000.00" }), fall("bear", "0.5", { art: "wert", betrag: "300000.00" })] },
      },
    };
    const b = (await detail((await json(await anlegen("Anteil", annahmen({ bewertung: a })))).id)).ergebnis.bewertungsszenario;
    const alpha = b.beteiligungen.find((x: { id: string }) => x.id === ID.eigen);
    expect(alpha.faelle[0]).toMatchObject({ wert: "5000000.00", eingaben: { anteil: "0.5", anteilQuelle: "angegeben" } });
    // bull gibt es nur bei Alpha: das Darlehen bleibt bei 800.000
    expect(b.faelle.find((f: { schluessel: string }) => f.schluessel === "bull").nav).toBe("4800000.00");
    expect(b.befunde).toEqual(expect.arrayContaining([expect.objectContaining({ code: "BEWERTUNG_FALL_FEHLT", beteiligungId: ID.darlehen, params: { fall: "bull" } })]));
  });
});

describe("Festschreiben, Bericht, ältere Szenarien", () => {
  it("festgeschrieben bleibt das Ergebnis samt Bewertungsszenario unverändert, auch wenn sich Bewertungen und Kennzahlen ändern; die Prüfsumme stimmt", async () => {
    const id = (await json(await anlegen("Frieren", annahmen({ bewertung: bewertung() })))).id as string;
    const frieren = await post(`/szenarien/${id}/festschreiben`, undefined, freigeber);
    expect(frieren.status, await frieren.clone().text()).toBe(200);
    const vorher = await detail(id);
    expect(vorher.status).toBe("festgeschrieben");
    expect(vorher.pruefsumme.gueltig).toBe(true);
    // Bewertung und Kennzahl ändern sich danach
    await db.insert(s.bewertung).values({ beteiligungId: ID.eigen, stichtag: "2026-09-30", wert: "9999999.00", methode: "sonstige", status: "freigegeben", freigegebenVon: "test", freigegebenAm: new Date() });
    await db.delete(s.kennzahlWert);
    const nachher = await detail(id);
    expect(nachher.ergebnis.bewertungsszenario).toEqual(vorher.ergebnis.bewertungsszenario);
    expect(nachher.pruefsumme.gueltig).toBe(true);
    expect(vorher.ergebnis.bewertungsszenario.erwartet.nav).toBe("3387500.00");
    // keine Änderung an einem festgeschriebenen Szenario
    expect((await patch(`/szenarien/${id}`, { annahmen: annahmen() }, bearbeiter)).status).toBe(409);
    // Ein Entwurf rechnet dagegen neu.
    const entwurf = await detail((await json(await anlegen("Neu", annahmen({ bewertung: bewertung() })))).id);
    expect(entwurf.ergebnis.bewertungsszenario.beteiligungen[0].faelle[2].wert).toBeNull();
  });

  it("ein Szenario ohne Bewertungsabschnitt hat kein Bewertungsszenario im Ergebnis und rechnet wie zuvor; festgeschrieben bleibt die Prüfsumme gültig", async () => {
    const id = (await json(await anlegen("Ohne", annahmen()))).id as string;
    const d = await detail(id);
    expect("bewertungsszenario" in d.ergebnis).toBe(false);
    expect("bewertung" in d.annahmen).toBe(false);
    await post(`/szenarien/${id}/festschreiben`, undefined, freigeber);
    const fest = await detail(id);
    expect("bewertungsszenario" in fest.ergebnis).toBe(false);
    expect(fest.pruefsumme.gueltig).toBe(true);
    // Eine Zeile, die wie vor Etappe 21 gespeichert wurde (ohne Abschnitt), wird unverändert gelesen und geprüft.
    const zeile = (await db.execute(sql`SELECT annahmen, ergebnis, ergebnis_hash FROM szenario WHERE id = ${id}`)).rows[0] as { annahmen: Record<string, unknown>; ergebnis: Record<string, unknown>; ergebnis_hash: string };
    expect(Object.keys(zeile.annahmen)).not.toContain("bewertung");
    expect(Object.keys(zeile.ergebnis)).not.toContain("bewertungsszenario");
    expect(zeile.ergebnis_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("Rechte wie bei Szenarien: Betrachter lesen, Bearbeiter ändern, Fremde nicht", async () => {
    const id = (await json(await anlegen("Rechte", annahmen({ bewertung: bewertung() })))).id as string;
    expect((await get(`/szenarien/${id}`, betrachter)).status).toBe(200);
    expect((await get(`/szenarien/${id}`, fremd)).status).toBe(403);
    expect((await anlegen("Betrachter", annahmen({ bewertung: bewertung() }), betrachter)).status).toBe(403);
    const geaendert = await patch(`/szenarien/${id}`, { annahmen: annahmen({ bewertung: bewertung() }) }, bearbeiter);
    expect(geaendert.status).toBe(200);
  });

  it("Bericht als PDF und Excel enthält das Bewertungsszenario; ein Entwurf trägt das Wasserzeichen", async () => {
    const id = (await json(await anlegen("Bericht", annahmen({ bewertung: bewertung() })))).id as string;
    const pdf = await get(`/szenarien/${id}/bericht?format=pdf&sprache=de`, betrachter);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    const xlsx = await get(`/szenarien/${id}/bericht?format=xlsx&sprache=en`, betrachter);
    expect(xlsx.status).toBe(200);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await xlsx.arrayBuffer()) as never);
    const text = wb.worksheets.flatMap((b) => b.getSheetValues().flat().map(String)).join("|");
    expect(text).toContain("Valuation scenarios per investment");
    expect(text).toContain("2587500");
    expect(text).toContain("Expected value");
  });
});

describe("Bewertungsszenarien: Kennzahl in Fremdwährung und Exit-Wasserfall (Nacharbeiten 9)", () => {
  const admin = person("bw-admin", { globalVerwalter: true });
  const kurs = (datum: string, quote: string, wert: string) => post("/wechselkurse", { datum, basis: "EUR", quote, kurs: wert }, admin);
  const setzeEinheit = (einheit: string) => db.execute(sql`UPDATE kennzahl_definition SET einheit = ${einheit} WHERE schluessel = 'umsatz'`);
  const multipleFaelle = () => ({
    beteiligungen: {
      [ID.eigen]: {
        faelle: [
          fall("niedrig", "0.5", { art: "multiple", kennzahl: "umsatz", multiple: "1", abzug: "0" }),
          fall("hoch", "0.5", { art: "multiple", kennzahl: "umsatz", multiple: "8", abzug: "5000000.00" }),
        ],
      },
    },
  });

  it("eine Kennzahl in USD wird mit dem Kurs des Basistags umgerechnet (Kennzahl und Abzug in USD); fehlt der Kurs, ist der Fall eine Lücke und nichts wird geschätzt", async () => {
    await legePersonAn(db, admin);
    await setzeEinheit("USD");
    try {
      // ohne Kurs
      const ohne = await json(await anlegen("Ohne Kurs", annahmen({ bewertung: multipleFaelle() })));
      const bOhne = (await detail(ohne.id)).ergebnis.bewertungsszenario;
      expect(bOhne.beteiligungen[0].faelle.map((f: { wert: string | null }) => f.wert)).toEqual([null, null]);
      expect(bOhne.beteiligungen[0].erwartet).toBeNull();
      expect(bOhne.erwartet.nav).toBeNull();
      expect(bOhne.befunde.map((b: { code: string }) => b.code)).toContain("BEWERTUNG_KURS_FEHLT");
      expect(bOhne.befunde.find((b: { code: string }) => b.code === "BEWERTUNG_KURS_FEHLT").params).toMatchObject({ von: "USD", nach: "EUR", stichtag: BASIS });
      expect(bOhne.beteiligungen[0].faelle[0].exit).toBeNull();

      // ein veralteter Kurs (älter als sieben Tage) zählt nicht
      expect((await kurs("2025-01-05", "USD", "1.0000")).status).toBe(201);
      const alt = (await detail((await json(await anlegen("Alter Kurs", annahmen({ bewertung: multipleFaelle() })))).id)).ergebnis.bewertungsszenario;
      expect(alt.beteiligungen[0].faelle[0].wert).toBeNull();

      // mit Kurs: EUR/USD 1,0850 am Basistag
      expect((await kurs(BASIS, "USD", "1.0850")).status).toBe(201);
      const mit = (await detail((await json(await anlegen("Mit Kurs", annahmen({ bewertung: multipleFaelle() })))).id)).ergebnis.bewertungsszenario;
      const [niedrig, hoch] = mit.beteiligungen[0].faelle;
      // niedrig: 5.000.000 USD / 1,0850 × 15 % = 691.244,24; hoch: (40 Mio. − 5 Mio.) USD / 1,0850 × 15 % = 4.838.709,68
      expect(niedrig.wert).toBe("691244.24");
      expect(hoch.wert).toBe("4838709.68");
      expect(hoch.eingaben).toMatchObject({ kennzahlWert: "5000000.00", kennzahlWaehrung: "USD", kurs: "0.92165899", kursDatum: BASIS });
      expect(mit.befunde.map((b: { code: string }) => b.code)).not.toContain("BEWERTUNG_KURS_FEHLT");
    } finally {
      await setzeEinheit("EUR");
    }
  });

  it("zeigt je Fall den Erlös des Fonds aus dem Exit-Wasserfall neben dem Wert des Falls; ohne Kapitaltabelle des Fonds steht ein Grund, der Fall bleibt unberührt", async () => {
    await legePersonAn(db, admin);
    await setzeEinheit("USD");
    try {
      expect((await kurs(BASIS, "USD", "1.0850")).status).toBe(201);
      const b = (await detail((await json(await anlegen("Wasserfall", annahmen({ bewertung: multipleFaelle() })))).id)).ergebnis.bewertungsszenario;
      const [niedrig, hoch] = b.beteiligungen[0].faelle;
      // niedrig: Unternehmenswert 4.608.294,93 EUR; die Vorzugsrechte (1x, nicht beteiligt, 3 Mio. insgesamt) geben dem Fonds 1,5 Mio. statt der 15 % (691.244,24)
      expect(niedrig.exit).toMatchObject({ unternehmenswert: "4608294.93", erloesFonds: "1500000.00", grund: null, unterschied: "808755.76", beteiligungenDesFonds: 1 });
      // hoch: Unternehmenswert 32.258.064,52; die Klasse wandelt in Anteile, der Fonds erhält seine 15 %
      expect(hoch.exit).toMatchObject({ unternehmenswert: "32258064.52", grund: null, beteiligungenDesFonds: 1 });
      expect(Math.abs(Number(hoch.exit.erloesFonds) - Number(hoch.wert))).toBeLessThan(1);
      expect(b.beteiligungen[0].erwartetErloes).toBe(((1500000 + Number(hoch.exit.erloesFonds)) / 2).toFixed(2));
      // der Wert des Falls und die Fondswirkung bleiben die der Methode, nicht die des Wasserfalls
      expect(niedrig.wert).toBe("691244.24");
      expect(b.beteiligungen[0].erwartet).toBe(((691244.24 + 4838709.68) / 2).toFixed(2));

      // Ein Unternehmen ohne Positionen des Fonds in der Kapitaltabelle hat keinen Erlös aus dem Wasserfall.
      const [def] = await db.select().from(s.kennzahlDefinition).where(sql`${s.kennzahlDefinition.schluessel} = 'umsatz'`).limit(1);
      await db.insert(s.kennzahlWert).values({ beteiligungId: ID.darlehen, definitionId: def!.id, periodeBeginn: "2026-07-01", periodeEnde: "2026-09-30", szenario: "ist", wert: "2000000.00", quelle: "intern", erfasstVon: "test", status: "bestaetigt", bestaetigtAm: new Date("2026-02-01T00:00:00Z") });
      const ohneTabelle = {
        beteiligungen: {
          [ID.darlehen]: { faelle: [fall("a", "0.5", { art: "multiple", kennzahl: "umsatz", multiple: "2", abzug: "0", anteil: "0.1" }), fall("b", "0.5", { art: "wert", betrag: "900000.00" })] },
        },
      };
      const r = (await detail((await json(await anlegen("Ohne Tabelle", annahmen({ bewertung: ohneTabelle })))).id)).ergebnis.bewertungsszenario;
      const [a, fest] = r.beteiligungen[0].faelle;
      expect(a.exit).toMatchObject({ erloesFonds: null, grund: "keine_kapitaltabelle", unterschied: null });
      expect(a.wert).toBe("368663.59");
      // ein fester Wert hat keinen Unternehmenswert, also auch keinen Erlös; der Erwartungswert der Erlöse ist dann eine Lücke
      expect(fest.exit).toBeNull();
      expect(r.beteiligungen[0].erwartetErloes).toBeNull();
    } finally {
      await setzeEinheit("EUR");
    }
  });
});
