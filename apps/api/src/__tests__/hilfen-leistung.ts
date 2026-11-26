import { createHash } from "node:crypto";

/** Dauer (ms) des Eichlaufs auf einer unbelasteten Entwicklungsmaschine (Median mehrerer Läufe). */
const EICH_MS = 105;
/** Obergrenze der Lastkorrektur: Wer mehr als vierfach langsamer läuft, hat ein Problem, das kein Test mehr ausgleichen soll. */
const MAX_LASTFAKTOR = 4;

function eichlauf(): number {
  const t0 = performance.now();
  let h: Buffer = Buffer.from("eichlauf");
  for (let i = 0; i < 30_000; i++) h = createHash("sha256").update(h).digest();
  let a = 0;
  for (let i = 0; i < 3e7; i++) a = (a + i * 7) % 1_000_003;
  if (a < 0) throw new Error("unerreichbar");
  return performance.now() - t0;
}

/**
 * Wie viel langsamer die Maschine gerade rechnet als im Normalzustand (1 = unbelastet, höchstens ${MAX_LASTFAKTOR}). Gemessen mit einem
 * festen Rechenlauf, das Minimum aus fünf Läufen. Grenzen werden damit multipliziert, damit sie bei überlasteter Maschine (mehr
 * wartende Prozesse als Kerne) das Messrauschen der Maschine mittragen, nicht die Güte des Codes bewerten.
 */
export function lastfaktor(): number {
  eichlauf();
  const schnellster = Math.min(...Array.from({ length: 5 }, eichlauf));
  return Math.min(MAX_LASTFAKTOR, Math.max(1, schnellster / EICH_MS));
}

/** Perzentil (Nächster-Rang-Verfahren) einer Messreihe. */
export function perzentil(werte: number[], anteil: number): number {
  const sortiert = [...werte].sort((a, b) => a - b);
  return sortiert[Math.max(0, Math.ceil(anteil * sortiert.length) - 1)]!;
}

export const median = (werte: number[]): number => perzentil(werte, 0.5);

export interface Messung {
  /** Kennzahl der besten Runde (die geprüfte). */
  wert: number;
  /** Größter angewandter Lastfaktor (1 = keine Korrektur). */
  lastfaktor: number;
  /** Tatsächlich geprüfte Grenze (Grenze mal Lastfaktor). */
  grenze: number;
  /** Kennzahl jeder gelaufenen Runde, in Reihenfolge. */
  runden: number[];
  /** Messreihe der besten Runde. */
  zeiten: number[];
}

/**
 * Misst in bis zu `maxRunden` Runden und gibt die Runde mit der besten Kennzahl zurück; sobald eine Runde unter der Grenze liegt, wird
 * nicht weiter gemessen. Zwei Dinge fangen Last ab, ohne die Grenze selbst zu lockern: (1) Einzelne Ausreißer (Speicherbereinigung,
 * andere Prozesse) treiben das 95. Perzentil einer Runde hoch; eine echte Verschlechterung zeigt sich aber in jeder Runde.
 * (2) Hält die Last über den ganzen Lauf an, würde jede Runde langsamer: Die Grenze wird vor jeder Runde mit dem `lastfaktor()` der
 * Maschine multipliziert (1 im Normalzustand, höchstens 4). Unbelastet gilt also die Grenze wörtlich.
 */
export async function messeInRunden(runde: () => Promise<number[]>, kennzahl: (zeiten: number[]) => number, grenze: number, maxRunden = 3): Promise<Messung> {
  const runden: number[] = [];
  let beste: { wert: number; zeiten: number[] } | undefined;
  let faktor = 1;
  let wirksam = grenze;
  for (let i = 0; i < maxRunden; i++) {
    faktor = Math.max(faktor, lastfaktor());
    wirksam = grenze * faktor;
    const zeiten = await runde();
    const wert = kennzahl(zeiten);
    runden.push(wert);
    if (!beste || wert < beste.wert) beste = { wert, zeiten };
    if (wert < wirksam) break;
  }
  return { wert: beste!.wert, runden, zeiten: beste!.zeiten, lastfaktor: faktor, grenze: wirksam };
}
