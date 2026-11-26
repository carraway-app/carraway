import { and, asc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { aktivitaet, aktivitaetSync, deal, organisation, person, type Db } from "@carraway/db";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { pruefe } from "../pruefung";
import { dealSichtbar } from "../rechte/sichtbarkeit";
import { lese } from "../zeitlimit";

/**
 * Nächste Termine (Etappe 17): synchronisierte Termine mit bekannten Kontakten, die noch nicht begonnen haben, zeitlich aufsteigend. Für
 * Organisations-, Personen- und Dealseiten (Filter) und die Übersicht (`eigene=true`: nur Termine aus dem eigenen Kalender). Sichtbar ist, was die
 * CRM-Regeln erlauben: Termine zu Deals fremder Fonds erscheinen nicht.
 */

const abfrage = z.object({
  organisationId: z.uuid().optional(),
  personId: z.uuid().optional(),
  dealId: z.uuid().optional(),
  eigene: z.enum(["true", "false"]).default("false"),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export function terminRouten(db: Db) {
  return new Hono().get("/", pruefe("query", abfrage), async (c) => {
    const { organisationId, personId, dealId, eigene, limit } = c.req.valid("query");
    const akteur = aktuellerAkteur(c);
    const sichtbar = dealSichtbar(c);
    const zeilen = await lese(db, (tx) =>
      tx
        .select({
          id: aktivitaet.id,
          titel: aktivitaet.titel,
          datum: aktivitaet.datum,
          beginn: aktivitaetSync.beginn,
          ende: aktivitaetSync.ende,
          anbieter: aktivitaetSync.anbieter,
          eigene: sql<boolean>`${aktivitaetSync.benutzerId} = ${akteur.id}`,
          organisation: { id: organisation.id, name: organisation.name },
          person: { id: person.id, vorname: person.vorname, nachname: person.nachname },
          deal: { id: deal.id, titel: deal.titel },
        })
        .from(aktivitaet)
        .innerJoin(aktivitaetSync, eq(aktivitaetSync.aktivitaetId, aktivitaet.id))
        .leftJoin(deal, eq(deal.id, aktivitaet.dealId))
        .leftJoin(organisation, eq(organisation.id, sql`coalesce(${aktivitaet.organisationId}, ${deal.organisationId})`))
        .leftJoin(person, eq(person.id, aktivitaet.personId))
        .where(
          and(
            eq(aktivitaet.art, "termin"),
            gte(aktivitaetSync.beginn, new Date()),
            eigene === "true" ? eq(aktivitaetSync.benutzerId, akteur.id) : undefined,
            dealId ? eq(aktivitaet.dealId, dealId) : undefined,
            personId ? or(eq(aktivitaet.personId, personId), sql`${aktivitaetSync.personIds} @> ${JSON.stringify([personId])}::jsonb`) : undefined,
            organisationId
              ? or(eq(aktivitaet.organisationId, organisationId), inArray(aktivitaet.dealId, tx.select({ id: deal.id }).from(deal).where(eq(deal.organisationId, organisationId))))
              : undefined,
            sichtbar ? or(isNull(aktivitaet.dealId), sichtbar) : undefined,
          ),
        )
        .orderBy(asc(aktivitaetSync.beginn), asc(aktivitaet.id))
        .limit(limit),
    );
    return c.json({ daten: zeilen }, 200);
  });
}
