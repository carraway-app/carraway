import { createContext, useContext, useLayoutEffect } from "react";
import type { Kontext } from "./navigation";

/**
 * Objektkontext der Seitenleiste: Detailseiten (Beteiligung, Deal, Organisation, Person) melden ihre Orte, ihren Rückweg und ihren Kopf an,
 * der Rahmen zeigt sie statt der globalen oder der Fondsleiste. Die Einträge sind Adressen derselben Seite (`?tab=…`).
 */
export type ObjektKontext = Omit<Kontext, "art"> & {
  /** Kennung des aktiven Eintrags (die Seite kennt ihn aus der Adresse); ohne Angabe entscheidet `aktiv` der Einträge. */
  aktivId?: string | undefined;
};

type Setzen = (kontext: ObjektKontext | null) => void;

export const KontextLeisteKontext = createContext<Setzen>(() => {});

/** Signatur ohne Zeichen (React-Elemente) und Funktionen: Nur wenn sich Orte, Ziele oder Texte ändern, wird neu gesetzt. */
function signatur(k: ObjektKontext | null): string {
  if (!k) return "";
  return JSON.stringify(k, (schluessel, wert: unknown) => (schluessel === "icon" || typeof wert === "function" ? undefined : wert)) + k.gruppen.map((g) => g.items.map((i) => i.id).join(",")).join("|");
}

/** Meldet den Objektkontext an, solange die Seite steht. `aktiv` der Einträge berechnet die Seite (Reiter aus der Adresse). */
export function useObjektKontext(kontext: ObjektKontext | null): void {
  const setze = useContext(KontextLeisteKontext);
  const sig = signatur(kontext);
  // Absichtlich nur bei geänderter Signatur: Zeichen und Funktionen sind je Render neue Objekte, bedeuten aber dasselbe.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => setze(kontext), [sig, setze]);
  useLayoutEffect(() => () => setze(null), [setze]);
}
