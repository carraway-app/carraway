import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, idVon, person, STANDARD } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { anzahl, aufrufe, auftraege, grundbestand, ID, json, leereAuftraege, protokollZeilen } from "./hilfen-instrumente";
import { hauptinstrumentId } from "../instrumente/hauptinstrument";
import { vorgaengeEinfuegen } from "./instrument-hilfen";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const { get, post, put } = aufrufe(t);

// Basis: 100.000 am 01.01.2025 ausgezahlt, 6 % nach 30E/360, jährlich mit Anker 01.01. (volle Jahre = 360/360 = 6.000,00).
const KONDITION = { gueltigAb: "2025-01-01", satzFix: "0.06", methode: "30E/360", zinsperiode: "jaehrlich", anker: "2026-01-01" };

async function darlehenAufsetzen(kondition: object = KONDITION, id: string = ID.darlehen) {
  await post(`/investments/${id}/transactions`, { type: "commitment", valueDate: "2025-01-01", amount: "200000" });
  await post(`/investments/${id}/transactions`, { type: "disbursement", valueDate: "2025-01-01", amount: "100000" });
  if (kondition) expect((await post(`/beteiligungen/${id}/konditionen`, kondition)).status).toBe(201);
}

const neuerLauf = async (stichtag: string) => {
  const antwort = await post("/zinslaeufe", { fondsId: ID.fonds, stichtag }, "rechner");
  expect(antwort.status).toBe(201);
  return json(antwort);
};
const betraege = (lauf: { positionen: { betragGebucht: string }[] }) => lauf.positionen.map((p) => p.betragGebucht);

