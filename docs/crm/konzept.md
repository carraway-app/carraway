# CRM und Dealflow: Konzept (Etappe 20)

Dieses Dokument hält fest, welche Muster aus öffentlich dokumentierten CRM-Produkten für Carraway übernommen wurden, wie sie zu den vorhandenen Daten und Rechten passen und welche Entscheidungen daraus folgen. Es beschreibt Muster, keinen übernommenen Code.

## Quellen

Grundlage sind öffentlich dokumentierte Muster verbreiteter CRM-Systeme (Objekte, Datensätze, Attribute, Listen, Ansichten). Es wurden **nur Ideen und Bedienmuster** genommen. Code, Texte, Symbole und andere Dateien wurden nicht kopiert. Die Umsetzung entstand neu auf dem vorhandenen Datenmodell und Stack von Carraway.

## Beobachtete Muster

| Bereich | Muster |
| --- | --- |
| Objekte und Datensätze | Jedes Objekt (Unternehmen, Kontakte, Deals) hat Datensätze mit Attributen. Systemattribute sind fest, eigene Attribute ergänzt die Verwaltung. |
| Attribute | Typen wie Text, Zahl, Betrag, Datum, Auswahl, Mehrfachauswahl, Kontrollkästchen, URL, E-Mail, Telefon, Person, Verknüpfung zu einem anderen Datensatz. Optionen tragen Farben. |
| Beziehungen | Verknüpfungen zeigen auf beiden Seiten („verknüpft mit“). Kontakte können zu mehreren Unternehmen gehören. |
| Ansichten | Tabelle und Board; Filter mit UND/ODER-Gruppen und Operatoren je Typ; Sortierung; sichtbare, geordnete Spalten mit Breite; Gruppierung (Board nach Auswahlfeld); gespeichert privat oder geteilt; Standardansicht je Objekt. |
| Listen | Frei zusammengestellte Mengen von Datensätzen mit eigenen Feldern je Eintrag, dargestellt wie jede andere Ansicht. |
| Datensatzseite | Kopf mit Name, Kennzeichen und Schnellaktionen; Attributleiste mit direkt bearbeitbaren Feldern; Reiter für Aktivität, Notizen, Aufgaben, Mails, Dateien; Rückverweise. |
| Bedienung | Bearbeiten direkt in der Zelle, Tastaturbedienung der Tabelle, Befehlsleiste (Strg+K oder Cmd+K) mit Suche und Aktionen, Sammelaktionen auf gewählten Zeilen. |

## Abbildung auf Carraway

### Objekte

Die vorhandenen Tabellen bleiben, ihre Namen und Routen auch; das schützt alle bestehenden Seiten, Berichte und die API.

- **Unternehmen** = `organisation` (Art: Unternehmen, Investor, Berater, Sonstige). Neu: E-Mail, Telefon, LinkedIn, eigene Felder, Archivierung.
- **Kontakte** = `person`. Neu: Telefon, LinkedIn, eigene Felder, Archivierung. Das Unternehmen ist optional.
- **Beschäftigung** (`beschaeftigung`): n:m zwischen Kontakt und Unternehmen mit Funktion, Zeitraum und genau einer Hauptzeile je Kontakt (teilweiser eindeutiger Index). `person.organisation_id` und `person.funktion` bleiben als Spiegel der Hauptzeile erhalten, weil viele bestehende Abfragen sie lesen. Die bestehenden Wege (Person anlegen, ändern, Import, Zusammenführen) pflegen die Hauptzeile mit.
- **Deals** = `deal` mit den Phasen des bestehenden Aufzählungstyps. Die Regeln aus Etappe 2 gelten unverändert: Das Closing und der Übergang ins Portfolio verlangen einen zustimmenden Beschluss, der Phasenwechsel läuft über dieselbe Funktion wie `POST /deals/:id/phase`. Kontakte am Deal stehen in `deal_kontakt`.
- **Notizen** sind weiterhin Aktivitäten der Art Notiz; synchronisierte Mails und Termine (Etappe 17) bleiben Aktivitäten mit Herkunft und erscheinen unverändert im Verlauf.
- **Aufgaben** (`aufgabe`): Titel, Fälligkeit, Zuständigkeit, erledigt am, Bezug zu Unternehmen, Kontakt oder Deal. Zuständig kann jede aktive angemeldete Person mit Zugriff sein (bei einem Deal mit Fonds mit Rolle an diesem Fonds); die Auswahl sucht über `GET /crm/zustaendige` (nur Kennung und Name, für Personen ohne globale Verwaltung nur, wer mit ihnen einen Fonds teilt), die Schreibwege prüfen dieselbe Regel serverseitig. Die Listen zeigen „Meine“ oder „Alle“. Die Wiedervorlage an Aktivitäten bleibt bestehen (Zähler in der Kopfzeile, Kalenderabo, Tageszusammenfassung); der Reiter „Heute“ zeigt beides nebeneinander.

