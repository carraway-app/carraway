import type { HTMLAttributes, ReactNode } from "react";
import { klassen } from "../hilfen";
import { DotsThreeIcon } from "../icons/DotsThree";
import { useUiTexte } from "../sprache";
import { Menue, type MenueEintrag } from "./Menue";
import { InfoKnopf } from "./InfoKnopf";

export interface SeitenkopfProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Kurze Angaben hinter dem Titel in derselben Zeile: Zugehörigkeit, Art, Stand (Links erlaubt). */
  meta?: ReactNode;
  /** Titel der Seite (Ebene 1), einmal je Seite. */
  titel: ReactNode;
  /** Status des Objekts direkt hinter dem Titel (zum Beispiel ein `<Status />`). */
  status?: ReactNode;
  /** Stichtag-Menü und zugehörige Zeitwahl, rechts vor den Aktionen. */
  zeitbezug?: ReactNode;
  /** Die Hauptaktion der Seite (höchstens eine oder zwei Schaltflächen); alles Weitere gehört in `mehr`. */
  aktionen?: ReactNode;
  /** Weitere Aktionen im Menü „⋯“, sichtbar auf der Seite (nie nur über die Suche). */
  mehr?: MenueEintrag[];
  /** Erklärtext der Seite hinter einem Info-Symbol neben dem Titel. */
  info?: ReactNode;
  /**
   * Sprache des Titels (`lang`), wenn er aus Daten kommt und nicht in der Sprache der Oberfläche steht.
   * Die Silbentrennung folgt dieser Sprache.
   */
  titelSprache?: string;
}

/**
 * Kontextkopf: eine Zeile mit Titel, Status und kurzen Angaben links, rechts Stichtag-Menü, Hauptaktion und „⋯“.
 * In der Anwendung bleibt er beim Scrollen unter der Kopfleiste stehen; Kennzahlen und Erklärungen darunter scrollen weg.
 */
export function Seitenkopf({ meta, titel, status, zeitbezug, aktionen, mehr, info, titelSprache, className, ...rest }: SeitenkopfProps) {
  const t = useUiTexte();
  const mitMehr = Boolean(mehr && mehr.length > 0);
  return (
    <header className={klassen("cw-seitenkopf", className)} {...rest}>
      <div className="cw-seitenkopf__text">
        <h1 className="cw-seitenkopf__titel" lang={titelSprache}>
          {titel}
        </h1>
        {status ? <span className="cw-seitenkopf__status">{status}</span> : null}
        {info ? (
          <InfoKnopf>{info}</InfoKnopf>
        ) : null}
        {meta ? <div className="cw-seitenkopf__meta">{meta}</div> : null}
      </div>
      {zeitbezug || aktionen || mitMehr ? (
        <div className="cw-seitenkopf__aktionen">
          {zeitbezug ? <div className="cw-seitenkopf__zeitbezug">{zeitbezug}</div> : null}
          {aktionen}
          {mitMehr ? <Menue aria-label={t.weitereAktionen} title={t.weitereAktionen} ausloeserKlasse="cw-button cw-button--sekundaer cw-button--s cw-seitenkopf__mehr" ausloeser={<DotsThreeIcon size={18} />} eintraege={mehr!} /> : null}
        </div>
      ) : null}
    </header>
  );
}
