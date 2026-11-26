import { ZINSMETHODEN } from "@carraway/rechenkern";

/**
 * Rechenregeln als Dokumentation für den Vollexport (`rechenregeln.md`). Die Methoden stammen aus dem Rechenkern
 * (`ZINSMETHODEN`), die Definitionen folgen den dokumentierten Funktionen des Kerns; `Entscheidung N` verweist auf
 * `ENTSCHEIDUNGEN.md` im Repository. Wer die Daten mitnimmt, kann damit jede Kennzahl nachrechnen.
 */

const METHODEN: Record<(typeof ZINSMETHODEN)[number], string> = {
  "30E/360": "Deutsche Methode: Jeder Monat hat 30 Tage, das Jahr 360 Tage (Tag 31 zählt als 30). Zeitanteil = Tage nach 30E/360 ÷ 360.",
  "act/360": "Tatsächliche Tage ÷ 360.",
  "act/365": "Tatsächliche Tage ÷ 365.",
  "act/act": "Tatsächliche Tage, je Kalenderjahr geteilt durch 365 oder 366 (Schaltjahr); über Jahreswechsel werden die Anteile addiert.",
};

export function erzeugeRechenregeln(erzeugtAm: Date): string {
  return `# Rechenregeln

Stand des Exports: ${erzeugtAm.toISOString()}

Diese Datei beschreibt, wie Carraway aus den exportierten Daten Kennzahlen und Zinsen berechnet. Alle Beträge sind Dezimalzahlen
(nie Gleitkomma). Zinsen werden ungerundet weitergerechnet und erst bei der Buchung kaufmännisch auf Cent gerundet (Entscheidung 7). \`Entscheidung N\` verweist auf die Nummer in
\`ENTSCHEIDUNGEN.md\` des Carraway-Repositories.

## Grundsätze

- **Vorgänge sind unveränderlich.** Eine Korrektur ist ein Storno: ein neuer Vorgang derselben Art mit negiertem Betrag, der auf den
  stornierten verweist (\`vorgang.storniert_vorgang_id\`). Summen über \`vorgang.betrag\` ergeben damit den gültigen Stand. Ein Storno und
  sein Original fallen aus Zahlungsströmen und Kapitalverläufen heraus (Entscheidungen 54, 72).
- **Zwei Zeitachsen.** \`valuta\` bzw. \`stichtag\` ist die fachliche Zeit, \`erfasst_am\` die Erfassungszeit. Der Wissensstand eines Berichts
  zu einem früheren Stichtag filtert alle Eingaben nach \`erfasst_am\` (Entscheidung 53). Der jüngste Stichtag aus freigegebenen Bewertungen,
  Beteiligungsvorgängen und übernommenen Salden bildet die Basis für den Standard-Stichtag. Ohne diese Daten gilt heute. Spätere
  Fondsbewegungen und LP-Zahlungen schieben den Standard-Stichtag bis höchstens heute vor.
- **Bewertungen.** Nur Bewertungen mit Status \`freigegeben\` zählen; eine Korrektur ersetzt die alte Bewertung des Stichtags
  (Status \`ersetzt\`, \`ersetzt_am\`) (Entscheidung 99).

## Zinsmethoden (Rechenkern: \`ZINSMETHODEN\`)

Zins einer Periode = Kapital × Zinssatz × Zeitanteil, Kapital und Zinssatz aus dem Kapitalverlauf bzw. den Konditionen
(\`darlehen_kondition\`, Versionen ab \`gueltig_ab\`, je Periode gilt die Version am letzten Tag der Periode; Entscheidung 69).

${ZINSMETHODEN.map((m) => `- \`${m}\`: ${METHODEN[m]}`).join("\n")}

