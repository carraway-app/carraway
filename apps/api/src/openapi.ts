import { findTargetHandler } from "hono/utils/handler";
import type { Hono } from "hono";
import { z, type ZodType } from "zod";
import { kontaktSchema } from "./kontakte/http";
import { fondsListenAbfrage } from "./routen/fonds";
import { SCHEMA_KENNUNG, type SchemaMarke } from "./pruefung";
import { BEREICH_AN_API, STUFE_AN_API } from "./rechte/api-namen";
import { erstelleRegelwerk, type Regel, type Regelwerk } from "./rechte/tabelle";

/**
 * OpenAPI 3.1 aus den Routen der App. Aufbau, Pfade und Methoden stammen aus den registrierten Hono-Routen, die Schemata für
 * Pfad, Abfrage und Körper aus den Zod-Schemata der Validatoren (`pruefe()` merkt sie sich an der Route; Zod erzeugt daraus JSON Schema
 * 2020-12, wie es OpenAPI 3.1 verlangt). Rechte kommen aus der Berechtigungstabelle. Antworten sind allgemein beschrieben (Erfolg und das
 * einheitliche Fehlerformat), weil die Handler keine Antwortschemata deklarieren.
 */

const PRAEFIX = "/api/v1";

type JsonSchema = Record<string, unknown>;

/** Abfrageparameter, die Handler selbst lesen (`liesAbfrage`) und deshalb nicht am Validator hängen. */
const ZUSATZ_ABFRAGEN: Record<string, ZodType> = {
  "GET /funds": fondsListenAbfrage,
};

function internesJsonSchema(schema: ZodType): JsonSchema {
  const roh = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input", unrepresentable: "any", reused: "inline", cycles: "ref" }) as JsonSchema;
  delete roh.$schema;
  return roh;
}

const jsonSchema = (schema: ZodType) => kontaktSchema(schema, internesJsonSchema);

const alsOpenApiPfad = (honoPfad: string) => honoPfad.replace(/:([A-Za-z0-9_]+)/g, "{$1}").replace(/\*/g, "{path}");

const parameterNamen = (pfad: string) => [...pfad.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]!);

const fehlerReferenz = { $ref: "#/components/schemas/ErrorResponse" };

/** Englische Namen der Zugriffsarten für Dokument und Docs-Seite; Rollen und Bereiche in `rechte/api-namen.ts` (Entscheidung 520). */
const ZUGRIFF_EN: Record<Regel["zugriff"], string> = { oeffentlich: "public", angemeldet: "authenticated", rolle: "role", globalverwalter: "global_admin", investor: "investor" };
const ROLLE_EN = STUFE_AN_API;
const BEREICH_EN = BEREICH_AN_API;

function zugriffText(regel: Regel | undefined): string {
  if (!regel) return "Not in the permission table.";
  if (regel.zugriff === "oeffentlich") return "No authentication required.";
  if (regel.zugriff === "angemeldet") return "Any authenticated person.";
  if (regel.zugriff === "globalverwalter") return "Global admins only.";
  if (regel.zugriff === "investor") return "Investor users of the LP portal only, limited to the investor organizations of their access. No API key.";
  if (regel.leseTransport) return "Read-only transport for API keys with a fund role. Each tool checks access through its HTTP endpoint.";
  const mensch = regel.nurMensch ? " People only, no API key." : "";
  const ziele = regel.ziele?.length ? " on the fund of the record" : " on any fund";
  const bereich =
    regel.bereich === "allgemein" ? "" : regel.bereich === "alle" ? " Members of user groups need all areas." : regel.bereich ? ` Area ${BEREICH_EN[regel.bereich]} (for members of user groups).` : "";
  return `At least the role ${regel.rolle ? ROLLE_EN[regel.rolle] : "viewer"}${ziele}.${bereich}${mensch}`;
}

/** Zugriff einer Operation als Erweiterung `x-carraway-access`. */
const zugriffAngabe = (regel: Regel) => ({
  access: ZUGRIFF_EN[regel.zugriff],
  ...(regel.rolle ? { role: ROLLE_EN[regel.rolle] } : {}),
  ...(regel.bereich && regel.bereich !== "allgemein" ? { area: BEREICH_EN[regel.bereich] } : {}),
  ...(regel.nurMensch ? { humanOnly: true } : {}),
});

export interface OpenApiDokument {
  openapi: "3.1.0";
  info: { title: string; version: string; description: string };
  servers: { url: string }[];
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: Record<string, unknown>;
  tags: { name: string }[];
}

