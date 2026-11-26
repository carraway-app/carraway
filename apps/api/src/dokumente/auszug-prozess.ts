import { parentPort, workerData } from "node:worker_threads";
import { OcrFehler, TesseractErkenner } from "./ocr";
import type { Aufgabe } from "./isoliert";
import { extrahiereOffice } from "./text";

/**
 * Einstieg des Arbeits-Threads für Office-Auszug und Texterkennung (siehe `isoliert.ts`). Läuft in einem eigenen Thread, den der Aufrufer bei
 * Überschreiten des Zeitlimits beendet; im Bündel liegt die Datei als `auszug-prozess.js` neben dem Worker.
 */
const aufgabe = workerData as Aufgabe;
try {
  const ergebnis = aufgabe.art === "ocr" ? await new TesseractErkenner().erkenne(aufgabe.bytes, aufgabe.kind, aufgabe.konfiguration) : await extrahiereOffice(aufgabe.art, aufgabe.bytes);
  parentPort!.postMessage({ ok: true, ergebnis });
} catch (fehler) {
  parentPort!.postMessage({ ok: false, code: fehler instanceof OcrFehler ? fehler.code : "fehler", meldung: fehler instanceof Error ? fehler.message : String(fehler) });
}
