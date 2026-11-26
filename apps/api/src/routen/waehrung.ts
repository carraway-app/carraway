import { pruefeFonds } from "../fonds-pruefung";
import { fondsAnApi } from "../fonds-vertrag";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { beteiligung, fonds, wechselkurs, type Db } from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import { Fachfehler, fehlerAntwort } from "../fehler";
import { idParam, schreibe, textEingabe } from "../schreiben";
import { lese } from "../zeitlimit";
import { leseKursdatei } from "../waehrung/kursdatei";
import { ladeBeteiligungSicht, ladeFondsSicht } from "../waehrung/sicht";
import { feldArray } from "../crm/felder";

/**
 * Währungen (Etappe 21): Kurstabelle (nur anhängend, Korrektur als neuer Eintrag), Kursimport aus einer Datei (kein Abruf aus dem Netz), lokale Währung einer
 * Beteiligung und die Währungssicht auf Beteiligung und Fonds. Regeln und Rechenwege: `docs/waehrung.md`, Rechenkern `waehrung.ts`.
 */

const code = z.string().regex(/^[A-Z]{3}$/, "Three-letter currency code in uppercase (ISO 4217) expected");
const kursText = z.string().regex(/^\d{1,10}(\.\d{1,8})?$/, "Rate greater than zero with at most eight decimal places expected").refine((w) => Number(w) > 0, { message: "Rate greater than zero" });
const stand = z.iso.datetime({ offset: true });

const neuerKurs = z
  .object({
    datum: z.iso.date(),
    basis: code,
    quote: code,
    kurs: kursText,
    /** Beim Korrigieren: der bisher gültige Eintrag desselben Tages und Paares. */
    korrigiertKursId: z.uuid().optional(),
    grund: textEingabe(500).optional(),
  })
  .refine((w) => w.basis !== w.quote, { message: "Base and quote must differ", path: ["quote"] })
  .refine((w) => (w.korrigiertKursId === undefined) === (w.grund === undefined), { message: "Correction and reason go together", path: ["grund"] });

