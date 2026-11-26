import type { Key, ReactNode } from "react";
import { klassen } from "../hilfen";

export interface KennwertEintrag {
  id?: Key;
  label: ReactNode;
  wert: ReactNode;
  /** Kopfzahl der Gruppe: größer und fett. */
  primaer?: boolean;
  /** Leerer oder Standardwert („–“, „Keiner“, „Nein“): gedämpft. */
  ruhig?: boolean;
  /** Kurzer Zusatz unter dem Wert. */
  hinweis?: ReactNode;
}

export interface KennwertGruppe {
  id?: Key;
  titel?: ReactNode;
  eintraege: KennwertEintrag[];
}

export interface KennwerteProps {
  gruppen: KennwertGruppe[];
  /** Enger Satz für kleine Flächen. */
  kompakt?: boolean;
  /** Abgeschlossener Gegenstand (zum Beispiel gewandeltes Instrument): alle Zahlen gedämpft. */
  gedaempft?: boolean;
  className?: string;
}

/** Kennwerte in benannten Gruppen: jede Gruppe eine eingesetzte Fläche mit kleiner Überschrift, Kopfzahlen größer, Standardwerte gedämpft. Löst die Faktenwand ab. */
export function Kennwerte({ gruppen, kompakt, gedaempft, className }: KennwerteProps) {
  return (
    <div className={klassen("cw-kennwerte", kompakt && "cw-kennwerte--kompakt", gedaempft && "cw-kennwerte--gedaempft", className)}>
      {gruppen.map((g, gi) => (
        <section key={g.id ?? gi} className="cw-kennwerte__gruppe">
          {g.titel ? <h3 className="cw-kennwerte__titel">{g.titel}</h3> : null}
          <dl className="cw-kennwerte__liste">
            {g.eintraege.map((e, i) => (
              <div key={e.id ?? i} className={klassen("cw-kennwerte__eintrag", e.primaer && "cw-kennwerte__eintrag--primaer", e.ruhig && "cw-kennwerte__eintrag--ruhig")}>
                <dt>{e.label}</dt>
                <dd>
                  {e.wert}
                  {e.hinweis ? <span className="cw-kennwerte__hinweis">{e.hinweis}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
