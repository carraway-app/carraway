#!/usr/bin/env bash
# Restore a backup made by sicherung.sh. This replaces both the tenant database and its files.
# Usage: wiederherstellung.sh <backup directory> [--env-datei path] [--ja] [--direkt]
# Compose stops the application and worker, provisions the empty database, restores the
# dump and files, then starts both services after migration.
# In direct mode, stop the application first and prepare an empty target database.
# Set DATABASE_URL_RESTORE, OWNER_ROLE and STORAGE_DIR. Run migrations before restarting.
set -euo pipefail

verzeichnis="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
modus="compose"
env_datei="${verzeichnis}/.env"
ja=0
sicherung=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --direkt) modus="direkt"; shift ;;
    --env-datei) env_datei="${2:?--env-datei braucht einen Pfad}"; shift 2 ;;
    --ja) ja=1; shift ;;
    -h|--help) sed -n '/^# /p' "${BASH_SOURCE[0]}"; exit 0 ;;
    -*) echo "Unbekannte Option: $1" >&2; exit 2 ;;
    *) sicherung="$1"; shift ;;
  esac
done
[[ -d "$sicherung" ]] || { echo "Aufruf: $0 <Sicherungsverzeichnis> [--env-datei ...] [--ja] [--direkt]" >&2; exit 2; }

echo "Prüfsummen ..."
(cd "$sicherung" && if command -v sha256sum > /dev/null; then sha256sum -c SHA256SUMS; else shasum -a 256 -c SHA256SUMS; fi)

if [[ "$modus" == "compose" ]]; then
  [[ -f "$env_datei" ]] || { echo "Datei $env_datei fehlt." >&2; exit 2; }
  # Compose resolves COMPOSE_FILE relative to its working directory.
  [[ "$env_datei" = /* ]] || env_datei="$PWD/$env_datei"
  dc() (cd "$verzeichnis" && docker compose --env-file "$env_datei" "$@")
  # Read the effective values from the database container, including Compose overrides and legacy settings.
  admin="$(dc exec -T postgres printenv POSTGRES_USER)"
  db="$(dc exec -T postgres printenv DB_NAME)"
  ziel_beschreibung="Datenbank ${db} und Dateiablage des Compose-Stacks"
else
  export DATABASE_URL_RESTORE="${DATABASE_URL_RESTORE:-${DATABASE_URL_WIEDERHERSTELLUNG:?set DATABASE_URL_RESTORE}}"
  export OWNER_ROLE="${OWNER_ROLE:-${EIGENTUEMER_ROLLE:?set OWNER_ROLE}}"
  export STORAGE_DIR="${STORAGE_DIR:-${SPEICHER_VERZEICHNIS:?set STORAGE_DIR}}"
  ziel_beschreibung="Datenbank $("$verzeichnis/pg-client.py" DATABASE_URL_RESTORE psql -Atc 'select current_database()') und ${STORAGE_DIR}"
fi

echo "ACHTUNG: überschreibt ${ziel_beschreibung} mit dem Stand aus ${sicherung}."
if (( ja == 0 )); then
  read -r -p "Zum Fortfahren \"ja\" eingeben: " antwort
  [[ "$antwort" == "ja" ]] || { echo "Abgebrochen."; exit 1; }
fi

if [[ "$modus" == "compose" ]]; then
  [[ "$db" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "Invalid DB_NAME" >&2; exit 2; }
  dc stop carraway carraway-worker
  echo "Datenbank neu anlegen ..."
  dc exec -T postgres psql -U "$admin" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"${db}\" WITH (FORCE)"
  dc run --rm --no-deps -T carraway-migrate ./bootstrap.sh
  echo "Dump einspielen ..."
  dc exec -T postgres pg_restore -U "$admin" -d "$db" --exit-on-error < "${sicherung}/datenbank.dump"
  echo "Dateiablage zurückspielen ..."
  dc run --rm --no-deps -T --entrypoint sh carraway -c 'find /daten/speicher -mindepth 1 -delete && tar -xzf - -C /daten/speicher' < "${sicherung}/speicher.tar.gz"
  dc up -d carraway carraway-worker
else
  echo "Dump einspielen ..."
  "$verzeichnis/pg-client.py" DATABASE_URL_RESTORE pg_restore --exit-on-error --no-owner --role="$OWNER_ROLE" "${sicherung}/datenbank.dump"
  echo "Dateiablage zurückspielen ..."
  mkdir -p "$STORAGE_DIR"
  find "$STORAGE_DIR" -mindepth 1 -delete
  tar -xzf "${sicherung}/speicher.tar.gz" -C "$STORAGE_DIR"
fi
echo "Wiederherstellung fertig. Kontrolle: /api/v1/health, Verwaltung → Betrieb, eine Anmeldung, und die Dateien gegen die Datenbank:"
echo "  DATABASE_URL=<Verbindung> SPEICHER_VERZEICHNIS=<Dateiablage> pnpm ops:dateien-pruefen   (Ablauf: docs/operations/README.md)"
