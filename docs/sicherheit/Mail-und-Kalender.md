# Mail und Kalender

Stand: Etappe 17. Beides ist **standardmäßig aus** und wird je Installation über die Umgebung eingerichtet (Compose-Umgebung, siehe `deploy/.env.beispiel`).

1. **Ausgehende Mail**: Link zu einer Kennzahlen-Anfrage oder einem ESG-Fragebogen an die Kontaktperson eines Unternehmens, Hinweis an Investor-Benutzer auf neue Mitteilungen im Portal, Hinweis auf freigegebene Berichte, Meldeläufe und Belege (nur für Personen, die das einschalten; alle Berichtsarten einschließlich PAI-Erklärung). Über SMTP, aus einem Ausgangskorb.
2. **Postfach und Kalender (eingehend, nur lesend)**: Wer will, verbindet das eigene Postfach (Microsoft 365, Google oder IMAP) und den eigenen Kalender (Microsoft 365, Google). Gespräche und Termine mit **bekannten** CRM-Kontakten erscheinen im Verlauf von Person, Organisation und Deal.
3. **Kalenderabonnement (ICS)** der eigenen Wiedervorlagen.

Die Clients für Microsoft Graph, Gmail und Google Kalender sind dünne HTTP-Aufrufe ohne SDK. **Sie sind nicht gegen die echten Dienste geprüft** (siehe den Abschnitt „Vor dem Einsatz bei einem Anbieter prüfen“).

## Ausgehende Mail

| Variable | Bedeutung |
|---|---|
| `SMTP_HOST`, `SMTP_PORT` | Server, Vorgabe Port 587. Ohne `SMTP_HOST` ist der Versand aus. |
| `SMTP_TLS` | `starttls` (Vorgabe), `tls` (von Anfang an, Port 465) oder `keine` (nur Demo und Entwicklung; im Echtbestand verbietet die Konfiguration es). |
| `SMTP_BENUTZER`, `SMTP_PASSWORT` oder `SMTP_PASSWORT_DATEI` | Anmeldung am Server. Das Passwort steht nur in der Umgebung oder in einer Datei (z. B. ein Docker-Secret), nie in der Datenbank, in der API, im Protokoll oder in Logs. |
| `SMTP_ABSENDER` | Absenderadresse (`Von`). Pflicht mit `SMTP_HOST`. |
| `MAIL_LIMIT_PRO_STUNDE` | Höchstzahl gesendeter Mails je Stunde und Installation (Vorgabe 200); darüber bleiben Aufträge liegen und gehen später raus. |
| `GEHEIMNIS_SCHLUESSEL` | Pflicht für jede Mail mit einmaligem Link und für die Postfachanbindung (siehe „Zugangsdaten und Schlüssel“). |

**Ablauf.** Eine Aktion legt in ihrer Transaktion einen Auftrag in `mail_auftrag` an (Ausgangskorb). Der Worker übernimmt fällige Aufträge (kurze Transaktion), sendet **außerhalb jeder Transaktion** und schließt den Auftrag ab. Zwei Worker holen nie denselben Auftrag. Bei einem vorübergehenden Fehler folgen Wiederholungen nach 1, 5, 30 und 120 Minuten, nach fünf Versuchen oder bei einem endgültigen Fehler (Adresse abgelehnt, Anmeldung falsch) gilt der Auftrag als fehlgeschlagen. Lehnt die Aktion ab (z. B. Rolle fehlt), entsteht kein Auftrag; ohne eingerichteten Versand antworten die auslösenden Routen mit `409 mail_not_configured`, und die Aktion findet nicht statt.

**Vorlagen** (Deutsch und britisches Englisch, Text und einfaches HTML): `kennzahl_abfrage`, `esg_abfrage` (Fragebogen zu Nachhaltigkeitsindikatoren), `lp_mitteilung`, `bericht_freigegeben` (Bericht, Meldelauf oder Beleg nach der letzten Freigabestufe), `passwort_zuruecksetzen`, `einladung`, `testmail`. Keine Bilder, keine externen Dateien, keine Verfolgung (kein Öffnungs- und Klick-Tracking, keine Weiterleitungsadressen, keine Lesebestätigung); Werte sind im HTML maskiert, Betreffs ohne Zeilenumbrüche. **Mitteilungen aus dem Portal nennen nie Beträge und hängen nie das Dokument an**, sie weisen nur auf das Portal hin.

