import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { erstelleDb } from "../index";
import { erzeugeDemodaten, schreibeDemoPortfolio, schreibeDemodaten } from "../demo/index";
import * as schema from "../schema";
import { TESTDB_URL, neuesInstrument } from "./hilfen";

const { db, pool } = erstelleDb(TESTDB_URL);
const daten = erzeugeDemodaten({ seed: 1 });

const leeren = () =>
  db.execute(
    sql`TRUNCATE TABLE fonds_offenlegung, melde_datei, melde_freigabe, melde_wert, melde_lauf, melde_aktivierung, organisation_meldedaten, buchungsexport_position, buchungsexport, buchungsregel, saldo, saldenlauf_befund, saldenlauf, kontenregel, gliederung_position, sachkonto, beleg_stufe, beleg_nummernkreis, beleg, beleg_art_eigen, beleg_vorlage, fonds_mittelart, beteiligung_buchhaltung, fonds_buchhaltung, wert_quelle, auslesung, dokument_seite, dokument_verknuepfung, dokument, bericht_variante, fonds_mitteilung, investor_zugang, abfrage_zugriff, kennzahl_wert, kennzahl_abfrage_position, kennzahl_abfrage, fonds_kennzahl, kontaktrolle, organisationsbeziehung, beschlussvorlage, aenderung, snapshot_auftrag, kennzahl_snapshot, rundenposition_zahlung, vorgang_runde, runde_buchung, rundenposition, anteilsklasse, finanzierungsrunde, vorgang, bewertung, beteiligung, aktivitaet, beschluss, deal_phasenwechsel, deal, fonds_bewegung, fonds, person, organisation CASCADE`,
  );

const zeilen = async (abfrage: ReturnType<typeof sql>) => (await db.execute(abfrage)).rows;
const anzahl = async (tabelle: string) => Number((await zeilen(sql.raw(`SELECT count(*)::int AS n FROM "${tabelle}"`)))[0]?.n);

beforeAll(async () => {
  await leeren();
});
afterAll(async () => {
  await leeren();
  await pool.end();
});

