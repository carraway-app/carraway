# Rechtemodell: Rollen, Nutzergruppen, Fondszugriff

Das Rechtemodell erweitert die Fondsrollen je Person um Rollen und Nutzergruppen. Bestehende Fondsrollen bleiben gültig. Wer keiner Gruppe angehört, hat dieselben Rechte wie vorher.

## Begriffe

| Begriff | Bedeutung |
|---|---|
| **Stufe** | Betrachter < Bearbeiter < Freigeber < Verwalter. Lesen = Betrachter, Erfassen = Bearbeiter, Freigeben = Freigeber, Einstellungen und Rollen eines Fonds = Verwalter. Dieselbe Rangfolge wie bisher (`fonds_rolle`). |
| **Bereich** | Teil der Anwendung, siehe unten. Jede Route mit Fondsrolle gehört zu genau einem Bereich (`apps/api/src/rechte/bereiche.ts`). |
| **Rolle** | Benanntes Bündel von Bereichen, z. B. „Kontakte“ = nur der Bereich Kontakte. Tabelle `rechterolle`. Auf Wunsch mit einer **höchsten Stufe je Bereich** (`bereich_stufen`, z. B. Finanzen höchstens Betrachter); ohne Eintrag hat ein Bereich keine Grenze. |
| **Nutzergruppe** | Personen, eine Stufe, Rollen und ein Fondszugriff. Tabellen `nutzergruppe`, `nutzergruppe_mitglied`, `nutzergruppe_rolle`, `nutzergruppe_fonds`. |
| **Fondszugriff der Gruppe** | Ohne Beschränkung gilt die zentrale Einstellung. Mit Beschränkung gelten nur die ausgewählten Fonds. |
| **Bereiche je Fonds** | Schalter der Gruppe (`nutzergruppe.bereiche_je_fonds`, Standard aus). An: Die Bereiche der Gruppe gelten nur an ihren Fonds, je Fonds auf eine Auswahl begrenzbar (`nutzergruppe_fonds.bereiche`, leer = alle Bereiche ihrer Rollen). Aus: wie bisher fondsübergreifend. |
| **Zentrale Einstellung „Fonds offen“** | `rechte_einstellung.fonds_offen`, Standard `true`. Offen: Gruppen ohne Beschränkung sehen alle Fonds. Geschlossen: Jede Gruppe sieht nur ihre ausgewählten Fonds. |
| **Nutzer-Ausnahme** | Die bisherige Fondsrolle einer Person (`fondsrolle`, Verwaltung → Rollen je Fonds). Sie ergänzt weitere Fonds und gilt an ihrem Fonds vor jeder Gruppe, auch wenn ihre Stufe niedriger ist. |

## Auflösung der wirksamen Rechte

Für jede Anfrage einer angemeldeten Person (`rechte/aufloesung.ts`, Sichten `wirksame_fondsrolle` und `wirksames_bereichsrecht`):

1. **Stufe je Fonds.** Hat die Person eine eigene Fondsrolle am Fonds, gilt diese. Sonst gilt die höchste Stufe aller ihrer Gruppen, deren Fondszugriff den Fonds umfasst. Ohne beides hat die Person keinen Zugriff auf den Fonds.
2. **Bereiche.**
   - Ohne Gruppe: alle Bereiche (wie vor dem Rechtemodell).
   - Mit Gruppe: die Vereinigung der Bereiche aller Rollen aller ihrer Gruppen.
   - Gruppe ohne Rolle: kein Bereich.
