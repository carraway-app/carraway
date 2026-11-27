import { sourceActive } from "../rechte/sichtbarkeit";
import { kontaktJson, pruefeKontakt } from "../kontakte/http";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { aktivitaet, aktivitaetArt, aktivitaetSync, benutzer, deal, organisation, person, syncAusschluss, type Db } from "@carraway/db";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { schreibeErwaehnungen } from "../crm/verknuepfungen";
import { Fachfehler } from "../fehler";
import { aktivitaetMitHerkunft } from "../postfach/abgleich";
import { protokollSicht } from "../postfach/sync";
import { hatBereich } from "../rechte/bereiche";
import { dealSichtbar } from "../rechte/sichtbarkeit";
import { heute, idParam, ladeDeal, ladeOrganisation, ladePerson, optionalerText, schreibe, textEingabe } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";

const neueAktivitaet = z
  .object({
    art: z.enum(aktivitaetArt.enumValues),
    datum: z.iso.date(),
    titel: textEingabe(300),
    notiz: optionalerText(20000),
    organisationId: z.uuid().optional(),
    personId: z.uuid().optional(),
    dealId: z.uuid().optional(),
    wiedervorlage: z.iso.date().optional(),
    /** Wer die Wiedervorlage bearbeitet; ohne Angabe die anlegende Person. Nur mit `wiedervorlage`. */
    zustaendigId: z.uuid().optional(),
  })
  .refine((w) => w.organisationId || w.personId || w.dealId, {
    message: "At least one link (organizationId, personId or dealId) must be given",
    path: ["organisationId"],
  })
  .refine((w) => w.zustaendigId === undefined || w.wiedervorlage !== undefined, { message: "assigneeId requires followUp", path: ["zustaendigId"] });

