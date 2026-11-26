import type {
  NeueAktivitaet,
  NeueBeteiligung,
  NeuesInstrument,
  NeueTranche,
  NeueBewertung,
  NeueDarlehenKondition,
  NeuerJahresueberschuss,
  NeueFondsBewegung,
  NeueFondsKennzahl,
  NeueFondsOffenlegung,
  NeueFondsZeichnung,
  NeuerKennzahlWert,
  NeueAnteilsklasse,
  NeueFinanzierungsrunde,
  NeuePerson,
  NeueRundenposition,
  NeuerBeschluss,
  NeuerDeal,
  NeuerDealPhasenwechsel,
  NeuerFonds,
  NeuerVorgang,
  NeueOrganisation,
} from "../index";
import { INSTRUMENT_BEZEICHNUNG } from "../instrument";
import {
  BETREUUNG,
  FUNKTIONEN,
  INSTRUMENT_GEWICHTE,
  INVESTOR_ZUSATZ,
  NACHNAMEN,
  ORTE,
  QUELLEN,
  SEKTOREN,
  SILBEN,
  VORNAMEN,
  slug,
} from "./namen";
import { erzeugeBuchhaltung, type DemoBuchhaltung } from "./buchhaltung";
import { erzeugeFondskosten, type DemoFondskosten } from "./fondskosten";
import { erzeugeCrm, type DemoCrm } from "./crm";
import type { schema } from "../index";
import { erzeugeLpZahlungen } from "./lp-zahlungen";
import { erzeugeMandate, type DemoMandat } from "./mandate";
import { richteModellAus } from "./modell";
import { bucheExits, EXIT_ERLOES_BEMERKUNG, type DemoVerkauf } from "./verkauf";
import { erzeugeVehikel, vehikelFuer, type DemoVehikel } from "./vehikel";
import { erzeugeRegisterUndSzenarien } from "./register";
import { demoTexte, type DemoSprache, type DemoTexte } from "./texte";
import { abgeleiteteId, ausTagesnummer, erzeugeRng, euro, plusTage, quartalsenden, tagesnummer, type Rng } from "./zufall";

type MitId<T> = T & { id: string };

/** Demo-Kennzahlenwert: der Katalogeintrag steht über den Schlüssel (Version 1); die Datenbank-Id der Definition kennt erst das Schreiben. */
export type DemoKennzahlWert = Omit<MitId<NeuerKennzahlWert>, "definitionId"> & { schluessel: string };

export type Demodaten = {
  organisationen: MitId<NeueOrganisation>[];
  personen: MitId<NeuePerson>[];
  fonds: MitId<NeuerFonds>[];
  fondsBewegungen: MitId<NeueFondsBewegung>[];
  abrufAnteile: (typeof schema.abrufAnteil.$inferInsert)[];
  lpZahlungen: MitId<typeof schema.lpZahlung.$inferInsert>[];
  /** Investoren je Fonds mit Zusage und Anteil (Kapitalkonten im LP-Bericht). */
  fondsZeichnungen: MitId<NeueFondsZeichnung>[];
  deals: MitId<NeuerDeal>[];
  dealPhasenwechsel: MitId<NeuerDealPhasenwechsel>[];
  aktivitaeten: MitId<NeueAktivitaet>[];
  beschluesse: MitId<NeuerBeschluss>[];
  /** Anteilsklassen je Unternehmen (Exit-Wasserfall); nicht jedes Unternehmen hat welche. */
  anteilsklassen: MitId<NeueAnteilsklasse>[];
  finanzierungsrunden: MitId<NeueFinanzierungsrunde>[];
  /** Investitionsvehikel der Investoren (ein bis drei je Investor); Positionen von Co-Investoren zeigen auf ein Vehikel. */
  vehikel: DemoVehikel[];
  rundenpositionen: MitId<NeueRundenposition>[];
  /** Mitarbeiterbeteiligung (ESOP/VSOP): Pools je Unternehmen mit Verlauf und Zuteilungen nach Kategorie (ohne Namen). */
  mitarbeiterpools: MitId<typeof schema.mitarbeiterpool.$inferInsert>[];
  poolAenderungen: MitId<typeof schema.poolAenderung.$inferInsert>[];
  mitarbeiterzuteilungen: MitId<typeof schema.mitarbeiterzuteilung.$inferInsert>[];
  beteiligungen: MitId<NeueBeteiligung>[];
  /** Je Beteiligung das Hauptinstrument (Art der Beteiligung), Id abgeleitet aus der Beteiligung. */
  instrumente: MitId<NeuesInstrument>[];
  /** Tranchen der Zusage: gezahlte (Auszahlung auf die Tranche) und noch offene. */
  tranchen: MitId<NeueTranche>[];
  vorgaenge: MitId<NeuerVorgang>[];
  /** Wandlungen von Wandeldarlehen in Anteile (Quelle und Ziel sind Instrumente derselben Beteiligung), Buchungen wie in der API. */
  wandlungen: MitId<typeof schema.wandlung.$inferInsert>[];
  /** Ausübungen von Optionsscheinen (Beispiel ohne Ausübung: bleibt leer, damit keine Zahlung die Kennzahlen ändert). */
  optionsscheinAusuebungen: MitId<typeof schema.optionsscheinAusuebung.$inferInsert>[];
  /** Anteilsübertragungen zwischen Gesellschaftern (Secondary), Beispiel zwischen Dritten ohne Geldfluss des Fonds. */
  anteilsuebertragungen: MitId<typeof schema.anteilsuebertragung.$inferInsert>[];
  /** Ausdrückliche Zuordnung von Vorgängen zu Runden (Wandlungsbuchungen auf dem Darlehen gehören zur Zielrunde); alle anderen folgen der Runde ihres Instruments. */
  vorgangRunden: { vorgangId: string; rundeId: string }[];
  /** Vorgänge, die bewusst keiner Runde zugeordnet bleiben (Beispiel für „Keiner Runde zugeordnet“). */
  vorgangOhneRunde: string[];
  bewertungen: MitId<NeueBewertung>[];
  /** Verkäufe der Exits mit Eigenkapital (wie `POST /beteiligungen/:id/verkauf`): voller Buchwertabgang, Barzufluss als Rückfluss, Bewertung null (`verkauf.ts`). */
  verkaeufe: DemoVerkauf[];
  darlehenKonditionen: MitId<NeueDarlehenKondition>[];
  jahresueberschuesse: MitId<NeuerJahresueberschuss>[];
  /** Auswahl der Unternehmenskennzahlen je Fonds (Etappe 11). */
  fondsKennzahlen: NeueFondsKennzahl[];
  /** Bestätigte Ist- und Plan-Werte einiger Unternehmen für vier Quartale (Etappe 11). */
  kennzahlWerte: DemoKennzahlWert[];
  /** Erfundene ESG-Datenpunkte (Etappe 16) einiger Unternehmen für zwei Jahre, lückenhaft und zum Teil geschätzt; eigener Strom, damit die übrigen Kennzahlen unverändert bleiben. */
  esgWerte: DemoKennzahlWert[];
  /** Verlauf der Einordnung (Artikel 6, 8, 9) je Fonds. */
  fondsOffenlegungen: MitId<NeueFondsOffenlegung>[];
  /** Geschäftsführungsrollen, Registerdaten, Reserven und Szenarien (Etappe 18, `register.ts`). */
  kontaktrollen: (typeof schema.kontaktrolle.$inferInsert)[];
  registereintraege: MitId<typeof schema.registereintrag.$inferInsert>[];
  registerEreignisse: MitId<typeof schema.registerEreignis.$inferInsert>[];
  reserven: (typeof schema.reserve.$inferInsert)[];
  szenarien: MitId<typeof schema.szenario.$inferInsert>[];
  /** Gremienmandate der Fonds je Beteiligung (Issue #156, `mandate.ts`). */
  gremienmandate: DemoMandat[];
} & DemoBuchhaltung &
  DemoFondskosten &
  DemoCrm;

