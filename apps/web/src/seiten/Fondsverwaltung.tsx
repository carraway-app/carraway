import { lazy, useCallback, useEffect } from "react";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Button, Inhaltsverzeichnis, Seitenkopf, Tabelle, type VerzeichnisGruppe } from "@carraway/ui";
import { fondsListe, fondsUebersicht } from "../api/abfragen-kern";
import { formatBetragCent } from "../lib/zahl";
import { DATENSPRACHE } from "../lib/datensprache";
import { WissensstandWahl } from "../komponenten/Wissensstand";
import { SeitenStichtag } from "../komponenten/SeitenStichtag";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { Skelettzeilen } from "../komponenten/Skelett";
import { useSprache, useT } from "../i18n";
import { useSichtbar } from "../lib/bereiche";
import { useBereich, useRechte } from "../lib/rechte";
import { useInhalt } from "../lib/tabs";
import { merkeFonds } from "../zustand";
import FondsStammdaten from "../komponenten/FondsStammdaten";
import type { fondsInhalteTabs } from "../komponenten/FondsInhalte";

const FondsPeriodensperre = lazy(() => import("../komponenten/FondsPeriodensperre"));
const FondsInhalte = lazy(() => import("../komponenten/FondsInhalte"));
const FondsInvestorenzugaenge = lazy(() => import("../komponenten/FondsInvestorenzugaenge"));
const FondsMandate = lazy(() => import("../komponenten/MandateAbschnitt").then((m) => ({ default: m.FondsMandate })));
const route = getRouteApi("/fonds");

