# Operations: backup, restore, key rotation and upgrades

Runbook for the Compose stack in `deploy/`. See the [self-hosting guide](../../deploy/README.en.md) for installation, proxy and role details. Run commands from `deploy/` unless stated otherwise.

## What makes up an installation

| Component | Location | Included in the backup |
|---|---|---|
| Database (`public` and `drizzle` schemas) | Postgres | Yes, `datenbank.dump` |
| File storage: documents, reports, per-investor report versions, notices, vouchers, posting exports, regulatory reporting files | Volume `speicher` (`/daten/speicher`) | Yes, `speicher.tar.gz` |
| Job queue (`pgboss`) | Postgres | No. Jobs are transient, and metric snapshots can be recalculated. |
| `.env` with `SECRET_KEY`, `BETTER_AUTH_SECRET` and database passwords | Server | No. Store these separately from the backup. |
| Proxy configuration and certificates | Server | No |

Without the matching `SECRET_KEY`, saved mailbox credentials and SMTP outbox contents are unreadable. Without `BETTER_AUTH_SECRET`, second factors are invalid. Keep both secrets in a separate password manager or vault for as long as you retain the backups that depend on them.

## Backup

```bash
BACKUP_DIR=/mnt/sicherung ./sicherung.sh
```

The script dumps the database first (`pg_dump` in custom format, excluding `pgboss`), then archives file storage (`tar`). It checks both (`pg_restore -l`, `tar -t`) and adds `SHA256SUMS` and `INFO.txt`. The latter records the timestamps of both steps.

**Order and consistency.** Files are immutable and are written before their referring database rows. Every row in the dump therefore has its file in the later archive. The archive may contain extra files created between the two steps, which is harmless. Reversing the order could leave rows pointing to files missing from the archive. One exception occurs if the retention job removes an expired document file between the steps. The row in the dump still says deleted and the file is absent. The first retention run after restoration marks it permanently deleted, since its retention period had already elapsed.

