import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, legePersonAn, person } from "./hilfen-auth";
import { aufrufe, grundbestand, ID } from "./hilfen-instrumente";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const { get, post, put, patch } = aufrufe(t);

const F1 = ID.fonds;
const B = ID.eigen;
const ADMIN = person("fx-admin", { globalVerwalter: true });
const ADMIN2 = person("fx-admin-zwei", { globalVerwalter: true });
const bearbeiter = person("fx-bearbeiter", { rollen: { [F1]: "bearbeiter" } });
const betrachter = person("fx-betrachter", { rollen: { [F1]: "betrachter" } });
const fremder = person("fx-fremd", { rollen: { [ID.anderer]: "bearbeiter" } });

const kurs = (datum: string, basis: string, quote: string, wert: string, als = ADMIN) => post("/wechselkurse", { datum, basis, quote, kurs: wert }, als);
const sicht = async (suche = "") => json(await get(`/beteiligungen/${B}/waehrungssicht${suche}`, ADMIN));

beforeEach(async () => {
  await grundbestand(db);
  for (const p of [ADMIN, ADMIN2, bearbeiter, betrachter, fremder]) await legePersonAn(db, p);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Kurstabelle", () => {
  it("globale Verwalter erfassen Kurse, jede Person mit Rolle liest sie; Eingaben werden geprüft", async () => {
    expect((await kurs("2025-02-01", "EUR", "USD", "1.0800", bearbeiter)).status).toBe(403);
    expect((await kurs("2025-02-01", "EUR", "USD", "1.0800")).status).toBe(201);
    for (const falsch of [
      { datum: "2025-02-01", basis: "EUR", quote: "EUR", kurs: "1" },
      { datum: "2025-02-01", basis: "eur", quote: "USD", kurs: "1.1" },
      { datum: "2025-02-01", basis: "EUR", quote: "USD", kurs: "0" },
      { datum: "2025-02-01", basis: "EUR", quote: "USD", kurs: "1.123456789" },
      { datum: "2025-02-30", basis: "EUR", quote: "USD", kurs: "1.1" },
    ]) {
      expect((await post("/wechselkurse", falsch, ADMIN)).status, JSON.stringify(falsch)).toBe(400);
    }
    const liste = await json(await get("/wechselkurse", betrachter));
    expect(liste.daten).toHaveLength(1);
    expect(liste.daten[0]).toMatchObject({ datum: "2025-02-01", basis: "EUR", quote: "USD", kurs: "1.08", quelle: "manuell", gilt: true });
    expect((await get("/wechselkurse", fremder)).status).toBe(200); // eine Rolle irgendwo genügt
    expect((await json(await get("/wechselkurse/waehrungen", betrachter))).daten.map((x: { waehrung: string }) => x.waehrung)).toEqual(["EUR", "USD"]);
  });

  it("ein zweiter Eintrag für Tag und Paar ist nur als Korrektur mit Grund möglich; der alte bleibt, es gilt der jüngste, auch rückwirkend per Wissensstand", async () => {
    const erster = await json(await kurs("2025-02-01", "EUR", "USD", "1.0800"));
    const doppelt = await kurs("2025-02-01", "EUR", "USD", "1.0900");
    expect(doppelt.status).toBe(409);
    expect((await json(doppelt)).fehler.code).toBe("KURS_VORHANDEN");
    // Korrektur ohne Grund oder mit falschem Verweis
    expect((await post("/wechselkurse", { datum: "2025-02-01", basis: "EUR", quote: "USD", kurs: "1.0900", korrigiertKursId: erster.id }, ADMIN)).status).toBe(400);
    const falsch = await post("/wechselkurse", { datum: "2025-02-01", basis: "EUR", quote: "USD", kurs: "1.0900", korrigiertKursId: "00000000-0000-4000-8000-00000000dead", grund: "Tippfehler" }, ADMIN);
    expect(falsch.status).toBe(404);
    expect((await json(falsch)).fehler.code).toBe("KURS_NICHT_GEFUNDEN");
    await new Promise((r) => setTimeout(r, 25));
    const vorKorrektur = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 25));
    const korrektur = await post("/wechselkurse", { datum: "2025-02-01", basis: "EUR", quote: "USD", kurs: "1.0900", korrigiertKursId: erster.id, grund: "Tippfehler in der Quelle" }, ADMIN);
    expect(korrektur.status, await korrektur.clone().text()).toBe(201);

    expect((await json(await get("/wechselkurse", ADMIN))).daten.map((x: { kurs: string }) => x.kurs)).toEqual(["1.09"]);
    const alle = (await json(await get("/wechselkurse?alle=1", ADMIN))).daten as { kurs: string; gilt: boolean; grund: string | null; korrigiertKursId: string | null }[];
    expect(alle.map((x) => [x.kurs, x.gilt])).toEqual(expect.arrayContaining([["1.09", true], ["1.08", false]]));
    expect(alle.find((x) => x.kurs === "1.09")).toMatchObject({ grund: "Tippfehler in der Quelle", korrigiertKursId: erster.id });
    // zum früheren Wissensstand galt noch der erste Kurs
    expect((await json(await get(`/wechselkurse?stand=${encodeURIComponent(vorKorrektur)}`, ADMIN))).daten.map((x: { kurs: string }) => x.kurs)).toEqual(["1.08"]);
    // Zeilen sind unveränderlich (Trigger)
    await expect(pool.query(`UPDATE wechselkurs SET kurs = 2 WHERE id = $1`, [erster.id])).rejects.toMatchObject({ code: "23001" });
    await expect(pool.query(`DELETE FROM wechselkurs WHERE id = $1`, [erster.id])).rejects.toMatchObject({ code: "23001" });
    // Änderungsprotokoll
    const log = (await db.execute(sql`SELECT aktion FROM aenderung WHERE tabelle = 'wechselkurs' ORDER BY am, id`)).rows.map((r) => r.aktion);
    expect(log).toEqual(["anlegen", "korrigieren"]);
  });
});

