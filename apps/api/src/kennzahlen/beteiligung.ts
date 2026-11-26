import { sql } from "drizzle-orm";
import { Decimal, beteiligungsMultiple, istRueckfluss, xirr, type Rechenschritt, type Zahlungsstrom } from "@carraway/rechenkern";
import { bisStand, offeneForderungen, standardStichtag, wirksameBewertung, type Kennzahl } from "./fonds";
import { ladeInstrumentUebersicht } from "../instrumente/instrumente";
import { ladeGeldloseIds } from "../instrumente/geldfluss";
import { ermittleBeteiligungsstatus } from "./beteiligungsstatus";
import type { Tx } from "../zeitlimit";

/**
 * Detailsicht einer Beteiligung zu einem Stichtag und Wissensstand: Stammdaten, Vorgänge (Storno-Paare markiert),
 * Bewertungsverlauf, Finanzierungsrunden mit Positionen und Kennzahlen mit Herkunft.
 * Vorgänge und Runden reichen bis zum Stichtag (damit ein früherer Stichtag reproduzierbar bleibt),
 * der Bewertungsverlauf zeigt alle Stichtage.
 */

type Abfrage = Pick<Tx, "execute">;

export interface VorgangZeile {
  id: string;
  art: string;
  valuta: string;
  betrag: string;
  bemerkung: string | null;
  erfasstAm: string;
  /** Verweis auf den stornierten Vorgang, wenn dieser Vorgang ein Storno ist. */
  storniertVorgangId: string | null;
  istStorno: boolean;
  /** Dieser Vorgang wurde durch einen Storno aufgehoben. */
  storniert: boolean;
  /** Der aufhebende Storno-Vorgang (falls `storniert`). */
  stornoVorgangId: string | null;
  /** Das Instrument, auf dem der Vorgang bucht (Portfolio-Modell), mit seiner Bezeichnung. */
  instrumentId: string | null;
  instrumentBezeichnung: string | null;
  /** Die Tranche, auf die eine Auszahlung gebucht ist. */
  trancheId: string | null;
  /** Die Finanzierungsrunde, der der Vorgang zugeordnet ist (`vorgang_runde`); `null`, wenn keiner Runde zugeordnet. */
  runde: { id: string; bezeichnung: string; art: string; datum: string } | null;
  /** Nur bei Zinsbuchungen: dem Darlehenskapital zugeschlagen. */
  kapitalisiert: boolean;
  /** Nur bei Zinszahlungen: die Zinsbuchung, die der Geldeingang begleicht. */
  beglichenVorgangId: string | null;
  /** Buchung einer Wandlung ohne Geldfluss (Tilgung durch Wandlung, Zusage und Einlage des Ziels): zählt nicht zu Investiert und Rückflüssen. */
  ohneGeldfluss: boolean;
}

export interface BewertungZeile {
  stichtag: string;
  wert: string;
  methode: string;
  begruendung: string | null;
  erfasstAm: string;
}

export interface RundenPositionZeile {
  id: string;
  investor: { art: "fonds" | "organisation"; id: string; name: string };
  /** Vehikel einer Position Dritter (der Investor steht in `investor`); bei Fonds `null`. */
  vehikel: { id: string; name: string } | null;
  betrag: string;
  anteile: string;
  rolle: "lead" | "co_lead" | "co";
  /** Die Position gehört zum Fonds dieser Beteiligung. */
  diesesFonds: boolean;
}

export interface RundeZeile {
  id: string;
  bezeichnung: string;
  datum: string;
  preMoney: string;
  postMoney: string;
  preisJeAnteil: string;
  anteileGesamtNach: string;
  positionen: RundenPositionZeile[];
}

