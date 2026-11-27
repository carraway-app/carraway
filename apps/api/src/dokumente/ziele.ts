import { eq, sql, type SQL } from "drizzle-orm";
import { beteiligung, bewertung, deal, finanzierungsrunde, fonds, organisation, vorgang, type FondsRolle } from "@carraway/db";
import { fuerBereich, hatIrgendwoRolle, hatRolle, hatRolleOhneFonds, sichtbareFonds, type Akteur } from "../anmeldung/akteur";
import { hatBereich, type Bereich } from "../rechte/bereiche";
import { Fachfehler } from "../fehler";
import { liste } from "../import/sql";
import type { Tx } from "../zeitlimit";

/**
 * Rechte an Dokumenten folgen den Zielen, mit denen ein Dokument verknüpft ist: Ein Dokument sieht, wer mindestens ein verknüpftes Ziel
 * sehen darf; hochladen oder verknüpfen darf, wer an jedem Ziel Bearbeiter ist. Ein Ziel gehört zu einem Fonds (Beteiligung, Vorgang,
 * Bewertung, Fonds, Deal mit Fonds), zu den Fonds, die eine Beteiligung am Unternehmen halten (Organisation, Finanzierungsrunde), oder zu
 * keinem Fonds (Deal vor der Zuordnung: genügt die Rolle irgendwo). Organisationen ohne Beteiligung sehen nur globale Verwalter.
 *
 * Ziele eines anderen Bereichs verlangen zusätzlich diesen Bereich (`ZIEL_BEREICH`, docs/permissions-model.md): Deals Dealflow, Beteiligungen,
 * Vorgänge, Bewertungen und Finanzierungsrunden Portfolio, jeweils mit der Stufe an demselben Fonds wie die Stufe der Route. Schreiben ohne
 * den Bereich am Ziel antwortet mit 403, beim Lesen bleibt ein solches Ziel unsichtbar.
 */

export const ZIEL_TYPEN = ["beteiligung", "deal", "vorgang", "organisation", "fonds", "bewertung", "finanzierungsrunde"] as const;
export type ZielTyp = (typeof ZIEL_TYPEN)[number];

export interface Ziel {
  typ: ZielTyp;
  id: string;
}

/**
 * Bereich, den ein Ziel zusätzlich zum Bereich der Route verlangt; `null` = keiner. Fonds und Organisationen verlangen bewusst keinen
 * Bereich (Issue #87): Sie sind über die Stufe in Dokumente am Fonds bzw. an einem haltenden Fonds geschützt, und das Dokument gibt über sie
 * nichts preis, was an Kontakte, Portfolio oder Fondsverwaltung hängt. Der SQL-Filter `zielSichtbar` folgt dieser Zuordnung.
 */
export const ZIEL_BEREICH: Record<ZielTyp, Bereich | null> = {
  beteiligung: "portfolio",
  vorgang: "portfolio",
  bewertung: "portfolio",
  finanzierungsrunde: "portfolio",
  deal: "dealflow",
  organisation: null,
  fonds: null,
};

/** Fonds, über die ein Ziel geschützt ist, und der Bereich, den es zusätzlich verlangt. */
export type ZielFonds = ({ art: "fonds"; ids: string[] } | { art: "irgendwo" }) & { bereich: Bereich | null };

const nurFonds = (ids: (string | null | undefined)[], bereich: Bereich | null): ZielFonds => ({ art: "fonds", ids: ids.filter((i): i is string => !!i), bereich });

async function halterFonds(tx: Tx, organisationId: string, bereich: Bereich | null): Promise<ZielFonds> {
  const zeilen = await tx.selectDistinct({ f: beteiligung.fondsId }).from(beteiligung).where(eq(beteiligung.organisationId, organisationId));
  return nurFonds(zeilen.map((z) => z.f), bereich);
}

