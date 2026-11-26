# Sicherheitshinweise und Meldung von Schwachstellen

Security policy and responsible disclosure for Carraway. English summary at the end.

## Schwachstelle melden

Bitte melden Sie Sicherheitslücken **nicht** als öffentliches Issue oder Pull Request, sondern vertraulich:

- E-Mail an **lennard@rehlytics.net**, oder
- über die private Meldefunktion von GitHub („Report a vulnerability“ unter dem Reiter „Security“ des Repositorys), sofern aktiviert.

Bitte nennen Sie, soweit möglich:

- betroffene Version oder Commit, Betriebsform (Compose-Stack, eigene Datenbank) und Einstellungen, die relevant sind,
- Beschreibung der Schwachstelle und ihrer Auswirkung,
- Schritte zur Nachstellung oder einen Nachweis der Machbarkeit (ohne echte Daten),
- ob die Lücke bereits bekannt oder öffentlich ist.

## Was Sie erwarten können

| Schritt | Frist |
|---|---|
| Eingangsbestätigung | innerhalb von 3 Werktagen |
| Erste Einschätzung (bestätigt, abgelehnt, Rückfragen) | innerhalb von 10 Werktagen |
| Korrektur kritischer und schwerer Lücken | so schnell wie möglich, Ziel: 30 Tage |
| Korrektur mittlerer und geringer Lücken | mit einer der nächsten Versionen |
| Veröffentlichung (Hinweis in den Release-Notizen, Dank an die meldende Person auf Wunsch) | nach der Korrektur, in Absprache mit Ihnen |

Die Fristen sind Ziele eines Ein-Personen-Betriebs, keine Zusagen im Rechtssinn. Betroffene Kunden informiert der Betreiber nach dem
Vertrag zur Auftragsverarbeitung.

## Spielregeln

- Greifen Sie nur auf Systeme zu, die Ihnen gehören oder für die Sie eine Erlaubnis haben. Eine öffentliche Instanz von Carraway
  gehört nicht automatisch dazu: Fragen Sie vorher an.
- Greifen Sie nicht auf Daten anderer zu, verändern oder löschen Sie keine, und lösen Sie keine Dienstunterbrechung aus
  (keine Lasttests, kein Massen-Scanning, kein Social Engineering).
- Lassen Sie angemessene Zeit zur Korrektur, bevor Sie Einzelheiten veröffentlichen.
- Wer sich daran hält, wird nicht verfolgt; für Forschung im Rahmen dieser Regeln wird keine Anzeige erstattet.

## Unterstützte Versionen

Korrekturen erscheinen in einer neuen Version. Unterstützt wird jeweils die neueste veröffentlichte Version; wer das Container-Image
nutzt, aktualisiert auf die neueste Version (siehe deploy/README.md).

## Was zum Geltungsbereich gehört

Der Quellcode in diesem Repository (API, Worker, Oberfläche, Rechenkern, Berichte, Betriebsunterlagen unter `deploy/`) und das
daraus gebaute Container-Image. Nicht dazu gehören Schwachstellen in Diensten Dritter (Hosting, Identitätsanbieter), in der
Konfiguration einer fremden Instanz oder reine Hinweise auf fehlende Härtungsmaßnahmen ohne konkrete Auswirkung.

## English summary

Please report vulnerabilities privately to **lennard@rehlytics.net** or through GitHub's private
vulnerability reporting, not as public issues. Include affected version, impact and reproduction steps without real data. You will
get an acknowledgement within 3 business days and a first assessment within 10 business days; the aim is to fix critical issues within
30 days and publish in agreement with you. Test only systems you own or have permission for, do not access or alter other people's
data, and give reasonable time to fix before disclosure. Researchers acting within these rules will not be pursued.
