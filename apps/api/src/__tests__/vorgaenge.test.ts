import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, idVon, person } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { anzahl, aufrufe, auftraege, grundbestand, ID, json, leereAuftraege, protokollZeilen } from "./hilfen-instrumente";
import { vorgaengeEinfuegen } from "./instrument-hilfen";

const { db, pool } = oeffneTestdb();
const { get, post, put } = aufrufe(erstelleTestApp(db));

const vorgang = (b: string, koerper: unknown, akteur?: string) => post(`/beteiligungen/${b}/vorgaenge`, koerper, akteur);

beforeEach(async () => {
  await grundbestand(db);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("POST /beteiligungen/:id/vorgaenge", () => {
  it("schreibt eine Zusage mit Protokollzeile und stößt die Neuberechnung an", async () => {
    const antwort = await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag: "500000.00", bemerkung: "Vertrag" }, "bearbeiter");
    expect(antwort.status).toBe(201);
    const d = await json(antwort);
    expect(d.vorgang).toMatchObject({ art: "zusage", betrag: "500000.00", valuta: "2025-01-01", bemerkung: "Vertrag" });
    const zeilen = await protokollZeilen(db, "vorgang", "anlegen");
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]).toMatchObject({ akteur: await idVon(db, person("bearbeiter")), akteur_name: "Testperson bearbeiter", datensatz_id: d.vorgang.id });
    expect(await auftraege(db)).toBe(1);
  });

  it("verlangt gültige Eingaben und sammelt Feldfehler", async () => {
    const antwort = await vorgang(ID.darlehen, { art: "auszahlung", valuta: "morgen", betrag: "-5" });
    expect(antwort.status).toBe(400);
    const d = await json(antwort);
    expect(d.fehler.code).toBe("EINGABE_UNGUELTIG");
    expect(d.fehler.felder.map((f: { feld: string }) => f.feld).sort()).toEqual(["betrag", "valuta"]);
    expect((await vorgang(ID.darlehen, { art: "zins", valuta: "2025-01-01", betrag: "10" })).status).toBe(400);
    expect((await vorgang(ID.darlehen, { art: "wertberichtigung", valuta: "2025-01-01", betrag: "0" })).status).toBe(400);
  });

  it("unbekannte Beteiligung ist 404", async () => {
    const antwort = await vorgang("00000000-0000-4000-8000-0000000000ff", { art: "zusage", valuta: "2025-01-01", betrag: "1" });
    expect(antwort.status).toBe(404);
    expect((await json(antwort)).fehler.code).toBe("BETEILIGUNG_NICHT_GEFUNDEN");
  });

  it("Auszahlungen dürfen die Zusage netto nicht übersteigen", async () => {
    await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag: "100000" });
    expect((await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-02-01", betrag: "60000" })).status).toBe(201);
    const zuViel = await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-03-01", betrag: "40000.01" });
    expect(zuViel.status).toBe(409);
    expect((await json(zuViel)).fehler).toMatchObject({ code: "AUSZAHLUNG_UEBER_ZUSAGE", zusage: "100000.00", investiert: "100000.01" });
    expect(await anzahl(db, "vorgang", "art = 'auszahlung'")).toBe(1);
    // genau bis zur Zusage ist erlaubt
    expect((await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-03-01", betrag: "40000" })).status).toBe(201);
  });

  it("eine Auszahlung ohne aktive Beteiligung wird abgelehnt", async () => {
    await vorgang(ID.eigen, { art: "zusage", valuta: "2025-01-01", betrag: "1000" });
    await db.update(s.beteiligung).set({ status: "exit" }).where(eq(s.beteiligung.id, ID.eigen));
    const antwort = await vorgang(ID.eigen, { art: "auszahlung", valuta: "2025-02-01", betrag: "1000" });
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).fehler.code).toBe("BETEILIGUNG_NICHT_AKTIV");
  });

  it("Rückfluss ist ohne weitere Prüfung möglich", async () => {
    const antwort = await vorgang(ID.eigen, { art: "rueckfluss", valuta: "2025-06-01", betrag: "2500.50" });
    expect(antwort.status).toBe(201);
  });

  it("Tilgung nur bei Darlehen und höchstens in Höhe des offenen Kapitals, auch zeitlich", async () => {
    await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag: "100000" });
    await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-02-01", betrag: "50000" });
    await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-08-01", betrag: "50000" });

    const auf = await vorgang(ID.eigen, { art: "tilgung", valuta: "2025-06-01", betrag: "10" });
    expect(auf.status).toBe(409);
    expect((await json(auf)).fehler.code).toBe("INSTRUMENT_PASST_NICHT");

    // vor der zweiten Auszahlung sind nur 50.000 offen
    const zuFrueh = await vorgang(ID.darlehen, { art: "tilgung", valuta: "2025-06-01", betrag: "60000" });
    expect(zuFrueh.status).toBe(409);
    expect((await json(zuFrueh)).fehler.code).toBe("KAPITALVERLAUF_UNGUELTIG");

    expect((await vorgang(ID.darlehen, { art: "tilgung", valuta: "2025-09-01", betrag: "60000" })).status).toBe(201);
    const rest = await vorgang(ID.darlehen, { art: "tilgung", valuta: "2025-10-01", betrag: "40000.01" });
    expect(rest.status).toBe(409);
    expect((await vorgang(ID.darlehen, { art: "tilgung", valuta: "2025-10-01", betrag: "40000" })).status).toBe(201);
  });

  it("Wertberichtigung: Zuführung bis zum Buchwert, Auflösung höchstens bis zur Berichtigung", async () => {
    await vorgang(ID.eigen, { art: "zusage", valuta: "2025-01-01", betrag: "100000" });
    await vorgang(ID.eigen, { art: "auszahlung", valuta: "2025-02-01", betrag: "100000" });

    const zuHoch = await vorgang(ID.eigen, { art: "wertberichtigung", valuta: "2025-12-31", betrag: "100000.01" });
    expect(zuHoch.status).toBe(409);
    expect((await json(zuHoch)).fehler).toMatchObject({ code: "BUCHWERT_NEGATIV", buchwert: "-0.01" });

    const zufuehrung = await vorgang(ID.eigen, { art: "wertberichtigung", valuta: "2025-12-31", betrag: "40000" });
    expect(zufuehrung.status).toBe(201);
    expect((await json(zufuehrung)).buchwert).toBe("60000.00");

    const zuViel = await vorgang(ID.eigen, { art: "wertberichtigung", valuta: "2026-03-31", betrag: "-40000.01" });
    expect(zuViel.status).toBe(409);
    expect((await json(zuViel)).fehler.code).toBe("AUFLOESUNG_UEBER_BERICHTIGUNG");

    const aufloesung = await vorgang(ID.eigen, { art: "wertberichtigung", valuta: "2026-03-31", betrag: "-15000" });
    expect(aufloesung.status).toBe(201);
    expect((await json(aufloesung)).buchwert).toBe("75000.00");
  });
});

