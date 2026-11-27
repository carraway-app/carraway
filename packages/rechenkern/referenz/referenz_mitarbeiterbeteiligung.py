"""Unabhängige Referenzrechnung für die Mitarbeiterbeteiligung (Vesting, Pool, Preis je Anteil voll verwässert).

Aufruf: python3 -I referenz_mitarbeiterbeteiligung.py
Exakte Brüche, Monate über einen Kalender-Zähler statt über Differenzen. Alle Zahlen sind erfunden. Regeln wie in
`src/mitarbeiterbeteiligung.ts`:

  Volle Monate  Ab `von` wird Monat für Monat weitergezählt; ein Monat ist voll, wenn `bis` den gleichen Tag des Folgemonats erreicht
                (gibt es den Tag nicht, das Monatsende).
  Vesting       vor dem Cliff 0, danach abgerundet(Anzahl × min(1, M ÷ Dauer)) mit M = volle Monate abgerundet auf ein Vielfaches
                des Takts (1, 3, 6 oder 12 Monate, Standard 1); Dauer 0 = alles.
  Exit          gevestet + abgerundet(ungevestet × Beschleunigung).
  Austritte     je Austritt i ab A_i: gB_i = gevestet(B_i, A_i) friert ein, B_i − gB_i verfällt; gB_i bleibt, verfällt oder wird
                zurückgekauft (Betrag = gB_i × Preis, ohne Preis der Basispreis); Σ B_i ≤ Anzahl. Die übrigen Anzahl − Σ B_i (Austritte bis
                zum Stichtag) vesten weiter (eine Abrundung).
  Pool          Größe = Σ Änderungen bis Stichtag; ausstehend = Zuteilungen bis Stichtag ohne verfallen/ausgeübt (ab deren Datum);
                frei = max(0, Größe − ausstehend − ausgeübt).
  Grob          ausstehend = min(vergeben, max(0, Größe)), frei = max(0, Größe − ausstehend).
  Runde         Preis = Pre-Money ÷ (Anteile vorher + Pool vorher + Aufstockung Pre-Money); neue Anteile = abgerundet(Volumen ÷ Preis).
"""
from fractions import Fraction as F
from datetime import date
from calendar import monthrange
from math import floor


def plus_monate(d, n):
    j, m = divmod(d.month - 1 + n, 12)
    jahr, monat = d.year + j, m + 1
    return date(jahr, monat, min(d.day, monthrange(jahr, monat)[1]))


def volle_monate(von, bis):
    a, b = date.fromisoformat(von), date.fromisoformat(bis)
    n = 0
    while plus_monate(a, n + 1) <= b:
        n += 1
    return n


