import { sql } from "drizzle-orm";

/**
 * Eine Liste als ein Array-Parameter (`ARRAY[$1, $2, …]::typ[]`). Drizzle löst ein JS-Array in einem `sql`-Ausdruck sonst in
 * eine Wertegruppe `($1, $2)` auf, die sich nicht in ein Array umwandeln lässt.
 */
export function liste(werte: readonly string[], typ: "text" | "uuid") {
  return sql`ARRAY[${sql.join(
    werte.map((w) => sql`${w}`),
    sql`, `,
  )}]::${sql.raw(typ)}[]`;
}
