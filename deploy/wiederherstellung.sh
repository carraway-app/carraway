#!/usr/bin/env bash
# Stellt eine Sicherung von deploy/sicherung.sh wieder her. ZERSTÖRT die aktuelle Datenbank und die Dateiablage des Mandanten.
#
#   deploy/wiederherstellung.sh sicherungen/carraway-carraway-20261120-120000
#   deploy/wiederherstellung.sh <Sicherung> --env-datei /pfad/.env --ja     # ohne Rückfrage
#
# Compose-Stack (Standard): hält API und Worker an, legt die Datenbank mit denselben Rollen und Rechten neu an (wie beim
# ersten Start), spielt den Dump ein, leert und füllt die Dateiablage und startet API und Worker wieder (die Migration läuft
# dabei erneut und ist ohne Wirkung, wenn der Stand aktuell ist).
#
# Direkt-Modus (--direkt, eigene Postgres-Instanz): Die Zieldatenbank muss mit deploy/mandant-anlegen.sh angelegt und leer sein.
#   DATABASE_URL_WIEDERHERSTELLUNG  Verbindung der Eigentümerrolle zur leeren Zieldatenbank
#   EIGENTUEMER_ROLLE               Name der Eigentümerrolle (carraway_<kunde>_eigentuemer)
#   SPEICHER_VERZEICHNIS            Dateiablage, wird geleert und neu gefüllt
#   API und Worker vorher anhalten; danach Migration (dist/migrate.js) laufen lassen und beide wieder starten.
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
    -h|--help) sed -n '2,18p' "${BASH_SOURCE[0]}"; exit 0 ;;
    -*) echo "Unbekannte Option: $1" >&2; exit 2 ;;
    *) sicherung="$1"; shift ;;
  esac
done
[[ -d "$sicherung" ]] || { echo "Aufruf: $0 <Sicherungsverzeichnis> [--env-datei ...] [--ja] [--direkt]" >&2; exit 2; }

echo "Prüfsummen ..."
(cd "$sicherung" && if command -v sha256sum > /dev/null; then sha256sum -c SHA256SUMS; else shasum -a 256 -c SHA256SUMS; fi)

env_wert() {
  local name="$1" vorgabe="${2:-}" zeile
  zeile="$(grep -E "^${name}=" "$env_datei" 2>/dev/null | tail -n1 || true)"
  if [[ -n "$zeile" ]]; then printf '%s' "${zeile#*=}"; else printf '%s' "$vorgabe"; fi
}

if [[ "$modus" == "compose" ]]; then
  [[ -f "$env_datei" ]] || { echo "Datei $env_datei fehlt." >&2; exit 2; }
  db="$(env_wert DB_NAME carraway)"
  admin="$(env_wert DB_ADMIN_BENUTZER carraway_admin)"
  dc() { docker compose --env-file "$env_datei" -f "${verzeichnis}/docker-compose.yml" "$@"; }
  ziel_beschreibung="Datenbank ${db} und Dateiablage des Compose-Stacks"
else
  : "${DATABASE_URL_WIEDERHERSTELLUNG:?DATABASE_URL_WIEDERHERSTELLUNG fehlt}"
  : "${EIGENTUEMER_ROLLE:?EIGENTUEMER_ROLLE fehlt}"
  : "${SPEICHER_VERZEICHNIS:?SPEICHER_VERZEICHNIS fehlt}"
  ziel_beschreibung="Datenbank $(psql "$DATABASE_URL_WIEDERHERSTELLUNG" -Atc 'select current_database()') und ${SPEICHER_VERZEICHNIS}"
fi

echo "ACHTUNG: überschreibt ${ziel_beschreibung} mit dem Stand aus ${sicherung}."
if (( ja == 0 )); then
  read -r -p "Zum Fortfahren \"ja\" eingeben: " antwort
  [[ "$antwort" == "ja" ]] || { echo "Abgebrochen."; exit 1; }
fi

if [[ "$modus" == "compose" ]]; then
  dc stop api worker
  echo "Datenbank neu anlegen ..."
  dc exec -T datenbank psql -U "$admin" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"${db}\" WITH (FORCE)"
  dc exec -T datenbank sh /docker-entrypoint-initdb.d/01-mandant.sh
  echo "Dump einspielen ..."
  dc exec -T datenbank pg_restore -U "$admin" -d "$db" --exit-on-error < "${sicherung}/datenbank.dump"
  echo "Dateiablage zurückspielen ..."
  dc run --rm --no-deps -T --entrypoint sh api -c 'find /daten/speicher -mindepth 1 -delete && tar -xzf - -C /daten/speicher' < "${sicherung}/speicher.tar.gz"
  dc up -d api worker
else
  echo "Dump einspielen ..."
  pg_restore -d "$DATABASE_URL_WIEDERHERSTELLUNG" --exit-on-error --no-owner --role="$EIGENTUEMER_ROLLE" "${sicherung}/datenbank.dump"
  echo "Dateiablage zurückspielen ..."
  mkdir -p "$SPEICHER_VERZEICHNIS"
  find "$SPEICHER_VERZEICHNIS" -mindepth 1 -delete
  tar -xzf "${sicherung}/speicher.tar.gz" -C "$SPEICHER_VERZEICHNIS"
fi
echo "Wiederherstellung fertig. Kontrolle: /api/v1/health, Verwaltung → Betrieb, eine Anmeldung, und die Dateien gegen die Datenbank:"
echo "  DATABASE_URL=<Verbindung> SPEICHER_VERZEICHNIS=<Dateiablage> pnpm ops:dateien-pruefen   (Ablauf: docs/betrieb/README.md)"
