import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { benutzer, deal, dealPhasenwechsel } from "@carraway/db";
import { erstelleTestApp, legeInvestorAn, legePersonAn, person, STANDARD, type Testperson } from "./hilfen-auth";
import { grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";
import { json, leeren, oeffneTestdb } from "./hilfen";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const bearbeiter = person("dealflow-bearbeitung", { rollen: { [ID.fonds]: "bearbeiter" } });
const projektleitung = person("dealflow-projektleitung", { rollen: { [ID.fonds]: "freigeber" } });
const betrachter = person("dealflow-lesen", { rollen: { [ID.fonds]: "betrachter" } });
const andererFonds = person("dealflow-anderer-fonds", { rollen: { [ID.anderer]: "bearbeiter" } });
const inaktiv = person("dealflow-inaktiv", { rollen: { [ID.fonds]: "bearbeiter" }, aktiv: false });
let ids: { bearbeiten: string; projektleitung: string; lesen: string; fremd: string; inaktiv: string; investor: string; technisch: string };

beforeEach(async () => {
  await grundbestand(db);
  ids = {
    bearbeiten: await legePersonAn(db, bearbeiter),
    projektleitung: await legePersonAn(db, projektleitung),
    lesen: await legePersonAn(db, betrachter),
    fremd: await legePersonAn(db, andererFonds),
    inaktiv: await legePersonAn(db, inaktiv),
    investor: await legeInvestorAn(db, person("dealflow-investor"), []),
    technisch: (await db.insert(benutzer).values({ name: "Technischer Zugang", email: "dealflow-api@test.example", technisch: true, globalVerwalter: true }).returning())[0]!.id,
  };
});

afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const anfrage = (method: string, pfad: string, als: Testperson, body?: unknown) =>
  t.request(pfad, { method, als, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const legeDealAn = async (aenderung: Record<string, unknown> = {}) => {
  const antwort = await anfrage("POST", "/deals", bearbeiter, { titel: "Neue Anfrage", organisationId: ID.orgA, fondsId: ID.fonds, ...aenderung });
  expect(antwort.status).toBe(201);
  return json(antwort);
};

const leer = { erwartetInvestmentmanagerId: null, erwartetProjektleiterId: null };

describe("Deal-Eingang", () => {
  it("zeigt nur sichtbare offene Deals mit Eingangsdaten und Namen in der Arbeitsliste und auf dem Board", async () => {
    const neu = await legeDealAn({
      eingangsdatum: "2025-03-04", herkunft: "sourcing", selbstUebernehmen: true, projektleiterId: ids.projektleitung, quelle: "Empfehlung", betreuung: "Bestandstext",
    });
    const offenOhneFonds = await legeDealAn({ fondsId: null });
    await db.insert(deal).values([
      { organisationId: ID.orgA, fondsId: ID.anderer, titel: "Fremd" },
      { organisationId: ID.orgA, fondsId: ID.fonds, titel: "Abgesagt", status: "abgesagt" },
      { organisationId: ID.orgA, fondsId: ID.fonds, titel: "Investiert", status: "investiert" },
    ]);
    const antwort = await json(await anfrage("GET", "/dealflow/arbeitsliste", betrachter));
    expect(antwort.benutzerId).toBe(ids.lesen);
    expect(antwort.deals).toHaveLength(2);
    expect(antwort.deals).toContainEqual({
      id: neu.id, titel: "Neue Anfrage", unternehmenName: "Alpha Beispiel", fondsId: ID.fonds, eingangsdatum: "2025-03-04",
      herkunft: "sourcing", dealtyp: null, quelle: "Empfehlung", investmentmanagerId: ids.bearbeiten, investmentmanagerName: bearbeiter.name,
      projektleiterId: ids.projektleitung, projektleiterName: projektleitung.name, phase: "anfrage", betreuung: "Bestandstext",
    });
    expect(antwort.deals).toContainEqual(expect.objectContaining({
      id: offenOhneFonds.id, fondsId: null, eingangsdatum: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), herkunft: null, investmentmanagerName: null,
    }));
    const [start] = await db.select().from(dealPhasenwechsel).where(eq(dealPhasenwechsel.dealId, neu.id));
    expect(start?.am).toBe("2025-03-04");

    const board = await anfrage("POST", "/crm/objekte/deal/board", betrachter, {
      gruppe: "phase", spalten: ["eingangsdatum", "herkunft", "investmentmanager", "projektleiter"].map((feld) => ({ feld })),
    });
    expect(board.status).toBe(200);
    const { spalten } = await json(board);
    expect(spalten.flatMap((s: { karten: unknown[] }) => s.karten)).toContainEqual(expect.objectContaining({
      id: neu.id, eingangsdatum: "2025-03-04", herkunft: "sourcing", investmentmanager: bearbeiter.name, projektleiter: projektleitung.name,
    }));
  });

  it("legt den Dealtyp an, liefert ihn in den Ansichten und speichert Änderungen sowie ein explizites Leeren", async () => {
    const neu = await legeDealAn({ dealtyp: "erstinvestment" });
    const ohne = await legeDealAn({ dealtyp: null });
    expect(neu.dealtyp).toBe("erstinvestment");
    expect(ohne.dealtyp).toBeNull();

    const pfad = `/deals/${neu.id}`;
    const { daten } = await json(await anfrage("GET", "/deals", betrachter));
    const { deals } = await json(await anfrage("GET", "/dealflow/arbeitsliste", betrachter));
    for (const liste of [daten, deals]) {
      expect(liste).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: neu.id, dealtyp: "erstinvestment" }),
        expect.objectContaining({ id: ohne.id, dealtyp: null }),
      ]));
    }
    expect(await json(await anfrage("GET", pfad, betrachter))).toMatchObject({ dealtyp: "erstinvestment" });
    expect((await anfrage("PATCH", pfad, betrachter, { dealtyp: "anschlussinvestment" })).status).toBe(403);
    expect((await anfrage("PATCH", pfad, bearbeiter, { dealtyp: "unbekannt" })).status).toBe(400);
    expect((await anfrage("POST", "/deals", bearbeiter, { titel: "Ungültig", organisationId: ID.orgA, dealtyp: "unbekannt" })).status).toBe(400);

    for (const werte of [{ dealtyp: "anschlussinvestment" }, { quelle: "Messe" }, { dealtyp: null }]) {
      const antwort = await anfrage("PATCH", pfad, bearbeiter, werte);
      expect(antwort.status).toBe(200);
      expect(await json(antwort)).toMatchObject({ dealtyp: "dealtyp" in werte ? werte.dealtyp : "anschlussinvestment" });
    }
    expect(await json(await anfrage("GET", pfad, betrachter))).toMatchObject({ dealtyp: null });
  });

  it("bietet den Dealtyp im CRM als Auswahlfeld für Filter und Board-Gruppen an", async () => {
    const erst = await legeDealAn({ dealtyp: "erstinvestment", ticket: "150" });
    const anschluss = await legeDealAn({ dealtyp: "anschlussinvestment", ticket: "200" });
    const ohne = await legeDealAn({ ticket: "100" });

    const { daten } = await json(await anfrage("GET", "/crm/objekte/deal/felder", betrachter));
    expect(daten).toContainEqual(expect.objectContaining({
      schluessel: "dealtyp", typ: "auswahl",
      optionen: { optionen: [
        expect.objectContaining({ schluessel: "erstinvestment" }),
        expect.objectContaining({ schluessel: "anschlussinvestment" }),
      ] },
    }));

    const spalten = [{ feld: "dealtyp" }];
    const board = await anfrage("POST", "/crm/objekte/deal/board", betrachter, { gruppe: "dealtyp", summe: "ticket", spalten });
    expect(board.status).toBe(200);
    expect((await json(board)).spalten).toEqual([
      { wert: "erstinvestment", anzahl: 1, summe: "150.00", karten: [{ id: erst.id, dealtyp: "erstinvestment" }] },
      { wert: "anschlussinvestment", anzahl: 1, summe: "200.00", karten: [{ id: anschluss.id, dealtyp: "anschlussinvestment" }] },
      { wert: null, anzahl: 1, summe: "100.00", karten: [{ id: ohne.id, dealtyp: null }] },
    ]);

    for (const [element, erwartet] of [
      [{ feld: "dealtyp", operator: "ist", wert: "anschlussinvestment" }, anschluss],
      [{ feld: "dealtyp", operator: "leer" }, ohne],
    ] as const) {
      const antwort = await anfrage("POST", "/crm/objekte/deal/abfrage", betrachter, { spalten, filter: { verknuepfung: "und", elemente: [element] } });
      expect(antwort.status).toBe(200);
      expect((await json(antwort)).daten).toEqual([{ id: erwartet.id, dealtyp: erwartet.dealtyp }]);
    }
  });

  it("filtert Karten und Export über Fonds- und Personen-IDs und summiert alle Treffer vor der Kartenbegrenzung", async () => {
    await db.update(benutzer).set({ name: bearbeiter.name }).where(eq(benutzer.id, ids.projektleitung));
    const alpha = await legeDealAn({ titel: "Deal Alpha", investmentmanagerId: ids.bearbeiten, projektleiterId: ids.projektleitung, ticket: "100" });
    const beta = await legeDealAn({ titel: "Deal Beta", investmentmanagerId: ids.projektleitung, projektleiterId: ids.bearbeiten, ticket: "200" });
    const ohne = await legeDealAn({ titel: "Deal ohne Fonds", fondsId: null, ticket: "300" });
    await db.insert(deal).values({ organisationId: ID.orgA, fondsId: ID.anderer, titel: "Fremder Deal", ticket: "400" });

    const filter = (feld: string, wert?: string) => ({
      verknuepfung: "und",
      elemente: [{ feld, ...(wert === undefined ? { operator: "leer" } : { operator: "ist", wert }) }],
    });
    const spalten = ["titel", "fonds", "fondsId", "investmentmanager", "investmentmanagerId", "projektleiter", "projektleiterId"].map((feld) => ({ feld }));
    const board = async (feld: string, wert?: string) => {
      const antwort = await anfrage("POST", "/crm/objekte/deal/board", betrachter, {
        gruppe: "phase", summe: "ticket", kartenProSpalte: 1, spalten, filter: filter(feld, wert),
      });
      expect(antwort.status).toBe(200);
      const { spalten: gruppen } = await json(antwort);
      return gruppen.find((s: { wert: string }) => s.wert === "anfrage");
    };
    expect(await board("fondsId", ID.fonds)).toMatchObject({
      anzahl: 2, summe: "300.00", karten: [{ fonds: "Testfonds Eins", fondsId: ID.fonds }],
    });
    expect(await board("fondsId", ID.anderer)).toMatchObject({ anzahl: 0, summe: "0", karten: [] });
    expect(await board("investmentmanagerId", ids.bearbeiten)).toMatchObject({
      anzahl: 1, summe: "100.00", karten: [{ id: alpha.id, investmentmanager: bearbeiter.name, investmentmanagerId: ids.bearbeiten }],
    });
    expect(await board("projektleiterId", ids.bearbeiten)).toMatchObject({
      anzahl: 1, summe: "200.00", karten: [{ id: beta.id, projektleiter: bearbeiter.name, projektleiterId: ids.bearbeiten }],
    });
    for (const feld of ["fondsId", "investmentmanagerId", "projektleiterId"]) {
      expect(await board(feld)).toMatchObject({
        anzahl: 1, summe: "300.00", karten: [{ id: ohne.id, fonds: null, [feld]: null }],
      });
    }

    const exportiere = (feld: string, wert: string) => anfrage("POST", "/crm/objekte/deal/export", betrachter, {
      spalten: [{ feld: "titel" }, { feld: "fonds" }, { feld: "projektleiterId" }], filter: filter(feld, wert),
    });
    const exportiert = await exportiere("projektleiterId", ids.bearbeiten);
    expect(exportiert.status).toBe(200);
    expect(await exportiert.text()).toBe(`Titel,Fonds,Projektleiter-ID\nDeal Beta,Testfonds Eins,${ids.bearbeiten}\n`);
    const exportFremd = await exportiere("fondsId", ID.anderer);
    expect(exportFremd.status).toBe(200);
    expect(await exportFremd.text()).toBe("Titel,Fonds,Projektleiter-ID\n");
  });

  it("akzeptiert nur aktive interne Bearbeiter des Fonds und hält die Fondsrechte des Akteurs ein", async () => {
    const neu = await legeDealAn();
    const pfad = `/deals/${neu.id}`;
    const kandidaten = await json(await anfrage("GET", `${pfad}/zustaendige`, betrachter));
    expect(kandidaten.benutzer).toEqual(expect.arrayContaining([
      { id: ids.bearbeiten, name: bearbeiter.name },
      { id: ids.projektleitung, name: projektleitung.name },
    ]));
    for (const id of [ids.lesen, ids.fremd, ids.inaktiv, ids.investor, ids.technisch]) {
      expect(kandidaten.benutzer).not.toContainEqual(expect.objectContaining({ id }));
      const antwort = await anfrage("PATCH", `${pfad}/zuordnung`, bearbeiter, { ...leer, investmentmanagerId: id });
      expect(antwort.status).toBe(400);
      expect((await json(antwort)).error.code).toBe("assignee_invalid");
    }
    expect((await anfrage("GET", `${pfad}/zustaendige`, andererFonds)).status).toBe(403);
    for (const p of [betrachter, andererFonds]) {
      expect((await anfrage("PATCH", `${pfad}/zuordnung`, p, { ...leer, investmentmanagerId: ids.bearbeiten })).status).toBe(403);
    }
    expect((await anfrage("POST", "/deals", bearbeiter, {
      titel: "Unzulässig", organisationId: ID.orgA, fondsId: ID.fonds, projektleiterId: ids.fremd,
    })).status).toBe(400);
    expect((await anfrage("PATCH", `${pfad}/zuordnung`, bearbeiter, { investmentmanagerId: ids.bearbeiten })).status).toBe(400);
    await anfrage("POST", `${pfad}/absage`, bearbeiter, { grund: "Testabsage" });
    expect((await anfrage("PATCH", `${pfad}/zuordnung`, bearbeiter, { ...leer, investmentmanagerId: ids.bearbeiten })).status).toBe(409);
  });

  it("wendet die Picker-Sichtbarkeit bei der Anlage, Zuordnung und Fondsänderung an", async () => {
    const neu = await legeDealAn({ fondsId: null });
    const pfad = `/deals/${neu.id}`;
    const verwalterId = await legePersonAn(db, STANDARD);
    const { benutzer } = await json(await anfrage("GET", `${pfad}/zustaendige`, bearbeiter));
    expect(benutzer).not.toContainEqual(expect.objectContaining({ id: ids.fremd }));
    expect(benutzer).toEqual(expect.arrayContaining([
      { id: ids.projektleitung, name: projektleitung.name },
      { id: verwalterId, name: STANDARD.name },
    ]));

    const anlage = { titel: "Ohne Fonds", organisationId: ID.orgA, fondsId: null };
    for (const feld of ["investmentmanagerId", "projektleiterId"]) {
      const direkt = { [feld]: ids.fremd };
      const antworten = [
        await anfrage("PATCH", `${pfad}/zuordnung`, bearbeiter, { ...leer, ...direkt }),
        await anfrage("POST", "/deals", bearbeiter, { ...anlage, ...direkt }),
      ];
      for (const antwort of antworten) {
        expect(antwort.status).toBe(400);
        expect((await json(antwort)).error.code).toBe("assignee_invalid");
      }
    }
    expect((await anfrage("PATCH", `${pfad}/zuordnung`, bearbeiter, {
      ...leer, investmentmanagerId: ids.projektleitung, projektleiterId: verwalterId,
    })).status).toBe(200);
    expect((await anfrage("POST", "/deals", STANDARD, { ...anlage, projektleiterId: ids.fremd })).status).toBe(201);

    const imFonds = await legeDealAn({ projektleiterId: ids.projektleitung });
    // Der bisherige Projektleiter wechselt in einen Fonds, den der Bearbeiter nicht sieht.
    await legePersonAn(db, { ...projektleitung, rollen: { [ID.anderer]: "freigeber" } });
    const ohneFonds = await anfrage("PATCH", `/deals/${imFonds.id}`, bearbeiter, { fondsId: null });
    expect(ohneFonds.status).toBe(400);
    expect((await json(ohneFonds)).error.code).toBe("assignee_invalid");
    expect(await json(await anfrage("GET", `/deals/${imFonds.id}`, bearbeiter))).toMatchObject({
      fondsId: ID.fonds, projektleiterId: ids.projektleitung,
    });
    expect((await anfrage("PATCH", `/deals/${imFonds.id}`, STANDARD, { fondsId: null })).status).toBe(200);
  });

  it("übernimmt atomar, prüft beide erwarteten Zuständigkeiten und erlaubt gezieltes Leeren", async () => {
    const neu = await legeDealAn();
    const pfad = `/deals/${neu.id}/zuordnung`;
    // Sitzungen vor dem Rennen aufbauen, damit beide Anfragen dieselbe Ausgangslage lesen.
    await Promise.all([bearbeiter, projektleitung].map((p) => anfrage("GET", "/dealflow/arbeitsliste", p)));
    const antworten = await Promise.all([
      anfrage("PATCH", pfad, bearbeiter, { ...leer, investmentmanagerId: ids.bearbeiten }),
      anfrage("PATCH", pfad, projektleitung, { ...leer, investmentmanagerId: ids.projektleitung }),
    ]);
    expect(antworten.map((a) => a.status).sort()).toEqual([200, 409]);
    const gewonnen = await json(antworten.find((a) => a.status === 200)!);
    const verloren = await json(antworten.find((a) => a.status === 409)!);
    expect(verloren.error).toMatchObject({ code: "deal_assignment_conflict", investmentmanagerId: gewonnen.investmentmanagerId });
    expect((await protokollZeilen(db, "deal")).filter((zeile) => zeile.datensatz_id === neu.id)).toHaveLength(2);
    expect((await anfrage("PATCH", pfad, bearbeiter, { ...leer, projektleiterId: ids.projektleitung })).status).toBe(409);
    const gesetzt = await anfrage("PATCH", pfad, bearbeiter, {
      erwartetInvestmentmanagerId: gewonnen.investmentmanagerId, erwartetProjektleiterId: null, projektleiterId: ids.projektleitung,
    });
    expect(await json(gesetzt)).toMatchObject({ investmentmanagerId: gewonnen.investmentmanagerId, projektleiterId: ids.projektleitung });
    const geleert = await anfrage("PATCH", pfad, bearbeiter, {
      erwartetInvestmentmanagerId: gewonnen.investmentmanagerId, erwartetProjektleiterId: ids.projektleitung, investmentmanagerId: null,
    });
    expect(await json(geleert)).toMatchObject({ investmentmanagerId: null, projektleiterId: ids.projektleitung });
    expect((await anfrage("PATCH", `/deals/${neu.id}`, STANDARD, { fondsId: ID.anderer })).status).toBe(400);
  });

  it("speichert auch leere Kartenfelder je Benutzer und erhält andere Einstellungen", async () => {
    const pfad = "/dealflow/kartenfelder";
    const lesen = async (p: Testperson) => json(await anfrage("GET", pfad, p));
    expect(await lesen(betrachter)).toEqual({ felder: ["ticket", "investmentmanager"] });
    expect((await anfrage("PATCH", "/theme", betrachter, { theme: "dark" })).status).toBe(200);
    const felder = ["projektleiter", "eingangsdatum", "herkunft", "fonds"];
    expect(await json(await anfrage("PUT", pfad, betrachter, { felder }))).toEqual({ felder });
    expect(await lesen(betrachter)).toEqual({ felder });
    expect(await lesen(bearbeiter)).toEqual({ felder: ["ticket", "investmentmanager"] });
    expect(await json(await anfrage("GET", "/theme", betrachter))).toEqual({ theme: "dark" });
    expect((await anfrage("PUT", pfad, betrachter, { felder: ["unbekannt"] })).status).toBe(400);
    expect((await anfrage("PUT", pfad, betrachter, { felder: [] })).status).toBe(200);
    expect(await lesen(betrachter)).toEqual({ felder: [] });
  });
});
