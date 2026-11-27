# CRM and Dealflow concept (stage 20)

This implementation note retains the API identifiers in use at stage 20. See the [API glossary](../api-glossary.md) for public names.

This document records the patterns Carraway adopted from publicly documented CRM products, how they fit its data and permissions, and the resulting design decisions.

## Sources

The design draws on publicly documented CRM patterns for objects, records, attributes, lists and views. It uses only ideas and interaction patterns. The implementation was written on Carraway's existing data model and stack without copying code, text, icons or other assets.

## Observed patterns

| Area | Pattern |
|---|---|
| Objects and records | Each object (companies, contacts, deals) contains records with attributes. System attributes are fixed and admins add custom attributes. |
| Attributes | Text, number, amount, date, select, multi-select, checkbox, URL, email, phone, person and links to other records. Options have colours. |
| Relationships | Links appear on both sides (“linked to”). Contacts can belong to multiple companies. |
| Views | Table and board. Filters with AND/OR groups and operators by type. Sorting. Visible, ordered columns with widths. Grouping, including boards by select field. Private or shared saved views and a default per object. |
| Lists | Curated sets of records with custom fields per entry, displayed like any other view. |
| Record page | Header with name, badges and quick actions, an attribute panel with inline editing, tabs for activity, notes, tasks, mail and files, and backlinks. |
| Interaction | Inline cell editing, keyboard controls, a command bar (Ctrl+K or Cmd+K) with search and actions, and bulk actions on selected rows. |

## How this maps to Carraway

### Objects

Existing tables, names and routes stay in place to preserve existing pages, reports and API clients.

- **Companies** use `organisation` (company, investor, adviser or other). Added email, phone, LinkedIn, custom fields and archiving.
- **Contacts** use `person`. Added phone, LinkedIn, custom fields and archiving. A company is optional.
- **Employment** (`beschaeftigung`) is many-to-many between contacts and companies with a job title, period and exactly one primary row per contact (partial unique index). `person.organisation_id` and `person.funktion` mirror the primary row because many existing queries read them. Existing create, update, import and merge paths maintain that row too.
- **Deals** use `deal` with the existing stage enum. The stage 2 rules still apply. Closing and transfer into the portfolio require an affirmative resolution. Stage changes use the same function as `POST /deals/:id/phase`. Deal contacts live in `deal_kontakt`.
- **Notes** remain note activities. Synced mail and meetings (stage 17) remain activities with provenance and appear in the history as before.
- **Tasks** (`aufgabe`) have a title, due date, assignee, completion date and a company, contact or deal reference. Any active signed-in person with access can be assigned, including a role on the deal's fund if it has one. The picker searches through `GET /crm/zustaendige` (only ID and name). For callers without global admin access it returns only people who share a fund with them. Write paths enforce the same rule server-side. Lists show “Mine” or “All”. Activity follow-ups still have a header count, calendar subscription and daily summary. “Today” displays tasks and follow-ups side by side.

### Custom fields

- **Storage.** The JSONB column `felder` on `organisation`, `person` and `deal` (or `liste_eintrag` for list entries) uses the field definition ID as its key. The full before-and-after rows in the audit log and the full tables in exports capture values without added work. A GIN index (`jsonb_path_ops`) supports containment queries. Sorting and filtering use typed expressions and meet the performance targets below.
- **Definitions** (`feld_definition`) store object, optional list, key, name, type, options, position, version and archive date. The type is fixed after creation. To change it, archive the definition and create another. Each definition change increments the version and the audit log records every version. Archiving hides the field and keeps its values in the row and export. Options can be added, renamed and recoloured. The API rejects removal of an option in use.
- **Types.** Text, long text, number and amount (decimal strings without floating point), date, select, multi-select, checkbox, URL (HTTP and HTTPS only), email, phone, user and link (to a company, contact or deal, writing backlinks to `datensatz_link`).
- **Permissions.** Global admins define fields. List owners can also define fields on their lists. A staff field accepts only an active signed-in person with access (global admin or a role on a fund). Technical accounts and portal investors are excluded.
- **API.** The dynamic object schema is at `GET /crm/objekte/{objekt}/felder` (fields, types, options and operators by type). OpenAPI links to it. Values are keyed by field ID under `eigene`.

