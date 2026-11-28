"""Unabhängige Referenzrechnung für den Exit-Wasserfall (Etappe 10).

Aufruf: python3 -I referenz_wasserfall.py
Exakte Brüche (fractions.Fraction), keine Gleitkommazahlen. Alle Beträge, Namen und Konditionen sind erfunden.

Die Regeln sind dieselben wie in `src/wasserfall.ts`, der Aufbau der Rechnung ist ein anderer:

  Eingabe   Erlös E (netto nach Kosten, >= 0), Exitdatum, Treuhandanteil s (0 <= s < 1), Klassen, Inhaber (je Zeile eine Position:
            Klasse oder Stammanteile, Anteile, investierter Betrag, Rundendatum).
  Anspruch  je Zeile einer Klasse: investiert × Faktor × (1 + Verzinsung × Tage / 365); Tage = max(0, Exitdatum − Rundendatum), einfache
            Verzinsung auf den Präferenzbetrag (Faktor × investiert), act/365. Ohne Verzinsung oder Rundendatum: kein Zins.
  Rangfolge Rang 1 ist die höchste. Eine Rangstufe wird erst bedient, wenn alle höheren voll bedient sind; innerhalb einer Stufe
            anteilig nach Anspruch (pari passu). Wer umwandelt, hat keinen Anspruch.
  Rest      Der Rest nach allen Präferenzen geht je Anteil an den Pool: Stammanteile, umgewandelte Klassen und partizipierende
            Klassen, die nicht umwandeln. Der Cap einer partizipierenden Klasse (cap_faktor × investiert, je Zeile) begrenzt den
            Gesamtrückfluss aus Präferenz und Beteiligung; der Beteiligungsspielraum ist max(0, Cap − Präferenz). Was ein Cap
            übrig lässt, verteilen die übrigen Poolzeilen weiter. Ein Rest, den niemand beanspruchen kann (leerer Pool oder alle am
            Cap), ist „nicht verteilt“ und wird nicht zugeteilt.
  Umwandlung Je Klasse (umwandelbar = wahr) wird entschieden, nicht je Zeile. Wer umwandelt, hat keine Präferenz und keinen Cap und
            teilt als Stammanteil. Eine Klasse wandelt nur, wenn ihr Rückfluss dadurch STRENG größer wird (gleich = keine Umwandlung),
            gemessen mit den Entscheidungen der übrigen Klassen als gegeben. Stabil ist eine Menge W gewandelter Klassen, wenn für
            jede umwandelbare Klasse c gilt: c in W ⇒ Rückfluss(c, W) > Rückfluss(c, W ohne c); c nicht in W ⇒ Rückfluss(c, W mit c) <=
            Rückfluss(c, W). Die Referenz probiert ALLE Mengen durch und verlangt genau eine stabile Menge je Fall.
  Mitarbeiter Zeilen mit Basispreis (ESOP/VSOP, ohne Klasse) bekommen je Einheit max(0, p − Basispreis), p = Betrag je Stammanteil.
            Regel „wie_anteile“: sie teilen den Rest mit den Poolzeilen. Die Referenz probiert ALLE Mengen von Zeilen „im Geld“ durch
            (Basispreis < p), rechnet je Menge p wie oben mit Basispreisen und verlangt genau eine widerspruchsfreie Menge.
            Regel „vor_verteilung“: Preis = Nettoerlös ÷ (reale Anteile aller Klassen + vorab berechtigte Einheiten).
            Die Zahlungen werden vor allen Präferenzen abgezogen. Eine Betragsobergrenze je Einheit begrenzt die Auszahlung
            oberhalb des Basispreises in jeder Regel.
            Regel „anteilig“: erst ohne diese Zeilen verteilen (p0, nach Vorabzahlung verteilt D), dann jede Kombination aus
            „aus dem Geld“, „im Geld“ und „am Cap“ durchprobieren. Für die Zahlung C der Zeilen am Cap und Menge M der übrigen
            Zeilen im Geld gilt f = (D − C + Σ_M n·K) ÷ (D + p0 · Σ_M n). Die nachrangigen Rückflüsse werden mit f malgenommen.
  Rundung   Alle Beträge sind bis dahin exakt. Die Teile (Präferenz und Beteiligung je Zeile, in dieser Reihenfolge, Zeilen in
            Eingabereihenfolge) werden auf Cent nach der Methode des größten Rests gerundet: abgerundete Cent plus je ein Cent an die
            größten Reste (Gleichstand: kleinerer Index), die Summe ist der auf Cent gerundete (halb auf) Gesamtbetrag der Teile.
            Gesamt = Präferenz + Beteiligung (gerundet). Treuhand je Zeile: dasselbe Verfahren für Gesamt × s, Summe = auf Cent
            gerundet (halb auf) die Summe der Teile; Sofort = Gesamt − Treuhand. Multiple = Gesamt ÷ investiert, vier Stellen halb auf.
"""
from fractions import Fraction as F
from itertools import combinations, product
from datetime import date
from math import floor


