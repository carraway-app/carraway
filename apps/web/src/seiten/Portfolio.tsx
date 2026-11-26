import { useEffect, useState, useSyncExternalStore } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Button, Leer, Status, Tabelle, formatBetrag, formatMultiple, type Sortierrichtung, type StatusVariante, type TabelleSpalte } from "@carraway/ui";
import { fondsListe, fondsUebersicht, type BeteiligungZeile as Zeile } from "../api/abfragen";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { offeneForderungen } from "../lib/forderungen";
import { Waehrungsleiste } from "../komponenten/Waehrungsleiste";
import { fondsWaehrungssicht } from "../api/waehrung";
import { betragDerSicht, type WaehrungSuche } from "../lib/waehrung";

const route = getRouteApi("/fonds/$fondsId/");
const mobileTabelle = "(width < 600px)";

function beobachteTabellenbreite(aendern: () => void) {
  const abfrage = window.matchMedia?.(mobileTabelle);
  abfrage?.addEventListener("change", aendern);
  return () => abfrage?.removeEventListener("change", aendern);
}

function mobileTabellenbreite() {
  return window.matchMedia?.(mobileTabelle).matches ?? false;
}

const STATUS_VARIANTE: Record<string, StatusVariante> = { aktiv: "freigegeben", exit: "entwurf", insolvent: "fehlt", abgeschrieben: "fehlt" };

const alsZahl = (wert: string | null | undefined): number | null => {
  if (wert === null || wert === undefined) return null;
  const n = Number(wert);
  return Number.isFinite(n) ? n : null;
};

