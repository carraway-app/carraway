import ExcelJS from "exceljs";
import { extractText, getDocumentProxy } from "unpdf";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, legePersonAn, person } from "./hilfen-auth";
import { aufrufe, grundbestand, ID } from "./hilfen-instrumente";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const { get, post, put } = aufrufe(t);

const F1 = ID.fonds;
const B = ID.eigen;
const ADMIN = person("bf-admin", { globalVerwalter: true });
const ADMIN2 = person("bf-admin-zwei", { globalVerwalter: true });
const bearbeiter = person("bf-bearbeiter", { rollen: { [F1]: "bearbeiter" } });

const normal = (x: string) => x.replace(/\s+/g, "").toUpperCase();
const pdfText = async (antwort: Response) => {
  const dokument = await getDocumentProxy(new Uint8Array(await antwort.arrayBuffer()));
  return (await extractText(dokument, { mergePages: true })).text.replace(/\s+/g, " ");
};
async function mappe(antwort: Response): Promise<ExcelJS.Workbook> {
  expect(antwort.status, await antwort.clone().text().catch(() => "")).toBe(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await antwort.arrayBuffer());
  return wb;
}
const blatt = async (antwort: Response, name: string): Promise<ExcelJS.Worksheet> => (await mappe(antwort)).getWorksheet(name)!;
/** Zeilen eines Blatts als Objekte (Überschrift → Wert). */
function zeilen(ws: ExcelJS.Worksheet): Record<string, unknown>[] {
  const kopf = (ws.getRow(1).values as unknown[]).slice(1).map(String);
  const aus: Record<string, unknown>[] = [];
  ws.eachRow((r, i) => {
    if (i === 1) return;
    const w = (r.values as unknown[]).slice(1);
    aus.push(Object.fromEntries(kopf.map((k, j) => [k, w[j] instanceof Date ? (w[j] as Date).toISOString().slice(0, 10) : w[j] ?? null])));
  });
  return aus;
}

const definiere = async (objekt: string, name: string, typ: string, optionen?: unknown) => {
  const a = await post("/crm/felder", { objekt, name, typ, ...(optionen ? { optionen } : {}) }, ADMIN);
  expect(a.status, await a.clone().text()).toBe(201);
  return (await json(a)).id as string;
};
const setzeWerte = async (pfad: string, werte: Record<string, unknown>) => expect((await put(pfad, { werte }, ADMIN)).status).toBe(200);
const vorlage = (art: string, konfiguration: Record<string, unknown>) => put(`/fonds/${F1}/berichtsvorlagen/${art}`, konfiguration, ADMIN);

