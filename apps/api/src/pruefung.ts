import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";
import type { Context } from "hono";
import { Fachfehler, fehlerAntwort, type Feldfehler } from "./fehler";

/** Kennung am Validator: Die OpenAPI-Beschreibung liest daran, welches Schema eine Route für welchen Teil der Anfrage prüft. */
export const SCHEMA_KENNUNG = Symbol.for("carraway.schema");
export interface SchemaMarke {
  ziel: keyof ValidationTargets;
  schema: ZodType;
}

/** Zod-Validator, der alle Feldfehler gesammelt als 400 im einheitlichen Fehlerformat zurückgibt. */
export function pruefe<Ziel extends keyof ValidationTargets, Schema extends ZodType>(
  ziel: Ziel,
  schema: Schema,
  /** Weitere Ziele derselben Route: bei einem Fehler werden deren Fehler gleich mit gesammelt. */
  weitere: { query?: ZodType; param?: ZodType } = {},
) {
  const validator = zValidator(ziel, schema, (ergebnis, c) => {
    if (ergebnis.success) return;
    const meldungen = (feld: string | undefined, fehler: { issues: readonly { path: readonly PropertyKey[]; code: string; message: string }[] }): Feldfehler[] =>
      fehler.issues.map((i) => ({ feld: i.path.map(String).join(".") || feld || ziel, code: i.code, meldung: i.message }));
    const felder = meldungen(undefined, ergebnis.error);
    for (const [name, weiteresSchema] of Object.entries(weitere)) {
      const roh = name === "query" ? c.req.query() : c.req.param();
      const weiteres = weiteresSchema.safeParse(roh);
      if (!weiteres.success) felder.push(...meldungen(name, weiteres.error));
    }
    return fehlerAntwort(c, 400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", felder);
  });
  const marke: SchemaMarke = { ziel, schema };
  return Object.assign(validator, { [SCHEMA_KENNUNG]: marke });
}

/**
 * Liest und prüft optionale Abfrageparameter, ohne sie im Typ der Route (und damit im typisierten Client) zu deklarieren.
 * Nötig für Routen, die bereits ohne Parameter aufgerufen werden und deren Aufrufer ihren Typ nicht ändern sollen.
 * Ungültige Werte sind 400 `EINGABE_UNGUELTIG` mit Feldfehlern.
 */
export function liesAbfrage<Schema extends ZodType>(c: Context, schema: Schema): ReturnType<Schema["parse"]> {
  const ergebnis = schema.safeParse(c.req.query());
  if (ergebnis.success) return ergebnis.data as ReturnType<Schema["parse"]>;
  throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", {
    felder: ergebnis.error.issues.map((i) => ({ feld: i.path.map(String).join(".") || "query", code: i.code, meldung: i.message })),
  });
}
