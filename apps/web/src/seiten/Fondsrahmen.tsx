import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Button, Hinweis, Kennzahl, KennzahlenReihe, Seitenkopf, formatBetrag, formatMultiple, formatProzent } from "@carraway/ui";
import { fondsListe, fondsUebersicht } from "../api/abfragen";
import { useNeuberechnen } from "../api/mutationen";
import { fondsWaehrungssicht } from "../api/waehrung";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { FondsBereiche, type FondsTab } from "../komponenten/FondsBereiche";
import { HerkunftDialog } from "../komponenten/HerkunftDialog";
import { NurLesen } from "../komponenten/NurLesen";
import { StichtagMenue } from "../komponenten/StichtagMenue";
import { ZusagenAbdeckung } from "../komponenten/ZusagenAbdeckung";
import { useSprache, useT } from "../i18n";
import { DATENSPRACHE } from "../lib/datensprache";
import { useRechte } from "../lib/rechte";
import type { WaehrungSuche } from "../lib/waehrung";
import { formatZeitpunkt } from "../lib/zeit";
import { formatWissensstand } from "../lib/wissensstand";
import { merkeFonds } from "../zustand";
import { alle } from "../erweiterung";

const NavHerkunft = lazy(() => import("../komponenten/NavHerkunft"));

const route = getRouteApi("/funds/$fundId");
const uebersichtRoute = getRouteApi("/funds/$fundId/");

/** Nach „Neu berechnen“ fragt die Seite alle `ABSTAND_MS` nach, solange der Worker rechnet, höchstens `HOECHSTDAUER_MS`. */
const ABSTAND_MS = 1000;
const HOECHSTDAUER_MS = 30_000;

type KennzahlName = "nav" | "tvpi" | "dpi" | "rvpi" | "irr";
const REIHENFOLGE: KennzahlName[] = ["nav", "tvpi", "dpi", "rvpi", "irr"];

const TAB_DER_ROUTE: Record<string, FondsTab> = {
  "/funds/$fundId/": "uebersicht",
  "/funds/$fundId/metrics": "kennzahlen",
  "/funds/$fundId/scenarios": "szenarien",
  "/funds/$fundId/reserves": "reserven",
  "/funds/$fundId/interest": "zinsen",
  "/funds/$fundId/valuation-round": "bewertungsrunde",
  "/funds/$fundId/target-funds": "zielfonds",
};

/** Reiter zur Route: die des Kerns oder einer Erweiterung (Route `/funds/$fundId/<pfad>`). */
function tabDerRoute(routeId: string): FondsTab {
  return TAB_DER_ROUTE[routeId] ?? alle("fondsReiter").find((r) => routeId === `/funds/$fundId/${r.pfad}`)?.id ?? "uebersicht";
}

/**
 * Rahmen aller Fondsseiten: Fondsname, Kennzahlen und Stand stehen über dem Bereich und bleiben beim Wechsel zwischen den Bereichen
 * stehen; die Bereiche selbst stehen in der Seitenleiste (Fondskontext). Stichtag, Wissensstand und Währungssicht gelten nur auf der Übersicht; auf den anderen Bereichen
 * zeigen die Kennzahlen den aktuellen Stand (`bewertungsrunde` hat einen eigenen `stichtag`, der hier nicht mitzählt).
 */