/** Erzeugt das Dokument aus den Routen der fertigen App. */
export function erzeugeOpenApi(app: Hono, version = "0.1.0", regelwerk: Regelwerk = erstelleRegelwerk()): OpenApiDokument {
  type Eintrag = { methode: string; pfad: string; marken: SchemaMarke[] };
  const eintraege = new Map<string, Eintrag>();
  for (const r of app.routes) {
    if (r.method === "ALL" || !r.path.startsWith(`${PRAEFIX}/`)) continue;
    const honoPfad = r.path.slice(PRAEFIX.length);
    const schluessel = `${r.method} ${honoPfad}`;
    const eintrag = eintraege.get(schluessel) ?? { methode: r.method, pfad: honoPfad, marken: [] };
    const marke = (findTargetHandler(r.handler) as unknown as Record<symbol, SchemaMarke | undefined>)[SCHEMA_KENNUNG];
    if (marke) eintrag.marken.push(marke);
    eintraege.set(schluessel, eintrag);
  }

  const paths: OpenApiDokument["paths"] = {};
  const tags = new Set<string>();
  for (const e of [...eintraege.values()].sort((a, b) => a.pfad.localeCompare(b.pfad) || a.methode.localeCompare(b.methode))) {
    const pfad = alsOpenApiPfad(e.pfad);
    const methode = e.methode.toLowerCase();
    const tag = e.pfad.split("/")[1] || "general";
    tags.add(tag);
    const regel = regelwerk.finde(e.methode, e.pfad.replace(/:[A-Za-z0-9_]+/g, "x").replace(/\*/g, "x"));
    const marke = (ziel: SchemaMarke["ziel"]) => e.marken.find((m) => m.ziel === ziel)?.schema;

    const parameter: Record<string, unknown>[] = [];
    const pfadSchema = marke("param") ? jsonSchema(marke("param")!) : undefined;
    for (const name of parameterNamen(pfad)) {
      const eigenschaft = (pfadSchema?.properties as Record<string, unknown> | undefined)?.[name];
      parameter.push({ name, in: "path", required: true, schema: eigenschaft ?? { type: "string" } });
    }
    const abfrageSchema = marke("query") ?? ZUSATZ_ABFRAGEN[`${e.methode} ${e.pfad}`];
    if (abfrageSchema) {
      const s = jsonSchema(abfrageSchema);
      const pflicht = new Set((s.required as string[] | undefined) ?? []);
      for (const [name, schema] of Object.entries((s.properties as Record<string, unknown> | undefined) ?? {})) {
        parameter.push({ name, in: "query", required: pflicht.has(name), schema });
      }
    }
    if (e.methode === "POST" && !regel?.leseTransport) parameter.push({ $ref: "#/components/parameters/IdempotencyKey" });

    const operation: Record<string, unknown> = {
      operationId: `${methode}_${pfad.replace(/[{}]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "root"}`,
      summary: `${e.methode} ${pfad}`,
      description: zugriffText(regel),
      tags: [tag],
      ...(parameter.length ? { parameters: parameter } : {}),
      responses: {
        "2XX": { description: "Success" },
        "4XX": { description: "Client error (input, permissions, state) in the uniform error format", content: { "application/json": { schema: fehlerReferenz } } },
        "5XX": { description: "Server error or timeout", content: { "application/json": { schema: fehlerReferenz } } },
      },
      security: regel?.zugriff === "oeffentlich" ? [] : regel?.leseTransport ? [{ bearerAuth: [] }] : [{ cookieAuth: [] }, { bearerAuth: [] }],
      "x-carraway-access": regel ? zugriffAngabe(regel) : null,
    };
    const koerper = marke("json");
    if (koerper) operation.requestBody = { required: true, content: { "application/json": { schema: jsonSchema(koerper) } } };
    else if (e.pfad === "/import/runs" && e.methode === "POST") {
      operation.requestBody = {
        required: true,
        content: { "multipart/form-data": { schema: { type: "object", required: ["file"], properties: { file: { type: "string", contentEncoding: "binary", description: "Excel (.xlsx) or CSV, at most 20 MB" } } } } },
      };
    }
    else if (e.methode === "POST" && (e.pfad === "/documents" || e.pfad === "/documents/:id/replace")) {
      operation.requestBody = {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              required: e.pfad === "/documents" ? ["file", "targets"] : ["file"],
              properties: {
                file: { type: "string", contentEncoding: "binary", description: "PDF, PNG, JPEG, DOCX or XLSX (type detected from the content), at most 25 MB" },
                ...(e.pfad === "/documents"
                  ? {
                      targets: { type: "string", description: 'JSON list of { "type", "id" }; type: investment, deal, transaction, organization, fund, valuation, financing_round' },
                      classification: { type: "string", enum: ["contract", "resolution", "valuation", "report", "voucher", "other_document"] },
                      confidential: { type: "string", enum: ["true", "false"] },
                    }
                  : {}),
              },
            },
          },
        },
      };
    }
    else if (e.pfad === "/funds/:id/balance-runs" && e.methode === "POST") {
      operation.requestBody = {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              required: ["file", "periodFrom", "periodTo"],
              properties: {
                file: { type: "string", contentEncoding: "binary", description: "Trial balance, Excel (.xlsx) or CSV, at most 20 MB" },
                periodFrom: { type: "string", format: "date" },
                periodTo: { type: "string", format: "date" },
              },
            },
          },
        },
      };
    }
    (paths[pfad] ??= {})[methode] = operation;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Carraway API",
      version,
      description:
        "Read and write fund, portfolio and contact data, import with validation rules, full export, change feed and batches. Amounts are decimal strings with at most two decimal places; dates use ISO 8601 (`YYYY-MM-DD`). Errors always have the form `{ error: { code, message, fields? } }` with stable codes in snake_case; `message` is English and meant for developers, user interfaces translate by `code`. POST calls accept an `Idempotency-Key` header. CRM (`/crm`): companies, contacts and deals have custom fields that admins define per object. Values are keyed by the ID of the field definition (`customFields`; types: text, long_text, number and amount as strings, date as `YYYY-MM-DD`, select as option key, multi_select as list, checkbox, url, email, phone, and user and link as IDs). The schema of an object is dynamic and available at `GET /crm/objects/{object}/fields` (fields, types, options, operators per type); queries (`POST /crm/objects/{object}/query`) use the same keys in filters, sorting and columns. See `docs/api-glossary.md` for naming conventions and legacy names.",
    },
    servers: [{ url: PRAEFIX }],
    tags: [...tags].sort().map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        cookieAuth: { type: "apiKey", in: "cookie", name: "better-auth.session_token", description: "Session of the web application (sign-in under /auth, second factor required)." },
        bearerAuth: { type: "http", scheme: "bearer", description: "API key `cwk_…` of a technical user, with permissions per fund." },
      },
      parameters: {
        IdempotencyKey: {
          name: "Idempotency-Key",
          in: "header",
          required: false,
          description: "Any unique key (1 to 200 printable ASCII characters). A matching request replays its response for 24 hours. One-time responses return 409 idempotency_replay_unavailable on retry. Different content returns 409 idempotency_conflict.",
          schema: { type: "string", minLength: 1, maxLength: 200 },
        },
      },
      schemas: {
        CustomFields: {
          type: "object",
          additionalProperties: true,
          description:
            "Values of custom fields on funds, financing rounds, instruments, investments and transactions as well as on companies, contacts and deals. The keys are the IDs of the field definitions, the values " +
            "follow the type of the definition (text, number and amount as strings, date as YYYY-MM-DD, single select as option key, multi select as list, checkbox as boolean, " +
            "person and link as ID). The exact schema per object is available at `GET /custom-fields/{object}/schema` (dynamic, from the active definitions), the definitions at " +
            "`GET /custom-fields/{object}/definitions`. When writing, null removes a value; transactions carry their values only from creation onwards.",
        },
        FieldError: {
          type: "object",
          required: ["field", "code", "message"],
          properties: {
            field: { type: "string", description: "Name of the field, nested fields joined with a dot." },
            code: { type: "string", description: "Code of the failed check, e.g. too_small or invalid_format." },
            message: { type: "string" },
          },
        },
        ErrorResponse: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string", description: "Stable, machine-readable code in snake_case, e.g. invalid_input." },
                message: { type: "string", description: "English description for developers; user interfaces translate by code." },
                fields: { type: "array", items: { $ref: "#/components/schemas/FieldError" } },
              },
              additionalProperties: true,
            },
          },
        },
      },
    },
  };
}

