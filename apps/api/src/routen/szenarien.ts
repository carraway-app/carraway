import { eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { erzeugeSzenarioberichtExcel, erzeugeSzenarioberichtPdf } from "@carraway/berichte";
import { z } from "zod";
import { beteiligung, reserve, szenario, type Db } from "@carraway/db";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { Fachfehler } from "../fehler";
import { pruefe } from "../pruefung";
import { hatPostgresCode, MAX_RESERVE } from "../szenarien/konstanten";
import { annahmenSchema } from "../szenarien/annahmen";
import { ladeSzenarioberichtDaten } from "../szenarien/bericht";
import { annahmenVon, ergebnisHash, ergebnisVon, kopf, ladeSzenarien, ladeSzenario, vergleiche, type SzenarioZeile } from "../szenarien/dienst";
import { rechneSzenario, type SzenarioErgebnis } from "../szenarien/rechnen";
import { ladeReserven, ladeReserveVerlauf } from "../szenarien/reserven";
import { berechneFondsUebersicht } from "../kennzahlen/fonds";
import { heute, idParam, ladeFonds, optionalerText, protokolliereLesen, schreibe, textEingabe } from "../schreiben";
import { lese } from "../zeitlimit";

const datum = z.iso.date();

const neuesSzenario = z.object({ name: textEingabe(120), basisStichtag: datum.optional(), annahmen: annahmenSchema });
const aenderungSzenario = z
  .object({ name: textEingabe(120).optional(), basisStichtag: datum.optional(), annahmen: annahmenSchema.optional() })
  .refine((v) => v.name !== undefined || v.basisStichtag !== undefined || v.annahmen !== undefined, { message: "Mindestens ein Feld muss angegeben werden", path: [] });

const vergleichAbfrage = z.object({
  ids: z
    .string()
    .transform((s) => s.split(",").map((t) => t.trim()).filter(Boolean))
    .pipe(z.array(z.uuid()).min(1).max(3))
    .refine((l) => new Set(l).size === l.length, { message: "Szenarien nur einmal angeben" }),
});

const reserveAbfrage = z.object({ stichtag: datum.optional(), szenarioId: z.uuid().optional() });

const reserveEingabe = z.object({
  betrag: z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, "Betrag mit höchstens zwei Nachkommastellen erwartet"),
  gueltigAb: datum,
  bemerkung: optionalerText(500),
});

const berichtAbfrage = z.object({ format: z.enum(["pdf", "xlsx"]).default("pdf"), sprache: z.enum(["de", "en"]).default("de") });
const vergleichBericht = berichtAbfrage.extend({ ids: vergleichAbfrage.shape.ids });

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "szenario";

async function berichtAntwort(db: Db, c: Context, fondsId: string, zeilen: SzenarioZeile[], format: "pdf" | "xlsx", sprache: "de" | "en", protokoll: { tabelle: "fonds" | "szenario"; id: string }) {
  const daten = await lese(db, (tx) => ladeSzenarioberichtDaten(tx, fondsId, zeilen));
  await protokolliereLesen(db, c, protokoll.tabelle, protokoll.id, { bericht: "szenarien", format, sprache, szenarien: zeilen.map((z) => z.id) });
  const name = `${sprache === "de" ? "szenarien" : "scenarios"}-${slug(daten.fonds.kurzname)}-${slug(zeilen.map((z) => z.name).join("-")).slice(0, 60)}`;
  const inhalt = format === "xlsx" ? await erzeugeSzenarioberichtExcel(daten, sprache) : erzeugeSzenarioberichtPdf(daten, sprache);
  return c.body(Buffer.from(inhalt), 200, {
    "Content-Type": format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf",
    "Content-Disposition": `attachment; filename="${name}.${format}"`,
    "Cache-Control": "no-store",
  });
}

const nameVorhanden =() => new Fachfehler(409, "SZENARIO_NAME_VORHANDEN", "Es gibt schon ein Szenario mit diesem Namen in diesem Fonds.");
const festgeschrieben = () => new Fachfehler(409, "SZENARIO_FESTGESCHRIEBEN", "Das Szenario ist festgeschrieben und nicht mehr änderbar.");

