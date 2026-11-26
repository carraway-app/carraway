import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { beteiligung, gliederungPosition, kontenregel, organisation, saldenlauf, saldo, sachkonto, vorgang, type Saldenlauf } from "@carraway/db";
import { Decimal, rechneSicht, type Auswertung, type Position, type Regel, type Rechenschritt } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import { ladeInstrumentdaten } from "../instrumente/daten";
import { ohneStornoPaare } from "../kennzahlen/fonds";
import type { Tx } from "../zeitlimit";
import { geldlos } from "../instrumente/geldfluss";

/**
 * Auswertungen je Fonds und Zeitraum aus der übernommenen Saldenliste (Etappe 14) und die Abstimmungen gegen die Daten der Plattform.
 * Es gilt je Zeitraum (Ende) die neueste übernommene, nicht ersetzte Saldenliste.
 */

export type SichtName = "bilanz" | "guv" | "liquiditaet" | "mittelverwendung" | "portfolio";

/** Die gültige Saldenliste für das Periodenende; 409 `SALDENLISTE_FEHLT`, wenn es keine gibt. */
export async function aktiverLauf(tx: Tx, fondsId: string, bis: string): Promise<Saldenlauf> {
  const [lauf] = await tx
    .select()
    .from(saldenlauf)
    .where(and(eq(saldenlauf.fondsId, fondsId), eq(saldenlauf.zeitraumBis, bis), eq(saldenlauf.status, "uebernommen"), isNull(saldenlauf.ersetztAm)))
    .limit(1);
  if (!lauf) throw new Fachfehler(409, "SALDENLISTE_FEHLT", "Für diesen Zeitraum gibt es keine übernommene Saldenliste.", { bis });
  return lauf;
}

export async function ladeAuswertung(tx: Tx, lauf: Saldenlauf, sicht: SichtName): Promise<Auswertung> {
  const positionen = await tx.select().from(gliederungPosition).where(and(eq(gliederungPosition.fondsId, lauf.fondsId), eq(gliederungPosition.sicht, sicht))).orderBy(asc(gliederungPosition.reihenfolge));
  const regeln = await tx.select().from(kontenregel).where(and(eq(kontenregel.fondsId, lauf.fondsId), eq(kontenregel.sicht, sicht)));
  const salden = await tx.select({ konto: saldo.kontoNummer, bezeichnung: saldo.bezeichnung, saldo: saldo.saldo }).from(saldo).where(eq(saldo.laufId, lauf.id)).orderBy(asc(saldo.kontoNummer));
  const kontenrahmen = new Map((await tx.select({ n: sachkonto.nummer, b: sachkonto.bezeichnung }).from(sachkonto).where(eq(sachkonto.fondsId, lauf.fondsId))).map((k) => [k.n, k.b]));
  return rechneSicht({
    positionen: positionen as Position[],
    regeln: regeln.map((r): Regel => ({ id: r.id, kontoVon: r.kontoVon, kontoBis: r.kontoBis, positionSchluessel: r.positionSchluessel, gueltigAb: r.gueltigAb, gueltigBis: r.gueltigBis })),
    salden: salden.map((s) => ({ konto: s.konto, bezeichnung: s.bezeichnung ?? kontenrahmen.get(s.konto) ?? null, saldo: s.saldo })),
    stichtag: lauf.zeitraumBis,
  });
}

export interface AbstimmungsZeile {
  schluessel: string;
  bezeichnung: string;
  carraway: string;
  buchhaltung: string;
  differenz: string;
  /** Mit einem Konto verknüpft (Einzelabstimmung) oder nur im Gesamtvergleich. */
  verknuepft: boolean;
  schritte: Rechenschritt[];
}

export interface Abstimmung {
  portfolio: { zeilen: AbstimmungsZeile[]; gesamt: AbstimmungsZeile | null; ohneKonto: { beteiligungId: string; bezeichnung: string; buchwert: string }[] };
  liquiditaet: AbstimmungsZeile | null;
}

const cent = (d: Decimal) => d.toFixed(2);

/**
 * Portfolio: Buchwert je Beteiligung aus den Vorgängen (Entscheidung 66) zum Periodenende gegen die verknüpften Konten und im Gesamtvergleich
 * gegen die Sicht Portfolio. Zeilen mit Differenz stehen in der Liste (Differenz ≠ 0 erkennt die Oberfläche).
 */
