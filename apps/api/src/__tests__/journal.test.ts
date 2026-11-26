import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, legePersonAn, person } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { anzahl, aufrufe, grundbestand, ID, json, protokollZeilen } from "./hilfen-instrumente";
import { vorgaengeEinfuegen } from "./instrument-hilfen";

const { db, pool } = oeffneTestdb();
const { get, post } = aufrufe(erstelleTestApp(db));

const F1 = ID.fonds;
const F2 = ID.anderer;
const betrachterF1 = person("journal-betrachter-f1", { rollen: { [F1]: "betrachter" } });
const betrachterF2 = person("journal-betrachter-f2", { rollen: { [F2]: "betrachter" } });
const B_F2 = "00000000-0000-4000-8000-0000000000c2";

const journal = async (abfrage = "", als?: Parameters<typeof get>[1]) => json(await get(`/fonds/${F1}/journal${abfrage ? `?${abfrage}` : ""}`, als));
const typen = (d: { daten: { typ: string }[] }) => d.daten.map((z) => z.typ);

/** Erfundener Bestand mit allen Quellen: Vorgänge (auch Zins, Kapitalisierung, Storno), Fondsbewegungen, Bewertung, Verkauf, Insolvenz. */
let vorgangIds: Record<string, string> = {};
let bewegungIds: Record<string, string> = {};

