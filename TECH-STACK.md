# Carraway: Tech-Stack (Vorschlag)

Stand: 20.11.2026 · Status: entschieden, von Lennard am 20.11.2026 wie vorgeschlagen bestätigt (siehe [ENTSCHEIDUNGEN.md](ENTSCHEIDUNGEN.md))

Leitfrage: Was ist für Carraway schnell, im Betrieb und in der Entwicklung, und was lässt sich mit vorhandenem Wissen sicher bauen? Performance hat Vorrang.

## Kurzfassung

| Schicht | Vorschlag | Bekannt oder neu | Begründung in einem Satz |
|---|---|---|---|
| Sprache | TypeScript strict, Frontend und Backend | bekannt | ein Typensystem von der Datenbank bis zur Tabelle |
| Frontend | React 19 als Single-Page-App mit Vite, TanStack Router, Query, Table, Virtual | React, Query, Table, Virtual bekannt; Vite und Router neu | angemeldete Fachanwendung: Seitenwechsel aus dem Cache statt Server-Rundreise |
| Backend | Hono auf Node 24 als eigene API (REST mit OpenAPI) | Node bekannt, Hono neu | die API ist Produktbestandteil, nicht Nebenprodukt der Oberfläche |
| Datenbank | PostgreSQL 18, Drizzle ORM SQL-first | Drizzle und Postgres bekannt, Version 18 neu (bisher 16) | Stichtagslogik mit Zeiträumen und temporalen Schlüsseln |
| Rechenkern | eigenes Paket `rechenkern`, reine Funktionen, Dezimalarithmetik | neu | Zinsen, IRR, Wasserfall testbar und später austauschbar (Rust/WASM) |
| Hintergrundjobs | pg-boss (Warteschlange in Postgres) | bekannt | Kennzahlen-Snapshots, Zinsläufe, Berichte laufen nicht im Seitenaufruf |
| Anmeldung | Better Auth (Passwort, TOTP, OIDC für Entra ID und Google) | bekannt | 2FA und Firmenanmeldung abgedeckt |
| Berichte | PDF mit Typst (Spike), Gotenberg als Rückfallebene; Excel mit exceljs | Typst neu, Gotenberg und exceljs bekannt | Typst verspricht deutlich schnellere PDFs als ein Headless-Browser (zu messen) |
| Komponenten | Designsystem Carraway (`cw-…`) als React-Komponenten mit CSS aus Tokens | neu, Muster bekannt | eine Quelle für Farben, Raster und Bausteine |
| Betrieb | Docker, Coolify, Server in Deutschland; CI nach der Arbeitsweise (Runner-Wahl) | bekannt | bestehende Infrastruktur, keine neue Plattform |

Der größte Schritt weg vom Bekannten ist die getrennte Oberfläche statt Next.js. Begründung unten.

Rust: nicht als Backend für das MVP. Der Rechenkern bekommt eine Schnittstelle, die einen späteren Wechsel nach Rust erlaubt, falls Messungen es verlangen. Begründung unten.

## Anforderungen, die den Stack prägen

Typische Anforderungen von Beteiligungsgesellschaften (Details in [FEATURES.md](FEATURES.md)):

- **Zwei Zeitachsen:** fachliche Gültigkeit und Erfassungszeit getrennt, Lesen und Schreiben mit Stichtag, Änderungsabfrage seit Zeitpunkt.
- **Vollständige API:** lesen und schreiben, Transaktion über zusammenhängende Objekte, idempotente Übernahme mit fachlichem Schlüssel, Validierungsfehler gesammelt mit Feldnamen, 404 statt 401 bei falschem Pfad.
- **Regeln auf dem Server:** Vier-Augen-Prinzip, Periodensperre und Änderungsprotokoll in der Datenbank durchgesetzt, nicht nur in der Oberfläche. Sicherheitsprüfungen testen das mit direkten API-Aufrufen.
- **Zugänge:** Zwei-Faktor auch für die API; technische Benutzer getrennt von Personen; API-Schlüssel mit Rechten und Ablauf, nur als Hash gespeichert.
- **Geld:** Dezimalarithmetik, Zinsmethoden als Daten, Beträge mit ausdrücklicher Währungssicht.
- **Datenhaltung:** Daten sollen beim Kunden bleiben können; Vollexport samt Rechenregeln.

## Was Performance hier heißt

Die Datenmengen sind klein: 1 bis 5 Fonds, einige hundert Beteiligungen, einige zehntausend Zahlungen. Keine Rechnung darauf ist für eine moderne CPU teuer, in keiner Sprache. Langsam werden Fachanwendungen dieser Größe an anderen Stellen:

