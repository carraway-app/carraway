# Import from source systems

Carraway can take over funds, portfolio data, transactions, metrics and valuations from an existing portfolio management system through that system's API. The import runs through the regular [import pipeline](abnahme/Leitfaden.en.md): a dry run writes nothing, findings and the acceptance log show what will happen, and a second person applies the run.

The core contains the pipeline, the intermediate model, the dry run and the acceptance log. Adapters for specific source systems are extensions and register through the `vorsysteme` extension point (see [Open core](open-core.md)). Without a registered adapter, `GET /api/v1/import/sources` returns an empty list.

## How a run works

1. **Read.** The adapter reads the selected funds of the source system, one fund at a time: holdings with their companies and contacts, transactions, valuations, financing rounds with all participants, metrics and the source's own totals. It follows pagination cursors, including nested lists, retries transient failures with exponential backoff, honours rate limits and `Retry-After`, and stops on repeated cursors.
2. **Merge.** The reads of all funds are merged into one inventory. A company that several funds hold (cross-investment) becomes one organization with one holding per fund. If the source keeps the same company under two IDs, the later ID points to the earlier one when the website domain or the name without legal form matches. Contacts with the same email address merge as well. Each merge appears as a warning (`source_records_merged`).
3. **Map.** The inventory is mapped to the sheets of the import template. Every business key is `<adapter>:<source ID>`. Keys are stored in `import_zuordnung` with the run, so a repeated run finds what it created earlier and creates nothing twice.
4. **Dry run.** The mapped workbook becomes a normal import run (`dateiname` `<adapter>-<date>.xlsx`), which is validated immediately. The workbook is the frozen snapshot of the source; applying the run never reads the source again.
5. **Apply.** `POST /api/v1/import/runs/{id}/apply`, with the same rules as a file import.

## Transactions and the ledger

Transactions are never changed after they are applied. The import creates new transactions with their source key; the run and the source IDs are their provenance.

- **Repeated events** of the configured types (default: interest and interest payments) are merged per holding, instrument, type and period (default: quarter), even when a period holds a single event. The merged transaction is dated on the last event of the period, and its remark lists the merged source IDs. Its key derives from holding, instrument, type and period, not from the individual events. If the source later reports an additional event in a period that has already been imported, the dry run reports `transaction_differs` instead of booking a second time; correct it with a reversal. Set the merge rule before the first application: changing types or period afterwards produces different keys.
- **Rounds** of a transaction (`runde_schluessel`) are assigned explicitly when the source provides them. Otherwise the round of the instrument applies.
- **Conversions** are not booked automatically. Each one appears as a warning (`source_conversion_not_imported`) and must be recorded through the conversion of the holding.

## Metrics and valuations

Source metrics are mapped to catalog keys in the connection settings (`metrics`, for example `{ "Revenue": "umsatz" }`). Unmapped metrics appear as a warning (`source_metric_unmapped`) and are not imported; catalog entries are never created automatically. A metric of a company becomes one value per holding of that company, with period and scenario. Period and value are checked like manual entry. The values are imported as confirmed values with source `import`; the business key is stored as the source reference. A confirmed value of the same series without this key is kept, and the row is skipped with a warning.

Valuations keep their valuation date and method and are approved on application, as in the file import.

## Reconciliation in the acceptance log

The control totals compare the source with the database after the import:

- **Per fund:** commitments, disbursements and distributions.
- **Per holding:** commitments, disbursements and distributions across all instruments of the holding (column `beteiligung_schluessel` on the control totals sheet).

The adapter supplies the source's own totals where the API offers them. Missing totals are computed from the individual source events before merging, so the log also shows that merging and mapping lost no amount. Deviations appear as `control_total_differs`.

## Connection, credentials and permissions

Only global administrators see and configure source systems (**Administration → Import from source system** in the full edition, shown only when an adapter is registered). Saving a connection and starting a dry run require a signed-in person; API keys cannot do either.

| Route | Purpose |
|---|---|
| `GET /api/v1/import/sources` | Registered adapters with their connection, without credentials |
| `PUT /api/v1/import/sources/{source}` | Save the connection: `credential` (optional) and `settings` |
| `POST /api/v1/import/sources/{source}/runs` | Dry run; returns the import run |

Settings: `origin` (API address), `funds` (source fund IDs, empty for all), `fundShortNames` (short name per source fund, for example to reach an existing fund), `organizations` (source company ID to an existing organization ID, or `new`), `keepSeparate` (source company IDs that are never merged), `metrics` and `merge` (`types` and `period`: `month`, `quarter` or `year`).

- **Credentials** are either stored encrypted with the installation key (bound to the connection, as for CRM connections) or read from an environment variable the adapter declares. They never appear in responses, findings, audit entries or logs.
- **Origin.** Each adapter declares its default origin and the hosts a connection may choose (exact host names or `*.domain`). Only `https` origins without path, port or user information are accepted. A credential from the environment is only ever sent to the default origin. Changing the origin requires a new credential in the same request.
- **Network.** Requests use the checked outbound fetch: no private or local addresses, no redirects, a time limit and a size limit per response, and only the paths the adapter allows.
- **Four eyes.** The connection records everyone who saved it since its credential or origin was last set. None of them, and neither the person who started nor the person who validated the dry run, may apply the run. If the connection changes after the dry run, applying is blocked (`import_source_changed`) until a new dry run exists. Runs or connections without this record are rejected the same way.

Metric values also require the **Metrics** area, in addition to the areas of the regular import.

## Limits

- Totals computed from source events cover the source only. If a mapped fund already holds other transactions in Carraway, its fund-level totals differ and must be reviewed.

- The dry run reads the source within the request. Very large inventories should be imported fund by fund (`funds`).
- An import run holds at most 20 MB of mapped data and the row limits of the import template.