beforeEach(async () => {
  await grundbestand(db);
  for (const p of [ADMIN, ADMIN2, bearbeiter]) await legePersonAn(db, p);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Eigene Felder als Spalten in Berichten", () => {
  async function aufbau() {
    const ids = {
      board: await definiere("beteiligung", "Board-Sitz", "kontrollkaestchen"),
      sicherheit: await definiere("instrument", "Sicherheit", "text"),
      lead: await definiere("runde", "Lead-Investor", "text"),
      strategie: await definiere("fonds", "Strategie", "auswahl", { optionen: [{ schluessel: "wachstum", label: "Wachstum", farbe: "blau" }] }),
      lizenz: await definiere("beteiligung", "Lizenzgebühr", "betrag", { waehrung: "USD" }),
      vorgang: await definiere("vorgang", "Projektnummer", "text"),
    };
    await setzeWerte(`/beteiligungen/${B}/felder`, { [ids.board]: true, [ids.lizenz]: "1234.50" });
    await setzeWerte(`/beteiligungen/${B}/instrumentfelder`, { [ids.sicherheit]: "Grundschuld" });
    await setzeWerte(`/fonds/${F1}/felder`, { [ids.strategie]: "wachstum" });
    const runde = "00000000-0000-4000-8000-0000000000d1";
    await pool.query(
      `INSERT INTO finanzierungsrunde (id, organisation_id, bezeichnung, datum, pre_money, post_money, preis_je_anteil, anteile_gesamt_nach, status) VALUES ($1, $2, 'Serie A', '2025-03-01', 1000000, 1500000, 10, 150000, 'abgeschlossen')`,
      [runde, ID.orgA],
    );
    await setzeWerte(`/finanzierungsrunden/${runde}/felder`, { [ids.lead]: "Beispiel Kapital" });
    return ids;
  }

  it("die Vorlage prüft die Felder: Definition muss bestehen, aktiv sein und zu Fonds, Runde, Instrument oder Beteiligung gehören", async () => {
    const ids = await aufbau();
    expect((await vorlage("portfolioliste", { zusatzfelder: [ids.board, ids.sicherheit] })).status).toBe(200);
    for (const falsch of [[ids.vorgang], ["00000000-0000-4000-8000-00000000dead"], ["kein-uuid"], [ids.board, ids.board], Array.from({ length: 9 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`)]) {
      expect((await vorlage("portfolioliste", { zusatzfelder: falsch })).status, JSON.stringify(falsch)).toBe(400);
    }
    // nur Arten mit Tabellenspalten
    expect((await vorlage("gremienvorlage", { zusatzfelder: [ids.board] })).status).toBe(400);
    const archiviert = await post(`/crm/felder/${ids.board}/archivieren`, undefined, ADMIN);
    expect(archiviert.status).toBe(200);
    expect((await vorlage("exitliste", { zusatzfelder: [ids.board] })).status).toBe(400);
    const lesen = await json(await get(`/fonds/${F1}/berichtsvorlagen`, ADMIN));
    const liste = lesen.daten.find((d: { art: string }) => d.art === "portfolioliste");
    expect(liste.konfiguration.zusatzfelder).toEqual([ids.board, ids.sicherheit]);
    expect(liste.erlaubt.zusatzfelder).toBe(true);
    expect(lesen.daten.find((d: { art: string }) => d.art === "gremienvorlage").erlaubt.zusatzfelder).toBe(false);
  });

  it("Portfolioliste (Excel und PDF) und Fondsbericht tragen die gewählten Felder aller vier Objekte; die Werte folgen dem Wissensstand", async () => {
    const ids = await aufbau();
    const gewaehlt = [ids.board, ids.sicherheit, ids.lead, ids.strategie, ids.lizenz];
    expect((await vorlage("portfolioliste", { zusatzfelder: gewaehlt })).status).toBe(200);
    expect((await vorlage("fondsbericht", { zusatzfelder: gewaehlt })).status).toBe(200);

    const bericht = await json(await post("/berichte", { art: "portfolioliste", format: "xlsx", fondsId: F1, stichtag: "2025-12-31" }, ADMIN));
    const xlsx = await blatt(await get(`/berichte/${bericht.id}/datei`, ADMIN), "Portfolioliste");
    const alpha = zeilen(xlsx).find((z) => z["Unternehmen"] === "Alpha Beispiel")!;
    expect(alpha).toMatchObject({ "Board-Sitz": "ja", Sicherheit: "Grundschuld", "Lead-Investor": "Beispiel Kapital", Strategie: "Wachstum", "Lizenzgebühr (USD)": 1234.5 });
    // Unternehmen ohne Werte: leer, nie erfunden
    expect(zeilen(xlsx).find((z) => z["Unternehmen"] === "Beta Beispiel")).toMatchObject({ "Board-Sitz": null, Sicherheit: null, "Lead-Investor": null, Strategie: "Wachstum" });

    // Direkter Download des Fondsberichts (PDF) und der Portfolioliste (Excel) nutzt dieselbe Vorlage.
    const pdf = await pdfText(await get(`/fonds/${F1}/berichte/fondsbericht?stichtag=2025-12-31&format=pdf`, ADMIN));
    // Überschriften sind im PDF gesperrt gesetzt: Vergleich ohne Leerraum.
    for (const erwartet of ["Board-Sitz", "Grundschuld", "Beispiel Kapital", "Wachstum", "Lizenzgebühr (USD)", "1.234,50"]) expect(normal(pdf), erwartet).toContain(normal(erwartet));
    const direkt = zeilen(await blatt(await get(`/fonds/${F1}/berichte/portfolioliste?stichtag=2025-12-31`, ADMIN), "Portfolio"));
    expect(direkt.find((z) => z["Unternehmen"] === "Alpha Beispiel")).toMatchObject({ Sicherheit: "Grundschuld" });

    // Wissensstand: ein späterer Wert ändert den früheren Stand nicht.
    await new Promise((r) => setTimeout(r, 30));
    const vorher = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 30));
    await setzeWerte(`/beteiligungen/${B}/instrumentfelder`, { [ids.sicherheit]: "Bürgschaft" });
    const alt = zeilen(await blatt(await get(`/fonds/${F1}/berichte/portfolioliste?stichtag=2025-12-31&stand=${encodeURIComponent(vorher)}`, ADMIN), "Portfolio"));
    expect(alt.find((z) => z["Unternehmen"] === "Alpha Beispiel")).toMatchObject({ Sicherheit: "Grundschuld" });
    const neu = zeilen(await blatt(await get(`/fonds/${F1}/berichte/portfolioliste?stichtag=2025-12-31`, ADMIN), "Portfolio"));
    expect(neu.find((z) => z["Unternehmen"] === "Alpha Beispiel")).toMatchObject({ Sicherheit: "Bürgschaft" });

    // Die beim Anlegen festgehaltene Vorlage gilt, auch wenn die Vorlage des Fonds danach anders ist.
    expect((await vorlage("portfolioliste", { zusatzfelder: [] })).status).toBe(200);
    const festgehalten = await blatt(await get(`/berichte/${bericht.id}/datei`, ADMIN), "Portfolioliste");
    expect(zeilen(festgehalten)[0]).toHaveProperty("Board-Sitz");
  });
});

describe("Währungssicht in Berichten", () => {
  const kurs = (datum: string, quote: string, wert: string) => post("/wechselkurse", { datum, basis: "EUR", quote, kurs: wert }, ADMIN);
  async function aufbau(mitAuszahlung = true) {
    await put(`/beteiligungen/${B}/waehrung`, { waehrung: "USD" }, bearbeiter);
    for (const [d, q, k] of [["2025-02-01", "USD", "1.0800"], ["2025-02-01", "GBP", "0.8300"], ["2026-06-30", "USD", "1.1000"], ["2026-06-30", "GBP", "0.8700"]] as const) expect((await kurs(d, q, k)).status).toBe(201);
    await post(`/beteiligungen/${B}/vorgaenge`, { art: "zusage", valuta: "2025-02-01", betragLokal: "200000.00" }, bearbeiter);
    if (mitAuszahlung) await post(`/beteiligungen/${B}/vorgaenge`, { art: "auszahlung", valuta: "2025-02-01", betragLokal: "100000.00" }, bearbeiter);
    const b = await json(await post(`/beteiligungen/${B}/bewertungen`, { stichtag: "2026-06-30", wertLokal: "160000.00", methode: "sonstige", begruendung: "Beispiel" }, ADMIN));
    expect((await post(`/bewertungen/${b.bewertung.id}/freigeben`, undefined, ADMIN2)).status).toBe(200);
  }
  const liste = (suche: string) => get(`/fonds/${F1}/berichte/portfolioliste?stichtag=2026-06-30&${suche}`, ADMIN);

  it("Vergleich: Beträge in der gewählten Währung, Kurse mit Datum im Blatt „Währungssicht“; die Fondswährung bleibt der Standard", async () => {
    await aufbau();
    const standard = zeilen(await blatt(await liste(""), "Portfolio")).find((z) => z["Unternehmen"] === "Alpha Beispiel")!;
    expect(standard["Investiert"]).toBe(92592.59);
    expect(standard["Bewertung"]).toBe(145454.55);

    const wb = await mappe(await liste("waehrungssicht=vergleich&vergleichswaehrung=GBP"));
    const alpha = zeilen(wb.getWorksheet("Portfolio")!).find((z) => z["Unternehmen"] === "Alpha Beispiel")!;
    // 100000 USD / 1,08 = 92592,59 EUR, mal 0,83 = 76851,85 GBP; 160000 USD / 1,10 = 145454,55 EUR, mal 0,87 = 126545,46 GBP
    expect(alpha["Investiert (GBP)"]).toBe(76851.85);
    expect(alpha["Bewertung (GBP)"]).toBe(126545.46);
    const w = zeilen(wb.getWorksheet("Währungssicht")!);
    expect(w.some((z) => z["Paar"] === "EUR/GBP" && z["Kurs"] === 0.87 && z["Kursdatum"] === "2026-06-30" && z["Verwendung"] === "Zeitwert")).toBe(true);
    expect(w.some((z) => z["Paar"] === "EUR/GBP" && z["Kurs"] === 0.83 && z["Kursdatum"] === "2025-02-01" && z["Verwendung"] === "Kosten")).toBe(true);
  });

  it("lokal: je Beteiligung in ihrer Währung, in der Liste ohne Summe in gemischten Währungen; PDF nennt Kurse und Regel", async () => {
    await aufbau();
    const wb = await mappe(await get(`/fonds/${F1}/berichte/fondsbericht?stichtag=2026-06-30&format=xlsx&waehrungssicht=lokal`, ADMIN));
    const alpha = zeilen(wb.getWorksheet("Portfolio")!).find((z) => z["Unternehmen"] === "Alpha Beispiel")!;
    expect(alpha["Investiert (lokal)"]).toBe(100000);
    expect(alpha["Bewertung (lokal)"]).toBe(160000);
    // Beteiligungen in Fondswährung: lokal = Fonds
    const pdf = await pdfText(await get(`/fonds/${F1}/berichte/fondsbericht?stichtag=2026-06-30&format=pdf&waehrungssicht=vergleich&vergleichswaehrung=GBP`, ADMIN));
    expect(pdf).toContain("Währungssicht: Vergleich in GBP");
    expect(pdf).toContain("1 EUR = 0,87 GBP (Kurs vom 30.06.2026, für 30.06.2026)");
    expect(pdf).toContain("1 EUR = 0,83 GBP (Kurs vom 01.02.2025, für 01.02.2025)");
    expect(normal(pdf)).toContain(normal("Investiert (GBP)"));
    expect(pdf).toContain("76.851,85 £");
  });

  it("fehlt ein Kurs, steht „Kurs fehlt“ statt einer Zahl, die Summe ist selbst eine Lücke und das Blatt nennt die Lücke; nie ein geschätzter Kurs", async () => {
    await aufbau();
    // Kein Kurs für CHF: Vergleich in CHF ist überall eine Lücke.
    const wb = await mappe(await liste("waehrungssicht=vergleich&vergleichswaehrung=CHF"));
    const alpha = zeilen(wb.getWorksheet("Portfolio")!).find((z) => z["Unternehmen"] === "Alpha Beispiel")!;
    expect(alpha["Investiert (CHF)"]).toBe("Kurs fehlt");
    expect(alpha["Bewertung (CHF)"]).toBe("Kurs fehlt");
    const luecken = zeilen(wb.getWorksheet("Währungssicht")!).filter((z) => String(z["Grund"] ?? "").startsWith("Kurs fehlt"));
    expect(luecken.length).toBeGreaterThan(0);
    // als PDF-Bericht mit Summenzeile (Portfolioliste): die Summe ist eine Lücke
    const bericht = await json(await post("/berichte", { art: "portfolioliste", format: "pdf", fondsId: F1, stichtag: "2026-06-30", waehrungssicht: "vergleich", vergleichswaehrung: "CHF" }, ADMIN));
    const text = await pdfText(await get(`/berichte/${bericht.id}/datei`, ADMIN));
    expect(text).toContain("Kurs fehlt");
    expect(text).toContain("Kurs fehlt: EUR/CHF");
    expect(normal(text)).toContain(normal("Investiert (CHF)"));
  });

  it("die Sicht wird mit dem Bericht festgehalten und geprüft: Vergleich braucht eine Währung, nicht jede Art hat eine Sicht", async () => {
    await aufbau();
    const fehler = async (koerper: object) => (await post("/berichte", { fondsId: F1, stichtag: "2026-06-30", ...koerper }, ADMIN)).status;
    expect(await fehler({ art: "portfolioliste", format: "xlsx", waehrungssicht: "vergleich" })).toBe(400);
    expect(await fehler({ art: "portfolioliste", format: "xlsx", waehrungssicht: "lokal", vergleichswaehrung: "GBP" })).toBe(400);
    expect(await fehler({ art: "portfolioliste", format: "xlsx", waehrungssicht: "vergleich", vergleichswaehrung: "gbp" })).toBe(400);
    expect(await fehler({ art: "gremienvorlage", waehrungssicht: "lokal" })).toBe(400);
    const angelegt = await json(await post("/berichte", { art: "exitliste", format: "xlsx", fondsId: F1, stichtag: "2026-06-30", waehrungssicht: "vergleich", vergleichswaehrung: "GBP" }, ADMIN));
    expect(angelegt.parameter).toEqual({ waehrung: { sicht: "vergleich", vergleich: "GBP" } });
    expect((await get(`/fonds/${F1}/berichte/portfolioliste?waehrungssicht=vergleich`, ADMIN)).status).toBe(400);
  });
});
