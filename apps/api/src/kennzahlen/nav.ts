import { Decimal, type Rechenschritt } from "@carraway/rechenkern";
import { sql } from "drizzle-orm";
import type { Tx } from "../zeitlimit";

type Abfrage = Pick<Tx, "execute">;
type Gruppe = "portfolio" | "bank" | "sonstiges" | "schulden" | "eigenkapital";
type SaldoPosition = {
  id: string;
  laufId: string;
  konto: string;
  bezeichnung: string | null;
  gruppe: Gruppe | null;
  saldo: string;
};
export interface PortfolioPosition {
  beteiligungId: string;
  bewertungId: string;
  wert: string;
  bezeichnung: string;
  datum: string;
}

export const NAV_LUECKE = "Saldenliste fehlt oder ist unvollständig";

/** Gilt einschließlich Übernahme und bis zur Ersetzung. Keine Fortschreibung älterer Salden. */
export function navLauf(fondsId: string, stichtag: string, stand?: string) {
  return sql`SELECT id FROM saldenlauf WHERE fonds_id = ${fondsId}
    AND zeitraum_bis = ${stichtag}::date AND status = 'uebernommen'
    AND ${stand === undefined ? sql`ersetzt_am IS NULL` : sql`uebernommen_am <= ${stand}::timestamptz AND (ersetzt_am IS NULL OR ersetzt_am > ${stand}::timestamptz)`}
    ORDER BY uebernommen_am DESC, id LIMIT 1`;
}

/** Einzelkonten bleiben intern. Die Fondsübersicht bekommt nur die Summen der Bilanzgruppen. */
/**
 * `zielfonds`: Wert der Anteile an Zielfonds (Dachfonds) samt Herkunftsschritt; nur gesetzt, wenn der Fonds Zielfondsbeteiligungen hat. Sonst bleiben NAV und
 * Herkunft wie bisher. Die Saldenliste führt solche Anteile wie Beteiligungen in der Gruppe „portfolio“, die hier nicht zählt (der Wert kommt aus der Rechnung).
 */
export async function ermittleNavBestandteile(tx: Abfrage, fondsId: string, stichtag: string, stand: string | undefined, portfolio: PortfolioPosition[], zielfonds?: { wert: Decimal; schritt: Rechenschritt } | null) {
  const { rows } = await tx.execute<SaldoPosition>(sql`
    SELECT id, lauf_id AS "laufId", konto_nummer AS konto, bezeichnung, nav_gruppe AS gruppe, saldo::text
    FROM saldo WHERE lauf_id = (${navLauf(fondsId, stichtag, stand)}) ORDER BY konto_nummer`);
  const portfoliowert = portfolio.reduce((s, p) => s.plus(p.wert), new Decimal(0));
  const summe = (gruppe: Gruppe) => rows.reduce((s, p) => p.gruppe === gruppe ? s.plus(p.saldo) : s, new Decimal(0));
  // Die Saldenliste enthält Kaufpreisforderungen bereits unter den übrigen Aktiva.
  const bank = summe("bank");
  const sonstiges = summe("sonstiges");
  const schulden = summe("schulden").neg();
  const komplett = rows.some((p) => p.gruppe === "bank") && rows.every((p) => p.gruppe !== null || new Decimal(p.saldo).isZero());
  const zielwert = zielfonds?.wert ?? new Decimal(0);
  const nav = komplett ? portfoliowert.plus(zielwert).plus(bank).plus(sonstiges).minus(schulden) : null;
  const schritte: Rechenschritt[] = [
    { zeichen: "", bezeichnung: "Portfoliowert", wert: portfoliowert.toString(), quellen: portfolio.map((p) => p.beteiligungId) },
  ];
  if (zielfonds) schritte.push(zielfonds.schritt);
  if (komplett) {
    schritte.push(
      { zeichen: "+", bezeichnung: "Bankguthaben laut Saldenliste", wert: bank.toString() },
      { zeichen: "+", bezeichnung: "Weitere Vermögenswerte einschließlich Forderungen", wert: sonstiges.toString() },
      { zeichen: "−", bezeichnung: "Verbindlichkeiten und Rückstellungen", wert: schulden.toString() },
    );
  } else {
    schritte.push({ zeichen: "", bezeichnung: NAV_LUECKE, wert: "—" });
  }
  schritte.push({ zeichen: "=", bezeichnung: "Fonds-NAV", wert: nav?.toString() ?? "—" });
  return { portfolio, salden: rows, portfoliowert, zielfondswert: zielfonds ? zielwert : null, nav, schritte };
}
