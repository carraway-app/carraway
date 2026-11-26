# Open Core: Kern und Erweiterungen

Carraway besteht aus einem **Kern** unter der GNU Affero General Public License 3.0 (`LICENSE`) und **Erweiterungen** unter einer geschlossenen Lizenz
(`ee/LICENSE`). Beide liegen in diesem Repo; aus ihm entstehen zwei Builds:

- **Kern**: alles außer `ee/`. Baut, testet und läuft ohne den Ordner `ee/`; das ist der Stand für Selbsthoster.
- **Voll**: Kern plus alle Erweiterungen, nur im Hosting durch Rehlytics (siehe „Einstiege und Images“).

Der Kern importiert nie aus `ee/`. Erweiterungen melden sich über **Erweiterungspunkte** an, die der Kern bereitstellt.

## Was zum Kern gehört, was eine Erweiterung ist

| Kern | Erweiterung (`ee/`) |
|---|---|
| Dealflow, Kontakte, Akten und Dokumente | Excel-Add-in: persönliche Werteschlüssel, Manifest, Werte-Schnittstelle und geprüfte Übernahme (`/excel`, `/values`, `/value-keys`), Reiter „Excel“ der Einstellungen |
| Kapital und Journal, Zeichnungen, Closings und Zusageänderungen der Investoren | LP-Portal: Zugang der Investoren (`/portal`), Investor-Benutzer (`/investors`), Zugänge an den Investoren eines Fonds (`…/investor-access/access`) |
| Bewertungen und Kennzahlen, Kennzahlenabfragen mit Link | ESG und SFDR: Fragebögen, PAI-Indikatoren, Einordnung nach Art. 6/8/9, PAI-Erklärung als Berichtsart |
| Berichte mit Freigabe, PDF- und Excel-Export | Single Sign-On mit Microsoft Entra ID oder Google |
| HTTP-API mit Webhooks und Live-Aktualisierung, Import, Vollexport | KI-Funktionen: die Auslesung von Dokumenten, die Ergänzung von Kontakten aus Signaturen und Websites und alle künftigen KI-Funktionen |
| Zwei-Faktor, Rollen und Gruppen, Änderungsprotokoll | MCP-Server mit Lesewerkzeugen für KI-Clients unter `/api/v1/mcp` |
| Postfach- und Kalenderanbindung, lokale Texterkennung (OCR, keine KI), Betrieb | |

## Aufbau im Repo

| Ordner | Paket | Inhalt |
|---|---|---|
| `apps/api` | `@carraway/api` | API des Kerns; Einstieg „Kern“: `src/server.ts`, `src/worker.ts` |
| `apps/web` | `@carraway/web` | Oberfläche des Kerns; Einstieg „Kern“: `src/main.tsx` |
| `ee/api` | `@carraway/ee-api` | Erweiterungen der API; Einstieg „Voll“: `src/server.ts`, `src/worker.ts` |
| `ee/web` | `@carraway/ee-web` | Erweiterungen der Oberfläche; Einstieg „Voll“: `src/main.tsx` (gleiche `index.html` und öffentliche Dateien wie `apps/web`) |
| `ee/excel-addin` | `@carraway/excel-addin` | Dateien des Excel-Add-ins, gebaut nach `ee/web/oeffentlich/excel-addin/` |

Pakete in `ee/` nutzen den Kern über Paketnamen mit Pfad, zum Beispiel `@carraway/api/rechte/tabelle` oder `@carraway/web/i18n`.

## Erweiterungspunkte

**API** (`apps/api/src/erweiterung.ts`, Typ `ApiErweiterung`; übergeben an `erstelleApp`, `starteServer` und `starteWorker`):

- `routen`: zusätzliche Hono-Routen unter `/api/v1`, eingehängt hinter denen des Kerns
- `regeln`: Einträge der Berechtigungstabelle für diese Routen (Bausteine aus `rechte/tabelle.ts`, Bereich am besten in der Zeile); das
  Regelwerk einer Anwendung besteht aus den Regeln des Kerns plus denen der Erweiterungen
- `apiAnfrage` im Routenkontext: interner Aufruf der HTTP-App mit Anmeldung, Rechteprüfung und Zugriffsprotokoll
- `anmeldeanbieter`: Anbieter für Better Auth (Single Sign-On); `GET /environment` nennt sie
- `berichtsarten`: Berichtsarten mit Datei, Kontrollbericht, Freitexten und Vorgaben beim Anlegen (`berichte/arten.ts`)
- `betrieb`: Angaben im Betriebsstatus unter `erweiterungen.<name>`
- `anhaenge` im Routenkontext: ein Anhang aus dem eigenen Postfach kann mit Größenbegrenzung, Typprüfung und einer Aktion in der Schreibtransaktion als Dokument übernommen werden
- `postfachMails`: wird im Abgleich der Postfächer nach dem Speichern neuer eingehender Mails bekannter Personen aufgerufen (Text nur über einen Rückruf, nicht gespeichert; Fehler halten den Abgleich nicht auf)
- `warteschlangen`, `worker`, `verteilen`: Warteschlangen, Arbeiter und Verteilschritte im Worker (pg-boss)

