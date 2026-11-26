import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, legePersonAn, person, STANDARD } from "./hilfen-auth";
import { json, oeffneTestdb, vehikelVon } from "./hilfen";
import { anzahl, aufrufe, auftraege, grundbestand, ID, leereAuftraege, protokollZeilen } from "./hilfen-instrumente";

/** Etappe 7: Rollen und Beziehungen, Dubletten bei Personen, Zusammenführen. Alle Daten sind erfunden. */

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const { get, post } = aufrufe(t);
const senden = (methode: string, pfad: string, koerper?: unknown, als?: ReturnType<typeof person>) =>
  t.request(pfad, { method: methode, headers: { "content-type": "application/json" }, ...(koerper === undefined ? {} : { body: JSON.stringify(koerper) }), ...(als ? { als } : {}) });
const patch = (pfad: string, koerper: unknown) => senden("PATCH", pfad, koerper);
const loesche = (pfad: string) => senden("DELETE", pfad);

const F1 = ID.fonds;
const F2 = ID.anderer;

const bearbeiter = person("bearbeiter-e7", { rollen: { [F1]: "bearbeiter" } });
const freigeber = person("freigeber-e7", { rollen: { [F1]: "freigeber" } });
const nurF2 = person("betrachter-f2-e7", { rollen: { [F2]: "betrachter" } });

const neueOrg = async (name: string, extra: Partial<typeof s.organisation.$inferInsert> = {}) => {
  const [o] = await db.insert(s.organisation).values({ name, art: "unternehmen", ...extra }).returning();
  return o!.id;
};
const neuePerson = async (vorname: string, nachname: string, extra: Partial<typeof s.person.$inferInsert> = {}) => {
  const [p] = await db.insert(s.person).values({ vorname, nachname, ...extra }).returning();
  return p!.id;
};

const betrachter = person("betrachter-e7", { rollen: { [F1]: "betrachter" } });
const bearbeiterF2 = person("bearbeiter-f2-e7", { rollen: { [F2]: "bearbeiter" } });
const beideFonds = person("freigeber-beide-e7", { rollen: { [F1]: "freigeber", [F2]: "freigeber" } });

beforeEach(async () => {
  await grundbestand(db);
  // `leeren` entfernt auch die Rollen: die Personen mit Rollen je Test neu anlegen.
  for (const p of [bearbeiter, freigeber, nurF2, betrachter, bearbeiterF2, beideFonds]) await legePersonAn(db, p);
});
afterAll(async () => {
  await pool.end();
});

describe("Rollen", () => {
  it("legt Rollen an, listet, ändert und löscht sie mit Protokoll; doppelt und falscher Zeitraum werden abgewiesen", async () => {
    const pid = await neuePerson("Erika", "Beispiel");
    const antwort = await post("/kontaktrollen", { personId: pid, organisationId: ID.orgA, rolle: "gruender", von: "2020-01-01" });
    expect(antwort.status).toBe(201);
    const rolle = await json(antwort);
    // Dieselbe Person kann bei derselben Organisation mehrere Rollen haben, auch zeitlich begrenzt.
    expect((await post("/kontaktrollen", { personId: pid, organisationId: ID.orgA, rolle: "geschaeftsfuehrung", von: "2021-01-01", bis: "2023-12-31" })).status).toBe(201);
    expect((await post("/kontaktrollen", { personId: pid, organisationId: ID.orgB, rolle: "berater" })).status).toBe(201);

    const doppelt = await post("/kontaktrollen", { personId: pid, organisationId: ID.orgA, rolle: "gruender", von: "2020-01-01" });
    expect(doppelt.status).toBe(409);
    expect((await json(doppelt)).fehler.code).toBe("ROLLE_VORHANDEN");
    const falsch = await post("/kontaktrollen", { personId: pid, organisationId: ID.orgA, rolle: "sonstige", von: "2024-05-01", bis: "2024-01-01" });
    expect(falsch.status).toBe(400);
    expect((await post("/kontaktrollen", { personId: pid, organisationId: ID.orgA, rolle: "unbekannt" })).status).toBe(400);

    const liste = await json(await get(`/kontaktrollen?personId=${pid}`));
    expect(liste.daten.map((r: { rolle: string }) => r.rolle).sort()).toEqual(["berater", "geschaeftsfuehrung", "gruender"]);
    expect(((await json(await get(`/kontaktrollen?organisationId=${ID.orgB}`))).daten as unknown[]).length).toBe(1);

    expect((await patch(`/kontaktrollen/${rolle.id}`, { bis: "2019-01-01" })).status).toBe(400);
    const geaendert = await patch(`/kontaktrollen/${rolle.id}`, { bis: "2022-06-30" });
    expect(geaendert.status).toBe(200);
    expect((await json(geaendert)).bis).toBe("2022-06-30");
    expect((await patch(`/kontaktrollen/${randomUUID()}`, { rolle: "sonstige" })).status).toBe(404);

    expect((await loesche(`/kontaktrollen/${rolle.id}`)).status).toBe(204);
    expect((await loesche(`/kontaktrollen/${rolle.id}`)).status).toBe(404);
    expect((await protokollZeilen(db, "kontaktrolle")).map((z) => z.aktion)).toEqual(expect.arrayContaining(["anlegen", "aendern", "loeschen"]));
  });

  it("Rollen stehen auf Organisation und Person, zusammengeführte Personen nicht", async () => {
    const p1 = await neuePerson("Erika", "Beispiel", { organisationId: ID.orgA });
    await post("/kontaktrollen", { personId: p1, organisationId: ID.orgA, rolle: "co_investor" });
    const org = await json(await get(`/organisationen/${ID.orgA}`));
    expect(org.rollen).toHaveLength(1);
    expect(org.rollen[0]).toMatchObject({ rolle: "co_investor", person: { id: p1, vorname: "Erika" } });
    const detail = await json(await get(`/personen/${p1}`));
    expect(detail.rollen[0]).toMatchObject({ rolle: "co_investor", organisation: { id: ID.orgA } });
    expect(detail.organisation).toEqual({ id: ID.orgA, name: "Alpha Beispiel" });
    expect((await get(`/personen/${randomUUID()}`)).status).toBe(404);
  });
});

