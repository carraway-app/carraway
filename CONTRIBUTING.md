# Mitmachen

Beiträge sind willkommen: Fehlerberichte, Verbesserungsvorschläge, Korrekturen an Doku und Code.

## Vorgehen

1. Bei größeren Änderungen zuerst ein Issue anlegen und die Idee kurz beschreiben, damit sich niemand umsonst Arbeit macht.
2. Repository forken, Branch anlegen, Änderung machen, Pull Request gegen `main` öffnen. Kleine, in sich geschlossene Pull Requests sind leichter zu prüfen.
3. Die CI muss grün sein: Lint, Typecheck, Build und Tests laufen für jeden Pull Request.

## Entwicklung vor Ort

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm build
```

Die Tests brauchen eine PostgreSQL-Instanz. Die Adressen werden ausdrücklich gesetzt, damit nie eine falsche Datenbank getroffen wird:

```bash
export DATABASE_URL_TEST=postgres://carraway:carraway@localhost:5432/carraway_test
pnpm --filter @carraway/db setup:test
pnpm test
```

Die Tests leeren Tabellen und lehnen darum jede Adresse ab, deren Datenbankname nicht `test` enthält.

## Regeln für Änderungen

- Keine echten Personen- oder Kundendaten in Code, Tests, Beispielen und Screenshots. Demo-Daten sind erfunden.
- Keine Zugangsdaten, Schlüssel oder Tokens im Repository.
- Die Oberfläche ist deutsch und englisch; neue Texte kommen in beide Sprachdateien.
- Tests für neues Verhalten und für behobene Fehler.

## Lizenz und Beitragserklärung

Der Kern steht unter der AGPL-3.0 ([LICENSE](LICENSE)). Mit einem Beitrag erklärst du dich einverstanden, dass er unter dieser Lizenz veröffentlicht wird.

Zusätzlich richtet der Betreiber vor dem ersten angenommenen Pull Request eine Lizenzerklärung für Beitragende ein, die zu bestätigen ist (Contributor License Agreement). Bis dahin nimmt niemand fremde Beiträge an. Wer einen Pull Request öffnet, wird darauf hingewiesen, sobald die Erklärung gilt.

## Wie Beiträge ins Projekt gelangen

Die Entwicklung läuft in einem privaten Repository des Betreibers; dieses Repository erhält mit jedem Release eine Momentaufnahme. Angenommene Pull Requests werden deshalb von Hand in das private Repository übernommen und erscheinen mit dem nächsten Release hier. Der Pull Request wird dann mit einem Hinweis geschlossen; die Urheberschaft bleibt im übernommenen Commit erhalten.

## Verhalten

Sachlich und freundlich bleiben. Beleidigungen und persönliche Angriffe führen zum Ausschluss aus Issues und Pull Requests.
