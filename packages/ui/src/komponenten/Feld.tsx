import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { klassen } from "../hilfen";

export interface FeldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "children"> {
  label: ReactNode;
  hilfe?: ReactNode;
  /** Fehlermeldung; ersetzt den Hilfetext und markiert das Feld als ungültig. */
  fehler?: ReactNode;
  /** Zahlenfeld in Mono mit festen Ziffernbreiten. */
  zahl?: boolean;
  /** Die Beschriftung bleibt für Screenreader erhalten, steht aber nicht sichtbar über dem Feld (für Werkzeugleisten). */
  labelVersteckt?: boolean;
  /** Niedriges Feld (28 px) für Werkzeugleisten. */
  kompakt?: boolean;
  /** Im Formularraster über zwei Spalten (lange Werte, Auswahl mit langen Optionen). */
  breit?: boolean;
}

export function Feld({ label, hilfe, fehler, zahl, labelVersteckt, kompakt, breit, id, className, ...rest }: FeldProps) {
  const erzeugt = useId();
  const feldId = id ?? erzeugt;
  const meldung = fehler ?? hilfe;
  const meldungId = `${feldId}-meldung`;
  const ungueltig = fehler !== undefined && fehler !== null && fehler !== false;
  return (
    <div className={klassen("cw-feld", ungueltig && "cw-feld--fehler", kompakt && "cw-feld--kompakt", breit && "cw-feld--breit", className)}>
      <label className={klassen("cw-feld__label", labelVersteckt && "cw-nur-lesen")} htmlFor={feldId}>
        {label}
      </label>
      <input
        {...rest}
        id={feldId}
        className={klassen("cw-feld__eingabe", zahl && "cw-feld__eingabe--zahl")}
        aria-invalid={ungueltig || undefined}
        aria-describedby={meldung ? meldungId : undefined}
      />
      {meldung ? (
        <div id={meldungId} className="cw-feld__hilfe">
          {meldung}
        </div>
      ) : null}
    </div>
  );
}
