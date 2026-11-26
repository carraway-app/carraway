-- API und Worker prüfen beim Start, ob die Datenbank genau die Migrationen hat, die der Code kennt (packages/db/src/migrationen.ts).
-- Die App-Rolle hat kein Recht am Schema `drizzle`; sie darf nur die Tabelle der angewendeten Migrationen lesen (Hashes und Zeitstempel, keine Daten).
GRANT USAGE ON SCHEMA drizzle TO PUBLIC;--> statement-breakpoint
GRANT SELECT ON TABLE drizzle.__drizzle_migrations TO PUBLIC;