3. **Daten ohne Fonds** (Kontakte, Deals vor der Zuordnung): Es genügt die Stufe an irgendeinem Fonds oder die höchste Stufe der Gruppen, auch wenn die Gruppe keinen Fonds hat. Die Stufe der Gruppe ohne Fonds zählt nur an Regeln mit `ohneFondsErlaubt` (Bereiche Kontakte, Dealflow und `allgemein`), nie an fondsbezogenen Routen; dort braucht es eine Stufe an einem Fonds.
4. **Prüfung einer Route:** zuerst der Bereich der Route (`Regel.bereich`), dann die Mindeststufe an den Fonds der Ziele, und zwar die Stufe in genau diesem Bereich (siehe „Bereiche je Fonds“). Fehlt der Bereich, antwortet die API mit 403 `forbidden`.
5. **Eingebettete Daten** eines anderen Bereichs verlangen ihren Bereich (`rechte/sichtbarkeit.ts`). Ohne ihn bleiben sie leer, z. B.:
   - Beteiligungen auf der Seite einer Organisation oder eines Deals (Portfolio)
   - Deals in Kontakten, Suche und Listen (Dealflow)
   - Treffer der Suche in Organisationen und Personen (Kontakte) und in Dokumenten (Dokumente)

**Standard: Bereiche gelten fondsübergreifend.** Ohne den Schalter „Bereiche je Fonds“ gelten die Bereiche einer Gruppe an jedem Fonds, auf den die Person Zugriff hat. Ein Beispiel: Gruppe A gibt den Bereich Finanzen an Fonds 1, Gruppe B gibt Kontakte an allen Fonds. Dann darf die Person auch an den übrigen Fonds Finanzen sehen, soweit sie dort eine Stufe hat. So verhalten sich alle Gruppen, die vor der Erweiterung angelegt wurden.

### Bereiche je Fonds und Stufe je Bereich

Wirksame Stufe je Person, Fonds und Bereich: Sicht `wirksames_bereichsrecht` (Migration 0068). Eine Zeile ohne Bereich gilt für alle Bereiche (Person ohne Gruppe). Die Regeln:

1. **Fondsübergreifende Gruppen** (Schalter aus, wie bisher): Stufe am Fonds = eigene Fondsrolle, sonst die höchste Stufe dieser Gruppen am Fonds. Sie gilt für jeden Bereich ihrer Rollen, höchstens bis zur Grenze der Rolle: Stufe(Fonds, Bereich) = Minimum aus Fondsstufe und Bereichsstufe.
2. **Gruppen mit Bereichen je Fonds:** Sie wirken nur an ihren Fonds, je Fonds nur in den ausgewählten Bereichen, mit dem Minimum aus der Stufe der Gruppe und der Grenze der Rolle. Ihre Stufe hebt keine Bereiche anderer Gruppen an, und ihre Bereiche gelten an keinem anderen Fonds.
3. **Nutzer-Ausnahme:** Sie setzt die Stufe am Fonds, auch höher oder niedriger als die Gruppe. Sie bringt **keine Bereiche** mit: An ihrem Fonds gelten die Bereiche aus 1 und die Bereiche aus 2 an genau diesem Fonds, jeweils höchstens bis zur Grenze der Rolle. Wer nur Gruppen mit Bereichen je Fonds hat, bekommt durch eine Ausnahme an einem fremden Fonds dort keinen Bereich. Beispiel: Eine fondsübergreifende Gruppe ohne Fonds gibt Finanzen, eine Gruppe je Fonds gibt Portfolio an Fonds 1, die Ausnahme ist Betrachter an Fonds 1. Dann gilt an Fonds 1 Finanzen und Portfolio als Betrachter (Finanzen nach der bisherigen Regel), an Fonds 2 nichts.
4. **Daten ohne Fonds** (Kontakte, Deals vor der Zuordnung): Stufe je Bereich aus den Gruppen. Fondsübergreifende Gruppen wie bisher (höchste Stufe dieser Gruppen, höchstens bis zur Grenze), Gruppen mit Bereichen je Fonds mit dem Minimum aus ihrer Stufe und der Grenze für jeden Bereich ihrer Rollen.
5. **Mehrere Gruppen** vereinen sich: je Fonds und Bereich die höchste Stufe aus 1 und 2.

