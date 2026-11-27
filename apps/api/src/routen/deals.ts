import { sourceActive } from "../rechte/sichtbarkeit";
import { verlangeZustimmendenBeschluss } from "../crm/resolution";
import { sourcesFor } from "../integrationen/records";
import { kontaktJson, pruefeKontakt } from "../kontakte/http";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  aktivitaet,
  aktivitaetSync,
  beschluss,
  beschlussErgebnis,
  beschlussvorlage,
  benutzer,
  beteiligung,
  deal,
  dealHerkunft,
  dealPhase,
  dealPhasenwechsel,
  dealStatus,
  dealTyp,
  fonds,
  wirksamesBereichsrecht,
  type FondsRolle,
  instrumentArt,
  organisation,
  organisationArt,
  person,
  vorgang,
  type Db,
} from "@carraway/db";
import { ROLLEN_RANG, aktuellerAkteur, hatRolle, type Akteur } from "../anmeldung/akteur";
import { formatiereBetragText, formatiereDatumText, INSTRUMENT_TEXT, PHASEN_TEXT, rendereVorlage } from "../beschluss/vorlage";
import { pruefeZustaendigerZugriff, sucheZustaendige } from "../crm/zustaendige";
import { legeOrganisationAn } from "../dubletten";
import { Fachfehler, fehlerAntwort } from "../fehler";
import { legeHauptinstrumentAn } from "../instrumente/hauptinstrument";
import { pruefePeriodensperre } from "../instrumente/zustand";
import { verlangeBereiche } from "../rechte/uebergreifend";
import { darfFondsSehen, dealSichtbar, fondsSichtbar } from "../rechte/sichtbarkeit";
import { aktivitaetMitHerkunft } from "../postfach/abgleich";
import {
  betragEingabe,
  heute,
  idParam,
  ladeDeal,
  ladeFonds,
  ladeOrganisation,
  MINDESTENS_EIN_FELD,
  mindestensEins,
  nurGesetzte,
  optionalerText,
  schreibe,
  textEingabe,
  websiteEingabe,
  type Protokollant,
} from "../schreiben";
import { geaendertSeitBedingung, geaendertSeitEingabe } from "../geaendert";
import { lese, type Tx } from "../zeitlimit";
import { ordneRundeZu } from "../instrumente/vorgang-runde";

const zuordnungsId = z.uuid().transform((id) => id.toLowerCase()).nullable();

const zustaendigkeitsFelder = {
  investmentmanagerId: zuordnungsId.optional(),
  projektleiterId: zuordnungsId.optional(),
};

const dealZuordnung = z
  .object({ ...zustaendigkeitsFelder, erwartetInvestmentmanagerId: zuordnungsId, erwartetProjektleiterId: zuordnungsId })
  .strict()
  .refine(({ investmentmanagerId, projektleiterId }) => mindestensEins({ investmentmanagerId, projektleiterId }), MINDESTENS_EIN_FELD);

const neuerDeal = z
  .object({
    titel: textEingabe(300),
    /** Entweder eine bestehende Organisation oder eine, die gleich mit angelegt wird. */
    organisationId: z.uuid().optional(),
    organisation: z
      .object({
        name: textEingabe(300),
        art: z.enum(organisationArt.enumValues).default("unternehmen"),
        sektor: optionalerText(200),
        ort: optionalerText(200),
        website: websiteEingabe,
      })
      .optional(),
    dubletteBestaetigt: z.boolean().optional(),
    eingangsdatum: z.iso.date().optional(),
    herkunft: z.enum(dealHerkunft.enumValues).nullable().optional(),
    dealtyp: z.enum(dealTyp.enumValues).nullable().optional(),
    ...zustaendigkeitsFelder,
    selbstUebernehmen: z.boolean().optional(),
    ticket: betragEingabe.optional(),
    quelle: optionalerText(200),
    betreuung: optionalerText(200),
    fondsId: z.uuid().nullable().optional(),
    /** Startphase (Schnellanlage in einer Spalte des Boards); ins Closing führt nur der Phasenwechsel mit zustimmendem Beschluss. */
    phase: z.enum(dealPhase.enumValues).refine((p) => p !== "closing", { message: "Closing can only be reached through a stage change" }).optional(),
  })
  .refine((w) => (w.organisationId === undefined) !== (w.organisation === undefined), {
    message: "Specify either organizationId or organization",
    path: ["organisationId"],
  })
  .refine((w) => !w.selbstUebernehmen || !w.investmentmanagerId, {
    message: "Do not specify an investment manager when assigning yourself",
    path: ["investmentmanagerId"],
  });

