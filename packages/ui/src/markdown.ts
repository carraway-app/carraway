/**
 * Kleiner Markdown-Parser für Freitextfelder. Ergebnis ist ein Baum, kein HTML: roher HTML-Text bleibt Text und wird von React
 * als Text ausgegeben. Unterstützt werden Absätze (Zeilenumbruch = Umbruch), Überschriften (`#`), Listen (`-`, `*`, `1.`, auch
 * verschachtelt), Zitate (`>`), Codeblöcke (```), Code (`` ` ``), fett (`**`), kursiv (`*`, `_`), Links (`[Text](Adresse)`, bare
 * `http(s)://`-Adressen) und Escapes (`\*`). Bilder werden nie geladen; es bleibt der Alternativtext. Keine Tabellen, kein HTML,
 * keine Fußnoten. Die Schachtelungstiefe ist begrenzt.
 */

export type MdInline =
  | { t: "text"; s: string }
  | { t: "code"; s: string }
  | { t: "br" }
  | { t: "strong"; c: MdInline[] }
  | { t: "em"; c: MdInline[] }
  /** `at`: der Link stand hinter einem „@“ (Erwähnung `@[Name](typ:id)`); das Zeichen gehört dann zur Anzeige. */
  | { t: "link"; href: string; c: MdInline[]; at: boolean };

export type MdBlock =
  | { t: "p"; c: MdInline[] }
  | { t: "h"; c: MdInline[] }
  | { t: "list"; ordered: boolean; items: MdBlock[][] }
  | { t: "quote"; c: MdBlock[] }
  | { t: "code"; s: string };

const MAX_TIEFE = 5;

/** Erlaubte Adressen in Links: http, https, mailto und Pfade der eigenen Anwendung. Alles andere (javascript:, data: …) nicht. */
export function sichereUrl(href: string): boolean {
  const h = href.trim();
  if (h.includes("\\")) return false;
  if (/^https?:\/\/[^\s]+$/i.test(h)) return true;
  if (/^mailto:[^\s]+$/i.test(h)) return true;
  return /^\/(?!\/)[^\s]*$/.test(h);
}

// Inline ----------------------------------------------------------------------------------------------------------------

const ESCAPE = /^\\([\\`*_{}[\]()#+\-.!>~|])/;
const BARE_URL = /^https?:\/\/[^\s<>]+/i;

function schliessend(s: string, ab: number, marke: string): number {
  // Position des schließenden Zeichens, das nicht von Leerraum davor stammt und nicht escaped ist.
  for (let i = ab; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === "`") {
      const ende = s.indexOf("`", i + 1);
      if (ende === -1) continue;
      i = ende;
      continue;
    }
    if (s.startsWith(marke, i) && i > ab && !/\s/.test(s[i - 1]!)) return i;
  }
  return -1;
}

function linkZiel(s: string, ab: number): { ende: number; href: string } | null {
  // s[ab] ist „(“; Adresse bis zum passenden „)“, ein Titel nach Leerzeichen wird ignoriert.
  let tiefe = 0;
  let i = ab;
  for (; i < s.length; i++) {
    const z = s[i]!;
    if (z === "\n") return null;
    if (z === "(") tiefe++;
    else if (z === ")") {
      tiefe--;
      if (tiefe === 0) break;
    }
  }
  if (tiefe !== 0) return null;
  const innen = s.slice(ab + 1, i).trim();
  const href = innen.split(/\s+/)[0] ?? "";
  if (href === "") return null;
  return { ende: i + 1, href };
}

function klammerEnde(s: string, ab: number): number {
  let tiefe = 0;
  for (let i = ab; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === "[") tiefe++;
    else if (s[i] === "]") {
      tiefe--;
      if (tiefe === 0) return i;
    }
  }
  return -1;
}

export function parseInline(s: string, tiefe = 0, ohneLinks = false): MdInline[] {
  const aus: MdInline[] = [];
  let puffer = "";
  const leere = () => {
    if (puffer !== "") aus.push({ t: "text", s: puffer });
    puffer = "";
  };
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    const z = s[i]!;
    const davor = i > 0 ? s[i - 1]! : " ";

    const esc = ESCAPE.exec(rest);
    if (esc) {
      puffer += esc[1];
      i += 2;
      continue;
    }
    if (z === "\n") {
      leere();
      aus.push({ t: "br" });
      i++;
      continue;
    }
    if (z === "`") {
      const ende = s.indexOf("`", i + 1);
      if (ende > i + 1) {
        leere();
        aus.push({ t: "code", s: s.slice(i + 1, ende) });
        i = ende + 1;
        continue;
      }
    }
    if (tiefe < MAX_TIEFE) {
      // Bild: nie laden, nur Alternativtext.
      if (z === "!" && s[i + 1] === "[") {
        const ke = klammerEnde(s, i + 1);
        if (ke !== -1 && s[ke + 1] === "(") {
          const ziel = linkZiel(s, ke + 1);
          if (ziel) {
            puffer += s.slice(i + 2, ke);
            i = ziel.ende;
            continue;
          }
        }
      }
      if (z === "[" && !ohneLinks) {
        const ke = klammerEnde(s, i);
        if (ke !== -1 && s[ke + 1] === "(") {
          const ziel = linkZiel(s, ke + 1);
          if (ziel) {
            const at = puffer.endsWith("@");
            if (at) puffer = puffer.slice(0, -1);
            leere();
            aus.push({ t: "link", href: ziel.href, c: parseInline(s.slice(i + 1, ke), tiefe + 1, true), at });
            i = ziel.ende;
            continue;
          }
        }
      }
      if (z === "*" || z === "_") {
        const doppelt = s[i + 1] === z;
        const marke = doppelt ? z + z : z;
        const nachMarke = s[i + marke.length] ?? " ";
        const wortBeginn = z !== "_" || !/\w/.test(davor);
        if (!/\s/.test(nachMarke) && wortBeginn && nachMarke !== z) {
          const ende = schliessend(s, i + marke.length, marke);
          const danach = ende === -1 ? " " : (s[ende + marke.length] ?? " ");
          if (ende !== -1 && (z !== "_" || !/\w/.test(danach))) {
            leere();
            const inhalt = parseInline(s.slice(i + marke.length, ende), tiefe + 1, ohneLinks);
            aus.push({ t: doppelt ? "strong" : "em", c: inhalt });
            i = ende + marke.length;
            continue;
          }
        }
      }
    }
    if (!ohneLinks && (z === "h" || z === "H") && !/\w/.test(davor)) {
      const url = BARE_URL.exec(rest);
      if (url) {
        const roh = url[0].replace(/[.,;:!?)\]'"]+$/, "");
        if (/^https?:\/\/[^\s.]+\.?[^\s]*/i.test(roh) && roh.length > 8) {
          leere();
          aus.push({ t: "link", href: roh, c: [{ t: "text", s: roh }], at: false });
          i += roh.length;
          continue;
        }
      }
    }
    puffer += z;
    i++;
  }
  leere();
  return aus;
}