export type DemoOptionen = {
  seed?: number;
  /** Sprache der Freitexte (Notizen, Begründungen, Absagegründe); Standard Deutsch. Siehe `texte.ts`. */
  sprache?: DemoSprache;
  /** `fonds`: 3 (Standard) bis 5. */
  umfang?: {
    beteiligungen?: number;
    deals?: number;
    fonds?: number;
    /**
     * Zusätzliche Zahlungen (Vorgänge der Art `zins`) für den Mengen-Referenzdatensatz, gleichmäßig auf alle Beteiligungen
     * und über deren Laufzeit verteilt. Rein für Messungen (TECH-STACK: 100.000 Zahlungen); die Beträge sind klein und
     * nicht fachlich begründet. Standard 0.
     */
    zahlungen?: number;
  };
};

/** Letzter Bewertungsstichtag und spätestes Datum der Dealdaten. */
export const BEWERTUNG_BIS = "2026-09-30";
export const STICHTAG_HEUTE = "2026-11-20";

const FONDS_ALLE = [
  { name: "Beispielfonds I", kurzname: "BF I", vintage: 2019, kapital: 60_000_000, von: "2019-07-01", bis: "2022-12-31", anteil: 0.4, ticketMax: 6_000_000 },
  { name: "Beispielfonds II", kurzname: "BF II", vintage: 2022, kapital: 90_000_000, von: "2022-07-01", bis: "2025-06-30", anteil: 0.4, ticketMax: 6_000_000 },
  { name: "Beispielfonds Seed", kurzname: "BF Seed", vintage: 2024, kapital: 25_000_000, von: "2024-07-01", bis: "2026-06-30", anteil: 0.2, ticketMax: 1_500_000 },
  { name: "Beispielfonds Wachstum", kurzname: "BF Wachstum", vintage: 2021, kapital: 120_000_000, von: "2021-01-01", bis: "2023-12-31", anteil: 0.2, ticketMax: 6_000_000 },
  { name: "Beispielfonds Impact", kurzname: "BF Impact", vintage: 2023, kapital: 45_000_000, von: "2023-07-01", bis: "2025-12-31", anteil: 0.15, ticketMax: 3_000_000 },
] as const;

/** Anteil der Beteiligungen je Fonds, abhängig von der Zahl der Fonds. */
const FONDS_ANTEILE: Record<number, readonly number[]> = {
  3: [0.4, 0.4, 0.2],
  4: [0.3, 0.3, 0.15, 0.25],
  5: [0.25, 0.3, 0.1, 0.2, 0.15],
};

const PHASEN = ["anfrage", "erstgespraech", "pruefung", "due_diligence", "investitionsausschuss", "closing"] as const;
type Phase = (typeof PHASEN)[number];

type Instrument = NonNullable<NeueBeteiligung["instrument"]>;
type Status = NonNullable<NeueBeteiligung["status"]>;

type Spezifikation = {
  fondsIndex: number;
  orgId: string;
  orgName: string;
  instrument: Instrument;
  erstinvestment: string;
  zusageCent: number;
  status: Status;
  endDatum?: string;
  folgeVon?: number;
  istOriginalFuerFolge?: boolean;
  stornoBeispiel?: boolean;
};

/** Das Hauptinstrument einer Beteiligung hat eine aus der Beteiligung abgeleitete Id (verbraucht keine Zufallszahlen). */
export const hauptInstrumentId = (beteiligungId: string) => abgeleiteteId(beteiligungId, "instrument");

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const rundeCent = (cent: number, schritt: number) => Math.round(cent / schritt) * schritt;