/** Fonds des Ziels; `null`, wenn es das Ziel nicht gibt. */
export async function ladeZielFonds(tx: Tx, ziel: Ziel): Promise<ZielFonds | null> {
  const b = ZIEL_BEREICH[ziel.typ];
  switch (ziel.typ) {
    case "fonds": {
      const [z] = await tx.select({ id: fonds.id }).from(fonds).where(eq(fonds.id, ziel.id));
      return z ? nurFonds([z.id], b) : null;
    }
    case "beteiligung": {
      const [z] = await tx.select({ f: beteiligung.fondsId }).from(beteiligung).where(eq(beteiligung.id, ziel.id));
      return z ? nurFonds([z.f], b) : null;
    }
    case "vorgang": {
      const [z] = await tx.select({ f: beteiligung.fondsId }).from(vorgang).innerJoin(beteiligung, eq(beteiligung.id, vorgang.beteiligungId)).where(eq(vorgang.id, ziel.id));
      return z ? nurFonds([z.f], b) : null;
    }
    case "bewertung": {
      const [z] = await tx.select({ f: beteiligung.fondsId }).from(bewertung).innerJoin(beteiligung, eq(beteiligung.id, bewertung.beteiligungId)).where(eq(bewertung.id, ziel.id));
      return z ? nurFonds([z.f], b) : null;
    }
    case "deal": {
      const [z] = await tx.select({ f: deal.fondsId }).from(deal).where(eq(deal.id, ziel.id));
      if (!z) return null;
      return z.f ? nurFonds([z.f], b) : { art: "irgendwo", bereich: b };
    }
    case "organisation": {
      const [z] = await tx.select({ id: organisation.id }).from(organisation).where(eq(organisation.id, ziel.id));
      return z ? halterFonds(tx, z.id, b) : null;
    }
    case "finanzierungsrunde": {
      const [z] = await tx.select({ o: finanzierungsrunde.organisationId }).from(finanzierungsrunde).where(eq(finanzierungsrunde.id, ziel.id));
      return z ? halterFonds(tx, z.o, b) : null;
    }
  }
}

/**
 * Hat die Person am Ziel mindestens die Rolle? Globale Verwalter ja; bei mehreren haltenden Fonds genügt einer. Verlangt das Ziel einen Bereich,
 * braucht die Person ihn mit derselben Stufe an demselben Fonds (Bereiche je Fonds); ein Deal ohne Fonds verlangt die Stufe im Dealflow wie
 * dessen Routen (auch aus einer Gruppe ohne Fonds).
 */
export function darfZiel(akteur: Akteur, zf: ZielFonds, mindest: FondsRolle): boolean {
  if (akteur.globalVerwalter) return true;
  const b = zf.bereich;
  if (b && !hatBereich(akteur, b)) return false;
  if (zf.art === "irgendwo") return hatIrgendwoRolle(akteur, mindest) && (!b || hatRolleOhneFonds(fuerBereich(akteur, b), mindest));
  return zf.ids.some((f) => hatRolle(akteur, f, mindest) && (!b || hatRolle(akteur, f, mindest, b)));
}

/** Die Ziele, die die Person mit mindestens der Rolle sieht (inklusive Bereich); Ziele, die es nicht mehr gibt, entfallen. Zum Ausblenden statt Fehler. */
export async function sichtbareZiele(tx: Tx, akteur: Akteur, ziele: readonly Ziel[], mindest: FondsRolle = "betrachter"): Promise<Ziel[]> {
  const ergebnis: Ziel[] = [];
  for (const ziel of ziele) {
    const zf = await ladeZielFonds(tx, ziel);
    if (zf !== null && darfZiel(akteur, zf, mindest)) ergebnis.push(ziel);
  }
  return ergebnis;
}

const keineBerechtigung = () => new Fachfehler(403, "forbidden", "Permission for at least one of the linked targets is missing.");

/**
 * Verlangt für jedes Ziel die Rolle; 404 `target_not_found`, wenn es ein Ziel nicht gibt, 403, wenn die Person es nicht darf.
 * Gibt die aufgelösten Fonds je Ziel zurück.
 */
export async function verlangeZiele(tx: Tx, akteur: Akteur, ziele: readonly Ziel[], mindest: FondsRolle): Promise<ZielFonds[]> {
  const aufgeloest: ZielFonds[] = [];
  for (const ziel of ziele) {
    const zf = await ladeZielFonds(tx, ziel);
    if (zf === null) throw new Fachfehler(404, "target_not_found", "The target of the link does not exist.");
    if (!darfZiel(akteur, zf, mindest)) throw keineBerechtigung();
    aufgeloest.push(zf);
  }
  return aufgeloest;
}

/** Fonds je Bereich der Ziele, an denen die Person die Stufe der Route und die Stufe im Bereich hat (Schnitt), als SQL-Listen. */
interface ZielListen {
  ohne: SQL;
  portfolio: SQL;
  kennzahlen: SQL;
  dealflow: SQL;
  /** Deals ohne Fonds sichtbar? */
  dealOhneFonds: boolean;
}

