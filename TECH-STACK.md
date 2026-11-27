# Carraway technical stack

Status as of 20 November 2026. The proposed stack was accepted on that date.

The stack prioritises performance, ease of operation and development, and components that can be used reliably with existing experience.

## Summary

| Layer | Choice | Familiarity | Rationale |
|---|---|---|---|
| Language | Strict TypeScript for frontend and backend | Familiar | One type system from the database to the table UI. |
| Frontend | React 19 single-page app with Vite, TanStack Router, Query, Table and Virtual | React, Query, Table and Virtual familiar. Vite and Router new. | Users navigate the authenticated application from the cache without a server round trip. |
| Backend | Standalone REST API using Hono on Node 24, with OpenAPI | Node familiar, Hono new | The API is a product surface in its own right. |
| Database | PostgreSQL 18, SQL-first Drizzle ORM | Drizzle and Postgres familiar, version 18 new (previously 16) | As-of queries with date ranges and temporal keys. |
| Calculation engine | Standalone `rechenkern` package, pure functions and decimal arithmetic | New | Interest, IRR and waterfalls are testable and can later move to Rust/WASM. |
| Background jobs | pg-boss (Postgres queue) | Familiar | Metric snapshots, interest runs and reports run outside page requests. |
| Authentication | Better Auth (passwords, TOTP, OIDC for Entra ID and Google) | Familiar | Supports two-factor authentication and organisational sign-in. |
| Reports | PDF with a Typst prototype and Gotenberg fallback. Excel with exceljs. | Typst new, Gotenberg and exceljs familiar | Typst could render PDFs substantially faster than a headless browser. Measure it. |
| Components | Carraway design system (`cw-…`), React components with CSS from tokens | New implementation, familiar patterns | One source for colours, layout and components. |
| Operations | Docker, Coolify, servers in Germany and CI with runner selection | Familiar | Uses existing infrastructure. |

The separate frontend is the largest change from the established Next.js approach. The backend uses TypeScript. The calculation engine has an interface that can support a later Rust implementation if measurements warrant it.

## Requirements that shape the stack

Typical requirements for investment firms include the following.

- **Two time axes.** Separate business validity from recording time, support as-of reads and writes, and query changes since a timestamp.
- **Complete API.** Read and write, transact across related objects, import idempotently with a business key, collect validation errors with field names, and return 404 instead of 401 for a wrong path.
- **Server-side rules.** Enforce the four-eyes principle, period locks and audit logs in the database as well as the interface. Security tests call the API directly.
- **Access.** Two-factor authentication for API users, technical users separate from people, API keys with permissions and expiry, stored only as hashes.
- **Money.** Decimal arithmetic, interest conventions stored as data and explicit currency views for amounts.
- **Data ownership.** Allow deployments to retain control of their data and provide a full export with calculation rules.

## Performance characteristics

Typical datasets are modest: one to five funds, a few hundred investments and tens of thousands of payments. Calculations over them are inexpensive on a modern CPU in any of the languages considered. The main sources of latency are elsewhere.

1. **Calculating on reads.** Live views recalculate all periods on each page load and prefetch. In a comparable application, queries exceeding 10 seconds recalculated everything on each request and the planner repeated partial results thousands of times. Changing the queries and storing results brought them below a second.
2. **Round trips.** Every click waits for server rendering and revalidation. Server actions also need rules to bring toggles and forms back to the correct state.
3. **Large browser tables** without virtualisation.
4. **Report generation** through a headless browser, taking seconds per PDF.

Optimise the data model and queries first, then the web architecture, then the backend language.

## Performance rules

1. **Pages read, jobs calculate.** Save metrics, valuations and fund values as snapshots by as-of date, with links to inputs for calculation provenance. Recalculate in the background after changes. Page reads cannot trigger the expensive path. If a snapshot is stale, the UI says so and offers “Recalculate”.
2. **Budgets as tests.** Use a reference dataset with 5 funds, 500 investments, 100,000 payments and 10 years of data. Target API response p95 below 100 ms, cached navigation below 50 ms, fund recalculation below 1 s and quarterly report PDF below 2 s. A CI job checks core queries against the dataset and fails when budgets are exceeded.
3. **Query visibility.** Enable `pg_stat_statements`, set `statement_timeout` per request, include `Server-Timing` on every API response and keep `EXPLAIN` for core queries in the repository.
4. **Cache-first web app.** Prefetch on link hover, apply optimistic updates, virtualise tables, split routes into bundles and avoid a CSS-in-JS runtime.
5. **Short network paths.** Place API and database in the same German data centre. Use pooling, Brotli compression and HTTP/2.

