import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import type { Db } from "@carraway/db";

/** Abfrage-Handle innerhalb der Lese-Transaktion einer Anfrage. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Läuft ein Stapel (`POST /batch`), liegen alle Lese- und Schreibwege in der einen Transaktion des Stapels: `schreibe()` arbeitet
 * dann in einem Savepoint, `lese()` liest in derselben Transaktion (und sieht damit die Schreibvorgänge davor).
 */
export const stapelSpeicher = new AsyncLocalStorage<{ tx: Tx }>();

/** Höchstdauer einer einzelnen Abfrage je Anfrage in Millisekunden. */
export const STATEMENT_TIMEOUT_MS = 5000;

/**
 * Führt `fn` in einer schreibgeschützten Transaktion aus, in der `statement_timeout` gilt.
 * `SET LOCAL` wirkt nur bis zum Ende der Transaktion und lässt damit keine Einstellung im Pool zurück.
 */
export function lese<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const stapel = stapelSpeicher.getStore();
  if (stapel) return fn(stapel.tx);
  return db.transaction(
    async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`));
      return fn(tx);
    },
    { accessMode: "read only" },
  );
}
