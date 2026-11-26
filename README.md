# Carraway

Plattform für Beteiligungsgesellschaften: Dealflow, Fondsverwaltung und Portfolio-Management in einem System, mit nachvollziehbarer Herkunft jeder Kennzahl. Dies ist der Kern, frei unter der GNU Affero General Public License 3.0 (AGPL-3.0).

*English: Carraway is a platform for venture and private-equity firms: deal flow, fund administration and portfolio management in one system, with a traceable origin for every figure. This repository holds the open core under AGPL-3.0. Operating instructions are in [deploy/README.en.md](deploy/README.en.md).*

## Was der Kern enthält

Dealflow, Akten und Dokumente, Kapital und Journal, Bewertungen und Kennzahlen, Berichte mit Freigabe (PDF und Excel), HTTP-API, Import, Vollexport mit Rechenregeln, Zwei-Faktor-Anmeldung, Rollen, Änderungsprotokoll, Postfach- und Kalenderanbindung, lokale Texterkennung. Einzelne Erweiterungen (zum Beispiel Investorenportal, Single Sign-On, KI-Funktionen) gibt es nur im Hosting durch Rehlytics und gehören nicht zu diesem Repository.

## Installation mit Docker Compose

Voraussetzungen: Docker mit Compose 2.20 oder neuer, ein Server, eine Adresse mit TLS-Zertifikat davor (Reverse-Proxy).

```bash
git clone https://github.com/carraway-app/carraway.git carraway && cd carraway/deploy
cp .env.beispiel .env
$EDITOR .env            # Pflichtwerte ausfüllen, Hinweise stehen in der Datei
docker compose up -d
docker compose ps       # alle Dienste "healthy", migrate "exited (0)"
```

Das fertige Image liegt in der GitHub Container Registry: `ghcr.io/carraway-app/carraway`. Es wird mit `CARRAWAY_IMAGE` in der `.env` ausgewählt, am besten mit fester Versionsnummer (`:1.2.3`), nicht mit `:latest`. Wer selbst bauen will, startet mit `docker compose up -d --build`.

Die ausführliche Anleitung, auch zu Sicherung, Wiederherstellung und Aktualisierung, steht in [deploy/README.md](deploy/README.md) und [docs/betrieb/README.md](docs/betrieb/README.md).

## Hosting

Wer Carraway nicht selbst betreiben möchte, kann es von Rehlytics hosten lassen. Das Hosting enthält zusätzlich die Erweiterungen.

## Entwicklung

Voraussetzungen: Node 24, pnpm 11, PostgreSQL für die Tests.

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm build
```

Die Tests brauchen eine Test-Datenbank; siehe [CONTRIBUTING.md](CONTRIBUTING.md).

## Mitmachen und Sicherheit

- Beiträge sind willkommen: [CONTRIBUTING.md](CONTRIBUTING.md)
- Sicherheitslücken bitte vertraulich melden: [SECURITY.md](SECURITY.md)

## Lizenz

AGPL-3.0, siehe [LICENSE](LICENSE). Wer Carraway verändert und über ein Netzwerk anderen zur Verfügung stellt, muss den veränderten Quelltext unter derselben Lizenz anbieten.