1. **Rechnen beim Lesen.** Kennzahlen über alle Perioden live in Views gerechnet, auf jeder Seite und bei jedem Prefetch erneut. Aus eigener Erfahrung mit einer ähnlichen Fachanwendung: Abfragen von über 10 Sekunden lagen nicht an Sprache oder Datenmenge, sondern daran, dass bei jedem Seitenaufruf alles neu gerechnet wurde und der Abfrageplaner Teilergebnisse tausendfach wiederholte. Nach dem Umbau lagen sie unter einer Sekunde, plus gespeicherte Ergebnisse.
2. **Rundreisen.** Jeder Klick wartet auf Server-Rendering und Revalidierung. Mit Server-Aktionen braucht es zusätzlich eigene Regeln, damit Schalter und Formulare danach den richtigen Stand zeigen.
3. **Große Tabellen im Browser** ohne Virtualisierung.
4. **Berichtserzeugung** über einen Headless-Browser (Sekunden je PDF).

Daraus folgt die Reihenfolge: Datenmodell und Abfragen zuerst, dann die Architektur der Oberfläche, die Sprache des Backends zuletzt.

## Performance von Anfang an: die Regeln

1. **Seiten lesen, Jobs rechnen.** Kennzahlen, Bewertungen und Fondswerte werden je Stichtag als Snapshot gespeichert, mit Verweis auf die Eingangsdaten (Grundlage für die Herkunft jeder Zahl). Gerechnet wird nach einer Änderung im Hintergrund. Eine Seite kann den teuren Pfad nicht auslösen. Ist ein Snapshot veraltet, sagt die Oberfläche das und bietet „Neu berechnen“.
2. **Budgets als Tests.** Referenzdatensatz (5 Fonds, 500 Beteiligungen, 100.000 Zahlungen, 10 Jahre). Ziele: API-Antwort p95 unter 100 ms, Seitenwechsel aus dem Cache unter 50 ms, Neuberechnung eines Fonds unter 1 s, Quartalsbericht als PDF unter 2 s. Ein CI-Job prüft die Kernabfragen gegen den Datensatz und schlägt bei Überschreitung fehl.
3. **Abfragen sichtbar machen.** `pg_stat_statements` an, `statement_timeout` je Anfrage, `Server-Timing`-Header in jeder API-Antwort, `EXPLAIN` für Kernabfragen im Repo.
4. **Oberfläche aus dem Cache.** Prefetch beim Überfahren von Links, optimistische Änderungen, Tabellen virtualisiert, Routen in eigene Bundles geteilt, keine CSS-in-JS-Laufzeit.
5. **Kurze Wege.** API und Datenbank im selben Rechenzentrum in Deutschland, Verbindungspool, Kompression (Brotli), HTTP/2.

## Begründungen

### Single-Page-App statt Next.js

Die bisherigen eigenen Anwendungen laufen auf Next.js. Für Carraway spricht mehr für eine getrennte Oberfläche:

- Alles liegt hinter der Anmeldung. Server-Rendering für Suchmaschinen bringt nichts.
- Ausgewählte Fonds, Stichtage und Filter bleiben im Client-Cache. Ein Wechsel zwischen Portfolio und Beteiligung braucht keinen Server.
- Die API muss es ohnehin geben: Lesen und Schreiben von außen, Massenimport, Vollexport und Änderungsabfrage gehören zu den Grundanforderungen. Baut die eigene Oberfläche auf derselben API, ist sie immer vollständig und getestet.
- Selbst-Hosting wird einfacher: statische Dateien plus ein API-Container.

Was mitkommt aus dem Bekannten: React, TanStack Table, Query und Virtual, Zod, Vitest, Playwright, das Muster der Komponenten.

### Hono auf Node

Hono ist klein und schnell, läuft auf Node, Bun und Deno und erzeugt aus Zod-Schemas eine OpenAPI-Beschreibung. Node 24 bleibt, weil die bestehenden Projekte, CI und Docker-Bausteine darauf laufen. Bun wäre beim Start schneller, ist im Betrieb aber unbekannt; ein späterer Wechsel bleibt möglich, weil Hono auf beiden läuft.

### PostgreSQL 18 und das Datenmodell

- **Stichtag und Historie:** Werte mit Gültigkeitszeitraum (`daterange`), PostgreSQL 18 kann Schlüssel ohne Überlappung (`WITHOUT OVERLAPS`) und zeitliche Fremdschlüssel (`PERIOD`) direkt prüfen. Lokal und in den bestehenden Projekten läuft bisher Version 16, ein Upgrade ist Teil des Gerüsts. Jede Änderung zusätzlich mit Erfassungszeitpunkt: So lässt sich jeder Bericht zu jedem Stichtag mit dem damaligen Wissensstand wieder erzeugen.
- **Buchungen nur anhängen:** Zahlungen, Zinsen, Bewertungen werden nicht überschrieben, sondern storniert und neu erfasst.
- **Beträge** als `numeric`, nie als Gleitkommazahl.
- **Mandanten (Vorschlag):** je Kunde eine eigene Datenbank statt Zeilen-Sicherheit in einer gemeinsamen Datenbank. Das ist einfacher zu erklären, zu sichern und herauszugeben, und es passt zum Selbst-Hosting. Innerhalb einer Datenbank regeln Rollen den Zugriff je Fonds.
- **Drizzle SQL-first** wie in den bestehenden Projekten: Schema in TypeScript, Views, Policies und Constraints als SQL-Migrationen.

