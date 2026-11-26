import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, legePersonAn, person } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { aufrufe, grundbestand, ID, json, protokollZeilen } from "./hilfen-instrumente";

/** Gremienmandate je Beteiligung (Issue #156): Pflege, Liste je Fonds mit Stichtag, Rechte, Zusammenführen von Personen. */

const { db, pool } = oeffneTestdb();
const { get, post, patch, delete: loesche } = aufrufe(erstelleTestApp(db));

const F1 = ID.fonds;
const F2 = ID.anderer;
const P1 = "00000000-0000-4000-8000-0000000001a1";
const P2 = "00000000-0000-4000-8000-0000000001a2";
const B_F2 = "00000000-0000-4000-8000-0000000001b2";
const bearbeiterF1 = person("mandat-bearbeiter-f1", { rollen: { [F1]: "bearbeiter" } });
const betrachterF1 = person("mandat-betrachter-f1", { rollen: { [F1]: "betrachter" } });
const bearbeiterF2 = person("mandat-bearbeiter-f2", { rollen: { [F2]: "bearbeiter" } });
const beide = person("mandat-bearbeiter-beide", { rollen: { [F1]: "bearbeiter", [F2]: "bearbeiter" } });

beforeEach(async () => {
  await grundbestand(db);
  await db.insert(s.person).values([
    { id: P1, vorname: "Erika", nachname: "Muster" },
    { id: P2, vorname: "Max", nachname: "Beispiel" },
  ]);
  await db.insert(s.beteiligung).values({ id: B_F2, fondsId: F2, organisationId: ID.orgA, instrument: "offene_beteiligung", erstinvestment: "2025-01-01" });
  for (const p of [bearbeiterF1, betrachterF1, bearbeiterF2, beide]) await legePersonAn(db, p);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const mandat = (ueber: Record<string, unknown> = {}) => ({ gremium: "beirat", personId: P1, rolle: "vorsitz", beginn: "2025-02-01", ...ueber });

describe("Mandate pflegen", () => {
  it("anlegen, ändern, beenden und löschen, mit Änderungsprotokoll", async () => {
    const angelegt = await post(`/beteiligungen/${ID.eigen}/mandate`, mandat({ gremiumName: "Investorenbeirat", bemerkung: "Seit der Serie A" }), bearbeiterF1);
    expect(angelegt.status).toBe(201);
    const m = await json(angelegt);
    expect(m).toMatchObject({ beteiligungId: ID.eigen, gremium: "beirat", gremiumName: "Investorenbeirat", rolle: "vorsitz", beginn: "2025-02-01", ende: null });

    const liste = (await json(await get(`/beteiligungen/${ID.eigen}/mandate`, betrachterF1))).daten;
    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({ person: { id: P1, vorname: "Erika", nachname: "Muster" }, organisation: { id: ID.orgA, name: "Alpha Beispiel" } });

    const beendet = await patch(`/beteiligungen/${ID.eigen}/mandate/${m.id}`, { ende: "2026-03-31", rolle: "mitglied" }, bearbeiterF1);
    expect(beendet.status).toBe(200);
    expect(await json(beendet)).toMatchObject({ ende: "2026-03-31", rolle: "mitglied" });

    expect((await loesche(`/beteiligungen/${ID.eigen}/mandate/${m.id}`, undefined, bearbeiterF1)).status).toBe(204);
    expect(await db.select().from(s.gremienmandat)).toHaveLength(0);
    expect((await protokollZeilen(db, "gremienmandat")).map((z) => z.aktion).sort()).toEqual(["aendern", "anlegen", "loeschen"]);
  });

  it("prüft Zeitraum, Person und Zugehörigkeit zur Beteiligung", async () => {
    const vorBeginn = await post(`/beteiligungen/${ID.eigen}/mandate`, mandat({ ende: "2025-01-01" }), bearbeiterF1);
    expect(vorBeginn.status).toBe(400);
    expect((await post(`/beteiligungen/${ID.eigen}/mandate`, mandat({ personId: "00000000-0000-4000-8000-0000000001ff" }), bearbeiterF1)).status).toBe(404);
    const m = await json(await post(`/beteiligungen/${ID.eigen}/mandate`, mandat(), bearbeiterF1));
    const falsch = await patch(`/beteiligungen/${ID.eigen}/mandate/${m.id}`, { ende: "2024-12-31" }, bearbeiterF1);
    expect(falsch.status).toBe(400);
    expect((await json(falsch)).error.code).toBe("invalid_input");
    // Über eine andere Beteiligung desselben Fonds ist das Mandat nicht erreichbar.
    const fremd = await patch(`/beteiligungen/${ID.darlehen}/mandate/${m.id}`, { rolle: "mitglied" }, bearbeiterF1);
    expect(fremd.status).toBe(404);
    expect((await json(fremd)).error.code).toBe("mandate_not_found");
  });

  it("Lesen braucht Betrachter, Schreiben Bearbeiter am Fonds der Beteiligung", async () => {
    expect((await post(`/beteiligungen/${ID.eigen}/mandate`, mandat(), betrachterF1)).status).toBe(403);
    expect((await post(`/beteiligungen/${ID.eigen}/mandate`, mandat(), bearbeiterF2)).status).toBe(403);
    expect((await get(`/beteiligungen/${ID.eigen}/mandate`, bearbeiterF2)).status).toBe(403);
    expect((await get(`/fonds/${F1}/mandate`, bearbeiterF2)).status).toBe(403);
  });
});

describe("Liste je Fonds", () => {
  it("nennt alle Mandate des Fonds, mit Stichtag nur die laufenden", async () => {
    await post(`/beteiligungen/${ID.eigen}/mandate`, mandat(), bearbeiterF1);
    await post(`/beteiligungen/${ID.darlehen}/mandate`, mandat({ gremium: "aufsichtsrat", personId: P2, rolle: "mitglied", beginn: "2024-01-01", ende: "2025-06-30" }), bearbeiterF1);
    await post(`/beteiligungen/${B_F2}/mandate`, mandat({ gremium: "board", rolle: "beobachter" }), bearbeiterF2);

    const alle = (await json(await get(`/fonds/${F1}/mandate`, betrachterF1))).daten;
    expect(alle.map((m: { organisation: { name: string }; gremium: string }) => [m.organisation.name, m.gremium])).toEqual([
      ["Alpha Beispiel", "beirat"],
      ["Beta Beispiel", "aufsichtsrat"],
    ]);
    const laufend = (await json(await get(`/fonds/${F1}/mandate?stichtag=2025-12-31`, betrachterF1))).daten;
    expect(laufend.map((m: { gremium: string }) => m.gremium)).toEqual(["beirat"]);
    const amEnde = (await json(await get(`/fonds/${F1}/mandate?stichtag=2025-06-30`, betrachterF1))).daten;
    expect(amEnde).toHaveLength(2);
  });
});

describe("Zusammenführen von Personen", () => {
  it("hängt Mandate um und verlangt Bearbeiter im Bereich Portfolio an jedem betroffenen Fonds", async () => {
    await post(`/beteiligungen/${ID.eigen}/mandate`, mandat({ personId: P2 }), bearbeiterF1);
    await post(`/beteiligungen/${B_F2}/mandate`, mandat({ personId: P2, gremium: "board" }), bearbeiterF2);

    const vorschau = await json(await post(`/personen/${P1}/zusammenfuehren/vorschau`, { quelleId: P2 }, bearbeiterF1));
    expect(vorschau.verschiebt.mandate).toBe(1); // nur das Mandat im sichtbaren Fonds
    expect(vorschau.darfAusfuehren).toBe(false);
    const abgelehnt = await post(`/personen/${P1}/zusammenfuehren`, { quelleId: P2 }, bearbeiterF1);
    expect(abgelehnt.status).toBe(403);
    expect(await db.select().from(s.gremienmandat).where(eq(s.gremienmandat.personId, P1))).toHaveLength(0);

    const vorschauBeide = await json(await post(`/personen/${P1}/zusammenfuehren/vorschau`, { quelleId: P2 }, beide));
    expect(vorschauBeide).toMatchObject({ darfAusfuehren: true, verschiebt: { mandate: 2 } });
    const ok = await post(`/personen/${P1}/zusammenfuehren`, { quelleId: P2 }, beide);
    expect(ok.status).toBe(200);
    expect((await json(ok)).verschoben.mandate).toBe(2);
    expect(await db.select().from(s.gremienmandat).where(eq(s.gremienmandat.personId, P1))).toHaveLength(2);
  });
});
