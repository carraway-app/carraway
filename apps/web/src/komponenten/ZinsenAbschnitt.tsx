import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button, Hinweis, Karte, Kennwerte, Kennzahl, KennzahlenReihe, Leer, Status, Tabelle, formatBetrag, formatDatum, type StatusVariante, type TabelleSpalte } from "@carraway/ui";
import { beteiligungZinsen, instrumentdaten, type BeteiligungZinsen } from "../api/abfragen";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { geltendeKondition } from "../lib/instrumente";
import { formatSatz } from "../lib/zahl";
import { FehlerHinweis } from "./FehlerHinweis";
import { VorgangErfassen } from "./InstrumentAbschnitt";
import { Skelettzeilen } from "./Skelett";

type Zins = BeteiligungZinsen["instrumente"][number];
type Periode = Zins["perioden"][number];

const PERIODE_STATUS: Record<string, StatusVariante> = { aufgelaufen: "entwurf", gebucht: "pruefung", offen: "pruefung", gezahlt: "freigegeben", erlassen: "freigegeben", gewandelt: "freigegeben" };
const zahl = (wert: string) => <span className="app-zahl">{wert}</span>;

/**
 * Bereich „Zinsen“: je darlehensartigem Instrument Konditionen, aufgelaufene, gebuchte, kapitalisierte, gezahlte und offene Zinsen und die
 * Perioden zum Stichtag und Wissensstand der Seite. Die Zinsbuchung ist die Forderung, erst die Zinszahlung der Geldeingang.
 */
export function ZinsenAbschnitt({ beteiligungId, fondsId, stichtag, stand, schreiben }: { beteiligungId: string; fondsId: string; stichtag: string; stand: string | undefined; schreiben: boolean }) {
  const t = useT();
  const sprache = useSprache();
  const a = t.zinsenAbschnitt;
  const { data, error, isPending } = useQuery(beteiligungZinsen(beteiligungId, stichtag, stand));
  // Die Fälligkeit des Darlehens steht in den Konditionen der Instrumentdaten, nicht in der Zinsansicht.
  const { data: daten } = useQuery(instrumentdaten(beteiligungId));
  const [erfassen, setErfassen] = useState<string | null>(null);
  const betrag = (wert: string | null) => (wert === null ? t.gemeinsam.keinWert : formatBetrag(wert, sprache));

  return (
    <section className="app-instrument" aria-label={a.titel}>
      <div className="app-abschnittskopf">
        <h2 className="cw-t-untertitel app-karte__titel">{a.titel}</h2>
        <Link to="/interest-runs" search={{ fondsId }}>
          {a.zinslaeufe}
        </Link>
      </div>
      <p className="app-leer-text app-klein">
        {a.stichtag(formatDatum(stichtag, sprache))}. {a.hinweis}
      </p>
      {isPending ? <Skelettzeilen anzahl={3} /> : null}
      {error ? <FehlerHinweis fehler={error} /> : null}
      {data && data.instrumente.length === 0 ? <Leer kompakt beschreibung={a.keine} /> : null}
      {data && data.instrumente.length > 0 ? (
        <KennzahlenReihe aria-label={a.summe}>
          <Kennzahl titel={a.aufgelaufen} wert={betrag(data.summe.aufgelaufen)} />
          <Kennzahl titel={a.gebucht} wert={betrag(data.summe.gebucht)} />
          <Kennzahl titel={a.kapitalisiert} wert={betrag(data.summe.kapitalisiert)} />
          <Kennzahl titel={a.gezahlt} wert={betrag(data.summe.gezahlt)} />
          {Number(data.summe.gewandelt) !== 0 ? <Kennzahl titel={a.gewandelt} wert={betrag(data.summe.gewandelt)} /> : null}
          <Kennzahl titel={a.offen} wert={betrag(data.summe.offen)} hervorgehoben />
        </KennzahlenReihe>
      ) : null}
      {data?.instrumente.map((i) => {
        const faellig = daten ? geltendeKondition(daten.konditionen, i.instrumentId, stichtag)?.faelligAm : undefined;
        return <InstrumentZinsen key={i.instrumentId} zins={i} faelligAm={faellig ?? null} schreiben={schreiben && i.status === "aktiv"} onErfassen={() => setErfassen(i.instrumentId)} />;
      })}
      {erfassen ? <VorgangErfassen beteiligungId={beteiligungId} vorgabe={{ art: "zinszahlung", instrumentId: erfassen }} onSchliessen={() => setErfassen(null)} /> : null}
    </section>
  );
}

