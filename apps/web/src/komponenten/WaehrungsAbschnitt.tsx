import { WaehrungAuswahl } from "./WaehrungAuswahl";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Hinweis, Tabelle, formatBetrag, formatDatum, type TabelleSpalte } from "@carraway/ui";
import { beteiligungWaehrungssicht, useLokaleWaehrung, type Beteiligungssicht } from "../api/waehrung";
import { useSprache, useT } from "../i18n";
import { useRechte } from "../lib/rechte";
import { betragDerSicht } from "../lib/waehrung";
import { FehlerHinweis } from "./FehlerHinweis";
import { formatKurs } from "./Waehrungsleiste";

type Zeile = Beteiligungssicht["bewertungen"][number];

/**
 * Reiter „Währung“ der Bewertung: die lokale Währung der Beteiligung festlegen und die Bewertungen in den drei Sichten mit Kurs und Datum nebeneinander,
 * dazu die Zerlegung der Änderung des Fondswerts in Wertänderung und Währungseffekt. Fehlt ein Kurs, steht dort „Kurs fehlt“, nie eine geschätzte Zahl.
 */
export function WaehrungsAbschnitt({ beteiligungId, fondsId, stichtag, stand, vergleich, lesend }: { beteiligungId: string; fondsId: string; stichtag: string; stand: string | undefined; vergleich: string | undefined; lesend: boolean }) {
  const t = useT();
  const w = t.waehrung;
  const sprache = useSprache();
  const { darf } = useRechte();
  const { data, error } = useQuery(beteiligungWaehrungssicht(beteiligungId, { stichtag, stand, vergleich }));
  const setzen = useLokaleWaehrung(beteiligungId);
  const [entwurf, setEntwurf] = useState<string | null>(null);
  if (error) return <FehlerHinweis fehler={error} />;
  if (!data) return <p aria-busy="true">{t.gemeinsam.laedt}</p>;
  const wr = data.waehrungen;
  const betrag = (zeile: Zeile, art: "fonds" | "lokal" | "vergleich" | "haus") => {
    const x = betragDerSicht(zeile.wert, art, wr);
    return x.wert === null ? <span className="app-luecke" title={w.lueckeTitel}>{w.luecke}</span> : formatBetrag(x.wert, sprache, { waehrung: x.waehrung });
  };
  const spalten: TabelleSpalte<Zeile>[] = [
    { schluessel: "stichtag", kopf: w.spalten.stichtag, zelle: (z) => <span className="app-zahl">{formatDatum(z.stichtag, sprache)}</span> },
    { schluessel: "fonds", kopf: `${w.spalten.fonds} (${wr.fonds})`, zahl: true, zelle: (z) => betrag(z, "fonds") },
    { schluessel: "lokal", kopf: `${w.spalten.lokal} (${wr.lokal})`, zahl: true, zelle: (z) => betrag(z, "lokal") },
    ...(wr.vergleich ? [{ schluessel: "vergleich", kopf: `${w.spalten.vergleich} (${wr.vergleich})`, zahl: true, zelle: (z: Zeile) => betrag(z, "vergleich") }] : []),
    ...(wr.haus !== wr.fonds && wr.haus !== wr.lokal ? [{ schluessel: "haus", kopf: `${w.spalten.haus} (${wr.haus})`, zahl: true, zelle: (z: Zeile) => betrag(z, "haus") }] : []),
    {
      schluessel: "kurs",
      kopf: w.spalten.kurs,
      zelle: (z) =>
        z.gebuchterKurs ? (
          <span className="app-zahl" title={w.kursTabelle}>
            {w.gebuchterKurs(formatKurs(z.gebuchterKurs, sprache))}
          </span>
        ) : z.kurse.length > 0 ? (
          <span className="app-zahl">{z.kurse.map((k) => `${k.von}/${k.nach} ${formatKurs(k.kurs, sprache)} (${formatDatum(k.kursDatum, sprache)})`).join("; ")}</span>
        ) : (
          t.gemeinsam.keinWert
        ),
    },
    ...(wr.lokal !== wr.fonds
      ? [
          { schluessel: "aenderung", kopf: w.spalten.aenderung, zahl: true, zelle: (z: Zeile) => (z.fx ? formatBetrag(z.fx.gesamt, sprache, { waehrung: wr.fonds }) : t.gemeinsam.keinWert) },
          { schluessel: "davonWert", kopf: w.spalten.davonWert, zahl: true, zelle: (z: Zeile) => (z.fx ? formatBetrag(z.fx.wert, sprache, { waehrung: wr.fonds }) : t.gemeinsam.keinWert) },
          { schluessel: "davonWaehrung", kopf: w.spalten.davonWaehrung, zahl: true, zelle: (z: Zeile) => (z.fx ? formatBetrag(z.fx.waehrung, sprache, { waehrung: wr.fonds }) : t.gemeinsam.keinWert) },
        ]
      : []),
  ];
  const darfSetzen = darf("bearbeiter", fondsId, "portfolio") && !lesend;
  const aktuell = wr.lokal === wr.fonds ? "" : wr.lokal;
  const wert = entwurf ?? aktuell;

  return (
    <section className="app-karte" aria-label={w.tab}>
      <div className="app-gruppe">
        <p className="app-leer-text">{w.waehrungen(wr.fonds, wr.lokal)}</p>
        {darfSetzen ? (
          <form
            className="app-fed__fuss"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              setzen.mutate(wert.trim() === "" ? null : wert.trim().toUpperCase(), { onSuccess: () => setEntwurf(null) });
            }}
          >
            <WaehrungAuswahl label={w.lokaleWaehrung} hilfe={w.lokaleWaehrungHilfe} value={wert} leer={w.lokaleWaehrungWieFonds(wr.fonds)} onChange={(e) => setEntwurf(e.target.value)} />
            <Button type="submit" variante="sekundaer" disabled={setzen.isPending || wert === aktuell}>
              {w.lokaleWaehrungSetzen}
            </Button>
          </form>
        ) : null}
        <FehlerHinweis fehler={setzen.error} />
      </div>
      {data.bewertungen.length === 0 ? (
        <p className="app-leer-text">{w.keineBewertung}</p>
      ) : (
        <>
          <Tabelle dicht beschriftung={w.tabelle} spalten={spalten} zeilen={data.bewertungen} zeilenSchluessel={(z) => z.stichtag} />
          {wr.lokal !== wr.fonds ? <Hinweis>{w.fxHilfe}</Hinweis> : null}
        </>
      )}
    </section>
  );
}
