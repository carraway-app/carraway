# DATEV-Format: Buchungsstapel (EXTF)

Der Buchungsexport schreibt das DATEV-Format, Formatkategorie 21 „Buchungsstapel“, Versionsnummer 700, Formatversion 13
(`packages/import/src/datev-extf.ts`). Dieses Dokument hält fest, wogegen die Feldliste geprüft wurde und was offen bleibt.

## Verwendete Quellen

| Quelle | Ergebnis |
|---|---|
| DATEV-Entwicklerportal, Beschreibung des Kopfs und Dokument 1003221 (Feldbeschreibung Buchungsstapel) | Die Seiten waren beim Abgleich nicht abrufbar (Verbindung abgelehnt). Eine Suchmaschinenauskunft bestätigt nur: Versionsnummer 700, Formatkategorie 21 für den Buchungsstapel, Feld 20 (Rechnungslegungszweck) mit den Werten 0, 30, 40, 50, 64. |
| Open-Source-Bibliothek `ledermann/datev` (Ruby, Format 7.0): Feldlisten für Kopf und Buchung samt Grenzen, dazu die Beispieldatei `examples/EXTF_Buchungsstapel.csv` | Hauptquelle des Abgleichs: 31 Kopffelder, 125 Spalten, Reihenfolge, Längen, Zeichenvorrat, Belegdatum, Anführungszeichen. Die Bibliothek ist eine Umsetzung Dritter, keine Quelle von DATEV. |

## Bestätigt (gegen die Open-Source-Umsetzung und ihre Beispieldatei)

- Kopfzeile mit 31 Feldern in dieser Reihenfolge: Kennzeichen `EXTF`, Versionsnummer 700, Datenkategorie 21, Formatname, Formatversion 13,
  Erzeugt am (`JJJJMMTThhmmssSSS`), Importiert (leer), Herkunft, Exportiert von (bis 25 Zeichen), Importiert von (leer), Berater, Mandant,
  WJ-Beginn (`JJJJMMTT`), Sachkontenlänge (4 bis 8), Datum vom, Datum bis, Bezeichnung (bis 30 Zeichen), Diktatkürzel, Buchungstyp
  (1 = Finanzbuchhaltung), Rechnungslegungszweck (Feld 20; 0 oder leer = unabhängig), Festschreibung, WKZ, Derivatskennzeichen,
  SKR (Feld 27), Branchenlösung-Id, Anwendungsinformation (Feld 31, bis 16 Zeichen). Die Dateikopf-Zeile der Beispieldatei wird
  im Test nachgebaut (Anführungszeichen nur bei Text, leere Felder, Buchungstyp 1, Festschreibung 0, WKZ „EUR“).
- Zeile 2 mit 125 Spaltenüberschriften; Stellen von Konto (7), Gegenkonto (8), Belegdatum (10), Belegfeld 1 (11), Buchungstext (14),
  Beleglink (20), KOST1 (37), Zusatzinformation (48) und Stück (88) stimmen überein.
- Beträge ohne Tausendertrenner mit Dezimalkomma, Umsatz immer positiv, Soll/Haben-Kennzeichen bezogen auf das Konto. Ein Storno wird
  daher als positiver Umsatz mit vertauschtem Kennzeichen geschrieben.
- Belegdatum im Format `TTMM` (ohne Jahr): Beim Import zählt das Wirtschaftsjahr, nicht das Jahr im Datum. Ein Stapel darf deshalb höchstens
  zwölf Monate umfassen (Problem `EXPORT_ZEITRAUM_ZU_GROSS`).
- Belegfeld 1: höchstens 36 Zeichen aus `A-Z a-z 0-9 $ & % * + - /`. Buchungstext: höchstens 60 Zeichen (längere Texte werden gekürzt).
- Beraternummer ab 1001 (Eingabe der Fondskonfiguration prüft das).
- Windows-1252, Semikolon, Zeilenende CR LF.

## Mit diesem Abgleich geändert

- Überschriften „Basisumsatz“ und „WKZ Basisumsatz“ (vorher mit Bindestrich), „Kost Menge“, „EU-Land u. USt-IdNr.“, „EU-Steuersatz“,
  die Gedankenstriche in „Beleginfo – Art n“, „Zusatzinformation – Art n“ und „KOST1 – Kostenstelle“ sowie „Datum vom“ in der Beschreibung des Kopfs.
- Das Diktatkürzel im Kopf bleibt leer statt leerer Anführungszeichen.
- Beraternummer unter 1001 wird abgelehnt.

## Offen, nicht belegt

- **Schreibweise der Überschriften in Zeile 2.** Die Open-Source-Umsetzung und die Erinnerung an die Beschreibung von DATEV weichen im
  hinteren Teil ab (z. B. „Bezeichnung“ und „Kennzeichen“ gegenüber „Bezeichnung SoBil-Sachverhalt“ und „Kennzeichen SoBil-Buchung“,
  „Abrechnungsreferent“ gegenüber „Abrechnungsreferenz“, „Datum Zuord.“ gegenüber „Datum Zuord. Steuerperiode“). Im hinteren Teil gilt
  weiter die Schreibweise der Beschreibung von DATEV aus der Erinnerung; die Spaltenanzahl und -stellen sind in beiden Fällen gleich.
  Programme, die Spalten nach Überschrift suchen, brauchen nur die vorderen Felder (Umsatz, Kennzeichen, Konto, Gegenkonto, Belegdatum, Belegfeld 1, Buchungstext).
- **SKR (Feld 27)** bleibt leer. Der Wert und seine zulässige Schreibweise sind nicht belegt.
- **Formatversion 13** und die Herkunftskennung `FU` sind nicht gegen eine aktuelle DATEV-Installation geprüft.
- **Kontolänge:** Der Export verlangt Konten mit genau der Sachkontenlänge des Kopfs und meldet Abweichungen als Problem. Personenkonten
  (eine Stelle länger) sind nicht vorgesehen.
- **Echter Import:** Es gibt keine Prüfung durch einen Import in eine DATEV-Anwendung. Vor dem Einsatz eine Beispieldatei dort einlesen.
