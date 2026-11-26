import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { Db } from "@carraway/db";
import { fehlerAntwort } from "../fehler";
import { pruefe } from "../pruefung";
import { stapelSpeicher } from "../zeitlimit";

/**
 * `POST /stapel`: bis zu 100 schreibende Aufrufe in einer Transaktion, alles oder nichts. Jede Operation hat die Form des
 * Einzelaufrufs (`methode`, `pfad` unter `/api/v1`, `koerper`) und läuft durch dieselbe App: dieselbe Anmeldung und dieselben Rechte
 * je Operation, dieselbe Prüfung der Eingabe, dieselben Regeln. Jede Operation läuft in einem Savepoint; schlägt eine fehl, laufen die
 * übrigen trotzdem weiter, damit alle Fehler gesammelt werden, und am Ende rollt die ganze Transaktion zurück (409 `STAPEL_FEHLGESCHLAGEN`
 * mit den Fehlern je Operation). Spätere Operationen sehen die Schreibvorgänge der früheren.
 */

export const MAX_OPERATIONEN = 100;

/** Wege, die nicht in einen Stapel gehören: Anmeldung und Benutzer, Importe und Exporte, Berichtsstufen (schreiben Dateien), der Stapel selbst. */
const AUSGESCHLOSSEN = new Set(["auth", "stapel", "einrichtung", "import", "export", "api-schluessel", "benutzer", "berichte", "aenderungen", "openapi.json", "docs"]);

const operation = z.object({
  methode: z.enum(["POST", "PUT", "PATCH", "DELETE"]),
  pfad: z
    .string()
    .min(2)
    .max(300)
    .regex(/^\/[A-Za-z0-9._~/-]+$/, "Pfad unter /api/v1 ohne Abfrageteil")
    .refine((p) => !p.includes("//") && !p.split("/").some((t) => t === ".." || t === "."), "Pfad ungültig")
    .refine((p) => !AUSGESCHLOSSEN.has(p.split("/")[1] ?? ""), "Dieser Weg ist im Stapel nicht erlaubt"),
  koerper: z.unknown().optional(),
});

const eingabe = z.object({ operationen: z.array(operation).min(1).max(MAX_OPERATIONEN) });

interface Ergebnis {
  index: number;
  status: number;
  koerper: unknown;
}

class StapelAbbruch extends Error {
  constructor(readonly ergebnisse: Ergebnis[]) {
    super("Stapel fehlgeschlagen");
  }
}

/** `fuehreAus` ruft die ganze App (mit allen Middlewares) für eine Operation auf. */
export function stapelRouten(db: Db, fuehreAus: (anfrage: Request) => Promise<Response> | Response) {
  return new Hono().post(
    "/",
    bodyLimit({ maxSize: 5 * 1024 * 1024, onError: (c) => fehlerAntwort(c, 413, "STAPEL_UNGUELTIG", "Der Stapel ist größer als 5 MB.") }),
    pruefe("json", eingabe),
    async (c) => {
      const { operationen } = c.req.valid("json");
      const kopf = new Headers();
      for (const name of ["cookie", "authorization", "origin", "x-forwarded-for", "user-agent"]) {
        const wert = c.req.header(name);
        if (wert !== undefined) kopf.set(name, wert);
      }
      kopf.set("content-type", "application/json");
      const basis = new URL(c.req.url);
      const ergebnisse: Ergebnis[] = [];
      try {
        await db.transaction(async (tx) => {
          await stapelSpeicher.run({ tx }, async () => {
            for (const [index, op] of operationen.entries()) {
              const antwort = await fuehreAus(
                new Request(`${basis.origin}/api/v1${op.pfad}`, { method: op.methode, headers: kopf, ...(op.koerper === undefined ? {} : { body: JSON.stringify(op.koerper) }) }),
              );
              const text = await antwort.text();
              let koerper: unknown;
              try {
                koerper = text === "" ? null : JSON.parse(text);
              } catch {
                koerper = text.slice(0, 500);
              }
              ergebnisse.push({ index, status: antwort.status, koerper });
            }
          });
          if (ergebnisse.some((e) => e.status >= 300)) throw new StapelAbbruch(ergebnisse);
        });
      } catch (fehler) {
        if (fehler instanceof StapelAbbruch) {
          const fehlgeschlagen = fehler.ergebnisse.filter((e) => e.status >= 300).length;
          return fehlerAntwort(c, 409, "STAPEL_FEHLGESCHLAGEN", `${fehlgeschlagen} von ${operationen.length} Operationen sind fehlgeschlagen; es wurde nichts geschrieben.`, undefined, {
            operationen: fehler.ergebnisse.map((e) => ({
              index: e.index,
              status: e.status,
              ok: e.status < 300,
              ...(e.status >= 300 ? { fehler: (e.koerper as { fehler?: unknown } | null)?.fehler ?? e.koerper } : { zurueckgerollt: true }),
            })),
          });
        }
        throw fehler;
      }
      return c.json({ ergebnisse }, 200);
    },
  );
}