export async function stimmePortfolioAb(tx: Tx, lauf: Saldenlauf, portfolioSicht: Auswertung): Promise<Abstimmung["portfolio"]> {
  const beteiligungen = await tx
    .select({ id: beteiligung.id, instrument: beteiligung.instrument, name: organisation.name })
    .from(beteiligung)
    .innerJoin(organisation, eq(organisation.id, beteiligung.organisationId))
    .where(and(eq(beteiligung.fondsId, lauf.fondsId), lte(beteiligung.erstinvestment, lauf.zeitraumBis)))
    .orderBy(asc(organisation.name), asc(beteiligung.id));
  const konten = await tx.select({ nummer: sachkonto.nummer, beteiligungId: sachkonto.beteiligungId }).from(sachkonto).where(and(eq(sachkonto.fondsId, lauf.fondsId), sql`${sachkonto.beteiligungId} IS NOT NULL`));
  const salden = new Map((await tx.select({ konto: saldo.kontoNummer, saldo: saldo.saldo }).from(saldo).where(eq(saldo.laufId, lauf.id))).map((s) => [s.konto, s.saldo]));
  const zeilen: AbstimmungsZeile[] = [];
  const ohneKonto: Abstimmung["portfolio"]["ohneKonto"] = [];
  let summeCarraway = new Decimal(0);
  for (const b of beteiligungen) {
    const daten = await ladeInstrumentdaten(tx, b.id, { stichtag: lauf.zeitraumBis });
    const buchwert = new Decimal(daten?.buchwert.wert ?? 0);
    summeCarraway = summeCarraway.plus(buchwert);
    const eigene = konten.filter((k) => k.beteiligungId === b.id);
    if (eigene.length === 0) {
      if (!buchwert.isZero()) ohneKonto.push({ beteiligungId: b.id, bezeichnung: `${b.name} (${b.instrument})`, buchwert: cent(buchwert) });
      continue;
    }
    const buch = eigene.reduce((s, k) => s.plus(salden.get(k.nummer) ?? 0), new Decimal(0));
    zeilen.push({
      schluessel: b.id,
      bezeichnung: `${b.name} (${b.instrument})`,
      carraway: cent(buchwert),
      buchhaltung: cent(buch),
      differenz: cent(buchwert.minus(buch)),
      verknuepft: true,
      schritte: [
        ...(daten?.buchwert.schritte ?? []).map((s) => ({ zeichen: s.zeichen, bezeichnung: s.bezeichnung, wert: s.wert })),
        ...eigene.map<Rechenschritt>((k) => ({ zeichen: "", bezeichnung: `Konto ${k.nummer}`, wert: new Decimal(salden.get(k.nummer) ?? 0).toFixed(2) })),
      ],
    });
  }
  const wurzel = portfolioSicht.zeilen.find((z) => z.ebene === 0);
  const buchGesamt = new Decimal(wurzel?.wert ?? 0);
  const gesamt: AbstimmungsZeile | null = wurzel
    ? {
        schluessel: wurzel.schluessel,
        bezeichnung: wurzel.bezeichnungDe,
        carraway: cent(summeCarraway),
        buchhaltung: cent(buchGesamt),
        differenz: cent(summeCarraway.minus(buchGesamt)),
        verknuepft: false,
        schritte: [
          { zeichen: "", bezeichnung: `Buchwerte der Beteiligungen (${beteiligungen.length}) zum ${lauf.zeitraumBis}`, wert: cent(summeCarraway) },
          { zeichen: "−", bezeichnung: `${wurzel.bezeichnungDe} laut Saldenliste`, wert: cent(buchGesamt) },
          { zeichen: "=", bezeichnung: "Differenz", wert: cent(summeCarraway.minus(buchGesamt)) },
        ],
      }
    : null;
  return { zeilen, gesamt, ohneKonto };
}

/**
 * Liquidität: Zahlungsstrom aus den Daten der Plattform (Abrufe − Ausschüttungen − Auszahlungen + Rückflüsse + Tilgungen + gezahlte Zinsen
 * + Dividenden, jeweils bis zum Periodenende; eine Zinsbuchung ist eine Forderung und keine Kasse) gegen das Guthaben bei Banken laut Saldenliste. Kosten und Gebühren des Fonds kennt die Plattform
 * nicht; sie erscheinen als Differenz.
 */
