# Currencies, custom fields and valuation scenarios

Design and implementation notes for stage 21 and follow-up 9. All examples are fictional. Interfaces shown with legacy identifiers record the implementation at that stage. See the [API glossary](api-glossary.md) for public API names.

## 1. Currency views

| Term | Meaning | Storage |
|---|---|---|
| Fund currency | Currency of the fund's books. All posted amounts (`vorgang.betrag`, `bewertung.wert` and fund movements) and metrics (NAV, TVPI, DPI and IRR) use it. | `fonds.waehrung` |
| Local currency | Currency of the investment, for example shares in USD. Empty means fund currency. | `beteiligung.waehrung` |
| Comparison currency | A view of values in a third currency. Selected per view (`?comparison=GBP`) without storing it. | URL only |
| Home currency | The manager's (installation's) currency. It follows the comparison currency rules, is always included in currency views (`haus`, “Home”, `?currencyView=house`) and is used for cross-fund totals (manager profile and portfolio dashboard). Defaults to EUR without a profile. | `manager_profil.hauswaehrung` (Administration → Manager profile, global admins only) |

The currency view does not change the underlying metric amounts. Local and comparison amounts represent conversions or additional posted amounts.

### Cross-fund totals in home currency

`GET /manager-profile` and `GET /portfolio/dashboard` aggregate funds on which the person has at least viewer level in portfolio, using a common as-of date (`asOf`, default is the latest fund default date) and knowledge date (`knowledgeDate`). Payments (investor contributions, distributions and target fund calls) use the rate at value date. Balances (commitments, NAV and values) use the rate at the as-of date. A missing value in one fund makes the total unavailable. If a fund holds a share in another fund included in the total (target fund in the same installation), subtract that holding's commitment, calls, distributions and value to remove double counting (calculation engine `portfolioSummen`, with provenance per total).

### Exchange rate table

`wechselkurs` stores date, base, quote, rate (`1 base = rate in quote`, decimal string with at most eight decimal places), source (`manuell` or `import`), filename, recorder and timestamp.

- **Append-only.** A trigger makes rows immutable. A correction adds a row for the same date and pair with a reference to the previous effective rate (`korrigiert_kurs_id`) and a reason.
- The effective rate per date and pair is the latest row up to the knowledge date (`?knowledgeDate=`). Historical views use the rates known then.
- Only global admins can enter, correct and import rates (Administration → Exchange rates). Anyone with a role can read them.
- Rates come from manual entry or file upload. The application does not fetch them from the network.

### Import a rate file

`POST /api/v1/exchange-rates/import` with `{ content, sourceFile, preview, currencies?, since? }`. Preview is the default and writes nothing. Two layouts are supported, with comma, semicolon or tab separators.

1. **ECB layout (wide).** Header `Date,USD,JPY,GBP,`, one date `JJJJ-MM-TT` per row and a rate per 1 EUR for each currency. `N/A` and empty cells mean no rate. A trailing comma is accepted. The base is always EUR.
2. **Long layout.** Columns `Datum`, `Basis`, `Quote`, `Kurs` (also `Date`, `Base`, `Currency`, `Rate`). Date as `JJJJ-MM-TT` or `TT.MM.JJJJ`. Decimal point or, with semicolon separators, decimal comma.

Import adds only entries without an existing effective rate. An identical rate counts as unchanged, so rerunning is safe. A different rate is reported and preserved until a manual correction with a reason. The response gives row numbers for errors. Up to 100,000 new rates per import. Narrow the import with `waehrungen` and `ab`.

### Rate selection

To convert from `von` to `nach` on a date:

1. Same currency: factor 1.
2. Direct or inverse rate: take the newest entry with date ≤ the requested date (direct wins ties). It applies both ways. The inverse remains exact by keeping numerator and denominator separate.
3. Otherwise convert through EUR using two rates. The older date is the rate date.
4. Otherwise the rate is **missing**.

Rates can be **no more than seven days old**. An older rate is missing (`veraltet`, with the last available date). The calculation never estimates a rate or carries an old value forward.

