import { afterEach, beforeEach, expect, vi } from "vitest";
import { cleanup, configure } from "@testing-library/react";
import { de } from "../i18n/de";
import { en } from "../i18n/en";
import { ladeTexte, nachgeladen, registriereTexte, setzeTexteZurueck } from "../i18n";

/**
 * Wörterbücher in Tests. Standard: Beide Sprachen stehen vollständig bereit (kein Warten, keine Bereiche). Mit `TEXTE_LAZY=1` (`pnpm --filter @carraway/web
 * test:texte`, Teil von `pnpm test`) läuft jeder Test wie die Anwendung: nur der Rahmen ist geladen, die Bereiche kommen mit der Adresse über den Wächter des
 * Routers (`ladeSeitentexte`), und ein Test scheitert, sobald ein Bereich erst beim Zeichnen nachgeladen werden musste (dann fehlt er in `bereicheFuerPfad`).
 */
const lazy = process.env.TEXTE_LAZY === "1";
if (lazy) {
  beforeEach(async () => {
    setzeTexteZurueck();
    await Promise.all([ladeTexte("de"), ladeTexte("en")]);
  });
  afterEach(() => {
    expect(nachgeladen, "Bereich der Wörterbücher wurde erst beim Zeichnen geladen; in bereiche.ts der Adresse zuordnen").toEqual([]);
  });
} else {
  registriereTexte("de", de);
  registriereTexte("en", en);
}

/**
 * Wartezeiten sind Obergrenzen, keine Pausen: `findBy…` und `waitFor` kehren zurück, sobald der Inhalt da ist. Die Standardwerte (1 s für Abfragen, 5 s je Test)
 * reichen im vollen Lauf des Arbeitsbereichs nicht, wenn viele Prozesse um die Rechenzeit konkurrieren und die erste Seite Router, Bereiche und Abfragen laden muss.
 */
configure({ asyncUtilTimeout: 10_000 });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
  document.documentElement.lang = "de";
});

// jsdom kennt das Scrollen nicht; der Router ruft es bei der Wiederherstellung der Position auf.
window.scrollTo = () => {};
