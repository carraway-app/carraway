#!/usr/bin/env bash
# Sicherung eines Carraway-Mandanten: Datenbank (pg_dump, Custom-Format) und Dateiablage (freigegebene Berichte und hochgeladene Dokumente),
# mit Zeitstempel, Prüfsummen und Aufbewahrungsfrist.
#
#   deploy/sicherung.sh                       # Compose-Stack (Standard), Einstellungen aus deploy/.env
#   deploy/sicherung.sh --env-datei /pfad/.env
#   DATABASE_URL_SICHERUNG=postgres://... SPEICHER_VERZEICHNIS=/daten/speicher deploy/sicherung.sh --direkt
#
# Ergebnis: <SICHERUNG_ZIEL>/carraway-<datenbank>-<JJJJMMTT-HHMMSS>/ mit datenbank.dump, speicher.tar.gz, SHA256SUMS, INFO.txt.
# Reihenfolge und Stand: Erst die Datenbank (ein Schnappschuss, den pg_dump konsistent zieht), danach die Dateiablage. Dateien werden nur
# neu geschrieben, nie verändert, und liegen vor der Zeile, die auf sie zeigt; zu jeder Zeile im Dump gibt es die Datei im
# später gezogenen Archiv. Das Archiv kann mehr Dateien enthalten als der Dump Zeilen (Aufträge zwischen beiden Schritten); die
# schaden nicht. Einzige Ausnahme: Löscht der Aufbewahrungslauf zwischen beiden Schritten die Datei eines Dokuments, dessen
# Frist abgelaufen war, ist die Zeile im Dump noch „gelöscht“, die Datei fehlt; nach der Wiederherstellung stellt der nächste
# Lauf den Zustand „endgültig gelöscht“ her. Beide Zeitpunkte stehen in INFO.txt. Nach jeder Wiederherstellung `pnpm ops:dateien-pruefen`.
# Die Schemas `public` und `drizzle` kommen in die Sicherung. Das Schema `pgboss` (Warteschlange) nicht: Es hält nur flüchtige
# Aufträge; Kennzahlen-Snapshots lassen sich neu berechnen (POST /api/v1/fonds/:id/neuberechnen).
#
# Umgebungsvariablen:
#   SICHERUNG_ZIEL               Verzeichnis für die Sicherungen (Vorgabe ./sicherungen). Gehört auf ein anderes Medium als die Daten.
#   SICHERUNG_AUFBEWAHREN_TAGE   Sicherungen dieses Mandanten, die älter sind, werden gelöscht (Vorgabe 14; 0 = nie löschen).
#   Direkt-Modus: DATABASE_URL_SICHERUNG (Eigentümer- oder Superuser-Verbindung), SPEICHER_VERZEICHNIS. Der Client `pg_dump`
#   muss mindestens so neu sein wie der Server; sonst bricht das Skript ab.
set -euo pipefail

verzeichnis="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
modus="compose"
env_datei="${verzeichnis}/.env"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --direkt) modus="direkt"; shift ;;
    --env-datei) env_datei="${2:?--env-datei braucht einen Pfad}"; shift 2 ;;
    -h|--help) sed -n '2,23p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Unbekannte Option: $1" >&2; exit 2 ;;
  esac
done

ziel="${SICHERUNG_ZIEL:-./sicherungen}"
tage="${SICHERUNG_AUFBEWAHREN_TAGE:-14}"
[[ "$tage" =~ ^[0-9]+$ ]] || { echo "SICHERUNG_AUFBEWAHREN_TAGE muss eine Zahl sein." >&2; exit 2; }

# Wert einer Variablen aus der .env-Datei lesen, ohne die Datei als Shell-Skript auszuführen.
env_wert() {
  local name="$1" vorgabe="${2:-}" zeile
  zeile="$(grep -E "^${name}=" "$env_datei" 2>/dev/null | tail -n1 || true)"
  if [[ -n "$zeile" ]]; then printf '%s' "${zeile#*=}"; else printf '%s' "$vorgabe"; fi
}

umask 077
zeitstempel="$(date -u +%Y%m%d-%H%M%S)"

if [[ "$modus" == "compose" ]]; then
  [[ -f "$env_datei" ]] || { echo "Datei $env_datei fehlt (--env-datei oder deploy/.env anlegen)." >&2; exit 2; }
  db="$(env_wert DB_NAME carraway)"
  admin="$(env_wert DB_ADMIN_BENUTZER carraway_admin)"
  dc() { docker compose --env-file "$env_datei" -f "${verzeichnis}/docker-compose.yml" "$@"; }
  dump_befehl() { dc exec -T datenbank pg_dump -U "$admin" -d "$db" -Fc --exclude-schema=pgboss; }
  speicher_befehl() {
    if dc exec -T api true 2>/dev/null; then dc exec -T api tar -czf - -C /daten/speicher .
    else dc run --rm --no-deps -T --entrypoint tar api -czf - -C /daten/speicher .; fi
  }
  server_info() { dc exec -T datenbank psql -U "$admin" -d "$db" -Atc 'show server_version'; }
else
  : "${DATABASE_URL_SICHERUNG:?DATABASE_URL_SICHERUNG fehlt}"
  : "${SPEICHER_VERZEICHNIS:?SPEICHER_VERZEICHNIS fehlt}"
  db="$(psql "$DATABASE_URL_SICHERUNG" -Atc 'select current_database()')"
  server_haupt="$(psql "$DATABASE_URL_SICHERUNG" -Atc 'show server_version_num' | cut -c1-2)"
  client_haupt="$(pg_dump --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
  if (( client_haupt < server_haupt )); then
    echo "pg_dump ${client_haupt} ist älter als der Server ${server_haupt}: Sicherung abgebrochen (Client aktualisieren oder den Compose-Modus nutzen)." >&2
    exit 1
  fi
  dump_befehl() { pg_dump "$DATABASE_URL_SICHERUNG" -Fc --exclude-schema=pgboss; }
  speicher_befehl() { tar -czf - -C "$SPEICHER_VERZEICHNIS" .; }
  server_info() { psql "$DATABASE_URL_SICHERUNG" -Atc 'show server_version'; }
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
# Kontrolle: Der Dump muss sich lesen lassen, die Archivdatei entpacken.
if [[ "$modus" == "compose" ]]; then
  dc exec -T datenbank pg_restore -l < "${ablage}/datenbank.dump" > /dev/null
else
  pg_restore -l "${ablage}/datenbank.dump" > /dev/null
fi
tar -tzf "${ablage}/speicher.tar.gz" > /dev/null

cat > "${ablage}/INFO.txt" <<EOF
Mandant (Datenbank): ${db}
Erstellt (UTC): ${zeitstempel}
Datenbank gezogen (UTC, Ende von pg_dump): ${zeit_datenbank}
Dateiablage gezogen (UTC, Ende von tar): ${zeit_speicher}
Reihenfolge: erst Datenbank, dann Dateiablage (siehe docs/betrieb/README.md)
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
