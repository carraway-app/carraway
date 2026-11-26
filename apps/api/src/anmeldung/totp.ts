import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Zeitbasierte Einmalcodes nach RFC 6238 (SHA-1, sechs Stellen, 30 Sekunden) wie Better Auth sie für den zweiten Faktor nutzt: Der Schlüssel
 * sind die Bytes des gespeicherten Geheimnisses, in der Einrichtungsadresse steht es als Base32. Hier nur für die Neueinrichtung
 * (`routen/konto-sicherheit.ts`), wo das neue Geheimnis erst nach einem gültigen Code das alte ersetzt.
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Kodieren(daten: Buffer): string {
  let bits = 0;
  let wert = 0;
  let text = "";
  for (const byte of daten) {
    wert = (wert << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      text += BASE32[(wert >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) text += BASE32[(wert << (5 - bits)) & 31];
  return text;
}

export function totpCode(geheimnis: string, zeit: number, versatz = 0): string {
  const zaehler = Math.floor(zeit / 30_000) + versatz;
  const puffer = Buffer.alloc(8);
  puffer.writeBigUInt64BE(BigInt(zaehler));
  const hmac = createHmac("sha1", Buffer.from(geheimnis, "utf8")).update(puffer).digest();
  const o = hmac[hmac.length - 1]! & 0x0f;
  const zahl = ((hmac[o]! & 0x7f) << 24) | (hmac[o + 1]! << 16) | (hmac[o + 2]! << 8) | hmac[o + 3]!;
  return String(zahl % 1_000_000).padStart(6, "0");
}

/** Prüft einen Code im aktuellen und den beiden Nachbarfenstern (Uhrenabweichung). */
export function totpPasst(geheimnis: string, code: string, zeit = Date.now()): boolean {
  const eingabe = Buffer.from(code.trim());
  let treffer = false;
  for (const versatz of [-1, 0, 1]) {
    const soll = Buffer.from(totpCode(geheimnis, zeit, versatz));
    if (soll.length === eingabe.length && timingSafeEqual(soll, eingabe)) treffer = true;
  }
  return treffer;
}

export function totpAdresse(geheimnis: string, aussteller: string, konto: string): string {
  const name = `${encodeURIComponent(aussteller)}:${encodeURIComponent(konto)}`;
  return `otpauth://totp/${name}?secret=${base32Kodieren(Buffer.from(geheimnis, "utf8"))}&issuer=${encodeURIComponent(aussteller)}&algorithm=SHA1&digits=6&period=30`;
}