def cent_text(x):
    q = F(x) * 100
    n = floor(q + F(1, 2))
    s = f"{abs(n):03d}"
    return ("-" if n < 0 else "") + s[:-2] + "." + s[-2:]


def vier_stellen(x):
    n = floor(F(x) * 10000 + F(1, 2))
    s = f"{abs(n):05d}"
    return ("-" if n < 0 else "") + s[:-4] + "." + s[-4:]


def tage(von, bis):
    return max(0, (date.fromisoformat(bis) - date.fromisoformat(von)).days)


def klasse_von(fall, kid):
    return next((k for k in fall["klassen"] if k["id"] == kid), None)


def anspruch(fall, h):
    k = klasse_von(fall, h["klasse"])
    if k is None:
        return F(0)
    basis = F(h["investiert"]) * F(k["faktor"])
    zins = F(k.get("zins") or 0)
    t = tage(h["datum"], fall["exitdatum"]) if h.get("datum") else 0
    return basis * (1 + zins * F(t, 365))


def obergrenze(h):
    deckel = h.get("obergrenze")
    return None if deckel is None else F(h["anteile"]) * F(deckel)


def verteile(fall, gewandelt):
    """Zerlegung des Erlöses bei gegebener Menge gewandelter Klassen: (pref, beteiligung, nicht_verteilt, gedeckelt)."""
    E = F(fall["E"])
    pref = {h["id"]: F(0) for h in fall["inhaber"]}
    teil = {h["id"]: F(0) for h in fall["inhaber"]}
    gedeckelt = set()

    # Vorabzahlung anhand des Nettoerlöses je realem Anteil und vorab berechtigter Einheit
    vorab = [h for h in fall["inhaber"] if h.get("regel") == "vor_verteilung" and F(h["anteile"]) > 0]
    if vorab:
        anteile = sum(F(h["anteile"]) for h in fall["inhaber"] if "basispreis" not in h) + sum(F(h["anteile"]) for h in vorab)
        for h in vorab:
            roh = F(h["anteile"]) * max(F(0), E / anteile - F(h["basispreis"]))
            cap = obergrenze(h)
            teil[h["id"]] = roh if cap is None else min(roh, cap)
            if teil[h["id"]] < roh:
                gedeckelt.add(h["id"])
        E -= sum(teil.values())

    # Präferenzen nach Rangstufen
    stufen = {}
    for h in fall["inhaber"]:
        k = klasse_von(fall, h["klasse"])
        if k is not None and k["id"] not in gewandelt:
            stufen.setdefault(k["rang"], []).append((h, anspruch(fall, h)))
    rest = E
    for rang in sorted(stufen):
        summe = sum(a for _, a in stufen[rang])
        zahl = min(rest, summe)
        for h, a in stufen[rang]:
            pref[h["id"]] = zahl * a / summe if summe > 0 else F(0)
        rest -= zahl

    # Pool: (id, Anteile, Spielraum oder None, Basispreis)
    pool = []
    for h in fall["inhaber"]:
        s = F(h["anteile"])
        k = klasse_von(fall, h["klasse"])
        if h.get("regel") in ("anteilig", "vor_verteilung"):
            continue
        if k is None or k["id"] in gewandelt:
            pool.append((h["id"], s, obergrenze(h), F(h.get("basispreis") or 0)))
        elif k["partizipierend"]:
            if k.get("cap") is None:
                pool.append((h["id"], s, None, F(0)))
            else:
                spiel = max(F(0), F(k["cap"]) * F(h["investiert"]) - pref[h["id"]])
                pool.append((h["id"], s, spiel, F(0)))
    pool = [p for p in pool if p[1] > 0]
    nicht_verteilt = F(0)
    preis = None
    if not pool:
        nicht_verteilt = rest
    else:
        preis, _, nicht_verteilt = preis_mit_basispreisen(pool, rest)
        for pid, s, spiel, basis in pool:
            roh = s * max(F(0), preis - basis) if preis is not None else None
            if spiel is not None and (roh is None or roh > spiel):
                teil[pid] = spiel
                gedeckelt.add(pid)
            else:
                teil[pid] = roh
    # Regel „anteilig“
    anteilig = [h for h in fall["inhaber"] if h.get("regel") == "anteilig" and F(h["anteile"]) > 0]
    D = E - nicht_verteilt
    if anteilig and preis is not None and D > 0:
        daten = [(h["id"], F(h["anteile"]), F(h["basispreis"]), obergrenze(h)) for h in anteilig]
        treffer = []
        moeglich = [(0, 1, 2) if cap is not None else (0, 1) for _, _, _, cap in daten]
        for zustaende in product(*moeglich):
            aktiv = [d for d, z in zip(daten, zustaende) if z == 1]
            gedeckelt_summe = sum(cap for (_, _, _, cap), z in zip(daten, zustaende) if z == 2)
            f = (D - gedeckelt_summe + sum(n * basis for _, n, basis, _ in aktiv)) / (D + preis * sum(n for _, n, _, _ in aktiv))
            roh = [n * (preis * f - basis) for _, n, basis, _ in daten]
            if all(z == (0 if r <= 0 else 2 if cap is not None and r > cap else 1)
                   for (_, _, _, cap), z, r in zip(daten, zustaende, roh)):
                treffer.append((f, roh))
        assert len(treffer) == 1, (fall["name"], treffer)
        f, roh = treffer[0]
        for h in fall["inhaber"]:
            if h.get("regel") in ("anteilig", "vor_verteilung"):
                continue
            pref[h["id"]] *= f
            teil[h["id"]] *= f
        for (id, _, _, cap), r in zip(daten, roh):
            teil[id] = max(F(0), r if cap is None else min(r, cap))
            if teil[id] < r:
                gedeckelt.add(id)
    return pref, teil, nicht_verteilt, gedeckelt