**Was gespeichert und protokolliert wird.**

- `mail_auftrag` hält Empfänger, Vorlage, Betreff, Bezug (Art und ID des Datensatzes), Status, Versuche und den letzten Fehlercode. Der Inhalt (Text und HTML, mit dem einmaligen Link) steht nur **verschlüsselt** darin und wird nach dem Versand und nach dem endgültigen Fehlschlag **gelöscht**. Der Vollexport und die Änderungsabfrage führen die Tabelle nicht.
- Zeilen des Ausgangskorbs, die gesendet oder fehlgeschlagen sind, löscht der Worker nach 90 Tagen. Das Änderungsprotokoll (Aktionen `anlegen`, `gesendet`, `fehlgeschlagen` mit Empfänger, Vorlage und Bezug, ohne Inhalt) bleibt wie das übrige Protokoll.
- Logs enthalten für den Mailversand nur Auftrags-ID, Fehlercode und Versuchszahl, nie Adressen oder Inhalte. Fehlertexte von SMTP-Servern werden nicht übernommen.
- Kennzahlen-Link: Der Link in der Mail ist das einzige Mal, dass der Klartext des Tokens außerhalb der Antwort steht. In der Datenbank stehen weiter nur der Hash des Tokens und, bis zum Versand, der verschlüsselte Inhalt. „Per Mail senden“ bei einer bestehenden Anfrage erzeugt wie „Neuer Link“ einen **neuen** Link (der alte wird ungültig), weil das Token nach dem Anlegen nicht mehr lesbar ist. Der Link bleibt in der Oberfläche zum Kopieren sichtbar. Empfänger kann nur eine Person mit Mailadresse sein, die zum Unternehmen der Beteiligung gehört.

**Rechte.** Status, Testmail und Ausgangskorb sieht nur ein globaler Verwalter (Mensch, nie ein API-Schlüssel). Die Statusansicht zeigt Server, Port, Verschlüsselung, Absender, ob eine Anmeldung gesetzt ist und das Limit, **nie Benutzer oder Passwort**. Die Testmail geht nur an die Adresse der angemeldeten Person. Die Ansicht des Ausgangskorbs enthält nie Inhalte.

**Passwort zurücksetzen und Einladung.** Beides gibt es nur bei eingerichtetem Mailversand (`SMTP_HOST` und Schlüsselring); sonst blendet die Oberfläche es aus, und Verwalter vergeben weiter Startpasswörter. Der Weg über Einmalcode per E-Mail beim Anmelden bleibt abgeschaltet.

- *Zurücksetzen:* Die Anmeldeseite bietet „Passwort vergessen?“ an. Die Anfrage (`POST /passwort/vergessen`) antwortet für jede Adresse gleich (Status, Körper, Mindestdauer); für unbekannte, gesperrte und technische Konten läuft dieselbe Arbeit mit zurückgerollter Transaktion. Begrenzt ist sie je IP (10 je Stunde) und je Adresse (3 je Stunde, nur als Hash gezählt), unabhängig davon, ob es die Adresse gibt. Der Link in der Mail gilt 30 Minuten und einmal; eine neue Anfrage macht frühere Links ungültig.
- *Einladung:* Legt ein Verwalter eine Person (auch einen Investor-Zugang) ohne Passwort an, bekommt sie eine Mail mit einem Link zum Festlegen des Passworts (72 Stunden, einmal). Danach folgt wie bisher die Einrichtung des zweiten Faktors. „Einladung erneut senden“ ersetzt den Link.
- *Token:* Das Token steht im Fragment der Adresse (`/passwort-setzen#token=…`), erreicht also weder Server-Zugriffsprotokolle noch den Referer, und liegt in der Datenbank nur als Hash (SHA-256, Kennung mit Präfix `pw1:`; Better Auth `verification.storeIdentifier`). Das Einlösen läuft über `POST /auth/reset-password` und zählt Fehlversuche je IP in die gemeinsame Begrenzung.
- *Zweiter Faktor:* Zurücksetzen entfernt ihn nie. Wer ihn eingerichtet hat, gibt ihn nach dem Zurücksetzen weiter ein; alle Sitzungen der Person enden mit dem Zurücksetzen. Anfrage, Einladung und Zurücksetzen stehen im Änderungsprotokoll (ohne Token).

