import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  customType,
  foreignKey,
  index,
  integer,
  real,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  pgView,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const erstelltAm = () => timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow();
/** Beträge immer als numeric, nie als Gleitkommazahl. Drizzle liefert sie als Zeichenkette. */
const betrag = (name: string) => numeric(name, { precision: 18, scale: 2 });

// Kontakte -------------------------------------------------------------------------------------------------------

export const organisationArt = pgEnum("organisation_art", ["unternehmen", "investor", "berater", "sonstige"]);

export const organisation = pgTable(
  "organisation",
  {
    id: id(),
    name: text("name").notNull(),
    art: organisationArt("art").notNull(),
    sektor: text("sektor"),
    /** Abschnitt der Wirtschaftszweigklassifikation NACE (Buchstabe A bis U); Grundlage der Energieintensität je klimaintensivem Sektor (ESG, Etappe 16). */
    naceAbschnitt: text("nace_abschnitt"),
    ort: text("ort"),
    website: text("website"),
    /** Rechtsform wie `GmbH` oder `AG` (Etappe 18, Abgleich mit dem Register). */
    rechtsform: text("rechtsform"),
    email: text("email"),
    telefon: text("telefon"),
    linkedin: text("linkedin"),
    /** Eigene Felder (Etappe 20): Schlüssel ist die ID der Felddefinition, Werte sind je Feldtyp geprüft (`apps/api/src/crm/felder.ts`). */
    felder: jsonb("felder").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    /** Gesetzt, wenn die Organisation archiviert wurde (weich, wie Zusammenführen; archivierte Datensätze fehlen in Listen). */
    archiviertAm: timestamp("archiviert_am", { withTimezone: true }),
    /** Gesetzt, wenn die Organisation in eine andere zusammengeführt wurde (weich, der Datensatz bleibt erhalten). */
    zusammengefuehrtIn: uuid("zusammengefuehrt_in").references((): AnyPgColumn => organisation.id),
    zusammengefuehrtAm: timestamp("zusammengefuehrt_am", { withTimezone: true }),
    erstelltAm: erstelltAm(),
  },
  (t) => [index("organisation_name_idx").on(t.name), check("organisation_nace_abschnitt", sql`${t.naceAbschnitt} IS NULL OR ${t.naceAbschnitt} ~ '^[A-U]$'`)],
);

export const person = pgTable(
  "person",
  {
    id: id(),
    vorname: text("vorname").notNull(),
    nachname: text("nachname").notNull(),
    email: text("email"),
    funktion: text("funktion"),
    telefon: text("telefon"),
    linkedin: text("linkedin"),
    felder: jsonb("felder").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    archiviertAm: timestamp("archiviert_am", { withTimezone: true }),
    /** Hauptunternehmen (Spiegel der Hauptzeile in `beschaeftigung`; viele Abfragen lesen diese Spalte). */
    organisationId: uuid("organisation_id").references(() => organisation.id),
    /** Gesetzt, wenn die Person in eine andere zusammengeführt wurde (weich, der Datensatz bleibt erhalten). */
    zusammengefuehrtIn: uuid("zusammengefuehrt_in").references((): AnyPgColumn => person.id),
    zusammengefuehrtAm: timestamp("zusammengefuehrt_am", { withTimezone: true }),
    erstelltAm: erstelltAm(),
  },
  (t) => [index("person_organisation_idx").on(t.organisationId)],
);

/** Rolle einer Person bei einer Organisation (eine Person kann mehrere haben, auch zeitlich begrenzt). */
export const kontaktRolle = pgEnum("kontakt_rolle", ["gruender", "geschaeftsfuehrung", "co_investor", "berater", "investor_lp", "sonstige"]);

export const kontaktrolle = pgTable(
  "kontaktrolle",
  {
    id: id(),
    personId: uuid("person_id").notNull().references(() => person.id),
    organisationId: uuid("organisation_id").notNull().references(() => organisation.id),
    rolle: kontaktRolle("rolle").notNull(),
    von: date("von"),
    bis: date("bis"),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    index("kontaktrolle_person_idx").on(t.personId),
    index("kontaktrolle_organisation_idx").on(t.organisationId),
    check("kontaktrolle_zeitraum", sql`${t.von} IS NULL OR ${t.bis} IS NULL OR ${t.bis} >= ${t.von}`),
  ],
);

/** Beziehung einer Organisation zu einer anderen Organisation oder zu einem Fonds (z. B. Co-Investor von, Berater von, Investor in Fonds). */
export const beziehungArt = pgEnum("beziehung_art", ["co_investor", "berater", "investor", "sonstige"]);

export const organisationsbeziehung = pgTable(
  "organisationsbeziehung",
  {
    id: id(),
    vonOrganisationId: uuid("von_organisation_id").notNull().references(() => organisation.id),
    zuOrganisationId: uuid("zu_organisation_id").references(() => organisation.id),
    fondsId: uuid("fonds_id").references(() => fonds.id),
    art: beziehungArt("art").notNull(),
    bemerkung: text("bemerkung"),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    index("organisationsbeziehung_von_idx").on(t.vonOrganisationId),
    index("organisationsbeziehung_zu_idx").on(t.zuOrganisationId),
    check("organisationsbeziehung_ein_ziel", sql`(${t.zuOrganisationId} IS NULL) <> (${t.fondsId} IS NULL)`),
    check("organisationsbeziehung_nicht_selbst", sql`${t.zuOrganisationId} IS NULL OR ${t.zuOrganisationId} <> ${t.vonOrganisationId}`),
  ],
);

// Änderungsprotokoll ---------------------------------------------------------------------------------------------

/**
 * Jede schreibende Anfrage legt ihre Zeilen in derselben Transaktion an. Die Tabelle ist nur anhängend
 * (Trigger in der Migration). `akteur` ist die ID des angemeldeten Benutzers (bzw. des technischen Benutzers eines
 * API-Schlüssels) oder `system`. Nur hinter einem vertrauenswürdigen Reverse-Proxy (`AKTEUR_HEADER_VERTRAUEN=1`,
 * Entscheidung 39) gilt ein gesendeter Header `X-Akteur`, und nur dort, wo es keine angemeldete Person gibt.
 */
export const aenderung = pgTable(
  "aenderung",
  {
    id: id(),
    am: timestamp("am", { withTimezone: true }).notNull().defaultNow(),
    /** Benutzer-ID oder `system`; `akteurName` ist der Anzeigename zum Zeitpunkt der Änderung. */
    akteur: text("akteur").notNull(),
    akteurName: text("akteur_name"),
    aktion: text("aktion").notNull(),
    tabelle: text("tabelle").notNull(),
    datensatzId: uuid("datensatz_id").notNull(),
    /** Fonds des Datensatzes, vom Trigger `aenderung_fonds_setzen` beim Schreiben ermittelt; leer bei Datensätzen ohne Fonds (Kontakte). Grundlage der Änderungsabfrage je Fonds. */
    fondsId: uuid("fonds_id"),
    vorher: jsonb("vorher"),
    nachher: jsonb("nachher"),
  },
  (t) => [
    index("aenderung_datensatz_idx").on(t.tabelle, t.datensatzId, t.am),
    index("aenderung_am_idx").on(t.am),
    index("aenderung_fonds_am_idx").on(t.fondsId, t.am, t.id),
  ],
);

// Fonds ----------------------------------------------------------------------------------------------------------

export const fonds = pgTable("fonds", {
  id: id(),
  name: text("name").notNull(),
  kurzname: text("kurzname").notNull().unique(),
  vintage: integer("vintage").notNull(),
  zeichnungskapital: betrag("zeichnungskapital").notNull(),
  /** Neu eingerichtete LP-Verteilungen rechnen mit den Zusagen als exakten Gewichten. */
  lpVerteilungNachZusage: boolean("lp_verteilung_nach_zusage").notNull().default(false),
  waehrung: text("waehrung").notNull().default("EUR"),
  /** Werte eigener Felder (Etappe 21): Schlüssel ist die ID der Felddefinition, der Wert wird von der API gegen die Definition geprüft. */
  felder: jsonb("felder").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  erstelltAm: erstelltAm(),
});

/**
 * Kapitalbewegungen zwischen Fonds und seinen Investoren: Abrufe und Ausschüttungen. Wie Vorgänge werden sie nie geändert oder
 * gelöscht; eine Korrektur ist ein Storno (Etappe 4b).
 */
export const fondsBewegungArt = pgEnum("fonds_bewegung_art", ["abruf", "ausschuettung"]);

export const fondsBewegung = pgTable(
  "fonds_bewegung",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    art: fondsBewegungArt("art").notNull(),
    faelligAm: date("faellig_am"),
    valuta: date("valuta").notNull(),
    betrag: betrag("betrag").notNull(),
    bemerkung: text("bemerkung"),
    /** Nur bei einem Storno (Gegenbuchung mit negiertem Betrag): die stornierte Bewegung. Zeilen sind unveränderlich (Trigger), wie bei `vorgang`. */
    storniertBewegungId: uuid("storniert_bewegung_id").references((): AnyPgColumn => fondsBewegung.id),
    erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fonds_bewegung_fonds_valuta_idx").on(t.fondsId, t.valuta),
    index("fonds_bewegung_fonds_erfasst_idx").on(t.fondsId, t.erfasstAm),
    uniqueIndex("fonds_bewegung_storno_uq").on(t.storniertBewegungId),
    check("fonds_bewegung_faelligkeit", sql`${t.faelligAm} IS NULL OR (${t.art} = 'abruf' AND ${t.storniertBewegungId} IS NULL AND ${t.faelligAm} >= ${t.valuta})`),
    check("fonds_bewegung_betrag_nicht_null", sql`${t.betrag} <> 0`),
  ],
);

/** Festgeschriebene Centbeträge eines Abrufs, auch nach einem späteren Closing. */
export const abrufAnteil = pgTable("abruf_anteil", {
  bewegungId: uuid("bewegung_id").notNull().references(() => fondsBewegung.id),
  organisationId: uuid("organisation_id").notNull().references(() => organisation.id),
  betrag: betrag("betrag").notNull(),
  erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.bewegungId, t.organisationId] }),
  check("abruf_anteil_nicht_negativ", sql`${t.betrag} >= 0`),
]);

export const lpZahlung = pgTable("lp_zahlung", {
  id: id(),
  bewegungId: uuid("bewegung_id").notNull(),
  organisationId: uuid("organisation_id").notNull(),
  valuta: date("valuta").notNull(),
  betrag: betrag("betrag").notNull(),
  belegreferenz: text("belegreferenz"),
  grund: text("grund"),
  storniertZahlungId: uuid("storniert_zahlung_id").references((): AnyPgColumn => lpZahlung.id),
  erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ name: "lp_zahlung_anteil_fk", columns: [t.bewegungId, t.organisationId], foreignColumns: [abrufAnteil.bewegungId, abrufAnteil.organisationId] }),
  index("lp_zahlung_abruf_idx").on(t.bewegungId, t.organisationId, t.valuta),
  uniqueIndex("lp_zahlung_storno_uq").on(t.storniertZahlungId),
  check("lp_zahlung_vorzeichen", sql`(${t.storniertZahlungId} IS NULL AND ${t.betrag} > 0) OR (${t.storniertZahlungId} IS NOT NULL AND ${t.betrag} < 0 AND ${t.grund} IS NOT NULL AND length(trim(${t.grund})) > 0)`),
]);

/**
 * Verwaltungsvergütung und weitere Fondskosten (Issue #157), verteilt auf die Kapitalkonten der Investoren. Anders als Abrufe und
 * Ausschüttungen fließt dabei kein Geld zwischen Fonds und Investoren; die Buchung mindert die Kapitalkonten. Unveränderlich wie
 * `fonds_bewegung`: Korrektur = Storno (Gegenbuchung mit negiertem Betrag und negierten Anteilen).
 */
export const fondsKostenArt = pgEnum("fonds_kosten_art", ["verwaltungsverguetung", "fondskosten"]);
/** `grundlage`: nach der Verteilungsgrundlage zur Valuta (wie Abrufe); `manuell`: Anteile je Investor ausdrücklich angegeben. */
export const fondsKostenVerteilung = pgEnum("fonds_kosten_verteilung", ["grundlage", "manuell"]);

export const fondsKosten = pgTable(
  "fonds_kosten",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    art: fondsKostenArt("art").notNull(),
    valuta: date("valuta").notNull(),
    betrag: betrag("betrag").notNull(),
    verteilung: fondsKostenVerteilung("verteilung").notNull(),
    /** Abrechnungszeitraum (optional), bei einer berechneten Vergütung mit dem Jahressatz. */
    zeitraumVon: date("zeitraum_von"),
    zeitraumBis: date("zeitraum_bis"),
    satz: numeric("satz", { precision: 9, scale: 6 }),
    bemerkung: text("bemerkung"),
    storniertKostenId: uuid("storniert_kosten_id").references((): AnyPgColumn => fondsKosten.id),
    erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fonds_kosten_fonds_valuta_idx").on(t.fondsId, t.valuta),
    uniqueIndex("fonds_kosten_storno_uq").on(t.storniertKostenId),
    check("fonds_kosten_vorzeichen", sql`(${t.storniertKostenId} IS NULL AND ${t.betrag} > 0) OR (${t.storniertKostenId} IS NOT NULL AND ${t.betrag} < 0)`),
    check("fonds_kosten_zeitraum", sql`${t.zeitraumVon} IS NULL OR ${t.zeitraumBis} IS NULL OR ${t.zeitraumBis} >= ${t.zeitraumVon}`),
    check("fonds_kosten_satz", sql`${t.satz} IS NULL OR (${t.satz} > 0 AND ${t.satz} < 1)`),
  ],
);

/** Festgeschriebene Centbeträge einer Kostenbuchung je Investor; die Summe ist der Betrag der Buchung (Trigger). */
export const fondsKostenAnteil = pgTable("fonds_kosten_anteil", {
  kostenId: uuid("kosten_id").notNull().references(() => fondsKosten.id),
  organisationId: uuid("organisation_id").notNull().references(() => organisation.id),
  betrag: betrag("betrag").notNull(),
  erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.kostenId, t.organisationId] }),
  index("fonds_kosten_anteil_organisation_idx").on(t.organisationId),
]);

// Dealflow -------------------------------------------------------------------------------------------------------

export const dealPhase = pgEnum("deal_phase", [
  "anfrage",
  "erstgespraech",
  "pruefung",
  "due_diligence",
  "investitionsausschuss",
  "closing",
]);
export const dealStatus = pgEnum("deal_status", ["offen", "abgesagt", "investiert"]);
export const dealHerkunft = pgEnum("deal_herkunft", ["anfrage", "sourcing"]);
export const dealTyp = pgEnum("deal_typ", ["erstinvestment", "anschlussinvestment"]);

export const deal = pgTable(
  "deal",
  {
    id: id(),
    organisationId: uuid("organisation_id").notNull().references(() => organisation.id),
    fondsId: uuid("fonds_id").references(() => fonds.id),
    titel: text("titel").notNull(),
    phase: dealPhase("phase").notNull().default("anfrage"),
    status: dealStatus("status").notNull().default("offen"),
    eingangsdatum: date("eingangsdatum").notNull().default(sql`(now() AT TIME ZONE 'Europe/Berlin')::date`),
    herkunft: dealHerkunft("herkunft"),
    dealtyp: dealTyp("dealtyp"),
    investmentmanagerId: uuid("investmentmanager_id").references((): AnyPgColumn => benutzer.id, { onDelete: "set null" }),
    projektleiterId: uuid("projektleiter_id").references((): AnyPgColumn => benutzer.id, { onDelete: "set null" }),
    quelle: text("quelle"),
    ticket: betrag("ticket"),
    betreuung: text("betreuung"),
    absagegrund: text("absagegrund"),
    /** Vorschlag für den Beschluss des Gremiums (Text der Gremienvorlage); ohne Angabe gilt der Beschluss „vertagt“ als Ausgangslage. Von Hand oder aus einer Beschlussvorlage des Fonds erzeugt. */
    beschlussvorschlag: text("beschlussvorschlag"),
    felder: jsonb("felder").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    erstelltAm: erstelltAm(),
    aktualisiertAm: timestamp("aktualisiert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deal_phase_status_idx").on(t.status, t.phase), index("deal_organisation_idx").on(t.organisationId)],
);

