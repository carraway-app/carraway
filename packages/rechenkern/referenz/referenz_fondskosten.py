"""Unabhängige Referenzrechnung für die Tests von Verwaltungsvergütung und Kapitalkonten mit Kosten.

Aufruf: python3 -I referenz_fondskosten.py
Exakte Brüche (fractions.Fraction), keine Gleitkommazahlen. Alle Beträge sind erfunden.
Vergütung = Basis × Jahressatz × Tage / 365 (beide Tage einschließlich), auf den Cent gerundet (halb auf).
Verteilung nach dem größten Rest, bei Gleichstand der niedrigere Index.
NAV-Anteil = NAV nach Gewicht + Summe je Buchung (Soll nach Gewicht der aktiven Investoren − getragener Anteil).
"""
from datetime import date
from fractions import Fraction as F
from math import floor


def cent(x):
    q = F(x) * 100
    n = floor(q + F(1, 2)) if q >= 0 else -floor(-q + F(1, 2))
    s = f"{abs(n):03d}"
    return ("-" if n < 0 else "") + s[:-2] + "." + s[-2:]


def verteile(betrag, gewichte):
    c = F(betrag) * 100
    vz = -1 if c < 0 else 1
    c = abs(c)
    summe = sum(gewichte)
    exakt = [c * g / summe for g in gewichte]
    teile = [floor(e) for e in exakt]
    rest = int(c - sum(teile))
    for i in sorted(range(len(exakt)), key=lambda i: (-(exakt[i] - floor(exakt[i])), i)):
        if rest <= 0:
            break
        teile[i] += 1
        rest -= 1
    return [F(vz * t, 100) for t in teile]


print("== A Vergütung 2 % auf 25.000.000,00 für Q3 2026 ==")
tage = (date(2026, 9, 30) - date(2026, 7, 1)).days + 1
print("tage", tage, "verguetung", cent(F(25_000_000) * F("0.02") * tage / 365))

print("== B Vergütung 1,75 % auf 12.345.678,91 für 2026-01-01 bis 2026-01-31 ==")
tage = (date(2026, 1, 31) - date(2026, 1, 1)).days + 1
print("tage", tage, "verguetung", cent(F("12345678.91") * F("0.0175") * tage / 365))

print("== C Kapitalkonten: drei Investoren 50/30/20, NAV 1.000.000,00 ==")
gew = [F(50), F(30), F(20)]
nav = F(1_000_000)
# Buchung 1 anteilig, Buchung 2 ohne den dritten Investor (manuell 600/400/0).
b1 = verteile(F("1000.01"), gew)
b2 = [F(600), F(400), F(0)]
navg = verteile(nav, gew)
aus = [F(0)] * 3
for b in (b1, b2):
    soll = verteile(sum(b), gew)
    aus = [a + s - t for a, s, t in zip(aus, soll, b)]
print("b1", [cent(x) for x in b1])
print("nav_gewicht", [cent(x) for x in navg])
print("ausgleich", [cent(x) for x in aus])
print("nav_anteil", [cent(n + a) for n, a in zip(navg, aus)], "summe", cent(sum(navg) + sum(aus)))
