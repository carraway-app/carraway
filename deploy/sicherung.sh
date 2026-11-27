#!/usr/bin/env bash
# Back up the tenant database and file storage with checksums and a retention policy.
# Usage: sicherung.sh [--env-datei path] [--direkt]
# BACKUP_DIR defaults to ./sicherungen. Use separate storage for backups.
# BACKUP_RETENTION_DAYS defaults to 14. Set it to 0 to retain all backups.
# In direct mode, set DATABASE_URL_BACKUP and STORAGE_DIR and install matching pg_dump.
# Direct PostgreSQL URLs are passed via the environment and require Python 3.
# The database snapshot precedes the file archive. Files are immutable, so the archive
# may contain extra files written after the snapshot. A concurrent retention run can
# remove expired documents. After restore run pnpm ops:dateien-pruefen.
# The dump excludes the transient pg-boss queue.
set -euo pipefail

verzeichnis="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
modus="compose"
env_datei="${verzeichnis}/.env"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --direkt) modus="direkt"; shift ;;
    --env-datei) env_datei="${2:?--env-datei braucht einen Pfad}"; shift 2 ;;
    -h|--help) sed -n '/^# /p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Unbekannte Option: $1" >&2; exit 2 ;;
  esac
done

ziel="${BACKUP_DIR:-${SICHERUNG_ZIEL:-./sicherungen}}"
tage="${BACKUP_RETENTION_DAYS:-${SICHERUNG_AUFBEWAHREN_TAGE:-14}}"
[[ "$tage" =~ ^[0-9]+$ ]] || { echo "SICHERUNG_AUFBEWAHREN_TAGE muss eine Zahl sein." >&2; exit 2; }

umask 077
zeitstempel="$(date -u +%Y%m%d-%H%M%S)"

if [[ "$modus" == "compose" ]]; then
  [[ -f "$env_datei" ]] || { echo "Datei $env_datei fehlt (--env-datei oder deploy/.env anlegen)." >&2; exit 2; }
  # Compose resolves COMPOSE_FILE relative to its working directory.
  [[ "$env_datei" = /* ]] || env_datei="$PWD/$env_datei"
  dc() (cd "$verzeichnis" && docker compose --env-file "$env_datei" "$@")
  # Read the effective values from the database container, including Compose overrides and legacy settings.
  admin="$(dc exec -T postgres printenv POSTGRES_USER)"
  db="$(dc exec -T postgres printenv DB_NAME)"
  dump_befehl() { dc exec -T postgres pg_dump -U "$admin" -d "$db" -Fc --exclude-schema=pgboss; }
  speicher_befehl() {
    if dc exec -T carraway true 2>/dev/null; then dc exec -T carraway tar -czf - -C /daten/speicher .
    else dc run --rm --no-deps -T --entrypoint tar carraway -czf - -C /daten/speicher .; fi
  }
  server_info() { dc exec -T postgres psql -U "$admin" -d "$db" -Atc 'show server_version'; }
else
  export DATABASE_URL_BACKUP="${DATABASE_URL_BACKUP:-${DATABASE_URL_SICHERUNG:?set DATABASE_URL_BACKUP}}"
  export STORAGE_DIR="${STORAGE_DIR:-${SPEICHER_VERZEICHNIS:?set STORAGE_DIR}}"
  db="$("$verzeichnis/pg-client.py" DATABASE_URL_BACKUP psql -Atc 'select current_database()')"
  server_haupt="$("$verzeichnis/pg-client.py" DATABASE_URL_BACKUP psql -Atc 'show server_version_num' | cut -c1-2)"
  client_haupt="$(pg_dump --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
  if (( client_haupt < server_haupt )); then
    echo "pg_dump ${client_haupt} ist älter als der Server ${server_haupt}: Sicherung abgebrochen (Client aktualisieren oder den Compose-Modus nutzen)." >&2
    exit 1
  fi
  dump_befehl() { "$verzeichnis/pg-client.py" DATABASE_URL_BACKUP pg_dump -Fc --exclude-schema=pgboss; }
  speicher_befehl() { tar -czf - -C "$STORAGE_DIR" .; }
  server_info() { "$verzeichnis/pg-client.py" DATABASE_URL_BACKUP psql -Atc 'show server_version'; }
fi

name="carraway-${db}-${zeitstempel}"
mkdir -p "$ziel"
ablage="${ziel}/.${name}.unfertig"
trap 'rm -rf "$ablage"' EXIT
mkdir "$ablage"

echo "Sicherung ${name}: Datenbank ..."
dump_befehl > "${ablage}/datenbank.dump"
zeit_datenbank="$(date -u +%Y%m%d-%H%M%S)"
echo "Sicherung ${name}: Dateiablage ..."
speicher_befehl > "${ablage}/speicher.tar.gz"
zeit_speicher="$(date -u +%Y%m%d-%H%M%S)"
# Verify the dump and archive before publishing the backup.
if [[ "$modus" == "compose" ]]; then
  dc exec -T postgres pg_restore -l < "${ablage}/datenbank.dump" > /dev/null
else
  pg_restore -l "${ablage}/datenbank.dump" > /dev/null
fi
tar -tzf "${ablage}/speicher.tar.gz" > /dev/null

cat > "${ablage}/INFO.txt" <<EOF
Mandant (Datenbank): ${db}
Erstellt (UTC): ${zeitstempel}
Datenbank gezogen (UTC, Ende von pg_dump): ${zeit_datenbank}
Dateiablage gezogen (UTC, Ende von tar): ${zeit_speicher}
Reihenfolge: erst Datenbank, dann Dateiablage (siehe docs/operations/README.md)
Postgres-Server: $(server_info)
Modus: ${modus}
Inhalt: datenbank.dump (pg_dump -Fc, Schemas public und drizzle), speicher.tar.gz (Dateiablage: Dokumente, Berichte, Berichtsfassungen, Mitteilungen, Belege, Buchungsexporte, Meldedateien)
EOF
(cd "$ablage" && if command -v sha256sum > /dev/null; then sha256sum datenbank.dump speicher.tar.gz INFO.txt; else shasum -a 256 datenbank.dump speicher.tar.gz INFO.txt; fi > SHA256SUMS)

mv "$ablage" "${ziel}/${name}"
trap - EXIT
echo "Sicherung fertig: ${ziel}/${name}"

if (( tage > 0 )); then
  find "$ziel" -maxdepth 1 -type d -name "carraway-${db}-*" -mtime "+${tage}" -print -exec rm -rf {} + | sed 's/^/gelöscht (Aufbewahrungsfrist): /'
fi
