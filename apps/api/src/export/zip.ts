import { crc32, createDeflateRaw } from "node:zlib";
import { Readable } from "node:stream";

/**
 * Schreibender ZIP-Strom ohne Abhängigkeit: jeder Eintrag wird gepackt (Deflate) und fließt in Blöcken heraus, der Speicherbedarf
 * hängt nur von der Blockgröße ab, nicht von der Größe der Einträge. Größen und Prüfsumme stehen hinter den Daten (Bit 3,
 * „Data Descriptor“) und im Verzeichnis am Ende; Namen sind UTF-8 (Bit 11). Kein ZIP64: Einträge bis 4 GiB, höchstens 65 535 Einträge.
 */

export interface ZipEintrag {
  name: string;
  /** Inhalt in Blöcken; wird nacheinander gelesen. */
  daten: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
  /** Änderungszeit (Standard: jetzt). */
  zeit?: Date;
}

const kodiere = new TextEncoder();

function dosZeit(d: Date): { zeit: number; datum: number } {
  const jahr = Math.max(1980, d.getUTCFullYear());
  return {
    zeit: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    datum: ((jahr - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

const kopf = (laenge: number) => {
  const puffer = new Uint8Array(laenge);
  return { puffer, ansicht: new DataView(puffer.buffer) };
};

async function* pack(daten: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, summe: { crc: number; gross: number; klein: number }): AsyncGenerator<Uint8Array> {
  const quelle = Readable.from(
    (async function* () {
      for await (const block of daten) {
        summe.crc = crc32(block, summe.crc);
        summe.gross += block.length;
        yield block;
      }
    })(),
    { objectMode: false },
  );
  const deflate = createDeflateRaw();
  quelle.on("error", (fehler) => deflate.destroy(fehler));
  quelle.pipe(deflate);
  for await (const stueck of deflate) {
    const block = stueck as Buffer;
    summe.klein += block.length;
    yield new Uint8Array(block.buffer, block.byteOffset, block.byteLength);
  }
}

/** Schreibt die Einträge als ZIP-Strom. Wirft bei zu vielen Einträgen oder zu großen Dateien (kein ZIP64). */
export async function* zipStrom(eintraege: AsyncIterable<ZipEintrag>): AsyncGenerator<Uint8Array> {
  const verzeichnis: { name: Uint8Array; crc: number; klein: number; gross: number; versatz: number; dos: { zeit: number; datum: number } }[] = [];
  let versatz = 0;
  for await (const eintrag of eintraege) {
    if (verzeichnis.length >= 0xfffe) throw new Error("ZIP: zu viele Einträge");
    const name = kodiere.encode(eintrag.name);
    const dos = dosZeit(eintrag.zeit ?? new Date());
    const l = kopf(30);
    l.ansicht.setUint32(0, 0x04034b50, true);
    l.ansicht.setUint16(4, 20, true);
    l.ansicht.setUint16(6, 0x0808, true); // Data Descriptor, UTF-8
    l.ansicht.setUint16(8, 8, true); // Deflate
    l.ansicht.setUint16(10, dos.zeit, true);
    l.ansicht.setUint16(12, dos.datum, true);
    l.ansicht.setUint16(26, name.length, true);
    yield l.puffer;
    yield name;
    const start = versatz;
    versatz += 30 + name.length;
    const summe = { crc: 0, gross: 0, klein: 0 };
    for await (const block of pack(eintrag.daten, summe)) {
      versatz += block.length;
      yield block;
    }
    if (summe.gross > 0xffffffff || summe.klein > 0xffffffff) throw new Error("ZIP: Eintrag zu groß (kein ZIP64)");
    const d = kopf(16);
    d.ansicht.setUint32(0, 0x08074b50, true);
    d.ansicht.setUint32(4, summe.crc >>> 0, true);
    d.ansicht.setUint32(8, summe.klein, true);
    d.ansicht.setUint32(12, summe.gross, true);
    yield d.puffer;
    versatz += 16;
    verzeichnis.push({ name, crc: summe.crc >>> 0, klein: summe.klein, gross: summe.gross, versatz: start, dos });
  }
  const verzeichnisStart = versatz;
  let verzeichnisGroesse = 0;
  for (const e of verzeichnis) {
    const z = kopf(46);
    z.ansicht.setUint32(0, 0x02014b50, true);
    z.ansicht.setUint16(4, 20, true);
    z.ansicht.setUint16(6, 20, true);
    z.ansicht.setUint16(8, 0x0808, true);
    z.ansicht.setUint16(10, 8, true);
    z.ansicht.setUint16(12, e.dos.zeit, true);
    z.ansicht.setUint16(14, e.dos.datum, true);
    z.ansicht.setUint32(16, e.crc, true);
    z.ansicht.setUint32(20, e.klein, true);
    z.ansicht.setUint32(24, e.gross, true);
    z.ansicht.setUint16(28, e.name.length, true);
    z.ansicht.setUint32(42, e.versatz, true);
    yield z.puffer;
    yield e.name;
    verzeichnisGroesse += 46 + e.name.length;
  }
  const ende = kopf(22);
  ende.ansicht.setUint32(0, 0x06054b50, true);
  ende.ansicht.setUint16(8, verzeichnis.length, true);
  ende.ansicht.setUint16(10, verzeichnis.length, true);
  ende.ansicht.setUint32(12, verzeichnisGroesse, true);
  ende.ansicht.setUint32(16, verzeichnisStart, true);
  yield ende.puffer;
}
