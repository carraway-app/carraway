import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { hatFehlercode, istPeriodensperre } from "../app";
import { leeren, json, oeffneTestdb } from "./hilfen";
import { anzahl, aufrufe, grundbestand, ID, leereAuftraege, protokollZeilen } from "./hilfen-instrumente";
import { erstelleTestApp, idVon, legePersonAn, person, STANDARD, type Testperson } from "./hilfen-auth";
import { hauptinstrumentId } from "../instrumente/hauptinstrument";
import { vorgaengeEinfuegen } from "./instrument-hilfen";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const { get, post, put } = aufrufe(t);

const F1 = ID.fonds;
const F2 = ID.anderer;
const B2 = "00000000-0000-4000-8000-0000000000c2";
const verwalter = person("verwalter-f1", { rollen: { [F1]: "verwalter" } });
const freigeber = person("freigeber-f1", { rollen: { [F1]: "freigeber" } });

const sperre = (gesperrtBis: string, grund?: string, als?: Testperson) => put(`/fonds/${F1}/periodensperre`, { gesperrtBis, ...(grund ? { grund } : {}) }, als);
const gesperrt = async (antwort: Response, bis: string) => {
  expect(antwort.status).toBe(409);
  const { fehler } = await json(antwort);
  expect(fehler.code).toBe("PERIODE_GESPERRT");
  expect(fehler.gesperrtBis).toBe(bis);
};
/** Fehler von Postgres mit SQLSTATE und Meldung. */
const sqlFehler = async (abfrage: string, werte: unknown[] = []) => {
  try {
    await pool.query(abfrage, werte);
    return null;
  } catch (e) {
    return e as { code: string; message: string };
  }
};

beforeEach(async () => {
  await grundbestand(db);
  await db.insert(s.beteiligung).values({ id: B2, fondsId: F2, organisationId: ID.orgA, instrument: "offene_beteiligung", erstinvestment: "2025-01-01" });
  await legePersonAn(db, verwalter);
  await legePersonAn(db, freigeber);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Endpunkte GET und PUT /fonds/:id/periodensperre", () => {
  it("ohne Sperre sind alle Felder leer; Verwalter setzen sie, jeder Fonds hat seine eigene", async () => {
    expect(await get(`/fonds/${F1}/periodensperre`).then(json)).toEqual({ fondsId: F1, gesperrtBis: null, gesetztVon: null, gesetztVonName: null, gesetztAm: null, grund: null });
    const gesetzt = await sperre("2025-12-31", "Jahresabschluss 2025", verwalter);
    expect(gesetzt.status).toBe(200);
    expect(await json(gesetzt)).toMatchObject({ fondsId: F1, gesperrtBis: "2025-12-31", gesetztVon: await idVon(db, verwalter), gesetztVonName: verwalter.name, grund: "Jahresabschluss 2025" });
    expect((await get(`/fonds/${F2}/periodensperre`).then(json)).gesperrtBis).toBeNull();
    expect((await get(`/fonds/${F1}/periodensperre`, verwalter).then(json)).gesperrtBis).toBe("2025-12-31");
  });

  it("nur Verwalter: Freigeber, Bearbeiter und Betrachter bekommen 403, in der Datenbank ändert sich nichts", async () => {
    expect((await sperre("2025-12-31", undefined, freigeber)).status).toBe(403);
    expect((await get(`/fonds/${F1}/periodensperre`, freigeber)).status).toBe(403);
    expect(await anzahl(db, "periodensperre")).toBe(0);
  });

  it("vorwärts schieben braucht keinen Grund; zurücknehmen verlangt einen Grund und wird eigens protokolliert", async () => {
    expect((await sperre("2025-06-30")).status).toBe(200);
    expect((await sperre("2025-12-31")).status).toBe(200);
    const ohneGrund = await sperre("2025-09-30");
    expect(ohneGrund.status).toBe(400);
    expect((await json(ohneGrund)).fehler.felder[0]).toMatchObject({ feld: "grund", code: "grund_erforderlich" });
    expect((await get(`/fonds/${F1}/periodensperre`).then(json)).gesperrtBis).toBe("2025-12-31");

    const zurueck = await sperre("2025-09-30", "Korrektur einer Eingangsrechnung");
    expect(zurueck.status).toBe(200);
    expect((await json(zurueck)).gesperrtBis).toBe("2025-09-30");
    const zeilen = await protokollZeilen(db, "fonds");
    expect(zeilen.map((z) => z.aktion)).toEqual(["periodensperre_setzen", "periodensperre_setzen", "periodensperre_zurueck"]);
    expect(zeilen[2]).toMatchObject({ akteur: await idVon(db, STANDARD), akteur_name: STANDARD.name });
    expect(zeilen[2]!.vorher).toMatchObject({ gesperrtBis: "2025-12-31" });
    expect(zeilen[2]!.nachher).toMatchObject({ gesperrtBis: "2025-09-30", grund: "Korrektur einer Eingangsrechnung" });
  });

  it("ein Sperrdatum in der Zukunft, ein ungültiges Datum und ein unbekannter Fonds werden abgelehnt", async () => {
    expect((await sperre("2999-01-01")).status).toBe(400);
    expect((await put(`/fonds/${F1}/periodensperre`, { gesperrtBis: "gestern" })).status).toBe(400);
    expect((await put(`/fonds/00000000-0000-4000-8000-0000000000ff/periodensperre`, { gesperrtBis: "2025-12-31" })).status).toBe(404);
  });
});