### Eigene Felder

- **Speicherung:** JSONB-Spalte `felder` an `organisation`, `person` und `deal` (bei Listeneinträgen an `liste_eintrag`), Schlüssel ist die ID der Felddefinition. Gründe: Das Änderungsprotokoll (ganze Zeile vorher/nachher) und der Vollexport (ganze Tabelle) erfassen die Werte ohne Zusatzarbeit; ein GIN-Index (`jsonb_path_ops`) trägt Enthaltensein-Abfragen; Sortieren und Filtern über Ausdrücke mit Typumwandlung erreicht die Leistungsziele (siehe unten).
- **Definitionen** (`feld_definition`): Objekt, optional Liste, Schlüssel, Name, Typ, Optionen, Position, Version, archiviert am. Der Typ ist nach dem Anlegen fest; ändern heißt archivieren und neu anlegen. Jede Änderung der Definition erhöht die Version, das Änderungsprotokoll hält jeden Stand. Archivieren blendet ein Feld aus, die Werte bleiben in der Zeile und im Export. Optionen lassen sich ergänzen, umbenennen und umfärben; eine Option zu entfernen, die in Gebrauch ist, lehnt die API ab.
- **Typen:** Text, langer Text, Zahl und Betrag (Dezimalzeichenkette, nie Gleitkomma), Datum, Auswahl, Mehrfachauswahl, Kontrollkästchen, URL (nur http und https), E-Mail, Telefon, Benutzer, Verknüpfung (zu Unternehmen, Kontakt oder Deal; schreibt Rückverweise in `datensatz_link`).
- **Rechte:** Felder definieren globale Verwalter; Felder einer Liste auch deren Besitzerin oder Besitzer. Werte vom Typ „Person im Haus“ nehmen nur aktive angemeldete Personen mit Zugriff (globale Verwaltung oder Rolle an einem Fonds, keine technischen Zugänge, keine Investoren des Portals).
- **API:** Das Schema eines Objekts ist dynamisch und steht unter `GET /crm/objekte/{objekt}/felder` (Felder, Typen, Optionen, Operatoren je Typ); die OpenAPI-Beschreibung verweist darauf. Werte stehen unter der Feld-ID in `eigene`.

### Abfragen, Ansichten und Listen

