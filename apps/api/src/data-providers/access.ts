import { and, eq, sql } from "drizzle-orm";
import { providerConnection as connections, providerUsage as usage, type Db } from "@carraway/db";
import { ZodError } from "zod";
import { Fachfehler } from "../fehler";
import { GeheimnisFehler, type Schluesselring } from "../geheimnis/krypto";
import { credentialAad } from "../integrationen/connection";
import { requestFor } from "../integrationen/http";
import { ProviderError, type ProviderRequest } from "../integrationen/provider";
import type { AbrufOptionen } from "../http/oeffentlicher-abruf";
import type { DataProvider } from "./types";

export const currentMonth = () => new Date().toISOString().slice(0, 7) + "-01";
const missing = () => new Fachfehler(409, "provider_key_missing", "Configure a credential for this provider.");
const limited = (retryAt: Date) => new Fachfehler(429, "provider_rate_limited", "Try again after the rate limit resets.", { retryAt: retryAt.toISOString() });
function safeError(error: unknown) {
  if (error instanceof Fachfehler) return error;
  if (error instanceof ZodError || error instanceof SyntaxError) return new Fachfehler(502, "provider_response_invalid", "Invalid provider response.");
  if (error instanceof ProviderError) {
    if (error.code === "provider_rate_limit") return limited(new Date(Date.now() + Math.min(error.retrySeconds ?? 60, 86400 * 30) * 1000));
    if (["provider_http_401", "provider_http_403"].includes(error.code)) return new Fachfehler(409, "provider_key_invalid", "The provider rejected the credential.");
    if (error.code === "provider_http_404") return new Fachfehler(404, "provider_not_found", "The provider record was not found.");
    if (error.code === "provider_http_402") return new Fachfehler(409, "provider_quota_exceeded", "Provider quota exhausted.");
  }
  return new Fachfehler(502, "provider_unavailable", "The provider request failed.");
}

/** Reserve each outbound request under the connection lock, including searches, tests and pagination. */
export async function callProvider<T>(db: Db, ring: Schluesselring | undefined, adapter: DataProvider,
  run: (request: ProviderRequest, connectionId: string) => Promise<T>, http?: AbrufOptionen) {
  if (!ring) throw new Fachfehler(409, "secret_missing", "Credential encryption is unavailable.");
  const [connection] = await db.select().from(connections).where(eq(connections.provider, adapter.id));
  if (!connection) throw missing();
  // A concurrent key replacement must not spend the new key's budget or update its status.
  const same = and(eq(connections.id, connection.id), eq(connections.credential, connection.credential));
  const reserve = () => db.transaction(async tx => {
    const [current] = await tx.select().from(connections).where(same).for("update");
    if (!current) throw missing();
    const now = Date.now();
    if (current.retryAt && current.retryAt.getTime() > now) throw limited(current.retryAt);
    const window = adapter.rate.seconds * 1000;
    const recent = current.recentRequests.filter(time => time > now - window);
    if (recent.length >= adapter.rate.calls) throw limited(new Date(recent[0]! + window));
    const month = currentMonth();
    const [taken] = await tx.insert(usage).values({ provider: adapter.id, month, calls: 1 })
      .onConflictDoUpdate({ target: [usage.provider, usage.month], set: { calls: sql`${usage.calls} + 1` },
        setWhere: current.monthlyLimit ? sql`${usage.calls} < ${current.monthlyLimit}` : undefined }).returning();
    if (!taken) throw new Fachfehler(409, "provider_quota_exceeded", "Monthly request cap reached.");
    await tx.update(connections).set({ recentRequests: [...recent, now] }).where(same);
  });
  let transportError: unknown;
  try {
    const request = requestFor(adapter, ring.entschluessele(connection.credential, credentialAad(connection.id)), http);
    let reserved = adapter.reserveBeforeRun === true;
    if (reserved) await reserve();
    const value = await run(async (path, body) => {
      if (reserved) reserved = false;
      else await reserve();
      return request(path, body).catch((error: unknown) => {
        transportError = error;
        throw error;
      });
    }, connection.id);
    const saved = await db.update(connections).set({ lastError: null, checkedAt: new Date() }).where(same).returning({ id: connections.id });
    if (!saved.length) throw missing();
    return value;
  } catch (error) {
    const failure = safeError(error);
    const connectionFailure = error === transportError || error instanceof GeheimnisFehler || error instanceof ZodError ||
      (error instanceof Fachfehler && error.code === "provider_response_invalid");
    if (!connectionFailure || failure.code === "provider_not_found") throw failure;
    const retry = failure.zusatz?.retryAt;
    await db.update(connections).set({ lastError: failure.code, checkedAt: new Date(),
      ...(typeof retry === "string" ? { retryAt: sql`greatest(${connections.retryAt}, ${retry}::timestamptz)` } : {}) }).where(same);
    throw failure;
  }
}
