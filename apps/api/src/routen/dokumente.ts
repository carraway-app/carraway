import { and, eq, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { dokument, dokumentKlassifikation, dokumentSeite, dokumentVerknuepfung, type Db, type Dokument } from "@carraway/db";
import { aktuellerAkteur, type Akteur } from "../anmeldung/akteur";
import type { Speicher } from "../berichte/speicher";
import { ausstehendeLoeschungen } from "../dokumente/aufbewahrung";
import { STANDARD_AUFBEWAHRUNG_TAGE } from "../konfiguration";
import { bereiteVor, hatVerknuepfung, ocrAn, legeDokumentAn, sichtbareDubletten, verknuepfungenVon } from "../dokumente/speichern";
import { dispositionKopf, INLINE_ERLAUBT, MAX_DOKUMENT } from "../dokumente/typ";
import { darfZiel, dokumentSichtbar, fundstelleSichtbarFuer, ladeZielFonds, verlangeZiele, ZIEL_TYPEN, zielName, zielSichtbarFuer, type Ziel } from "../dokumente/ziele";
import { Fachfehler, fehlerAntwort, type Feldfehler } from "../fehler";
import { idParam, protokolliereLesen, schreibe, textEingabe } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";
import { berichtPruefung, berichtSchema } from "../berichte-pruefung";
import { berichtAnApi } from "../berichte-vertrag";

const pruefeApi = berichtPruefung("document");
const anApi = <T>(wert: T) => berichtAnApi("document", wert);

/**
 * Dokumente (Etappe 13): Upload, Liste, Download, Ersetzen, weiches Löschen, Verknüpfungen und Volltextsuche.
 *
 * Rechte folgen den verknüpften Zielen (siehe `dokumente/ziele.ts`): lesen, wer mindestens ein Ziel sehen darf (sonst 404, kein Hinweis auf
 * die Existenz); hochladen, ändern und ersetzen, wer an jedem Ziel Bearbeiter ist; löschen, wer an jedem Ziel Verwalter ist. Die
 * Berechtigungstabelle prüft nur die Grundrolle, die Ziele prüfen die Handler (die Ziele stehen im multipart-Körper bzw. in der Verknüpfungstabelle).
 */

const klassifikationEingabe = z.enum(dokumentKlassifikation.enumValues);
const zielSchema = z.object({ typ: z.enum(ZIEL_TYPEN), id: z.uuid() });
const zieleSchema = berichtSchema("document", z.array(zielSchema).min(1, "At least one target is required").max(20));
const klassifikationFormular = berichtSchema("document", z.object({ klassifikation: klassifikationEingabe }));

const ungueltig = (felder: Feldfehler[]) => new Fachfehler(400, "invalid_input", "The input is invalid.", { felder });

const listenAbfrage = z.object({
  zielTyp: z.enum(ZIEL_TYPEN).optional(),
  zielId: z.uuid().optional(),
  klassifikation: klassifikationEingabe.optional(),
  status: z.enum(["aktiv", "ersetzt", "geloescht", "endgueltig_geloescht", "alle"]).default("aktiv"),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const sucheAbfrage = z.object({ q: z.string().trim().min(2).max(200), limit: z.coerce.number().int().min(1).max(50).default(20) });
const aenderung = z
  .object({ klassifikation: klassifikationEingabe.optional(), vertraulich: z.boolean().optional(), dateiname: textEingabe(200).optional() })
  .refine((w) => Object.values(w).some((x) => x !== undefined), { message: "At least one field must be provided", path: [] });
const verknuepfungParam = z.object({ id: z.uuid(), typ: z.enum(ZIEL_TYPEN), zielId: z.uuid() });
const dateiAbfrage = z.object({ inline: z.enum(["0", "1"]).optional() });
const seitenParam = z.object({ id: z.uuid(), seite: z.coerce.number().int().min(1).max(100_000) });

/** Marker um Treffer im Ausschnitt der Suche; die Oberfläche setzt daraus `<mark>`, der übrige Text bleibt reiner Text. */
export const TREFFER_START = "⟦";
export const TREFFER_ENDE = "⟧";

const nicht = () => new Fachfehler(404, "document_not_found", "Document not found.");

/** Dokument laden, das die Person sehen darf; weich gelöschte sehen nur Verwalter. Sonst 404. */
export async function ladeSichtbaresDokument(tx: Tx, akteur: Akteur, id: string, sperren = false, stand?: string): Promise<Dokument> {
  const abfrage = tx.select().from(dokument).where(and(eq(dokument.id, id), dokumentSichtbar(akteur, sql`${dokument.id}`),
    stand ? sql`${dokument.hochgeladenAm} <= ${stand}::timestamptz` : undefined));
  const [d] = await (sperren ? abfrage.for("update") : abfrage);
  if (!d) throw nicht();
  if (d.status === "geloescht" || d.status === "endgueltig_geloescht") {
    const [v] = await tx.select({ id: dokument.id }).from(dokument).where(and(eq(dokument.id, id), dokumentSichtbar(akteur, sql`${dokument.id}`, "verwalter")));
    if (!v) throw nicht();
  }
  return d;
}

interface VerknuepfungAnzeige {
  typ: Ziel["typ"];
  id: string;
  name: string | null;
}

/** Verknüpfungen eines Dokuments, die die Person sehen darf (mit Namen). */
async function sichtbareVerknuepfungen(tx: Tx, akteur: Akteur, dokumentId: string, stand?: string): Promise<VerknuepfungAnzeige[]> {
  const { rows } = await tx.execute<{ typ: Ziel["typ"]; id: string; name: string | null }>(sql`
    SELECT v.ziel_typ::text AS typ, v.ziel_id AS id, ${zielName(sql`v.ziel_typ::text`, sql`v.ziel_id`)} AS name
    FROM dokument_verknuepfung v
    WHERE v.dokument_id = ${dokumentId} AND ${zielSichtbarFuer(akteur, sql`v.ziel_typ::text`, sql`v.ziel_id`)}
    ${stand ? sql`AND v.erstellt_am <= ${stand}::timestamptz` : sql``}
    ORDER BY v.ziel_typ::text, v.erstellt_am, v.ziel_id`);
  return rows;
}

const zeigeDokument = (d: Dokument, verknuepfungen: VerknuepfungAnzeige[]) => ({
  id: d.id,
  dateiname: d.dateiname,
  mime: d.mime,
  groesse: d.groesse,
  sha256: d.sha256,
  status: d.status,
  klassifikation: d.klassifikation,
  vertraulich: d.vertraulich,
  textStatus: d.textStatus,
  seitenzahl: d.seitenzahl,
  hochgeladenVon: d.hochgeladenVon,
  hochgeladenVonName: d.hochgeladenVonName,
  hochgeladenAm: d.hochgeladenAm.toISOString(),
  vorgaengerId: d.vorgaengerId,
  ersetztAm: d.ersetztAm?.toISOString() ?? null,
  geloeschtAm: d.geloeschtAm?.toISOString() ?? null,
  endgueltigGeloeschtAm: d.endgueltigGeloeschtAm?.toISOString() ?? null,
  verknuepfungen,
});

/** Alle Ziele des Dokuments (auch die, die die Person nicht sieht) als Eingabe für die Rechteprüfung beim Ändern. */
const verlangeAlleZiele = async (tx: Tx, akteur: Akteur, dokumentId: string, rolle: "bearbeiter" | "verwalter") => {
  await verlangeZiele(tx, akteur, await verknuepfungenVon(tx, dokumentId), rolle);
};

/** Liest die multipart-Felder eines Uploads; der Dateiinhalt wird erst nach der Rechteprüfung in den Speicher gelesen. */
async function leseFormular(c: Context) {
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
  if (datei.size > MAX_DOKUMENT) throw new Fachfehler(413, "document_too_large", `The document is larger than ${MAX_DOKUMENT / 1024 / 1024} MB.`);
  const text = (feld: string) => (typeof formular[feld] === "string" ? (formular[feld] as string) : undefined);
  return { datei, text };
}

const bodyGrenze = bodyLimit({
  maxSize: MAX_DOKUMENT + 256 * 1024,
  onError: (c) => fehlerAntwort(c, 413, "document_too_large", `The document is larger than ${MAX_DOKUMENT / 1024 / 1024} MB.`),
});

function leseZiele(roh: string | undefined): Ziel[] {
  let wert: unknown;
  try {
    wert = JSON.parse(roh ?? "");
  } catch {
    throw ungueltig([{ feld: "ziele", code: "invalid_type", meldung: "The field \"targets\" must be a JSON list of { type, id }" }]);
  }
  const ergebnis = zieleSchema.safeParse(wert);
  if (!ergebnis.success) throw ungueltig(ergebnis.error.issues.map((i) => ({ feld: ["ziele", ...i.path].join("."), code: i.code, meldung: i.message })));
  return ergebnis.data;
}

function leseKlassifikation(roh: string | undefined, standard: Dokument["klassifikation"]): Dokument["klassifikation"] {
  if (roh === undefined || roh === "") return standard;
  const e = klassifikationFormular.safeParse({ classification: roh });
  if (!e.success) throw ungueltig([{ feld: "klassifikation", code: "invalid_value", meldung: `Unknown document classification` }]);
  return e.data.klassifikation;
}

const leseWahrheitswert = (roh: string | undefined, feld: string, standard: boolean): boolean => {
  if (roh === undefined || roh === "") return standard;
  if (roh === "true" || roh === "1") return true;
  if (roh === "false" || roh === "0") return false;
  throw ungueltig([{ feld, code: "invalid_type", meldung: "true or false expected" }]);
};

/** Ausgabe der Datei: Bytes mit sicheren Köpfen. Nur PDF und Bilder gibt es auf Wunsch inline, dann mit strenger Sandbox. */
function dateiAntwort(d: Dokument, strom: ReadableStream<Uint8Array> | Uint8Array, inline: boolean) {
  const zeigeInline = inline && INLINE_ERLAUBT.has(d.mime);
  const koerper = strom instanceof Uint8Array ? new Uint8Array(strom) : strom;
  return new Response(koerper, {
    status: 200,
    headers: {
      "Content-Type": d.mime,
      "Content-Length": String(d.groesse),
      "Content-Disposition": dispositionKopf(zeigeInline ? "inline" : "attachment", d.dateiname),
      "X-Content-Type-Options": "nosniff",
      // Nichts ausführen, nichts nachladen: ein dargestelltes Dokument bekommt keine Rechte der Anwendung.
      "Content-Security-Policy": zeigeInline ? "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; sandbox; frame-ancestors 'self'" : "default-src 'none'; sandbox",
      "X-Frame-Options": zeigeInline ? "SAMEORIGIN" : "DENY",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": "private, no-store",
      "X-File-Sha256": d.sha256,
    },
  });
}

export function dokumentRouten(db: Db, speicher: Speicher, aufbewahrungTage = STANDARD_AUFBEWAHRUNG_TAGE) {
  return new Hono()
    /** Liste der sichtbaren Dokumente, optional zu einem Ziel (`targetType` und `targetId`), mit sichtbaren Verknüpfungen. */
    .get("/", pruefeApi("query", listenAbfrage), async (c) => {
      const q = c.req.valid("query");
      const akteur = aktuellerAkteur(c);
      if ((q.zielTyp === undefined) !== (q.zielId === undefined)) throw ungueltig([{ feld: q.zielTyp === undefined ? "zielTyp" : "zielId", code: "invalid_type", meldung: "targetType and targetId must be supplied together" }]);
      // Weich gelöschte Dokumente listen nur Verwalter; `alle` meint aktive und ersetzte.
      const statusBedingung =
        q.status === "alle"
          ? sql`d.status IN ('aktiv', 'ersetzt')`
          : q.status === "geloescht" || q.status === "endgueltig_geloescht"
            ? sql`d.status = ${q.status}::dokument_status AND ${dokumentSichtbar(akteur, sql`d.id`, "verwalter")}`
            : sql`d.status = ${q.status}::dokument_status`;
      const daten = await lese(db, async (tx) => {
        const { rows } = await tx.execute<{ id: string }>(sql`
          SELECT d.id FROM dokument d
          WHERE ${statusBedingung}
            AND ${dokumentSichtbar(akteur, sql`d.id`)}
            ${q.klassifikation ? sql`AND d.klassifikation = ${q.klassifikation}::dokument_klassifikation` : sql``}
            ${q.zielTyp && q.zielId ? sql`AND EXISTS (SELECT 1 FROM dokument_verknuepfung z WHERE z.dokument_id = d.id AND z.ziel_typ = ${q.zielTyp}::dokument_ziel_typ AND z.ziel_id = ${q.zielId})` : sql``}
          ORDER BY d.hochgeladen_am DESC, d.id
          LIMIT ${q.limit}`);
        const ergebnis = [];
        for (const r of rows) {
          const [d] = await tx.select().from(dokument).where(eq(dokument.id, r.id));
          if (d) ergebnis.push(zeigeDokument(d, await sichtbareVerknuepfungen(tx, akteur, d.id)));
        }
        return ergebnis;
      });
      return c.json(anApi({ daten }), 200);
    })
    /** Volltextsuche über den Text der aktuellen Versionen (deutsche Wortstämme und wörtliche Treffer), nur in sichtbaren Dokumenten. */
    .get("/search", pruefeApi("query", sucheAbfrage), async (c) => {
      const { q, limit } = c.req.valid("query");
      const akteur = aktuellerAkteur(c);
      const daten = await lese(db, (tx) => sucheDokumentSeiten(tx, akteur, q, limit));
      return c.json(anApi({ q, daten }), 200);
    })
    /**
     * Aufbewahrung gelöschter Dokumente (globale Verwalter): Frist, gelöschte Dokumente mit Datum, ab dem der Worker die Datei entfernt, und ob eine
     * abgelaufene Datei noch gebraucht wird (geteilte Datei, Fundstelle, Registerauszug, Beleg).
     */
    .get("/retention", async (c) => {
      const jetzt = new Date();
      const { daten, endgueltig } = await lese(db, (tx) => ausstehendeLoeschungen(tx, aufbewahrungTage, jetzt));
      return c.json(anApi({ aufbewahrungTage, daten, endgueltigGeloescht: endgueltig }), 200);
    })
    /** Hochladen (multipart): Feld `file`, `targets` (JSON-Liste aus `{ type, id }`), optional `classification` und `confidential`. */
    .post("/", bodyGrenze, async (c) => {
      const { datei, text } = await leseFormular(c);
      const akteur = aktuellerAkteur(c);
      const ziele = leseZiele(text("targets"));
      const klassifikation = leseKlassifikation(text("classification"), "sonstiges");
      const vertraulich = leseWahrheitswert(text("confidential"), "vertraulich", false);
      await lese(db, (tx) => verlangeZiele(tx, akteur, ziele, "bearbeiter"));
      const vorbereitet = await bereiteVor(speicher, new Uint8Array(await datei.arrayBuffer()), datei.name);
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        await verlangeZiele(tx, akteur, ziele, "bearbeiter");
        const dubletten = await sichtbareDubletten(tx, akteur, vorbereitet.hash);
        if (dubletten[0]) {
          throw new Fachfehler(409, "document_exists", "This document already exists.", {
            dokumentId: dubletten[0].id,
            dateiname: dubletten[0].dateiname,
            verknuepfungen: await sichtbareVerknuepfungen(tx, akteur, dubletten[0].id),
          });
        }
        const neu = await legeDokumentAn(tx, protokoll, { id: akteur.id, name: akteur.name }, vorbereitet, { klassifikation, vertraulich, ziele });
        return zeigeDokument(neu, await sichtbareVerknuepfungen(tx, akteur, neu.id));
      });
      return c.json(anApi(ergebnis), 201);
    })
    .get("/:id", pruefeApi("param", idParam), pruefeApi("query", z.object({ stand: z.iso.datetime({ offset: true }).optional() })), async (c) => {
      const { stand } = c.req.valid("query");
      const { id } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      const ergebnis = await lese(db, async (tx) => {
        const d = await ladeSichtbaresDokument(tx, akteur, id, false, stand);
        // Jede Version hat eigene Verknüpfungen: Nachfolger, Vorgänger und Fundstellen erscheinen nur, wenn die Person sie selbst sehen darf (Issue #130).
        // Wie `ladeSichtbaresDokument`: eine gelöschte Version nur für Verwalter an einem ihrer Ziele. Der Alias darf nicht `v` heißen (Verknüpfungen in `dokumentSichtbar`).
        const sichtbar = (n: SQL) => sql`${dokumentSichtbar(akteur, sql`${n}.id`)} AND (${n}.status IN ('aktiv', 'ersetzt') OR ${dokumentSichtbar(akteur, sql`${n}.id`, "verwalter")})`;
        const { rows: nachfolger } = await tx.execute<{ id: string }>(sql`SELECT id FROM dokument nachfolger WHERE nachfolger.vorgaenger_id = ${id} AND ${sichtbar(sql`nachfolger`)}
          ${stand ? sql`AND nachfolger.hochgeladen_am <= ${stand}::timestamptz AND nachfolger.status IN ('aktiv', 'ersetzt')` : sql``} LIMIT 1`);
        // Versionskette: Vorgänger bis zum Anfang (höchstens 50 Schritte), die Nachfolger folgen aus `vorgaengerId`. In der aktuellen Ansicht läuft die
        // Kette über alle Vorgänger weiter und zeigt nur die sichtbaren; eine unsichtbare Version wird übersprungen, ohne etwas über sie preiszugeben.
        const versionen: { id: string; dateiname: string; status: string; hochgeladenAm: string; sha256: string }[] = [];
        let aktuell: Dokument | undefined = d;
        for (let i = 0; i < 50 && aktuell; i++) {
          const vorgaenger: Dokument | undefined = aktuell.vorgaengerId ? (await tx.select().from(dokument).where(and(eq(dokument.id, aktuell.vorgaengerId),
            stand ? sql`${dokument.hochgeladenAm} <= ${stand}::timestamptz AND ${dokument.status} IN ('aktiv', 'ersetzt') AND ${dokumentSichtbar(akteur, sql`${dokument.id}`)}` : undefined)))[0] : undefined;
          if (vorgaenger && (stand || (await tx.execute(sql`SELECT 1 FROM dokument vorgaenger WHERE vorgaenger.id = ${vorgaenger.id} AND ${sichtbar(sql`vorgaenger`)}`)).rows.length > 0)) {
            versionen.unshift({ id: vorgaenger.id, dateiname: vorgaenger.dateiname, status: vorgaenger.status, hochgeladenAm: vorgaenger.hochgeladenAm.toISOString(), sha256: vorgaenger.sha256 });
          }
          aktuell = vorgaenger;
        }
        const { rows: fundstellen } = await tx.execute<{ objekt_typ: string; objekt_id: string; feld: string; wert: string; seite: number; zitat: string }>(
          sql`SELECT objekt_typ, objekt_id, feld, wert, seite, zitat FROM wert_quelle q WHERE dokument_id = ${id}
            ${stand ? sql`AND erstellt_am <= ${stand}::timestamptz` : sql``} AND ${fundstelleSichtbarFuer(akteur, sql`q.objekt_typ`, sql`q.objekt_id`)}
            ORDER BY erstellt_am, feld`,
        );
        return {
          ...zeigeDokument(d, await sichtbareVerknuepfungen(tx, akteur, id, stand)),
          ersetztDurch: nachfolger[0]?.id ?? null,
          vorgaenger: versionen,
          fundstellen: fundstellen.map((f) => ({ objektTyp: f.objekt_typ, objektId: f.objekt_id, feld: f.feld, wert: f.wert, seite: f.seite, zitat: f.zitat })),
        };
      });
      return c.json(anApi(ergebnis), 200);
    })
    /** Textseite eines PDF (für Zitate und Fundstellen). */
    .get("/:id/pages/:page", pruefeApi("param", seitenParam), async (c) => {
      const { id, seite } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      const zeile = await lese(db, async (tx) => {
        await ladeSichtbaresDokument(tx, akteur, id);
        const [s] = await tx.select({ seite: dokumentSeite.seite, text: dokumentSeite.text, quelle: dokumentSeite.quelle, konfidenz: dokumentSeite.konfidenz }).from(dokumentSeite).where(and(eq(dokumentSeite.dokumentId, id), eq(dokumentSeite.seite, seite)));
        return s;
      });
      if (!zeile) return fehlerAntwort(c, 404, "not_found", "The requested resource does not exist.");
      return c.json(anApi(zeile), 200);
    })
    /** Datei: als Download; mit `inline=1` zeigt der Browser PDF und Bilder in einem Rahmen mit Sandbox. Schreibt eine Zeile `gelesen` ins Protokoll. */
    .get("/:id/file", pruefeApi("param", idParam), pruefeApi("query", dateiAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { inline } = c.req.valid("query");
      const akteur = aktuellerAkteur(c);
      const d = await lese(db, (tx) => ladeSichtbaresDokument(tx, akteur, id));
      if (d.status === "endgueltig_geloescht") throw new Fachfehler(410, "document_permanently_deleted", "The file was permanently deleted after the retention period expired.");
      let quelle: ReadableStream<Uint8Array> | Uint8Array;
      try {
        quelle = speicher.strom ? await speicher.strom(d.gespeichertUnter) : await speicher.lese(d.gespeichertUnter);
      } catch {
        throw new Fachfehler(500, "file_corrupt", "The file is no longer in the file storage.");
      }
      await protokolliereLesen(db, c, "dokument", id, { dokument: "datei", inline: inline === "1", dateiname: d.dateiname, sha256: d.sha256 });
      return dateiAntwort(d, quelle, inline === "1");
    })
    .patch("/:id", pruefeApi("param", idParam), pruefeApi("json", aenderung), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeSichtbaresDokument(tx, akteur, id, true);
        if (vorher.status !== "aktiv") throw new Fachfehler(409, "document_not_active", "Only an active document can be changed.");
        await verlangeAlleZiele(tx, akteur, id, "bearbeiter");
        const [neu] = await tx
          .update(dokument)
          .set({ ...(e.klassifikation ? { klassifikation: e.klassifikation } : {}), ...(e.vertraulich !== undefined ? { vertraulich: e.vertraulich } : {}), ...(e.dateiname ? { dateiname: e.dateiname } : {}) })
          .where(eq(dokument.id, id))
          .returning();
        await protokoll("aendern", "dokument", id, { klassifikation: vorher.klassifikation, vertraulich: vorher.vertraulich, dateiname: vorher.dateiname }, { klassifikation: neu!.klassifikation, vertraulich: neu!.vertraulich, dateiname: neu!.dateiname });
        return zeigeDokument(neu!, await sichtbareVerknuepfungen(tx, akteur, id));
      });
      return c.json(anApi(ergebnis), 200);
    })
    /** Neue Version (multipart, Feld `datei`): Die alte bleibt als `ersetzt` les- und herunterladbar, Verknüpfungen und Klassifikation gehen auf die neue über. */
    .post("/:id/replace", bodyGrenze, pruefeApi("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const { datei } = await leseFormular(c);
      const akteur = aktuellerAkteur(c);
      await lese(db, async (tx) => {
        const alt = await ladeSichtbaresDokument(tx, akteur, id);
        if (alt.status !== "aktiv") throw new Fachfehler(409, "document_not_active", "Only an active document can be replaced.");
        await verlangeAlleZiele(tx, akteur, id, "bearbeiter");
      });
      const vorbereitet = await bereiteVor(speicher, new Uint8Array(await datei.arrayBuffer()), datei.name);
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const alt = await ladeSichtbaresDokument(tx, akteur, id, true);
        if (alt.status !== "aktiv") throw new Fachfehler(409, "document_not_active", "Only an active document can be replaced.");
        const ziele = await verknuepfungenVon(tx, id);
        await verlangeZiele(tx, akteur, ziele, "bearbeiter");
        if (alt.sha256 === vorbereitet.hash) {
          throw new Fachfehler(409, "document_exists", "The new file is identical to the current version.", { dokumentId: alt.id, dateiname: alt.dateiname, verknuepfungen: await sichtbareVerknuepfungen(tx, akteur, alt.id) });
        }
        const neu = await legeDokumentAn(tx, protokoll, { id: akteur.id, name: akteur.name }, vorbereitet, { klassifikation: alt.klassifikation, vertraulich: alt.vertraulich, ziele, vorgaengerId: alt.id });
        await tx.update(dokument).set({ status: "ersetzt", ersetztAm: new Date() }).where(eq(dokument.id, alt.id));
        await protokoll("ersetzen", "dokument", alt.id, { status: "aktiv" }, { status: "ersetzt", nachfolgerId: neu.id });
        return zeigeDokument(neu, await sichtbareVerknuepfungen(tx, akteur, neu.id));
      });
      return c.json(anApi(ergebnis), 201);
    })
    /**
     * Texterkennung anfordern (nur mit `OCR=lokal`): für einen Scan ohne Text, ein Bild oder einen fehlgeschlagenen Versuch. Der Worker erkennt den Text später;
     * bis dahin steht das Dokument auf `ocr_ausstehend`. Wiederholtes Anfordern ändert nichts.
     */
    .post("/:id/ocr", pruefeApi("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const d = await ladeSichtbaresDokument(tx, akteur, id, true);
        if (d.status !== "aktiv") throw new Fachfehler(409, "document_not_active", "OCR is only possible for an active document.");
        await verlangeAlleZiele(tx, akteur, id, "bearbeiter");
        if (!ocrAn()) throw new Fachfehler(409, "ocr_disabled", "OCR is not enabled.");
        const bild = d.mime === "image/png" || d.mime === "image/jpeg";
        const moeglich = (d.mime === "application/pdf" || bild) && ["kein_text", "nicht_unterstuetzt", "fehler", "ocr_ausstehend"].includes(d.textStatus);
        if (!moeglich) throw new Fachfehler(409, "ocr_not_possible", "OCR is not needed or not possible for this document.", { textStatus: d.textStatus });
        if (d.textStatus === "ocr_ausstehend") return d;
        const [neu] = await tx.update(dokument).set({ textStatus: "ocr_ausstehend", textVersuche: 0, textBegonnenAm: null }).where(eq(dokument.id, id)).returning();
        await protokoll("texterkennung_anfordern", "dokument", id, { textStatus: d.textStatus }, { textStatus: "ocr_ausstehend" });
        return neu!;
      });
      return c.json(anApi(zeigeDokument(ergebnis, await lese(db, (tx) => sichtbareVerknuepfungen(tx, akteur, id)))), 200);
    })
    /** Weiches Löschen (Verwalter an jedem Ziel): Der Status wird `geloescht`, die Datei bleibt bis zum Aufbewahrungslauf in der Ablage. */
    .delete("/:id", pruefeApi("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      await schreibe(db, c, async (tx, protokoll) => {
        const d = await ladeSichtbaresDokument(tx, akteur, id, true);
        if (d.status === "geloescht" || d.status === "endgueltig_geloescht") return;
        await verlangeAlleZiele(tx, akteur, id, "verwalter");
        await tx.update(dokument).set({ status: "geloescht", geloeschtAm: new Date(), geloeschtVon: akteur.id }).where(eq(dokument.id, id));
        await protokoll("loeschen", "dokument", id, { status: d.status }, { status: "geloescht", sha256: d.sha256 });
      });
      return c.body(null, 204);
    })
    .post("/:id/links", pruefeApi("param", idParam), pruefeApi("json", zielSchema), async (c) => {
      const { id } = c.req.valid("param");
      const ziel = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const d = await ladeSichtbaresDokument(tx, akteur, id, true);
        if (d.status !== "aktiv") throw new Fachfehler(409, "document_not_active", "Only an active document can be linked.");
        // Eine Verknüpfung erweitert den Kreis, der das Dokument sieht: Bearbeiter an allen bisherigen Zielen und am neuen. Ein Ziel ohne Fonds
        // (Deal vor der Zuordnung) macht es für alle Personen mit einer Rolle sichtbar, ein vertrauliches Dokument darf nur ein Verwalter verknüpfen.
        await verlangeAlleZiele(tx, akteur, id, "bearbeiter");
        const [neuesZiel] = await verlangeZiele(tx, akteur, [ziel], "bearbeiter");
        if (neuesZiel?.art === "irgendwo" || d.vertraulich) await verlangeAlleZiele(tx, akteur, id, "verwalter");
        if (!(await hatVerknuepfung(tx, id, ziel))) {
          await tx.insert(dokumentVerknuepfung).values({ dokumentId: id, zielTyp: ziel.typ, zielId: ziel.id, erstelltVon: akteur.id });
          await protokoll("verknuepfen", "dokument", id, null, { ziel });
        }
        return zeigeDokument(d, await sichtbareVerknuepfungen(tx, akteur, id));
      });
      return c.json(anApi(ergebnis), 200);
    })
    .delete("/:id/links/:type/:targetId", pruefeApi("param", verknuepfungParam), async (c) => {
      const { id, typ, zielId } = c.req.valid("param");
      const ziel: Ziel = { typ, id: zielId };
      const akteur = aktuellerAkteur(c);
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const d = await ladeSichtbaresDokument(tx, akteur, id, true);
        if (d.status !== "aktiv") throw new Fachfehler(409, "document_not_active", "Only an active document can be changed.");
        const alle = await verknuepfungenVon(tx, id);
        if (!alle.some((z) => z.typ === typ && z.id === zielId)) throw new Fachfehler(404, "not_found", "The requested resource does not exist.");
        // Das Ziel muss die Person bearbeiten dürfen (auch wenn es das Ziel nicht mehr gibt, dann genügt die Rolle am Dokument).
        const zf = await ladeZielFonds(tx, ziel);
        if (zf !== null && !darfZiel(akteur, zf, "bearbeiter")) throw new Fachfehler(403, "forbidden", "You lack permission on the link target.");
        // Entfernen verengt den Kreis nur für Berechtigte: auch an den verbleibenden Zielen ist die Rolle Bearbeiter nötig.
        await verlangeZiele(tx, akteur, alle.filter((z) => !(z.typ === typ && z.id === zielId)), "bearbeiter");
        if (alle.length === 1) throw new Fachfehler(409, "document_last_link", "The last link cannot be removed; the document would otherwise have no visible target. Delete the document instead.");
        await tx.delete(dokumentVerknuepfung).where(and(eq(dokumentVerknuepfung.dokumentId, id), eq(dokumentVerknuepfung.zielTyp, typ), eq(dokumentVerknuepfung.zielId, zielId)));
        await protokoll("entknuepfen", "dokument", id, { ziel }, null);
        return zeigeDokument(d, await sichtbareVerknuepfungen(tx, akteur, id));
      });
      return c.json(anApi(ergebnis), 200);
    });
}

