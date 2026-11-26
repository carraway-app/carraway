"""Unabhängige Referenzrechnung für die Tests der Kennzahlen der Portfoliounternehmen (`kpi.ts`).

Aufruf: python3 -I referenz_kpi.py
Exakte Brüche (fractions.Fraction), keine Gleitkommazahlen. Alle Zahlen sind erfunden.
Definition: Abweichung absolut = Ist − Plan; relativ = (Ist − Plan) ÷ |Plan| × 100 (bei Plan 0 nicht definiert).
Verdichtung: Summe, Stand (letzter Wert nach Beginn) oder Durchschnitt über die vorhandenen Zeiträume.
"""
from fractions import Fraction as F


def dezimal(x, stellen=12):
    """Kommadarstellung gekürzt auf `stellen` Nachkommastellen (nur für den Vergleich der ersten Stellen)."""
    vorzeichen = "-" if x < 0 else ""
    x = abs(x)
    ganz = x.numerator // x.denominator
    rest = x - ganz
    ziffern = ""
    for _ in range(stellen):
        rest *= 10
        z = rest.numerator // rest.denominator
        ziffern += str(z)
        rest -= z
    return f"{vorzeichen}{ganz}.{ziffern}"


def abweichung(name, ist, plan):
    ist, plan = F(ist), F(plan)
    absolut = ist - plan
    print(f"{name}: absolut {dezimal(absolut, 2)}", end="")
    if plan == 0:
        print(" relativ nicht definiert")
    else:
        print(f" relativ {dezimal(absolut / abs(plan) * 100)}")


print("== Abweichung ==")
abweichung("A Umsatz", "1234567.89", "1300000.00")
abweichung("B EBITDA negativer Plan", "-80000", "-120000")
abweichung("C Plan 0", "5000", "0")
abweichung("D Prozent-Kennzahl in Prozentpunkten", "12.5", "15")
abweichung("E Ist negativ, Plan positiv", "-2000", "10000")

print("== Verdichtung ==")
monate = [F("100.10"), F("200.20"), F("300.30")]
print("F summe", dezimal(sum(monate), 2), "stand", dezimal(monate[-1], 2), "durchschnitt", dezimal(sum(monate) / len(monate), 2))
zwei = [F(10), F(15)]
print("G durchschnitt zwei Monate", dezimal(sum(zwei) / len(zwei), 2))