export function FondsverwaltungSeite() {
  const t = useT();
  const f = t.fondsVerwaltung;
  const sprache = useSprache();
  const suche = route.useSearch();
  const navigate = route.useNavigate();
  const { darf } = useRechte();
  const { data: liste } = useSuspenseQuery(fondsListe());
  const fonds = liste.find((eintrag) => eintrag.id === suche.fondsId);
  const mitFinanzen = useBereich("finanzen");
  const inAbgrenzung = suche.tab === "abgrenzung" && mitFinanzen;
  const uebersicht = useQuery({
    ...fondsUebersicht(fonds?.id ?? "", undefined, suche.stand),
    enabled: Boolean(fonds) && inAbgrenzung && !suche.stichtag,
  });
  const datum = suche.stichtag ?? uebersicht.data?.stichtag;
  useEffect(() => {
    if (fonds) merkeFonds(fonds.id);
  }, [fonds]);
  // Reihenfolge der Anzeige; der erste Eintrag ist der Standard. Ein Wechsel setzt auch die geöffnete Bewegung zurück.
  const verwaltet = fonds ? darf("verwalter", fonds.id, "fondsverwaltung") : false;
  // Kapital, Abgrenzung, Dokumente und eigene Felder gehören anderen Bereichen (`lib/bereiche.ts`) und fehlen ohne ihn.
  const ziele = useSichtbar("fondsverwaltung", ["stammdaten", "gremien", "kapital", ...(verwaltet ? ["investoren"] : []), "abgrenzung", ...(verwaltet ? ["sperre"] : []), "dokumente", "felder"].map((id) => ({ id, tab: id })));
  const wechselNavigation = useCallback(
    (optionen: { search: (alt: Record<string, unknown>) => Record<string, unknown> }) => navigate({ search: (alt: Record<string, unknown>) => ({ ...optionen.search(alt), bewegungId: undefined }) } as never),
    [navigate],
  );
  const { aktiv, setzeAktiv } = useInhalt(suche, wechselNavigation, ziele);
  const onFondsWahl = (fondsId: string) => void navigate({ search: { fondsId } });

  if (!fonds) {
    return (
      <div className="app-seite">
        <Seitenkopf titel={t.nav.fonds} aktionen={<FondsStammdaten onFondsWahl={onFondsWahl} />} />
        <Tabelle
          beschriftung={f.liste}
          zeilen={liste}
          zeilenSchluessel={(eintrag) => eintrag.id}
          leer={t.platzhalter.keinFondsTitel}
          spalten={[
            { schluessel: "name", kopf: t.kopf.fonds, zelle: (eintrag) => <Link className="cw-tabelle__name" to="/fonds" search={{ fondsId: eintrag.id }}>{eintrag.name}</Link> },
            { schluessel: "vintage", kopf: f.vintage, zahl: true, zelle: (eintrag) => eintrag.vintage },
            { schluessel: "kapital", kopf: t.portfolio.zeichnungskapital, zahl: true, zelle: (eintrag) => formatBetragCent(eintrag.zeichnungskapital, sprache, eintrag.waehrung) },
            { schluessel: "waehrung", kopf: f.waehrung, zelle: (eintrag) => eintrag.waehrung },
          ]}
        />
      </div>
    );
  }

  const verwaltetFonds = verwaltet;
  const inhalt = (tab: (typeof fondsInhalteTabs)[number]) => {
    if (tab === "abgrenzung" && !datum) {
      return uebersicht.isError ? (
        <>
          <FehlerHinweis fehler={uebersicht.error} />
          <Button variante="sekundaer" onClick={() => void uebersicht.refetch()}>{t.gemeinsam.erneutVersuchen}</Button>
        </>
      ) : <Skelettzeilen anzahl={2} />;
    }
    return <FondsInhalte fondsId={fonds.id} waehrung={fonds.waehrung} tab={tab} stichtag={tab === "abgrenzung" ? datum : suche.stichtag} stand={suche.stand} />;
  };
  const eintraege = [
    { id: "stammdaten", label: f.stammdaten, tab: "stammdaten", inhalt: () => <FondsStammdaten fondsId={fonds.id} onFondsWahl={onFondsWahl} /> },
    { id: "gremien", label: t.tabs.gremien, tab: "gremien", inhalt: () => <FondsMandate fondsId={fonds.id} /> },
    { id: "kapital", label: f.kapital, tab: "kapital", inhalt: () => inhalt("kapital") },
    ...(verwaltetFonds ? [{ id: "investoren", label: f.investoren, tab: "investoren", inhalt: () => <FondsInvestorenzugaenge fondsId={fonds.id} /> }] : []),
    { id: "abgrenzung", label: t.tabs.abgrenzung, tab: "abgrenzung", inhalt: () => inhalt("abgrenzung") },
    ...(verwaltetFonds ? [{
      id: "sperre",
      label: t.verwaltung.sperre.titel,
      tab: "sperre",
      inhalt: () => <section className="app-karte"><p>{t.verwaltung.sperre.einleitung}</p><FondsPeriodensperre fondsId={fonds.id} /></section>,
    }] : []),
    { id: "dokumente", label: t.tabs.dokumente, tab: "dokumente", inhalt: () => inhalt("dokumente") },
    { id: "felder", label: t.zusatzfelder.tab, tab: "felder", inhalt: () => inhalt("felder") },
  ];
  const nimm = (...ids: string[]) => eintraege.filter((e) => ids.includes(e.id) && ziele.some((z) => z.id === e.id));
  const gruppen: VerzeichnisGruppe[] = [
    { id: "stammdaten", label: f.gruppeStammdaten, eintraege: nimm("stammdaten", "gremien") },
    { id: "kapital", label: f.gruppeKapital, eintraege: nimm("kapital", "investoren") },
    { id: "abschluss", label: f.gruppeAbschluss, eintraege: nimm("abgrenzung", "sperre") },
    { id: "ablage", label: f.gruppeAblage, eintraege: nimm("dokumente", "felder") },
  ];
  const mitWissensstand = aktiv === "felder" || Boolean(suche.stand && ["kapital", "abgrenzung", "dokumente"].includes(aktiv));
  return (
    <div className="app-seite" key={fonds.id}>
      <Seitenkopf
        titel={fonds.name}
        titelSprache={DATENSPRACHE}
        meta={<Link to="/fonds" search={{}}>{f.liste}</Link>}
        zeitbezug={inAbgrenzung || mitWissensstand ? (
          <>
            {mitWissensstand ? <WissensstandWahl stand={suche.stand} onWahl={(stand) => void navigate({ search: (alt) => ({ ...alt, stand }), replace: true })} /> : null}
            {inAbgrenzung ? <SeitenStichtag value={datum ?? ""} onChange={(stichtag) => void navigate({ search: (alt) => ({ ...alt, stichtag }), replace: true })} /> : null}
          </>
        ) : null}
      />
      <Inhaltsverzeichnis aria-label={f.bereiche} gruppen={gruppen} aktiv={aktiv} onWechsel={setzeAktiv} />
    </div>
  );
}
