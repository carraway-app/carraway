import { and, asc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  beleg,
  belegArt,
  belegArtEigen,
  belegVorlage,
  beteiligung,
  beteiligungBuchhaltung,
  buchungsquelle,
  buchungsregel,
  fondsBuchhaltung,
  foerderprogramm,
  fondsMittelart,
  gliederungPosition,
  gliederungSicht,
  kontenregel,
  meldeMittelart,
  organisationMeldedaten,
  saldo,
  saldenlauf,
  sachkonto,
  sachkontoArt,
  type Db,
} from "@carraway/db";
import { bereicheUeberschneiden, Decimal, SICHTEN, STANDARD_GLIEDERUNG, zeitraeumeUeberschneiden } from "@carraway/rechenkern";
import { enumWerte, insDeutsche, insEnglische, istBelegfeld } from "../buchhaltung/abbildung";
import { buchhaltungsFehler } from "../buchhaltung/fehler";
import { BELEG_ARTEN, KATALOG, ladeEigeneArt, standardVorlage, type VorlagenFeld } from "../buchhaltung/belegfelder";
import { Fachfehler } from "../fehler";
import { pruefe } from "../pruefung";
import { idParam, ladeFonds, optionalerText, schreibe, textEingabe } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";

/**
 * Stammdaten der Buchhaltung je Fonds (Etappe 14): Konfiguration, Mittelarten, Kontenrahmen, Gliederung, Kontenregeln,
 * Belegvorlagen, Kontenzuordnung des Buchungsexports und die Schlüssel zur Buchhaltung je Beteiligung.
 * Lesen = betrachter, Ändern = verwalter des Fonds (Schlüssel der Beteiligung: bearbeiter).
 */

const kontoNummer = z.string().regex(/^[0-9]{1,9}$/, "1 to 9 digits expected");
const datum = z.iso.date();
const quote = z.string().regex(/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/, "Share from 0 to 1 with at most six decimal places");
const schluesselText = z.string().regex(/^[a-z][a-z0-9_.]{0,59}$/, "Lowercase letters, digits, dots and underscores");

const buchhaltungEingabe = z.object({
  advisorNumber: z.number().int().min(1001).max(9_999_999).nullable(),
  clientNumber: z.number().int().min(1).max(99_999).nullable(),
  fiscalYearStart: z.number().int().min(1).max(12),
  accountNumberLength: z.number().int().min(4).max(8),
  voucherPrefix: z.string().regex(/^[A-Za-z0-9-]{0,12}$/),
});
const mittelartenEingabe = z.object({
  validFrom: datum,
  fundingSources: z.array(z.object({ key: schluesselText, labelDe: textEingabe(100), labelEn: textEingabe(100), ratio: quote, reportingType: z.enum(enumWerte(meldeMittelart.enumValues)).nullable().optional() })).min(1).max(20),
});
const kontenEingabe = z.object({
  accounts: z.array(z.object({ accountNumber: kontoNummer, label: textEingabe(200), type: z.enum(enumWerte(sachkontoArt.enumValues)), investmentId: z.uuid().nullable().optional() })).min(1).max(1000),
});
const gliederungEingabe = z.object({
  items: z
    .array(z.object({ key: schluesselText, parentKey: schluesselText.nullable(), labelDe: textEingabe(150), labelEn: textEingabe(150), side: z.enum(["debit", "credit"]) }))
    .min(1)
    .max(200),
});
const regelEingabe = z.object({
  view: z.enum(enumWerte(gliederungSicht.enumValues)),
  accountFrom: kontoNummer,
  accountTo: kontoNummer.optional(),
  itemKey: schluesselText,
  validFrom: datum,
  /** Regel, die mit dieser abgelöst wird: sie endet am Tag davor. */
  replaces: z.uuid().optional(),
});
const regelAbfrage = z.object({ view: z.enum(enumWerte(gliederungSicht.enumValues)).optional(), asOf: datum.optional() });
const vorlageEingabe = z.object({
  fields: z
    .array(z.object({ key: z.string().min(1).max(60).refine(istBelegfeld, "Unknown voucher field key"), section: z.enum(["header", "details"]), required: z.boolean(), manual: z.enum(["text", "amount", "date"]).optional(), labelDe: textEingabe(100).optional(), labelEn: textEingabe(100).optional() }))
    .min(1)
    .max(60),
  headerDe: z.string().max(2000),
  headerEn: z.string().max(2000),
  footerDe: z.string().max(2000),
  footerEn: z.string().max(2000),
});
const buchungsregelEingabe = z.object({
  account: kontoNummer,
  contraAccount: kontoNummer,
  direction: z.enum(["debit", "credit"]),
  taxKey: z.string().regex(/^[0-9]{1,3}$/).nullable(),
  postingText: textEingabe(60),
});
const schluesselEingabe = z.strictObject({
  projectNumber: optionalerText(50),
  contractNumber: optionalerText(50),
  partnerNumber: optionalerText(50),
  companyCode: optionalerText(50),
  /** Schlüssel eines Förderprogramms (`/foerderprogramme`); leer = keines. */
  fundingProgram: z.string().regex(/^[a-z][a-z0-9_]{1,59}$/, "Lowercase letters, digits and underscores").nullable().optional(),
});

