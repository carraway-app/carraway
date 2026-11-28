import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, idVon, legePersonAn, person } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { anzahl, aufrufe, auftraege, grundbestand, ID, json, leereAuftraege, protokollZeilen } from "./hilfen-instrumente";

const { db, pool } = oeffneTestdb();
const { get, post, put, patch, delete: loesche } = aufrufe(erstelleTestApp(db));

const F1 = ID.fonds;
const F2 = ID.anderer;
const ORG_NEU = "00000000-0000-4000-8000-0000000000d1";
const ORG_CO = "00000000-0000-4000-8000-0000000000d2";
const ORG_CO2 = "00000000-0000-4000-8000-0000000000d3";
const bearbeiterF1 = person("runde-bearbeiter-f1", { rollen: { [F1]: "bearbeiter" } });
const betrachterF1 = person("runde-betrachter-f1", { rollen: { [F1]: "betrachter" } });
const verwalterF1 = person("runde-verwalter-f1", { rollen: { [F1]: "verwalter" } });
const bearbeiterF2 = person("runde-bearbeiter-f2", { rollen: { [F2]: "bearbeiter" } });
const freigeberF1 = person("runde-freigeber-f1", { rollen: { [F1]: "freigeber" } });

/** Eine stimmige Runde: Pre 8 Mio., Volumen 2 Mio. (Fonds Eins 1,5 Mio. + Co-Investor 0,5 Mio.), Preis 10, 1 Mio. Anteile danach. */
const stimmig = (organisationId = ORG_NEU) => ({
  organisationId,
  koerper: {
    bezeichnung: "Serie A",
    datum: "2026-03-15",
    preMoney: "8000000.00",
    preisJeAnteil: "10.0000",
    positionen: [
      { fondsId: F1, betrag: "1500000.00", anteile: "150000", rolle: "lead" },
      { organisationId: ORG_CO, betrag: "500000.00", anteile: "50000", rolle: "co" },
    ],
  },
});

const anlegen = (koerper: unknown, organisationId = ORG_NEU, als?: Parameters<typeof post>[2]) => post(`/organisationen/${organisationId}/finanzierungsrunden`, koerper, als);
const abschliessen = (id: string, koerper: unknown = {}, als?: Parameters<typeof post>[2]) => post(`/finanzierungsrunden/${id}/abschliessen`, koerper, als);

beforeEach(async () => {
  await grundbestand(db);
  await db.insert(s.organisation).values([
    { id: ORG_NEU, name: "Delta Beispiel", art: "unternehmen", sektor: "Mobilität" },
    { id: ORG_CO, name: "Co-Investor Eins", art: "investor" },
    { id: ORG_CO2, name: "Co-Investor Zwei", art: "investor" },
  ]);
  for (const p of [bearbeiterF1, betrachterF1, verwalterF1, bearbeiterF2, freigeberF1]) await legePersonAn(db, p);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Runde anlegen, ändern, prüfen", () => {
  it("legt einen Entwurf mit Positionen an und leitet Post-Money und Anteile ab", async () => {
    const { organisationId, koerper } = stimmig();
    const antwort = await anlegen(koerper, organisationId, bearbeiterF1);
    expect(antwort.status).toBe(201);
    const r = await json(antwort);
    expect(r).toMatchObject({ status: "entwurf", bezeichnung: "Serie A", preMoney: "8000000.00", postMoney: "10000000.00", preisJeAnteil: "10.0000", anteileGesamtNach: null, organisationId });
    expect(r.positionen).toHaveLength(2);
    expect(r.positionen[0]).toMatchObject({ investor: { art: "fonds", id: F1, name: "Testfonds Eins" }, betrag: "1500000.00", rolle: "lead", gezahlt: null, offen: null });
    expect(r.positionen[1]).toMatchObject({ investor: { art: "organisation", id: ORG_CO }, gezahlt: "0.00", offen: "500000.00" });
    expect(r.pruefung).toMatchObject({ volumen: "2000000.00", postMoneyErwartet: "10000000.00", anteileErwartet: "1000000", anteileVergeben: "200000", schliessbar: true, bestandAusgeblendet: true, abweichungen: [] });
    const voll = await json(await get(`/finanzierungsrunden/${r.id}`));
    expect(voll.anteileGesamtNach).toBe("1000000");
    expect(await protokollZeilen(db, "finanzierungsrunde", "anlegen")).toHaveLength(1);
    expect(await protokollZeilen(db, "rundenposition", "anlegen")).toHaveLength(2);
  });

  it("ein Entwurf zählt nirgends: weder in den Runden der Beteiligung noch in der Kapitaltabelle", async () => {
    await db.insert(s.beteiligung).values({ id: "00000000-0000-4000-8000-0000000000e1", fondsId: F1, organisationId: ORG_NEU, instrument: "offene_beteiligung", erstinvestment: "2026-01-01" });
    await anlegen(stimmig().koerper);
    const runden = await json(await get(`/beteiligungen/00000000-0000-4000-8000-0000000000e1/runden?alle=1`));
    expect(runden.daten).toEqual([]);
    const tabelle = await json(await get(`/beteiligungen/00000000-0000-4000-8000-0000000000e1/kapitaltabelle?stichtag=2026-12-31`));
    expect(tabelle.zeilen).toEqual([]);
    const liste = await json(await get(`/organisationen/${ORG_NEU}/finanzierungsrunden`));
    expect(liste.daten).toHaveLength(1);
    expect(liste.daten[0].status).toBe("entwurf");
  });

  it("Vorschau rechnet ohne zu speichern: abgeleitete Werte und Hinweise", async () => {
    const { koerper } = stimmig();
    const gut = await json(await post(`/organisationen/${ORG_NEU}/finanzierungsrunden/vorschau`, koerper));
    expect(gut).toMatchObject({ postMoney: "10000000.00", anteileGesamtNach: "1000000", pruefung: { schliessbar: true } });
    const schief = await json(
      await post(`/organisationen/${ORG_NEU}/finanzierungsrunden/vorschau`, { ...koerper, postMoney: "9500000.00", anteileGesamtNach: "950000", positionen: [{ organisationId: ORG_CO, betrag: "1000000", anteile: "999999", rolle: "co" }] }),
    );
    const codes = schief.pruefung.abweichungen.map((a: { code: string }) => a.code).sort();
    expect(codes).toEqual(["ANTEILE_UEBER_GESAMT", "POSITION_PREIS_ABWEICHEND", "POST_MONEY_ABWEICHEND"]);
    expect(schief.pruefung.schliessbar).toBe(false);
    expect(await anzahl(db, "finanzierungsrunde")).toBe(0);
    const ohne = await json(await post(`/organisationen/${ORG_NEU}/finanzierungsrunden/vorschau`, { ...koerper, positionen: [] }));
    expect(ohne.pruefung.abweichungen.map((a: { code: string }) => a.code)).toContain("KEINE_POSITIONEN");
  });

  it("prüft Eingaben: Post-Money unter Pre-Money, Investor doppelt, Unternehmen als Investor, falsche Klasse", async () => {
    const { koerper } = stimmig();
    const unter = await anlegen({ ...koerper, postMoney: "1.00" }, ORG_NEU, bearbeiterF1);
    expect(unter.status).toBe(400);
    expect((await json(unter)).error.fields[0]).toMatchObject({ field: "postMoney", code: "post_below_pre" });
    const doppelt = await anlegen({ ...koerper, positionen: [koerper.positionen[1], koerper.positionen[1]] });
    expect(doppelt.status).toBe(409);
    expect((await json(doppelt)).error.code).toBe("round_position_exists");
    const selbst = await anlegen({ ...koerper, positionen: [{ organisationId: ORG_NEU, betrag: "1", anteile: "1", rolle: "co" }] });
    expect(selbst.status).toBe(400);
    const beideInvestoren = await anlegen({ ...koerper, positionen: [{ fondsId: F1, organisationId: ORG_CO, betrag: "1", anteile: "1", rolle: "co" }] });
    expect(beideInvestoren.status).toBe(400);
    const [fremdeKlasse] = await db.insert(s.anteilsklasse).values({ organisationId: ORG_CO, name: "Fremd" }).returning();
    const klasse = await anlegen({ ...koerper, positionen: [{ ...koerper.positionen[1], anteilsklasseId: fremdeKlasse!.id }] });
    expect(klasse.status).toBe(409);
    expect((await json(klasse)).error.code).toBe("share_class_mismatch");
    expect(await anzahl(db, "finanzierungsrunde")).toBe(0);
  });

  it("PATCH ändert nur Entwürfe; null leitet Post-Money und Anteile neu aus den Positionen ab", async () => {
    const r = await json(await anlegen(stimmig().koerper));
    const geaendert = await patch(`/finanzierungsrunden/${r.id}`, { bezeichnung: "Serie A+", postMoney: "11000000.00" });
    expect(geaendert.status).toBe(200);
    const g = await json(geaendert);
    expect(g).toMatchObject({ bezeichnung: "Serie A+", postMoney: "11000000.00" });
    expect(g.pruefung.abweichungen.map((a: { code: string }) => a.code)).toContain("POST_MONEY_ABWEICHEND");
    const zurueck = await json(await patch(`/finanzierungsrunden/${r.id}`, { postMoney: null, anteileGesamtNach: null }));
    expect(zurueck).toMatchObject({ postMoney: "10000000.00", anteileGesamtNach: "1000000" });
    expect((await patch(`/finanzierungsrunden/${r.id}`, {})).status).toBe(400);
    expect(await protokollZeilen(db, "finanzierungsrunde", "aendern")).toHaveLength(2);
    // Positionen eines Entwurfs: hinzufügen, ändern, entfernen
    const mitNeuer = await post(`/finanzierungsrunden/${r.id}/positionen`, { organisationId: ORG_CO2, betrag: "100000", anteile: "10000", rolle: "co" });
    expect(mitNeuer.status).toBe(201);
    const pos = (await json(mitNeuer)).positionen.find((p: { investor: { id: string } }) => p.investor.id === ORG_CO2);
    const doppelt = await post(`/finanzierungsrunden/${r.id}/positionen`, { organisationId: ORG_CO2, betrag: "1", anteile: "1", rolle: "co" });
    expect(doppelt.status).toBe(409);
    const gePatcht = await patch(`/finanzierungsrunden/${r.id}/positionen/${pos.id}`, { betrag: "200000", anteile: "20000", rolle: "co_lead" });
    expect((await json(gePatcht)).positionen.find((p: { id: string }) => p.id === pos.id)).toMatchObject({ betrag: "200000.00", anteile: "20000", rolle: "co_lead" });
    expect((await patch(`/finanzierungsrunden/${r.id}/positionen/${pos.id}`, {})).status).toBe(400);
    expect((await loesche(`/finanzierungsrunden/${r.id}/positionen/${pos.id}`)).status).toBe(200);
    expect((await loesche(`/finanzierungsrunden/${r.id}/positionen/${pos.id}`)).status).toBe(404);
    expect(await anzahl(db, "rundenposition")).toBe(2);
    // Ein Entwurf lässt sich ganz löschen
    expect((await loesche(`/finanzierungsrunden/${r.id}`)).status).toBe(204);
    expect(await anzahl(db, "finanzierungsrunde")).toBe(0);
    expect(await anzahl(db, "rundenposition")).toBe(0);
  });
});

