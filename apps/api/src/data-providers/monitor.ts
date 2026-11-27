import { eq } from "drizzle-orm";
import { registerBeobachtung, type Db } from "@carraway/db";
import type { Schluesselring } from "../geheimnis/krypto";
import type { AbrufOptionen } from "../http/oeffentlicher-abruf";
import { schreibe } from "../schreiben";
import { lese } from "../zeitlimit";
import { callProvider } from "./access";
import { linkedRegisters } from "./links";
import { activeCompany, reconcile } from "./reconcile";
import type { DataProvider } from "./types";

/** Monitoring can only revisit the register identity previously selected on this company. */
export async function refreshLinked(db: Db, ring: Schluesselring | undefined, provider: DataProvider, id: string, http?: AbrufOptionen) {
  const previous = await lese(db, async tx => {
    const row = (await linkedRegisters(tx, id)).find(r => r.provider === provider.id);
    return row && { company: await activeCompany(tx, id), reference: row.reference, digest: row.digest };
  });
  if (!previous) return { status: "provider_not_found", entries: 0, events: 0 };
  const started = new Date();
  const { data, connectionId } = await callProvider(db, ring, provider, async (request, connectionId) =>
    ({ data: await provider.retrieve(request, previous.company, previous.reference), connectionId }), http);
  return schreibe(db, "system", async (tx, audit) => {
    await activeCompany(tx, id, true);
    const [watch] = await tx.select().from(registerBeobachtung).where(eq(registerBeobachtung.organisationId, id)).for("update");
    if (!watch?.aktiv) return { status: "skipped", entries: 0, events: 0 };
    const counts = await reconcile(tx, audit, id, provider, data, started, connectionId, previous.digest);
    return { status: "ok", ...counts };
  });
}
