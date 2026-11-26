import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, idVon, legeInvestorAn, legePersonAn, person } from "./hilfen-auth";
import { json, leeren, oeffneTestdb } from "./hilfen";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);

const FA = "00000000-0000-4000-8000-0000000000c1";
const FB = "00000000-0000-4000-8000-0000000000c2";
const ADMIN = person("zust-admin", { globalVerwalter: true });
const BEA_A = person("zust-bea-a", { rollen: { [FA]: "bearbeiter" } });
const KOLLEGE_A = person("zust-kolleg-a", { rollen: { [FA]: "betrachter" } });
const BEA_B = person("zust-bea-b", { rollen: { [FB]: "bearbeiter" } });
const OHNE_ROLLE = person("zust-ohne");
const GESPERRT = person("zust-gesperrt", { rollen: { [FA]: "betrachter" }, aktiv: false });
const INVESTOR = person("zust-investor");

const ids: Record<string, string> = {};
let org = "";
let dealA = "";
let dealOhneFonds = "";

const senden = (methode: string) => (pfad: string, body?: unknown, als = ADMIN) =>
  t.request(`/crm${pfad}`, { method: methode, als, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const post = senden("POST");
const patch = senden("PATCH");
const get = (pfad: string, als = ADMIN) => t.request(`/crm${pfad}`, { als });

beforeAll(async () => {
  await leeren(db);
  await db.insert(s.fonds).values([
    { id: FA, name: "Fonds A", kurzname: "FA", vintage: 2024, zeichnungskapital: "1000000.00" },
    { id: FB, name: "Fonds B", kurzname: "FB", vintage: 2024, zeichnungskapital: "1000000.00" },
  ]);
  for (const p of [ADMIN, BEA_A, KOLLEGE_A, BEA_B, OHNE_ROLLE, GESPERRT]) ids[p.email] = await legePersonAn(db, p);
  ids[INVESTOR.email] = await legeInvestorAn(db, INVESTOR, []);
  org = (await db.insert(s.organisation).values({ name: "Muster Zuständig GmbH", art: "unternehmen" }).returning())[0]!.id;
  dealA = (await db.insert(s.deal).values({ organisationId: org, titel: "Deal A", fondsId: FA, phase: "anfrage" }).returning())[0]!.id;
  dealOhneFonds = (await db.insert(s.deal).values({ organisationId: org, titel: "Deal ohne Fonds", fondsId: null, phase: "anfrage" }).returning())[0]!.id;
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const namen = async (pfad: string, als = ADMIN) => ((await json(await get(pfad, als))).daten as { id: string; name: string }[]).map((x) => x.name);

describe("Zuständige für Aufgaben", () => {
  it("globale Verwalter sehen alle aktiven Personen mit Zugriff, nie gesperrte, technische, Investoren oder Personen ohne Rolle", async () => {
    const alle = await namen("/zustaendige?q=zust");
    expect(alle).toEqual(expect.arrayContaining([ADMIN.name, BEA_A.name, KOLLEGE_A.name, BEA_B.name]));
    expect(alle).not.toContain(GESPERRT.name);
    expect(alle).not.toContain(INVESTOR.name);
    expect(alle).not.toContain(OHNE_ROLLE.name);
  });

  it("liefert nur Kennung und Name und sucht nach Name (Maskierung von % und _)", async () => {
    const antwort = (await json(await get("/zustaendige?q=zust-kolleg"))).daten as Record<string, unknown>[];
    expect(antwort).toHaveLength(1);
    expect(Object.keys(antwort[0]!).sort()).toEqual(["id", "name"]);
    expect(await namen("/zustaendige?q=%25")).toEqual([]);
    expect(await namen("/zustaendige?q=_")).toEqual([]);
  });

  it("andere sehen nur Personen, mit denen sie einen Fonds teilen (und globale Verwalter)", async () => {
    const a = await namen("/zustaendige?q=zust", BEA_A);
    expect(a).toEqual(expect.arrayContaining([BEA_A.name, KOLLEGE_A.name, ADMIN.name]));
    expect(a).not.toContain(BEA_B.name);
  });

  it("mit dealId nur Personen, die den Deal sehen dürfen; Deals ohne Fonds: jede Person mit Rolle", async () => {
    const fuerA = await namen(`/zustaendige?q=zust&dealId=${dealA}`);
    expect(fuerA).toEqual(expect.arrayContaining([BEA_A.name, KOLLEGE_A.name, ADMIN.name]));
    expect(fuerA).not.toContain(BEA_B.name);
    const ohne = await namen(`/zustaendige?q=zust&dealId=${dealOhneFonds}`);
    expect(ohne).toContain(BEA_B.name);
    // Wer den Deal nicht sieht, bekommt auch keine Kandidaten dazu (403 der Rechtetabelle).
    expect((await get(`/zustaendige?dealId=${dealA}`, BEA_B)).status).toBe(403);
  });

  it("schreibt die Zuständigkeit nur für Personen mit Zugriff", async () => {
    const ok = await post("/aufgaben", { titel: "An Kollegen", organisationId: org, zustaendigId: ids[KOLLEGE_A.email] }, BEA_A);
    expect(ok.status).toBe(201);
    for (const [label, wer] of [["gesperrt", GESPERRT], ["ohne Rolle", OHNE_ROLLE], ["Investor", INVESTOR]] as const) {
      const r = await post("/aufgaben", { titel: label, organisationId: org, zustaendigId: ids[wer.email] ?? (await idVon(db, wer)) }, BEA_A);
      expect(r.status, label).toBe(400);
      expect((await json(r)).fehler.code).toBe("ZUSTAENDIG_UNGUELTIG");
    }
  });

  it("Deal-Aufgaben: die Person braucht eine Rolle am Fonds des Deals (beim Anlegen und beim Ändern)", async () => {
    const fremd = await post("/aufgaben", { titel: "Falscher Fonds", dealId: dealA, zustaendigId: ids[BEA_B.email] }, ADMIN);
    expect(fremd.status).toBe(400);
    const richtig = await post("/aufgaben", { titel: "Richtiger Fonds", dealId: dealA, zustaendigId: ids[KOLLEGE_A.email] }, ADMIN);
    expect(richtig.status).toBe(201);
    const id = (await json(richtig)).id as string;
    const umhaengen = await patch(`/aufgaben/${id}`, { zustaendigId: ids[BEA_B.email] }, ADMIN);
    expect(umhaengen.status).toBe(400);
    const zurueck = await patch(`/aufgaben/${id}`, { zustaendigId: ids[BEA_A.email] }, ADMIN);
    expect(zurueck.status).toBe(200);
    // Ohne Fonds ist eine Aufgabe auch direkt einer Person ohne gemeinsamen Fonds zuweisbar.
    const frei = await post("/aufgaben", { titel: "Ohne Fonds", dealId: dealOhneFonds, zustaendigId: ids[BEA_B.email] }, BEA_A);
    expect(frei.status).toBe(201);
  });

  it("die Liste „Meine“ und „Alle“ filtert nach der Zuständigkeit der angemeldeten Person", async () => {
    const meine = (await json(await get("/aufgaben?zustaendig=ich", KOLLEGE_A))).daten as { titel: string }[];
    expect(meine.map((a) => a.titel)).toEqual(expect.arrayContaining(["An Kollegen"]));
    expect(meine.every((a) => ["An Kollegen", "Richtiger Fonds"].includes(a.titel))).toBe(true);
    const alle = (await json(await get("/aufgaben?zustaendig=alle", BEA_A))).daten as { titel: string }[];
    expect(alle.length).toBeGreaterThan(meine.length - 1);
  });

  it("Felder vom Typ „Person im Haus“ nehmen dieselben Personen: Zugriff nötig, keine gesperrten, keine Investoren", async () => {
    const feld = await post("/felder", { objekt: "organisation", name: "Betreuung intern", typ: "benutzer" });
    expect(feld.status).toBe(201);
    const fid = (await json(feld)).id as string;
    const setze = (wer: string) => patch(`/datensaetze/organisation/${org}`, { eigene: { [fid]: wer } });
    expect((await setze(ids[KOLLEGE_A.email]!)).status).toBe(200);
    for (const wer of [GESPERRT, OHNE_ROLLE, INVESTOR]) expect((await setze(ids[wer.email]!)).status, wer.name).toBe(400);
  });
});