def preis_ohne_wahl(pool, rest):
    """Preis je Anteil bei fester Menge aktiver Zeilen (Basispreis zählt), Caps nach Schwelle Basispreis + Spielraum ÷ Anteile."""
    gedeckt = sorted([p for p in pool if p[2] is not None], key=lambda p: (p[3] + p[2] / p[1], p[0]))
    offen_anteile = sum(p[1] for p in pool)
    basis = sum(p[1] * p[3] for p in pool)
    kumuliert = F(0)
    for pid, s, spiel, b in gedeckt:
        if offen_anteile > 0 and (rest - kumuliert + basis) / offen_anteile <= b + spiel / s:
            break
        kumuliert += spiel
        offen_anteile -= s
        basis -= s * b
    if offen_anteile > 0:
        return (rest - kumuliert + basis) / offen_anteile, F(0)
    return None, rest - kumuliert


def preis_mit_basispreisen(pool, rest):
    """Alle Mengen von Zeilen mit Basispreis > 0 „im Geld“ durchprobieren; genau eine ist widerspruchsfrei."""
    mit_basis = [p for p in pool if p[3] > 0]
    ohne_basis = [p for p in pool if p[3] == 0]
    treffer = []
    for n in range(len(mit_basis) + 1):
        for menge in combinations(mit_basis, n):
            aktiv = ohne_basis + list(menge)
            if not aktiv:
                preis, nv = (F(0), F(0)) if rest == 0 else (None, rest)
            else:
                preis, nv = preis_ohne_wahl(aktiv, rest)
            ids = {p[0] for p in menge}
            if preis is None:
                ok = not mit_basis or all(p[0] in ids for p in mit_basis) and all(p[2] is not None for p in mit_basis)
            else:
                ok = all((p[3] < preis) == (p[0] in ids) for p in mit_basis)
            if ok:
                treffer.append((preis, ids, nv))
    assert len(treffer) == 1, treffer
    return treffer[0]