export interface BeteiligungDetail {
  stichtag: string;
  /** Wissensstand der Abfrage (ISO), `null` = aktueller Stand. */
  stand: string | null;
  beteiligung: { id: string; instrument: string; erstinvestment: string; status: string; erstelltAm: string };
  organisation: { id: string; name: string; art: string; sektor: string | null; ort: string | null; website: string | null };
  fonds: { id: string; name: string; kurzname: string; waehrung: string };
  deal: { id: string; titel: string; phase: string; status: string } | null;
  vorgaenge: VorgangZeile[];
  bewertungsverlauf: BewertungZeile[];
  runden: RundeZeile[];
  /** Je Instrument der Beteiligung zu Stichtag und Wissensstand (siehe `ladeInstrumentUebersicht`). */
  instrumente: NonNullable<Awaited<ReturnType<typeof ladeInstrumentUebersicht>>>;
  kennzahlen: { investiert: Kennzahl; rueckfluesse: Kennzahl; bewertung: Kennzahl; multiple: Kennzahl; irr: Kennzahl };
}

type StammRoh = {
  id: string;
  fonds_id: string;
  organisation_id: string;
  deal_id: string | null;
  instrument: string;
  erstinvestment: string;
  status: string;
  erstellt_am: string;
  o_name: string;
  o_art: string;
  o_sektor: string | null;
  o_ort: string | null;
  o_website: string | null;
  f_name: string;
  f_kurzname: string;
  f_waehrung: string;
  d_titel: string | null;
  d_phase: string | null;
  d_status: string | null;
};

type VorgangRoh = {
  id: string;
  art: string;
  valuta: string;
  betrag: string;
  bemerkung: string | null;
  erfasst_am: string;
  storniert_vorgang_id: string | null;
  instrument_id: string | null;
  instrument_bezeichnung: string | null;
  tranche_id: string | null;
  kapitalisiert: boolean;
  beglichen_vorgang_id: string | null;
  runde_id: string | null;
  runde_bezeichnung: string | null;
  runde_art: string | null;
  runde_datum: string | null;
};
type BewertungRoh = { stichtag: string; wert: string; methode: string; begruendung: string | null; erfasst_am: string };
type PositionRoh = {
  runde_id: string;
  id: string;
  fonds_id: string | null;
  organisation_id: string | null;
  investor_name: string;
  vehikel_id: string | null;
  vehikel_name: string | null;
  betrag: string;
  anteile: string;
  rolle: "lead" | "co_lead" | "co";
};
type RundeRoh = { id: string; bezeichnung: string; datum: string; pre_money: string; post_money: string; preis_je_anteil: string; anteile_gesamt_nach: string };

const iso = (wert: unknown) => new Date(wert as string).toISOString();
const NICHT_DEFINIERT = "nicht definiert";

/**
 * Finanzierungsrunden eines Unternehmens mit Positionen, aufsteigend nach Datum. `bis` schneidet nach Rundendatum
 * (`null` = alle Runden, z. B. für die Wahl der Zielrunde einer Wandlung, die auch nach dem Stichtag liegen darf).
 */