describe("Meilensteine und Tranchen", () => {
  it("Auszahlung zu einem offenen Meilenstein wird abgelehnt, nach Erfüllung gezahlt", async () => {
    await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag: "300000" });
    const angelegt = await post(`/beteiligungen/${ID.darlehen}/meilensteine`, { bezeichnung: "Tranche 2", bedingung: "Umsatz über Plan", frist: "2025-09-30", betrag: "100000" }, "bearbeiter");
    expect(angelegt.status).toBe(201);
    const meilenstein = await json(angelegt);
    expect(meilenstein).toMatchObject({ bezeichnung: "Tranche 2", betrag: "100000.00", erfuelltAm: null });

    const offen = await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-10-01", betrag: "100000", meilensteinId: meilenstein.id });
    expect(offen.status).toBe(409);
    expect((await json(offen)).fehler.code).toBe("MEILENSTEIN_OFFEN");
    expect(await anzahl(db, "vorgang", "art = 'auszahlung'")).toBe(0);

    const erfuellt = await post(`/meilensteine/${meilenstein.id}/erfuellt`, { datum: "2025-09-15", nachweis: "Bericht Q3" });
    expect(erfuellt.status).toBe(200);
    expect(await json(erfuellt)).toMatchObject({ erfuelltAm: "2025-09-15", nachweis: "Bericht Q3" });
    const nochmal = await post(`/meilensteine/${meilenstein.id}/erfuellt`, {});
    expect(nochmal.status).toBe(409);
    expect((await json(nochmal)).fehler.code).toBe("MEILENSTEIN_ERFUELLT");

    const gezahlt = await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-10-01", betrag: "60000", meilensteinId: meilenstein.id });
    expect(gezahlt.status).toBe(201);
    expect((await json(gezahlt)).vorgang.meilensteinId).toBe(meilenstein.id);

    const zuViel = await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-10-02", betrag: "40000.01", meilensteinId: meilenstein.id });
    expect(zuViel.status).toBe(409);
    expect((await json(zuViel)).fehler.code).toBe("MEILENSTEIN_BETRAG_UEBERSCHRITTEN");
    expect((await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-10-02", betrag: "40000", meilensteinId: meilenstein.id })).status).toBe(201);

    expect((await protokollZeilen(db, "meilenstein")).map((z) => z.aktion)).toEqual(["anlegen", "erfuellen"]);
  });

  it("ein Meilenstein einer anderen Beteiligung und ein unbekannter werden abgelehnt", async () => {
    await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag: "300000" });
    const fremd = await json(await post(`/beteiligungen/${ID.wandel}/meilensteine`, { bezeichnung: "Fremd", betrag: "1000" }));
    const falsch = await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-02-01", betrag: "1000", meilensteinId: fremd.id });
    expect(falsch.status).toBe(409);
    expect((await json(falsch)).fehler.code).toBe("MEILENSTEIN_FALSCHE_BETEILIGUNG");
    const unbekannt = await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-02-01", betrag: "1000", meilensteinId: "00000000-0000-4000-8000-0000000000ee" });
    expect(unbekannt.status).toBe(404);
    expect((await post(`/meilensteine/00000000-0000-4000-8000-0000000000ee/erfuellt`, {})).status).toBe(404);
  });
});

