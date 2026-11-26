"""Unabhängige Referenzrechnung für Wechselkurse und Währungssichten (Etappe 21).

Aufruf: python3 -I referenz_waehrung.py
Exakte Brüche (fractions.Fraction), Beträge auf Cent gerundet, kaufmännisch (halb weg von null). Alle Kurse und Beträge sind erfunden.

Die Regeln sind dieselben wie in `src/waehrung.ts`, der Aufbau der Rechnung ist ein anderer: Hier werden die Kurse als gerichtete Kanten eines Graphen gelesen
(jeder Eintrag ergibt eine Kante basis -> quote mit dem Faktor `kurs` und eine Rückkante mit `1 / kurs`), und der Weg von einer Währung zur anderen wird
über diesen Graphen gesucht, statt in drei Schritten (gleich, direkt oder invers, über EUR) wie im Kern.

  Kurs                1 Einheit `basis` = `kurs` Einheiten `quote` (Stil der EZB-Referenzkurse: Basis EUR)
  Wahl eines Kurses   der jüngste Eintrag mit Datum <= Stichtag; ist er älter als `max_alter` Tage, fehlt der Kurs (Lücke), nie ein geschätzter Wert
  Wahl bei Gleichstand direkt vor invers, der jüngere Tag vor dem älteren
  Weg                 gleiche Währung -> Faktor 1; sonst direkte oder umgekehrte Kante; sonst über EUR (zwei Kanten); sonst Lücke
  Umrechnung          Betrag * Faktor, erst am Ende auf Cent gerundet (nie in Zwischenschritten)
  Zerlegung           Änderung des Fondswerts = Wertänderung (in lokaler Währung, zum neuen Kurs) + Währungseffekt (alter lokaler Wert * Kursänderung);
                      der Währungseffekt ist der Rest zur gerundeten Gesamtänderung, damit beide Teile genau die Gesamtänderung ergeben
"""
import json
from datetime import date
from fractions import Fraction as F
from math import floor


def cent_zahl(x):
    x = F(x)
    n = floor(abs(x) * 100 + F(1, 2))
    return -n if x < 0 else n


def cent(x):
    n = cent_zahl(x)
    s = f"{abs(n):03d}"
    return ("-" if n < 0 else "") + s[:-2] + "." + s[-2:]


def tage(a, b):
    return (date.fromisoformat(a) - date.fromisoformat(b)).days


def kanten(kurse, von, nach, stichtag, max_alter):
    """Beste Kante von -> nach (direkt oder umgekehrt) oder (None, grund)."""
    kandidaten = []
    for k in kurse:
        if k["datum"] > stichtag:
            continue
        if k["basis"] == von and k["quote"] == nach:
            kandidaten.append((k["datum"], 1, k, F(k["kurs"]), "direkt"))
        elif k["basis"] == nach and k["quote"] == von:
            kandidaten.append((k["datum"], 0, k, 1 / F(k["kurs"]), "invers"))
    if not kandidaten:
        return None, "kein_kurs"
    kandidaten.sort(key=lambda c: (c[0], c[1]), reverse=True)
    datum, _, k, faktor, art = kandidaten[0]
    if tage(stichtag, datum) > max_alter:
        return None, "veraltet"
    return {"datum": datum, "faktor": faktor, "art": art, "kurs": k["kurs"]}, None


def weg(kurse, von, nach, stichtag, max_alter=7):
    if von == nach:
        return {"ok": True, "faktor": F(1), "weg": "gleich", "kurs_datum": stichtag}
    k, grund = kanten(kurse, von, nach, stichtag, max_alter)
    if k:
        return {"ok": True, "faktor": k["faktor"], "weg": k["art"], "kurs_datum": k["datum"]}
    if von != "EUR" and nach != "EUR":
        a, ga = kanten(kurse, von, "EUR", stichtag, max_alter)
        b, gb = kanten(kurse, "EUR", nach, stichtag, max_alter)
        if a and b:
            return {"ok": True, "faktor": a["faktor"] * b["faktor"], "weg": "ueber_eur", "kurs_datum": min(a["datum"], b["datum"])}
    return {"ok": False, "grund": grund}


def umrechnen(betrag, w):
    return cent(F(betrag) * w["faktor"]) if w["ok"] else None


def zerlege(alt_lokal, neu_lokal, kurs_alt, kurs_neu):
    """Kurse als Fondswährung je lokaler Einheit."""
    fonds_alt = cent_zahl(F(alt_lokal) * F(kurs_alt))
    fonds_neu = cent_zahl(F(neu_lokal) * F(kurs_neu))
    gesamt = fonds_neu - fonds_alt
    wert = cent_zahl((F(neu_lokal) - F(alt_lokal)) * F(kurs_neu))
    return {"gesamt": cent(F(gesamt, 100)), "wert": cent(F(wert, 100)), "waehrung": cent(F(gesamt - wert, 100)), "fonds_alt": cent(F(fonds_alt, 100)), "fonds_neu": cent(F(fonds_neu, 100))}


def sichten(posten, kontext):
    """Ein Posten in den drei Sichten: (fonds, lokal, vergleich), None = Lücke."""
    fonds_w, lokal_w, vergleich_w = kontext["fonds"], kontext["lokal"], kontext["vergleich"]
    datum = posten["datum"]
    fonds = F(posten["fonds"])

    def aus(nach):
        w = weg(kontext["kurse"], fonds_w, nach, datum)
        return cent(fonds * w["faktor"]) if w["ok"] else None

    if posten["lokal"] is not None:
        lokal = cent(posten["lokal"])
    elif lokal_w == fonds_w:
        lokal = cent(fonds)
    else:
        lokal = aus(lokal_w)
    if vergleich_w is None:
        vergleich = None
    elif vergleich_w == fonds_w:
        vergleich = cent(fonds)
    elif vergleich_w == lokal_w and lokal is not None:
        vergleich = lokal
    else:
        vergleich = aus(vergleich_w)
    return {"fonds": cent(fonds), "lokal": lokal, "vergleich": vergleich}


