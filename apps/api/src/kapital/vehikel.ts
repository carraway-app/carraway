import { and, asc, eq, sql } from "drizzle-orm";
import { organisation, vehikel } from "@carraway/db";
import { sichtbareFonds, type Akteur } from "../anmeldung/akteur";
import { feldArray } from "../crm/felder";
import { Fachfehler } from "../fehler";
import { ladeOrganisation, type Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";

/**
 * Vehikel der Co-Investoren (docs/portfolio-model.md, „Co-investor vehicles“): Ein Vehikel ist der Fonds oder die Gesellschaft eines Investors,
 * die tatsächlich investiert. Positionen Dritter hängen an einem Vehikel; der Investor ist der des Vehikels.
 */

export type VehikelZeile = typeof vehikel.$inferSelect;

export const vehikelNichtGefunden = () => new Fachfehler(404, "vehicle_not_found", "Vehicle not found.");

/** Lädt ein Vehikel (mit `sperren` bis zum Ende der Transaktion gesperrt), 404 wenn es fehlt. */
export async function ladeVehikel(tx: Tx, id: string, sperren = false): Promise<VehikelZeile> {
  const abfrage = tx.select().from(vehikel).where(eq(vehikel.id, id));
  const [zeile] = sperren ? await abfrage.for("update") : await abfrage;
  if (!zeile) throw vehikelNichtGefunden();
  return zeile;
}

/** Ein Name ist je Investor nur einmal vergeben (der Index prüft es ebenfalls; hier mit verständlichem Fehler). */
export async function verlangeNameFrei(tx: Tx, investorId: string, name: string, ausser?: string): Promise<void> {
  const [vorhanden] = await tx
    .select({ id: vehikel.id })
    .from(vehikel)
    .where(and(eq(vehikel.investorId, investorId), eq(vehikel.name, name)));
  if (vorhanden && vorhanden.id !== ausser) {
    throw new Fachfehler(409, "vehicle_name_taken", "The investor already has a vehicle with this name.", { felder: [{ feld: "name", code: "taken", meldung: "Name already taken" }] });
  }
}

/**
 * Standard-Vehikel eines Investors; fehlt es, entsteht es mit dem Namen des Investors (Art `fonds`) und steht im Änderungsprotokoll. Gilt für jede
 * Organisation, auch ohne Kennzeichen `investor` (Positionen, die nur die Organisation nennen: ältere Aufrufe, Datenübernahme, KI-Auslesung).
 */
export async function standardVehikel(tx: Tx, protokoll: Protokollant, organisationId: string): Promise<VehikelZeile> {
  const [vorhanden] = await tx
    .select()
    .from(vehikel)
    .where(and(eq(vehikel.investorId, organisationId), eq(vehikel.standard, true)));
  if (vorhanden) return vorhanden;
  const org = await ladeOrganisation(tx, organisationId);
  // Gibt es schon Vehikel, aber keines als Standard, wird das älteste zum Standard; sonst entsteht ein neues mit dem Namen des Investors.
  const [aeltestes] = await tx.select().from(vehikel).where(eq(vehikel.investorId, org.id)).orderBy(asc(vehikel.erstelltAm), asc(vehikel.id)).limit(1);
  if (aeltestes) {
    const [neu] = await tx.update(vehikel).set({ standard: true }).where(eq(vehikel.id, aeltestes.id)).returning();
    await protokoll("aendern", "vehikel", aeltestes.id, aeltestes, neu);
    return neu!;
  }
  const [neu] = await tx.insert(vehikel).values({ investorId: org.id, name: org.name, standard: true }).returning();
  if (!neu) throw new Error("Vehikel nicht angelegt");
  await protokoll("anlegen", "vehikel", neu.id, null, neu);
  return neu;
}

/** Vehikel einer neuen Position: ausdrücklich (`vehikelId`) oder das Standard-Vehikel der Organisation (`organisationId`). */
export async function vehikelDerPosition(tx: Tx, protokoll: Protokollant, p: { vehikelId?: string | undefined; organisationId?: string | undefined }): Promise<VehikelZeile> {
  if (p.vehikelId) return ladeVehikel(tx, p.vehikelId);
  if (p.organisationId) return standardVehikel(tx, protokoll, p.organisationId);
  throw new Error("Position ohne Vehikel und ohne Organisation");
}

/** Neue Vehikel verlangen einen Investor mit dem Kennzeichen `investor`. */
export async function verlangeInvestor(tx: Tx, organisationId: string) {
  const org = await ladeOrganisation(tx, organisationId);
  if (org.art !== "investor") throw new Fachfehler(409, "vehicle_not_investor", "Vehicles exist only for organizations marked as investors.");
  return org;
}

/** Auswahlliste: Vehikel mit Investor, gesucht in Vehikel- und Investornamen; archivierte und zusammengeführte Investoren fehlen. */
export async function sucheVehikel(tx: Tx, w: { suche?: string | undefined; investorId?: string | undefined; limit: number }) {
  const muster = w.suche ? `%${w.suche.replace(/[\\%_]/g, (z) => `\\${z}`)}%` : null;
  return tx
    .select({
      id: vehikel.id,
      name: vehikel.name,
      art: vehikel.art,
      auflagejahr: vehikel.auflagejahr,
      status: vehikel.status,
      standard: vehikel.standard,
      investor: { id: organisation.id, name: organisation.name },
    })
    .from(vehikel)
    .innerJoin(organisation, eq(organisation.id, vehikel.investorId))
    .where(
      and(
        sql`${organisation.archiviertAm} IS NULL AND ${organisation.zusammengefuehrtIn} IS NULL`,
        w.investorId ? eq(vehikel.investorId, w.investorId) : undefined,
        muster ? sql`(${vehikel.name} ILIKE ${muster} OR ${organisation.name} ILIKE ${muster})` : undefined,
      ),
    )
    .orderBy(asc(organisation.name), sql`${vehikel.standard} DESC`, asc(vehikel.name), asc(vehikel.id))
    .limit(w.limit);
}

export interface VehikelPosition {
  id: string;
  rundeId: string;
  runde: string;
  datum: string;
  status: "entwurf" | "abgeschlossen";
  unternehmen: { id: string; name: string };
  betrag: string;
  anteile: string;
  rolle: "lead" | "co_lead" | "co";
}

/**
 * Vehikel eines Investors mit Anzahl und (mit `mitPositionen`) Liste ihrer Positionen. Eine Position erscheint nur, wenn die Person die Runde auch in der
 * Rundenliste des Unternehmens sähe: Rolle an einem Fonds mit Beteiligung am Unternehmen, mit Position in einer abgeschlossenen Runde des Unternehmens
 * oder mit Position in genau dieser Runde. Globale Verwalter sehen alle.
 */
export async function ladeVehikelDesInvestors(tx: Tx, akteur: Akteur, investorId: string, mitPositionen: boolean) {
  const liste = await tx.select().from(vehikel).where(eq(vehikel.investorId, investorId)).orderBy(sql`${vehikel.standard} DESC`, asc(vehikel.name), asc(vehikel.id));
  if (liste.length === 0) return [];
  // Positionen sind Rundendaten: Sichtbar sind Fonds, an denen die Person den Bereich Portfolio hat (der Akteur ist sonst auf Kontakte festgelegt).
  const fonds = sichtbareFonds(akteur, "betrachter", "portfolio");
  const f = fonds === "alle" ? null : feldArray(fonds, "uuid");
  const sichtbar =
    f === null
      ? sql`true`
      : fonds.length === 0
        ? sql`false`
        : sql`(
            EXISTS (SELECT 1 FROM beteiligung b WHERE b.organisation_id = r.organisation_id AND b.fonds_id = ANY(${f}))
            OR EXISTS (SELECT 1 FROM rundenposition p2 JOIN finanzierungsrunde r2 ON r2.id = p2.runde_id
                       WHERE r2.organisation_id = r.organisation_id AND r2.status = 'abgeschlossen' AND p2.fonds_id = ANY(${f}))
            OR EXISTS (SELECT 1 FROM rundenposition p3 WHERE p3.runde_id = r.id AND p3.fonds_id = ANY(${f})))`;
  const { rows } = mitPositionen
    ? await tx.execute<{ id: string; vehikel_id: string; runde_id: string; runde: string; datum: string; status: "entwurf" | "abgeschlossen"; unternehmen_id: string; unternehmen: string; betrag: string; anteile: string; rolle: "lead" | "co_lead" | "co" }>(sql`
        SELECT p.id, p.vehikel_id, r.id AS runde_id, r.bezeichnung AS runde, r.datum::text AS datum, r.status::text AS status, o.id AS unternehmen_id, o.name AS unternehmen,
               p.betrag::text AS betrag, p.anteile::text AS anteile, p.rolle::text AS rolle
        FROM rundenposition p
        JOIN finanzierungsrunde r ON r.id = p.runde_id
        JOIN organisation o ON o.id = r.organisation_id
        JOIN vehikel v ON v.id = p.vehikel_id
        WHERE v.investor_id = ${investorId} AND ${sichtbar}
        ORDER BY r.datum DESC, o.name, p.id`)
    : { rows: [] };
  const { rows: anzahl } = await tx.execute<{ vehikel_id: string; n: number }>(sql`
    SELECT p.vehikel_id, count(*)::int AS n FROM rundenposition p JOIN finanzierungsrunde r ON r.id = p.runde_id JOIN vehikel v ON v.id = p.vehikel_id
    WHERE v.investor_id = ${investorId} AND ${sichtbar} GROUP BY p.vehikel_id`);
  const anzahlJe = new Map(anzahl.map((z) => [z.vehikel_id, z.n]));
  return liste.map((v) => ({
    id: v.id,
    investorId: v.investorId,
    name: v.name,
    art: v.art,
    auflagejahr: v.auflagejahr,
    status: v.status,
    standard: v.standard,
    /** Anzahl der sichtbaren Positionen (wie `positionen`, auch ohne `mitPositionen`); ob sich das Vehikel löschen lässt, prüft der Server an allen Positionen. */
    anzahlPositionen: anzahlJe.get(v.id) ?? 0,
    positionen: rows
      .filter((p) => p.vehikel_id === v.id)
      .map(
        (p): VehikelPosition => ({
          id: p.id,
          rundeId: p.runde_id,
          runde: p.runde,
          datum: p.datum,
          status: p.status,
          unternehmen: { id: p.unternehmen_id, name: p.unternehmen },
          betrag: p.betrag,
          anteile: p.anteile.replace(/\.0+$/, ""),
          rolle: p.rolle,
        }),
      ),
  }));
}
