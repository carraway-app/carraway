import { sql } from "drizzle-orm";
import { organisation, type Db } from "@carraway/db";
import { Fachfehler } from "./fehler";
import type { Protokollant } from "./schreiben";
import type { Tx } from "./zeitlimit";

/** Ab dieser Trigramm-Ähnlichkeit der normalisierten Namen gilt eine Organisation als mögliche Dublette. */
export const DUBLETTEN_SCHWELLE = 0.45;

export interface DublettenKandidat {
  id: string;
  name: string;
  art: string;
  ort: string | null;
  score: number;
}

/**
 * Sucht ähnliche Organisationen. Verglichen werden die normalisierten Namen (Funktion
 * `organisation_name_normalisiert`: Kleinbuchstaben, ohne Rechtsform und Satzzeichen) mit pg_trgm.
 */
export async function findeDubletten(tx: Tx | Db, name: string, limit = 10): Promise<DublettenKandidat[]> {
  const { rows } = await tx.execute<{ id: string; name: string; art: string; ort: string | null; score: number }>(sql`
    WITH eingabe AS (SELECT organisation_name_normalisiert(${name}) AS n)
    SELECT o.id, o.name, o.art, o.ort, similarity(organisation_name_normalisiert(o.name), e.n)::float8 AS score
    FROM organisation o, eingabe e
    WHERE e.n <> ''
      AND o.zusammengefuehrt_in IS NULL
      AND organisation_name_normalisiert(o.name) % e.n
      AND similarity(organisation_name_normalisiert(o.name), e.n) >= ${DUBLETTEN_SCHWELLE}
    ORDER BY score DESC, o.name, o.id
    LIMIT ${limit}
  `);
  return rows.map((r) => ({ ...r, score: Math.round(r.score * 1000) / 1000 }));
}

export type OrganisationEingabe = Pick<typeof organisation.$inferInsert, "name" | "art" | "sektor" | "ort" | "website" | "rechtsform">;

/** Legt eine Organisation an. Ohne Bestätigung bricht eine mögliche Dublette die Anfrage mit 409 ab. */
export async function legeOrganisationAn(tx: Tx, protokoll: Protokollant, werte: OrganisationEingabe, dubletteBestaetigt: boolean | undefined) {
  if (!dubletteBestaetigt) {
    const kandidaten = await findeDubletten(tx, werte.name);
    if (kandidaten.length > 0) {
      throw new Fachfehler(409, "DUBLETTE_MOEGLICH", "Es gibt bereits ähnliche Organisationen.", { kandidaten });
    }
  }
  const [neu] = await tx.insert(organisation).values(werte).returning();
  if (!neu) throw new Error("Organisation nicht angelegt");
  await protokoll("anlegen", "organisation", neu.id, null, neu);
  return neu;
}

/** Ab dieser Trigramm-Ähnlichkeit von Vor- und Nachname gilt eine Person als mögliche Dublette (Namen sind kurz, daher strenger). */
export const PERSONEN_SCHWELLE = 0.6;

export interface PersonenKandidat {
  id: string;
  vorname: string;
  nachname: string;
  email: string | null;
  organisation: { id: string; name: string } | null;
  /** `email`: gleiche E-Mail-Adresse (ohne Beachtung der Groß- und Kleinschreibung); `name`: ähnlicher Name. */
  grund: "email" | "name";
  score: number;
}

/** Sucht ähnliche Personen: gleiche E-Mail-Adresse oder ähnlicher Name (pg_trgm auf Vor- und Nachname). Zusammengeführte Personen zählen nicht. */
export async function findePersonenDubletten(
  tx: Tx | Db,
  eingabe: { vorname: string; nachname: string; email?: string | null | undefined },
  optionen: { ausser?: string | undefined; limit?: number } = {},
): Promise<PersonenKandidat[]> {
  const { rows } = await tx.execute<{ id: string; vorname: string; nachname: string; email: string | null; org_id: string | null; org_name: string | null; grund: "email" | "name"; score: number }>(sql`
    WITH eingabe AS (
      SELECT lower(btrim(${eingabe.vorname}::text || ' ' || ${eingabe.nachname}::text)) AS n, lower(btrim(coalesce(${eingabe.email ?? null}::text, ''))) AS m
    )
    SELECT p.id, p.vorname, p.nachname, p.email, o.id AS org_id, o.name AS org_name,
           CASE WHEN e.m <> '' AND lower(p.email) = e.m THEN 'email' ELSE 'name' END AS grund,
           CASE WHEN e.m <> '' AND lower(p.email) = e.m THEN 1 ELSE similarity(lower(p.vorname || ' ' || p.nachname), e.n) END::float8 AS score
    FROM person p
    LEFT JOIN organisation o ON o.id = p.organisation_id
    CROSS JOIN eingabe e
    WHERE p.zusammengefuehrt_in IS NULL
      AND (${optionen.ausser ?? null}::uuid IS NULL OR p.id <> ${optionen.ausser ?? null}::uuid)
      AND (
        (e.m <> '' AND lower(p.email) = e.m)
        OR (e.n <> '' AND lower(p.vorname || ' ' || p.nachname) % e.n AND similarity(lower(p.vorname || ' ' || p.nachname), e.n) >= ${PERSONEN_SCHWELLE})
      )
    ORDER BY score DESC, p.nachname, p.vorname, p.id
    LIMIT ${optionen.limit ?? 10}
  `);
  return rows.map((r) => ({
    id: r.id,
    vorname: r.vorname,
    nachname: r.nachname,
    email: r.email,
    organisation: r.org_id && r.org_name ? { id: r.org_id, name: r.org_name } : null,
    grund: r.grund,
    score: Math.round(r.score * 1000) / 1000,
  }));
}