beforeEach(async () => {
  await grundbestand(db);
  // Das Wandeldarlehen und die offene Beteiligung nehmen am Zinslauf nur teil, wenn ein Test es will.
  await db.update(s.beteiligung).set({ status: "exit" }).where(eq(s.beteiligung.id, ID.wandel));
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Zinslauf: Ablauf berechnet bis gebucht", () => {
  it("berechnet, prüft, gibt frei und bucht; ein zweiter Lauf findet nichts mehr", async () => {
    await darlehenAufsetzen();
    const lauf = await neuerLauf("2027-01-01");
    expect(lauf).toMatchObject({ status: "berechnet", stichtag: "2027-01-01", berechnetVon: await idVon(db, person("rechner")) });
    expect(betraege(lauf)).toEqual(["6000.00", "6000.00"]);
    expect(lauf.positionen.map((p: { bis: string }) => p.bis)).toEqual(["2026-01-01", "2027-01-01"]);
    expect(lauf.positionen[0].schritte.length).toBeGreaterThan(3);
    expect(lauf.positionen[0].organisation.name).toBe("Beta Beispiel");
    expect(lauf.summe).toEqual({ anzahl: 2, gebucht: "12000.00" });
    expect(await anzahl(db, "vorgang", "art = 'zins'")).toBe(0);

    expect((await post(`/zinslaeufe/${lauf.id}/freigeben`, {}, "b")).status).toBe(409); // noch nicht geprüft
    expect((await post(`/zinslaeufe/${lauf.id}/buchen`, {}, "c")).status).toBe(409);
    const geprueft = await post(`/zinslaeufe/${lauf.id}/pruefen`, {}, "a");
    expect(await json(geprueft)).toMatchObject({ status: "geprueft", geprueftVon: await idVon(db, person("a")) });

    const gleicher = await post(`/zinslaeufe/${lauf.id}/freigeben`, {}, "a");
    expect(gleicher.status).toBe(409);
    expect((await json(gleicher)).error.code).toBe("four_eyes_violated");
    const andere = await post(`/zinslaeufe/${lauf.id}/freigeben`, {}); // Standard-Person: eine andere als "a"
    expect(andere.status).toBe(200);
    expect((await get(`/zinslaeufe/${lauf.id}`).then(json)).freigegebenVon).toBe(await idVon(db, STANDARD));

    await leereAuftraege(db);
    const gebucht = await post(`/zinslaeufe/${lauf.id}/buchen`, {}, "c");
    expect(gebucht.status).toBe(200);
    expect(await json(gebucht)).toMatchObject({ status: "gebucht", gebuchtVon: await idVon(db, person("c")) });
    expect(await auftraege(db)).toBe(1);

    const instrument = await get(`/beteiligungen/${ID.darlehen}/instrumentdaten`).then(json);
    expect(instrument.zustand.zinsen).toBe("12000.00");
    expect(instrument.zustand.kapitalisiert).toBe("0.00");
    const zinsen = await db.select().from(s.vorgang).where(eq(s.vorgang.art, "zins"));
    expect(zinsen.map((z) => [z.valuta, z.betrag, z.kapitalisiert]).sort()).toEqual([
      ["2026-01-01", "6000.00", false],
      ["2027-01-01", "6000.00", false],
    ]);
    expect(await anzahl(db, "zinsperiode_gebucht")).toBe(2);
    expect((await protokollZeilen(db, "zinslauf")).map((z) => z.aktion)).toEqual(["anlegen", "pruefen", "freigeben", "buchen"]);

    // nie doppelt: ein neuer Lauf enthält die gebuchten Perioden nicht mehr, und die Datenbank sperrt die Doppelbuchung
    expect((await neuerLauf("2027-01-01")).positionen).toEqual([]);
    await expect(db.insert(s.zinsperiodeGebucht).values({ beteiligungId: ID.darlehen, instrumentId: await hauptinstrumentId(db, ID.darlehen), periodeBis: "2026-01-01" })).rejects.toThrow();
    // gebucht ist endgültig
    const verwerfen = await post(`/zinslaeufe/${lauf.id}/verwerfen`, {});
    expect(verwerfen.status).toBe(409);
    expect((await json(verwerfen)).error.code).toBe("interest_run_status_invalid");
    expect((await post(`/zinslaeufe/${lauf.id}/buchen`, {}, "c")).status).toBe(409);
  });

  it("ein Lauf lässt sich vor der Buchung verwerfen und ist dann nicht mehr buchbar", async () => {
    await darlehenAufsetzen();
    const lauf = await neuerLauf("2026-12-31");
    await post(`/zinslaeufe/${lauf.id}/pruefen`, {}, "a");
    const verworfen = await post(`/zinslaeufe/${lauf.id}/verwerfen`, {}, "a");
    expect(await json(verworfen)).toMatchObject({ status: "verworfen", verworfenVon: await idVon(db, person("a")) });
    expect((await post(`/zinslaeufe/${lauf.id}/freigeben`, {}, "b")).status).toBe(409);
    expect((await protokollZeilen(db, "zinslauf")).map((z) => z.aktion)).toEqual(["anlegen", "pruefen", "verwerfen"]);
    expect(await anzahl(db, "vorgang", "art = 'zins'")).toBe(0);
  });

  it("Liste nach Fonds, Detail und 404", async () => {
    await darlehenAufsetzen();
    const lauf = await neuerLauf("2026-12-31");
    const liste = await get(`/zinslaeufe?fondsId=${ID.fonds}`).then(json);
    expect(liste.daten).toHaveLength(1);
    expect(liste.daten[0]).toMatchObject({ id: lauf.id, status: "berechnet", anzahlPositionen: 1, summeGebucht: "6000.00" });
    expect((await get(`/zinslaeufe?fondsId=${ID.anderer}`).then(json)).daten).toEqual([]);
    expect((await get("/zinslaeufe/00000000-0000-4000-8000-0000000000ee")).status).toBe(404);
    expect((await get("/zinslaeufe/00000000-0000-4000-8000-0000000000ee/kontrolle")).status).toBe(404);
    expect((await post("/zinslaeufe", { fondsId: "00000000-0000-4000-8000-0000000000ee", stichtag: "2026-12-31" })).status).toBe(404);
    expect((await post("/zinslaeufe", { fondsId: ID.fonds, stichtag: "bald" })).status).toBe(400);
  });

  it("buchen bricht ab, wenn nach der Berechnung Vorgänge erfasst wurden oder ein anderer Lauf die Periode gebucht hat", async () => {
    await darlehenAufsetzen();
    const a = await neuerLauf("2026-12-31");
    const b = await neuerLauf("2026-12-31");
    for (const l of [a, b]) {
      await post(`/zinslaeufe/${l.id}/pruefen`, {}, "p");
      await post(`/zinslaeufe/${l.id}/freigeben`, {}, "f");
    }
    expect((await post(`/zinslaeufe/${a.id}/buchen`, {})).status).toBe(200);
    const veraltet = await post(`/zinslaeufe/${b.id}/buchen`, {});
    expect(veraltet.status).toBe(409);
    expect(["interest_run_outdated", "interest_period_posted"]).toContain((await json(veraltet)).error.code);
    expect(await anzahl(db, "vorgang", "art = 'zins'")).toBe(1);
  });
});

