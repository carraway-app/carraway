import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { providerConnection } from "@carraway/db";
import type { Schluesselring } from "../geheimnis/krypto";
import { Fachfehler } from "../fehler";
import type { Tx } from "../zeitlimit";

export const credentialAad = (id: string) => "provider_connection:" + id;
type Connection = typeof providerConnection.$inferSelect;

/** Shared storage for authenticated providers. Callers lock an existing connection before changing its settings. */
export async function saveConnection(tx: Tx, ring: Schluesselring, provider: string, mapping: unknown, credential?: string, existing?: Connection) {
  if (!credential && !existing) throw new Fachfehler(400, "invalid_input", "A credential is required.");
  const id = existing?.id ?? randomUUID();
  const encrypted = credential ? ring.verschluessele(credential, credentialAad(id)) : existing!.credential;
  if (existing) await tx.update(providerConnection).set({ credential: encrypted, mapping }).where(eq(providerConnection.id, id));
  else {
    const created = await tx.insert(providerConnection).values({ id, provider, credential: encrypted, mapping }).onConflictDoNothing().returning({ id: providerConnection.id });
    if (!created.length) throw new Fachfehler(409, "invalid_input", "Another administrator has configured this provider. Reload its settings.");
  }
  return id;
}