describe("Abschließen", () => {
  it("lässt eine nicht stimmige Runde nicht zu (409 round_inconsistent mit den Abweichungen)", async () => {
    const r = await json(await anlegen({ ...stimmig().koerper, postMoney: "9000000.00" }));
    const antwort = await abschliessen(r.id);
    expect(antwort.status).toBe(409);
    const d = await json(antwort);
    expect(d.error.code).toBe("round_inconsistent");
    expect(d.error.abweichungen.map((a: { code: string }) => a.code)).toContain("POST_MONEY_ABWEICHEND");
    expect((await db.select().from(s.finanzierungsrunde))[0]!.status).toBe("entwurf");
    const leer = await json(await anlegen({ ...stimmig().koerper, positionen: [] }));
    expect((await json(await abschliessen(leer.id))).error.abweichungen[0].code).toBe("KEINE_POSITIONEN");
  });

  it("legt je eigener Position Beteiligung, Instrument (Runde, Anteilsklasse), Zusage und Tranche an, auch ohne ausdrücklichen Wunsch", async () => {
    const [klasse] = await db.insert(s.anteilsklasse).values({ organisationId: ORG_NEU, name: "Serie A" }).returning();
    const r = await json(await anlegen({ ...stimmig().koerper, positionen: [{ fondsId: F1, betrag: "1500000.00", anteile: "150000", rolle: "lead", anteilsklasseId: klasse!.id }, stimmig().koerper.positionen[1]] }, ORG_NEU, bearbeiterF1));
    const eigene = r.positionen.find((p: { investor: { art: string } }) => p.investor.art === "fonds");
    const antwort = await abschliessen(r.id, {}, bearbeiterF1);
    expect(antwort.status).toBe(200);
    const d = await json(antwort);
    // Der Standard (Zusage an) gilt auch für die Position ohne Eintrag in `fondsBuchungen`; die Co-Investor-Position bleibt außen vor
    expect(d.buchungen).toHaveLength(1);
    expect(d.buchungen[0]).toMatchObject({ fondsId: F1, beteiligungAngelegt: true, instrumentAngelegt: true });
    const [b] = await db.select().from(s.beteiligung).where(eq(s.beteiligung.organisationId, ORG_NEU));
    const instrumente = await db.select().from(s.instrument).where(eq(s.instrument.beteiligungId, b!.id));
    expect(instrumente).toHaveLength(1);
    expect(instrumente[0]).toMatchObject({ art: "offene_beteiligung", bezeichnung: "Serie A-Anteile", rundeId: r.id, anteilsklasseId: klasse!.id, status: "aktiv" });
    expect((await db.select().from(s.rundenposition).where(eq(s.rundenposition.id, eigene.id)))[0]!.instrumentId).toBe(instrumente[0]!.id);
    const vorgaenge = await db.select().from(s.vorgang).where(eq(s.vorgang.beteiligungId, b!.id));
    expect(vorgaenge.map((v) => [v.art, v.betrag, v.instrumentId])).toEqual([["zusage", "1500000.00", instrumente[0]!.id]]);
    const tranchen = await db.select().from(s.tranche).where(eq(s.tranche.instrumentId, instrumente[0]!.id));
    expect(tranchen).toHaveLength(1);
    expect(tranchen[0]).toMatchObject({ nummer: 1, betrag: "1500000.00", geplantAm: "2026-03-15", bedingung: null });
    expect(d.buchungen[0].trancheId).toBe(tranchen[0]!.id);
    // Die Antwort der Runden nennt Instrument und Beteiligung der eigenen Position (für den Verweis in der Oberfläche), Fremdpositionen keines
    const liste = await json(await get(`/organisationen/${ORG_NEU}/finanzierungsrunden`, bearbeiterF1));
    const positionen = liste.daten.find((x: { id: string }) => x.id === r.id).positionen as { investor: { art: string }; instrumentId: string | null; beteiligungId: string | null }[];
    expect(positionen.find((p) => p.investor.art === "fonds")).toMatchObject({ instrumentId: instrumente[0]!.id, beteiligungId: b!.id });
    expect(positionen.find((p) => p.investor.art === "organisation")).toMatchObject({ instrumentId: null, beteiligungId: null });
    // Wiedereröffnen und erneut abschließen: Instrument, Zusage und Tranche bleiben, nichts wird doppelt gebucht
    expect((await post(`/finanzierungsrunden/${r.id}/wiedereroeffnen`, { grund: "Prüfung" }, verwalterF1)).status).toBe(200);
    expect((await abschliessen(r.id, {}, bearbeiterF1)).status).toBe(200);
    expect(await anzahl(db, "instrument", `beteiligung_id = '${b!.id}'`)).toBe(1);
    expect(await anzahl(db, "vorgang", `beteiligung_id = '${b!.id}'`)).toBe(1);
    expect(await anzahl(db, "tranche")).toBe(1);
  });

  it("Auszahlungen beim Abschluss laufen auf die Tranche der Runde; Art, Bezeichnung und Verzicht auf die Zusage sind einstellbar", async () => {
    const r = await json(await anlegen(stimmig().koerper, ORG_NEU, bearbeiterF1));
    const eigene = r.positionen.find((p: { investor: { art: string } }) => p.investor.art === "fonds");
    const d = await json(await abschliessen(r.id, { fondsBuchungen: [{ positionId: eigene.id, art: "gesellschafterdarlehen", bezeichnung: "Gesellschafterdarlehen Serie A", auszahlungen: [{ valuta: "2026-03-20", betrag: "1000000" }] }] }, bearbeiterF1));
    const auszahlung = (await db.select().from(s.vorgang).where(eq(s.vorgang.art, "auszahlung")))[0]!;
    expect(auszahlung.trancheId).toBe(d.buchungen[0].trancheId);
    expect((await db.select().from(s.instrument).where(eq(s.instrument.id, d.buchungen[0].instrumentId)))[0]).toMatchObject({ art: "gesellschafterdarlehen", bezeichnung: "Gesellschafterdarlehen Serie A" });
    expect((await db.select().from(s.beteiligung).where(eq(s.beteiligung.organisationId, ORG_NEU)))[0]).toMatchObject({ instrument: "gesellschafterdarlehen" });

    // Zweite Runde desselben Unternehmens, ohne Zusage: Das Instrument kommt an die vorhandene Beteiligung, es wird nichts gebucht und keine Tranche angelegt
    const r2 = await json(await anlegen({ ...stimmig().koerper, bezeichnung: "Serie B", datum: "2026-09-15" }, ORG_NEU, bearbeiterF1));
    const eigene2 = r2.positionen.find((p: { investor: { art: string } }) => p.investor.art === "fonds");
    const d2 = await json(await abschliessen(r2.id, { fondsBuchungen: [{ positionId: eigene2.id, zusage: false }] }, bearbeiterF1));
    expect(d2.buchungen[0]).toMatchObject({ beteiligungAngelegt: false, beteiligungId: d.buchungen[0].beteiligungId, instrumentAngelegt: true, trancheId: null, vorgangIds: [] });
    expect((await db.select().from(s.instrument).where(eq(s.instrument.beteiligungId, d.buchungen[0].beteiligungId))).map((i) => i.bezeichnung).sort()).toEqual(["Gesellschafterdarlehen Serie A", "Serie B-Anteile"]);
  });

  it("schließt ab und bucht für den eigenen Fonds Zusage und Auszahlungen; die Beteiligung entsteht als offene Beteiligung", async () => {
    await leereAuftraege(db);
    const r = await json(await anlegen(stimmig().koerper, ORG_NEU, bearbeiterF1));
    const eigene = r.positionen.find((p: { investor: { art: string } }) => p.investor.art === "fonds");
    const antwort = await abschliessen(
      r.id,
      { fondsBuchungen: [{ positionId: eigene.id, zusage: true, auszahlungen: [{ valuta: "2026-03-20", betrag: "1000000" }, { valuta: "2026-06-30", betrag: "500000" }] }] },
      bearbeiterF1,
    );
    expect(antwort.status).toBe(200);
    const d = await json(antwort);
    expect(d.runde.status).toBe("abgeschlossen");
    expect(d.runde.abgeschlossenVon).toBe(await idVon(db, bearbeiterF1));
    expect(d.buchungen).toHaveLength(1);
    expect(d.buchungen[0]).toMatchObject({ fondsId: F1, beteiligungAngelegt: true });
    expect(d.buchungen[0].vorgangIds).toHaveLength(3);
    const [b] = await db.select().from(s.beteiligung).where(eq(s.beteiligung.organisationId, ORG_NEU));
    expect(b).toMatchObject({ fondsId: F1, instrument: "offene_beteiligung", erstinvestment: "2026-03-15", status: "aktiv" });
    const vorgaenge = await db.select().from(s.vorgang).where(eq(s.vorgang.beteiligungId, b!.id)).orderBy(s.vorgang.valuta, s.vorgang.betrag);
    expect(vorgaenge.map((v) => [v.art, v.valuta, v.betrag])).toEqual([
      ["zusage", "2026-03-15", "1500000.00"],
      ["auszahlung", "2026-03-20", "1000000.00"],
      ["auszahlung", "2026-06-30", "500000.00"],
    ]);
    // Protokoll (Beteiligung, drei Vorgänge, Abschluss) und Snapshot-Auftrag
    expect(await protokollZeilen(db, "beteiligung", "anlegen")).toHaveLength(1);
    expect(await protokollZeilen(db, "vorgang", "anlegen")).toHaveLength(3);
    const abschluss = await protokollZeilen(db, "finanzierungsrunde", "abschliessen");
    expect(abschluss).toHaveLength(1);
    expect((abschluss[0]!.nachher as { vorgangIds: string[] }).vorgangIds).toHaveLength(3);
    expect(await auftraege(db)).toBe(1);
    // Die Position zeigt ihre Buchungen; die Runde zählt jetzt in der Kapitaltabelle
    expect(d.runde.positionen.find((p: { id: string }) => p.id === eigene.id).buchungen).toHaveLength(3);
    const tabelle = await json(await get(`/beteiligungen/${b!.id}/kapitaltabelle?stichtag=2026-12-31`));
    expect(tabelle.zeilen.filter((z: { diesesFonds: boolean }) => z.diesesFonds)).toHaveLength(1);
    expect(tabelle.anteileGesamt).toBe("1000000");
  });

  it("nutzt eine vorhandene Beteiligung und bucht nur die Zusage, wenn keine Auszahlungen verlangt sind", async () => {
    const r = await json(await anlegen(stimmig(ID.orgA).koerper, ID.orgA));
    const eigene = r.positionen.find((p: { investor: { art: string } }) => p.investor.art === "fonds");
    const d = await json(await abschliessen(r.id, { fondsBuchungen: [{ positionId: eigene.id, zusageValuta: "2026-03-31" }] }));
    expect(d.buchungen[0]).toMatchObject({ beteiligungId: ID.eigen, beteiligungAngelegt: false });
    expect(await anzahl(db, "beteiligung", `organisation_id = '${ID.orgA}' AND instrument = 'offene_beteiligung'`)).toBe(1);
    const [zusage] = await db.select().from(s.vorgang).where(eq(s.vorgang.beteiligungId, ID.eigen));
    expect(zusage).toMatchObject({ art: "zusage", valuta: "2026-03-31", betrag: "1500000.00" });
  });

  it("rollt alles zurück, wenn eine Invariante oder die Periodensperre greift", async () => {
    const r = await json(await anlegen(stimmig().koerper));
    const eigene = r.positionen.find((p: { investor: { art: string } }) => p.investor.art === "fonds");
    const zuViel = await abschliessen(r.id, { fondsBuchungen: [{ positionId: eigene.id, auszahlungen: [{ valuta: "2026-03-20", betrag: "1500000.01" }] }] });
    expect(zuViel.status).toBe(409);
    expect((await json(zuViel)).error.code).toBe("disbursement_exceeds_commitment");
    expect(await anzahl(db, "vorgang")).toBe(0);
    expect(await anzahl(db, "beteiligung", `organisation_id = '${ORG_NEU}'`)).toBe(0);
    expect((await db.select().from(s.finanzierungsrunde))[0]!.status).toBe("entwurf");

    await put(`/fonds/${F1}/periodensperre`, { gesperrtBis: "2026-03-31", grund: "Abschluss" });
    const gesperrt = await abschliessen(r.id, { fondsBuchungen: [{ positionId: eigene.id }] });
    expect(gesperrt.status).toBe(409);
    expect((await json(gesperrt)).error).toMatchObject({ code: "period_locked", gesperrtBis: "2026-03-31" });
    expect(await anzahl(db, "vorgang")).toBe(0);
    expect(await anzahl(db, "beteiligung", `organisation_id = '${ORG_NEU}'`)).toBe(0);
    // Auch ohne ausdrücklichen Wunsch bucht der Abschluss die Zusage (Standard) und scheitert an der Sperre; ohne Zusage lässt sich die Runde abschließen
    const standard = await abschliessen(r.id);
    expect(standard.status).toBe(409);
    expect((await json(standard)).error.code).toBe("period_locked");
    expect((await abschliessen(r.id, { fondsBuchungen: [{ positionId: eigene.id, zusage: false }] })).status).toBe(200);
  });

  it("verlangt für Buchungen eine Position eines Fonds und die Rolle bearbeiter an diesem Fonds", async () => {
    const r = await json(await anlegen(stimmig().koerper));
    const fremde = r.positionen.find((p: { investor: { art: string } }) => p.investor.art === "organisation");
    const eigene = r.positionen.find((p: { investor: { art: string } }) => p.investor.art === "fonds");
    expect((await abschliessen(r.id, { fondsBuchungen: [{ positionId: fremde.id }] })).status).toBe(400);
    expect((await abschliessen(r.id, { fondsBuchungen: [{ positionId: "00000000-0000-4000-8000-0000000000ff" }] })).status).toBe(400);
    // Verwalter von Fonds Zwei, der in der Runde nicht vorkommt, darf die Runde nicht schließen
    expect((await abschliessen(r.id, { fondsBuchungen: [{ positionId: eigene.id }] }, bearbeiterF2)).status).toBe(403);
    expect(await anzahl(db, "vorgang")).toBe(0);
  });

  it("abgeschlossene Runden sind unveränderlich; ein Verwalter öffnet sie mit Begründung, die Zusage wird nicht doppelt gebucht", async () => {
    const r = await json(await anlegen(stimmig().koerper));
    const eigene = r.positionen.find((p: { investor: { art: string } }) => p.investor.art === "fonds");
    await abschliessen(r.id, { fondsBuchungen: [{ positionId: eigene.id }] });
    expect((await patch(`/finanzierungsrunden/${r.id}`, { bezeichnung: "x" })).status).toBe(409);
    expect((await json(await patch(`/finanzierungsrunden/${r.id}`, { bezeichnung: "x" }))).error.code).toBe("round_not_draft");
    expect((await post(`/finanzierungsrunden/${r.id}/positionen`, { organisationId: ORG_CO2, betrag: "1", anteile: "1", rolle: "co" })).status).toBe(409);
    expect((await loesche(`/finanzierungsrunden/${r.id}/positionen/${eigene.id}`)).status).toBe(409);
    expect((await loesche(`/finanzierungsrunden/${r.id}`)).status).toBe(409);
    expect((await abschliessen(r.id)).status).toBe(409);

    // Rechte: nur Verwalter, mit Begründung
    expect((await post(`/finanzierungsrunden/${r.id}/wiedereroeffnen`, { grund: "Betrag falsch" }, bearbeiterF1)).status).toBe(403);
    expect((await post(`/finanzierungsrunden/${r.id}/wiedereroeffnen`, { grund: "Betrag falsch" }, freigeberF1)).status).toBe(403);
    expect((await post(`/finanzierungsrunden/${r.id}/wiedereroeffnen`, {}, verwalterF1)).status).toBe(400);
    const offen = await post(`/finanzierungsrunden/${r.id}/wiedereroeffnen`, { grund: "Betrag falsch" }, verwalterF1);
    expect(offen.status).toBe(200);
    expect(await json(offen)).toMatchObject({ status: "entwurf", wiedereroeffnungGrund: "Betrag falsch", wiedergeoeffnetVon: await idVon(db, verwalterF1) });
    expect((await post(`/finanzierungsrunden/${r.id}/wiedereroeffnen`, { grund: "nochmal" }, verwalterF1)).status).toBe(409);
    expect(await protokollZeilen(db, "finanzierungsrunde", "wiedereroeffnen")).toHaveLength(1);
    // Die Position mit Buchung lässt sich nicht entfernen
    expect((await json(await loesche(`/finanzierungsrunden/${r.id}/positionen/${eigene.id}`))).error.code).toBe("round_position_posted");
    // Erneutes Abschließen mit Zusage: die Zusage gibt es schon
    const doppelt = await abschliessen(r.id, { fondsBuchungen: [{ positionId: eigene.id }] });
    expect(doppelt.status).toBe(409);
    expect((await json(doppelt)).error.code).toBe("round_commitment_exists");
    expect(await anzahl(db, "vorgang", "art = 'zusage'")).toBe(1);
    // Ohne Zusagewunsch geht es, auch wieder abschließen ohne Buchungen
    expect((await abschliessen(r.id)).status).toBe(200);
    // Nach dem Storno der Zusage ist eine neue möglich
    await post(`/finanzierungsrunden/${r.id}/wiedereroeffnen`, { grund: "Storno der Zusage" }, verwalterF1);
    const zusageId = (await db.select().from(s.vorgang).where(eq(s.vorgang.art, "zusage")))[0]!.id;
    expect((await post(`/transactions/${zusageId}/reverse`, { reason: "Runde neu gebucht" })).status).toBe(201);
    expect((await abschliessen(r.id, { fondsBuchungen: [{ positionId: eigene.id }] })).status).toBe(200);
    expect(await anzahl(db, "vorgang", "art = 'zusage' AND betrag > 0")).toBe(2);
  });

  it("eine Wandlung braucht eine abgeschlossene Runde; eine Runde, die eine Wandlung nutzt, lässt sich nicht wieder öffnen", async () => {
    await post(`/investments/${ID.wandel}/transactions`, { type: "commitment", valueDate: "2026-01-01", amount: "200000" });
    await post(`/investments/${ID.wandel}/transactions`, { type: "disbursement", valueDate: "2026-01-01", amount: "100000" });
    await post(`/beteiligungen/${ID.wandel}/konditionen`, { gueltigAb: "2026-01-01", satzFix: "0.06", methode: "30E/360", zinsperiode: "jaehrlich", anker: "2027-01-01" });
    const nurCo = { ...stimmig(ID.orgC).koerper, positionen: [{ organisationId: ORG_CO, betrag: "500000", anteile: "50000", rolle: "lead" }] };
    const r = await json(await anlegen(nurCo, ID.orgC));
    const wandlungKoerper = { cutoff: "2026-07-01", zinsenWandeln: true, preisregel: { rundenpreisJeAnteil: "10", discount: "0.2" }, nennwertJeAnteil: "1", runde: { id: r.id } };
    const inEntwurf = await post(`/beteiligungen/${ID.wandel}/wandlung`, wandlungKoerper, "bearbeiter");
    expect(inEntwurf.status).toBe(409);
    expect((await json(inEntwurf)).error.code).toBe("round_not_closed");
    expect((await abschliessen(r.id)).status).toBe(200);
    const gewandelt = await post(`/beteiligungen/${ID.wandel}/wandlung`, wandlungKoerper, "bearbeiter");
    expect(gewandelt.status).toBe(201);
    const offen = await post(`/finanzierungsrunden/${r.id}/wiedereroeffnen`, { grund: "Versuch" }, verwalterF1);
    expect(offen.status).toBe(409);
    expect((await json(offen)).error.code).toBe("round_used");
  });
});