export function erzeugeDemodaten(optionen: DemoOptionen = {}): Demodaten {
  const rng = erzeugeRng(optionen.seed ?? 1);
  const tx = demoTexte(optionen.sprache);
  const anzahlBet = optionen.umfang?.beteiligungen ?? 40;
  const anzahlDeals = Math.max(optionen.umfang?.deals ?? 70, anzahlBet);
  const anzahlFonds = optionen.umfang?.fonds ?? 3;
  if (!Number.isInteger(anzahlFonds) || anzahlFonds < 3 || anzahlFonds > FONDS_ALLE.length) {
    throw new Error(`umfang.fonds muss zwischen 3 und ${FONDS_ALLE.length} liegen`);
  }
  const FONDS_DEFINITION = FONDS_ALLE.slice(0, anzahlFonds);
  const fondsAnteile = FONDS_ANTEILE[anzahlFonds] as readonly number[];

  const d: Demodaten = {
    organisationen: [],
    personen: [],
    fonds: [],
    fondsBewegungen: [],
    abrufAnteile: [],
    lpZahlungen: [],
    fondsZeichnungen: [],
    deals: [],
    dealPhasenwechsel: [],
    aktivitaeten: [],
    beschluesse: [],
    anteilsklassen: [],
    finanzierungsrunden: [],
    vehikel: [],
    rundenpositionen: [],
    mitarbeiterpools: [],
    poolAenderungen: [],
    mitarbeiterzuteilungen: [],
    beteiligungen: [],
    instrumente: [],
    tranchen: [],
    vorgaenge: [],
    wandlungen: [],
    optionsscheinAusuebungen: [],
    anteilsuebertragungen: [],
    vorgangRunden: [],
    vorgangOhneRunde: [],
    bewertungen: [],
    verkaeufe: [],
    darlehenKonditionen: [],
    jahresueberschuesse: [],
    fondsKennzahlen: [],
    kennzahlWerte: [],
    foerderprogramme: [],
    fondsBuchhaltung: [],
    beteiligungBuchhaltung: [],
    fondsMittelarten: [],
    gliederungPositionen: [],
    sachkonten: [],
    kontenregeln: [],
    buchungsregeln: [],
    saldenlaeufe: [],
    salden: [],
    fondsKosten: [],
    fondsKostenAnteile: [],
    esgWerte: [],
    fondsOffenlegungen: [],
    kontaktrollen: [],
    registereintraege: [],
    registerEreignisse: [],
    reserven: [],
    szenarien: [],
    gremienmandate: [],
    feldDefinitionen: [],
    beschaeftigungen: [],
    dealKontakte: [],
    listen: [],
    listenEintraege: [],
    aufgaben: [],
    datensatzLinks: [],
  };

  // Organisationen und Personen ----------------------------------------------------------------------------------
  const belegteNamen = new Set<string>();
  const personenJeOrg = new Map<string, string[]>();

  const neuerFirmenname = (): { name: string; sektor: string } => {
    for (;;) {
      const silben = Array.from({ length: rng.int(2, 3) }, () => rng.wahl(SILBEN)).join("");
      const sektor = rng.next() < 0.7 ? rng.wahl(SEKTOREN) : undefined;
      const name = sektor ? `${cap(silben)} ${sektor[0]}` : cap(silben);
      if (!belegteNamen.has(name)) {
        belegteNamen.add(name);
        return { name, sektor: sektor ? sektor[1] : rng.wahl(SEKTOREN)[1] };
      }
    }
  };

  const neuePersonen = (orgId: string, orgName: string) => {
    const ids: string[] = [];
    const anzahl = rng.int(1, 2);
    for (let i = 0; i < anzahl; i++) {
      const vorname = rng.wahl(VORNAMEN);
      const nachname = rng.wahl(NACHNAMEN);
      const id = rng.uuid();
      ids.push(id);
      d.personen.push({
        id,
        vorname,
        nachname,
        email: `${slug(vorname)}.${slug(nachname)}@${slug(orgName)}.example`,
        funktion: rng.wahl(FUNKTIONEN),
        organisationId: orgId,
      });
    }
    personenJeOrg.set(orgId, ids);
  };

  const neueFirma = (): { id: string; name: string } => {
    const { name, sektor } = neuerFirmenname();
    const id = rng.uuid();
    d.organisationen.push({
      id,
      name,
      art: "unternehmen",
      sektor,
      ort: rng.wahl(ORTE),
      website: `https://www.${slug(name)}.example`,
    });
    neuePersonen(id, name);
    return { id, name };
  };

  const investoren: { id: string; name: string }[] = [];
  for (let i = 0; i < 5; i++) {
    const basis = cap(Array.from({ length: 2 }, () => rng.wahl(SILBEN)).join(""));
    const name = `${basis} ${INVESTOR_ZUSATZ[i % INVESTOR_ZUSATZ.length]}`;
    belegteNamen.add(name);
    const id = rng.uuid();
    d.organisationen.push({ id, name, art: "investor", ort: rng.wahl(ORTE), website: `https://www.${slug(name)}.example` });
    neuePersonen(id, name);
    investoren.push({ id, name });
  }
  d.vehikel = erzeugeVehikel(investoren);

  // Fonds ------------------------------------------------------------------------------------------------------
  const fondsIds = FONDS_DEFINITION.map((f) => {
    const id = rng.uuid();
    d.fonds.push({ id, name: f.name, kurzname: f.kurzname, vintage: f.vintage, zeichnungskapital: euro(f.kapital * 100) });
    return id;
  });

  // Beteiligungen planen ---------------------------------------------------------------------------------------
  const folgeAnzahl = anzahlBet >= 12 ? 3 : 0;
  const basis = anzahlBet - folgeAnzahl;
  const zahlen = fondsAnteile.map((a) => Math.round(basis * a));
  zahlen[1] = basis - zahlen.reduce((summe, n, i) => (i === 1 ? summe : summe + n), 0);

  const zufallsDatum = (von: string, bis: string) => ausTagesnummer(rng.int(tagesnummer(von), tagesnummer(bis)));
  const ticketFuer = (fondsIndex: number, klein = false) => {
    const f = FONDS_DEFINITION[fondsIndex] as (typeof FONDS_DEFINITION)[number];
    const max = klein ? Math.min(f.ticketMax, 2_000_000) : f.ticketMax;
    const euroBetrag = 500_000 + rng.next() ** 1.5 * (max - 500_000);
    return rundeCent(euroBetrag * 100, 1_000_000);
  };

  const spez: Spezifikation[] = [];
  const spezAnlegen = (fondsIndex: number, firma: { id: string; name: string }, datum: string, klein = false, folgeVon?: number) => {
    const eintrag: Spezifikation = {
      fondsIndex,
      orgId: firma.id,
      orgName: firma.name,
      instrument: folgeVon === undefined ? rng.gewichtet(INSTRUMENT_GEWICHTE) : "offene_beteiligung",
      erstinvestment: datum,
      zusageCent: ticketFuer(fondsIndex, klein),
      status: "aktiv",
    };
    if (folgeVon !== undefined) eintrag.folgeVon = folgeVon;
    spez.push(eintrag);
  };
  FONDS_DEFINITION.forEach((f, fi) => {
    for (let i = 0; i < (zahlen[fi] as number); i++) {
      spezAnlegen(fi, neueFirma(), zufallsDatum(f.von, f.bis));
    }
  });

  // Querbeteiligungen: dasselbe Unternehmen in zwei Fonds (Folgeinvestment).
  const kandidaten = (fi: number, bis: string) =>
    rng.mische(spez.map((_, i) => i).filter((i) => spez[i]?.fondsIndex === fi && (spez[i]?.erstinvestment ?? "") <= bis && !spez[i]?.istOriginalFuerFolge));
  const folgeDefs = [
    { von: 0, nach: 1, origBis: "2022-06-30", fruehestens: "2022-07-01", spaetestens: "2025-06-30" },
    { von: 0, nach: 1, origBis: "2022-06-30", fruehestens: "2022-07-01", spaetestens: "2025-06-30" },
    { von: 1, nach: 2, origBis: "2025-03-31", fruehestens: "2024-07-01", spaetestens: "2026-06-30" },
  ].slice(0, folgeAnzahl);
  for (const def of folgeDefs) {
    const orig = kandidaten(def.von, def.origBis)[0];
    if (orig === undefined) continue;
    const o = spez[orig] as Spezifikation;
    o.istOriginalFuerFolge = true;
    const fruehestens = plusTage(o.erstinvestment, 250);
    const start = fruehestens > def.fruehestens ? fruehestens : def.fruehestens;
    const datum = plusTage(start, rng.int(0, 120));
    spezAnlegen(def.nach, { id: o.orgId, name: o.orgName }, datum <= def.spaetestens ? datum : def.spaetestens, true, orig);
  }

  // Sonderfälle zuweisen: Storno-Beispiel, Exits, Insolvenzen.
  const frei = (fi: number[], bis: string) =>
    rng.mische(spez.map((_, i) => i)).filter((i) => {
      const s = spez[i] as Spezifikation;
      return fi.includes(s.fondsIndex) && s.erstinvestment <= bis && s.status === "aktiv" && !s.istOriginalFuerFolge && s.folgeVon === undefined && !s.stornoBeispiel;
    });
  const stornoIdx = frei([1], "2025-01-31")[0];
  if (stornoIdx !== undefined) (spez[stornoIdx] as Spezifikation).stornoBeispiel = true;
  const exitAnzahl = Math.max(2, Math.round(anzahlBet * 0.12));
  for (const i of frei([0, 1], "2023-12-31").slice(0, exitAnzahl)) {
    const s = spez[i] as Spezifikation;
    s.status = "exit";
    const geplant = plusTage(s.erstinvestment, rng.int(900, 1700));
    s.endDatum = geplant < "2026-06-15" ? geplant : plusTage("2026-06-15", -rng.int(0, 60));
  }
  for (const i of frei([0, 1], "2025-06-30").slice(0, 2)) {
    const s = spez[i] as Spezifikation;
    s.status = "insolvent";
    const geplant = plusTage(s.erstinvestment, rng.int(400, 1000));
    s.endDatum = geplant < "2026-08-31" ? geplant : "2026-08-31";
  }

  // Vorgänge und Bewertungen je Beteiligung -------------------------------------------------------------------
  const quartale = quartalsenden(2019, BEWERTUNG_BIS);
  const zinsKandidaten = rng.mische(spez.map((_, i) => i).filter((i) => ["darlehen", "wandeldarlehen"].includes((spez[i] as Spezifikation).instrument) && spez[i]?.status === "aktiv"));
  const zinsSet = new Set(zinsKandidaten.slice(0, 8));

  const auszahlungenFonds: { fondsIndex: number; valuta: string; cent: number }[] = [];
  const rueckfluesse: { fondsIndex: number; valuta: string; cent: number }[] = [];
  const dealIds: string[] = [];
  const beteiligungIds: string[] = [];
  const tranchenJeSpez: { valuta: string; cent: number }[][] = [];

  const vorgangAnlegen = (beteiligungId: string, art: NonNullable<NeuerVorgang["art"]>, valuta: string, cent: number, bemerkung?: string, storno?: string, trancheId?: string) => {
    const id = rng.uuid();
    const zeile: MitId<NeuerVorgang> = { id, beteiligungId, instrumentId: hauptInstrumentId(beteiligungId), art, valuta, betrag: euro(cent) };
    if (bemerkung) zeile.bemerkung = bemerkung;
    if (storno) zeile.storniertVorgangId = storno;
    if (trancheId) zeile.trancheId = trancheId;
    d.vorgaenge.push(zeile);
    return id;
  };

  spez.forEach((s, index) => {
    const bId = rng.uuid();
    const dealId = rng.uuid();
    dealIds.push(dealId);
    beteiligungIds.push(bId);
    const fondsId = fondsIds[s.fondsIndex] as string;
    const ende = s.endDatum;
    const vorEnde = (datum: string) => datum <= BEWERTUNG_BIS && (ende === undefined || datum < ende);

    // Zusage und Tranchen
    const anteil = s.stornoBeispiel ? 0.7 : rng.gewichtet([[1, 3], [0.85, 1], [0.7, 1]] as const);
    const anzahlTranchen = s.stornoBeispiel ? 2 : rng.gewichtet([[1, 2], [2, 1], [3, 1]] as const);
    const gesamt = rundeCent(s.zusageCent * anteil, 10_000);
    const gewichte = Array.from({ length: anzahlTranchen }, () => 0.3 + rng.next());
    const gewichtSumme = gewichte.reduce((a, b) => a + b, 0);
    const betraege: number[] = [];
    let rest = gesamt;
    gewichte.forEach((g, i) => {
      const cent = i === gewichte.length - 1 ? rest : rundeCent((gesamt * g) / gewichtSumme, 10_000);
      betraege.push(cent);
      rest -= cent;
    });

    vorgangAnlegen(bId, "zusage", s.erstinvestment, s.zusageCent, "Beteiligungsvertrag");
    const tranchen: { valuta: string; cent: number }[] = [];
    let datum = s.erstinvestment;
    betraege.forEach((cent, i) => {
      if (i > 0) {
        datum = plusTage(datum, rng.int(90, 365));
        if (s.stornoBeispiel && i === 1) datum = `${datum.slice(0, 8)}10`;
      }
      if (cent <= 0) return;
      const trancheId = abgeleiteteId(bId, `tranche-${i + 1}`);
      const bezeichnung = i === 0 ? "Erstauszahlung" : `Tranche ${i + 1}`;
      const tranche = { id: trancheId, beteiligungId: bId, instrumentId: hauptInstrumentId(bId), nummer: i + 1, bezeichnung, betrag: euro(cent), geplantAm: datum };
      if (!vorEnde(datum) || datum > "2026-06-30") {
        // Noch nicht ausgezahlt: bei einer laufenden Beteiligung bleibt die Tranche offen, sonst entfällt sie.
        if (ende === undefined) d.tranchen.push(tranche);
        return;
      }
      d.tranchen.push({ ...tranche, erfuelltAm: datum });
      tranchen.push({ valuta: datum, cent });
      if (s.stornoBeispiel && i === 1) {
        // Fehlbuchung: zehn Prozent zu viel gebucht, storniert und richtig neu gebucht (Entscheidung 8).
        const falsch = rundeCent(cent * 1.1, 10_000);
        const original = vorgangAnlegen(bId, "auszahlung", datum, falsch, "Tranche (Betrag falsch erfasst)", undefined, trancheId);
        const stornoTag = plusTage(datum, 5);
        vorgangAnlegen(bId, "auszahlung", stornoTag, -falsch, "Storno wegen Erfassungsfehler", original, trancheId);
        vorgangAnlegen(bId, "auszahlung", stornoTag, cent, "Tranche (korrigiert)", undefined, trancheId);
        auszahlungenFonds.push({ fondsIndex: s.fondsIndex, valuta: datum, cent: falsch });
        auszahlungenFonds.push({ fondsIndex: s.fondsIndex, valuta: stornoTag, cent: -falsch + cent });
      } else {
        vorgangAnlegen(bId, "auszahlung", datum, cent, bezeichnung, undefined, trancheId);
        auszahlungenFonds.push({ fondsIndex: s.fondsIndex, valuta: datum, cent });
      }
    });
    tranchenJeSpez[index] = tranchen;
    const investiertBis = (tag: string) => tranchen.filter((t) => t.valuta <= tag).reduce((a, t) => a + t.cent, 0);
    const investiertGesamt = investiertBis("9999-12-31");

    if (s.status === "exit" && ende) {
      const faktor = 1.2 + rng.next() * 2.8;
      // Ein Darlehen kommt mit Zinsen und Aufschlag zurück, nicht mit dem Vielfachen einer Beteiligung.
      const darlehen = s.instrument === "darlehen" || s.instrument === "wandeldarlehen";
      const rueck = rundeCent(investiertGesamt * (darlehen ? 1.05 + ((faktor - 1.2) / 2.8) * 0.25 : faktor), 10_000);
      // Der Erlös wird nach dem Portfolio-Modell zu Verkauf oder Rückzahlung (`bucheExits`): Tilgung der Einlage bei Darlehen, Rest als Rückfluss.
      vorgangAnlegen(bId, "rueckfluss", ende, rueck, EXIT_ERLOES_BEMERKUNG);
      rueckfluesse.push({ fondsIndex: s.fondsIndex, valuta: ende, cent: rueck });
    }
    if (zinsSet.has(index)) {
      let n = 0;
      const gebucht: { id: string; tag: string; cent: number }[] = [];
      for (let jahr = Number(s.erstinvestment.slice(0, 4)); jahr <= 2025 && n < 4; jahr++) {
        const tag = `${jahr}-12-31`;
        const basisCent = investiertBis(tag);
        if (tag > s.erstinvestment && basisCent > 0 && vorEnde(tag)) {
          const zinsCent = Math.round(basisCent * 0.06);
          gebucht.push({ id: vorgangAnlegen(bId, "zins", tag, zinsCent, "Jahreszins 6 %"), tag, cent: zinsCent });
          n++;
        }
      }
      // Die Zinsbuchung ist eine Forderung; das Geld kommt mit der Zinszahlung zum selben Tag (wie bei der Übernahme des Bestands). Die jüngste Buchung bleibt offen.
      // Die Id der Zahlung ist abgeleitet, damit die Zufallszahlen (und damit die übrigen Demo-Daten) unverändert bleiben.
      // Ein Wandeldarlehen verzinst sich meist nur auf Rechnung (Zinsen werden gewandelt oder bleiben offen).
      for (const z of s.instrument === "wandeldarlehen" ? [] : gebucht.slice(0, -1)) {
        d.vorgaenge.push({ id: abgeleiteteId(z.id, "zinszahlung"), beteiligungId: bId, instrumentId: hauptInstrumentId(bId), art: "zinszahlung", valuta: z.tag, betrag: euro(z.cent), bemerkung: "Zinszahlung zum Jahreszins 6 %", beglichenVorgangId: z.id });
      }
    }

    // Quartalsbewertungen
    let wert = 0;
    let vorher = s.erstinvestment;
    let erste = true;
    for (const stichtag of quartale) {
      if (stichtag <= s.erstinvestment) continue;
      if (ende !== undefined && s.status === "exit" && stichtag >= ende) break;
      const neu = tranchen.filter((t) => t.valuta > vorher && t.valuta <= stichtag).reduce((a, t) => a + t.cent, 0);
      let methode: NonNullable<NeueBewertung["methode"]>;
      let begruendung: string;
      if (s.status === "insolvent" && ende !== undefined && stichtag >= ende) {
        wert = 0;
        methode = "sonstige";
        begruendung = tx.bewertung.insolvenz;
      } else if (erste) {
        wert = rundeCent(investiertBis(stichtag) * (0.95 + rng.next() * 0.1), 10_000);
        methode = "anschaffungskosten";
        begruendung = tx.bewertung.anschaffungskosten;
      } else if (rng.next() < 0.35) {
        wert += neu;
        methode = "anschaffungskosten";
        begruendung = tx.bewertung.keineNeubewertung;
      } else {
        const drift = s.status === "insolvent" ? -0.08 : 0.03;
        const faktor = Math.min(1.8, Math.max(0.6, 1 + drift + 0.12 * rng.normal()));
        wert = rundeCent((wert + neu) * faktor, 10_000);
        methode = rng.gewichtet([["letzte_runde", 85], ["multiplikator", 10], ["dcf", 5]] as const);
        begruendung =
          methode === "letzte_runde" ? tx.bewertung.letzteRunde : methode === "multiplikator" ? tx.bewertung.multiplikator : tx.bewertung.ertragswert;
      }
      erste = false;
      vorher = stichtag;
      d.bewertungen.push({ id: rng.uuid(), beteiligungId: bId, stichtag, wert: euro(wert), methode, begruendung, status: "freigegeben", erstelltVon: "demo", freigegebenVon: "demo" });
    }

    d.beteiligungen.push({
      id: bId,
      fondsId,
      organisationId: s.orgId,
      dealId,
      instrument: s.instrument,
      erstinvestment: s.erstinvestment,
      status: s.status,
    });
    d.instrumente.push({
      id: hauptInstrumentId(bId),
      beteiligungId: bId,
      art: s.instrument,
      bezeichnung: INSTRUMENT_BEZEICHNUNG[s.instrument],
      status: s.status === "aktiv" ? "aktiv" : s.status === "exit" ? "verkauft" : "abgeschrieben",
    });
  });

  // Mengen-Referenzdatensatz: zusätzliche Zahlungen gleichmäßig auf die Laufzeit jeder Beteiligung verteilen -----------
  const mengenStart = d.vorgaenge.length;
  const zusaetzlich = optionen.umfang?.zahlungen ?? 0;
  if (zusaetzlich > 0) {
    const bis = (s: Spezifikation) => (s.endDatum !== undefined && s.endDatum < BEWERTUNG_BIS ? plusTage(s.endDatum, -1) : BEWERTUNG_BIS);
    spez.forEach((s, index) => {
      // Jede Beteiligung bekommt ihren Anteil; die Reste gehen an die ersten.
      const anzahl = Math.floor(zusaetzlich / spez.length) + (index < zusaetzlich % spez.length ? 1 : 0);
      const start = tagesnummer(s.erstinvestment) + 1;
      const spanne = Math.max(1, tagesnummer(bis(s)) - start);
      const basis = (tranchenJeSpez[index] ?? []).reduce((a, t) => a + t.cent, 0) || s.zusageCent;
      const cent = Math.max(100, Math.round((basis * 0.0004) / 100) * 100);
      for (let i = 0; i < anzahl; i++) {
        const tag = ausTagesnummer(start + Math.floor((i * spanne) / anzahl));
        vorgangAnlegen(beteiligungIds[index] as string, "zins", tag, cent, "Zahlung (Mengen-Referenz)");
      }
    });
  }

  // Fonds-Bewegungen: Abrufe je Quartal (Auszahlungen plus rund 8 % Gebühren), Ausschüttungen nach Exits -----
  FONDS_DEFINITION.forEach((_, fi) => {
    const jeQuartal = new Map<string, number>();
    for (const a of auszahlungenFonds.filter((x) => x.fondsIndex === fi)) {
      const jahr = a.valuta.slice(0, 4);
      const q = Math.floor((Number(a.valuta.slice(5, 7)) - 1) / 3);
      const schluessel = `${jahr}-${q}`;
      jeQuartal.set(schluessel, (jeQuartal.get(schluessel) ?? 0) + a.cent);
    }
    for (const [schluessel, cent] of [...jeQuartal].sort(([a], [b]) => a.localeCompare(b))) {
      if (cent <= 0) continue;
      const [jahr, q] = schluessel.split("-");
      const valuta = `${jahr}-${String(Number(q) * 3 + 1).padStart(2, "0")}-05`;
      d.fondsBewegungen.push({
        id: rng.uuid(),
        fondsId: fondsIds[fi] as string,
        art: "abruf",
        valuta,
        betrag: euro(rundeCent(cent * 1.08, 10_000)),
        bemerkung: tx.abruf,
      });
    }
    for (const r of rueckfluesse.filter((x) => x.fondsIndex === fi)) {
      d.fondsBewegungen.push({
        id: rng.uuid(),
        fondsId: fondsIds[fi] as string,
        art: "ausschuettung",
        valuta: plusTage(r.valuta, 14),
        betrag: euro(r.cent),
        bemerkung: tx.ausschuettung,
      });
    }
  });

  // Große Umfänge: Zeichnungskapital wächst mit, damit die Abrufe es nie übersteigen (auf volle Millionen aufgerundet).
  for (const f of d.fonds) {
    const abgerufen = d.fondsBewegungen.filter((b) => b.fondsId === f.id && b.art === "abruf").reduce((summe, b) => summe + Math.round(Number(b.betrag) * 100), 0);
    if (abgerufen > Math.round(Number(f.zeichnungskapital) * 100)) f.zeichnungskapital = euro(Math.ceil((abgerufen * 1.15) / 100_000_000) * 100_000_000);
  }

  // Deals ------------------------------------------------------------------------------------------------------
  const aktivitaetenFuer = (dealId: string, orgId: string, von: string, bis: string, mitInvestor: boolean) => {
    const personen = personenJeOrg.get(orgId) ?? [];
    const anzahl = rng.int(2, 4);
    const daten = Array.from({ length: anzahl }, () => zufallsDatum(von, bis)).sort();
    daten.forEach((datum, i) => {
      const art = rng.wahl(["gespraech", "termin", "notiz", "mail"] as const);
      const eintrag: MitId<NeueAktivitaet> = {
        id: rng.uuid(),
        art,
        datum,
        titel: rng.wahl(tx.aktivitaeten[art]),
        dealId,
        organisationId: orgId,
      };
      const person = personen.length > 0 ? rng.wahl(personen) : undefined;
      if (person) eintrag.personId = person;
      if (mitInvestor && i === anzahl - 1) {
        const inv = rng.wahl(investoren);
        eintrag.organisationId = inv.id;
        eintrag.personId = rng.wahl(personenJeOrg.get(inv.id) ?? []);
        eintrag.titel = tx.abstimmung;
        eintrag.art = "gespraech";
      }
      d.aktivitaeten.push(eintrag);
    });
  };

  const phasenVerlauf = (dealId: string, bisPhase: Phase, ende: string, rueckwaerts: boolean, start?: string) => {
    const bisIndex = PHASEN.indexOf(bisPhase);
    const daten: string[] = [];
    if (rueckwaerts) {
      let t = ende;
      for (let i = bisIndex; i >= 0; i--) {
        daten[i] = t;
        t = plusTage(t, -rng.int(5, 30));
      }
    } else {
      let t = start as string;
      for (let i = 0; i <= bisIndex; i++) {
        daten[i] = t;
        t = plusTage(t, rng.int(5, 30));
      }
    }
    daten.forEach((am, i) => {
      d.dealPhasenwechsel.push({ id: rng.uuid(), dealId, vonPhase: i === 0 ? null : (PHASEN[i - 1] as Phase), nachPhase: PHASEN[i] as Phase, am });
    });
    return daten;
  };

  spez.forEach((s, index) => {
    const dealId = dealIds[index] as string;
    const daten = phasenVerlauf(dealId, "closing", s.erstinvestment, true);
    const ausschuss = daten[PHASEN.indexOf("investitionsausschuss")] as string;
    d.deals.push({
      id: dealId,
      organisationId: s.orgId,
      fondsId: fondsIds[s.fondsIndex] as string,
      titel: `${s.orgName}, ${rng.wahl(["Seed-Runde", "Wachstumsfinanzierung", "Brückenfinanzierung", "Serie-A-Runde"])}`,
      phase: "closing",
      status: "investiert",
      quelle: rng.wahl(QUELLEN),
      ticket: euro(s.zusageCent),
      betreuung: rng.wahl(BETREUUNG),
      eingangsdatum: daten[0] as string,
      erstelltAm: new Date(`${daten[0]}T08:00:00Z`),
      aktualisiertAm: new Date(`${s.erstinvestment}T16:00:00Z`),
    });
    d.beschluesse.push({
      id: rng.uuid(),
      dealId,
      fondsId: fondsIds[s.fondsIndex] as string,
      gremium: "Investitionsausschuss",
      datum: ausschuss,
      ergebnis: "zugestimmt",
      betrag: euro(s.zusageCent),
      auflagen: rng.next() < 0.3 ? "Berichtspflicht quartalsweise" : null,
    });
    aktivitaetenFuer(dealId, s.orgId, daten[0] as string, s.erstinvestment, rng.next() < 0.5);
  });

  const offene = ["anfrage", "erstgespraech", "pruefung", "due_diligence", "investitionsausschuss"] as const;
  for (let i = spez.length; i < anzahlDeals; i++) {
    const firma = neueFirma();
    const dealId = rng.uuid();
    const abgesagt = rng.next() < 0.4;
    const phase = abgesagt ? rng.wahl(offene) : rng.gewichtet([["anfrage", 3], ["erstgespraech", 3], ["pruefung", 3], ["due_diligence", 2], ["investitionsausschuss", 1]] as const);
    const schritte = PHASEN.indexOf(phase);
    const laenge = schritte * 30 + 30;
    const startTag = tagesnummer(STICHTAG_HEUTE) - laenge - rng.int(abgesagt ? 20 : 3, abgesagt ? 800 : 240);
    const start = ausTagesnummer(startTag);
    const daten = phasenVerlauf(dealId, phase, STICHTAG_HEUTE, false, start);
    const letzte = daten[daten.length - 1] as string;
    const absageTag = plusTage(letzte, rng.int(5, 20));
    const ende = abgesagt && absageTag <= STICHTAG_HEUTE ? absageTag : letzte;
    d.deals.push({
      id: dealId,
      organisationId: firma.id,
      fondsId: fondsIds[rng.gewichtet([[1, 3], [2, 2]] as const)] as string,
      titel: `${firma.name}, ${rng.wahl(["Seed-Runde", "Wachstumsfinanzierung", "Brückenfinanzierung", "Serie-A-Runde"])}`,
      phase,
      status: abgesagt ? "abgesagt" : "offen",
      quelle: rng.wahl(QUELLEN),
      ticket: euro(rundeCent((500_000 + rng.next() * 3_500_000) * 100, 5_000_000)),
      betreuung: rng.wahl(BETREUUNG),
      absagegrund: abgesagt ? rng.wahl(tx.absagegruende) : null,
      eingangsdatum: start,
      erstelltAm: new Date(`${start}T08:00:00Z`),
      aktualisiertAm: new Date(`${ende}T12:00:00Z`),
    });
    if (phase === "investitionsausschuss") {
      d.beschluesse.push({
        id: rng.uuid(),
        dealId,
        gremium: "Investitionsausschuss",
        datum: letzte,
        ergebnis: abgesagt ? "abgelehnt" : "vertagt",
        auflagen: abgesagt ? null : "Nachreichen der Finanzplanung",
      });
    }
    aktivitaetenFuer(dealId, firma.id, start, ende, rng.next() < 0.3);
  }

  erzeugeRunden(d, rng, spez, tranchenJeSpez, fondsIds, investoren);

  // Konditionen der Darlehen. Bewusst ohne Zufallsziehungen vor den Ids am Ende, damit alle bisherigen Werte gleich bleiben.
  erzeugeKonditionen(d, rng);

  // Zeichnungen der Investoren und Beschlussvorschläge: ohne Einfluss auf die bisherigen Werte (nur Ids danach, Texte ohne Zufall).
  erzeugeZeichnungen(d, rng, investoren);
  for (const deal of d.deals) {
    if (deal.phase === "investitionsausschuss" && deal.status === "offen") {
      deal.beschlussvorschlag = `Zustimmung zu einer Beteiligung von bis zu ${Number(deal.ticket ?? 0).toLocaleString("de-DE", { maximumFractionDigits: 0 })} Euro, vorbehaltlich der offenen Auflagen.`;
    }
  }

  // Anteilsklassen: eigener Zufallsstrom (vom Seed abgeleitet), damit alle übrigen Demo-Daten unverändert bleiben.
  erzeugeAnteilsklassen(d, erzeugeRng(((optionen.seed ?? 1) * 2654435761 + 10) >>> 0));

  // Portfolio-Modell: Instrumente je Runde, Brückenrunden, Wandlungen, Tranchen und Zinsen (eigener Zufallsstrom, Versatz 300).
  richteModellAus(d, { seed: optionen.seed ?? 1, mengenStart, tx });

  // Exits wie in der Anwendung (Verkauf, bei Darlehen Rückzahlung): ohne Zufallsziehungen, abgeleitete Ids.
  bucheExits(d, tx);

  erzeugeLpZahlungen(d);

  // Kennzahlen der Unternehmen: ebenfalls eigener Zufallsstrom.
  erzeugeKennzahlen(d, erzeugeRng(((optionen.seed ?? 1) * 2654435761 + 20) >>> 0));

  // Buchhaltung (Etappe 14): Kontenrahmen, Regeln und je Fonds eine Saldenliste des letzten Quartals, aus den Daten abgeleitet.
  Object.assign(d, erzeugeBuchhaltung(d, optionen.seed ?? 1));
  // Verwaltungsvergütung und Fondskosten (Issue #157): aus den Verwaltungskosten der Saldenliste, ohne Zufallsziehungen.
  Object.assign(d, erzeugeFondskosten(d, optionen.sprache));
  // ESG und SFDR (Etappe 16): eigener Zufallsstrom mit Versatz 40 (10, 20 und 30 gehören Anteilsklassen, Kennzahlen und Buchhaltung).
  erzeugeEsg(d, erzeugeRng(((optionen.seed ?? 1) * 2654435761 + 40) >>> 0), tx);
  // Registerdaten, Reserven und Szenarien (Etappe 18): ebenfalls eigener Zufallsstrom.
  erzeugeRegisterUndSzenarien(d, ((optionen.seed ?? 1) * 2654435761 + 180) >>> 0, tx);
  // CRM (Etappe 20): eigene Felder, Beschäftigungen, Listen und Aufgaben; eigener Zufallsstrom mit Versatz 200.
  Object.assign(d, erzeugeCrm(d, optionen.seed ?? 1, optionen.sprache));
  // Gremienmandate (Issue #156): ohne Zufallsziehungen, abgeleitete Ids; die erfundenen Vertreter der Fonds stehen hinten in den Personen.
  const gremien = erzeugeMandate(d);
  d.personen.push(...gremien.personen);
  d.gremienmandate = gremien.mandate;

  return d;
}