Gewinnabhängige Komponente: Anteil am Jahresüberschuss (\`jahresueberschuss\`), gekappt auf den Kappungssatz als Jahreszins auf das
durchschnittliche Kapital. Gestundete Zinsen entstehen als Betrag, werden aber bis \`stundung_bis\` nicht gebucht. Zinsperioden:
jährlich, quartalsweise oder endfällig ab dem Anker (Entscheidungen 69 bis 71).

## Kapitalverlauf eines Darlehens

Offenes Kapital = Auszahlungen + kapitalisierte Zinsen − Tilgungen, je Tag nach allen Bewegungen des Tages. Der Verlauf muss mit einer
Auszahlung beginnen und darf nie negativ werden.

## Buchwert einer Beteiligung

Buchwert = Investiert (Auszahlungen) + kapitalisierte Zinsen − Tilgungen − Wertberichtigungen (netto: Zuführung positiv, Auflösung
negativ) − Buchwertabgang früherer Teilverkäufe. Rückflüsse und Verkaufserlöse mindern den Buchwert nicht (Entscheidung 66).

## Verkauf

Barzufluss = Kaufpreis − Kosten − Treuhandbetrag − Verkäuferdarlehen, gebucht als Rückfluss. Treuhandbeträge sind eine Forderung, ihre
Erfüllung bucht den Rückfluss. Teilverkäufe kürzen die Bewertung anteilig; Kaufpreisanpassungen sind Rückflüsse (auch negativ) (Entscheidung 73).

## Fondskennzahlen

- **Portfoliowert** = Summe der wirksamen Beteiligungsbewertungen zum Stichtag unter Berücksichtigung der Ausstiege.
- **Fonds-NAV** = Portfoliowert + Bankguthaben + weitere Vermögenswerte − Verbindlichkeiten und Rückstellungen.
  Die übernommene Saldenliste zum selben Periodenende und Wissensstand liefert die Bilanzsalden. Kaufpreisforderungen stehen
  bis zum Zahlungseingang unter den weiteren Vermögenswerten. Beim Eingang wechselt der Betrag auf das Bankkonto.
  Ohne Bankzeile, vollständige Zuordnung oder übernommene Liste bleiben Fonds-NAV und NAV-abhängige Kennzahlen offen.
- **Abgerufen** = Summe der Fondsbewegungen Art \`abruf\` bis zum Stichtag; **Ausschüttungen** = Summe der Art \`ausschuettung\`.
- **Eingezahlt** = belegte Zahlungseingänge je LP mit Wertstellung bis zum Stichtag. Offen = abgerufen minus eingezahlt.
- **TVPI** = (NAV + Ausschüttungen) ÷ Eingezahlt.
- **DPI** = Ausschüttungen ÷ Eingezahlt.
- **RVPI** = NAV ÷ Eingezahlt.
  Ohne eingezahltes Kapital sind die Multiples nicht definiert.
- **Multiple einer Beteiligung** = (Bewertung + Rückflüsse) ÷ Investiert.
- **Rückflüsse einer Beteiligung** = Rückflüsse plus Tilgungen plus gezahlte Zinsen (\`zinszahlung\`) plus Dividenden; eine Zinsbuchung (\`zins\`) ist eine Forderung und zählt nicht dazu (Portfolio-Modell, ersetzt Entscheidung 25).
- **Investiert einer Beteiligung** = Summe der Auszahlungen. Buchungen einer Wandlung (Tilgung durch Wandlung, Zusage und Einlage aus Wandlung) sind kein Geldfluss und zählen weder zu Investiert noch zu den Rückflüssen; der ausgezahlte Spitzenbetrag zählt als Rückfluss. Buchwert und Position bleiben unverändert (Entscheidung 472).
- **IRR** (XIRR, tagesgenau): Beteiligung: Zahlungsstrom aus Auszahlungen (negativ) und Rückflüssen (positiv) mit der Bewertung als
  Endwert, Storno und Original fallen heraus (Entscheidung 54). Fonds: Zahlungsstrom aus Zahlungseingängen je LP mit eigener Wertstellung (negativ) und Ausschüttungen
  (positiv) mit dem NAV als Endwert (Entscheidung 25).

## Nachhaltigkeitsindikatoren (PAI)

Fondswerte nach Anhang I Tabelle 1 der Delegierten Verordnung (EU) 2022/1288 (Etappe 16, fachlich zu prüfen). Je Quartalsende zählt der aktuelle
Wert der Beteiligung (letzte wirksame Bewertung plus offene Kaufpreisforderungen, nach einem Exit 0); die Auswirkung des Berichtsjahres ist der
Durchschnitt der Auswirkungen zum 31.3., 30.6., 30.9. und 31.12. (Quartale ohne Bestand oder ohne Daten zählen nicht mit).
- **Absolute Emissionen** = Summe aus Wert ÷ Unternehmenswert (EVIC) × Emissionen des Unternehmens (Scope 1, 2, 3 und insgesamt).
- **Fußabdruck** (Emissionen, Wasser, Abfälle) = Summe aus Wert ÷ EVIC × Menge, geteilt durch den Gesamtwert aller Beteiligungen in Mio. EUR.
- **THG-Intensität** = Summe aus Wert ÷ Gesamtwert × (Emissionen ÷ Umsatz in Mio. EUR).
- **Anteile** (fossile Brennstoffe, Biodiversität, Verstöße, fehlende Verfahren, umstrittene Waffen) = Wert der Beteiligungen mit der Eigenschaft ÷ Gesamtwert.
- **Gewichtete Mittel** (nicht erneuerbare Energie, Lohngefälle, Frauenanteil) = Summe aus Wert × Angabe ÷ Wert der Beteiligungen mit Angabe.
- **Energieintensität je Sektor** (NACE-Abschnitte A bis H und L) = gewichtetes Mittel aus GWh ÷ Umsatz in Mio. EUR je Sektor.
- **Abdeckung** = Wert der Beteiligungen mit Daten ÷ Gesamtwert; **Schätzanteil** = Anteil davon, dessen Eingangsdaten geschätzt sind. Fehlende Daten sind
  nicht 0; Unternehmenswert oder Umsatz 0 oder fehlend schließen das Unternehmen aus der Rechnung aus und stehen als Befund im Bericht.

## Verteilung auf Investoren

Abrufe, Ausschüttungen und NAV werden nach der Methode des größten Rests auf den Cent verteilt (Entscheidung 106).
Mit \`fonds.lp_verteilung_nach_zusage\` gelten die Beträge in \`fonds_zeichnung.zusage\` als exakte relative Gewichte.
Bei bestehenden Verteilungen ohne diese Einstellung bilden die gespeicherten Anteile in \`fonds_zeichnung.anteil\` die Gewichte.
Weitere Closings (\`fonds_closing\`) gelten ab ihrem Wirksamkeitsdatum; jede Bewegung wird mit der Grundlage ihrer Valuta verteilt, die Zusagen und Anteile vor dem Closing stehen in \`fonds_closing_basis\`, die nach dem Closing in \`fonds_closing_stand\`. Die Spalte \`art\` unterscheidet Closing, Verringerung und Austritt; ein ausgetretener Investor (Kennzeichen \`ausgetreten\`) hat in der Verteilung das Gewicht null. Ein stornierter Vorgang (\`fonds_closing_storno\`) gilt ab seiner Stornierung nicht mehr; ein früherer Wissensstand sieht ihn weiter.

## Wandlung

Ein Wandeldarlehen wird in zwei Tilgungen getilgt (Wandlung und Spitzenbetrag); das Ziel bekommt Zusage und Auszahlung über
Wandlungsbetrag − Spitzenbetrag. Wandlungspreis = min(Rundenpreis × (1 − Abschlag), Bewertungsobergrenze ÷ Anteile vor der Runde); welche Regel galt, steht in
\`wandlung.massgeblich\` (Entscheidung 72). Lässt der Vertrag nur einen Teil von Darlehen und Zinsen wandeln, ist der Wandlungsbetrag die Summe der gewandelten Beträge; der Rest steht in \`wandlung.ergebnis\` (\`darlehenRest\`, \`zinsenRest\`, \`restbehandlung\`) und ist als Rückzahlung (Geldfluss) oder Erlass (ohne Geldfluss) gebucht (Entscheidung 508).

## Herkunft jeder Zahl

Berichte und Übersichten tragen zu jeder Kennzahl die Rechenschritte (\`schritte\`) mit; im Export stehen sie als JSON in den Spalten
\`schritte\` der Tabellen \`zinslauf_position\`, \`verkauf\` und \`wandlung\` (\`ergebnis\`).
`;
}