- **Ein Abfragebauer** (`apps/api/src/crm/abfrage.ts`) bedient Tabelle, Board, Export und Sammelaktionen. Feldschlüssel werden gegen das Verzeichnis (Systemfelder und Definitionen) aufgelöst, Operatoren stammen aus einer festen Tabelle je Feldtyp, Werte werden je Typ geprüft und nur als Parameter gebunden. Die Sichtbarkeit (Deals nach Fonds, nicht zusammengeführt, nicht archiviert) hängt mit UND außerhalb des Filterbaums, ein ODER-Zweig kann sie nicht umgehen. Tiefe (4) und Anzahl der Bedingungen (60) sind begrenzt.
- **Ansichten** (`ansicht`): Konfiguration als JSON (Filter, Sortierung, Spalten mit Breite, Gruppierung), privat oder geteilt; ändern und löschen dürfen die Besitzerin oder der Besitzer und globale Verwalter, die Standardansicht legen nur globale Verwalter fest.
- **Listen** (`liste`, `liste_eintrag`): je Objekt, mit Listenfeldern; ändern (Name, Einträge, Felder, Archivieren) dürfen Besitzerin oder Besitzer und globale Verwalter. Zählung, Abfrage und Export einer geteilten Liste zeigen nur Datensätze, die die Person sehen darf.
- **Board:** Spalten je Option eines Auswahlfeldes mit Anzahl und Summe; im Dealflow nach Phase, bei Unternehmen und Kontakten nach einem beliebigen Auswahlfeld, auch einem Listenfeld (Ziehen schreibt den Wert am Datensatz bzw. am Eintrag der Liste).
- **Gruppierung der Tabelle:** `POST /crm/objekte/{objekt}/gruppen` liefert je Wert eines Auswahl-, Mehrfachauswahl-, Personen-, Verknüpfungs- oder Kontrollkästchenfeldes (und der Phase bei Deals) Anzahl und Summen für Betrags- und Zahlenfelder, mit derselben Treffermenge wie die Abfrage (Filter, Suche, Liste, Sichtbarkeit außerhalb des Filterbaums). Gruppen- und Summenfelder werden nur über das Feldverzeichnis aufgelöst, Werte sind Parameter. Bei einer Mehrfachauswahl zählt eine Zeile in jeder ihrer Gruppen. Bei einer Verknüpfung (auch dem Unternehmen eines Kontakts) ist der Wert die Kennung des Ziels, die Namen stehen in den Bezügen und folgen der Sichtbarkeit (Deals fremder Fonds bleiben ohne Namen, die Oberfläche zeigt „Kein Zugriff“); Gruppen sind nach Name sortiert, „ohne Wert“ zuletzt. Ein Kontrollkästchen ergibt die Gruppen `true` und `false`, ein fehlender Haken zählt als `false` (wie der Operator `ist_falsch`). Die Zeilen einer Gruppe holt die Oberfläche mit der Abfrage und einer Bedingung auf das Gruppenfeld; die Wahl steht in der Konfiguration der Ansicht (`gruppierung`).

### Datensatzseiten

Kopf (Name, Schnellaktionen), Reiter links, Attributleiste rechts; nie gestapelte Abschnitte. Unternehmen: Kontakte und Beziehungen (die Kontakte als **eine** Tabelle, Beziehungen als Unterreiter), Engagement (Deals, Beteiligungen), Aktivität, Runden, Register, Dokumente, Aufgaben, Verknüpft. Kontakt: Unternehmen (dieselbe Tabelle aus Sicht des Kontakts), Aktivität, Aufgaben, Verknüpft.

Die Tabelle der Kontakte führt drei Quellen zusammen, die früher getrennte Listen waren: Beschäftigungen (Funktion, Zeitraum, Hauptunternehmen), Rollen (Kontaktrollen: Gründung, Geschäftsführung, Co-Investor, Beratung, Investor, Sonstige) und die ältere Personenliste der Organisation. Je Beschäftigung eine Zeile; Rollen stehen als Etiketten in der Zeile der Person bei diesem Unternehmen; wer nur eine Rolle oder nur einen Eintrag der älteren Liste hat, bekommt eine Zeile ohne Beschäftigung. Daten und API bleiben unverändert (rein ergänzend: Telefon und LinkedIn bzw. Mail, Telefon, Website am Ergebnis von `GET /crm/beschaeftigungen`). Verknüpfen läuft in einer Schublade; wählt man einen Kontakt oder ein Unternehmen, mit dem die Verbindung schon besteht, zeigt die Schublade einen Hinweis mit Funktion und Zeitraum der vorhandenen Beschäftigung und „Bestehende öffnen“ (führt zur Bearbeitung); eine weitere Verbindung, etwa für einen anderen Zeitraum, bleibt erlaubt. Funktion und Zeitraum lassen sich ändern, die Verknüpfung lässt sich nach Bestätigung lösen. Die Deal-Seite hatte keine Doppelung (ihre Kontakte sind die des Deals). Deal: Übersicht, Verlauf, Aktivität (Notizen, Mails und Termine), Kontakte, Aufgaben, Beschlüsse, Dokumente, Verknüpft.

Erwähnungen in Notizen haben die Schreibweise `@[Anzeige](typ:id)`; sie werden beim Anlegen der Aktivität zu Verknüpfungen (`art = erwaehnung`) und erscheinen als Rückverweis am erwähnten Datensatz. Die Anzeige im Text ist React-Text, nie HTML.

### Rechte

