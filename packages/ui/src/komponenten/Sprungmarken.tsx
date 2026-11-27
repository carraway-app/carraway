import { useEffect, useRef, useState, type HTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { klassen } from "../hilfen";

export interface Sprungmarke {
  /** Kennung des Abschnitts; der Abschnitt trägt `id={sprungId(id)}`. */
  id: string;
  label: ReactNode;
  zaehler?: number | string;
}

export interface SprungmarkenProps extends Omit<HTMLAttributes<HTMLElement>, "onChange"> {
  marken: Sprungmarke[];
  "aria-label": string;
  /** Abschnitt, zu dem beim ersten Zeichnen gesprungen wird (zum Beispiel aus einer älteren Adresse). */
  ziel?: string;
  /** Meldet den gewählten Abschnitt (zum Beispiel, um ihn ohne neuen Verlaufseintrag in die Adresse zu schreiben). */
  onWahl?: (id: string) => void;
}

/** Element-Id eines Abschnitts mit Sprungmarke. */
export const sprungId = (id: string) => `abschnitt-${id}`;

/**
 * Sprungmarken für Abschnitte, die man zusammen liest: eine Zeile kleiner Marken unter dem Kopf, die beim Scrollen stehen bleibt.
 * Die Marke des Abschnitts, der gerade oben steht, ist hervorgehoben (`aria-current`); ein Klick springt hin und setzt den Fokus.
 */
export function Sprungmarken({ marken, ziel, onWahl, className, "aria-label": ariaLabel, ...rest }: SprungmarkenProps) {
  const [aktiv, setAktiv] = useState(ziel ?? marken[0]?.id);
  const erster = useRef(true);
  const schluessel = marken.map((m) => m.id).join("|");

  // Beim ersten Zeichnen zum gewünschten Abschnitt springen (ältere Adressen mit einem Reiter für diesen Abschnitt).
  useEffect(() => {
    if (!erster.current) return;
    erster.current = false;
    if (!ziel || ziel === marken[0]?.id) return;
    const el = document.getElementById(sprungId(ziel));
    el?.scrollIntoView?.({ block: "start" });
  }, [ziel, marken]);

  // Der Abschnitt, dessen Kopf zuletzt über die obere Kante lief, ist der aktuelle.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const ids = schluessel.split("|");
    const elemente = ids.map((id) => document.getElementById(sprungId(id))).filter((el): el is HTMLElement => el !== null);
    if (elemente.length === 0) return;
    const sichtbar = new Map<string, boolean>();
    const beobachter = new IntersectionObserver(
      (eintraege) => {
        for (const e of eintraege) sichtbar.set(e.target.id, e.isIntersecting);
        const erster = ids.find((id) => sichtbar.get(sprungId(id)));
        if (erster) setAktiv(erster);
      },
      { rootMargin: "-160px 0px -55% 0px" },
    );
    for (const el of elemente) beobachter.observe(el);
    return () => beobachter.disconnect();
  }, [schluessel]);

  function springe(e: MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault();
    const el = document.getElementById(sprungId(id));
    if (!el) return;
    setAktiv(id);
    el.scrollIntoView?.({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    el.focus?.({ preventScroll: true });
    onWahl?.(id);
  }

  if (marken.length < 2) return null;
  return (
    <nav className={klassen("cw-sprungmarken", className)} aria-label={ariaLabel} {...rest}>
      <ul className="cw-sprungmarken__liste">
        {marken.map((m) => (
          <li key={m.id}>
            <a className="cw-sprungmarken__marke" href={`#${sprungId(m.id)}`} aria-current={m.id === aktiv ? "location" : undefined} onClick={(e) => springe(e, m.id)}>
              {m.label}
              {m.zaehler !== undefined ? <span className="cw-tabs__zaehler">{m.zaehler}</span> : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Abschnitt mit Sprungmarke: Ziel des Sprungs und des Fokus. Mit `titel` trägt er eine eigene Überschrift; ohne Titel bringt der Inhalt seine
 * Überschrift mit (zum Beispiel eine Karte), der Name kommt dann aus `label`.
 */
export function SprungAbschnitt({ id, titel, label, aktionen, children, className }: { id: string; titel?: ReactNode; label?: string; aktionen?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={sprungId(id)} tabIndex={-1} aria-labelledby={titel ? `${sprungId(id)}-titel` : undefined} aria-label={titel ? undefined : label} className={klassen("cw-sprungabschnitt", className)}>
      {titel ? (
        <div className="cw-sprungabschnitt__kopf">
          <h2 id={`${sprungId(id)}-titel`} className="cw-t-untertitel">
            {titel}
          </h2>
          {aktionen ? <div className="cw-sprungabschnitt__aktionen">{aktionen}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
