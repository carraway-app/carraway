import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { fonds, managerProfil, organisation, zielfondsBeteiligung, zielfondsBewegung, zielfondsMeldung, type Db } from "@carraway/db";
import { Decimal, type ZielfondsKennzahlen } from "@carraway/rechenkern";
import { gruppiereZielfonds, pruefeVerknuepfung } from "../kennzahlen/zielfonds";
import { aktuellerAkteur, sichtbareFonds } from "../anmeldung/akteur";
import { fondsEnumAnApi } from "../fonds-vertrag";
import { Fachfehler } from "../fehler";
import { ladeZielfondsZum, standardStichtag } from "../kennzahlen/fonds";
import { ladeManagerProfil } from "../manager/profil";
import { portfolioSicht } from "../rechte/sichtbarkeit";
import { ladeAllokation, ladePortfolioSummen, ladeVerlauf, type Kennzahl } from "../portfolio/uebersicht";
import { pruefe } from "../pruefung";
import { betragEingabe, heute, idParam, optionalerText, schreibe, textEingabe } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";

/**
 * Manager-Profil (Hauswährung, Summen über alle sichtbaren Fonds), Portfolio-Dashboard und Zielfonds eines Dachfonds. Die Routen sind englisch
 * (docs/api-glossar.md); die Rechnung steht in `portfolio/uebersicht.ts`, `kennzahlen/zielfonds.ts` und im Rechenkern (`dachfonds.ts`, `allokation.ts`).
 */

const code = z.string().regex(/^[A-Z]{3}$/, "Three-letter currency code in uppercase (ISO 4217) expected");
const knowledgeDate = z.iso.datetime({ offset: true });
const stichtagAbfrage = z.object({ asOf: z.iso.date().optional(), knowledgeDate: knowledgeDate.optional() });
const dashboardAbfrage = stichtagAbfrage.extend({ quarters: z.coerce.number().int().min(1).max(20).default(8) });
const profilEingabe = z
  .object({ name: textEingabe(200).nullable().optional(), homeCurrency: code.optional() })
  .strict()
  .refine((w) => w.name !== undefined || w.homeCurrency !== undefined, { message: "At least one field must be given", path: [] });

/** Sichtbare Fonds der Person im Bereich Portfolio (Rechte je Fonds). */
async function sichtbar(tx: Tx, c: Parameters<typeof aktuellerAkteur>[0]): Promise<string[]> {
  const s = sichtbareFonds(aktuellerAkteur(c), "betrachter", "portfolio");
  const { rows } = await tx.execute<{ id: string }>(sql`SELECT id FROM fonds ORDER BY vintage, name`);
  return rows.map((r) => r.id).filter((id) => s === "alle" || s.includes(id));
}

/**
 * Gemeinsamer Stichtag aller Fonds: angegeben, sonst das jüngste Periodenende einer übernommenen Saldenliste der Fonds bis heute (dort gibt es eine NAV),
 * sonst der späteste Standard-Stichtag der Fonds (höchstens heute).
 */
async function gemeinsamerStichtag(tx: Tx, fondsIds: readonly string[], asOf: string | undefined, stand: string | undefined): Promise<string> {
  if (asOf) return asOf;
  if (fondsIds.length) {
    const { rows } = await tx.execute<{ tag: string | null }>(sql`
      SELECT max(zeitraum_bis)::text AS tag FROM saldenlauf
      WHERE fonds_id = ANY(ARRAY[${sql.join(fondsIds.map((i) => sql`${i}`), sql`, `)}]::uuid[]) AND status = 'uebernommen' AND zeitraum_bis <= ${heute()}::date
        AND ${stand === undefined ? sql`ersetzt_am IS NULL` : sql`uebernommen_am <= ${stand}::timestamptz AND (ersetzt_am IS NULL OR ersetzt_am > ${stand}::timestamptz)`}`);
    if (rows[0]?.tag) return rows[0].tag;
  }
  let spaetester: string | null = null;
  for (const id of fondsIds) {
    const s = await standardStichtag(tx, id, stand);
    if (spaetester === null || s > spaetester) spaetester = s;
  }
  return spaetester ?? heute();
}

const kursluecke = ({ von, nach, tag, grund }: { von: string; nach: string; tag: string; grund: string }) =>
  ({ from: von, to: nach, date: tag, reason: fondsEnumAnApi(grund) });

