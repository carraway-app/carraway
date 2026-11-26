import { sql } from "drizzle-orm";
import { erstelleDb, type Db } from "@carraway/db";
import { testDatenbankUrl } from "@carraway/db/schutz";

export const TESTDB_URL = testDatenbankUrl();

export function oeffneTestdb() {
  return erstelleDb(TESTDB_URL);
}

/**
 * Leert die Fachdaten (und mit `fonds` die Fondsrollen und Periodensperren) sowie die API-Schlüssel mit ihren technischen
 * Benutzern. Die Personen zum Anmelden bleiben bestehen; die Test-App legt sie bei Bedarf neu an.
 */
export const leeren = async (db: Db) => {
  await db.execute(
    sql`TRUNCATE TABLE webhook_zustellung, webhook_ausgang, webhook, manager_profil, zielfonds_meldung, zielfonds_bewegung, zielfonds_beteiligung, kontakt_ki_vorschlag, kontakt_ki_teilnahme, kontakt_ki_einstellung, kontakt_vorschlag_quelle, kontakt_vorschlag, kontakt_domain, kontakt_herkunft, kontaktabgleich_teilnahme, kontaktabgleich_einstellung, nutzergruppe, rechterolle, werte_schluessel, wechselkurs, datensatz_link, aufgabe, liste_eintrag, feld_definition, ansicht, liste, deal_kontakt, beschaeftigung, mail_auftrag, postfach_verbindung, oauth_zustand, kalender_token, sync_ausschluss, aktivitaet_sync, benutzer_einstellung, fonds_offenlegung, melde_datei, melde_freigabe, melde_wert, melde_lauf, melde_aktivierung, organisation_meldedaten, buchungsexport_position, buchungsexport, buchungsregel, saldo, saldenlauf_befund, saldenlauf, kontenregel, gliederung_position, sachkonto, beleg_stufe, beleg_nummernkreis, beleg, beleg_art_eigen, beleg_vorlage, fonds_mittelart, beteiligung_buchhaltung, fonds_buchhaltung, wert_quelle, auslesung, dokument_seite, dokument_verknuepfung, dokument, bericht_variante, fonds_mitteilung, investor_zugang, abfrage_zugriff, kennzahl_wert, kennzahl_abfrage_position, kennzahl_abfrage, fonds_kennzahl, kontaktrolle, organisationsbeziehung, beschlussvorlage, import_befund, import_zuordnung, import_lauf, idempotenz_schluessel, aenderung, snapshot_auftrag, kennzahl_snapshot, rundenposition_zahlung, vorgang_runde, runde_buchung, rundenposition, vehikel, anteilsklasse, finanzierungsrunde, vorgang, bewertung, beteiligung, aktivitaet, beschluss, deal_phasenwechsel, deal, gremienmandat, fonds_kosten_anteil, fonds_kosten, fonds_bewegung, fonds, person, organisation CASCADE`,
  );
  await db.execute(sql`DELETE FROM kennzahl_definition WHERE schluessel LIKE 'test\_%'`); // Katalogeinträge der Tests (der Standardkatalog bleibt)
  await db.execute(sql`DELETE FROM foerderprogramm WHERE schluessel LIKE 'test\_%'`); // Programme der Tests
  await db.execute(sql`ALTER TABLE melde_definition DISABLE TRIGGER melde_definition_schutz`);
  await db.execute(sql`DELETE FROM melde_definition WHERE schluessel LIKE 'test\_%'`); // Definitionen der Tests (die mitgelieferten bleiben)
  await db.execute(sql`ALTER TABLE melde_definition ENABLE TRIGGER melde_definition_schutz`);
  await db.execute(sql`DELETE FROM benutzer WHERE technisch`); // entfernt über die Fremdschlüssel auch api_schluessel
};

/** Standard-Vehikel einer Organisation für Positionen Dritter in Tests; entsteht mit ihrem Namen, wenn es fehlt. */
export async function vehikelVon(db: Db, organisationId: string): Promise<string> {
  const { rows } = await db.execute<{ id: string }>(sql`
    WITH neu AS (
      INSERT INTO vehikel (investor_id, name, standard)
      SELECT o.id, o.name, true FROM organisation o WHERE o.id = ${organisationId}
        AND NOT EXISTS (SELECT 1 FROM vehikel v WHERE v.investor_id = o.id AND v.standard)
      RETURNING id
    )
    SELECT id FROM neu UNION ALL SELECT id FROM vehikel WHERE investor_id = ${organisationId} AND standard`);
  if (!rows[0]) throw new Error(`Organisation ${organisationId} fehlt`);
  return rows[0].id;
}

/** Antwort als JSON, bewusst untypisiert: Die Tests prüfen die Form selbst. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const json = async (antwort: Response): Promise<any> => antwort.json();

/**
 * Entfernt Fondsbewegungen mit einer Bemerkung. Fondsbewegungen sind unveränderlich (Trigger); Tests, die eine Zeile nach dem Versuch wieder
 * loswerden wollen, schalten den Trigger nur für diese Transaktion ab.
 */
export const loescheBewegungen = async (db: Db, bemerkung: string) => {
  await db.transaction(async (tx) => {
    await tx.execute(sql`ALTER TABLE fonds_bewegung DISABLE TRIGGER fonds_bewegung_kein_update_delete`);
    await tx.execute(sql`DELETE FROM fonds_bewegung WHERE bemerkung = ${bemerkung}`);
    await tx.execute(sql`ALTER TABLE fonds_bewegung ENABLE TRIGGER fonds_bewegung_kein_update_delete`);
  });
};
