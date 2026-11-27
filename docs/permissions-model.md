# Permissions model: roles, user groups and fund access

The permissions model adds roles and user groups to each person's fund roles. Existing fund roles continue to apply. Users outside groups retain their previous permissions.

## Terms

| Term | Meaning |
|---|---|
| **Level** | Viewer < editor < approver < admin. Viewers read, editors record data, approvers approve and admins manage fund settings and roles. The hierarchy matches `fonds_rolle`. |
| **Area** | A part of the application. Each route that requires a fund role belongs to exactly one area (`apps/api/src/rechte/bereiche.ts`). |
| **Role** | A named set of areas, such as “Contacts” for the contacts area alone. Table `rechterolle`. A role can set a **maximum level per area** (`bereich_stufen`, e.g. at most viewer in finance). An area without an entry has no cap. |
| **User group** | Members, a level, roles and fund access. Tables `nutzergruppe`, `nutzergruppe_mitglied`, `nutzergruppe_rolle`, `nutzergruppe_fonds`. |
| **Group fund access** | Unrestricted groups follow the central setting. Restricted groups have only the selected funds. |
| **Areas per fund** | Group setting (`nutzergruppe.bereiche_je_fonds`, off by default). When on, the group's areas apply only to its funds and can be narrowed per fund (`nutzergruppe_fonds.bereiche`, empty means all areas from its roles). When off, areas apply across funds as before. |
| **Central “Funds open” setting** | `rechte_einstellung.fonds_offen`, default `true`. When open, unrestricted groups see all funds. When closed, each group sees only its selected funds. |
| **User override** | A person's existing direct fund role (`fondsrolle`, Administration → Roles by fund). It adds access to more funds and takes precedence over every group at that fund, even when its level is lower. |

## Resolve effective permissions

For each signed-in request (`rechte/aufloesung.ts`, views `wirksame_fondsrolle` and `wirksames_bereichsrecht`):

1. **Level per fund.** Use the person's direct role if present. Otherwise use the highest level among their groups that cover the fund. Without either, the person has no access.
2. **Areas.**
   - Without a group, all areas apply as before.
   - With groups, take the union of the areas from all their groups' roles.
   - Groups without roles grant no areas.
3. **Data without a fund** (contacts, deals before assignment). A level on any fund or the highest group level is sufficient, even if the group has no fund. A group level without a fund counts only for rules with `ohneFondsErlaubt` (contacts, dealflow and `allgemein`). Fund-specific routes need a level on a fund.
4. **Route check.** Check the route area (`Regel.bereich`) first, then the minimum level in that area on the targets' funds. See [Areas per fund and levels per area](#areas-per-fund-and-levels-per-area). A missing area returns 403 `forbidden`.
5. **Embedded data** from a different area requires access to that area (`rechte/sichtbarkeit.ts`). Otherwise those fields are empty, for example:
   - Investments on an organisation or deal page (portfolio)
   - Deals in contacts, search and lists (dealflow)
   - Search results for organisations and people (contacts) and documents (documents)

**Default: areas apply across funds.** With “Areas per fund” off, a group's areas apply to every fund the person can access. If group A supplies finance at fund 1 and group B supplies contacts at all funds, the person can also see finance at the other funds where they have a level. Groups created before the extension work this way.

### Areas per fund and levels per area

View `wirksames_bereichsrecht` (migration 0068) gives the effective level by person, fund and area. A row without an area counts for every area (a person without a group).

