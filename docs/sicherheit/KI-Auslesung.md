# KI-Auslesung von Verträgen

Stand: Etappe 13. Die KI-Auslesung ist ein Zusatz, der **standardmäßig aus** ist. Sie liest aus dem Text eines hochgeladenen PDF Vorschläge
für Werte (Datum, Pre-Money, Zinssatz, Bewertung …). Eine Person prüft jeden Vorschlag; erst ihre Bestätigung schreibt Daten, mit allen
Prüfungen der Plattform.

## Anbieter und Region

Die Einstellung gilt je Installation (ein Stack je Kunde, Compose-Umgebung). Sie kommt nur aus Umgebungsvariablen, nie aus der Datenbank oder
der Oberfläche.

| `KI_ANBIETER` | Anbieter | Region | Pflichtvariablen |
|---|---|---|---|
| `aus` (Standard) | keiner | – | – |
| `bedrock_eu` | Amazon Bedrock (Converse-API) | EU-Region, Vorgabe `eu-central-1` (`KI_REGION`; erlaubt: `eu-central-1`, `eu-central-2`, `eu-west-1`, `eu-west-2`, `eu-west-3`, `eu-north-1`, `eu-south-1`, `eu-south-2`) | `KI_MODELL`; `KI_BEDROCK_API_KEY` oder `AWS_ACCESS_KEY_ID` und `AWS_SECRET_ACCESS_KEY` (optional `AWS_SESSION_TOKEN`) |
| `mistral_eu` | Mistral AI (`api.mistral.ai`, Frankreich) | EU (Adresse fest, `KI_ENDPOINT` nur auf diesen Host änderbar, nur `https`) | `KI_MODELL`, `KI_MISTRAL_API_KEY` |
| `lokal` | regelbasierter Anbieter im eigenen Prozess (Tests und Demo) | verlässt den Rechner nicht | – |

Ungültige Werte (Region außerhalb der EU, fremde Adresse, fehlendes Modell oder fehlende Zugangsdaten) verhindern den Start von API und
Worker. Weitere Einstellung: `KI_TIMEOUT_MS` (Vorgabe 60000). `GET /api/v1/ki/status` zeigt, ob die KI an ist, Anbieter, Region und Modell,
nie Zugangsdaten. Ist die KI aus, antworten alle anderen KI-Routen mit `409 KI_AUS`, und die Oberfläche blendet die KI-Aktionen aus.

Die Anbieter-Clients sind dünne HTTP-Clients ohne SDK. **Sie sind nicht gegen die echten Dienste geprüft**; Anfrage- und Antwortform,
Anmeldung (Bedrock: API-Schlüssel als Bearer oder SigV4) und Modellkennungen müssen vor dem Einsatz in der Zielumgebung getestet werden.

## Was an den Anbieter geht

- Nur der **extrahierte Text der gewählten Seiten** (höchstens 40 Seiten und 150.000 Zeichen je Auslesung), nie die Datei.
- Dazu das Schema der gesuchten Felder und eine feste Anweisung. Der Dokumenttext steht in der Anfrage als Daten, nicht als Anweisung
  (Schutz vor eingebetteten Anweisungen); das Ergebnis sind Vorschläge, die eine Person prüft.
- **Vertrauliche Dokumente** (Markierung am Dokument) gehen nur mit ausdrücklicher Freigabe an die KI (`vertraulichErlaubt`), und nur ein
  Verwalter an jedem Ziel des Dokuments darf sie geben. Der Worker prüft die Freigabe vor dem Senden erneut.
- Es werden **keine Anfragen gespeichert**: nicht in der Datenbank, nicht in der Auftragswarteschlange (der Auftrag trägt nur die ID der
  Auslesung), nicht im Protokoll und nicht in Fehlermeldungen (Fehler nennen nur Art und HTTP-Status). Gespeichert werden die Vorschläge
  mit Seite und Zitat (sie sind Teil des Prüfwegs) und die Seitennummern, die gesendet wurden.
- Im Änderungsprotokoll steht je Anfrage: Anbieter, Region, Modell, Zeitpunkt und Zahl der Seiten (Aktion `ki_anfrage`), kein Inhalt.

## Prüfung der Vorschläge

Jeder Vorschlag trägt Seite, Zitat und Sicherheit. Die API prüft, ob das Zitat **wörtlich im gesendeten Text** der Seite steht (sonst
„Zitat nicht gefunden“, niedrige Sicherheit, keine Fundstelle), und normalisiert Werte selbst. Die Bestätigung schreibt in einer Transaktion
über die bestehenden Schreibwege (Finanzierungsrunde mit Positionen, Konditionen, Bewertungsentwurf) und legt je belegtem Wert eine Fundstelle an
(Dokument, Seite, Zitat). Bewertungen entstehen als Entwurf und brauchen weiterhin die Freigabe durch eine andere Person.

## Angaben für die AVV und den IT-Fragebogen

- Anbieter, Region und Modell nennt der Betreiber je Kunde in der Liste der Unterauftragsverarbeiter ([Unterauftragsverarbeiter.md](Unterauftragsverarbeiter.md)),
  wenn die KI eingeschaltet ist; bei `aus` und `lokal` ist kein Anbieter beteiligt.
- Ob der Anbieter Eingaben zum Training verwendet, gilt **nach den Bedingungen des Anbieters und ist in der AVV zu bestätigen**; die Plattform
  macht dazu keine Zusage.
- Offen: Aufbewahrung beim Anbieter (Protokollierung von Anfragen, Missbrauchserkennung) nach den Bedingungen des jeweiligen Vertrags.

## Dokumente: Aufbewahrung und Löschen

