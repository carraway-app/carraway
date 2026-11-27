import type { ReactNode } from "react";
import type { IconKomponente } from "../icons";

export interface FilterChip {
  id: string;
  label: ReactNode;
  icon?: IconKomponente;
  /** Anzahl hinter dem Namen (zum Beispiel Treffer dieser Art). */
  zaehler?: number;
}

export interface FilterChipsProps {
  /** Name der Gruppe für Screenreader (zum Beispiel „Vorgänge nach Art“). */
  "aria-label": string;
  chips: FilterChip[];
  /** Gewählter Chip (genau einer, zum Beispiel „Alle“ als Standard). */
  wert: string;
  onWechsel: (id: string) => void;
  className?: string;
}

/**
 * Filterchips einer Werkzeugzeile: wählt genau einen Filter einer Liste (keine Navigation, deshalb keine Reiter). Jeder Chip ist ein Knopf mit
 * `aria-pressed`; die Seite schreibt die Wahl in die Adresse.
 */
export function FilterChips({ chips, wert, onWechsel, className, "aria-label": ariaLabel }: FilterChipsProps) {
  return (
    <div role="group" aria-label={ariaLabel} className={className ? `cw-filterchips ${className}` : "cw-filterchips"}>
      {chips.map((c) => (
        <button key={c.id} type="button" className="cw-filterchips__chip" aria-pressed={c.id === wert} onClick={() => c.id !== wert && onWechsel(c.id)}>
          {c.icon ? <c.icon size={14} aria-hidden /> : null}
          {c.label}
          {c.zaehler !== undefined ? " " : null}
          {c.zaehler !== undefined ? <span className="cw-filterchips__zaehler">{c.zaehler}</span> : null}
        </button>
      ))}
    </div>
  );
}
