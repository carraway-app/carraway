import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { request as httpsAnfrage } from "node:https";
import type { IncomingMessage } from "node:http";

/**
 * Signatur und Versand einer Webhook-Nachricht.
 *
 * Signatur: `Carraway-Signature: t=<Unix-Sekunden>,v1=<hex(HMAC-SHA256(geheimnis, "<t>.<Rumpf>"))>`. Der Empfänger rechnet die Signatur mit dem
 * Geheimnis des Endpunkts nach (Vergleich in konstanter Zeit) und verwirft Nachrichten, deren Zeitstempel mehr als fünf Minuten abweicht
 * (Schutz gegen Wiederholung); `Carraway-Event-Id` ist für die Erkennung von Doppelten gedacht (eine Zustellung kann wiederholt ankommen).
 */

export const SIGNATUR_KOPF = "carraway-signature";
/** Höchste Abweichung des Zeitstempels, die `pruefeSignatur` annimmt (Sekunden). */
export const TOLERANZ_SEKUNDEN = 300;
export const GEHEIMNIS_PRAEFIX = "whsec_";

/** Neues Geheimnis mit 256 Bit Zufall; es wird nur einmal angezeigt und nur verschlüsselt gespeichert. */
export const erzeugeGeheimnis = () => `${GEHEIMNIS_PRAEFIX}${randomBytes(32).toString("base64url")}`;

export function signiere(geheimnis: string, zeitstempel: number, rumpf: string): string {
  const v1 = createHmac("sha256", geheimnis).update(`${zeitstempel}.${rumpf}`).digest("hex");
  return `t=${zeitstempel},v1=${v1}`;
}

/**
 * Prüft eine Signatur wie ein Empfänger (für Tests und als Vorlage in der Dokumentation). `false` bei falscher Signatur, fehlenden Teilen oder
 * einem Zeitstempel außerhalb der Toleranz.
 */
export function pruefeSignatur(geheimnis: string, kopf: string, rumpf: string, jetzt = Math.floor(Date.now() / 1000), toleranz = TOLERANZ_SEKUNDEN): boolean {
  const teile = new Map(kopf.split(",").map((t) => t.trim().split("=", 2) as [string, string]));
  const t = Number(teile.get("t"));
  const v1 = teile.get("v1");
  if (!Number.isInteger(t) || !v1 || !/^[0-9a-f]{64}$/.test(v1)) return false;
  if (Math.abs(jetzt - t) > toleranz) return false;
  const erwartet = Buffer.from(createHmac("sha256", geheimnis).update(`${t}.${rumpf}`).digest("hex"), "utf8");
  return timingSafeEqual(erwartet, Buffer.from(v1, "utf8"));
}

export interface SendeAnfrage {
  url: URL;
  /** Geprüfte Adresse, mit der verbunden wird; `url.hostname` bleibt Host-Kopfzeile und TLS-Servername. */
  ip: string;
  kopf: Record<string, string>;
  rumpf: string;
  zeitlimitMs: number;
}
/** Ergebnis eines Versuchs: nur der HTTP-Status, nie Antwortkopf oder -text. */
export type Sender = (a: SendeAnfrage) => Promise<{ status: number }>;

/** Höchstens so viele Bytes der Antwort werden gelesen (und verworfen), damit die Verbindung sauber endet. */
const MAX_ANTWORT_BYTES = 64 * 1024;

/** Echter Versand über `node:https`: verbindet mit der geprüften Adresse, ohne Agent, Cookies oder Weiterleitungen, mit Zeitlimit. */
export const echterSender: Sender = ({ url, ip, kopf, rumpf, zeitlimitMs }) =>
  new Promise((aufloesen, ablehnen) => {
    const signal = AbortSignal.timeout(zeitlimitMs);
    const anfrage = httpsAnfrage(
      {
        host: ip,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        agent: false,
        servername: url.hostname,
        headers: { ...kopf, host: url.host, "content-length": String(Buffer.byteLength(rumpf)), connection: "close" },
        signal,
      },
      (antwort: IncomingMessage) => {
        let gelesen = 0;
        antwort.on("data", (stueck: Buffer) => {
          gelesen += stueck.byteLength;
          if (gelesen > MAX_ANTWORT_BYTES) antwort.destroy();
        });
        antwort.on("close", () => aufloesen({ status: antwort.statusCode ?? 0 }));
        antwort.on("error", () => aufloesen({ status: antwort.statusCode ?? 0 }));
      },
    );
    anfrage.on("error", ablehnen);
    anfrage.end(rumpf);
  });
