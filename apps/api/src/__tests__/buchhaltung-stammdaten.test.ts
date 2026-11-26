import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";
import { erstelleTestApp, legePersonAn, person, type Testperson } from "./hilfen-auth";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const F1 = ID.fonds;
const F2 = ID.anderer;

const verwalter = person("e14-verwalter", { rollen: { [F1]: "verwalter" } });
const freigeber = person("e14-freigeber", { rollen: { [F1]: "freigeber" } });
const bearbeiter = person("e14-bearbeiter", { rollen: { [F1]: "bearbeiter" } });
const betrachter = person("e14-betrachter", { rollen: { [F1]: "betrachter" } });
const fremd = person("e14-fremd", { rollen: { [F2]: "verwalter" } });

const anfrage = (methode: string, pfad: string, als: Testperson, body?: unknown) =>
  t.request(pfad, { method: methode, als, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

beforeEach(async () => {
  await grundbestand(db);
  for (const p of [verwalter, freigeber, bearbeiter, betrachter, fremd]) await legePersonAn(db, p);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Rechte der Stammdaten", () => {
  const schreibend: [string, string, unknown][] = [
    ["PUT", `/funds/${F1}/accounting`, { advisorNumber: 1001, clientNumber: 1, fiscalYearStart: 1, accountNumberLength: 4, voucherPrefix: "B" }],
    ["PUT", `/funds/${F1}/funding-sources`, { validFrom: "2026-01-01", fundingSources: [{ key: "a", labelDe: "A", labelEn: "A", ratio: "1" }] }],
    ["PUT", `/funds/${F1}/accounts`, { accounts: [{ accountNumber: "1200", label: "Bank", type: "asset" }] }],
    ["POST", `/funds/${F1}/layout/standard`, undefined],
    ["PUT", `/funds/${F1}/voucher-templates/disbursement`, { fields: [{ key: "amount", section: "header", required: true }], headerDe: "", headerEn: "", footerDe: "", footerEn: "" }],
    ["PUT", `/funds/${F1}/posting-rules/interest`, { account: "1200", contraAccount: "4200", direction: "debit", taxKey: null, postingText: "Zins {organisation}" }],
  ];

  it("ändern: nur verwalter des Fonds; lesen: betrachter; fremde Fonds: 403", async () => {
    for (const [m, pfad, body] of schreibend) {
      for (const p of [freigeber, bearbeiter, betrachter, fremd]) expect((await anfrage(m, pfad, p, body ?? {})).status, `${m} ${pfad} ${p.name}`).toBe(403);
      expect([200, 201], `${m} ${pfad} verwalter`).toContain((await anfrage(m, pfad, verwalter, body ?? {})).status);
    }
    for (const pfad of ["accounting", "funding-sources", "accounts", "layout", "account-rules", "voucher-templates", "posting-rules"]) {
      expect((await anfrage("GET", `/funds/${F1}/${pfad}`, betrachter)).status, pfad).toBe(200);
      expect((await anfrage("GET", `/funds/${F1}/${pfad}`, fremd)).status, pfad).toBe(403);
    }
  });

  it("Schlüssel zur Buchhaltung an der Beteiligung: bearbeiter ändert, betrachter liest", async () => {
    const pfad = `/investments/${ID.darlehen}/accounting-keys`;
    expect((await anfrage("PUT", pfad, betrachter, {})).status).toBe(403);
    await db.insert(s.foerderprogramm).values({ schluessel: "test_stamm", bezeichnung: "Programm Beispiel" }).onConflictDoNothing();
    expect((await anfrage("PUT", pfad, bearbeiter, { fundingProgram: "test_gibtesnicht" })).status).toBe(404);
    const neu = await anfrage("PUT", pfad, bearbeiter, { projectNumber: "P-100", contractNumber: "V-7", partnerNumber: "PN-3", companyCode: "BK1", fundingProgram: "test_stamm" });
    expect(neu.status).toBe(200);
    expect(await json(await anfrage("GET", pfad, betrachter))).toMatchObject({ projectNumber: "P-100", companyCode: "BK1", fundingProgram: "test_stamm", fundingProgramLabel: "Programm Beispiel" });
    expect((await protokollZeilen(db, "beteiligung_buchhaltung")).map((z) => z.aktion)).toEqual(["anlegen"]);
    // geleert über null
    const leer = await json(await anfrage("PUT", pfad, bearbeiter, { projectNumber: null }));
    expect(leer.projectNumber).toBeNull();
    expect(leer.contractNumber).toBeNull();
  });
});

describe("Konfiguration und Mittelarten", () => {
  it("Konfiguration mit Standardwerten, speichern und Grenzen", async () => {
    expect(await json(await anfrage("GET", `/funds/${F1}/accounting`, verwalter))).toMatchObject({ configured: false, accountNumberLength: 4, voucherPrefix: "B" });
    const ok = { advisorNumber: 1234567, clientNumber: 12345, fiscalYearStart: 7, accountNumberLength: 6, voucherPrefix: "TF1" };
    expect(await json(await anfrage("PUT", `/funds/${F1}/accounting`, verwalter, ok))).toMatchObject({ ...ok, configured: true });
    for (const falsch of [{ ...ok, accountNumberLength: 9 }, { ...ok, fiscalYearStart: 13 }, { ...ok, voucherPrefix: "zu lang und mit Leerzeichen" }, { ...ok, advisorNumber: 12345678 }, { ...ok, advisorNumber: 1000 }]) {
      expect((await anfrage("PUT", `/funds/${F1}/accounting`, verwalter, falsch)).status).toBe(400);
    }
  });

  it("Mittelarten: Quoten ergeben 1, neue Quoten ab Datum lösen den bisherigen Satz ab", async () => {
    const satz = (a: string, b: string) => [
      { key: "land", labelDe: "Landesmittel", labelEn: "State funds", ratio: a },
      { key: "eigen", labelDe: "Eigenmittel", labelEn: "Own funds", ratio: b },
    ];
    const falsch = await anfrage("PUT", `/funds/${F1}/funding-sources`, verwalter, { validFrom: "2025-01-01", fundingSources: satz("0.6", "0.3") });
    expect(falsch.status).toBe(409);
    expect((await json(falsch)).error.code).toBe("funding_sources_sum_invalid");
    expect((await anfrage("PUT", `/funds/${F1}/funding-sources`, verwalter, { validFrom: "2025-01-01", fundingSources: satz("0.6", "0.4") })).status).toBe(200);
    expect((await anfrage("PUT", `/funds/${F1}/funding-sources`, verwalter, { validFrom: "2026-01-01", fundingSources: satz("0.5", "0.5") })).status).toBe(200);
    const zeilen = (await json(await anfrage("GET", `/funds/${F1}/funding-sources`, verwalter))).data;
    expect(zeilen.map((z: { validFrom: string; validTo: string | null; ratio: string }) => [z.validFrom, z.validTo, z.ratio])).toEqual([
      ["2025-01-01", "2025-12-31", "0.400000"],
      ["2025-01-01", "2025-12-31", "0.600000"],
      ["2026-01-01", null, "0.500000"],
      ["2026-01-01", null, "0.500000"],
    ]);
    const frueher = await anfrage("PUT", `/funds/${F1}/funding-sources`, verwalter, { validFrom: "2024-01-01", fundingSources: satz("0.5", "0.5") });
    expect((await json(frueher)).error.code).toBe("funding_sources_period_invalid");
  });
});

describe("Kontenrahmen, Gliederung und Kontenregeln", () => {
  it("Konten anlegen und ändern, Beteiligung muss zum Fonds gehören, Löschen nur ohne Saldo", async () => {
    const neu = await anfrage("PUT", `/funds/${F1}/accounts`, verwalter, { accounts: [{ accountNumber: "1200", label: "Bank", type: "asset" }, { accountNumber: "0150", label: "Ausleihung Beta", type: "asset", investmentId: ID.darlehen }] });
    expect(neu.status).toBe(200);
    await anfrage("PUT", `/funds/${F1}/accounts`, verwalter, { accounts: [{ accountNumber: "1200", label: "Bankkonto", type: "asset" }] });
    expect((await json(await anfrage("GET", `/funds/${F1}/accounts`, verwalter))).data.map((k: { accountNumber: string; label: string }) => [k.accountNumber, k.label])).toEqual([["0150", "Ausleihung Beta"], ["1200", "Bankkonto"]]);
    const [anderer] = await db.insert(s.beteiligung).values({ fondsId: F2, organisationId: ID.orgA, instrument: "darlehen", erstinvestment: "2025-01-01" }).returning();
    const fremdeB = await anfrage("PUT", `/funds/${F1}/accounts`, verwalter, { accounts: [{ accountNumber: "0151", label: "X", type: "asset", investmentId: anderer!.id }] });
    expect((await json(fremdeB)).error.code).toBe("account_investment_foreign");
    expect((await anfrage("PUT", `/funds/${F1}/accounts`, verwalter, { accounts: [{ accountNumber: "12x", label: "X", type: "asset" }] })).status).toBe(400);
    expect((await anfrage("DELETE", `/funds/${F1}/accounts/1200`, verwalter)).status).toBe(204);
    expect((await json(await anfrage("DELETE", `/funds/${F1}/accounts/1200`, verwalter))).error.code).toBe("account_not_found");
  });

  it("Standardgliederung anlegen (idempotent), ändern, Position in Verwendung nicht entfernen, Zyklus ablehnen", async () => {
    const erste = await json(await anfrage("POST", `/funds/${F1}/layout/standard`, verwalter));
    expect(erste.newItems).toBeGreaterThan(30);
    expect((await json(await anfrage("POST", `/funds/${F1}/layout/standard`, verwalter))).newItems).toBe(0);
    const liste = (await json(await anfrage("GET", `/funds/${F1}/layout`, betrachter))).data;
    expect(new Set(liste.map((p: { view: string }) => p.view))).toEqual(new Set(["balance_sheet", "income_statement", "liquidity", "use_of_funds", "portfolio"]));

    const regel = await anfrage("POST", `/funds/${F1}/account-rules`, verwalter, { view: "portfolio", accountFrom: "0100", accountTo: "0199", itemKey: "pf.beteiligungen", validFrom: "2026-01-01" });
    expect(regel.status).toBe(201);
    const nurRest = liste.filter((p: { view: string; key: string }) => p.view === "portfolio" && p.key !== "pf.beteiligungen").map((p: { key: string; parentKey: string | null; labelDe: string; labelEn: string; side: string }) => ({ key: p.key, parentKey: p.parentKey, labelDe: p.labelDe, labelEn: p.labelEn, side: p.side }));
    const verwendet = await anfrage("PUT", `/funds/${F1}/layout/portfolio`, verwalter, { items: nurRest });
    expect((await json(verwendet)).error.code).toBe("layout_item_in_use");
    const zyklus = await anfrage("PUT", `/funds/${F1}/layout/portfolio`, verwalter, {
      items: [
        { key: "a", parentKey: "b", labelDe: "A", labelEn: "A", side: "debit" },
        { key: "b", parentKey: "a", labelDe: "B", labelEn: "B", side: "debit" },
      ],
    });
    expect((await json(zyklus)).error.code).toBe("layout_invalid");
    const ok = await anfrage("PUT", `/funds/${F1}/layout/portfolio`, verwalter, { items: [...nurRest.filter((p: { key: string }) => p.key !== "pf.portfolio"), { key: "pf.beteiligungen", parentKey: null, labelDe: "Beteiligungen", labelEn: "Equity", side: "debit" }].map((p: { parentKey: string | null }) => ({ ...p, parentKey: null })) });
    expect(ok.status).toBe(200);
  });

  it("Kontenregeln sind versioniert: Überschneidung abgelehnt, Ablösung beendet die alte Regel am Tag davor", async () => {
    await anfrage("POST", `/funds/${F1}/layout/standard`, verwalter);
    const neu = (body: object) => anfrage("POST", `/funds/${F1}/account-rules`, verwalter, { view: "balance_sheet", ...body });
    const erste = await json(await neu({ accountFrom: "1200", accountTo: "1299", itemKey: "aktiva.liquide", validFrom: "2026-01-01" }));
    const ueberschneidet = await neu({ accountFrom: "1250", itemKey: "aktiva.forderungen", validFrom: "2026-06-01" });
    expect(ueberschneidet.status).toBe(409);
    expect(await json(ueberschneidet)).toMatchObject({ error: { code: "account_rule_overlaps", conflictingRuleId: erste.id } });
    // anderer Zeitraum oder anderer Bereich: erlaubt
    expect((await neu({ accountFrom: "1300", accountTo: "1399", itemKey: "aktiva.forderungen", validFrom: "2026-01-01" })).status).toBe(201);
    // Oberposition und unbekannte Position
    expect((await json(await neu({ accountFrom: "1500", itemKey: "aktiva", validFrom: "2026-01-01" }))).error.code).toBe("account_rule_item_not_leaf");
    expect((await json(await neu({ accountFrom: "1500", itemKey: "gibt.es.nicht", validFrom: "2026-01-01" }))).error.code).toBe("account_rule_item_unknown");
    expect((await neu({ accountFrom: "1500", accountTo: "150", itemKey: "aktiva.forderungen", validFrom: "2026-01-01" })).status).toBe(400);
  });

  it("Ablösung einer Regel: alte endet am Tag davor, Verlauf bleibt, Ende nachträglich setzbar", async () => {
    await anfrage("POST", `/funds/${F1}/layout/standard`, verwalter);
    const neu = (body: object) => anfrage("POST", `/funds/${F1}/account-rules`, verwalter, { view: "balance_sheet", ...body });
    const alt = await json(await neu({ accountFrom: "1200", accountTo: "1299", itemKey: "aktiva.liquide", validFrom: "2026-01-01" }));
    const nachfolger = await neu({ accountFrom: "1200", accountTo: "1299", itemKey: "aktiva.forderungen", validFrom: "2026-07-01", replaces: alt.id });
    expect(nachfolger.status).toBe(201);
    const [vorher] = await db.select().from(s.kontenregel).where(eq(s.kontenregel.id, alt.id));
    expect(vorher).toMatchObject({ gueltigAb: "2026-01-01", gueltigBis: "2026-06-30" });
    const stichtag = (await json(await anfrage("GET", `/funds/${F1}/account-rules?view=balance_sheet&asOf=2026-09-30`, betrachter))).data;
    expect(stichtag.map((r: { itemKey: string }) => r.itemKey)).toEqual(["aktiva.forderungen"]);
    expect((await json(await anfrage("GET", `/funds/${F1}/account-rules?view=balance_sheet&asOf=2026-03-31`, betrachter))).data.map((r: { itemKey: string }) => r.itemKey)).toEqual(["aktiva.liquide"]);
    // Ende vor dem Beginn: abgelehnt; sonst beenden
    const neuId = (await json(nachfolger)).id;
    expect((await json(await anfrage("POST", `/account-rules/${neuId}/end`, verwalter, { validTo: "2026-06-01" }))).error.code).toBe("account_rule_period_invalid");
    expect((await anfrage("POST", `/account-rules/${neuId}/end`, fremd, { validTo: "2026-12-31" })).status).toBe(403);
    expect((await anfrage("POST", `/account-rules/${neuId}/end`, verwalter, { validTo: "2026-12-31" })).status).toBe(200);
    // Zeilen derselben Transaktion tragen denselben Zeitpunkt; die Reihenfolge innerhalb ist nicht festgelegt.
    expect((await protokollZeilen(db, "kontenregel")).map((z) => z.aktion).sort()).toEqual(["anlegen", "anlegen", "beenden", "beenden"]);
  });
});

describe("Belegvorlagen", () => {
  it("liefert Standardvorlagen mit Katalog, speichert eine eigene und lehnt unbekannte Felder ab", async () => {
    const liste = (await json(await anfrage("GET", `/funds/${F1}/voucher-templates`, betrachter))).data;
    expect(liste.map((v: { type: string }) => v.type)).toEqual(["contract_attachment", "disbursement", "interest_posting", "sale", "conversion", "capital_call_voucher", "distribution"]);
    const auszahlung = liste.find((v: { type: string }) => v.type === "disbursement");
    expect(auszahlung.standard).toBe(true);
    expect(auszahlung.catalog.map((k: { key: string }) => k.key)).toContain("projectNumber");
    // Zinsbuchung (Zinslauf über viele Beteiligungen) ohne Felder einer einzelnen Beteiligung
    expect(liste.find((v: { type: string }) => v.type === "interest_posting").fields.map((f: { key: string }) => f.key)).not.toContain("organizationName");

    const eigene = { fields: [{ key: "organizationName", section: "header", required: true }, { key: "amount", section: "header", required: true }, { key: "projectNumber", section: "details", required: true, labelDe: "Projekt", labelEn: "Project" }], headerDe: "Kopf", headerEn: "Header", footerDe: "Fuß", footerEn: "Footer" };
    expect((await anfrage("PUT", `/funds/${F1}/voucher-templates/disbursement`, verwalter, eigene)).status).toBe(200);
    const danach = (await json(await anfrage("GET", `/funds/${F1}/voucher-templates`, betrachter))).data.find((v: { type: string }) => v.type === "disbursement");
    expect(danach).toMatchObject({ standard: false, headerDe: "Kopf", footerEn: "Footer" });
    expect(danach.fields).toHaveLength(3);
    const unbekannt = await anfrage("PUT", `/funds/${F1}/voucher-templates/disbursement`, verwalter, { ...eigene, fields: [{ key: "gibt_es_nicht", section: "header", required: false }] });
    expect(unbekannt.status).toBe(400);
    expect((await json(unbekannt)).error.fields[0]).toMatchObject({ field: "fields.0.key", code: "custom" });
    const zugeordnet = await anfrage("PUT", `/funds/${F1}/voucher-templates/interest_posting`, verwalter, { ...eigene, fields: [{ key: "purchasePrice", section: "header", required: false }] });
    expect(zugeordnet.status).toBe(400);
  });
});
