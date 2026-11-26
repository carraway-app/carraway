import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, legePersonAn, person } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { aufrufe, grundbestand, ID, json, protokollZeilen } from "./hilfen-instrumente";

/** Vehikel der Co-Investoren (docs/portfolio-modell.md, „Vehikel der Co-Investoren“): Anlegen, Auswahl, Positionen, Kapitaltabelle, Sichtbarkeit. */

const { db, pool } = oeffneTestdb();
const { get, post, patch, delete: loesche } = aufrufe(erstelleTestApp(db));

const F1 = ID.fonds;
const F2 = ID.anderer;
const FIRMA = ID.orgA; // Fonds Eins hält eine Beteiligung
const INV = "00000000-0000-4000-8000-0000000000e1";
const INV_OHNE = "00000000-0000-4000-8000-0000000000e2";
const bearbeiterF1 = person("vehikel-bearbeiter-f1", { rollen: { [F1]: "bearbeiter" } });
const betrachterF2 = person("vehikel-betrachter-f2", { rollen: { [F2]: "betrachter" } });

beforeEach(async () => {
  await grundbestand(db);
  await db.insert(s.organisation).values([
    { id: INV, name: "Musterkapital GmbH", art: "investor" },
    { id: INV_OHNE, name: "Beispiel Invest AG", art: "investor" },
  ]);
  for (const p of [bearbeiterF1, betrachterF2]) await legePersonAn(db, p);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const vehikelAnlegen = async (koerper: unknown, organisationId = INV) => post(`/organisationen/${organisationId}/vehikel`, koerper, bearbeiterF1);
const runde = (positionen: unknown[]) => ({ bezeichnung: "Serie A", datum: "2026-03-15", preMoney: "8000000.00", preisJeAnteil: "10.0000", positionen });

describe("Vehikel anlegen und pflegen", () => {
  it("das erste Vehikel wird Standard, weitere nicht; Name je Investor eindeutig; nur bei Investoren", async () => {
    const seed = await vehikelAnlegen({ name: "Musterkapital Seedfonds I", auflagejahr: 2018 });
    expect(seed.status).toBe(201);
    expect(await json(seed)).toMatchObject({ investorId: INV, name: "Musterkapital Seedfonds I", art: "fonds", auflagejahr: 2018, status: "aktiv", standard: true });
    const wachstum = await json(await vehikelAnlegen({ name: "Musterkapital Wachstumsfonds III", art: "gesellschaft" }));
    expect(wachstum).toMatchObject({ standard: false, art: "gesellschaft" });

    const doppelt = await vehikelAnlegen({ name: "Musterkapital Seedfonds I" });
    expect(doppelt.status).toBe(409);
    expect((await json(doppelt)).fehler.code).toBe("VEHIKEL_NAME_VERGEBEN");
    const keinInvestor = await vehikelAnlegen({ name: "Firmenfonds" }, FIRMA);
    expect(keinInvestor.status).toBe(409);
    expect((await json(keinInvestor)).fehler.code).toBe("VEHIKEL_KEIN_INVESTOR");
    expect((await vehikelAnlegen({ name: "Zu alt", auflagejahr: 1800 })).status).toBe(400);

    // Standard wandert, es bleibt genau einer
    const umgestellt = await patch(`/vehikel/${wachstum.id}`, { standard: true, status: "in_liquidation" }, bearbeiterF1);
    expect(umgestellt.status).toBe(200);
    const liste = (await json(await get(`/organisationen/${INV}/vehikel`, bearbeiterF1))).daten;
    expect(liste.map((v: { name: string; standard: boolean; status: string }) => [v.name, v.standard, v.status])).toEqual([
      ["Musterkapital Wachstumsfonds III", true, "in_liquidation"],
      ["Musterkapital Seedfonds I", false, "aktiv"],
    ]);
    expect((await protokollZeilen(db, "vehikel", "anlegen")).length).toBe(2);
  });

  it("Auswahl sucht in Vehikel- und Investornamen und nennt den Investor", async () => {
    await vehikelAnlegen({ name: "Musterkapital Seedfonds I" });
    await vehikelAnlegen({ name: "Wachstum III" });
    await vehikelAnlegen({ name: "Beispiel Fonds", art: "fonds" }, INV_OHNE);
    const nachInvestor = (await json(await get("/vehikel?suche=muster", betrachterF2))).daten;
    expect(nachInvestor.map((v: { name: string }) => v.name)).toEqual(["Musterkapital Seedfonds I", "Wachstum III"]);
    expect(nachInvestor[0]).toMatchObject({ standard: true, investor: { id: INV, name: "Musterkapital GmbH" } });
    const nachVehikel = (await json(await get("/vehikel?suche=wachstum", betrachterF2))).daten;
    expect(nachVehikel).toHaveLength(1);
    expect((await json(await get(`/vehikel?investorId=${INV_OHNE}`, betrachterF2))).daten.map((v: { name: string }) => v.name)).toEqual(["Beispiel Fonds"]);
  });
});

describe("Positionen über Vehikel", () => {
  it("Runde mit zwei Vehikeln desselben Investors; dasselbe Vehikel zweimal ist ein Fehler; Antwort und Kapitaltabelle nennen Vehikel und Investor", async () => {
    const v1 = await json(await vehikelAnlegen({ name: "Musterkapital Seedfonds I" }));
    const v2 = await json(await vehikelAnlegen({ name: "Musterkapital Wachstumsfonds III" }));
    const doppelt = await post(
      `/organisationen/${FIRMA}/finanzierungsrunden`,
      runde([
        { vehikelId: v1.id, betrag: "100000.00", anteile: "10000", rolle: "lead" },
        { vehikelId: v1.id, betrag: "100000.00", anteile: "10000", rolle: "co" },
      ]),
      bearbeiterF1,
    );
    expect(doppelt.status).toBe(409);
    expect((await json(doppelt)).fehler.code).toBe("RUNDENPOSITION_VORHANDEN");

    const antwort = await post(
      `/organisationen/${FIRMA}/finanzierungsrunden`,
      runde([
        { fondsId: F1, betrag: "1000000.00", anteile: "100000", rolle: "lead" },
        { vehikelId: v1.id, betrag: "600000.00", anteile: "60000", rolle: "co" },
        { vehikelId: v2.id, betrag: "400000.00", anteile: "40000", rolle: "co" },
      ]),
      bearbeiterF1,
    );
    expect(antwort.status).toBe(201);
    const r = await json(antwort);
    const fremd = r.positionen.filter((p: { investor: { art: string } }) => p.investor.art === "organisation");
    expect(fremd.map((p: { vehikel: { name: string }; investor: { id: string; name: string } }) => [p.vehikel.name, p.investor.id, p.investor.name])).toEqual([
      ["Musterkapital Seedfonds I", INV, "Musterkapital GmbH"],
      ["Musterkapital Wachstumsfonds III", INV, "Musterkapital GmbH"],
    ]);
    expect(r.positionen.find((p: { investor: { art: string } }) => p.investor.art === "fonds").vehikel).toBeNull();

    // Ein weiteres Mal dasselbe Vehikel über die Einzelposition: Fehler; ein anderes Vehikel: erlaubt
    expect((await post(`/finanzierungsrunden/${r.id}/positionen`, { vehikelId: v2.id, betrag: "1.00", anteile: "1", rolle: "co" }, bearbeiterF1)).status).toBe(409);

    // Kapitaltabelle nach dem Abschluss: Halter mit Vehikel und Investor
    expect((await post(`/finanzierungsrunden/${r.id}/abschliessen`, { fondsBuchungen: [] }, bearbeiterF1)).status).toBe(200);
    const kt = await json(await get(`/beteiligungen/${ID.eigen}/kapitaltabelle?stichtag=2026-12-31`, bearbeiterF1));
    const halter = kt.zeilen
      .filter((z: { halter: { art: string } }) => z.halter.art === "organisation")
      .map((z: { halter: { vehikel: { name: string } } }) => z.halter)
      .sort((a: { vehikel: { name: string } }, b: { vehikel: { name: string } }) => a.vehikel.name.localeCompare(b.vehikel.name));
    expect(halter).toEqual([
      { art: "organisation", id: INV, name: "Musterkapital GmbH", vehikel: { id: v1.id, name: "Musterkapital Seedfonds I" } },
      { art: "organisation", id: INV, name: "Musterkapital GmbH", vehikel: { id: v2.id, name: "Musterkapital Wachstumsfonds III" } },
    ]);
    // Gruppiert nach Investor: eine Zeile über beide Vehikel
    const investor = kt.inhaber.find((x: { halter: { id: string | null } }) => x.halter.id === INV);
    expect(investor).toMatchObject({ halter: { art: "organisation", name: "Musterkapital GmbH" }, positionen: 2, anteile: "100000", investiert: "1000000.00", diesesFonds: false });
    expect(investor.vehikel.map((x: { name: string }) => x.name)).toEqual(["Musterkapital Seedfonds I", "Musterkapital Wachstumsfonds III"]);
    expect(kt.inhaber.find((x: { halter: { art: string } }) => x.halter.art === "fonds")).toMatchObject({ positionen: 1, diesesFonds: true, vehikel: [] });
    // Der Wasserfall rechnet je Position und nennt dieselben Halter
    const wf = await json(await post(`/beteiligungen/${ID.eigen}/wasserfall`, { exitwert: "20000000.00", exitdatum: "2026-12-31" }, bearbeiterF1));
    expect(wf.zeilen.filter((z: { halter: { vehikel: unknown } }) => z.halter.vehikel !== null)).toHaveLength(2);
    // Je Investor: eine Zeile über beide Vehikel, Summen gleich den Positionen; Gesamtsumme bleibt der verteilte Erlös
    type WfZeile = { halter: { art: string; id: string | null }; anteile: string; investiert: string; gesamt: string; praeferenz: string; beteiligung: string };
    const summe = (zeilen: WfZeile[], feld: "anteile" | "investiert" | "gesamt" | "praeferenz" | "beteiligung") => zeilen.reduce((s, z) => s + Number(z[feld]), 0);
    const positionenInv: WfZeile[] = wf.zeilen.filter((z: WfZeile) => z.halter.id === INV);
    const wfInv = wf.inhaber.find((x: { halter: { id: string | null } }) => x.halter.id === INV);
    expect(wfInv).toMatchObject({ halter: { art: "organisation", name: "Musterkapital GmbH" }, positionen: 2, anteile: "100000", investiert: "1000000.00", diesesFonds: false });
    expect(wfInv.vehikel.map((x: { name: string }) => x.name)).toEqual(["Musterkapital Seedfonds I", "Musterkapital Wachstumsfonds III"]);
    expect(Number(wfInv.gesamt)).toBeCloseTo(summe(positionenInv, "gesamt"), 2);
    expect(Number(wfInv.praeferenz)).toBeCloseTo(summe(positionenInv, "praeferenz"), 2);
    expect(Number(wfInv.beteiligung)).toBeCloseTo(summe(positionenInv, "beteiligung"), 2);
    expect(wfInv.multiple).not.toBeNull();
    expect(wf.inhaber.find((x: { halter: { art: string } }) => x.halter.art === "fonds")).toMatchObject({ positionen: 1, diesesFonds: true, vehikel: [] });
    expect(wf.inhaber.reduce((s: number, x: WfZeile) => s + Number(x.gesamt), 0)).toBeCloseTo(summe(wf.zeilen, "gesamt"), 2);
    expect(wf.inhaber.reduce((s: number, x: WfZeile) => s + Number(x.anteile), 0)).toBe(summe(wf.zeilen, "anteile"));

    // Löschen nur ohne Positionen
    const inVerwendung = await loesche(`/vehikel/${v1.id}`, undefined, bearbeiterF1);
    expect(inVerwendung.status).toBe(409);
    expect((await json(inVerwendung)).fehler.code).toBe("VEHIKEL_IN_VERWENDUNG");
    const frei = await json(await vehikelAnlegen({ name: "Leer" }));
    expect((await loesche(`/vehikel/${frei.id}`, undefined, bearbeiterF1)).status).toBe(204);
  });

  it("organisationId ohne Vehikel: die Position kommt an ein neues Standard-Vehikel mit dem Namen des Investors (im Protokoll)", async () => {
    const antwort = await post(
      `/organisationen/${FIRMA}/finanzierungsrunden`,
      runde([
        { fondsId: F1, betrag: "1000000.00", anteile: "100000", rolle: "lead" },
        { organisationId: INV_OHNE, betrag: "500000.00", anteile: "50000", rolle: "co" },
      ]),
      bearbeiterF1,
    );
    expect(antwort.status).toBe(201);
    const r = await json(antwort);
    const [v] = await db.select().from(s.vehikel).where(eq(s.vehikel.investorId, INV_OHNE));
    expect(v).toMatchObject({ name: "Beispiel Invest AG", standard: true, art: "fonds" });
    expect(r.positionen.find((p: { vehikel: unknown }) => p.vehikel !== null)).toMatchObject({ vehikel: { id: v!.id, name: "Beispiel Invest AG" }, investor: { id: INV_OHNE } });
    expect(await protokollZeilen(db, "vehikel", "anlegen")).toHaveLength(1);
    // Ein zweiter Aufruf mit organisationId nimmt dasselbe Standard-Vehikel (und ist deshalb in derselben Runde doppelt)
    const nochmal = await post(`/finanzierungsrunden/${r.id}/positionen`, { organisationId: INV_OHNE, betrag: "1.00", anteile: "1", rolle: "co" }, bearbeiterF1);
    expect(nochmal.status).toBe(409);
    expect(await db.select().from(s.vehikel).where(eq(s.vehikel.investorId, INV_OHNE))).toHaveLength(1);
    // Genau einer von fondsId, vehikelId und organisationId
    expect((await post(`/finanzierungsrunden/${r.id}/positionen`, { organisationId: INV_OHNE, vehikelId: v!.id, betrag: "1.00", anteile: "1", rolle: "co" }, bearbeiterF1)).status).toBe(400);
  });

  it("Positionen je Vehikel erscheinen nur für Personen, die die Runde des Unternehmens sehen", async () => {
    const v1 = await json(await vehikelAnlegen({ name: "Musterkapital Seedfonds I" }));
    const r = await json(
      await post(
        `/organisationen/${FIRMA}/finanzierungsrunden`,
        runde([
          { fondsId: F1, betrag: "1000000.00", anteile: "100000", rolle: "lead" },
          { vehikelId: v1.id, betrag: "500000.00", anteile: "50000", rolle: "co" },
        ]),
        bearbeiterF1,
      ),
    );
    const sichtbar = (await json(await get(`/organisationen/${INV}/vehikel`, bearbeiterF1))).daten;
    expect(sichtbar[0]).toMatchObject({ anzahlPositionen: 1 });
    expect(sichtbar[0].positionen).toEqual([
      { id: expect.any(String), rundeId: r.id, runde: "Serie A", datum: "2026-03-15", status: "entwurf", unternehmen: { id: FIRMA, name: "Alpha Beispiel" }, betrag: "500000.00", anteile: "50000", rolle: "co" },
    ]);
    // Fonds Zwei hat weder Beteiligung noch Position am Unternehmen: das Vehikel ja, seine Positionen nicht
    const fremd = (await json(await get(`/organisationen/${INV}/vehikel`, betrachterF2))).daten;
    expect(fremd[0]).toMatchObject({ name: "Musterkapital Seedfonds I", anzahlPositionen: 0, positionen: [] });

    // Rechtemodell: Vehikel gehören zu Kontakte, die Positionen je Vehikel zum Portfolio. Eine Gruppe nur mit Kontakte sieht Vehikel ohne Positionen.
    const nurKontakte = person("vehikel-nur-kontakte");
    const pid = await legePersonAn(db, nurKontakte);
    const rolle = await json(await post("/rechte/rollen", { name: "Kontaktpflege", bereiche: ["kontakte"] }, "a"));
    expect((await post("/rechte/gruppen", { name: "Kontakte", stufe: "betrachter", rollenIds: [rolle.id], mitglieder: [pid] }, "a")).status).toBe(201);
    const kontaktSicht = await get(`/organisationen/${INV}/vehikel`, nurKontakte);
    expect(kontaktSicht.status).toBe(200);
    expect((await json(kontaktSicht)).daten[0]).toMatchObject({ anzahlPositionen: 0, positionen: [] });
    expect((await get("/vehikel?suche=muster", nurKontakte)).status).toBe(200);
    // Runden bleiben dem Bereich Portfolio vorbehalten
    expect((await get(`/organisationen/${FIRMA}/finanzierungsrunden`, nurKontakte)).status).toBe(403);
  });

  it("Positionen je Vehikel nur an Fonds mit Bereich Portfolio, nicht an Fonds mit nur Kontakte", async () => {
    const v1 = await json(await vehikelAnlegen({ name: "Musterkapital Seedfonds I" }));
    const r = await post(`/organisationen/${FIRMA}/finanzierungsrunden`, runde([{ vehikelId: v1.id, betrag: "500000.00", anteile: "50000", rolle: "co" }, { fondsId: F1, betrag: "1000000.00", anteile: "100000", rolle: "lead" }]), bearbeiterF1);
    expect(r.status).toBe(201);
    const rolle = await json(await post("/rechte/rollen", { name: "Kontakte und Portfolio", bereiche: ["kontakte", "portfolio"] }, "a"));
    const gruppe = (name: string, fondsBereiche: Record<string, string[]>, mitglied: string) =>
      post("/rechte/gruppen", { name, stufe: "betrachter", fondsBeschraenkt: true, bereicheJeFonds: true, fondsIds: Object.keys(fondsBereiche), fondsBereiche, rollenIds: [rolle.id], mitglieder: [mitglied] }, "a");
    // Kontakte an Fonds Eins, Portfolio nur an Fonds Zwei: Vehikel ja, Positionen von Fonds Eins nein
    const getrennt = person("vehikel-getrennt");
    expect((await gruppe("Getrennt", { [F1]: ["kontakte"], [F2]: ["portfolio"] }, await legePersonAn(db, getrennt))).status).toBe(201);
    const ohne = await get(`/organisationen/${INV}/vehikel`, getrennt);
    expect(ohne.status).toBe(200);
    expect((await json(ohne)).daten[0]).toMatchObject({ name: "Musterkapital Seedfonds I", anzahlPositionen: 0, positionen: [] });
    // Portfolio an Fonds Eins: die Positionen erscheinen
    const mit = person("vehikel-mit-portfolio");
    expect((await gruppe("Mit Portfolio", { [F1]: ["kontakte", "portfolio"] }, await legePersonAn(db, mit))).status).toBe(201);
    expect((await json(await get(`/organisationen/${INV}/vehikel`, mit))).daten[0]).toMatchObject({ anzahlPositionen: 1 });
    // Nur Kontakte an Fonds Eins, nirgends Portfolio: Anzahl 0; Löschen bleibt am Server gesperrt
    const nurKontakte = person("vehikel-nur-kontakte-anzahl");
    expect((await gruppe("Nur Kontakte", { [F1]: ["kontakte"] }, await legePersonAn(db, nurKontakte))).status).toBe(201);
    expect((await json(await get(`/organisationen/${INV}/vehikel`, nurKontakte))).daten[0]).toMatchObject({ anzahlPositionen: 0, positionen: [] });
    expect((await loesche(`/vehikel/${v1.id}`, undefined, bearbeiterF1)).status).toBe(409);
  });

  it("Position einem anderen Vehikel desselben Investors zuordnen: Erfolg, fremder Investor, Kollision, Fonds-Position, abgeschlossene Runde, Protokoll", async () => {
    const v1 = await json(await vehikelAnlegen({ name: "Musterkapital Seedfonds I" }));
    const v2 = await json(await vehikelAnlegen({ name: "Musterkapital Wachstumsfonds III" }));
    const v3 = await json(await vehikelAnlegen({ name: "Musterkapital Spezialfonds" }));
    const fremd = await json(await vehikelAnlegen({ name: "Beispiel Fonds" }, INV_OHNE));
    const r = await json(
      await post(
        `/organisationen/${FIRMA}/finanzierungsrunden`,
        runde([
          { fondsId: F1, betrag: "1000000.00", anteile: "100000", rolle: "lead" },
          { vehikelId: v1.id, betrag: "600000.00", anteile: "60000", rolle: "co" },
          { vehikelId: v2.id, betrag: "400000.00", anteile: "40000", rolle: "co" },
        ]),
        bearbeiterF1,
      ),
    );
    const position = (vehikelId: string) => r.positionen.find((p: { vehikel: { id: string } | null }) => p.vehikel?.id === vehikelId);
    const p1 = position(v1.id);
    const fonds = r.positionen.find((p: { vehikel: unknown }) => p.vehikel === null);
    const aendern = (positionId: string, koerper: unknown, rundeId = r.id) => patch(`/finanzierungsrunden/${rundeId}/positionen/${positionId}`, koerper, bearbeiterF1);

    // Anderes Vehikel desselben Investors: Erfolg, nur das Vehikel ändert sich, Protokoll mit vorher und nachher
    const ok = await aendern(p1.id, { vehikelId: v3.id });
    expect(ok.status).toBe(200);
    const nachher = (await json(ok)).positionen.find((p: { id: string }) => p.id === p1.id);
    expect(nachher).toMatchObject({ vehikel: { id: v3.id }, betrag: "600000.00", anteile: "60000", rolle: "co", investor: { id: INV } });
    const eintraege = await protokollZeilen(db, "rundenposition", "aendern");
    expect(eintraege).toHaveLength(1);
    // Dasselbe Vehikel noch einmal ist kein Fehler
    expect((await aendern(p1.id, { vehikelId: v3.id })).status).toBe(200);

    // Vehikel eines anderen Investors: eigener Fehlercode
    const andererInvestor = await aendern(p1.id, { vehikelId: fremd.id });
    expect(andererInvestor.status).toBe(422);
    expect((await json(andererInvestor)).fehler.code).toBe("VEHIKEL_ANDERER_INVESTOR");
    expect((await aendern(p1.id, { vehikelId: "00000000-0000-4000-8000-00000000ffff" })).status).toBe(404);

    // Kollision: das Vehikel hat in der Runde schon eine Position
    const kollision = await aendern(p1.id, { vehikelId: v2.id });
    expect(kollision.status).toBe(409);
    expect((await json(kollision)).fehler.code).toBe("RUNDENPOSITION_VORHANDEN");

    // Positionen eigener Fonds haben kein Vehikel
    const ohneVehikel = await aendern(fonds.id, { vehikelId: v3.id });
    expect(ohneVehikel.status).toBe(409);
    expect((await json(ohneVehikel)).fehler.code).toBe("RUNDENPOSITION_OHNE_VEHIKEL");

    // Abgeschlossene Runde: nur das Vehikel ist änderbar, alles andere nicht
    expect((await post(`/finanzierungsrunden/${r.id}/abschliessen`, { fondsBuchungen: [] }, bearbeiterF1)).status).toBe(200);
    const geschlossen = await aendern(p1.id, { vehikelId: v1.id });
    expect(geschlossen.status).toBe(200);
    expect((await json(geschlossen)).positionen.find((p: { id: string }) => p.id === p1.id)).toMatchObject({ vehikel: { id: v1.id }, betrag: "600000.00" });
    const betragGesperrt = await aendern(p1.id, { betrag: "1.00" });
    expect(betragGesperrt.status).toBe(409);
    expect((await json(betragGesperrt)).fehler.code).toBe("RUNDE_NICHT_ENTWURF");
    expect((await aendern(p1.id, { vehikelId: v1.id, betrag: "1.00" })).status).toBe(409);

    // Bereich Portfolio nötig
    const nurKontakte = person("vehikel-zuordnen-nur-kontakte");
    const pid = await legePersonAn(db, nurKontakte);
    const rolle = await json(await post("/rechte/rollen", { name: "Kontaktpflege", bereiche: ["kontakte"] }, "a"));
    expect((await post("/rechte/gruppen", { name: "Kontakte", stufe: "bearbeiter", rollenIds: [rolle.id], mitglieder: [pid] }, "a")).status).toBe(201);
    expect((await patch(`/finanzierungsrunden/${r.id}/positionen/${p1.id}`, { vehikelId: v3.id }, nurKontakte)).status).toBe(403);
  });

  it("Zusammenführen: gleichnamige Vehikel verschmelzen (Positionen wandern), andere ziehen ohne Standard-Kennzeichen um", async () => {
    const ziel = await json(await vehikelAnlegen({ name: "Gemeinsamer Fonds" }));
    const gleich = await json(await vehikelAnlegen({ name: "Gemeinsamer Fonds" }, INV_OHNE));
    const anderes = await json(await vehikelAnlegen({ name: "Eigener Fonds" }, INV_OHNE));
    const [r] = await db
      .insert(s.finanzierungsrunde)
      .values({ organisationId: FIRMA, bezeichnung: "Seed", datum: "2025-01-01", preMoney: "1000000.00", postMoney: "1200000.00", preisJeAnteil: "10.0000", anteileGesamtNach: "120000" })
      .returning();
    const [p1] = await db.insert(s.rundenposition).values({ rundeId: r!.id, vehikelId: gleich.id, betrag: "100000.00", anteile: "10000", rolle: "co" }).returning();
    await db.insert(s.rundenposition).values({ rundeId: r!.id, vehikelId: anderes.id, betrag: "100000.00", anteile: "10000", rolle: "co" });
    const vorschau = await json(await post(`/organisationen/${INV}/zusammenfuehren/vorschau`, { quelleId: INV_OHNE }, "a"));
    expect(vorschau.verschiebt.rundenpositionen).toBe(2);
    const antwort = await post(`/organisationen/${INV}/zusammenfuehren`, { quelleId: INV_OHNE }, "a");
    expect(antwort.status).toBe(200);
    expect((await json(antwort)).verschoben.rundenpositionen).toBe(2);
    const nachher = await db.select().from(s.vehikel).where(eq(s.vehikel.investorId, INV));
    expect(nachher.map((v) => [v.name, v.standard]).sort()).toEqual([["Eigener Fonds", false], ["Gemeinsamer Fonds", true]]);
    const [p1neu] = await db.select().from(s.rundenposition).where(eq(s.rundenposition.id, p1!.id));
    expect(p1neu!.vehikelId).toBe(ziel.id);
    expect(await db.select().from(s.vehikel).where(eq(s.vehikel.id, gleich.id))).toEqual([]);
  });
  it("Zusammenführen mit Kollision: Haben gleichnamige Vehikel Positionen in derselben Runde, lehnt die API mit 409 ab und ändert nichts", async () => {
    const ziel = await json(await vehikelAnlegen({ name: "Gemeinsamer Fonds" }));
    const gleich = await json(await vehikelAnlegen({ name: "Gemeinsamer Fonds" }, INV_OHNE));
    const [r] = await db
      .insert(s.finanzierungsrunde)
      .values({ organisationId: FIRMA, bezeichnung: "Seed", datum: "2025-01-01", preMoney: "1000000.00", postMoney: "1200000.00", preisJeAnteil: "10.0000", anteileGesamtNach: "120000" })
      .returning();
    await db.insert(s.rundenposition).values([
      { rundeId: r!.id, vehikelId: ziel.id, betrag: "100000.00", anteile: "10000", rolle: "co" as const },
      { rundeId: r!.id, vehikelId: gleich.id, betrag: "50000.00", anteile: "5000", rolle: "co" as const },
    ]);
    const antwort = await post(`/organisationen/${INV}/zusammenfuehren`, { quelleId: INV_OHNE }, "a");
    expect(antwort.status).toBe(409);
    const fehler = (await json(antwort)).fehler;
    expect(fehler.code).toBe("VEHIKEL_POSITION_KOLLIDIERT");
    expect(fehler.kollisionen).toEqual([{ rundeId: r!.id, vehikel: "Gemeinsamer Fonds" }]);
    // nichts verändert: beide Vehikel und beide Positionen bestehen, die Quelle ist nicht zusammengeführt
    expect(await db.select().from(s.vehikel).where(eq(s.vehikel.id, gleich.id))).toHaveLength(1);
    expect(await db.select().from(s.rundenposition).where(eq(s.rundenposition.vehikelId, gleich.id))).toHaveLength(1);
    const [quelle] = await db.select().from(s.organisation).where(eq(s.organisation.id, INV_OHNE));
    expect(quelle!.zusammengefuehrtIn).toBeNull();
  });

  it("Datenbank: je Runde höchstens eine Position je Vehikel und je Fonds", async () => {
    const v = await json(await vehikelAnlegen({ name: "Indexfonds" }));
    const [r] = await db
      .insert(s.finanzierungsrunde)
      .values({ organisationId: FIRMA, bezeichnung: "Seed", datum: "2025-01-01", preMoney: "1000000.00", postMoney: "1200000.00", preisJeAnteil: "10.0000", anteileGesamtNach: "120000" })
      .returning();
    const [r2] = await db
      .insert(s.finanzierungsrunde)
      .values({ organisationId: FIRMA, bezeichnung: "Serie A", datum: "2026-01-01", preMoney: "5000000.00", postMoney: "6000000.00", preisJeAnteil: "20.0000", anteileGesamtNach: "300000" })
      .returning();
    const position = (rundeId: string, ziel: { vehikelId: string } | { fondsId: string }) => ({ rundeId, ...ziel, betrag: "1000.00", anteile: "100", rolle: "co" as const });
    await db.insert(s.rundenposition).values([position(r!.id, { vehikelId: v.id }), position(r!.id, { fondsId: F1 })]);
    await expect(db.insert(s.rundenposition).values(position(r!.id, { vehikelId: v.id }))).rejects.toThrow();
    await expect(db.insert(s.rundenposition).values(position(r!.id, { fondsId: F1 }))).rejects.toThrow();
    // in einer anderen Runde und mit anderem Fonds geht es
    await db.insert(s.rundenposition).values([position(r2!.id, { vehikelId: v.id }), position(r2!.id, { fondsId: F1 }), position(r!.id, { fondsId: F2 })]);
    expect(await db.select().from(s.rundenposition).where(eq(s.rundenposition.rundeId, r!.id))).toHaveLength(3);
  });
});
