import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { de } from "./de";
import { en } from "./en";
import { kernDe } from "./kern.de";
import { kernEn } from "./kern.en";
import { ABSCHNITTE, BEREICH_LADER, BEREICHE, bereicheFuerPfad, bereichVonAbschnitt } from "./bereiche";
import { ladeSeitentexte, ladeTexte, nachgeladen, registriereTexte, setzeTexteZurueck, tabelleFuer } from "./index";

/**
 * Wörterbücher je Bereich: Rahmen und Bereiche zusammen ergeben genau die vollständigen Wörterbücher, die Seiten bekommen ihre Bereiche vor dem
 * Zeichnen, und ein noch nicht geladener Bereich hält die Darstellung an, statt Schlüssel zu zeigen. Dass keine Seite einen Bereich erst beim Zeichnen
 * nachlädt, prüft der ganze Testlauf mit `TEXTE_LAZY=1` (siehe `test/setup.ts`).
 */

afterEach(() => {
  // Die anderen Tests erwarten die vollständigen Wörterbücher.
  setzeTexteZurueck();
  registriereTexte("de", de);
  registriereTexte("en", en);
});

describe("Aufteilung", () => {
  it("Rahmen und Bereiche ergeben genau die Abschnitte des vollständigen Wörterbuchs, kein Abschnitt steht in zwei Teilen", () => {
    for (const [name, voll, kern] of [["de", de, kernDe], ["en", en, kernEn]] as const) {
      const bereichsAbschnitte = BEREICHE.flatMap((b) => ABSCHNITTE[b]);
      expect(new Set(bereichsAbschnitte).size, `${name}: doppelter Abschnitt in den Bereichen`).toBe(bereichsAbschnitte.length);
      const imKern = Object.keys(kern);
      expect(imKern.filter((k) => bereichsAbschnitte.includes(k)), `${name}: Abschnitt im Rahmen und im Bereich`).toEqual([]);
      expect([...imKern, ...bereichsAbschnitte].sort(), name).toEqual(Object.keys(voll).sort());
    }
  });

  it("jeder Bereich liefert in beiden Sprachen genau seine Abschnitte; die Fehlertexte ergänzen den Rahmen zum vollständigen `fehler`", async () => {
    for (const sprache of ["de", "en"] as const) {
      const fehler: Record<string, string> = { ...(sprache === "de" ? kernDe : kernEn).fehler };
      for (const b of BEREICHE) {
        const paket = await BEREICH_LADER[b][sprache]();
        expect(Object.keys(paket.abschnitte).sort(), `${sprache} ${b}`).toEqual([...ABSCHNITTE[b]].sort());
        Object.assign(fehler, paket.fehler);
      }
      const voll = (sprache === "de" ? de : en).fehler as Record<string, string>;
      expect(Object.keys(fehler).sort()).toEqual(Object.keys(voll).sort());
      for (const [code, text] of Object.entries(voll)) expect(fehler[code], `${sprache} ${code}`).toBe(text);
    }
  });
});