**Oberfläche** (`apps/web/src/erweiterung.ts`, Typ `WebErweiterung`; angemeldet mit `meldeErweiterungAn`):

- `routen`: Routen an der Wurzel oder im Fondsrahmen (`/fonds/$fondsId/…`); die Typen der Adressen kennen nur den Kern
- `texte`: eigene Textbereiche, geladen mit den Seiten, die sie brauchen
- `fondsReiter`, `beteiligungReiter`, `einstellungenReiter`, `verwaltungBereiche`: Einträge in den Inhaltsverzeichnissen
- `datensatzErgaenzung` (Abschnitt auf der Seite einer Person oder eines Unternehmens), `postfachEinstellungen` (Karte unter Postfach und Kalender), `fondsInvestoren`, `dokumentAktion`, `anhangAktion`, `berichtsarten`, `anmeldung`, `betriebZeilen`: Bausteine an festen Stellen der Seiten des Kerns
- `einstiege`: weitere Einstiege neben der Anwendung (das LP-Portal unter `/portal` mit eigenem Router)

Ohne angemeldete Erweiterung zeigt der Kern keinen ihrer Einträge: keine toten Menüpunkte, keine Knöpfe ohne Ziel.

## Eine Erweiterung anmelden

1. Code in `ee/api/src/<name>/` und `ee/web/src/<name>/` anlegen; den Kern nur über `@carraway/api/…` bzw. `@carraway/web/…` nutzen.
2. API: eine Funktion, die `ApiErweiterung` liefert, mit Routen und den Regeln dazu:

   ```ts
   export function beispielErweiterung(): ApiErweiterung {
     return {
       name: "beispiel",
       routen: (k) => new Hono().get("/beispiel", (c) => c.json({ ok: true }, 200)),
       regeln: [regel("GET", "/beispiel", "betrachter", [], { bereich: "allgemein" })],
     };
   }
   ```

   und in `vollErweiterungen` (`ee/api/src/index.ts`) aufnehmen. Den Typ für den Client der Oberfläche ergänzt `ee/api/src/typ.ts`.
3. Oberfläche: ein `WebErweiterung`-Objekt in `ee/web/src/erweiterungen.tsx`; Bausteine träge laden (`traege`), damit der Start klein bleibt.
4. Tests in `ee/api/src/__tests__/` (Hilfen aus `hilfen-voll.ts` bauen die Anwendung „Voll“) und neben den Bausteinen in `ee/web/src/`.

## Einstiege und Images

| | Kern | Voll |
|---|---|---|
| API | `apps/api/src/server.ts` | `ee/api/src/server.ts` |
| Worker | `apps/api/src/worker.ts` | `ee/api/src/worker.ts` |
| Oberfläche | `apps/web` (`pnpm --filter @carraway/web build`) | `ee/web` (`pnpm --filter @carraway/ee-web build`) |
| Image | `docker build --build-arg VARIANTE=kern .` | `docker build --build-arg VARIANTE=voll .` (nur im privaten Repo) |

`deploy/docker-compose.yml` baut den Kern (`CARRAWAY_VARIANTE`, Vorgabe `kern`). **„Voll“ gibt es nur im Hosting durch Rehlytics:** Das Image
entsteht aus dem privaten Repo und liegt nur in einer privaten Registry; es wird nie öffentlich veröffentlicht. Für Selbsthoster ist „Voll“
keine Option:

- Das öffentliche Repo enthält `ee/` nicht. Ein Bau mit `VARIANTE=voll` bricht dann ab (`Dockerfile`), die Skripte `dev:voll` finden keine Pakete.
- Die Einstiege des Kerns übergeben keine Erweiterungen (`starteServer()`, `starteWorker()`, `apps/web/src/main.tsx`); keine Umgebungsvariable
  und kein dynamischer Import lädt zur Laufzeit eine nach. Die Bündel des Kerns enthalten keinen Code aus `ee/`, und die Importregel verhindert,
  dass sich das ändert.

## Datenbank: gemeinsames Schema

