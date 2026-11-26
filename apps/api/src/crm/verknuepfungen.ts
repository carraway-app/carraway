import { and, eq, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import { datensatzLink, deal, organisation, person } from "@carraway/db";
import { dealSichtbar } from "../rechte/sichtbarkeit";
import type { Tx } from "../zeitlimit";
import { feldArray, type Objekt } from "./felder";

/**
 * Erwähnungen in Notizen: `@[Anzeigename](typ:id)`. Die Oberfläche setzt die Zeichenfolge beim Auswählen eines Datensatzes im Textfeld ein;
 * sie wird dort als Link dargestellt, nie als HTML. Die Anzeige im Text ist nur Beschriftung, maßgeblich ist die ID.
 */
const ERWAEHNUNG = /@\[([^\]\n]{1,200})\]\((organisation|person|deal):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/g;

export interface Erwaehnung {
  typ: Objekt;
  id: string;
  anzeige: string;
}

export function leseErwaehnungen(text: string | null | undefined): Erwaehnung[] {
  if (!text) return [];
  const gesehen = new Set<string>();
  const aus: Erwaehnung[] = [];
  for (const m of text.matchAll(ERWAEHNUNG)) {
    const schluessel = `${m[2]}:${m[3]}`;
    if (gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    aus.push({ typ: m[2] as Objekt, id: m[3]!, anzeige: m[1]! });
  }
  return aus.slice(0, 50);
}

const TABELLE = { organisation, person, deal } as const;

/**
 * Legt die Verknüpfungen einer Notiz neu an: von jedem Datensatz, an dem die Aktivität hängt, zu jedem erwähnten Datensatz, der es gibt.
 * Verweise auf nicht vorhandene Datensätze entfallen stillschweigend (der Text bleibt, es entsteht kein Link).
 */
export async function schreibeErwaehnungen(tx: Tx, aktivitaetId: string, von: { typ: Objekt; id: string }[], notiz: string | null | undefined) {
  await tx.delete(datensatzLink).where(and(eq(datensatzLink.art, "erwaehnung"), eq(datensatzLink.quelleId, aktivitaetId)));
  const erwaehnt = leseErwaehnungen(notiz);
  if (erwaehnt.length === 0 || von.length === 0) return;
  const gueltig: Erwaehnung[] = [];
  for (const e of erwaehnt) {
    const t = TABELLE[e.typ];
    const [z] = await tx.select({ id: t.id }).from(t).where(eq(t.id, e.id));
    if (z) gueltig.push(e);
  }
  const zeilen = von.flatMap((v) => gueltig.filter((e) => !(e.typ === v.typ && e.id === v.id)).map((e) => ({ vonTyp: v.typ, vonId: v.id, zuTyp: e.typ, zuId: e.id, art: "erwaehnung", quelleId: aktivitaetId })));
  if (zeilen.length) await tx.insert(datensatzLink).values(zeilen).onConflictDoNothing();
}

export interface Verweis {
  typ: Objekt;
  id: string;
  name: string;
  art: "relation" | "erwaehnung";
  quelleId: string;
}

/** Namen der verknüpften Datensätze; Deals fremder Fonds fehlen (und damit der Verweis). */
async function benenne(tx: Tx, c: Context, zeilen: { typ: Objekt; id: string; art: string; quelleId: string }[]): Promise<Verweis[]> {
  const namen = new Map<string, string>();
  const nachTyp = (typ: Objekt) => [...new Set(zeilen.filter((z) => z.typ === typ).map((z) => z.id))];
  const orgIds = nachTyp("organisation");
  const personIds = nachTyp("person");
  const dealIds = nachTyp("deal");
  if (orgIds.length) for (const r of (await tx.execute<{ id: string; name: string }>(sql`SELECT id, name FROM ${organisation} WHERE id = ANY(${feldArray(orgIds, "uuid")}) AND archiviert_am IS NULL`)).rows) namen.set(`organisation:${r.id}`, r.name);
  if (personIds.length) for (const r of (await tx.execute<{ id: string; name: string }>(sql`SELECT id, vorname || ' ' || nachname AS name FROM ${person} WHERE id = ANY(${feldArray(personIds, "uuid")}) AND archiviert_am IS NULL`)).rows) namen.set(`person:${r.id}`, r.name);
  if (dealIds.length) {
    const sichtbar = dealSichtbar(c);
    for (const r of (await tx.execute<{ id: string; name: string }>(sql`SELECT id, titel AS name FROM ${deal} WHERE id = ANY(${feldArray(dealIds, "uuid")}) ${sichtbar ? sql`AND (${sichtbar})` : sql``}`)).rows) namen.set(`deal:${r.id}`, r.name);
  }
  return zeilen.flatMap((z) => {
    const name = namen.get(`${z.typ}:${z.id}`);
    return name === undefined ? [] : [{ typ: z.typ, id: z.id, name, art: z.art as Verweis["art"], quelleId: z.quelleId }];
  });
}

/** Ein- und ausgehende Verknüpfungen eines Datensatzes („verknüpft mit“). */
export async function ladeVerknuepfungen(tx: Tx, c: Context, typ: Objekt, id: string) {
  const eingehend = await tx
    .select({ typ: datensatzLink.vonTyp, id: datensatzLink.vonId, art: datensatzLink.art, quelleId: datensatzLink.quelleId })
    .from(datensatzLink)
    .where(and(eq(datensatzLink.zuTyp, typ), eq(datensatzLink.zuId, id)))
    .limit(200);
  const ausgehend = await tx
    .select({ typ: datensatzLink.zuTyp, id: datensatzLink.zuId, art: datensatzLink.art, quelleId: datensatzLink.quelleId })
    .from(datensatzLink)
    .where(and(eq(datensatzLink.vonTyp, typ), eq(datensatzLink.vonId, id), or(eq(datensatzLink.art, "relation"), eq(datensatzLink.art, "erwaehnung"))))
    .limit(200);
  return { eingehend: await benenne(tx, c, eingehend), ausgehend: await benenne(tx, c, ausgehend) };
}
