import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { UiSprache, type Sprache } from "@carraway/ui";
import type { Kern } from "./kern.de";
import type { Texte } from "./de";
import { BEREICHE, bereicheFuerPfad, bereichVonAbschnitt, laderFuer, type Bereich, type BereichName } from "./bereiche";

export type { Texte };
export type { Bereich };

/**
 * Die Wörterbücher sind groß und in zwei Ebenen geteilt: Der Rahmen (`kern.de.ts`, `kern.en.ts`) hat alles, was Start, Anmeldung und Navigation brauchen; die
 * großen Bereiche (`bereiche.ts`) kommen mit der Seite, die sie braucht. Der Browser lädt nur die gewählte Sprache; die andere kommt erst beim Umschalten,
 * dann mit allen Bereichen, die schon im Gebrauch waren. Die Anwendung wartet vor dem ersten Zeichnen auf Rahmen und Bereiche der Seite
 * (`ladeSeitentexte`, im Wächter des Routers); Tests tragen beide Sprachen vollständig in `test/setup.ts` ein.
 */

/** Je Sprache das Wörterbuch (Rahmen plus bisher geladene Bereiche), hinter einer Schutzhülle für noch nicht geladene Bereiche. */
const geladen: Partial<Record<Sprache, Texte>> = {};
/** Das Wörterbuch hinter der Hülle, in das Bereiche eingetragen werden. */
const inhalt: Partial<Record<Sprache, Record<string, unknown>>> = {};
/** Bereiche, die geladen sein sollen (gebraucht von irgendeiner Seite dieser Sitzung); gilt für beide Sprachen. */
const gebraucht = new Set<BereichName>();
const laufend = new Map<string, Promise<void>>();
const eingetragen = new Set<string>();
const kernLaufend: Partial<Record<Sprache, Promise<Texte>>> = {};

/** Bereiche, die gelesen wurden, bevor die Seite sie geladen hatte (Tests prüfen, dass das nicht vorkommt). */
export const nachgeladen: BereichName[] = [];

const kernLader: Record<Sprache, () => Promise<Kern>> = {
  de: () => import("./kern.de").then((m) => m.kernDe),
  en: () => import("./kern.en").then((m) => m.kernEn),
};

const schluessel = (sprache: Sprache, bereich: BereichName) => `${sprache}:${bereich}`;

/** Lädt einen Bereich in einer Sprache (einmal) und trägt ihn in das Wörterbuch ein; Fehlertexte kommen in `fehler`. */
function ladeBereich(sprache: Sprache, bereich: BereichName): Promise<void> {
  const k = schluessel(sprache, bereich);
  if (eingetragen.has(k)) return Promise.resolve();
  let p = laufend.get(k);
  if (!p) {
    const lader = laderFuer(bereich);
    if (!lader) return Promise.resolve();
    p = lader[sprache]().then((paket) => {
      const ziel = inhalt[sprache];
      if (!ziel) throw new Error(`Wörterbuch „${sprache}“ ist noch nicht geladen`);
      Object.assign(ziel, paket.abschnitte);
      if (paket.fehler) Object.assign(ziel.fehler as object, paket.fehler);
      eingetragen.add(k);
      laufend.delete(k);
    });
    laufend.set(k, p);
  }
  return p;
}

/** Hülle um das Wörterbuch: Ein noch nicht geladener Bereich wird nachgeladen, und die Darstellung wartet darauf (Suspense). */
function huelle(sprache: Sprache, ziel: Record<string, unknown>): Texte {
  return new Proxy(ziel, {
    get(t, name, empfaenger) {
      const bereich = typeof name === "string" && !(name in t) ? bereichVonAbschnitt(name) : null;
      if (bereich) {
        nachgeladen.push(bereich);
        gebraucht.add(bereich);
        throw ladeBereich(sprache, bereich);
      }
      return Reflect.get(t, name, empfaenger);
    },
  }) as unknown as Texte;
}

/** Trägt ein vollständiges Wörterbuch ein (für Tests und Einstiege, die es schon haben); alle Bereiche gelten als geladen, `zusatz` sind die der Erweiterungen. */
export function registriereTexte(sprache: Sprache, texte: Texte, zusatz: readonly string[] = []): void {
  geladen[sprache] = texte;
  inhalt[sprache] = texte as unknown as Record<string, unknown>;
  for (const b of [...BEREICHE, ...zusatz]) {
    gebraucht.add(b);
    eingetragen.add(schluessel(sprache, b));
  }
}

/** Setzt alles zurück, damit Tests den Start mit nur dem Rahmen nachstellen können. */
export function setzeTexteZurueck(): void {
  for (const s of ["de", "en"] as const) {
    delete geladen[s];
    delete inhalt[s];
    delete kernLaufend[s];
  }
  gebraucht.clear();
  laufend.clear();
  eingetragen.clear();
  nachgeladen.length = 0;
}