describe("Rechte", () => {
  it("Betrachter und fremde Fonds dürfen nicht anlegen oder bearbeiten; ein einsteigender Fonds darf", async () => {
    const { koerper } = stimmig();
    expect((await anlegen(koerper, ORG_NEU, betrachterF1)).status).toBe(403);
    // Bearbeiter von Fonds Zwei darf keine Position von Fonds Eins anlegen (Rolle am Fonds der Position fehlt)
    expect((await anlegen(koerper, ORG_NEU, bearbeiterF2)).status).toBe(403);
    // Einsteigen mit eigener Position: das Unternehmen wird noch von keinem Fonds gehalten
    const einsteiger = { ...koerper, positionen: [{ fondsId: F2, betrag: "2000000", anteile: "200000", rolle: "lead" }] };
    const antwort = await anlegen(einsteiger, ORG_NEU, bearbeiterF2);
    expect(antwort.status).toBe(201);
    const r = await json(antwort);
    // Der einsteigende Fonds liest und ändert seinen Entwurf; Fonds Eins (kein Bezug) sieht ihn nicht
    expect((await get(`/finanzierungsrunden/${r.id}`, bearbeiterF2)).status).toBe(200);
    expect((await patch(`/finanzierungsrunden/${r.id}`, { bezeichnung: "Serie A (neu)" }, bearbeiterF2)).status).toBe(200);
    expect((await get(`/finanzierungsrunden/${r.id}`, bearbeiterF1)).status).toBe(403);
    expect((await get(`/organisationen/${ORG_NEU}/finanzierungsrunden`, bearbeiterF1)).status).toBe(403);
    expect((await patch(`/finanzierungsrunden/${r.id}`, { bezeichnung: "x" }, bearbeiterF1)).status).toBe(403);
    expect((await abschliessen(r.id, {}, bearbeiterF1)).status).toBe(403);
    expect((await post(`/finanzierungsrunden/${r.id}/wiedereroeffnen`, { grund: "x" }, bearbeiterF1)).status).toBe(403);
    // Ein Fonds, der das Unternehmen hält, sieht und bearbeitet die Runde
    await db.insert(s.beteiligung).values({ fondsId: F1, organisationId: ORG_NEU, instrument: "darlehen", erstinvestment: "2026-01-01" });
    expect((await get(`/finanzierungsrunden/${r.id}`, betrachterF1)).status).toBe(200);
    // Die Runde hat eine Position von Fonds Zwei: Wer sie ändert, braucht die Rolle auch dort (sonst 403)
    expect((await patch(`/finanzierungsrunden/${r.id}`, { bezeichnung: "Serie A (F1)" }, bearbeiterF1)).status).toBe(403);
    const beideFonds = person("runde-bearbeiter-beide", { rollen: { [F1]: "bearbeiter", [F2]: "bearbeiter" } });
    expect((await patch(`/finanzierungsrunden/${r.id}`, { bezeichnung: "Serie A (F1)" }, beideFonds)).status).toBe(200);
    expect((await patch(`/finanzierungsrunden/${r.id}`, { bezeichnung: "Serie A (F1)" }, betrachterF1)).status).toBe(403);
    expect((await get(`/finanzierungsrunden/00000000-0000-4000-8000-0000000000ff`)).status).toBe(404);
  });

  it("ein Bearbeiter fügt keine Position eines Fonds hinzu, an dem er keine Rolle hat", async () => {
    await db.insert(s.beteiligung).values({ fondsId: F1, organisationId: ORG_NEU, instrument: "darlehen", erstinvestment: "2026-01-01" });
    const r = await json(await anlegen({ ...stimmig().koerper, positionen: [{ organisationId: ORG_CO, betrag: "1000", anteile: "100", rolle: "co" }] }, ORG_NEU, bearbeiterF1));
    expect(r.positionen).toHaveLength(1);
    const antwort = await post(`/finanzierungsrunden/${r.id}/positionen`, { fondsId: F2, betrag: "1000", anteile: "100", rolle: "co" }, bearbeiterF1);
    expect(antwort.status).toBe(403);
    expect(await anzahl(db, "rundenposition")).toBe(1);
  });

  it("die Klasse einer Position lässt sich weiterhin an abgeschlossenen Runden zuweisen (PATCH /rundenpositionen/:id)", async () => {
    await db.insert(s.beteiligung).values({ fondsId: F1, organisationId: ORG_NEU, instrument: "offene_beteiligung", erstinvestment: "2026-01-01" });
    const r = await json(await anlegen(stimmig().koerper));
    await abschliessen(r.id);
    const [klasse] = await db.insert(s.anteilsklasse).values({ organisationId: ORG_NEU, name: "Serie A" }).returning();
    const antwort = await patch(`/rundenpositionen/${r.positionen[0].id}`, { anteilsklasseId: klasse!.id });
    expect(antwort.status).toBe(200);
  });
});

