# Betrieb: Sicherung, Wiederherstellung, Schlüsselwechsel, Aktualisieren

Kurzes Runbook für den Betrieb mit dem Compose-Stack aus `deploy/` (Einzelheiten zu Installation, Proxy und Rollen in
[deploy/README.md](../../deploy/README.md)). Alle Befehle laufen im Verzeichnis `deploy/`, wenn nichts anderes steht.

## Was zu einem Stand gehört

| Teil | Wo | In der Sicherung |
|---|---|---|
| Datenbank (Schemas `public` und `drizzle`) | Postgres | ja, `datenbank.dump` |
| Dateiablage: Dokumente, Berichte, Berichtsfassungen je Investor, Mitteilungen, Belege, Buchungsexporte, Meldedateien | Volume `speicher` (`/daten/speicher`) | ja, `speicher.tar.gz` |
| Warteschlange (`pgboss`) | Postgres | nein, nur flüchtige Aufträge; Kennzahlen-Snapshots lassen sich neu berechnen |
| `.env` mit `GEHEIMNIS_SCHLUESSEL`, `BETTER_AUTH_SECRET`, Datenbankpasswörtern | Server | nein, gesondert und nie zusammen mit der Sicherung ablegen |
| Proxy-Konfiguration und Zertifikate | Server | nein |

Ohne den passenden `GEHEIMNIS_SCHLUESSEL` bleiben gespeicherte Zugänge (Postfach, SMTP-Inhalte im Ausgangskorb) unlesbar, ohne
`BETTER_AUTH_SECRET` bleiben die zweiten Faktoren ungültig. Beides gehört deshalb in eine eigene, getrennte Ablage
(Passwortverwaltung oder Tresor), auch für die Zeit, die Sicherungen aufbewahrt werden.

## Sicherung

```bash
SICHERUNG_ZIEL=/mnt/sicherung ./sicherung.sh
```

Das Skript zieht erst die Datenbank (`pg_dump` im Custom-Format, ohne `pgboss`), danach die Dateiablage (`tar`), prüft beide
(`pg_restore -l`, `tar -t`) und legt `SHA256SUMS` und `INFO.txt` dazu. Beide Zeitpunkte stehen in `INFO.txt`.

**Reihenfolge und Stand.** Dateien werden nur neu geschrieben, nie verändert, und liegen vor der Datenbankzeile, die auf sie zeigt.
Darum gilt: Zu jeder Zeile im Dump gibt es die Datei im später gezogenen Archiv. Das Archiv kann einzelne Dateien mehr enthalten
(Vorgänge zwischen beiden Schritten); die stören nicht. Die umgekehrte Reihenfolge wäre unsicher, weil dann Zeilen auf Dateien
zeigen könnten, die dem Archiv fehlen. Eine Ausnahme: Entfernt der Aufbewahrungslauf zwischen beiden Schritten die Datei eines
Dokuments, dessen Frist abgelaufen war, ist die Zeile im Dump noch „gelöscht“, die Datei fehlt. Der nächste Lauf nach der
Wiederherstellung stellt „endgültig gelöscht“ her; verlorene Inhalte sind das nicht, die Frist war ohnehin um.

