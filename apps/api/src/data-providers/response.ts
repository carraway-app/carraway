import { z } from "zod";
import { retryRequest } from "../integrationen/retry";
import type { ProviderRequest } from "../integrationen/provider";

/** Validate the envelope within the retry boundary so earlier pages and their quota stay untouched. */
export function readPage<T>(request: ProviderRequest, path: string, schema: z.ZodType<T>, body?: object) {
  return retryRequest(async () => schema.parse(await request(path, body)));
}

export function validItems<T>(items: unknown[], schema: z.ZodType<T>): T[] {
  return items.flatMap(item => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export const itemList = <T>(schema: z.ZodType<T>) => z.array(z.unknown()).transform(items => validItems(items, schema));
