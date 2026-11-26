import type { HTMLAttributes, Key, ReactNode } from "react";
import { klassen } from "../hilfen";

export interface FaktEintrag {
  id?: Key;
  label: ReactNode;
  wert: ReactNode;
}

export interface FaktenProps extends Omit<HTMLAttributes<HTMLDListElement>, "children"> {
  eintraege: FaktEintrag[];
  /** `liste`: Beschriftung links, Wert rechts in je einer Zeile (für Karten); `reihe`: eine umbrechende Zeile; Standard: Raster. */
  darstellung?: "raster" | "liste" | "reihe";
}

/** Beschriftung und Wert als Liste (`dl`), dicht und umbrechend. */
export function Fakten({ eintraege, darstellung = "raster", className, ...rest }: FaktenProps) {
  return (
    <dl className={klassen("cw-fakten", darstellung !== "raster" && `cw-fakten--${darstellung}`, className)} {...rest}>
      {eintraege.map((e, i) => (
        <div key={e.id ?? i}>
          <dt>{e.label}</dt>
          <dd>{e.wert}</dd>
        </div>
      ))}
    </dl>
  );
}