export const dealPhasenwechsel = pgTable(
  "deal_phasenwechsel",
  {
    id: id(),
    dealId: uuid("deal_id").notNull().references(() => deal.id),
    vonPhase: dealPhase("von_phase"),
    nachPhase: dealPhase("nach_phase").notNull(),
    am: date("am").notNull(),
    bemerkung: text("bemerkung"),
    /** Reihenfolge innerhalb desselben Tages (`am` kennt nur das Datum). */
    erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deal_phasenwechsel_deal_idx").on(t.dealId, t.am, t.erfasstAm)],
);

export const aktivitaetArt = pgEnum("aktivitaet_art", ["gespraech", "termin", "notiz", "mail"]);

export const aktivitaet = pgTable(
  "aktivitaet",
  {
    id: id(),
    art: aktivitaetArt("art").notNull(),
    datum: date("datum").notNull(),
    titel: text("titel").notNull(),
    notiz: text("notiz"),
    organisationId: uuid("organisation_id").references(() => organisation.id),
    personId: uuid("person_id").references(() => person.id),
    dealId: uuid("deal_id").references(() => deal.id),
    /** Datum, an dem die Aktivität wieder auf den Tisch kommt; erledigt, sobald `wiedervorlageErledigtAm` gesetzt ist. */
    wiedervorlage: date("wiedervorlage"),
    wiedervorlageErledigtAm: timestamp("wiedervorlage_erledigt_am", { withTimezone: true }),
    /** Wer die Wiedervorlage bearbeitet (Standard: wer sie angelegt hat); nur bei Aktivitäten mit Wiedervorlage gesetzt. */
    zustaendig: uuid("zustaendig").references(() => benutzer.id),
    erstelltAm: erstelltAm(),
  },
  (t) => [index("aktivitaet_zustaendig_idx").on(t.zustaendig), index("aktivitaet_wiedervorlage_idx").on(t.wiedervorlage), index("aktivitaet_deal_idx").on(t.dealId), index("aktivitaet_organisation_idx").on(t.organisationId)],
);

export const beschlussErgebnis = pgEnum("beschluss_ergebnis", ["zugestimmt", "abgelehnt", "vertagt"]);

export const beschluss = pgTable(
  "beschluss",
  {
    id: id(),
    dealId: uuid("deal_id").notNull().references(() => deal.id),
    gremium: text("gremium").notNull(),
    datum: date("datum").notNull(),
    ergebnis: beschlussErgebnis("ergebnis").notNull(),
    betrag: betrag("betrag"),
    auflagen: text("auflagen"),
    protokoll: text("protokoll"),
    /** Wer den Beschluss erfasst hat (Vier-Augen-Prinzip beim Übergang ins Portfolio); leer bei Altbestand. */
    erfasstVon: uuid("erfasst_von").references(() => benutzer.id),
    /** Fonds, für den zugestimmt wurde (Pflicht bei `zugestimmt` in der API); leer bei Altbestand, das gilt dort als nicht abgedeckt. */
    fondsId: uuid("fonds_id").references(() => fonds.id),
    erstelltAm: erstelltAm(),
  },
  (t) => [index("beschluss_deal_idx").on(t.dealId)],
);

/** Textvorlage je Fonds für den Beschlussvorschlag; Platzhalter in doppelten geschweiften Klammern (`{{organisation}}`). */
export const beschlussvorlage = pgTable(
  "beschlussvorlage",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    name: text("name").notNull(),
    text: text("text").notNull(),
    erstelltAm: erstelltAm(),
    aktualisiertAm: timestamp("aktualisiert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("beschlussvorlage_fonds_name_uq").on(t.fondsId, t.name)],
);

// Portfolio ------------------------------------------------------------------------------------------------------

/**
 * Art eines Instruments. `safe`: Vereinbarung über künftige Anteile ohne Zinsen und Laufzeit (Bewertungsobergrenze und Abschlag, Wandlung in der
 * nächsten Runde wie beim Wandeldarlehen). `optionsschein`: Recht, eine Zahl Anteile zum Ausübungspreis zu beziehen (Ausübung als Vorgang).
 */
export const instrumentArt = pgEnum("instrument_art", ["offene_beteiligung", "stille_beteiligung", "darlehen", "wandeldarlehen", "venture_debt", "gesellschafterdarlehen", "safe", "optionsschein"]);
export const beteiligungStatus = pgEnum("beteiligung_status", ["aktiv", "exit", "insolvent", "abgeschrieben"]);

export const beteiligung = pgTable(
  "beteiligung",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    organisationId: uuid("organisation_id").notNull().references(() => organisation.id),
    dealId: uuid("deal_id").references(() => deal.id),
    instrument: instrumentArt("instrument").notNull(),
    erstinvestment: date("erstinvestment").notNull(),
    status: beteiligungStatus("status").notNull().default("aktiv"),
    /** Werte eigener Felder (Etappe 21): Schlüssel ist die ID der Felddefinition, der Wert wird von der API gegen die Definition geprüft. */
    felder: jsonb("felder").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    /** Werte eigener Felder des Instruments (Etappe 21, Objekt `instrument`); spiegelt das Hauptinstrument, die Werte je Instrument stehen in `instrument.felder`. */
    instrumentFelder: jsonb("instrument_felder").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    /**
     * Lokale Währung der Beteiligung (ISO 4217, Etappe 21); leer = Fondswährung. Alle Beträge der Vorgänge und Bewertungen stehen in der Fondswährung
     * (`betrag`, `wert`); lokale Beträge stehen dazu in `betrag_lokal` und `wert_lokal`.
     */
    waehrung: text("waehrung"),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    // Je Fonds und Unternehmen eindeutig; mehrere Instrumente (auch derselben Art) hängen als `instrument` an der einen Beteiligung.
    uniqueIndex("beteiligung_fonds_organisation_uq").on(t.fondsId, t.organisationId),
    index("beteiligung_organisation_idx").on(t.organisationId),
    check("beteiligung_waehrung", sql`${t.waehrung} IS NULL OR ${t.waehrung} ~ '^[A-Z]{3}$'`),
  ],
);

/** Gremien eines Beteiligungsunternehmens, in denen der Fonds ein Mandat hält (Issue #156). */
export const gremiumArt = pgEnum("gremium_art", ["beirat", "aufsichtsrat", "board", "sonstiges"]);
export const mandatRolle = pgEnum("mandat_rolle", ["mitglied", "vorsitz", "stellvertretender_vorsitz", "beobachter"]);

/** Mandat einer Person in einem Gremium der Beteiligung; offen, solange `ende` leer ist. Änderungen stehen im Änderungsprotokoll. */
export const gremienmandat = pgTable(
  "gremienmandat",
  {
    id: id(),
    beteiligungId: uuid("beteiligung_id").notNull().references(() => beteiligung.id),
    gremium: gremiumArt("gremium").notNull(),
    /** Eigener Name des Gremiums (z. B. „Investorenbeirat“); leer = Name der Art. */
    gremiumName: text("gremium_name"),
    personId: uuid("person_id").notNull().references(() => person.id),
    rolle: mandatRolle("rolle").notNull(),
    beginn: date("beginn").notNull(),
    ende: date("ende"),
    bemerkung: text("bemerkung"),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    index("gremienmandat_beteiligung_idx").on(t.beteiligungId),
    index("gremienmandat_person_idx").on(t.personId),
    check("gremienmandat_zeitraum", sql`${t.ende} IS NULL OR ${t.ende} >= ${t.beginn}`),
  ],
);

export const instrumentStatus = pgEnum("instrument_status", ["aktiv", "gewandelt", "getilgt", "verkauft", "abgeschrieben"]);

/**
 * Instrument einer Beteiligung (Portfolio-Modell, `docs/portfolio-modell.md`): Eigenkapital, stille Beteiligung, Darlehen und so weiter.
 * Eine Beteiligung (Fonds × Unternehmen) kann mehrere Instrumente haben, auch mehrere derselben Art. Konditionen, Tranchen,
 * Vorgänge, Zinsläufe, Wandlung und Verkauf hängen am Instrument.
 */
export const instrument = pgTable(
  "instrument",
  {
    id: id(),
    beteiligungId: uuid("beteiligung_id").notNull().references(() => beteiligung.id),
    art: instrumentArt("art").notNull(),
    bezeichnung: text("bezeichnung").notNull(),
    /** Optional: die Finanzierungsrunde und Anteilsklasse, aus der das Instrument stammt. */
    rundeId: uuid("runde_id").references((): AnyPgColumn => finanzierungsrunde.id),
    anteilsklasseId: uuid("anteilsklasse_id").references((): AnyPgColumn => anteilsklasse.id),
    status: instrumentStatus("status").notNull().default("aktiv"),
    /** Werte eigener Felder des Objekts `instrument`; Schlüssel ist die ID der Felddefinition. */
    felder: jsonb("felder").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    /** Wandlungsparameter eines Wandeldarlehens (leer = nicht erfasst): Abschlag als Bruch (0.2 = 20 %), mindestens 0 und kleiner als 1. */
    wandlungsabschlag: numeric("wandlungsabschlag", { precision: 8, scale: 6 }),
    /** Bewertungsobergrenze (Cap) als Betrag, in der Währung der Beteiligung (leer = Fondswährung). */
    bewertungsobergrenze: betrag("bewertungsobergrenze"),
    /** Zinsen wandeln mit (leer = nicht erfasst; die Schätzung offener Wandlungen nimmt es dann an). */
    zinsenWandeln: boolean("zinsen_wandeln"),
    /**
     * Optionsschein (leer bei anderen Arten): Zahl der Anteile, die sich beziehen lassen (ein Anteil je Optionsschein), Ausübungspreis je Anteil in der
     * Währung der Beteiligung, Tag der Ausgabe (ab dann voll verwässert in der Kapitaltabelle) und letzter Tag der Ausübung (danach verfallen die nicht
     * ausgeübten). Die Ausübungen stehen in `optionsschein_ausuebung`, die Anteile daraus bekommen die Anteilsklasse des Instruments (leer = Stammanteile).
     */
    optionsscheinAnzahl: numeric("optionsschein_anzahl", { precision: 18, scale: 0 }),
    ausuebungspreis: numeric("ausuebungspreis", { precision: 18, scale: 4 }),
    ausgabeAm: date("ausgabe_am"),
    laufzeitBis: date("laufzeit_bis"),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    index("instrument_beteiligung_idx").on(t.beteiligungId),
    check("instrument_optionsschein_anzahl", sql`${t.optionsscheinAnzahl} IS NULL OR ${t.optionsscheinAnzahl} > 0`),
    check("instrument_ausuebungspreis", sql`${t.ausuebungspreis} IS NULL OR ${t.ausuebungspreis} >= 0`),
    check("instrument_laufzeit", sql`${t.laufzeitBis} IS NULL OR ${t.ausgabeAm} IS NULL OR ${t.laufzeitBis} >= ${t.ausgabeAm}`),
    check("instrument_wandlungsabschlag_bereich", sql`${t.wandlungsabschlag} IS NULL OR (${t.wandlungsabschlag} >= 0 AND ${t.wandlungsabschlag} < 1)`),
    check("instrument_bewertungsobergrenze_positiv", sql`${t.bewertungsobergrenze} IS NULL OR ${t.bewertungsobergrenze} > 0`),
    index("instrument_runde_idx").on(t.rundeId),
    index("instrument_anteilsklasse_idx").on(t.anteilsklasseId),
  ],
);

/** Vertraglicher Verzicht. Die zugehörigen Hauptbuchzeilen werden gemeinsam storniert. */
export const darlehenVerzicht = pgTable("darlehen_verzicht", {
  id: id(),
  instrumentId: uuid("instrument_id").notNull().references(() => instrument.id),
  datum: date("datum").notNull(),
  grund: text("grund").notNull(),
  dokumentId: uuid("dokument_id").references((): AnyPgColumn => dokument.id),
  schritte: jsonb("schritte").notNull(),
  storniertAm: timestamp("storniert_am", { withTimezone: true }),
  erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("darlehen_verzicht_instrument_idx").on(t.instrumentId)]);

export const vorgangArt = pgEnum("vorgang_art", ["zusage", "auszahlung", "rueckfluss", "zins", "tilgung", "wertberichtigung", "zinszahlung", "dividende", "principal_disposal", "impairment_disposal", "interest_waiver"]);

/**
 * Vorgänge werden nie geändert oder gelöscht (Trigger in der Migration). Eine Korrektur ist ein Storno:
 * ein neuer Vorgang derselben Art mit negiertem Betrag, der auf den stornierten verweist.
 * Summen über `betrag` ergeben damit immer den gültigen Stand.
 */
export const vorgang = pgTable(
  "vorgang",
  {
    id: id(),
    beteiligungId: uuid("beteiligung_id").notNull().references(() => beteiligung.id),
    /** Das Instrument, auf dem der Vorgang bucht (aus der Beteiligung befüllt; die Beteiligung bleibt vorerst maßgeblich für die Logik). */
    instrumentId: uuid("instrument_id").notNull().references(() => instrument.id),
    verzichtId: uuid("verzicht_id").references(() => darlehenVerzicht.id),
    darlehensverkaufId: uuid("darlehensverkauf_id").references((): AnyPgColumn => verkauf.id),
    /** Bei noch ungebuchten Zinsen der Tag, bis zu dem sie erlassen wurden. */
    zinsverzichtBis: date("zinsverzicht_bis"),
    art: vorgangArt("art").notNull(),
    valuta: date("valuta").notNull(),
    betrag: betrag("betrag").notNull(),
    bemerkung: text("bemerkung"),
    storniertVorgangId: uuid("storniert_vorgang_id").references((): AnyPgColumn => vorgang.id),
    /** Nur bei `zins`: der Betrag wurde dem Darlehenskapital zugeschlagen (Kapitalisierung). */
    kapitalisiert: boolean("kapitalisiert").notNull().default(false),
    /** Nur bei `auszahlung`: die Auszahlung gehört zu dieser Tranche (Etappe 4; bis zum Umbau `meilenstein_id`). */
    trancheId: uuid("tranche_id").references((): AnyPgColumn => tranche.id),
    /** Nur bei `zinszahlung`: die Zinsbuchung (`zins`), die der Geldeingang begleicht. */
    beglichenVorgangId: uuid("beglichen_vorgang_id").references((): AnyPgColumn => vorgang.id),
    /** Werte eigener Felder (Etappe 21), nur beim Anlegen gesetzt (die Zeile ist unveränderlich); ein Storno übernimmt sie vom Original. Schlüssel ist die ID der Felddefinition, der Wert wird von der API gegen die Definition geprüft. */
    felder: jsonb("felder").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    /**
     * Betrag in der lokalen Währung der Beteiligung (Etappe 21) mit dem festgehaltenen Kurs (Fondswährung je lokaler Einheit, `betrag` = `betrag_lokal` × `kurs`
     * gerundet oder, bei beiden Angaben, der daraus abgeleitete Kurs). `kurs_id` nennt den Kurseintrag, wenn er aus der Kurstabelle stammt. Beides leer bei Beteiligungen in Fondswährung.
     */
    betragLokal: betrag("betrag_lokal"),
    kurs: numeric("kurs", { precision: 24, scale: 12 }),
    kursId: uuid("kurs_id").references((): AnyPgColumn => wechselkurs.id),
    erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("vorgang_lokal", sql`(${t.betragLokal} IS NULL) = (${t.kurs} IS NULL)`),
    index("vorgang_beteiligung_valuta_idx").on(t.beteiligungId, t.valuta),
    index("vorgang_beteiligung_erfasst_idx").on(t.beteiligungId, t.erfasstAm),
    index("vorgang_instrument_valuta_idx").on(t.instrumentId, t.valuta),
    uniqueIndex("vorgang_storno_uq").on(t.storniertVorgangId),
    index("vorgang_verzicht_idx").on(t.verzichtId).where(sql`${t.verzichtId} IS NOT NULL`),
    index("vorgang_darlehensverkauf_idx").on(t.darlehensverkaufId).where(sql`${t.darlehensverkaufId} IS NOT NULL`),
    index("vorgang_valuta_idx").on(t.valuta, t.erfasstAm, t.id),
  ],
);

export const bewertungMethode = pgEnum("bewertung_methode", [
  "anschaffungskosten",
  "letzte_runde",
  "multiplikator",
  "dcf",
  "sonstige",
]);

/**
 * Status einer Bewertung: `entwurf` zählt nirgends, `freigegeben` gilt, `ersetzt` war freigegeben und gilt nicht mehr
 * (ersetzt durch eine Korrektur oder zurückgenommen, z. B. beim Storno eines Verkaufs), `verworfen` war ein Entwurf,
 * der nie galt. Eine freigegebene Bewertung wird nie geändert (Trigger); eine Korrektur ist eine neue Bewertung
 * zum selben Stichtag, die die alte ersetzt.
 */
export const bewertungStatus = pgEnum("bewertung_status", ["entwurf", "freigegeben", "ersetzt", "verworfen"]);
export const bewertungsrundeStatus = pgEnum("bewertungsrunde_status", ["entwurf", "freigegeben", "verworfen"]);
export const rundenVorschlag = pgEnum("runden_vorschlag", ["fortschreiben", "letzte_runde"]);

/** Massen-Neubewertung eines Fonds zu einem Stichtag: bündelt Entwürfe, die zusammen freigegeben werden. */
export const bewertungsrunde = pgTable(
  "bewertungsrunde",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    stichtag: date("stichtag").notNull(),
    vorschlag: rundenVorschlag("vorschlag").notNull(),
    status: bewertungsrundeStatus("status").notNull().default("entwurf"),
    erstelltVon: text("erstellt_von").notNull(),
    erstelltAm: erstelltAm(),
    freigegebenVon: text("freigegeben_von"),
    freigegebenAm: timestamp("freigegeben_am", { withTimezone: true }),
    /** Beteiligungen, für die beim Anlegen kein Entwurf entstand (mit Grund); bleibt mit der Runde erhalten. */
    uebersprungen: jsonb("uebersprungen").notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [index("bewertungsrunde_fonds_idx").on(t.fondsId, t.stichtag)],
);

export const bewertung = pgTable(
  "bewertung",
  {
    id: id(),
    beteiligungId: uuid("beteiligung_id").notNull().references(() => beteiligung.id),
    stichtag: date("stichtag").notNull(),
    wert: betrag("wert").notNull(),
    methode: bewertungMethode("methode").notNull(),
    begruendung: text("begruendung"),
    /** Freitext zur Grundlage (Quelle, Vergleichsrunde, Multiplikator o. Ä.). */
    grundlage: text("grundlage"),
    /** Ohne Angabe `entwurf`: eine Bewertung zählt nur, wenn ein Weg im Code sie freigibt. */
    status: bewertungStatus("status").notNull().default("entwurf"),
    erstelltVon: text("erstellt_von").notNull().default("system"),
    freigegebenVon: text("freigegeben_von"),
    freigegebenAm: timestamp("freigegeben_am", { withTimezone: true }),
    /** Gesetzt, wenn die Bewertung nicht mehr gilt (Status `ersetzt`); ab hier zählt sie im Wissensstand nicht mehr. */
    ersetztAm: timestamp("ersetzt_am", { withTimezone: true }),
    /** Die freigegebene Bewertung desselben Stichtags, die diese ersetzt (Historie). */
    ersetztBewertungId: uuid("ersetzt_bewertung_id").references((): AnyPgColumn => bewertung.id),
    bewertungsrundeId: uuid("bewertungsrunde_id").references(() => bewertungsrunde.id),
    /** Wert in der lokalen Währung der Beteiligung mit dem festgehaltenen Kurs zum Stichtag (Etappe 21); siehe `vorgang.betrag_lokal`. */
    wertLokal: betrag("wert_lokal"),
    kurs: numeric("kurs", { precision: 24, scale: 12 }),
    kursId: uuid("kurs_id").references((): AnyPgColumn => wechselkurs.id),
    erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("bewertung_lokal", sql`(${t.wertLokal} IS NULL) = (${t.kurs} IS NULL)`),
    uniqueIndex("bewertung_freigegeben_uq").on(t.beteiligungId, t.stichtag).where(sql`${t.status} = 'freigegeben'`),
    uniqueIndex("bewertung_entwurf_uq").on(t.beteiligungId, t.stichtag).where(sql`${t.status} = 'entwurf'`),
    index("bewertung_beteiligung_stichtag_idx").on(t.beteiligungId, t.stichtag),
    index("bewertung_beteiligung_erfasst_idx").on(t.beteiligungId, t.erfasstAm),
    index("bewertung_runde_idx").on(t.bewertungsrundeId),
  ],
);

// Finanzierungsrunden --------------------------------------------------------------------------------------------

export const rundenRolle = pgEnum("runden_rolle", ["lead", "co_lead", "co"]);
/** Entwurf: manuell angelegt und noch änderbar, zählt nirgends. Abgeschlossen: gilt (Import, Wandlung und Altbestand sind abgeschlossen). */
export const rundeStatus = pgEnum("runde_status", ["entwurf", "abgeschlossen"]);

/**
 * Anteilsklasse eines Unternehmens (Etappe 10, Exit-Wasserfall). `rang` 1 ist die höchste Rangstufe, gleicher Rang ist pari passu.
 * `praeferenzFaktor` ist das Vielfache des investierten Betrags (1.0, 1.5 …); `capFaktor` begrenzt den Gesamtrückfluss einer
 * partizipierenden Klasse; `kumulierteVerzinsung` ist ein einfacher Zinssatz je Jahr als Bruch (0.08 = 8 %) auf den Präferenzbetrag ab
 * dem Rundendatum. Positionen ohne Klasse gelten als Stammanteile.
 */
export const anteilsklasse = pgTable(
  "anteilsklasse",
  {
    id: id(),
    organisationId: uuid("organisation_id").notNull().references(() => organisation.id),
    name: text("name").notNull(),
    rang: integer("rang").notNull().default(1),
    praeferenzFaktor: numeric("praeferenz_faktor", { precision: 8, scale: 4 }).notNull().default("1"),
    partizipierend: boolean("partizipierend").notNull().default(false),
    capFaktor: numeric("cap_faktor", { precision: 8, scale: 4 }),
    kumulierteVerzinsung: numeric("kumulierte_verzinsung", { precision: 8, scale: 6 }),
    umwandelbar: boolean("umwandelbar").notNull().default(true),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    uniqueIndex("anteilsklasse_organisation_name_uq").on(t.organisationId, t.name),
    check("anteilsklasse_rang", sql`${t.rang} >= 1`),
    check("anteilsklasse_faktor", sql`${t.praeferenzFaktor} >= 0`),
    check("anteilsklasse_cap", sql`${t.capFaktor} IS NULL OR (${t.partizipierend} AND ${t.capFaktor} >= ${t.praeferenzFaktor})`),
    check("anteilsklasse_verzinsung", sql`${t.kumulierteVerzinsung} IS NULL OR ${t.kumulierteVerzinsung} >= 0`),
  ],
);

/**
 * Art einer Finanzierungsrunde: `eigenkapital` ist die bewertete Runde mit Anteilen; `bruecke` ist eine Brückenrunde (Darlehen zwischen zwei Runden)
 * ohne Bewertung und ohne Anteile. Eine Brückenrunde verändert Kapitaltabelle, Wasserfall, Kennzahlen und Bewertung nie.
 */
export const rundenArt = pgEnum("runden_art", ["eigenkapital", "bruecke"]);

/**
 * Finanzierungsrunde eines Unternehmens. Post-Money = Pre-Money + Rundenvolumen (Summe der Positionen).
 * `anteileGesamtNach` ist die Zahl aller Anteile nach der Runde, `preisJeAnteil` der Ausgabepreis.
 * Bei einer Brückenrunde (`art` = `bruecke`) sind die vier Bewertungsfelder leer, bei Eigenkapital alle gesetzt.
 */
export const finanzierungsrunde = pgTable(
  "finanzierungsrunde",
  {
    id: id(),
    organisationId: uuid("organisation_id").notNull().references(() => organisation.id),
    bezeichnung: text("bezeichnung").notNull(),
    datum: date("datum").notNull(),
    art: rundenArt("art").notNull().default("eigenkapital"),
    preMoney: betrag("pre_money"),
    postMoney: betrag("post_money"),
    preisJeAnteil: numeric("preis_je_anteil", { precision: 18, scale: 4 }),
    anteileGesamtNach: numeric("anteile_gesamt_nach", { precision: 18, scale: 0 }),
    status: rundeStatus("status").notNull().default("abgeschlossen"),
    abgeschlossenAm: timestamp("abgeschlossen_am", { withTimezone: true }),
    abgeschlossenVon: text("abgeschlossen_von"),
    /** Letzte Wiedereröffnung durch einen Verwalter mit Begründung (die Historie steht im Änderungsprotokoll). */
    wiedergeoeffnetAm: timestamp("wiedergeoeffnet_am", { withTimezone: true }),
    wiedergeoeffnetVon: text("wiedergeoeffnet_von"),
    wiedereroeffnungGrund: text("wiedereroeffnung_grund"),
    /** Werte eigener Felder (Etappe 21): Schlüssel ist die ID der Felddefinition, der Wert wird von der API gegen die Definition geprüft. */
    felder: jsonb("felder").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    index("finanzierungsrunde_organisation_idx").on(t.organisationId, t.datum),
    check(
      "finanzierungsrunde_bewertung_je_art",
      sql`${t.art} <> 'eigenkapital' OR (${t.preMoney} IS NOT NULL AND ${t.postMoney} IS NOT NULL AND ${t.preisJeAnteil} IS NOT NULL AND ${t.anteileGesamtNach} IS NOT NULL)`,
    ),
  ],
);

export const vehikelArt = pgEnum("vehikel_art", ["fonds", "gesellschaft", "spv", "sonstige"]);
export const vehikelStatus = pgEnum("vehikel_status", ["aktiv", "in_liquidation", "aufgeloest"]);

/**
 * Investitionsvehikel eines Co-Investors: der Fonds oder die Gesellschaft, die tatsächlich investiert (docs/portfolio-modell.md, „Vehikel der
 * Co-Investoren“). Jedes Vehikel gehört genau einem Investor (Organisation). Höchstens ein Standard-Vehikel je Investor; es nimmt Positionen auf,
 * die nur den Investor nennen (Datenübernahme, ältere Aufrufe).
 */
export const vehikel = pgTable(
  "vehikel",
  {
    id: id(),
    investorId: uuid("investor_id")
      .notNull()
      .references(() => organisation.id),
    name: text("name").notNull(),
    art: vehikelArt("art").notNull().default("fonds"),
    auflagejahr: integer("auflagejahr"),
    status: vehikelStatus("status").notNull().default("aktiv"),
    standard: boolean("standard").notNull().default(false),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    uniqueIndex("vehikel_investor_name_uq").on(t.investorId, t.name),
    uniqueIndex("vehikel_standard_uq")
      .on(t.investorId)
      .where(sql`${t.standard}`),
    check("vehikel_auflagejahr", sql`${t.auflagejahr} IS NULL OR ${t.auflagejahr} BETWEEN 1900 AND 2100`),
  ],
);

/** Beitrag zu einer Runde: entweder ein Fonds dieser Plattform oder ein Vehikel eines Co-Investors (der Investor ist der des Vehikels). */
export const rundenposition = pgTable(
  "rundenposition",
  {
    id: id(),
    rundeId: uuid("runde_id").notNull().references(() => finanzierungsrunde.id),
    fondsId: uuid("fonds_id").references(() => fonds.id),
    vehikelId: uuid("vehikel_id").references(() => vehikel.id),
    betrag: betrag("betrag").notNull(),
    anteile: numeric("anteile", { precision: 18, scale: 0 }).notNull(),
    rolle: rundenRolle("rolle").notNull(),
    /** Klasse der erworbenen Anteile; leer = Stammanteile. Gehört zum selben Unternehmen wie die Runde (API prüft). */
    anteilsklasseId: uuid("anteilsklasse_id").references(() => anteilsklasse.id),
    /** Nur bei Positionen eigener Fonds: das Instrument, das aus der Position entstanden ist. */
    instrumentId: uuid("instrument_id").references((): AnyPgColumn => instrument.id),
  },
  (t) => [
    index("rundenposition_runde_idx").on(t.rundeId),
    index("rundenposition_vehikel_idx").on(t.vehikelId),
    // Je Runde höchstens eine Position je Vehikel und je eigenem Fonds (die API prüft es zusätzlich mit klarer Meldung).
    uniqueIndex("rundenposition_runde_vehikel_uq").on(t.rundeId, t.vehikelId).where(sql`${t.vehikelId} IS NOT NULL`),
    uniqueIndex("rundenposition_runde_fonds_uq").on(t.rundeId, t.fondsId).where(sql`${t.fondsId} IS NOT NULL`),
    check("rundenposition_ein_investor", sql`(${t.fondsId} IS NULL) <> (${t.vehikelId} IS NULL)`),
  ],
);

// Mitarbeiterbeteiligung (ESOP/VSOP) ------------------------------------------------------------------------------

/** `esop`: Optionen auf echte Anteile; `vsop`: virtuelle Anteile mit Auszahlung in Geld. */
export const mitarbeiterProgrammArt = pgEnum("mitarbeiter_programm_art", ["esop", "vsop"]);
/** Wer die Auszahlung beim Exit trägt: `wie_anteile` (teilt den Rest wie Stammanteile), `anteilig` (mindert alle Rückflüsse im gleichen Verhältnis, nur VSOP). */
export const mitarbeiterRegel = pgEnum("mitarbeiter_regel", ["wie_anteile", "anteilig"]);
/** Schaffung oder Aufstockung eines Pools im Pre-Money (vor dem Preis der Runde) oder im Post-Money einer Runde. */
export const poolBasis = pgEnum("pool_basis", ["pre_money", "post_money"]);
/** Kategorie einer Zuteilung; Zuteilungen brauchen keinen Personennamen. */
export const zuteilungKategorie = pgEnum("zuteilung_kategorie", ["gruender", "fuehrung", "mitarbeitende", "beirat", "sonstige"]);
export const zuteilungStatus = pgEnum("zuteilung_status", ["zugeteilt", "gevestet", "verfallen", "ausgeuebt"]);
/** Art des Austritts (Leaver) und Regel für die bei Austritt gevesteten Einheiten. */
export const leaverArt = pgEnum("leaver_art", ["good_leaver", "bad_leaver"]);
export const leaverGevestet = pgEnum("leaver_gevestet", ["bleiben", "verfallen", "rueckkauf"]);

/**
 * Pool der Mitarbeiterbeteiligung eines Unternehmens (wie Anteilsklassen am Unternehmen, nicht am Fonds). Die Größe ist die Summe der
 * Änderungen (`pool_aenderung`) bis zum Stichtag. Pool und Zuteilungen sind keine Rundenpositionen.
 */
export const mitarbeiterpool = pgTable(
  "mitarbeiterpool",
  {
    id: id(),
    organisationId: uuid("organisation_id").notNull().references(() => organisation.id),
    art: mitarbeiterProgrammArt("art").notNull(),
    bezeichnung: text("bezeichnung").notNull(),
    regel: mitarbeiterRegel("regel").notNull().default("wie_anteile"),
    notiz: text("notiz"),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    uniqueIndex("mitarbeiterpool_organisation_bezeichnung_uq").on(t.organisationId, t.bezeichnung),
    check("mitarbeiterpool_regel_nur_vsop", sql`${t.art} = 'vsop' OR ${t.regel} = 'wie_anteile'`),
  ],
);

/** Schaffung, Aufstockung oder Verkleinerung eines Pools mit Datum und Beschluss; optional einer Runde zugeordnet (Pre- oder Post-Money). */
export const poolAenderung = pgTable(
  "pool_aenderung",
  {
    id: id(),
    poolId: uuid("pool_id").notNull().references(() => mitarbeiterpool.id),
    datum: date("datum").notNull(),
    anzahl: numeric("anzahl", { precision: 18, scale: 0 }).notNull(),
    beschluss: text("beschluss"),
    rundeId: uuid("runde_id").references(() => finanzierungsrunde.id),
    basis: poolBasis("basis"),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    index("pool_aenderung_pool_idx").on(t.poolId, t.datum),
    check("pool_aenderung_anzahl", sql`${t.anzahl} <> 0`),
    check("pool_aenderung_basis_mit_runde", sql`(${t.rundeId} IS NULL) = (${t.basis} IS NULL)`),
  ],
);

/**
 * Zuteilung aus einem Pool, aggregiert oder nach Kategorie (ohne Personennamen). Vesting linear je vollem Monat ab `vestingBeginn` (leer:
 * Zuteilungsdatum) mit Cliff; `beschleunigung` ist der Bruch der ungevesteten Einheiten, der beim Exit vestet. `verfallen` und `ausgeuebt`
 * gelten ab `statusAm`. Austritte (Leaver) stehen in `zuteilung_austritt`; `leaverRegel` ist eine Notiz dazu.
 */
export const mitarbeiterzuteilung = pgTable(
  "mitarbeiterzuteilung",
  {
    id: id(),
    poolId: uuid("pool_id").notNull().references(() => mitarbeiterpool.id),
    kategorie: zuteilungKategorie("kategorie").notNull(),
    bezeichnung: text("bezeichnung"),
    anzahl: numeric("anzahl", { precision: 18, scale: 0 }).notNull(),
    basispreis: numeric("basispreis", { precision: 18, scale: 4 }).notNull().default("0"),
    zugeteiltAm: date("zugeteilt_am").notNull(),
    vestingBeginn: date("vesting_beginn"),
    cliffMonate: integer("cliff_monate").notNull().default(12),
    vestingMonate: integer("vesting_monate").notNull().default(48),
    beschleunigung: numeric("beschleunigung", { precision: 5, scale: 4 }).notNull().default("0"),
    status: zuteilungStatus("status").notNull().default("zugeteilt"),
    statusAm: date("status_am"),
    leaverRegel: text("leaver_regel"),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    index("mitarbeiterzuteilung_pool_idx").on(t.poolId),
    check("mitarbeiterzuteilung_anzahl", sql`${t.anzahl} > 0`),
    check("mitarbeiterzuteilung_basispreis", sql`${t.basispreis} >= 0`),
    check("mitarbeiterzuteilung_vesting", sql`${t.cliffMonate} >= 0 AND ${t.vestingMonate} >= 0`),
    check("mitarbeiterzuteilung_beschleunigung", sql`${t.beschleunigung} >= 0 AND ${t.beschleunigung} <= 1`),
    check("mitarbeiterzuteilung_status_am", sql`${t.status} NOT IN ('verfallen', 'ausgeuebt') OR ${t.statusAm} IS NOT NULL`),
  ],
);

/**
 * Austritt (Leaver) aus einer Zuteilung; eine aggregierte Zuteilung kann mehrere haben. `anzahl` = betroffene Einheiten (Summe über alle
 * Austritte einer Zuteilung ≤ ihre Anzahl, prüft die API), `gevestet` = Regel für die bei Austritt gevesteten Einheiten, `rueckkaufpreis`
 * nur bei Rückkauf (leer: Basispreis). Ab `austrittAm` friert das Vesting der betroffenen Einheiten ein, der ungevestete Teil verfällt
 * (Rechenkern `aufteilung`).
 */
export const zuteilungAustritt = pgTable(
  "zuteilung_austritt",
  {
    id: id(),
    zuteilungId: uuid("zuteilung_id")
      .notNull()
      .references(() => mitarbeiterzuteilung.id, { onDelete: "cascade" }),
    art: leaverArt("art").notNull(),
    austrittAm: date("austritt_am").notNull(),
    anzahl: numeric("anzahl", { precision: 18, scale: 0 }).notNull(),
    gevestet: leaverGevestet("gevestet").notNull(),
    rueckkaufpreis: numeric("rueckkaufpreis", { precision: 18, scale: 4 }),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    index("zuteilung_austritt_zuteilung_idx").on(t.zuteilungId),
    check("zuteilung_austritt_anzahl", sql`${t.anzahl} > 0`),
    check("zuteilung_austritt_rueckkaufpreis", sql`${t.rueckkaufpreis} IS NULL OR (${t.gevestet} = 'rueckkauf' AND ${t.rueckkaufpreis} >= 0)`),
  ],
);

export const rundenZahlungArt = pgEnum("runden_zahlung_art", ["einzahlung", "rueckzahlung"]);

/**
 * Zahlung eines Co-Investors auf seine Position (nur Positionen von Vehikeln). Rein informativ: Sie geht in keine Kennzahl
 * des eigenen Fonds ein. Gezahlt = Einzahlungen minus Rückzahlungen, offen = Zusage minus Gezahlt.
 */
export const rundenpositionZahlung = pgTable(
  "rundenposition_zahlung",
  {
    id: id(),
    positionId: uuid("position_id").notNull().references(() => rundenposition.id),
    datum: date("datum").notNull(),
    art: rundenZahlungArt("art").notNull(),
    betrag: betrag("betrag").notNull(),
    bemerkung: text("bemerkung"),
    erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rundenposition_zahlung_position_idx").on(t.positionId, t.datum), check("rundenposition_zahlung_betrag_positiv", sql`${t.betrag} > 0`)],
);

/**
 * Vorgänge, die das Abschließen einer Runde für den eigenen Fonds gebucht hat (Zusage und erste Auszahlungen). Sie verhindern, dass
 * ein erneutes Abschließen nach einer Wiedereröffnung die Zusage zweimal bucht, und machen die Herkunft im Journal sichtbar.
 */
export const rundeBuchung = pgTable(
  "runde_buchung",
  {
    vorgangId: uuid("vorgang_id").primaryKey().references(() => vorgang.id),
    rundeId: uuid("runde_id").notNull().references(() => finanzierungsrunde.id),
    positionId: uuid("position_id").notNull().references(() => rundenposition.id),
    art: vorgangArt("art").notNull(),
    erstelltAm: erstelltAm(),
  },
  (t) => [index("runde_buchung_runde_idx").on(t.rundeId), index("runde_buchung_position_idx").on(t.positionId)],
);

export const vorgangRundeQuelle = pgEnum("vorgang_runde_quelle", ["automatisch", "manuell"]);

/**
 * Zuordnung eines Vorgangs zu einer Finanzierungsrunde des Unternehmens (Historie aller Transaktionen je Runde). Der Vorgang selbst ist unveränderlich,
 * die Zuordnung nicht: Sie ist veränderbar und jede Änderung steht im Änderungsprotokoll. Fehlt die Zeile, gehört der Vorgang keiner Runde. `quelle`:
 * `automatisch` aus Instrument, Wandlung oder Storno, `manuell` bei ausdrücklicher Angabe oder nachträglicher Änderung.
 */
export const vorgangRunde = pgTable(
  "vorgang_runde",
  {
    vorgangId: uuid("vorgang_id").primaryKey().references(() => vorgang.id),
    rundeId: uuid("runde_id").notNull().references(() => finanzierungsrunde.id),
    quelle: vorgangRundeQuelle("quelle").notNull(),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
    geaendertVon: text("geaendert_von"),
  },
  (t) => [index("vorgang_runde_runde_idx").on(t.rundeId)],
);

// Kennzahlen-Snapshots -------------------------------------------------------------------------------------------

/**
 * Gespeicherte Fondsübersicht je Stichtag (Performance-Regel 1: Seiten lesen, Jobs rechnen).
 * `standBis` ist der jüngste Erfassungszeitpunkt der Eingangsdaten bei der Berechnung; sind neuere
 * Eingangsdaten vorhanden, gilt der Snapshot als veraltet.
 */
export const kennzahlSnapshot = pgTable(
  "kennzahl_snapshot",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    stichtag: date("stichtag").notNull(),
    standBis: timestamp("stand_bis", { withTimezone: true }),
    berechnetAm: timestamp("berechnet_am", { withTimezone: true }).notNull().defaultNow(),
    daten: jsonb("daten").notNull(),
  },
  (t) => [uniqueIndex("kennzahl_snapshot_fonds_stichtag_uq").on(t.fondsId, t.stichtag)],
);

/**
 * Ausgangskorb für Neuberechnungen: Trigger auf vorgang, bewertung und fonds_bewegung legen je Fonds eine
 * Zeile an (`stichtag` leer = alle Stichtage mit Snapshot), `POST /fonds/:id/neuberechnen` je Stichtag.
 * Der Worker übergibt die Zeilen an pg-boss und entfernt sie.
 */
export const snapshotAuftrag = pgTable(
  "snapshot_auftrag",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    stichtag: date("stichtag"),
    angelegtAm: timestamp("angelegt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("snapshot_auftrag_alle_uq").on(t.fondsId).where(sql`${t.stichtag} IS NULL`),
    uniqueIndex("snapshot_auftrag_stichtag_uq").on(t.fondsId, t.stichtag).where(sql`${t.stichtag} IS NOT NULL`),
  ],
);

// Instrumente: Konditionen, Jahresüberschuss, Meilensteine (Etappe 4) -----------------------------------------------

export const zinsmethode = pgEnum("zinsmethode", ["30E/360", "act/360", "act/365", "act/act"]);
export const zinsperiodenart = pgEnum("zinsperiodenart", ["jaehrlich", "quartalsweise", "endfaellig"]);

/**
 * Konditionen eines Darlehens, Wandeldarlehens oder einer stillen Beteiligung, versioniert über `gueltigAb`:
 * Eine Vertragsänderung ist eine neue Zeile. Zinssätze sind Anteile (0,06 = 6 %). Eine Periode rechnet mit der
 * Version, die am letzten Tag der Periode gilt; vor der ersten Version gilt die erste. Zinsperiode und Anker
 * (das Periodenraster) bleiben über alle Versionen gleich.
 */
export const darlehenKondition = pgTable(
  "darlehen_kondition",
  {
    id: id(),
    beteiligungId: uuid("beteiligung_id").notNull().references(() => beteiligung.id),
    instrumentId: uuid("instrument_id").notNull().references(() => instrument.id),
    gueltigAb: date("gueltig_ab").notNull(),
    satzFix: numeric("satz_fix", { precision: 10, scale: 6 }).notNull(),
    methode: zinsmethode("methode").notNull(),
    zinsperiode: zinsperiodenart("zinsperiode").notNull(),
    anker: date("anker").notNull(),
    /** Gewinnabhängige Komponente: Anteil am Jahresüberschuss und Kappung als Jahreszins auf das durchschnittliche Kapital. */
    gewinnabhaengigSatz: numeric("gewinnabhaengig_satz", { precision: 10, scale: 6 }),
    kappungSatz: numeric("kappung_satz", { precision: 10, scale: 6 }),
    stundungBis: date("stundung_bis"),
    kapitalisieren: boolean("kapitalisieren").notNull().default(false),
    /** Laufzeitende. */
    faelligAm: date("faellig_am"),
    erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("darlehen_kondition_instrument_ab_uq").on(t.instrumentId, t.gueltigAb),
    index("darlehen_kondition_instrument_idx").on(t.instrumentId),
    check("darlehen_kondition_satz_bereich", sql`${t.satzFix} >= 0 AND ${t.satzFix} <= 1`),
    check(
      "darlehen_kondition_gewinn_paar",
      sql`(${t.gewinnabhaengigSatz} IS NULL) = (${t.kappungSatz} IS NULL)`,
    ),
  ],
);

/** Jahresüberschuss des Unternehmens je Kalenderjahr, Bemessung der gewinnabhängigen Verzinsung. Darf negativ sein. */
export const jahresueberschuss = pgTable(
  "jahresueberschuss",
  {
    id: id(),
    beteiligungId: uuid("beteiligung_id").notNull().references(() => beteiligung.id),
    jahr: integer("jahr").notNull(),
    betrag: betrag("betrag").notNull(),
    erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("jahresueberschuss_beteiligung_jahr_uq").on(t.beteiligungId, t.jahr)],
);

/**
 * Tranche der Zusage eines Instruments (bisher `meilenstein`): der Plan, wann welcher Teil der Zusage fließt. Sie bucht kein Geld.
 * Eine Auszahlung mit `vorgang.trancheId` ist bei gesetzter Bedingung erst bei erfüllter Bedingung zulässig.
 */
export const tranche = pgTable(
  "tranche",
  {
    id: id(),
    beteiligungId: uuid("beteiligung_id").notNull().references(() => beteiligung.id),
    instrumentId: uuid("instrument_id").notNull().references(() => instrument.id),
    /** Laufende Nummer je Instrument (1, 2, …) in der Reihenfolge der Anlage. */
    nummer: integer("nummer"),
    bezeichnung: text("bezeichnung").notNull(),
    bedingung: text("bedingung"),
    geplantAm: date("geplant_am"),
    betrag: betrag("betrag").notNull(),
    erfuelltAm: date("erfuellt_am"),
    nachweis: text("nachweis"),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    index("tranche_beteiligung_idx").on(t.beteiligungId),
    index("tranche_instrument_idx").on(t.instrumentId),
    check("tranche_betrag_positiv", sql`${t.betrag} > 0`),
  ],
);

// Zinslauf (Etappe 4) -------------------------------------------------------------------------------------------

export const zinslaufStatus = pgEnum("zinslauf_status", ["berechnet", "geprueft", "freigegeben", "gebucht", "verworfen"]);

/**
 * Zinslauf eines Fonds zu einem Stichtag. Statusfolge berechnet, geprüft, freigegeben, gebucht (oder verworfen vor der Buchung).
 * Die Akteure je Stufe stehen am Lauf; die Freigabe verlangt einen anderen Akteur als die Prüfung. Das ist bis zur
 * Anmeldung (Etappe 8) ein Platzhalter auf den protokollierten Akteurwerten. `abgedeckt` hält fest, welche Darlehen
 * der Lauf betrachtet hat, damit der Kontrollbericht später Lücken findet.
 */
export const zinslauf = pgTable(
  "zinslauf",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    stichtag: date("stichtag").notNull(),
    status: zinslaufStatus("status").notNull().default("berechnet"),
    berechnetVon: text("berechnet_von").notNull(),
    berechnetAm: timestamp("berechnet_am", { withTimezone: true }).notNull().defaultNow(),
    geprueftVon: text("geprueft_von"),
    geprueftAm: timestamp("geprueft_am", { withTimezone: true }),
    freigegebenVon: text("freigegeben_von"),
    freigegebenAm: timestamp("freigegeben_am", { withTimezone: true }),
    gebuchtVon: text("gebucht_von"),
    gebuchtAm: timestamp("gebucht_am", { withTimezone: true }),
    verworfenVon: text("verworfen_von"),
    verworfenAm: timestamp("verworfen_am", { withTimezone: true }),
    abgedeckt: jsonb("abgedeckt").notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [index("zinslauf_fonds_stichtag_idx").on(t.fondsId, t.stichtag, t.berechnetAm)],
);

/** Eine Zinsperiode eines Darlehens im Lauf. Beträge ungerundet (Fix, Gewinn, Gesamt) und gebucht (Cent). */
export const zinslaufPosition = pgTable(
  "zinslauf_position",
  {
    id: id(),
    zinslaufId: uuid("zinslauf_id").notNull().references(() => zinslauf.id),
    beteiligungId: uuid("beteiligung_id").notNull().references(() => beteiligung.id),
    instrumentId: uuid("instrument_id").references(() => instrument.id),
    konditionId: uuid("kondition_id").references(() => darlehenKondition.id),
    von: date("von").notNull(),
    bis: date("bis").notNull(),
    faelligAm: date("faellig_am").notNull(),
    gestundet: boolean("gestundet").notNull(),
    betragFix: numeric("betrag_fix").notNull(),
    betragGewinn: numeric("betrag_gewinn").notNull(),
    betragGesamt: numeric("betrag_gesamt").notNull(),
    betragGebucht: betrag("betrag_gebucht").notNull(),
    kapitalisiert: boolean("kapitalisiert").notNull(),
    kapitalien: jsonb("kapitalien").notNull(),
    schritte: jsonb("schritte").notNull(),
    /** Gesetzt bei der Buchung (nicht bei Betrag 0). */
    vorgangId: uuid("vorgang_id").references(() => vorgang.id),
  },
  (t) => [index("zinslauf_position_lauf_idx").on(t.zinslaufId), index("zinslauf_position_beteiligung_idx").on(t.beteiligungId, t.bis), index("zinslauf_position_vorgang_idx").on(t.vorgangId)],
);

/**
 * Gebuchte Zinsperiode eines Darlehens. Der eindeutige Index verhindert die doppelte Buchung auch bei gleichzeitigen
 * Läufen. Ein Storno der Zinsbuchung gibt die Periode wieder frei (Zeile wird gelöscht).
 */
export const zinsperiodeGebucht = pgTable(
  "zinsperiode_gebucht",
  {
    id: id(),
    beteiligungId: uuid("beteiligung_id").notNull().references(() => beteiligung.id),
    instrumentId: uuid("instrument_id").notNull().references(() => instrument.id),
    periodeBis: date("periode_bis").notNull(),
    zinslaufPositionId: uuid("zinslauf_position_id").references(() => zinslaufPosition.id),
    /** Leer bei Perioden ohne Zinsbetrag (kein Vorgang mit Betrag 0). */
    vorgangId: uuid("vorgang_id").references(() => vorgang.id),
  },
  (t) => [uniqueIndex("zinsperiode_gebucht_instrument_bis_uq").on(t.instrumentId, t.periodeBis)],
);

// Wandlung (Etappe 4) -------------------------------------------------------------------------------------------

/**
 * Wandlung eines Wandeldarlehens in Anteile als ein Ereignis. Die Buchungen stehen als Vorgänge an Darlehen und Ziel;
 * hier liegen Eingaben, Ergebnis (Rechenkern mit Herkunftsschritten) und die Verweise auf die Vorgänge.
 * Beträge sind die gebuchten Cent-Beträge (Spitzenbetrag gerundet, Agio als Rest). Je Quell-Instrument höchstens eine Wandlung.
 */
export const wandlung = pgTable(
  "wandlung",
  {
    id: id(),
    darlehenBeteiligungId: uuid("darlehen_beteiligung_id").notNull().references(() => beteiligung.id),
    zielBeteiligungId: uuid("ziel_beteiligung_id").notNull().references(() => beteiligung.id),
    /** Quelle und Ziel als Instrumente (aus den Beteiligungen befüllt). */
    quellInstrumentId: uuid("quell_instrument_id").notNull().references(() => instrument.id),
    zielInstrumentId: uuid("ziel_instrument_id").references(() => instrument.id),
    rundeId: uuid("runde_id").notNull().references(() => finanzierungsrunde.id),
    cutoff: date("cutoff").notNull(),
    zinsenWandeln: boolean("zinsen_wandeln").notNull(),
    preisregel: jsonb("preisregel").notNull(),
    nennwertJeAnteil: betrag("nennwert_je_anteil").notNull(),
    anzahlAnteile: numeric("anzahl_anteile", { precision: 18, scale: 0 }).notNull(),
    preisJeAnteil: numeric("preis_je_anteil").notNull(),
    massgeblich: text("massgeblich").notNull(),
    wandlungsbetrag: betrag("wandlungsbetrag").notNull(),
    nominal: betrag("nominal").notNull(),
    agio: betrag("agio").notNull(),
    spitzenbetrag: betrag("spitzenbetrag").notNull(),
    zinsenGebucht: betrag("zinsen_gebucht").notNull(),
    ergebnis: jsonb("ergebnis").notNull(),
    vorgaenge: jsonb("vorgaenge").notNull(),
    erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("wandlung_quell_instrument_uq").on(t.quellInstrumentId)],
);

// Verkauf, Kaufpreisanpassung, Forderungen (Etappe 4) -----------------------------------------------------------

/**
 * Verkauf (ganz oder anteilig) einer Beteiligung. `anteilVerkauft` bezieht sich auf die zum Verkaufstag gehaltene
 * Beteiligung. Der Buchwertabgang mindert den Buchwert späterer Verkäufe (Entscheidung 62). `barzufluss` ist der
 * sofort fließende Teil (Kaufpreis − Kosten − Treuhand − Verkäuferdarlehen) und als Rückfluss gebucht.
 */
export const verkauf = pgTable(
  "verkauf",
  {
    id: id(),
    beteiligungId: uuid("beteiligung_id").notNull().references(() => beteiligung.id),
    /** Gesetzt, wenn nur dieses Instrument verkauft wurde; leer beim Verkauf der ganzen Beteiligung (alle Instrumente). */
    instrumentId: uuid("instrument_id").references(() => instrument.id),
    datum: date("datum").notNull(),
    anteilVerkauft: numeric("anteil_verkauft", { precision: 10, scale: 6 }).notNull(),
    kaufpreis: betrag("kaufpreis").notNull(),
    kosten: betrag("kosten").notNull(),
    treuhandBetrag: betrag("treuhand_betrag"),
    verkaeuferdarlehenBetrag: betrag("verkaeuferdarlehen_betrag"),
    verkaeuferdarlehenBeteiligungId: uuid("verkaeuferdarlehen_beteiligung_id").references(() => beteiligung.id),
    /** Das Darlehen-Instrument des Verkäuferdarlehens (in der Beteiligung des Schuldners; dort kann es neben anderen Instrumenten stehen). */
    verkaeuferdarlehenInstrumentId: uuid("verkaeuferdarlehen_instrument_id").references(() => instrument.id),
    buchwertVorher: betrag("buchwert_vorher").notNull(),
    buchwertAbgang: betrag("buchwert_abgang").notNull(),
    erloes: betrag("erloes").notNull(),
    ergebnis: betrag("ergebnis").notNull(),
    barzufluss: betrag("barzufluss").notNull(),
    schritte: jsonb("schritte").notNull(),
    rueckflussVorgangId: uuid("rueckfluss_vorgang_id").references(() => vorgang.id),
    /** Die vom Verkauf gesetzte Bewertung (Rest oder null), für die Rücknahme beim Storno. */
    bewertungId: uuid("bewertung_id").references((): AnyPgColumn => bewertung.id),
    /** Gesetzt, wenn der ganze Verkauf storniert wurde (`POST /verkaeufe/:id/storno`); der Datensatz bleibt als Historie. */
    storniertAm: timestamp("storniert_am", { withTimezone: true }),
    storniertVon: text("storniert_von"),
    erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verkauf_beteiligung_idx").on(t.beteiligungId, t.datum), index("verkauf_rueckfluss_idx").on(t.rueckflussVorgangId)],
);

// Ausübung von Optionsscheinen und Anteilsübertragungen zwischen Gesellschaftern ------------------------------------

/**
 * Ausübung von Optionsscheinen eines Fonds (Instrument der Art `optionsschein`) als ein Ereignis: Anzahl, Ausübungspreis (vom Instrument übernommen) und
 * der Betrag in der Fondswährung, den der Fonds dafür zahlt (Zusage und Auszahlung auf dem Instrument, Verweise auf die Vorgänge). Die Anteile stehen ab
 * `datum` als ausgegebene Anteile des Fonds in der Kapitaltabelle; vor einer späteren Runde zählen sie zu deren Gesamtzahl.
 */
export const optionsscheinAusuebung = pgTable(
  "optionsschein_ausuebung",
  {
    id: id(),
    instrumentId: uuid("instrument_id").notNull().references(() => instrument.id),
    datum: date("datum").notNull(),
    anzahl: numeric("anzahl", { precision: 18, scale: 0 }).notNull(),
    preisJeAnteil: numeric("preis_je_anteil", { precision: 18, scale: 4 }).notNull(),
    /** Gezahlter Betrag in der Fondswährung (Anzahl × Preis, auf Cent; bei abweichender Währung über den Kurs der Buchung). */
    betrag: betrag("betrag").notNull(),
    zusageVorgangId: uuid("zusage_vorgang_id").references(() => vorgang.id),
    auszahlungVorgangId: uuid("auszahlung_vorgang_id").references(() => vorgang.id),
    bemerkung: text("bemerkung"),
    erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
    /** Storno als Ganzes: Zusage und Auszahlung sind per Storno-Vorgang aufgehoben, die Ausübung zählt nicht mehr. */
    storniertAm: timestamp("storniert_am", { withTimezone: true }),
    storniertVon: text("storniert_von"),
  },
  (t) => [index("optionsschein_ausuebung_instrument_idx").on(t.instrumentId, t.datum), check("optionsschein_ausuebung_anzahl", sql`${t.anzahl} > 0`), check("optionsschein_ausuebung_betrag", sql`${t.betrag} >= 0`)],
);

/**
 * Übertragung von Anteilen zwischen Gesellschaftern (Secondary): Es entstehen keine neuen Anteile. Die Quelle ist ein Bestand der Kapitaltabelle:
 * eine Rundenposition (`quelle_position_id`), eine frühere Übertragung (`quelle_uebertragung_id`) oder, wenn beides leer ist, die Stammanteile.
 * Die übertragenen Anteile behalten Klasse, Runde und anteilige Präferenzbasis der Quelle. Käufer ist ein Fonds dieser Plattform oder ein Vehikel.
 * Für eigene Fonds: Abgang über einen Verkauf des Instruments (`verkauf_id`), Zugang als neues Instrument mit Zusage und Auszahlung des Kaufpreises.
 */
export const anteilsuebertragung = pgTable(
  "anteilsuebertragung",
  {
    id: id(),
    organisationId: uuid("organisation_id").notNull().references(() => organisation.id),
    datum: date("datum").notNull(),
    quellePositionId: uuid("quelle_position_id").references(() => rundenposition.id),
    quelleUebertragungId: uuid("quelle_uebertragung_id").references((): AnyPgColumn => anteilsuebertragung.id),
    /** Ausgeübte Optionsscheine eines Fonds als Quelle (Zeile `ausuebung:<id>` der Kapitaltabelle). */
    quelleAusuebungId: uuid("quelle_ausuebung_id").references((): AnyPgColumn => optionsscheinAusuebung.id),
    kaeuferFondsId: uuid("kaeufer_fonds_id").references(() => fonds.id),
    kaeuferVehikelId: uuid("kaeufer_vehikel_id").references(() => vehikel.id),
    anzahl: numeric("anzahl", { precision: 18, scale: 0 }).notNull(),
    /** Preis je Anteil in der Währung der Beteiligung; der Kaufpreis ist Anzahl × Preis auf Cent. */
    preisJeAnteil: numeric("preis_je_anteil", { precision: 18, scale: 6 }).notNull(),
    kaufpreis: betrag("kaufpreis").notNull(),
    /** Abgang eines eigenen Fonds: der Verkauf des Instruments der Quelle. */
    verkaufId: uuid("verkauf_id").references(() => verkauf.id),
    /** Zugang eines eigenen Fonds: das Instrument mit Zusage und Auszahlung des Kaufpreises. */
    kaeuferInstrumentId: uuid("kaeufer_instrument_id").references(() => instrument.id),
    bemerkung: text("bemerkung"),
    erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
    /** Storno als Ganzes: Verkauf des Verkäuferfonds und Zugang des Käuferfonds sind zurückgenommen, die Übertragung zählt nicht mehr. */
    storniertAm: timestamp("storniert_am", { withTimezone: true }),
    storniertVon: text("storniert_von"),
  },
  (t) => [
    index("anteilsuebertragung_organisation_idx").on(t.organisationId, t.datum),
    check("anteilsuebertragung_ein_kaeufer", sql`(${t.kaeuferFondsId} IS NULL) <> (${t.kaeuferVehikelId} IS NULL)`),
    check("anteilsuebertragung_eine_quelle", sql`num_nonnulls(${t.quellePositionId}, ${t.quelleUebertragungId}, ${t.quelleAusuebungId}) <= 1`),
    check("anteilsuebertragung_anzahl", sql`${t.anzahl} > 0`),
    check("anteilsuebertragung_preis", sql`${t.preisJeAnteil} >= 0 AND ${t.kaufpreis} >= 0`),
  ],
);

/** Forderung aus einem Verkauf, z. B. Treuhandbetrag bis zur Freigabe. Erfüllt = als Rückfluss gebucht. */
export const forderung = pgTable(
  "forderung",
  {
    id: id(),
    beteiligungId: uuid("beteiligung_id").notNull().references(() => beteiligung.id),
    instrumentId: uuid("instrument_id").references(() => instrument.id),
    verkaufId: uuid("verkauf_id").notNull().references(() => verkauf.id),
    art: text("art").notNull(),
    betrag: betrag("betrag").notNull(),
    faelligAm: date("faellig_am").notNull(),
    erfuelltAm: date("erfuellt_am"),
    vorgangId: uuid("vorgang_id").references(() => vorgang.id),
    /** Gesetzt, wenn der zugehörige Verkauf storniert wurde: die Forderung gibt es nicht mehr. */
    storniertAm: timestamp("storniert_am", { withTimezone: true }),
    erstelltAm: erstelltAm(),
  },
  (t) => [index("forderung_beteiligung_idx").on(t.beteiligungId), index("forderung_vorgang_idx").on(t.vorgangId), check("forderung_betrag_positiv", sql`${t.betrag} > 0`)],
);

/** Nachträgliche Änderung des Kaufpreises (plus oder minus), als Rückfluss gebucht. */
export const kaufpreisanpassung = pgTable(
  "kaufpreisanpassung",
  {
    id: id(),
    verkaufId: uuid("verkauf_id").notNull().references(() => verkauf.id),
    datum: date("datum").notNull(),
    betrag: betrag("betrag").notNull(),
    grund: text("grund").notNull(),
    vorgangId: uuid("vorgang_id").notNull().references(() => vorgang.id),
    erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("kaufpreisanpassung_verkauf_idx").on(t.verkaufId), index("kaufpreisanpassung_vorgang_idx").on(t.vorgangId)],
);

// Anmeldung und Rechte (Etappe 8) ------------------------------------------------------------------------------------
// Die Tabellen `benutzer`, `sitzung`, `konto`, `verifizierung` und `zwei_faktor` füllt Better Auth. Die Namen der
// Spaltenschlüssel (createdAt, twoFactorEnabled, …) sind die Feldnamen der Bibliothek, die Spalten selbst sind snake_case.

const zeitstempel = (name: string) => timestamp(name, { withTimezone: true });

/** Rolle je Fonds; die Reihenfolge der Werte ist die Rangfolge (betrachter < bearbeiter < freigeber < verwalter). */
export const fondsRolle = pgEnum("fonds_rolle", ["betrachter", "bearbeiter", "freigeber", "verwalter"]);

export const benutzer = pgTable("benutzer", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: zeitstempel("created_at").notNull().defaultNow(),
  updatedAt: zeitstempel("updated_at").notNull().defaultNow(),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  /** Gesperrte Benutzer können sich nicht anmelden und ihre Sitzungen und Schlüssel gelten nicht mehr. */
  aktiv: boolean("aktiv").notNull().default(true),
  /** Technischer Benutzer eines API-Schlüssels: keine Anmeldung, keine Freigaben (Vier-Augen-Prinzip verlangt Menschen). */
  technisch: boolean("technisch").notNull().default(false),
  /** Verwalter aller Fonds und der Benutzerverwaltung. */
  globalVerwalter: boolean("global_verwalter").notNull().default(false),
  /** Von Verwaltern angelegt mit Startpasswort: bis zur Änderung des Passworts ist nur Anmeldung, `/ich` und Zwei-Faktor-Einrichtung erlaubt. */
  passwortAendern: boolean("passwort_aendern").notNull().default(false),
});

export const sitzung = pgTable(
  "sitzung",
  {
    id: id(),
    expiresAt: zeitstempel("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: zeitstempel("created_at").notNull().defaultNow(),
    updatedAt: zeitstempel("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id").notNull().references(() => benutzer.id, { onDelete: "cascade" }),
  },
  (t) => [index("sitzung_benutzer_idx").on(t.userId)],
);

export const konto = pgTable(
  "konto",
  {
    id: id(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id").notNull().references(() => benutzer.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: zeitstempel("access_token_expires_at"),
    refreshTokenExpiresAt: zeitstempel("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: zeitstempel("created_at").notNull().defaultNow(),
    updatedAt: zeitstempel("updated_at").notNull().defaultNow(),
  },
  (t) => [index("konto_benutzer_idx").on(t.userId), uniqueIndex("konto_anbieter_uq").on(t.providerId, t.accountId)],
);

export const verifizierung = pgTable(
  "verifizierung",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: zeitstempel("expires_at").notNull(),
    createdAt: zeitstempel("created_at").notNull().defaultNow(),
    updatedAt: zeitstempel("updated_at").notNull().defaultNow(),
  },
  (t) => [index("verifizierung_kennung_idx").on(t.identifier)],
);

/** TOTP-Geheimnis und Wiederherstellungscodes, beides von Better Auth verschlüsselt abgelegt. */
export const zweiFaktor = pgTable(
  "zwei_faktor",
  {
    id: id(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: uuid("user_id").notNull().references(() => benutzer.id, { onDelete: "cascade" }),
    verified: boolean("verified").default(true),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: zeitstempel("locked_until"),
  },
  (t) => [index("zwei_faktor_benutzer_idx").on(t.userId)],
);

/** Rolle eines Benutzers an einem Fonds. Ein Eintrag je Benutzer und Fonds. */
export const fondsrolle = pgTable(
  "fondsrolle",
  {
    benutzerId: uuid("benutzer_id").notNull().references(() => benutzer.id, { onDelete: "cascade" }),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id, { onDelete: "cascade" }),
    rolle: fondsRolle("rolle").notNull(),
    erstelltAm: erstelltAm(),
  },
  (t) => [primaryKey({ columns: [t.benutzerId, t.fondsId] }), index("fondsrolle_fonds_idx").on(t.fondsId)],
);

// Rollen und Nutzergruppen (Rechtemodell, siehe docs/rechte-modell.md) ---------------------------------------------------
// Eine Rolle bündelt Bereiche der Anwendung (Portfolio, Kontakte, Finanzen …). Eine Gruppe verbindet Personen mit Rollen, einer Stufe
// (betrachter … verwalter) und einem Fondszugriff. Die Fondsrolle einer Person (`fondsrolle`) bleibt die Ausnahme je Fonds und gilt vor der Gruppe.

/**
 * Bündel von Bereichen. `bereiche` sind Schlüssel aus `BEREICHE` der API (Text, die Anwendung prüft die Werte). `bereichStufen` begrenzt
 * die Stufe je Bereich (z. B. Finanzen nur Betrachter); ein Bereich ohne Eintrag hat keine Grenze.
 */
export const rechterolle = pgTable("rechterolle", {
  id: id(),
  name: text("name").notNull().unique(),
  beschreibung: text("beschreibung"),
  bereiche: text("bereiche").array().notNull().default(sql`'{}'::text[]`),
  bereichStufen: jsonb("bereich_stufen").$type<Record<string, (typeof fondsRolle.enumValues)[number]>>().notNull().default(sql`'{}'::jsonb`),
  erstelltAm: erstelltAm(),
}, (t) => [
  // Nur Stufen als Werte: Die Sicht `wirksames_bereichsrecht` wandelt sie in `fonds_rolle` um.
  check(
    "rechterolle_bereich_stufen_gueltig",
    sql`jsonb_typeof(${t.bereichStufen}) = 'object' AND NOT jsonb_path_exists(${t.bereichStufen}, '$.* ? (@ != "betrachter" && @ != "bearbeiter" && @ != "freigeber" && @ != "verwalter")')`,
  ),
]);

/**
 * Nutzergruppe: Stufe an den Fonds der Gruppe und Rollen (Bereiche). Ohne `fondsBeschraenkt` gilt die zentrale Einstellung
 * (`rechte_einstellung.fonds_offen`: alle Fonds); immer dazu kommen die Fonds in `nutzergruppe_fonds`.
 * `bereicheJeFonds`: Die Bereiche der Gruppe gelten nur an ihren Fonds (je Fonds auf eine Auswahl begrenzbar, `nutzergruppe_fonds.bereiche`);
 * ohne den Schalter gelten sie wie bisher an jedem Fonds, an dem die Person eine Stufe hat.
 */
export const nutzergruppe = pgTable("nutzergruppe", {
  id: id(),
  name: text("name").notNull().unique(),
  beschreibung: text("beschreibung"),
  stufe: fondsRolle("stufe").notNull().default("betrachter"),
  fondsBeschraenkt: boolean("fonds_beschraenkt").notNull().default(false),
  bereicheJeFonds: boolean("bereiche_je_fonds").notNull().default(false),
  erstelltAm: erstelltAm(),
});

export const nutzergruppeRolle = pgTable(
  "nutzergruppe_rolle",
  {
    gruppeId: uuid("gruppe_id").notNull().references(() => nutzergruppe.id, { onDelete: "cascade" }),
    rolleId: uuid("rolle_id").notNull().references(() => rechterolle.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.gruppeId, t.rolleId] }), index("nutzergruppe_rolle_rolle_idx").on(t.rolleId)],
);

export const nutzergruppeFonds = pgTable(
  "nutzergruppe_fonds",
  {
    gruppeId: uuid("gruppe_id").notNull().references(() => nutzergruppe.id, { onDelete: "cascade" }),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id, { onDelete: "cascade" }),
    /** Nur bei `nutzergruppe.bereiche_je_fonds`: Bereiche der Gruppe an diesem Fonds; `null` = alle Bereiche ihrer Rollen. */
    bereiche: text("bereiche").array(),
  },
  (t) => [primaryKey({ columns: [t.gruppeId, t.fondsId] }), index("nutzergruppe_fonds_fonds_idx").on(t.fondsId)],
);

