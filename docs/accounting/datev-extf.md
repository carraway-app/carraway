# DATEV format for posting batches (EXTF)

Posting exports use DATEV format category 21 (“Buchungsstapel”), version number 700 and format version 13 (`packages/import/src/datev-extf.ts`). This page records the sources used to check the field list and the questions that remain open.

## Sources used

| Source | Finding |
|---|---|
| DATEV developer portal, header description and document 1003221 (posting batch field description) | The connection was refused during the review. A search result confirmed only version number 700, format category 21 for posting batches and field 20 (accounting purpose) with the values 0, 30, 40, 50 and 64. |
| The open-source `ledermann/datev` library (Ruby, format 7.0), header and posting field lists with limits, and sample file `examples/EXTF_Buchungsstapel.csv` | Main source for checking the 31 header fields and 125 columns, their order, lengths, character set, document date and quoting. The library is a third-party implementation. |

## Confirmed against the open-source implementation and its sample

- The header contains 31 fields. The order includes the `EXTF` identifier, version number 700, data category 21, format name, format version 13,
  creation time (`JJJJMMTThhmmssSSS`), import time (empty), origin, exported by (up to 25 characters), imported by (empty), adviser, client,
  start of financial year (`JJJJMMTT`), general ledger account length (4 to 8), from date, to date, description (up to 30 characters), dictation code,
  posting type (1 = financial accounting), accounting purpose (field 20, 0 or empty = independent), finalisation flag, currency code, derivative flag,
  SKR (field 27), industry solution ID and application information (field 31, up to 16 characters). A test recreates the sample's header
  (quotes only around text, empty fields, posting type 1, finalisation flag 0 and currency code “EUR”).
- Row 2 has 125 column headers. Positions match for account (7), contra account (8), document date (10), document field 1 (11), posting text (14),
  document link (20), KOST1 (37), additional information (48) and units (88).
- Amounts use a decimal comma and no thousands separators. The amount is always positive. The debit/credit flag refers to the account.
  A reversal therefore uses a positive amount with the opposite flag.
- The document date format is `TTMM` (day and month). On import, the financial year determines the year. A batch can therefore span no more than
  twelve months (issue `EXPORT_ZEITRAUM_ZU_GROSS`).
- Document field 1 allows up to 36 characters from `A-Z a-z 0-9 $ & % * + - /`. Posting text allows up to 60 characters. Longer text is truncated.
- Adviser numbers start at 1001, which fund configuration validates.
- Encoding is Windows-1252, with semicolon separators and CR LF line endings.

## Changes from this review

- Updated the headers “Basisumsatz” and “WKZ Basisumsatz” (previously hyphenated), “Kost Menge”, “EU-Land u. USt-IdNr.” and “EU-Steuersatz”,
  the dashes in “Beleginfo – Art n”, “Zusatzinformation – Art n” and “KOST1 – Kostenstelle”, and “Datum vom” in the header description.
- The header's dictation code is an empty field without quotes.
- Adviser numbers below 1001 are rejected.

## Open questions and unverified details

- **Spelling of row 2 headers.** The open-source implementation and the remembered DATEV description differ toward the end of the row.
  Examples include “Bezeichnung” and “Kennzeichen” versus “Bezeichnung SoBil-Sachverhalt” and “Kennzeichen SoBil-Buchung”,
  “Abrechnungsreferent” versus “Abrechnungsreferenz”, and “Datum Zuord.” versus “Datum Zuord. Steuerperiode”. That part of the export
  still uses the remembered DATEV spelling. The column count and positions match in both versions. Programs that look up columns by header
  only need the earlier fields (Umsatz, Kennzeichen, Konto, Gegenkonto, Belegdatum, Belegfeld 1, Buchungstext).
- **SKR (field 27)** remains empty. The value and its permitted spelling are unverified.
- **Format version 13** and the origin code `FU` have yet to be checked against a current DATEV installation.
- **Account length.** The export requires accounts to match the general ledger account length in the header and reports deviations as issues.
  Personal accounts (one digit longer) are unsupported.
- **Import into DATEV.** The export has yet to be tested by importing into a DATEV application. Import a sample there before using the format operationally.