**Demo.** `docker compose --profile demo-mail up -d` startet einen Mailfänger (`mailpit`, Image mit festem Digest, nur auf `127.0.0.1:8025`). Mit `SMTP_HOST=mailpit`, `SMTP_PORT=1025`, `SMTP_TLS=keine` landen alle Mails dort; nichts verlässt den Rechner.

## Postfach und Kalender anbinden

### Was gelesen und gespeichert wird

- **Gelesen** wird nur: bei Mails Absender, Empfänger, Cc, Datum, Betreff und die Nachrichten-ID; bei Terminen Titel, Zeit und Teilnehmeradressen. Der Anfang des Mailtextes wird erst **nach** der Zuordnung und nur für passende Nachrichten und nur mit Erlaubnis der Person geholt. **Anhänge werden beim Abgleich nie gelesen.**
- **Zugeordnet** wird gegen eine Positivliste: Eine Nachricht oder ein Termin wird nur gespeichert, wenn ein Beteiligter eine **bekannte Person** (Mailadresse im CRM) ist oder seine Adresse zur Domain der **Website einer Organisation** passt. Alles andere wird verworfen, bevor es gespeichert wird; Mails und Termine unbekannter Kontakte entstehen nirgends, auch nicht als Teilinformation. Die Domain muss **genau** der Domain der Website entsprechen (`mail.firma.example` gehört nicht zur Organisation `firma.example`, es sei denn, diese Unterdomain ist selbst als Website eingetragen); die Mailadresse einer bekannten Person hat Vorrang vor jeder Domain. Nie über die Domain zugeordnet werden die eigene Adresse und die eigene Domain, Freemail-Anbieter (z. B. `gmail.com`), Domains mit nur einem Label, bekannte Mehrmandanten-Hosts (z. B. `github.io`, `azurewebsites.net`) und öffentliche Suffixe (z. B. `co.uk`); die kleine Liste steht in `postfach/abgleich.ts`. Fehlt ein Anbieter auf der Liste, bleibt die Zuordnung über die Mailadresse der Person der sichere Weg. Zusammengeführte Personen und Organisationen zeigen auf ihr Ziel.
- **Kontakte aus Postfach und Kalender** (Standard aus): Schaltet ein globaler Verwalter die Funktion ein (Verwaltung, Modus „als Vorschlag“ oder „direkt anlegen“) und nimmt eine Person mit ihrem Postfach teil (persönliche Einstellungen, Standard aus), bleiben von echten Gegenübern Adresse und Anzeigename. Echte Gegenüber sind nur Empfänger von Mails aus dem Gesendet-Ordner (Anbieterfakt: Gmail-Label `SENT`, Graph-Ordner `sentitems`, IMAP-Ordner mit Sonderverwendung `\Sent`; nie aus der fälschbaren From-Zeile) und Teilnehmer von Terminen, die die Person selbst organisiert oder ausdrücklich angenommen hat (offene, mit Vorbehalt angenommene und abgelehnte Einladungen zählen nicht, denn einladen kann jeder). Ausgenommen sind die eigene Adresse, bekannte Personen, Adressen der Benutzer, eigene Domains der Installation, die Sperrlisten der Installation und der Person, `no-reply` und ähnliche Adressen, Mails mit Listen- oder Massenkopfzeilen und Mails mit mehr als 10 Empfängern bzw. Termine mit mehr als 20 Teilnehmern. Adresslisten werden nach RFC 5322 gelesen (Adresse aus spitzen Klammern, nie aus dem Anzeigenamen). Gespeichert werden im Vorschlag nur Adresse, Name und aus wessen Postfach (Person und Bereich) er stammt, nie Betreff, Inhalt oder Anzahl der Mails. Vorschläge sieht nur die Person, aus deren Postfach sie stammen; Trennen, Austritt aus der Teilnahme oder Sperren der Person entfernt ihre offenen Vorschläge. Am angelegten Kontakt steht, aus wessen Postfach er stammt und wann. Das Änderungsprotokoll nennt bei Vorschlägen nur Kennungen und bei Sperrlisten nur die Anzahl der Einträge.
- **Gespeichert** wird als Aktivität der Art Mail: Betreff (höchstens 300 Zeichen), Datum, Richtung, die zugeordneten Kontakte (Person, Organisation und, wenn die Organisation genau einen offenen Deal hat, der Deal), optional die ersten 500 Zeichen des Textes (Schalter je Person, Vorgabe **aus**). Als Aktivität der Art Termin: Titel, Zeit, zugeordnete Teilnehmer. Dazu in `aktivitaet_sync` die Herkunft: wessen Verbindung, welcher Anbieter, Beginn und Ende, die IDs der zugeordneten Personen, ein Hash der Nachrichten- oder Termin-ID und für Mails die ID der Nachricht beim Anbieter (nur zum Nachladen von Anhängen auf Klick).
- **Änderungsprotokoll:** Für synchronisierte Aktivitäten steht dort nie Betreff, Titel oder Textauszug, nur Art, Datum und Verknüpfungen. Das Protokoll ist nur anhängend; stünde der Inhalt dort, bliebe er nach dem Löschen durch die Person erhalten.

