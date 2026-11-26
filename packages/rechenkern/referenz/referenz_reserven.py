"""Unabhängige Referenzrechnung für die Reserven und den verfügbaren Betrag (Etappe 18).

Aufruf: python3 -I referenz_reserven.py
Exakte Brüche (fractions.Fraction), kaufmännisch auf Cent gerundet. Alle Beträge und Namen sind erfunden.

Die Regeln sind dieselben wie in `src/reserven.ts`, der Aufbau der Rechnung ist ein anderer: Hier wird zuerst der Betrag bestimmt, den
jede Beteiligung noch bindet, danach der Fonds von oben nach unten abgetragen.

  gebunden je Beteiligung  nur status == "aktiv": max(0, geplant − verbraucht), sonst 0
  belegt                   das Größere aus abgerufen und investiert
  verfügbar                Zeichnungskapital − belegt − Summe gebunden − Gebührenprognose (kann negativ sein)
"""
import json
from fractions import Fraction as F
from math import floor


def cent(x):
    n = floor(F(x) * 100 + F(1, 2))
    s = f"{abs(n):03d}"
    return ("-" if n < 0 else "") + s[:-2] + "." + s[-2:]


def rechne(fall):
    zeichnung = F(fall["zeichnung"])
    abgerufen = F(fall["abgerufen"])
    investiert = F(fall["investiert"])
    gebuehren = F(fall["gebuehren"])
    gebunden = {}
    geplant_summe = F(0)
    for r in fall["reserven"]:
        rest = F(r["geplant"]) - F(r["verbraucht"])
        gebunden[r["id"]] = rest if (r["status"] == "aktiv" and rest > 0) else F(0)
        geplant_summe += F(r["geplant"])
    gebunden_summe = sum(gebunden.values(), F(0))
    belegt = abgerufen if abgerufen >= investiert else investiert
    verfuegbar = zeichnung - belegt - gebunden_summe - gebuehren
    return {
        "zeilen": [{"id": r["id"], "geplant": cent(r["geplant"]), "verbraucht": cent(r["verbraucht"]), "offen": cent(gebunden[r["id"]])} for r in fall["reserven"]],
        "summe_geplant": cent(geplant_summe),
        "summe_offen": cent(gebunden_summe),
        "belegt": cent(belegt),
        "gebuehren": cent(gebuehren),
        "verfuegbar": cent(verfuegbar),
    }


FAELLE = {
    # Abrufe größer als investiert, eine Reserve teilweise verbraucht, eine ganz verbraucht (kein negativer Rest)
    "A": {
        "zeichnung": "10000000", "abgerufen": "2500000", "investiert": "2300000", "gebuehren": "300000.50",
        "reserven": [
            {"id": "b1", "status": "aktiv", "geplant": "1000000", "verbraucht": "250000.25"},
            {"id": "b2", "status": "aktiv", "geplant": "400000", "verbraucht": "450000"},
        ],
    },
    # investiert größer als abgerufen; ein Unternehmen im Exit bindet nichts; Cent-Beträge
    "B": {
        "zeichnung": "5000000.00", "abgerufen": "1200000.10", "investiert": "1250000.33", "gebuehren": "0",
        "reserven": [
            {"id": "x", "status": "exit", "geplant": "300000.99", "verbraucht": "0"},
            {"id": "y", "status": "aktiv", "geplant": "200000.07", "verbraucht": "100000.01"},
            {"id": "z", "status": "insolvent", "geplant": "50000", "verbraucht": "10000"},
        ],
    },
    # Verfügbar negativ: Reserven und Gebühren übersteigen das freie Zeichnungskapital
    "C": {
        "zeichnung": "1000000", "abgerufen": "700000", "investiert": "650000", "gebuehren": "150000",
        "reserven": [{"id": "n", "status": "aktiv", "geplant": "400000", "verbraucht": "50000.50"}],
    },
    # Ohne Reserven: verfügbar = Zeichnungskapital − belegt − Gebühren
    "D": {"zeichnung": "2000000", "abgerufen": "0", "investiert": "0", "gebuehren": "0", "reserven": []},
}

if __name__ == "__main__":
    print(json.dumps({k: rechne(v) for k, v in FAELLE.items()}, indent=1))
