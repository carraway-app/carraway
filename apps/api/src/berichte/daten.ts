import { and, asc, desc, eq, inArray, lte, sql, type SQL } from "drizzle-orm";
import type {
  ExitArt,
  ExitListeDaten,
  FondsberichtDaten,
  GremienDaten,
  Kapitalkonto,
  LpBerichtDaten,
  PortfolioListeDaten,
  QuartalsberichtDaten,
  UnternehmensKennzahl,
} from "@carraway/berichte";
import { quartalsbeginn } from "@carraway/berichte";
import { aktivitaet, beschluss, deal, fonds, fondsKennzahl, kennzahlDefinition, kennzahlWert, organisation } from "@carraway/db";
import { buchwert as rechneBuchwert, Decimal, geltendeWerte, kpiAbweichung, verteileAnteilig } from "@carraway/rechenkern";
import { ladeKapitalstand as ladeVerteilung } from "../instrumente/kapitalstand";
import { istDarlehensartig } from "../instrumente/zustand";
import { ladeBeteiligungDetail } from "../kennzahlen/beteiligung";
import { ermittleBeteiligungsstatus } from "../kennzahlen/beteiligungsstatus";
import { berechneFondsUebersicht, bisStand } from "../kennzahlen/fonds";
import type { Tx } from "../zeitlimit";
import { ladeBerichtsSicht, type SichtWahl } from "./sicht";
import { ladeZusatzspalten, ladeZusatzwerte } from "./zusatz";

/**
 * Laden der Berichtsdaten aus der Datenbank zu Stichtag und Wissensstand. Alle Funktionen lesen nur; `stand` (ISO-Zeitstempel)
 * ist der Wissensstand der Rechnung und erscheint im Bericht.
 */

type Abfrage = Pick<Tx, "execute" | "select">;

const MAX_AKTIVITAETEN = 12;

/** Ergänzungen der Listen- und Portfolioberichte (Nacharbeiten 9): gewählte eigene Felder als Spalten und die Währungssicht. Ohne Angabe bleibt alles wie bisher. */
export interface BerichtsErgaenzung {
  /** IDs der Felddefinitionen aus der Vorlage (Reihenfolge der Spalten). */
  zusatzfelder?: readonly string[];
  /** Währungssicht; `fonds` oder ohne Angabe ist die Fondswährung. */
  sicht?: SichtWahl;
}

export async function ladeFondsberichtDaten(tx: Abfrage, fondsId: string, stichtag: string, stand: string | undefined, wissensstand: string, ergaenzung: BerichtsErgaenzung = {}): Promise<FondsberichtDaten | null> {
  const [f] = await tx.select().from(fonds).where(eq(fonds.id, fondsId));
  if (!f) return null;
  const uebersicht = await berechneFondsUebersicht(tx, fondsId, stichtag, stand);
  let beteiligungen = uebersicht.beteiligungen;
  // Eigene Felder als Spalten: Werte je Beteiligung zum Wissensstand der Rechnung.
  const zusatzspalten = await ladeZusatzspalten(tx, ergaenzung.zusatzfelder ?? []);
  if (zusatzspalten.length > 0) {
    const werte = await ladeZusatzwerte(tx as Tx, zusatzspalten, beteiligungen.map((b) => b.id), uebersicht.stichtag, stand);
    beteiligungen = beteiligungen.map((b) => ({ ...b, felder: werte.get(b.id) ?? {} }));
  }
  // Währungssicht: Beträge je Beteiligung in lokaler oder Vergleichswährung, mit Kursen und Lücken.
  const sicht = ergaenzung.sicht ? await ladeBerichtsSicht(tx as Tx, fondsId, uebersicht.stichtag, stand, ergaenzung.sicht) : null;
  if (sicht) beteiligungen = beteiligungen.map((b) => (sicht.je.has(b.id) ? { ...b, sicht: sicht.je.get(b.id)! } : b));
  return {
    fonds: { name: f.name, kurzname: f.kurzname, waehrung: f.waehrung, zeichnungskapital: f.zeichnungskapital },
    stichtag: uebersicht.stichtag,
    wissensstand,
    kennzahlen: uebersicht.kennzahlen,
    beteiligungen,
    ...(zusatzspalten.length > 0 ? { zusatzspalten } : {}),
    ...(sicht ? { waehrungssicht: sicht.sicht } : {}),
  };
}

