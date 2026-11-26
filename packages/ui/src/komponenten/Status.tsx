import type { HTMLAttributes } from "react";
import { klassen } from "../hilfen";
import { useUiTexte } from "../sprache";
import type { UiTexte } from "../texte";

export type StatusVariante = "entwurf" | "pruefung" | "freigegeben" | "fehlt" | "beispiel";

const TEXT: Record<StatusVariante, keyof UiTexte> = {
  entwurf: "statusEntwurf",
  pruefung: "statusPruefung",
  freigegeben: "statusFreigegeben",
  fehlt: "statusFehlt",
  beispiel: "statusBeispiel",
};

export interface StatusProps extends HTMLAttributes<HTMLSpanElement> {
  variante?: StatusVariante;
}

/** Ohne Kinder steht der eingebaute Text der Variante. */
export function Status({ variante = "entwurf", className, children, ...rest }: StatusProps) {
  const t = useUiTexte();
  const standard = t[TEXT[variante]] as string;
  return (
    <span className={klassen("cw-status", variante !== "entwurf" && `cw-status--${variante}`, className)} {...rest}>
      {children ?? standard}
    </span>
  );
}
