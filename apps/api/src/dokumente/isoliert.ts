import { Worker } from "node:worker_threads";
import { OcrFehler, type ErkannteSeite, type OcrKonfiguration, type Texterkenner } from "./ocr";
import type { Textauszug } from "./text";

/**
 * Läuft ein Auszug (Office-Datei, Texterkennung) in einem eigenen Thread mit hartem Zeitlimit: Beim Überschreiten wird der Thread beendet
 * (`terminate`), die Arbeit läuft also nicht im Hintergrund weiter und blockiert den Worker nicht. Der Speicher des Threads ist begrenzt.
 * Ein Absturz oder Abbruch ist ein Fehler des Aufrufs; der Aufrufer entscheidet, ob es einen weiteren Versuch gibt.
 */

export type Aufgabe =
  | { art: "docx" | "xlsx"; bytes: Uint8Array }
  | { art: "ocr"; bytes: Uint8Array; kind: "pdf" | "bild"; konfiguration: OcrKonfiguration };

export class IsolationsFehler extends Error {
  constructor(
    readonly code: "zeitlimit" | "abgebrochen" | "fehler" | "zu_viele_seiten" | "nicht_lesbar" | "zu_gross",
    meldung: string,
  ) {
    super(meldung);
  }
}

/** Quelle des Arbeits-Threads: im Bündel `.js` neben dem Worker, in Entwicklung und Tests die TypeScript-Datei (über `tsx`). */
function arbeiter(): { datei: URL; execArgv: string[] } {
  const ts = import.meta.url.endsWith(".ts");
  return { datei: new URL(ts ? "./auszug-prozess.ts" : "./auszug-prozess.js", import.meta.url), execArgv: ts ? ["--import", "tsx"] : [] };
}

export function laufeIsoliert<T>(aufgabe: Aufgabe, zeitlimitMs: number): Promise<T> {
  return new Promise<T>((ok, nein) => {
    const { datei, execArgv } = arbeiter();
    const w = new Worker(datei, { workerData: aufgabe, execArgv, resourceLimits: { maxOldGenerationSizeMb: 1024, maxYoungGenerationSizeMb: 128, stackSizeMb: 4 } });
    let fertig = false;
    const beende = (aktion: () => void) => {
      if (fertig) return;
      fertig = true;
      clearTimeout(uhr);
      void w.terminate().finally(aktion);
    };
    const uhr = setTimeout(() => beende(() => nein(new IsolationsFehler("zeitlimit", "Zeitlimit überschritten."))), zeitlimitMs);
    w.once("message", (m: { ok: boolean; ergebnis?: T; code?: IsolationsFehler["code"]; meldung?: string }) =>
      beende(() => (m.ok ? ok(m.ergebnis as T) : nein(new IsolationsFehler(m.code ?? "fehler", m.meldung ?? "Fehler")))),
    );
    w.once("error", (e) => beende(() => nein(new IsolationsFehler("abgebrochen", e instanceof Error ? e.message : String(e)))));
    w.once("exit", () => beende(() => nein(new IsolationsFehler("abgebrochen", "Der Arbeits-Thread endete ohne Ergebnis."))));
  });
}

/** Office-Auszug im eigenen Thread. */
export const extrahiereOfficeIsoliert = (art: "docx" | "xlsx", bytes: Uint8Array, zeitlimitMs: number): Promise<Textauszug> => laufeIsoliert<Textauszug>({ art, bytes }, zeitlimitMs);

/** Texterkennung im eigenen Thread (zusätzlich zum Zeitlimit im Erkenner selbst); Fehler kommen als `OcrFehler` an. */
export class IsolierterErkenner implements Texterkenner {
  async erkenne(bytes: Uint8Array, art: "pdf" | "bild", konfiguration: OcrKonfiguration): Promise<{ seitenzahl: number; seiten: ErkannteSeite[] }> {
    try {
      return await laufeIsoliert({ art: "ocr", bytes, kind: art, konfiguration }, konfiguration.zeitlimitMs + 15_000);
    } catch (fehler) {
      if (fehler instanceof IsolationsFehler) {
        throw new OcrFehler(fehler.code === "zeitlimit" || fehler.code === "zu_viele_seiten" || fehler.code === "nicht_lesbar" || fehler.code === "zu_gross" ? fehler.code : "nicht_lesbar", fehler.message);
      }
      throw fehler;
    }
  }
}
