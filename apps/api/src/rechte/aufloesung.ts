import { eq, sql, type SQL } from "drizzle-orm";
import { nutzergruppe, nutzergruppeMitglied, nutzergruppeRolle, rechterolle, wirksameFondsrolle, wirksamesBereichsrecht, type FondsRolle } from "@carraway/db";
import type { Tx } from "../zeitlimit";
import { stufenJeBereichAnApi } from "./api-namen";
import { BEREICHE, hoehereStufe, istBereich, niedrigereStufe, type Bereich } from "./bereiche";

/** Wirksame Rechte einer Person aus eigenen Fondsrollen, Gruppen und Rollen (docs/permissions-model.md, „Resolve effective permissions“). */
export interface WirksameRechte {
  /** Stufe je Fonds über alle Bereiche: die eigene Fondsrolle, sonst die höchste Stufe der Gruppen, deren Fondszugriff den Fonds umfasst. */
  rollen: Map<string, FondsRolle>;
  /** Bereiche aus den Rollen aller Gruppen der Person; `null` ohne Gruppe (alle Bereiche, wie vor dem Rechtemodell). */
  bereiche: Set<Bereich> | null;
  /** Höchste Stufe der Gruppen, auch ohne Fonds (Anzeige in `/me`). `null` ohne Gruppe. Die Prüfung nutzt `stufeOhneFondsJeBereich`. */
  stufeOhneFonds: FondsRolle | null;
  /** Stufe je Fonds und Bereich aus der Sicht `wirksames_bereichsrecht`; `null` ohne Gruppe (dann gilt `rollen` für jeden Bereich). */
  stufen: Map<string, Map<Bereich, FondsRolle>> | null;
  /** Stufe je Bereich für Daten ohne Fonds (Kontakte, Deals vor der Zuordnung); `null` ohne Gruppe. */
  stufeOhneFondsJeBereich: Map<Bereich, FondsRolle> | null;
}

/**
 * SQL-Bedingung „die Person mit der ID in `benutzerId` hat den Bereich irgendwo“: globale Verwalter, Personen ohne Gruppe (alle Bereiche) oder
 * eine Rolle einer ihrer Gruppen enthält ihn. Für Auswahlen ohne angemeldete Person (Empfänger von Mails). Mit `fonds` zählt nur die Stufe an
 * genau diesem Fonds und Bereich (Sicht `wirksames_bereichsrecht`, Bereiche je Fonds), mindestens `mindest`.
 */
export function hatBereichSql(benutzerId: unknown, bereich: Bereich, fonds?: { fondsId: unknown; mindest?: FondsRolle }): SQL {
  const global = sql`EXISTS (SELECT 1 FROM benutzer b WHERE b.id = ${benutzerId} AND b.global_verwalter)`;
  if (fonds) {
    // Die Rechte für den Fonds einmal ermitteln. Ein korreliertes EXISTS kann die komplexe Sicht je Empfänger erneut auswerten.
    return sql`(${global} OR ${benutzerId} IN (SELECT w.benutzer_id FROM ${wirksamesBereichsrecht} w WHERE w.fonds_id = ${fonds.fondsId}
      AND (w.bereich IS NULL OR w.bereich = ${bereich}) AND w.rolle >= ${fonds.mindest ?? "betrachter"}::fonds_rolle))`;
  }
  return sql`(${global}
    OR NOT EXISTS (SELECT 1 FROM nutzergruppe_mitglied m WHERE m.benutzer_id = ${benutzerId})
    OR EXISTS (SELECT 1 FROM nutzergruppe_mitglied m JOIN nutzergruppe_rolle gr ON gr.gruppe_id = m.gruppe_id JOIN rechterolle r ON r.id = gr.rolle_id
      WHERE m.benutzer_id = ${benutzerId} AND ${bereich} = ANY(r.bereiche)))`;
}

/** Eine Zeile je Gruppe und Rolle der Person (Rolle leer bei einer Gruppe ohne Rolle). */
export interface GruppenZeile {
  gruppeId: string;
  stufe: FondsRolle;
  jeFonds: boolean;
  bereiche: string[] | null;
  grenzen: Record<string, FondsRolle> | null;
}

/**
 * Bereiche und Stufe ohne Fonds aus den Gruppen. Fondsübergreifende Gruppen wie bisher: höchste Stufe aller dieser Gruppen für jeden ihrer
 * Bereiche (höchstens bis zur Grenze der Rolle). Gruppen mit Bereichen je Fonds: je Gruppe das Minimum aus ihrer Stufe und der Grenze.
 */
