# Carraway betreiben (Selbst-Hosting)

Englische Fassung: [README.en.md](README.en.md)

Diese Anleitung beschreibt, wie Carraway auf einem eigenen Server läuft: ein Stack je Kunde mit Docker Compose, oder
mehrere Kunden auf einer gemeinsamen Postgres-Instanz mit je einer eigenen Datenbank.

## Bestandteile

| Dienst | Aufgabe | Befehl im Image |
|---|---|---|
| `datenbank` | PostgreSQL 18, Daten im Volume `datenbank` | (Postgres-Image) |
| `migrate` | einmalig: Datenbankstruktur anlegen oder auf den neuen Stand bringen, dann beendet sich der Container | `node dist/migrate.js` |
| `api` | API unter `/api/v1` und die Oberfläche vom selben Ursprung (`WEB_AUSLIEFERN=1`) | `node dist/server.js` |
| `worker` | rechnet die Kennzahlen-Snapshots (Warteschlange pg-boss), meldet seinen Herzschlag | `node dist/worker.js` |

Alle drei Rollen sind dasselbe Image (`Dockerfile` im Repository). Dateien freigegebener Berichte und hochgeladene Dokumente (`dokumente/…`) liegen im Volume `speicher`; die Sicherung enthält das ganze Volume. Die KI-Auslesung ist standardmäßig aus und wird mit `KI_ANBIETER` (und `KI_MODELL`, Zugangsdaten) in der Umgebung von API und Worker eingeschaltet, siehe `docs/sicherheit/KI-Auslesung.md`.

## Voraussetzungen

- Docker mit dem Compose-Plugin (Compose 2.20 oder neuer), ein Server in dem Land, das der Vertrag mit dem Kunden vorsieht
  (für Kunden in Deutschland: ein Rechenzentrum in Deutschland).
- Eine Adresse (DNS-Name) und ein Reverse-Proxy mit TLS-Zertifikat davor (siehe unten). Die API selbst spricht kein TLS.
- Als Richtwert 2 GB Arbeitsspeicher und 2 CPU-Kerne je Kunde; die PDF-Berichte rechnet Typst im API-Prozess. Die tatsächliche Größe an der Last messen (`/metriken`).

## Installation

```bash
git clone <Adresse des Repositories> carraway && cd carraway/deploy
cp .env.beispiel .env
$EDITOR .env            # Pflichtwerte ausfüllen, Hinweise stehen in der Datei
docker compose up -d --build
docker compose ps       # alle Dienste "healthy", migrate "exited (0)"
```

Der Stack startet nicht, wenn eine Pflichtvariable fehlt (`docker compose` bricht mit dem Namen der Variable ab). Es gibt keine
Standardpasswörter. Ein fertiges Image aus der eigenen Registry statt `--build`: `CARRAWAY_IMAGE` in der `.env` setzen.
Der Stack baut den Kern (`CARRAWAY_VARIANTE=kern`, Vorgabe; `docs/open-core.md`). Die Erweiterungen (Excel-Add-in, LP-Portal, ESG,
Single Sign-On, KI) gibt es nur im Hosting durch Rehlytics; ihr Image liegt nur in einer privaten Registry.

Zufallswerte erzeugen: `openssl rand -hex 24` für die Datenbank-Passwörter, `openssl rand -base64 48` für `BETTER_AUTH_SECRET`.

### Erste Verwalterin oder erster Verwalter (`/einrichtung`)

Solange es noch keine Person gibt, ist `/einrichtung` offen: Wer die Seite zuerst aufruft, wird globale Verwalterin bzw. globaler
Verwalter. Deshalb zuerst einrichten, dann ins Netz stellen:

1. Der Stack lauscht nur auf `127.0.0.1:8787` (`API_BIND`). Per SSH-Tunnel (`ssh -L 8787:127.0.0.1:8787 server`) die Adresse
   `http://localhost:8787/einrichtung` öffnen. Wichtig: `APP_ORIGIN` muss der Adresse im Browser entsprechen; für diesen Schritt
   `APP_ORIGIN=http://localhost:8787` setzen und danach auf die öffentliche Adresse stellen (`docker compose up -d api`).
2. Name, E-Mail-Adresse und ein Passwort mit mindestens 12 Zeichen eintragen.
3. Anmelden. Ist `ZWEI_FAKTOR_PFLICHT=1` (Vorgabe), führt die Oberfläche durch die Einrichtung der Authenticator-App; Rückfallcodes
   sicher ablegen.