describe("Beziehungen", () => {
  it("verknüpft Organisationen untereinander und mit Fonds, in beide Richtungen sichtbar", async () => {
    const a = await post("/organisationsbeziehungen", { vonOrganisationId: ID.orgA, zuOrganisationId: ID.orgB, art: "co_investor" });
    expect(a.status).toBe(201);
    const aId = (await json(a)).id;
    expect((await post("/organisationsbeziehungen", { vonOrganisationId: ID.orgA, fondsId: F1, art: "investor", bemerkung: "Anteilseigner" })).status).toBe(201);

    const aus = await json(await get(`/organisationen/${ID.orgA}`));
    expect(aus.beziehungen).toHaveLength(2);
    expect(aus.beziehungen.find((b: { organisation: unknown }) => b.organisation)).toMatchObject({ richtung: "aus", art: "co_investor", organisation: { id: ID.orgB } });
    expect(aus.beziehungen.find((b: { fonds: unknown }) => b.fonds)).toMatchObject({ art: "investor", fonds: { id: F1 }, bemerkung: "Anteilseigner" });
    const ein = await json(await get(`/organisationen/${ID.orgB}`));
    expect(ein.beziehungen).toEqual([expect.objectContaining({ richtung: "ein", art: "co_investor", organisation: expect.objectContaining({ id: ID.orgA }) })]);

    const doppelt = await post("/organisationsbeziehungen", { vonOrganisationId: ID.orgA, zuOrganisationId: ID.orgB, art: "co_investor" });
    expect(doppelt.status).toBe(409);
    expect((await json(doppelt)).fehler.code).toBe("BEZIEHUNG_VORHANDEN");
    expect((await post("/organisationsbeziehungen", { vonOrganisationId: ID.orgA, zuOrganisationId: ID.orgA, art: "berater" })).status).toBe(400);
    expect((await post("/organisationsbeziehungen", { vonOrganisationId: ID.orgA, art: "berater" })).status).toBe(400);
    expect((await post("/organisationsbeziehungen", { vonOrganisationId: ID.orgA, zuOrganisationId: ID.orgB, fondsId: F1, art: "berater" })).status).toBe(400);

    expect((await loesche(`/organisationsbeziehungen/${aId}`)).status).toBe(204);
    expect((await loesche(`/organisationsbeziehungen/${aId}`)).status).toBe(404);
  });

  it("Beziehungen zu einem Fonds sieht nur, wer dort eine Rolle hat; Anlegen und Löschen braucht Bearbeiter an diesem Fonds", async () => {
    await post("/organisationsbeziehungen", { vonOrganisationId: ID.orgA, fondsId: F1, art: "investor" });
    const sichtbar = await json(await senden("GET", `/organisationen/${ID.orgA}`, undefined, bearbeiter));
    expect(sichtbar.beziehungen).toHaveLength(1);
    const verborgen = await json(await senden("GET", `/organisationen/${ID.orgA}`, undefined, nurF2));
    expect(verborgen.beziehungen).toHaveLength(0);
    // Mit Rolle nur an Fonds 2 darf niemand Beziehungen zu Fonds 1 anlegen oder löschen.
    expect((await senden("POST", "/organisationsbeziehungen", { vonOrganisationId: ID.orgB, fondsId: F1, art: "investor" }, bearbeiterF2)).status).toBe(403);
    const [b] = await db.select().from(s.organisationsbeziehung);
    expect((await senden("DELETE", `/organisationsbeziehungen/${b!.id}`, undefined, bearbeiterF2)).status).toBe(403);
  });
});

