import "./Dashboard.css";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Hinweis, Kennzahl, KennzahlenReihe, Leer, Segment, Seitenkopf, Tabelle, formatBetrag, formatDatum, formatMultiple, formatProzent, type TabelleSpalte } from "@carraway/ui";
import { alsRechenschritte, portfolioDashboard, type ApiKennzahl, type Dashboard } from "../api/portfolio";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { HerkunftDialog } from "../komponenten/HerkunftDialog";
import { Skelettzeilen } from "../komponenten/Skelett";
import { StichtagMenue } from "../komponenten/StichtagMenue";
import { useSprache, useT } from "../i18n";

const route = getRouteApi("/portfolio");

type Merkmal = "sector" | "country" | "stage" | "fund";
type Groesse = "fairValue" | "invested";
type Ansicht = "diagramm" | "tabelle";
type Gruppe = Dashboard["allocation"]["sector"][number];
type KennzahlSchluessel = "nav" | "paidIn" | "distributions" | "tvpi" | "dpi" | "rvpi";

/**
 * Portfolio-Dashboard (fondsübergreifend): Kennzahlen ohne Doppelzählung, Allokation nach Sektor, Land, Phase und Fonds und der Verlauf von NAV und
 * Portfoliowert, alles in der Hauswährung. Diagramme nach den Regeln der App: reines SVG aus Tokens, eine hervorgehobene Reihe, Tabelle mit denselben Werten
 * und Textfassung. Gerechnet wird nur auf dem Server.
 */
export function PortfolioDashboardSeite() {
  const t = useT();
  const d = t.waehrung.dashboard;
  const sprache = useSprache();
  const suche = route.useSearch();
  const navigate = route.useNavigate();
  const { data, error } = useQuery(portfolioDashboard({ asOf: suche.stichtag, knowledgeDate: suche.stand }));
  const [herkunft, setHerkunft] = useState<{ titel: string; kennzahl: ApiKennzahl } | null>(null);

  const zeitbezug = (
    <StichtagMenue
      fondsId={null}
      stichtag={data?.asOf ?? suche.stichtag ?? ""}
      onStichtag={(neu) => void navigate({ search: (alt) => ({ ...alt, stichtag: neu }), replace: true })}
      stand={suche.stand}
      onStand={(neu) => void navigate({ search: (alt) => ({ ...alt, stand: neu }), replace: true })}
    />
  );
  if (error) return <div className="app-seite"><FehlerHinweis fehler={error} /></div>;
  if (!data) return <div className="app-seite"><Seitenkopf meta={d.etikett} titel={d.titel} zeitbezug={zeitbezug} /><Skelettzeilen anzahl={6} /></div>;

  const haus = data.homeCurrency;
  const betrag = (w: string | null) => (w === null ? t.gemeinsam.keinWert : formatBetrag(w, sprache, { waehrung: haus, kompakt: true }));
  const kennzahlen: { schluessel: KennzahlSchluessel; titel: string; text: (w: string | null) => string }[] = [
    { schluessel: "nav", titel: d.nav, text: betrag },
    { schluessel: "paidIn", titel: d.eingezahlt, text: betrag },
    { schluessel: "distributions", titel: d.ausschuettungen, text: betrag },
    { schluessel: "tvpi", titel: d.tvpi, text: (w) => (w === null ? t.gemeinsam.keinWert : formatMultiple(w, sprache)) },
    { schluessel: "dpi", titel: d.dpi, text: (w) => (w === null ? t.gemeinsam.keinWert : formatMultiple(w, sprache)) },
    { schluessel: "rvpi", titel: d.rvpi, text: (w) => (w === null ? t.gemeinsam.keinWert : formatMultiple(w, sprache)) },
  ];
  const bereinigt = data.internalHoldings.filter((x) => x.eliminated).length;

  return (
    <div className="app-seite app-dashboard">
      <Seitenkopf meta={data.managerName ? `${d.etikett} · ${data.managerName}` : d.etikett} titel={d.titel} zeitbezug={zeitbezug} />
      <p className="app-leer-text app-lesetext">{d.beschreibung(haus)}</p>
      {data.funds.length === 0 ? (
        <Leer titel={d.leer} beschreibung="" />
      ) : (
        <>
          <KennzahlenReihe aria-label={d.kennzahlen}>
            {kennzahlen.map((k) => (
              <Kennzahl
                key={k.schluessel}
                titel={k.titel}
                wert={k.text(data.totals[k.schluessel].value)}
                hervorgehoben={k.schluessel === "nav"}
                onHerkunft={() => setHerkunft({ titel: k.titel, kennzahl: data.totals[k.schluessel] })}
                herkunftLabel={d.herkunft(k.titel)}
              />
            ))}
          </KennzahlenReihe>
          {bereinigt > 0 ? <p className="app-leer-text">{d.bereinigt(bereinigt)}</p> : null}
          {data.gaps.length > 0 ? <Hinweis titel={d.luecken(data.gaps.length)}>{data.gaps.slice(0, 4).map((l) => `${l.from}/${l.to} ${formatDatum(l.date, sprache)}`).join("; ")}</Hinweis> : null}
          <Allokation daten={data} />
          <Verlauf daten={data} />
          <FondsTabelle daten={data} />
        </>
      )}
      {herkunft ? <HerkunftDialog titel={herkunft.titel} stichtag={data.asOf} schritte={alsRechenschritte(herkunft.kennzahl)} onSchliessen={() => setHerkunft(null)} /> : null}
    </div>
  );
}

