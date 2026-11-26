import { infiniteQueryOptions, keepPreviousData, queryOptions } from "@tanstack/react-query";
import { api, auspacken } from "./client";
import { ladeFonds, ladeUebersicht, ladeWiedervorlagenAnzahl, schluessel } from "./abfragen-kern";

export { STALE_ZEIT, schluessel, fondsListe, fondsUebersicht, wiedervorlagenAnzahl } from "./abfragen-kern";


const ladeBeteiligung = (id: string, stichtag?: string, stand?: string) =>
  auspacken(api.api.v1.beteiligungen[":id"].$get({ param: { id }, query: { ...(stichtag ? { stichtag } : {}), ...(stand ? { stand } : {}) } }));
const ladeDeals = async () => (await auspacken(api.api.v1.deals.$get({ query: {} }))).daten;
const ladeDeal = (id: string) => auspacken(api.api.v1.deals[":id"].$get({ param: { id } }));
const ladeOrganisation = (id: string) => auspacken(api.api.v1.organisationen[":id"].$get({ param: { id } }));
const ladeOrganisationen = (query: { suche?: string; art?: OrganisationArt; cursor?: string; limit?: string }) => auspacken(api.api.v1.organisationen.$get({ query }));
const ladeDubletten = async (name: string) => (await auspacken(api.api.v1.organisationen.dubletten.$get({ query: { name } }))).daten;
const ladeAktivitaeten = async (organisationId: string) => (await auspacken(api.api.v1.aktivitaeten.$get({ query: { organisationId } }))).daten;
const ladePersonAktivitaeten = async (personId: string) => (await auspacken(api.api.v1.aktivitaeten.$get({ query: { personId } }))).daten;
const ladeWiedervorlagen = async () => (await auspacken(api.api.v1.wiedervorlagen.$get({ query: {} }))).daten;
const ladeTrichter = (filter: TrichterFilter) =>
  auspacken(api.api.v1.dealflow.trichter.$get({ query: { ...(filter.von ? { von: filter.von } : {}), ...(filter.bis ? { bis: filter.bis } : {}), ...(filter.fondsId ? { fondsId: filter.fondsId } : {}) } }));

const ladePerson = (id: string) => auspacken(api.api.v1.personen[":id"].$get({ param: { id } }));
const ladePersonenDubletten = async (q: { vorname: string; nachname: string; email?: string | undefined; ausser?: string | undefined }) =>
  (await auspacken(api.api.v1.personen.dubletten.$get({ query: { vorname: q.vorname, nachname: q.nachname, ...(q.email ? { email: q.email } : {}), ...(q.ausser ? { ausser: q.ausser } : {}) } }))).daten;
const ladeWiedervorlagenListe = async (f: WiedervorlagenFilter) =>
  (await auspacken(api.api.v1.wiedervorlagen.$get({ query: { zustaendig: f.zustaendig, ...(f.bis ? { bis: f.bis } : {}) } }))).daten;
const ladeBeschlussvorlagen = (fondsId?: string) => auspacken(api.api.v1.beschlussvorlagen.$get({ query: fondsId ? { fondsId } : {} }));
const ladeSuche = (q: string) => auspacken(api.api.v1.suche.$get({ query: { q, limit: "6" } }));

const ladeInstrumentdaten = (id: string) => auspacken(api.api.v1.beteiligungen[":id"].instrumentdaten.$get({ param: { id } }));
const ladeBeteiligungZinsen = (id: string, stichtag?: string, stand?: string) =>
  auspacken(api.api.v1.beteiligungen[":id"].zinsen.$get({ param: { id }, query: { ...(stichtag ? { stichtag } : {}), ...(stand ? { stand } : {}) } }));