const kursListe = z.object({
  basis: code.optional(),
  quote: code.optional(),
  von: z.iso.date().optional(),
  bis: z.iso.date().optional(),
  stand: stand.optional(),
  alle: z.enum(["0", "1"]).default("0"),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

const importEingabe = z.object({
  /** Inhalt der Datei als Text (UTF-8); die Oberfläche liest die gewählte Datei im Browser. */
  inhalt: z.string().min(1).max(5_000_000),
  dateiname: z.string().trim().min(1).max(200),
  /** Nur lesen und prüfen (Standard); erst mit `false` wird übernommen. */
  vorschau: z.boolean().default(true),
  /** Nur diese Währungen übernehmen (Quote bei EZB-Dateien); ohne Angabe alle. */
  waehrungen: z.array(code).max(60).optional(),
  /** Nur Tage ab diesem Datum übernehmen. */
  ab: z.iso.date().optional(),
});

const sichtAbfrage = z.object({ stichtag: z.iso.date().optional(), stand: stand.optional(), vergleich: code.optional() });
const MAX_NEUE_KURSE = 100_000;

/** Mount unter `/exchange-rates`. */
export function wechselkursRouten(db: Db) {
  return new Hono()
    /** Gültige Kurse (je Tag und Paar der jüngste Eintrag bis zum Wissensstand) oder mit `alle=1` auch die ersetzten, neueste Tage zuerst. */
    .get("/", pruefeFonds("query", kursListe), async (c) => {
      const q = c.req.valid("query");
      const daten = await lese(db, async (tx) => {
        const { rows } = await tx.execute<Record<string, unknown>>(sql`
          SELECT * FROM (
            SELECT w.id, w.datum::text AS datum, w.basis, w.quote, w.kurs::text AS kurs, w.quelle::text AS quelle, w.quelle_datei AS "quelleDatei",
                   w.korrigiert_kurs_id AS "korrigiertKursId", w.grund, w.erfasst_von AS "erfasstVon", (to_json(w.erfasst_am) #>> '{}') AS "erfasstAm",
                   (w.id = (SELECT x.id FROM wechselkurs x WHERE x.datum = w.datum AND x.basis = w.basis AND x.quote = w.quote${q.stand ? sql` AND x.erfasst_am <= ${q.stand}::timestamptz` : sql``} ORDER BY x.erfasst_am DESC, x.id DESC LIMIT 1)) AS gilt
            FROM wechselkurs w
            WHERE true${q.basis ? sql` AND w.basis = ${q.basis}` : sql``}${q.quote ? sql` AND w.quote = ${q.quote}` : sql``}${q.von ? sql` AND w.datum >= ${q.von}::date` : sql``}${q.bis ? sql` AND w.datum <= ${q.bis}::date` : sql``}${q.stand ? sql` AND w.erfasst_am <= ${q.stand}::timestamptz` : sql``}
          ) t
          ${q.alle === "1" ? sql`` : sql`WHERE gilt`}
          ORDER BY datum DESC, basis, quote, "erfasstAm" DESC
          LIMIT ${q.limit}`);
        return rows.map((r) => ({ ...r, kurs: new Decimal(r.kurs as string).toFixed(), erfasstAm: new Date(r.erfasstAm as string).toISOString() }));
      });
      return c.json(fondsAnApi({ daten }), 200);
    })
    /** Währungen, zu denen es Kurse gibt (Auswahl der Vergleichswährung), mit dem jüngsten Tag je Währung. */
    .get("/currencies", async (c) => {
      const daten = await lese(db, async (tx) => {
        const { rows } = await tx.execute<{ waehrung: string; letzter: string }>(sql`
          SELECT w AS waehrung, max(datum)::text AS letzter FROM (SELECT basis AS w, datum FROM wechselkurs UNION ALL SELECT quote AS w, datum FROM wechselkurs) x GROUP BY w ORDER BY w`);
        return rows.map((r) => ({ waehrung: r.waehrung, letzterKurs: r.letzter }));
      });
      return c.json(fondsAnApi({ daten }), 200);
    })
    /**
     * Kurs von Hand erfassen. Gibt es für Tag und Paar schon einen gültigen Eintrag, ist eine Änderung eine Korrektur: `korrigiertKursId` nennt den bisher gültigen Eintrag
     * (409 `rate_exists` ohne), `grund` ist Pflicht. Der alte Eintrag bleibt unverändert in der Tabelle; Zahlungen und Bewertungen haben ihren Kurs festgehalten.
     */
    .post("/", pruefeFonds("json", neuerKurs), async (c) => {
      const e = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const { rows } = await tx.execute<{ id: string; kurs: string }>(sql`SELECT id, kurs::text AS kurs FROM wechselkurs WHERE datum = ${e.datum}::date AND basis = ${e.basis} AND quote = ${e.quote} ORDER BY erfasst_am DESC, id DESC LIMIT 1`);
        const gueltig = rows[0];
        if (gueltig && e.korrigiertKursId === undefined) throw new Fachfehler(409, "rate_exists", "An exchange rate already exists for this day and pair; a change is a correction with a reason.", { kursId: gueltig.id, kurs: new Decimal(gueltig.kurs).toFixed() });
        if (e.korrigiertKursId !== undefined && gueltig?.id !== e.korrigiertKursId) throw new Fachfehler(404, "rate_not_found", "The rate to correct is not the valid entry for this day and pair.");
        const [zeile] = await tx
          .insert(wechselkurs)
          .values({ datum: e.datum, basis: e.basis, quote: e.quote, kurs: e.kurs, quelle: "manuell", korrigiertKursId: e.korrigiertKursId ?? null, grund: e.grund ?? null, erfasstVon: protokoll.akteur })
          .returning();
        if (!zeile) throw new Error("Kurs nicht angelegt");
        await protokoll(e.korrigiertKursId ? "korrigieren" : "anlegen", "wechselkurs", zeile.id, gueltig ?? null, zeile);
        return zeile;
      });
      return c.json(fondsAnApi({ ...neu, kurs: new Decimal(neu.kurs).toFixed() }), 201);
    })
    /**
     * Kursdatei einlesen (EZB-Aufbau oder langer Aufbau, siehe `waehrung/kursdatei.ts`). Standard ist die Vorschau ohne Schreiben. Beim Übernehmen werden nur Einträge
     * geschrieben, für die es noch keinen gültigen Kurs gibt; ein gleicher Kurs ist unverändert (wiederholbar), ein abweichender wird gemeldet und nicht überschrieben:
     * Änderungen sind Korrekturen von Hand mit Grund.
     */
    .post("/import", pruefeFonds("json", importEingabe), async (c) => {
      const e = c.req.valid("json");
      const gelesen = leseKursdatei(e.inhalt);
      if (gelesen.eintraege.length === 0 && gelesen.fehler.length > 0) {
        throw new Fachfehler(400, "rate_file_invalid", "The rate file cannot be read.", { dateifehler: gelesen.fehler.slice(0, 20) });
      }
      const waehle = new Set(e.waehrungen ?? []);
      const kandidaten = gelesen.eintraege.filter((x) => (e.ab ? x.datum >= e.ab : true) && (waehle.size === 0 || waehle.has(x.quote) || waehle.has(x.basis)));
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const vorhanden = new Map<string, string>();
        if (kandidaten.length > 0) {
          const tage = kandidaten.map((x) => x.datum).sort();
          const { rows } = await tx.execute<{ datum: string; basis: string; quote: string; kurs: string }>(sql`
            SELECT DISTINCT ON (datum, basis, quote) datum::text AS datum, basis, quote, kurs::text AS kurs FROM wechselkurs
            WHERE datum >= ${tage[0]!}::date AND datum <= ${tage[tage.length - 1]!}::date AND basis = ANY(${feldArray([...new Set(kandidaten.map((x) => x.basis))], "text")})
            ORDER BY datum, basis, quote, erfasst_am DESC, id DESC`);
          for (const r of rows) vorhanden.set(`${r.datum}|${r.basis}|${r.quote}`, r.kurs);
        }
        const neu: typeof kandidaten = [];
        const abweichend: { datum: string; basis: string; quote: string; kurs: string; vorhanden: string }[] = [];
        let unveraendert = 0;
        for (const k of kandidaten) {
          const v = vorhanden.get(`${k.datum}|${k.basis}|${k.quote}`);
          if (v === undefined) neu.push(k);
          else if (new Decimal(v).equals(k.kurs)) unveraendert++;
          else abweichend.push({ datum: k.datum, basis: k.basis, quote: k.quote, kurs: k.kurs, vorhanden: new Decimal(v).toFixed() });
        }
        if (neu.length > MAX_NEUE_KURSE) {
          throw new Fachfehler(400, "rate_file_invalid", `The file contains more than ${MAX_NEUE_KURSE} new rates; narrow it down by currencies and start date.`, { neu: neu.length });
        }
        if (!e.vorschau && neu.length > 0) {
          for (let i = 0; i < neu.length; i += 1000) {
            const block = neu.slice(i, i + 1000);
            const zeilen = await tx.insert(wechselkurs).values(block.map((k) => ({ datum: k.datum, basis: k.basis, quote: k.quote, kurs: k.kurs, quelle: "import" as const, quelleDatei: e.dateiname, erfasstVon: protokoll.akteur }))).returning({ id: wechselkurs.id });
            await protokoll.mehrere(zeilen.map((z, j) => ({ aktion: "importieren", tabelle: "wechselkurs", datensatzId: z.id, nachher: { ...block[j], quelleDatei: e.dateiname } })));
          }
        }
        return { neu: neu.length, unveraendert, abweichend, beispiele: neu.slice(0, 5) };
      });
      return c.json(
        fondsAnApi({
          dateiname: e.dateiname,
          format: gelesen.format,
          zeilen: gelesen.zeilen,
          gelesen: gelesen.eintraege.length,
          ausgewaehlt: kandidaten.length,
          neu: ergebnis.neu,
          unveraendert: ergebnis.unveraendert,
          abweichend: ergebnis.abweichend.slice(0, 50),
          abweichendAnzahl: ergebnis.abweichend.length,
          dateifehler: gelesen.fehler.slice(0, 50),
          fehlerAnzahl: gelesen.fehler.length,
          beispiele: ergebnis.beispiele,
          uebernommen: !e.vorschau,
        }),
        e.vorschau ? 200 : 201,
      );
    });
}

