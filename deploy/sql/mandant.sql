-- Run as administrator against postgres. Only explicit tenant provisioning rotates passwords.
\set ON_ERROR_STOP on
\getenv eigentuemer_pw DB_OWNER_PASSWORD
\getenv app_pw DB_APP_PASSWORD

-- Serialize role and database creation for this tenant until the connection switches below.
SELECT pg_advisory_lock(hashtextextended(:'db', 0));

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'eigentuemer', :'eigentuemer_pw')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'eigentuemer') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'app', :'app_pw')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app') \gexec
\if :rotate
SELECT format('ALTER ROLE %I PASSWORD %L', :'eigentuemer', :'eigentuemer_pw')
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'eigentuemer') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'app', :'app_pw')
  WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app') \gexec
\endif

SELECT format('CREATE DATABASE %I OWNER %I ENCODING %L', :'db', :'eigentuemer', 'UTF8')
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec

-- Limit database access to the tenant roles.
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'db', :'app') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'db', :'eigentuemer') \gexec

\connect :"db"

BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended(:'db', 0));
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SELECT format('GRANT ALL ON SCHEMA public TO %I', :'eigentuemer') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app') \gexec

-- Apply runtime privileges to future tables and sequences created by the owner.
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', :'eigentuemer', :'app') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', :'eigentuemer', :'app') \gexec
-- Include existing tables and sequences after a restore.
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', :'app') \gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', :'app') \gexec

-- pg-boss maintains its own schema at runtime.
SELECT format('CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION %I', :'app') \gexec
COMMIT;