const aenderungDeal = z
  .object({
    titel: textEingabe(300).optional(),
    dealtyp: z.enum(dealTyp.enumValues).nullable().optional(),
    ticket: betragEingabe.nullable().optional(),
    quelle: optionalerText(200),
    betreuung: optionalerText(200),
    fondsId: z.uuid().nullable().optional(),
    beschlussvorschlag: optionalerText(20000),
  })
  .refine(mindestensEins, MINDESTENS_EIN_FELD);

const phasenwechsel = z.object({
  nachPhase: z.enum(dealPhase.enumValues),
  am: z.iso.date().optional(),
  bemerkung: optionalerText(1000),
});

const neuerBeschluss = z.object({
  gremium: textEingabe(200),
  datum: z.iso.date(),
  ergebnis: z.enum(beschlussErgebnis.enumValues),
  /** Nur bei `zugestimmt` und nur, wenn der Deal noch keinen Fonds hat: der Fonds, für den zugestimmt wird. */
  fondsId: z.uuid().optional(),
  betrag: betragEingabe.optional(),
  auflagen: optionalerText(2000),
  protokoll: optionalerText(20000),
});

const vorschlagAusVorlage = z.object({
  vorlageId: z.uuid(),
  /** Das Instrument steht noch nicht am Deal; wer es im Text braucht, nennt es hier. */
  instrument: z.enum(instrumentArt.enumValues).optional(),
  sprache: z.enum(["de", "en"]).default("de"),
});

const neueBeteiligung = z.object({
  fondsId: z.uuid(),
  instrument: z.enum(instrumentArt.enumValues),
  erstinvestment: z.iso.date(),
  zusage: betragEingabe.optional(),
});

/** Beträge sind Zeichenketten mit höchstens zwei Nachkommastellen (Entscheidung 7); Vergleich in Cent. */
function inCent(betrag: string): bigint {
  const [ganz = "0", rest = ""] = betrag.split(".");
  return BigInt(ganz) * 100n + BigInt(rest.padEnd(2, "0"));
}

/** Phasenwechsel eines offenen Deals mit allen Regeln (Closing nur mit zustimmendem Beschluss); gemeinsam genutzt von Route, Board und Massenaktion. */
export async function wechselePhase(tx: Tx, protokoll: Protokollant, id: string, nachPhase: (typeof dealPhase.enumValues)[number], am?: string, bemerkung?: string | null) {
  const vorher = await ladeDeal(tx, id);
  verlangeOffen(vorher);
  if (vorher.phase === nachPhase) throw new Fachfehler(409, "stage_unchanged", "The deal is already in this stage.");
  if (nachPhase === "closing") await verlangeZustimmendenBeschluss(tx, id);
  const [wechsel] = await tx
    .insert(dealPhasenwechsel)
    .values({ dealId: id, vonPhase: vorher.phase, nachPhase, am: am ?? heute(), bemerkung: bemerkung ?? null })
    .returning();
  const [nachher] = await tx.update(deal).set({ phase: nachPhase, aktualisiertAm: new Date() }).where(eq(deal.id, id)).returning();
  await protokoll("phasenwechsel", "deal", id, vorher, nachher);
  await protokoll("anlegen", "deal_phasenwechsel", wechsel!.id, null, wechsel);
  return { deal: nachher, phasenwechsel: wechsel };
}

/**
 * Die Zustimmung gilt für genau den Fonds, in den überführt wird, und die erfassende Person muss dort (noch) Freigeber
 * sein. Altbestand ohne `fonds_id` oder ohne Person deckt keinen Fonds ab (fail closed).
 */
