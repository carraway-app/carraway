"""Unabhängige Referenzrechnung für die Tests von Kapitalverlauf, Zinsrechnung, Zinslauf und Wandlung.

Aufruf: python3 -I referenz_zinsen.py
Exakte Brüche (fractions.Fraction), kein TypeScript, keine Gleitkommazahlen. Alle Beträge und Daten sind erfunden.
Die Ausgabe wird in die Tests übernommen (Zinsen ungerundet auf 8 Nachkommastellen, Buchungen auf Cent).
Definitionen: siehe Kopfkommentar in src/zinsrechnung.ts.
"""
from fractions import Fraction as F
from datetime import date
from math import floor


def d(s):
    return date.fromisoformat(s)


def tage_30e(a, b):
    a, b = d(a), d(b)
    return (b.year - a.year) * 360 + (b.month - a.month) * 30 + (min(b.day, 30) - min(a.day, 30))


def tage_act(a, b):
    return (d(b) - d(a)).days


def anteil(a, b, m):
    if m == "30E/360":
        return F(tage_30e(a, b), 360)
    if m == "act/365":
        return F(tage_act(a, b), 365)
    raise ValueError(m)


def r8(x):
    """Auf 8 Nachkommastellen, halb auf."""
    q = F(x) * 10**8
    n = floor(q + F(1, 2))
    s = f"{abs(n):09d}"
    return ("-" if n < 0 else "") + s[:-8] + "." + s[-8:]


def cent(x):
    q = F(x) * 100
    n = floor(q + F(1, 2))
    return f"{n // 100}.{n % 100:02d}"


def stand(bew, tag):
    """Kapital am Tag (Bewegungen am Tag gelten ab dem Tag)."""
    k = F(0)
    for dat, art, b in bew:
        if d(dat) <= d(tag):
            k += F(b) * (-1 if art == "tilgung" else 1)
    return k


def segmente(bew, von, bis):
    schnitte = sorted({von, bis} | {x[0] for x in bew if d(von) < d(x[0]) < d(bis)}, key=d)
    return [(a, b, stand(bew, a)) for a, b in zip(schnitte, schnitte[1:])]


def fix(bew, von, bis, satz, m):
    return sum(k * F(satz) * anteil(a, b, m) for a, b, k in segmente(bew, von, bis))


def gewinn_jahr(bew, von, bis, jahr, satz, ju, kappung):
    """f * min(satz*JÜ, kappung*Durchschnittskapital) für den Teil des Fensters im Kalenderjahr."""
    a = max(d(von), date(jahr, 1, 1)).isoformat()
    b = min(d(bis), date(jahr + 1, 1, 1)).isoformat()
    t = tage_act(a, b)
    jahrestage = tage_act(f"{jahr}-01-01", f"{jahr + 1}-01-01")
    avg = sum(k * tage_act(x, y) for x, y, k in segmente(bew, a, b)) / t
    return F(t, jahrestage) * min(F(satz) * F(ju), F(kappung) * avg), avg


print("== A Kapitalverlauf / B Zinsrechnung ==")
bewA = [("2026-01-01", "auszahlung", 100000), ("2026-04-01", "auszahlung", 50000),
        ("2026-07-01", "tilgung", 30000), ("2026-10-01", "kapitalisierung", 2000)]
for a, b, k in segmente(bewA, "2026-01-01", "2027-01-01"):
    print("segment", a, b, k, "30E-tage", tage_30e(a, b), "act-tage", tage_act(a, b))
print("fix 30E 5%:", r8(fix(bewA, "2026-01-01", "2027-01-01", "0.05", "30E/360")))
print("fix act365 5%:", r8(fix(bewA, "2026-01-01", "2027-01-01", "0.05", "act/365")))
for ju in (40000, 300000):
    g, avg = gewinn_jahr(bewA, "2026-01-01", "2027-01-01", 2026, "0.10", ju, "0.08")
    print("gewinn JÜ", ju, r8(g), "avg", r8(avg), "ungekappt", r8(F("0.10") * ju), "kappung", r8(F("0.08") * avg))

