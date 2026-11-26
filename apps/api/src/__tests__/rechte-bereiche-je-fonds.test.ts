import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { DEMO_GRUPPEN, DEMO_ZUGAENGE, entferneDemoZugaenge, schreibeDemoZugaenge } from "@carraway/db/demo";
import { ladeRechte } from "../rechte/aufloesung";
import { BEREICHE, type Bereich } from "../rechte/bereiche";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { grundbestand, ID } from "./hilfen-instrumente";
import { erstelleTestApp, legePersonAn, person, type Testperson } from "./hilfen-auth";

/**
 * Bereiche je Fonds und Stufe je Bereich (docs/rechte-modell.md, „Bereiche je Fonds“). Belegt: bestehende Gruppen und Rollen behalten exakt
 * ihre Rechte (Vergleich mit der Auflösung vor der Erweiterung), und Kombinationen aus Gruppen, Ausnahmen und Gruppen ohne Fonds erweitern
 * keine Rechte. Alle Daten sind erfunden.
 */

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);

const F1 = ID.fonds;
const F2 = ID.anderer;
const B2 = "00000000-0000-4000-8000-0000000000c2"; // Beteiligung im zweiten Fonds
const DEAL_F1 = "00000000-0000-4000-8000-0000000000d1";
const DEAL_F2 = "00000000-0000-4000-8000-0000000000d2";

const genau = person("jefonds-genau");
const mitAusnahme = person("jefonds-ausnahme", { rollen: { [F2]: "verwalter", [F1]: "verwalter" } });
const gemischt = person("jefonds-gemischt");
const vergleich = person("jefonds-vergleich");
const dreifach = person("jefonds-dreifach", { rollen: { [F1]: "betrachter" } });
const alle = [genau, mitAusnahme, gemischt, vergleich, dreifach];

