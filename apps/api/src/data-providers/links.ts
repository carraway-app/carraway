import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { providerConnection, providerSource, type Db } from "@carraway/db";
import { Fachfehler } from "../fehler";
import type { Tx } from "../zeitlimit";
import type { Retrieved } from "./types";

export async function linkedRegisters(db: Tx | Db, companyId: string) {
  return db.select({ provider: providerConnection.provider, reference: providerSource.externalId, digest: providerSource.digest })
    .from(providerSource).innerJoin(providerConnection, eq(providerConnection.id, providerSource.connectionId))
    .where(and(eq(providerSource.localId, companyId), eq(providerSource.resource, "register")));
}

export async function recordLink(tx: Tx, connectionId: string, companyId: string, result: Retrieved, previousDigest?: string) {
  const local = and(eq(providerSource.connectionId, connectionId), eq(providerSource.resource, "register"), eq(providerSource.localId, companyId));
  const [old] = await tx.select().from(providerSource).where(local);
  if (old?.digest !== previousDigest) throw new Fachfehler(409, "provider_review_stale", "Another retrieval changed this register link.");
  if (old && old.externalId !== result.reference) await tx.delete(providerSource).where(local);
  const digest = createHash("sha256").update(JSON.stringify(result)).digest("hex");
  const saved = await tx.insert(providerSource).values({ connectionId, resource: "register", externalId: result.reference, localId: companyId, digest })
    .onConflictDoUpdate({ target: [providerSource.connectionId, providerSource.resource, providerSource.externalId], set: { digest }, setWhere: eq(providerSource.localId, companyId) })
    .returning({ id: providerSource.localId });
  if (!saved.length) throw new Fachfehler(409, "invalid_input", "This register identity is linked to another company.");
}
