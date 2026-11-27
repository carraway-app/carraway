# Company register data access

Research as of 20 November 2026. The review covered documentation and legal sources and submitted no register forms. This page records a technical assessment only.

## Decision

Carraway **does not fetch register portals automatically**. Register data enters the application through the following channels.

1. **Manual entry** on the company record.
2. **Official extract uploaded as a document** (stage 13). A person retrieves and uploads the extract and enters the fields manually. AI extraction of register fields is outside this stage.
3. **Structured import file** (CSV or JSON) for bulk updates, for example from an extract or a licensed data source.
4. **Provider integration** through the `RegisterAnbieter` interface (`suche`, `abruf`). Carraway ships only a test provider. An adapter for a contracted provider can be added once reuse rights are clear.

## Findings

| Channel | Finding | Source |
|---|---|---|
| Joint register portal of the German states | Individual lookups for informational purposes are permitted under section 9(1) HGB. According to quotations from the terms of use, the portal prohibits more than 60 searches or retrievals per hour and systematic retrieval to build parallel registers. The review found no official machine interface. | https://www.gesetze-im-internet.de/hgb/__9.html, https://github.com/bundesAPI/handelsregister (quotes the portal FAQ), https://www.ihk.de/koeln/hauptnavigation/recht-steuern/recht/gefahr-missbrauch-registerdaten-5644100 |
| Fees | Search and online publications are freely accessible. Other retrievals incur fees under the JVKostG. The sources disagree on amounts. Check them before use. | https://www.gesetze-im-internet.de/jvkostg/anlage.html |
| Company Register (Unternehmensregister) | The terms contain no rule on automated queries and specify no retrieval interface. Access to deposited financial statements incurs a fee. | https://www.bundesanzeiger.de/pub/D088.pdf |
| High-value datasets (EU) | Implementing Regulation (EU) 2023/138 lists company data as a high-value dataset (open licence, API and bulk download). The review found no evidence of official free access to Germany's commercial register. Whether that access exists remains unverified. | https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:32023R0138 |
| EU Business Registers Interconnection System (BRIS, e-Justice) | A web interface searches national registers. The review found no evidence of a third-party API. | https://e-justice.europa.eu/ |
| OffeneRegister.de | Notices as JSON and SQLite under CC BY 4.0. The dataset ends in late 2018 and is suitable only for historical use and testing. | https://offeneregister.de/ |
| OpenCorporates | Database licence requires attribution and sharing under the same terms. Other commercial use requires a contract. | https://opencorporates.com/legal-information/ |
| GLEIF (LEI) | Free API and bulk dataset, limited to entities with an LEI. A potential supplementary source for name, legal form, registered office and status. | https://www.gleif.org/en/lei-data/gleif-api |
| Commercial providers | Several providers offer documented APIs for a fee. Check reuse and licensing terms before signing a contract. | Provider documentation |

## Open questions before integration

- Read the current register portal terms of use in a browser. The limit of 60 came from quotations.
- Check current fees under the JVKostG.
- Check the status of high-value dataset implementation at the federal and state levels.
- Document the purpose and legal basis for storing data about company representatives, who are natural persons.

## Technical consequences

- Monitoring runs as a worker job and is off by default (`REGISTER_PRUEFUNG_CRON` is empty). It queries only the configured provider, for up to `REGISTER_ABRUFE_PRO_LAUF` companies per run (default 20), with a pause between lookups.
- Without a configured provider (`REGISTER_ANBIETER` is empty), search and retrieval return 409 `register_provider_missing`.
