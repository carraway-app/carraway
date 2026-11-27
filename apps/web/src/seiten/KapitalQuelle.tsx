import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Fakten, Hinweis, Seitenkopf, formatDatum, type FaktEintrag } from "@carraway/ui";
import { kapitalHerkunft, mitteilungDateiUrl } from "../api/kapitalbewegungen";
import { belegDateiUrl } from "../api/buchhaltung";
import { useSprache, useT } from "../i18n";
import { kapitalTexte } from "../i18n/kapitalbewegung";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { Quellenstand } from "../komponenten/Quellenstand";
import { Skelettzeilen } from "../komponenten/Skelett";
import { useNamen } from "../lib/namen";
import { formatBetragCent } from "../lib/zahl";
import { formatZeitpunkt } from "../lib/zeit";

const route = getRouteApi("/funds/$fundId/capital-source/$metric/$movementId/$positionId");

export function KapitalQuelle() {
  const params = route.useParams();
  const { fundId: fondsId, metric, movementId: bewegungId, positionId } = params;
  const kennzahl = metric === "called" ? "abgerufen" : metric === "paid-in" ? "eingezahlt" : null;
  const { stichtag, stand } = route.useSearch();
  const sprache = useSprache();
  const t = useT();
  const k = kapitalTexte[sprache];
  const { data, error, isLoading } = useQuery({ ...kapitalHerkunft(fondsId, stichtag ?? "", stand ?? "", bewegungId), enabled: !!stichtag && !!stand });
  const person = useNamen(data?.nachweise?.mitteilungen.map((m) => m.von) ?? []);
  if (isLoading) return <Skelettzeilen anzahl={3} />;
  if (error) return <FehlerHinweis fehler={error} />;
  const position = kennzahl === "abgerufen" || kennzahl === "eingezahlt" ? data?.[kennzahl].find((p) => p.id === positionId) : null;
  if (!data || !position || !stichtag || !stand) return <Hinweis>{k.quelleFehlt}</Hinweis>;

  const fakten: FaktEintrag[] = [
    { label: k.wertstellung, wert: formatDatum(position.datum, sprache) },
    { label: k.betrag(data.waehrung), wert: formatBetragCent(position.betrag, sprache, data.waehrung) },
  ];
  const abruf = data.nachweise?.abruf;
  if (abruf) {
    const beschriftung = formatDatum(abruf.valuta, sprache) + " · " + formatBetragCent(abruf.betrag, sprache, data.waehrung);
    const anteil = data.abgerufen.find((p) => p.organisationId === position.organisationId) ?? data.abgerufen.find((p) => p.id === bewegungId);
    fakten.push({ label: k.quelleArt.abruf, wert: kennzahl === "eingezahlt" && anteil
      ? <Link to={route.id} params={{ ...params, metric: "called", positionId: anteil.id }} search={{ stichtag, stand }}>{beschriftung}</Link>
      : beschriftung });
    if (abruf.bemerkung) fakten.push({ label: k.bemerkung, wert: abruf.bemerkung });
  }
  if (position.faelligAm) fakten.push({ label: k.faellig, wert: formatDatum(position.faelligAm, sprache) });
  if (position.offen) fakten.push({ label: k.offen, wert: formatBetragCent(position.offen, sprache, data.waehrung) });
  if (position.referenz) fakten.push({ label: k.belegreferenz, wert: position.referenz });
  if (position.grund) fakten.push({ label: k.grund, wert: position.grund });
  if (position.gegenbuchungId) fakten.push({ label: k.gegenbuchung, wert:
    <Link to={route.id} params={{ ...params, positionId: position.gegenbuchungId }} search={{ stichtag, stand }}>
      {position.art === "storno" ? k.storniert : k.quelleArt.storno}
    </Link> });
  for (const m of data.nachweise?.mitteilungen ?? []) {
    if (position.organisationId && position.organisationId !== m.organisationId) continue;
    fakten.push({ id: m.id, label: t.bewertungen.freigegebenVon(person(m.von) ?? "", formatZeitpunkt(m.am, sprache)),
      wert: <a download href={mitteilungDateiUrl(fondsId, m.id, stichtag, stand)}>{m.datei}</a> });
  }
  for (const b of data.nachweise?.belege ?? []) {
    fakten.push({ id: b.id, label: t.buchhaltung.beleg.freigegebenLabel + " · " + formatZeitpunkt(b.am, sprache),
      wert: <a href={belegDateiUrl(b.id)} download>{b.datei}</a> });
  }
  return <div className="app-seite">
    <Seitenkopf titel={[k.quelleArt[position.art], position.storniert && k.storniert].filter(Boolean).join(" · ")} meta={position.investor} />
    <Quellenstand stichtag={stichtag} stand={stand} />
    <Fakten eintraege={fakten} />
  </div>;
}
