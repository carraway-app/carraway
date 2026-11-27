import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { importBefund, importLauf, type Db } from "@carraway/db";
import { DateiFehler, erkenneDateityp, erzeugeVorlage, kappeParams, type Befund } from "@carraway/import";
import { aktuellerAkteur, hatRolle, type Akteur } from "../anmeldung/akteur";
import { Fachfehler, fehlerAntwort, type Fehlercode } from "../fehler";
import { englischerImportBefund } from "../import/befund-texte";
import { pruefeLauf } from "../import/pruefen";
import { pruefeQuellVerbindung, quelleAus, quelleZumSpeichern } from "../import/vorsystem-lauf";
import { erzeugeProtokollExcel, erzeugeProtokollPdf, type ProtokollLauf } from "../import/protokoll";
import { schreibePlan, type UebernahmeErgebnis } from "../import/uebernehmen";
import type { Bereich } from "../rechte/bereiche";
import { verlangeBereiche } from "../rechte/uebergreifend";
import { idParam, protokolliereLesen, schreibe, type Protokollant } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";
import { berichtPruefung } from "../berichte-pruefung";
import { berichtAnApi } from "../berichte-vertrag";

const pruefeApi = berichtPruefung("import");
const anApi = <T>(wert: T) => berichtAnApi("import", wert);

/**
 * Bereiche, in die eine Datenübernahme schreibt (zusätzlich zu Datenübernahme, dem Bereich der Route): Organisationen und Personen (Kontakte),
 * Beteiligungen, Instrumente, Runden, Vorgänge und Bewertungen (Portfolio), Fondsbewegungen (Finanzen); neue Fonds verlangen Fondsverwaltung.
 */
export const IMPORT_BEREICHE: Bereich[] = ["kontakte", "portfolio", "finanzen"];
const neueFondsBereich = (neueFonds: readonly unknown[]): Bereich[] => (neueFonds.length > 0 ? ["fondsverwaltung"] : []);
/** Eine Datei mit Mitarbeiterzuteilungen schreibt in den Bereich Einzelzuteilungen. */
const zuteilungsBereich = (r: { typisiert: { mitarbeiterzuteilungen: readonly unknown[] } }): Bereich[] => (r.typisiert.mitarbeiterzuteilungen.length > 0 ? ["einzelzuteilungen"] : []);
/** Kennzahlenwerte (Blatt Kennzahlen) verlangen zusätzlich den Bereich Kennzahlen. */
const kennzahlenBereich = (plan: { kennzahlen: readonly unknown[] }, zeilen: number): Bereich[] => (plan.kennzahlen.length > 0 || zeilen > 0 ? ["kennzahlen"] : []);

/** Größte hochladbare Datei (Bytes). */
export const MAX_UPLOAD = 20 * 1024 * 1024;
/** Höchstzahl gespeicherter Befunde je Lauf; die Anzahlen zählen alle. */
export const MAX_BEFUNDE = 5000;

const ohneDatei = {
  id: importLauf.id,
  dateiname: importLauf.dateiname,
  dateityp: importLauf.dateityp,
  sprache: importLauf.sprache,
  groesse: importLauf.groesse,
  sha256: importLauf.sha256,
  status: importLauf.status,
  hochgeladenVon: importLauf.hochgeladenVon,
  hochgeladenVonName: importLauf.hochgeladenVonName,
  hochgeladenAm: importLauf.hochgeladenAm,
  geprueftVon: importLauf.geprueftVon,
  geprueftVonName: importLauf.geprueftVonName,
  geprueftAm: importLauf.geprueftAm,
  fehlerAnzahl: importLauf.fehlerAnzahl,
  warnungAnzahl: importLauf.warnungAnzahl,
  befundeGekuerzt: importLauf.befundeGekuerzt,
  fonds: importLauf.fonds,
  vorschau: importLauf.vorschau,
  uebernommenVon: importLauf.uebernommenVon,
  uebernommenVonName: importLauf.uebernommenVonName,
  uebernommenAm: importLauf.uebernommenAm,
  ergebnis: importLauf.ergebnis,
};

