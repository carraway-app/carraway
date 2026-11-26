import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ENTWICKLUNGSSCHLUESSEL, GeheimnisFehler, Schluesselring, ladeSchluesselring, leseSchluessel } from "../geheimnis/krypto";

/** Verschlüsselung ruhender Geheimnisse: Rundlauf, Bindung an die Zeile, Schlüsselwechsel. Alle Schlüssel sind zufällig und nur für den Test. */

const neu = () => randomBytes(32);

describe("AES-256-GCM", () => {
  it("verschlüsselt und entschlüsselt im Rundlauf, jedes Mal mit neuem IV", () => {
    const ring = new Schluesselring(neu());
    const a = ring.verschluessele("geheimes Token", "postfach_verbindung:1:zugang");
    const b = ring.verschluessele("geheimes Token", "postfach_verbindung:1:zugang");
    expect(a).not.toBe(b);
    expect(a).not.toContain("geheimes");
    expect(a.startsWith("f1.")).toBe(true);
    expect(ring.entschluessele(a, "postfach_verbindung:1:zugang")).toBe("geheimes Token");
  });

  it("bindet den Wert an Tabelle und Zeile (AAD) und erkennt Veränderungen", () => {
    const ring = new Schluesselring(neu());
    const text = ring.verschluessele("wert", "mail_auftrag:A");
    expect(() => ring.entschluessele(text, "mail_auftrag:B")).toThrow(GeheimnisFehler);
    const teile = text.split(".");
    teile[4] = Buffer.from("manipuliert").toString("base64url");
    expect(() => ring.entschluessele(teile.join("."), "mail_auftrag:A")).toThrow(GeheimnisFehler);
    expect(() => ring.entschluessele("kein-gueltiger-wert", "x")).toThrow(GeheimnisFehler);
  });

  it("Schlüsselwechsel: alte Werte bleiben mit dem alten Schlüssel lesbar, `brauchtRotation` meldet sie, ohne den alten Schlüssel scheitert es", () => {
    const alt = neu();
    const neuerSchluessel = neu();
    const mitAlt = new Schluesselring(alt).verschluessele("wert", "aad");
    const gewechselt = new Schluesselring(neuerSchluessel, [alt]);
    expect(gewechselt.brauchtRotation(mitAlt)).toBe(true);
    expect(gewechselt.entschluessele(mitAlt, "aad")).toBe("wert");
    const rotiert = gewechselt.verschluessele(gewechselt.entschluessele(mitAlt, "aad"), "aad");
    expect(gewechselt.brauchtRotation(rotiert)).toBe(false);
    // Nach dem Entfernen des alten Schlüssels bleibt nur der rotierte Wert lesbar.
    const nurNeu = new Schluesselring(neuerSchluessel);
    expect(nurNeu.entschluessele(rotiert, "aad")).toBe("wert");
    expect(() => nurNeu.entschluessele(mitAlt, "aad")).toThrow(/Schlüssel/);
  });
});

describe("Schlüssel aus der Umgebung", () => {
  it("liest Base64 und Hex mit genau 32 Byte", () => {
    const roh = neu();
    expect(leseSchluessel(roh.toString("base64")).equals(roh)).toBe(true);
    expect(leseSchluessel(roh.toString("hex")).equals(roh)).toBe(true);
    expect(() => leseSchluessel("zu-kurz")).toThrow(GeheimnisFehler);
  });

  it("ohne Schlüssel gibt es nur außerhalb von Produktion und Echtbestand den Entwicklungsschlüssel", () => {
    expect(ladeSchluesselring({}, "demo")).toBeDefined();
    expect(ladeSchluesselring({}, "test")).toBeDefined();
    expect(ladeSchluesselring({}, "echt")).toBeUndefined();
    expect(ladeSchluesselring({ NODE_ENV: "production" }, "demo")).toBeUndefined();
    const gesetzt = ladeSchluesselring({ GEHEIMNIS_SCHLUESSEL: neu().toString("base64") }, "echt");
    expect(gesetzt).toBeDefined();
    expect(gesetzt!.kennung).not.toBe(ladeSchluesselring({ GEHEIMNIS_SCHLUESSEL: ENTWICKLUNGSSCHLUESSEL }, "demo")!.kennung);
  });

  it("nimmt alte Schlüssel kommagetrennt aus GEHEIMNIS_SCHLUESSEL_ALT", () => {
    const a = neu();
    const b = neu();
    const aktuell = neu();
    const ring = ladeSchluesselring({ GEHEIMNIS_SCHLUESSEL: aktuell.toString("base64"), GEHEIMNIS_SCHLUESSEL_ALT: `${a.toString("base64")}, ${b.toString("hex")}` }, "echt")!;
    expect(ring.entschluessele(new Schluesselring(b).verschluessele("x", "y"), "y")).toBe("x");
    expect(ring.entschluessele(new Schluesselring(a).verschluessele("x", "y"), "y")).toBe("x");
  });
});
