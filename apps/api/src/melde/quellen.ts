import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import {
  beteiligung,
  beteiligungBuchhaltung,
  foerderprogramm,
  fonds,
  fondsBewegung,
  fondsMittelart,
  kennzahlDefinition,
  kennzahlWert,
  organisation,
  organisationMeldedaten,
  vorgang,
} from "@carraway/db";
import {
  kennzahlSchluessel,
  type AuswertungsEingabe,
  type BeteiligungDaten,
  type DefinitionInhalt,
  type KennzahlPunkt,
  type Mittelart,
  type KennzahlVerdichtung,
  type MeldeZeitraum,
  type VorgangZeile,
} from "@carraway/berichte";
import { Decimal, geltendeWerte, verteileAnteilig } from "@carraway/rechenkern";
import { offeneForderungen, wirksameBewertung } from "../kennzahlen/fonds";
import { ermittleBeteiligungsstatus } from "../kennzahlen/beteiligungsstatus";
import type { Tx } from "../zeitlimit";
import { ladeGeldloseIds } from "../instrumente/geldfluss";

/**
 * Laden der Daten eines Meldelaufs aus der Datenbank zu Ende des Berichtszeitraums und Wissensstand. Alles, was eine Meldung liest, kommt aus diesem
 * Modul: Beteiligungen mit Vorgängen, Bewertungen, Forderungen, Buchwertabgängen und geltenden Kennzahlenwerten. Die Auswertung selbst ist rein
 * (`packages/berichte/src/melde`). Der Wissensstand gilt für Vorgänge, Fondsbewegungen, Bewertungen, Verkäufe, Forderungen, Kennzahlen (Bestätigung)
 * und die Anlage der Beteiligung; Programme, Förder- und Buchhaltungsschlüssel (`beteiligung_buchhaltung`) und Meldedaten der Organisation haben keinen Verlauf und
 * gelten mit ihrem heutigen Stand. Die Mittelherkunft des Fonds (`fonds_mittelart`, Etappe 14) teilt jeden Vorgang nach den Quoten seines Valuta auf die Meldearten auf.
 */

type Abfrage = Pick<Tx, "select" | "execute">;

export interface LaufParameter {
  fondsId: string;
  /** Förderprogramm des Laufs (Filter über alle Abschnitte). */
  programm: { id: string; schluessel: string; bezeichnung: string } | null;
  definition: DefinitionInhalt;
  periode: MeldeZeitraum;
  /** Wissensstand als ISO-Zeitstempel. */
  stand: string;
  manuell: Record<string, string | null>;
}

interface Zuordnung {
  programm: { schluessel: string; bezeichnung: string } | null;
  projektnummer: string | null;
  vertragsnummer: string | null;
  partnernummer: string | null;
  buchungskreis: string | null;
  sitzland: string | null;
  region: string | null;
}

/**
 * Förder- und Buchhaltungsschlüssel je Beteiligung (Förderprogramm, Projekt-, Vertrags-, Partnernummer, Buchungskreis) aus `beteiligung_buchhaltung` und Sitzland und
 * Region je Organisation aus `organisation_meldedaten`. Die einzige Stelle, die diese Felder für die Meldungen liest.
 */
export async function ladeZuordnungen(tx: Abfrage, beteiligungIds: string[], organisationIds: string[]): Promise<{ beteiligung: Map<string, Omit<Zuordnung, "sitzland" | "region">>; organisation: Map<string, { sitzland: string | null; region: string | null }> }> {
  const bet = new Map<string, Omit<Zuordnung, "sitzland" | "region">>();
  if (beteiligungIds.length) {
    const zeilen = await tx
      .select({ z: beteiligungBuchhaltung, schluessel: foerderprogramm.schluessel, bezeichnung: foerderprogramm.bezeichnung })
      .from(beteiligungBuchhaltung)
      .leftJoin(foerderprogramm, eq(foerderprogramm.id, beteiligungBuchhaltung.foerderprogrammId))
      .where(inArray(beteiligungBuchhaltung.beteiligungId, beteiligungIds));
    for (const { z, schluessel, bezeichnung } of zeilen) {
      bet.set(z.beteiligungId, {
        programm: schluessel && bezeichnung ? { schluessel, bezeichnung } : null,
        projektnummer: z.projektnummer,
        vertragsnummer: z.vertragsnummer,
        partnernummer: z.partnernummer,
        buchungskreis: z.buchungskreis,
      });
    }
  }
  const org = new Map<string, { sitzland: string | null; region: string | null }>();
  if (organisationIds.length) {
    const zeilen = await tx.select().from(organisationMeldedaten).where(inArray(organisationMeldedaten.organisationId, organisationIds));
    for (const z of zeilen) org.set(z.organisationId, { sitzland: z.sitzland, region: z.region });
  }
  return { beteiligung: bet, organisation: org };
}

