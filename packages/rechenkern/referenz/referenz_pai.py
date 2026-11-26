"""Unabhängige Referenzrechnung für die Tests der Nachhaltigkeitsindikatoren (`pai.ts`).

Aufruf: python3 -I referenz_pai.py [faelle.json]
Liest die Fälle aus `pai_faelle.json` (erfundene Zahlen) und gibt je Fall und Indikatorzeile Wert, Abdeckung und Schätzanteil als
Zeichenketten mit 12 Nachkommastellen aus (kaufmännisch gerundet), exakt gerechnet mit Brüchen (fractions.Fraction), ohne Gleitkommazahlen.

Definitionen (Anhang I Tabelle 1 der Delegierten Verordnung (EU) 2022/1288, vereinfacht für die Tests):
  W_i(q)  aktueller Wert der Beteiligung i zum Quartalsende q, W(q) = Summe aller W_i(q)
  absolut      Summe W_i / EVIC_i * E_i                        (Emissionen, nur Unternehmen mit E_i und EVIC_i > 0)
  fussabdruck  Summe W_i / EVIC_i * E_i / (W / 1.000.000)
  intensitaet  Summe W_i * (E_i / (Umsatz_i / 1.000.000)) / W   (Unternehmen mit Umsatz_i > 0)
  anteil       Summe W_i * [Eigenschaft ja] / W * 100            (Unternehmen mit Angabe)
  mittel       Summe W_i * x_i / Summe W_i (nur Unternehmen mit Angabe)
  energie      je Sektor: Summe W_i * (GWh_i / (Umsatz_i / 1.000.000)) / Summe W_i (Unternehmen des Sektors mit Angabe und Umsatz_i > 0)
  Auswirkung des Jahres = Durchschnitt der Quartale mit Wert; Abdeckung = Summe W_i mit Daten / W (Sektor: Summe W_i des Sektors), Durchschnitt der
  Quartale mit Bestand; Schätzanteil = Summe W_i mit geschätzten Eingaben / Summe W_i mit Daten, Durchschnitt der Quartale mit Daten.
"""
import json
import sys
from fractions import Fraction as F
from pathlib import Path

MIO = F(1_000_000)
SEKTOREN = ["A", "B", "C", "D", "E", "F", "G", "H", "L"]
S = ["esg_thg_scope1", "esg_thg_scope2", "esg_thg_scope3"]

# (code, formel, eingaben, nur_zusatz)
METRIKEN = [
    ("t1_01_scope1", "absolut", [S[0]], False),
    ("t1_01_scope2", "absolut", [S[1]], False),
    ("t1_01_scope3", "absolut", [S[2]], False),
    ("t1_01_gesamt", "absolut", S, False),
    ("t1_02", "fussabdruck", S, False),
    ("t1_03", "intensitaet", S, False),
    ("t1_04", "anteil", ["esg_fossile_brennstoffe"], False),
    ("t1_05", "mittel", ["esg_nicht_erneuerbare_energie_anteil"], False),
    ("t1_06", "energie", ["esg_energieverbrauch_gwh"], False),
    ("t1_07", "anteil", ["esg_biodiversitaet"], False),
    ("t1_08", "fussabdruck", ["esg_emissionen_wasser"], False),
    ("t1_09", "fussabdruck", ["esg_gefaehrliche_abfaelle"], False),
    ("t1_10", "anteil", ["esg_verstoesse_ungc"], False),
    ("t1_11", "anteil", ["esg_prozesse_ungc_fehlen"], False),
    ("t1_12", "mittel", ["esg_lohngefaelle_unbereinigt"], False),
    ("t1_13", "mittel", ["esg_frauenanteil_leitung"], False),
    ("t1_14", "anteil", ["esg_umstrittene_waffen"], False),
    ("t2_04", "anteil", ["esg_zus_ohne_reduktionsinitiativen"], True),
    ("t3_06", "anteil", ["esg_zus_hinweisgeberschutz"], True),
    ("t3_15", "anteil", ["esg_zus_antikorruption"], True),
]


def fix(x, stellen=12):
    """Kaufmännisch auf `stellen` Nachkommastellen gerundet, als Zeichenkette."""
    if x is None:
        return None
    skala = 10 ** stellen
    v = x * skala
    vorzeichen = -1 if v < 0 else 1
    v = abs(v)
    ganz = v.numerator // v.denominator
    if v - ganz >= F(1, 2):
        ganz += 1
    ganz *= vorzeichen
    text = str(abs(ganz)).rjust(stellen + 1, "0")
    r = f"{text[:-stellen]}.{text[-stellen:]}"
    return ("-" if ganz < 0 else "") + r


