import { useId, type ReactNode, type SelectHTMLAttributes } from "react";
import { klassen } from "../hilfen";
import { OHNE_PASSWORTMANAGER } from "./ohnePasswortmanager";

export interface AuswahlProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: ReactNode;
  hilfe?: ReactNode;
  /** Fehlermeldung; ersetzt den Hilfetext und markiert die Auswahl als ungültig. */
  fehler?: ReactNode;
  /** Niedrige Auswahl (28 px) für Werkzeugleisten. */
  kompakt?: boolean;
  /** Die Beschriftung bleibt für Screenreader erhalten, steht aber nicht sichtbar über der Auswahl. */
  labelVersteckt?: boolean;
  /** Im Formularraster über zwei Spalten (lange Optionen). */
  breit?: boolean;
}

/** Auswahlfeld im Aussehen von `Feld`; die Optionen kommen als `<option>` in die Kinder. */
export function Auswahl({ label, hilfe, fehler, kompakt, labelVersteckt, breit, id, className, children, ...rest }: AuswahlProps) {
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
      <select {...OHNE_PASSWORTMANAGER} {...rest} id={feldId} className="cw-feld__eingabe" aria-invalid={ungueltig || undefined} aria-describedby={meldung ? meldungId : undefined}>
        {children}
      </select>
      {meldung ? (
        <div id={meldungId} className="cw-feld__hilfe">
          {meldung}
        </div>
      ) : null}
    </div>
  );
}
