import { Decimal } from "@carraway/rechenkern";
import type { DefinitionInhalt } from "./definition";

/**
 * Prüfregeln einer Meldedefinition gegen die berechneten Werte eines Laufs. Ein Fehler blockiert die Freigabe, eine Warnung braucht einen
 * Kommentar (die API verlangt ihn). Ist ein Operand einer Regel leer („k. A.“), lässt sich die Regel nicht prüfen und bleibt still; das
 * Fehlen eines Pflichtwerts melden die Pflichtregeln. Pflichtfelder (`pflicht: true`) erzeugen die Regel `pflicht_<feld>` mit Schwere Fehler.
 */

export const BEFUND_CODES = ["PFLICHT_FEHLT", "WERT_UNTER_MINIMUM", "WERT_UEBER_MAXIMUM", "VERGLEICH_VERLETZT", "SUMME_ABWEICHUNG"] as const;
export type BefundCode = (typeof BEFUND_CODES)[number];

export interface Befund {
  regelId: string;
  schwere: "fehler" | "warnung";
  code: BefundCode;
  /** Betroffene Verweise der Definition (Feld oder `abschnitt.spalte`). */
  refs: string[];
  /** Beteiligte Werte (Operanden, Grenzen, Differenz) als Zeichenketten. */
  params: Record<string, string>;
  meldung: { de: string; en: string };
}

/** Schlüssel des Wertes zu einem Verweis: Feld → `abschnitt.feld`, Tabellenspalte → Summenzeile `abschnitt._summe.spalte`. */
export function wertSchluessel(d: DefinitionInhalt, ref: string): string | null {
  const [a, b] = ref.split(".") as [string, string | undefined];
  if (b !== undefined) return `${a}._summe.${b}`;
  for (const abschnitt of d.abschnitte) if (abschnitt.typ === "felder" && abschnitt.felder.some((f) => f.id === a)) return `${abschnitt.id}.${a}`;
  return null;
}

const leer = (w: string | null | undefined): boolean => w === null || w === undefined || w.trim() === "";

export function pruefeRegeln(d: DefinitionInhalt, werte: ReadonlyMap<string, string | null>): Befund[] {
  const wert = (ref: string): string | null => {
    const s = wertSchluessel(d, ref);
    return s === null ? null : (werte.get(s) ?? null);
  };
  const zahl = (ref: string): Decimal | null => {
    const w = wert(ref);
    return w === null || !/^-?\d+(\.\d+)?$/.test(w) ? null : new Decimal(w);
  };
  const befunde: Befund[] = [];

  // Pflichtfelder
  for (const a of d.abschnitte) {
    if (a.typ !== "felder") continue;
    for (const f of a.felder) {
      if (f.pflicht && leer(werte.get(`${a.id}.${f.id}`))) {
        befunde.push({
          regelId: `pflicht_${f.id}`,
          schwere: "fehler",
          code: "PFLICHT_FEHLT",
          refs: [f.id],
          params: { feld: f.id },
          meldung: { de: `Pflichtfeld „${f.bezeichnung.de}“ ist leer.`, en: `Required field “${f.bezeichnung.en}” is empty.` },
        });
      }
    }
  }

  for (const r of d.regeln) {
    switch (r.art) {
      case "pflicht": {
        const fehlend = r.felder.filter((ref) => leer(wert(ref)));
        if (fehlend.length) befunde.push({ regelId: r.id, schwere: r.schwere, code: "PFLICHT_FEHLT", refs: fehlend, params: { felder: fehlend.join(", ") }, meldung: r.meldung });
        break;
      }
      case "bereich": {
        const w = zahl(r.feld);
        if (!w) break;
        if (r.minimum !== undefined && w.lessThan(r.minimum)) befunde.push({ regelId: r.id, schwere: r.schwere, code: "WERT_UNTER_MINIMUM", refs: [r.feld], params: { wert: w.toString(), minimum: r.minimum }, meldung: r.meldung });
        else if (r.maximum !== undefined && w.greaterThan(r.maximum)) befunde.push({ regelId: r.id, schwere: r.schwere, code: "WERT_UEBER_MAXIMUM", refs: [r.feld], params: { wert: w.toString(), maximum: r.maximum }, meldung: r.meldung });
        break;
      }
      case "vergleich": {
        const links = zahl(r.links);
        const rechts = typeof r.rechts === "string" ? zahl(r.rechts) : new Decimal(r.rechts.wert);
        if (!links || !rechts) break;
        const tol = new Decimal(r.toleranz ?? 0);
        const diff = links.minus(rechts);
        const gilt = {
          "=": diff.abs().lessThanOrEqualTo(tol),
          "!=": diff.abs().greaterThan(tol),
          "<": links.lessThan(rechts),
          "<=": links.lessThanOrEqualTo(rechts.plus(tol)),
          ">": links.greaterThan(rechts),
          ">=": links.greaterThanOrEqualTo(rechts.minus(tol)),
        }[r.operator];
        if (!gilt) {
          befunde.push({
            regelId: r.id,
            schwere: r.schwere,
            code: "VERGLEICH_VERLETZT",
            refs: typeof r.rechts === "string" ? [r.links, r.rechts] : [r.links],
            params: { links: links.toString(), operator: r.operator, rechts: rechts.toString(), differenz: diff.toString() },
            meldung: r.meldung,
          });
        }
        break;
      }
      case "summe": {
        const teile = r.summanden.map(zahl);
        const ziel = zahl(r.gleich);
        if (!ziel || teile.some((t) => t === null)) break;
        const s = (teile as Decimal[]).reduce((x, y) => x.plus(y), new Decimal(0));
        const diff = s.minus(ziel);
        if (diff.abs().greaterThan(r.toleranz ?? 0)) {
          befunde.push({ regelId: r.id, schwere: r.schwere, code: "SUMME_ABWEICHUNG", refs: [...r.summanden, r.gleich], params: { summe: s.toString(), erwartet: ziel.toString(), differenz: diff.toString() }, meldung: r.meldung });
        }
        break;
      }
    }
  }
  return befunde;
}
