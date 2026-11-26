import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { abfrageZugriff, beteiligung, kennzahlAbfrage, kennzahlAbfragePosition, kennzahlDefinition, kennzahlWert, organisation, type Db, type KennzahlAbfrage } from "@carraway/db";
import { clientIp } from "../anmeldung/schutz";
import { Fachfehler } from "../fehler";
import { kanonischerWert } from "../kpi/wert";
import type { Konfiguration } from "../konfiguration";
import { pruefe } from "../pruefung";
import { schreibe } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";
import { tokenHash } from "./kennzahlen";

/**
 * Öffentliche Abfrage bei den Unternehmen: `/extern/abfragen/:token`, ohne Konto. Das Token (256 Bit, nur als SHA-256 gespeichert) gehört zu
 * genau einer Anfrage; daraus ergibt sich alles andere (Unternehmen, Zeitraum, angeforderte Kennzahlen). Es gibt keinen Weg zu anderen Daten.
 *
 * - Kein Cookie, keine Sitzung: Die Anfrage wird nie einem angemeldeten Benutzer zugeordnet (Hülle und Rechteprüfung lassen sie als öffentlich
 *   durch, `c.get("akteur")` bleibt leer). Cookies werden nicht gelesen; CSRF trifft hier nicht zu, weil kein mitgesendeter Zugang (Cookie,
 *   Basic-Auth) eine Wirkung hat. Das Token steht in der Adresse, nicht in einem Kopf.
 * - Begrenzung je IP und je Token vor jeder Arbeit; unbekannte Token zählen als Fehlgriff je IP.
 * - Strenge Eingabe (`strict()`, nur angeforderte Kennzahlen, Wert nach Typ), Körper höchstens 64 KB.
 * - Jeder schreibende Zugriff wird mit dem Akteur `extern:<abfrage-id>` ins Änderungsprotokoll geschrieben.
 * - Nach dem Einreichen ist der Link nur noch lesbar; widerrufen oder abgelaufen heißt 410.
 * - Antworten sind `no-store` und `no-referrer` (das Token steht in der Adresse der Seite).
 */

const TOKEN_FORM = /^[A-Za-z0-9_-]{43}$/;
const MAX_KOERPER = 64 * 1024;

