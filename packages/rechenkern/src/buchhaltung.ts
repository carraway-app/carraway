import { Decimal } from "./decimal.js";
import type { Rechenschritt } from "./herkunft.js";

/**
 * Auswertungen aus einer Summen- und Saldenliste und den Kontenregeln eines Fonds (Etappe 14).
 *
 * Konvention (Entscheidung 244): Salden haben ein Vorzeichen, Soll positiv, Haben negativ. Jede Position hat eine Seite
 * (`soll` oder `haben`); ihr Wert ist die Summe der Salden der zugeordneten Konten, bei Seite `haben` mit umgekehrtem Vorzeichen,
 * damit der Normalfall positiv erscheint. Eine Oberposition ist die Summe ihrer Unterpositionen, jede auf die Seite der Oberposition
 * umgerechnet (z. B. Ergebnis, Seite haben = Erträge − Aufwendungen). Jede Zeile trägt ihre Herkunft: Konten, Salden und Regel.
 */

export type Seite = "soll" | "haben";

export interface Position {
  schluessel: string;
  elternSchluessel: string | null;
  bezeichnungDe: string;
  bezeichnungEn: string;
  reihenfolge: number;
  seite: Seite;
}

export interface Regel {
  id: string;
  kontoVon: string;
  kontoBis: string;
  positionSchluessel: string;
  gueltigAb: string;
  gueltigBis: string | null;
}

export interface Konto {
  nummer: string;
  bezeichnung: string;
}

export interface KontoSaldo {
  konto: string;
  bezeichnung?: string | null;
  saldo: string;
}

export interface Herkunftskonto {
  konto: string;
  bezeichnung: string | null;
  saldo: string;
  regelId: string;
  /** Beitrag zum Positionswert (Saldo mit dem Vorzeichen der Seite). */
  beitrag: string;
}

export interface AuswertungsZeile {
  schluessel: string;
  ebene: number;
  bezeichnungDe: string;
  bezeichnungEn: string;
  seite: Seite;
  /** Wert der Position, Normalseite positiv. */
  wert: string;
  /** Blatt (Konten über Regeln) oder Oberposition (Summe der Unterpositionen). */
  blatt: boolean;
  konten: Herkunftskonto[];
  schritte: Rechenschritt[];
}

export interface NichtZugeordnet {
  konto: string;
  bezeichnung: string | null;
  saldo: string;
}

export interface Auswertung {
  zeilen: AuswertungsZeile[];
  nichtZugeordnet: NichtZugeordnet[];
  /** Konten, auf die mehrere gültige Regeln passen (die engste Regel gilt). */
  mehrdeutig: { konto: string; regelIds: string[] }[];
}

/** Gilt die Regel am Stichtag? */
export const regelGilt = (r: Pick<Regel, "gueltigAb" | "gueltigBis">, stichtag: string): boolean => r.gueltigAb <= stichtag && (r.gueltigBis === null || r.gueltigBis >= stichtag);

/** Liegt das Konto im Bereich der Regel? Bereiche gelten für Kontonummern gleicher Länge. */
export const kontoInBereich = (konto: string, von: string, bis: string): boolean => konto.length === von.length && konto >= von && konto <= bis;

/** Überschneiden sich zwei Kontobereiche? Bereiche unterschiedlicher Länge überschneiden sich nie. */
export const bereicheUeberschneiden = (a: { kontoVon: string; kontoBis: string }, b: { kontoVon: string; kontoBis: string }): boolean =>
  a.kontoVon.length === b.kontoVon.length && a.kontoVon <= b.kontoBis && b.kontoVon <= a.kontoBis;

/** Überschneiden sich die Gültigkeitszeiträume? */
export const zeitraeumeUeberschneiden = (a: Pick<Regel, "gueltigAb" | "gueltigBis">, b: Pick<Regel, "gueltigAb" | "gueltigBis">): boolean =>
  a.gueltigAb <= (b.gueltigBis ?? "9999-12-31") && b.gueltigAb <= (a.gueltigBis ?? "9999-12-31");

const breite = (r: Regel) => Number(BigInt(r.kontoBis) - BigInt(r.kontoVon));

