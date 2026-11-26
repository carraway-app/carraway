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

const lies = (als: Testperson | null) => t.request("/thema", { als });
const setze = (als: Testperson | null, body: unknown) =>
  t.request("/thema", { method: "PATCH", als, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

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
    expect(await json(antwort)).toEqual({ thema: "system" });
  });

  it("speichert hell und dunkel je Person und ändert nur den eigenen Wert", async () => {
    expect((await setze(anna, { thema: "hell" })).status).toBe(200);
    expect((await setze(bernd, { thema: "dunkel" })).status).toBe(200);
    expect(await json(await lies(anna))).toEqual({ thema: "hell" });
    expect(await json(await lies(bernd))).toEqual({ thema: "dunkel" });
    expect((await setze(anna, { thema: "system" })).status).toBe(200);
    expect(await json(await lies(anna))).toEqual({ thema: "system" });
    expect(await json(await lies(bernd))).toEqual({ thema: "dunkel" });
    const [zeile] = await db.select().from(s.benutzerEinstellung).where(eq(s.benutzerEinstellung.benutzerId, await idVon(db, bernd)));
    expect(zeile?.thema).toBe("dunkel");
  });

  it("nimmt keine fremde Person und keine anderen Felder an", async () => {
    const annaId = await idVon(db, anna);
    expect((await setze(bernd, { thema: "hell", benutzerId: annaId })).status).toBe(400);
    expect((await setze(bernd, { thema: "lila" })).status).toBe(400);
    expect((await setze(bernd, {})).status).toBe(400);
    expect(await json(await lies(anna))).toEqual({ thema: "system" });
  });

  it("lässt die übrigen Einstellungen unberührt", async () => {
    const einstellung = (body: object) => t.request("/einstellungen", { method: "PUT", als: anna, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await einstellung({ sprache: "en" })).status).toBe(200);
    expect((await setze(anna, { thema: "dunkel" })).status).toBe(200);
    expect(await json(await t.request("/einstellungen", { als: anna }))).toMatchObject({ sprache: "en" });
    expect((await einstellung({ mailBerichtFreigegeben: true })).status).toBe(200);
    expect(await json(await lies(anna))).toEqual({ thema: "dunkel" });
  });

  it("gilt auch für Investor-Benutzer des Portals", async () => {
    expect(await json(await lies(investor))).toEqual({ thema: "system" });
    expect((await setze(investor, { thema: "hell" })).status).toBe(200);
    expect(await json(await lies(investor))).toEqual({ thema: "hell" });
  });

  it("verlangt eine Anmeldung", async () => {
    expect((await lies(null)).status).toBe(401);
    expect((await setze(null, { thema: "hell" })).status).toBe(401);
  });

  it("lehnt API-Schlüssel ab", async () => {
    const neu = await t.request("/api-schluessel", {
      method: "POST",
      als: STANDARD,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Themaprobe", scopes: [{ fondsId: ID.fonds, recht: "lesen" }] }),
    });
    expect(neu.status).toBe(201);
    const { schluessel } = (await json(neu)) as { schluessel: string };
    const mit = (methode: string, body?: unknown) =>
      t.app.request("/api/v1/thema", {
        method: methode,
        headers: { authorization: `Bearer ${schluessel}`, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    for (const antwort of [await mit("GET"), await mit("PATCH", { thema: "hell" })]) {
      expect(antwort.status).toBe(403);
      expect((await json(antwort)).fehler.code).toBe("TECHNISCHER_BENUTZER");
    }
  });

  it("steht in der OpenAPI-Beschreibung", async () => {
    const doc = await json(await t.request("/openapi.json", { als: null }));
    expect(doc.paths["/thema"].get).toBeDefined();
    expect(doc.paths["/thema"].patch.requestBody.content["application/json"].schema.properties.thema.enum).toEqual(["system", "hell", "dunkel"]);
  });
});
