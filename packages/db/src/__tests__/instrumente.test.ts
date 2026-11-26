import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { erstelleDb } from "../index";
import * as schema from "../schema";
import { TESTDB_URL, neuesInstrument } from "./hilfen";

/** Pflichten und Eindeutigkeiten des Portfolio-Modells (Instrument, Tranche, Vorgang, Zinsperiode). */

const { db, pool } = erstelleDb(TESTDB_URL);

const leeren = () => db.execute(sql`TRUNCATE TABLE zinsperiode_gebucht, tranche, darlehen_kondition, vorgang, instrument, beteiligung, fonds, organisation, snapshot_auftrag CASCADE`);

let fondsId = "";
let beteiligungId = "";
let andereBeteiligungId = "";
let eigenkapital = "";
let darlehen = "";

beforeAll(async () => {
  await leeren();
  const [org] = await db.insert(schema.organisation).values({ name: "Instrumentfirma", art: "unternehmen" }).returning();
  const [fonds] = await db.insert(schema.fonds).values({ name: "Instrumentfonds", kurzname: "IF", vintage: 2024, zeichnungskapital: "1000000.00" }).returning();
  fondsId = fonds!.id;
  const [b] = await db.insert(schema.beteiligung).values({ fondsId, organisationId: org!.id, instrument: "offene_beteiligung", erstinvestment: "2024-01-01" }).returning();
  beteiligungId = b!.id;
  // zweite Beteiligung, damit Zuordnungen über Beteiligungen hinweg geprüft werden können
  const [org2] = await db.insert(schema.organisation).values({ name: "Instrumentfirma Zwei", art: "unternehmen" }).returning();
  const [b2] = await db.insert(schema.beteiligung).values({ fondsId, organisationId: org2!.id, instrument: "darlehen", erstinvestment: "2024-01-01" }).returning();
  andereBeteiligungId = b2!.id;
  // Zwei Instrumente derselben Beteiligung, auch mehrere derselben Art sind erlaubt
  eigenkapital = await neuesInstrument(db, beteiligungId, "offene_beteiligung");
  darlehen = await neuesInstrument(db, beteiligungId, "venture_debt");
  await neuesInstrument(db, beteiligungId, "venture_debt");
});
afterAll(async () => {
  await leeren();
  await pool.end();
});

describe("Instrument und Vorgang", () => {
  it("neue Arten sind gültig: venture_debt, gesellschafterdarlehen, zinszahlung, dividende", async () => {
    const arten = (await db.execute(sql`SELECT unnest(enum_range(NULL::instrument_art))::text AS w`)).rows.map((r) => r.w);
    expect(arten).toEqual(expect.arrayContaining(["venture_debt", "gesellschafterdarlehen"]));
    const vorgaenge = (await db.execute(sql`SELECT unnest(enum_range(NULL::vorgang_art))::text AS w`)).rows.map((r) => r.w);
    expect(vorgaenge).toEqual(expect.arrayContaining(["zinszahlung", "dividende"]));
  });

  it("ein Vorgang ohne Instrument wird abgelehnt", async () => {
    await expect(db.execute(sql`INSERT INTO vorgang (beteiligung_id, art, valuta, betrag) VALUES (${beteiligungId}::uuid, 'zusage', '2024-01-01', 10)`)).rejects.toThrow(/instrument_id|Failed query/);
  });

  it("ein Vorgang mit unbekanntem Instrument wird abgelehnt, Zinszahlung und Dividende sind buchbar", async () => {
    await expect(db.insert(schema.vorgang).values({ beteiligungId, instrumentId: "00000000-0000-4000-8000-0000000000ff", art: "zusage", valuta: "2024-01-01", betrag: "10.00" })).rejects.toThrow();
    const [z] = await db.insert(schema.vorgang).values({ beteiligungId, instrumentId: darlehen, art: "zins", valuta: "2024-06-30", betrag: "50.00" }).returning();
    const [zahlung] = await db.insert(schema.vorgang).values({ beteiligungId, instrumentId: darlehen, art: "zinszahlung", valuta: "2024-07-15", betrag: "50.00", beglichenVorgangId: z!.id }).returning();
    expect(zahlung!.beglichenVorgangId).toBe(z!.id);
    await db.insert(schema.vorgang).values({ beteiligungId, instrumentId: eigenkapital, art: "dividende", valuta: "2024-08-01", betrag: "10.00" });
    await expect(db.insert(schema.vorgang).values({ beteiligungId, instrumentId: darlehen, art: "zinszahlung", valuta: "2024-07-16", betrag: "1.00", beglichenVorgangId: "00000000-0000-4000-8000-0000000000fe" })).rejects.toThrow();
  });

  it("die Beteiligung bleibt je Fonds, Unternehmen und Instrument eindeutig; mehrere Instrumente sind dort kein Verstoß", async () => {
    await expect(db.insert(schema.beteiligung).values({ fondsId, organisationId: (await db.select().from(schema.beteiligung).limit(1))[0]!.organisationId, instrument: "offene_beteiligung", erstinvestment: "2024-02-01" })).rejects.toThrow();
    expect(Number((await db.execute(sql`SELECT count(*)::int AS n FROM instrument WHERE beteiligung_id = ${beteiligungId}::uuid`)).rows[0]?.n)).toBe(3);
  });
});

