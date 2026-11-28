import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { json, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, legePersonAn, person, type Testperson } from "./hilfen-auth";
import { grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const ziel = `/funds/${ID.anderer}`;
const unternehmen = `${ziel}/investment-companies?q=Alpha`;
const eingabe = { organizationId: ID.orgA, instrument: "direct_equity", initialInvestment: "2025-02-01" };

function post(pfad: string, json: unknown, als?: Testperson) {
  return t.requestEnglisch(pfad, {
    method: "POST",
    ...(als ? { als } : {}),
    headers: { "content-type": "application/json" },
    body: JSON.stringify(json),
  });
}

beforeEach(async () => {
  await grundbestand(db);
});
afterAll(() => pool.end());

describe("Beteiligung direkt im Portfolio anlegen", () => {
  it("legt unter reinen Portfolio-Rechten eine Beteiligung mit Instrument an und zeigt sie sofort im zuvor gespeicherten Fondsstand", async () => {
    const editor = person("portfolio-anlage");
    const benutzer = await legePersonAn(db, editor);
    const rolle = await post("/permissions/roles", { name: "Portfolioanlage", areas: ["portfolio"] });
    expect(rolle.status).toBe(201);
    const { id: roleId } = await json(rolle);
    const gruppe = await post("/permissions/groups", {
      name: "Portfolioanlage",
      roleIds: [roleId],
      level: "editor",
      fundsRestricted: true,
      areasPerFund: true,
      fundIds: [ID.anderer],
      memberIds: [benutzer],
    });
    expect(gruppe.status).toBe(201);
    const als = { als: editor };
    expect((await t.requestEnglisch("/deals", als)).status).toBe(403);
    expect((await t.requestEnglisch("/organizations", als)).status).toBe(403);
    expect((await t.requestEnglisch(`/funds/${ID.fonds}/investment-companies?q=Alpha`, als)).status).toBe(403);
    const suche = await t.requestEnglisch(unternehmen, als);
    expect(suche.status).toBe(200);
    expect(await suche.json()).toEqual([{ id: ID.orgA, name: "Alpha Beispiel", city: null, investmentId: null }]);
    const vorher = await json(await t.requestEnglisch(`${ziel}/overview`, als));
    expect(vorher.snapshot).toBeTruthy();
    expect(vorher.investments).toEqual([]);

    const angelegt = await post(`${ziel}/investments`, eingabe, editor);
    expect(angelegt.status).toBe(201);
    const neu = await json(angelegt);
    expect(neu).toMatchObject({ fundId: ID.anderer, initialInvestment: eingabe.initialInvestment });
    const [b] = await db.select().from(s.beteiligung).where(eq(s.beteiligung.id, neu.id));
    expect(b).toMatchObject({ dealId: null, organisationId: ID.orgA });
    const instrumente = await db.select().from(s.instrument).where(eq(s.instrument.beteiligungId, neu.id));
    expect(instrumente).toMatchObject([{ art: "offene_beteiligung", status: "aktiv" }]);
    expect(await protokollZeilen(db, "beteiligung", "anlegen")).toMatchObject([{ datensatz_id: neu.id, akteur: benutzer }]);

    const nachher = await json(await t.requestEnglisch(`${ziel}/overview`, als));
    expect(nachher.investments).toMatchObject([{ id: neu.id, organization: { id: ID.orgA } }]);
    const erneut = await post(`${ziel}/investments`, eingabe, editor);
    expect(erneut.status).toBe(409);
    expect(await erneut.json()).toMatchObject({ error: { code: "investment_exists", investmentId: neu.id } });
    expect(await (await t.requestEnglisch(unternehmen, als)).json()).toMatchObject([{ investmentId: neu.id }]);
  });

  it("lässt nur Schreibrechte für genau den gewählten Fonds zu", async () => {
    const leser = person("portfolio-anlage-leser", { rollen: { [ID.anderer]: "betrachter", [ID.fonds]: "bearbeiter" } });
    expect((await t.requestEnglisch(unternehmen, { als: leser })).status).toBe(403);
    expect((await post(`${ziel}/investments`, eingabe, leser)).status).toBe(403);
  });

  it("liefert bei parallelem Speichern genau eine Beteiligung und verweist im Konflikt auf sie", async () => {
    const antworten = await Promise.all([post(`${ziel}/investments`, eingabe), post(`${ziel}/investments`, eingabe)]);
    const erstellt = antworten.find((antwort) => antwort.status === 201);
    const konflikt = antworten.find((antwort) => antwort.status === 409);
    expect(erstellt).toBeDefined();
    expect(konflikt).toBeDefined();
    const neu = await json(erstellt!);
    expect(await konflikt!.json()).toMatchObject({ error: { code: "investment_exists", investmentId: neu.id } });
    expect(await db.select().from(s.beteiligung).where(and(eq(s.beteiligung.fondsId, ID.anderer), eq(s.beteiligung.organisationId, ID.orgA)))).toHaveLength(1);
  });
});