export { ladeKapitalstand as ladeVerteilung } from "../instrumente/kapitalstand";

/** Konto eines Investors aus der Verteilung: Summen der Abrufe und Ausschüttungen, offene Zusage, Anteil am NAV (ebenfalls nach größtem Rest). */
export function kontenAusVerteilung(verteilung: Awaited<ReturnType<typeof ladeVerteilung>>, nav: string | null) {
  const { zeichnungen, gewichte, bewegungen } = verteilung;

  const ausgeschuettet = zeichnungen.map(() => new Decimal(0));
  for (const b of bewegungen) {
    if (b.art === "ausschuettung") b.teile.forEach((teil, i) => (ausgeschuettet[i] = ausgeschuettet[i]!.plus(teil)));
  }
  const navTeile = nav !== null && zeichnungen.length ? verteileAnteilig(new Decimal(nav).toFixed(2), gewichte) : [];
  return zeichnungen.map((z, i) => ({
    ...z,
    ...verteilung.jeLp.get(z.organisationId)!,
    ausgeschuettet: (ausgeschuettet[i] as Decimal).toFixed(2),
    offeneZusage: new Decimal(z.zusage).minus(verteilung.jeLp.get(z.organisationId)!.abgerufen).toFixed(2),
    navAnteil: navTeile[i]?.toFixed(2) ?? null,
  }));
}

const alsKapitalkonto = (k: ReturnType<typeof kontenAusVerteilung>[number]): Kapitalkonto => ({
  investor: k.investor,
  zusage: k.zusage,
  anteil: k.anteil,
  abgerufen: k.abgerufen,
  eingezahlt: k.eingezahlt,
  offen: k.offen,
  ueberfaellig: k.ueberfaellig,
  ausgeschuettet: k.ausgeschuettet,
  offeneZusage: k.offeneZusage,
  navAnteil: k.navAnteil,
});

/**
 * Kapitalkonten der Investoren: Zusage und Anteil aus `fonds_zeichnung`; jeder Abruf und jede Ausschüttung des Fonds
 * (bis Stichtag und Wissensstand) wird einzeln anteilig auf den Cent verteilt (größter Rest, bei Gleichstand der erste in
 * der Reihenfolge Name, ID), ebenso der NAV. Die Summen der Konten sind dadurch genau die Summen des Fonds.
 */
export async function ladeKapitalkonten(tx: Abfrage, fondsId: string, stichtag: string, stand: string | undefined, nav: string | null): Promise<Kapitalkonto[]> {
  const verteilung = await ladeVerteilung(tx, fondsId, stichtag, stand);
  return kontenAusVerteilung(verteilung, nav).map(alsKapitalkonto);
}

export async function ladeLpBerichtDaten(tx: Abfrage, fondsId: string, stichtag: string, stand: string | undefined, wissensstand: string, ergaenzung: BerichtsErgaenzung = {}): Promise<LpBerichtDaten | null> {
  const basis = await ladeFondsberichtDaten(tx, fondsId, stichtag, stand, wissensstand, ergaenzung);
  if (!basis) return null;
  return { ...basis, kapitalkonten: await ladeKapitalkonten(tx, fondsId, basis.stichtag, stand, basis.kennzahlen.nav.wert) };
}

/**
 * Wie `ladeLpBerichtDaten`, aber aus einer einzigen Verteilung: dieselben Daten für die Hauptdatei und für die Fassungen je Investor.
 * `investoren[i]` gehört zu `daten.kapitalkonten[i]`; die Konten sind vorher gemeinsam auf den Cent verteilt, nie einzeln gerechnet.
 */
export async function ladeLpBerichtDatenMitInvestoren(
  tx: Abfrage,
  fondsId: string,
  stichtag: string,
  stand: string | undefined,
  wissensstand: string,
  ergaenzung: BerichtsErgaenzung = {},
): Promise<{ daten: LpBerichtDaten; investoren: { organisationId: string; konto: Kapitalkonto }[] } | null> {
  const basis = await ladeFondsberichtDaten(tx, fondsId, stichtag, stand, wissensstand, ergaenzung);
  if (!basis) return null;
  const verteilung = await ladeVerteilung(tx, fondsId, basis.stichtag, stand);
  const konten = kontenAusVerteilung(verteilung, basis.kennzahlen.nav.wert);
  const investoren = konten.map((k) => ({ organisationId: k.organisationId, konto: alsKapitalkonto(k) }));
  return { daten: { ...basis, kapitalkonten: investoren.map((i) => i.konto) }, investoren };
}