export function aktivitaetRouten(db: Db) {
  return new Hono()
    .get(
      "/",
      pruefeKontakt(
        "query",
        z.object({ dealId: z.uuid().optional(), organisationId: z.uuid().optional(), personId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }),
      ),
      async (c) => {
        const { dealId, organisationId, personId, limit } = c.req.valid("query");
        const dealsichtbar = dealSichtbar(c);
        const akteur = aktuellerAkteur(c);
        const zeilen = await lese(db, (tx) =>
          tx
            .select(aktivitaetMitHerkunft(akteur.id))
            .from(aktivitaet)
            .leftJoin(aktivitaetSync, eq(aktivitaetSync.aktivitaetId, aktivitaet.id))
            .where(and(sourceActive("note", aktivitaet.id), dealId ? eq(aktivitaet.dealId, dealId) : undefined, personId ? or(eq(aktivitaet.personId, personId), sql`${aktivitaetSync.personIds} @> ${JSON.stringify([personId])}::jsonb`) : undefined, organisationId
                ? or(eq(aktivitaet.organisationId, organisationId), inArray(aktivitaet.dealId, tx.select({ id: deal.id }).from(deal).where(eq(deal.organisationId, organisationId))))
                : undefined,
              // Aktivitäten zu Deals fremder Fonds bleiben unsichtbar.
              dealsichtbar ? or(isNull(aktivitaet.dealId), inArray(aktivitaet.dealId, tx.select({ id: deal.id }).from(deal).where(dealsichtbar))) : undefined,
            ))
            .orderBy(desc(aktivitaet.datum), desc(aktivitaet.erstelltAm), asc(aktivitaet.id))
            .limit(limit),
        );
        return kontaktJson(c, { daten: zeilen }, 200);
      },
    )
    .post("/", pruefeKontakt("json", neueAktivitaet), async (c) => {
      const { zustaendigId, ...werte } = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        if (werte.organisationId) await ladeOrganisation(tx, werte.organisationId);
        if (werte.personId) await ladePerson(tx, werte.personId);
        if (werte.dealId) await ladeDeal(tx, werte.dealId);
        let zustaendig: string | null = null;
        if (werte.wiedervorlage) {
          zustaendig = zustaendigId ?? akteur.id;
          if (zustaendigId) {
            const [b] = await tx.select({ aktiv: benutzer.aktiv, technisch: benutzer.technisch }).from(benutzer).where(eq(benutzer.id, zustaendigId));
            if (!b || !b.aktiv || b.technisch) throw new Fachfehler(400, "assignee_invalid", "Only an active signed-in person can be the assignee.");
          }
        }
        const [zeile] = await tx.insert(aktivitaet).values({ ...werte, zustaendig }).returning();
        if (!zeile) throw new Error("Aktivität nicht angelegt");
        await protokoll("anlegen", "aktivitaet", zeile.id, null, zeile);
        // @-Erwähnungen in der Notiz werden zu Verknüpfungen (Rückverweise am erwähnten Datensatz).
        const von = [
          ...(werte.organisationId ? [{ typ: "organisation" as const, id: werte.organisationId }] : []),
          ...(werte.personId ? [{ typ: "person" as const, id: werte.personId }] : []),
          ...(werte.dealId ? [{ typ: "deal" as const, id: werte.dealId }] : []),
        ];
        await schreibeErwaehnungen(tx, zeile.id, von, werte.notiz);
        return zeile;
      });
      return kontaktJson(c, neu, 201);
    })
    /**
     * Entfernt eine synchronisierte Mail oder einen Termin (Etappe 17): nur die Person, deren Abgleich sie angelegt hat. Der Abgleich holt das Element
     * danach für diese Person nicht erneut (Ausschluss über den Hash der Nachrichten- oder Termin-ID, ohne Inhalt).
     */
    .post("/:id/remove-sync", pruefeKontakt("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      await schreibe(db, c, async (tx, protokoll) => {
        const [vorher] = await tx.select().from(aktivitaet).where(eq(aktivitaet.id, id)).for("update");
        if (!vorher) throw new Fachfehler(404, "activity_not_found", "Activity not found.");
        const [herkunft] = await tx.select().from(aktivitaetSync).where(eq(aktivitaetSync.aktivitaetId, id));
        if (!herkunft) throw new Fachfehler(409, "not_synced_activity", "This activity does not come from a mailbox or calendar connection.");
        if (herkunft.benutzerId !== akteur.id) throw new Fachfehler(403, "synced_activity_foreign", "Only the person whose mailbox or calendar created the activity can remove it.");
        await tx.insert(syncAusschluss).values({ benutzerId: akteur.id, externHash: herkunft.externHash }).onConflictDoNothing();
        await protokoll("loeschen", "aktivitaet", id, protokollSicht(vorher), null);
        await tx.delete(aktivitaet).where(eq(aktivitaet.id, id));
      });
      return c.body(null, 204);
    })
    .post("/:id/complete", pruefeKontakt("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const [vorher] = await tx.select().from(aktivitaet).where(eq(aktivitaet.id, id)).for("update");
        if (!vorher) throw new Fachfehler(404, "activity_not_found", "Activity not found.");
        if (!vorher.wiedervorlage || vorher.wiedervorlageErledigtAm) return vorher;
        const [nachher] = await tx.update(aktivitaet).set({ wiedervorlageErledigtAm: new Date() }).where(eq(aktivitaet.id, id)).returning();
        await protokoll("aendern", "aktivitaet", id, vorher, nachher);
        return nachher;
      });
      return kontaktJson(c, neu, 200);
    })
    .post("/:id/reschedule", pruefeKontakt("param", idParam), pruefeKontakt("json", z.object({ datum: z.iso.date() })), async (c) => {
      const { id } = c.req.valid("param");
      const { datum } = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const [vorher] = await tx.select().from(aktivitaet).where(eq(aktivitaet.id, id)).for("update");
        if (!vorher) throw new Fachfehler(404, "activity_not_found", "Activity not found.");
        if (!vorher.wiedervorlage || vorher.wiedervorlageErledigtAm) throw new Fachfehler(409, "no_follow_up", "There is no open follow-up.");
        if (datum < heute()) throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder: [{ feld: "datum", code: "too_small", meldung: "The date is in the past" }] });
        const [nachher] = await tx.update(aktivitaet).set({ wiedervorlage: datum }).where(eq(aktivitaet.id, id)).returning();
        await protokoll("zurueckstellen", "aktivitaet", id, vorher, nachher);
        return nachher;
      });
      return kontaktJson(c, neu, 200);
    });
}

