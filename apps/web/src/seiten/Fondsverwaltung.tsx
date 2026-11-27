import { lazy, useEffect } from "react";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Button, Seitenkopf, SprungAbschnitt, Sprungmarken, Tabelle, Tabs } from "@carraway/ui";
import { fondsListe, fondsUebersicht } from "../api/abfragen-kern";
import { formatBetragCent } from "../lib/zahl";
import { DATENSPRACHE } from "../lib/datensprache";
import { StichtagMenue } from "../komponenten/StichtagMenue";
import { ZusagenAbdeckung } from "../komponenten/ZusagenAbdeckung";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { Skelettzeilen } from "../komponenten/Skelett";
import { useSprache, useT } from "../i18n";
import { useSichtbar } from "../lib/bereiche";
import { useBereich, useRechte } from "../lib/rechte";
import { merkeFonds } from "../zustand";
import FondsStammdaten from "../komponenten/FondsStammdaten";
import type { fondsInhalteTabs } from "../komponenten/FondsInhalte";

const FondsPeriodensperre = lazy(() => import("../komponenten/FondsPeriodensperre"));
const FondsInhalte = lazy(() => import("../komponenten/FondsInhalte"));
const FondsInvestorenzugaenge = lazy(() => import("../komponenten/FondsInvestorenzugaenge"));
const FondsMandate = lazy(() => import("../komponenten/MandateAbschnitt").then((m) => ({ default: m.FondsMandate })));
const route = getRouteApi("/funds");

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
  // Bereiche der Leiste: „Investoren“ (Reiter Kapital und Zugänge), „Dokumente“ und „Stammdaten“ (alle übrigen Abschnitte untereinander).
  const ort: "investoren" | "dokumente" | "stammdaten" = suche.tab === "kapital" || suche.tab === "investoren" ? "investoren" : suche.tab === "dokumente" ? "dokumente" : "stammdaten";
  const inAbgrenzung = ort === "stammdaten" && mitFinanzen;
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
            {
              schluessel: "name",
              kopf: t.kopf.fonds,
              zelle: (eintrag) =>
                darf("betrachter", eintrag.id, "portfolio") ? (
                  <Link className="cw-tabelle__name" to="/funds/$fundId" params={{ fundId: eintrag.id }} search={{}}>{eintrag.name}</Link>
                ) : (
                  <Link className="cw-tabelle__name" to="/funds" search={{ fondsId: eintrag.id }}>{eintrag.name}</Link>
                ),
            },
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
  const darf_ = (id: string) => ziele.some((z) => z.id === id);
  const abschnitte = [
    { id: "stammdaten", label: f.stammdaten, inhalt: () => <FondsStammdaten fondsId={fonds.id} onFondsWahl={onFondsWahl} /> },
    { id: "gremien", label: t.tabs.gremien, inhalt: () => <FondsMandate fondsId={fonds.id} /> },
    { id: "abgrenzung", label: t.tabs.abgrenzung, inhalt: () => inhalt("abgrenzung") },
    ...(verwaltetFonds ? [{ id: "sperre", label: t.verwaltung.sperre.titel, inhalt: () => <section className="app-karte"><h2 className="cw-t-untertitel app-karte__titel">{t.verwaltung.sperre.titel}</h2><p>{t.verwaltung.sperre.einleitung}</p><FondsPeriodensperre fondsId={fonds.id} /></section> }] : []),
    { id: "felder", label: t.zusatzfelder.tab, inhalt: () => inhalt("felder") },
  ].filter((a) => darf_(a.id));
  const kapitalReiter = [
    { id: "kapital", label: f.kapital },
    ...(verwaltetFonds && darf_("investoren") ? [{ id: "investoren", label: f.investoren }] : []),
  ].filter((r) => r.id !== "kapital" || darf_("kapital"));
  const wechsle = (tab: string | undefined, ersetzen = false) => void navigate({ search: (alt) => ({ ...alt, tab, bewegungId: undefined }), replace: ersetzen });
  const mitWissensstand = ort !== "stammdaten" || abschnitte.some((a) => a.id === "felder") || Boolean(suche.stand);
  return (
    <div className="app-seite" key={fonds.id}>
      <Seitenkopf
        titel={fonds.name}
        titelSprache={DATENSPRACHE}
        meta={<span>{ort === "investoren" ? t.nav.investoren : ort === "dokumente" ? t.tabs.dokumente : t.nav.stammdaten}</span>}
        zeitbezug={inAbgrenzung || mitWissensstand ? (
          <StichtagMenue
            fondsId={fonds.id}
            stichtag={inAbgrenzung ? (datum ?? "") : ""}
            onStichtag={inAbgrenzung ? (stichtag) => void navigate({ search: (alt) => ({ ...alt, stichtag }), replace: true }) : undefined}
            stand={suche.stand}
            onStand={mitWissensstand ? (stand) => void navigate({ search: (alt) => ({ ...alt, stand }), replace: true }) : undefined}
          />
        ) : null}
      />
      {/* Unvollständige LP-Zusagen sperren Abrufe, Ausschüttungen und Kosten; der Bereich Investoren zeigt den Hinweis selbst. */}
      {fonds.zusagenVollstaendig === false && suche.tab !== "investoren" ? (
        <ZusagenAbdeckung
          abgedeckt={fonds.abgedeckt}
          zeichnungskapital={fonds.zeichnungskapital}
          waehrung={fonds.waehrung}
          aktion={verwaltet ? <Button variante="ruhig" onClick={() => wechsle("investoren")}>{t.portfolio.zusagen.zumVervollstaendigen}</Button> : undefined}
        />
      ) : null}
      {ort === "investoren" ? (
        kapitalReiter.length > 1 ? (
          <Tabs fest aria-label={t.nav.investoren} aktiv={suche.tab === "investoren" ? "investoren" : "kapital"} onWechsel={(id) => wechsle(id)} tabs={kapitalReiter}>
            {suche.tab === "investoren" ? <FondsInvestorenzugaenge fondsId={fonds.id} /> : inhalt("kapital")}
          </Tabs>
        ) : (
          inhalt("kapital")
        )
      ) : ort === "dokumente" ? (
        inhalt("dokumente")
      ) : (
        <>
          <Sprungmarken
            className="cw-sprungmarken--fest"
            aria-label={f.bereiche}
            marken={abschnitte.map((a) => ({ id: a.id, label: a.label }))}
            ziel={abschnitte.some((a) => a.id === suche.tab) ? suche.tab : undefined}
            onWahl={(id) => wechsle(id === "stammdaten" ? undefined : id, true)}
          />
          {abschnitte.map((a) => (
            <SprungAbschnitt key={a.id} id={a.id} label={a.label}>
              {a.inhalt()}
            </SprungAbschnitt>
          ))}
        </>
      )}
    </div>
  );
}
