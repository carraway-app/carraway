import { useQuery } from "@tanstack/react-query";
import { ichAbfrage, type Ich } from "../api/anmeldung";

/** Rollen je Fonds, aufsteigend. Dieselbe Rangfolge wie in der API (`anmeldung/akteur.ts`); die API entscheidet, hier wird nur nichts angeboten, was sie ablehnt. */
export const ROLLEN = ["betrachter", "bearbeiter", "freigeber", "verwalter"] as const;
export type FondsRolle = (typeof ROLLEN)[number];

const RANG: Record<FondsRolle, number> = { betrachter: 1, bearbeiter: 2, freigeber: 3, verwalter: 4 };

/**
 * Wirksame Stufe am Fonds: globale Verwalter sind überall Verwalter. Mit `bereich` und Bereichen je Fonds in `/ich` (`bereicheJeFonds` nicht
 * `null`) zählt die Stufe an genau diesem Fonds und Bereich, ohne Eintrag keine. Sonst die Stufe am Fonds über alle Bereiche (`rollen`).
 * Wie `rolleAm` und `fuerBereich` in der API (`anmeldung/akteur.ts`).
 */
export function rolleAm(ich: Ich, fondsId: string, bereich?: string): FondsRolle | null {
  if (ich.globalVerwalter) return "verwalter";
  if (bereich && ich.bereicheJeFonds) return (ich.bereicheJeFonds[fondsId] as Partial<Record<string, FondsRolle>> | undefined)?.[bereich] ?? null;
  return ich.rollen.find((r) => r.fondsId === fondsId)?.rolle ?? null;
}

export function hatRolle(ich: Ich, fondsId: string, mindest: FondsRolle, bereich?: string): boolean {
  const rolle = rolleAm(ich, fondsId, bereich);
  return rolle !== null && RANG[rolle] >= RANG[mindest];
}

/**
 * Mindestens `mindest` an irgendeinem Fonds oder über eine Gruppe (für Dinge ohne Fonds wie Kontakte und Deals vor der Zuordnung).
 * Mit `bereich` und Bereichen je Fonds zählt nur die Stufe in diesem Bereich: ohne Fonds (`stufeOhneFondsJeBereich`) oder an einem Fonds.
 */
export function hatIrgendwoRolle(ich: Ich, mindest: FondsRolle, bereich?: string): boolean {
  if (ich.globalVerwalter) return true;
  if (bereich && ich.bereicheJeFonds) {
    const stufen = [(ich.stufeOhneFondsJeBereich as Partial<Record<string, FondsRolle>> | null)?.[bereich], ...Object.values(ich.bereicheJeFonds).map((jeBereich) => (jeBereich as Partial<Record<string, FondsRolle>>)[bereich])];
    return stufen.some((s) => !!s && RANG[s] >= RANG[mindest]);
  }
  return (!!ich.stufeOhneFonds && RANG[ich.stufeOhneFonds] >= RANG[mindest]) || ich.rollen.some((r) => RANG[r.rolle] >= RANG[mindest]);
}

/** Bereich der Anwendung erlaubt? `bereiche === null`: alle (keine Nutzergruppe); ohne Bereich immer. Wie `hatBereich` in der API (`rechte/bereiche.ts`). */
export const hatBereich = (ich: Ich | undefined, bereich?: string): boolean => !bereich || !ich?.bereiche || (ich.bereiche as string[]).includes(bereich);

/** Höchste Rolle der Person irgendwo, für die Anzeige im Kontomenü. */
export function hoechsteRolle(ich: Ich): FondsRolle | null {
  if (ich.globalVerwalter) return "verwalter";
  return ich.rollen.reduce<FondsRolle | null>((a, r) => (a === null || RANG[r.rolle] > RANG[a] ? r.rolle : a), null);
}

export interface Rechte {
  ich: Ich | undefined;
  /**
   * Darf die Person hier mindestens `mindest`? Ohne Fonds (`null`/`undefined`) genügt die Rolle an irgendeinem Fonds.
   * Mit `bereich` muss die Person zusätzlich den Bereich haben, und mit Bereichen je Fonds zählt die Stufe an genau diesem Fonds und Bereich:
   * Fonds ohne den Bereich bieten die Aktion nicht an. Ohne `bereich` gilt die Stufe am Fonds über alle Bereiche (Seiten ohne eigenen Bereich).
   */
  darf: (mindest: FondsRolle, fondsId?: string | null, bereich?: string) => boolean;
  /** Hat die Person den Bereich? Solange `/ich` fehlt, nein. */
  hatBereich: (bereich: string) => boolean;
}

/** Prüft Bereich und Mindeststufe aus derselben Sitzung in Navigation und Seiten. */
export function darf(ich: Ich | undefined, mindest: FondsRolle, fondsId?: string | null, bereich?: string): boolean {
  if (!ich || !hatBereich(ich, bereich)) return false;
  return fondsId ? hatRolle(ich, fondsId, mindest, bereich) : hatIrgendwoRolle(ich, mindest, bereich);
}

/** Rechte der angemeldeten Person aus `/ich`. Solange `/ich` fehlt, ist nichts erlaubt. */
export function useRechte(): Rechte {
  const { data: ich } = useQuery(ichAbfrage());
  return {
    ich,
    darf: (mindest, fondsId, bereich) => darf(ich, mindest, fondsId, bereich),
    hatBereich: (bereich) => !!ich && hatBereich(ich, bereich),
  };
}

/** Hat die angemeldete Person den Bereich? Für Abschnitte, Kacheln und Knöpfe, die ohne ihn nicht erscheinen sollen. Zuordnung der Abschnitte: `lib/bereiche.ts`. */
export function useBereich(bereich: string): boolean {
  return useRechte().hatBereich(bereich);
}
