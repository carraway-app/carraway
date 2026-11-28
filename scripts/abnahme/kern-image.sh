#!/usr/bin/env bash
# Run the browser checks against the core image in a disposable Compose stack.
set -euo pipefail

image=${1:?Usage: kern-image.sh IMAGE OUTPUT_DIRECTORY}
ausgabe=${2:?Usage: kern-image.sh IMAGE OUTPUT_DIRECTORY}
mkdir -p "$ausgabe"
ausgabe=$(cd "$ausgabe" && pwd)
temp=$(mktemp -d)
export COMPOSE_PROJECT_NAME="carraway-browser-$$"
export CARRAWAY_IMAGE="$image"
export CARRAWAY_ENVIRONMENT=demo
export DEMO_SPRACHE=de
export API_BIND=127.0.0.1
export API_PORT=8787
export APP_ORIGIN="http://127.0.0.1:$API_PORT"
export DB_NAME=carraway
export DB_ADMIN_USER=carraway_admin
DB_ADMIN_PASSWORD=$(openssl rand -hex 24)
DB_OWNER_PASSWORD=$(openssl rand -hex 24)
DB_APP_PASSWORD=$(openssl rand -hex 24)
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
export DB_ADMIN_PASSWORD DB_OWNER_PASSWORD DB_APP_PASSWORD BETTER_AUTH_SECRET

cat > "$temp/compose.yml" <<'YAML'
services:
  postgres:
    ports:
      - "127.0.0.1::5432"
YAML
compose=(docker compose --env-file /dev/null -f deploy/docker-compose.yml -f "$temp/compose.yml")
aufraeumen() {
  "${compose[@]}" logs --no-color > "$ausgabe/compose.log" 2>&1 || true
  "${compose[@]}" down --volumes --remove-orphans
  rm -rf "$temp"
}
trap aufraeumen EXIT

# Starting the stack requires carraway-migrate to exit successfully.
"${compose[@]}" up -d --wait --wait-timeout 120
postgres=$("${compose[@]}" port postgres 5432)
# The seed truncates tables, so it needs the owner role of this disposable database.
DATABASE_URL="postgres://${DB_NAME}_eigentuemer:$DB_OWNER_PASSWORD@$postgres/$DB_NAME" pnpm db:seed
node --input-type=module - "$APP_ORIGIN" "$ausgabe" <<'JS'
import { pruefeBrowser } from "./scripts/abnahme/e2e.mjs";
await pruefeBrowser(process.argv[2], process.argv[3]);
JS