type AnteileJeArt = Partial<Record<Mittelart, string>>;

/**
 * Mittelherkunft des Fonds für die Meldungen: Teilt Beträge nach den Quoten der Mittelarten am Valuta auf die Meldearten auf (größter Rest, auf den Cent, wie bei den
 * Belegen) und liefert die Summe der Quoten je Meldeart zum Stichtag. Mittelarten ohne Meldeart zählen in keiner Kategorie.
 */
export async function ladeMittelherkunft(tx: Abfrage, fondsId: string, stichtag: string) {
  const arten = await tx.select().from(fondsMittelart).where(eq(fondsMittelart.fondsId, fondsId)).orderBy(asc(fondsMittelart.schluessel), asc(fondsMittelart.gueltigAb));
  const gueltigAm = (datum: string) => arten.filter((a) => a.gueltigAb <= datum && (a.gueltigBis === null || a.gueltigBis >= datum));
  const anteile = (valuta: string, betrag: string): AnteileJeArt | undefined => {
    const aktiv = gueltigAm(valuta);
    if (aktiv.length === 0 || aktiv.every((a) => new Decimal(a.quote).isZero())) return undefined;
    const teile = verteileAnteilig(betrag, aktiv.map((a) => a.quote));
    const aus: Record<string, Decimal> = {};
    aktiv.forEach((a, i) => {
      if (a.meldeArt) aus[a.meldeArt] = (aus[a.meldeArt] ?? new Decimal(0)).plus(teile[i]!);
    });
    return Object.fromEntries(Object.entries(aus).map(([k, w]) => [k, w.toFixed(2)])) as AnteileJeArt;
  };
  const quoten: AnteileJeArt = {};
  for (const a of gueltigAm(stichtag)) if (a.meldeArt) quoten[a.meldeArt] = new Decimal(quoten[a.meldeArt] ?? 0).plus(a.quote).toString();
  return { anteile, quoten };
}

/** Verdichtung (Summe, Stand, Durchschnitt) der Katalogkennzahlen: die neueste Katalogversion je Schlüssel. */
async function ladeVerdichtung(tx: Abfrage, schluessel: string[]): Promise<Record<string, KennzahlVerdichtung>> {
  if (schluessel.length === 0) return {};
  const zeilen = await tx.select({ s: kennzahlDefinition.schluessel, a: kennzahlDefinition.aggregation, v: kennzahlDefinition.katalogVersion }).from(kennzahlDefinition).where(inArray(kennzahlDefinition.schluessel, schluessel));
  const aus: Record<string, { a: KennzahlVerdichtung; v: number }> = {};
  for (const z of zeilen) if (!aus[z.s] || aus[z.s]!.v < z.v) aus[z.s] = { a: z.a, v: z.v };
  return Object.fromEntries(Object.entries(aus).map(([k, v]) => [k, v.a]));
}

