# Mail and calendar

Status as of stage 17. Both are **off by default** and configured per installation through environment variables (see `deploy/.env.example` for Compose).

1. **Outgoing mail.** Send a link to a metric request or ESG questionnaire to a company contact, alert investor users to new portal notices, or notify people who have opted in about approved reports, regulatory reporting runs and vouchers. All report types are covered, including PAI statements. An outbox feeds SMTP.
2. **Mailbox and calendar (incoming, read-only).** People can connect their own mailbox (Microsoft 365, Google or IMAP) and calendar (Microsoft 365 or Google). Correspondence and meetings with **known** CRM contacts appear in the history of the person, organisation and deal.
3. **Calendar subscription (ICS)** for a user's own follow-ups.

The Microsoft Graph, Gmail and Google Calendar clients use plain HTTP calls without SDKs. They have **yet to be tested against live services**. See [Checks before using a provider](#checks-before-using-a-provider).

## Outgoing mail

| Variable | Meaning |
|---|---|
| `SMTP_HOST`, `SMTP_PORT` | Server, with port 587 by default. Sending is off without `SMTP_HOST`. |
| `SMTP_TLS` | `starttls` (default), `tls` (from the start, port 465), or `keine` (demo and development only, rejected in production). |
| `SMTP_BENUTZER`, `SMTP_PASSWORT` or `SMTP_PASSWORT_DATEI` | Server credentials. The password exists only in the environment or in a file such as a Docker secret. The database, API, audit log and application logs omit it. |
| `SMTP_ABSENDER` | Sender address (`From`). Required with `SMTP_HOST`. |
| `MAIL_LIMIT_PRO_STUNDE` | Maximum messages per installation per hour (default 200). Excess jobs stay pending until later. |
| `GEHEIMNIS_SCHLUESSEL` | Required for every message carrying a one-time link and for mailbox connections. See [Credentials and keys](#credentials-and-keys). |

**Flow.** An action creates a job in `mail_auftrag` (the outbox) in its transaction. The worker claims due jobs in a short transaction, sends **outside any transaction** and completes each job. Two workers cannot claim the same job. Transient failures retry after 1, 5, 30 and 120 minutes. The job becomes failed after five attempts or on a permanent error such as a rejected address or incorrect credentials. A rejected action, for example because a role is missing, creates no job. Without SMTP configured, triggering routes return `409 mail_not_configured` and skip the action.

**Templates** (German and British English, text and simple HTML) include `kennzahl_abfrage`, `esg_abfrage` (sustainability indicator questionnaire), `lp_mitteilung`, `bericht_freigegeben` (report, regulatory reporting run or voucher after final approval), `passwort_zuruecksetzen`, `einladung` and `testmail`. Messages omit images, external files, open and click tracking, redirect URLs and read receipts. Values are escaped in HTML and subject lines contain no line breaks. **Portal notices by email omit amounts and attachments** and direct recipients to the portal.

**Storage and logging**

- `mail_auftrag` stores the recipient, template, subject, related record type and ID, status, attempts and last error code. The body (text and HTML, including the one-time link) is **encrypted** and **deleted** after delivery or permanent failure. Full exports and change queries omit this table.
- The worker deletes sent and failed outbox rows after 90 days. Audit log entries (`anlegen`, `gesendet`, `fehlgeschlagen`, with recipient, template and related record but no body) follow ordinary audit log retention.
- Outgoing mail logs contain only the job ID, error code and attempt count. They omit addresses, bodies and SMTP server error messages.
- A metric request email is the only place outside the response where the token appears in plaintext. The database holds the token hash and, until delivery, the encrypted body. “Send by email” for an existing request issues a **new** link like “New link”, invalidating the old one because the token is unreadable after creation. The link remains visible in the interface for copying. Recipients must be people with an email address at the investment's company.

**Permissions.** Only human global admins can see status, test mail and the outbox. Status shows the server, port, encryption, sender, whether authentication is configured and the limit. It omits the username and password. Test mail goes only to the signed-in person's address. The outbox view omits message bodies.

**Password resets and invitations.** Both require outgoing mail (`SMTP_HOST` and the key ring). Otherwise the interface hides them and admins continue to assign initial passwords. One-time codes by email at sign-in remain disabled.

- *Reset.* The sign-in page offers “Forgot password?”. Requests (`POST /passwort/vergessen`) return the same status, body and minimum latency for every address. For unknown, disabled and technical accounts, the same work runs with a rolled-back transaction. Limits apply per IP (10 per hour) and per address (3 per hour, counted by hash) whether the address exists or not. The email link is single-use and valid for 30 minutes. A new request invalidates earlier links.
- *Invitation.* When an admin creates a person or investor account without a password, the person receives a one-time password setup link valid for 72 hours. Second-factor setup follows as usual. “Resend invitation” replaces the link.
- *Token.* The token lives in the URL fragment (`/passwort-setzen#token=…`), so it reaches neither server access logs nor the referrer. The database stores only its SHA-256 hash (identifier prefix `pw1:`, Better Auth `verification.storeIdentifier`). Redemption goes through `POST /auth/reset-password` and failed attempts per IP count towards the shared limit.
- *Second factor.* A reset keeps the existing second factor in place and ends all the person's sessions. Requests, invitations and resets go into the audit log without the token.

**Demo.** `docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d` runs a mail catcher (`mailpit`, digest-pinned image, bound only to `127.0.0.1:8025`). With `SMTP_HOST=mailpit`, `SMTP_PORT=1025`, `SMTP_TLS=keine`, all mail stays on the machine.

## Connect a mailbox and calendar

### Data read and stored

- **Read.** For emails, only sender, recipients, Cc, date, subject and message ID. For meetings, only title, time and participant addresses. The beginning of a message body is fetched only **after** matching, only for matching messages and only with the person's permission. **Sync never reads attachments.**
- **Matching** uses an allowlist. Carraway saves a message or meeting only if a participant is a **known person** (email address in CRM) or their address domain matches an **organisation's website**. Everything else is discarded before storage, with no partial record. The domain must exactly match the website's domain (`mail.firma.example` does not match `firma.example` unless that subdomain is itself a registered website). A known person's address takes precedence. Domain matching excludes the user's address and domain, free mail providers such as `gmail.com`, single-label domains, known multi-tenant hosts such as `github.io` and `azurewebsites.net`, and public suffixes such as `co.uk`. The small list lives in `postfach/abgleich.ts`. For providers outside the list, matching on the person's address is the safe path. Merged people and organisations resolve to their merge targets.
- **Contacts from mailbox and calendar** (off by default). A global admin enables the feature in Administration (“Suggest” or “Create directly”). People opt in with their own mailbox in personal settings (off by default). The system keeps the address and display name of verified correspondents. These are recipients in the Sent folder (provider-backed Gmail label `SENT`, Graph folder `sentitems` or IMAP special-use folder `\Sent`, never a spoofable From header), or meeting participants where the user organised or explicitly accepted the event. Pending, tentative and declined invitations are excluded because anyone can send an invitation. Also excluded are the user's own address, known people and user accounts, installation domains, installation and personal blocklists, `no-reply` and similar addresses, messages with mailing-list or bulk headers, messages with more than 10 recipients, and meetings with more than 20 participants. Address lists are parsed according to RFC 5322 (address from angle brackets, never from the display name). Suggestions store only address, name and mailbox owner (person and scope), with no subject, body or message count. Only the mailbox owner sees their suggestions. Disconnecting, opting out or disabling the person removes their open suggestions. A created contact records whose mailbox supplied it and when. The audit log records only identifiers for suggestions and only the number of entries for blocklists.
- **Stored.** An email activity contains subject (up to 300 characters), date, direction and matched contacts (person, organisation and the deal if the organisation has exactly one open deal). It optionally includes the first 500 characters of the body (per-person switch, **off** by default). A meeting activity contains title, time and matched attendees. `aktivitaet_sync` also stores provenance: connection owner, provider, start and end, matched contact IDs, a hash of the message or event ID and, for mail, the provider message ID (only for fetching attachments on click).
- **Audit log.** For synced activities, only type, date and links are recorded. Subjects, titles and snippets are omitted because the append-only log would retain them after the person deleted the activity.

### Visibility

- **Connections, tokens and unmatched data** belong to the account owner. Every integration route filters by the signed-in person. Global admins also get 404 when trying to view or change another person's connection. No user can read credentials.
- **Imported activities follow CRM permissions.** They are visible to anyone who can see the linked deal (a role on its fund) or, without a deal, the organisation and person. The interface explains this before connection and requires consent. A linked deal from a fund the person cannot access makes the activity invisible to them.
- Each item shows provenance (“from your account” or “from another person's account”). The API does not identify the other account owner.

### User controls

- **Opt-in.** Reading requires consent and a personal connection. Mail and calendar are connected separately.
- **Remove.** The user can remove any imported message or meeting from their account's history. This deletes the activity and keeps only its hash to prevent reimport **for that user**.
- **Disconnect.** Encrypted credentials are deleted immediately. Imported activities remain until removed and become orphaned, with no owner syncing them. Another person with a connection in the same scope (mail or calendar) can take ownership only if their sync sees a matching item (mail: sender, time, subject and matched people; calendar: start, end and matched people) and their address belongs to the stored participants. Activities hold verification hashes (SHA-256 of activity ID and address) without storing the addresses. A message or event ID alone is insufficient because senders and organisers can choose it. On takeover the provider ID remains empty, so no attachments are available and no other mailbox's message is bound. The same run makes no edits or deletions, and the audit log records `uebernehmen` without content. Later runs by the new owner may update a meeting. A cancellation marks a taken-over meeting as “cancelled (reported)” and does not delete it. A person who removed the item cannot take it over. While the owner remains connected in that scope, other people cannot overwrite their activities. Older rows lack verification hashes and cannot be taken over. Deduplication uses a per-provider hash for new rows (also per organiser for calendar) and continues to recognise old rows by their old hash. An email that no one sees again stays unchanged on the contact. The grant remains with the provider until revoked there (Microsoft “My Apps”, Google “Security, third-party access”).
- **Text snippet.** Per-mailbox switch that applies to future syncs.
- **Attachments.** Available only on explicit request from the person whose mailbox created the activity. The list (name, size, type) is read live from the provider. A single attachment is imported as a **confidential** document, with the usual upload type and size checks and an editor role at the target. It links to the message's deal, or to the organisation if there is no deal. Only Microsoft 365 and Google support this. The worker alone renews expired access tokens. The request queues a sync and the person retries.

### Retention

Imported activities persist until the person removes them or the linked record is deleted. There is no automatic retention limit. The connection persists until disconnection. OAuth transactions expire after 10 minutes and are cleaned up on the next start. Backups include encrypted credentials. Store the key separately.

### Data protection

The integration processes personal data of employees (mailbox and calendar) and contacts (addresses, subjects and meetings). The **controller** determines the legal basis (for example employee consent or workplace rules) and informs data subjects. Consent in the UI is a technical control and the controller still needs to establish a legal basis. Include the **mailbox provider** (Microsoft, Google or the operator's mail server) in the subprocessor list or the controller's assessment once the integration is enabled. The same applies to the SMTP provider. The OAuth app registration belongs to the installation and runs in its operator's directory.

## Credentials and keys

OAuth tokens and IMAP credentials are stored only **encrypted** in the database using AES-256-GCM, with a random 96-bit IV per encryption and a key identifier in the value. Additional authenticated data (AAD) binds the value to its table and row, preventing copied values from being decrypted. Outbox bodies and OAuth PKCE verifiers have the same protection.

- `GEHEIMNIS_SCHLUESSEL` is 32 bytes encoded as Base64 (`openssl rand -base64 32`) or 64 hex characters. Without it, mailbox connections and mail with links remain off (`409 secret_missing`, `409 mail_not_configured`). A public development key is the default for demos and tests outside production. Neither `NODE_ENV=production` nor `CARRAWAY_UMGEBUNG=echt` permits that fallback.
- **Key rotation.**
  1. Generate a new key. Put the old key in `GEHEIMNIS_SCHLUESSEL_ALT` (comma-separated for multiple keys), set the new `GEHEIMNIS_SCHLUESSEL` and restart API and worker. New writes use the new key and old values stay readable.
  2. Run `pnpm --filter @carraway/api geheimnis:rotieren` (Compose: `docker compose exec carraway-worker node dist/geheimnis-rotieren.js`). It re-encrypts the values and reports which were rotated, already current or unreadable because a key is missing. If any value is unreadable, the script exits with an error and leaves it untouched.
  3. If everything is readable, remove the old key from `GEHEIMNIS_SCHLUESSEL_ALT` and restart. For backup retention, see [Key rotation](../operations/README.md#key-rotation).
- A lost key makes stored credentials unusable. People must reconnect. Unreadable outbox bodies fail with `GEHEIMNIS_FEHLER`.

## Configure providers

The app registrations belong to the installation. Use the redirect URI `<APP_ORIGIN>/api/v1/mailbox/callback` with `https://` and without a UI path.

| | Microsoft 365 | Google |
|---|---|---|
| Environment | `POSTFACH_MICROSOFT_CLIENT_ID`, `POSTFACH_MICROSOFT_CLIENT_SECRET`, `POSTFACH_MICROSOFT_TENANT_ID` (default `common`, directory ID for one organisation) | `POSTFACH_GOOGLE_CLIENT_ID`, `POSTFACH_GOOGLE_CLIENT_SECRET` |
| Flow | Authorisation code with PKCE (S256), `state` and `nonce` per transaction | Same, with `access_type=offline` and `prompt=consent` |
| Mailbox permissions | `Mail.Read` | `https://www.googleapis.com/auth/gmail.readonly` |
| Calendar permissions | `Calendars.Read` | `https://www.googleapis.com/auth/calendar.readonly` |
| Additional | `openid`, `email` (ID token for the account address and `nonce` check), `offline_access` (refresh without signing in again) | `openid`, `email` |

The application requests only read access. The ID token comes directly from the token endpoint over TLS, so the application relies on TLS in place of signature verification as permitted by OpenID Connect Core 3.1.3.7. It verifies audience, expiry and `nonce`. `state` is stored as a hash, tied to the signed-in person, valid for 10 minutes and single-use. Another person's state, an expired state or a replay creates no connection. The code verifier is encrypted in the database and absent from URLs. Tokens never appear in URLs or responses.

Only the worker refreshes access tokens. A lock serialises refresh per connection because rotating refresh tokens must not be used twice. New credentials are encrypted and saved immediately. If the provider revokes access or the refresh token is invalid, the connection shows “Please reconnect” and stops syncing.

### IMAP (operator-managed mail servers)

IMAP uses imapflow and opens folders read-only. The person supplies server, port, encryption (`tls`, `starttls`, `keine`), username, password, email address and up to three folders. A connection test runs before saving. Credentials are encrypted in the database. Sync records each folder's `UIDVALIDITY` and last UID. IMAP has no calendar support.

**Protection against server-side request forgery (SSRF).** The server connects to a user-supplied address. Without `POSTFACH_PRIVATE_ZIELE=1` all special ranges are blocked (`400 mailbox_target_forbidden`): local, private, link-local (including cloud metadata services), shared (`100.64.0.0/10`), `0.0.0.0/8`, `198.18.0.0/15`, documentation, multicast and reserved ranges. For IPv6, embedded IPv4 addresses (`::ffff:`, including hexadecimal forms, `::/96`, NAT64 `64:ff9b::/96`) are checked. 6to4 (`2002::/16`) and Teredo (`2001::/32`) are blocked outright. The hostname resolves **once**. All addresses are checked and the server connects directly to a checked address, using the hostname for TLS verification. This prevents a second DNS response from changing the destination through DNS rebinding. The fixed Microsoft and Google endpoints need no check. When enabling IMAP, restrict container egress to the destinations it requires. `POSTFACH_PRIVATE_ZIELE=1` lifts the block for self-hosters (default off). `POSTFACH_IMAP=0` disables IMAP.

### Sync

The worker syncs each connection every `POSTFACH_INTERVALL_MINUTEN` (default 15). The first run covers the last 30 days and reads up to 500 messages per run (the newest for Google). Later runs resume from the last position with a one-hour overlap. Calendar events cover 30 days back and 90 days ahead. Deduplication hashes the message ID (Message-ID header or provider ID) or event ID (iCalUID, per occurrence for recurring events). If several people receive the same message, the first sync owns it. Updates reuse the same activity **only through the originating person's connection**. Several people may have the same invitation ID, but another person's sync skips it and their version of the title, time or cancellation cannot update or delete the activity. Cancellations from the owner's account remove events. A failed sync sets an error code (`ZUGANG_UNGUELTIG`, `ANBIETER_NICHT_ERREICHBAR` and so on), omits the response body and waits one hour before retrying.

## Calendar subscription (ICS)

People can create a link for their calendar app that lists their **open follow-ups** as all-day events (`GET /api/v1/calendar/<Token>.ics`). The token contains 256 bits of randomness. The database stores only its hash and the token is shown once. Users can revoke or replace it, and the previous token expires immediately. Fetching needs no account and accepts no cookies. Each fetch verifies that the token is active, the person is active and is neither a technical nor an investor user. It includes only follow-ups assigned to the user whose deals they can see with their **current** roles. Per-IP and per-token limits match metric-request links (`429 too_many_requests`). Responses use `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`. **Anyone with the link can see follow-up titles** and the organisation and deal names in descriptions. The interface warns users against sharing it.

## Permission summary

| Feature | Who can use it |
|---|---|
| Settings, mailbox connection and disconnection, calendar link, mail opt-in | A human with a role on any fund, for their own account only. Investor users and API keys are excluded. |
| Remove a message or meeting from history | The person who connected the mailbox or calendar, if they can see the activity. |
| List attachments | The same person. Import also requires an editor role at the target. |
| See history and upcoming meetings | Follow CRM permissions (role on the deal's fund, or any role for organisations and people). |
| Email a metric request link | Editor on the investment's fund. |
| Email a notice about a portal update | Approver, as part of approving the notices. |
| SMTP status, test mail, outbox | Human global admins. |

## Checks before using a provider

The implementation follows provider documentation and has yet to be tested against live services.

- App registration. Check the redirect URI, account types (Microsoft: one organisation or `common`) and the publishing state of the Google app. Google requires verification for apps with more than a few users that use restricted `gmail.readonly` and `calendar.readonly` scopes. Microsoft may require consent from an organisation admin.
- Consent with `prompt` and `offline_access` / `access_type=offline`. Check that the provider issues a refresh token (otherwise connection fails with `REFRESH_TOKEN_FEHLT`) and check its lifetime (Microsoft on inactivity, Google seven days in test mode).
- Response shapes. Check Microsoft Graph (`mailFolders/inbox|sentitems/messages`, `calendarView`, `$filter` and `$orderby` combinations, `Prefer` headers, attachment `$value`), Gmail (`messages.list` with `q=after:`, `format=metadata`, attachment `attachments.get`) and Google Calendar (`events.list` with `singleEvents`, `showDeleted`). Check rate limits, throttling (`429`) and large mailboxes.
- Time zones, recurring events (iCalUID, `originalStart` / `originalStartTime`), all-day events and events across multiple calendars.
- IMAP against real servers (STARTTLS, Sent folder names, changes in `UIDVALIDITY`, character sets) and certificate verification for self-signed certificates (verification is always on).
- SMTP deliverability (SPF, DKIM and DMARC for the sending domain) and relay behaviour on errors.

Tests use fake servers and responses for PKCE, `state`, `nonce`, refresh, encryption, matching, deduplication, removal, attachments, calendar links and the outbox. They make no requests to live hosts.
