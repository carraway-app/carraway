/**
 * Kleiner Textauszug aus einer rohen Nachricht (RFC 5322/2045) für den IMAP-Adapter: erster `text/plain`-Teil, Inhalts-Kodierung
 * (7bit, 8bit, quoted-printable, base64) und Zeichensatz (UTF-8, ISO-8859-1/Windows-1252, ASCII). Kein vollständiger MIME-Parser; HTML-Teile werden
 * nicht ausgewertet. Anhänge werden nie gelesen.
 */

interface Teil {
  kopf: Map<string, string>;
  koerper: string;
}

function zerlege(roh: string): Teil {
  const m = /\r?\n\r?\n/.exec(roh);
  const kopfText = m ? roh.slice(0, m.index) : roh;
  const koerper = m ? roh.slice(m.index + m[0].length) : "";
  const kopf = new Map<string, string>();
  // Gefaltete Zeilen zusammenziehen.
  for (const zeile of kopfText.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = zeile.indexOf(":");
    if (i > 0) kopf.set(zeile.slice(0, i).trim().toLowerCase(), zeile.slice(i + 1).trim());
  }
  return { kopf, koerper };
}

const parameter = (wert: string | undefined, name: string): string | null => {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|[^;\\s]+)`, "i").exec(wert ?? "");
  return m ? (m[2] ?? m[1] ?? null) : null;
};

function dekodiere(koerper: string, kodierung: string | undefined, zeichensatz: string | null): string {
  const art = (kodierung ?? "7bit").toLowerCase();
  let bytes: Buffer;
  if (art === "base64") bytes = Buffer.from(koerper.replace(/\s+/g, ""), "base64");
  else if (art === "quoted-printable") {
    const ohneWeich = koerper.replace(/=\r?\n/g, "");
    const liste: number[] = [];
    for (let i = 0; i < ohneWeich.length; i++) {
      const c = ohneWeich[i]!;
      if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(ohneWeich.slice(i + 1, i + 3))) {
        liste.push(parseInt(ohneWeich.slice(i + 1, i + 3), 16));
        i += 2;
      } else liste.push(...Buffer.from(c, "utf8"));
    }
    bytes = Buffer.from(liste);
  } else bytes = Buffer.from(koerper, "latin1");
  const cs = (zeichensatz ?? "utf-8").toLowerCase();
  if (cs.includes("8859-1") || cs.includes("1252") || cs === "us-ascii" || cs === "ascii") return bytes.toString("latin1");
  return bytes.toString("utf8");
}

function textAus(teil: Teil, tiefe = 0): string | null {
  const typ = teil.kopf.get("content-type") ?? "text/plain";
  if (/^multipart\//i.test(typ) && tiefe < 4) {
    const grenze = parameter(typ, "boundary");
    if (!grenze) return null;
    for (const stueck of teil.koerper.split(`--${grenze}`).slice(1)) {
      if (stueck.startsWith("--")) break;
      const r = textAus(zerlege(stueck.replace(/^\r?\n/, "")), tiefe + 1);
      if (r !== null) return r;
    }
    return null;
  }
  if (!/^text\/plain/i.test(typ)) return null;
  // Anhänge im Textformat nicht als Nachrichtentext nehmen.
  if (/attachment/i.test(teil.kopf.get("content-disposition") ?? "")) return null;
  return dekodiere(teil.koerper, teil.kopf.get("content-transfer-encoding"), parameter(typ, "charset"));
}

/** Klartext der Nachricht, höchstens `max` Zeichen, mit zusammengezogenem Leerraum; leer, wenn es keinen Textteil gibt. */
export function textauszug(roh: string, max: number): string {
  const t = textAus(zerlege(roh)) ?? "";
  return t.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}