### Wer sieht was

- **Verbindungen, Tokens und nicht abgeglichene Daten** gehören der Person: Jede Route der Anbindung filtert nach der angemeldeten Person; auch globale Verwalter sehen und ändern keine fremden Verbindungen (404). Zugangsdaten sind für niemanden lesbar.
- **Übernommene Aktivitäten folgen den CRM-Regeln**: Sie sind für alle sichtbar, die den verknüpften Deal (Rolle am Fonds des Deals) oder, ohne Deal, die Organisation und Person sehen dürfen, **also nicht nur für die Person, deren Postfach sie angelegt hat**. Die Oberfläche sagt das vor dem Verbinden und verlangt die Zustimmung. Eine Aktivität mit Deal eines fremden Fonds bleibt für Personen ohne Rolle an diesem Fonds unsichtbar.
- Die Herkunft („aus Ihrem Konto“ oder „aus dem Konto einer anderen Person“) steht an jedem Eintrag; wessen Konto, nennt die API nicht.

### Kontrolle der Person

- **Opt-in:** Ohne Zustimmung und eigene Verbindung wird nichts gelesen. Mail und Kalender verbindet die Person getrennt.
- **Entfernen:** Die Person kann jede übernommene Mail und jeden Termin ihres Kontos aus dem Verlauf entfernen. Das löscht die Aktivität und merkt sich nur den Hash, damit der Abgleich sie **für diese Person** nicht erneut holt.
- **Trennen:** Löscht den verschlüsselten Zugang sofort. Bereits übernommene Aktivitäten bleiben, bis die Person sie entfernt. Sie haben dann keine abgleichende Besitzerin mehr („verwaist“). Eine andere Person mit bestehender Verbindung im selben Bereich (Mail oder Kalender) übernimmt sie nur, wenn das beim Abgleich gesehene Element zu den gespeicherten Angaben passt (Mail: Absender, Zeit, Betreff, zugeordnete Personen; Termin: Beginn, Ende, zugeordnete Personen) und ihre eigene Adresse zu den gespeicherten Beteiligten gehört; dafür liegen je Aktivität nur Prüfwerte (SHA-256 aus Aktivitäts-ID und Adresse) vor, keine Adressen. Die Nachrichten- oder Termin-ID allein genügt nie, weil Absender und Organisator sie selbst bestimmen. Bei der Übernahme bleibt die Anbieter-ID leer (keine Anhänge, nie die Nachricht eines anderen Postfachs gebunden), im selben Lauf wird nichts geändert oder gelöscht, das Änderungsprotokoll hält `uebernehmen` ohne Inhalt fest. Spätere Läufe der neuen Besitzerin dürfen den Termin aktualisieren; eine Absage löscht einen übernommenen Termin nie, sie wird als „abgesagt (gemeldet)“ vermerkt. Hat die Person das Element selbst entfernt, übernimmt sie es nicht; solange die Besitzerin im Bereich verbunden ist, überschreibt nie eine andere Person etwas. Zeilen aus der Zeit davor haben keine Prüfwerte und werden deshalb nicht übernommen. Die Dublettenprüfung nutzt für neue Zeilen einen Hash je Anbieter (beim Kalender zusätzlich je Organisator); früher gespeicherte Zeilen werden über den alten Hash weiter erkannt. Eine Mail, die niemand mehr in seinem Postfach neu sieht, bleibt unverändert am Kontakt. Beim Anbieter bleibt die Berechtigung bestehen, bis die Person sie dort widerruft (Microsoft: „Meine Apps“, Google: „Sicherheit, Drittanbieter-Zugriff“).
- **Textauszug:** Schalter je Postfach, wirkt auf künftige Abgleiche.
- **Anhänge:** Nur auf ausdrücklichen Klick der Person, deren Postfach die Mail angelegt hat: Die Liste (Name, Größe, Typ) kommt live vom Anbieter, übernommen wird ein einzelner Anhang als **vertrauliches** Dokument (Typ- und Größenprüfung wie beim Hochladen, Rolle Bearbeiter am Ziel, verknüpft mit dem Deal der Mail, sonst mit der Organisation). Nur für Microsoft 365 und Google. Ein abgelaufenes Zugriffstoken erneuert allein der Worker; die Anfrage fordert dann einen Abgleich an und die Person versucht es erneut.

