import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "@carraway/db";
import type { Speicher } from "../berichte/speicher";
import { vollexport } from "../export/vollexport";
import { pruefe } from "../pruefung";
import { KEIN_DATENSATZ, protokolliereLesen } from "../schreiben";

/** Vollexport als ZIP-Strom, nur für globale Verwalter; jeder Abruf steht als `gelesen` im Änderungsprotokoll. */
export function exportRoute(db: Db, speicher: Speicher) {
  return new Hono().get("/", pruefe("query", z.object({ format: z.enum(["zip"]).default("zip") })), async (c) => {
    const zeit = new Date();
    await protokolliereLesen(db, c, "export", KEIN_DATENSATZ, { format: "zip", art: "vollexport", zeitpunkt: zeit.toISOString() });
    const quelle = vollexport(db, speicher, zeit);
    const strom = new ReadableStream<Uint8Array>({
      async pull(kontrolle) {
        try {
          const n = await quelle.next();
          if (n.done) kontrolle.close();
          else kontrolle.enqueue(n.value);
        } catch (fehler) {
          console.error(fehler);
          kontrolle.error(fehler);
        }
      },
      async cancel() {
        await quelle.return(undefined);
      },
    });
    return new Response(strom, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="carraway-export-${zeit.toISOString().slice(0, 10)}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
