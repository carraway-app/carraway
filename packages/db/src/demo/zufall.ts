import { createHash } from "node:crypto";

/** Stabile UUID (Form v4) aus Basis-ID und Zusatz, ohne Zufallszahlen zu verbrauchen: die übrigen Demo-Daten bleiben unverändert. */
export function abgeleiteteId(basis: string, zusatz: string): string {
  const h = createHash("sha1").update(`${basis}:${zusatz}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${"89ab"[Number.parseInt(h.slice(16, 17), 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Eigener Zufallsgenerator (mulberry32), damit die Demo-Daten bei gleichem Seed identisch sind. */
export function erzeugeRng(seed: number) {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  const wahl = <T>(liste: readonly T[]): T => {
    const wert = liste[int(0, liste.length - 1)];
    if (wert === undefined) throw new Error("wahl: leere Liste");
    return wert;
  };
  const gewichtet = <T>(liste: readonly (readonly [T, number])[]): T => {
    const summe = liste.reduce((s, [, g]) => s + g, 0);
    let r = next() * summe;
    for (const [wert, gewicht] of liste) {
      r -= gewicht;
      if (r < 0) return wert;
    }
    const letzter = liste[liste.length - 1];
    if (!letzter) throw new Error("gewichtet: leere Liste");
    return letzter[0];
  };
  const mische = <T>(liste: readonly T[]): T[] => {
    const kopie = [...liste];
    for (let i = kopie.length - 1; i > 0; i--) {
      const j = int(0, i);
      [kopie[i], kopie[j]] = [kopie[j] as T, kopie[i] as T];
    }
    return kopie;
  };
  /** Näherung einer Normalverteilung (Mittel 0, Streuung 1) ohne transzendente Funktionen. */
  const normal = (): number => {
    let s = 0;
    for (let i = 0; i < 12; i++) s += next();
    return s - 6;
  };
  const uuid = (): string => {
    const hex = Array.from({ length: 32 }, () => int(0, 15).toString(16));
    hex[12] = "4";
    hex[16] = "89ab"[int(0, 3)] as string;
    const h = hex.join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  return { next, int, wahl, gewichtet, mische, normal, uuid };
}

export type Rng = ReturnType<typeof erzeugeRng>;

// Datum als ISO-Zeichenkette (JJJJ-MM-TT); Rechnen über Tagesnummern in UTC.
const TAG_MS = 86_400_000;
export const tagesnummer = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / TAG_MS);
export const ausTagesnummer = (n: number): string => new Date(n * TAG_MS).toISOString().slice(0, 10);
export const plusTage = (iso: string, tage: number): string => ausTagesnummer(tagesnummer(iso) + tage);

/** Quartalsenden (31.03., 30.06., 30.09., 31.12.) von Jahr `von` bis einschließlich `bis`. */
export function quartalsenden(von: number, bis: string): string[] {
  const enden: string[] = [];
  for (let jahr = von; jahr <= Number(bis.slice(0, 4)); jahr++) {
    for (const md of ["03-31", "06-30", "09-30", "12-31"]) {
      const tag = `${jahr}-${md}`;
      if (tag <= bis) enden.push(tag);
    }
  }
  return enden;
}

/** Cent-Betrag (ganze Zahl) als Zeichenkette mit zwei Nachkommastellen, ohne Gleitkomma-Rundung. */
export function euro(cent: number): string {
  const vorzeichen = cent < 0 ? "-" : "";
  const abs = Math.abs(cent);
  return `${vorzeichen}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
