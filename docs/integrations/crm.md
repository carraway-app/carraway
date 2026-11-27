# CRM connections

Global administrators can configure a CRM under **Administration → CRM integrations**. Each Carraway deployment uses a separate database per tenant. Start the API and worker against the same tenant database and configure the same `SECRET_KEY` in both services. Credentials are encrypted with the installation key, bound to the connection ID and included in the normal key rotation procedure. A connection represents one source workspace. Rotate credentials using another token for the same workspace.

## One-time import

1. Select the provider and enter its credential. Leave the credential blank when editing a saved mapping to keep the current token.
2. Review the default mappings and select the optional deal and note streams. Add pipeline list IDs when list entries should become deals. For additional mappings choose a record type, a provider attribute identifier and a target field. Create custom target fields in Carraway first. Reference fields pointing to internal users or arbitrary local records cannot be populated from external identifiers.
3. Map source stage labels to Carraway deal stages. New deals with an unmapped stage start at **Inbound**.
4. Start a preview. The worker reads pages and stages the normalized records. Review the sample, total and number already present. Approve to apply this exact snapshot. Cancel to discard the pending rows.
5. The run history shows pages, distinct records, matches, applied records and skipped records grouped by reason. It also shows the most recent page error. Each application batch commits separately. Cancellation or failure preserves committed batches and drops the remaining staging data. A new preview can resume the import by matching source IDs.

| Source | Carraway target | Identity and references |
|---|---|---|
| Company | Organization | External ID first, then normalized website domain |
| Person | Person | External ID first, then case-insensitive email. An imported primary company creates an employment link. |
| Deal or selected pipeline entry | Deal | External ID and related organization. List entry identities are scoped to their list. |
| Note | Note activity | External ID and a related imported person, organization or deal |

Import preserves existing local values when a match is found. The preview counts ambiguous matches, missing names or references, incompatible field values and transitions to Closing without an approving resolution. Approval skips these records. Errors first detected during application also skip the affected record. The worker records source IDs and writes audit entries without credentials. Run history is available via `GET /api/v1/integrations/{provider}/runs`. The administration view shows the latest 50 runs.

Imported deals start without a fund and are visible to everyone with Dealflow access. Assign a fund to apply its access rules.

## Continuous synchronization

The full edition adds **Start synchronization**. The worker polls every 15 minutes. Both connectors enumerate the configured inventory to detect removals. The worker compares normalized content and writes only changed records. A completed scan is required before absence can archive a record. A token should retain stable read access to the entire selected inventory: loss of visibility is indistinguishable from deletion in a successful inventory response.

The external CRM owns mapped values during synchronization, including those of existing contacts matched by domain or email. The first source to manage a local record keeps ownership. Another source matching its domain or email skips the record and reports an ownership conflict. After the owner releases it, a subsequent sync may take ownership.

Only a change to a mapped source stage can move an existing open deal. An unmapped stage preserves its current phase. Lost and invested deals keep their local phase. For links created before source stages were tracked, the first observation establishes the baseline.

Other local fields and links are retained. The API rejects edits to mirrored records. Attach documents, investments and other relationships through their normal routes. **Stop synchronization** cancels outstanding work, releases the records for local editing and preserves their IDs, history and links. Stopping also restores records archived by this sync. Local archives are preserved. Contacts remain active when their company disappears. A mirrored contact is archived when its own source disappears. Stop synchronization before changing the mapping.

The worker resumes at the saved page after a transient network error, timeout, server error or malformed page response. It retries up to eight times with exponential backoff and honors longer provider delays. Overlapping pages count the first occurrence of each external identity once. An identified but invalid record still counts as present. An incomplete scan or a record without a usable ID defers archival. The worker rejects redirects, private network addresses and cross-origin continuation URLs.

## Attio

Use a workspace access token or an existing OAuth access token with read access to records and object configuration. Grant read access to notes and list entries when selecting those streams. Renew expiring tokens manually. The connector uses the Attio v2 API and requests 50 records per page. Record and list-entry queries sort by creation time and then by their unique ID. The notes endpoint uses its own ordering.

Companies use `name` and `domains`, people use `name`, `email_addresses` and `company`, and deals use `name`, `stage` and `associated_company`. Enter attribute slugs for overrides. The first value supplies each single-valued default. Multivalued custom fields can map to a compatible Carraway multiple-selection field. Selected list entries become separate pipeline deals. The parent supplies the default title and company. Notes retain plain text and their parent. Entries and notes on unsupported custom objects are outside the selected inventory. Disable deals if the workspace does not use the deals object.

See the Attio references for [sorting](https://docs.attio.com/rest-api/guides/filtering-and-sorting), [records](https://docs.attio.com/rest-api/endpoint-reference/records/list-records), [list entries](https://docs.attio.com/rest-api/endpoint-reference/entries/list-entries) and [notes](https://docs.attio.com/rest-api/endpoint-reference/notes/list-notes).

## Affinity

Create an API key with read/export permissions for the directories, lists and notes you want to import. The connector uses bearer authentication and pins v2 requests to API version `2026-09-17`. It reads companies and people from the v2 directories, selected list entries from v2 lists, and notes with their company, person and opportunity previews. For opportunities it reads the v1 collection, which includes the associated company IDs required by a Carraway deal. Where multiple companies are associated, the first supplies the deal's organization. A deal without a resolvable company requires correction at the source.

Use Affinity field identifiers (for example `field-123`) for additional fields, including the source stage and a person's company reference. The connector requests the chosen fields explicitly. For opportunities, list-specific attributes come from the opportunity's list entry. Dropdowns supply their text, company references supply their ID, and multiselection values supply an array. Selected list entries create distinct pipeline deals. Map the list status field to `stage` and its option labels to local stages.

Notes use the first visible parent of each supported type. Notes without a supported parent and replies outside the notes collection are omitted. HTML note content becomes plain text (up to 20,000 characters). The connector follows the cursor in same-origin v2 continuation URLs and the v1 opportunity page token.

See [Affinity API v2](https://developer.affinity.co/) and the [v1 opportunity collection](https://api-docs.affinity.co/#search-for-opportunities).

A transition to Closing requires an approving Carraway resolution. Map unapproved external deals to an earlier stage. The preview includes up to three records of each supported type. Archived deals and note activities remain available through existing references and are omitted from active lists.
