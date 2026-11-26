import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { DEMO_FELD, DEMO_ZUGAENGE, entferneDemoZugaenge, erzeugeDemodaten, schreibeDemoCrmNachZugaengen, schreibeDemoZugaenge, schreibeDemodaten, type DemoSprache } from "@carraway/db/demo";
import { ansichtKonfigSchema } from "../crm/abfrage";
import { erstelleTestApp, idVon, legePersonAn, person } from "./hilfen-auth";
import { json, leeren, oeffneTestdb } from "./hilfen";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const FONDS = "00000000-0000-4000-8000-0000000000e1";
const ADMIN = person("demo-ans-admin", { globalVerwalter: true });
const KOLLEGE = person("demo-ans-kollege", { rollen: { [FONDS]: "bearbeiter" } });

const post = (pfad: string, body: unknown) => t.request(`/crm${pfad}`, { method: "POST", als: ADMIN, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const get = (pfad: string) => t.request(`/crm${pfad}`, { als: ADMIN });

afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const ZAHLENFELDER = ["ticket", DEMO_FELD.umsatz, DEMO_FELD.volumen];
type Ansicht = { id: string; objekt: "organisation" | "person" | "deal"; listeId: string | null; name: string; art: "tabelle" | "kanban"; konfig: Record<string, unknown>; geteilt: boolean };

async function seede(sprache: DemoSprache) {
  await schreibeDemodaten(db, erzeugeDemodaten({ seed: 1, sprache }));
  await db.insert(s.fonds).values({ id: FONDS, name: "Fonds Demo", kurzname: "FD", vintage: 2024, zeichnungskapital: "1000000.00" }).onConflictDoNothing();
  const admin = await legePersonAn(db, ADMIN);
  const kollege = await legePersonAn(db, KOLLEGE);
  return schreibeDemoCrmNachZugaengen(db, { besitzerId: admin, betreuerIds: [admin, kollege], sprache });
}

async function alleAnsichten(): Promise<Ansicht[]> {
  const aus: Ansicht[] = [];
  for (const objekt of ["organisation", "person", "deal"] as const) {
    const liste = (await json(await get(`/ansichten?objekt=${objekt}`))).daten as Ansicht[];
    aus.push(...liste);
    for (const l of (await json(await get(`/listen?objekt=${objekt}`))).daten as { id: string }[]) aus.push(...((await json(await get(`/ansichten?objekt=${objekt}&listeId=${l.id}`))).daten as Ansicht[]));
  }
  return [...new Map(aus.map((a) => [a.id, a])).values()];
}

describe.each([["de", "Nach Interesse", "LP-Pipeline nach Stufe"], ["en", "By interest", "LP pipeline by stage"]] as const)("Demo-Ansichten (%s)", (sprache, ersteAnsicht, kanbanName) => {
  beforeAll(async () => {
    await leeren(db);
    await seede(sprache);
  });

  it("legt gemeinsame Ansichten an, die die Funktionen zeigen: Gruppierung, Gruppierung in einer Liste, Kanban nach Listenfeld", async () => {
    const ansichten = await alleAnsichten();
    expect(ansichten.every((a) => a.geteilt)).toBe(true);
    const namen = ansichten.map((a) => a.name);
    expect(namen).toContain(ersteAnsicht);
    expect(namen).toContain(kanbanName);
    expect(ansichten.filter((a) => a.art === "kanban")).toHaveLength(1);
    expect(ansichten.filter((a) => a.konfig.gruppierung && a.art === "tabelle").length).toBeGreaterThanOrEqual(3);
    expect(ansichten.find((a) => a.name === kanbanName)!.listeId).toBeTruthy();
  });

  it("jede Konfiguration ist gültig und liefert Zeilen; Gruppen decken die Treffer, Kanban hat vier Spalten mit Summen", async () => {
    const ansichten = await alleAnsichten();
    expect(ansichten.length).toBeGreaterThanOrEqual(5);
    for (const a of ansichten) {
      expect(ansichtKonfigSchema.safeParse(a.konfig).success, a.name).toBe(true);
      const konfig = ansichtKonfigSchema.parse(a.konfig);
      const abfrage = { sortierung: konfig.sortierung, spalten: konfig.spalten, ...(konfig.filter ? { filter: konfig.filter } : {}), ...(a.listeId ? { listeId: a.listeId } : {}), limit: 50 };
      const zeilen = await post(`/objekte/${a.objekt}/abfrage`, abfrage);
      expect(zeilen.status, a.name).toBe(200);
      const gesamt = (await json(zeilen)).gesamt as number;
      expect(gesamt, a.name).toBeGreaterThan(0);
      if (!konfig.gruppierung) continue;
      if (a.art === "kanban") {
        const board = await post(`/objekte/${a.objekt}/board`, { ...abfrage, gruppe: konfig.gruppierung, summe: konfig.spalten.map((x) => x.feld).find((f) => ZAHLENFELDER.includes(f)) ?? null });
        expect(board.status, a.name).toBe(200);
        const spalten = (await json(board)).spalten as { wert: string | null; anzahl: number; summe: string }[];
        expect(spalten.filter((x) => x.wert !== null)).toHaveLength(4);
        expect(spalten.reduce((n, x) => n + x.anzahl, 0)).toBe(gesamt);
        expect(spalten.some((x) => Number(x.summe) > 0)).toBe(true);
        continue;
      }
      const betraege = konfig.spalten.map((x) => x.feld);
      const gruppen = await post(`/objekte/${a.objekt}/gruppen`, { ...abfrage, gruppe: konfig.gruppierung, summen: betraege.filter((f) => ZAHLENFELDER.includes(f)).slice(0, 2) }).then(async (r) => ({ status: r.status, daten: await json(r) }));
      expect(gruppen.status, a.name).toBe(200);
      const g = gruppen.daten as { gruppen: { anzahl: number }[]; gesamt: number };
      expect(g.gesamt, a.name).toBe(gesamt);
      expect(g.gruppen.length, a.name).toBeGreaterThan(1);
      expect(g.gruppen.reduce((n, x) => n + x.anzahl, 0), a.name).toBe(gesamt);
    }
  });

  it("Betreuung und Zuständigkeiten verweisen auf echte Personen mit Zugriff; Verknüpfungsfeld hat Rückverweise", async () => {
    const kollege = await idVon(db, KOLLEGE);
    const org = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM organisation WHERE felder ->> ${DEMO_FELD.betreuung} = ${kollege}`);
    expect(org.rows[0]!.n).toBeGreaterThan(0);
    const zugewiesen = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM aufgabe WHERE zustaendig IS NOT NULL`);
    expect(zugewiesen.rows[0]!.n).toBeGreaterThan(0);
    const links = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM datensatz_link WHERE art = 'relation' AND von_typ = 'organisation' AND zu_typ = 'person'`);
    expect(links.rows[0]!.n).toBeGreaterThan(0);
  });

  it("Namen von Feldern, Listen und Aufgaben folgen der Sprache", async () => {
    const felder = (await json(await get("/objekte/organisation/felder"))).daten as { name: string }[];
    const listen = (await json(await get("/listen"))).daten as { name: string }[];
    if (sprache === "en") {
      expect(felder.map((f) => f.name)).toEqual(expect.arrayContaining(["Interest", "Annual revenue", "Main contact", "Account owner"]));
      expect(listen.map((l) => l.name).sort()).toEqual(["Co-investors 2026", "Deals in review", "LP pipeline"]);
    } else {
      expect(felder.map((f) => f.name)).toEqual(expect.arrayContaining(["Interesse", "Jahresumsatz", "Hauptkontakt", "Betreuung"]));
      expect(listen.map((l) => l.name).sort()).toEqual(["Co-Investoren 2026", "Deals in der Prüfung", "LP-Pipeline"]);
    }
  });
});

describe("Demo-Zugänge entfernen", () => {
  it("entfernt auch die Ansichten, Zuständigkeiten und die Betreuung, die an den Demo-Personen hängen (keine Fremdschlüsselverletzung)", async () => {
    await leeren(db);
    await schreibeDemodaten(db, erzeugeDemodaten({ seed: 1 }));
    await db.insert(s.fonds).values({ id: FONDS, name: "Fonds Demo", kurzname: "FD", vintage: 2024, zeichnungskapital: "1000000.00" }).onConflictDoNothing();
    await schreibeDemoZugaenge(db, [FONDS]);
    const intern = DEMO_ZUGAENGE.slice(0, 3);
    const ids = (await db.select({ id: s.benutzer.id, email: s.benutzer.email }).from(s.benutzer)).filter((b) => intern.some((z) => z.email === b.email));
    const verwalterin = ids.find((b) => b.email === DEMO_ZUGAENGE.find((z) => z.globalVerwalter)!.email)!;
    await schreibeDemoCrmNachZugaengen(db, { besitzerId: verwalterin.id, betreuerIds: ids.map((b) => b.id) });
    expect((await db.select().from(s.ansicht)).length).toBeGreaterThan(0);
    expect((await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM organisation WHERE felder ? ${DEMO_FELD.betreuung}`)).rows[0]!.n).toBeGreaterThan(0);
    await entferneDemoZugaenge(db);
    expect((await db.select().from(s.ansicht)).length).toBe(0);
    expect((await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM aufgabe WHERE zustaendig IS NOT NULL`)).rows[0]!.n).toBe(0);
    expect((await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM organisation WHERE felder ? ${DEMO_FELD.betreuung}`)).rows[0]!.n).toBe(0);
    expect((await db.select().from(s.benutzer).where(sql`${s.benutzer.email} = ${intern[0]!.email}`)).length).toBe(0);
  });
});
