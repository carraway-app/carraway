import { Suspense, useEffect, useId, useLayoutEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { klassen } from "../hilfen";
import { CaretDownIcon, type IconKomponente } from "../icons";
import { Menue } from "./Menue";
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
  /** Die Reiterleiste bleibt beim Scrollen unter dem Kontextkopf stehen (Reiter einer Seite, nicht in einer Karte). */
  fest?: boolean;
}

type Stufe = "tabs" | "untertabs";

/** Platz für den Auslöser „Mehr“, solange er noch nicht gemessen ist. */
const MEHR_SCHAETZUNG = 88;

/**
 * Welche Reiter passen in die Breite? Der aktive bleibt immer sichtbar, die übrigen in ihrer Reihenfolge, solange sie neben dem
 * Auslöser „Mehr“ Platz haben; der Rest steht im Menü. Ohne gemessene Breiten (zum Beispiel ohne Layout) bleiben alle sichtbar.
 */
export function reiterImUeberlauf(ids: string[], aktiv: string, breiten: Map<string, number>, verfuegbar: number, abstand: number, mehrBreite: number): Set<string> {
  if (verfuegbar <= 0 || ids.some((id) => !(breiten.get(id)! > 0))) return new Set();
  const summe = (liste: string[]) => liste.reduce((s, id) => s + breiten.get(id)!, 0) + Math.max(0, liste.length - 1) * abstand;
  if (summe(ids) <= verfuegbar) return new Set();
  const platz = verfuegbar - mehrBreite;
  const sichtbar = new Set(ids.includes(aktiv) ? [aktiv] : []);
  let belegt = ids.includes(aktiv) ? breiten.get(aktiv)! : 0;
  for (const id of ids) {
    if (sichtbar.has(id)) continue;
    const neu = belegt + (sichtbar.size > 0 ? abstand : 0) + breiten.get(id)!;
    if (neu > platz) break;
    sichtbar.add(id);
    belegt = neu;
  }
  return new Set(ids.filter((id) => !sichtbar.has(id)));
}

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
function Reiterleiste({ stufe, tabs, aktiv, onWechsel, laden, children, className, fest, "aria-label": ariaLabel, ...rest }: TabsProps & { stufe: Stufe }) {
  const ui = useUiTexte();
  const basis = useId();
  const knoepfe = useRef<Map<string, HTMLButtonElement>>(new Map());
  const leiste = useRef<HTMLDivElement>(null);
  const mehr = useRef<HTMLDivElement>(null);
  const breiten = useRef<Map<string, number>>(new Map());
  const [versteckt, setVersteckt] = useState<Set<string>>(() => new Set());
  const [fokusId, setFokusId] = useState<string | null>(null);
  const tabId = (id: string) => `${basis}-tab-${id}`;
  const panelId = (id: string) => `${basis}-panel-${id}`;
  const frei = tabs.filter((t) => !t.deaktiviert && !versteckt.has(t.id));
  const schluessel = tabs.map((t) => t.id).join("|");

  // Überlauf: Reiter, die nicht in die Breite passen, wandern in das Menü „Mehr“ am Ende der Leiste (statt die Leiste zu scrollen).
  // Die Breiten werden gemessen, solange ein Reiter sichtbar ist, und für ausgeblendete aus dem Speicher genommen.
  useLayoutEffect(() => {
    const huelle = leiste.current;
    if (!huelle) return;
    const berechne = () => {
      for (const [id, knopf] of knoepfe.current) {
        if (knopf.hidden) continue;
        const b = knopf.getBoundingClientRect().width;
        if (b > 0) breiten.current.set(id, b);
      }
      const liste = huelle.querySelector<HTMLElement>('[role="tablist"]');
      const stil = liste ? getComputedStyle(liste) : null;
      const abstand = stil ? parseFloat(stil.columnGap) || 0 : 0;
      const h = huelle.getBoundingClientRect();
      const hs = getComputedStyle(huelle);
      const verfuegbar = h.width - (parseFloat(hs.paddingLeft) || 0) - (parseFloat(hs.paddingRight) || 0);
      // Platz für „Mehr“ samt Abstand in der Leiste und etwas Luft (der aktive Reiter ist fetter gesetzt als beim Messen).
      const mehrBreite = (mehr.current?.getBoundingClientRect().width || MEHR_SCHAETZUNG) + (parseFloat(hs.columnGap) || 0) + 4;
      const neu = reiterImUeberlauf(tabs.map((t) => t.id), aktiv, breiten.current, verfuegbar, abstand, mehrBreite);
      setVersteckt((alt) => (alt.size === neu.size && [...neu].every((id) => alt.has(id)) ? alt : neu));
    };
    berechne();
    if (typeof ResizeObserver === "undefined") return;
    const beobachten = new ResizeObserver(berechne);
    beobachten.observe(huelle);
    // Auch die Reiter selbst: Schriften laden nach und Zähler ändern sich, dann stimmen die gemessenen Breiten nicht mehr.
    for (const knopf of knoepfe.current.values()) beobachten.observe(knopf);
    return () => beobachten.disconnect();
    // `tabs` wechselt bei jedem Rendern die Identität; maßgeblich sind die Kennungen, der aktive Reiter und ob „Mehr“ steht (dann mit gemessener statt geschätzter Breite).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schluessel, aktiv, versteckt.size > 0]);
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

  // Reicht selbst der aktive Reiter neben „Mehr“ nicht (sehr schmale Fenster), scrollt die Leiste (mit Verlauf an den Kanten, siehe CSS); der aktive Reiter kommt dabei ins Bild.
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
  const imMenue = tabs.filter((t) => versteckt.has(t.id));
  return (
    <div className={klassen(p, fest && `${p}--fest`, className)} {...rest}>
      <div ref={leiste} className={`${p}__leiste`}>
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
              hidden={versteckt.has(tab.id)}
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
        {imMenue.length > 0 ? (
          <div ref={mehr} className={`${p}__mehr`}>
            <Menue
              aria-label={`${ui.mehrReiter}: ${ariaLabel}`}
              ausloeserLabel={`+${imMenue.length} ${ui.mehrReiter}`}
              ausloeserKlasse={`${p}__tab ${p}__mehrknopf`}
            className="cw-tabs__mehrmenue"
              ausloeser={
                <>
                  <span aria-hidden="true">+{imMenue.length}</span> {ui.mehrReiter}
                  <CaretDownIcon size={14} />
                </>
              }
              // Das Menü listet alle Reiter wie ihre Köpfe (Zeichen, Name, Details); der aktive ist markiert, ein Klick wählt direkt aus.
              eintraege={tabs.map((tab) => ({
                id: tab.id,
                icon: tab.icon ? <tab.icon size={16} /> : undefined,
                label: (
                  <span className={`${p}__menuekopf`}>
                    {tab.label}
                    {tab.zaehler !== undefined ? <span className="cw-tabs__zaehler" aria-label={tab.zaehlerLabel}>{tab.zaehler}</span> : null}
                  </span>
                ),
                ausgewaehlt: tab.id === aktiv,
                deaktiviert: tab.deaktiviert,
                onClick: () => {
                  if (tab.id !== aktiv) onWechsel(tab.id);
                },
              }))}
            />
          </div>
        ) : null}
      </div>
      {aktuell && hatPanel ? (
        <div id={panelId(aktuell.id)} role="tabpanel" aria-labelledby={tabId(aktuell.id)} tabIndex={0} className={`${p}__panel`}>
          <Suspense fallback={laden ?? <TabLaedt />}>{inhalt}</Suspense>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Reiter: 2 bis 5 gleichrangige Sichten desselben Bereichs, die man nacheinander braucht. Jeder Reiter steht in der Adresse, das Wichtigste
 * auf dem ersten, Zähler zeigen Inhalt auf den anderen. Keine Reiter in Reitern; was man zusammen liest, steht untereinander mit Sprungmarken.
 */
export function Tabs(props: TabsProps) {
  return <Reiterleiste stufe="tabs" {...props} />;
}

/** Sekundäre Reiter unter einem aktiven Reiter, zum Beispiel „Runden | Transaktionen | Wasserfall“ unter „Finanzierung“. */
export function UnterTabs(props: TabsProps) {
  return <Reiterleiste stufe="untertabs" {...props} />;
}
