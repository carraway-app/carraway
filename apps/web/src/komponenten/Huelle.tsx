import { useRouterState } from "@tanstack/react-router";
import type { ComponentType } from "react";
import { AUTH_SEITEN } from "../api/anmeldung";
import { alle } from "../erweiterung";
import { AuthHuelle } from "./AuthHuelle";

let anwendungsHuelle: ComponentType | undefined;

/**
 * Der Rahmen der Anwendung (Seitenleiste, Navigation, Kopfzeile, Symbole) lädt als eigener Abschnitt, nicht mit dem Start: Anmelde- und Einrichtungsseiten brauchen ihn nicht.
 * Der Wächter der Wurzel lädt ihn parallel zur Sitzungsprüfung und wartet darauf, bevor etwas gezeichnet wird; so gibt es weder Aufblitzen noch Sprünge.
 */
export function ladeAnwendungsHuelle(): Promise<void> {
  return import("./AnwendungsHuelle").then((m) => {
    anwendungsHuelle = m.AnwendungsHuelle;
  });
}

/** Wurzel: Anmelde- und Einrichtungsseiten haben einen schlichten Rahmen, alles andere den der Anwendung. */
export function Huelle() {
  const pfad = useRouterState({ select: (s) => s.location.pathname });
  const Anwendung = anwendungsHuelle;
  // Die Weiche ins Portal braucht keinen Rahmen der Anwendung (der würde Fonds laden, die ein Investor-Benutzer nicht sehen darf).
  return AUTH_SEITEN.includes(pfad) || alle("einstiege").some((e) => e.passt(pfad)) ? <AuthHuelle /> : Anwendung ? <Anwendung /> : null;
}
