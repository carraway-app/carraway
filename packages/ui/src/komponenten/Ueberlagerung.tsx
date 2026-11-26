import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { klassen } from "../hilfen";
import { useUiTexte } from "../sprache";
import { Button } from "./Button";

const FOKUSSIERBAR = "a[href], button, input, select, textarea, [tabindex]";
const stapel: { dialog: HTMLElement; ausloeser: HTMLElement | null }[] = [];

function fokusziele(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOKUSSIERBAR)).filter((element) =>
    element.tabIndex >= 0 && !element.matches(":disabled, input[type=hidden]") &&
    !element.closest("[hidden], [inert]") &&
    (element.checkVisibility?.({ visibilityProperty: true }) ?? getComputedStyle(element).visibility !== "hidden"),
  );
}

function fokussiereDialog(dialog: HTMLElement) {
  (fokusziele(dialog)[0] ?? dialog).focus({ preventScroll: true });
}

/**
 * Gemeinsames Verhalten von Seitenpanel und Dialog: Fokus wandert hinein und bleibt beim Tabulator drin,
 * Escape und Klick auf den Hintergrund schließen, der Fokus kehrt zum Auslöser zurück.
 */
function useUeberlagerung(onSchliessen: () => void) {
  const panel = useRef<HTMLDivElement>(null);
  const schliessen = useRef(onSchliessen);
  schliessen.current = onSchliessen;

  useEffect(() => {
    const dialog = panel.current;
    if (!dialog) return;
    const ausloeser = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const ebene = { dialog, ausloeser };
    const bisher = stapel.at(-1);
    stapel.push(ebene);
    fokussiereDialog(dialog);
    if (bisher) bisher.dialog.inert = true;
    const beiTaste = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || stapel.at(-1) !== ebene) return;
      if (e.key === "Escape") {
        e.preventDefault();
        schliessen.current();
      }
    };
    document.addEventListener("keydown", beiTaste);
    return () => {
      document.removeEventListener("keydown", beiTaste);
      const index = stapel.indexOf(ebene);
      const darueber = stapel[index + 1];
      stapel.splice(index, 1);
      if (darueber) {
        if (dialog.contains(darueber.ausloeser)) darueber.ausloeser = ebene.ausloeser;
        return;
      }
      const darunter = stapel.at(-1);
      if (darunter) darunter.dialog.inert = false;
      if (ebene.ausloeser?.isConnected && (!darunter || darunter.dialog.contains(ebene.ausloeser))) {
        ebene.ausloeser.focus({ preventScroll: true });
      }
      if (darunter && !darunter.dialog.contains(document.activeElement)) fokussiereDialog(darunter.dialog);
    };
  }, []);

  function haltFokus(e: ReactKeyboardEvent) {
    if (e.defaultPrevented || e.key !== "Tab" || !panel.current || stapel.at(-1)?.dialog !== panel.current) return;
    const elemente = fokusziele(panel.current);
    const ziel = e.shiftKey ? elemente.at(-1) : elemente[0];
    const rand = e.shiftKey ? elemente[0] : elemente.at(-1);
    if (document.activeElement === rand || !elemente.includes(document.activeElement as HTMLElement)) {
      e.preventDefault();
      (ziel ?? panel.current).focus();
    }
  }
  return { panel, haltFokus };
}

export interface SeitenpanelProps {
  /** Name für Screenreader; die Überschrift steht im Inhalt. */
  titel: string;
  onSchliessen: () => void;
  breit?: boolean;
  children: ReactNode;
}

/** Formulare und Detailansichten liefern ihre sichtbare Überschrift im Inhalt. */
export function Seitenpanel(props: SeitenpanelProps) {
  return <Dialogfenster {...props} titelImInhalt />;
}

export interface DialogProps extends SeitenpanelProps {
  /** Schaltflächen im Fuß; ohne Angabe nur „Schließen“. */
  aktionen?: ReactNode;
}

export function Dialog(props: DialogProps) {
  return <Dialogfenster {...props} />;
}

function Dialogfenster({ titel, onSchliessen, breit, aktionen, children, titelImInhalt }: DialogProps & { titelImInhalt?: boolean }) {
  const t = useUiTexte();
  const { panel, haltFokus } = useUeberlagerung(onSchliessen);
  const titelId = useId();
  return createPortal(
    <div
      className="cw-ueberlagerung cw-dialoghintergrund"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        onSchliessen();
      }}
    >
      <div
        ref={panel}
        className={klassen("cw-dialog", breit && "cw-dialog--breit", titelImInhalt && "cw-dialog--inhalt")}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label={titelImInhalt ? titel : undefined}
        aria-labelledby={titelImInhalt ? undefined : titelId}
        onKeyDown={haltFokus}
      >
        {titelImInhalt ? (
          <div className="cw-dialog__inhalt">{children}</div>
        ) : (
          <>
            <h2 id={titelId} className="cw-dialog__titel">{titel}</h2>
            {children}
          </>
        )}
        <div className="cw-dialog__fuss">
          {aktionen ?? <Button variante="sekundaer" onClick={onSchliessen}>{t.schliessen}</Button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
