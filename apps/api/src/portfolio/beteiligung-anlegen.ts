import { beteiligung, instrumentArt, organisation } from "@carraway/db";
import { and, asc, eq, ilike, isNull } from "drizzle-orm";
import { z } from "zod";
import { Fachfehler } from "../fehler";
import { legeHauptinstrumentAn } from "../instrumente/hauptinstrument";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";

export const beteiligungEingabe = z.object({
  organisationId: z.uuid(),
  instrument: z.enum(instrumentArt.enumValues).exclude(["optionsschein"]),
  erstinvestment: z.iso.date().refine((datum) => datum >= "0001-01-01", "Expected a date in year 1 or later"),
});

const aktivesUnternehmen = and(eq(organisation.art, "unternehmen"), isNull(organisation.archiviertAm), isNull(organisation.zusammengefuehrtIn));
const fondsBeteiligung = (fondsId: string) => and(eq(beteiligung.fondsId, fondsId), eq(beteiligung.organisationId, organisation.id));

/** Liefert für die Auswahl nur Unternehmensnamen, Ort und die Beteiligung des gewählten Fonds. */
export function sucheBeteiligungsunternehmen(tx: Tx, fondsId: string, q: string) {
  const muster = `%${q.replace(/[\\%_]/g, (z) => `\\${z}`)}%`;
  return tx.select({ id: organisation.id, name: organisation.name, ort: organisation.ort, beteiligungId: beteiligung.id })
    .from(organisation)
    .leftJoin(beteiligung, fondsBeteiligung(fondsId))
    .where(and(aktivesUnternehmen, ilike(organisation.name, muster)))
    .orderBy(asc(organisation.name), asc(organisation.id))
    .limit(25);
}

export async function legeBeteiligungDirektAn(tx: Tx, protokoll: Protokollant, fondsId: string, eingabe: z.output<typeof beteiligungEingabe>) {
  const [unternehmen] = await tx.select({ id: organisation.id }).from(organisation)
    .where(and(aktivesUnternehmen, eq(organisation.id, eingabe.organisationId))).for("share");
  if (!unternehmen) throw new Fachfehler(404, "organization_not_found", "Company not found.");

  const [neu] = await tx.insert(beteiligung).values({ fondsId, ...eingabe })
    .onConflictDoNothing({ target: [beteiligung.fondsId, beteiligung.organisationId] }).returning();
  if (!neu) {
    const [vorhanden] = await tx.select({ id: beteiligung.id }).from(beteiligung)
      .where(and(eq(beteiligung.fondsId, fondsId), eq(beteiligung.organisationId, eingabe.organisationId)));
    throw new Fachfehler(409, "investment_exists", "The fund already holds this company.", { beteiligungId: vorhanden?.id });
  }

  await protokoll("anlegen", "beteiligung", neu.id, null, neu);
  await legeHauptinstrumentAn(tx, neu);
  return { id: neu.id, fondsId: neu.fondsId, erstinvestment: neu.erstinvestment };
}
