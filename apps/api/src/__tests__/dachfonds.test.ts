import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { ladeFondsberichtDaten } from "../berichte/daten";
import { berechneFondsUebersicht, juengsterEingang } from "../kennzahlen/fonds";
import { leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, person } from "./hilfen-auth";
import { buchhaltungAufsetzen, uebernehmeSalden } from "./hilfen-buchhaltung";
import { aufrufe, grundbestand, ID, json } from "./hilfen-instrumente";

// Dachfonds (Issue #160), Manager-Profil mit Hauswährung (#159) und Portfolio-Dashboard (#147). Erwartungswerte von Hand gerechnet.

const { db, pool } = oeffneTestdb();
const { get, post, put, patch } = aufrufe(erstelleTestApp(db));
const ZIEL = ID.fonds; // Zielfonds derselben Installation (NAV 1.500,00 am 30.06.2025)
const DACH = ID.anderer; // Dachfonds
const q2 = "2025-06-30";

async function legeZielfondsAn(name: string, targetFundId?: string) {
  const r = await post(`/fonds/${DACH}/target-funds`, { name, ...(targetFundId ? { targetFundId } : {}) });
  expect(r.status).toBe(201);
  return (await json(r)).id as string;
}
const bewegung = (id: string, type: string, valueDate: string, amount: string) => post(`/fonds/${DACH}/target-funds/${id}/movements`, { type, valueDate, amount });
const meldung = (id: string, body: Record<string, unknown>) => post(`/fonds/${DACH}/target-funds/${id}/nav-reports`, body);

let extern = "";
let intern = "";

function ohneZieldetails(daten: unknown) {
  for (const privat of [intern, ZIEL, "Eigener Zielfonds", "Testfonds Eins", '"1500"', '"1500.00"']) expect(JSON.stringify(daten)).not.toContain(privat);
}

