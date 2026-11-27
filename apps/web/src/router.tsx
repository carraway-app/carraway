import { parseSearch, stringifySearch } from "./lib/url-suche";
import { tabSuche, type TabSuche } from "./lib/tabs";
import { waehrungSuche, type WaehrungSuche } from "./lib/waehrung";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
// Die Abfragen von Datenübernahme, Buchhaltung und Meldewesen laden mit ihrer Seite (dynamischer Import), nicht im Anfangsumfang: die Dateien tragen auch die Änderungsfunktionen.
const apiImport = () => import("./api/import");
const apiBuchhaltung = () => import("./api/buchhaltung");
const apiMeldewesen = () => import("./api/meldewesen");
// Nur die Abfragen der Hülle stehen im Anfangsumfang; die der übrigen Seiten laden in deren Loader (dynamischer Import, parallel zur Seite).
import { fondsListe, fondsUebersicht, STALE_ZEIT } from "./api/abfragen-kern";
const abfragen = () => import("./api/abfragen");
import { AUTH_SEITEN, ichAbfrage, sicheresZiel, umgebungAbfrage } from "./api/anmeldung";
import { ApiFehler } from "./api/client";
import { meldeSitzungsFehler, setzeSitzungsHandler } from "./api/sitzung";
import { Fehleransicht } from "./komponenten/Fehleransicht";
import { Huelle, ladeAnwendungsHuelle } from "./komponenten/Huelle";
import { Seitenskelett } from "./komponenten/Skelett";
import { wirksamerFonds } from "./lib/fonds";
import { standAusUrl } from "./lib/zeit";
import { ladeSeitentexte, useT } from "./i18n";
import { letzterFonds } from "./zustand";
import { Leer } from "@carraway/ui";
import { alle, erweiterungen } from "./erweiterung";

const rechte = () => import("./lib/rechte");

export function erstelleQueryClient(optionen: { wiederholen?: boolean } = {}) {
  const wiederholen = optionen.wiederholen ?? true;
  return new QueryClient({
    // Läuft die Sitzung während der Arbeit ab oder verlangt der Server Passwortwechsel oder zweiten Faktor, führt jede Antwort darauf zur passenden Seite.
    queryCache: new QueryCache({ onError: meldeSitzungsFehler }),
    mutationCache: new MutationCache({ onError: meldeSitzungsFehler }),
    defaultOptions: {
      queries: {
        staleTime: STALE_ZEIT,
        // Clientfehler (4xx) werden nicht wiederholt, sie ändern sich nicht von selbst.
        retry: (anzahl, fehler) => wiederholen && anzahl < 1 && !(fehler instanceof ApiFehler && fehler.status >= 400 && fehler.status < 500),
      },
    },
  });
}

interface RouterKontext {
  queryClient: QueryClient;
}

function NichtGefunden() {
  const t = useT();
  return (
    <div className="app-seite">
      <Leer titel={t.fehler.seiteFehlt} beschreibung="" />
    </div>
  );
}

/** Rücksprungziel aus der URL: nur Pfade der eigenen Oberfläche (siehe `sicheresZiel`). */
const rueckkehr = (suche: Record<string, unknown>): { weiter?: string } => {
  const weiter = sicheresZiel(suche.weiter);
  return weiter ? { weiter } : {};
};

const wurzel = createRootRouteWithContext<RouterKontext>()({
  /**
   * Wächter der Anmeldung, in der Reihenfolge der API: ohne Sitzung (401) zur Anmeldung mit Rücksprungziel, dann Startpasswort
   * ändern (`passwortAendern`), dann zweiten Faktor einrichten (`zweiFaktorErforderlich`). Anmeldung und Einrichtung sind offen.
   */
  beforeLoad: async ({ context, location, matches }) => {
    const qc = context.queryClient;
    const pfad = location.pathname.replace(/\/$/, "") || "/";
    const ruecksprung = Object.hasOwn(location.search, "token") ? pfad : location.href;
    // Auch ohne Erweiterung führen gültige Portaladressen nach der Anmeldung zum Portalhinweis.
    const portalAdresse = /^\/portal(?:\/documents|\/funds\/[^/]+)?\/?$/.test(pfad);
    if (matches.some((match) => match.routeId === "/$") && !portalAdresse) return;
    // Der Link aus der Mail (Passwort festlegen) gilt für jede Person, auch wenn gerade jemand angemeldet ist; die Seite braucht keine Sitzung.
    if (pfad === "/set-password") {
      await ladeSeitentexte(pfad);
      return;
    }
    // Die Texte der Seite (große Bereiche des Wörterbuchs) stehen vor dem Zeichnen bereit, parallel zur Umgebung.
    // Erst nach der Sitzungsprüfung steht fest, ob der interne Rahmen gebraucht wird.
    const weitererEinstieg = alle("einstiege").some((e) => e.passt(pfad));
    await Promise.all([ladeSeitentexte(pfad), qc.ensureQueryData(umgebungAbfrage()).catch(() => undefined)]);
    const ich = await qc.fetchQuery(ichAbfrage()).catch((fehler: unknown) => {
      if (fehler instanceof ApiFehler && fehler.status === 401) return null;
      throw fehler;
    });
    if (!ich) {
      if (pfad === "/sign-in" || pfad === "/setup" || pfad === "/forgot-password") return;
      throw redirect({ to: "/sign-in", search: { weiter: ruecksprung }, replace: true });
    }
    const sperre = ich.passwortAendern ? "/change-password" : ich.zweiFaktorErforderlich ? "/two-factor-setup" : null;
    if (sperre) {
      if (pfad !== sperre) throw redirect({ to: sperre, search: { weiter: ruecksprung }, replace: true });
      return;
    }
    // Investor-Benutzer gehören ins LP-Portal (Erweiterung, eigener Einstieg): jede andere Seite der Anwendung führt dorthin, noch bevor sie Daten lädt.
    // Ohne Erweiterung erklärt eine Seite im Anmelderahmen den Portalzugang.
    if (ich.investor) {
      const portalStart = alle("einstiege").find((e) => e.fuerInvestoren)?.fuerInvestoren ?? "/portal-notice";
      if (!weitererEinstieg && pfad !== portalStart) throw redirect({ to: portalStart as never, replace: true });
      return;
    }
    // Wer angemeldet und frei ist, braucht die Anmelde- und Einrichtungsseiten nicht.
    if (AUTH_SEITEN.includes(pfad)) throw redirect({ to: "/", replace: true });
    if (!weitererEinstieg) await ladeAnwendungsHuelle();
  },
  component: Huelle,
  notFoundComponent: NichtGefunden,
  errorComponent: Fehleransicht,
});