KURSE = [
    {"datum": "2026-09-28", "basis": "EUR", "quote": "USD", "kurs": "1.0850"},
    {"datum": "2026-09-30", "basis": "EUR", "quote": "USD", "kurs": "1.1000"},
    {"datum": "2026-09-30", "basis": "EUR", "quote": "GBP", "kurs": "0.8600"},
    {"datum": "2026-06-30", "basis": "EUR", "quote": "GBP", "kurs": "0.8500"},
    {"datum": "2026-09-29", "basis": "GBP", "quote": "USD", "kurs": "1.2800"},
    {"datum": "2026-03-31", "basis": "EUR", "quote": "CHF", "kurs": "0.9700"},
]

# Umrechnungen: (Betrag, von, nach, Stichtag)
UMRECHNUNGEN = [
    ("1000.00", "USD", "EUR", "2026-09-30"),   # invers
    ("1000.00", "EUR", "USD", "2026-09-30"),   # direkt
    ("1000.00", "EUR", "USD", "2026-09-29"),   # älterer Tag (28.09.), zwei Tage alt
    ("2500.55", "GBP", "USD", "2026-09-30"),   # direkter Eintrag GBP/USD vom Vortag
    ("2500.55", "USD", "GBP", "2026-09-30"),   # direkter Eintrag, umgekehrt
    ("1234.56", "USD", "GBP", "2026-09-28"),   # kein GBP/USD vor dem 29.09., EUR/GBP nur Juni: Lücke
    ("999.99", "CHF", "USD", "2026-04-02"),    # über EUR: CHF/EUR vom 31.03., EUR/USD fehlt vor dem 28.09.: Lücke
    ("1.00", "EUR", "EUR", "2026-09-30"),      # gleiche Währung
    ("0.01", "USD", "EUR", "2026-09-30"),      # Rundung: 0,01 / 1,10 = 0,00909 -> 0,01
    ("0.50", "EUR", "USD", "2026-09-28"),      # 0,50 * 1,0850 = 0,5425 -> 0,54
    ("-2.50", "EUR", "GBP", "2026-09-30"),     # negativ, 2,50 * 0,86 = 2,15
    ("100.00", "EUR", "GBP", "2026-07-03"),    # 3 Tage nach dem 30.06.: gültig
    ("100.00", "EUR", "GBP", "2026-07-08"),    # 8 Tage: veraltet
    ("12345.67", "GBP", "EUR", "2026-09-30"),  # invers mit unendlicher Dezimalfolge
]

ZERLEGUNGEN = [
    ("100000.00", "120000.00", "0.90909091", "0.8700"),
    ("100000.00", "100000.00", "0.9000", "0.8700"),
    ("250000.00", "180000.00", "1.1000", "1.2500"),
    ("0.00", "50000.00", "0.9000", "0.9500"),
    ("33333.33", "44444.44", "0.9123", "0.9234"),
]

SICHTEN = [
    # (Datum, Fondsbetrag, gebuchter lokaler Betrag, lokale Währung, Vergleichswährung)
    ("2026-09-30", "100000.00", None, "USD", "GBP"),      # lokal aus der Fondswährung (USD), Vergleich über EUR/GBP
    ("2026-09-30", "100000.00", "108123.45", "USD", "USD"),  # gebuchter lokaler Betrag, Vergleich = lokal
    ("2026-09-30", "55555.55", None, "EUR", "GBP"),       # lokal = Fonds
    ("2026-07-20", "100000.00", None, "USD", "GBP"),      # EUR/USD vom 28.09. liegt nach dem Tag: Lücke in lokal und Vergleich
    ("2026-09-30", "250.25", None, "GBP", None),          # ohne Vergleichswährung
    ("2026-09-30", "99999.99", "100.00", "EUR", "EUR"),   # lokale Währung = Fondswährung: gebuchter lokaler Betrag gilt trotzdem
]

if __name__ == "__main__":
    ergebnis = {"umrechnungen": [], "zerlegungen": [], "sichten": []}
    for datum, fonds, lokal, lokal_w, vergleich_w in SICHTEN:
        r = sichten({"datum": datum, "fonds": fonds, "lokal": lokal}, {"fonds": "EUR", "lokal": lokal_w, "vergleich": vergleich_w, "kurse": KURSE})
        ergebnis["sichten"].append({"datum": datum, "fonds": fonds, "lokal": lokal, "lokalWaehrung": lokal_w, "vergleichsWaehrung": vergleich_w, **{f"erg_{k}": v for k, v in r.items()}})
    for betrag, von, nach, stichtag in UMRECHNUNGEN:
        w = weg(KURSE, von, nach, stichtag)
        ergebnis["umrechnungen"].append(
            {
                "betrag": betrag, "von": von, "nach": nach, "stichtag": stichtag,
                "ergebnis": umrechnen(betrag, w), "weg": w.get("weg"), "kursDatum": w.get("kurs_datum"), "luecke": None if w["ok"] else w["grund"],
            }
        )
    for alt, neu, ka, kn in ZERLEGUNGEN:
        ergebnis["zerlegungen"].append({"alt": alt, "neu": neu, "kursAlt": ka, "kursNeu": kn, **zerlege(alt, neu, ka, kn)})
    print(json.dumps(ergebnis, indent=2, ensure_ascii=False))