describe("Zinslauf: Rechnung", () => {
  it("kapitalisiert den gerundeten Betrag und verzinst ihn in der nächsten Periode", async () => {
    await darlehenAufsetzen({ ...KONDITION, kapitalisieren: true });
    const lauf = await neuerLauf("2027-01-01");
    expect(betraege(lauf)).toEqual(["6000.00", "6360.00"]);
    expect(lauf.positionen.map((p: { kapitalisiert: boolean }) => p.kapitalisiert)).toEqual([true, true]);
    await post(`/zinslaeufe/${lauf.id}/pruefen`, {}, "a");
    await post(`/zinslaeufe/${lauf.id}/freigeben`, {}, "b");
    await post(`/zinslaeufe/${lauf.id}/buchen`, {}, "c");
    const instrument = await get(`/beteiligungen/${ID.darlehen}/instrumentdaten`).then(json);
    expect(instrument.zustand).toMatchObject({ kapitalisiert: "12360.00", offenesKapital: "112360.00", zinsen: "12360.00" });
    // Buchwert enthält die kapitalisierten Zinsen
    expect(instrument.buchwert.wert).toBe("112360.00");
  });

  it("kapitalisierter Betrag verzinst sich in einem späteren Lauf mit", async () => {
    await darlehenAufsetzen({ ...KONDITION, kapitalisieren: true });
    const erster = await neuerLauf("2026-12-31");
    await post(`/zinslaeufe/${erster.id}/pruefen`, {}, "a");
    await post(`/zinslaeufe/${erster.id}/freigeben`, {}, "b");
    await post(`/zinslaeufe/${erster.id}/buchen`, {}, "c");
    // 106.000 × 6 % = 6.360,00 (kapitalisierte Zinsen aus Vorgängen fließen ins Kapital)
    expect(betraege(await neuerLauf("2027-01-01"))).toEqual(["6360.00"]);
  });

  it("Stundung verschiebt nur die Fälligkeit", async () => {
    await darlehenAufsetzen({ ...KONDITION, stundungBis: "2026-06-30" });
    const lauf = await neuerLauf("2026-12-31");
    expect(lauf.positionen[0]).toMatchObject({ betragGebucht: "6000.00", gestundet: true, faelligAm: "2026-06-30", bis: "2026-01-01" });
  });

  it("Konditionen aus gueltigAb: die Version am letzten Tag der Periode gilt", async () => {
    await darlehenAufsetzen();
    // Änderung zum 01.07.2026: die Periode 2026 (bis 01.01.2027) rechnet mit 8 %, die Periode 2025 noch mit 6 %.
    await post(`/beteiligungen/${ID.darlehen}/konditionen`, { gueltigAb: "2026-07-01", satzFix: "0.08", methode: "30E/360" });
    const lauf = await neuerLauf("2027-01-01");
    expect(betraege(lauf)).toEqual(["6000.00", "8000.00"]);
    expect(lauf.positionen[0].konditionId).not.toBe(lauf.positionen[1].konditionId);
    const daten = await get(`/beteiligungen/${ID.darlehen}/instrumentdaten`).then(json);
    expect(daten.konditionen.find((k: { id: string }) => k.id === lauf.positionen[1].konditionId).satzFix).toBe("0.080000");
  });

  it("eine Änderung genau am Periodenende gilt erst für die nächste Periode", async () => {
    await darlehenAufsetzen();
    await post(`/beteiligungen/${ID.darlehen}/konditionen`, { gueltigAb: "2026-01-01", satzFix: "0.08", methode: "30E/360" });
    // Periode bis 01.01.2026: letzter Tag 31.12.2025, noch 6 %; Periode bis 01.01.2027: 8 %
    expect(betraege(await neuerLauf("2027-01-01"))).toEqual(["6000.00", "8000.00"]);
  });

  it("gewinnabhängiger Zins mit Kappung, fehlender Jahresüberschuss wird gemeldet", async () => {
    await darlehenAufsetzen({ ...KONDITION, gewinnabhaengigSatz: "0.1", kappungSatz: "0.02" });
    await put(`/beteiligungen/${ID.darlehen}/jahresueberschuss/2025`, { betrag: "30000" });
    // 2025: min(10 % × 30.000 = 3.000; 2 % × 100.000 = 2.000) = 2.000 plus fix 6.000
    expect(betraege(await neuerLauf("2026-12-31"))).toEqual(["8000.00"]);
    const fehlt = await post("/zinslaeufe", { fondsId: ID.fonds, stichtag: "2027-01-01" });
    expect(fehlt.status).toBe(409);
    const d = await json(fehlt);
    expect(d.error).toMatchObject({ code: "calculation_failed", beteiligungId: ID.darlehen });
    expect(d.error.grund).toContain("2026");
    await put(`/beteiligungen/${ID.darlehen}/jahresueberschuss/2026`, { betrag: "-5000" });
    expect(betraege(await neuerLauf("2027-01-01"))).toEqual(["8000.00", "6000.00"]);
  });

  it("Darlehen ohne Konditionen, ohne aktiven Status und die offene Beteiligung nehmen nicht teil, ohne Konditionen wird gemeldet", async () => {
    await darlehenAufsetzen();
    await db.update(s.beteiligung).set({ status: "aktiv" }).where(eq(s.beteiligung.id, ID.wandel));
    const lauf = await neuerLauf("2026-12-31");
    expect(lauf.hinweise.ohneKonditionen).toEqual([ID.wandel]);
    expect(lauf.positionen).toHaveLength(1);
    await db.update(s.beteiligung).set({ status: "insolvent" }).where(eq(s.beteiligung.id, ID.darlehen));
    expect((await neuerLauf("2026-12-31")).positionen).toEqual([]);
  });

  it("Storno der Zinsbuchung gibt die Periode wieder frei", async () => {
    await darlehenAufsetzen();
    const lauf = await neuerLauf("2027-01-01");
    await post(`/zinslaeufe/${lauf.id}/pruefen`, {}, "a");
    await post(`/zinslaeufe/${lauf.id}/freigeben`, {}, "b");
    await post(`/zinslaeufe/${lauf.id}/buchen`, {}, "c");
    const erste = (await db.select().from(s.vorgang).where(eq(s.vorgang.art, "zins"))).find((z) => z.valuta === "2026-01-01")!;
    const storno = await post(`/transactions/${erste.id}/reverse`, { reason: "Zinssatz falsch" });
    expect(storno.status).toBe(201);
    expect(await anzahl(db, "zinsperiode_gebucht")).toBe(1);
    const neu = await neuerLauf("2027-01-01");
    expect(neu.positionen.map((p: { bis: string }) => p.bis)).toEqual(["2026-01-01"]);
    expect(betraege(neu)).toEqual(["6000.00"]);
  });
});

