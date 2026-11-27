import { echterTransport, leseBegrenzt, mitAbrufZeitlimit, pruefeAbrufZiel, type AbrufOptionen } from "../http/oeffentlicher-abruf";
import { ProviderError, type Provider, type ProviderRequest } from "./provider";

export function requestFor(provider: Provider, credential: string, options: AbrufOptionen = {}): ProviderRequest {
  return async (path, body) => {
    const url = new URL(path, provider.origin);
    const allowed = provider.allowsPath ? provider.allowsPath(url.pathname) : url.pathname.startsWith("/v2/") || provider.additionalPaths?.includes(url.pathname);
    if (url.origin !== provider.origin || url.protocol !== "https:" || !allowed) throw new ProviderError("invalid_page_url");
    const signal = AbortSignal.timeout(15_000);
    const { ip } = await mitAbrufZeitlimit(pruefeAbrufZiel(url.href, options.aufloeser), signal);
    const payload = body instanceof FormData ? new Response(body) : undefined;
    const contentType = payload?.headers.get("content-type") ?? "application/json";
    const response = await (options.transport ?? echterTransport)({
      url, ip, signal,
      headers: { ...provider.headers?.(url), ...(provider.credentials?.(credential) ?? { authorization: "Bearer " + credential }), accept: "application/json", "content-type": contentType },
      body: payload ? await payload.text() : body === undefined ? undefined : JSON.stringify(body),
    });
    try {
      if (response.status === 429 || response.status === 503 && response.kopf["retry-after"] !== undefined) {
        const resets = ["user", "org"].filter(key => response.kopf["x-ratelimit-limit-" + key + "-remaining"] === "0")
          .map(key => Number(response.kopf["x-ratelimit-limit-" + key + "-reset"])).filter(Number.isFinite);
        const delay = response.kopf["retry-after"] ?? (resets.length ? String(Math.max(...resets)) : undefined);
        const seconds = delay && !isNaN(Number(delay)) ? Number(delay) : delay ? (Date.parse(delay) - Date.now()) / 1000 : 30;
        throw new ProviderError("provider_rate_limit", Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : 30);
      }
      if (response.status !== 200) throw new ProviderError("provider_http_" + response.status);
      const result = await leseBegrenzt(response, 8 * 1024 * 1024);
      if (result.gekuerzt) throw new ProviderError("provider_page_too_large");
      return JSON.parse(result.bytes.toString("utf8")) as unknown;
    } finally {
      response.abbrechen();
    }
  };
}
