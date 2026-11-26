import { eq, sql } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import type { Speicher } from "../berichte/speicher";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { buchhaltungAufsetzen, mittelartenAufsetzen } from "./hilfen-buchhaltung";
import { aufrufe, grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";
import { erstelleTestApp, legePersonAn, person, type Testperson } from "./hilfen-auth";
import { vorgaengeEinfuegen } from "./instrument-hilfen";

const { db, pool } = oeffneTestdb();

/** Speicher im Arbeitsspeicher; `scheitern` lässt das nächste Schreiben fehlschlagen (Rücknahme der Nummer). */
class TestSpeicher implements Speicher {
  readonly dateien = new Map<string, Uint8Array>();
  scheitern = false;
  async schreibe(schluessel: string, daten: Uint8Array) {
    if (this.scheitern) {
      this.scheitern = false;
      throw new Error("Speicher nicht erreichbar");
    }
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
const { get, post } = aufrufe(t);
const F1 = ID.fonds;
const F2 = ID.anderer;

const erst = person("e14-erst", { rollen: { [F1]: "freigeber" } });
const pruefer = person("e14-pruefer", { rollen: { [F1]: "freigeber" } });
const freigeber = person("e14-freigeber", { rollen: { [F1]: "freigeber" } });
const bearbeiter = person("e14-bearbeiter", { rollen: { [F1]: "bearbeiter" } });
const betrachter = person("e14-betrachter", { rollen: { [F1]: "betrachter" } });
const nurF2 = person("e14-nurf2", { rollen: { [F2]: "bearbeiter" } });
const verwalter = person("e14-verwalter", { rollen: { [F1]: "verwalter" } });

const anfrage = (methode: string, pfad: string, als: Testperson, body?: unknown) =>
  t.request(pfad, { method: methode, als, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const text = async (bytes: Uint8Array) => (await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true })).text.toLowerCase();

/** Zusage 200.000 und Auszahlung 100.000 am Darlehen; gibt die ID der Auszahlung zurück. */
async function auszahlungAnlegen(betrag = "100000", valuta = "2026-03-31", beteiligungId: string = ID.darlehen): Promise<string> {
  await post(`/investments/${beteiligungId}/transactions`, { type: "commitment", valueDate: "2026-01-01", amount: "200000" });
  const antwort = await post(`/investments/${beteiligungId}/transactions`, { type: "disbursement", valueDate: valuta, amount: betrag });
  expect(antwort.status).toBe(201);
  return (await json(antwort)).transaction.id;
}
const belegAnlegen = async (body: object, als: Testperson = erst) => {
  const antwort = await anfrage("POST", "/vouchers", als, { language: "de", ...body });
  const k = await json(antwort);
  return { antwort, beleg: k };
};
const stufe = (id: string, name: string, als: Testperson, ergebnis = "ok", kommentar?: string) => anfrage("POST", `/vouchers/${id}/stage`, als, { stage: name, result: ergebnis, ...(kommentar ? { comment: kommentar } : {}) });

beforeEach(async () => {
  await grundbestand(db);
  await buchhaltungAufsetzen(db, F1);
  await mittelartenAufsetzen(db, F1);
  for (const p of [erst, pruefer, freigeber, bearbeiter, betrachter, nurF2, verwalter]) await legePersonAn(db, p);
  speicher.dateien.clear();
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Beleg erzeugen und vorbefüllen", () => {
  it("Auszahlung: Stammdaten, Schlüssel zur Buchhaltung, Beträge und Mittelherkunft aus den Geschäftsdaten", async () => {
    const vorgangId = await auszahlungAnlegen();
    await db.insert(s.foerderprogramm).values({ schluessel: "test_beleg", bezeichnung: "Programm Beispiel" }).onConflictDoNothing();
    await anfrage("PUT", `/investments/${ID.darlehen}/accounting-keys`, bearbeiter, { projectNumber: "P-100", contractNumber: "V-7", partnerNumber: "PN-3", companyCode: "BK1", fundingProgram: "test_beleg" });
    const { antwort, beleg } = await belegAnlegen({ type: "disbursement", referenceType: "transaction", referenceId: vorgangId });
    expect(antwort.status).toBe(201);
    expect(beleg).toMatchObject({ status: "draft", type: "disbursement", fundId: F1, investmentId: ID.darlehen, createdBy: await idDe(erst), findings: [], voucherNumber: null });
    expect(beleg.data.values).toMatchObject({
      fundName: "Testfonds Eins",
      organizationName: "Beta Beispiel",
      instrument: "Darlehen",
      projectNumber: "P-100",
      contractNumber: "V-7",
      partnerNumber: "PN-3",
      companyCode: "BK1",
      fundingProgram: "Programm Beispiel",
      voucherDate: "2026-03-31",
      amount: "100000.00",
      commitment: "200000.00",
      totalDisbursed: "100000.00",
      openCommitment: "100000.00",
    });
    // Mittelherkunft nach den Quoten am Belegdatum, cent-genau und summengleich
    expect(beleg.data.sourcesOfFunds.map((m: { key: string; ratio: string; amount: string }) => [m.key, m.ratio, m.amount])).toEqual([
      ["eigenmittel", "0.400000", "40000.00"],
      ["landesmittel", "0.600000", "60000.00"],
    ]);
    expect((await protokollZeilen(db, "beleg", "anlegen")).map((z) => z.akteur)).toEqual([await idDe(erst)]);
  });

  it("Mittelherkunft: Quoten zum Belegdatum und Rest-Cent nach dem größten Rest", async () => {
    await db.delete(s.fondsMittelart);
    await db.insert(s.fondsMittelart).values([
      { fondsId: F1, schluessel: "a", bezeichnungDe: "A", bezeichnungEn: "A", quote: "0.333333", gueltigAb: "2020-01-01", gueltigBis: "2026-12-31" },
      { fondsId: F1, schluessel: "b", bezeichnungDe: "B", bezeichnungEn: "B", quote: "0.333333", gueltigAb: "2020-01-01", gueltigBis: "2026-12-31" },
      { fondsId: F1, schluessel: "c", bezeichnungDe: "C", bezeichnungEn: "C", quote: "0.333334", gueltigAb: "2020-01-01", gueltigBis: "2026-12-31" },
      { fondsId: F1, schluessel: "neu", bezeichnungDe: "Neu", bezeichnungEn: "New", quote: "1.000000", gueltigAb: "2027-01-01" },
    ]);
    const vorgangId = await auszahlungAnlegen("100.01", "2026-03-31");
    const { beleg } = await belegAnlegen({ type: "disbursement", referenceType: "transaction", referenceId: vorgangId });
    const teile = beleg.data.sourcesOfFunds.map((m: { amount: string }) => m.amount);
    expect(teile).toEqual(["33.34", "33.33", "33.34"]);
    expect(teile.reduce((x: number, y: string) => x + Math.round(Number(y) * 100), 0)).toBe(10001);
    const spaeter = await auszahlungAnlegen("500", "2027-06-30", ID.wandel);
    const { beleg: zwei } = await belegAnlegen({ type: "disbursement", referenceType: "transaction", referenceId: spaeter });
    expect(zwei.data.sourcesOfFunds.map((m: { key: string; amount: string }) => [m.key, m.amount])).toEqual([["neu", "500.00"]]);
  });

  it("fehlende Pflichtfelder sind Befunde, nicht stillschweigend leer; Freigabe ist gesperrt, bis sie behoben und der Beleg neu befüllt ist", async () => {
    const vorgangId = await auszahlungAnlegen();
    expect((await anfrage("PUT", `/funds/${F1}/voucher-templates/disbursement`, freigeber, { fields: [{ key: "organizationName", section: "header", required: true }, { key: "amount", section: "header", required: true }, { key: "projectNumber", section: "details", required: true }, { key: "fundingProgram", section: "details", required: true }], headerDe: "Kopf", headerEn: "", footerDe: "", footerEn: "" })).status).toBe(403);
    expect((await anfrage("PUT", `/funds/${F1}/voucher-templates/disbursement`, verwalter, { fields: [{ key: "organizationName", section: "header", required: true }, { key: "amount", section: "header", required: true }, { key: "projectNumber", section: "details", required: true }, { key: "fundingProgram", section: "details", required: true }], headerDe: "Kopf", headerEn: "", footerDe: "", footerEn: "" })).status).toBe(200);
    const { beleg } = await belegAnlegen({ type: "disbursement", referenceType: "transaction", referenceId: vorgangId });
    expect(beleg.findings).toEqual([{ field: "projectNumber", code: "required_field_missing" }, { field: "fundingProgram", code: "required_field_missing" }]);
    expect(beleg.data.values.projectNumber).toBeNull();
    const gesperrt = await stufe(beleg.id, "review", pruefer);
    expect(gesperrt.status).toBe(409);
    expect(await json(gesperrt)).toMatchObject({ error: { code: "voucher_required_field_missing", missingFields: ["projectNumber", "fundingProgram"] } });
    // Angaben nachtragen, neu befüllen: wer das tut, wird Urheber
    await db.insert(s.foerderprogramm).values({ schluessel: "test_beleg", bezeichnung: "Programm Beispiel" }).onConflictDoNothing();
    await anfrage("PUT", `/investments/${ID.darlehen}/accounting-keys`, bearbeiter, { projectNumber: "P-1", fundingProgram: "test_beleg" });
    const neu = await json(await anfrage("POST", `/vouchers/${beleg.id}/refill`, bearbeiter));
    expect(neu).toMatchObject({ findings: [], createdBy: await idDe(bearbeiter), status: "draft" });
    expect(neu.data.values.projectNumber).toBe("P-1");
    expect((await stufe(beleg.id, "review", pruefer)).status).toBe(200);
  });

  it("Bezug muss zur Art passen; ein zweiter Beleg zum selben Vorfall ist abgelehnt; Rechte am Fonds des Vorfalls", async () => {
    const vorgangId = await auszahlungAnlegen();
    const zusage = (await db.select().from(s.vorgang).where(eq(s.vorgang.art, "zusage")))[0]!;
    for (const [art, bezugArt, bezugId] of [
      ["sale", "transaction", vorgangId],
      ["disbursement", "investment", ID.darlehen],
      ["disbursement", "transaction", zusage.id],
      ["interest_posting", "transaction", vorgangId],
    ] as const) {
      const r = await belegAnlegen({ type: art, referenceType: bezugArt, referenceId: bezugId });
      expect(r.antwort.status, `${art}/${bezugArt}`).toBe(409);
      expect(r.beleg.error.code).toBe("voucher_reference_mismatch");
    }
    expect((await belegAnlegen({ type: "disbursement", referenceType: "transaction", referenceId: "00000000-0000-4000-8000-0000000000aa" })).antwort.status).toBe(404);
    // Fremder, vorhandener Vorfall und nicht vorhandener antworten gleich, für jede Bezugsart (kein Hinweis auf Inhalt oder Zustand)
    const [fb] = await db.insert(s.beteiligung).values({ fondsId: F2, organisationId: ID.orgA, instrument: "darlehen", erstinvestment: "2025-01-01" }).returning();
    const [fv] = await vorgaengeEinfuegen(db, { beteiligungId: fb!.id, art: "zusage", valuta: "2025-01-01", betrag: "5.00" });
    const [fl] = await db.insert(s.zinslauf).values({ fondsId: F2, stichtag: "2026-12-31", berechnetVon: "x", status: "verworfen" }).returning();
    const leer = "00000000-0000-4000-8000-0000000000bb";
    for (const [art, bezugArt, fremdId] of [["disbursement", "transaction", fv!.id], ["contract_attachment", "investment", fb!.id], ["interest_posting", "interest_run", fl!.id], ["sale", "sale", leer], ["conversion", "conversion", leer]] as const) {
      const a = await belegAnlegen({ type: art, referenceType: bezugArt, referenceId: fremdId });
      const b = await belegAnlegen({ type: art, referenceType: bezugArt, referenceId: "00000000-0000-4000-8000-0000000000cc" });
      expect(a.antwort.status, bezugArt).toBe(404);
      expect(a.beleg, bezugArt).toEqual(b.beleg);
      expect(a.beleg.error.code).toBe("voucher_reference_not_found");
    }
    const erster = await belegAnlegen({ type: "disbursement", referenceType: "transaction", referenceId: vorgangId });
    const doppelt = await belegAnlegen({ type: "disbursement", referenceType: "transaction", referenceId: vorgangId }, bearbeiter);
    expect(doppelt.antwort.status).toBe(409);
    expect(doppelt.beleg.error).toMatchObject({ code: "voucher_exists", voucherId: erster.beleg.id });
    expect((await belegAnlegen({ type: "disbursement", referenceType: "transaction", referenceId: vorgangId }, betrachter)).antwort.status).toBe(403); // keine Bearbeiterrolle irgendwo
    expect((await belegAnlegen({ type: "disbursement", referenceType: "transaction", referenceId: vorgangId }, nurF2)).antwort.status).toBe(404);
  });

  it("Vertragsanlage, Zinsbuchung (Zinslauf), Verkauf und Wandlung", async () => {
    // Darlehen mit Konditionen: Vertragsanlage
    await auszahlungAnlegen("100000", "2026-01-01");
    await post(`/beteiligungen/${ID.darlehen}/konditionen`, { gueltigAb: "2026-01-01", satzFix: "0.06", methode: "30E/360", zinsperiode: "jaehrlich", anker: "2027-01-01", faelligAm: "2030-12-31" });
    const anlage = (await belegAnlegen({ type: "contract_attachment", referenceType: "investment", referenceId: ID.darlehen })).beleg;
    expect(anlage.data.values).toMatchObject({ commitment: "200000.00", initialInvestment: "2025-01-01", interestRate: "0.06", dayCountMethod: "30E/360", maturityDate: "2030-12-31", amount: "200000.00" });

    // Zinslauf berechnen, prüfen, freigeben, buchen
    const lauf = await json(await post("/zinslaeufe", { fondsId: F1, stichtag: "2027-01-01" }, "rechner"));
    expect((await belegAnlegen({ type: "interest_posting", referenceType: "interest_run", referenceId: lauf.id })).beleg).toMatchObject({ data: { amount: "6000.00", values: { periodCount: "1", asOf: "2027-01-01" } } });
    await post(`/zinslaeufe/${lauf.id}/pruefen`, {}, "a");
    await post(`/zinslaeufe/${lauf.id}/freigeben`, {});
    await post(`/zinslaeufe/${lauf.id}/buchen`, {}, "c");
    // Zins-Vorgang als eigener Bezug
    const zins = (await db.select().from(s.vorgang).where(eq(s.vorgang.art, "zins")))[0]!;
    expect((await belegAnlegen({ type: "interest_posting", referenceType: "transaction", referenceId: zins.id })).beleg.data.amount).toBe("6000.00");
    // verworfener Lauf: kein Beleg
    const zweiter = await json(await post("/zinslaeufe", { fondsId: F1, stichtag: "2027-06-30" }, "rechner"));
    await post(`/zinslaeufe/${zweiter.id}/verwerfen`, {}, "a");
    expect((await belegAnlegen({ type: "interest_posting", referenceType: "interest_run", referenceId: zweiter.id })).antwort.status).toBe(409);

    // Verkauf
    await post(`/investments/${ID.eigen}/transactions`, { type: "commitment", valueDate: "2025-01-01", amount: "1000000" });
    await post(`/investments/${ID.eigen}/transactions`, { type: "disbursement", valueDate: "2025-02-01", amount: "500000" });
    const verkauf = await json(await post(`/beteiligungen/${ID.eigen}/verkauf`, { datum: "2026-06-30", kaufpreis: "700000", kosten: "10000", anteilVerkauft: 1 }, "bearbeiter"));
    const vb = (await belegAnlegen({ type: "sale", referenceType: "sale", referenceId: verkauf.verkauf.id })).beleg;
    expect(vb.data.values).toMatchObject({ purchasePrice: "700000.00", costs: "10000.00", bookValueDisposed: "500000.00", proceeds: "690000.00", gainOrLoss: "190000.00", cashInflow: "690000.00", shareSold: "1", organizationName: "Alpha Beispiel", voucherDate: "2026-06-30" });
    expect(vb.data.amount).toBe("690000.00");
  });

  it("Wandlung als Bezug", async () => {
    await post(`/investments/${ID.wandel}/transactions`, { type: "commitment", valueDate: "2026-01-01", amount: "200000" });
    await post(`/investments/${ID.wandel}/transactions`, { type: "disbursement", valueDate: "2026-01-01", amount: "100000" });
    await post(`/beteiligungen/${ID.wandel}/konditionen`, { gueltigAb: "2026-01-01", satzFix: "0.06", methode: "30E/360", zinsperiode: "jaehrlich", anker: "2027-01-01" });
    const w = await json(await post(`/beteiligungen/${ID.wandel}/wandlung`, { cutoff: "2026-07-01", zinsenWandeln: true, preisregel: { rundenpreisJeAnteil: "12.5", discount: "0.2" }, nennwertJeAnteil: "1", runde: { neu: { bezeichnung: "Serie A", preMoney: "8000000", postMoney: "10000000", preisJeAnteil: "12.5", anteileGesamtNach: "800000" } } }, "bearbeiter"));
    const b = (await belegAnlegen({ type: "conversion", referenceType: "conversion", referenceId: w.wandlung.id })).beleg;
    expect(b.data.values).toMatchObject({ conversionAmount: "103000.00", shareCount: "10300", nominal: "10300.00", premium: "92700.00", fractionalAmount: "0.00", postedInterest: "3000.00", organizationName: "Gamma Beispiel" });
    expect(b.data.amount).toBe("103000.00");
  });
});

const idDe = async (p: Testperson) => (await db.select({ id: s.benutzer.id }).from(s.benutzer).where(eq(s.benutzer.email, p.email)))[0]!.id;

describe("Stufen, Belegnummer und unveränderliche Datei", () => {
  it("zwei Stufen durch zwei verschiedene Personen, beide verschieden vom Ersteller; die Freigabe vergibt die Nummer und speichert das PDF", async () => {
    const vorgangId = await auszahlungAnlegen();
    const { beleg } = await belegAnlegen({ type: "disbursement", referenceType: "transaction", referenceId: vorgangId });
    const id = beleg.id;
    expect((await json(await stufe(id, "review", erst))).error.code).toBe("four_eyes_violated");
    expect((await json(await stufe(id, "approval", pruefer))).error.code).toBe("voucher_stage_wrong");
    expect((await stufe(id, "review", bearbeiter)).status).toBe(403); // Bearbeiter dürfen keine Stufe erteilen
    const geprueft = await json(await stufe(id, "review", pruefer));
    expect(geprueft).toMatchObject({ status: "reviewed", nextStage: 1, voucherNumber: null });
    expect((await json(await stufe(id, "approval", pruefer))).error.code).toBe("four_eyes_violated");
    expect((await json(await stufe(id, "approval", erst))).error.code).toBe("four_eyes_violated");
    // Rückgabe verlangt einen Kommentar und nimmt die Prüfung zurück
    expect((await stufe(id, "approval", freigeber, "returned")).status).toBe(400);
    expect(await json(await stufe(id, "approval", freigeber, "returned", "Betrag prüfen"))).toMatchObject({ status: "draft", nextStage: 0 });
    expect((await stufe(id, "review", pruefer)).status).toBe(200);
    const frei = await json(await stufe(id, "approval", freigeber));
    expect(frei).toMatchObject({ status: "approved", voucherNumber: "B-000001", voucherSequence: 1, nextStage: 2, fileName: "beleg-B-000001.pdf" });
    expect(frei.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(speicher.dateien.has(`belege/${id}/${frei.fileSha256}.pdf`)).toBe(true);
    expect((await protokollZeilen(db, "beleg")).map((z) => z.aktion)).toEqual(["anlegen", "pruefen", "zurueckgeben", "pruefen", "freigeben"]);

    // Detail: Protokoll der Stufen mit Akteur, keine weitere Stufe
    const detail = await json(await get(`/vouchers/${id}`, "a"));
    expect(detail.history.map((p: { stage: string; result: string }) => `${p.stage}:${p.result}`)).toEqual(["review:ok", "approval:returned", "review:ok", "approval:ok"]);
    expect(detail.nextStageName).toBeNull();
    expect((await json(await stufe(id, "approval", freigeber))).error.code).toBe("voucher_status_invalid");
  });

  it("nach der Freigabe unveränderlich: Datenbank-Trigger, Neubefüllen abgelehnt, Datei mit Hash geprüft und im PDF die Nummer", async () => {
    const vorgangId = await auszahlungAnlegen();
    const { beleg } = await belegAnlegen({ type: "disbursement", referenceType: "transaction", referenceId: vorgangId });
    await stufe(beleg.id, "review", pruefer);
    const frei = await json(await stufe(beleg.id, "approval", freigeber));
    await expect(db.update(s.beleg).set({ sprache: "en" }).where(eq(s.beleg.id, beleg.id))).rejects.toThrow();
    await expect(db.delete(s.beleg).where(eq(s.beleg.id, beleg.id))).rejects.toThrow();
    await expect(db.update(s.belegStufe).set({ kommentar: "x" }).where(eq(s.belegStufe.belegId, beleg.id))).rejects.toThrow();
    await expect(db.delete(s.belegStufe).where(eq(s.belegStufe.belegId, beleg.id))).rejects.toThrow();
    expect((await json(await anfrage("POST", `/vouchers/${beleg.id}/refill`, bearbeiter))).error.code).toBe("voucher_status_invalid");

    const datei = await anfrage("GET", `/vouchers/${beleg.id}/file`, betrachter);
    expect(datei.status).toBe(200);
    expect(datei.headers.get("content-type")).toBe("application/pdf");
    expect(datei.headers.get("x-file-sha256")).toBe(frei.fileSha256);
    const bytes = new Uint8Array(await datei.arrayBuffer());
    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
    const inhalt = await text(bytes);
    expect(inhalt).toContain("b-000001");
    expect(inhalt).toContain("beta beispiel");
    expect(inhalt).toContain("100.000,00");
    expect(inhalt).toContain("landesmittel");
    expect(inhalt).toContain("60.000,00");
    expect(inhalt).not.toContain("entwurf");
    expect((await protokollZeilen(db, "beleg", "gelesen")).length).toBe(1);
    // gleicher Hash bei jedem Abruf
    expect(new Uint8Array(await (await anfrage("GET", `/vouchers/${beleg.id}/file`, betrachter)).arrayBuffer())).toEqual(bytes);
    // verfälschte Datei im Speicher: 500 file_corrupt
    speicher.dateien.set(`belege/${beleg.id}/${frei.fileSha256}.pdf`, Uint8Array.from([1, 2, 3]));
    const kaputt = await anfrage("GET", `/vouchers/${beleg.id}/file`, betrachter);
    expect(kaputt.status).toBe(500);
    expect((await json(kaputt)).error.code).toBe("file_corrupt");
  });

  it("Entwurf als PDF mit Wasserzeichen, ohne Nummer, Englisch möglich", async () => {
    const vorgangId = await auszahlungAnlegen();
    const { beleg } = await belegAnlegen({ type: "disbursement", referenceType: "transaction", referenceId: vorgangId, language: "en" });
    const datei = await anfrage("GET", `/vouchers/${beleg.id}/file`, betrachter);
    const inhalt = await text(new Uint8Array(await datei.arrayBuffer()));
    expect(inhalt).toContain("draft");
    expect(inhalt).toContain("no number (draft)");
    expect(inhalt).toContain("disbursement");
    expect(inhalt).toContain("state funds");
    expect(datei.headers.get("x-file-sha256")).toBeNull();
  });

  it("lückenlos auch bei gleichzeitiger Freigabe: sechs Belege, sechs Nummern ohne Lücke und Doppelte", async () => {
    await post(`/investments/${ID.darlehen}/transactions`, { type: "commitment", valueDate: "2026-01-01", amount: "2000000" });
    const ids: string[] = [];
    for (let i = 1; i <= 6; i++) {
      const v = await json(await post(`/investments/${ID.darlehen}/transactions`, { type: "disbursement", valueDate: `2026-0${i}-15`, amount: `${i}0000` }));
      const { beleg } = await belegAnlegen({ type: "disbursement", referenceType: "transaction", referenceId: v.transaction.id });
      expect((await stufe(beleg.id, "review", pruefer)).status).toBe(200);
      ids.push(beleg.id);
    }
    const antworten = await Promise.all(ids.map((id) => stufe(id, "approval", freigeber)));
    expect(antworten.map((a) => a.status)).toEqual([200, 200, 200, 200, 200, 200]);
    const nummern = (await Promise.all(antworten.map(json))).map((b) => b.voucherSequence as number).sort((a, b) => a - b);
    expect(nummern).toEqual([1, 2, 3, 4, 5, 6]);
    const zeilen = await db.select({ lfd: s.beleg.belegnummerLfd, nummer: s.beleg.belegnummer }).from(s.beleg);
    expect(new Set(zeilen.map((z) => z.nummer)).size).toBe(6);
    expect(zeilen.map((z) => z.nummer).sort()).toEqual(["B-000001", "B-000002", "B-000003", "B-000004", "B-000005", "B-000006"]);
    const [kreis] = await db.select().from(s.belegNummernkreis).where(eq(s.belegNummernkreis.fondsId, F1));
    expect(kreis!.letzte).toBe(6);
    // die Datenbank erlaubt keine zweite gleiche Nummer im Fonds
    await expect(db.execute(sql`INSERT INTO beleg (fonds_id, art, bezug_art, bezug_id, sprache, status, vorlage, daten, belegnummer, belegnummer_lfd, erstellt_von) VALUES (${F1}, 'auszahlung', 'vorgang', gen_random_uuid(), 'de', 'freigegeben', '{}', '{}', 'X', 3, 'x')`)).rejects.toThrow();
  });

  it("scheitert die Freigabe (Speicher), bleibt die Nummer frei; je Fonds eine eigene Folge mit eigenem Präfix", async () => {
    const v1 = await auszahlungAnlegen();
    const { beleg } = await belegAnlegen({ type: "disbursement", referenceType: "transaction", referenceId: v1 });
    await stufe(beleg.id, "review", pruefer);
    speicher.scheitern = true;
    expect((await stufe(beleg.id, "approval", freigeber)).status).toBe(500);
    expect((await db.select().from(s.beleg).where(eq(s.beleg.id, beleg.id)))[0]).toMatchObject({ status: "geprueft", belegnummer: null });
    expect((await db.select().from(s.belegNummernkreis)).length).toBe(0);
    expect((await json(await stufe(beleg.id, "approval", freigeber))).voucherNumber).toBe("B-000001");

    // zweiter Fonds mit eigenem Präfix: beginnt bei 1
    await db.insert(s.fondsBuchhaltung).values({ fondsId: F2, belegpraefix: "ZW", geaendertVon: "test" });
    const [bet] = await db.insert(s.beteiligung).values({ fondsId: F2, organisationId: ID.orgA, instrument: "darlehen", erstinvestment: "2025-01-01" }).returning();
    const v2 = await auszahlungAnlegen("500", "2026-03-31", bet!.id);
    const f2 = person("e14-f2", { rollen: { [F2]: "freigeber" }, globalVerwalter: false });
    const f2b = person("e14-f2b", { rollen: { [F2]: "freigeber" } });
    const f2c = person("e14-f2c", { rollen: { [F2]: "freigeber" } });
    for (const p of [f2, f2b, f2c]) await legePersonAn(db, p);
    const { beleg: b2 } = await belegAnlegen({ type: "disbursement", referenceType: "transaction", referenceId: v2 }, f2);
    await stufe(b2.id, "review", f2b);
    expect((await json(await stufe(b2.id, "approval", f2c))).voucherNumber).toBe("ZW-000001");
  });

  it("Liste: nur sichtbare Fonds, Filter nach Status und Art", async () => {
    const v1 = await auszahlungAnlegen();
    await belegAnlegen({ type: "disbursement", referenceType: "transaction", referenceId: v1 });
    const liste = await json(await anfrage("GET", `/vouchers?fundId=${F1}`, betrachter));
    expect(liste.data).toHaveLength(1);
    expect(liste.data[0]).toMatchObject({ type: "disbursement", status: "draft", amount: "100000.00", date: "2026-03-31", voucherNumber: null });
    expect((await json(await anfrage("GET", `/vouchers?fundId=${F1}&status=approved`, betrachter))).data).toHaveLength(0);
    expect((await anfrage("GET", `/vouchers?fundId=${F1}`, nurF2)).status).toBe(403);
    expect((await json(await anfrage("GET", "/vouchers", nurF2))).data).toHaveLength(0);
  });
});
