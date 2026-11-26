import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, idVon, person } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { anzahl, aufrufe, auftraege, grundbestand, ID, json, leereAuftraege, protokollZeilen } from "./hilfen-instrumente";
import { vorgaengeEinfuegen } from "./instrument-hilfen";

const { db, pool } = oeffneTestdb();
const { get, post, put } = aufrufe(erstelleTestApp(db));

const vorgang = (b: string, koerper: unknown, akteur?: string) => post(`/investments/${b}/transactions`, koerper, akteur);

beforeEach(async () => {
  await grundbestand(db);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("POST /investments/:id/transactions", () => {
  it("schreibt eine Zusage mit Protokollzeile und stößt die Neuberechnung an", async () => {
    const antwort = await vorgang(ID.darlehen, { type: "commitment", valueDate: "2025-01-01", amount: "500000.00", remark: "Vertrag" }, "bearbeiter");
    expect(antwort.status).toBe(201);
    const d = await json(antwort);
    expect(d.transaction).toMatchObject({ type: "commitment", amount: "500000.00", valueDate: "2025-01-01", remark: "Vertrag" });
    const zeilen = await protokollZeilen(db, "vorgang", "anlegen");
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]).toMatchObject({ akteur: await idVon(db, person("bearbeiter")), akteur_name: "Testperson bearbeiter", datensatz_id: d.transaction.id });
    expect(await auftraege(db)).toBe(1);
  });

  it("verlangt gültige Eingaben und sammelt Feldfehler", async () => {
    const antwort = await vorgang(ID.darlehen, { type: "disbursement", valueDate: "morgen", amount: "-5" });
    expect(antwort.status).toBe(400);
    const d = await json(antwort);
    expect(d.error.code).toBe("invalid_input");
    expect(d.error.fields.map((f: { field: string }) => f.field).sort()).toEqual(["amount", "valueDate"]);
    expect((await vorgang(ID.darlehen, { type: "interest", valueDate: "2025-01-01", amount: "10" })).status).toBe(400);
    expect((await vorgang(ID.darlehen, { type: "impairment", valueDate: "2025-01-01", amount: "0" })).status).toBe(400);
  });

  it("unbekannte Beteiligung ist 404", async () => {
    const antwort = await vorgang("00000000-0000-4000-8000-0000000000ff", { type: "commitment", valueDate: "2025-01-01", amount: "1" });
    expect(antwort.status).toBe(404);
    expect((await json(antwort)).error.code).toBe("investment_not_found");
  });

  it("Auszahlungen dürfen die Zusage netto nicht übersteigen", async () => {
    await vorgang(ID.darlehen, { type: "commitment", valueDate: "2025-01-01", amount: "100000" });
    expect((await vorgang(ID.darlehen, { type: "disbursement", valueDate: "2025-02-01", amount: "60000" })).status).toBe(201);
    const zuViel = await vorgang(ID.darlehen, { type: "disbursement", valueDate: "2025-03-01", amount: "40000.01" });
    expect(zuViel.status).toBe(409);
    expect((await json(zuViel)).error).toMatchObject({ code: "disbursement_exceeds_commitment", commitment: "100000.00", invested: "100000.01" });
    expect(await anzahl(db, "vorgang", "art = 'auszahlung'")).toBe(1);
    // genau bis zur Zusage ist erlaubt
    expect((await vorgang(ID.darlehen, { type: "disbursement", valueDate: "2025-03-01", amount: "40000" })).status).toBe(201);
  });

  it("eine Auszahlung ohne aktive Beteiligung wird abgelehnt", async () => {
    await vorgang(ID.eigen, { type: "commitment", valueDate: "2025-01-01", amount: "1000" });
    await db.update(s.beteiligung).set({ status: "exit" }).where(eq(s.beteiligung.id, ID.eigen));
    const antwort = await vorgang(ID.eigen, { type: "disbursement", valueDate: "2025-02-01", amount: "1000" });
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).error.code).toBe("investment_not_active");
  });

  it("Rückfluss ist ohne weitere Prüfung möglich", async () => {
    const antwort = await vorgang(ID.eigen, { type: "return_flow", valueDate: "2025-06-01", amount: "2500.50" });
    expect(antwort.status).toBe(201);
  });

  it("Tilgung nur bei Darlehen und höchstens in Höhe des offenen Kapitals, auch zeitlich", async () => {
    await vorgang(ID.darlehen, { type: "commitment", valueDate: "2025-01-01", amount: "100000" });
    await vorgang(ID.darlehen, { type: "disbursement", valueDate: "2025-02-01", amount: "50000" });
    await vorgang(ID.darlehen, { type: "disbursement", valueDate: "2025-08-01", amount: "50000" });

    const auf = await vorgang(ID.eigen, { type: "repayment", valueDate: "2025-06-01", amount: "10" });
    expect(auf.status).toBe(409);
    expect((await json(auf)).error.code).toBe("instrument_mismatch");

    // vor der zweiten Auszahlung sind nur 50.000 offen
    const zuFrueh = await vorgang(ID.darlehen, { type: "repayment", valueDate: "2025-06-01", amount: "60000" });
    expect(zuFrueh.status).toBe(409);
    expect((await json(zuFrueh)).error).toMatchObject({ code: "capital_history_invalid", reason: "negative_outstanding_capital", valueDate: "2025-06-01", amount: "-10000" });

    expect((await vorgang(ID.darlehen, { type: "repayment", valueDate: "2025-09-01", amount: "60000" })).status).toBe(201);
    const rest = await vorgang(ID.darlehen, { type: "repayment", valueDate: "2025-10-01", amount: "40000.01" });
    expect(rest.status).toBe(409);
    expect((await vorgang(ID.darlehen, { type: "repayment", valueDate: "2025-10-01", amount: "40000" })).status).toBe(201);
  });

  it("Wertberichtigung: Zuführung bis zum Buchwert, Auflösung höchstens bis zur Berichtigung", async () => {
    await vorgang(ID.eigen, { type: "commitment", valueDate: "2025-01-01", amount: "100000" });
    await vorgang(ID.eigen, { type: "disbursement", valueDate: "2025-02-01", amount: "100000" });

    const zuHoch = await vorgang(ID.eigen, { type: "impairment", valueDate: "2025-12-31", amount: "100000.01" });
    expect(zuHoch.status).toBe(409);
    expect((await json(zuHoch)).error).toMatchObject({ code: "book_value_negative", bookValue: "-0.01" });

    const zufuehrung = await vorgang(ID.eigen, { type: "impairment", valueDate: "2025-12-31", amount: "40000" });
    expect(zufuehrung.status).toBe(201);
    expect((await json(zufuehrung)).bookValue).toBe("60000.00");

    const zuViel = await vorgang(ID.eigen, { type: "impairment", valueDate: "2026-03-31", amount: "-40000.01" });
    expect(zuViel.status).toBe(409);
    expect((await json(zuViel)).error.code).toBe("release_exceeds_adjustment");

    const aufloesung = await vorgang(ID.eigen, { type: "impairment", valueDate: "2026-03-31", amount: "-15000" });
    expect(aufloesung.status).toBe(201);
    expect((await json(aufloesung)).bookValue).toBe("75000.00");
  });
});

