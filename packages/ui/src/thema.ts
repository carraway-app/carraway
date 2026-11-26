import { useCallback, useSyncExternalStore } from "react";

/**
 * Thema der Oberfläche: `system` folgt dem Betriebssystem (reines CSS über `prefers-color-scheme`), `hell` und `dunkel` erzwingen eines.
 * Die Wahl steht als `data-theme` am Wurzelelement; der Browser behält sie unter `THEMA_SCHLUESSEL`, damit schon der erste Anstrich
 * stimmt (das kleine Skript in `apps/web/index.html` liest den Wert vor dem Laden der Stilvorlagen, noch bevor es eine Sitzung gibt).
 * Der Server hält den Wert je Person (`/thema`); die Oberfläche gleicht ihn nach der Anmeldung ab.
 */
export const THEMEN = ["system", "hell", "dunkel"] as const;
export type Thema = (typeof THEMEN)[number];

/** Schlüssel im Browser. Dasselbe Wort steht im Skript von `apps/web/index.html`. */
export const THEMA_SCHLUESSEL = "carraway.thema";

export const istThema = (wert: unknown): wert is Thema => wert === "system" || wert === "hell" || wert === "dunkel";

/** Der im Browser gemerkte Wert; ohne Wert oder bei gesperrtem Speicher gilt `system`. */
export function gespeichertesThema(): Thema {
  try {
    const wert = localStorage.getItem(THEMA_SCHLUESSEL);
    if (istThema(wert)) return wert;
  } catch {
    // Speicher gesperrt: Standard
  }
  return "system";
}

/** Das gerade angewendete Thema (Attribut am Wurzelelement; ohne Attribut gilt wie im CSS Dunkel). */
export function aktuellesThema(): Thema {
  const wert = document.documentElement.dataset.theme;
  return istThema(wert) ? wert : "dunkel";
}

/** Die Browserleiste übernimmt den Grund der Anwendung: `<meta name="theme-color">` aus dem Token `--cw-bg` des gültigen Themas. */
export function aktualisiereBrowserfarbe(): void {
  const grund = getComputedStyle(document.documentElement).getPropertyValue("--cw-bg").trim();
  if (!grund) return;
  let meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
  }
  meta.content = grund;
}

const hoerer = new Set<() => void>();
const WECHSEL_KLASSE = "cw-thema-wechsel";
let wechselZeit: ReturnType<typeof setTimeout> | undefined;

/**
 * Wendet ein Thema sofort an, ohne Neuladen: Attribut am Wurzelelement (damit auch `color-scheme`), Browserleiste, Merkzettel im Browser.
 * Mit `merken: false` bleibt der Browserspeicher unberührt. Der weiche Farbübergang kommt aus der Stilvorlage und gilt nur ohne
 * Wunsch nach reduzierter Bewegung.
 */
export function setzeThema(thema: Thema, merken = true): void {
  const wurzel = document.documentElement;
  if (wurzel.dataset.theme === thema) {
    if (merken) merke(thema);
    return;
  }
  wurzel.classList.add(WECHSEL_KLASSE);
  wurzel.dataset.theme = thema;
  if (merken) merke(thema);
  aktualisiereBrowserfarbe();
  clearTimeout(wechselZeit);
  wechselZeit = setTimeout(() => wurzel.classList.remove(WECHSEL_KLASSE), 250);
  hoerer.forEach((h) => h());
}

function merke(thema: Thema): void {
  try {
    localStorage.setItem(THEMA_SCHLUESSEL, thema);
  } catch {
    // Speicher gesperrt: Die Wahl gilt nur für diese Sitzung.
  }
}

const abonnieren = (h: () => void) => {
  hoerer.add(h);
  return () => void hoerer.delete(h);
};

/** Das angewendete Thema und eine Funktion, die es wechselt (nur lokal; das Speichern beim Server übernimmt die Anwendung). */
export function useThema(): [Thema, (thema: Thema) => void] {
  const thema = useSyncExternalStore(abonnieren, aktuellesThema, () => "dunkel" as Thema);
  const setze = useCallback((neu: Thema) => setzeThema(neu), []);
  return [thema, setze];
}