/**
 * Kennzahlen des Unternehmens für den Quartalsbericht: je ausgewählter Kennzahl der zuletzt bestätigte Ist-Wert bis zum Stichtag (späteste Periode,
 * bei gleichem Ende die längste) und der bestätigte Plan desselben Zeitraums; Bestätigungen bis zum Wissensstand. Ohne Angabe gilt die Auswahl des Fonds.
 */
export async function ladeUnternehmensKennzahlen(tx: Abfrage, beteiligungId: string, fondsId: string, stichtag: string, wissensstand: string, schluessel: string[]): Promise<UnternehmensKennzahl[]> {
  const gewaehlt = schluessel.length
    ? schluessel
    : (await tx.select({ s: fondsKennzahl.schluessel }).from(fondsKennzahl).where(eq(fondsKennzahl.fondsId, fondsId)).orderBy(asc(fondsKennzahl.reihenfolge), asc(fondsKennzahl.schluessel))).map((x) => x.s);
  if (gewaehlt.length === 0) return [];
  const zeilen = await tx
    .select({ w: kennzahlWert, schluessel: kennzahlDefinition.schluessel })
    .from(kennzahlWert)
    .innerJoin(kennzahlDefinition, eq(kennzahlDefinition.id, kennzahlWert.definitionId))
    .where(and(eq(kennzahlWert.beteiligungId, beteiligungId), inArray(kennzahlDefinition.schluessel, gewaehlt), lte(kennzahlWert.periodeEnde, stichtag), eq(kennzahlWert.status, "bestaetigt")));
  const geltend = [
    ...geltendeWerte(
      zeilen.map((z) => ({ id: z.w.id, schluessel: z.schluessel, periodeBeginn: z.w.periodeBeginn, periodeEnde: z.w.periodeEnde, szenario: z.w.szenario, wert: z.w.wert, status: z.w.status, bestaetigtAm: z.w.bestaetigtAm, folge: z.w.folge })),
      wissensstand,
    ).values(),
  ];
  const definitionen = await tx.select().from(kennzahlDefinition).where(inArray(kennzahlDefinition.schluessel, gewaehlt)).orderBy(asc(kennzahlDefinition.katalogVersion));
  const neueste = new Map(definitionen.map((d) => [d.schluessel, d]));
  const ergebnis: UnternehmensKennzahl[] = [];
  for (const s of gewaehlt) {
    const d = neueste.get(s);
    if (!d) continue; // nicht (mehr) im Katalog
    const ist = geltend
      .filter((g) => g.schluessel === s && g.szenario === "ist")
      // späteste Periode; bei gleichem Ende gilt der kürzere Zeitraum (das Quartal vor dem Jahr, das auf denselben Tag endet)
      .sort((a, b) => (a.periodeEnde < b.periodeEnde ? 1 : a.periodeEnde > b.periodeEnde ? -1 : a.periodeBeginn < b.periodeBeginn ? 1 : -1))[0];
    const plan = ist ? geltend.find((g) => g.schluessel === s && g.szenario === "plan" && g.periodeBeginn === ist.periodeBeginn && g.periodeEnde === ist.periodeEnde) : undefined;
    const abw = ist && plan ? kpiAbweichung(d.typ, ist.wert, plan.wert).wert : null;
    ergebnis.push({
      schluessel: s,
      bezeichnungDe: d.bezeichnungDe,
      bezeichnungEn: d.bezeichnungEn,
      einheit: d.einheit,
      typ: d.typ,
      periodeBeginn: ist?.periodeBeginn ?? null,
      periodeEnde: ist?.periodeEnde ?? null,
      ist: ist?.wert ?? null,
      plan: plan?.wert ?? null,
      absolut: abw ? abw.absolut.toString() : null,
      prozent: abw?.prozent ? abw.prozent.toString() : null,
    });
  }
  return ergebnis;
}

