import { Decimal } from "@carraway/rechenkern";
import { kappeParams, type Befund, type BefundParams, type Schweregrad } from "./lesen";
import type { Blatt } from "./spec";
import type { Typisiert, Zeile } from "./typisieren";

/**
 * Prüfregeln über mehrere Zeilen und Blätter, die ohne Datenbank auskommen: eindeutige Schlüssel, auflösbare Verweise,
 * Rundensummen, Stornos und Kreuzfelder. Regeln, die den Bestand brauchen (Auszahlungen gegen Zusage, Dubletten,
 * Periodensperre, abweichende Vorgänge, Kontrollsummen), liegen in der API.
 */

/** Objekte, auf die andere Blätter verweisen. */
export type Verweisziel = "fonds" | "organisationen" | "beteiligungen" | "finanzierungsrunden" | "vorgaenge";

/** Schlüssel, die schon im Bestand stehen (für Verweise auf Zeilen, die nicht in der Datei sind). */
export type Extern = Record<Verweisziel, ReadonlySet<string>>;

export const SCHLUESSELSPALTE: Partial<Record<Blatt, string>> = {
  fonds: "fonds_kurzname",
  organisationen: "organisation_schluessel",
  personen: "person_schluessel",
  beteiligungen: "beteiligung_schluessel",
  finanzierungsrunden: "runde_schluessel",
  vorgaenge: "vorgang_schluessel",
  bewertungen: "bewertung_schluessel",
  fondsbewegungen: "bewegung_schluessel",
};

/** Welches Feld verweist auf welches Objekt? */
export const VERWEISE: readonly { blatt: Blatt; spalte: string; ziel: Verweisziel }[] = [
  { blatt: "personen", spalte: "organisation_schluessel", ziel: "organisationen" },
  { blatt: "beteiligungen", spalte: "fonds_kurzname", ziel: "fonds" },
  { blatt: "beteiligungen", spalte: "organisation_schluessel", ziel: "organisationen" },
  { blatt: "finanzierungsrunden", spalte: "organisation_schluessel", ziel: "organisationen" },
  { blatt: "rundenpositionen", spalte: "runde_schluessel", ziel: "finanzierungsrunden" },
  { blatt: "rundenpositionen", spalte: "fonds_kurzname", ziel: "fonds" },
  { blatt: "rundenpositionen", spalte: "investor_schluessel", ziel: "organisationen" },
  { blatt: "vorgaenge", spalte: "beteiligung_schluessel", ziel: "beteiligungen" },
  { blatt: "vorgaenge", spalte: "storniert_vorgang_schluessel", ziel: "vorgaenge" },
  { blatt: "bewertungen", spalte: "beteiligung_schluessel", ziel: "beteiligungen" },
  { blatt: "konditionen", spalte: "beteiligung_schluessel", ziel: "beteiligungen" },
  { blatt: "fondsbewegungen", spalte: "fonds_kurzname", ziel: "fonds" },
  { blatt: "kontrollsummen", spalte: "fonds_kurzname", ziel: "fonds" },
];

const ZIEL_BLATT: Record<Verweisziel, Blatt> = {
  fonds: "fonds",
  organisationen: "organisationen",
  beteiligungen: "beteiligungen",
  finanzierungsrunden: "finanzierungsrunden",
  vorgaenge: "vorgaenge",
};

/** Schlüssel, die die Datei selbst definiert (auch von Zeilen mit Fehlern in anderen Feldern). */
export function definierteSchluessel(daten: Typisiert, ziel: Verweisziel): Set<string> {
  const blatt = ZIEL_BLATT[ziel];
  const spalte = SCHLUESSELSPALTE[blatt]!;
  return new Set(daten[blatt].map((z) => z.w[spalte]).filter((x): x is string => x !== undefined));
}