/** NACE-Abschnitt je Sektor der Demo-Unternehmen (erfunden, nur grobe Zuordnung). */
const NACE_JE_SEKTOR: Record<string, string> = {
  Industrie: "C",
  Software: "J",
  Energie: "D",
  Gesundheit: "Q",
  Logistik: "H",
  Forschung: "M",
  Werkstoffe: "C",
  Landwirtschaft: "A",
  "Mobilität": "H",
  Bildung: "P",
  Finanzen: "K",
};

/** Berichtsjahre der Demo-ESG-Daten; bestätigt wird im März des Folgejahres. */
const ESG_JAHRE = [2024, 2025] as const;

/**
 * ESG-Daten für höchstens sechs aktive Unternehmen je Fonds und die Jahre 2024 und 2025: je Datenpunkt mit einer Wahrscheinlichkeit angegeben
 * (2024 seltener als 2025, einige Unternehmen liefern gar nichts), Unternehmenswert meist, Emissionen zum Teil geschätzt, Quelle als Text.
 * Dazu der NACE-Abschnitt der Unternehmen und der Verlauf der Einordnung je Fonds. Alle Werte sind erfunden und ohne fachlichen Anspruch.
 */
function erzeugeEsg(d: Demodaten, rng: Rng, tx: DemoTexte) {
  for (const o of d.organisationen) {
    const abschnitt = o.sektor ? NACE_JE_SEKTOR[o.sektor] : undefined;
    if (o.art === "unternehmen" && abschnitt) o.naceAbschnitt = abschnitt;
  }
  d.fonds.forEach((f, i) => {
    const eintrag = (art: "art6" | "art8" | "art9", gueltigAb: string, bemerkung?: string): MitId<NeueFondsOffenlegung> => ({ id: rng.uuid(), fondsId: f.id, art, gueltigAb, ...(bemerkung ? { bemerkung } : {}), erfasstVon: "demo", erfasstAm: new Date(`${gueltigAb}T09:00:00Z`) });
    const start = `${f.vintage}-07-01`;
    if (i % 5 === 0) d.fondsOffenlegungen.push(eintrag("art6", start));
    else if (i % 5 === 1) d.fondsOffenlegungen.push(eintrag("art6", start), eintrag("art8", "2024-01-01", tx.offenlegung));
    else if (i % 5 === 2) d.fondsOffenlegungen.push(eintrag("art8", "2024-07-01"));
    else if (i % 5 === 3) d.fondsOffenlegungen.push(eintrag("art6", start));
    else d.fondsOffenlegungen.push(eintrag("art9", "2023-07-01"));
  });

  type Punkt = { schluessel: string; wert: string; geschaetzt: boolean };
  const janein = (anteil: number) => (rng.next() < anteil ? "ja" : "nein");
  const kommazahl = (zahl: number, stellen: number) => zahl.toFixed(stellen).replace(/\.?0+$/, "") || "0";
  const jeFonds = new Map<string, number>();
  for (const b of d.beteiligungen) {
    if (b.status !== "aktiv") continue;
    const n = jeFonds.get(b.fondsId) ?? 0;
    if (n >= 6) continue;
    jeFonds.set(b.fondsId, n + 1);
    const liefert = rng.next() < 0.85;
    // Größenordnung des Unternehmens, für alle Jahre gleich
    const umsatz0 = rng.int(3, 40) * 500_000;
    const evic0 = rng.int(15, 120) * 1_000_000;
    const intensitaet = rng.int(5, 90) / 100;
    for (const jahr of ESG_JAHRE) {
      if (!liefert && jahr === 2025) continue;
      const wachstum = jahr === 2025 ? 1.12 : 1;
      const angabe = (p: number) => rng.next() < (jahr === 2025 ? p : p - 0.2);
      const punkte: Punkt[] = [];
      const setze = (schluessel: string, wert: string, geschaetzt = false, p = 0.85) => {
        if (angabe(p)) punkte.push({ schluessel, wert, geschaetzt });
      };
      const umsatz = Math.round(umsatz0 * wachstum);
      const s1 = Math.round(umsatz * intensitaet * 0.00008);
      setze("esg_evic", String(Math.round(evic0 * wachstum)), rng.next() < 0.7, 0.9);
      setze("umsatz", `${umsatz}.00`, false, 0.9);
      setze("esg_thg_scope1", String(s1), rng.next() < 0.25);
      setze("esg_thg_scope2", String(Math.round(s1 * 0.6)), rng.next() < 0.25);
      setze("esg_thg_scope3", String(Math.round(s1 * 6)), rng.next() < 0.6, 0.6);
      setze("esg_fossile_brennstoffe", janein(0.05));
      setze("esg_nicht_erneuerbare_energie_anteil", kommazahl(rng.int(200, 900) / 10, 1), rng.next() < 0.2);
      setze("esg_energieverbrauch_gwh", kommazahl(umsatz * intensitaet * 0.000003, 2), rng.next() < 0.3);
      setze("esg_biodiversitaet", janein(0.1));
      setze("esg_emissionen_wasser", kommazahl(rng.int(0, 400) / 10, 1), rng.next() < 0.3, 0.7);
      setze("esg_gefaehrliche_abfaelle", kommazahl(rng.int(0, 600) / 10, 1), rng.next() < 0.3, 0.7);
      setze("esg_verstoesse_ungc", janein(0.04));
      setze("esg_prozesse_ungc_fehlen", janein(0.25));
      setze("esg_lohngefaelle_unbereinigt", kommazahl(rng.int(20, 280) / 10, 1), rng.next() < 0.15, 0.7);
      setze("esg_frauenanteil_leitung", kommazahl(rng.int(100, 600) / 10, 1), false, 0.9);
      setze("esg_umstrittene_waffen", janein(0.01));
      const bestaetigt = new Date(`${jahr + 1}-03-15T12:00:00Z`);
      bestaetigt.setUTCDate(bestaetigt.getUTCDate() + rng.int(0, 30));
      for (const p of punkte) {
        d.esgWerte.push({
          id: rng.uuid(),
          beteiligungId: b.id,
          schluessel: p.schluessel,
          periodeBeginn: `${jahr}-01-01`,
          periodeEnde: `${jahr}-12-31`,
          szenario: "ist",
          wert: p.wert,
          quelle: "intern",
          erfasstVon: "demo",
          erfasstAm: bestaetigt,
          status: "bestaetigt",
          geschaetzt: p.geschaetzt,
          quellenangabe: p.geschaetzt ? "Schätzung nach Branchenwerten" : p.schluessel === "esg_evic" || p.schluessel === "umsatz" ? "Jahresabschluss des Unternehmens" : "Nachhaltigkeitsangaben des Unternehmens",
          bestaetigtVon: "demo",
          bestaetigtAm: bestaetigt,
        });
      }
    }
  }
}

