import { Hono } from "hono";
import { erzeugeDocsHtml, erzeugeOpenApi, type OpenApiDokument } from "../openapi";
import type { Regelwerk } from "../rechte/tabelle";

/** `GET /openapi.json` (OpenAPI 3.1) und `GET /docs` (Seite ohne Skripte und ohne externe Dateien), beide ohne Anmeldung. */
export function openapiRouten(holeApp: () => Hono, regelwerk?: Regelwerk) {
  let dokument: OpenApiDokument | undefined;
  let seite: string | undefined;
  const doc = () => (dokument ??= erzeugeOpenApi(holeApp(), undefined, regelwerk));
  return new Hono()
    .get("/openapi.json", (c) => c.json(doc(), 200))
    .get("/docs", (c) => {
      seite ??= erzeugeDocsHtml(doc());
      return c.html(seite, 200, { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
    });
}
