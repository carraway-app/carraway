import { request as httpAnfrage, type IncomingMessage } from "node:http";
import { request as httpsAnfrage } from "node:https";
import { isIP } from "node:net";
import { istPrivateAdresse, standardAufloeser, type Aufloeser } from "../postfach/ziel";

/**
 * Einfacher, begrenzter Abruf einer öffentlichen Webseite (zum Beispiel der Website eines Unternehmens), ohne Fremddienst: ein HTTP-Aufruf vom eigenen Server.
 * Schutz vor Server-Side Request Forgery und Überlastung:
 *
 * - Nur `http` und `https`, nur die Standardports 80 und 443, keine Zugangsdaten in der Adresse, keine IP-Adressen als Host.
 * - Der Name wird je Schritt genau einmal aufgelöst und gegen die Sonderbereiche geprüft (lokal, privat, Link-Local wie `169.254.169.254`, gemeinsam genutzt, reserviert; eingebettetes
 *   IPv4 in IPv6 wird ausgepackt, siehe `postfach/ziel.ts`); verbunden wird mit **genau dieser Adresse** (kein zweiter DNS-Aufruf, kein Rebinding). Ein Name mit auch nur einer
 *   privaten Adresse ist verboten.
 * - Weiterleitungen folgt der Abruf selbst, höchstens `maxWeiterleitungen`, und prüft jedes Ziel von vorn (Schema, Port, Auflösung).
 * - Zeitlimit für den ganzen Abruf, Obergrenze der gelesenen Bytes (beim Lesen gezählt, `Content-Length` zählt nicht; der Rest wird nicht geladen), nur Textinhalte (HTML, Text).
 * - Es werden keine Kopfzeilen, Cookies oder Zugangsdaten mitgesendet; der Abruf gibt nur Text zurück, nie Antwortkopfzeilen.
 *
 * Gemeinsame technische Grundlage für alle Funktionen, die öffentliche Seiten lesen. Tests übergeben `aufloeser` und `transport`; kein Test erreicht ein Netzwerk.
 */

export type AbrufFehlerCode = "ABRUF_ADRESSE_UNGUELTIG" | "ABRUF_ZIEL_VERBOTEN" | "ABRUF_NICHT_AUFLOESBAR" | "ABRUF_ZEITLIMIT" | "ABRUF_FEHLER" | "ABRUF_ZU_VIELE_WEITERLEITUNGEN" | "ABRUF_KEIN_TEXT" | "ABRUF_STATUS";

export class AbrufFehler extends Error {
  constructor(
    readonly code: AbrufFehlerCode,
    readonly status?: number,
  ) {
    super(`Abruf: ${code}${status ? ` (HTTP ${status})` : ""}`);
  }
}

export interface AbrufGrenzen {
  zeitlimitMs: number;
  maxBytes: number;
  maxWeiterleitungen: number;
}
export const STANDARD_GRENZEN: AbrufGrenzen = { zeitlimitMs: 10_000, maxBytes: 500_000, maxWeiterleitungen: 3 };

/** Antwort eines Transports: Status, Kopfzeilen (klein geschrieben) und der Rumpf als Stück-Folge. */
export interface TransportAntwort {
  status: number;
  kopf: Record<string, string | undefined>;
  rumpf: AsyncIterable<Uint8Array>;
  /** Bricht den Rumpf ab (Verbindung schließen), wenn nicht alles gelesen wird. */
  abbrechen(): void;
}
export interface TransportAnfrage {
  url: URL;
  /** Geprüfte Adresse, mit der verbunden werden muss; `url.hostname` bleibt der Name (Host-Kopfzeile, TLS-Servername). */
  ip: string;
  signal: AbortSignal;
}
export type Transport = (a: TransportAnfrage) => Promise<TransportAntwort>;

