# Registerdaten: Zugangswege

Stand der Recherche: 20.11.2026. Es wurden keine Registerformulare abgefragt, nur Dokumentation und Rechtsgrundlagen gelesen. Alles hier ist eine technische Einordnung und keine Rechtsberatung.

## Entscheidung

Carraway **ruft Registerportale nicht automatisiert ab** (kein Scraping). Registerdaten kommen auf diesen Wegen in die Plattform:

1. **Manuelle Eingabe** am Unternehmen.
2. **Amtlicher Auszug als Dokument** (Etappe 13): Die Person ruft den Auszug selbst ab, lädt ihn hoch und übernimmt die Felder von Hand. Eine KI-Auslesung der Registerfelder ist nicht Teil dieser Etappe.
3. **Strukturierte Importdatei** (CSV oder JSON) für Sammelaktualisierungen, z. B. aus einem Auszug oder einem lizenzierten Datenbezug.
4. **Anbieter-Schnittstelle** über die Schnittstelle `RegisterAnbieter` (`suche`, `abruf`). Mitgeliefert wird nur ein Testanbieter. Ein Adapter für einen Anbieter mit Vertrag kann ergänzt werden, sobald die Weiterverwendungsrechte geklärt sind.

## Befunde

| Weg | Befund | Quelle |
|---|---|---|
| Gemeinsames Registerportal der Länder | Einsicht zu Informationszwecken durch einzelne Abrufe (§ 9 Abs. 1 HGB). Laut Nutzungsordnung (nur aus Zitaten bekannt) sind mehr als 60 Suchen oder Aufrufe pro Stunde und systematische Abrufe zum Aufbau paralleler Register unzulässig. Keine offizielle maschinelle Schnittstelle gefunden. | https://www.gesetze-im-internet.de/hgb/__9.html, https://github.com/bundesAPI/handelsregister (zitiert die FAQ des Portals), https://www.ihk.de/koeln/hauptnavigation/recht-steuern/recht/gefahr-missbrauch-registerdaten-5644100 |
| Gebühren | Suche und Veröffentlichungen online frei, übrige Abrufe nach JVKostG gebührenpflichtig. Beträge in den Quellen widersprüchlich, vor Verwendung prüfen. | https://www.gesetze-im-internet.de/jvkostg/anlage.html |
| Unternehmensregister | Die AGB enthalten keine Regel zu automatisierten Abfragen und keine Schnittstelle für Abrufe. Abruf hinterlegter Rechnungslegung ist gebührenpflichtig. | https://www.bundesanzeiger.de/pub/D088.pdf |
| Hochwertige Datensätze (EU) | Die Durchführungsverordnung (EU) 2023/138 nennt Unternehmensdaten als hochwertigen Datensatz (offene Lizenz, API und Massendownload). Für Deutschland wurde kein offizieller, kostenloser Zugang für das Handelsregister belegt. Das ist fehlende Evidenz, kein Beweis. | https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:32023R0138 |
| EU-Registervernetzung (BRIS, e-Justice) | Weboberfläche zur Suche in nationalen Registern. Eine Schnittstelle für Dritte wurde nicht belegt. | https://e-justice.europa.eu/ |
| OffeneRegister.de | Bekanntmachungen als JSON und SQLite unter CC BY 4.0, Stand alt (Ende 2018) und nicht fortgeschrieben: nur für Historie und Tests. | https://offeneregister.de/ |
| OpenCorporates | Datenbanklizenz mit Weitergabe unter gleichen Bedingungen und Namensnennung; kommerzielle Nutzung sonst nur mit Vertrag. | https://opencorporates.com/legal-information/ |
| GLEIF (LEI) | Kostenlose Schnittstelle und Gesamtbestand, nur für Einheiten mit LEI. Als Zusatzquelle für Name, Rechtsform, Sitz und Status denkbar. | https://www.gleif.org/en/lei-data/gleif-api |
| Kommerzielle Anbieter | Mehrere Anbieter bieten eine dokumentierte, kostenpflichtige Schnittstelle. Weiterverwendungs- und Lizenzbedingungen vor Vertragsschluss prüfen. | Angaben der Anbieter |

## Offen vor einer Anbindung

- Wortlaut der aktuellen Nutzungsordnung des Registerportals im Browser lesen (die Grenze von 60 stammt aus Zitaten).
- Aktuelle Gebühren nach JVKostG.
- Stand der Umsetzung der hochwertigen Datensätze beim Bund und den Ländern.
- Datenschutz: Vertretungsorgane sind natürliche Personen. Zweck und Rechtsgrundlage der Speicherung sind zu dokumentieren.

## Technische Folgen

- Die Beobachtung (Worker-Auftrag) ist standardmäßig aus (`REGISTER_PRUEFUNG_CRON` leer) und ruft nur den konfigurierten Anbieter ab, höchstens `REGISTER_ABRUFE_PRO_LAUF` Unternehmen je Lauf (Vorgabe 20), mit Pause zwischen den Abrufen.
- Ohne konfigurierten Anbieter (`REGISTER_ANBIETER` leer) antworten Suche und Abruf mit 409 `register_provider_missing`.
