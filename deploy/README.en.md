# Operating Carraway (self-hosting)

This guide describes how to run Carraway on your own server: one Docker Compose stack per customer, or several customers on a
shared Postgres instance with one database each.

## Components

| Service | Purpose | Command in the image |
|---|---|---|
| `postgres` | PostgreSQL 18, data in the `datenbank` volume | (Postgres image) |
| `carraway-migrate` | one-shot: create or upgrade the database structure, then the container exits | `./bootstrap.sh && node dist/migrate.js` |
| `carraway` | API under `/api/v1` and the web app from the same origin (`WEB_AUSLIEFERN=1`) | `node dist/server.js` |
| `carraway-worker` | computes the KPI snapshots (pg-boss queue) and reports its heartbeat | `node dist/worker.js` |

All three roles run the same image (`Dockerfile` in the repository). Released report files live in the `speicher` volume.

## Prerequisites

- Docker with the Compose plugin (Compose 2.20 or newer), a server in the country your contract with the customer requires.
- A DNS name and a reverse proxy with a TLS certificate in front (see below). The API itself does not speak TLS.
- As a rule of thumb 2 GB of memory and 2 CPU cores per customer; PDF reports are rendered by Typst inside the API process.
  Measure the real need under load (`/metriken`).

## Installation

```bash
git clone <repository address> carraway && cd carraway/deploy
cp .env.example .env
$EDITOR .env            # fill in the required values, hints are in the file
docker compose up -d
docker compose ps -a    # all services "healthy", carraway-migrate "exited (0)"
```

The Compose file in each public release pulls its matching core image from GHCR. The published image supports **linux/amd64** only.
Set `CARRAWAY_IMAGE` to override the image. For a local source build, add
`COMPOSE_FILE=docker-compose.yml:docker-compose.build.yml` to `.env` on Linux or macOS and run `docker compose up -d --build`.
Existing installations can keep their German environment variable names. A nonempty English setting takes precedence.

Generate random values with `openssl rand -hex 24` (database passwords) and `openssl rand -base64 48` (`BETTER_AUTH_SECRET`).

## Coolify

