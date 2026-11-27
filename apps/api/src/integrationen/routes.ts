import { saveConnection } from "./connection";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { feldDefinition, providerConnection, providerItem, providerRun, type Db } from "@carraway/db";
import { Fachfehler } from "../fehler";
import type { Schluesselring } from "../geheimnis/krypto";
import { pruefe } from "../pruefung";
import { akteurAus, schreibe } from "../schreiben";
import { providers } from "./providers";
import { mappingSchema, resources } from "./provider";
import { active, clearItems } from "./runs";

const param = z.object({ provider: z.string().regex(/^[a-z0-9-]+$/) });
const runParam = z.object({ id: z.uuid() });
const setup = z.strictObject({ credential: z.string().trim().min(1).max(8192).regex(/^[\x21-\x7e]+$/).optional(), mapping: mappingSchema });
export function connections(db: Db, ring: Schluesselring | undefined, syncAvailable: boolean) {
  return new Hono()
    .get("/", async c => {
      const data = await db.select({ id: providerConnection.id, provider: providerConnection.provider, mapping: providerConnection.mapping, mode: providerConnection.mode }).from(providerConnection).where(inArray(providerConnection.provider, providers.map(p => p.id)));
      const definitions = await db.select({ id: feldDefinition.id, name: feldDefinition.name, object: feldDefinition.objekt, type: feldDefinition.typ }).from(feldDefinition)
        .where(and(isNull(feldDefinition.listeId), isNull(feldDefinition.archiviertAm), inArray(feldDefinition.objekt, ["person", "organisation", "deal"])));
      const customFields = definitions.filter(d => !["verknuepfung", "benutzer"].includes(d.type)).map(d => ({ id: d.id, name: d.name, resource: d.object === "organisation" ? "organization" : d.object }));
      return c.json({ data, customFields, providers: providers.map(p => p.id), syncAvailable });
    })
    .put("/:provider", pruefe("param", param), pruefe("json", setup), async c => {
      const { provider } = c.req.valid("param");
      const { credential, mapping } = c.req.valid("json");
      if (!providers.some(p => p.id === provider)) throw new Fachfehler(400, "invalid_input", "Unknown provider.");
      if (!ring) throw new Fachfehler(409, "secret_missing", "The credential encryption key is missing.");
      await schreibe(db, c, async (tx, audit) => {
        const [existing] = await tx.select().from(providerConnection).where(eq(providerConnection.provider, provider)).for("update");
        if (existing) {
          const [run] = await tx.select({ id: providerRun.id }).from(providerRun).where(and(eq(providerRun.connectionId, existing.id), inArray(providerRun.status, active)));
          if (existing.mode === "sync" || run) throw new Fachfehler(409, "invalid_input", "Stop synchronization and finish or cancel the active run before editing.");
        }
        const id = await saveConnection(tx, ring, provider, mapping, credential, existing);
        await audit("provider_configured", "provider_connection", id, null, { provider, mapping });
      });
      return c.json({ saved: true });
    })
    .post("/:provider/preview", pruefe("param", param), async c => {
      const id = await schreibe(db, c, async (tx, audit) => {
        const [conn] = await tx.select().from(providerConnection).where(eq(providerConnection.provider, c.req.valid("param").provider)).for("update");
        if (!conn) throw new Fachfehler(404, "not_found", "Connection not found.");
        if (!providers.some(p => p.id === conn.provider)) throw new Fachfehler(404, "not_found", "Unknown CRM provider.");
        if (conn.mode !== "import") throw new Fachfehler(409, "invalid_input", "Stop synchronization to import.");
        const [run] = await tx.insert(providerRun).values({ connectionId: conn.id, actor: akteurAus(c), kind: "import", mapping: conn.mapping }).onConflictDoNothing().returning();
        if (!run) throw new Fachfehler(409, "invalid_input", "A run is already active.");
        await audit("provider_preview", "provider_run", run.id, null, { provider: conn.provider });
        return run.id;
      });
      return c.json({ id }, 202);
    })
    .get("/:provider/runs", pruefe("param", param), async c => {
      const data = await db.select({ id: providerRun.id, kind: providerRun.kind, status: providerRun.status, received: providerRun.received, matched: providerRun.matched, applied: providerRun.applied,
        skipReasons: providerRun.skipReasons, error: providerRun.error, createdAt: providerRun.createdAt, pages: providerRun.pages }).from(providerRun)
        .innerJoin(providerConnection, eq(providerConnection.id, providerRun.connectionId)).where(eq(providerConnection.provider, c.req.valid("param").provider)).orderBy(desc(providerRun.createdAt)).limit(50);
      const sample = data[0]?.status === "preview" ? (await Promise.all(resources.map(resource => db.select({ record: providerItem.data }).from(providerItem).where(and(eq(providerItem.runId, data[0]!.id), eq(providerItem.resource, resource), isNull(providerItem.skipReason))).orderBy(asc(providerItem.sequence)).limit(3)))).flat() : [];
      return c.json({ data: data.map(run => ({ ...run, skipped: Object.values(run.skipReasons).reduce((sum, count) => sum + count, 0) })), sample });
    })
    .post("/runs/:id/apply", pruefe("param", runParam), async c => {
      await schreibe(db, c, async (tx, audit) => {
        const id = c.req.valid("param").id;
        const rows = await tx.update(providerRun).set({ status: "applying", actor: akteurAus(c) }).where(and(eq(providerRun.id, id), eq(providerRun.status, "preview"))).returning({ id: providerRun.id });
        if (!rows.length) throw new Fachfehler(409, "import_not_validated", "A completed preview is required.");
        await audit("provider_approved", "provider_run", id, null, {});
      });
      return c.json({ accepted: true }, 202);
    })
    .post("/runs/:id/cancel", pruefe("param", runParam), async c => {
      await schreibe(db, c, async (tx, audit) => {
        const id = c.req.valid("param").id;
        const rows = await tx.update(providerRun).set({ status: "cancelled" }).where(and(eq(providerRun.id, id), inArray(providerRun.status, active))).returning({ id: providerRun.id });
        if (!rows.length) throw new Fachfehler(409, "invalid_input", "The run is no longer active.");
        await clearItems(tx, id);
        await audit("provider_cancelled", "provider_run", id, null, {});
      });
      return c.json({ cancelled: true });
    });
}