describe("Meilensteine und Tranchen", () => {
  it("Auszahlung zu einem offenen Meilenstein wird abgelehnt, nach Erfüllung gezahlt", async () => {
    await vorgang(ID.darlehen, { type: "commitment", valueDate: "2025-01-01", amount: "300000" });
    const angelegt = await post(`/beteiligungen/${ID.darlehen}/meilensteine`, { bezeichnung: "Tranche 2", bedingung: "Umsatz über Plan", frist: "2025-09-30", betrag: "100000" }, "bearbeiter");
    expect(angelegt.status).toBe(201);
    const meilenstein = await json(angelegt);
    expect(meilenstein).toMatchObject({ bezeichnung: "Tranche 2", betrag: "100000.00", erfuelltAm: null });

    const offen = await vorgang(ID.darlehen, { type: "disbursement", valueDate: "2025-10-01", amount: "100000", trancheId: meilenstein.id });
    expect(offen.status).toBe(409);
    expect((await json(offen)).error.code).toBe("milestone_open");
    expect(await anzahl(db, "vorgang", "art = 'auszahlung'")).toBe(0);

    const erfuellt = await post(`/meilensteine/${meilenstein.id}/erfuellt`, { datum: "2025-09-15", nachweis: "Bericht Q3" });
    expect(erfuellt.status).toBe(200);
    expect(await json(erfuellt)).toMatchObject({ erfuelltAm: "2025-09-15", nachweis: "Bericht Q3" });
    const nochmal = await post(`/meilensteine/${meilenstein.id}/erfuellt`, {});
    expect(nochmal.status).toBe(409);
    expect((await json(nochmal)).error.code).toBe("milestone_fulfilled");

    const gezahlt = await vorgang(ID.darlehen, { type: "disbursement", valueDate: "2025-10-01", amount: "60000", trancheId: meilenstein.id });
    expect(gezahlt.status).toBe(201);
    expect((await json(gezahlt)).transaction.trancheId).toBe(meilenstein.id);

    const zuViel = await vorgang(ID.darlehen, { type: "disbursement", valueDate: "2025-10-02", amount: "40000.01", trancheId: meilenstein.id });
    expect(zuViel.status).toBe(409);
    expect((await json(zuViel)).error.code).toBe("milestone_amount_exceeded");
    expect((await vorgang(ID.darlehen, { type: "disbursement", valueDate: "2025-10-02", amount: "40000", trancheId: meilenstein.id })).status).toBe(201);

    expect((await protokollZeilen(db, "meilenstein")).map((z) => z.aktion)).toEqual(["anlegen", "erfuellen"]);
  });

  it("ein Meilenstein einer anderen Beteiligung und ein unbekannter werden abgelehnt", async () => {
    await vorgang(ID.darlehen, { type: "commitment", valueDate: "2025-01-01", amount: "300000" });
    const fremd = await json(await post(`/beteiligungen/${ID.wandel}/meilensteine`, { bezeichnung: "Fremd", betrag: "1000" }));
    const falsch = await vorgang(ID.darlehen, { type: "disbursement", valueDate: "2025-02-01", amount: "1000", trancheId: fremd.id });
    expect(falsch.status).toBe(409);
    expect((await json(falsch)).error.code).toBe("milestone_wrong_investment");
    const unbekannt = await vorgang(ID.darlehen, { type: "disbursement", valueDate: "2025-02-01", amount: "1000", trancheId: "00000000-0000-4000-8000-0000000000ee" });
    expect(unbekannt.status).toBe(404);
    expect((await post(`/meilensteine/00000000-0000-4000-8000-0000000000ee/erfuellt`, {})).status).toBe(404);
  });
});