const DATEIFEHLER: Record<DateiFehler["code"], { status: 400 | 413 | 415 | 422; code: Fehlercode; meldung: string }> = {
  DATEITYP_UNBEKANNT: { status: 415, code: "file_type_unknown", meldung: "The file type is not supported; expected Excel (.xlsx) or CSV." },
  DATEI_BESCHAEDIGT: { status: 422, code: "import_file_unreadable", meldung: "The file is damaged or cannot be read." },
  DATEI_ZU_GROSS: { status: 413, code: "file_too_large", meldung: "The file is too large." },
  DATEI_LEER: { status: 422, code: "file_empty", meldung: "The file is empty." },
  BLATT_NICHT_ERKANNT: { status: 422, code: "sheet_not_recognized", meldung: "No sheet of the file matches the template." },
};

/** Übersetzt Lesefehler der Datei in Fachfehler der API. */
async function mitDateifehlern<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (fehler) {
    if (fehler instanceof DateiFehler) {
      const z = DATEIFEHLER[fehler.code];
      throw new Fachfehler(z.status, z.code, z.meldung);
    }
    throw fehler;
  }
}

async function ladeLauf(tx: Tx, id: string, sperren = false) {
  const abfrage = tx.select().from(importLauf).where(eq(importLauf.id, id));
  const [lauf] = await (sperren ? abfrage.for("update") : abfrage);
  if (!lauf) throw new Fachfehler(404, "import_run_not_found", "Import run not found.");
  return lauf;
}

/** Befunde, die keine Werte aus Datensätzen enthalten und deshalb auch bei eingeschränkter Sicht erscheinen. */
const OHNE_WERTE = new Set(["KEINE_BERECHTIGUNG_FONDS", "FONDS_NEU_NUR_VERWALTER", "KEINE_BERECHTIGUNG_EINZELZUTEILUNGEN"]);

/** Fonds des Laufs: IDs der berührten bestehenden Fonds und Kurznamen der Fonds, die erst entstehen. */
export interface LaufFonds {
  ids: string[];
  neu: string[];
}

export function laufFonds(wert: unknown): LaufFonds {
  if (wert && typeof wert === "object" && !Array.isArray(wert)) {
    const w = wert as Partial<LaufFonds>;
    return { ids: w.ids ?? [], neu: w.neu ?? [] };
  }
  return { ids: [], neu: [] };
}

/**
 * Vollzugriff auf Ergebnisse (Vorschau, Befunde, Übernahmeergebnis, Abnahmeprotokoll): globale Verwalter oder Betrachter an
 * jedem Fonds des Laufs, bei jedem Lesen mit den aktuellen Rollen geprüft. Läuft mit einem erst entstehenden Fonds, sehen nur
 * globale Verwalter alles. Ohne gespeicherte Fonds (noch nicht geprüft) gibt es nichts zu zeigen.
 */
export function hatVollzugriff(akteur: Akteur, lauf: { fonds: unknown }): boolean {
  if (akteur.globalVerwalter) return true;
  const f = laufFonds(lauf.fonds);
  return f.neu.length === 0 && f.ids.length > 0 && f.ids.every((id) => hatRolle(akteur, id, "betrachter"));
}

/** Metadaten (Stand, Dateiname, Zeiten) sehen die hochladende Person und alle mit Vollzugriff; für andere gibt es den Lauf nicht. */
const darfSehen = (akteur: Akteur, lauf: { hochgeladenVon: string; fonds: unknown }) => lauf.hochgeladenVon === akteur.id || hatVollzugriff(akteur, lauf);

function verlangeSichtbar(akteur: Akteur, lauf: { hochgeladenVon: string; fonds: unknown }) {
  // Kein Hinweis auf die Existenz: wer den Lauf nicht sehen darf, bekommt 404.
  if (!darfSehen(akteur, lauf)) throw new Fachfehler(404, "import_run_not_found", "Import run not found.");
}

