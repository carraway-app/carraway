import type { HTMLAttributes, ReactNode } from "react";
import { klassen } from "../hilfen";

export interface WerkzeugleisteProps extends HTMLAttributes<HTMLDivElement> {
  "aria-label": string;
  /** Rechts angeordnet (zum Beispiel Umschalter oder Schaltflächen); `children` stehen links. */
  rechts?: ReactNode;
}

/** Leiste über einer Liste: Suche, Filter, Umschalter. Felder darin tragen ihre eigene Beschriftung. */
export function Werkzeugleiste({ rechts, className, children, ...rest }: WerkzeugleisteProps) {
  return (
    <div role="group" className={klassen("cw-werkzeugleiste", className)} {...rest}>
      <div className="cw-werkzeugleiste__gruppe">{children}</div>
      {rechts ? (
        <>
          <span className="cw-werkzeugleiste__platz" />
          <div className="cw-werkzeugleiste__gruppe">{rechts}</div>
        </>
      ) : null}
    </div>
  );
}
