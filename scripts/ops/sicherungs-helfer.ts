/**
 * Gemeinsame Bausteine für `sicherung-test.ts` (Wiederherstellung in eine frische Datenbank) und `compose-sicherung-probe.ts`
 * (Probe gegen einen laufenden Compose-Stack): Abbild einer Datenbank (Zeilenzahl und Prüfsumme je Tabelle) und je Dateiart eine
 * erfundene Datei samt Zeile.
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { sha256 as dateiHashVon } from "./dateiablage";

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
export const SCHEMAS = ["public", "drizzle"];

export interface Abbild {
  tabellen: Map<string, { zeilen: number; pruefsumme: string }>;
  schema: string;
  trigger: number;
  migrationen: number;
}

export async function abbilden(url: string): Promise<Abbild> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("SET TimeZone = 'UTC'");
    const { rows: liste } = await client.query<{ schema: string; tabelle: string }>(
      `SELECT schemaname AS schema, tablename AS tabelle FROM pg_tables WHERE schemaname = ANY($1) ORDER BY 1, 2`,
      [SCHEMAS],
    );
    const tabellen: Abbild["tabellen"] = new Map();
    for (const { schema, tabelle } of liste) {
      const voll = `${quote(schema)}.${quote(tabelle)}`;
      const { rows } = await client.query<{ zeilen: string; pruefsumme: string }>(
        `SELECT count(*)::text AS zeilen, md5(coalesce(string_agg(r, E'\\n' ORDER BY r), '')) AS pruefsumme FROM (SELECT t::text AS r FROM ${voll} t) x`,
      );
      tabellen.set(`${schema}.${tabelle}`, { zeilen: Number(rows[0]!.zeilen), pruefsumme: rows[0]!.pruefsumme });
    }
    const { rows: spalten } = await client.query<{ s: string }>(
      `SELECT md5(string_agg(table_schema || '.' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable, ',' ORDER BY table_schema, table_name, column_name)) AS s
         FROM information_schema.columns WHERE table_schema = ANY($1)`,
      [SCHEMAS],
    );
    const { rows: trigger } = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM pg_trigger WHERE NOT tgisinternal`);
    const { rows: mig } = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations`);
    return { tabellen, schema: spalten[0]!.s, trigger: Number(trigger[0]!.n), migrationen: Number(mig[0]!.n) };
  } finally {
    await client.end();
  }
}

/**
 * Legt je Dateiart (außer Dokumente) eine Zeile mit Datei in der Dateiablage an, mit den Schlüsseln der echten Schreibwege
 * (`berichte/<id>/<sha256>.pdf`, `mitteilungen/…`, `belege/…`, `buchungsexporte/…`). Inhalte sind erfundene Kennzeichen eines PDF bzw. Text.
 */