function zielListen(akteur: Akteur, route: string[], mindest: FondsRolle): ZielListen {
  const schnitt = (b: Bereich): string[] => {
    if (!hatBereich(akteur, b)) return [];
    const imBereich = sichtbareFonds(akteur, mindest, b);
    return imBereich === "alle" ? route : route.filter((f) => imBereich.includes(f));
  };
  return {
    ohne: liste(route, "uuid"),
    portfolio: liste(schnitt("portfolio"), "uuid"),
    kennzahlen: liste(schnitt("kennzahlen"), "uuid"),
    dealflow: liste(schnitt("dealflow"), "uuid"),
    dealOhneFonds: darfZiel(akteur, { art: "irgendwo", bereich: ZIEL_BEREICH.deal }, mindest),
  };
}

/** Bedingung für ein Ziel (Typ- und ID-Spalte) und die Fonds je Bereich, in SQL. Die Zuordnung zum Bereich folgt `ZIEL_BEREICH`. */
function zielSichtbar(typ: SQL, id: SQL, l: ZielListen): SQL {
  const frei = l.dealOhneFonds ? sql`true` : sql`false`;
  return sql`CASE ${typ}
    WHEN 'fonds' THEN ${id} = ANY(${l.ohne})
    WHEN 'beteiligung' THEN EXISTS (SELECT 1 FROM beteiligung b WHERE b.id = ${id} AND b.fonds_id = ANY(${l.portfolio}))
    WHEN 'vorgang' THEN EXISTS (SELECT 1 FROM vorgang x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = ${id} AND b.fonds_id = ANY(${l.portfolio}))
    WHEN 'bewertung' THEN EXISTS (SELECT 1 FROM bewertung x JOIN beteiligung b ON b.id = x.beteiligung_id WHERE x.id = ${id} AND b.fonds_id = ANY(${l.portfolio}))
    WHEN 'deal' THEN EXISTS (SELECT 1 FROM deal x WHERE x.id = ${id} AND (x.fonds_id = ANY(${l.dealflow}) OR (x.fonds_id IS NULL AND ${frei})))
    WHEN 'organisation' THEN EXISTS (SELECT 1 FROM beteiligung b WHERE b.organisation_id = ${id} AND b.fonds_id = ANY(${l.ohne}))
    WHEN 'finanzierungsrunde' THEN EXISTS (SELECT 1 FROM finanzierungsrunde r JOIN beteiligung b ON b.organisation_id = r.organisation_id WHERE r.id = ${id} AND b.fonds_id = ANY(${l.portfolio}))
    ELSE false
  END`;
}

/**
 * Bedingung „die Person sieht dieses Dokument“ für `dokumentId` (SQL-Ausdruck mit der Dokument-ID, z. B. `d.id`): mindestens ein verknüpftes Ziel
 * ist sichtbar, samt Bereich des Ziels. Für globale Verwalter immer wahr.
 */
export function dokumentSichtbar(akteur: Akteur, dokumentId: SQL, mindest: FondsRolle = "betrachter"): SQL {
  const fondsIds = sichtbareFonds(akteur, mindest);
  if (fondsIds === "alle") return sql`true`;
  return sql`EXISTS (SELECT 1 FROM dokument_verknuepfung v WHERE v.dokument_id = ${dokumentId} AND ${zielSichtbar(sql`v.ziel_typ::text`, sql`v.ziel_id`, zielListen(akteur, fondsIds, mindest))})`;
}

/** Bedingung „die Person sieht dieses eine Ziel“ (Typ- und ID-Spalte als SQL-Ausdruck), für die Auswahl der sichtbaren Verknüpfungen eines Dokuments. */
export function zielSichtbarFuer(akteur: Akteur, typ: SQL, id: SQL, mindest: FondsRolle = "betrachter"): SQL {
  const fondsIds = sichtbareFonds(akteur, mindest);
  if (fondsIds === "alle") return sql`true`;
  return zielSichtbar(typ, id, zielListen(akteur, fondsIds, mindest));
}