/** Echter Transport über `node:http(s)`: verbindet mit der geprüften Adresse, ohne Agent, Cookies oder Weiterleitungen. */
export const echterTransport: Transport = ({ url, ip, signal }) =>
  new Promise((aufloesen, ablehnen) => {
    const https = url.protocol === "https:";
    const anfrage = (https ? httpsAnfrage : httpAnfrage)(
      {
        host: ip,
        port: url.port ? Number(url.port) : https ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        agent: false,
        headers: { host: url.host, accept: "text/html,text/plain;q=0.9", "accept-language": "de,en;q=0.8", "user-agent": "Carraway-Abruf", connection: "close" },
        ...(https ? { servername: url.hostname } : {}),
        signal,
      },
      (antwort: IncomingMessage) => {
        const kopf: Record<string, string | undefined> = {};
        for (const [name, wert] of Object.entries(antwort.headers)) kopf[name] = Array.isArray(wert) ? wert[0] : wert;
        aufloesen({ status: antwort.statusCode ?? 0, kopf, rumpf: antwort, abbrechen: () => antwort.destroy() });
      },
    );
    anfrage.on("error", ablehnen);
    anfrage.end();
  });

export interface AbrufOptionen {
  aufloeser?: Aufloeser;
  transport?: Transport;
  grenzen?: Partial<AbrufGrenzen>;
}

export interface AbrufErgebnis {
  /** Endgültige Adresse nach Weiterleitungen. */
  url: string;
  /** Inhaltstyp ohne Parameter, klein geschrieben. */
  typ: string;
  text: string;
  /** Die Seite war größer als `maxBytes`; gelesen sind nur die ersten Bytes. */
  gekuerzt: boolean;
}

const TEXTTYPEN = /^(text\/html|text\/plain|application\/xhtml\+xml)$/;

/** Prüft eine Adresse und löst den Host einmal auf; gibt die URL und die zu verwendende Adresse zurück. */
export async function pruefeAbrufZiel(roh: string, aufloeser: Aufloeser = standardAufloeser): Promise<{ url: URL; ip: string }> {
  let url: URL;
  try {
    url = new URL(roh);
  } catch {
    throw new AbrufFehler("ABRUF_ADRESSE_UNGUELTIG");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new AbrufFehler("ABRUF_ADRESSE_UNGUELTIG");
  if (url.username || url.password) throw new AbrufFehler("ABRUF_ADRESSE_UNGUELTIG");
  const standard = url.protocol === "https:" ? "443" : "80";
  if (url.port && url.port !== standard) throw new AbrufFehler("ABRUF_ZIEL_VERBOTEN");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || isIP(host) !== 0) throw new AbrufFehler("ABRUF_ZIEL_VERBOTEN"); // keine IP-Adressen als Host
  if (!/^[a-z0-9.-]{1,253}$/i.test(host)) throw new AbrufFehler("ABRUF_ADRESSE_UNGUELTIG");
  let adressen: string[];
  try {
    adressen = await aufloeser(host);
  } catch {
    throw new AbrufFehler("ABRUF_NICHT_AUFLOESBAR");
  }
  if (adressen.length === 0 || adressen.some(istPrivateAdresse)) throw new AbrufFehler("ABRUF_ZIEL_VERBOTEN");
  return { url, ip: adressen[0]! };
}

/** Liest höchstens `max` Bytes aus dem Rumpf und bricht danach ab; gibt zurück, ob mehr da war. */
async function leseBegrenzt(antwort: TransportAntwort, max: number): Promise<{ bytes: Buffer; gekuerzt: boolean }> {
  const stuecke: Buffer[] = [];
  let summe = 0;
  for await (const stueck of antwort.rumpf) {
    const rest = max - summe;
    if (stueck.byteLength > rest) {
      if (rest > 0) stuecke.push(Buffer.from(stueck.subarray(0, rest)));
      antwort.abbrechen();
      return { bytes: Buffer.concat(stuecke), gekuerzt: true };
    }
    stuecke.push(Buffer.from(stueck));
    summe += stueck.byteLength;
  }
  return { bytes: Buffer.concat(stuecke), gekuerzt: false };
}