function verlangeVollzugriff(akteur: Akteur, lauf: { fonds: unknown }) {
  if (!hatVollzugriff(akteur, lauf)) throw new Fachfehler(403, "forbidden", "Permission for at least one affected fund is missing for the results of this run.");
}

/** Schwärzt Ergebnisse (Anzahlen, Vorschau, Übernahmeergebnis, Fonds), wenn die Person nur die Metadaten sehen darf. */
function schuetze<T extends { fonds: unknown; fehlerAnzahl: number | null; warnungAnzahl: number | null; vorschau: unknown; ergebnis: unknown }>(akteur: Akteur, lauf: T): T & { eingeschraenkt: boolean } {
  if (hatVollzugriff(akteur, lauf)) return { ...lauf, eingeschraenkt: false };
  return { ...lauf, fonds: null, fehlerAnzahl: null, warnungAnzahl: null, vorschau: null, ergebnis: null, eingeschraenkt: true };
}

/** Ersetzt die Befunde des Laufs; gespeichert werden höchstens `MAX_BEFUNDE` (Fehler zuerst). */
async function speichereBefunde(tx: Tx, laufId: string, befunde: Befund[]) {
  await tx.delete(importBefund).where(eq(importBefund.laufId, laufId));
  const sortiert = [...befunde].sort((a, b) => Number(b.schweregrad === "fehler") - Number(a.schweregrad === "fehler"));
  const zeilen = sortiert.slice(0, MAX_BEFUNDE).map((b, i) => ({ laufId, nr: i + 1, blatt: b.blatt, blattName: b.blattName, zeile: b.zeile, spalte: b.spalte, code: b.code, schweregrad: b.schweregrad, meldung: b.meldung.slice(0, 2000), params: kappeParams(b.params) }));
  for (let i = 0; i < zeilen.length; i += 1000) await tx.insert(importBefund).values(zeilen.slice(i, i + 1000));
  return { gekuerzt: befunde.length > MAX_BEFUNDE };
}

const zaehle = (befunde: Befund[]) => ({ fehler: befunde.filter((b) => b.schweregrad === "fehler").length, warnungen: befunde.filter((b) => b.schweregrad === "warnung").length });

const befundMitMeldung = <T extends { code: string; meldung: string; params: unknown }>(befund: T) => ({
  ...befund,
  meldungDe: befund.meldung,
  meldung: englischerImportBefund(befund.code, befund.params),
});

const ABFRAGE_ZEIT = 120_000;

/**
 * Prüfung eines Laufs ohne Daten zu schreiben: ersetzt die Befunde und speichert Vorschau, Fonds und Stand. Gemeinsamer Weg der Prüfung
 * nach dem Hochladen und der Übernahme aus einem Vorsystem. Hinweise der Quelle (`vorschau.source.findings`) bleiben erhalten und zählen mit.
 */
export async function pruefeUndSpeichere(tx: Tx, protokoll: Protokollant, akteur: Akteur, id: string) {
  const lauf = await ladeLauf(tx, id, true);
  verlangeSichtbar(akteur, lauf);
  if (lauf.status === "uebernommen") throw new Fachfehler(409, "import_already_applied", "The run has already been applied.");
  const r = await mitDateifehlern(() => pruefeLauf(tx, lauf.datei, lauf.dateiname, akteur, "bearbeiter"));
  verlangeBereiche(akteur, [...neueFondsBereich(r.neueFonds), ...kennzahlenBereich(r.plan, r.typisiert.kennzahlen.length), ...zuteilungsBereich(r)]);
  const quelle = quelleAus(lauf.vorschau);
  const befunde = [...r.befunde, ...(quelle?.befunde ?? [])];
  const { fehler, warnungen } = zaehle(befunde);
  const { gekuerzt } = await speichereBefunde(tx, id, befunde);
  const vorschau = { zaehler: r.plan.zaehler, ...(quelle ? { source: quelleZumSpeichern(quelle) } : {}) };
  const [nachher] = await tx
    .update(importLauf)
    .set({
      status: fehler === 0 ? "geprueft" : "hochgeladen",
      sprache: r.gelesen.sprache === "en" ? "en" : "de",
      geprueftVon: akteur.id,
      geprueftVonName: akteur.name,
      geprueftAm: new Date(),
      fehlerAnzahl: fehler,
      warnungAnzahl: warnungen,
      befundeGekuerzt: gekuerzt,
      fonds: { ids: r.fondsIds, neu: r.neueFonds },
      vorschau,
    })
    .where(eq(importLauf.id, id))
    .returning(ohneDatei);
  await protokoll("pruefen", "import_lauf", id, null, { fehler, warnungen, fonds: r.fondsIds, neueFonds: r.neueFonds });
  return schuetze(akteur, nachher!);
}