export const nutzergruppeMitglied = pgTable(
  "nutzergruppe_mitglied",
  {
    gruppeId: uuid("gruppe_id").notNull().references(() => nutzergruppe.id, { onDelete: "cascade" }),
    benutzerId: uuid("benutzer_id").notNull().references(() => benutzer.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.gruppeId, t.benutzerId] }), index("nutzergruppe_mitglied_benutzer_idx").on(t.benutzerId)],
);

/** Zentrale Einstellung des Rechtemodells, genau eine Zeile (`id = 1`). `fonds_offen`: Gruppen ohne Beschränkung sehen alle Fonds. */
export const rechteEinstellung = pgTable(
  "rechte_einstellung",
  {
    id: integer("id").primaryKey().default(1),
    fondsOffen: boolean("fonds_offen").notNull().default(true),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("rechte_einstellung_eine_zeile", sql`${t.id} = 1`)],
);

/**
 * Wirksame Fondsrollen (Sicht, angelegt in Migration 0065): je Person und Fonds die eigene Fondsrolle, sonst die höchste Stufe der Gruppen,
 * deren Fondszugriff den Fonds umfasst. Globale Verwalter stehen hier nicht; sie sind überall Verwalter.
 */
export const wirksameFondsrolle = pgView("wirksame_fondsrolle", {
  benutzerId: uuid("benutzer_id").notNull(),
  fondsId: uuid("fonds_id").notNull(),
  rolle: fondsRolle("rolle").notNull(),
}).existing();