const tokenParam = z.object({ token: z.string().max(200) });
const eintrag = z
  .object({
    schluessel: z.string().regex(/^[a-z][a-z0-9_]{1,59}$/),
    /** `null` oder leer entfernt den Entwurf dieser Kennzahl. */
    wert: z.string().max(2100).nullable(),
    kommentar: z.string().trim().max(1000).nullable().optional(),
    /** Nur für ESG-Datenpunkte: Der Wert ist geschätzt; die Quelle dazu. */
    geschaetzt: z.boolean().optional(),
    quellenangabe: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
const speichernSchema = z.object({ werte: z.array(eintrag).max(100) }).strict();

type Variablen = { Variables: { abfrage: KennzahlAbfrage } };

export async function zaehle(db: Db, schluessel: string, sekunden: number): Promise<number> {
  const { rows } = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM abfrage_zugriff WHERE schluessel = ${schluessel} AND am > now() - ${`${sekunden} seconds`}::interval`);
  return rows[0]?.n ?? 0;
}
export const merke = async (db: Db, schluessel: string) => {
  await db.insert(abfrageZugriff).values({ schluessel });
  if (Math.random() < 0.02) await db.execute(sql`DELETE FROM abfrage_zugriff WHERE am < now() - interval '1 hour'`);
};

export const zuViele = () => new Fachfehler(429, "ZU_VIELE_ANFRAGEN", "Zu viele Anfragen. Bitte in einer Minute erneut versuchen.");

export function externRouten(db: Db, konfig: Pick<Konfiguration, "externLimit" | "proxyVertrauen">) {
  const limit = konfig.externLimit;

  /** Begrenzung, Token-Prüfung und Laden der Anfrage; legt die Zeile für die Handler ab. */
  const zugang: MiddlewareHandler<Variablen> = async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Robots-Tag", "noindex, nofollow");
    const ip = clientIp(c, konfig);
    if ((await zaehle(db, `ip:${ip}`, 60)) >= limit.ipProMinute || (await zaehle(db, `fehl:${ip}`, 600)) >= limit.fehlgriffeProZehnMinuten) {
      c.header("Retry-After", "60");
      throw zuViele();
    }
    await merke(db, `ip:${ip}`);
    const token = c.req.param("token") ?? "";
    const nichtGefunden = async () => {
      await merke(db, `fehl:${ip}`);
      return new Fachfehler(404, "ABFRAGE_NICHT_GEFUNDEN", "Diesen Link gibt es nicht.");
    };
    if (!TOKEN_FORM.test(token)) throw await nichtGefunden();
    const hash = tokenHash(token);
    const [zeile] = await lese(db, (tx) => tx.select().from(kennzahlAbfrage).where(eq(kennzahlAbfrage.tokenHash, hash)));
    if (!zeile) throw await nichtGefunden();
    if ((await zaehle(db, `token:${hash.slice(0, 16)}`, 60)) >= limit.tokenProMinute) {
      c.header("Retry-After", "60");
      throw zuViele();
    }
    await merke(db, `token:${hash.slice(0, 16)}`);
    c.set("abfrage", zeile);
    await next();
  };

  const pruefeZustand = (a: KennzahlAbfrage, schreibend: boolean) => {
    if (a.status === "widerrufen") throw new Fachfehler(410, "ABFRAGE_WIDERRUFEN", "Diese Anfrage wurde zurückgezogen.");
    if (a.tokenAblauf.getTime() < Date.now()) throw new Fachfehler(410, "ABFRAGE_ABGELAUFEN", "Dieser Link ist abgelaufen.");
    if (schreibend && a.status !== "offen") throw new Fachfehler(409, "ABFRAGE_EINGEREICHT", "Die Angaben sind eingereicht und lassen sich nicht mehr ändern.");
  };

  /** Inhalt der Seite: genau das, was die Person sehen darf. */
  async function inhalt(tx: Tx, a: KennzahlAbfrage) {
    const [b] = await tx.select({ name: organisation.name }).from(beteiligung).innerJoin(organisation, eq(organisation.id, beteiligung.organisationId)).where(eq(beteiligung.id, a.beteiligungId));
    const positionen = await tx
      .select({ d: kennzahlDefinition })
      .from(kennzahlAbfragePosition)
      .innerJoin(kennzahlDefinition, eq(kennzahlDefinition.id, kennzahlAbfragePosition.definitionId))
      .where(eq(kennzahlAbfragePosition.abfrageId, a.id))
      .orderBy(asc(kennzahlDefinition.reihenfolge), asc(kennzahlDefinition.schluessel));
    const werte = await tx.select().from(kennzahlWert).where(and(eq(kennzahlWert.abfrageId, a.id), isNull(kennzahlWert.verworfenAm)));
    return {
      unternehmen: b?.name ?? "",
      periodeBeginn: a.periodeBeginn,
      periodeEnde: a.periodeEnde,
      faelligAm: a.faelligAm,
      sprache: a.sprache,
      hinweis: a.hinweis,
      /** `esg` = ESG-Fragebogen (Datenpunkte der Nachhaltigkeitsindikatoren), sonst gewöhnliche Kennzahlen. */
      art: a.art,
      ablauf: a.tokenAblauf.toISOString(),
      status: a.status === "offen" ? ("offen" as const) : ("eingereicht" as const),
      schreibgeschuetzt: a.status !== "offen",
      kennzahlen: positionen.map(({ d }) => {
        const w = werte.find((x) => x.definitionId === d.id);
        return {
          schluessel: d.schluessel,
          bezeichnungDe: d.bezeichnungDe,
          bezeichnungEn: d.bezeichnungEn,
          einheit: d.einheit,
          typ: d.typ,
          pflicht: d.pflicht && a.art !== "esg",
          /** ESG-Datenpunkte (Kategorie esg_*) und die Hilfsgröße Unternehmenswert: Erläuterung, Schätzkennzeichen und Quelle werden angezeigt. */
          esg: d.kategorie.startsWith("esg_") || d.regelwerk !== null,
          regelwerk: d.regelwerk,
          erlaeuterungDe: d.erlaeuterungDe,
          erlaeuterungEn: d.erlaeuterungEn,
          wert: w?.wert ?? null,
          kommentar: w?.kommentar ?? null,
          geschaetzt: w?.geschaetzt ?? false,
          quellenangabe: w?.quellenangabe ?? null,
        };
      }),
    };
  }

  return new Hono<Variablen>()
    .use(
      "*",
      bodyLimit({
        maxSize: MAX_KOERPER,
        onError: () => {
          throw new Fachfehler(413, "ANFRAGE_ZU_GROSS", "Die Anfrage ist zu groß.");
        },
      }),
    )
    // `/*` gilt in Hono auch für den Pfad ohne Anhang; eine einzige Zuordnung, damit die Begrenzung nicht doppelt zählt.
    .use("/abfragen/:token/*", zugang)
    .get("/abfragen/:token", pruefe("param", tokenParam), async (c) => {
      const a = c.get("abfrage");
      pruefeZustand(a, false);
      return c.json(await lese(db, (tx) => inhalt(tx, a)), 200);
    })
    /** Speichert Entwürfe (ersetzt die Werte der genannten Kennzahlen; `null` entfernt einen Entwurf). */
    .put("/abfragen/:token", pruefe("param", tokenParam), pruefe("json", speichernSchema), async (c) => {
      const { werte } = c.req.valid("json");
      const a0 = c.get("abfrage");
      pruefeZustand(a0, true);
      const antwort = await schreibe(db, `extern:${a0.id}`, async (tx, protokoll) => {
        const [a] = await tx.select().from(kennzahlAbfrage).where(eq(kennzahlAbfrage.id, a0.id)).for("update");
        if (!a) throw new Fachfehler(404, "ABFRAGE_NICHT_GEFUNDEN", "Diesen Link gibt es nicht.");
        pruefeZustand(a, true);
        const positionen = await tx
          .select({ d: kennzahlDefinition })
          .from(kennzahlAbfragePosition)
          .innerJoin(kennzahlDefinition, eq(kennzahlDefinition.id, kennzahlAbfragePosition.definitionId))
          .where(eq(kennzahlAbfragePosition.abfrageId, a.id));
        const nachSchluessel = new Map(positionen.map(({ d }) => [d.schluessel, d]));
        if (new Set(werte.map((w) => w.schluessel)).size !== werte.length) throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", { felder: [{ feld: "werte", code: "custom", meldung: "Kennzahlen doppelt" }] });
        for (const e of werte) {
          const d = nachSchluessel.get(e.schluessel);
          if (!d) throw new Fachfehler(400, "KENNZAHL_NICHT_ANGEFORDERT", `Die Kennzahl „${e.schluessel}“ ist in dieser Anfrage nicht enthalten.`, { schluessel: e.schluessel });
          const [vorhanden] = await tx.select().from(kennzahlWert).where(and(eq(kennzahlWert.abfrageId, a.id), eq(kennzahlWert.definitionId, d.id), isNull(kennzahlWert.verworfenAm))).for("update");
          if (e.wert === null || e.wert.trim() === "") {
            if (vorhanden) {
              const [zeile] = await tx.update(kennzahlWert).set({ verworfenAm: new Date(), verworfenVon: protokoll.akteur }).where(eq(kennzahlWert.id, vorhanden.id)).returning();
              await protokoll("verwerfen", "kennzahl_wert", vorhanden.id, vorhanden, zeile);
            }
            continue;
          }
          const wert = kanonischerWert(d.typ, e.wert);
          const kommentar = e.kommentar && e.kommentar !== "" ? e.kommentar : null;
          const geschaetzt = e.geschaetzt ?? false;
          const quellenangabe = e.quellenangabe && e.quellenangabe !== "" ? e.quellenangabe : null;
          if (vorhanden) {
            if (vorhanden.wert === wert && vorhanden.kommentar === kommentar && vorhanden.geschaetzt === geschaetzt && vorhanden.quellenangabe === quellenangabe) continue;
            const [zeile] = await tx.update(kennzahlWert).set({ wert, kommentar, geschaetzt, quellenangabe, erfasstAm: new Date() }).where(eq(kennzahlWert.id, vorhanden.id)).returning();
            await protokoll("aendern", "kennzahl_wert", vorhanden.id, vorhanden, zeile);
          } else {
            const [zeile] = await tx
              .insert(kennzahlWert)
              .values({ beteiligungId: a.beteiligungId, definitionId: d.id, periodeBeginn: a.periodeBeginn, periodeEnde: a.periodeEnde, szenario: "ist", wert, quelle: "unternehmen", erfasstVon: protokoll.akteur, status: "entwurf", kommentar, geschaetzt, quellenangabe, abfrageId: a.id })
              .returning();
            await protokoll("anlegen", "kennzahl_wert", zeile!.id, null, zeile);
          }
        }
        return inhalt(tx, a);
      });
      return c.json(antwort, 200);
    })
    /** Reicht ein: alle Pflichtkennzahlen müssen einen Wert haben; danach ist der Link nur noch lesbar. */
    .post("/abfragen/:token/einreichen", pruefe("param", tokenParam), async (c) => {
      const a0 = c.get("abfrage");
      pruefeZustand(a0, true);
      const antwort = await schreibe(db, `extern:${a0.id}`, async (tx, protokoll) => {
        const [a] = await tx.select().from(kennzahlAbfrage).where(eq(kennzahlAbfrage.id, a0.id)).for("update");
        if (!a) throw new Fachfehler(404, "ABFRAGE_NICHT_GEFUNDEN", "Diesen Link gibt es nicht.");
        pruefeZustand(a, true);
        const positionen = await tx
          .select({ d: kennzahlDefinition })
          .from(kennzahlAbfragePosition)
          .innerJoin(kennzahlDefinition, eq(kennzahlDefinition.id, kennzahlAbfragePosition.definitionId))
          .where(eq(kennzahlAbfragePosition.abfrageId, a.id));
        const entwuerfe = await tx.select().from(kennzahlWert).where(and(eq(kennzahlWert.abfrageId, a.id), isNull(kennzahlWert.verworfenAm), eq(kennzahlWert.status, "entwurf"))).for("update");
        // Im ESG-Fragebogen ist keine Angabe verpflichtend (Daten dürfen lückenhaft sein, die Abdeckung zeigt es); ein Wert muss aber da sein.
        const fehlend = a.art === "esg" ? [] : positionen.filter(({ d }) => d.pflicht && !entwuerfe.some((w) => w.definitionId === d.id)).map(({ d }) => d.schluessel);
        if (fehlend.length > 0 || entwuerfe.length === 0) {
          throw new Fachfehler(400, "KENNZAHL_PFLICHT_FEHLT", fehlend.length > 0 ? "Es fehlen Angaben zu Pflichtkennzahlen." : "Es wurde noch kein Wert eingetragen.", { fehlend });
        }
        for (const w of entwuerfe) {
          const [zeile] = await tx.update(kennzahlWert).set({ status: "eingereicht" }).where(eq(kennzahlWert.id, w.id)).returning();
          await protokoll("einreichen", "kennzahl_wert", w.id, w, zeile);
        }
        const [neu] = await tx.update(kennzahlAbfrage).set({ status: "eingereicht", eingereichtAm: new Date() }).where(eq(kennzahlAbfrage.id, a.id)).returning();
        const { tokenHash: _h1, ...vorher } = a;
        const { tokenHash: _h2, ...nachher } = neu!;
        await protokoll("einreichen", "kennzahl_abfrage", a.id, vorher, nachher);
        return inhalt(tx, neu!);
      });
      return c.json(antwort, 200);
    });
}