describe("Schutz gegen ferne Stichtage und zu viele Perioden", () => {
  it("lehnt Stichtage nach heute plus 366 Tagen und vor dem ersten Vorgang ab", async () => {
    await darlehenAufsetzen();
    for (const stichtag of ["9999-12-31", "2024-12-31"]) {
      const lauf = await post("/zinslaeufe", { fondsId: ID.fonds, stichtag });
      expect(lauf.status).toBe(400);
      expect((await json(lauf)).error.fields[0]).toMatchObject({ field: "stichtag", code: "as_of_out_of_range" });
      const abgrenzung = await get(`/fonds/${ID.fonds}/abgrenzung?stichtag=${stichtag}`);
      expect(abgrenzung.status).toBe(400);
      expect((await json(abgrenzung)).error.fields[0].code).toBe("as_of_out_of_range");
    }
    expect(await anzahl(db, "zinslauf")).toBe(0);
    const naechstesJahr = new Date(Date.now() + 300 * 86_400_000).toISOString().slice(0, 10);
    expect((await post("/zinslaeufe", { fondsId: ID.fonds, stichtag: naechstesJahr })).status).toBe(201);
  });

  it("begrenzt die Zinsperioden je Darlehen mit 409", async () => {
    await post(`/investments/${ID.darlehen}/transactions`, { type: "commitment", valueDate: "1900-01-01", amount: "200000" });
    await post(`/investments/${ID.darlehen}/transactions`, { type: "disbursement", valueDate: "1900-01-01", amount: "100000" });
    await post(`/beteiligungen/${ID.darlehen}/konditionen`, { ...KONDITION, gueltigAb: "1900-01-01", zinsperiode: "quartalsweise", anker: "1900-03-31" });
    const lauf = await post("/zinslaeufe", { fondsId: ID.fonds, stichtag: "2026-11-01" });
    expect(lauf.status).toBe(409);
    expect((await json(lauf)).error).toMatchObject({ code: "too_many_periods", beteiligungId: ID.darlehen, maximum: 400 });
    expect(await anzahl(db, "zinslauf")).toBe(0);
    const a = await get(`/fonds/${ID.fonds}/abgrenzung?stichtag=2026-11-01`).then(json);
    expect(a.darlehen[0].fehler).toContain("too many");
  });
});

