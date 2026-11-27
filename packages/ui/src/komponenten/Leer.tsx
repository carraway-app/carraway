import type { HTMLAttributes, ReactNode } from "react";
import { klassen } from "../hilfen";
import { useUiTexte } from "../sprache";

export interface LeerProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  titel?: ReactNode;
  /** Ein Satz, was hier stünde und wie es entsteht. */
  beschreibung?: ReactNode;
  /** Die passende Aktion im Bereich (zum Beispiel ein Button, der den ersten Eintrag anlegt); nur mit Schreibrecht übergeben. */
  aktion?: ReactNode;
  /** Eine Zeile, gedämpft, mit der Aktion am Ende. */
  kompakt?: boolean;
}

/** Leerzustand eines Bereichs: Titel, ein Satz Erklärung und die passende Aktion. Ohne Grafik. */
export function Leer({ titel, beschreibung, aktion, kompakt, className, ...rest }: LeerProps) {
  const t = useUiTexte();
  if (kompakt) {
    return (
      <div className={klassen("cw-leer", "cw-leer--zeile", className)} {...rest}>
        <span className="cw-leer__text">
          {titel ? <span className="cw-leer__titel">{titel}</span> : null}
          {beschreibung ? <span className="cw-leer__beschreibung">{beschreibung}</span> : null}
        </span>
        {aktion ? <span className="cw-leer__aktion">{aktion}</span> : null}
      </div>
    );
  }
  const text = beschreibung ?? t.leerBeschreibung;
  return (
    <div className={klassen("cw-leer", className)} {...rest}>
      <div className="cw-leer__text">
        <p className="cw-leer__titel">{titel ?? t.leerTitel}</p>
        {text ? <p className="cw-leer__beschreibung">{text}</p> : null}
      </div>
      {aktion ? <div className="cw-leer__aktion">{aktion}</div> : null}
    </div>
  );
}
