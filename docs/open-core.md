# Open core: core and extensions

Carraway consists of a **core** under the GNU Affero General Public License 3.0 (`LICENSE`) and **extensions** under a proprietary licence
(`ee/LICENSE`). The source repository produces two builds.

- **Core** includes everything outside `ee/` and builds, tests and runs without that directory. This is the build for self-hosting.
- **Full** includes the core and every extension, available only through Rehlytics managed hosting. See [Entry points and images](#entry-points-and-images).

The core never imports from `ee/`. Extensions register through **extension points** provided by the core.

## Features in the core and extensions

| Core | Extension (`ee/`) |
|---|---|
| Dealflow, contacts, records and documents | Excel add-in: personal value keys, manifest, values API and reviewed imports (`/excel`, `/values`, `/value-keys`), Excel tab in settings |
| Capital and journal, subscriptions, closings and investor commitment changes | LP portal: investor access (`/portal`), investor users (`/investors`) and access management for fund investors (`…/investor-access/access`) |
| Valuations and metrics, link-based metric requests | ESG and SFDR: questionnaires, PAI indicators, Article 6/8/9 classification and PAI statement report type |
| Reports with approval, PDF and Excel export | Single sign-on with Microsoft Entra ID or Google |
| HTTP API with webhooks and live updates, import and full export | AI features: document extraction, contact enrichment from signatures and websites, and future AI features |
| Two-factor authentication, roles and groups, audit log | [MCP server](mcp.md) with read tools for AI clients at `/api/v1/mcp` |
| Mailbox and calendar integration, local non-AI text recognition (OCR), operations | |

## Repository layout

| Directory | Package | Contents |
|---|---|---|
| `apps/api` | `@carraway/api` | Core API. Core entry points `src/server.ts` and `src/worker.ts`. |
| `apps/web` | `@carraway/web` | Core web app. Core entry point `src/main.tsx`. |
| `ee/api` | `@carraway/ee-api` | API extensions. Full entry points `src/server.ts` and `src/worker.ts`. |
| `ee/web` | `@carraway/ee-web` | Web app extensions. Full entry point `src/main.tsx` (same `index.html` and public files as `apps/web`). |
| `ee/excel-addin` | `@carraway/excel-addin` | Excel add-in files, built into `ee/web/oeffentlich/excel-addin/`. |

Packages in `ee/` use the core through package names with subpaths, for example `@carraway/api/rechte/tabelle` or `@carraway/web/i18n`.

## Extension points

**API** (`apps/api/src/erweiterung.ts`, type `ApiErweiterung`, passed to `erstelleApp`, `starteServer` and `starteWorker`)

- `routen` adds Hono routes under `/api/v1`, mounted after the core routes.
- `regeln` adds permission table entries for those routes using the building blocks in `rechte/tabelle.ts`. Prefer specifying the area in the row. The application's rules combine core and extension entries.
- `apiAnfrage` in the route context calls the HTTP application internally with authentication, permission checks and access logging.
- `anmeldeanbieter` registers Better Auth providers for single sign-on. `GET /environment` lists them.
- `berichtsarten` adds report types with files, control reports, free-text fields and creation defaults (`berichte/arten.ts`).
- `betrieb` adds operational status under `erweiterungen.<name>`.
- `anhaenge` in the route context imports an attachment from the user's own mailbox as a document, with a size limit, type validation and an action inside the write transaction.
- `postfachMails` runs during mailbox sync after newly arrived mail from known people is saved. Text is available through a callback and isn't stored. Errors leave sync running.
- `warteschlangen`, `worker` and `verteilen` add queues, workers and dispatch steps to the worker (pg-boss).

**Web app** (`apps/web/src/erweiterung.ts`, type `WebErweiterung`, registered with `meldeErweiterungAn`)

- `routen` adds routes at the root or in the fund layout (`/fonds/$fondsId/…`). URL types cover the core only.
- `texte` adds translation namespaces that load with the pages that need them.
- `fondsReiter`, `beteiligungReiter`, `einstellungenReiter` and `verwaltungBereiche` add entries to navigation lists.
- `datensatzErgaenzung` (section on a person or company page), `postfachEinstellungen` (card under Mailbox and calendar), `fondsInvestoren`, `dokumentAktion`, `anhangAktion`, `berichtsarten`, `anmeldung` and `betriebZeilen` add components in predefined places on core pages.
- `einstiege` adds entry points alongside the main application, such as the LP portal at `/portal` with its own router.

The core displays menu items and buttons for registered extensions only.

## Register an extension

1. Add code under `ee/api/src/<name>/` and `ee/web/src/<name>/`. Access the core only through `@carraway/api/…` and `@carraway/web/…`.
2. For the API, create a function returning `ApiErweiterung` with its routes and rules.

   ```ts
   export function beispielErweiterung(): ApiErweiterung {
     return {
       name: "beispiel",
       routen: (k) => new Hono().get("/beispiel", (c) => c.json({ ok: true }, 200)),
       regeln: [regel("GET", "/beispiel", "betrachter", [], { bereich: "allgemein" })],
     };
   }
   ```

   Add it to `vollErweiterungen` (`ee/api/src/index.ts`). Extend the client type for the web app in `ee/api/src/typ.ts`.
3. For the web app, add a `WebErweiterung` object in `ee/web/src/erweiterungen.tsx`. Lazy-load components (`traege`) to keep the startup bundle small.
4. Put tests in `ee/api/src/__tests__/` (helpers from `hilfen-voll.ts` build the full application) and beside the components under `ee/web/src/`.

## Entry points and images

| | Core | Full |
|---|---|---|
| API | `apps/api/src/server.ts` | `ee/api/src/server.ts` |
| Worker | `apps/api/src/worker.ts` | `ee/api/src/worker.ts` |
| Web app | `apps/web` (`pnpm --filter @carraway/web build`) | `ee/web` (`pnpm --filter @carraway/ee-web build`) |
| Image | `docker build --build-arg VARIANTE=kern .` | `docker build --build-arg VARIANTE=voll .` (private repository only) |

The public Compose stack pulls the release's core image. A local source build additionally uses `deploy/docker-compose.build.yml`. **The full build is exclusive to Rehlytics managed hosting.**
It is built from the private repository and distributed only through a private registry.

- The public repository excludes `ee/`. Building with `VARIANTE=voll` fails in the `Dockerfile`, and the `dev:voll` scripts cannot find the required packages.
- The core entry points (`starteServer()`, `starteWorker()`, `apps/web/src/main.tsx`) pass no extensions. Environment variables and dynamic imports cannot load them at runtime. Core bundles contain no `ee/` code and the import rule enforces this.

## Database schema

Tables used only by extensions (`werte_schluessel`, `excel_uebernahme`, `investor_benutzer`, `investor_zugang`, `auslesung`, `fonds_offenlegung` and ESG data points stored as metrics) remain in the shared `packages/db` schema. Migrations remain a single linear sequence, while the code is separate.

Separate migration sequences would need a second journal, a fixed order between sequences and cross-schema references. Investor access depends on users and organisations, and extractions depend on documents. Moving between core and full would then need a migration instead of a different image. Tables stay empty in core unless an extension populates them. Where the core reads them, it follows the shared schema rules. It recognises investor users and denies them internal routes (403 `portal_only`). A value key (`cww_`) cannot open any route outside `/values/`.

## Checks

- **Import rule** (`eslint.config.mjs`). Any import from `ee/` in `apps/`, `packages/` or `scripts/` is an error, including package imports (`@carraway/ee-*`, `@carraway/excel-addin`), relative paths and dynamic imports (`import(…)`). `scripts/ci/importregel.mjs` verifies the rule with deliberate violations.
- **Core-only** (CI job `kern-allein`). `scripts/ci/kern-kopie.sh` makes and installs a copy without `ee/`. It runs lint, type checks, builds, the web bundle budget and web app tests, and selected API tests. The corresponding local commands are:

  ```sh
  bash scripts/ci/kern-kopie.sh /tmp/kern-kopie
  cd /tmp/kern-kopie && pnpm typecheck && pnpm build && pnpm --filter @carraway/web test
  ```

- **Full.** Regular CI includes type checks, builds, the bundle budget (`node scripts/ci/bundle-budget.mjs --voll`) and `ee/` tests.
- Both builds test the full permission table in `apps/api/src/__tests__/rechte.test.ts` (core) and `ee/api/src/__tests__/rechte-voll.test.ts` (full).

## Public repository

Each release publishes the core as **one snapshot commit** (“Release vX.Y.Z”) in a public repository, without history or `ee/`. The full hosting image is still built only from the private repository.

- **The allowlist controls exports** (`scripts/oss/erlaubt.txt`). Hard exclusions (`scripts/oss/ausgeschlossen.txt`) cover `ee/`, internal plans and working documents, tools for customer data and private CI. New files stay private until listed.
- **Harmless references to `ee/` stay in the core.** These include `ee/*` in `pnpm-workspace.yaml`, the import rule in `eslint.config.mjs`, the `VARIANTE` switch in the `Dockerfile` (a public build with `voll` fails with an explicit error), and this page. They describe the managed hosting build. The export omits `dev:voll` and extension-only pages such as `docs/excel.md` and the internal AI extraction guide.
- **Lockfile.** `pnpm-lock.yaml` is exported unchanged. `pnpm install --frozen-lockfile` succeeds without `ee/` because pnpm skips missing workspace entries and core needs no other version. The export rehearsal and the core-only CI job verify this.
- **Shared export and CI selection.** `scripts/ci/kern-kopie.sh` (core-only CI job) selects the same files as the export (`node scripts/oss/export.ts --kopie <directory>`). It checks the exact file set that would be published.
- `docs/releases.md` in the private repository describes the release procedure, export checks and how to bring back contributions from the public repository.
