import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { STANDARD, erstelleTestApp, idVon, legeInvestorAn, legePersonAn, person, type Testperson } from "./hilfen-auth";
import { grundbestand, ID } from "./hilfen-instrumente";

/** Thema der Oberfläche: nur der eigene Wert, Standard `system`, auch für Investor-Benutzer, nie für API-Schlüssel. */

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);

const anna = person("thema-anna", { rollen: { [ID.fonds]: "betrachter" } });
const bernd = person("thema-bernd", { rollen: { [ID.fonds]: "betrachter" } });
const investor = person("thema-investor");

const lies = (als: Testperson | null) => t.request("/theme", { als });
const setze = (als: Testperson | null, body: unknown) =>
  t.request("/theme", { method: "PATCH", als, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(async () => {
  await grundbestand(db);
  for (const p of [anna, bernd]) await legePersonAn(db, p);
  await legeInvestorAn(db, investor, [ID.orgA]);
  await db.delete(s.benutzerEinstellung);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Thema", () => {
  it("ohne gespeicherten Wert gilt system", async () => {
    const antwort = await lies(anna);
    expect(antwort.status).toBe(200);
    expect(await json(antwort)).toEqual({ theme: "system" });
  });

  it("speichert hell und dunkel je Person und ändert nur den eigenen Wert", async () => {
    expect((await setze(anna, { theme: "light" })).status).toBe(200);
    expect((await setze(bernd, { theme: "dark" })).status).toBe(200);
    expect(await json(await lies(anna))).toEqual({ theme: "light" });
    expect(await json(await lies(bernd))).toEqual({ theme: "dark" });
    expect((await setze(anna, { theme: "system" })).status).toBe(200);
    expect(await json(await lies(anna))).toEqual({ theme: "system" });
    expect(await json(await lies(bernd))).toEqual({ theme: "dark" });
    const [zeile] = await db.select().from(s.benutzerEinstellung).where(eq(s.benutzerEinstellung.benutzerId, await idVon(db, bernd)));
    expect(zeile?.thema).toBe("dunkel");
  });

  it("nimmt keine fremde Person und keine anderen Felder an", async () => {
    const annaId = await idVon(db, anna);
    expect((await setze(bernd, { theme: "light", benutzerId: annaId })).status).toBe(400);
    expect((await setze(bernd, { theme: "lila" })).status).toBe(400);
    expect((await setze(bernd, {})).status).toBe(400);
    expect(await json(await lies(anna))).toEqual({ theme: "system" });
  });

  it("lässt die übrigen Einstellungen unberührt", async () => {
    const einstellung = (body: object) => t.request("/settings", { method: "PUT", als: anna, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await einstellung({ language: "en" })).status).toBe(200);
    expect((await setze(anna, { theme: "dark" })).status).toBe(200);
    expect(await json(await t.request("/settings", { als: anna }))).toMatchObject({ language: "en" });
    expect((await einstellung({ mailOnReportApproved: true })).status).toBe(200);
    expect(await json(await lies(anna))).toEqual({ theme: "dark" });
  });

  it("gilt auch für Investor-Benutzer des Portals", async () => {
    expect(await json(await lies(investor))).toEqual({ theme: "system" });
    expect((await setze(investor, { theme: "light" })).status).toBe(200);
    expect(await json(await lies(investor))).toEqual({ theme: "light" });
  });

  it("verlangt eine Anmeldung", async () => {
    expect((await lies(null)).status).toBe(401);
    expect((await setze(null, { theme: "light" })).status).toBe(401);
  });

  it("lehnt API-Schlüssel ab", async () => {
    const neu = await t.request("/api-keys", {
      method: "POST",
      als: STANDARD,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Themaprobe", scopes: [{ fundId: ID.fonds, permission: "read" }] }),
    });
    expect(neu.status).toBe(201);
    const { key: schluessel } = (await json(neu)) as { key: string };
    const mit = (methode: string, body?: unknown) =>
      t.app.request("/api/v1/theme", {
        method: methode,
        headers: { authorization: `Bearer ${schluessel}`, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    for (const antwort of [await mit("GET"), await mit("PATCH", { theme: "light" })]) {
      expect(antwort.status).toBe(403);
      expect((await json(antwort)).error.code).toBe("technical_user");
    }
  });

  it("steht in der OpenAPI-Beschreibung", async () => {
    const doc = await json(await t.request("/openapi.json", { als: null }));
    expect(doc.paths["/theme"].get).toBeDefined();
    expect(doc.paths["/theme"].patch.requestBody.content["application/json"].schema.properties.theme.enum).toEqual(["system", "light", "dark"]);
  });
});