Zeitplan, Aufbewahrungsfrist (`SICHERUNG_AUFBEWAHREN_TAGE`, Vorgabe 14) und Ablageort: siehe
[deploy/README.md](../../deploy/README.md#sicherung-und-wiederherstellung). Die Sicherung gehört auf ein anderes Medium an einem
anderen Ort. Vor jeder Aktualisierung mit Migration zusätzlich eine eigene Sicherung ziehen.

## Wiederherstellung

```bash
./wiederherstellung.sh /mnt/sicherung/carraway-carraway-20261120-120000
```

Ablauf des Skripts: Prüfsummen kontrollieren, `api` und `worker` anhalten, Datenbank mit denselben Rollen und Rechten neu anlegen,
Dump einspielen, Dateiablage leeren und aus dem Archiv füllen, `api` und `worker` starten. Das Skript überschreibt den aktuellen
Stand und fragt vorher nach (`--ja` überspringt die Frage). Die Migration beim Start ist ohne Wirkung, wenn der Stand aktuell ist.

Danach prüfen:

1. `curl -s http://127.0.0.1:8787/api/v1/health` und Verwaltung → Betrieb: Datenbank erreichbar, Migrationen angewendet,
   Dateiablage beschreibbar, Worker meldet sich (der Herzschlag kommt nach wenigen Sekunden).
2. Eine Anmeldung mit zweitem Faktor.
3. Dateien gegen die Datenbank: jede Zeile mit einer Datei muss ihre Datei haben, und der SHA-256 muss passen.

   ```bash
   DATABASE_URL=postgres://… SPEICHER_VERZEICHNIS=/pfad/zur/dateiablage pnpm ops:dateien-pruefen
   ```

   Das Skript liegt im Repository (nur lesend) und deckt alle Dateiarten ab. Im Compose-Stack zeigt `SPEICHER_VERZEICHNIS` auf den
   Einhängepunkt des Volumes `speicher` auf dem Host und `DATABASE_URL` auf eine Leseverbindung zur Datenbank.

Die Wiederherstellung **üben**: einmal im Quartal und nach größeren Änderungen in einen leeren Probe-Stack (anderer
`COMPOSE_PROJECT_NAME`) einspielen und die drei Prüfungen durchlaufen. Die Technik prüft außerdem `pnpm ops:sicherung-test` (in der CI
bei jedem Stand von `main`): Dump, Wiederherstellung in eine frische Datenbank, Vergleich von Zeilenzahl und Prüfsumme aller Tabellen,
und für **jede** Dateiart eine Datei mit SHA-256-Vergleich nach dem Entpacken, dazu eine Gegenprobe mit beschädigter Datei. Eine
neue Dateispalte ohne Eintrag in `scripts/ops/dateiablage.ts` lässt den Test scheitern.

## Schlüsselwechsel

### `GEHEIMNIS_SCHLUESSEL` (gespeicherte Zugänge)

1. Neuen Schlüssel erzeugen: `openssl rand -base64 32`.
2. In `.env` den bisherigen Schlüssel nach `GEHEIMNIS_SCHLUESSEL_ALT` verschieben (mehrere kommagetrennt), den neuen als
   `GEHEIMNIS_SCHLUESSEL` eintragen. `docker compose up -d api worker`: Ab jetzt wird mit dem neuen Schlüssel verschlüsselt, alte
   Werte bleiben lesbar.
3. `docker compose exec worker node dist/geheimnis-rotieren.js` verschlüsselt alle Werte neu. Die Ausgabe nennt neu verschlüsselte,
   schon aktuelle und unlesbare Werte; bei „unlesbar“ endet das Skript mit Fehler und lässt diese Werte unberührt.
4. Ist nichts unlesbar, den alten Schlüssel erst entfernen, wenn **auch die ältesten noch aufbewahrten Sicherungen** nicht mehr
   gebraucht werden: Eine Sicherung aus der Zeit vor dem Wechsel enthält Werte, die nur der alte Schlüssel öffnet. Wer sie
   wiederherstellt, braucht `GEHEIMNIS_SCHLUESSEL_ALT` (oder rotiert nach der Wiederherstellung neu).
5. Der Schlüssel gehört in die getrennte Ablage, nicht in die Sicherung. Details: [docs/sicherheit/Mail-und-Kalender.md](../sicherheit/Mail-und-Kalender.md).

### `BETTER_AUTH_SECRET`

Ein Wechsel macht alle zweiten Faktoren ungültig, weil die TOTP-Geheimnisse damit verschlüsselt sind; alle Personen richten ihn neu
ein. Nur bei Verdacht auf Offenlegung wechseln, die Verwalter vorher informieren, Passwörter bleiben gültig (gehasht).

### Datenbankpasswörter

`DB_APP_PASSWORT` und `DB_EIGENTUEMER_PASSWORT` in `.env` ändern und die Rollen in Postgres anpassen
(`ALTER ROLE … PASSWORD …` als Admin), danach `docker compose up -d`. Sicherung vorher ziehen.

## Aktualisieren mit Migrationen

Migrationen laufen nur **vorwärts**. Der Ablauf:

1. Sicherung ziehen: `./sicherung.sh`. Die Nummer der installierten Version notieren (Image-Tag oder Digest), damit der Rückweg bekannt ist.
2. `git pull && docker compose up -d --build`. Der Dienst `migrate` läuft vor `api` und `worker`; schlägt er fehl, starten beide nicht.
   Seit der Trennung in Kern und Erweiterungen (`docs/open-core.md`) baut der Stack den Kern. Stacks im Hosting durch Rehlytics mit
   Erweiterungen ziehen das Image „Voll“ aus der privaten Registry (`CARRAWAY_IMAGE`). Vorher in der `.env` umbenennen:
   `CARRAWAY_UMGEBUNG` → `CARRAWAY_UMGEBUNG`, `CARRAWAY_IMAGE` → `CARRAWAY_IMAGE`.
3. Kontrolle: `docker compose ps`, `curl -s http://127.0.0.1:8787/api/v1/health`, Verwaltung → Betrieb.

**Schutz gegen falsche Stände.** API und Worker prüfen beim Start, ob die Datenbank genau die Migrationen hat, die der Code kennt. Sonst
beenden sie sich mit einer Fehlerzeile (`api startet nicht: Migrationsstand passt nicht zum Code` bzw. `worker …`) und nennen den Grund:

- *Der Datenbank fehlen Migrationen, die der Code kennt*: die Migration ist nicht gelaufen. `docker compose run --rm migrate` bzw. `pnpm db:migrate`, dann starten.
- *Die Datenbank enthält Migrationen, die der Code nicht kennt*: ein älteres Image läuft gegen eine neuere Datenbank (siehe Rückweg).

In der Entwicklung prüft `pnpm migrationen:pruefen` (und die CI), dass das Journal in sich stimmt: Zeitstempel streng aufsteigend, Nummern
lückenlos ohne Doppelung. Ein Zweig, dessen Migration einen älteren Zeitstempel trägt als die schon angewendeten, würde sonst von drizzle still
übersprungen.

### Rückweg: nur vorwärts

- Es gibt keine Abwärts-Migrationen. Ein älteres Image gegen die neuere Datenbank zu starten ist nicht vorgesehen und wird beim Start
  abgelehnt.
- **Rückkehr zum alten Stand heißt: die Sicherung vor der Aktualisierung wiederherstellen und das alte Image starten.** Was seit dieser
  Sicherung eingegeben wurde, geht dabei verloren; deshalb vorher die Aktualisierung in einer Probe-Umgebung durchspielen, wenn viel
  Betrieb läuft.
- Ein Fehler im neuen Stand wird vorwärts behoben: korrigiertes Image bauen und wie oben aktualisieren, nicht die Datenbank von Hand
  zurückbauen.
- Eigene SQL-Eingriffe an `drizzle.__drizzle_migrations` unterlassen; der Startabgleich vergleicht deren Inhalt mit den Dateien des Images.

## Betriebsstatus im Alltag

Verwaltung → Betrieb (nur globale Verwalter) zeigt Datenbank, Migrationsstand, Alter des Worker-Herzschlags, Rückstände
(Kennzahlen-Snapshots, Mailversand, KI-Auslesung, Registerbeobachtung), Schreibbarkeit der Dateiablage sowie SMTP und KI-Anbieter.
Dieselben Rückstände und das Alter des Herzschlags stehen in `/metriken` (`carraway_rueckstand_*`, `carraway_worker_herzschlag_alter_sekunden`)
für Alarme. Als Richtwerte: Herzschlag älter als 30 Sekunden heißt ausgefallen, ein Rückstand älter als 5 Minuten ist auffällig.

## Image und Texterkennung: geprüfter Lauf (arm64, Docker 29, Compose-Stack mit eigenem Projektnamen)

Es gibt **ein** Image für alle Rollen (API mit Oberfläche, Worker, Migration; der Befehl wählt die Rolle). Der Bau aus dem Checkout
(`docker build -t carraway:lokal .`) lief ohne Änderung durch; das Image bringt die Texterkennung mit:

| Teil | Größe im Image |
|---|---|
| Alpine 3.24 mit `libstdc++` | 18 MB |
| Node-Binärdatei | 128 MB |
| Laufzeitmodule (Typst 48 MB, `tesseract.js-core` 44 MB, `@napi-rs/canvas` 25 MB, Sprachdaten Deutsch und Englisch 22 MB) | 149 MB |
| API- und Worker-Bündel (`dist`), Oberfläche (`web`), Migrationen (`drizzle`) | 29 MB, 4 MB, 11 MB |
| Summe der Ebenen | rund 340 MB entpackt, rund 140 MB als komprimiertes Archiv (`docker save | gzip`) |

Die Sprachdaten kommen aus den exakt gepinnten npm-Paketen `@tesseract.js-data/deu` und `eng` (Prüfsummen in
`deploy/laufzeit/package-lock.json`, `npm ci`), nicht aus einem Abruf zur Laufzeit; der Worker läuft mit `read_only` und ohne
Schreibzugriff außer `/tmp`. Texterkennung ist mit `OCR=lokal` in der `.env` eingeschaltet.

Probe gegen den laufenden Stack (Migration, Demo-Daten, ein erfundener Scan als PDF ohne Textebene), wiederholbar mit
`node scripts/ops/ocr-image-pruefen.mjs --pdf <scan.pdf> --basis http://127.0.0.1:<Port>` (meldet sich als Demo-Verwalterin an,
lädt hoch und wartet auf den erkannten Text):

- Upload bis erkannter Text und Suchtreffer: 3,2 s.
- Ergebnis: Quelle `ocr`, mittlere Sicherheit 95, Text „Rechnung 4711 vom 3. Maerz 2026 Gesamtbetrag 1234 Euro netto Zahlbar
  innerhalb von 14 Tagen“ vollständig erkannt, Treffer in der Dokumentsuche.
- Speicher des Worker-Containers nach der Erkennung: unter 100 MiB (Obergrenze 3 GiB, siehe `WORKER_SPEICHER`).
- `/api/v1/health`: Datenbank erreichbar, Worker meldet sich nach 2 s.

## Probe mit Docker Compose: geprüfter Lauf

Ablauf, mit dem die Skripte `sicherung.sh` und `wiederherstellung.sh` gegen einen echten Compose-Stack geübt wurden (eigener Projektname
`COMPOSE_PROJECT_NAME`, eigene Volumes, Demo-Bestand mit erfundenen Daten; nach der Probe `docker compose down -v`):

1. Stack starten, Demo-Daten einspielen (`pnpm db:seed` mit `BETTER_AUTH_SECRET` wie im Stack, sonst lassen sich die zweiten Faktoren der
   Demo-Personen nicht entschlüsseln; der Datenbank-Port des Probe-Stacks ist dafür nur lokal veröffentlicht), je Dateiart eine Datei anlegen
   (`tsx scripts/ops/compose-sicherung-probe.ts anlegen <Adresse> <Verzeichnis>`, danach per `tar` in die Dateiablage kopieren).
2. `api` und `worker` anhalten (der Worker berechnet Kennzahlen neu und verändert Tabellen), Abbild ziehen
   (`… compose-sicherung-probe.ts abbild <Adresse> vorher.json`: Zeilenzahl und Prüfsumme je Tabelle, Spalten, Trigger, Migrationen) und die
   SHA-256 aller Dateien der Ablage auflisten (`find /daten/speicher -type f | sort | xargs sha256sum` im Container).
3. `./sicherung.sh`, dann `docker compose down -v` (Datenbank und Dateiablage sind weg), `docker compose up -d` (leerer Stack),
   `./wiederherstellung.sh <Sicherung> --ja`.
4. Wieder anhalten, Abbild ziehen und vergleichen (`… compose-sicherung-probe.ts vergleichen vorher.json nachher.json`), Dateiliste vergleichen,
   `pnpm ops:dateien-pruefen` gegen eine Kopie der Ablage, danach `api` und `worker` starten und
   `node scripts/ops/betrieb-status-pruefen.mjs --basis http://127.0.0.1:<Port>` laufen lassen.

Ergebnis des Laufs (Docker 29, arm64, Postgres 18):

| Schritt | Ergebnis |
|---|---|
| Stand vor der Sicherung | 114 Tabellen, 3 474 Zeilen, 38 Trigger, 50 Migrationen, 31 Dateien (264 KiB) in allen sieben Dateiarten, Datenbank 18 MB |
| Sicherung | rund 1 s; `datenbank.dump` 574 KiB, `speicher.tar.gz` 64 KiB; mit angehaltener und mit laufender API (beide Wege der Dateisicherung) |
| Neustart eines leeren Stacks nach `down -v` | 7 s, bis alle Dienste laufen |
| Wiederherstellung | 8 s einschließlich Neustart von API und Worker |
| Zeilenzahl und Prüfsumme je Tabelle, Spalten, Trigger, Migrationen | identisch (114 Tabellen) |
| SHA-256 aller 31 Dateien | identisch; `ops:dateien-pruefen` meldet je Art „stimmt überein“ (Dokumente 3, die übrigen sechs Arten je 1) |
| Anwendung nach der Wiederherstellung | `/health` ok, `/operations/status` Gesamtampel „ok“ (50 von 50 Migrationen, Worker-Herzschlag, Ablage beschreibbar), Anmeldung mit zweitem Faktor, Texterkennung eines neuen Scans läuft |

Was die Wirklichkeit gezeigt hat: Die Skripte liefen ohne Änderung. Zu ergänzen war, dass `SPEICHER_VERZEICHNIS` für `ops:dateien-pruefen`
auf Docker Desktop (macOS, Windows) kein Einhängepunkt des Volumes ist; dort die Dateiablage vorher auskopieren:
`docker compose run --rm --no-deps -T --entrypoint tar api -cf - -C /daten/speicher . | tar -x -C <Verzeichnis>`. Wer den Datenbank-Port über eine
eigene Override-Datei veröffentlicht hat, gibt sie auch bei `wiederherstellung.sh` an; sonst erstellt `up -d` den Datenbankdienst ohne den Port neu
(die Daten bleiben erhalten).
