# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
#
# Varianten (Open Core, docs/open-core.md), gewählt beim Bauen über `--build-arg VARIANTE` (Vorgabe `kern`):
#   kern   Kern ohne Erweiterungen (apps/api, apps/web); das Image für Selbsthoster, baut ohne den Ordner ee/ (öffentliches Repo)
#   voll   Kern plus Erweiterungen (ee/); nur für das Hosting durch Rehlytics, gebaut aus dem privaten Repo und nur in einer privaten
#          Registry abgelegt. Ohne ee/ bricht der Bau ab; ein Umstellen der Variable liefert also keine Erweiterungen.
# Ein Image für alle drei Rollen, gewählt über den Befehl:
#   node dist/server.js    API; mit WEB_AUSLIEFERN=1 liefert sie auch die Oberfläche aus (ein Ursprung)
#   node dist/worker.js    Worker (Kennzahlen-Snapshots, KI-Auslesung, Mailversand, Postfach-Abgleich; pg-boss)
#   node dist/migrate.js   einmalige Migrationen, danach beendet sich der Container
#   node dist/geheimnis-rotieren.js   Schlüsselwechsel für gespeicherte Zugangsdaten (docs/sicherheit/Mail-und-Kalender.md)
#
# Node exakt wie in .github/workflows/ci.yml (NODE_VERSION) und pnpm wie dort (PNPM_VERSION), damit Bau und CI auf
# derselben Laufzeit laufen. Tag plus Digest: der Tag sagt, was es ist, der Digest sorgt dafür, dass ein Neubau genau
# dieses Image zieht. Beim Anheben von Node alle Stellen (ci.yml, Tag, Digest) zusammen ändern.
#
# Gebaut wird auf dem offiziellen Node-Image mit Alpine; zur Laufzeit kommt nur die Node-Binärdatei desselben Images auf
# ein nacktes Alpine (statt des ganzen Node-Images mit npm und Yarn). Das hält das Image bei rund 340 MB entpackt
# (davon Node 128, Laufzeitmodule 149; gemessen in docs/betrieb/README.md). Alle nativen Module (Typst, Zeichenfläche) werden im Node-Alpine-Image installiert und passen damit zur musl-Laufzeit.
ARG NODE_IMAGE=node:24.22.2-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8
# Gleiche Alpine-Version wie im Node-Image (3.24.x), damit libstdc++ zur Binärdatei passt.
ARG ALPINE_IMAGE=alpine:3.24@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf
ARG PNPM_VERSION=11.13.0
ARG VARIANTE=kern

# ---------------------------------------------------------------------------
# laufzeitmodule: native Module, die esbuild nicht bündelt (Typst-Compiler für die PDF-Berichte).
# `npm ci` gegen deploy/laufzeit/package-lock.json: genau die Version aus apps/api/package.json, passend zu Plattform und libc.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS laufzeitmodule
WORKDIR /laufzeit
COPY deploy/laufzeit/package.json deploy/laufzeit/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------------------------------------------------------------------------
# bauen: Abhängigkeiten einmal exakt installieren, dann API-Bündel und Oberfläche bauen.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS bauen
ARG PNPM_VERSION
ARG VARIANTE
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
# Je Variante nur die Pakete ihrer Einstiege (samt Abhängigkeiten); die Ergebnisse liegen danach einheitlich unter /ausgabe.
RUN set -eu; \
    case "$VARIANTE" in \
      kern) pnpm --filter @carraway/api --filter @carraway/web build; api=apps/api/dist; web=apps/web/dist ;; \
      voll) test -d ee || { echo "VARIANTE=voll gibt es nur im Hosting durch Rehlytics (Ordner ee/ fehlt)" >&2; exit 1; }; \
            pnpm --filter @carraway/ee-api --filter @carraway/ee-web build; api=ee/api/dist; web=ee/web/dist ;; \
      *) echo "VARIANTE muss kern oder voll sein" >&2; exit 1 ;; \
    esac; \
    mkdir -p /ausgabe; cp -R "$api" /ausgabe/api; cp -R "$web" /ausgabe/web

# ---------------------------------------------------------------------------
# laufzeit: kleines Image, kein Paketmanager im Betrieb, kein Root.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS node
FROM ${ALPINE_IMAGE} AS laufzeit
WORKDIR /app

# libstdc++ braucht Node; `apk upgrade` zieht die Sicherheitskorrekturen seit dem Erscheinen des Basis-Images nach.
RUN apk upgrade --no-cache \
    && apk add --no-cache libstdc++ \
    && addgroup -S -g 10001 carraway \
    && adduser -S -u 10001 -G carraway -h /app -s /sbin/nologin carraway \
    && mkdir -p /daten/speicher \
    && chown -R carraway:carraway /daten
COPY --from=node /usr/local/bin/node /usr/local/bin/node

ENV NODE_ENV=production \
    PORT=8787 \
    STORAGE_DIR=/daten/speicher \
    WEB_VERZEICHNIS=/app/web \
    MIGRATIONEN_VERZEICHNIS=/app/drizzle

COPY --from=laufzeitmodule /laufzeit/node_modules ./node_modules
COPY --from=bauen /ausgabe/api ./dist
COPY --from=bauen /ausgabe/web ./web
COPY --from=bauen /app/packages/db/drizzle ./drizzle

# Berichtsdateien, die freigegeben wurden (siehe apps/api/src/berichte/speicher.ts); gehört in die Sicherung.
VOLUME ["/daten/speicher"]

USER carraway
EXPOSE 8787

# Nur für die Rolle `api` sinnvoll; Worker und Migration überschreiben den Health-Check in docker-compose.yml.
# Node statt curl: kein zusätzliches Paket; die Frist liegt unter der von Docker (5 s). Exec-Form, keine Shell.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/v1/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# Exec-Form: `node` ist Prozess 1 und bekommt SIGTERM direkt; API und Worker fahren dabei sauber herunter.
CMD ["node", "dist/server.js"]
