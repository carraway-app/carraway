import { useEffect, useRef, type ReactNode } from "react";
import { klassen } from "../hilfen";
import { XIcon } from "../icons/X";
import { useUiTexte } from "../sprache";

export interface DetailbereichProps {
  titel: ReactNode;
  /** Kurze Angaben unter dem Titel (Status, Phase). */
  meta?: ReactNode;
  /** Sichtbare Aktionen des Datensatzes (zum Beispiel „Öffnen“, „Zuweisen“); nie nur über die Suche erreichbar. */
  aktionen?: ReactNode;
  onSchliessen: () => void;
  children: ReactNode;
  className?: string;
  /** Sprache des Titels, wenn er aus Daten kommt. */
  titelSprache?: string;
}

/**
 * Detailbereich rechts neben einer Liste (nicht modal): Die Liste bleibt sichtbar und bedienbar. Escape schließt ihn, der Fokus geht beim Öffnen
 * auf den Titel. Die Seite legt den gewählten Datensatz in die Adresse, damit der Bereich verlinkbar ist.
 */
export function Detailbereich({ titel, meta, aktionen, onSchliessen, children, className, titelSprache }: DetailbereichProps) {
  const t = useUiTexte();
  const kopf = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    kopf.current?.focus({ preventScroll: true });
  }, []);
  return (
    <aside
      className={klassen("cw-detailbereich", className)}
      aria-labelledby="cw-detailbereich-titel"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          onSchliessen();
        }
      }}
    >
      <div className="cw-detailbereich__kopf">
        <div className="cw-detailbereich__titelblock">
          <h2 id="cw-detailbereich-titel" ref={kopf} tabIndex={-1} className="cw-detailbereich__titel" lang={titelSprache}>
            {titel}
          </h2>
          {meta ? <div className="cw-detailbereich__meta">{meta}</div> : null}
        </div>
        <button type="button" className="cw-detailbereich__schliessen" aria-label={t.schliessen} title={t.schliessen} onClick={onSchliessen}>
          <XIcon size={16} />
        </button>
      </div>
      {aktionen ? <div className="cw-detailbereich__aktionen">{aktionen}</div> : null}
      <div className="cw-detailbereich__inhalt">{children}</div>
    </aside>
  );
}
