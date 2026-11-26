# Operating Carraway (self-hosting)

German version: [README.md](README.md)

This guide describes how to run Carraway on your own server: one Docker Compose stack per customer, or several customers on a
shared Postgres instance with one database each.

## Components

| Service | Purpose | Command in the image |
|---|---|---|
| `datenbank` | PostgreSQL 18, data in the `datenbank` volume | (Postgres image) |
| `migrate` | one-shot: create or upgrade the database structure, then the container exits | `node dist/migrate.js` |
| `api` | API under `/api/v1` and the web app from the same origin (`WEB_AUSLIEFERN=1`) | `node dist/server.js` |
| `worker` | computes the KPI snapshots (pg-boss queue) and reports its heartbeat | `node dist/worker.js` |

All three roles run the same image (`Dockerfile` in the repository). Released report files live in the `speicher` volume.

## Prerequisites

- Docker with the Compose plugin (Compose 2.20 or newer), a server in the country your contract with the customer requires.
- A DNS name and a reverse proxy with a TLS certificate in front (see below). The API itself does not speak TLS.
- As a rule of thumb 2 GB of memory and 2 CPU cores per customer; PDF reports are rendered by Typst inside the API process.
  Measure the real need under load (`/metriken`).

## Installation

```bash
git clone <repository address> carraway && cd carraway/deploy
cp .env.beispiel .env
$EDITOR .env            # fill in the required values, hints are in the file
docker compose up -d --build
docker compose ps       # all services "healthy", migrate "exited (0)"
```

The stack refuses to start if a required variable is missing (`docker compose` aborts and names the variable). There are no default
passwords. To use a prebuilt image from your own registry instead of `--build`, set `CARRAWAY_IMAGE` in `.env`.
The stack builds the core (`CARRAWAY_VARIANTE=kern`, default; `docs/open-core.md`). The extensions (Excel add-in, LP portal, ESG,
single sign-on, AI) are only available in hosting by Rehlytics; their image is kept in a private registry only.

Generate random values with `openssl rand -hex 24` (database passwords) and `openssl rand -base64 48` (`BETTER_AUTH_SECRET`).

### First administrator (`/einrichtung`)

As long as no person exists, `/einrichtung` is open: whoever opens the page first becomes global administrator. So set up first,
then expose to the network:

1. The stack only listens on `127.0.0.1:8787` (`API_BIND`). Open `http://localhost:8787/einrichtung` through an SSH tunnel
   (`ssh -L 8787:127.0.0.1:8787 server`). `APP_ORIGIN` must equal the address in the browser; for this step set
   `APP_ORIGIN=http://localhost:8787` and switch it to the public address afterwards (`docker compose up -d api`).
2. Enter name, e-mail address and a password of at least 12 characters.
3. Sign in. With `ZWEI_FAKTOR_PFLICHT=1` (default) the app guides you through setting up the authenticator app; store the backup
   codes safely.
4. Further people are created by the administration under "Verwaltung" (start password, to be changed at first sign-in), or they
   sign in with company sign-in (Entra ID/Google, `OIDC_*`) if they were created beforehand with the same address.

Afterwards `/einrichtung` answers `registration_closed`.

## Environments: demo, test, echt (production)

`CARRAWAY_UMGEBUNG` labels the environment. The app shows a banner in `demo` and `test`, none in `echt`.

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
`SMTP_ABSENDER`; connecting mailbox and calendar and every mail with a one-time link additionally need `GEHEIMNIS_SCHLUESSEL` (`openssl rand -base64 32`).
Administrators check the status under "Account, Mail delivery" (no secrets) and send a test mail to their own address. App registrations at Microsoft and
Google (`POSTFACH_*`, read-only), IMAP, key rotation and the privacy notes are described in `docs/sicherheit/Mail-und-Kalender.md` (German); all variables
are explained in `.env.beispiel`.

For the demo there is a mail catcher: `docker compose --profile demo-mail up -d` starts `mailpit` (only on `127.0.0.1:8025`); in `.env`, `SMTP_HOST=mailpit`,
`SMTP_PORT=1025` and `SMTP_TLS=keine` point to it. Nothing leaves the machine. `pnpm --filter @carraway/api demo:postfach` creates invented mails and
meetings for the demo person Vera (after `pnpm db:seed`, using the demo provider, no account needed).

## Reverse proxy and TLS