describe("POST /vorgaenge/:id/storno", () => {
  it("legt die Gegenbuchung an, protokolliert und stößt die Neuberechnung an", async () => {
    await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag: "100000" });
    const original = (await json(await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-02-01", betrag: "30000" }))).vorgang;
    await leereAuftraege(db);

    const antwort = await post(`/vorgaenge/${original.id}/storno`, { grund: "Betrag falsch erfasst", valuta: "2025-02-10" }, "bearbeiter");
    expect(antwort.status).toBe(201);
    const d = await json(antwort);
    expect(d.storno).toMatchObject({ art: "auszahlung", betrag: "-30000.00", valuta: "2025-02-10", storniertVorgangId: original.id, bemerkung: "Storno: Betrag falsch erfasst" });
    const zeilen = await protokollZeilen(db, "vorgang");
    expect(zeilen.filter((z) => z.aktion === "storno")).toHaveLength(1);
    expect(zeilen.filter((z) => z.aktion === "storno")[0]).toMatchObject({ datensatz_id: original.id });
    expect(await auftraege(db)).toBe(1);

    const daten = await json(await get(`/beteiligungen/${ID.darlehen}/instrumentdaten`));
    expect(daten.zustand.investiert).toBe("0.00");
  });

  it("ein Storno wird nicht storniert und ein Vorgang nicht zweimal", async () => {
    await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag: "100000" });
    const original = (await json(await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-02-01", betrag: "30000" }))).vorgang;
    const storno = (await json(await post(`/vorgaenge/${original.id}/storno`, { grund: "Fehler" }))).storno;
    const zweimal = await post(`/vorgaenge/${original.id}/storno`, { grund: "Nochmal" });
    expect(zweimal.status).toBe(409);
    expect((await json(zweimal)).fehler.code).toBe("BEREITS_STORNIERT");
    const vomStorno = await post(`/vorgaenge/${storno.id}/storno`, { grund: "Rückgängig" });
    expect(vomStorno.status).toBe(409);
    expect((await json(vomStorno)).fehler.code).toBe("STORNO_UNZULAESSIG");
    expect((await post(`/vorgaenge/00000000-0000-4000-8000-0000000000ee/storno`, { grund: "x" })).status).toBe(404);
    expect((await post(`/vorgaenge/${original.id}/storno`, { grund: "" })).status).toBe(400);
  });

  it("die Zusage lässt sich nicht stornieren, solange Auszahlungen darauf beruhen", async () => {
    const zusage = (await json(await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag: "100000" }))).vorgang;
    await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-02-01", betrag: "30000" });
    const antwort = await post(`/vorgaenge/${zusage.id}/storno`, { grund: "Irrtum" });
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).fehler.code).toBe("AUSZAHLUNG_UEBER_ZUSAGE");
  });

  it("eine Auszahlung lässt sich nicht stornieren, wenn die Tilgung dann übersteigt", async () => {
    await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag: "100000" });
    const auszahlung = (await json(await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-02-01", betrag: "30000" }))).vorgang;
    await vorgang(ID.darlehen, { art: "tilgung", valuta: "2025-06-01", betrag: "10000" });
    const antwort = await post(`/vorgaenge/${auszahlung.id}/storno`, { grund: "Irrtum" });
    expect(antwort.status).toBe(409);
    expect(["KAPITALVERLAUF_UNGUELTIG", "BUCHWERT_NEGATIV"]).toContain((await json(antwort)).fehler.code);
  });
});

