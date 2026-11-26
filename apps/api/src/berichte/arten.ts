import type { BerichtsOptionen, Sprache } from "@carraway/berichte";
import type { Bericht } from "@carraway/db";
import type { Fachfehler, Fehlercode } from "../fehler";
import type { Tx } from "../zeitlimit";
import type { Pruefung } from "./kontrolle";

/**
 * Berichtsarten aus Erweiterungen (Open Core, `ee/`), z. B. die PAI-Erklärung der Erweiterung ESG. Die Arten des Kerns stehen fest in
 * `erzeugen.ts`, `kontrolle.ts` und `routen/berichtsfreigabe.ts`; eine Art aus einer Erweiterung bringt hier alles mit, was diese Stellen brauchen.
 * Ohne angemeldete Art lehnt die API das Anlegen ab (400 `art_nicht_verfuegbar`).
 */
export interface Berichtsart {
  /** Erlaubte Formate. */
  formate: readonly Bericht["format"][];
  /** Anfang des Dateinamens je Sprache (z. B. `pai-erklaerung`). */
  dateiname: Record<Sprache, string>;
  /** Erzeugt die Datei des Berichts. */
  erzeuge(k: { tx: Tx; b: Bericht; sprache: Sprache; stand: string; standIso: string; gemeinsam: BerichtsOptionen; nichtGefunden: () => Fachfehler }): Promise<Uint8Array>;
  /** Prüfungen des Kontrollberichts vor der Freigabe. */
  pruefungen?(tx: Pick<Tx, "execute" | "select">, b: Bericht, stand: string | undefined): Promise<Pruefung[]>;
  /** Freitextabschnitte: erlaubte Schlüssel und der Abschnitt der Vorlage, zu dem ein Schlüssel gehört. */
  freitexte?: { schluessel(): readonly string[]; abschnitt(schluessel: string): string };
  /** Beim Anlegen: Vorgabe und Prüfung des Stichtags, Parameter, Übernahme der Texte aus dem Vorjahr. */
  anlage?: {
    standardStichtag?(heute: string): string;
    /** Meldung, wenn der Stichtag nicht passt (`null` = in Ordnung); Feldfehler `stichtag` mit `code`. */
    pruefeStichtag?(stichtag: string): { code: string; meldung: string } | null;
    parameter?(): Record<string, unknown>;
    /** Texte der letzten freigegebenen Fassung mit früherem Stichtag als Entwurf übernehmen; Fehlercode, wenn es keine gibt. */
    texteAusVorjahr?: { fehlerCode: Fehlercode; meldung: string };
  };
}

const ARTEN = new Map<string, Berichtsart>();

/** Meldet Berichtsarten an (beim Bau der Anwendung bzw. beim Start des Workers). */
export function registriereBerichtsarten(arten: Record<string, Berichtsart>): void {
  for (const [art, definition] of Object.entries(arten)) ARTEN.set(art, definition);
}

/** Die angemeldete Art aus einer Erweiterung, sonst `undefined`. */
export const berichtsartAusErweiterung = (art: string): Berichtsart | undefined => ARTEN.get(art);