const ladeZinslaeufe = async (fondsId: string) => (await auspacken(api.api.v1.zinslaeufe.$get({ query: { fondsId } }))).daten;
const ladeZinslauf = (id: string) => auspacken(api.api.v1.zinslaeufe[":id"].$get({ param: { id } }));
const ladeKontrolle = (id: string) => auspacken(api.api.v1.zinslaeufe[":id"].kontrolle.$get({ param: { id } }));
const ladeAbgrenzung = (fondsId: string, stichtag: string) => auspacken(api.api.v1.fonds[":id"].abgrenzung.$get({ param: { id: fondsId }, query: { stichtag } }));

type BewertungsAuswahl = { bewertungId?: string; stichtag?: string; stand?: string };
const ladeBewertungen = async (beteiligungId: string, query: BewertungsAuswahl = {}) => (await auspacken(api.api.v1.beteiligungen[":id"].bewertungen.$get({ param: { id: beteiligungId }, query }))).daten;
const ladeBewegungen = async (fondsId: string) => (await auspacken(api.api.v1.fonds[":id"].bewegungen.$get({ param: { id: fondsId } }))).daten;
const ladeRundenListe = async (fondsId: string) => (await auspacken(api.api.v1.fonds[":id"].bewertungsrunden.$get({ param: { id: fondsId } }))).daten;
const ladeRunde = (id: string) => auspacken(api.api.v1.bewertungsrunden[":id"].$get({ param: { id } }));
const ladeBerichte = async (fondsId: string) => (await auspacken(api.api.v1.berichte.$get({ query: { fondsId } }))).daten;
const ladeBericht = (id: string) => auspacken(api.api.v1.berichte[":id"].$get({ param: { id } }));
const ladeBerichtKontrolle = (id: string) => auspacken(api.api.v1.berichte[":id"].kontrolle.$get({ param: { id } }));
const ladeVorlagen = async (fondsId: string) => (await auspacken(api.api.v1.fonds[":id"].berichtsvorlagen.$get({ param: { id: fondsId } }))).daten;
const ladeStufen = async (fondsId: string) => (await auspacken(api.api.v1.fonds[":id"].freigabestufen.$get({ param: { id: fondsId } }))).stufen;
export interface WiedervorlagenFilter {
  zustaendig: "ich" | "alle";
  bis?: string | undefined;
}

const ladeKapitaltabelle = (id: string, stichtag?: string, offeneWandlungen = false) =>
  auspacken(api.api.v1.beteiligungen[":id"].kapitaltabelle.$get({ param: { id }, query: { ...(stichtag ? { stichtag } : {}), ...(offeneWandlungen ? { offeneWandlungen: "true" as const } : {}) } }));
const ladeMitarbeiterpools = async (organisationId: string, stichtag?: string) =>
  (await auspacken(api.api.v1.organisationen[":id"].mitarbeiterpools.$get({ param: { id: organisationId }, query: stichtag ? { stichtag } : {} }))).daten;
const ladeAnteilsklassen = async (organisationId: string) => (await auspacken(api.api.v1.organisationen[":id"].anteilsklassen.$get({ param: { id: organisationId } }))).daten;
const ladeKurve = (id: string, bis: string, punkte: number, exitdatum: string) =>
  auspacken(api.api.v1.beteiligungen[":id"].wasserfall.kurve.$get({ param: { id }, query: { bis, punkte: String(punkte), exitdatum } }));

const ladeVehikelAuswahl = async (suche: string) => (await auspacken(api.api.v1.vehikel.$get({ query: suche ? { suche } : {} }))).daten;
const ladeVehikelDesInvestors = async (organisationId: string) => (await auspacken(api.api.v1.organisationen[":id"].vehikel.$get({ param: { id: organisationId } }))).daten;
const ladeFinanzierungsrunden = async (organisationId: string) => (await auspacken(api.api.v1.organisationen[":id"].finanzierungsrunden.$get({ param: { id: organisationId } }))).daten;
const ladeJournalSeite = (fondsId: string, f: JournalFilter, cursor: string) =>
  auspacken(
    api.api.v1.fonds[":id"].journal.$get({
      param: { id: fondsId },
      query: {
        limit: "100",
        ...(cursor ? { cursor } : {}),
        ...(f.von ? { von: f.von } : {}),
        ...(f.bis ? { bis: f.bis } : {}),
        ...(f.typ ? { typ: f.typ } : {}),
        ...(f.beteiligungId ? { beteiligungId: f.beteiligungId } : {}),
        ...(f.bewertungen ? { bewertungen: "1" as const } : {}),
        ...(f.stand ? { stand: f.stand } : {}),
      },
    }),
  );