/**
 * Wirksame Stufe je Person, Fonds und Bereich (Sicht, angelegt in Migration 0068, docs/rechte-modell.md „Auflösung“).
 * `bereich` leer: alle Bereiche (Person ohne Gruppe, nur eigene Fondsrollen). Globale Verwalter stehen hier nicht.
 */
export const wirksamesBereichsrecht = pgView("wirksames_bereichsrecht", {
  benutzerId: uuid("benutzer_id").notNull(),
  fondsId: uuid("fonds_id").notNull(),
  bereich: text("bereich"),
  rolle: fondsRolle("rolle").notNull(),
}).existing();

/**
 * API-Schlüssel eines technischen Benutzers. Gespeichert wird nur der SHA-256-Hash; der Klartext (`cwk_…`) erscheint
 * einmal bei der Anlage. `scopes` ist eine Liste `{ fondsId, recht: "lesen" | "schreiben" }`.
 */
export const apiSchluessel = pgTable(
  "api_schluessel",
  {
    id: id(),
    name: text("name").notNull(),
    benutzerId: uuid("benutzer_id").notNull().references(() => benutzer.id, { onDelete: "cascade" }),
    scopes: jsonb("scopes").notNull(),
    ablauf: zeitstempel("ablauf").notNull(),
    hash: text("hash").notNull().unique(),
    /** Die ersten Zeichen des Schlüssels, damit er in der Liste erkennbar bleibt. */
    vorschau: text("vorschau").notNull(),
    erstelltVon: text("erstellt_von").notNull(),
    erstelltAm: erstelltAm(),
    zuletztGenutzt: zeitstempel("zuletzt_genutzt"),
    widerrufenAm: zeitstempel("widerrufen_am"),
  },
  (t) => [index("api_schluessel_benutzer_idx").on(t.benutzerId)],
);

/**
 * Persönlicher Werteschlüssel (Excel, Power Query): gehört einer Person, nicht einem technischen Benutzer, und gilt nur für die
 * Leseroute `/werte/*`. Die Rechte sind die der Person zum Zeitpunkt des Aufrufs, höchstens begrenzt auf `fonds_ids` (leer = alle
 * Fonds der Person). Gespeichert wird nur der SHA-256-Hash; der Klartext (`cww_…`) erscheint einmal bei der Anlage.
 */
export const werteSchluessel = pgTable(
  "werte_schluessel",
  {
    id: id(),
    name: text("name").notNull(),
    benutzerId: uuid("benutzer_id").notNull().references(() => benutzer.id, { onDelete: "cascade" }),
    fondsIds: uuid("fonds_ids").array().notNull().default(sql`'{}'::uuid[]`),
    darfSchreiben: boolean("darf_schreiben").notNull().default(false),
    ablauf: timestamp("ablauf", { withTimezone: true }).notNull(),
    hash: text("hash").notNull().unique(),
    /** Die ersten Zeichen des Schlüssels, damit er in der Liste erkennbar bleibt. */
    vorschau: text("vorschau").notNull(),
    erstelltAm: erstelltAm(),
    zuletztGenutzt: timestamp("zuletzt_genutzt", { withTimezone: true }),
    widerrufenAm: timestamp("widerrufen_am", { withTimezone: true }),
  },
  (t) => [index("werte_schluessel_benutzer_idx").on(t.benutzerId)],
);

/** Geprüfte Excel-Auswahl und Ergebnis der bestätigten Übernahme. */
export const excelUebernahme = pgTable("excel_uebernahme", {
  id: id(),
  schluesselId: uuid("schluessel_id").notNull(),
  benutzerId: uuid("benutzer_id").notNull(),
  benutzerName: text("benutzer_name").notNull(),
  erstelltAm: erstelltAm(),
  eingabe: jsonb("eingabe").notNull(),
  vorschau: jsonb("vorschau").notNull(),
  uebernommenAm: timestamp("uebernommen_am", { withTimezone: true }),
  uebernommenVon: uuid("uebernommen_von"),
  uebernommenVonName: text("uebernommen_von_name"),
  ergebnis: jsonb("ergebnis"),
}, (t) => [index("excel_uebernahme_schluessel_idx").on(t.schluesselId, t.erstelltAm)]);

/**
 * Kennzeichen einer pseudonymisierten Kopie (Etappe 22): höchstens eine Zeile, nur vom Befehl `pseudonymisieren` geschrieben. Die Anwendung
 * zeigt bei vorhandener Zeile das Band „Pseudonymisierte Kopie“. Enthält nie Angaben aus der Quelle, nur was mit der Kopie geschehen ist.
 */
export const pseudonymisierung = pgTable(
  "pseudonymisierung",
  {
    id: integer("id").primaryKey().default(1),
    erstelltAm: erstelltAm(),
    betraegeSkaliert: boolean("betraege_skaliert").notNull().default(false),
    datenVerschoben: boolean("daten_verschoben").notNull().default(false),
  },
  (t) => [check("pseudonymisierung_einzig", sql`${t.id} = 1`)],
);

/**
 * Periodensperre je Fonds: Vorgänge und Bewertungen mit Valuta (bzw. Stichtag) am oder vor `gesperrtBis` sind
 * gesperrt, in der API und per Trigger in der Datenbank. Die Zeile wird nie gelöscht, nur fortgeschrieben; jede
 * Änderung steht im Änderungsprotokoll.
 */
export const periodensperre = pgTable("periodensperre", {
  fondsId: uuid("fonds_id").primaryKey().references(() => fonds.id, { onDelete: "cascade" }),
  gesperrtBis: date("gesperrt_bis").notNull(),
  gesetztVon: text("gesetzt_von").notNull(),
  gesetztAm: zeitstempel("gesetzt_am").notNull().defaultNow(),
  grund: text("grund"),
});

/** Fehlversuche bei Anmeldung und zweitem Faktor für die Begrenzung (je IP und je Konto). */
export const anmeldeversuch = pgTable(
  "anmeldeversuch",
  {
    id: id(),
    schluessel: text("schluessel").notNull(),
    am: zeitstempel("am").notNull().defaultNow(),
  },
  (t) => [index("anmeldeversuch_schluessel_idx").on(t.schluessel, t.am)],
);

// Investoren und Zeichnung (Etappe 5) ----------------------------------------------------------------------------

/**
 * Zeichnung eines Investors (Organisation der Art `investor`) in einem Fonds: Zusage und Anteil am Fonds (Anteil = Zusage ÷ Zeichnungskapital,
 * Summe je Fonds = 1). Abrufe und Ausschüttungen des Fonds werden anteilig auf die Investoren verteilt (Kapitalkonten im LP-Bericht).
 */
export const fondsZeichnung = pgTable(
  "fonds_zeichnung",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    organisationId: uuid("organisation_id").notNull().references(() => organisation.id),
    zusage: betrag("zusage").notNull(),
    anteil: numeric("anteil", { precision: 10, scale: 6 }).notNull(),
    /** Der Investor ist ausgetreten (Issue #132): Die Zusage bleibt auf dem Abgerufenen, künftige Bewegungen verteilen sich nicht mehr auf ihn. */
    ausgetreten: boolean("ausgetreten").notNull().default(false),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    uniqueIndex("fonds_zeichnung_fonds_organisation_uq").on(t.fondsId, t.organisationId),
    check("fonds_zeichnung_anteil_bereich", sql`${t.anteil} >= 0 AND ${t.anteil} <= 1 AND (${t.anteil} > 0 OR ${t.ausgetreten})`),
    check("fonds_zeichnung_zusage_positiv", sql`${t.zusage} > 0 OR (${t.ausgetreten} AND ${t.zusage} >= 0)`),
  ],
);

/**
 * Weiteres Closing eines Fonds (Issue #113): ein datierter Vorgang, mit dem neue oder bestehende Investoren ab dem Wirksamkeitsdatum
 * `wirksamAm` Zusagen bekommen. Unveränderlich wie Fondsbewegungen. `fonds_zeichnung` führt weiter den aktuellen Stand; was vor dem Closing
 * galt, steht in `fonds_closing_basis`, damit frühere Abrufe, Kapitalkonten und Mitteilungen reproduzierbar bleiben.
 */
export const fondsClosing = pgTable(
  "fonds_closing",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id, { onDelete: "cascade" }),
    wirksamAm: date("wirksam_am").notNull(),
    /** `closing`: Beitritt oder Aufstockung; `verringerung`: Zusage sinkt; `austritt`: Investor scheidet aus (Issue #132). */
    art: text("art").notNull().default("closing"),
    bemerkung: text("bemerkung"),
    erfasstVon: text("erfasst_von").notNull(),
    erfasstAm: zeitstempel("erfasst_am").notNull().defaultNow(),
  },
  (t) => [
    index("fonds_closing_fonds_idx").on(t.fondsId, t.wirksamAm),
    check("fonds_closing_art", sql`${t.art} IN ('closing', 'verringerung', 'austritt')`),
  ],
);

/**
 * Zusage eines Investors in einem Closing (Beitritt oder Aufstockung: `zusage` ist der Zuwachs; bei Verringerung und Austritt, Issue #132,
 * der Betrag, um den die Zusage sinkt, beim Austritt ohne Abruf die ganze Zusage). Der vertraglich vereinbarte Ausgleich (Equalisation) bzw.
 * die Abfindung ist ein eigener Betrag mit Datum; er dokumentiert nur und geht in keine Verteilung und kein Kapitalkonto ein.
 */
export const fondsClosingZusage = pgTable(
  "fonds_closing_zusage",
  {
    id: id(),
    closingId: uuid("closing_id").notNull().references(() => fondsClosing.id, { onDelete: "cascade" }),
    organisationId: uuid("organisation_id").notNull().references(() => organisation.id),
    zusage: betrag("zusage").notNull(),
    ausgleichBetrag: betrag("ausgleich_betrag"),
    ausgleichDatum: date("ausgleich_datum"),
  },
  (t) => [
    uniqueIndex("fonds_closing_zusage_closing_organisation_uq").on(t.closingId, t.organisationId),
    check("fonds_closing_zusage_positiv", sql`${t.zusage} >= 0`),
    check("fonds_closing_zusage_ausgleich", sql`(${t.ausgleichBetrag} IS NULL) = (${t.ausgleichDatum} IS NULL) AND (${t.ausgleichBetrag} IS NULL OR ${t.ausgleichBetrag} > 0)`),
  ],
);

/** Zusage und Anteil aller Investoren unmittelbar vor einem Closing: die Verteilungsgrundlage für Stichtage vor dem Wirksamkeitsdatum. */
export const fondsClosingBasis = pgTable(
  "fonds_closing_basis",
  {
    closingId: uuid("closing_id").notNull().references(() => fondsClosing.id, { onDelete: "cascade" }),
    organisationId: uuid("organisation_id").notNull().references(() => organisation.id),
    zusage: betrag("zusage").notNull(),
    anteil: numeric("anteil", { precision: 10, scale: 6 }).notNull(),
    ausgetreten: boolean("ausgetreten").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.closingId, t.organisationId] })],
);

/**
 * Zusage und Anteil aller Investoren unmittelbar nach einem Closing (Issue #126). Zusammen mit `fonds_closing_basis` bestimmt das den Stand
 * zu jedem Wissensstand, auch wenn ein späteres Closing storniert wurde: Der Stand nach dem letzten bekannten Closing gilt für alle Tage danach.
 */
export const fondsClosingStand = pgTable(
  "fonds_closing_stand",
  {
    closingId: uuid("closing_id").notNull().references(() => fondsClosing.id, { onDelete: "cascade" }),
    organisationId: uuid("organisation_id").notNull().references(() => organisation.id),
    zusage: betrag("zusage").notNull(),
    anteil: numeric("anteil", { precision: 10, scale: 6 }).notNull(),
    ausgetreten: boolean("ausgetreten").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.closingId, t.organisationId] })],
);

/**
 * Stornierung eines weiteren Closings (Issue #126): ein eigener Vorgang statt Löschen oder Ändern des Closings. Das Closing bleibt mit
 * Zusagen und Momentaufnahmen erhalten, gilt aber ab `storniert_am` nicht mehr. `ersetzt_durch` verweist bei einer Korrektur auf das neue Closing.
 */
export const fondsClosingStorno = pgTable(
  "fonds_closing_storno",
  {
    closingId: uuid("closing_id").primaryKey().references(() => fondsClosing.id, { onDelete: "cascade" }),
    grund: text("grund").notNull(),
    ersetztDurch: uuid("ersetzt_durch").references(() => fondsClosing.id),
    storniertVon: text("storniert_von").notNull(),
    storniertAm: zeitstempel("storniert_am").notNull().defaultNow(),
  },
);

// LP-Portal (Etappe 12) ------------------------------------------------------------------------------------------

/** Rolle eines Investor-Zugangs; getrennt von den Fondsrollen (`fonds_rolle`), die ein Investor-Benutzer nie bekommt. */
export const investorRolle = pgEnum("investor_rolle", ["investor_lesen"]);

/**
 * Kennzeichen eines Investor-Benutzers: Der Benutzer gehört zum LP-Portal und hat nie Fondsrollen, ist nie globaler Verwalter und nie
 * technisch (Trigger in Migration 0028 erzwingen den Ausschluss in beide Richtungen). Interne Routen lehnt die API für ihn ab.
 */
export const investorBenutzer = pgTable("investor_benutzer", {
  benutzerId: uuid("benutzer_id").primaryKey().references(() => benutzer.id, { onDelete: "cascade" }),
  erstelltVon: text("erstellt_von").notNull(),
  erstelltAm: erstelltAm(),
});

/** Zugang eines Investor-Benutzers zu einer Investor-Organisation: Sie bestimmt, welche Zeichnungen, Konten und Dokumente er sieht. */
export const investorZugang = pgTable(
  "investor_zugang",
  {
    benutzerId: uuid("benutzer_id").notNull().references(() => investorBenutzer.benutzerId, { onDelete: "cascade" }),
    organisationId: uuid("organisation_id").notNull().references(() => organisation.id),
    rolle: investorRolle("rolle").notNull().default("investor_lesen"),
    erstelltVon: text("erstellt_von").notNull(),
    erstelltAm: erstelltAm(),
  },
  (t) => [primaryKey({ columns: [t.benutzerId, t.organisationId] }), index("investor_zugang_organisation_idx").on(t.organisationId)],
);

/**
 * Mitteilung zu einem Kapitalabruf oder einer Ausschüttung für einen Investor (PDF). Wird mit der Freigabe der Mitteilungen einer
 * Fondsbewegung erzeugt und unveränderlich gespeichert (SHA-256); `betrag` ist der Anteil des Investors (größter Rest wie im LP-Bericht).
 */
export const fondsMitteilung = pgTable(
  "fonds_mitteilung",
  {
    id: id(),
    bewegungId: uuid("bewegung_id").notNull().references(() => fondsBewegung.id),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    organisationId: uuid("organisation_id").notNull().references(() => organisation.id),
    art: fondsBewegungArt("art").notNull(),
    valuta: date("valuta").notNull(),
    betrag: betrag("betrag").notNull(),
    sprache: text("sprache").notNull(),
    dateiName: text("datei_name").notNull(),
    dateiSchluessel: text("datei_schluessel").notNull(),
    dateiSha256: text("datei_sha256").notNull(),
    dateiGroesse: integer("datei_groesse").notNull(),
    freigegebenVon: text("freigegeben_von").notNull(),
    freigegebenAm: timestamp("freigegeben_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fonds_mitteilung_bewegung_organisation_uq").on(t.bewegungId, t.organisationId),
    index("fonds_mitteilung_organisation_idx").on(t.organisationId, t.valuta),
    check("fonds_mitteilung_sprache", sql`${t.sprache} IN ('de', 'en')`),
  ],
);

// Berichte mit Freigabe (Etappe 5) -------------------------------------------------------------------------------

export const berichtArt = pgEnum("bericht_art", ["fondsbericht", "quartalsbericht", "lp_bericht", "gremienvorlage", "portfolioliste", "exitliste", "pai_erklaerung", "szenariobericht"]);
export const berichtFormat = pgEnum("bericht_format", ["pdf", "xlsx"]);
export const berichtStatus = pgEnum("bericht_status", ["entwurf", "geprueft", "freigegeben"]);
export const abschnittStatus = pgEnum("abschnitt_status", ["entwurf", "freigegeben"]);

/**
 * Ein Bericht mit Freigabe in Stufen. Entwurf und geprüfte Stände erzeugen die Datei bei jedem Abruf neu (mit Wasserzeichen);
 * mit der letzten Stufe wird die Datei ohne Wasserzeichen erzeugt, `stand` auf diesen Zeitpunkt festgehalten (oder auf den
 * vorgegebenen `standVorgabe`) und die Datei unveränderlich gespeichert (`datei_sha256`). Ein freigegebener Bericht ändert sich nicht (Trigger).
 * `freigabestufen` hält die Stufennamen zum Zeitpunkt der Anlage fest; `naechsteStufe` zeigt auf die nächste offene.
 */
export const bericht = pgTable(
  "bericht",
  {
    id: id(),
    vorfassungId: uuid("vorfassung_id").unique().references((): AnyPgColumn => bericht.id),
    berichtigungsgrund: text("berichtigungsgrund"),
    art: berichtArt("art").notNull(),
    format: berichtFormat("format").notNull(),
    fondsId: uuid("fonds_id").references(() => fonds.id),
    beteiligungId: uuid("beteiligung_id").references(() => beteiligung.id),
    stichtag: date("stichtag").notNull(),
    sprache: text("sprache").notNull(),
    /** Gewünschter Wissensstand (Bericht zu einem früheren Stand neu erzeugen); leer = Zeitpunkt der Freigabe. */
    standVorgabe: timestamp("stand_vorgabe", { withTimezone: true }),
    /** Festgehalten bei der Freigabe. */
    stand: timestamp("stand", { withTimezone: true }),
    status: berichtStatus("status").notNull().default("entwurf"),
    parameter: jsonb("parameter").notNull().default(sql`'{}'::jsonb`),
    /** Zum Zeitpunkt der Anlage festgehaltene, wirksame Vorlage (Abschnitte, Kennzahlen, Spalten, Einheit); spätere Änderungen der Vorlage betreffen den Bericht nicht. */
    konfiguration: jsonb("konfiguration").notNull().default(sql`'{}'::jsonb`),
    /** Zum Zeitpunkt der Anlage festgehaltene Stufennamen. */
    freigabestufen: jsonb("freigabestufen").notNull(),
    naechsteStufe: integer("naechste_stufe").notNull().default(0),
    erstelltVon: text("erstellt_von").notNull(),
    erstelltAm: erstelltAm(),
    erzeugtAm: timestamp("erzeugt_am", { withTimezone: true }),
    dateiName: text("datei_name"),
    dateiSchluessel: text("datei_schluessel"),
    dateiSha256: text("datei_sha256"),
    dateiGroesse: integer("datei_groesse"),
    kontrolleUeberschrieben: jsonb("kontrolle_ueberschrieben"),
  },
  (t) => [
    index("bericht_fonds_idx").on(t.fondsId, t.stichtag),
    check("bericht_berichtigung", sql`(${t.vorfassungId} IS NULL AND ${t.berichtigungsgrund} IS NULL) OR (${t.vorfassungId} IS NOT NULL AND ${t.berichtigungsgrund} IS NOT NULL AND length(trim(${t.berichtigungsgrund})) > 0)`),
    check("bericht_bezug", sql`${t.fondsId} IS NOT NULL OR ${t.beteiligungId} IS NOT NULL`),
  ],
);

/** Protokoll der Freigabestufen (nur anhängend, Trigger): Prüfung, Rückgabe, Überschreibung des Kontrollberichts. */
export const berichtFreigabe = pgTable(
  "bericht_freigabe",
  {
    id: id(),
    berichtId: uuid("bericht_id").notNull().references(() => bericht.id),
    stufeIndex: integer("stufe_index").notNull(),
    stufe: text("stufe").notNull(),
    ergebnis: text("ergebnis").notNull(),
    kommentar: text("kommentar"),
    akteur: text("akteur").notNull(),
    am: timestamp("am", { withTimezone: true }).notNull().defaultNow(),
    kontrolleUeberschreibung: text("kontrolle_ueberschreibung"),
  },
  (t) => [index("bericht_freigabe_bericht_idx").on(t.berichtId, t.am), check("bericht_freigabe_ergebnis", sql`${t.ergebnis} IN ('ok', 'zurueck')`)],
);

/** Freitextabschnitt eines Berichts, je Sprache; editierbar, solange der Bericht ein Entwurf ist, mit der Freigabe des Berichts `freigegeben`. */
export const berichtAbschnitt = pgTable(
  "bericht_abschnitt",
  {
    id: id(),
    berichtId: uuid("bericht_id").notNull().references(() => bericht.id),
    schluessel: text("schluessel").notNull(),
    textDe: text("text_de").notNull().default(""),
    textEn: text("text_en").notNull().default(""),
    status: abschnittStatus("status").notNull().default("entwurf"),
    geaendertVon: text("geaendert_von").notNull(),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("bericht_abschnitt_uq").on(t.berichtId, t.schluessel)],
);

/**
 * Datei eines freigegebenen LP-Berichts für genau einen Investor (Organisation): der Bericht mit demselben Stand, derselben Vorlage und
 * denselben Freitexten, aber mit dem Kapitalkonto nur dieses Investors. Entsteht mit der letzten Freigabestufe in derselben Transaktion
 * wie die Hauptdatei (Bericht mit Abschnitt „Kapitalkonten“), wird unveränderlich gespeichert (SHA-256) und danach nie mehr geändert (Trigger).
 */