### Queries, views and lists

- **One query builder** (`apps/api/src/crm/abfrage.ts`) serves the table, board, exports and bulk actions. Field keys resolve against the catalogue of system fields and definitions, operators come from a fixed table by type, and values are validated by type and bound as parameters. Visibility (deals by fund, excluding merged and archived records) is ANDed outside the filter tree so an OR branch cannot bypass it. Maximum depth is 4 and the condition limit is 60.
- **Views** (`ansicht`) store JSON configuration (filters, sorting, columns and widths, grouping) and are private or shared. Owners and global admins can change or delete them. Only global admins set the default.
- **Lists** (`liste`, `liste_eintrag`) are per object and can have list fields. Owners and global admins can change names, entries and fields or archive a list. Counts, queries and exports of shared lists include only records visible to the caller.
- **Board.** Columns represent select field options with counts and totals. Dealflow groups by stage. Companies and contacts use any select field, including list fields. Dragging writes the value to the record or list entry.
- **Table grouping.** `POST /crm/objekte/{objekt}/gruppen` returns a count and sums for amount and number fields for each value of a select, multi-select, person, link or checkbox field, or deal stage. The result set matches the query (filters, search, list and visibility outside the filter tree). Group and sum fields resolve only through the field catalogue and values are parameters. Multi-select rows count in every applicable group. For links, including a contact's company, the value is the target ID. Names are in the references and follow visibility. Deals from inaccessible funds have no name and the UI shows “No access”. Groups are sorted by name with “No value” last. Checkboxes produce `true` and `false`. An unset checkbox counts as `false` (as in `ist_falsch`). The UI loads group rows using the query with a condition on the group field. The choice lives in the view configuration (`gruppierung`).

### Record pages