describe("Kontrollbericht", () => {
  const status = (bericht: { pruefungen: { schluessel: string; status: string }[] }, schluessel: string) =>
    bericht.pruefungen.find((p) => p.schluessel === schluessel)?.status;

  async function gebuchterLauf() {
    await darlehenAufsetzen();
    const lauf = await neuerLauf("2027-01-01");
    await post(`/zinslaeufe/${lauf.id}/pruefen`, {}, "a");
    await post(`/zinslaeufe/${lauf.id}/freigeben`, {}, "b");
    await post(`/zinslaeufe/${lauf.id}/buchen`, {}, "c");
    return lauf;
  }

  it("ist ok für einen sauberen, gebuchten Lauf", async () => {
    const lauf = await gebuchterLauf();
    const bericht = await get(`/zinslaeufe/${lauf.id}/kontrolle`).then(json);
    expect(bericht).toMatchObject({ gesamt: "ok", status: "gebucht", stichtag: "2027-01-01" });
    expect(bericht.pruefungen.map((p: { schluessel: string }) => p.schluessel)).toEqual([
      "summe_positionen_gleich_buchungen",
      "keine_periode_doppelt",
      "alle_darlehen_abgedeckt",
      "darlehen_mit_konditionen",
      "kapital_null",
    ]);
    expect(bericht.pruefungen.every((p: { status: string }) => p.status === "ok")).toBe(true);
  });

  it("erkennt eine erzwungene Abweichung zwischen Positionen und Buchungen", async () => {
    const lauf = await gebuchterLauf();
    await db.execute(sql`UPDATE zinslauf_position SET betrag_gebucht = betrag_gebucht + 1 WHERE zinslauf_id = ${lauf.id} AND bis = '2026-01-01'`);
    const bericht = await get(`/zinslaeufe/${lauf.id}/kontrolle`).then(json);
    expect(bericht.gesamt).toBe("abweichung");
    expect(status(bericht, "summe_positionen_gleich_buchungen")).toBe("abweichung");
    expect(bericht.pruefungen[0].details[0]).toMatchObject({ summePositionen: "12001.00", summeBuchungen: "12000.00" });
    expect(status(bericht, "keine_periode_doppelt")).toBe("ok");
  });

  it("erkennt eine doppelt gebuchte Periode", async () => {
    const lauf = await gebuchterLauf();
    await vorgaengeEinfuegen(db, { beteiligungId: ID.darlehen, art: "zins", valuta: "2026-01-01", betrag: "6000.00", bemerkung: "Handbuchung" });
    const bericht = await get(`/zinslaeufe/${lauf.id}/kontrolle`).then(json);
    expect(status(bericht, "keine_periode_doppelt")).toBe("abweichung");
    expect(bericht.pruefungen[1].details[0]).toMatchObject({ beteiligungId: ID.darlehen, periodeBis: "2026-01-01", buchungen: 2 });
  });

  it("meldet Darlehen außerhalb des Laufs, ohne Konditionen und mit Kapital null", async () => {
    await darlehenAufsetzen();
    await db.update(s.beteiligung).set({ status: "aktiv" }).where(eq(s.beteiligung.id, ID.wandel));
    const lauf = await neuerLauf("2026-12-31");
    let bericht = await get(`/zinslaeufe/${lauf.id}/kontrolle`).then(json);
    expect(status(bericht, "darlehen_mit_konditionen")).toBe("abweichung");
    // Das Wandeldarlehen bekommt nach dem Lauf Konditionen: nicht im Lauf abgedeckt
    await post(`/beteiligungen/${ID.wandel}/konditionen`, KONDITION);
    bericht = await get(`/zinslaeufe/${lauf.id}/kontrolle`).then(json);
    expect(status(bericht, "alle_darlehen_abgedeckt")).toBe("abweichung");
    expect(status(bericht, "darlehen_mit_konditionen")).toBe("ok");
    // Neuer Lauf: das Wandeldarlehen hat Konditionen, aber kein Kapital
    const lauf2 = await neuerLauf("2026-12-31");
    bericht = await get(`/zinslaeufe/${lauf2.id}/kontrolle`).then(json);
    expect(status(bericht, "alle_darlehen_abgedeckt")).toBe("ok");
    expect(status(bericht, "kapital_null")).toBe("abweichung");
    expect(JSON.stringify(bericht.pruefungen.find((p: { schluessel: string }) => p.schluessel === "kapital_null").details)).toContain(ID.wandel);
  });

  it("zeigt für einen noch nicht gebuchten Lauf einen Hinweis statt einer Summenprüfung", async () => {
    await darlehenAufsetzen();
    const lauf = await neuerLauf("2026-12-31");
    const bericht = await t.requestApi(`/interest-runs/${lauf.id}/checks`).then(json);
    expect(bericht.checks[0]).toMatchObject({ status: "ok", warningCode: "interest_run_not_posted" });
    expect(bericht.checks[0].warning).toContain("calculated");
  });
});

