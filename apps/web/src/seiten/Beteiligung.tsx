import { SeitenStichtag } from "../komponenten/SeitenStichtag";
import { WissensstandWahl } from "../komponenten/Wissensstand";
import { BelegKnopf } from "../komponenten/BelegKnopf";
import { lazy, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Auswahl, Button, ButtonLink, Fakten, Hinweis, Inhaltsverzeichnis, Karte, Kennzahl, KennzahlenReihe, Seitenkopf, Seitenpanel, Status, formatBetrag, formatDatum, formatMultiple, formatProzent, type StatusVariante, type TabelleSpalte, type VerzeichnisGruppe } from "@carraway/ui";
import { beteiligungDetail, finanzierungsrunden, type BeteiligungDetail } from "../api/abfragen";
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
import { useInhalt, type InhaltsEintrag } from "../lib/tabs";
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
import { formatZeitpunkt } from "../lib/zeit";

// Die Bereiche Instrumente und Zinsen laden erst, wenn jemand sie öffnet.
const InstrumenteAbschnitt = lazy(() => import("../komponenten/InstrumenteAbschnitt").then((m) => ({ default: m.InstrumenteAbschnitt })));
const ZinsenAbschnitt = lazy(() => import("../komponenten/ZinsenAbschnitt").then((m) => ({ default: m.ZinsenAbschnitt })));

const route = getRouteApi("/beteiligungen/$id");

type Vorgang = BeteiligungDetail["vorgaenge"][number];
type KennzahlName = keyof BeteiligungDetail["kennzahlen"];

const STATUS_VARIANTE: Record<string, StatusVariante> = { aktiv: "freigegeben", exit: "entwurf", insolvent: "fehlt", abgeschrieben: "fehlt" };
const DEAL_STATUS: Record<string, StatusVariante> = { offen: "pruefung", investiert: "freigegeben", abgesagt: "fehlt" };
const REIHENFOLGE: KennzahlName[] = ["investiert", "rueckfluesse", "bewertung", "multiple", "irr"];
/** Wohin eine Kennzahl beim Anklicken springt (Kennung eines Eintrags im Inhaltsverzeichnis); Multiple und IRR haben keine eigene Stelle. */
const KENNZAHL_ZIEL: Partial<Record<KennzahlName, string>> = { investiert: "transaktionen", rueckfluesse: "transaktionen", bewertung: "bewertungen" };
/** Investiert und Rückflüsse öffnen die Transaktionen schon gefiltert auf ihre Buchungen. */
const KENNZAHL_FILTER: Partial<Record<KennzahlName, TxFilter>> = { investiert: "auszahlungen", rueckfluesse: "rueckfluesse" };