def gevestet(anzahl, beginn, cliff, dauer, stichtag, takt=1):
    if date.fromisoformat(stichtag) < date.fromisoformat(beginn):
        return 0
    if dauer == 0:
        return anzahl
    m = volle_monate(beginn, stichtag)
    if m < cliff:
        return 0
    stufen = (m // takt) * takt
    return floor(F(anzahl) * min(F(1), F(stufen, dauer)))


def beim_exit(anzahl, beginn, cliff, dauer, beschleunigung, exitdatum):
    g = gevestet(anzahl, beginn, cliff, dauer, exitdatum)
    return g + floor((anzahl - g) * F(beschleunigung))


def aufteilung(anzahl, beginn, cliff, dauer, stichtag, austritte=(), basispreis=0):
    """(gevestet, ungevestet, verfallen, rueckgekauft, betrag); austritte = Liste von (datum, betroffen, regel, preis oder None)."""
    assert sum(a[1] for a in austritte) <= anzahl, "mehr betroffene Einheiten als zugeteilt"
    gelten = [a for a in austritte if date.fromisoformat(a[0]) <= date.fromisoformat(stichtag)]
    uebrige = anzahl - sum(a[1] for a in gelten)
    gu = gevestet(uebrige, beginn, cliff, dauer, stichtag)
    g, verf, rk, betrag = gu, 0, 0, F(0)
    for austritt, b, regel, preis in gelten:
        gb = gevestet(b, beginn, cliff, dauer, austritt)
        if regel == "bleiben":
            g, verf = g + gb, verf + b - gb
        elif regel == "verfallen":
            verf += b
        else:
            verf, rk = verf + b - gb, rk + gb
            betrag += gb * F(preis if preis is not None else basispreis)
    return g, uebrige - gu, verf, rk, betrag


def pool_grob(groesse, vergeben):
    aus = min(vergeben, max(0, groesse))
    return aus, max(0, groesse - aus)


def runde(pre, volumen, vorher, pool, auf_pre=0, auf_post=0):
    preis = F(pre) / (F(vorher) + F(pool) + F(auf_pre))
    neu = floor(F(volumen) / preis)
    pool_nach = F(pool) + F(auf_pre) + F(auf_post)
    voll = F(vorher) + neu + pool_nach
    return preis, neu, voll, F(neu) / voll


if __name__ == "__main__":
    # Vesting 4 Jahre, 1 Jahr Cliff, 48.000 Einheiten ab 15.01.2024
    for st in ["2024-12-31", "2025-01-14", "2025-01-15", "2026-07-31", "2028-01-15", "2030-01-01"]:
        print("vesting", st, gevestet(48000, "2024-01-15", 12, 48, st))
    print("monate 2024-01-31 → 2024-02-29", volle_monate("2024-01-31", "2024-02-29"))
    print("monate 2024-01-31 → 2024-02-28", volle_monate("2024-01-31", "2024-02-28"))
    print("exit halb beschleunigt 2026-07-31", beim_exit(48000, "2024-01-15", 12, 48, "0.5", "2026-07-31"))
    print("exit voll beschleunigt vor Cliff", beim_exit(10000, "2026-03-01", 12, 48, "1", "2026-07-31"))
    # Leaver: 48.000 ab 15.01.2024, Austritt 31.07.2026 (30 volle Monate), Stichtag 01.01.2027
    print("good bleiben", aufteilung(48000, "2024-01-15", 12, 48, "2027-01-01", [("2026-07-31", 48000, "bleiben", None)]))
    print("bad verfallen", aufteilung(48000, "2024-01-15", 12, 48, "2027-01-01", [("2026-07-31", 48000, "verfallen", None)]))
    print("vor Austritt", aufteilung(48000, "2024-01-15", 12, 48, "2026-07-30", [("2026-07-31", 48000, "verfallen", None)]))
    print("vor dem Cliff", aufteilung(48000, "2024-01-15", 12, 48, "2027-01-01", [("2024-12-31", 48000, "bleiben", None)]))
    # Teilverfall: 100.000 aggregiert, 10.000 betroffen, Austritt 31.07.2026, Stichtag 15.01.2027 (36 volle Monate)
    t = aufteilung(100000, "2024-01-15", 12, 48, "2027-01-15", [("2026-07-31", 10000, "bleiben", None)])
    print("teilverfall", t, "exit voll beschleunigt", t[0] + floor(t[1] * F(1)))
    print("rueckkauf basispreis 2", aufteilung(100000, "2024-01-15", 12, 48, "2027-01-15", [("2026-07-31", 10000, "rueckkauf", None)], basispreis=2))
    print("rueckkauf zu 0,5", aufteilung(100000, "2024-01-15", 12, 48, "2027-01-15", [("2026-07-31", 10000, "rueckkauf", "0.5")], basispreis=2))
    # Mehrere Austritte aus 100.000 (Basispreis 2): 10.000 Good Leaver am 31.07.2026 (30 Monate), 5.000 Bad Leaver am 10.03.2025
    # (13 Monate), 7.000 Rückkauf zu 1,25 am 20.11.2025 (22 Monate); Stichtag 15.01.2027 (36 Monate)
    mehrere = [("2026-07-31", 10000, "bleiben", None), ("2025-03-10", 5000, "verfallen", None), ("2025-11-20", 7000, "rueckkauf", "1.25")]
    m = aufteilung(100000, "2024-01-15", 12, 48, "2027-01-15", mehrere, basispreis=2)
    print("mehrere", m, "exit voll beschleunigt", m[0] + floor(m[1] * F(1)))
    print("mehrere vor dem zweiten", aufteilung(100000, "2024-01-15", 12, 48, "2025-06-30", mehrere, basispreis=2))
    print("mehrere vor allen", aufteilung(100000, "2024-01-15", 12, 48, "2025-03-09", mehrere, basispreis=2))
    print("alle ausgeschieden", aufteilung(30000, "2024-01-15", 12, 48, "2027-01-15", [("2026-07-31", 20000, "bleiben", None), ("2025-11-20", 10000, "rueckkauf", None)], basispreis=2))
    # Takt: 48.000 ab 15.01.2024, 48 Monate, Cliff 12; Stichtag 14.10.2026 = 32 volle Monate
    for takt in [1, 3, 6, 12]:
        print("takt", takt, gevestet(48000, "2024-01-15", 12, 48, "2026-10-14", takt))
    print("takt 12 am Cliff", gevestet(48000, "2024-01-15", 12, 48, "2025-01-15", 12))
    print("grob", pool_grob(100000, 60000), pool_grob(50000, 60000), pool_grob(-10, 5))
    # Runde: 9 Mio Pre-Money, 3 Mio Volumen, 1 Mio Anteile, 50.000 Pool, Aufstockung im Pre-Money um 100.000
    preis, neu, voll, anteil = runde("9000000", "3000000", "1000000", "50000", "100000")
    print("runde pre preis", preis, float(preis), "neu", neu, "voll", voll, "anteil", float(anteil))
    preis, neu, voll, anteil = runde("9000000", "3000000", "1000000", "50000", 0, "100000")
    print("runde post preis", preis, float(preis), "neu", neu, "voll", voll, "anteil", float(anteil))
