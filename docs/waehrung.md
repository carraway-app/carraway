# Währungen, Zusatzfelder und Bewertungsszenarien (Etappe 21, Nacharbeiten 9)

Dieses Dokument beschreibt, wie Carraway Beträge in mehreren Währungen führt, wie eigene Felder an allen Objekten funktionieren und wie Bewertungsszenarien rechnen. Alle Beispiele sind erfunden.

## 1. Drei Währungen, ausdrücklich getrennt

| Begriff | Bedeutung | Wo steht sie |
| --- | --- | --- |
| Fondswährung | Währung der Buchführung des Fonds. Alle gebuchten Beträge (`vorgang.betrag`, `bewertung.wert`, Fondsbewegungen) und alle Kennzahlen (NAV, TVPI, DPI, IRR) beruhen darauf. | `fonds.waehrung` |
| Lokale Währung | Währung der Beteiligung (z. B. Anteile in USD). Leer heißt Fondswährung. | `beteiligung.waehrung` |
| Vergleichswährung | Eine Sicht auf Zahlen in einer dritten Währung. Sie wird nie gespeichert, sondern je Ansicht gewählt (`?vergleich=GBP`). | nur in der Adresse |

Die Beträge der Kennzahlen ändern sich durch die Währungssicht nicht. Lokale und Vergleichsbeträge sind eine Umrechnung oder ein zusätzlich gebuchter Betrag.

### Kurstabelle

`wechselkurs`: Tag, Basis, Quote, Kurs (`1 Basis = Kurs Quote`, höchstens acht Nachkommastellen, als Dezimalzeichenkette), Quelle (`manuell` oder `import`), Dateiname, Erfasser und Zeitpunkt.

- **Nur anhängend.** Zeilen sind unveränderlich (Trigger). Eine Korrektur ist ein neuer Eintrag für denselben Tag und dasselbe Paar mit Verweis auf den bisher gültigen (`korrigiert_kurs_id`) und einem Grund.
- **Gültig** ist je Tag und Paar der jüngste Eintrag bis zum Wissensstand (`?stand=`). Frühere Stände rechnen mit den damals erfassten Kursen.
- Erfassen, korrigieren und importieren dürfen nur globale Verwalter (Verwaltung, Reiter „Wechselkurse“). Lesen darf jede Person mit einer Rolle.
- **Kein Abruf aus dem Netz.** Kurse kommen von Hand oder aus einer Datei, die jemand hochlädt.

### Kursimport (Datei)

`POST /api/v1/wechselkurse/import` mit `{ inhalt, dateiname, vorschau, waehrungen?, ab? }`. Standard ist die Vorschau (nichts wird geschrieben). Zwei Aufbauten werden erkannt, Trennzeichen Komma, Semikolon oder Tabulator:

1. **EZB-Aufbau (breit):** Kopfzeile `Date,USD,JPY,GBP,`, je Zeile ein Tag `JJJJ-MM-TT` und je Währung der Kurs je 1 EUR; `N/A` und leere Felder heißen „kein Kurs“; ein Komma am Zeilenende ist erlaubt. Basis ist immer EUR.
2. **Langer Aufbau:** Spalten `Datum`, `Basis`, `Quote`, `Kurs` (auch `Date`, `Base`, `Currency`, `Rate`). Datum als `JJJJ-MM-TT` oder `TT.MM.JJJJ`, Kurs mit Punkt oder (bei Semikolon) Komma.

Übernommen werden nur Einträge, für die es noch keinen gültigen Kurs gibt. Ein gleicher Kurs zählt als unverändert (der Import ist wiederholbar), ein abweichender wird gemeldet und nicht überschrieben (Änderungen sind Korrekturen von Hand mit Grund). Zeilen mit Fehlern stehen mit Zeilennummer in der Antwort. Höchstens 100.000 neue Kurse je Import; mit `waehrungen` und `ab` lässt sich einschränken.

### Wahl des Kurses

Für eine Umrechnung von `von` nach `nach` an einem Tag:

1. Gleiche Währung: Faktor 1.
2. Direkter oder umgekehrter Eintrag: der jüngste Eintrag mit Datum ≤ Tag (bei Gleichstand direkt vor invers). Der Eintrag gilt in beide Richtungen; der Kehrwert wird nicht gerundet (Zähler und Nenner bleiben getrennt).
3. Sonst über EUR (zwei Einträge); das ältere der beiden Daten gilt als Kursdatum.
4. Sonst eine **Lücke**.

Ein Kurs ist **höchstens sieben Tage alt**, sonst fehlt er (`veraltet`, mit dem Datum des letzten Kurses). Es wird nie ein Kurs geschätzt oder ein alter Wert fortgeschrieben.

### Welcher Kurs wofür

| Posten | Kurs | Begründung |
| --- | --- | --- |
| Auszahlung, Rückfluss, Tilgung, Zusage, Wertberichtigung | Kurs der Valuta | Kosten sind der Betrag zum Tag der Zahlung |
| Bewertung (Zeitwert) | Kurs des Bewertungsstichtags | Der Zeitwert ist der Wert an diesem Tag |
| Offene Kaufpreisforderungen | Kurs des Stichtags der Ansicht | Sie zählen zum Wertansatz zum Stichtag |

### Lokale Beträge erfassen

Hat eine Beteiligung eine abweichende lokale Währung, kann eine Zahlung oder Bewertung auch lokal erfasst werden (`betragLokal` bzw. `wertLokal`):

- Nur lokal: Der Fondsbetrag ist die Umrechnung zum Kurs der Tabelle am Tag (fehlt der Kurs: `409 KURS_FEHLT`).
- Beide Beträge (etwa aus dem Kontoauszug): Der gebuchte Fondsbetrag gilt, der Kurs wird daraus abgeleitet.
- Der Kurs wird an der Zeile **festgehalten** (`kurs`, `kurs_id`). Eine spätere Kurskorrektur ändert keine gebuchten Beträge. Ein Storno übernimmt den lokalen Betrag (negiert) und den Kurs.
- Vorzeichen: Nur die Wertberichtigung darf negativ sein, bei allen anderen Arten muss auch der lokale Betrag größer als null sein.
- Ohne abweichende lokale Währung sind lokale Beträge nicht zulässig (`409 WAEHRUNG_GLEICH`): Es gäbe zwei Wahrheiten für denselben Betrag. Die lokale Währung lässt sich nicht mehr ändern, sobald lokale Beträge erfasst sind.
- Ohne gebuchten lokalen Betrag rechnet die Lokalsicht den Fondsbetrag zum Kurs des Tages zurück (nur solange es einen Kurs gibt).

### Währungssicht und Umschalter

`GET /beteiligungen/:id/waehrungssicht` und `GET /fonds/:id/waehrungssicht` (`stichtag`, `stand`, `vergleich`) liefern je Betrag Fonds, lokal und Vergleich, die verwendeten Kurse mit Datum und die Lücken. Die Oberfläche zeigt die Leiste **Lokal | Fonds | Vergleich** an Beteiligung und Fonds-Portfolio, die Sicht steht in der Adresse.

- Beträge tragen immer das Zeichen ihrer eigenen Währung. Kennzahlen in lokaler oder Vergleichswährung heißen z. B. „Investiert (USD)“.
- **Lücken:** Fehlt ein Kurs, steht „Kurs fehlt“ statt einer Zahl, und die Leiste nennt Paar, Tag und Grund. Eine Summe mit einer Lücke ist selbst eine Lücke.
- Multiple, IRR, TVPI, DPI und Abrufe bleiben in der Fondswährung (die Leiste sagt das).
- Fondssumme in lokalen Währungen gibt es nicht (verschiedene Einheiten); die Fondssumme gibt es in Fonds- und Vergleichswährung.
- **Währungseffekt:** Im Reiter Bewertung > Währung steht die Änderung des Fondswerts gegenüber der vorigen Bewertung, zerlegt in Wertänderung (lokale Änderung zum neuen Kurs) und Währungseffekt (alter lokaler Wert mal Kursänderung). Der Währungseffekt ist der Rest zur gerundeten Gesamtänderung, damit beide Teile genau die Gesamtänderung ergeben.