const ladeRundentransaktionen = (organisationId: string) => auspacken(api.api.v1.organisationen[":id"].rundentransaktionen.$get({ param: { id: organisationId } }));
const ladeRundenVorschau = (organisationId: string, json: Parameters<(typeof api.api.v1.organisationen)[":id"]["finanzierungsrunden"]["vorschau"]["$post"]>[0]["json"]) =>
  auspacken(api.api.v1.organisationen[":id"].finanzierungsrunden.vorschau.$post({ param: { id: organisationId }, json }));
const ladePoolVorschlag = (organisationId: string, json: Parameters<(typeof api.api.v1.organisationen)[":id"]["finanzierungsrunden"]["pool-vorschlag"]["$post"]>[0]["json"]) =>
  auspacken(api.api.v1.organisationen[":id"].finanzierungsrunden["pool-vorschlag"].$post({ param: { id: organisationId }, json }));

export interface JournalFilter {
  von?: string | undefined;
  bis?: string | undefined;
  /** Kommagetrennte Typen. */
  typ?: string | undefined;
  beteiligungId?: string | undefined;
  bewertungen?: boolean | undefined;
  stand?: string | undefined;
}

export type OrganisationArt = "unternehmen" | "investor" | "berater" | "sonstige";
export interface TrichterFilter {
  von?: string | undefined;
  bis?: string | undefined;
  fondsId?: string | undefined;
}

