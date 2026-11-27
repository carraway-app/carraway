import { describe, expect, it } from "vitest";
import { rendereVorlage, VORLAGEN, type Vorlage, type VorlagenParameter } from "../mail/vorlagen";
import { ladeMailKonfiguration, mailStatus } from "../mail/konfiguration";

/** Mailvorlagen in beiden Sprachen: Link vorhanden, nichts Externes, nichts Verfolgendes, Werte maskiert. Alle Daten sind erfunden. */

const LINK = "https://fonds.example.org/external/requests/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";

const parameter: { [V in Vorlage]: VorlagenParameter[V] } = {
  testmail: {},
  kennzahl_abfrage: { unternehmen: "Alpha Beispiel GmbH", periodeBeginn: "2026-07-01", periodeEnde: "2026-09-30", faelligAm: "2026-10-15", link: LINK, hinweis: "Bitte bis Mitte des Monats" },
  esg_abfrage: { unternehmen: "Alpha Beispiel GmbH", jahr: "2025", faelligAm: "2026-10-15", link: LINK, hinweis: "Bitte bis Mitte des Monats" },
  lp_mitteilung: { fonds: "Beispielfonds Eins", art: "abruf", link: "https://fonds.example.org/portal" },
  bericht_freigegeben: { bericht: "quartalsbericht", fonds: "Beispielfonds Eins", link: "https://fonds.example.org/reports/123" },
  register_ereignis: { unternehmen: "Alpha Beispiel GmbH", art: "insolvenz", link: "https://fonds.example.org/organizations/123" },
  passwort_zuruecksetzen: { link: "https://fonds.example.org/set-password#token=AbCdEfGhIjKlMnOpQrStUvWx", gueltigMinuten: 30 },
  einladung: { name: "Anna Alpha", link: "https://fonds.example.org/set-password#token=AbCdEfGhIjKlMnOpQrStUvWx", gueltigStunden: 72 },
};

describe("Vorlagen", () => {
  for (const sprache of ["de", "en"] as const) {
    for (const vorlage of VORLAGEN) {
      it(`${vorlage} (${sprache}) hat Betreff, Text und HTML ohne Bilder, Skripte oder Verfolgung`, () => {
        const m = rendereVorlage(vorlage, sprache, parameter[vorlage] as never);
        expect(m.betreff.length).toBeGreaterThan(5);
        expect(m.betreff).not.toMatch(/[\r\n]/);
        expect(m.text.length).toBeGreaterThan(20);
        expect(m.html).toContain("<html");
        // keine externen Dateien, kein Pixel, keine Skripte, keine Weiterleitungsadresse eines Dienstes
        expect(m.html).not.toMatch(/<img|<script|<iframe|<link|<style|@import|url\(|background=/i);
        expect(m.text + m.html).not.toMatch(/utm_|track|pixel|beacon|click\./i);
        // jede Adresse im HTML ist ein sichtbarer Link auf genau die übergebene Adresse
        const hrefs = [...m.html.matchAll(/href="([^"]*)"/g)].map((x) => x[1]);
        for (const h of hrefs) expect(h).toBe((parameter[vorlage] as { link: string }).link);
      });
    }
  }

  it("Kennzahlen-Abfrage enthält den Link in Text und HTML sowie Zeitraum und Frist im Format der Sprache", () => {
    const de = rendereVorlage("kennzahl_abfrage", "de", parameter.kennzahl_abfrage);
    expect(de.text).toContain(LINK);
    expect(de.html).toContain(`href="${LINK}"`);
    expect(de.text).toContain("01.07.2026 bis 30.09.2026");
    expect(de.text).toContain("15.10.2026");
    const en = rendereVorlage("kennzahl_abfrage", "en", parameter.kennzahl_abfrage);
    expect(en.text).toContain(LINK);
    expect(en.text).toContain("01/07/2026 to 30/09/2026");
    expect(en.betreff).toBe("Request for key figures: Alpha Beispiel GmbH");
  });

  it("LP-Mitteilung nennt weder Beträge noch Dokument, nur den Hinweis und den Link zum Portal", () => {
    for (const sprache of ["de", "en"] as const) {
      const m = rendereVorlage("lp_mitteilung", sprache, parameter.lp_mitteilung);
      expect(m.text).toContain("https://fonds.example.org/portal");
      expect(m.text).not.toMatch(/\d+[.,]\d{2}\s?(€|EUR)/);
      expect(m.text).toMatch(sprache === "de" ? /weder Beträge noch das Dokument/ : /neither amounts nor the document/);
    }
  });

  it("maskiert Werte im HTML und entfernt Zeilenumbrüche aus dem Betreff", () => {
    const m = rendereVorlage("kennzahl_abfrage", "de", { ...parameter.kennzahl_abfrage, unternehmen: 'Evil <b>"Firma"</b>\r\nBcc: x@example.org', hinweis: "<script>alert(1)</script>" });
    expect(m.html).not.toContain("<b>");
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.betreff).not.toMatch(/[\r\n]/);
  });

  it("Berichtsart erscheint mit Anzeigenamen in der Sprache des Empfängers", () => {
    expect(rendereVorlage("bericht_freigegeben", "de", parameter.bericht_freigegeben).betreff).toBe("Bericht freigegeben: Quartalsbericht");
    expect(rendereVorlage("bericht_freigegeben", "en", parameter.bericht_freigegeben).betreff).toBe("Report released: Quarterly report");
  });
});

describe("SMTP-Konfiguration", () => {
  const basis = { SMTP_HOST: "smtp.example.org", SMTP_ABSENDER: "carraway@example.org" };

  it("ist ohne SMTP_HOST aus", () => {
    expect(ladeMailKonfiguration({}, "demo")).toBeUndefined();
    expect(mailStatus(undefined)).toEqual({ konfiguriert: false });
  });

  it("liest Zugang aus der Umgebung, das Passwort nie in die Statusansicht", () => {
    const k = ladeMailKonfiguration({ ...basis, SMTP_BENUTZER: "robot", SMTP_PASSWORT: "geheim", SMTP_PORT: "465", SMTP_TLS: "tls" }, "echt")!;
    expect(k).toMatchObject({ host: "smtp.example.org", port: 465, tls: "tls", benutzer: "robot", limitProStunde: 200 });
    const status = mailStatus(k);
    expect(JSON.stringify(status)).not.toContain("geheim");
    expect(JSON.stringify(status)).not.toContain("robot");
    expect(status).toMatchObject({ konfiguriert: true, mitAnmeldung: true });
  });

  it("lehnt Unsinn ab: ohne Absender, Benutzer ohne Passwort, TLS aus im Echtbestand", () => {
    expect(() => ladeMailKonfiguration({ SMTP_HOST: "smtp.example.org" }, "demo")).toThrow(/SMTP_ABSENDER/);
    expect(() => ladeMailKonfiguration({ ...basis, SMTP_BENUTZER: "robot" }, "demo")).toThrow(/SMTP_PASSWORT/);
    expect(() => ladeMailKonfiguration({ ...basis, SMTP_TLS: "keine" }, "echt")).toThrow(/Echtbestand/);
    expect(ladeMailKonfiguration({ ...basis, SMTP_TLS: "keine" }, "demo")!.tls).toBe("keine");
    expect(() => ladeMailKonfiguration({ ...basis, SMTP_PORT: "0" }, "demo")).toThrow(/SMTP_PORT/);
  });
});
