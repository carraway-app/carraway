# Technical and organisational measures (TOMs)

Template for operating Carraway under Article 32 GDPR. Complete it for each installation. The “Implementation” column describes what the software does, as checked against the code (see the header of the installation's copy for the version). Hosting measures depend on the provider and deployment model and must be completed for each installation.

| Field | Value |
|---|---|
| Controller | [Name and address] |
| Processor | [Name and address] |
| Deployment model | [Compose stack per installation / shared Postgres instance with one database per installation / on premises] |
| Hosting provider and location | [Provider, data centre, country] |
| Software version | [Version or image digest] |
| Document date | [Date] |

The “Source” column uses **S** for software (implemented in Carraway), **K** for configuration by the operator, **H** for hosting provider or operations (supply evidence per installation), and **O** for organisational measures (process).

## 1 Confidentiality (Article 32(1)(b))

### 1.1 Physical access control

| Measure | Implementation | Source |
|---|---|---|
| Physical access to servers | Hosting provider's data centre: [access rules, provider certifications such as ISO 27001 for the data centre, supporting evidence] | H |
| Physical access to the processor's workplaces | [Describe locked rooms and device locks] | O |

### 1.2 Sign-in controls

| Measure | Implementation | Source |
|---|---|---|
| Password sign-in | Passwords are 12 to 128 characters long. The database stores only scrypt hashes (Better Auth, `node:crypto.scrypt`). The new password must differ from the previous one. | S |
| Initial password | Accounts created in Administration must change the initial password on first sign-in. Other routes return 403 `password_change_required` until then. | S |
| Password reset and invitations | Requires outgoing mail. Single-use links expire after 30 minutes for resets and 72 hours for invitations. The database stores only hashes. Requests respond identically for every address and are rate-limited per IP and per address. The second factor stays in place and all sessions end. See [Mail and calendar](mail-and-calendar.md). | S |
| Two-factor authentication | Time-based one-time passwords (TOTP, RFC 6238) for each person, required by default (`ZWEI_FAKTOR_PFLICHT=1`). Without a second factor, all routes except setup are blocked (403 `two_factor_required`). Recovery codes are available. TOTP secrets are encrypted with `BETTER_AUTH_SECRET`. “Remember device” and one-time codes by email are disabled. Each sign-in requires a code. | S, K |
| Single sign-on (SSO) | Optional in managed hosting through OpenID Connect with Microsoft Entra ID (fixed directory ID) and Google (`OIDC_*`). SSO creates accounts only when registration is open. Otherwise admins create the account first. Linking accounts by email requires a fixed Entra directory. | S, K |
| Password guessing protection | At most 10 failed attempts in 15 minutes per IP address and account across sign-in, one-time codes and recovery codes, followed by 429 `too_many_attempts` with `Retry-After`. Counters are stored in the database. Behind a reverse proxy, `PROXY_VERTRAUEN=1` is needed for the API to see client IP addresses. | S, K |
| Sessions | Session cookie with `HttpOnly`, `SameSite=Lax` and `Secure` for `https://`. Sessions last 12 hours and refresh during use at most every 30 minutes. The session IP is stored only with `PROXY_VERTRAUEN=1`. | S |
| Cross-site request forgery (CSRF) protection | Write requests must carry the configured `Origin` (`APP_ORIGIN`). A cookie without an origin is rejected. | S |
| Disable accounts | Admins can disable accounts. The only active global admin cannot be disabled or stripped of that role. | S |
| Set up a new installation | `/einrichtung` stays open until the first person exists and makes that person an admin. It then returns 403. Complete setup before exposing the installation to the network (see [self-hosting](../../deploy/README.en.md)). | S, O |
| Administrative server access | [Key-only SSH, two-factor authentication for control panels, roles and provider logging] | H, O |

### 1.3 Authorisation controls

| Measure | Implementation | Source |
|---|---|---|
| Fund roles | Four levels in ascending order: viewer, editor, approver and admin. Global admins also exist. A central table (`rechte/tabelle.ts`) sets each route's minimum role. Unlisted routes are denied (401 without authentication, 403 otherwise). The role is checked on the fund of the affected record. | S |
| Visibility | Lists and analyses show only funds where the person has a role. | S |
| Separation of duties (four-eyes principle) | A different person approves valuations, interest runs, reports, decisions and transfer of a deal into the portfolio from the person who prepared or reviewed them. Each report stage needs a different person. Anyone who edited a section cannot approve it. Only human approvers can issue affirmative decisions and approvals. | S |
| Period lock | A lock date per fund. The server rejects postings to locked periods (409 `period_locked`) and a database trigger enforces the lock. Removing the lock requires a reason and is logged. | S |
| API keys | Only global admins create keys. Each key is shown once and the database stores only its SHA-256 hash. Each key has its own technical user, per-fund read or write permissions (without approval), an expiry (default 90 days, up to 365) and can be revoked. | S |
| Mailbox and calendar integration | Voluntary and per user. Credentials (OAuth tokens and IMAP credentials) are encrypted in the database using AES-256-GCM with row binding and key rotation (`GEHEIMNIS_SCHLUESSEL`). They are unreadable even to admins. The integration requests read-only access and keeps matches with known CRM contacts. Attachments require an explicit request. See [Mail and calendar](mail-and-calendar.md). | S, K |
| Outgoing mail | SMTP credentials come from the environment. Outbox bodies are encrypted and deleted after sending. An hourly limit applies. Messages have no tracking and logs omit bodies. | S, K |
| Database permissions | The application role has no DDL rights in the `public` schema (only SELECT, INSERT, UPDATE and DELETE). A separate owner role runs migrations. Other roles on a shared instance have no access to the database. The application role owns the queue schema `pgboss`. See [Database privileges](../../deploy/README.en.md#database-privileges). | S, K |
| Administrative access to data | [Who at the processor can access the database or backups, why and how access is logged] | O, H |

### 1.4 Separation

| Measure | Implementation | Source |
|---|---|---|
| Tenant separation | One database or a separate stack per installation, with separate roles, `BETTER_AUTH_SECRET` and file storage. | S, K |
| Separation of demo, test and production | `CARRAWAY_UMGEBUNG` (demo, test, echt) per stack. The seed script for demo data and accounts is blocked in production. The interface marks demo and test environments with a banner. | S, K |

### 1.5 Pseudonymisation and encryption

| Measure | Implementation | Source |
|---|---|---|
| Encryption in transit | A reverse proxy terminates TLS (at least 1.2). With `https://`, the API sets `Secure` cookies and `Strict-Transport-Security`. Production accepts only `https://` URLs. Between proxy and API: [loopback or internal network]. Between API and database: [host's Compose network, or configure TLS for a separate database]. | K, H |
| Encryption at rest | The application encrypts TOTP secrets and stores only hashes of passwords and API keys. Database and file storage encryption are the operator's responsibility. Disk encryption: [provider encryption or LUKS, key management]. | S, H |
| Backup encryption | [Encrypt at the storage location or before transfer, e.g. age/GPG, and record where keys are kept] | H, O |
| Pseudonymisation | The software includes no pseudonymisation feature. Logs contain only the user ID. Demo data is fictional. | S |

## 2 Integrity (Article 32(1)(b))

### 2.1 Disclosure controls

| Measure | Implementation | Source |
|---|---|---|
| Disclosure through the API only | Access requires an authenticated session or API key. There is no public file or data sharing. Report files require at least a viewer role on the fund. | S |
| Read access logging | Reading fund reports, portfolio lists, quarterly reports, board papers or approved report files appends a `gelesen` row (who, when and what) to the audit log. | S |
| Third-party disclosure | Maintain a list of subprocessors. The software uses no advertising, analytics or tracking services. The interface serves its own fonts without fetching Google Fonts, which a test verifies. | S, O |

### 2.2 Input controls

| Measure | Implementation | Source |
|---|---|---|
| Audit log | Each write request adds a row in the same transaction (actor, display name, action, table, record, before and after). A database trigger makes the table append-only by rejecting UPDATE and DELETE. This protects against application writes and mistakes. Database owners can bypass it. Restrict and log database owner access: [provider controls]. | S, H |
| Immutable postings | Triggers make transactions, approved valuations and approved reports immutable. A correction uses a reversal or a new version. | S |
| Input validation | All inputs are validated against Zod schemas. Amounts use decimals with at most two fractional digits. | S |
| Application logs | JSON logs record request ID, method, route pattern, status, duration and user ID. They omit addresses, names, amounts, query strings and secrets. Error messages omit query parameters. Retention: [period and location]. | S, H |

## 3 Availability and resilience (Article 32(1)(b) and (c))

| Measure | Implementation | Source |
|---|---|---|
| Backup | `deploy/sicherung.sh` backs up the database (`pg_dump`, custom format) and file storage with checksums and configurable retention (default 14 days). Schedule and storage: [interval, retention and location separate from production]. | S, K, H |
| Restore rehearsal | `deploy/wiederherstellung.sh` and the automated `pnpm ops:sicherung-test` test (dump, restore to a fresh database, compare row count and checksum per table) run in CI for each revision of `main`. Installation restore: [date and result of last rehearsal]. | S, O |
| Recovery objectives | [Contractual RPO and RTO, e.g. 24 hours and 8 hours] | O |
| Monitoring | `GET /api/v1/health` (database, worker heartbeat and queue lag), `GET /metriken` in Prometheus format with a dedicated token, and container health checks. Alerts: [service, recipients and response time]. | S, K, H |
| Infrastructure resilience | [Power, network and storage redundancy, database high availability if agreed] | H |
| Overload protection | Application timeouts for database queries (5 s) and locks (2 s). Reverse proxy request-size and rate limits: [configuration]. | S, K |
| Restart | Containers restart on host reboot (`restart: unless-stopped`). Queued jobs persist, with the outbox in the database. | S |
| Protection against malware and attacks | [Host hardening, firewall, OS updates, intrusion detection] | H |
| Container hardening | Runs without root, with a read-only filesystem, no additional Linux capabilities and `no-new-privileges`. | S |

## 4 Regular review procedures (Article 32(1)(d) and Article 25)

| Measure | Implementation | Source |
|---|---|---|
| Automated tests and checks | CI runs lint, type checking, tests (including permissions, sign-in and database tests) and a build on changes. Pushes to `main` also build the image and test restoration. | S |
| Vulnerability management | See `SECURITY.md` for reporting and response timelines. Dependencies are pinned through the lockfile (`pnpm install --frozen-lockfile` and a tag and digest for the base image). The repository has no automated check against vulnerability databases: [operator's procedure]. | S, O |
| Privacy by default | Registration closed, two-factor authentication required, metrics off and no external database access. | S |
| Data protection impact assessment and records of processing activities | [The controller maintains them with input from the processor] | O |
| Training and confidentiality obligations | [Confidentiality commitments and training for people with access] | O |
| Handling data protection incidents | [Reporting and escalation channel, deadlines from the data processing agreement, contact person] | O |
| Deletion and return | Delete records through the application where business rules allow it. At contract end, return the database dump and file storage, then delete the database, backups and volumes: [deadline and evidence]. | S, O |

## 5 Data processed (for the records of processing activities)

Stored data includes user accounts (name, email address, password hash, encrypted TOTP secret and sessions), dealflow and investment contacts (first name, surname, email address, role, organisation and free-text activities), fund and investment data, and amounts. With mailbox and calendar integration enabled, it also includes subjects, dates and participants of emails and meetings with known contacts, optional beginnings of mail bodies, encrypted credentials and the outgoing mail outbox (recipient, subject, status). The application has no dedicated fields for special categories of personal data. Users could enter such data in free-text fields: [notice to users].