Tabellen, die nur Erweiterungen brauchen (`werte_schluessel`, `excel_uebernahme`, `investor_benutzer`, `investor_zugang`, `auslesung`, `fonds_offenlegung` und die
ESG-Datenpunkte als Kennzahlen), bleiben im gemeinsamen Schema `packages/db`; die Migrationen bleiben eine lineare Folge. Getrennt ist nur der Code.

Begründung: Getrennte Migrationsreihen bräuchten eine zweite Journal-Datei, eine feste Reihenfolge zwischen den Reihen und Fremdschlüssel über die
Grenze hinweg (Investor-Zugänge hängen an Benutzern und Organisationen, Auslesungen an Dokumenten). Ein Wechsel von „Kern“ zu „Voll“ und zurück
wäre dann eine Migration statt ein anderes Image. Die Tabellen im Kern bleiben leer, solange keine Erweiterung sie füllt. Wo der Kern sie liest,
hält er sich an die Regeln des gemeinsamen Schemas: Er erkennt Investor-Benutzer und sperrt sie für alle internen Routen (403 `portal_only`), und
ein Werteschlüssel (`cww_`) öffnet nie eine Route außerhalb von `/values/`.

## Prüfungen

- **Importregel** (`eslint.config.mjs`): In `apps/`, `packages/` und `scripts/` ist jeder Import aus `ee/` ein Fehler, über Paketnamen
  (`@carraway/ee-*`, `@carraway/excel-addin`) wie über relative Pfade, auch dynamisch (`import(…)`). `scripts/ci/importregel.mjs` prüft mit
  absichtlichen Verstößen, dass die Regel greift.
- **Kern allein** (CI-Job `kern-allein`): `scripts/ci/kern-kopie.sh` legt eine Kopie ohne `ee/` an und installiert sie; darin laufen Lint,
  Typecheck, Build, Budget der Oberfläche, die Tests der Oberfläche und eine Auswahl der API-Tests. Lokal genauso:

  ```sh
  bash scripts/ci/kern-kopie.sh /tmp/kern-kopie
  cd /tmp/kern-kopie && pnpm typecheck && pnpm build && pnpm --filter @carraway/web test
  ```

- **Voll**: Typecheck, Build, Budget (`node scripts/ci/bundle-budget.mjs --voll`) und Tests von `ee/` laufen im gewöhnlichen CI-Lauf mit.
- Die Berechtigungstabelle wird in beiden Builds vollständig geprüft: `apps/api/src/__tests__/rechte.test.ts` (Kern) und
  `ee/api/src/__tests__/rechte-voll.test.ts` (Voll).

## Öffentliches Repo

Der Kern erscheint je Release als **eine Momentaufnahme in einem Commit** („Release vX.Y.Z“) in einem öffentlichen Repo, ohne Historie und ohne `ee/`.
Das Hosting-Image „Voll“ entsteht weiter nur aus dem privaten Repo.

- **Was exportiert wird, bestimmt eine Allowlist** (`scripts/oss/erlaubt.txt`) mit harten Ausschlüssen (`scripts/oss/ausgeschlossen.txt`, darunter `ee/`,
  interne Pläne und Arbeitsunterlagen, Werkzeuge für Kundendaten und die CI des privaten Repos). Neue Dateien bleiben privat, bis sie eingetragen sind.
- **Verweise auf `ee/` im Kern bleiben stehen**, soweit sie nichts brechen: die Paketliste `ee/*` in `pnpm-workspace.yaml`, die Importregel in
  `eslint.config.mjs`, der Schalter `VARIANTE` im `Dockerfile` (ein Bau mit `voll` bricht im öffentlichen Repo mit einer klaren Meldung ab), diese Seite.
  Damit ist öffentlich erkennbar, dass es eine Voll-Variante nur im Hosting gibt. Das Skript `dev:voll` und die Seiten nur zu Erweiterungen
  (z. B. `docs/excel.md`) gehören nicht zum Export.
- **Lockdatei:** `pnpm-lock.yaml` wird unverändert exportiert. `pnpm install --frozen-lockfile` klappt ohne `ee/`, weil pnpm die Einträge fehlender
  Arbeitsbereiche übergeht und der Kern keine andere Version braucht (geprüft im Probelauf, ebenso im CI-Job „Kern allein“).
- **Eine Regel für Export und CI:** `scripts/ci/kern-kopie.sh` (CI-Job „Kern allein“) wählt die Dateien mit demselben Code wie der Export
  (`node scripts/oss/export.ts --kopie <Ordner>`). Was dort grün ist, ist der Stand, der veröffentlicht würde.
- Den Ablauf eines Releases, den Export mit seinen Prüfungen und die Übernahme von Beiträgen aus dem öffentlichen Repo beschreibt `docs/releases.md`
  (nur im privaten Repo).