// Blöcke ----------------------------------------------------------------------------------------------------------------

const LISTE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const UEBERSCHRIFT = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const ZAUN = /^\s{0,3}(```|~~~)/;

function beginntBlock(zeile: string): boolean {
  return ZAUN.test(zeile) || UEBERSCHRIFT.test(zeile) || LISTE.test(zeile) || /^\s{0,3}>/.test(zeile);
}

const einrueckung = (s: string) => s.length - s.trimStart().length;

export function parseMarkdown(text: string, tiefe = 0): MdBlock[] {
  const zeilen = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  return parseZeilen(zeilen, tiefe);
}

function parseZeilen(zeilen: string[], tiefe: number): MdBlock[] {
  const aus: MdBlock[] = [];
  let i = 0;
  while (i < zeilen.length) {
    const zeile = zeilen[i]!;
    if (zeile.trim() === "") {
      i++;
      continue;
    }
    const zaun = ZAUN.exec(zeile);
    if (zaun) {
      const code: string[] = [];
      i++;
      while (i < zeilen.length && !zeilen[i]!.trimStart().startsWith(zaun[1]!)) code.push(zeilen[i++]!);
      i++;
      aus.push({ t: "code", s: code.join("\n") });
      continue;
    }
    const ue = UEBERSCHRIFT.exec(zeile);
    if (ue) {
      aus.push({ t: "h", c: parseInline(ue[1]!, 0) });
      i++;
      continue;
    }
    if (tiefe < MAX_TIEFE && /^\s{0,3}>/.test(zeile)) {
      const innen: string[] = [];
      while (i < zeilen.length && /^\s{0,3}>/.test(zeilen[i]!)) innen.push(zeilen[i++]!.replace(/^\s{0,3}>\s?/, ""));
      aus.push({ t: "quote", c: parseZeilen(innen, tiefe + 1) });
      continue;
    }
    const li = LISTE.exec(zeile);
    if (li && tiefe < MAX_TIEFE) {
      const basis = li[1]!.length;
      const geordnet = /\d/.test(li[2]!);
      const eintraege: string[][] = [];
      while (i < zeilen.length) {
        const z = zeilen[i]!;
        if (z.trim() === "") {
          // Leerzeile: die Liste geht weiter, wenn danach wieder ein Eintrag oder eingerückter Text folgt.
          const naechste = zeilen.slice(i + 1).find((x) => x.trim() !== "");
          if (naechste === undefined) break;
          const m = LISTE.exec(naechste);
          if ((m && m[1]!.length >= basis && (m[1]!.length > basis || /\d/.test(m[2]!) === geordnet)) || einrueckung(naechste) > basis) {
            i++;
            continue;
          }
          break;
        }
        const m = LISTE.exec(z);
        if (m && m[1]!.length === basis) {
          if (/\d/.test(m[2]!) !== geordnet) break;
          eintraege.push([m[3]!]);
        } else if (m && m[1]!.length < basis) {
          break;
        } else if (eintraege.length > 0 && (einrueckung(z) > basis || (!m && !beginntBlock(z)))) {
          // Fortsetzung des Eintrags: eingerückt (Unterliste, weiterer Absatz) oder fortlaufender Text.
          eintraege[eintraege.length - 1]!.push(einrueckung(z) > basis ? z.slice(Math.min(einrueckung(z), basis + 2)) : z.trimStart());
        } else {
          break;
        }
        i++;
      }
      aus.push({ t: "list", ordered: geordnet, items: eintraege.map((e) => parseZeilen(e, tiefe + 1)) });
      continue;
    }
    const absatz: string[] = [];
    while (i < zeilen.length && zeilen[i]!.trim() !== "" && (absatz.length === 0 || !beginntBlock(zeilen[i]!))) absatz.push(zeilen[i++]!.trim());
    aus.push({ t: "p", c: parseInline(absatz.join("\n"), 0) });
  }
  return aus;
}
