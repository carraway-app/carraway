import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { klassen } from "../hilfen";
import { CheckIcon } from "../icons";

export interface MenueEintrag {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  /** Mit Adresse wird der Eintrag ein Link; `onClick` kann die Navigation übernehmen (Router). */
  href?: string;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  gefahr?: boolean;
  deaktiviert?: boolean;
  /** Auswahleintrag (zum Beispiel die Sprache): `true` markiert den gewählten, `false` die anderen. */
  ausgewaehlt?: boolean;
  /** Linie über dem Eintrag. */
  trennerDavor?: boolean;
  /** Der Link öffnet in einem neuen Tab. */
  extern?: boolean;
  /** Zwischenüberschrift über dem Eintrag. */
  gruppe?: string;
}

export interface MenueProps {
  /** Inhalt des Auslösers (Zeichen, Name, Avatar). */
  ausloeser: ReactNode;
  /** Name des Menüs für Screenreader (und des Auslösers, wenn er nur ein Zeichen zeigt). */
  "aria-label": string;
  eintraege: MenueEintrag[];
  /** Kopf im Menü (zum Beispiel Name und Adresse), ohne Funktion. */
  kopf?: ReactNode;
  /** Eigener Block unter dem Kopf mit sichtbarer Beschriftung (zum Beispiel ein `MenueSegment` für das Thema; es trägt seinen Namen selbst); seine Schaltflächen sind Menüeinträge (`menuitemradio`) und lassen das Menü offen. */
  block?: { label: string; inhalt: ReactNode };
  /** Fuß im Menü (zum Beispiel die Version), ohne Funktion. */
  fuss?: ReactNode;
  /** Das Menü klappt nach unten (Standard, rechtsbündig) oder nach oben auf (für Auslöser am unteren Rand). */
  richtung?: "unten" | "oben";
  /** Kante, an der das Menü am Auslöser anliegt. */
  kante?: "rechts" | "links";
  /** Name des Auslösers, wenn er sichtbaren Text trägt (der Name muss den Text enthalten); sonst gilt `aria-label`. */
  ausloeserLabel?: string;
  /** Klassen des Auslöser-Buttons; ohne Angabe ein schlichter Icon-Button. */
  ausloeserKlasse?: string;
  /** Titel (Tooltip) des Auslösers. */
  title?: string;
  className?: string;
  /** Im Dokument positionieren, damit ein scrollender Container die Liste nicht abschneidet. */
  portal?: boolean;
}

/**
 * Auslöser mit aufklappendem Menü (`role="menu"`): Pfeiltasten, Pos1/Ende, Escape schließt und gibt den Fokus zurück,
 * Tab und Klick daneben schließen. Einträge sind Buttons oder Links.
 */
