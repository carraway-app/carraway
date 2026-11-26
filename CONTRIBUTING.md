# Contributing to Carraway

Bug reports, documentation fixes, and code contributions are welcome. For larger changes, open an issue first to discuss the problem and the proposed approach. Report security vulnerabilities privately using the [security policy](SECURITY.md).

## Local development

Use Node.js 24 or later, the pnpm version pinned in `package.json` (currently 11.13.0), and a local PostgreSQL instance. PostgreSQL 18 is used in CI and the Docker Compose stack.

Fork and clone the repository, then create a branch from `main`. From the repository root, install dependencies and prepare separate, disposable development and test databases.

```sh
pnpm install --frozen-lockfile

export DATABASE_URL_SUPERUSER=postgres://postgres@localhost:5432/postgres
export DATABASE_URL=postgres://carraway:carraway@localhost:5432/carraway_dev
export DATABASE_URL_TEST=postgres://carraway:carraway@localhost:5432/carraway_test
pnpm db:setup
```

Set `DATABASE_URL_SUPERUSER` to the connection URL for your local PostgreSQL administrator. The setup command creates the local `carraway` role if needed and migrates both databases. The database names must begin with `carraway_`, and the test database name must contain `test`.

Run `pnpm dev` and open [http://localhost:5173](http://localhost:5173). The development API listens on port 8787. To start with an empty database, create the first administrator at `/einrichtung`. To work with fictional data, run `CARRAWAY_UMGEBUNG=demo DEMO_SPRACHE=en pnpm db:seed` before starting the app and start it with `CARRAWAY_UMGEBUNG=demo pnpm dev`. The seed empties the development database and writes credentials for the fictional accounts to [`packages/db/demo-zugaenge.md`](packages/db/demo-zugaenge.md). Keep the demo instance local. Run `pnpm --filter @carraway/api worker` in a second terminal with the same database and environment settings when working on background jobs.

## Checks and tests

Run these checks from the repository root.

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm migrationen:pruefen
```

Use a focused Vitest run while developing. The following command runs the deal flow tests.

```sh
pnpm --filter @carraway/web exec vitest run src/seiten/Dealflow.test.tsx
```

Database-backed tests clear tables in `DATABASE_URL_TEST`. To recreate and migrate the disposable test database, run `pnpm --filter @carraway/db setup:test`. Run `pnpm test` for the full suite. The public CI runs lint, type checks, a build, migration checks, and tests.

## Commits and pull requests

- Keep commits focused and use clear, descriptive commit messages. Open a pull request against `main` and link the relevant issue.
- Explain the problem, what changed, and how you verified it. Include screenshots for visible changes when they help reviewers.
- Cover new behavior and bug fixes with tests. Update both English and German translations for user-facing changes.
- Use fictional data in examples, fixtures, and screenshots. Keep credentials and personal data out of contributions.
- Keep discussions respectful and focused on the work.

## Licensing and acceptance

Contributions to the core are published under [AGPL-3.0](LICENSE). Rehlytics will put a Contributor License Agreement (CLA) in place before accepting external contributions. Once the CLA is in place, contributors will be asked to sign it before their changes can be accepted.

Each release publishes a snapshot of the core. Accepted changes are incorporated into the source repository with attribution, then appear in a public release. The public pull request is closed with a note explaining where the change landed.