def klassen_rueckfluss(fall, kid, gewandelt):
    pref, teil, _, _ = verteile(fall, gewandelt)
    return sum(pref[h["id"]] + teil[h["id"]] for h in fall["inhaber"] if h["klasse"] == kid)


def stabile_mengen(fall):
    wandelbar = [k["id"] for k in fall["klassen"] if k["umwandelbar"]]
    treffer = []
    for n in range(len(wandelbar) + 1):
        for menge in combinations(wandelbar, n):
            w = set(menge)
            ok = True
            for c in wandelbar:
                if c in w:
                    if not klassen_rueckfluss(fall, c, w) > klassen_rueckfluss(fall, c, w - {c}):
                        ok = False
                else:
                    if not klassen_rueckfluss(fall, c, w | {c}) <= klassen_rueckfluss(fall, c, w):
                        ok = False
            if ok:
                treffer.append(w)
    assert len(treffer) == 1, (fall["name"], treffer)
    return treffer[0]


def runde_groesster_rest(werte):
    """Cent-genaue Rundung mit Summe = Gesamtbetrag der Teile (auf Cent, halb auf)."""
    cents = [w * 100 for w in werte]
    unten = [floor(c) for c in cents]
    ziel = floor(sum(cents) + F(1, 2))
    fehlt = ziel - sum(unten)
    reihenfolge = sorted(range(len(cents)), key=lambda i: (-(cents[i] - unten[i]), i))
    for i in reihenfolge[:fehlt]:
        unten[i] += 1
    return [F(u, 100) for u in unten]


def rechne(fall):
    w = stabile_mengen(fall)
    pref, teil, nicht_verteilt, gedeckelt = verteile(fall, w)
    zeilen = fall["inhaber"]
    teile = []
    for h in zeilen:
        teile += [pref[h["id"]], teil[h["id"]]]
    gerundet = runde_groesster_rest(teile)
    s = F(fall.get("treuhand") or 0)
    gesamt = [gerundet[2 * i] + gerundet[2 * i + 1] for i in range(len(zeilen))]
    treuhand = runde_groesster_rest([g * s for g in gesamt]) if s > 0 else [F(0)] * len(zeilen)
    return w, zeilen, gerundet, gesamt, treuhand, nicht_verteilt, gedeckelt


def drucke(fall):
    w, zeilen, gerundet, gesamt, treuhand, nicht_verteilt, gedeckelt = rechne(fall)
    print(f"== {fall['name']} ==")
    print("gewandelt", ",".join(sorted(w)) or "-")
    for i, h in enumerate(zeilen):
        inv = F(h["investiert"])
        mult = vier_stellen(gesamt[i] / inv) if inv > 0 else "-"
        print(
            h["id"],
            "pref", cent_text(gerundet[2 * i]),
            "teil", cent_text(gerundet[2 * i + 1]),
            "gesamt", cent_text(gesamt[i]),
            "treuhand", cent_text(treuhand[i]),
            "sofort", cent_text(gesamt[i] - treuhand[i]),
            "multiple", mult,
            "gedeckelt", "ja" if h["id"] in gedeckelt else "nein",
        )
    print("nicht_verteilt", cent_text(nicht_verteilt))
    print("summe", cent_text(sum(gesamt)))


