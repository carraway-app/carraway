import { Suspense, useEffect, useId, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { klassen } from "../hilfen";
import { useUiTexte } from "../sprache";
import { CaretDownIcon } from "../icons/CaretDown";
import { TabLaedt } from "./Tabs";

export interface VerzeichnisEintrag {
  id: string;
  label: ReactNode;
  /** Anzahl oder Kurzwert hinter dem Namen. */
  zaehler?: number | string;
  deaktiviert?: boolean;
  /** Inhalt des Bereichs. Er wird nur gebaut und eingehängt, solange der Eintrag aktiv ist (träges Laden). */
  inhalt?: () => ReactNode;
}

export interface VerzeichnisGruppe {
  id: string;
  /** Ohne Beschriftung stehen die Einträge ohne Gruppenkopf. */
  label?: ReactNode;
  eintraege: VerzeichnisEintrag[];
}

export interface InhaltsverzeichnisProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "children"> {
  gruppen: VerzeichnisGruppe[];
  aktiv: string;
  onWechsel: (id: string) => void;
  "aria-label": string;
  /** Platzhalter, solange der Inhalt des aktiven Bereichs lädt (das Verzeichnis bleibt stehen). */
  laden?: ReactNode;
  /** Inhalt des aktiven Bereichs, wenn die Einträge keinen eigenen `inhalt` tragen. */
  children?: ReactNode;
}

/**
 * Inhaltsverzeichnis für Detailseiten mit vielen Bereichen: gegliederte Navigationsspalte links, rechts genau ein Bereich.
 * Die Einträge sind Knöpfe mit `aria-current`; Tab erreicht jeden, Enter und Leertaste wählen. Auf schmalen Fenstern
 * wird die Spalte zu einer Zeile „Bereich: Name“, die die Liste aufklappt (CSS, Grenze wie bei der Seitenleiste).
 */
export function Inhaltsverzeichnis({ gruppen, aktiv, onWechsel, laden, children, className, "aria-label": ariaLabel, ...rest }: InhaltsverzeichnisProps) {
  const t = useUiTexte();
  const basis = useId();
  const inhaltRef = useRef<HTMLDivElement>(null);
  const vomNutzer = useRef(false);
  const erstes = useRef(true);
  const [offen, setOffen] = useState(false);
  const eintragId = (id: string) => `${basis}-eintrag-${id}`;
  const sichtbar = gruppen.filter((g) => g.eintraege.length > 0);
  const aktuell = sichtbar.flatMap((g) => g.eintraege).find((e) => e.id === aktiv);

  // Nach einem Wechsel durch die Person liest ein Screenreader im neuen Bereich weiter; beim ersten Rendern und bei Wechseln über die Adresse bleibt der Fokus.
  useEffect(() => {
    if (erstes.current) {
      erstes.current = false;
      return;
    }
    if (!vomNutzer.current) return;
    vomNutzer.current = false;
    inhaltRef.current?.focus({ preventScroll: true });
  }, [aktiv]);

  const inhalt = aktuell?.inhalt ? aktuell.inhalt() : children;
  const hatInhalt = Boolean(aktuell) && inhalt !== undefined && inhalt !== null;
  const listeId = `${basis}-liste`;

  return (
    <div className={klassen("cw-inhalt", className)} {...rest}>
      <div className="cw-inhalt__verzeichnis" data-offen={offen ? "ja" : undefined}>
        <button type="button" className="cw-inhalt__schalter" aria-expanded={offen} aria-controls={listeId} onClick={() => setOffen(!offen)}>
          <span className="cw-inhalt__schalter-text">
            {t.inhaltBereich}: <strong>{aktuell?.label}</strong>
          </span>
          <CaretDownIcon size={16} />
        </button>
        <nav id={listeId} aria-label={ariaLabel} className="cw-inhalt__nav">
          {sichtbar.map((g) => {
            const kopfId = `${basis}-gruppe-${g.id}`;
            return (
              <div key={g.id} className="cw-inhalt__gruppe">
                {g.label ? (
                  <div id={kopfId} className="cw-inhalt__gruppenkopf">
                    {g.label}
                  </div>
                ) : null}
                <ul className="cw-inhalt__liste" aria-labelledby={g.label ? kopfId : undefined}>
                  {g.eintraege.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        id={eintragId(e.id)}
                        className="cw-inhalt__eintrag"
                        aria-current={e.id === aktiv ? "page" : undefined}
                        disabled={e.deaktiviert}
                        onClick={() => {
                          setOffen(false);
                          if (e.id === aktiv) return;
                          vomNutzer.current = true;
                          onWechsel(e.id);
                        }}
                      >
                        <span className="cw-inhalt__text">{e.label}</span>
                        {e.zaehler !== undefined ? <span className="cw-tabs__zaehler">{e.zaehler}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
      </div>
      {aktuell && hatInhalt ? (
        <div ref={inhaltRef} id={`${basis}-inhalt`} role="region" aria-labelledby={eintragId(aktuell.id)} tabIndex={-1} className="cw-inhalt__bereich">
          <Suspense fallback={laden ?? <TabLaedt />}>{inhalt}</Suspense>
        </div>
      ) : null}
    </div>
  );
}
