// Kontrastprüfung der Farbtokens (WCAG 2.2, Stufe AA) für beide Themen und Prüfung der Stilvorlagen auf feste Farbwerte.
//   node scripts/design/kontrast.mjs [--tabelle]
// Quelle ist design/tokens.json: Die Paare stehen unter `color.kontrast` (Text 4,5 : 1, Linien und Bedienelemente 3 : 1).
// Hintergründe der Form `name@grund` legen eine durchscheinende Farbe über `grund`, `name/14@grund` nimmt 14 % der Farbe `name`.
// Danach: Keine Stilvorlage außerhalb von tokens.css schreibt einen festen Farbwert, liest ein Primitiv (`--p-…`) oder einen alten Farbnamen.
// Exit 1 bei einem Verstoß.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tokens = JSON.parse(fs.readFileSync(path.join(WURZEL, "design/tokens.json"), "utf8"));
const MIT_TABELLE = process.argv.includes("--tabelle");

const primitive = Object.fromEntries(tokens.color.primitives.map((p) => [p.name, p.value]));
const semantik = tokens.color.semantic;

/** Farbe als [r, g, b, a] (0–255, a 0–1) aus #rrggbb, #rgb oder rgba(). */
function lies(wert) {
  const w = wert.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(w);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^#([0-9a-f]{3})$/i.exec(w);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)).concat(1);
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(w);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  throw new Error(`Unbekannter Farbwert: ${wert}`);
}
const ueber = (oben, unten) => {
  const a = oben[3];
  return [0, 1, 2].map((i) => oben[i] * a + unten[i] * (1 - a)).concat(1);
};
const leuchtdichte = ([r, g, b]) => {
  const k = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * k(r) + 0.7152 * k(g) + 0.0722 * k(b);
};
const verhaeltnis = (a, b) => {
  const [x, y] = [leuchtdichte(a), leuchtdichte(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const hex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

function farbenDes(thema) {
  const werte = {};
  for (const s of semantik) {
    const roh = s[thema];
    if (roh === undefined) throw new Error(`Token ${s.name} hat keinen Wert für ${thema}`);
    const wert = primitive[roh] ?? roh;
    werte[s.name] = lies(wert);
  }
  return werte;
}

/** Löst `name`, `name@grund` und `name/14@grund` in eine deckende Farbe auf. */
function deckend(ausdruck, werte, standardGrund = "bg") {
  const [vorne, grund = standardGrund] = ausdruck.split("@");
  const [name, anteil] = vorne.split("/");
  const farbe = werte[name];
  if (!farbe) throw new Error(`Unbekanntes Token im Paar: ${name}`);
  const oben = anteil === undefined ? farbe : [...farbe.slice(0, 3), (farbe[3] * Number(anteil)) / 100];
  if (oben[3] >= 1) return oben;
  const unten = werte[grund];
  if (!unten || unten[3] < 1) throw new Error(`Grund ${grund} fehlt oder ist nicht deckend`);
  return ueber(oben, unten);
}

let verstoesse = 0;
let geprueft = 0;
const tabelle = [];
for (const thema of tokens.color.themes.map((t) => t.id)) {
  const werte = farbenDes(thema);
  for (const paar of tokens.color.kontrast) {
    for (const fg of paar.fg) {
      for (const bg of paar.bg) {
        const hinten = deckend(bg, werte);
        const vorne = deckend(fg, { ...werte }, bg.includes("@") ? bg.split("@")[1] : bg);
        const v = verhaeltnis(vorne, hinten);
        geprueft++;
        const ok = v >= paar.min;
        if (!ok) verstoesse++;
        tabelle.push({ thema, fg, bg, v, min: paar.min, ok, vorne: hex(vorne), hinten: hex(hinten) });
        if (!ok) console.error(`FEHLER ${thema.padEnd(6)} ${fg} auf ${bg}: ${v.toFixed(2)} : 1 (${hex(vorne)} auf ${hex(hinten)}, verlangt ${paar.min} : 1, ${paar.art})`);
      }
    }
  }
}
if (MIT_TABELLE) {
  for (const z of tabelle) console.log(`${z.ok ? "ok    " : "FEHLER"} ${z.thema.padEnd(6)} ${z.fg.padEnd(14)} ${z.bg.padEnd(24)} ${z.v.toFixed(2).padStart(6)} : 1  (min ${z.min})`);
}
const knapp = tabelle.filter((z) => z.ok).sort((a, b) => a.v / a.min - b.v / b.min).slice(0, 5);
console.log(`Kontrast: ${geprueft} Paare in ${tokens.color.themes.length} Themen geprüft, ${verstoesse} Verstöße.`);
console.log(`Knappste Paare: ${knapp.map((z) => `${z.thema} ${z.fg} auf ${z.bg} ${z.v.toFixed(2)}`).join("; ")}`);

// Stilvorlagen: feste Farbwerte, Primitive und alte Farbnamen außerhalb von tokens.css.
const ALTE_NAMEN = ["basalt", "schiefer", "fels", "linie", "linie-stark", "kalk", "grau", "leise", "signal", "signal-flaeche", "negativ", "negativ-flaeche"];
const ORDNER = ["packages/ui/src", "apps/web/src"];
const dateien = [];
const sammle = (ordner) => {
  for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
    const p = path.join(ordner, e.name);
    if (e.isDirectory()) sammle(p);
    else if (e.name.endsWith(".css") && e.name !== "tokens.css" && e.name !== "schriften.css") dateien.push(p);
  }
};
for (const o of ORDNER) sammle(path.join(WURZEL, o));
let funde = 0;
for (const datei of dateien) {
  const zeilen = fs.readFileSync(datei, "utf8").split("\n");
  zeilen.forEach((zeile, i) => {
    // Die Maske der Reiterleiste nutzt #000 nur als Deckkraft, nicht als Farbe.
    const ohneMaske = zeile.replace(/mask-image:[^;]*;/g, "");
    const gruende = [];
    if (/#[0-9a-f]{3,8}\b/i.test(ohneMaske)) gruende.push("fester Farbwert");
    if (/\b(rgba?|hsla?)\(/i.test(ohneMaske)) gruende.push("fester Farbwert");
    if (/var\(--p-/.test(zeile)) gruende.push("Primitiv statt semantischem Token");
    const alt = ALTE_NAMEN.find((n) => new RegExp(`var\\(--${n}[,)]`).test(zeile));
    if (alt) gruende.push(`alter Farbname --${alt}`);
    if (gruende.length) {
      funde++;
      console.error(`FEHLER ${path.relative(WURZEL, datei)}:${i + 1}: ${[...new Set(gruende)].join(", ")}`);
    }
  });
}
console.log(`Stilvorlagen: ${dateien.length} Dateien geprüft, ${funde} Stellen mit festen Farben oder alten Namen.`);

process.exit(verstoesse + funde > 0 ? 1 : 0);