describe("Kursimport aus einer Datei", () => {
  // Erfundene Kurse im Aufbau der EZB-Referenzkurse (Basis EUR, N/A für fehlende Tage, Komma am Zeilenende).
  const EZB = ["Date,USD,JPY,GBP,", "2026-09-30,1.1000,160.50,0.8600,", "2026-09-29,N/A,159.90,0.8590,", "2026-09-28,1.0850,159.10,N/A,"].join("\n");
  const importiere = (koerper: Record<string, unknown>, als = ADMIN) => post("/wechselkurse/import", koerper, als);

  it("Vorschau liest und prüft ohne zu schreiben; Übernehmen schreibt nur Neues, wiederholt ist es unverändert", async () => {
    const vorschau = await importiere({ inhalt: EZB, dateiname: "ezb-test.csv" });
    expect(vorschau.status).toBe(200);
    expect(await json(vorschau)).toMatchObject({ format: "ezb", zeilen: 3, gelesen: 7, neu: 7, unveraendert: 0, uebernommen: false, fehlerAnzahl: 0 });
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM wechselkurs`)).rows[0]).toEqual({ n: 0 });

    const fertig = await importiere({ inhalt: EZB, dateiname: "ezb-test.csv", vorschau: false });
    expect(fertig.status).toBe(201);
    expect(await json(fertig)).toMatchObject({ neu: 7, uebernommen: true });
    const zeilen = (await db.execute(sql`SELECT basis, quote, datum::text AS datum, kurs::text AS kurs, quelle::text AS quelle, quelle_datei FROM wechselkurs ORDER BY datum, quote`)).rows;
    expect(zeilen).toHaveLength(7);
    expect(zeilen.find((z) => z.datum === "2026-09-30" && z.quote === "USD")).toMatchObject({ basis: "EUR", kurs: "1.10000000", quelle: "import", quelle_datei: "ezb-test.csv" });

    const nochmal = await json(await importiere({ inhalt: EZB, dateiname: "ezb-test.csv", vorschau: false }));
    expect(nochmal).toMatchObject({ neu: 0, unveraendert: 7, abweichendAnzahl: 0 });
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM aenderung WHERE tabelle = 'wechselkurs' AND aktion = 'importieren'`)).rows[0]).toEqual({ n: 7 });
  });

  it("ein abweichender Kurs wird gemeldet und nicht überschrieben; Filter auf Währungen und Tage", async () => {
    await importiere({ inhalt: EZB, dateiname: "a.csv", vorschau: false });
    const geaendert = EZB.replace("1.1000", "1.1111");
    const r = await json(await importiere({ inhalt: geaendert, dateiname: "b.csv", vorschau: false }));
    expect(r).toMatchObject({ neu: 0, abweichendAnzahl: 1 });
    expect(r.abweichend[0]).toMatchObject({ datum: "2026-09-30", quote: "USD", kurs: "1.1111", vorhanden: "1.1" });
    expect((await db.execute(sql`SELECT kurs::text AS kurs FROM wechselkurs WHERE quote = 'USD' AND datum = '2026-09-30'`)).rows).toEqual([{ kurs: "1.10000000" }]);
    await db.execute(sql`ALTER TABLE wechselkurs DISABLE TRIGGER wechselkurs_kein_update_delete`);
    await db.execute(sql`DELETE FROM wechselkurs`);
    await db.execute(sql`ALTER TABLE wechselkurs ENABLE TRIGGER wechselkurs_kein_update_delete`);
    const gefiltert = await json(await importiere({ inhalt: EZB, dateiname: "c.csv", waehrungen: ["GBP"], ab: "2026-09-29" }));
    expect(gefiltert).toMatchObject({ gelesen: 7, ausgewaehlt: 2, neu: 2 });
  });

  it("der lange Aufbau mit Semikolon und Dezimalkomma wird gelesen; Fehler stehen mit Zeile, eine unlesbare Datei ist 400", async () => {
    const lang = ["Datum;Basis;Quote;Kurs", "30.09.2026;GBP;USD;1,2800", "30.09.2026;EUR;CHF;0,9400", "2026-09-29;eur;chf;0,9390", "kein Datum;EUR;CHF;0,94", "30.09.2026;EUR;CHF;abc"].join("\n");
    const r = await json(await importiere({ inhalt: lang, dateiname: "lang.csv" }));
    expect(r).toMatchObject({ format: "lang", zeilen: 5, gelesen: 3, neu: 3, fehlerAnzahl: 2 });
    expect(r.fehler.map((x: { zeile: number }) => x.zeile)).toEqual([5, 6]);
    expect(r.fehler[0].meldung).toContain("Datum");
    const kaputt = await importiere({ inhalt: "ganz etwas anderes\nohne Kopf", dateiname: "x.csv" });
    expect(kaputt.status).toBe(400);
    expect((await json(kaputt)).fehler.code).toBe("KURSDATEI_UNGUELTIG");
    // zwei verschiedene Kurse für denselben Tag in einer Datei
    const doppelt = await json(await importiere({ inhalt: "Date,USD\n2026-09-30,1.1\n2026-09-30,1.2", dateiname: "d.csv" }));
    expect(doppelt.fehlerAnzahl).toBe(1);
    // nur globale Verwalter
    expect((await importiere({ inhalt: EZB, dateiname: "e.csv" }, bearbeiter)).status).toBe(403);
  });
});

