import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import type { Speicher } from "../berichte/speicher";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { buchhaltungAufsetzen, csvDatei, ladeSusaHoch, susaCsv } from "./hilfen-buchhaltung";
import { aufrufe, grundbestand, ID } from "./hilfen-instrumente";
import { erstelleTestApp, legePersonAn, person, type Testperson } from "./hilfen-auth";

/**
 * Zusammenspiel der Buchhaltung (Etappe 14) mit dem einheitlichen Journal und den Fondsbewegungen (Etappe 4b):
 * Storno im Export, Fondsbewegungen als Buchungseinheit, Belege zu Fondsbewegungen, Belegnummer und Exportstand im Journal,
 * Abstimmung der Liquidität mit Storno-Paaren und das Änderungsprotokoll der neuen Tabellen nach Fondsrechten.
 */

const { db, pool } = oeffneTestdb();
class TestSpeicher implements Speicher {
  readonly dateien = new Map<string, Uint8Array>();
  async schreibe(schluessel: string, daten: Uint8Array) {
    this.dateien.set(schluessel, daten);
  }
  async lese(schluessel: string) {
    const d = this.dateien.get(schluessel);
    if (!d) throw new Error("fehlt");
    return d;
  }
}
const speicher = new TestSpeicher();
const t = erstelleTestApp(db, { speicher });
const { post } = aufrufe(t);
const F1 = ID.fonds;
const F2 = ID.anderer;

