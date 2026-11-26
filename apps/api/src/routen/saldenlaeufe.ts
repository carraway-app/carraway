import { createHash } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { erzeugeAuswertungExcel, erzeugeAuswertungPdf, type AuswertungExportDaten } from "@carraway/berichte";
import { fonds, gliederungSicht, saldenlauf, saldenlaufBefund, saldo, type Db } from "@carraway/db";
import { erkenneDateityp, kappeParams } from "@carraway/import";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { aktiverLauf, ladeAuswertung, stimmeLiquiditaetAb, stimmePortfolioAb, type SichtName } from "../buchhaltung/auswertung";
import { MAX_BEFUNDE_SUSA, pruefeSaldenlauf } from "../buchhaltung/saldenpruefung";
import { Fachfehler } from "../fehler";
import { pruefe } from "../pruefung";
import { idParam, ladeFonds, protokolliereLesen, schreibe } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";
import { MAX_UPLOAD } from "./import";

/**
 * Summen- und Saldenlisten (Etappe 14): hochladen und prüfen = bearbeiter, übernehmen = freigeber (eine andere Person als Hochladende
 * und Prüfende). Auswertungen je Zeitraum lesen = betrachter, exportieren = bearbeiter mit Zeile `gelesen` im Protokoll.
 */

const ohneDatei = {
  id: saldenlauf.id,
  fondsId: saldenlauf.fondsId,
  zeitraumVon: saldenlauf.zeitraumVon,
  zeitraumBis: saldenlauf.zeitraumBis,
  dateiname: saldenlauf.dateiname,
  dateityp: saldenlauf.dateityp,
  format: saldenlauf.format,
  groesse: saldenlauf.groesse,
  sha256: saldenlauf.sha256,
  status: saldenlauf.status,
  hochgeladenVon: saldenlauf.hochgeladenVon,
  hochgeladenAm: saldenlauf.hochgeladenAm,
  geprueftVon: saldenlauf.geprueftVon,
  geprueftAm: saldenlauf.geprueftAm,
  fehlerAnzahl: saldenlauf.fehlerAnzahl,
  warnungAnzahl: saldenlauf.warnungAnzahl,
  summe: saldenlauf.summe,
  uebernommenVon: saldenlauf.uebernommenVon,
  uebernommenAm: saldenlauf.uebernommenAm,
  ersetztAm: saldenlauf.ersetztAm,
  ersetztVonLaufId: saldenlauf.ersetztVonLaufId,
};

const datum = z.iso.date();
const bisAbfrage = z.object({ bis: datum });
const sichtParam = z.object({ id: z.uuid(), sicht: z.enum(gliederungSicht.enumValues) });
const dateiAbfrage = z.object({ bis: datum, format: z.enum(["pdf", "xlsx"]).default("pdf"), sprache: z.enum(["de", "en"]).default("de") });

async function ladeLauf(tx: Tx, id: string, sperren = false) {
  const abfrage = tx.select().from(saldenlauf).where(eq(saldenlauf.id, id));
  const [lauf] = await (sperren ? abfrage.for("update") : abfrage);
  if (!lauf) throw new Fachfehler(404, "SALDENLAUF_NICHT_GEFUNDEN", "Saldenliste nicht gefunden.");
  return lauf;
}

async function speichereBefunde(tx: Tx, laufId: string, befunde: { zeile: number | null; spalte: string | null; code: string; schweregrad: string; meldung: string; params: unknown }[]) {
  await tx.delete(saldenlaufBefund).where(eq(saldenlaufBefund.laufId, laufId));
  const sortiert = [...befunde].sort((a, b) => Number(b.schweregrad === "fehler") - Number(a.schweregrad === "fehler"));
  const zeilen = sortiert.slice(0, MAX_BEFUNDE_SUSA).map((b, i) => ({ laufId, nr: i + 1, zeile: b.zeile, spalte: b.spalte, code: b.code, schweregrad: b.schweregrad, meldung: b.meldung.slice(0, 2000), params: kappeParams(b.params) }));
  for (let i = 0; i < zeilen.length; i += 500) await tx.insert(saldenlaufBefund).values(zeilen.slice(i, i + 500));
}

