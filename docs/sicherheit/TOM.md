# Technische und organisatorische Maßnahmen (TOM)

Vorlage nach Art. 32 DSGVO für den Betrieb von Carraway. Je Kunde ausfüllen: Die Spalte „Umsetzung in Carraway“ beschreibt, was
die Software tut; sie wurde am Code geprüft (Stand: siehe Kopfzeile des Kunden-Exemplars). Die Spalte „Hosting“ hängt vom gewählten
Anbieter und von der Betriebsform ab und ist je Kunde zu ergänzen.

| Feld | Wert |
|---|---|
| Verantwortlicher | [Name und Anschrift] |
| Auftragsverarbeiter | [Name und Anschrift] |
| Betriebsform | [Compose-Stack je Kunde / gemeinsame Postgres-Instanz mit Datenbank je Kunde / beim Kunden] |
| Hosting-Anbieter und Standort | [Anbieter, Rechenzentrum, Land] |
| Software-Version | [Version oder Image-Digest] |
| Stand dieses Dokuments | [Datum] |

Legende der Spalte „Quelle“: **S** = Software (Carraway, im Code umgesetzt), **K** = Konfiguration (Betreiber stellt sie ein),
**H** = Hosting-Anbieter oder Betrieb (je Kunde zu belegen), **O** = organisatorisch (Prozess, nicht Software).

## 1 Vertraulichkeit (Art. 32 Abs. 1 lit. b)

### 1.1 Zutrittskontrolle (physisch)

| Maßnahme | Umsetzung | Quelle |
|---|---|---|
| Zutritt zu den Servern | Rechenzentrum des Hosting-Anbieters: [Zutrittsregelung, Zertifizierung des Anbieters, z. B. ISO 27001 des Rechenzentrums, Nachweis beilegen] | H |
| Zutritt zu Arbeitsplätzen des Auftragsverarbeiters | [Beschreibung: abgeschlossene Räume, Gerätesperre] | O |

### 1.2 Zugangskontrolle (Anmeldung)

| Maßnahme | Umsetzung | Quelle |
|---|---|---|
| Anmeldung mit Passwort | Passwörter haben mindestens 12 und höchstens 128 Zeichen. Sie liegen nur als scrypt-Hash in der Datenbank (Better Auth, `node:crypto.scrypt`). Ein neues Passwort muss sich vom bisherigen unterscheiden. | S |
| Startpasswort | Von der Verwaltung angelegte Konten müssen das Startpasswort beim ersten Anmelden ändern; bis dahin antwortet jede andere Route mit 403 `PASSWORT_AENDERN`. | S |
| Passwort zurücksetzen, Einladung | Nur bei eingerichtetem Mailversand. Einmalige Links (Zurücksetzen 30 Minuten, Einladung 72 Stunden), in der Datenbank nur als Hash; die Anfrage antwortet für jede Adresse gleich und ist je IP und Adresse begrenzt. Der zweite Faktor bleibt bestehen, alle Sitzungen enden. Siehe `Mail-und-Kalender.md`. | S |
| Zwei-Faktor-Anmeldung | Zeitbasierter Einmalcode (TOTP nach RFC 6238) für jede Person, Pflicht in der Vorgabe (`ZWEI_FAKTOR_PFLICHT=1`); ohne zweiten Faktor sind alle Routen außer der Einrichtung gesperrt (403 `ZWEI_FAKTOR_FEHLT`). Rückfallcodes. Die TOTP-Geheimnisse liegen verschlüsselt in der Datenbank (Schlüssel: `BETTER_AUTH_SECRET`). „Gerät merken“ ist abgeschaltet: jede Anmeldung verlangt den Code. Der Weg über Einmalcode per E-Mail ist abgeschaltet. | S, K |
| Firmenanmeldung (SSO) | Optional über OpenID Connect mit Microsoft Entra ID (feste Verzeichnis-ID) und Google (`OIDC_*`). Neue Konten entstehen darüber nur bei offener Registrierung, sonst legt die Verwaltung die Person vorher an. Konten werden nur bei einem festen Entra-Verzeichnis über die Adresse verknüpft. | S, K |
| Schutz vor Raten von Passwörtern | Je Adresse und je Konto höchstens 10 Fehlversuche in 15 Minuten bei Anmeldung, Einmalcode und Rückfallcode, danach 429 `ZU_VIELE_VERSUCHE` mit `Retry-After`. Die Zähler liegen in der Datenbank. Hinter einem Reverse-Proxy braucht es `PROXY_VERTRAUEN=1`, sonst sieht die API nur die Adresse des Proxys. | S, K |
| Sitzungen | Sitzungs-Cookie `HttpOnly`, `SameSite=Lax`, bei `https://`-Adressen `Secure`. Sitzungsdauer 12 Stunden, Verlängerung bei Nutzung höchstens alle 30 Minuten. Die IP-Adresse der Sitzung wird nur gespeichert, wenn `PROXY_VERTRAUEN=1` gilt. | S |
| Schutz vor fremden Seiten (CSRF) | Schreibende Anfragen müssen den konfigurierten `Origin` tragen (`APP_ORIGIN`); Cookie ohne Ursprung wird abgelehnt. | S |
| Konten sperren | Die Verwaltung kann Konten sperren; der einzige aktive globale Verwalter kann weder gesperrt noch entmachtet werden. | S |
| Einrichtung einer neuen Installation | `/einrichtung` ist nur offen, solange es keine Person gibt; die erste Person wird Verwalter. Danach 403. Betrieb: zuerst einrichten, dann ins Netz stellen (deploy/README.md). | S, O |
| Zugang zu den Servern (Administration) | [SSH nur mit Schlüssel, Zwei-Faktor für Verwaltungsoberflächen, Rollen und Protokollierung beim Anbieter] | H, O |

