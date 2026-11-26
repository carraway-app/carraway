import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";

/**
 * Typst-Anbindung. Die Daten gehen als Typst-Literal in die Quelle (`#let data = (...)`), nie als Markup:
 * Zeichenketten werden in Anführungszeichen gesetzt und maskiert, damit Daten keinen Typst-Code einschleusen können.
 */

export type TypstWert = string | number | boolean | null | TypstWert[] | { [schluessel: string]: TypstWert };

const SCHLUESSEL = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function zeichenkette(text: string): string {
  let aus = '"';
  for (const z of text) {
    if (z === "\\") aus += "\\\\";
    else if (z === '"') aus += '\\"';
    else if (z === "\n") aus += "\\n";
    else if (z === "\r") aus += "\\r";
    else if (z === "\t") aus += "\\t";
    else aus += z;
  }
  return `${aus}"`;
}

/** Wandelt einen JSON-artigen Wert in ein Typst-Literal. */
export function literal(wert: TypstWert): string {
  if (wert === null) return "none";
  if (typeof wert === "string") return zeichenkette(wert);
  if (typeof wert === "number") {
    if (!Number.isFinite(wert)) throw new Error("Typst-Literal: Zahl nicht endlich");
    return String(wert);
  }
  if (typeof wert === "boolean") return wert ? "true" : "false";
  if (Array.isArray(wert)) return wert.length === 0 ? "()" : `(${wert.map(literal).join(", ")},)`;
  const eintraege = Object.entries(wert);
  if (eintraege.length === 0) return "(:)";
  return `(${eintraege
    .map(([k, v]) => {
      if (!SCHLUESSEL.test(k)) throw new Error(`Typst-Literal: ungültiger Schlüssel ${k}`);
      return `${k}: ${literal(v)}`;
    })
    .join(", ")})`;
}

/** Ordner mit den Schriften: `BERICHTE_SCHRIFTEN`, neben dem Bundle (`dist/fonds`) oder im Paket. */
function schriftenOrdner(): string {
  const kandidaten = [process.env.BERICHTE_SCHRIFTEN, fileURLToPath(new URL("./schriften", import.meta.url)), fileURLToPath(new URL("../fonts", import.meta.url))];
  for (const k of kandidaten) if (k && existsSync(k)) return k;
  throw new Error("Berichte: Schriftenordner nicht gefunden (BERICHTE_SCHRIFTEN setzen)");
}

let compiler: NodeCompiler | undefined;

/** Der Compiler wird einmal je Prozess angelegt (Schriften laden kostet rund 200 ms). */
function holeCompiler(): NodeCompiler {
  compiler ??= NodeCompiler.create({ workspace: schriftenOrdner(), fontArgs: [{ fontPaths: [schriftenOrdner()] }] });
  return compiler;
}

/** Setzt Typst-Quelltext zu einem PDF. Wirft bei Typst-Fehlern mit der Meldung des Compilers. */
export function setzePdf(quelle: string): Uint8Array {
  const pdf = holeCompiler().pdf({ mainFileContent: quelle });
  if (!pdf || pdf.length === 0) throw new Error("Typst hat kein PDF erzeugt");
  return pdf;
}