4. Weitere Personen legt die Verwaltung unter „Verwaltung“ an (Startpasswort, das beim ersten Anmelden zu ändern ist), oder sie
   melden sich über die Firmenanmeldung an (Entra ID/Google, `OIDC_*`), wenn sie vorher mit derselben Adresse angelegt wurden.

Danach antwortet `/einrichtung` mit `REGISTRIERUNG_GESCHLOSSEN`.

## Bestände: demo, test, echt

`CARRAWAY_UMGEBUNG` kennzeichnet den Bestand. Die Oberfläche zeigt in `demo` und `test` ein Banner, im Bestand `echt` nicht.

| Bestand | Zweck | Besonderheiten |
|---|---|---|
| `demo` | Vorführung, Übungsdaten | darf aus einem Checkout mit dem Seed-Skript (`pnpm db:seed`) gefüllt werden; das legt Demo-Zugänge mit bekannten Passwörtern an, deshalb nur nicht öffentlich erreichbar betreiben |
| `test` | Abnahme, Probebetrieb mit erfundenen oder abgestimmten Daten | das Seed-Skript ist technisch auch hier erlaubt; Banner wie `demo` |
| `echt` | Echtdaten | `APP_ORIGIN` muss `https://` sein, `BETTER_AUTH_SECRET` mindestens 32 Zeichen, das Seed-Skript verweigert die Arbeit |

Jeder Bestand ist ein eigener Stack mit eigener Datenbank und eigenem Geheimnis (anderes `COMPOSE_PROJECT_NAME`, anderer
`API_PORT`). Übungsdaten gehören nie in den Echtbestand und umgekehrt: Wer Echtdaten für Tests braucht, spielt keine
Sicherung des Echtbestands in den Testbestand ein. Mit `NODE_ENV=production` (im Image gesetzt) verlangen API und Worker
immer ein eigenes `BETTER_AUTH_SECRET` und eine ausdrückliche `DATABASE_URL`.

## Mail und Kalender

Beides ist standardmäßig aus. Ausgehende Mail (Kennzahlen-Links an Unternehmen, Hinweise auf Mitteilungen im Portal, Berichtsfreigaben) braucht `SMTP_HOST`
und `SMTP_ABSENDER`; die Anbindung von Postfach und Kalender und jede Mail mit einmaligem Link brauchen zusätzlich `GEHEIMNIS_SCHLUESSEL`
(`openssl rand -base64 32`). Die Verwaltung prüft den Stand unter „Konto, Mailversand“ (ohne Geheimnisse) und schickt eine Testmail an die eigene Adresse.
Die App-Registrierungen bei Microsoft und Google (`POSTFACH_*`, nur Leserechte), IMAP, Schlüsselwechsel und die Hinweise zum Datenschutz stehen in
`docs/sicherheit/Mail-und-Kalender.md`; alle Variablen mit Erläuterung in `.env.beispiel`.

Für die Demo gibt es einen Mailfänger: `docker compose --profile demo-mail up -d` startet `mailpit` (nur auf `127.0.0.1:8025`), in der `.env` zeigen
`SMTP_HOST=mailpit`, `SMTP_PORT=1025` und `SMTP_TLS=keine` darauf. Nichts verlässt den Rechner. Erfundene Mails und Termine für die Demo-Person Vera legt
`pnpm --filter @carraway/api demo:postfach` an (nach `pnpm db:seed`, mit dem Demo-Anbieter ohne Konto).

## Reverse-Proxy und TLS

Die API gehört hinter einen Reverse-Proxy (Caddy, nginx, Traefik oder der des Hosting-Anbieters), der TLS beendet.

- `APP_ORIGIN` ist die öffentliche Adresse mit `https://`, ohne Pfad (mehrere mit Komma). Sie bestimmt Cookies (`Secure`), den
  Rückruf der Firmenanmeldung und die erlaubten Ursprünge: Schreibende Anfragen mit einem fremden `Origin` lehnt die API ab.
  Bei `https://`-Adressen sendet die API `Strict-Transport-Security`.