Beispiel „Fonds A: Portfolio bearbeiten, Finanzen nur lesen; Fonds B: nur Kontakte“: Rolle mit Portfolio, Finanzen (höchstens Betrachter) und Kontakte; Gruppe mit Stufe Bearbeiter, Bereichen je Fonds, Fonds A mit Portfolio und Finanzen, Fonds B mit Kontakten.

**Durchsetzung an einer Stelle.** `rechtePruefung` legt den Akteur jeder Anfrage auf den Bereich ihrer Route fest (`fuerBereich` in `anmeldung/akteur.ts`): Danach enthält `rollen` nur noch die Stufen in diesem Bereich. Damit prüfen und filtern `hatRolle`, `sichtbareFonds`, `hatIrgendwoRolle` und alle Listen der Handler nach Fonds und Bereich, ohne dass jeder Handler den Bereich kennt. Bereich und Stufe zählen nur zusammen an demselben Fonds, nie „Bereich an Fonds A, Stufe an Fonds B“. `alle` verlangt jeden Bereich (kleinste Stufe je Fonds), `allgemein` lässt die Stufe am Fonds über alle Bereiche. Daten eines anderen Bereichs nennen ihn ausdrücklich (`sichtbareFonds(akteur, mindest, bereich)`, `hatRolle(…, bereich)`, `fondsSichtbar`, `dealSichtbar`, `darfFondsSehen`): Deals in Kontakten, Suche und CRM-Listen, Beteiligungen auf der Seite einer Organisation, Dokumente in der Suche.

**Leistung.** `ladeRechte` liest je Anfrage die Sicht `wirksame_fondsrolle`, die Gruppen und (nur mit Gruppe) `wirksames_bereichsrecht`, jeweils nach Person gefiltert; für Personen in Gruppen sind das drei statt zwei Abfragen. Die Teilabfragen der Sicht sind `NOT MATERIALIZED`: Der Filter auf die Person erreicht `fondsrolle` und `nutzergruppe_mitglied` über deren Index; Rollen, Gruppen und Fonds (kleine Tabellen) werden dazu verknüpft.

### Bleibt unverändert

- Globale Verwalter sind überall Verwalter und haben alle Bereiche.
- Vier-Augen-Prinzip und Freigabestufen gelten wie bisher, die Stufe Freigeber entsteht nur aus anderer Quelle.
- Investor-Benutzer des LP-Portals gehören zu keiner Gruppe; das erzwingen API und Datenbank (Trigger `investor_keine_gruppe`).
- Eine Berichtigung legt ein Bearbeiter im Bereich `berichte` des Fonds der Vorfassung über `POST /berichte/:id/berichtigung` mit `grund` an. Freigeber erteilen die bei der Anlage geltenden Stufen des Fonds. Für den neuen Entwurf gelten die üblichen Vier-Augen-Regeln.
- Im Portal erscheinen freigegebene Fondsberichte und LP-Berichte. Der Berichtigungsgrund wird mit der letzten Freigabe für die Empfänger sichtbar. Bei LP-Berichten mit Kapitalkonten verknüpft das Portal nur die freigegebenen Dateien derselben eigenen Organisation. Jeder Download einer früheren Fassung prüft Zugang und gespeicherte Prüfsumme erneut.
- API-Schlüssel (`cwk_`) behalten ihre Scopes und alle Bereiche. Technische Benutzer gehören zu keiner Gruppe.
- Persönliche Werteschlüssel (`cww_`) handeln mit den wirksamen Rechten ihrer Person, also auch mit deren Bereichen.

## Zahlungseingänge zu Kapitalabrufen

