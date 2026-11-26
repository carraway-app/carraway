import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp } from "./hilfen-auth";
import { json, leeren, oeffneTestdb } from "./hilfen";

const { db, pool } = oeffneTestdb();
const app = erstelleTestApp(db);

const ID = {
  orgA: "00000000-0000-4000-8000-00000000000a",
  orgB: "00000000-0000-4000-8000-00000000000b",
  fonds: "00000000-0000-4000-8000-0000000000f1",
  dealA: "00000000-0000-4000-8000-0000000000e1",
  dealB: "00000000-0000-4000-8000-0000000000e2",
};

beforeAll(async () => {
  await leeren(db);
  await db.insert(s.organisation).values([
    { id: ID.orgA, name: "Alpha Beispiel", art: "unternehmen" },
    { id: ID.orgB, name: "Beta Beispiel", art: "unternehmen" },
  ]);
  await db.insert(s.fonds).values({ id: ID.fonds, name: "Testfonds", kurzname: "TF", vintage: 2024, zeichnungskapital: "1000000.00" });
  await db.insert(s.deal).values([
    { id: ID.dealA, organisationId: ID.orgA, fondsId: ID.fonds, titel: "Alpha Seed", status: "abgesagt", absagegrund: "Bewertung zu hoch" },
    { id: ID.dealB, organisationId: ID.orgB, titel: "Beta Seed" },
  ]);
  await db.insert(s.aktivitaet).values([
    { art: "notiz", datum: "2026-01-01", titel: "Direkt an Alpha", organisationId: ID.orgA },
    { art: "gespraech", datum: "2026-03-01", titel: "Deal Alpha", dealId: ID.dealA },
    // Beides gesetzt: darf nur einmal erscheinen.
    { art: "termin", datum: "2026-02-01", titel: "Beides Alpha", dealId: ID.dealA, organisationId: ID.orgA },
    { art: "notiz", datum: "2026-04-01", titel: "Deal Beta", dealId: ID.dealB },
  ]);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("GET /deals", () => {
  it("liefert absagegrund und fondsId", async () => {
    const { daten } = await json(await app.request("/api/v1/deals"));
    const a = daten.find((d: { id: string }) => d.id === ID.dealA);
    const b = daten.find((d: { id: string }) => d.id === ID.dealB);
    expect(a).toMatchObject({ fondsId: ID.fonds, absagegrund: "Bewertung zu hoch" });
    expect(b).toMatchObject({ fondsId: null, absagegrund: null });
  });
});

describe("GET /aktivitaeten?organisationId=", () => {
  it("enthält auch Aktivitäten der Deals der Organisation, neueste zuerst, ohne Dubletten", async () => {
    const { daten } = await json(await app.request(`/api/v1/aktivitaeten?organisationId=${ID.orgA}`));
    expect(daten.map((a: { titel: string }) => a.titel)).toEqual(["Deal Alpha", "Beides Alpha", "Direkt an Alpha"]);
  });

  it("zeigt nichts von fremden Organisationen", async () => {
    const { daten } = await json(await app.request(`/api/v1/aktivitaeten?organisationId=${ID.orgB}`));
    expect(daten.map((a: { titel: string }) => a.titel)).toEqual(["Deal Beta"]);
  });

  it("dealId und organisationId lassen sich kombinieren", async () => {
    const { daten } = await json(await app.request(`/api/v1/aktivitaeten?organisationId=${ID.orgA}&dealId=${ID.dealA}`));
    expect(daten).toHaveLength(2);
  });
});