export function Menue({ ausloeser, "aria-label": ariaLabel, eintraege, kopf, block, fuss, richtung = "unten", kante = "rechts", ausloeserLabel, ausloeserKlasse, title, className, portal = false }: MenueProps) {
  const [offen, setOffen] = useState(false);
  const huelle = useRef<HTMLDivElement>(null);
  const knopf = useRef<HTMLButtonElement>(null);
  const liste = useRef<HTMLDivElement>(null);
  const startFokus = useRef<"erster" | "letzter">("erster");
  const id = useId();
  const eintragElemente = () => Array.from(liste.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []);

  useEffect(() => {
    if (!offen) return;
    const klickEreignis = portal ? "pointerdown" : "mousedown";
    const beiKlick = (e: globalThis.MouseEvent) => {
      if (!(e.target instanceof Node) || huelle.current?.contains(e.target) || liste.current?.contains(e.target)) return;
      if (portal && liste.current?.contains(document.activeElement)) knopf.current?.focus({ preventScroll: true });
      setOffen(false);
    };
    // Escape schließt von überall aus, auch wenn der Fokus noch auf dem Auslöser liegt (Öffnen per Maus).
    const beiTaste = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOffen(false);
      knopf.current?.focus();
    };
    document.addEventListener(klickEreignis, beiKlick);
    document.addEventListener("keydown", beiTaste);
    return () => {
      document.removeEventListener(klickEreignis, beiKlick);
      document.removeEventListener("keydown", beiTaste);
    };
  }, [offen, portal]);

  useLayoutEffect(() => {
    const el = liste.current;
    const ausloeser = knopf.current;
    if (!offen || !portal || !el || !ausloeser) return;
    const rand = 8;
    const abstand = 4;
    const scrollRahmen = ausloeser.closest<HTMLElement>('[tabindex="0"]');
    const scrollStart = { links: scrollRahmen?.scrollLeft, oben: scrollRahmen?.scrollTop };
    let letztePosition = ausloeser.getBoundingClientRect();
    const positionieren = () => {
      const anker = ausloeser.getBoundingClientRect();
      letztePosition = anker;
      const breite = document.documentElement.clientWidth || window.innerWidth;
      const hoehe = document.documentElement.clientHeight || window.innerHeight;
      const oben = anker.top - rand - abstand;
      const unten = hoehe - anker.bottom - rand - abstand;
      const nachOben = el.scrollHeight > unten && oben > unten;
      el.style.maxHeight = `${Math.max(0, nachOben ? oben : unten)}px`;
      const x = kante === "links" ? anker.left : anker.right - el.offsetWidth;
      el.style.left = `${Math.max(rand, Math.min(x, breite - rand - el.offsetWidth))}px`;
      el.style.top = `${Math.max(rand, nachOben ? anker.top - abstand - el.offsetHeight : anker.bottom + abstand)}px`;
    };
    const beiScrollen = (e: Event) => {
      if (!(e.target instanceof Node) || el.contains(e.target)) return;
      const anker = ausloeser.getBoundingClientRect();
      // Der Fokus auf den Auslöser kann beim Öffnen noch ein Scroll-Ereignis auslösen.
      if (anker.x === letztePosition.x && anker.y === letztePosition.y && scrollRahmen?.scrollLeft === scrollStart.links && scrollRahmen?.scrollTop === scrollStart.oben) return;
      if (el.contains(document.activeElement)) (scrollRahmen ?? ausloeser).focus({ preventScroll: true });
      setOffen(false);
    };
    positionieren();
    const elemente = el.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])');
    elemente[startFokus.current === "erster" ? 0 : elemente.length - 1]?.focus({ preventScroll: true });
    document.addEventListener("scroll", beiScrollen, true);
    window.addEventListener("resize", positionieren);
    return () => {
      document.removeEventListener("scroll", beiScrollen, true);
      window.removeEventListener("resize", positionieren);
    };
  }, [offen, portal, kante]);

  function fokusAuf(position: "erster" | "letzter") {
    // Das Menü ist erst nach dem Zeichnen im Baum.
    queueMicrotask(() => {
      const e = eintragElemente();
      (position === "erster" ? e[0] : e.at(-1))?.focus();
    });
  }

  function beiAusloeserTaste(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      startFokus.current = e.key === "ArrowDown" ? "erster" : "letzter";
      setOffen(true);
      if (!portal || offen) fokusAuf(startFokus.current);
    }
  }

  function beiListenTaste(e: KeyboardEvent<HTMLDivElement>) {
    const elemente = eintragElemente();
    const index = elemente.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
    } else if (e.key === "Tab") {
      if (portal) knopf.current?.focus({ preventScroll: true });
      setOffen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      elemente[(index + 1) % elemente.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      elemente[(index - 1 + elemente.length) % elemente.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      elemente[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      elemente.at(-1)?.focus();
    }
  }

  function waehle(eintrag: MenueEintrag, e: MouseEvent<HTMLElement>) {
    if (eintrag.deaktiviert) {
      e.preventDefault();
      return;
    }
    if (portal) knopf.current?.focus({ preventScroll: true });
    eintrag.onClick?.(e);
    setOffen(false);
    // Der Fokus kehrt zum Auslöser zurück, außer der Eintrag hat die Seite gewechselt.
    if (!portal) knopf.current?.focus();
  }

  const listenInhalt = offen ? (
        <div ref={liste} id={id} role="menu" aria-label={ariaLabel} className={klassen("cw-menue__liste", portal && "cw-menue__liste--portal")} onKeyDown={beiListenTaste}>
          {kopf ? <div className="cw-menue__kopf">{kopf}</div> : null}
          {block ? (
            <div role="none" className="cw-menue__block">
              <span className="cw-menue__gruppe" aria-hidden="true">
                {block.label}
              </span>
              {block.inhalt}
            </div>
          ) : null}
          {eintraege.map((e) => {
            const rolle = e.ausgewaehlt === undefined ? "menuitem" : "menuitemradio";
            const gemeinsam = {
              role: rolle,
              "aria-checked": e.ausgewaehlt === undefined ? undefined : e.ausgewaehlt,
              "aria-disabled": e.deaktiviert ? true : undefined,
              className: klassen("cw-menue__eintrag", e.gefahr && "cw-menue__eintrag--gefahr"),
              tabIndex: -1,
              onClick: (ev: MouseEvent<HTMLElement>) => waehle(e, ev),
            } as const;
            return (
              <div key={e.id} role="none">
                {e.trennerDavor ? <div className="cw-menue__trenner" role="separator" /> : null}
                {e.gruppe ? <span className="cw-menue__gruppe">{e.gruppe}</span> : null}
                {e.href ? (
                  <a {...gemeinsam} href={e.href} {...(e.extern ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                    {e.icon}
                    {e.label}
                  </a>
                ) : (
                  <button {...gemeinsam} type="button" disabled={e.deaktiviert}>
                    {e.icon}
                    {e.label}
                    {e.ausgewaehlt ? <CheckIcon className="cw-menue__haken" /> : null}
                  </button>
                )}
              </div>
            );
          })}
          {fuss ? <div className="cw-menue__fuss">{fuss}</div> : null}
        </div>
  ) : null;
  return (
    <div ref={huelle} className={klassen("cw-menue", `cw-menue--${richtung}`, block && "cw-menue--mit-block", kante === "links" && "cw-menue--links", className)}>
      <button
        ref={knopf}
        type="button"
        className={ausloeserKlasse ?? "cw-button cw-button--sekundaer cw-button--icon"}
        aria-label={ausloeserLabel ?? ariaLabel}
        title={title}
        aria-haspopup="menu"
        aria-expanded={offen}
        aria-controls={offen ? id : undefined}
        onClick={() => {
          startFokus.current = "erster";
          setOffen(!offen);
        }}
        onKeyDown={beiAusloeserTaste}
      >
        {ausloeser}
      </button>
      {portal && listenInhalt ? createPortal(listenInhalt, document.body) : listenInhalt}
    </div>
  );
}