beforeEach(async () => {
  await grundbestand(db);
  await db.insert(s.beteiligung).values({ id: B_F2, fondsId: F2, organisationId: ID.orgA, instrument: "offene_beteiligung", erstinvestment: "2025-01-01" });
  await legePersonAn(db, betrachterF1);
  await legePersonAn(db, betrachterF2);
  const buche = async (beteiligung: string, koerper: object) => (await json(await post(`/investments/${beteiligung}/transactions`, koerper))).transaction.id as string;
  vorgangIds = {};
  vorgangIds.zusage = await buche(ID.darlehen, { type: "commitment", valueDate: "2025-01-10", amount: "100000" });
  vorgangIds.auszahlung = await buche(ID.darlehen, { type: "disbursement", valueDate: "2025-02-10", amount: "60000" });
  vorgangIds.falsch = await buche(ID.darlehen, { type: "disbursement", valueDate: "2025-03-10", amount: "10000" });
  vorgangIds.rueckfluss = await buche(ID.eigen, { type: "return_flow", valueDate: "2025-04-10", amount: "2500.50" });
  vorgangIds.tilgung = await buche(ID.darlehen, { type: "repayment", valueDate: "2025-05-10", amount: "5000" });
  vorgangIds.wertberichtigung = await buche(ID.darlehen, { type: "impairment", valueDate: "2025-06-10", amount: "1000" });
  const storno = await json(await post(`/transactions/${vorgangIds.falsch}/reverse`, { reason: "Falscher Betrag", valueDate: "2025-03-20" }));
  vorgangIds.storno = storno.reversal.id;
  // Zins direkt (Zinsläufe sind eigene Wege): einer ausgezahlt, einer kapitalisiert
  const [zins, kapitalisiert] = await vorgaengeEinfuegen(db, [
      { beteiligungId: ID.darlehen, art: "zins", valuta: "2025-07-10", betrag: "300.00" },
      { beteiligungId: ID.darlehen, art: "zins", valuta: "2025-08-10", betrag: "200.00", kapitalisiert: true },
    ]);
  vorgangIds.zins = zins!.id;
  vorgangIds.kapitalisiert = kapitalisiert!.id;
  const bewegung = async (koerper: object) => (await json(await post(`/funds/${F1}/postings`, { kind: "fund_posting", ...koerper }))).movement.id as string;
  bewegungIds = {};
  bewegungIds.abruf = await bewegung({ type: "capital_call", valueDate: "2025-02-01", amount: "1000000" });
  bewegungIds.ausschuettung = await bewegung({ type: "distribution", valueDate: "2025-09-01", amount: "50000" });
  await db.insert(s.bewertung).values({ beteiligungId: ID.eigen, stichtag: "2025-06-30", wert: "900000.00", methode: "anschaffungskosten", status: "freigegeben", freigegebenVon: "x", freigegebenAm: new Date("2025-07-05T10:00:00Z"), erstelltVon: "y" });
  await db.insert(s.verkauf).values({ beteiligungId: ID.wandel, datum: "2025-10-01", anteilVerkauft: "1", kaufpreis: "7000.00", kosten: "0", buchwertVorher: "0", buchwertAbgang: "0", erloes: "7000.00", ergebnis: "7000.00", barzufluss: "7000.00", schritte: [] });
  await post(`/beteiligungen/${ID.eigen}/insolvenz`, { datum: "2025-11-01" });
  // Von anderen Quellen: Import und Fonds Zwei
  await db.insert(s.importZuordnung).values({ objekt: "vorgang", schluessel: "k1", datensatzId: vorgangIds.zins! });
  await post(`/investments/${B_F2}/transactions`, { type: "commitment", valueDate: "2025-01-11", amount: "5" });
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("GET /fonds/:id/journal", () => {
  it("liefert alle Quellen chronologisch (neueste zuerst), mit Richtung und Kassenwirkung aus Sicht des Fonds", async () => {
    const d = await journal();
    expect(typen(d)).toEqual(["insolvenz", "verkauf", "ausschuettung", "zins", "zins", "wertberichtigung", "tilgung", "rueckfluss", "auszahlung", "auszahlung", "auszahlung", "abruf", "zusage"]);
    expect(d.daten.map((z: { valuta: string }) => z.valuta)).toEqual([...d.daten.map((z: { valuta: string }) => z.valuta)].sort().reverse());
    const nach = (typ: string, filter: (z: { betrag: string | null }) => boolean = () => true) => d.daten.find((z: { typ: string; betrag: string | null }) => z.typ === typ && filter(z));
    expect(nach("auszahlung", (z) => z.betrag === "60000.00")).toMatchObject({ richtung: "abfluss", kassenwirkung: "-60000.00", quelle: "vorgang" });
    expect(nach("rueckfluss")).toMatchObject({ richtung: "zufluss", kassenwirkung: "2500.50" });
    expect(nach("tilgung")).toMatchObject({ richtung: "zufluss", kassenwirkung: "5000.00" });
    expect(nach("abruf")).toMatchObject({ richtung: "zufluss", kassenwirkung: "1000000.00", quelle: "fondsbewegung", beteiligung: null });
    expect(nach("ausschuettung")).toMatchObject({ richtung: "abfluss", kassenwirkung: "-50000.00" });
    expect(nach("zusage")).toMatchObject({ richtung: null, kassenwirkung: null });
    expect(nach("wertberichtigung")).toMatchObject({ richtung: null, kassenwirkung: null });
    // Portfolio-Modell: Eine Zinsbuchung ist eine Forderung, kein Geldeingang (Kasse bewegen erst Zinszahlung und Dividende).
    expect(nach("zins", (z) => z.betrag === "300.00")).toMatchObject({ richtung: null, kassenwirkung: null, kapitalisiert: false });
    expect(nach("zins", (z) => z.betrag === "200.00")).toMatchObject({ richtung: null, kassenwirkung: null, kapitalisiert: true });
    // Der Storno einer Auszahlung dreht die Kassenwirkung um
    expect(nach("auszahlung", (z) => z.betrag === "-10000.00")).toMatchObject({ kassenwirkung: "10000.00", stornoVon: vorgangIds.falsch });
    expect(d.daten[0].beteiligung).toMatchObject({ organisationName: "Alpha Beispiel", instrument: "offene_beteiligung" });
    // Jeder Vorgang nennt sein Instrument, Fondsbewegungen und Ereignisse keines
    expect(d.daten.filter((z: { quelle: string }) => z.quelle === "vorgang").every((z: { instrumentId: string | null; instrumentBezeichnung: string | null }) => z.instrumentId !== null && typeof z.instrumentBezeichnung === "string" && z.instrumentBezeichnung !== "")).toBe(true);
    expect(d.daten.filter((z: { quelle: string }) => z.quelle !== "vorgang").every((z: { instrumentId: string | null; instrumentBezeichnung: string | null }) => z.instrumentId === null && z.instrumentBezeichnung === null)).toBe(true);
    // Fonds Zwei steht nicht im Journal von Fonds Eins
    expect(d.daten.some((z: { betrag: string | null; typ: string }) => z.typ === "zusage" && z.betrag === "5.00")).toBe(false);
    expect(d.weitere).toBe(false);
  });

  it("verknüpft Storno und Original in beide Richtungen und zeigt Ereignisse als Verweise", async () => {
    const d = await journal();
    const original = d.daten.find((z: { id: string }) => z.id === vorgangIds.falsch);
    const storno = d.daten.find((z: { id: string }) => z.id === vorgangIds.storno);
    expect(original).toMatchObject({ storniertDurch: vorgangIds.storno, stornoVon: null });
    expect(storno).toMatchObject({ stornoVon: vorgangIds.falsch, storniertDurch: null, betrag: "-10000.00" });
    const verkauf = d.daten.find((z: { typ: string }) => z.typ === "verkauf");
    expect(verkauf).toMatchObject({ quelle: "ereignis", verweis: { art: "verkauf", storniert: false }, betrag: "7000.00", kassenwirkung: null });
    const insolvenz = d.daten.find((z: { typ: string }) => z.typ === "insolvenz");
    expect(insolvenz).toMatchObject({ valuta: "2025-11-01", verweis: { art: "insolvenz", id: ID.eigen }, beteiligung: { id: ID.eigen } });
  });

  it("nennt Herkunft (manuell, Import, Runde, Wandlung) und die erfassende Person", async () => {
    const d = await journal();
    const herkunft = (id: string) => d.daten.find((z: { id: string }) => z.id === id).herkunft;
    expect(herkunft(vorgangIds.auszahlung!)).toEqual({ art: "manuell", id: null });
    expect(herkunft(vorgangIds.zins!)).toEqual({ art: "import", id: null });
    const manuell = d.daten.find((z: { id: string }) => z.id === vorgangIds.auszahlung);
    expect(manuell.erfasstVon).toMatchObject({ name: "Testperson standard" });
    expect(d.daten.find((z: { id: string }) => z.id === bewegungIds.abruf).erfasstVon).toMatchObject({ name: "Testperson standard" });
    expect(d.daten.find((z: { id: string }) => z.id === vorgangIds.zins).erfasstVon).toBeNull();
    // Runde
    const org = "00000000-0000-4000-8000-0000000000d1";
    await db.insert(s.organisation).values({ id: org, name: "Delta Beispiel", art: "unternehmen" });
    const runde = await json(await post(`/organisationen/${org}/finanzierungsrunden`, { bezeichnung: "Serie A", datum: "2026-03-15", preMoney: "8000000", preisJeAnteil: "10", positionen: [{ fondsId: F1, betrag: "1500000", anteile: "150000", rolle: "lead" }] }));
    const abschluss = await json(await post(`/finanzierungsrunden/${runde.id}/abschliessen`, { fondsBuchungen: [{ positionId: runde.positionen[0].id, auszahlungen: [{ valuta: "2026-03-20", betrag: "100000" }] }] }));
    const d2 = await journal("von=2026-01-01");
    expect(d2.daten).toHaveLength(2);
    for (const z of d2.daten) expect(z.herkunft).toEqual({ art: "runde", id: runde.id });
    expect(abschluss.buchungen[0].vorgangIds).toHaveLength(2);
    // Wandlung
    await post(`/investments/${ID.wandel}/transactions`, { type: "commitment", valueDate: "2026-01-01", amount: "200000" });
    await post(`/investments/${ID.wandel}/transactions`, { type: "disbursement", valueDate: "2026-01-01", amount: "100000" });
    await post(`/beteiligungen/${ID.wandel}/konditionen`, { gueltigAb: "2026-01-01", satzFix: "0.06", methode: "30E/360", zinsperiode: "jaehrlich", anker: "2027-01-01" });
    const wandlung = await json(await post(`/beteiligungen/${ID.wandel}/wandlung`, { cutoff: "2026-07-01", zinsenWandeln: true, preisregel: { rundenpreisJeAnteil: "12.5", discount: "0.2" }, nennwertJeAnteil: "1", runde: { neu: { bezeichnung: "Serie B", preMoney: "8000000", postMoney: "10000000", preisJeAnteil: "12.5", anteileGesamtNach: "800000" } } }));
    const d3 = await journal("von=2026-07-01&bis=2026-07-01");
    expect(d3.daten.filter((z: { quelle: string }) => z.quelle === "vorgang").every((z: { herkunft: { art: string; id: string } }) => z.herkunft.art === "wandlung" && z.herkunft.id === wandlung.wandlung.id)).toBe(true);
    expect(d3.daten.some((z: { typ: string; verweis: { art: string } | null }) => z.typ === "wandlung" && z.verweis?.art === "wandlung")).toBe(true);
  });

  it("filtert nach Zeitraum (einschließlich), Typ, Beteiligung und Unternehmen", async () => {
    expect((await journal("von=2025-03-10&bis=2025-03-20")).daten.map((z: { valuta: string }) => z.valuta).sort()).toEqual(["2025-03-10", "2025-03-20"]);
    expect(typen(await journal("typ=abruf,ausschuettung"))).toEqual(["ausschuettung", "abruf"]);
    expect((await journal(`beteiligungId=${ID.eigen}`)).daten.every((z: { beteiligung: { id: string } }) => z.beteiligung.id === ID.eigen)).toBe(true);
    const org = await journal(`organisationId=${ID.orgB}`);
    expect(org.daten.length).toBeGreaterThan(0);
    expect(org.daten.every((z: { beteiligung: { organisationId: string } | null }) => z.beteiligung?.organisationId === ID.orgB)).toBe(true);
    expect(typen(await journal("typ=bewertung")).every((t) => t === "bewertung")).toBe(true);
    const ohne = await journal();
    expect(typen(ohne)).not.toContain("bewertung");
    const mit = await journal("bewertungen=1");
    expect(typen(mit)).toContain("bewertung");
    expect(mit.daten.find((z: { typ: string; betrag: string }) => z.typ === "bewertung" && z.betrag === "900000.00")).toMatchObject({ betrag: "900000.00", valuta: "2025-06-30", verweis: { art: "bewertung" }, kassenwirkung: null });
    for (const schlecht of ["typ=unbekannt", "von=2025-02-01&bis=2025-01-01", "limit=0", "limit=501", "cursor=xx", "von=morgen", "stand=gestern"]) {
      expect((await get(`/fonds/${F1}/journal?${schlecht}`)).status, schlecht).toBe(400);
    }
  });

  it("Wissensstand: spätere Erfassungen fehlen, ein später erfasstes Storno markiert sein Original nicht", async () => {
    const stornoErfasst = new Date(String((await db.execute(sql`SELECT erfasst_am FROM vorgang WHERE id = ${vorgangIds.storno}`)).rows[0]!.erfasst_am));
    const stand = new Date(stornoErfasst.getTime() - 1).toISOString();
    const d = await journal(`stand=${encodeURIComponent(stand)}`);
    const ids = d.daten.map((z: { id: string }) => z.id);
    expect(ids).toContain(vorgangIds.falsch);
    expect(ids).not.toContain(vorgangIds.storno);
    expect(d.daten.find((z: { id: string }) => z.id === vorgangIds.falsch).storniertDurch).toBeNull();
    // Früher als alles: leer
    expect((await journal(`stand=${encodeURIComponent("2000-01-01T00:00:00Z")}`)).daten).toEqual([]);
    // Summen folgen dem Wissensstand
    const mitStorno = await journal();
    const ohneStorno = await journal(`stand=${encodeURIComponent(stand)}`);
    const aus = (x: { summen: { nachTyp: { typ: string; summe: string }[] } }) => x.summen.nachTyp.find((t) => t.typ === "auszahlung")!.summe;
    expect(aus(mitStorno)).toBe("60000.00");
    expect(aus(ohneStorno)).toBe("70000.00");
  });

  it("Summen je Typ und insgesamt stimmen mit einer unabhängigen Abfrage überein und gelten für den ganzen Filter", async () => {
    const d = await journal("limit=3");
    expect(d.daten).toHaveLength(3);
    expect(d.weitere).toBe(true);
    const erwartet = (await pool.query(`
      SELECT typ, sum(betrag)::text AS summe, count(*)::int AS anzahl FROM (
        SELECT v.art::text AS typ, v.betrag FROM vorgang v JOIN beteiligung b ON b.id = v.beteiligung_id WHERE b.fonds_id = $1
        UNION ALL SELECT art::text, betrag FROM fonds_bewegung WHERE fonds_id = $1) x GROUP BY typ`, [F1])).rows as { typ: string; summe: string; anzahl: number }[];
    for (const e of erwartet) {
      const t = d.summen.nachTyp.find((x: { typ: string }) => x.typ === e.typ);
      expect(t, e.typ).toMatchObject({ summe: e.summe, anzahl: e.anzahl });
    }
    const kasse = (
      await pool.query(`
      SELECT sum(w)::text AS s FROM (
        SELECT CASE WHEN v.art IN ('rueckfluss','tilgung','zinszahlung','dividende') THEN v.betrag WHEN v.art = 'auszahlung' THEN -v.betrag ELSE 0 END AS w FROM vorgang v JOIN beteiligung b ON b.id = v.beteiligung_id WHERE b.fonds_id = $1
        UNION ALL SELECT CASE art WHEN 'abruf' THEN betrag ELSE -betrag END FROM fonds_bewegung WHERE fonds_id = $1) x`, [F1])
    ).rows[0].s as string;
    expect(Number(d.summen.gesamt.kassenwirkung)).toBeCloseTo(Number(kasse), 2);
    // Nicht-Zahlungen haben keine Summe; Ereignisse zählen nur
    expect(d.summen.nachTyp.find((t: { typ: string }) => t.typ === "verkauf")).toMatchObject({ anzahl: 1, summe: null, kassenwirkung: null });
    // Folgeseiten haben keine Summen
    expect((await journal(`limit=3&cursor=${encodeURIComponent(d.naechsterCursor)}`)).summen).toBeNull();
  });

  it("blättert mit Cursor lückenlos und ohne Doppelte, in beiden Richtungen", async () => {
    for (const richtung of ["ab", "auf"]) {
      const ganz = await journal(`richtung=${richtung}&limit=500`);
      const ids: string[] = [];
      let cursor: string | null = null;
      let seiten = 0;
      do {
        const d: { daten: { id: string }[]; naechsterCursor: string | null } = await journal(`richtung=${richtung}&limit=4${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        ids.push(...d.daten.map((z) => z.id));
        cursor = d.naechsterCursor;
        seiten++;
      } while (cursor);
      expect(seiten).toBeGreaterThan(2);
      expect(ids).toEqual(ganz.daten.map((z: { id: string }) => z.id));
      expect(new Set(ids).size).toBe(ids.length);
    }
    const auf = await journal("richtung=auf&limit=500");
    expect(auf.daten[0].typ).toBe("zusage");
  });

  it("Rechte: Betrachter des Fonds liest, fremde Fonds und fremde Beteiligungen nicht", async () => {
    expect((await get(`/fonds/${F1}/journal`, betrachterF1)).status).toBe(200);
    expect((await get(`/fonds/${F1}/journal`, betrachterF2)).status).toBe(403);
    expect((await get(`/fonds/${F1}/journal?beteiligungId=${B_F2}`, betrachterF1)).status).toBe(403);
    // Als Verwalter: eine Beteiligung eines anderen Fonds liefert nichts aus Fonds Eins
    expect((await journal(`beteiligungId=${B_F2}`)).daten).toEqual([]);
    expect((await get(`/fonds/00000000-0000-4000-8000-0000000000ff/journal`)).status).toBe(404);
  });

  it("Export als CSV und Excel mit Kopfzeilen in beiden Sprachen, Zahlen als Zahl, Lese-Protokoll", async () => {
    const csv = await get(`/fonds/${F1}/journal?format=csv&sprache=de`);
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const bytes = new Uint8Array(await csv.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    const zeilen = text.slice(1).trim().split("\r\n");
    expect(zeilen[0]).toBe("Valuta;Erfasst am;Typ;Unternehmen;Instrument;Betrag;Kassenwirkung;Richtung;Storno von;Storniert durch;Herkunft;Erfasst von;Bemerkung");
    expect(zeilen.some((z) => z.includes(";Auszahlung;Beta Beispiel;darlehen;60000.00;-60000.00;Abfluss;"))).toBe(true);
    expect(zeilen.some((z) => z.startsWith("Gesamt (Kassenwirkung);"))).toBe(true);
    const en = await (await get(`/fonds/${F1}/journal?format=csv&sprache=en`)).text();
    expect(en.split("\r\n")[0]).toContain("Value date;Recorded at;Type;Company");
    expect(en).toContain("Disbursement");

    const xlsx = await get(`/fonds/${F1}/journal?format=xlsx&sprache=en&typ=auszahlung,abruf`);
    expect(xlsx.status).toBe(200);
    const mappe = new ExcelJS.Workbook();
    await mappe.xlsx.load((await xlsx.arrayBuffer()) as ArrayBuffer);
    const blatt = mappe.getWorksheet("Journal")!;
    expect(blatt.getRow(1).getCell(1).value).toBe("Value date");
    const betraege = [2, 3, 4, 5].map((r) => blatt.getRow(r).getCell(6).value);
    expect(betraege.every((b) => typeof b === "number")).toBe(true);
    expect(blatt.getRow(2).getCell(1).value).toBeInstanceOf(Date);
    expect(blatt.rowCount).toBe(5);
    expect(mappe.getWorksheet("Totals")).toBeTruthy();
    expect(await protokollZeilen(db, "journal", "gelesen")).toHaveLength(3);
    // Rechte gelten auch für den Export
    expect((await get(`/fonds/${F1}/journal?format=csv`, betrachterF2)).status).toBe(403);
    expect(await anzahl(db, "aenderung", "tabelle = 'journal'")).toBe(3);
  });
});