### 1.3 Zugriffskontrolle (Berechtigungen)

| Maßnahme | Umsetzung | Quelle |
|---|---|---|
| Rollen je Fonds | Vier Rollen je Fonds: Betrachter, Bearbeiter, Freigeber, Verwalter (aufsteigend). Zusätzlich globale Verwalter. Jede Route hat in einer zentralen Tabelle (`rechte/tabelle.ts`) ihre Mindestrolle; Routen ohne Eintrag sind verboten (401 ohne Anmeldung, sonst 403). Die Rolle wird am Fonds des betroffenen Datensatzes geprüft, nicht nur „irgendwo“. | S |
| Sichtbarkeit | Listen und Auswertungen zeigen nur Fonds, in denen die Person eine Rolle hat. | S |
| Funktionstrennung (Vier-Augen) | Freigaben verlangen eine andere Person als die Erstellung oder Prüfung: Bewertungen, Zinsläufe, Berichte (jede Stufe eine andere Person; wer einen Abschnitt bearbeitet hat, gibt ihn nicht frei), Beschluss und Überführung eines Deals ins Portfolio. Zustimmende Beschlüsse und Freigaben können nur Personen mit der Rolle Freigeber geben, nie ein API-Schlüssel. | S |
| Periodensperre | Je Fonds ein Sperrdatum: Buchungen in gesperrten Perioden lehnt der Server ab (409 `PERIODE_GESPERRT`), zusätzlich ein Datenbank-Trigger. Zurücknehmen verlangt einen Grund und wird protokolliert. | S |
| API-Schlüssel | Anlage nur durch globale Verwalter. Der Schlüssel wird genau einmal angezeigt; in der Datenbank liegt nur sein SHA-256-Hash. Jeder Schlüssel hat einen eigenen technischen Benutzer, Rechte je Fonds (lesen oder schreiben, nie Freigabe), einen Ablauf (Vorgabe 90 Tage, höchstens 365) und lässt sich widerrufen. | S |
| Postfach- und Kalenderanbindung | Freiwillig und je Person; Zugangsdaten (OAuth-Tokens, IMAP-Zugang) nur mit AES-256-GCM verschlüsselt in der Datenbank (Schlüssel `GEHEIMNIS_SCHLUESSEL`, Bindung an die Zeile, Schlüsselwechsel möglich), für niemanden lesbar, auch nicht für Verwalter. Nur lesende Berechtigungen. Gespeichert werden nur Treffer mit bekannten CRM-Kontakten; Anhänge nur auf ausdrücklichen Klick. Einzelheiten: [Mail-und-Kalender.md](Mail-und-Kalender.md). | S, K |
| Ausgehende Mail | SMTP-Zugang nur aus der Umgebung; Ausgangskorb mit verschlüsseltem Inhalt, der nach dem Versand gelöscht wird; Stundenlimit; kein Tracking; Protokoll ohne Inhalt. | S, K |
| Datenbankrechte | Die Anwendung läuft mit einer Rolle ohne DDL-Rechte im Schema `public` (nur SELECT, INSERT, UPDATE, DELETE); Migrationen laufen mit einer getrennten Eigentümerrolle. Auf einer gemeinsamen Instanz haben andere Rollen keinen Zugang zur Datenbank. Ausnahme: das Schema der Warteschlange `pgboss` gehört der App-Rolle (deploy/README.md, „Rechte der Datenbank“). | S, K |
| Zugriff der Administration auf Daten | [Wer beim Auftragsverarbeiter Zugriff auf Datenbank oder Sicherungen hat, wie begründet und protokolliert] | O, H |

### 1.4 Trennungskontrolle