export async function ladeQuartalsDaten(tx: Abfrage, beteiligungId: string, stichtag: string | undefined, stand: string | undefined, wissensstand: string, unternehmenskennzahlen: string[] = []): Promise<QuartalsberichtDaten | null> {
  const detail = await ladeBeteiligungDetail(tx, beteiligungId, stichtag, stand);
  if (!detail) return null;
  return {
    unternehmenskennzahlen: await ladeUnternehmensKennzahlen(tx, beteiligungId, detail.fonds.id, detail.stichtag, wissensstand, unternehmenskennzahlen),
    stichtag: detail.stichtag,
    wissensstand,
    fonds: { name: detail.fonds.name, kurzname: detail.fonds.kurzname },
    organisation: { name: detail.organisation.name, sektor: detail.organisation.sektor, ort: detail.organisation.ort },
    beteiligung: { instrument: detail.beteiligung.instrument, status: detail.beteiligung.status, erstinvestment: detail.beteiligung.erstinvestment },
    vorgaenge: detail.vorgaenge,
    bewertungsverlauf: detail.bewertungsverlauf,
    kennzahlen: detail.kennzahlen,
  };
}

type BuchwertRoh = { id: string; zusage: string; investiert: string; kapitalisiert: string; tilgung: string; wertberichtigung: string; abgang: string; phase: string | null; betreuung: string | null };

/**
 * Portfolioliste je Stichtag: eine Zeile je Beteiligung, die nicht ausgeschieden ist (ausgeschiedene stehen in der Exitliste).
 * Buchwert und Wertberichtigung nach der Buchwertregel (Investiert + kapitalisierte Zinsen − Tilgungen − Wertberichtigungen − Abgang),
 * offene Zusage nur bei aktiven Beteiligungen, Phase = Bezeichnung der letzten Finanzierungsrunde bis zum Stichtag.
 */
export async function ladePortfolioListe(tx: Abfrage, fondsId: string, stichtag: string, stand: string | undefined, wissensstand: string, ergaenzung: BerichtsErgaenzung = {}): Promise<PortfolioListeDaten | null> {
  const basis = await ladeFondsberichtDaten(tx, fondsId, stichtag, stand, wissensstand, ergaenzung);
  if (!basis) return null;
  const { rows } = await tx.execute<BuchwertRoh>(sql`
    SELECT b.id,
      coalesce(sum(v.betrag) FILTER (WHERE v.art = 'zusage'), 0)::text AS zusage,
      coalesce(sum(v.betrag) FILTER (WHERE v.art = 'auszahlung'), 0)::text AS investiert,
      coalesce(sum(v.betrag) FILTER (WHERE v.art = 'zins' AND v.kapitalisiert), 0)::text AS kapitalisiert,
      coalesce(sum(v.betrag) FILTER (WHERE v.art = 'tilgung'), 0)::text AS tilgung,
      coalesce(sum(v.betrag) FILTER (WHERE v.art = 'wertberichtigung'), 0)::text AS wertberichtigung,
      (SELECT coalesce(sum(vk.buchwert_abgang), 0) FROM verkauf vk
        WHERE vk.beteiligung_id = b.id AND vk.datum <= ${stichtag}::date${bisStand(sql.raw("vk.erfasst_am"), stand)}
          AND (vk.storniert_am IS NULL${stand === undefined ? sql`` : sql` OR vk.storniert_am > ${stand}::timestamptz`}))::text AS abgang,
      (SELECT r.bezeichnung FROM finanzierungsrunde r WHERE r.organisation_id = b.organisation_id AND r.status = 'abgeschlossen' AND r.art = 'eigenkapital' AND r.datum <= ${stichtag}::date ORDER BY r.datum DESC, r.id DESC LIMIT 1) AS phase,
      (SELECT d.betreuung FROM deal d WHERE d.id = b.deal_id) AS betreuung
    FROM beteiligung b
    LEFT JOIN vorgang v ON v.beteiligung_id = b.id AND v.valuta <= ${stichtag}::date${bisStand(sql.raw("v.erfasst_am"), stand)}
    WHERE b.fonds_id = ${fondsId} AND b.erstinvestment <= ${stichtag}::date
    GROUP BY b.id`);
  const je = new Map(rows.map((r) => [r.id, r]));
  const zeilen = basis.beteiligungen
    .filter((b) => b.status !== "exit")
    .map((b) => {
      const r = je.get(b.id);
      const bw = rechneBuchwert({ investiert: r?.investiert ?? 0, kapitalisiert: r?.kapitalisiert ?? 0, tilgungen: r?.tilgung ?? 0, wertberichtigungen: r?.wertberichtigung ?? 0, abgang: r?.abgang ?? 0 }).wert;
      const offen = b.status === "aktiv" ? Decimal.max(0, new Decimal(b.zusage).minus(b.investiert)) : new Decimal(0);
      return {
        organisation: b.organisation.name,
        sektor: b.organisation.sektor,
        phase: r?.phase ?? null,
        instrument: b.instrument,
        status: b.status,
        betreuung: r?.betreuung ?? null,
        zusage: new Decimal(b.zusage).toFixed(2),
        investiert: new Decimal(b.investiert).toFixed(2),
        buchwert: bw.toFixed(2),
        wertberichtigung: new Decimal(r?.wertberichtigung ?? 0).toFixed(2),
        offeneZusage: offen.toFixed(2),
        bewertung: b.letzteBewertung ? new Decimal(b.letzteBewertung.wert).toFixed(2) : null,
        multiple: b.multiple.wert,
        ...(b.felder ? { felder: b.felder } : {}),
        ...(b.sicht ? { sicht: b.sicht } : {}),
      };
    });
  return { fonds: basis.fonds, stichtag: basis.stichtag, wissensstand, zeilen, ...(basis.zusatzspalten ? { zusatzspalten: basis.zusatzspalten } : {}), ...(basis.waehrungssicht ? { waehrungssicht: basis.waehrungssicht } : {}) };
}

