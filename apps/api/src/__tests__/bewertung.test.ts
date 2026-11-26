import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { verarbeiteNeuberechnung } from "../jobs";
import { erstelleTestApp, idVon, person } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { aufrufe, auftraege, grundbestand, ID, json, leereAuftraege, protokollZeilen } from "./hilfen-instrumente";

const { db, pool } = oeffneTestdb();
const { get, post } = aufrufe(erstelleTestApp(db));
const benutzer = (kuerzel: string) => idVon(db, person(kuerzel));

/** Akteur `""` sendet keinen Header (Akteur `system`). */
const neu = (beteiligung: string, koerper: object, akteur = "ersteller") => post(`/beteiligungen/${beteiligung}/bewertungen`, koerper, akteur);
const frei = (id: string, akteur = "pruefer") => post(`/bewertungen/${id}/freigeben`, undefined, akteur);
/** Live gerechnet (mit Wissensstand), damit kein gespeicherter Snapshot dazwischenkommt. */
const portfoliowert = async (stichtag: string, stand = new Date(Date.now() + 5000).toISOString()) =>
  (await json(await get(`/fonds/${ID.fonds}/uebersicht?stichtag=${stichtag}&stand=${encodeURIComponent(stand)}`))).portfoliowert as string;

beforeEach(async () => {
  await grundbestand(db);
  await db.insert(s.fondsBewegung).values({ fondsId: ID.fonds, art: "abruf", valuta: "2025-01-15", betrag: "100000.00" });
  await leereAuftraege(db);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const q1 = { stichtag: "2025-03-31", wert: "120000.00", methode: "letzte_runde", begruendung: "Runde im Quartal" };

describe("Bewertung mit Freigabe", () => {
  it("ein Entwurf zählt nirgends, die Freigabe macht ihn wirksam", async () => {
    const antwort = await neu(ID.eigen, q1);
    expect(antwort.status).toBe(201);
    const d = await json(antwort);
    expect(d.bewertung).toMatchObject({ status: "entwurf", erstelltVon: await benutzer("ersteller"), freigegebenVon: null, wert: "120000.00" });
    expect(await portfoliowert("2025-03-31")).toBe("0.00");
    const detail = await json(await get(`/beteiligungen/${ID.eigen}?stichtag=2025-03-31`));
    expect(detail.bewertungsverlauf).toHaveLength(0);
    expect(detail.kennzahlen.bewertung.wert).toBe("0");

    await leereAuftraege(db);
    const freigabe = await frei(d.bewertung.id);
    expect(freigabe.status).toBe(200);
    expect(await json(freigabe)).toMatchObject({ status: "freigegeben", freigegebenVon: await benutzer("pruefer") });
    expect(await portfoliowert("2025-03-31")).toBe("120000.00");
    expect(await auftraege(db)).toBe(1);
    expect(await protokollZeilen(db, "bewertung", "freigeben")).toHaveLength(1);
  });

  it("Vier-Augen: derselbe Akteur darf nicht freigeben, ohne Akteur ebenfalls nicht", async () => {
    const d = await json(await neu(ID.eigen, q1));
    const selbst = await frei(d.bewertung.id, "ersteller");
    expect(selbst.status).toBe(409);
    expect((await json(selbst)).error.code).toBe("four_eyes_violated");
    const ohne = await json(await neu(ID.darlehen, q1, ""));
    expect((await frei(ohne.bewertung.id, "")).status).toBe(409);
    expect(await portfoliowert("2025-03-31")).toBe("0.00");
  });

  it("Begründung ist bei allen Methoden außer Anschaffungskosten Pflicht", async () => {
    for (const methode of ["letzte_runde", "multiplikator", "dcf", "sonstige"]) {
      const a = await neu(ID.eigen, { stichtag: "2025-03-31", wert: "1.00", methode });
      expect(a.status).toBe(400);
      expect((await json(a)).error.fields[0]).toMatchObject({ field: "begruendung", code: "justification_required" });
    }
    expect((await neu(ID.eigen, { stichtag: "2025-03-31", wert: "1.00", methode: "dcf", begruendung: "   " })).status).toBe(400);
    expect((await neu(ID.eigen, { stichtag: "2025-03-31", wert: "50000.00", methode: "anschaffungskosten" })).status).toBe(201);
    expect((await neu(ID.eigen, { stichtag: "2025-03-31", wert: "-1.00", methode: "anschaffungskosten" })).status).toBe(400);
    expect((await neu("00000000-0000-4000-8000-0000000000ff", q1)).status).toBe(404);
  });

  it("je Stichtag höchstens ein offener Entwurf; ein Entwurf lässt sich verwerfen und danach neu anlegen", async () => {
    const d = await json(await neu(ID.eigen, q1));
    const doppelt = await neu(ID.eigen, q1);
    expect(doppelt.status).toBe(409);
    expect((await json(doppelt)).error.code).toBe("valuation_draft_exists");
    const verworfen = await post(`/bewertungen/${d.bewertung.id}/verwerfen`, undefined, "ersteller");
    expect(await json(verworfen)).toMatchObject({ status: "verworfen" });
    expect((await frei(d.bewertung.id)).status).toBe(409);
    expect((await neu(ID.eigen, q1)).status).toBe(201);
  });

  it("eine Korrektur ersetzt die freigegebene Bewertung, die Historie bleibt, freigegebene Zeilen sind unveränderlich", async () => {
    const erste = await json(await neu(ID.eigen, q1));
    await frei(erste.bewertung.id);
    const vorKorrektur = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 15));

    const korrektur = await json(await neu(ID.eigen, { ...q1, wert: "150000.00", begruendung: "Korrigierte Runde" }));
    expect(korrektur.ersetzt.id).toBe(erste.bewertung.id);
    // Bis zur Freigabe gilt die alte
    expect(await portfoliowert("2025-03-31")).toBe("120000.00");
    await frei(korrektur.bewertung.id);
    expect(await portfoliowert("2025-03-31")).toBe("150000.00");
    // Wissensstand vor der Korrektur: der alte Wert
    expect(await portfoliowert("2025-03-31", vorKorrektur)).toBe("120000.00");

    const zeilen = await db.select().from(s.bewertung).where(eq(s.bewertung.beteiligungId, ID.eigen));
    expect(zeilen).toHaveLength(2);
    const alt = zeilen.find((z) => z.id === erste.bewertung.id)!;
    const geltend = zeilen.find((z) => z.id === korrektur.bewertung.id)!;
    expect(alt).toMatchObject({ status: "ersetzt", wert: "120000.00" });
    expect(alt.ersetztAm).not.toBeNull();
    expect(geltend).toMatchObject({ status: "freigegeben", ersetztBewertungId: alt.id });

    const verlauf = await json(await get(`/beteiligungen/${ID.eigen}/bewertungen`));
    expect(verlauf.daten.map((z: { status: string }) => z.status).sort()).toEqual(["ersetzt", "freigegeben"]);
    expect((await json(await get(`/beteiligungen/${ID.eigen}?stichtag=2025-03-31`))).bewertungsverlauf).toHaveLength(1);

    // Datenbankschutz
    await expect(db.update(s.bewertung).set({ wert: "1.00" }).where(eq(s.bewertung.id, geltend.id))).rejects.toThrow();
    await expect(db.update(s.bewertung).set({ wert: "1.00" }).where(eq(s.bewertung.id, alt.id))).rejects.toThrow();
    await expect(db.delete(s.bewertung).where(eq(s.bewertung.id, geltend.id))).rejects.toThrow();
    await expect(
      db.insert(s.bewertung).values({ beteiligungId: ID.eigen, stichtag: "2025-03-31", wert: "1.00", methode: "sonstige", status: "freigegeben" }),
    ).rejects.toThrow();
  });

  it("wirkt auch auf Stichtage danach: die letzte freigegebene Bewertung gilt, der Entwurf eines späteren Stichtags nicht", async () => {
    const a = await json(await neu(ID.eigen, q1));
    await frei(a.bewertung.id);
    await neu(ID.eigen, { stichtag: "2025-06-30", wert: "999999.00", methode: "dcf", begruendung: "Planung" });
    expect(await portfoliowert("2025-06-30")).toBe("120000.00");
    expect((await json(await get(`/fonds/${ID.fonds}/bewertungen?stichtag=2025-06-30`))).daten).toHaveLength(1);
  });

  it("ein gespeicherter Snapshot gilt nach der Freigabe als veraltet und enthält nach der Neuberechnung die Bewertung", async () => {
    const vorher = await json(await get(`/fonds/${ID.fonds}/uebersicht?stichtag=2025-03-31`));
    expect(vorher.snapshot).toMatchObject({ veraltet: false });
    const d = await json(await neu(ID.eigen, q1));
    await frei(d.bewertung.id);
    const nachher = await json(await get(`/fonds/${ID.fonds}/uebersicht?stichtag=2025-03-31`));
    expect(nachher.snapshot.veraltet).toBe(true);
    const neuBerechnet = await post(`/fonds/${ID.fonds}/neuberechnen?stichtag=2025-03-31`);
    expect(neuBerechnet.status).toBe(202);
    await verarbeiteNeuberechnung(db, { fondsId: ID.fonds, stichtag: "2025-03-31" });
    const danach = await json(await get(`/fonds/${ID.fonds}/uebersicht?stichtag=2025-03-31`));
    expect(danach.snapshot.veraltet).toBe(false);
    expect(danach.portfoliowert).toBe("120000.00");
  });

  it("Systembuchungen (Insolvenz) sind sofort freigegeben und ersetzen die geltende Bewertung", async () => {
    await post(`/investments/${ID.eigen}/transactions`, { type: "commitment", valueDate: "2025-01-01", amount: "100000" });
    await post(`/investments/${ID.eigen}/transactions`, { type: "disbursement", valueDate: "2025-02-01", amount: "100000" });
    const a = await json(await neu(ID.eigen, q1));
    await frei(a.bewertung.id);
    await post(`/beteiligungen/${ID.eigen}/insolvenz`, { datum: "2025-03-31" }, "bearbeiter");
    const zeilen = await db.select().from(s.bewertung).where(and(eq(s.bewertung.beteiligungId, ID.eigen), eq(s.bewertung.stichtag, "2025-03-31")));
    expect(zeilen.map((z) => z.status).sort()).toEqual(["ersetzt", "freigegeben"]);
    const geltend = zeilen.find((z) => z.status === "freigegeben")!;
    expect(geltend).toMatchObject({ wert: "0.00", erstelltVon: await benutzer("bearbeiter"), freigegebenVon: "system:ereignis" });
    expect(await portfoliowert("2025-03-31")).toBe("0.00");
  });
});

