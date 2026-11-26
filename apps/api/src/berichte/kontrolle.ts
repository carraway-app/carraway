import { eq, sql } from "drizzle-orm";
import type { Bericht } from "@carraway/db";
import { fonds } from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import { berechneFondsUebersicht, bisStand, wirksameBewertung } from "../kennzahlen/fonds";
import type { Tx } from "../zeitlimit";
import { navLauf, NAV_LUECKE } from "../kennzahlen/nav";
import { ladeKapitalkonten } from "./daten";
import { geldlos } from "../instrumente/geldfluss";
import { berichtsartAusErweiterung } from "./arten";

/**
 * Kontrollbericht der Berichtsdaten vor der Freigabe. Jede Prüfung trägt einen stabilen `code` und `params` (übersetzbar,
 * Entscheidung 82) neben dem deutschen Text. Die Gegenrechnung läuft über eigene SQL-Abfragen, nicht über den Rechenweg des Berichts.
 */

export interface Pruefung {
  schluessel: string;
  code: string;
  bezeichnung: string;
  status: "ok" | "abweichung";
  params: Record<string, unknown>;
  details?: unknown[];
}

export interface Kontrollbericht {
  berichtId: string;
  stichtag: string;
  /** Wissensstand der Prüfung (ISO) oder `null` für den aktuellen Stand. */
  stand: string | null;
  gesamt: "ok" | "abweichung";
  pruefungen: Pruefung[];
}

type Abfrage = Pick<Tx, "execute" | "select">;
const FONDS_ARTEN: Bericht["art"][] = ["fondsbericht", "lp_bericht", "portfolioliste", "exitliste"];

export function pruefung(schluessel: string, code: string, bezeichnung: string, abweichungen: unknown[], params: Record<string, unknown> = {}): Pruefung {
  return {
    schluessel,
    code,
    bezeichnung,
    status: abweichungen.length === 0 ? "ok" : "abweichung",
    params: abweichungen.length ? { ...params, anzahl: abweichungen.length } : params,
    ...(abweichungen.length ? { details: abweichungen } : {}),
  };
}

const gleich = (a: Decimal.Value, b: Decimal.Value) => new Decimal(a).equals(b);