describe("POST /transactions/:id/reverse", () => {
  it("legt die Gegenbuchung an, protokolliert und stößt die Neuberechnung an", async () => {
    await vorgang(ID.darlehen, { type: "commitment", valueDate: "2025-01-01", amount: "100000" });
    const original = (await json(await vorgang(ID.darlehen, { type: "disbursement", valueDate: "2025-02-01", amount: "30000" }))).transaction;
    await leereAuftraege(db);

    const antwort = await post(`/transactions/${original.id}/reverse`, { reason: "Betrag falsch erfasst", valueDate: "2025-02-10" }, "bearbeiter");
    expect(antwort.status).toBe(201);
    const d = await json(antwort);
    expect(d.reversal).toMatchObject({ type: "disbursement", amount: "-30000.00", valueDate: "2025-02-10", reversedTransactionId: original.id, remark: "Storno: Betrag falsch erfasst" });
    const zeilen = await protokollZeilen(db, "vorgang");
    expect(zeilen.filter((z) => z.aktion === "storno")).toHaveLength(1);
    expect(zeilen.filter((z) => z.aktion === "storno")[0]).toMatchObject({ datensatz_id: original.id });
    expect(await auftraege(db)).toBe(1);

    const daten = await json(await get(`/beteiligungen/${ID.darlehen}/instrumentdaten`));
    expect(daten.zustand.investiert).toBe("0.00");
  });

  it("ein Storno wird nicht storniert und ein Vorgang nicht zweimal", async () => {
    await vorgang(ID.darlehen, { type: "commitment", valueDate: "2025-01-01", amount: "100000" });
    const original = (await json(await vorgang(ID.darlehen, { type: "disbursement", valueDate: "2025-02-01", amount: "30000" }))).transaction;
    const storno = (await json(await post(`/transactions/${original.id}/reverse`, { reason: "Fehler" }))).reversal;
    const zweimal = await post(`/transactions/${original.id}/reverse`, { reason: "Nochmal" });
    expect(zweimal.status).toBe(409);
    expect((await json(zweimal)).error.code).toBe("already_reversed");
    const vomStorno = await post(`/transactions/${storno.id}/reverse`, { reason: "Rückgängig" });
    expect(vomStorno.status).toBe(409);
    expect((await json(vomStorno)).error.code).toBe("reversal_not_allowed");
    expect((await post(`/transactions/00000000-0000-4000-8000-0000000000ee/reverse`, { reason: "x" })).status).toBe(404);
    expect((await post(`/transactions/${original.id}/reverse`, { reason: "" })).status).toBe(400);
  });

  it("die Zusage lässt sich nicht stornieren, solange Auszahlungen darauf beruhen", async () => {
    const zusage = (await json(await vorgang(ID.darlehen, { type: "commitment", valueDate: "2025-01-01", amount: "100000" }))).transaction;
    await vorgang(ID.darlehen, { type: "disbursement", valueDate: "2025-02-01", amount: "30000" });
    const antwort = await post(`/transactions/${zusage.id}/reverse`, { reason: "Irrtum" });
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).error.code).toBe("disbursement_exceeds_commitment");
  });

  it("eine Auszahlung lässt sich nicht stornieren, wenn die Tilgung dann übersteigt", async () => {
    await vorgang(ID.darlehen, { type: "commitment", valueDate: "2025-01-01", amount: "100000" });
    const auszahlung = (await json(await vorgang(ID.darlehen, { type: "disbursement", valueDate: "2025-02-01", amount: "30000" }))).transaction;
    await vorgang(ID.darlehen, { type: "repayment", valueDate: "2025-06-01", amount: "10000" });
    const antwort = await post(`/transactions/${auszahlung.id}/reverse`, { reason: "Irrtum" });
    expect(antwort.status).toBe(409);
    expect(["capital_history_invalid", "book_value_negative"]).toContain((await json(antwort)).error.code);
  });
});