const DATUM = /^\d{4}-\d{2}-\d{2}$/;

function istKalendertag(wert: unknown): wert is string {
  if (typeof wert !== "string" || !DATUM.test(wert)) return false;
  const datum = new Date(`${wert}T00:00:00Z`);
  return Number.isFinite(datum.getTime()) && datum.toISOString().slice(0, 10) === wert;
}

/**
 * Stichtag (`JJJJ-MM-TT`) und Wissensstand aus der URL; ungültige Angaben fallen weg. Auch `loaderDeps` prüft damit
 * noch einmal: Der Router reicht dem Loader die Suche inklusive roher Werte aus der URL, die eine Seite nicht überschreibt.
 */
function stichtagUndStand(suche: Record<string, unknown>): { stichtag?: string; stand?: string } {
  const stand = standAusUrl(suche.stand);
  return {
    ...(istKalendertag(suche.stichtag) ? { stichtag: suche.stichtag } : {}),
    ...(stand ? { stand } : {}),
  };
}

const start = createRoute({
  getParentRoute: () => wurzel,
  path: "/",
  beforeLoad: async ({ context }) => {
    const { darf, hatBereich } = await rechte();
    // Ohne Bereich Portfolio (Rollen der Nutzergruppen) führt der Start zu den Kontakten statt auf die Fondsübersicht.
    const ich = await context.queryClient.fetchQuery(ichAbfrage());
    if (!hatBereich(ich, "portfolio") && hatBereich(ich, "kontakte")) throw redirect({ to: "/contacts", replace: true });
    const fonds = await context.queryClient.ensureQueryData(fondsListe());
    const ziel = fonds.find((f) => f.id === letzterFonds()) ?? fonds[0];
    if (ziel && !darf(ich, "betrachter", ziel.id, "portfolio")) throw redirect({ to: "/funds", search: { fondsId: ziel.id }, replace: true });
    if (ziel) throw redirect({ to: "/funds/$fundId", params: { fundId: ziel.id }, search: {}, replace: true });
  },
  component: lazyRouteComponent(() => import("./seiten/Platzhalter"), "KeinFonds"),
});

const fondsVerwaltung = createRoute({
  getParentRoute: () => wurzel,
  path: "/funds",
  validateSearch: (suche: Record<string, unknown>): { fondsId?: string; stichtag?: string; stand?: string; bewegungId?: string } & TabSuche => ({
    ...(typeof suche.fondsId === "string" && suche.fondsId !== "" ? { fondsId: suche.fondsId } : {}),
    ...tabSuche(suche),
    ...stichtagUndStand(suche),
    ...(suche.tab === "kapital" && typeof suche.bewegungId === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(suche.bewegungId) ? { bewegungId: suche.bewegungId } : {}),
  }),
  loaderDeps: ({ search }) => ({ fondsId: search.fondsId }),
  loader: async ({ context, deps }) => {
    const liste = await context.queryClient.ensureQueryData(fondsListe());
    if (deps.fondsId && !liste.some((f) => f.id === deps.fondsId)) throw new ApiFehler("fund_not_found", 404);
  },
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={5} />,
  component: lazyRouteComponent(() => import("./seiten/Fondsverwaltung"), "FondsverwaltungSeite"),
});

/** Die Übersicht ist die Seite ohne weiteren Pfadteil hinter dem Fonds (mit oder ohne Schrägstrich am Ende). */
const FONDS_UEBERSICHT_PFAD = /^\/funds\/[^/]+\/?$/;

/**
 * Rahmen aller Fondsseiten (Kopf mit Kennzahlen über dem Bereich, siehe `seiten/Fondsrahmen`). Der Rahmen liest die Übersicht des
 * Fonds: auf der Übersicht mit Stichtag und Wissensstand aus der Adresse, auf allen anderen Bereichen den aktuellen Stand, denn deren
 * `stichtag` (Bewertungsrunde) meint etwas anderes. Der Loader holt genau diesen Schlüssel vor und läuft bei jedem Wechsel zwischen
 * den Bereichen neu (blockierend, aber aus dem Zwischenspeicher), damit der Rahmen nie auf Daten wartet.
 */
const fondsRahmen = createRoute({
  getParentRoute: () => wurzel,
  path: "/funds/$fundId",
  shouldReload: true,
  loader: {
    handler: async ({ context, params, location }) => {
      const { stichtag, stand } = FONDS_UEBERSICHT_PFAD.test(location.pathname) ? stichtagUndStand(location.search) : ({} as { stichtag?: string; stand?: string });
      await Promise.all([context.queryClient.ensureQueryData(fondsListe()), context.queryClient.ensureQueryData(fondsUebersicht(params.fundId, stichtag, stand))]);
    },
    staleReloadMode: "blocking",
  },
  pendingComponent: () => <Seitenskelett kacheln={5} zeilen={8} />,
  component: lazyRouteComponent(() => import("./seiten/Fondsrahmen"), "Fondsrahmen"),
});