print("== C Zinslauf quartalsweise 30E/360, 6 % ==")
bewC = [("2026-01-01", "auszahlung", 100000), ("2026-04-15", "auszahlung", 50000)]
perC = [("2026-01-01", "2026-03-31"), ("2026-03-31", "2026-06-30"), ("2026-06-30", "2026-09-30"), ("2026-09-30", "2026-12-31")]
for a, b in perC:
    z = fix(bewC, a, b, "0.06", "30E/360")
    print("periode", a, b, "tage", tage_30e(a, b), r8(z), cent(z))

print("== D Zinslauf jährlich act/365, 4 %, Beginn 2026-03-15 ==")
bewD = [("2026-03-15", "auszahlung", 80000)]
for a, b in [("2026-03-15", "2026-12-31"), ("2026-12-31", "2027-12-31")]:
    z = fix(bewD, a, b, "0.04", "act/365")
    print("periode", a, b, "tage", tage_act(a, b), r8(z), cent(z))

print("== E Kapitalisierung zwei Perioden, jährlich, 30E/360, 8 % ==")
k = F(200000)
for a, b in [("2025-01-01", "2026-01-01"), ("2026-01-01", "2027-01-01")]:
    z = k * F("0.08") * anteil(a, b, "30E/360")
    print("periode", a, b, "kapital", k, r8(z), cent(z))
    k += F(cent(z))

print("== F Kapitalisierung quartalsweise act/365, 5 % ==")
k = F(100000)
for a, b in [("2026-01-01", "2026-04-01"), ("2026-04-01", "2026-07-01")]:
    z = k * F("0.05") * anteil(a, b, "act/365")
    print("periode", a, b, "kapital", r8(k), r8(z), cent(z))
    k += F(cent(z))

print("== G Zinslauf mit Gewinnanteil, Q1 2026 ==")
bewG = [("2026-01-01", "auszahlung", 100000)]
fx = fix(bewG, "2026-01-01", "2026-04-01", "0.05", "30E/360")
g, avg = gewinn_jahr(bewG, "2026-01-01", "2026-04-01", 2026, "0.10", 60000, "0.08")
print("fix", r8(fx), "tage30", tage_30e("2026-01-01", "2026-04-01"), "gewinn", r8(g), "gesamt", r8(fx + g), cent(fx + g))
print("  ungekappt*f", r8(F(90, 365) * F("0.10") * 60000), "kappung*f", r8(F(90, 365) * F("0.08") * 100000))

print("== H Abgrenzung, quartalsweise Anker 31.03., Stichtag 2026-11-15, 30E/360, 6 % ==")
for a, b in [("2026-09-30", "2026-11-15")]:
    print(a, b, "tage", tage_30e(a, b), r8(fix(bewC, a, b, "0.06", "30E/360")))
print("Abgrenzung vor erster Periode: 2026-01-01 bis 2026-02-20 (Stichtag)", tage_30e("2026-01-01", "2026-02-20"),
      r8(fix(bewC, "2026-01-01", "2026-02-20", "0.06", "30E/360")))

print("== I Wandlung, 100000, 6 %, 30E/360, 2026-01-01 bis 2026-07-01 ==")
zi = fix([("2026-01-01", "auszahlung", 100000)], "2026-01-01", "2026-07-01", "0.06", "30E/360")
print("zinsen", r8(zi), cent(zi))
betrag = 100000 + F(cent(zi))
preis = min(F("12.5") * (1 - F("0.2")), F(4000000, 500000))
p1 = F("12.5") * F("0.8")
a1 = floor(betrag / p1)
print("I1 nur Rabatt: preis", float(p1), "betrag", betrag, "anteile", a1, "spitz", float(betrag - a1 * p1),
      "agio", float(betrag - a1 - (betrag - a1 * p1)))
a2 = floor(betrag / preis)
sp2 = betrag - a2 * preis
print("I2 Bewertungsgrenze 4 Mio / 500000 =", preis, "anteile", a2, "spitz", float(sp2), "agio", float(betrag - a2 - sp2))
p3 = F(3650000, 500000)
a3 = floor(100000 / p3)
sp3 = 100000 - a3 * p3
print("I3 Zinsen ausgezahlt, preis", float(p3), "anteile", a3, "spitz", float(sp3), "agio", float(100000 - a3 - sp3),
      "zinsen", cent(zi))
