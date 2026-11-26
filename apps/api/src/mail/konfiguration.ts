import { readFileSync } from "node:fs";

/**
 * Ausgehende Mail je Installation (Etappe 17): ein SMTP-Zugang aus der Umgebung. Ohne `SMTP_HOST` ist der Versand aus; die Routen, die
 * Mails auslösen, antworten dann 409 `MAIL_NICHT_EINGERICHTET`. Das Passwort steht nur in der Umgebung oder in einer Datei
 * (`SMTP_PASSWORT_DATEI`, z. B. ein Docker-Secret) und erscheint nie in der API, im Protokoll oder in Logs.
 */

export const TLS_ARTEN = ["starttls", "tls", "keine"] as const;
export type TlsArt = (typeof TLS_ARTEN)[number];

export interface MailKonfiguration {
  host: string;
  port: number;
  /** `starttls` (Standard, Port 587), `tls` (von Anfang an, Port 465) oder `keine` (nur Demo und Entwicklung, im Echtbestand verboten). */
  tls: TlsArt;
  benutzer?: string;
  passwort?: string;
  /** Absenderadresse (`Von`), z. B. `carraway@fonds.example.org`. */
  absender: string;
  /** Höchstens so viele gesendete Mails je Stunde und Installation. */
  limitProStunde: number;
}

export class MailKonfigurationsFehler extends Error {}

type Umgebungsvariablen = Record<string, string | undefined>;

export const ADRESSE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

export function ladeMailKonfiguration(env: Umgebungsvariablen, umgebung: string): MailKonfiguration | undefined {
  const host = env.SMTP_HOST?.trim();
  if (!host) return undefined;
  const port = Number(env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new MailKonfigurationsFehler("SMTP_PORT ungültig.");
  const tls = (env.SMTP_TLS?.trim() || "starttls") as TlsArt;
  if (!TLS_ARTEN.includes(tls)) throw new MailKonfigurationsFehler(`SMTP_TLS "${tls}" ungültig (${TLS_ARTEN.join(", ")}).`);
  if (tls === "keine" && umgebung === "echt") throw new MailKonfigurationsFehler("SMTP_TLS=keine ist im Echtbestand nicht erlaubt.");
  const absender = env.SMTP_ABSENDER?.trim();
  if (!absender || !ADRESSE.test(absender)) throw new MailKonfigurationsFehler("SMTP_ABSENDER fehlt oder ist keine Mailadresse.");
  const benutzer = env.SMTP_BENUTZER?.trim() || undefined;
  let passwort = env.SMTP_PASSWORT || undefined;
  const datei = env.SMTP_PASSWORT_DATEI?.trim();
  if (datei) {
    try {
      passwort = readFileSync(datei, "utf8").replace(/\r?\n$/, "");
    } catch {
      throw new MailKonfigurationsFehler("SMTP_PASSWORT_DATEI ist nicht lesbar.");
    }
  }
  if (benutzer && !passwort) throw new MailKonfigurationsFehler("SMTP_BENUTZER ist gesetzt, aber SMTP_PASSWORT oder SMTP_PASSWORT_DATEI fehlt.");
  const limit = Number(env.MAIL_LIMIT_PRO_STUNDE || 200);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100_000) throw new MailKonfigurationsFehler("MAIL_LIMIT_PRO_STUNDE ungültig.");
  return { host, port, tls, benutzer, passwort, absender, limitProStunde: limit };
}

/** Öffentliche Sicht für die Verwaltung: ohne Benutzer und Passwort. */
export function mailStatus(k: MailKonfiguration | undefined) {
  if (!k) return { konfiguriert: false as const };
  return { konfiguriert: true as const, host: k.host, port: k.port, tls: k.tls, absender: k.absender, mitAnmeldung: Boolean(k.benutzer), limitProStunde: k.limitProStunde };
}
