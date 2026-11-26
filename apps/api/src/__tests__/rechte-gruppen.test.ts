import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { BEREICHE, bereichVon } from "../rechte/bereiche";
import { REGELN } from "../rechte/tabelle";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { grundbestand, ID } from "./hilfen-instrumente";
import { erstelleTestApp, idVon, legeInvestorAn, legePersonAn, person, type Testperson } from "./hilfen-auth";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);

const F1 = ID.fonds;
const F2 = ID.anderer;
const B2 = "00000000-0000-4000-8000-0000000000c2"; // Beteiligung im zweiten Fonds
const DEAL_F1 = "00000000-0000-4000-8000-0000000000d1";

// Personen ohne eigene Fondsrolle; Rechte nur über Gruppen. `ausnahme` hat zusätzlich eine eigene Fondsrolle am zweiten Fonds.
const kontakt = person("gruppe-kontakte");
const investment = person("gruppe-investment");
const ausnahme = person("gruppe-ausnahme", { rollen: { [F2]: "betrachter" } });
const ohneFonds = person("gruppe-ohne-fonds");
const altbestand = person("gruppe-altbestand", { rollen: { [F1]: "bearbeiter" } });
const investor = person("gruppe-investor");
const alle = [kontakt, investment, ausnahme, ohneFonds, altbestand];

