import type { HTMLAttributes, ReactNode } from "react";
import { klassen } from "../hilfen";

export interface SegmentOption<W extends string> {
  wert: W;
  label: ReactNode;
}

export interface SegmentProps<W extends string> extends Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "children"> {
  options: SegmentOption<W>[];
  value: W;
  onChange: (wert: W) => void;
}

export function Segment<W extends string>({ options, value, onChange, className, ...rest }: SegmentProps<W>) {
  return (
    <div role="group" className={klassen("cw-segment", className)} {...rest}>
      {options.map((o) => (
        <button key={o.wert} type="button" aria-pressed={o.wert === value} onClick={() => onChange(o.wert)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