/** Die vier Quartale der Demo-Kennzahlen; der Datenstand endet am 30.09.2026. */
const KENNZAHL_QUARTALE = [
  { beginn: "2025-10-01", ende: "2025-12-31" },
  { beginn: "2026-01-01", ende: "2026-03-31" },
  { beginn: "2026-04-01", ende: "2026-06-30" },
  { beginn: "2026-07-01", ende: "2026-09-30" },
] as const;

/**
 * Pro Fonds eine Auswahl von vier Kennzahlen, dazu bestätigte Ist- und Plan-Werte für vier Quartale bei höchstens sechs aktiven Unternehmen
 * (die ersten in der Reihenfolge der Beteiligungen). Der Ist-Wert weicht je Quartal leicht vom Plan ab, damit die Abweichung etwas zeigt.
 * Läuft nach allem anderen und verbraucht erst dann eigene Zufallszahlen; alle erfundenen Beträge sind in Euro.
 */
function erzeugeKennzahlen(d: Demodaten, rng: Rng) {
  const schluessel = ["umsatz", "ebitda", "liquiditaet", "mitarbeitende_vzae"] as const;
  for (const f of d.fonds) schluessel.forEach((k, i) => d.fondsKennzahlen.push({ fondsId: f.id, schluessel: k, reihenfolge: (i + 1) * 10 }));
  const ausgewaehlt = d.beteiligungen.filter((b) => b.status === "aktiv").slice(0, 6);
  for (const b of ausgewaehlt) {
    const umsatz0 = rng.int(8, 40) * 100_000;
    const wachstum = 1 + rng.int(4, 14) / 100;
    const marge = rng.int(-15, 12) / 100;
    const kasse0 = rng.int(6, 30) * 100_000;
    const team0 = rng.int(9, 70);
    KENNZAHL_QUARTALE.forEach((q, i) => {
      const planUmsatz = Math.round(umsatz0 * wachstum ** i);
      const planKasse = Math.round(kasse0 * (1 - 0.06 * i));
      for (const szenario of ["plan", "ist"] as const) {
        const abw = szenario === "plan" ? 1 : 0.9 + rng.int(0, 22) / 100;
        const umsatz = Math.round(planUmsatz * abw);
        const werte: Record<(typeof schluessel)[number], string> = {
          umsatz: `${umsatz}.00`,
          ebitda: `${Math.round(umsatz * marge)}.00`,
          liquiditaet: `${Math.round(planKasse * abw)}.00`,
          mitarbeitende_vzae: String(team0 + Math.round(i * (szenario === "plan" ? 2 : 1.5))),
        };
        for (const k of schluessel) {
          const bestaetigt = new Date(`${q.ende}T12:00:00Z`);
          bestaetigt.setUTCDate(bestaetigt.getUTCDate() + 21);
          d.kennzahlWerte.push({
            id: rng.uuid(),
            beteiligungId: b.id,
            schluessel: k,
            periodeBeginn: q.beginn,
            periodeEnde: q.ende,
            szenario,
            wert: werte[k],
            quelle: "intern",
            erfasstVon: "demo",
            erfasstAm: bestaetigt,
            status: "bestaetigt",
            bestaetigtVon: "demo",
            bestaetigtAm: bestaetigt,
          });
        }
      }
    });
  }
}

