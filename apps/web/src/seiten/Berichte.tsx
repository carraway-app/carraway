import { KeinFonds } from "./Platzhalter";
import { useState, type ReactNode } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Auswahl, Button, ButtonLink, DownloadSimpleIcon, FileTextIcon, Hinweis, KartenRaster, Segment, Seitenkopf, Status, Tabs } from "@carraway/ui";
import { fondsListe, fondsUebersicht } from "../api/abfragen";
import { BerichtDialog, BerichteListe } from "../komponenten/BerichteListe";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { Skelettzeilen } from "../komponenten/Skelett";
import { useRechte } from "../lib/rechte";
import { SeitenStichtag } from "../komponenten/SeitenStichtag";
import { WissensstandWahl } from "../komponenten/Wissensstand";
import { FONDS_SICHT, istWaehrungscode, sichtAnfrage, WaehrungssichtWahl, type SichtZustand } from "../komponenten/WaehrungssichtWahl";
import { useSprache, useT } from "../i18n";
import { fondsberichtUrl, gremienvorlageUrl, portfoliolisteUrl, quartalsberichtUrl } from "../lib/berichteUrl";
import { wirksamerFonds } from "../lib/fonds";
import { useTabs } from "../lib/tabs";
import { formatZeitpunkt } from "../lib/zeit";

const route = getRouteApi("/berichte");

export function BerichteSeite() {
  const t = useT();
  const { data: fonds } = useSuspenseQuery(fondsListe());
  const { fondsId } = route.useSearch();
  const gewaehlt = wirksamerFonds(fonds, fondsId);
  if (!gewaehlt) return <KeinFonds titel={t.berichte.titel} />;
  return <BerichteFuerFonds key={gewaehlt.id} fondsId={gewaehlt.id} fondsName={gewaehlt.name} />;
}