### Rundung

Beträge werden einmal gerundet, am Ende der Rechnung: auf Cent, kaufmännisch (halb weg von null). Kurse und Zwischenschritte werden nicht gerundet. Der Rechenkern (`packages/rechenkern/src/waehrung.ts`) hat eine unabhängige Python-Referenz mit Brüchen (`referenz/referenz_waehrung.py`); die Tests vergleichen beide.

### Währungssicht in Berichten

Fondsbericht (PDF, Excel), LP-Bericht, Portfolioliste und Exitliste (PDF, Excel) haben beim Anlegen eines Berichts (`POST /berichte`: `waehrungssicht`, `vergleichswaehrung`) und im Direkt-Download (`GET /fonds/:id/berichte/fondsbericht` und `/portfolioliste`, dieselben Parameter) eine Währungssicht:

| Sicht | Bedeutung |
| --- | --- |
| `fonds` (Standard) | Fondswährung, wie bisher |
| `lokal` | je Beteiligung in ihrer lokalen Währung; eine Summe über verschiedene Währungen entfällt |
| `vergleich` | alle Zeilen und die Summe in der gewählten Währung (`vergleichswaehrung`, drei Großbuchstaben) |

- Die Sicht gilt für **Investiert, Rückflüsse (in der Exitliste Erlös) und Bewertung** (die letzte Bewertung, ohne offene Forderungen, wie die Fondsspalte). Zusage, Buchwert, Wertberichtigung, offene Zusage, alle Kennzahlen (NAV, TVPI, DPI, IRR) und die Multiples bleiben in der Fondswährung; die Kopfzeile der umgerechneten Spalte nennt die Währung („Investiert (GBP)“, „Investiert (lokal)“).
- **Rechnung und Kurse** sind die der Währungssicht der Oberfläche (`waehrung/sicht.ts`): Kosten zum Kurs der Valuta, ein gebuchter lokaler Betrag gilt vor jeder Umrechnung, die Bewertung zum Kurs ihres Stichtags, Kurse höchstens sieben Tage alt, Wissensstand (`stand`) beachtet.
- **Im Bericht stehen Kurs und Datum:** Unter der Tabelle (PDF) und im Blatt „Währungssicht“ (Excel) stehen Sicht, Regel, jeder verwendete Kurs mit Kursdatum und dem Tag des Postens und jede Lücke.
- **Lücke statt Zahl:** Fehlt ein Kurs, steht in der Zelle „Kurs fehlt“ (Excel: Text, keine leere Zelle), die Summe der Spalte ist selbst „Kurs fehlt“, das Blatt nennt Paar, Tag und Grund (kein Kurs, älter als sieben Tage). Es wird nie ein Kurs geschätzt. Eine Beteiligung ohne Bewertung zeigt „–“, das ist keine Lücke.
- Die Sicht wird mit dem Bericht festgehalten (`bericht.parameter.waehrung`), wie die Vorlage; die Freigabe erzeugt dieselbe Sicht zum festgehaltenen Wissensstand.
- Nur diese vier Arten haben eine Sicht (`400 sicht_nicht_moeglich` sonst). Quartalsbericht, Gremienvorlage, PAI-Erklärung und Szenariobericht bleiben in der Fondswährung; die Gründe: Die Gremienvorlage und die PAI-Erklärung haben keine Beträge je Beteiligung in lokaler Währung, der Quartalsbericht betrifft eine einzelne Beteiligung (die Oberfläche der Beteiligung hat dort die Währungssicht), der Szenariobericht rechnet in der Fondswährung.

### Grenzen

- Snapshots und Kennzahlen der Berichte bleiben in Fondswährung; die Währungssicht der Berichte betrifft nur die oben genannten Betragsspalten der Listen.
- Snapshots der Fondskennzahlen bleiben in Fondswährung. Es werden keine umgerechneten Werte gespeichert.
- Die Zinsrechnung, die Buchhaltungsexporte und das Meldewesen rechnen weiter in Fondswährung.
- Demo-Daten: zwei Beteiligungen des ersten Fonds haben USD und GBP als lokale Währung, dazu gibt es erfundene Wochenkurse. Die Beträge in Fondswährung ändern sich dadurch nicht.