1. In your project, add a **Public Repository** resource for `https://github.com/carraway-app/carraway`. Choose the **Docker Compose** build pack. Ignore “Dockerfile suggested”.
2. Coolify prefills **Compose file** with `/deploy/docker-compose.yml`. Set **Base directory** to `/deploy`, then click **Use /docker-compose.yml**. Save and load the Compose definition.
3. Under **Environment Variables**, enter the required values from `.env.example`. Coolify enables **Available at Buildtime** by default. This Compose setup pulls a prebuilt image, so the setting has no effect. You can clear it for secrets.
4. Under **Domains**, select **carraway** and enter the HTTPS address without a port, for example `https://fund.example.org`. Coolify sets the internal port to **8787**. Use the same address for `APP_ORIGIN`. Behind the Coolify proxy, set `TRUST_PROXY=1`. [Reverse proxy and TLS](#reverse-proxy-and-tls)
5. Select **Deploy**. The stack appears as one application. Open its **Deployments** and select the deployment log for image pulls or startup failures. In the application's **Logs**, select each service for its container output. Check `postgres` first, then `carraway-migrate` (exit code 0), then `carraway` and `carraway-worker`. If no containers were created, use the deployment log.
6. Before updating, take a backup. Select the new release commit or image tag and **Redeploy**. A deploy webhook or automatic deployment on a Git push can trigger the same update. For a moving image tag, set the Compose **Custom Build Command** to `docker compose pull` so the redeploy fetches its current image. The migration runs before the application and worker start. [Coolify Docker Compose guide](https://coolify.io/docs/applications/builds/docker-compose)

### First administrator (`/setup`)

Public certificate transparency logs can reveal the hostname as soon as a TLS certificate is issued. Creating the first administrator requires the operator’s setup token.

1. Read the latest `Carraway /setup token:` line in `docker compose logs carraway`. In Coolify, open the application’s **Logs** and select the **carraway** service. Each API start before setup replaces the generated token.
2. Open `/setup` at your configured `APP_ORIGIN`. Enter the token, your name, email address and a password of at least 12 characters. Completing setup consumes the token and closes `POST /api/v1/setup`.
3. Sign in. With `REQUIRE_TWO_FACTOR=1` (default), follow the authenticator setup and store the backup codes safely. Create further accounts under **Administration**.

For automated installations, set the optional secret `SETUP_TOKEN` before starting the API. Generate a value with `openssl rand -hex 32`. The API uses this value across restarts until setup succeeds and omits it from the startup log. Send it in the JSON field `token` alongside `name`, `email` and `password` to `POST /api/v1/setup`. You can then remove the secret from the deployment settings.

The form also accepts `/setup?token=…` and clears the query from the browser address. If using a URL, configure any reverse proxy to omit query strings from access logs.

## Environments: demo, test, echt (production)

`CARRAWAY_ENVIRONMENT` labels the environment. The app shows a banner in `demo` and `test`, none in `echt`.

| Environment | Purpose | Notes |
|---|---|---|
| `demo` | demonstrations, practice data | may be filled from a checkout with the seed script (`pnpm db:seed`), which creates demo accounts with known passwords, so never run it publicly reachable |
| `test` | acceptance, trial operation with invented or agreed data | the seed script is technically allowed here too; banner as in `demo` |
| `echt` | real data | `APP_ORIGIN` must be `https://`, `BETTER_AUTH_SECRET` at least 32 characters, the seed script refuses to run |

Every environment is its own stack with its own database and secret (different `COMPOSE_PROJECT_NAME`, different `API_PORT`).
Practice data never goes into the production database and vice versa: do not restore a production backup into the test
environment. With `NODE_ENV=production` (set in the image) API and worker always require their own `BETTER_AUTH_SECRET` and an
explicit `DATABASE_URL`.

## Mail and calendar

Both are off by default. Outgoing mail (key-figure links to companies, notifications about notices in the portal, report releases) needs `SMTP_HOST` and
`SMTP_FROM`; connecting mailbox and calendar and every mail with a one-time link additionally need `SECRET_KEY` (`openssl rand -base64 32`).
Administrators check the status under "Account, Mail delivery" (no secrets) and send a test mail to their own address. App registrations at Microsoft and
Google (`MAILBOX_*`, read-only), IMAP, key rotation and the privacy notes are described in `docs/security/mail-and-calendar.md`; all variables
are explained in `.env.example`.

For the demo there is a mail catcher: `docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d` starts `mailpit` (only on `127.0.0.1:8025`); in `.env`, `SMTP_HOST=mailpit`,
`SMTP_PORT=1025` and `SMTP_TLS=keine` point to it. Nothing leaves the machine. `pnpm --filter @carraway/api demo:postfach` creates invented mails and
meetings for the demo person Vera (after `pnpm db:seed`, using the demo provider, no account needed).

## Reverse proxy and TLS

Put the API behind a reverse proxy (Caddy, nginx, Traefik or your hosting provider's) that terminates TLS.

- `APP_ORIGIN` is the public address with `https://`, without a path (several separated by commas). It determines cookies
  (`Secure`), the company sign-in callback and the allowed origins: state-changing requests with a foreign `Origin` are rejected.
  For `https://` addresses the API sends `Strict-Transport-Security`.
- Set `TRUST_PROXY=1` only if the proxy sets or appends `X-Forwarded-For` itself. The API takes the **last** entry as the
  client address (failed-attempt limit per address). The proxy must append the address rather than pass a client-supplied header
  through unchanged (nginx: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`). Without a proxy keep `0`, otherwise
  anyone can forge the address.
- The proxy owns: TLS (at least 1.2), HTTP/2, compression, request size limits (data-import uploads up to 20 MB, contact import up to 2 MB; a limit of 25 MB is enough), access restriction for `/metriken`
  (which additionally needs a token).
- The proxy forwards everything (`/`, `/api/`) to `127.0.0.1:8787`. A supplied `X-Request-Id` (8 to 64 characters from
  `A-Za-z0-9._-`) appears in the logs and in the response.
- Do not set `AKTEUR_HEADER_VERTRAUEN` unless a trusted proxy strips `X-Akteur` from clients and sets it itself.
- For the web app the API sets `X-Content-Type-Options`, `X-Frame-Options: DENY` and `frame-ancestors 'none'`. A stricter
  Content-Security-Policy belongs in the proxy if needed.

## Observability

- **Logs:** one JSON line per event on standard output (`docker compose logs -f carraway carraway-worker`), minimum level `LOG_LEVEL`. Request
  lines carry request ID, method, route pattern, status, duration in milliseconds and the user ID; no addresses, names, amounts,
  query strings or secrets. Errors are logged without query parameters.
- **Health:** `GET /api/v1/health` needs no sign-in. 200 means the database answers; 503 means it does not. In addition:
  `worker.status` (`ok`, `ausgefallen` after more than 30 seconds without heartbeat, `unbekannt` if there never was one),
  `warteschlange.wartend` and `aeltesterWartenderSekunden` (lag in pg-boss) and `ausgangskorb` (jobs the worker has not picked up
  yet; grows when the worker is dead). A worker outage does not make the API unready.
- **Metrics:** `GET /metriken` (Prometheus text format, `Authorization: Bearer <METRICS_TOKEN>`). Without `METRICS_TOKEN` the
  endpoint is off. Request duration as a histogram per method, route pattern and status class, database connections, queue,
  outbox, worker heartbeat.
- **Operating status:** Administration → Operations (`GET /api/v1/operations/status`, global administrators only): database, migration state, age of
  the worker heartbeat, backlogs (snapshots, mail, AI extraction, register monitoring), whether file storage is writable, SMTP configured yes or no,
  AI provider. `/metriken` carries heartbeat age and backlogs (`carraway_rueckstand_*`) for alerts.
- **Container health:** `carraway` through the health request, `carraway-worker` through its heartbeat file. Docker does not restart unhealthy
  containers by itself; use monitoring (for example HetrixTools, Prometheus with alerts, `docker-autoheal`).

## Putting data in and taking it out

All routes run through the application and appear in the change log; none needs access to the database.

- **Data import** (sidebar "Datenübernahme" / "Data import"): upload an Excel or CSV file from the template, check it, take it over (uploading
  and checking from the role editor, taking over by a different person with the role approver on every fund touched). The take-over is one
  transaction and repeatable per fund; the run's acceptance record is available as PDF and Excel. Contacts (organisations, persons,
  roles) are imported through "Kontakte → Importieren" (Contacts → Import). Uploaded files are stored as an import run in the database and
  are therefore part of the backup.
- **Full export** (Verwaltung → "Export und API", global administrators only): a ZIP with one CSV file per table, the approved report
  files, `schema.json`, `rechenregeln.md` and a manifest with checksums. It contains no passwords, sessions or API key hashes and is
  streamed while downloading (it takes a while for large data sets). It is the open way of returning data at the end of the contract; the
  backup remains responsible for technical recovery.
- **API:** the OpenAPI description (`/api/v1/openapi.json`) and a documentation page (`/api/v1/docs`, no scripts and no external files) are
  reachable without signing in; block both paths in the proxy if that is not wanted. Writing calls accept `Idempotency-Key` (24 hours),
  `POST /api/v1/stapel` combines up to 100 operations in one transaction, `GET /api/v1/changes` returns changes since a point in time.
- **Fonts:** the interface serves Instrument Sans and IBM Plex Mono itself; opening the page sends no requests to third parties.

## Database privileges

Before schema migrations, `carraway-migrate` runs `deploy/sql/mandant.sql` as administrator. It creates missing roles and the database, preserves existing passwords, and reapplies privileges if setup was interrupted. Schema migrations run as the owner.

| Role | Purpose | Privileges |
|---|---|---|
| `<db>_eigentuemer` | owns the database, runs migrations | everything (DDL) in the schemas `public` and `drizzle` |
| `<db>_app` | runtime of API and worker | `SELECT`, `INSERT`, `UPDATE`, `DELETE` on tables in schema `public`, sequences; **no** `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, read-only access to the migration journal |

Measured against the code and a run on a fresh database: the application needs no DDL in schema `public`. One exception:
**pg-boss** (the queue) creates its tables and partitions in schema `pgboss` at runtime. That schema therefore belongs to the app
role (`CREATE SCHEMA pgboss AUTHORIZATION <db>_app`), and `PGBOSS_SCHEMA_ANLEGEN=0` stops pg-boss from attempting a
`CREATE SCHEMA` (which would need `CREATE` on the whole database). Schema `pgboss` also holds the small table
`carraway_herzschlag`, created by the worker. Database access is limited to the tenant's roles (`REVOKE ... FROM PUBLIC`):
other roles on the same instance cannot enter the database.

## One database per customer on a shared Postgres instance

Create a private `provision.env` (mode 600) per tenant. Set `PGHOST`, `PGPORT`, `PGUSER` and `PGPASSWORD` for the database administrator, plus `DB_NAME` and the two role passwords `DB_OWNER_PASSWORD` and `DB_APP_PASSWORD`. Use the bootstrap script shipped in the release image:

```sh
docker run --rm --env-file provision.env <image> ./bootstrap.sh
```

The database must be reachable from the container. Run `node dist/migrate.js` in the same image with `DATABASE_URL_OWNER` set to the owner's connection URL. Give the application and worker the `DATABASE_URL` for the app role and `PGBOSS_SCHEMA_ANLEGEN=0`. Keep admin credentials in the provisioning step. Use a separate `BETTER_AUTH_SECRET`, file store and address for each tenant.

## Updating

The default tag `X.Y.Z` pins one release. For installations that should receive patches within a minor version, set `CARRAWAY_IMAGE=ghcr.io/carraway-app/carraway:X.Y` (recommended). Substitute the actual version numbers. `X` tracks the major version and `latest` follows stable releases across major versions. Reserve both for test instances.

**Upgrading from the old service names.** Back up and run `docker compose down` with the **old** Compose file before changing releases. Keep the project name and both volumes. In Coolify, stop the existing resource and verify its persistent storage names before redeploying it. The new service names change container names and internal DNS. The volume keys `datenbank` and `speicher` still resolve to the same project-scoped volumes. Never use `down -v` during an upgrade.

```bash
cd carraway/deploy
./sicherung.sh                    # while the current stack is running
# On the first upgrade from the old service names: docker compose down
git pull --ff-only
docker compose pull && docker compose up -d
docker compose ps -a && curl -fsS http://127.0.0.1:8787/api/v1/health
```

### Moving from the former product name

New installations use the name `carraway` everywhere: Compose project, database `carraway`, roles `carraway_admin`, `carraway_app` and
`carraway_eigentuemer`, images `carraway:kern` and `carraway:voll`, backup folders `carraway-<database>-<timestamp>`. An installation created
under the former name `fundament` keeps its data if the old names are pinned in `.env`. Without these lines Compose creates new, empty
volumes and the roles are named differently:

```bash
COMPOSE_PROJECT_NAME=fundament      # determines the volume names
DB_NAME=fundament                   # roles fundament_app and fundament_eigentuemer
DB_ADMIN_USER=fundament_admin
CARRAWAY_IMAGE=fundament:kern       # only if the image was built and pinned under the old name
```

Per-customer databases (`fundament_<kunde>`) keep their names; the tenant's `DB_NAME` or `DATABASE_URL` keeps pointing at them. Further
changes when updating an existing installation:

- Environment variables: `FUNDAMENT_UMGEBUNG` is now `CARRAWAY_ENVIRONMENT`, `FUNDAMENT_IMAGE` is now `CARRAWAY_IMAGE`. The old names no longer
  apply; rename them in `.env` before updating, otherwise `docker compose` aborts.
- Metrics at `/metriken`: the prefix `fundament_` is now `carraway_`. Adjust alert rules and dashboards.
- The worker's heartbeat table is now `pgboss.carraway_herzschlag`, created by the worker itself. The old table `pgboss.fundament_herzschlag`
  stays behind and can be dropped: `DROP TABLE IF EXISTS pgboss.fundament_herzschlag;`.
- Backups: new folders are named `carraway-<database>-…`. The retention of `sicherung.sh` only covers folders with that name; older folders
  `fundament-<database>-…` stay and can be deleted or renamed by hand. `wiederherstellung.sh` accepts any folder.
- Keys: API and values keys already issued (`fdk_…`, `fdw_…`) stay valid; new ones start with `cwk_` and `cww_`.
- Excel add-in: the function namespace is `CARRAWAY`. Change formulas with the former namespace in existing workbooks using Find and
  Replace; reload the manifest.
- In the browser, language, theme and selected fund have to be chosen once more (the storage keys have new names).

The migration is repeatable and runs on every `up` before `carraway` and `carraway-worker`. It has no downgrade: going back means restoring the
backup and starting the old image. Pin image versions by tag or digest so the way back is known. API and worker check at startup that
the database has exactly the migrations the code knows and exit with a clear log line otherwise (an older image does not start
against a newer database). Procedure and rollback rule: [docs/operations/README.md](../docs/operations/README.md).

## Backup and restore

```bash
BACKUP_DIR=/mnt/backup ./sicherung.sh                 # database + file storage, checksums, 14 days retention
./wiederherstellung.sh /mnt/backup/carraway-carraway-20261120-120000
```

A backup consists of `datenbank.dump` (`pg_dump` custom format, schemas `public` and `drizzle`), `speicher.tar.gz` (all files of the
storage: documents, reports, per-investor report versions, notices, receipts, booking exports, reporting files), `SHA256SUMS` and
`INFO.txt` (with the times of database and file storage; database first, then files). The queue (`pgboss`) is not included; it only holds transient jobs, KPI snapshots can be
recomputed.

- Store backups on another medium and in another place than the data (another server, object storage, tape). Schedule with `cron`
  or a systemd timer, for example daily at 02:00: `0 2 * * * cd /opt/carraway/deploy && BACKUP_DIR=/mnt/backup ./sicherung.sh`.
- `BACKUP_RETENTION_DAYS` (default 14) deletes older backups of this tenant; `0` never deletes.
- Compose mode runs `pg_dump` inside the database container so client and server have the same version. Direct mode requires Python 3 and a PostgreSQL client (`--direkt`,
  own instance) aborts if the client is older than the server.
- Restore stops `carraway` and `carraway-worker`, recreates the database with the same roles and privileges, loads dump and files, and starts
  both again. It overwrites the current state and therefore asks first (`--ja` skips the question).
- **Practise restoring:** once a quarter and after every larger change, restore a backup into an empty trial stack (different
  `COMPOSE_PROJECT_NAME`) and sign in. For the technique there is the automated test `pnpm ops:sicherung-test` in the repository
  (dump, restore into a fresh database, comparison of row counts and checksums of all tables and SHA-256 comparison of the files of every
  file kind); it runs in CI for every state of `main`. After a real restore, `pnpm ops:dateien-pruefen` checks database and file
  storage against each other. Full runbook: [docs/operations/README.md](../docs/operations/README.md).

Not part of the backup and managed separately: the `.env` file (secrets) and the proxy configuration. Without the
`BETTER_AUTH_SECRET` of the time of the backup, authenticator apps stay invalid (the TOTP secrets are encrypted with it);
passwords themselves are hashed and stay valid.

## Troubleshooting

| Observation | Cause and remedy |
|---|---|
| `docker compose` reports a missing variable | a required variable is missing in `.env` (name in the message and in `.env.example`) |
| `carraway` does not start: `BETTER_AUTH_SECRET … Pflicht` | secret too short (at least 32 characters) or not set for an `https` address |
| sign-in fails with `origin_invalid` | `APP_ORIGIN` does not match the address in the browser (scheme, host, port) |
| many failed attempts, lockout for everyone behind the proxy | `TRUST_PROXY=1` missing, the API only sees the proxy's address |
| `worker.status` is `ausgefallen` or `unbekannt` | `docker compose logs carraway-worker`; if it runs, check that `carraway-migrate` succeeded |
| `ausgangskorb` grows | worker is stopped or cannot reach the database; jobs are not lost and are caught up |
