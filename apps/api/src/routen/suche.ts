import { kontaktJson, pruefeKontakt } from "../kontakte/http";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { deal, organisation, person, type Db } from "@carraway/db";
import { aktuellerAkteur, fuerBereich, hatRolleOhneFonds } from "../anmeldung/akteur";
import { sucheDokumentSeiten } from "./dokumente";
import { hatBereich } from "../rechte/bereiche";
import { dealSichtbar } from "../rechte/sichtbarkeit";
import { lese } from "../zeitlimit";

const maskiere = (text: string) => text.replace(/[\\%_]/g, (zeichen) => `\\${zeichen}`);

const rund = (wert: unknown) => Math.round(Number(wert) * 1000) / 1000;

/**
 * Rang eines Textes zur Suchanfrage: Trigramm-Ähnlichkeit (ganzer Text und Wortanfang) plus Zuschlag für Treffer am
 * Anfang (0,5) und Gleichheit (1). `text` ist ein SQL-Ausdruck in Kleinbuchstaben, `q` die kleingeschriebene Anfrage.
 */
const rang = (text: ReturnType<typeof sql>, q: string) =>
  sql<number>`(greatest(similarity(${text}, ${q}), word_similarity(${q}, ${text})) + CASE WHEN ${text} = ${q} THEN 1 WHEN ${text} LIKE ${`${maskiere(q)}%`} THEN 0.5 WHEN ${text} LIKE ${`%${maskiere(q)}%`} THEN 0.25 ELSE 0 END)::float8`;

/** Trifft, wenn der Text die Anfrage enthält oder ihr nach Trigrammen ähnelt (nutzt die Trigramm-Indizes). */
const trifft = (text: ReturnType<typeof sql>, q: string) => sql`(${text} LIKE ${`%${maskiere(q)}%`} OR ${text} % ${q} OR ${q} <% ${text})`;

/**
 * Globale Suche über Organisationen, Personen und Deals, auf dem Server gerankt (pg_trgm), dazu Treffer im Text von Dokumenten
 * (Volltext, Seite mit Ausschnitt). Deals und Dokumente fremder Fonds erscheinen nicht; zusammengeführte Organisationen und Personen auch nicht.
 * Jede Gruppe von Treffern verlangt ihren Bereich (Kontakte, Dealflow, Dokumente); ohne ihn bleibt sie leer.
 */
export function sucheRouten(db: Db) {
  return new Hono().get(
    "/",
    pruefeKontakt("query", z.object({ q: z.string().trim().min(2).max(100), limit: z.coerce.number().int().min(1).max(20).default(5) })),
    async (c) => {
      const { q: roh, limit } = c.req.valid("query");
      const q = roh.toLowerCase();
      const akteur = aktuellerAkteur(c);
      // Kontakte haben keinen Fonds: Es genügt der Bereich mit einer Stufe an irgendeinem Fonds oder über eine Gruppe ohne Fonds.
      const kontakte = hatBereich(akteur, "kontakte") && hatRolleOhneFonds(fuerBereich(akteur, "kontakte"), "betrachter");
      const ergebnis = await lese(db, async (tx) => {
        const orgName = sql`lower(${organisation.name})`;
        const orgRang = rang(orgName, q);
        const organisationen = await tx
          .select({ id: organisation.id, name: organisation.name, art: organisation.art, ort: organisation.ort, email: organisation.email, telefon: organisation.telefon, website: organisation.website, linkedin: organisation.linkedin, score: orgRang })
          .from(organisation)
          .where(and(kontakte ? undefined : sql`false`, isNull(organisation.zusammengefuehrtIn), isNull(organisation.archiviertAm), trifft(orgName, q)))
          .orderBy(desc(orgRang), organisation.name, organisation.id)
          .limit(limit);

        const personName = sql`lower(${person.vorname} || ' ' || ${person.nachname})`;
        const personEmail = sql`lower(coalesce(${person.email}, ''))`;
        const personRang = sql<number>`greatest(${rang(personName, q)}, CASE WHEN ${personEmail} = ${q} THEN 1.5 WHEN ${personEmail} LIKE ${`${maskiere(q)}%`} THEN 0.75 ELSE 0 END)::float8`;
        const personen = await tx
          .select({
            id: person.id,
            vorname: person.vorname,
            nachname: person.nachname,
            email: person.email,
            telefon: person.telefon,
            linkedin: person.linkedin,
            organisation: { id: organisation.id, name: organisation.name },
            score: personRang,
          })
          .from(person)
          .leftJoin(organisation, eq(organisation.id, person.organisationId))
          .where(and(kontakte ? undefined : sql`false`, isNull(person.zusammengefuehrtIn), isNull(person.archiviertAm), sql`(${trifft(personName, q)} OR ${personEmail} LIKE ${`${maskiere(q)}%`})`))
          .orderBy(desc(personRang), person.nachname, person.vorname, person.id)
          .limit(limit);

        const dealTitel = sql`lower(${deal.titel})`;
        const dealRang = sql<number>`greatest(${rang(dealTitel, q)}, ${rang(orgName, q)} * 0.8)::float8`;
        const deals = await tx
          .select({
            id: deal.id,
            titel: deal.titel,
            phase: deal.phase,
            status: deal.status,
            organisation: { id: organisation.id, name: organisation.name, email: organisation.email, telefon: organisation.telefon, website: organisation.website, linkedin: organisation.linkedin },
            score: dealRang,
          })
          .from(deal)
          .innerJoin(organisation, eq(organisation.id, deal.organisationId))
          .where(and(dealSichtbar(c), sql`(${trifft(dealTitel, q)} OR ${trifft(orgName, q)})`))
          .orderBy(desc(dealRang), deal.titel, deal.id)
          .limit(limit);

        // Bereiche je Fonds: Dokumente nur an Fonds, an denen die Person den Bereich Dokumente hat.
        const dokumente = hatBereich(akteur, "dokumente") ? await sucheDokumentSeiten(tx, fuerBereich(akteur, "dokumente"), roh, limit) : [];
        return { organisationen, personen, deals, dokumente };
      });
      return kontaktJson(
        c,
        {
          q: roh,
          organisationen: ergebnis.organisationen.map((z) => ({ ...z, score: rund(z.score) })),
          personen: ergebnis.personen.map((z) => ({ ...z, organisation: z.organisation?.id ? z.organisation : null, score: rund(z.score) })),
          deals: ergebnis.deals.map((z) => ({ ...z, score: rund(z.score) })),
          dokumente: ergebnis.dokumente.map((z) => ({ id: z.dokumentId, dateiname: z.dateiname, klassifikation: z.klassifikation, seite: z.seite, ausschnitt: z.ausschnitt, quelle: z.quelle, score: z.rang })),
        },
        200,
      );
    },
  );
}
