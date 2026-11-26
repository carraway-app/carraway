import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Auswahl, ButtonLink, ChartLineUpIcon, ChartPieSliceIcon, ClockIcon, Feld, formatProzent, FunnelIcon, Kennzahl, Leer, PercentIcon, Seitenkopf, Tabelle, Tabs, type TabelleSpalte } from "@carraway/ui";
import { useTabs } from "../lib/tabs";
import { fondsListe, trichter, type Trichter } from "../api/abfragen";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { trichterExportUrl } from "../lib/berichteUrl";

const route = getRouteApi("/dealflow/auswertung");

type Stufe = Trichter["phasen"][number];
type Quartal = Trichter["zeitreihe"][number];
type Dauer = Trichter["verweildauer"][number];
type Gruppe = { schluessel: string; bezeichnung: string; deals: number; offen: number; abgesagt: number; investiert: number; konversion: number | null };

const SAEULE = 16;
const GRUPPE = SAEULE * 3 + 24;
const HOEHE = 160;

/** Säulen je Quartal (Eingänge, Abschlüsse, Absagen) als SVG aus Tokens; die Zahlen stehen zusätzlich in der Tabelle darunter. */
function Quartalsdiagramm({ reihe, beschriftung, beschreibung }: { reihe: Quartal[]; beschriftung: string; beschreibung: (q: Quartal) => string }) {
  const hoechster = Math.max(1, ...reihe.flatMap((q) => [q.eingang, q.abschluss, q.absage]));
  const breite = Math.max(1, reihe.length) * GRUPPE + 16;
  return (
    <div className="app-verlauf__huelle" role="region" aria-label={beschriftung} tabIndex={0}>
      <svg className="app-diagramm" role="img" aria-label={beschriftung} viewBox={`0 0 ${breite} ${HOEHE + 24}`} width={breite} height={HOEHE + 24}>
        {reihe.map((q, i) => {
          const x = 8 + i * GRUPPE;
          const saeulen = [
            { klasse: "app-diagramm__eingang", wert: q.eingang },
            { klasse: "app-diagramm__abschluss", wert: q.abschluss },
            { klasse: "app-diagramm__absage", wert: q.absage },
          ];
          return (
            <g key={q.quartal}>
              <title>{beschreibung(q)}</title>
              {saeulen.map((sl, j) => {
                const h = (sl.wert / hoechster) * HOEHE;
                return <rect key={sl.klasse} className={sl.klasse} x={x + j * SAEULE} y={HOEHE - h} width={SAEULE - 2} height={h} />;
              })}
              <text className="app-diagramm__text" x={x} y={HOEHE + 16}>
                {q.quartal}
              </text>
            </g>
          );
        })}
        <line className="app-diagramm__achse" x1={0} x2={breite} y1={HOEHE} y2={HOEHE} />
      </svg>
    </div>
  );
}
interface Zaehlzeile {
  schluessel: string;
  bezeichnung: string;
  anzahl: number;
}

/** Waagerechter Balken aus Tokens; die Zahl steht immer daneben in der Tabelle, der Balken ist nur Anschauung. */
function Balken({ anteil }: { anteil: number }) {
  return (
    <div className="app-balken" aria-hidden="true">
      <span className="app-balken__fuellung" style={{ inlineSize: `${Math.max(0, Math.min(100, anteil))}%` }} />
    </div>
  );
}