/** Szenarien am Fonds: Liste, Anlegen, Vorlage, Vergleich, Reserven. Unter `/fonds`. */
export function szenarioFondsRouten(db: Db) {
  return new Hono()
    .get("/:id/szenarien", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const zeilen = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        return ladeSzenarien(tx, id);
      });
      return c.json({ daten: zeilen.map(kopf) }, 200);
    })
    .post("/:id/szenarien", pruefe("param", idParam), pruefe("json", neuesSzenario), async (c) => {
      const { id } = c.req.valid("param");
      const { name, basisStichtag, annahmen } = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        const basis = basisStichtag ?? heute();
        await rechneSzenario(tx, id, basis, annahmen); // prüft Basistag, Jahre und Beteiligungen
        let zeile;
        try {
          [zeile] = await tx.transaction((st) => st.insert(szenario).values({ fondsId: id, name, basisStichtag: basis, annahmen, erstelltVon: protokoll.akteur }).returning());
        } catch (fehler) {
          if (hatPostgresCode(fehler, "23505")) throw nameVorhanden();
          throw fehler;
        }
        await protokoll("anlegen", "szenario", zeile!.id, null, zeile);
        return zeile!;
      });
      return c.json(kopf(neu), 201);
    })
    .get("/:id/szenarien/vorlage", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const tag = heute();
      return c.json(
        await lese(db, async (tx) => {
          await ladeFonds(tx, id);
          const ue = await berechneFondsUebersicht(tx, id, tag);
          return {
            basisStichtag: tag,
            beteiligungen: ue.beteiligungen
              .filter((b) => b.status === "aktiv")
              .map((b) => ({ id: b.id, organisation: b.organisation.name, instrument: b.instrument, wert: b.letzteBewertung?.wert ?? null, investiert: b.investiert })),
          };
        }),
        200,
      );
    })
    .get("/:id/szenarien/vergleich", pruefe("param", idParam), pruefe("query", vergleichAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { ids } = c.req.valid("query");
      return c.json(
        await lese(db, async (tx) => {
          await ladeFonds(tx, id);
          const zeilen = await ladeSzenarien(tx, id, ids);
          if (zeilen.length !== ids.length) throw new Fachfehler(404, "SZENARIO_NICHT_GEFUNDEN", "Szenario nicht gefunden.");
          const geordnet = ids.map((i) => zeilen.find((z) => z.id === i)!);
          const ergebnisse: SzenarioErgebnis[] = [];
          for (const z of geordnet) ergebnisse.push((await ergebnisVon(tx, z)).ergebnis);
          return { fondsId: id, szenarien: geordnet.map((z, i) => ({ ...kopf(z), ergebnis: ergebnisse[i]! })), vergleich: vergleiche(ergebnisse) };
        }),
        200,
      );
    })
    .get("/:id/szenarien/bericht", pruefe("param", idParam), pruefe("query", vergleichBericht), async (c) => {
      const { id } = c.req.valid("param");
      const { ids, format, sprache } = c.req.valid("query");
      const zeilen = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        const z = await ladeSzenarien(tx, id, ids);
        if (z.length !== ids.length) throw new Fachfehler(404, "SZENARIO_NICHT_GEFUNDEN", "Szenario nicht gefunden.");
        return ids.map((i) => z.find((x) => x.id === i)!);
      });
      return berichtAntwort(db, c, id, zeilen, format, sprache, { tabelle: "fonds", id });
    })
    .get("/:id/reserven", pruefe("param", idParam), pruefe("query", reserveAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { stichtag, szenarioId } = c.req.valid("query");
      return c.json(await lese(db, (tx) => ladeReserven(tx, id, { stichtag, szenarioId })), 200);
    });
}

