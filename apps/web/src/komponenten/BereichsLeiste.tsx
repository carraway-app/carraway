import { Suspense, useEffect, useRef, type ReactNode } from "react";
import type { NavigateOptions } from "@tanstack/react-router";
import { CaretRightIcon, TabLaedt } from "@carraway/ui";
import { useObjektKontext } from "./kontextLeiste";
import type { Brotkrume, Kontext } from "./navigation";

export interface BereichsEintrag {
  id: string;
  label: string;
  icon?: ReactNode;
  zaehler?: number | undefined;
  /** Adresse des Eintrags (dieselbe Seite mit `?tab=…`). */
  ziel: NavigateOptions;
  /** Reiter des Eintrags mit ihren Adressen (für die Suche). */
  reiter?: { id: string; label: string; ziel: NavigateOptions }[] | undefined;
  inhalt: () => ReactNode;
}

export interface BereichsGruppe {
  id: string;
  /** Ohne Beschriftung stehen die Einträge ohne Gruppenkopf. */
  label?: string;
  eintraege: BereichsEintrag[];
}

/** Gruppen im Format des früheren Inhaltsverzeichnisses (`tab`/`unter` je Eintrag) mit ihren Adressen; der erste Eintrag steht ohne `tab`. */
export function mitZielen(
  gruppen: { id: string; label?: string; eintraege: { id: string; label: string; icon?: ReactNode; zaehler?: number | undefined; inhalt: () => ReactNode }[] }[],
  adressen: readonly { id: string; tab: string; unter?: string }[],
  basis: { to: string; params?: Record<string, string> },
): BereichsGruppe[] {
  const erster = adressen[0];
  return gruppen.map((g) => ({
    ...g,
    eintraege: g.eintraege.map((e) => {
      const a = adressen.find((x) => x.id === e.id);
      const search = !a || a === erster ? {} : { tab: a.tab === erster?.tab ? undefined : a.tab, unter: a.unter };
      return { ...e, ziel: { ...basis, search } as NavigateOptions };
    }),
  }));
}

export interface BereichsLeisteProps {
  "aria-label": string;
  gruppen: BereichsGruppe[];
  aktiv: string;
  zurueck?: Kontext["zurueck"];
  kopf?: Kontext["kopf"];
  pfad: Brotkrume[];
}

/**
 * Orte einer Detailseite in der Seitenleiste (Objektkontext): Die Einträge stehen links in der Leiste, rechts steht genau ein Bereich
 * in voller Breite. Ersetzt die zweite Navigationsspalte. Nach einem Wechsel aus der Leiste liegt der Fokus auf dem neuen Bereich.
 */
export function BereichsLeiste({ "aria-label": ariaLabel, gruppen, aktiv, zurueck, kopf, pfad }: BereichsLeisteProps) {
  const sichtbar = gruppen.filter((g) => g.eintraege.length > 0);
  const aktuell = sichtbar.flatMap((g) => g.eintraege).find((e) => e.id === aktiv) ?? sichtbar[0]?.eintraege[0];
  const bereich = useRef<HTMLDivElement>(null);
  useObjektKontext({
    ...(zurueck ? { zurueck } : {}),
    ...(kopf ? { kopf } : {}),
    pfad,
    aktivId: aktuell?.id,
    gruppen: sichtbar.map((g) => ({
      id: g.id,
      label: g.label ?? "",
      // Ohne eigenes Zeichen ein neutrales, damit die schmale Leiste nicht leer ist.
      items: g.eintraege.map((e) => ({ id: e.id, label: e.label, icon: e.icon ?? <CaretRightIcon />, zaehler: e.zaehler, ziel: e.ziel, reiter: e.reiter, aktiv: () => false })),
    })),
  });
  const erstes = useRef(true);
  useEffect(() => {
    if (erstes.current) {
      erstes.current = false;
      return;
    }
    // Ein Wechsel aus der Leiste: Ein Screenreader liest im neuen Bereich weiter.
    if (document.activeElement?.closest("#app-seitenleiste")) bereich.current?.focus({ preventScroll: true });
  }, [aktuell?.id]);
  if (!aktuell) return null;
  return (
    <div ref={bereich} tabIndex={-1} data-bereich={aktuell.id} data-bereiche={ariaLabel} className="app-bereich">
      <Suspense fallback={<TabLaedt />}>{aktuell.inhalt()}</Suspense>
    </div>
  );
}
