import { setTimeout as wait } from "node:timers/promises";
import { ZodError } from "zod";
import { AbrufFehler } from "../http/oeffentlicher-abruf";
import { ProviderError } from "./provider";

/** Only classify failures at the outbound request boundary. Credentials and blocked targets are permanent. */
export function transient(error: unknown) {
  if (error instanceof ProviderError) return /^provider_http_5\d\d$/.test(error.code) || error.code === "provider_http_408";
  if (error instanceof AbrufFehler) return ["ABRUF_NICHT_AUFLOESBAR", "ABRUF_ZEITLIMIT", "ABRUF_FEHLER"].includes(error.code)
    || error.code === "ABRUF_STATUS" && (error.status === 408 || (error.status ?? 0) >= 500);
  if (error instanceof SyntaxError || error instanceof ZodError) return true;
  if (!(error instanceof Error)) return false;
  return ["TimeoutError", "AbortError"].includes(error.name) ||
    ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "ENETUNREACH", "ERR_STREAM_PREMATURE_CLOSE", "EHOSTUNREACH"].includes((error as NodeJS.ErrnoException).code ?? "");
}

/** Interactive retrieval retries this request only. Rate-limit windows remain visible to callers. */
export async function retryRequest<T>(request: () => Promise<T>) {
  for (let attempt = 0;; attempt++) {
    try { return await request(); }
    catch (error) {
      if (attempt >= 2 || !transient(error)) throw error;
      await wait(250 * 2 ** attempt);
    }
  }
}
