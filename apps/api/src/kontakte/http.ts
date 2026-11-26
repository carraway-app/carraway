import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { aufDeutsch, aufEnglisch, englischerEnumWert, englischerFeldname, type Englisch } from "./api-namen";
import { pruefe } from "../pruefung";

const englischeSchemata = new WeakMap<z.ZodType, z.ZodType>();

function englisch<S extends z.ZodType>(schema: S, crm: boolean) {
  const uebersetzt = z.transform((wert: Englisch<z.input<S>>, ctx): z.output<S> => {
    const intern = aufDeutsch(wert, crm, (path) => {
      ctx.addIssue({ code: "custom", path, message: "Use the English field name or enum value." });
    });
    if (ctx.issues.length > 0) return z.NEVER;
    const ergebnis = schema.safeParse(intern);
    if (ergebnis.success) return ergebnis.data;
    for (const issue of ergebnis.error.issues) {
      if (issue.code === "invalid_value") {
        const feld = String(issue.path.findLast((teil) => typeof teil === "string") ?? "");
        const values = issue.values.map((v) => typeof v === "string" ? englischerEnumWert(feld, v) : v);
        ctx.addIssue({ ...issue, values, message: `Expected one of: ${values.map(String).join(", ")}` });
      } else if (issue.code === "unrecognized_keys") {
        ctx.addIssue({ ...issue, message: `Unrecognized keys: ${issue.keys.map(englischerFeldname).join(", ")}` });
      } else {
        ctx.addIssue({ ...issue });
      }
    }
    return z.NEVER;
  });
  englischeSchemata.set(uebersetzt, schema);
  return uebersetzt;
}

type Ziel = "param" | "query" | "json";

export function pruefeEnglisch<Z extends Ziel, S extends z.ZodType>(ziel: Z, schema: S) {
  return pruefe(ziel, englisch(schema, true));
}

export function pruefeKontakt<Z extends Ziel, S extends z.ZodType>(ziel: Z, schema: S) {
  return pruefe(ziel, englisch(schema, false));
}

export function kontaktJson<T, S extends ContentfulStatusCode>(c: Context, wert: T, status: S, gruppenfeld?: string) {
  return c.json(aufEnglisch(wert, c.req.path.startsWith("/api/v1/crm/") || c.req.path.startsWith("/api/v1/dealflow/"), gruppenfeld), status);
}

type Schema = Record<string, unknown>;

function englischeBeschreibung(schema: Schema, feld = ""): Schema {
  const { properties, required, enum: werte, const: konstante, default: vorgabe, items, anyOf, allOf, oneOf, propertyNames, additionalProperties, ...rest } = schema;
  const name = (wert: unknown) => typeof wert === "string" ? englischerEnumWert(feld, wert) : wert;
  const istSchema = (wert: unknown): wert is Schema => typeof wert === "object" && wert !== null;
  const eigenschaft = (k: string) => {
    const v = (properties as Record<string, Schema> | undefined)?.[k];
    if (k === "eigene" && (v?.type === "boolean" || Array.isArray(v?.enum))) return "own";
    if (k === "benutzer" && v?.type === "string") return "username";
    return englischerFeldname(k);
  };
  return {
    ...rest,
    ...(istSchema(properties) && { properties: Object.fromEntries(Object.entries(properties).map(([k, v]) => [eigenschaft(k), englischeBeschreibung(v as Schema, k)])) }),
    ...(Array.isArray(required) && { required: required.map(eigenschaft) }),
    ...(Array.isArray(werte) && { enum: werte.map(name) }),
    ...(konstante !== undefined && { const: name(konstante) }),
    ...(vorgabe !== undefined && { default: name(vorgabe) }),
    ...(istSchema(items) && { items: englischeBeschreibung(items, feld) }),
    ...(Array.isArray(anyOf) && { anyOf: anyOf.map((eintrag) => englischeBeschreibung(eintrag, feld)) }),
    ...(Array.isArray(allOf) && { allOf: allOf.map((eintrag) => englischeBeschreibung(eintrag, feld)) }),
    ...(Array.isArray(oneOf) && { oneOf: oneOf.map((eintrag) => englischeBeschreibung(eintrag, feld)) }),
    ...(propertyNames !== undefined && { propertyNames: istSchema(propertyNames) && Array.isArray(propertyNames.enum)
      ? { ...propertyNames, enum: propertyNames.enum.map(englischerFeldname) }
      : propertyNames }),
    ...(additionalProperties !== undefined && { additionalProperties: istSchema(additionalProperties) ? englischeBeschreibung(additionalProperties, feld) : additionalProperties }),
  };
}

/** OpenAPI beschreibt die Eingabe des Zod-Validators vor der Abbildung auf interne Namen. */
export function kontaktSchema(schema: z.ZodType, beschreibe: (schema: z.ZodType) => Schema): Schema {
  const intern = englischeSchemata.get(schema);
  return intern ? englischeBeschreibung(beschreibe(intern)) : beschreibe(schema);
}
