import type { HTMLAttributes } from "react";
import { klassen } from "../hilfen";

export interface LogoProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Nur das Zeichen ohne Wortmarke. */
  nurZeichen?: boolean;
}

/** Zwei offene Bögen und ein Punkt. Größe und Farbschema bestimmen die Zeichenfassung. */
export function Logo({ nurZeichen, className, ...rest }: LogoProps) {
  return (
    <span role="img" aria-label="Carraway" className={klassen("cw-logo", className)} {...rest}>
      <span className="cw-logo__zeichen" aria-hidden="true" />
      {nurZeichen ? null : (
        <span className="cw-logo__wort" aria-hidden="true">
          Carraway
        </span>
      )}
    </span>
  );
}