function InstrumentZinsen({ zins: i, faelligAm, schreiben, onErfassen }: { zins: Zins; faelligAm: string | null; schreiben: boolean; onErfassen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const a = t.zinsenAbschnitt;
  const c = a.konditionen;
  const keinWert = t.gemeinsam.keinWert;
  const k = i.konditionen;
  const betrag = (wert: string | null) => (wert === null ? keinWert : formatBetrag(wert, sprache));

  const spalten: TabelleSpalte<Periode>[] = [
    { schluessel: "von", kopf: a.spalten.von, zelle: (p) => (p.von ? formatDatum(p.von, sprache) : keinWert) },
    {
      schluessel: "bis",
      kopf: a.spalten.bis,
      zelle: (p) => (
        <>
          {formatDatum(p.bis, sprache)}
          {p.laufend ? <> <Status variante="entwurf">{a.laufend}</Status></> : null}
        </>
      ),
    },
    { schluessel: "faellig", kopf: a.spalten.faellig, zelle: (p) => (p.faellig ? formatDatum(p.faellig, sprache) : keinWert) },
    { schluessel: "betrag", kopf: a.spalten.betrag, zahl: true, zelle: (p) => formatBetrag(p.betrag, sprache) },
    { schluessel: "gezahlt", kopf: a.spalten.gezahlt, zahl: true, zelle: (p) => formatBetrag(p.gezahlt, sprache) },
    { schluessel: "offen", kopf: a.spalten.offen, zahl: true, zelle: (p) => formatBetrag(p.offen, sprache) },
    {
      schluessel: "status",
      kopf: a.spalten.status,
      zelle: (p) => (
        <>
          <Status variante={PERIODE_STATUS[p.status] ?? "entwurf"}>{aufzaehlung(a.status, p.status)}</Status>
          {p.kapitalisiert ? <> {a.kapitalisiertMarke}</> : null}
        </>
      ),
    },
  ];

  return (
    <Karte
      breit
      titel={
        <>
          {i.bezeichnung} <Status variante={i.status === "aktiv" ? "freigegeben" : "entwurf"}>{aufzaehlung(t.instrumenteAbschnitt.status, i.status)}</Status>
        </>
      }
      aktion={
        schreiben ? (
          <Button variante="sekundaer" groesse="s" aria-label={a.zahlungErfassenFuer(i.bezeichnung)} onClick={onErfassen}>
            {a.zahlungErfassen}
          </Button>
        ) : null
      }
    >
      {i.fehler ? <Hinweis>{a.fehlerBerechnung}</Hinweis> : null}
      {i.status !== "aktiv" ? <p className="app-leer-text">{a.nichtAktiv}</p> : null}
      <Kennwerte
        gedaempft={i.status !== "aktiv"}
        gruppen={[
          ...(k
            ? [
                {
                  id: "konditionen",
                  titel: a.gruppen.konditionen,
                  eintraege: [
                    { id: "satz", label: c.satz, wert: zahl(formatSatz(k.satzFix, sprache)), hinweis: `${aufzaehlung(t.zinsmethode, k.methode)} · ${aufzaehlung(t.zinsperiode, k.zinsperiode)}`, primaer: true },
                    { id: "faellig", label: c.faelligAm, wert: faelligAm ? zahl(formatDatum(faelligAm, sprache)) : keinWert, ruhig: !faelligAm },
                    { id: "gewinn", label: c.gewinn, wert: k.gewinnabhaengigSatz ? zahl(`${formatSatz(k.gewinnabhaengigSatz, sprache)} / ${c.kappung} ${formatSatz(k.kappungSatz, sprache)}`) : c.keinGewinn, ruhig: !k.gewinnabhaengigSatz },
                    { id: "stundung", label: c.stundung, wert: k.stundungBis ? zahl(formatDatum(k.stundungBis, sprache)) : keinWert, ruhig: !k.stundungBis },
                    { id: "kap", label: c.kapitalisierung, wert: k.kapitalisieren ? c.ja : c.nein, ruhig: !k.kapitalisieren },
                  ],
                },
              ]
            : []),
          {
            id: "stand",
            titel: a.gruppen.stand,
            eintraege: [
              { id: "offen", label: a.offen, wert: zahl(betrag(i.offen)), primaer: true },
              { id: "aufgelaufen", label: a.aufgelaufen, wert: zahl(betrag(i.aufgelaufen)), primaer: true },
              { id: "gebucht", label: a.gebucht, wert: zahl(betrag(i.gebucht)) },
              { id: "kapitalisiert", label: a.kapitalisiert, wert: zahl(betrag(i.kapitalisiert)), ruhig: Number(i.kapitalisiert) === 0 },
              { id: "gezahlt", label: a.gezahlt, wert: zahl(betrag(i.gezahlt)) },
              ...(Number(i.gewandelt) !== 0 ? [{ id: "gewandelt", label: a.gewandelt, wert: zahl(betrag(i.gewandelt)), hinweis: a.gewandeltHinweis }] : []),
              { id: "naechste", label: a.naechsteFaelligkeit, wert: i.naechsteFaelligkeit ? zahl(formatDatum(i.naechsteFaelligkeit, sprache)) : keinWert, ruhig: !i.naechsteFaelligkeit },
            ],
          },
        ]}
      />
      {k ? null : <p className="app-leer-text">{a.keineKonditionen}</p>}
      {i.perioden.length === 0 ? <p className="app-leer-text">{a.keinePerioden}</p> : <Tabelle dicht beschriftung={`${a.perioden}: ${i.bezeichnung}`} spalten={spalten} zeilen={i.perioden} zeilenSchluessel={(p) => `${p.bis}-${p.laufend ? "l" : "g"}`} />}
    </Karte>
  );
}