/**
 * Exitliste je Stichtag: ausgeschiedene Beteiligungen (Status Exit, Insolvent, Abgeschrieben) mit Art, Datum, Erlös (Rückflüsse und
 * Tilgungen), Multiple, IRR und offenen Kaufpreisforderungen. Art: insolvent = Insolvenz, abgeschrieben = Liquidation, Exit mit Verkauf
 * oder bei Beteiligungen = Verkauf, Exit eines Darlehens ohne Verkauf = Rückzahlung. Ein Exit nach dem Stichtag erscheint nicht.
 */
export async function ladeExitListe(tx: Abfrage, fondsId: string, stichtag: string, stand: string | undefined, wissensstand: string, ergaenzung: BerichtsErgaenzung = {}): Promise<ExitListeDaten | null> {
  const basis = await ladeFondsberichtDaten(tx, fondsId, stichtag, stand, wissensstand, ergaenzung);
  if (!basis) return null;
  // Status und Ausstiegsdatum zum Stichtag und Wissensstand kommen aus derselben Entscheidung wie in Fondsübersicht und Portfolioliste.
  const wirksam = await ermittleBeteiligungsstatus(tx, { fondsId }, basis.stichtag, stand);
  const kandidaten = basis.beteiligungen.filter((b) => b.status !== "aktiv");
  const zeilen: ExitListeDaten["zeilen"] = [];
  for (const b of kandidaten) {
    const austritt = wirksam.get(b.id)?.austritt ?? null;
    const datum = austritt?.datum ?? null;
    const darlehensartig = (b.instrumente ?? []).length > 0 ? (b.instrumente ?? []).every((i) => istDarlehensartig(i.art)) : istDarlehensartig(b.instrument);
    const art: ExitArt = b.status === "insolvent" ? "insolvenz" : b.status === "abgeschrieben" ? "liquidation" : austritt?.durchVerkauf || !darlehensartig ? "verkauf" : "rueckzahlung";
    const detail = await ladeBeteiligungDetail(tx, b.id, basis.stichtag, stand);
    zeilen.push({
      organisation: b.organisation.name,
      art,
      datum,
      investiert: new Decimal(b.investiert).toFixed(2),
      erloes: new Decimal(b.rueckfluesse).toFixed(2),
      multiple: b.multiple.wert,
      irr: detail?.kennzahlen.irr.wert ?? null,
      offeneForderungen: new Decimal(b.offeneForderungen ?? 0).toFixed(2),
      ...(b.felder ? { felder: b.felder } : {}),
      ...(b.sicht ? { sicht: b.sicht } : {}),
    });
  }
  return { fonds: basis.fonds, stichtag: basis.stichtag, wissensstand, zeilen, ...(basis.zusatzspalten ? { zusatzspalten: basis.zusatzspalten } : {}), ...(basis.waehrungssicht ? { waehrungssicht: basis.waehrungssicht } : {}) };
}