describe("Rechte: Entwurfspositionen und fremde Fonds", () => {
  it("eine Entwurfsposition des eigenen Fonds gibt kein Recht an anderen Runden des Unternehmens", async () => {
    // Fremde, abgeschlossene Runde von Fonds Eins (Unternehmen wird von Fonds Zwei nicht gehalten)
    const fremde = await json(await anlegen({ ...stimmig().koerper, bezeichnung: "Fremd" }, ORG_NEU, bearbeiterF1));
    await abschliessen(fremde.id);
    // Angreifer (Bearbeiter von Fonds Zwei) legt eine eigene Entwurfsrunde mit Position von Fonds Zwei an
    const eigene = await json(await anlegen({ ...stimmig().koerper, bezeichnung: "Eigen", positionen: [{ fondsId: F2, betrag: "1000", anteile: "100", rolle: "co" }] }, ORG_NEU, bearbeiterF2));
    expect(eigene.status ?? "entwurf").toBe("entwurf");
    // Die eigene Runde ja, die abgeschlossene fremde Runde nein (Fonds Zwei hat keine Beteiligung und keine Position in einer abgeschlossenen Runde)
    expect((await get(`/finanzierungsrunden/${eigene.id}`, bearbeiterF2)).status).toBe(200);
    expect((await get(`/finanzierungsrunden/${fremde.id}`, bearbeiterF2)).status).toBe(403);
    expect((await post(`/finanzierungsrunden/${fremde.id}/wiedereroeffnen`, { grund: "x" }, bearbeiterF2)).status).toBe(403);
    expect((await post(`/finanzierungsrunden/${fremde.id}/positionen`, { fondsId: F2, betrag: "1", anteile: "1", rolle: "co" }, bearbeiterF2)).status).toBe(403);
    const liste = await json(await get(`/organisationen/${ORG_NEU}/finanzierungsrunden`, bearbeiterF2));
    expect(liste.daten.map((r: { id: string }) => r.id)).toEqual([eigene.id]);
    // Auch ein fremder Entwurf von Fonds Eins bleibt Fonds Zwei verborgen
    const fremderEntwurf = await json(await anlegen({ ...stimmig().koerper, bezeichnung: "Fremder Entwurf" }, ORG_NEU, bearbeiterF1));
    expect((await get(`/finanzierungsrunden/${fremderEntwurf.id}`, bearbeiterF2)).status).toBe(403);
    expect((await patch(`/finanzierungsrunden/${fremderEntwurf.id}`, { bezeichnung: "x" }, bearbeiterF2)).status).toBe(403);
    expect((await loesche(`/finanzierungsrunden/${fremderEntwurf.id}`, undefined, bearbeiterF2)).status).toBe(403);
  });

  it("Löschen, Abschließen und Wiedereröffnen verlangen die Rolle an jedem Fonds mit Position in der Runde", async () => {
    const beideBearbeiter = person("runde-bearbeiter-beide2", { rollen: { [F1]: "bearbeiter", [F2]: "bearbeiter" } });
    const beideVerwalter = person("runde-verwalter-beide", { rollen: { [F1]: "verwalter", [F2]: "verwalter" } });
    const gemischt = { ...stimmig().koerper, positionen: [{ fondsId: F1, betrag: "1500000", anteile: "150000", rolle: "lead" }, { fondsId: F2, betrag: "500000", anteile: "50000", rolle: "co" }] };
    const r = await json(await anlegen(gemischt, ORG_NEU, beideBearbeiter));
    // Bearbeiter von Fonds Eins allein darf die gemeinsame Runde weder löschen noch abschließen
    expect((await loesche(`/finanzierungsrunden/${r.id}`, undefined, bearbeiterF1)).status).toBe(403);
    expect((await abschliessen(r.id, {}, bearbeiterF1)).status).toBe(403);
    expect(await anzahl(db, "finanzierungsrunde")).toBe(1);
    expect(await anzahl(db, "rundenposition")).toBe(2);
    expect((await abschliessen(r.id, {}, beideBearbeiter)).status).toBe(200);
    // Verwalter von Fonds Eins allein darf nicht wieder öffnen; beide Verwalter dürfen
    expect((await post(`/finanzierungsrunden/${r.id}/wiedereroeffnen`, { grund: "x" }, verwalterF1)).status).toBe(403);
    expect((await post(`/finanzierungsrunden/${r.id}/wiedereroeffnen`, { grund: "x" }, beideVerwalter)).status).toBe(200);
    // Der Abschluss hat je Position ein Instrument angelegt: Die wieder geöffnete Runde lässt sich nicht löschen, ein neuer Entwurf schon.
    expect((await loesche(`/finanzierungsrunden/${r.id}`, undefined, beideBearbeiter)).status).toBe(409);
    const entwurf = await json(await anlegen({ ...gemischt, bezeichnung: "Entwurf" }, ORG_NEU, beideBearbeiter));
    expect((await loesche(`/finanzierungsrunden/${entwurf.id}`, undefined, beideBearbeiter)).status).toBe(204);
    expect(await anzahl(db, "rundenposition")).toBe(2);
  });

  it("Positionen ändern verlangt die Rolle an jedem Fonds der Runde, auch bei Positionen von Co-Investoren", async () => {
    const beide = person("runde-bearbeiter-beide3", { rollen: { [F1]: "bearbeiter", [F2]: "bearbeiter" } });
    const gemischt = { ...stimmig().koerper, positionen: [{ fondsId: F1, betrag: "1500000", anteile: "150000", rolle: "lead" }, { fondsId: F2, betrag: "400000", anteile: "40000", rolle: "co" }, { organisationId: ORG_CO, betrag: "100000", anteile: "10000", rolle: "co" }] };
    const r = await json(await anlegen(gemischt, ORG_NEU, beide));
    const fremde = r.positionen.find((p: { investor: { art: string } }) => p.investor.art === "organisation");
    expect((await post(`/finanzierungsrunden/${r.id}/positionen`, { organisationId: ORG_CO2, betrag: "1", anteile: "1", rolle: "co" }, bearbeiterF1)).status).toBe(403);
    expect((await patch(`/finanzierungsrunden/${r.id}/positionen/${fremde.id}`, { betrag: "2" }, bearbeiterF1)).status).toBe(403);
    expect((await loesche(`/finanzierungsrunden/${r.id}/positionen/${fremde.id}`, undefined, bearbeiterF1)).status).toBe(403);
    expect(await anzahl(db, "rundenposition")).toBe(3);
    expect((await patch(`/finanzierungsrunden/${r.id}/positionen/${fremde.id}`, { betrag: "100001" }, beide)).status).toBe(200);
    expect((await loesche(`/finanzierungsrunden/${r.id}/positionen/${fremde.id}`, undefined, beide)).status).toBe(200);
    // Runde nur mit Positionen des eigenen Fonds: der Bearbeiter dieses Fonds ändert Co-Investoren-Positionen
    const nurF1 = await json(await anlegen({ ...stimmig().koerper, bezeichnung: "Nur F1" }, ORG_NEU, bearbeiterF1));
    const co = nurF1.positionen.find((p: { investor: { art: string } }) => p.investor.art === "organisation");
    expect((await patch(`/finanzierungsrunden/${nurF1.id}/positionen/${co.id}`, { betrag: "500001" }, bearbeiterF1)).status).toBe(200);
    // Eine Position eines Fonds verlangt zusätzlich die Rolle an diesem Fonds
    expect((await post(`/finanzierungsrunden/${nurF1.id}/positionen`, { fondsId: F2, betrag: "1", anteile: "1", rolle: "co" }, bearbeiterF1)).status).toBe(403);
  });

  it("der Änderungsstrom zeigt Runden und Zahlungen nur Fonds mit Bezug", async () => {
    const r = await json(await anlegen({ ...stimmig().koerper, bezeichnung: "Strom" }, ORG_NEU, bearbeiterF1));
    await abschliessen(r.id);
    const fremde = r.positionen.find((p: { investor: { art: string } }) => p.investor.art === "organisation");
    await post(`/rundenpositionen/${fremde.id}/zahlungen`, { datum: "2026-04-01", art: "einzahlung", betrag: "1" });
    const tabellen = async (als: Parameters<typeof get>[1]) => (await json(await get("/changes?limit=1000", als))).data.map((z: { table: string }) => z.table);
    const f1 = await tabellen(bearbeiterF1);
    expect(f1).toContain("finanzierungsrunde");
    expect(f1).toContain("rundenposition_zahlung");
    const f2 = await tabellen(bearbeiterF2);
    expect(f2).not.toContain("finanzierungsrunde");
    expect(f2).not.toContain("rundenposition_zahlung");
    expect(await tabellen(undefined)).toContain("rundenposition_zahlung");
    // Hält Fonds Zwei das Unternehmen, sieht er die Runde
    await db.insert(s.beteiligung).values({ fondsId: F2, organisationId: ORG_NEU, instrument: "darlehen", erstinvestment: "2026-01-01" });
    expect(await tabellen(bearbeiterF2)).toContain("finanzierungsrunde");
  });
});

