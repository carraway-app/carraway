import { and, asc, eq, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Context } from "hono";
import { fonds, organisation, organisationsbeziehung } from "@carraway/db";
import { fondsSichtbar } from "../rechte/sichtbarkeit";
import type { Tx } from "../zeitlimit";

export type BeziehungsZeile = {
  id: string;
  art: (typeof organisationsbeziehung.$inferSelect)["art"];
  /** `aus`: diese Organisation ist Subjekt (z. B. Co-Investor von X), `ein`: eine andere bezieht sich auf diese. */
  richtung: "aus" | "ein";
  bemerkung: string | null;
  organisation: { id: string; name: string } | null;
  fonds: { id: string; name: string; kurzname: string } | null;
};

/** Beziehungen einer Organisation in beide Richtungen; Beziehungen zu Fonds ohne Rolle der Person bleiben verborgen. */
export async function ladeBeziehungen(tx: Tx, c: Context, organisationId: string): Promise<BeziehungsZeile[]> {
  const sichtbar = fondsSichtbar(c, organisationsbeziehung.fondsId);
  const fondsBedingung = sichtbar ? or(isNull(organisationsbeziehung.fondsId), sichtbar) : undefined;
  const ziel = alias(organisation, "ziel_organisation");
  const quelle = alias(organisation, "quell_organisation");
  const aus = await tx
    .select({
      id: organisationsbeziehung.id,
      art: organisationsbeziehung.art,
      bemerkung: organisationsbeziehung.bemerkung,
      organisation: { id: ziel.id, name: ziel.name },
      fonds: { id: fonds.id, name: fonds.name, kurzname: fonds.kurzname },
    })
    .from(organisationsbeziehung)
    .leftJoin(ziel, eq(ziel.id, organisationsbeziehung.zuOrganisationId))
    .leftJoin(fonds, eq(fonds.id, organisationsbeziehung.fondsId))
    .where(and(eq(organisationsbeziehung.vonOrganisationId, organisationId), fondsBedingung))
    .orderBy(asc(organisationsbeziehung.art), asc(organisationsbeziehung.id));
  const ein = await tx
    .select({
      id: organisationsbeziehung.id,
      art: organisationsbeziehung.art,
      bemerkung: organisationsbeziehung.bemerkung,
      organisation: { id: quelle.id, name: quelle.name },
    })
    .from(organisationsbeziehung)
    .innerJoin(quelle, eq(quelle.id, organisationsbeziehung.vonOrganisationId))
    .where(eq(organisationsbeziehung.zuOrganisationId, organisationId))
    .orderBy(asc(organisationsbeziehung.art), asc(organisationsbeziehung.id));
  return [
    ...aus.map((z) => ({ ...z, richtung: "aus" as const, organisation: z.organisation?.id ? z.organisation : null, fonds: z.fonds?.id ? z.fonds : null })),
    ...ein.map((z) => ({ ...z, richtung: "ein" as const, fonds: null })),
  ];
}
