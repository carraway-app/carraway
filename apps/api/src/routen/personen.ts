import { kontaktJson, pruefeKontakt } from "../kontakte/http";
import { and, asc, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { geaendertSeitBedingung, geaendertSeitEingabe } from "../geaendert";
import { aktivitaet, kontaktrolle, organisation, person, type Db } from "@carraway/db";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { setzeHauptunternehmen } from "../crm/datensatz";
import { findePersonenDubletten } from "../dubletten";
import { Fachfehler, fehlerAntwort } from "../fehler";
import { fuehrePersonenZusammen, PERSON_FELDER, vorschauPersonen } from "../kontakte/zusammenfuehren";
import { idParam, ladeOrganisation, ladePerson, MINDESTENS_EIN_FELD, mindestensEins, nurGesetzte, optionalerText, schreibe, textEingabe } from "../schreiben";
import { herkunftVon } from "../postfach/kontakte";
import { lese } from "../zeitlimit";

const neuePerson = z.object({
  vorname: textEingabe(200),
  nachname: textEingabe(200),
  email: z.email().max(300).nullable().optional(),
  funktion: optionalerText(200),
  organisationId: z.uuid().nullable().optional(),
  /** Bestätigt, dass trotz gleicher E-Mail-Adresse oder ähnlichen Namens eine neue Person entstehen soll. */
  dubletteBestaetigt: z.boolean().optional(),
});

const aenderungPerson = z
  .object({
    vorname: textEingabe(200).optional(),
    nachname: textEingabe(200).optional(),
    email: z.email().max(300).nullable().optional(),
    funktion: optionalerText(200),
    organisationId: z.uuid().nullable().optional(),
  })
  .refine(mindestensEins, MINDESTENS_EIN_FELD);

const zusammenfuehrenEingabe = z.object({
  quelleId: z.uuid(),
  felder: z.partialRecord(z.enum(PERSON_FELDER), z.enum(["ziel", "quelle"])).default({}),
});

const maskiere = (text: string) => text.replace(/[\\%_]/g, (zeichen) => `\\${zeichen}`);

export function personRouten(db: Db) {
  return new Hono()
    .get(
      "/duplicates",
      pruefeKontakt(
        "query",
        z.object({ vorname: textEingabe(200), nachname: textEingabe(200), email: z.string().trim().max(300).optional(), ausser: z.uuid().optional() }),
      ),
      async (c) => {
        const { vorname, nachname, email, ausser } = c.req.valid("query");
        const kandidaten = await lese(db, (tx) => findePersonenDubletten(tx, { vorname, nachname, email }, { ausser }));
        return kontaktJson(c, { daten: kandidaten }, 200);
      },
    )
    .get(
      "/",
      pruefeKontakt("query", z.object({ organisationId: z.uuid().optional(), suche: z.string().trim().min(1).max(200).optional(), geaendertSeit: geaendertSeitEingabe })),
      async (c) => {
        const { organisationId, suche, geaendertSeit } = c.req.valid("query");
        const muster = suche ? `%${maskiere(suche)}%` : undefined;
        const zeilen = await lese(db, (tx) =>
          tx
            .select({
              id: person.id,
              vorname: person.vorname,
              nachname: person.nachname,
              email: person.email,
              funktion: person.funktion,
              organisation: { id: organisation.id, name: organisation.name },
            })
            .from(person)
            .leftJoin(organisation, eq(organisation.id, person.organisationId))
            .where(
              and(
                isNull(person.zusammengefuehrtIn),
                isNull(person.archiviertAm),
                organisationId ? eq(person.organisationId, organisationId) : undefined,
                geaendertSeitBedingung("person", person.id, person.erstelltAm, geaendertSeit),
                muster ? or(ilike(person.vorname, muster), ilike(person.nachname, muster)) : undefined,
              ),
            )
            .orderBy(asc(person.nachname), asc(person.vorname), asc(person.id)),
        );
        return kontaktJson(c, { daten: zeilen }, 200);
      },
    )
    .post("/:id/merge/preview", pruefeKontakt("param", idParam), pruefeKontakt("json", z.object({ quelleId: z.uuid() })), async (c) => {
      const { id } = c.req.valid("param");
      const { quelleId } = c.req.valid("json");
      const vorschau = await lese(db, (tx) => vorschauPersonen(tx, aktuellerAkteur(c), id, quelleId));
      return kontaktJson(c, vorschau, 200);
    })
    .post("/:id/merge", pruefeKontakt("param", idParam), pruefeKontakt("json", zusammenfuehrenEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const { quelleId, felder } = c.req.valid("json");
      const ergebnis = await schreibe(db, c, (tx, protokoll) => fuehrePersonenZusammen(tx, protokoll, aktuellerAkteur(c), id, quelleId, felder));
      return kontaktJson(c, ergebnis, 200);
    })
    .get("/:id", pruefeKontakt("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const ergebnis = await lese(db, async (tx) => {
        const [zeile] = await tx.select().from(person).where(eq(person.id, id));
        if (!zeile) return null;
        const [org] = zeile.organisationId ? await tx.select({ id: organisation.id, name: organisation.name }).from(organisation).where(eq(organisation.id, zeile.organisationId)) : [null];
        const rollen = await tx
          .select({ id: kontaktrolle.id, rolle: kontaktrolle.rolle, von: kontaktrolle.von, bis: kontaktrolle.bis, organisation: { id: organisation.id, name: organisation.name } })
          .from(kontaktrolle)
          .innerJoin(organisation, eq(organisation.id, kontaktrolle.organisationId))
          .where(eq(kontaktrolle.personId, id))
          .orderBy(asc(organisation.name), asc(kontaktrolle.rolle), asc(kontaktrolle.id));
        const [letzte] = await tx.select({ n: aktivitaet.datum }).from(aktivitaet).where(eq(aktivitaet.personId, id)).orderBy(desc(aktivitaet.datum)).limit(1);
        return { ...zeile, organisation: org ?? null, rollen, letzteAktivitaet: letzte?.n ?? null, herkunft: await herkunftVon(tx, { personId: id }) };
      });
      if (!ergebnis) return fehlerAntwort(c, 404, "person_not_found", "Person not found.");
      return kontaktJson(c, ergebnis, 200);
    })
    .post("/", pruefeKontakt("json", neuePerson), async (c) => {
      const { dubletteBestaetigt, ...werte } = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        if (werte.organisationId) await ladeOrganisation(tx, werte.organisationId);
        if (!dubletteBestaetigt) {
          const kandidaten = await findePersonenDubletten(tx, werte);
          if (kandidaten.length > 0) throw new Fachfehler(409, "possible_duplicate", "Similar persons already exist.", { kandidaten });
        }
        const [zeile] = await tx.insert(person).values(werte).returning();
        if (!zeile) throw new Error("Person nicht angelegt");
        await protokoll("anlegen", "person", zeile.id, null, zeile);
        if (zeile.organisationId) await setzeHauptunternehmen(tx, zeile.id, zeile.organisationId, zeile.funktion);
        return zeile;
      });
      return kontaktJson(c, neu, 201);
    })
    .patch("/:id", pruefeKontakt("param", idParam), pruefeKontakt("json", aenderungPerson), async (c) => {
      const { id } = c.req.valid("param");
      const aenderungen = nurGesetzte(c.req.valid("json"));
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladePerson(tx, id);
        if (aenderungen.organisationId) await ladeOrganisation(tx, aenderungen.organisationId);
        const [nachher] = await tx.update(person).set(aenderungen).where(eq(person.id, id)).returning();
        await protokoll("aendern", "person", id, vorher, nachher);
        if (nachher && (aenderungen.organisationId !== undefined || aenderungen.funktion !== undefined)) await setzeHauptunternehmen(tx, id, nachher.organisationId, nachher.funktion);
        return nachher;
      });
      return kontaktJson(c, neu, 200);
    });
}
