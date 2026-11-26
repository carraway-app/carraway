import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button, Hinweis, Tabelle, formatDatum, type HerkunftProps, type TabelleSpalte } from "@carraway/ui";
import { fondsAbgrenzung, type Abgrenzung } from "../api/abfragen";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { formatBetragCent } from "../lib/zahl";
import { FehlerHinweis } from "./FehlerHinweis";
import { HerkunftDialog } from "./HerkunftDialog";
import { Skelettzeilen } from "./Skelett";

type Zeile = Abgrenzung["darlehen"][number];
type Gerechnet = Extract<Zeile, { gesamt: string }>;
const istGerechnet = (z: Zeile): z is Gerechnet => "gesamt" in z && z.fehler === null;

/** Grund einer nicht berechenbaren Abgrenzung: übersetzt nach `fehlerCode`; der deutsche Freitext der Berechnung steht nur als Zusatz. */
function NichtBerechenbar({ zeile }: { zeile: Zeile }) {
  const t = useT();
  const a = t.abgrenzung;
  const roh = zeile as { fehler?: string | null; fehlerCode?: string | null; fehlerParams?: Record<string, unknown> | null };
  const code = roh.fehlerCode ?? "BERECHNUNG_FEHLGESCHLAGEN";
  const grund = roh.fehlerParams?.grund;
  const text = aufzaehlung(t.fehler, code);
  const zusatz = typeof grund === "string" ? grund : (roh.fehler ?? null);
  return (
    <span className="app-wert-stapel">
      <span>{a.nichtBerechenbar}</span>
      <span className="app-leer-text">{text === code ? t.fehler.unbekannt : text}</span>
      {zusatz ? (
        <span className="app-leer-text" lang="de">
          {a.detailGrund(zusatz)}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Abgrenzung der Zinsen zum Stichtag der Seite: je aktivem Darlehen die fälligen, noch nicht gebuchten Perioden und das
 * laufende Stück, mit Rechenweg. Ein Darlehen, das sich nicht rechnen lässt, steht mit der Meldung der API und zählt nicht in der Summe.
 */
export function AbgrenzungKachel({ fondsId, waehrung, stichtag, stand }: { fondsId: string; waehrung: string; stichtag: string; stand?: string }) {
  const t = useT();
  const sprache = useSprache();
  const a = t.abgrenzung;
  const { data, error, isPending } = useQuery(fondsAbgrenzung(fondsId, stichtag));
  const [herkunft, setHerkunft] = useState<Gerechnet | null>(null);

  const spalten: TabelleSpalte<Zeile>[] = [
    {
      schluessel: "darlehen",
      kopf: a.spalten.darlehen,
      zelle: (z) => (
        <Link to="/beteiligungen/$id" params={{ id: z.beteiligungId }} search={{ stichtag, stand }}>
          {z.organisation}
        </Link>
      ),
    },
    { schluessel: "instrument", kopf: a.spalten.instrument, zelle: (z) => aufzaehlung(t.instrument, z.instrument) },
    { schluessel: "offen", kopf: a.spalten.offen, zahl: true, zelle: (z) => (istGerechnet(z) ? formatBetragCent(z.offen, sprache, waehrung) : t.gemeinsam.keinWert) },
    {
      schluessel: "laufend",
      kopf: a.spalten.laufend,
      zahl: true,
      zelle: (z) => (istGerechnet(z) ? a.laufendVon(formatDatum(z.laufend.von, sprache), formatDatum(z.laufend.bis, sprache), formatBetragCent(z.laufend.betragGebucht, sprache, waehrung)) : t.gemeinsam.keinWert),
    },
    {
      schluessel: "gesamt",
      kopf: a.spalten.gesamt,
      zahl: true,
      zelle: (z) => (istGerechnet(z) ? formatBetragCent(z.gesamt, sprache, waehrung) : <NichtBerechenbar zeile={z} />),
    },
    {
      schluessel: "herkunft",
      kopf: a.spalten.herkunft,
      zelle: (z) =>
        istGerechnet(z) ? (
          <Button variante="ruhig" aria-label={a.herkunft(z.organisation)} onClick={() => setHerkunft(z)}>
            {a.herkunftKnopf}
          </Button>
        ) : (
          t.gemeinsam.keinWert
        ),
    },
  ];

  return (
    <section className="app-karte" aria-labelledby="abgrenzung-titel">
      <h2 id="abgrenzung-titel" className="cw-t-untertitel app-karte__titel">
        {a.titel}
      </h2>
      <p className="app-leer-text">{a.beschreibung(formatDatum(stichtag, sprache))}</p>
      <p className="app-leer-text app-klein">
        {a.portfolioHinweis}{" "}
        <Link to="/fonds/$fondsId/zinsen" params={{ fondsId }}>
          {a.portfolioLink}
        </Link>
        .
      </p>
      {isPending ? <Skelettzeilen anzahl={2} /> : null}
      {error ? <FehlerHinweis fehler={error} /> : null}
      {data && data.darlehen.length === 0 ? <p className="app-leer-text">{a.keine}</p> : null}
      {data && data.darlehen.length > 0 ? (
        <>
          <Tabelle beschriftung={a.tabelle} spalten={spalten} zeilen={data.darlehen} zeilenSchluessel={(z) => z.beteiligungId} />
          <dl className="app-fakten" aria-label={a.summe}>
            <div>
              <dt>{`${a.summe}: ${a.spalten.offen}`}</dt>
              <dd className="app-zahl">{formatBetragCent(data.summe.offen, sprache, waehrung)}</dd>
            </div>
            <div>
              <dt>{`${a.summe}: ${a.spalten.gesamt}`}</dt>
              <dd className="app-zahl">{formatBetragCent(data.summe.gesamt, sprache, waehrung)}</dd>
            </div>
          </dl>
          {data.darlehen.some((z) => !istGerechnet(z)) ? <Hinweis>{a.fehlerHinweis}</Hinweis> : null}
        </>
      ) : null}
      {herkunft ? <HerkunftDialog titel={a.herkunft(herkunft.organisation)} stichtag={stichtag} schritte={herkunft.schritte as unknown as HerkunftProps["schritte"]} onSchliessen={() => setHerkunft(null)} /> : null}
    </section>
  );
}
