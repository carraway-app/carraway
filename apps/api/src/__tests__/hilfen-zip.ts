import { crc32, inflateRawSync } from "node:zlib";

/** Liest ein ZIP über sein Verzeichnis am Ende (wie ein Entpacker) und prüft CRC-32 und Größe jedes Eintrags. */
export function leseZip(daten: Uint8Array): Map<string, Buffer> {
  const puffer = Buffer.from(daten.buffer, daten.byteOffset, daten.byteLength);
  const eocd = puffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("kein ZIP-Verzeichnis");
  const anzahl = puffer.readUInt16LE(eocd + 10);
  let pos = puffer.readUInt32LE(eocd + 16);
  const aus = new Map<string, Buffer>();
  for (let i = 0; i < anzahl; i++) {
    if (puffer.readUInt32LE(pos) !== 0x02014b50) throw new Error("Verzeichniseintrag erwartet");
    const methode = puffer.readUInt16LE(pos + 10);
    const crc = puffer.readUInt32LE(pos + 16);
    const klein = puffer.readUInt32LE(pos + 20);
    const gross = puffer.readUInt32LE(pos + 24);
    const nameLaenge = puffer.readUInt16LE(pos + 28);
    const extra = puffer.readUInt16LE(pos + 30);
    const kommentar = puffer.readUInt16LE(pos + 32);
    const lokal = puffer.readUInt32LE(pos + 42);
    const name = puffer.subarray(pos + 46, pos + 46 + nameLaenge).toString("utf8");
    pos += 46 + nameLaenge + extra + kommentar;
    if (puffer.readUInt32LE(lokal) !== 0x04034b50) throw new Error("lokaler Kopf erwartet");
    const start = lokal + 30 + puffer.readUInt16LE(lokal + 26) + puffer.readUInt16LE(lokal + 28);
    const roh = puffer.subarray(start, start + klein);
    const inhalt = methode === 8 ? inflateRawSync(roh) : roh;
    if (inhalt.length !== gross) throw new Error(`Größe von ${name} stimmt nicht`);
    if ((crc32(inhalt) >>> 0) !== crc) throw new Error(`CRC von ${name} stimmt nicht`);
    aus.set(name, Buffer.from(inhalt));
  }
  return aus;
}

/** Baut ein ZIP aus Einträgen (für Tests der Schutzprüfung); `erklaert` überschreibt die Größenangabe im Kopf. */
export function baueZip(eintraege: { name: string; inhalt: Buffer; gepackt: Buffer; erklaert?: number }[]): Buffer {
  const teile: Buffer[] = [];
  const zentral: Buffer[] = [];
  let offset = 0;
  for (const e of eintraege) {
    const name = Buffer.from(e.name);
    const crc = crc32(e.inhalt);
    const groesse = e.erklaert ?? e.inhalt.length;
    const lokal = Buffer.alloc(30);
    lokal.writeUInt32LE(0x04034b50, 0);
    lokal.writeUInt16LE(20, 4);
    lokal.writeUInt16LE(8, 8);
    lokal.writeUInt32LE(crc, 14);
    lokal.writeUInt32LE(e.gepackt.length, 18);
    lokal.writeUInt32LE(groesse, 22);
    lokal.writeUInt16LE(name.length, 26);
    const z = Buffer.alloc(46);
    z.writeUInt32LE(0x02014b50, 0);
    z.writeUInt16LE(20, 4);
    z.writeUInt16LE(20, 6);
    z.writeUInt16LE(8, 10);
    z.writeUInt32LE(crc, 16);
    z.writeUInt32LE(e.gepackt.length, 20);
    z.writeUInt32LE(groesse, 24);
    z.writeUInt16LE(name.length, 28);
    z.writeUInt32LE(offset, 42);
    zentral.push(z, name);
    teile.push(lokal, name, e.gepackt);
    offset += 30 + name.length + e.gepackt.length;
  }
  const verzeichnis = Buffer.concat(zentral);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0);
  ende.writeUInt16LE(eintraege.length, 8);
  ende.writeUInt16LE(eintraege.length, 10);
  ende.writeUInt32LE(verzeichnis.length, 12);
  ende.writeUInt32LE(offset, 16);
  return Buffer.concat([...teile, verzeichnis, ende]);
}