| Maßnahme | Umsetzung | Quelle |
|---|---|---|
| Trennung der Kunden | Eine Datenbank je Kunde (oder ein eigener Stack je Kunde), eigene Rollen, eigenes `BETTER_AUTH_SECRET`, eigene Dateiablage. | S, K |
| Trennung von Demo, Test und Echt | `CARRAWAY_UMGEBUNG` (demo, test, echt) je Stack. Im Echtbestand ist das Seed-Skript mit Demo-Daten und Demo-Zugängen gesperrt; die Oberfläche kennzeichnet Demo- und Testbestände mit einem Banner. | S, K |

### 1.5 Pseudonymisierung und Verschlüsselung

| Maßnahme | Umsetzung | Quelle |
|---|---|---|
| Verschlüsselung bei der Übertragung | Carraway selbst spricht kein TLS; ein Reverse-Proxy beendet TLS (mindestens 1.2). Bei `https://`-Adressen setzt die API `Secure`-Cookies und `Strict-Transport-Security`; im Echtbestand sind nur `https://`-Adressen zugelassen. Zwischen Proxy und API: [Loopback oder internes Netz]. Zwischen API und Datenbank: [im Compose-Netz des Hosts; bei getrennter Datenbank TLS der Verbindung einrichten]. | K, H |
| Verschlüsselung gespeicherter Daten | Anwendungsseitig verschlüsselt sind die TOTP-Geheimnisse; Passwörter sind gehasht, API-Schlüssel nur als Hash gespeichert. Die Datenbank und die Dateiablage selbst verschlüsselt Carraway nicht. Verschlüsselung des Datenträgers: [Anbieter-Verschlüsselung oder LUKS, Schlüsselverwaltung]. | S, H |
| Verschlüsselung der Sicherungen | [Verschlüsselung am Ablageort oder vor der Übertragung, z. B. age/GPG; wo liegen die Schlüssel] | H, O |
| Pseudonymisierung | Nicht Bestandteil der Software. Logs enthalten nur die Benutzer-ID. Demo-Daten sind erfunden. | S |

## 2 Integrität (Art. 32 Abs. 1 lit. b)

### 2.1 Weitergabekontrolle

| Maßnahme | Umsetzung | Quelle |
|---|---|---|
| Weitergabe nur über die API | Zugriff ausschließlich über angemeldete Sitzung oder API-Schlüssel; es gibt keine öffentliche Datei- oder Datenfreigabe. Berichtsdateien sind nur mit Rolle (mindestens Betrachter am Fonds) abrufbar. | S |
| Protokoll von Lesezugriffen | Der Abruf von Berichten (Fondsbericht, Portfolioliste, Quartalsbericht, Gremienvorlage) und von Dateien freigegebener Berichte schreibt eine Zeile `gelesen` (wer, wann, was) ins Änderungsprotokoll. | S |
| Weitergabe an Dritte | Unterauftragsverarbeiter siehe Unterauftragsverarbeiter.md; es gibt keine Anbindung an Werbe- oder Analysedienste und kein Tracking. Die Schriften der Oberfläche werden selbst ausgeliefert (kein Aufruf von Google Fonts), ein Test sichert das ab. | S, O |

### 2.2 Eingabekontrolle

| Maßnahme | Umsetzung | Quelle |
|---|---|---|
| Änderungsprotokoll | Jede schreibende Anfrage legt in derselben Transaktion eine Protokollzeile an (Akteur, Anzeigename, Aktion, Tabelle, Datensatz, Zustand vorher und nachher). Die Tabelle ist per Datenbank-Trigger nur anhängend (UPDATE und DELETE werden abgewiesen). Das schützt gegen die Anwendung und gegen Fehler, nicht gegen Datenbankadministratoren mit Eigentümerrechten: dort [Zugriffsbeschränkung und Protokollierung beim Anbieter]. | S, H |
| Unveränderliche Buchungen | Vorgänge, freigegebene Bewertungen und freigegebene Berichte sind per Trigger unveränderlich; eine Korrektur ist ein Storno oder eine neue Version. | S |
| Eingabeprüfung | Alle Eingaben werden gegen Schemas geprüft (Zod); Beträge als Dezimalzahlen mit höchstens zwei Nachkommastellen. | S |
| Anwendungslogs | JSON-Logs mit Anfrage-ID, Methode, Routenmuster, Status, Dauer, Benutzer-ID. Keine Adressen, Namen, Beträge, Abfragezeichenfolgen oder Geheimnisse; Fehler ohne Abfrageparameter. Aufbewahrung der Logs: [Frist, Ort]. | S, H |

## 3 Verfügbarkeit und Belastbarkeit (Art. 32 Abs. 1 lit. b und c)