/**
 * Anteilsklassen für etwa zwei Drittel der Unternehmen mit Runden: je Runde eine Klasse (höchstens drei), spätere Runden sind
 * meist vorrangig, gelegentlich gleichrangig. Konditionen sind erfunden: Faktor 1 oder 1,5, selten partizipierend mit Cap, selten
 * mit Verzinsung. Alle Positionen der Runde gehören zur Klasse der Runde; Unternehmen ohne Klassen haben nur Stammanteile.
 */
function erzeugeAnteilsklassen(d: Demodaten, rng: Rng) {
  const rundenJeOrg = new Map<string, typeof d.finanzierungsrunden>();
  for (const r of d.finanzierungsrunden) rundenJeOrg.set(r.organisationId, [...(rundenJeOrg.get(r.organisationId) ?? []), r]);
  const kurz = ["Seed", "Serie A", "Serie B"];
  for (const [orgId, runden] of rundenJeOrg) {
    if (rng.next() >= 0.67) continue;
    const sortiert = [...runden].sort((a, b) => a.datum.localeCompare(b.datum) || a.id.localeCompare(b.id)).slice(0, 3);
    sortiert.forEach((runde, i) => {
      const gleichrangig = rng.next() < 0.2;
      const faktor = rng.next() < 0.7 ? "1" : "1.5";
      const partizipierend = rng.next() < 0.25;
      const klasse: MitId<NeueAnteilsklasse> = {
        id: rng.uuid(),
        organisationId: orgId,
        name: `${kurz[i] ?? `Runde ${i + 1}`}-Vorzugsanteile`,
        rang: gleichrangig ? 1 : sortiert.length - i,
        praeferenzFaktor: faktor,
        partizipierend,
        capFaktor: partizipierend ? (rng.next() < 0.5 ? "3" : "2.5") : null,
        kumulierteVerzinsung: rng.next() < 0.15 ? "0.06" : null,
        umwandelbar: true,
      };
      d.anteilsklassen.push(klasse);
      for (const p of d.rundenpositionen) if (p.rundeId === runde.id) p.anteilsklasseId = klasse.id;
    });
  }
}