Header (name and quick actions), tabs on the left and attribute panel on the right, without stacked sections. Companies show Contacts and relationships (contacts in **one** table, relationships in a subtab), Engagement (deals and investments), Activity, Rounds, Register, Documents, Tasks and Linked. Contacts show Companies (the same table from the contact's perspective), Activity, Tasks and Linked.

The contacts table combines three previously separate sources: employment (title, dates and primary company), contact roles (founder, management, co-investor, adviser, investor and other) and the organisation's legacy people list. Each employment gets a row. Roles appear as labels on the person's row at that company. A role-only or legacy-list-only person gets a row without employment. Existing data and API remain compatible. `GET /crm/beschaeftigungen` adds phone and LinkedIn on the contact side and mail, phone and website on the company side. Linking uses a drawer. If the selected contact or company is already linked, the drawer shows the role and period and offers “Open existing” to edit it. Another link, for example for a different period, remains possible. The title and period can be changed and the link removed after confirmation. Deal pages already listed the contacts of that deal only. A deal shows Overview, History, Activity (notes, mail and meetings), Contacts, Tasks, Resolutions, Documents and Linked.

Note mentions use `@[Anzeige](typ:id)`. Creating the activity turns them into links (`art = erwaehnung`) with backlinks on mentioned records. React renders the display text as text.

### Permissions

Existing rules apply. A role on any fund permits reading, editor or higher permits writing, and deals follow their fund. Writing a link field, including a list link field, requires visibility of its target. A deal from an inaccessible fund responds exactly like a missing record (400 `field_value_invalid`, `unknown_record`, same message without an ID), so the response does not reveal its existence. This applies on record pages, in cells, to the “Set field” bulk action and to list fields. CSV import accepts no link values. When a request contains multiple records or the object as a path parameter, the handler checks visibility and write permission per record. Technical users (API keys) are actors like other users.

### Import and export

Company and contact CSV imports allow mapping columns to any field, including custom fields, preview with per-row errors and duplicate checks (stage 7 logic: similar name, same email). Each run chooses to skip, update or create anyway. CSV export for every view uses the same query builder. Cells starting with `=`, `+`, `-`, `@`, a tab or a newline are prefixed with an apostrophe to prevent formula evaluation. An export writes a read entry to the audit log.

### Command bar

Ctrl+K or Cmd+K searches companies, contacts, deals and documents, and provides commands to create records and jump to tables, the board, Today and lists.

## Migration

Migration `0049_crm_objekte` adds columns and tables without changing existing rows. Each person with a company gets exactly one primary employment. A test runs the data step against existing records and checks for data loss. The seed data includes custom fields, employment, lists and tasks.

## Performance

With 10,000 companies and 50,000 contacts with custom fields, the 95th percentile of server time per query is well below 150 ms (about 10 ms for default sorting, 20 ms by a custom number field and 110 ms by company name). The test is `crm-leistung.test.ts`, skippable with `SKIP_PERF=1`. Functional indexes support default name ordering.

## Table interactions

Select, multi-select, text, number, date, person and link cells can be edited directly. Person and link fields open a searchable popover (Enter or F2 opens, arrow keys select, Enter commits, Escape cancels and “Clear value” removes the value). The document hosts the popover so the scrolling table cannot clip it. Writes use the same request as the record page and the API validates values. List fields belong to the list entry. Only list owners and admins can change them, as enforced by the API.

References to companies, contacts and deals (table names, link cells, relationship tables, Linked, mentions and board cards) show a small card on mouse hover or keyboard focus with name, company, email, phone and quick actions. It fetches `GET /crm/datensaetze/{objekt}/{id}/karte` for those fields. Deals from inaccessible funds and missing records both return 404. A separate component loads on first opening and caches the response for a minute. The card describes the link (`aria-describedby`), takes no focus and closes on Escape. On touch devices the link opens the page as usual. The card actions are available with the mouse. Keyboard users have the same actions in the row and on the record page. Quick actions (email, phone, LinkedIn and website) appear in rows, record headers, cards and command bar results. Deals use the company's contact details (readable fields `unternehmenEmail`, `unternehmenTelefon`, `unternehmenWebsite`).

## Demo data

The seed includes custom fields (annual revenue, main contact as a link and account owner as a person) and lists (co-investors, deals in review and LP pipeline with stage and volume fields). It creates five shared views: companies by interest with annual revenue totals, conversations on the co-investor list by status, an LP pipeline Kanban by stage, contacts by channel and deals by stage. Views, account owners and task assignees are added after demo accounts because they need users. Names, options and task titles follow `DEMO_SPRACHE`.

## Open design

- Multiple pipelines per fund were deferred. The deal board uses existing stages. Boards for other objects use any select field, including list fields like the LP pipeline.

### Proposed design for multiple pipelines per fund

The database enum `deal_phase` supports the funnel report, full export, change queries, search, resolution templates, OpenAPI's stage enum, demo data and about ten UI locations (copy, colours and ordering). Stage 2 rules rely on `closing` (affirmative resolution) and conversion to the portfolio (four-eyes principle). A safe change needs a backfill migration and a transition period when all consumers can read both forms.

1. Add `pipeline` (fund, name, default yes/no, archive date, one default per fund and one for unassigned deals) and `pipeline_stufe` (pipeline, key, name, position, `art` of `normal` or `abschluss`, and `grundphase` from the six existing stages).
2. Add `pipeline_id` and `stufe_id` to `deal`. Keep `phase` as a derived mirror of the stage's `grundphase` for the funnel, export, API and reports. Add `von_stufe_id` and `nach_stufe_id` to `deal_phasenwechsel`.
3. Apply the rules to `abschluss` stages (affirmative resolution before transition). Keep portfolio transfer as `POST /deals/{id}/portfolio` and allow it in each pipeline whose final stage has type `abschluss`. Rename `wechselePhase` to `wechsleStufe`, keeping the same check. Keep `POST /deals/{id}/phase` for the default pipeline.
4. Migrate by creating a default pipeline per fund with all six stages (`closing` as `abschluss`), backfill `pipeline_id` and `stufe_id` for every deal from its stage, then apply `NOT NULL`. Test on existing data to verify stage, history and resolutions stay intact.
5. Add a pipeline picker to the board and deal table, and let global admins manage stage lists. Stage displays read the new stage. The funnel report uses `grundphase` for comparison.