const zaehle = (b: { schweregrad: string }[]) => ({ fehler: b.filter((x) => x.schweregrad === "fehler").length, warnungen: b.filter((x) => x.schweregrad === "warnung").length });

export function fondsSaldenRouten(db: Db) {
  return new Hono()
    /** Hochladen (multipart: `datei`, `zeitraumVon`, `zeitraumBis`); ändert noch keine Auswertung. */
    .post(
      "/:id/saldenlaeufe",
      bodyLimit({ maxSize: MAX_UPLOAD + 64 * 1024, onError: (c) => c.json({ fehler: { code: "DATEI_ZU_GROSS" as const, meldung: `Die Datei ist größer als ${MAX_UPLOAD / 1024 / 1024} MB.` } }, 413) }),
      pruefe("param", idParam),
      async (c) => {
        const { id } = c.req.valid("param");
        if (!/^multipart\/form-data/i.test(c.req.header("content-type") ?? "")) throw new Fachfehler(400, "DATEI_FEHLT", "Erwartet wird multipart/form-data mit den Feldern „datei“, „zeitraumVon“ und „zeitraumBis“.");
        let formular: Record<string, string | File | (string | File)[]>;
        try {
          formular = await c.req.parseBody();
        } catch {
          throw new Fachfehler(400, "DATEI_FEHLT", "Erwartet wird multipart/form-data.");
        }
        const datei = formular.datei;
        if (!(datei instanceof File)) throw new Fachfehler(400, "DATEI_FEHLT", "Das Feld „datei“ fehlt.");
        const zeitraum = z.object({ zeitraumVon: datum, zeitraumBis: datum }).safeParse({ zeitraumVon: formular.zeitraumVon, zeitraumBis: formular.zeitraumBis });
        if (!zeitraum.success) throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", { felder: zeitraum.error.issues.map((i) => ({ feld: i.path.join("."), code: i.code, meldung: i.message })) });
        const { zeitraumVon, zeitraumBis } = zeitraum.data;
        if (zeitraumBis < zeitraumVon || (new Date(zeitraumBis).getTime() - new Date(zeitraumVon).getTime()) / 86_400_000 > 400) {
          throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", { felder: [{ feld: "zeitraumBis", code: "zeitraum_ungueltig", meldung: "Das Ende darf nicht vor dem Beginn liegen und der Zeitraum höchstens 400 Tage umfassen" }] });
        }
        if (datei.size > MAX_UPLOAD) throw new Fachfehler(413, "DATEI_ZU_GROSS", `Die Datei ist größer als ${MAX_UPLOAD / 1024 / 1024} MB.`);
        const inhalt = Buffer.from(await datei.arrayBuffer());
        const typ = erkenneDateityp(inhalt);
        if (typ === null) throw new Fachfehler(415, "DATEITYP_UNBEKANNT", "Nur Excel-Dateien (.xlsx) und CSV-Dateien sind erlaubt.");
        const name = datei.name.replace(/^.*[\\/]/, "").replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 200) || "saldenliste";
        const akteur = aktuellerAkteur(c);
        const lauf = await schreibe(db, c, async (tx, protokoll) => {
          await ladeFonds(tx, id);
          const [neu] = await tx
            .insert(saldenlauf)
            .values({ fondsId: id, zeitraumVon, zeitraumBis, dateiname: name, dateityp: typ, groesse: inhalt.length, sha256: createHash("sha256").update(inhalt).digest("hex"), datei: inhalt, hochgeladenVon: akteur.id })
            .returning(ohneDatei);
          await protokoll("hochladen", "saldenlauf", neu!.id, null, { fondsId: id, zeitraumVon, zeitraumBis, dateiname: neu!.dateiname, groesse: neu!.groesse, sha256: neu!.sha256 });
          return neu!;
        });
        return c.json(lauf, 201);
      },
    )
    .get("/:id/saldenlaeufe", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        return tx.select(ohneDatei).from(saldenlauf).where(eq(saldenlauf.fondsId, id)).orderBy(desc(saldenlauf.zeitraumBis), desc(saldenlauf.hochgeladenAm), asc(saldenlauf.id));
      });
      return c.json({ daten }, 200);
    })
    /** Zeiträume mit gültiger (übernommener, nicht ersetzter) Saldenliste. */
    .get("/:id/perioden", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        return tx
          .select({ laufId: saldenlauf.id, zeitraumVon: saldenlauf.zeitraumVon, zeitraumBis: saldenlauf.zeitraumBis, uebernommenAm: saldenlauf.uebernommenAm })
          .from(saldenlauf)
          .where(and(eq(saldenlauf.fondsId, id), eq(saldenlauf.status, "uebernommen"), isNull(saldenlauf.ersetztAm)))
          .orderBy(desc(saldenlauf.zeitraumBis));
      });
      return c.json({ daten }, 200);
    })
    .get("/:id/auswertung/:sicht", pruefe("param", sichtParam), pruefe("query", bisAbfrage), async (c) => {
      const { id, sicht } = c.req.valid("param");
      const { bis } = c.req.valid("query");
      const daten = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        const lauf = await aktiverLauf(tx, id, bis);
        const a = await ladeAuswertung(tx, lauf, sicht as SichtName);
        return { sicht, zeitraumVon: lauf.zeitraumVon, zeitraumBis: lauf.zeitraumBis, lauf: { id: lauf.id, dateiname: lauf.dateiname, uebernommenAm: lauf.uebernommenAm, uebernommenVon: lauf.uebernommenVon }, ...a };
      });
      return c.json(daten, 200);
    })
    /** Export einer Sicht als PDF oder Excel (bearbeiter, mit Zeile `gelesen` im Protokoll). Portfolio und Liquidität enthalten die Abstimmung. */
    .get("/:id/auswertung/:sicht/datei", pruefe("param", sichtParam), pruefe("query", dateiAbfrage), async (c) => {
      const { id, sicht } = c.req.valid("param");
      const { bis, format, sprache } = c.req.valid("query");
      const { daten, lauf } = await lese(db, async (tx) => {
        const [fz] = await tx.select().from(fonds).where(eq(fonds.id, id));
        if (!fz) throw new Fachfehler(404, "FONDS_NICHT_GEFUNDEN", "Fonds nicht gefunden.");
        const l = await aktiverLauf(tx, id, bis);
        const a = await ladeAuswertung(tx, l, sicht as SichtName);
        let abstimmung: AuswertungExportDaten["abstimmung"];
        if (sicht === "portfolio") {
          const p = await stimmePortfolioAb(tx, l, a);
          abstimmung = [...(p.gesamt ? [p.gesamt] : []), ...p.zeilen].map((z) => ({ bezeichnung: z.bezeichnung, carraway: z.carraway, buchhaltung: z.buchhaltung, differenz: z.differenz }));
        } else if (sicht === "liquiditaet") {
          const z = await stimmeLiquiditaetAb(tx, l, a);
          if (z) abstimmung = [{ bezeichnung: z.bezeichnung, carraway: z.carraway, buchhaltung: z.buchhaltung, differenz: z.differenz }];
        }
        const d: AuswertungExportDaten = {
          fonds: { name: fz.name, kurzname: fz.kurzname },
          sicht,
          sprache,
          zeitraumVon: l.zeitraumVon,
          zeitraumBis: l.zeitraumBis,
          waehrung: fz.waehrung,
          erzeugtAm: new Date().toISOString(),
          zeilen: a.zeilen.map((z) => ({ ebene: z.ebene, bezeichnungDe: z.bezeichnungDe, bezeichnungEn: z.bezeichnungEn, wert: z.wert, blatt: z.blatt, konten: z.konten })),
          nichtZugeordnet: a.nichtZugeordnet,
          ...(abstimmung ? { abstimmung } : {}),
        };
        return { daten: d, lauf: l };
      });
      await protokolliereLesen(db, c, "saldenlauf", lauf.id, { art: "auswertung", sicht, format, sprache, zeitraumBis: bis });
      const bytes = format === "pdf" ? erzeugeAuswertungPdf(daten) : await erzeugeAuswertungExcel(daten);
      return c.body(Buffer.from(bytes), 200, {
        "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="auswertung-${sicht}-${bis}.${format}"`,
        "Cache-Control": "no-store",
      });
    })
    /** Abstimmung gegen die Plattform: Buchwert des Portfolios und Liquidität. */
    .get("/:id/abstimmung", pruefe("param", idParam), pruefe("query", bisAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { bis } = c.req.valid("query");
      const daten = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        const lauf = await aktiverLauf(tx, id, bis);
        const portfolio = await ladeAuswertung(tx, lauf, "portfolio");
        const liquiditaet = await ladeAuswertung(tx, lauf, "liquiditaet");
        return { zeitraumVon: lauf.zeitraumVon, zeitraumBis: lauf.zeitraumBis, portfolio: await stimmePortfolioAb(tx, lauf, portfolio), liquiditaet: await stimmeLiquiditaetAb(tx, lauf, liquiditaet) };
      });
      return c.json(daten, 200);
    });
}

