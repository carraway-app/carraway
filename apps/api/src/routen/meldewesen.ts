import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  kennzahlSchluessel,
  pruefeDefinition,
  programmSchluessel,
  type DefinitionInhalt,
  type DefinitionsFehler,
} from "@carraway/berichte";
import { beteiligung, foerderprogramm, kennzahlDefinition, meldeAktivierung, meldeDefinition, organisation, organisationMeldedaten, type Db, type MeldeDefinition } from "@carraway/db";
import { Fachfehler } from "../fehler";
import { ladeZuordnungen } from "../melde/quellen";
import { pruefe } from "../pruefung";
import { heute, idParam, ladeFonds, optionalerText, schreibe, textEingabe } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";

/**
 * Förder- und Meldeberichte, Teil 1 (Etappe 15): Meldedefinitionen als versionierte Konfiguration (nur globale Verwalter schreiben), Förderprogramme,
 * Aktivierung je Fonds, die Schlüssel der Beteiligungen (lesend) und Sitzland und Region der Organisationen. Die Läufe stehen in `meldelaeufe.ts`.
 */

const bezeichner = z.string().regex(/^[a-z][a-z0-9_]{1,59}$/, "Kleinbuchstaben, Ziffern und Unterstrich, 2 bis 60 Zeichen, mit einem Buchstaben beginnen");

const kopf = {
  bezeichnungDe: textEingabe(200),
  bezeichnungEn: textEingabe(200),
  herausgeber: textEingabe(200),
  rhythmus: z.enum(["quartal", "halbjahr", "jahr", "stichtag"]),
  format: z.enum(["xlsx", "csv", "pdf", "xml"]),
  gueltigAb: z.iso.date().optional(),
  /** Inhalt der Definition; der Aufbau wird gesondert geprüft, damit die Fehler Pfad und Meldung tragen. */
  definition: z.unknown(),
};
const neueDefinition = z.object({ schluessel: bezeichner, ...kopf });
const neueVersion = z.object({
  bezeichnungDe: kopf.bezeichnungDe.optional(),
  bezeichnungEn: kopf.bezeichnungEn.optional(),
  herausgeber: kopf.herausgeber.optional(),
  rhythmus: kopf.rhythmus.optional(),
  format: kopf.format.optional(),
  gueltigAb: kopf.gueltigAb,
  definition: kopf.definition,
});
const pruefAnfrage = z.object({ definition: z.unknown() });
const schluesselParam = z.object({ schluessel: bezeichner });
const versionParam = z.object({ schluessel: bezeichner, version: z.coerce.number().int().min(1) });
const programmEingabe = z.object({ schluessel: bezeichner, bezeichnung: textEingabe(200) });
const aktivierungEingabe = z.object({ aktiv: z.boolean(), foerderprogramm: bezeichner.nullable().optional() });
const meldedatenEingabe = z.object({ sitzland: z.string().regex(/^[A-Z]{2}$/, "Zwei Großbuchstaben (ISO 3166-1) erwartet").nullable(), region: optionalerText(100) });

const tagDavor = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

export const definitionKopf = (d: MeldeDefinition) => ({
  id: d.id,
  schluessel: d.schluessel,
  version: d.version,
  bezeichnungDe: d.bezeichnungDe,
  bezeichnungEn: d.bezeichnungEn,
  herausgeber: d.herausgeber,
  rhythmus: d.rhythmus,
  format: d.format,
  gueltigAb: d.gueltigAb,
  gueltigBis: d.gueltigBis,
  erstelltVon: d.erstelltVon,
  erstelltAm: d.erstelltAm,
});

