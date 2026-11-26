import type { HTMLAttributes, ReactNode } from "react";
import { klassen } from "../hilfen";
import { useUiTexte } from "../sprache";

export interface LeerProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Ziffer oder Buchstabe, der von der Kachel angeschnitten wird (Standard: 0). */
  zeichen?: string;
  titel?: ReactNode;
  beschreibung?: ReactNode;
  /** Zum Beispiel ein Button, der den ersten Eintrag anlegt. */
  aktion?: ReactNode;
  /** Eine Zeile, gedämpft, mit der Aktion am Ende (statt der Kachel mit Zeichen). */
  kompakt?: boolean;
}

export function Leer({ zeichen = "0", titel, beschreibung, aktion, kompakt, className, ...rest }: LeerProps) {
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
  return (
    <div className={klassen("cw-leer", className)} {...rest}>
      <span className="cw-leer__kachel" aria-hidden="true" data-zeichen={Array.from(zeichen)[0] ?? ""} />
      <div className="cw-leer__text">
        <p className="cw-leer__titel">{titel ?? t.leerTitel}</p>
        <p className="cw-leer__beschreibung">{beschreibung ?? t.leerBeschreibung}</p>
        {aktion ? <div className="cw-leer__aktion">{aktion}</div> : null}
      </div>
    </div>
  );
}
