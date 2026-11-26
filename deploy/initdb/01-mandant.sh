#!/bin/sh
# Läuft einmalig beim ersten Start des Postgres-Containers (leeres Datenverzeichnis): legt Datenbank und Rollen an.
# Passwörter gehen über die Standardeingabe an psql, nicht über die Argumente (Prozessliste).
set -eu

db="${DB_NAME:?DB_NAME fehlt}"
for wert in "$db" "${DB_EIGENTUEMER_PASSWORT:?DB_EIGENTUEMER_PASSWORT fehlt}" "${DB_APP_PASSWORT:?DB_APP_PASSWORT fehlt}"; do
  case "$wert" in *[!A-Za-z0-9_-]*) echo "DB_NAME und die Datenbank-Passwörter dürfen nur Buchstaben, Ziffern, _ und - enthalten." >&2; exit 1 ;; esac
done
{
  printf "\\\\set db '%s'\n" "$db"
  printf "\\\\set eigentuemer '%s_eigentuemer'\n" "$db"
  printf "\\\\set app '%s_app'\n" "$db"
  printf "\\\\set eigentuemer_pw '%s'\n" "$DB_EIGENTUEMER_PASSWORT"
  printf "\\\\set app_pw '%s'\n" "$DB_APP_PASSWORT"
  cat /sql/mandant.sql
} | psql -X -q -U "$POSTGRES_USER" -d postgres
