import { useId, useRef, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { klassen } from "../hilfen";

export interface CodeEingabeProps {
  /** Beschriftung der Gruppe, z. B. „Code aus der Authenticator-App“. */
  label: ReactNode;
  /** Beschriftung je Feld für Screenreader, z. B. „Ziffer 1 von 6“; `nr` zählt ab 1. */
  ziffer: (nr: number, von: number) => string;
  /** Die bisher eingegebenen Ziffern ohne Lücken (höchstens `laenge`). */
  value: string;
  onChange: (value: string) => void;
  /** Wird aufgerufen, sobald alle Felder gefüllt sind (Tippen oder Einfügen); bekommt den vollständigen Code. */
  onFertig?: (code: string) => void;
  /** Anzahl der Ziffern; Vorgabe 6. */
  laenge?: number;
  /** Fehlermeldung; markiert die Felder als ungültig. */
  fehler?: ReactNode;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Basisname der Felder (`<name>-1` …) für Formulare und Tests. */
  name?: string;
  className?: string;
}

const nurZiffern = (s: string) => s.replace(/\D/g, "");

/**
 * Code aus einzelnen Ziffernfeldern (zweiter Faktor): nur Ziffern, Fokus springt weiter, Rücktaste geht zurück, Pfeiltasten wechseln das Feld,
 * Einfügen verteilt den Code (auch mit Leerzeichen). Das erste Feld trägt `autocomplete="one-time-code"` für System- und Passwortmanager-Vorschläge.
 * Der Wert bleibt immer lückenlos: Eingabe und Fokus gehen nie über das erste leere Feld hinaus.
 */
export function CodeEingabe({ label, ziffer, value, onChange, onFertig, laenge = 6, fehler, disabled, autoFocus, name, className }: CodeEingabeProps) {
  const id = useId();
  const felder = useRef<(HTMLInputElement | null)[]>([]);
  const aktuell = useRef(value);
  aktuell.current = value;
  const ungueltig = fehler !== undefined && fehler !== null && fehler !== false;
  const meldungId = `${id}-meldung`;

  function setze(neu: string, fokus: number) {
    const code = neu.slice(0, laenge);
    const vorher = aktuell.current;
    aktuell.current = code;
    onChange(code);
    felder.current[Math.max(0, Math.min(fokus, laenge - 1))]?.focus();
    if (code.length === laenge && vorher !== code) onFertig?.(code);
  }

  function eingabe(i: number, roh: string) {
    const wert = aktuell.current;
    const alt = wert[i];
    let neu = nurZiffern(roh);
    // Ein belegtes Feld zeigt die alte Ziffer plus die neue: die alte einmal abziehen.
    if (alt !== undefined && roh.length > 1) neu = neu.replace(alt, "");
    if (neu === "") return;
    const start = Math.min(i, wert.length);
    const rest = neu.length === 1 && alt !== undefined ? wert.slice(i + 1) : "";
    setze(wert.slice(0, start) + neu + rest, start + neu.length);
  }

  function taste(i: number, e: KeyboardEvent<HTMLInputElement>) {
    const wert = aktuell.current;
    if (e.key === "Backspace") {
      e.preventDefault();
      if (i < wert.length) setze(wert.slice(0, i) + wert.slice(i + 1), i);
      else if (i > 0) setze(wert.slice(0, i - 1) + wert.slice(i), i - 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      felder.current[Math.max(0, i - 1)]?.focus();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      felder.current[Math.min(laenge - 1, wert.length, i + 1)]?.focus();
    }
  }

  function einfuegen(i: number, e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const ziffern = nurZiffern(e.clipboardData.getData("text"));
    if (ziffern === "") return;
    const start = ziffern.length >= laenge ? 0 : Math.min(i, aktuell.current.length);
    setze(aktuell.current.slice(0, start) + ziffern, start + ziffern.length);
  }

  return (
    <div role="group" aria-labelledby={`${id}-label`} aria-describedby={ungueltig ? meldungId : undefined} className={klassen("cw-code", ungueltig && "cw-code--fehler", className)}>
      <span id={`${id}-label`} className="cw-feld__label">
        {label}
      </span>
      <div className="cw-code__felder">
        {Array.from({ length: laenge }, (_, i) => (
          <input
            key={i}
            ref={(el) => {
              felder.current[i] = el;
            }}
            className="cw-code__ziffer"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            name={name ? `${name}-${i + 1}` : undefined}
            autoComplete={i === 0 ? "one-time-code" : "off"}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label={ziffer(i + 1, laenge)}
            aria-invalid={ungueltig || undefined}
            disabled={disabled}
            autoFocus={autoFocus && i === 0}
            value={value[i] ?? ""}
            onChange={(e) => eingabe(i, e.target.value)}
            onKeyDown={(e) => taste(i, e)}
            onPaste={(e) => einfuegen(i, e)}
            onFocus={(e) => {
              // Nie hinter das erste leere Feld: der Code bleibt lückenlos.
              if (i > aktuell.current.length) felder.current[aktuell.current.length]?.focus();
              else e.target.select();
            }}
          />
        ))}
      </div>
      {ungueltig ? (
        <div id={meldungId} className="cw-feld__hilfe">
          {fehler}
        </div>
      ) : null}
    </div>
  );
}
