import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fondsBewegung } from "@carraway/db";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, person } from "./hilfen-auth";
import { aufrufe, grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";

const { db, pool } = oeffneTestdb();
let app: ReturnType<typeof erstelleTestApp>;
let anfragen: ReturnType<typeof aufrufe>;
const verwalter = person("fonds-stamm-verwalter", { rollen: { [ID.fonds]: "verwalter" } });
const betrachter = person("fonds-stamm-leser", { rollen: { [ID.fonds]: "betrachter" } });
const pfad = `/fonds/${ID.fonds}`;
const eingabe = { name: " Neuer Fonds ", kurzname: " NF ", vintage: 2026, zeichnungskapital: "50000000.50", waehrung: "usd" };

beforeEach(async () => {
  await grundbestand(db);
  app = erstelleTestApp(db);
  anfragen = aufrufe(app);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Fondsstammdaten", () => {
  it("legt einen Fonds als globaler Verwalter an, meldet doppelte Kurznamen und protokolliert die Anlage", async () => {
    const { get, post } = anfragen;
    expect((await post("/fonds", eingabe, verwalter)).status).toBe(403);
    expect((await post("/fonds", { ...eingabe, zeichnungskapital: "100.123" })).status).toBe(400);
    expect((await post("/fonds", { ...eingabe, waehrung: "US" })).status).toBe(400);

    const angelegt = await post("/fonds", eingabe);
    expect(angelegt.status).toBe(201);
    const neu = await json(angelegt);
    expect(neu).toEqual({ ...eingabe, id: expect.any(String), name: "Neuer Fonds", kurzname: "NF", waehrung: "USD" });
    expect(await json(await get(`/fonds/${neu.id}`))).toEqual(neu);
    expect((await json(await get("/fonds"))).daten).toContainEqual(neu);
    expect((await json(await get("/fonds", verwalter))).daten).not.toContainEqual(neu);

    const doppelt = await post("/fonds", eingabe);
    expect(doppelt.status).toBe(409);
    expect((await json(doppelt)).fehler.code).toBe("FONDS_KURZNAME_VERGEBEN");
    expect(await protokollZeilen(db, "fonds", "anlegen")).toHaveLength(1);
  });

  it("erlaubt Ansicht ab betrachter und Änderungen nur Verwaltern des jeweiligen Fonds", async () => {
    const { get, patch } = anfragen;
    expect((await app.request(pfad, { als: null })).status).toBe(401);
    expect((await get(pfad, betrachter)).status).toBe(200);
    expect((await get(`/fonds/${ID.anderer}`, verwalter)).status).toBe(403);
    expect((await get(`/fonds/${randomUUID()}`)).status).toBe(404);
    expect((await patch(pfad, { name: "Umbenannt" }, betrachter)).status).toBe(403);
    expect((await patch(`/fonds/${ID.anderer}`, { name: "Umbenannt" }, verwalter)).status).toBe(403);
    expect((await patch(pfad, {}, verwalter)).status).toBe(400);
    expect((await patch(pfad, { waehrung: "USD" }, verwalter)).status).toBe(400);

    const doppelt = await patch(pfad, { kurzname: "TF2" }, verwalter);
    expect(doppelt.status).toBe(409);
    expect((await json(doppelt)).fehler.code).toBe("FONDS_KURZNAME_VERGEBEN");
    const antwort = await patch(pfad, { name: "Umbenannt", vintage: 2023 }, verwalter);
    expect(antwort.status).toBe(200);
    expect(await json(antwort)).toMatchObject({ id: ID.fonds, name: "Umbenannt", vintage: 2023, waehrung: "EUR" });
    expect(await protokollZeilen(db, "fonds", "aendern")).toHaveLength(1);
  });

  it("verhindert, dass das Zeichnungskapital unter das bereits abgerufene Kapital sinkt", async () => {
    const { get, patch } = anfragen;
    await db.insert(fondsBewegung).values({ fondsId: ID.fonds, art: "abruf", betrag: "100.00", valuta: "2026-01-01" });
    const antwort = await patch(pfad, { zeichnungskapital: "99.99" });
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).fehler.code).toBe("ZEICHNUNGSKAPITAL_UNTER_ABRUFEN");
    expect((await json(await get(pfad))).zeichnungskapital).toBe("10000000.00");
    expect((await patch(pfad, { zeichnungskapital: "100.00" })).status).toBe(200);
  });
});
