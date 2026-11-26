import { lazy, Suspense, useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Outlet, useParams, useRouter, useRouterState, useSearch, type NavigateOptions } from "@tanstack/react-router";
import { ListIcon, MagnifyingGlassIcon, type NavGruppe } from "@carraway/ui";
import { fondsListe } from "../api/abfragen-kern";
import { Seitenleiste } from "./Seitenleiste";
import { brotkruemel, navigationsgruppen } from "./navigation";
import { WiedervorlagenZaehler } from "./WiedervorlagenZaehler";
import { useRechte } from "../lib/rechte";
import { Umgebungsbanner } from "./Umgebungsbanner";
import { useT } from "../i18n";
import { wirksamerFonds } from "../lib/fonds";
import { ladeNavZustand, merkeFonds, speichereNavZustand, type NavZustand } from "../zustand";

// Bei Fokus oder Annäherung lädt die Palette vor. Der Einstieg bleibt ein eigener Chunk.
const ladeSuchDialog = () => import("./SuchDialog");
const bereiteSucheVor = () => { void ladeSuchDialog().catch(() => {}); };
const SuchDialog = lazy(ladeSuchDialog);
// Das Thema der Person kommt vom Server, sobald die Anmeldung steht; der Abgleich lädt nach dem ersten Zeichnen (Budget des Anfangsumfangs).
const ThemaAbgleich = lazy(() => import("./ThemaAbgleich"));

/** Während das Suchmodul lädt, bleibt der Fokus am Auslöser. Escape bricht das Öffnen ab. */
function LadeSuche({ onAbbrechen }: { onAbbrechen: () => void }) {
  const t = useT();
  useEffect(() => {
    const abbrechen = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onAbbrechen();
      }
    };
    document.addEventListener("keydown", abbrechen, true);
    return () => document.removeEventListener("keydown", abbrechen, true);
  }, [onAbbrechen]);
  return <span className="app-suche-laedt" role="status">{t.gemeinsam.laedt}</span>;
}

/** `true`, solange das Fenster schmal ist (bis 807 px): Dann ist die Seitenleiste ein Menü über dem Inhalt. */
function useSchmalesFenster(): boolean {
  const abfrage = "(max-width: 807px)";
  const [schmal, setSchmal] = useState(() => typeof window.matchMedia === "function" && window.matchMedia(abfrage).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const m = window.matchMedia(abfrage);
    const aendern = () => setSchmal(m.matches);
    m.addEventListener("change", aendern);
    return () => m.removeEventListener("change", aendern);
  }, []);
  return schmal;
}