Dateien liegen unverändert in der Dateiablage (`STORAGE_DIR`, Schlüssel `dokumente/<ab>/<sha256>`, einmal geschrieben). Löschen ist weich: Das
Dokument bekommt den Status `geloescht` und verschwindet für alle außer Verwaltern; die Datei bleibt `DOKUMENT_AUFBEWAHRUNG_TAGE` Tage (Standard 30)
in der Ablage. Danach entfernt der Worker sie, aber nur, wenn keine andere Dokumentzeile mit denselben Bytes (gleicher SHA-256, eine Datei) aktiv oder noch
nicht abgelaufen ist und keine Fundstelle, kein Registerauszug und kein Beleg auf sie zeigt. Die Metadaten bleiben mit dem Status `endgueltig_geloescht`,
der Text der Seiten wird mit der Datei entfernt, jede Löschung steht im Änderungsprotokoll, die Verwaltung sieht die anstehenden Löschungen
(`GET /dokumente/aufbewahrung`).  Danach antwortet der Download mit 410. Ersetzte Versionen bleiben les- und
herunterladbar, weil Fundstellen auf sie zeigen. Die Sicherung enthält die ganze Dateiablage. Textauszug: aus PDF mit Textebene, aus DOCX
(Absätze und Tabellen; eine Seite je etwa 3000 Zeichen oder je Abschnitt) und aus XLSX (eine Seite je Blatt mit den Zellwerten). Office-Dateien erhalten beim Upload den Stand `ausstehend`; den Text zieht der Worker aus (nie die Anfrage), mit Zeitlimit je Dokument. Sie laufen
zuerst durch die Schutzprüfung des Archivs (jeder Eintrag wird mit harter Grenze entpackt), das Lesen einzelner Einträge ist auf wenige MB begrenzt, das XML wird in einem Durchlauf ohne Zurückspringen zerlegt, XML mit
Dokumenttypdeklaration oder Entitäten wird nicht gelesen (Stand `fehler`, die Datei bleibt gespeichert). Ein Scan ohne Textebene erhält den Stand
`kein_text`, solange die Texterkennung (siehe unten) aus ist, und lässt sich nicht auslesen.

## Texterkennung (OCR), lokal und optional

Mit `OCR=lokal` (Standard `aus`) erkennt der Worker den Text von Scans (PDF ohne Textebene, Stand `kein_text`) und von Bildern (PNG, JPEG). Alles läuft im
eigenen Prozess: `tesseract.js` (Version fest) mit den Sprachdaten Deutsch und Englisch aus den Paketen `@tesseract.js-data/deu` und `/eng`, die im Lockfile mit
Prüfsumme festgeschrieben sind und im Image liegen; PDF-Seiten rendert PDF.js mit `@napi-rs/canvas`. Es gibt keinen Abruf zur Laufzeit und keinen Zwischenspeicher.
Das Dokument bekommt beim Upload den Stand `ocr_ausstehend` (bei vorhandenen Dokumenten fordert `POST /dokumente/:id/texterkennung` die Erkennung an); der Worker
arbeitet ein Dokument nach dem anderen in einem eigenen Thread ab, mit Seitengrenze (`OCR_MAX_SEITEN`, Standard 20, mehr Seiten ergeben `fehler`) und hartem Zeitlimit
(`OCR_ZEITLIMIT_SEKUNDEN`, Standard 180; der Thread wird beendet). Ein Zeitlimit oder Fehler beendet sofort mit `fehler`; nach einem Absturz des Workers gibt es höchstens
drei Versuche. Der Text je Seite steht mit `quelle = ocr` und der mittleren Sicherheit (0 bis 100) in `dokument_seite`, Suche und KI-Auslesung nutzen ihn. Zitate und
Fundstellen aus erkanntem Text sind gekennzeichnet (`quelle` am Vorschlag, `zitat_quelle` an der Fundstelle), weil Erkennungsfehler möglich sind. Das Änderungsprotokoll hält
fest, dass erkannt wurde (Seitenzahl, Sicherheit, Dauer), nie den Text. Für gelöschte Dokumente wird kein Text geschrieben.

Schutz vor Speicherverbrauch: Die Größe steht im Dokument selbst (MediaBox einer PDF-Seite, Maße im Kopf eines PNG oder JPEG) und wird vor dem Rendern oder Erkennen
gelesen. Mehr als `OCR_MAX_MEGAPIXEL` (Standard 40) Pixel je Bild ergeben `fehler`; PDF-Seiten werden bei Bedarf kleiner gerendert und ab dem Verhältnis von mehr als
zwei zu eins zur Vorgabe abgelehnt. Die Erkennung läuft in einem Thread mit Speichergrenze (`resourceLimits`); für Zeichenflächen und WebAssembly gilt zusätzlich die Grenze des
Containers (`mem_limit` des Workers im Compose-Stack, `WORKER_SPEICHER`, dazu `--max-old-space-size`); außerhalb von Docker ein cgroup-Limit oder `ulimit -v`.

## Registerfelder aus dem Auszug

Für einen Registerauszug, der mit dem Unternehmen verknüpft ist, schlägt die Auslesung (Art `registerauszug`) Firma, Sitz, Rechtsform, Registergericht, Registernummer,
Geschäftsführung, Stammkapital und den Stand des Auszugs vor. Wie bei den anderen Arten prüft eine Person die Vorschläge; erst die Bestätigung legt einen `registereintrag` mit
`quelle = dokument` und der Verknüpfung zum Auszug an. Zu jedem Feld und jeder Person, für die ein belegter Vorschlag genannt wird, entsteht eine Fundstelle (`wert_quelle`,
Dokument, Seite, Zitat). Es gelten dieselben Regeln: Bearbeiter an jedem Ziel des Dokuments, die Organisation muss ein Ziel des Dokuments sein, bei einem Fehler entsteht nichts.