/** Lädt das Wörterbuch der Sprache (Rahmen und alle bisher gebrauchten Bereiche, je einmal) und gibt es zurück. */
export async function ladeTexte(sprache: Sprache): Promise<Texte> {
  let texte = geladen[sprache];
  if (!texte) {
    kernLaufend[sprache] ??= kernLader[sprache]().then((kern) => {
      // Eine Kopie, damit das Eintragen der Bereiche die Moduldatei des Rahmens nicht verändert.
      const ziel: Record<string, unknown> = { ...kern, fehler: { ...kern.fehler } };
      inhalt[sprache] = ziel;
      geladen[sprache] = huelle(sprache, ziel);
      return geladen[sprache]!;
    });
    texte = await kernLaufend[sprache]!;
  }
  await Promise.all([...gebraucht].map((b) => ladeBereich(sprache, b)));
  return texte;
}

/** Lädt die Bereiche, die diese Adresse braucht, in der gewählten Sprache; der Wächter des Routers wartet darauf, bevor etwas gezeichnet wird. */
export async function ladeSeitentexte(pfad: string, sprache: Sprache = gespeicherteSprache()): Promise<void> {
  const noetig = bereicheFuerPfad(pfad);
  for (const b of noetig) gebraucht.add(b);
  await ladeTexte(sprache);
  await Promise.all(noetig.map((b) => ladeBereich(sprache, b)));
}

/** Wörterbuch einer schon geladenen Sprache, für Code außerhalb von React, der die Sprache als Parameter bekommt (immer die aktive). */
export function tabelleFuer(sprache: Sprache): Texte {
  const t = geladen[sprache];
  if (!t) throw new Error(`Wörterbuch „${sprache}“ ist noch nicht geladen`);
  return t;
}

const SCHLUESSEL = "carraway.sprache";

export function gespeicherteSprache(): Sprache {
  try {
    const wert = localStorage.getItem(SCHLUESSEL);
    if (wert === "de" || wert === "en") return wert;
  } catch {
    // Speicher gesperrt: Standardsprache
  }
  return "de";
}

interface Kontext {
  sprache: Sprache;
  setzeSprache: (sprache: Sprache) => void;
  t: Texte;
}

// Ohne Provider (nur in Tests) gilt Deutsch; das Wörterbuch wird erst beim Zugriff nachgeschlagen.
const SpracheKontext = createContext<Kontext>({
  sprache: "de",
  setzeSprache: () => {},
  get t() {
    return tabelleFuer("de");
  },
});

/** Hält die gewählte Sprache, schreibt sie in `localStorage` und in `<html lang>` und versorgt die UI-Komponenten. */
export function SpracheProvider({ children }: { children: ReactNode }) {
  const [wahl, setWahl] = useState<{ sprache: Sprache; t: Texte | undefined }>(() => {
    const sprache = gespeicherteSprache();
    return { sprache, t: geladen[sprache] };
  });
  const { sprache } = wahl;

  // Die gewählte Sprache ist noch nicht geladen (nur ohne vorheriges `ladeTexte`): nachladen.
  useEffect(() => {
    if (wahl.t) return;
    let aktuell = true;
    void ladeTexte(wahl.sprache).then((t) => aktuell && setWahl({ sprache: wahl.sprache, t }));
    return () => {
      aktuell = false;
    };
  }, [wahl]);

  useEffect(() => {
    document.documentElement.lang = sprache;
  }, [sprache]);

  const wert = useMemo<Kontext>(
    () => ({
      sprache,
      t: wahl.t as Texte,
      setzeSprache: (neu) => {
        try {
          localStorage.setItem(SCHLUESSEL, neu);
        } catch {
          // Speicher gesperrt: die Wahl gilt nur für diese Sitzung
        }
        // Erst umschalten, wenn das Wörterbuch (mit allen schon gebrauchten Bereichen) da ist: Die Oberfläche zeigt nie einen halben Wechsel.
        void ladeTexte(neu).then((t) => setWahl({ sprache: neu, t }));
      },
    }),
    [sprache, wahl.t],
  );

  if (!wahl.t) return null;
  return (
    <SpracheKontext.Provider value={wert}>
      <UiSprache sprache={sprache}>{children}</UiSprache>
    </SpracheKontext.Provider>
  );
}

export const useT = (): Texte => useContext(SpracheKontext).t;
export const useSprache = (): Sprache => useContext(SpracheKontext).sprache;
export const useSetzeSprache = () => useContext(SpracheKontext).setzeSprache;

/** Übersetzt einen Schlüssel aus einer Aufzählungstabelle; unbekannte Werte erscheinen unverändert. */
export function aufzaehlung(tabelle: Record<string, string>, wert: string): string {
  return Object.hasOwn(tabelle, wert) ? (tabelle[wert] as string) : wert;
}