export async function ladeRunden(tx: Abfrage, organisationId: string, fondsId: string, bis: string | null): Promise<RundeZeile[]> {
  const bisBedingung = bis === null ? sql`` : sql` AND datum <= ${bis}::date`;
  const { rows: rundeRoh } = await tx.execute<RundeRoh>(sql`
    SELECT id, bezeichnung, datum::text AS datum, pre_money::text AS pre_money, post_money::text AS post_money,
           preis_je_anteil::text AS preis_je_anteil, anteile_gesamt_nach::text AS anteile_gesamt_nach
    FROM finanzierungsrunde
    WHERE organisation_id = ${organisationId} AND status = 'abgeschlossen' AND art = 'eigenkapital'${bisBedingung}
    ORDER BY datum, id`);
  const { rows: positionRoh } =
    rundeRoh.length === 0
      ? { rows: [] as PositionRoh[] }
      : await tx.execute<PositionRoh>(sql`
          SELECT p.runde_id, p.id, p.fonds_id, v.investor_id AS organisation_id, coalesce(pf.name, po.name) AS investor_name, v.id AS vehikel_id, v.name AS vehikel_name,
                 p.betrag::text AS betrag, p.anteile::text AS anteile, p.rolle::text AS rolle
          FROM rundenposition p
          JOIN finanzierungsrunde r ON r.id = p.runde_id
          LEFT JOIN fonds pf ON pf.id = p.fonds_id
          LEFT JOIN vehikel v ON v.id = p.vehikel_id
          LEFT JOIN organisation po ON po.id = v.investor_id
          WHERE r.organisation_id = ${organisationId} AND r.status = 'abgeschlossen' AND r.art = 'eigenkapital'${bis === null ? sql`` : sql` AND r.datum <= ${bis}::date`}
          ORDER BY p.rolle, p.betrag DESC, p.id`);
  const positionenJeRunde = new Map<string, RundenPositionZeile[]>();
  for (const p of positionRoh) {
    const liste = positionenJeRunde.get(p.runde_id) ?? [];
    liste.push({
      id: p.id,
      investor: p.fonds_id ? { art: "fonds", id: p.fonds_id, name: p.investor_name } : { art: "organisation", id: p.organisation_id as string, name: p.investor_name },
      vehikel: p.vehikel_id ? { id: p.vehikel_id, name: p.vehikel_name ?? "" } : null,
      betrag: p.betrag,
      anteile: p.anteile,
      rolle: p.rolle,
      diesesFonds: p.fonds_id === fondsId,
    });
    positionenJeRunde.set(p.runde_id, liste);
  }
  const reihenfolge = { lead: 0, co_lead: 1, co: 2 } as const;
  return rundeRoh.map((r) => ({
    id: r.id,
    bezeichnung: r.bezeichnung,
    datum: r.datum,
    preMoney: r.pre_money,
    postMoney: r.post_money,
    preisJeAnteil: r.preis_je_anteil,
    anteileGesamtNach: r.anteile_gesamt_nach,
    positionen: (positionenJeRunde.get(r.id) ?? []).sort((x, y) => reihenfolge[x.rolle] - reihenfolge[y.rolle] || new Decimal(y.betrag).cmp(x.betrag)),
  }));
}

