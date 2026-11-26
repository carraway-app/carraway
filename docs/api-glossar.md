# API-Glossar und Konventionen

Die öffentliche HTTP-API von Carraway ist englisch: Pfade, Parameter, Felder in Anfragen und Antworten, Enum-Werte, Fehlercodes und
-meldungen sowie die Dokumentation unter `/api/v1/docs` und `/api/v1/openapi.json`. Dieselben Namen gelten für den MCP-Server
(Werkzeugnamen, Beschreibungen, Parameter). Die Oberfläche bleibt deutsch bzw. zweisprachig; sie übersetzt Fehler anhand des Codes.

Die Umstellung läuft in Bereichen (Issue #182 mit #184 bis #189). Jedes Bereichs-Issue hält sich an dieses Glossar, ergänzt neue
Begriffe und streicht seine Einträge aus der Ausnahmeliste der Englisch-Prüfung (siehe unten). Entscheidung 520 hält die Grundsätze fest.

## Konventionen

| Thema | Regel | Beispiel |
|---|---|---|
| Pfade | `kebab-case`, Ressourcen im Plural, IDs als Pfadparameter | `/capital-calls/{id}`, `/funds/{fundId}/reporting-runs` |
| Aktionen | Unterpfad mit Verb (POST), wenn es kein reines Anlegen, Ändern oder Löschen ist | `POST /funds/{id}/close`, `POST /vouchers/{id}/reverse` |
| Felder und Parameter | `camelCase`, IDs mit Suffix `Id` bzw. `Ids` | `fundId`, `asOf`, `changedSince`, `investmentIds` |
| Wahrheitswerte | Adjektiv oder Partizip ohne `is`-Präfix | `active`, `confidential`, `archived` |
| Datum | ISO 8601: `YYYY-MM-DD`; Zeitpunkte mit Zeitzone `YYYY-MM-DDTHH:mm:ss.sssZ` | `"asOf": "2026-06-30"` |
| Beträge | Dezimal-Strings mit Punkt, höchstens zwei Nachkommastellen, Währung als eigenes Feld (ISO 4217) | `"amount": "1250000.00", "currency": "EUR"` |
| Quoten und Sätze | Dezimal-Strings als Anteil (0.25 = 25 %) | `"rate": "0.06"` |
| Enum-Werte | englisch, `snake_case` | `"status": "in_review"`, `"type": "capital_call"` |
| Listen | `{ data, nextCursor }` mit `limit` und `cursor` | `GET /funds?limit=50&cursor=…` |
| Fehler | `{ error: { code, message, fields? } }`, `code` englisch in `snake_case`, `message` englisch | siehe unten |

Abkürzungen gelten als Wort: `navValue`, `apiKey`, `paiIndicators` (nicht `NAVValue`). Fachbegriffe aus dem englischen Fondsgeschäft
gehen vor wörtlichen Übersetzungen (`capital call` statt `call of capital`, `commitment` statt `promise`).

## Fehlerformat

```json
{
  "error": {
    "code": "invalid_input",
    "message": "The input is invalid.",
    "fields": [{ "field": "amount", "code": "invalid_format", "message": "Expected an amount with at most two decimal places" }]
  }
}
```

- `code` ist stabil und maschinenlesbar (`fund_not_found`, `period_locked`, `four_eyes_violated`). Die Oberfläche übersetzt ihn
  (`apps/web/src/i18n/fehler*.ts`); ein neuer Code braucht dort einen deutschen und einen englischen Text (Test `codes.test.ts`).
- `message` ist englisch und für Entwickler gedacht; sie kann Werte enthalten und ist kein stabiler Vertrag.
- `fields` nennt Feldfehler; `field` ist der Feldname, verschachtelt mit Punkt (`terms.rate`), `code` der Prüfschritt, ebenfalls englisch in `snake_case` (`too_small`, `reason_required`, `date_out_of_range`).
- Weitere Angaben stehen neben `code` und `message` (z. B. die Kandidaten bei `possible_duplicate`). Ihre Namen stellen die
  Bereichs-Issues mit den übrigen Feldern um.
- Better Auth (`/auth/*`) antwortet in seinem eigenen Format `{ code, message }` mit Codes in Großbuchstaben (`INVALID_TOKEN`); eigene
  Codes, die Carraway dort meldet, folgen der Regel oben (`too_many_attempts`).
- Befunde (Import, Saldenlauf, Meldewesen, Kontrollberichte) sind Daten. Ihre Codes sind englisch und maschinenlesbar. Importbefunde und Probleme einer Meldedefinition liefern den englischen Text als `message` und den lokalisierten deutschen Text als `messageDe`.

## Felder und Datenbank

Die Spaltennamen der Datenbank bleiben deutsch; es gibt keine Migrationen für die Umbenennung. Wo eine Route Zeilen unverändert ausgibt,
bekommen die Drizzle-Eigenschaften englische Namen (der Schlüssel im Schema darf vom Spaltennamen abweichen:
`asOf: date("stichtag")`). Wo eine Route ohnehin eine eigene Antwort baut, wird an der API-Grenze abgebildet. Enum-Werte, die in der
Datenbank stehen, werden an der API-Grenze abgebildet, solange keine Migration sie umstellt (Entscheidung 520).

## Englisch-Prüfung

`apps/api/src/__tests__/openapi-englisch.test.ts` (Kern) und `ee/api/src/__tests__/openapi-englisch.test.ts` (Voll) prüfen im erzeugten
OpenAPI-Dokument alle Pfadsegmente, Pfad- und Abfrageparameter und die Eigenschaften der Schemata auf deutsche Bezeichner (Umlaute,
deutsche Wörter und Wortstämme, Endungen wie `-ung`, Umschriften `ae`/`oe`; Regeln in `apps/api/src/openapi-englisch.ts`). Noch nicht
umgestellte Bereiche stehen als Pfadpräfixe in `AUSNAHMEN_KERN` bzw. `AUSNAHMEN_ERWEITERUNGEN` (`ee/api/src/openapi-englisch.ts`),
gruppiert nach Bereichs-Issue. Ein Eintrag, der nichts mehr deckt, lässt die Prüfung scheitern. Wer einen gemeinsamen Mount-Punkt
umbenennt (`/fonds` → `/funds`), passt die Präfixe anderer Bereiche darunter an. Ziel für Kern und Voll sind leere Ausnahmelisten. Neue Routen verwenden die englischen Konventionen ab dem ersten Commit.

## Glossar

Spalte „Pfad“ nennt den Namen als Pfadsegment, „Feld“ den Namen als Feld oder Parameter. Fett gesetzte Einträge sind Mount-Punkte in
`apps/api/src/app.ts` bzw. in den Erweiterungen.

### Konto, Zugänge, Einstellungen (#184)

| Deutsch | Heute | Pfad | Feld |
|---|---|---|---|
| **Konto** | `/konto` | `/account` | `account` |
| **Passwort** | `/passwort` | `/password` | `password` |
| **Einrichtung** (Ersteinrichtung) | `/einrichtung` | `/setup` | `setup` |
| **Benutzer** | `/benutzer` | `/users` | `user`, `userId` |
| **Rechte** | `/rechte` | `/permissions` | `permissions` |
| Rolle (Rechterolle) | `/rechte/rollen` | `/permissions/roles` | `role`, `roleIds` |
| Nutzergruppe | `/rechte/gruppen` | `/permissions/groups` | `group`, `groupId` |
| Bereich (der Anwendung) | | | `area`, `areas` |
| Fondsrolle Betrachter, Bearbeiter, Freigeber, Verwalter | | | `viewer`, `editor`, `approver`, `admin` |
| globaler Verwalter | | | `globalAdmin` |
| **API-Schlüssel** | `/api-schluessel` | `/api-keys` | `apiKey` |
| technischer Benutzer | | | `technicalUser` |
| **Einstellungen** | `/einstellungen` | `/settings` | `settings` |
| **Thema** (Hell/Dunkel) | `/thema` | `/theme` | `theme` |
| **Betrieb** (Betriebsstatus) | `/betrieb` | `/operations` | `operations` |
| **Gesundheit** | `/gesundheit` | `/health` | |
| **Umgebung** | `/umgebung` | `/environment` | `environment` |
| **Ich** (eigene Person) | `/ich` | `/me` | |
| **MCP-Transport** (Managed Hosting) | | `/mcp` | Werkzeugnamen in `snake_case`, z. B. `get_fund_metric`. Der Rechenweg steht in `calculation.steps` mit `sign`, `label` und `value`. |
| **Änderungen** (Änderungsabfrage) | `/aenderungen` | `/changes` | `changedSince` |
| Änderungsprotokoll | | `/audit-log` | `auditLog` |
| **Webhooks** (#154) | | `/webhooks` | `webhook`, `webhookId` |
| Zustellung (eines Webhooks) | | `…/deliveries` | `delivery`, `deliveryId` |
| Geheimnis (Signatur) erneuern | | `…/rotate-secret` | `secret` |
| Testereignis | | `…/test` | |
| **Live** (Live-Aktualisierung, #161) | | `/live` | |
| Abonnement (Live) | | | `subscribe`, `tables` |
| Sitzung | `/konto/sitzungen` | `/account/sessions` | `session` |
| zweiter Faktor | `/konto/zwei-faktor` | `/account/two-factor` | `twoFactor` |
| Wiederherstellungscodes | | `/account/recovery-codes` | `recoveryCodes` |
| **Werteschlüssel** (Excel) | `/werte-schluessel` | `/value-keys` | `valueKey` |
| **Werte** (Excel) | `/werte` | `/values` | `values` |
| **Excel** | `/excel` | `/excel` | |
| Fondsliste der Werte | `/werte/fonds` | `/values/funds` | |
| Verzeichnis der Werte | `/werte/kennzahlen` | `/values/metrics` | `scope`, `key`, `unit` |
| Einzelwert | `/werte/wert` | `/values/value` | |
| Wertzeile | | | `value`, `unit`, `currency` |
| Kapitalkonten der Werte | `…/kapitalkonten` | `…/capital-accounts` | |
| Schlüssel anzeigen, Vorschau | | | `key`, `preview` |
| Ablauf, zuletzt genutzt, widerrufen | | | `expiresAt`, `lastUsedAt`, `revokedAt` |
| Status eines Schlüssels | `aktiv`, `abgelaufen`, `widerrufen` | | `active`, `expired`, `revoked` |
| Berechtigung eines Schlüssels | `lesen`, `schreiben` | | `read`, `write` (`permission`) |
| Betriebsstatus Gesamtampel | `ok`, `warnung`, `fehler` | | `ok`, `warning`, `error` (`status`) |
| Worker-Zustand | `ok`, `ausgefallen`, `unbekannt` | | `ok`, `down`, `unknown` |
| Umgebung `echt` | `echt` | | `production` |
| Thema | `hell`, `dunkel` | | `light`, `dark` |
| Stufe je Bereich (ohne Fonds, je Fonds) | `stufeOhneFonds…`, `bereicheJeFonds` | | `levelWithoutFund`, `levelWithoutFundPerArea`, `areaLevelsPerFund` |
| Bereiche der Anwendung | `finanzen`, `kennzahlen`, `berichte`, `meldewesen`, `kontakte`, `dokumente`, `daten`, `fondsverwaltung` | | `finance`, `metrics`, `reports`, `regulatory_reporting`, `contacts`, `documents`, `data`, `fund_administration` (`portfolio`, `dealflow` bleiben) |
| Einladung, ausstehend | | | `invitation`, `invitationPending`, `invited` |
| Investor-Benutzer (Portal) | | | `investor` |
| Zugriffsquelle einer Fondsrolle | `eigene`, `gruppe` | | `own`, `group` |
| Kalenderlink | `…/kalender-link` | `…/calendar-link` | `calendarLink` |

### Fonds, Kapital, Investoren, Portal (#185)

| Deutsch | Heute | Pfad | Feld |
|---|---|---|---|
| **Fonds** | `/fonds` | `/funds` | `fund`, `fundId` |
| Kurzname | | | `shortName` |
| Auflagejahr | | | `vintage` |
| Fondsvolumen / Zeichnungskapital | | | `fundSize` / `subscribedCapital` |
| Zusage | | `/commitments` | `commitment` |
| Zusageänderung | `…/zusageaenderungen` | `…/commitment-changes` | |
| Zeichnung | `…/zeichnungen` | `…/subscriptions` | `subscription` |
| Closing | `…/closings` | `…/closings` | `closing` |
| Austritt (LP) | `…/austritte` | `…/withdrawals` | `withdrawal` |
| Kapitalabruf | | `/capital-calls` | `capitalCall` |
| Ausschüttung | | `/distributions` | `distribution` |
| Fondsbewegung, Kapitalbewegung | `/fondsbewegungen`, `…/bewegungen` | `/fund-movements`, `…/movements` | `movement`, `movementId` |
| Zahlung | `…/zahlungen` | `…/payments` | `payment`, `paymentId` |
| Fälligkeit | | | `dueDate` |
| Valuta | | | `valueDate` |
| Kapitalkonto | `…/kapitalkonten` | `…/capital-accounts` | `capitalAccount` |
| Verwaltungsvergütung, Fondskosten (Kostenbuchung) | `…/kosten` | `…/fees-and-expenses` | `managementFee`, `fundExpenses`, `allocation`, `rate` |
| Netto-IRR des Investors | | | `netIrr` |
| Journal | `…/journal` | `…/journal` | |
| NAV, Einzelwerte | `…/nav-einzelwerte` | `…/nav-components` | `nav` |
| Fondsübersicht | `…/uebersicht` | `…/overview` | |
| Periodensperre | `…/periodensperre` | `…/period-lock` | `lockedUntil` |
| **Investoren** (Investor-Benutzer) | `/investoren` | `/investors` | `investor`, `investorId` |
| Investorenzugang | `…/investorenzugaenge` | `…/investor-access` | `investorAccess` |
| Mitteilung (an Investoren) | `…/mitteilungen` | `…/notices` | `notice` |
| **Portal** (LP-Portal) | `/portal` | `/portal` | |
| **Vehikel** | `/vehikel` | `/vehicles`, `/organizations/{id}/vehicles` | `vehicle`, `vehicleId`, `inceptionYear` |
| **Tranchen** | `/tranchen` | `/tranches` | `tranche`, `trancheId` |
| **Zinsläufe** | `/zinslaeufe` | `/interest-runs` | `interestRun` |
| Zinsperiode | | | `interestPeriod` |
| Abgrenzung (Zinsen) | `…/abgrenzung` | `…/accruals` | `accrual` |
| **Forderungen** | `/forderungen` | `/receivables` | `receivable` |
| **Wechselkurse** | `/wechselkurse` | `/exchange-rates` | `exchangeRate`, `rate` |
| Währung, Währungssicht | `…/waehrung`, `…/waehrungssicht` | `…/currency`, `…/currency-view` | `currency`, `reportingCurrency` |
| **Szenarien** | `/szenarien` | `/scenarios` | `scenario`, `scenarioId` |
| Annahme | | | `assumptions` |
| Reserve | `…/reserve`, `…/reserven` | `…/reserve`, `…/reserves` | `reserve` |
| festschreiben | `…/festschreiben` | `…/lock` | `locked` |
| Zielfonds (Dachfonds), Zielfondsbeteiligung | `…/target-funds` (neu, schon englisch) | `…/target-funds` | `targetFundId`, `targetFundName` |
| Bewegung eines Zielfonds: Zusage, Kapitalabruf, Ausschüttung | `…/movements` (neu, schon englisch) | `…/movements` | `type` (`commitment`, `capital_call`, `distribution`), `valueDate`, `amount`, `reversesId` |
| Meldung eines Zielfonds (NAV, Anteil) | `…/nav-reports` (neu, schon englisch) | `…/nav-reports` | `asOf`, `nav`, `share` |
| Wertansatz eines Zielfonds | | | `method` (`look_through`, `reported_nav`, `cost`), `called`, `unfunded`, `distributed` |
| **Manager-Profil**, Hauswährung | `/manager-profile` (neu, schon englisch) | `/manager-profile` | `homeCurrency`, `managerName` |
| **Portfolio-Dashboard**, Allokation, Verlauf | `/portfolio/dashboard` (neu, schon englisch) | `/portfolio/dashboard` | `allocation`, `history`, `totals`, `internalHoldings`, `eliminated`, `fairValue`, `invested`, `paidIn` |
| Portalzugänge eines Fonds | `…/investorenzugaenge/zugaenge` | `/funds/{fundId}/investor-access/access` | `organizations`, `organizationId`, `userId` |
| Portalprofil, Konten, Berichte und Mitteilungen | `…/ich`, `…/kapitalkonto`, `…/berichte`, `…/dokumente` | `/portal/me`, `/portal/funds/{id}/capital-accounts`, `/portal/funds/{id}/reports`, `/portal/documents` | `accounts`, `history`, `previousVersion`, `nextVersion` |
| Storno und Korrektur eines Closings | `…/storno`, `…/korrektur` | `…/reverse`, `…/correct` | `effectiveDate`, `equalizationAmount`, `newCommitment` |
| Zeichnungen, Zusageänderungen, Austritt | | `…/investor-access/subscriptions`, `…/investor-access/commitment-changes` | `subscriptions`, `commitments`, `type` (`closing`, `decrease`, `withdrawal`) |
| Neuberechnung, Kapitalstand und Herkunft | `…/neuberechnen`, `…/kapitalstand`, `…/herkunft` | `…/recalculate`, `…/movements/capital-position`, `…/movements/sources` | `sourceKnowledgeDate`, `supportingDocuments` |
| Kostenverteilung | | | `allocation` (`by_basis`, `manual`), `allocationBasis` (`commitment`, `share`), `allocations` |
| Journalfilter | | `…/journal` | `from`, `to`, `entryType` (kommasepariert), `direction` (`asc`, `desc`), `valuations` |
| Forderung begleichen | `…/erfuellt` | `/receivables/{id}/settle` | `date`, `receivable` |
| Wechselkursdatei und Kurslücke | | `/exchange-rates/import` | `exchangeRate`, `format` (`ecb`, `long`), `reason` (`missing_rate`, `stale_rate`) |
| Szenariovorlage, Vergleich und Bericht | `…/vorlage`, `…/vergleich`, `…/bericht` | `…/scenarios/template`, `…/scenarios/comparison`, `…/scenarios/report` | `baseDate`, `findings`, `status` (`draft`, `locked`) |

### Buchhaltung (#186)

| Deutsch | Heute | Pfad | Feld |
|---|---|---|---|
| Buchhaltung | `…/buchhaltung` | `…/accounting` | `accounting` |
| **Belege** | `/belege` | `/vouchers` | `voucher`, `voucherId` |
| Belegart | `…/belegarten` | `…/voucher-types` | `voucherType` |
| Belegvorlage | `…/belegvorlagen` | `…/voucher-templates` | |
| Freigabestufe | `…/freigabestufen` | `…/approval-stages` | `stage` |
| Buchung, buchen | `…/buchungen`, `…/buchen` | `…/postings`, `…/post` | `posting`, `postedAt` |
| Buchungstext | | | `postingText` |
| Buchungsregel | `…/buchungsregeln` | `…/posting-rules` | `postingRule` |
| **Buchungsexporte** | `/buchungsexporte` | `/posting-exports` | `postingExport` |
| Sachkonto, Konto | `…/konten` | `…/accounts` | `account`, `accountNumber` |
| Gegenkonto | | | `contraAccount` |
| **Kontenregeln** | `/kontenregeln` | `/account-rules` | `accountRule` |
| Gliederung | `…/gliederung` | `…/layout` | `layoutItem` |
| Mittelart | `…/mittelarten` | `…/funding-sources` | `fundingSource` |
| **Saldenläufe** | `/saldenlaeufe` | `/balance-runs` | `balanceRun` |
| Summen- und Saldenliste | | | `trialBalance` |
| Abstimmung | `…/abstimmung` | `…/reconciliation` | |
| Auswertung | `…/auswertung` | `…/evaluation` | |
| Periode | `…/perioden` | `…/periods` | `period`, `periodStart`, `periodEnd` |
| **Vorgänge** | `/vorgaenge` | `/transactions` | `transaction`, `transactionId` |
| Storno, stornieren | `…/storno` | `…/reverse` | `reversal`, `reversedAt` |
| **Stapel** | `/stapel` | `/batch` | `operations` |
| Buchhaltungsschlüssel einer Beteiligung | `…/buchhaltungsschluessel` | `…/accounting-keys` | `projectNumber`, `contractNumber`, `partnerNumber`, `companyCode` |
| Referenz eines Belegs | | | `referenceType`, `referenceId` |
| Eigene Belegart, Basisart | | | `customTypeId`, `baseType` |
| Feldwerte, neu befüllen | `…/feldwerte`, `…/neu-befuellen` | `…/field-values`, `…/refill` | `values`, eigene Schlüssel mit `custom_` |
| Prüfung und Freigabe eines Belegs | `…/stufe` | `…/stage` | `stage` (`review`, `approval`), `result` (`ok`, `returned`) |
| Tranche einer Auszahlung | | | `trancheId` |
| Dateiname eines Belegs oder Exports, Name der hochgeladenen Saldenliste | | | `fileName`, `sourceFileName` |
| Kontenbereich | | | `accountFrom`, `accountTo`, `itemKey` |
| Soll und Haben | | | `debit`, `credit` |
| Bilanz, GuV, Liquidität, Mittelverwendung | | `…/evaluation/{view}` | `balance_sheet`, `income_statement`, `liquidity`, `use_of_funds` |
| Saldenliste hochladen, prüfen und übernehmen | | `…/balance-runs`, `…/validate`, `…/apply` | `file`, `periodFrom`, `periodTo` |
| Buchungsexport erstellen und Vorschau | | `…/posting-exports`, `…/posting-exports/preview` | `interestRunId`, `transactionIds`, `fundMovementIds`, `repeat` |
| Operation im Stapel | | | `method`, `path`, `body`, Antwort unter `results` |

### Beteiligungen, Runden, Bewertungen, Kennzahlen (#187)

| Deutsch | Heute | Pfad | Feld |
|---|---|---|---|
| **Beteiligungen** | `/beteiligungen` | `/investments` | `investment`, `investmentId` |
| Erstinvestment, Folgeinvestition | | | `initialInvestment`, `followOnInvestment` |
| **Instrumente** | `/instrumente` | `/instruments` | `instrument`, `instrumentId` |
| Wandeldarlehen | | | `convertible_loan` (Enum) |
| SAFE | | | `safe` (Enum) |
| Optionsschein, Ausübungspreis, Laufzeit | | | `warrant` (Enum), `warrantShares`, `exercisePrice`, `issuedOn`, `expiresOn` |
| Ausübung (Optionsscheine) | `…/exercises` (neu, schon englisch) | `…/exercises` | `exercise`, `shares`, `pricePerShare`, `amount`; Storno `…/exercises/:exerciseId/reverse` mit `reason` |
| Anteilsübertragung (Secondary), Käufer, Verkäufer, Quelle | `…/share-transfers` (neu, schon englisch) | `…/share-transfers` | `shareTransfer`, `buyerFundId`, `buyerVehicleId`, `buyerOrganizationId`, `seller`, `buyer`, `source`; Storno `…/share-transfers/:transferId/reverse` mit `reason`, `reversedAt` |
| Kondition | `…/konditionen` | `…/terms` | `terms` |
| Wandlung | `…/wandlung` | `…/conversion` | `conversion` |
| Verkauf | `…/verkauf`, **`/verkaeufe`** | `…/sale`, `/sales` | `sale`, `saleId` |
| Kaufpreis, Kaufpreisanpassung | `…/kaufpreisanpassung` | `…/purchase-price-adjustment` | `purchasePrice` |
| Insolvenz | `…/insolvenz` | `…/insolvency` | |
| Jahresüberschuss | `…/jahresueberschuss` | `…/net-income` | `netIncome` |
| Kapitaltabelle | `…/kapitaltabelle` | `…/cap-table` | |
| Wasserfall | `…/wasserfall` | `…/waterfall` | |
| **Finanzierungsrunden** | `/finanzierungsrunden` | `/financing-rounds` | `round`, `roundId` |
| **Rundenpositionen** | `/rundenpositionen` | `/round-positions` | `position`, `positionId` |
| Rundentransaktionen | `…/rundentransaktionen` | `…/round-transactions` | |
| Anteilsklasse | `…/anteilsklassen` | `…/share-classes` | `shareClass` |
| Mitarbeiterpool, Zuteilung | `…/mitarbeiterpools`, `…/zuteilungen` | `…/employee-pools`, `…/grants` | `pool`, `grant` |
| Pre-/Post-Money | | | `preMoney`, `postMoney` |
| Preis je Anteil | | | `pricePerShare` |
| **Bewertungen** | `/bewertungen` | `/valuations` | `valuation`, `valuationId` |
| **Bewertungsrunden** | `/bewertungsrunden` | `/valuation-rounds` | `valuationRound` |
| **Kennzahlen** | `/kennzahlen` | `/metrics` | `metric`, `metricKey`, `metricKeys` |
| Kennzahlenabfrage | `…/abfragen` | `…/metric-requests` | `metricRequest` |
| Katalog | `…/katalog` | `…/catalog` | |
| **Meilensteine** | `/meilensteine` | `/milestones` | `milestone`, `milestoneId` |
| **Register** (Handelsregister) | `/register` | `/register` | `registerEntry` |
| Gremienmandat (Beirat, Aufsichtsrat, Board) | `…/mandate` | `…/board-mandates` | `boardMandate`, `body`, `role`, `startDate`, `endDate` |
| Bekanntmachung | `…/ereignisse` | `…/events` | `event` |
| Instrumentdaten, Zinsen | `…/instrumentdaten`, `…/zinsen` | `…/instrument-data`, `…/interest` | `interest`, `interestOutstanding` |
| Tranche am Instrument | `…/tranchen` | `…/tranches` | `tranche`, `scheduledDate` |
| Bedingungen einer Tranche erfüllen | `…/erfuellt` | `…/fulfill` | `fulfilledAt`, `evidence` |
| Finanzierungsrunde abschließen, wiedereröffnen | `…/abschliessen`, `…/wiedereroeffnen` | `…/close`, `…/reopen` | `closedAt`, `reopenedAt` |
| Positionen, Zahlungen, Pool-Aufstockung | `…/positionen`, `…/zahlungen` | `…/positions`, `…/payments` | `positions`, `paymentId`, `poolTopUp` |
| Bewertungsfreigabe, verwerfen | `…/freigeben`, `…/verwerfen` | `…/approve`, `…/discard` | `approvedAt`, `approvedBy` |
| Kennzahlenwert, Auswahl, Übersicht | `…/werte`, `…/auswahl`, `…/uebersicht` | `…/values`, `…/selection`, `…/overview` | `value`, `valueType`, `frequency` |
| Kennzahlenanfrage bestätigen, widerrufen, erneuern, versenden | `…/bestaetigen`, `…/widerrufen`, `…/neuer-link`, `…/per-mail` | `…/confirm`, `…/revoke`, `…/renew-link`, `…/send-email` | `confirmedAt`, `revokedAt`, `link` |
| ESG-Zeitreihe und Fragebogen zur Beteiligung | `…/esg`, `…/esg/abfragen` | `…/esg`, `…/esg/metric-requests` | `dataPoints`, `completeness`, `metricRequest` |
| Registereintrag, Beobachtung und Meldungen | `…/eintraege`, `…/beobachtung`, `…/meldungen` | `…/entries`, `…/monitoring`, `…/notifications` | `registerType`, `registerEntryId` |

Instrumentarten sind `direct_equity`, `silent_participation`, `loan`, `convertible_loan`, `venture_debt`, `shareholder_loan`, `safe` und `warrant`.
Instrumentstatus sind `active`, `converted`, `repaid`, `sold` und `written_off`. Finanzierungsrunden unterscheiden `equity` und `bridge`.
Eine Quelle für die Anteilsübertragung ist die ID einer Zeile der Kapitaltabelle (`common`, die UUID einer Rundenposition,
`share-transfer:<id>` oder `warrant-exercise:<id>`).

Mitgelieferte Katalogschlüssel sind Englisch, zum Beispiel `revenue`, `cash_position`, `monthly_cash_burn`, `employee_fte`,
`customer_count` und `esg_ghg_scope1`. Die Schlüssel eigener Kennzahlen bleiben erhalten. Kollisionen mit einem mitgelieferten
Namen und eigene Schlüssel mit dem Präfix `custom_` erhalten in der Schnittstelle ein zusätzliches Präfix `custom_`.


### Berichte, Meldewesen, Beschlüsse, Dokumente (#188)

| Deutsch | Heute | Pfad | Feld |
|---|---|---|---|
| **Berichte** | `/berichte` | `/reports` | `report`, `reportId` |
| Berichtsart | | | `reportType` |
| Berichtsvorlage | `…/berichtsvorlagen` | `…/report-templates` | |
| Abschnitt | `…/abschnitte` | `…/sections` | `section` |
| Berichtigung | `…/berichtigung` | `…/correction` | |
| Kontrolle (Kontrollbericht) | `…/kontrolle` | `…/checks` | `checks` |
| Stufe (Freigabe) | `…/stufe` | `…/stage` | `stage` |
| Gremienvorlage | `…/gremienvorlage` | `…/committee-pack` | |
| **Meldedefinitionen** | `/meldedefinitionen` | `/reporting-definitions` | `reportingDefinition` |
| **Meldeläufe** | `/meldelaeufe` | `/reporting-runs` | `reportingRun` |
| Meldedaten | `…/meldedaten` | `…/reporting-data` | |
| **Förderprogramme** | `/foerderprogramme` | `/funding-programs` | `fundingProgram` |
| **Beschlussvorlagen** | `/beschlussvorlagen` | `/resolution-templates` | |
| Beschluss | `…/beschluesse` | `…/resolutions` | `resolution` |
| **Dokumente** | `/dokumente` | `/documents` | `document`, `documentId` |
| Verknüpfung, Ziel | `…/verknuepfungen` | `…/links` | `link`, `target` |
| Klassifikation | | | `classification` |
| vertraulich | | | `confidential` |
| Texterkennung | `…/texterkennung` | `…/ocr` | |
| Aufbewahrung | `…/aufbewahrung` | `…/retention` | `retention` |
| **Auslesungen** (KI) | `/auslesungen` | `/extractions` | `extraction` |
| **KI** | `/ki` | `/ai` | |
| Art der Auslesung: Kennzahlenbericht, Cap Table | `kennzahlenbericht`, `captable` | | `metrics_report`, `cap_table` |
| Anhang einer Mail an die Auslesung übergeben | | `/activities/{id}/attachments/{attachmentId}/extraction` | `type`, `confidentialApproved`, `documentId`, `extractionId`, `suggestion`, `warnings` |
| Zuordnung zum Kennzahlenkatalog, Abgleich mit der Kapitaltabelle (Prüfhilfen der Auslesung) | | | `mapping`, `reconciliation`. Mit `organizationId` lässt sich das Unternehmen für den Abgleich wählen. |
| Fehlercodes des Dokumenteneingangs per Mail | | | `inbox_mail_not_incoming`, `inbox_sender_unknown`, `inbox_sender_not_allowed`, `inbox_attachment_type_not_allowed`, `inbox_attachment_too_large` |
| ESG, Offenlegung (SFDR) | `…/esg`, `…/offenlegung` | `…/esg`, `…/disclosure` | `disclosure` |
| **Export** | `/export` | `/export` | |
| **Import**, Importlauf | `/import`, `/import/laeufe` | `/import`, `/import/runs` | `importRun` |
| Befund | `…/befunde` | `…/findings` | `finding`, `severity` |
| Fondsbericht, Portfolioliste, Quartalsbericht | | `/funds/{id}/reports/fund-report`, `…/portfolio-list`, `/investments/{id}/reports/quarterly-report` | `asOf`, `knowledgeDate`, `language`, `format` |
| Währungssicht bei Berichten | | | `currencyView` (`fund`, `local`, `comparison`), `comparisonCurrency` |
| Berichtsarten | | | `reportType`: `fund_report`, `quarterly_report`, `lp_report`, `committee_pack`, `portfolio_list`, `exit_list`, `pai_statement`, `scenario_report` |
| Berichtsstatus und Freigabe | | `…/stage` | `status`: `draft`, `reviewed`, `approved`; `stage`, `result` (`ok`, `returned`), `comment`, `overrideChecks` |
| Berichtsvorlage und Vorjahrestexte | | `/funds/{id}/report-templates/{reportType}` | `configuration`, `sections`, `metrics`, `columns`, `companyMetrics`, `customFields`, `copyPriorYearText` |
| Datenherkunft und Eingaben im Meldelauf | | `…/provenance`, `…/inputs` | `key`, `value` |
| Definition prüfen, Versionen und Zuordnungen | | `/reporting-definitions/validate`, `…/{key}/versions`, `/funds/{id}/reporting-assignments` | `definition`, `frequency`, `validFrom`, `validTo`, `fundingProgram` |
| Dateidownload eines Meldelaufs | | `/reporting-runs/{id}/file` | `type`: `submission`, `review_view` |
| Beschlussvorlage | | `/resolution-templates` | `fundId`, `text`, `placeholders`, z. B. `{{organization}}` und `{{date}}` |
| Dokument hochladen, ersetzen und herunterladen | | `/documents`, `…/{id}/replace`, `…/{id}/file` | Multipart `file`, `targets` (JSON-Liste aus `{ type, id }`), `classification`, `confidential`; Filter `targetType` und `targetId`, Dateiprüfsumme in `X-File-Sha256` |
| Dokumentklassifikation | | | `contract`, `resolution`, `valuation`, `report`, `voucher`, `other_document` |
| Importvorlage, Prüfung, Übernahme und Protokoll | | `/import/template`, `/import/runs/{id}/validate`, `…/apply`, `…/log` | `language`, `file`, `severity`, `sheet`, `cursor`, `nextCursor` |
| KI-Auslesung, bestätigen, verwerfen | | `/documents/{id}/extractions`, `/extractions/{id}/confirm`, `…/discard` | `type`: `investment_agreement`, `loan_agreement`, `valuation_evidence`, `register_extract`; `pages`, `allowConfidential`, `citations` |
| KI-Kontaktergänzung | | `/ai/contacts/settings`, `…/participation`, `…/suggestions` | `aiEnabled`, `signatures`, `website`, `entityType`, `source` |
| ESG-Übersicht und SFDR-Einordnung | | `/funds/{id}/esg/overview`, `…/esg/pai`, `/funds/{id}/disclosure` | `year`, `coverage`, `indicators`, `classification` (`article_6`, `article_8`, `article_9`) |

Der Dokumentenstart, die Liste und die Bestätigung der Auslesungen behalten bis #188 ihre bisherigen Pfade und Eingabeformate.
Die neuen Prüfhilfen und die Bestätigung von Kennzahlenberichten verwenden die öffentlichen Kennzahlenschlüssel (`metricKey`).

### Kontakte, Deals, Aktivitäten, Postfach (#189)

| Deutsch | Heute | Pfad | Feld |
|---|---|---|---|
| **Organisationen** | `/organisationen` | `/organizations` | `organization`, `organizationId` |
| **Personen** | `/personen` | `/people` | `person`, `personId` |
| Vorname, Nachname | | | `firstName`, `lastName` |
| **Kontaktrollen** | `/kontaktrollen` | `/contact-roles` | `contactRole` |
| **Organisationsbeziehungen** | `/organisationsbeziehungen` | `/organization-relationships` | `relationship` |
| Beschäftigung | `…/beschaeftigungen` | `…/employments` | `employment`, `jobTitle`, `primary` |
| Firmenart, Sitz, Rechtsform | | | `kind` (`company`, `investor`, `advisor`, `other`), `city`, `legalForm` |
| Dublette, zusammenführen | `…/dubletten`, `…/zusammenfuehren` | `…/duplicates`, `…/merge` | `mergedInto` |
| **Kontaktimport** | `/kontaktimport` | `/contact-import` | |
| **CRM**, Objekt, Datensatz | `/crm`, `…/objekte`, `…/datensaetze` | `/crm`, `…/objects`, `…/records` | `object`, `record` |
| eigenes Feld (Zusatzfeld) | **`/zusatzfelder`**, `…/felder` | `/custom-fields/{object}/definitions`, `/custom-fields/{object}/schema`, `…/fields` | `customFields`, `values` |
| Instrumentfelder einer Beteiligung | `…/instrumentfelder` | `/investments/{id}/instrument-fields` | `instrumentId` |
| Abfrage, Gruppierung, Sortierung | `…/abfrage`, `…/gruppen` | `…/query`, `…/groups` | `groupBy`, `columns`, `sort`, `direction` (`asc`, `desc`) |
| Aufgabe, Fälligkeit | `…/aufgaben` | `…/tasks` | `dueDate`, `assigneeId` |
| Liste, Ansicht | `…/listen`, `…/ansichten` | `…/lists`, `…/views` | `list`, `view` |
| Massenaktion | `…/massenaktion` | `…/bulk-actions` | |
| **Dealflow**, Arbeitsliste, Trichter | `/dealflow`, `…/arbeitsliste`, `…/trichter` | `/dealflow`, `…/worklist`, `…/funnel` | `stageHistory`, `timeInStage` |
| Kartenfelder | `…/kartenfelder` | `…/card-fields` | `fields` |
| Zuordnung, Wiederaufnahme, Beschluss | `…/zuordnung`, `…/wiederaufnahme`, `…/beschluesse` | `…/assignment`, `…/reopen`, `…/resolutions` | `investmentManagerId`, `projectLeadId`, `outcome` |
| **Deals**, Phase | `/deals` | `/deals` | `deal`, `stage` |
| Absage | `…/absage` | `…/decline` | |
| **Aktivitäten** | `/aktivitaeten` | `/activities` | `activity` |
| Anhang | `…/anhaenge` | `…/attachments` | `attachment` |
| **Wiedervorlagen** | `/wiedervorlagen` | `/follow-ups` | `followUp` |
| zuständig | `…/zustaendige` | `…/assignees` | `assigneeId` |
| erledigen | `…/erledigen` | `…/complete` | `completedAt` |
| **Termine** | `/termine` | `/meetings` | `meeting` |
| **Kalender** | `/kalender` | `/calendar/{file}` | Abonnement als ICS |
| **Mail**, Ausgangskorb | `/mail/auftraege` | `/mail/jobs` | `outbox`, `status` (`pending`, `sent`, `failed`) |
| **Postfach**, Rückruf, abgleichen | `/postfach`, `…/rueckruf`, `…/abgleichen` | `/mailbox`, `…/callback`, `…/sync` | `mailbox`, `provider`, `storeContent`, `lastSyncedAt` |
| **Kontaktvorschläge** (aus Postfach und Kalender), übernehmen, verwerfen; Teilnahme, Sperrliste | `/kontaktvorschlaege`, `…/uebernehmen`, `…/verwerfen`, `/postfach/kontakte` | `/contact-suggestions`, `…/accept`, `…/dismiss`, `/mailbox/contacts` | `contactSuggestion`, `participating`, `blocklist` |
| **Suche** | `/suche` | `/search` | `q` |
| **Extern** (Abfragelink), einreichen | `/extern/abfragen`, `…/einreichen` | `/external/requests/{token}`, `…/submit` | `token`, `metrics`, `values` |

CRM-Systemfelder haben öffentliche Schlüssel wie `firstName`, `stage` und `fundId`. Diese gelten im Feldkatalog, in Zeilen und in
Ansichten, Filtern und Sortierungen. Filtergruppen verwenden `conjunction` (`and`, `or`) und `conditions`, Bedingungen verwenden
`field`, `operator` und `value` (zum Beispiel `is`, `contains`, `greater_than`). Gespeicherte Ansichten werden beim Lesen
auf die öffentlichen Namen abgebildet. Felddefinitions-IDs und selbst vergebene Optionsschlüssel gelten unverändert.
Eigene Felder für Fonds, Beteiligungen, Vorgänge und Runden liegen unter `/funds/{id}/fields`, `/investments/{id}/fields`,
`/transactions/{id}/fields` und `/financing-rounds/{id}/fields`. `knowledgeDate` wählt beim Lesen einen früheren Wissensstand.
Ja/Nein-Kennzahlen in der externen Abfrage verwenden die Zeichenketten `yes` und `no`.

### Excel-Werte: Kennzahlen und Funktionen (#184, #167)

Die Werte der Excel-Schnittstelle heißen `camelCase`; der Vergleich beachtet weder Schreibweise noch Leerzeichen, Unter- und Bindestriche.
Die Excel-Funktionen tragen die Begriffe der Schnittstelle (`CARRAWAY.METRIC(fund, metric, [asOf], [knowledgeDate])`,
`CARRAWAY.INVESTMENT(fund, company, metric, …)`, `CARRAWAY.INSTRUMENT(fund, company, instrument, metric, …)`,
`CARRAWAY.CAPITAL_ACCOUNT(fund, investor, metric, …)`, `CARRAWAY.CURRENCY(fund)`).

| Deutsch | Heute | Name |
|---|---|---|
| Fonds-Kennzahlen | `tvpi`, `dpi`, `rvpi`, `irr`, `nav` | unverändert |
| eingezahlt, offen, überfällig, ungeklärt | `eingezahlt`, `offen`, `ueberfaellig`, `ungeklaert` | `paidIn`, `outstandingCalls`, `overdueCalls`, `unconfirmedPayments` |
| abgerufen, Ausschüttungen, Zeichnungskapital | `abgerufen`, `ausschuettungen`, `zeichnungskapital` | `calledCapital`, `distributions`, `subscribedCapital` |
| investiert, Rückflüsse, Bewertung | `investiert`, `rueckfluesse`, `bewertung` | `invested`, `proceeds`, `valuation` |
| Zusage, ausgezahlt, offene Zusage | `zusage`, `ausgezahlt`, `offenezusage` | `commitment`, `paidOut`, `unfundedCommitment` |
| offenes Kapital, Tilgungen, Buchwert | `offeneskapital`, `tilgungen`, `buchwert` | `outstandingPrincipal`, `repayments`, `carryingAmount` |
| Zinsen gebucht, kapitalisiert, gezahlt, gewandelt, offen | `zinsengebucht`, `zinsenkapitalisiert`, `zinsengezahlt`, `zinsengewandelt`, `zinsenoffen` | `interestBooked`, `interestCapitalized`, `interestPaid`, `interestConverted`, `interestOutstanding` |
| Dividenden | `dividenden` | `dividends` |
| Anteil, abgerufen in Prozent, ausgeschüttet, NAV-Anteil | `anteil`, `abgerufenquote`, `ausgeschuettet`, `navanteil` | `share`, `calledRatio`, `distributed`, `navShare` |
| Einheit Betrag, Quote, Zahl, Ja/Nein | `betrag`, `anteil`, `zahl`, `ja_nein` | `amount`, `ratio`, `number`, `yes_no` |
| Bereich der Werte | `fonds`, `beteiligung`, `instrument`, `kapitalkonto` | `fund`, `investment`, `instrument`, `capital_account` |

Die Werte-Antworten verwenden für Instrumente dieselben Arten und Status wie `/instruments` (`convertible_loan`, `active` …).
Für Kennzahlen des Katalogs gelten deren öffentliche Schlüssel. Die Excel-Funktionen vergleichen auch diese Schlüssel ohne Beachtung von Schreibweise und Trennzeichen.

Die Matrixfunktionen heißen `FUNDS`, `INVESTMENTS`, `KPIS`, `ROUNDS`, `ROUND_POSITIONS` und `INVESTORS`. Die Routen der Datenblätter verwenden
`mode` (`snapshot`, `history`, `events`), `asOf`, `knowledgeDate`, `from` und optional `investment`.
Schreibschlüssel haben `permission: "write"`. Ein Prüflauf (`writeRun`) liefert `runId`, `rows` mit `before`, `after` und `findings`,
sowie nach Freigabe `appliedAt`, `appliedBy` und `result`. Der Endpunkt `acceptance-report` liefert das Abnahmeprotokoll.
Bewertungsanteile heißen `equityValue` und `debtValue`. `preview_changed` und `preview_expired` verlangen einen neuen Prüflauf.

### Allgemeine Feldnamen

| Deutsch | Feld |
|---|---|
| Stichtag | `asOf` |
| Wissensstand (`stand`) | `knowledgeDate` |
| geändert seit | `changedSince` |
| gültig ab / bis | `validFrom` / `validTo` |
| Zeitraum von / bis | `periodFrom` / `periodTo` |
| von / bis (Datum) | `from` / `to` |
| Betrag, Betrag lokal | `amount`, `localAmount` |
| Währung | `currency` |
| Satz, Quote, Anteil | `rate`, `ratio`, `share` |
| Anzahl | `count` |
| Bezeichnung, Name, Titel | `label`, `name`, `title` |
| Beschreibung, Bemerkung, Kommentar, Notiz | `description`, `remark`, `comment`, `note` |
| Art, Typ | `type` (bzw. `kind`, wenn `type` belegt ist) |
| Status | `status` |
| Schlüssel | `key` |
| Datei, Dateiname | `file`, `fileName` |
| Sprache | `language` |
| Reihenfolge, Sortierung | `order`, `sort` |
| aktiv, archiviert | `active`, `archived` |
| Grund, Begründung | `reason` |
| Quelle, Herkunft | `source`, `origin` |
| erfasst am, angelegt von | `recordedAt`, `createdBy` |
| Version | `version` |
| Vorschau | `preview` |
| Seite (Paginierung) | `cursor`, `limit` |
