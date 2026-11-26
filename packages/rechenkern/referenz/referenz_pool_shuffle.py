"""Unabhängige Referenzrechnung für den Option Pool Shuffle (Aufstockung des Pools zu einer Runde mit Zielgröße).

Aufruf: python3 -I referenz_pool_shuffle.py
Exakte Brüche. Statt der geschlossenen Formel aus `src/pool-shuffle.ts` sucht diese Rechnung die kleinste ganze Aufstockung X, mit der
der Pool nach der Runde mindestens die Zielgröße t der voll verwässerten Anteile erreicht (Bisektion über ganze Zahlen). Alle Zahlen erfunden.

  Pre-Money   Preis = Pre ÷ (A + P + X); N = abgerundet(V ÷ Preis); Pool nach = P + X; voll verwässert = A + P + X + N.
  Post-Money  Preis = Pre ÷ (A + P);     N = abgerundet(V ÷ Preis); Pool nach = P + X; voll verwässert = A + P + X + N.
  Effektive Pre-Money = Preis × (A + P).
"""
from fractions import Fraction as F
from math import floor


def runde(pre, v, a, p, x, basis):
    preis = pre / (a + p + (x if basis == "pre" else 0))
    n = floor(v / preis)
    return preis, n, p + x, a + p + x + n


def reicht(pre, v, a, p, t, x, basis):
    _, _, pool, voll = runde(pre, v, a, p, x, basis)
    return pool >= t * voll


def kleinste_aufstockung(pre, v, a, p, t, basis):
    if reicht(pre, v, a, p, t, 0, basis):
        return 0
    lo, hi = 0, 1
    while not reicht(pre, v, a, p, t, hi, basis):
        hi *= 2
    while hi - lo > 1:
        mitte = (lo + hi) // 2
        if reicht(pre, v, a, p, t, mitte, basis):
            hi = mitte
        else:
            lo = mitte
    return hi


def fall(name, pre, v, a, p, t, basis):
    pre, v, a, p, t = F(pre), F(v), F(a), F(p), F(t)
    x = kleinste_aufstockung(pre, v, a, p, t, basis)
    preis, n, pool, voll = runde(pre, v, a, p, x, basis)
    print(name, "aufstockung", x, "preis", float(preis), "neu", n, "pool", pool, "voll", voll, "anteil", float(pool / voll), "effektiv", float(preis * (a + p)))


if __name__ == "__main__":
    fall("pre", "9000000", "3000000", "1000000", "50000", "0.15", "pre")
    fall("post", "9000000", "3000000", "1000000", "50000", "0.15", "post")
    fall("pre-ohne-pool", "4000000", "1000000", "800000", "0", "0.1", "pre")
    fall("pre-krumm", "7777777", "2345678", "1234567", "33333", "0.125", "pre")
    fall("post-krumm", "7777777", "2345678", "1234567", "33333", "0.125", "post")
    fall("schon-erreicht", "9000000", "3000000", "1000000", "300000", "0.15", "pre")