describe("Massen-Neubewertung", () => {
  const freigegeben = async (beteiligungId: string, stichtag: string, wert: string, methode: s.Bewertung["methode"] = "letzte_runde") => {
    const d = await json(await neu(beteiligungId, { stichtag, wert, methode, begruendung: "Vorrunde" }, "a"));
    expect((await frei(d.bewertung.id, "b")).status).toBe(200);
  };
  const runde = (koerper: object, akteur = "ersteller") => post(`/fonds/${ID.fonds}/bewertungsrunde`, koerper, akteur);

  it("fortschreiben: Entwürfe für aktive Beteiligungen ohne Bewertung am Stichtag, nur freigegeben zählt, ein Klick gibt alle frei", async () => {
    await freigegeben(ID.eigen, "2025-03-31", "100000.00");
    await freigegeben(ID.darlehen, "2025-03-31", "50000.00", "anschaffungskosten");
    // wandel hat keine frühere Bewertung, eigen hat schon eine zum Stichtag 2025-06-30
    await freigegeben(ID.eigen, "2025-06-30", "130000.00");
    await leereAuftraege(db);

    const antwort = await runde({ stichtag: "2025-06-30", vorschlag: "fortschreiben" });
    expect(antwort.status).toBe(201);
    const d = await json(antwort);
    expect(d.runde).toMatchObject({ status: "entwurf", vorschlag: "fortschreiben", stichtag: "2025-06-30", erstelltVon: await benutzer("ersteller") });
    expect(d.bewertungen).toHaveLength(1);
    expect(d.bewertungen[0]).toMatchObject({ beteiligungId: ID.darlehen, wert: "50000.00", methode: "anschaffungskosten", status: "entwurf", bewertungsrundeId: d.runde.id });
    expect(d.uebersprungen.map((u: { grund: string }) => u.grund).sort()).toEqual(["bewertung_vorhanden", "keine_vorherige_bewertung"]);
    const statusAmStichtag = async () => (await json(await get(`/fonds/${ID.fonds}/bewertungen?stichtag=2025-06-30`))).daten.map((b: { status: string }) => b.status).sort();
    expect(await statusAmStichtag()).toEqual(["entwurf", "freigegeben"]);

    // zweite offene Runde zum selben Stichtag: nicht erlaubt
    expect((await json(await runde({ stichtag: "2025-06-30", vorschlag: "fortschreiben" }))).error.code).toBe("valuation_round_open");

    const selbst = await post(`/bewertungsrunden/${d.runde.id}/freigeben`, undefined, "ersteller");
    expect(selbst.status).toBe(409);
    expect((await json(selbst)).error.code).toBe("four_eyes_violated");
    expect(await statusAmStichtag()).toEqual(["entwurf", "freigegeben"]);

    const ok = await post(`/bewertungsrunden/${d.runde.id}/freigeben`, undefined, "pruefer");
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ freigegeben: 1, runde: { status: "freigegeben", freigegebenVon: await benutzer("pruefer") } });
    expect(await statusAmStichtag()).toEqual(["freigegeben", "freigegeben"]);
    expect(await portfoliowert("2025-06-30")).toBe("180000.00");
    const lesen = await json(await get(`/bewertungsrunden/${d.runde.id}`));
    expect(lesen.bewertungen.every((b: { status: string }) => b.status === "freigegeben")).toBe(true);
    // erneut freigeben: Status ungültig
    expect((await json(await post(`/bewertungsrunden/${d.runde.id}/freigeben`, undefined, "dritter"))).error.code).toBe("valuation_status_invalid");
  });

  it("letzte_runde: Preis je Anteil der letzten Runde mal Anteile des Fonds; ohne Anteile wird fortgeschrieben", async () => {
    const r1 = "00000000-0000-4000-8000-0000000000e1";
    const r2 = "00000000-0000-4000-8000-0000000000e2";
    await db.insert(s.finanzierungsrunde).values([
      { id: r1, organisationId: ID.orgA, bezeichnung: "Seed", datum: "2025-01-10", preMoney: "1000000.00", postMoney: "1200000.00", preisJeAnteil: "2.0000", anteileGesamtNach: "600000" },
      { id: r2, organisationId: ID.orgA, bezeichnung: "Serie A", datum: "2025-05-10", preMoney: "3000000.00", postMoney: "3500000.00", preisJeAnteil: "5.0000", anteileGesamtNach: "700000" },
    ]);
    await db.insert(s.rundenposition).values([
      { rundeId: r1, fondsId: ID.fonds, betrag: "100000.00", anteile: "50000", rolle: "lead" },
      { rundeId: r2, fondsId: ID.fonds, betrag: "50000.00", anteile: "10000", rolle: "co" },
    ]);
    await freigegeben(ID.darlehen, "2025-03-31", "40000.00", "anschaffungskosten");
    const d = await json(await runde({ stichtag: "2025-06-30", vorschlag: "letzte_runde" }));
    const eigen = d.bewertungen.find((b: { beteiligungId: string }) => b.beteiligungId === ID.eigen);
    // 60.000 Anteile × 5,00
    expect(eigen).toMatchObject({ wert: "300000.00", methode: "letzte_runde" });
    expect(eigen.begruendung).toContain("Serie A");
    const darlehen = d.bewertungen.find((b: { beteiligungId: string }) => b.beteiligungId === ID.darlehen);
    expect(darlehen).toMatchObject({ wert: "40000.00", methode: "anschaffungskosten" });
    expect(darlehen.begruendung).toContain("Fortgeschrieben");
    // Vor dem Stichtag der zweiten Runde zählt nur die erste: 50.000 × 2,00
    const frueh = await json(await runde({ stichtag: "2025-04-30", vorschlag: "letzte_runde" }));
    expect(frueh.bewertungen.find((b: { beteiligungId: string }) => b.beteiligungId === ID.eigen).wert).toBe("100000.00");
  });

  it("eine verworfene Runde verwirft ihre Entwürfe; inaktive Beteiligungen sind nicht dabei", async () => {
    await db.update(s.beteiligung).set({ status: "exit" }).where(eq(s.beteiligung.id, ID.wandel));
    await freigegeben(ID.eigen, "2025-03-31", "1.00");
    await freigegeben(ID.darlehen, "2025-03-31", "2.00");
    const d = await json(await runde({ stichtag: "2025-06-30", vorschlag: "fortschreiben" }));
    expect(d.bewertungen).toHaveLength(2);
    const v = await post(`/bewertungsrunden/${d.runde.id}/verwerfen`, undefined, "ersteller");
    expect(await json(v)).toMatchObject({ status: "verworfen" });
    const zeilen = await db.select().from(s.bewertung).where(eq(s.bewertung.bewertungsrundeId, d.runde.id));
    expect(zeilen.every((z) => z.status === "verworfen")).toBe(true);
    expect(await portfoliowert("2025-06-30")).toBe("3.00");
    expect((await runde({ stichtag: "morgen", vorschlag: "fortschreiben" })).status).toBe(400);
    expect((await runde({ stichtag: "2025-06-30", vorschlag: "zufall" })).status).toBe(400);
    expect((await post(`/fonds/00000000-0000-4000-8000-0000000000ff/bewertungsrunde`, { stichtag: "2025-06-30", vorschlag: "fortschreiben" })).status).toBe(404);
  });
});