/** Die Version, die an einem Tag gilt (höchste Version mit `gueltig_ab <= tag` und offenem oder späterem Ende); `null`, wenn keine gilt. */
export async function geltendeVersion(tx: Pick<Tx, "execute" | "select">, schluessel: string, tag: string): Promise<MeldeDefinition | null> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    SELECT id FROM melde_definition WHERE schluessel = ${schluessel} AND gueltig_ab <= ${tag}::date AND (gueltig_bis IS NULL OR gueltig_bis >= ${tag}::date)
    ORDER BY version DESC LIMIT 1`);
  if (!rows[0]) return null;
  const [d] = await tx.select().from(meldeDefinition).where(eq(meldeDefinition.id, rows[0].id));
  return d ?? null;
}

/**
 * Prüft Aufbau (Zod, Verweise, Zyklen) und Verweise auf die Datenbank: jede gelesene Kennzahl muss im Katalog stehen, jedes Förderprogramm in einem Filter
 * muss es geben. Fehler tragen den Pfad im JSON; sie kommen als 400 `MELDEDEFINITION_UNGUELTIG` mit der Liste in `definitionsfehler`.
 */
export async function pruefeDefinitionMitDatenbank(tx: Pick<Tx, "select">, roh: unknown): Promise<{ ok: true; definition: DefinitionInhalt } | { ok: false; fehler: DefinitionsFehler[] }> {
  const e = pruefeDefinition(roh);
  if (!e.ok) return e;
  const fehler: DefinitionsFehler[] = [];
  const kennzahlen = kennzahlSchluessel(e.definition);
  if (kennzahlen.length) {
    const vorhanden = new Set((await tx.select({ s: kennzahlDefinition.schluessel }).from(kennzahlDefinition).where(inArray(kennzahlDefinition.schluessel, [...new Set(kennzahlen.map((k) => k.schluessel))]))).map((x) => x.s));
    for (const k of kennzahlen) if (!vorhanden.has(k.schluessel)) fehler.push({ pfad: k.pfad, code: "unbekannte_kennzahl", meldung: `Die Kennzahl „${k.schluessel}“ steht nicht im Katalog.`, params: { schluessel: k.schluessel } });
  }
  const programme = programmSchluessel(e.definition);
  if (programme.length) {
    const vorhanden = new Set((await tx.select({ s: foerderprogramm.schluessel }).from(foerderprogramm).where(inArray(foerderprogramm.schluessel, [...new Set(programme.map((p) => p.schluessel))]))).map((x) => x.s));
    for (const p of programme) if (!vorhanden.has(p.schluessel)) fehler.push({ pfad: p.pfad, code: "unbekanntes_programm", meldung: `Das Förderprogramm „${p.schluessel}“ gibt es nicht.`, params: { schluessel: p.schluessel } });
  }
  return fehler.length ? { ok: false, fehler } : e;
}

const ungueltig = (fehler: DefinitionsFehler[]) => new Fachfehler(400, "MELDEDEFINITION_UNGUELTIG", "Die Meldedefinition ist ungültig.", { definitionsfehler: fehler });

/** Strukturansicht für die Vorschau: Abschnitte mit Zahl der Felder und Quellenarten. */
function vorschau(d: DefinitionInhalt) {
  return d.abschnitte.map((a) => {
    const liste = a.typ === "felder" ? a.felder : a.spalten;
    return { id: a.id, typ: a.typ, titel: a.titel, ...(a.typ === "tabelle" ? { je: a.je } : {}), anzahl: liste.length, felder: liste.map((f) => ({ id: f.id, bezeichnung: f.bezeichnung, format: f.format, quelle: f.quelle.art })) };
  });
}

export function meldedefinitionRouten(db: Db) {
  return new Hono()
    /** Je Schlüssel die heute geltende (sonst die jüngste) Version. */
    .get("/", async (c) => {
      const daten = await lese(db, async (tx) => {
        const alle = await tx.select().from(meldeDefinition).orderBy(asc(meldeDefinition.schluessel), desc(meldeDefinition.version));
        const heuteTag = heute();
        const nachSchluessel = new Map<string, MeldeDefinition[]>();
        for (const d of alle) nachSchluessel.set(d.schluessel, [...(nachSchluessel.get(d.schluessel) ?? []), d]);
        return [...nachSchluessel.values()].map((versionen) => {
          const aktuell = versionen.find((d) => d.gueltigAb <= heuteTag && (d.gueltigBis === null || d.gueltigBis >= heuteTag)) ?? versionen[0]!;
          const hinweis = (aktuell.definition as { hinweis?: { de: string; en: string } }).hinweis ?? null;
          return { ...definitionKopf(aktuell), anzahlVersionen: versionen.length, hinweis };
        });
      });
      return c.json({ daten }, 200);
    })
    /** Prüft eine Definition, ohne sie zu speichern: `probleme` mit Pfad und Meldung, bei gültigem Aufbau die Strukturansicht. */
    .post("/pruefen", pruefe("json", pruefAnfrage), async (c) => {
      const { definition } = c.req.valid("json");
      const e = await lese(db, (tx) => pruefeDefinitionMitDatenbank(tx, definition));
      return c.json(e.ok ? { ok: true as const, probleme: [] as DefinitionsFehler[], vorschau: vorschau(e.definition) } : { ok: false as const, probleme: e.fehler, vorschau: null }, 200);
    })
    .post("/", pruefe("json", neueDefinition), async (c) => {
      const e = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const [vorhanden] = await tx.select({ id: meldeDefinition.id }).from(meldeDefinition).where(eq(meldeDefinition.schluessel, e.schluessel)).limit(1);
        if (vorhanden) throw new Fachfehler(409, "MELDEDEFINITION_VORHANDEN", "Diese Meldedefinition gibt es schon; eine Änderung ist eine neue Version.", { schluessel: e.schluessel });
        const geprueft = await pruefeDefinitionMitDatenbank(tx, e.definition);
        if (!geprueft.ok) throw ungueltig(geprueft.fehler);
        const [zeile] = await tx
          .insert(meldeDefinition)
          .values({ schluessel: e.schluessel, version: 1, bezeichnungDe: e.bezeichnungDe, bezeichnungEn: e.bezeichnungEn, herausgeber: e.herausgeber, rhythmus: e.rhythmus, format: e.format, gueltigAb: e.gueltigAb ?? "2000-01-01", definition: geprueft.definition, erstelltVon: protokoll.akteur })
          .returning();
        await protokoll("anlegen", "melde_definition", zeile!.id, null, zeile);
        return zeile!;
      });
      return c.json(definitionKopf(neu), 201);
    })
    /** Alle Versionen eines Schlüssels (ohne Inhalt). */
    .get("/:schluessel", pruefe("param", schluesselParam), async (c) => {
      const { schluessel } = c.req.valid("param");
      const zeilen = await lese(db, (tx) => tx.select().from(meldeDefinition).where(eq(meldeDefinition.schluessel, schluessel)).orderBy(desc(meldeDefinition.version)));
      if (zeilen.length === 0) throw new Fachfehler(404, "MELDEDEFINITION_NICHT_GEFUNDEN", "Meldedefinition nicht gefunden.", { schluessel });
      return c.json({ daten: zeilen.map(definitionKopf) }, 200);
    })
    /** Eine Version mit Inhalt (JSON) und Strukturansicht. */
    .get("/:schluessel/versionen/:version", pruefe("param", versionParam), async (c) => {
      const { schluessel, version } = c.req.valid("param");
      const [d] = await lese(db, (tx) => tx.select().from(meldeDefinition).where(and(eq(meldeDefinition.schluessel, schluessel), eq(meldeDefinition.version, version))));
      if (!d) throw new Fachfehler(404, "MELDEDEFINITION_NICHT_GEFUNDEN", "Version der Meldedefinition nicht gefunden.", { schluessel, version });
      const geprueft = pruefeDefinition(d.definition);
      return c.json({ ...definitionKopf(d), definition: d.definition as DefinitionInhalt, vorschau: geprueft.ok ? vorschau(geprueft.definition) : [] }, 200);
    })
    /** Neue Version: die bisherige gilt bis zum Tag vor `gueltigAb`; bestehende Läufe behalten ihre Version. */
    .post("/:schluessel/versionen", pruefe("param", schluesselParam), pruefe("json", neueVersion), async (c) => {
      const { schluessel } = c.req.valid("param");
      const e = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const [letzte] = await tx.select().from(meldeDefinition).where(eq(meldeDefinition.schluessel, schluessel)).orderBy(desc(meldeDefinition.version)).limit(1).for("update");
        if (!letzte) throw new Fachfehler(404, "MELDEDEFINITION_NICHT_GEFUNDEN", "Meldedefinition nicht gefunden.", { schluessel });
        const geprueft = await pruefeDefinitionMitDatenbank(tx, e.definition);
        if (!geprueft.ok) throw ungueltig(geprueft.fehler);
        const ab = e.gueltigAb ?? heute();
        if (ab <= letzte.gueltigAb) throw new Fachfehler(409, "MELDEDEFINITION_VERSION_ZEITRAUM", "Die neue Version muss nach dem Beginn der bisherigen gelten.", { gueltigAbBisher: letzte.gueltigAb });
        const [zeile] = await tx
          .insert(meldeDefinition)
          .values({
            schluessel,
            version: letzte.version + 1,
            bezeichnungDe: e.bezeichnungDe ?? letzte.bezeichnungDe,
            bezeichnungEn: e.bezeichnungEn ?? letzte.bezeichnungEn,
            herausgeber: e.herausgeber ?? letzte.herausgeber,
            rhythmus: e.rhythmus ?? letzte.rhythmus,
            format: e.format ?? letzte.format,
            gueltigAb: ab,
            definition: geprueft.definition,
            erstelltVon: protokoll.akteur,
          })
          .returning();
        const bis = tagDavor(ab);
        if (letzte.gueltigBis === null || letzte.gueltigBis > bis) {
          const [alt] = await tx.update(meldeDefinition).set({ gueltigBis: bis }).where(eq(meldeDefinition.id, letzte.id)).returning();
          await protokoll("begrenzen", "melde_definition", letzte.id, letzte, alt);
        }
        await protokoll("anlegen", "melde_definition", zeile!.id, null, zeile);
        return zeile!;
      });
      return c.json(definitionKopf(neu), 201);
    });
}

export function foerderprogrammRouten(db: Db) {
  return new Hono()
    .get("/", async (c) => {
      const daten = await lese(db, (tx) => tx.select().from(foerderprogramm).orderBy(asc(foerderprogramm.bezeichnung)));
      return c.json({ daten }, 200);
    })
    .post("/", pruefe("json", programmEingabe), async (c) => {
      const e = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const [vorhanden] = await tx.select({ id: foerderprogramm.id }).from(foerderprogramm).where(eq(foerderprogramm.schluessel, e.schluessel));
        if (vorhanden) throw new Fachfehler(409, "FOERDERPROGRAMM_VORHANDEN", "Dieses Förderprogramm gibt es schon.", { schluessel: e.schluessel });
        const [zeile] = await tx.insert(foerderprogramm).values({ schluessel: e.schluessel, bezeichnung: e.bezeichnung, erstelltVon: protokoll.akteur }).returning();
        await protokoll("anlegen", "foerderprogramm", zeile!.id, null, zeile);
        return zeile!;
      });
      return c.json(neu, 201);
    });
}

async function ladeProgramm(tx: Tx, schluessel: string) {
  const [p] = await tx.select().from(foerderprogramm).where(eq(foerderprogramm.schluessel, schluessel));
  if (!p) throw new Fachfehler(404, "FOERDERPROGRAMM_NICHT_GEFUNDEN", "Förderprogramm nicht gefunden.", { schluessel });
  return p;
}

/** Routen unter `/fonds`: Aktivierung der Definitionen und Schlüssel der Beteiligungen des Fonds (lesend; geändert wird unter `/beteiligungen/:id/buchhaltungsschluessel`). */
export function fondsMeldewesenRouten(db: Db) {
  return new Hono()
    .get("/:id/meldedefinitionen", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        const alle = await tx.select().from(meldeDefinition).orderBy(asc(meldeDefinition.schluessel), desc(meldeDefinition.version));
        const aktiv = await tx.select({ a: meldeAktivierung, schluessel: foerderprogramm.schluessel, bezeichnung: foerderprogramm.bezeichnung }).from(meldeAktivierung).leftJoin(foerderprogramm, eq(foerderprogramm.id, meldeAktivierung.foerderprogrammId)).where(eq(meldeAktivierung.fondsId, id));
        const heuteTag = heute();
        const nachSchluessel = new Map<string, MeldeDefinition[]>();
        for (const d of alle) nachSchluessel.set(d.schluessel, [...(nachSchluessel.get(d.schluessel) ?? []), d]);
        return [...nachSchluessel.entries()].map(([schluessel, versionen]) => {
          const aktuell = versionen.find((d) => d.gueltigAb <= heuteTag && (d.gueltigBis === null || d.gueltigBis >= heuteTag)) ?? versionen[0]!;
          const a = aktiv.find((x) => x.a.schluessel === schluessel);
          return { ...definitionKopf(aktuell), aktiviert: a !== undefined, foerderprogramm: a?.schluessel ? { schluessel: a.schluessel, bezeichnung: a.bezeichnung! } : null };
        });
      });
      return c.json({ daten }, 200);
    })
    /** Aktiviert eine Definition für den Fonds (optional mit einem Förderprogramm als Filter aller Läufe) oder nimmt die Aktivierung zurück. */
    .put("/:id/meldedefinitionen/:schluessel", pruefe("param", z.object({ id: z.uuid(), schluessel: bezeichner })), pruefe("json", aktivierungEingabe), async (c) => {
      const { id, schluessel } = c.req.valid("param");
      const e = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        const [d] = await tx.select({ id: meldeDefinition.id }).from(meldeDefinition).where(eq(meldeDefinition.schluessel, schluessel)).limit(1);
        if (!d) throw new Fachfehler(404, "MELDEDEFINITION_NICHT_GEFUNDEN", "Meldedefinition nicht gefunden.", { schluessel });
        const [vorher] = await tx.select().from(meldeAktivierung).where(and(eq(meldeAktivierung.fondsId, id), eq(meldeAktivierung.schluessel, schluessel)));
        if (!e.aktiv) {
          if (vorher) {
            await tx.delete(meldeAktivierung).where(and(eq(meldeAktivierung.fondsId, id), eq(meldeAktivierung.schluessel, schluessel)));
            await protokoll("deaktivieren", "melde_aktivierung", id, vorher, { fondsId: id, schluessel, aktiv: false });
          }
          return { aktiviert: false, foerderprogramm: null };
        }
        const programm = e.foerderprogramm ? await ladeProgramm(tx, e.foerderprogramm) : null;
        const werte = { fondsId: id, schluessel, foerderprogrammId: programm?.id ?? null, aktiviertVon: protokoll.akteur, aktiviertAm: new Date() };
        const [nachher] = vorher
          ? await tx.update(meldeAktivierung).set({ foerderprogrammId: werte.foerderprogrammId, aktiviertVon: werte.aktiviertVon, aktiviertAm: werte.aktiviertAm }).where(and(eq(meldeAktivierung.fondsId, id), eq(meldeAktivierung.schluessel, schluessel))).returning()
          : await tx.insert(meldeAktivierung).values(werte).returning();
        await protokoll(vorher ? "aendern" : "aktivieren", "melde_aktivierung", id, vorher ?? null, { ...nachher, fondsId: id });
        return { aktiviert: true, foerderprogramm: programm ? { schluessel: programm.schluessel, bezeichnung: programm.bezeichnung } : null };
      });
      return c.json(ergebnis, 200);
    })
    /** Förder- und Buchhaltungsschlüssel aller Beteiligungen des Fonds (Lesen; Ändern unter `PUT /beteiligungen/:id/buchhaltungsschluessel`) mit Sitzland und Region der Unternehmen. */
    .get("/:id/melde-zuordnungen", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        const bs = await tx.select({ b: beteiligung, o: organisation }).from(beteiligung).innerJoin(organisation, eq(organisation.id, beteiligung.organisationId)).where(eq(beteiligung.fondsId, id)).orderBy(asc(organisation.name), asc(beteiligung.id));
        const z = await ladeZuordnungen(tx, bs.map((x) => x.b.id), [...new Set(bs.map((x) => x.o.id))]);
        return bs.map(({ b, o }) => ({
          beteiligungId: b.id,
          organisation: { id: o.id, name: o.name, sektor: o.sektor, ort: o.ort },
          instrument: b.instrument,
          status: b.status,
          foerderprogramm: z.beteiligung.get(b.id)?.programm ?? null,
          projektnummer: z.beteiligung.get(b.id)?.projektnummer ?? null,
          vertragsnummer: z.beteiligung.get(b.id)?.vertragsnummer ?? null,
          partnernummer: z.beteiligung.get(b.id)?.partnernummer ?? null,
          buchungskreis: z.beteiligung.get(b.id)?.buchungskreis ?? null,
          sitzland: z.organisation.get(o.id)?.sitzland ?? null,
          region: z.organisation.get(o.id)?.region ?? null,
        }));
      });
      return c.json({ daten }, 200);
    });
}

/** Sitzland und Region einer Organisation lesen und setzen (die Bearbeitung der Organisation zeigt sie neben dem NACE-Abschnitt). */
export function organisationMeldedatenRouten(db: Db) {
  return new Hono()
    .get("/:id/meldedaten", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const ergebnis = await lese(db, async (tx) => {
        const [o] = await tx.select({ id: organisation.id }).from(organisation).where(eq(organisation.id, id));
        if (!o) throw new Fachfehler(404, "ORGANISATION_NICHT_GEFUNDEN", "Organisation nicht gefunden.");
        const [m] = await tx.select().from(organisationMeldedaten).where(eq(organisationMeldedaten.organisationId, id));
        return { organisationId: id, sitzland: m?.sitzland ?? null, region: m?.region ?? null };
      });
      return c.json(ergebnis, 200);
    })
    .put("/:id/meldedaten", pruefe("param", idParam), pruefe("json", meldedatenEingabe), async (c) => {
    const { id } = c.req.valid("param");
    const e = c.req.valid("json");
    const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
      const [o] = await tx.select({ id: organisation.id }).from(organisation).where(eq(organisation.id, id));
      if (!o) throw new Fachfehler(404, "ORGANISATION_NICHT_GEFUNDEN", "Organisation nicht gefunden.");
      const [vorher] = await tx.select().from(organisationMeldedaten).where(eq(organisationMeldedaten.organisationId, id));
      const werte = { sitzland: e.sitzland, region: e.region ?? null, geaendertVon: protokoll.akteur, geaendertAm: new Date() };
      const [nachher] = vorher
        ? await tx.update(organisationMeldedaten).set(werte).where(eq(organisationMeldedaten.organisationId, id)).returning()
        : await tx.insert(organisationMeldedaten).values({ organisationId: id, ...werte }).returning();
      await protokoll(vorher ? "aendern" : "anlegen", "organisation_meldedaten", id, vorher ?? null, nachher);
      return { organisationId: id, sitzland: nachher!.sitzland, region: nachher!.region };
    });
    return c.json(ergebnis, 200);
  });
}