export function PortfolioSeite() {
  const t = useT();
  const sprache = useSprache();
  const { fondsId } = route.useParams();
  const suche = route.useSearch();
  const { stichtag, stand, hervorgehoben } = suche;
  const navigate = route.useNavigate();
  // Währungssicht (Etappe 21): Lokal | Fonds | Vergleich in der Adresse; die Kennzahlen des Fonds bleiben in Fondswährung.
  const sicht = suche.sicht ?? "fonds";
  const schmaleTabelle = useSyncExternalStore(beobachteTabellenbreite, mobileTabellenbreite);
  const waehrung = useQuery({
    ...fondsWaehrungssicht(fondsId, { stichtag, stand, vergleich: sicht === "vergleich" ? suche.vergleich : undefined }),
    enabled: sicht === "lokal" || (sicht === "vergleich" && Boolean(suche.vergleich)),
  });
  const ws = sicht === "fonds" ? undefined : waehrung.data;
  const aendereSicht = (neu: WaehrungSuche) => void navigate({ search: (alt) => ({ ...alt, sicht: neu.sicht, vergleich: neu.vergleich }), replace: true });
  const { data: fondsDaten } = useSuspenseQuery(fondsListe());
  const { data: u } = useSuspenseQuery(fondsUebersicht(fondsId, stichtag, stand));
  const fonds = fondsDaten.find((f) => f.id === fondsId);
  const fondsWaehrung = fonds?.waehrung;

  const [sortierung, setSortierung] = useState<{ schluessel: string; richtung: Sortierrichtung } | undefined>();

  // Nach dem Übergang aus dem Dealflow: die neue Beteiligung ins Bild holen.
  useEffect(() => {
    if (hervorgehoben) document.querySelector("tr[aria-current='true']")?.scrollIntoView?.({ block: "center" });
  }, [hervorgehoben, u.beteiligungen]);

  const keinWert = t.gemeinsam.keinWert;

  const waehrungszeilen = new Map(ws?.zeilen.map((zeile) => [zeile.beteiligungId, zeile]));
  const gemischteWaehrungen = sicht === "lokal" && new Set(ws?.zeilen.map((zeile) => zeile.lokalWaehrung)).size > 1;
  const bewertungSortierbar = sicht === "fonds" || (Boolean(ws) && !gemischteWaehrungen);
  const aktiveSortierung = sortierung?.schluessel === "bewertung" && !bewertungSortierbar ? undefined : sortierung;

  function wertInSicht(id: string, art: "investiert" | "bewertung") {
    const zeile = waehrungszeilen.get(id);
    if (!ws || !zeile) return null;
    return betragDerSicht(zeile[art], sicht, { fonds: ws.waehrungen.fonds, lokal: zeile.lokalWaehrung, vergleich: ws.waehrungen.vergleich, haus: ws.waehrungen.haus });
  }

  function sortWert(zeile: Zeile, schluessel: string) {
    if (schluessel === "multiple") return alsZahl(zeile.multiple.wert);
    return alsZahl(sicht === "fonds" ? zeile.letzteBewertung?.wert : wertInSicht(zeile.id, "bewertung")?.wert);
  }

  // Zeilen ohne Wert stehen unabhängig von der Sortierrichtung am Ende.
  const zeilen = aktiveSortierung
    ? [...u.beteiligungen].sort((a, b) => {
        const wa = sortWert(a, aktiveSortierung.schluessel);
        const wb = sortWert(b, aktiveSortierung.schluessel);
        if (wa === null || wb === null) return wa === wb ? 0 : wa === null ? 1 : -1;
        return aktiveSortierung.richtung === "auf" ? wa - wb : wb - wa;
      })
    : u.beteiligungen;

  function sortieren(schluessel: string) {
    setSortierung((alt) => (alt?.schluessel === schluessel ? { schluessel, richtung: alt.richtung === "ab" ? "auf" : "ab" } : { schluessel, richtung: "ab" }));
  }

  const s = t.portfolio.spalten;
  const sichtWaehrung = sicht === "vergleich"
    ? suche.vergleich ?? ""
    : sicht === "lokal" && ws?.zeilen.some((z) => z.lokalWaehrung !== ws.waehrungen.fonds)
      ? t.waehrung.sichten.lokal
      : fondsWaehrung ?? "";
  /** Betrag in der gewählten Sicht. Ohne Vergleichskurs wird kein Betrag in Fondswährung angezeigt. */
  const betragZeile = (id: string, art: "investiert" | "bewertung") => {
    if (sicht === "fonds") return null;
    const x = wertInSicht(id, art);
    if (!x) return keinWert;
    return x?.wert != null ? formatBetrag(x.wert, sprache, { waehrung: x.waehrung }) : <span className="app-luecke" title={t.waehrung.lueckeTitel}>{t.waehrung.luecke}</span>;
  };
  const kopfInSicht = (titel: string) => sicht === "lokal"
    ? t.waehrung.kennzahlIn(titel, t.waehrung.sichten.lokal.toLowerCase())
    : sicht === "vergleich" && sichtWaehrung ? t.waehrung.kennzahlIn(titel, sichtWaehrung) : titel;
  const spalten = {
    beteiligung: {
      schluessel: "beteiligung",
      kopf: s.beteiligung,
      zelle: (z) => (
        <Link to="/beteiligungen/$id" params={{ id: z.id }} search={{ ...(stichtag ? { stichtag } : {}), ...(stand ? { stand } : {}) }} className="cw-tabelle__name">
          {z.organisation.name}
        </Link>
      ),
    },
    sektor: { schluessel: "sektor", kopf: s.sektor, zelle: (z) => z.organisation.sektor ?? keinWert },
    instrument: { schluessel: "instrument", kopf: s.instrument, zelle: (z) => aufzaehlung(t.instrument, z.instrument) },
    status: {
      schluessel: "status",
      kopf: s.status,
      zelle: (z) => <Status variante={STATUS_VARIANTE[z.status] ?? "entwurf"}>{aufzaehlung(t.beteiligungStatus, z.status)}</Status>,
    },
    investiert: {
      schluessel: "investiert",
      kopf: kopfInSicht(s.investiert),
      zahl: true,
      zelle: (z) => betragZeile(z.id, "investiert") ?? formatBetrag(z.investiert, sprache, { waehrung: fondsWaehrung }),
    },
    bewertung: {
      schluessel: "bewertung",
      kopf: kopfInSicht(s.bewertung),
      zahl: true,
      sortierbar: bewertungSortierbar,
      zelle: (z) => {
        const inSicht = betragZeile(z.id, "bewertung");
        if (inSicht) return inSicht;
        const forderung = offeneForderungen(z);
        return (
          <span className="app-wert-stapel">
            {z.letzteBewertung ? formatBetrag(z.letzteBewertung.wert, sprache, { waehrung: fondsWaehrung }) : keinWert}
            {Number(forderung) > 0 ? <span className="app-leer-text">{t.portfolio.davonForderungen(formatBetrag(forderung, sprache, { waehrung: fondsWaehrung }))}</span> : null}
          </span>
        );
      },
    },
    multiple: {
      schluessel: "multiple",
      kopf: s.multiple,
      zahl: true,
      sortierbar: true,
      zelle: (z) => (z.multiple.wert === null ? keinWert : formatMultiple(z.multiple.wert, sprache)),
    },
  } satisfies Record<string, TabelleSpalte<Zeile>>;

  const tabellenSpalten = schmaleTabelle
    ? [spalten.beteiligung, spalten.bewertung, spalten.multiple, spalten.sektor, spalten.instrument, spalten.investiert, spalten.status]
    : Object.values(spalten);

  return (
      <section className="app-portfolio__bestand" aria-labelledby="portfolio-bestand">
        <div className="app-portfolio__tabellenkopf">
          <h2 id="portfolio-bestand" className="cw-t-untertitel">{t.portfolio.beteiligungenAnzahl(zeilen.length)}</h2>
          {fondsWaehrung ? (
            <Waehrungsleiste
              sicht={sicht}
              suche={suche}
              waehrungen={{ fonds: fondsWaehrung, lokal: fondsWaehrung, vergleich: suche.vergleich ?? null }}
              onAendern={aendereSicht}
              luecken={!ws ? [] : sicht === "vergleich" ? ws.luecken.filter((l) => l.nach === ws.waehrungen.vergleich) : sicht === "haus" ? ws.hausLuecken : sicht === "lokal" ? ws.luecken.filter((l) => l.nach !== ws.waehrungen.vergleich) : []}
              kurse={ws && sicht === "vergleich" ? ws.zeilen.flatMap((z) => z.bewertungKurse).filter((x, i, a) => x.nach === ws.waehrungen.vergleich && a.findIndex((y) => y.tag === x.tag && y.nach === x.nach && y.kurs === x.kurs) === i) : []}
              tabellenWaehrung={sichtWaehrung}
              mitStand={Boolean(stand)}
            />
          ) : null}
        </div>
        {sicht !== "fonds" && waehrung.isError ? (
          <div>
            <FehlerHinweis fehler={waehrung.error} />
            <Button variante="sekundaer" disabled={waehrung.isFetching} onClick={() => void waehrung.refetch()}>{t.gemeinsam.erneutVersuchen}</Button>
          </div>
        ) : null}
        {gemischteWaehrungen ? <p className="app-leer-text">{t.waehrung.sortierungGemischt}</p> : null}
        {zeilen.length === 0 ? (
          <Leer zeichen="B" titel={t.portfolio.keineBeteiligungen} beschreibung={t.portfolio.keineBeteiligungenBeschreibung} />
        ) : (
          <Tabelle dicht className="app-portfolio__tabelle" beschriftung={t.portfolio.beteiligungen} spalten={tabellenSpalten} zeilen={zeilen} zeilenSchluessel={(z) => z.id} ausgewaehlt={(z) => z.id === hervorgehoben} sortierung={aktiveSortierung} onSortieren={sortieren} />
        )}
      </section>
  );
}