const belegartAnlegen = z.object({ baseType: z.enum(enumWerte(belegArt.enumValues)), labelDe: textEingabe(100), labelEn: textEingabe(100) });
const belegartAendern = z.object({ labelDe: textEingabe(100), labelEn: textEingabe(100), active: z.boolean() });

const felderFehler = (feld: string, code: string, meldung: string) => new Fachfehler(400, "invalid_input", "The input is invalid.", { felder: [{ feld, code, meldung }] });

/** Der deutsche Name einer eigenen Belegart ist je Fonds eindeutig (ohne Beachtung der Groß- und Kleinschreibung). */
async function verlangeFreienNamen(tx: Tx, fondsId: string, name: string, ausser: string | null): Promise<void> {
  const vorhandene = await tx.select({ id: belegArtEigen.id }).from(belegArtEigen).where(and(eq(belegArtEigen.fondsId, fondsId), sql`lower(${belegArtEigen.bezeichnungDe}) = lower(${name})`));
  if (vorhandene.some((v) => v.id !== ausser)) throw felderFehler("bezeichnungDe", "doppelt", "A voucher type with this name already exists");
}

/** Tag vor einem Datum (UTC, ohne Zeitzonenfehler). */
export function tagDavor(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Standardgliederung in den Fonds schreiben; vorhandene Positionen bleiben unverändert. Gibt die Zahl neuer Positionen zurück. */
export async function schreibeStandardgliederung(tx: Tx, fondsId: string, sichten: readonly (typeof SICHTEN)[number][] = SICHTEN): Promise<number> {
  let neu = 0;
  for (const sicht of sichten) {
    const vorhanden = new Set((await tx.select({ s: gliederungPosition.schluessel }).from(gliederungPosition).where(and(eq(gliederungPosition.fondsId, fondsId), eq(gliederungPosition.sicht, sicht)))).map((z) => z.s));
    const zeilen = STANDARD_GLIEDERUNG[sicht].filter((p) => !vorhanden.has(p.schluessel)).map((p) => ({ fondsId, sicht, ...p }));
    if (zeilen.length) await tx.insert(gliederungPosition).values(zeilen);
    neu += zeilen.length;
  }
  return neu;
}

async function ladeKonfiguration(tx: Tx, fondsId: string) {
  const [z] = await tx.select().from(fondsBuchhaltung).where(eq(fondsBuchhaltung.fondsId, fondsId));
  return z ?? null;
}

export function fondsBuchhaltungRouten(db: Db) {
  return new Hono().onError(buchhaltungsFehler)
    // Konfiguration -------------------------------------------------------------------------------------------------
    .get("/:id/accounting", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        const z = await ladeKonfiguration(tx, id);
        return z ?? { fondsId: id, beraternummer: null, mandantennummer: null, wirtschaftsjahrBeginn: 1, sachkontenlaenge: 4, belegpraefix: "B", geaendertVon: null, geaendertAm: null };
      });
      return c.json(insEnglische({ ...daten, konfiguriert: daten.geaendertVon !== null }), 200);
    })
    .put("/:id/accounting", pruefe("param", idParam), pruefe("json", buchhaltungEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const e = insDeutsche(c.req.valid("json"));
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        const vorher = await ladeKonfiguration(tx, id);
        const werte = { ...e, geaendertVon: protokoll.akteur, geaendertAm: new Date() };
        const [neu] = vorher ? await tx.update(fondsBuchhaltung).set(werte).where(eq(fondsBuchhaltung.fondsId, id)).returning() : await tx.insert(fondsBuchhaltung).values({ fondsId: id, ...werte }).returning();
        await protokoll(vorher ? "aendern" : "anlegen", "fonds_buchhaltung", id, vorher, neu);
        return neu!;
      });
      return c.json(insEnglische({ ...nachher, konfiguriert: true }), 200);
    })

    // Mittelarten ---------------------------------------------------------------------------------------------------
    .get("/:id/funding-sources", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        return tx.select().from(fondsMittelart).where(eq(fondsMittelart.fondsId, id)).orderBy(asc(fondsMittelart.gueltigAb), asc(fondsMittelart.schluessel));
      });
      return c.json(insEnglische({ daten }), 200);
    })
    /** Setzt die Mittelarten ab einem Datum; die Quoten ergeben 1, der bisher offene Satz endet am Tag davor. */
    .put("/:id/funding-sources", pruefe("param", idParam), pruefe("json", mittelartenEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const e = insDeutsche(c.req.valid("json"));
      const daten = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        const summe = e.mittelarten.reduce((s, m) => s.plus(m.quote), new Decimal(0));
        if (!summe.equals(1)) throw new Fachfehler(409, "funding_sources_sum_invalid", "The shares do not add up to 1.", { summe: summe.toString() });
        if (new Set(e.mittelarten.map((m) => m.schluessel)).size !== e.mittelarten.length) throw felderFehler("mittelarten", "doppelt", "A key appears more than once");
        const spaeter = await tx.select({ ab: fondsMittelart.gueltigAb }).from(fondsMittelart).where(and(eq(fondsMittelart.fondsId, id), sql`${fondsMittelart.gueltigAb} > ${e.gueltigAb}`));
        if (spaeter.length) throw new Fachfehler(409, "funding_sources_period_invalid", "Funding sources from a later date already exist.", { gueltigAb: e.gueltigAb });
        await tx.delete(fondsMittelart).where(and(eq(fondsMittelart.fondsId, id), eq(fondsMittelart.gueltigAb, e.gueltigAb)));
        await tx.update(fondsMittelart).set({ gueltigBis: tagDavor(e.gueltigAb) }).where(and(eq(fondsMittelart.fondsId, id), isNull(fondsMittelart.gueltigBis)));
        const neu = await tx.insert(fondsMittelart).values(e.mittelarten.map((m) => ({ fondsId: id, ...m, meldeArt: m.meldeArt ?? null, gueltigAb: e.gueltigAb }))).returning();
        await protokoll("aendern", "fonds_mittelart", id, null, { fondsId: id, gueltigAb: e.gueltigAb, mittelarten: e.mittelarten });
        return neu;
      });
      return c.json(insEnglische({ daten }), 200);
    })

    // Konten --------------------------------------------------------------------------------------------------------
    .get("/:id/accounts", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        return tx.select().from(sachkonto).where(eq(sachkonto.fondsId, id)).orderBy(asc(sachkonto.nummer));
      });
      return c.json(insEnglische({ daten }), 200);
    })
    /** Legt Konten an oder aktualisiert sie (Schlüssel ist die Kontonummer). */
    .put("/:id/accounts", pruefe("param", idParam), pruefe("json", kontenEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const e = insDeutsche(c.req.valid("json"));
      const daten = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        if (new Set(e.konten.map((k) => k.nummer)).size !== e.konten.length) throw felderFehler("konten", "doppelt", "An account number appears more than once");
        const bIds = [...new Set(e.konten.map((k) => k.beteiligungId).filter((b): b is string => !!b))];
        if (bIds.length) {
          const eigene = new Set((await tx.select({ id: beteiligung.id }).from(beteiligung).where(and(eq(beteiligung.fondsId, id), inArray(beteiligung.id, bIds)))).map((b) => b.id));
          const fremd = bIds.filter((b) => !eigene.has(b));
          if (fremd.length) throw new Fachfehler(409, "account_investment_foreign", "The investment does not belong to this fund.", { beteiligungIds: fremd });
        }
        const vorhandene = new Map((await tx.select().from(sachkonto).where(eq(sachkonto.fondsId, id))).map((k) => [k.nummer, k]));
        const ergebnis = [];
        for (const k of e.konten) {
          const werte = { bezeichnung: k.bezeichnung, art: k.art, beteiligungId: k.beteiligungId ?? null };
          const alt = vorhandene.get(k.nummer);
          const [neu] = alt ? await tx.update(sachkonto).set(werte).where(eq(sachkonto.id, alt.id)).returning() : await tx.insert(sachkonto).values({ fondsId: id, nummer: k.nummer, ...werte }).returning();
          await protokoll(alt ? "aendern" : "anlegen", "sachkonto", neu!.id, alt ?? null, neu);
          ergebnis.push(neu!);
        }
        return ergebnis;
      });
      return c.json(insEnglische({ daten }), 200);
    })
    .delete("/:id/accounts/:accountNumber", pruefe("param", z.object({ id: z.uuid(), accountNumber: kontoNummer })), async (c) => {
      const { id, nummer } = insDeutsche(c.req.valid("param"));
      await schreibe(db, c, async (tx, protokoll) => {
        const [k] = await tx.select().from(sachkonto).where(and(eq(sachkonto.fondsId, id), eq(sachkonto.nummer, nummer)));
        if (!k) throw new Fachfehler(404, "account_not_found", "Account not found.");
        const [verwendet] = await tx.select({ id: saldo.id }).from(saldo).innerJoin(saldenlauf, eq(saldenlauf.id, saldo.laufId)).where(and(eq(saldenlauf.fondsId, id), eq(saldo.kontoNummer, nummer))).limit(1);
        if (verwendet) throw new Fachfehler(409, "account_in_use", "The account appears in a trial balance.", { nummer });
        await tx.delete(sachkonto).where(eq(sachkonto.id, k.id));
        await protokoll("loeschen", "sachkonto", k.id, k, null);
      });
      return c.body(null, 204);
    })

    // Gliederung ----------------------------------------------------------------------------------------------------
    .get("/:id/layout", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        return tx.select().from(gliederungPosition).where(eq(gliederungPosition.fondsId, id)).orderBy(asc(gliederungPosition.sicht), asc(gliederungPosition.reihenfolge), asc(gliederungPosition.schluessel));
      });
      return c.json(insEnglische({ daten }), 200);
    })
    /** Legt die Standardgliederung an (fehlende Positionen je Sicht); Vorhandenes bleibt unberührt. */
    .post("/:id/layout/standard", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        const n = await schreibeStandardgliederung(tx, id);
        await protokoll("anlegen", "gliederung_position", id, null, { fondsId: id, standard: true, neuePositionen: n });
        return n;
      });
      return c.json(insEnglische({ neuePositionen: neu }), 200);
    })
    /** Ersetzt die Positionen einer Sicht; Positionen, auf die eine Regel zeigt, lassen sich nicht entfernen. */
    .put("/:id/layout/:view", pruefe("param", z.object({ id: z.uuid(), view: z.enum(enumWerte(gliederungSicht.enumValues)) })), pruefe("json", gliederungEingabe), async (c) => {
      const { id, sicht } = insDeutsche(c.req.valid("param"));
      const e = insDeutsche(c.req.valid("json"));
      const daten = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        const schluessel = e.positionen.map((p) => p.schluessel);
        if (new Set(schluessel).size !== schluessel.length) throw new Fachfehler(409, "layout_invalid", "A key appears more than once.", { grund: "doppelt" });
        const nachSchluessel = new Map(e.positionen.map((p) => [p.schluessel, p]));
        for (const p of e.positionen) {
          if (p.elternSchluessel !== null && !nachSchluessel.has(p.elternSchluessel)) throw new Fachfehler(409, "layout_invalid", "The parent item does not exist.", { grund: "eltern_unbekannt", schluessel: p.schluessel });
          const gesehen = new Set<string>();
          for (let k: string | null = p.schluessel; k !== null; k = nachSchluessel.get(k)?.elternSchluessel ?? null) {
            if (gesehen.has(k)) throw new Fachfehler(409, "layout_invalid", "The layout contains a cycle.", { grund: "zyklus", schluessel: p.schluessel });
            gesehen.add(k);
          }
        }
        const referenziert = await tx.selectDistinct({ s: kontenregel.positionSchluessel }).from(kontenregel).where(and(eq(kontenregel.fondsId, id), eq(kontenregel.sicht, sicht), notInArray(kontenregel.positionSchluessel, schluessel)));
        if (referenziert.length) throw new Fachfehler(409, "layout_item_in_use", "An account rule refers to an item that would be removed.", { positionen: referenziert.map((r) => r.s) });
        const vorher = await tx.select().from(gliederungPosition).where(and(eq(gliederungPosition.fondsId, id), eq(gliederungPosition.sicht, sicht)));
        await tx.delete(gliederungPosition).where(and(eq(gliederungPosition.fondsId, id), eq(gliederungPosition.sicht, sicht)));
        const neu = await tx.insert(gliederungPosition).values(e.positionen.map((p, i) => ({ fondsId: id, sicht, ...p, reihenfolge: (i + 1) * 10 }))).returning();
        await protokoll("aendern", "gliederung_position", id, { fondsId: id, sicht, positionen: vorher.length }, { fondsId: id, sicht, positionen: neu.length });
        return neu;
      });
      return c.json(insEnglische({ daten }), 200);
    })

    // Kontenregeln --------------------------------------------------------------------------------------------------
    .get("/:id/account-rules", pruefe("param", idParam), pruefe("query", regelAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { sicht, stichtag } = insDeutsche(c.req.valid("query"));
      const daten = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        return tx
          .select()
          .from(kontenregel)
          .where(
            and(
              eq(kontenregel.fondsId, id),
              sicht ? eq(kontenregel.sicht, sicht) : undefined,
              stichtag ? and(sql`${kontenregel.gueltigAb} <= ${stichtag}`, or(isNull(kontenregel.gueltigBis), sql`${kontenregel.gueltigBis} >= ${stichtag}`)) : undefined,
            ),
          )
          .orderBy(asc(kontenregel.sicht), asc(kontenregel.kontoVon), asc(kontenregel.gueltigAb));
      });
      return c.json(insEnglische({ daten }), 200);
    })
    /** Neue Regel; mit `ersetzt` endet die alte am Tag vor `gueltigAb` (Versionierung, nichts wird gelöscht). */
    .post("/:id/account-rules", pruefe("param", idParam), pruefe("json", regelEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const e = insDeutsche(c.req.valid("json"));
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        const kontoBis = e.kontoBis ?? e.kontoVon;
        if (kontoBis.length !== e.kontoVon.length || kontoBis < e.kontoVon) throw felderFehler("kontoBis", "bereich_ungueltig", "Account numbers must have equal length and the end must not precede the start");
        const positionen = await tx.select().from(gliederungPosition).where(and(eq(gliederungPosition.fondsId, id), eq(gliederungPosition.sicht, e.sicht)));
        if (!positionen.some((p) => p.schluessel === e.positionSchluessel)) throw new Fachfehler(409, "account_rule_item_unknown", "The item does not exist in this view.", { positionSchluessel: e.positionSchluessel });
        if (positionen.some((p) => p.elternSchluessel === e.positionSchluessel)) throw new Fachfehler(409, "account_rule_item_not_leaf", "Accounts can only be assigned to an item without sub-items.", { positionSchluessel: e.positionSchluessel });
        const regeln = await tx.select().from(kontenregel).where(and(eq(kontenregel.fondsId, id), eq(kontenregel.sicht, e.sicht))).for("update");
        let ersetzt;
        if (e.ersetzt) {
          ersetzt = regeln.find((r) => r.id === e.ersetzt);
          if (!ersetzt) throw new Fachfehler(404, "account_rule_not_found", "The rule to be replaced does not exist.");
          const ende = tagDavor(e.gueltigAb);
          if (ende < ersetzt.gueltigAb || (ersetzt.gueltigBis !== null && ersetzt.gueltigBis < ende)) throw new Fachfehler(409, "account_rule_period_invalid", "The new rule must take effect after the start of the replaced rule and before its end.", { ersetzt: ersetzt.id });
        }
        const neueRegel = { kontoVon: e.kontoVon, kontoBis, gueltigAb: e.gueltigAb, gueltigBis: null as string | null };
        for (const r of regeln) {
          if (r.id === e.ersetzt) continue;
          if (bereicheUeberschneiden(r, neueRegel) && zeitraeumeUeberschneiden(r, neueRegel)) throw new Fachfehler(409, "account_rule_overlaps", "Another rule applies to the same accounts in the same period.", { mitRegelId: r.id });
        }
        if (ersetzt) {
          const [n] = await tx.update(kontenregel).set({ gueltigBis: tagDavor(e.gueltigAb) }).where(eq(kontenregel.id, ersetzt.id)).returning();
          await protokoll("beenden", "kontenregel", ersetzt.id, ersetzt, n);
        }
        const [angelegt] = await tx.insert(kontenregel).values({ fondsId: id, sicht: e.sicht, kontoVon: e.kontoVon, kontoBis, positionSchluessel: e.positionSchluessel, gueltigAb: e.gueltigAb, erstelltVon: protokoll.akteur }).returning();
        await protokoll("anlegen", "kontenregel", angelegt!.id, null, angelegt);
        return angelegt!;
      });
      return c.json(insEnglische(neu), 201);
    })

    // Belegvorlagen und eigene Belegarten ----------------------------------------------------------------------------
    /** Die festen Belegarten, danach die eigenen des Fonds (`eigeneArtId` gesetzt, `art` ist deren Basis-Art). */
    .get("/:id/voucher-templates", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        const vorlagen = await tx.select().from(belegVorlage).where(eq(belegVorlage.fondsId, id));
        const standard = new Map(vorlagen.filter((v) => v.eigeneArtId === null).map((v) => [v.art, v]));
        const eigeneVorlagen = new Map(vorlagen.filter((v) => v.eigeneArtId !== null).map((v) => [v.eigeneArtId!, v]));
        const eigene = await tx.select().from(belegArtEigen).where(eq(belegArtEigen.fondsId, id)).orderBy(asc(belegArtEigen.bezeichnungDe), asc(belegArtEigen.id));
        const zeile = (art: (typeof belegArt.enumValues)[number], z: typeof belegVorlage.$inferSelect | undefined, zusatz: { eigeneArtId: string | null; bezeichnungDe: string | null; bezeichnungEn: string | null; aktiv: boolean }) => {
          const s = standardVorlage(art);
          return {
            art,
            standard: !z,
            felder: (z?.felder as VorlagenFeld[] | undefined) ?? s.felder,
            kopfDe: z?.kopfDe ?? s.kopfDe,
            kopfEn: z?.kopfEn ?? s.kopfEn,
            fussDe: z?.fussDe ?? s.fussDe,
            fussEn: z?.fussEn ?? s.fussEn,
            katalog: KATALOG[art],
            ...zusatz,
          };
        };
        return [
          ...BELEG_ARTEN.map((art) => zeile(art, standard.get(art), { eigeneArtId: null, bezeichnungDe: null, bezeichnungEn: null, aktiv: true })),
          ...eigene.map((e) => zeile(e.basisArt, eigeneVorlagen.get(e.id), { eigeneArtId: e.id, bezeichnungDe: e.bezeichnungDe as string | null, bezeichnungEn: e.bezeichnungEn as string | null, aktiv: e.aktiv })),
        ];
      });
      return c.json(insEnglische({ daten }), 200);
    })
    /** Vorlage einer festen Art (`:art` = Name) oder einer eigenen Belegart (`:art` = ihre Id). */
    .put("/:id/voucher-templates/:type", pruefe("param", z.object({ id: z.uuid(), type: z.union([z.enum(enumWerte(BELEG_ARTEN)), z.uuid()]) })), pruefe("json", vorlageEingabe), async (c) => {
      const { id, art: artParam } = insDeutsche(c.req.valid("param"));
      const e = insDeutsche(c.req.valid("json"));
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        const eigeneArt = (belegArt.enumValues as readonly string[]).includes(artParam) ? null : await ladeEigeneArt(tx, id, artParam);
        if (!(belegArt.enumValues as readonly string[]).includes(artParam) && !eigeneArt) throw new Fachfehler(404, "voucher_type_not_found", "The voucher type does not exist in this fund.");
        const art = eigeneArt ? eigeneArt.basisArt : (artParam as (typeof belegArt.enumValues)[number]);
        const katalog = new Set(KATALOG[art].map((k) => k.schluessel));
        const fehlerhaft = e.felder.filter((fe) => fe.manuell
          ? !eigeneArt || !/^eigen_[a-z0-9_-]+$/.test(fe.schluessel) || !fe.bezeichnungDe || !fe.bezeichnungEn
          : !katalog.has(fe.schluessel));
        if (fehlerhaft.length) throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder: fehlerhaft.map((fe) => ({ feld: `felder.${fe.schluessel}`, code: "unbekannt", meldung: "The field does not exist for this voucher type" })) });
        if (new Set(e.felder.map((fe) => fe.schluessel)).size !== e.felder.length) throw felderFehler("felder", "doppelt", "A field appears more than once");
        const [vorher] = await tx.select().from(belegVorlage).where(and(eq(belegVorlage.fondsId, id), eigeneArt ? eq(belegVorlage.eigeneArtId, eigeneArt.id) : and(eq(belegVorlage.art, art), isNull(belegVorlage.eigeneArtId))));
        const werte = { felder: e.felder, kopfDe: e.kopfDe, kopfEn: e.kopfEn, fussDe: e.fussDe, fussEn: e.fussEn, geaendertVon: protokoll.akteur, geaendertAm: new Date() };
        const [neu] = vorher ? await tx.update(belegVorlage).set(werte).where(eq(belegVorlage.id, vorher.id)).returning() : await tx.insert(belegVorlage).values({ fondsId: id, art, eigeneArtId: eigeneArt?.id ?? null, ...werte }).returning();
        await protokoll(vorher ? "aendern" : "anlegen", "beleg_vorlage", neu!.id, vorher ?? null, neu);
        return { vorlage: neu!, art, eigeneArt };
      });
      const v = nachher.vorlage;
      return c.json(insEnglische({ art: nachher.art, standard: false, felder: v.felder as VorlagenFeld[], kopfDe: v.kopfDe, kopfEn: v.kopfEn, fussDe: v.fussDe, fussEn: v.fussEn, katalog: KATALOG[nachher.art], eigeneArtId: nachher.eigeneArt?.id ?? null, bezeichnungDe: nachher.eigeneArt?.bezeichnungDe ?? null, bezeichnungEn: nachher.eigeneArt?.bezeichnungEn ?? null, aktiv: nachher.eigeneArt?.aktiv ?? true }), 200);
    })
    /** Legt eine eigene Belegart an; ohne eigene Vorlage gilt die Standardvorlage der Basis-Art. */
    .post("/:id/voucher-types", pruefe("param", idParam), pruefe("json", belegartAnlegen), async (c) => {
      const { id } = c.req.valid("param");
      const e = insDeutsche(c.req.valid("json"));
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        await verlangeFreienNamen(tx, id, e.bezeichnungDe, null);
        const [angelegt] = await tx.insert(belegArtEigen).values({ fondsId: id, basisArt: e.basisArt, bezeichnungDe: e.bezeichnungDe, bezeichnungEn: e.bezeichnungEn, erstelltVon: protokoll.akteur }).returning();
        await protokoll("anlegen", "beleg_art_eigen", angelegt!.id, null, angelegt);
        return angelegt!;
      });
      return c.json(insEnglische(neu), 201);
    })
    /** Name und Stilllegung ändern; die Basis-Art bleibt, weil Belege und Vorlage auf ihr beruhen. */
    .put("/:id/voucher-types/:typeId", pruefe("param", z.object({ id: z.uuid(), typeId: z.uuid() })), pruefe("json", belegartAendern), async (c) => {
      const { id, artId } = insDeutsche(c.req.valid("param"));
      const e = insDeutsche(c.req.valid("json"));
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeEigeneArt(tx, id, artId);
        if (!vorher) throw new Fachfehler(404, "voucher_type_not_found", "The voucher type does not exist in this fund.");
        await verlangeFreienNamen(tx, id, e.bezeichnungDe, artId);
        const [neu] = await tx.update(belegArtEigen).set({ bezeichnungDe: e.bezeichnungDe, bezeichnungEn: e.bezeichnungEn, aktiv: e.aktiv }).where(eq(belegArtEigen.id, artId)).returning();
        await protokoll("aendern", "beleg_art_eigen", artId, vorher, neu);
        return neu!;
      });
      return c.json(insEnglische(nachher), 200);
    })
    /** Löscht eine eigene Belegart samt Vorlage, solange kein Beleg sie nutzt; sonst 409 (dann stilllegen). */
    .delete("/:id/voucher-types/:typeId", pruefe("param", z.object({ id: z.uuid(), typeId: z.uuid() })), async (c) => {
      const { id, artId } = insDeutsche(c.req.valid("param"));
      await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeEigeneArt(tx, id, artId);
        if (!vorher) throw new Fachfehler(404, "voucher_type_not_found", "The voucher type does not exist in this fund.");
        const [genutzt] = await tx.select({ id: beleg.id }).from(beleg).where(eq(beleg.eigeneArtId, artId)).limit(1);
        if (genutzt) throw new Fachfehler(409, "voucher_type_in_use", "Vouchers of this type exist; it can only be deactivated.", { belegId: genutzt.id });
        const vorlagen = await tx.delete(belegVorlage).where(eq(belegVorlage.eigeneArtId, artId)).returning();
        for (const v of vorlagen) await protokoll("loeschen", "beleg_vorlage", v.id, v, null);
        await tx.delete(belegArtEigen).where(eq(belegArtEigen.id, artId));
        await protokoll("loeschen", "beleg_art_eigen", artId, vorher, null);
      });
      return c.body(null, 204);
    })

    // Kontenzuordnung des Buchungsexports -----------------------------------------------------------------------------
    .get("/:id/posting-rules", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        return tx.select().from(buchungsregel).where(eq(buchungsregel.fondsId, id)).orderBy(asc(buchungsregel.quelle));
      });
      return c.json(insEnglische({ daten }), 200);
    })
    .put("/:id/posting-rules/:source", pruefe("param", z.object({ id: z.uuid(), source: z.enum(enumWerte(buchungsquelle.enumValues)) })), pruefe("json", buchungsregelEingabe), async (c) => {
      const { id, quelle } = insDeutsche(c.req.valid("param"));
      const e = insDeutsche(c.req.valid("json"));
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        const [vorher] = await tx.select().from(buchungsregel).where(and(eq(buchungsregel.fondsId, id), eq(buchungsregel.quelle, quelle)));
        const werte = { ...e, geaendertVon: protokoll.akteur, geaendertAm: new Date() };
        const [neu] = vorher ? await tx.update(buchungsregel).set(werte).where(eq(buchungsregel.id, vorher.id)).returning() : await tx.insert(buchungsregel).values({ fondsId: id, quelle, ...werte }).returning();
        await protokoll(vorher ? "aendern" : "anlegen", "buchungsregel", neu!.id, vorher ?? null, neu);
        return neu!;
      });
      return c.json(insEnglische(nachher), 200);
    });
}