const anfrage = (methode: string, pfad: string, als: Testperson | undefined, body?: unknown) =>
  t.request(pfad, { method: methode, ...(als ? { als } : {}), headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

async function rolle(name: string, bereiche: string[], bereichStufen?: Record<string, string>): Promise<string> {
  const antwort = await anfrage("POST", "/rechte/rollen", undefined, { name, bereiche, ...(bereichStufen ? { bereichStufen } : {}) });
  expect(antwort.status, name).toBe(201);
  return (await json(antwort)).id as string;
}

async function gruppe(eingabe: Record<string, unknown>): Promise<string> {
  const antwort = await anfrage("POST", "/rechte/gruppen", undefined, eingabe);
  expect(antwort.status, JSON.stringify(eingabe)).toBe(201);
  return (await json(antwort)).id as string;
}

const ids: Record<string, string> = {};
const id = (p: Testperson) => ids[p.email]!;

beforeEach(async () => {
  await grundbestand(db);
  await db.insert(s.beteiligung).values({ id: B2, fondsId: F2, organisationId: ID.orgB, instrument: "offene_beteiligung", erstinvestment: "2025-01-01" });
  await db.insert(s.deal).values([
    { id: DEAL_F1, organisationId: ID.orgA, fondsId: F1, titel: "Sonnenweg Deal Eins" },
    { id: DEAL_F2, organisationId: ID.orgB, fondsId: F2, titel: "Sonnenweg Deal Zwei" },
  ]);
  await db.execute(sql`DELETE FROM nutzergruppe`);
  await db.execute(sql`DELETE FROM rechterolle`);
  await db.execute(sql`UPDATE rechte_einstellung SET fonds_offen = true`);
  for (const p of alle) ids[p.email] = await legePersonAn(db, p);
});
afterAll(async () => {
  await entferneDemoZugaenge(db);
  await db.execute(sql`UPDATE rechte_einstellung SET fonds_offen = true`);
  await leeren(db);
  await pool.end();
});

// Auflösung vor der Erweiterung (Migration 0065): Stufe je Fonds aus eigener Fondsrolle oder höchster Gruppenstufe, Bereiche fondsübergreifend
// als Vereinigung der Rollen; ohne Gruppe alle Bereiche. Sie dient hier als Maßstab für „keine Rechteänderung“.
const ALTE_FONDSROLLE = sql`
  SELECT r.benutzer_id, r.fonds_id, r.rolle FROM fondsrolle r
  UNION ALL
  SELECT g.benutzer_id, g.fonds_id, max(g.stufe) FROM (
    SELECT m.benutzer_id, nf.fonds_id, ng.stufe FROM nutzergruppe_mitglied m JOIN nutzergruppe ng ON ng.id = m.gruppe_id JOIN nutzergruppe_fonds nf ON nf.gruppe_id = ng.id
    UNION ALL
    SELECT m.benutzer_id, f.id, ng.stufe FROM nutzergruppe_mitglied m JOIN nutzergruppe ng ON ng.id = m.gruppe_id AND NOT ng.fonds_beschraenkt CROSS JOIN fonds f
    WHERE COALESCE((SELECT e.fonds_offen FROM rechte_einstellung e WHERE e.id = 1), true)
  ) g WHERE NOT EXISTS (SELECT 1 FROM fondsrolle d WHERE d.benutzer_id = g.benutzer_id AND d.fonds_id = g.fonds_id)
  GROUP BY g.benutzer_id, g.fonds_id`;

type Matrix = Record<string, Partial<Record<Bereich, string>>>;

/** Erwartung nach der alten Auflösung: Stufe am Fonds für jeden Bereich der Person. */
async function alteMatrix(benutzerId: string): Promise<{ matrix: Matrix; stufeOhneFonds: string | null; bereiche: Bereich[] | null }> {
  const rollen = (await db.execute<{ fonds_id: string; rolle: string }>(sql`SELECT fonds_id, rolle FROM (${ALTE_FONDSROLLE}) a WHERE benutzer_id = ${benutzerId}`)).rows;
  const gruppen = (
    await db.execute<{ stufe: string; bereiche: string[] | null }>(sql`
      SELECT ng.stufe, r.bereiche FROM nutzergruppe_mitglied m JOIN nutzergruppe ng ON ng.id = m.gruppe_id
      LEFT JOIN nutzergruppe_rolle gr ON gr.gruppe_id = ng.id LEFT JOIN rechterolle r ON r.id = gr.rolle_id WHERE m.benutzer_id = ${benutzerId}`)
  ).rows;
  const rang = ["betrachter", "bearbeiter", "freigeber", "verwalter"];
  const bereiche = gruppen.length ? BEREICHE.filter((b) => gruppen.some((g) => (g.bereiche ?? []).includes(b))) : null;
  const matrix: Matrix = {};
  for (const r of rollen) matrix[r.fonds_id] = Object.fromEntries((bereiche ?? BEREICHE).map((b) => [b, r.rolle]));
  const stufeOhneFonds = gruppen.reduce<string | null>((a, g) => (a === null || rang.indexOf(g.stufe) > rang.indexOf(a) ? g.stufe : a), null);
  return { matrix, stufeOhneFonds, bereiche };
}

/** Neue Auflösung: Sicht `wirksames_bereichsrecht` (Zeilen ohne Bereich gelten für alle Bereiche). */
async function neueMatrix(benutzerId: string): Promise<Matrix> {
  const zeilen = (await db.execute<{ fonds_id: string; bereich: string | null; rolle: string }>(sql`SELECT fonds_id, bereich, rolle FROM wirksames_bereichsrecht WHERE benutzer_id = ${benutzerId}`)).rows;
  const matrix: Matrix = {};
  for (const z of zeilen) {
    const jeFonds = (matrix[z.fonds_id] ??= {});
    for (const b of z.bereich === null ? BEREICHE : [z.bereich as Bereich]) {
      expect(jeFonds[b], `doppelte Zeile ${z.fonds_id}/${b}`).toBeUndefined();
      jeFonds[b] = z.rolle;
    }
  }
  return matrix;
}

/** Vergleicht alte und neue Auflösung für eine Person: Sicht, `ladeRechte` (Stufe je Fonds, Bereiche, Stufe ohne Fonds je Bereich). */
async function erwarteUnveraendert(benutzerId: string, bezeichnung: string) {
  const alt = await alteMatrix(benutzerId);
  expect(await neueMatrix(benutzerId), bezeichnung).toEqual(alt.matrix);
  const rechte = await db.transaction((tx) => ladeRechte(tx as never, benutzerId));
  expect(rechte.bereiche === null ? null : [...rechte.bereiche], bezeichnung).toEqual(alt.bereiche);
  expect(rechte.stufeOhneFonds, bezeichnung).toBe(alt.stufeOhneFonds);
  const ohne = rechte.stufeOhneFondsJeBereich;
  if (alt.bereiche === null) expect(ohne, bezeichnung).toBeNull();
  else expect(Object.fromEntries(ohne ?? []), bezeichnung).toEqual(alt.stufeOhneFonds ? Object.fromEntries(alt.bereiche.map((b) => [b, alt.stufeOhneFonds])) : {});
  if (rechte.stufen) {
    const ausAkteur: Matrix = {};
    for (const [f, jeBereich] of rechte.stufen) ausAkteur[f] = Object.fromEntries(jeBereich);
    expect(ausAkteur, bezeichnung).toEqual(alt.matrix);
  }
}

describe("Überführung ohne Rechteänderung", () => {
  it("Demo-Gruppen und Demo-Zugänge: Stufe je Fonds und Bereich wie vor der Erweiterung, auch Carl mit Ausnahme am zweiten Fonds", async () => {
    await schreibeDemoZugaenge(db, [F1, F2], "x".repeat(32));
    const zugaenge = await db.select({ id: s.benutzer.id, email: s.benutzer.email }).from(s.benutzer);
    const demo = zugaenge.filter((z) => DEMO_ZUGAENGE.some((d) => d.email === z.email && !d.globalVerwalter));
    expect(demo.length).toBe(DEMO_ZUGAENGE.filter((d) => !d.globalVerwalter).length);
    expect((await db.select().from(s.nutzergruppe)).every((g) => !g.bereicheJeFonds)).toBe(true);
    expect((await db.select().from(s.nutzergruppe)).length).toBe(DEMO_GRUPPEN.length);
    for (const z of demo) await erwarteUnveraendert(z.id, z.email);
    // Carl: Gruppe nur am ersten Fonds, Ausnahme Betrachter am zweiten; Finanzen dort lesend wie bisher.
    const carl = demo.find((z) => z.email.startsWith("carl"))!;
    expect((await neueMatrix(carl.id))[F2]).toMatchObject({ finanzen: "betrachter", portfolio: "betrachter" });
    expect((await neueMatrix(carl.id))[F1]).toMatchObject({ finanzen: "bearbeiter" });
    await entferneDemoZugaenge(db);
  });

  it("zufällige Kombinationen bestehender Gruppen (ohne Bereiche je Fonds): exakt wie bisher", async () => {
    let saat = 7;
    const zufall = (n: number) => {
      saat = (saat * 1103515245 + 12345) % 2147483648;
      return saat % n;
    };
    const stufen = ["betrachter", "bearbeiter", "freigeber", "verwalter"];
    const personen = [genau, mitAusnahme, gemischt, vergleich];
    for (let runde = 0; runde < 6; runde++) {
      await db.execute(sql`DELETE FROM nutzergruppe`);
      await db.execute(sql`DELETE FROM rechterolle`);
      await db.execute(sql`UPDATE rechte_einstellung SET fonds_offen = ${zufall(2) === 0}`);
      const rollen: string[] = [];
      for (let r = 0; r < 3; r++) rollen.push(await rolle(`Zufall ${runde}-${r}`, BEREICHE.filter(() => zufall(3) === 0)));
      for (let g = 0; g < 4; g++) {
        const fonds = [F1, F2].filter(() => zufall(2) === 0);
        await gruppe({
          name: `Zufall ${runde}-${g}`,
          stufe: stufen[zufall(4)],
          fondsBeschraenkt: zufall(2) === 0,
          fondsIds: fonds,
          rollenIds: rollen.filter(() => zufall(2) === 0),
          mitglieder: personen.filter(() => zufall(2) === 0).map(id),
        });
      }
      for (const p of personen) await erwarteUnveraendert(id(p), `Runde ${runde}, ${p.email}`);
    }
  });
});

describe("Bereiche je Fonds und Stufe je Bereich", () => {
  /** Fonds Eins: Portfolio bearbeiten, Finanzen nur lesen, Dealflow; Fonds Zwei: nur Kontakte. */
  async function beispielGruppe(mitglieder: string[]) {
    const r = await rolle("Je Fonds", ["portfolio", "finanzen", "kontakte", "dealflow"], { finanzen: "betrachter" });
    return gruppe({
      name: "Je Fonds",
      stufe: "bearbeiter",
      fondsBeschraenkt: true,
      bereicheJeFonds: true,
      fondsIds: [F1, F2],
      fondsBereiche: { [F1]: ["portfolio", "finanzen", "dealflow"], [F2]: ["kontakte"] },
      rollenIds: [r],
      mitglieder,
    });
  }

  it("Auflösung: Stufe je Fonds und Bereich in /ich und in der Verwaltung", async () => {
    await beispielGruppe([id(genau)]);
    const ich = await json(await anfrage("GET", "/ich", genau));
    expect(ich.bereicheJeFonds).toEqual({ [F1]: { portfolio: "bearbeiter", finanzen: "betrachter", dealflow: "bearbeiter" }, [F2]: { kontakte: "bearbeiter" } });
    // Bisherige Felder bleiben: Vereinigung der Bereiche, Stufe je Fonds über alle Bereiche.
    expect(ich.bereiche).toEqual(["dealflow", "finanzen", "kontakte", "portfolio"]);
    expect(Object.fromEntries(ich.rollen.map((r: { fondsId: string; rolle: string }) => [r.fondsId, r.rolle]))).toEqual({ [F1]: "bearbeiter", [F2]: "bearbeiter" });
    expect(ich.stufeOhneFondsJeBereich).toEqual({ portfolio: "bearbeiter", finanzen: "betrachter", dealflow: "bearbeiter", kontakte: "bearbeiter" });
    const verwaltung = await json(await anfrage("GET", `/benutzer/${id(genau)}/rechte`, undefined));
    expect(verwaltung.bereicheJeFonds).toEqual(ich.bereicheJeFonds);
    // Ohne Gruppe: keine Unterscheidung.
    expect((await json(await anfrage("GET", "/ich", vergleich))).bereicheJeFonds).toBeNull();
  });

  it("Durchsetzung: Bereich und Stufe zählen nur zusammen an demselben Fonds", async () => {
    await beispielGruppe([id(genau)]);
    // Portfolio nur am ersten Fonds.
    expect((await anfrage("GET", `/beteiligungen/${ID.eigen}`, genau)).status).toBe(200);
    expect((await anfrage("GET", `/beteiligungen/${B2}`, genau)).status).toBe(403);
    // Finanzen am ersten Fonds nur lesen, am zweiten gar nicht (dort hat die Person Bearbeiter, aber nur für Kontakte).
    expect((await anfrage("GET", `/fonds/${F1}/journal`, genau)).status).toBe(200);
    expect((await anfrage("POST", "/zinslaeufe", genau, { fondsId: F1, stichtag: "2026-12-31" })).status).toBe(403);
    expect((await anfrage("GET", `/fonds/${F2}/journal`, genau)).status).toBe(403);
    expect((await anfrage("POST", "/zinslaeufe", genau, { fondsId: F2, stichtag: "2026-12-31" })).status).toBe(403);
    // Kontakte haben keinen Fonds: über die Gruppe erreichbar.
    expect((await anfrage("GET", `/organisationen/${ID.orgA}`, genau)).status).toBe(200);
    // Eingebettete Beteiligungen nur am ersten Fonds; Dealliste nur Deals des ersten Fonds.
    const org = await json(await anfrage("GET", `/organisationen/${ID.orgB}`, genau));
    expect(org.beteiligungen.map((b: { id: string }) => b.id)).not.toContain(B2);
    const deals = (await json(await anfrage("GET", "/deals", genau))).daten.map((d: { id: string }) => d.id);
    expect(deals).toContain(DEAL_F1);
    expect(deals).not.toContain(DEAL_F2);
    expect((await anfrage("GET", `/deals/${DEAL_F2}`, genau)).status).toBe(403);
  });

  it("Gegenprobe: dieselbe Gruppe ohne Grenze und ohne Bereiche je Fonds erlaubt das Schreiben der Finanzen", async () => {
    const r = await rolle("Ohne Grenze", ["portfolio", "finanzen", "kontakte", "dealflow"]);
    await gruppe({ name: "Fondsübergreifend", stufe: "bearbeiter", fondsBeschraenkt: true, fondsIds: [F1, F2], rollenIds: [r], mitglieder: [id(vergleich)] });
    expect((await anfrage("POST", "/zinslaeufe", vergleich, { fondsId: F2, stichtag: "2026-12-31" })).status).not.toBe(403);
    expect((await anfrage("GET", `/beteiligungen/${B2}`, vergleich)).status).toBe(200);
  });

  it("Ausnahme: setzt die Stufe am Fonds, bringt aber keine Bereiche mit; die Grenze der Rolle gilt auch über ihr", async () => {
    await beispielGruppe([id(mitAusnahme)]);
    // Verwalter als Ausnahme an beiden Fonds: am zweiten Fonds weiter nur Kontakte.
    expect((await anfrage("GET", `/beteiligungen/${B2}`, mitAusnahme)).status).toBe(403);
    expect((await anfrage("GET", `/fonds/${F2}/journal`, mitAusnahme)).status).toBe(403);
    expect((await anfrage("GET", `/fonds/${F2}/rollen`, mitAusnahme)).status).toBe(403);
    // Am ersten Fonds Portfolio als Verwalter, Finanzen höchstens lesen.
    expect((await anfrage("POST", "/zinslaeufe", mitAusnahme, { fondsId: F1, stichtag: "2026-12-31" })).status).toBe(403);
    const ich = await json(await anfrage("GET", "/ich", mitAusnahme));
    expect(ich.bereicheJeFonds).toEqual({ [F1]: { portfolio: "verwalter", finanzen: "betrachter", dealflow: "verwalter" }, [F2]: { kontakte: "verwalter" } });
  });

  it("Gruppe ohne Fonds plus Gruppe je Fonds: Bereiche der Gruppe ohne Fonds kommen an keinen Fonds", async () => {
    const finanzen = await rolle("Finanzen überall", ["finanzen"]);
    await gruppe({ name: "Ohne Fonds", stufe: "verwalter", fondsBeschraenkt: true, rollenIds: [finanzen], mitglieder: [id(gemischt)] });
    const nurPortfolio = await rolle("Nur Portfolio", ["portfolio"]);
    await gruppe({ name: "Portfolio Eins", stufe: "bearbeiter", fondsBeschraenkt: true, bereicheJeFonds: true, fondsIds: [F1], rollenIds: [nurPortfolio], mitglieder: [id(gemischt)] });
    expect((await anfrage("GET", `/beteiligungen/${ID.eigen}`, gemischt)).status).toBe(200);
    expect((await anfrage("GET", `/fonds/${F1}/journal`, gemischt)).status).toBe(403);
    expect((await anfrage("GET", "/zinslaeufe", gemischt)).status).toBe(403);
    // Die Stufe der Gruppe ohne Fonds (Verwalter) hebt die Stufe der Gruppe je Fonds nicht an: Portfolio bleibt Bearbeiter.
    const ich = await json(await anfrage("GET", "/ich", gemischt));
    expect(ich.bereicheJeFonds).toEqual({ [F1]: { portfolio: "bearbeiter" } });
  });

  it("Gruppe ohne Fonds + Gruppe je Fonds + Ausnahme: die Ausnahme setzt nur die Stufe, Bereiche nur an ihrem Fonds", async () => {
    // Fondsübergreifende Gruppe ohne Fonds mit Finanzen (Verwalter), Gruppe je Fonds mit Portfolio am ersten Fonds, Ausnahme Betrachter am ersten Fonds.
    const finanzen = await rolle("Finanzen ohne Fonds", ["finanzen"]);
    await gruppe({ name: "Finanzen ohne Fonds", stufe: "verwalter", fondsBeschraenkt: true, rollenIds: [finanzen], mitglieder: [id(dreifach)] });
    const portfolio = await rolle("Portfolio je Fonds", ["portfolio"]);
    await gruppe({ name: "Portfolio je Fonds", stufe: "bearbeiter", fondsBeschraenkt: true, bereicheJeFonds: true, fondsIds: [F1], rollenIds: [portfolio], mitglieder: [id(dreifach)] });
    // Am ersten Fonds: Stufe der Ausnahme für die fondsübergreifenden Bereiche (Finanzen, Regel wie bisher) und den Bereich der Gruppe je Fonds dort.
    const ich = await json(await anfrage("GET", "/ich", dreifach));
    expect(ich.bereicheJeFonds).toEqual({ [F1]: { portfolio: "betrachter", finanzen: "betrachter" } });
    expect((await anfrage("GET", `/fonds/${F1}/journal`, dreifach)).status).toBe(200);
    expect((await anfrage("POST", "/zinslaeufe", dreifach, { fondsId: F1, stichtag: "2026-12-31" })).status).toBe(403);
    expect((await anfrage("POST", `/beteiligungen/${ID.eigen}/vorgaenge`, dreifach, { art: "zusage", valuta: "2025-01-01", betrag: "1000" })).status).toBe(403);
    // Am zweiten Fonds nichts: Weder die Verwalterstufe der Gruppe ohne Fonds noch die Gruppe je Fonds reichen dorthin.
    expect((await anfrage("GET", `/fonds/${F2}/journal`, dreifach)).status).toBe(403);
    expect((await anfrage("GET", `/beteiligungen/${B2}`, dreifach)).status).toBe(403);
    expect((await anfrage("GET", "/zinslaeufe", dreifach)).status).toBe(200);
  });

  it("Schreibwege über mehrere Bereiche: der fremde Bereich zählt an genau dem Fonds, in den geschrieben wird", async () => {
    // Dealflow am ersten Fonds, Portfolio nur am zweiten: Eine Beteiligung aus dem Deal des ersten Fonds darf nicht entstehen.
    const r = await rolle("Deals und Portfolio", ["dealflow", "portfolio", "kontakte"]);
    await gruppe({
      name: "Getrennt je Fonds",
      stufe: "bearbeiter",
      fondsBeschraenkt: true,
      bereicheJeFonds: true,
      fondsIds: [F1, F2],
      fondsBereiche: { [F1]: ["dealflow", "kontakte"], [F2]: ["portfolio"] },
      rollenIds: [r],
      mitglieder: [id(genau)],
    });
    const koerper = { fondsId: F1, instrument: "offene_beteiligung", erstinvestment: "2025-06-30", zusage: "1000.00" };
    const antwort = await anfrage("POST", `/deals/${DEAL_F1}/beteiligung`, genau, koerper);
    expect(antwort.status).toBe(403);
    expect((await json(antwort)).fehler.code).toBe("KEINE_BERECHTIGUNG");
    // Vorschau des Zusammenführens: Beteiligungen nur aus Fonds mit Portfolio.
    const vorschau = await json(await anfrage("POST", `/organisationen/${ID.orgA}/zusammenfuehren/vorschau`, genau, { quelleId: ID.orgB }));
    expect(vorschau.fondsIds).toEqual([F2]);
    expect(vorschau.verdeckteFonds).toBe(true);
    expect(vorschau.darfAusfuehren).toBe(false);
  });

  it("Zuständige mit Deal: Deal eines Fonds ohne Dealflow gilt als nicht vorhanden, auch mit Stufe am Fonds", async () => {
    const r = await rolle("Kontakte und Deals", ["kontakte", "dealflow"]);
    await gruppe({ name: "Kontakte und Deals", stufe: "bearbeiter", fondsBeschraenkt: true, bereicheJeFonds: true, fondsIds: [F1, F2], fondsBereiche: { [F1]: ["kontakte", "dealflow"], [F2]: ["kontakte"] }, rollenIds: [r], mitglieder: [id(genau)] });
    expect((await anfrage("GET", `/crm/zustaendige?dealId=${DEAL_F1}`, genau)).status).toBe(200);
    // Am zweiten Fonds Bearbeiter, aber nur für Kontakte.
    expect((await anfrage("GET", `/crm/zustaendige?dealId=${DEAL_F2}`, genau)).status).toBe(404);
  });

  it("Aufgabe an einem Deal: Schreibrecht verlangt Bearbeiter im Dealflow am Fonds des Deals, nicht in Kontakten", async () => {
    const r = await rolle("Deals lesen", ["dealflow", "kontakte"], { dealflow: "betrachter" });
    await gruppe({ name: "Deals lesen", stufe: "bearbeiter", fondsBeschraenkt: true, fondsIds: [F1], rollenIds: [r], mitglieder: [id(vergleich)] });
    expect((await anfrage("POST", "/crm/aufgaben", vergleich, { titel: "Ohne Deal", organisationId: ID.orgA })).status).toBe(201);
    expect((await anfrage("POST", "/crm/aufgaben", vergleich, { titel: "Am Deal", dealId: DEAL_F1 })).status).toBe(403);
  });

  it("Kalenderabonnement: Wiedervorlagen an Deals nur aus Fonds mit Dealflow", async () => {
    await beispielGruppe([id(genau)]);
    const tag = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await db.insert(s.aktivitaet).values([
      { art: "notiz", datum: "2026-01-01", titel: "Wiedervorlage Eins", dealId: DEAL_F1, wiedervorlage: tag, zustaendig: id(genau) },
      { art: "notiz", datum: "2026-01-01", titel: "Wiedervorlage Zwei", dealId: DEAL_F2, wiedervorlage: tag, zustaendig: id(genau) },
    ]);
    const angelegt = await t.request("/einstellungen/kalender-link", { method: "POST", als: genau });
    expect(angelegt.status).toBe(201);
    const { token } = (await json(angelegt)) as { token: string };
    const ics = await (await t.app.request(`/api/v1/kalender/${token}.ics`)).text();
    expect(ics).toContain("Wiedervorlage Eins");
    expect(ics).not.toContain("Wiedervorlage Zwei");
  });

  it("Grenze der Rolle begrenzt auch Daten ohne Fonds", async () => {
    const r = await rolle("Kontakte lesen", ["kontakte"], { kontakte: "betrachter" });
    await gruppe({ name: "Kontakte lesen", stufe: "verwalter", rollenIds: [r], mitglieder: [id(vergleich)] });
    expect((await anfrage("GET", `/organisationen/${ID.orgA}`, vergleich)).status).toBe(200);
    expect((await anfrage("POST", "/organisationen", vergleich, { name: "Nur lesen Beispiel", art: "unternehmen" })).status).toBe(403);
  });

  it("Suche: Deals nur an Fonds mit Dealflow, Kontakte über die Gruppe", async () => {
    await beispielGruppe([id(genau)]);
    const suche = await json(await anfrage("GET", "/suche?q=Sonnenweg", genau));
    expect(suche.deals.map((d: { id: string }) => d.id)).toEqual([DEAL_F1]);
    const kontakte = await json(await anfrage("GET", "/suche?q=Alpha", genau));
    expect(kontakte.organisationen.map((o: { id: string }) => o.id)).toContain(ID.orgA);
  });

  it("Verwaltung: Bereiche je Fonds nur mit dem Schalter und nur für Fonds der Gruppe; Grenzen nur für Bereiche der Rolle", async () => {
    const r = await rolle("Mit Grenze", ["portfolio"], { portfolio: "betrachter", finanzen: "betrachter" });
    const stand = await json(await anfrage("GET", "/rechte", undefined));
    expect(stand.rollen.find((x: { id: string }) => x.id === r).bereichStufen).toEqual({ portfolio: "betrachter" });
    expect((await anfrage("POST", "/rechte/rollen", undefined, { name: "Falsche Grenze", bereiche: ["portfolio"], bereichStufen: { portfolio: "chef" } })).status).toBe(400);

    const ohneSchalter = await anfrage("POST", "/rechte/gruppen", undefined, { name: "Ohne Schalter", fondsBeschraenkt: true, fondsIds: [F1], fondsBereiche: { [F1]: ["portfolio"] } });
    expect(ohneSchalter.status).toBe(400);
    const fremderFonds = await anfrage("POST", "/rechte/gruppen", undefined, { name: "Fremder Fonds", bereicheJeFonds: true, fondsBeschraenkt: true, fondsIds: [F1], fondsBereiche: { [F2]: ["portfolio"] } });
    expect(fremderFonds.status).toBe(400);

    const g = await gruppe({ name: "Schalter", bereicheJeFonds: true, fondsBeschraenkt: true, fondsIds: [F1, F2], fondsBereiche: { [F1]: ["portfolio"] }, rollenIds: [r] });
    let gruppeStand = (await json(await anfrage("GET", "/rechte", undefined))).gruppen.find((x: { id: string }) => x.id === g);
    expect(gruppeStand).toMatchObject({ bereicheJeFonds: true, fondsIds: [F1, F2].sort(), fondsBereiche: { [F1]: ["portfolio"] } });
    // Nur die Mitglieder ändern: Auswahl je Fonds bleibt.
    await anfrage("PATCH", `/rechte/gruppen/${g}`, undefined, { mitglieder: [id(genau)] });
    gruppeStand = (await json(await anfrage("GET", "/rechte", undefined))).gruppen.find((x: { id: string }) => x.id === g);
    expect(gruppeStand.fondsBereiche).toEqual({ [F1]: ["portfolio"] });
    // Schalter aus: Auswahl je Fonds entfällt, die Gruppe gilt wieder fondsübergreifend.
    await anfrage("PATCH", `/rechte/gruppen/${g}`, undefined, { bereicheJeFonds: false });
    gruppeStand = (await json(await anfrage("GET", "/rechte", undefined))).gruppen.find((x: { id: string }) => x.id === g);
    expect(gruppeStand).toMatchObject({ bereicheJeFonds: false, fondsBereiche: {} });
    const protokoll = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM aenderung WHERE tabelle = 'nutzergruppe' AND datensatz_id = ${g}`);
    expect(protokoll.rows[0]!.n).toBeGreaterThanOrEqual(3);
  });
});