export type FondsEintrag = Awaited<ReturnType<typeof ladeFonds>>[number];
export type Uebersicht = Awaited<ReturnType<typeof ladeUebersicht>>;
export type BeteiligungZeile = Uebersicht["beteiligungen"][number];
export type BeteiligungDetail = Awaited<ReturnType<typeof ladeBeteiligung>>;
export type Deal = Awaited<ReturnType<typeof ladeDeals>>[number];
export type DealDetail = Awaited<ReturnType<typeof ladeDeal>>;
export type Organisation = Awaited<ReturnType<typeof ladeOrganisation>>;
export type OrganisationSeite = Awaited<ReturnType<typeof ladeOrganisationen>>;
export type OrganisationZeile = OrganisationSeite["daten"][number];
export type Dublette = Awaited<ReturnType<typeof ladeDubletten>>[number];
export type Aktivitaet = Awaited<ReturnType<typeof ladeAktivitaeten>>[number];
export type Wiedervorlage = Awaited<ReturnType<typeof ladeWiedervorlagen>>[number];
export type Trichter = Awaited<ReturnType<typeof ladeTrichter>>;
export type PersonDetail = Awaited<ReturnType<typeof ladePerson>>;
export type PersonenKandidat = Awaited<ReturnType<typeof ladePersonenDubletten>>[number];
export type WiedervorlageZeile = Awaited<ReturnType<typeof ladeWiedervorlagenListe>>[number];
export type WiedervorlagenAnzahl = Awaited<ReturnType<typeof ladeWiedervorlagenAnzahl>>;
export type Beschlussvorlagen = Awaited<ReturnType<typeof ladeBeschlussvorlagen>>;
export type Beschlussvorlage = Beschlussvorlagen["daten"][number];
export type Suchergebnis = Awaited<ReturnType<typeof ladeSuche>>;
export type Instrumentdaten = Awaited<ReturnType<typeof ladeInstrumentdaten>>;
export type BeteiligungZinsen = Awaited<ReturnType<typeof ladeBeteiligungZinsen>>;
export type ZinslaufZeile = Awaited<ReturnType<typeof ladeZinslaeufe>>[number];
export type Zinslauf = Awaited<ReturnType<typeof ladeZinslauf>>;
export type Kontrollbericht = Awaited<ReturnType<typeof ladeKontrolle>>;
export type Abgrenzung = Awaited<ReturnType<typeof ladeAbgrenzung>>;
export type BewertungZeile = Awaited<ReturnType<typeof ladeBewertungen>>[number];
export type RundeZeile = Awaited<ReturnType<typeof ladeRundenListe>>[number];
export type RundeDetail = Awaited<ReturnType<typeof ladeRunde>>;
export type BerichtZeile = Awaited<ReturnType<typeof ladeBerichte>>[number];
export type BerichtDetail = Awaited<ReturnType<typeof ladeBericht>>;
export type BerichtKontrolle = Awaited<ReturnType<typeof ladeBerichtKontrolle>>;
export type Vorlage = Awaited<ReturnType<typeof ladeVorlagen>>[number];
export type Kapitaltabelle = Awaited<ReturnType<typeof ladeKapitaltabelle>>;
export type KapitalZeile = Kapitaltabelle["zeilen"][number];
export type Anteilsklasse = Awaited<ReturnType<typeof ladeAnteilsklassen>>[number];
export type Mitarbeiterpool = Awaited<ReturnType<typeof ladeMitarbeiterpools>>[number];
export type Mitarbeiterzuteilung = Mitarbeiterpool["zuteilungen"][number];
export type Kurve = Awaited<ReturnType<typeof ladeKurve>>;
export type Finanzierungsrunde = Awaited<ReturnType<typeof ladeFinanzierungsrunden>>[number];
export type RundenPosition = Finanzierungsrunde["positionen"][number];
export type Rundentransaktionen = Awaited<ReturnType<typeof ladeRundentransaktionen>>;
export type RundenTransaktion = Rundentransaktionen["ohneRunde"][number];
export type JournalSeite = Awaited<ReturnType<typeof ladeJournalSeite>>;
export type JournalZeile = JournalSeite["daten"][number];
export type RundenVorschau = Awaited<ReturnType<typeof ladeRundenVorschau>>;
export type RundenVorschauEingabe = Parameters<typeof ladeRundenVorschau>[1];
export type PoolVorschlag = Awaited<ReturnType<typeof ladePoolVorschlag>>;
export type PoolVorschlagEingabe = Parameters<typeof ladePoolVorschlag>[1];


/** Kapitalabrufe und Ausschüttungen des Fonds mit dem Stand der Mitteilungen an die Investoren (neueste zuerst). */
export const fondsBewegungen = (fondsId: string) => queryOptions({ queryKey: [...schluessel.bewegungen, fondsId], queryFn: () => ladeBewegungen(fondsId) });
export type BewegungZeile = Awaited<ReturnType<typeof ladeBewegungen>>[number];
export const beteiligungDetail = (id: string, stichtag?: string, stand?: string) =>
  queryOptions({ queryKey: [...schluessel.beteiligungen, "detail", id, stichtag ?? null, stand ?? null], queryFn: () => ladeBeteiligung(id, stichtag, stand) });
export const dealListe = () => queryOptions({ queryKey: schluessel.dealListe, queryFn: ladeDeals });
export const dealDetail = (id: string) => queryOptions({ queryKey: schluessel.dealDetail(id), queryFn: () => ladeDeal(id) });
export const organisationDetail = (id: string) => queryOptions({ queryKey: schluessel.organisationDetail(id), queryFn: () => ladeOrganisation(id) });