describe("Zahlungen der Co-Investoren", () => {
  const abgeschlosseneRunde = async () => {
    const r = await json(await anlegen(stimmig().koerper));
    await abschliessen(r.id);
    const fremde = r.positionen.find((p: { investor: { art: string } }) => p.investor.art === "organisation");
    const eigene = r.positionen.find((p: { investor: { art: string } }) => p.investor.art === "fonds");
    return { r, fremde, eigene };
  };
  const zahlung = (positionId: string, koerper: unknown, als?: Parameters<typeof post>[2]) => post(`/rundenpositionen/${positionId}/zahlungen`, koerper, als);

  it("erfasst Einzahlungen und Rückzahlungen und zeigt Gezahlt gegen Zusage", async () => {
    const { r, fremde } = await abgeschlosseneRunde();
    const e1 = await zahlung(fremde.id, { datum: "2026-04-01", art: "einzahlung", betrag: "200000", bemerkung: "Erste Rate" }, bearbeiterF1);
    expect(e1.status).toBe(201);
    expect(await json(e1)).toMatchObject({ zusage: "500000.00", gezahlt: "200000.00", offen: "300000.00", zahlung: { art: "einzahlung", betrag: "200000.00" } });
    await zahlung(fremde.id, { datum: "2026-05-01", art: "einzahlung", betrag: "100000" });
    const rueck = await zahlung(fremde.id, { datum: "2026-06-01", art: "rueckzahlung", betrag: "50000" });
    expect(await json(rueck)).toMatchObject({ gezahlt: "250000.00", offen: "250000.00" });
    const liste = await json(await get(`/rundenpositionen/${fremde.id}/zahlungen`, betrachterF1));
    expect(liste.daten.map((z: { art: string; betrag: string }) => `${z.art}:${z.betrag}`)).toEqual(["einzahlung:200000.00", "einzahlung:100000.00", "rueckzahlung:50000.00"]);
    const runde = await json(await get(`/finanzierungsrunden/${r.id}`));
    expect(runde.positionen.find((p: { id: string }) => p.id === fremde.id)).toMatchObject({ gezahlt: "250000.00", offen: "250000.00" });
    expect(await protokollZeilen(db, "rundenposition_zahlung", "anlegen")).toHaveLength(3);
    // Zu viel zurückzahlen und Betrag/Datum prüfen
    const zuViel = await zahlung(fremde.id, { datum: "2026-07-01", art: "rueckzahlung", betrag: "250000.01" });
    expect(zuViel.status).toBe(400);
    expect((await zahlung(fremde.id, { datum: "morgen", art: "einzahlung", betrag: "0" })).status).toBe(400);
    expect((await zahlung(fremde.id, { datum: "2026-07-01", art: "einzahlung", betrag: "1" }, betrachterF1)).status).toBe(403);
    // Löschen: erlaubt, solange die Rückzahlungen gedeckt bleiben
    const erste = liste.daten[0].id;
    const blockiert = await loesche(`/rundenpositionen/${fremde.id}/zahlungen/${erste}`);
    expect(blockiert.status).toBe(200);
    expect((await json(await loesche(`/rundenpositionen/${fremde.id}/zahlungen/${erste}`))).error.code).toBe("payment_not_found");
  });

  it("gibt es nur für Positionen von Co-Investoren und für abgeschlossene Runden", async () => {
    const { eigene } = await abgeschlosseneRunde();
    const antwort = await zahlung(eigene.id, { datum: "2026-04-01", art: "einzahlung", betrag: "1" });
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).error.code).toBe("payment_third_party_position_only");
    const entwurf = await json(await anlegen({ ...stimmig(ID.orgB).koerper, bezeichnung: "Entwurf" }));
    const fremde = entwurf.positionen.find((p: { investor: { art: string } }) => p.investor.art === "organisation");
    const imEntwurf = await zahlung(fremde.id, { datum: "2026-04-01", art: "einzahlung", betrag: "1" });
    expect(imEntwurf.status).toBe(409);
    expect((await json(imEntwurf)).error.code).toBe("round_not_closed");
    expect((await zahlung("00000000-0000-4000-8000-0000000000ff", { datum: "2026-04-01", art: "einzahlung", betrag: "1" })).status).toBe(404);
  });

  it("Zahlungen gehen in keine Kennzahl des eigenen Fonds ein", async () => {
    const r = await json(await anlegen(stimmig().koerper));
    const fremde = r.positionen.find((p: { investor: { art: string } }) => p.investor.art === "organisation");
    const eigene = r.positionen.find((p: { investor: { art: string } }) => p.investor.art === "fonds");
    const d = await json(await abschliessen(r.id, { fondsBuchungen: [{ positionId: eigene.id, auszahlungen: [{ valuta: "2026-03-20", betrag: "1000000" }] }] }));
    await db.insert(s.fondsBewegung).values({ fondsId: F1, art: "abruf", valuta: "2026-03-01", betrag: "1200000.00" });
    const beteiligungId = d.buchungen[0].beteiligungId as string;
    const uebersicht = async () => {
      const stand = encodeURIComponent(new Date(Date.now() + 3_600_000).toISOString());
      const u = await json(await get(`/fonds/${F1}/uebersicht?stichtag=2026-12-31&stand=${stand}`));
      const b = await json(await get(`/beteiligungen/${beteiligungId}?stichtag=2026-12-31`));
      return JSON.stringify({ k: u.kennzahlen, b: b.kennzahlen });
    };
    const vorher = await uebersicht();
    expect(JSON.parse(vorher).k.abgerufen.wert).toBe("1200000");
    await zahlung(fremde.id, { datum: "2026-04-01", art: "einzahlung", betrag: "500000" });
    expect(await uebersicht()).toBe(vorher);
    expect(await anzahl(db, "vorgang")).toBe(2);
    expect(await anzahl(db, "fonds_bewegung")).toBe(1);
  });
});

