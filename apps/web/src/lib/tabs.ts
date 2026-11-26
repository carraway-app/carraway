import { useCallback, useRef } from "react";

/** Reiter stehen in der Adresse: `?tab=…` für die erste Stufe, `?unter=…` für die zweite. Ein Wechsel ist ein neuer Verlaufseintrag (Zurück-Knopf). */
export interface TabSuche {
  tab?: string;
  unter?: string;
}

const KENNUNG = /^[a-z][a-z0-9-]{0,31}$/;

/** Prüft `tab` und `unter` aus der Adresse (für `validateSearch`); ein früherer Suchparameter kann über `alt` auf Reiter abgebildet werden. */
export function tabSuche(suche: Record<string, unknown>, alt?: { name: string; abbildung: (wert: string) => TabSuche }): TabSuche {
  const wert = (v: unknown) => (typeof v === "string" && KENNUNG.test(v) ? v : undefined);
  const tab = wert(suche.tab);
  const unter = wert(suche.unter);
  if (!tab && alt) {
    const frueher = wert(suche[alt.name]);
    if (frueher) return alt.abbildung(frueher);
  }
  return { ...(tab ? { tab } : {}), ...(unter ? { unter } : {}) };
}

type Navigiere = (optionen: { search: (alt: Record<string, unknown>) => Record<string, unknown> }) => unknown;

/**
 * Reiterzustand einer Seite aus den Suchparametern. `tabs` sind die erlaubten Reiter der ersten Stufe, `unterTabs` je Reiter die der zweiten
 * (der erste Eintrag ist der Standard). Unbekannte Werte fallen auf den Standard zurück.
 */
export function useTabs<T extends string>(suche: TabSuche, navigate: unknown, tabs: readonly T[], unterTabs: Partial<Record<T, readonly string[]>> = {}) {
  const tab = (tabs.includes(suche.tab as T) ? suche.tab : tabs[0]) as T;
  const unterListe = unterTabs[tab] ?? [];
  const unter = unterListe.includes(suche.unter ?? "") ? (suche.unter as string) : unterListe[0];
  const nav = navigate as Navigiere;
  const erster = tabs[0];
  const ersterUnter = unterListe[0];
  const setzeTab = useCallback((id: string) => void nav({ search: (alt) => ({ ...alt, tab: id === erster ? undefined : id, unter: undefined }) }), [nav, erster]);
  const setzeUnter = useCallback((id: string) => void nav({ search: (alt) => ({ ...alt, unter: id === ersterUnter ? undefined : id }) }), [nav, ersterUnter]);
  return { tab, unter, setzeTab, setzeUnter };
}

/** Ein Eintrag des Inhaltsverzeichnisses mit seinem Ziel in der Adresse (`tab`, bei Bedarf `unter`, mit den bisherigen Kennungen). Der erste Eintrag ist der Standard. */
export interface InhaltsEintrag {
  id: string;
  tab: string;
  unter?: string;
}

/** Findet den Eintrag zur Adresse: `tab` und `unter` genau; nur `tab` (oder ein unbekanntes `unter`) → erster Eintrag dieses Reiters; sonst der erste Eintrag. */
export function aktiverEintrag<E extends InhaltsEintrag>(suche: TabSuche, eintraege: readonly E[]): E | undefined {
  const erster = eintraege[0];
  if (!erster) return undefined;
  const tab = suche.tab ?? erster.tab;
  const genau = eintraege.find((e) => e.tab === tab && e.unter === suche.unter);
  return genau ?? eintraege.find((e) => e.tab === tab) ?? erster;
}

/**
 * Zustand eines Inhaltsverzeichnisses aus denselben Suchparametern wie `useTabs` (`?tab=…&unter=…`), damit bestehende Links und Aliasse gelten.
 * Ein Wechsel schreibt `tab` und `unter` in einer Navigation (neuer Verlaufseintrag); Standardwerte bleiben aus der Adresse.
 */
export function useInhalt(suche: TabSuche, navigate: unknown, eintraege: readonly InhaltsEintrag[]) {
  const aktiv = aktiverEintrag(suche, eintraege)?.id ?? "";
  const nav = navigate as Navigiere;
  const liste = useRef(eintraege);
  liste.current = eintraege;
  const setzeAktiv = useCallback(
    (id: string) => {
      const alle = liste.current;
      const ziel = alle.find((e) => e.id === id);
      const erster = alle[0];
      if (!ziel || !erster) return;
      const tab = ziel.tab === erster.tab ? undefined : ziel.tab;
      const unter = ziel === erster ? undefined : ziel.unter;
      void nav({ search: (alt) => ({ ...alt, tab, unter }) });
    },
    [nav],
  );
  return { aktiv, setzeAktiv };
}
