import type { ValidationTargets } from "hono";
import { z } from "zod";
import { portfolioAnApi, portfolioEnumAnApi, portfolioEnumVonApi, portfolioFeldAnApi, portfolioMetrikAnApi, portfolioMetrikVonApi, type PortfolioApi } from "./portfolio-vertrag";
import { pruefe } from "./pruefung";

type Eingabe = { schema: z.ZodType; intern: (wert: unknown) => unknown; liste?: true };
const identisch = (wert: unknown) => wert;

/**
 * Öffentlicher Zod-Eingang und Rückabbildung für die interne Fachprüfung.
 * Eigene Felder bleiben unter ihren jeweiligen ID-Schlüsseln erhalten.
 */
function eingang(schema: z.ZodType, feld?: string): Eingabe {
  const def = schema.def as z.core.$ZodTypes["_zod"]["def"];
  const kind = (unter: z.core.$ZodType) => eingang(unter as z.ZodType, feld);

  switch (def.type) {
    case "object": {
      const felder = Object.entries(def.shape).map(([innen, s]) => {
        const eingabe = eingang(s as z.ZodType, innen);
        const aussen = innen === "schluessel" && eingabe.liste ? "metricKeys" : portfolioFeldAnApi(innen);
        return { innen, aussen, eingabe };
      });
      return {
        schema: z.object(Object.fromEntries(felder.map(({ aussen, eingabe }) => [aussen, eingabe.schema]))),
        intern: (wert) => {
          const objekt = wert as Record<string, unknown>;
          return Object.fromEntries(felder.filter(({ aussen }) => Object.hasOwn(objekt, aussen)).map(({ innen, aussen, eingabe }) => [innen, eingabe.intern(objekt[aussen])]));
        },
      };
    }
    case "string":
      if (feld !== "schluessel") return { schema, intern: identisch };
      return {
        schema: z.string().regex(/^[a-z][a-z0-9_]{1,66}$/).refine((key) => portfolioMetrikAnApi(portfolioMetrikVonApi(key)) === key, "Use the metric key from the catalog"),
        intern: (wert) => portfolioMetrikVonApi(wert as string),
      };
    case "enum": {
      const werte = Object.values(def.entries).map(String);
      return {
        schema: z.enum(werte.map(portfolioEnumAnApi)),
        intern: (wert) => {
          const innen = portfolioEnumVonApi(wert as string);
          return werte.includes(innen) ? innen : wert;
        },
      };
    }
    case "array": {
      const item = kind(def.element);
      return {
        schema: schema.clone({ ...def, element: item.schema } as typeof schema.def),
        intern: (wert) => (wert as unknown[]).map(item.intern),
        liste: true,
      };
    }
    case "default": {
      const item = kind(def.innerType);
      const name = feld ?? "value";
      return { ...item, schema: item.schema.default(portfolioAnApi({ [name]: def.defaultValue })[portfolioFeldAnApi(name)]), intern: item.intern };
    }
    case "optional": {
      const item = kind(def.innerType);
      return { ...item, schema: item.schema.optional(), intern: (wert) => wert === undefined ? wert : item.intern(wert) };
    }
    case "nullable": {
      const item = kind(def.innerType);
      return { ...item, schema: item.schema.nullable(), intern: (wert) => wert === null ? wert : item.intern(wert) };
    }
    case "union": {
      const varianten = def.options.map(kind);
      return {
        schema: z.union(varianten.map((x) => x.schema)),
        intern: (wert) => varianten.find((x) => x.schema.safeParse(wert).success)!.intern(wert),
      };
    }
    default:
      return { schema, intern: identisch };
  }
}

function portfolioSchema<S extends z.ZodType>(schema: S): z.ZodType<z.output<S>, PortfolioApi<z.input<S>>> {
  const publiziert = eingang(schema);
  return publiziert.schema.transform((value, ctx) => {
    const intern = schema.safeParse(publiziert.intern(value));
    if (intern.success) return intern.data as z.output<S>;
    for (const issue of intern.error.issues) ctx.addIssue({ ...issue, path: issue.path.map((p) => typeof p === "string" ? portfolioFeldAnApi(p) : p) });
    return z.NEVER;
  }) as z.ZodType<z.output<S>, PortfolioApi<z.input<S>>>;
}

export function pruefePortfolio<Ziel extends keyof ValidationTargets, S extends z.ZodType>(
  ziel: Ziel,
  schema: S,
  weitere: { query?: z.ZodType; param?: z.ZodType } = {},
) {
  return pruefe(ziel, portfolioSchema(schema), {
    ...(weitere.query ? { query: portfolioSchema(weitere.query) } : {}),
    ...(weitere.param ? { param: portfolioSchema(weitere.param) } : {}),
  }, true);
}
