import type { AufgeloestesFeld } from "./objekte";
import type { Option } from "./felder";

/**
 * CSV eines Ansichtsergebnisses. Textzellen, die mit `=`, `+`, `-`, `@`, Tabulator oder Zeilenumbruch beginnen, bekommen ein
 * vorangestelltes Hochkomma, damit Tabellenkalkulationen sie nicht als Formel ausführen (CSV-Injection). Zahlen und Beträge bleiben unverändert.
 */
const FORMEL = /^[=+\-@\t\r]/;
const ZAHLTYPEN = new Set(["zahl", "betrag"]);

export function csvZelle(text: string, schuetzen: boolean): string {
  const sicher = schuetzen && FORMEL.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(sicher) ? `"${sicher.replace(/"/g, '""')}"` : sicher;
}

function alsText(feld: AufgeloestesFeld, wert: unknown, bezuege: Record<string, string | null>): string {
  if (wert === null || wert === undefined) return "";
  const optionen = ((feld.optionen.optionen as Option[] | undefined) ?? []);
  const label = (k: string) => optionen.find((o) => o.schluessel === k)?.label ?? k;
  switch (feld.typ) {
    case "auswahl":
      return label(String(wert));
    case "mehrfachauswahl":
      return Array.isArray(wert) ? wert.map((w) => label(String(w))).join(", ") : "";
    case "kontrollkaestchen":
      return wert ? "ja" : "nein";
    case "verknuepfung":
      return feld.ziel ? (bezuege[`${feld.ziel}:${String(wert)}`] ?? "") : "";
    case "benutzer":
      return bezuege[`benutzer:${String(wert)}`] ?? "";
    default:
      return String(wert);
  }
}

export function erzeugeCsv(felder: AufgeloestesFeld[], zeilen: Record<string, unknown>[], bezuege: Record<string, string | null>): string {
  const kopf = felder.map((f) => csvZelle(f.name, true)).join(",");
  const koerper = zeilen.map((z) => felder.map((f) => csvZelle(alsText(f, z[f.schluessel], bezuege), !ZAHLTYPEN.has(f.typ) && f.typ !== "datum")).join(","));
  return `${[kopf, ...koerper].join("\n")}\n`;
}