/** Rahmen der Anwendung: Seitenleiste mit Fondsauswahl, Navigation und Konto; Kopfzeile mit Pfad und Suche; Inhalt. */
export function AnwendungsHuelle() {
  const t = useT();
  const { ich, darf } = useRechte();
  const router = useRouter();
  const pfad = useRouterState({ select: (s) => s.location.pathname });
  const fondsRoute = useRouterState({ select: (s) => s.matches.at(-1)?.routeId });
  const fondsAusDetail = useRouterState({
    select: (s) => {
      const match = s.matches.at(-1);
      switch (match?.routeId) {
        case "/beteiligungen/$id":
        case "/berichte/$id":
        case "/belege/$id":
        case "/zinslaeufe/$id":
        case "/meldungen/$id":
          return match.loaderData?.fondsId;
        default:
          return undefined;
      }
    },
  });
  const { fondsId: fondsAusPfad } = useParams({ strict: false }) as { fondsId?: string };
  const roh = useSearch({ strict: false }) as { fondsId?: unknown; tab?: string };
  const fondsAusSuche = typeof roh.fondsId === "string" ? roh.fondsId : undefined;
  // Listen halten die Fondswahl in der URL. Von einem Detail führt der Wechsel zur zugehörigen Liste.
  const fondsSeite = fondsRoute === "/berichte/$id" ? "/berichte"
    : fondsRoute === "/zinslaeufe/$id" ? "/zinslaeufe"
    : fondsRoute === "/belege/$id" ? "/belege"
    : (["/fonds", "/berichte", "/berichte/vorlagen", "/zinslaeufe", "/belege", "/buchhaltung", "/beschlussvorlagen"] as const).find((seite) => seite === fondsRoute);

  const menueAusloeser = useRef<HTMLButtonElement>(null);
  const [mobilOffen, setMobilOffen] = useState(false);
  const [sucheOffen, setSucheOffen] = useState(false);
  const schliesseSuche = useCallback(() => setSucheOffen(false), []);
  // Tastenkürzel: Strg+K oder Cmd+K öffnet die Suche, von überall.
  useEffect(() => {
    const beiTaste = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMobilOffen(false);
        setSucheOffen(true);
      }
    };
    document.addEventListener("keydown", beiTaste);
    return () => document.removeEventListener("keydown", beiTaste);
  }, []);

  const fonds = useQuery(fondsListe());
  // Im Fondsbereich steht die ID im Pfad, bei Listen in der Suche.
  const aktuellerFonds = fondsAusPfad ?? fondsAusDetail ?? wirksamerFonds(fonds.data ?? [], fondsSeite ? fondsAusSuche : undefined)?.id;

  const fondsInAuswahl = fondsSeite === "/fonds" ? fondsAusSuche : aktuellerFonds;
  const portfolioFonds = wirksamerFonds((fonds.data ?? []).filter((f) => darf("betrachter", f.id, "portfolio")), aktuellerFonds);
  const portfolio: NavigateOptions = portfolioFonds ? { to: "/fonds/$fondsId", params: { fondsId: portfolioFonds.id }, search: {} } : { to: "/" };

  function fondsZiel(id: string | undefined): NavigateOptions {
    if (fondsSeite) return { to: fondsSeite, search: { fondsId: id, ...(fondsSeite === "/fonds" ? { tab: roh.tab } : {}) } };
    if (!id) return { to: "/" };
    const stammdaten: NavigateOptions = { to: "/fonds", search: { fondsId: id } };
    if (fondsRoute === "/meldungen/$id" || fondsRoute === "/fonds/$fondsId/meldungen") {
      return darf("betrachter", id, "meldewesen") ? { to: "/fonds/$fondsId/meldungen", params: { fondsId: id }, search: {} } : stammdaten;
    }
    if (fondsRoute === "/fonds/$fondsId/journal") {
      return darf("betrachter", id, "finanzen") ? { to: fondsRoute, params: { fondsId: id }, search: {} } : stammdaten;
    }
    if (!darf("betrachter", id, "portfolio")) return stammdaten;
    if (fondsAusPfad && fondsRoute !== "__root__" && fondsRoute?.startsWith("/fonds/$fondsId")) {
      return { to: fondsRoute === "/fonds/$fondsId/" ? "/fonds/$fondsId" : fondsRoute, params: { fondsId: id }, search: {} };
    }
    return { to: "/fonds/$fondsId", params: { fondsId: id }, search: {} };
  }

  const auswahlZiel = fondsZiel(aktuellerFonds);
  const auswahlLink = linkAn(auswahlZiel);

  function linkAn(ziel: NavigateOptions) {
    return {
      href: router.buildLocation(ziel).href,
      onClick: (e: MouseEvent<HTMLAnchorElement>) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        setMobilOffen(false);
        void router.navigate(ziel);
      },
      onVorladen: () => void router.preloadRoute(ziel).catch(() => {}),
    };
  }

  // Zustand der Seitenleiste je Person; auf schmalen Fenstern ist sie ein Menü und nie schmal.
  const nutzerId = ich?.id ?? "";
  const [nav, setNav] = useState<NavZustand>(() => ladeNavZustand(nutzerId));
  const aendereNav = (neu: NavZustand) => {
    setNav(neu);
    speichereNavZustand(nutzerId, neu);
  };
  const schmalesFenster = useSchmalesFenster();
  const schliesseMobil = useCallback(() => setMobilOffen(false), []);
  // Jede Navigation schließt das Menü.
  useEffect(() => {
    setMobilOffen(false);
  }, [pfad, fondsAusSuche, schmalesFenster]);

  const definitionen = navigationsgruppen(t, ich, aktuellerFonds, portfolio);
  const gruppen: NavGruppe[] = definitionen.map((g) => ({
    id: g.id,
    label: g.label,
    items: g.items.map((i) => ({ id: i.id, label: i.label, icon: i.icon, aktiv: i.aktiv(pfad), ...linkAn(i.ziel) })),
  }));
  const krumen = brotkruemel(t, pfad, definitionen);

  function fondsWahl(id: string) {
    setMobilOffen(false);
    merkeFonds(id);
    void router.navigate(fondsZiel(id));
  }

  return (
    <>
    <Umgebungsbanner />
    <div className="app">
      <a className="app-sprung" href="#inhalt" inert={mobilOffen}>
        {t.uebersprungLink}
      </a>
      <Seitenleiste
        gruppen={gruppen}
        schmal={nav.schmal && !schmalesFenster}
        onSchmal={(schmal) => aendereNav({ ...nav, schmal })}
        eingeklappt={nav.eingeklappt}
        onGruppe={(id, zu) => aendereNav({ ...nav, eingeklappt: zu ? [...nav.eingeklappt.filter((g) => g !== id), id] : nav.eingeklappt.filter((g) => g !== id) })}
        fonds={{ liste: fonds.data, fehler: fonds.isError, aktuell: fondsInAuswahl, onWahl: fondsWahl, onVorladen: auswahlLink.onVorladen, href: auswahlLink.href, onNavigieren: auswahlLink.onClick }}
        mobilAusloeser={menueAusloeser}
        mobilOffen={mobilOffen}
        onMobilSchliessen={schliesseMobil}
      />
      <div className="app-haupt" inert={mobilOffen}>
        <header className="app-kopf app-kopf--mit-suche" aria-label={t.kopf.beschriftung}>
          <div className="app-kopf__gruppe">
            <button
              type="button"
              ref={menueAusloeser}
              className="app-menueknopf"
              aria-label={t.nav.menueOeffnen}
              aria-expanded={mobilOffen}
              aria-controls="app-seitenleiste"
              onClick={() => setMobilOffen(true)}
            >
              <ListIcon />
            </button>
            {krumen.length > 0 ? (
              <nav aria-label={t.nav.pfad}>
                <ol className="app-pfad">
                  {krumen.map((k, i) => (
                    <li key={`${i}-${k.label}`} aria-current={i === krumen.length - 1 ? "page" : undefined}>
                      {k.ziel ? (
                        <a href={linkAn(k.ziel).href} onClick={linkAn(k.ziel).onClick} className="app-pfad__link">
                          {k.label}
                        </a>
                      ) : (
                        <span>{k.label}</span>
                      )}
                    </li>
                  ))}
                </ol>
              </nav>
            ) : null}
          </div>
          <button
            type="button"
            className="app-kopfsuche"
            aria-haspopup="dialog"
            aria-expanded={sucheOffen}
            aria-keyshortcuts="Control+K Meta+K"
            onFocus={bereiteSucheVor}
            onPointerEnter={bereiteSucheVor}
            onClick={() => setSucheOffen(true)}
          >
            <MagnifyingGlassIcon />
            <span>{t.suche.platzhalter}</span>
            <kbd>{/Mac|iPhone|iPad/i.test(navigator.platform) ? "⌘ K" : t.suche.kuerzel}</kbd>
          </button>
          <div className="app-kopf__gruppe">
            {darf("betrachter", null, "kontakte") && <WiedervorlagenZaehler />}
          </div>
        </header>
        <main id="inhalt" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
    {sucheOffen ? (
      <Suspense fallback={<LadeSuche onAbbrechen={schliesseSuche} />}>
        <SuchDialog onSchliessen={schliesseSuche} />
      </Suspense>
    ) : null}
    {ich ? (
      <Suspense fallback={null}>
        <ThemaAbgleich />
      </Suspense>
    ) : null}
    </>
  );
}