export function AuswertungSeite() {
  const t = useT();
  const { tab, setzeTab } = useTabs(route.useSearch(), route.useNavigate(), ["trichter", "zeit", "dauer", "konversion", "verteilung"] as const);
  const sprache = useSprache();
  const { von, bis, fondsId } = route.useSearch();
  const navigate = route.useNavigate();
  const fonds = useQuery(fondsListe());
  const abfrage = useQuery(trichter({ von, bis, fondsId }));
  const u = abfrage.data;
  const a = t.auswertung;
  const keinWert = t.gemeinsam.keinWert;

  const setze = (name: "von" | "bis" | "fondsId", wert: string) =>
    void navigate({ search: (alt) => ({ ...alt, [name]: wert || undefined }), replace: true });

  const hoechster = Math.max(1, ...(u?.phasen.map((p) => p.erreicht) ?? [1]));
  const stufen: TabelleSpalte<Stufe>[] = [
    { schluessel: "phase", kopf: a.spalten.phase, zelle: (p) => aufzaehlung(t.dealPhase, p.phase) },
    { schluessel: "balken", kopf: <span className="cw-nur-lesen">{a.spalten.balken}</span>, zelle: (p) => <Balken anteil={(p.erreicht / hoechster) * 100} /> },
    { schluessel: "erreicht", kopf: a.spalten.erreicht, zahl: true, zelle: (p) => p.erreicht },
    { schluessel: "aktuell", kopf: a.spalten.aktuell, zahl: true, zelle: (p) => p.aktuell },
    {
      schluessel: "konversion",
      kopf: a.spalten.konversion,
      zahl: true,
      zelle: (p) => (p.konversionZurNaechsten === null ? keinWert : formatProzent(p.konversionZurNaechsten * 100, sprache)),
    },
  ];

  const zaehlSpalten = (kopf: string, zeilen: Zaehlzeile[]): TabelleSpalte<Zaehlzeile>[] => {
    const hoechste = Math.max(1, ...zeilen.map((z) => z.anzahl));
    return [
      { schluessel: "bezeichnung", kopf, zelle: (z) => z.bezeichnung },
      { schluessel: "balken", kopf: <span className="cw-nur-lesen">{a.spalten.balken}</span>, zelle: (z) => <Balken anteil={(z.anzahl / hoechste) * 100} /> },
      { schluessel: "anzahl", kopf: a.spalten.anzahl, zahl: true, zelle: (z) => z.anzahl },
    ];
  };
  const quellen: Zaehlzeile[] = (u?.quellen ?? []).map((q) => ({ schluessel: q.quelle ?? "", bezeichnung: q.quelle ?? a.ohneQuelle, anzahl: q.anzahl }));
  const gruende: Zaehlzeile[] = (u?.absagegruende ?? []).map((g) => ({ schluessel: g.absagegrund ?? "", bezeichnung: g.absagegrund ?? a.ohneGrund, anzahl: g.anzahl }));

  const p = t.auswertungPlus;
  const zeitreihe: TabelleSpalte<Quartal>[] = [
    { schluessel: "quartal", kopf: p.quartal, zelle: (q) => q.quartal },
    { schluessel: "eingang", kopf: p.eingang, zahl: true, zelle: (q) => q.eingang },
    { schluessel: "abschluss", kopf: p.abschluss, zahl: true, zelle: (q) => q.abschluss },
    { schluessel: "absage", kopf: p.absage, zahl: true, zelle: (q) => q.absage },
  ];
  const dauerMax = Math.max(1, ...(u?.verweildauer.map((d) => d.tage ?? 0) ?? [1]));
  const dauer: TabelleSpalte<Dauer>[] = [
    { schluessel: "phase", kopf: a.spalten.phase, zelle: (d) => aufzaehlung(t.dealPhase, d.phase) },
    { schluessel: "balken", kopf: <span className="cw-nur-lesen">{a.spalten.balken}</span>, zelle: (d) => <Balken anteil={((d.tage ?? 0) / dauerMax) * 100} /> },
    { schluessel: "tage", kopf: p.tage, zahl: true, zelle: (d) => (d.tage === null ? keinWert : d.tage.toLocaleString(sprache === "de" ? "de-DE" : "en-GB", { maximumFractionDigits: 1 })) },
    { schluessel: "anzahl", kopf: p.aufenthalte, zahl: true, zelle: (d) => d.anzahl },
  ];
  const gruppenSpalten = (kopf: string): TabelleSpalte<Gruppe>[] => [
    { schluessel: "bezeichnung", kopf, zelle: (g) => g.bezeichnung },
    { schluessel: "deals", kopf: p.spalten.deals, zahl: true, zelle: (g) => g.deals },
    { schluessel: "offen", kopf: p.spalten.offen, zahl: true, zelle: (g) => g.offen },
    { schluessel: "abgesagt", kopf: p.spalten.abgesagt, zahl: true, zelle: (g) => g.abgesagt },
    { schluessel: "investiert", kopf: p.spalten.investiert, zahl: true, zelle: (g) => g.investiert },
    { schluessel: "konversion", kopf: p.spalten.konversion, zahl: true, zelle: (g) => (g.konversion === null ? keinWert : formatProzent(g.konversion * 100, sprache)) },
  ];
  const nachQuelle: Gruppe[] = (u?.konversionNachQuelle ?? []).map(({ quelle, ...rest }) => ({ schluessel: quelle ?? "", bezeichnung: quelle ?? a.ohneQuelle, ...rest }));
  const nachBetreuung: Gruppe[] = (u?.konversionNachBetreuung ?? []).map(({ betreuung, ...rest }) => ({ schluessel: betreuung ?? "", bezeichnung: betreuung ?? p.ohneBetreuung, ...rest }));

  return (
    <div className="app-seite">
      <Seitenkopf
        meta={a.etikett}
        titel={a.titel}
        aktionen={
          <>
            <ButtonLink variante="sekundaer" href={trichterExportUrl({ sprache, von, bis, fondsId })} download aria-label={p.exportName}>
              {p.export}
            </ButtonLink>
            <Link to="/dealflow" search={{}} className="cw-button cw-button--sekundaer">
              {a.zumDealflow}
            </Link>
          </>
        }
      />

      <section className="app-karte" aria-label={a.filter}>
        <div className="app-filter">
          <Feld type="date" label={a.von} value={von ?? ""} onChange={(e) => setze("von", e.target.value)} />
          <Feld type="date" label={a.bis} value={bis ?? ""} onChange={(e) => setze("bis", e.target.value)} />
          <Auswahl label={a.fonds} value={fondsId ?? ""} onChange={(e) => setze("fondsId", e.target.value)}>
            <option value="">{t.gemeinsam.alle}</option>
            {fonds.data?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Auswahl>
        </div>
        <p className="app-leer-text">{a.kohorte}</p>
      </section>

      <FehlerHinweis fehler={abfrage.error} />

      {!u ? (
        abfrage.isPending ? (
          <div className="app-karte" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="app-skelett app-skelett--zeile" />
            ))}
          </div>
        ) : null
      ) : u.gesamt.deals === 0 ? (
        <Leer zeichen="A" titel={a.keineDeals} beschreibung={a.keineDealsBeschreibung} />
      ) : (
        <div className="app-auswertung" aria-busy={abfrage.isFetching}>
          <section aria-label={a.gesamt} className="app-kennzahlen">
            <Kennzahl titel={a.deals} wert={u.gesamt.deals} hervorgehoben />
            <Kennzahl titel={t.dealStatus.offen} wert={u.gesamt.offen} />
            <Kennzahl titel={t.dealStatus.abgesagt} wert={u.gesamt.abgesagt} />
            <Kennzahl titel={t.dealStatus.investiert} wert={u.gesamt.investiert} />
          </section>

          <Tabs
            aria-label={t.tabs.bereiche}
            aktiv={tab}
            onWechsel={setzeTab}
            tabs={[
              { id: "trichter", icon: FunnelIcon, label: a.trichter, inhalt: () => (
          <section className="app-karte">
            <h2 className="cw-t-untertitel app-karte__titel">{a.trichter}</h2>
            <Tabelle beschriftung={a.trichter} spalten={stufen} zeilen={u.phasen} zeilenSchluessel={(p) => p.phase} />
          </section>


              ) },
              { id: "zeit", icon: ChartLineUpIcon, label: p.zeitreihe, inhalt: () => (
          <section className="app-karte">
            <h2 className="cw-t-untertitel app-karte__titel">
              {p.zeitreihe}
            </h2>
            <p className="app-leer-text">{p.zeitreiheHinweis}</p>
            <Quartalsdiagramm reihe={u.zeitreihe} beschriftung={p.diagramm} beschreibung={(q) => p.diagrammWert(q.quartal, q.eingang, q.abschluss, q.absage)} />
            <Tabelle beschriftung={p.zeitreihe} spalten={zeitreihe} zeilen={u.zeitreihe} zeilenSchluessel={(q) => q.quartal} />
          </section>


              ) },
              { id: "dauer", icon: ClockIcon, label: p.verweildauer, inhalt: () => (
          <section className="app-karte">
            <h2 className="cw-t-untertitel app-karte__titel">
              {p.verweildauer}
            </h2>
            <p className="app-leer-text">{p.verweildauerHinweis}</p>
            <Tabelle beschriftung={p.verweildauer} spalten={dauer} zeilen={u.verweildauer} zeilenSchluessel={(d) => d.phase} />
          </section>


              ) },
              { id: "konversion", icon: PercentIcon, label: t.tabs.konversion, inhalt: () => (
          <div className="app-zwei-spalten">
            <section className="app-karte">
              <h2 className="cw-t-untertitel app-karte__titel">
                {p.konversionQuelle}
              </h2>
              <p className="app-leer-text">{p.konversionHinweis}</p>
              <Tabelle beschriftung={p.konversionQuelle} spalten={gruppenSpalten(a.spalten.quelle)} zeilen={nachQuelle} zeilenSchluessel={(g) => g.schluessel} />
            </section>
            <section className="app-karte">
              <h2 className="cw-t-untertitel app-karte__titel">
                {p.konversionBetreuung}
              </h2>
              <p className="app-leer-text">{p.konversionHinweis}</p>
              <Tabelle beschriftung={p.konversionBetreuung} spalten={gruppenSpalten(p.spalten.betreuung)} zeilen={nachBetreuung} zeilenSchluessel={(g) => g.schluessel} />
            </section>
          </div>


              ) },
              { id: "verteilung", icon: ChartPieSliceIcon, label: t.tabs.verteilung, inhalt: () => (
          <div className="app-zwei-spalten">
            <section className="app-karte">
              <h2 className="cw-t-untertitel app-karte__titel">{a.nachQuelle}</h2>
              <Tabelle beschriftung={a.nachQuelle} spalten={zaehlSpalten(a.spalten.quelle, quellen)} zeilen={quellen} zeilenSchluessel={(z) => z.schluessel} />
            </section>
            <section className="app-karte">
              <h2 className="cw-t-untertitel app-karte__titel">{a.nachGrund}</h2>
              {gruende.length === 0 ? (
                <p className="app-leer-text">{a.keineAbsagen}</p>
              ) : (
                <Tabelle beschriftung={a.nachGrund} spalten={zaehlSpalten(a.spalten.grund, gruende)} zeilen={gruende} zeilenSchluessel={(z) => z.schluessel} />
              )}
            </section>
          </div>

              ) },
            ]}
          />
        </div>
      )}
    </div>
  );
}
