"""Unabhängige Referenzrechnung für die Tests von Buchwert und Verkaufsergebnis.

Aufruf: python3 -I referenz_buchwert.py
Exakte Brüche (fractions.Fraction), keine Gleitkommazahlen. Alle Beträge sind erfunden.
Definition: Buchwert = Investiert + Kapitalisiert − Tilgungen − Wertberichtigungen − Abgang;
Abgang = Buchwert × Anteil, auf Cent gerundet (halb auf), bei Anteil 1 der ganze Buchwert.
"""
from fractions import Fraction as F
from math import floor


def cent(x):
    q = F(x) * 100
    n = floor(q + F(1, 2))
    s = f"{abs(n):03d}"
    return ("-" if n < 0 else "") + s[:-2] + "." + s[-2:]


print("== A Buchwert Darlehen ==")
inv, kap, til, wb, abg = F(500000), F("12345.67"), F(100000), F("50000.50"), F(0)
bw = inv + kap - til - wb - abg
print("buchwert", cent(bw))

print("== B Teilverkauf 0,333333 von 437345,17 (Rundung) ==")
b = F("437345.17")
abgang = F(cent(b * F("0.333333")))
print("abgang", cent(abgang), "rest", cent(b - abgang))
erl = F(200000) - F(5000)
print("erloes", cent(erl), "ergebnis", cent(erl - abgang))

print("== C Vollverkauf mit Verlust ==")
b = F("750000")
print("ergebnis", cent(F(600000) - F(10000) - b))

print("== D Anteil 0,5 mit Wertberichtigung ==")
bw = F(400000) - F(150000)
print("buchwert", cent(bw), "abgang", cent(bw * F("0.5")), "ergebnis", cent(F(300000) - bw * F("0.5")))