/** Schlüssel, auf die die Datei verweist, ohne sie selbst zu definieren: Diese muss der Bestand kennen. */
export function sammleExterneVerweise(daten: Typisiert): Record<Verweisziel, string[]> {
  const aus: Record<Verweisziel, Set<string>> = { fonds: new Set(), organisationen: new Set(), beteiligungen: new Set(), finanzierungsrunden: new Set(), vorgaenge: new Set() };
  const eigene = Object.fromEntries((Object.keys(aus) as Verweisziel[]).map((z) => [z, definierteSchluessel(daten, z)])) as Record<Verweisziel, Set<string>>;
  for (const v of VERWEISE) {
    for (const z of daten[v.blatt]) {
      const wert = z.w[v.spalte];
      if (wert !== undefined && !eigene[v.ziel].has(wert)) aus[v.ziel].add(wert);
    }
  }
  return Object.fromEntries(Object.entries(aus).map(([k, v]) => [k, [...v]])) as unknown as Record<Verweisziel, string[]>;
}

type Melder = (blatt: Blatt, zeile: Zeile, spalte: string | null, code: string, meldung: string, params?: BefundParams, grad?: Schweregrad) => void;

const d = (x: string) => new Decimal(x);

/** Prüft die Regeln über mehrere Zeilen. `namen` sind die Blattnamen der Datei für die Befunde. */
export function pruefeInhalt(daten: Typisiert, namen: Record<Blatt, string>, extern: Extern): Befund[] {
  const befunde: Befund[] = [];
  const melde: Melder = (blatt, zeile, spalte, code, meldung, params = {}, grad = "fehler") =>
    befunde.push({ blatt, blattName: namen[blatt], zeile: zeile.zeile, spalte, code, schweregrad: grad, meldung, params: kappeParams(params) });

  // 1. Eindeutige Schlüssel je Blatt.
  for (const [blatt, spalte] of Object.entries(SCHLUESSELSPALTE) as [Blatt, string][]) {
    const erste = new Map<string, number>();
    for (const z of daten[blatt]) {
      const k = z.w[spalte];
      if (k === undefined) continue;
      const frueher = erste.get(k);
      if (frueher !== undefined) melde(blatt, z, spalte, "SCHLUESSEL_DOPPELT", `Der Schlüssel „${k}“ steht schon in Zeile ${frueher}.`, { schluessel: k, zeile: frueher });
      else erste.set(k, z.zeile);
    }
  }
  const natuerlich = (blatt: Blatt, schluessel: (z: Zeile) => string | null, beschreibung: string) => {
    const erste = new Map<string, number>();
    for (const z of daten[blatt]) {
      const k = schluessel(z);
      if (k === null) continue;
      const frueher = erste.get(k);
      if (frueher !== undefined) melde(blatt, z, null, "SCHLUESSEL_DOPPELT", `${beschreibung} steht schon in Zeile ${frueher}.`, { was: beschreibung, zeile: frueher });
      else erste.set(k, z.zeile);
    }
  };
  natuerlich(
    "beteiligungen",
    (z) => (z.w.fonds_kurzname && z.w.organisation_schluessel && z.w.instrument ? `${z.w.fonds_kurzname}|${z.w.organisation_schluessel}|${z.w.instrument}|${z.w.bezeichnung ?? ""}` : null),
    "Dieses Instrument (Fonds, Organisation, Art, Bezeichnung)",
  );
  natuerlich("konditionen", (z) => (z.w.beteiligung_schluessel && z.w.gueltig_ab ? `${z.w.beteiligung_schluessel}|${z.w.instrument ?? ""}|${z.w.gueltig_ab}` : null), "Diese Version der Konditionen (Beteiligung, Instrument, gültig ab)");
  natuerlich(
    "rundenpositionen",
    (z) => (z.w.runde_schluessel && (z.w.fonds_kurzname || z.w.investor_schluessel) ? `${z.w.runde_schluessel}|${z.w.fonds_kurzname ? `f:${z.w.fonds_kurzname}` : `o:${z.w.investor_schluessel}`}` : null),
    "Diese Position (Runde, Investor)",
  );
  natuerlich("kontrollsummen", (z) => (z.w.fonds_kurzname && z.w.groesse ? `${z.w.fonds_kurzname}|${z.w.groesse}|${z.w.stichtag ?? ""}` : null), "Diese Kontrollsumme");

  // 2. Verweise auflösbar.
  const eigene = Object.fromEntries((Object.keys(extern) as Verweisziel[]).map((ziel) => [ziel, definierteSchluessel(daten, ziel)])) as Record<Verweisziel, Set<string>>;
  for (const v of VERWEISE) {
    for (const z of daten[v.blatt]) {
      const wert = z.w[v.spalte];
      if (wert !== undefined && !eigene[v.ziel].has(wert) && !extern[v.ziel].has(wert)) {
        melde(v.blatt, z, v.spalte, "VERWEIS_UNBEKANNT", `„${wert}“ gibt es weder im Blatt ${namen[ZIEL_BLATT[v.ziel]]} noch im Bestand.`, { wert, zielBlatt: ZIEL_BLATT[v.ziel], zielBlattName: namen[ZIEL_BLATT[v.ziel]] });
      }
    }
  }

  // 3. Rundenpositionen: genau ein Investor; Summe = Rundenvolumen.
  for (const z of daten.rundenpositionen) {
    const hatFonds = z.w.fonds_kurzname !== undefined;
    const hatInvestor = z.w.investor_schluessel !== undefined;
    if (hatFonds === hatInvestor) melde("rundenpositionen", z, hatFonds ? "investor_schluessel" : "fonds_kurzname", "POSITION_INVESTOR", "Genau eines von Fonds und Investor muss ausgefüllt sein.");
  }
  const positionen = new Map<string, { summe: Decimal; zeilen: number }>();
  for (const z of daten.rundenpositionen) {
    const runde = z.w.runde_schluessel;
    if (runde === undefined || z.w.betrag === undefined) continue;
    const bisher = positionen.get(runde) ?? { summe: new Decimal(0), zeilen: 0 };
    positionen.set(runde, { summe: bisher.summe.plus(z.w.betrag), zeilen: bisher.zeilen + 1 });
  }
  for (const z of daten.finanzierungsrunden) {
    const pre = z.w.pre_money;
    const post = z.w.post_money;
    if (pre !== undefined && post !== undefined && !d(post).greaterThan(pre)) {
      melde("finanzierungsrunden", z, "post_money", "RUNDE_POST_KLEINER_PRE", "Post-Money muss über Pre-Money liegen (Post-Money = Pre-Money + Rundenvolumen).");
    }
    const summe = z.w.runde_schluessel === undefined ? undefined : positionen.get(z.w.runde_schluessel);
    if (summe && pre !== undefined && post !== undefined) {
      const volumen = d(post).minus(pre);
      if (!summe.summe.equals(volumen)) {
        melde(
          "finanzierungsrunden",
          z,
          "post_money",
          "RUNDE_SUMME_ABWEICHEND",
          `Die Positionen der Runde (${summe.zeilen}) ergeben ${summe.summe.toFixed(2)}, das Rundenvolumen (Post-Money minus Pre-Money) ist ${volumen.toFixed(2)}.`,
          { positionen: summe.zeilen, summe: summe.summe.toFixed(2), volumen: volumen.toFixed(2) },
        );
      }
    }
  }

  // 4. Vorgänge: Vorzeichen, Kapitalisierung, Stornos.
  const vorgangNachSchluessel = new Map<string, Zeile>();
  for (const z of daten.vorgaenge) if (z.w.vorgang_schluessel !== undefined && !vorgangNachSchluessel.has(z.w.vorgang_schluessel)) vorgangNachSchluessel.set(z.w.vorgang_schluessel, z);
  const storniert = new Map<string, number>();
  for (const z of daten.vorgaenge) {
    const { art, betrag, kapitalisiert } = z.w;
    const stornoZiel = z.w.storniert_vorgang_schluessel;
    if (kapitalisiert === "ja" && art !== undefined && art !== "zins") melde("vorgaenge", z, "kapitalisiert", "KAPITALISIERT_NUR_ZINS", "„kapitalisiert“ gilt nur für Zinsen.");
    if (betrag === undefined || art === undefined) continue;
    const negativ = betrag.startsWith("-");
    if (stornoZiel === undefined) {
      if (negativ && art !== "wertberichtigung") melde("vorgaenge", z, "betrag", "BETRAG_VORZEICHEN", "Nur Wertberichtigungen (Auflösung) und Stornos dürfen negativ sein.");
      continue;
    }
    const original = vorgangNachSchluessel.get(stornoZiel);
    const frueher = storniert.get(stornoZiel);
    if (frueher !== undefined) melde("vorgaenge", z, "storniert_vorgang_schluessel", "STORNO_DOPPELT", `Der Vorgang „${stornoZiel}“ wird schon in Zeile ${frueher} storniert.`, { schluessel: stornoZiel, zeile: frueher });
    else storniert.set(stornoZiel, z.zeile);
    if (stornoZiel === z.w.vorgang_schluessel) {
      melde("vorgaenge", z, "storniert_vorgang_schluessel", "STORNO_UNGUELTIG", "Ein Vorgang kann sich nicht selbst stornieren.", { grund: "selbst" });
      continue;
    }
    if (!original) continue; // liegt im Bestand: die API prüft dort gegen den gespeicherten Vorgang
    const { betrag: ob, art: oa, beteiligung_schluessel: obt, valuta: ov, storniert_vorgang_schluessel: os } = original.w;
    if (os !== undefined) melde("vorgaenge", z, "storniert_vorgang_schluessel", "STORNO_UNGUELTIG", "Ein Storno kann nicht selbst storniert werden.", { grund: "storno_von_storno" });
    if (ob !== undefined && !d(betrag).equals(d(ob).neg())) melde("vorgaenge", z, "betrag", "STORNO_UNGUELTIG", `Der Betrag eines Storno muss ${d(ob).neg().toFixed(2)} sein (negativer Betrag des Originals).`, { grund: "betrag", erwartet: d(ob).neg().toFixed(2) });
    if (oa !== undefined && oa !== art) melde("vorgaenge", z, "art", "STORNO_UNGUELTIG", "Ein Storno hat dieselbe Art wie das Original.", { grund: "art" });
    if (obt !== undefined && obt !== z.w.beteiligung_schluessel) melde("vorgaenge", z, "beteiligung_schluessel", "STORNO_UNGUELTIG", "Ein Storno gehört zur selben Beteiligung wie das Original.", { grund: "beteiligung" });
    if (ov !== undefined && z.w.valuta !== undefined && z.w.valuta < ov) melde("vorgaenge", z, "valuta", "STORNO_UNGUELTIG", `Die Valuta des Storno darf nicht vor der des Originals (${ov}) liegen.`, { grund: "valuta", erwartet: ov });
  }

  // 5. Bewertungen: Begründung außer bei Anschaffungskosten.
  for (const z of daten.bewertungen) {
    if (z.w.methode !== undefined && z.w.methode !== "anschaffungskosten" && !z.w.begruendung) {
      melde("bewertungen", z, "begruendung", "BEGRUENDUNG_FEHLT", "Für diese Methode ist eine Begründung erforderlich.", {});
    }
  }

  // 6. Konditionen: gewinnabhängiger Satz und Kappung nur zusammen.
  for (const z of daten.konditionen) {
    if ((z.w.gewinnabhaengig_satz === undefined) !== (z.w.kappung_satz === undefined)) {
      melde("konditionen", z, "kappung_satz", "KONDITION_GEWINN_PAAR", "Gewinnabhängiger Satz und Kappung nur gemeinsam angeben.");
    }
  }

  // 7. Kontrollsummen: der Stichtag gehört zum NAV; für die anderen Größen genügt die Summe.
  for (const z of daten.kontrollsummen) {
    if (z.w.groesse === "nav" && z.w.stichtag === undefined) melde("kontrollsummen", z, "stichtag", "KONTROLLSUMME_STICHTAG", "Der NAV braucht einen Stichtag; ohne ihn gilt der Standard-Stichtag des Fonds.", {}, "warnung");
  }

  return befunde;
}
