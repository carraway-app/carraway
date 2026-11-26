import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { erstelleDb } from "../index";
import { TESTDB_URL } from "./hilfen";

/**
 * Datenmigration 0058 (Portfolio-Modell, Phase 1): Der Test baut in einer Transaktion den Zustand vor der Migration nach (Instrumentspalten ohne Pflicht,
 * alter Eindeutigkeitsindex der Zinsperiode), spielt alle Schritte der Migrationsdatei nach und rollt am Ende zurück. Die Datenbank bleibt unverändert.
 */

const { db, pool } = erstelleDb(TESTDB_URL);
afterAll(async () => {
  await pool.end();
});

const DATEI = new URL("../../drizzle/0058_instrument_daten.sql", import.meta.url);
const ABBRUCH = new Error("zurückrollen");
const id = (k: string) => `00000000-0000-4000-8000-0000000${k.padStart(5, "0")}`;
const [F, ORG_A, ORG_B, ORG_C, ORG_E, ORG_F, INV] = ["f1", "a1", "a2", "a3", "a5", "a6", "a9"].map(id) as [string, string, string, string, string, string, string];
const [BA, BB, BC, BD, BE, BF] = ["b1", "b2", "b3", "b4", "b5", "b6"].map(id) as [string, string, string, string, string, string];

type Zeile = Record<string, unknown>;