const profilAntwort = (p: Awaited<ReturnType<typeof ladeManagerProfil>>) => ({ name: p.name, homeCurrency: p.hauswaehrung, updatedAt: p.geaendertAm });

/** Mount unter `/manager-profile`. */
export function managerProfilRouten(db: Db) {
  return new Hono()
    /** Profil mit Summen über alle sichtbaren Fonds in der Hauswährung (Stichtag und Wissensstand wählbar). */
    .get("/", pruefe("query", stichtagAbfrage), async (c) => {
      const q = c.req.valid("query");
      const daten = await lese(db, async (tx) => {
        const profil = await ladeManagerProfil(tx);
        const ids = await sichtbar(tx, c);
        const stichtag = await gemeinsamerStichtag(tx, ids, q.asOf, q.knowledgeDate);
        const summen = await ladePortfolioSummen(tx, ids, stichtag, q.knowledgeDate, profil.hauswaehrung);
        return { ...profilAntwort(profil), knowledgeDate: q.knowledgeDate ?? null, ...summen, gaps: summen.gaps.map(kursluecke) };
      });
      return c.json(daten, 200);
    })
    /** Name und Hauswährung ändern (nur globale Verwalter). */
    .put("/", pruefe("json", profilEingabe), async (c) => {
      const e = c.req.valid("json");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeManagerProfil(tx);
        const werte = { name: e.name === undefined ? vorher.name : e.name, hauswaehrung: e.homeCurrency ?? vorher.hauswaehrung, geaendertAm: new Date() };
        await tx.insert(managerProfil).values({ id: 1, ...werte }).onConflictDoUpdate({ target: managerProfil.id, set: werte });
        await protokoll("aendern", "manager_profil", "00000000-0000-0000-0000-000000000001", { name: vorher.name, hauswaehrung: vorher.hauswaehrung }, { name: werte.name, hauswaehrung: werte.hauswaehrung });
        return ladeManagerProfil(tx);
      });
      return c.json(profilAntwort(nachher), 200);
    });
}

/** Mount unter `/portfolio`. */
export function portfolioRouten(db: Db) {
  return new Hono()
    /**
     * Portfolio-Dashboard über alle sichtbaren Fonds: Summen ohne Doppelzählung, Allokation nach Sektor, Land, Phase und Fonds (investiert und Zeitwert) und
     * der Verlauf von NAV und Portfoliowert je Fonds und gesamt, alles in der Hauswährung.
     */
    .get("/dashboard", pruefe("query", dashboardAbfrage), async (c) => {
      const q = c.req.valid("query");
      const daten = await lese(db, async (tx) => {
        const profil = await ladeManagerProfil(tx);
        const ids = await sichtbar(tx, c);
        const stichtag = await gemeinsamerStichtag(tx, ids, q.asOf, q.knowledgeDate);
        const summen = await ladePortfolioSummen(tx, ids, stichtag, q.knowledgeDate, profil.hauswaehrung);
        const allocation = await ladeAllokation(tx, ids, stichtag, q.knowledgeDate, profil.hauswaehrung);
        const history = await ladeVerlauf(tx, ids, stichtag, q.knowledgeDate, profil.hauswaehrung, q.quarters);
        return { managerName: profil.name, knowledgeDate: q.knowledgeDate ?? null, ...summen, gaps: summen.gaps.map(kursluecke), allocation, history };
      });
      return c.json(daten, 200);
    });
}

// Zielfonds (Dachfonds) unter /funds/:id/target-funds ---------------------------------------------------------------------------------------

const zielParam = z.object({ id: z.uuid(), targetFundId: z.uuid() });
const bewegungParam = zielParam.extend({ movementId: z.uuid() });
const neueZielfondsBeteiligung = z
  .object({ name: textEingabe(200), targetFundId: z.uuid().nullable().optional(), organizationId: z.uuid().nullable().optional(), investorOrganizationId: z.uuid().nullable().optional() })
  .strict()
  .refine((w) => !w.investorOrganizationId || Boolean(w.targetFundId), { message: "Only a target fund of this installation has an investor record", path: ["investorOrganizationId"] });