describe("Buchungswege in der API: 409 PERIODE_GESPERRT am und vor dem Sperrdatum", () => {
  it("Vorgang: Valuta am Sperrdatum gesperrt, am Tag danach frei; andere Fonds bleiben frei", async () => {
    await sperre("2025-12-31");
    const vorher = await anzahl(db, "vorgang");
    await gesperrt(await post(`/beteiligungen/${ID.eigen}/vorgaenge`, { art: "zusage", valuta: "2025-12-31", betrag: "1000" }), "2025-12-31");
    await gesperrt(await post(`/beteiligungen/${ID.eigen}/vorgaenge`, { art: "rueckfluss", valuta: "2025-03-01", betrag: "1000" }), "2025-12-31");
    expect(await anzahl(db, "vorgang")).toBe(vorher);
    expect((await post(`/beteiligungen/${ID.eigen}/vorgaenge`, { art: "zusage", valuta: "2026-01-01", betrag: "1000" })).status).toBe(201);
    expect((await post(`/beteiligungen/${B2}/vorgaenge`, { art: "zusage", valuta: "2025-03-01", betrag: "1000" })).status).toBe(201);
  });

  it("Storno: eine Valuta in der gesperrten Periode ist gesperrt, die Standardvaluta (heute) nicht", async () => {
    const original = (await post(`/beteiligungen/${ID.eigen}/vorgaenge`, { art: "zusage", valuta: "2025-03-01", betrag: "1000" }).then(json)).vorgang.id;
    await sperre("2025-12-31");
    await gesperrt(await post(`/vorgaenge/${original}/storno`, { grund: "Irrtum", valuta: "2025-06-01" }), "2025-12-31");
    const frei = await post(`/vorgaenge/${original}/storno`, { grund: "Irrtum" });
    expect(frei.status).toBe(201);
    expect((await json(frei)).storno.valuta > "2025-12-31").toBe(true);
  });

  it("Verkauf, Kaufpreisanpassung, Forderung und Insolvenz", async () => {
    const b = ID.eigen;
    await post(`/beteiligungen/${b}/vorgaenge`, { art: "zusage", valuta: "2025-01-01", betrag: "1000000" });
    await post(`/beteiligungen/${b}/vorgaenge`, { art: "auszahlung", valuta: "2025-02-01", betrag: "500000" });
    await db.insert(s.bewertung).values({ beteiligungId: b, stichtag: "2025-12-31", wert: "450000.00", methode: "letzte_runde" });
    await leereAuftraege(db);

    // Insolvenz einer Beteiligung in der Sperre, Bewertung (Stichtag) inklusive
    await sperre("2026-03-31");
    await gesperrt(await post(`/beteiligungen/${b}/insolvenz`, { datum: "2026-03-31" }), "2026-03-31");
    await gesperrt(await post(`/beteiligungen/${b}/verkauf`, { datum: "2026-03-15", kaufpreis: "700000", anteilVerkauft: 1 }), "2026-03-31");
    expect(await anzahl(db, "verkauf")).toBe(0);

    const verkauf = await post(`/beteiligungen/${b}/verkauf`, { datum: "2026-06-30", kaufpreis: "700000", treuhand: { betrag: "50000", freigabeAm: "2027-06-30" }, anteilVerkauft: 1 });
    expect(verkauf.status).toBe(201);
    const forderung = (await json(verkauf)).forderung.id;
    await gesperrt(await post(`/beteiligungen/${b}/kaufpreisanpassung`, { datum: "2026-02-01", betrag: "1000", grund: "Earn-out" }), "2026-03-31");
    expect((await post(`/beteiligungen/${b}/kaufpreisanpassung`, { datum: "2026-07-01", betrag: "1000", grund: "Earn-out" })).status).toBe(201);

    await sperre("2026-10-31");
    await gesperrt(await post(`/forderungen/${forderung}/erfuellt`, { datum: "2026-10-31" }), "2026-10-31");
    expect((await post(`/forderungen/${forderung}/erfuellt`, { datum: "2026-11-01" })).status).toBe(200);
  });

  it("Zinslauf buchen: liegt eine Periode in der Sperre, bricht die Buchung ab und der Lauf bleibt freigegeben", async () => {
    await post(`/beteiligungen/${ID.darlehen}/vorgaenge`, { art: "zusage", valuta: "2025-01-01", betrag: "200000" });
    await post(`/beteiligungen/${ID.darlehen}/vorgaenge`, { art: "auszahlung", valuta: "2025-01-01", betrag: "100000" });
    await post(`/beteiligungen/${ID.darlehen}/konditionen`, { gueltigAb: "2025-01-01", satzFix: "0.06", methode: "30E/360", zinsperiode: "jaehrlich", anker: "2026-01-01" });
    const lauf = await post("/zinslaeufe", { fondsId: F1, stichtag: "2027-01-01" }).then(json);
    expect(lauf.positionen.map((p: { bis: string }) => p.bis)).toEqual(["2026-01-01", "2027-01-01"]);
    await post(`/zinslaeufe/${lauf.id}/pruefen`, {}, "a");
    await post(`/zinslaeufe/${lauf.id}/freigeben`, {}, "b");

    await sperre("2026-01-01");
    await gesperrt(await post(`/zinslaeufe/${lauf.id}/buchen`, {}, "c"), "2026-01-01");
    expect(await anzahl(db, "vorgang", "art = 'zins'")).toBe(0);
    expect((await get(`/zinslaeufe/${lauf.id}`).then(json)).status).toBe("freigegeben");

    await sperre("2025-12-31", "Sperre auf das Jahr 2025 zurückgenommen");
    expect((await post(`/zinslaeufe/${lauf.id}/buchen`, {}, "c")).status).toBe(200);
    expect(await anzahl(db, "vorgang", "art = 'zins'")).toBe(2);
  });

  it("Wandlung: der Stichtag (Cut-off) darf nicht in der Sperre liegen", async () => {
    const b = ID.wandel;
    await post(`/beteiligungen/${b}/vorgaenge`, { art: "zusage", valuta: "2026-01-01", betrag: "200000" });
    await post(`/beteiligungen/${b}/vorgaenge`, { art: "auszahlung", valuta: "2026-01-01", betrag: "100000" });
    await post(`/beteiligungen/${b}/konditionen`, { gueltigAb: "2026-01-01", satzFix: "0.06", methode: "30E/360", zinsperiode: "jaehrlich", anker: "2027-01-01" });
    const eingabe = {
      cutoff: "2026-07-01",
      zinsenWandeln: true,
      preisregel: { rundenpreisJeAnteil: "12.5", discount: "0.2" },
      nennwertJeAnteil: "1",
      runde: { neu: { bezeichnung: "Serie A", preMoney: "8000000", postMoney: "10000000", preisJeAnteil: "12.5", anteileGesamtNach: "800000" } },
    };
    await sperre("2026-07-01");
    await gesperrt(await post(`/beteiligungen/${b}/wandlung`, eingabe), "2026-07-01");
    expect(await anzahl(db, "wandlung")).toBe(0);
    await sperre("2026-06-30", "Sperre eine Periode früher");
    expect((await post(`/beteiligungen/${b}/wandlung`, eingabe)).status).toBe(201);
  });

  it("Übergang eines Deals ins Portfolio: die Zusage mit Valuta Erstinvestment unterliegt der Sperre", async () => {
    const deal = "00000000-0000-4000-8000-0000000000d1";
    // Ein Unternehmen, das der Fonds noch nicht hält (je Fonds und Unternehmen gibt es nur eine Beteiligung).
    const neueOrg = "00000000-0000-4000-8000-0000000000d2";
    await db.insert(s.organisation).values({ id: neueOrg, name: "Delta Beispiel", art: "unternehmen" });
    await db.insert(s.deal).values({ id: deal, organisationId: neueOrg, fondsId: F1, titel: "Deal" });
    await post(`/deals/${deal}/beschluesse`, { gremium: "IA", datum: "2025-05-01", ergebnis: "zugestimmt", betrag: "100000" }, "a");
    const uebergang = { fondsId: F1, instrument: "darlehen", erstinvestment: "2025-06-01", zusage: "50000" };
    await sperre("2025-06-01");
    await gesperrt(await post(`/deals/${deal}/beteiligung`, uebergang), "2025-06-01");
    expect(await anzahl(db, "beteiligung", "deal_id IS NOT NULL")).toBe(0);
    expect((await post(`/deals/${deal}/beteiligung`, { ...uebergang, erstinvestment: "2025-06-02" })).status).toBe(201);
  });
});