beforeEach(async () => {
  await grundbestand(db);
  for (const f of [ZIEL, DACH]) await buchhaltungAufsetzen(db, f);
  await db.insert(s.bewertung).values({ beteiligungId: ID.eigen, stichtag: "2025-03-31", wert: "1000.00", methode: "letzte_runde", status: "freigegeben", freigegebenAm: new Date("2025-04-01") });
  await uebernehmeSalden(db, ZIEL, q2, { "0100": "1000.00", "1200": "500.00", "2000": "-1500.00" });
  await uebernehmeSalden(db, DACH, q2, { "0100": "800.00", "1200": "2000.00", "2000": "-2800.00" });

  extern = await legeZielfondsAn("Fremder Zielfonds");
  for (const [t, d, b] of [["commitment", "2025-01-15", "1000"], ["capital_call", "2025-02-01", "400"], ["capital_call", "2025-05-01", "100"], ["distribution", "2025-06-01", "50"]] as const) expect((await bewegung(extern, t, d, b)).status).toBe(201);
  expect((await meldung(extern, { asOf: "2025-03-31", nav: "450.00" })).status).toBe(201);

  intern = await legeZielfondsAn("Eigener Zielfonds", ZIEL);
  for (const [t, d, b] of [["commitment", "2025-01-15", "2000"], ["capital_call", "2025-02-01", "300"]] as const) expect((await bewegung(intern, t, d, b)).status).toBe(201);
  expect((await meldung(intern, { asOf: "2025-03-31", share: "0.1" })).status).toBe(201);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Zielfonds eines Dachfonds", () => {
  it("rechnet Werte mit Herkunft: fortgeschriebene NAV-Meldung und Durchrechnung eines eigenen Zielfonds", async () => {
    const r = await get(`/fonds/${DACH}/target-funds?asOf=${q2}`);
    expect(r.status).toBe(200);
    const d = await json(r);
    const fremd = d.data.find((x: { id: string }) => x.id === extern);
    // 450 + 100 (Abruf nach der Meldung) − 50 (Ausschüttung) = 500
    expect(fremd.metrics.value).toMatchObject({ value: "500.00", method: "reported_nav" });
    expect(fremd.metrics.unfunded.value).toBe("500.00");
    // TVPI = (500 + 50) / 500 = 1,1
    expect(fremd.metrics.tvpi.value).toBe("1.1");
    const eigen = d.data.find((x: { id: string }) => x.id === intern);
    // NAV des Zielfonds 1.500 × 0,1 = 150
    expect(eigen.metrics.value).toMatchObject({ value: "150.00", method: "look_through" });
    expect(eigen.targetFundName).toBe("Testfonds Eins");
    expect(eigen.metrics.value.steps[0].value).toBe("1500");
    expect(d.totals).toMatchObject({ commitment: "3000.00", called: "800.00", distributed: "50.00", value: "650.00" });
  });

  it("nimmt die Zielfonds als eigenen Schritt in die NAV des Dachfonds auf, andere Fonds bleiben unverändert", async () => {
    const dach = await berechneFondsUebersicht(db, DACH, q2);
    // Portfoliowert 0 + Zielfonds 650 + Bank 2.000 = 2.650 (das Konto 0100 der Finanzanlagen zählt nicht, der Wert kommt aus der Rechnung)
    expect(dach.kennzahlen.nav.wert).toBe("2650");
    expect(dach.kennzahlen.nav.schritte.map((x) => x.bezeichnung)).toContain("Anteile an Zielfonds (durchgerechnet oder fortgeschriebene NAV-Meldung)");
    const ziel = await berechneFondsUebersicht(db, ZIEL, q2);
    expect(ziel.kennzahlen.nav.wert).toBe("1500");
    expect(ziel.kennzahlen.nav.schritte.some((x) => x.bezeichnung.startsWith("Anteile an Zielfonds"))).toBe(false);
  });

  it("macht Snapshots des Dachfonds veraltet, wenn sich die Daten des eigenen Zielfonds ändern", async () => {
    const vorher = await juengsterEingang(db, DACH);
    await new Promise((r) => setTimeout(r, 5));
    await db.insert(s.bewertung).values({ beteiligungId: ID.eigen, stichtag: q2, wert: "1100.00", methode: "letzte_runde", status: "freigegeben", freigegebenAm: new Date() });
    expect((await juengsterEingang(db, DACH))! > vorher!).toBe(true);
  });

  it("storniert eine Bewegung und lehnt ein zweites Storno ab", async () => {
    const detail = await json(await get(`/fonds/${DACH}/target-funds/${extern}?asOf=${q2}`));
    const ausschuettung = detail.movements.find((m: { type: string }) => m.type === "distribution");
    expect((await post(`/fonds/${DACH}/target-funds/${extern}/movements/${ausschuettung.id}/reverse`, {})).status).toBe(201);
    const zweites = await post(`/fonds/${DACH}/target-funds/${extern}/movements/${ausschuettung.id}/reverse`, {});
    expect(zweites.status).toBe(409);
    expect((await json(zweites)).error.code).toBe("already_reversed");
    const nachher = await json(await get(`/fonds/${DACH}/target-funds?asOf=${q2}`));
    expect(nachher.data.find((x: { id: string }) => x.id === extern).metrics.value.value).toBe("550.00");
  });

  it("prüft Eingaben: kein Fonds an sich selbst, kein Zielfonds doppelt, Meldung braucht NAV oder Anteil", async () => {
    const selbst = await post(`/fonds/${DACH}/target-funds`, { name: "Selbst", targetFundId: DACH });
    expect((await json(selbst)).error.code).toBe("target_fund_self");
    const doppelt = await post(`/fonds/${DACH}/target-funds`, { name: "Noch mal", targetFundId: ZIEL });
    expect((await json(doppelt)).error.code).toBe("target_fund_exists");
    expect((await meldung(extern, { asOf: "2025-06-30" })).status).toBe(400);
    const fremd = await get(`/fonds/${ZIEL}/target-funds/${extern}`);
    expect((await json(fremd)).error.code).toBe("target_fund_not_found");
  });

  it("verlangt Leserecht am eigenen Zielfonds: sonst kein Verknüpfen und keine Details der Durchrechnung", async () => {
    const nurDach = person("nurdach", { rollen: { [DACH]: "bearbeiter" } });
    const r = await patch(`/fonds/${DACH}/target-funds/${extern}`, { name: "Umbenannt" }, nurDach);
    expect(r.status).toBe(200);
    const verknuepfen = await post(`/fonds/${DACH}/target-funds`, { name: "Versuch", targetFundId: ZIEL }, nurDach);
    expect(verknuepfen.status).toBe(404);
    expect((await json(verknuepfen)).error.code).toBe("fund_not_found");
    const liste = await json(await get(`/fonds/${DACH}/target-funds?asOf=${q2}`, nurDach));
    expect(liste.data.find((x: { id: string | null }) => x.id === null)).toEqual({ id: null, name: "Zielfonds", metrics: { value: { value: "150.00" } } });
    expect(liste.totals.value).toBe("650.00");
    ohneZieldetails(liste);
    const detail = await get(`/fonds/${DACH}/target-funds/${intern}?asOf=${q2}`, nurDach);
    expect(detail.status).toBe(404);
    expect((await json(detail)).error.code).toBe("target_fund_not_found");
    // Schreiben an der Beteiligung mit eigenem Zielfonds verlangt ebenfalls Leserecht am Zielfonds.
    expect((await post(`/fonds/${DACH}/target-funds/${intern}/nav-reports`, { asOf: q2, share: "0.5" }, nurDach)).status).toBe(404);
    expect((await post(`/fonds/${DACH}/target-funds/${intern}/movements`, { type: "capital_call", valueDate: q2, amount: "10" }, nurDach)).status).toBe(404);
    const abruf = (await json(await get(`/fonds/${DACH}/target-funds/${intern}?asOf=${q2}`))).movements.find((m: { type: string }) => m.type === "capital_call");
    expect((await post(`/fonds/${DACH}/target-funds/${intern}/movements/${abruf.id}/reverse`, {}, nurDach)).status).toBe(404);
    expect((await patch(`/fonds/${DACH}/target-funds/${intern}`, { name: "Neu" }, nurDach)).status).toBe(404);
  });
});

