import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Verschlüsselung ruhender Geheimnisse (OAuth-Tokens, IMAP-Zugang, Mailinhalte mit einmaligem Link): AES-256-GCM.
 *
 * Format: `f1.<Schlüsselkennung>.<IV>.<Tag>.<Chiffretext>` (Base64url). Jede Verschlüsselung nimmt einen neuen zufälligen 96-Bit-IV.
 * Die zusätzlich authentifizierten Daten (AAD, z. B. `postfach_verbindung:<id>`) binden den Text an Tabelle und Zeile: Ein in eine
 * andere Zeile kopierter Wert lässt sich nicht entschlüsseln.
 *
 * Schlüssel: `GEHEIMNIS_SCHLUESSEL` (32 Byte, Base64 oder 64 Hex-Zeichen). Rotation: neuen Schlüssel setzen, den bisherigen in
 * `GEHEIMNIS_SCHLUESSEL_ALT` (kommagetrennt) führen, `pnpm --filter @carraway/api geheimnis:rotieren` verschlüsselt alle Werte neu,
 * danach den alten Schlüssel entfernen. Die Kennung (erste 8 Hex-Zeichen des SHA-256 des Schlüssels) wählt beim Entschlüsseln den Schlüssel.
 */

export class GeheimnisFehler extends Error {
  constructor(
    readonly code: "SCHLUESSEL_UNGUELTIG" | "SCHLUESSEL_UNBEKANNT" | "TEXT_UNGUELTIG",
    meldung: string,
  ) {
    super(meldung);
  }
}

const FORMAT = "f1";

/** Öffentlicher Schlüssel nur für lokale Entwicklung und Tests; nie in Produktion oder im Echtbestand. */
export const ENTWICKLUNGSSCHLUESSEL = createHash("sha256").update("carraway-nur-lokale-entwicklung-geheimnis-schluessel").digest("base64");

const kennung = (schluessel: Buffer) => createHash("sha256").update(schluessel).digest("hex").slice(0, 8);

/** Liest einen Schlüssel aus Base64 oder Hex; muss genau 32 Byte ergeben. */
export function leseSchluessel(text: string): Buffer {
  const t = text.trim();
  const roh = /^[0-9a-fA-F]{64}$/.test(t) ? Buffer.from(t, "hex") : Buffer.from(t, "base64");
  if (roh.length !== 32) throw new GeheimnisFehler("SCHLUESSEL_UNGUELTIG", "GEHEIMNIS_SCHLUESSEL muss 32 Byte lang sein (Base64 oder 64 Hex-Zeichen, z. B. openssl rand -base64 32).");
  return roh;
}

export class Schluesselring {
  readonly #aktuell: Buffer;
  readonly #alle = new Map<string, Buffer>();
  readonly kennung: string;

  constructor(aktuell: Buffer, alte: Buffer[] = []) {
    this.#aktuell = aktuell;
    this.kennung = kennung(aktuell);
    for (const s of [...alte, aktuell]) this.#alle.set(kennung(s), s);
  }

  verschluessele(klartext: string, aad: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.#aktuell, iv);
    c.setAAD(Buffer.from(aad, "utf8"));
    const ct = Buffer.concat([c.update(klartext, "utf8"), c.final()]);
    return [FORMAT, this.kennung, iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
  }

  entschluessele(text: string, aad: string): string {
    const teile = text.split(".");
    if (teile.length !== 5 || teile[0] !== FORMAT) throw new GeheimnisFehler("TEXT_UNGUELTIG", "Verschlüsselter Wert hat ein unbekanntes Format.");
    const schluessel = this.#alle.get(teile[1]!);
    if (!schluessel) throw new GeheimnisFehler("SCHLUESSEL_UNBEKANNT", "Der Schlüssel zu diesem Wert fehlt (GEHEIMNIS_SCHLUESSEL_ALT).");
    try {
      const d = createDecipheriv("aes-256-gcm", schluessel, Buffer.from(teile[2]!, "base64url"));
      d.setAAD(Buffer.from(aad, "utf8"));
      d.setAuthTag(Buffer.from(teile[3]!, "base64url"));
      return Buffer.concat([d.update(Buffer.from(teile[4]!, "base64url")), d.final()]).toString("utf8");
    } catch {
      throw new GeheimnisFehler("TEXT_UNGUELTIG", "Verschlüsselter Wert lässt sich nicht entschlüsseln (verändert oder anderer Datensatz).");
    }
  }

  /** `true`, wenn der Wert mit einem anderen als dem aktuellen Schlüssel verschlüsselt wurde. */
  brauchtRotation(text: string): boolean {
    return text.split(".")[1] !== this.kennung;
  }
}

type Umgebungsvariablen = Record<string, string | undefined>;

/**
 * Schlüsselring aus der Umgebung. Ohne `GEHEIMNIS_SCHLUESSEL` gibt es nur außerhalb von Produktion und Echtbestand den öffentlichen
 * Entwicklungsschlüssel (Demo und Tests); sonst `undefined` und die Funktionen, die Geheimnisse speichern, bleiben aus.
 */
export function ladeSchluesselring(env: Umgebungsvariablen, umgebung: string): Schluesselring | undefined {
  const aktuell = env.GEHEIMNIS_SCHLUESSEL?.trim();
  const alte = (env.GEHEIMNIS_SCHLUESSEL_ALT ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(leseSchluessel);
  if (aktuell) return new Schluesselring(leseSchluessel(aktuell), alte);
  if (umgebung === "echt" || env.NODE_ENV === "production") return undefined;
  return new Schluesselring(leseSchluessel(ENTWICKLUNGSSCHLUESSEL), alte);
}