### Which rate applies

| Item | Rate | Reason |
|---|---|---|
| Disbursement, proceeds, repayment, commitment, impairment | Value date rate | The cost is the amount at payment date |
| Valuation (fair value) | Valuation as-of date rate | Fair value is measured on that date |
| Open purchase price receivables | View as-of date rate | They are part of the as-of valuation basis |

### Record local amounts

For an investment with a different local currency, a payment or valuation can also be recorded in that currency (`betragLokal` or `wertLokal`).

- Local amount only: convert to fund currency using the rate table for the date (409 `rate_missing` if missing).
- Both amounts, for example from a bank statement: use the posted fund amount and derive the rate.
- **Store the rate** on the row (`kurs`, `kurs_id`). Later rate corrections do not change posted amounts. A reversal copies the rate and negates the local amount.
- Only impairment can be negative. All other types require the local amount to be greater than zero.
- If local and fund currencies match, local amounts are rejected (409 `currency_same`) to avoid two values for the same amount. Once local amounts exist, the local currency is locked.
- If no local amount was posted, the local view converts the fund amount using the rate on the date, if available.

### Currency view and selector

`GET /investments/:id/waehrungssicht` and `GET /fonds/:id/waehrungssicht` (`stichtag`, `stand`, `vergleich`) return each amount in fund, local and comparison currency, the rates with dates and any missing rates. The investment and fund portfolio UI shows **Local | Fund | Comparison** and stores the selection in the URL.

- Amounts always carry their own currency symbol. Local or comparison metrics are labelled, for example “Invested (USD)”.
- **Missing rates.** Show “Rate missing” in place of a figure and show pair, date and reason in the selector. A total that depends on a missing rate is also unavailable.
- Multiple, IRR, TVPI, DPI and calls stay in fund currency. The selector explains this.
- Fund totals are available in fund and comparison currency. Local amounts use different units and have no joint fund total.
- **Currency effect.** Valuation → Currency breaks down the fund value change since the previous valuation into value change (local change at the new rate) and currency effect (old local value times rate change). The currency effect is the remainder from the rounded total change, so the two parts add up exactly.

### Rounding

Round each amount once at the end to cents, half away from zero. Rates and intermediate steps stay unrounded. The calculation engine (`packages/rechenkern/src/waehrung.ts`) has an independent Python reference using fractions (`referenz/referenz_waehrung.py`). Tests compare them.

### Currency views in reports

Fund reports (PDF and Excel), LP reports, portfolio lists and exit lists (PDF and Excel) support a currency view when creating a report (`POST /reports`: `currencyView`, `comparisonCurrency`) and for direct downloads (`GET /funds/:id/reports/fund-report` and `/portfolio-list`, same parameters).

| View | Meaning |
|---|---|
| `fonds` (default) | Fund currency, as before |
| `lokal` | Each investment's local currency, with no total across different currencies |
| `vergleich` | All rows and the total in the chosen currency (`vergleichswaehrung`, three uppercase letters) |

- The view applies to **Invested, Proceeds (sale proceeds in the exit list) and Valuation** (latest valuation without open receivables, as in the fund column). Commitments, carrying amount, impairment, unfunded commitments, all metrics (NAV, TVPI, DPI, IRR) and multiples stay in fund currency. Converted column headers indicate the currency (“Invested (GBP)”, “Invested (local)”).
- **Calculations and rates** follow the interface view (`waehrung/sicht.ts`). Costs use the value date rate. Posted local amounts take precedence. Valuations use their as-of date. Rates are up to seven days old and respect the knowledge date (`stand`).
- **Report rate and date.** Below the PDF table and on the Excel “Currency view” sheet, the report lists view, rule, each rate with rate date and item date, and each gap.
- **Missing rate.** The cell says “Rate missing” (Excel text, never blank), as does the column total. The sheet lists pair, date and reason (no rate or older than seven days). Rates are never estimated. An investment without a valuation shows “–”, which is a different case.
- The view is saved with the report (`bericht.parameter.waehrung`) like its template. Approval recreates that view using the saved knowledge date.
- Only those four report types support a view (otherwise 400 `sicht_nicht_moeglich`). Quarterly reports, committee packs, PAI statements and scenario reports stay in fund currency. Committee packs and PAI statements have no per-investment local amounts. The quarterly report covers one investment, whose page has a currency view. Scenario reports calculate in fund currency.

