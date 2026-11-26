"""Unabhängige Referenzrechnung für die Fondsprognose (Etappe 18).

Aufruf: python3 -I referenz_prognose.py
Exakte Brüche (fractions.Fraction), der IRR mit Gleitkomma und Intervallhalbierung. Alle Beträge und Namen sind erfunden.

Die Regeln sind dieselben wie in `src/prognose.ts`, der Aufbau der Rechnung ist ein anderer: Hier entsteht zuerst je Beteiligung ein
Plan (Wertansatz, Abrufe und Erlös je Jahr), danach wird über die Jahre aufsummiert.

  Perioden   Kalenderjahre ab dem Jahr des Basistags bis zum Endjahr, Zahlungen am 31.12.
  Gebühren   Satz × Basis × Faktor bis einschließlich bis_jahr; Basis Zeichnungskapital oder Kostenbasis der gehaltenen Beteiligungen
             zu Jahresbeginn (Ausstiege entfallen mit dem Ausstiegsjahr); Faktor im ersten Jahr Tage bis 31.12. ÷ 365 (höchstens 1).
             Dazu sonstige Kosten je Jahr mit demselben Faktor.
  Ausstieg   erwarteter Erlös = Wahrscheinlichkeit × Erlös. Wertpfad linear: max(0, W0 + (E − W0) × k ÷ K) plus Folgeinvestitionen,
             k = Jahr − Basisjahr + 1, K = Ausstiegsjahr − Basisjahr + 1; im Ausstiegsjahr 0; konstant: W0 plus Folgeinvestitionen.
  Carry      kumuliert = Satz × max(0, Ausschüttungen brutto kum. − Abrufe kum.); Anfangsstand gilt als abgerechnet; Jahrescarry =
             Zuwachs, nie negativ. NAV netto = NAV − max(0, Satz × max(0, Ausschüttungen kum. + NAV − Abrufe kum.) − Carry kum.).
  IRR        XIRR act/365 über alle Zahlungen bis zum Jahr plus NAV (netto bzw. brutto) am Jahresende.
"""
import json
from datetime import date
from fractions import Fraction as F
from math import floor


def cent(x):
    n = floor(F(x) * 100 + F(1, 2))
    s = f"{abs(n):03d}"
    return ("-" if n < 0 else "") + s[:-2] + "." + s[-2:]


def vier(x):
    if x is None:
        return None
    n = floor(F(x) * 10000 + F(1, 2))
    s = f"{abs(n):05d}"
    return ("-" if n < 0 else "") + s[:-4] + "." + s[-4:]


def xirr(stroeme):
    stroeme = sorted(stroeme)
    if not any(b < 0 for _, b in stroeme) or not any(b > 0 for _, b in stroeme):
        return None
    t0 = date.fromisoformat(stroeme[0][0])
    pts = [((date.fromisoformat(d) - t0).days / 365, float(b)) for d, b in stroeme]

    def f(r):
        return sum(c / (1 + r) ** t for t, c in pts)

    lo, hi = -0.99, 10.0
    if f(lo) * f(hi) > 0:
        return None
    for _ in range(300):
        mid = (lo + hi) / 2
        if f(lo) * f(mid) <= 0:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


