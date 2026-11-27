import type { FondsAuszug, Periode, QuellFonds, VorgangArt } from "./modell";

/**
 * Schnittstelle eines Quellsystems (Adapter) und die Werkzeuge zum Lesen seiner API: Ratenbegrenzung, Wiederholung bei
 * vorübergehenden Fehlern und seitenweises Lesen mit Cursor. Der Transport (HTTPS, Zielprüfung, Zugangsdaten) kommt von außen
 * als `QuellAbfrage`; so bleibt der Adapter ohne Netzwerkcode testbar und die API prüft jedes Ziel an einer Stelle.
 */

/** Eine Anfrage an die Quell-API: Pfad relativ zum Ursprung, optional ein JSON-Körper (z. B. GraphQL `{ query, variables }`). */
export type QuellAbfrage = (pfad: string, koerper?: object) => Promise<unknown>;

export interface Rate {
  anfragen: number;
  sekunden: number;
}

export interface AbrufOptionen {
  /** Höchstzahl der Versuche je Anfrage (Standard 6). */
  versuche?: number;
  /** Vorübergehender Fehler, der eine Wiederholung lohnt (Netz, Zeitlimit, 5xx). */
  voruebergehend?: (fehler: unknown) => boolean;
  /** Vom Quellsystem verlangte Wartezeit in Sekunden (Ratenbegrenzung, `Retry-After`), sonst `undefined`. */
  wartezeit?: (fehler: unknown) => number | undefined;
  /** Ratenbegrenzung der Quelle; Standard aus dem Adapter. */
  rate?: Rate;
  /** Für Tests: Warten und Uhr. */
  warte?: (ms: number) => Promise<void>;
  jetzt?: () => number;
}

/** Höchstzahl der Seiten je Abfrage; schützt vor einer Quelle, die nie endet. */
export const MAX_SEITEN = 10_000;
/** Längste Wartezeit zwischen zwei Versuchen. */
export const MAX_WARTEN_MS = 120_000;

export class QuellFehler extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const standardWarten = (ms: number) => new Promise<void>((fertig) => setTimeout(fertig, ms));

/** Verbindung zu einer Quell-API während eines Laufs: jede Anfrage geht durch Ratenbegrenzung und Wiederholung. */
export class Abrufkontext {
  private naechsteAnfrage = 0;
  /** Zahl der Anfragen und Wiederholungen des Laufs (für das Protokoll). */
  readonly zaehler = { anfragen: 0, wiederholungen: 0 };

  constructor(
    private readonly abfrage: QuellAbfrage,
    private readonly optionen: AbrufOptionen = {},
  ) {}

  private async warteAufRate() {
    const rate = this.optionen.rate;
    if (!rate || rate.anfragen <= 0) return;
    const jetzt = (this.optionen.jetzt ?? Date.now)();
    const abstand = (rate.sekunden * 1000) / rate.anfragen;
    const start = Math.max(jetzt, this.naechsteAnfrage);
    this.naechsteAnfrage = start + abstand;
    if (start > jetzt) await (this.optionen.warte ?? standardWarten)(start - jetzt);
  }

  /** Eine Anfrage mit Ratenbegrenzung und Wiederholung (exponentiell, oder so lange, wie die Quelle verlangt). */
  async rufe(pfad: string, koerper?: object): Promise<unknown> {
    const versuche = this.optionen.versuche ?? 6;
    for (let versuch = 1; ; versuch++) {
      await this.warteAufRate();
      this.zaehler.anfragen++;
      try {
        return await this.abfrage(pfad, koerper);
      } catch (fehler) {
        const verlangt = this.optionen.wartezeit?.(fehler);
        const nochmal = verlangt !== undefined || (this.optionen.voruebergehend?.(fehler) ?? false);
        if (!nochmal || versuch >= versuche) throw fehler;
        this.zaehler.wiederholungen++;
        const ms = Math.min(MAX_WARTEN_MS, verlangt !== undefined ? verlangt * 1000 : 500 * 2 ** (versuch - 1));
        await (this.optionen.warte ?? standardWarten)(ms);
      }
    }
  }
}

export interface Seite<T> {
  eintraege: T[];
  /** Cursor der nächsten Seite, `null` am Ende. */
  weiter: string | null;
}

/** Liest alle Seiten einer Abfrage. Ein wiederholter Cursor oder zu viele Seiten brechen mit `invalid_pagination` ab. */
export async function leseAlleSeiten<T>(holeSeite: (cursor: string | null) => Promise<Seite<T>>): Promise<T[]> {
  const alle: T[] = [];
  const gesehen = new Set<string>();
  let cursor: string | null = null;
  for (let n = 0; ; n++) {
    if (n >= MAX_SEITEN) throw new QuellFehler("invalid_pagination");
    const seite: Seite<T> = await holeSeite(cursor);
    alle.push(...seite.eintraege);
    if (seite.weiter === null) return alle;
    if (gesehen.has(seite.weiter)) throw new QuellFehler("invalid_pagination");
    gesehen.add(seite.weiter);
    cursor = seite.weiter;
  }
}