/** Ein Szenario: lesen, ändern, löschen, duplizieren, festschreiben. Unter `/szenarien`. */
export function szenarioRouten(db: Db) {
  return new Hono()
    .get("/:id", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      return c.json(
        await lese(db, async (tx) => {
          const z = await ladeSzenario(tx, id);
          const { ergebnis, pruefsumme } = await ergebnisVon(tx, z);
          return { ...kopf(z), annahmen: annahmenVon(z), ergebnis, pruefsumme };
        }),
        200,
      );
    })
    .get("/:id/bericht", pruefe("param", idParam), pruefe("query", berichtAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { format, sprache } = c.req.valid("query");
      const z = await lese(db, (tx) => ladeSzenario(tx, id));
      return berichtAntwort(db, c, z.fondsId, [z], format, sprache, { tabelle: "szenario", id });
    })
    .patch("/:id", pruefe("param", idParam), pruefe("json", aenderungSzenario), async (c) => {
      const { id } = c.req.valid("param");
      const aenderung = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeSzenario(tx, id);
        if (vorher.status === "festgeschrieben") throw festgeschrieben();
        const basis = aenderung.basisStichtag ?? vorher.basisStichtag;
        const annahmen = aenderung.annahmen ?? annahmenVon(vorher);
        await rechneSzenario(tx, vorher.fondsId, basis, annahmen);
        let zeile;
        try {
          [zeile] = await tx.transaction((st) =>
            st.update(szenario).set({ name: aenderung.name ?? vorher.name, basisStichtag: basis, annahmen, geaendertAm: new Date() }).where(eq(szenario.id, id)).returning(),
          );
        } catch (fehler) {
          if (hatPostgresCode(fehler, "23505")) throw nameVorhanden();
          throw fehler;
        }
        await protokoll("aendern", "szenario", id, vorher, zeile);
        return zeile!;
      });
      return c.json(kopf(neu), 200);
    })
    .delete("/:id", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeSzenario(tx, id);
        if (vorher.status === "festgeschrieben") throw festgeschrieben();
        await tx.delete(szenario).where(eq(szenario.id, id));
        await protokoll("loeschen", "szenario", id, vorher, null);
      });
      return c.body(null, 204);
    })
    .post("/:id/duplizieren", pruefe("param", idParam), pruefe("json", z.object({ name: textEingabe(120).optional() }).default({})), async (c) => {
      const { id } = c.req.valid("param");
      const { name } = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const quelle = await ladeSzenario(tx, id);
        let zeile;
        try {
          [zeile] = await tx.transaction((st) =>
            st
              .insert(szenario)
              .values({ fondsId: quelle.fondsId, name: name ?? `${quelle.name} (Kopie)`.slice(0, 120), basisStichtag: quelle.basisStichtag, annahmen: quelle.annahmen, erstelltVon: protokoll.akteur })
              .returning(),
          );
        } catch (fehler) {
          if (hatPostgresCode(fehler, "23505")) throw nameVorhanden();
          throw fehler;
        }
        await protokoll("anlegen", "szenario", zeile!.id, null, zeile);
        return zeile!;
      });
      return c.json(kopf(neu), 201);
    })
    .post("/:id/festschreiben", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const [vorher] = await tx.select().from(szenario).where(eq(szenario.id, id)).for("update");
        if (!vorher) throw new Fachfehler(404, "SZENARIO_NICHT_GEFUNDEN", "Szenario nicht gefunden.");
        if (vorher.status === "festgeschrieben") throw festgeschrieben();
        const stand = new Date();
        const ergebnis = await rechneSzenario(tx, vorher.fondsId, vorher.basisStichtag, annahmenVon(vorher), stand.toISOString());
        const hash = ergebnisHash({ annahmen: vorher.annahmen, basisStichtag: vorher.basisStichtag, wissensstand: stand.toISOString(), ergebnis });
        const [zeile] = await tx
          .update(szenario)
          .set({ status: "festgeschrieben", ergebnis, ergebnisHash: hash, wissensstand: stand, festgeschriebenAm: stand, festgeschriebenVon: akteur.id, geaendertAm: stand })
          .where(eq(szenario.id, id))
          .returning();
        await protokoll("festschreiben", "szenario", id, { status: vorher.status }, { status: zeile!.status, ergebnisHash: hash, wissensstand: stand.toISOString() });
        return zeile!;
      });
      return c.json(kopf(neu), 200);
    });
}

/** Reserve je Beteiligung: Verlauf lesen, neue Planung erfassen. Unter `/beteiligungen`. */
export function reserveRouten(db: Db) {
  return new Hono()
    .get("/:id/reserve", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      return c.json({ daten: await lese(db, (tx) => ladeReserveVerlauf(tx, id)) }, 200);
    })
    .put("/:id/reserve", pruefe("param", idParam), pruefe("json", reserveEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      if (Number(e.betrag) > MAX_RESERVE) throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Der Betrag ist zu groß.");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const [b] = await tx.select({ id: beteiligung.id }).from(beteiligung).where(eq(beteiligung.id, id));
        if (!b) throw new Fachfehler(404, "BETEILIGUNG_NICHT_GEFUNDEN", "Beteiligung nicht gefunden.");
        const [zeile] = await tx.insert(reserve).values({ beteiligungId: id, betrag: e.betrag, gueltigAb: e.gueltigAb, bemerkung: e.bemerkung ?? null, erfasstVon: protokoll.akteur }).returning();
        await protokoll("anlegen", "reserve", zeile!.id, null, zeile);
        return zeile!;
      });
      return c.json(neu, 201);
    });
}
