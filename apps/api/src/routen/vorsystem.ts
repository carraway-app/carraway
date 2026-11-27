import { createHash } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { importLauf, providerConnection, type Db } from "@carraway/db";
import { AUSWAHL, erzeugeMappe } from "@carraway/import";
import { erlaubterUrsprung, type VorgangArt, type VorsystemAdapter } from "@carraway/import/vorsystem";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { Fachfehler } from "../fehler";
import type { Schluesselring } from "../geheimnis/krypto";
import type { AbrufOptionen } from "../http/oeffentlicher-abruf";
import { ANBIETER_PRAEFIX, leseUndBildeAb, verbindungsStand } from "../import/vorsystem-lauf";
import { credentialAad, saveConnection } from "../integrationen/connection";
import { pruefe } from "../pruefung";
import { verlangeBereiche } from "../rechte/uebergreifend";
import { schreibe } from "../schreiben";
import { berichtAnApi } from "../berichte-vertrag";
import { IMPORT_BEREICHE, MAX_UPLOAD, pruefeUndSpeichere } from "./import";

/**
 * Übernahme aus einem Vorsystem über dessen API (`/import/sources`). Die Adapter melden Erweiterungen an (`ApiErweiterung.vorsysteme`);
 * ohne Adapter ist die Liste leer. Eine Verbindung speichert Ursprung, Fondsauswahl und Zuordnungen; der Zugang kommt aus einer
 * Umgebungsvariablen des Adapters oder verschlüsselt aus der Datenbank. Ein Prüflauf liest die Quelle, bildet sie auf die Importvorlage
 * ab und legt einen gewöhnlichen Importlauf an, der sofort geprüft wird: Befunde, Abnahmeprotokoll und Übernahme (mit Vier-Augen-Prinzip)
 * laufen danach über `/import/runs/{id}`. Die Datei des Laufs ist der eingefrorene Stand der Quelle; die Übernahme liest die Quelle nicht neu.
 */

const anbieterId = (adapter: string) => ANBIETER_PRAEFIX + adapter;
const sourceParam = z.object({ source: z.string().regex(/^[a-z0-9-]{1,60}$/) });
const sourceId = z.string().trim().min(1).max(200);

const settingsSchema = z.strictObject({
  origin: z.url({ protocol: /^https$/ }).max(300).optional(),
  funds: z.array(sourceId).max(500).default([]),
  fundShortNames: z.record(sourceId, z.string().trim().min(1).max(60)).default({}),
  organizations: z.record(sourceId, z.union([z.uuid(), z.literal("new")])).default({}),
  keepSeparate: z.array(sourceId).max(5000).default([]),
  /** Kennzahlen der Quelle (Name oder Schlüssel) zu Schlüsseln des Katalogs. */
  metrics: z.record(z.string().trim().min(1).max(200), z.string().regex(/^[a-z][a-z0-9_]{1,59}$/)).default({}),
  /** Wiederholte Ereignisse dieser Arten je Periode zusammenführen; ohne Angabe Zinsen und Zinszahlungen je Quartal. */
  merge: z.strictObject({ types: z.array(z.enum(AUSWAHL.vorgangArt.map((a) => a.wert) as [string, ...string[]])).max(20), period: z.enum(["month", "quarter", "year"]) }).optional(),
});
const PERIODE = { month: "monat", quarter: "quartal", year: "jahr" } as const;
export type QuellEinstellungen = z.infer<typeof settingsSchema>;
/**
 * Gespeicherte Verbindung (`provider_connection.mapping`): Einstellungen und alle Personen, die die Verbindung seit dem letzten Setzen von
 * Zugang oder Ursprung gespeichert haben (`editors`). Keine von ihnen darf einen Lauf aus dieser Verbindung übernehmen (Vier-Augen-Prinzip).
 */
const gespeichert = (mapping: unknown) => {
  const m = (mapping ?? {}) as { settings?: unknown; editors?: unknown };
  return { settings: settingsSchema.parse(m.settings ?? {}), editors: Array.isArray(m.editors) ? m.editors.filter((x): x is string => typeof x === "string") : [] };
};
const setupSchema = z.strictObject({
  credential: z.string().trim().min(1).max(8192).regex(/^[\x21-\x7e]+$/).optional(),
  settings: settingsSchema,
});