async function verlangeBeschlussFuerFonds(tx: Tx, zustimmung: { fondsId: string | null; erfasstVon: string | null }, fondsId: string) {
  const abweichend = () => new Fachfehler(409, "resolution_fund_mismatch", "The approving resolution does not apply to this fund.");
  if (zustimmung.fondsId !== fondsId || zustimmung.erfasstVon === null) throw abweichend();
  const [person] = await tx
    .select({ aktiv: benutzer.aktiv, globalVerwalter: benutzer.globalVerwalter })
    .from(benutzer)
    .where(eq(benutzer.id, zustimmung.erfasstVon));
  if (!person?.aktiv) throw abweichend();
  if (person.globalVerwalter) return;
  // Bereiche je Fonds: Freigeber im Dealflow an diesem Fonds.
  const [rolle] = await tx
    .select({ rolle: sql<FondsRolle>`max(${wirksamesBereichsrecht.rolle})` })
    .from(wirksamesBereichsrecht)
    .where(and(eq(wirksamesBereichsrecht.benutzerId, zustimmung.erfasstVon), eq(wirksamesBereichsrecht.fondsId, fondsId), or(isNull(wirksamesBereichsrecht.bereich), eq(wirksamesBereichsrecht.bereich, "dealflow"))));
  if (!rolle?.rolle || ROLLEN_RANG[rolle.rolle] < ROLLEN_RANG.freigeber) throw abweichend();
}

async function pruefeDealZuordnung(tx: Tx, akteur: Akteur, werte: z.infer<z.ZodObject<typeof zustaendigkeitsFelder>>, fondsId: string | null | undefined) {
  for (const id of new Set([werte.investmentmanagerId, werte.projektleiterId])) {
    await pruefeZustaendigerZugriff(tx, id, fondsId, { mindest: "bearbeiter", sichtbarFuer: akteur });
  }
}

function verlangeOffen(d: { status: string }) {
  if (d.status !== "offen") throw new Fachfehler(409, "deal_not_open", "The deal is not open.");
}

