import type { Hono } from "hono";
import { z, type ZodType } from "zod";
import { fondsListenAbfrage } from "./routen/fonds";
import { sichtAbfrage } from "./routen/vorgaenge";
import { SCHEMA_KENNUNG, type SchemaMarke } from "./pruefung";
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
  "GET /fonds": fondsListenAbfrage,
  "GET /beteiligungen/:id/instrumentdaten": sichtAbfrage,
};

function jsonSchema(schema: ZodType): JsonSchema {
  const roh = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input", unrepresentable: "any", reused: "inline", cycles: "ref" }) as JsonSchema;
  delete roh.$schema;
  return roh;
}

const alsOpenApiPfad = (honoPfad: string) => honoPfad.replace(/:([A-Za-z0-9_]+)/g, "{$1}").replace(/\*/g, "{pfad}");

const parameterNamen = (pfad: string) => [...pfad.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]!);

const fehlerReferenz = { $ref: "#/components/schemas/Fehlerantwort" };

function zugriffText(regel: Regel | undefined): string {
  if (!regel) return "Nicht in der Berechtigungstabelle.";
  if (regel.zugriff === "oeffentlich") return "Ohne Anmeldung.";
  if (regel.zugriff === "angemeldet") return "Jede angemeldete Person.";
  if (regel.zugriff === "globalverwalter") return "Nur globale Verwalter.";
  if (regel.zugriff === "investor") return "Nur Investor-Benutzer des LP-Portals, beschränkt auf die Investor-Organisationen ihres Zugangs. Kein API-Schlüssel.";
  const mensch = regel.nurMensch ? " Nur Menschen, kein API-Schlüssel." : "";
  const ziele = regel.ziele?.length ? " am Fonds des Datensatzes" : " an irgendeinem Fonds";
  const bereich =
    regel.bereich === "allgemein" ? "" : regel.bereich === "alle" ? " Personen in Nutzergruppen brauchen alle Bereiche." : regel.bereich ? ` Bereich ${regel.bereich} (für Personen in Nutzergruppen).` : "";
  return `Mindestens die Rolle ${regel.rolle}${ziele}.${bereich}${mensch}`;
}

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
    const marke = (r.handler as unknown as Record<symbol, SchemaMarke | undefined>)[SCHEMA_KENNUNG];
    if (marke) eintrag.marken.push(marke);
    eintraege.set(schluessel, eintrag);
  }

  const paths: OpenApiDokument["paths"] = {};
  const tags = new Set<string>();
  for (const e of [...eintraege.values()].sort((a, b) => a.pfad.localeCompare(b.pfad) || a.methode.localeCompare(b.methode))) {
    const pfad = alsOpenApiPfad(e.pfad);
    const methode = e.methode.toLowerCase();
    const tag = e.pfad.split("/")[1] || "allgemein";
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
    if (e.methode === "POST") parameter.push({ $ref: "#/components/parameters/IdempotencyKey" });

    const operation: Record<string, unknown> = {
      operationId: `${methode}_${pfad.replace(/[{}]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "wurzel"}`,
      summary: `${e.methode} ${pfad}`,
      description: zugriffText(regel),
      tags: [tag],
      ...(parameter.length ? { parameters: parameter } : {}),
      responses: {
        "2XX": { description: "Erfolg" },
        "4XX": { description: "Fehler der Anfrage (Eingabe, Rechte, Zustand), einheitliches Fehlerformat", content: { "application/json": { schema: fehlerReferenz } } },
        "5XX": { description: "Fehler des Servers oder Zeitüberschreitung", content: { "application/json": { schema: fehlerReferenz } } },
      },
      security: regel?.zugriff === "oeffentlich" ? [] : [{ cookieAuth: [] }, { bearerAuth: [] }],
      "x-carraway-zugriff": regel ? { zugriff: regel.zugriff, ...(regel.rolle ? { rolle: regel.rolle } : {}), ...(regel.nurMensch ? { nurMensch: true } : {}) } : null,
    };
    const koerper = marke("json");
    if (koerper) operation.requestBody = { required: true, content: { "application/json": { schema: jsonSchema(koerper) } } };
    else if (e.pfad === "/import/laeufe" && e.methode === "POST") {
      operation.requestBody = {
        required: true,
        content: { "multipart/form-data": { schema: { type: "object", required: ["datei"], properties: { datei: { type: "string", contentEncoding: "binary", description: "Excel (.xlsx) oder CSV, höchstens 20 MB" } } } } },
      };
    }
    else if (e.methode === "POST" && (e.pfad === "/dokumente" || e.pfad === "/dokumente/:id/ersetzen")) {
      operation.requestBody = {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              required: e.pfad === "/dokumente" ? ["datei", "ziele"] : ["datei"],
              properties: {
                datei: { type: "string", contentEncoding: "binary", description: "PDF, PNG, JPEG, DOCX oder XLSX (Typ am Inhalt erkannt), höchstens 25 MB" },
                ...(e.pfad === "/dokumente"
                  ? {
                      ziele: { type: "string", description: 'JSON-Liste aus { "typ", "id" }; typ: beteiligung, deal, vorgang, organisation, fonds, bewertung, finanzierungsrunde' },
                      klassifikation: { type: "string", enum: ["vertrag", "beschluss", "bewertung", "bericht", "beleg", "sonstiges"] },
                      vertraulich: { type: "string", enum: ["true", "false"] },
                    }
                  : {}),
              },
            },
          },
        },
      };
    }
    else if (e.pfad === "/fonds/:id/saldenlaeufe" && e.methode === "POST") {
      operation.requestBody = {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              required: ["datei", "zeitraumVon", "zeitraumBis"],
              properties: {
                datei: { type: "string", contentEncoding: "binary", description: "Summen- und Saldenliste, Excel (.xlsx) oder CSV, höchstens 20 MB" },
                zeitraumVon: { type: "string", format: "date" },
                zeitraumBis: { type: "string", format: "date" },
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
        "Lesen und Schreiben der Fonds-, Portfolio- und Kontaktdaten, Import mit Prüfregeln, Vollexport, Änderungsabfrage und Stapel. Beträge sind Zeichenketten mit höchstens zwei Nachkommastellen. Fehler haben immer die Form `{ fehler: { code, meldung, felder? } }` mit stabilen Codes. POST-Aufrufe nehmen einen Kopf `Idempotency-Key` an. CRM (`/crm`): Unternehmen, Kontakte und Deals haben eigene Felder, die Verwalter je Objekt definieren. Die Werte stehen unter der ID der Felddefinition (`eigene`, Typen: text, langtext, zahl und betrag als Zeichenkette, datum `JJJJ-MM-TT`, auswahl als Optionsschlüssel, mehrfachauswahl als Liste, kontrollkaestchen, url, email, telefon, benutzer und verknuepfung als ID). Das Schema eines Objekts ist dynamisch und steht unter `GET /crm/objekte/{objekt}/felder` (Felder, Typen, Optionen, Operatoren je Typ); Abfragen (`POST /crm/objekte/{objekt}/abfrage`) verwenden dieselben Schlüssel in Filter, Sortierung und Spalten.",
    },
    servers: [{ url: PRAEFIX }],
    tags: [...tags].sort().map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        cookieAuth: { type: "apiKey", in: "cookie", name: "better-auth.session_token", description: "Sitzung der Oberfläche (Anmeldung unter /auth, zweiter Faktor Pflicht)." },
        bearerAuth: { type: "http", scheme: "bearer", description: "API-Schlüssel `cwk_…` eines technischen Benutzers, mit Rechten je Fonds." },
      },
      parameters: {
        IdempotencyKey: {
          name: "Idempotency-Key",
          in: "header",
          required: false,
          description: "Beliebiger eindeutiger Schlüssel (1 bis 200 druckbare ASCII-Zeichen). Gleicher Schlüssel und Körper: gleiche Antwort für 24 Stunden; anderer Körper: 409 IDEMPOTENZ_KONFLIKT.",
          schema: { type: "string", minLength: 1, maxLength: 200 },
        },
      },
      schemas: {
        Zusatzfelder: {
          type: "object",
          additionalProperties: true,
          description:
            "Werte eigener Felder an Fonds, Finanzierungsrunde, Instrument, Beteiligung und Vorgang sowie an Unternehmen, Kontakten und Deals. Die Schlüssel sind die IDs der Felddefinitionen, die Werte " +
            "folgen dem Typ der Definition (Text, Zahl und Betrag als Zeichenkette, Datum als JJJJ-MM-TT, Auswahl als Optionsschlüssel, Mehrfachauswahl als Liste, Kontrollkästchen als Wahrheitswert, " +
            "Person und Verknüpfung als ID). Das genaue Schema je Objekt liefert `GET /zusatzfelder/{objekt}/schema` (dynamisch, aus den aktiven Definitionen), die Definitionen " +
            "`GET /zusatzfelder/{objekt}/definitionen`. Beim Schreiben entfernt null einen Wert; Vorgänge tragen ihre Werte nur ab dem Anlegen.",
        },
        Feldfehler: { type: "object", required: ["feld", "code", "meldung"], properties: { feld: { type: "string" }, code: { type: "string" }, meldung: { type: "string" } } },
        Fehlerantwort: {
          type: "object",
          required: ["fehler"],
          properties: {
            fehler: {
              type: "object",
              required: ["code", "meldung"],
              properties: { code: { type: "string", description: "Stabiler, maschinenlesbarer Code, z. B. EINGABE_UNGUELTIG." }, meldung: { type: "string" }, felder: { type: "array", items: { $ref: "#/components/schemas/Feldfehler" } } },
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
 * hält die Werte gleich mit den Tokens und prüft den Kontrast. Petrol und Jade kennzeichnen Fokus und Links. Gold hebt Titel und Rubriken hervor.
 */
export const DOCS_PALETTE = {
  dunkel: { bg: "#0E2621", surface: "#102922", text: "#EEF3EE", "text-muted": "#B9CFC4", line: "#3D5C53", "line-strong": "#536A60", accent: "#7CCFC2", highlight: "#C4A25A" },
  hell: { bg: "#FAF9F6", surface: "#FFFFFF", text: "#18211D", "text-muted": "#505E56", line: "#D3D9D3", "line-strong": "#8A9A91", accent: "#096D69", highlight: "#806429" },
} as const;

const docsVariablen = (p: Record<keyof (typeof DOCS_PALETTE)["dunkel"], string>) =>
  `--bg:${p.bg};--surface:${p.surface};--text:${p.text};--muted:${p["text-muted"]};--line:${p.line};--line-strong:${p["line-strong"]};--accent:${p.accent};--highlight:${p.highlight}`;

/** Dokumentationsseite ohne Skripte und ohne externe Dateien, aus dem Dokument gerendert. */
export function erzeugeDocsHtml(doc: OpenApiDokument): string {
  const nachTag = new Map<string, string[]>();
  for (const [pfad, methoden] of Object.entries(doc.paths)) {
    for (const [methode, op] of Object.entries(methoden)) {
      const tag = (op.tags as string[])[0]!;
      const parameter = ((op.parameters as Record<string, unknown>[] | undefined) ?? []).filter((p) => !("$ref" in p));
      const zeilen = parameter.map((p) => `<tr><td><code>${maske(p.name)}</code></td><td>${maske(p.in)}</td><td>${p.required ? "ja" : "nein"}</td><td><code>${maske(JSON.stringify(p.schema))}</code></td></tr>`).join("");
      const koerper = (op.requestBody as { content: Record<string, { schema: unknown }> } | undefined)?.content;
      const html = `<details id="${maske(op.operationId)}"><summary><span class="m m-${maske(methode)}">${maske(methode.toUpperCase())}</span> <code>${maske(pfad)}</code></summary>
<p>${maske(op.description)}</p>
${zeilen ? `<table><thead><tr><th>Parameter</th><th>Ort</th><th>Pflicht</th><th>Schema</th></tr></thead><tbody>${zeilen}</tbody></table>` : ""}
${koerper ? Object.entries(koerper).map(([typ, c]) => `<p>Körper <code>${maske(typ)}</code></p><pre>${maske(JSON.stringify(c.schema, null, 2))}</pre>`).join("") : ""}
</details>`;
      (nachTag.get(tag) ?? nachTag.set(tag, []).get(tag)!).push(html);
    }
  }
  const abschnitte = [...nachTag.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([tag, liste]) => `<section><h2>${maske(tag)}</h2>${liste.join("\n")}</section>`);
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Carraway API</title>
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="${DOCS_PALETTE.dunkel.bg}" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="${DOCS_PALETTE.hell.bg}" media="(prefers-color-scheme: light)">
<style>
:root{color-scheme:dark;${docsVariablen(DOCS_PALETTE.dunkel)}}
@media (prefers-color-scheme:light){:root{color-scheme:light;${docsVariablen(DOCS_PALETTE.hell)}}}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 "Instrument Sans",system-ui,sans-serif}
main{max-width:60rem;margin:0 auto;padding:1.5rem 1rem 4rem}
h1{font-weight:650;letter-spacing:-.02em;font-size:1.6rem;margin:0 0 .25rem}h1::after{content:"";display:block;width:2.5rem;height:2px;margin-top:.5rem;background:var(--highlight)}
h2{display:flex;align-items:center;gap:.5rem;font-size:.8rem;margin:2rem 0 .5rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}h2::before{content:"";width:.75rem;height:2px;background:var(--highlight)}
p.lead{color:var(--muted);margin-top:.75rem}a{color:var(--text);text-decoration:underline;text-underline-offset:2px}a:hover{text-decoration-color:var(--accent);text-decoration-thickness:2px}
details{border-bottom:1px solid var(--line);padding:.4rem 0}summary{cursor:pointer;display:flex;gap:.6rem;align-items:baseline;flex-wrap:wrap}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
code,pre{font:13px "IBM Plex Mono",ui-monospace,monospace}pre{background:var(--surface);border:1px solid var(--line);padding:.75rem;overflow:auto;border-radius:6px}
table{border-collapse:collapse;width:100%;margin:.5rem 0}th,td{text-align:left;border-bottom:1px solid var(--line);padding:.25rem .5rem;vertical-align:top;overflow-wrap:anywhere}th{color:var(--muted);font-weight:500}
.m{display:inline-block;min-width:3.8rem;text-align:center;font:600 11px "IBM Plex Mono",ui-monospace,monospace;padding:.1rem .4rem;border-radius:4px;background:var(--surface);border:1px solid var(--line-strong);color:var(--text)}
</style></head><body><main>
<h1>Carraway API</h1>
<p class="lead">${maske(doc.info.description)} Maschinenlesbar: <a href="openapi.json">openapi.json</a> (OpenAPI ${maske(doc.openapi)}).</p>
${abschnitte.join("\n")}
</main></body></html>`;
}