/** Anteile der fünf Investoren am Fonds in Prozent (Summe 100); je Fonds um eine Stelle verschoben, damit die Fonds sich unterscheiden. */
const ZEICHNUNG_PROZENT = [35, 25, 20, 12, 8] as const;

/**
 * Jeder Fonds hat die fünf Investoren mit festen Anteilen. Zusage = Zeichnungskapital × Anteil in vollen Cent (das Zeichnungskapital
 * ist ein Vielfaches von 100 Euro, daher geht es ohne Rest auf). Nach der Anpassung des Zeichnungskapitals bei großen Umfängen berechnet.
 */
function erzeugeZeichnungen(d: Demodaten, rng: Rng, investoren: { id: string }[]) {
  d.fonds.forEach((f, fi) => {
    const kapitalCent = Math.round(Number(f.zeichnungskapital) * 100);
    investoren.forEach((inv, i) => {
      const prozent = ZEICHNUNG_PROZENT[(i + fi) % ZEICHNUNG_PROZENT.length] as number;
      d.fondsZeichnungen.push({
        id: rng.uuid(),
        fondsId: f.id,
        organisationId: inv.id,
        zusage: euro((kapitalCent * prozent) / 100),
        anteil: (prozent / 100).toFixed(6),
      });
    });
  });
}