export async function ladeAuswertungsEingabe(tx: Abfrage, p: LaufParameter): Promise<AuswertungsEingabe> {
  const { fondsId, periode, stand } = p;
  const [f] = await tx.select().from(fonds).where(eq(fonds.id, fondsId));
  if (!f) throw new Error("Fonds nicht gefunden");
  const bewegungen = (
    await tx
      .select({ id: fondsBewegung.id, art: fondsBewegung.art, valuta: fondsBewegung.valuta, betrag: fondsBewegung.betrag })
      .from(fondsBewegung)
      .where(and(eq(fondsBewegung.fondsId, fondsId), lte(fondsBewegung.valuta, periode.ende), sql`${fondsBewegung.erfasstAm} <= ${stand}::timestamptz`))
  ).map((b) => ({ ...b, betrag: b.betrag }));

  const roh = await tx
    .select({ b: beteiligung, o: organisation })
    .from(beteiligung)
    .innerJoin(organisation, eq(organisation.id, beteiligung.organisationId))
    .where(and(eq(beteiligung.fondsId, fondsId), lte(beteiligung.erstinvestment, periode.ende), sql`${beteiligung.erstelltAm} <= ${stand}::timestamptz`))
    .orderBy(organisation.name, beteiligung.id);
  const ids = roh.map((r) => r.b.id);
  const zuordnungen = await ladeZuordnungen(tx, ids, [...new Set(roh.map((r) => r.o.id))]);

  // Vorgänge bis zum Ende des Zeitraums und zum Wissensstand
  const herkunft = await ladeMittelherkunft(tx, fondsId, periode.ende);
  const vorgaenge = new Map<string, VorgangZeile[]>();
  if (ids.length) {
    const zeilen = await tx
      .select({ id: vorgang.id, beteiligungId: vorgang.beteiligungId, art: vorgang.art, valuta: vorgang.valuta, betrag: vorgang.betrag, kapitalisiert: vorgang.kapitalisiert, storniertVorgangId: vorgang.storniertVorgangId })
      .from(vorgang)
      .where(and(inArray(vorgang.beteiligungId, ids), lte(vorgang.valuta, periode.ende), sql`${vorgang.erfasstAm} <= ${stand}::timestamptz`))
      .orderBy(vorgang.valuta, vorgang.id);
    // Ein Storno trägt die negierten Anteile seines Originals (die Quoten können sich zwischen beiden Valuta geändert haben).
    const geldlose = await ladeGeldloseIds(tx, { fondsId });
    const eigene = new Map<string, AnteileJeArt | undefined>();
    for (const z of zeilen) if (!z.storniertVorgangId) eigene.set(z.id, herkunft.anteile(z.valuta, z.betrag));
    const negiert = (a: AnteileJeArt | undefined): AnteileJeArt | undefined => (a ? (Object.fromEntries(Object.entries(a).map(([k, w]) => [k, new Decimal(w).neg().toFixed(2)])) as AnteileJeArt) : undefined);
    for (const z of zeilen) {
      const liste = vorgaenge.get(z.beteiligungId) ?? [];
      const anteile = z.storniertVorgangId && eigene.has(z.storniertVorgangId) ? negiert(eigene.get(z.storniertVorgangId)) : (eigene.get(z.id) ?? herkunft.anteile(z.valuta, z.betrag));
      liste.push({ id: z.id, art: z.art, valuta: z.valuta, betrag: z.betrag, kapitalisiert: z.kapitalisiert, storniertVorgangId: z.storniertVorgangId, ...(geldlose.has(z.id) ? { ohneGeldfluss: true } : {}), ...(anteile ? { anteile } : {}) });
      vorgaenge.set(z.beteiligungId, liste);
    }
  }

  // Letzte wirksame Bewertung je Beteiligung bis zum Stichtag, Forderungen, Buchwertabgang
  const bewertungen = new Map<string, { wert: string; stichtag: string }>();
  const abgaenge = new Map<string, string>();
  const forderungen = new Map<string, string>();
  if (ids.length) {
    const { rows } = await tx.execute<{ beteiligung_id: string; wert: string; stichtag: string }>(sql`
      SELECT DISTINCT ON (w.beteiligung_id) w.beteiligung_id, w.wert::text AS wert, w.stichtag::text AS stichtag
      FROM bewertung w
      WHERE w.beteiligung_id IN (SELECT id FROM beteiligung WHERE fonds_id = ${fondsId}) AND w.stichtag <= ${periode.ende}::date AND ${wirksameBewertung("w", stand)}
      ORDER BY w.beteiligung_id, w.stichtag DESC, w.erfasst_am DESC, w.id`);
    for (const r of rows) bewertungen.set(r.beteiligung_id, { wert: r.wert, stichtag: r.stichtag });
    for (const r of await offeneForderungen(tx, { fondsId }, periode.ende, stand)) forderungen.set(r.beteiligung_id, r.summe);
    // Buchwertabgang früherer Teilverkäufe: bis zum Stichtag und Wissensstand erfasst, nicht storniert (oder erst nach dem Wissensstand storniert)
    const { rows: verkaeufe } = await tx.execute<{ beteiligung_id: string; summe: string }>(sql`
      SELECT v.beteiligung_id, sum(v.buchwert_abgang)::text AS summe
      FROM verkauf v JOIN beteiligung b ON b.id = v.beteiligung_id
      WHERE b.fonds_id = ${fondsId} AND v.datum <= ${periode.ende}::date AND v.erfasst_am <= ${stand}::timestamptz AND (v.storniert_am IS NULL OR v.storniert_am > ${stand}::timestamptz)
      GROUP BY v.beteiligung_id`);
    for (const r of verkaeufe) abgaenge.set(r.beteiligung_id, r.summe);
  }

  // Kennzahlen: geltende bestätigte Werte (Ist und Plan) der gelesenen Schlüssel
  const gelesen = [...new Set(kennzahlSchluessel(p.definition).map((k) => k.schluessel))];
  const punkte = new Map<string, KennzahlPunkt[]>();
  if (ids.length && gelesen.length) {
    const zeilen = await tx
      .select({ w: kennzahlWert, schluessel: kennzahlDefinition.schluessel })
      .from(kennzahlWert)
      .innerJoin(kennzahlDefinition, eq(kennzahlDefinition.id, kennzahlWert.definitionId))
      .where(and(inArray(kennzahlWert.beteiligungId, ids), inArray(kennzahlDefinition.schluessel, gelesen), eq(kennzahlWert.status, "bestaetigt"), inArray(kennzahlWert.szenario, ["ist", "plan"]), lte(kennzahlWert.periodeEnde, periode.ende)));
    const nachBeteiligung = new Map<string, typeof zeilen>();
    for (const z of zeilen) nachBeteiligung.set(z.w.beteiligungId, [...(nachBeteiligung.get(z.w.beteiligungId) ?? []), z]);
    for (const [bid, liste] of nachBeteiligung) {
      const geltend = geltendeWerte(
        liste.map((z) => ({ id: z.w.id, schluessel: z.schluessel, periodeBeginn: z.w.periodeBeginn, periodeEnde: z.w.periodeEnde, szenario: z.w.szenario, wert: z.w.wert, status: z.w.status, bestaetigtAm: z.w.bestaetigtAm, folge: z.w.folge })),
        stand,
      );
      punkte.set(
        bid,
        [...geltend.values()].map((g) => ({ id: g.id, schluessel: g.schluessel, szenario: g.szenario as "ist" | "plan", periodeBeginn: g.periodeBeginn, periodeEnde: g.periodeEnde, wert: g.wert })),
      );
    }
  }

  // Status und Ausscheiden zum Ende des Zeitraums und zum Wissensstand: dieselbe Entscheidung wie in Fondsübersicht und Exitliste.
  const wirksam = await ermittleBeteiligungsstatus(tx, { fondsId }, periode.ende, stand);
  const beteiligungen: BeteiligungDaten[] = roh.map(({ b, o }) => {
    const w = wirksam.get(b.id);
    const status = w?.status ?? b.status;
    const z = zuordnungen.beteiligung.get(b.id);
    const m = zuordnungen.organisation.get(o.id);
    const eigene = vorgaenge.get(b.id) ?? [];
    return {
      id: b.id,
      organisationId: o.id,
      organisationName: o.name,
      sektor: o.sektor,
      nace: o.naceAbschnitt,
      ort: o.ort,
      sitzland: m?.sitzland ?? null,
      region: m?.region ?? null,
      instrument: b.instrument,
      status,
      erstinvestment: b.erstinvestment,
      programm: z?.programm ?? null,
      projektnummer: z?.projektnummer ?? null,
      vertragsnummer: z?.vertragsnummer ?? null,
      partnernummer: z?.partnernummer ?? null,
      buchungskreis: z?.buchungskreis ?? null,
      vorgaenge: eigene,
      bewertung: bewertungen.get(b.id) ?? null,
      // Wie die Fondsübersicht: Status Exit zum Stichtag und Wissensstand, mit Rückfluss bis zum Stichtag oder durch Verkauf
      ausgeschieden: status === "exit" && (eigene.some((v) => v.art === "rueckfluss" && Number(v.betrag) > 0) || w?.austritt?.durchVerkauf === true),
      offeneForderungen: forderungen.get(b.id) ?? "0.00",
      buchwertAbgang: abgaenge.get(b.id) ?? "0.00",
      kennzahlen: punkte.get(b.id) ?? [],
    };
  });

  const programme = await tx.select({ schluessel: foerderprogramm.schluessel, bezeichnung: foerderprogramm.bezeichnung }).from(foerderprogramm);
  return {
    definition: p.definition,
    fonds: { name: f.name, kurzname: f.kurzname, vintage: f.vintage, zeichnungskapital: f.zeichnungskapital, waehrung: f.waehrung, bewegungen },
    programm: p.programm ? { schluessel: p.programm.schluessel, bezeichnung: p.programm.bezeichnung } : null,
    periode: { beginn: periode.beginn, ende: periode.ende, kennung: periode.kennung },
    beteiligungen,
    mittelartQuoten: herkunft.quoten,
    programme,
    kennzahlVerdichtung: await ladeVerdichtung(tx, gelesen),
    manuell: p.manuell,
  };
}

