import { useState } from "react";
import { Segment, Tabelle, formatBetrag, formatMultiple, type TabelleSpalte } from "@carraway/ui";
import type { Kurve } from "../api/abfragen";
import { useSprache, useT } from "../i18n";
import { formatMio } from "../lib/zahl";

type Ansicht = "diagramm" | "tabelle";
type Punkt = Kurve["punkte"][number];
type Knick = Kurve["knicke"][number];

const B = 640;
const H = 280;
const RAND = { links: 64, rechts: 20, oben: 16, unten: 40 };
const TEILUNGEN = 4;

/**
 * Rückfluss des Fonds über den Exitwert als Liniendiagramm aus Tokens (reines SVG, keine Diagrammbibliothek). Die Linie läuft durch
 * die gleichmäßigen Punkte und die Knickpunkte der API, dazwischen ist der Rückfluss linear. Das gewählte Szenario ist markiert.
 * Das Diagramm hat eine Textfassung und lässt sich in Tabellen umschalten, die dieselben Werte nennen.
 */
export function WasserfallDiagramm({ kurve, szenario, ereignisText }: { kurve: Kurve; szenario: { exitwert: string; rueckfluss: string } | null; ereignisText: (knick: Knick) => string }) {
  const t = useT();
  const d = t.wasserfall.diagramm;
  const sprache = useSprache();
  const [ansicht, setAnsicht] = useState<Ansicht>("diagramm");

  const punkte: Punkt[] = [...kurve.punkte, ...kurve.knicke.map((k) => ({ exitwert: k.exitwert, rueckfluss: k.rueckfluss, multiple: k.multiple }))].sort((a, b) => Number(a.exitwert) - Number(b.exitwert));
  const bis = Number(kurve.bis);
  const hoechster = Math.max(0, ...punkte.map((p) => Number(p.rueckfluss)), szenario ? Number(szenario.rueckfluss) : 0);
  const yMax = hoechster > 0 ? hoechster : 1;
  const breite = B - RAND.links - RAND.rechts;
  const hoehe = H - RAND.oben - RAND.unten;
  const x = (wert: number) => RAND.links + (bis > 0 ? Math.min(1, wert / bis) : 0) * breite;
  const y = (wert: number) => RAND.oben + hoehe - (wert / yMax) * hoehe;
  const pfad = punkte.map((p, i) => `${i === 0 ? "M" : "L"}${x(Number(p.exitwert)).toFixed(1)} ${y(Number(p.rueckfluss)).toFixed(1)}`).join(" ");
  const nachkomma = bis >= 1_000_000 ? 1 : 2;
  const teilungen = Array.from({ length: TEILUNGEN + 1 }, (_, i) => i / TEILUNGEN);
  const hoechsterText = formatBetrag(hoechster.toFixed(2), sprache);
  const alternative = d.alternative(punkte.length, formatBetrag(kurve.bis, sprache), hoechsterText);

  const punktSpalten: TabelleSpalte<Punkt>[] = [
    { schluessel: "exitwert", kopf: d.spalten.exitwert, zahl: true, zelle: (p) => formatBetrag(p.exitwert, sprache) },
    { schluessel: "rueckfluss", kopf: d.spalten.rueckfluss, zahl: true, zelle: (p) => formatBetrag(p.rueckfluss, sprache) },
    { schluessel: "multiple", kopf: d.spalten.multiple, zahl: true, zelle: (p) => (p.multiple === null ? t.gemeinsam.keinWert : formatMultiple(p.multiple, sprache)) },
  ];
  const knickSpalten: TabelleSpalte<Knick>[] = [
    ...(punktSpalten as unknown as TabelleSpalte<Knick>[]),
    { schluessel: "ereignis", kopf: d.spalten.ereignis, zelle: (k) => ereignisText(k) },
  ];

  return (
    <section className="app-karte" aria-labelledby="kurve-titel">
      <div className="app-karte__kopf">
        <h2 id="kurve-titel" className="cw-t-untertitel app-karte__titel">
          {d.titel}
        </h2>
        <div className="app-verlauf__steuerung">
          <span className="app-verlauf__einheit">{d.einheit}</span>
          <Segment<Ansicht>
            aria-label={d.darstellung}
            value={ansicht}
            onChange={setAnsicht}
            options={[
              { wert: "diagramm", label: d.diagramm },
              { wert: "tabelle", label: d.tabelle },
            ]}
          />
        </div>
      </div>
      <p className="app-leer-text">{d.beschreibung}</p>
      {ansicht === "tabelle" ? (
        <>
          <h3 className="app-gruppen-titel">{d.knickeTitel}</h3>
          {kurve.knicke.length === 0 ? <p className="app-leer-text">{t.gemeinsam.keinWert}</p> : <Tabelle beschriftung={d.knickeTitel} spalten={knickSpalten} zeilen={kurve.knicke} zeilenSchluessel={(k) => `${k.exitwert}-${k.ereignisse.map((e) => e.art).join("")}`} />}
          <h3 className="app-gruppen-titel">{d.tabelleTitel}</h3>
          <Tabelle beschriftung={d.tabelleTitel} spalten={punktSpalten} zeilen={kurve.punkte} zeilenSchluessel={(p) => p.exitwert} />
        </>
      ) : (
        <div className="app-kurve">
          <svg className="app-kurve__svg" viewBox={`0 0 ${B} ${H}`} role="img" aria-label={alternative} preserveAspectRatio="xMidYMid meet">
            {teilungen.map((anteil) => (
              <g key={anteil} aria-hidden="true">
                <line className="app-kurve__raster" x1={RAND.links} x2={B - RAND.rechts} y1={y(yMax * anteil)} y2={y(yMax * anteil)} />
                <text className="app-kurve__text" x={RAND.links - 8} y={y(yMax * anteil) + 4} textAnchor="end">
                  {formatMio((yMax * anteil).toFixed(2), sprache, yMax >= 1_000_000 ? 1 : 2)}
                </text>
                <text className="app-kurve__text" x={x(bis * anteil)} y={H - RAND.unten + 18} textAnchor={anteil === 0 ? "start" : anteil === 1 ? "end" : "middle"}>
                  {formatMio((bis * anteil).toFixed(2), sprache, nachkomma)}
                </text>
              </g>
            ))}
            <line className="app-kurve__achse" x1={RAND.links} x2={B - RAND.rechts} y1={RAND.oben + hoehe} y2={RAND.oben + hoehe} aria-hidden="true" />
            <path className="app-kurve__linie" d={pfad} fill="none" />
            {kurve.knicke.map((k) => (
              <circle key={`${k.exitwert}-${k.ereignisse.map((e) => e.art).join("")}`} className="app-kurve__knick" cx={x(Number(k.exitwert))} cy={y(Number(k.rueckfluss))} r={3.5}>
                <title>{`${formatBetrag(k.exitwert, sprache)}: ${ereignisText(k)}`}</title>
              </circle>
            ))}
            {szenario && Number(szenario.exitwert) <= bis ? (
              <g>
                <line className="app-kurve__szenario" x1={x(Number(szenario.exitwert))} x2={x(Number(szenario.exitwert))} y1={RAND.oben} y2={RAND.oben + hoehe} />
                <circle className="app-kurve__szenario-punkt" cx={x(Number(szenario.exitwert))} cy={y(Number(szenario.rueckfluss))} r={5}>
                  <title>{d.szenario(formatBetrag(szenario.exitwert, sprache))}</title>
                </circle>
              </g>
            ) : null}
            <text className="app-kurve__text" x={B - RAND.rechts} y={H - 4} textAnchor="end" aria-hidden="true">
              {d.achseX}
            </text>
            <text className="app-kurve__text" x={RAND.links} y={10} aria-hidden="true">
              {d.achseY}
            </text>
          </svg>
        </div>
      )}
    </section>
  );
}
