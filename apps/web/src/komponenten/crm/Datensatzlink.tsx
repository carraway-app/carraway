import { lazy, Suspense, useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { Objekt } from "../../api/crm";
import { recordLink } from "./typen";

/** Die Karte (Abfrage, Darstellung, Schnellaktionen) lädt erst beim ersten Überfahren oder Fokussieren eines Verweises. */
const Vorschaukarte = lazy(() => import("./Vorschaukarte"));

/** Verzögerung vor dem Öffnen und vor dem Schließen beim Überfahren (Millisekunden). */
const OEFFNEN_NACH = 350;
const SCHLIESSEN_NACH = 200;

interface Props {
  objekt: Objekt;
  id: string;
  className?: string;
  draggable?: boolean;
  children: ReactNode;
}

/**
 * Verweis auf ein Unternehmen, einen Kontakt oder einen Deal mit einer kleinen Karte (Name, Unternehmen, Mail, Telefon, Schnellaktionen) beim Überfahren mit der Maus und
 * beim Fokussieren per Tastatur. Die Karte ist eine Beschreibung des Verweises (`aria-describedby`), sie fängt den Fokus nicht ein, Escape schließt sie. Auf Touch-Geräten
 * öffnet der Verweis wie gewohnt die Seite.
 */
export function Datensatzlink({ objekt, id, className, draggable, children }: Props) {
  const [offen, setOffen] = useState(false);
  const anker = useRef<HTMLAnchorElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const karteId = useId();

  const plane = (ziel: boolean, nach: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOffen(ziel), nach);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Escape schließt die Karte, bevor andere Flächen (Schublade, Dialog) darauf reagieren; der Fokus bleibt am Verweis.
  useEffect(() => {
    if (!offen) return;
    const beiTaste = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      window.clearTimeout(timer.current);
      setOffen(false);
    };
    window.addEventListener("keydown", beiTaste, true);
    return () => window.removeEventListener("keydown", beiTaste, true);
  }, [offen]);

  const beiZeiger = (ziel: boolean) => (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    plane(ziel, ziel ? OEFFNEN_NACH : SCHLIESSEN_NACH);
  };

  return (
    <>
      <Link
        ref={anker}
        {...recordLink(objekt, id)}
        {...(className ? { className } : {})}
        {...(draggable === undefined ? {} : { draggable })}
        aria-describedby={offen ? karteId : undefined}
        onPointerEnter={beiZeiger(true)}
        onPointerLeave={beiZeiger(false)}
        onFocus={(e) => {
          // Nur beim Fokus per Tastatur; ein Mausklick navigiert ohnehin.
          if (e.currentTarget.matches(":focus-visible")) plane(true, 0);
        }}
        onBlur={() => plane(false, SCHLIESSEN_NACH)}
      >
        {children}
      </Link>
      {offen ? (
        <Suspense fallback={null}>
          <Vorschaukarte objekt={objekt} id={id} anker={anker} karteId={karteId} onZeiger={(drin) => plane(drin, drin ? 0 : SCHLIESSEN_NACH)} />
        </Suspense>
      ) : null}
    </>
  );
}
