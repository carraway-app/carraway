import { Suspense, lazy, useId, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import { klassen } from "../hilfen";
import { useUiTexte } from "../sprache";
import { Button } from "./Button";

// Der Markdown-Baustein wird erst geladen, wenn jemand die Vorschau öffnet.
const Vorschau = lazy(() => import("./Markdown").then((m) => ({ default: m.Markdown })));

export interface TextbereichProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: ReactNode;
  hilfe?: ReactNode;
  /** Fehlermeldung; ersetzt den Hilfetext und markiert das Feld als ungültig. */
  fehler?: ReactNode;
  /** Das Feld nimmt Markdown an: Hinweis zur Schreibweise und Umschalter „Vorschau“. Gespeichert wird immer der Quelltext. */
  markdown?: boolean;
}

/** Mehrzeiliges Textfeld im Aussehen von `Feld`. */
export function Textbereich({ label, hilfe, fehler, id, className, rows = 4, markdown = false, ...rest }: TextbereichProps) {
  const t = useUiTexte();
  const erzeugt = useId();
  const feldId = id ?? erzeugt;
  const eingabe = useRef<HTMLTextAreaElement>(null);
  const [vorschau, setVorschau] = useState<string | null>(null);
  const meldung = fehler ?? hilfe ?? (markdown ? t.markdownHilfe : undefined);
  const meldungId = `${feldId}-meldung`;
  const ungueltig = fehler !== undefined && fehler !== null && fehler !== false;
  const zeigeVorschau = markdown && vorschau !== null;
  const feld = (
    <textarea
      {...rest}
      ref={eingabe}
      id={feldId}
      rows={rows}
      hidden={zeigeVorschau}
      className="cw-feld__eingabe cw-feld__eingabe--mehrzeilig"
      aria-invalid={ungueltig || undefined}
      aria-describedby={meldung ? meldungId : undefined}
    />
  );
  return (
    <div className={klassen("cw-feld", ungueltig && "cw-feld--fehler", className)}>
      {markdown ? (
        <div className="cw-feld__kopfzeile">
          <label className="cw-feld__label" htmlFor={feldId}>
            {label}
          </label>
          <Button
            variante="ruhig"
            groesse="s"
            aria-pressed={zeigeVorschau}
            onClick={() => setVorschau(zeigeVorschau ? null : (eingabe.current?.value ?? ""))}
          >
            {zeigeVorschau ? t.markdownBearbeiten : t.markdownVorschau}
          </Button>
        </div>
      ) : (
        <label className="cw-feld__label" htmlFor={feldId}>
          {label}
        </label>
      )}
      {feld}
      {zeigeVorschau ? (
        <div className="cw-feld__vorschau" aria-live="polite">
          {vorschau!.trim() === "" ? (
            <span className="cw-feld__hilfe">{t.markdownVorschauLeer}</span>
          ) : (
            <Suspense fallback={<span className="cw-feld__hilfe">{t.laedt}</span>}>
              <Vorschau text={vorschau} />
            </Suspense>
          )}
        </div>
      ) : null}
      {meldung ? (
        <div id={meldungId} className="cw-feld__hilfe">
          {meldung}
        </div>
      ) : null}
    </div>
  );
}