## 2. Zusatzfelder an allen Objekten

Die Felddefinitionen aus dem CRM (Typen Text, Langtext, Zahl, Betrag, Datum, Auswahl, Mehrfachauswahl, Kontrollkästchen, URL, E-Mail, Telefon, Person, Verknüpfung; Version je Änderung; Archivieren statt Löschen) gelten jetzt für **Fonds, Finanzierungsrunde, Instrument, Beteiligung und Vorgang**. Es gibt eine Engine und einen Satz Routen für Definitionen (`/crm/felder`, nur globale Verwalter).

| Objekt | Werte stehen in | Änderbar |
| --- | --- | --- |
| Fonds | `fonds.felder` | ja |
| Finanzierungsrunde | `finanzierungsrunde.felder` | ja, auch an abgeschlossenen Runden (die Zahlen der Runde bleiben gesperrt) |
| Beteiligung | `beteiligung.felder` | ja |
| Instrument | `beteiligung.instrument_felder` | ja |
| Vorgang | `vorgang.felder` | nur beim Anlegen |

- **Instrument** hat keine eigene Tabelle (es ist eine Eigenschaft der Beteiligung, eindeutig je Fonds, Unternehmen und Instrument). Seine Felder sind eine eigene Definitionsmenge, gespeichert an der Beteiligung.
- **Vorgang:** Werte werden beim Anlegen gesetzt (auch über die einheitliche Erfassung). Der Vorgang ist unveränderlich; ein Storno trägt die Werte des Originals. Zum Ändern: stornieren und neu buchen. So bleibt gebuchtes unverändert und nichts wird still geändert.
- **Periodensperre:** Vorgänge unterliegen ihr wie bisher (Valuta). Runden: Liegt das Rundendatum in einer gesperrten Periode eines beteiligten Fonds, sind Wertänderungen gesperrt. Fonds, Beteiligung und Instrument sind beschreibende Stammdaten ohne Buchungsdatum und nicht periodengebunden; jede Änderung steht mit Vorher und Nachher im Änderungsprotokoll.
- **Wissensstand (`?stand=`):** Veränderbare Objekte lesen den Stand aus dem Änderungsprotokoll (Aktion `felder_setzen`): der Nachher-Stand der letzten Änderung bis dahin, davor der ursprüngliche Zustand. Ohne jede Änderung über die API gelten die aktuellen Werte (Altbestand, Beispieldaten). Vorgänge gelten ab ihrer Erfassung.
- **Schnittstelle:** `GET/PUT /fonds/:id/felder`, `/beteiligungen/:id/felder`, `/beteiligungen/:id/instrumentfelder`, `/finanzierungsrunden/:id/felder`, `GET /vorgaenge/:id/felder`, dazu `GET /zusatzfelder/:objekt/definitionen` und `GET /zusatzfelder/:objekt/schema` (JSON-Schema aus den aktiven Definitionen, dynamisch). Die OpenAPI beschreibt die Werte als `Zusatzfelder` (Schlüssel sind die IDs der Definitionen).
- **Export:** Der Vollexport enthält die Spalten `felder` und `instrument_felder` und die Definitionen.
- **Oberfläche:** Reiter „Felder“ an Beteiligung (mit Unterreiter Instrument) und Fonds, Felder einer Runde und eines Vorgangs im Seitenpanel, Eingabe beim Buchen eines Vorgangs, „Felder verwalten“ für globale Verwalter.
- **Spalten in Berichten (Nacharbeiten 9):** Die Vorlage der Arten Fondsbericht, LP-Bericht, Portfolioliste und Exitliste hat die Auswahl `zusatzfelder` (IDs von Felddefinitionen von Fonds, Runde, Instrument und Beteiligung, höchstens 8, mit Reihenfolge). Die Felder erscheinen als weitere Spalten nach den festen Spalten, in PDF und Excel, mit dem Wissensstand der Rechnung (`?stand=`, gleiche Regeln wie beim Lesen der Werte) und werden mit der Vorlage beim Anlegen des Berichts festgehalten. Auch der Direkt-Download nutzt die Vorlage des Fonds. Verwalter des Fonds wählen sie in der Oberfläche unter Berichte, Vorlagen („Eigene Felder als Spalten“).
  - Welcher Wert in der Zeile einer Beteiligung steht: Feld der **Beteiligung** und des **Instruments**: der Wert der Beteiligung; Feld der **Runde**: die letzte abgeschlossene Finanzierungsrunde des Unternehmens bis zum Stichtag (dieselbe Runde wie die Phase der Portfolioliste); Feld des **Fonds**: der Wert des Fonds (steht in jeder Zeile gleich). Vorgangsfelder sind keine Spalte (eine Zeile ist eine Beteiligung, Vorgänge sind einzelne Buchungen).
  - Sichtbarkeit: Ein Bericht sieht, was die Person sieht, die ihn für den Fonds erzeugt; die Felder haben keine eigene Sichtbarkeit (sie folgt dem Objekt, also den Rechten am Fonds). Verknüpfungs- und Personenfelder erscheinen mit dem Namen des Ziels; Verknüpfungen auf Deals werden im Bericht nie aufgelöst (er hat keine Sicht einer anfragenden Person) und bleiben leer. Archivierte Definitionen lassen sich nicht neu wählen, eine festgehaltene Vorlage zeigt sie weiter.
  - Darstellung: Betrag mit der Währung des Feldes, Zahl und Datum nach Sprache, Auswahl mit der Bezeichnung, Kontrollkästchen als ja/nein; ein fehlender Wert ist „–“ (Excel: leer). Excel schreibt Zahlen, Beträge und Datumswerte als Zahl und Datum.
  - Die **Kennzahlenabfragen** (Anfragen der Unternehmenskennzahlen an die Unternehmen) haben keine Spalten aus Zusatzfeldern: Sie sind Anfragen und keine Listen. Die Abfragen der Portfolioliste sind die Downloads (`/fonds/:id/berichte/portfolioliste`, `/fondsbericht`) und die Berichte; sie tragen die Felder der Vorlage.