/** Ruft eine öffentliche Seite ab (siehe Kopf der Datei). Wirft `AbrufFehler`; nie mit Inhalten oder Kopfzeilen in der Meldung. */
export async function holeOeffentlicheSeite(adresse: string, opt: AbrufOptionen = {}): Promise<AbrufErgebnis> {
  const grenzen = { ...STANDARD_GRENZEN, ...opt.grenzen };
  const transport = opt.transport ?? echterTransport;
  const signal = AbortSignal.timeout(grenzen.zeitlimitMs);
  const mitZeitlimit = <T>(p: Promise<T>): Promise<T> =>
    new Promise<T>((aufloesen, ablehnen) => {
      const ab = () => ablehnen(new AbrufFehler("ABRUF_ZEITLIMIT"));
      if (signal.aborted) return ab();
      signal.addEventListener("abort", ab, { once: true });
      p.then(aufloesen, ablehnen).finally(() => signal.removeEventListener("abort", ab));
    });

  let aktuell = adresse;
  for (let schritt = 0; schritt <= grenzen.maxWeiterleitungen; schritt++) {
    const { url, ip } = await mitZeitlimit(pruefeAbrufZiel(aktuell, opt.aufloeser));
    let antwort: TransportAntwort;
    try {
      antwort = await mitZeitlimit(transport({ url, ip, signal }));
    } catch (e) {
      if (e instanceof AbrufFehler) throw e;
      throw new AbrufFehler(signal.aborted ? "ABRUF_ZEITLIMIT" : "ABRUF_FEHLER");
    }
    if (antwort.status >= 300 && antwort.status < 400) {
      const ziel = antwort.kopf["location"];
      antwort.abbrechen();
      if (!ziel) throw new AbrufFehler("ABRUF_STATUS", antwort.status);
      try {
        aktuell = new URL(ziel, url).toString();
      } catch {
        throw new AbrufFehler("ABRUF_ADRESSE_UNGUELTIG");
      }
      continue; // das neue Ziel wird von vorn geprüft
    }
    if (antwort.status !== 200) {
      antwort.abbrechen();
      throw new AbrufFehler("ABRUF_STATUS", antwort.status);
    }
    const typ = (antwort.kopf["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (!TEXTTYPEN.test(typ)) {
      antwort.abbrechen();
      throw new AbrufFehler("ABRUF_KEIN_TEXT");
    }
    let gelesen: { bytes: Buffer; gekuerzt: boolean };
    try {
      gelesen = await mitZeitlimit(leseBegrenzt(antwort, grenzen.maxBytes));
    } catch (e) {
      antwort.abbrechen();
      if (e instanceof AbrufFehler) throw e;
      throw new AbrufFehler(signal.aborted ? "ABRUF_ZEITLIMIT" : "ABRUF_FEHLER");
    }
    return { url: url.toString(), typ, text: gelesen.bytes.toString("utf8"), gekuerzt: gelesen.gekuerzt };
  }
  throw new AbrufFehler("ABRUF_ZU_VIELE_WEITERLEITUNGEN");
}

const ENTITAETEN: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", ndash: "–", mdash: "—", copy: "©" };

function entschluessele(t: string): string {
  return t.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{1,10});/gi, (voll, e: string) => {
    if (e[0] === "#") {
      const n = e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isInteger(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    }
    return ENTITAETEN[e] ?? voll;
  });
}