export const berichtVariante = pgTable(
  "bericht_variante",
  {
    id: id(),
    berichtId: uuid("bericht_id").notNull().references(() => bericht.id),
    organisationId: uuid("organisation_id").notNull().references(() => organisation.id),
    dateiName: text("datei_name").notNull(),
    dateiSchluessel: text("datei_schluessel").notNull(),
    dateiSha256: text("datei_sha256").notNull(),
    dateiGroesse: integer("datei_groesse").notNull(),
    erzeugtAm: timestamp("erzeugt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("bericht_variante_bericht_organisation_uq").on(t.berichtId, t.organisationId), index("bericht_variante_organisation_idx").on(t.organisationId)],
);

/** Vorlage je Fonds und Berichtsart (Abschnitte, Reihenfolge, Kennzahlzeilen, Einheit); Aufbau prüft Zod in `packages/berichte`. */
export const berichtVorlage = pgTable(
  "bericht_vorlage",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    art: berichtArt("art").notNull(),
    konfiguration: jsonb("konfiguration").notNull(),
    geaendertVon: text("geaendert_von").notNull(),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("bericht_vorlage_fonds_art_uq").on(t.fondsId, t.art)],
);

/** Namen der Freigabestufen je Fonds (Reihenfolge = Reihenfolge der Prüfung); ohne Eintrag gelten die Standardstufen. */
export const berichtFreigabestufen = pgTable("bericht_freigabestufen", {
  fondsId: uuid("fonds_id").primaryKey().references(() => fonds.id),
  stufen: jsonb("stufen").notNull(),
  geaendertVon: text("geaendert_von").notNull(),
  geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
});

// Import, Idempotenz (Etappe 6) ------------------------------------------------------------------------------------

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

/** Stand eines Import-Laufs: hochgeladen (auch nach einer Prüfung mit Fehlern), geprüft (ohne Fehler, übernahmebereit), übernommen. */
export const importLaufStatus = pgEnum("import_lauf_status", ["hochgeladen", "geprueft", "uebernommen"]);

/**
 * Ein Import-Lauf: hochladen, prüfen, übernehmen. Die Datei liegt unverändert im Lauf (`datei`, `sha256`), damit Prüfung und
 * Übernahme auf demselben Stand arbeiten. Vier-Augen: Hochladen und Prüfen durch Bearbeiter, Übernehmen durch eine andere Person
 * mit Rolle Freigeber (`uebernommen_von` weicht von `hochgeladen_von` und `geprueft_von` ab).
 */
export const importLauf = pgTable(
  "import_lauf",
  {
    id: id(),
    dateiname: text("dateiname").notNull(),
    dateityp: text("dateityp").notNull(),
    sprache: text("sprache").notNull(),
    groesse: integer("groesse").notNull(),
    sha256: text("sha256").notNull(),
    datei: bytea("datei").notNull(),
    status: importLaufStatus("status").notNull().default("hochgeladen"),
    hochgeladenVon: text("hochgeladen_von").notNull(),
    hochgeladenVonName: text("hochgeladen_von_name"),
    hochgeladenAm: timestamp("hochgeladen_am", { withTimezone: true }).notNull().defaultNow(),
    geprueftVon: text("geprueft_von"),
    geprueftVonName: text("geprueft_von_name"),
    geprueftAm: timestamp("geprueft_am", { withTimezone: true }),
    fehlerAnzahl: integer("fehler_anzahl"),
    warnungAnzahl: integer("warnung_anzahl"),
    /** Mehr Befunde, als gespeichert werden (Obergrenze je Lauf); die Anzahlen oben zählen alle. */
    befundeGekuerzt: boolean("befunde_gekuerzt").notNull().default(false),
    /** Fonds (Kurznamen), die der Lauf berührt. */
    fonds: jsonb("fonds").notNull().default(sql`'[]'::jsonb`),
    /** Ergebnis der Prüfung: je Blatt Zeilen, anzulegen und unverändert. */
    vorschau: jsonb("vorschau"),
    uebernommenVon: text("uebernommen_von"),
    uebernommenVonName: text("uebernommen_von_name"),
    uebernommenAm: timestamp("uebernommen_am", { withTimezone: true }),
    /** Ergebnis der Übernahme: je Blatt angelegt und unverändert, Summen je Fonds samt Kontrollsummen. */
    ergebnis: jsonb("ergebnis"),
  },
  (t) => [index("import_lauf_am_idx").on(t.hochgeladenAm)],
);

export const importBefund = pgTable(
  "import_befund",
  {
    id: id(),
    laufId: uuid("lauf_id").notNull().references(() => importLauf.id, { onDelete: "cascade" }),
    /** Laufende Nummer in der Prüfung (stabile Reihenfolge). */
    nr: integer("nr").notNull(),
    /** Schlüssel des Blattes (`fonds`, `organisationen`, …); der Name aus der Datei steht in `blattName`. */
    blatt: text("blatt"),
    blattName: text("blatt_name"),
    zeile: integer("zeile"),
    spalte: text("spalte"),
    code: text("code").notNull(),
    schweregrad: text("schweregrad").notNull(),
    meldung: text("meldung").notNull(),
    /** Strukturierte Werte der Meldung; die Oberfläche übersetzt aus `code` und `params`. */
    params: jsonb("params").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [index("import_befund_lauf_idx").on(t.laufId, t.nr), check("import_befund_schweregrad", sql`${t.schweregrad} IN ('fehler', 'warnung')`)],
);

/**
 * Fachliche Schlüssel der Importdatei (`organisation_schluessel` usw.) und die Datensätze, die daraus entstanden sind. Sie machen den
 * Import wiederholbar: Dieselbe Datei legt nichts doppelt an, weil jede Zeile über ihren Schlüssel gefunden wird. Es gibt keinen
 * Fremdschlüssel (der Verweis geht auf Tabellen je nach `objekt`); verwaiste Zeilen (Datensatz gelöscht) zählen als unbekannt.
 */
export const importZuordnung = pgTable(
  "import_zuordnung",
  {
    objekt: text("objekt").notNull(),
    schluessel: text("schluessel").notNull(),
    datensatzId: uuid("datensatz_id").notNull(),
    laufId: uuid("lauf_id").references(() => importLauf.id, { onDelete: "set null" }),
    angelegtAm: timestamp("angelegt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.objekt, t.schluessel] }), index("import_zuordnung_datensatz_idx").on(t.objekt, t.datensatzId)],
);

/**
 * Gespeicherte Antworten für den Kopf `Idempotency-Key` (24 Stunden). `status` ist leer, solange die erste Anfrage läuft.
 * Schlüssel gelten je Akteur; derselbe Schlüssel mit anderem Körper ist ein Konflikt.
 */
export const idempotenzSchluessel = pgTable(
  "idempotenz_schluessel",
  {
    akteur: text("akteur").notNull(),
    schluessel: text("schluessel").notNull(),
    methode: text("methode").notNull(),
    pfad: text("pfad").notNull(),
    anfrageHash: text("anfrage_hash").notNull(),
    status: integer("status"),
    antwort: text("antwort"),
    antwortHash: text("antwort_hash"),
    inhaltstyp: text("inhaltstyp"),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.akteur, t.schluessel] }), index("idempotenz_schluessel_am_idx").on(t.erstelltAm)],
);

// Kennzahlen der Portfoliounternehmen (Etappe 11) --------------------------------------------------------------

export const kennzahlTyp = pgEnum("kennzahl_typ", ["betrag", "zahl", "prozent", "ja_nein", "text"]);
export const kennzahlKategorie = pgEnum("kennzahl_kategorie", ["finanzen", "betrieb", "esg_umwelt", "esg_sozial", "esg_governance"]);
export const kennzahlPeriodizitaet = pgEnum("kennzahl_periodizitaet", ["monat", "quartal", "jahr"]);
export const kennzahlAggregation = pgEnum("kennzahl_aggregation", ["summe", "stand", "durchschnitt"]);
export const kennzahlSzenario = pgEnum("kennzahl_szenario", ["ist", "plan", "forecast"]);
export const kennzahlQuelle = pgEnum("kennzahl_quelle", ["intern", "unternehmen", "import"]);
export const kennzahlWertStatus = pgEnum("kennzahl_wert_status", ["entwurf", "eingereicht", "bestaetigt"]);
export const kennzahlAbfrageStatus = pgEnum("kennzahl_abfrage_status", ["offen", "eingereicht", "bestaetigt", "widerrufen"]);
/** Art der Anfrage: gewöhnliche Kennzahlen oder der ESG-Fragebogen (Etappe 16, Datenpunkte der Nachhaltigkeitsindikatoren je Unternehmen und Jahr). */
export const kennzahlAbfrageArt = pgEnum("kennzahl_abfrage_art", ["kennzahlen", "esg"]);

/**
 * Kennzahlenkatalog als versionierte Konfiguration (kein Code): eine Zeile je Kennzahl und Version (`katalog_version`, ab 1). Eine Änderung
 * legt eine neue Version an und begrenzt die alte mit `gueltig_bis`; Zeilen werden nie überschrieben, damit gespeicherte Werte ihre Definition behalten.
 * Fachlich dieselbe Kennzahl über alle Versionen ist der `schluessel` (Zeitreihen und „zuletzt bestätigt“ laufen über ihn).
 */
export const kennzahlDefinition = pgTable(
  "kennzahl_definition",
  {
    id: id(),
    schluessel: text("schluessel").notNull(),
    katalogVersion: integer("katalog_version").notNull().default(1),
    bezeichnungDe: text("bezeichnung_de").notNull(),
    bezeichnungEn: text("bezeichnung_en").notNull(),
    /** Anzeige der Einheit (EUR, Anzahl, Prozent, t CO2e, …); bei Betrag und Zahl nur Beschriftung. */
    einheit: text("einheit").notNull(),
    typ: kennzahlTyp("typ").notNull(),
    kategorie: kennzahlKategorie("kategorie").notNull(),
    /** Feinste Auswertungsstufe, in der die Kennzahl erhoben wird; ein Zeitraum darf nicht feiner sein. */
    periodizitaet: kennzahlPeriodizitaet("periodizitaet").notNull(),
    /** Wie Werte feiner Zeiträume zu einem gröberen zusammengefasst werden: Summe, Stand am Ende oder Durchschnitt. */
    aggregation: kennzahlAggregation("aggregation").notNull(),
    pflicht: boolean("pflicht").notNull().default(false),
    reihenfolge: integer("reihenfolge").notNull().default(0),
    /** Fundstelle in einer Rechtsvorschrift (nur Nummer und Anhang, kein Wortlaut), z. B. bei den ESG-Datenpunkten. */
    regelwerk: text("regelwerk"),
    /** Erläuterung für die Person, die den Wert liefert (Abfrageformular); je Sprache. */
    erlaeuterungDe: text("erlaeuterung_de"),
    erlaeuterungEn: text("erlaeuterung_en"),
    /** Falsch, solange ein Fachmensch die Definition noch nicht geprüft hat (Datenpunkte der Nachhaltigkeitsindikatoren). */
    fachlichGeprueft: boolean("fachlich_geprueft").notNull().default(true),
    gueltigAb: date("gueltig_ab").notNull(),
    gueltigBis: date("gueltig_bis"),
    erstelltVon: text("erstellt_von").notNull().default("system"),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    uniqueIndex("kennzahl_definition_version_uq").on(t.schluessel, t.katalogVersion),
    check("kennzahl_definition_schluessel", sql`${t.schluessel} ~ '^[a-z][a-z0-9_]{1,59}$'`),
    check("kennzahl_definition_gueltig", sql`${t.gueltigBis} IS NULL OR ${t.gueltigBis} >= ${t.gueltigAb}`),
  ],
);

/** Welche Kennzahlen ein Fonds von seinen Unternehmen anfordert (über den Schlüssel, damit neue Katalogversionen gelten). */
export const fondsKennzahl = pgTable(
  "fonds_kennzahl",
  {
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    schluessel: text("schluessel").notNull(),
    reihenfolge: integer("reihenfolge").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.fondsId, t.schluessel] })],
);

/**
 * Anfrage an ein Unternehmen: ein Zeitraum, die gewünschten Kennzahlen und ein Link ohne Konto. Vom Link-Token steht nur der SHA-256 in der
 * Datenbank (`token_hash`); der Klartext wird nur beim Anlegen oder beim neuen Link ausgegeben. Je Anfrage gilt genau ein Token.
 */
export const kennzahlAbfrage = pgTable(
  "kennzahl_abfrage",
  {
    id: id(),
    beteiligungId: uuid("beteiligung_id").notNull().references(() => beteiligung.id),
    periodeBeginn: date("periode_beginn").notNull(),
    periodeEnde: date("periode_ende").notNull(),
    faelligAm: date("faellig_am").notNull(),
    status: kennzahlAbfrageStatus("status").notNull().default("offen"),
    art: kennzahlAbfrageArt("art").notNull().default("kennzahlen"),
    /** Sprache der Formularseite beim Öffnen; die Person kann sie dort wechseln. */
    sprache: text("sprache").notNull().default("de"),
    hinweis: text("hinweis"),
    tokenHash: text("token_hash").notNull(),
    tokenAblauf: timestamp("token_ablauf", { withTimezone: true }).notNull(),
    tokenErzeugtAm: timestamp("token_erzeugt_am", { withTimezone: true }).notNull().defaultNow(),
    erstelltVon: text("erstellt_von").notNull(),
    erstelltAm: erstelltAm(),
    eingereichtAm: timestamp("eingereicht_am", { withTimezone: true }),
    bestaetigtAm: timestamp("bestaetigt_am", { withTimezone: true }),
    widerrufenAm: timestamp("widerrufen_am", { withTimezone: true }),
    widerrufenVon: text("widerrufen_von"),
  },
  (t) => [
    uniqueIndex("kennzahl_abfrage_token_uq").on(t.tokenHash),
    uniqueIndex("kennzahl_abfrage_aktiv_uq").on(t.beteiligungId, t.art, t.periodeBeginn, t.periodeEnde).where(sql`${t.status} IN ('offen', 'eingereicht')`),
    index("kennzahl_abfrage_beteiligung_idx").on(t.beteiligungId, t.periodeEnde),
    check("kennzahl_abfrage_periode", sql`${t.periodeEnde} >= ${t.periodeBeginn}`),
    check("kennzahl_abfrage_sprache", sql`${t.sprache} IN ('de', 'en')`),
  ],
);

export const kennzahlAbfragePosition = pgTable(
  "kennzahl_abfrage_position",
  {
    abfrageId: uuid("abfrage_id").notNull().references(() => kennzahlAbfrage.id),
    definitionId: uuid("definition_id").notNull().references(() => kennzahlDefinition.id),
  },
  (t) => [primaryKey({ columns: [t.abfrageId, t.definitionId] })],
);

/**
 * Ein Kennzahlenwert einer Beteiligung für einen Zeitraum und ein Szenario. Bestätigte Zeilen sind unveränderlich; eine Korrektur ist eine neue Zeile
 * (Entwurf, dann bestätigt), die zuletzt bestätigte je Beteiligung, Kennzahl (`schluessel`), Zeitraum und Szenario zählt. `wert` ist der kanonische Text
 * (Zahlen als Dezimalzahl mit Punkt, `ja`/`nein`, Freitext). `folge` ordnet Zeilen mit gleichem Zeitpunkt eindeutig.
 */
export const kennzahlWert = pgTable(
  "kennzahl_wert",
  {
    id: id(),
    folge: bigint("folge", { mode: "number" }).generatedAlwaysAsIdentity(),
    beteiligungId: uuid("beteiligung_id").notNull().references(() => beteiligung.id),
    definitionId: uuid("definition_id").notNull().references(() => kennzahlDefinition.id),
    periodeBeginn: date("periode_beginn").notNull(),
    periodeEnde: date("periode_ende").notNull(),
    szenario: kennzahlSzenario("szenario").notNull(),
    wert: text("wert").notNull(),
    quelle: kennzahlQuelle("quelle").notNull(),
    /** Benutzer-ID, bei einer Eingabe über den Link `extern:<abfrage-id>`. */
    erfasstVon: text("erfasst_von").notNull(),
    erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
    status: kennzahlWertStatus("status").notNull().default("entwurf"),
    kommentar: text("kommentar"),
    /** Wert ist geschätzt, nicht berichtet (ESG-Datenpunkte); der Anteil geschätzter Werte steht in der PAI-Erklärung. */
    geschaetzt: boolean("geschaetzt").notNull().default(false),
    /** Quelle des Wertes (z. B. Nachhaltigkeitsbericht, Schätzverfahren), Freitext. */
    quellenangabe: text("quellenangabe"),
    abfrageId: uuid("abfrage_id").references(() => kennzahlAbfrage.id),
    bestaetigtVon: text("bestaetigt_von"),
    bestaetigtAm: timestamp("bestaetigt_am", { withTimezone: true }),
    /** Verworfen = nicht mehr offen und nie bestätigt (kein Status, damit die Statuswerte der Fachsprache entsprechen). */
    verworfenVon: text("verworfen_von"),
    verworfenAm: timestamp("verworfen_am", { withTimezone: true }),
  },
  (t) => [
    index("kennzahl_wert_reihe_idx").on(t.beteiligungId, t.definitionId, t.periodeBeginn, t.periodeEnde, t.szenario),
    index("kennzahl_wert_abfrage_idx").on(t.abfrageId),
    uniqueIndex("kennzahl_wert_abfrage_offen_uq").on(t.abfrageId, t.definitionId).where(sql`${t.abfrageId} IS NOT NULL AND ${t.status} IN ('entwurf', 'eingereicht') AND ${t.verworfenAm} IS NULL`),
    check("kennzahl_wert_periode", sql`${t.periodeEnde} >= ${t.periodeBeginn}`),
    check("kennzahl_wert_bestaetigt", sql`(${t.status} = 'bestaetigt') = (${t.bestaetigtAm} IS NOT NULL)`),
  ],
);

/** Zugriffe auf die öffentlichen Abfrage-Endpunkte für die Begrenzung (je IP und je Token, ohne Klartext des Tokens). */
export const abfrageZugriff = pgTable(
  "abfrage_zugriff",
  {
    id: id(),
    schluessel: text("schluessel").notNull(),
    am: zeitstempel("am").notNull().defaultNow(),
  },
  (t) => [index("abfrage_zugriff_schluessel_idx").on(t.schluessel, t.am)],
);
// Dokumente und Vertragsauslesung (Etappe 13) -------------------------------------------------------------------------

/** Textsuchvektor (`to_tsvector`); wird nur von der Datenbank erzeugt und per Suchausdruck abgefragt. */
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/** `endgueltig_geloescht`: Die Aufbewahrungsfrist nach dem weichen Löschen ist um und die Datei aus der Ablage entfernt; die Metadaten bleiben. */
export const dokumentStatus = pgEnum("dokument_status", ["aktiv", "ersetzt", "geloescht", "endgueltig_geloescht"]);
export const dokumentKlassifikation = pgEnum("dokument_klassifikation", ["vertrag", "beschluss", "bewertung", "bericht", "beleg", "sonstiges"]);
/** Stand des Textauszugs: `kein_text` bei einem Dokument ohne Text (Scan, ohne Texterkennung), `nicht_unterstuetzt` für Bilder (ohne Texterkennung). PDF, DOCX und XLSX liefern Text. `ocr_ausstehend` und `ocr_laeuft`: Die lokale Texterkennung (nur mit `OCR=lokal`) wartet auf den Worker oder läuft. */
export const dokumentTextStatus = pgEnum("dokument_text_status", ["ausstehend", "vorhanden", "kein_text", "nicht_unterstuetzt", "fehler", "ocr_ausstehend", "ocr_laeuft"]);
export const dokumentZielTyp = pgEnum("dokument_ziel_typ", ["beteiligung", "deal", "vorgang", "organisation", "fonds", "bewertung", "finanzierungsrunde"]);

/**
 * Ein hochgeladenes Dokument. Die Bytes liegen in der Dateiablage (`gespeichert_unter`, Schlüssel mit dem SHA-256), hier stehen
 * nur Metadaten. `mime` kommt aus den ersten Bytes, nie aus dem Namen oder dem Inhaltstyp der Anfrage. Löschen ist weich
 * (`status = geloescht`); die Datei bleibt bis zu einem Aufbewahrungslauf erhalten. Ersetzen legt eine neue Version an
 * (`vorgaenger_id`), die alte bleibt als `ersetzt` les- und herunterladbar, weil Fundstellen auf sie zeigen.
 */
export const dokument = pgTable(
  "dokument",
  {
    id: id(),
    sha256: text("sha256").notNull(),
    dateiname: text("dateiname").notNull(),
    mime: text("mime").notNull(),
    groesse: integer("groesse").notNull(),
    gespeichertUnter: text("gespeichert_unter").notNull(),
    hochgeladenVon: text("hochgeladen_von").notNull(),
    hochgeladenVonName: text("hochgeladen_von_name"),
    hochgeladenAm: timestamp("hochgeladen_am", { withTimezone: true }).notNull().defaultNow(),
    status: dokumentStatus("status").notNull().default("aktiv"),
    klassifikation: dokumentKlassifikation("klassifikation").notNull().default("sonstiges"),
    /** Vertrauliche Dokumente gehen nur mit ausdrücklicher Freigabe an die KI-Auslesung. */
    vertraulich: boolean("vertraulich").notNull().default(false),
    textStatus: dokumentTextStatus("text_status").notNull().default("ausstehend"),
    seitenzahl: integer("seitenzahl"),
    vorgaengerId: uuid("vorgaenger_id").references((): AnyPgColumn => dokument.id),
    ersetztAm: timestamp("ersetzt_am", { withTimezone: true }),
    geloeschtAm: timestamp("geloescht_am", { withTimezone: true }),
    geloeschtVon: text("geloescht_von"),
    /** Wann die Datei nach Ablauf der Aufbewahrungsfrist aus der Ablage entfernt wurde (Status `endgueltig_geloescht`). */
    endgueltigGeloeschtAm: timestamp("endgueltig_geloescht_am", { withTimezone: true }),
    /** Nachverarbeitung des Textes (Texterkennung, Office-Auszug): Beginn des laufenden Versuchs und Zahl der Versuche; nach dem dritten Absturz gilt `fehler`. */
    textBegonnenAm: timestamp("text_begonnen_am", { withTimezone: true }),
    textVersuche: integer("text_versuche").notNull().default(0),
  },
  (t) => [index("dokument_sha256_idx").on(t.sha256), index("dokument_vorgaenger_idx").on(t.vorgaengerId), check("dokument_groesse", sql`${t.groesse} > 0`)],
);

/** Verknüpfung eines Dokuments mit einem Datensatz. Das Ziel ist mehrartig (`ziel_typ`), ohne Fremdschlüssel; die API prüft, dass es das Ziel gibt. */
export const dokumentVerknuepfung = pgTable(
  "dokument_verknuepfung",
  {
    dokumentId: uuid("dokument_id").notNull().references(() => dokument.id),
    zielTyp: dokumentZielTyp("ziel_typ").notNull(),
    zielId: uuid("ziel_id").notNull(),
    erstelltVon: text("erstellt_von").notNull().default("system"),
    erstelltAm: erstelltAm(),
  },
  (t) => [primaryKey({ columns: [t.dokumentId, t.zielTyp, t.zielId] }), index("dokument_verknuepfung_ziel_idx").on(t.zielTyp, t.zielId)],
);

/**
 * Text einer Seite eines PDF für Suche und Fundstellen. `suchvektor` erzeugt die Datenbank (deutsche Wortstämme plus
 * `simple` für Zahlen, Namen und Fremdwörter).
 */
export const dokumentSeite = pgTable(
  "dokument_seite",
  {
    dokumentId: uuid("dokument_id").notNull().references(() => dokument.id),
    seite: integer("seite").notNull(),
    text: text("text").notNull(),
    /** `text`: Textebene des Dokuments; `ocr`: lokale Texterkennung (dann mit `konfidenz`, 0 bis 100, mittlere Sicherheit der Erkennung der Seite). */
    quelle: text("quelle").notNull().default("text"),
    konfidenz: real("konfidenz"),
    suchvektor: tsvector("suchvektor").generatedAlwaysAs(sql`to_tsvector('german'::regconfig, "text") || to_tsvector('simple'::regconfig, "text")`),
  },
  (t) => [primaryKey({ columns: [t.dokumentId, t.seite] }), index("dokument_seite_suche_idx").using("gin", t.suchvektor), check("dokument_seite_nr", sql`${t.seite} >= 1`), check("dokument_seite_quelle", sql`${t.quelle} IN ('text', 'ocr')`), check("dokument_seite_konfidenz", sql`${t.konfidenz} IS NULL OR (${t.konfidenz} >= 0 AND ${t.konfidenz} <= 100)`)],
);

export const auslesungArt = pgEnum("auslesung_art", ["beteiligungsvertrag", "darlehensvertrag", "bewertungsnachweis", "registerauszug", "kennzahlenbericht", "captable"]);
/** `wartend` (angelegt, im Ausgangskorb) → `eingereiht` (bei pg-boss) → `laeuft` → `bereit` (Vorschläge liegen vor) oder `fehlgeschlagen`; danach `bestaetigt` oder `verworfen` durch eine Person. */
export const auslesungStatus = pgEnum("auslesung_status", ["wartend", "eingereiht", "laeuft", "bereit", "fehlgeschlagen", "bestaetigt", "verworfen"]);

/**
 * Eine KI-Auslesung eines Dokuments: Vorschläge (`felder`, je Wert Seite, Zitat, Sicherheit), die eine Person prüft. Es werden keine
 * Anfragetexte gespeichert, nur die Seitennummern, die geschickt wurden, und das Ergebnis des Anbieters. Erst die Bestätigung schreibt
 * Geschäftsdaten (`ergebnis` nennt die angelegten Datensätze).
 */
export const auslesung = pgTable(
  "auslesung",
  {
    id: id(),
    dokumentId: uuid("dokument_id").notNull().references(() => dokument.id),
    art: auslesungArt("art").notNull(),
    status: auslesungStatus("status").notNull().default("wartend"),
    /** Seitennummern, deren Text an den Anbieter geht. */
    seiten: jsonb("seiten").notNull().default(sql`'[]'::jsonb`),
    vertraulichErlaubt: boolean("vertraulich_erlaubt").notNull().default(false),
    angefordertVon: text("angefordert_von").notNull(),
    angefordertVonName: text("angefordert_von_name"),
    angefordertAm: timestamp("angefordert_am", { withTimezone: true }).notNull().defaultNow(),
    anbieter: text("anbieter"),
    region: text("region"),
    modell: text("modell"),
    /** Vorschläge: `[{ feld, wert, seite, zitat, sicherheit, zitatBelegt }]`. */
    felder: jsonb("felder"),
    /** Kurzer Fehlercode des Laufs (ohne Inhalt der Anfrage oder Antwort). */
    fehlerCode: text("fehler_code"),
    fertigAm: timestamp("fertig_am", { withTimezone: true }),
    entschiedenVon: text("entschieden_von"),
    entschiedenVonName: text("entschieden_von_name"),
    entschiedenAm: timestamp("entschieden_am", { withTimezone: true }),
    /** Angelegte Datensätze nach der Bestätigung: `{ objekte: [{ typ, id }] }`. */
    ergebnis: jsonb("ergebnis"),
  },
  (t) => [index("auslesung_dokument_idx").on(t.dokumentId, t.angefordertAm), index("auslesung_status_idx").on(t.status)],
);

/**
 * Fundstelle eines übernommenen Werts: Aus welchem Dokument, von welcher Seite und mit welchem Zitat ein Wert in einem
 * Datensatz stammt. `wert` ist der bestätigte Wert als Text. Die Herkunftsansicht zeigt „aus Dokument X, Seite 3“.
 */
export const wertQuelle = pgTable(
  "wert_quelle",
  {
    id: id(),
    objektTyp: text("objekt_typ").notNull(),
    objektId: uuid("objekt_id").notNull(),
    feld: text("feld").notNull(),
    wert: text("wert").notNull(),
    dokumentId: uuid("dokument_id").notNull().references(() => dokument.id),
    seite: integer("seite").notNull(),
    zitat: text("zitat").notNull(),
    /** Aus welchem Text das Zitat stammt: `text` (Textebene des Dokuments) oder `ocr` (lokale Texterkennung, kann Fehler enthalten). */
    zitatQuelle: text("zitat_quelle").notNull().default("text"),
    auslesungId: uuid("auslesung_id").references(() => auslesung.id),
    erstelltVon: text("erstellt_von").notNull(),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    index("wert_quelle_objekt_idx").on(t.objektTyp, t.objektId),
    index("wert_quelle_dokument_idx").on(t.dokumentId),
    check("wert_quelle_objekt_typ", sql`${t.objektTyp} IN ('finanzierungsrunde', 'rundenposition', 'anteilsklasse', 'darlehen_kondition', 'bewertung', 'beteiligung', 'registereintrag', 'kennzahl_wert')`),
    check("wert_quelle_seite", sql`${t.seite} >= 1`),
    check("wert_quelle_zitat_quelle", sql`${t.zitatQuelle} IN ('text', 'ocr')`),
  ],
);


