import { StichtagMenue } from "../komponenten/StichtagMenue";
import { BelegPanel, useBelegMoeglich } from "../komponenten/BelegKnopf";
import { lazy, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { AddressBookIcon, Auswahl, BuildingsIcon, ChartPieSliceIcon, Fakten, FileTextIcon, Hinweis, HouseIcon, KanbanIcon, Karte, Kennzahl, KennzahlenReihe, ListIcon, ScalesIcon, Seitenkopf, Seitenpanel, SprungAbschnitt, Sprungmarken, StackIcon, Status, Tabs, formatBetrag, formatDatum, formatMultiple, formatProzent, type StatusVariante, type TabelleSpalte, type MenueEintrag } from "@carraway/ui";
import { beteiligungDetail, finanzierungsrunden, fondsUebersicht, type BeteiligungDetail } from "../api/abfragen";
import { BewertungenAbschnitt } from "../komponenten/BewertungenAbschnitt";
import { DokumenteAbschnitt } from "../komponenten/DokumenteAbschnitt";
import { RegisterHinweise } from "../komponenten/Register";
import { Fundstellen, fundstellenLinks } from "../komponenten/Fundstellen";
import { Bewertungsverlauf } from "../komponenten/Bewertungsverlauf";
import { HerkunftDialog } from "../komponenten/HerkunftDialog";
import { ExitSzenario } from "../komponenten/ExitSzenario";
import { InstrumentAbschnitt, InstrumentAktionen } from "../komponenten/InstrumentAbschnitt";
import { KapitalAbschnitt } from "../komponenten/KapitalAbschnitt";
import { KennzahlenTab } from "../komponenten/KennzahlenTab";
import { RundenAbschnitt } from "../komponenten/Runden";
import { SchluesselAbschnitt } from "../komponenten/SchluesselAbschnitt";
import { TransaktionenAbschnitt } from "../komponenten/TransaktionenAbschnitt";
import { filterWert, formatBetragMitCent, gruppeWert, type TxFilter, type TxGruppe } from "../lib/transaktionen";
import { StornoDialog } from "../komponenten/VorgangDialoge";
import { NurLesen } from "../komponenten/NurLesen";
import { BereichsLeiste } from "../komponenten/BereichsLeiste";
import { Zusatzfelder } from "../komponenten/Zusatzfelder";
import { WaehrungsAbschnitt } from "../komponenten/WaehrungsAbschnitt";
import { Waehrungsleiste } from "../komponenten/Waehrungsleiste";
import { beteiligungWaehrungssicht, kursWaehrungen } from "../api/waehrung";
import { betragDerSicht, sichtAusSuche, type WaehrungSuche } from "../lib/waehrung";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { useSichtbar } from "../lib/bereiche";
import { alle as alleErweiterungen } from "../erweiterung";
import { useBereich, useRechte } from "../lib/rechte";
import { DATENSPRACHE } from "../lib/datensprache";
import { quartalsberichtUrl } from "../lib/berichteUrl";
import { formatWissensstand } from "../lib/wissensstand";

// Die Bereiche Instrumente und Zinsen laden erst, wenn jemand sie öffnet.
const InstrumenteAbschnitt = lazy(() => import("../komponenten/InstrumenteAbschnitt").then((m) => ({ default: m.InstrumenteAbschnitt })));
const ZinsenAbschnitt = lazy(() => import("../komponenten/ZinsenAbschnitt").then((m) => ({ default: m.ZinsenAbschnitt })));
const MandateAbschnitt = lazy(() => import("../komponenten/MandateAbschnitt").then((m) => ({ default: m.MandateAbschnitt })));

const route = getRouteApi("/investments/$id");

type Vorgang = BeteiligungDetail["vorgaenge"][number];
type KennzahlName = keyof BeteiligungDetail["kennzahlen"];

const STATUS_VARIANTE: Record<string, StatusVariante> = { aktiv: "freigegeben", exit: "entwurf", insolvent: "fehlt", abgeschrieben: "fehlt" };
const DEAL_STATUS: Record<string, StatusVariante> = { offen: "pruefung", investiert: "freigegeben", abgesagt: "fehlt" };
const REIHENFOLGE: KennzahlName[] = ["investiert", "rueckfluesse", "bewertung", "multiple", "irr"];
/** Wohin eine Kennzahl beim Anklicken springt (Ort und Reiter); Multiple und IRR haben keine eigene Stelle. */
const KENNZAHL_ZIEL: Partial<Record<KennzahlName, [string, string]>> = { investiert: ["finanzierung", "transaktionen"], rueckfluesse: ["finanzierung", "transaktionen"], bewertung: ["bewertung", "bewertungen"] };
/** Investiert und Rückflüsse öffnen die Transaktionen schon gefiltert auf ihre Buchungen. */
const KENNZAHL_FILTER: Partial<Record<KennzahlName, TxFilter>> = { investiert: "auszahlungen", rueckfluesse: "rueckfluesse" };

/** Eine Sicht eines Ortes (Reiter oder Abschnitt mit Sprungmarke); `recht` ist die Kennung für die Bereiche, wenn sie von `id` abweicht. */
interface BereichSicht {
  id: string;
  recht?: string;
  label: string;
  zaehler?: number | undefined;
  inhalt: () => ReactNode;
}

/** Ein Ort der Beteiligung in der Seitenleiste mit seinen Sichten. */
interface Ort {
  id: string;
  label: string;
  icon: ReactNode;
  zaehler?: number | undefined;
  sichten: BereichSicht[];
  /** Sichten untereinander mit Sprungmarken statt als Reiter. */
  sprungmarken?: boolean;
}

/**
 * Ort und Sicht aus der Adresse. Bisherige Adressen bleiben gültig: `?tab=financing` (ohne `subtab`) sind die Runden, `subtab=cap-table` und
 * `subtab=waterfall` führen zum Captable, `tab=metrics` und `tab=boards` zum Unternehmen, `tab=funding` und `tab=fields` zu den Stammdaten.
 */
export function ortAusAdresse<O extends { id: string; sichten: { id: string }[] }>(suche: { tab?: string; unter?: string }, orte: O[]): { ort: O; sicht: O["sichten"][number] | undefined } {
  let tab = suche.tab;
  let unter = suche.unter;
  if (tab === "finanzierung" && (unter === "kapitaltabelle" || unter === "wasserfall")) [tab, unter] = ["kapitaltabelle", unter === "kapitaltabelle" ? "anteile" : "wasserfall"];
  else if (tab === "kennzahlen") [tab, unter] = ["unternehmen", unter && unter !== "werte" ? unter : "werte"];
  else if (tab === "gremien") [tab, unter] = ["unternehmen", "gremien"];
  else if (tab === "foerderung") [tab, unter] = ["stammdaten", "foerderung"];
  else if (tab === "felder") [tab, unter] = ["stammdaten", `felder-${unter ?? "beteiligung"}`];
  const ort = orte.find((o) => o.id === tab) ?? orte[0]!;
  const sicht = ort.sichten.find((x) => x.id === unter) ?? ort.sichten[0];
  return { ort, sicht };
}

export function BeteiligungSeite() {
  const t = useT();
  const sprache = useSprache();
  const { id } = route.useParams();
  const suche = route.useSearch();
  const { stichtag, stand } = suche;
  const navigate = route.useNavigate();
  const { data: d } = useSuspenseQuery(beteiligungDetail(id, stichtag, stand));
  // Kapitaltabelle und Wasserfall gibt es nur, wo der Fonds Anteile aus Finanzierungsrunden hält (nicht bei Darlehen).
  // Zinsen gibt es nur mit einem darlehensartigen Instrument.
  const haltZinsen = d.instrumente.some((i) => i.darlehensartig);
  const haltAnteile = d.runden.some((r) => r.positionen.some((p) => p.diesesFonds));
  // Währungssicht (Etappe 21): Lokal | Fonds | Vergleich, in der Adresse; Fonds ist die Sicht der Kennzahlen.
  const sicht = sichtAusSuche(suche);
  const { data: ws } = useQuery(beteiligungWaehrungssicht(id, { stichtag, stand, vergleich: suche.vergleich }));
  const { data: kursWaehrungenListe } = useQuery(kursWaehrungen());
  const zeigeLeiste = Boolean(ws && (ws.waehrungen.lokal !== ws.waehrungen.fonds || (kursWaehrungenListe?.length ?? 0) > 1 || suche.sicht));
  const aendereSicht = (neu: WaehrungSuche) => void navigate({ search: (alt) => ({ ...alt, sicht: neu.sicht, vergleich: neu.vergleich }), replace: true });
  const [herkunft, setHerkunft] = useState<KennzahlName | null>(null);
  const [markiert, setMarkiert] = useState<string | null>(null);
  const { darf } = useRechte();
  const mitBerichten = useBereich("berichte");
  const schreiben = darf("bearbeiter", d.fonds.id, "portfolio");
  const [storno, setStorno] = useState<Vorgang | null>(null);
  const [belegFuer, setBelegFuer] = useState<Vorgang | null>(null);
  // Filter der Transaktionen nach Instrument ("" = alle); er gilt nur, solange die Beteiligung mehrere Instrumente hat.
  const [instrumentFilter, setInstrumentFilter] = useState("");
  // Eigene Felder einer Runde oder eines Vorgangs im Seitenpanel (Etappe 21).
  const [felderPanel, setFelderPanel] = useState<{ objekt: "runde" | "vorgang"; id: string; titel: string } | null>(null);
  const keinWert = t.gemeinsam.keinWert;
  const b = t.beteiligung;

  const k = d.kennzahlen;
  const werte: Record<KennzahlName, string> = {
    investiert: formatBetrag(k.investiert.wert ?? "0", sprache, { kompakt: true }),
    rueckfluesse: formatBetrag(k.rueckfluesse.wert ?? "0", sprache, { kompakt: true }),
    bewertung: formatBetrag(k.bewertung.wert ?? "0", sprache, { kompakt: true }),
    multiple: k.multiple.wert === null ? keinWert : formatMultiple(k.multiple.wert, sprache),
    // Die API liefert den IRR als Bruch ("0.12"), die Anzeige in Prozent.
    irr: k.irr.wert === null ? keinWert : formatProzent(Number(k.irr.wert) * 100, sprache),
  };
  const offen = herkunft ? k[herkunft] : null;
  // Beträge der gewählten Sicht; eine Lücke (Kurs fehlt) bleibt eine Lücke und wird nie durch eine Zahl ersetzt.
  const betragName = (name: KennzahlName): name is "investiert" | "rueckfluesse" | "bewertung" => name === "investiert" || name === "rueckfluesse" || name === "bewertung";
  const inSicht = (name: KennzahlName, fonds: string) => {
    const bt = ws && sicht !== "fonds" && betragName(name) ? ws.kennzahlen[name] : null;
    if (!ws || !bt) return fonds;
    const x = betragDerSicht(bt, sicht, ws.waehrungen);
    return x.wert === null ? t.waehrung.luecke : formatBetrag(x.wert, sprache, { kompakt: true, waehrung: x.waehrung });
  };
  const titelInSicht = (name: KennzahlName) => (ws && sicht !== "fonds" && betragName(name) ? t.waehrung.kennzahlIn(b[name], betragDerSicht({ fonds: "0", lokal: "0", vergleich: "0" }, sicht, ws.waehrungen).waehrung) : b[name]);
  const sichtWaehrung = ws ? betragDerSicht({ fonds: "0", lokal: "0", vergleich: "0" }, sicht, ws.waehrungen).waehrung : null;
  const sichtKurse = ws && sichtWaehrung ? ws.bewertungKurse.filter((x) => x.nach === sichtWaehrung) : [];
  const sichtLuecken = ws && sicht === "haus" ? ws.hausLuecken : ws && sichtWaehrung ? ws.luecken.filter((x) => x.nach === sichtWaehrung) : [];
  const sichtVorgaenge = new Map((ws?.vorgaenge ?? []).map((v) => [v.id, v]));

  // Der Verlauf endet am Stichtag: spätere Bewertungen gehören nicht zum Stand, den die Seite zeigt.
  const verlauf = d.bewertungsverlauf.filter((w) => w.stichtag <= d.stichtag);

  const vorgangNachId = new Map(d.vorgaenge.map((v) => [v.id, v]));
  function springeZu(e: MouseEvent, ziel: Vorgang) {
    e.preventDefault();
    setMarkiert(ziel.id);
    const element = document.getElementById(`vorgang-${ziel.id}`);
    element?.scrollIntoView?.({ block: "center" });
    element?.focus({ preventScroll: true });
  }
  const verweis = (ziel: Vorgang) => (
    <a href={`#vorgang-${ziel.id}`} aria-label={b.vorgaenge.springeZu(formatDatum(ziel.valuta, sprache), aufzaehlung(t.vorgangArt, ziel.art))} onClick={(e) => springeZu(e, ziel)}>
      {formatDatum(ziel.valuta, sprache)}
    </a>
  );

  const mehrereInstrumente = d.instrumente.length > 1;
  const trancheNummer = new Map(d.instrumente.flatMap((i) => i.tranchen).map((x) => [x.id, x.nummer === null ? undefined : String(x.nummer)]));
  const vs = b.vorgaenge.spalten;
  const vorgaenge: TabelleSpalte<Vorgang>[] = [
    {
      schluessel: "valuta",
      kopf: vs.valuta,
      zelle: (v) => (
        <span id={`vorgang-${v.id}`} tabIndex={-1} className="app-zahl">
          {formatDatum(v.valuta, sprache)}
        </span>
      ),
    },
    {
      // Art mit Zusammenhang (Storno, storniert) darunter; eine Spalte weniger, damit die Tabelle bei 1280 px passt.
      schluessel: "art",
      kopf: vs.art,
      umbruch: true,
      zelle: (v) => {
        const zusammenhang = (() => {
          const partner = vorgangNachId.get(v.istStorno ? (v.storniertVorgangId ?? "") : (v.stornoVorgangId ?? ""));
          if (!v.istStorno && !v.storniert) return keinWert;
          return (
            <span className="app-zusammenhang">
              <Status variante={v.istStorno ? "pruefung" : "fehlt"}>{v.istStorno ? b.vorgaenge.storno : b.vorgaenge.storniert}</Status>
              {partner ? (
                <span>
                  {v.istStorno ? b.vorgaenge.stornoZu : b.vorgaenge.storniertDurch}: {verweis(partner)}
                </span>
              ) : null}
            </span>
          );
        })();
        return (
          <>
            {aufzaehlung(t.vorgangArt, v.art)}
            {v.art === "zins" && v.kapitalisiert ? <> ({b.vorgaenge.kapitalisiert})</> : null}
            {v.art === "wertberichtigung" ? <> <span className="app-leer-text">{b.vorgaenge.bilanziell}</span></> : null}
            {v.ohneGeldfluss ? <> <Status title={b.vorgaenge.ohneGeldflussHilfe}>{b.vorgaenge.ohneGeldfluss}</Status></> : null}
            {zusammenhang === keinWert ? null : <div className="app-tx-zusammenhang">{zusammenhang}</div>}
          </>
        );
      },
    },
    { schluessel: "instrument", kopf: vs.instrument, umbruch: true, zelle: (v) => v.instrumentBezeichnung ?? keinWert },
    { schluessel: "tranche", kopf: vs.tranche, zahl: true, zelle: (v) => (v.trancheId ? (trancheNummer.get(v.trancheId) ?? keinWert) : keinWert) },
    {
      schluessel: "betrag",
      kopf: sichtWaehrung && sicht !== "fonds" ? t.waehrung.kennzahlIn(vs.betrag, sichtWaehrung) : vs.betrag,
      zahl: true,
      zelle: (v) => {
        const sv = sicht !== "fonds" && ws ? sichtVorgaenge.get(v.id) : undefined;
        const x = sv && ws ? betragDerSicht(sv.betrag, sicht, ws.waehrungen) : null;
        const text = x ? (x.wert === null ? <span className="app-luecke" title={t.waehrung.lueckeTitel}>{t.waehrung.luecke}</span> : formatBetragMitCent(x.wert, sprache, x.waehrung)) : formatBetragMitCent(v.betrag, sprache);
        return v.storniert ? <s>{text}</s> : text;
      },
    },
    { schluessel: "bemerkung", kopf: vs.bemerkung, umbruch: true, zelle: (v) => v.bemerkung ?? keinWert },
  ];
  // Aktionen je Vorgang im Menü „⋯“: eigene Felder, Stornieren, Beleg erzeugen.
  const belegMoeglich = useBelegMoeglich(d.fonds.id);
  const belegArt = (v: Vorgang): "auszahlung" | "zinsbuchung" | "frei" => (v.art === "auszahlung" ? "auszahlung" : v.art === "zins" ? "zinsbuchung" : "frei");
  const vorgangAktionen = (v: Vorgang): MenueEintrag[] => {
    const name = t.zusatzfelder.vorgangFelderZeile(formatDatum(v.valuta, sprache), aufzaehlung(t.vorgangArt, v.art));
    const offen = !(stand || !schreiben) && !v.istStorno && !v.storniert;
    return [
      { id: "felder", label: t.zusatzfelder.feldKnopf, onClick: () => setFelderPanel({ objekt: "vorgang", id: v.id, titel: name }) },
      ...(offen ? [{ id: "storno", label: t.stornoForm.zeile(aufzaehlung(t.vorgangArt, v.art), formatDatum(v.valuta, sprache)), onClick: () => setStorno(v) }] : []),
      ...(offen && belegMoeglich(belegArt(v)) ? [{ id: "beleg", label: t.buchhaltung.erzeugen.knopf, onClick: () => setBelegFuer(v) }] : []),
    ];
  };

  const lesend = Boolean(stand);
  const uebersicht = () => (
    <>
      <InstrumentAbschnitt beteiligungId={d.beteiligung.id} schreibgeschuetzt={lesend || !schreiben} wegenStand={lesend}>
        <Karte titel={b.deal.titel}>
          <Fakten
            darstellung="liste"
            eintraege={[
            ...(d.deal
              ? [
                  {
                    label: b.deal.titel,
                    wert: (
                      <Link to="/deals/$id" params={{ id: d.deal.id }}>
                        {b.deal.zumDeal}: {d.deal.titel}
                      </Link>
                    ),
                  },
                  { label: t.deal.phase, wert: aufzaehlung(t.dealPhase, d.deal.phase) },
                  { label: t.dealflow.spalten.status, wert: <Status variante={DEAL_STATUS[d.deal.status] ?? "entwurf"}>{aufzaehlung(t.dealStatus, d.deal.status)}</Status> },
                ]
              : [{ label: b.deal.titel, wert: b.deal.keiner }]),
            {
              label: b.organisation,
              wert: (
                <Link to="/organizations/$id" params={{ id: d.organisation.id }}>
                  {d.organisation.name}
                </Link>
              ),
            },
          ]}
          />
        </Karte>
        <Fundstellen fundstellen={d.fundstellen} />
      </InstrumentAbschnitt>
    </>
  );

  const gefiltert = mehrereInstrumente && instrumentFilter ? d.vorgaenge.filter((v) => v.instrumentId === instrumentFilter) : d.vorgaenge;
  const filter = filterWert(suche.art);
  const gruppe = gruppeWert(suche.gruppierung);
  // Filter und Gruppierung stehen in der Adresse (`art`, `gruppierung`); der Standard (Alle, nicht gruppiert) bleibt aus ihr heraus.
  const setzeAnsicht = (neu: { filter?: TxFilter; gruppe?: TxGruppe }) =>
    void navigate({ search: (alt) => ({ ...alt, ...("filter" in neu ? { art: neu.filter === "alle" ? undefined : neu.filter } : {}), ...("gruppe" in neu ? { gruppierung: neu.gruppe === "keine" ? undefined : neu.gruppe } : {}) }), replace: true });
  const transaktionen = () => (
    <Abschnitt
      id="vorgaenge"
      titel={b.vorgaenge.titel}
      aktionen={
        mehrereInstrumente ? (
          <Auswahl label={b.vorgaenge.filter} kompakt labelVersteckt value={instrumentFilter} onChange={(e) => setInstrumentFilter(e.target.value)}>
            <option value="">{b.vorgaenge.filterAlle}</option>
            {d.instrumente.map((i) => (
              <option key={i.id} value={i.id}>
                {i.bezeichnung}
              </option>
            ))}
          </Auswahl>
        ) : null
      }
    >
      <TransaktionenAbschnitt
        zeilen={gefiltert}
        spalten={vorgaenge}
        zeilenSchluessel={(v) => v.id}
        ausgewaehlt={(v) => v.id === markiert}
        filter={filter}
        gruppe={gruppe}
        onFilter={(f) => setzeAnsicht({ filter: f })}
        onGruppe={(g) => setzeAnsicht({ gruppe: g })}
        mitSummen={sicht === "fonds"}
        aktionen={vorgangAktionen}
      />
    </Abschnitt>
  );

  const rundenListe = useQuery(finanzierungsrunden(d.organisation.id));
  const rundenAnzahl = rundenListe.data?.length;

  // Gliederung: sieben Orte in der Seitenleiste; gleichrangige Sichten eines Ortes sind Reiter (eigene Adresse über `unter`),
  // Abschnitte, die man zusammen liest, stehen untereinander mit Sprungmarken. Einträge anderer Bereiche fallen ohne Recht weg (`lib/bereiche.ts`).
  const zusatz = alleErweiterungen("beteiligungReiter");
  const reiterZusatz = (ort: string): BereichSicht[] =>
    zusatz.filter((r) => r.gruppe === ort).map((r) => ({ id: r.unter ?? r.id, recht: r.id, label: r.label(t), inhalt: () => r.inhalt({ beteiligungId: d.beteiligung.id, organisationId: d.organisation.id, fondsId: d.fonds.id, name: d.organisation.name, lesend }) }));
  const finanzierung: BereichSicht[] = [
    { id: "runden", label: t.tabs.finanzierungsrunden, zaehler: rundenAnzahl || undefined, inhalt: () => <RundenAbschnitt organisationId={d.organisation.id} fondsId={d.fonds.id} lesend={lesend} rundeId={suche.rundeId} onRunde={(id) => void navigate({ search: (alt) => ({ ...alt, rundeId: id }) })} onFelder={(r) => setFelderPanel({ objekt: "runde", id: r.id, titel: t.zusatzfelder.felderVon(r.bezeichnung) })} /> },
    {
      id: "instrumente",
      label: t.tabs.instrumente,
      zaehler: d.instrumente.length > 1 ? d.instrumente.length : undefined,
      inhalt: () => (
        <InstrumenteAbschnitt
          beteiligungId={d.beteiligung.id}
          organisationId={d.organisation.id}
          runden={d.runden.map((r) => ({ id: r.id, bezeichnung: r.bezeichnung, datum: r.datum, belegt: r.positionen.some((p) => p.diesesFonds) }))}
          schreibgeschuetzt={lesend || !schreiben}
          wegenStand={lesend}
        />
      ),
    },
    { id: "transaktionen", label: t.tabs.transaktionen, inhalt: transaktionen },
    ...(haltZinsen ? [{ id: "zinsen", label: t.tabs.zinsen, inhalt: () => <ZinsenAbschnitt beteiligungId={d.beteiligung.id} fondsId={d.fonds.id} stichtag={d.stichtag} stand={stand} schreiben={!lesend && schreiben} /> }] : []),
  ];
  const captable: BereichSicht[] = haltAnteile
    ? [
        { id: "anteile", label: t.tabs.anteile, inhalt: () => <KapitalAbschnitt beteiligungId={d.beteiligung.id} organisationId={d.organisation.id} fondsId={d.fonds.id} stichtag={d.stichtag} lesend={lesend} /> },
        { id: "wasserfall", label: t.tabs.exitSzenario, inhalt: () => <ExitSzenario beteiligungId={d.beteiligung.id} postMoney={d.runden.at(-1)?.postMoney ?? null} /> },
      ]
    : [];
  const bewertung: BereichSicht[] = [
    { id: "bewertungen", label: t.tabs.bewertungen, inhalt: () => <BewertungenAbschnitt waehrung={d.fonds.waehrung} bewertungId={suche.bewertungId} stand={stand} beteiligungId={d.beteiligung.id} fondsId={d.fonds.id} stichtag={d.stichtag} lesend={lesend} /> },
    { id: "verlauf", label: t.tabs.bewertungsverlauf, inhalt: () => <Bewertungsverlauf reihe={verlauf} /> },
    { id: "waehrung", label: t.tabs.waehrung, inhalt: () => <WaehrungsAbschnitt beteiligungId={d.beteiligung.id} fondsId={d.fonds.id} stichtag={d.stichtag} stand={stand} vergleich={suche.vergleich} lesend={lesend} /> },
  ];
  const unternehmen: BereichSicht[] = [
    { id: "werte", label: t.tabs.kennzahlen, inhalt: () => <KennzahlenTab beteiligungId={d.beteiligung.id} fondsId={d.fonds.id} lesend={lesend} /> },
    { id: "gremien", label: t.tabs.gremien, inhalt: () => <MandateAbschnitt beteiligungId={d.beteiligung.id} schreiben={!lesend && schreiben} /> },
    ...reiterZusatz("unternehmen"),
  ];
  const stammdaten: BereichSicht[] = [
    { id: "foerderung", label: t.tabs.foerderung, inhalt: () => <SchluesselAbschnitt beteiligungId={d.beteiligung.id} fondsId={d.fonds.id} lesend={lesend} /> },
    ...(["beteiligung", "instrument"] as const).map((o) => ({
      id: `felder-${o}`,
      label: o === "beteiligung" ? t.tabs.felderBeteiligung : t.tabs.felderInstrument,
      inhalt: () => <Zusatzfelder key={o} objekt={o} id={d.beteiligung.id} fondsId={d.fonds.id} stand={stand} />,
    })),
  ];
  // Rechte je Sicht (Kennungen wie in `lib/bereiche.ts`): Zinsen, Förderschlüssel, Kennzahlen, Dokumente, eigene Felder, Erweiterungen.
  const erlaubt = new Set(useSichtbar("beteiligung", [...finanzierung, ...captable, ...bewertung, ...unternehmen, ...stammdaten, { id: "dokumente" }].map((x) => ({ id: "recht" in x && x.recht ? x.recht : x.id }))).map((x) => x.id));
  const frei = (liste: BereichSicht[]) => liste.filter((x) => erlaubt.has(x.recht ?? x.id));
  const orte: Ort[] = [
    { id: "uebersicht", label: t.tabs.uebersicht, icon: <HouseIcon />, sichten: [{ id: "uebersicht", label: t.tabs.uebersicht, inhalt: uebersicht }] },
    { id: "finanzierung", label: t.tabs.finanzierung, icon: <StackIcon />, zaehler: rundenAnzahl || undefined, sichten: frei(finanzierung) },
    { id: "kapitaltabelle", label: t.tabs.kapitaltabelle, icon: <ChartPieSliceIcon />, sichten: frei(captable) },
    { id: "bewertung", label: t.tabs.bewertung, icon: <ScalesIcon />, sichten: frei(bewertung) },
    { id: "unternehmen", label: t.tabs.gruppeUnternehmen, icon: <BuildingsIcon />, sichten: frei(unternehmen) },
    ...(erlaubt.has("dokumente") ? [{ id: "dokumente", label: t.tabs.dokumente, icon: <FileTextIcon />, sichten: [{ id: "dokumente", label: t.tabs.dokumente, inhalt: () => <DokumenteAbschnitt zielTyp="beteiligung" zielId={d.beteiligung.id} fondsId={d.fonds.id} lesend={Boolean(stand)} /> }] }] : []),
    { id: "stammdaten", label: t.tabs.gruppeStammdaten, icon: <ListIcon />, sichten: frei(stammdaten), sprungmarken: true },
  ].filter((o) => o.sichten.length > 0);
  const { ort, sicht: aktiveSicht } = ortAusAdresse(suche, orte);
  const ziel = (ortId: string, sichtId?: string) => ({ to: "/investments/$id" as const, params: { id }, search: (alt: Record<string, unknown>) => ({ ...alt, tab: ortId === orte[0]?.id ? undefined : ortId, unter: sichtId }) });
  const setzeOrt = (ortId: string, sichtId?: string, extra: Record<string, unknown> = {}) => void navigate({ search: (alt) => ({ ...alt, tab: ortId === orte[0]?.id ? undefined : ortId, unter: sichtId, ...extra }) });
  const kopfRef = useRef<HTMLDivElement>(null);
  // Ein Sprung aus einer Kennzahl holt den Bereich ins Bild.
  function springeZuBereich(zielOrt: string, zielSicht: string, neuerFilter?: TxFilter) {
    setzeOrt(zielOrt, zielSicht === orte.find((o) => o.id === zielOrt)?.sichten[0]?.id ? undefined : zielSicht, neuerFilter ? { art: neuerFilter } : {});
    kopfRef.current?.scrollIntoView?.({ block: "start" });
  }
  const fondsZiel = { to: "/funds/$fundId" as const, params: { fundId: d.fonds.id }, search: {} };
  // Beteiligungen desselben Fonds für den Umschalter im Kopf der Leiste (sortiert nach Namen).
  const uebersichtDesFonds = useQuery({ ...fondsUebersicht(d.fonds.id), staleTime: 60_000 });
  const geschwister = [...(uebersichtDesFonds.data?.beteiligungen ?? [])].sort((x, y) => x.organisation.name.localeCompare(y.organisation.name, sprache));
  const inhaltDesOrtes = () => {
    if (ort.sprungmarken) {
      return (
        <>
          <Sprungmarken className="cw-sprungmarken--fest" aria-label={ort.label} marken={ort.sichten.map((x) => ({ id: x.id, label: x.label }))} ziel={aktiveSicht?.id === ort.sichten[0]?.id ? undefined : aktiveSicht?.id} onWahl={(x) => void navigate({ search: (alt) => ({ ...alt, unter: x === ort.sichten[0]?.id ? undefined : x }), replace: true })} />
          {ort.sichten.map((x) => (
            <SprungAbschnitt key={x.id} id={x.id} label={x.label}>
              {x.inhalt()}
            </SprungAbschnitt>
          ))}
        </>
      );
    }
    if (ort.sichten.length === 1) return ort.sichten[0]!.inhalt();
    return (
      <Tabs
        fest
        aria-label={ort.label}
        aktiv={aktiveSicht?.id ?? ""}
        onWechsel={(x) => setzeOrt(ort.id, x === ort.sichten[0]?.id ? undefined : x)}
        tabs={ort.sichten.map((x) => ({ id: x.id, label: x.label, zaehler: x.zaehler, inhalt: x.inhalt }))}
      />
    );
  };

  return (
    <div className="app-seite">
      <Seitenkopf
        status={<Status variante={STATUS_VARIANTE[d.beteiligung.status] ?? "entwurf"}>{aufzaehlung(t.beteiligungStatus, d.beteiligung.status)}</Status>}
        meta={
          <>
            <Link to="/funds/$fundId" params={{ fundId: d.fonds.id }} search={{}}>
              {d.fonds.name}
            </Link>
            <span aria-hidden="true">·</span>
            <span>{aufzaehlung(t.instrument, d.beteiligung.instrument)}</span>
          </>
        }
        titel={d.organisation.name}
        titelSprache={DATENSPRACHE}
        zeitbezug={
          <StichtagMenue
            fondsId={d.fonds.id}
            stichtag={d.stichtag}
            onStichtag={(stichtag) => void navigate({ search: (alt) => ({ ...alt, stichtag }), replace: true })}
            stand={stand}
            onStand={(neu) => void navigate({ search: (alt) => ({ ...alt, stand: neu }), replace: true })}
            zusatz={ws && zeigeLeiste ? <Waehrungsleiste sicht={sicht} suche={suche} waehrungen={ws.waehrungen} onAendern={aendereSicht} luecken={sichtLuecken} kurse={sichtKurse} mitStand={Boolean(stand)} /> : undefined}
            zusatzKurz={ws && zeigeLeiste ? (sicht === "haus" ? t.waehrung.sichtHaus(ws.waehrungen.haus ?? "") : t.waehrung.sichten[sicht as "lokal" | "fonds" | "vergleich"]) : undefined}
          />
        }
        aktionen={
          <InstrumentAktionen
            beteiligungId={d.beteiligung.id}
            schreibgeschuetzt={lesend || !schreiben}
            weitere={mitBerichten ? [{ id: "quartalsbericht", label: b.quartalsbericht, href: quartalsberichtUrl(d.beteiligung.id, { sprache, stichtag: d.stichtag, ...(stand ? { stand } : {}) }), extern: true }] : []}
          />
        }
      />

      {stand ? <Hinweis>{t.wissensstand.ansichtMit(formatWissensstand(stand, sprache))}</Hinweis> : null}

      <RegisterHinweise beteiligungId={d.beteiligung.id} organisationId={d.organisation.id} />
      <KennzahlenReihe aria-label={b.kennzahlen}>
        {REIHENFOLGE.map((name) => (
          <Kennzahl key={name} titel={titelInSicht(name)} wert={inSicht(name, werte[name])} hervorgehoben={name === "multiple"} onZiel={KENNZAHL_ZIEL[name] && orte.some((o) => o.id === KENNZAHL_ZIEL[name]![0]) ? () => springeZuBereich(KENNZAHL_ZIEL[name]![0], KENNZAHL_ZIEL[name]![1], KENNZAHL_FILTER[name]) : undefined} onHerkunft={() => setHerkunft(name)} />
        ))}
      </KennzahlenReihe>
      <NurLesen fondsId={d.fonds.id} bereich="portfolio" />

      <div ref={kopfRef} className="app-sprungziel" />
      <BereichsLeiste
        aria-label={t.tabs.verzeichnisBeteiligung}
        aktiv={ort.id}
        zurueck={{ label: d.fonds.name, ziel: fondsZiel }}
        kopf={{
          titel: d.organisation.name,
          titelSprache: DATENSPRACHE,
          untertitel: `${aufzaehlung(t.instrument, d.beteiligung.instrument)} · ${aufzaehlung(t.beteiligungStatus, d.beteiligung.status)}`,
          // Umschalter zu einer anderen Beteiligung desselben Fonds; der Ort (Reiter) bleibt erhalten, die Auswahl einer Runde nicht.
          umschalter:
            geschwister.length > 1
              ? {
                  label: t.nav.beteiligungWaehlen,
                  aktuell: d.beteiligung.id,
                  optionen: geschwister.map((z) => ({ id: z.id, label: z.organisation.name, ziel: { to: "/investments/$id", params: { id: z.id }, search: { ...(suche.tab ? { tab: suche.tab } : {}), ...(stichtag ? { stichtag } : {}), ...(stand ? { stand } : {}) } } })),
                }
              : undefined,
        }}
        pfad={[{ label: t.nav.fonds, ziel: { to: "/funds", search: {} } }, { label: d.fonds.name, ziel: fondsZiel }, { label: d.organisation.name }]}
        gruppen={[
          {
            id: "orte",
            eintraege: orte.map((o) => ({
              id: o.id,
              label: o.label,
              icon: o.icon,
              zaehler: o.zaehler,
              ziel: ziel(o.id) as never,
              reiter: o.sichten.length > 1 ? o.sichten.map((x, i) => ({ id: x.id, label: x.label, ziel: { to: "/investments/$id", params: { id }, search: { tab: o.id, ...(i > 0 ? { unter: x.id } : {}) } } as never })) : undefined,
              inhalt: inhaltDesOrtes,
            })),
          },
          {
            id: "verknuepft",
            label: t.tabs.verknuepft,
            eintraege: [
              ...(d.deal ? [{ id: "deal", label: d.deal.titel, icon: <KanbanIcon />, ziel: { to: "/deals/$id", params: { id: d.deal.id } } as never, inhalt: inhaltDesOrtes }] : []),
              { id: "organisation", label: d.organisation.name, icon: <AddressBookIcon />, ziel: { to: "/organizations/$id", params: { id: d.organisation.id } } as never, inhalt: inhaltDesOrtes },
            ],
          },
        ]}
      />

      {storno ? <StornoDialog vorgang={storno} onSchliessen={() => setStorno(null)} /> : null}
      {belegFuer ? <BelegPanel art={belegArt(belegFuer)} bezugArt="vorgang" bezugId={belegFuer.id} fondsId={d.fonds.id} onSchliessen={() => setBelegFuer(null)} /> : null}
      {felderPanel ? (
        <Seitenpanel titel={felderPanel.titel} onSchliessen={() => setFelderPanel(null)}>
          <h2 className="cw-t-untertitel">{felderPanel.titel}</h2>
          <Zusatzfelder objekt={felderPanel.objekt} id={felderPanel.id} fondsId={d.fonds.id} stand={stand} ohneKopf />
        </Seitenpanel>
      ) : null}
      {offen && herkunft ? <HerkunftDialog titel={b[herkunft]} stichtag={d.stichtag} schritte={offen.schritte} quellen={herkunft === "bewertung" ? fundstellenLinks(d.fundstellen, "bewertung", t.dokumente.fundstelle.aus) : []} onSchliessen={() => setHerkunft(null)} /> : null}
    </div>
  );
}

function Abschnitt({ id, titel, aktionen, children }: { id: string; titel: string; aktionen?: ReactNode; children: ReactNode }) {
  return (
    <section className="app-karte">
      <div className="app-karte__kopf">
        <h2 id={`abschnitt-${id}`} className="cw-t-untertitel app-karte__titel">
          {titel}
        </h2>
        {aktionen}
      </div>
      {children}
    </section>
  );
}