export function saldenlaufRouten(db: Db) {
  return new Hono()
    .get("/:id", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        const [l] = await tx.select(ohneDatei).from(saldenlauf).where(eq(saldenlauf.id, id));
        if (!l) throw new Fachfehler(404, "SALDENLAUF_NICHT_GEFUNDEN", "Saldenliste nicht gefunden.");
        const befunde = await tx
          .select({ nr: saldenlaufBefund.nr, zeile: saldenlaufBefund.zeile, spalte: saldenlaufBefund.spalte, code: saldenlaufBefund.code, schweregrad: saldenlaufBefund.schweregrad, meldung: saldenlaufBefund.meldung, params: saldenlaufBefund.params })
          .from(saldenlaufBefund)
          .where(eq(saldenlaufBefund.laufId, id))
          .orderBy(asc(saldenlaufBefund.nr));
        return { ...l, befunde };
      });
      return c.json(daten, 200);
    })
    .get("/:id/salden", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        await ladeLauf(tx, id);
        return tx.select({ zeile: saldo.zeile, konto: saldo.kontoNummer, bezeichnung: saldo.bezeichnung, eb: saldo.ebWert, soll: saldo.soll, haben: saldo.haben, saldo: saldo.saldo }).from(saldo).where(eq(saldo.laufId, id)).orderBy(asc(saldo.kontoNummer));
      });
      return c.json({ daten }, 200);
    })
    /** Prüft und liest die Salden ein (ersetzt Salden und Befunde des Laufs); ändert keine Auswertung. */
    .post("/:id/pruefen", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        await tx.execute(sql.raw("SET LOCAL statement_timeout = 60000"));
        const lauf = await ladeLauf(tx, id, true);
        if (lauf.status === "uebernommen") throw new Fachfehler(409, "SALDENLAUF_BEREITS_UEBERNOMMEN", "Die Saldenliste ist schon übernommen.");
        const r = await pruefeSaldenlauf(tx, lauf);
        const { fehler, warnungen } = zaehle(r.befunde);
        await tx.delete(saldo).where(eq(saldo.laufId, id));
        if (fehler === 0) {
          for (let i = 0; i < r.zeilen.length; i += 500) {
            await tx.insert(saldo).values(r.zeilen.slice(i, i + 500).map((z) => ({ laufId: id, zeile: z.zeile, kontoNummer: z.konto, bezeichnung: z.bezeichnung, ebWert: z.eb, soll: z.soll, haben: z.haben, saldo: z.saldo })));
          }
        }
        await speichereBefunde(tx, id, r.befunde);
        const [nachher] = await tx
          .update(saldenlauf)
          .set({ status: fehler === 0 ? "geprueft" : "hochgeladen", format: r.format, geprueftVon: akteur.id, geprueftAm: new Date(), fehlerAnzahl: fehler, warnungAnzahl: warnungen, summe: r.summe })
          .where(eq(saldenlauf.id, id))
          .returning(ohneDatei);
        await protokoll("pruefen", "saldenlauf", id, null, { fondsId: lauf.fondsId, fehler, warnungen, summe: r.summe });
        return nachher!;
      });
      return c.json(ergebnis, 200);
    })
    /** Übernimmt die Saldenliste (Vier-Augen); eine übernommene Liste für denselben Zeitraum wird ersetzt und bleibt als Fassung erhalten. */
    .post("/:id/uebernehmen", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        await tx.execute(sql.raw("SET LOCAL statement_timeout = 60000"));
        const vorab = await ladeLauf(tx, id);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`susa:${vorab.fondsId}`}))`);
        const lauf = await ladeLauf(tx, id, true);
        if (lauf.status === "uebernommen") throw new Fachfehler(409, "SALDENLAUF_BEREITS_UEBERNOMMEN", "Die Saldenliste ist schon übernommen.");
        if (lauf.status !== "geprueft") throw new Fachfehler(409, "SALDENLAUF_NICHT_GEPRUEFT", "Die Saldenliste ist nicht fehlerfrei geprüft.", { fehler: lauf.fehlerAnzahl });
        if (akteur.id === lauf.hochgeladenVon || akteur.id === lauf.geprueftVon) {
          throw new Fachfehler(409, "VIER_AUGEN_VERLETZT", "Die Übernahme muss eine andere Person vornehmen als das Hochladen und die Prüfung.");
        }
        // Frische Prüfung im selben Zug: Kontenrahmen und andere Listen können sich seit der Prüfung geändert haben.
        const r = await pruefeSaldenlauf(tx, lauf);
        const { fehler, warnungen } = zaehle(r.befunde);
        if (fehler > 0) throw new Fachfehler(409, "SALDENLAUF_FEHLER", "Die Prüfung vor der Übernahme hat Fehler gefunden; bitte erneut prüfen.", { fehler, beispiele: r.befunde.filter((b) => b.schweregrad === "fehler").slice(0, 5).map((b) => ({ code: b.code, meldung: b.meldung })) });
        await speichereBefunde(tx, id, r.befunde);
        const jetzt = new Date();
        const ersetzt = await tx
          .update(saldenlauf)
          .set({ ersetztAm: jetzt, ersetztVonLaufId: id })
          .where(and(eq(saldenlauf.fondsId, lauf.fondsId), eq(saldenlauf.zeitraumVon, lauf.zeitraumVon), eq(saldenlauf.zeitraumBis, lauf.zeitraumBis), eq(saldenlauf.status, "uebernommen"), isNull(saldenlauf.ersetztAm)))
          .returning({ id: saldenlauf.id });
        const [nachher] = await tx
          .update(saldenlauf)
          .set({ status: "uebernommen", uebernommenVon: akteur.id, uebernommenAm: jetzt, fehlerAnzahl: fehler, warnungAnzahl: warnungen, summe: r.summe })
          .where(eq(saldenlauf.id, id))
          .returning(ohneDatei);
        for (const e of ersetzt) await protokoll("ersetzen", "saldenlauf", e.id, null, { fondsId: lauf.fondsId, ersetztDurch: id });
        await protokoll("uebernehmen", "saldenlauf", id, null, { fondsId: lauf.fondsId, zeitraumVon: lauf.zeitraumVon, zeitraumBis: lauf.zeitraumBis, konten: r.summe.konten, ersetzt: ersetzt.map((e) => e.id) });
        return nachher!;
      });
      return c.json(ergebnis, 200);
    });
}