describe("Migrationen", () => {
  it("alle Tabellen existieren", async () => {
    const rows = await zeilen(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    const namen = rows.map((r) => r.table_name);
    for (const t of [
      "organisation", "person", "fonds", "fonds_bewegung", "deal", "deal_phasenwechsel", "aktivitaet", "beschluss", "beteiligung", "vorgang", "bewertung", "aenderung",
      "finanzierungsrunde", "rundenposition", "rundenposition_zahlung", "vorgang_runde", "runde_buchung", "kennzahl_snapshot", "snapshot_auftrag",
    ]) {
      expect(namen).toContain(t);
    }
  });
});

describe("Vorgang: Unveränderlichkeit und Storno", () => {
  let beteiligungId = "";
  let andereBeteiligungId = "";
  let instrumentId = "";
  let andereInstrumentId = "";
  let vorgangId = "";

  beforeAll(async () => {
    const [org] = await db.insert(schema.organisation).values({ name: "Testfirma", art: "unternehmen" }).returning();
    const [fonds] = await db.insert(schema.fonds).values({ name: "Testfonds", kurzname: "TF", vintage: 2024, zeichnungskapital: "1000000.00" }).returning();
    const [org2] = await db.insert(schema.organisation).values({ name: "Testfirma Zwei", art: "unternehmen" }).returning();
    const [b1] = await db
      .insert(schema.beteiligung)
      .values({ fondsId: fonds!.id, organisationId: org!.id, instrument: "offene_beteiligung", erstinvestment: "2024-01-01" })
      .returning();
    const [b2] = await db
      .insert(schema.beteiligung)
      .values({ fondsId: fonds!.id, organisationId: org2!.id, instrument: "offene_beteiligung", erstinvestment: "2024-01-01" })
      .returning();
    beteiligungId = b1!.id;
    andereBeteiligungId = b2!.id;
    instrumentId = await neuesInstrument(db, beteiligungId);
    andereInstrumentId = await neuesInstrument(db, andereBeteiligungId);
    const [v] = await db.insert(schema.vorgang).values({ beteiligungId, instrumentId, art: "auszahlung", valuta: "2024-02-01", betrag: "100000.00" }).returning();
    vorgangId = v!.id;
  });

  it("UPDATE wird abgelehnt", async () => {
    await expect(db.execute(sql`UPDATE vorgang SET bemerkung = 'x' WHERE id = ${vorgangId}`)).rejects.toThrow(/unveränderlich|Failed query/);
  });

  it("DELETE wird abgelehnt", async () => {
    await expect(db.execute(sql`DELETE FROM vorgang WHERE id = ${vorgangId}`)).rejects.toThrow(/unveränderlich|Failed query/);
  });

  it("Betrag null wird abgelehnt", async () => {
    await expect(db.insert(schema.vorgang).values({ beteiligungId, instrumentId, art: "zins", valuta: "2024-03-01", betrag: "0" })).rejects.toThrow();
  });

  it("Storno mit falschem Betrag, falscher Art oder fremder Beteiligung wird abgelehnt", async () => {
    const basis = { beteiligungId, instrumentId, art: "auszahlung" as const, valuta: "2024-02-02", storniertVorgangId: vorgangId };
    await expect(db.insert(schema.vorgang).values({ ...basis, betrag: "-99999.99" })).rejects.toThrow();
    await expect(db.insert(schema.vorgang).values({ ...basis, betrag: "100000.00" })).rejects.toThrow();
    await expect(db.insert(schema.vorgang).values({ ...basis, art: "zins", betrag: "-100000.00" })).rejects.toThrow();
    await expect(db.insert(schema.vorgang).values({ ...basis, beteiligungId: andereBeteiligungId, instrumentId: andereInstrumentId, betrag: "-100000.00" })).rejects.toThrow();
  });

  it("korrektes Storno wird angenommen, die Summe ergibt null, ein zweites Storno scheitert", async () => {
    await db.insert(schema.vorgang).values({
      beteiligungId,
      instrumentId,
      art: "auszahlung",
      valuta: "2024-02-02",
      betrag: "-100000.00",
      storniertVorgangId: vorgangId,
    });
    const [rest] = await zeilen(sql`SELECT sum(betrag)::text AS s FROM vorgang WHERE beteiligung_id = ${beteiligungId} AND art = 'auszahlung'`);
    expect(Number(rest?.s)).toBe(0);
    await expect(
      db.insert(schema.vorgang).values({
        beteiligungId,
        instrumentId,
        art: "auszahlung",
        valuta: "2024-02-03",
        betrag: "-100000.00",
        storniertVorgangId: vorgangId,
      }),
    ).rejects.toThrow();
  });
});

describe("Fondsbewegung: Unveränderlichkeit, Storno und Periodensperre", () => {
  let fondsId = "";
  let anderesFondsId = "";
  let bewegungId = "";

  beforeAll(async () => {
    const [f] = await db.insert(schema.fonds).values({ name: "Bewegungsfonds", kurzname: "BWF", vintage: 2024, zeichnungskapital: "1000000.00" }).returning();
    const [g] = await db.insert(schema.fonds).values({ name: "Bewegungsfonds Zwei", kurzname: "BWF2", vintage: 2024, zeichnungskapital: "1000000.00" }).returning();
    fondsId = f!.id;
    anderesFondsId = g!.id;
    const [b] = await db.insert(schema.fondsBewegung).values({ fondsId, art: "abruf", valuta: "2024-02-01", betrag: "50000.00" }).returning();
    bewegungId = b!.id;
  });

  it("UPDATE und DELETE werden abgelehnt", async () => {
    await expect(db.execute(sql`UPDATE fonds_bewegung SET bemerkung = 'x' WHERE id = ${bewegungId}`)).rejects.toThrow(/unveränderlich|Failed query/);
    await expect(db.execute(sql`DELETE FROM fonds_bewegung WHERE id = ${bewegungId}`)).rejects.toThrow(/unveränderlich|Failed query/);
  });

  it("Betrag null wird abgelehnt", async () => {
    await expect(db.insert(schema.fondsBewegung).values({ fondsId, art: "abruf", valuta: "2024-03-01", betrag: "0" })).rejects.toThrow();
  });

  it("Storno mit falschem Betrag, falscher Art oder fremdem Fonds wird abgelehnt", async () => {
    const basis = { fondsId, art: "abruf" as const, valuta: "2024-02-02", storniertBewegungId: bewegungId };
    await expect(db.insert(schema.fondsBewegung).values({ ...basis, betrag: "-49999.99" })).rejects.toThrow();
    await expect(db.insert(schema.fondsBewegung).values({ ...basis, betrag: "50000.00" })).rejects.toThrow();
    await expect(db.insert(schema.fondsBewegung).values({ ...basis, art: "ausschuettung", betrag: "-50000.00" })).rejects.toThrow();
    await expect(db.insert(schema.fondsBewegung).values({ ...basis, fondsId: anderesFondsId, betrag: "-50000.00" })).rejects.toThrow();
  });

  it("korrektes Storno wird angenommen, die Summe ergibt null, ein zweites Storno und ein Storno des Storno scheitern", async () => {
    const [storno] = await db.insert(schema.fondsBewegung).values({ fondsId, art: "abruf", valuta: "2024-02-02", betrag: "-50000.00", storniertBewegungId: bewegungId }).returning();
    const [rest] = await zeilen(sql`SELECT sum(betrag)::text AS s FROM fonds_bewegung WHERE fonds_id = ${fondsId} AND art = 'abruf'`);
    expect(Number(rest?.s)).toBe(0);
    await expect(db.insert(schema.fondsBewegung).values({ fondsId, art: "abruf", valuta: "2024-02-03", betrag: "-50000.00", storniertBewegungId: bewegungId })).rejects.toThrow();
    await expect(db.insert(schema.fondsBewegung).values({ fondsId, art: "abruf", valuta: "2024-02-03", betrag: "50000.00", storniertBewegungId: storno!.id })).rejects.toThrow();
  });

  it("eine Valuta in der gesperrten Periode wird vom Trigger abgelehnt (PS001)", async () => {
    await db.insert(schema.periodensperre).values({ fondsId, gesperrtBis: "2024-06-30", gesetztVon: "system" });
    await expect(db.insert(schema.fondsBewegung).values({ fondsId, art: "ausschuettung", valuta: "2024-06-30", betrag: "1.00" })).rejects.toThrow();
    await db.insert(schema.fondsBewegung).values({ fondsId, art: "ausschuettung", valuta: "2024-07-01", betrag: "1.00" });
    await db.delete(schema.periodensperre).where(eq(schema.periodensperre.fondsId, fondsId));
  });
});

describe("Änderungsprotokoll: nur anhängend", () => {
  let zeileId = "";
  beforeAll(async () => {
    const [z] = await db
      .insert(schema.aenderung)
      .values({ akteur: "system", aktion: "anlegen", tabelle: "organisation", datensatzId: "00000000-0000-4000-8000-000000000001", nachher: { name: "x" } })
      .returning();
    zeileId = z!.id;
  });

  it("INSERT geht, UPDATE und DELETE werden abgelehnt", async () => {
    await expect(db.execute(sql`UPDATE aenderung SET akteur = 'x' WHERE id = ${zeileId}`)).rejects.toThrow(/nur anhängend|Failed query/);
    await expect(db.execute(sql`DELETE FROM aenderung WHERE id = ${zeileId}`)).rejects.toThrow(/nur anhängend|Failed query/);
    expect(await anzahl("aenderung")).toBeGreaterThan(0);
  });
});

describe("Namensnormalisierung für die Dublettenprüfung", () => {
  const normalisiert = async (name: string) =>
    String((await zeilen(sql`SELECT organisation_name_normalisiert(${name}) AS n`))[0]?.n);

  it("entfernt Rechtsformen, Satzzeichen und Leerraum", async () => {
    expect(await normalisiert("Velmora Robotik GmbH")).toBe("velmora robotik");
    expect(await normalisiert("  Velmora-Robotik  GmbH & Co. KG ")).toBe("velmora robotik");
    expect(await normalisiert("Nordwind (UG haftungsbeschränkt)")).toBe("nordwind");
    expect(await normalisiert("Brandel Ltd.")).toBe("brandel");
    expect(await normalisiert("Tessin Inc")).toBe("tessin");
    expect(await normalisiert("Corvan AG")).toBe("corvan");
    expect(await normalisiert("Lumeo SE")).toBe("lumeo");
  });
});

describe("Demo-Daten schreiben", () => {
  it("schreibt alle Zeilen, Zahlen stimmen mit den erzeugten Objekten überein", async () => {
    await schreibeDemodaten(db, daten);
    const erwartet: Record<string, number> = {
      organisation: daten.organisationen.length,
      person: daten.personen.length,
      fonds: daten.fonds.length,
      fonds_bewegung: daten.fondsBewegungen.length,
      deal: daten.deals.length,
      deal_phasenwechsel: daten.dealPhasenwechsel.length,
      aktivitaet: daten.aktivitaeten.length,
      beschluss: daten.beschluesse.length,
      beteiligung: daten.beteiligungen.length,
      vorgang: daten.vorgaenge.length,
      bewertung: daten.bewertungen.length,
      fonds_kennzahl: daten.fondsKennzahlen.length,
      kennzahl_wert: daten.kennzahlWerte.length + daten.esgWerte.length,
      fonds_offenlegung: daten.fondsOffenlegungen.length,
    };
    for (const [tabelle, n] of Object.entries(erwartet)) expect(await anzahl(tabelle), tabelle).toBe(n);
  });

  it("lässt sich wiederholen (leert zuvor, auch den unveränderlichen Vorgang)", async () => {
    await schreibeDemodaten(db, daten);
    expect(await anzahl("vorgang")).toBe(daten.vorgaenge.length);
    expect(await anzahl("organisation")).toBe(daten.organisationen.length);
  });
});

describe("Demo-Portfolio: Zinsbuchungen und Zinszahlungen", () => {
  it("keine Zinsbuchung wird doppelt bezahlt, Zahlungen verweisen auf Buchungen desselben Instruments, einzelne Buchungen bleiben offen", async () => {
    await schreibeDemodaten(db, daten);
    await schreibeDemoPortfolio(db);
    const zuViel = await zeilen(sql`
      SELECT z.id FROM vorgang z
      JOIN LATERAL (SELECT coalesce(sum(p.betrag), 0) AS s FROM vorgang p WHERE p.beglichen_vorgang_id = z.id) x ON true
      WHERE z.art = 'zins' AND x.s > z.betrag`);
    expect(zuViel).toEqual([]);
    const fremd = await zeilen(sql`SELECT p.id FROM vorgang p JOIN vorgang z ON z.id = p.beglichen_vorgang_id WHERE p.instrument_id <> z.instrument_id OR z.art <> 'zins'`);
    expect(fremd).toEqual([]);
    const offen = await zeilen(sql`SELECT z.id FROM vorgang z WHERE z.art = 'zins' AND NOT z.kapitalisiert AND NOT EXISTS (SELECT 1 FROM vorgang p WHERE p.beglichen_vorgang_id = z.id)`);
    expect(offen.length).toBeGreaterThan(0);
    const bezahlt = await zeilen(sql`SELECT count(*)::int AS n FROM vorgang WHERE art = 'zinszahlung'`);
    expect(Number(bezahlt[0]?.n)).toBeGreaterThan(0);
  });
});

describe("Rundenposition und Ausgangskorb", () => {
  beforeAll(async () => {
    await leeren();
  });

  it("verlangt genau einen Investor je Position", async () => {
    const [org] = await db.insert(schema.organisation).values({ name: "Rundenfirma", art: "unternehmen" }).returning();
    const [inv] = await db.insert(schema.organisation).values({ name: "Rundeninvestor", art: "investor" }).returning();
    const [f] = await db.insert(schema.fonds).values({ name: "Rundenfonds", kurzname: "RF", vintage: 2024, zeichnungskapital: "1000000.00" }).returning();
    const [runde] = await db
      .insert(schema.finanzierungsrunde)
      .values({ organisationId: org!.id, bezeichnung: "Seed", datum: "2024-01-01", preMoney: "1000000.00", postMoney: "1200000.00", preisJeAnteil: "1.0000", anteileGesamtNach: "1200000" })
      .returning();
    const [v] = await db.insert(schema.vehikel).values({ investorId: inv!.id, name: "Rundeninvestor Fonds I", standard: true }).returning();
    const basis = { rundeId: runde!.id, betrag: "100000.00", anteile: "100000", rolle: "lead" as const };
    await expect(db.insert(schema.rundenposition).values({ ...basis })).rejects.toThrow();
    await expect(db.insert(schema.rundenposition).values({ ...basis, fondsId: f!.id, vehikelId: v!.id })).rejects.toThrow();
    await db.insert(schema.rundenposition).values({ ...basis, fondsId: f!.id });
    await db.insert(schema.rundenposition).values({ ...basis, vehikelId: v!.id, rolle: "co" });
    // Vehikel: höchstens ein Standard je Investor, Name eindeutig je Investor, Auflagejahr plausibel.
    await expect(db.insert(schema.vehikel).values({ investorId: inv!.id, name: "Zweiter Standard", standard: true })).rejects.toThrow();
    await expect(db.insert(schema.vehikel).values({ investorId: inv!.id, name: "Rundeninvestor Fonds I" })).rejects.toThrow();
    await expect(db.insert(schema.vehikel).values({ investorId: inv!.id, name: "Altes Vehikel", auflagejahr: 1800 })).rejects.toThrow();
    await expect(
      db.insert(schema.finanzierungsrunde).values({ organisationId: org!.id, bezeichnung: "X", datum: "2024-02-01", preMoney: "2000000.00", postMoney: "1000000.00", preisJeAnteil: "1.0000", anteileGesamtNach: "1" }),
    ).rejects.toThrow();
  });

  it("Trigger legen je Fonds einen Auftrag an, auch bei vielen Zeilen in einer Anweisung", async () => {
    await leeren();
    const [org] = await db.insert(schema.organisation).values({ name: "Auftragsfirma", art: "unternehmen" }).returning();
    const [f] = await db.insert(schema.fonds).values({ name: "Auftragsfonds", kurzname: "AF", vintage: 2024, zeichnungskapital: "1000000.00" }).returning();
    const [b] = await db
      .insert(schema.beteiligung)
      .values({ fondsId: f!.id, organisationId: org!.id, instrument: "offene_beteiligung", erstinvestment: "2024-01-01" })
      .returning();
    // Auch eine neue Beteiligung löst einen Auftrag aus.
    expect(await anzahl("snapshot_auftrag")).toBe(1);
    await db.execute(sql`DELETE FROM snapshot_auftrag`);
    const auftragInstrument = await neuesInstrument(db, b!.id);
    await db.insert(schema.vorgang).values([
      { beteiligungId: b!.id, instrumentId: auftragInstrument, art: "auszahlung", valuta: "2024-02-01", betrag: "1.00" },
      { beteiligungId: b!.id, instrumentId: auftragInstrument, art: "auszahlung", valuta: "2024-03-01", betrag: "2.00" },
    ]);
    expect(await anzahl("snapshot_auftrag")).toBe(1);
    await db.insert(schema.bewertung).values({ beteiligungId: b!.id, stichtag: "2024-03-31", wert: "3.00", methode: "sonstige", status: "freigegeben" as const });
    await db.insert(schema.fondsBewegung).values({ fondsId: f!.id, art: "abruf", valuta: "2024-02-01", betrag: "3.00" });
    expect(await anzahl("snapshot_auftrag")).toBe(1);
    await db.execute(sql`DELETE FROM snapshot_auftrag`);
    await db.insert(schema.bewertung).values({ beteiligungId: b!.id, stichtag: "2024-06-30", wert: "3.00", methode: "sonstige", status: "freigegeben" as const });
    expect(await anzahl("snapshot_auftrag")).toBe(1);
    await db.execute(sql`DELETE FROM snapshot_auftrag`);
    await db.insert(schema.fondsBewegung).values({ fondsId: f!.id, art: "abruf", valuta: "2024-05-01", betrag: "3.00" });
    expect(await anzahl("snapshot_auftrag")).toBe(1);
  });
});

describe("Bericht: Schutz freigegebener Berichte und ihrer Abschnitte", () => {
  const stufen = JSON.stringify(["A", "B"]);
  async function bericht(status: string) {
    const [f] = await zeilen(sql`INSERT INTO fonds (name, kurzname, vintage, zeichnungskapital) VALUES ('Schutzfonds', ${`S${Math.random()}`}, 2024, 1) RETURNING id`);
    const [b] = await zeilen(
      sql`INSERT INTO bericht (art, format, fonds_id, stichtag, sprache, freigabestufen, erstellt_von, status) VALUES ('lp_bericht', 'pdf', ${f!.id as string}, '2025-12-31', 'de', ${stufen}::jsonb, 'x', ${status}::bericht_status) RETURNING id`,
    );
    return b!.id as string;
  }

  it("ein Abschnitt lässt sich nicht in einen anderen Bericht verschieben (weder aus noch in einen freigegebenen)", async () => {
    const entwurf = await bericht("entwurf");
    const zweiter = await bericht("entwurf");
    const frei = await bericht("freigegeben");
    const [a] = await zeilen(sql`INSERT INTO bericht_abschnitt (bericht_id, schluessel, geaendert_von) VALUES (${entwurf}, 'vorwort', 'x') RETURNING id`);
    await expect(db.execute(sql`UPDATE bericht_abschnitt SET bericht_id = ${frei} WHERE id = ${a!.id as string}`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE bericht_abschnitt SET bericht_id = ${zweiter} WHERE id = ${a!.id as string}`)).rejects.toThrow();
    const [b] = await zeilen(sql`INSERT INTO bericht_abschnitt (bericht_id, schluessel, geaendert_von) VALUES (${zweiter}, 'ausblick', 'x') RETURNING id`);
    await db.execute(sql`UPDATE bericht SET status = 'freigegeben' WHERE id = ${zweiter}`);
    await expect(db.execute(sql`UPDATE bericht_abschnitt SET bericht_id = ${entwurf} WHERE id = ${b!.id as string}`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE bericht_abschnitt SET text_de = 'neu' WHERE id = ${b!.id as string}`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM bericht_abschnitt WHERE id = ${b!.id as string}`)).rejects.toThrow();
    await expect(db.execute(sql`INSERT INTO bericht_abschnitt (bericht_id, schluessel, geaendert_von) VALUES (${frei}, 'vorwort', 'x')`)).rejects.toThrow();
    await db.execute(sql`UPDATE bericht_abschnitt SET text_de = 'ok' WHERE id = ${a!.id as string}`);
    await expect(db.execute(sql`UPDATE bericht SET erstellt_von = 'y' WHERE id = ${frei}`)).rejects.toThrow();
  });
});

describe("Bericht: Abschnittsänderung und Freigabe überlappen nicht", () => {
  it("eine offene Abschnittsänderung sperrt die Freigabe des Berichts (zwei Verbindungen)", async () => {
    const [f] = await zeilen(sql`INSERT INTO fonds (name, kurzname, vintage, zeichnungskapital) VALUES ('Sperrfonds', ${`L${Math.random()}`}, 2024, 1) RETURNING id`);
    const [b] = await zeilen(
      sql`INSERT INTO bericht (art, format, fonds_id, stichtag, sprache, freigabestufen, erstellt_von) VALUES ('lp_bericht', 'pdf', ${f!.id as string}, '2025-12-31', 'de', '["A"]'::jsonb, 'x') RETURNING id`,
    );
    const id = b!.id as string;
    const [a] = await zeilen(sql`INSERT INTO bericht_abschnitt (bericht_id, schluessel, geaendert_von) VALUES (${id}, 'vorwort', 'x') RETURNING id`);
    const eins = await pool.connect();
    const zwei = await pool.connect();
    try {
      await eins.query("BEGIN");
      await eins.query("UPDATE bericht_abschnitt SET text_de = 'in Arbeit' WHERE id = $1", [a!.id]);
      await zwei.query("BEGIN");
      await zwei.query("SET LOCAL lock_timeout = '300ms'");
      // Die Freigabe muss auf die Abschnittsänderung warten (Sperrzeit statt Überholen)
      await expect(zwei.query("UPDATE bericht SET status = 'freigegeben' WHERE id = $1", [id])).rejects.toMatchObject({ code: "55P03" });
      await zwei.query("ROLLBACK");
      await eins.query("COMMIT");
      // Umgekehrt: Ist der Bericht gesperrt (Freigabe läuft), wartet die Abschnittsänderung und sieht danach den freigegebenen Bericht
      await zwei.query("BEGIN");
      await zwei.query("UPDATE bericht SET status = 'freigegeben' WHERE id = $1", [id]);
      await eins.query("BEGIN");
      await eins.query("SET LOCAL lock_timeout = '300ms'");
      await expect(eins.query("UPDATE bericht_abschnitt SET text_de = 'zu spät' WHERE id = $1", [a!.id])).rejects.toMatchObject({ code: "55P03" });
      await eins.query("ROLLBACK");
      await zwei.query("COMMIT");
      await expect(db.execute(sql`UPDATE bericht_abschnitt SET text_de = 'danach' WHERE id = ${a!.id as string}`)).rejects.toThrow();
    } finally {
      eins.release();
      zwei.release();
    }
  });
});