def zahl(daten, k):
    d = daten.get(k)
    if d is None or d[0] in ("ja", "nein"):
        return None
    return F(d[0])


def flag(daten, k):
    d = daten.get(k)
    if d is None or d[0] not in ("ja", "nein"):
        return None
    return d[0] == "ja"


def schaetzt(daten, k):
    d = daten.get(k)
    return bool(d and d[1])


def quartal(m, sektor, fall, q):
    code, formel, eingaben, _ = m
    pos = [(b, F(b["wert"][q])) for b in fall["beteiligungen"] if F(b["wert"][q]) > 0]
    gesamt = sum((v for _, v in pos), F(0))
    if gesamt <= 0:
        return None
    if formel == "energie":
        pos = [(b, v) for b, v in pos if b["nace"] == sektor]
        nenner = sum((v for _, v in pos), F(0))
        if nenner <= 0:
            return None
    else:
        nenner = gesamt
    beitraege = []  # (v, term, geschaetzt)
    for b, v in pos:
        d = b["daten"]
        evic = zahl(d, "esg_evic")
        umsatz = zahl(d, "umsatz")
        ge = any(schaetzt(d, k) for k in eingaben)
        if formel == "anteil":
            f = flag(d, eingaben[0])
            if f is None:
                continue
            beitraege.append((v, v if f else F(0), ge))
            continue
        werte = [zahl(d, k) for k in eingaben]
        if any(w is None for w in werte):
            continue
        e = sum(werte, F(0))
        if formel == "mittel":
            beitraege.append((v, v * e, ge))
        elif formel in ("absolut", "fussabdruck"):
            if evic is None or evic <= 0:
                continue
            beitraege.append((v, v / evic * e, ge or schaetzt(d, "esg_evic")))
        else:  # intensitaet, energie
            if umsatz is None or umsatz <= 0:
                continue
            beitraege.append((v, v * (e / (umsatz / MIO)), ge or schaetzt(d, "umsatz")))
    gedeckt = sum((v for v, _, _ in beitraege), F(0))
    abdeckung = gedeckt / nenner
    geschaetzt_wert = sum((v for v, _, g in beitraege if g), F(0))
    schaetz = geschaetzt_wert / gedeckt if gedeckt > 0 else None
    wert = None
    if beitraege:
        s = sum((t for _, t, _ in beitraege), F(0))
        if formel == "absolut":
            wert = s
        elif formel == "fussabdruck":
            wert = s / (gesamt / MIO)
        elif formel == "intensitaet":
            wert = s / gesamt
        elif formel == "anteil":
            wert = s / gesamt * 100
        else:
            wert = s / gedeckt
    return wert, abdeckung, schaetz


def mittel(liste):
    liste = [x for x in liste if x is not None]
    return sum(liste, F(0)) / len(liste) if liste else None


def fall_rechnen(fall):
    ergebnis = {}
    for m in METRIKEN:
        code, formel, eingaben, nur_zusatz = m
        if nur_zusatz and eingaben[0] not in fall["zusatz"]:
            continue
        sektoren = [None]
        if formel == "energie":
            sektoren = [s for s in SEKTOREN if any(b["nace"] == s and any(F(w) > 0 for w in b["wert"]) for b in fall["beteiligungen"])]
        for sektor in sektoren:
            qs = [quartal(m, sektor, fall, q) for q in range(4)]
            werte = [q[0] for q in qs if q is not None and q[0] is not None]
            abd = [q[1] for q in qs if q is not None]
            sch = [q[2] for q in qs if q is not None and q[2] is not None]
            name = code if sektor is None else f"{code}_{sektor.lower()}"
            ergebnis[name] = {
                "wert": fix(mittel(werte)),
                "abdeckung": fix(mittel(abd)),
                "schaetzanteil": fix(mittel(sch)),
            }
    return ergebnis


def main():
    pfad = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("pai_faelle.json")
    faelle = json.loads(pfad.read_text())["faelle"]
    print(json.dumps({f["name"]: fall_rechnen(f) for f in faelle}, indent=2, ensure_ascii=False))


main()