const anfrage = (methode: string, pfad: string, als: Testperson | undefined, body?: unknown) =>
  t.request(pfad, { method: methode, ...(als ? { als } : {}), headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

async function rolle(name: string, bereiche: string[]): Promise<string> {
  const antwort = await anfrage("POST", "/rechte/rollen", undefined, { name, bereiche });
  expect(antwort.status, name).toBe(201);
  return (await json(antwort)).id as string;
}

async function gruppe(eingabe: Record<string, unknown>): Promise<string> {
  const antwort = await anfrage("POST", "/rechte/gruppen", undefined, eingabe);
  expect(antwort.status, JSON.stringify(eingabe)).toBe(201);
  return (await json(antwort)).id as string;
}

const ids: Record<string, string> = {};

beforeEach(async () => {
  await grundbestand(db);
  await db.insert(s.beteiligung).values({ id: B2, fondsId: F2, organisationId: ID.orgB, instrument: "offene_beteiligung", erstinvestment: "2025-01-01" });
  await db.insert(s.deal).values({ id: DEAL_F1, organisationId: ID.orgA, fondsId: F1, titel: "Deal im Fonds Eins" });
  await db.execute(sql`DELETE FROM nutzergruppe`);
  await db.execute(sql`DELETE FROM rechterolle`);
  await db.execute(sql`UPDATE rechte_einstellung SET fonds_offen = true`);
  for (const p of alle) ids[p.email] = await legePersonAn(db, p);
});
afterAll(async () => {
  await db.execute(sql`UPDATE rechte_einstellung SET fonds_offen = true`);
  await leeren(db);
  await pool.end();
});

const id = (p: Testperson) => ids[p.email]!;
const rechteVon = async (p: Testperson) => json(await anfrage("GET", `/benutzer/${id(p)}/rechte`, undefined));

describe("Bereiche in der Berechtigungstabelle", () => {
  it("jede Regel mit Fondsrolle gehört zu genau einem Bereich (oder allgemein/alle)", () => {
    const ohne = REGELN.filter((r) => r.zugriff === "rolle" && !r.bereich).map((r) => `${r.methode} ${r.muster}`);
    expect(ohne, "Regeln ohne Bereich (Zuordnung in rechte/bereiche.ts ergänzen)").toEqual([]);
    for (const r of REGELN.filter((x) => x.zugriff === "rolle")) expect([...BEREICHE, "allgemein", "alle"]).toContain(r.bereich);
  });

  it("Finanzdaten liegen nicht im Bereich Kontakte: Beteiligungen, Kapitaltabelle, Runden, Journal", () => {
    expect(bereichVon("GET", "/beteiligungen/:id")).toBe("portfolio");
    expect(bereichVon("GET", "/organisationen/:id/finanzierungsrunden")).toBe("portfolio");
    expect(bereichVon("GET", "/organisationen/:id/anteilsklassen")).toBe("portfolio");
    expect(bereichVon("GET", "/fonds/:id/journal")).toBe("finanzen");
    expect(bereichVon("GET", "/organisationen/:id")).toBe("kontakte");
    expect(bereichVon("PUT", "/fonds/:id/periodensperre")).toBe("fondsverwaltung");
    expect(bereichVon("GET", "/aenderungen")).toBe("alle");
  });
});

describe("Verwaltung von Rollen und Gruppen", () => {
  it("nur globale Verwalter; Name eindeutig; Investor- und technische Benutzer nicht als Mitglied", async () => {
    expect((await anfrage("GET", "/rechte", altbestand)).status).toBe(403);
    expect((await anfrage("POST", "/rechte/rollen", altbestand, { name: "X", bereiche: [] })).status).toBe(403);
    const r = await rolle("Kontaktpflege", ["kontakte"]);
    expect((await anfrage("POST", "/rechte/rollen", undefined, { name: "Kontaktpflege", bereiche: [] })).status).toBe(409);
    expect((await anfrage("POST", "/rechte/rollen", undefined, { name: "Falsch", bereiche: ["unbekannt"] })).status).toBe(400);
    const investorId = await legeInvestorAn(db, investor, [ID.orgA]);
    const abgelehnt = await anfrage("POST", "/rechte/gruppen", undefined, { name: "Mit Investor", rollenIds: [r], mitglieder: [investorId] });
    expect(abgelehnt.status).toBe(409);
    expect((await json(abgelehnt)).fehler.code).toBe("INVESTOR_BENUTZER");
    expect((await anfrage("POST", "/rechte/gruppen", undefined, { name: "Unbekannt", fondsIds: ["00000000-0000-4000-8000-000000000999"] })).status).toBe(400);

    const g = await gruppe({ name: "Kontaktpflege", stufe: "bearbeiter", rollenIds: [r], mitglieder: [id(kontakt)] });
    const liste = await json(await anfrage("GET", "/rechte", undefined));
    expect(liste.fondsOffen).toBe(true);
    expect(liste.bereiche).toEqual([...BEREICHE]);
    expect(liste.gruppen.find((x: { id: string }) => x.id === g)).toMatchObject({ stufe: "bearbeiter", fondsBeschraenkt: false, rollenIds: [r], mitglieder: [id(kontakt)] });

    const geaendert = await anfrage("PATCH", `/rechte/gruppen/${g}`, undefined, { fondsBeschraenkt: true, fondsIds: [F1] });
    expect(geaendert.status).toBe(200);
    expect(await json(geaendert)).toMatchObject({ fondsBeschraenkt: true, fondsIds: [F1] });
    const protokoll = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM aenderung WHERE tabelle IN ('rechterolle', 'nutzergruppe')`);
    expect(protokoll.rows[0]!.n).toBeGreaterThanOrEqual(3);

    expect((await anfrage("DELETE", `/rechte/rollen/${r}`, undefined)).status).toBe(204);
    expect((await json(await anfrage("GET", "/rechte", undefined))).gruppen[0].rollenIds).toEqual([]);
    expect((await anfrage("DELETE", `/rechte/gruppen/${g}`, undefined)).status).toBe(204);
    expect((await anfrage("DELETE", `/rechte/gruppen/${g}`, undefined)).status).toBe(404);
  });
});

describe("Auflösung der wirksamen Rechte", () => {
  it("ohne Gruppe bleibt alles wie bisher: eigene Fondsrollen, alle Bereiche", async () => {
    const r = await rechteVon(altbestand);
    expect(r.bereiche).toBeNull();
    expect(r.rollen).toEqual([{ fondsId: F1, rolle: "bearbeiter", quelle: "eigene" }]);
    const ich = await json(await anfrage("GET", "/ich", altbestand));
    expect(ich.bereiche).toBeNull();
  });

  it("Fonds offen: eine Gruppe ohne Beschränkung hat alle Fonds; beschränkt nur ihre Fonds; zentral geschlossen nur die genannten", async () => {
    const r = await rolle("Investments", ["portfolio", "kontakte"]);
    const offen = await gruppe({ name: "Investmentmanagement", stufe: "bearbeiter", rollenIds: [r], mitglieder: [id(investment)] });
    let rechte = await rechteVon(investment);
    expect(rechte.bereiche).toEqual(["kontakte", "portfolio"]);
    expect(rechte.rollen.map((x: { fondsId: string }) => x.fondsId).sort()).toEqual([F1, F2].sort());

    await anfrage("PATCH", `/rechte/gruppen/${offen}`, undefined, { fondsBeschraenkt: true, fondsIds: [F1] });
    rechte = await rechteVon(investment);
    expect(rechte.rollen).toEqual([{ fondsId: F1, rolle: "bearbeiter", quelle: "gruppe" }]);

    await anfrage("PATCH", `/rechte/gruppen/${offen}`, undefined, { fondsBeschraenkt: false, fondsIds: [F2] });
    expect((await anfrage("PUT", "/rechte/einstellung", undefined, { fondsOffen: false })).status).toBe(200);
    rechte = await rechteVon(investment);
    expect(rechte.rollen).toEqual([{ fondsId: F2, rolle: "bearbeiter", quelle: "gruppe" }]);
  });

  it("Nutzer-Ausnahme: die eigene Fondsrolle ergänzt weitere Fonds und gilt am Fonds vor der Gruppe", async () => {
    const r = await rolle("Investments", ["portfolio"]);
    await gruppe({ name: "Nur Fonds Eins", stufe: "bearbeiter", fondsBeschraenkt: true, fondsIds: [F1, F2], rollenIds: [r], mitglieder: [id(ausnahme)] });
    const rechte = await rechteVon(ausnahme);
    expect(rechte.rollen.sort((a: { fondsId: string }, b: { fondsId: string }) => a.fondsId.localeCompare(b.fondsId))).toEqual([
      { fondsId: F1, rolle: "bearbeiter", quelle: "gruppe" },
      { fondsId: F2, rolle: "betrachter", quelle: "eigene" },
    ]);
  });

  it("mehrere Gruppen: höchste Stufe je Fonds, Bereiche vereint", async () => {
    const a = await rolle("Kontakte", ["kontakte"]);
    const b = await rolle("Berichte", ["berichte"]);
    await gruppe({ name: "Eins", stufe: "betrachter", rollenIds: [a], mitglieder: [id(investment)] });
    await gruppe({ name: "Zwei", stufe: "freigeber", fondsBeschraenkt: true, fondsIds: [F2], rollenIds: [b], mitglieder: [id(investment)] });
    const rechte = await rechteVon(investment);
    expect(rechte.bereiche).toEqual(["berichte", "kontakte"]);
    expect(Object.fromEntries(rechte.rollen.map((x: { fondsId: string; rolle: string }) => [x.fondsId, x.rolle]))).toEqual({ [F1]: "betrachter", [F2]: "freigeber" });
  });
});

describe("Durchsetzung", () => {
  it("nur Kontakte: Kontakte lesen und schreiben, aber keine Finanzdaten, keine Deals, kein Fondsjournal", async () => {
    const r = await rolle("Kontakte", ["kontakte"]);
    await gruppe({ name: "Relationship Management", stufe: "bearbeiter", rollenIds: [r], mitglieder: [id(kontakt)] });

    const org = await anfrage("GET", `/organisationen/${ID.orgA}`, kontakt);
    expect(org.status).toBe(200);
    const daten = await json(org);
    expect(daten.name).toBe("Alpha Beispiel");
    expect(daten.beteiligungen).toEqual([]);
    expect(daten.deals).toEqual([]);
    expect((await anfrage("POST", "/organisationen", kontakt, { name: "Nordlicht Beispiel", art: "unternehmen" })).status).toBe(201);

    for (const [methode, pfad] of [
      ["GET", `/beteiligungen/${ID.eigen}`],
      ["GET", `/fonds/${F1}/uebersicht`],
      ["GET", `/fonds/${F1}/journal`],
      ["GET", `/organisationen/${ID.orgA}/finanzierungsrunden`],
      ["GET", `/deals/${DEAL_F1}`],
      ["GET", `/aenderungen`],
      ["GET", `/fonds/${F1}/rollen`],
    ] as const) {
      const antwort = await anfrage(methode, pfad, kontakt);
      expect(antwort.status, `${methode} ${pfad}`).toBe(403);
      expect((await json(antwort)).fehler.code).toBe("KEINE_BERECHTIGUNG");
    }

    const suche = await json(await anfrage("GET", "/suche?q=Alpha", kontakt));
    expect(suche.organisationen.map((o: { id: string }) => o.id)).toContain(ID.orgA);
    expect(suche.deals).toEqual([]);
    // Fondsliste (Stammdaten) bleibt für Auswahllisten sichtbar.
    expect((await anfrage("GET", "/fonds", kontakt)).status).toBe(200);
    const ich = await json(await anfrage("GET", "/ich", kontakt));
    expect(ich.bereiche).toEqual(["kontakte"]);
  });

  it("Gruppe auf einen Fonds beschränkt: Beteiligungen nur dieses Fonds, Liste nur dieser Fonds", async () => {
    const r = await rolle("Investments", ["portfolio", "kontakte", "dealflow"]);
    await gruppe({ name: "Fonds Eins", stufe: "bearbeiter", fondsBeschraenkt: true, fondsIds: [F1], rollenIds: [r], mitglieder: [id(investment)] });
    expect((await anfrage("GET", `/beteiligungen/${ID.eigen}`, investment)).status).toBe(200);
    expect((await anfrage("GET", `/beteiligungen/${B2}`, investment)).status).toBe(403);
    const fonds = (await json(await anfrage("GET", "/fonds", investment))).daten.map((f: { id: string }) => f.id);
    expect(fonds).toEqual([F1]);
    const org = await json(await anfrage("GET", `/organisationen/${ID.orgA}`, investment));
    expect(org.beteiligungen.map((b: { id: string }) => b.id)).toEqual([ID.eigen]);
    expect(org.deals.map((d: { id: string }) => d.id)).toEqual([DEAL_F1]);
    // Kein Bereich Fondsverwaltung, auch nicht mit Stufe Verwalter in der Gruppe.
    await db.execute(sql`UPDATE nutzergruppe SET stufe = 'verwalter'`);
    expect((await anfrage("GET", `/fonds/${F1}/rollen`, investment)).status).toBe(403);
    expect((await anfrage("GET", `/fonds/${F1}/journal`, investment)).status).toBe(403);
  });

  it("Nutzer-Ausnahme öffnet den zweiten Fonds, im Rahmen der Bereiche der Gruppe", async () => {
    const r = await rolle("Investments", ["portfolio"]);
    await gruppe({ name: "Fonds Eins", stufe: "bearbeiter", fondsBeschraenkt: true, fondsIds: [F1], rollenIds: [r], mitglieder: [id(ausnahme)] });
    expect((await anfrage("GET", `/beteiligungen/${B2}`, ausnahme)).status).toBe(200);
    // Betrachter am zweiten Fonds: nur lesen.
    expect((await anfrage("POST", `/beteiligungen/${B2}/vorgaenge`, ausnahme, { art: "zusage", valuta: "2025-01-01", betrag: "1000" })).status).toBe(403);
    // Bereich Finanzen fehlt auch am Fonds der Ausnahme.
    expect((await anfrage("GET", `/fonds/${F2}/journal`, ausnahme)).status).toBe(403);
  });

  it("Gruppe ohne Fonds: Kontakte über die Stufe der Gruppe, Fondsdaten nicht", async () => {
    const r = await rolle("Kontakte", ["kontakte", "portfolio"]);
    await gruppe({ name: "Ohne Fonds", stufe: "betrachter", fondsBeschraenkt: true, rollenIds: [r], mitglieder: [id(ohneFonds)] });
    expect((await anfrage("GET", `/organisationen/${ID.orgA}`, ohneFonds)).status).toBe(200);
    expect((await anfrage("POST", "/organisationen", ohneFonds, { name: "Nur lesen", art: "unternehmen" })).status).toBe(403);
    expect((await anfrage("GET", `/beteiligungen/${ID.eigen}`, ohneFonds)).status).toBe(403);
    expect((await json(await anfrage("GET", "/fonds", ohneFonds))).daten).toEqual([]);
  });

  it("Stufe der Gruppe ohne Fonds öffnet keine fondsbezogenen Routen, auch nicht Listen ohne Fonds-Ziel", async () => {
    const r = await rolle("Alles", [...BEREICHE]);
    await gruppe({ name: "Ohne Fonds, alle Bereiche", stufe: "verwalter", fondsBeschraenkt: true, rollenIds: [r], mitglieder: [id(ohneFonds)] });
    for (const [methode, pfad, body] of [
      ["GET", "/zinslaeufe", undefined],
      ["GET", "/belege", undefined],
      ["GET", "/meldelaeufe", undefined],
      ["GET", `/fonds/${F1}/uebersicht`, undefined],
      ["POST", "/zinslaeufe", { fondsId: F1, stichtag: "2026-12-31" }],
      ["GET", "/import/laeufe", undefined],
    ] as const) {
      expect((await anfrage(methode, pfad, ohneFonds, body)).status, `${methode} ${pfad}`).toBe(403);
    }
    // Kontakte und Deals ohne Fonds bleiben erreichbar.
    expect((await anfrage("GET", `/organisationen/${ID.orgA}`, ohneFonds)).status).toBe(200);
    expect((await anfrage("GET", "/deals", ohneFonds)).status).toBe(200);
  });

  it("Postfach gehört zu Kontakte; der Stapel prüft jede Operation mit Bereich", async () => {
    const r = await rolle("Finanzen", ["finanzen"]);
    await gruppe({ name: "Nur Finanzen", stufe: "bearbeiter", rollenIds: [r], mitglieder: [id(investment)] });
    expect((await anfrage("GET", "/postfach", investment)).status).toBe(403);
    const k = await rolle("Kontakte", ["kontakte"]);
    await gruppe({ name: "Kontaktpflege", stufe: "bearbeiter", rollenIds: [k], mitglieder: [id(kontakt)] });
    expect((await anfrage("GET", "/postfach", kontakt)).status).toBe(200);
    const stapel = await anfrage("POST", "/stapel", kontakt, {
      operationen: [{ methode: "POST", pfad: `/beteiligungen/${ID.eigen}/vorgaenge`, koerper: { art: "zusage", valuta: "2025-01-01", betrag: "1000" } }],
    });
    const ergebnis = await json(stapel);
    expect(JSON.stringify(ergebnis)).toContain("403");
    expect((await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM vorgang WHERE beteiligung_id = ${ID.eigen} AND betrag = 1000`)).rows[0]!.n).toBe(0);
    // Der Zähler der Kopfzeile antwortet ohne Kontakte mit null statt 403.
    expect(await json(await anfrage("GET", "/wiedervorlagen/anzahl", investment))).toEqual({ ueberfaellig: 0, heute: 0, gesamt: 0 });
  });

  it("Gruppe ohne Rolle: keine Bereiche, nur Allgemeines", async () => {
    await gruppe({ name: "Leer", stufe: "verwalter", mitglieder: [id(investment)] });
    expect((await anfrage("GET", `/organisationen/${ID.orgA}`, investment)).status).toBe(403);
    expect((await anfrage("GET", "/fonds", investment)).status).toBe(200);
    expect((await json(await anfrage("GET", "/ich", investment))).bereiche).toEqual([]);
  });

  it("bestehende Fondsrollen ohne Gruppe bleiben unverändert wirksam", async () => {
    expect((await anfrage("GET", `/fonds/${F1}/journal`, altbestand)).status).toBe(200);
    expect((await anfrage("GET", `/beteiligungen/${B2}`, altbestand)).status).toBe(403);
    expect(await idVon(db, altbestand)).toBe(id(altbestand));
  });
});