/** `null`, wenn es die Beteiligung nicht gibt. */
export async function ladeBeteiligungDetail(tx: Abfrage, id: string, stichtagVorgabe?: string, stand?: string): Promise<BeteiligungDetail | null> {
  const { rows: stamm } = await tx.execute<StammRoh>(sql`
    SELECT b.id, b.fonds_id, b.organisation_id, b.deal_id, b.instrument::text AS instrument, b.erstinvestment::text AS erstinvestment,
           b.status::text AS status, (to_json(b.erstellt_am) #>> '{}') AS erstellt_am,
           o.name AS o_name, o.art::text AS o_art, o.sektor AS o_sektor, o.ort AS o_ort, o.website AS o_website,
           f.name AS f_name, f.kurzname AS f_kurzname, f.waehrung AS f_waehrung,
           d.titel AS d_titel, d.phase::text AS d_phase, d.status::text AS d_status
    FROM beteiligung b
    JOIN organisation o ON o.id = b.organisation_id
    JOIN fonds f ON f.id = b.fonds_id
    LEFT JOIN deal d ON d.id = b.deal_id
    WHERE b.id = ${id}`);
  const b = stamm[0];
  if (!b) return null;

  const stichtag = stichtagVorgabe ?? (await standardStichtag(tx, b.fonds_id, stand));

  const { rows: vorgangRoh } = await tx.execute<VorgangRoh>(sql`
    SELECT v.id, CASE WHEN v.verzicht_id IS NOT NULL AND v.art = 'tilgung' THEN 'principal_waiver' ELSE v.art::text END AS art, v.valuta::text AS valuta, v.betrag::text AS betrag, v.bemerkung, (to_json(v.erfasst_am) #>> '{}') AS erfasst_am, v.storniert_vorgang_id,
           v.instrument_id, i.bezeichnung AS instrument_bezeichnung, v.tranche_id, v.kapitalisiert, v.beglichen_vorgang_id,
           fr.id AS runde_id, fr.bezeichnung AS runde_bezeichnung, fr.art::text AS runde_art, fr.datum::text AS runde_datum
    FROM vorgang v
    LEFT JOIN instrument i ON i.id = v.instrument_id
    LEFT JOIN vorgang_runde vr ON vr.vorgang_id = v.id
    LEFT JOIN finanzierungsrunde fr ON fr.id = vr.runde_id
    WHERE v.beteiligung_id = ${id} AND v.valuta <= ${stichtag}::date${bisStand(sql.raw("v.erfasst_am"), stand)}
    ORDER BY v.valuta,
      CASE v.art WHEN 'zusage' THEN 0 WHEN 'auszahlung' THEN 1 WHEN 'zins' THEN 2 WHEN 'zinszahlung' THEN 3 WHEN 'dividende' THEN 4
                 WHEN 'tilgung' THEN 5 WHEN 'rueckfluss' THEN 6 WHEN 'wertberichtigung' THEN 7 ELSE 8 END,
      v.erfasst_am, v.id`);

  const { rows: bewertungRoh } = await tx.execute<BewertungRoh>(sql`
    SELECT w.stichtag::text AS stichtag, w.wert::text AS wert, w.methode::text AS methode, w.begruendung, (to_json(w.erfasst_am) #>> '{}') AS erfasst_am
    FROM bewertung w
    WHERE w.beteiligung_id = ${id} AND ${wirksameBewertung("w", stand)}
    ORDER BY w.stichtag`);

  // Buchungen einer Wandlung ohne Geldfluss: gehören nicht in Investiert, Rückflüsse und Zahlungsstrom (Position und Buchwert bleiben unberührt).
  const geldlos = await ladeGeldloseIds(tx, { beteiligungId: id });

  // Storno-Paare markieren.
  const stornoZu = new Map<string, string>();
  for (const v of vorgangRoh) if (v.storniert_vorgang_id) stornoZu.set(v.storniert_vorgang_id, v.id);
  const vorgaenge: VorgangZeile[] = vorgangRoh.map((v) => ({
    id: v.id,
    art: v.art,
    valuta: v.valuta,
    betrag: v.betrag,
    bemerkung: v.bemerkung,
    erfasstAm: iso(v.erfasst_am),
    storniertVorgangId: v.storniert_vorgang_id,
    istStorno: v.storniert_vorgang_id !== null,
    storniert: stornoZu.has(v.id),
    stornoVorgangId: stornoZu.get(v.id) ?? null,
    instrumentId: v.instrument_id,
    instrumentBezeichnung: v.instrument_bezeichnung,
    trancheId: v.tranche_id,
    runde: v.runde_id && v.runde_bezeichnung && v.runde_art && v.runde_datum ? { id: v.runde_id, bezeichnung: v.runde_bezeichnung, art: v.runde_art, datum: v.runde_datum } : null,
    kapitalisiert: v.kapitalisiert,
    beglichenVorgangId: v.beglichen_vorgang_id,
    ohneGeldfluss: geldlos.has(v.id),
  }));

  // Kennzahlen -------------------------------------------------------------------------------------------------
  const summe = (zeilen: VorgangRoh[]) => zeilen.reduce((s, v) => s.plus(v.betrag), new Decimal(0));
  const auszahlungen = vorgangRoh.filter((v) => v.art === "auszahlung" && !geldlos.has(v.id));
  // Rückflüsse: Erlös, Tilgung, gezahlte Zinsen und Dividenden; eine Zinsbuchung (`zins`) ist nur eine Forderung und zählt nie.
  // Die Tilgung durch Wandlung ist kein Geld; der bar ausgezahlte Spitzenbetrag zählt.
  const rueckfluesse = vorgangRoh.filter((v) => istRueckfluss(v.art) && !geldlos.has(v.id));
  const ohneGeld = vorgangRoh.filter((v) => (v.art === "auszahlung" || istRueckfluss(v.art)) && geldlos.has(v.id));
  const investiert = summe(auszahlungen);
  const rueck = summe(rueckfluesse);
  const stornoPaare = vorgangRoh.filter((v) => v.storniert_vorgang_id !== null).length;

  const letzteBewertung = [...bewertungRoh].reverse().find((w) => w.stichtag <= stichtag) ?? null;
  const wirksam = (await ermittleBeteiligungsstatus(tx, { beteiligungId: id }, stichtag, stand)).get(id);
  const status = wirksam?.status ?? b.status;
  const ausgeschieden = status === "exit" && (vorgangRoh.some((v) => v.art === "rueckfluss" && new Decimal(v.betrag).gt(0)) || wirksam?.austritt?.durchVerkauf === true);
  const offeneForderung = new Decimal((await offeneForderungen(tx, { beteiligungId: id }, stichtag, stand))[0]?.summe ?? 0);
  const bewertetWert = ausgeschieden || letzteBewertung === null ? new Decimal(0) : new Decimal(letzteBewertung.wert);
  // Offene Kaufpreisforderungen zählen zum Wertansatz (wie beim NAV des Fonds).
  const bewertungWert = bewertetWert.plus(offeneForderung);

  const kInvestiert: Kennzahl = {
    wert: investiert.toString(),
    schritte: [
      { zeichen: "", bezeichnung: "Auszahlungen bis zum Stichtag (Anzahl, inklusive Stornos)", wert: String(auszahlungen.length), quellen: auszahlungen.map((v) => v.id) },
      { zeichen: "", bezeichnung: "davon Stornobuchungen", wert: String(auszahlungen.filter((v) => v.storniert_vorgang_id).length) },
      ...(ohneGeld.some((v) => v.art === "auszahlung")
        ? [{ zeichen: "" as const, bezeichnung: "Einlagen aus Wandlung (kein Geldfluss, nicht gezählt, Anzahl)", wert: String(ohneGeld.filter((v) => v.art === "auszahlung").length), quellen: ohneGeld.filter((v) => v.art === "auszahlung").map((v) => v.id) }]
        : []),
      { zeichen: "=", bezeichnung: "Investiertes Kapital (Summe der Auszahlungen nach Storno)", wert: investiert.toString() },
    ],
  };
  const kRueck: Kennzahl = {
    wert: rueck.toString(),
    schritte: [
      { zeichen: "", bezeichnung: "Rückflüsse, Tilgungen, gezahlte Zinsen und Dividenden bis zum Stichtag (Anzahl)", wert: String(rueckfluesse.length), quellen: rueckfluesse.map((v) => v.id) },
      ...(ohneGeld.some((v) => v.art !== "auszahlung")
        ? [{ zeichen: "" as const, bezeichnung: "Tilgungen durch Wandlung (kein Geldfluss, nicht gezählt, Anzahl)", wert: String(ohneGeld.filter((v) => v.art !== "auszahlung").length), quellen: ohneGeld.filter((v) => v.art !== "auszahlung").map((v) => v.id) }]
        : []),
      { zeichen: "=", bezeichnung: "Rückflüsse kumuliert (inkl. gezahlter Zinsen und Dividenden)", wert: rueck.toString() },
    ],
  };
  const bewertungSchritte: Rechenschritt[] = ausgeschieden
    ? [
        { zeichen: "", bezeichnung: "Beteiligung mit Rückfluss ausgeschieden (Status Exit)", wert: "0" },
        { zeichen: "=", bezeichnung: "Bewertung zum Stichtag", wert: "0" },
      ]
    : letzteBewertung === null
      ? [{ zeichen: "=", bezeichnung: "Keine Bewertung bis zum Stichtag", wert: "0" }]
      : [
          { zeichen: "", bezeichnung: `Letzte Bewertung am ${letzteBewertung.stichtag} (${letzteBewertung.methode})`, wert: letzteBewertung.wert },
          { zeichen: "=", bezeichnung: "Bewertung zum Stichtag", wert: bewertetWert.toString() },
        ];
  if (!offeneForderung.isZero()) {
    // Das Ergebnis steht dann nach den offenen Forderungen.
    const letzter = bewertungSchritte[bewertungSchritte.length - 1]!;
    bewertungSchritte[bewertungSchritte.length - 1] = { ...letzter, zeichen: "" };
    bewertungSchritte.push({ zeichen: "+", bezeichnung: "Offene Kaufpreisforderungen", wert: offeneForderung.toString() });
    bewertungSchritte.push({ zeichen: "=", bezeichnung: "Bewertung zum Stichtag (mit Forderungen)", wert: bewertungWert.toString() });
  }
  const kBewertung: Kennzahl = { wert: bewertungWert.toString(), schritte: bewertungSchritte };

  const multiple = beteiligungsMultiple(investiert, rueck, bewertungWert);
  const kMultiple: Kennzahl = { wert: multiple.wert === null ? null : multiple.wert.toString(), schritte: multiple.schritte };

  // IRR: gültige Auszahlungen als Abflüsse, Rückflüsse als Zuflüsse, Bewertung als Endwert am Stichtag. Ein Storno
  // und sein Original heben sich auf und gehen nicht in den Zahlungsstrom ein.
  const aufgehoben = new Set<string>();
  for (const v of vorgangRoh) {
    if (!v.storniert_vorgang_id) continue;
    aufgehoben.add(v.id);
    aufgehoben.add(v.storniert_vorgang_id);
  }
  const strom: Zahlungsstrom[] = [];
  for (const v of vorgangRoh) {
    if (aufgehoben.has(v.id) || geldlos.has(v.id)) continue;
    if (v.art === "auszahlung") strom.push({ datum: v.valuta, betrag: new Decimal(v.betrag).neg() });
    else if (istRueckfluss(v.art)) strom.push({ datum: v.valuta, betrag: v.betrag });
  }
  strom.push({ datum: stichtag, betrag: bewertungWert });
  const irr = xirr(strom);
  const abfluesse = strom.filter((z) => new Decimal(z.betrag).lt(0));
  const kIrr: Kennzahl = {
    wert: irr === null ? null : irr.toString(),
    schritte: [
      { zeichen: "−", bezeichnung: `Auszahlungen (${abfluesse.length} Zahlungen, ohne aufgehobene Paare)`, wert: abfluesse.reduce((s, z) => s.plus(new Decimal(z.betrag).neg()), new Decimal(0)).toString() },
      { zeichen: "+", bezeichnung: `Rückflüsse inkl. gezahlter Zinsen und Dividenden (${rueckfluesse.length - rueckfluesse.filter((v) => aufgehoben.has(v.id)).length} Zahlungen)`, wert: rueck.toString() },
      { zeichen: "+", bezeichnung: `Bewertung als Endwert am ${stichtag}`, wert: bewertungWert.toString() },
      { zeichen: "", bezeichnung: "Aufgehobene Storno-Paare (nicht im Zahlungsstrom)", wert: String(stornoPaare) },
      { zeichen: "=", bezeichnung: "IRR der Beteiligung (XIRR, act/365)", wert: irr === null ? NICHT_DEFINIERT : irr.toString() },
    ],
  };

  const runden = await ladeRunden(tx, b.organisation_id, b.fonds_id, stichtag);

  return {
    stichtag,
    stand: stand === undefined ? null : new Date(stand).toISOString(),
    beteiligung: { id: b.id, instrument: b.instrument, erstinvestment: b.erstinvestment, status, erstelltAm: iso(b.erstellt_am) },
    organisation: { id: b.organisation_id, name: b.o_name, art: b.o_art, sektor: b.o_sektor, ort: b.o_ort, website: b.o_website },
    fonds: { id: b.fonds_id, name: b.f_name, kurzname: b.f_kurzname, waehrung: b.f_waehrung },
    deal: b.deal_id && b.d_titel && b.d_phase && b.d_status ? { id: b.deal_id, titel: b.d_titel, phase: b.d_phase, status: b.d_status } : null,
    vorgaenge,
    bewertungsverlauf: bewertungRoh.map((w) => ({ stichtag: w.stichtag, wert: w.wert, methode: w.methode, begruendung: w.begruendung, erfasstAm: iso(w.erfasst_am) })),
    runden,
    instrumente: (await ladeInstrumentUebersicht(tx as Tx, id, { stichtag, ...(stand === undefined ? {} : { stand }) })) ?? [],
    kennzahlen: { investiert: kInvestiert, rueckfluesse: kRueck, bewertung: kBewertung, multiple: kMultiple, irr: kIrr },
  };
}
