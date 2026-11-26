import nodemailer from "nodemailer";
import type { MailKonfiguration } from "./konfiguration";

/**
 * Versand über einen austauschbaren `Mailer`. Der SMTP-Adapter nutzt nodemailer; Tests und die Demo-Umgebung ohne SMTP nutzen den `FakeMailer`.
 * Es gibt kein Öffnungs- und Klick-Tracking: keine Bilder, keine Weiterleitungslinks, keine Lesebestätigungen.
 */

export interface Nachricht {
  an: string;
  betreff: string;
  text: string;
  html: string;
}

/** Ein Versandfehler; `dauerhaft` (Adresse abgelehnt, Konfiguration falsch) wird nicht wiederholt. Die Meldung enthält nie den Inhalt. */
export class MailFehler extends Error {
  constructor(
    readonly code: string,
    readonly dauerhaft: boolean,
  ) {
    super(code);
  }
}

export interface Mailer {
  senden(nachricht: Nachricht): Promise<void>;
}

export class SmtpMailer implements Mailer {
  readonly #transport;
  readonly #von: string;

  constructor(k: MailKonfiguration) {
    this.#von = k.absender;
    this.#transport = nodemailer.createTransport({
      host: k.host,
      port: k.port,
      secure: k.tls === "tls",
      requireTLS: k.tls === "starttls",
      ignoreTLS: k.tls === "keine",
      auth: k.benutzer ? { user: k.benutzer, pass: k.passwort } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }

  async senden(n: Nachricht): Promise<void> {
    try {
      await this.#transport.sendMail({ from: this.#von, to: n.an, subject: n.betreff, text: n.text, html: n.html, headers: { "Auto-Submitted": "auto-generated" } });
    } catch (fehler) {
      const antwortCode = (fehler as { responseCode?: number }).responseCode;
      const code = (fehler as { code?: string }).code;
      // 5xx: der Server lehnt die Nachricht oder Adresse endgültig ab; Anmeldefehler (EAUTH) heilt ein Wiederholen nicht.
      const dauerhaft = (typeof antwortCode === "number" && antwortCode >= 500 && antwortCode < 600) || code === "EAUTH" || code === "EENVELOPE";
      throw new MailFehler(typeof code === "string" ? `SMTP_${code}` : antwortCode ? `SMTP_${antwortCode}` : "SMTP_FEHLER", dauerhaft);
    }
  }
}

/** Sammelt Nachrichten statt zu senden (Tests, Demo ohne SMTP); `fehler` reiht Fehler für die nächsten Aufrufe ein. */
export class FakeMailer implements Mailer {
  readonly gesendet: Nachricht[] = [];
  readonly fehler: MailFehler[] = [];
  async senden(n: Nachricht): Promise<void> {
    const f = this.fehler.shift();
    if (f) throw f;
    this.gesendet.push(n);
  }
}