Es gelten die bestehenden Regeln: Lesen mit Rolle an irgendeinem Fonds, Schreiben ab Bearbeiter; Deals folgen dem Fonds. Verknüpfungsfelder (und Listenfelder vom Typ Verknüpfung) prüfen beim Schreiben, ob die schreibende Person das Ziel sehen darf: Ein Deal eines fremden Fonds antwortet genau wie ein nicht vorhandener Datensatz (400 `FELDWERT_UNGUELTIG`, `unknown_record`, gleiche Meldung, keine Kennung im Text), sodass die Antwort nichts über sein Dasein verrät. Das gilt für die Datensatzseite, die Zelle, die Sammelaktion „Feld setzen“ und Listenfelder; der CSV-Import nimmt keine Verknüpfungswerte an. Wo eine Anfrage mehrere Datensätze oder das Objekt als Pfadparameter trägt, prüft der Handler Sichtbarkeit und Schreibrecht je Datensatz. Technische Benutzer (API-Schlüssel) sind Akteure wie andere auch.

### Import und Export

CSV-Import für Unternehmen und Kontakte mit freier Zuordnung der Spalten zu Feldern (auch eigenen), Vorschau mit Fehlern je Zeile und Dublettenprüfung (Logik aus Etappe 7: ähnlicher Name, gleiche E-Mail), Politik je Lauf (überspringen, aktualisieren, trotzdem anlegen). CSV-Export jeder Ansicht über denselben Abfragebauer; Zellen, die mit `=`, `+`, `-`, `@`, Tabulator oder Zeilenumbruch beginnen, bekommen ein Hochkomma (Schutz vor Formeln). Der Export schreibt einen Lese-Eintrag ins Änderungsprotokoll.

### Befehlsleiste

Strg+K oder Cmd+K: Suche über Unternehmen, Kontakte, Deals und Dokumente (wie zuvor) und Befehle: Datensätze anlegen, zu Tabellen, Board, „Heute“ und Listen springen.

## Migration

Migration `0049_crm_objekte` ergänzt Spalten und Tabellen und ändert keine bestehende Zeile: Jede Person mit Unternehmen bekommt genau eine Hauptbeschäftigung. Ein Test spielt den Datenschritt auf Bestandsdaten nach und prüft, dass nichts verloren geht. Die Demodaten (Seed) enthalten jetzt eigene Felder, Beschäftigungen, Listen und Aufgaben.

## Leistung

Messung mit 10.000 Unternehmen und 50.000 Kontakten mit eigenen Feldern (Test `crm-leistung.test.ts`, mit `SKIP_PERF=1` überspringbar): 95. Perzentil der Serverzeit je Abfrage deutlich unter 150 ms (Standardsortierung rund 10 ms, Sortierung nach einem eigenen Zahlenfeld rund 20 ms, nach dem Namen des Unternehmens rund 110 ms). Funktionale Indizes tragen die Standardsortierung nach Name.

## Bedienung in der Tabelle

Zellen von Auswahl-, Mehrfachauswahl-, Text-, Zahlen-, Datums-, Personen- und Verknüpfungsfeldern lassen sich direkt bearbeiten. Personen- und Verknüpfungsfelder öffnen ein Popover mit Suche (Eingabe oder F2 öffnet, Pfeiltasten wählen, Eingabe übernimmt, Escape verwirft, „Wert entfernen“ leert); das Popover hängt im Dokument, damit die scrollende Tabelle es nicht abschneidet. Geschrieben wird mit demselben Aufruf wie auf der Datensatzseite, die Prüfung der Werte übernimmt die API. Listenfelder gehören zum Eintrag der Liste und lassen sich nur von deren Besitzerin oder Besitzer und von Verwaltern ändern (wie die API es verlangt). Verweise auf Unternehmen, Kontakte und Deals (Namen in der Tabelle, Verknüpfungszellen, Verbindungstabellen, „Verknüpft“, Erwähnungen, Karten des Boards) zeigen beim Überfahren mit der Maus und beim Fokussieren per Tastatur eine kleine Karte mit Name, Unternehmen, Mail, Telefon und den Schnellaktionen. Sie holt `GET /crm/datensaetze/{objekt}/{id}/karte` (nur diese Felder; Deals fremder Fonds und fehlende Datensätze antworten gleich mit 404), lädt als eigener Abschnitt erst beim ersten Öffnen und hält die Antwort eine Minute im Zwischenspeicher. Sie ist die Beschreibung des Verweises (`aria-describedby`), nimmt keinen Fokus, Escape schließt sie; auf Touch-Geräten öffnet der Verweis wie gewohnt die Seite. Die Aktionen in der Karte sind mit der Maus erreichbar, per Tastatur stehen dieselben Aktionen in der Zeile und auf der Datensatzseite. Schnellaktionen (Mail, Telefon, LinkedIn, Website) stehen in jeder Zeile, in den Kopfzeilen der Datensatzseiten, auf Karten und neben den Treffern der Befehlsleiste; bei Deals sind es die Wege des Unternehmens (lesbare Felder `unternehmenEmail`, `unternehmenTelefon`, `unternehmenWebsite`).