### Aufbewahrung

Übernommene Aktivitäten bleiben, bis die Person sie entfernt oder der Datensatz, an dem sie hängen, gelöscht wird; eine automatische Löschfrist gibt es nicht. Die Verbindung bleibt, bis die Person trennt. OAuth-Vorgänge laufen nach 10 Minuten ab und werden beim nächsten Start aufgeräumt. Sicherungen enthalten die verschlüsselten Zugänge (der Schlüssel gehört nicht in die Sicherung).

### Einordnung für Datenschutz (Hinweis, keine Rechtsberatung)

Die Anbindung verarbeitet personenbezogene Daten der Beschäftigten (ihr Postfach und Kalender) und der Kontakte (Mailadressen, Betreff, Termine). Der **Verantwortliche** legt die Rechtsgrundlage fest (z. B. Einwilligung der Beschäftigten, betriebliche Regelung) und informiert die Betroffenen; die Zustimmung in der Oberfläche ist eine technische Sperre und ersetzt das nicht. In der Auftragsverarbeitung gehört der **Anbieter des Postfachs** (Microsoft, Google, eigener Mailserver) auf die Liste der Unterauftragsverarbeiter bzw. in die Bewertung des Verantwortlichen, sobald die Anbindung eingeschaltet ist ([Unterauftragsverarbeiter.md](Unterauftragsverarbeiter.md)); das gilt auch für den Anbieter des SMTP-Versands. Die App-Registrierung (OAuth-Anwendung) gehört der Installation und läuft im Verzeichnis des Kunden.

## Zugangsdaten und Schlüssel

OAuth-Tokens und IMAP-Zugänge stehen nur **verschlüsselt** in der Datenbank: AES-256-GCM, zufälliger 96-Bit-IV je Verschlüsselung, Schlüsselkennung im Wert, und die zusätzlich authentifizierten Daten (AAD) binden den Wert an Tabelle und Zeile (ein kopierter Wert lässt sich nicht entschlüsseln). Derselbe Schutz gilt für den Inhalt von Mails im Ausgangskorb und den PKCE-Verifier laufender OAuth-Vorgänge.

