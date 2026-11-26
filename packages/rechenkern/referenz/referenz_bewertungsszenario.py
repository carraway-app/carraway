"""Unabhängige Referenzrechnung für Bewertungsszenarien (Etappe 21).

Aufruf: python3 -I referenz_bewertungsszenario.py
Exakte Brüche (fractions.Fraction), Beträge kaufmännisch (halb weg von null) auf Cent, Kennzahlen auf vier Stellen. Alle Beträge und Namen sind erfunden.

Die Regeln sind dieselben wie in `src/bewertungsszenario.ts`, der Aufbau der Rechnung ist ein anderer: Hier wird zuerst für jeden Fall der Fondswert bestimmt (Fall für Fall über
alle Beteiligungen), der Erwartungswert danach über die Gewichte; der Kern rechnet dagegen je Beteiligung und leitet die Fondswerte daraus ab.

  Multiple      max(0, Kennzahl * Multiple - Abzug) * Anteil
                steht die Kennzahl in Fremdwährung: max(0, Kennzahl * Multiple - Abzug) * Zähler / Nenner * Anteil (Kurs des Basistags als Bruch; fehlt der Kurs: Lücke)
  Letzte Runde  Preis * Anteile * (1 - Abschlag)
  Wert          Betrag
  Erwartet      Summe Gewicht * Fallwert (Gewichte summieren sich genau auf 1), erst am Ende gerundet
  Fonds         NAV(Fall) = NAV - Summe aktuell(Beteiligungen mit Fällen) + Summe Fallwert (Beteiligung ohne den Fall: aktueller Wert)
                TVPI = (NAV + Ausschüttungen) / Einzahlungen, DPI = Ausschüttungen / Einzahlungen, RVPI = NAV / Einzahlungen
                Carry-Vorschau = Satz * max(0, Ausschüttungen + NAV - Abrufe), NAV netto = NAV - Carry-Vorschau
  Lücke         fehlt eine Eingabe, hat der Fall keinen Wert (None); alles, was darauf beruht, ebenso
"""
import json
from fractions import Fraction as F
from math import floor


def runde(x, stellen):
    x = F(x)
    n = floor(abs(x) * 10**stellen + F(1, 2))
    return F(-n if x < 0 else n, 10**stellen)


def text(x, stellen):
    return None if x is None else f"{runde(x, stellen):.{stellen}f}"


def fall_wert(m):
    if m["art"] == "wert":
        return runde(m["betrag"], 2)
    if m["art"] == "letzte_runde":
        if m["preis"] is None or m["anteile"] is None:
            return None
        return runde(F(m["preis"]) * F(m["anteile"]) * (1 - F(m["abschlag"])), 2)
    if m["kennzahl"] is None or m["anteil"] is None or m.get("umrechnung") == "luecke":
        return None
    unternehmen = max(F(0), F(m["kennzahl"]) * F(m["multiple"]) - F(m["abzug"]))
    u = m.get("umrechnung")
    if u:
        unternehmen = unternehmen * F(u["zaehler"]) / F(u["nenner"])
    return runde(unternehmen * F(m["anteil"]), 2)


def unternehmenswert(m):
    """Wert des ganzen Unternehmens als Eingabe des Exit-Wasserfalls (None: Lücke oder fester Wert)."""
    if m["art"] == "wert":
        return None
    if m["art"] == "letzte_runde":
        if m["preis"] is None or m.get("gesamt") is None:
            return None
        return runde(F(m["preis"]) * F(m["gesamt"]) * (1 - F(m["abschlag"])), 2)
    if m["kennzahl"] is None or m.get("umrechnung") == "luecke":
        return None
    wert = max(F(0), F(m["kennzahl"]) * F(m["multiple"]) - F(m["abzug"]))
    u = m.get("umrechnung")
    if u:
        wert = wert * F(u["zaehler"]) / F(u["nenner"])
    return runde(wert, 2)


