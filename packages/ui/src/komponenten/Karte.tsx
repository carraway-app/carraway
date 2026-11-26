import { useId, type HTMLAttributes, type ReactNode } from "react";
import { klassen } from "../hilfen";

export interface KarteProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  titel: ReactNode;
  /** Die eine Aktion der Karte (Icon-Button oder Menü), rechts im Kopf. */
  aktion?: ReactNode;
  /** Überschriftenebene des Titels (Standard 2). */
  ebene?: 2 | 3;
  /** Die Karte füllt im Kartenraster die ganze Breite. */
  breit?: boolean;
}

/** Kompakte Karte: Titel und eine Aktion im Kopf, darunter der Inhalt. Mehrere Karten stehen in einem `<KartenRaster />`. */
export function Karte({ titel, aktion, ebene = 2, breit, className, children, ...rest }: KarteProps) {
  const id = useId();
  const Titel = ebene === 2 ? "h2" : "h3";
  return (
    <div role="group" className={klassen("cw-karte", breit && "cw-karte--breit", className)} aria-labelledby={id} {...rest}>
      <div className="cw-karte__kopf">
        <Titel id={id} className="cw-karte__titel">
          {titel}
        </Titel>
        {aktion ? <div className="cw-karte__aktion">{aktion}</div> : null}
      </div>
      <div className="cw-karte__koerper">{children}</div>
    </div>
  );
}

/** Raster aus zwei bis drei Spalten für Karten (je nach Breite). */
export function KartenRaster({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={klassen("cw-kartenraster", className)} {...rest} />;
}