/** Berichte eines Fonds zu einem Stichtag. Die Links sind normale Downloads; die API erzeugt jeden Bericht beim Abruf neu. */
function BerichteFuerFonds({ fondsId, fondsName }: { fondsId: string; fondsName: string }) {
  const t = useT();
  const uiSprache = useSprache();
  const suche = route.useSearch();
  const { stichtag, stand, sprache: gewaehlteSprache } = suche;
  const navigate = route.useNavigate();
  const { tab, setzeTab } = useTabs(suche, navigate, ["liste", "downloads"] as const);
  const uebersicht = useQuery({ ...fondsUebersicht(fondsId, stichtag, stand), enabled: tab === "downloads" });
  const u = uebersicht.data;
  const { darf } = useRechte();
  const [neu, setNeu] = useState(false);
  const [beteiligungId, setBeteiligungId] = useState("");
  const [sicht, setSicht] = useState<SichtZustand>(FONDS_SICHT);
  const b = t.berichte;
  // Ohne ausdrückliche Wahl folgt die Sprache des Berichts der Oberfläche.
  const sprache = gewaehlteSprache ?? uiSprache;
  const beteiligung = u?.beteiligungen.find((x) => x.id === beteiligungId) ?? u?.beteiligungen[0];
  const parameter = { sprache, stichtag: u?.stichtag, ...(stand ? { stand } : {}) };
  // Die Währungssicht gilt für Fondsbericht und Portfolioliste; ein Vergleich ohne gültigen Code geht nicht an die API.
  const sichtOk = sicht.sicht !== "vergleich" || istWaehrungscode(sicht.vergleich);
  const mitSicht = { ...parameter, ...(sichtOk ? sichtAnfrage(sicht) : {}) };

  const knopf = (href: string, format: string, titel: string) => (
    <ButtonLink variante="sekundaer" href={href} download aria-label={b.link(format, titel)}>
      {b.linkKurz(format)}
    </ButtonLink>
  );

  const downloads = () => {
    if (!u) {
      return uebersicht.isError ? (
        <div>
          <FehlerHinweis fehler={uebersicht.error} />
          <Button variante="sekundaer" onClick={() => void uebersicht.refetch()}>{t.gemeinsam.erneutVersuchen}</Button>
        </div>
      ) : <Skelettzeilen anzahl={3} />;
    }
    return (
      <>
        <Hinweis titel={b.entwurfTitel}>{b.entwurfText}</Hinweis>

        <section className="app-werkzeug" role="group" aria-label={b.auswahl}>
          <div className="app-gruppe app-gruppe--zeile" title={b.spracheHilfe}>
            <span className="cw-feld__label" id="berichte-sprache">
              {b.sprache}
            </span>
            <Segment<"de" | "en">
              aria-labelledby="berichte-sprache"
              value={sprache}
              onChange={(neu) => void navigate({ search: (alt) => ({ ...alt, sprache: neu }), replace: true })}
              options={[
                { wert: "de", label: b.sprachen.de },
                { wert: "en", label: b.sprachen.en },
              ]}
            />
          </div>
          <WaehrungssichtWahl
            id="downloads"
            wert={sicht}
            onChange={setSicht}
            texte={{ beschriftung: b.sicht.beschriftung, fonds: b.sicht.fonds, lokal: b.sicht.lokal, vergleich: b.sicht.vergleich, vergleichswaehrung: b.sicht.vergleichswaehrung, hilfe: b.sicht.hilfe }}
          />
          <p className="app-leer-text">{stand ? b.wissensstandMit(formatZeitpunkt(stand, uiSprache)) : b.wissensstandAktuell}</p>
        </section>

        <KartenRaster>
          <Bericht titel={b.fondsbericht.titel} beschreibung={b.fondsbericht.beschreibung}>
            {knopf(fondsberichtUrl(fondsId, "pdf", mitSicht), "PDF", b.fondsbericht.titel)}
            {knopf(fondsberichtUrl(fondsId, "xlsx", mitSicht), "Excel", b.fondsbericht.titel)}
          </Bericht>
          <Bericht titel={b.portfolioliste.titel} beschreibung={b.portfolioliste.beschreibung}>
            {knopf(portfoliolisteUrl(fondsId, mitSicht), "Excel", b.portfolioliste.titel)}
          </Bericht>
          <Bericht titel={b.quartalsbericht.titel} beschreibung={b.quartalsbericht.beschreibung}>
            {beteiligung ? (
              <>
                <Auswahl label={b.quartalsbericht.beteiligung} value={beteiligung.id} onChange={(e) => setBeteiligungId(e.target.value)}>
                  {u.beteiligungen.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.organisation.name}
                    </option>
                  ))}
                </Auswahl>
                {knopf(quartalsberichtUrl(beteiligung.id, parameter), "PDF", `${b.quartalsbericht.titel}, ${beteiligung.organisation.name}`)}
              </>
            ) : (
              <p className="app-leer-text">{b.keineBeteiligungen}</p>
            )}
          </Bericht>
          <Bericht titel={b.gremienvorlage.titel} beschreibung={b.gremienvorlage.beschreibung}>
            {knopf(gremienvorlageUrl(parameter), "PDF", b.gremienvorlage.titel)}
          </Bericht>
        </KartenRaster>
      </>
    );
  };

  return (
    <div className="app-seite">
      <Seitenkopf
        meta={fondsName}
        titel={b.titel}
        zeitbezug={tab === "downloads" ? (
          <>
            <WissensstandWahl stand={stand} onWahl={(neu) => void navigate({ search: (alt) => ({ ...alt, stand: neu }), replace: true })} />
            <SeitenStichtag value={u?.stichtag ?? stichtag ?? ""} label={b.stichtag} onChange={(stichtag) => void navigate({ search: (alt) => ({ ...alt, stichtag }), replace: true })} />
          </>
        ) : null}
        aktionen={tab === "liste" ? (
          <>
            {darf("verwalter", fondsId, "berichte") ? <Link to="/berichte/vorlagen" search={{ fondsId }} className="cw-button cw-button--sekundaer">{t.vorlagen.link}</Link> : null}
            {darf("bearbeiter", fondsId, "berichte") ? <Button onClick={() => setNeu(true)}>{t.bericht.liste.anlegen}</Button> : null}
          </>
        ) : null}
      />

      <Tabs
        aria-label={t.tabs.bereiche}
        aktiv={tab}
        onWechsel={setzeTab}
        tabs={[
          { id: "liste", icon: FileTextIcon, label: t.bericht.liste.titel, inhalt: () => <BerichteListe fondsId={fondsId} /> },
          { id: "downloads", icon: DownloadSimpleIcon, label: b.direktTitel, inhalt: downloads },
        ]}
      />
      {neu ? <BerichtDialog fondsId={fondsId} stichtag={stichtag} stand={stand} onSchliessen={() => setNeu(false)} /> : null}
    </div>
  );
}

function Bericht({ titel, beschreibung, children }: { titel: string; beschreibung: string; children: ReactNode }) {
  return (
    <section className="app-karte app-bericht" aria-label={titel}>
      <div className="app-karte__kopf">
        <h2 className="cw-t-untertitel app-karte__titel">{titel}</h2>
        <Status variante="entwurf" />
      </div>
      <p className="app-leer-text">{beschreibung}</p>
      <div className="app-bericht__aktionen">{children}</div>
    </section>
  );
}