const zielfondsAenderung = z
  .object({ name: textEingabe(200).optional(), organizationId: z.uuid().nullable().optional(), investorOrganizationId: z.uuid().nullable().optional() })
  .strict()
  .refine((w) => w.name !== undefined || w.organizationId !== undefined || w.investorOrganizationId !== undefined, { message: "At least one field must be given", path: [] });
const neueBewegung = z.object({ type: z.enum(["commitment", "capital_call", "distribution"]), valueDate: z.iso.date(), amount: betragEingabe, remark: optionalerText(500) }).strict();
const stornoEingabe = z.object({ remark: optionalerText(500) }).strict();
const anteilText = z
  .string()
  .regex(/^(0(\.\d{1,10})?|1(\.0{1,10})?)$/, "Share as a fraction between 0 and 1 with at most ten decimal places expected")
  .refine((w) => Number(w) > 0, { message: "Share greater than zero" });
const neueMeldung = z
  .object({ asOf: z.iso.date(), nav: z.string().regex(/^-?\d{1,16}(\.\d{1,2})?$/, "Amount with at most two decimal places expected").nullable().optional(), share: anteilText.nullable().optional(), remark: optionalerText(500) })
  .strict()
  .refine((w) => (w.nav ?? null) !== null || (w.share ?? null) !== null, { message: "Provide the NAV, the share or both", path: ["nav"] });

const ART_EN = { zusage: "commitment", abruf: "capital_call", ausschuettung: "distribution" } as const;
const ART_DE = { commitment: "zusage", capital_call: "abruf", distribution: "ausschuettung" } as const;
const METHODE_EN = { durchrechnung: "look_through", nav_meldung: "reported_nav", anschaffungskosten: "cost" } as const;

const kennzahlAus = (m: { wert: Decimal | null; schritte: { zeichen: string; bezeichnung: string; wert: string; quellen?: string[] }[] }, stellen?: number): Kennzahl => ({
  value: m.wert === null ? null : stellen === undefined ? m.wert.toString() : m.wert.toFixed(stellen),
  steps: m.schritte.map((s) => ({ operator: s.zeichen as Kennzahl["steps"][number]["operator"], label: s.bezeichnung, value: s.wert, ...(s.quellen ? { sources: s.quellen } : {}) })),
});

function kennzahlenAntwort(k: ZielfondsKennzahlen) {
  const wert = kennzahlAus(k.wert, 2);
  return {
    commitment: kennzahlAus(k.zusage, 2),
    called: kennzahlAus(k.abgerufen, 2),
    unfunded: kennzahlAus(k.offeneZusage, 2),
    distributed: kennzahlAus(k.ausgeschuettet, 2),
    value: { ...wert, method: METHODE_EN[k.wert.methode], reportId: k.wert.meldungId },
    dpi: kennzahlAus(k.dpi),
    tvpi: kennzahlAus(k.tvpi),
    irr: kennzahlAus(k.irr),
  };
}

async function verlangeFonds(tx: Tx, id: string) {
  const [f] = await tx.select({ id: fonds.id, waehrung: fonds.waehrung }).from(fonds).where(eq(fonds.id, id));
  if (!f) throw new Fachfehler(404, "fund_not_found", "Fund not found.");
  return f;
}

/**
 * Die Zielfondsbeteiligung des Fonds. Einzelansicht und Schreibwege verlangen Leserecht am eigenen Zielfonds: Meldungen und Bewegungen gehören zu dessen
 * Durchrechnung; ohne Recht 404 wie eine unbekannte Beteiligung.
 */
async function verlangeZielfonds(tx: Tx, fondsId: string, id: string, c: Parameters<typeof aktuellerAkteur>[0]) {
  const [z] = await tx.select().from(zielfondsBeteiligung).where(and(eq(zielfondsBeteiligung.id, id), eq(zielfondsBeteiligung.fondsId, fondsId)));
  if (!z || (z.zielfondsId !== null && !darfSehen(c)(z.zielfondsId))) throw new Fachfehler(404, "target_fund_not_found", "Target fund holding not found in this fund.");
  return z;
}

/** Darf die Person den Fonds im Bereich Portfolio sehen? Nur dann gibt es die Einzelheiten eines eigenen Zielfonds. */
function darfSehen(c: Parameters<typeof aktuellerAkteur>[0]): (fondsId: string) => boolean {
  return portfolioSicht(aktuellerAkteur(c));
}