describe("GET /fonds/:id/abgrenzung", () => {
  it("trennt fällige ungebuchte Perioden vom laufenden Stück und summiert", async () => {
    await darlehenAufsetzen();
    const a = await get(`/fonds/${ID.fonds}/abgrenzung?stichtag=2026-07-01`).then(json);
    expect(a.stichtag).toBe("2026-07-01");
    expect(a.darlehen).toHaveLength(1);
    expect(a.darlehen[0]).toMatchObject({ beteiligungId: ID.darlehen, offen: "6000.00", gesamt: "9000.00", fehler: null });
    expect(a.darlehen[0].offenePerioden).toEqual([{ von: "2025-01-01", bis: "2026-01-01", betragGebucht: "6000.00", kapitalisiert: false }]);
    expect(a.darlehen[0].laufend).toEqual({ von: "2026-01-01", bis: "2026-07-01", betragGebucht: "3000.00" });
    expect(a.darlehen[0].schritte.length).toBeGreaterThan(5);
    expect(a.summe).toEqual({ offen: "6000.00", gesamt: "9000.00" });

    const lauf = await neuerLauf("2026-07-01");
    await post(`/zinslaeufe/${lauf.id}/pruefen`, {}, "a");
    await post(`/zinslaeufe/${lauf.id}/freigeben`, {}, "b");
    await post(`/zinslaeufe/${lauf.id}/buchen`, {}, "c");
    const danach = await get(`/fonds/${ID.fonds}/abgrenzung?stichtag=2026-07-01`).then(json);
    expect(danach.summe).toEqual({ offen: "0.00", gesamt: "3000.00" });
  });

  it("meldet ein nicht rechenbares Darlehen mit Fehler und lässt es aus der Summe", async () => {
    await darlehenAufsetzen({ ...KONDITION, gewinnabhaengigSatz: "0.1", kappungSatz: "0.02" });
    const a = await get(`/fonds/${ID.fonds}/abgrenzung?stichtag=2026-07-01`).then(json);
    expect(a.darlehen[0].fehler).toContain("Jahresüberschuss");
    expect(a.summe).toEqual({ offen: "0.00", gesamt: "0.00" });
    expect((await get(`/fonds/00000000-0000-4000-8000-0000000000ee/abgrenzung`)).status).toBe(404);
  });
});