describe("Storno: gemeinsame Invarianten und Rückdatierung", () => {
  it("lehnt eine Storno-Valuta vor dem Original mit Feldfehler ab", async () => {
    await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag: "100000" });
    const original = (await json(await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-02-01", betrag: "30000" }))).vorgang;
    const antwort = await post(`/vorgaenge/${original.id}/storno`, { grund: "Irrtum", valuta: "2025-01-31" });
    expect(antwort.status).toBe(400);
    const d = await json(antwort);
    expect(d.fehler.code).toBe("EINGABE_UNGUELTIG");
    expect(d.fehler.felder[0].feld).toBe("valuta");
    expect(await anzahl(db, "vorgang", "storniert_vorgang_id IS NOT NULL")).toBe(0);
  });

  it("Storno einer kapitalisierten Zinsbuchung wird abgelehnt, wenn die Tilgung dann das Kapital übersteigt", async () => {
    await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag: "100000" });
    await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-01-01", betrag: "100000" });
    const [zins] = await vorgaengeEinfuegen(db, { beteiligungId: ID.darlehen, art: "zins", valuta: "2025-12-31", betrag: "6000.00", kapitalisiert: true });
    await vorgang(ID.darlehen, { art: "tilgung", valuta: "2026-03-01", betrag: "106000" });
    const antwort = await post(`/vorgaenge/${zins!.id}/storno`, { grund: "Irrtum" });
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).fehler.code).toBe("KAPITALVERLAUF_UNGUELTIG");
  });

  it("Storno einer Auszahlung, die den Buchwert negativ machen würde, wird bei Eigenkapital abgelehnt", async () => {
    await vorgang(ID.eigen, { art: "zusage", valuta: "2025-01-01", betrag: "100000" });
    const a = (await json(await vorgang(ID.eigen, { art: "auszahlung", valuta: "2025-02-01", betrag: "100000" }))).vorgang;
    await vorgang(ID.eigen, { art: "wertberichtigung", valuta: "2025-12-31", betrag: "60000" });
    await vorgang(ID.eigen, { art: "wertberichtigung", valuta: "2026-01-31", betrag: "-10000" });
    const antwort = await post(`/vorgaenge/${a.id}/storno`, { grund: "Irrtum" });
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).fehler.code).toBe("BUCHWERT_NEGATIV");
  });

  it("Storno eines Rückflusses bleibt ohne Invariantenprüfung möglich", async () => {
    const r = (await json(await vorgang(ID.eigen, { art: "rueckfluss", valuta: "2025-06-01", betrag: "500" }))).vorgang;
    expect((await post(`/vorgaenge/${r.id}/storno`, { grund: "Irrtum" })).status).toBe(201);
  });
});

