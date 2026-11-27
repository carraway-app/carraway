import type { ReactNode } from "react";
import { Hinweis, formatProzent } from "@carraway/ui";
import { useSprache, useT } from "../i18n";
import { formatBetragCent } from "../lib/zahl";

/** Anteil des Zeichnungskapitals, der durch Zusagen abgedeckt ist, in Prozent; abgerundet auf eine Nachkommastelle, damit 100 % nur bei voller Abdeckung erscheint. */
export function abdeckungProzent(abgedeckt: string, zeichnungskapital: string): number {
  const kapital = Number(zeichnungskapital);
  if (!(kapital > 0)) return 0;
  return Math.min(100, Math.floor((Number(abgedeckt) / kapital) * 1000) / 10);
}

/**
 * Hinweis auf unvollständige LP-Zusagen (Issue #275) mit Fortschrittsanzeige: „X % des Zeichnungskapitals sind durch Zusagen abgebildet
 * (Y von Z)“. Der Aufrufer zeigt ihn nur, solange die Zusagen unvollständig sind; `aktion` führt zum Vervollständigen.
 */
export function ZusagenAbdeckung({ abgedeckt, zeichnungskapital, waehrung, aktion }: { abgedeckt: string; zeichnungskapital: string; waehrung: string; aktion?: ReactNode }) {
  const t = useT();
  const sprache = useSprache();
  const z = t.portfolio.zusagen;
  const prozent = abdeckungProzent(abgedeckt, zeichnungskapital);
  return (
    <Hinweis titel={z.titel} className="app-zusagen-abdeckung">
      {z.abdeckung(formatProzent(prozent, sprache), formatBetragCent(abgedeckt, sprache, waehrung), formatBetragCent(zeichnungskapital, sprache, waehrung))} {z.vervollstaendigen}
      <progress className="app-zusagen-abdeckung__balken" max={100} value={prozent} aria-label={z.titel}>{formatProzent(prozent, sprache)}</progress>
      {aktion ? <span className="app-zusagen-abdeckung__aktion">{aktion}</span> : null}
    </Hinweis>
  );
}