describe("Durchrechnung: Kreise, Tiefe und Sicht", () => {
  const F3 = "00000000-0000-4000-8000-0000000000f3";
  const F4 = "00000000-0000-4000-8000-0000000000f4";
  const F5 = "00000000-0000-4000-8000-0000000000f5";
  const weitereFonds = () =>
    db.insert(s.fonds).values([
      { id: F3, name: "Testfonds Drei", kurzname: "TF3", vintage: 2024, zeichnungskapital: "1000.00" },
      { id: F4, name: "Testfonds Vier", kurzname: "TF4", vintage: 2024, zeichnungskapital: "1000.00" },
      { id: F5, name: "Testfonds Fünf", kurzname: "TF5", vintage: 2024, zeichnungskapital: "1000.00" },
    ]);
  const verknuepfe = (von: string, nach: string) => post(`/fonds/${von}/target-funds`, { name: `Anteil ${nach.slice(-2)}`, targetFundId: nach });

  it("weist Kreise ab (Ring) und begrenzt die Kette auf drei Ebenen", async () => {
    await weitereFonds();
    const ring = await verknuepfe(ZIEL, DACH);
    expect(ring.status).toBe(409);
    expect((await json(ring)).error.code).toBe("target_fund_cycle");
    // DACH → ZIEL besteht; ZIEL → F3 → F4 ergibt drei Ebenen, F4 → F5 wäre die vierte.
    expect((await verknuepfe(ZIEL, F3)).status).toBe(201);
    expect((await verknuepfe(F3, F4)).status).toBe(201);
    const tief = await verknuepfe(F4, F5);
    expect((await json(tief)).error.code).toBe("target_fund_too_deep");
    const indirekt = await verknuepfe(F4, DACH);
    expect((await json(indirekt)).error.code).toBe("target_fund_cycle");
  });

  it("rechnet eine Raute (zwei Wege zum selben Zielfonds) über beide Wege durch", async () => {
    await weitereFonds();
    await buchhaltungAufsetzen(db, F3);
    await uebernehmeSalden(db, F3, q2, { "1200": "1000.00", "2000": "-1000.00" });
    // DACH → ZIEL (0,1) besteht. Dazu DACH → F3 (Anteil 0,5) und ZIEL → F3 (Anteil 0,2): F3 ist über zwei Wege erreichbar.
    const nurDach = person("dach-raute", { rollen: { [DACH]: "betrachter" } });
    const dachF3 = (await json(await verknuepfe(DACH, F3))).id;
    expect((await meldung(dachF3, { asOf: "2025-03-31", share: "0.5" })).status).toBe(201);
    const pfad = `/fonds/${DACH}/uebersicht?stichtag=${q2}`;
    expect((await json(await get(pfad, nurDach))).kennzahlen.nav.wert).toBe("3150");
    const zielF3 = (await json(await post(`/fonds/${ZIEL}/target-funds`, { name: "Anteil F3", targetFundId: F3 }))).id;
    expect((await post(`/fonds/${ZIEL}/target-funds/${zielF3}/nav-reports`, { asOf: "2025-03-31", share: "0.2" })).status).toBe(201);
    // ZIEL: 1.500 + 0,2 × 1.000 = 1.700; DACH: 500 + 0,1 × 1.700 + 0,5 × 1.000 + 2.000 = 3.170
    expect((await berechneFondsUebersicht(db, ZIEL, q2)).kennzahlen.nav.wert).toBe("1700");
    expect((await berechneFondsUebersicht(db, DACH, q2)).kennzahlen.nav.wert).toBe("3170");
    const aktuell = await json(await get(pfad, nurDach));
    expect(aktuell.kennzahlen.nav.wert).toBe("3170");
    expect(aktuell.kennzahlen.nav.schritte.filter((s: { bezeichnung: string }) => s.bezeichnung === "Zielfonds")).toEqual([{ zeichen: "+", bezeichnung: "Zielfonds", wert: "670.00" }]);
    ohneZieldetails(aktuell);
    expect(JSON.stringify(aktuell)).not.toContain(F3);
  });

  it("zeigt dieselbe NAV im gemeinsamen Snapshot, zum Wissensstand, im Bericht und im Bewertungsszenario", async () => {
    const nurDach = person("nurdach3", { rollen: { [DACH]: "betrachter" } });
    const pfad = `/fonds/${DACH}/uebersicht?stichtag=${q2}`;
    const voll = await json(await get(pfad));
    const snapshot = await json(await get(pfad, nurDach));
    expect(snapshot.snapshot).toEqual(voll.snapshot);
    expect(snapshot.snapshot).not.toBeNull();
    const stand = snapshot.quellenstand;
    const live = await json(await get(`${pfad}&stand=${encodeURIComponent(stand)}`, nurDach));
    for (const u of [snapshot, live]) {
      expect(u.kennzahlen.nav.wert).toBe("2650");
      expect(u.kennzahlen.nav.schritte).toContainEqual({ zeichen: "+", bezeichnung: "Zielfonds", wert: "150.00" });
      ohneZieldetails(u);
    }
    expect(voll.kennzahlen.nav.schritte).toContainEqual({ zeichen: "+", bezeichnung: "Eigener Zielfonds", wert: "150.00", quellen: [intern] });
    const einzelPfad = `/fonds/${DACH}/nav-einzelwerte?stichtag=${q2}&stand=${encodeURIComponent(stand)}`;
    const einzel = await json(await get(einzelPfad, nurDach));
    expect(einzel.zielfonds).toContainEqual({ id: null, name: "Zielfonds", wert: "150.00" });
    ohneZieldetails(einzel);
    expect((await json(await get(einzelPfad))).zielfonds).toContainEqual({ id: intern, name: "Eigener Zielfonds", wert: "150.00" });
    const waehrung = await json(await get(`/fonds/${DACH}/waehrungssicht?stichtag=${q2}&vergleich=EUR`, nurDach));
    expect(waehrung.navVergleich).toBe("2650.00");
    ohneZieldetails(waehrung);
    const bericht = await ladeFondsberichtDaten(db, DACH, q2, stand, stand);
    expect(bericht?.kennzahlen.nav.wert).toBe(snapshot.kennzahlen.nav.wert);
    ohneZieldetails(bericht);
    const szenario = await json(await post(`/fonds/${DACH}/szenarien`, { name: "Dachfonds", basisStichtag: q2, annahmen: { bewertung: { beteiligungen: {} } } }));
    const ansicht = await json(await get(`/szenarien/${szenario.id}`, nurDach));
    expect(ansicht.ergebnis.bewertungsszenario.aktuell.nav).toBe("2650.00");
    ohneZieldetails(ansicht);
  });
});

