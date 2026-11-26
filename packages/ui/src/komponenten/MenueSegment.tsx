import type { KeyboardEvent } from "react";
import { klassen } from "../hilfen";
import type { SegmentProps } from "./Segment";

/** Pfeil links und rechts springen zwischen den Segmenten (die Pfeile auf und ab gehören dem Menü). */
function beiTaste(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const knoepfe = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
  const index = knoepfe.indexOf(document.activeElement as HTMLButtonElement);
  if (index === -1) return;
  e.preventDefault();
  knoepfe[(index + (e.key === "ArrowRight" ? 1 : -1) + knoepfe.length) % knoepfe.length]?.focus();
}

/**
 * Segment als Block eines Menüs (`Menue`, Eigenschaft `block`): Die Schaltflächen sind Einträge des Menüs (`menuitemradio`), das Menü
 * bleibt nach der Wahl offen, und Pfeil links und rechts wechseln zwischen den Segmenten. Aussehen wie `Segment`.
 */
export function MenueSegment<W extends string>({ options, value, onChange, className, ...rest }: SegmentProps<W>) {
  return (
    <div role="group" className={klassen("cw-segment", className)} onKeyDown={beiTaste} {...rest}>
      {options.map((o) => (
        <button key={o.wert} type="button" role="menuitemradio" aria-checked={o.wert === value} tabIndex={-1} onClick={() => onChange(o.wert)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
