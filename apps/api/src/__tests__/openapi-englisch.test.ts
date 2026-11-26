import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUSNAHMEN_KERN, deutscherBestandteil, findeDeutscheBezeichner, pruefeEnglisch, wortbestandteile } from "../openapi-englisch";
import type { OpenApiDokument } from "../openapi";
import { json, oeffneTestdb } from "./hilfen";
import { erstelleTestApp } from "./hilfen-auth";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db, { erweiterungen: [] });

let doc: OpenApiDokument;
beforeAll(async () => {
  doc = await json(await t.request("/openapi.json", { als: null }));
});
afterAll(async () => {
  await pool.end();
});

describe("Erkennung deutscher Bezeichner", () => {
  it("zerlegt camelCase, kebab-case und snake_case", () => {
    expect(wortbestandteile("zeitraumVon")).toEqual(["zeitraum", "von"]);
    expect(wortbestandteile("werte-schluessel")).toEqual(["werte", "schluessel"]);
    expect(wortbestandteile("as_of_date")).toEqual(["as", "of", "date"]);
  });

  it("erkennt deutsche Wörter, Stämme, Umschriften und Umlaute", () => {
    for (const deutsch of ["fonds", "beteiligungen", "stichtag", "zeitraumVon", "kapitalkonto", "vergleichswaehrung", "geaendertSeit", "foerderprogramme", "art", "wiedervorlagen", "meldelaeufe", "größe", "fondsId", "neu-befuellen"]) {
      expect(deutscherBestandteil(deutsch), deutsch).not.toBeNull();
    }
  });

  it("lässt die englischen Begriffe des Glossars und übliche Feldnamen durch", () => {
    const englisch = [
      "funds", "investments", "capital-calls", "commitments", "reporting-runs", "balance-runs", "follow-ups", "asOf", "knowledgeDate", "organizations",
      "people", "contacts", "deals", "activities", "valuations", "valuation-rounds", "financing-rounds", "round-positions", "instruments", "tranches",
      "interest-runs", "receivables", "sales", "milestones", "metrics", "metric-requests", "reports", "report-templates", "resolution-templates",
      "documents", "extractions", "vouchers", "voucher-types", "account-rules", "posting-exports", "bookings", "transactions", "fund-movements",
      "exchange-rates", "currencies", "scenarios", "vehicles", "investors", "portal", "mailboxes", "attachments", "calendar", "settings", "theme",
      "users", "permissions", "api-keys", "audit-log", "changes", "health", "environment", "me", "search", "export", "import", "batch", "custom-fields",
      "id", "name", "status", "limit", "cursor", "changedSince", "amount", "currency", "date", "validFrom", "validTo", "dueDate", "comment", "note",
      "sort", "start", "value", "queue", "request", "unique", "does", "true", "type", "kind", "role", "roles", "area", "areas", "email", "website",
      "termination", "personal", "reserve", "standard", "openapi.json", "manifest.xml", "close", "reopen", "approve", "reverse", "recalculate",
    ];
    expect(englisch.filter((w) => deutscherBestandteil(w) !== null).map((w) => `${w}: ${deutscherBestandteil(w)}`)).toEqual([]);
  });

  it("findet Pfade, Parameter und verschachtelte Eigenschaften, Kopfzeilen nicht", () => {
    const beispiel = {
      paths: {
        "/funds/{fondsId}/close": {
          post: {
            parameters: [{ name: "stichtag", in: "query", schema: { type: "string" } }, { name: "Idempotency-Key", in: "header", schema: { type: "string" } }],
            requestBody: { content: { "application/json": { schema: { type: "object", properties: { amount: { type: "object", properties: { waehrung: { type: "string" } } } } } } } },
          },
        },
      },
    };
    expect(findeDeutscheBezeichner(beispiel).map((v) => `${v.wo} ${v.bezeichner}`)).toEqual(["path fondsId", "query stichtag", "body application/json waehrung"]);
  });

  it("Ausnahmen: der längste Präfix deckt, ungenutzte Einträge fallen auf, Parameter im Präfix passen auf jeden Namen", () => {
    const beispiel = { paths: { "/fonds/{id}/saldenlaeufe": { get: {} }, "/funds/{fundId}/zahlungen": { get: {} } } };
    const ergebnis = pruefeEnglisch(beispiel, { A: ["/fonds"], B: ["/fonds/{x}/saldenlaeufe", "/belege"] });
    expect(ergebnis.offen.map((v) => v.operation)).toEqual(["GET /funds/{fundId}/zahlungen"]);
    expect(ergebnis.ueberfluessig).toEqual(["A: /fonds", "B: /belege"]);
    expect(ergebnis.gedeckt).toEqual({ B: 2 });
  });
});

describe("OpenAPI des Kerns ist englisch (außer den Ausnahmen)", () => {
  it("hat keine deutschen Bezeichner außerhalb der Ausnahmeliste", () => {
    const { offen } = pruefeEnglisch(doc, AUSNAHMEN_KERN);
    expect(offen.map((v) => `${v.operation} – ${v.wo} ${v.bezeichner} (${v.grund})`)).toEqual([]);
  });

  it("hat keine überflüssigen Einträge in der Ausnahmeliste", () => {
    expect(pruefeEnglisch(doc, AUSNAHMEN_KERN).ueberfluessig).toEqual([]);
  });

  it("Titel, Beschreibungen, Zugriffshinweise und Fehlerschema sind englisch", () => {
    // Beschreibungen, Titel und Erweiterungen (`x-…`) in Operationen, Parametern und Körpern
    const texte: string[] = [doc.info.description];
    const sammle = (wert: unknown, schluessel = ""): void => {
      if (typeof wert === "string" && (schluessel === "description" || schluessel === "title" || schluessel === "summary" || schluessel.startsWith("x-"))) texte.push(wert);
      else if (Array.isArray(wert)) wert.forEach((w) => sammle(w));
      else if (wert && typeof wert === "object") for (const [k, v] of Object.entries(wert)) sammle(v, k);
    };
    sammle(doc.paths);
    expect(texte.filter((x) => /[äöüÄÖÜß]/.test(x))).toEqual([]);
    expect(JSON.stringify(doc.components)).not.toMatch(/[äöüÄÖÜß]/);
    expect(Object.keys((doc.components as { schemas: object }).schemas)).toEqual(expect.arrayContaining(["ErrorResponse", "FieldError", "CustomFields"]));
  });
});