// HTML-Seite ---------------------------------------------------------------------------------------------------------------

const maske = (t: unknown) => String(t).replace(/[&<>"']/g, (z) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[z]!);

/**
 * Farben der Hilfeseite: die Werte der semantischen Tokens des Designsystems (`design/tokens.json`, gleiche Namen), in beiden Themen. Die Seite hat
 * keine Skripte und keine Datei dazu, sie folgt dem Betriebssystem (`prefers-color-scheme`); ohne Angabe gilt wie in der Anwendung Dunkel. Ein Test
 * hält die Werte gleich mit den Tokens und prüft den Kontrast. Petrol und Jade kennzeichnen Fokus, Links und die Striche an Titel und Rubriken.
 */
export const DOCS_PALETTE = {
  dunkel: { bg: "#0E2621", surface: "#102922", text: "#EEF3EE", "text-muted": "#B9CFC4", line: "#3D5C53", "line-strong": "#536A60", accent: "#7CCFC2" },
  hell: { bg: "#FAF9F6", surface: "#FFFFFF", text: "#18211D", "text-muted": "#505E56", line: "#D3D9D3", "line-strong": "#8A9A91", accent: "#096D69" },
} as const;

const docsVariablen = (p: Record<keyof (typeof DOCS_PALETTE)["dunkel"], string>) =>
  `--bg:${p.bg};--surface:${p.surface};--text:${p.text};--muted:${p["text-muted"]};--line:${p.line};--line-strong:${p["line-strong"]};--accent:${p.accent}`;

/** Dokumentationsseite ohne Skripte und ohne externe Dateien, aus dem Dokument gerendert. */
export function erzeugeDocsHtml(doc: OpenApiDokument): string {
  const nachTag = new Map<string, string[]>();
  for (const [pfad, methoden] of Object.entries(doc.paths)) {
    for (const [methode, op] of Object.entries(methoden)) {
      const tag = (op.tags as string[])[0]!;
      const parameter = ((op.parameters as Record<string, unknown>[] | undefined) ?? []).filter((p) => !("$ref" in p));
      const zeilen = parameter.map((p) => `<tr><td><code>${maske(p.name)}</code></td><td>${maske(p.in)}</td><td>${p.required ? "yes" : "no"}</td><td><code>${maske(JSON.stringify(p.schema))}</code></td></tr>`).join("");
      const koerper = (op.requestBody as { content: Record<string, { schema: unknown }> } | undefined)?.content;
      const html = `<details id="${maske(op.operationId)}"><summary><span class="m m-${maske(methode)}">${maske(methode.toUpperCase())}</span> <code>${maske(pfad)}</code></summary>
<p>${maske(op.description)}</p>
${zeilen ? `<table><thead><tr><th>Parameter</th><th>In</th><th>Required</th><th>Schema</th></tr></thead><tbody>${zeilen}</tbody></table>` : ""}
${koerper ? Object.entries(koerper).map(([typ, c]) => `<p>Body <code>${maske(typ)}</code></p><pre>${maske(JSON.stringify(c.schema, null, 2))}</pre>`).join("") : ""}
</details>`;
      (nachTag.get(tag) ?? nachTag.set(tag, []).get(tag)!).push(html);
    }
  }
  const abschnitte = [...nachTag.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([tag, liste]) => `<section><h2>${maske(tag)}</h2>${liste.join("\n")}</section>`);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Carraway API</title>
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="${DOCS_PALETTE.dunkel.bg}" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="${DOCS_PALETTE.hell.bg}" media="(prefers-color-scheme: light)">
<style>
:root{color-scheme:dark;${docsVariablen(DOCS_PALETTE.dunkel)}}
@media (prefers-color-scheme:light){:root{color-scheme:light;${docsVariablen(DOCS_PALETTE.hell)}}}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 "Instrument Sans",system-ui,sans-serif}
main{max-width:60rem;margin:0 auto;padding:1.5rem 1rem 4rem}
h1{font-weight:650;letter-spacing:-.02em;font-size:1.6rem;margin:0 0 .25rem}h1::after{content:"";display:block;width:2.5rem;height:2px;margin-top:.5rem;background:var(--accent)}
h2{display:flex;align-items:center;gap:.5rem;font-size:.8rem;margin:2rem 0 .5rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}h2::before{content:"";width:.75rem;height:2px;background:var(--accent)}
p.lead{color:var(--muted);margin-top:.75rem}a{color:var(--text);text-decoration:underline;text-underline-offset:2px}a:hover{text-decoration-color:var(--accent);text-decoration-thickness:2px}
details{border-bottom:1px solid var(--line);padding:.4rem 0}summary{cursor:pointer;display:flex;gap:.6rem;align-items:baseline;flex-wrap:wrap}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
code,pre{font:13px "IBM Plex Mono",ui-monospace,monospace}pre{background:var(--surface);border:1px solid var(--line);padding:.75rem;overflow:auto;border-radius:6px}
table{border-collapse:collapse;width:100%;margin:.5rem 0}th,td{text-align:left;border-bottom:1px solid var(--line);padding:.25rem .5rem;vertical-align:top;overflow-wrap:anywhere}th{color:var(--muted);font-weight:500}
.m{display:inline-block;min-width:3.8rem;text-align:center;font:600 11px "IBM Plex Mono",ui-monospace,monospace;padding:.1rem .4rem;border-radius:4px;background:var(--surface);border:1px solid var(--line-strong);color:var(--text)}
</style></head><body><main>
<h1>Carraway API</h1>
<p class="lead">${maske(doc.info.description)} Machine-readable: <a href="openapi.json">openapi.json</a> (OpenAPI ${maske(doc.openapi)}).</p>
${abschnitte.join("\n")}
</main></body></html>`;
}
