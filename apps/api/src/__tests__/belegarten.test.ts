import { eq } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import type { Speicher } from "../berichte/speicher";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { buchhaltungAufsetzen, mittelartenAufsetzen } from "./hilfen-buchhaltung";
import { aufrufe, grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";
import { erstelleTestApp, idVon, legePersonAn, person, type Testperson } from "./hilfen-auth";

/** Eigene Belegarten (Issue #52): Anlegen, Rechte, Vorlage, Erzeugung, Nummernkreis, PDF. */

const { db, pool } = oeffneTestdb();
const dateien = new Map<string, Uint8Array>();
const speicher: Speicher = {
  async schreibe(k, d) {
    dateien.set(k, d);
  },
  async lese(k) {
    const d = dateien.get(k);
    if (!d) throw new Error("fehlt");
    return d;
  },
};
const t = erstelleTestApp(db, { speicher });
const { post } = aufrufe(t);
const F1 = ID.fonds;
const F2 = ID.anderer;

const verwalter = person("ba-verwalter", { rollen: { [F1]: "verwalter" } });
const erst = person("ba-erst", { rollen: { [F1]: "freigeber" } });
const pruefer = person("ba-pruefer", { rollen: { [F1]: "freigeber" } });
const freigeber = person("ba-freigeber", { rollen: { [F1]: "freigeber" } });
const bearbeiter = person("ba-bearbeiter", { rollen: { [F1]: "bearbeiter" } });
const betrachter = person("ba-betrachter", { rollen: { [F1]: "betrachter" } });
const fremd = person("ba-fremd", { rollen: { [F2]: "verwalter" } });

const anfrage = (methode: string, pfad: string, als: Testperson, body?: unknown) =>
  t.request(pfad, { method: methode, als, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const text = async (bytes: Uint8Array) => (await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true })).text.toLowerCase();

const artAnlegen = async (extra: object = {}, als: Testperson = verwalter) => anfrage("POST", `/funds/${F1}/voucher-types`, als, { baseType: "disbursement", labelDe: "Abruf Sonderprogramm", labelEn: "Special programme call", ...extra });

async function auszahlungAnlegen(): Promise<string> {
  await post(`/investments/${ID.darlehen}/transactions`, { type: "commitment", valueDate: "2026-01-01", amount: "200000" });
  const antwort = await post(`/investments/${ID.darlehen}/transactions`, { type: "disbursement", valueDate: "2026-03-31", amount: "100000" });
  expect(antwort.status).toBe(201);
  return (await json(antwort)).transaction.id;
}
const belegAnlegen = async (body: object, als: Testperson = erst) => {
  const antwort = await anfrage("POST", "/vouchers", als, { language: "de", ...body });
  return { antwort, beleg: await json(antwort) };
};

beforeEach(async () => {
  await grundbestand(db);
  await buchhaltungAufsetzen(db, F1);
  await mittelartenAufsetzen(db, F1);
  for (const p of [verwalter, erst, pruefer, freigeber, bearbeiter, betrachter, fremd]) await legePersonAn(db, p);
  dateien.clear();
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Eigene Belegarten anlegen und verwalten", () => {
  it("anlegen: nur verwalter des Fonds; Eingabe wird geprüft; Name je Fonds eindeutig; im Protokoll", async () => {
    for (const p of [freigeber, bearbeiter, betrachter, fremd]) expect((await artAnlegen({}, p)).status, p.name).toBe(403);
    const antwort = await artAnlegen();
    expect(antwort.status).toBe(201);
    const art = await json(antwort);
    expect(art).toMatchObject({ fundId: F1, baseType: "disbursement", labelDe: "Abruf Sonderprogramm", labelEn: "Special programme call", active: true });
    expect((await protokollZeilen(db, "beleg_art_eigen", "anlegen")).length).toBe(1);
    expect((await artAnlegen({ labelDe: "ABRUF sonderprogramm" })).status).toBe(400);
    expect((await artAnlegen({ baseType: "gibt_es_nicht", labelDe: "X" })).status).toBe(400);
    expect((await artAnlegen({ labelDe: "  " })).status).toBe(400);
    expect((await artAnlegen({ labelEn: "" , labelDe: "Zwei" })).status).toBe(400);
  });

  it("Liste: feste Arten zuerst unverändert, danach die eigene mit Basis-Art, Katalog der Basis-Art und Standardvorlage", async () => {
    const art = await json(await artAnlegen());
    const liste = (await json(await anfrage("GET", `/funds/${F1}/voucher-templates`, betrachter))).data as { type: string; customTypeId: string | null; standard: boolean; active: boolean; labelDe: string | null; catalog: unknown[]; fields: unknown[] }[];
    expect(liste.slice(0, 7).map((v) => v.customTypeId)).toEqual(Array(7).fill(null));
    const eigene = liste[7]!;
    expect(liste).toHaveLength(8);
    expect(eigene).toMatchObject({ type: "disbursement", customTypeId: art.id, standard: true, active: true, labelDe: "Abruf Sonderprogramm" });
    expect(eigene.catalog).toEqual(liste.find((v) => v.type === "disbursement")!.catalog);
    // Ein anderer Fonds sieht sie nicht.
    expect((await anfrage("GET", `/funds/${F1}/voucher-templates`, fremd)).status).toBe(403);
  });

  it("ändern und stilllegen: Basis-Art bleibt; fremder Fonds und unbekannte Id sind 404", async () => {
    const art = await json(await artAnlegen());
    const neu = { labelDe: "Abruf Plus", labelEn: "Call plus", active: false };
    expect((await anfrage("PUT", `/funds/${F1}/voucher-types/${art.id}`, bearbeiter, neu)).status).toBe(403);
    const geaendert = await anfrage("PUT", `/funds/${F1}/voucher-types/${art.id}`, verwalter, neu);
    expect(geaendert.status).toBe(200);
    expect(await json(geaendert)).toMatchObject({ ...neu, baseType: "disbursement" });
    const verwalter2 = person("ba-verwalter2", { rollen: { [F2]: "verwalter" } });
    await legePersonAn(db, verwalter2);
    expect((await anfrage("PUT", `/funds/${F2}/voucher-types/${art.id}`, verwalter2, neu)).status).toBe(404);
    expect((await anfrage("PUT", `/funds/${F1}/voucher-types/${ID.fonds}`, verwalter, neu)).status).toBe(404);
  });

  it("Vorlage einer eigenen Art: eigene Felder und Pflicht, Kopf- und Fußtext; die Standardvorlage der festen Art bleibt unberührt", async () => {
    const art = await json(await artAnlegen());
    const vorlage = { fields: [{ key: "amount", section: "header", required: true }, { key: "projectNumber", section: "details", required: true, labelDe: "Vorhaben", labelEn: "Project" }], headerDe: "Kopf eigen", headerEn: "Header", footerDe: "Fuß eigen", footerEn: "Footer" };
    expect((await anfrage("PUT", `/funds/${F1}/voucher-templates/${art.id}`, freigeber, vorlage)).status).toBe(403);
    expect((await anfrage("PUT", `/funds/${F1}/voucher-templates/${art.id}`, verwalter, vorlage)).status).toBe(200);
    // Feld, das es in der Basis-Art nicht gibt
    const falsch = await anfrage("PUT", `/funds/${F1}/voucher-templates/${art.id}`, verwalter, { ...vorlage, fields: [{ key: "purchasePrice", section: "header", required: false }] });
    expect(falsch.status).toBe(400);
    expect((await anfrage("PUT", `/funds/${F1}/voucher-templates/${F1}`, verwalter, vorlage)).status).toBe(404);
    const liste = (await json(await anfrage("GET", `/funds/${F1}/voucher-templates`, betrachter))).data as { type: string; customTypeId: string | null; standard: boolean; fields: unknown[]; headerDe: string }[];
    expect(liste.find((v) => v.customTypeId === art.id)).toMatchObject({ standard: false, headerDe: "Kopf eigen" });
    expect(liste.find((v) => v.type === "disbursement" && v.customTypeId === null)).toMatchObject({ standard: true, headerDe: "" });
    // zweimal speichern ändert dieselbe Zeile
    expect((await anfrage("PUT", `/funds/${F1}/voucher-templates/${art.id}`, verwalter, { ...vorlage, headerDe: "Neu" })).status).toBe(200);
    expect(await db.select().from(s.belegVorlage).where(eq(s.belegVorlage.eigeneArtId, art.id))).toHaveLength(1);
  });

  it("löschen: nur ohne Belege (sonst 409, dann stilllegen); die Vorlage entfällt mit", async () => {
    const art = await json(await artAnlegen());
    await anfrage("PUT", `/funds/${F1}/voucher-templates/${art.id}`, verwalter, { fields: [{ key: "amount", section: "header", required: true }], headerDe: "", headerEn: "", footerDe: "", footerEn: "" });
    const vorgangId = await auszahlungAnlegen();
    const { beleg } = await belegAnlegen({ type: "disbursement", customTypeId: art.id, referenceType: "transaction", referenceId: vorgangId });
    expect((await anfrage("DELETE", `/funds/${F1}/voucher-types/${art.id}`, freigeber)).status).toBe(403);
    const gesperrt = await anfrage("DELETE", `/funds/${F1}/voucher-types/${art.id}`, verwalter);
    expect(gesperrt.status).toBe(409);
    expect((await json(gesperrt)).error.code).toBe("voucher_type_in_use");
    await db.delete(s.belegStufe);
    await db.delete(s.beleg).where(eq(s.beleg.id, beleg.id));
    expect((await anfrage("DELETE", `/funds/${F1}/voucher-types/${art.id}`, verwalter)).status).toBe(204);
    expect(await db.select().from(s.belegVorlage).where(eq(s.belegVorlage.eigeneArtId, art.id))).toHaveLength(0);
    expect((await anfrage("DELETE", `/funds/${F1}/voucher-types/${art.id}`, verwalter)).status).toBe(404);
  });
});

describe("Belege einer eigenen Art", () => {
  it("erzeugt wie die Basis-Art (Vorbefüllung), mit Vorlage der eigenen Art; Standard- und eigener Beleg zum selben Vorgang koexistieren, doppelt ist 409", async () => {
    const art = await json(await artAnlegen());
    await anfrage("PUT", `/funds/${F1}/voucher-templates/${art.id}`, verwalter, {
      fields: [{ key: "amount", section: "header", required: true }, { key: "projectNumber", section: "details", required: true }],
      headerDe: "Kopf eigen", headerEn: "", footerDe: "Fuß eigen", footerEn: "",
    });
    const vorgangId = await auszahlungAnlegen();
    const { antwort, beleg } = await belegAnlegen({ type: "disbursement", customTypeId: art.id, referenceType: "transaction", referenceId: vorgangId });
    expect(antwort.status).toBe(201);
    expect(beleg).toMatchObject({ type: "disbursement", customTypeId: art.id, investmentId: ID.darlehen });
    expect(beleg.data.values.amount).toBe("100000.00");
    expect(beleg.template.headerDe).toBe("Kopf eigen");
    // Pflichtfeld der eigenen Vorlage fehlt (keine Projektnummer): Befund
    expect(beleg.findings).toEqual([{ field: "projectNumber", code: "required_field_missing" }]);
    expect((await belegAnlegen({ type: "disbursement", customTypeId: art.id, referenceType: "transaction", referenceId: vorgangId })).antwort.status).toBe(409);
    // Der Standardbeleg zum selben Vorgang bleibt möglich und nutzt die Standardvorlage.
    const standard = await belegAnlegen({ type: "disbursement", referenceType: "transaction", referenceId: vorgangId });
    expect(standard.antwort.status).toBe(201);
    expect(standard.beleg).toMatchObject({ customTypeId: null });
    expect(standard.beleg.template.headerDe).toBe("");
    expect((await belegAnlegen({ type: "disbursement", referenceType: "transaction", referenceId: vorgangId })).antwort.status).toBe(409);
  });

  it("Bezug muss zur Basis-Art passen; Art und eigene Art müssen zusammenpassen; stillgelegt und fremde Art werden abgelehnt", async () => {
    const art = await json(await artAnlegen());
    const vorgangId = await auszahlungAnlegen();
    const falscheArt = await belegAnlegen({ type: "interest_posting", customTypeId: art.id, referenceType: "transaction", referenceId: vorgangId });
    expect(falscheArt.antwort.status).toBe(400);
    const unbekannt = await belegAnlegen({ type: "disbursement", customTypeId: F1, referenceType: "transaction", referenceId: vorgangId });
    expect(unbekannt.antwort.status).toBe(404);
    expect(unbekannt.beleg.error.code).toBe("voucher_type_not_found");
    // Bezugsart der Basis-Art gilt weiter: eine Auszahlung braucht einen Vorgang.
    expect((await belegAnlegen({ type: "disbursement", customTypeId: art.id, referenceType: "interest_run", referenceId: vorgangId })).antwort.status).toBe(404);
    await anfrage("PUT", `/funds/${F1}/voucher-types/${art.id}`, verwalter, { labelDe: "Abruf Sonderprogramm", labelEn: "x", active: false });
    const still = await belegAnlegen({ type: "disbursement", customTypeId: art.id, referenceType: "transaction", referenceId: vorgangId });
    expect(still.antwort.status).toBe(409);
    expect(still.beleg.error.code).toBe("voucher_type_retired");
  });

  it("Freigabe teilt den Nummernkreis des Fonds mit den festen Arten; das PDF trägt Namen, Kopf- und Fußtext; Liste und Detail nennen den Namen", async () => {
    const art = await json(await artAnlegen());
    await anfrage("PUT", `/funds/${F1}/voucher-templates/${art.id}`, verwalter, {
      fields: [{ key: "amount", section: "header", required: true }],
      headerDe: "Kopfzeile Sonderprogramm", headerEn: "", footerDe: "Fusszeile Sonderprogramm", footerEn: "",
    });
    const vorgangId = await auszahlungAnlegen();
    const standard = (await belegAnlegen({ type: "disbursement", referenceType: "transaction", referenceId: vorgangId })).beleg;
    const eigen = (await belegAnlegen({ type: "disbursement", customTypeId: art.id, referenceType: "transaction", referenceId: vorgangId })).beleg;
    for (const b of [standard, eigen]) {
      expect((await anfrage("POST", `/vouchers/${b.id}/stage`, pruefer, { stage: "review", result: "ok" })).status).toBe(200);
      expect((await anfrage("POST", `/vouchers/${b.id}/stage`, freigeber, { stage: "approval", result: "ok" })).status).toBe(200);
    }
    const nummern = await db.select({ id: s.beleg.id, nummer: s.beleg.belegnummer }).from(s.beleg);
    expect(nummern.map((n) => n.nummer).sort()).toEqual(["B-000001", "B-000002"]);

    const pdf = await anfrage("GET", `/vouchers/${eigen.id}/file`, betrachter);
    expect(pdf.status).toBe(200);
    const inhalt = await text(new Uint8Array(await pdf.arrayBuffer()));
    expect(inhalt).toContain("abruf sonderprogramm");
    expect(inhalt).toContain("kopfzeile sonderprogramm");
    expect(inhalt).toContain("fusszeile sonderprogramm");
    const standardPdf = await text(new Uint8Array(await (await anfrage("GET", `/vouchers/${standard.id}/file`, betrachter)).arrayBuffer()));
    expect(standardPdf).not.toContain("abruf sonderprogramm");

    const detail = await json(await anfrage("GET", `/vouchers/${eigen.id}`, betrachter));
    expect(detail).toMatchObject({ customTypeId: art.id, typeNameDe: "Abruf Sonderprogramm", typeNameEn: "Special programme call" });
    const liste = (await json(await anfrage("GET", `/vouchers?fundId=${F1}&customTypeId=${art.id}`, betrachter))).data as { id: string; typeNameDe: string }[];
    expect(liste.map((b) => [b.id, b.typeNameDe])).toEqual([[eigen.id, "Abruf Sonderprogramm"]]);
    // Eine später umbenannte oder stillgelegte Art ändert das freigegebene PDF nicht (unveränderliche Datei).
    const vorher = (await db.select({ h: s.beleg.dateiSha256 }).from(s.beleg).where(eq(s.beleg.id, eigen.id)))[0]!.h;
    await anfrage("PUT", `/funds/${F1}/voucher-types/${art.id}`, verwalter, { labelDe: "Neuer Name", labelEn: "New", active: false });
    expect(vorher).toBe((await db.select({ h: s.beleg.dateiSha256 }).from(s.beleg).where(eq(s.beleg.id, eigen.id)))[0]!.h);
  });

  it("neu befüllen behält die eigene Art und nimmt die aktuelle Vorlage der eigenen Art", async () => {
    const art = await json(await artAnlegen());
    const vorgangId = await auszahlungAnlegen();
    const { beleg } = await belegAnlegen({ type: "disbursement", customTypeId: art.id, referenceType: "transaction", referenceId: vorgangId });
    await anfrage("PUT", `/funds/${F1}/voucher-templates/${art.id}`, verwalter, { fields: [{ key: "amount", section: "header", required: true }], headerDe: "Neuer Kopf", headerEn: "", footerDe: "", footerEn: "" });
    const neu = await json(await anfrage("POST", `/vouchers/${beleg.id}/refill`, bearbeiter));
    expect(neu).toMatchObject({ customTypeId: art.id });
    expect(neu.template.headerDe).toBe("Neuer Kopf");
  });
});

describe("Manuelle Belegfelder und freie Vorgangsbezüge", () => {
  const feld = (manuell: string, pflicht = false) => ({ key: `custom_${manuell}`, manual: manuell, section: "details", required: pflicht, labelDe: `Zusatz ${manuell}`, labelEn: `Additional ${manuell}` });
  const vorlage = { fields: [feld("text", true), feld("amount"), feld("date")], headerDe: "", headerEn: "", footerDe: "", footerEn: "" };
  async function freieVorlage() {
    const art = await json(await artAnlegen({ baseType: "custom" }));
    const pfad = `/funds/${F1}/voucher-templates/${art.id}`;
    expect((await anfrage("PUT", pfad, verwalter, vorlage)).status).toBe(200);
    const zusage = await json(await post(`/investments/${ID.darlehen}/transactions`, { type: "commitment", valueDate: "2026-02-12", amount: "3000" }));
    return { pfad, bezug: { type: "custom", customTypeId: art.id, referenceType: "transaction", referenceId: zusage.transaction.id } };
  }

  it("prüft eigene Felddefinitionen und schützt feste Arten und Geschäftsfelder", async () => {
    const { pfad, bezug } = await freieVorlage();
    expect((await anfrage("PUT", `/funds/${F1}/voucher-templates/disbursement`, verwalter, vorlage)).status).toBe(400);
    for (const f of [{ ...feld("text"), key: "betrag" }, feld("zahl"), { ...feld("text"), labelDe: "" }]) {
      expect((await anfrage("PUT", pfad, verwalter, { ...vorlage, fields: [f] })).status).toBe(400);
    }
    expect((await belegAnlegen({ ...bezug, customTypeId: undefined })).antwort.status).toBe(400);
    expect((await belegAnlegen({ ...bezug, type: "disbursement", customTypeId: undefined })).antwort.status).toBe(409);
    for (const werte of [{ custom_date: "2026-02-29" }, { custom_amount: "1.234" }, { custom_text: 42 }, { amount: "99" }, { custom_unknown: "x" }]) {
      expect((await belegAnlegen({ ...bezug, values: werte })).antwort.status).toBe(400);
    }
  });

  it("prüft Pflicht und Typ am Entwurf, erhält Werte beim Neubefüllen und schützt den geprüften Stand", async () => {
    const { bezug, pfad } = await freieVorlage();
    const { antwort, beleg } = await belegAnlegen({ ...bezug, values: { custom_text: "  ", custom_amount: "0", custom_date: "2028-02-29" } });
    expect(antwort.status).toBe(201);
    expect(beleg.data.values).toMatchObject({ amount: "3000.00", custom_text: null, custom_amount: "0.00", custom_date: "2028-02-29" });
    expect(beleg.findings).toEqual([{ field: "custom_text", code: "required_field_missing" }]);
    const pruefen = () => anfrage("POST", `/vouchers/${beleg.id}/stage`, pruefer, { stage: "review", result: "ok" });
    expect((await json(await pruefen())).error.code).toBe("voucher_required_field_missing");
    const aendern = (wer: Testperson, werte: object) => anfrage("PATCH", `/vouchers/${beleg.id}/field-values`, wer, { values: werte });
    for (const wer of [betrachter, fremd]) expect((await aendern(wer, { custom_text: "x" })).status).toBe(403);
    const [rolle] = await db.insert(s.rechterolle).values({ name: "Portfolio", bereiche: ["portfolio"] }).returning();
    const [gruppe] = await db.insert(s.nutzergruppe).values({ name: "Portfolio", stufe: "verwalter", fondsBeschraenkt: false }).returning();
    await db.insert(s.nutzergruppeRolle).values({ gruppeId: gruppe!.id, rolleId: rolle!.id });
    await db.insert(s.nutzergruppeMitglied).values({ gruppeId: gruppe!.id, benutzerId: await idVon(db, erst) });
    expect((await aendern(erst, { custom_text: "x" })).status).toBe(403);
    expect((await belegAnlegen(bezug, erst)).antwort.status).toBe(403);
    expect((await aendern(bearbeiter, { custom_amount: "ungültig" })).status).toBe(400);
    expect(await json(await aendern(bearbeiter, { custom_text: " Eingangsbeleg " }))).toMatchObject({ findings: [], data: { values: { custom_text: "Eingangsbeleg", custom_amount: "0.00" } } });
    await anfrage("PUT", pfad, verwalter, { ...vorlage, fields: [feld("text", true), { ...feld("amount"), manual: "date" }] });
    const neu = await json(await anfrage("POST", `/vouchers/${beleg.id}/refill`, bearbeiter));
    expect(neu.data.values).toMatchObject({ custom_text: "Eingangsbeleg" });
    expect(neu.data.values.custom_amount).toBeUndefined();
    expect(neu.data.values.custom_date).toBeUndefined();
    expect((await pruefen()).status).toBe(200);
    expect((await aendern(bearbeiter, { custom_text: "Änderung" })).status).toBe(409);
    const pdf = await anfrage("GET", `/vouchers/${beleg.id}/file`, betrachter);
    expect(await text(new Uint8Array(await pdf.arrayBuffer()))).toContain("eingangsbeleg");
  });
});
