import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import * as s from "@carraway/db";
import { heute } from "../schreiben";
import { erstelleTestApp, person } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { grundbestand, ID } from "./hilfen-instrumente";

const { db, pool } = oeffneTestdb();
const app = erstelleTestApp(db);

async function pdfText(antwort: Response) {
  const dokument = await getDocumentProxy(new Uint8Array(await antwort.arrayBuffer()));
  return (await extractText(dokument, { mergePages: true })).text.replace(/\s+/g, " ");
}

beforeEach(async () => {
  await grundbestand(db);
  const [a, b] = await db
    .insert(s.deal)
    .values([
      { organisationId: ID.orgA, fondsId: ID.fonds, titel: "Sichtbar Projekt Eta" },
      { organisationId: ID.orgB, fondsId: ID.anderer, titel: "Verdeckt Projekt Zeta" },
    ])
    .returning();
  await db.insert(s.beschluss).values([
    { dealId: a!.id, gremium: "Ausschuss", datum: heute(), ergebnis: "vertagt" },
    { dealId: b!.id, gremium: "Ausschuss", datum: heute(), ergebnis: "vertagt" },
  ]);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Gremienvorlage: Beschlüsse im Zeitraum nur für sichtbare Deals", () => {
  it("wer nur an Fonds A eine Rolle hat, sieht keinen Beschluss eines Deals von Fonds B", async () => {
    const nurA = person("nur-a", { rollen: { [ID.fonds]: "betrachter" } });
    const antwort = await app.request("/reports/committee-pack", { als: nurA });
    expect(antwort.status).toBe(200);
    const text = await pdfText(antwort);
    expect(text).toContain("Sichtbar Projekt Eta");
    expect(text).not.toContain("Verdeckt Projekt Zeta");
    expect(text).not.toContain("Beta Beispiel");
  });

  it("globale Verwalter sehen beide", async () => {
    const text = await pdfText(await app.request("/reports/committee-pack"));
    expect(text).toContain("Sichtbar Projekt Eta");
    expect(text).toContain("Verdeckt Projekt Zeta");
  });
});
