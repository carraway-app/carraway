import { Suspense, useEffect, useId, useRef, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { klassen } from "../hilfen";
import type { IconKomponente } from "../icons";
import { useUiTexte } from "../sprache";

export interface TabEintrag {
  id: string;
  label: ReactNode;
  /** Zeichen vor dem Namen (Phosphor, aus `@carraway/ui`, zum Beispiel `GearIcon`); Schmuck, der Name bleibt der zugängliche Name. */
  icon?: IconKomponente;
  /** Anzahl oder Kurzwert hinter dem Namen (zum Beispiel offene Einträge). */
  zaehler?: number | string;
  /** Zugänglicher Name des Zählers, wenn die Zahl allein nicht genügt (zum Beispiel „2 Deals“). */
  zaehlerLabel?: string;
  deaktiviert?: boolean;
  /** Inhalt des Reiters. Er wird nur gebaut und eingehängt, solange der Reiter aktiv ist (träges Laden). */
  inhalt?: () => ReactNode;
}

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "children"> {
  tabs: TabEintrag[];
  aktiv: string;
  onWechsel: (id: string) => void;
  "aria-label": string;
  /** Platzhalter, solange der Inhalt des aktiven Reiters noch lädt (jedes Panel hat eine eigene Grenze, die Leiste bleibt stehen). */
  laden?: ReactNode;
  /** Inhalt des aktiven Reiters, wenn die Einträge keinen eigenen `inhalt` tragen. */
  children?: ReactNode;
}

type Stufe = "tabs" | "untertabs";

/** Platzhalter in der Größe einer Liste; der Text ist nur für Screenreader. */
export function TabLaedt() {
  const t = useUiTexte();
  return (
    <div aria-busy="true">
      <span className="cw-nur-lesen" role="status">
        {t.laedt}
      </span>
      {[0, 1, 2].map((i) => (
        <span key={i} className="cw-skelett" aria-hidden="true" style={{ marginBottom: "var(--s-1)", height: "var(--zeile)" }} />
      ))}
    </div>
  );
}

/**
 * Gemeinsame Umsetzung von Reitern und Unterreitern: Tablist mit Roving-Tabindex. Pfeiltasten (links/rechts, Pos1/Ende)
 * bewegen den Fokus, Enter und Leertaste wählen aus (handbetätigt: ein Wechsel schreibt in die Adresse und in den Verlauf,
 * deshalb nicht bei jedem Pfeil). Deaktivierte Einträge werden übersprungen.
 */
function Reiterleiste({ stufe, tabs, aktiv, onWechsel, laden, children, className, "aria-label": ariaLabel, ...rest }: TabsProps & { stufe: Stufe }) {
  const basis = useId();
  const knoepfe = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [fokusId, setFokusId] = useState<string | null>(null);
  const tabId = (id: string) => `${basis}-tab-${id}`;
  const panelId = (id: string) => `${basis}-panel-${id}`;
  const frei = tabs.filter((t) => !t.deaktiviert);
  const aktuell = tabs.find((t) => t.id === aktiv);
  // Der Tab mit dem Tabulator-Stopp: der fokussierte, sonst der aktive, sonst der erste freie.
  const stopp = (fokusId && frei.some((t) => t.id === fokusId) ? fokusId : null) ?? (frei.some((t) => t.id === aktiv) ? aktiv : frei[0]?.id);

  function taste(e: KeyboardEvent, id: string) {
    const index = frei.findIndex((t) => t.id === id);
    const letzter = frei.length - 1;
    const ziel = { ArrowRight: index >= letzter ? 0 : index + 1, ArrowLeft: index <= 0 ? letzter : index - 1, Home: 0, End: letzter }[e.key];
    if (ziel === undefined) return;
    e.preventDefault();
    const eintrag = frei[ziel];
    if (!eintrag) return;
    setFokusId(eintrag.id);
    knoepfe.current.get(eintrag.id)?.focus();
  }

  // Passen die Reiter nicht in die Breite, scrollt die Leiste (mit Verlauf an den Kanten, siehe CSS); der aktive Reiter kommt dabei ins Bild.
  // Nur die Leiste wird verschoben, nie die Seite (kein `scrollIntoView`, das auch die Seite bewegen würde).
  useEffect(() => {
    const knopf = knoepfe.current.get(aktiv);
    const liste = knopf?.parentElement;
    if (!knopf || !liste) return;
    const zeigeReiter = () => {
      const k = knopf.getBoundingClientRect();
      const l = liste.getBoundingClientRect();
      // Bei Überlauf Platz für die ausgeblendete Kante lassen, soweit die Leiste scrollen kann.
      const scrollrand = liste.scrollWidth > liste.clientWidth ? parseFloat(getComputedStyle(liste).scrollPaddingInlineStart) || 0 : 0;
      const rand = Math.max(0, Math.min(scrollrand, (l.width - k.width) / 2));
      if (k.left < l.left + rand) liste.scrollLeft -= l.left + rand - k.left;
      else if (k.right > l.right - rand) liste.scrollLeft += k.right - (l.right - rand);
    };
    zeigeReiter();
    if (typeof ResizeObserver === "undefined") return;
    const beobachten = new ResizeObserver(zeigeReiter);
    beobachten.observe(liste);
    beobachten.observe(knopf);
    return () => beobachten.disconnect();
  }, [aktiv]);

  const inhalt = aktuell?.inhalt ? aktuell.inhalt() : children;
  const hatPanel = Boolean(aktuell) && inhalt !== undefined && inhalt !== null;
  const p = stufe === "tabs" ? "cw-tabs" : "cw-untertabs";
  return (
    <div className={klassen(p, className)} {...rest}>
      <div role="tablist" aria-label={ariaLabel} className={`${p}__liste`}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) knoepfe.current.set(tab.id, el);
              else knoepfe.current.delete(tab.id);
            }}
            id={tabId(tab.id)}
            type="button"
            role="tab"
            className={`${p}__tab`}
            aria-selected={tab.id === aktiv}
            aria-controls={hatPanel && tab.id === aktiv ? panelId(tab.id) : undefined}
            disabled={tab.deaktiviert}
            tabIndex={tab.id === stopp ? 0 : -1}
            onClick={() => {
              setFokusId(tab.id);
              if (tab.id !== aktiv) onWechsel(tab.id);
            }}
            onFocus={() => setFokusId(tab.id)}
            onKeyDown={(e) => taste(e, tab.id)}
          >
            {tab.icon ? <tab.icon size={16} /> : null}
            {tab.label}
            {tab.zaehler !== undefined ? " " : null}
            {tab.zaehler !== undefined ? <span className="cw-tabs__zaehler" aria-label={tab.zaehlerLabel}>{tab.zaehler}</span> : null}
          </button>
        ))}
      </div>
      {aktuell && hatPanel ? (
        <div id={panelId(aktuell.id)} role="tabpanel" aria-labelledby={tabId(aktuell.id)} tabIndex={0} className={`${p}__panel`}>
          <Suspense fallback={laden ?? <TabLaedt />}>{inhalt}</Suspense>
        </div>
      ) : null}
    </div>
  );
}

/** Primäre Reiter: die Bereiche einer Seite. Es ist immer nur ein Bereich sichtbar, nie mehrere Abschnitte untereinander. */
export function Tabs(props: TabsProps) {
  return <Reiterleiste stufe="tabs" {...props} />;
}

/** Sekundäre Reiter unter einem aktiven Reiter, zum Beispiel „Runden | Transaktionen | Wasserfall“ unter „Finanzierung“. */
export function UnterTabs(props: TabsProps) {
  return <Reiterleiste stufe="untertabs" {...props} />;
}
