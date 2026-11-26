import { Fragment, useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { observeElementRect, useVirtualizer } from "@tanstack/react-virtual";
import { Auswahl, Button, ButtonLink, DotsThreeIcon, Feld, Hinweis, Leer, Menue, Seitenkopf, Seitenpanel, Status, Tabelle, formatBetrag, formatDatum, type MenueEintrag, type TabelleSpalte } from "@carraway/ui";
import { fondsListe, fondsUebersicht, instrumentdaten, journal, type JournalFilter, type JournalZeile } from "../api/abfragen";
import { belegvorlagen } from "../api/buchhaltung";
import { heuteIso } from "../api/datum";
import { useBuchungAnlegen, type NeueBuchung } from "../api/mutationen";
import { BelegPanel } from "../komponenten/BelegKnopf";
import { BuchungsStornoDialog } from "../komponenten/BuchungsStornoDialog";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { betragOderNichts, textOderNichts, useFormular } from "../komponenten/formular";
import { BetragFeld } from "../komponenten/BetragFeld";
import { betragRegel, datumRegel, pflichtRegel } from "../lib/feldpruefung";
import { NurLesen } from "../komponenten/NurLesen";
import { Skelettzeilen } from "../komponenten/Skelett";
import { feldText } from "../i18n/fehler";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { erlaubtFuer, trancheOffen } from "../lib/instrumente";
import { useRechte } from "../lib/rechte";
import { formatZeitpunkt } from "../lib/zeit";
import { formatBetragCent } from "../lib/zahl";
import { DATENSPRACHE } from "../lib/datensprache";
import { merkeFonds } from "../zustand";

const route = getRouteApi("/fonds/$fondsId/journal");

const TYPEN = ["zusage", "auszahlung", "rueckfluss", "zins", "zinszahlung", "dividende", "tilgung", "wertberichtigung", "abruf", "ausschuettung", "bewertung", "wandlung", "verkauf", "insolvenz"] as const;
const ZEILENHOEHE = 44;
const FENSTERHOEHE = 560;
const JOURNAL_SPALTEN = ["valuta", "erfasst", "typ", "unternehmen", "instrument", "betrag", "kasse", "storno", "herkunft", "aktion"] as const;
const JOURNAL_SPALTEN_SCHMAL = ["valuta", "typ", "betrag", "unternehmen", "instrument", "erfasst", "kasse", "storno", "herkunft", "aktion"] as const;
const JOURNAL_SCHMAL = "(max-width: 40rem)";

/** Abfrageparameter des Exports: dieselben Filter wie die Liste, dazu Format und Sprache der Kopfzeilen. */
function exportUrl(fondsId: string, f: JournalFilter, format: "csv" | "xlsx", sprache: string): string {
  const q = new URLSearchParams({ format, sprache });
  for (const [k, v] of Object.entries({ von: f.von, bis: f.bis, typ: f.typ, beteiligungId: f.beteiligungId, stand: f.stand })) if (v) q.set(k, v);
  if (f.bewertungen) q.set("bewertungen", "1");
  return `/api/v1/fonds/${fondsId}/journal?${q.toString()}`;
}

/**
 * Journal eines Fonds: alle Buchungen in zeitlicher Folge (neueste zuerst) mit Filtern in der URL, virtualisierter Tabelle, Summen über den
 * ganzen Filter, Storno-Verknüpfung, Herkunft und Export. Die API rechnet (Kassenwirkung, Summen); die Seite zeigt nur an.
 */
export function JournalSeite() {
  const { fondsId } = route.useParams();
  return <JournalInhalt key={fondsId} fondsId={fondsId} />;
}

function JournalInhalt({ fondsId }: { fondsId: string }) {
  const [schmal, setSchmal] = useState(() => window.matchMedia?.(JOURNAL_SCHMAL).matches ?? false);
  useEffect(() => {
    const abfrage = window.matchMedia?.(JOURNAL_SCHMAL);
    const wechseln = (e: MediaQueryListEvent) => setSchmal(e.matches);
    abfrage?.addEventListener("change", wechseln);
    return () => abfrage?.removeEventListener("change", wechseln);
  }, []);
  const journalSpalten = schmal ? JOURNAL_SPALTEN_SCHMAL : JOURNAL_SPALTEN;
  const t = useT();
  const sprache = useSprache();
  const j = t.journal;
  const suche = route.useSearch();
  const navigate = route.useNavigate();
  const { data: fonds } = useSuspenseQuery(fondsListe());
  const uebersicht = useQuery(fondsUebersicht(fondsId, undefined, suche.stand));
  const { darf } = useRechte();
  const [zeilenDialog, setZeilenDialog] = useState<{ art: "storno" | "beleg"; zeile: JournalZeile } | null>(null);
  const fokusNachDialog = useRef<HTMLElement | null>(null);
  const fokusRueckgabe = useRef<{ buchungGeaendert: boolean } | null>(null);
  const listenKopf = useRef<HTMLHeadingElement>(null);
  const [neu, setNeu] = useState(false);
  const aktuellerFonds = fonds.find((x) => x.id === fondsId);
  const fondsName = aktuellerFonds?.name ?? "";
  const waehrung = aktuellerFonds?.waehrung;
  useEffect(() => merkeFonds(fondsId), [fondsId]);

  const filter: JournalFilter = { von: suche.von, bis: suche.bis, typ: suche.typ, beteiligungId: suche.beteiligungId, bewertungen: suche.bewertungen === "1", stand: suche.stand };
  const zeitraumUngueltig = Boolean(filter.von && filter.bis && filter.von > filter.bis);
  const hatFilter = Boolean(filter.von || filter.bis || filter.typ || filter.beteiligungId || filter.bewertungen);
  function filterZuruecksetzen() {
    listenKopf.current?.focus({ preventScroll: true });
    void navigate({ search: { stand: suche.stand }, replace: true });
  }
  const abfrage = useInfiniteQuery({ ...journal(fondsId, filter), enabled: !zeitraumUngueltig });
  const zeilen = (abfrage.data?.pages ?? []).flatMap((p) => p.daten);
  const summen = abfrage.data?.pages[0]?.summen ?? null;
  const zeilenIndex = new Map(zeilen.map((zeile, index) => [zeile.id, index]));
  const schreiben = darf("bearbeiter", fondsId, "finanzen") && !suche.stand;
  const { data: vorlagen } = useQuery({ ...belegvorlagen(fondsId), enabled: schreiben });
  const freieBelegart = vorlagen?.some((v) => v.art === "frei" && v.aktiv);
  const detailSuche = suche.stand ? { stand: suche.stand } : {};

  // Das Scroll-Fenster erscheint erst mit den Daten; als State gehalten, meldet es sich beim Virtualisierer, sobald es da ist.
  // Die Tabelle ist selbst das eine Scroll-Fenster (waagerecht und senkrecht): Kopf klebt oben, die Aktionsspalte klebt rechts. Die Zeilen beginnen unter dem Kopf (`scrollMargin`).
  const [fenster, setFenster] = useState<HTMLDivElement | null>(null);
  const [kopfHoehe, setKopfHoehe] = useState(ZEILENHOEHE);
  const [kopf, setKopf] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!kopf) return;
    const messen = () => {
      if (kopf.offsetHeight > 0) setKopfHoehe(kopf.offsetHeight);
    };
    messen();
    if (typeof ResizeObserver === "undefined") return;
    const beobachter = new ResizeObserver(messen);
    beobachter.observe(kopf);
    return () => beobachter.disconnect();
  }, [kopf]);
  const virtualisierer = useVirtualizer({
    count: zeilen.length,
    getItemKey: (index) => zeilen[index]!.id,
    getScrollElement: () => fenster,
    scrollMargin: kopfHoehe,
    estimateSize: () => ZEILENHOEHE,
    overscan: 8,
    // Startgröße für Umgebungen ohne Layout (Tests): ohne sie rendert die Liste keine Zeile.
    initialRect: { width: 1100, height: FENSTERHOEHE },
    observeElementRect: (instanz, rueckruf) => observeElementRect(instanz, (rect) => rueckruf(rect.height === 0 ? { width: rect.width || 1100, height: FENSTERHOEHE } : rect)),
  });

  function zeilenDialogOeffnen(art: "storno" | "beleg", zeile: JournalZeile) {
    fokusNachDialog.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setZeilenDialog({ art, zeile });
  }

  function zeilenDialogSchliessen(buchungGeaendert = false) {
    fokusRueckgabe.current = { buchungGeaendert };
    setZeilenDialog(null);
  }

  useEffect(() => {
    if (zeilenDialog || !fokusRueckgabe.current) return;
    const { buchungGeaendert } = fokusRueckgabe.current;
    const ausloeser = fokusNachDialog.current;
    fokusRueckgabe.current = null;
    fokusNachDialog.current = null;

    // Nach dem Schließen kann die betroffene Zeile oder ihre letzte Aktion entfallen.
    const ziel = !buchungGeaendert && ausloeser?.isConnected ? ausloeser : fenster ?? listenKopf.current;
    ziel?.focus({ preventScroll: true });
  }, [zeilenDialog, fenster]);

  const setze = (teil: Partial<Record<"von" | "bis" | "typ" | "beteiligungId" | "bewertungen", string>>) =>
    void navigate({
      search: (alt) => {
        const neu: Record<string, unknown> = { ...alt };
        for (const [k, v] of Object.entries(teil)) {
          if (v === undefined || v === "") delete neu[k];
          else neu[k] = v;
        }
        return neu as typeof alt;
      },
      replace: true,
    });

  function gegenbuchung(id: string, text: string) {
    const index = zeilenIndex.get(id);
    if (index === undefined) return <span title={j.gegenbuchungNichtGeladen}>{text}</span>;
    return (
      <Button variante="sekundaer" groesse="s" aria-label={`${text}: ${j.springeZu}`} onClick={() => {
        fenster?.focus({ preventScroll: true });
        virtualisierer.scrollToIndex(index, { align: "center" });
      }}>
        {text}
      </Button>
    );
  }
  const typName = (typ: string) => aufzaehlung(j.typen, typ);
  type Summenzeile = { typ: string; anzahl: number; summe: string | null; kasse: string | null };
  const geld = (w: string | null) => (w === null ? t.gemeinsam.keinWert : formatBetragCent(w, sprache, waehrung));
  const summenSpalten: TabelleSpalte<Summenzeile>[] = [
    { schluessel: "typ", kopf: j.summen.typ, zelle: (x) => x.typ },
    { schluessel: "anzahl", kopf: j.summen.anzahl, zahl: true, zelle: (x) => x.anzahl },
    { schluessel: "summe", kopf: j.summen.summe, zahl: true, zelle: (x) => geld(x.summe) },
    { schluessel: "kasse", kopf: j.summen.kasse, zahl: true, zelle: (x) => geld(x.kasse) },
  ];

  function herkunft(z: JournalZeile) {
    const h = z.herkunft;
    const text = aufzaehlung(j.herkunft, h.art);
    if (h.art === "zinslauf" && h.id) return <Link to="/zinslaeufe/$id" params={{ id: h.id }}>{text}</Link>;
    if (h.art === "import" && h.id) return <Link to="/import/$id" params={{ id: h.id }}>{text}</Link>;
    if ((h.art === "runde" || h.art === "wandlung" || h.art === "verkauf") && z.beteiligung) return <Link to="/beteiligungen/$id" params={{ id: z.beteiligung.id }} search={detailSuche}>{text}</Link>;
    return text;
  }

  return (
    <div className="app-seite">
      <Seitenkopf
        meta={
          <>
            <Link to="/fonds/$fondsId" params={{ fondsId }} search={detailSuche}>
              {j.zurueck}
            </Link>
            {" · "}
            <span lang={DATENSPRACHE}>{fondsName}</span>
          </>
        }
        titel={j.titel}
        aktionen={schreiben ? <Button onClick={() => setNeu(true)}>{j.neueBuchung}</Button> : undefined}
      />
      <p className="app-leer-text">{j.beschreibung(fondsName)}</p>
      <NurLesen fondsId={fondsId} bereich="finanzen" />
      {suche.stand ? <Hinweis>{j.stand}</Hinweis> : null}

      <form className="app-filter app-filter--leiste app-journal-filter" aria-label={j.filter.beschriftung} onSubmit={(e) => e.preventDefault()}>
        <div className="app-journal-filter__valuta" role="group" aria-label={j.spalten.valuta}>
          <span className="app-journal-filter__gruppe" aria-hidden="true">{j.spalten.valuta}</span>
          <Feld kompakt label={j.filter.valutaVon} type="date" value={suche.von ?? ""} onChange={(e) => setze({ von: e.target.value })} />
          <Feld kompakt label={j.filter.valutaBis} type="date" fehler={zeitraumUngueltig ? j.filter.zeitraumUngueltig : undefined} value={suche.bis ?? ""} onChange={(e) => setze({ bis: e.target.value })} />
        </div>
        <Auswahl kompakt label={j.filter.typ} value={suche.typ ?? ""} onChange={(e) => setze({ typ: e.target.value })}>
          <option value="">{j.filter.alleTypen}</option>
          {TYPEN.map((x) => (
            <option key={x} value={x}>
              {typName(x)}
            </option>
          ))}
        </Auswahl>
        <Auswahl kompakt label={j.filter.beteiligung} value={suche.beteiligungId ?? ""} onChange={(e) => setze({ beteiligungId: e.target.value })}>
          <option value="">{j.filter.alleBeteiligungen}</option>
          {(uebersicht.data?.beteiligungen ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.organisation.name}
            </option>
          ))}
        </Auswahl>
        <label className="app-haken">
          <input type="checkbox" checked={suche.bewertungen === "1"} onChange={(e) => setze({ bewertungen: e.target.checked ? "1" : "" })} /> {j.filter.bewertungen}
        </label>
      </form>

      <section className="app-journal-buchungen" aria-labelledby="journal-buchungen">
        <div className="app-journal-buchungen__kopf">
          <h2 ref={listenKopf} id="journal-buchungen" className="cw-t-untertitel" tabIndex={-1}>{j.buchungen}</h2>
          {!zeitraumUngueltig ? <div className="app-aktionen" role="group" aria-label={j.export.beschriftung}>
            <ButtonLink href={exportUrl(fondsId, filter, "csv", sprache)} download variante="sekundaer" groesse="s">
              {j.export.csv}
            </ButtonLink>
            <ButtonLink href={exportUrl(fondsId, filter, "xlsx", sprache)} download variante="sekundaer" groesse="s">
              {j.export.xlsx}
            </ButtonLink>
          </div> : null}
        </div>
        {!zeitraumUngueltig && abfrage.isPending ? <Skelettzeilen anzahl={6} /> : null}
        {abfrage.error ? (
          <>
            <FehlerHinweis fehler={abfrage.error} />
            {!abfrage.data ? <Button variante="sekundaer" disabled={abfrage.isFetching} onClick={() => void abfrage.refetch()}>{t.gemeinsam.erneutVersuchen}</Button> : null}
          </>
        ) : null}
        {abfrage.data && zeilen.length === 0 ? (
          <Leer
            kompakt
            titel={<span role="status">{hatFilter ? j.keineGefiltert : j.keine}</span>}
            aktion={hatFilter ? <Button variante="sekundaer" groesse="s" onClick={filterZuruecksetzen}>{j.filter.zuruecksetzen}</Button> : null}
          />
        ) : null}
        {zeilen.length > 0 ? (
          <>
            <div ref={setFenster} role="table" aria-label={j.tabelle} aria-rowcount={zeilen.length + 1} className={schmal ? "app-journal app-journal--schmal" : "app-journal"} style={{ height: Math.min(FENSTERHOEHE, virtualisierer.getTotalSize()) + kopfHoehe }} tabIndex={0}>
              <div ref={setKopf} role="row" className="app-journal__zeile app-journal__kopf">
                {journalSpalten.map((k) => (
                  <div key={k} role="columnheader" className={k === "betrag" || k === "kasse" ? "app-zahl" : undefined}>
                    {k === "aktion" ? <span className="cw-nur-lesen">{j.spalten[k]}</span> : j.spalten[k]}
                  </div>
                ))}
              </div>
              <div className="app-journal__fenster" role="rowgroup" aria-label={j.tabelle}>
                <div style={{ height: virtualisierer.getTotalSize(), position: "relative" }}>
                  {virtualisierer.getVirtualItems().map((v) => {
                    const z = zeilen[v.index]!;
                    const istStorno = z.stornoVon !== null;
                    const kannStornieren = schreiben && !istStorno && !z.storniertDurch && z.quelle === "vorgang";
                    const aktionen: MenueEintrag[] = [];
                    if (schreiben && ((z.quelle === "fondsbewegung" && (z.typ === "abruf" || z.typ === "ausschuettung")) || (z.quelle === "vorgang" && freieBelegart))) {
                      aktionen.push({ id: "beleg", label: t.buchhaltung.erzeugen.knopf, onClick: () => zeilenDialogOeffnen("beleg", z) });
                    }
                    if (kannStornieren) {
                      aktionen.push({ id: "storno", label: t.stornoForm.knopf, gefahr: true, onClick: () => zeilenDialogOeffnen("storno", z) });
                    }
                    const typ = typName(z.typ) + (z.kapitalisiert ? ` (${j.kapitalisiert})` : "");
                    const betrag = geld(z.betrag);
                    const zellen = {
                      valuta: (
                        <div role="cell">{formatDatum(z.valuta, sprache)}</div>
                      ),
                      erfasst: (
                        <div role="cell" title={formatZeitpunkt(z.erfasstAm, sprache)}>{formatDatum(z.erfasstAm.slice(0, 10), sprache)}</div>
                      ),
                      typ: (
                        <div role="cell" className="app-journal__typ" title={typ}>
                          {z.quelle === "fondsbewegung" ? (
                            <Link to="/fonds" search={{ fondsId, tab: "kapital", bewegungId: z.id, ...detailSuche }} aria-label={j.kapitalbewegungOeffnen(typ)}>
                              {typ}
                            </Link>
                          ) : typ}
                        </div>
                      ),
                      unternehmen: (
                        <div role="cell" className="app-journal__unternehmen">{z.beteiligung ? <Link to="/beteiligungen/$id" params={{ id: z.beteiligung.id }} search={detailSuche} title={z.beteiligung.organisationName}>{z.beteiligung.organisationName}</Link> : t.gemeinsam.keinWert}</div>
                      ),
                      instrument: (
                        <div role="cell" title={z.instrumentBezeichnung ?? undefined}>{z.instrumentBezeichnung ?? t.gemeinsam.keinWert}</div>
                      ),
                      betrag: (
                        <div role="cell" className="app-zahl app-journal__betrag">
                          {schmal ? betrag.replace(/\s/g, " ") : betrag}
                        </div>
                      ),
                      kasse: (
                        <div role="cell" className="app-zahl app-journal__kasse">
                          {z.kassenwirkung === null ? (
                            t.gemeinsam.keinWert
                          ) : (
                            <>
                              <span>{formatBetragCent(z.kassenwirkung, sprache, waehrung)}</span> <span className="app-journal__richtung">({aufzaehlung(j.richtung, z.richtung ?? "")})</span>
                            </>
                          )}
                        </div>
                      ),
                      storno: (
                        <div role="cell">
                          {z.stornoVon ? gegenbuchung(z.stornoVon, j.stornoVon) : null}
                          {z.storniertDurch ? gegenbuchung(z.storniertDurch, j.storniert) : null}
                          {z.verweis?.storniert ? <Status variante="fehlt">{j.verkaufStorniert}</Status> : null}
                        </div>
                      ),
                      herkunft: (
                        <div role="cell" className="app-journal__herkunft">
                          {herkunft(z)}
                          {z.erfasstVon?.name ? <span className="app-dubletten__info">{z.erfasstVon.name}</span> : null}
                          {z.buchhaltung?.belegnummer ? <span className="app-dubletten__info">{j.belegNummer(z.buchhaltung.belegnummer)}</span> : null}
                          {z.buchhaltung?.exportiertAm ? <span className="app-dubletten__info">{j.exportiertAm(formatDatum(z.buchhaltung.exportiertAm.slice(0, 10), sprache))}</span> : null}
                        </div>
                      ),
                      aktion: (
                        <div role="cell">
                          {aktionen.length > 0 ? (
                            <Menue
                              portal
                              ausloeser={<DotsThreeIcon />}
                              aria-label={j.zeilenaktionen(typName(z.typ), formatDatum(z.valuta, sprache), z.beteiligung?.organisationName)}
                              ausloeserKlasse="cw-button cw-button--ruhig cw-button--icon app-journal__menueknopf"
                              eintraege={aktionen}
                            />
                          ) : null}
                        </div>
                      ),
                    };
                    return (
                      <div
                        key={z.id}
                        role="row"
                        aria-rowindex={v.index + 2}
                        data-gruppenende={(v.index + 1) % 5 === 0 || undefined}
                        className="app-journal__zeile"
                        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: ZEILENHOEHE, transform: `translateY(${v.start - virtualisierer.options.scrollMargin}px)` }}
                      >
                        {journalSpalten.map((schluessel) => <Fragment key={schluessel}>{zellen[schluessel]}</Fragment>)}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <p className="app-leer-text">{j.geladen(zeilen.length)}</p>
            {abfrage.hasNextPage ? (
              <Button variante="sekundaer" disabled={abfrage.isFetchingNextPage} onClick={() => void abfrage.fetchNextPage()}>
                {j.ladeMehr}
              </Button>
            ) : null}
          </>
        ) : null}
      </section>

      {summen ? (
        <section className="app-karte" aria-labelledby="journal-summen">
          <h2 id="journal-summen" className="cw-t-untertitel app-karte__titel">
            {j.summen.titel}
          </h2>
          <p className="app-leer-text">{j.summen.beschreibung}</p>
          <Tabelle
            beschriftung={j.summen.tabelle}
            spalten={summenSpalten}
            zeilen={[...summen.nachTyp.map((x) => ({ typ: typName(x.typ), anzahl: x.anzahl, summe: x.summe, kasse: x.kassenwirkung })), { typ: j.summen.gesamt, anzahl: summen.gesamt.anzahl, summe: null, kasse: summen.gesamt.kassenwirkung }]}
            zeilenSchluessel={(x) => x.typ}
          />
        </section>
      ) : null}

      {neu ? <BuchungDialog fondsId={fondsId} waehrung={waehrung} onSchliessen={() => setNeu(false)} /> : null}
      {zeilenDialog?.art === "storno" ? <BuchungsStornoDialog zeile={zeilenDialog.zeile} waehrung={waehrung} onSchliessen={zeilenDialogSchliessen} onErfolg={() => zeilenDialogSchliessen(true)} /> : null}
      {zeilenDialog?.art === "beleg" ? (
        <BelegPanel art={zeilenDialog.zeile.quelle === "vorgang" ? "frei" : zeilenDialog.zeile.typ === "abruf" ? "kapitalabruf" : "ausschuettung"} bezugArt={zeilenDialog.zeile.quelle === "vorgang" ? "vorgang" : "fonds_bewegung"} bezugId={zeilenDialog.zeile.id} fondsId={fondsId} onSchliessen={zeilenDialogSchliessen} />
      ) : null}
    </div>
  );
}

