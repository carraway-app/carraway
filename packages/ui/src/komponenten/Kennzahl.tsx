import { useId, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { klassen } from "../hilfen";
import { useUiTexte } from "../sprache";
import { CalculatorIcon } from "../icons/Calculator";

export interface KennzahlProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  titel: string;
  wert: ReactNode;
  /** Meist eine `<Delta />`. */
  delta?: ReactNode;
  /** Betont die Kennzahl dezent (Gewicht und Farbe), ohne Umrandung: Eine Umrandung liest sich als aktive Auswahl. */
  hervorgehoben?: boolean;
  /** Öffnet die Herkunft beim Aktivieren der Kachel; mit `onZiel` steht dafür ein eigener Symbolknopf in der Kachel. */
  onHerkunft?: () => void;
  /** Beschreibt den Rechenweg der Kachel oder benennt den eigenen Symbolknopf. */
  herkunftLabel?: string;
  /** Die Kachel springt zur passenden Stelle (die Seite entscheidet, wohin). */
  onZiel?: () => void;
  /** Zugänglicher Name für den Sprung. Ohne Angabe benennen Titel und Wert die Kachel. */
  zielLabel?: string;
}

export function Kennzahl({ titel, wert, delta, hervorgehoben, onHerkunft, herkunftLabel, onZiel, zielLabel, className, ...rest }: KennzahlProps) {
  const t = useUiTexte();
  const id = useId();
  const klasse = klassen("cw-kennzahl", hervorgehoben && "cw-kennzahl--hervorgehoben", className);
  const inhalt = (
    <>
      <span className="cw-kennzahl__kopf">{titel}</span>
      {" "}
      <span className="cw-kennzahl__wert" style={typeof wert === "string" ? ({ "--zeichen": Math.max(1, Array.from(wert).length) } as CSSProperties) : undefined}>
        {wert}
      </span>
      {" "}
      {delta && onHerkunft ? <span>{delta}</span> : delta}
    </>
  );

  if (onZiel) {
    // Sprung und Rechenweg sind Geschwister: ein Knopf darf keinen zweiten enthalten.
    return (
      <div {...rest} className={klassen(klasse, "cw-kennzahl--ziel", onHerkunft && "cw-kennzahl--rechenweg")}>
        <button type="button" className="cw-kennzahl__ziel" aria-label={zielLabel} onClick={onZiel}>
          {inhalt}
        </button>
        {onHerkunft ? (
          <button type="button" className="cw-kennzahl__rechenweg" aria-label={herkunftLabel ?? t.herkunftAnzeigen(titel)} onClick={onHerkunft}>
            <CalculatorIcon size={16} />
          </button>
        ) : null}
      </div>
    );
  }

  if (!onHerkunft) return <div className={klasse} {...rest}>{inhalt}</div>;

  return (
    <button
      {...rest}
      type="button"
      className={klassen(klasse, "cw-kennzahl--rechenweg")}
      aria-describedby={[id, rest["aria-describedby"]].filter(Boolean).join(" ")}
      onClick={(event) => {
        onHerkunft();
        rest.onClick?.(event);
      }}
    >
      {inhalt}
      <span id={id} hidden>{herkunftLabel ?? t.herkunftAnzeigen(titel)}</span>
      {/* Dasselbe Zeichen wie bei Kacheln mit Sprung: Es zeigt, dass ein Rechenweg da ist; hier öffnet ihn die ganze Kachel. */}
      <span className="cw-kennzahl__rechenweg cw-kennzahl__rechenweg--zeichen" aria-hidden="true">
        <CalculatorIcon size={16} />
      </span>
    </button>
  );
}