- `GEHEIMNIS_SCHLUESSEL`: 32 Byte, Base64 (`openssl rand -base64 32`) oder 64 Hexzeichen. **Ohne ihn** bleiben Postfachanbindung und Mails mit Link aus (`409 secret_missing`, `409 mail_not_configured`). Nur außerhalb von Produktion und Echtbestand gilt ohne Angabe ein öffentlicher Entwicklungsschlüssel (Demo und Tests); bei `NODE_ENV=production` oder `CARRAWAY_UMGEBUNG=echt` nie.
- **Schlüsselwechsel** (Rotation):
  1. Neuen Schlüssel erzeugen. Den bisherigen in `GEHEIMNIS_SCHLUESSEL_ALT` eintragen (mehrere kommagetrennt), den neuen als `GEHEIMNIS_SCHLUESSEL`; API und Worker neu starten. Ab jetzt wird mit dem neuen Schlüssel verschlüsselt, alte Werte bleiben lesbar.
  2. `pnpm --filter @carraway/api geheimnis:rotieren` (im Compose-Stack: `docker compose exec worker node dist/geheimnis-rotieren.js`) verschlüsselt alle Werte neu. Die Ausgabe nennt neu verschlüsselte, schon aktuelle und unlesbare Werte (Schlüssel fehlt); bei „unlesbar“ endet das Skript mit Fehler und lässt diese Werte unberührt.
  3. Wenn nichts unlesbar ist, den alten Schlüssel aus `GEHEIMNIS_SCHLUESSEL_ALT` entfernen und neu starten.
- Ein verlorener Schlüssel macht gespeicherte Zugänge unbrauchbar; die Personen verbinden neu. Mails im Korb mit nicht mehr lesbarem Inhalt enden als `GEHEIMNIS_FEHLER`.

## Anbieter einrichten

Die App-Registrierungen gehören der Installation. Die Rückruf-Adresse (Redirect-URI) ist `<APP_ORIGIN>/api/v1/mailbox/callback` (ohne Pfad zur Oberfläche, mit `https://`).

| | Microsoft 365 | Google |
|---|---|---|
| Umgebung | `POSTFACH_MICROSOFT_CLIENT_ID`, `POSTFACH_MICROSOFT_CLIENT_SECRET`, `POSTFACH_MICROSOFT_TENANT_ID` (Vorgabe `common`; für eine Firma die Verzeichnis-ID) | `POSTFACH_GOOGLE_CLIENT_ID`, `POSTFACH_GOOGLE_CLIENT_SECRET` |
| Ablauf | Autorisierungscode mit PKCE (S256), `state` und `nonce` je Vorgang | dasselbe, mit `access_type=offline` und `prompt=consent` |
| Berechtigungen Postfach | `Mail.Read` | `https://www.googleapis.com/auth/gmail.readonly` |
| Berechtigungen Kalender | `Calendars.Read` | `https://www.googleapis.com/auth/calendar.readonly` |
| Zusätzlich | `openid`, `email` (ID-Token für die eigene Adresse und die `nonce`-Prüfung), `offline_access` (Erneuern ohne erneute Anmeldung) | `openid`, `email` |

Nie angefordert werden Schreib-, Sende- oder Löschrechte. Das ID-Token kommt direkt vom Token-Endpunkt über TLS; seine Signatur wird deshalb nicht geprüft (zulässig nach OpenID Connect Core 3.1.3.7), Zielgruppe, Ablauf und `nonce` schon. Der `state` ist nur als Hash gespeichert, einmalig, 10 Minuten gültig und an die angemeldete Person gebunden; ein fremder, abgelaufener oder wiederholter `state` verbindet nichts. Der Code-Verifier steht verschlüsselt in der Datenbank und in keiner Adresse; Tokens stehen nie in Adressen oder Antworten.

Das Erneuern der Zugriffstokens macht allein der Worker, je Verbindung mit Sperre (rotierende Refresh-Tokens vertragen keinen Doppelaufruf) und mit sofortigem verschlüsselten Speichern des neuen Zugangs. Wird der Zugang beim Anbieter widerrufen oder ist das Refresh-Token ungültig, steht die Verbindung auf „Bitte neu verbinden“ und wird nicht mehr abgeholt.

### IMAP (eigene Mailserver)

