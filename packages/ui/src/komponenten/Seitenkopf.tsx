import type { HTMLAttributes, ReactNode } from "react";
import { klassen } from "../hilfen";

export interface SeitenkopfProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Zeile unter dem Titel: Zugehörigkeit, Art, Stichtag (Links erlaubt). */
  meta?: ReactNode;
  /** Titel der Seite (Ebene 1), einmal je Seite. */
  titel: ReactNode;
  /** Stichtag und zugehörige Zeitwahl stehen durchgängig an der rechten oberen Kante. */
  zeitbezug?: ReactNode;
  aktionen?: ReactNode;
  /**
   * Sprache des Titels (`lang`), wenn er aus Daten kommt und nicht in der Sprache der Oberfläche steht.
   * Die Silbentrennung folgt dieser Sprache.
   */
  titelSprache?: string;
}

/** Titel und fachlicher Kontext links, rechts die Aktionen der aktuellen Ansicht. */
export function Seitenkopf({ meta, titel, zeitbezug, aktionen, titelSprache, className, ...rest }: SeitenkopfProps) {
  return (
    <header className={klassen("cw-seitenkopf", className)} {...rest}>
      <div className="cw-seitenkopf__text">
        <h1 className="cw-seitenkopf__titel" lang={titelSprache}>
          {titel}
        </h1>
        {meta ? <div className="cw-seitenkopf__meta">{meta}</div> : null}
      </div>
      {zeitbezug || aktionen ? (
        <div className="cw-seitenkopf__aktionen">
          {zeitbezug ? <div className="cw-seitenkopf__zeitbezug">{zeitbezug}</div> : null}
          {aktionen}
        </div>
      ) : null}
    </header>
  );
}