const portfolio = createRoute({
  getParentRoute: () => fondsRahmen,
  path: "/",
  // `hervorgehoben` ist die Id einer Beteiligung, die nach dem Übergang aus dem Dealflow markiert wird.
  // `stand` ist der Wissensstand als Zeitstempel in UTC (siehe `lib/zeit.ts`). Diese Angaben gelten nur für die Übersicht.
  validateSearch: (suche: Record<string, unknown>): { stichtag?: string; stand?: string; hervorgehoben?: string } & TabSuche & WaehrungSuche => ({
    ...stichtagUndStand(suche),
    ...tabSuche(suche),
    ...waehrungSuche(suche),
    ...(typeof suche.hervorgehoben === "string" && suche.hervorgehoben !== "" ? { hervorgehoben: suche.hervorgehoben } : {}),
  }),
  beforeLoad: ({ params, search }) => {
    if (search.tab === "termine") throw redirect({ to: "/contacts", search: { objekt: "heute" }, replace: true });
    if (search.tab && ["kapital", "abgrenzung", "dokumente", "felder"].includes(search.tab)) {
      throw redirect({ to: "/funds", search: { fondsId: params.fundId, tab: search.tab, ...stichtagUndStand(search) }, replace: true });
    }
  },
  loaderDeps: ({ search }) => stichtagUndStand(search),
  loader: async ({ context, params, deps }) => {
    await Promise.all([context.queryClient.ensureQueryData(fondsListe()), context.queryClient.ensureQueryData(fondsUebersicht(params.fundId, deps.stichtag, deps.stand))]);
  },
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={8} />,
  component: lazyRouteComponent(() => import("./seiten/Portfolio"), "PortfolioSeite"),
});

const kennzahlenabfragen = createRoute({
  getParentRoute: () => fondsRahmen,
  path: "metrics",
  validateSearch: (suche: Record<string, unknown>): TabSuche => tabSuche(suche),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(fondsListe());
  },
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={5} />,
  component: lazyRouteComponent(() => import("./seiten/Kennzahlenabfragen"), "KennzahlenabfragenSeite"),
});

const meldungen = createRoute({
  getParentRoute: () => wurzel,
  path: "/funds/$fundId/filings",
  validateSearch: (suche: Record<string, unknown>): TabSuche => tabSuche(suche),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(fondsListe());
  },
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={5} />,
  component: lazyRouteComponent(() => import("./seiten/Meldungen"), "MeldungenSeite"),
});

const meldelauf = createRoute({
  getParentRoute: () => wurzel,
  path: "/filings/$id",
  loader: async ({ context, params }) => {
    const { meldeLauf } = await apiMeldewesen();
    const [detail] = await Promise.all([context.queryClient.ensureQueryData(meldeLauf(params.id)), context.queryClient.ensureQueryData(fondsListe())]);
    return { fondsId: detail.fondsId };
  },
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={6} />,
  validateSearch: (suche: Record<string, unknown>): TabSuche => tabSuche(suche),
  component: lazyRouteComponent(() => import("./seiten/Meldelauf"), "MeldelaufSeite"),
});

const szenarien = createRoute({
  getParentRoute: () => fondsRahmen,
  path: "scenarios",
  validateSearch: (suche: Record<string, unknown>): TabSuche => tabSuche(suche),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(fondsListe());
  },
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={5} />,
  component: lazyRouteComponent(() => import("./seiten/Szenarien"), "SzenarienSeite"),
});

const reserven = createRoute({
  getParentRoute: () => fondsRahmen,
  path: "reserves",
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(fondsListe());
  },
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={5} />,
  component: lazyRouteComponent(() => import("./seiten/Reserven"), "ReservenSeite"),
});

const fondsZinsenRoute = createRoute({
  getParentRoute: () => fondsRahmen,
  path: "interest",
  validateSearch: stichtagUndStand,
  loaderDeps: ({ search }) => ({ stichtag: search.stichtag, stand: search.stand }),
  loader: async ({ context, params, deps }) => {
    const { fondsZinsen } = await import("./api/zinsen");
    void context.queryClient.prefetchQuery(fondsZinsen(params.fundId, deps.stichtag, deps.stand));
    await context.queryClient.ensureQueryData(fondsListe());
  },
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={5} />,
  component: lazyRouteComponent(() => import("./seiten/Zinsen"), "FondsZinsenSeite"),
});

const bewertungsrunde = createRoute({
  getParentRoute: () => fondsRahmen,
  path: "valuation-round",
  validateSearch: (suche: Record<string, unknown>): { stichtag?: string } => ({
    ...(istKalendertag(suche.stichtag) ? { stichtag: suche.stichtag } : {}),
  }),
  loader: async ({ context, params }) => {
    const { rundenListe } = await abfragen();
    void context.queryClient.prefetchQuery(rundenListe(params.fundId));
    await context.queryClient.ensureQueryData(fondsListe());
  },
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={5} />,
  component: lazyRouteComponent(() => import("./seiten/Bewertungsrunde"), "BewertungsrundeSeite"),
});

const zielfondsRoute = createRoute({
  getParentRoute: () => fondsRahmen,
  path: "target-funds",
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(fondsListe());
  },
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={5} />,
  component: lazyRouteComponent(() => import("./seiten/Zielfonds"), "ZielfondsSeite"),
});

/** Portfolio-Dashboard über alle sichtbaren Fonds (Hauswährung); Stichtag und Wissensstand in der Adresse. */
const portfolioDashboardRoute = createRoute({
  getParentRoute: () => wurzel,
  path: "/portfolio",
  validateSearch: stichtagUndStand,
  pendingComponent: () => <Seitenskelett kacheln={6} zeilen={6} />,
  component: lazyRouteComponent(() => import("./seiten/PortfolioDashboard"), "PortfolioDashboardSeite"),
});

