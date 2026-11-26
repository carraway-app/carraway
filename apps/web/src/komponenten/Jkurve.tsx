import { useState } from "react";
import { Segment, Tabelle, formatMultiple, type TabelleSpalte } from "@carraway/ui";
import type { SzenarienVergleich } from "../api/szenarien";
import { useSprache, useT } from "../i18n";

type Ansicht = "diagramm" | "tabelle";
type Zeile = SzenarienVergleich["vergleich"]["jkurve"][number];

const B = 640;
const H = 260;
const RAND = { links: 48, rechts: 20, oben: 16, unten: 36 };

/**
 * J-Kurve: TVPI netto je Jahr für bis zu drei Szenarien als Liniendiagramm aus Tokens (reines SVG). Die Serien unterscheiden sich
 * durch Strichart und Farbe, nicht nur durch Farbe. Das Diagramm hat eine Textfassung und lässt sich in eine Tabelle mit denselben
 * Werten umschalten. Die Werte kommen fertig gerechnet von der API; hier wird nur gezeichnet.
 */
export function Jkurve({ namen, zeilen }: { namen: string[]; zeilen: Zeile[] }) {
  const t = useT();
  const j = t.szenarien.vergleich.jkurve;
  const sprache = useSprache();
  const [ansicht, setAnsicht] = useState<Ansicht>("diagramm");

  const werte = zeilen.flatMap((z) => z.werte.map((w) => (w.tvpi === null ? null : Number(w.tvpi)))).filter((x): x is number => x !== null);
  const yMax = Math.max(1, ...werte) * 1.05;
  const yMin = Math.min(0, ...werte);
  const jahre = zeilen.map((z) => z.jahr);
  const xMin = Math.min(...jahre);
  const xMax = Math.max(...jahre);
  const breite = B - RAND.links - RAND.rechts;
  const hoehe = H - RAND.oben - RAND.unten;
  const x = (jahr: number) => RAND.links + (xMax === xMin ? 0 : ((jahr - xMin) / (xMax - xMin)) * breite);
  const y = (wert: number) => RAND.oben + hoehe - ((wert - yMin) / (yMax - yMin)) * hoehe;
  const pfade = namen.map((_n, i) => {
    const punkte = zeilen.filter((z) => z.werte[i]?.tvpi != null).map((z) => `${x(z.jahr).toFixed(1)} ${y(Number(z.werte[i]!.tvpi)).toFixed(1)}`);
    return punkte.length ? `M${punkte.join(" L")}` : "";
  });
  const teilungen = Array.from({ length: 5 }, (_, i) => yMin + ((yMax - yMin) * i) / 4);
  const tief = werte.length ? Math.min(...werte) : 0;
  const alternative = j.alternative(namen.length, zeilen.length, formatMultiple(tief.toFixed(4), sprache));

  const spalten: TabelleSpalte<Zeile>[] = [
    { schluessel: "jahr", kopf: j.jahr, zelle: (z) => String(z.jahr) },
    ...namen.map((name, i) => ({ schluessel: `s${i}`, kopf: name, zahl: true, zelle: (z: Zeile) => (z.werte[i]?.tvpi == null ? t.gemeinsam.keinWert : formatMultiple(z.werte[i]!.tvpi!, sprache)) })),
  ];

  return (
    <section className="app-karte" aria-labelledby="jkurve-titel">
      <div className="app-karte__kopf">
        <h3 id="jkurve-titel" className="cw-t-untertitel app-karte__titel">
          {j.titel}
        </h3>
        <Segment<Ansicht>
          aria-label={j.darstellung}
          value={ansicht}
          onChange={setAnsicht}
          options={[
            { wert: "diagramm", label: j.diagramm },
            { wert: "tabelle", label: j.tabelle },
          ]}
        />
      </div>
      <p className="app-leer-text">{j.beschreibung}</p>
      {ansicht === "tabelle" ? (
        <Tabelle beschriftung={`${j.titel} · ${j.tabelle}`} spalten={spalten} zeilen={zeilen} zeilenSchluessel={(z) => z.jahr} />
      ) : (
        <div className="app-kurve">
          <svg className="app-kurve__svg" viewBox={`0 0 ${B} ${H}`} role="img" aria-label={alternative} preserveAspectRatio="xMidYMid meet">
            {teilungen.map((wert) => (
              <g key={wert} aria-hidden="true">
                <line className="app-kurve__raster" x1={RAND.links} x2={B - RAND.rechts} y1={y(wert)} y2={y(wert)} />
                <text className="app-kurve__text" x={RAND.links - 8} y={y(wert) + 4} textAnchor="end">
                  {formatMultiple(wert.toFixed(4), sprache)}
                </text>
              </g>
            ))}
            {zeilen.map((z, i) => (
              <text key={z.jahr} className="app-kurve__text" x={x(z.jahr)} y={H - RAND.unten + 18} textAnchor={i === 0 ? "start" : i === zeilen.length - 1 ? "end" : "middle"} aria-hidden="true">
                {i % Math.ceil(zeilen.length / 6) === 0 || i === zeilen.length - 1 ? z.jahr : ""}
              </text>
            ))}
            <line className="app-kurve__achse" x1={RAND.links} x2={B - RAND.rechts} y1={y(1)} y2={y(1)} aria-hidden="true" strokeDasharray="2 3" />
            {pfade.map((d, i) => (
              <path key={namen[i]} className={`app-jkurve__serie app-jkurve__serie--${i + 1}`} d={d} fill="none" />
            ))}
          </svg>
          <ul className="app-jkurve__legende">
            {namen.map((name, i) => (
              <li key={name}>
                <svg width="28" height="8" aria-hidden="true">
                  <line className={`app-jkurve__serie app-jkurve__serie--${i + 1}`} x1="0" x2="28" y1="4" y2="4" />
                </svg>{" "}
                {name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