Im Bereich Finanzen liest ein Betrachter die Abrufe, den Kapitalstand und die zugeordneten Zahlungseingänge seines Fonds. Ebenso liest er die Kostenbuchungen (Verwaltungsvergütung, Fondskosten) und die Kapitalkonten; Bearbeiter buchen und stornieren Kosten. Bearbeiter buchen und stornieren Eingänge. Der Fonds der Bewegung bestimmt das erforderliche Recht. Dasselbe Leserecht gilt für Einzelwerte, freigegebene Abrufmitteilungen und Belegdateien in der Kapitalherkunft. Der Server prüft es auch beim direkten Download. Im Portal sehen Investoren die Zahlen ihrer eigenen Zeichnungen.

## Bereiche

| Schlüssel | Inhalt (Auszug) | Seitenleiste |
|---|---|---|
| `portfolio` | Fondsübersicht, Beteiligungen, Instrumente, Tranchen, Vorgänge, Bewertungen, Runden und Kapitaltabelle, Mitarbeiterbeteiligung (Pools und Zuteilungen), Szenarien, Reserven, Werte-Schnittstelle | Portfolio |
| `finanzen` | Journal, Buchungen, Fondsbewegungen, Kapitalabrufe, Zinsen und Zinsläufe, Belege, Buchhaltung, Salden, Buchungsexport | Journal, Zinsen, Belege, Buchhaltung |
| `kennzahlen` | Kennzahlen, Kennzahlabfragen, ESG und Offenlegung | (Reiter im Fonds) |
| `berichte` | Berichte, Vorlagen, Berichtsfreigabe, Fondsbericht und Portfolioliste | Berichte |
| `meldewesen` | Meldeläufe, Meldedefinitionen, Förderprogramme, Meldedaten der Organisation | Meldungen |
| `dealflow` | Deals, Dealflow, Beschlussvorlagen, Kontakte eines Deals | Dealflow |
| `kontakte` | Organisationen, Personen, CRM (Listen, Ansichten, Felder, Aufgaben), Aktivitäten, Wiedervorlagen, Termine, Kontaktimport, Register, Postfach (der Abgleich ordnet Mails Kontakten zu) | Kontakte, Register |
| `dokumente` | Dokumente, KI-Auslesung | (in den Seiten) |
| `daten` | Datenübernahme (Import) | Import |
| `fondsverwaltung` | Fondsstammdaten ändern, Rollen je Fonds, Periodensperre, Freigabestufen, Zugänge der Investoren | (Fonds → Einstellungen) |

**Mitarbeiterbeteiligung (Entscheidung 486).** Pools und Zuteilungen eines Unternehmens sind aggregierte Kapitaltabelle ohne Personenbezug: Pool sichtbar = Runden sichtbar. Lesen darf, wer die Runden des Unternehmens lesen darf (Rechtsgrundlage am Unternehmen oder Position eines eigenen Fonds in einer seiner Runden), Schreiben verlangt dasselbe wie das Anlegen einer Runde (bearbeiter), jeweils im Bereich `portfolio`. Die Vorschau einer neuen Runde bezieht den Pool nur über schon verbundene Fonds ein; Fonds aus dem Anfragekörper zählen nicht.

Zwei Sonderfälle:

- **`allgemein`** braucht keinen Bereich: Fondsliste und Stammdaten eines Fonds (für Auswahllisten, mit Zeichnungskapital), eigene Einstellungen, Werteschlüssel, Namen, Wechselkurse, Felddefinitionen, Status der KI, Förderprogramme und der Zähler der Wiedervorlagen (ohne Kontakte null). Die Suche liefert je Gruppe von Treffern nur Bereiche der Person. Der Stapel führt jede Operation durch dieselbe Rechtsprüfung samt Bereich.
- **`alle`** braucht jeden Bereich: der Änderungsabruf `/changes`, weil er Datensätze aller Tabellen liefert.

Die Verwaltung (Benutzer, API-Schlüssel, Rollen und Gruppen, Export) bleibt globalen Verwaltern vorbehalten.