| Maßnahme | Umsetzung | Quelle |
|---|---|---|
| Datensicherung | `deploy/sicherung.sh`: Datenbank (`pg_dump`, Custom-Format) und Dateiablage, mit Prüfsummen, Aufbewahrungsfrist einstellbar (Vorgabe 14 Tage). Zeitplan und Ablageort: [Intervall, Aufbewahrung, Ort, getrennt vom Produktivsystem]. | S, K, H |
| Wiederherstellung geprobt | `deploy/wiederherstellung.sh` und der automatische Test `pnpm ops:sicherung-test` (Dump, Wiederherstellung in eine frische Datenbank, Vergleich von Zeilenzahl und Prüfsumme je Tabelle), bei jedem Stand von `main` in der CI. Wiederherstellung beim Kunden: [Datum der letzten Übung, Ergebnis]. | S, O |
| Wiederherstellungsziele | [RPO und RTO des Vertrags, z. B. 24 Stunden und 8 Stunden] | O |
| Überwachung | `GET /api/v1/gesundheit` (Datenbank, Worker-Herzschlag, Verzug der Warteschlange), `GET /metriken` im Prometheus-Format mit eigenem Token, Health-Checks der Container. Alarmierung: [Dienst, Empfänger, Reaktionszeit]. | S, K, H |
| Ausfallsicherheit der Infrastruktur | [Redundanz von Strom, Netz, Speicher; Hochverfügbarkeit der Datenbank, falls vereinbart] | H |
| Schutz vor Überlast | Zeitgrenzen je Datenbankabfrage (5 s) und je Sperre (2 s) in der Anwendung; Begrenzung von Anfragegrößen und Raten im Reverse-Proxy: [Konfiguration]. | S, K |
| Wiederanlauf | Container starten nach Neustart des Hosts neu (`restart: unless-stopped`); Aufträge der Warteschlange gehen nicht verloren (Ausgangskorb in der Datenbank). | S |
| Schutz vor Schadsoftware und Angriffen | [Härtung des Hosts, Firewall, Updates des Betriebssystems, Intrusion Detection] | H |
| Härtung der Container | Läuft ohne Root, Dateisystem schreibgeschützt, ohne zusätzliche Linux-Fähigkeiten, `no-new-privileges`. | S |

## 4 Verfahren zur regelmäßigen Überprüfung (Art. 32 Abs. 1 lit. d, Art. 25)

| Maßnahme | Umsetzung | Quelle |
|---|---|---|
| Automatisierte Tests und Prüfungen | Bei jeder Änderung in der CI: Lint, Typprüfung, Tests (einschließlich Rechte-, Anmelde- und Datenbanktests), Build. Bei Pushes auf `main` zusätzlich Image-Build und Wiederherstellungstest. | S |
| Schwachstellenmanagement | Meldeweg und Fristen siehe `SECURITY.md`. Abhängigkeiten sind über die Lock-Datei festgelegt (`pnpm install --frozen-lockfile`, Basis-Image mit Tag und Digest). Ein automatischer Abgleich mit Schwachstellendatenbanken ist im Repository nicht eingerichtet: [Verfahren des Betreibers]. | S, O |
| Datenschutz durch Voreinstellung | Registrierung geschlossen, Zwei-Faktor Pflicht, Metriken aus, kein Zugriff von außen auf die Datenbank. | S |
| Datenschutz-Folgenabschätzung, Verzeichnis von Verarbeitungstätigkeiten | [Verantwortlicher führt sie; Zuarbeit des Auftragsverarbeiters] | O |
| Schulung und Verpflichtung | [Verpflichtung auf Vertraulichkeit, Schulung der Personen mit Zugriff] | O |
| Umgang mit Datenschutzvorfällen | [Melde- und Eskalationsweg, Fristen nach AVV, Ansprechperson] | O |
| Löschung und Rückgabe | Löschung von Datensätzen über die Anwendung (soweit fachlich zulässig); am Vertragsende Rückgabe als Datenbank-Dump und Dateiablage, danach Löschung der Datenbank, der Sicherungen und Volumes: [Frist, Nachweis]. | S, O |

## 5 Eingesetzte Daten (Orientierung für das Verzeichnis)

Gespeichert werden: Konten der Nutzerinnen und Nutzer (Name, E-Mail-Adresse, Passwort-Hash, verschlüsseltes TOTP-Geheimnis,
Sitzungen), Kontaktdaten aus Dealflow und Beteiligungen (Vorname, Nachname, E-Mail-Adresse, Funktion, Organisation, Aktivitäten
als Freitext), Fonds- und Beteiligungsdaten sowie Beträge. Mit eingeschalteter Anbindung von Postfach und Kalender zusätzlich Betreff, Datum und Beteiligte von Mails und Termine mit bekannten Kontakten (optional der Anfang des Mailtextes), verschlüsselte Zugangsdaten und der Ausgangskorb für Mails (Empfänger, Betreff, Status). Besondere Kategorien personenbezogener Daten sind nicht vorgesehen;
Freitextfelder können sie enthalten, wenn Nutzer sie eintragen: [Hinweis an die Nutzer].