describe("Trigger in der Datenbank: auch direkte Zugriffe an der API vorbei werden abgewiesen", () => {
  const vorgangEinfuegen = async (valuta: string, beteiligung: string = ID.eigen) =>
    sqlFehler(`INSERT INTO vorgang (beteiligung_id, instrument_id, art, valuta, betrag) VALUES ($1, $3, 'zusage', $2, 100)`, [beteiligung, valuta, await hauptinstrumentId(db, beteiligung)]);
  const bewertungEinfuegen = (stichtag: string, beteiligung: string = ID.eigen) =>
    sqlFehler(`INSERT INTO bewertung (beteiligung_id, stichtag, wert, methode) VALUES ($1, $2, 100, 'sonstige')`, [beteiligung, stichtag]);

  it("INSERT in vorgang: am und vor dem Sperrdatum SQLSTATE PS001 mit Meldung PERIODE_GESPERRT, danach erlaubt", async () => {
    expect(await vorgangEinfuegen("2025-06-01")).toBeNull(); // ohne Sperre
    await sperre("2025-12-31");
    for (const tag of ["2025-12-31", "2025-06-01", "1999-01-01"]) {
      const fehler = await vorgangEinfuegen(tag);
      expect(fehler, tag).not.toBeNull();
      expect(fehler!.code).toBe("PS001");
      expect(fehler!.message).toContain("PERIODE_GESPERRT");
    }
    expect(await vorgangEinfuegen("2026-01-01")).toBeNull();
    expect(await vorgangEinfuegen("2025-06-01", B2)).toBeNull(); // anderer Fonds
    // Auch der Weg über Drizzle bricht ab.
    await expect(vorgaengeEinfuegen(db, { beteiligungId: ID.eigen, art: "zusage", valuta: "2025-01-01", betrag: "10.00" })).rejects.toSatisfy((e) => istPeriodensperre(e));
  });

  it("INSERT und UPDATE in bewertung: Stichtage in der gesperrten Periode sind gesperrt, auch das Überschreiben einer vorhandenen Bewertung", async () => {
    expect(await bewertungEinfuegen("2025-06-30")).toBeNull();
    await sperre("2025-12-31");
    const neu = await bewertungEinfuegen("2025-09-30");
    expect(neu).not.toBeNull();
    expect(neu!.code).toBe("PS001");
    const aendern = await sqlFehler(`UPDATE bewertung SET wert = 999 WHERE beteiligung_id = $1 AND stichtag = '2025-06-30'`, [ID.eigen]);
    expect(aendern?.code).toBe("PS001");
    const verschieben = await sqlFehler(`UPDATE bewertung SET stichtag = '2026-03-31' WHERE beteiligung_id = $1 AND stichtag = '2025-06-30'`, [ID.eigen]);
    expect(verschieben?.code).toBe("PS001");
    expect(await bewertungEinfuegen("2026-03-31")).toBeNull();
    expect(await bewertungEinfuegen("2025-09-30", B2)).toBeNull();
  });

  it("wird die Sperre zurückgenommen, sind die Tage wieder buchbar", async () => {
    await sperre("2025-12-31");
    expect((await vorgangEinfuegen("2025-06-01"))?.code).toBe("PS001");
    await sperre("2025-03-31", "Nachbuchung genehmigt");
    expect(await vorgangEinfuegen("2025-06-01")).toBeNull();
    expect((await vorgangEinfuegen("2025-03-31"))?.code).toBe("PS001");
  });

  it("die Zuordnung der Datenbankfehler: PS001 in der Ursachenkette ist die Periodensperre", () => {
    expect(istPeriodensperre({ cause: { code: "PS001" } })).toBe(true);
    expect(istPeriodensperre({ code: "PS001" })).toBe(true);
    expect(istPeriodensperre(new Error("anderer Fehler"))).toBe(false);
    expect(hatFehlercode({ cause: { cause: { code: "23505" } } }, "23505")).toBe(true);
  });

  it("Demo-Daten und Seed sind nicht betroffen, solange keine Sperre gesetzt ist", async () => {
    await db.delete(s.periodensperre).where(and(eq(s.periodensperre.fondsId, F1)));
    expect(await vorgangEinfuegen("1990-01-01")).toBeNull();
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM periodensperre`)).rows[0]).toEqual({ n: 0 });
  });
});