### Limits

- Report snapshots and metrics stay in fund currency. Views affect only the amount columns listed above.
- Fund metric snapshots stay in fund currency. Converted values are never stored.
- Interest calculations, accounting exports and regulatory reporting still use fund currency.
- Two demo investments in the first fund use local currencies USD and GBP, with fictional weekly rates. Their fund-currency amounts are unchanged.

## 2. Custom fields for all objects

CRM field definitions apply to **funds, financing rounds, instruments, investments and transactions**. They support text, long text, number, amount, date, select, multi-select, checkbox, URL, email, telephone, person and link, with versions per edit and archiving in place of deletion. One engine and one set of definition routes (`/crm/felder`, global admins only) serve them.

| Object | Value storage | Editable |
|---|---|---|
| Fund | `fonds.felder` | Yes |
| Financing round | `finanzierungsrunde.felder` | Yes, even in closed rounds. The round's figures stay locked. |
| Investment | `beteiligung.felder` | Yes |
| Instrument | `beteiligung.instrument_felder` | Yes |
| Transaction | `vorgang.felder` | At creation only |

- **Instrument.** In this version it is an investment property, unique per fund, company and instrument, without its own table. Its fields use a distinct definition set stored on the investment.
- **Transaction.** Set values at creation, including in the unified entry form. The transaction is immutable and its reversal carries the original values. To change a value, reverse and repost so posted records stay intact and no edit is silent.
- **Period lock.** Transactions follow the existing value-date lock. A round's values are locked if its date is in a locked period of a participating fund. Funds, investments and instruments are descriptive master data without a posting date and are not period-bound. Each change has before and after values in the audit log.
- **Knowledge date (`?knowledgeDate=`).** For editable objects, read the audit log (`felder_setzen`) for the last change up to that date and use its after state. Before the first change use the original state. With no API changes, the current values apply (legacy and demo data). Transactions are effective from entry time.
- **Interface.** `GET/PUT /fonds/:id/felder`, `/investments/:id/felder`, `/investments/:id/instrumentfelder` and `/financing-rounds/:id/felder`, `GET /vorgaenge/:id/felder`, plus `GET /zusatzfelder/:objekt/definitionen` and `GET /zusatzfelder/:objekt/schema` (dynamic JSON Schema from active definitions). OpenAPI describes values as `Zusatzfelder`, keyed by definition IDs.
- **Export.** Full export includes `felder`, `instrument_felder` and definitions.
- **UI.** A Fields tab on investments (with Instrument subtab) and funds, round and transaction fields in a side panel, inputs when posting a transaction and “Manage fields” for global admins.
- **Report columns (follow-up 9).** Fund report, LP report, portfolio list and exit list templates include `zusatzfelder` (up to 8 ordered field definition IDs from funds, rounds, instruments and investments). Extra columns follow fixed columns in both PDF and Excel. They follow the calculation's knowledge date (`?knowledgeDate=`, same rules as reading values) and are captured with the template at report creation. Direct downloads also use the fund's template. Fund admins choose them under Reports → Templates (“Custom fields as columns”).
  - An **investment** or **instrument** field uses the investment's value. A **round** field uses the company's latest closed financing round up to the as-of date (the same round as the portfolio list stage). A **fund** field uses the fund's value, repeated in each row. Transaction fields have no column because each row represents an investment and transactions are individual postings.
  - Visibility follows the person creating the report for the fund. Fields have no separate visibility and follow their object's fund permissions. Links and people display the target's name. Deal links stay empty because the report has no requesting user's deal view. Archived definitions cannot be selected anew but still appear in a stored template.
  - Format amounts in the field currency, numbers and dates in the report language, options by label and checkboxes as yes/no. An absent value is “–” (blank in Excel). Excel writes numbers, amounts and dates as native numeric and date values.
  - **Metric requests** to companies have no custom field columns because they are requests rather than lists. Portfolio list queries are downloads (`/funds/:id/reports/portfolio-list`, `/fund-report`) and reports, and use template fields.