/**
 * Gremienvorlage: offene Deals in der Phase Investitionsausschuss (optional eines Fonds) mit Eckdaten, Beschlüssen,
 * Beschlussvorschlag (Text am Deal, sonst die Auflagen des jüngsten vertagten Beschlusses) und den jüngsten Aktivitäten;
 * dazu alle Beschlüsse des Quartals, in dem der Stichtag liegt (bis zum Stichtag).
 */
export async function ladeGremienDaten(tx: Abfrage, fondsId: string | null, stichtag: string, wissensstand: string, dealFilter?: SQL): Promise<GremienDaten> {
  const zeilen = await tx
    .select({
      id: deal.id,
      titel: deal.titel,
      organisation: organisation.name,
      sektor: organisation.sektor,
      ort: organisation.ort,
      fonds: fonds.name,
      ticket: deal.ticket,
      quelle: deal.quelle,
      betreuung: deal.betreuung,
      vorschlag: deal.beschlussvorschlag,
    })
    .from(deal)
    .innerJoin(organisation, eq(organisation.id, deal.organisationId))
    .leftJoin(fonds, eq(fonds.id, deal.fondsId))
    .where(and(eq(deal.phase, "investitionsausschuss"), eq(deal.status, "offen"), fondsId ? eq(deal.fondsId, fondsId) : undefined, dealFilter))
    .orderBy(asc(organisation.name), asc(deal.id));
  const beschluesse = await tx.select().from(beschluss).orderBy(asc(beschluss.datum), asc(beschluss.erstelltAm), asc(beschluss.id));
  const aktivitaeten = await tx.select().from(aktivitaet).where(lte(aktivitaet.datum, stichtag)).orderBy(desc(aktivitaet.datum), desc(aktivitaet.erstelltAm), asc(aktivitaet.id));
  const dealIds = new Set(zeilen.map((z) => z.id));
  const mapBeschluss = (b: (typeof beschluesse)[number]) => ({ gremium: b.gremium, datum: b.datum, ergebnis: b.ergebnis, betrag: b.betrag, auflagen: b.auflagen });

  const von = quartalsbeginn(stichtag);
  const imZeitraum = beschluesse.filter((b) => b.datum >= von && b.datum <= stichtag);
  const dealInfo = imZeitraum.length
    ? await tx
        .select({ id: deal.id, titel: deal.titel, organisation: organisation.name, fondsId: deal.fondsId })
        .from(deal)
        .innerJoin(organisation, eq(organisation.id, deal.organisationId))
        // Nur Deals, die die Person sehen darf, und nur die der Beschlüsse im Zeitraum.
        .where(and(inArray(deal.id, [...new Set(imZeitraum.map((b) => b.dealId))]), dealFilter))
    : [];
  const sichtbar = new Map(dealInfo.map((d) => [d.id, d]));
  return {
    stichtag,
    wissensstand,
    deals: zeilen.map((z) => {
      const eigene = beschluesse.filter((b) => b.dealId === z.id);
      const vertagt = [...eigene].reverse().find((b) => b.ergebnis === "vertagt" && b.auflagen);
      const meine = aktivitaeten.filter((a) => a.dealId === z.id);
      return {
        titel: z.titel,
        organisation: { name: z.organisation, sektor: z.sektor, ort: z.ort },
        fonds: z.fonds,
        ticket: z.ticket,
        quelle: z.quelle,
        betreuung: z.betreuung,
        beschluesse: eigene.map(mapBeschluss),
        beschlussvorschlag: z.vorschlag ? { text: z.vorschlag, quelle: "deal" as const } : vertagt?.auflagen ? { text: vertagt.auflagen, quelle: "vertagt" as const } : null,
        aktivitaeten: meine.slice(0, MAX_AKTIVITAETEN).map((a) => ({ datum: a.datum, art: a.art, titel: a.titel, notiz: a.notiz })),
        aktivitaetenGesamt: meine.length,
      };
    }),
    zeitraum: { von, bis: stichtag },
    beschluesseImZeitraum: imZeitraum
      // Ein Beschluss erscheint nur, wenn sein Deal sichtbar ist (und zum Fonds passt, falls einer gewählt ist).
      .filter((b) => {
        const info = sichtbar.get(b.dealId);
        return info !== undefined && (fondsId ? info.fondsId === fondsId || dealIds.has(b.dealId) : true);
      })
      .map((b) => {
        const info = sichtbar.get(b.dealId);
        return { ...mapBeschluss(b), deal: info?.titel ?? "–", organisation: info?.organisation ?? "–" };
      }),
  };
}