interface BereichsEintrag extends InhaltsEintrag {
  gruppe: string;
  label: string;
  zaehler?: number;
  inhalt: () => ReactNode;
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
  const sichtLuecken = ws && sichtWaehrung ? ws.luecken.filter((x) => x.nach === sichtWaehrung) : [];
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
      schluessel: "art",
      kopf: vs.art,
      zelle: (v) => (
        <>
          {aufzaehlung(t.vorgangArt, v.art)}
          {v.art === "zins" && v.kapitalisiert ? <> ({b.vorgaenge.kapitalisiert})</> : null}
          {v.art === "wertberichtigung" ? <> <span className="app-leer-text">{b.vorgaenge.bilanziell}</span></> : null}
          {v.ohneGeldfluss ? <> <Status title={b.vorgaenge.ohneGeldflussHilfe}>{b.vorgaenge.ohneGeldfluss}</Status></> : null}
        </>
      ),
    },
    { schluessel: "instrument", kopf: vs.instrument, zelle: (v) => v.instrumentBezeichnung ?? keinWert },
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
    { schluessel: "bemerkung", kopf: vs.bemerkung, zelle: (v) => (v.bemerkung ? <span className="app-tx-bemerkung" title={v.bemerkung}>{v.bemerkung}</span> : keinWert) },
    {
      schluessel: "zusammenhang",
      kopf: vs.zusammenhang,
      zelle: (v) => {
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
      },
    },
    {
      schluessel: "felder",
      kopf: t.zusatzfelder.spalteFelder,
      zelle: (v: Vorgang) => (
        <Button variante="ruhig" aria-label={t.zusatzfelder.vorgangFelderZeile(formatDatum(v.valuta, sprache), aufzaehlung(t.vorgangArt, v.art))} onClick={() => setFelderPanel({ objekt: "vorgang", id: v.id, titel: t.zusatzfelder.vorgangFelderZeile(formatDatum(v.valuta, sprache), aufzaehlung(t.vorgangArt, v.art)) })}>
          {t.zusatzfelder.feldKnopf}
        </Button>
      ),
    },
    ...(stand || !schreiben
      ? []
      : [
          {
            schluessel: "aktion",
            kopf: b.vorgaenge.spalten.aktion,
            zelle: (v: Vorgang) =>
              v.istStorno || v.storniert ? (
                keinWert
              ) : (
                <span className="app-aktionen__knoepfe">
                  <Button variante="ruhig" aria-label={t.stornoForm.zeile(aufzaehlung(t.vorgangArt, v.art), formatDatum(v.valuta, sprache))} onClick={() => setStorno(v)}>
                    {t.stornoForm.knopf}
                  </Button>
                  <BelegKnopf art={v.art === "auszahlung" ? "auszahlung" : v.art === "zins" ? "zinsbuchung" : "frei"} bezugArt="vorgang" bezugId={v.id} fondsId={d.fonds.id} />
                </span>
              ),
          },
        ]),
  ];

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
                <Link to="/organisationen/$id" params={{ id: d.organisation.id }}>
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
      />
    </Abschnitt>
  );

  const rundenListe = useQuery(finanzierungsrunden(d.organisation.id));
  const rundenAnzahl = rundenListe.data?.length;

  // Gliederung: jeder Eintrag trägt sein Ziel in der Adresse (`tab`, bei Bedarf `unter`); der erste ist der Standard.
  const alle: BereichsEintrag[] = [
    { gruppe: "position", id: "uebersicht", tab: "uebersicht", label: t.tabs.uebersicht, inhalt: uebersicht },
    {
      gruppe: "kapital",
      id: "runden",
      tab: "finanzierung",
      unter: "runden",
      label: t.tabs.finanzierungsrunden,
      zaehler: rundenAnzahl || undefined,
      inhalt: () => <RundenAbschnitt organisationId={d.organisation.id} fondsId={d.fonds.id} lesend={lesend} onFelder={(r) => setFelderPanel({ objekt: "runde", id: r.id, titel: t.zusatzfelder.felderVon(r.bezeichnung) })} />,
    },
    {
      gruppe: "kapital",
      id: "instrumente",
      tab: "finanzierung",
      unter: "instrumente",
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
    { gruppe: "kapital", id: "transaktionen", tab: "finanzierung", unter: "transaktionen", label: t.tabs.transaktionen, inhalt: transaktionen },
    ...(haltZinsen ? [{ gruppe: "kapital", id: "zinsen", tab: "finanzierung", unter: "zinsen", label: t.tabs.zinsen, inhalt: () => <ZinsenAbschnitt beteiligungId={d.beteiligung.id} fondsId={d.fonds.id} stichtag={d.stichtag} stand={stand} schreiben={!lesend && schreiben} /> }] : []),
    ...(haltAnteile
      ? [
          { gruppe: "kapital", id: "kapitaltabelle", tab: "finanzierung", unter: "kapitaltabelle", label: t.tabs.kapitaltabelle, inhalt: () => <KapitalAbschnitt beteiligungId={d.beteiligung.id} organisationId={d.organisation.id} fondsId={d.fonds.id} stichtag={d.stichtag} lesend={lesend} /> },
          { gruppe: "kapital", id: "wasserfall", tab: "finanzierung", unter: "wasserfall", label: t.tabs.exitSzenario, inhalt: () => <ExitSzenario beteiligungId={d.beteiligung.id} postMoney={d.runden.at(-1)?.postMoney ?? null} /> },
        ]
      : []),
    { gruppe: "wert", id: "bewertungen", tab: "bewertung", unter: "bewertungen", label: t.tabs.bewertungen, inhalt: () => <BewertungenAbschnitt waehrung={d.fonds.waehrung} bewertungId={suche.bewertungId} stand={stand} beteiligungId={d.beteiligung.id} fondsId={d.fonds.id} stichtag={d.stichtag} lesend={lesend} /> },
    { gruppe: "wert", id: "verlauf", tab: "bewertung", unter: "verlauf", label: t.tabs.bewertungsverlauf, inhalt: () => <Bewertungsverlauf reihe={verlauf} /> },
    { gruppe: "wert", id: "waehrung", tab: "bewertung", unter: "waehrung", label: t.tabs.waehrung, inhalt: () => <WaehrungsAbschnitt beteiligungId={d.beteiligung.id} fondsId={d.fonds.id} stichtag={d.stichtag} stand={stand} vergleich={suche.vergleich} lesend={lesend} /> },
    { gruppe: "unternehmen", id: "werte", tab: "kennzahlen", unter: "werte", label: t.tabs.kennzahlen, inhalt: () => <KennzahlenTab beteiligungId={d.beteiligung.id} fondsId={d.fonds.id} lesend={lesend} /> },
    // Einträge der Erweiterungen (z. B. ESG), in ihrer Gruppe hinter denen des Kerns.
    ...alleErweiterungen("beteiligungReiter").map((r) => ({
      gruppe: r.gruppe,
      id: r.id,
      tab: r.tab,
      ...(r.unter ? { unter: r.unter } : {}),
      label: r.label(t),
      inhalt: () => r.inhalt({ beteiligungId: d.beteiligung.id, organisationId: d.organisation.id, fondsId: d.fonds.id, name: d.organisation.name, lesend }),
    })),
    { gruppe: "ablage", id: "dokumente", tab: "dokumente", label: t.tabs.dokumente, inhalt: () => <DokumenteAbschnitt zielTyp="beteiligung" zielId={d.beteiligung.id} fondsId={d.fonds.id} lesend={Boolean(stand)} /> },
    { gruppe: "stammdaten", id: "foerderung", tab: "foerderung", label: t.tabs.foerderung, inhalt: () => <SchluesselAbschnitt beteiligungId={d.beteiligung.id} fondsId={d.fonds.id} lesend={lesend} /> },
    ...(["beteiligung", "instrument"] as const).map((o) => ({
      gruppe: "stammdaten",
      id: `felder-${o}`,
      tab: "felder",
      unter: o,
      label: o === "beteiligung" ? t.tabs.felderBeteiligung : t.tabs.felderInstrument,
      inhalt: () => <Zusatzfelder key={o} objekt={o} id={d.beteiligung.id} fondsId={d.fonds.id} stand={stand} />,
    })),
  ];
  // Zinsen, Förderschlüssel, Kennzahlen, Dokumente, eigene Felder und Einträge der Erweiterungen gehören anderen Bereichen (`lib/bereiche.ts`) und fehlen ohne ihn.
  const eintraege = useSichtbar("beteiligung", alle);
  const gruppen: VerzeichnisGruppe[] = [
    ["position", t.tabs.gruppePosition],
    ["kapital", t.tabs.gruppeKapital],
    ["wert", t.tabs.gruppeWert],
    ["unternehmen", t.tabs.gruppeUnternehmen],
    ["ablage", t.tabs.gruppeAblage],
    ["stammdaten", t.tabs.gruppeStammdaten],
  ].map(([id, label]) => ({ id: id!, label, eintraege: eintraege.filter((e) => e.gruppe === id).map(({ id, label, zaehler, inhalt }) => ({ id, label, zaehler, inhalt })) }));
  // `?tab=finanzierung` ohne `unter` war der Bereich der Runden; er bleibt es, obwohl die Transaktionen im Verzeichnis davor stehen.
  const adresse = suche.tab === "finanzierung" && !suche.unter ? { ...suche, unter: "runden" } : suche;
  const { aktiv, setzeAktiv } = useInhalt(adresse, navigate, eintraege);
  const verzeichnisRef = useRef<HTMLDivElement>(null);
  // Ein Sprung aus einer Kennzahl holt das Verzeichnis ins Bild, wenn es nicht sichtbar im oberen Teil des Fensters steht.
  function springeZuBereich(ziel: string, neuerFilter?: TxFilter) {
    const eintrag = eintraege.find((e) => e.id === ziel);
    // Mit Filter in einer einzigen Navigation: zwei nacheinander überschrieben sich gegenseitig.
    if (neuerFilter && eintrag) void navigate({ search: (alt) => ({ ...alt, tab: eintrag.tab === eintraege[0]?.tab ? undefined : eintrag.tab, unter: eintrag === eintraege[0] ? undefined : eintrag.unter, art: neuerFilter }) });
    else setzeAktiv(ziel);
    const el = verzeichnisRef.current;
    if (!el) return;
    const { top } = el.getBoundingClientRect();
    if (top < 0 || top > window.innerHeight * 0.5) el.scrollIntoView?.({ block: "start" });
  }

  return (
    <div className="app-seite">
      <Seitenkopf
        meta={
          <>
            <Link to="/fonds/$fondsId" params={{ fondsId: d.fonds.id }} search={{}}>
              {d.fonds.name}
            </Link>
            {" · "}
            {aufzaehlung(t.instrument, d.beteiligung.instrument)}
            <Status variante={STATUS_VARIANTE[d.beteiligung.status] ?? "entwurf"}>{aufzaehlung(t.beteiligungStatus, d.beteiligung.status)}</Status>
          </>
        }
        titel={d.organisation.name}
        titelSprache={DATENSPRACHE}
        zeitbezug={
          <>
            <WissensstandWahl stand={stand} onWahl={(neu) => void navigate({ search: (alt) => ({ ...alt, stand: neu }), replace: true })} />
            <SeitenStichtag value={d.stichtag} title={b.stichtagWaehlen} onChange={(stichtag) => void navigate({ search: (alt) => ({ ...alt, stichtag }), replace: true })} />
          </>
        }
        aktionen={
          <>
            {mitBerichten ? (
              <ButtonLink variante="sekundaer" groesse="s" href={quartalsberichtUrl(d.beteiligung.id, { sprache, stichtag: d.stichtag, ...(stand ? { stand } : {}) })} download>
                {b.quartalsbericht}
              </ButtonLink>
            ) : null}
            <InstrumentAktionen beteiligungId={d.beteiligung.id} schreibgeschuetzt={lesend || !schreiben} />
          </>
        }
      />

      {stand ? <Hinweis>{t.wissensstand.ansichtMit(formatZeitpunkt(stand, sprache))}</Hinweis> : null}

      <RegisterHinweise beteiligungId={d.beteiligung.id} organisationId={d.organisation.id} />
      {ws && zeigeLeiste ? <Waehrungsleiste sicht={sicht} suche={suche} waehrungen={ws.waehrungen} onAendern={aendereSicht} luecken={sichtLuecken} kurse={sichtKurse} mitStand={Boolean(stand)} /> : null}
      <KennzahlenReihe aria-label={b.kennzahlen}>
        {REIHENFOLGE.map((name) => (
          <Kennzahl key={name} titel={titelInSicht(name)} wert={inSicht(name, werte[name])} hervorgehoben={name === "multiple"} onZiel={KENNZAHL_ZIEL[name] && eintraege.some((e) => e.id === KENNZAHL_ZIEL[name]) ? () => springeZuBereich(KENNZAHL_ZIEL[name]!, KENNZAHL_FILTER[name]) : undefined} onHerkunft={() => setHerkunft(name)} />
        ))}
      </KennzahlenReihe>
      <NurLesen fondsId={d.fonds.id} bereich="portfolio" />

      <div ref={verzeichnisRef}>
        <Inhaltsverzeichnis aria-label={t.tabs.verzeichnisBeteiligung} gruppen={gruppen} aktiv={aktiv} onWechsel={setzeAktiv} />
      </div>

      {storno ? <StornoDialog vorgang={storno} onSchliessen={() => setStorno(null)} /> : null}
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