For scheduling, retention (`BACKUP_RETENTION_DAYS`, default 14) and storage location, see [Backup and restore](../../deploy/README.en.md#backup-and-restore). Keep backups on separate media at another location. Take an additional backup before each upgrade involving a migration.

## Restore

```bash
./wiederherstellung.sh /mnt/sicherung/carraway-carraway-20261120-120000
```

The script verifies checksums, stops `carraway` and `carraway-worker`, recreates the database with the same roles and privileges, restores the dump, empties file storage and restores the archive, then starts `carraway` and `carraway-worker`. It overwrites the current installation and prompts for confirmation. `--ja` skips the prompt. Startup migrations have no effect when the schema is already current.

Then verify the following.

1. Run `curl -s http://127.0.0.1:8787/api/v1/health` and check Administration → Operations. The database should be reachable, migrations applied, file storage writable and the worker reporting a heartbeat within a few seconds.
2. Sign in with a second factor.
3. Check files against the database. Every row referring to a file must have that file, and its SHA-256 must match.

   ```bash
   DATABASE_URL=postgres://… SPEICHER_VERZEICHNIS=/pfad/zur/dateiablage pnpm ops:dateien-pruefen
   ```

   The repository script is read-only and covers all file types. For Compose, set `SPEICHER_VERZEICHNIS` to the host's `speicher` volume mount point and `DATABASE_URL` to a read connection to the database.

**Practise restoring** once a quarter and after major changes. Restore to an empty test stack with a separate `COMPOSE_PROJECT_NAME` and run all three checks. `pnpm ops:sicherung-test` also checks the procedure on every revision of `main` in CI. It dumps and restores to a fresh database, compares the row counts and checksums of all tables and verifies the SHA-256 of one file of **each** type after extraction. It also verifies that a corrupt file is detected. The test fails if a new file column lacks an entry in `scripts/ops/dateiablage.ts`.

## Key rotation

### `SECRET_KEY` (stored credentials)

1. Generate a new key with `openssl rand -base64 32`.
2. In `.env`, move the previous key to `SECRET_KEY_PREVIOUS` (separate multiple keys with commas) and set the new key as
   `SECRET_KEY`. Run `docker compose up -d carraway carraway-worker`. New encryption uses the new key and existing values remain readable.
3. Run `docker compose exec carraway-worker node dist/geheimnis-rotieren.js` to re-encrypt all values. The output counts newly encrypted, already current and unreadable values. The script exits with an error if any value is unreadable and leaves those values alone.
4. If every value is readable, retain the old key until **even the oldest retained backups** are no longer needed. Backups from before rotation contain values only the old key can decrypt. Restoring them requires `SECRET_KEY_PREVIOUS` or another rotation after restoration.
5. Keep the key in separate storage. See [Mail and calendar](../security/mail-and-calendar.md).

### `BETTER_AUTH_SECRET`

Changing this secret invalidates every second factor because it encrypts the TOTP secrets. Everyone must set up their second factor again. Rotate only if disclosure is suspected and inform the admins beforehand. Passwords remain valid because they are hashed.

### Database passwords

Back up first. Update `DB_APP_PASSWORD` and `DB_OWNER_PASSWORD` in `.env` and update the Postgres roles (`ALTER ROLE … PASSWORD …` as an admin). Then run `docker compose up -d`.

## Upgrade with migrations

Migrations run **forward only**.

1. Back up with `./sicherung.sh`. Record the installed version by image tag or digest so you can restore it.
2. When switching from the old service names for the first time, stop the stack with `docker compose down` before changing versions and keep the volumes. Update under the same project name with `git pull --ff-only && docker compose pull && docker compose up -d`. For a local source build, add the build override file from the installation guide. `carraway-migrate` sets up and migrates the database; `carraway` and `carraway-worker` start only after it succeeds.
   The stack builds the core (see [Open core](../open-core.md)). Deployments with extensions on Rehlytics managed hosting pull the full image from a private registry (`CARRAWAY_IMAGE`). The `.env` keys are `CARRAWAY_UMGEBUNG` and `CARRAWAY_IMAGE`.
3. Check `docker compose ps`, `curl -s http://127.0.0.1:8787/api/v1/health` and Administration → Operations.

**Version check.** At startup, the API and worker check that the database has exactly the migrations the code knows about. On a mismatch, they exit with a line such as `api startet nicht: Migrationsstand passt nicht zum Code` or its `worker …` equivalent, and give the reason.

- *The database lacks migrations known to the code.* The migration has not run. Run `docker compose run --rm carraway-migrate` or `pnpm db:migrate`, then start the services.
- *The database contains migrations unknown to the code.* The image is older than the database. Follow the recovery steps below.

In development and CI, `pnpm migrationen:pruefen` checks that journal timestamps are strictly increasing and numbers have no gaps or duplicates. Drizzle would otherwise silently skip a branch migration whose timestamp predates one already applied.

### Restore the previous release

- There are no down migrations. Startup rejects an older image against a newer database.
- **To revert an upgrade, restore the pre-upgrade backup and start the previous image.** This loses writes made since that backup. Rehearse the upgrade in a test environment first if the installation is busy.
- Fix a problem in the new release by building a corrected image and upgrading as above.
- Leave `drizzle.__drizzle_migrations` to the migration tooling. The startup check compares its contents with the files in the image.

## Routine status checks

Administration → Operations (global admins only) shows the database, migration status, worker heartbeat age, backlogs (metric snapshots, outgoing mail, AI extraction and register monitoring), file storage writability, SMTP and the AI provider. The backlogs and heartbeat age also appear in `/metriken` (`carraway_rueckstand_*`, `carraway_worker_herzschlag_alter_sekunden`) for alerting. As a guide, a heartbeat older than 30 seconds indicates a worker outage, and a backlog older than five minutes is worth investigating.

## Image and OCR verification (arm64, Docker 29, separate Compose project)

All roles use **one** image (API with the web app, worker, migration). The command selects the role. Building from the checkout with `docker build -t carraway:lokal .` succeeded without changes and included OCR.

| Component | Size in the image |
|---|---|
| Alpine 3.24 with `libstdc++` | 18 MB |
| Node binary | 128 MB |
| Runtime modules (Typst 48 MB, `tesseract.js-core` 44 MB, `@napi-rs/canvas` 25 MB, German and English language data 22 MB) | 149 MB |
| API and worker bundles (`dist`), web app (`web`), migrations (`drizzle`) | 29 MB, 4 MB, 11 MB |
| Total layers | About 340 MB unpacked and about 140 MB as a compressed archive (`docker save \| gzip`) |

The language data comes from the exact pinned npm packages `@tesseract.js-data/deu` and `eng` (checksums in `deploy/laufzeit/package-lock.json`, installed with `npm ci`). The worker fetches no language data at runtime and runs with `read_only`, with write access only to `/tmp`. Set `OCR=lokal` in `.env` to enable OCR. See [Document retention and local text recognition](../security/document-processing.md) for processing and limits.

The check used a running stack with migrations, demo data and a fictional scanned PDF with no text layer. To repeat it, run `node scripts/ops/ocr-image-pruefen.mjs --pdf <scan.pdf> --basis http://127.0.0.1:<Port>`. It signs in as the demo admin, uploads the file and waits for recognised text.

- From upload to recognised text and a search result: 3.2 s.
- The result had source `ocr` and mean confidence 95. OCR recognised the full sample text “Rechnung 4711 vom 3. Maerz 2026 Gesamtbetrag 1234 Euro netto Zahlbar innerhalb von 14 Tagen”, and document search returned it.
- Worker memory after OCR was below 100 MiB (3 GiB ceiling, see `WORKER_SPEICHER`).
- `/api/v1/health` reported the database reachable and a worker heartbeat after 2 s.

## Backup and restore verification with Docker Compose

The following run exercised `sicherung.sh` and `wiederherstellung.sh` against a real Compose stack with a separate `COMPOSE_PROJECT_NAME`, separate volumes and fictional demo data. The run ended with `docker compose down -v`.

1. Start the stack and load demo data (`pnpm db:seed` with the stack's `BETTER_AUTH_SECRET` so the demo accounts' second factors can be decrypted). Publish the test stack's database port locally only. Create a file of each type (`tsx scripts/ops/compose-sicherung-probe.ts anlegen <Adresse> <Verzeichnis>`, then copy to file storage with `tar`).
2. Stop `carraway` and `carraway-worker` because the worker recalculates metrics and changes tables. Capture the database state
   (`… compose-sicherung-probe.ts abbild <Adresse> vorher.json`, row count and checksum per table, columns, triggers and migrations) and list SHA-256 checksums for every stored file (`find /daten/speicher -type f | sort | xargs sha256sum` in the container).
3. Run `./sicherung.sh`, then `docker compose down -v` (removes the database and file storage), `docker compose up -d` (empty stack) and `./wiederherstellung.sh <Sicherung> --ja`.
4. Stop the services again, capture and compare the database state (`… compose-sicherung-probe.ts vergleichen vorher.json nachher.json`), compare the file list and run `pnpm ops:dateien-pruefen` against a copy of file storage. Restart `carraway` and `carraway-worker` and run `node scripts/ops/betrieb-status-pruefen.mjs --basis http://127.0.0.1:<Port>`.

Results (Docker 29, arm64, Postgres 18):

| Step | Result |
|---|---|
| State before backup | 114 tables, 3,474 rows, 38 triggers, 50 migrations, 31 files (264 KiB) across all seven file types, 18 MB database |
| Backup | About 1 s. `datenbank.dump` was 574 KiB and `speicher.tar.gz` 64 KiB. Both file backup paths worked, with the API stopped and running. |
| Start an empty stack after `down -v` | 7 s until all services were running |
| Restore | 8 s including the API and worker restart |
| Row count and checksum for each table, columns, triggers and migrations | Identical (114 tables) |
| SHA-256 of all 31 files | Identical. `ops:dateien-pruefen` reported a match for each type (3 documents and 1 of each of the other six types). |
| Application after restore | `/health` ok, `/operations/status` overall status “ok” (50 of 50 migrations, worker heartbeat and writable storage), sign-in with a second factor and OCR of a new scan working |

The scripts ran without changes. On Docker Desktop (macOS, Windows), `SPEICHER_VERZEICHNIS` for `ops:dateien-pruefen` must point to a local copy because the volume mount point is inaccessible from the host. Copy file storage first with
`docker compose run --rm --no-deps -T --entrypoint tar carraway -cf - -C /daten/speicher . | tar -x -C <Verzeichnis>`. If an override file publishes the database port, pass it to `wiederherstellung.sh` as well. Otherwise `up -d` recreates the database service without the published port and keeps the data.
