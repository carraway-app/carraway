import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { erzeugeDemodaten, schreibeDemodaten } from "@carraway/db/demo";
import { leeren, oeffneTestdb } from "./hilfen";
import { ladeExitListe, ladePortfolioListe } from "../berichte/daten";
import { berechneFondsUebersicht } from "../kennzahlen/fonds";
import { ermittleBeteiligungsstatus } from "../kennzahlen/beteiligungsstatus";
import { ladeInstrumentdaten } from "../instrumente/daten";

/** Demofonds: Eine Beteiligung, die heute ausgeschieden ist, steht vor ihrem Ausstieg im Bestand und danach in der Exitliste. */

const { db, pool } = oeffneTestdb();
let fondsId = "";
let name = "";
let ausstieg = "";

beforeAll(async () => {
  await schreibeDemodaten(db, erzeugeDemodaten({ seed: 1 }));
  const { rows } = await db.execute<{ fonds_id: string; name: string; valuta: string }>(sql`
    SELECT b.fonds_id, o.name, max(v.valuta)::text AS valuta
    FROM beteiligung b JOIN organisation o ON o.id = b.organisation_id JOIN vorgang v ON v.beteiligung_id = b.id
    WHERE b.status = 'exit' AND v.art = 'rueckfluss' AND v.betrag > 0
    GROUP BY b.fonds_id, o.name ORDER BY max(v.valuta) DESC LIMIT 1`);
  fondsId = rows[0]!.fonds_id;
  name = rows[0]!.name;
  ausstieg = rows[0]!.valuta;
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const tagVor = (d: string) => new Date(Date.parse(d) - 86_400_000).toISOString().slice(0, 10);

describe("Beteiligungsstatus im Demofonds", () => {
  it("vor dem Ausstieg aktiv in Fondsübersicht und Portfolioliste, nicht in der Exitliste; danach umgekehrt", async () => {
    const vor = tagVor(ausstieg);
    const [pv, ev, uv] = await db.transaction(async (tx) => [await ladePortfolioListe(tx, fondsId, vor, undefined, "j"), await ladeExitListe(tx, fondsId, vor, undefined, "j"), await berechneFondsUebersicht(tx, fondsId, vor)] as const);
    expect(pv!.zeilen.some((z) => z.organisation === name && z.status === "aktiv")).toBe(true);
    expect(ev!.zeilen.some((z) => z.organisation === name)).toBe(false);
    expect(uv.beteiligungen.find((b) => b.organisation.name === name)?.status).toBe("aktiv");

    const [pn, en] = await db.transaction(async (tx) => [await ladePortfolioListe(tx, fondsId, ausstieg, undefined, "j"), await ladeExitListe(tx, fondsId, ausstieg, undefined, "j")] as const);
    expect(pn!.zeilen.some((z) => z.organisation === name)).toBe(false);
    expect(en!.zeilen.some((z) => z.organisation === name)).toBe(true);
  });
});

describe("Exits im Demofonds (Issue #193)", () => {
  it("jede ausgeschiedene Beteiligung ist über einen Verkauf oder (Darlehen) eine Rückzahlung ausgeschieden; zum Exit-Tag sind Buchwert und offenes Kapital null", async () => {
    const { rows } = await db.execute<{ id: string; datum: string; verkauf: boolean }>(sql`
      SELECT b.id, max(v.valuta)::text AS datum, EXISTS (SELECT 1 FROM verkauf vk WHERE vk.beteiligung_id = b.id AND vk.storniert_am IS NULL) AS verkauf
      FROM beteiligung b JOIN vorgang v ON v.beteiligung_id = b.id AND v.art = 'rueckfluss'
      WHERE b.status = 'exit' GROUP BY b.id ORDER BY b.id`);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.some((r) => r.verkauf)).toBe(true);
    expect(rows.some((r) => !r.verkauf)).toBe(true);
    for (const { id, datum, verkauf } of rows) {
      const [daten, status] = await db.transaction(async (tx) => [await ladeInstrumentdaten(tx, id, { stichtag: datum }), await ermittleBeteiligungsstatus(tx, { beteiligungId: id }, datum)] as const);
      expect(daten!.buchwert.wert, id).toBe("0.00");
      // Offenes Kapital gibt es nur bei darlehensartigen Instrumenten (wie in der Oberfläche).
      for (const i of daten!.instrumente.filter((x) => x.darlehensartig)) expect(i.offenesKapital, i.id).toBe("0.00");
      for (const i of daten!.instrumente) expect(i.status).toBe("verkauft");
      expect(status.get(id)).toEqual({ status: "exit", austritt: { datum, durchVerkauf: verkauf } });
    }
  });
});
