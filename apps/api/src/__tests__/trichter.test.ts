import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { csvFeld } from "../routen/dealflow";
import { erstelleTestApp, legePersonAn, person, type Testperson } from "./hilfen-auth";
import { json, oeffneTestdb } from "./hilfen";
import { grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";

/**
 * Etappe 7: erweiterter Trichter. Die erwarteten Werte rechnet der Test selbst aus den Fixtures (reine Schleifen und
 * Datumsrechnung), unabhängig von den SQL-Abfragen der API. Alle Daten sind erfunden.
 */

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const F1 = ID.fonds;
const F2 = ID.anderer;
const nurF1 = person("betrachter-trichter", { rollen: { [F1]: "betrachter" } });

type Phase = (typeof s.dealPhase.enumValues)[number];
interface Fixture {
  titel: string;
  quelle: string | null;
  betreuung: string | null;
  status: "offen" | "abgesagt" | "investiert";
  fonds: string;
  historie: [Phase, string][];
  /** Tag der Absage (nur abgesagte Deals). */
  absage?: string;
}

const FIXTURES: Fixture[] = [
  { titel: "D1", quelle: "Empfehlung", betreuung: "Anna", status: "investiert", fonds: F1, historie: [["anfrage", "2026-01-10"], ["erstgespraech", "2026-01-20"], ["pruefung", "2026-02-10"], ["due_diligence", "2026-03-01"], ["investitionsausschuss", "2026-04-05"], ["closing", "2026-04-20"]] },
  { titel: "D2", quelle: "Empfehlung", betreuung: "Anna", status: "abgesagt", fonds: F1, historie: [["anfrage", "2026-01-15"], ["erstgespraech", "2026-02-01"]], absage: "2026-02-20" },
  { titel: "D3", quelle: "Messe", betreuung: "Bernd", status: "offen", fonds: F1, historie: [["anfrage", "2026-04-02"], ["erstgespraech", "2026-04-12"], ["pruefung", "2026-06-30"]] },
  { titel: "D4", quelle: "Messe", betreuung: "Bernd", status: "abgesagt", fonds: F1, historie: [["anfrage", "2026-04-10"], ["pruefung", "2026-04-10"]], absage: "2026-07-05" },
  { titel: "D5", quelle: null, betreuung: null, status: "offen", fonds: F1, historie: [["anfrage", "2026-07-20"]] },
  { titel: "D6", quelle: "Empfehlung", betreuung: "Anna", status: "offen", fonds: F2, historie: [["anfrage", "2026-03-05"]] },
  { titel: "D7", quelle: "Empfehlung", betreuung: "Bernd", status: "offen", fonds: F1, historie: [["anfrage", "2026-02-01"], ["pruefung", "2026-02-11"], ["erstgespraech", "2026-02-21"], ["pruefung", "2026-03-03"]] },
];

beforeEach(async () => {
  await grundbestand(db);
  await legePersonAn(db, nurF1);
  for (const f of FIXTURES) {
    const [d] = await db
      .insert(s.deal)
      .values({
        organisationId: ID.orgA,
        fondsId: f.fonds,
        titel: f.titel,
        quelle: f.quelle,
        betreuung: f.betreuung,
        status: f.status,
        phase: f.historie.at(-1)![0],
        aktualisiertAm: new Date(`${f.absage ?? f.historie.at(-1)![1]}T12:00:00Z`),
      })
      .returning();
    let i = 0;
    for (const [phase, am] of f.historie) {
      await db.insert(s.dealPhasenwechsel).values({ dealId: d!.id, vonPhase: i === 0 ? null : f.historie[i - 1]![0], nachPhase: phase, am, erfasstAm: new Date(Date.UTC(2026, 0, 1, 8, 0, i)) });
      i++;
    }
  }
});
afterAll(async () => {
  await pool.end();
});

// Erwartung aus den Fixtures ------------------------------------------------------------------------------------------

const quartal = (datum: string) => `${datum.slice(0, 4)}-Q${Math.floor((Number(datum.slice(5, 7)) - 1) / 3) + 1}`;
const tageZwischen = (von: string, bis: string) => Math.round((Date.parse(bis) - Date.parse(von)) / 86_400_000);
const runde = (zahl: number, stellen: number) => Math.round(zahl * 10 ** stellen) / 10 ** stellen;
const PHASEN = s.dealPhase.enumValues;

interface Filter {
  von?: string;
  bis?: string;
  fonds?: string;
  sichtbar?: string[];
}

function erwartung({ von, bis, fonds, sichtbar }: Filter = {}) {
  const kohorte = FIXTURES.filter((f) => {
    const eintritt = f.historie[0]![1];
    return (!fonds || f.fonds === fonds) && (!sichtbar || sichtbar.includes(f.fonds)) && (!von || eintritt >= von) && (!bis || eintritt <= bis);
  });
  // Zeitreihe
  const q = new Map<string, { eingang: number; abschluss: number; absage: number }>();
  const eintrag = (schluessel: string) => q.get(schluessel) ?? q.set(schluessel, { eingang: 0, abschluss: 0, absage: 0 }).get(schluessel)!;
  for (const f of kohorte) {
    eintrag(quartal(f.historie[0]![1])).eingang++;
    if (f.status === "investiert") eintrag(quartal(f.historie.filter(([p]) => p === "closing").at(-1)![1])).abschluss++;
    if (f.status === "abgesagt") eintrag(quartal(f.absage!)).absage++;
  }
  const schluessel = [...q.keys()].sort();
  const zeitreihe: { quartal: string; eingang: number; abschluss: number; absage: number }[] = [];
  if (schluessel.length > 0) {
    let [jahr, qu] = schluessel[0]!.split("-Q").map(Number) as [number, number];
    const [endeJahr, endeQu] = schluessel.at(-1)!.split("-Q").map(Number) as [number, number];
    while (jahr < endeJahr || (jahr === endeJahr && qu <= endeQu)) {
      zeitreihe.push({ quartal: `${jahr}-Q${qu}`, ...(q.get(`${jahr}-Q${qu}`) ?? { eingang: 0, abschluss: 0, absage: 0 }) });
      qu++;
      if (qu > 4) {
        qu = 1;
        jahr++;
      }
    }
  }
  // Verweildauer je Phase aus den abgeschlossenen Aufenthalten
  const summe = new Map<string, { n: number; tage: number }>();
  for (const f of kohorte) {
    f.historie.forEach(([phase, am], i) => {
      const naechster = f.historie[i + 1];
      if (!naechster) return;
      const z = summe.get(phase) ?? { n: 0, tage: 0 };
      z.n++;
      z.tage += tageZwischen(am, naechster[1]);
      summe.set(phase, z);
    });
  }
  const verweildauer = PHASEN.map((phase) => ({ phase, anzahl: summe.get(phase)?.n ?? 0, tage: summe.has(phase) ? runde(summe.get(phase)!.tage / summe.get(phase)!.n, 1) : null }));
  // Konversion je Gruppe
  const gruppe = (wert: (f: Fixture) => string | null) => {
    const m = new Map<string | null, Fixture[]>();
    for (const f of kohorte) m.set(wert(f), [...(m.get(wert(f)) ?? []), f]);
    return [...m.entries()].map(([name, liste]) => ({
      name,
      deals: liste.length,
      offen: liste.filter((f) => f.status === "offen").length,
      abgesagt: liste.filter((f) => f.status === "abgesagt").length,
      investiert: liste.filter((f) => f.status === "investiert").length,
      konversion: runde(liste.filter((f) => f.status === "investiert").length / liste.length, 4),
    }));
  };
  return { kohorte, zeitreihe, verweildauer, nachQuelle: gruppe((f) => f.quelle), nachBetreuung: gruppe((f) => f.betreuung) };
}

const sortiere = <T extends { name: string | null }>(zeilen: T[]) => [...zeilen].sort((a, b) => (a.name ?? "￿").localeCompare(b.name ?? "￿"));
const holeTrichter = async (abfrage = "", als?: Testperson) => json(await t.request(`/dealflow/trichter${abfrage}`, als ? { als } : {}));

describe("Trichter, erweitert", () => {
  it("Zeitreihe je Quartal: Eingänge, Abschlüsse und Absagen, auch Quartale ohne Ereignis", async () => {
    const e = erwartung();
    const antwort = await holeTrichter();
    expect(antwort.zeitreihe).toEqual(e.zeitreihe);
    // Q1: 4 Eingänge (D1, D2, D6, D7) und 1 Absage; Q2: 2 Eingänge, 1 Abschluss; Q3: 1 Eingang, 1 Absage
    expect(e.zeitreihe).toEqual([
      { quartal: "2026-Q1", eingang: 4, abschluss: 0, absage: 1 },
      { quartal: "2026-Q2", eingang: 2, abschluss: 1, absage: 0 },
      { quartal: "2026-Q3", eingang: 1, abschluss: 0, absage: 1 },
    ]);
    expect(antwort.gesamt).toEqual({ deals: 7, offen: 4, abgesagt: 2, investiert: 1 });
  });

  it("Verweildauer je Phase: Mittel der abgeschlossenen Aufenthalte, laufende Phase zählt nicht, Rücksprünge sind eigene Aufenthalte", async () => {
    const e = erwartung();
    const antwort = await holeTrichter();
    expect(antwort.verweildauer).toEqual(e.verweildauer);
    // Von Hand geprüft: anfrage 10+14+... (D1 10, D2 17, D3 10, D4 0, D7 10); letzte Phasen laufen noch
    const anfrage = antwort.verweildauer.find((d: { phase: string }) => d.phase === "anfrage");
    expect(anfrage).toEqual({ phase: "anfrage", anzahl: 5, tage: runde((10 + 17 + 10 + 0 + 10) / 5, 1) });
    expect(antwort.verweildauer.find((d: { phase: string }) => d.phase === "closing")).toEqual({ phase: "closing", anzahl: 0, tage: null });
  });

  it("Konversion nach Quelle und nach Betreuung, mit fehlender Angabe als eigene Gruppe", async () => {
    const e = erwartung();
    const antwort = await holeTrichter();
    expect(sortiere(antwort.konversionNachQuelle.map(({ quelle, ...rest }: { quelle: string | null }) => ({ name: quelle, ...rest })))).toEqual(sortiere(e.nachQuelle));
    expect(sortiere(antwort.konversionNachBetreuung.map(({ betreuung, ...rest }: { betreuung: string | null }) => ({ name: betreuung, ...rest })))).toEqual(sortiere(e.nachBetreuung));
    const empfehlung = antwort.konversionNachQuelle.find((g: { quelle: string | null }) => g.quelle === "Empfehlung");
    expect(empfehlung).toMatchObject({ deals: 4, investiert: 1, abgesagt: 1, offen: 2, konversion: 0.25 });
    expect(antwort.konversionNachQuelle.some((g: { quelle: string | null }) => g.quelle === null)).toBe(true);
  });

  it("Filter von, bis und Fonds gelten für alle Teile; die Filter stehen in der Antwort", async () => {
    for (const [abfrage, filter] of [
      [`?von=2026-04-01`, { von: "2026-04-01" }],
      [`?bis=2026-03-31`, { bis: "2026-03-31" }],
      [`?von=2026-02-01&bis=2026-04-02`, { von: "2026-02-01", bis: "2026-04-02" }],
      [`?fondsId=${F2}`, { fonds: F2 }],
      [`?fondsId=${F1}&von=2026-02-01`, { fonds: F1, von: "2026-02-01" }],
    ] as [string, Filter][]) {
      const e = erwartung(filter);
      const antwort = await holeTrichter(abfrage);
      expect(antwort.zeitreihe, abfrage).toEqual(e.zeitreihe);
      expect(antwort.verweildauer, abfrage).toEqual(e.verweildauer);
      expect(antwort.gesamt.deals, abfrage).toBe(e.kohorte.length);
      expect(sortiere(antwort.konversionNachQuelle.map(({ quelle, ...rest }: { quelle: string | null }) => ({ name: quelle, ...rest }))), abfrage).toEqual(sortiere(e.nachQuelle));
    }
    expect((await holeTrichter(`?von=2026-04-01`)).filter).toEqual({ von: "2026-04-01", bis: null, fondsId: null });
    // Ein Zeitraum ohne Deals ergibt leere Reihen statt Fehler
    const leer = await holeTrichter(`?von=2030-01-01`);
    expect(leer.zeitreihe).toEqual([]);
    expect(leer.gesamt.deals).toBe(0);
  });

  it("zählt für Personen mit Rolle nur an Fonds 1 keine Deals des Fonds 2", async () => {
    const e = erwartung({ sichtbar: [F1] });
    const antwort = await holeTrichter("", nurF1);
    expect(antwort.gesamt.deals).toBe(e.kohorte.length);
    expect(antwort.gesamt.deals).toBe(6);
    expect(antwort.zeitreihe).toEqual(e.zeitreihe);
    expect(antwort.verweildauer).toEqual(e.verweildauer);
  });
});

describe("CSV-Ausfuhr", () => {
  const holeCsv = (abfrage = "", als?: Testperson) => t.request(`/dealflow/trichter/export${abfrage}`, als ? { als } : {});

  it("liefert die Auswertung als CSV mit Kopfzeile je Sprache, Semikolon und Byte-Order-Mark; Betrachter dürfen sie laden", async () => {
    const antwort = await holeCsv("?sprache=en", nurF1);
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("content-type")).toContain("text/csv");
    expect(antwort.headers.get("content-disposition")).toContain("dealflow-trichter.csv");
    // Das Kennzeichen (Byte-Order-Mark) steht in den Rohbytes; `text()` entfernt es.
    const bytes = Buffer.from(await antwort.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.toString("utf8").slice(1);
    expect(text.startsWith("Section;Key;Metric;Value\r\n")).toBe(true);
    const zeilen = text.trimEnd().split("\r\n");
    expect(zeilen).toContain("gesamt;;deals;6");
    expect(zeilen).toContain("quartal;2026-Q1;eingang;3");
    const de = (await (await holeCsv()).text()).split("\r\n")[0];
    expect(de).toBe("Abschnitt;Schlüssel;Kennzahl;Wert");
    // Alle Zahlen der Auswertung stehen in der Datei
    const e = erwartung();
    const vollstaendig = (await (await holeCsv()).text()).split("\r\n");
    for (const z of e.zeitreihe) expect(vollstaendig).toContain(`quartal;${z.quartal};abschluss;${z.abschluss}`);
    for (const d of e.verweildauer) expect(vollstaendig).toContain(`verweildauer;${d.phase};tage_durchschnitt;${d.tage ?? ""}`);
    for (const g of e.nachBetreuung.filter((x) => x.name)) expect(vollstaendig).toContain(`betreuung;${g.name};konversion;${g.konversion}`);
    // Filter gelten auch hier
    expect((await (await holeCsv("?von=2026-04-01")).text()).split("\r\n")).toContain("gesamt;;deals;3");
    expect((await holeCsv("?sprache=fr")).status).toBe(400);
  });

  it("schützt vor Formeln in Tabellenprogrammen und legt ein Lese-Protokoll an", async () => {
    await db.update(s.deal).set({ quelle: '=HYPERLINK("http://beispiel.example";"x")', betreuung: "@Summe;Anna" }).where(eq(s.deal.titel, "D5"));
    const text = await (await holeCsv()).text();
    expect(text).toContain(`quelle;"'=HYPERLINK(""http://beispiel.example"";""x"")";deals;1`);
    expect(text).toContain(`betreuung;"'@Summe;Anna";deals;1`);
    expect(text).not.toMatch(/(^|;)=HYPERLINK/m);
    const protokoll = await protokollZeilen(db, "dealflow_trichter", "gelesen");
    expect(protokoll).toHaveLength(1);
    expect(protokoll[0]).toMatchObject({ nachher: expect.objectContaining({ format: "csv" }) });
  });

  it("csvFeld: Formelzeichen am Anfang bekommen ein Apostroph, Zahlen bleiben unverändert", () => {
    expect(csvFeld("=1+1")).toBe("'=1+1");
    expect(csvFeld("+49")).toBe("'+49");
    expect(csvFeld("-x")).toBe("'-x");
    expect(csvFeld("a;b")).toBe('"a;b"');
    expect(csvFeld(-3)).toBe("-3");
    expect(csvFeld(null)).toBe("");
  });
});
