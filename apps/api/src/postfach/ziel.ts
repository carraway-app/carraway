import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { PostfachFehler } from "./typen";

/**
 * Schutz vor Server-Side Request Forgery beim IMAP-Ziel: Der Server verbindet sich zu einer Adresse, die die Person eingibt. Ohne
 * `POSTFACH_PRIVATE_ZIELE=1` sind alle Sonderbereiche verboten (lokal, privat, Link-Local, gemeinsam genutzt, Dokumentation, Multicast, reserviert).
 *
 * Vorgehen: Der Name wird genau einmal aufgelöst, jede Adresse normalisiert (eingebettetes IPv4 in `::ffff:` auch in Hexform, `::/96` und NAT64
 * `64:ff9b::/96` wird ausgepackt; 6to4 `2002::/16` und Teredo `2001::/32` sind ganz gesperrt) und gegen die Sonderbereiche geprüft. Verbunden wird danach mit
 * **genau der geprüften Adresse** (`pruefeImapZiel` gibt sie zurück; der Servername für TLS bleibt der Name), damit eine zweite, andere DNS-Antwort keine
 * Wirkung hat (DNS-Rebinding). Mit `privateErlaubt` (Selbsthoster) entfällt die Prüfung. Die festen Adressen von Microsoft und Google brauchen keine Prüfung.
 */

export type Aufloeser = (host: string) => Promise<string[]>;

export const standardAufloeser: Aufloeser = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

const v4 = new BlockList();
for (const [netz, laenge] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  v4.addSubnet(netz, laenge, "ipv4");
}

const v6 = new BlockList();
for (const [netz, laenge] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  v6.addSubnet(netz, laenge, "ipv6");
}

/** Zerlegt eine IPv6-Adresse in acht 16-Bit-Gruppen (auch mit `::` und IPv4-Ende); `null` bei Unsinn. */
function gruppen(ip: string): number[] | null {
  let text = ip.toLowerCase().split("%")[0]!;
  const ende = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (ende) {
    const t = ende[1]!.split(".").map(Number);
    if (t.length !== 4 || t.some((n) => n > 255)) return null;
    text = `${text.slice(0, -ende[1]!.length)}${((t[0]! << 8) | t[1]!).toString(16)}:${((t[2]! << 8) | t[3]!).toString(16)}`;
  }
  const teile = text.split("::");
  if (teile.length > 2) return null;
  const kopf = teile[0] ? teile[0].split(":") : [];
  const rumpf = teile.length === 2 && teile[1] ? teile[1].split(":") : [];
  const fehlt = 8 - kopf.length - rumpf.length;
  if ((teile.length === 1 && fehlt !== 0) || fehlt < 0) return null;
  const alle = [...kopf, ...Array<string>(teile.length === 2 ? fehlt : 0).fill("0"), ...rumpf].map((g) => parseInt(g, 16));
  return alle.length === 8 && alle.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? alle : null;
}

const alsV4 = (hoch: number, tief: number) => `${hoch >> 8}.${hoch & 255}.${tief >> 8}.${tief & 255}`;

/** `true`, wenn die Adresse in einem Sonderbereich liegt, nicht zu lesen ist oder ein eingebettetes IPv4 in einem Sonderbereich trägt. */
export function istPrivateAdresse(ip: string): boolean {
  const art = isIP(ip.split("%")[0]!);
  if (art === 4) return v4.check(ip, "ipv4");
  if (art !== 6) return true;
  const g = gruppen(ip);
  if (!g) return true;
  const [a, b, c, d, e, f, hoch, tief] = g as [number, number, number, number, number, number, number, number];
  const ersteNull = (n: number) => g.slice(0, n).every((x) => x === 0);
  // ::ffff:0:0/96 (abgebildet), ::/96 (kompatibel), 64:ff9b::/96 (NAT64): die letzten 32 Bit sind ein IPv4
  const eingebettet = (ersteNull(5) && f === 0xffff) || ersteNull(6) || (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0);
  if (eingebettet) return v4.check(alsV4(hoch, tief), "ipv4") || ersteNull(6) /* ::, ::1 und der Rest von ::/96 */;
  return v6.check(ip.split("%")[0]!, "ipv6");
}

/**
 * Prüft Name, Port und Auflösung und gibt die Adresse zurück, mit der verbunden werden muss (bei erlaubten privaten Zielen der Name unverändert).
 * Wirft `PostfachFehler("ZIEL_VERBOTEN")` oder `("ZIEL_NICHT_AUFLOESBAR")`.
 */
export async function pruefeImapZiel(host: string, port: number, privateErlaubt: boolean, aufloeser: Aufloeser = standardAufloeser): Promise<string> {
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(host) && isIP(host) === 0) throw new PostfachFehler("ZIEL_VERBOTEN");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new PostfachFehler("ZIEL_VERBOTEN");
  if (privateErlaubt) return host;
  let adressen: string[];
  try {
    adressen = isIP(host) ? [host] : await aufloeser(host);
  } catch {
    throw new PostfachFehler("ZIEL_NICHT_AUFLOESBAR");
  }
  if (adressen.length === 0 || adressen.some(istPrivateAdresse)) throw new PostfachFehler("ZIEL_VERBOTEN");
  return adressen[0]!;
}