// Belegvorlagen und Buchhaltung (Etappe 14) -----------------------------------------------------------------------
// Konvention: Salden sind vorzeichenbehaftet, Soll positiv, Haben negativ (Entscheidung 187).

/** Buchhaltungskonfiguration je Fonds: Angaben für den DATEV-Export und der Präfix der Belegnummern. */
export const fondsBuchhaltung = pgTable(
  "fonds_buchhaltung",
  {
    fondsId: uuid("fonds_id").primaryKey().references(() => fonds.id),
    beraternummer: integer("beraternummer"),
    mandantennummer: integer("mandantennummer"),
    /** Monat (1 bis 12), in dem das Wirtschaftsjahr beginnt. */
    wirtschaftsjahrBeginn: integer("wirtschaftsjahr_beginn").notNull().default(1),
    sachkontenlaenge: integer("sachkontenlaenge").notNull().default(4),
    belegpraefix: text("belegpraefix").notNull().default("B"),
    geaendertVon: text("geaendert_von").notNull(),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("fonds_buchhaltung_wj", sql`${t.wirtschaftsjahrBeginn} BETWEEN 1 AND 12`),
    check("fonds_buchhaltung_laenge", sql`${t.sachkontenlaenge} BETWEEN 4 AND 8`),
    check("fonds_buchhaltung_praefix", sql`${t.belegpraefix} ~ '^[A-Za-z0-9-]{0,12}$'`),
  ],
);

/**
 * Meldeart einer Mittelart des Fonds: ordnet die Mittelherkunft (Entscheidung 187 ff., Etappe 14) den Kategorien zu, nach denen die
 * Meldedefinitionen filtern und gruppieren. Mittelarten ohne Meldeart zählen in keiner Kategorie.
 */
export const meldeMittelart = pgEnum("melde_mittelart", ["foerdermittel", "kofinanzierung", "eigenmittel", "rueckflussmittel"]);

/** Förderprogramm als Stammdatum für Filter und Gruppierung der Meldungen (global, wird nie gelöscht). */
export const foerderprogramm = pgTable(
  "foerderprogramm",
  {
    id: id(),
    schluessel: text("schluessel").notNull(),
    bezeichnung: text("bezeichnung").notNull(),
    erstelltVon: text("erstellt_von").notNull().default("system"),
    erstelltAm: erstelltAm(),
  },
  (t) => [uniqueIndex("foerderprogramm_schluessel_uq").on(t.schluessel), check("foerderprogramm_schluessel", sql`${t.schluessel} ~ '^[a-z][a-z0-9_]{1,59}$'`)],
);

/**
 * Förder- und Buchhaltungsschlüssel je Beteiligung (Projekt-, Vertrags-, Partnernummer, Buchungskreis, Förderprogramm): die einzige Stelle dafür.
 * Buchhaltung (Belege, Export) und Meldeberichte lesen sie hier. Hat keinen Verlauf: Es gilt immer der heutige Eintrag; ein Meldelauf hält die
 * verwendeten Werte fest.
 */
export const beteiligungBuchhaltung = pgTable("beteiligung_buchhaltung", {
  beteiligungId: uuid("beteiligung_id").primaryKey().references(() => beteiligung.id),
  projektnummer: text("projektnummer"),
  vertragsnummer: text("vertragsnummer"),
  partnernummer: text("partnernummer"),
  buchungskreis: text("buchungskreis"),
  foerderprogrammId: uuid("foerderprogramm_id").references(() => foerderprogramm.id),
  geaendertVon: text("geaendert_von").notNull(),
  geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
});

/** Mittelart (Mittelherkunft) eines Fonds mit Quote, gültig in einem Zeitraum; die Quoten eines Zeitpunkts ergeben 1. */
export const fondsMittelart = pgTable(
  "fonds_mittelart",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    schluessel: text("schluessel").notNull(),
    bezeichnungDe: text("bezeichnung_de").notNull(),
    bezeichnungEn: text("bezeichnung_en").notNull(),
    quote: numeric("quote", { precision: 8, scale: 6 }).notNull(),
    /** Kategorie für die Meldeberichte (Fördermittel, Kofinanzierung, …); leer = in keiner Kategorie. */
    meldeArt: meldeMittelart("melde_art"),
    gueltigAb: date("gueltig_ab").notNull(),
    gueltigBis: date("gueltig_bis"),
  },
  (t) => [
    uniqueIndex("fonds_mittelart_uq").on(t.fondsId, t.schluessel, t.gueltigAb),
    check("fonds_mittelart_quote", sql`${t.quote} >= 0 AND ${t.quote} <= 1`),
    check("fonds_mittelart_zeitraum", sql`${t.gueltigBis} IS NULL OR ${t.gueltigBis} >= ${t.gueltigAb}`),
  ],
);

export const belegArt = pgEnum("beleg_art", ["vertragsanlage", "auszahlung", "zinsbuchung", "verkauf", "wandlung", "kapitalabruf", "ausschuettung", "frei"]);
export const belegBezugArt = pgEnum("beleg_bezug_art", ["vorgang", "zinslauf", "verkauf", "wandlung", "beteiligung", "fonds_bewegung"]);
export const belegStatus = pgEnum("beleg_status", ["entwurf", "geprueft", "freigegeben", "storniert"]);

/**
 * Eigene Belegart eines Fonds. Sie erbt von einer Basis-Art des festen Katalogs Erzeugung (erlaubte Bezüge, Vorbefüllung), Feldkatalog
 * und Nummernkreis; eigen sind Name (Deutsch, Englisch) und über die Vorlage Feldauswahl, Pflichtfelder sowie Kopf- und Fußtext.
 * Die Basis-Art ändert sich nach dem Anlegen nicht. Eine Art mit Belegen wird nur stillgelegt (`aktiv`), nicht gelöscht.
 */
export const belegArtEigen = pgTable(
  "beleg_art_eigen",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    basisArt: belegArt("basis_art").notNull(),
    bezeichnungDe: text("bezeichnung_de").notNull(),
    bezeichnungEn: text("bezeichnung_en").notNull(),
    aktiv: boolean("aktiv").notNull().default(true),
    erstelltVon: text("erstellt_von").notNull(),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("beleg_art_eigen_name_uq").on(t.fondsId, t.bezeichnungDe)],
);

/** Vorlage eines Belegs je Fonds und Art: welche Geschäftsfelder wohin gehören, Kopf- und Fußtexte, Pflichtfelder. */
export const belegVorlage = pgTable(
  "beleg_vorlage",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    /** Basis-Art; bei einer eigenen Belegart die Art, von der sie Erzeugung und Feldkatalog erbt. */
    art: belegArt("art").notNull(),
    /** Gesetzt für die Vorlage einer eigenen Belegart des Fonds. */
    eigeneArtId: uuid("eigene_art_id").references(() => belegArtEigen.id),
    felder: jsonb("felder").notNull(),
    kopfDe: text("kopf_de").notNull().default(""),
    kopfEn: text("kopf_en").notNull().default(""),
    fussDe: text("fuss_de").notNull().default(""),
    fussEn: text("fuss_en").notNull().default(""),
    geaendertVon: text("geaendert_von").notNull(),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("beleg_vorlage_frei_eigene_art", sql`${t.art}::text <> 'frei' OR ${t.eigeneArtId} IS NOT NULL`),
    uniqueIndex("beleg_vorlage_fonds_art_uq").on(t.fondsId, t.art).where(sql`${t.eigeneArtId} IS NULL`),
    uniqueIndex("beleg_vorlage_eigene_art_uq").on(t.fondsId, t.eigeneArtId).where(sql`${t.eigeneArtId} IS NOT NULL`),
  ],
);

/**
 * Beleg zu einem Geschäftsvorfall. Entwurf und geprüfter Stand erzeugen die Datei bei jedem Abruf neu (mit Wasserzeichen);
 * die Freigabe vergibt die Belegnummer (lückenlos je Fonds), speichert das PDF unveränderlich und hält den SHA-256 fest.
 * Ein freigegebener Beleg ändert sich nicht (Trigger); einzig die Stornierung (Status `storniert` mit Zeitpunkt, Person und Grund) ist
 * zulässig. Ein stornierter Beleg behält Nummer und Datei; die Nummer bleibt vergeben. Je Art und Bezug gibt es höchstens einen nicht
 * stornierten Beleg (teilweise eindeutiger Index), nach einer Stornierung darf ein neuer entstehen.
 */
export const beleg = pgTable(
  "beleg",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    /** Basis-Art (bei einer eigenen Belegart die Art, von der sie erbt). */
    art: belegArt("art").notNull(),
    /** Eigene Belegart des Fonds, falls der Beleg zu einer gehört. */
    eigeneArtId: uuid("eigene_art_id").references(() => belegArtEigen.id),
    bezugArt: belegBezugArt("bezug_art").notNull(),
    bezugId: uuid("bezug_id").notNull(),
    beteiligungId: uuid("beteiligung_id").references(() => beteiligung.id),
    sprache: text("sprache").notNull(),
    status: belegStatus("status").notNull().default("entwurf"),
    /** Zum Zeitpunkt der Erzeugung festgehaltene Vorlage. */
    vorlage: jsonb("vorlage").notNull(),
    /** Vorbefüllte Werte (je Feldschlüssel), Mittelherkunft und Rechenschritte. */
    daten: jsonb("daten").notNull(),
    /** Fehlende Pflichtfelder: Liste von { feld, code }. */
    befunde: jsonb("befunde").notNull().default(sql`'[]'::jsonb`),
    naechsteStufe: integer("naechste_stufe").notNull().default(0),
    belegnummer: text("belegnummer"),
    belegnummerLfd: integer("belegnummer_lfd"),
    erstelltVon: text("erstellt_von").notNull(),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
    freigegebenAm: timestamp("freigegeben_am", { withTimezone: true }),
    dateiName: text("datei_name"),
    dateiSchluessel: text("datei_schluessel"),
    dateiSha256: text("datei_sha256"),
    dateiGroesse: integer("datei_groesse"),
    stornoAm: timestamp("storno_am", { withTimezone: true }),
    stornoVon: text("storno_von"),
    stornoGrund: text("storno_grund"),
  },
  (t) => [
    check("beleg_frei_eigene_art", sql`${t.art}::text <> 'frei' OR ${t.eigeneArtId} IS NOT NULL`),
    uniqueIndex("beleg_bezug_uq").on(t.art, t.bezugArt, t.bezugId).where(sql`${t.stornoAm} IS NULL AND ${t.eigeneArtId} IS NULL`),
    uniqueIndex("beleg_bezug_eigene_uq").on(t.eigeneArtId, t.bezugArt, t.bezugId).where(sql`${t.stornoAm} IS NULL AND ${t.eigeneArtId} IS NOT NULL`),
    uniqueIndex("beleg_nummer_uq").on(t.fondsId, t.belegnummerLfd),
    index("beleg_fonds_idx").on(t.fondsId, t.erstelltAm),
    index("beleg_bezug_id_idx").on(t.bezugId),
    // Eine Nummer haben genau die Belege, die freigegeben wurden (auch die später stornierten). Der Vergleich läuft über Text, damit die Migration den neuen Wert nicht in derselben Transaktion verwendet.
    check("beleg_nummer_status", sql`(${t.belegnummer} IS NOT NULL) = (${t.status}::text IN ('freigegeben', 'storniert'))`),
    check("beleg_storno_angaben", sql`(${t.stornoAm} IS NULL) = (${t.stornoVon} IS NULL) AND (${t.stornoAm} IS NULL) = (${t.stornoGrund} IS NULL) AND (${t.stornoAm} IS NULL OR ${t.belegnummer} IS NOT NULL)`),
  ],
);

/** Protokoll der Stufen eines Belegs (nur anhängend, Trigger): Prüfung, Freigabe, Rückgabe. */
export const belegStufe = pgTable(
  "beleg_stufe",
  {
    id: id(),
    belegId: uuid("beleg_id").notNull().references(() => beleg.id),
    stufeIndex: integer("stufe_index").notNull(),
    stufe: text("stufe").notNull(),
    ergebnis: text("ergebnis").notNull(),
    kommentar: text("kommentar"),
    akteur: text("akteur").notNull(),
    am: timestamp("am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("beleg_stufe_beleg_idx").on(t.belegId, t.am), check("beleg_stufe_ergebnis", sql`${t.ergebnis} IN ('ok', 'zurueck')`)],
);

/** Zähler der Belegnummern je Fonds. Die Zeile wird bei der Freigabe gesperrt (`FOR UPDATE`): lückenlos, kein Postgres-Zähler. */
export const belegNummernkreis = pgTable("beleg_nummernkreis", {
  fondsId: uuid("fonds_id").primaryKey().references(() => fonds.id),
  letzte: integer("letzte").notNull().default(0),
});

export const sachkontoArt = pgEnum("sachkonto_art", ["aktiv", "passiv", "aufwand", "ertrag"]);
export const gliederungSicht = pgEnum("gliederung_sicht", ["bilanz", "guv", "liquiditaet", "mittelverwendung", "portfolio"]);

/** Konto des Kontenrahmens eines Fonds. Optional mit einer Beteiligung verknüpft (Einzelabstimmung des Portfolios). */
export const sachkonto = pgTable(
  "sachkonto",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    nummer: text("nummer").notNull(),
    bezeichnung: text("bezeichnung").notNull(),
    art: sachkontoArt("art").notNull(),
    beteiligungId: uuid("beteiligung_id").references(() => beteiligung.id),
  },
  (t) => [uniqueIndex("sachkonto_fonds_nummer_uq").on(t.fondsId, t.nummer), check("sachkonto_nummer", sql`${t.nummer} ~ '^[0-9]{1,9}$'`)],
);

/** Position einer Gliederung (Sicht) je Fonds. `seite` ist die Seite, deren Saldo auf der Position positiv erscheint (soll oder haben). */
export const gliederungPosition = pgTable(
  "gliederung_position",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    sicht: gliederungSicht("sicht").notNull(),
    schluessel: text("schluessel").notNull(),
    elternSchluessel: text("eltern_schluessel"),
    bezeichnungDe: text("bezeichnung_de").notNull(),
    bezeichnungEn: text("bezeichnung_en").notNull(),
    reihenfolge: integer("reihenfolge").notNull(),
    seite: text("seite").notNull().default("soll"),
  },
  (t) => [uniqueIndex("gliederung_position_uq").on(t.fondsId, t.sicht, t.schluessel), check("gliederung_position_seite", sql`${t.seite} IN ('soll', 'haben')`)],
);

/** Kontenregel: Konto oder Kontobereich → Position einer Sicht, gültig in einem Zeitraum (versioniert, nie gelöscht). */
export const kontenregel = pgTable(
  "kontenregel",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    sicht: gliederungSicht("sicht").notNull(),
    kontoVon: text("konto_von").notNull(),
    kontoBis: text("konto_bis").notNull(),
    positionSchluessel: text("position_schluessel").notNull(),
    gueltigAb: date("gueltig_ab").notNull(),
    gueltigBis: date("gueltig_bis"),
    erstelltVon: text("erstellt_von").notNull(),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("kontenregel_fonds_sicht_idx").on(t.fondsId, t.sicht),
    check("kontenregel_konten", sql`${t.kontoVon} ~ '^[0-9]{1,9}$' AND ${t.kontoBis} ~ '^[0-9]{1,9}$' AND length(${t.kontoVon}) = length(${t.kontoBis}) AND ${t.kontoBis} >= ${t.kontoVon}`),
    check("kontenregel_zeitraum", sql`${t.gueltigBis} IS NULL OR ${t.gueltigBis} >= ${t.gueltigAb}`),
  ],
);

export const saldenlaufStatus = pgEnum("saldenlauf_status", ["hochgeladen", "geprueft", "uebernommen"]);

/**
 * Lauf zum Einlesen einer Summen- und Saldenliste für einen Zeitraum eines Fonds. Hochladen und Prüfen durch Bearbeiter, Übernehmen
 * durch eine andere Person mit Rolle Freigeber. Ein späterer übernommener Lauf für denselben Zeitraum ersetzt den früheren
 * (`ersetzt_am`); alle Läufe bleiben erhalten. Salden stehen in `saldo`.
 */
export const saldenlauf = pgTable(
  "saldenlauf",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    zeitraumVon: date("zeitraum_von").notNull(),
    zeitraumBis: date("zeitraum_bis").notNull(),
    dateiname: text("dateiname").notNull(),
    dateityp: text("dateityp").notNull(),
    format: text("format"),
    groesse: integer("groesse").notNull(),
    sha256: text("sha256").notNull(),
    datei: bytea("datei").notNull(),
    status: saldenlaufStatus("status").notNull().default("hochgeladen"),
    hochgeladenVon: text("hochgeladen_von").notNull(),
    hochgeladenAm: timestamp("hochgeladen_am", { withTimezone: true }).notNull().defaultNow(),
    geprueftVon: text("geprueft_von"),
    geprueftAm: timestamp("geprueft_am", { withTimezone: true }),
    fehlerAnzahl: integer("fehler_anzahl"),
    warnungAnzahl: integer("warnung_anzahl"),
    summe: jsonb("summe"),
    uebernommenVon: text("uebernommen_von"),
    uebernommenAm: timestamp("uebernommen_am", { withTimezone: true }),
    ersetztAm: timestamp("ersetzt_am", { withTimezone: true }),
    ersetztVonLaufId: uuid("ersetzt_von_lauf_id").references((): AnyPgColumn => saldenlauf.id),
  },
  (t) => [index("saldenlauf_fonds_idx").on(t.fondsId, t.zeitraumBis), check("saldenlauf_zeitraum", sql`${t.zeitraumBis} >= ${t.zeitraumVon}`)],
);

export const saldenlaufBefund = pgTable(
  "saldenlauf_befund",
  {
    id: id(),
    laufId: uuid("lauf_id").notNull().references(() => saldenlauf.id, { onDelete: "cascade" }),
    nr: integer("nr").notNull(),
    zeile: integer("zeile"),
    spalte: text("spalte"),
    code: text("code").notNull(),
    schweregrad: text("schweregrad").notNull(),
    meldung: text("meldung").notNull(),
    params: jsonb("params").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [index("saldenlauf_befund_idx").on(t.laufId, t.nr), check("saldenlauf_befund_grad", sql`${t.schweregrad} IN ('fehler', 'warnung')`)],
);

/** Saldo eines Kontos im Lauf: Endsaldo am Periodenende, Soll positiv. */
export const saldo = pgTable(
  "saldo",
  {
    id: id(),
    laufId: uuid("lauf_id").notNull().references(() => saldenlauf.id, { onDelete: "cascade" }),
    zeile: integer("zeile").notNull(),
    kontoNummer: text("konto_nummer").notNull(),
    /** Bilanzgruppe nach den Kontenregeln bei Übernahme der Liste. */
    navGruppe: text("nav_gruppe"),
    bezeichnung: text("bezeichnung"),
    ebWert: betrag("eb_wert"),
    soll: betrag("soll"),
    haben: betrag("haben"),
    saldo: betrag("saldo").notNull(),
  },
  (t) => [uniqueIndex("saldo_lauf_konto_uq").on(t.laufId, t.kontoNummer)],
);

export const buchungsquelle = pgEnum("buchungsquelle", ["zins", "auszahlung", "rueckfluss", "tilgung", "zusage", "wertberichtigung", "abruf", "ausschuettung", "zinszahlung", "dividende", "principal_disposal", "impairment_disposal", "interest_waiver", "principal_waiver"]);

/** Kontenzuordnung des DATEV-Exports je Fonds und Vorgangsart. `richtung` ist die Seite des Kontos (S oder H); das Gegenkonto steht gegenüber. */
export const buchungsregel = pgTable(
  "buchungsregel",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    quelle: buchungsquelle("quelle").notNull(),
    konto: text("konto").notNull(),
    gegenkonto: text("gegenkonto").notNull(),
    richtung: text("richtung").notNull().default("S"),
    buSchluessel: text("bu_schluessel"),
    buchungstext: text("buchungstext").notNull(),
    geaendertVon: text("geaendert_von").notNull(),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("buchungsregel_uq").on(t.fondsId, t.quelle),
    check("buchungsregel_richtung", sql`${t.richtung} IN ('S', 'H')`),
    check("buchungsregel_konten", sql`${t.konto} ~ '^[0-9]{1,9}$' AND ${t.gegenkonto} ~ '^[0-9]{1,9}$'`),
  ],
);

/** Lauf des Buchungsexports. Die Datei liegt unveränderlich im Speicher (`datei_schluessel`, SHA-256). */
export const buchungsexport = pgTable(
  "buchungsexport",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    formatVersion: text("format_version").notNull(),
    erzeugtVon: text("erzeugt_von").notNull(),
    erzeugtAm: timestamp("erzeugt_am", { withTimezone: true }).notNull().defaultNow(),
    datumVon: date("datum_von").notNull(),
    datumBis: date("datum_bis").notNull(),
    anzahl: integer("anzahl").notNull(),
    summe: betrag("summe").notNull(),
    wiederholung: boolean("wiederholung").notNull().default(false),
    grund: text("grund"),
    dateiName: text("datei_name").notNull(),
    dateiSchluessel: text("datei_schluessel").notNull(),
    dateiSha256: text("datei_sha256").notNull(),
    dateiGroesse: integer("datei_groesse").notNull(),
  },
  (t) => [index("buchungsexport_fonds_idx").on(t.fondsId, t.erzeugtAm)],
);

/**
 * Exportierte Buchung: ein Vorgang oder eine Fondsbewegung (genau eines von beiden). Höchstens eine aktive Zeile je Vorgang und je
 * Fondsbewegung (kein doppelter Export); eine ausdrückliche Wiederholung ersetzt die Markierung.
 */
export const buchungsexportPosition = pgTable(
  "buchungsexport_position",
  {
    id: id(),
    exportId: uuid("export_id").notNull().references(() => buchungsexport.id),
    vorgangId: uuid("vorgang_id").references(() => vorgang.id),
    fondsBewegungId: uuid("fonds_bewegung_id").references(() => fondsBewegung.id),
    aktiv: boolean("aktiv").notNull().default(true),
    belegfeld: text("belegfeld").notNull(),
    betrag: betrag("betrag").notNull(),
  },
  (t) => [
    uniqueIndex("buchungsexport_position_aktiv_uq").on(t.vorgangId).where(sql`${t.aktiv}`),
    uniqueIndex("buchungsexport_position_bewegung_aktiv_uq").on(t.fondsBewegungId).where(sql`${t.aktiv}`),
    index("buchungsexport_position_export_idx").on(t.exportId),
    check("buchungsexport_position_quelle", sql`(${t.vorgangId} IS NOT NULL) <> (${t.fondsBewegungId} IS NOT NULL)`),
  ],
);

// Förder- und Meldeberichte (Etappe 15) ------------------------------------------------------------------------

export const meldeRhythmus = pgEnum("melde_rhythmus", ["quartal", "halbjahr", "jahr", "stichtag"]);
/** Ausgabeformat einer Meldedefinition. `xml` ist vorgesehen (strukturelle Vorbereitung), die Erzeugung gibt es noch nicht. */
export const meldeFormat = pgEnum("melde_format", ["xlsx", "csv", "pdf", "xml"]);
export const meldeLaufStatus = pgEnum("melde_lauf_status", ["entwurf", "geprueft", "freigegeben"]);
export const meldeDateiArt = pgEnum("melde_datei_art", ["meldung", "pruefansicht"]);

/** Sitzland (ISO 3166-1, zwei Großbuchstaben) und Region einer Organisation für Filter und Spalten der Meldungen; ohne Verlauf wie die Schlüssel der Beteiligung. */
export const organisationMeldedaten = pgTable(
  "organisation_meldedaten",
  {
    organisationId: uuid("organisation_id").primaryKey().references(() => organisation.id),
    sitzland: text("sitzland"),
    region: text("region"),
    geaendertVon: text("geaendert_von").notNull(),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("organisation_meldedaten_sitzland", sql`${t.sitzland} IS NULL OR ${t.sitzland} ~ '^[A-Z]{2}$'`)],
);

/**
 * Meldedefinition als versionierte Konfiguration (kein Code): eine Zeile je Schlüssel und Version; eine neue Version begrenzt die alte mit
 * `gueltig_bis`. Eine Zeile wird nie geändert (außer dieser Begrenzung) und nie gelöscht (Trigger), damit Läufe ihre Definition behalten.
 * `definition` ist der Inhalt (Abschnitte, Quellen, Regeln); Aufbau prüft Zod in `packages/berichte`.
 */
export const meldeDefinition = pgTable(
  "melde_definition",
  {
    id: id(),
    schluessel: text("schluessel").notNull(),
    version: integer("version").notNull(),
    bezeichnungDe: text("bezeichnung_de").notNull(),
    bezeichnungEn: text("bezeichnung_en").notNull(),
    herausgeber: text("herausgeber").notNull(),
    rhythmus: meldeRhythmus("rhythmus").notNull(),
    format: meldeFormat("format").notNull(),
    gueltigAb: date("gueltig_ab").notNull(),
    gueltigBis: date("gueltig_bis"),
    definition: jsonb("definition").notNull(),
    erstelltVon: text("erstellt_von").notNull().default("system"),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    uniqueIndex("melde_definition_version_uq").on(t.schluessel, t.version),
    check("melde_definition_schluessel", sql`${t.schluessel} ~ '^[a-z][a-z0-9_]{1,59}$'`),
    check("melde_definition_gueltig", sql`${t.gueltigBis} IS NULL OR ${t.gueltigBis} >= ${t.gueltigAb}`),
  ],
);