export interface Suchtreffer {
  dokumentId: string;
  dateiname: string;
  klassifikation: Dokument["klassifikation"];
  seite: number;
  ausschnitt: string;
  rang: number;
  /** `ocr`: Der Treffer steht im Text der Texterkennung. */
  quelle: "text" | "ocr";
}

/** Volltextsuche je Seite, nach Rang; nur aktive Dokumente, die die Person sehen darf. Der Ausschnitt trägt die Treffer zwischen `TREFFER_START` und `TREFFER_ENDE`. */
export async function sucheDokumentSeiten(tx: Tx, akteur: Akteur, q: string, limit: number): Promise<Suchtreffer[]> {
  const { rows } = await tx.execute<{ dokument_id: string; dateiname: string; klassifikation: Dokument["klassifikation"]; seite: number; ausschnitt: string; rang: number; quelle: string }>(sql`
    WITH abfrage AS (SELECT websearch_to_tsquery('german', ${q}) AS de, websearch_to_tsquery('simple', ${q}) AS einfach)
    SELECT d.id AS dokument_id, d.dateiname, d.klassifikation::text AS klassifikation, s.seite,
      ts_headline('german', s.text, a.de, ${`StartSel=${TREFFER_START}, StopSel=${TREFFER_ENDE}, MaxFragments=1, MaxWords=30, MinWords=10, ShortWord=2`}) AS ausschnitt, s.quelle,
      greatest(ts_rank(s.suchvektor, a.de), ts_rank(s.suchvektor, a.einfach))::float8 AS rang
    FROM dokument_seite s
    JOIN dokument d ON d.id = s.dokument_id
    CROSS JOIN abfrage a
    WHERE d.status = 'aktiv' AND (s.suchvektor @@ a.de OR s.suchvektor @@ a.einfach) AND ${dokumentSichtbar(akteur, sql`d.id`)}
    ORDER BY rang DESC, d.hochgeladen_am DESC, d.id, s.seite
    LIMIT ${limit}`);
  return rows.map((r) => ({ dokumentId: r.dokument_id, dateiname: r.dateiname, klassifikation: r.klassifikation, seite: r.seite, ausschnitt: r.ausschnitt, rang: Math.round(Number(r.rang) * 1000) / 1000, quelle: r.quelle === "ocr" ? "ocr" : "text" }));
}