describe("Manager-Profil und Portfolio-Dashboard", () => {
  it("setzt die Hauswährung nur als globaler Verwalter", async () => {
    const verboten = await put("/manager-profile", { homeCurrency: "USD" }, person("betrachterin", { rollen: { [ZIEL]: "verwalter" } }));
    expect(verboten.status).toBe(403);
    const r = await put("/manager-profile", { name: "Beispiel Kapital", homeCurrency: "CHF" });
    expect(r.status).toBe(200);
    expect(await json(r)).toMatchObject({ name: "Beispiel Kapital", homeCurrency: "CHF" });
    expect((await put("/manager-profile", { homeCurrency: "chf" })).status).toBe(400);
  });

  it("summiert über alle sichtbaren Fonds ohne Doppelzählung des eigenen Zielfonds", async () => {
    const d = await json(await get(`/manager-profile?asOf=${q2}`));
    expect(d.homeCurrency).toBe("EUR");
    expect(d.funds.map((f: { fundId: string }) => f.fundId).sort()).toEqual([ZIEL, DACH].sort());
    // 1.500 + 2.650 − 150 (Anteil des Dachfonds am Zielfonds) = 4.000
    expect(d.totals.nav.value).toBe("4000.00");
    expect(d.internalHoldings).toEqual([expect.objectContaining({ id: intern, eliminated: true })]);
    expect(d.totals.nav.steps.find((x: { operator: string }) => x.operator === "−")).toMatchObject({ value: "150", sources: [intern] });
  });

  it("zieht Zahlungen nur ab, wenn der Dachfonds im Zielfonds als Investor erfasst ist", async () => {
    const ohne = await json(await get(`/manager-profile?asOf=${q2}`));
    // Keine Investorenzahlen in beiden Fonds und keine Verknüpfung: nichts abzuziehen, der Wert des Anteils schon.
    expect(ohne.totals.paidIn.value).toBe("0.00");
    expect(ohne.totals.commitment.value).toBe("0.00");
    expect(ohne.internalHoldings[0]).toMatchObject({ eliminated: true, investorRecord: false });
    await db.insert(s.fondsZeichnung).values({ fondsId: ZIEL, organisationId: ID.orgC, zusage: "2000", anteil: "1" });
    expect((await patch(`/fonds/${DACH}/target-funds/${intern}`, { investorOrganizationId: ID.orgC })).status).toBe(200);
    expect((await patch(`/fonds/${DACH}/target-funds/${extern}`, { investorOrganizationId: ID.orgC })).status).toBe(400);
    const mit = await json(await get(`/manager-profile?asOf=${q2}`));
    expect(mit.internalHoldings[0]).toMatchObject({ investorRecord: true });
    // Zusage des Zielfonds 2.000 (Zeichnung) − Zusage des Dachfonds an ihn 2.000 = 0
    expect(mit.totals.commitment.value).toBe("0.00");
    expect(mit.totals.paidIn.steps.find((x: { operator: string }) => x.operator === "−")).toMatchObject({ value: "300", sources: [intern] });
  });

  it("nimmt ohne Angabe das jüngste Periodenende einer übernommenen Saldenliste als Stichtag", async () => {
    const d = await json(await get("/manager-profile"));
    expect(d.asOf).toBe(q2);
  });

  it("zeigt den durchgerechneten Wert in Allokation und Verlauf ohne Einzelheiten zum Zielfonds", async () => {
    const nurDach = person("nurdach2", { rollen: { [DACH]: "betrachter" } });
    const d = await json(await get(`/portfolio/dashboard?asOf=${q2}&quarters=1`, nurDach));
    // Fremder Zielfonds 500 + eigener Zielfonds 150
    expect(d.allocation.sector.find((g: { type: string }) => g.type === "target_funds")).toMatchObject({ count: 2, fairValue: "650.00" });
    expect(d.history.funds[0].points.at(-1).portfolioValue).toBe("650.00");
    expect(d.history.total.at(-1).nav).toBe("2650.00");
    ohneZieldetails(d);
  });

  it("hält Lücken der Hauswährung getrennt von den übrigen Sichten", async () => {
    expect((await put("/manager-profile", { homeCurrency: "CHF" })).status).toBe(200);
    const d = await json(await get(`/fonds/${ZIEL}/waehrungssicht?stichtag=${q2}`));
    expect(d.waehrungen.haus).toBe("CHF");
    expect(d.summen.bewertung.haus).toBeNull();
    expect(d.hausLuecken.length).toBeGreaterThan(0);
    expect(d.luecken).toEqual([]);
    const profil = await json(await get(`/manager-profile?asOf=${q2}`));
    expect(profil.totals.nav.value).toBeNull();
    expect(profil.gaps.length).toBeGreaterThan(0);
  });

  it("rechnet nur sichtbare Fonds und bereinigt nichts, wenn der Zielfonds nicht sichtbar ist", async () => {
    const d = await json(await get(`/manager-profile?asOf=${q2}`, person("dachsicht", { rollen: { [DACH]: "betrachter" } })));
    expect(d.funds.map((f: { fundId: string }) => f.fundId)).toEqual([DACH]);
    expect(d.totals.nav.value).toBe("2650.00");
    expect(d.internalHoldings).toEqual([{ id: null, fundId: DACH, name: "Zielfonds", value: "150.00", eliminated: false }]);
    ohneZieldetails(d);
  });

  it("liefert Allokation und Verlauf in der Hauswährung", async () => {
    const r = await get(`/portfolio/dashboard?asOf=${q2}&quarters=2`);
    expect(r.status).toBe(200);
    const d = await json(r);
    expect(d.history.dates).toEqual(["2024-12-31", "2025-03-31", q2]);
    const gesamt = d.history.total.at(-1);
    expect(gesamt.nav).toBe("4000.00");
    expect(d.allocation.sector.some((g: { type: string }) => g.type === "target_funds")).toBe(true);
    // Der eigene Zielfonds zählt nicht in der Allokation (seine Beteiligungen stehen schon darin), der fremde schon (Zeitwert 500).
    const ziel = d.allocation.sector.find((g: { type: string }) => g.type === "target_funds");
    expect(ziel).toMatchObject({ count: 1, fairValue: "500.00", invested: "500.00" });
    expect(d.allocation.fund.find((g: { key: string }) => g.key === ZIEL).fairValue).toBe("1000.00");
  });

  it("zeigt die Hauswährung als weitere Spalte der Währungssicht", async () => {
    const d = await json(await get(`/fonds/${ZIEL}/waehrungssicht?stichtag=${q2}`));
    expect(d.waehrungen.haus).toBe("EUR");
    expect(d.summen.bewertung).toMatchObject({ fonds: "1000.00", haus: "1000.00" });
    // Hauswährung = Fondswährung: keine eigene Umrechnung der NAV (es gilt die NAV der Kennzahlen).
    expect(d.navHaus).toBeNull();
    expect(d.hausLuecken).toEqual([]);
  });
});