const tage = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Offene Wiedervorlagen bis `bis` (einschließlich), älteste zuerst; nur Deals, die die Person sehen darf. */
async function ladeWiedervorlagen(tx: Tx, c: Context, bis: string, zustaendigId?: string) {
  const dealsichtbar = dealSichtbar(c);
  const heuteIso = heute();
  const zeilen = await tx
    .select({
      id: aktivitaet.id,
      art: aktivitaet.art,
      titel: aktivitaet.titel,
      datum: aktivitaet.datum,
      wiedervorlage: aktivitaet.wiedervorlage,
      zustaendigId: aktivitaet.zustaendig,
      deal: { id: deal.id, titel: deal.titel },
      organisation: { id: organisation.id, name: organisation.name },
      person: { id: person.id, vorname: person.vorname, nachname: person.nachname },
    })
    .from(aktivitaet)
    .leftJoin(deal, eq(deal.id, aktivitaet.dealId))
    .leftJoin(organisation, eq(organisation.id, aktivitaet.organisationId))
    .leftJoin(person, eq(person.id, aktivitaet.personId))
    .where(
      and(
        sourceActive("note", aktivitaet.id),
        isNotNull(aktivitaet.wiedervorlage),
        lte(aktivitaet.wiedervorlage, bis),
        isNull(aktivitaet.wiedervorlageErledigtAm),
        zustaendigId ? eq(aktivitaet.zustaendig, zustaendigId) : undefined,
        dealsichtbar ? or(isNull(aktivitaet.dealId), dealsichtbar) : undefined,
      ),
    )
    .orderBy(asc(aktivitaet.wiedervorlage), asc(aktivitaet.id));
  return zeilen.map((z) => ({ ...z, ueberfaellig: z.wiedervorlage !== null && z.wiedervorlage < heuteIso }));
}

/**
 * Wiedervorlagen: Liste (offen, Datum am oder vor `bis`, Standard heute; `zustaendig=ich` nur die eigenen), Zähler für die
 * Kopfzeile und die Tageszusammenfassung der angemeldeten Person (ohne Versand, Etappe 7).
 */
export function wiedervorlageRouten(db: Db) {
  return new Hono()
    .get("/count", async (c) => {
      const akteur = aktuellerAkteur(c);
      // Der Zähler steht in der Kopfzeile jeder Seite: ohne Bereich Kontakte (Rechtemodell) nichts zählen statt 403.
      if (!hatBereich(akteur, "kontakte")) return kontaktJson(c, { ueberfaellig: 0, heute: 0, gesamt: 0 }, 200);
      const heuteIso = heute();
      const zeilen = await lese(db, (tx) => ladeWiedervorlagen(tx, c, heuteIso, akteur.id));
      const ueberfaellig = zeilen.filter((z) => z.ueberfaellig).length;
      return kontaktJson(c, { ueberfaellig, heute: zeilen.length - ueberfaellig, gesamt: zeilen.length }, 200);
    })
    .get("/summary", async (c) => {
      const akteur = aktuellerAkteur(c);
      const heuteIso = heute();
      const zeilen = await lese(db, (tx) => ladeWiedervorlagen(tx, c, tage(heuteIso, 7), akteur.id));
      const ueberfaellig = zeilen.filter((z) => z.ueberfaellig);
      const heuteFaellig = zeilen.filter((z) => z.wiedervorlage === heuteIso);
      const kommende = zeilen.filter((z) => z.wiedervorlage !== null && z.wiedervorlage > heuteIso);
      return kontaktJson(
        c,
        {
          datum: heuteIso,
          benutzer: { id: akteur.id, name: akteur.name },
          anzahl: { ueberfaellig: ueberfaellig.length, heute: heuteFaellig.length, kommende: kommende.length },
          ueberfaellig,
          heute: heuteFaellig,
          kommende,
        },
        200,
      );
    })
    .get("/", pruefeKontakt("query", z.object({ bis: z.iso.date().optional(), zustaendig: z.enum(["ich", "alle"]).default("alle") })), async (c) => {
      const { bis, zustaendig } = c.req.valid("query");
      const akteur = aktuellerAkteur(c);
      const zeilen = await lese(db, (tx) => ladeWiedervorlagen(tx, c, bis ?? heute(), zustaendig === "ich" ? akteur.id : undefined));
      return kontaktJson(c, { daten: zeilen }, 200);
    });
}