/** Postgres-Fehlercode 23505 (Unique-Verletzung); Drizzle verpackt den Treiberfehler. */
function istEindeutigkeitsfehler(fehler: unknown): boolean {
  for (let e: unknown = fehler, tiefe = 0; e && tiefe < 5; tiefe++, e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

export function dealRouten(db: Db) {
  return new Hono()
    .get(
      "/",
      pruefeKontakt("query", z.object({ status: z.enum(dealStatus.enumValues).optional(), phase: z.enum(dealPhase.enumValues).optional(), geaendertSeit: geaendertSeitEingabe })),
      async (c) => {
        const { status, phase, geaendertSeit } = c.req.valid("query");
        const bedingungen = [status ? eq(deal.status, status) : undefined, phase ? eq(deal.phase, phase) : undefined, geaendertSeitBedingung("deal", deal.id, deal.aktualisiertAm, geaendertSeit)];
        const zeilen = await lese(db, (tx) =>
          tx
            .select({
              id: deal.id,
              titel: deal.titel,
              organisation: { id: organisation.id, name: organisation.name },
              phase: deal.phase,
              status: deal.status,
              fondsId: deal.fondsId,
              eingangsdatum: deal.eingangsdatum,
              herkunft: deal.herkunft,
              dealtyp: deal.dealtyp,
              investmentmanagerId: deal.investmentmanagerId,
              projektleiterId: deal.projektleiterId,
              ticket: deal.ticket,
              absagegrund: deal.absagegrund,
              betreuung: deal.betreuung,
              quelle: deal.quelle,
              aktualisiertAm: deal.aktualisiertAm,
            })
            .from(deal)
            .innerJoin(organisation, eq(organisation.id, deal.organisationId))
            .where(and(...bedingungen, dealSichtbar(c)))
            .orderBy(desc(deal.aktualisiertAm), deal.id),
        );
        return kontaktJson(c, { daten: zeilen }, 200);
      },
    )
    .get("/:id", pruefeKontakt("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const ergebnis = await lese(db, async (tx) => {
        const [d] = await tx.select().from(deal).where(eq(deal.id, id));
        if (!d) return null;
        const [org] = await tx.select().from(organisation).where(eq(organisation.id, d.organisationId));
        const [dealFonds] = d.fondsId
          ? await tx.select({ id: fonds.id, name: fonds.name, kurzname: fonds.kurzname }).from(fonds).where(eq(fonds.id, d.fondsId))
          : [null];
        const personen = await tx
          .select({ id: person.id, vorname: person.vorname, nachname: person.nachname, email: person.email, funktion: person.funktion })
          .from(person)
          .where(and(eq(person.organisationId, d.organisationId), isNull(person.zusammengefuehrtIn)))
          .orderBy(asc(person.nachname), asc(person.vorname), asc(person.id));
        const phasenverlauf = await tx
          .select()
          .from(dealPhasenwechsel)
          .where(eq(dealPhasenwechsel.dealId, id))
          .orderBy(asc(dealPhasenwechsel.am), asc(dealPhasenwechsel.erfasstAm), asc(dealPhasenwechsel.id));
        const aktivitaeten = await tx
          .select(aktivitaetMitHerkunft(aktuellerAkteur(c).id))
          .from(aktivitaet)
          .leftJoin(aktivitaetSync, eq(aktivitaetSync.aktivitaetId, aktivitaet.id))
          .where(and(eq(aktivitaet.dealId, id), sourceActive("note", aktivitaet.id)))
          .orderBy(desc(aktivitaet.datum), desc(aktivitaet.erstelltAm), asc(aktivitaet.id));
        const beschluesse = await tx
          .select()
          .from(beschluss)
          .where(eq(beschluss.dealId, id))
          .orderBy(desc(beschluss.datum), desc(beschluss.erstelltAm), asc(beschluss.id));
        const beteiligungen = await tx
          .select({
            id: beteiligung.id,
            fonds: { id: fonds.id, name: fonds.name, kurzname: fonds.kurzname },
            instrument: beteiligung.instrument,
            status: beteiligung.status,
            erstinvestment: beteiligung.erstinvestment,
          })
          .from(beteiligung)
          .innerJoin(fonds, eq(fonds.id, beteiligung.fondsId))
          .where(and(eq(beteiligung.dealId, id), fondsSichtbar(c, beteiligung.fondsId, "portfolio")))
          .orderBy(asc(beteiligung.erstinvestment), asc(beteiligung.id));
        return { ...d, providerSources: await sourcesFor(tx, "deal", id), organisation: org, fonds: dealFonds, personen, phasenverlauf, aktivitaeten, beschluesse, beteiligungen };
      });
      if (!ergebnis) return fehlerAntwort(c, 404, "deal_not_found", "Deal not found.");
      return kontaktJson(c, ergebnis, 200);
    })
    .get("/:id/assignees", pruefeKontakt("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const benutzer = await lese(db, async (tx) => {
        const [d] = await tx.select({ fondsId: deal.fondsId }).from(deal).where(eq(deal.id, id));
        if (!d) throw new Fachfehler(404, "deal_not_found", "Deal not found.");
        if (!darfFondsSehen(c, d.fondsId)) throw new Fachfehler(403, "forbidden", "You do not have permission for this.");
        return sucheZustaendige(tx, c, { dealFondsId: d.fondsId, mindest: "bearbeiter" });
      });
      return kontaktJson(c, { benutzer }, 200);
    })
    .patch("/:id/assignment", pruefeKontakt("param", idParam), pruefeKontakt("json", dealZuordnung), async (c) => {
      const { id } = c.req.valid("param");
      const { erwartetInvestmentmanagerId, erwartetProjektleiterId, ...werte } = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeDeal(tx, id);
        // Der Fonds kann sich zwischen der Rechteprüfung und dem Sperren der Deal-Zeile geändert haben.
        if (vorher.fondsId && !hatRolle(akteur, vorher.fondsId, "bearbeiter")) {
          throw new Fachfehler(403, "forbidden", "You do not have permission for this.");
        }
        verlangeOffen(vorher);
        if (erwartetInvestmentmanagerId !== vorher.investmentmanagerId || erwartetProjektleiterId !== vorher.projektleiterId) {
          throw new Fachfehler(409, "deal_assignment_conflict", "The assignment has changed in the meantime.", {
            investmentmanagerId: vorher.investmentmanagerId,
            projektleiterId: vorher.projektleiterId,
          });
        }
        await pruefeDealZuordnung(tx, akteur, werte, vorher.fondsId);
        const [nachher] = await tx.update(deal).set({ ...werte, aktualisiertAm: new Date() }).where(eq(deal.id, id)).returning();
        await protokoll("aendern", "deal", id, vorher, nachher);
        return nachher;
      });
      return kontaktJson(c, neu, 200);
    })
    .post("/", pruefeKontakt("json", neuerDeal), async (c) => {
      const { organisationId, organisation: neueOrg, dubletteBestaetigt, selbstUebernehmen, ...werte } = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      if (selbstUebernehmen) werte.investmentmanagerId = akteur.id;
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        if (werte.fondsId) await ladeFonds(tx, werte.fondsId);
        await pruefeDealZuordnung(tx, akteur, werte, werte.fondsId);
        const org = organisationId ? await ladeOrganisation(tx, organisationId) : await legeOrganisationAn(tx, protokoll, neueOrg!, dubletteBestaetigt);
        const [neu] = await tx.insert(deal).values({ ...werte, organisationId: org.id }).returning();
        if (!neu) throw new Error("Deal nicht angelegt");
        await protokoll("anlegen", "deal", neu.id, null, neu);
        const [start] = await tx
          .insert(dealPhasenwechsel)
          .values({ dealId: neu.id, vonPhase: null, nachPhase: neu.phase, am: neu.eingangsdatum })
          .returning();
        await protokoll("anlegen", "deal_phasenwechsel", start!.id, null, start);
        return { ...neu, organisation: org };
      });
      return kontaktJson(c, ergebnis, 201);
    })
    .patch("/:id", pruefeKontakt("param", idParam), pruefeKontakt("json", aenderungDeal), async (c) => {
      const { id } = c.req.valid("param");
      const aenderungen = nurGesetzte(c.req.valid("json"));
      const akteur = aktuellerAkteur(c);
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeDeal(tx, id);
        verlangeOffen(vorher);
        if (aenderungen.fondsId) await ladeFonds(tx, aenderungen.fondsId);
        // Die Zustimmung gilt für den Fonds, für den sie erteilt wurde; ein anderer Fonds braucht einen neuen Beschluss.
        if (aenderungen.fondsId !== undefined && aenderungen.fondsId !== vorher.fondsId) {
          const [juengster] = await tx
            .select({ ergebnis: beschluss.ergebnis })
            .from(beschluss)
            .where(eq(beschluss.dealId, id))
            .orderBy(desc(beschluss.datum), desc(beschluss.erstelltAm), desc(beschluss.id))
            .limit(1);
          if (juengster?.ergebnis === "zugestimmt") {
            throw new Fachfehler(409, "deal_fund_locked", "The fund cannot be changed while an approving resolution applies. Record a new resolution first.");
          }
          await pruefeDealZuordnung(tx, akteur, vorher, aenderungen.fondsId);
        }
        const [nachher] = await tx.update(deal).set({ ...aenderungen, aktualisiertAm: new Date() }).where(eq(deal.id, id)).returning();
        await protokoll("aendern", "deal", id, vorher, nachher);
        return nachher;
      });
      return kontaktJson(c, neu, 200);
    })
    .post("/:id/stage", pruefeKontakt("param", idParam), pruefeKontakt("json", phasenwechsel), async (c) => {
      const { id } = c.req.valid("param");
      const { nachPhase, am, bemerkung } = c.req.valid("json");
      const ergebnis = await schreibe(db, c, (tx, protokoll) => wechselePhase(tx, protokoll, id, nachPhase, am, bemerkung));
      return kontaktJson(c, ergebnis, 200);
    })
    .post("/:id/decline", pruefeKontakt("param", idParam), pruefeKontakt("json", z.object({ grund: textEingabe(500) })), async (c) => {
      const { id } = c.req.valid("param");
      const { grund } = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeDeal(tx, id);
        verlangeOffen(vorher);
        const [nachher] = await tx
          .update(deal)
          .set({ status: "abgesagt", absagegrund: grund, aktualisiertAm: new Date() })
          .where(eq(deal.id, id))
          .returning();
        await protokoll("absagen", "deal", id, vorher, nachher);
        return nachher;
      });
      return kontaktJson(c, neu, 200);
    })
    .post("/:id/reopen", pruefeKontakt("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeDeal(tx, id);
        if (vorher.status !== "abgesagt") throw new Fachfehler(409, "deal_not_declined", "The deal is not declined.");
        const [nachher] = await tx
          .update(deal)
          .set({ status: "offen", absagegrund: null, aktualisiertAm: new Date() })
          .where(eq(deal.id, id))
          .returning();
        await protokoll("wiederaufnehmen", "deal", id, vorher, nachher);
        return nachher;
      });
      return kontaktJson(c, neu, 200);
    })
    .post("/:id/draft-resolution", pruefeKontakt("param", idParam), pruefeKontakt("json", vorschlagAusVorlage), async (c) => {
      const { id } = c.req.valid("param");
      const { vorlageId, instrument: art, sprache } = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeDeal(tx, id);
        verlangeOffen(vorher);
        const [vorlage] = await tx.select().from(beschlussvorlage).where(eq(beschlussvorlage.id, vorlageId));
        // Vorlagen eines Fonds ohne Rolle der Person gibt es für sie nicht.
        if (!vorlage || !hatRolle(akteur, vorlage.fondsId, "betrachter")) throw new Fachfehler(404, "template_not_found", "Template not found.");
        if (vorher.fondsId && vorher.fondsId !== vorlage.fondsId) {
          throw new Fachfehler(409, "template_fund_mismatch", "The template belongs to a different fund than the deal.");
        }
        const [org] = await tx.select().from(organisation).where(eq(organisation.id, vorher.organisationId));
        const [vorlagenFonds] = await tx.select().from(fonds).where(eq(fonds.id, vorlage.fondsId));
        const text = rendereVorlage(vorlage.text, {
          organisation: org?.name,
          titel: vorher.titel,
          ticket: vorher.ticket === null ? null : formatiereBetragText(vorher.ticket, vorlagenFonds?.waehrung ?? "EUR", sprache),
          fonds: vorlagenFonds?.name,
          instrument: art ? INSTRUMENT_TEXT[sprache][art] : null,
          phase: PHASEN_TEXT[sprache][vorher.phase],
          quelle: vorher.quelle,
          betreuung: vorher.betreuung,
          sektor: org?.sektor,
          ort: org?.ort,
          datum: formatiereDatumText(heute(), sprache),
        });
        const [nachher] = await tx.update(deal).set({ beschlussvorschlag: text, aktualisiertAm: new Date() }).where(eq(deal.id, id)).returning();
        await protokoll("aendern", "deal", id, vorher, nachher);
        return { beschlussvorschlag: text, vorlageId, deal: nachher };
      });
      return kontaktJson(c, ergebnis, 200);
    })
    .post("/:id/resolutions", pruefeKontakt("param", idParam), pruefeKontakt("json", neuerBeschluss), async (c) => {
      const { id } = c.req.valid("param");
      const werte = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const d = await ladeDeal(tx, id);
        // Funktionstrennung (Entscheidung 86): Die Route steht in der Berechtigungstabelle als `bearbeiter`, weil
        // Ablehnung und Vertagung Bearbeiter dürfen. Ein zustimmender Beschluss öffnet den Weg ins Portfolio und
        // braucht eine Freigeberin oder einen Freigeber (Mensch, kein API-Schlüssel) am Fonds des Deals.
        let beschlussFonds: string | null = null;
        if (werte.ergebnis === "zugestimmt") {
          if (akteur.technisch) throw new Fachfehler(403, "technical_user", "An approving resolution requires a signed-in person; an API key cannot approve.");
          // Der Fonds kommt vom Deal; hat der Deal keinen, muss die Anfrage ihn nennen. Freigeber braucht es genau dort.
          if (d.fondsId && werte.fondsId && werte.fondsId !== d.fondsId) {
            throw new Fachfehler(409, "resolution_fund_mismatch", "The resolution must apply to the fund of the deal.");
          }
          beschlussFonds = d.fondsId ?? werte.fondsId ?? null;
          if (!beschlussFonds) throw new Fachfehler(400, "fund_required", "An approving resolution for a deal without a fund requires fundId.");
          if (!hatRolle(akteur, beschlussFonds, "freigeber")) throw new Fachfehler(403, "forbidden", "Only approvers of this fund can record an approving resolution.");
          await ladeFonds(tx, beschlussFonds);
        } else if (werte.fondsId) {
          throw new Fachfehler(400, "fund_only_with_approval", "fundId only applies to an approving resolution.");
        }
        const [zeile] = await tx
          .insert(beschluss)
          .values({ ...werte, fondsId: beschlussFonds, dealId: id, erfasstVon: akteur.technisch ? null : akteur.id })
          .returning();
        if (!zeile) throw new Error("Beschluss nicht angelegt");
        await protokoll("anlegen", "beschluss", zeile.id, null, zeile);
        return zeile;
      });
      return kontaktJson(c, neu, 201);
    })
    .post("/:id/investment", pruefeKontakt("param", idParam), pruefeKontakt("json", neueBeteiligung), async (c) => {
      const { id } = c.req.valid("param");
      const { fondsId, instrument: art, erstinvestment, zusage } = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      // Die Route gehört zu Dealflow, angelegt werden Beteiligung, Instrument und Zusage im Portfolio.
      verlangeBereiche(akteur, ["portfolio"]);
      // Bereiche je Fonds: Bearbeiter im Portfolio genau dieses Fonds.
      if (!hatRolle(akteur, fondsId, "bearbeiter", "portfolio")) throw new Fachfehler(403, "forbidden", "The editor role in the portfolio is missing for this fund.");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeDeal(tx, id);
        await ladeFonds(tx, fondsId);
        const [vorhanden] = await tx
          .select({ id: beteiligung.id })
          .from(beteiligung)
          .where(and(eq(beteiligung.fondsId, fondsId), eq(beteiligung.organisationId, vorher.organisationId)));
        // Je Fonds und Unternehmen gibt es eine Beteiligung; ein weiteres Instrument kommt an sie (`POST /beteiligungen/:id/instrumente`).
        const vorhandenFehler = new Fachfehler(409, "investment_exists", "The fund already holds this organization; further instruments go to the existing investment.", {
          beteiligungId: vorhanden?.id,
        });
        if (vorhanden) throw vorhandenFehler;
        verlangeOffen(vorher);
        const zustimmung = await verlangeZustimmendenBeschluss(tx, id);
        await verlangeBeschlussFuerFonds(tx, zustimmung, fondsId);
        // Vier-Augen-Prinzip: Wer den zustimmenden Beschluss erfasst hat, überführt den Deal nicht selbst ins Portfolio.
        if (zustimmung.erfasstVon !== null && zustimmung.erfasstVon === akteur.id) {
          throw new Fachfehler(409, "four_eyes_violated", "The transfer to the portfolio must be carried out by a different person than the one who recorded the approving resolution.");
        }
        if (zusage && zustimmung.betrag !== null && inCent(zusage) > inCent(zustimmung.betrag)) {
          throw new Fachfehler(409, "commitment_exceeds_resolution", "The commitment exceeds the resolved amount.", { beschlussBetrag: zustimmung.betrag });
        }

        if (fondsId !== vorher.fondsId) await pruefeDealZuordnung(tx, akteur, vorher, fondsId);
        if (zusage) await pruefePeriodensperre(tx, fondsId, erstinvestment);

        let neueBeteiligung;
        try {
          [neueBeteiligung] = await tx
            .insert(beteiligung)
            .values({ fondsId, organisationId: vorher.organisationId, dealId: id, instrument: art, erstinvestment })
            .returning();
        } catch (fehler) {
          if (istEindeutigkeitsfehler(fehler)) throw vorhandenFehler;
          throw fehler;
        }
        if (!neueBeteiligung) throw new Error("Beteiligung nicht angelegt");
        await protokoll("anlegen", "beteiligung", neueBeteiligung.id, null, neueBeteiligung);
        const hauptinstrument = await legeHauptinstrumentAn(tx, neueBeteiligung);

        let neueZusage = null;
        if (zusage) {
          [neueZusage] = await tx
            .insert(vorgang)
            .values({ beteiligungId: neueBeteiligung.id, instrumentId: hauptinstrument, art: "zusage", valuta: erstinvestment, betrag: zusage, bemerkung: "Zusage aus dem Deal" })
            .returning();
          await protokoll("anlegen", "vorgang", neueZusage!.id, null, neueZusage);
          await ordneRundeZu(tx, protokoll, neueZusage!);
        }

        const [wechsel] = await tx
          .insert(dealPhasenwechsel)
          .values({ dealId: id, vonPhase: vorher.phase, nachPhase: "closing", am: erstinvestment, bemerkung: "Übergang ins Portfolio" })
          .returning();
        await protokoll("anlegen", "deal_phasenwechsel", wechsel!.id, null, wechsel);
        const [nachher] = await tx
          .update(deal)
          .set({ status: "investiert", phase: "closing", fondsId, aktualisiertAm: new Date() })
          .where(eq(deal.id, id))
          .returning();
        await protokoll("uebergang_portfolio", "deal", id, vorher, nachher);
        return { beteiligung: neueBeteiligung, zusage: neueZusage, deal: nachher };
      });
      return kontaktJson(c, ergebnis, 201);
    });
}