def rechne(fall):
    nav = None if fall["nav"] is None else F(fall["nav"])
    aus, abr, satz = F(fall["aus"]), F(fall["abgerufen"]), F(fall["carry"])
    eingezahlt = F(fall.get("eingezahlt", abr))
    holdings = fall["beteiligungen"]
    for h in holdings:
        for f in h["faelle"]:
            f["wert"] = fall_wert(f["methode"])
        if h["faelle"]:
            assert sum(F(f["gewicht"]) for f in h["faelle"]) == 1
    mit = [h for h in holdings if h["faelle"]]
    summe_aktuell = sum((F(h["aktuell"]) for h in mit), F(0))

    def fonds(n):
        if n is None:
            return {k: None for k in ("nav", "tvpi", "dpi", "rvpi", "carry", "navNetto")}
        carry = runde(satz * max(F(0), aus + n - abr), 2)
        return {
            "nav": text(n, 2),
            "tvpi": None if eingezahlt == 0 else text((n + aus) / eingezahlt, 4),
            "dpi": None if eingezahlt == 0 else text(aus / eingezahlt, 4),
            "rvpi": None if eingezahlt == 0 else text(n / eingezahlt, 4),
            "carry": text(carry, 2),
            "navNetto": text(runde(n, 2) - carry, 2),
        }

    schluessel = []
    for h in mit:
        for f in h["faelle"]:
            if f["schluessel"] not in schluessel:
                schluessel.append(f["schluessel"])
    faelle = []
    for k in schluessel:
        werte, luecke = [], False
        for h in mit:
            treffer = [f for f in h["faelle"] if f["schluessel"] == k]
            if not treffer:
                werte.append(F(h["aktuell"]))
            elif treffer[0]["wert"] is None:
                luecke = True
            else:
                werte.append(treffer[0]["wert"])
        faelle.append({"schluessel": k, **fonds(None if luecke or nav is None else nav - summe_aktuell + sum(werte, F(0)))})

    erwartet = {}
    for h in mit:
        if any(f["wert"] is None for f in h["faelle"]):
            erwartet[h["id"]] = None
        else:
            erwartet[h["id"]] = runde(sum((F(f["gewicht"]) * f["wert"] for f in h["faelle"]), F(0)), 2)
    nav_erwartet = None if nav is None or any(v is None for v in erwartet.values()) else nav - summe_aktuell + sum(erwartet.values(), F(0))
    return {
        "exitwerte": {h["id"]: {f["schluessel"]: text(unternehmenswert(f["methode"]), 2) for f in h["faelle"]} for h in holdings},
        "beteiligungen": [
            {
                "id": h["id"],
                "aktuell": text(h["aktuell"], 2),
                "erwartet": text(erwartet.get(h["id"]), 2),
                "abweichung": None if erwartet.get(h["id"]) is None else text(erwartet[h["id"]] - F(h["aktuell"]), 2),
                "faelle": [{"schluessel": f["schluessel"], "wert": text(f["wert"], 2)} for f in h["faelle"]],
            }
            for h in holdings
        ],
        "aktuell": fonds(nav),
        "faelle": faelle,
        "erwartet": fonds(nav_erwartet),
    }


def m_wert(betrag):
    return {"art": "wert", "betrag": betrag}


def m_runde(preis, anteile, abschlag="0", gesamt=None):
    m = {"art": "letzte_runde", "preis": preis, "anteile": anteile, "abschlag": abschlag}
    if gesamt is not None:
        m["gesamt"] = gesamt
    return m


def m_mult(kennzahl, multiple, abzug="0", anteil=None, umrechnung=None):
    m = {"art": "multiple", "kennzahl": kennzahl, "multiple": multiple, "abzug": abzug, "anteil": anteil}
    if umrechnung is not None:
        m["umrechnung"] = umrechnung
    return m