def rechne(fall):
    basis = date.fromisoformat(fall["basis"])
    by = basis.year
    ey = fall["end"]
    jahre = list(range(by, ey + 1))
    zeich = F(fall["zeichnung"])
    carry_satz = F(fall["carry"])
    faktor = {j: F(1) for j in jahre}
    faktor[by] = min(F(1), F((date(by, 12, 31) - basis).days, 365))

    plan = {}
    for b in fall["beteiligungen"]:
        w0 = F(b["wert"])
        ex = b.get("ausstieg")
        p = {"wert": {}, "abruf": {}, "erloes": {}, "kosten": {}}
        for j in jahre:
            folge_bis = sum(F(a) for (jj, a) in b["folge"] if jj <= j and (ex is None or jj < ex["jahr"]))
            if ex is None:
                w = w0 + folge_bis
            elif j >= ex["jahr"]:
                w = F(0)
            elif fall["pfad"] == "konstant":
                w = w0 + folge_bis
            else:
                e = F(ex["erloes"]) * F(ex["p"])
                k, kk = j - by + 1, ex["jahr"] - by + 1
                w = max(F(0), w0 + (e - w0) * k / kk) + folge_bis
            p["wert"][j] = w
            p["abruf"][j] = sum(F(a) for (jj, a) in b["folge"] if jj == j and (ex is None or jj <= ex["jahr"]))
            p["erloes"][j] = F(ex["erloes"]) * F(ex["p"]) if ex and ex["jahr"] == j else F(0)
            if ex is not None and ex["jahr"] < j:
                p["kosten"][j] = F(0)
            else:
                p["kosten"][j] = F(b["investiert"]) + sum(F(a) for (jj, a) in b["folge"] if jj < j)
        plan[b["id"]] = p

    abger = F(fall["abgerufen"])
    eingezahlt = F(fall.get("eingezahlt", abger))
    aus = F(fall["aus"])
    aus_brutto = aus
    carry_kum = carry_satz * max(F(0), aus_brutto - abger)
    inv_kum = F(fall["inv_bisher"])
    rueck_kum = F(fall["rueck_bisher"])
    strom_f = [(s[0], F(s[1])) for s in fall["strom_fonds"]]
    strom_b = [(s[0], F(s[1])) for s in fall["strom_brutto"]]
    ergebnis = []
    for j in jahre:
        invest = sum((p["abruf"][j] for p in plan.values()), F(0))
        g = fall["gebuehren"]
        if g["bis"] is None or j <= g["bis"]:
            bas = zeich if g["basis"] == "zeichnung" else sum((p["kosten"][j] for p in plan.values()), F(0))
            gebuehr = (F(g["satz"]) * bas + F(g["sonstige"])) * faktor[j]
        else:
            gebuehr = F(0)
        erloes = sum((p["erloes"][j] for p in plan.values()), F(0))
        abruf = invest + gebuehr
        abger += abruf
        eingezahlt += abruf
        aus_brutto += erloes
        neu = carry_satz * max(F(0), aus_brutto - abger)
        carry = max(F(0), neu - carry_kum)
        carry_kum += carry
        netto = erloes - carry
        aus += netto
        inv_kum += invest
        rueck_kum += erloes
        d = f"{j}-12-31"
        if abruf != 0:
            strom_f.append((d, -abruf))
        if netto != 0:
            strom_f.append((d, netto))
        if invest != 0:
            strom_b.append((d, -invest))
        if erloes != 0:
            strom_b.append((d, erloes))
        nav = F(fall["nav_sonstiges"]) + sum((p["wert"][j] for p in plan.values()), F(0))
        unreal = carry_satz * max(F(0), aus_brutto + nav - abger) - carry_kum
        nav_n = nav - max(F(0), unreal)
        irr_n = xirr(strom_f + [(d, nav_n)])
        irr_b = xirr(strom_b + [(d, nav)])
        ergebnis.append({
            "jahr": j,
            "invest": cent(invest),
            "gebuehren": cent(gebuehr),
            "erloes": cent(erloes),
            "carry": cent(carry),
            "nav": cent(nav),
            "nav_netto": cent(nav_n),
            "abgerufen_kum": cent(abger),
            "aus_kum": cent(aus),
            "dpi": vier(aus / eingezahlt) if eingezahlt else None,
            "tvpi": vier((aus + nav_n) / eingezahlt) if eingezahlt else None,
            "tvpi_brutto": vier((rueck_kum + nav) / inv_kum) if inv_kum else None,
            "irr_netto": None if irr_n is None else round(irr_n, 8),
            "irr_brutto": None if irr_b is None else round(irr_b, 8),
        })
    return ergebnis


FAELLE = {
    "A": {
        "basis": "2026-06-30", "end": 2029, "zeichnung": "10000000", "abgerufen": "4000000", "aus": "0", "nav_sonstiges": "0",
        "inv_bisher": "3500000", "rueck_bisher": "0", "pfad": "linear", "carry": "0.2",
        "strom_fonds": [["2024-01-15", "-2000000"], ["2025-03-31", "-2000000"]],
        "strom_brutto": [["2024-02-01", "-1500000"], ["2025-04-15", "-2000000"]],
        "beteiligungen": [
            {"id": "b1", "wert": "2500000", "investiert": "2000000", "folge": [[2027, "500000"]], "ausstieg": {"jahr": 2028, "erloes": "8000000", "p": "0.5"}},
            {"id": "b2", "wert": "1000000", "investiert": "1500000", "folge": [], "ausstieg": {"jahr": 2029, "erloes": "3000000", "p": "1"}},
            {"id": "b3", "wert": "300000", "investiert": "0", "folge": [], "ausstieg": None},
        ],
        "gebuehren": {"basis": "investiert", "satz": "0.02", "bis": 2028, "sonstige": "50000"},
    },
    "B": {
        "basis": "2026-12-31", "end": 2028, "zeichnung": "5000000", "abgerufen": "1000000", "aus": "200000", "nav_sonstiges": "50000",
        "inv_bisher": "900000", "rueck_bisher": "200000", "pfad": "konstant", "carry": "0",
        "strom_fonds": [["2025-06-30", "-1000000"], ["2026-06-30", "200000"]],
        "strom_brutto": [["2025-07-01", "-900000"], ["2026-07-01", "200000"]],
        "beteiligungen": [
            {"id": "x", "wert": "800000", "investiert": "900000", "folge": [[2027, "100000"]], "ausstieg": {"jahr": 2028, "erloes": "2000000", "p": "1"}},
        ],
        "gebuehren": {"basis": "zeichnung", "satz": "0.015", "bis": None, "sonstige": "0"},
    },
}

if __name__ == "__main__":
    print(json.dumps({k: rechne(v) for k, v in FAELLE.items()}, indent=1))
