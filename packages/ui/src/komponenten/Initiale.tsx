import type { HTMLAttributes } from "react";
import { klassen } from "../hilfen";

export interface InitialeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Name der Beteiligung oder des Fonds; der erste Buchstabe wird gezeigt. */
  name: string;
  groesse?: "s" | "m" | "l";
  /** `kachel`: Initialkachel auf `--cw-tile` (Standard); `flaeche`: auf der zweiten Fläche; `akzent`: umgekehrte Kachel mit Linie im Akzent unten. */
  variante?: "kachel" | "flaeche" | "akzent";
}

/** Dekorativ: der Name steht immer daneben, deshalb `aria-hidden`. */
export function Initiale({ name, groesse = "s", variante = "kachel", className, ...rest }: InitialeProps) {
  const buchstabe = (Array.from(name.trim())[0] ?? "").toUpperCase();
  return (
    <span
      aria-hidden="true"
      data-buchstabe={buchstabe}
      className={klassen("cw-initiale", groesse !== "s" && `cw-initiale--${groesse}`, variante !== "kachel" && `cw-initiale--${variante}`, className)}
      {...rest}
    />
  );
}