/** Organisationen mit serverseitiger Suche und Cursor-Seiten („mehr laden“). */
export const organisationListe = (suche: string, art?: OrganisationArt) =>
  infiniteQueryOptions({
    queryKey: [...schluessel.organisationListe, "seiten", { suche, art: art ?? null }],
    queryFn: ({ pageParam }) => ladeOrganisationen({ ...(suche ? { suche } : {}), ...(art ? { art } : {}), ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: "",
    getNextPageParam: (letzte) => letzte.naechsterCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

/** Kurze Trefferliste zur Auswahl einer bestehenden Organisation. */
export const organisationSuche = (suche: string) =>
  queryOptions({
    queryKey: [...schluessel.organisationListe, "suche", suche],
    queryFn: async () => (await ladeOrganisationen({ ...(suche ? { suche } : {}), limit: "8" })).daten,
    placeholderData: keepPreviousData,
  });

export const dublettenSuche = (name: string) => queryOptions({ queryKey: ["organisationen", "dubletten", name], queryFn: () => ladeDubletten(name), staleTime: 0 });
export const organisationAktivitaeten = (organisationId: string) =>
  queryOptions({ queryKey: [...schluessel.aktivitaeten, "organisation", organisationId], queryFn: () => ladeAktivitaeten(organisationId) });
export const personAktivitaeten = (personId: string) => queryOptions({ queryKey: [...schluessel.aktivitaeten, "person", personId], queryFn: () => ladePersonAktivitaeten(personId) });
export const wiedervorlagen = () => queryOptions({ queryKey: schluessel.wiedervorlagen, queryFn: ladeWiedervorlagen });
export const personDetail = (id: string) => queryOptions({ queryKey: [...schluessel.personen, "detail", id], queryFn: () => ladePerson(id) });
export const personenDubletten = (q: { vorname: string; nachname: string; email?: string; ausser?: string }) =>
  queryOptions({ queryKey: [...schluessel.personen, "dubletten", q], queryFn: () => ladePersonenDubletten(q), staleTime: 0 });
export const wiedervorlagenListe = (f: WiedervorlagenFilter) =>
  queryOptions({ queryKey: [...schluessel.wiedervorlagen, "liste", { zustaendig: f.zustaendig, bis: f.bis ?? null }], queryFn: () => ladeWiedervorlagenListe(f) });
export const beschlussvorlagen = (fondsId?: string) =>
  queryOptions({ queryKey: [...schluessel.beschlussvorlagen, fondsId ?? null], queryFn: () => ladeBeschlussvorlagen(fondsId) });
export const suche = (q: string) => queryOptions({ queryKey: ["suche", q], queryFn: () => ladeSuche(q), staleTime: 10_000 });
export const trichter = (filter: TrichterFilter) =>
  queryOptions({
    queryKey: [...schluessel.trichter, { von: filter.von ?? null, bis: filter.bis ?? null, fondsId: filter.fondsId ?? null }],
    queryFn: () => ladeTrichter(filter),
    placeholderData: keepPreviousData,
  });

/** Alles Instrumentspezifische einer Beteiligung (aktueller Stand, unabhängig von Stichtag und Wissensstand). */
export const instrumentdaten = (id: string) => queryOptions({ queryKey: [...schluessel.beteiligungen, "instrument", id], queryFn: () => ladeInstrumentdaten(id) });
/** Zinsen der Beteiligung je darlehensartigem Instrument zu Stichtag und Wissensstand (unter `beteiligungen`: jede Buchung entwertet sie). */
export const beteiligungZinsen = (id: string, stichtag?: string, stand?: string) =>
  queryOptions({ queryKey: [...schluessel.beteiligungen, "zinsen", id, stichtag ?? null, stand ?? null], queryFn: () => ladeBeteiligungZinsen(id, stichtag, stand) });
export const zinslaufListe = (fondsId: string) => queryOptions({ queryKey: [...schluessel.zinslaeufe, "liste", fondsId], queryFn: () => ladeZinslaeufe(fondsId) });
export const zinslaufDetail = (id: string) => queryOptions({ queryKey: schluessel.zinslaufDetail(id), queryFn: () => ladeZinslauf(id) });
export const zinslaufKontrolle = (id: string) => queryOptions({ queryKey: [...schluessel.zinslaeufe, "kontrolle", id], queryFn: () => ladeKontrolle(id) });
/** Abgrenzung unter `fonds`, damit jede Änderung am Fonds oder seinen Beteiligungen sie entwertet. */
export const fondsAbgrenzung = (fondsId: string, stichtag: string) =>
  queryOptions({ queryKey: [...schluessel.fonds, fondsId, "abgrenzung", stichtag], queryFn: () => ladeAbgrenzung(fondsId, stichtag) });

/** Alle Bewertungen einer Beteiligung mit Status und Historie (auch Entwürfe und ersetzte). */
export const beteiligungBewertungen = (beteiligungId: string, auswahl?: BewertungsAuswahl) => queryOptions({ queryKey: [...schluessel.bewertungen, "beteiligung", beteiligungId, ...(auswahl ? [auswahl] : [])], queryFn: () => ladeBewertungen(beteiligungId, auswahl) });
export const rundenListe = (fondsId: string) => queryOptions({ queryKey: [...schluessel.runden, "liste", fondsId], queryFn: () => ladeRundenListe(fondsId) });
export const rundeDetail = (id: string) => queryOptions({ queryKey: [...schluessel.runden, "detail", id], queryFn: () => ladeRunde(id) });
export const berichtListe = (fondsId: string) => queryOptions({ queryKey: [...schluessel.berichte, "liste", fondsId], queryFn: () => ladeBerichte(fondsId) });
export const berichtDetail = (id: string) => queryOptions({ queryKey: [...schluessel.berichte, "detail", id], queryFn: () => ladeBericht(id) });
/** Der Kontrollbericht rechnet auf dem aktuellen Stand und ist deshalb nie „frisch“: er wird bei jedem Öffnen neu geholt. */
export const berichtKontrolle = (id: string) => queryOptions({ queryKey: [...schluessel.berichte, "kontrolle", id], queryFn: () => ladeBerichtKontrolle(id), staleTime: 0 });
export const berichtsvorlagen = (fondsId: string) => queryOptions({ queryKey: [...schluessel.vorlagen, "vorlagen", fondsId], queryFn: () => ladeVorlagen(fondsId), staleTime: 0 });
export const freigabestufen = (fondsId: string) => queryOptions({ queryKey: [...schluessel.vorlagen, "stufen", fondsId], queryFn: () => ladeStufen(fondsId), staleTime: 0 });

/** Kapitaltabelle der Beteiligung zum Stichtag (unter `beteiligungen`, damit Änderungen an Klassen und Positionen sie entwerten). */
export const kapitaltabelle = (id: string, stichtag?: string, offeneWandlungen = false) =>
  queryOptions({ queryKey: [...schluessel.beteiligungen, "kapitaltabelle", id, stichtag ?? null, offeneWandlungen], queryFn: () => ladeKapitaltabelle(id, stichtag, offeneWandlungen) });
/** Pools der Mitarbeiterbeteiligung eines Unternehmens mit Verlauf, Zuteilungen und Stand zum Stichtag (unter `organisationen`, damit Änderungen sie entwerten). */
export const mitarbeiterpools = (organisationId: string, stichtag?: string) =>
  queryOptions({ queryKey: [...schluessel.organisationen, "mitarbeiterpools", organisationId, stichtag ?? null], queryFn: () => ladeMitarbeiterpools(organisationId, stichtag) });

/** Anteilsklassen eines Unternehmens (auch die, die noch keine Position nutzt). */
export const anteilsklassen = (organisationId: string) =>
  queryOptions({ queryKey: [...schluessel.organisationen, "anteilsklassen", organisationId], queryFn: () => ladeAnteilsklassen(organisationId) });
/** Rückfluss des Fonds über einen Bereich von Exitwerten (reine Berechnung; ändert sich mit den Klassen, daher unter `beteiligungen`). */
export const wasserfallKurve = (id: string, bis: string, punkte: number, exitdatum: string) =>
  queryOptions({ queryKey: [...schluessel.beteiligungen, "kurve", id, bis, punkte, exitdatum], queryFn: () => ladeKurve(id, bis, punkte, exitdatum), placeholderData: keepPreviousData });

/** Alle Runden des Unternehmens, Entwürfe eingeschlossen (unter `beteiligungen`, damit Buchungen aus einem Abschluss die Abfrage entwerten). */
/** Auswahlliste der Vehikel mit Investor (Runden- und Positionsdialoge); gesucht in Vehikel- und Investornamen. */
export const vehikelAuswahl = (suche: string) => queryOptions({ queryKey: [...schluessel.organisationen, "vehikel", "auswahl", suche], queryFn: () => ladeVehikelAuswahl(suche), staleTime: 10_000 });
/** Vehikel eines Investors mit ihren Positionen (nur Runden, die die Person sehen darf). */
export const vehikelDesInvestors = (organisationId: string) =>
  queryOptions({ queryKey: [...schluessel.organisationen, "vehikel", organisationId], queryFn: () => ladeVehikelDesInvestors(organisationId) });
export type VehikelEintrag = Awaited<ReturnType<typeof ladeVehikelDesInvestors>>[number];
export type VehikelTreffer = Awaited<ReturnType<typeof ladeVehikelAuswahl>>[number];

export const finanzierungsrunden = (organisationId: string) =>
  queryOptions({ queryKey: [...schluessel.beteiligungen, "finanzierungsrunden", organisationId], queryFn: () => ladeFinanzierungsrunden(organisationId) });
/** Alle Fondsvorgänge des Unternehmens nach Runde gruppiert, dazu die ohne Runde (unter `beteiligungen`: Buchungen, Zuordnungen und Rundenänderungen entwerten sie über `bestand`). */
export const rundentransaktionen = (organisationId: string) =>
  queryOptions({ queryKey: [...schluessel.beteiligungen, "rundentransaktionen", organisationId], queryFn: () => ladeRundentransaktionen(organisationId) });
/** Abgeleitete Werte und Hinweise zu einer Runde; reine Rechnung der API, nie im Browser. */
export const rundenVorschau = (organisationId: string, eingabe: RundenVorschauEingabe, aktiv: boolean) =>
  queryOptions({ queryKey: [...schluessel.beteiligungen, "rundenvorschau", organisationId, eingabe], queryFn: () => ladeRundenVorschau(organisationId, eingabe), enabled: aktiv, staleTime: 0, placeholderData: keepPreviousData, retry: false });
/** Vorschlag zum Option Pool Shuffle im Rundendialog (Aufstockung, Preis, Kennwerte); speichert nichts. */
export const poolVorschlag = (organisationId: string, eingabe: PoolVorschlagEingabe, aktiv: boolean) =>
  queryOptions({ queryKey: [...schluessel.beteiligungen, "poolvorschlag", organisationId, eingabe], queryFn: () => ladePoolVorschlag(organisationId, eingabe), enabled: aktiv, staleTime: 0, placeholderData: keepPreviousData, retry: false });
/** Journal des Fonds (unter `fonds`: jede Buchung entwertet es), Seiten mit Cursor. */
export const journal = (fondsId: string, filter: JournalFilter) =>
  infiniteQueryOptions({
    queryKey: [...schluessel.fonds, fondsId, "journal", { von: filter.von ?? null, bis: filter.bis ?? null, typ: filter.typ ?? null, beteiligungId: filter.beteiligungId ?? null, bewertungen: filter.bewertungen ?? false, stand: filter.stand ?? null }],
    queryFn: ({ pageParam }) => ladeJournalSeite(fondsId, filter, pageParam),
    initialPageParam: "",
    getNextPageParam: (letzte) => letzte.naechsterCursor ?? undefined,
  });
