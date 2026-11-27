import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@carraway/db";
import type { Tx } from "../zeitlimit";

const KENNUNG = "carraway:initial-setup";
const hash = (token: string) => createHash("sha256").update(token).digest();

/** Start, Rotation und Einrichtung sehen unter derselben Transaktionssperre denselben Benutzerstand. */
export async function sperreEinrichtung(tx: Tx) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(80001)`);
  const { rows } = await tx.execute<{ offen: boolean }>(sql`SELECT NOT EXISTS (SELECT FROM benutzer WHERE NOT technisch) AS offen`);
  return rows[0]!.offen;
}

export async function entferneEinrichtungsToken(tx: Tx) {
  await tx.execute(sql`DELETE FROM verifizierung WHERE identifier = ${KENNUNG}`);
}

/** Vor dem Öffnen des HTTP-Ports rotieren. Nur ein generiertes Token geht nach erfolgreichem Commit an die Betriebsausgabe. */
export async function initialisiereEinrichtung(db: Db, vorgabe: string | undefined, ausgabe: (zeile: string) => void) {
  const token = await db.transaction(async (tx) => {
    const offen = await sperreEinrichtung(tx);
    await entferneEinrichtungsToken(tx);
    if (!offen) return null;
    if (vorgabe && vorgabe.length > 1024) throw new Error("SETUP_TOKEN exceeds 1024 characters.");
    const wert = vorgabe || randomBytes(32).toString("base64url");
    await tx.execute(sql`INSERT INTO verifizierung (identifier, value, expires_at)
      VALUES (${KENNUNG}, ${hash(wert).toString("hex")}, 'infinity')`);
    return vorgabe ? null : wert;
  });
  if (token) ausgabe(`Carraway /setup token: ${token}`);
}

export async function gueltigesEinrichtungsToken(tx: Tx, token: string) {
  const { rows } = await tx.execute<{ value: string }>(sql`SELECT value FROM verifizierung WHERE identifier = ${KENNUNG}`);
  if (!rows[0]) return false;
  return timingSafeEqual(hash(token), Buffer.from(rows[0].value, "hex"));
}