/** Ursprung der Verbindung: der gewählte (gegen die erlaubten Hosts des Adapters geprüft) oder der Standard-Ursprung des Adapters. */
const ursprungVon = (adapter: VorsystemAdapter, settings: Pick<QuellEinstellungen, "origin">): string => {
  const roh = settings.origin ?? adapter.standardUrsprung;
  const ursprung = roh ? erlaubterUrsprung(adapter, roh) : null;
  if (!ursprung) throw new Fachfehler(400, "invalid_input", "The origin is not allowed for this source system.");
  return ursprung;
};
const istStandard = (adapter: VorsystemAdapter, ursprung: string) => !!adapter.standardUrsprung && new URL(adapter.standardUrsprung).origin === ursprung;

export function vorsystemRouten(db: Db, ring: Schluesselring | undefined, adapter: readonly VorsystemAdapter[], http?: AbrufOptionen) {
  const finde = (id: string) => {
    const a = adapter.find((x) => x.id === id);
    if (!a) throw new Fachfehler(404, "import_source_not_found", "Unknown source system.");
    return a;
  };
  const ausUmgebung = (a: VorsystemAdapter) => (a.umgebungsvariable ? process.env[a.umgebungsvariable]?.trim() || undefined : undefined);

  return new Hono()
    /** Angemeldete Quellsysteme mit ihrer Verbindung (ohne Zugangsdaten). */
    .get("/", async (c) => {
      const zeilen = adapter.length ? await db.select({ provider: providerConnection.provider, credential: providerConnection.credential, mapping: providerConnection.mapping }).from(providerConnection).where(inArray(providerConnection.provider, adapter.map((a) => anbieterId(a.id)))) : [];
      return c.json({
        data: adapter.map((a) => {
          const conn = zeilen.find((z) => z.provider === anbieterId(a.id));
          const credential = conn?.credential ? "stored" : ausUmgebung(a) ? "environment" : null;
          return { id: a.id, label: a.bezeichnung, defaultOrigin: a.standardUrsprung ?? null, configured: !!conn, credential, settings: conn ? gespeichert(conn.mapping).settings : null };
        }),
      }, 200);
    })
    /** Verbindung speichern. Ohne `credential` bleibt ein gespeicherter Zugang; ohne gespeicherten braucht es die Umgebungsvariable des Adapters. */
    .put("/:source", pruefe("param", sourceParam), pruefe("json", setupSchema), async (c) => {
      const a = finde(c.req.valid("param").source);
      const { credential, settings } = c.req.valid("json");
      const ursprung = ursprungVon(a, settings);
      const akteurId = aktuellerAkteur(c).id;
      await schreibe(db, c, async (tx, audit) => {
        const [vorhanden] = await tx.select().from(providerConnection).where(eq(providerConnection.provider, anbieterId(a.id))).for("update");
        // Ein gespeicherter Zugang gilt nur für den Ursprung, für den er eingegeben wurde: Ein neuer Ursprung verlangt einen neuen Zugang.
        const bisher = vorhanden ? ursprungVon(a, gespeichert(vorhanden.mapping).settings) : null;
        if (!credential && bisher !== null && bisher !== ursprung) throw new Fachfehler(400, "import_source_credential_missing", "A new credential is required when the origin changes.");
        // Der Zugang aus der Umgebung geht nur an den Standard-Ursprung des Adapters.
        if (!credential && !vorhanden?.credential && !istStandard(a, ursprung)) throw new Fachfehler(400, "import_source_credential_missing", "A stored credential is required for an origin other than the default.");
        // Neuer Zugang oder neuer Ursprung beginnt die Liste neu; sonst kommt die Person dazu.
        const neuGesetzt = !!credential || bisher === null || bisher !== ursprung;
        const vorher = vorhanden && !neuGesetzt ? gespeichert(vorhanden.mapping).editors : [];
        const mapping = { settings, editors: [...new Set([...vorher, akteurId])] };
        let id: string;
        if (credential) {
          if (!ring) throw new Fachfehler(409, "secret_missing", "The credential encryption key is missing.");
          id = await saveConnection(tx, ring, anbieterId(a.id), mapping, credential, vorhanden);
        } else if (vorhanden) {
          id = vorhanden.id;
          await tx.update(providerConnection).set({ mapping }).where(eq(providerConnection.id, id));
        } else {
          if (!ausUmgebung(a)) throw new Fachfehler(400, "import_source_credential_missing", "A credential is required.");
          const [neu] = await tx.insert(providerConnection).values({ provider: anbieterId(a.id), credential: "", mapping }).onConflictDoNothing().returning({ id: providerConnection.id });
          if (!neu) throw new Fachfehler(409, "invalid_input", "Another administrator has configured this source system. Reload its settings.");
          id = neu.id;
        }
        await audit("import_source_configured", "provider_connection", id, null, { source: a.id, settings, credentialChanged: !!credential });
      });
      return c.json({ saved: true }, 200);
    })
    /**
     * Prüflauf: liest die Quelle, legt einen Importlauf mit dem eingefrorenen Stand an und prüft ihn ohne etwas zu übernehmen.
     * Antwort ist der Importlauf (wie `GET /import/runs/{id}`).
     */
    .post("/:source/runs", pruefe("param", sourceParam), async (c) => {
      const a = finde(c.req.valid("param").source);
      const akteur = aktuellerAkteur(c);
      verlangeBereiche(akteur, IMPORT_BEREICHE);
      const [conn] = await db.select().from(providerConnection).where(eq(providerConnection.provider, anbieterId(a.id)));
      if (!conn) throw new Fachfehler(409, "import_source_not_configured", "No connection has been set up for this source system.");
      const { settings, editors } = gespeichert(conn.mapping);
      if (editors.length === 0) throw new Fachfehler(409, "import_source_changed", "It is not recorded who edited the source connection; save the connection again and start a new dry run.");
      const ursprung = ursprungVon(a, settings);
      // Ein gespeicherter Zugang hat Vorrang; der Zugang aus der Umgebung geht nie an einen anderen als den Standard-Ursprung.
      let zugang = !conn.credential && istStandard(a, ursprung) ? ausUmgebung(a) : undefined;
      if (conn.credential) {
        if (!ring) throw new Fachfehler(409, "secret_missing", "The credential encryption key is missing.");
        zugang = ring.entschluessele(conn.credential, credentialAad(conn.id));
      }
      if (!zugang) throw new Fachfehler(409, "import_source_credential_missing", "Credentials for the source system are missing.");
      const { abgebildet, angaben } = await leseUndBildeAb(a, ursprung, zugang, settings.funds, {
        fondsKurzname: settings.fundShortNames,
        organisationen: Object.fromEntries(Object.entries(settings.organizations).map(([k, v]) => [k, v === "new" ? "neu" : v])),
        getrennt: settings.keepSeparate,
        kennzahlen: settings.metrics,
        ...(settings.merge ? { zusammenfuehrung: { arten: settings.merge.types as VorgangArt[], periode: PERIODE[settings.merge.period] } } : {}),
      }, http);
      const datei = await erzeugeMappe("de", abgebildet.zeilen);
      if (datei.length > MAX_UPLOAD) throw new Fachfehler(413, "file_too_large", "The data read from the source is larger than an import run allows; select fewer funds.");
      const lauf = await schreibe(db, c, async (tx, protokoll) => {
        await tx.execute(sql.raw("SET LOCAL statement_timeout = 120000"));
        const [neu] = await tx
          .insert(importLauf)
          .values({ dateiname: `${a.id}-${angaben.readAt.slice(0, 10)}.xlsx`, dateityp: "xlsx", sprache: "de", groesse: datei.length, sha256: createHash("sha256").update(datei).digest("hex"), datei, hochgeladenVon: akteur.id, hochgeladenVonName: akteur.name, vorschau: { source: { ...angaben, editors, connection: verbindungsStand(conn) } } })
          .returning({ id: importLauf.id });
        await protokoll("hochladen", "import_lauf", neu!.id, null, { quelle: a.id, fonds: angaben.funds, anfragen: angaben.requests, wiederholungen: angaben.retries, groesse: datei.length });
        return pruefeUndSpeichere(tx, protokoll, akteur, neu!.id);
      });
      return c.json(berichtAnApi("import", lauf), 201);
    });
}