## Demo-Daten

Neben den eigenen Feldern (mit Jahresumsatz, Hauptkontakt als Verknüpfung und Betreuung als Person) und den Listen (Co-Investoren, Deals in der Prüfung, LP-Pipeline mit Listenfeldern Stufe und Volumen) legt der Seed fünf gemeinsame Ansichten an: Unternehmen nach Interesse gruppiert (mit Summe des Jahresumsatzes), Gespräche der Co-Investoren-Liste nach Status gruppiert, die LP-Pipeline als Kanban nach der Stufe, Kontakte nach Kanal und Deals nach Phase. Ansichten, Betreuung und Zuständigkeit der Aufgaben entstehen nach den Demo-Zugängen (sie brauchen Benutzer). Namen, Optionen und Aufgabentitel folgen `DEMO_SPRACHE`.

## Offen

- Mehrere Pipelines je Fonds: in diesem Durchgang nicht umgesetzt, Entwurf unten. Das Board der Deals nutzt die vorhandenen Phasen (andere Objekte haben ihr Board nach beliebigen Auswahlfeldern, auch Listenfeldern wie die „LP-Pipeline“).

### Entwurf: mehrere Pipelines je Fonds

Warum nicht jetzt: Die Phase eines Deals ist ein Datenbank-Aufzählungstyp (`deal_phase`), den der Trichterbericht, der Vollexport, die Änderungsabfrage, die Suche, die Beschlussvorlagen, die OpenAPI-Beschreibung (Aufzählung der Phasen), die Demodaten und etwa zehn Stellen der Oberfläche (Texte, Farben, Reihenfolge) voraussetzen; die Regeln aus Etappe 2 hängen an den Phasen `closing` (zustimmender Beschluss) und am Übergang ins Portfolio (Vier-Augen-Prinzip). Ein sauberer Umbau braucht eine Migration mit Rückfüllung und eine Übergangszeit, in der alle Verbraucher beides lesen; das lässt sich nicht nebenbei und ohne Gefahr für die Regeln machen.

Vorgehen, sobald es ansteht:

1. Neue Tabellen `pipeline` (Fonds, Name, Standard ja/nein, archiviert am; eine Standard-Pipeline je Fonds und eine für Deals ohne Fonds) und `pipeline_stufe` (Pipeline, Schlüssel, Name, Position, `art`: `normal` oder `abschluss`, `grundphase`: eine der sechs bisherigen Phasen).
2. `deal` bekommt `pipeline_id` und `stufe_id`. Die Spalte `phase` bleibt als abgeleiteter Spiegel der `grundphase` der Stufe erhalten, damit Trichter, Export, API und Berichte unverändert weiterlaufen; `deal_phasenwechsel` bekommt zusätzlich `von_stufe_id` und `nach_stufe_id`.
3. Die Regeln gelten für Stufen der Art `abschluss` (zustimmender Beschluss vor dem Wechsel); der Übergang ins Portfolio bleibt die eigene Aktion `POST /deals/{id}/portfolio` und ist an jeder Pipeline erlaubt, deren letzte Stufe die Art `abschluss` hat. `wechselePhase` wird zu `wechsleStufe` und ruft dieselbe Prüfung auf; `POST /deals/{id}/phase` bleibt für die Standard-Pipeline erhalten.
4. Migration: je Fonds eine Standard-Pipeline mit den sechs Stufen (`closing` als `abschluss`), `pipeline_id` und `stufe_id` aller Deals nach ihrer Phase gefüllt, danach `NOT NULL`; ein Test spielt den Datenschritt auf Bestandsdaten nach und prüft, dass Phase, Verlauf und Beschlüsse unverändert bleiben.
5. Oberfläche: Auswahl der Pipeline am Board und in der Deal-Tabelle, Stufenlisten verwalten globale Verwalter; Phasenanzeigen lesen die Stufe, der Trichterbericht bleibt über die `grundphase` vergleichbar.