/** Die Zeilen einer Sicht aus Salden und den am Stichtag gültigen Regeln. */
export function rechneSicht(eingabe: { positionen: Position[]; regeln: Regel[]; salden: KontoSaldo[]; stichtag: string }): Auswertung {
  const gueltig = eingabe.regeln.filter((r) => regelGilt(r, eingabe.stichtag));
  const nachPosition = new Map<string, Herkunftskonto[]>();
  const nichtZugeordnet: NichtZugeordnet[] = [];
  const mehrdeutig: Auswertung["mehrdeutig"] = [];
  const positionen = new Map(eingabe.positionen.map((p) => [p.schluessel, p]));
  // Nur Blätter nehmen Konten auf; eine Regel auf eine Oberposition würde Konten sonst stillschweigend verschwinden lassen.
  const oberpositionen = new Set(eingabe.positionen.map((p) => p.elternSchluessel).filter((e): e is string => e !== null));
  for (const s of eingabe.salden) {
    const treffer = gueltig.filter((r) => kontoInBereich(s.konto, r.kontoVon, r.kontoBis) && positionen.has(r.positionSchluessel) && !oberpositionen.has(r.positionSchluessel));
    if (treffer.length === 0) {
      nichtZugeordnet.push({ konto: s.konto, bezeichnung: s.bezeichnung ?? null, saldo: new Decimal(s.saldo).toFixed(2) });
      continue;
    }
    treffer.sort((a, b) => breite(a) - breite(b) || a.id.localeCompare(b.id));
    if (treffer.length > 1) mehrdeutig.push({ konto: s.konto, regelIds: treffer.map((r) => r.id) });
    const regel = treffer[0]!;
    const position = positionen.get(regel.positionSchluessel)!;
    const saldo = new Decimal(s.saldo);
    const liste = nachPosition.get(position.schluessel) ?? [];
    liste.push({ konto: s.konto, bezeichnung: s.bezeichnung ?? null, saldo: saldo.toFixed(2), regelId: regel.id, beitrag: (position.seite === "soll" ? saldo : saldo.negated()).toFixed(2) });
    nachPosition.set(position.schluessel, liste);
  }
  nichtZugeordnet.sort((a, b) => a.konto.localeCompare(b.konto));

  const kinder = new Map<string | null, Position[]>();
  for (const p of eingabe.positionen) {
    const eltern = p.elternSchluessel !== null && positionen.has(p.elternSchluessel) ? p.elternSchluessel : null;
    kinder.set(eltern, [...(kinder.get(eltern) ?? []), p]);
  }
  for (const liste of kinder.values()) liste.sort((a, b) => a.reihenfolge - b.reihenfolge || a.schluessel.localeCompare(b.schluessel));

  const zeilen: AuswertungsZeile[] = [];
  const besucht = new Set<string>();
  const baue = (p: Position, ebene: number): Decimal => {
    if (besucht.has(p.schluessel)) throw new Error(`Gliederung: Zyklus bei ${p.schluessel}`);
    besucht.add(p.schluessel);
    const eigene = kinder.get(p.schluessel) ?? [];
    const index = zeilen.length;
    zeilen.push(undefined as unknown as AuswertungsZeile);
    let wert: Decimal;
    let konten: Herkunftskonto[] = [];
    let schritte: Rechenschritt[];
    if (eigene.length === 0) {
      konten = (nachPosition.get(p.schluessel) ?? []).sort((a, b) => a.konto.localeCompare(b.konto));
      wert = konten.reduce((s, k) => s.plus(k.beitrag), new Decimal(0));
      schritte = [
        ...konten.map<Rechenschritt>((k) => ({ zeichen: Number(k.beitrag) < 0 ? "−" : "+", bezeichnung: `Konto ${k.konto}${k.bezeichnung ? ` ${k.bezeichnung}` : ""}, Saldo ${k.saldo}`, wert: new Decimal(k.beitrag).abs().toFixed(2), quellen: [k.regelId] })),
        { zeichen: "=", bezeichnung: p.bezeichnungDe, wert: wert.toFixed(2) },
      ];
    } else {
      wert = new Decimal(0);
      schritte = [];
      for (const k of eigene) {
        const w = baue(k, ebene + 1);
        const beitrag = k.seite === p.seite ? w : w.negated();
        wert = wert.plus(beitrag);
        schritte.push({ zeichen: beitrag.isNegative() ? "−" : "+", bezeichnung: k.bezeichnungDe, wert: beitrag.abs().toFixed(2) });
      }
      schritte.push({ zeichen: "=", bezeichnung: p.bezeichnungDe, wert: wert.toFixed(2) });
    }
    zeilen[index] = { schluessel: p.schluessel, ebene, bezeichnungDe: p.bezeichnungDe, bezeichnungEn: p.bezeichnungEn, seite: p.seite, wert: wert.toFixed(2), blatt: eigene.length === 0, konten, schritte };
    return wert;
  };
  for (const wurzel of kinder.get(null) ?? []) baue(wurzel, 0);
  return { zeilen, nichtZugeordnet, mehrdeutig };
}
