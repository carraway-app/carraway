-- Legt Datenbank und Rollen für einen Mandanten an (idempotent) und setzt die Rechte so, dass die laufende Anwendung
-- keine Tabellen anlegen oder ändern kann. Wird als Superuser gegen die Datenbank `postgres` ausgeführt, von
-- `deploy/mandant-anlegen.sh` und beim ersten Start des Compose-Stacks (`deploy/initdb/01-mandant.sh`).
--
-- Erwartete psql-Variablen (nicht in der Prozessliste: die Aufrufer reichen sie über die Standardeingabe herein):
--   db, eigentuemer, app, eigentuemer_pw, app_pw
--
-- Rollen:
--   :eigentuemer  gehört der Datenbank und führt die Migrationen aus (DDL). LOGIN, aber nur für `dist/migrate.js`.
--   :app          Laufzeitrolle von API und Worker: SELECT/INSERT/UPDATE/DELETE auf den Tabellen im Schema public,
--                 kein DDL dort. Im Schema `pgboss` (Warteschlange) gehört ihr alles, denn pg-boss legt seine Tabellen
--                 und Partitionen zur Laufzeit selbst an (siehe deploy/README.md, Abschnitt "Rechte").
\set ON_ERROR_STOP on

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'eigentuemer', :'eigentuemer_pw')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'eigentuemer') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'eigentuemer', :'eigentuemer_pw')
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'eigentuemer') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'app', :'app_pw')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'app', :'app_pw')
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app') \gexec

SELECT format('CREATE DATABASE %I OWNER %I ENCODING %L', :'db', :'eigentuemer', 'UTF8')
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec

-- Kein Zugriff für andere Rollen auf derselben Instanz: PUBLIC darf standardmäßig jeder Datenbank beitreten.
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'db', :'app') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'db', :'eigentuemer') \gexec

\connect :"db"

REVOKE ALL ON SCHEMA public FROM PUBLIC;
SELECT format('GRANT ALL ON SCHEMA public TO %I', :'eigentuemer') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app') \gexec

-- Tabellen, die der Eigentümer künftig (Migrationen) anlegt, bekommen die Rechte der App automatisch.
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', :'eigentuemer', :'app') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', :'eigentuemer', :'app') \gexec
-- Bereits vorhandene Tabellen (Wiederherstellung, erneuter Lauf).
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', :'app') \gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', :'app') \gexec

-- Warteschlange: pg-boss installiert und pflegt dieses Schema selbst.
SELECT format('CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION %I', :'app') \gexec