const journalRoute = createRoute({
  getParentRoute: () => wurzel,
  path: "/funds/$fundId/journal",
  validateSearch: (suche: Record<string, unknown>): { von?: string; bis?: string; typ?: string; beteiligungId?: string; bewertungen?: "1"; stand?: string } => ({
    ...(istKalendertag(suche.von) ? { von: suche.von } : {}),
    ...(istKalendertag(suche.bis) ? { bis: suche.bis } : {}),
    ...(typeof suche.typ === "string" && /^[a-z_,]+$/.test(suche.typ) ? { typ: suche.typ } : {}),
    ...(typeof suche.beteiligungId === "string" && suche.beteiligungId !== "" ? { beteiligungId: suche.beteiligungId } : {}),
    // Der Router liest die URL als JSON: aus `1` wird die Zahl 1.
    ...(suche.bewertungen === "1" || suche.bewertungen === 1 ? { bewertungen: "1" as const } : {}),
    ...stichtagUndStand({ stand: suche.stand }),
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(fondsListe());
  },
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={8} />,
  component: lazyRouteComponent(() => import("./seiten/Journal"), "JournalSeite"),
});

const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ansicht aus der URL: die ID einer gespeicherten Ansicht oder `keine` (Vorgabe ohne gespeicherte Standardansicht); sonst entfällt sie. */
const ansichtSuche = (wert: unknown): { ansicht?: string } => (typeof wert === "string" && (wert === "keine" || UUID_ID.test(wert)) ? { ansicht: wert } : {});
const textSuche = (wert: unknown): { suche?: string } => (typeof wert === "string" && wert.trim() !== "" ? { suche: wert.trim().slice(0, 200) } : {});

const pipelineFilterwert = (wert: unknown): string | undefined =>
  typeof wert === "string" && (wert === "-" || UUID_ID.test(wert)) ? wert : undefined;

const dealflow = createRoute({
  getParentRoute: () => wurzel,
  path: "/dealflow",
  validateSearch: (suche: Record<string, unknown>): {
    bereich?: "eingang" | "meine" | "pipeline";
    umfang?: "alle" | "meine";
    darstellung?: "board" | "liste";
    gruppe?: "dealtyp";
    status?: "alle" | "offen" | "abgesagt" | "investiert";
    fondsId?: string;
    investmentmanagerId?: string;
    projektleiterId?: string;
    ansicht?: string;
    suche?: string;
    neu?: "1";
    deal?: string;
  } => ({
    ...(suche.bereich === "eingang" || suche.bereich === "meine" || suche.bereich === "pipeline" ? { bereich: suche.bereich } : {}),
    ...(typeof suche.deal === "string" && /^[A-Za-z0-9-]{1,64}$/.test(suche.deal) ? { deal: suche.deal } : {}),
    ...(suche.neu === "1" || suche.neu === 1 ? { neu: "1" as const } : {}),
    ...(suche.status === "alle" || suche.status === "offen" || suche.status === "abgesagt" || suche.status === "investiert" ? { status: suche.status } : {}),
    ...(suche.umfang === "alle" || suche.umfang === "meine" ? { umfang: suche.umfang } : {}),
    ...(suche.darstellung === "board" || suche.darstellung === "liste" ? { darstellung: suche.darstellung } : {}),
    ...(suche.gruppe === "dealtyp" ? { gruppe: "dealtyp" as const } : {}),
    ...Object.fromEntries(["fondsId", "investmentmanagerId", "projektleiterId"].flatMap((feld) => {
      const wert = pipelineFilterwert(suche[feld]);
      return wert ? [[feld, wert]] : [];
    })),
    ...ansichtSuche(suche.ansicht),
    ...textSuche(suche.suche),
  }),
  pendingComponent: () => <Seitenskelett zeilen={8} />,
  component: lazyRouteComponent(() => import("./seiten/Dealflow"), "DealflowSeite"),
});

const organisation = createRoute({
  getParentRoute: () => wurzel,
  path: "/organizations/$id",
  loader: async ({ context, params }) => {
    const { organisationDetail, organisationAktivitaeten } = await abfragen();
    await Promise.all([context.queryClient.ensureQueryData(organisationDetail(params.id)), context.queryClient.ensureQueryData(organisationAktivitaeten(params.id))]);
  },
  pendingComponent: () => <Seitenskelett zeilen={4} />,
  validateSearch: (suche: Record<string, unknown>): TabSuche => tabSuche(suche),
  component: lazyRouteComponent(() => import("./seiten/Organisation"), "OrganisationSeite"),
});

const deal = createRoute({
  getParentRoute: () => wurzel,
  path: "/deals/$id",
  loader: async ({ context, params }) => {
    const { dealDetail } = await abfragen();
    await Promise.all([context.queryClient.ensureQueryData(dealDetail(params.id)), context.queryClient.ensureQueryData(fondsListe())]);
  },
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={6} />,
  validateSearch: (suche: Record<string, unknown>): TabSuche => tabSuche(suche),
  component: lazyRouteComponent(() => import("./seiten/Deal"), "DealSeite"),
});

const auswertung = createRoute({
  getParentRoute: () => wurzel,
  path: "/dealflow/analytics",
  validateSearch: (suche: Record<string, unknown>): { von?: string; bis?: string; fondsId?: string } & TabSuche => ({
    ...(istKalendertag(suche.von) ? { von: suche.von } : {}),
    ...(istKalendertag(suche.bis) ? { bis: suche.bis } : {}),
    ...(typeof suche.fondsId === "string" && suche.fondsId !== "" ? { fondsId: suche.fondsId } : {}),
    ...tabSuche(suche),
  }),
  loaderDeps: ({ search }) => ({ von: search.von, bis: search.bis, fondsId: search.fondsId }),
  // Nicht warten: Filteränderungen sollen die Seite nicht durch den Ladezustand ersetzen; die Seite zeigt ihn selbst.
  loader: async ({ context, deps }) => {
    const { trichter } = await abfragen();
    void context.queryClient.prefetchQuery(trichter(deps));
  },
  component: lazyRouteComponent(() => import("./seiten/Auswertung"), "AuswertungSeite"),
});

const registerUebersicht = createRoute({
  getParentRoute: () => wurzel,
  path: "/register",
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={5} />,
  component: lazyRouteComponent(() => import("./seiten/RegisterUebersicht"), "RegisterUebersichtSeite"),
});

const kontakte = createRoute({
  getParentRoute: () => wurzel,
  path: "/contacts",
  validateSearch: (suche: Record<string, unknown>): { objekt?: "person" | "deal" | "heute"; liste?: string; ansicht?: string; suche?: string; neu?: "1"; datensatz?: string } => ({
    ...(suche.neu === "1" ? { neu: "1" as const } : {}),
    ...(typeof suche.datensatz === "string" && /^[A-Za-z0-9-]{1,64}$/.test(suche.datensatz) ? { datensatz: suche.datensatz } : {}),
    ...(suche.objekt === "person" || suche.objekt === "deal" || suche.objekt === "heute" ? { objekt: suche.objekt } : {}),
    ...(typeof suche.liste === "string" && UUID_ID.test(suche.liste) ? { liste: suche.liste } : {}),
    ...ansichtSuche(suche.ansicht),
    ...textSuche(suche.suche),
  }),
  beforeLoad: async ({ context, search }) => {
    if (search.objekt !== "deal") return;
    const ich = await context.queryClient.ensureQueryData(ichAbfrage());
    if (!(await rechte()).darf(ich, "betrachter", null, "dealflow")) throw redirect({ to: "/contacts", search: {}, replace: true });
  },
  component: lazyRouteComponent(() => import("./seiten/Kontakte"), "KontaktePage"),
});

const person = createRoute({
  getParentRoute: () => wurzel,
  path: "/people/$id",
  validateSearch: (suche: Record<string, unknown>): TabSuche => tabSuche(suche),
  loader: async ({ context, params }) => {
    const { personAktivitaeten, personDetail } = await abfragen();
    void context.queryClient.prefetchQuery(personAktivitaeten(params.id));
    await context.queryClient.ensureQueryData(personDetail(params.id));
  },
  pendingComponent: () => <Seitenskelett zeilen={4} />,
  component: lazyRouteComponent(() => import("./seiten/Person"), "PersonSeite"),
});

/** Neue Kontakte aus Postfach und Kalender: Vorschläge aus dem eigenen Postfach (die API zeigt nur diese). */
const kontaktVorschlaege = createRoute({
  getParentRoute: () => wurzel,
  path: "/contacts/suggestions",
  component: lazyRouteComponent(() => import("./seiten/KontaktVorschlaege"), "KontaktVorschlaegeSeite"),
});

const kontaktImport = createRoute({
  getParentRoute: () => wurzel,
  path: "/contacts/import",
  component: lazyRouteComponent(() => import("./seiten/KontaktImport"), "KontaktImportSeite"),
});

const wiedervorlagen = createRoute({
  getParentRoute: () => wurzel,
  path: "/follow-ups",
  validateSearch: (suche: Record<string, unknown>): { zustaendig?: "ich" | "alle"; bis?: string } => ({
    ...(suche.zustaendig === "ich" || suche.zustaendig === "alle" ? { zustaendig: suche.zustaendig } : {}),
    ...(istKalendertag(suche.bis) ? { bis: suche.bis } : {}),
  }),
  beforeLoad: async ({ context }) => {
    const ich = await context.queryClient.ensureQueryData(ichAbfrage());
    if (!(await rechte()).darf(ich, "betrachter", null, "kontakte")) throw redirect({ to: "/funds", search: {}, replace: true });
  },
  loaderDeps: ({ search }) => ({ zustaendig: search.zustaendig ?? "ich", bis: search.bis }),
  // Nicht warten: Filteränderungen sollen die Seite nicht durch den Ladezustand ersetzen; die Seite zeigt ihn selbst.
  loader: async ({ context, deps }) => {
    const { wiedervorlagenListe } = await abfragen();
    void context.queryClient.prefetchQuery(wiedervorlagenListe(deps));
  },
  component: lazyRouteComponent(() => import("./seiten/WiedervorlagenListe"), "WiedervorlagenSeite"),
});

const beschlussvorlagen = createRoute({
  getParentRoute: () => wurzel,
  path: "/decision-proposals",
  validateSearch: (suche: Record<string, unknown>): { fondsId?: string } => ({
    ...(typeof suche.fondsId === "string" && suche.fondsId !== "" ? { fondsId: suche.fondsId } : {}),
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(fondsListe());
  },
  pendingComponent: () => <Seitenskelett zeilen={4} />,
  component: lazyRouteComponent(() => import("./seiten/Beschlussvorlagen"), "BeschlussvorlagenSeite"),
});


const beteiligung = createRoute({
  getParentRoute: () => wurzel,
  path: "/investments/$id",
  // Reiter in der Adresse (`tab`, `unter`); die frühere `ansicht=kennzahlen|esg` bleibt als Alias gültig.
  validateSearch: (suche: Record<string, unknown>): { stichtag?: string; stand?: string; bewertungId?: string; rundeId?: string; art?: string; gruppierung?: string } & TabSuche & WaehrungSuche => ({
    ...stichtagUndStand(suche),
    ...waehrungSuche(suche),
    ...(typeof suche.bewertungId === "string" ? { bewertungId: suche.bewertungId } : {}),
    // Gewählte Finanzierungsrunde (Reiter unter Finanzierung › Runden).
    ...(typeof suche.rundeId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(suche.rundeId) ? { rundeId: suche.rundeId } : {}),
    // Filter (`art`) und Gruppierung (`gruppierung`) der Transaktionen; die Seite ordnet unbekannte Werte dem Standard zu.
    ...Object.fromEntries(["art", "gruppierung"].flatMap((k) => (typeof suche[k] === "string" && /^[a-z]{1,16}$/.test(suche[k]) ? [[k, suche[k]]] : []))),
    ...tabSuche(suche, { name: "ansicht", abbildung: (a) => (a === "kennzahlen" ? { tab: "kennzahlen" } : a === "esg" ? { tab: "kennzahlen", unter: "esg" } : {}) }),
  }),
  loaderDeps: ({ search }) => stichtagUndStand(search),
  loader: async ({ context, params, deps }) => {
    // Der Abschnitt „Instrument“ lädt selbst; hier nur vorwärmen, ohne darauf zu warten.
    const { instrumentdaten, beteiligungDetail } = await abfragen();
    void context.queryClient.prefetchQuery(instrumentdaten(params.id));
    const detail = await context.queryClient.ensureQueryData(beteiligungDetail(params.id, deps.stichtag, deps.stand));
    return { fondsId: detail.fonds.id };
  },
  pendingComponent: () => <Seitenskelett kacheln={5} zeilen={6} />,
  component: lazyRouteComponent(() => import("./seiten/Beteiligung"), "BeteiligungSeite"),
});

const kapitalQuelle = createRoute({
  getParentRoute: () => wurzel,
  path: "/funds/$fundId/capital-source/$metric/$movementId/$positionId",
  validateSearch: stichtagUndStand,
  component: lazyRouteComponent(() => import("./seiten/KapitalQuelle"), "KapitalQuelle"),
});

const dokumentRoute = createRoute({
  getParentRoute: () => wurzel,
  path: "/documents/$id",
  validateSearch: (suche: Record<string, unknown>): { seite?: number; stichtag?: string; stand?: string } => {
    const n = Number(suche.seite);
    return { ...stichtagUndStand(suche), ...(Number.isInteger(n) && n >= 1 && n <= 100000 ? { seite: n } : {}) };
  },
  pendingComponent: () => <Seitenskelett zeilen={4} />,
  component: lazyRouteComponent(() => import("./seiten/Dokument"), "DokumentSeite"),
});

const berichte = createRoute({
  getParentRoute: () => wurzel,
  path: "/reports",
  validateSearch: (suche: Record<string, unknown>): { fondsId?: string; stichtag?: string; stand?: string; sprache?: "de" | "en" } & TabSuche => ({
    ...stichtagUndStand(suche),
    ...tabSuche(suche),
    ...(typeof suche.fondsId === "string" && suche.fondsId !== "" ? { fondsId: suche.fondsId } : {}),
    ...(suche.sprache === "de" || suche.sprache === "en" ? { sprache: suche.sprache } : {}),
  }),
  loader: async ({ context }) => { await context.queryClient.ensureQueryData(fondsListe()); },
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={4} />,
  component: lazyRouteComponent(() => import("./seiten/Berichte"), "BerichteSeite"),
});

const vorlagen = createRoute({
  getParentRoute: () => wurzel,
  path: "/reports/templates",
  validateSearch: (suche: Record<string, unknown>): { fondsId?: string } => ({
    ...(typeof suche.fondsId === "string" && suche.fondsId !== "" ? { fondsId: suche.fondsId } : {}),
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(fondsListe());
  },
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={5} />,
  component: lazyRouteComponent(() => import("./seiten/Vorlagen"), "VorlagenSeite"),
});

const bericht = createRoute({
  getParentRoute: () => wurzel,
  path: "/reports/$id",
  loader: async ({ context, params }) => {
    // Der Kontrollbericht rechnet auf dem aktuellen Stand und lädt in der Seite selbst; hier nur vorwärmen.
    const { berichtKontrolle, berichtDetail } = await abfragen();
    void context.queryClient.prefetchQuery(berichtKontrolle(params.id));
    const [detail] = await Promise.all([context.queryClient.ensureQueryData(berichtDetail(params.id)), context.queryClient.ensureQueryData(fondsListe())]);
    return { fondsId: detail.fondsId };
  },
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={6} />,
  validateSearch: (suche: Record<string, unknown>): TabSuche => tabSuche(suche),
  component: lazyRouteComponent(() => import("./seiten/Bericht"), "BerichtSeite"),
});

const zinslaeufe = createRoute({
  getParentRoute: () => wurzel,
  path: "/interest-runs",
  validateSearch: (suche: Record<string, unknown>): { fondsId?: string } => ({
    ...(typeof suche.fondsId === "string" && suche.fondsId !== "" ? { fondsId: suche.fondsId } : {}),
  }),
  loaderDeps: ({ search }) => ({ ...(typeof search.fondsId === "string" ? { fondsId: search.fondsId } : {}) }),
  loader: async ({ context, deps }) => {
    const liste = await context.queryClient.ensureQueryData(fondsListe());
    const fonds = wirksamerFonds(liste, deps.fondsId);
    if (fonds) await context.queryClient.ensureQueryData((await abfragen()).zinslaufListe(fonds.id));
  },
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={5} />,
  component: lazyRouteComponent(() => import("./seiten/Zinslaeufe"), "ZinslaeufeSeite"),
});

const zinslauf = createRoute({
  getParentRoute: () => wurzel,
  path: "/interest-runs/$id",
  loader: async ({ context, params }) => {
    // Das Kontrollbericht lädt die Seite selbst; hier nur vorwärmen.
    const { zinslaufKontrolle, zinslaufDetail } = await abfragen();
    void context.queryClient.prefetchQuery(zinslaufKontrolle(params.id));
    const [detail] = await Promise.all([context.queryClient.ensureQueryData(zinslaufDetail(params.id)), context.queryClient.ensureQueryData(fondsListe())]);
    return { fondsId: detail.fondsId };
  },
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={6} />,
  component: lazyRouteComponent(() => import("./seiten/Zinslauf"), "ZinslaufSeite"),
});

const belege = createRoute({
  getParentRoute: () => wurzel,
  path: "/vouchers",
  validateSearch: (suche: Record<string, unknown>): { fondsId?: string } => ({
    ...(typeof suche.fondsId === "string" && suche.fondsId !== "" ? { fondsId: suche.fondsId } : {}),
  }),
  loaderDeps: ({ search }) => ({ ...(typeof search.fondsId === "string" ? { fondsId: search.fondsId } : {}) }),
  loader: async ({ context, deps }) => {
    const liste = await context.queryClient.ensureQueryData(fondsListe());
    const fonds = wirksamerFonds(liste, deps.fondsId);
    if (fonds) await context.queryClient.ensureQueryData((await apiBuchhaltung()).belegListe(fonds.id));
  },
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={5} />,
  component: lazyRouteComponent(() => import("./seiten/Belege"), "BelegeSeite"),
});

const beleg = createRoute({
  getParentRoute: () => wurzel,
  path: "/vouchers/$id",
  loader: async ({ context, params }) => {
    const { belegDetail } = await apiBuchhaltung();
    const [detail] = await Promise.all([context.queryClient.ensureQueryData(belegDetail(params.id)), context.queryClient.ensureQueryData(fondsListe())]);
    return { fondsId: detail.fondsId };
  },
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={6} />,
  component: lazyRouteComponent(() => import("./seiten/Beleg"), "BelegSeite"),
});

const buchhaltung = createRoute({
  getParentRoute: () => wurzel,
  path: "/accounting",
  validateSearch: (suche: Record<string, unknown>): { fondsId?: string; laufId?: string; konto?: string; stichtag?: string; stand?: string } & TabSuche => ({
    ...stichtagUndStand(suche),
    ...(typeof suche.laufId === "string" && typeof suche.konto === "string" ? { laufId: suche.laufId, konto: suche.konto } : {}),
    ...(typeof suche.fondsId === "string" && suche.fondsId !== "" ? { fondsId: suche.fondsId } : {}),
    ...tabSuche(suche, { name: "bereich", abbildung: (b) => ({ tab: b }) }),
  }),
  loaderDeps: ({ search }) => ({ ...(typeof search.fondsId === "string" ? { fondsId: search.fondsId } : {}) }),
  loader: async ({ context, deps }) => {
    const liste = await context.queryClient.ensureQueryData(fondsListe());
    const fonds = wirksamerFonds(liste, deps.fondsId);
    if (fonds) void apiBuchhaltung().then(({ saldenlaeufe }) => context.queryClient.prefetchQuery(saldenlaeufe(fonds.id)));
  },
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={5} />,
  component: lazyRouteComponent(() => import("./seiten/Buchhaltung"), "BuchhaltungSeite"),
});

const datenuebernahme = createRoute({
  getParentRoute: () => wurzel,
  path: "/import",
  // Hochladen und Prüfen verlangt mindestens die Rolle Bearbeiter; die API prüft jede Anfrage trotzdem selbst.
  beforeLoad: async ({ context }) => {
    const ich = await context.queryClient.fetchQuery(ichAbfrage());
    if (!(await rechte()).hatIrgendwoRolle(ich, "bearbeiter")) throw redirect({ to: "/", replace: true });
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData((await apiImport()).importLaeufe());
  },
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={5} />,
  component: lazyRouteComponent(() => import("./seiten/Import"), "ImportSeite"),
});

const datenuebernahmeLauf = createRoute({
  getParentRoute: () => wurzel,
  path: "/import/$id",
  validateSearch: (suche: Record<string, unknown>): TabSuche => tabSuche(suche),
  beforeLoad: async ({ context }) => {
    const ich = await context.queryClient.fetchQuery(ichAbfrage());
    if (!(await rechte()).hatIrgendwoRolle(ich, "bearbeiter")) throw redirect({ to: "/", replace: true });
  },
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData((await apiImport()).importLauf(params.id));
  },
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={6} />,
  component: lazyRouteComponent(() => import("./seiten/ImportLauf"), "ImportLaufSeite"),
});

const portalHinweis = createRoute({
  getParentRoute: () => wurzel,
  path: "/portal-notice",
  component: lazyRouteComponent(() => import("./seiten/PortalHinweis"), "PortalHinweis"),
});

const anmelden = createRoute({
  getParentRoute: () => wurzel,
  path: "/sign-in",
  validateSearch: (suche: Record<string, unknown>): { weiter?: string; eingerichtet?: boolean; zweiterFaktor?: boolean } => ({
    ...(suche.zweiterFaktor === true || suche.zweiterFaktor === "true" ? { zweiterFaktor: true } : {}),
    ...rueckkehr(suche),
    ...(suche.eingerichtet === true || suche.eingerichtet === "true" ? { eingerichtet: true } : {}),
  }),
  component: lazyRouteComponent(() => import("./seiten/Anmelden"), "AnmeldenSeite"),
});

const einrichtung = createRoute({
  getParentRoute: () => wurzel,
  path: "/setup",
  component: lazyRouteComponent(() => import("./seiten/Einrichtung"), "EinrichtungSeite"),
});

const passwortVergessen = createRoute({
  getParentRoute: () => wurzel,
  path: "/forgot-password",
  component: lazyRouteComponent(() => import("./seiten/PasswortVergessen"), "PasswortVergessenSeite"),
});

const passwortSetzen = createRoute({
  getParentRoute: () => wurzel,
  path: "/set-password",
  component: lazyRouteComponent(() => import("./seiten/PasswortSetzen"), "PasswortSetzenSeite"),
});

const passwortAendern = createRoute({
  getParentRoute: () => wurzel,
  path: "/change-password",
  validateSearch: rueckkehr,
  component: lazyRouteComponent(() => import("./seiten/PasswortAendern"), "PasswortAendernSeite"),
});

const zweiFaktor = createRoute({
  getParentRoute: () => wurzel,
  path: "/two-factor-setup",
  validateSearch: rueckkehr,
  component: lazyRouteComponent(() => import("./seiten/ZweiFaktor"), "ZweiFaktorSeite"),
});

/** Persönliche Einstellungen (Etappe 17): Mails, Postfach und Kalender, Kalenderabonnement. Die Suche trägt nur Codes der Rückkehr von der Anbieterseite. */
const einstellungenPostfach = createRoute({
  getParentRoute: () => wurzel,
  path: "/settings/mailbox",
  validateSearch: (suche: Record<string, unknown>): { ergebnis?: string; bereich?: string; fehler?: string; grund?: string } & TabSuche => {
    const text = (wert: unknown) => (typeof wert === "string" && /^[A-Za-z0-9_]{1,80}$/.test(wert) ? wert : undefined);
    const e = text(suche.ergebnis);
    const b = text(suche.bereich);
    const f = text(suche.fehler);
    const g = text(suche.grund);
    return { ...(e ? { ergebnis: e } : {}), ...(b ? { bereich: b } : {}), ...(f ? { fehler: f } : {}), ...(g ? { grund: g } : {}), ...tabSuche(suche) };
  },
  // Reiter mit eigener Seite (Erweiterungen, z. B. „Excel“) hatten früher hier ihren Platz (`?tab=excel&subtab=…`); gespeicherte Adressen führen dorthin.
  beforeLoad: ({ search }) => {
    const eigeneSeite = alle("einstellungenReiter").find((r) => r.id === search.tab);
    if (eigeneSeite) throw redirect({ to: eigeneSeite.ziel as never, search: (search.unter ? { unter: search.unter } : {}) as never, replace: true });
  },
  component: lazyRouteComponent(() => import("./seiten/EinstellungenPostfach"), "EinstellungenPostfachSeite"),
});

/** Der Mailversand ist ein Bereich der Verwaltung; alte Adressen führen dorthin. */
const mailversand = createRoute({
  getParentRoute: () => wurzel,
  path: "/administration/mail",
  beforeLoad: () => {
    throw redirect({ to: "/administration", search: { tab: "mail" }, replace: true });
  },
});

const verwaltung = createRoute({
  getParentRoute: () => wurzel,
  path: "/administration",
  // `bereich` ist die frühere Schreibweise des Reiters und bleibt als Alias gültig.
  validateSearch: (suche: Record<string, unknown>): TabSuche => tabSuche(suche, { name: "bereich", abbildung: (b) => ({ tab: b }) }),
  // Nur globale Verwalter; die API prüft jede Anfrage trotzdem selbst.
  beforeLoad: async ({ context }) => {
    const ich = await context.queryClient.fetchQuery(ichAbfrage());
    if (!ich.globalVerwalter) throw redirect({ to: "/", replace: true });
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(fondsListe());
  },
  pendingComponent: () => <Seitenskelett kacheln={0} zeilen={6} />,
  component: lazyRouteComponent(() => import("./seiten/Verwaltung"), "VerwaltungSeite"),
});

const fondsKinder = [portfolio, kennzahlenabfragen, szenarien, reserven, fondsZinsenRoute, bewertungsrunde, zielfondsRoute];
const unbekannt = createRoute({ getParentRoute: () => wurzel, path: "$", component: NichtGefunden });
const wurzelKinder = [unbekannt, start, fondsVerwaltung, portfolioDashboardRoute, fondsRahmen.addChildren(fondsKinder), meldungen, meldelauf, journalRoute, dealflow, auswertung, deal, organisation, person, beteiligung, kapitalQuelle, dokumentRoute, kontakte, kontaktImport, kontaktVorschlaege, registerUebersicht, wiedervorlagen, beschlussvorlagen, berichte, vorlagen, bericht, zinslaeufe, zinslauf, belege, beleg, buchhaltung, datenuebernahme, datenuebernahmeLauf, portalHinweis, anmelden, einrichtung, passwortVergessen, passwortSetzen, passwortAendern, zweiFaktor, verwaltung, einstellungenPostfach, mailversand];
/** Der Baum des Kerns (Typ aller Adressen der Anwendung). */
const kernBaum = () => wurzel.addChildren(wurzelKinder);

/**
 * Hängt die Routen der Erweiterungen in den Baum (zur Laufzeit, vor dem Bau des Routers). Die Typen der Adressen kennen nur den Kern; Erweiterungen
 * navigieren zu ihren eigenen Seiten ohne Typprüfung der Adresse.
 */
function baumMitErweiterungen(): ReturnType<typeof kernBaum> {
  const zusatz = erweiterungen().map((e) => e.routen?.({ wurzel, fondsRahmen }) ?? {});
  const imFonds = zusatz.flatMap((z) => z.fondsRahmen ?? []);
  const anDerWurzel = zusatz.flatMap((z) => z.wurzel ?? []);
  if (imFonds.length === 0 && anDerWurzel.length === 0) return kernBaum();
  fondsRahmen.addChildren([...fondsKinder, ...imFonds] as unknown as typeof fondsKinder);
  return wurzel.addChildren([...wurzelKinder, ...anDerWurzel] as unknown as typeof wurzelKinder);
}

export function erstelleRouter(queryClient: QueryClient, history?: RouterHistory) {
  const router = createRouter({
    parseSearch,
    stringifySearch,
    routeTree: baumMitErweiterungen(),
    context: { queryClient },
    ...(history ? { history } : {}),
    // Die Daten liegen im Query-Cache; der Router lädt nur vor und fragt bei „intent“ den Cache.
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultPendingMs: 150,
    defaultPendingMinMs: 0,
    scrollRestoration: true,
  });

  let laeuft = false;
  setzeSitzungsHandler((ereignis) => {
    const ort = router.state.location;
    if (laeuft || AUTH_SEITEN.includes(ort.pathname)) return;
    laeuft = true;
    void (async () => {
      try {
        if (ereignis === "abgemeldet") {
          queryClient.clear();
          await router.navigate({ to: "/sign-in", search: { weiter: ort.href }, replace: true });
        } else {
          // Erst den aktuellen Stand der Sperren holen, sonst schickt der Wächter mit veralteten Daten zurück.
          await queryClient.fetchQuery({ ...ichAbfrage(), staleTime: 0 }).catch(() => undefined);
          await router.navigate({ to: ereignis === "passwort" ? "/change-password" : "/two-factor-setup", search: { weiter: ort.href }, replace: true });
        }
      } finally {
        laeuft = false;
      }
    })();
  });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof erstelleRouter>;
  }
}