describe("POST /beteiligungen/:id/konditionen", () => {
  const v1 = { gueltigAb: "2025-01-01", satzFix: "0.06", methode: "30E/360", zinsperiode: "jaehrlich", anker: "2025-12-31", kapitalisieren: false };

  it("legt Versionen an, die über gueltigAb unterschieden werden", async () => {
    const erste = await post(`/beteiligungen/${ID.darlehen}/konditionen`, { ...v1, faelligAm: "2030-12-31" }, "bearbeiter");
    expect(erste.status).toBe(201);
    expect(await json(erste)).toMatchObject({ satzFix: "0.060000", methode: "30E/360", zinsperiode: "jaehrlich", anker: "2025-12-31", faelligAm: "2030-12-31", gewinnabhaengigSatz: null });
    // Vertragsänderung: neue Zeile, Raster aus der ersten Version übernommen
    const zweite = await post(`/beteiligungen/${ID.darlehen}/konditionen`, { gueltigAb: "2026-07-01", satzFix: "0.08", methode: "act/365", gewinnabhaengigSatz: "0.1", kappungSatz: "0.03" });
    expect(zweite.status).toBe(201);
    expect(await json(zweite)).toMatchObject({ satzFix: "0.080000", zinsperiode: "jaehrlich", anker: "2025-12-31", gewinnabhaengigSatz: "0.100000", kappungSatz: "0.030000" });
    const daten = await json(await get(`/beteiligungen/${ID.darlehen}/instrumentdaten`));
    expect(daten.konditionen.map((k: { gueltigAb: string }) => k.gueltigAb)).toEqual(["2025-01-01", "2026-07-01"]);
    expect(await protokollZeilen(db, "darlehen_kondition", "anlegen")).toHaveLength(2);
  });

  it("lehnt doppeltes Datum, geändertes Raster, falsches Instrument und unvollständige Gewinnkomponente ab", async () => {
    await post(`/beteiligungen/${ID.darlehen}/konditionen`, v1);
    const doppelt = await post(`/beteiligungen/${ID.darlehen}/konditionen`, v1);
    expect(doppelt.status).toBe(409);
    expect((await json(doppelt)).fehler.code).toBe("KONDITION_VORHANDEN");
    const raster = await post(`/beteiligungen/${ID.darlehen}/konditionen`, { ...v1, gueltigAb: "2026-01-01", zinsperiode: "quartalsweise" });
    expect(raster.status).toBe(409);
    expect((await json(raster)).fehler.code).toBe("KONDITION_RASTER_UNGLEICH");
    const anker = await post(`/beteiligungen/${ID.darlehen}/konditionen`, { ...v1, gueltigAb: "2026-01-01", anker: "2025-06-30" });
    expect((await json(anker)).fehler.code).toBe("KONDITION_RASTER_UNGLEICH");
    const eigen = await post(`/beteiligungen/${ID.eigen}/konditionen`, v1);
    expect(eigen.status).toBe(409);
    expect((await json(eigen)).fehler.code).toBe("INSTRUMENT_PASST_NICHT");
    const paar = await post(`/beteiligungen/${ID.wandel}/konditionen`, { ...v1, gewinnabhaengigSatz: "0.1" });
    expect(paar.status).toBe(400);
    const satz = await post(`/beteiligungen/${ID.wandel}/konditionen`, { ...v1, satzFix: "6" });
    expect(satz.status).toBe(400);
    const ohneRaster = await post(`/beteiligungen/${ID.wandel}/konditionen`, { gueltigAb: "2025-01-01", satzFix: "0.05", methode: "act/360" });
    expect(ohneRaster.status).toBe(400);
  });

  it("lehnt ferne Daten für Anker, Fälligkeit, Stundung und Gültigkeit ab", async () => {
    const basis = { gueltigAb: "2025-01-01", satzFix: "0.06", methode: "30E/360", zinsperiode: "quartalsweise", anker: "2025-12-31" };
    for (const [feld, wert] of [["anker", "9999-12-31"], ["faelligAm", "9999-12-31"], ["stundungBis", "9999-12-31"], ["gueltigAb", "1800-01-01"]] as const) {
      const antwort = await post(`/beteiligungen/${ID.darlehen}/konditionen`, { ...basis, [feld]: wert });
      expect(antwort.status).toBe(400);
      expect((await json(antwort)).fehler.felder[0]).toMatchObject({ feld, code: "datum_ausserhalb" });
    }
    expect(await anzahl(db, "darlehen_kondition")).toBe(0);
  });

  it("endfällig nimmt den Anker aus der Fälligkeit, eine spätere Version darf sie verschieben", async () => {
    const erste = await post(`/beteiligungen/${ID.wandel}/konditionen`, { gueltigAb: "2025-01-01", satzFix: "0.05", methode: "act/365", zinsperiode: "endfaellig", faelligAm: "2027-12-31" });
    expect(await json(erste)).toMatchObject({ anker: "2027-12-31" });
    const verlaengert = await post(`/beteiligungen/${ID.wandel}/konditionen`, { gueltigAb: "2026-06-01", satzFix: "0.05", methode: "act/365", zinsperiode: "endfaellig", faelligAm: "2028-12-31" });
    expect(verlaengert.status).toBe(201);
  });
});