export function Fondsrahmen() {
  const t = useT();
  const sprache = useSprache();
  const { fundId: fondsId } = route.useParams();
  const aktiv = useRouterState({ select: (s) => tabDerRoute(s.matches.at(-1)?.routeId ?? "") });
  const aufUebersicht = aktiv === "uebersicht";
  const suche = uebersichtRoute.useSearch({ shouldThrow: false });
  const stichtag = aufUebersicht ? suche?.stichtag : undefined;
  const stand = aufUebersicht ? suche?.stand : undefined;
  const navigate = uebersichtRoute.useNavigate();
  // Die Währungssicht gilt nur für die NAV-Kachel der Übersicht; die Abfrage ist dieselbe wie in der Tabelle darunter.
  const sicht = (aufUebersicht ? suche?.sicht : undefined) ?? "fonds";
  const vergleich: WaehrungSuche["vergleich"] = sicht === "vergleich" ? suche?.vergleich : undefined;
  const waehrung = useQuery({
    ...fondsWaehrungssicht(fondsId, { stichtag, stand, vergleich }),
    enabled: sicht === "lokal" || (sicht === "vergleich" && Boolean(vergleich)),
  });
  const ws = sicht === "fonds" ? undefined : waehrung.data;

  const neuberechnen = useNeuberechnen(fondsId);
  const { darf } = useRechte();
  // Eine laufende Anfrage gilt nur für den Fonds, Stichtag und Wissensstand, für die sie gestellt wurde.
  const kontext = `${fondsId}|${stichtag ?? ""}|${stand ?? ""}`;
  const [anfrage, setAnfrage] = useState<{ kontext: string; vorher: string | null; abgelaufen: boolean } | null>(null);
  const { data: fondsDaten } = useSuspenseQuery(fondsListe());
  const { data: u } = useSuspenseQuery({
    ...fondsUebersicht(fondsId, stichtag, stand),
    refetchInterval: (query) => (anfrage?.kontext === kontext && !anfrage.abgelaufen && query.state.data?.snapshot?.berechnetAm === anfrage.vorher ? ABSTAND_MS : false),
  });
  const fonds = fondsDaten.find((f) => f.id === fondsId);
  const berechnetAm = u.snapshot?.berechnetAm ?? null;
  const laufendeAnfrage = anfrage?.kontext === kontext && berechnetAm === anfrage.vorher ? anfrage : null;
  const rechnet = laufendeAnfrage !== null && !laufendeAnfrage.abgelaufen;
  const dauertLaenger = laufendeAnfrage?.abgelaufen === true;
  const [herkunft, setHerkunft] = useState<KennzahlName | null>(null);

  useEffect(() => merkeFonds(fondsId), [fondsId]);
  // Der Worker rechnet im Hintergrund; ohne neuen Stand nach `HOECHSTDAUER_MS` gibt die Seite das Warten auf.
  useEffect(() => {
    if (!rechnet) return;
    const timer = setTimeout(() => setAnfrage((alt) => (alt ? { ...alt, abgelaufen: true } : alt)), HOECHSTDAUER_MS);
    return () => clearTimeout(timer);
  }, [rechnet]);

  function neuBerechnen() {
    neuberechnen.mutate(u.stichtag, { onSuccess: () => setAnfrage({ kontext, vorher: berechnetAm, abgelaufen: false }) });
  }

  const k = u.kennzahlen;
  const keinWert = t.gemeinsam.keinWert;
  const werte: Record<KennzahlName, string> = {
    nav: k.nav.wert === null ? keinWert : formatBetrag(k.nav.wert, sprache, { kompakt: true, waehrung: fonds?.waehrung }),
    tvpi: k.tvpi.wert === null ? keinWert : formatMultiple(k.tvpi.wert, sprache),
    dpi: k.dpi.wert === null ? keinWert : formatMultiple(k.dpi.wert, sprache),
    rvpi: k.rvpi.wert === null ? keinWert : formatMultiple(k.rvpi.wert, sprache),
    // Die API liefert den IRR als Bruch ("0.12"), die Anzeige in Prozent.
    irr: k.irr.wert === null ? keinWert : formatProzent(Number(k.irr.wert) * 100, sprache),
  };
  // NAV in der Vergleichs- oder Hauswährung (Kurs des Stichtags); sonst die Fondswährung.
  const navSicht = !ws ? null : sicht === "vergleich" && ws.waehrungen.vergleich ? { wert: ws.navVergleich, waehrung: ws.waehrungen.vergleich } : sicht === "haus" && ws.waehrungen.haus !== ws.waehrungen.fonds ? { wert: ws.navHaus, waehrung: ws.waehrungen.haus } : null;
  const summeVergleich = navSicht && navSicht.wert != null ? formatBetrag(navSicht.wert, sprache, { kompakt: true, waehrung: navSicht.waehrung }) : null;
  const navImVergleich = k.nav.wert === null ? keinWert : summeVergleich ?? (!ws ? keinWert : t.waehrung.luecke);
  const titel = (name: KennzahlName) => t.portfolio[name];
  const offen = herkunft ? k[herkunft] : null;
  const standText = stand
    ? t.portfolio.snapshot.liveStand(formatWissensstand(stand, sprache))
    : u.snapshot
      ? t.portfolio.snapshot.berechnet(formatZeitpunkt(u.snapshot.berechnetAm, sprache))
      : t.portfolio.snapshot.live;

  return (
    <div className="app-seite app-portfolio">
      <Seitenkopf
        meta={<span className="app-meta-stand">{standText}</span>}
        titel={fonds?.name ?? ""}
        titelSprache={DATENSPRACHE}
        zeitbezug={
          aufUebersicht ? (
            <StichtagMenue
              fondsId={fondsId}
              stichtag={u.stichtag}
              onStichtag={(neu) => void navigate({ search: (alt) => ({ ...alt, stichtag: neu }), replace: true })}
              stand={stand}
              onStand={(neu) => void navigate({ search: (alt) => ({ ...alt, stand: neu }), replace: true })}
            />
          ) : undefined
        }
      />

      <section className="app-snapshot" aria-label={t.portfolio.snapshot.beschriftung}>
        <FehlerHinweis fehler={neuberechnen.error} />
        <NurLesen fondsId={fondsId} bereich="portfolio" />
        {u.snapshot?.veraltet ? (
          <Hinweis titel={t.portfolio.snapshot.veraltetTitel}>
            {t.portfolio.snapshot.veraltetText}{" "}
            {darf("bearbeiter", fondsId, "portfolio") ? (
              <Button variante="sekundaer" disabled={neuberechnen.isPending || rechnet} aria-busy={rechnet || undefined} onClick={neuBerechnen}>
                {rechnet ? t.portfolio.snapshot.rechnet : t.portfolio.snapshot.neuBerechnen}
              </Button>
            ) : null}
          </Hinweis>
        ) : null}
        {dauertLaenger ? <Hinweis>{t.portfolio.snapshot.dauertLaenger}</Hinweis> : null}
        {/* Unvollständige LP-Zusagen sperren Abrufe, Ausschüttungen und LP-Berichte; der Hinweis verschwindet bei 100 %. */}
        {fonds?.zusagenVollstaendig === false ? (
          <ZusagenAbdeckung
            abgedeckt={fonds.abgedeckt}
            zeichnungskapital={fonds.zeichnungskapital}
            waehrung={fonds.waehrung}
            aktion={darf("verwalter", fondsId, "fondsverwaltung") ? <Link to="/funds" search={{ fondsId, tab: "investoren" }}>{t.portfolio.zusagen.zumVervollstaendigen}</Link> : undefined}
          />
        ) : null}
      </section>

      <KennzahlenReihe aria-label={t.portfolio.kennzahlen}>
        <Kennzahl titel={t.portfolio.portfoliowert} wert={formatBetrag(u.portfoliowert, sprache, { kompakt: true, waehrung: fonds?.waehrung })} />
        {REIHENFOLGE.map((name) => (
          <Kennzahl key={name} titel={name === "nav" && summeVergleich && navSicht ? t.waehrung.kennzahlIn(titel(name), navSicht.waehrung) : titel(name)} wert={name === "nav" && navSicht ? navImVergleich : werte[name]} hervorgehoben={name === "tvpi" && k.tvpi.wert !== null} hinweis={name === "nav" && k.nav.wert === null ? t.portfolio.navLuecke : undefined} onHerkunft={() => setHerkunft(name)} />
        ))}
      </KennzahlenReihe>

      <FondsBereiche aktiv={aktiv} fondsId={fondsId}>
        <Outlet />
      </FondsBereiche>

      {herkunft === "nav" ? (
        <Suspense fallback={null}><NavHerkunft fondsId={fondsId} waehrung={fonds?.waehrung} stichtag={u.stichtag} stand={stand ?? u.quellenstand} schritte={k.nav.schritte} onSchliessen={() => setHerkunft(null)} /></Suspense>
      ) : offen && herkunft ? (
        <HerkunftDialog titel={titel(herkunft)} stichtag={u.stichtag} schritte={offen.schritte} onSchliessen={() => setHerkunft(null)} />
      ) : null}
    </div>
  );
}
