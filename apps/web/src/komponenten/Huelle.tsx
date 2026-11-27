import { lazyRouteComponent, Outlet, useRouterState } from "@tanstack/react-router";
import type { ComponentType } from "react";
import { AUTH_SEITEN } from "../api/anmeldung";
import { alle } from "../erweiterung";

const AuthHuelle = lazyRouteComponent(() => import("./AuthHuelle"), "AuthHuelle");

let anwendungsHuelle: ComponentType | undefined;

/**
 * Der Rahmen der Anwendung (Seitenleiste, Navigation, Kopfzeile, Symbole) lädt als eigener Abschnitt, nicht mit dem Start: Anmelde- und Einrichtungsseiten brauchen ihn nicht.
 * Der Wächter der Wurzel lädt ihn nach der Sitzungsprüfung und wartet darauf, bevor etwas gezeichnet wird; so gibt es weder Aufblitzen noch Sprünge.
 */
export function ladeAnwendungsHuelle(): Promise<void> {
  return import("./AnwendungsHuelle").then((m) => {
    anwendungsHuelle = m.AnwendungsHuelle;
  });
}

/** Wurzel: Anmelde- und Einrichtungsseiten haben einen schlichten Rahmen, alles andere den der Anwendung. */
export function Huelle() {
  const pfad = useRouterState({ select: (s) => s.location.pathname.replace(/\/$/, "") || "/" });
  const unbekannt = useRouterState({ select: (s) => s.matches.some((match) => match.routeId === "/$") });
  if (unbekannt) return <Outlet />;
  const Anwendung = anwendungsHuelle;
  // Die Weiche ins Portal braucht keinen Rahmen der Anwendung (der würde Fonds laden, die ein Investor-Benutzer nicht sehen darf).
  return AUTH_SEITEN.includes(pfad) || alle("einstiege").some((e) => e.passt(pfad)) ? <AuthHuelle /> : Anwendung ? <Anwendung /> : null;
}