describe("Dubletten bei Personen", () => {
  it("findet gleiche E-Mail-Adresse (ohne Groß- und Kleinschreibung) und ähnliche Namen, nicht zusammengeführte", async () => {
    const eva = await neuePerson("Eva", "Musterfrau", { email: "Eva.Muster@Beispiel.example" });
    await neuePerson("Max", "Beispiel");
    const weg = await neuePerson("Eva", "Musterfrau", { zusammengefuehrtIn: eva });

    const mail = await json(await get("/personen/dubletten?vorname=E.&nachname=Muster&email=eva.muster@beispiel.example"));
    expect(mail.daten).toEqual([expect.objectContaining({ id: eva, grund: "email", score: 1 })]);

    const name = await json(await get("/personen/dubletten?vorname=Eva&nachname=Musterfrau"));
    expect(name.daten.map((d: { id: string }) => d.id)).toEqual([eva]);
    expect(name.daten[0]).toMatchObject({ grund: "name" });
    expect(name.daten.some((d: { id: string }) => d.id === weg)).toBe(false);
    expect((await json(await get("/personen/dubletten?vorname=Eva&nachname=Musterfrau&ausser=" + eva))).daten).toEqual([]);
    expect((await json(await get("/personen/dubletten?vorname=Zacharias&nachname=Unbekannt"))).daten).toEqual([]);
  });

  it("Anlegen einer ähnlichen Person verlangt Bestätigung (409 DUBLETTE_MOEGLICH mit Kandidaten)", async () => {
    await neuePerson("Eva", "Musterfrau", { email: "eva@beispiel.example" });
    const erst = await post("/personen", { vorname: "Eva", nachname: "Musterfrau" });
    expect(erst.status).toBe(409);
    const fehler = (await json(erst)).fehler;
    expect(fehler.code).toBe("DUBLETTE_MOEGLICH");
    expect(fehler.kandidaten).toHaveLength(1);
    expect(await anzahl(db, "person")).toBe(1);
    const gleicheMail = await post("/personen", { vorname: "Anders", nachname: "Heissend", email: "EVA@beispiel.example" });
    expect(gleicheMail.status).toBe(409);
    expect((await post("/personen", { vorname: "Eva", nachname: "Musterfrau", dubletteBestaetigt: true })).status).toBe(201);
    expect(await anzahl(db, "person")).toBe(2);
  });
});

/** Alle Fremdschlüsselspalten, die auf `tabelle`.id zeigen (ohne die Verweise `zusammengefuehrt_in` auf sich selbst). */
async function verweise(tabelle: string) {
  const { rows } = await db.execute<{ tabelle: string; spalte: string }>(sql`
    SELECT c.conrelid::regclass::text AS tabelle, a.attname AS spalte
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f' AND c.confrelid = ${tabelle}::regclass AND a.attname <> 'zusammengefuehrt_in'`);
  return rows;
}

async function zaehleVerweise(tabelle: string, id: string) {
  const treffer: Record<string, number> = {};
  for (const v of await verweise(tabelle)) {
    const n = Number((await db.execute(sql.raw(`SELECT count(*)::int AS n FROM "${v.tabelle.replaceAll('"', "")}" WHERE "${v.spalte}" = '${id}'`))).rows[0]?.n);
    if (n > 0) treffer[`${v.tabelle}.${v.spalte}`] = n;
  }
  return treffer;
}

/** Organisation mit allem, was an ihr hängen kann. */
async function bestuecke(orgId: string, kuerzel: string) {
  const pid = await neuePerson(`Person ${kuerzel}`, "Bestand", { organisationId: orgId, email: `${kuerzel.toLowerCase()}@beispiel.example` });
  const [d] = await db.insert(s.deal).values({ organisationId: orgId, titel: `Deal ${kuerzel}`, fondsId: F1 }).returning();
  await db.insert(s.aktivitaet).values({ art: "notiz", datum: "2026-01-02", titel: `Notiz ${kuerzel}`, organisationId: orgId });
  const [r] = await db
    .insert(s.finanzierungsrunde)
    .values({ organisationId: orgId, bezeichnung: `Runde ${kuerzel}`, datum: "2025-01-01", preMoney: "1000000.00", postMoney: "1500000.00", preisJeAnteil: "10.0000", anteileGesamtNach: "150000" })
    .returning();
  await db.insert(s.rundenposition).values({ rundeId: r!.id, vehikelId: await vehikelVon(db, orgId), betrag: "250000.00", anteile: "25000", rolle: "co" });
  await db.insert(s.kontaktrolle).values({ personId: pid, organisationId: orgId, rolle: "gruender", von: "2020-01-01" });
  return { personId: pid, dealId: d!.id };
}