## 3. Bewertungsszenarien

Im Bereich Szenarien, Reiter „Bewertungsszenarien“: je aktiver Beteiligung 2 bis 6 Fälle (Basis, Bär, Bulle oder eigene Kennungen) mit Wahrscheinlichkeit und Methode. Sie sind ein optionaler Abschnitt `bewertung` der Szenario-Annahmen; ohne ihn rechnet ein Szenario unverändert (Ergebnis und Prüfsumme gleich).

| Methode | Wert des Falls |
| --- | --- |
| Multiple auf Kennzahl | (Kennzahl × Multiple − Abzug, nicht unter null) × Anteil des Fonds |
| Letzte Runde | Preis je Anteil der letzten Runde × Anteile des Fonds × (1 − Abschlag); negativ = Aufschlag |
| Fester Wert | der Betrag |

- Beträge sind in **Fondswährung**. Die Kennzahl ist der zuletzt bestätigte Ist-Wert bis zum Basistag (Wissensstand beachtet). Der Anteil des Fonds kommt aus der Kapitaltabelle (Anteile des Fonds durch alle Anteile nach der letzten Runde) oder wird angegeben. Bei Darlehen ohne Anteile ist ein fester Wert oder ein angegebener Anteil nötig.
- **Kennzahl in Fremdwährung (Nacharbeiten 9):** Ist die Kennzahl ein Betrag (Typ „Betrag“) mit einem Währungscode als Einheit (z. B. `USD`), der von der Fondswährung abweicht, gelten Kennzahl und Abzug in der Währung der Kennzahl. Der Unternehmenswert (Kennzahl × Multiple − Abzug, nicht unter null) wird mit dem **Kurs des Basistags** (Wechselkurstabelle, Wissensstand beachtet, höchstens sieben Tage alt, Wege wie in „Wahl des Kurses“) in die Fondswährung umgerechnet, danach gilt der Anteil des Fonds. Der Faktor bleibt ein Bruch, gerundet wird einmal am Ende. Fehlt der Kurs, hat der Fall keinen Wert (Befund `BEWERTUNG_KURS_FEHLT` mit Paar, Tag und Grund), ebenso Erwartungswert und Fondskennzahlen; es wird nie ein Kurs geschätzt. Der Rechenweg nennt Währung, Kurs und Kursdatum. Kennzahlen mit anderer Einheit (Anzahl, Prozent, Text) gelten wie bisher als Zahl in Fondswährung.
- **Wahrscheinlichkeiten** sind Brüche mit höchstens sechs Nachkommastellen und ergeben je Beteiligung genau 1 (100 %); die Oberfläche rechnet Prozent in Brüche um, ohne Gleitkomma. Der Erwartungswert ist die gewichtete Summe, einmal auf Cent gerundet.
- **Lücken:** Fehlt eine Eingabe (Kennzahl, Runde, Anteil), hat der Fall keinen Wert, ebenso der Erwartungswert und jede Fondskennzahl, die darauf beruht. Befunde nennen den Grund.
- **Wirkung auf den Fonds:** je Fall (gleiche Kennung über alle Beteiligungen; wer den Fall nicht hat, behält den aktuellen Wert) und erwartet: NAV, TVPI, DPI, RVPI, Carry-Vorschau und NAV nach Carry. Die Carry-Vorschau ist vereinfacht wie in der Prognose (Carry-Satz des Szenarios mal Zuwachs über den Abrufen, Gesamtfonds, ohne Hurdle und Catch-up). 
- **Erlös laut Exit-Wasserfall je Fall (Nacharbeiten 9):** Zu jedem Fall mit einem Unternehmenswert steht der Erlös des Fonds aus dem **vorhandenen Exit-Wasserfall** daneben (Ergebnis `exit`; keine zweite Rechnung). Unternehmenswert des Falls: bei Multiple Kennzahl × Multiple − Abzug (in Fondswährung, ohne den Anteil), bei letzter Runde Preis je Anteil × Anteile des Unternehmens nach der Runde × (1 − Abschlag); ein fester Wert hat keinen Unternehmenswert und damit keinen Erlös. Der Wasserfall rechnet mit der Kapitaltabelle des Unternehmens zum Basistag als Exit-Datum und ohne Exit-Kosten. Gibt es keine Kapitaltabelle mit Positionen des Fonds, steht der Grund „keine Kapitaltabelle“ statt einer Zahl. Der Unterschied zum Wert des Falls zeigt, was Vorzugsrechte gegenüber dem reinen Anteil ausmachen; der **Erwartungswert der Erlöse** (`erwartetErloes`) ist eine Lücke, sobald ein Fall keinen Erlös hat.
  - **Grenzen:** Der Erlös ändert weder den Wert des Falls noch NAV, TVPI, DPI oder Carry-Vorschau (diese beruhen weiter auf dem Wert der Methode). Hält der Fonds mehrere aktive Beteiligungen am selben Unternehmen, gilt der Erlös für das Unternehmen und alle Beteiligungen des Fonds darin (`beteiligungenDesFonds`); er wird nicht auf sie verteilt. Der Exit-Termin des Bewertungsfalls ist der Basistag, keine Prognose.
- **Festschreiben:** Das Ergebnis liegt im gespeicherten Ergebnis des Szenarios und ist damit eingefroren und durch die Prüfsumme gesichert. Ein Entwurf rechnet bei jeder Ansicht neu.
- **Bericht:** Die vorhandenen Szenarioberichte (PDF und Excel) enthalten den Abschnitt Bewertungsszenarien und die Wirkung auf den Fonds; Entwürfe tragen das Wasserzeichen ENTWURF.
- **Bericht:** Der Szenariobericht enthält die Spalte „Erlös des Fonds laut Wasserfall“ (PDF und Excel); ohne Kapitaltabelle steht der Grund.
- Rechenkern: `packages/rechenkern/src/bewertungsszenario.ts` mit Python-Referenz `referenz/referenz_bewertungsszenario.py` (Fälle F und G prüfen Umrechnung und Unternehmenswert).
