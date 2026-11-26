import { isIP } from "node:net";
import { istPrivateAdresse, standardAufloeser, type Aufloeser } from "../postfach/ziel";

/**
 * Prüfung der Ziele von Webhooks (Schutz vor Server-Side Request Forgery). Der Server sendet an eine Adresse, die eine Person oder ein
 * API-Schlüssel eingibt; deshalb gilt:
 *
 * - Nur `https`, keine Zugangsdaten in der Adresse, kein Fragment, keine IP-Adresse als Host (nur Namen), Port 443 oder 1024 bis 65535.
 * - Der Name wird bei jedem Versuch genau einmal aufgelöst; liegt auch nur eine Adresse in einem Sonderbereich (lokal, privat, Link-Local wie
 *   `169.254.169.254`, gemeinsam genutzt, reserviert, eingebettetes IPv4 in IPv6; Regeln in `postfach/ziel.ts`), ist das Ziel verboten.
 *   Verbunden wird mit genau der geprüften Adresse (`zustellung.ts`), damit eine zweite DNS-Antwort keine Wirkung hat (DNS-Rebinding).
 * - Weiterleitungen folgt die Zustellung nicht; eine Antwort 3xx gilt als Fehlschlag. So kann kein Ziel auf eine interne Adresse umlenken.
 *
 * `WEBHOOK_PRIVATE_ZIELE=1` hebt nur die Prüfung der Adressbereiche auf (Selbsthoster mit internen Empfängern); `https` bleibt Pflicht.
 */

export type ZielFehlerCode = "webhook_url_invalid" | "webhook_target_forbidden" | "webhook_target_unresolvable";

export class ZielFehler extends Error {
  constructor(readonly code: ZielFehlerCode) {
    super(code);
  }
}

export interface ZielOptionen {
  aufloeser?: Aufloeser;
  privateErlaubt?: boolean;
}

export const privateZieleErlaubt = (env: Record<string, string | undefined> = process.env) => ["1", "true", "ja"].includes((env.WEBHOOK_PRIVATE_ZIELE ?? "0").toLowerCase());

/** Prüft nur die Form der Adresse (ohne DNS) und gibt sie normalisiert zurück. */
export function pruefeWebhookAdresse(roh: string): URL {
  let url: URL;
  try {
    url = new URL(roh);
  } catch {
    throw new ZielFehler("webhook_url_invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new ZielFehler("webhook_url_invalid");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || isIP(host) !== 0) throw new ZielFehler("webhook_target_forbidden");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new ZielFehler("webhook_target_forbidden");
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(host)) throw new ZielFehler("webhook_url_invalid");
  if (url.port) {
    const port = Number(url.port);
    if (port !== 443 && (port < 1024 || port > 65535)) throw new ZielFehler("webhook_target_forbidden");
  }
  return url;
}

/** Prüft Adresse und Auflösung; gibt die URL und die Adresse zurück, mit der verbunden werden muss. */
export async function pruefeWebhookZiel(roh: string, opt: ZielOptionen = {}): Promise<{ url: URL; ip: string }> {
  const url = pruefeWebhookAdresse(roh);
  let adressen: string[];
  try {
    adressen = await (opt.aufloeser ?? standardAufloeser)(url.hostname);
  } catch {
    throw new ZielFehler("webhook_target_unresolvable");
  }
  if (adressen.length === 0) throw new ZielFehler("webhook_target_unresolvable");
  if (!opt.privateErlaubt && adressen.some(istPrivateAdresse)) throw new ZielFehler("webhook_target_forbidden");
  return { url, ip: adressen[0]! };
}