const erst = person("e14z-erst", { rollen: { [F1]: "freigeber" } });
const pruefer = person("e14z-pruefer", { rollen: { [F1]: "freigeber" } });
const freigeber = person("e14z-freigeber", { rollen: { [F1]: "freigeber" } });
const bearbeiter = person("e14z-bearbeiter", { rollen: { [F1]: "bearbeiter" } });
const verwalterF1 = person("e14z-verwalter-f1", { rollen: { [F1]: "verwalter" } });
const betrachterF1 = person("e14z-betrachter-f1", { rollen: { [F1]: "betrachter" } });
const verwalterF2 = person("e14z-verwalter-f2", { rollen: { [F2]: "verwalter" } });
const anfrage = (methode: string, pfad: string, als: Testperson, body?: unknown) =>
  t.request(pfad, { method: methode, als, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const dekodiere = (bytes: Uint8Array) => new TextDecoder("windows-1252").decode(bytes);
const datei = async (exportId: string) => dekodiere(new Uint8Array(await (await anfrage("GET", `/posting-exports/${exportId}/file`, bearbeiter)).arrayBuffer()));
const exportieren = (body: object, als: Testperson = bearbeiter) => anfrage("POST", `/funds/${F1}/posting-exports`, als, body);
const buche = (body: object) => anfrage("POST", `/funds/${F1}/postings`, bearbeiter, body);

const regeln = (quellen: string[] = ["auszahlung", "abruf", "ausschuettung"]) =>
  db.insert(s.buchungsregel).values(
    quellen.map((quelle) => ({
      fondsId: F1,
      quelle: quelle as (typeof s.buchungsquelle.enumValues)[number],
      konto: quelle === "ausschuettung" ? "2000" : "1200",
      gegenkonto: quelle === "abruf" ? "2000" : quelle === "ausschuettung" ? "1200" : "0150",
      richtung: "S",
      buSchluessel: null,
      buchungstext: quelle === "auszahlung" ? "Auszahlung {organisation}" : "Fonds {art} {valuta}",
      geaendertVon: "test",
    })),
  );

beforeEach(async () => {
  await grundbestand(db);
  await buchhaltungAufsetzen(db, F1);
  for (const p of [erst, pruefer, freigeber, bearbeiter, verwalterF1, betrachterF1, verwalterF2]) await legePersonAn(db, p);
  speicher.dateien.clear();
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

async function auszahlung(betrag = "12345.67", valuta = "2025-03-31"): Promise<string> {
  await post(`/investments/${ID.darlehen}/transactions`, { type: "commitment", valueDate: "2025-01-01", amount: "200000" });
  const a = await json(await post(`/investments/${ID.darlehen}/transactions`, { type: "disbursement", valueDate: valuta, amount: betrag }));
  return a.transaction.id;
}

describe("Storno im Buchungsexport", () => {
  it("ein schon exportierter Vorgang wird später storniert: das Storno ist exportierbar und wird als Umkehrbuchung geschrieben", async () => {
    await regeln();
    const original = await auszahlung();
    const erster = await exportieren({ transactionIds: [original] });
    expect(erster.status).toBe(201);
    // Das Original bleibt gesperrt, solange keine Wiederholung verlangt wird.
    expect((await exportieren({ transactionIds: [original] })).status).toBe(409);
    const storno = await json(await post(`/transactions/${original}/reverse`, { reason: "Betrag falsch erfasst", valueDate: "2025-04-10" }));
    const zweiter = await exportieren({ transactionIds: [storno.reversal.id] });
    expect(zweiter.status).toBe(201);
    const x = await json(zweiter);
    expect(x.sum).toBe("-12345.67");
    const zeilen = (await datei(x.id)).split("\r\n");
    const felder = zeilen[2]!.split(";");
    // positiver Umsatz, Soll/Haben gegenüber der Regel (S) vertauscht
    expect([felder[0], felder[1]]).toEqual(["12345,67", '"H"']);
    // Original und Storno tragen je eine aktive Markierung
    expect(await db.select().from(s.buchungsexportPosition).where(eq(s.buchungsexportPosition.aktiv, true))).toHaveLength(2);
  });
});

describe("Fondsbewegungen im Buchungsexport", () => {
  it("Abruf, Ausschüttung und ein Storno werden mit ihrer Regel exportiert; ohne Regel, mit fremdem Fonds und doppelt wird abgelehnt", async () => {
    const abruf = await json(await buche({ kind: "fund_posting", type: "capital_call", valueDate: "2025-03-01", amount: "2500000" }));
    const ausschuettung = await json(await buche({ kind: "fund_posting", type: "distribution", valueDate: "2025-09-01", amount: "100000" }));
    const abrufId = abruf.movement.id as string;
    const ausId = ausschuettung.movement.id as string;
    // keine Regel
    const fehlt = await exportieren({ fundMovementIds: [abrufId] });
    expect(fehlt.status).toBe(409);
    expect(await json(fehlt)).toMatchObject({ error: { code: "posting_rule_missing", types: ["capital_call"] } });
    await regeln();
    const vorschau = await json(await anfrage("POST", `/funds/${F1}/posting-exports/preview`, bearbeiter, { fundMovementIds: [abrufId, ausId] }));
    expect(vorschau.rows.map((z: { type: string; transactionId: string | null; fundMovementId: string | null }) => [z.type, z.transactionId, z.fundMovementId])).toEqual([["capital_call", null, abrufId], ["distribution", null, ausId]]);
    const antwort = await exportieren({ fundMovementIds: [abrufId, ausId] });
    expect(antwort.status).toBe(201);
    const x = await json(antwort);
    const zeilen = (await datei(x.id)).split("\r\n");
    const f1 = zeilen[2]!.split(";");
    const f2 = zeilen[3]!.split(";");
    expect([f1[0], f1[1], f1[6], f1[7], f1[13]]).toEqual(["2500000,00", '"S"', "1200", "2000", '"Fonds abruf 2025-03-01"']);
    expect([f2[0], f2[1], f2[6], f2[7]]).toEqual(["100000,00", '"S"', "2000", "1200"]);
    // doppelt
    expect((await exportieren({ fundMovementIds: [abrufId] })).status).toBe(409);
    // Storno einer exportierten Bewegung: eigener Datensatz, Umkehrbuchung
    const storno = await json(await anfrage("POST", `/fondsbewegungen/${abrufId}/storno`, bearbeiter, { grund: "Falscher Betrag", valuta: "2025-03-05" }));
    const stornoId = (storno.storno?.id ?? storno.bewegung?.id) as string;
    expect(stornoId).toBeTruthy();
    const nachStorno = await exportieren({ fundMovementIds: [stornoId] });
    expect(nachStorno.status).toBe(201);
    const sf = (await datei((await json(nachStorno)).id)).split("\r\n")[2]!.split(";");
    expect([sf[0], sf[1]]).toEqual(["2500000,00", '"H"']);
    // Bewegung eines anderen Fonds antwortet wie eine unbekannte
    const [fremd] = await db.insert(s.fondsBewegung).values({ fondsId: F2, art: "abruf", valuta: "2025-03-01", betrag: "10.00" }).returning();
    const fremdAntwort = await exportieren({ fundMovementIds: [fremd!.id] });
    const unbekannt = await exportieren({ fundMovementIds: ["00000000-0000-4000-8000-0000000000aa"] });
    expect(fremdAntwort.status).toBe(404);
    expect(await json(fremdAntwort)).toEqual(await json(unbekannt));
    // genau eines von beiden je Markierung (Datenbank)
    await expect(db.insert(s.buchungsexportPosition).values({ exportId: x.id, belegfeld: "X", betrag: "1.00" })).rejects.toThrow();
  });

  it("eine Wiederholung mit Grund ersetzt die Markierung einer Bewegung", async () => {
    await regeln();
    const abruf = (await json(await buche({ kind: "fund_posting", type: "capital_call", valueDate: "2025-03-01", amount: "1000" }))).movement.id as string;
    expect((await exportieren({ fundMovementIds: [abruf] })).status).toBe(201);
    expect((await exportieren({ fundMovementIds: [abruf], repeat: true })).status).toBe(400);
    expect((await exportieren({ fundMovementIds: [abruf], repeat: true, reason: "Konto korrigiert" })).status).toBe(201);
    const aktiv = await db.select().from(s.buchungsexportPosition).where(and(eq(s.buchungsexportPosition.aktiv, true), eq(s.buchungsexportPosition.fondsBewegungId, abruf)));
    expect(aktiv).toHaveLength(1);
  });
});

describe("Belege zu Fondsbewegungen", () => {
  const belegAnlegen = async (body: object, als: Testperson = erst) => {
    const antwort = await anfrage("POST", "/vouchers", als, { language: "de", ...body });
    return { antwort, beleg: await json(antwort) };
  };
  const stufe = (id: string, name: string, als: Testperson) => anfrage("POST", `/vouchers/${id}/stage`, als, { stage: name, result: "ok" });

  it("Kapitalabruf und Ausschüttung als Beleg; Art und Bewegung müssen zusammenpassen; die Belegnummer steht im Belegfeld des Exports und im Journal", async () => {
    await regeln();
    const abruf = (await json(await buche({ kind: "fund_posting", type: "capital_call", valueDate: "2025-03-01", amount: "2500000" }))).movement.id as string;
    const ausschuettung = (await json(await buche({ kind: "fund_posting", type: "distribution", valueDate: "2025-09-01", amount: "100000" }))).movement.id as string;
    const falsch = await belegAnlegen({ type: "distribution", referenceType: "fund_movement", referenceId: abruf });
    expect(falsch.antwort.status).toBe(409);
    expect(falsch.beleg.error.code).toBe("voucher_reference_mismatch");
    const nichtBewegung = await belegAnlegen({ type: "capital_call_voucher", referenceType: "transaction", referenceId: abruf });
    expect(nichtBewegung.antwort.status).toBe(404); // kein Vorgang mit dieser ID
    const { antwort, beleg } = await belegAnlegen({ type: "capital_call_voucher", referenceType: "fund_movement", referenceId: abruf });
    expect(antwort.status).toBe(201);
    expect(beleg).toMatchObject({ status: "draft", type: "capital_call_voucher", fundId: F1, investmentId: null, findings: [] });
    expect(beleg.data.values).toMatchObject({ fundName: "Testfonds Eins", voucherDate: "2025-03-01", amount: "2500000.00", subscribedCapital: "10000000.00", totalToDate: "2500000.00" });
    expect((await belegAnlegen({ type: "distribution", referenceType: "fund_movement", referenceId: ausschuettung })).antwort.status).toBe(201);
    // Ein Beleg je Art und Bezug
    expect((await belegAnlegen({ type: "capital_call_voucher", referenceType: "fund_movement", referenceId: abruf })).antwort.status).toBe(409);
    // Fremder Fonds: Rolle vor Inhalt, gleiche Antwort wie bei unbekanntem Bezug
    const [fremd] = await db.insert(s.fondsBewegung).values({ fondsId: F2, art: "abruf", valuta: "2025-03-01", betrag: "10.00" }).returning();
    const f = await belegAnlegen({ type: "capital_call_voucher", referenceType: "fund_movement", referenceId: fremd!.id });
    const u = await belegAnlegen({ type: "capital_call_voucher", referenceType: "fund_movement", referenceId: "00000000-0000-4000-8000-0000000000aa" });
    expect(f.antwort.status).toBe(u.antwort.status);
    expect(f.beleg).toEqual(u.beleg);

    // Vor der Freigabe: Journal zeigt keine Belegnummer
    const journal = async () => (await json(await anfrage("GET", `/fonds/${F1}/journal?typ=abruf,ausschuettung`, betrachterF1))).daten as { id: string; buchhaltung: { belegnummer: string | null; exportiertAm: string | null } | null }[];
    expect((await journal()).find((z) => z.id === abruf)!.buchhaltung).toEqual({ belegnummer: null, exportiertAm: null });
    expect((await stufe(beleg.id, "review", pruefer)).status).toBe(200);
    const frei = await stufe(beleg.id, "approval", freigeber);
    expect(frei.status).toBe(200);
    const nummer = (await json(frei)).voucherNumber as string;
    expect(nummer).toMatch(/^B-\d{6}$/);
    expect((await journal()).find((z) => z.id === abruf)!.buchhaltung).toEqual({ belegnummer: nummer, exportiertAm: null });

    // Export: Belegfeld 1 ist die Belegnummer, die Bewegung ohne Beleg trägt eine Ersatzkennung
    const x = await json(await exportieren({ fundMovementIds: [abruf, ausschuettung] }));
    expect(x.withoutVoucher).toEqual([ausschuettung]);
    const zeilen = (await datei(x.id)).split("\r\n");
    expect(zeilen[2]!.split(";")[10]).toBe(`"${nummer}"`);
    const nachExport = (await journal()).find((z) => z.id === abruf)!.buchhaltung!;
    expect(nachExport.belegnummer).toBe(nummer);
    expect(nachExport.exportiertAm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("Journal: Vorgänge zeigen Belegnummer und Exportstand, Bewertungen und Ereignisse nicht", async () => {
    await regeln();
    const vorgangId = await auszahlung();
    const journal = async () => (await json(await anfrage("GET", `/fonds/${F1}/journal`, betrachterF1))).daten as { id: string; typ: string; buchhaltung: { belegnummer: string | null; exportiertAm: string | null } | null }[];
    expect((await journal()).find((z) => z.id === vorgangId)!.buchhaltung).toEqual({ belegnummer: null, exportiertAm: null });
    const { beleg } = await belegAnlegen({ type: "disbursement", referenceType: "transaction", referenceId: vorgangId });
    await stufe(beleg.id, "review", pruefer);
    const nummer = (await json(await stufe(beleg.id, "approval", freigeber))).voucherNumber as string;
    await exportieren({ transactionIds: [vorgangId] });
    const zeile = (await journal()).find((z) => z.id === vorgangId)!;
    expect(zeile.buchhaltung?.belegnummer).toBe(nummer);
    expect(zeile.buchhaltung?.exportiertAm).not.toBeNull();
  });
});

describe("Abstimmung der Liquidität mit Storno-Paaren", () => {
  it("ein Storno nach dem Periodenende zählt nicht, ein Storno bis zum Periodenende hebt sein Original auf", async () => {
    const abruf = (await json(await buche({ kind: "fund_posting", type: "capital_call", valueDate: "2025-03-01", amount: "1000" }))).movement.id as string;
    await buche({ kind: "fund_posting", type: "capital_call", valueDate: "2025-03-15", amount: "500" });
    await db.insert(s.fondsBewegung).values({ fondsId: F1, art: "abruf", valuta: "2025-05-01", betrag: "-1000", storniertBewegungId: abruf });
    // Hochladen = bearbeiter, Prüfen = erst, Übernehmen = freigeber (drei verschiedene Personen)
    const lauf = async (von: string, bis: string) => {
      const antwort = await ladeSusaHoch(t, F1, csvDatei(susaCsv()), von, bis, bearbeiter);
      expect(antwort.status).toBe(201);
      const id = (await json(antwort)).id as string;
      expect((await anfrage("POST", `/balance-runs/${id}/validate`, erst)).status).toBe(200);
      expect((await anfrage("POST", `/balance-runs/${id}/apply`, freigeber)).status).toBe(200);
    };
    // Die Abrufe stehen als erster Schritt im Rechenweg (der Geldeingang selbst sind die LP-Zahlungen, hier keine).
    const carraway = async (bis: string) => {
      const a = await json(await anfrage("GET", `/funds/${F1}/reconciliation?to=${bis}`, betrachterF1));
      expect(a.liquidity.steps[0].label).toBe("Abrufe");
      return a.liquidity.steps[0].value as string;
    };
    // Periodenende vor dem Storno: beide Abrufe zählen
    await lauf("2025-01-01", "2025-03-31");
    expect(await carraway("2025-03-31")).toBe("1500.00");
    // Periodenende nach dem Storno: Original und Storno fallen gemeinsam heraus
    await lauf("2025-04-01", "2025-05-31");
    expect(await carraway("2025-05-31")).toBe("500.00");
  });
});

describe("Änderungsprotokoll der Buchhaltung nach Fondsrechten", () => {
  it("ein Benutzer des Fonds B sieht keine Änderungen an Beleg, Saldenlauf, Konto und Kontenzuordnung des Fonds A, auch keine gelöschten Zeilen", async () => {
    await regeln();
    const vorgangId = await auszahlung();
    const { beleg } = await (async () => {
      const antwort = await anfrage("POST", "/vouchers", erst, { type: "disbursement", referenceType: "transaction", referenceId: vorgangId, language: "de" });
      return { beleg: await json(antwort) };
    })();
    const susa = await ladeSusaHoch(t, F1, csvDatei(susaCsv()), "2025-01-01", "2025-03-31", verwalterF1);
    expect(susa.status).toBe(201);
    const saldenlaufId = (await json(susa)).id as string;
    // Konto anlegen und löschen (Löschzeile im Protokoll), Kontenzuordnung ändern
    expect((await anfrage("PUT", `/funds/${F1}/accounts`, verwalterF1, { accounts: [{ accountNumber: "9999", label: "Testkonto", type: "asset" }] })).status).toBe(200);
    expect((await anfrage("DELETE", `/funds/${F1}/accounts/9999`, verwalterF1)).status).toBe(204);
    expect((await anfrage("PUT", `/funds/${F1}/posting-rules/interest`, verwalterF1, { account: "1200", contraAccount: "4200", direction: "debit", taxKey: null, postingText: "Zins" })).status).toBe(200);
    await exportieren({ transactionIds: [vorgangId] });

    const lies = async (als: Testperson, tabelle: string) => (await json(await anfrage("GET", `/changes?table=${tabelle}&limit=1000`, als))).data as { action: string; recordId: string; fundId: string | null }[];
    const TABELLEN = ["beleg", "saldenlauf", "sachkonto", "buchungsregel", "buchungsexport"];
    for (const tabelle of TABELLEN) {
      const eigen = await lies(verwalterF1, tabelle);
      expect(eigen.length, `${tabelle} für Fonds A`).toBeGreaterThan(0);
      expect(eigen.every((z) => z.fundId === F1), `${tabelle} trägt den Fonds`).toBe(true);
      expect(await lies(verwalterF2, tabelle), `${tabelle} für Fonds B`).toEqual([]);
    }
    expect((await lies(verwalterF1, "beleg")).map((z) => z.recordId)).toContain(beleg.id);
    expect((await lies(verwalterF1, "saldenlauf")).map((z) => z.recordId)).toContain(saldenlaufId);
    expect((await lies(verwalterF1, "sachkonto")).map((z) => z.action)).toContain("loeschen");
    // ohne Tabellenfilter: keine Zeile dieser Tabellen für Fonds B
    const alles = (await json(await anfrage("GET", `/changes?limit=1000`, verwalterF2))).data as { table: string }[];
    expect(alles.filter((z) => TABELLEN.includes(z.table))).toEqual([]);
    // Zeilen ohne Fonds (Stufenprotokoll, Salden, Exportpositionen) erscheinen weder für Fonds B noch ohne Filter
    const ohne = await json(await anfrage("GET", `/changes?limit=1000`, verwalterF2));
    expect(JSON.stringify(ohne)).not.toContain(saldenlaufId);
  });
});