**Kontakte aus Postfach und Kalender.** Die Einstellung der Installation (`/kontaktvorschlaege/einstellung`: Modus, eigene Domains, Sperrliste) ändern nur globale Verwalter, wie die übrige Verwaltung. Teilnahme und eigene Sperrliste (`/postfach/kontakte`) sieht und ändert nur die Person selbst, wie ihre Postfachverbindung. Die Vorschlagsliste und Übernehmen, Zusammenführen und Verwerfen (`/kontaktvorschlaege…`) verlangen Bearbeiter im Bereich Kontakte, weil sie Personen und Unternehmen anlegen oder ändern; die Liste zeigt jeder Person nur Vorschläge aus ihrem eigenen, noch verbundenen Postfach oder Kalender, auch globalen Verwaltern. Ein Vorschlag verriete sonst, mit wem eine andere Person schreibt, bevor sie es für das CRM freigibt; Verbindungen sieht ebenfalls nur ihre Besitzerin. Verworfen wird je Person. Die Herkunft eines angelegten Kontakts (aus wessen Postfach, wann) sieht, wer den Kontakt sehen darf.

**KI: Kontakte ergänzen.** Die Einstellung der Installation (`/ki/kontakte/einstellung`) ändern nur globale Verwalter; die Freigabe des eigenen Postfachs (`/ki/kontakte/teilnahme`) nur die Person selbst. Vorschläge lesen Betrachter im Bereich Kontakte, übernehmen, verwerfen und das Auslesen einer Website verlangen Bearbeiter im Bereich Kontakte und einen Menschen (kein API-Schlüssel). Ein Vorschlag schreibt nichts; die Übernahme geht über die Inline-Bearbeitung und überschreibt nie einen von Hand gepflegten Wert.

**Zugänge und Zeichnungen der Investoren (Bereich `fondsverwaltung`).** Die Liste unter `/fonds/:fondsId/investorenzugaenge` (mit den weiteren Closings und dem vereinbarten Ausgleich) sehen Verwalter des Fonds. Schreiben dürfen nur globale Verwalter: Ersterfassung der Zeichnungen und weiteres Closing (`POST …/investorenzugaenge/zeichnungen` und `…/closings`, Entscheidung 509; Storno und Korrektur eines Closings, `POST …/closings/:closingId/storno` und `…/korrektur`, Entscheidung 515; Austritt oder Verringerung einer Zusage, `POST …/investorenzugaenge/zusageaenderungen`, Entscheidung 516). Ein Closing verändert Zusagen, Anteile und Zeichnungskapital des Fonds und verlangt darum dieselbe Stufe wie die Ersterfassung.

Die NAV-Herkunft gehört zum Bereich Portfolio. Einzelkonten aus der Saldenliste erfordern zusätzlich Finanzen am selben Fonds. Für Bewertungsbelege gelten Dokumente am Fonds und die Sichtbarkeit des verknüpften Ziels. Der Server prüft diese Rechte auch beim direkten Öffnen der Quelle.

## Mails

Interne Hinweise gehen nur an Personen mit dem passenden Bereich (`hatBereichSql`): Freigabe eines Berichts → Berichte, eines Meldelaufs → Meldewesen, eines Belegs → Finanzen, Registerereignis → Kontakte. Dazu kommt eine Stufe an genau diesem Fonds **in diesem Bereich** (Sicht `wirksames_bereichsrecht`; beim Registerereignis an einem Fonds, der am Unternehmen beteiligt ist). Die Freigabe prüft das mit `hatBereichSql(benutzer, bereich, { fondsId, mindest })`.

## Bereichsübergreifende Schreibwege

Schreibwege, die Daten mehrerer Bereiche berühren, prüfen zusätzlich zur Stufe jeden betroffenen Bereich (`rechte/uebergreifend.ts`, `verlangeBereiche`). Fehlt einer, antwortet die API mit 403 `forbidden` und nennt die fehlenden Bereiche (`bereiche`), bevor etwas geschrieben wird.