def k(id, rang, faktor="1", part=False, cap=None, zins=None, umw=True):
    return dict(id=id, name=id, rang=rang, faktor=faktor, partizipierend=part, cap=cap, zins=zins, umwandelbar=umw)


def h(id, klasse, anteile, investiert="0", datum=None):
    return dict(id=id, name=id, klasse=klasse, anteile=anteile, investiert=investiert, datum=datum)


def m(id, anteile, basispreis, regel="wie_anteile", obergrenze=None):
    """Mitarbeiterbeteiligung: gevestete Einheiten, Basis- oder Ausübungspreis, Regel."""
    zeile = dict(id=id, name=id, klasse=None, anteile=anteile, investiert="0", datum=None, basispreis=basispreis, regel=regel)
    if obergrenze is not None:
        zeile["obergrenze"] = obergrenze
    return zeile


FAELLE = [
    # A: eine nicht partizipierende Klasse, Umwandlung lohnt erst über 10 Mio (Schwelle = Präferenz ÷ Anteil 30 %)
    dict(name="A1 Seriell A 1x nicht partizipierend, Exit 20 Mio (wandelt)", E="20000000", exitdatum="2026-06-30", klassen=[k("SerieA", 1)],
         inhaber=[h("Gruender", None, "7000000"), h("FondsA", "SerieA", "3000000", "3000000", "2024-03-01")]),
    dict(name="A2 dieselbe Struktur, Exit 8 Mio (Präferenz)", E="8000000", exitdatum="2026-06-30", klassen=[k("SerieA", 1)],
         inhaber=[h("Gruender", None, "7000000"), h("FondsA", "SerieA", "3000000", "3000000", "2024-03-01")]),
    dict(name="A3 Gleichstand bei 10 Mio: keine Umwandlung", E="10000000", exitdatum="2026-06-30", klassen=[k("SerieA", 1)],
         inhaber=[h("Gruender", None, "7000000"), h("FondsA", "SerieA", "3000000", "3000000", "2024-03-01")]),
    # B: Exit unter der Summe der Präferenzen, zwei Ränge
    dict(name="B1 Exit unter den Präferenzen: Rang 1 voll, Rang 2 Rest", E="10000000", exitdatum="2026-06-30",
         klassen=[k("SerieB", 1, "1.5"), k("SerieA", 2, "1")],
         inhaber=[h("Gruender", None, "5000000"), h("FondsB", "SerieB", "2500000", "6000000", "2026-01-15"), h("FondsA", "SerieA", "2500000", "4000000", "2024-03-01")]),
    dict(name="B2 Null-Exit", E="0", exitdatum="2026-06-30", klassen=[k("SerieA", 1)],
         inhaber=[h("Gruender", None, "7000000"), h("FondsA", "SerieA", "3000000", "3000000", "2024-03-01")]),
    dict(name="B3 Pari passu: gleicher Rang, Exit unter den Ansprüchen", E="5000000", exitdatum="2026-06-30",
         klassen=[k("SerieA", 1), k("SerieB", 1)],
         inhaber=[h("Gruender", None, "5000000"), h("FondsA", "SerieA", "2000000", "4000000", "2024-03-01"), h("FondsB", "SerieB", "3000000", "6000000", "2025-03-01")]),
    # C: partizipierend
    dict(name="C1 partizipierend ohne Cap, Exit 12 Mio", E="12000000", exitdatum="2026-06-30", klassen=[k("SerieA", 1, "1", True)],
         inhaber=[h("Gruender", None, "8000000"), h("FondsA", "SerieA", "2000000", "2000000", "2024-03-01")]),
    dict(name="C2 partizipierend mit Cap 3x, Cap bindet (Exit 25 Mio)", E="25000000", exitdatum="2026-06-30", klassen=[k("SerieA", 1, "1", True, "3")],
         inhaber=[h("Gruender", None, "8000000"), h("FondsA", "SerieA", "2000000", "2000000", "2024-03-01")]),
    dict(name="C3 partizipierend mit Cap 3x wandelt (Exit 40 Mio)", E="40000000", exitdatum="2026-06-30", klassen=[k("SerieA", 1, "1", True, "3")],
         inhaber=[h("Gruender", None, "8000000"), h("FondsA", "SerieA", "2000000", "2000000", "2024-03-01")]),
    # D: kumulierte Verzinsung, Exit vor Rundendatum
    dict(name="D1 Verzinsung 8 % einfach, 912 Tage, Exit unter Anspruch", E="3900000", exitdatum="2026-07-15",
         klassen=[k("SerieA", 1, "1", False, None, "0.08")],
         inhaber=[h("Gruender", None, "7000000"), h("FondsA", "SerieA", "3000000", "3000000", "2024-01-15")]),
    dict(name="D2 Exitdatum vor Rundendatum: keine negativen Zinsen", E="2000000", exitdatum="2024-01-01",
         klassen=[k("SerieA", 1, "1", False, None, "0.08")],
         inhaber=[h("Gruender", None, "7000000"), h("FondsA", "SerieA", "3000000", "3000000", "2024-01-15")]),
    # E: zwei Klassen mit verschiedenen Schwellen
    dict(name="E1 zwei Klassen, nur die niedrigere Schwelle wandelt (Exit 30 Mio)", E="30000000", exitdatum="2026-06-30",
         klassen=[k("SerieB", 1, "1"), k("SerieA", 2, "1")],
         inhaber=[h("Gruender", None, "6000000"), h("FondsA", "SerieA", "2000000", "2000000", "2023-05-01"), h("FondsB", "SerieB", "2000000", "10000000", "2026-02-01")]),
    dict(name="E2 dieselben Klassen, beide wandeln (Exit 80 Mio)", E="80000000", exitdatum="2026-06-30",
         klassen=[k("SerieB", 1, "1"), k("SerieA", 2, "1")],
         inhaber=[h("Gruender", None, "6000000"), h("FondsA", "SerieA", "2000000", "2000000", "2023-05-01"), h("FondsB", "SerieB", "2000000", "10000000", "2026-02-01")]),
    # F: nicht umwandelbare Klasse bleibt bei der Präferenz
    dict(name="F1 nicht umwandelbar bei hohem Exit", E="100000000", exitdatum="2026-06-30", klassen=[k("SerieA", 1, "1", False, None, None, False)],
         inhaber=[h("Gruender", None, "7000000"), h("FondsA", "SerieA", "3000000", "3000000", "2024-03-01")]),
    # G: Treuhand und Rundung
    dict(name="G1 Treuhand 10 % und Dreierteilung mit Cent-Rest", E="1000000.01", exitdatum="2026-06-30", treuhand="0.1",
         klassen=[k("SerieA", 1, "1", True)],
         inhaber=[h("Gruender", None, "3"), h("FondsA", "SerieA", "3", "100000", "2024-03-01"), h("Angel", None, "3")]),
    # H: ein Rest ohne Empfänger
    dict(name="H1 alle am Cap und kein Stamm: Rest nicht verteilt", E="5000000", exitdatum="2026-06-30", klassen=[k("SerieA", 1, "1", True, "2", None, False)],
         inhaber=[h("FondsA", "SerieA", "100", "1000000", "2024-03-01")]),
    # I: mehrere Zeilen je Klasse mit verschiedenen Runden und Zinsen
    dict(name="I1 eine Klasse, zwei Runden, Zins 6 %, partizipierend mit Cap 2,3x je Zeile", E="14000000", exitdatum="2026-12-31", treuhand="0.05",
         klassen=[k("SerieA", 1, "1.5", True, "2.3", "0.06")],
         inhaber=[h("Gruender", None, "6000000"), h("FondsA", "SerieA", "1500000", "2000000", "2024-06-30"), h("Angel", "SerieA", "1000000", "1500000", "2025-03-31"), h("Pool", None, "500000")]),
    # M: Mitarbeiterbeteiligung (ESOP/VSOP) hinter den Präferenzen
    # M1: ESOP mit Ausübungspreis 1 €, im Geld. Serie A wandelt, 9 Mio Anteile + 1 Mio Optionen: p = (13 Mio + 1 Mio) ÷ 10 Mio = 1,40,
    #     die Optionen bekommen 1 Mio × (1,40 − 1) = 0,4 Mio
    dict(name="M1 ESOP im Geld: Ausübungspreis mindert die Auszahlung", E="13000000", exitdatum="2026-06-30", klassen=[k("SerieA", 1)],
         inhaber=[h("Gruender", None, "6000000"), h("FondsA", "SerieA", "3000000", "3000000", "2024-03-01"), m("ESOP", "1000000", "1")]),
    # M2: Option aus dem Geld: Basispreis 2 €, ohne die Optionen p = 13 Mio ÷ 9 Mio ≈ 1,44 < 2 → die Optionen bekommen nichts
    dict(name="M2 Option aus dem Geld bekommt nichts", E="13000000", exitdatum="2026-06-30", klassen=[k("SerieA", 1)],
         inhaber=[h("Gruender", None, "6000000"), h("FondsA", "SerieA", "3000000", "3000000", "2024-03-01"), m("ESOP", "1000000", "2")]),
    # M3: Präferenz frisst den Erlös: nichts für Stamm und Mitarbeiterbeteiligung
    dict(name="M3 Präferenz frisst Erlös: Mitarbeiterbeteiligung leer", E="2500000", exitdatum="2026-06-30", klassen=[k("SerieA", 1, "1", False, None, None, False)],
         inhaber=[h("Gruender", None, "6000000"), h("FondsA", "SerieA", "3000000", "3000000", "2024-03-01"), m("VSOP", "1000000", "0")]),
    # M4: zwei Tranchen mit verschiedenen Basispreisen, eine im, eine aus dem Geld, dazu ein Cap
    dict(name="M4 zwei Tranchen, eine aus dem Geld, mit Cap", E="30000000", exitdatum="2026-06-30", klassen=[k("SerieA", 1, "1", True, "2")],
         inhaber=[h("Gruender", None, "6000000"), h("FondsA", "SerieA", "2000000", "4000000", "2024-03-01"), m("ESOP1", "500000", "0.5"), m("ESOP2", "500000", "4")]),
    # M5: VSOP mit Basispreis, Regel anteilig: mindert alle Rückflüsse einschließlich der Präferenz
    dict(name="M5 VSOP mit Basispreis, Auszahlung mindert alle Rückflüsse anteilig", E="20000000", exitdatum="2026-06-30", klassen=[k("SerieA", 1, "1", True)],
         inhaber=[h("Gruender", None, "7000000"), h("FondsA", "SerieA", "2000000", "4000000", "2024-03-01"), m("VSOP", "1000000", "0.8", "anteilig")]),
    # M6: VSOP anteilig aus dem Geld
    dict(name="M6 VSOP anteilig aus dem Geld", E="5000000", exitdatum="2026-06-30", klassen=[k("SerieA", 1)],
         inhaber=[h("Gruender", None, "7000000"), h("FondsA", "SerieA", "3000000", "3000000", "2024-03-01"), m("VSOP", "1000000", "1", "anteilig")]),
    dict(name="M7 Vorabzahlung kürzt den Erlös vor der Präferenz", E="900", exitdatum="2026-06-30", treuhand="0.1",
         klassen=[k("SerieA", 1, umw=False)],
         inhaber=[h("Gruender", None, "60"), h("FondsA", "SerieA", "20", "850"), m("VSOP", "20", "1", "vor_verteilung", "3")]),
    dict(name="M8 Gemischte Ränge mit Obergrenzen und Basispreisen", E="1500", exitdatum="2026-06-30", treuhand="0.15",
         klassen=[k("SerieA", 1, part=True)],
         inhaber=[h("Gruender", None, "60"), h("FondsA", "SerieA", "20", "200"),
                  m("Vorab", "20", "1", "vor_verteilung", "2"), m("Rest", "7", "1", "wie_anteile", "3"),
                  m("Anteilig1", "6", "2", "anteilig", "4"), m("Anteilig2", "8", "6", "anteilig"),
                  m("Anteilig3", "10", "15", "anteilig")]),
    dict(name="M9 Nur gedeckelte Einheiten im Restpool", E="10", exitdatum="2026-06-30", klassen=[],
         inhaber=[m("VSOP1", "2", "1", "wie_anteile", "0.5"), m("VSOP2", "4", "8", "wie_anteile", "0")]),
    dict(name="M10 Vorabzahlung beeinflusst die Umwandlung", E="400", exitdatum="2026-06-30",
         klassen=[k("SerieA", 1)],
         inhaber=[h("Gruender", None, "60"), h("FondsA", "SerieA", "20", "90"), m("VSOP", "20", "0", "vor_verteilung")]),
]