FAELLE = {
    # A: zwei Beteiligungen mit je drei Fällen, alle Methoden, Aufschlag und Abschlag
    "A": {
        "nav": "5000000.00", "aus": "400000.00", "abgerufen": "3000000.00", "carry": "0.2",
        "beteiligungen": [
            {"id": "b1", "aktuell": "1500000.00", "faelle": [
                {"schluessel": "bear", "gewicht": "0.25", "methode": m_wert("900000.00")},
                {"schluessel": "base", "gewicht": "0.5", "methode": m_runde("12.3456", "100000", "0.1")},
                {"schluessel": "bull", "gewicht": "0.25", "methode": m_mult("2400000.00", "3.5", "500000.00", "0.18")},
            ]},
            {"id": "b2", "aktuell": "800000.00", "faelle": [
                {"schluessel": "bear", "gewicht": "0.3", "methode": m_runde("7.77", "90000", "0.5")},
                {"schluessel": "base", "gewicht": "0.45", "methode": m_runde("7.77", "90000", "-0.1")},
                {"schluessel": "bull", "gewicht": "0.25", "methode": m_wert("1500000.00")},
            ]},
            {"id": "b3", "aktuell": "2700000.00", "faelle": []},
        ],
    },
    # B: Gewichte mit Nachkommastellen, die Rundung am Ende des Erwartungswerts entscheidet; eine Beteiligung hat nur zwei Fälle, ein Fall fehlt dem anderen
    "B": {
        "nav": "1234567.89", "aus": "0.00", "abgerufen": "1000000.00", "carry": "0.15",
        "beteiligungen": [
            {"id": "x", "aktuell": "600000.00", "faelle": [
                {"schluessel": "base", "gewicht": "0.333333", "methode": m_wert("700000.01")},
                {"schluessel": "bull", "gewicht": "0.333333", "methode": m_wert("950000.99")},
                {"schluessel": "bear", "gewicht": "0.333334", "methode": m_wert("100000.00")},
            ]},
            {"id": "y", "aktuell": "634567.89", "faelle": [
                {"schluessel": "base", "gewicht": "0.7", "methode": m_mult("1000000", "1.5", "0", "0.4")},
                {"schluessel": "bear", "gewicht": "0.3", "methode": m_mult("1000000", "0.5", "800000", "0.4")},
            ]},
        ],
    },
    # C: Lücken (Kennzahl und Runde fehlen): der Fall, der Erwartungswert der Beteiligung und die Fondskennzahlen haben keinen Wert
    "C": {
        "nav": "2000000.00", "aus": "100000.00", "abgerufen": "1500000.00", "carry": "0.2",
        "beteiligungen": [
            {"id": "p", "aktuell": "1200000.00", "faelle": [
                {"schluessel": "base", "gewicht": "0.6", "methode": m_wert("1300000.00")},
                {"schluessel": "bull", "gewicht": "0.4", "methode": m_mult(None, "4", "0", "0.1")},
            ]},
            {"id": "q", "aktuell": "800000.00", "faelle": [
                {"schluessel": "base", "gewicht": "0.5", "methode": m_wert("850000.00")},
                {"schluessel": "bear", "gewicht": "0.5", "methode": m_runde(None, None)},
            ]},
        ],
    },
    # D: ohne Abrufe keine Multiples; Verlust (NAV unter Abrufen) ergibt keinen Carry; Unternehmenswert unter null wird auf null begrenzt
    "D": {
        "nav": "300000.00", "aus": "0.00", "abgerufen": "0.00", "carry": "0.2",
        "beteiligungen": [
            {"id": "m", "aktuell": "300000.00", "faelle": [
                {"schluessel": "base", "gewicht": "0.5", "methode": m_mult("100000", "2", "500000", "0.5")},
                {"schluessel": "bull", "gewicht": "0.5", "methode": m_wert("400000.50")},
            ]},
        ],
    },
    # F: Multiples auf Kennzahlen in Fremdwährung (Nacharbeiten 9): USD direkt (1 / 1,0850), GBP über EUR in einen USD-Fonds (1,0850 / 0,8600), ein fehlender Kurs ergibt eine Lücke,
    #    Abzug in der Währung der Kennzahl, ein Unternehmenswert unter null bleibt null, der Kurs ändert nur den Fall mit Fremdwährung
    "F": {
        "nav": "4000000.00", "aus": "200000.00", "abgerufen": "2500000.00", "carry": "0.2",
        "beteiligungen": [
            {"id": "u", "aktuell": "900000.00", "faelle": [
                {"schluessel": "base", "gewicht": "0.6", "methode": m_mult("3000000.00", "8", "4000000.00", "0.12", {"zaehler": "1", "nenner": "1.0850"})},
                {"schluessel": "bull", "gewicht": "0.4", "methode": m_mult("3000000.00", "8", "4000000.00", "0.12")},
            ]},
            {"id": "v", "aktuell": "1100000.00", "faelle": [
                {"schluessel": "base", "gewicht": "0.7", "methode": m_mult("1250000.50", "6.5", "1000000.00", "0.2", {"zaehler": "1.0850", "nenner": "0.8600"})},
                {"schluessel": "bull", "gewicht": "0.3", "methode": m_mult("2000000", "10", "0", "0.2", {"zaehler": "1.0850", "nenner": "0.8600"})},
            ]},
            {"id": "w", "aktuell": "500000.00", "faelle": [
                {"schluessel": "base", "gewicht": "0.5", "methode": m_mult("800000", "3", "5000000", "0.3", {"zaehler": "1", "nenner": "1.1000"})},
                {"schluessel": "bull", "gewicht": "0.5", "methode": m_mult("800000", "9", "0", "0.3", "luecke")},
            ]},
        ],
    },
    # G: Unternehmenswert für den Exit-Wasserfall (Nacharbeiten 9): Multiple mit und ohne Fremdwährung, letzte Runde mit Aufschlag und Abschlag, fester Wert (keiner), Lücken
    "G": {
        "nav": "3000000.00", "aus": "0.00", "abgerufen": "2000000.00", "carry": "0.2",
        "beteiligungen": [
            {"id": "g1", "aktuell": "1000000.00", "faelle": [
                {"schluessel": "base", "gewicht": "0.5", "methode": m_mult("5000000", "4", "2500000", "0.2")},
                {"schluessel": "bull", "gewicht": "0.5", "methode": m_mult("5000000", "4", "2500000", "0.2", {"zaehler": "1", "nenner": "1.0850"})},
            ]},
            {"id": "g2", "aktuell": "2000000.00", "faelle": [
                {"schluessel": "base", "gewicht": "0.5", "methode": m_runde("12.3456", "100000", "0.1", "850000")},
                {"schluessel": "bull", "gewicht": "0.25", "methode": m_runde("12.3456", "100000", "-0.2", "850000")},
                {"schluessel": "bear", "gewicht": "0.25", "methode": m_wert("900000.00")},
            ]},
        ],
    },
    # E: Verlustfall bei Abrufen: Carry-Vorschau null
    "E": {
        "nav": "900000.00", "aus": "50000.00", "abgerufen": "2000000.00", "carry": "0.2",
        "beteiligungen": [
            {"id": "n", "aktuell": "900000.00", "faelle": [
                {"schluessel": "base", "gewicht": "0.5", "methode": m_wert("800000.00")},
                {"schluessel": "bull", "gewicht": "0.5", "methode": m_wert("1700000.00")},
            ]},
        ],
    },
}

if __name__ == "__main__":
    print(json.dumps({k: rechne(json.loads(json.dumps(v))) for k, v in FAELLE.items()}, indent=2, ensure_ascii=False))