describe("Import und manuelle Runden", () => {
  it("manuell angelegte Runden bekommen keinen Importschlüssel, importierte Runden gelten als abgeschlossen", async () => {
    const r = await json(await anlegen(stimmig().koerper));
    await abschliessen(r.id);
    expect(await anzahl(db, "import_zuordnung")).toBe(0);
    await db.insert(s.finanzierungsrunde).values({ organisationId: ORG_NEU, bezeichnung: "Import", datum: "2025-01-01", preMoney: "1.00", postMoney: "2.00", preisJeAnteil: "1.0000", anteileGesamtNach: "2" });
    const status = await db.execute(sql`SELECT status::text AS status FROM finanzierungsrunde WHERE bezeichnung = 'Import'`);
    expect(status.rows[0]?.status).toBe("abgeschlossen");
  });
});

describe("Dubletten: gleiche Runde zweimal", () => {
  const dubletten = async (antwort: Response) => (await json(antwort)).dubletten as { id: string; gleichesDatum: boolean; gleicherPreis: boolean; bezeichnung: string }[];
  const andere = (extra: object) => ({ ...stimmig().koerper, ...extra });

  it("die erste Runde meldet nichts; eine zweite mit gleichem Datum und gleichem Preis wird angelegt und meldet die erste", async () => {
    const erste = await anlegen(stimmig().koerper, ORG_NEU, bearbeiterF1);
    expect(erste.status).toBe(201);
    expect(await dubletten(erste)).toEqual([]);
    const ersteId = (await json(await get(`/organisationen/${ORG_NEU}/finanzierungsrunden`))).daten[0].id;
    const zweite = await anlegen(stimmig().koerper, ORG_NEU, bearbeiterF1);
    expect(zweite.status).toBe(201); // warnt, blockiert nicht
    expect(await dubletten(zweite)).toEqual([{ id: ersteId, bezeichnung: "Serie A", datum: "2026-03-15", gleichesDatum: true, gleicherPreis: true }]);
    expect(await anzahl(db, "finanzierungsrunde")).toBe(2);
  });

  it("nur das Datum oder nur der Preis gleich: je eigenes Kennzeichen; Zahlen werden numerisch verglichen (10 und 10.0000)", async () => {
    await anlegen(stimmig().koerper, ORG_NEU, bearbeiterF1);
    const nurDatum = await dubletten(await anlegen(andere({ preisJeAnteil: "11.0000", preMoney: "9000000.00", positionen: [{ fondsId: F1, betrag: "1100000.00", anteile: "100000", rolle: "lead" }] }), ORG_NEU, bearbeiterF1));
    expect(nurDatum.map((d) => [d.gleichesDatum, d.gleicherPreis])).toEqual([[true, false]]);
    const nurPreis = await dubletten(await anlegen(andere({ datum: "2026-09-01", preisJeAnteil: "10" }), ORG_NEU, bearbeiterF1));
    expect(nurPreis.map((d) => [d.gleichesDatum, d.gleicherPreis])).toEqual([[false, true]]); // die Runde zu 11,00 am selben Tag zählt nicht
    const ohne = await dubletten(await anlegen(andere({ datum: "2027-01-01", preisJeAnteil: "20.0000", preMoney: "18000000.00", positionen: [{ fondsId: F1, betrag: "2000000.00", anteile: "100000", rolle: "lead" }] }), ORG_NEU, bearbeiterF1));
    expect(ohne).toEqual([]);
  });

  it("andere Unternehmen zählen nicht; abgeschlossene Runden zählen mit", async () => {
    await db.insert(s.finanzierungsrunde).values({ organisationId: ORG_CO, bezeichnung: "Fremd", datum: "2026-03-15", preMoney: "1.00", postMoney: "2.00", preisJeAnteil: "10.0000", anteileGesamtNach: "2" });
    expect(await dubletten(await anlegen(stimmig().koerper, ORG_NEU, bearbeiterF1))).toEqual([]);
    const [alt] = await db.insert(s.finanzierungsrunde).values({ organisationId: ORG_NEU, bezeichnung: "Alt", datum: "2026-03-15", preMoney: "1.00", postMoney: "2.00", preisJeAnteil: "5.0000", anteileGesamtNach: "2" }).returning();
    await db.insert(s.rundenposition).values({ rundeId: alt!.id, fondsId: F1, betrag: "1.00", anteile: "1", rolle: "lead" }); // sichtbar für Fonds Eins
    const hinweis = await dubletten(await anlegen(stimmig().koerper, ORG_NEU, bearbeiterF1));
    expect(hinweis.map((d) => d.bezeichnung).sort()).toEqual(["Alt", "Serie A"]);
  });

  it("Sichtbarkeit: wer die Runde nicht sieht, bekommt keinen Hinweis darauf (Anlegen und Vorschau); der Hinweis enthält nur Id, Datum und Bezeichnung", async () => {
    const erste = await anlegen(stimmig().koerper, ORG_NEU, bearbeiterF1);
    expect(erste.status).toBe(201);
    // Fonds Zwei steigt mit eigener Position ein, sieht die Runde von Fonds Eins aber nicht.
    const eigene = { ...stimmig().koerper, positionen: [{ fondsId: F2, betrag: "1500000.00", anteile: "150000", rolle: "lead" }] };
    const vorschau = await post(`/organisationen/${ORG_NEU}/finanzierungsrunden/vorschau`, eigene, bearbeiterF2);
    expect(vorschau.status).toBe(200);
    expect(await dubletten(vorschau)).toEqual([]);
    const zweite = await anlegen(eigene, ORG_NEU, bearbeiterF2);
    expect(zweite.status).toBe(201);
    expect(await dubletten(zweite)).toEqual([]);
    // Fonds Eins sieht die Runde von Fonds Zwei dagegen, weil beide am Unternehmen beteiligt sind? Nur über die Rechtsgrundlage: hier keine, also auch nicht.
    const drittF1 = await anlegen(stimmig().koerper, ORG_NEU, bearbeiterF1);
    const felder = (await dubletten(drittF1)).map((d) => Object.keys(d).sort());
    expect(felder.length).toBeGreaterThan(0);
    for (const f of felder) expect(f).toEqual(["bezeichnung", "datum", "gleicherPreis", "gleichesDatum", "id"]);
    // Ein Globaler Verwalter sieht alle.
    const global = person("runde-global", { globalVerwalter: true });
    await legePersonAn(db, global);
    expect((await dubletten(await post(`/organisationen/${ORG_NEU}/finanzierungsrunden/vorschau`, stimmig().koerper, global))).length).toBe(3);
  });

  it("die Vorschau meldet dieselben Dubletten, ohne etwas zu speichern", async () => {
    await anlegen(stimmig().koerper, ORG_NEU, bearbeiterF1);
    const vorschau = await post(`/organisationen/${ORG_NEU}/finanzierungsrunden/vorschau`, stimmig().koerper);
    expect(vorschau.status).toBe(200);
    expect(await dubletten(vorschau)).toHaveLength(1);
    expect(await anzahl(db, "finanzierungsrunde")).toBe(1);
  });
});