Put the API behind a reverse proxy (Caddy, nginx, Traefik or your hosting provider's) that terminates TLS.

- `APP_ORIGIN` is the public address with `https://`, without a path (several separated by commas). It determines cookies
  (`Secure`), the company sign-in callback and the allowed origins: state-changing requests with a foreign `Origin` are rejected.
  For `https://` addresses the API sends `Strict-Transport-Security`.
- Set `PROXY_VERTRAUEN=1` only if the proxy sets or appends `X-Forwarded-For` itself. The API takes the **last** entry as the
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

- **Logs:** one JSON line per event on standard output (`docker compose logs -f api worker`), minimum level `LOG_STUFE`. Request
  lines carry request ID, method, route pattern, status, duration in milliseconds and the user ID; no addresses, names, amounts,
  query strings or secrets. Errors are logged without query parameters.
- **Health:** `GET /api/v1/health` needs no sign-in. 200 means the database answers; 503 means it does not. In addition:
  `worker.status` (`ok`, `ausgefallen` after more than 30 seconds without heartbeat, `unbekannt` if there never was one),
  `warteschlange.wartend` and `aeltesterWartenderSekunden` (lag in pg-boss) and `ausgangskorb` (jobs the worker has not picked up
  yet; grows when the worker is dead). A worker outage does not make the API unready.
- **Metrics:** `GET /metriken` (Prometheus text format, `Authorization: Bearer <METRIKEN_TOKEN>`). Without `METRIKEN_TOKEN` the
  endpoint is off. Request duration as a histogram per method, route pattern and status class, database connections, queue,
  outbox, worker heartbeat.
- **Operating status:** Administration → Operations (`GET /api/v1/operations/status`, global administrators only): database, migration state, age of
  the worker heartbeat, backlogs (snapshots, mail, AI extraction, register monitoring), whether file storage is writable, SMTP configured yes or no,
  AI provider. `/metriken` carries heartbeat age and backlogs (`carraway_rueckstand_*`) for alerts.
- **Container health:** `api` through the health request, `worker` through its heartbeat file. Docker does not restart unhealthy
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

Two roles per tenant, created by `deploy/sql/mandant.sql` (on first start of the Compose stack and by `mandant-anlegen.sh`):

| Role | Purpose | Privileges |
|---|---|---|
| `<db>_eigentuemer` | owns the database, runs migrations | everything (DDL) in the schemas `public` and `drizzle` |
| `<db>_app` | runtime of API and worker | `SELECT`, `INSERT`, `UPDATE`, `DELETE` on tables in schema `public`, sequences; **no** `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, no access to `drizzle` |

Measured against the code and a run on a fresh database: the application needs no DDL in schema `public`. One exception:
**pg-boss** (the queue) creates its tables and partitions in schema `pgboss` at runtime. That schema therefore belongs to the app
role (`CREATE SCHEMA pgboss AUTHORIZATION <db>_app`), and `PGBOSS_SCHEMA_ANLEGEN=0` stops pg-boss from attempting a
`CREATE SCHEMA` (which would need `CREATE` on the whole database). Schema `pgboss` also holds the small table
`carraway_herzschlag`, created by the worker. Database access is limited to the tenant's roles (`REVOKE ... FROM PUBLIC`):
other roles on the same instance cannot enter the database.

## One database per customer on a shared Postgres instance

If you run several customers on one instance (instead of one Compose stack each), create one database per customer:

```bash
export DATABASE_URL_SUPERUSER=postgres://admin@db.internal:5432/postgres   # password via PGPASSWORD or ~/.pgpass
DB_HOST=db.internal deploy/mandant-anlegen.sh examplecustomer
# creates mandanten/examplecustomer.env (mode 600) with DATABASE_URL_EIGENTUEMER and DATABASE_URL
docker run --rm --env-file mandanten/examplecustomer.env -e CARRAWAY_UMGEBUNG=echt <image> node dist/migrate.js
```

Then the customer's `api` and `worker` run with `DATABASE_URL` (only that, not `DATABASE_URL_EIGENTUEMER`) and
`PGBOSS_SCHEMA_ANLEGEN=0`. The script generates the passwords (or use `EIGENTUEMER_PASSWORT` and `APP_PASSWORT`). It is repeatable;
a second run resets the passwords. Give each customer its own `BETTER_AUTH_SECRET`, its own file storage and its own address.

## Updating

```bash
cd carraway && git pull && cd deploy
./sicherung.sh                           # always back up first
docker compose up -d --build             # rebuilds the image, migrate runs before api and worker
docker compose ps && curl -s http://127.0.0.1:8787/api/v1/health
```

### Moving from the former product name

New installations use the name `carraway` everywhere: Compose project, database `carraway`, roles `carraway_admin`, `carraway_app` and
`carraway_eigentuemer`, images `carraway:kern` and `carraway:voll`, backup folders `carraway-<database>-<timestamp>`. An installation created
under the former name `fundament` keeps its data if the old names are pinned in `.env`. Without these lines Compose creates new, empty
volumes and the roles are named differently:

```bash
COMPOSE_PROJECT_NAME=fundament      # determines the volume names
DB_NAME=fundament                   # roles fundament_app and fundament_eigentuemer
DB_ADMIN_BENUTZER=fundament_admin
CARRAWAY_IMAGE=fundament:kern       # only if the image was built and pinned under the old name
```

Per-customer databases (`fundament_<kunde>`) keep their names; the tenant's `DB_NAME` or `DATABASE_URL` keeps pointing at them. Further
changes when updating an existing installation:

- Environment variables: `FUNDAMENT_UMGEBUNG` is now `CARRAWAY_UMGEBUNG`, `FUNDAMENT_IMAGE` is now `CARRAWAY_IMAGE`. The old names no longer
  apply; rename them in `.env` before updating, otherwise `docker compose` aborts (`CARRAWAY_UMGEBUNG fehlt`).
- Metrics at `/metriken`: the prefix `fundament_` is now `carraway_`. Adjust alert rules and dashboards.
- The worker's heartbeat table is now `pgboss.carraway_herzschlag`, created by the worker itself. The old table `pgboss.fundament_herzschlag`
  stays behind and can be dropped: `DROP TABLE IF EXISTS pgboss.fundament_herzschlag;`.
- Backups: new folders are named `carraway-<database>-…`. The retention of `sicherung.sh` only covers folders with that name; older folders
  `fundament-<database>-…` stay and can be deleted or renamed by hand. `wiederherstellung.sh` accepts any folder.
- Keys: API and values keys already issued (`fdk_…`, `fdw_…`) stay valid; new ones start with `cwk_` and `cww_`.
- Excel add-in: the function namespace is `CARRAWAY`. Change formulas with the former namespace in existing workbooks using Find and
  Replace; reload the manifest.
- In the browser, language, theme and selected fund have to be chosen once more (the storage keys have new names).

The migration is repeatable and runs on every `up` before `api` and `worker`. It has no downgrade: going back means restoring the
backup and starting the old image. Pin image versions by tag or digest so the way back is known. API and worker check at startup that
the database has exactly the migrations the code knows and exit with a clear log line otherwise (an older image does not start
against a newer database). Procedure and rollback rule: [docs/betrieb/README.md](../docs/betrieb/README.md) (German).

## Backup and restore

```bash
SICHERUNG_ZIEL=/mnt/backup ./sicherung.sh                 # database + file storage, checksums, 14 days retention
./wiederherstellung.sh /mnt/backup/carraway-carraway-20261120-120000
```

A backup consists of `datenbank.dump` (`pg_dump` custom format, schemas `public` and `drizzle`), `speicher.tar.gz` (all files of the
storage: documents, reports, per-investor report versions, notices, receipts, booking exports, reporting files), `SHA256SUMS` and
`INFO.txt` (with the times of database and file storage; database first, then files). The queue (`pgboss`) is not included; it only holds transient jobs, KPI snapshots can be
recomputed.

- Store backups on another medium and in another place than the data (another server, object storage, tape). Schedule with `cron`
  or a systemd timer, for example daily at 02:00: `0 2 * * * cd /opt/carraway/deploy && SICHERUNG_ZIEL=/mnt/backup ./sicherung.sh`.
- `SICHERUNG_AUFBEWAHREN_TAGE` (default 14) deletes older backups of this tenant; `0` never deletes.
- Compose mode runs `pg_dump` inside the database container so client and server have the same version. Direct mode (`--direkt`,
  own instance) aborts if the client is older than the server.
- Restore stops `api` and `worker`, recreates the database with the same roles and privileges, loads dump and files, and starts
  both again. It overwrites the current state and therefore asks first (`--ja` skips the question).
- **Practise restoring:** once a quarter and after every larger change, restore a backup into an empty trial stack (different
  `COMPOSE_PROJECT_NAME`) and sign in. For the technique there is the automated test `pnpm ops:sicherung-test` in the repository
  (dump, restore into a fresh database, comparison of row counts and checksums of all tables and SHA-256 comparison of the files of every
  file kind); it runs in CI for every state of `main`. After a real restore, `pnpm ops:dateien-pruefen` checks database and file
  storage against each other. Full runbook (German): [docs/betrieb/README.md](../docs/betrieb/README.md).

Not part of the backup and managed separately: the `.env` file (secrets) and the proxy configuration. Without the
`BETTER_AUTH_SECRET` of the time of the backup, authenticator apps stay invalid (the TOTP secrets are encrypted with it);
passwords themselves are hashed and stay valid.

## Troubleshooting

| Observation | Cause and remedy |
|---|---|
| `docker compose` aborts with "… fehlt" | a required variable is missing in `.env` (name in the message and in `.env.beispiel`) |
| `api` does not start: `BETTER_AUTH_SECRET … Pflicht` | secret too short (at least 32 characters) or not set for an `https` address |
| sign-in fails with `origin_invalid` | `APP_ORIGIN` does not match the address in the browser (scheme, host, port) |
| many failed attempts, lockout for everyone behind the proxy | `PROXY_VERTRAUEN=1` missing, the API only sees the proxy's address |
| `worker.status` is `ausgefallen` or `unbekannt` | `docker compose logs worker`; if it runs, check that `migrate` succeeded |
| `ausgangskorb` grows | worker is stopped or cannot reach the database; jobs are not lost and are caught up |