/**
 * Bedingung „die Person sieht das Objekt dieser Fundstelle“ (`wert_quelle.objekt_typ` und `objekt_id` als SQL-Ausdruck). Fundstellen hängen auch an
 * Objekten, die kein Dokumentziel sind; sie folgen dem Ziel, zu dem sie gehören: Rundenposition und Anteilsklasse wie eine Finanzierungsrunde
 * (Portfolio, haltende Fonds), Darlehenskondition wie ihre Beteiligung, Registereintrag wie seine Organisation, Kennzahlenwert wie seine Beteiligung (Bereich Kennzahlen). Unbekannte Typen sind unsichtbar.
 */
export function fundstelleSichtbarFuer(akteur: Akteur, typ: SQL, id: SQL, mindest: FondsRolle = "betrachter"): SQL {
  const fondsIds = sichtbareFonds(akteur, mindest);
  if (fondsIds === "alle") return sql`true`;
  const l = zielListen(akteur, fondsIds, mindest);
  return sql`CASE ${typ}
    WHEN 'rundenposition' THEN EXISTS (SELECT 1 FROM rundenposition p JOIN finanzierungsrunde r ON r.id = p.runde_id JOIN beteiligung b ON b.organisation_id = r.organisation_id WHERE p.id = ${id} AND b.fonds_id = ANY(${l.portfolio}))
    WHEN 'anteilsklasse' THEN EXISTS (SELECT 1 FROM anteilsklasse k JOIN beteiligung b ON b.organisation_id = k.organisation_id WHERE k.id = ${id} AND b.fonds_id = ANY(${l.portfolio}))
    WHEN 'darlehen_kondition' THEN EXISTS (SELECT 1 FROM darlehen_kondition k JOIN beteiligung b ON b.id = k.beteiligung_id WHERE k.id = ${id} AND b.fonds_id = ANY(${l.portfolio}))
    WHEN 'registereintrag' THEN EXISTS (SELECT 1 FROM registereintrag e JOIN beteiligung b ON b.organisation_id = e.organisation_id WHERE e.id = ${id} AND b.fonds_id = ANY(${l.ohne}))
    WHEN 'kennzahl_wert' THEN EXISTS (SELECT 1 FROM kennzahl_wert kw JOIN beteiligung b ON b.id = kw.beteiligung_id WHERE kw.id = ${id} AND b.fonds_id = ANY(${l.kennzahlen}))
    ELSE ${zielSichtbar(typ, id, l)}
  END`;
}

/** Anzeigename eines Ziels (Typ- und ID-Spalte als SQL-Ausdruck) für Listen. */
export function zielName(typ: SQL, id: SQL): SQL {
  return sql`CASE ${typ}
    WHEN 'fonds' THEN (SELECT f.name FROM fonds f WHERE f.id = ${id})
    WHEN 'beteiligung' THEN (SELECT o.name || ' (' || f.kurzname || ')' FROM beteiligung b JOIN organisation o ON o.id = b.organisation_id JOIN fonds f ON f.id = b.fonds_id WHERE b.id = ${id})
    WHEN 'vorgang' THEN (SELECT x.art::text || ' ' || x.valuta::text || ', ' || o.name FROM vorgang x JOIN beteiligung b ON b.id = x.beteiligung_id JOIN organisation o ON o.id = b.organisation_id WHERE x.id = ${id})
    WHEN 'bewertung' THEN (SELECT 'Bewertung ' || x.stichtag::text || ', ' || o.name FROM bewertung x JOIN beteiligung b ON b.id = x.beteiligung_id JOIN organisation o ON o.id = b.organisation_id WHERE x.id = ${id})
    WHEN 'deal' THEN (SELECT x.titel FROM deal x WHERE x.id = ${id})
    WHEN 'organisation' THEN (SELECT o.name FROM organisation o WHERE o.id = ${id})
    WHEN 'finanzierungsrunde' THEN (SELECT r.bezeichnung || ', ' || o.name FROM finanzierungsrunde r JOIN organisation o ON o.id = r.organisation_id WHERE r.id = ${id})
  END`;
}

/** Dokument-IDs, die die Person sehen darf, aus einer Menge von IDs. */
export async function sichtbareDokumentIds(tx: Tx, akteur: Akteur, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { rows } = await tx.execute<{ id: string }>(sql`SELECT d.id FROM dokument d WHERE d.id = ANY(${liste(ids, "uuid")}) AND ${dokumentSichtbar(akteur, sql`d.id`)}`);
  return new Set(rows.map((r) => r.id));
}
