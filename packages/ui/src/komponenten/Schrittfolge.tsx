import type { HTMLAttributes, ReactNode } from "react";
import { klassen } from "../hilfen";
import { useUiTexte } from "../sprache";

export interface SchrittfolgeEintrag {
  id: string;
  label: ReactNode;
}

export interface SchrittfolgeProps extends Omit<HTMLAttributes<HTMLOListElement>, "children"> {
  schritte: SchrittfolgeEintrag[];
  /** `id` des aktuellen Schritts; alle davor gelten als erledigt. Ohne Treffer (z. B. verworfen) ist keiner aktuell und keiner erledigt. */
  aktuell: string | null;
}

/**
 * Ablauf in Schritten (z. B. Status eines Zinslaufs). Der Zustand steht in Text für Screenreader und im Zeichen
 * (Haken, Nummer), nie nur in der Farbe; der aktuelle Schritt trägt `aria-current="step"`.
 */
export function Schrittfolge({ schritte, aktuell, className, ...rest }: SchrittfolgeProps) {
  const t = useUiTexte();
  const stelle = schritte.findIndex((s) => s.id === aktuell);
  return (
    <ol className={klassen("cw-schrittfolge", className)} {...rest}>
      {schritte.map((s, i) => {
        const zustand = stelle < 0 ? "offen" : i < stelle ? "erledigt" : i === stelle ? "aktuell" : "offen";
        return (
          <li key={s.id} className={klassen("cw-schritt", `cw-schritt--${zustand}`)} aria-current={zustand === "aktuell" ? "step" : undefined}>
            <span className="cw-schritt__zeichen" aria-hidden="true">
              {zustand === "erledigt" ? "✓" : i + 1}
            </span>
            <span className="cw-schritt__label">{s.label}</span>
            <span className="cw-nur-lesen">
              {zustand === "erledigt" ? t.schrittErledigt : zustand === "aktuell" ? t.schrittAktuell : t.schrittOffen}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
