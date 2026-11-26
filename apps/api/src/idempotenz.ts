import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import type { Db } from "@carraway/db";
import { Fachfehler } from "./fehler";
import { relativerPfad } from "./rechte/pruefen";

/**
 * Kopf `Idempotency-Key` für alle POST-Routen: Derselbe Schlüssel (je Akteur) mit demselben Körper liefert 24 Stunden lang dieselbe
 * Antwort, ohne die Anfrage noch einmal auszuführen (Kopf `Idempotent-Replayed: true`). Derselbe Schlüssel mit anderem Körper, anderer
 * Methode oder anderem Pfad ist 409 `idempotency_conflict`; läuft die erste Anfrage noch, ist es 409 `idempotency_in_progress`.
 * Gespeichert werden die Antworten bis 4xx; ein Serverfehler (5xx) gibt den Schlüssel wieder frei, damit die Wiederholung gelingt.
 * Ohne Kopf bleibt alles beim Alten. Ausgenommen sind `/auth/*` und die Einrichtung (ohne Akteur).
 */

const SCHLUESSEL = /^[\x21-\x7e]{1,200}$/;
const GUELTIG_STUNDEN = 24;

async function koerperHash(c: Parameters<MiddlewareHandler>[0]): Promise<string> {
  const hash = createHash("sha256");
  const typ = c.req.header("content-type") ?? "";
  if (/^multipart\/form-data/i.test(typ)) {
    // Die Trennzeichen im Körper ändern sich je Anfrage: gehasht werden Feldnamen, Texte und Dateiinhalte.
    const formular = await c.req.raw.clone().formData();
    for (const [name, wert] of formular.entries()) {
      hash.update(`${name.length}:${name}`);
      if (typeof wert === "string") hash.update(`s${wert.length}:${wert}`);
      else hash.update(`f${wert.name.length}:${wert.name}${wert.size}:`).update(Buffer.from(await wert.arrayBuffer()));
    }
  } else {
    hash.update(Buffer.from(await c.req.raw.clone().arrayBuffer()));
  }
  return hash.digest("hex");
}

export function idempotenz(db: Db): MiddlewareHandler {
  return async (c, next) => {
    const schluessel = c.req.header("Idempotency-Key");
    const pfad = relativerPfad(c);
    const akteur = c.get("akteur");
    if (schluessel === undefined || c.req.method !== "POST" || !akteur || pfad.startsWith("/auth/") || pfad === "/setup") return next();
    if (!SCHLUESSEL.test(schluessel)) {
      throw new Fachfehler(400, "idempotency_key_invalid", "The Idempotency-Key consists of 1 to 200 printable ASCII characters without spaces.");
    }
    const anfrage = createHash("sha256").update(`${c.req.method}\n${pfad}${new URL(c.req.url).search}\n`).update(await koerperHash(c)).digest("hex");

    await db.execute(sql`DELETE FROM idempotenz_schluessel WHERE akteur = ${akteur.id} AND schluessel = ${schluessel} AND erstellt_am < now() - ${`${GUELTIG_STUNDEN} hours`}::interval`);
    if (Math.random() < 0.02) await db.execute(sql`DELETE FROM idempotenz_schluessel WHERE erstellt_am < now() - ${`${GUELTIG_STUNDEN} hours`}::interval`);
    const { rows: reserviert } = await db.execute<{ schluessel: string }>(
      sql`INSERT INTO idempotenz_schluessel (akteur, schluessel, methode, pfad, anfrage_hash) VALUES (${akteur.id}, ${schluessel}, ${c.req.method}, ${pfad}, ${anfrage}) ON CONFLICT DO NOTHING RETURNING schluessel`,
    );
    if (reserviert.length === 0) {
      const { rows } = await db.execute<{ anfrage_hash: string; status: number | null; antwort: string | null; inhaltstyp: string | null }>(
        sql`SELECT anfrage_hash, status, antwort, inhaltstyp FROM idempotenz_schluessel WHERE akteur = ${akteur.id} AND schluessel = ${schluessel}`,
      );
      const gespeichert = rows[0];
      if (!gespeichert) return next(); // zwischen Einfügen und Lesen abgelaufen: wie eine neue Anfrage behandeln
      if (gespeichert.anfrage_hash !== anfrage) {
        throw new Fachfehler(409, "idempotency_conflict", "This Idempotency-Key was already used with a different request.");
      }
      if (gespeichert.status === null) {
        c.header("Retry-After", "1");
        throw new Fachfehler(409, "idempotency_in_progress", "The request with this Idempotency-Key is still in progress.");
      }
      return new Response(gespeichert.antwort ?? "", {
        status: gespeichert.status,
        headers: { "Content-Type": gespeichert.inhaltstyp ?? "application/json", "Idempotent-Replayed": "true" },
      });
    }

    let antwort: Response | undefined;
    try {
      await next();
      antwort = c.res;
    } catch (fehler) {
      // Der Fehlerbehandler der App wandelt Fachfehler in Antworten um, aber erst nach der Middleware: Fehler hier als 5xx behandeln.
      await db.execute(sql`DELETE FROM idempotenz_schluessel WHERE akteur = ${akteur.id} AND schluessel = ${schluessel}`);
      throw fehler;
    }
    const typ = antwort.headers.get("content-type") ?? "";
    if (antwort.status >= 500 || !/json/i.test(typ)) {
      await db.execute(sql`DELETE FROM idempotenz_schluessel WHERE akteur = ${akteur.id} AND schluessel = ${schluessel}`);
      return;
    }
    const text = await antwort.clone().text();
    await db.execute(
      sql`UPDATE idempotenz_schluessel SET status = ${antwort.status}, antwort = ${text}, antwort_hash = ${createHash("sha256").update(text).digest("hex")}, inhaltstyp = ${typ} WHERE akteur = ${akteur.id} AND schluessel = ${schluessel}`,
    );
  };
}