async function pruefeVerweise(tx: Tx, c: Parameters<typeof aktuellerAkteur>[0], fondsId: string, e: { targetFundId?: string | null | undefined; organizationId?: string | null | undefined; investorOrganizationId?: string | null | undefined }) {
  if (e.targetFundId) {
    if (e.targetFundId === fondsId) throw new Fachfehler(409, "target_fund_self", "A fund cannot hold an interest in itself.");
    // Ein Zielfonds derselben Installation nur mit Leserecht an ihm: bei fehlendem Recht folgt dieselbe Antwort wie bei einem unbekannten Fonds.
    if (!darfSehen(c)(e.targetFundId)) throw new Fachfehler(404, "fund_not_found", "Fund not found.");
    await verlangeFonds(tx, e.targetFundId);
  }
  for (const orgId of [e.organizationId, e.investorOrganizationId]) {
    if (!orgId) continue;
    const [o] = await tx.select({ id: organisation.id }).from(organisation).where(eq(organisation.id, orgId));
    if (!o) throw new Fachfehler(404, "organization_not_found", "Organization not found.");
  }
}

const zeile = (z: typeof zielfondsBeteiligung.$inferSelect) => ({ id: z.id, fundId: z.fondsId, name: z.name, targetFundId: z.zielfondsId, organizationId: z.organisationId, investorOrganizationId: z.investorOrganisationId, createdAt: z.erstelltAm.toISOString() });

