import type { ValidationTargets } from "hono";
import { z } from "zod";
import { berichtAnApi, berichtFeldAnApi, berichtFeldpfadAnApi, berichtEingabeVonApi, berichtWertAnApi, type BerichteApi, type BerichteBereich } from "./berichte-vertrag";
import { pruefe, SCHEMA_KENNUNG } from "./pruefung";

type Definition = z.core.$ZodTypes["_zod"]["def"];

/** Erst der öffentliche Zod-Eingang, dann dieselbe Fachprüfung wie für gespeicherte Werte. */
function eingang(bereich: BerichteBereich, schema: z.ZodType, feld?: string): z.ZodType {
  const def = schema.def as Definition;
  const kind = (unter: z.core.$ZodType) => eingang(bereich, unter as z.ZodType, feld);
  const wert = (x: unknown) => typeof x === "string" && feld ? berichtWertAnApi(bereich, feld, x) : x;

  switch (def.type) {
    case "object": {
      const shape = Object.fromEntries(Object.entries(def.shape).map(([name, unter]) => [
        berichtFeldAnApi(bereich, name), eingang(bereich, unter as z.ZodType, name),
      ]));
      // In JSON müssen auch optionale Felder ihren öffentlichen Namen benutzen.
      return z.strictObject(shape);
    }
    case "string":
      if (feld === "schluessel" && bereich === "report") {
        return schema.refine((x) => typeof x === "string" && wert(x) === x, "Use the public section key");
      }
      return schema;
    case "enum":
      return z.enum(Object.values(def.entries).map((x) => String(wert(x))));
    case "literal":
      return z.literal(def.values.map((x) => wert(x) as typeof x));
    case "array":
      return schema.clone({ ...def, element: kind(def.element) } as typeof schema.def);
    case "union":
      return z.union(def.options.map(kind));
    case "default": {
      const key = feld ?? "value";
      const aussen = berichtAnApi(bereich, { [key]: def.defaultValue }) as Record<string, unknown>;
      return kind(def.innerType).default(aussen[berichtFeldAnApi(bereich, key)]);
    }
    case "optional":
      return kind(def.innerType).optional();
    case "nullable":
      return kind(def.innerType).nullable();
    case "pipe":
      // Coercion und die übrigen Prüfungen bleiben im internen Schema.
      return kind(def.in);
    default:
      return schema;
  }
}

export function berichtSchema<B extends BerichteBereich, S extends z.ZodType>(bereich: B, schema: S) {
  return eingang(bereich, schema).transform((wert, ctx) => {
    const intern = schema.safeParse(berichtEingabeVonApi(bereich, wert));
    if (intern.success) return intern.data as z.output<S>;
    for (const issue of intern.error.issues) {
      ctx.addIssue({
        ...issue,
        path: issue.path.map((p) => typeof p === "string" ? berichtFeldpfadAnApi(bereich, p) : p),
      });
    }
    return z.NEVER;
  }) as z.ZodType<z.output<S>, BerichteApi<B, z.input<S>>>;
}

export const berichtPruefung = <B extends BerichteBereich>(bereich: B) =>
  <Ziel extends keyof ValidationTargets, S extends z.ZodType>(
    ziel: Ziel,
    schema: S,
    weitere: { query?: z.ZodType; param?: z.ZodType } = {},
    beschreibung?: z.ZodType,
  ) => {
    const validator = pruefe(ziel, berichtSchema(bereich, schema), {
      ...(weitere.query ? { query: berichtSchema(bereich, weitere.query) } : {}),
      ...(weitere.param ? { param: berichtSchema(bereich, weitere.param) } : {}),
    });
    // Die Definitionsprüfung meldet fachliche und strukturelle Befunde gemeinsam.
    if (beschreibung) validator[SCHEMA_KENNUNG].schema = beschreibung;
    return validator;
  };