describe("Beteiligung in lokaler Währung", () => {
  const setzeUsd = () => put(`/beteiligungen/${B}/waehrung`, { waehrung: "USD" }, bearbeiter);

  it("die lokale Währung setzt, wer am Fonds bearbeiten darf; die Fondswährung ist dasselbe wie keine", async () => {
    expect((await put(`/beteiligungen/${B}/waehrung`, { waehrung: "USD" }, betrachter)).status).toBe(403);
    expect((await put(`/beteiligungen/${B}/waehrung`, { waehrung: "usd" }, bearbeiter)).status).toBe(400);
    expect(await json(await setzeUsd())).toEqual({ beteiligungId: B, waehrung: "USD", fondsWaehrung: "EUR" });
    expect((await json(await put(`/beteiligungen/${B}/waehrung`, { waehrung: "EUR" }, bearbeiter))).waehrung).toBeNull();
  });

  it("lokale Beträge nur bei abweichender Währung; ohne Kurs kein Betrag (409), nie ein geschätzter", async () => {
    const ohneWaehrung = await post(`/beteiligungen/${B}/vorgaenge`, { art: "zusage", valuta: "2025-02-01", betragLokal: "1000.00" }, bearbeiter);
    expect(ohneWaehrung.status).toBe(409);
    expect((await json(ohneWaehrung)).fehler.code).toBe("WAEHRUNG_GLEICH");
    await setzeUsd();
    const keinKurs = await post(`/beteiligungen/${B}/vorgaenge`, { art: "zusage", valuta: "2025-02-01", betragLokal: "1000.00" }, bearbeiter);
    expect(keinKurs.status).toBe(409);
    const f = (await json(keinKurs)).fehler;
    expect(f).toMatchObject({ code: "KURS_FEHLT", von: "USD", nach: "EUR", stichtag: "2025-02-01", grund: "kein_kurs" });
    // Ein zu alter Kurs zählt nicht (Höchstalter 7 Tage).
    await kurs("2025-01-20", "EUR", "USD", "1.0800");
    const zuAlt = await post(`/beteiligungen/${B}/vorgaenge`, { art: "zusage", valuta: "2025-02-01", betragLokal: "1000.00" }, bearbeiter);
    expect((await json(zuAlt)).fehler).toMatchObject({ code: "KURS_FEHLT", grund: "veraltet", letzterKursDatum: "2025-01-20" });
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM vorgang`)).rows[0]).toEqual({ n: 0 });
    // ohne lokalen Betrag und ohne Betrag: Eingabefehler
    expect((await post(`/beteiligungen/${B}/vorgaenge`, { art: "zusage", valuta: "2025-02-01" }, bearbeiter)).status).toBe(400);
    // die Währung ändern geht, solange es keine lokalen Beträge gibt
    expect((await put(`/beteiligungen/${B}/waehrung`, { waehrung: "GBP" }, bearbeiter)).status).toBe(200);
    await setzeUsd();
  });

  it("Zahlungen: lokaler Betrag zum Kurs der Valuta, beide Beträge mit abgeleitetem Kurs, Storno negiert beides; die Währung ist danach fest", async () => {
    await setzeUsd();
    await kurs("2025-02-01", "EUR", "USD", "1.0800");
    const zusage = await post(`/beteiligungen/${B}/vorgaenge`, { art: "zusage", valuta: "2025-02-01", betragLokal: "200000.00" }, bearbeiter);
    expect(zusage.status, await zusage.clone().text()).toBe(201);
    // 200000 USD / 1,08 = 185185,185… EUR
    expect((await json(zusage)).vorgang).toMatchObject({ betrag: "185185.19", betragLokal: "200000.00", kurs: "0.925925925926" });
    // Kontoauszug: beide Beträge sind bekannt, der gebuchte Fondsbetrag gilt, der Kurs ist daraus abgeleitet.
    const aus = await post(`/beteiligungen/${B}/vorgaenge`, { art: "auszahlung", valuta: "2025-02-01", betrag: "92000.00", betragLokal: "100000.00" }, bearbeiter);
    expect(aus.status).toBe(201);
    const v = (await json(aus)).vorgang;
    expect(v).toMatchObject({ betrag: "92000.00", betragLokal: "100000.00", kurs: "0.920000000000", kursId: null });
    // Storno: Gegenbuchung mit negiertem Fonds- und lokalem Betrag und demselben Kurs
    const storno = await json(await post(`/vorgaenge/${v.id}/storno`, { grund: "Testbuchung" }, bearbeiter));
    expect(storno.storno).toMatchObject({ betrag: "-92000.00", betragLokal: "-100000.00", kurs: "0.920000000000" });
    const summen = (await db.execute(sql`SELECT sum(betrag)::text AS f, sum(betrag_lokal)::text AS l FROM vorgang WHERE art = 'auszahlung'`)).rows[0];
    expect(summen).toEqual({ f: "0.00", l: "0.00" });
    // Die Währung lässt sich nicht mehr ändern.
    const aendern = await put(`/beteiligungen/${B}/waehrung`, { waehrung: "GBP" }, bearbeiter);
    expect(aendern.status).toBe(409);
    expect((await json(aendern)).fehler.code).toBe("WAEHRUNG_NICHT_AENDERBAR");
    // Die Periodensperre gilt unverändert.
    expect((await put(`/fonds/${F1}/periodensperre`, { gesperrtBis: "2025-12-31" }, ADMIN)).status).toBe(200);
    expect((await post(`/beteiligungen/${B}/vorgaenge`, { art: "zusage", valuta: "2025-03-01", betragLokal: "1.00" }, bearbeiter)).status).toBe(409);
  });

  it("Bewertung: lokaler Wert zum Kurs des Stichtags; eine Änderung des Fondswerts löscht den veralteten lokalen Wert", async () => {
    await setzeUsd();
    await kurs("2025-12-31", "EUR", "USD", "1.2000");
    const neu = await post(`/beteiligungen/${B}/bewertungen`, { stichtag: "2025-12-31", wertLokal: "150000.00", methode: "sonstige", begruendung: "Beispiel" }, bearbeiter);
    expect(neu.status, await neu.clone().text()).toBe(201);
    const b = (await json(neu)).bewertung;
    expect(b).toMatchObject({ wert: "125000.00", wertLokal: "150000.00", kurs: "0.833333333333" });
    const geaendert = await json(await patch(`/bewertungen/${b.id}`, { wert: "126000.00" }, bearbeiter));
    expect(geaendert).toMatchObject({ wert: "126000.00", wertLokal: null, kurs: null });
    const neuLokal = await json(await patch(`/bewertungen/${b.id}`, { wertLokal: "151000.00" }, bearbeiter));
    expect(neuLokal).toMatchObject({ wert: "125833.33", wertLokal: "151000.00" });
    const ohneKurs = await post(`/beteiligungen/${B}/bewertungen`, { stichtag: "2026-06-30", wertLokal: "100.00", methode: "sonstige", begruendung: "x" }, bearbeiter);
    expect(ohneKurs.status).toBe(409);
    expect((await json(ohneKurs)).fehler.code).toBe("KURS_FEHLT");
  });
});

describe("Währungssicht", () => {
  /** Beteiligung in USD: Kosten zu Valuta-Kursen, Zeitwerte zu Stichtagskursen, Kurse EUR/USD und EUR/GBP erfunden. */
  async function aufbau() {
    await put(`/beteiligungen/${B}/waehrung`, { waehrung: "USD" }, bearbeiter);
    for (const [d, q, k] of [["2025-02-01", "USD", "1.0800"], ["2025-02-01", "GBP", "0.8300"], ["2025-12-31", "USD", "1.2000"], ["2025-12-31", "GBP", "0.8500"], ["2026-06-30", "USD", "1.1000"], ["2026-06-30", "GBP", "0.8700"]] as const) {
      expect((await kurs(d, "EUR", q, k)).status).toBe(201);
    }
    await post(`/beteiligungen/${B}/vorgaenge`, { art: "zusage", valuta: "2025-02-01", betragLokal: "200000.00" }, bearbeiter);
    await post(`/beteiligungen/${B}/vorgaenge`, { art: "auszahlung", valuta: "2025-02-01", betragLokal: "100000.00" }, bearbeiter);
    for (const [stichtag, lokal] of [["2025-12-31", "150000.00"], ["2026-06-30", "160000.00"]] as const) {
      const b = await json(await post(`/beteiligungen/${B}/bewertungen`, { stichtag, wertLokal: lokal, methode: "sonstige", begruendung: "Beispiel" }, ADMIN));
      expect((await post(`/bewertungen/${b.bewertung.id}/freigeben`, undefined, ADMIN2)).status).toBe(200);
    }
  }

  it("zeigt Fonds, lokal und Vergleich getrennt: Kosten zum Kurs der Valuta, Zeitwert zum Kurs des Bewertungsstichtags, mit Kurs und Datum", async () => {
    await aufbau();
    const s = await sicht("?stichtag=2026-06-30&vergleich=GBP");
    expect(s.waehrungen).toEqual({ fonds: "EUR", lokal: "USD", vergleich: "GBP" });
    // 100000 USD / 1,08 = 92592,59 EUR, in GBP 92592,59 × 0,83 = 76851,85
    expect(s.kennzahlen.investiert).toEqual({ fonds: "92592.59", lokal: "100000.00", vergleich: "76851.85" });
    // letzte Bewertung 160000 USD, EUR/USD 1,10: 145454,55 EUR; in GBP × 0,87 = 126545,46
    expect(s.kennzahlen.bewertung).toEqual({ fonds: "145454.55", lokal: "160000.00", vergleich: "126545.46" });
    expect(s.bewertungKurse.map((k: { von: string; nach: string; kurs: string; kursDatum: string; tag: string }) => [k.tag, k.von, k.nach, k.kurs, k.kursDatum])).toEqual([["2026-06-30", "EUR", "GBP", "0.87", "2026-06-30"]]);
    // Die Fondswerte stimmen mit den Kennzahlen der Beteiligung überein.
    const detail = await json(await get(`/beteiligungen/${B}?stichtag=2026-06-30`, ADMIN));
    expect(detail.kennzahlen.investiert.wert).toBe(s.kennzahlen.investiert.fonds);
    expect(detail.kennzahlen.bewertung.wert).toBe(s.kennzahlen.bewertung.fonds);
    expect(s.luecken).toEqual([]);
    // Ohne Vergleichswährung gibt es keine Vergleichswerte.
    expect((await sicht("?stichtag=2026-06-30")).kennzahlen.investiert.vergleich).toBeNull();
    // Vergleich in der lokalen Währung entspricht der Lokalsicht
    expect((await sicht("?stichtag=2026-06-30&vergleich=USD")).kennzahlen.bewertung.vergleich).toBe("160000.00");
  });

  it("zerlegt die Änderung des Fondswerts in Wertänderung und Währungseffekt", async () => {
    await aufbau();
    const s = await sicht("?stichtag=2026-06-30");
    expect(s.bewertungen).toHaveLength(2);
    expect(s.bewertungen[0].fx).toBeNull();
    const fx = s.bewertungen[1].fx;
    // 125000,00 → 145454,55 EUR: gesamt 20454,55; Wertänderung 10000 USD zum neuen Kurs; Rest ist der Währungseffekt
    expect(fx.gesamt).toBe("20454.55");
    expect(fx.wert).toBe("9090.91");
    expect(fx.waehrung).toBe("11363.64");
    expect(Number(fx.wert) + Number(fx.waehrung)).toBeCloseTo(Number(fx.gesamt), 2);
  });

  it("fehlt ein Kurs, steht dort eine Lücke und die Summe ist selbst eine Lücke; nie ein geschätzter Wert", async () => {
    await aufbau();
    // Auszahlung nur in Fondswährung, 6 Wochen nach dem letzten Kurs: Lokalwert ist nicht ableitbar.
    expect((await post(`/beteiligungen/${B}/vorgaenge`, { art: "auszahlung", valuta: "2025-03-15", betrag: "10000.00" }, bearbeiter)).status).toBe(201);
    const s = await sicht("?stichtag=2026-06-30&vergleich=GBP");
    expect(s.kennzahlen.investiert).toEqual({ fonds: "102592.59", lokal: null, vergleich: null });
    expect(s.luecken).toEqual(expect.arrayContaining([expect.objectContaining({ verwendung: "kosten", tag: "2025-03-15", von: "EUR", nach: "USD", grund: "veraltet", letzterKursDatum: "2025-02-01" })]));
    const zeile = s.vorgaenge.find((v: { valuta: string }) => v.valuta === "2025-03-15");
    expect(zeile.betrag).toEqual({ fonds: "10000.00", lokal: null, vergleich: null });
    // Die übrigen Posten bleiben gültig.
    expect(s.vorgaenge.find((v: { art: string }) => v.art === "zusage").betrag.lokal).toBe("200000.00");
  });

  it("zum früheren Wissensstand gelten die damaligen Kurse; gebuchte Beträge ändern sich durch eine Kurskorrektur nicht", async () => {
    await aufbau();
    // Auszahlung nur in Fondswährung am Tag mit Kurs: Lokalwert wird aus dem Kurs abgeleitet.
    await kurs("2025-04-01", "EUR", "USD", "1.1000");
    await post(`/beteiligungen/${B}/vorgaenge`, { art: "auszahlung", valuta: "2025-04-01", betrag: "10000.00" }, bearbeiter);
    await new Promise((r) => setTimeout(r, 25));
    const vorher = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 25));
    const alt = (await json(await get("/wechselkurse?von=2025-04-01&bis=2025-04-01", ADMIN))).daten[0];
    expect((await post("/wechselkurse", { datum: "2025-04-01", basis: "EUR", quote: "USD", kurs: "1.2000", korrigiertKursId: alt.id, grund: "Quelle berichtigt" }, ADMIN)).status).toBe(201);
    const lokalAm = async (suche: string) => (await sicht(suche)).vorgaenge.find((v: { valuta: string }) => v.valuta === "2025-04-01").betrag.lokal;
    expect(await lokalAm("?stichtag=2026-06-30")).toBe("12000.00");
    expect(await lokalAm(`?stichtag=2026-06-30&stand=${encodeURIComponent(vorher)}`)).toBe("11000.00");
    // Die Zusage mit festgehaltenem Kurs ist von der Korrektur unberührt.
    const zusageAlt = (await sicht(`?stichtag=2026-06-30&stand=${encodeURIComponent(vorher)}`)).vorgaenge.find((v: { art: string }) => v.art === "zusage").betrag;
    const zusageNeu = (await sicht("?stichtag=2026-06-30")).vorgaenge.find((v: { art: string }) => v.art === "zusage").betrag;
    expect(zusageNeu).toEqual(zusageAlt);
  });

  it("Fondssicht: je Beteiligung lokal, Fonds und Vergleich, Summen nur in Fonds- und Vergleichswährung", async () => {
    await aufbau();
    const s = await json(await get(`/fonds/${F1}/waehrungssicht?stichtag=2026-06-30&vergleich=GBP`, betrachter));
    expect(s.waehrungen).toEqual({ fonds: "EUR", vergleich: "GBP" });
    const zeile = s.zeilen.find((z: { beteiligungId: string }) => z.beteiligungId === B);
    expect(zeile).toMatchObject({ lokalWaehrung: "USD", investiert: { fonds: "92592.59", lokal: "100000.00", vergleich: "76851.85" }, bewertung: { fonds: "145454.55", lokal: "160000.00", vergleich: "126545.46" } });
    // Die anderen Beteiligungen des Fonds sind in Fondswährung: lokal = Fonds.
    const andere = s.zeilen.find((z: { beteiligungId: string }) => z.beteiligungId !== B);
    expect(andere.lokalWaehrung).toBe("EUR");
    expect(s.summen.bewertung.fonds).toBe(s.zeilen.reduce((a: number, z: { bewertung: { fonds: string } }) => a + Number(z.bewertung.fonds), 0).toFixed(2));
    expect(s.summen.investiert.vergleich).not.toBeNull();
    // Die Fondsrechnung (Übersicht) und die Sicht stimmen überein.
    const uebersicht = await json(await get(`/fonds/${F1}/uebersicht?stichtag=2026-06-30&stand=${encodeURIComponent(new Date().toISOString())}`, ADMIN));
    expect(uebersicht.portfoliowert).toBe(s.summen.bewertung.fonds);
    expect(s.navVergleich).toBeNull();
    // Rechte
    expect((await get(`/fonds/${F1}/waehrungssicht`, fremder)).status).toBe(403);
    expect((await get(`/beteiligungen/${B}/waehrungssicht`, fremder)).status).toBe(403);
    expect((await get(`/beteiligungen/00000000-0000-4000-8000-00000000dead/waehrungssicht`, ADMIN)).status).toBe(404);
  });

  it("ein Fonds ohne Fremdwährung braucht keine Kurse: lokal und Fonds sind gleich, keine Lücken", async () => {
    const s = await json(await get(`/fonds/${F1}/waehrungssicht?stichtag=2026-06-30`, ADMIN));
    for (const z of s.zeilen) expect(z.investiert.lokal).toBe(z.investiert.fonds);
    expect(s.luecken).toEqual([]);
  });
});


describe("Vorzeichen lokaler Beträge", () => {
  it.each(["zusage", "auszahlung", "rueckfluss", "tilgung"])("%s: ein negativer lokaler Betrag wird abgelehnt, auch ohne Fondsbetrag", async (art) => {
    await put(`/beteiligungen/${B}/waehrung`, { waehrung: "USD" }, bearbeiter);
    await kurs("2025-02-01", "EUR", "USD", "1.0800");
    for (const koerper of [{ betragLokal: "-1000.00" }, { betragLokal: "-1000.00", betrag: "900.00" }, { betragLokal: "1000.00", betrag: "-900.00" }]) {
      const r = await post(`/beteiligungen/${B}/vorgaenge`, { art, valuta: "2025-02-01", ...koerper }, bearbeiter);
      expect(r.status, `${art} ${JSON.stringify(koerper)}`).toBe(400);
    }
    const einheitlich = await post(`/fonds/${F1}/buchungen`, { typ: art, beteiligungId: B, valuta: "2025-02-01", betragLokal: "-1000.00" }, bearbeiter);
    expect(einheitlich.status).toBe(400);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM vorgang`)).rows[0]).toEqual({ n: 0 });
  });

  it("die Wertberichtigung darf beide Vorzeichen lokal haben, ein Storno bleibt möglich", async () => {
    await put(`/beteiligungen/${B}/waehrung`, { waehrung: "USD" }, bearbeiter);
    await kurs("2025-02-01", "EUR", "USD", "1.0800");
    await post(`/beteiligungen/${B}/vorgaenge`, { art: "zusage", valuta: "2025-02-01", betragLokal: "200000.00" }, bearbeiter);
    await post(`/beteiligungen/${B}/vorgaenge`, { art: "auszahlung", valuta: "2025-02-01", betragLokal: "100000.00" }, bearbeiter);
    const plus = await post(`/beteiligungen/${B}/vorgaenge`, { art: "wertberichtigung", valuta: "2025-02-01", betragLokal: "10800.00" }, bearbeiter);
    expect(plus.status, await plus.clone().text()).toBe(201);
    const plusVorgang = (await json(plus)).vorgang;
    expect(plusVorgang.betrag).toBe("10000.00");
    const minus = await post(`/beteiligungen/${B}/vorgaenge`, { art: "wertberichtigung", valuta: "2025-02-01", betragLokal: "-5400.00" }, bearbeiter);
    expect(minus.status, await minus.clone().text()).toBe(201);
    const minusVorgang = (await json(minus)).vorgang;
    expect(minusVorgang.betrag).toBe("-5000.00");
    const storno = await post(`/vorgaenge/${minusVorgang.id}/storno`, { grund: "Test" }, bearbeiter);
    expect(storno.status, await storno.clone().text()).toBe(201);
    expect((await json(storno)).storno).toMatchObject({ betrag: "5000.00", betragLokal: "5400.00" });
  });
});