## 3. Valuation scenarios

On Scenarios → Valuation scenarios, each active investment has 2 to 6 cases (base, bear, bull or custom identifiers) with probabilities and methods. These form the optional `bewertung` section of the scenario assumptions. Omitting it preserves the previous calculation, result and checksum.

| Method | Case value |
|---|---|
| Multiple on metric | (Metric × multiple − deduction, floored at zero) × fund share |
| Latest round | Latest round price per share × fund shares × (1 − discount). A negative discount is a premium. |
| Fixed value | The amount |

- Amounts are in **fund currency**. The metric uses the latest confirmed actual value up to the base date, respecting the knowledge date. Use either the fund share from the cap table (fund shares divided by all shares after the latest round) or a supplied share. Loans without shares require a fixed value or an explicit share.
- **Foreign-currency metric (follow-up 9).** If the metric is of type amount with a currency code such as `USD` different from fund currency, both metric and deduction use the metric currency. Convert enterprise value (metric × multiple − deduction, floored at zero) at the **base date rate** (exchange rate table, knowledge date, at most seven days old and the paths under [Rate selection](#rate-selection)), then apply the fund share. The rate stays fractional, with rounding once at the end. A missing rate makes the case value, expected value and fund metrics unavailable (finding `BEWERTUNG_KURS_FEHLT` with pair, date and reason). The calculation never estimates a rate and shows currency, rate and date. Metrics in other units (count, percent or text) are treated as a number in fund currency as before.
- **Probabilities** are fractions with at most six decimal places and sum to exactly 1 (100%) per investment. The interface converts percents without floating point. Expected value is the weighted sum rounded once to cents.
- **Missing inputs.** Without a metric, round or share, the case, expected value and any dependent fund metric are unavailable. Findings explain the reason.
- **Fund impact.** Report NAV, TVPI, DPI, RVPI, preview carry and NAV after carry for each case and for the expected result. A case uses the same identifier across investments, keeping the current value wherever that case is absent. The carry preview is simplified as in forecasts: scenario carry rate times growth above calls, at whole-fund level, without hurdle or catch-up.
- **Case proceeds from exit waterfall (follow-up 9).** A case with enterprise value shows fund proceeds from the **existing exit waterfall** alongside it (result `exit`). The multiple method uses metric × multiple − deduction in fund currency, before applying the share. The latest round method uses price per share × company shares after that round × (1 − discount). Fixed value has no enterprise value and hence no proceeds. The waterfall uses the company's cap table at the base date as the exit date and excludes exit costs. Without a cap table containing the fund's positions, it shows “No cap table”. The difference from case value shows the effect of preferences over pro-rata ownership alone. **Expected proceeds** (`erwartetErloes`) are unavailable if any case has no proceeds.
  - **Limits.** Proceeds leave case value, NAV, TVPI, DPI and carry preview unchanged because these use the valuation method's value. If the fund holds several active investments in one company, proceeds apply to the company and all of those investments (`beteiligungenDesFonds`), with no split among them. The valuation case uses the base date as its exit date, as an assumption.
- **Locking.** The result is saved with the scenario, frozen and protected by the checksum. Drafts recalculate on every view.
- **Report.** Existing scenario reports (PDF and Excel) include valuation scenarios and fund impact. Drafts are watermarked DRAFT.
- **Report.** Scenario reports include a “Fund proceeds from waterfall” column (PDF and Excel), with a reason if there is no cap table.
- Calculation engine: `packages/rechenkern/src/bewertungsszenario.ts` and Python reference `referenz/referenz_bewertungsszenario.py` (cases F and G check conversion and enterprise value).