/** Von Hand buchbare Vorgänge; die Wertberichtigung steht bei der Beteiligung unter Bewertungen. */
const VORGANG_ARTEN = ["zusage", "auszahlung", "zinszahlung", "dividende", "tilgung", "rueckfluss"] as const;

/** Erfasst einen Vorgang für ein Instrument einer Beteiligung des Fonds; Instrument und (bei Auszahlungen) Tranche folgen der Beteiligung. */
function BuchungDialog({ fondsId, waehrung, onSchliessen }: { fondsId: string; waehrung: string | undefined; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const b = t.journal.buchung;
  const anlegen = useBuchungAnlegen(fondsId);
  const uebersicht = useQuery(fondsUebersicht(fondsId));
  const { werte, feld, pruefeAlle } = useFormular(
    { typ: "zusage", beteiligungId: "", instrumentId: "", trancheId: "", valuta: heuteIso(), betrag: "", bemerkung: "" },
    { beteiligungId: pflichtRegel(), valuta: datumRegel({ pflicht: true }), betrag: betragRegel({ vorzeichen: "positiv", pflicht: true }) },
  );
  const [fertig, setFertig] = useState<string | null>(null);
  const fehler = (name: string) => feldText(t, anlegen.error, name);
  const f = t.vorgangForm;
  const typ = werte.typ as (typeof VORGANG_ARTEN)[number];
  // Die Instrumente der gewählten Beteiligung; das gewählte gilt nur, solange es die Art erlaubt, mit genau einem passenden ist es vorbelegt.
  const { data: daten } = useQuery({ ...instrumentdaten(werte.beteiligungId), enabled: werte.beteiligungId !== "" });
  const erlaubte = (daten?.instrumente ?? []).filter((i) => erlaubtFuer(typ, i) && (typ !== "auszahlung" || i.status === "aktiv"));
  const instrumentId = erlaubte.some((i) => i.id === werte.instrumentId) ? werte.instrumentId : erlaubte.length === 1 ? erlaubte[0]!.id : "";
  const instrument = erlaubte.find((i) => i.id === instrumentId);
  const offeneTranchen = typ === "auszahlung" && instrument ? instrument.tranchen.filter(trancheOffen) : [];
  const trancheId = offeneTranchen.some((x) => x.id === werte.trancheId) ? werte.trancheId : "";
  const tranche = offeneTranchen.find((x) => x.id === trancheId);
  const gesperrt = tranche !== undefined && tranche.stand.bedingung === "offen";
  const instrumentFehlt = werte.beteiligungId !== "" && daten !== undefined && instrumentId === "";

  function senden() {
    const koerper = {
      typ,
      beteiligungId: werte.beteiligungId,
      ...(instrumentId ? { instrumentId } : {}),
      ...(trancheId && typ === "auszahlung" ? { trancheId } : {}),
      valuta: werte.valuta,
      betrag: betragOderNichts(werte.betrag, sprache) ?? "",
      bemerkung: textOderNichts(werte.bemerkung),
    } satisfies NeueBuchung;
    anlegen.mutate(koerper, { onSuccess: (antwort) => setFertig("buchwert" in antwort ? b.gebuchtBuchwert(formatBetragCent(antwort.buchwert, sprache, waehrung)) : b.gebucht) });
  }

  return (
    <Seitenpanel titel={b.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{b.titel}</h2>
      {fertig ? (
        <Hinweis>{fertig}</Hinweis>
      ) : (
        <form
          className="app-formular"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!pruefeAlle()) return;
            senden();
          }}
        >
          <p className="app-leer-text">{b.beschreibung}</p>
          <FehlerHinweis fehler={anlegen.error} bekannt={["typ", "beteiligungId", "instrumentId", "trancheId", "valuta", "betrag", "bemerkung"]} />
          <Auswahl label={b.typ} {...feld("typ")} fehler={fehler("typ")}>
            {VORGANG_ARTEN.map((a) => (
              <option key={a} value={a}>
                {aufzaehlung(t.journal.typen, a)}
              </option>
            ))}
          </Auswahl>
          <Auswahl label={b.beteiligung} {...feld("beteiligungId", fehler("beteiligungId"))}>
            <option value="">{b.beteiligungWaehlen}</option>
            {(uebersicht.data?.beteiligungen ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {x.organisation.name}
              </option>
            ))}
          </Auswahl>
          {werte.beteiligungId !== "" ? (
            <Auswahl label={f.instrument} {...feld("instrumentId")} value={instrumentId} required={erlaubte.length > 1} fehler={fehler("instrumentId")}>
              {erlaubte.length !== 1 ? <option value="" /> : null}
              {erlaubte.map((i) => (
                <option key={i.id} value={i.id}>
                  {f.instrumentOption(i.bezeichnung, i.status === "aktiv" ? null : aufzaehlung(t.instrumenteAbschnitt.status, i.status))}
                </option>
              ))}
            </Auswahl>
          ) : null}
          {instrumentFehlt && erlaubte.length === 0 ? <p className="app-leer-text">{b.keinInstrument}</p> : null}
          {offeneTranchen.length > 0 ? (
            <Auswahl label={f.tranche} {...feld("trancheId")} value={trancheId} fehler={fehler("trancheId")} aria-describedby={gesperrt ? "tranche-gesperrt" : undefined}>
              <option value="">{f.keineTranche}</option>
              {offeneTranchen.map((x) => (
                <option key={x.id} value={x.id}>
                  {f.trancheOption(x.nummer ?? 0, x.bezeichnung, formatBetrag(x.stand.offen, sprache), x.stand.bedingung === "offen")}
                </option>
              ))}
            </Auswahl>
          ) : null}
          {gesperrt && tranche ? (
            <Hinweis id="tranche-gesperrt" titel={f.trancheOffenTitel}>
              {f.trancheOffen(tranche.bezeichnung)}
            </Hinweis>
          ) : null}
          <Feld label={b.valuta} type="date" {...feld("valuta", fehler("valuta"))} />
          <BetragFeld label={b.betrag} {...feld("betrag", fehler("betrag"))} />
          <Feld label={b.bemerkung} autoComplete="off" {...feld("bemerkung")} fehler={fehler("bemerkung")} />
          <div>
            <Button type="submit" disabled={anlegen.isPending || gesperrt || (werte.beteiligungId !== "" && instrumentId === "")} aria-describedby={gesperrt ? "tranche-gesperrt" : undefined}>
              {b.buchen}
            </Button>
          </div>
        </form>
      )}
    </Seitenpanel>
  );
}
