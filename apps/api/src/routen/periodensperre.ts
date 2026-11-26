import { pruefeFonds } from "../fonds-pruefung";
import { fondsAnApi } from "../fonds-vertrag";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { benutzer, periodensperre, type Db } from "@carraway/db";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { Fachfehler } from "../fehler";
import { heute, idParam, ladeFonds, schreibe, textEingabe } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";

const sperreEingabe = z.object({ gesperrtBis: z.iso.date(), grund: textEingabe(500).optional() });

async function ladeAnsicht(tx: Tx, fondsId: string) {
  const [zeile] = await tx
    .select({ sperre: periodensperre, gesetztVonName: benutzer.name })
    .from(periodensperre)
    .leftJoin(benutzer, sql`${benutzer.id}::text = ${periodensperre.gesetztVon}`)
    .where(eq(periodensperre.fondsId, fondsId));
  if (!zeile) return { fondsId, gesperrtBis: null, gesetztVon: null, gesetztVonName: null, gesetztAm: null, grund: null };
  return {
    fondsId,
    gesperrtBis: zeile.sperre.gesperrtBis,
    gesetztVon: zeile.sperre.gesetztVon,
    gesetztVonName: zeile.gesetztVonName,
    gesetztAm: zeile.sperre.gesetztAm.toISOString(),
    grund: zeile.sperre.grund,
  };
}

/** `GET/PUT /funds/:id/period-lock` (Verwalter). Zurücknehmen (früheres Datum) verlangt einen Grund und wird protokolliert. */
export function periodensperreRouten(db: Db) {
  return new Hono()
    .get("/", pruefeFonds("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const ansicht = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        return ladeAnsicht(tx, id);
      });
      return c.json(fondsAnApi(ansicht), 200);
    })
    .put("/", pruefeFonds("param", idParam), pruefeFonds("json", sperreEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const { gesperrtBis, grund } = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      if (gesperrtBis > heute()) {
        throw new Fachfehler(400, "invalid_input", "The input is invalid.", {
          felder: [{ feld: "gesperrtBis", code: "in_future", meldung: "The lock date must not be in the future" }],
        });
      }
      await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        const [vorher] = await tx.select().from(periodensperre).where(eq(periodensperre.fondsId, id)).for("update");
        const zurueck = vorher !== undefined && gesperrtBis < vorher.gesperrtBis;
        if (zurueck && !grund) {
          throw new Fachfehler(400, "invalid_input", "The input is invalid.", {
            felder: [{ feld: "grund", code: "reason_required", meldung: "A reason is required to lift the lock" }],
          });
        }
        const werte = { gesperrtBis, gesetztVon: akteur.id, gesetztAm: new Date(), grund: grund ?? null };
        const [nachher] = await tx
          .insert(periodensperre)
          .values({ fondsId: id, ...werte })
          .onConflictDoUpdate({ target: periodensperre.fondsId, set: werte })
          .returning();
        await protokoll(zurueck ? "periodensperre_zurueck" : "periodensperre_setzen", "fonds", id, vorher ?? null, nachher);
      });
      return c.json(fondsAnApi(await lese(db, (tx) => ladeAnsicht(tx, id))), 200);
    });
}