- `PROXY_VERTRAUEN=1` nur setzen, wenn der Proxy `X-Forwarded-For` selbst setzt oder anhängt. Die API nimmt den **letzten** Eintrag
  als Adresse des Clients (Begrenzung der Fehlversuche je Adresse). Der Proxy darf keinen vom Client mitgeschickten Kopf
  unverändert durchreichen, sondern muss die Adresse anhängen (nginx: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`).
  Ohne Proxy bleibt der Wert `0`, sonst kann jeder die Adresse fälschen.
- Dem Proxy gehören: TLS (mindestens TLS 1.2), HTTP/2, Kompression, Obergrenze für Anfragegrößen (Uploads der Datenübernahme bis 20 MB, Kontaktimport bis 2 MB; eine Obergrenze von 25 MB genügt), Zugriffsbeschränkung
  für `/metriken` (der Endpunkt hat zusätzlich ein Token).
- Der Proxy leitet alles (`/`, `/api/`) an `127.0.0.1:8787` weiter. Ein mitgeschickter `X-Request-Id` (8 bis 64 Zeichen aus
  `A-Za-z0-9._-`) erscheint in den Logs und in der Antwort.
- `AKTEUR_HEADER_VERTRAUEN` nicht setzen, außer ein vertrauenswürdiger Proxy entfernt `X-Akteur` vom Client und setzt ihn selbst.
- Die API setzt `X-Content-Type-Options`, `X-Frame-Options: DENY` und `frame-ancestors 'none'` für die Oberfläche. Eine
  weitergehende Content-Security-Policy gehört bei Bedarf in den Proxy.

## Beobachtung

- **Logs:** eine JSON-Zeile je Ereignis auf der Standardausgabe (`docker compose logs -f api worker`), Mindeststufe `LOG_STUFE`.
  Anfragezeilen enthalten Anfrage-ID, Methode, Routenmuster, Status, Dauer in Millisekunden und die Benutzer-ID; keine Adressen,
  Namen, Beträge, Abfragezeichenfolgen oder Geheimnisse. Fehler werden ohne Abfrageparameter protokolliert.
- **Gesundheit:** `GET /api/v1/gesundheit` ist ohne Anmeldung erreichbar. 200 heißt, die Datenbank antwortet; 503, sie antwortet nicht.
  Zusätzlich: `worker.status` (`ok`, `ausgefallen` bei mehr als 30 Sekunden ohne Herzschlag, `unbekannt` ohne je einen Herzschlag),
  `warteschlange.wartend` und `aeltesterWartenderSekunden` (Verzug in pg-boss) sowie `ausgangskorb` (Aufträge, die der Worker noch
  nicht übernommen hat; wächst bei einem toten Worker). Ein Worker-Ausfall macht die API nicht unbereit.
- **Metriken:** `GET /metriken` (Prometheus-Textformat, `Authorization: Bearer <METRIKEN_TOKEN>`). Ohne `METRIKEN_TOKEN` ist der
  Endpunkt aus. Anfragedauer als Histogramm je Methode, Routenmuster und Statusklasse, Datenbank-Verbindungen, Warteschlange,
  Ausgangskorb, Worker-Herzschlag.
- **Betriebsstatus:** Verwaltung → Betrieb (`GET /api/v1/betrieb/status`, nur globale Verwalter): Datenbank, Migrationsstand, Alter des
  Worker-Herzschlags, Rückstände (Snapshots, Mail, KI-Auslesung, Registerbeobachtung), Schreibbarkeit der Dateiablage, SMTP eingerichtet ja oder
  nein, KI-Anbieter. `/metriken` führt Herzschlag-Alter und Rückstände (`carraway_rueckstand_*`) für Alarme.
- **Container-Health:** `api` über die Gesundheitsabfrage, `worker` über seine Herzschlag-Datei. Docker startet unhealthy Container
  nicht von selbst neu; dafür eine Überwachung (z. B. HetrixTools, Prometheus mit Alarmen, `docker-autoheal`) vorsehen.

## Daten ein- und ausspielen

Alle Wege laufen über die Anwendung und stehen im Änderungsprotokoll; sie brauchen keinen Zugriff auf die Datenbank.

- **Datenübernahme** (Seitenleiste „Datenübernahme“): Excel- oder CSV-Datei aus der Vorlage hochladen, prüfen, übernehmen (Hochladen
  und Prüfen ab Rolle Bearbeiter, Übernehmen durch eine andere Person mit der Rolle Freigeber an jedem berührten Fonds). Die Übernahme ist
  eine Transaktion und je Fonds wiederholbar; das Abnahmeprotokoll des Laufs gibt es als PDF und Excel. Kontakte (Organisationen,
  Personen, Rollen) importiert „Kontakte → Importieren“. Hochgeladene Dateien liegen als Importlauf in der Datenbank und gehören damit zur Sicherung.
- **Vollexport** (Verwaltung → „Export und API“, nur globale Verwalter): ZIP mit einer CSV-Datei je Tabelle, den freigegebenen
  Berichtsdateien, `schema.json`, `rechenregeln.md` und einem Manifest mit Prüfsummen. Er enthält keine Passwörter, Sitzungen und
  API-Schlüssel-Hashes und wird beim Herunterladen gestreamt (bei großen Beständen dauert er). Er ist der offene Rückgabeweg am
  Vertragsende; für die technische Wiederherstellung bleibt die Sicherung zuständig.
- **API:** Die OpenAPI-Beschreibung (`/api/v1/openapi.json`) und eine Dokumentationsseite (`/api/v1/docs`, ohne Skripte und externe Dateien)
  sind ohne Anmeldung erreichbar; wer das nicht will, sperrt beide Pfade im Proxy. Schreibende Aufrufe nehmen `Idempotency-Key` an
  (24 Stunden), `POST /api/v1/stapel` fasst bis zu 100 Operationen in einer Transaktion zusammen, `GET /api/v1/aenderungen` liefert
  Änderungen seit einem Zeitpunkt.
- **Schriften:** Die Oberfläche liefert Instrument Sans und IBM Plex Mono selbst aus; beim Aufruf der Seite gehen keine Anfragen an Drittanbieter.

## Rechte der Datenbank

Zwei Rollen je Mandant, angelegt von `deploy/sql/mandant.sql` (beim ersten Start des Compose-Stacks und durch `mandant-anlegen.sh`):

| Rolle | Aufgabe | Rechte |
|---|---|---|
| `<db>_eigentuemer` | gehört der Datenbank, führt die Migrationen aus | alle (DDL) im eigenen Schema `public` und `drizzle` |
| `<db>_app` | Laufzeit von API und Worker | `SELECT`, `INSERT`, `UPDATE`, `DELETE` auf den Tabellen im Schema `public`, Sequenzen; **kein** `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, kein Zugriff auf `drizzle` |

Gemessen am Code und an einem Lauf gegen eine frische Datenbank: Die Anwendung braucht im Schema `public` kein DDL. Eine Ausnahme
gibt es: **pg-boss** (die Warteschlange) legt seine Tabellen und Partitionen im Schema `pgboss` zur Laufzeit selbst an. Deshalb gehört
dieses Schema der App-Rolle (`CREATE SCHEMA pgboss AUTHORIZATION <db>_app`), und `PGBOSS_SCHEMA_ANLEGEN=0` verhindert, dass pg-boss
ein `CREATE SCHEMA` versucht (das bräuchte das Recht `CREATE` auf der ganzen Datenbank). Im Schema `pgboss` liegt außerdem die kleine
Tabelle `carraway_herzschlag`, die der Worker selbst anlegt. Der Datenbank-Zugriff ist auf die Rollen des Mandanten beschränkt
(`REVOKE ... FROM PUBLIC`): Andere Rollen derselben Instanz kommen nicht in die Datenbank.

## Datenbank je Kunde auf einer gemeinsamen Postgres-Instanz

Wer mehrere Kunden auf einer Instanz betreibt (statt je einen Compose-Stack), legt je Kunde eine Datenbank an:

```bash
export DATABASE_URL_SUPERUSER=postgres://admin@db.intern:5432/postgres   # Passwort über PGPASSWORD oder ~/.pgpass
DB_HOST=db.intern deploy/mandant-anlegen.sh musterkunde
# erzeugt mandanten/musterkunde.env (Rechte 600) mit DATABASE_URL_EIGENTUEMER und DATABASE_URL
docker run --rm --env-file mandanten/musterkunde.env -e CARRAWAY_UMGEBUNG=echt <image> node dist/migrate.js
```

Danach laufen `api` und `worker` des Kunden mit `DATABASE_URL` (nur diese, nicht `DATABASE_URL_EIGENTUEMER`) und
`PGBOSS_SCHEMA_ANLEGEN=0`. Die Passwörter generiert das Skript (oder `EIGENTUEMER_PASSWORT` und `APP_PASSWORT`). Das Skript ist
wiederholbar; ein zweiter Lauf setzt die Passwörter neu. Je Kunde ein eigenes Geheimnis `BETTER_AUTH_SECRET`, eine eigene Dateiablage
und eine eigene Adresse.

## Aktualisieren

```bash
cd carraway && git pull && cd deploy
./sicherung.sh                           # immer vorher sichern
docker compose up -d --build             # baut das Image neu, migrate läuft vor api und worker
docker compose ps && curl -s http://127.0.0.1:8787/api/v1/gesundheit
```

### Umstieg vom früheren Produktnamen

Neue Installationen verwenden überall den Namen `carraway`: Compose-Projekt, Datenbank `carraway`, Rollen `carraway_admin`, `carraway_app` und
`carraway_eigentuemer`, Images `carraway:kern` und `carraway:voll`, Sicherungsordner `carraway-<Datenbank>-<Zeitstempel>`. Eine Installation,
die unter dem früheren Namen `fundament` angelegt wurde, behält ihre Daten, wenn die alten Namen in der `.env` festgehalten werden. Ohne diese
Zeilen legt Compose neue, leere Volumes an und die Rollen heißen anders:

```bash
COMPOSE_PROJECT_NAME=fundament      # bestimmt die Namen der Volumes
DB_NAME=fundament                   # Rollen fundament_app und fundament_eigentuemer
DB_ADMIN_BENUTZER=fundament_admin
CARRAWAY_IMAGE=fundament:kern       # nur falls das Image unter dem alten Namen gebaut und festgehalten wurde
```

Mandantendatenbanken (`fundament_<kunde>`) behalten ihren Namen; `DB_NAME` bzw. `DATABASE_URL` des Mandanten zeigt weiter darauf. Weitere Änderungen
beim Aktualisieren einer bestehenden Installation:

- Umgebungsvariablen: `FUNDAMENT_UMGEBUNG` heißt `CARRAWAY_UMGEBUNG`, `FUNDAMENT_IMAGE` heißt `CARRAWAY_IMAGE`. Die alten Namen gelten nicht
  mehr; vor dem Aktualisieren in der `.env` umbenennen, sonst bricht `docker compose` ab (`CARRAWAY_UMGEBUNG fehlt`).
- Metriken unter `/metriken`: Das Präfix `fundament_` heißt jetzt `carraway_`. Alarmregeln und Dashboards anpassen.
- Die Herzschlag-Tabelle des Workers heißt `pgboss.carraway_herzschlag` und wird vom Worker selbst angelegt. Die alte Tabelle
  `pgboss.fundament_herzschlag` bleibt liegen und lässt sich löschen: `DROP TABLE IF EXISTS pgboss.fundament_herzschlag;`.
- Sicherungen: Neue Ordner heißen `carraway-<Datenbank>-…`. Die Aufbewahrungsfrist von `sicherung.sh` erfasst nur Ordner mit diesem Namen; ältere
  Ordner `fundament-<Datenbank>-…` bleiben bestehen und lassen sich von Hand löschen oder umbenennen. `wiederherstellung.sh` nimmt jeden Ordner.
- Schlüssel: Bereits ausgegebene API- und Werteschlüssel (`fdk_…`, `fdw_…`) gelten weiter, neue beginnen mit `cwk_` und `cww_`.
- Excel-Add-in: Der Namensraum der Funktionen ist `CARRAWAY`. Formeln mit dem früheren Namensraum in bestehenden Arbeitsmappen mit „Suchen und
  Ersetzen“ umstellen; das Manifest neu laden.
- Im Browser sind Sprache, Thema und gewählter Fonds einmal neu zu wählen (die Speicherschlüssel haben neue Namen).

Die Migration ist wiederholbar und läuft bei jedem `up` vor `api` und `worker`. Sie hat keinen Rückwärtsgang: Rückkehr zum alten Stand
heißt, die Sicherung wiederherzustellen und das alte Image zu starten. Versionen des Images mit Tag oder Digest festhalten, damit
ein Rückweg bekannt ist. API und Worker prüfen beim Start, ob die Datenbank genau die Migrationen hat, die der Code kennt, und beenden sich
sonst mit einer klaren Zeile im Protokoll (ein älteres Image gegen eine neuere Datenbank startet nicht). Ablauf und Rückwegregel:
[docs/betrieb/README.md](../docs/betrieb/README.md).

## Sicherung und Wiederherstellung

```bash
SICHERUNG_ZIEL=/mnt/sicherung ./sicherung.sh                 # Datenbank + Dateiablage, Prüfsummen, Aufbewahrung 14 Tage
./wiederherstellung.sh /mnt/sicherung/carraway-carraway-20261120-120000
```

Eine Sicherung besteht aus `datenbank.dump` (`pg_dump` im Custom-Format, Schemas `public` und `drizzle`), `speicher.tar.gz`
(alle Dateien der Ablage: Dokumente, Berichte, Berichtsfassungen, Mitteilungen, Belege, Buchungsexporte, Meldedateien), `SHA256SUMS` und
`INFO.txt` (mit den Zeitpunkten von Datenbank und Dateiablage; erst Datenbank, dann Dateien, Begründung im Runbook). Die Warteschlange (`pgboss`) ist nicht dabei; sie hält nur flüchtige
Aufträge, Kennzahlen-Snapshots lassen sich neu berechnen.

- Die Sicherung gehört auf ein anderes Medium und an einen anderen Ort als die Daten (anderer Server, Objektspeicher, Band). Zeitplan
  mit `cron` oder einem Systemd-Timer, z. B. täglich um 02:00: `0 2 * * * cd /opt/carraway/deploy && SICHERUNG_ZIEL=/mnt/sicherung ./sicherung.sh`.
- `SICHERUNG_AUFBEWAHREN_TAGE` (Vorgabe 14) löscht ältere Sicherungen dieses Mandanten; `0` löscht nie.
- Der Compose-Modus führt `pg_dump` im Datenbank-Container aus, damit Client und Server dieselbe Version haben. Der Direkt-Modus
  (`--direkt`, eigene Instanz) bricht ab, wenn der Client älter ist als der Server.
- Die Wiederherstellung hält `api` und `worker` an, legt die Datenbank mit denselben Rollen und Rechten neu an, spielt Dump und
  Dateien ein und startet beide wieder. Sie überschreibt den aktuellen Stand und fragt deshalb nach (`--ja` überspringt die Frage).
- **Wiederherstellung üben:** Einmal im Quartal und nach jeder größeren Änderung eine Sicherung in einen leeren Probe-Stack
  einspielen (anderer `COMPOSE_PROJECT_NAME`) und anmelden. Für die Technik gibt es den automatischen Test `pnpm ops:sicherung-test`
  im Repository (Dump, Wiederherstellung in eine frische Datenbank, Vergleich von Zeilenzahl und Prüfsumme aller Tabellen und
  SHA-256-Vergleich der Dateien jeder Dateiart); er läuft in der CI bei jedem Stand von `main`. Nach einer echten Wiederherstellung
  prüft `pnpm ops:dateien-pruefen` Datenbank und Dateiablage gegeneinander. Das ganze Runbook (Sicherung, Wiederherstellung,
  Schlüsselwechsel, Aktualisieren, Rückweg): [docs/betrieb/README.md](../docs/betrieb/README.md).

Was nicht in der Sicherung steckt und gesondert verwaltet wird: die `.env`-Datei (Geheimnisse) und die Proxy-Konfiguration. Ohne
`BETTER_AUTH_SECRET` aus dem Zeitpunkt der Sicherung bleiben Authenticator-Apps ungültig (die TOTP-Geheimnisse sind damit
verschlüsselt); die Passwörter selbst sind gehasht und bleiben gültig.

## Fehlersuche

| Beobachtung | Ursache und Abhilfe |
|---|---|
| `docker compose` bricht mit „… fehlt“ ab | Pflichtvariable in `.env` fehlt (Namen siehe Meldung und `.env.beispiel`) |
| `api` startet nicht: `BETTER_AUTH_SECRET … Pflicht` | Geheimnis zu kurz (mindestens 32 Zeichen) oder bei `https`-Adresse nicht gesetzt |
| Anmeldung scheitert mit `ORIGIN_UNGUELTIG` | `APP_ORIGIN` entspricht nicht der Adresse im Browser (Schema, Host, Port) |
| viele Fehlversuche, Sperre für alle hinter dem Proxy | `PROXY_VERTRAUEN=1` fehlt, die API sieht nur die Adresse des Proxys |
| `worker.status` ist `ausgefallen` oder `unbekannt` | `docker compose logs worker`; läuft der Dienst, prüfen, ob `migrate` erfolgreich war |
| `ausgangskorb` wächst | Worker steht oder erreicht die Datenbank nicht; Aufträge gehen nicht verloren und werden nachgeholt |