const DEMO_METHODEN = ["30E/360", "act/365", "act/360", "act/act"] as const;

/**
 * Konditionen für jedes Darlehen und Wandeldarlehen: jährliche Zinsperiode mit Ende am 31.12. des Jahres des Erstinvestments,
 * Darlehen mit den vorhandenen Zinsbuchungen 6 % nach 30E/360 (wie die Buchungen), die übrigen 5 bis 6,5 % mit wechselnder Methode.
 * Das erste aktive Darlehen bekommt zusätzlich eine gewinnabhängige Komponente mit Jahresüberschüssen bis 2026.
 */
function erzeugeKonditionen(d: Demodaten, rng: Rng) {
  const mitZins = new Set(d.vorgaenge.filter((v) => v.art === "zins").map((v) => v.beteiligungId));
  let nr = 0;
  let gewinnVergeben = false;
  for (const b of d.beteiligungen) {
    if (b.instrument !== "darlehen" && b.instrument !== "wandeldarlehen") continue;
    const jahr = Number(b.erstinvestment.slice(0, 4));
    const mitBuchung = mitZins.has(b.id);
    const gewinn = !gewinnVergeben && b.status === "aktiv";
    d.darlehenKonditionen.push({
      id: rng.uuid(),
      beteiligungId: b.id,
      instrumentId: hauptInstrumentId(b.id),
      gueltigAb: b.erstinvestment,
      satzFix: mitBuchung ? "0.060000" : (0.05 + 0.005 * (nr % 4)).toFixed(6),
      methode: mitBuchung ? "30E/360" : DEMO_METHODEN[nr % DEMO_METHODEN.length]!,
      zinsperiode: "jaehrlich",
      anker: `${jahr}-12-31`,
      gewinnabhaengigSatz: gewinn ? "0.100000" : null,
      kappungSatz: gewinn ? "0.030000" : null,
      kapitalisieren: false,
    });
    if (gewinn) {
      gewinnVergeben = true;
      for (let j = jahr; j <= 2026; j++) {
        d.jahresueberschuesse.push({ id: rng.uuid(), beteiligungId: b.id, jahr: j, betrag: euro((150_000 + ((j * 7) % 5) * 40_000) * 100) });
      }
    }
    nr++;
  }
}

// Finanzierungsrunden --------------------------------------------------------------------------------------------

type Tranche = { fondsIndex: number; valuta: string; cent: number };

/**
 * Je Portfoliounternehmen 1 bis 3 Runden. Die Tranchen aller Fonds, die in das Unternehmen investieren, werden
 * zeitlich in höchstens drei Gruppen geteilt; jede Gruppe ist eine Runde, die Position des Fonds darin ist die
 * Summe seiner Auszahlungen der Gruppe (netto nach Storno). Dazu kommen ein bis drei Co-Investoren.
 * Läuft nach allem anderen und verbraucht erst dann Zufallszahlen, damit die übrigen Demo-Daten unverändert bleiben.
 */
function erzeugeRunden(
  d: Demodaten,
  rng: Rng,
  spez: { fondsIndex: number; orgId: string }[],
  tranchenJeSpez: { valuta: string; cent: number }[][],
  fondsIds: string[],
  investoren: { id: string }[],
) {
  const jeOrg = new Map<string, Tranche[]>();
  spez.forEach((s, i) => {
    const liste = jeOrg.get(s.orgId) ?? [];
    for (const t of tranchenJeSpez[i] ?? []) liste.push({ fondsIndex: s.fondsIndex, ...t });
    jeOrg.set(s.orgId, liste);
  });
  const namen = ["Seed-Runde", "Serie-A-Runde", "Serie-B-Runde"];

  for (const [orgId, alle] of jeOrg) {
    const sortiert = [...alle].sort((a, b) => a.valuta.localeCompare(b.valuta) || a.fondsIndex - b.fondsIndex);
    if (sortiert.length === 0) continue;
    let gruppen: Tranche[][] = sortiert.map((t) => [t]);
    const maximal = rng.int(1, 3);
    while (gruppen.length > maximal) {
      // Die zeitlich nächsten Nachbarn zusammenlegen.
      let besser = 0;
      let luecke = Infinity;
      for (let i = 0; i < gruppen.length - 1; i++) {
        const l = tagesnummer((gruppen[i + 1] as Tranche[])[0]?.valuta as string) - tagesnummer((gruppen[i] as Tranche[]).at(-1)?.valuta as string);
        if (l < luecke) {
          luecke = l;
          besser = i;
        }
      }
      gruppen = [...gruppen.slice(0, besser), [...(gruppen[besser] as Tranche[]), ...(gruppen[besser + 1] as Tranche[])], ...gruppen.slice(besser + 2)];
    }

    let post = 0;
    let anteileNach = 0;
    gruppen.forEach((gruppe, k) => {
      const jeFonds = new Map<number, number>();
      for (const t of gruppe) jeFonds.set(t.fondsIndex, (jeFonds.get(t.fondsIndex) ?? 0) + t.cent);
      const fondsSumme = [...jeFonds.values()].reduce((a, b) => a + b, 0);

      const positionen: { fondsId?: string; organisationId?: string; cent: number }[] = [...jeFonds].map(([fi, cent]) => ({ fondsId: fondsIds[fi] as string, cent }));
      for (const inv of rng.mische(investoren).slice(0, rng.int(1, 3))) {
        positionen.push({ organisationId: inv.id, cent: Math.max(1_000_000, rundeCent(fondsSumme * (0.3 + rng.next() * 1.7), 1_000_000)) });
      }
      const volumen = positionen.reduce((a, p) => a + p.cent, 0);
      const pre = Math.max(10_000_000, k === 0 ? rundeCent(volumen * (2.5 + rng.next() * 4), 10_000_000) : rundeCent(post * (0.9 + rng.next() * 1.6), 10_000_000));
      post = pre + volumen;

      const anteileVor = k === 0 ? 1_000_000 : anteileNach;
      const preis = Math.round((pre / 100 / anteileVor) * 10_000) / 10_000;
      const anteile = positionen.map((p) => Math.floor(p.cent / 100 / preis));
      anteileNach = anteileVor + anteile.reduce((a, b) => a + b, 0);

      const rundeId = rng.uuid();
      d.finanzierungsrunden.push({
        id: rundeId,
        organisationId: orgId,
        bezeichnung: namen[k] ?? `Runde ${k + 1}`,
        datum: (gruppe[0] as Tranche).valuta,
        preMoney: euro(pre),
        postMoney: euro(post),
        preisJeAnteil: preis.toFixed(4),
        anteileGesamtNach: String(anteileNach),
      });

      const reihenfolge = positionen.map((_, i) => i).sort((a, b) => (positionen[b] as { cent: number }).cent - (positionen[a] as { cent: number }).cent || a - b);
      positionen.forEach((p, i) => {
        const rang = reihenfolge.indexOf(i);
        const zeile: MitId<NeueRundenposition> = {
          id: rng.uuid(),
          rundeId,
          betrag: euro(p.cent),
          anteile: String(anteile[i]),
          rolle: rang === 0 ? "lead" : rang === 1 && positionen.length >= 3 ? "co_lead" : "co",
        };
        if (p.fondsId) {
          zeile.fondsId = p.fondsId;
          const eigene = d.beteiligungen.find((b) => b.fondsId === p.fondsId && b.organisationId === orgId);
          if (eigene) zeile.instrumentId = hauptInstrumentId(eigene.id);
        }
        if (p.organisationId) zeile.vehikelId = vehikelFuer(d.vehikel, p.organisationId, zeile.id);
        d.rundenpositionen.push(zeile);
      });
    });
  }
}