export function ausGruppen(zeilen: GruppenZeile[]): Pick<WirksameRechte, "bereiche" | "stufeOhneFonds" | "stufeOhneFondsJeBereich"> {
  if (zeilen.length === 0) return { bereiche: null, stufeOhneFonds: null, stufeOhneFondsJeBereich: null };
  let stufeOhneFonds: FondsRolle | null = null;
  let stufeAlt: FondsRolle | null = null;
  const grenzeAlt = new Map<Bereich, FondsRolle>();
  const jeBereich = new Map<Bereich, FondsRolle>();
  // Grenze je Gruppe und Bereich: höchste Grenze ihrer Rollen (ohne Eintrag: Verwalter).
  const jeGruppe = new Map<string, { stufe: FondsRolle; jeFonds: boolean; grenzen: Map<Bereich, FondsRolle> }>();
  for (const z of zeilen) {
    stufeOhneFonds = hoehereStufe(stufeOhneFonds, z.stufe);
    const g = jeGruppe.get(z.gruppeId) ?? { stufe: z.stufe, jeFonds: z.jeFonds, grenzen: new Map<Bereich, FondsRolle>() };
    jeGruppe.set(z.gruppeId, g);
    for (const b of z.bereiche ?? []) if (istBereich(b)) g.grenzen.set(b, hoehereStufe(g.grenzen.get(b) ?? null, z.grenzen?.[b] ?? "verwalter")!);
  }
  for (const g of jeGruppe.values()) {
    if (g.jeFonds) {
      for (const [b, grenze] of g.grenzen) jeBereich.set(b, hoehereStufe(jeBereich.get(b) ?? null, niedrigereStufe(g.stufe, grenze))!);
    } else {
      stufeAlt = hoehereStufe(stufeAlt, g.stufe);
      for (const [b, grenze] of g.grenzen) grenzeAlt.set(b, hoehereStufe(grenzeAlt.get(b) ?? null, grenze)!);
    }
  }
  if (stufeAlt) for (const [b, grenze] of grenzeAlt) jeBereich.set(b, hoehereStufe(jeBereich.get(b) ?? null, niedrigereStufe(stufeAlt, grenze))!);
  const bereiche = new Set<Bereich>(BEREICHE.filter((b) => grenzeAlt.has(b) || [...jeGruppe.values()].some((g) => g.jeFonds && g.grenzen.has(b))));
  return { bereiche, stufeOhneFonds, stufeOhneFondsJeBereich: jeBereich };
}

/** Drei Abfragen: die Sichten `wirksame_fondsrolle` und `wirksames_bereichsrecht` (nur mit Gruppe) und die Gruppen mit ihren Rollen. */
export async function ladeRechte(tx: Tx, benutzerId: string): Promise<WirksameRechte> {
  const zeilen = await tx.select({ fondsId: wirksameFondsrolle.fondsId, rolle: wirksameFondsrolle.rolle }).from(wirksameFondsrolle).where(eq(wirksameFondsrolle.benutzerId, benutzerId));
  const gruppen = await tx
    .select({ gruppeId: nutzergruppe.id, stufe: nutzergruppe.stufe, jeFonds: nutzergruppe.bereicheJeFonds, bereiche: rechterolle.bereiche, grenzen: rechterolle.bereichStufen })
    .from(nutzergruppeMitglied)
    .innerJoin(nutzergruppe, eq(nutzergruppe.id, nutzergruppeMitglied.gruppeId))
    .leftJoin(nutzergruppeRolle, eq(nutzergruppeRolle.gruppeId, nutzergruppe.id))
    .leftJoin(rechterolle, eq(rechterolle.id, nutzergruppeRolle.rolleId))
    .where(eq(nutzergruppeMitglied.benutzerId, benutzerId));
  const rollen = new Map(zeilen.map((z) => [z.fondsId, z.rolle] as const));
  const ausDenGruppen = ausGruppen(gruppen);
  if (ausDenGruppen.bereiche === null) return { rollen, ...ausDenGruppen, stufen: null };
  const recht = await tx
    .select({ fondsId: wirksamesBereichsrecht.fondsId, bereich: wirksamesBereichsrecht.bereich, rolle: wirksamesBereichsrecht.rolle })
    .from(wirksamesBereichsrecht)
    .where(eq(wirksamesBereichsrecht.benutzerId, benutzerId));
  const stufen = new Map<string, Map<Bereich, FondsRolle>>();
  for (const r of recht) {
    // Zeilen ohne Bereich gibt es nur für Personen ohne Gruppe; diese Person hat eine Gruppe.
    if (r.bereich === null || !istBereich(r.bereich)) continue;
    const jeFonds = stufen.get(r.fondsId) ?? new Map<Bereich, FondsRolle>();
    stufen.set(r.fondsId, jeFonds);
    jeFonds.set(r.bereich, r.rolle);
  }
  return { rollen, ...ausDenGruppen, stufen };
}

/**
 * Stufen je Fonds und Bereich für `/me` und `/users/:id/permissions` (englische Namen, `rechte/api-namen.ts`): `null` ohne Unterscheidung
 * nach Bereich (keine Gruppe, globale Verwalter); dann gilt die Stufe am Fonds aus `roles` für jeden Bereich aus `areas`.
 */
export function bereicheJeFondsAuszug(r: { globalVerwalter: boolean; stufen: ReadonlyMap<string, ReadonlyMap<Bereich, FondsRolle>> | null; stufeOhneFondsJeBereich: ReadonlyMap<Bereich, FondsRolle> | null }) {
  if (r.globalVerwalter || r.stufen === null) return { areaLevelsPerFund: null, levelWithoutFundPerArea: null };
  const areaLevelsPerFund: Record<string, Record<string, string>> = {};
  for (const [fondsId, jeBereich] of [...r.stufen].sort(([a], [b]) => a.localeCompare(b))) {
    areaLevelsPerFund[fondsId] = stufenJeBereichAnApi(Object.fromEntries(BEREICHE.filter((b) => jeBereich.has(b)).map((b) => [b, jeBereich.get(b)!])));
  }
  const ohne = r.stufeOhneFondsJeBereich ?? new Map<Bereich, FondsRolle>();
  return { areaLevelsPerFund, levelWithoutFundPerArea: stufenJeBereichAnApi(Object.fromEntries(BEREICHE.filter((b) => ohne.has(b)).map((b) => [b, ohne.get(b)!]))) };
}
