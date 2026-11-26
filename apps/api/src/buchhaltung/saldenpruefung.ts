import { and, eq, isNull, ne } from "drizzle-orm";
import { gliederungPosition, kontenregel, saldenlauf, sachkonto, type Saldenlauf } from "@carraway/db";
import { DateiFehler, kappeParams, leseSusa, type Befund, type SusaZeile } from "@carraway/import";
import { Decimal, kontoInBereich, regelGilt } from "@carraway/rechenkern";
import { Fachfehler, type Fehlercode } from "../fehler";
import type { Tx } from "../zeitlimit";

/**
 * Prüfung einer Saldenliste (Etappe 14): Lesefehler der Datei, unbekannte Konten (Befund, kein Abbruch), Saldensumme ungleich null
 * (Fehler), Überlappung der Zeiträume (Fehler; derselbe Zeitraum ersetzt die vorhandene Liste, Warnung), Konten ohne Regel in der Bilanz.
 */

export const MAX_BEFUNDE_SUSA = 2000;
const MAX_UNBEKANNT = 100;

const DATEIFEHLER: Record<DateiFehler["code"], { status: 400 | 413 | 415 | 422; code: Fehlercode }> = {
  DATEITYP_UNBEKANNT: { status: 415, code: "DATEITYP_UNBEKANNT" },
  DATEI_BESCHAEDIGT: { status: 422, code: "IMPORT_DATEI_UNLESBAR" },
  DATEI_ZU_GROSS: { status: 413, code: "DATEI_ZU_GROSS" },
  DATEI_LEER: { status: 422, code: "DATEI_LEER" },
  BLATT_NICHT_ERKANNT: { status: 422, code: "BLATT_NICHT_ERKANNT" },
};

export interface SusaPruefung {
  format: string;
  zeilen: SusaZeile[];
  befunde: Befund[];
  summe: { konten: number; saldensumme: string; soll: string; haben: string };
}

export async function pruefeSaldenlauf(tx: Tx, lauf: Saldenlauf): Promise<SusaPruefung> {
  let gelesen;
  try {
    gelesen = await leseSusa(new Uint8Array(lauf.datei));
  } catch (fehler) {
    if (fehler instanceof DateiFehler) {
      const z = DATEIFEHLER[fehler.code];
      throw new Fachfehler(z.status, z.code, fehler.message);
    }
    throw fehler;
  }
  const befunde: Befund[] = [...gelesen.befunde];
  const melde = (code: string, schweregrad: "fehler" | "warnung", meldung: string, params: Record<string, string | number> = {}, zeile: number | null = null) =>
    befunde.push({ blatt: null, blattName: null, zeile, spalte: null, code, schweregrad, meldung, params: kappeParams(params) });

  const summe = gelesen.zeilen.reduce((s, z) => s.plus(z.saldo), new Decimal(0));
  if (gelesen.zeilen.length > 0 && !summe.isZero()) {
    melde("SUSA_SALDENSUMME_UNGLEICH_NULL", "fehler", `Die Salden aller Konten ergeben ${summe.toFixed(2)} statt 0,00 (Soll positiv, Haben negativ).`, { summe: summe.toFixed(2) });
  }

  const kontenrahmen = new Set((await tx.select({ n: sachkonto.nummer }).from(sachkonto).where(eq(sachkonto.fondsId, lauf.fondsId))).map((k) => k.n));
  if (gelesen.zeilen.length > 0) {
    if (kontenrahmen.size === 0) melde("SUSA_KEIN_KONTENRAHMEN", "warnung", "Für den Fonds ist noch kein Kontenrahmen angelegt; alle Konten sind unbekannt.");
    else {
      const unbekannt = gelesen.zeilen.filter((z) => !kontenrahmen.has(z.konto));
      for (const z of unbekannt.slice(0, MAX_UNBEKANNT)) melde("SUSA_KONTO_UNBEKANNT", "warnung", `Das Konto ${z.konto} steht nicht im Kontenrahmen des Fonds.`, { konto: z.konto, saldo: z.saldo }, z.zeile);
      if (unbekannt.length > MAX_UNBEKANNT) melde("SUSA_KONTO_UNBEKANNT_WEITERE", "warnung", `Weitere ${unbekannt.length - MAX_UNBEKANNT} unbekannte Konten.`, { anzahl: unbekannt.length - MAX_UNBEKANNT });
    }
  }

  // Zeiträume: derselbe ersetzt, ein anderer überlappender ist ein Fehler.
  const andere = await tx
    .select()
    .from(saldenlauf)
    .where(and(eq(saldenlauf.fondsId, lauf.fondsId), eq(saldenlauf.status, "uebernommen"), isNull(saldenlauf.ersetztAm), ne(saldenlauf.id, lauf.id)));
  for (const a of andere) {
    if (a.zeitraumVon === lauf.zeitraumVon && a.zeitraumBis === lauf.zeitraumBis) {
      melde("SUSA_ERSETZT_VORHANDENE", "warnung", `Die übernommene Saldenliste für ${a.zeitraumVon} bis ${a.zeitraumBis} wird ersetzt; sie bleibt als frühere Fassung erhalten.`, { laufId: a.id, von: a.zeitraumVon, bis: a.zeitraumBis });
    } else if (a.zeitraumVon <= lauf.zeitraumBis && lauf.zeitraumVon <= a.zeitraumBis) {
      melde("SUSA_ZEITRAUM_UEBERLAPPT", "fehler", `Der Zeitraum überlappt die übernommene Saldenliste für ${a.zeitraumVon} bis ${a.zeitraumBis}.`, { laufId: a.id, von: a.zeitraumVon, bis: a.zeitraumBis });
    }
  }

  // Konten ohne Regel in der Bilanz: sie fehlen sonst unbemerkt in der Bilanzsumme.
  const positionen = await tx.select({ s: gliederungPosition.schluessel }).from(gliederungPosition).where(and(eq(gliederungPosition.fondsId, lauf.fondsId), eq(gliederungPosition.sicht, "bilanz")));
  if (positionen.length > 0) {
    const regeln = (await tx.select().from(kontenregel).where(and(eq(kontenregel.fondsId, lauf.fondsId), eq(kontenregel.sicht, "bilanz")))).filter((r) => regelGilt(r, lauf.zeitraumBis));
    const ohne = gelesen.zeilen.filter((z) => !regeln.some((r) => kontoInBereich(z.konto, r.kontoVon, r.kontoBis)));
    if (ohne.length) melde("SUSA_KONTO_OHNE_REGEL", "warnung", `${ohne.length} Konten haben keine Kontenregel für die Bilanz.`, { anzahl: ohne.length, beispiele: ohne.slice(0, 5).map((z) => z.konto).join(", ") });
  }

  const soll = gelesen.zeilen.reduce((s, z) => s.plus(new Decimal(z.saldo).greaterThan(0) ? z.saldo : 0), new Decimal(0));
  const haben = gelesen.zeilen.reduce((s, z) => s.plus(new Decimal(z.saldo).lessThan(0) ? new Decimal(z.saldo).abs() : 0), new Decimal(0));
  return { format: gelesen.format, zeilen: gelesen.zeilen, befunde, summe: { konten: gelesen.zeilen.length, saldensumme: summe.toFixed(2), soll: soll.toFixed(2), haben: haben.toFixed(2) } };
}