export function kontenregelRouten(db: Db) {
  return new Hono().onError(buchhaltungsFehler).post("/:id/end", pruefe("param", idParam), pruefe("json", z.object({ validTo: datum })), async (c) => {
    const { id } = c.req.valid("param");
    const { gueltigBis } = insDeutsche(c.req.valid("json"));
    const nachher = await schreibe(db, c, async (tx, protokoll) => {
      const [r] = await tx.select().from(kontenregel).where(eq(kontenregel.id, id)).for("update");
      if (!r) throw new Fachfehler(404, "account_rule_not_found", "Account rule not found.");
      if (gueltigBis < r.gueltigAb) throw new Fachfehler(409, "account_rule_period_invalid", "The end is before the start of the rule.", { gueltigAb: r.gueltigAb });
      const [n] = await tx.update(kontenregel).set({ gueltigBis }).where(eq(kontenregel.id, id)).returning();
      await protokoll("beenden", "kontenregel", id, r, n);
      return n!;
    });
    return c.json(insEnglische(nachher), 200);
  });
}

/**
 * Förder- und Buchhaltungsschlüssel einer Beteiligung (Projekt-, Vertrags-, Partnernummer, Buchungskreis, Förderprogramm); Mount unter `/investments`.
 * Die einzige Stelle, an der diese Schlüssel stehen: Belege, Buchungsexport und Meldeberichte lesen sie von hier. Das Förderprogramm ist der
 * Schlüssel eines Eintrags unter `/foerderprogramme`.
 */
