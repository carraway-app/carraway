import type { HTMLAttributes } from "react";
import { klassen } from "../hilfen";

export interface KennzahlenReiheProps extends HTMLAttributes<HTMLElement> {
  "aria-label": string;
}

/** Kompakte Reihe von Kennzahlen (`<Kennzahl />`), die sich je nach Breite auf mehrere Zeilen verteilt. */
export function KennzahlenReihe({ className, ...rest }: KennzahlenReiheProps) {
  return <section className={klassen("cw-kennzahlen", className)} {...rest} />;
}
