import type { ValidationTargets } from "hono";
import { z } from "zod";
import { fondsAnApi, fondsEnumAnApi, fondsFeldAnApi, type FondsApi } from "./fonds-vertrag";
import { pruefe, SCHEMA_KENNUNG } from "./pruefung";

type Eingabe = { schema: z.ZodType; intern: (wert: unknown) => unknown };
const identisch = (wert: unknown) => wert;

/** Öffentliches Eingabeschema mit Rückabbildung vor den fachlichen Prüfungen. */
function eingang(schema: z.ZodType, feld?: string): Eingabe {
  const def = schema.def as z.core.$ZodTypes["_zod"]["def"];
  const unter = (typ: z.core.$ZodType) => eingang(typ as z.ZodType, feld);
  switch (def.type) {
    case "object": {
      const felder = Object.entries(def.shape).map(([innen, s]) => ({
        innen, aussen: fondsFeldAnApi(innen), eingabe: eingang(s as z.ZodType, innen),
      }));
      const form = Object.fromEntries(felder.map(({ aussen, eingabe }) => [aussen, eingabe.schema]));
      return {
        schema: def.catchall?._zod.def.type === "never" ? z.strictObject(form) : z.object(form),
        intern: (wert) => {
          if (!wert || typeof wert !== "object" || Array.isArray(wert)) return wert;
          const objekt = wert as Record<string, unknown>;
          return Object.fromEntries(felder.filter(({ aussen }) => Object.hasOwn(objekt, aussen))
            .map(({ innen, aussen, eingabe }) => [innen, eingabe.intern(objekt[aussen])]));
        },
      };
    }
    case "literal":
    case "enum": {
      const werte = def.type === "enum" ? Object.values(def.entries) : def.values;
      const intern = new Map(werte.map((wert) => [typeof wert === "string" ? fondsEnumAnApi(wert) : wert, wert]));
      return {
        schema: z.literal([...intern.keys()]),
        intern: (wert) => intern.get(wert as z.core.util.Literal) ?? wert,
      };
    }
    case "array": {
      const item = unter(def.element);
      return {
        schema: schema.clone({ ...def, element: item.schema } as typeof schema.def),
        intern: (wert) => Array.isArray(wert) ? wert.map(item.intern) : wert,
      };
    }
    case "record": {
      const item = unter(def.valueType);
      return {
        schema: z.record(def.keyType as z.ZodString, item.schema),
        intern: (wert) => wert && typeof wert === "object" && !Array.isArray(wert)
          ? Object.fromEntries(Object.entries(wert).map(([key, value]) => [key, item.intern(value)]))
          : wert,
      };
    }
    case "default": {
      const item = unter(def.innerType);
      const name = feld ?? "value";
      return { ...item, schema: item.schema.default(fondsAnApi({ [name]: def.defaultValue })[fondsFeldAnApi(name)]) };
    }
    case "optional": {
      const item = unter(def.innerType);
      return { schema: item.schema.optional(), intern: (wert) => wert === undefined ? wert : item.intern(wert) };
    }
    case "nullable": {
      const item = unter(def.innerType);
      return { schema: item.schema.nullable(), intern: (wert) => wert === null ? wert : item.intern(wert) };
    }
    case "union": {
      const varianten = def.options.map(unter);
      return {
        schema: z.union(varianten.map((x) => x.schema)),
        intern: (wert) => varianten.find((x) => x.schema.safeParse(wert).success)?.intern(wert) ?? wert,
      };
    }
    case "pipe":
      // Transformationen und anschließende Prüfungen erfolgen im internen Schema.
      return unter(def.in);
    default:
      return { schema, intern: identisch };
  }
}

function fondsSchema<S extends z.ZodType>(schema: S) {
  const publiziert = eingang(schema);
  const validierung = z.unknown().transform((wert, ctx) => {
    const englisch = publiziert.schema.safeParse(wert);
    const intern = schema.safeParse(publiziert.intern(englisch.success ? englisch.data : wert));
    if (englisch.success && intern.success) return intern.data as z.output<S>;

    // Fachliche Prüfungen auf Objekten können zusätzliche Felder betreffen,
    // auch wenn ein anderes Feld schon im öffentlichen Schema scheitert.
    const pfade = new Set<string>();
    if (!englisch.success) {
      for (const issue of englisch.error.issues) {
        ctx.addIssue({ ...issue });
        pfade.add(issue.path.map(String).join("."));
      }
    }
    if (!intern.success) {
      for (const issue of intern.error.issues) {
        const path = issue.path.map((teil) => typeof teil === "string" ? fondsFeldAnApi(teil) : teil);
        if (!pfade.has(path.map(String).join("."))) ctx.addIssue({ ...issue, path });
      }
    }
    return z.NEVER;
  }) as z.ZodType<z.output<S>, FondsApi<z.input<S>>>;
  return { schema: publiziert.schema, validierung };
}

export function pruefeFonds<Ziel extends keyof ValidationTargets, S extends z.ZodType>(
  ziel: Ziel,
  schema: S,
  weitere: { query?: z.ZodType; param?: z.ZodType } = {},
) {
  const { schema: oeffentlich, validierung } = fondsSchema(schema);
  const pruefung = pruefe(ziel, validierung, {
    ...(weitere.query ? { query: fondsSchema(weitere.query).validierung } : {}),
    ...(weitere.param ? { param: fondsSchema(weitere.param).validierung } : {}),
  }, "fonds");
  pruefung[SCHEMA_KENNUNG].schema = oeffentlich;
  return pruefung;
}