/** Mount unter `/funds`: Zielfondsbeteiligungen eines Dachfonds. */
export function zielfondsRouten(db: Db) {
  return new Hono()
    /** Zielfonds des Fonds mit Kennzahlen zum Stichtag (Zusage, Abrufe, offene Zusage, Ausschüttungen, Wert, DPI, TVPI, IRR) samt Herkunft und Summe. */
    .get("/:id/target-funds", pruefe("param", idParam, { query: stichtagAbfrage }), pruefe("query", stichtagAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const q = c.req.valid("query");
      const daten = await lese(db, async (tx) => {
        const f = await verlangeFonds(tx, id);
        const stichtag = q.asOf ?? (await standardStichtag(tx, id, q.knowledgeDate));
        const positionen = (await ladeZielfondsZum(tx, id, stichtag, q.knowledgeDate)) ?? [];
        const { sichtbar, sammelwert } = gruppiereZielfonds(positionen, darfSehen(c), (p) => p.kennzahlen.wert.wert);
        const einzeln = sichtbar.map((p) => ({ id: p.id, name: p.name, targetFundId: p.zielfondsId, targetFundName: p.zielfondsName, organizationId: p.organisationId, investorOrganizationId: p.investorOrganisationId, metrics: kennzahlenAntwort(p.kennzahlen) }));
        const sammelzeile = sammelwert === null ? [] : [{ id: null, name: "Zielfonds", metrics: { value: { value: sammelwert.toFixed(2) } } }];
        const summe = (wahl: (k: ZielfondsKennzahlen) => Decimal) => positionen.reduce((s, p) => s.plus(wahl(p.kennzahlen)), new Decimal(0)).toFixed(2);
        return {
          fundId: id,
          currency: f.waehrung,
          asOf: stichtag,
          knowledgeDate: q.knowledgeDate ?? null,
          data: [...einzeln, ...sammelzeile],
          totals: { commitment: summe((k) => k.zusage.wert), called: summe((k) => k.abgerufen.wert), unfunded: summe((k) => k.offeneZusage.wert), distributed: summe((k) => k.ausgeschuettet.wert), value: summe((k) => k.wert.wert) },
        };
      });
      return c.json(daten, 200);
    })
    .post("/:id/target-funds", pruefe("param", idParam), pruefe("json", neueZielfondsBeteiligung), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await verlangeFonds(tx, id);
        await pruefeVerweise(tx, c, id, e);
        if (e.targetFundId) {
          const [doppelt] = await tx.select({ id: zielfondsBeteiligung.id }).from(zielfondsBeteiligung).where(and(eq(zielfondsBeteiligung.fondsId, id), eq(zielfondsBeteiligung.zielfondsId, e.targetFundId)));
          if (doppelt) throw new Fachfehler(409, "target_fund_exists", "This fund already holds an interest in the target fund.", { targetFundHoldingId: doppelt.id });
          // Kein Kreis und höchstens drei Ebenen Durchrechnung (Schutz vor Rekursion über verzweigte Ketten).
          const grund = await pruefeVerknuepfung(tx, id, e.targetFundId);
          if (grund === "cycle") throw new Fachfehler(409, "target_fund_cycle", "The target fund already holds this fund directly or indirectly.");
          if (grund === "too_deep") throw new Fachfehler(409, "target_fund_too_deep", "The chain of funds holding funds would be deeper than three levels.");
        }
        const [z] = await tx.insert(zielfondsBeteiligung).values({ fondsId: id, name: e.name, zielfondsId: e.targetFundId ?? null, organisationId: e.organizationId ?? null, investorOrganisationId: e.investorOrganizationId ?? null }).returning();
        await protokoll("anlegen", "zielfonds_beteiligung", z!.id, null, z);
        return z!;
      });
      return c.json(zeile(neu), 201);
    })
    /** Eine Zielfondsbeteiligung mit allen Bewegungen und Meldungen (bis zum Wissensstand) und den Kennzahlen zum Stichtag. */
    .get("/:id/target-funds/:targetFundId", pruefe("param", zielParam, { query: stichtagAbfrage }), pruefe("query", stichtagAbfrage), async (c) => {
      const { id, targetFundId } = c.req.valid("param");
      const q = c.req.valid("query");
      const daten = await lese(db, async (tx) => {
        const z = await verlangeZielfonds(tx, id, targetFundId, c);
        const stichtag = q.asOf ?? (await standardStichtag(tx, id, q.knowledgeDate));
        const p = ((await ladeZielfondsZum(tx, id, stichtag, q.knowledgeDate)) ?? []).find((x) => x.id === targetFundId);
        const stand = q.knowledgeDate;
        const bewegungen = await tx.select().from(zielfondsBewegung).where(and(eq(zielfondsBewegung.beteiligungId, targetFundId), stand ? sql`${zielfondsBewegung.erfasstAm} <= ${stand}::timestamptz` : undefined)).orderBy(asc(zielfondsBewegung.valuta), asc(zielfondsBewegung.erfasstAm));
        const meldungen = await tx.select().from(zielfondsMeldung).where(and(eq(zielfondsMeldung.beteiligungId, targetFundId), stand ? sql`${zielfondsMeldung.erfasstAm} <= ${stand}::timestamptz` : undefined)).orderBy(asc(zielfondsMeldung.stichtag), asc(zielfondsMeldung.erfasstAm));
        const storniert = new Set(bewegungen.map((b) => b.storniertBewegungId).filter((x): x is string => x !== null));
        return {
          ...zeile(z),
          asOf: stichtag,
          knowledgeDate: stand ?? null,
          metrics: p ? kennzahlenAntwort(p.kennzahlen) : null,
          movements: bewegungen.map((b) => ({ id: b.id, type: ART_EN[b.art], valueDate: b.valuta, amount: b.betrag, remark: b.bemerkung, reversesId: b.storniertBewegungId, reversed: storniert.has(b.id), recordedBy: b.erfasstVon, recordedAt: b.erfasstAm.toISOString() })),
          navReports: meldungen.map((m) => ({ id: m.id, asOf: m.stichtag, nav: m.nav, share: m.anteil === null ? null : new Decimal(m.anteil).toString(), remark: m.bemerkung, recordedBy: m.erfasstVon, recordedAt: m.erfasstAm.toISOString() })),
        };
      });
      return c.json(daten, 200);
    })
    .patch("/:id/target-funds/:targetFundId", pruefe("param", zielParam), pruefe("json", zielfondsAenderung), async (c) => {
      const { id, targetFundId } = c.req.valid("param");
      const e = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await verlangeZielfonds(tx, id, targetFundId, c);
        await pruefeVerweise(tx, c, id, e);
        if (e.investorOrganizationId && !vorher.zielfondsId) throw new Fachfehler(400, "invalid_input", "Only a target fund of this installation has an investor record.", { felder: [{ feld: "investorOrganizationId", code: "target_fund_required", meldung: "Only a target fund of this installation has an investor record" }] });
        const [z] = await tx
          .update(zielfondsBeteiligung)
          .set({ ...(e.name !== undefined ? { name: e.name } : {}), ...(e.organizationId !== undefined ? { organisationId: e.organizationId } : {}), ...(e.investorOrganizationId !== undefined ? { investorOrganisationId: e.investorOrganizationId } : {}) })
          .where(eq(zielfondsBeteiligung.id, targetFundId))
          .returning();
        await protokoll("aendern", "zielfonds_beteiligung", targetFundId, vorher, z);
        return z!;
      });
      return c.json(zeile(neu), 200);
    })
    /** Zusage, Kapitalabruf oder Ausschüttung des Zielfonds (Betrag in Fondswährung des Dachfonds). */
    .post("/:id/target-funds/:targetFundId/movements", pruefe("param", zielParam), pruefe("json", neueBewegung), async (c) => {
      const { id, targetFundId } = c.req.valid("param");
      const e = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await verlangeZielfonds(tx, id, targetFundId, c);
        const [b] = await tx.insert(zielfondsBewegung).values({ beteiligungId: targetFundId, art: ART_DE[e.type], valuta: e.valueDate, betrag: e.amount, bemerkung: e.remark ?? null, erfasstVon: protokoll.akteur }).returning();
        await protokoll("anlegen", "zielfonds_bewegung", b!.id, null, b);
        return b!;
      });
      return c.json({ id: neu.id, type: ART_EN[neu.art], valueDate: neu.valuta, amount: neu.betrag, remark: neu.bemerkung, reversesId: null, recordedAt: neu.erfasstAm.toISOString() }, 201);
    })
    /** Storno einer Bewegung: Gegenbuchung mit negiertem Betrag zur selben Valuta. */
    .post("/:id/target-funds/:targetFundId/movements/:movementId/reverse", pruefe("param", bewegungParam), pruefe("json", stornoEingabe), async (c) => {
      const { id, targetFundId, movementId } = c.req.valid("param");
      const e = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await verlangeZielfonds(tx, id, targetFundId, c);
        const [o] = await tx.select().from(zielfondsBewegung).where(and(eq(zielfondsBewegung.id, movementId), eq(zielfondsBewegung.beteiligungId, targetFundId))).for("update");
        if (!o) throw new Fachfehler(404, "target_fund_movement_not_found", "Movement not found for this target fund holding.");
        if (o.storniertBewegungId !== null) throw new Fachfehler(409, "reversal_not_allowed", "A reversal cannot be reversed.");
        const [schon] = await tx.select({ id: zielfondsBewegung.id }).from(zielfondsBewegung).where(eq(zielfondsBewegung.storniertBewegungId, movementId));
        if (schon) throw new Fachfehler(409, "already_reversed", "The movement has already been reversed.");
        const [b] = await tx
          .insert(zielfondsBewegung)
          .values({ beteiligungId: targetFundId, art: o.art, valuta: o.valuta, betrag: new Decimal(o.betrag).neg().toFixed(2), bemerkung: e.remark ?? null, storniertBewegungId: o.id, erfasstVon: protokoll.akteur })
          .returning();
        await protokoll("stornieren", "zielfonds_bewegung", b!.id, o, b);
        return b!;
      });
      return c.json({ id: neu.id, type: ART_EN[neu.art], valueDate: neu.valuta, amount: neu.betrag, remark: neu.bemerkung, reversesId: neu.storniertBewegungId, recordedAt: neu.erfasstAm.toISOString() }, 201);
    })
    /** Meldung des Zielfonds zu einem Stichtag: NAV des Anteils und/oder Anteil am Zielfonds. Eine neue Meldung zum selben Stichtag ersetzt die alte. */
    .post("/:id/target-funds/:targetFundId/nav-reports", pruefe("param", zielParam), pruefe("json", neueMeldung), async (c) => {
      const { id, targetFundId } = c.req.valid("param");
      const e = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await verlangeZielfonds(tx, id, targetFundId, c);
        const [m] = await tx.insert(zielfondsMeldung).values({ beteiligungId: targetFundId, stichtag: e.asOf, nav: e.nav ?? null, anteil: e.share ?? null, bemerkung: e.remark ?? null, erfasstVon: protokoll.akteur }).returning();
        await protokoll("anlegen", "zielfonds_meldung", m!.id, null, m);
        return m!;
      });
      return c.json({ id: neu.id, asOf: neu.stichtag, nav: neu.nav, share: neu.anteil === null ? null : new Decimal(neu.anteil).toString(), remark: neu.bemerkung, recordedAt: neu.erfasstAm.toISOString() }, 201);
    });
}
