# API glossary and conventions

Carraway's public HTTP API uses English for paths, parameters, request and response fields, enum values, error codes and messages, and the documentation at `/api/v1/docs` and `/api/v1/openapi.json`. The MCP server follows the same conventions for tool names, descriptions and parameters. The interface supports German and English and translates errors by code.

During the migration (#182 and #184 through #189), each area used and extended this glossary and removed its own entries from the identifier check's exception list. The tables retain the legacy spellings for reference.

## Conventions

| Topic | Rule | Example |
|---|---|---|
| Paths | `kebab-case`, plural resource names, IDs as path parameters | `/capital-calls/{id}`, `/funds/{fundId}/reporting-runs` |
| Actions | Subpath with a verb (POST) for operations beyond create, update or delete | `POST /funds/{id}/close`, `POST /vouchers/{id}/reverse` |
| Fields and parameters | `camelCase`, ID suffix `Id` or `Ids` | `fundId`, `asOf`, `changedSince`, `investmentIds` |
| Booleans | Adjective or participle without the `is` prefix | `active`, `confidential`, `archived` |
| Date | ISO 8601 `YYYY-MM-DD`, timestamps with timezone `YYYY-MM-DDTHH:mm:ss.sssZ` | `"asOf": "2026-06-30"` |
| Amounts | Decimal strings with a decimal point and at most two fractional digits, with a separate ISO 4217 currency field | `"amount": "1250000.00", "currency": "EUR"` |
| Ratios and rates | Decimal strings as proportions (0.25 = 25%) | `"rate": "0.06"` |
| Enum values | English `snake_case` | `"status": "in_review"`, `"type": "capital_call"` |
| Lists | `{ data, nextCursor }` with `limit` and `cursor` | `GET /funds?limit=50&cursor=…` |
| Errors | `{ error: { code, message, fields? } }`, English `code` in `snake_case` and an English `message` | See below |

Treat abbreviations as words, as in `navValue`, `apiKey` and `paiIndicators` (`NAVValue` is incorrect). Use established fund terminology such as `capital call` and `commitment` in place of literal translations such as `call of capital` and `promise`.

## Error format

```json
{
  "error": {
    "code": "invalid_input",
    "message": "The input is invalid.",
    "fields": [{ "field": "amount", "code": "invalid_format", "message": "Expected an amount with at most two decimal places" }]
  }
}
```

- `code` is stable and machine-readable (`fund_not_found`, `period_locked`, `four_eyes_violated`). The UI translates it (`apps/web/src/i18n/fehler*.ts`). Add a German and an English string for each new code (test `codes.test.ts`).
- `message` is in English for developers. It can contain values and can change independently of the error code.
- `fields` lists field errors. `field` is the field name, with dots for nesting (`terms.rate`). `code` identifies the validation step in English `snake_case` (`too_small`, `reason_required`, `date_out_of_range`).
- Additional data appears beside `code` and `message`, such as the candidates for `possible_duplicate`. During migration, area changes renamed these with the other fields.
- Better Auth (`/auth/*`) uses its own `{ code, message }` format with capitalised codes (`INVALID_TOKEN`). Carraway's own codes there follow the conventions above (`too_many_attempts`).
- Findings (imports, balance runs, regulatory reporting and control reports) are data with English, machine-readable codes. Import findings and reporting definition issues supply English text as `message` and German text as `messageDe`.

## Fields and database

Database columns keep their German names. The API migration made no schema migrations for naming. If a route returns rows as-is, Drizzle properties use English names and may differ from the column names (`asOf: date("stichtag")`). Routes that build their own responses map the names at the API boundary. Database enum values are mapped at the API boundary until a migration changes them.

## English identifier check

The core test `apps/api/src/__tests__/openapi-englisch.test.ts` and full test `ee/api/src/__tests__/openapi-englisch.test.ts` look for German identifiers in generated OpenAPI path segments, path and query parameters, and schema properties. Rules in `apps/api/src/openapi-englisch.ts` cover umlauts, German words and stems, endings like `-ung` and transliterations such as `ae` and `oe`. The migration used path prefixes grouped by issue in `AUSNAHMEN_KERN` and `AUSNAHMEN_ERWEITERUNGEN` (`ee/api/src/openapi-englisch.ts`). An unused prefix causes the check to fail, and moving a shared mount point (for example `/fonds` to `/funds`) requires updating any prefixes under it. The exception lists are empty in both builds. Use English conventions from the first commit of any new route.

## Glossary

“Path” gives a path segment and “Field” gives a field or parameter name. Bold entries are mount points in `apps/api/src/app.ts` or in extensions.

### Account, access and settings (#184)

| Concept | Legacy | Path | Field |
|---|---|---|---|
| **Account** | `/konto` | `/account` | `account` |
| **Password** | `/passwort` | `/password` | `password` |
| **Setup** (initial setup) | `/einrichtung` | `/setup` | `setup` |
| **Users** | `/benutzer` | `/users` | `user`, `userId` |
| **Permissions** | `/rechte` | `/permissions` | `permissions` |
| Role (permissions role) | `/rechte/rollen` | `/permissions/roles` | `role`, `roleIds` |
| User group | `/rechte/gruppen` | `/permissions/groups` | `group`, `groupId` |
| Area (application area) | | | `area`, `areas` |
| Fund role: viewer, editor, approver, admin | | | `viewer`, `editor`, `approver`, `admin` |
| Global admin | | | `globalAdmin` |
| **API keys** | `/api-schluessel` | `/api-keys` | `apiKey` |
| Technical user | | | `technicalUser` |
| **Settings** | `/einstellungen` | `/settings` | `settings` |
| **Theme** (light/dark) | `/thema` | `/theme` | `theme` |
| **Operations** (operational status) | `/betrieb` | `/operations` | `operations` |
| **Health** | `/gesundheit` | `/health` | |
| **Environment** | `/umgebung` | `/environment` | `environment` |
| **Me** (current person) | `/ich` | `/me` | |
| **MCP transport** (managed hosting) | | `/mcp` | Tool names use `snake_case`, for example `get_fund_metric`. Calculation steps are in `calculation.steps` with `sign`, `label` and `value`. |
| **Changes** (change query) | `/aenderungen` | `/changes` | `changedSince` |
| Audit log | | `/audit-log` | `auditLog` |
| **Webhooks** (#154) | | `/webhooks` | `webhook`, `webhookId` |
| Webhook delivery | | `…/deliveries` | `delivery`, `deliveryId` |
| Rotate the signing secret | | `…/rotate-secret` | `secret` |
| Test event | | `…/test` | |
| **Live** (live updates, #161) | | `/live` | |
| Subscription (live updates) | | | `subscribe`, `tables` |
| Session | `/konto/sitzungen` | `/account/sessions` | `session` |
| Second factor | `/konto/zwei-faktor` | `/account/two-factor` | `twoFactor` |
| Recovery codes | | `/account/recovery-codes` | `recoveryCodes` |
| **Value keys** (Excel) | `/werte-schluessel` | `/value-keys` | `valueKey` |
| **Values** (Excel) | `/werte` | `/values` | `values` |
| **Excel** | `/excel` | `/excel` | |
| Fund list for values | `/werte/fonds` | `/values/funds` | |
| Value metric catalogue | `/werte/kennzahlen` | `/values/metrics` | `scope`, `key`, `unit` |
| Single value | `/werte/wert` | `/values/value` | |
| Value row | | | `value`, `unit`, `currency` |
| Capital accounts for values | `…/kapitalkonten` | `…/capital-accounts` | |
| Show key, preview | | | `key`, `preview` |
| Expiry, last used, revoked | | | `expiresAt`, `lastUsedAt`, `revokedAt` |
| Key status | `aktiv`, `abgelaufen`, `widerrufen` | | `active`, `expired`, `revoked` |
| Key permission | `lesen`, `schreiben` | | `read`, `write` (`permission`) |
| Overall operational status | `ok`, `warnung`, `fehler` | | `ok`, `warning`, `error` (`status`) |
| Worker status | `ok`, `ausgefallen`, `unbekannt` | | `ok`, `down`, `unknown` |
| Environment `echt` | `echt` | | `production` |
| Theme | `hell`, `dunkel` | | `light`, `dark` |
| Level per area (without a fund, per fund) | `stufeOhneFonds…`, `bereicheJeFonds` | | `levelWithoutFund`, `levelWithoutFundPerArea`, `areaLevelsPerFund` |
| Application areas | `finanzen`, `kennzahlen`, `berichte`, `meldewesen`, `kontakte`, `dokumente`, `daten`, `fondsverwaltung` | | `finance`, `metrics`, `reports`, `regulatory_reporting`, `contacts`, `documents`, `data`, `fund_administration` (`portfolio` and `dealflow` stay the same) |
| Invitation, pending | | | `invitation`, `invitationPending`, `invited` |
| Investor user (portal) | | | `investor` |
| Source of a fund role | `eigene`, `gruppe` | | `own`, `group` |
| Calendar link | `…/kalender-link` | `…/calendar-link` | `calendarLink` |

### Funds, capital, investors and portal (#185)

| Concept | Legacy | Path | Field |
|---|---|---|---|
| **Funds** | `/fonds` | `/funds` | `fund`, `fundId` |
| Short name | | | `shortName` |
| Vintage | | | `vintage` |
| Fund size / subscribed capital | | | `fundSize` / `subscribedCapital` |
| Commitment | | `/commitments` | `commitment` |
| Commitment change | `…/zusageaenderungen` | `…/commitment-changes` | |
| Subscription | `…/zeichnungen` | `…/subscriptions` | `subscription` |
| Closing | `…/closings` | `…/closings` | `closing` |
| Withdrawal (LP) | `…/austritte` | `…/withdrawals` | `withdrawal` |
| Capital call | | `/capital-calls` | `capitalCall` |
| Distribution | | `/distributions` | `distribution` |
| Fund movement, capital movement | `/fondsbewegungen`, `…/bewegungen` | `/fund-movements`, `…/movements` | `movement`, `movementId` |
| Payment | `…/zahlungen` | `…/payments` | `payment`, `paymentId` |
| Due date | | | `dueDate` |
| Value date | | | `valueDate` |
| Capital account | `…/kapitalkonten` | `…/capital-accounts` | `capitalAccount` |
| Management fee, fund expenses (expense posting) | `…/kosten` | `…/fees-and-expenses` | `managementFee`, `fundExpenses`, `allocation`, `rate` |
| Investor net IRR | | | `netIrr` |
| Journal | `…/journal` | `…/journal` | |
| NAV, components | `…/nav-einzelwerte` | `…/nav-components` | `nav` |
| Fund overview | `…/uebersicht` | `…/overview` | |
| Period lock | `…/periodensperre` | `…/period-lock` | `lockedUntil` |
| **Investors** (investor users) | `/investoren` | `/investors` | `investor`, `investorId` |
| Investor access | `…/investorenzugaenge` | `…/investor-access` | `investorAccess` |
| Notice (to investors) | `…/mitteilungen` | `…/notices` | `notice` |
| **Portal** (LP portal) | `/portal` | `/portal` | |
| **Vehicles** | `/vehikel` | `/vehicles`, `/organizations/{id}/vehicles` | `vehicle`, `vehicleId`, `inceptionYear` |
| **Tranches** | `/tranchen` | `/tranches` | `tranche`, `trancheId` |
| **Interest runs** | `/zinslaeufe` | `/interest-runs` | `interestRun` |
| Interest period | | | `interestPeriod` |
| Accruals (interest) | `…/abgrenzung` | `…/accruals` | `accrual` |
| **Receivables** | `/forderungen` | `/receivables` | `receivable` |
| **Exchange rates** | `/wechselkurse` | `/exchange-rates` | `exchangeRate`, `rate` |
| Currency, currency view | `…/waehrung`, `…/waehrungssicht` | `…/currency`, `…/currency-view` | `currency`, `reportingCurrency` |
| **Scenarios** | `/szenarien` | `/scenarios` | `scenario`, `scenarioId` |
| Assumption | | | `assumptions` |
| Reserve | `…/reserve`, `…/reserven` | `…/reserve`, `…/reserves` | `reserve` |
| Lock | `…/festschreiben` | `…/lock` | `locked` |
| Target fund (fund of funds), target fund holding | `…/target-funds` (new, already in English) | `…/target-funds` | `targetFundId`, `targetFundName`. Hidden positions appear together with `id: null` and their holding value under `metrics.value.value`. NAV components list the holdings under `targetFunds`. |
| Target fund movement: commitment, capital call, distribution | `…/movements` (new, already in English) | `…/movements` | `type` (`commitment`, `capital_call`, `distribution`), `valueDate`, `amount`, `reversesId` |
| Target fund report (NAV, share) | `…/nav-reports` (new, already in English) | `…/nav-reports` | `asOf`, `nav`, `share` |
| Target fund valuation basis | | | `method` (`look_through`, `reported_nav`, `cost`), `called`, `unfunded`, `distributed` |
| **Manager profile**, home currency | `/manager-profile` (new, already in English) | `/manager-profile` | `homeCurrency`, `managerName` |
| **Portfolio dashboard**, allocation, history | `/portfolio/dashboard` (new, already in English) | `/portfolio/dashboard` | `allocation`, `history`, `totals`, `internalHoldings`, `eliminated`, `fairValue`, `invested`, `paidIn` |
| Fund portal access | `…/investorenzugaenge/zugaenge` | `/funds/{fundId}/investor-access/access` | `organizations`, `organizationId`, `userId` |
| Portal profile, accounts, reports and notices | `…/ich`, `…/kapitalkonto`, `…/berichte`, `…/dokumente` | `/portal/me`, `/portal/funds/{id}/capital-accounts`, `/portal/funds/{id}/reports`, `/portal/documents` | `accounts`, `history`, `previousVersion`, `nextVersion` |
| Reversal and correction of a closing | `…/storno`, `…/korrektur` | `…/reverse`, `…/correct` | `effectiveDate`, `equalizationAmount`, `newCommitment` |
| Subscriptions, commitment changes, withdrawal | | `…/investor-access/subscriptions`, `…/investor-access/commitment-changes` | `subscriptions`, `commitments`, `type` (`closing`, `decrease`, `withdrawal`) |
| Recalculation, capital position and provenance | `…/neuberechnen`, `…/kapitalstand`, `…/herkunft` | `…/recalculate`, `…/movements/capital-position`, `…/movements/sources` | `sourceKnowledgeDate`, `supportingDocuments` |
| Cost allocation | | | `allocation` (`by_basis`, `manual`), `allocationBasis` (`commitment`, `share`), `allocations` |
| Journal filters | | `…/journal` | `from`, `to`, `entryType` (comma-separated), `direction` (`asc`, `desc`), `valuations` |
| Settle receivable | `…/erfuellt` | `/receivables/{id}/settle` | `date`, `receivable` |
| Exchange rate file and missing rate | | `/exchange-rates/import` | `exchangeRate`, `format` (`ecb`, `long`), `reason` (`missing_rate`, `stale_rate`) |
| Scenario template, comparison and report | `…/vorlage`, `…/vergleich`, `…/bericht` | `…/scenarios/template`, `…/scenarios/comparison`, `…/scenarios/report` | `baseDate`, `findings`, `status` (`draft`, `locked`) |

### Accounting (#186)

| Concept | Legacy | Path | Field |
|---|---|---|---|
| Accounting | `…/buchhaltung` | `…/accounting` | `accounting` |
| **Vouchers** | `/belege` | `/vouchers` | `voucher`, `voucherId` |
| Voucher type | `…/belegarten` | `…/voucher-types` | `voucherType` |
| Voucher template | `…/belegvorlagen` | `…/voucher-templates` | |
| Approval stage | `…/freigabestufen` | `…/approval-stages` | `stage` |
| Posting, post | `…/buchungen`, `…/buchen` | `…/postings`, `…/post` | `posting`, `postedAt` |
| Posting text | | | `postingText` |
| Posting rule | `…/buchungsregeln` | `…/posting-rules` | `postingRule` |
| **Posting exports** | `/buchungsexporte` | `/posting-exports` | `postingExport` |
| General ledger account, account | `…/konten` | `…/accounts` | `account`, `accountNumber` |
| Contra account | | | `contraAccount` |
| **Account rules** | `/kontenregeln` | `/account-rules` | `accountRule` |
| Layout | `…/gliederung` | `…/layout` | `layoutItem` |
| Funding source | `…/mittelarten` | `…/funding-sources` | `fundingSource` |
| **Balance runs** | `/saldenlaeufe` | `/balance-runs` | `balanceRun` |
| Trial balance | | | `trialBalance` |
| Reconciliation | `…/abstimmung` | `…/reconciliation` | |
| Evaluation | `…/auswertung` | `…/evaluation` | |
| Period | `…/perioden` | `…/periods` | `period`, `periodStart`, `periodEnd` |
| **Transactions** | `/vorgaenge` | `/transactions` | `transaction`, `transactionId` |
| Reversal, reverse | `…/storno` | `…/reverse` | `reversal`, `reversedAt` |
| **Batch** | `/stapel` | `/batch` | `operations` |
| Investment accounting keys | `…/buchhaltungsschluessel` | `…/accounting-keys` | `projectNumber`, `contractNumber`, `partnerNumber`, `companyCode` |
| Voucher reference | | | `referenceType`, `referenceId` |
| Custom voucher type, base type | | | `customTypeId`, `baseType` |
| Field values, refill | `…/feldwerte`, `…/neu-befuellen` | `…/field-values`, `…/refill` | `values`, custom keys with `custom_` |
| Voucher review and approval | `…/stufe` | `…/stage` | `stage` (`review`, `approval`), `result` (`ok`, `returned`) |
| Payout tranche | | | `trancheId` |
| Voucher or export filename, uploaded trial balance filename | | | `fileName`, `sourceFileName` |
| Account range | | | `accountFrom`, `accountTo`, `itemKey` |
| Debit and credit | | | `debit`, `credit` |
| Balance sheet, income statement, liquidity, use of funds | | `…/evaluation/{view}` | `balance_sheet`, `income_statement`, `liquidity`, `use_of_funds` |
| Upload, validate and apply a trial balance | | `…/balance-runs`, `…/validate`, `…/apply` | `file`, `periodFrom`, `periodTo` |
| Create and preview a posting export | | `…/posting-exports`, `…/posting-exports/preview` | `interestRunId`, `transactionIds`, `fundMovementIds`, `repeat` |
| Operation in a batch | | | `method`, `path`, `body`, response under `results` |

### Investments, rounds, valuations and metrics (#187)

| Concept | Legacy | Path | Field |
|---|---|---|---|
| **Investments** | `/beteiligungen` | `/investments` | `investment`, `investmentId` |
| Initial investment, follow-on investment | | | `initialInvestment`, `followOnInvestment` |
| **Instruments** | `/instrumente` | `/instruments` | `instrument`, `instrumentId` |
| Convertible loan | | | `convertible_loan` (Enum) |
| SAFE | | | `safe` (Enum) |
| Warrant, exercise price, term | | | `warrant` (Enum), `warrantShares`, `exercisePrice`, `issuedOn`, `expiresOn` |
| Exercise (warrants) | `…/exercises` (new, already in English) | `…/exercises` | `exercise`, `shares`, `pricePerShare`, `amount`; reverse with `…/exercises/:exerciseId/reverse` and `reason` |
| Share transfer (secondary), buyer, seller, source | `…/share-transfers` (new, already in English) | `…/share-transfers` | `shareTransfer`, `buyerFundId`, `buyerVehicleId`, `buyerOrganizationId`, `seller`, `buyer`, `source`; reverse with `…/share-transfers/:transferId/reverse` and `reason`, `reversedAt` |
| Terms | `…/konditionen` | `…/terms` | `terms` |
| Conversion | `…/wandlung` | `…/conversion` | `conversion` |
| Sale | `…/verkauf`, **`/verkaeufe`** | `…/sale`, `/sales` | `sale`, `saleId` |
| Disposal of outstanding loan principal | | `…/sale/preview`, `…/sale` | `principalDisposed` (journal entry type `principal_disposal`) |
| Loan waiver, preview, reversal | | `/instruments/{id}/waivers`, `…/waivers/preview`, `…/waivers/{waiverId}/reverse` | `date`, `principal`, `interest`, `reason`, `documentId`, `waiverId`, `remainingPrincipal`, `impairmentUsed`, `remainingCarryingAmount`, `loss`, `steps` (journal entry types `principal_waiver`, `interest_waiver`) |
| Purchase price, purchase price adjustment | `…/kaufpreisanpassung` | `…/purchase-price-adjustment` | `purchasePrice` |
| Insolvency | `…/insolvenz` | `…/insolvency` | |
| Net income | `…/jahresueberschuss` | `…/net-income` | `netIncome` |
| Cap table | `…/kapitaltabelle` | `…/cap-table` | |
| Waterfall | `…/wasserfall` | `…/waterfall` | |
| **Financing rounds** | `/finanzierungsrunden` | `/financing-rounds` | `round`, `roundId` |
| **Round positions** | `/rundenpositionen` | `/round-positions` | `position`, `positionId` |
| Round transactions | `…/rundentransaktionen` | `…/round-transactions` | |
| Share class | `…/anteilsklassen` | `…/share-classes` | `shareClass` |
| Employee pool, grant | `…/mitarbeiterpools`, `…/zuteilungen` | `…/employee-pools`, `…/grants` | `pool`, `grant` |
| Pre-/post-money | | | `preMoney`, `postMoney` |
| Price per share | | | `pricePerShare` |
| **Valuations** | `/bewertungen` | `/valuations` | `valuation`, `valuationId` |
| **Valuation rounds** | `/bewertungsrunden` | `/valuation-rounds` | `valuationRound` |
| **Metrics** | `/kennzahlen` | `/metrics` | `metric`, `metricKey`, `metricKeys` |
| Metric request | `…/abfragen` | `…/metric-requests` | `metricRequest` |
| Catalogue | `…/katalog` | `…/catalog` | |
| **Milestones** | `/meilensteine` | `/milestones` | `milestone`, `milestoneId` |
| **Register** (commercial register) | `/register` | `/register` | `registerEntry` |
| Board mandate (advisory board, supervisory board, board) | `…/mandate` | `…/board-mandates` | `boardMandate`, `body`, `role`, `startDate`, `endDate` |
| Notice | `…/ereignisse` | `…/events` | `event` |
| Instrument data, interest | `…/instrumentdaten`, `…/zinsen` | `…/instrument-data`, `…/interest` | `interest`, `interestOutstanding` |
| Instrument tranche | `…/tranchen` | `…/tranches` | `tranche`, `scheduledDate` |
| Fulfil tranche conditions | `…/erfuellt` | `…/fulfill` | `fulfilledAt`, `evidence` |
| Close or reopen a financing round | `…/abschliessen`, `…/wiedereroeffnen` | `…/close`, `…/reopen` | `closedAt`, `reopenedAt` |
| Positions, payments, pool top-up | `…/positionen`, `…/zahlungen` | `…/positions`, `…/payments` | `positions`, `paymentId`, `poolTopUp` |
| Approve or discard a valuation | `…/freigeben`, `…/verwerfen` | `…/approve`, `…/discard` | `approvedAt`, `approvedBy` |
| Metric value, selection, overview | `…/werte`, `…/auswahl`, `…/uebersicht` | `…/values`, `…/selection`, `…/overview` | `value`, `valueType`, `frequency` |
| Confirm, revoke, renew or send a metric request | `…/bestaetigen`, `…/widerrufen`, `…/neuer-link`, `…/per-mail` | `…/confirm`, `…/revoke`, `…/renew-link`, `…/send-email` | `confirmedAt`, `revokedAt`, `link` |
| Investment ESG time series and questionnaire | `…/esg`, `…/esg/abfragen` | `…/esg`, `…/esg/metric-requests` | `dataPoints`, `completeness`, `metricRequest` |
| View and apply a fund's ESG metric template | | `GET /funds/{id}/esg/metric-template`, `POST /funds/{id}/esg/metric-template/apply` | `metrics`, `metricKeys`, `catalogStatus`, `sources`, `addedMetricKeys`, `createdMetricKeys` |
| Register entry, monitoring and notifications | `…/eintraege`, `…/beobachtung`, `…/meldungen` | `…/entries`, `…/monitoring`, `…/notifications` | `registerType`, `registerEntryId` |

Instrument types are `direct_equity`, `silent_participation`, `loan`, `convertible_loan`, `venture_debt`, `shareholder_loan`, `safe` and `warrant`.
Instrument statuses are `active`, `converted`, `repaid`, `sold` and `written_off`. Financing rounds distinguish `equity` and `bridge`.
A share transfer source is a cap table row ID (`common`, a round position UUID, `share-transfer:<id>` or `warrant-exercise:<id>`).

Built-in catalogue keys use English, for example `revenue`, `cash_position`, `monthly_cash_burn`, `employee_fte`,
`customer_count` and `esg_ghg_scope1`. Custom metric keys are retained. Keys that collide with a built-in name, and custom keys
starting with `custom_`, receive an extra `custom_` prefix at the API boundary.


### Reports, regulatory reporting, resolutions and documents (#188)

| Concept | Legacy | Path | Field |
|---|---|---|---|
| **Reports** | `/berichte` | `/reports` | `report`, `reportId` |
| Report type | | | `reportType` |
| Report template | `…/berichtsvorlagen` | `…/report-templates` | |
| Section | `…/abschnitte` | `…/sections` | `section` |
| Correction | `…/berichtigung` | `…/correction` | |
| Check (control report) | `…/kontrolle` | `…/checks` | `checks` |
| Stage (approval) | `…/stufe` | `…/stage` | `stage` |
| Committee pack | `…/gremienvorlage` | `…/committee-pack` | |
| **Regulatory reporting definitions** | `/meldedefinitionen` | `/reporting-definitions` | `reportingDefinition` |
| **Regulatory reporting runs** | `/meldelaeufe` | `/reporting-runs` | `reportingRun` |
| Regulatory reporting data | `…/meldedaten` | `…/reporting-data` | |
| **Funding programmes** | `/foerderprogramme` | `/funding-programs` | `fundingProgram` |
| **Resolution templates** | `/beschlussvorlagen` | `/resolution-templates` | |
| Resolution | `…/beschluesse` | `…/resolutions` | `resolution` |
| **Documents** | `/dokumente` | `/documents` | `document`, `documentId` |
| Link, target | `…/verknuepfungen` | `…/links` | `link`, `target` |
| Classification | | | `classification` |
| Confidential | | | `confidential` |
| Text recognition | `…/texterkennung` | `…/ocr` | |
| Retention | `…/aufbewahrung` | `…/retention` | `retention` |
| **Extractions** (AI) | `/auslesungen` | `/extractions` | `extraction` |
| **AI** | `/ki` | `/ai` | |
| Extraction type: metrics report, cap table | `kennzahlenbericht`, `captable` | | `metrics_report`, `cap_table` |
| Send a mail attachment for extraction | | `/activities/{id}/attachments/{attachmentId}/extraction` | `type`, `confidentialApproved`, `documentId`, `extractionId`, `suggestion`, `warnings` |
| Map to the metric catalogue and reconcile against the cap table (extraction review aids) | | | `mapping`, `reconciliation`. Select the company for reconciliation with `organizationId`. |
| Error codes for email document intake | | | `inbox_mail_not_incoming`, `inbox_sender_unknown`, `inbox_sender_not_allowed`, `inbox_attachment_type_not_allowed`, `inbox_attachment_too_large` |
| ESG, disclosure (SFDR) | `…/esg`, `…/offenlegung` | `…/esg`, `…/disclosure` | `disclosure` |
| **Export** | `/export` | `/export` | |
| **Import**, import run | `/import`, `/import/laeufe` | `/import`, `/import/runs` | `importRun` |
| Finding | `…/befunde` | `…/findings` | `finding`, `severity` |
| Fund report, portfolio list, quarterly report | | `/funds/{id}/reports/fund-report`, `…/portfolio-list`, `/investments/{id}/reports/quarterly-report` | `asOf`, `knowledgeDate`, `language`, `format` |
| Report currency view | | | `currencyView` (`fund`, `local`, `comparison`), `comparisonCurrency` |
| Report types | | | `reportType`: `fund_report`, `quarterly_report`, `lp_report`, `committee_pack`, `portfolio_list`, `exit_list`, `pai_statement`, `scenario_report` |
| Report status and approval | | `…/stage` | `status`: `draft`, `reviewed`, `approved`; `stage`, `result` (`ok`, `returned`), `comment`, `overrideChecks` |
| Report template and prior-year text | | `/funds/{id}/report-templates/{reportType}` | `configuration`, `sections`, `metrics`, `columns`, `companyMetrics`, `customFields`, `copyPriorYearText` |
| Data provenance and inputs for a reporting run | | `…/provenance`, `…/inputs` | `key`, `value` |
| Validate a definition, versions and assignments | | `/reporting-definitions/validate`, `…/{key}/versions`, `/funds/{id}/reporting-assignments` | `definition`, `frequency`, `validFrom`, `validTo`, `fundingProgram` |
| Download a reporting run file | | `/reporting-runs/{id}/file` | `type`: `submission`, `review_view` |
| Resolution template | | `/resolution-templates` | `fundId`, `text`, `placeholders`, for example `{{organization}}` and `{{date}}` |
| Upload, replace and download a document | | `/documents`, `…/{id}/replace`, `…/{id}/file` | Multipart `file`, `targets` (JSON list of `{ type, id }`), `classification`, `confidential`; filters `targetType` and `targetId`, file checksum in `X-File-Sha256` |
| Document classification | | | `contract`, `resolution`, `valuation`, `report`, `voucher`, `other_document` |
| Import template, validation, application and log | | `/import/template`, `/import/runs/{id}/validate`, `…/apply`, `…/log` | `language`, `file`, `severity`, `sheet`, `cursor`, `nextCursor` |
| AI extraction, confirm, discard | | `/documents/{id}/extractions`, `/extractions/{id}/confirm`, `…/discard` | `type`: `investment_agreement`, `loan_agreement`, `valuation_evidence`, `register_extract`; `pages`, `allowConfidential`, `citations` |
| AI contact enrichment | | `/ai/contacts/settings`, `…/participation`, `…/suggestions` | `aiEnabled`, `signatures`, `website`, `entityType`, `source` |
| ESG overview and SFDR classification | | `/funds/{id}/esg/overview`, `…/esg/pai`, `/funds/{id}/disclosure` | `year`, `coverage`, `indicators`, `classification` (`article_6`, `article_8`, `article_9`) |

Starting, listing and confirming document extractions retained their legacy paths and input formats until #188.
The review aids and metrics report confirmation use the public metric keys (`metricKey`).

### Contacts, deals, activities and mailbox (#189)

| Concept | Legacy | Path | Field |
|---|---|---|---|
| **Organisations** | `/organisationen` | `/organizations` | `organization`, `organizationId` |
| **People** | `/personen` | `/people` | `person`, `personId` |
| First name, surname | | | `firstName`, `lastName` |
| **Contact roles** | `/kontaktrollen` | `/contact-roles` | `contactRole` |
| **Organisation relationships** | `/organisationsbeziehungen` | `/organization-relationships` | `relationship` |
| Employment | `…/beschaeftigungen` | `…/employments` | `employment`, `jobTitle`, `primary` |
| Company type, registered office, legal form | | | `kind` (`company`, `investor`, `advisor`, `other`), `city`, `legalForm` |
| Duplicate, merge | `…/dubletten`, `…/zusammenfuehren` | `…/duplicates`, `…/merge` | `mergedInto` |
| **Contact import** | `/kontaktimport` | `/contact-import` | |
| **CRM**, object, record | `/crm`, `…/objekte`, `…/datensaetze` | `/crm`, `…/objects`, `…/records` | `object`, `record` |
| Custom field | **`/zusatzfelder`**, `…/felder` | `/custom-fields/{object}/definitions`, `/custom-fields/{object}/schema`, `…/fields` | `customFields`, `values` |
| Investment instrument fields | `…/instrumentfelder` | `/investments/{id}/instrument-fields` | `instrumentId` |
| Query, grouping, sorting | `…/abfrage`, `…/gruppen` | `…/query`, `…/groups` | `groupBy`, `columns`, `sort`, `direction` (`asc`, `desc`) |
| Task, due date | `…/aufgaben` | `…/tasks` | `dueDate`, `assigneeId` |
| List, view | `…/listen`, `…/ansichten` | `…/lists`, `…/views` | `list`, `view` |
| Bulk action | `…/massenaktion` | `…/bulk-actions` | |
| **Dealflow**, worklist, funnel | `/dealflow`, `…/arbeitsliste`, `…/trichter` | `/dealflow`, `…/worklist`, `…/funnel` | `stageHistory`, `timeInStage` |
| Card fields | `…/kartenfelder` | `…/card-fields` | `fields` |
| Assignment, reopening, resolution | `…/zuordnung`, `…/wiederaufnahme`, `…/beschluesse` | `…/assignment`, `…/reopen`, `…/resolutions` | `investmentManagerId`, `projectLeadId`, `outcome` |
| **Deals**, stage | `/deals` | `/deals` | `deal`, `stage` |
| Rejection | `…/absage` | `…/decline` | |
| **Activities** | `/aktivitaeten` | `/activities` | `activity` |
| Attachment | `…/anhaenge` | `…/attachments` | `attachment` |
| **Follow-ups** | `/wiedervorlagen` | `/follow-ups` | `followUp` |
| Assignee | `…/zustaendige` | `…/assignees` | `assigneeId` |
| Complete | `…/erledigen` | `…/complete` | `completedAt` |
| **Events** | `/termine` | `/meetings` | `meeting` |
| **Calendar** | `/kalender` | `/calendar/{file}` | ICS subscription |
| **Mail**, outbox | `/mail/auftraege` | `/mail/jobs` | `outbox`, `status` (`pending`, `sent`, `failed`) |
| **Mailbox**, callback, sync | `/postfach`, `…/rueckruf`, `…/abgleichen` | `/mailbox`, `…/callback`, `…/sync` | `mailbox`, `provider`, `storeContent`, `lastSyncedAt` |
| **Contact suggestions** (from mailbox and calendar), apply, discard, participation, blocklist | `/kontaktvorschlaege`, `…/uebernehmen`, `…/verwerfen`, `/postfach/kontakte` | `/contact-suggestions`, `…/accept`, `…/dismiss`, `/mailbox/contacts` | `contactSuggestion`, `participating`, `blocklist` |
| **Search** | `/suche` | `/search` | `q` |
| **External** (request link), submit | `/extern/abfragen`, `…/einreichen` | `/external/requests/{token}`, `…/submit` | `token`, `metrics`, `values` |

CRM system fields have public keys such as `firstName`, `stage` and `fundId`. These apply in the field catalogue, rows, views,
filters and sorts. Filter groups use `conjunction` (`and`, `or`) and `conditions`. Conditions use `field`, `operator` and `value`
(for example `is`, `contains`, `greater_than`). Saved views map to public names on read. Field definition IDs and user-defined option
keys remain the same.
Custom fields for funds, investments, transactions and rounds live at `/funds/{id}/fields`, `/investments/{id}/fields`,
`/transactions/{id}/fields` and `/financing-rounds/{id}/fields`. Use `knowledgeDate` to read an earlier state of knowledge.
Yes/no metrics in external requests use the strings `yes` and `no`.

### Excel values: metrics and functions (#184, #167)

Excel values use `camelCase`. Matching ignores case, spaces, underscores and hyphens.
Excel functions use the API terminology (`CARRAWAY.METRIC(fund, metric, [asOf], [knowledgeDate])`,
`CARRAWAY.INVESTMENT(fund, company, metric, …)`, `CARRAWAY.INSTRUMENT(fund, company, instrument, metric, …)`,
`CARRAWAY.CAPITAL_ACCOUNT(fund, investor, metric, …)`, `CARRAWAY.CURRENCY(fund)`).

| Concept | Legacy | Name |
|---|---|---|
| Fund metrics | `tvpi`, `dpi`, `rvpi`, `irr`, `nav` | unchanged |
| Paid in, outstanding, overdue, unconfirmed | `eingezahlt`, `offen`, `ueberfaellig`, `ungeklaert` | `paidIn`, `outstandingCalls`, `overdueCalls`, `unconfirmedPayments` |
| Called capital, distributions, subscribed capital | `abgerufen`, `ausschuettungen`, `zeichnungskapital` | `calledCapital`, `distributions`, `subscribedCapital` |
| Invested, proceeds, valuation | `investiert`, `rueckfluesse`, `bewertung` | `invested`, `proceeds`, `valuation` |
| Commitment, paid out, unfunded commitment | `zusage`, `ausgezahlt`, `offenezusage` | `commitment`, `paidOut`, `unfundedCommitment` |
| Outstanding principal, repayments, carrying amount | `offeneskapital`, `tilgungen`, `buchwert` | `outstandingPrincipal`, `repayments`, `carryingAmount` |
| Interest booked, capitalised, paid, converted, outstanding | `zinsengebucht`, `zinsenkapitalisiert`, `zinsengezahlt`, `zinsengewandelt`, `zinsenoffen` | `interestBooked`, `interestCapitalized`, `interestPaid`, `interestConverted`, `interestOutstanding` |
| Dividends | `dividenden` | `dividends` |
| Share, called ratio, distributed, NAV share | `anteil`, `abgerufenquote`, `ausgeschuettet`, `navanteil` | `share`, `calledRatio`, `distributed`, `navShare` |
| Unit: amount, ratio, number, yes/no | `betrag`, `anteil`, `zahl`, `ja_nein` | `amount`, `ratio`, `number`, `yes_no` |
| Value scope | `fonds`, `beteiligung`, `instrument`, `kapitalkonto` | `fund`, `investment`, `instrument`, `capital_account` |

Values responses use the same instrument types and statuses as `/instruments` (`convertible_loan`, `active` and so on).
Catalogue metrics use their public keys. Excel functions also match these keys regardless of case or separators.

Matrix functions are `FUNDS`, `INVESTMENTS`, `KPIS`, `ROUNDS`, `ROUND_POSITIONS` and `INVESTORS`. Data sheet routes use
`mode` (`snapshot`, `history`, `events`), `asOf`, `knowledgeDate`, `from` and optionally `investment`.
Write keys have `permission: "write"`. A preview run (`writeRun`) returns `runId` and `rows` with `before`, `after` and `findings`.
After approval it returns `appliedAt`, `appliedBy` and `result`. The `acceptance-report` endpoint returns the acceptance log.
Valuation components are `equityValue` and `debtValue`. `preview_changed` and `preview_expired` require a new preview run.

### Common field names

| Concept | Field |
|---|---|
| As-of date | `asOf` |
| Knowledge date (`stand`) | `knowledgeDate` |
| Changed since | `changedSince` |
| Valid from / to | `validFrom` / `validTo` |
| Period from / to | `periodFrom` / `periodTo` |
| From / to (date) | `from` / `to` |
| Amount, local amount | `amount`, `localAmount` |
| Currency | `currency` |
| Rate, ratio, share | `rate`, `ratio`, `share` |
| Count | `count` |
| Label, name, title | `label`, `name`, `title` |
| Description, remark, comment, note | `description`, `remark`, `comment`, `note` |
| Kind, type | `type` (or `kind` if `type` is already used) |
| Status | `status` |
| Key | `key` |
| File, filename | `file`, `fileName` |
| Language | `language` |
| Order, sorting | `order`, `sort` |
| Active, archived | `active`, `archived` |
| Reason, justification | `reason` |
| Source, provenance | `source`, `origin` |
| Recorded at, created by | `recordedAt`, `createdBy` |
| Version | `version` |
| Preview | `preview` |
| Page (pagination) | `cursor`, `limit` |