/** Höchstzahl Zeichen des HTML, die überhaupt verarbeitet werden (schützt vor Eingaben, die darauf angelegt sind, die Verarbeitung zu verlangsamen). */
export const MAX_HTML_ZEICHEN = 100_000;
const MAX_TAG_ZEICHEN = 2000;
const UEBERSPRINGEN = new Set(["script", "style", "noscript", "template", "svg"]);
const BLOCK = new Set(["p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "br", "section", "article", "header", "footer"]);
const asciiKlein = (s: string) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

/** Wert eines Attributs im (kurzen, begrenzten) Text eines Tags. */
function attribut(tag: string, name: string): string | undefined {
  const k = asciiKlein(tag);
  let von = 0;
  for (;;) {
    const i = k.indexOf(name, von);
    if (i < 0) return undefined;
    von = i + name.length;
    if (i > 0 && !/\s/.test(k[i - 1]!)) continue;
    let j = von;
    while (j < tag.length && tag[j] === " ") j++;
    if (tag[j] !== "=") continue;
    j++;
    while (j < tag.length && tag[j] === " ") j++;
    const q = tag[j];
    if (q === '"' || q === "'") {
      const ende = tag.indexOf(q, j + 1);
      return ende < 0 ? undefined : tag.slice(j + 1, ende);
    }
    let ende = j;
    while (ende < tag.length && !/[\s>]/.test(tag[ende]!)) ende++;
    return tag.slice(j, ende);
  }
}

/**
 * Lesbarer Text einer Webseite: Titel und Beschreibung (meta), danach der sichtbare Text ohne Skripte, Stile und Kommentare, mit zusammengezogenem Leerraum; danach die Verweise auf
 * Profile von Unternehmen bei LinkedIn (Adressen aus den Links, damit sie zitierbar sind). Höchstens `max` Zeichen.
 *
 * Ein einziger linearer Durchlauf (`indexOf` ab der aktuellen Stelle, je öffnendem Tag höchstens eine Suche nach dem Ende, beim ersten Fehlschlag Abbruch), ohne Regulärausdrücke
 * über unbegrenzte Teile; das HTML wird vorher auf `MAX_HTML_ZEICHEN` gekürzt.
 */
export function textAusHtml(html: string, max = 20_000): string {
  const h = html.slice(0, MAX_HTML_ZEICHEN);
  const k = asciiKlein(h);
  let titel = "";
  let beschreibung = "";
  const linkedin: string[] = [];
  const stuecke: string[] = [];
  let pos = 0;
  while (pos < h.length) {
    const lt = h.indexOf("<", pos);
    if (lt < 0) {
      stuecke.push(h.slice(pos));
      break;
    }
    stuecke.push(h.slice(pos, lt));
    if (h.startsWith("<!--", lt)) {
      const e = h.indexOf("-->", lt + 4);
      if (e < 0) break;
      pos = e + 3;
      continue;
    }
    const gt = h.indexOf(">", lt + 1);
    if (gt < 0) break; // ein Tag ohne Ende: der Rest zählt nicht
    const tag = h.slice(lt + 1, Math.min(gt, lt + 1 + MAX_TAG_ZEICHEN));
    const m = /^(\/?)([a-zA-Z][a-zA-Z0-9]*)/.exec(tag);
    pos = gt + 1;
    if (!m) continue;
    const name = m[2]!.toLowerCase();
    if (m[1] === "/") {
      if (BLOCK.has(name)) stuecke.push("\n");
      continue;
    }
    if (UEBERSPRINGEN.has(name)) {
      const e = k.indexOf(`</${name}`, pos);
      if (e < 0) break;
      const ende = h.indexOf(">", e);
      if (ende < 0) break;
      pos = ende + 1;
      continue;
    }
    if (name === "title" && titel === "") {
      const e = k.indexOf("</title", pos);
      if (e >= 0) {
        titel = h.slice(pos, Math.min(e, pos + 500));
        pos = e;
      }
    } else if (name === "meta" && asciiKlein(attribut(tag, "name") ?? "") === "description" && beschreibung === "") {
      beschreibung = attribut(tag, "content") ?? "";
    } else if (name === "a" && linkedin.length < 3) {
      const href = attribut(tag, "href");
      const u = href ? /^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|school)\/[^\s?#<>"']{1,100}/i.exec(href) : null;
      if (u) linkedin.push(u[0]);
    }
    if (BLOCK.has(name)) stuecke.push("\n");
  }
  const teile = [titel ? `Titel: ${entschluessele(titel)}` : "", beschreibung ? `Beschreibung: ${entschluessele(beschreibung)}` : "", entschluessele(stuecke.join(" "))]
    .join("\n")
    .split("\n")
    .map((z) => z.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const profile = [...new Set(linkedin)].map((u) => `LinkedIn: ${u}`).join("\n").slice(0, 600);
  return [teile.join("\n").slice(0, Math.max(0, max - profile.length - 1)), profile].filter(Boolean).join("\n");
}