export function beteiligungBuchhaltungRouten(db: Db) {
  const leer = (beteiligungId: string) => ({ beteiligungId, projektnummer: null, vertragsnummer: null, partnernummer: null, buchungskreis: null, foerderprogramm: null, foerderprogrammBezeichnung: null, geaendertVon: null, geaendertAm: null });
  type Zeile = typeof beteiligungBuchhaltung.$inferSelect;
  const antwort = (z: Zeile, programm: { schluessel: string; bezeichnung: string } | null) => {
    const { foerderprogrammId: _id, ...rest } = z;
    return { ...rest, foerderprogramm: programm?.schluessel ?? null, foerderprogrammBezeichnung: programm?.bezeichnung ?? null };
  };
  const programmVon = async (tx: Tx, programmId: string | null) => {
    if (!programmId) return null;
    const [p] = await tx.select({ schluessel: foerderprogramm.schluessel, bezeichnung: foerderprogramm.bezeichnung }).from(foerderprogramm).where(eq(foerderprogramm.id, programmId));
    return p ?? null;
  };
  return new Hono().onError(buchhaltungsFehler)
    .get("/:id/accounting-keys", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        const [b] = await tx.select({ id: beteiligung.id, organisationId: beteiligung.organisationId }).from(beteiligung).where(eq(beteiligung.id, id));
        if (!b) throw new Fachfehler(404, "investment_not_found", "Investment not found.");
        const [z] = await tx.select().from(beteiligungBuchhaltung).where(eq(beteiligungBuchhaltung.beteiligungId, id));
        // Sitzland und Region gehören zur Organisation (`PUT /organizations/:id/reporting-data`); sie stehen hier mit, damit die Seite alle Schlüssel an einer Stelle zeigt.
        const [m] = await tx.select({ organisationId: organisationMeldedaten.organisationId, sitzland: organisationMeldedaten.sitzland, region: organisationMeldedaten.region }).from(organisationMeldedaten).where(eq(organisationMeldedaten.organisationId, b.organisationId));
        const basis = z ? antwort(z, await programmVon(tx, z.foerderprogrammId)) : leer(id);
        return { ...basis, organisationId: b.organisationId, sitzland: m?.sitzland ?? null, region: m?.region ?? null };
      });
      return c.json(insEnglische(daten), 200);
    })
    .put("/:id/accounting-keys", pruefe("param", idParam), pruefe("json", schluesselEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const e = insDeutsche(c.req.valid("json"));
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const [b] = await tx.select({ id: beteiligung.id, fondsId: beteiligung.fondsId }).from(beteiligung).where(eq(beteiligung.id, id));
        if (!b) throw new Fachfehler(404, "investment_not_found", "Investment not found.");
        let programm: { id: string; schluessel: string; bezeichnung: string } | null = null;
        if (e.foerderprogramm) {
          const [p] = await tx.select({ id: foerderprogramm.id, schluessel: foerderprogramm.schluessel, bezeichnung: foerderprogramm.bezeichnung }).from(foerderprogramm).where(eq(foerderprogramm.schluessel, e.foerderprogramm));
          if (!p) throw new Fachfehler(404, "funding_program_not_found", "Funding program not found.", { schluessel: e.foerderprogramm });
          programm = p;
        }
        const [vorher] = await tx.select().from(beteiligungBuchhaltung).where(eq(beteiligungBuchhaltung.beteiligungId, id));
        const werte = {
          projektnummer: e.projektnummer ?? null,
          vertragsnummer: e.vertragsnummer ?? null,
          partnernummer: e.partnernummer ?? null,
          buchungskreis: e.buchungskreis ?? null,
          foerderprogrammId: programm?.id ?? null,
          geaendertVon: protokoll.akteur,
          geaendertAm: new Date(),
        };
        const [neu] = vorher ? await tx.update(beteiligungBuchhaltung).set(werte).where(eq(beteiligungBuchhaltung.beteiligungId, id)).returning() : await tx.insert(beteiligungBuchhaltung).values({ beteiligungId: id, ...werte }).returning();
        await protokoll(vorher ? "aendern" : "anlegen", "beteiligung_buchhaltung", id, vorher ? { ...vorher, fondsId: b.fondsId } : null, { ...neu, fondsId: b.fondsId });
        return antwort(neu!, programm);
      });
      return c.json(insEnglische(nachher), 200);
    });
}