export function importRouten(db: Db) {
  return new Hono()
    /** Leere Importvorlage als Excel (deutsche oder englische Köpfe). */
    .get("/template", pruefeApi("query", z.object({ sprache: z.enum(["de", "en"]).default("de") })), async (c) => {
      const { sprache } = c.req.valid("query");
      const datei = await erzeugeVorlage(sprache);
      return new Response(new Uint8Array(datei), {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="carraway-importvorlage-${sprache}.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    })
    /** Hochladen (multipart, Feld `file`): speichert die Datei, ändert noch keine Daten. */
    .post(
      "/runs",
      bodyLimit({
        maxSize: MAX_UPLOAD + 64 * 1024,
        onError: (c) => fehlerAntwort(c, 413, "file_too_large", `The file is larger than ${MAX_UPLOAD / 1024 / 1024} MB.`),
      }),
      async (c) => {
        const kopf = c.req.header("content-type") ?? "";
        if (!/^multipart\/form-data/i.test(kopf)) throw new Fachfehler(400, "file_missing", "Expected multipart/form-data with the field \"file\".");
        let formular: Record<string, string | File | (string | File)[]>;
        try {
          formular = await c.req.parseBody();
        } catch {
          throw new Fachfehler(400, "file_missing", "Expected multipart/form-data with the field \"file\".");
        }
        const datei = formular.file;
        if (!(datei instanceof File)) throw new Fachfehler(400, "file_missing", "The field \"file\" is missing.");
        if (datei.size > MAX_UPLOAD) throw new Fachfehler(413, "file_too_large", `The file is larger than ${MAX_UPLOAD / 1024 / 1024} MB.`);
        const inhalt = Buffer.from(await datei.arrayBuffer());
        const typ = erkenneDateityp(inhalt);
        if (typ === null) throw new Fachfehler(415, "file_type_unknown", "Only Excel files (.xlsx) and CSV files are allowed.");
        const akteur = aktuellerAkteur(c);
        const name = datei.name.replace(/^.*[\\/]/, "").replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 200) || "import";
        const lauf = await schreibe(db, c, async (tx, protokoll) => {
          const [neu] = await tx
            .insert(importLauf)
            .values({ dateiname: name, dateityp: typ, sprache: "de", groesse: inhalt.length, sha256: createHash("sha256").update(inhalt).digest("hex"), datei: inhalt, hochgeladenVon: akteur.id, hochgeladenVonName: akteur.name })
            .returning(ohneDatei);
          if (!neu) throw new Error("Import-Lauf nicht angelegt");
          await protokoll("hochladen", "import_lauf", neu.id, null, { dateiname: neu.dateiname, dateityp: neu.dateityp, groesse: neu.groesse, sha256: neu.sha256 });
          return neu;
        });
        return c.json(anApi(lauf), 201);
      },
    )
    .get("/runs", async (c) => {
      const akteur = aktuellerAkteur(c);
      const daten = await lese(db, async (tx) => {
        const zeilen = await tx.select(ohneDatei).from(importLauf).orderBy(desc(importLauf.hochgeladenAm), asc(importLauf.id)).limit(200);
        return zeilen.filter((l) => darfSehen(akteur, l)).slice(0, 50).map((l) => schuetze(akteur, l));
      });
      return c.json(anApi({ daten }), 200);
    })
    .get("/runs/:id", pruefeApi("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      const lauf = await lese(db, async (tx) => {
        const [l] = await tx.select(ohneDatei).from(importLauf).where(eq(importLauf.id, id));
        if (!l) throw new Fachfehler(404, "import_run_not_found", "Import run not found.");
        verlangeSichtbar(akteur, l);
        return schuetze(akteur, l);
      });
      return c.json(anApi(lauf), 200);
    })
    .get(
      "/runs/:id/findings",
      pruefeApi("param", idParam),
      pruefeApi("query", z.object({ schweregrad: z.enum(["fehler", "warnung"]).optional(), blatt: z.string().max(100).optional(), ab: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(1000).default(200) })),
      async (c) => {
        const { id } = c.req.valid("param");
        const { schweregrad, blatt, ab, limit } = c.req.valid("query");
        const akteur = aktuellerAkteur(c);
        const daten = await lese(db, async (tx) => {
          const l = await ladeLauf(tx, id);
          verlangeSichtbar(akteur, l);
          // Ohne Vollzugriff nur die Befunde über fehlende Rechte (sie enthalten keine Werte aus Datensätzen).
          const eingeschraenkt = !hatVollzugriff(akteur, l);
          const zeilen = await tx
            .select({ nr: importBefund.nr, blatt: importBefund.blatt, blattName: importBefund.blattName, zeile: importBefund.zeile, spalte: importBefund.spalte, code: importBefund.code, schweregrad: importBefund.schweregrad, meldung: importBefund.meldung, params: importBefund.params })
            .from(importBefund)
            .where(and(eq(importBefund.laufId, id), eingeschraenkt ? inArray(importBefund.code, [...OHNE_WERTE]) : undefined, sql`${importBefund.nr} > ${ab}`, schweregrad ? eq(importBefund.schweregrad, schweregrad) : undefined, blatt ? eq(importBefund.blatt, blatt) : undefined))
            .orderBy(asc(importBefund.nr))
            .limit(limit + 1);
          return { zeilen, eingeschraenkt };
        });
        const seite = daten.zeilen.slice(0, limit);
        return c.json(anApi({ daten: seite.map(befundMitMeldung), naechstesAb: daten.zeilen.length > limit ? seite.at(-1)!.nr : null, eingeschraenkt: daten.eingeschraenkt }), 200);
      },
    )
    /** Prüft ohne Daten zu schreiben; ersetzt die Befunde des Laufs. */
    .post("/runs/:id/validate", pruefeApi("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      verlangeBereiche(akteur, IMPORT_BEREICHE);
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${ABFRAGE_ZEIT}`));
        return pruefeUndSpeichere(tx, protokoll, akteur, id);
      });
      return c.json(anApi(ergebnis), 200);
    })
    /** Übernimmt alles in einer Transaktion; verlangt Freigeber an jedem berührten Fonds und eine andere Person als Hochladende und Prüfende. */
    .post("/runs/:id/apply", pruefeApi("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      verlangeBereiche(akteur, IMPORT_BEREICHE);
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${ABFRAGE_ZEIT}`));
        // Importe laufen nacheinander: Schlüsselzuordnung und Prüfung sehen sonst nicht, was ein paralleler Lauf anlegt.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('carraway-import'))`);
        const lauf = await ladeLauf(tx, id, true);
        verlangeSichtbar(akteur, lauf);
        if (lauf.status === "uebernommen") throw new Fachfehler(409, "import_already_applied", "The run has already been applied.");
        if (lauf.status !== "geprueft") throw new Fachfehler(409, "import_not_validated", "The run has not been validated without errors.", { fehler: lauf.fehlerAnzahl });
        if (akteur.id === lauf.hochgeladenVon || akteur.id === lauf.geprueftVon) {
          throw new Fachfehler(409, "four_eyes_violated", "The import must be applied by a different person than the one who uploaded and validated it.");
        }
        const quelle = quelleAus(lauf.vorschau);
        if (quelle) await pruefeQuellVerbindung(tx, akteur, quelle);
        // Frische Prüfung im selben Zug, mit der Rolle Freigeber an jedem berührten Fonds.
        const r = await mitDateifehlern(() => pruefeLauf(tx, lauf.datei, lauf.dateiname, akteur, "freigeber"));
        verlangeBereiche(akteur, [...neueFondsBereich(r.neueFonds), ...kennzahlenBereich(r.plan, r.typisiert.kennzahlen.length), ...zuteilungsBereich(r)]);
        const befunde = [...r.befunde, ...(quelle?.befunde ?? [])];
        const { fehler, warnungen } = zaehle(befunde);
        if (fehler > 0) {
          throw new Fachfehler(409, "import_failed", "The validation before applying found errors; please validate again.", { fehler, beispiele: befunde.filter((b) => b.schweregrad === "fehler").slice(0, 5).map(befundMitMeldung) });
        }
        const { gekuerzt } = await speichereBefunde(tx, id, befunde);
        const ergebnisDaten: UebernahmeErgebnis = await schreibePlan(tx, protokoll, r.plan, id, lauf.hochgeladenVon);
        const [nachher] = await tx
          .update(importLauf)
          .set({ status: "uebernommen", uebernommenVon: akteur.id, uebernommenVonName: akteur.name, uebernommenAm: new Date(), fehlerAnzahl: fehler, warnungAnzahl: warnungen, befundeGekuerzt: gekuerzt, fonds: { ids: [...new Set([...r.fondsIds, ...[...r.plan.fonds.values()].map((f) => f.id)])], neu: [] }, ergebnis: ergebnisDaten })
          .where(eq(importLauf.id, id))
          .returning(ohneDatei);
        await protokoll("uebernehmen", "import_lauf", id, null, { warnungen, zaehler: ergebnisDaten.zaehler });
        return schuetze(akteur, nachher!);
      });
      return c.json(anApi(ergebnis), 200);
    })
    /** Abnahmeprotokoll als PDF oder Excel. */
    .get("/runs/:id/log", pruefeApi("param", idParam), pruefeApi("query", z.object({ format: z.enum(["pdf", "xlsx"]).default("pdf"), sprache: z.enum(["de", "en"]).default("de") })), async (c) => {
      const { id } = c.req.valid("param");
      const { format, sprache } = c.req.valid("query");
      const akteur = aktuellerAkteur(c);
      const { lauf, befunde } = await lese(db, async (tx) => {
        const [l] = await tx.select(ohneDatei).from(importLauf).where(eq(importLauf.id, id));
        if (!l) throw new Fachfehler(404, "import_run_not_found", "Import run not found.");
        verlangeSichtbar(akteur, l);
        verlangeVollzugriff(akteur, l);
        const b = await tx
          .select({ nr: importBefund.nr, blatt: importBefund.blatt, blattName: importBefund.blattName, zeile: importBefund.zeile, spalte: importBefund.spalte, code: importBefund.code, schweregrad: importBefund.schweregrad, meldung: importBefund.meldung, params: importBefund.params })
          .from(importBefund)
          .where(eq(importBefund.laufId, id))
          .orderBy(asc(importBefund.nr));
        return { lauf: l, befunde: b };
      });
      await protokolliereLesen(db, c, "import_lauf", id, { format, art: "abnahmeprotokoll" });
      const daten = { lauf: lauf as unknown as ProtokollLauf, befunde, sprache };
      const basis = `abnahmeprotokoll-${lauf.dateiname.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]/g, "_")}`;
      const koerper = format === "pdf" ? erzeugeProtokollPdf(daten) : await erzeugeProtokollExcel(daten);
      return new Response(new Uint8Array(koerper), {
        status: 200,
        headers: {
          "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${basis}.${format}"`,
          "Cache-Control": "no-store",
        },
      });
    });
}