const waehrungEingabe = z.object({ waehrung: code.nullable() });

/** Mount unter `/beteiligungen`: lokale Währung und Währungssicht einer Beteiligung. */
export function beteiligungWaehrungRouten(db: Db) {
  return new Hono()
    .get("/:id/currency-view", pruefeFonds("param", idParam, { query: sichtAbfrage }), pruefeFonds("query", sichtAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const q = c.req.valid("query");
      const sicht = await lese(db, (tx) => ladeBeteiligungSicht(tx, id, q));
      if (!sicht) return fehlerAntwort(c, 404, "investment_not_found", "Investment not found.");
      return c.json(fondsAnApi(sicht), 200);
    })
    /**
     * Lokale Währung der Beteiligung setzen (`null` = Fondswährung). Solange es lokale Beträge an Zahlungen oder Bewertungen gibt, lässt sie sich nicht ändern
     * (409 `currency_not_changeable`): Der festgehaltene Kurs gehört zu genau dieser Währung.
     */
    .put("/:id/currency", pruefeFonds("param", idParam), pruefeFonds("json", waehrungEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const { waehrung } = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const [vorher] = await tx.select().from(beteiligung).where(eq(beteiligung.id, id)).for("update");
        if (!vorher) throw new Fachfehler(404, "investment_not_found", "Investment not found.");
        const [f] = await tx.select({ waehrung: fonds.waehrung }).from(fonds).where(eq(fonds.id, vorher.fondsId));
        const neu = waehrung === f?.waehrung ? null : waehrung;
        if ((vorher.waehrung ?? null) === neu) return { beteiligungId: id, waehrung: neu, fondsWaehrung: f?.waehrung ?? "EUR" };
        const { rows } = await tx.execute<{ n: number }>(sql`SELECT (SELECT count(*) FROM vorgang WHERE beteiligung_id = ${id} AND betrag_lokal IS NOT NULL) + (SELECT count(*) FROM bewertung WHERE beteiligung_id = ${id} AND wert_lokal IS NOT NULL) AS n`);
        if (Number(rows[0]?.n ?? 0) > 0) throw new Fachfehler(409, "currency_not_changeable", "The local currency can no longer be changed because local amounts are already recorded.");
        const [nachher] = await tx.update(beteiligung).set({ waehrung: neu }).where(and(eq(beteiligung.id, id))).returning();
        await protokoll("aendern", "beteiligung", id, { waehrung: vorher.waehrung }, { waehrung: nachher?.waehrung ?? null });
        return { beteiligungId: id, waehrung: nachher?.waehrung ?? null, fondsWaehrung: f?.waehrung ?? "EUR" };
      });
      return c.json(fondsAnApi(ergebnis), 200);
    });
}

/** Mount unter `/funds`: Währungssicht auf das Portfolio. */
export function fondsWaehrungRouten(db: Db) {
  return new Hono().get("/:id/currency-view", pruefeFonds("param", idParam, { query: sichtAbfrage }), pruefeFonds("query", sichtAbfrage), async (c) => {
    const { id } = c.req.valid("param");
    const q = c.req.valid("query");
    const sicht = await lese(db, async (tx) => {
      const [f] = await tx.select({ id: fonds.id }).from(fonds).where(eq(fonds.id, id));
      return f ? ladeFondsSicht(tx, id, q) : null;
    });
    if (!sicht) return fehlerAntwort(c, 404, "fund_not_found", "Fund not found.");
    return c.json(fondsAnApi(sicht), 200);
  });
}
