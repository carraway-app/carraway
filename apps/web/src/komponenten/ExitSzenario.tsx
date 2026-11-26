import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Feld, Hinweis, Kennzahl, Segment, Status, Tabelle, formatBetrag, formatMultiple, type TabelleSpalte } from "@carraway/ui";
import { wasserfallKurve, type Kurve } from "../api/abfragen";
import { heuteIso } from "../api/datum";
import { useWasserfall } from "../api/mutationen";
import { feldText } from "../i18n/fehler";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { formatAnzahl, formatBetragCent, formatPreis, prozentZuAnteil } from "../lib/zahl";
import { betragOderNichts, useFormular } from "./formular";
import { BetragFeld } from "./BetragFeld";
import { betragRegel, datumRegel, prozentRegel } from "../lib/feldpruefung";
import { FehlerHinweis } from "./FehlerHinweis";
import { Rechenweg } from "./Rechenweg";
import { WasserfallDiagramm } from "./WasserfallDiagramm";

type Ergebnis = NonNullable<ReturnType<typeof useWasserfall>["data"]>;
type Zeile = Ergebnis["zeilen"][number];
type KlassenZeile = Ergebnis["klassen"][number];
type InhaberZeile = Ergebnis["inhaber"][number];

const FAKTOREN = ["0.5", "1", "2", "5"] as const;
const PUNKTE = 60;
const FELDER = ["exitwert", "exitdatum", "kosten", "treuhandAnteil"];

/** Entscheidung einer Zeile oder Klasse in einem Wort: wandelt um, behält die Präferenz, am Cap, Stammanteile. */
function entscheidungsSchluessel(x: { klasseId?: string | null; id?: string | null; gewandelt: boolean; gedeckelt: boolean }): "gewandelt" | "gedeckelt" | "praeferenz" | "stamm" {
  const klasse = "klasseId" in x ? x.klasseId : x.id;
  if (x.gewandelt) return "gewandelt";
  if (x.gedeckelt) return "gedeckelt";
  return klasse ? "praeferenz" : "stamm";
}

/**
 * Exit-Szenario einer Beteiligung: Exitwert (mit Schnellwahl als Vielfaches der letzten Post-Money-Bewertung), Datum, Kosten und
 * Treuhand eingeben, Rückflüsse je Inhaber und Klasse mit Umwandlungsentscheidung, Rechenweg und Diagramm des Fondsrückflusses sehen.
 * Die API schreibt dabei nichts; das Szenario bleibt nur auf dieser Seite.
 */
