import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { Db } from "@carraway/db";
import { fehlerAntwort } from "../fehler";
import { pruefe } from "../pruefung";
import { stapelSpeicher } from "../zeitlimit";

/**
 * `POST /batch`: bis zu 100 schreibende Aufrufe in einer Transaktion, alles oder nichts. Jede Operation hat die Form des
 * Einzelaufrufs (`method`, `path` unter `/api/v1`, `body`) und läuft durch dieselbe App: dieselbe Anmeldung und dieselben Rechte
 * je Operation, dieselbe Prüfung der Eingabe, dieselben Regeln. Jede Operation läuft in einem Savepoint; schlägt eine fehl, laufen die
 * übrigen trotzdem weiter, damit alle Fehler gesammelt werden, und am Ende rollt die ganze Transaktion zurück (409 `batch_failed`
 * mit den Fehlern je Operation). Spätere Operationen sehen die Schreibvorgänge der früheren.
 */

export const MAX_OPERATIONEN = 100;

/** Wege, die nicht in einen Stapel gehören: Anmeldung und Benutzer, Importe und Exporte, Berichtsstufen (schreiben Dateien), der Stapel selbst. */
const AUSGESCHLOSSEN = new Set(["auth", "batch", "setup", "import", "export", "api-keys", "users", "reports", "changes", "openapi.json", "docs"]);

const operation = z.object({
  method: z.enum(["POST", "PUT", "PATCH", "DELETE"]),
  path: z
    .string()
    .min(2)
    .max(300)
    .regex(/^\/[A-Za-z0-9._~/-]+$/, "Path below /api/v1 without a query string")
    .refine((p) => !p.includes("//") && !p.split("/").some((t) => t === ".." || t === "."), "Invalid path")
    .refine((p) => !AUSGESCHLOSSEN.has(p.split("/")[1] ?? ""), "This route is not allowed in a batch"),
  body: z.unknown().optional(),
});

const eingabe = z.object({ operations: z.array(operation).min(1).max(MAX_OPERATIONEN) });

interface Ergebnis {
  index: number;
  status: number;
  body: unknown;
}

class StapelAbbruch extends Error {
  constructor(readonly results: Ergebnis[]) {
    super("Stapel fehlgeschlagen");
  }
}

/** `fuehreAus` ruft die ganze App (mit allen Middlewares) für eine Operation auf. */
export function stapelRouten(db: Db, fuehreAus: (anfrage: Request) => Promise<Response> | Response) {
  return new Hono().post(
    "/",
    bodyLimit({ maxSize: 5 * 1024 * 1024, onError: (c) => fehlerAntwort(c, 413, "batch_invalid", "The batch is larger than 5 MB.") }),
    pruefe("json", eingabe),
    async (c) => {
      const { operations } = c.req.valid("json");
      const kopf = new Headers();
      for (const name of ["cookie", "authorization", "origin", "x-forwarded-for", "user-agent"]) {
        const wert = c.req.header(name);
        if (wert !== undefined) kopf.set(name, wert);
      }
      kopf.set("content-type", "application/json");
      const basis = new URL(c.req.url);
      const results: Ergebnis[] = [];
      try {
        await db.transaction(async (tx) => {
          await stapelSpeicher.run({ tx }, async () => {
            for (const [index, op] of operations.entries()) {
              const antwort = await fuehreAus(
                new Request(`${basis.origin}/api/v1${op.path}`, { method: op.method, headers: kopf, ...(op.body === undefined ? {} : { body: JSON.stringify(op.body) }) }),
              );
              const text = await antwort.text();
              let body: unknown;
              try {
                body = text === "" ? null : JSON.parse(text);
              } catch {
                body = text.slice(0, 500);
              }
              results.push({ index, status: antwort.status, body });
            }
          });
          if (results.some((e) => e.status >= 300)) throw new StapelAbbruch(results);
        });
      } catch (fehler) {
        if (fehler instanceof StapelAbbruch) {
          const fehlgeschlagen = fehler.results.filter((e) => e.status >= 300).length;
          return fehlerAntwort(c, 409, "batch_failed", `${fehlgeschlagen} of ${operations.length} operations failed; nothing was written.`, undefined, {
            operations: fehler.results.map((e) => ({
              index: e.index,
              status: e.status,
              ok: e.status < 300,
              ...(e.status >= 300 ? { error: (e.body as { error?: unknown } | null)?.error ?? e.body } : { rolledBack: true }),
            })),
          });
        }
        throw fehler;
      }
      return c.json({ results }, 200);
    },
  );
}