async function fondsPruefungen(tx: Abfrage, b: Bericht, fondsId: string, stichtag: string, stand: string | undefined): Promise<Pruefung[]> {
  const uebersicht = await berechneFondsUebersicht(tx, fondsId, stichtag, stand);
  const [f] = await tx.select().from(fonds).where(eq(fonds.id, fondsId));
  const ergebnis: Pruefung[] = [];

  // 1. Summe der Portfoliozeilen gleich Summen aus den Vorgängen (unabhängig, ohne Filter auf das Erstinvestment)
  const { rows: summen } = await tx.execute<{ zusage: string; investiert: string; rueckfluesse: string }>(sql`
    SELECT coalesce(sum(v.betrag) FILTER (WHERE v.art = 'zusage' AND NOT ${geldlos("v")}), 0)::text AS zusage,
           coalesce(sum(v.betrag) FILTER (WHERE v.art = 'auszahlung' AND NOT ${geldlos("v")}), 0)::text AS investiert,
           coalesce(sum(v.betrag) FILTER (WHERE v.art IN ('rueckfluss', 'tilgung', 'zinszahlung', 'dividende') AND NOT ${geldlos("v")}), 0)::text AS rueckfluesse
    FROM vorgang v JOIN beteiligung be ON be.id = v.beteiligung_id
    WHERE be.fonds_id = ${fondsId} AND v.valuta <= ${stichtag}::date${bisStand(sql.raw("v.erfasst_am"), stand)}`);
  const s = summen[0]!;
  const zeilenSumme = (feld: "zusage" | "investiert" | "rueckfluesse") => uebersicht.beteiligungen.reduce((x, z) => x.plus(z[feld]), new Decimal(0));
  const abweichend = (["zusage", "investiert", "rueckfluesse"] as const)
    .filter((k) => !gleich(zeilenSumme(k), s[k]))
    .map((k) => ({ feld: k, portfolio: zeilenSumme(k).toFixed(2), vorgaenge: new Decimal(s[k]).toFixed(2) }));
  ergebnis.push(pruefung("portfolio_summe", "PORTFOLIO_SUMME_ABWEICHUNG", "Summe der Portfoliozeilen entspricht den Summen der Vorgänge des Fonds", abweichend));

  // Gegenwert auf der Passivseite, unabhängig von den Bewertungen und den NAV-Summen.
  const { rows: eigenkapital } = await tx.execute<{ wert: string | null }>(sql`
    SELECT (-sum(saldo))::text AS wert FROM saldo
    WHERE lauf_id = (${navLauf(fondsId, stichtag, stand)}) AND nav_gruppe = 'eigenkapital'`);
  const navBericht = uebersicht.kennzahlen.nav.wert;
  const buchhaltung = eigenkapital[0]?.wert ?? null;
  if (navBericht === null || buchhaltung === null) {
    ergebnis.push(pruefung("nav_summe", "NAV_SALDEN_FEHLEN", NAV_LUECKE, [{ stichtag }]));
  } else {
    const differenz = new Decimal(navBericht).minus(buchhaltung);
    ergebnis.push(pruefung("nav_summe", "NAV_ABWEICHUNG", "Fonds-NAV und Eigenkapital laut Saldenliste stimmen überein",
      differenz.isZero() ? [] : [{ nav: new Decimal(navBericht).toFixed(2), eigenkapital: buchhaltung, differenz: differenz.toFixed(2) }]));
  }

  // 3. Jede aktive Beteiligung hat eine freigegebene Bewertung zum Stichtag
  const { rows: ohne } = await tx.execute<{ id: string; name: string }>(sql`
    SELECT be.id, o.name FROM beteiligung be JOIN organisation o ON o.id = be.organisation_id
    WHERE be.fonds_id = ${fondsId} AND be.status = 'aktiv' AND be.erstinvestment <= ${stichtag}::date
      AND NOT EXISTS (SELECT 1 FROM bewertung bw WHERE bw.beteiligung_id = be.id AND bw.stichtag = ${stichtag}::date AND ${wirksameBewertung("bw", stand)})
    ORDER BY o.name, be.id`);
  ergebnis.push(pruefung("bewertung_je_beteiligung", "BEWERTUNG_FEHLT", "Jede aktive Beteiligung hat eine freigegebene Bewertung zum Stichtag", ohne.map((z) => ({ beteiligungId: z.id, organisation: z.name }))));

  // 4. Abrufe höchstens Zeichnungskapital
  const abgerufen = new Decimal(uebersicht.kennzahlen.abgerufen.wert ?? 0);
  ergebnis.push(
    pruefung(
      "abrufe_zeichnung",
      "ABRUFE_UEBER_ZEICHNUNG",
      "Die Abrufe übersteigen das Zeichnungskapital nicht",
      abgerufen.greaterThan(f?.zeichnungskapital ?? 0) ? [{ abgerufen: abgerufen.toFixed(2), zeichnungskapital: f?.zeichnungskapital }] : [],
    ),
  );

  // 5. Keine Entwürfe zum Stichtag
  const { rows: entwuerfe } = await tx.execute<{ id: string; name: string }>(sql`
    SELECT bw.id, o.name FROM bewertung bw JOIN beteiligung be ON be.id = bw.beteiligung_id JOIN organisation o ON o.id = be.organisation_id
    WHERE be.fonds_id = ${fondsId} AND bw.stichtag = ${stichtag}::date AND bw.status = 'entwurf'
    ORDER BY o.name, bw.id`);
  ergebnis.push(pruefung("keine_entwuerfe", "ENTWURF_BEWERTUNG_OFFEN", "Zum Stichtag gibt es keine Bewertungsentwürfe", entwuerfe.map((z) => ({ bewertungId: z.id, organisation: z.name }))));

  // 6. LP-Bericht: Zeichnungen und Kapitalkonten stimmen mit dem Fonds überein
  if (b.art === "lp_bericht") {
    const konten = await ladeKapitalkonten(tx, fondsId, stichtag, stand, navBericht);
    const summe = (feld: "zusage" | "abgerufen" | "ausgeschuettet" | "navAnteil") => konten.reduce((x, k) => x.plus(k[feld] ?? 0), new Decimal(0));
    const { rows: bew } = await tx.execute<{ abruf: string; ausschuettung: string }>(sql`
      SELECT coalesce(sum(betrag) FILTER (WHERE art = 'abruf'), 0)::text AS abruf, coalesce(sum(betrag) FILTER (WHERE art = 'ausschuettung'), 0)::text AS ausschuettung
      FROM fonds_bewegung WHERE fonds_id = ${fondsId} AND valuta <= ${stichtag}::date${bisStand(sql.raw("erfasst_am"), stand)}`);
    const soll = { zusage: f?.zeichnungskapital ?? "0", abgerufen: bew[0]?.abruf ?? "0", ausgeschuettet: bew[0]?.ausschuettung ?? "0", navAnteil: navBericht };
    const abw = (["zusage", "abgerufen", "ausgeschuettet", "navAnteil"] as const)
      .filter((k) => soll[k] !== null && !gleich(summe(k), soll[k]))
      .map((k) => ({ feld: k, kapitalkonten: summe(k).toFixed(2), fonds: new Decimal(soll[k]!).toFixed(2) }));
    ergebnis.push(pruefung("kapitalkonten_summe", "KAPITALKONTEN_ABWEICHUNG", "Die Kapitalkonten der Investoren ergeben die Summen des Fonds", konten.length === 0 ? [{ feld: "zeichnungen", hinweis: "keine Zeichnungen erfasst" }] : abw));
  }
  return ergebnis;
}