describe("PUT /beteiligungen/:id/jahresueberschuss/:jahr", () => {
  it("legt an, ersetzt und protokolliert", async () => {
    const neu = await put(`/beteiligungen/${ID.darlehen}/jahresueberschuss/2025`, { betrag: "-12000.50" }, "bearbeiter");
    expect(neu.status).toBe(200);
    expect(await json(neu)).toMatchObject({ jahr: 2025, betrag: "-12000.50" });
    const ersetzt = await put(`/beteiligungen/${ID.darlehen}/jahresueberschuss/2025`, { betrag: "50000" });
    expect(await json(ersetzt)).toMatchObject({ betrag: "50000.00" });
    expect(await anzahl(db, "jahresueberschuss")).toBe(1);
    expect((await protokollZeilen(db, "jahresueberschuss")).map((z) => z.aktion)).toEqual(["anlegen", "aendern"]);
    expect((await put(`/beteiligungen/${ID.darlehen}/jahresueberschuss/2025`, { betrag: "abc" })).status).toBe(400);
    expect((await put(`/beteiligungen/${ID.darlehen}/jahresueberschuss/jahr`, { betrag: "1" })).status).toBe(400);
  });
});

describe("GET /beteiligungen/:id/instrumentdaten", () => {
  it("liefert Zustand, Buchwert mit Herkunft, Meilensteine und Konditionen", async () => {
    await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag: "100000" });
    await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-02-01", betrag: "80000" });
    await vorgang(ID.darlehen, { art: "tilgung", valuta: "2025-06-01", betrag: "20000" });
    await vorgang(ID.darlehen, { art: "wertberichtigung", valuta: "2025-12-31", betrag: "5000" });
    const d = await json(await get(`/beteiligungen/${ID.darlehen}/instrumentdaten`));
    expect(d.zustand).toMatchObject({ zusage: "100000.00", investiert: "80000.00", offeneZusage: "20000.00", tilgungen: "20000.00", wertberichtigungen: "5000.00", offenesKapital: "60000.00" });
    expect(d.buchwert.wert).toBe("55000.00");
    expect(d.buchwert.schritte.at(-1)).toMatchObject({ zeichen: "=", wert: "55000" });
    expect(d.konditionen).toEqual([]);
    expect((await get(`/beteiligungen/00000000-0000-4000-8000-0000000000ff/instrumentdaten`)).status).toBe(404);
  });

  it("ein Vorgang kann ohne Kapitalisierung nicht über die Datenbank verändert werden (Unveränderlichkeit bleibt)", async () => {
    await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag: "100" });
    await expect(db.update(s.vorgang).set({ betrag: "1" }).where(and(eq(s.vorgang.beteiligungId, ID.darlehen)))).rejects.toThrow();
  });
});