## Design rationale

### Single-page app

Earlier applications use Next.js. Carraway's separate frontend fits this application for several reasons.

- The app sits behind sign-in and needs no server rendering for search engines.
- Selected funds, as-of dates and filters stay in the client cache. Navigation between the portfolio and an investment can use the cache.
- External reads and writes, bulk import, full export and change queries all need the API. Using that same API for the web app exercises it and keeps it complete.
- Static files plus an API container simplify self-hosting.

The app retains React, TanStack Table, Query and Virtual, Zod, Vitest, Playwright and the existing component pattern.

### Hono on Node

Hono is small and fast, runs on Node, Bun and Deno and generates OpenAPI from Zod schemas. Node 24 works with existing CI, projects and Docker tooling. Bun could start faster, but has yet to be run in these deployments. Hono supports switching later.

### PostgreSQL 18 and the data model

- **As-of dates and history.** Values have validity ranges (`daterange`). PostgreSQL 18 can enforce non-overlapping keys (`WITHOUT OVERLAPS`) and temporal foreign keys (`PERIOD`). Local and earlier deployments used version 16, and the application scaffold includes the upgrade. Every change also records its entry time so a report can be reproduced for any as-of date using what was known at the time.
- **Append-only postings.** Correct payments, interest and valuations by reversing and recording them again.
- **Amounts** use `numeric` without floating point.
- **Tenancy proposal.** Use a separate database per installation. This simplifies explanation, backups and handing over data, and fits self-hosting. Within each database, roles govern access by fund.
- **SQL-first Drizzle.** Define schemas in TypeScript and views, policies and constraints in SQL migrations.

### Standalone calculation engine

Day-count conventions (30/360, act/360, act/365, act/act), interest runs with deferrals and caps, conversions with interest cut-offs, IRR, TVPI, DPI and exit waterfalls all use pure functions without database access. They use decimal arithmetic and tests based on independently worked reference examples. Each function returns its calculation steps with the result so the UI can explain its provenance.

The package is a candidate for Rust later, keeping the same interface and tests. It could use WebAssembly, including in the browser for what-if calculations, or a Node module.

### Reports

- **Typst**, a free typesetting system written in Rust, produces PDFs deterministically from templates and data without a browser and works well with version control. A quarterly report prototype measures how much faster it is than HTML-to-PDF.
- **Gotenberg** (HTML-to-PDF) is the familiar fallback.
- **Excel** uses exceljs for exports and import templates.
- Drafts are watermarked, approvals run in stages and approved reports are stored immutably.

## Rust backend evaluation

| Criterion | TypeScript (Hono, Node) | Rust (Axum, SQLx) |
|---|---|---|
| Compute and memory | Good and ample for these datasets | Very good, lowest memory usage |
| Real-world response time | Dominated by the database and network | Dominated by the database and network, with a difference of a few milliseconds |
| Development speed for one developer with AI assistance | High, with familiar patterns from three repositories | Noticeably slower due to longer compile and correction cycles |
| Building blocks | Better Auth, Drizzle, exceljs and Zod are available and proven | Assemble 2FA and OIDC authentication from components. Excel and PDF are available, ORM support is weaker. |
| Types through the frontend | Shared directly | Through an OpenAPI generator |
| Monetary correctness | Requires a decimal library and discipline | `rust_decimal` and stronger type-system support |
| Operations | Container with Node runtime, substantially larger | Single executable, very small container (sizes to be measured) |
| CI minutes | Minutes | Compilation is more expensive and needs caching |
| Open-source contribution | Larger contributor pool | Smaller contributor pool |

Rust would measurably reduce server resource use but users would see little improvement because most time is spent in the database, network and web app. A Rust backend would also delay the core demo and require reworking established authentication, migration and CI components. The performance gains here come from the data model (snapshots, as-of dates, indexes) and the interface (cache, prefetch, virtualisation).

**Consider Rust where computation matters**, in the calculation engine for scenarios, waterfalls across many share classes or simulations. Revisit the choice if the reference dataset exceeds the recalculation budget of less than 1 s per fund.

## Open questions at the time of the proposal

1. Typst versus Gotenberg. Prototype with a real report layout.
2. One database per installation (proposed) or one schema per installation. Finalise with the hosting model.
3. AGPL or FSL licensing affects dependency selection. Check compatibility for every library.
4. AI features use only EU providers and can be disabled per installation. Define the architecture with the first AI feature.