describe("Organisationen zusammenführen", () => {
  it("zeigt in der Vorschau, was umzieht, und führt in einer Transaktion zusammen: alle Verweise ziehen um, die Quelle bleibt weich erhalten", async () => {
    const ziel = await neueOrg("Ziel Energie GmbH", { sektor: "Energie" });
    const quelle = await neueOrg("Ziel Energie", { sektor: null, ort: "Hamburg", website: "https://ziel.example" });
    const dritte = await neueOrg("Dritte Beispiel");
    const bz = await bestuecke(ziel, "Z");
    await bestuecke(quelle, "Q");
    // Rolle der Quelle, die das Ziel schon hat (gleiche Person), und Beziehungen: eine doppelte, eine zwischen den beiden, eine eigene
    await db.insert(s.kontaktrolle).values([
      { personId: bz.personId, organisationId: ziel, rolle: "berater", von: "2022-01-01" },
      { personId: bz.personId, organisationId: quelle, rolle: "berater", von: "2022-01-01" },
    ]);
    await db.insert(s.organisationsbeziehung).values([
      { vonOrganisationId: ziel, zuOrganisationId: dritte, art: "co_investor" },
      { vonOrganisationId: quelle, zuOrganisationId: dritte, art: "co_investor" },
      { vonOrganisationId: quelle, zuOrganisationId: ziel, art: "berater" },
      { vonOrganisationId: dritte, zuOrganisationId: quelle, art: "berater" },
      { vonOrganisationId: quelle, fondsId: F1, art: "investor" },
    ]);
    await db.insert(s.beteiligung).values({ fondsId: F1, organisationId: quelle, instrument: "darlehen", erstinvestment: "2025-02-01" });
    await leereAuftraege(db);

    const vorschau = await json(await post(`/organisationen/${ziel}/zusammenfuehren/vorschau`, { quelleId: quelle }));
    expect(vorschau.verschiebt).toEqual({ personen: 1, deals: 1, aktivitaeten: 1, beteiligungen: 1, rollen: 2, beziehungen: 4, runden: 1, rundenpositionen: 1 });
    expect(vorschau.freigabeNoetig).toBe(true);
    expect(vorschau.darfAusfuehren).toBe(true);
    expect(vorschau.ueberschneidungen).toEqual([]);
    const felder = Object.fromEntries(vorschau.felder.map((f: { feld: string }) => [f.feld, f]));
    expect(felder.sektor).toMatchObject({ ziel: "Energie", quelle: null, abweichend: true, vorschlag: "ziel" });
    expect(felder.ort).toMatchObject({ ziel: null, quelle: "Hamburg", vorschlag: "quelle" });
    // Die Vorschau schreibt nichts
    expect(await anzahl(db, "organisation", "zusammengefuehrt_in IS NOT NULL")).toBe(0);

    const antwort = await post(`/organisationen/${ziel}/zusammenfuehren`, { quelleId: quelle, felder: { name: "quelle", website: "ziel" } });
    expect(antwort.status).toBe(200);
    const ergebnis = await json(antwort);
    expect(ergebnis.organisation).toMatchObject({ id: ziel, name: "Ziel Energie", ort: "Hamburg", sektor: "Energie", website: null });
    expect(ergebnis.verschoben).toMatchObject({ personen: 1, deals: 1, aktivitaeten: 1, beteiligungen: 1, runden: 1, rundenpositionen: 1 });

    // Nichts zeigt mehr auf die Quelle (alle Fremdschlüssel aus pg_constraint), alles hängt am Ziel
    expect(await zaehleVerweise("organisation", quelle)).toEqual({});
    expect((await verweise("organisation")).map((v) => `${v.tabelle}.${v.spalte}`)).toEqual(
      expect.arrayContaining(["person.organisation_id", "deal.organisation_id", "aktivitaet.organisation_id", "beteiligung.organisation_id", "finanzierungsrunde.organisation_id", "vehikel.investor_id", "kontaktrolle.organisation_id", "organisationsbeziehung.von_organisation_id", "organisationsbeziehung.zu_organisation_id"]),
    );
    const amZiel = await zaehleVerweise("organisation", ziel);
    expect(amZiel).toMatchObject({ "person.organisation_id": 2, "deal.organisation_id": 2, "aktivitaet.organisation_id": 2, "beteiligung.organisation_id": 1, "finanzierungsrunde.organisation_id": 2, "vehikel.investor_id": 2 });
    // Die Vehikel der Quelle ziehen um; das Ziel behält sein Standard-Vehikel, das der Quelle verliert das Kennzeichen.
    expect((await db.select().from(s.vehikel).where(sql`${s.vehikel.investorId} = ${ziel}`)).map((v) => [v.name, v.standard]).sort()).toEqual([["Ziel Energie GmbH", true], ["Ziel Energie", false]]);
    // Rollen: die doppelte entfällt, die übrigen ziehen um; Beziehungen: doppelte und die zwischen beiden entfallen
    expect(await anzahl(db, "kontaktrolle", `organisation_id = '${ziel}'`)).toBe(3);
    const beziehungen = await db.select().from(s.organisationsbeziehung);
    expect(beziehungen.map((b) => `${b.vonOrganisationId === ziel ? "Z" : b.vonOrganisationId === dritte ? "D" : "?"}>${b.zuOrganisationId === ziel ? "Z" : b.zuOrganisationId === dritte ? "D" : b.zuOrganisationId === null ? "-" : "?"}:${b.art}`).sort()).toEqual(["D>Z:berater", "Z>-:investor", "Z>D:co_investor"]);

    // Die Quelle bleibt als Datensatz, verweist auf das Ziel und taucht nicht mehr auf
    const [rest] = await db.select().from(s.organisation).where(sql`${s.organisation.id} = ${quelle}`);
    expect(rest).toMatchObject({ name: "Ziel Energie", zusammengefuehrtIn: ziel });
    expect(rest!.zusammengefuehrtAm).toBeInstanceOf(Date);
    expect((await json(await get(`/organisationen/${quelle}`))).zusammengefuehrtIn).toBe(ziel);
    const liste = (await json(await get("/organisationen?limit=200"))).daten.map((o: { id: string }) => o.id);
    expect(liste).toContain(ziel);
    expect(liste).not.toContain(quelle);
    expect((await json(await get("/organisationen/dubletten?name=Ziel%20Energie"))).daten.map((d: { id: string }) => d.id)).not.toContain(quelle);
    expect((await json(await get(`/organisationen/${ziel}`))).personen).toHaveLength(2);

    // Eine zusammengeführte Organisation nimmt nichts mehr auf und lässt sich nicht noch einmal zusammenführen
    for (const antw of [
      await patch(`/organisationen/${quelle}`, { ort: "Berlin" }),
      await post("/deals", { titel: "Neu", organisationId: quelle }),
      await post(`/organisationen/${dritte}/zusammenfuehren`, { quelleId: quelle }),
      await post(`/organisationen/${quelle}/zusammenfuehren`, { quelleId: dritte }),
    ]) {
      expect(antw.status).toBe(409);
      expect((await json(antw)).fehler.code).toBe("BEREITS_ZUSAMMENGEFUEHRT");
    }

    // Protokoll: Zusammenführung an beiden Datensätzen, jede verschobene Zeile einzeln, entfallene mit altem Stand
    const org = await protokollZeilen(db, "organisation");
    expect(org.map((z) => z.aktion)).toEqual(expect.arrayContaining(["zusammenfuehren", "zusammengefuehrt"]));
    expect(org.find((z) => z.aktion === "zusammenfuehren")!.datensatz_id).toBe(ziel);
    expect(await protokollZeilen(db, "person", "zusammenfuehren_verschieben")).toHaveLength(1);
    expect(await protokollZeilen(db, "deal", "zusammenfuehren_verschieben")).toHaveLength(1);
    expect(await protokollZeilen(db, "beteiligung", "zusammenfuehren_verschieben")).toHaveLength(1);
    expect(await protokollZeilen(db, "kontaktrolle", "zusammenfuehren_entfallen")).toHaveLength(1);
    expect(await protokollZeilen(db, "organisationsbeziehung", "zusammenfuehren_entfallen")).toHaveLength(2);
    // Die Fondsübersicht trägt Organisation und Name: der betroffene Fonds wird neu gerechnet
    expect(await auftraege(db)).toBe(1);
  });

  it("Bearbeiter dürfen Organisationen ohne Beteiligungen zusammenführen, mit Beteiligungen nur Freigeber aller betroffenen Fonds", async () => {
    const a = await neueOrg("Frei A");
    const b = await neueOrg("Frei B");
    const ohne = await senden("POST", `/organisationen/${a}/zusammenfuehren`, { quelleId: b }, bearbeiter);
    expect(ohne.status).toBe(200);

    const mitA = await neueOrg("Halten A");
    const mitB = await neueOrg("Halten B");
    await db.insert(s.beteiligung).values({ fondsId: F1, organisationId: mitB, instrument: "darlehen", erstinvestment: "2025-02-01" });
    const abgelehnt = await senden("POST", `/organisationen/${mitA}/zusammenfuehren`, { quelleId: mitB }, bearbeiter);
    expect(abgelehnt.status).toBe(403);
    expect((await json(abgelehnt)).fehler.code).toBe("KEINE_BERECHTIGUNG");
    expect(await anzahl(db, "beteiligung", `organisation_id = '${mitB}'`)).toBe(1);
    const vorschau = await json(await senden("POST", `/organisationen/${mitA}/zusammenfuehren/vorschau`, { quelleId: mitB }, bearbeiter));
    expect(vorschau).toMatchObject({ freigabeNoetig: true, darfAusfuehren: false });
    // Freigeber an Fonds 1, aber die Beteiligung der Quelle liegt auch an Fonds 2: dann fehlt die Rolle dort
    await db.insert(s.beteiligung).values({ fondsId: F2, organisationId: mitA, instrument: "darlehen", erstinvestment: "2025-02-01" });
    expect((await senden("POST", `/organisationen/${mitA}/zusammenfuehren`, { quelleId: mitB }, freigeber)).status).toBe(403);
    expect((await senden("POST", `/organisationen/${mitA}/zusammenfuehren`, { quelleId: mitB }, beideFonds)).status).toBe(200);
    expect(await anzahl(db, "beteiligung", `organisation_id = '${mitA}'`)).toBe(2);
  });

  it("ein API-Schlüssel mit Schreibrecht darf Organisationen mit Beteiligungen nicht zusammenführen", async () => {
    const mitA = await neueOrg("Schluessel A");
    const mitB = await neueOrg("Schluessel B");
    await db.insert(s.beteiligung).values({ fondsId: F1, organisationId: mitB, instrument: "darlehen", erstinvestment: "2025-02-01" });
    const schluessel = await json(await post("/api-schluessel", { name: "Importjob", scopes: [{ fondsId: F1, recht: "schreiben" }] }, STANDARD));
    const antwort = await t.app.request(`/api/v1/organisationen/${mitA}/zusammenfuehren`, {
      method: "POST",
      headers: { authorization: `Bearer ${schluessel.schluessel}`, "content-type": "application/json" },
      body: JSON.stringify({ quelleId: mitB }),
    });
    expect(antwort.status).toBe(403);
    expect(await anzahl(db, "organisation", "zusammengefuehrt_in IS NOT NULL")).toBe(0);
  });

  it("führt nie zwei Organisationen zusammen, die derselbe Fonds hält (409), und ändert dann nichts", async () => {
    const a = await neueOrg("Doppelt A");
    const b = await neueOrg("Doppelt B");
    // Je Fonds und Unternehmen gibt es eine Beteiligung; hält ein Fonds beide Organisationen, ließen sich die Beteiligungen nicht vereinen.
    await db.insert(s.beteiligung).values([
      { fondsId: F1, organisationId: a, instrument: "darlehen", erstinvestment: "2025-02-01" },
      { fondsId: F1, organisationId: b, instrument: "darlehen", erstinvestment: "2025-03-01" },
    ]);
    const vorschau = await json(await post(`/organisationen/${a}/zusammenfuehren/vorschau`, { quelleId: b }));
    expect(vorschau.ueberschneidungen).toEqual([{ fondsId: F1, instrument: "darlehen" }]);
    await bestuecke(b, "B");
    const antwort = await post(`/organisationen/${a}/zusammenfuehren`, { quelleId: b });
    expect(antwort.status).toBe(409);
    const fehler = (await json(antwort)).fehler;
    expect(fehler.code).toBe("BETEILIGUNGEN_UEBERSCHNEIDEN");
    expect(fehler.ueberschneidungen).toEqual([{ fondsId: F1, instrument: "darlehen" }]);
    expect(await anzahl(db, "beteiligung", `organisation_id = '${b}'`)).toBe(1);
    expect(await anzahl(db, "organisation", "zusammengefuehrt_in IS NOT NULL")).toBe(0);
    expect(await anzahl(db, "aenderung", "aktion LIKE 'zusammenfuehren%'")).toBe(0);
    // Dasselbe Unternehmen an einem anderen Fonds ist keine Überschneidung
    const c = await neueOrg("Anders C");
    await db.insert(s.beteiligung).values({ fondsId: F2, organisationId: c, instrument: "darlehen", erstinvestment: "2025-02-01" });
    expect((await json(await post(`/organisationen/${a}/zusammenfuehren/vorschau`, { quelleId: c }))).ueberschneidungen).toEqual([]);
  });

  it("verbirgt in der Vorschau und im 409 Fonds, die die Person nicht sehen darf: nur Wahrheitswerte statt IDs und Zahlen", async () => {
    const a = await neueOrg("Verdeckt A");
    const b = await neueOrg("Verdeckt B");
    // Nur `b` hält etwas (an beiden Fonds): Je Fonds und Unternehmen gibt es eine Beteiligung, `a` hält zunächst nichts, damit es keine Überschneidung gibt.
    await db.insert(s.beteiligung).values([
      { fondsId: F2, organisationId: b, instrument: "darlehen", erstinvestment: "2025-02-01" },
      { fondsId: F1, organisationId: b, instrument: "stille_beteiligung", erstinvestment: "2025-02-01" },
    ]);
    await db.insert(s.deal).values([{ organisationId: b, titel: "Deal Fonds Zwei", fondsId: F2 }, { organisationId: b, titel: "Deal Fonds Eins", fondsId: F1 }]);
    // Freigeber nur an Fonds 1 sieht Fonds 2 nicht
    const v = await json(await senden("POST", `/organisationen/${a}/zusammenfuehren/vorschau`, { quelleId: b }, freigeber));
    expect(JSON.stringify(v)).not.toContain(F2);
    expect(v.fondsIds).toEqual([F1]);
    expect(v).toMatchObject({ verdeckteFonds: true, freigabeNoetig: true, darfAusfuehren: false, ueberschneidungen: [], ueberschneidungVerdeckt: false });
    expect(v.verschiebt).toMatchObject({ beteiligungen: 1, deals: 1 });
    // Überschneidung nur an Fonds 2: verborgen, aber nur als Wahrheitswert, und die Ausführung scheitert trotzdem
    await db.insert(s.beteiligung).values({ fondsId: F2, organisationId: a, instrument: "darlehen", erstinvestment: "2025-03-01" });
    const v2 = await json(await senden("POST", `/organisationen/${a}/zusammenfuehren/vorschau`, { quelleId: b }, freigeber));
    expect(v2).toMatchObject({ ueberschneidungen: [], ueberschneidungVerdeckt: true });
    expect(JSON.stringify(v2)).not.toContain(F2);
    const vollsicht = await json(await post(`/organisationen/${a}/zusammenfuehren/vorschau`, { quelleId: b }));
    expect(vollsicht.ueberschneidungen).toEqual([{ fondsId: F2, instrument: "darlehen" }]);
    const beide = person("freigeber-f1-f2-e7", { rollen: { [F1]: "freigeber" } });
    await legePersonAn(db, beide);
    // Mit Freigabe an Fonds 1 und 2 sähe die Person Fonds 2; mit nur Fonds 1 fehlt das Recht (403) und nichts verrät Fonds 2
    const abgelehnt = await senden("POST", `/organisationen/${a}/zusammenfuehren`, { quelleId: b }, beide);
    expect(abgelehnt.status).toBe(403);
    expect(JSON.stringify(await json(abgelehnt))).not.toContain(F2);
    // Betrachter an Fonds 2 mit Freigeber an beiden Fonds, die Überschneidung ist sichtbar: 409 mit Angabe
    const sicht = await json(await senden("POST", `/organisationen/${a}/zusammenfuehren`, { quelleId: b }, beideFonds));
    expect(sicht.fehler).toMatchObject({ code: "BETEILIGUNGEN_UEBERSCHNEIDEN", ueberschneidungen: [{ fondsId: F2, instrument: "darlehen" }], ueberschneidungVerdeckt: false });
  });

  it("verlangt Bearbeiter an den Fonds aller betroffenen Deals und Aktivitäten, auch ohne Beteiligungen; 403 ohne Sicht, nichts ändert sich", async () => {
    const a = await neueOrg("Quer A");
    const b = await neueOrg("Quer B");
    const fremd = await neueOrg("Quer Fremd");
    const [dealB] = await db.insert(s.deal).values({ organisationId: b, titel: "Deal in Fonds Zwei", fondsId: F2 }).returning();
    const [dealFremd] = await db.insert(s.deal).values({ organisationId: fremd, titel: "Fremder Deal in Fonds Zwei", fondsId: F2 }).returning();
    await db.insert(s.aktivitaet).values({ art: "notiz", datum: "2026-01-02", titel: "Notiz an fremdem Deal", organisationId: b, dealId: dealFremd!.id });
    // Bearbeiter nur an Fonds 1: Deals von Fonds 2 gehören nicht zu seinem Bereich
    const vorschau = await json(await senden("POST", `/organisationen/${a}/zusammenfuehren/vorschau`, { quelleId: b }, bearbeiter));
    expect(vorschau.darfAusfuehren).toBe(false);
    expect(JSON.stringify(vorschau)).not.toContain(F2);
    expect(vorschau.verschiebt.deals).toBe(0); // der Deal an Fonds 2 bleibt unsichtbar
    const abgelehnt = await senden("POST", `/organisationen/${a}/zusammenfuehren`, { quelleId: b }, bearbeiter);
    expect(abgelehnt.status).toBe(403);
    expect(JSON.stringify(await json(abgelehnt))).not.toContain(F2);
    expect(await anzahl(db, "deal", `organisation_id = '${b}'`)).toBe(1);
    expect(await anzahl(db, "organisation", "zusammengefuehrt_in IS NOT NULL")).toBe(0);
    // Nur die Aktivität an einem Deal einer dritten Organisation genügt ebenfalls
    await db.delete(s.deal).where(sql`${s.deal.id} = ${dealB!.id}`);
    expect((await senden("POST", `/organisationen/${a}/zusammenfuehren`, { quelleId: b }, bearbeiter)).status).toBe(403);
    // Mit Bearbeiter an beiden Fonds geht es; die Zahlen der Antwort sind die sichtbaren
    const beideBearbeiter = person("bearbeiter-beide-e7", { rollen: { [F1]: "bearbeiter", [F2]: "bearbeiter" } });
    await legePersonAn(db, beideBearbeiter);
    const ok = await senden("POST", `/organisationen/${a}/zusammenfuehren`, { quelleId: b }, beideBearbeiter);
    expect(ok.status).toBe(200);
    expect((await json(ok)).verschoben).toMatchObject({ aktivitaeten: 1, deals: 0 });
  });

  it("Personen: Aktivitäten an Deals fremder Fonds verbieten das Zusammenführen ohne Bearbeiter dort", async () => {
    const ziel = await neuePerson("Pia", "Quer");
    const quelle = await neuePerson("Pia", "Quere");
    const [d2] = await db.insert(s.deal).values({ organisationId: ID.orgB, titel: "Deal in Fonds Zwei", fondsId: F2 }).returning();
    await db.insert(s.aktivitaet).values({ art: "notiz", datum: "2026-01-02", titel: "Gespräch", personId: quelle, dealId: d2!.id });
    const vorschau = await json(await senden("POST", `/personen/${ziel}/zusammenfuehren/vorschau`, { quelleId: quelle }, bearbeiter));
    expect(vorschau.darfAusfuehren).toBe(false);
    expect(JSON.stringify(vorschau)).not.toContain(F2);
    const abgelehnt = await senden("POST", `/personen/${ziel}/zusammenfuehren`, { quelleId: quelle }, bearbeiter);
    expect(abgelehnt.status).toBe(403);
    expect(await anzahl(db, "aktivitaet", `person_id = '${quelle}'`)).toBe(1);
    expect(await anzahl(db, "person", "zusammengefuehrt_in IS NOT NULL")).toBe(0);
    expect((await senden("POST", `/personen/${ziel}/zusammenfuehren`, { quelleId: quelle }, bearbeiterF2)).status).toBe(200); // Bearbeiter am Fonds des Deals genügt
  });

  it("weist ungültige Eingaben ab: mit sich selbst, unbekannt, ohne Quelle", async () => {
    const a = await neueOrg("Nur A");
    expect((await post(`/organisationen/${a}/zusammenfuehren`, { quelleId: a })).status).toBe(400);
    expect((await json(await post(`/organisationen/${a}/zusammenfuehren`, { quelleId: a }))).fehler.code).toBe("ZUSAMMENFUEHREN_UNGUELTIG");
    expect((await post(`/organisationen/${a}/zusammenfuehren`, { quelleId: randomUUID() })).status).toBe(404);
    expect((await post(`/organisationen/${randomUUID()}/zusammenfuehren`, { quelleId: a })).status).toBe(404);
    expect((await post(`/organisationen/${a}/zusammenfuehren`, {})).status).toBe(400);
    expect((await post(`/organisationen/${a}/zusammenfuehren`, { quelleId: randomUUID(), felder: { name: "beide" } })).status).toBe(400);
  });
});