export function ExitSzenario({ beteiligungId, postMoney }: { beteiligungId: string; postMoney: string | null }) {
  const t = useT();
  const w = t.wasserfall;
  const sprache = useSprache();
  const rechnen = useWasserfall(beteiligungId);
  const [ansicht, setAnsicht] = useState<"position" | "investor">("position");
  const { werte, setWerte, feld, pruefeAlle } = useFormular(
    { exitwert: "", exitdatum: heuteIso(), kosten: "", treuhand: "" },
    { exitwert: betragRegel({ pflicht: true }), exitdatum: datumRegel({ pflicht: true }), kosten: betragRegel(), treuhand: prozentRegel() },
  );
  const { exitwert, exitdatum, kosten, treuhand } = werte;
  const ergebnis = rechnen.data;
  const post = postMoney === null ? null : Number(postMoney);

  function absenden(wert: string = exitwert) {
    const k = betragOderNichts(kosten, sprache);
    const th = treuhand.trim() === "" ? undefined : prozentZuAnteil(treuhand);
    rechnen.mutate({ exitwert: betragOderNichts(wert, sprache) ?? "", exitdatum, ...(k ? { kosten: k } : {}), ...(th ? { treuhandAnteil: th } : {}) });
  }

  function schnellwahl(faktor: string) {
    if (post === null) return;
    const wert = String(Math.round(post * Number(faktor) * 100) / 100);
    setWerte((alt) => ({ ...alt, exitwert: wert }));
    absenden(wert);
  }

  // Bereich des Diagramms: das 5-Fache der letzten Post-Money-Bewertung, bei großem Szenario darüber, höchstens das 100-Fache (Grenze der API).
  const bereichBis =
    post === null || post <= 0 ? null : String(Math.min(Math.floor(post * 100), Math.round(Math.max(post * 5, ergebnis ? Number(ergebnis.eingabe.nettoErloes) * 1.25 : 0))));
  const kurve = useQuery({ ...wasserfallKurve(beteiligungId, bereichBis ?? "1", PUNKTE, ergebnis?.eingabe.exitdatum ?? exitdatum), enabled: bereichBis !== null });

  const inhaber = (z: Zeile) =>
    z.halter.art === "stamm"
      ? t.kapital.stamm
      : z.mitarbeiter
        ? `${z.halter.name} · ${aufzaehlung(t.mitarbeiter.kategorie, z.mitarbeiter.kategorie)}`
        : z.halter.vehikel && z.halter.vehikel.name !== z.halter.name
          ? `${z.halter.vehikel.name} · ${z.halter.name}`
          : (t.kapital.halter[z.halter.art]?.(z.halter.name) ?? z.halter.name);
  const entscheidung = (x: Parameters<typeof entscheidungsSchluessel>[0]) => w.entscheidung[entscheidungsSchluessel(x)];
  const mult = (m: string | null) => (m === null ? t.gemeinsam.keinWert : formatMultiple(m, sprache));

  const zeilenSpalten: TabelleSpalte<Zeile>[] = [
    {
      schluessel: "inhaber",
      kopf: w.spalten.inhaber,
      zelle: (z) => (
        <span className="app-zusammenhang">
          {inhaber(z)}
          {z.diesesFonds ? <Status>{t.kapital.diesesFonds}</Status> : null}
        </span>
      ),
    },
    {
      schluessel: "klasse",
      kopf: w.spalten.klasse,
      zelle: (z) => (z.mitarbeiter ? w.mitarbeiterKlasse(aufzaehlung(t.mitarbeiter.art, z.mitarbeiter.art), formatPreis(z.mitarbeiter.basispreis, sprache)) : (z.klasseName ?? t.kapital.stammanteile)),
    },
    { schluessel: "anteile", kopf: w.spalten.anteile, zahl: true, zelle: (z) => formatAnzahl(z.anteile, sprache) },
    { schluessel: "investiert", kopf: w.spalten.investiert, zahl: true, zelle: (z) => (Number(z.investiert) > 0 ? formatBetragCent(z.investiert, sprache) : t.gemeinsam.keinWert) },
    { schluessel: "praeferenz", kopf: w.spalten.praeferenz, zahl: true, zelle: (z) => formatBetragCent(z.praeferenz, sprache) },
    { schluessel: "beteiligung", kopf: w.spalten.beteiligung, zahl: true, zelle: (z) => formatBetragCent(z.beteiligung, sprache) },
    { schluessel: "gesamt", kopf: w.spalten.gesamt, zahl: true, zelle: (z) => formatBetragCent(z.gesamt, sprache) },
    { schluessel: "multiple", kopf: w.spalten.multiple, zahl: true, zelle: (z) => mult(z.multiple) },
    { schluessel: "entscheidung", kopf: w.spalten.entscheidung, zelle: (z) => (z.mitarbeiter ? (z.mitarbeiter.imGeld ? w.entscheidung.im_geld : w.entscheidung.aus_dem_geld) : entscheidung(z)) },
  ];
  const inhaberSpalten: TabelleSpalte<InhaberZeile>[] = [
    {
      schluessel: "inhaber",
      kopf: w.spalten.inhaber,
      zelle: (x) => (
        <span className="app-zusammenhang">
          {x.halter.art === "stamm" ? t.kapital.stamm : (t.kapital.halter[x.halter.art]?.(x.halter.name) ?? x.halter.name)}
          {x.vehikel.length > 0 ? <span className="app-dubletten__info">{t.kapital.vehikelAnzahl(x.vehikel.length)}</span> : null}
          {x.diesesFonds ? <Status>{t.kapital.diesesFonds}</Status> : null}
        </span>
      ),
    },
    { schluessel: "positionen", kopf: w.spalten.positionen, zahl: true, zelle: (x) => (x.positionen > 0 ? x.positionen : t.gemeinsam.keinWert) },
    { schluessel: "anteile", kopf: w.spalten.anteile, zahl: true, zelle: (x) => formatAnzahl(x.anteile, sprache) },
    { schluessel: "investiert", kopf: w.spalten.investiert, zahl: true, zelle: (x) => (Number(x.investiert) > 0 ? formatBetragCent(x.investiert, sprache) : t.gemeinsam.keinWert) },
    { schluessel: "praeferenz", kopf: w.spalten.praeferenz, zahl: true, zelle: (x) => formatBetragCent(x.praeferenz, sprache) },
    { schluessel: "beteiligung", kopf: w.spalten.beteiligung, zahl: true, zelle: (x) => formatBetragCent(x.beteiligung, sprache) },
    { schluessel: "gesamt", kopf: w.spalten.gesamt, zahl: true, zelle: (x) => formatBetragCent(x.gesamt, sprache) },
    { schluessel: "multiple", kopf: w.spalten.multiple, zahl: true, zelle: (x) => mult(x.multiple) },
  ];
  const klassenSpalten: TabelleSpalte<KlassenZeile>[] = [
    { schluessel: "klasse", kopf: w.spalten.klasse, zelle: (k) => (k.art === "mitarbeiter" ? w.mitarbeiterGruppe : (k.name ?? t.kapital.stammanteile)) },
    { schluessel: "anteile", kopf: w.spalten.anteile, zahl: true, zelle: (k) => formatAnzahl(k.anteile, sprache) },
    { schluessel: "investiert", kopf: w.spalten.investiert, zahl: true, zelle: (k) => (Number(k.investiert) > 0 ? formatBetragCent(k.investiert, sprache) : t.gemeinsam.keinWert) },
    { schluessel: "praeferenz", kopf: w.spalten.praeferenz, zahl: true, zelle: (k) => formatBetragCent(k.praeferenz, sprache) },
    { schluessel: "beteiligung", kopf: w.spalten.beteiligung, zahl: true, zelle: (k) => formatBetragCent(k.beteiligung, sprache) },
    { schluessel: "gesamt", kopf: w.spalten.gesamt, zahl: true, zelle: (k) => formatBetragCent(k.gesamt, sprache) },
    { schluessel: "multiple", kopf: w.spalten.multiple, zahl: true, zelle: (k) => mult(k.multiple) },
    { schluessel: "entscheidung", kopf: w.spalten.entscheidung, zelle: (k) => (k.art === "mitarbeiter" ? t.gemeinsam.keinWert : entscheidung(k)) },
  ];

  const ereignisText = (knick: Kurve["knicke"][number]) =>
    knick.ereignisse
      .map((e) => {
        const name = e.klasseName ?? "";
        switch (e.art) {
          case "praeferenz_voll":
            return w.ereignis.praeferenz_voll(e.rang);
          case "beteiligung_beginn":
            return w.ereignis.beteiligung_beginn();
          case "umwandlung":
            return w.ereignis.umwandlung(name);
          case "deckel":
            return w.ereignis.deckel(name);
          case "im_geld":
            return w.ereignis.im_geld();
          default:
            return w.ereignis.sonstige();
        }
      })
      .join("; ");

  return (
    <>
      <section className="app-karte" aria-labelledby="exit-titel">
        <h2 id="exit-titel" className="cw-t-untertitel app-karte__titel">
          {w.titel}
        </h2>
        <p className="app-leer-text">{w.beschreibung}</p>
        <form
          className="app-formular"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!pruefeAlle()) return;
            absenden();
          }}
        >
          <FehlerHinweis fehler={rechnen.error} bekannt={FELDER} />
          <div className="app-berichte__auswahl">
            <BetragFeld label={w.exitwert} {...feld("exitwert", feldText(t, rechnen.error, "exitwert"))} />
            <Feld label={w.exitdatum} type="date" {...feld("exitdatum", feldText(t, rechnen.error, "exitdatum"))} />
            <BetragFeld label={w.kosten} {...feld("kosten", feldText(t, rechnen.error, "kosten"))} />
            <BetragFeld label={w.treuhand} {...feld("treuhand", feldText(t, rechnen.error, "treuhandAnteil"))} />
          </div>
          {post !== null ? (
            <div className="app-gruppe" role="group" aria-label={w.presets}>
              <span className="cw-feld__label">{w.presets}</span>
              <div className="app-aktionen__knoepfe">
                {FAKTOREN.map((f) => (
                  <Button key={f} variante="sekundaer" disabled={rechnen.isPending} onClick={() => schnellwahl(f)}>
                    {w.preset(formatAnzahl(f, sprache))}
                  </Button>
                ))}
              </div>
              <span className="cw-feld__hilfe">{w.presetHinweis(formatBetrag(post, sprache))}</span>
            </div>
          ) : null}
          <div>
            <Button type="submit" disabled={rechnen.isPending}>
              {w.berechnen}
            </Button>
          </div>
        </form>

        {!ergebnis ? (
          <p className="app-leer-text">{w.noch}</p>
        ) : (
          <div aria-live="polite">
            <h3 className="app-gruppen-titel">{w.ergebnis.titel}</h3>
            <div className="app-kennzahlen">
              <Kennzahl titel={w.ergebnis.rueckfluss} wert={formatBetrag(ergebnis.fonds.gesamt, sprache)} hervorgehoben />
              <Kennzahl titel={w.ergebnis.multiple} wert={mult(ergebnis.fonds.multiple)} />
              <Kennzahl titel={w.ergebnis.netto} wert={formatBetrag(ergebnis.eingabe.nettoErloes, sprache)} />
              {Number(ergebnis.fonds.treuhand) > 0 ? (
                <>
                  <Kennzahl titel={w.ergebnis.sofort} wert={formatBetrag(ergebnis.fonds.sofort, sprache)} />
                  <Kennzahl titel={w.ergebnis.treuhand} wert={formatBetrag(ergebnis.fonds.treuhand, sprache)} />
                </>
              ) : null}
            </div>
            {ergebnis.mitarbeiter ? (
              <p className="app-leer-text">
                {w.mitarbeiterHinweis(formatAnzahl(ergebnis.mitarbeiter.einheiten, sprache), formatAnzahl(ergebnis.mitarbeiter.imGeld, sprache), formatBetragCent(ergebnis.mitarbeiter.gesamt, sprache))}
                {ergebnis.minderungsfaktor ? ` ${w.minderung(ergebnis.minderungsfaktor)}` : null}
              </p>
            ) : null}
            {Number(ergebnis.nichtVerteilt) > 0 ? <Hinweis>{w.ergebnis.nichtVerteilt(formatBetragCent(ergebnis.nichtVerteilt, sprache))}</Hinweis> : null}
            {ergebnis.inhaber.length < ergebnis.zeilen.length ? (
              <Segment<"position" | "investor">
                aria-label={w.ansicht}
                value={ansicht}
                onChange={setAnsicht}
                options={[
                  { wert: "position", label: w.jePosition },
                  { wert: "investor", label: w.jeInvestor },
                ]}
              />
            ) : null}
            {ansicht === "investor" && ergebnis.inhaber.length < ergebnis.zeilen.length ? (
              <Tabelle beschriftung={w.tabelleInvestor} spalten={inhaberSpalten} zeilen={ergebnis.inhaber} zeilenSchluessel={(x) => `${x.halter.art}:${x.halter.id ?? ""}`} ausgewaehlt={(x) => x.diesesFonds} />
            ) : (
              <Tabelle beschriftung={w.tabelle} spalten={zeilenSpalten} zeilen={ergebnis.zeilen} zeilenSchluessel={(z) => z.id} ausgewaehlt={(z) => z.diesesFonds} />
            )}
            <Tabelle beschriftung={w.klassenTabelle} spalten={klassenSpalten} zeilen={ergebnis.klassen} zeilenSchluessel={(k) => k.id ?? k.art} />
          </div>
        )}
      </section>

      {ergebnis ? (
        <section className="app-karte" aria-labelledby="herkunft-wasserfall-titel">
          <h2 id="herkunft-wasserfall-titel" className="cw-t-untertitel app-karte__titel">
            {w.herkunft}
          </h2>
          <p className="app-leer-text">{w.herkunftBeschreibung}</p>
          <Rechenweg titel={w.herkunft} stichtag={ergebnis.eingabe.exitdatum} schritte={ergebnis.schritte} />
        </section>
      ) : null}

      {kurve.error ? <FehlerHinweis fehler={kurve.error} /> : null}
      {kurve.data ? (
        <WasserfallDiagramm kurve={kurve.data} szenario={ergebnis ? { exitwert: ergebnis.eingabe.nettoErloes, rueckfluss: ergebnis.fonds.gesamt } : null} ereignisText={ereignisText} />
      ) : kurve.isPending && bereichBis !== null ? (
        <p className="app-leer-text">{w.diagramm.laden}</p>
      ) : null}
    </>
  );
}
