import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { klassen } from "../hilfen";

export interface PopoverProps {
  /** Inhalt des Auslösers (Text, Zeichen). */
  ausloeser: ReactNode;
  /** Name der Fläche für Screenreader; benennt auch den Auslöser, wenn `ausloeserLabel` fehlt. */
  "aria-label": string;
  ausloeserLabel?: string;
  /** Klassen des Auslöser-Buttons; ohne Angabe ein kleiner Sekundär-Button. */
  ausloeserKlasse?: string;
  /** Kante, an der die Fläche am Auslöser anliegt. */
  kante?: "rechts" | "links";
  /** Titel (Tooltip) des Auslösers, zum Beispiel die Erklärung. */
  title?: string;
  /** Zeigt am Auslöser an, dass etwas gesetzt ist. */
  aktiv?: boolean;
  className?: string;
  children: ReactNode;
}

/** Kleine Fläche am Auslöser für ein oder zwei Felder: Escape und Klick daneben schließen, der Fokus kehrt zurück. */
export function Popover({ ausloeser, "aria-label": ariaLabel, ausloeserLabel, ausloeserKlasse, kante = "rechts", title, aktiv, className, children }: PopoverProps) {
  const [offen, setOffen] = useState(false);
  const huelle = useRef<HTMLDivElement>(null);
  const knopf = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!offen) return;
    const beiKlick = (e: MouseEvent) => {
      if (huelle.current && e.target instanceof Node && !huelle.current.contains(e.target)) setOffen(false);
    };
    const beiTaste = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOffen(false);
      knopf.current?.focus();
    };
    document.addEventListener("mousedown", beiKlick);
    document.addEventListener("keydown", beiTaste);
    return () => {
      document.removeEventListener("mousedown", beiKlick);
      document.removeEventListener("keydown", beiTaste);
    };
  }, [offen]);

  return (
    <div ref={huelle} className={klassen("cw-popover", kante === "links" && "cw-popover--links", className)}>
      <button
        ref={knopf}
        type="button"
        className={ausloeserKlasse ?? "cw-button cw-button--s cw-button--sekundaer"}
        aria-label={ausloeserLabel ?? ariaLabel}
        aria-expanded={offen}
        aria-controls={offen ? id : undefined}
        data-aktiv={aktiv || undefined}
        title={title}
        onClick={() => setOffen(!offen)}
      >
        {ausloeser}
      </button>
      {offen ? (
        <div id={id} role="group" aria-label={ariaLabel} className="cw-popover__flaeche">
          {children}
        </div>
      ) : null}
    </div>
  );
}