describe("Storno: gemeinsame Invarianten und Rückdatierung", () => {
  it("lehnt eine Storno-Valuta vor dem Original mit Feldfehler ab", async () => {
    await vorgang(ID.darlehen, { type: "commitment", valueDate: "2025-01-01", amount: "100000" });
    const original = (await json(await vorgang(ID.darlehen, { type: "disbursement", valueDate: "2025-02-01", amount: "30000" }))).transaction;
    const antwort = await post(`/transactions/${original.id}/reverse`, { reason: "Irrtum", valueDate: "2025-01-31" });
    expect(antwort.status).toBe(400);
    const d = await json(antwort);
    expect(d.error.code).toBe("invalid_input");
    expect(d.error.fields[0].field).toBe("valueDate");
    expect(await anzahl(db, "vorgang", "storniert_vorgang_id IS NOT NULL")).toBe(0);
  });

  it("Storno einer kapitalisierten Zinsbuchung wird abgelehnt, wenn die Tilgung dann das Kapital übersteigt", async () => {
    await vorgang(ID.darlehen, { type: "commitment", valueDate: "2025-01-01", amount: "100000" });
    await vorgang(ID.darlehen, { type: "disbursement", valueDate: "2025-01-01", amount: "100000" });
    const [zins] = await vorgaengeEinfuegen(db, { beteiligungId: ID.darlehen, art: "zins", valuta: "2025-12-31", betrag: "6000.00", kapitalisiert: true });
    await vorgang(ID.darlehen, { type: "repayment", valueDate: "2026-03-01", amount: "106000" });
    const antwort = await post(`/transactions/${zins!.id}/reverse`, { reason: "Irrtum" });
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).error.code).toBe("capital_history_invalid");
  });

  it("Storno einer Auszahlung, die den Buchwert negativ machen würde, wird bei Eigenkapital abgelehnt", async () => {
    await vorgang(ID.eigen, { type: "commitment", valueDate: "2025-01-01", amount: "100000" });
    const a = (await json(await vorgang(ID.eigen, { type: "disbursement", valueDate: "2025-02-01", amount: "100000" }))).transaction;
    await vorgang(ID.eigen, { type: "impairment", valueDate: "2025-12-31", amount: "60000" });
    await vorgang(ID.eigen, { type: "impairment", valueDate: "2026-01-31", amount: "-10000" });
    const antwort = await post(`/transactions/${a.id}/reverse`, { reason: "Irrtum" });
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).error.code).toBe("book_value_negative");
  });

  it("Storno eines Rückflusses bleibt ohne Invariantenprüfung möglich", async () => {
    const r = (await json(await vorgang(ID.eigen, { type: "return_flow", valueDate: "2025-06-01", amount: "500" }))).transaction;
    expect((await post(`/transactions/${r.id}/reverse`, { reason: "Irrtum" })).status).toBe(201);
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
    expect((await json(doppelt)).error.code).toBe("terms_exist");
    const raster = await post(`/beteiligungen/${ID.darlehen}/konditionen`, { ...v1, gueltigAb: "2026-01-01", zinsperiode: "quartalsweise" });
    expect(raster.status).toBe(409);
    expect((await json(raster)).error.code).toBe("terms_schedule_mismatch");
    const anker = await post(`/beteiligungen/${ID.darlehen}/konditionen`, { ...v1, gueltigAb: "2026-01-01", anker: "2025-06-30" });
    expect((await json(anker)).error.code).toBe("terms_schedule_mismatch");
    const eigen = await post(`/beteiligungen/${ID.eigen}/konditionen`, v1);
    expect(eigen.status).toBe(409);
    expect((await json(eigen)).error.code).toBe("instrument_mismatch");
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
      expect((await json(antwort)).error.fields[0]).toMatchObject({ field: feld, code: "date_out_of_range" });
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
    await vorgang(ID.darlehen, { type: "commitment", valueDate: "2025-01-01", amount: "100000" });
    await vorgang(ID.darlehen, { type: "disbursement", valueDate: "2025-02-01", amount: "80000" });
    await vorgang(ID.darlehen, { type: "repayment", valueDate: "2025-06-01", amount: "20000" });
    await vorgang(ID.darlehen, { type: "impairment", valueDate: "2025-12-31", amount: "5000" });
    const d = await json(await get(`/beteiligungen/${ID.darlehen}/instrumentdaten`));
    expect(d.zustand).toMatchObject({ zusage: "100000.00", investiert: "80000.00", offeneZusage: "20000.00", tilgungen: "20000.00", wertberichtigungen: "5000.00", offenesKapital: "60000.00" });
    expect(d.buchwert.wert).toBe("55000.00");
    expect(d.buchwert.schritte.at(-1)).toMatchObject({ zeichen: "=", wert: "55000" });
    expect(d.konditionen).toEqual([]);
    expect((await get(`/beteiligungen/00000000-0000-4000-8000-0000000000ff/instrumentdaten`)).status).toBe(404);
  });

  it("ein Vorgang kann ohne Kapitalisierung nicht über die Datenbank verändert werden (Unveränderlichkeit bleibt)", async () => {
    await vorgang(ID.darlehen, { type: "commitment", valueDate: "2025-01-01", amount: "100" });
    await expect(db.update(s.vorgang).set({ betrag: "1" }).where(and(eq(s.vorgang.beteiligungId, ID.darlehen)))).rejects.toThrow();
  });
});
