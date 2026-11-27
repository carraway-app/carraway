import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { DateiSpeicher } from "../berichte/speicher";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erzeugePdf } from "./hilfen-dokumente";
import { grundbestand, ID } from "./hilfen-instrumente";
import { BEREICH_EN, erstelleTestApp, legePersonAn, person, type TestApp, type Testperson } from "./hilfen-auth";

/**
 * Dokument-Verknüpfungen verlangen den Bereich des Ziels (docs/permissions-model.md, „Document targets“): Deals Dealflow, Beteiligungen,
 * Vorgänge, Bewertungen und Finanzierungsrunden Portfolio, mit der Stufe an demselben Fonds wie die Stufe in Dokumente. Verknüpfen ohne den
 * Bereich: 403. Anzeigen: Ziele ohne Bereich bleiben unsichtbar (die Auslesung prüft dasselbe, siehe ee/api). Alle Personen und Daten sind erfunden.
 */

const { db, pool } = oeffneTestdb();
let verzeichnis = "";
let t: TestApp;

const F1 = ID.fonds;
const F2 = ID.anderer;
const DEAL_F1 = "00000000-0000-4000-8000-0000000008d1";
const DEAL_F2 = "00000000-0000-4000-8000-0000000008d2";
const DEAL_OHNE = "00000000-0000-4000-8000-0000000008d3";
const RUNDE = "00000000-0000-4000-8000-0000000008e1";
const BET_F2 = "00000000-0000-4000-8000-0000000008b2";
const ORG_OHNE = "00000000-0000-4000-8000-0000000008a1"; // Organisation ohne Beteiligung

const ohneDealflow = person("zb-ohne-dealflow"); // Dokumente + Portfolio
const ohnePortfolio = person("zb-ohne-portfolio"); // Dokumente + Dealflow
const voll = person("zb-voll"); // Dokumente + Portfolio + Dealflow
const jeFondsDeal = person("zb-je-fonds-deal"); // Fonds Eins: Dealflow; Fonds Zwei: Dokumente
const jeFondsRunde = person("zb-je-fonds-runde"); // Fonds Eins: Dokumente; Fonds Zwei: Portfolio
const ohneGruppe = person("zb-ohne-gruppe", { rollen: { [F1]: "bearbeiter" } }); // eigene Fondsrolle, keine Gruppe: alle Bereiche
const nurDokumente = person("zb-nur-dokumente"); // nur Dokumente, weder Kontakte noch Portfolio noch Fondsverwaltung
const personen = [ohneDealflow, ohnePortfolio, voll, jeFondsDeal, jeFondsRunde, ohneGruppe, nurDokumente];
const ids: Record<string, string> = {};

