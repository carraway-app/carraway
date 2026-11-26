import type { HTMLAttributes } from "react";
import { formatProzent } from "../format";
import { klassen } from "../hilfen";
import { useUiSprache, useUiTexte } from "../sprache";

export interface DeltaProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Veränderung in Prozent (8.4 steht für 8,4 %). */
  wert: number;
  nachkomma?: number;
}

export function Delta({ wert, nachkomma = 1, className, ...rest }: DeltaProps) {
  const sprache = useUiSprache();
  const t = useUiTexte();
  const faktor = 10 ** nachkomma;
  const gerundet = Math.round(wert * faktor) / faktor;
  const richtung = gerundet > 0 ? "plus" : gerundet < 0 ? "minus" : "null";
  const zeichen = { plus: "▲", minus: "▼", null: "±" }[richtung];
  const hinweis = { plus: t.anstieg, minus: t.rueckgang, null: t.unveraendert }[richtung];
  return (
    <span className={klassen("cw-delta", richtung === "minus" && "cw-delta--minus", richtung === "null" && "cw-delta--null", className)} {...rest}>
      <span aria-hidden="true">{zeichen} </span>
      <span className="cw-nur-lesen">{hinweis} </span>
      {formatProzent(Math.abs(gerundet), sprache, nachkomma)}
    </span>
  );
}