Nur lesend (Ordner schreibgeschützt geöffnet), mit imapflow. Die Person gibt Server, Port, Verschlüsselung (`tls`, `starttls`, `keine`), Benutzer, Passwort, Adresse und bis zu drei Ordner an; vor dem Speichern gibt es eine Probeverbindung. Der Zugang steht verschlüsselt in der Datenbank. Der Abgleich merkt sich je Ordner `UIDVALIDITY` und die letzte UID. Kalender gibt es über IMAP nicht.

**Schutz vor Abfragen interner Dienste (SSRF):** Der Server verbindet sich zu einer Adresse, die die Person eingibt. Ohne `POSTFACH_PRIVATE_ZIELE=1` sind alle Sonderbereiche verboten (`400 mailbox_target_forbidden`): lokal, privat, Link-Local (u. a. Metadaten-Dienste von Cloud-Anbietern), gemeinsam genutzt (`100.64.0.0/10`), `0.0.0.0/8`, `198.18.0.0/15`, Dokumentation, Multicast und reservierte Bereiche, bei IPv6 zusätzlich eingebettete IPv4-Adressen (`::ffff:`, auch in Hexform, `::/96`, NAT64 `64:ff9b::/96`); 6to4 (`2002::/16`) und Teredo (`2001::/32`) sind ganz gesperrt. Der Name wird **genau einmal** aufgelöst, alle Adressen werden geprüft, und verbunden wird mit genau der geprüften Adresse (der Name bleibt Servername der TLS-Prüfung): Eine zweite, andere DNS-Antwort (DNS-Rebinding) hat keine Wirkung. Die festen Adressen von Microsoft und Google brauchen keine Prüfung. Wer IMAP einschaltet, begrenzt den Ausgang des Containers trotzdem zusätzlich auf die nötigen Ziele. `POSTFACH_PRIVATE_ZIELE=1` hebt die Sperre für Selbsthoster auf (Vorgabe aus), `POSTFACH_IMAP=0` schaltet IMAP ab.

### Abgleich

Der Worker gleicht alle `POSTFACH_INTERVALL_MINUTEN` (Vorgabe 15) je Verbindung ab: erster Lauf die letzten 30 Tage (höchstens 500 Nachrichten je Lauf, bei Google die neuesten), danach seit dem letzten Stand mit einer Stunde Überlappung; Termine in einem Fenster von 30 Tagen zurück bis 90 Tage voraus. Dubletten fängt der Hash der Nachrichten-ID (die Message-ID-Kopfzeile, sonst die ID beim Anbieter) bzw. der Termin-ID (iCalUID, bei Serien je Instanz) ab, auch wenn mehrere Personen dieselbe Nachricht haben (die erste behält sie). Geänderte Termine aktualisieren dieselbe Aktivität, **aber nur über die Verbindung der Person, die sie angelegt hat**: Dieselbe Termin-ID kann bei mehreren Personen vorkommen (Einladung), doch Titel, Zeit und Absage aus dem Konto einer anderen Person ändern oder löschen die Aktivität nicht (der Abgleich dieser Person überspringt sie); vom Konto der Besitzerin oder des Besitzers abgesagte Termine werden entfernt. Fehler setzen nur einen Code (`ZUGANG_UNGUELTIG`, `ANBIETER_NICHT_ERREICHBAR` …), nie Antworttexte; nach einem Fehler wartet der Abgleich eine Stunde.

## Kalenderabonnement (ICS)

Jede Person kann einen Link für ihre Kalender-App erzeugen, der ihre **offenen Wiedervorlagen** als ganztägige Termine liefert (`GET /api/v1/calendar/<Token>.ics`). Das Token hat 256 Bit Zufall, in der Datenbank steht nur der Hash, es wird genau einmal angezeigt und lässt sich widerrufen oder durch ein neues ersetzen (der alte ist sofort ungültig). Der Abruf braucht kein Konto und nimmt keine Cookies an; bei jedem Abruf werden geprüft: Token nicht widerrufen, Person aktiv und kein technischer oder Investor-Benutzer, und es erscheinen nur Wiedervorlagen, für die die Person zuständig ist und deren Deal sie nach den **aktuellen** Rollen sehen darf. Begrenzung je IP und je Token wie bei den Links der Kennzahlen-Abfrage (`429 too_many_requests`), Antworten mit `Cache-Control: no-store`, `Referrer-Policy: no-referrer` und `X-Robots-Tag: noindex`. **Wer den Link kennt, sieht die Titel der Wiedervorlagen** (und den Namen von Organisation und Deal in der Beschreibung); die Oberfläche warnt davor, ihn weiterzugeben.