type Ziel = { typ: string; id: string };
const anfrage = (methode: string, pfad: string, als: Testperson | undefined, body?: unknown) =>
  t.request(pfad, { method: methode, ...(als ? { als } : {}), headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

function hochladen(ziele: Ziel[], als?: Testperson) {
  const f = new FormData();
  f.append("datei", new File([new Uint8Array(erzeugePdf([`Vertrag ${Math.random().toString(36).slice(2)}`]))], "vertrag.pdf"));
  f.append("ziele", JSON.stringify(ziele));
  return t.request("/documents", { method: "POST", body: f, ...(als ? { als } : {}) });
}
/** Dokument als globaler Verwalter anlegen. */
async function dokument(ziele: Ziel[]): Promise<string> {
  const antwort = await hochladen(ziele);
  expect(antwort.status, await antwort.clone().text()).toBe(201);
  return (await json(antwort)).id as string;
}
const verknuepfe = (dokumentId: string, ziel: Ziel, als: Testperson) => anfrage("POST", `/documents/${dokumentId}/links`, als, ziel);
const zieleIn = async (antwort: Response) => {
  expect(antwort.status).toBe(200);
  return ((await json(antwort)).verknuepfungen as Ziel[]).map((v) => `${v.typ}:${v.id}`).sort();
};
const verweigert = async (antwort: Response) => {
  expect(antwort.status, await antwort.clone().text()).toBe(403);
  expect((await json(antwort)).error.code).toBe("forbidden");
};

async function gruppe(name: string, bereiche: string[], mitglied: Testperson, jeFonds?: Record<string, string[]>) {
  const r = await anfrage("POST", "/permissions/roles", undefined, { name: `Rolle ${name}`, areas: bereiche.map((b) => BEREICH_EN[b] ?? b) });
  expect(r.status).toBe(201);
  const zusatz = jeFonds ? { fundsRestricted: true, areasPerFund: true, fundIds: Object.keys(jeFonds), fundAreas: Object.fromEntries(Object.entries(jeFonds).map(([f, b]) => [f, b.map((x) => BEREICH_EN[x] ?? x)])) } : {};
  const g = await anfrage("POST", "/permissions/groups", undefined, { name, level: "editor", roleIds: [(await json(r)).id], memberIds: [ids[mitglied.email]], ...zusatz });
  expect(g.status, await g.clone().text()).toBe(201);
}

beforeAll(async () => {
  verzeichnis = await mkdtemp(join(tmpdir(), "carraway-ziel-bereiche-"));
  t = erstelleTestApp(db, { speicher: new DateiSpeicher(verzeichnis) });
});
beforeEach(async () => {
  await grundbestand(db);
  await db.insert(s.organisation).values({ id: ORG_OHNE, name: "Delta Beispiel", art: "unternehmen" });
  await db.insert(s.beteiligung).values({ id: BET_F2, fondsId: F2, organisationId: ID.orgA, instrument: "offene_beteiligung", erstinvestment: "2025-01-01" });
  await db.insert(s.deal).values([
    { id: DEAL_F1, organisationId: ID.orgA, fondsId: F1, titel: "Deal im Fonds Eins" },
    { id: DEAL_F2, organisationId: ID.orgB, fondsId: F2, titel: "Deal im Fonds Zwei" },
    { id: DEAL_OHNE, organisationId: ID.orgC, titel: "Deal ohne Fonds" },
  ]);
  await db.insert(s.finanzierungsrunde).values({ id: RUNDE, organisationId: ID.orgA, bezeichnung: "Seed", datum: "2025-01-01", preMoney: "1000000", postMoney: "1100000", preisJeAnteil: "10", anteileGesamtNach: "110000" });
  await db.execute(sql`DELETE FROM nutzergruppe`);
  await db.execute(sql`DELETE FROM rechterolle`);
  await db.execute(sql`UPDATE rechte_einstellung SET fonds_offen = true`);
  for (const p of personen) ids[p.email] = await legePersonAn(db, p);
  await gruppe("Ohne Dealflow", ["dokumente", "portfolio"], ohneDealflow);
  await gruppe("Ohne Portfolio", ["dokumente", "dealflow"], ohnePortfolio);
  await gruppe("Voll", ["dokumente", "portfolio", "dealflow"], voll);
  await gruppe("Je Fonds Deal", ["dokumente", "dealflow"], jeFondsDeal, { [F1]: ["dealflow"], [F2]: ["dokumente"] });
  await gruppe("Je Fonds Runde", ["dokumente", "portfolio"], jeFondsRunde, { [F1]: ["dokumente"], [F2]: ["portfolio"] });
  await gruppe("Nur Dokumente", ["dokumente"], nurDokumente);
});
afterAll(async () => {
  await db.execute(sql`DELETE FROM nutzergruppe`);
  await db.execute(sql`DELETE FROM rechterolle`);
  await leeren(db);
  await pool.end();
  await rm(verzeichnis, { recursive: true, force: true });
});

describe("Verknüpfen verlangt den Bereich des Ziels", () => {
  it("Deal ohne Dealflow, Beteiligung und Runde ohne Portfolio: 403, nichts wird verknüpft", async () => {
    const d = await dokument([{ typ: "fonds", id: F1 }]);
    await verweigert(await verknuepfe(d, { typ: "deal", id: DEAL_F1 }, ohneDealflow));
    await verweigert(await verknuepfe(d, { typ: "deal", id: DEAL_OHNE }, ohneDealflow));
    await verweigert(await verknuepfe(d, { typ: "beteiligung", id: ID.eigen }, ohnePortfolio));
    await verweigert(await verknuepfe(d, { typ: "finanzierungsrunde", id: RUNDE }, ohnePortfolio));
    const { rows } = await db.execute(sql`SELECT count(*)::int AS n FROM dokument_verknuepfung WHERE dokument_id = ${d}`);
    expect(rows[0]).toEqual({ n: 1 });
  });

  it("mit dem Bereich gelingt es; ohne Gruppe unverändert", async () => {
    const d = await dokument([{ typ: "fonds", id: F1 }]);
    expect((await verknuepfe(d, { typ: "beteiligung", id: ID.eigen }, ohneDealflow)).status).toBe(200);
    expect((await verknuepfe(d, { typ: "finanzierungsrunde", id: RUNDE }, ohneDealflow)).status).toBe(200);
    expect((await verknuepfe(d, { typ: "deal", id: DEAL_F1 }, voll)).status).toBe(200);
    const d2 = await dokument([{ typ: "fonds", id: F1 }]);
    expect((await verknuepfe(d2, { typ: "deal", id: DEAL_F1 }, ohneGruppe)).status).toBe(200);
    expect((await verknuepfe(d2, { typ: "beteiligung", id: ID.eigen }, ohneGruppe)).status).toBe(200);
  });

  it("Bereiche je Fonds: Dealflow nur an einem anderen Fonds als der Deal genügt nicht", async () => {
    const d = await dokument([{ typ: "fonds", id: F2 }]);
    await verweigert(await verknuepfe(d, { typ: "deal", id: DEAL_F2 }, jeFondsDeal));
  });

  it("Bereiche je Fonds: Dokumente an Fonds Eins und Portfolio an Fonds Zwei ergeben keine Stufe an einem haltenden Fonds der Runde", async () => {
    const d = await dokument([{ typ: "fonds", id: F1 }]);
    await verweigert(await verknuepfe(d, { typ: "finanzierungsrunde", id: RUNDE }, jeFondsRunde));
  });

  it("Hochladen mit einem Deal als Ziel verlangt Dealflow", async () => {
    await verweigert(await hochladen([{ typ: "deal", id: DEAL_F1 }], ohneDealflow));
    expect((await hochladen([{ typ: "deal", id: DEAL_F1 }], voll)).status).toBe(201);
  });

  it("Entfernen einer Verknüpfung zu einem Deal verlangt Dealflow", async () => {
    const d = await dokument([{ typ: "fonds", id: F1 }, { typ: "deal", id: DEAL_F1 }]);
    await verweigert(await anfrage("DELETE", `/documents/${d}/links/deal/${DEAL_F1}`, ohneDealflow));
    expect((await anfrage("DELETE", `/documents/${d}/links/deal/${DEAL_F1}`, voll)).status).toBe(200);
  });
});

describe("Anzeigen blendet Ziele ohne Bereich aus", () => {
  it("Dokument an Beteiligung und Deal: jede Person sieht nur die Ziele ihrer Bereiche", async () => {
    const d = await dokument([{ typ: "beteiligung", id: ID.eigen }, { typ: "deal", id: DEAL_F1 }]);
    expect(await zieleIn(await anfrage("GET", `/documents/${d}`, ohneDealflow))).toEqual([`beteiligung:${ID.eigen}`]);
    expect(await zieleIn(await anfrage("GET", `/documents/${d}`, ohnePortfolio))).toEqual([`deal:${DEAL_F1}`]);
    expect(await zieleIn(await anfrage("GET", `/documents/${d}`, voll))).toEqual([`beteiligung:${ID.eigen}`, `deal:${DEAL_F1}`].sort());
  });

  it("Dokument nur an einem Deal: ohne Dealflow nicht sichtbar (404, nicht in Liste und Suche)", async () => {
    const d = await dokument([{ typ: "deal", id: DEAL_F1 }]);
    const o = await dokument([{ typ: "deal", id: DEAL_OHNE }]);
    expect((await anfrage("GET", `/documents/${d}`, ohneDealflow)).status).toBe(404);
    expect((await anfrage("GET", `/documents/${o}`, ohneDealflow)).status).toBe(404);
    expect((await anfrage("GET", `/documents/${o}`, ohnePortfolio)).status).toBe(200);
    const liste = await json(await anfrage("GET", `/documents?zielTyp=deal&zielId=${DEAL_F1}`, ohneDealflow));
    expect(liste.daten).toEqual([]);
    const listeVoll = await json(await anfrage("GET", `/documents?zielTyp=deal&zielId=${DEAL_F1}`, voll));
    expect(listeVoll.daten.map((x: { id: string }) => x.id)).toEqual([d]);
    expect((await json(await anfrage("GET", "/documents", ohneDealflow))).daten.map((x: { id: string }) => x.id)).not.toContain(d);
  });

  it("Bereiche je Fonds: Dokument an einem Deal von Fonds Zwei bleibt ohne Dealflow an Fonds Zwei unsichtbar", async () => {
    const d = await dokument([{ typ: "deal", id: DEAL_F2 }]);
    expect((await anfrage("GET", `/documents/${d}`, jeFondsDeal)).status).toBe(404);
    expect((await anfrage("GET", `/documents/${d}`, voll)).status).toBe(200);
  });

  it("Dokument nur an einer Beteiligung oder Runde: ohne Portfolio nicht sichtbar", async () => {
    const b = await dokument([{ typ: "beteiligung", id: ID.eigen }]);
    const r = await dokument([{ typ: "finanzierungsrunde", id: RUNDE }]);
    expect((await anfrage("GET", `/documents/${b}`, ohnePortfolio)).status).toBe(404);
    expect((await anfrage("GET", `/documents/${r}`, ohnePortfolio)).status).toBe(404);
    expect((await anfrage("GET", `/documents/${r}`, ohneDealflow)).status).toBe(200);
  });
});

/**
 * Issue #87: Organisationen und Fonds verlangen keinen zusätzlichen Bereich. Es zählt nur die Stufe in Dokumente am Fonds bzw. an einem
 * Fonds, der eine Beteiligung am Unternehmen hält; Organisationen ohne Beteiligung sehen nur globale Verwalter.
 */
describe("Organisation und Fonds als Ziel: kein zusätzlicher Bereich", () => {
  it("Verknüpfen und Hochladen gelingen mit Dokumente allein, ohne Kontakte, Portfolio oder Fondsverwaltung", async () => {
    const d = await dokument([{ typ: "fonds", id: F1 }]);
    expect((await verknuepfe(d, { typ: "organisation", id: ID.orgA }, nurDokumente)).status).toBe(200);
    expect((await verknuepfe(d, { typ: "fonds", id: F2 }, nurDokumente)).status).toBe(200);
    expect((await hochladen([{ typ: "organisation", id: ID.orgB }], nurDokumente)).status).toBe(201);
    expect((await hochladen([{ typ: "fonds", id: F1 }], nurDokumente)).status).toBe(201);
    expect((await anfrage("DELETE", `/documents/${d}/links/organization/${ID.orgA}`, nurDokumente)).status).toBe(200);
  });

  it("Lesen: Dokumente an Organisation und Fonds sind mit Dokumente allein sichtbar, samt Verknüpfung", async () => {
    const o = await dokument([{ typ: "organisation", id: ID.orgA }]);
    const f = await dokument([{ typ: "fonds", id: F1 }]);
    expect(await zieleIn(await anfrage("GET", `/documents/${o}`, nurDokumente))).toEqual([`organisation:${ID.orgA}`]);
    expect(await zieleIn(await anfrage("GET", `/documents/${f}`, nurDokumente))).toEqual([`fonds:${F1}`]);
    const liste = await json(await anfrage("GET", `/documents?zielTyp=organisation&zielId=${ID.orgA}`, nurDokumente));
    expect(liste.daten.map((x: { id: string }) => x.id)).toEqual([o]);
    const alle = (await json(await anfrage("GET", "/documents", nurDokumente))).daten.map((x: { id: string }) => x.id);
    expect(alle).toEqual(expect.arrayContaining([o, f]));
  });

  it("Dokument an Organisation und Deal: ohne Dealflow bleibt nur die Organisation sichtbar", async () => {
    const d = await dokument([{ typ: "organisation", id: ID.orgA }, { typ: "deal", id: DEAL_F1 }]);
    expect(await zieleIn(await anfrage("GET", `/documents/${d}`, nurDokumente))).toEqual([`organisation:${ID.orgA}`]);
    expect(await zieleIn(await anfrage("GET", `/documents/${d}`, ohneDealflow))).toEqual([`organisation:${ID.orgA}`]);
  });

  it("die Stufe in Dokumente bleibt nötig: am Fonds bzw. an einem haltenden Fonds, sonst 403 und unsichtbar", async () => {
    const d = await dokument([{ typ: "fonds", id: F1 }]);
    // Organisation ohne Beteiligung: nur globale Verwalter.
    await verweigert(await verknuepfe(d, { typ: "organisation", id: ORG_OHNE }, nurDokumente));
    const ohne = await dokument([{ typ: "organisation", id: ORG_OHNE }]);
    expect((await anfrage("GET", `/documents/${ohne}`, nurDokumente)).status).toBe(404);
    // Bereiche je Fonds: Dokumente nur an Fonds Zwei, Organisation B wird nur von Fonds Eins gehalten.
    const d2 = await dokument([{ typ: "fonds", id: F2 }]);
    await verweigert(await verknuepfe(d2, { typ: "organisation", id: ID.orgB }, jeFondsDeal));
    await verweigert(await verknuepfe(d2, { typ: "fonds", id: F1 }, jeFondsDeal));
    expect((await verknuepfe(d2, { typ: "organisation", id: ID.orgA }, jeFondsDeal)).status).toBe(200); // gehalten auch von Fonds Zwei
    const b = await dokument([{ typ: "organisation", id: ID.orgB }]);
    const f1 = await dokument([{ typ: "fonds", id: F1 }]);
    expect((await anfrage("GET", `/documents/${b}`, jeFondsDeal)).status).toBe(404);
    expect((await anfrage("GET", `/documents/${f1}`, jeFondsDeal)).status).toBe(404);
    expect((await anfrage("GET", `/documents/${b}`, jeFondsRunde)).status).toBe(200);
  });
});