describe("Laden mit der Seite", () => {
  it("lädt den Rahmen sofort, einen Bereich erst mit der Adresse, die ihn braucht, samt seinen Fehlertexten", async () => {
    setzeTexteZurueck();
    const t = await ladeTexte("de");
    expect(t.nav.beschriftung).toBe(de.nav.beschriftung);
    expect("buchhaltung" in t).toBe(false);
    expect(t.fehler.voucher_not_found).toBeUndefined();
    await ladeSeitentexte("/vouchers");
    expect(t.buchhaltung.nav.belege).toBe(de.buchhaltung.nav.belege);
    expect(t.fehler.voucher_not_found).toBe(de.fehler.voucher_not_found);
    // allgemeine Fehlertexte kommen mit jeder Seite nach der Anmeldung
    expect(t.fehler.fund_not_found).toBe(de.fehler.fund_not_found);
    expect("mail" in t).toBe(false);
  });

  it("nach der Anmeldung ist jeder Fehlercode der API übersetzt, auch wenn die Seite keinen Bereich des Codes geladen hat", async () => {
    const quelle = readFileSync(resolve(process.cwd(), "../api/src/fehler.ts"), "utf8");
    const codes = [...(/export type Fehlercode =([\s\S]*?);/.exec(quelle)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    expect(codes.length).toBeGreaterThan(200);
    for (const sprache of ["de", "en"] as const) {
      setzeTexteZurueck();
      // eine Seite ohne Bereiche: dealflow; die Codes der Buchhaltung, des Registers, der Mail, der Dokumente und der Szenarien müssen trotzdem da sein
      await ladeSeitentexte("/dealflow", sprache);
      const t = tabelleFuer(sprache);
      expect(codes.filter((c) => !Object.hasOwn(t.fehler, c)), sprache).toEqual([]);
      expect(Object.keys(t).filter((k) => k === "buchhaltung" || k === "mail")).toEqual([]);
    }
  });

  it("die Seiten vor der Anmeldung laden nur den Rahmen", async () => {
    setzeTexteZurueck();
    await ladeSeitentexte("/sign-in");
    const t = tabelleFuer("de");
    expect(t.anmeldung.titel).toBe(de.anmeldung.titel);
    expect(t.fehler.INVALID_EMAIL_OR_PASSWORD).toBe(de.fehler.INVALID_EMAIL_OR_PASSWORD);
    expect(t.fehler.fund_not_found).toBeUndefined();
    // Außer dem Rahmen kommt nur der kleine Bereich „konto“ (Anmeldung, Passwort, zweiter Faktor), nie die Fehlertexte der übrigen Seiten.
    expect(bereicheFuerPfad("/sign-in")).toEqual(["konto"]);
    expect(bereicheFuerPfad("/set-password")).toEqual(["konto"]);
  });

  it("ein nicht geladener Bereich hält die Darstellung an, lädt nach und liefert danach die Texte", async () => {
    setzeTexteZurueck();
    const t = await ladeTexte("en");
    let gehalten: unknown;
    try {
      void t.mail;
    } catch (wurf) {
      gehalten = wurf;
    }
    expect(gehalten).toBeInstanceOf(Promise);
    expect(nachgeladen).toEqual(["mail"]);
    await gehalten;
    expect(t.mail.menue.einstellungen).toBe(en.mail.menue.einstellungen);
    nachgeladen.length = 0;
  });

  it("beim Umschalten der Sprache kommen die schon gebrauchten Bereiche in der neuen Sprache mit", async () => {
    setzeTexteZurueck();
    await ladeSeitentexte("/vouchers", "de");
    const englisch = await ladeTexte("en");
    expect(englisch.buchhaltung.nav.belege).toBe(en.buchhaltung.nav.belege);
  });

  it("jeder Abschnitt gehört zu höchstens einem Bereich", () => {
    for (const b of BEREICHE) for (const a of ABSCHNITTE[b]) expect(bereichVonAbschnitt(a)).toBe(b);
    expect(bereichVonAbschnitt("nav")).toBeNull();
  });
});

describe("Adressen und Bereiche", () => {
  it("ordnet die Seiten ihren Bereichen zu; unbekannte Adressen brauchen nur die allgemeinen Fehlertexte", () => {
    expect(bereicheFuerPfad("/reports")).toEqual(["berichte", "stamm", "fehlertexte"]);
    expect(bereicheFuerPfad("/reports/templates")).toEqual(["berichte", "kennzahlen", "stamm", "fehlertexte"]);
    expect(bereicheFuerPfad("/reports/abc")).toEqual(["berichte", "stamm", "fehlertexte"]);
    expect(bereicheFuerPfad("/funds/abc")).toContain("kennzahlen");
    expect(bereicheFuerPfad("/funds/abc/journal")).toEqual(["buchhaltung", "instrumente", "journal", "stamm", "fehlertexte"]);
    expect(bereicheFuerPfad("/administration")).toContain("verwaltung");
    expect(bereicheFuerPfad("/gibt-es-nicht")).toEqual(["fehlertexte"]);
  });
});