### Rechenkern als eigenes Paket

Zinsmethoden (30/360, act/360, act/365, act/act), Zinsläufe mit Stundung und Kappung, Wandlung mit Zins-Cutoff, IRR, TVPI, DPI, Exit-Wasserfall. Alles als reine Funktionen ohne Datenbankzugriff, mit Dezimalarithmetik und Referenzfällen als Tests (aus nachgerechneten Beispielen, nicht aus dem Code). Jede Funktion liefert neben dem Ergebnis die Rechenschritte für den Herkunftshinweis.

Das Paket ist die Stelle, an der Rust später sinnvoll werden kann: gleiche Schnittstelle, gleiche Tests, Einbindung per WebAssembly (dann auch im Browser für Was-wäre-wenn-Rechnungen) oder als Node-Modul.

### Berichte

- **Typst** (freies Satzsystem, in Rust geschrieben) setzt PDF-Berichte aus Vorlagen und Daten ohne Browser, deterministisch und gut versionierbar. Wie viel schneller als HTML zu PDF, misst ein Spike mit einem Quartalsbericht in der ersten Woche.
- **Gotenberg** (HTML zu PDF) als Rückfallebene, bekannt aus bestehenden Projekten.
- **Excel** mit exceljs für Exporte und Importvorlagen.
- Entwürfe mit Wasserzeichen, Freigabe in Stufen, freigegebene Berichte unveränderlich gespeichert.

## Rust als Backend: Bewertung

| Kriterium | TypeScript (Hono, Node) | Rust (Axum, SQLx) |
|---|---|---|
| Rechenleistung, Speicher | gut, für diese Datenmengen mehr als genug | sehr gut, kleinster Speicherbedarf |
| Antwortzeit in der Praxis | bestimmt durch Datenbank und Netz | bestimmt durch Datenbank und Netz, Unterschied wenige Millisekunden |
| Entwicklungstempo allein mit KI-Unterstützung | hoch, bekannte Muster aus drei Repos | spürbar langsamer: längere Kompilier- und Korrekturschleifen |
| Bausteine | Better Auth, Drizzle, exceljs, Zod vorhanden und erprobt | Anmeldung mit 2FA und OIDC selbst zusammensetzen, Excel und PDF vorhanden, ORM schwächer |
| Typen bis ins Frontend | direkt geteilt | über OpenAPI-Generator |
| Korrektheit bei Geldbeträgen | Dezimalbibliothek nötig, Disziplin nötig | `rust_decimal`, Typsystem hilft stärker |
| Betrieb | Container mit Node-Laufzeit, deutlich größer | einzelne Binärdatei, sehr kleiner Container (Größen zu messen) |
| CI-Minuten | Minuten | Kompilieren kostet deutlich mehr, Cache nötig |
| Open Source: Beitragende | großer Kreis | kleinerer Kreis |

**Urteil:** Rust würde Carraway auf dem Server messbar schlanker machen, aber für Nutzerinnen und Nutzer kaum spürbar schneller, weil die Zeit in Datenbank, Netz und Oberfläche liegt. Gleichzeitig würde es den Demo-Kern bis Mitte Dezember gefährden und die erprobten Bausteine (Anmeldung, Migrationen, CI) entwerten. Performance entsteht hier durch das Datenmodell (Snapshots, Stichtage, Indizes) und die Oberfläche (Cache, Prefetch, Virtualisierung).

**Rust kommt dort in Frage, wo Rechenzeit wirklich zählt:** im Rechenkern, sobald Szenarien, Wasserfälle über viele Anteilsklassen oder Simulationen dazukommen. Entscheidungspunkt: wenn der Referenzdatensatz das Budget für die Neuberechnung (unter 1 s je Fonds) reißt.

## Offene Punkte

1. Typst gegen Gotenberg: Spike mit einem echten Berichtslayout.
2. Datenbank je Kunde (Vorschlag) oder Schema je Kunde: endgültig mit dem Hosting-Modell.
3. Lizenz (AGPL oder FSL) beeinflusst die Wahl der Abhängigkeiten: alle Bibliotheken auf Verträglichkeit prüfen.
4. KI-Funktionen: nur mit Anbietern in der EU, je Mandant abschaltbar; Architektur folgt mit dem ersten KI-Feature.