# Knickpunkte in geschlossener Form (von Hand hergeleitet, unabhängig vom Code):
KNICKE = [
    ("A1/A2 Seriell A: Präferenz voll bei Präferenz, Umwandlung bei Präferenz ÷ Anteil", [("praeferenz_voll", F(3000000)), ("umwandlung", F(3000000) / F(3, 10))]),
    # Partizipierend 2 Mio, 20 % der Anteile, Cap 3x: Präferenz voll bei 2 Mio (dort beginnt die Beteiligung),
    # Cap bei 2 Mio + 0,2 × (E − 2 Mio) = 6 Mio, Umwandlung bei 0,2 × E = 6 Mio.
    ("C2 Cap 3x: Präferenz und Beteiligungsbeginn bei 2 Mio, Cap bei 22 Mio, Umwandlung bei 30 Mio",
     [("praeferenz_voll", F(2000000)), ("beteiligung_beginn", F(2000000)), ("deckel", F(2000000) + (F(6000000) - F(2000000)) / F(1, 5)), ("umwandlung", F(6000000) / F(1, 5))]),
]


def als_json():
    """Eingaben und Ergebnisse als JSON (Quelle der festen Werte in den Tests; die Tests lesen keine Datei)."""
    import json
    aus = []
    for fall in FAELLE:
        w, zeilen, gerundet, gesamt, treuhand, nicht_verteilt, gedeckelt = rechne(fall)
        aus.append(dict(
            fall=fall,
            gewandelt=sorted(w),
            zeilen=[dict(
                id=z["id"], praeferenz=cent_text(gerundet[2 * i]), beteiligung=cent_text(gerundet[2 * i + 1]), gesamt=cent_text(gesamt[i]),
                treuhand=cent_text(treuhand[i]), sofort=cent_text(gesamt[i] - treuhand[i]),
                multiple=vier_stellen(gesamt[i] / F(z["investiert"])) if F(z["investiert"]) > 0 else None,
                gedeckelt=z["id"] in gedeckelt,
            ) for i, z in enumerate(zeilen)],
            nichtVerteilt=cent_text(nicht_verteilt),
        ))
    knicke = [dict(name=name, knicke=[dict(art=art, exitwert=cent_text(wert)) for art, wert in liste]) for name, liste in KNICKE]
    print(json.dumps(dict(faelle=aus, knicke=knicke), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    import sys
    if "--json" in sys.argv:
        als_json()
        sys.exit(0)
    for fall in FAELLE:
        drucke(fall)
    print("== KNICKE ==")
    for name, liste in KNICKE:
        print(name)
        for art, wert in liste:
            print(" ", art, cent_text(wert))
