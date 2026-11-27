#!/bin/sh
# Provision the tenant before migrations, or on its own before restoring a dump.
set -eu
for value in "$DB_NAME" "$DB_OWNER_PASSWORD" "$DB_APP_PASSWORD"; do
  case "$value" in ''|*[!A-Za-z0-9_-]*) echo 'Use letters, digits, _ or - for the database name and role passwords.' >&2; exit 1 ;; esac
done
# PostgreSQL identifiers are limited to 63 bytes, including the owner suffix.
[ "${#DB_NAME}" -le 51 ] || { echo 'DB_NAME exceeds 51 characters.' >&2; exit 1; }

psql -X -q -d postgres -v db="$DB_NAME" -v eigentuemer="${DB_NAME}_eigentuemer" \
  -v app="${DB_NAME}_app" -v rotate=false -f /app/sql/mandant.sql
