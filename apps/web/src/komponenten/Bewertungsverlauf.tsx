import { useState, type CSSProperties } from "react";
import { Markdown, Segment, Tabelle, formatBetrag, formatDatum, type TabelleSpalte } from "@carraway/ui";
import type { BeteiligungDetail } from "../api/abfragen";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { formatMio } from "../lib/zahl";

type Bewertung = BeteiligungDetail["bewertungsverlauf"][number];
type Ansicht = "diagramm" | "tabelle";

/** `2026-09-30` wird zu `09/26`: kurz genug für eine Säule. */
const kurzesDatum = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(2, 4)}`;

/**
 * Bewertungsverlauf als Säulendiagramm aus Tokens (keine Diagrammbibliothek): Die jüngste Säule steht im Akzent (chart-2), die übrigen neutral.
 * Das Diagramm hat eine Textfassung (`aria-label`) und lässt sich in eine Tabelle umschalten, die dieselben Werte nennt.
 */
export function Bewertungsverlauf({ reihe }: { reihe: Bewertung[] }) {
  const t = useT();
  const sprache = useSprache();
  const [ansicht, setAnsicht] = useState<Ansicht>("diagramm");
  const v = t.beteiligung.verlauf;
  const hoechster = Math.max(0, ...reihe.map((w) => Number(w.wert)));
  const nachkomma = hoechster >= 1_000_000 ? 1 : 2;
  const mio = (wert: string) => formatMio(wert, sprache, nachkomma);

  const erste = reihe[0];
  const letzte = reihe.at(-1);
  const alternative =
    erste && letzte ? v.alternative(reihe.length, formatDatum(erste.stichtag, sprache), formatBetrag(erste.wert, sprache), formatDatum(letzte.stichtag, sprache), formatBetrag(letzte.wert, sprache)) : "";

  const spalten: TabelleSpalte<Bewertung>[] = [
    { schluessel: "stichtag", kopf: v.spalten.stichtag, zelle: (w) => formatDatum(w.stichtag, sprache) },
    { schluessel: "wert", kopf: v.spalten.wert, zahl: true, zelle: (w) => formatBetrag(w.wert, sprache) },
    { schluessel: "methode", kopf: v.spalten.methode, zelle: (w) => aufzaehlung(t.bewertungMethode, w.methode) },
    { schluessel: "begruendung", kopf: v.spalten.begruendung, umbruch: true, zelle: (w) => (w.begruendung ? <Markdown text={w.begruendung} /> : t.gemeinsam.keinWert) },
  ];

  return (
    <section className="app-karte">
      <div className="app-karte__kopf">
        <h2 className="cw-t-untertitel app-karte__titel">
          {v.titel}
        </h2>
        <div className="app-verlauf__steuerung">
          <span className="app-verlauf__einheit">{v.einheit}</span>
          <Segment<Ansicht>
            aria-label={v.darstellung}
            value={ansicht}
            onChange={setAnsicht}
            options={[
              { wert: "diagramm", label: v.diagramm },
              { wert: "tabelle", label: v.tabelle },
            ]}
          />
        </div>
      </div>
      <div className="app-verlauf">
        {reihe.length === 0 ? (
          <p className="app-leer-text">{v.keine}</p>
        ) : ansicht === "tabelle" ? (
          <Tabelle beschriftung={v.titel} spalten={spalten} zeilen={reihe} zeilenSchluessel={(w) => w.stichtag} />
        ) : (
          <div className="app-verlauf__huelle" role="region" aria-label={v.titel} tabIndex={0}>
            <div className="app-verlauf__diagramm" role="img" aria-label={alternative} style={{ "--saeulen": reihe.length } as CSSProperties}>
              {reihe.map((w, i) => (
                <div key={w.stichtag} className="app-verlauf__saeule">
                  <span className={i === reihe.length - 1 ? "app-verlauf__wert app-verlauf__wert--aktuell" : "app-verlauf__wert"}>{mio(w.wert)}</span>
                  <div
                    className={i === reihe.length - 1 ? "app-verlauf__balken app-verlauf__balken--aktuell" : "app-verlauf__balken"}
                    style={{ "--anteil": hoechster > 0 ? Number(w.wert) / hoechster : 0 } as CSSProperties}
                  />
                </div>
              ))}
            </div>
            <div className="app-verlauf__achse" aria-hidden="true" style={{ "--saeulen": reihe.length } as CSSProperties}>
              {reihe.map((w) => (
                <span key={w.stichtag}>{kurzesDatum(w.stichtag)}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
