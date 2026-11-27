import { createServer, type Server } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MailFehler, SmtpMailer } from "../mail/mailer";

/**
 * Der echte SMTP-Adapter (nodemailer) gegen einen kleinen SMTP-Server im Testprozess auf 127.0.0.1 (Port 0, nur für diesen Test, ohne Anmeldung und ohne TLS):
 * Zustellung, Köpfe ohne Tracking, abgelehnte Adresse als endgültiger Fehler, nicht erreichbarer Server als vorübergehender Fehler.
 */

interface Empfangen {
  von: string;
  an: string[];
  daten: string;
}
const empfangen: Empfangen[] = [];
let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((socket) => {
    socket.setEncoding("utf8");
    let puffer = "";
    let inDaten = false;
    let aktuell: Empfangen = { von: "", an: [], daten: "" };
    const sende = (zeile: string) => socket.write(`${zeile}\r\n`);
    sende("220 localhost ESMTP Test");
    socket.on("data", (stueck: string) => {
      puffer += stueck;
      for (;;) {
        if (inDaten) {
          const ende = puffer.indexOf("\r\n.\r\n");
          if (ende < 0) return;
          aktuell.daten = puffer.slice(0, ende);
          puffer = puffer.slice(ende + 5);
          inDaten = false;
          empfangen.push(aktuell);
          aktuell = { von: "", an: [], daten: "" };
          sende("250 OK gespeichert");
          continue;
        }
        const i = puffer.indexOf("\r\n");
        if (i < 0) return;
        const zeile = puffer.slice(0, i);
        puffer = puffer.slice(i + 2);
        if (/^EHLO|^HELO/i.test(zeile)) sende("250-localhost\r\n250 8BITMIME");
        else if (/^MAIL FROM:/i.test(zeile)) {
          aktuell.von = /<(.*)>/.exec(zeile)?.[1] ?? "";
          sende("250 OK");
        } else if (/^RCPT TO:/i.test(zeile)) {
          const an = /<(.*)>/.exec(zeile)?.[1] ?? "";
          if (an.startsWith("abgelehnt@")) sende("550 5.1.1 Empfaenger unbekannt");
          else {
            aktuell.an.push(an);
            sende("250 OK");
          }
        } else if (/^DATA/i.test(zeile)) {
          inDaten = true;
          sende("354 Ende mit Punkt");
        } else if (/^QUIT/i.test(zeile)) {
          sende("221 Tschuess");
          socket.end();
        } else sende("250 OK");
      }
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  port = (server.address() as { port: number }).port;
});
afterAll(async () => {
  await new Promise((ok) => server.close(ok));
});

const mailer = (p = port) => new SmtpMailer({ host: "127.0.0.1", port: p, tls: "keine", absender: "carraway@example.org", limitProStunde: 100 });
const nachricht = (an: string) => ({ an, betreff: "Kennzahlen-Abfrage: Alpha", text: "Hallo\nLink: https://fonds.example.org/external/requests/abc", html: '<p>Hallo</p><p><a href="https://fonds.example.org/external/requests/abc">Zum Formular</a></p>' });

describe("SMTP-Adapter", () => {
  it("stellt Text und HTML zu, ohne Tracking-Köpfe, mit Absender aus der Konfiguration", async () => {
    await mailer().senden(nachricht("anna@alpha.example.com"));
    expect(empfangen).toHaveLength(1);
    const m = empfangen[0]!;
    expect(m.von).toBe("carraway@example.org");
    expect(m.an).toEqual(["anna@alpha.example.com"]);
    expect(m.daten).toMatch(/^Subject: Kennzahlen-Abfrage: Alpha$/m);
    expect(m.daten).toMatch(/^Auto-Submitted: auto-generated$/m);
    expect(m.daten).toMatch(/Content-Type: multipart\/alternative/);
    expect(m.daten).toContain("https://fonds.example.org/external/requests/abc");
    expect(m.daten).not.toMatch(/Disposition-Notification-To|Return-Receipt-To|X-Confirm-Reading-To|<img|List-Unsubscribe/i);
  });

  it("eine abgelehnte Adresse (5xx) ist ein endgültiger Fehler, die Meldung enthält weder Adresse noch Serverantwort", async () => {
    const fehler = (await mailer().senden(nachricht("abgelehnt@alpha.example.com")).catch((e: unknown) => e)) as MailFehler;
    expect(fehler).toBeInstanceOf(MailFehler);
    expect(fehler.dauerhaft).toBe(true);
    expect(fehler.code).toMatch(/^SMTP_/);
    expect(fehler.message).not.toContain("abgelehnt@");
    expect(fehler.message).not.toContain("Empfaenger");
  });

  it("ein nicht erreichbarer Server ist ein vorübergehender Fehler", async () => {
    const frei = createServer();
    await new Promise<void>((ok) => frei.listen(0, "127.0.0.1", ok));
    const toterPort = (frei.address() as { port: number }).port;
    await new Promise((ok) => frei.close(ok));
    const fehler = (await mailer(toterPort).senden(nachricht("anna@alpha.example.com")).catch((e: unknown) => e)) as MailFehler;
    expect(fehler).toBeInstanceOf(MailFehler);
    expect(fehler.dauerhaft).toBe(false);
    expect(fehler.code).toMatch(/^SMTP_/);
  });
});