export async function legeDateienAn(url: string, speicher: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const eine = async (sql: string) => (await client.query<{ id: string }>(sql)).rows[0]!.id;
    const fondsId = await eine("SELECT id FROM fonds ORDER BY id LIMIT 1");
    const organisationId = await eine("SELECT id FROM organisation ORDER BY id LIMIT 1");
    const datei = async (schluesselVon: (hash: string) => string, inhalt: string) => {
      const bytes = Buffer.from(`%PDF-1.4\n% ${inhalt}\n%%EOF\n`, "latin1");
      const hash = dateiHashVon(bytes);
      const schluessel = schluesselVon(hash);
      await mkdir(join(speicher, schluessel, ".."), { recursive: true });
      await writeFile(join(speicher, schluessel), bytes);
      return { schluessel, hash, groesse: bytes.length };
    };
    const bewegungId = randomUUID();
    await client.query("INSERT INTO fonds_bewegung (id, fonds_id, art, valuta, betrag) VALUES ($1, $2, 'abruf', '2026-01-15', '1000.00')", [bewegungId, fondsId]);

    const mitteilungId = randomUUID();
    const mitteilung = await datei((h) => `mitteilungen/${mitteilungId}/${h}.pdf`, "Mitteilung");
    await client.query(
      `INSERT INTO fonds_mitteilung (id, bewegung_id, fonds_id, organisation_id, art, valuta, betrag, sprache, datei_name, datei_schluessel, datei_sha256, datei_groesse, freigegeben_von)
       VALUES ($1, $2, $3, $4, 'abruf', '2026-01-15', '100.00', 'de', 'mitteilung.pdf', $5, $6, $7, 'system')`,
      [mitteilungId, bewegungId, fondsId, organisationId, mitteilung.schluessel, mitteilung.hash, mitteilung.groesse],
    );

    const berichtId = randomUUID();
    const bericht = await datei((h) => `berichte/${berichtId}/${h}.pdf`, "Bericht");
    await client.query(
      `INSERT INTO bericht (id, art, format, fonds_id, stichtag, sprache, status, freigabestufen, erstellt_von, datei_name, datei_schluessel, datei_sha256, datei_groesse)
       VALUES ($1, 'fondsbericht', 'pdf', $2, '2025-12-31', 'de', 'freigegeben', '[]', 'system', 'bericht.pdf', $3, $4, $5)`,
      [berichtId, fondsId, bericht.schluessel, bericht.hash, bericht.groesse],
    );
    const fassung = await datei((h) => `berichte/${berichtId}/varianten/${organisationId}/${h}.pdf`, "Fassung fuer einen Investor");
    await client.query(
      `INSERT INTO bericht_variante (bericht_id, organisation_id, datei_name, datei_schluessel, datei_sha256, datei_groesse) VALUES ($1, $2, 'fassung.pdf', $3, $4, $5)`,
      [berichtId, organisationId, fassung.schluessel, fassung.hash, fassung.groesse],
    );

    const belegId = randomUUID();
    const beleg = await datei((h) => `belege/${belegId}/${h}.pdf`, "Beleg");
    await client.query(
      `INSERT INTO beleg (id, fonds_id, art, bezug_art, bezug_id, sprache, status, vorlage, daten, belegnummer, belegnummer_lfd, erstellt_von, datei_name, datei_schluessel, datei_sha256, datei_groesse)
       VALUES ($1, $2, 'kapitalabruf', 'fonds_bewegung', $3, 'de', 'freigegeben', '{}', '{}', 'B-0001', 1, 'system', 'beleg.pdf', $4, $5, $6)`,
      [belegId, fondsId, bewegungId, beleg.schluessel, beleg.hash, beleg.groesse],
    );

    const exportId = randomUUID();
    const buchungen = await datei((h) => `buchungsexporte/${exportId}/${h}.csv`, "Buchungsexport");
    await client.query(
      `INSERT INTO buchungsexport (id, fonds_id, format_version, erzeugt_von, datum_von, datum_bis, anzahl, summe, datei_name, datei_schluessel, datei_sha256, datei_groesse)
       VALUES ($1, $2, 'EXTF', 'system', '2025-01-01', '2025-12-31', 1, '1.00', 'buchungen.csv', $3, $4, $5)`,
      [exportId, fondsId, buchungen.schluessel, buchungen.hash, buchungen.groesse],
    );

    const definitionId = randomUUID();
    await client.query(
      `INSERT INTO melde_definition (id, schluessel, version, bezeichnung_de, bezeichnung_en, herausgeber, rhythmus, format, gueltig_ab, definition)
       VALUES ($1, 'sicherungstest', 1, 'Test', 'Test', 'Beispiel', 'jahr', 'csv', '2025-01-01', '{}')`,
      [definitionId],
    );
    const laufId = randomUUID();
    await client.query(
      `INSERT INTO melde_lauf (id, fonds_id, definition_id, definition_schluessel, definition_version, definition, format, sprache, periode_art, periode_kennung, periode_beginn, periode_ende, stand, status, freigabestufen, erstellt_von)
       VALUES ($1, $2, $3, 'sicherungstest', 1, '{}', 'csv', 'de', 'jahr', '2025', '2025-01-01', '2025-12-31', now(), 'entwurf', '[]', 'system')`,
      [laufId, fondsId, definitionId],
    );
    const meldung = await datei((h) => `meldelaeufe/${laufId}/${h}.csv`, "Meldung");
    await client.query(
      `INSERT INTO melde_datei (lauf_id, art, format, name, schluessel, sha256, groesse) VALUES ($1, 'meldung', 'csv', 'meldung.csv', $2, $3, $4)`,
      [laufId, meldung.schluessel, meldung.hash, meldung.groesse],
    );
  } finally {
    await client.end();
  }
}