1. **Cross-fund groups** (setting off, as before). The fund level is the direct fund role or, if absent, the highest level among these groups on the fund. It applies to each area of their roles, up to the role's cap. Level(fund, area) = minimum of fund level and area level.
2. **Groups with areas per fund.** These apply only at their own funds and to the areas selected for each fund. Use the minimum of the group level and role cap. Their level cannot raise other groups' areas, and their areas apply to no other fund.
3. **User override.** Sets the level on the fund, even above or below the group. It grants **no areas**. On that fund, use the areas from rule 1 and the areas that rule 2 grants there, each capped by the role. If all a person's groups use areas per fund, an override on another fund grants them no area there. For example, a cross-fund group without funds grants finance, a per-fund group grants portfolio at fund 1, and a direct override grants viewer at fund 1. The person gets finance and portfolio at viewer level on fund 1 (finance through the established cross-fund rule) and no areas at fund 2.
4. **Data without a fund** (contacts, deals before assignment). Derive level per area from the groups. Cross-fund groups use their previous rule (the highest level among those groups, capped by the role). Per-fund groups contribute the minimum of their level and the cap for each area in their roles.
5. **Multiple groups** combine by taking the highest level from rules 1 and 2 per fund and area.

Example, “Fund A: edit portfolio, read finance. Fund B: contacts only.” Define a role with portfolio, finance (capped at viewer) and contacts. Give a group editor level with areas per fund. Select portfolio and finance for fund A and contacts for fund B.

**Central enforcement.** `rechtePruefung` scopes each request's actor to the route area (`fuerBereich` in `anmeldung/akteur.ts`). `rollen` then contains only levels in that area. `hatRolle`, `sichtbareFonds`, `hatIrgendwoRolle` and all handler lists check and filter by fund and area without requiring handlers to know the route's area. Area and level must both apply to the same fund. `alle` requires every area (lowest level per fund), and `allgemein` uses the fund level across areas. Data from another area specifies it explicitly (`sichtbareFonds(akteur, mindest, bereich)`, `hatRolle(…, bereich)`, `fondsSichtbar`, `dealSichtbar`, `darfFondsSehen`). This covers deals in contacts, search and CRM lists, investments on organisation pages and documents in search.

**Performance.** Per request, `ladeRechte` reads `wirksame_fondsrolle`, groups and, for people in a group, `wirksames_bereichsrecht`, each filtered by person. Group members need three queries instead of two. The view's subqueries are `NOT MATERIALIZED` so the person filter reaches `fondsrolle` and `nutzergruppe_mitglied` through their indexes. The queries join the small role, group and fund tables.

### Existing rules

- Global admins have admin level and all areas everywhere.
- The four-eyes principle and approval stages apply as before. Approver level can come from a different source.
- LP portal investor users cannot join groups. Both the API and the database enforce this (trigger `investor_keine_gruppe`).
- An editor in the preceding version's fund and `berichte` area creates a correction with `POST /berichte/:id/berichtigung` and `grund`. Approvers perform the fund's approval stages in effect at creation. The usual four-eyes rules apply to the new draft.
- The portal shows approved fund reports and LP reports. Recipients see the correction reason after final approval. For LP reports with capital accounts, the portal links only approved files of the investor's own organisation. Each download of a previous version rechecks access and the stored checksum.
- API keys (`cwk_`) retain their scopes and all areas. Technical users do not belong to groups.
- Personal value keys (`cww_`) act with their owner's effective permissions, including area access.

## Incoming payments for capital calls

In finance, a viewer reads calls, capital position and allocated incoming payments for their fund, along with management fees, fund expenses and capital accounts. Editors post and reverse expenses and incoming payments. The movement's fund determines the required permission. The same read permission applies to capital provenance components, approved call notices and voucher files, including direct downloads. Investors see figures for their own subscriptions in the portal.

## Areas