describe("Migration 0058", () => {
  it("legt je Beteiligung ein Instrument an, befüllt instrument_id überall und übernimmt Barzinsen als Zinszahlungen", async () => {
    const schritte = readFileSync(DATEI, "utf8")
      .split("--> statement-breakpoint")
      .map((x) => x.trim())
      .filter(Boolean);
    expect(schritte.length).toBeGreaterThan(10);

    const e: Record<string, Zeile[]> = {};
    await db
      .transaction(async (tx) => {
        const lies = async (name: string, abfrage: ReturnType<typeof sql>) => {
          e[name] = (await tx.execute(abfrage)).rows as Zeile[];
        };
        // Zustand vor der Migration
        for (const t of ["vorgang", "darlehen_kondition", "tranche", "zinsperiode_gebucht"]) await tx.execute(sql.raw(`ALTER TABLE ${t} ALTER COLUMN instrument_id DROP NOT NULL`));
        await tx.execute(sql`ALTER TABLE wandlung ALTER COLUMN quell_instrument_id DROP NOT NULL`);
        await tx.execute(sql`DROP INDEX zinsperiode_gebucht_instrument_bis_uq`);
        // Vor Migration 0059 durfte ein Fonds ein Unternehmen mit mehreren Instrumenten als getrennte Beteiligungen halten.
        await tx.execute(sql`DROP INDEX beteiligung_fonds_organisation_uq`);
        await tx.execute(sql`CREATE UNIQUE INDEX zinsperiode_gebucht_beteiligung_bis_uq ON zinsperiode_gebucht (beteiligung_id, periode_bis)`);

        await tx.execute(sql`INSERT INTO fonds (id, name, kurzname, vintage, zeichnungskapital, waehrung) VALUES (${F}::uuid, 'Migrationsfonds', 'MIGF', 2024, '1000000.00', 'EUR')`);
        for (const [o, name] of [[ORG_A, "Alpha"], [ORG_B, "Beta"], [ORG_C, "Gamma"], [ORG_E, "Epsilon"], [ORG_F, "Zeta"]] as const) {
          await tx.execute(sql`INSERT INTO organisation (id, name, art) VALUES (${o}::uuid, ${`Migrationsfirma ${name}`}, 'unternehmen')`);
        }
        await tx.execute(sql`INSERT INTO organisation (id, name, art) VALUES (${INV}::uuid, 'Migrationsinvestor', 'investor')`);
        const bet = (b: string, o: string, art: string, status: string, felder = "{}") =>
          tx.execute(sql`INSERT INTO beteiligung (id, fonds_id, organisation_id, instrument, status, erstinvestment, instrument_felder) VALUES (${b}::uuid, ${F}::uuid, ${o}::uuid, ${art}::instrument_art, ${status}::beteiligung_status, '2024-01-01', ${felder}::jsonb)`);
        await bet(BA, ORG_A, "offene_beteiligung", "aktiv", '{"sicherheit":"keine"}');
        await bet(BB, ORG_B, "wandeldarlehen", "aktiv");
        await bet(BC, ORG_C, "wandeldarlehen", "exit");
        await bet(BD, ORG_C, "offene_beteiligung", "aktiv");
        await bet(BE, ORG_E, "darlehen", "exit");
        await bet(BF, ORG_F, "offene_beteiligung", "insolvent");

        // Vorgänge am Wandeldarlehen BB: Zusage, Auszahlung auf Tranche, vier Zinsbuchungen (zwei bar, eine kapitalisiert, eine mit Storno)
        const v = (vid: string, b: string, art: string, valuta: string, betrag: string, extra = "") =>
          tx.execute(sql.raw(`INSERT INTO vorgang (id, beteiligung_id, art, valuta, betrag${extra ? ", " + extra.split("=")[0] : ""}) VALUES ('${vid}', '${b}', '${art}', '${valuta}', ${betrag}${extra ? ", " + extra.split("=")[1] : ""})`));
        await tx.execute(sql`INSERT INTO tranche (id, beteiligung_id, bezeichnung, betrag, erstellt_am) VALUES (${id("c2")}::uuid, ${BB}::uuid, 'Zweite', '5000.00', '2024-02-02'), (${id("c1")}::uuid, ${BB}::uuid, 'Erste', '5000.00', '2024-02-01')`);
        await v(id("d1"), BB, "zusage", "2024-01-01", "10000");
        await v(id("d2"), BB, "auszahlung", "2024-02-01", "5000", `tranche_id='${id("c1")}'`);
        await v(id("d3"), BB, "zins", "2024-12-31", "300");
        await v(id("d4"), BB, "zins", "2025-06-30", "1000");
        await v(id("d5"), BB, "zins", "2025-12-31", "500", "kapitalisiert=true");
        await v(id("d6"), BB, "zins", "2025-12-31", "700");
        await v(id("d7"), BB, "zins", "2026-01-31", "-700", `storniert_vorgang_id='${id("d6")}'`);
        // Weitere Beteiligungen mit Vorgängen
        await v(id("d8"), BA, "zusage", "2024-01-01", "2000");
        await v(id("d9"), BE, "rueckfluss", "2025-01-01", "900");
        // Periodensperre über allen Valuta: die Übernahme der Zinszahlungen darf trotzdem schreiben
        await tx.execute(sql`INSERT INTO periodensperre (fonds_id, gesperrt_bis, gesetzt_von) VALUES (${F}::uuid, '2026-12-31', 'test')`);

        await tx.execute(sql`INSERT INTO darlehen_kondition (id, beteiligung_id, gueltig_ab, satz_fix, methode, zinsperiode, anker) VALUES (${id("e1")}::uuid, ${BB}::uuid, '2024-01-01', '0.06', '30E/360', 'jaehrlich', '2024-12-31')`);
        await tx.execute(sql`INSERT INTO zinslauf (id, fonds_id, stichtag, berechnet_von) VALUES (${id("f2")}::uuid, ${F}::uuid, '2025-12-31', 'test')`);
        await tx.execute(sql`INSERT INTO zinslauf_position (id, zinslauf_id, beteiligung_id, von, bis, faellig_am, gestundet, betrag_fix, betrag_gewinn, betrag_gesamt, betrag_gebucht, kapitalisiert, kapitalien, schritte)
          VALUES (${id("f3")}::uuid, ${id("f2")}::uuid, ${BB}::uuid, '2025-01-01', '2025-06-30', '2025-06-30', false, '1000', '0', '1000', '1000', false, '[]'::jsonb, '[]'::jsonb)`);
        await tx.execute(sql`INSERT INTO zinsperiode_gebucht (id, beteiligung_id, periode_bis, vorgang_id) VALUES (${id("f4")}::uuid, ${BB}::uuid, '2025-06-30', ${id("d4")}::uuid)`);
        await tx.execute(sql`INSERT INTO verkauf (id, beteiligung_id, datum, anteil_verkauft, kaufpreis, kosten, buchwert_vorher, buchwert_abgang, erloes, ergebnis, barzufluss, schritte)
          VALUES (${id("f5")}::uuid, ${BE}::uuid, '2025-01-01', '1', '900', '0', '800', '800', '900', '100', '900', '[]'::jsonb)`);
        await tx.execute(sql`INSERT INTO forderung (id, beteiligung_id, verkauf_id, art, betrag, faellig_am) VALUES (${id("f6")}::uuid, ${BE}::uuid, ${id("f5")}::uuid, 'treuhand', '50', '2025-06-01')`);
        // Wandlung BC → BD (BC ist ausgeschieden, deshalb "gewandelt") und eine Runde mit einer Position des Fonds und eines Investors
        await tx.execute(sql`INSERT INTO finanzierungsrunde (id, organisation_id, bezeichnung, datum, pre_money, post_money, preis_je_anteil, anteile_gesamt_nach) VALUES (${id("a7")}::uuid, ${ORG_A}::uuid, 'Seed', '2024-01-01', '1000', '1100', '1', '1100')`);
        await tx.execute(sql`INSERT INTO rundenposition (id, runde_id, fonds_id, betrag, anteile, rolle) VALUES (${id("a8")}::uuid, ${id("a7")}::uuid, ${F}::uuid, '100', '100', 'lead')`);
        // Positionen Dritter hängen seit der Migration der Vehikel an einem Vehikel des Investors.
        await tx.execute(sql`INSERT INTO vehikel (id, investor_id, name, standard) VALUES (${id("a8a")}::uuid, ${INV}::uuid, 'Migrationsinvestor', true)`);
        await tx.execute(sql`INSERT INTO rundenposition (id, runde_id, vehikel_id, betrag, anteile, rolle) VALUES (${id("a9")}::uuid, ${id("a7")}::uuid, ${id("a8a")}::uuid, '100', '100', 'co')`);
        await tx.execute(sql`INSERT INTO finanzierungsrunde (id, organisation_id, bezeichnung, datum, pre_money, post_money, preis_je_anteil, anteile_gesamt_nach) VALUES (${id("a0")}::uuid, ${ORG_C}::uuid, 'Wandelrunde', '2024-06-01', '1000', '1100', '1', '1100')`);
        await tx.execute(sql`INSERT INTO wandlung (id, darlehen_beteiligung_id, ziel_beteiligung_id, runde_id, cutoff, zinsen_wandeln, preisregel, nennwert_je_anteil, anzahl_anteile, preis_je_anteil, massgeblich, wandlungsbetrag, nominal, agio, spitzenbetrag, zinsen_gebucht, ergebnis, vorgaenge)
          VALUES (${id("f7")}::uuid, ${BC}::uuid, ${BD}::uuid, ${id("a0")}::uuid, '2024-06-30', false, '{}'::jsonb, '1', '10', '1', 'preis', '10', '10', '0', '0', '0', '{}'::jsonb, '{}'::jsonb)`);

        await lies("summenVorher", sql`SELECT beteiligung_id::text AS b, art::text AS art, sum(betrag)::text AS s, count(*)::int AS n FROM vorgang GROUP BY 1, 2 ORDER BY 1, 2`);

        for (const schritt of schritte) await tx.execute(sql.raw(schritt));

        await lies("instrumente", sql`SELECT i.id::text AS id, i.beteiligung_id::text AS b, i.art::text AS art, i.bezeichnung, i.status::text AS status, i.felder FROM instrument i ORDER BY i.beteiligung_id`);
        await lies("ohneInstrument", sql`SELECT
          (SELECT count(*)::int FROM vorgang WHERE instrument_id IS NULL) AS vorgang,
          (SELECT count(*)::int FROM darlehen_kondition WHERE instrument_id IS NULL) AS kondition,
          (SELECT count(*)::int FROM tranche WHERE instrument_id IS NULL) AS tranche,
          (SELECT count(*)::int FROM zinslauf_position WHERE instrument_id IS NULL) AS position,
          (SELECT count(*)::int FROM zinsperiode_gebucht WHERE instrument_id IS NULL) AS periode,
          (SELECT count(*)::int FROM verkauf WHERE instrument_id IS NULL) AS verkauf,
          (SELECT count(*)::int FROM forderung WHERE instrument_id IS NULL) AS forderung,
          (SELECT count(*)::int FROM wandlung WHERE quell_instrument_id IS NULL OR ziel_instrument_id IS NULL) AS wandlung`);
        await lies("falscheZuordnung", sql`SELECT count(*)::int AS n FROM vorgang v JOIN instrument i ON i.id = v.instrument_id WHERE i.beteiligung_id <> v.beteiligung_id`);
        await lies("tranchen", sql`SELECT bezeichnung, nummer, instrument_id IS NOT NULL AS hat FROM tranche ORDER BY nummer`);
        await lies("positionen", sql`SELECT (fonds_id IS NOT NULL) AS eigene, instrument_id::text AS i FROM rundenposition ORDER BY eigene DESC`);
        await lies("wandlung", sql`SELECT w.quell_instrument_id::text AS q, w.ziel_instrument_id::text AS z, qi.beteiligung_id::text AS qb, zi.beteiligung_id::text AS zb FROM wandlung w JOIN instrument qi ON qi.id = w.quell_instrument_id JOIN instrument zi ON zi.id = w.ziel_instrument_id`);
        await lies("zinszahlungen", sql`SELECT z.beteiligung_id::text AS b, z.valuta::text AS valuta, z.betrag::text AS betrag, z.bemerkung, z.beglichen_vorgang_id::text AS beglichen, z.instrument_id = o.instrument_id AS gleiches_instrument
          FROM vorgang z JOIN vorgang o ON o.id = z.beglichen_vorgang_id WHERE z.art = 'zinszahlung' ORDER BY z.valuta`);
        await lies("summenNachher", sql`SELECT beteiligung_id::text AS b, art::text AS art, sum(betrag)::text AS s, count(*)::int AS n FROM vorgang WHERE art <> 'zinszahlung' GROUP BY 1, 2 ORDER BY 1, 2`);
        await lies("pflicht", sql`SELECT table_name AS t FROM information_schema.columns WHERE column_name = 'instrument_id' AND is_nullable = 'NO' AND table_name IN ('vorgang', 'darlehen_kondition', 'tranche', 'zinsperiode_gebucht') ORDER BY 1`);
        await lies("trigger", sql`SELECT tgname, tgenabled::text AS an FROM pg_trigger WHERE tgname IN ('vorgang_kein_update_delete', 'vorgang_periodensperre', 'vorgang_storno_pruefen') ORDER BY 1`);
        await lies("indexe", sql`SELECT indexname FROM pg_indexes WHERE tablename = 'zinsperiode_gebucht' ORDER BY 1`);
        throw ABBRUCH;
      })
      .catch((fehler: unknown) => {
        if (fehler !== ABBRUCH) throw fehler;
      });

    // Ein Instrument je Beteiligung, Art aus der Beteiligung, Status nach Beteiligungsstatus und Wandlung
    const je = new Map(e.instrumente!.map((i) => [String(i.b).slice(-2), i]));
    expect(e.instrumente).toHaveLength(6);
    expect(je.get("b1")).toMatchObject({ art: "offene_beteiligung", bezeichnung: "Offene Beteiligung", status: "aktiv", felder: { sicherheit: "keine" } });
    expect(je.get("b2")).toMatchObject({ art: "wandeldarlehen", bezeichnung: "Wandeldarlehen", status: "aktiv" });
    expect(je.get("b3")).toMatchObject({ art: "wandeldarlehen", status: "gewandelt" });
    expect(je.get("b5")).toMatchObject({ art: "darlehen", status: "verkauft" });
    expect(je.get("b6")).toMatchObject({ status: "abgeschrieben" });

    // Jede Zeile hat ihr Instrument, und es gehört zur selben Beteiligung
    expect(e.ohneInstrument![0]).toEqual({ vorgang: 0, kondition: 0, tranche: 0, position: 0, periode: 0, verkauf: 0, forderung: 0, wandlung: 0 });
    expect(e.falscheZuordnung![0]).toEqual({ n: 0 });
    expect(e.pflicht!.map((r) => r.t)).toEqual(["darlehen_kondition", "tranche", "vorgang", "zinsperiode_gebucht"]);
    expect(e.tranchen).toEqual([{ bezeichnung: "Erste", nummer: 1, hat: true }, { bezeichnung: "Zweite", nummer: 2, hat: true }]);
    // Nur Positionen eigener Fonds bekommen ein Instrument
    expect(e.positionen![0]!.i).toBe(je.get("b1")!.id);
    expect(e.positionen![1]!.i).toBeNull();
    expect(e.wandlung![0]).toMatchObject({ qb: BC, zb: BD });

    // Zinszahlungen: nur für nicht kapitalisierte, nicht stornierte Zinsbuchungen; derselbe Betrag, dasselbe Datum, trotz Periodensperre
    expect(e.zinszahlungen).toEqual([
      { b: BB, valuta: "2024-12-31", betrag: "300.00", bemerkung: "aus Bestand übernommen", beglichen: id("d3"), gleiches_instrument: true },
      { b: BB, valuta: "2025-06-30", betrag: "1000.00", bemerkung: "aus Bestand übernommen", beglichen: id("d4"), gleiches_instrument: true },
    ]);
    // Beträge je Beteiligung und Art bleiben bis auf die neuen Zinszahlungen unverändert
    expect(e.summenNachher).toEqual(e.summenVorher);
    // Die Schutz-Trigger sind danach wieder eingeschaltet (O = aktiv)
    expect(e.trigger).toEqual([
      { tgname: "vorgang_kein_update_delete", an: "O" },
      { tgname: "vorgang_periodensperre", an: "O" },
      { tgname: "vorgang_storno_pruefen", an: "O" },
    ]);
    expect(e.indexe!.map((r) => r.indexname)).toEqual(["zinsperiode_gebucht_instrument_bis_uq", "zinsperiode_gebucht_pkey"]);
  });
});