/** Welche Meldedefinitionen ein Fonds verwendet, optional mit einem Förderprogramm als Filter aller Läufe. */
export const meldeAktivierung = pgTable(
  "melde_aktivierung",
  {
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    schluessel: text("schluessel").notNull(),
    foerderprogrammId: uuid("foerderprogramm_id").references(() => foerderprogramm.id),
    aktiviertVon: text("aktiviert_von").notNull(),
    aktiviertAm: timestamp("aktiviert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.fondsId, t.schluessel] })],
);

/**
 * Meldelauf: ein Fonds, eine Definitionsversion, ein Zeitraum. Beim Anlegen werden alle Werte zu `stand` berechnet und in `melde_wert`
 * festgehalten; die Freigabe erzeugt die Dateien aus genau diesen Werten (keine Neuberechnung) und friert den Lauf ein (Trigger).
 * `definition` hält die Definitionsversion als Schnappschuss fest. Eine Neuberechnung nach der Freigabe ist ein neuer Lauf (`fassung`, `vorgaenger_id`).
 */
export const meldeLauf = pgTable(
  "melde_lauf",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    foerderprogrammId: uuid("foerderprogramm_id").references(() => foerderprogramm.id),
    definitionId: uuid("definition_id").notNull().references(() => meldeDefinition.id),
    definitionSchluessel: text("definition_schluessel").notNull(),
    definitionVersion: integer("definition_version").notNull(),
    definition: jsonb("definition").notNull(),
    format: meldeFormat("format").notNull(),
    sprache: text("sprache").notNull(),
    periodeArt: meldeRhythmus("periode_art").notNull(),
    /** `2026-Q3`, `2026-H1`, `2026` oder das Datum des Stichtags. */
    periodeKennung: text("periode_kennung").notNull(),
    periodeBeginn: date("periode_beginn").notNull(),
    periodeEnde: date("periode_ende").notNull(),
    fassung: integer("fassung").notNull().default(1),
    vorgaengerId: uuid("vorgaenger_id").references((): AnyPgColumn => meldeLauf.id),
    /** Gewünschter Wissensstand; leer = Zeitpunkt der Berechnung. */
    standVorgabe: timestamp("stand_vorgabe", { withTimezone: true }),
    /** Wissensstand, zu dem gerechnet wurde. */
    stand: timestamp("stand", { withTimezone: true }).notNull(),
    berechnetAm: timestamp("berechnet_am", { withTimezone: true }).notNull().defaultNow(),
    status: meldeLaufStatus("status").notNull().default("entwurf"),
    freigabestufen: jsonb("freigabestufen").notNull(),
    naechsteStufe: integer("naechste_stufe").notNull().default(0),
    /** Kommentare zu Warnungen je Regel: `{ [regelId]: { text, von, am } }`. */
    befundKommentare: jsonb("befund_kommentare").notNull().default(sql`'{}'::jsonb`),
    erstelltVon: text("erstellt_von").notNull(),
    erstelltAm: erstelltAm(),
    freigegebenAm: timestamp("freigegeben_am", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("melde_lauf_fassung_uq").on(t.fondsId, t.definitionSchluessel, t.periodeKennung, t.fassung),
    index("melde_lauf_fonds_idx").on(t.fondsId, t.periodeEnde),
    check("melde_lauf_sprache", sql`${t.sprache} IN ('de', 'en')`),
    check("melde_lauf_periode", sql`${t.periodeEnde} >= ${t.periodeBeginn}`),
  ],
);

/** Ein berechneter oder eingegebener Wert eines Laufs (Schlüssel `abschnitt.feld` oder `abschnitt.zeile.spalte`), mit Herkunft; nach der Freigabe unveränderlich (Trigger). */
export const meldeWert = pgTable(
  "melde_wert",
  {
    id: id(),
    laufId: uuid("lauf_id").notNull().references(() => meldeLauf.id),
    schluessel: text("schluessel").notNull(),
    /** Art der Quelle (`kennzahl`, `vorgang`, `manuell`, …; `zeile` für die Beschriftung einer Tabellenzeile), zur Anzeige. */
    art: text("art").notNull(),
    /** Stelle in der Berechnung (ordnet Zeilen und Spalten). */
    reihenfolge: integer("reihenfolge").notNull().default(0),
    /** Kanonischer Text (Zahlen als Dezimalzahl mit Punkt); `null` = keine Angabe („k. A.“). */
    wert: text("wert"),
    herkunft: jsonb("herkunft"),
    manuell: boolean("manuell").notNull().default(false),
    geaendertVon: text("geaendert_von"),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("melde_wert_lauf_schluessel_uq").on(t.laufId, t.schluessel)],
);

/** Protokoll der Freigabestufen eines Meldelaufs (nur anhängend, Trigger). */
export const meldeFreigabe = pgTable(
  "melde_freigabe",
  {
    id: id(),
    laufId: uuid("lauf_id").notNull().references(() => meldeLauf.id),
    stufeIndex: integer("stufe_index").notNull(),
    stufe: text("stufe").notNull(),
    ergebnis: text("ergebnis").notNull(),
    kommentar: text("kommentar"),
    akteur: text("akteur").notNull(),
    am: timestamp("am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("melde_freigabe_lauf_idx").on(t.laufId, t.am), check("melde_freigabe_ergebnis", sql`${t.ergebnis} IN ('ok', 'zurueck')`)],
);

/** Unveränderlich gespeicherte Datei eines freigegebenen Meldelaufs: die Meldung selbst und eine PDF-Prüfansicht (SHA-256, Trigger gegen Ändern und Löschen). */
export const meldeDatei = pgTable(
  "melde_datei",
  {
    id: id(),
    laufId: uuid("lauf_id").notNull().references(() => meldeLauf.id),
    art: meldeDateiArt("art").notNull(),
    format: meldeFormat("format").notNull(),
    name: text("name").notNull(),
    schluessel: text("schluessel").notNull(),
    sha256: text("sha256").notNull(),
    groesse: integer("groesse").notNull(),
    erzeugtAm: timestamp("erzeugt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("melde_datei_lauf_art_uq").on(t.laufId, t.art)],
);

// Nachhaltigkeit: Einordnung der Fonds (Etappe 16) ---------------------------------------------------------------

/** Einordnung eines Fonds nach den Artikeln 6, 8 oder 9 der Offenlegungsverordnung; nur die Nummer, kein Rechtstext. */
export const offenlegungArt = pgEnum("offenlegung_art", ["art6", "art8", "art9"]);

/**
 * Verlauf der Einordnung eines Fonds: je Eintrag die Einordnung ab einem Datum (`gueltig_ab`). Es gilt der jüngste Eintrag bis zum Stichtag.
 * Einträge werden nie geändert oder gelöscht (Trigger); eine Änderung ist ein neuer Eintrag mit späterem Datum.
 */
export const fondsOffenlegung = pgTable(
  "fonds_offenlegung",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    art: offenlegungArt("art").notNull(),
    gueltigAb: date("gueltig_ab").notNull(),
    bemerkung: text("bemerkung"),
    erfasstVon: text("erfasst_von").notNull(),
    erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("fonds_offenlegung_fonds_ab_uq").on(t.fondsId, t.gueltigAb)],
);

// Mail und Kalender (Etappe 17) ---------------------------------------------------------------------------------------

export const mailStatus = pgEnum("mail_status", ["wartend", "gesendet", "fehlgeschlagen"]);

/**
 * Ausgangskorb für Mails (Muster wie `snapshot_auftrag`): Die Zeile entsteht in der Transaktion der Fachaktion, der Worker versendet.
 * `inhalt_verschluesselt` hält Text und HTML (AES-256-GCM, siehe `apps/api/src/geheimnis`), weil sie einen einmaligen Link enthalten
 * können; nach dem Versand und nach dem endgültigen Fehlschlag wird die Spalte geleert. Das Protokoll (`aenderung`) und Logs enthalten nie den Inhalt.
 */
export const mailAuftrag = pgTable(
  "mail_auftrag",
  {
    id: id(),
    empfaenger: text("empfaenger").notNull(),
    sprache: text("sprache").notNull().default("de"),
    vorlage: text("vorlage").notNull(),
    betreff: text("betreff").notNull(),
    bezugArt: text("bezug_art"),
    bezugId: text("bezug_id"),
    inhaltVerschluesselt: text("inhalt_verschluesselt"),
    status: mailStatus("status").notNull().default("wartend"),
    versuche: integer("versuche").notNull().default(0),
    naechsterVersuchAm: timestamp("naechster_versuch_am", { withTimezone: true }).notNull().defaultNow(),
    /** Der Worker hat den Auftrag bis dahin in Arbeit (verhindert doppelten Versand bei mehreren Workern, läuft bei Absturz ab). */
    gesperrtBis: timestamp("gesperrt_bis", { withTimezone: true }),
    letzterFehler: text("letzter_fehler"),
    erstelltVon: text("erstellt_von").notNull(),
    erstelltAm: erstelltAm(),
    gesendetAm: timestamp("gesendet_am", { withTimezone: true }),
  },
  (t) => [
    index("mail_auftrag_faellig_idx").on(t.status, t.naechsterVersuchAm),
    index("mail_auftrag_gesendet_idx").on(t.gesendetAm),
    check("mail_auftrag_sprache", sql`${t.sprache} IN ('de', 'en')`),
  ],
);

/** Einstellungen je Person (Mail-Sprache, Thema der Oberfläche, Opt-in für interne Benachrichtigungen). */
export const benutzerEinstellung = pgTable(
  "benutzer_einstellung",
  {
    benutzerId: uuid("benutzer_id").primaryKey().references(() => benutzer.id, { onDelete: "cascade" }),
    sprache: text("sprache").notNull().default("de"),
    /** Thema der Oberfläche: `system` (folgt dem Betriebssystem, Standard), `hell` oder `dunkel`. Gilt für interne Personen und Investor-Benutzer. */
    thema: text("thema").notNull().default("system"),
    dealflowKartenfelder: text("dealflow_kartenfelder").array().notNull().default(sql`ARRAY['ticket', 'investmentmanager']::text[]`),
    /** Interne Benachrichtigung, wenn ein Bericht freigegeben wurde (Standard aus). */
    mailBerichtFreigegeben: boolean("mail_bericht_freigegeben").notNull().default(false),
    /** Interne Benachrichtigung bei neuen Registerereignissen (Insolvenz, Kapitalerhöhung, Löschung) von Unternehmen der eigenen Fonds (Etappe 18, Standard aus). */
    mailRegisterEreignis: boolean("mail_register_ereignis").notNull().default(false),
    aktualisiertAm: timestamp("aktualisiert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("benutzer_einstellung_thema", sql`${t.thema} IN ('system', 'hell', 'dunkel')`)],
);

export const postfachBereich = pgEnum("postfach_bereich", ["mail", "kalender"]);
export const postfachAnbieter = pgEnum("postfach_anbieter", ["microsoft", "google", "imap", "demo"]);

/**
 * Verbindung einer Person zu ihrem Postfach oder Kalender. Zugangsdaten (OAuth-Tokens, IMAP-Zugang) stehen nur verschlüsselt in
 * `zugang_verschluesselt`; nur die Person selbst kommt über die API an die Verbindung (auch Verwalter nicht). Trennen löscht die Zeile.
 */
export const postfachVerbindung = pgTable(
  "postfach_verbindung",
  {
    id: id(),
    benutzerId: uuid("benutzer_id").notNull().references(() => benutzer.id, { onDelete: "cascade" }),
    bereich: postfachBereich("bereich").notNull(),
    anbieter: postfachAnbieter("anbieter").notNull(),
    zugangVerschluesselt: text("zugang_verschluesselt").notNull(),
    /** `verbunden`, `fehler` (wird wiederholt) oder `erneut_anmelden` (Zugang vom Anbieter widerrufen oder abgelaufen). */
    status: text("status").notNull().default("verbunden"),
    letzterAbgleichAm: timestamp("letzter_abgleich_am", { withTimezone: true }),
    /** Nur ein Fehlercode, nie eine Anbieter-Antwort. */
    letzterFehler: text("letzter_fehler"),
    /** Stand des Abgleichs (Mail: letzter Zeitpunkt; IMAP: UIDVALIDITY und UID; Kalender: Zeitpunkt). */
    abgleichStand: text("abgleich_stand"),
    naechsterAbgleichAm: timestamp("naechster_abgleich_am", { withTimezone: true }).notNull().defaultNow(),
    gesperrtBis: timestamp("gesperrt_bis", { withTimezone: true }),
    /** Bei Mails: die ersten 500 Zeichen des Textes als Notiz speichern (Standard aus, nur Betreff). */
    inhaltSpeichern: boolean("inhalt_speichern").notNull().default(false),
    /** Nächster Mailabgleich schaut wieder den ersten Zeitraum zurück (nach neuen Kontakten aus Postfach und Kalender); der Abgleich setzt es beim Start zurück. */
    nachholen: boolean("nachholen").notNull().default(false),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    uniqueIndex("postfach_verbindung_benutzer_bereich_uq").on(t.benutzerId, t.bereich),
    index("postfach_verbindung_faellig_idx").on(t.naechsterAbgleichAm),
    check("postfach_verbindung_status", sql`${t.status} IN ('verbunden', 'fehler', 'erneut_anmelden')`),
  ],
);

/** Laufender OAuth-Ablauf (Autorisierungscode mit PKCE): einmalig, kurzlebig, an die Person gebunden; `state` und `nonce` nur als Hash. */
export const oauthZustand = pgTable(
  "oauth_zustand",
  {
    id: id(),
    benutzerId: uuid("benutzer_id").notNull().references(() => benutzer.id, { onDelete: "cascade" }),
    stateHash: text("state_hash").notNull(),
    nonceHash: text("nonce_hash").notNull(),
    verifierVerschluesselt: text("verifier_verschluesselt").notNull(),
    anbieter: postfachAnbieter("anbieter").notNull(),
    bereich: postfachBereich("bereich").notNull(),
    ablauf: timestamp("ablauf", { withTimezone: true }).notNull(),
    erstelltAm: erstelltAm(),
  },
  (t) => [uniqueIndex("oauth_zustand_state_uq").on(t.stateHash), index("oauth_zustand_ablauf_idx").on(t.ablauf)],
);

/**
 * Herkunft einer synchronisierten Aktivität (Mail oder Termin): wem die Verbindung gehört, bei welchem Anbieter, Beginn und Ende,
 * und welche bekannten Personen beteiligt sind. `extern_hash` (SHA-256 aus Bereich und Nachrichten- oder Termin-ID) ist eindeutig:
 * Dieselbe Nachricht entsteht nie zweimal, auch wenn mehrere Personen sie im Postfach haben. Adressen unbekannter Kontakte stehen hier nie
 * (Vorschläge aus Postfach und Kalender stehen getrennt in `kontakt_vorschlag`).
 */
export const aktivitaetSync = pgTable(
  "aktivitaet_sync",
  {
    aktivitaetId: uuid("aktivitaet_id").primaryKey().references(() => aktivitaet.id, { onDelete: "cascade" }),
    benutzerId: uuid("benutzer_id").notNull().references(() => benutzer.id),
    anbieter: postfachAnbieter("anbieter").notNull(),
    externHash: text("extern_hash").notNull(),
    /** ID der Nachricht beim Anbieter: Sie braucht nur das Nachladen von Anhängen auf ausdrücklichen Klick (nicht die Message-ID-Kopfzeile). */
    anbieterId: text("anbieter_id"),
    beginn: timestamp("beginn", { withTimezone: true }).notNull(),
    ende: timestamp("ende", { withTimezone: true }),
    /** IDs der bekannten Personen, die beteiligt sind (Teilnehmer eines Termins, Absender und Empfänger einer Mail). */
    personIds: jsonb("person_ids").$type<string[]>().notNull().default([]),
    /** Mail: `eingehend` oder `ausgehend`. */
    richtung: text("richtung"),
    /**
     * Prüfdaten für die Übernahme verwaister Aktivitäten (ohne Klartext): SHA-256 aus Aktivitäts-ID und Adresse (klein geschrieben) des Absenders (Mail) und aller
     * Beteiligten (Absender, Empfänger, Teilnehmer, Organisator). Eine Person übernimmt nur, wenn ihre eigene Adresse dazugehört und der Rest zu den gespeicherten Angaben passt.
     */
    absenderHash: text("absender_hash"),
    teilnehmerHashes: jsonb("teilnehmer_hashes").$type<string[]>().notNull().default([]),
    /** Wann die Aktivität von einer anderen Person übernommen wurde (Besitzerin wechselte); danach löscht eine Absage sie nie, sie wird nur gemeldet. */
    uebernommenAm: timestamp("uebernommen_am", { withTimezone: true }),
    /** Der Anbieter meldet den übernommenen Termin als abgesagt; die Aktivität bleibt bestehen. */
    absageGemeldetAm: timestamp("absage_gemeldet_am", { withTimezone: true }),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    uniqueIndex("aktivitaet_sync_extern_uq").on(t.externHash),
    index("aktivitaet_sync_benutzer_idx").on(t.benutzerId),
    index("aktivitaet_sync_beginn_idx").on(t.beginn),
    check("aktivitaet_sync_richtung", sql`${t.richtung} IS NULL OR ${t.richtung} IN ('eingehend', 'ausgehend')`),
  ],
);

/** Vom Nutzer entfernte synchronisierte Elemente: Der Abgleich holt sie für diese Person nicht erneut. Enthält nur den Hash, keinen Inhalt. */
export const syncAusschluss = pgTable(
  "sync_ausschluss",
  {
    benutzerId: uuid("benutzer_id").notNull().references(() => benutzer.id, { onDelete: "cascade" }),
    externHash: text("extern_hash").notNull(),
    erstelltAm: erstelltAm(),
  },
  (t) => [primaryKey({ columns: [t.benutzerId, t.externHash] })],
);

/**
 * Kontakte aus Postfach und Kalender (Einstellung der Installation, genau eine Zeile `id = 1`). `modus`: `aus` (Standard, der Abgleich verhält sich wie
 * ohne diese Funktion), `vorschlag` (neue Gegenüber landen in der Vorschlagsliste) oder `direkt` (Personen und Unternehmen entstehen sofort).
 * `eigene_domains`: Domains der Installation, deren Adressen intern sind. `sperrliste`: Adressen und Domains, aus denen nie ein Kontakt entsteht.
 */
export const kontaktabgleichEinstellung = pgTable(
  "kontaktabgleich_einstellung",
  {
    id: integer("id").primaryKey().default(1),
    modus: text("modus").notNull().default("aus"),
    eigeneDomains: text("eigene_domains").array().notNull().default(sql`ARRAY[]::text[]`),
    sperrliste: text("sperrliste").array().notNull().default(sql`ARRAY[]::text[]`),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("kontaktabgleich_einstellung_eine_zeile", sql`${t.id} = 1`), check("kontaktabgleich_einstellung_modus", sql`${t.modus} IN ('aus', 'vorschlag', 'direkt')`)],
);

/** Teilnahme einer Person mit ihrem Postfach und Kalender (Standard: nicht dabei) und ihre eigene Sperrliste; nur die Person selbst sieht und ändert sie. */
export const kontaktabgleichTeilnahme = pgTable("kontaktabgleich_teilnahme", {
  benutzerId: uuid("benutzer_id").primaryKey().references(() => benutzer.id, { onDelete: "cascade" }),
  teilnehmen: boolean("teilnehmen").notNull().default(false),
  sperrliste: text("sperrliste").array().notNull().default(sql`ARRAY[]::text[]`),
  geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Vorschlag oder Schlüssel eines Kontakts aus Postfach und Kalender: je normalisierter Mailadresse genau eine Zeile (eindeutig, auch bei gleichzeitigen Abgleichen
 * mehrerer Postfächer). `offen`: wartet in der Vorschlagsliste; `uebernommen`: als Person angelegt; `zusammengefuehrt`: einer vorhandenen Person zugeordnet. Verworfen wird
 * je Quelle (`kontakt_vorschlag_quelle.verworfen`). Gespeichert sind nur Adresse und Name aus dem Absender- oder Teilnehmerfeld, nie Betreff, Inhalt oder Anzahl der Mails.
 */
export const kontaktVorschlag = pgTable(
  "kontakt_vorschlag",
  {
    id: id(),
    adresse: text("adresse").notNull(),
    name: text("name"),
    status: text("status").notNull().default("offen"),
    personId: uuid("person_id").references(() => person.id, { onDelete: "set null" }),
    entschiedenVon: uuid("entschieden_von").references(() => benutzer.id, { onDelete: "set null" }),
    entschiedenAm: timestamp("entschieden_am", { withTimezone: true }),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    uniqueIndex("kontakt_vorschlag_adresse_uq").on(t.adresse),
    index("kontakt_vorschlag_status_idx").on(t.status),
    check("kontakt_vorschlag_status", sql`${t.status} IN ('offen', 'uebernommen', 'zusammengefuehrt')`),
    check("kontakt_vorschlag_adresse_klein", sql`${t.adresse} = lower(${t.adresse})`),
  ],
);

/**
 * Aus wessen Postfach (Bereich `mail`) oder Kalender ein Vorschlag stammt. Hängt an Person und Bereich, nicht an der Verbindung (die beim erneuten Anmelden ersetzt wird).
 * Trennen entfernt die offenen Quellen dieser Person; ein offener Vorschlag ohne Quelle entfällt. `verworfen`: Die Person hat ihn dauerhaft verworfen.
 */
export const kontaktVorschlagQuelle = pgTable(
  "kontakt_vorschlag_quelle",
  {
    vorschlagId: uuid("vorschlag_id").notNull().references(() => kontaktVorschlag.id, { onDelete: "cascade" }),
    benutzerId: uuid("benutzer_id").notNull().references(() => benutzer.id, { onDelete: "cascade" }),
    bereich: postfachBereich("bereich").notNull(),
    verworfen: boolean("verworfen").notNull().default(false),
    erstelltAm: erstelltAm(),
  },
  (t) => [primaryKey({ columns: [t.vorschlagId, t.benutzerId, t.bereich] }), index("kontakt_vorschlag_quelle_benutzer_idx").on(t.benutzerId)],
);

/** Je Domain höchstens ein Unternehmen, das aus Postfach oder Kalender entstanden ist (eindeutig, auch bei gleichzeitigen Abgleichen). */
export const kontaktDomain = pgTable(
  "kontakt_domain",
  {
    domain: text("domain").primaryKey(),
    organisationId: uuid("organisation_id").notNull().references(() => organisation.id, { onDelete: "cascade" }),
    erstelltAm: erstelltAm(),
  },
  (t) => [check("kontakt_domain_klein", sql`${t.domain} = lower(${t.domain})`)],
);

/**
 * Herkunft eines Kontakts, der aus Postfach oder Kalender entstanden ist: aus wessen Postfach, in welchem Bereich, wann. Nennt keine Mails und keine Termine.
 * Genau eine von Person und Organisation ist gesetzt.
 */
export const kontaktHerkunft = pgTable(
  "kontakt_herkunft",
  {
    id: id(),
    personId: uuid("person_id").references(() => person.id, { onDelete: "cascade" }),
    organisationId: uuid("organisation_id").references(() => organisation.id, { onDelete: "cascade" }),
    benutzerId: uuid("benutzer_id").references(() => benutzer.id, { onDelete: "set null" }),
    bereich: postfachBereich("bereich").notNull(),
    angelegtAm: timestamp("angelegt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("kontakt_herkunft_person_uq").on(t.personId),
    uniqueIndex("kontakt_herkunft_organisation_uq").on(t.organisationId),
    check("kontakt_herkunft_ziel", sql`(${t.personId} IS NULL) <> (${t.organisationId} IS NULL)`),
  ],
);

/** Einstellung der KI-Ergänzung von Kontakten je Installation (eine Zeile): Signaturen aus Mails und Website von Unternehmen auslesen; Standard aus. */
export const kontaktKiEinstellung = pgTable(
  "kontakt_ki_einstellung",
  {
    id: integer("id").primaryKey().default(1),
    signaturen: boolean("signaturen").notNull().default(false),
    website: boolean("website").notNull().default(false),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("kontakt_ki_einstellung_eine_zeile", sql`${t.id} = 1`)],
);

/** Ob die Person ihr eigenes Postfach für die Auslesung von Signaturen freigibt (Standard: nein); nur die Person selbst sieht und ändert es. */
export const kontaktKiTeilnahme = pgTable("kontakt_ki_teilnahme", {
  benutzerId: uuid("benutzer_id").primaryKey().references(() => benutzer.id, { onDelete: "cascade" }),
  signaturen: boolean("signaturen").notNull().default(false),
  geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Vorschlag der KI für ein Feld einer Person oder Organisation, mit Quelle: `signatur` (Mail vom `quelle_datum`) oder `website` (`quelle_url`, abgerufen am `erstellt_am`).
 * Er schreibt nichts: Erst die Übernahme durch eine Person setzt den Wert. `bisher` ist der Wert zur Zeit des Vorschlags (Hinweis auf eine Änderung). Je Objekt und Feld gibt es
 * höchstens einen offenen Vorschlag (der jüngere nach `quelle_datum` gewinnt); ein verworfener Wert kommt nicht wieder. Das Zitat ist der gelesene Textausschnitt, nie die ganze Mail.
 */
export const kontaktKiVorschlag = pgTable(
  "kontakt_ki_vorschlag",
  {
    id: id(),
    personId: uuid("person_id").references(() => person.id, { onDelete: "cascade" }),
    organisationId: uuid("organisation_id").references(() => organisation.id, { onDelete: "cascade" }),
    feld: text("feld").notNull(),
    wert: text("wert").notNull(),
    bisher: text("bisher"),
    quelle: text("quelle").notNull(),
    quelleDatum: timestamp("quelle_datum", { withTimezone: true }).notNull(),
    quelleUrl: text("quelle_url"),
    zitat: text("zitat").notNull(),
    benutzerId: uuid("benutzer_id").references(() => benutzer.id, { onDelete: "set null" }),
    anbieter: text("anbieter"),
    status: text("status").notNull().default("offen"),
    entschiedenVon: uuid("entschieden_von").references(() => benutzer.id, { onDelete: "set null" }),
    entschiedenAm: timestamp("entschieden_am", { withTimezone: true }),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    check("kontakt_ki_vorschlag_ziel", sql`(${t.personId} IS NULL) <> (${t.organisationId} IS NULL)`),
    check("kontakt_ki_vorschlag_status", sql`${t.status} IN ('offen', 'uebernommen', 'verworfen')`),
    check("kontakt_ki_vorschlag_quelle", sql`${t.quelle} IN ('signatur', 'website')`),
    uniqueIndex("kontakt_ki_vorschlag_person_offen_uq").on(t.personId, t.feld).where(sql`${t.status} = 'offen' AND ${t.personId} IS NOT NULL`),
    uniqueIndex("kontakt_ki_vorschlag_organisation_offen_uq").on(t.organisationId, t.feld).where(sql`${t.status} = 'offen' AND ${t.organisationId} IS NOT NULL`),
    index("kontakt_ki_vorschlag_person_idx").on(t.personId),
    index("kontakt_ki_vorschlag_organisation_idx").on(t.organisationId),
  ],
);

/** Link für das Kalenderabonnement (ICS) einer Person: wie die Links der Kennzahlen-Abfrage nur als Hash gespeichert, widerrufbar. */
export const kalenderToken = pgTable(
  "kalender_token",
  {
    id: id(),
    benutzerId: uuid("benutzer_id").notNull().references(() => benutzer.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    erstelltAm: erstelltAm(),
    widerrufenAm: timestamp("widerrufen_am", { withTimezone: true }),
    letzterZugriffAm: timestamp("letzter_zugriff_am", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("kalender_token_hash_uq").on(t.tokenHash),
    uniqueIndex("kalender_token_aktiv_uq").on(t.benutzerId).where(sql`${t.widerrufenAm} IS NULL`),
  ],
);

// Handelsregister (Etappe 18) -------------------------------------------------------------------------------------

export const registerArt = pgEnum("register_art", ["HRA", "HRB", "GnR", "PR", "VR"]);
export const registerEreignisArt = pgEnum("register_ereignis_art", [
  "neueintragung",
  "aenderung_geschaeftsfuehrung",
  "kapitalerhoehung",
  "sitzverlegung",
  "insolvenz",
  "loeschung",
  "sonstiges",
]);

/** Quelle eines Registereintrags oder -ereignisses: `manuell`, `dokument`, `import` oder `anbieter:<name>`. */
const registerQuellePruefung = (spalte: AnyPgColumn) => sql`${spalte} ~ '^(manuell|dokument|import|anbieter:[a-z0-9_-]{1,40})$'`;

/**
 * Registerstand eines Unternehmens zu einem Stand-Datum. Jede Änderung ist eine neue Zeile, nichts wird überschrieben oder gelöscht
 * (Trigger); der aktuelle Eintrag ist die Zeile mit dem jüngsten Stand-Datum (bei Gleichstand die zuletzt erfasste).
 * `vertretung` und `prokura` sind Listen aus `{ name, funktion, art? }`.
 */
export const registereintrag = pgTable(
  "registereintrag",
  {
    id: id(),
    organisationId: uuid("organisation_id").notNull().references(() => organisation.id),
    gericht: text("gericht").notNull(),
    registerart: registerArt("registerart").notNull(),
    nummer: text("nummer").notNull(),
    firma: text("firma").notNull(),
    rechtsform: text("rechtsform"),
    sitz: text("sitz"),
    anschrift: text("anschrift"),
    gegenstand: text("gegenstand"),
    kapital: betrag("kapital"),
    kapitalWaehrung: text("kapital_waehrung").notNull().default("EUR"),
    vertretung: jsonb("vertretung").notNull().default(sql`'[]'::jsonb`),
    prokura: jsonb("prokura").notNull().default(sql`'[]'::jsonb`),
    standDatum: date("stand_datum").notNull(),
    quelle: text("quelle").notNull(),
    /** Registerauszug als Dokument (Etappe 13), optional. */
    dokumentId: uuid("dokument_id").references(() => dokument.id),
    erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
    erfasstVon: text("erfasst_von").notNull().default("system"),
  },
  (t) => [
    index("registereintrag_organisation_idx").on(t.organisationId, t.standDatum, t.erfasstAm),
    check("registereintrag_quelle", registerQuellePruefung(t.quelle)),
  ],
);

/**
 * Bekanntmachung oder Ereignis aus dem Register. Unveränderlich bis auf die Erledigung (`erledigt_*`, Trigger). `externe_id` verhindert
 * Doppel beim wiederholten Abruf desselben Anbieters.
 */
export const registerEreignis = pgTable(
  "register_ereignis",
  {
    id: id(),
    organisationId: uuid("organisation_id").notNull().references(() => organisation.id),
    registereintragId: uuid("registereintrag_id").references(() => registereintrag.id),
    datum: date("datum").notNull(),
    art: registerEreignisArt("art").notNull(),
    text: text("text").notNull(),
    quelle: text("quelle").notNull(),
    externeId: text("externe_id"),
    erledigtAm: timestamp("erledigt_am", { withTimezone: true }),
    erledigtVon: text("erledigt_von"),
    erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("register_ereignis_organisation_idx").on(t.organisationId, t.datum),
    uniqueIndex("register_ereignis_extern_uq").on(t.organisationId, t.quelle, t.externeId).where(sql`${t.externeId} IS NOT NULL`),
    check("register_ereignis_quelle", registerQuellePruefung(t.quelle)),
  ],
);

/** Beobachtung eines Unternehmens: Der Worker fragt den Anbieter regelmäßig ab (die Abfrage selbst ist standardmäßig aus, siehe Konfiguration). */
export const registerBeobachtung = pgTable("register_beobachtung", {
  organisationId: uuid("organisation_id").primaryKey().references(() => organisation.id),
  aktiv: boolean("aktiv").notNull().default(false),
  geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
  geaendertVon: text("geaendert_von").notNull().default("system"),
  letztePruefungAm: timestamp("letzte_pruefung_am", { withTimezone: true }),
  letztesErgebnis: text("letztes_ergebnis"),
});

/** Meldungen in der Oberfläche zu neuen Registerereignissen und geänderten Registerdaten (Liste in der App). */
export const registerMeldung = pgTable(
  "register_meldung",
  {
    id: id(),
    organisationId: uuid("organisation_id").notNull().references(() => organisation.id),
    ereignisId: uuid("ereignis_id").references(() => registerEreignis.id),
    art: text("art").notNull(),
    text: text("text").notNull(),
    erstelltAm: erstelltAm(),
    gelesenAm: timestamp("gelesen_am", { withTimezone: true }),
    gelesenVon: text("gelesen_von"),
  },
  (t) => [index("register_meldung_organisation_idx").on(t.organisationId, t.erstelltAm), check("register_meldung_art", sql`${t.art} IN ('ereignis', 'eintrag')`)],
);

// Szenarien und Reserven (Etappe 18) ------------------------------------------------------------------------------

export const szenarioStatus = pgEnum("szenario_status", ["entwurf", "festgeschrieben"]);

/**
 * Szenario eines Fonds: Annahmen (JSON, von der API gegen ein Zod-Schema geprüft) zu einem Basistag. Ein Entwurf wird bei jeder
 * Ansicht neu gerechnet. Festschreiben hält Eingaben und Ergebnis fest (`ergebnis`, `ergebnis_hash` = SHA-256 über Annahmen,
 * Basistag, Wissensstand und Ergebnis); danach ist die Zeile unveränderlich (Trigger).
 */
export const szenario = pgTable(
  "szenario",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    name: text("name").notNull(),
    basisStichtag: date("basis_stichtag").notNull(),
    status: szenarioStatus("status").notNull().default("entwurf"),
    annahmen: jsonb("annahmen").notNull(),
    ergebnis: jsonb("ergebnis"),
    ergebnisHash: text("ergebnis_hash"),
    /** Wissensstand der Eingangsdaten zum Zeitpunkt des Festschreibens. */
    wissensstand: timestamp("wissensstand", { withTimezone: true }),
    erstelltVon: text("erstellt_von").notNull().default("system"),
    erstelltAm: erstelltAm(),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
    festgeschriebenAm: timestamp("festgeschrieben_am", { withTimezone: true }),
    festgeschriebenVon: text("festgeschrieben_von"),
  },
  (t) => [
    uniqueIndex("szenario_fonds_name_uq").on(t.fondsId, t.name),
    index("szenario_fonds_idx").on(t.fondsId, t.erstelltAm),
    check(
      "szenario_festschreibung",
      sql`(${t.status} = 'entwurf' AND ${t.ergebnis} IS NULL AND ${t.ergebnisHash} IS NULL AND ${t.festgeschriebenAm} IS NULL) OR (${t.status} = 'festgeschrieben' AND ${t.ergebnis} IS NOT NULL AND ${t.ergebnisHash} IS NOT NULL AND ${t.festgeschriebenAm} IS NOT NULL AND ${t.wissensstand} IS NOT NULL)`,
    ),
  ],
);

/**
 * Geplante Reserve für Folgeinvestitionen je Beteiligung. Jede Planung ist eine neue Zeile (der Verlauf bleibt), es gilt die jüngste
 * (nach `gueltig_ab`, dann `erfasst_am`). Verbraucht sind die Auszahlungen der Beteiligung ab `gueltig_ab`.
 */
export const reserve = pgTable(
  "reserve",
  {
    id: id(),
    beteiligungId: uuid("beteiligung_id").notNull().references(() => beteiligung.id),
    betrag: betrag("betrag").notNull(),
    gueltigAb: date("gueltig_ab").notNull(),
    bemerkung: text("bemerkung"),
    erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
    erfasstVon: text("erfasst_von").notNull().default("system"),
  },
  (t) => [index("reserve_beteiligung_idx").on(t.beteiligungId, t.gueltigAb, t.erfasstAm), check("reserve_betrag", sql`${t.betrag} >= 0`)],
);

// CRM und Dealflow (Etappe 20) ------------------------------------------------------------------------------------

/** Objekte des CRM, die eigene Felder, Ansichten und Listen haben. */
export const crmObjekt = pgEnum("crm_objekt", ["organisation", "person", "deal"]);

/** Beschäftigung einer Person bei einem Unternehmen (n:m, mit Zeitraum; höchstens eine Hauptzeile je Person). */
export const beschaeftigung = pgTable(
  "beschaeftigung",
  {
    id: id(),
    personId: uuid("person_id").notNull().references(() => person.id),
    organisationId: uuid("organisation_id").notNull().references(() => organisation.id),
    funktion: text("funktion"),
    von: date("von"),
    bis: date("bis"),
    haupt: boolean("haupt").notNull().default(false),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    index("beschaeftigung_person_idx").on(t.personId),
    index("beschaeftigung_organisation_idx").on(t.organisationId),
    uniqueIndex("beschaeftigung_haupt_idx").on(t.personId).where(sql`${t.haupt}`),
    check("beschaeftigung_zeitraum", sql`${t.von} IS NULL OR ${t.bis} IS NULL OR ${t.bis} >= ${t.von}`),
  ],
);

/** Kontakte eines Deals (neben dem Unternehmen). */
export const dealKontakt = pgTable(
  "deal_kontakt",
  {
    dealId: uuid("deal_id").notNull().references(() => deal.id),
    personId: uuid("person_id").notNull().references(() => person.id),
    rolle: text("rolle"),
    erstelltAm: erstelltAm(),
  },
  (t) => [primaryKey({ columns: [t.dealId, t.personId] }), index("deal_kontakt_person_idx").on(t.personId)],
);

export const feldTyp = pgEnum("feld_typ", [
  "text",
  "langtext",
  "zahl",
  "betrag",
  "datum",
  "auswahl",
  "mehrfachauswahl",
  "kontrollkaestchen",
  "url",
  "email",
  "telefon",
  "benutzer",
  "verknuepfung",
]);

/**
 * Objekte, die eigene Felder tragen können (Etappe 21): die des CRM und die des Portfolios. `crm_objekt` bleibt auf die CRM-Objekte
 * beschränkt (Ansichten, Listen, Verknüpfungen). Verknüpfungsfelder zeigen weiterhin nur auf CRM-Objekte.
 */
export const feldObjekt = pgEnum("feld_objekt", ["organisation", "person", "deal", "fonds", "runde", "instrument", "beteiligung", "vorgang"]);

/** Liste von Datensätzen eines Objekts (z. B. „Co-Investoren 2026“) mit eigenen Feldern je Eintrag. */
export const liste = pgTable(
  "liste",
  {
    id: id(),
    name: text("name").notNull(),
    beschreibung: text("beschreibung"),
    objekt: crmObjekt("objekt").notNull(),
    besitzerId: uuid("besitzer_id").references(() => benutzer.id),
    archiviertAm: timestamp("archiviert_am", { withTimezone: true }),
    erstelltAm: erstelltAm(),
  },
  (t) => [uniqueIndex("liste_name_idx").on(sql`lower(${t.name})`).where(sql`${t.archiviertAm} IS NULL`)],
);

export const listeEintrag = pgTable(
  "liste_eintrag",
  {
    id: id(),
    listeId: uuid("liste_id").notNull().references(() => liste.id),
    /** ID des Datensatzes (Organisation, Person oder Deal, je nach Objekt der Liste); ohne Fremdschlüssel, die Anwendung prüft. */
    datensatzId: uuid("datensatz_id").notNull(),
    felder: jsonb("felder").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    erstelltAm: erstelltAm(),
  },
  (t) => [uniqueIndex("liste_eintrag_eindeutig_idx").on(t.listeId, t.datensatzId), index("liste_eintrag_datensatz_idx").on(t.datensatzId)],
);

/**
 * Definition eines eigenen Feldes. Der Typ ist nach dem Anlegen fest; ändern heißt archivieren und neu anlegen. `version` zählt jede Änderung
 * der Definition (Name, Optionen), das Änderungsprotokoll hält die Stände. Mit `listeId` gilt das Feld nur an den Einträgen dieser Liste.
 */
export const feldDefinition = pgTable(
  "feld_definition",
  {
    id: id(),
    objekt: feldObjekt("objekt").notNull(),
    listeId: uuid("liste_id").references(() => liste.id),
    schluessel: text("schluessel").notNull(),
    name: text("name").notNull(),
    typ: feldTyp("typ").notNull(),
    /** Auswahl: `{ optionen: [{ schluessel, label, farbe }] }`; Verknüpfung: `{ ziel }`; Betrag: `{ waehrung }`. */
    optionen: jsonb("optionen").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    position: integer("position").notNull().default(0),
    version: integer("version").notNull().default(1),
    archiviertAm: timestamp("archiviert_am", { withTimezone: true }),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    uniqueIndex("feld_definition_global_idx").on(t.objekt, t.schluessel).where(sql`${t.listeId} IS NULL`),
    uniqueIndex("feld_definition_liste_idx").on(t.listeId, t.schluessel).where(sql`${t.listeId} IS NOT NULL`),
    check("feld_definition_schluessel", sql`${t.schluessel} ~ '^[a-z][a-z0-9_]{0,39}$'`),
  ],
);

export const ansichtArt = pgEnum("ansicht_art", ["tabelle", "kanban"]);

/** Gespeicherte Ansicht (Filter, Sortierung, Spalten, Gruppierung als `konfig`); privat oder geteilt, mit `listeId` für Listen. */
export const ansicht = pgTable(
  "ansicht",
  {
    id: id(),
    objekt: crmObjekt("objekt").notNull(),
    listeId: uuid("liste_id").references(() => liste.id),
    name: text("name").notNull(),
    art: ansichtArt("art").notNull().default("tabelle"),
    konfig: jsonb("konfig").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    besitzerId: uuid("besitzer_id").notNull().references(() => benutzer.id),
    geteilt: boolean("geteilt").notNull().default(false),
    /** Vorgabe der Seite (je Objekt oder Liste höchstens eine, von Verwaltern gesetzt). */
    standard: boolean("standard").notNull().default(false),
    erstelltAm: erstelltAm(),
    aktualisiertAm: timestamp("aktualisiert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ansicht_objekt_idx").on(t.objekt, t.listeId), index("ansicht_besitzer_idx").on(t.besitzerId)],
);

/** Aufgabe mit Fälligkeit und Zuständigkeit an einem Datensatz (ergänzt die Wiedervorlage an Aktivitäten). */
export const aufgabe = pgTable(
  "aufgabe",
  {
    id: id(),
    titel: text("titel").notNull(),
    notiz: text("notiz"),
    faellig: date("faellig"),
    zustaendig: uuid("zustaendig").references(() => benutzer.id),
    erledigtAm: timestamp("erledigt_am", { withTimezone: true }),
    organisationId: uuid("organisation_id").references(() => organisation.id),
    personId: uuid("person_id").references(() => person.id),
    dealId: uuid("deal_id").references(() => deal.id),
    erstelltVon: text("erstellt_von").notNull(),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    index("aufgabe_zustaendig_idx").on(t.zustaendig, t.faellig),
    index("aufgabe_organisation_idx").on(t.organisationId),
    index("aufgabe_person_idx").on(t.personId),
    index("aufgabe_deal_idx").on(t.dealId),
    check("aufgabe_ein_bezug", sql`${t.organisationId} IS NOT NULL OR ${t.personId} IS NOT NULL OR ${t.dealId} IS NOT NULL`),
  ],
);

/** Verknüpfung zwischen Datensätzen: Verknüpfungsfeld (`relation`) oder Erwähnung (`erwaehnung`) in einer Notiz; Grundlage der Rückverweise. */
export const datensatzLink = pgTable(
  "datensatz_link",
  {
    id: id(),
    vonTyp: crmObjekt("von_typ").notNull(),
    vonId: uuid("von_id").notNull(),
    zuTyp: crmObjekt("zu_typ").notNull(),
    zuId: uuid("zu_id").notNull(),
    art: text("art").notNull(),
    /** Aktivität (Erwähnung) oder Felddefinition (Verknüpfungsfeld), aus der die Verknüpfung stammt. */
    quelleId: uuid("quelle_id").notNull(),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    uniqueIndex("datensatz_link_eindeutig_idx").on(t.vonTyp, t.vonId, t.zuTyp, t.zuId, t.art, t.quelleId),
    index("datensatz_link_zu_idx").on(t.zuTyp, t.zuId),
    check("datensatz_link_art", sql`${t.art} IN ('relation', 'erwaehnung')`),
  ],
);

// Währungen (Etappe 21) ---------------------------------------------------------------------------------------------

export const kursQuelle = pgEnum("kurs_quelle", ["manuell", "import"]);

/**
 * Wechselkurs: 1 Einheit `basis` = `kurs` Einheiten `quote` an einem Tag (Stil der EZB-Referenzkurse). Die Tabelle ist nur anhängend (Trigger): Eine
 * Korrektur ist ein neuer Eintrag für denselben Tag und dasselbe Paar mit Verweis auf den korrigierten (`korrigiert_kurs_id`) und Grund; es gilt der jüngste Eintrag
 * je Tag und Paar bis zum jeweiligen Wissensstand. Quelle ist die Eingabe von Hand oder eine Importdatei (`quelle_datei`); es gibt keinen Abruf aus dem Netz.
 */
export const wechselkurs = pgTable(
  "wechselkurs",
  {
    id: id(),
    datum: date("datum").notNull(),
    basis: text("basis").notNull(),
    quote: text("quote").notNull(),
    kurs: numeric("kurs", { precision: 20, scale: 8 }).notNull(),
    quelle: kursQuelle("quelle").notNull(),
    quelleDatei: text("quelle_datei"),
    korrigiertKursId: uuid("korrigiert_kurs_id").references((): AnyPgColumn => wechselkurs.id),
    grund: text("grund"),
    erfasstVon: text("erfasst_von").notNull().default("system"),
    erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("wechselkurs_paar_idx").on(t.basis, t.quote, t.datum, t.erfasstAm),
    index("wechselkurs_erfasst_idx").on(t.erfasstAm),
    check("wechselkurs_codes", sql`${t.basis} ~ '^[A-Z]{3}$' AND ${t.quote} ~ '^[A-Z]{3}$' AND ${t.basis} <> ${t.quote}`),
    check("wechselkurs_positiv", sql`${t.kurs} > 0`),
  ],
);

// Webhooks und Live-Aktualisierung ---------------------------------------------------------------------------------

/**
 * Webhook-Endpunkt (Issue #154): Ziel außerhalb von Carraway, das bei Änderungen eine signierte Nachricht bekommt. Er gehört der Person, die ihn
 * angelegt hat, oder dem API-Schlüssel, mit dem er angelegt wurde (`api_schluessel_id`); zugestellt wird nur, was dieser Zugang zum Zeitpunkt
 * der Zustellung sehen darf. Das Geheimnis der Signatur steht nur verschlüsselt in `geheimnis_verschluesselt` (AAD `webhook:<id>`), nie im
 * Änderungsprotokoll oder im Vollexport. `tabellen` leer = alle Tabellen der Änderungsabfrage.
 */
export const webhook = pgTable(
  "webhook",
  {
    id: id(),
    benutzerId: uuid("benutzer_id").notNull().references(() => benutzer.id, { onDelete: "cascade" }),
    apiSchluesselId: uuid("api_schluessel_id").references(() => apiSchluessel.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    beschreibung: text("beschreibung"),
    tabellen: text("tabellen").array().notNull().default(sql`'{}'::text[]`),
    geheimnisVerschluesselt: text("geheimnis_verschluesselt").notNull(),
    aktiv: boolean("aktiv").notNull().default(true),
    /** Endgültig gescheiterte Zustellungen in Folge; eine erfolgreiche setzt auf 0, ab der Grenze wird der Endpunkt abgeschaltet. */
    fehlerInFolge: integer("fehler_in_folge").notNull().default(0),
    deaktiviertAm: zeitstempel("deaktiviert_am"),
    /** Code: `too_many_failures`, `owner_inactive` oder `manual`. */
    deaktiviertGrund: text("deaktiviert_grund"),
    erstelltAm: erstelltAm(),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhook_benutzer_idx").on(t.benutzerId), index("webhook_aktiv_idx").on(t.aktiv)],
);

/**
 * Ausgangskorb der Webhooks: Ein Trigger auf `aenderung` legt je Zeile (außer Lesezugriffen) einen Eintrag an, solange es einen aktiven
 * Endpunkt gibt; der Worker verteilt ihn auf die Endpunkte und löscht ihn in derselben Transaktion. Wie bei `snapshot_auftrag` geht so keine
 * Änderung verloren, auch wenn eine Transaktion mit älterem Zeitstempel später festgeschrieben wird.
 */
export const webhookAusgang = pgTable("webhook_ausgang", {
  nr: bigint("nr", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  aenderungId: uuid("aenderung_id").notNull(),
  erstelltAm: erstelltAm(),
});

/**
 * Zustellprotokoll: eine Zeile je Ereignis und Endpunkt. Enthält nie Nutzdaten, Kopfzeilen, Signaturen oder Antworttexte, nur Status, Anzahl der
 * Versuche, HTTP-Status, Fehlercode und Dauer. `status`: `pending`, `delivered`, `failed` (alle Versuche gescheitert) oder `skipped` (zum
 * Zeitpunkt der Zustellung nicht mehr sichtbar oder Endpunkt aus). Zeilen älter als 30 Tage löscht der Worker.
 */
export const webhookZustellung = pgTable(
  "webhook_zustellung",
  {
    id: id(),
    webhookId: uuid("webhook_id").notNull().references(() => webhook.id, { onDelete: "cascade" }),
    /** Zeile des Änderungsprotokolls; leer bei einem Testereignis (`art` = `ping`). */
    aenderungId: uuid("aenderung_id"),
    art: text("art").notNull().default("change"),
    status: text("status").notNull().default("pending"),
    versuche: integer("versuche").notNull().default(0),
    letzterVersuchAm: zeitstempel("letzter_versuch_am"),
    httpStatus: integer("http_status"),
    fehler: text("fehler"),
    dauerMs: integer("dauer_ms"),
    erstelltAm: erstelltAm(),
    /** Zeitpunkt, zu dem der Worker die Zustellung an die Warteschlange übergeben hat; leer = noch nicht übergeben (z. B. Testereignis aus der API). */
    eingereihtAm: zeitstempel("eingereiht_am"),
    zugestelltAm: zeitstempel("zugestellt_am"),
  },
  (t) => [
    index("webhook_zustellung_webhook_idx").on(t.webhookId, t.erstelltAm),
    index("webhook_zustellung_offen_idx").on(t.erstelltAm).where(sql`${t.eingereihtAm} IS NULL`),
    index("webhook_zustellung_erstellt_idx").on(t.erstelltAm),
    check("webhook_zustellung_status", sql`${t.status} IN ('pending', 'delivered', 'failed', 'skipped')`),
    check("webhook_zustellung_art", sql`${t.art} IN ('change', 'ping')`),
  ],
);

// Manager-Profil und Dachfonds ---------------------------------------------------------------------------------------

/**
 * Profil des Managers (der Installation), genau eine Zeile (`id = 1`): Name für Übersichten und die Hauswährung (ISO 4217), in der die fondsübergreifenden
 * Summen und die Währungssicht „Hauswährung“ rechnen. Ohne Zeile gilt EUR.
 */
export const managerProfil = pgTable(
  "manager_profil",
  {
    id: integer("id").primaryKey().default(1),
    name: text("name"),
    hauswaehrung: text("hauswaehrung").notNull().default("EUR"),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("manager_profil_eine_zeile", sql`${t.id} = 1`), check("manager_profil_hauswaehrung", sql`${t.hauswaehrung} ~ '^[A-Z]{3}$'`)],
);

/**
 * Beteiligung eines Fonds (Dachfonds) an einem Zielfonds. `zielfonds_id` verweist auf den Zielfonds, wenn er in derselben Installation geführt wird
 * (Durchrechnung der NAV, keine Doppelzählung in fondsübergreifenden Summen); sonst bleibt sie leer. Beträge stehen in der Fondswährung des Dachfonds.
 */
export const zielfondsBeteiligung = pgTable(
  "zielfonds_beteiligung",
  {
    id: id(),
    fondsId: uuid("fonds_id").notNull().references(() => fonds.id),
    name: text("name").notNull(),
    zielfondsId: uuid("zielfonds_id").references(() => fonds.id),
    /** Optional: Verwaltungsgesellschaft oder Vehikel des Zielfonds als Kontakt. */
    organisationId: uuid("organisation_id").references(() => organisation.id),
    /**
     * Nur bei einem Zielfonds derselben Installation: die Organisation, als die der Dachfonds dort als Investor gezeichnet hat. Nur dann stecken Zusage, Abrufe
     * und Ausschüttungen des Anteils auch in den Investorenzahlen des Zielfonds und werden in fondsübergreifenden Summen abgezogen.
     */
    investorOrganisationId: uuid("investor_organisation_id").references(() => organisation.id),
    erstelltAm: erstelltAm(),
  },
  (t) => [
    index("zielfonds_beteiligung_fonds_idx").on(t.fondsId),
    index("zielfonds_beteiligung_ziel_idx").on(t.zielfondsId),
    uniqueIndex("zielfonds_beteiligung_ziel_uq").on(t.fondsId, t.zielfondsId),
    check("zielfonds_beteiligung_nicht_selbst", sql`${t.zielfondsId} IS NULL OR ${t.zielfondsId} <> ${t.fondsId}`),
    check("zielfonds_beteiligung_investor", sql`${t.investorOrganisationId} IS NULL OR ${t.zielfondsId} IS NOT NULL`),
  ],
);

export const zielfondsBewegungArt = pgEnum("zielfonds_bewegung_art", ["zusage", "abruf", "ausschuettung"]);

/**
 * Zusagen, Kapitalabrufe und Ausschüttungen eines Zielfonds an den Dachfonds. Unveränderlich (Trigger); eine Korrektur ist ein Storno mit negiertem Betrag,
 * das auf die stornierte Bewegung verweist.
 */
export const zielfondsBewegung = pgTable(
  "zielfonds_bewegung",
  {
    id: id(),
    beteiligungId: uuid("beteiligung_id").notNull().references(() => zielfondsBeteiligung.id),
    art: zielfondsBewegungArt("art").notNull(),
    valuta: date("valuta").notNull(),
    betrag: betrag("betrag").notNull(),
    bemerkung: text("bemerkung"),
    storniertBewegungId: uuid("storniert_bewegung_id").references((): AnyPgColumn => zielfondsBewegung.id),
    erfasstVon: text("erfasst_von").notNull(),
    erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("zielfonds_bewegung_beteiligung_idx").on(t.beteiligungId, t.valuta),
    uniqueIndex("zielfonds_bewegung_storno_uq").on(t.storniertBewegungId),
    check("zielfonds_bewegung_vorzeichen", sql`(${t.storniertBewegungId} IS NULL AND ${t.betrag} > 0) OR (${t.storniertBewegungId} IS NOT NULL AND ${t.betrag} < 0)`),
  ],
);

/**
 * Meldung eines Zielfonds zu einem Stichtag (Kapitalkontoauszug): NAV des Anteils in Fondswährung des Dachfonds und/oder Anteil am Zielfonds als Bruch.
 * Unveränderlich (Trigger); eine Korrektur ist eine neue Meldung zum selben Stichtag, die zuletzt erfasste gilt (je Feld die jüngste mit Wert).
 */
export const zielfondsMeldung = pgTable(
  "zielfonds_meldung",
  {
    id: id(),
    beteiligungId: uuid("beteiligung_id").notNull().references(() => zielfondsBeteiligung.id),
    stichtag: date("stichtag").notNull(),
    nav: betrag("nav"),
    anteil: numeric("anteil", { precision: 12, scale: 10 }),
    bemerkung: text("bemerkung"),
    erfasstVon: text("erfasst_von").notNull(),
    erfasstAm: timestamp("erfasst_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("zielfonds_meldung_beteiligung_idx").on(t.beteiligungId, t.stichtag),
    check("zielfonds_meldung_inhalt", sql`${t.nav} IS NOT NULL OR ${t.anteil} IS NOT NULL`),
    check("zielfonds_meldung_anteil", sql`${t.anteil} IS NULL OR (${t.anteil} > 0 AND ${t.anteil} <= 1)`),
  ],
);
