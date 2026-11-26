import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { alsCsv, beispielZeilen, erzeugeBeispiel } from "../src/beispiel";
import { BLAETTER } from "../src/spec";

/** Schreibt die Beispieldateien nach `beispiel/` (erfundene Daten aus dem Demo-Generator). */
const ordner = fileURLToPath(new URL("../beispiel/", import.meta.url));
mkdirSync(`${ordner}csv`, { recursive: true });
writeFileSync(`${ordner}beispiel-de.xlsx`, await erzeugeBeispiel("de"));
writeFileSync(`${ordner}beispiel-en.xlsx`, await erzeugeBeispiel("en"));
const zeilen = beispielZeilen();
for (const blatt of BLAETTER) writeFileSync(`${ordner}csv/${blatt}.csv`, alsCsv(blatt, zeilen));
console.log("Beispieldateien geschrieben.");