| Weg | Route gehört zu | Zusätzlich verlangt |
|---|---|---|
| Organisationen zusammenführen | Kontakte | Portfolio (Beteiligungen, Runden, Rundenpositionen) und Dealflow (Deals); immer, nicht erst bei vorhandenen Daten |
| Personen zusammenführen | Kontakte | Dealflow, wenn Deal-Kontakte oder Aktivitäten der Quelle an Deals hängen |
| KI-Auslesung bestätigen | Dokumente | Portfolio (Beteiligungsvertrag, Darlehensvertrag, Bewertungsnachweis) bzw. Kontakte (Registerauszug) |
| Beteiligung aus einem Deal anlegen | Dealflow | Portfolio |
| Datenübernahme prüfen und übernehmen | Datenübernahme | Kontakte, Portfolio, Finanzen; neue Fonds zusätzlich Fondsverwaltung |
| Stapel | allgemein | je Operation derselbe Bereich wie beim Einzelaufruf (keine eigene Regel nötig) |

Lesen: Die Vorschau beim Zusammenführen von Organisationen zählt Beteiligungen, Runden, Rundenpositionen und Fonds nur mit Portfolio und Deals nur mit Dealflow. Sonst stehen dort null, `fondsIds` ist leer, `darfAusfuehren` ist `false`, und `bereichFehlt` nennt die fehlenden Bereiche. Das Kalenderabonnement (ICS) liefert ohne Kontakte keine Termine und ohne Dealflow keine Wiedervorlagen an Deals; der Bereich wird bei jedem Abruf neu geprüft.

Bereiche je Fonds: Nach dieser Prüfung zählt an jedem betroffenen Fonds die Stufe im fremden Bereich (`hatRolle(…, bereich)`): Zusammenführen verlangt Bearbeiter im Dealflow an den Fonds der Deals und Freigeber im Portfolio an den Fonds der Beteiligungen, die Vorschau zählt Beteiligungen nach Fonds mit Portfolio und Deals nach Fonds mit Dealflow; die Auslesung und die Beteiligung aus einem Deal verlangen Bearbeiter im Portfolio des Zielfonds; die Datenübernahme die Stufe in Datenübernahme, Portfolio und Finanzen am Fonds; das Kalenderabonnement zeigt Wiedervorlagen an Deals nur aus Fonds mit Dealflow. Für fondsübergreifende Gruppen ist das dieselbe Stufe wie bisher.

## Ziele von Dokumenten

Dokumente gehören zum Bereich Dokumente, ihre Ziele oft zu einem anderen. Jedes Ziel verlangt darum zusätzlich seinen Bereich, und zwar mit derselben Stufe an demselben Fonds wie die Stufe der Route (`ZIEL_BEREICH` und `darfZiel` in `dokumente/ziele.ts`; dieselbe Zuordnung gilt für den SQL-Filter `dokumentSichtbar`):

| Ziel | Zusätzlich verlangt |
|---|---|
| Deal | Dealflow am Fonds des Deals; Deal ohne Fonds: Stufe im Dealflow wie an dessen Routen (auch aus einer Gruppe ohne Fonds) |
| Beteiligung, Vorgang, Bewertung | Portfolio am Fonds der Beteiligung |
| Finanzierungsrunde | Portfolio an einem Fonds, der das Unternehmen hält |
| Fonds, Organisation | nichts (Stufe in Dokumente am Fonds bzw. an einem haltenden Fonds; Organisation ohne Beteiligung: nur globale Verwalter) |

Fonds und Organisationen verlangen bewusst keinen zusätzlichen Bereich: weder Kontakte (wie an den Routen der Organisation) noch Portfolio an einem haltenden Fonds noch Fondsverwaltung. Ein Dokument an einem Fonds oder einem Unternehmen ist Ablage zu diesem Datensatz; die Stufe in Dokumente an dem Fonds, der den Datensatz trägt oder hält, schützt es bereits, und die Anzeige nennt nur den Namen des Ziels.