describe("Personen zusammenführen", () => {
  it("zieht Aktivitäten und Rollen um, lässt doppelte Rollen entfallen, wählt Felder und behält die Quelle weich", async () => {
    const ziel = await neuePerson("Eva", "Musterfrau", { email: null, funktion: "Leitung", organisationId: ID.orgA });
    const quelle = await neuePerson("Eva", "Muster-Frau", { email: "eva@beispiel.example", funktion: null, organisationId: ID.orgB });
    await db.insert(s.aktivitaet).values([
      { art: "gespraech", datum: "2026-01-02", titel: "Gespräch 1", personId: quelle },
      { art: "notiz", datum: "2026-01-03", titel: "Notiz 2", personId: quelle },
    ]);
    await db.insert(s.kontaktrolle).values([
      { personId: ziel, organisationId: ID.orgA, rolle: "berater", von: "2022-01-01" },
      { personId: quelle, organisationId: ID.orgA, rolle: "berater", von: "2022-01-01" },
      { personId: quelle, organisationId: ID.orgB, rolle: "co_investor" },
    ]);

    const vorschau = await json(await post(`/personen/${ziel}/zusammenfuehren/vorschau`, { quelleId: quelle }));
    expect(vorschau.verschiebt).toEqual({ aktivitaeten: 2, rollen: 2 });
    expect(Object.fromEntries(vorschau.felder.map((f: { feld: string; vorschlag: string }) => [f.feld, f.vorschlag]))).toMatchObject({ email: "quelle", funktion: "ziel", nachname: "ziel" });

    const antwort = await post(`/personen/${ziel}/zusammenfuehren`, { quelleId: quelle, felder: { nachname: "quelle", organisationId: "quelle" } });
    expect(antwort.status).toBe(200);
    const ergebnis = await json(antwort);
    expect(ergebnis.person).toMatchObject({ id: ziel, nachname: "Muster-Frau", email: "eva@beispiel.example", funktion: "Leitung", organisationId: ID.orgB });
    expect(await zaehleVerweise("person", quelle)).toEqual({});
    expect(await anzahl(db, "aktivitaet", `person_id = '${ziel}'`)).toBe(2);
    expect(await anzahl(db, "kontaktrolle", `person_id = '${ziel}'`)).toBe(2);
    const [rest] = await db.select().from(s.person).where(sql`${s.person.id} = ${quelle}`);
    expect(rest).toMatchObject({ zusammengefuehrtIn: ziel });
    expect((await json(await get("/personen"))).daten.map((p: { id: string }) => p.id)).toEqual([ziel]);
    expect((await json(await get(`/organisationen/${ID.orgB}`))).personen.map((p: { id: string }) => p.id)).toEqual([ziel]);
    expect((await json(await get("/personen/dubletten?vorname=Eva&nachname=Muster-Frau"))).daten.map((d: { id: string }) => d.id)).not.toContain(quelle);
    const zweiter = await post(`/personen/${ziel}/zusammenfuehren`, { quelleId: quelle });
    expect(zweiter.status).toBe(409);
    expect((await json(zweiter)).fehler.code).toBe("BEREITS_ZUSAMMENGEFUEHRT");
    expect((await protokollZeilen(db, "person")).map((z) => z.aktion)).toEqual(expect.arrayContaining(["zusammenfuehren", "zusammengefuehrt"]));
    expect(await protokollZeilen(db, "aktivitaet", "zusammenfuehren_verschieben")).toHaveLength(2);
    expect(await protokollZeilen(db, "kontaktrolle", "zusammenfuehren_entfallen")).toHaveLength(1);
  });

  it("Bearbeiter genügt, Betrachter nicht; mit sich selbst und unbekannt werden abgewiesen", async () => {
    const a = await neuePerson("Anna", "Eins");
    const b = await neuePerson("Anna", "Zwei");
    expect((await senden("POST", `/personen/${a}/zusammenfuehren`, { quelleId: b }, betrachter)).status).toBe(403);
    expect((await post(`/personen/${a}/zusammenfuehren`, { quelleId: a })).status).toBe(400);
    expect((await post(`/personen/${a}/zusammenfuehren`, { quelleId: randomUUID() })).status).toBe(404);
    expect((await senden("POST", `/personen/${a}/zusammenfuehren`, { quelleId: b }, bearbeiter)).status).toBe(200);
  });
});