| Key | Contents (selected) | Sidebar |
|---|---|---|
| `portfolio` | Fund overview, investments, instruments, tranches, transactions, valuations, rounds and cap table, employee equity pools (size, changes, rough estimate, totals), scenarios, reserves, values API | Portfolio |
| `finanzen` | Journal, postings, fund movements, capital calls, interest and interest runs, vouchers, accounting, balances, posting exports | Journal, Interest, Vouchers, Accounting |
| `kennzahlen` | Metrics, metric requests, ESG and disclosure | (fund tab) |
| `berichte` | Reports, templates, approval, fund report and portfolio list | Reports |
| `meldewesen` | Regulatory reporting runs, reporting definitions, funding programmes, organisation reporting data | Regulatory reporting |
| `dealflow` | Deals, dealflow, resolution templates and deal contacts | Dealflow |
| `kontakte` | Organisations, people, CRM (lists, views, fields, tasks), activities, follow-ups, appointments, contact import, register, mailbox (sync matches mail to contacts) | Contacts, Register |
| `dokumente` | Documents, AI extraction | (within pages) |
| `daten` | Data import | Import |
| `fondsverwaltung` | Edit fund master data, fund roles, period locks, approval stages, investor access | (Fund → Settings) |
| `einzelzuteilungen` | Individual employee equity grants (reference, optional name, vesting, departures), anonymise and delete grants, grant import | (within the company's employee equity section) |

**Employee equity.** A company's pools are aggregated cap table data. Pool visibility follows round visibility. Reading requires permission to read company rounds (a legal basis on the company or a position in one of its rounds from an accessible fund). Writing requires editor level, the same as creating a round, in `portfolio`. A new round preview includes the pool only through funds already linked to the company, excluding funds supplied in the request body.

Individual grants are employee data of the portfolio company and have their own area `einzelzuteilungen` (API `individual_grants`). The grant routes (`…/employee-pools/:poolId/grants…`) belong to this area, with the same fund levels as the pool, evaluated in this area. Without it, the pool list returns the totals with `grantsVisible: false` and no grants, and the exit scenario combines all grants of a pool into one row without category, units or strike price and omits the calculation steps and the breakpoints of the curve. Calculations always use every grant. The migration adds the area to roles that held all previous areas, so their access and the change feed (`all`) stay unchanged. Other roles do not receive it. A data import with the employee grants sheet requires the area as well.

Two special cases:

- **`allgemein`** needs no area. It covers the fund list and fund master data (for selectors, with subscribed capital), personal settings, value keys, names, exchange rates, field definitions, AI status, funding programmes and the follow-up count (zero without contacts). Search only returns result groups in the person's areas. A batch applies the same permission and area check to each operation.
- **`alle`** requires every area, for example `/changes`, which returns records from all tables.

Administration (users, API keys, roles and groups, export) is restricted to global admins.

**Contacts from mailbox and calendar.** Only global admins change installation settings (`/kontaktvorschlaege/einstellung`: mode, own domains and blocklist). Only the person can see and change their participation and blocklist (`/postfach/kontakte`), as with mailbox connections. Listing, applying, merging and discarding suggestions (`/kontaktvorschlaege…`) require editor in contacts because they create or change people and organisations. Even global admins see only suggestions from their own connected mailbox or calendar. Otherwise a suggestion would expose someone's correspondents before they approve sharing with CRM. Connections are likewise visible only to their owner. Discarding is per person. Anyone who can see a created contact can see its provenance (whose mailbox and when).

**AI contact enrichment (managed hosting).** Only global admins change installation settings (`/ki/kontakte/einstellung`). Only the person grants permission for their own mailbox (`/ki/kontakte/teilnahme`). Viewing suggestions needs viewer in contacts. Applying, discarding and extracting from a website need a human editor in contacts. Suggestions make no writes. Applying uses inline editing and never overwrites a manually maintained value.

**Investor access and subscriptions (`fondsverwaltung`).** Fund admins see the list at `/fonds/:fondsId/investorenzugaenge`, including subsequent closings and agreed equalisation. Only global admins can write: initial subscriptions and later closings (`POST …/investorenzugaenge/zeichnungen` and `…/closings`), reversal and correction of a closing (`POST …/closings/:closingId/storno` and `…/korrektur`), and withdrawal or reduction of a commitment (`POST …/investorenzugaenge/zusageaenderungen`). A closing changes fund commitments, ownership shares and subscribed capital, so it requires the same level as initial entry.

NAV provenance belongs to portfolio. Individual accounts from the trial balance also require finance on the same fund. Valuation evidence needs documents on the fund and visibility of the linked target. The server checks these permissions when the source is opened directly.

## Email notifications

Internal notices go only to people with the matching area (`hatBereichSql`): report approval needs reports, regulatory reporting run approval needs regulatory reporting, voucher approval needs finance and a register event needs contacts. Recipients also need a level at that exact fund **in that area** (view `wirksames_bereichsrecht`). Register events use a fund invested in the company. Approval checks this with `hatBereichSql(benutzer, bereich, { fondsId, mindest })`.

## Writes across areas

Writes that affect several areas check every affected area as well as level (`rechte/uebergreifend.ts`, `verlangeBereiche`). A missing area returns 403 `forbidden` with the missing areas (`bereiche`) before any write.

| Action | Route area | Further requirements |
|---|---|---|
| Merge organisations | Contacts | Portfolio (investments, rounds and round positions) and dealflow (deals), whether or not matching data exists |
| Merge people | Contacts | Dealflow if source deal contacts or activities link to deals |
| Confirm AI extraction | Documents | Portfolio (investment agreement, loan agreement or valuation evidence) or contacts (register extract) |
| Create an investment from a deal | Dealflow | Portfolio |
| Validate and apply data import | Data import | Contacts, portfolio and finance. Fund administration for new funds. Individual grants for a file with employee grants. |
| Batch | General | Same area as for each operation on its own. No separate rule needed. |

**Reads.** Organisation merge preview counts investments, rounds, round positions and funds only with portfolio access, and deals only with dealflow access. Otherwise counts are zero, `fondsIds` is empty, `darfAusfuehren` is `false` and `bereichFehlt` lists missing areas. The calendar subscription (ICS) omits appointments without contacts and deal follow-ups without dealflow. Area access is rechecked on each fetch.

**Areas per fund.** After this check, use the level in the other area on each affected fund (`hatRolle(…, bereich)`). Merging needs editor in dealflow on deal funds and approver in portfolio on investment funds. Preview counts investments by funds with portfolio and deals by funds with dealflow. Extraction and creation from a deal need editor in portfolio on the target fund. Import needs the required level in data import, portfolio and finance on the fund. Calendar subscriptions show deal follow-ups only from funds with dealflow access. Cross-fund groups retain the previous level.

## Document targets

Documents belong to the documents area and their targets often belong to another. Each target also requires its own area at the same level and fund as the route (`ZIEL_BEREICH` and `darfZiel` in `dokumente/ziele.ts`). The `dokumentSichtbar` SQL filter uses the same mapping.

| Target | Further requirements |
|---|---|
| Deal | Dealflow at the deal's fund. A deal without a fund uses the dealflow level required by its routes, including from a group without funds. |
| Investment, transaction, valuation | Portfolio at the investment's fund |
| Financing round | Portfolio at a fund that holds the company |
| Fund, organisation | No extra area. Requires a level in documents at the fund or a holding fund. Only global admins can access an organisation without an investment. |

Fund and organisation targets need no extra area (contacts on organisation routes, portfolio at a holding fund or fund administration). A document attached to a fund or company is filed with that record. The documents level at the fund responsible for or holding the record protects the file, and the display shows only the target's name.

- **Writes** (upload, link, unlink, replace, text recognition, delete, start/discard/confirm extraction and import a mailbox attachment) return 403 `forbidden` before writing if any target area is missing.
- **Reads** hide targets without area access. The document lists only visible links. A document with no visible targets returns 404 and is absent from lists, search and duplicate checks. Extraction candidates (`GET /auslesungen/:id`) and confirmation targets (`zieleDesDokuments`) come only from visible targets. Investments come only from funds with portfolio access.
- A new share class from extraction requires editor in portfolio on a holding fund.

## Limits

- The fund shell (header with metrics) belongs to portfolio. Without portfolio access it is absent from sidebar navigation, and direct fund URLs show the API error.
- Global admins can be group members and keep all permissions.
- With areas per fund, assignee candidates and names in the audit log use the fund level across areas (`wirksame_fondsrolle`) and show only names. A task's deal requires dealflow on the deal's fund (404 otherwise, editor in dealflow to write). Recording an affirmative resolution requires approver in dealflow on that fund.
- The UI hides sections using the union of areas (`/me`, field `areas`). It checks fund actions with `darf(stufe, fondsId, bereich)` (`apps/web/src/lib/rechte.ts`) using level per fund and area from `bereicheJeFonds` or `stufeOhneFondsJeBereich`. Funds without the area do not offer the action and the API returns 403. Without `bereich` the fund level across areas applies.

## Administration

**Interface.** Administration → Roles and groups shows central fund access, roles and groups with level, funds, roles and members. Administration → Roles by fund manages direct overrides.

**API** (global admins only):

| Method and path | Purpose |
|---|---|
| `GET /permissions` | Current settings, areas, roles and groups |
| `PUT /permissions/settings` | Open funds or assigned funds only |
| `POST/PATCH/DELETE /permissions/roles[/:id]` | Create, update or delete roles |
| `POST/PATCH/DELETE /permissions/groups[/:id]` | Create, update or delete groups. Lists replace the existing values. |
| `GET /users/:id/permissions` | Effective permissions with source per fund and level per fund and area |

Roles have `bereichStufen` (area → maximum level). Groups have `bereicheJeFonds` (switch) and `fondsBereiche` (fund → areas, allowed only with the switch on and for funds in `fondsIds`, otherwise 400 `assignment_invalid`). Turning the switch off clears the per-fund selection.

`GET /ich` also returns `bereiche` (`null` means all, union across funds) and `stufeOhneFonds`, plus `bereicheJeFonds` (fund → area → level) and `stufeOhneFondsJeBereich`. The last two are `null` for people outside groups, where `rollen` and `bereiche` apply. The sidebar hides inaccessible areas. Without portfolio the start page opens contacts.

**Within pages**, the UI shows only permitted sections to avoid a 403.

- `apps/web/src/lib/bereiche.ts` maps page and navigation entries through `BEREICH_JE_ABSCHNITT`. `useSichtbar(seite, eintraege)` filters entries before `useInhalt`. A URL for a hidden entry falls back to the first visible entry.
- `useBereich(bereich)` from `lib/rechte.ts` checks individual sections. `darf(stufe, fondsId, bereich)` also requires the area, for example finance to create a voucher even from an investment page.
- Examples: without portfolio, dealflow and documents, an organisation shows no deals, investments, rounds or documents. Without regulatory reporting its edit dialog hides country and region. An investment hides the corresponding tabs without metrics, finance, documents and contacts, and hides the quarterly report without reports. Without contacts, a deal hides tasks, meetings, links and its side panel. The fund hides metrics, ESG and interest tabs without their areas.
- Add an entry in `BEREICH_JE_ABSCHNITT` for a new page or section from another area.

**Removing the last membership** restores every area and leaves only the user's direct fund roles. This also applies when their last group is deleted.

## Migration 0068 (areas per fund)

- Existing groups keep “Areas per fund” off and existing roles have no per-area cap. Effective permissions stay the same.
- `__tests__/rechte-bereiche-je-fonds.test.ts` compares the new view with the previous resolution for all demo logins and random combinations of existing groups.
- `wirksame_fondsrolle` stays unchanged (fund level across areas, used for the fund list and names in the audit log).

## Migration 0065

- Existing fund roles stay in place and become direct user overrides.
- No groups or roles are created, so effective permissions stay the same.
- The central setting starts at “Funds open”.
- Demo data seeds example roles and groups (`packages/db/src/demo/zugaenge.ts`).

Consumers that previously read fund roles directly (assignees, email notifications, calendar subscriptions, resolution checks, audit log names) now use `wirksame_fondsrolle`.