- **Schreiben** (Hochladen, Verknüpfen, Verknüpfung entfernen, Ersetzen, Texterkennung, Löschen, Auslesung starten, verwerfen und bestätigen, Anhang aus dem Postfach übernehmen): Fehlt der Bereich an einem Ziel, antwortet die API mit 403 `forbidden`, bevor etwas geschrieben wird.
- **Lesen:** Ziele ohne Bereich bleiben unsichtbar. Die Anzeige eines Dokuments listet nur die übrigen Verknüpfungen; ein Dokument, dessen Ziele alle unsichtbar sind, gibt es für die Person nicht (404, nicht in Liste, Suche und Dublettenprüfung). Die Kandidaten der Auslesung (`GET /auslesungen/:id`) und die Ziele, an die eine Bestätigung schreiben darf (`zieleDesDokuments`), stammen nur aus sichtbaren Zielen; Beteiligungen nur aus Fonds mit Portfolio.
- Eine neue Anteilsklasse aus der Auslesung verlangt Bearbeiter im Portfolio an einem haltenden Fonds.

## Grenzen

- Der Rahmen eines Fonds (Kopf mit Kennzahlen) gehört zum Bereich Portfolio. Wer ihn nicht hat, kommt über die Seitenleiste nicht dorthin; eine direkt aufgerufene Fondsadresse zeigt die Fehlermeldung der API.
- Globale Verwalter können Mitglied einer Gruppe sein. Das hat keine Wirkung, sie behalten alle Rechte.
- Bereiche je Fonds: Die Kandidatenliste der Zuständigen und die Namen im Protokoll richten sich nach der Stufe am Fonds über alle Bereiche (`wirksame_fondsrolle`); sie zeigen nur Namen. Der Deal einer Aufgabe verlangt dagegen Dealflow am Fonds des Deals (sonst 404, Schreiben verlangt Bearbeiter im Dealflow), und der zustimmende Beschluss verlangt, dass die erfassende Person Freigeber im Dealflow des Fonds ist.
- Die Oberfläche blendet Abschnitte nach der Vereinigung der Bereiche aus (`/me`, Feld `areas`). Aktionen an einem bestimmten Fonds prüft `darf(stufe, fondsId, bereich)` (`apps/web/src/lib/rechte.ts`) mit der Stufe je Fonds und Bereich aus `bereicheJeFonds` bzw. `stufeOhneFondsJeBereich`: Fonds ohne den Bereich bieten die Aktion nicht an (die API antwortet dort mit 403). Ohne `bereich` gilt die Stufe am Fonds über alle Bereiche.

## Verwaltung

**Oberfläche:** Verwaltung → Rollen und Gruppen. Dort stehen der zentrale Fondszugriff, die Rollen und die Nutzergruppen mit Stufe, Fonds, Rollen und Mitgliedern. Die Nutzer-Ausnahme pflegt Verwaltung → Rollen je Fonds.

**Schnittstelle** (nur globale Verwalter):

| Methode und Pfad | Zweck |
|---|---|
| `GET /permissions` | Stand: Einstellung, Bereiche, Rollen, Gruppen |
| `PUT /permissions/settings` | Fonds offen oder nur zugewiesene Fonds |
| `POST/PATCH/DELETE /permissions/roles[/:id]` | Rollen anlegen, ändern, löschen |
| `POST/PATCH/DELETE /permissions/groups[/:id]` | Gruppen anlegen, ändern, löschen; Listen ersetzen den Stand |
| `GET /users/:id/permissions` | wirksame Rechte einer Person, mit Herkunft je Fonds und Stufe je Fonds und Bereich |

