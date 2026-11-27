# Data providers and company registers

Provider coverage and API references checked on 27 November 2026.

| Provider | Credential | Retrieval and coverage |
|---|---|---|
| North Data | Installation's API key in the HTTPS header | Search German companies, select a stable register key, retrieve name, legal form, seat, register court and number, representatives, available financial indicators and up to 25 publications. Coverage depends on the subscription. [API guide](https://github.com/northdata/api/blob/master/doc/data-api-userguide/data-api-userguide.md) |
| Companies House | Installation's API key as the HTTP Basic username | Search UK companies, select a company number, then retrieve the company profile, current officers and the latest 25 filings. Accounts filing metadata identifies a filing. [Public Data API](https://developer-specs.company-information.service.gov.uk/companies-house-public-data-api/reference) · [Authentication](https://developer-specs.company-information.service.gov.uk/guides/authorisation) |
| Firecrawl (managed hosting only) | Installation's bearer token | Read the website recorded on the company, then extract candidate fields and reported funding announcements. Review the website evidence before accepting a field or a funding announcement. [Parse API](https://docs.firecrawl.dev/api-reference/endpoint/parse) |

## Setup and usage

1. A global administrator opens **Administration → Data providers**, enters the provider's key and optionally sets a positive monthly request cap. **Test access** performs one authenticated request.
2. An editor opens **Company → Register**. For register providers, search by name or number and select the matching entity. The confirmed register reference is reused for refreshes and belongs to one company per provider. UK company numbers retain their leading zeroes. For website extraction, set the company's website first.
3. Review each field alongside the local value, provider value, source and retrieval time. Accepting an editable field updates the company and records the decision in one transaction. Register identifiers, representatives and financial figures can be confirmed as sourced information. German register snapshots and announcements also enter the register history.
4. Repeated retrieval preserves decisions on unchanged values. A changed source value requires review again. A local edit made after retrieval requires a fresh comparison. Removing a key stops new provider calls and preserves source records.

Financial indicators retain their reporting date, unit and consolidation scope. Estimated values are excluded. Confirmed indicators are available on the company. Choose **Import as metric**, the investment, a numeric catalogue definition with a compatible unit and the reporting period start to create a source-attributed draft. The investment’s normal metric confirmation then applies. Discarding the draft reopens its suggestion if the retrieved figure is still current. In managed hosting, editors review each reported funding announcement on the company page. Viewers see it after a human editor approves its source and contents. A changed amount, currency, investor list or source creates a separate proposal. The cap table and ownership calculations use internally entered transactions.

## Credentials and request limits

One installation uses one database. Data and CRM providers share the connection store, AES-GCM row binding and key rotation. Configure `SECRET_KEY` for the deployment. During rotation supply the previous key through `SECRET_KEY_PREVIOUS` and run the existing secret rotation command. Administration reports key presence, last check, status and UTC-month usage. It does not expose any part of the credential.

Transient failures retry the affected request up to twice with increasing delays. Previously read pages remain available during that retrieval. A malformed item in a list of results, filings, indicators or funding announcements is skipped. Companies House deduplicates overlapping officer pages by appointment. North Data creates a register snapshot only when it can read the complete list of reported officers. Each provider keeps its own suggestions for a company. Accepting a suggestion rechecks the local value, including changes accepted from another provider.

Every provider HTTP request, including failed attempts, search, pagination and access tests, consumes one local request. The local counter measures requests, while a provider may bill credits or unique entities. A database lock serializes reservations across processes. The installation allows 600 requests per five minutes for Companies House, 30 per minute for North Data and 10 per minute for Firecrawl. Firecrawl reserves the first request before reading robots.txt or the company page. A failed website retrieval uses that reservation. Each additional parse attempt reserves another request. The North Data and Firecrawl limits are local. A provider's rate-limit response sets a shared retry time. After that time a user or the next scheduled run can retry. [Companies House rate limiting](https://developer.company-information.service.gov.uk/developer-guidelines/)

The HTTP transport pins TLS to a checked public IP, restricts each credential to the adapter's HTTPS origin and approved paths, rejects redirects and bounds response size and time. The hosting extension reads robots.txt and the saved page from the company host. It rejects redirects, private destinations, disallowed or oversized pages and sends bounded, escaped text to Firecrawl for structured extraction.

## Monitoring and extensions

Set `REGISTER_ANBIETER` to `north-data` or `companies-house`, configure `REGISTER_PRUEFUNG_CRON`, select a record once and enable monitoring for that company. The worker revisits that provider's register identity. `REGISTER_ABRUFE_PRO_LAUF` bounds companies per run and `REGISTER_PAUSE_MS` spaces the lookups. Monitoring is off by default.

Adapters implement `DataProvider` in the core API. They declare an origin, allowed paths, authentication, rate window, access test, optional search and field mapping. Hosting extensions register adapters through `ApiErweiterung.dataProviders`. Their code and funding-round reader ship with the hosting build. Before adding another provider, establish permitted hosted use with the installation's own key, attribution, retention and onward-disclosure terms. Access to a key alone does not establish those rights.

## HTTP API

| Endpoint under `/api/v1` | Purpose |
|---|---|
| `GET /data-providers` | Administrator inventory, status, usage and limits |
| `PUT /data-providers/{provider}`, `DELETE /data-providers/{provider}` | Configure or remove access |
| `POST /data-providers/{provider}/test` | Check the saved credential |
| `GET /organizations/{id}/provider-data` | Configured providers and current field evidence |
| `POST /organizations/{id}/provider-data/search`, `…/fetch` | Find an entity and retrieve its evidence |
| `POST /organizations/{id}/provider-data/{suggestionId}/review` | Accept or reject a field after review |
| `POST /investments/{id}/metrics/provider-values` | Import a reviewed indicator as a draft investment metric |
| `GET /organizations/{id}/external-funding-rounds` | Approved funding announcements (managed hosting only) |
| `GET /organizations/{id}/external-funding-rounds/pending` | Pending announcements for human editors (managed hosting only) |
| `POST /organizations/{id}/external-funding-rounds/{roundId}/review` | Accept or reject a pending announcement (managed hosting only) |

The installation's OpenAPI document describes the enabled routes and their permissions.