describe("Zusammenführen und Datenübernahme (Etappe 6)", () => {
  it("Zuordnungen des Imports ziehen auf das Ziel um, damit ein erneuter Import die zusammengeführte Quelle nicht trifft", async () => {
    const [orgZiel, orgQuelle] = [await neueOrg("Import Ziel GmbH"), await neueOrg("Import Quelle GmbH")];
    const [perZiel, perQuelle] = [await neuePerson("Imke", "Ziel"), await neuePerson("Imre", "Quelle")];
    await db.insert(s.importZuordnung).values([
      { objekt: "organisation", schluessel: "ORG-Q", datensatzId: orgQuelle },
      { objekt: "person", schluessel: "PER-Q", datensatzId: perQuelle },
    ]);
    expect((await post(`/organisationen/${orgZiel}/zusammenfuehren`, { quelleId: orgQuelle })).status).toBe(200);
    expect((await post(`/personen/${perZiel}/zusammenfuehren`, { quelleId: perQuelle })).status).toBe(200);
    const zeilen = await db.select().from(s.importZuordnung);
    expect(zeilen.find((z) => z.schluessel === "ORG-Q")?.datensatzId).toBe(orgZiel);
    expect(zeilen.find((z) => z.schluessel === "PER-Q")?.datensatzId).toBe(perZiel);
  });
});