Rollen haben `bereichStufen` (Bereich → höchste Stufe), Gruppen `bereicheJeFonds` (Schalter) und `fondsBereiche` (Fonds → Bereiche; nur mit dem Schalter und nur für Fonds aus `fondsIds`, sonst 400 `assignment_invalid`). Schaltet man den Schalter aus, entfällt die Auswahl je Fonds.

`GET /ich` liefert zusätzlich `bereiche` (`null` = alle, Vereinigung über alle Fonds) und `stufeOhneFonds`, dazu `bereicheJeFonds` (Fonds → Bereich → Stufe) und `stufeOhneFondsJeBereich`; beide `null`, wenn die Person keiner Gruppe angehört (dann gelten `rollen` und `bereiche`). Die Seitenleiste blendet Bereiche ohne Recht aus. Ohne den Bereich Portfolio führt der Start zu den Kontakten.

**Oberfläche:** Auch innerhalb einer Seite erscheint nur, was der Person erlaubt ist, statt eine 403-Meldung zu zeigen.

- Die Zuordnung steht an einer Stelle: `apps/web/src/lib/bereiche.ts` (`BEREICH_JE_ABSCHNITT`, je Seite und Eintrag des Inhaltsverzeichnisses). `useSichtbar(seite, eintraege)` filtert die Einträge vor `useInhalt`; eine Adresse zu einem ausgeblendeten Eintrag fällt auf den ersten zurück.
- Einzelne Teile prüft `useBereich(bereich)` aus `lib/rechte.ts`; `darf(stufe, fondsId, bereich)` verlangt zusätzlich den Bereich (z. B. Beleg erzeugen: Finanzen, auch auf der Seite einer Beteiligung).
- Beispiele: Organisation ohne Portfolio, Dealflow und Dokumente zeigt keine Deals, Beteiligungen, Runden und Dokumente, im Bearbeiten-Dialog fehlen ohne Meldewesen Sitzland und Region. Beteiligung ohne Kennzahlen, Finanzen, Dokumente und Kontakte blendet die entsprechenden Reiter aus, ohne Berichte den Quartalsbericht. Deal ohne Kontakte zeigt weder Aufgaben, Termine und Verknüpfungen noch das Seitenpanel. Im Fonds entfallen die Reiter Kennzahlen, ESG und Zinsen ohne ihren Bereich.
- Bei einer neuen Seite oder einem neuen Abschnitt eines anderen Bereichs den Eintrag in `BEREICH_JE_ABSCHNITT` ergänzen.

**Achtung:** Wer keiner Gruppe mehr angehört, hat wieder alle Bereiche und nur die eigenen Fondsrollen. Das gilt auch nach dem Löschen der letzten Gruppe einer Person.

## Überführung (Migration 0068, Bereiche je Fonds)

- Bestehende Gruppen behalten den Schalter „Bereiche je Fonds“ aus, bestehende Rollen haben keine Grenze je Bereich. Darum ändern sich die Rechte keiner Person.
- Ein Test vergleicht für alle Demo-Zugänge und für zufällige Kombinationen bestehender Gruppen die neue Sicht mit der Auflösung vor der Erweiterung (`__tests__/rechte-bereiche-je-fonds.test.ts`).
- `wirksame_fondsrolle` bleibt unverändert (Stufe am Fonds über alle Bereiche, z. B. für die Fondsliste und die Namen im Protokoll).

## Überführung (Migration 0065)

- Bestehende Fondsrollen bleiben unverändert und gelten ab jetzt als Nutzer-Ausnahmen.
- Es entstehen keine Gruppen und keine Rollen. Darum ändern sich die Rechte keiner Person.
- Die zentrale Einstellung beginnt mit „Fonds offen“.
- Die Demo-Daten legen Beispielrollen und -gruppen an (`packages/db/src/demo/zugaenge.ts`).

Wer direkt Fondsrollen las (Zuständige, Mailbenachrichtigungen, Kalenderabonnement, Beschlussprüfung, Namen im Protokoll), liest jetzt die Sicht `wirksame_fondsrolle`.