function DarstellungWahl({ wert, onChange }: { wert: Ansicht; onChange: (a: Ansicht) => void }) {
  const d = useT().waehrung.dashboard;
  return (
    <Segment<Ansicht>
      aria-label={d.darstellung}
      value={wert}
      onChange={onChange}
      options={[
        { wert: "diagramm", label: d.diagramm },
        { wert: "tabelle", label: d.tabelle },
      ]}
    />
  );
}

function Allokation({ daten }: { daten: Dashboard }) {
  const t = useT();
  const d = t.waehrung.dashboard;
  const sprache = useSprache();
  const [merkmal, setMerkmal] = useState<Merkmal>("sector");
  const [groesse, setGroesse] = useState<Groesse>("fairValue");
  const [ansicht, setAnsicht] = useState<Ansicht>("diagramm");
  const gruppen = daten.allocation[merkmal];
  const name = (g: Gruppe) => (g.type === "target_funds" ? d.zielfonds : g.type === "unknown" ? d.ohneAngabe : (g.label ?? g.key ?? d.ohneAngabe));
  const anteilSchluessel = groesse === "fairValue" ? "fairValueShare" : "investedShare";
  const betrag = (w: string | null) => (w === null ? t.gemeinsam.keinWert : formatBetrag(w, sprache, { waehrung: daten.homeCurrency }));
  const spalten: TabelleSpalte<Gruppe>[] = [
    { schluessel: "gruppe", kopf: d.merkmale[merkmal], zelle: name },
    { schluessel: "anzahl", kopf: d.anzahl, zahl: true, zelle: (g) => String(g.count) },
    { schluessel: "investiert", kopf: d.groessen.invested, zahl: true, zelle: (g) => betrag(g.invested) },
    { schluessel: "zeitwert", kopf: d.groessen.fairValue, zahl: true, zelle: (g) => betrag(g.fairValue) },
    { schluessel: "anteil", kopf: `${d.anteil} (${d.groessen[groesse]})`, zahl: true, zelle: (g) => (g[anteilSchluessel] === null ? t.gemeinsam.keinWert : formatProzent(Number(g[anteilSchluessel]) * 100, sprache)) },
  ];
  const groesster = Math.max(0, ...gruppen.map((g) => Number(g[anteilSchluessel] ?? 0)));
  return (
    <section className="app-karte" aria-labelledby="allokation-titel">
      <div className="app-karte__kopf">
        <h2 id="allokation-titel" className="cw-t-untertitel app-karte__titel">{d.allokation}</h2>
        <div className="app-gruppe app-gruppe--zeile">
          <Segment<Merkmal> aria-label={d.merkmal} value={merkmal} onChange={setMerkmal} options={(["sector", "country", "stage", "fund"] as const).map((m) => ({ wert: m, label: d.merkmale[m] }))} />
          <Segment<Groesse> aria-label={d.groesse} value={groesse} onChange={setGroesse} options={(["fairValue", "invested"] as const).map((g) => ({ wert: g, label: d.groessen[g] }))} />
          <DarstellungWahl wert={ansicht} onChange={setAnsicht} />
        </div>
      </div>
      <p className="app-leer-text">{d.allokationBeschreibung}</p>
      {ansicht === "tabelle" ? (
        <Tabelle beschriftung={`${d.allokation} · ${d.merkmale[merkmal]}`} spalten={spalten} zeilen={gruppen} zeilenSchluessel={(g) => `${g.type}:${g.key ?? ""}`} />
      ) : (
        <ul className="app-allokation" aria-label={d.allokationAlternative(d.merkmale[merkmal], gruppen.length)}>
          {gruppen.map((g, i) => {
            const anteil = Number(g[anteilSchluessel] ?? 0);
            return (
              <li key={`${g.type}:${g.key ?? ""}`} className="app-allokation__zeile">
                <span className="app-allokation__name">{name(g)}</span>
                <span className="app-allokation__spur" aria-hidden="true">
                  <span className={`app-allokation__balken${i === 0 && anteil === groesster ? " app-allokation__balken--erster" : ""}`} style={{ width: `${groesster > 0 ? (anteil / groesster) * 100 : 0}%` }} />
                </span>
                <span className="app-zahl app-allokation__wert">
                  {g[anteilSchluessel] === null ? t.gemeinsam.keinWert : formatProzent(anteil * 100, sprache)} · {betrag(groesse === "fairValue" ? g.fairValue : g.invested)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const B = 640;
const H = 260;
const RAND = { links: 64, rechts: 20, oben: 16, unten: 36 };

function Verlauf({ daten }: { daten: Dashboard }) {
  const t = useT();
  const d = t.waehrung.dashboard;
  const sprache = useSprache();
  const [groesse, setGroesse] = useState<"nav" | "portfolioValue">("portfolioValue");
  const [ansicht, setAnsicht] = useState<Ansicht>("diagramm");
  const h = daten.history;
  const label = groesse === "nav" ? d.nav : d.portfoliowert;
  // Reihen: je Fonds (Hauswährung) und die Summe als einzige hervorgehobene Reihe.
  const reihen = [
    ...h.funds.map((f) => ({ name: f.name, werte: f.points.map((p) => p.home[groesse]) })),
    { name: d.gesamt, werte: h.total.map((p) => p[groesse]) },
  ];
  const zahlen = reihen.flatMap((r) => r.werte).filter((w): w is string => w !== null).map(Number);
  const yMax = Math.max(1, ...zahlen) * 1.05;
  const yMin = Math.min(0, ...zahlen);
  const breite = B - RAND.links - RAND.rechts;
  const hoehe = H - RAND.oben - RAND.unten;
  const x = (i: number) => RAND.links + (h.dates.length <= 1 ? 0 : (i / (h.dates.length - 1)) * breite);
  const y = (w: number) => RAND.oben + hoehe - ((w - yMin) / (yMax - yMin)) * hoehe;
  // Lücken unterbrechen die Linie; einzelne Punkte erscheinen als Punkt.
  const pfad = (werte: (string | null)[]) => {
    let teil = "";
    let neu = true;
    werte.forEach((w, i) => {
      if (w === null) {
        neu = true;
        return;
      }
      teil += `${neu ? "M" : "L"}${x(i).toFixed(1)} ${y(Number(w)).toFixed(1)} `;
      neu = false;
    });
    return teil.trim();
  };
  const teilungen = Array.from({ length: 5 }, (_, i) => yMin + ((yMax - yMin) * i) / 4);
  const klasse = (i: number) => (i === reihen.length - 1 ? "app-dashboard__serie--gesamt" : `app-dashboard__serie--${(i % 4) + 1}`);
  type Zeile = { asOf: string; i: number };
  const spalten: TabelleSpalte<Zeile>[] = [
    { schluessel: "stichtag", kopf: d.stichtag, zelle: (z) => <span className="app-zahl">{formatDatum(z.asOf, sprache)}</span> },
    ...reihen.map((r, ri) => ({ schluessel: `r${ri}`, kopf: r.name, zahl: true, zelle: (z: Zeile) => (r.werte[z.i] === null ? t.gemeinsam.keinWert : formatBetrag(r.werte[z.i]!, sprache, { waehrung: daten.homeCurrency })) })),
  ];
  return (
    <section className="app-karte" aria-labelledby="verlauf-titel">
      <div className="app-karte__kopf">
        <h2 id="verlauf-titel" className="cw-t-untertitel app-karte__titel">{d.verlauf}</h2>
        <div className="app-gruppe app-gruppe--zeile">
          <Segment<"nav" | "portfolioValue"> aria-label={d.groesse} value={groesse} onChange={setGroesse} options={[{ wert: "portfolioValue", label: d.portfoliowert }, { wert: "nav", label: d.nav }]} />
          <DarstellungWahl wert={ansicht} onChange={setAnsicht} />
        </div>
      </div>
      <p className="app-leer-text">{d.verlaufBeschreibung}</p>
      {ansicht === "tabelle" ? (
        <Tabelle beschriftung={`${d.verlauf} · ${label}`} spalten={spalten} zeilen={h.dates.map((asOf, i) => ({ asOf, i }))} zeilenSchluessel={(z) => z.asOf} />
      ) : (
        <div className="app-kurve cw-portfolio-verlauf" role="group" aria-labelledby="verlauf-titel" tabIndex={0}>
          <svg className="app-kurve__svg" viewBox={`0 0 ${B} ${H}`} role="img" aria-label={d.verlaufAlternative(label, h.funds.length)} preserveAspectRatio="xMidYMid meet">
            {teilungen.map((w) => (
              <g key={w} aria-hidden="true">
                <line className="app-kurve__raster" x1={RAND.links} x2={B - RAND.rechts} y1={y(w)} y2={y(w)} />
                <text className="app-kurve__text" x={RAND.links - 8} y={y(w) + 4} textAnchor="end">{formatBetrag(w, sprache, { waehrung: daten.homeCurrency, kompakt: true })}</text>
              </g>
            ))}
            {h.dates.map((tag, i) => (
              <text key={tag} className="app-kurve__text" x={x(i)} y={H - RAND.unten + 18} textAnchor={i === 0 ? "start" : i === h.dates.length - 1 ? "end" : "middle"} aria-hidden="true">
                {i % Math.ceil(h.dates.length / 5) === 0 || i === h.dates.length - 1 ? formatDatum(tag, sprache) : ""}
              </text>
            ))}
            {reihen.map((r, i) => (
              <g key={r.name} aria-hidden="true">
                <path className={`app-dashboard__serie ${klasse(i)}`} d={pfad(r.werte)} fill="none" />
                {r.werte.map((w, j) => (w === null ? null : <circle key={j} className={`app-dashboard__punkt ${klasse(i)}`} cx={x(j)} cy={y(Number(w))} r={2.5} />))}
              </g>
            ))}
          </svg>
          <ul className="app-jkurve__legende">
            {reihen.map((r, i) => (
              <li key={r.name}>
                <svg width="28" height="8" aria-hidden="true">
                  <line className={`app-dashboard__serie ${klasse(i)}`} x1="0" x2="28" y1="4" y2="4" />
                </svg>{" "}
                {r.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function FondsTabelle({ daten }: { daten: Dashboard }) {
  const t = useT();
  const d = t.waehrung.dashboard;
  const sprache = useSprache();
  type Zeile = Dashboard["funds"][number];
  const haus = daten.homeCurrency;
  const betrag = (w: string | null, waehrung: string) => (w === null ? t.gemeinsam.keinWert : formatBetrag(w, sprache, { waehrung }));
  const multiple = (w: string | null) => (w === null ? t.gemeinsam.keinWert : formatMultiple(w, sprache));
  const spalten: TabelleSpalte<Zeile>[] = [
    { schluessel: "fonds", kopf: d.fonds, zelle: (f) => f.name },
    { schluessel: "waehrung", kopf: d.waehrung, zelle: (f) => f.currency },
    { schluessel: "zusage", kopf: `${d.zusagen} ${d.inHaus(haus)}`, zahl: true, zelle: (f) => betrag(f.home.commitment, haus) },
    { schluessel: "eingezahlt", kopf: `${d.eingezahlt} ${d.inHaus(haus)}`, zahl: true, zelle: (f) => betrag(f.home.paidIn, haus) },
    { schluessel: "ausschuettungen", kopf: `${d.ausschuettungen} ${d.inHaus(haus)}`, zahl: true, zelle: (f) => betrag(f.home.distributions, haus) },
    { schluessel: "nav", kopf: `${d.nav} ${d.inHaus(haus)}`, zahl: true, zelle: (f) => betrag(f.home.nav, haus) },
    { schluessel: "tvpi", kopf: d.tvpi, zahl: true, zelle: (f) => multiple(f.tvpi) },
    { schluessel: "dpi", kopf: d.dpi, zahl: true, zelle: (f) => multiple(f.dpi) },
  ];
  return (
    <div className="app-karte">
      <h2 className="cw-t-untertitel app-karte__titel">{d.fondsTabelle}</h2>
      <Tabelle beschriftung={d.fondsTabelle} spalten={spalten} zeilen={daten.funds} zeilenSchluessel={(f) => f.fundId} />
    </div>
  );
}
