import { useId, type HTMLAttributes, type MouseEventHandler, type ReactNode } from "react";
import { klassen } from "../hilfen";
import { CaretDownIcon } from "../icons";
import { useUiTexte } from "../sprache";

export interface NavEintrag {
  id: string;
  href: string;
  label: string;
  /** Zeichen vor dem Namen (ein `<…Icon />` aus dem Zeichenmodul). */
  icon?: ReactNode;
  aktiv?: boolean;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  /** Wird beim Überfahren und bei Fokus aufgerufen, z. B. um die Zielseite vorzuladen. */
  onVorladen?: () => void;
}

export interface NavGruppe {
  id: string;
  label: string;
  items: NavEintrag[];
}

export interface NavLeisteProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  gruppen: NavGruppe[];
  /** Ids der eingeklappten Gruppen. Eine eingeklappte Gruppe zeigt nur noch den aktiven Eintrag. */
  eingeklappt?: string[];
  onGruppe?: (id: string, eingeklappt: boolean) => void;
  /** Schmale Leiste: nur Zeichen, Namen als Tooltip (title) und für Screenreader. */
  schmal?: boolean;
}

/** Gruppierte Navigation mit einklappbaren Gruppen und Zeichen; Gruppen ohne Namen zeigen ihre Einträge ohne Kopf. */
export function NavLeiste({ gruppen, eingeklappt = [], onGruppe, schmal, className, "aria-label": ariaLabel, ...rest }: NavLeisteProps) {
  const t = useUiTexte();
  const basis = useId();
  return (
    <nav className={klassen("cw-nav", schmal && "cw-nav--schmal", className)} aria-label={ariaLabel ?? t.hauptnavigation} {...rest}>
      {gruppen.map((g) => {
        const zu = !schmal && Boolean(g.label) && eingeklappt.includes(g.id);
        const listeId = `${basis}-${g.id}`;
        // Eine eingeklappte Gruppe zeigt den aktiven Eintrag weiter, damit die Orientierung bleibt.
        const sichtbar = zu ? g.items.filter((i) => i.aktiv) : g.items;
        return (
          <div key={g.id} className="cw-nav__gruppe">
            {g.label && !schmal ? (
              <button type="button" className="cw-nav__gruppenkopf" aria-expanded={!zu} aria-controls={listeId} onClick={() => onGruppe?.(g.id, !zu)}>
                <CaretDownIcon aria-hidden="true" />
                {g.label}
              </button>
            ) : null}
            <ul id={listeId} className="cw-nav__liste">
              {sichtbar.map((i) => (
                <li key={i.id}>
                  <a
                    className="cw-nav__eintrag"
                    href={i.href}
                    aria-current={i.aktiv ? "page" : undefined}
                    title={schmal ? i.label : undefined}
                    onClick={i.onClick}
                    onPointerEnter={i.onVorladen}
                    onFocus={i.onVorladen}
                  >
                    {i.icon}
                    <span className="cw-nav__text">{i.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
