"""Unabhängige Referenzrechnung für die Rückflüsse einer Beteiligung (`RUECKFLUSS_ARTEN`, `beteiligungsMultiple`, `xirr`).

Aufruf: python3 -I referenz_rueckfluesse.py
Regel (Portfolio-Modell): Rückflüsse = Rückfluss + Tilgung + Zinszahlung + Dividende. Eine Zinsbuchung (`zins`) ist eine Forderung und zählt nie.
Ein Storno und sein Original heben sich auf. Multiple = (Bewertung + Rückflüsse) ÷ Investiert. IRR: XIRR mit act/365, Intervallhalbierung mit exakten Brüchen
(Endwert = Bewertung am Stichtag). Alle Zahlen sind erfunden.
"""
from datetime import date
from fractions import Fraction as F

RUECKFLUSS_ARTEN = {"rueckfluss", "tilgung", "zinszahlung", "dividende"}

vorgaenge = [
    # (Schlüssel, Art, Valuta, Betrag, storniert Schlüssel)
    ("v1", "auszahlung", "2021-01-01", "1000000", None),
    ("v2", "zins", "2021-12-31", "60000", None),
    ("v3", "zinszahlung", "2022-01-15", "60000", None),
    ("v4", "dividende", "2023-06-30", "20000", None),
    ("v5", "tilgung", "2024-01-01", "200000", None),
    ("v6", "zinszahlung", "2024-03-31", "5000", None),
    ("v7", "zinszahlung", "2024-04-30", "-5000", "v6"),
    ("v8", "rueckfluss", "2025-01-01", "900000", None),
]
bewertung = ("2025-06-30", "100000")

aufgehoben = set()
for schluessel, _, _, _, ziel in vorgaenge:
    if ziel:
        aufgehoben.add(schluessel)
        aufgehoben.add(ziel)

investiert = sum(F(b) for _, art, _, b, _ in vorgaenge if art == "auszahlung")
rueck = sum(F(b) for _, art, _, b, _ in vorgaenge if art in RUECKFLUSS_ARTEN)  # Summe nach Storno, wie die Datenbankabfrage
multiple = (F(bewertung[1]) + rueck) / investiert

strom = []
for schluessel, art, valuta, betrag, _ in vorgaenge:
    if schluessel in aufgehoben:
        continue
    if art == "auszahlung":
        strom.append((valuta, -F(betrag)))
    elif art in RUECKFLUSS_ARTEN:
        strom.append((valuta, F(betrag)))
strom.append(bewertung)


def tage(a, b):
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def npv(r, strom):
    erster = strom[0][0]
    return sum(float(b) / (1 + r) ** (tage(erster, d) / 365) for d, b in strom)


strom = sorted(strom, key=lambda x: x[0])
unten, oben = -0.99, 10.0
for _ in range(200):
    mitte = (unten + oben) / 2
    if npv(unten, strom) * npv(mitte, strom) <= 0:
        oben = mitte
    else:
        unten = mitte
irr = (unten + oben) / 2

print("investiert", investiert)
print("rueckfluesse", rueck)
print("multiple", float(multiple))
print("irr", f"{irr:.10f}")