/**
 * Regel für wiederholte Ereignisse: Vorgänge dieser Arten werden je Beteiligung, Instrument und Periode zu einem Vorgang
 * zusammengeführt (z. B. monatlich gebuchte Zinsen eines Darlehens als ein Vorgang je Quartal).
 */
export interface Zusammenfuehrung {
  arten: VorgangArt[];
  periode: Periode;
}

/** Standard: Zinsen und Zinszahlungen je Quartal zusammenführen; alle anderen Vorgänge einzeln. */
export const STANDARD_ZUSAMMENFUEHRUNG: Zusammenfuehrung = { arten: ["zins", "zinszahlung"], periode: "quartal" };

/** Was ein Lauf vom Quellsystem liest. */
export interface Lesewunsch {
  /** Quell-IDs der Fonds; leer heißt alle Fonds, die der Zugang sieht. */
  fonds: string[];
}

/**
 * Ein Quellsystem. Ein Adapter liest Fonds und je Fonds alle Daten (Abfragen je Fonds, verschachtelte Typen, Seiten) und liefert
 * das neutrale Zwischenmodell. Zugangsdaten sieht er nur als Kopfzeilen; er schreibt nichts und speichert nichts.
 */
export interface VorsystemAdapter {
  /** Kurzer, stabiler Name (`[a-z0-9-]`); Teil jedes Fachschlüssels, den die Übernahme anlegt. */
  id: string;
  /** Anzeigename. */
  bezeichnung: string;
  /** Ursprung der API (`https://…`), wenn er für alle Kunden gleich ist. Ein Zugang aus der Umgebungsvariablen geht nur hierhin. */
  standardUrsprung?: string;
  /**
   * Hosts, die eine Verbindung als Ursprung wählen darf (z. B. je Kunde eigene Instanzen): genauer Hostname oder `*.domain` für jede
   * Subdomain. Ohne Angabe ist nur der Standard-Ursprung erlaubt. Ein anderer Ursprung braucht einen gespeicherten Zugang.
   */
  erlaubteHosts?: readonly string[];
  /** Erlaubte Pfade der API (Schutz gegen Weiterleitung auf fremde Pfade); Standard alle unter dem Ursprung. */
  erlaubterPfad?: (pfad: string) => boolean;
  /** Kopfzeilen für die Anmeldung; Standard `Authorization: Bearer <Zugang>`. */
  kopfzeilen?: (zugang: string) => Record<string, string>;
  /** Ratenbegrenzung der Quelle. */
  rate?: Rate;
  /** Umgebungsvariable, aus der der Zugang gelesen werden kann (statt gespeichert). */
  umgebungsvariable?: string;
  /** Alle Fonds, die der Zugang sieht. */
  leseFonds(k: Abrufkontext): Promise<QuellFonds[]>;
  /** Alle Daten eines Fonds. */
  leseAuszug(k: Abrufkontext, fonds: QuellFonds): Promise<FondsAuszug>;
}

/**
 * Ist `ursprung` für den Adapter erlaubt? Nur `https`, ohne Pfad, Anmeldedaten oder eigenen Port, und entweder der Standard-Ursprung oder
 * ein Host aus `erlaubteHosts`. Gibt den normalisierten Ursprung zurück, sonst `null`.
 */
export function erlaubterUrsprung(adapter: Pick<VorsystemAdapter, "standardUrsprung" | "erlaubteHosts">, ursprung: string): string | null {
  let url: URL;
  try {
    url = new URL(ursprung);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) return null;
  const host = url.hostname.toLowerCase();
  if (adapter.standardUrsprung && new URL(adapter.standardUrsprung).origin === url.origin) return url.origin;
  const passt = (adapter.erlaubteHosts ?? []).some((muster) => {
    const m = muster.toLowerCase();
    return m.startsWith("*.") ? host.endsWith(m.slice(1)) && host.length > m.length - 1 : host === m;
  });
  return passt ? url.origin : null;
}

/** Was ein Lauf gelesen hat: alle Fonds, die der Zugang sieht (für Verweise auf nicht gewählte Fonds), und je gewähltem Fonds den Auszug. */
export interface Gelesen {
  alleFonds: QuellFonds[];
  auszuege: FondsAuszug[];
}

/** Liest die gewünschten Fonds nacheinander (je Fonds eigene Abfragen). Ein unbekannter Fonds im Wunsch ist ein Fehler. */
export async function leseVorsystem(adapter: VorsystemAdapter, k: Abrufkontext, wunsch: Lesewunsch): Promise<Gelesen> {
  const alleFonds = await adapter.leseFonds(k);
  const ids = new Set(wunsch.fonds);
  const gewaehlt = ids.size ? alleFonds.filter((f) => ids.has(f.quellId)) : alleFonds;
  if (ids.size && gewaehlt.length !== ids.size) throw new QuellFehler("source_fund_not_found");
  const auszuege: FondsAuszug[] = [];
  for (const fonds of gewaehlt) auszuege.push(await adapter.leseAuszug(k, fonds));
  return { alleFonds, auszuege };
}