describe("Tranche", () => {
  it("braucht ein Instrument; die Nummer und das geplante Datum sind frei wählbar", async () => {
    await expect(db.execute(sql`INSERT INTO tranche (beteiligung_id, bezeichnung, betrag) VALUES (${beteiligungId}::uuid, 'ohne', 10)`)).rejects.toThrow(/instrument_id|Failed query/);
    await expect(db.insert(schema.tranche).values({ beteiligungId, instrumentId: "00000000-0000-4000-8000-0000000000ff", bezeichnung: "x", betrag: "10.00" })).rejects.toThrow();
    const [t] = await db.insert(schema.tranche).values({ beteiligungId, instrumentId: darlehen, nummer: 1, bezeichnung: "Tranche 1", betrag: "100.00", geplantAm: "2024-03-01" }).returning();
    expect(t).toMatchObject({ nummer: 1, geplantAm: "2024-03-01", erfuelltAm: null });
    await expect(db.insert(schema.tranche).values({ beteiligungId, instrumentId: darlehen, bezeichnung: "negativ", betrag: "0.00" })).rejects.toThrow();
  });

  it("eine Auszahlung verweist über tranche_id auf die Tranche, ein unbekannter Verweis wird abgelehnt", async () => {
    const [t] = await db.select().from(schema.tranche).limit(1);
    const [v] = await db.insert(schema.vorgang).values({ beteiligungId, instrumentId: darlehen, art: "auszahlung", valuta: "2024-03-01", betrag: "100.00", trancheId: t!.id }).returning();
    expect(v!.trancheId).toBe(t!.id);
    await expect(db.insert(schema.vorgang).values({ beteiligungId, instrumentId: darlehen, art: "auszahlung", valuta: "2024-03-02", betrag: "1.00", trancheId: "00000000-0000-4000-8000-0000000000ff" })).rejects.toThrow();
  });
});

describe("Zinsperiode und Konditionen je Instrument", () => {
  it("eine Periode ist je Instrument einmal buchbar; ein anderes Instrument derselben Beteiligung darf dieselbe Periode haben", async () => {
    const eins = await neuesInstrument(db, andereBeteiligungId, "darlehen");
    const zwei = await neuesInstrument(db, andereBeteiligungId, "venture_debt");
    await db.insert(schema.zinsperiodeGebucht).values({ beteiligungId: andereBeteiligungId, instrumentId: eins, periodeBis: "2024-12-31" });
    await expect(db.insert(schema.zinsperiodeGebucht).values({ beteiligungId: andereBeteiligungId, instrumentId: eins, periodeBis: "2024-12-31" })).rejects.toThrow();
    await db.insert(schema.zinsperiodeGebucht).values({ beteiligungId: andereBeteiligungId, instrumentId: zwei, periodeBis: "2024-12-31" });
    await expect(db.execute(sql`INSERT INTO zinsperiode_gebucht (beteiligung_id, periode_bis) VALUES (${andereBeteiligungId}::uuid, '2025-03-31')`)).rejects.toThrow(/instrument_id|Failed query/);
  });

  it("Konditionen brauchen ein Instrument", async () => {
    await expect(db.execute(sql`INSERT INTO darlehen_kondition (beteiligung_id, gueltig_ab, satz_fix, methode, zinsperiode, anker) VALUES (${andereBeteiligungId}::uuid, '2024-01-01', '0.05', '30E/360', 'jaehrlich', '2024-12-31')`)).rejects.toThrow(/instrument_id|Failed query/);
    await db.insert(schema.darlehenKondition).values({ beteiligungId: andereBeteiligungId, instrumentId: await neuesInstrument(db, andereBeteiligungId, "darlehen"), gueltigAb: "2024-01-01", satzFix: "0.050000", methode: "30E/360", zinsperiode: "jaehrlich", anker: "2024-12-31" });
  });
});