async function beteiligungPruefungen(tx: Abfrage, beteiligungId: string, stichtag: string, stand: string | undefined): Promise<Pruefung[]> {
  const { rows } = await tx.execute<{ aktiv: boolean; hat: boolean; entwurf: boolean }>(sql`
    SELECT be.status = 'aktiv' AS aktiv,
      EXISTS (SELECT 1 FROM bewertung bw WHERE bw.beteiligung_id = be.id AND bw.stichtag = ${stichtag}::date AND ${wirksameBewertung("bw", stand)}) AS hat,
      EXISTS (SELECT 1 FROM bewertung bw WHERE bw.beteiligung_id = be.id AND bw.stichtag = ${stichtag}::date AND bw.status = 'entwurf') AS entwurf
    FROM beteiligung be WHERE be.id = ${beteiligungId}`);
  const r = rows[0];
  return [
    pruefung("bewertung_je_beteiligung", "BEWERTUNG_FEHLT", "Die aktive Beteiligung hat eine freigegebene Bewertung zum Stichtag", r?.aktiv && !r.hat ? [{ beteiligungId }] : []),
    pruefung("keine_entwuerfe", "ENTWURF_BEWERTUNG_OFFEN", "Zum Stichtag gibt es keinen Bewertungsentwurf", r?.entwurf ? [{ beteiligungId }] : []),
  ];
}

/** Kontrollbericht zu einem Bericht. Gremienvorlagen haben keine Zahlenprüfungen und sind immer in Ordnung. */
export async function kontrolliereBericht(tx: Abfrage, b: Bericht, stand: string | undefined): Promise<Kontrollbericht> {
  let pruefungen: Pruefung[];
  if (FONDS_ARTEN.includes(b.art) && b.fondsId) pruefungen = await fondsPruefungen(tx, b, b.fondsId, b.stichtag, stand);
  else if (b.art === "quartalsbericht" && b.beteiligungId) pruefungen = await beteiligungPruefungen(tx, b.beteiligungId, b.stichtag, stand);
  else pruefungen = (await berichtsartAusErweiterung(b.art)?.pruefungen?.(tx, b, stand)) ?? [];
  return {
    berichtId: b.id,
    stichtag: b.stichtag,
    stand: stand ? new Date(stand).toISOString() : null,
    gesamt: pruefungen.every((p) => p.status === "ok") ? "ok" : "abweichung",
    pruefungen,
  };
}