export async function stimmeLiquiditaetAb(tx: Tx, lauf: Saldenlauf, liquiditaet: Auswertung): Promise<AbstimmungsZeile | null> {
  const bank = liquiditaet.zeilen.find((z) => z.schluessel === "liq.bank") ?? liquiditaet.zeilen.find((z) => z.ebene === 0);
  if (!bank) return null;
  // Dieselbe Sicht wie die Fondskennzahlen (Etappe 4b): Ein Storno und sein Original fallen gemeinsam heraus (`ohneStornoPaare`).
  const { rows: bewegungen } = await tx.execute<{ art: string; summe: string }>(sql`
    SELECT fb.art::text AS art, coalesce(sum(fb.betrag), 0)::text AS summe
    FROM fonds_bewegung fb
    WHERE fb.fonds_id = ${lauf.fondsId} AND fb.valuta <= ${lauf.zeitraumBis}::date AND ${ohneStornoPaare("fb", lauf.zeitraumBis, undefined)}
    GROUP BY fb.art`);
  const b = (art: string) => new Decimal(bewegungen.find((x) => x.art === art)?.summe ?? 0);
  const ids = (await tx.select({ id: beteiligung.id }).from(beteiligung).where(eq(beteiligung.fondsId, lauf.fondsId))).map((x) => x.id);
  const vorgaenge = ids.length
    ? await tx
        .select({ art: vorgang.art, kapitalisiert: vorgang.kapitalisiert, summe: sql<string>`coalesce(sum(${vorgang.betrag}), 0)` })
        .from(vorgang)
        .where(and(inArray(vorgang.beteiligungId, ids), lte(vorgang.valuta, lauf.zeitraumBis), sql`NOT ${geldlos("vorgang")}`))
        .groupBy(vorgang.art, vorgang.kapitalisiert)
    : [];
  const v = (art: string, kapitalisiert?: boolean) => vorgaenge.filter((x) => x.art === art && (kapitalisiert === undefined || x.kapitalisiert === kapitalisiert)).reduce((s, x) => s.plus(x.summe), new Decimal(0));
  const abrufe = b("abruf");
  const ausschuettungen = b("ausschuettung");
  const auszahlungen = v("auszahlung");
  const rueckfluesse = v("rueckfluss");
  const tilgungen = v("tilgung");
  const zinszahlungen = v("zinszahlung");
  const dividenden = v("dividende");
  const carraway = abrufe.minus(ausschuettungen).minus(auszahlungen).plus(rueckfluesse).plus(tilgungen).plus(zinszahlungen).plus(dividenden);
  const buch = new Decimal(bank.wert);
  return {
    schluessel: bank.schluessel,
    bezeichnung: bank.bezeichnungDe,
    carraway: cent(carraway),
    buchhaltung: cent(buch),
    differenz: cent(carraway.minus(buch)),
    verknuepft: false,
    schritte: [
      { zeichen: "", bezeichnung: "Abrufe", wert: cent(abrufe) },
      { zeichen: "−", bezeichnung: "Ausschüttungen", wert: cent(ausschuettungen) },
      { zeichen: "−", bezeichnung: "Auszahlungen an Beteiligungen", wert: cent(auszahlungen) },
      { zeichen: "+", bezeichnung: "Rückflüsse", wert: cent(rueckfluesse) },
      { zeichen: "+", bezeichnung: "Tilgungen", wert: cent(tilgungen) },
      { zeichen: "+", bezeichnung: "Gezahlte Zinsen", wert: cent(zinszahlungen) },
      { zeichen: "+", bezeichnung: "Dividenden", wert: cent(dividenden) },
      { zeichen: "=", bezeichnung: "Zahlungsstrom laut Plattform", wert: cent(carraway) },
      { zeichen: "−", bezeichnung: `${bank.bezeichnungDe} laut Saldenliste`, wert: cent(buch) },
      { zeichen: "=", bezeichnung: "Differenz (u. a. Kosten und Gebühren des Fonds)", wert: cent(carraway.minus(buch)) },
    ],
  };
}