## Rechte im Überblick

| Funktion | Wer |
|---|---|
| Einstellungen, Postfach verbinden und trennen, Kalenderlink, Mail-Opt-in | jeder Mensch mit einer Rolle an irgendeinem Fonds, nur für das eigene Konto (Investor-Benutzer nie, API-Schlüssel nie) |
| Mail oder Termin aus dem Verlauf entfernen | wer das Postfach bzw. den Kalender verbunden hat (und die Aktivität sehen darf) |
| Anhänge einer Mail anzeigen | dieselbe Person; übernehmen zusätzlich mit Rolle Bearbeiter am Ziel |
| Verlauf und „Nächste Termine“ sehen | nach den CRM-Regeln (Rolle am Fonds des Deals, bzw. irgendeine Rolle bei Organisationen und Personen) |
| Mail-Link zu Kennzahlen-Anfragen senden | Bearbeiter am Fonds der Beteiligung |
| Mitteilungen im Portal per Mail ankündigen | Freigeber (mit der Freigabe der Mitteilungen) |
| SMTP-Status, Testmail, Ausgangskorb | globale Verwalter (Menschen) |

## Vor dem Einsatz bei einem Anbieter prüfen

Alles Folgende ist nach der Dokumentation der Anbieter gebaut und **nicht** gegen die echten Dienste gelaufen:

- App-Registrierung: Rückruf-Adresse, Kontotypen (Microsoft: eine Organisation oder „common“), veröffentlichter Zustand der Google-Anwendung. Für `gmail.readonly` und `calendar.readonly` verlangt Google für Anwendungen mit mehr als wenigen Nutzern ein Prüfverfahren (eingeschränkte Berechtigungen); bei Microsoft kann ein Administrator der Firma die Zustimmung erteilen müssen (Admin-Consent).
- Zustimmungsablauf mit `prompt` und `offline_access`/`access_type=offline`: Wird tatsächlich ein Refresh-Token geliefert? (Ohne gilt die Verbindung als gescheitert, `REFRESH_TOKEN_FEHLT`.) Lebensdauer von Refresh-Tokens (Microsoft: bei Inaktivität, Google: im Testmodus sieben Tage).
- Form der Antworten: Microsoft Graph (`mailFolders/inbox|sentitems/messages`, `calendarView`, `$filter`/`$orderby`-Kombinationen, `Prefer`-Köpfe, Anhänge `$value`), Gmail (`messages.list` mit `q=after:`, `format=metadata`, Anhänge `attachments.get`), Google Kalender (`events.list` mit `singleEvents`, `showDeleted`). Rate-Limits und Drosselung (`429`), Verhalten bei sehr großen Postfächern.
- Zeitzonen und Serientermine (iCalUID, `originalStart`/`originalStartTime`), Ganztagstermine, Termine mit mehreren Kalendern.
- IMAP: Verhalten gegen reale Server (STARTTLS, Ordnernamen für „Gesendet“, `UIDVALIDITY`-Wechsel, Zeichensätze), Zertifikatsprüfung bei selbst signierten Zertifikaten (die Prüfung ist an; es gibt keine Ausnahme).
- SMTP: Zustellbarkeit (SPF, DKIM, DMARC für die Absenderdomain), Verhalten des Relays bei Fehlern.

Die Tests der Plattform decken Fake-Server und Fake-Antworten ab (PKCE, `state`, `nonce`, Erneuern, Verschlüsselung, Zuordnung, Dubletten, Entfernen, Anhänge, Kalenderlink, Ausgangskorb); einen Aufruf an einen echten Host machen sie nie.
