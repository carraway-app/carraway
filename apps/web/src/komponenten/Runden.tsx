import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowsClockwiseIcon, Auswahl, Button, CaretLeftIcon, CaretRightIcon, Fakten, Feld, Hinweis, InfoIcon, ListIcon, QuestionIcon, Segment, StackIcon, Status, Tabelle, UnterTabs, formatBetrag, formatDatum, formatProzent, type Sprache, type TabelleSpalte, type MenueEintrag } from "@carraway/ui";
import { anteilsklassen, finanzierungsrunden, fondsListe, mitarbeiterpools, rundentransaktionen, rundenVorschau, vehikelDesInvestors, type Rundentransaktionen, type Finanzierungsrunde, type RundenPosition, type RundenVorschauEingabe } from "../api/abfragen";
import { ApiFehler } from "../api/client";
import { heuteIso } from "../api/datum";
import {
  useFinanzierungsrundeAnlegen,
  useOrganisationAnlegen,
  useRundeAbschliessen,
  useRundeAendern,
  useRundeLoeschen,
  useRundenPositionAendern,
  useRundenPositionAnlegen,
  useRundenPositionEntfernen,
  useRundeWiedereroeffnen,
  useVehikelAnlegen,
  useZahlungAnlegen,
  type NeueRunde,
} from "../api/mutationen";
import { feldText } from "../i18n/fehler";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { useRechte } from "../lib/rechte";
import { formatAnzahl, formatBetragCent, formatPreis } from "../lib/zahl";
import { Seitenpanel } from "@carraway/ui";
import { DublettenBestaetigung, kandidatenAus } from "./Dubletten";
import { FehlerHinweis } from "./FehlerHinweis";
import { betragFuerFeld, betragOderNichts, textOderNichts, useEntprellt, useFormular } from "./formular";
import { BetragFeld } from "./BetragFeld";
import { betragRegel, datumRegel, ganzzahlRegel } from "../lib/feldpruefung";
import { VehikelAuswahl, vehikelLabel, type VehikelTreffer } from "./VehikelAuswahl";
import { Skelettzeilen } from "./Skelett";
import { TransaktionenKarte, alleTransaktionen, type TransaktionsZeile } from "./RundenTransaktionen";
import { POOL_SHUFFLE_START, PoolShuffle, aufstockungGueltig, poolAufstockungAus } from "./PoolShuffle";

/** Reiter ohne eigene Runde: Vorgänge ohne Zuordnung und die Liste aller Vorgänge. */
const REITER_OHNE = "ohne-runde";
const REITER_ALLE = "alle";

type Rolle = "lead" | "co_lead" | "co";
const ROLLEN: Rolle[] = ["lead", "co_lead", "co"];
type AnlegenPosition = NonNullable<NeueRunde["positionen"]>[number];

/** Name einer Position: der Fonds oder „Vehikel · Investor“. */
const positionsName = (p: RundenPosition) => (p.vehikel ? vehikelLabel(p.vehikel.name, p.investor.name) : p.investor.name);

/** Werte einer Prüfmeldung der API für den Satz: Beträge mit Cent, Anteile als Zahl, Preis mit vier Stellen. */
function formatiereWerte(w: Record<string, string>, sprache: Sprache): Record<string, string> {
  const geld = new Set(["postMoney", "volumen", "betrag"]);
  const anzahl = new Set(["anteileGesamtNach", "anteileVergeben", "anteile"]);
  const aus: Record<string, string> = {};
  for (const [k, v] of Object.entries(w)) aus[k] = k === "preisJeAnteil" ? formatPreis(v, sprache) : geld.has(k) ? formatBetragCent(v, sprache) : anzahl.has(k) ? formatAnzahl(v, sprache) : v;
  // `erwartet` ist je nach Code ein Betrag (Post-Money) oder eine Zahl von Anteilen.
  return aus;
}

/** Dezimalzahl als Zeichenkette in ganzen Zehntausendsteln (exakt, ohne Gleitkomma); `null` bei fehlendem oder ungültigem Wert. */
function inZehntausendstel(wert: string | null | undefined): bigint | null {
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec((wert ?? "").trim());
  if (!m) return null;
  const v = BigInt(m[2]!) * 10000n + BigInt((m[3] ?? "").padEnd(4, "0").slice(0, 4));
  return m[1] ? -v : v;
}

/** Summe; `null`, sobald ein Wert fehlt. */
function summiere(werte: (string | null | undefined)[]): bigint | null {
  let summe = 0n;
  for (const w of werte) {
    const v = inZehntausendstel(w);
    if (v === null) return null;
    summe += v;
  }
  return summe;
}

/** Zehntausendstel als Betrag in Cent-Schreibweise (`1234.50`, kaufmännisch gerundet). */
function alsBetrag(z: bigint): string {
  const neg = z < 0n;
  const cent = ((neg ? -z : z) + 50n) / 100n;
  return `${neg ? "-" : ""}${cent / 100n}.${String(cent % 100n).padStart(2, "0")}`;
}

/** Zehntausendstel als Zahl ohne überflüssige Nachkommastellen. */
function alsZahl(z: bigint): string {
  const neg = z < 0n;
  const a = neg ? -z : z;
  const frac = String(a % 10000n).padStart(4, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${a / 10000n}${frac ? `.${frac}` : ""}`;
}

/** Anteil an den Anteilen nach der Runde in Prozent mit zwei Stellen (`6.21`); `null` ohne Anteile oder ohne Gesamtzahl. */
export function anteilNachRunde(anteile: string | null | undefined, gesamt: string | null | undefined): string | null {
  const a = inZehntausendstel(anteile);
  const g = inZehntausendstel(gesamt);
  if (a === null || g === null || g === 0n) return null;
  const hundertstel = (a * 10000n * 2n + g) / (g * 2n); // Hundertstel Prozent, gerundet
  return `${hundertstel / 100n}.${String(hundertstel % 100n).padStart(2, "0")}`;
}

interface PruefMeldung {
  code: string;
  schwere: string;
  werte: Record<string, string>;
}

export interface RundenDublette {
  id: string;
  bezeichnung: string;
  datum: string;
  gleichesDatum: boolean;
  gleicherPreis: boolean;
}

/** Hinweis auf Runden desselben Unternehmens mit gleichem Datum oder Preis je Anteil; die API meldet, die Runde bleibt anlegbar. */
export function RundenDubletten({ dubletten }: { dubletten: RundenDublette[] | undefined }) {
  const t = useT();
  const sprache = useSprache();
  const d = t.finanzierungsrunden.dubletten;
  if (!dubletten || dubletten.length === 0) return null;
  return (
    <Hinweis variante="info" titel={d.titel}>
      <ul className="app-liste">
        {dubletten.map((x) => (
          <li key={x.id}>{d.zeile(x.bezeichnung, formatDatum(x.datum, sprache), aufzaehlung(d.gruende, x.gleichesDatum && x.gleicherPreis ? "beides" : x.gleichesDatum ? "datum" : "preis"))}</li>
        ))}
      </ul>
      <span className="app-leer-text">{d.hilfe}</span>
    </Hinweis>
  );
}

/** Die Prüfung der API als Liste; die Sätze stehen in den Texten, gerechnet wird nichts. */
function Pruefung({ abweichungen, ok = true, vorlaeufig }: { abweichungen: PruefMeldung[]; ok?: boolean; vorlaeufig?: boolean | undefined }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.finanzierungsrunden;
  if (abweichungen.length === 0) {
    if (!ok && !vorlaeufig) return null;
    return <Hinweis variante="info">{vorlaeufig ? f.pruefungVorlaeufig : f.pruefungOk}</Hinweis>;
  }
  return (
    <Hinweis variante={abweichungen.some((a) => a.schwere === "fehler") ? "fehler" : "info"} titel={f.pruefung}>
      {vorlaeufig ? <p>{f.pruefungVorlaeufig}</p> : null}
      <ul className="app-liste">
        {abweichungen.map((a, i) => {
          const werte = formatiereWerte(a.werte, sprache);
          if (a.code === "POST_MONEY_ABWEICHEND" && a.werte.erwartet) werte.erwartet = formatBetragCent(a.werte.erwartet, sprache);
          if ((a.code === "ANTEILE_PREIS_ABWEICHEND" || a.code === "POSITION_PREIS_ABWEICHEND") && a.werte.erwartet) werte.erwartet = formatAnzahl(a.werte.erwartet, sprache);
          const satz = f.hinweise[a.code];
          return (
            <li key={`${a.code}-${i}`}>
              <strong>{a.schwere === "fehler" ? f.hinweisFehler : f.hinweisHinweis}:</strong> {satz ? satz(werte) : a.code}
            </li>
          );
        })}
      </ul>
    </Hinweis>
  );
}

type RundenDialog =
  | { art: "neu" }
  | { art: "abschliessen" | "wieder" | "bearbeiten" | "positionNeu"; runde: Finanzierungsrunde }
  | { art: "zahlung"; runde: Finanzierungsrunde; position: RundenPosition }
  | { art: "positionAendern"; runde: Finanzierungsrunde; position: RundenPosition };

/**
 * Abschnitt „Finanzierungsrunden“ eines Unternehmens: oben die Runden als Reiter (neueste zuerst, mit Name, Datum und Volumen), darunter die gewählte Runde mit Fakten, Positionen, Prüfung und Zahlungsstand der Co-Investoren; neue Runde,
 * Abschließen mit Buchungen des eigenen Fonds, Wiedereröffnen (Verwalter) und Zahlungen. Die API rechnet und entscheidet, die Oberfläche bietet
 * nur an, was die Rolle erlaubt. Entwürfe lassen sich bearbeiten (Stammdaten, Positionen ändern, entfernen, hinzufügen). Im früheren Wissensstand
 * (`lesend`) bleibt alles bei der Ansicht. `verbotenOkay`: Auf der Organisationsseite kann es sein, dass die gewählte Rolle noch keine Runde des
 * Unternehmens sieht (403); die Liste ist dann leer, und neue Runden lassen sich trotzdem anlegen.
 */
export function RundenAbschnitt({
  organisationId,
  fondsId,
  lesend,
  rundeId,
  onRunde,
  verbotenOkay = false,
  onFelder,
}: {
  organisationId: string;
  fondsId: string;
  lesend: boolean;
  verbotenOkay?: boolean;
  /** Öffnet die eigenen Felder einer Runde (die Seite entscheidet, wo sie stehen); ohne Angabe gibt es den Knopf nicht. */
  onFelder?: (runde: { id: string; bezeichnung: string }) => void;
  /** Gewählte Runde aus der Adresse; mit `onRunde` führt die Seite die Auswahl (sonst bleibt sie im Zustand der Komponente). */
  rundeId?: string;
  onRunde?: (id: string) => void;
}) {
  const t = useT();
  const sprache = useSprache();
  const f = t.finanzierungsrunden;
  const { darf } = useRechte();
  const { data, error, isPending } = useQuery(finanzierungsrunden(organisationId));
  const transaktionen = useQuery(rundentransaktionen(organisationId));
  const loeschen = useRundeLoeschen();
  const positionEntfernen = useRundenPositionEntfernen();
  const [dialog, setDialog] = useState<RundenDialog | null>(null);
  const [eigeneWahl, setEigeneWahl] = useState<string | null>(null);
  const gewaehlt = onRunde ? (rundeId ?? null) : eigeneWahl;
  const setGewaehlt = (id: string) => (onRunde ? onRunde(id) : setEigeneWahl(id));
  const schreiben = darf("bearbeiter", fondsId, "portfolio") && !lesend;
  const verwalten = darf("verwalter", fondsId, "portfolio") && !lesend;

  // Neueste zuerst; Vorgabe ist die neueste abgeschlossene Runde, sonst die erste der Liste.
  const runden = [...(data ?? [])].sort((a, b) => b.datum.localeCompare(a.datum));
  const tx = transaktionen.data;
  const ohne = tx?.ohneRunde ?? [];
  const alle = tx ? alleTransaktionen(tx) : [];
  const gruppen = new Map((tx?.runden ?? []).map((g) => [g.id, g]));
  const reiterIds = [...runden.map((x) => x.id), ...(ohne.length > 0 ? [REITER_OHNE] : []), ...(tx && alle.length > 0 ? [REITER_ALLE] : [])];
  const aktiv = gewaehlt !== null && reiterIds.includes(gewaehlt) ? gewaehlt : ((runden.find((x) => x.art !== "bruecke" && x.status === "abgeschlossen") ?? runden[0])?.id ?? reiterIds[0]);
  const r = runden.find((x) => x.id === aktiv);
  // Blättern in zeitlicher Folge: die Liste steht neueste zuerst, die vorherige Runde ist also die nächste in der Liste.
  const position = r ? runden.indexOf(r) : -1;
  const vorherige = position >= 0 ? runden[position + 1] : undefined;
  const naechste = position > 0 ? runden[position - 1] : undefined;
  const blaettern =
    vorherige || naechste ? (
      <nav className="app-runden__blaettern" aria-label={f.blaettern}>
        {vorherige ? (
          <button type="button" className="app-runden__blatt" aria-label={f.vorherigeRunde(vorherige.bezeichnung)} onClick={() => setGewaehlt(vorherige.id)}>
            <CaretLeftIcon size={14} aria-hidden />
            {vorherige.bezeichnung}
          </button>
        ) : null}
        {naechste ? (
          <button type="button" className="app-runden__blatt" aria-label={f.naechsteRunde(naechste.bezeichnung)} onClick={() => setGewaehlt(naechste.id)}>
            {naechste.bezeichnung}
            <CaretRightIcon size={14} aria-hidden />
          </button>
        ) : null}
      </nav>
    ) : null;
  const txFehler = transaktionen.error && !(transaktionen.error instanceof ApiFehler && transaktionen.error.status === 403) ? transaktionen.error : null;
  const rundenKurz: Rundentransaktionen["runden"] = tx?.runden ?? [];
  const zeilenVon = (id: string): TransaktionsZeile[] => {
    const g = gruppen.get(id);
    return g ? g.transaktionen.map((z) => ({ ...z, runde: { id: g.id, bezeichnung: g.bezeichnung, art: g.art } })) : [];
  };

  return (
    <section className="app-karte app-runden-bereich" aria-label={f.titel}>
      <div className="app-runden__werkzeug">
        <p className="app-hinweiszeile">
          <InfoIcon size={16} aria-hidden />
          <span>{f.beschreibung}</span>
        </p>
        {schreiben ? <Button onClick={() => setDialog({ art: "neu" })}>{f.neu}</Button> : null}
      </div>
      {lesend ? <Hinweis>{f.stand}</Hinweis> : null}
      <FehlerHinweis fehler={loeschen.error ?? positionEntfernen.error} />
      {isPending ? <Skelettzeilen anzahl={2} /> : null}
      {error && !(error instanceof ApiFehler && error.status === 403 && verbotenOkay) ? <FehlerHinweis fehler={error} /> : null}
      {data === undefined && error && verbotenOkay ? <p className="app-leer-text">{f.keine}</p> : null}
      {data && data.length === 0 && reiterIds.length === 0 ? <p className="app-leer-text">{f.keine}</p> : null}
      {aktiv ? (
        <UnterTabs
          aria-label={f.liste}
          aktiv={aktiv}
          onWechsel={setGewaehlt}
          tabs={[
            ...runden.map((x) => ({
              id: x.id,
              icon: x.art === "bruecke" ? ArrowsClockwiseIcon : StackIcon,
              label: (
                <span className="app-runde__reiter">
                  <span className="app-runde__kopf">
                    {x.bezeichnung}
                    {x.art === "bruecke" ? <Status>{f.bruecke}</Status> : <Status variante={x.status === "abgeschlossen" ? "freigegeben" : "pruefung"}>{aufzaehlung(f.status, x.status)}</Status>}
                  </span>
                  <span className="app-runde__meta">{x.art === "bruecke" ? formatDatum(x.datum, sprache) : `${formatDatum(x.datum, sprache)} · ${formatBetrag(x.pruefung.volumen, sprache, { kompakt: true })}`}</span>
                </span>
              ),
            })),
            ...(ohne.length > 0
              ? [
                  {
                    id: REITER_OHNE,
                    icon: QuestionIcon,
                    zaehler: ohne.length,
                    label: (
                      <span className="app-runde__reiter">
                        <span className="app-runde__kopf">{f.reiterOhne}</span>
                        <span className="app-runde__meta">{f.reiterOhneMeta}</span>
                      </span>
                    ),
                  },
                ]
              : []),
            ...(tx && alle.length > 0
              ? [
                  {
                    id: REITER_ALLE,
                    icon: ListIcon,
                    zaehler: alle.length,
                    label: (
                      <span className="app-runde__reiter">
                        <span className="app-runde__kopf">{f.reiterAlle}</span>
                        <span className="app-runde__meta">{f.reiterAlleMeta}</span>
                      </span>
                    ),
                  },
                ]
              : []),
          ]}
        >
          {r ? (
            <RundeDetail
              key={r.id}
              runde={r}
              blaettern={blaettern}
              fondsId={fondsId}
              schreiben={schreiben}
              verwalten={verwalten}
              lesend={lesend}
              sperrt={loeschen.isPending || positionEntfernen.isPending}
              onDialog={setDialog}
              onFelder={onFelder}
              onLoeschen={() => loeschen.mutate({ id: r.id })}
              onPositionEntfernen={(positionId) => positionEntfernen.mutate({ id: r.id, positionId })}
              transaktionen={tx ? { zeilen: zeilenVon(r.id), runden: rundenKurz } : null}
              transaktionenFehler={txFehler}
            />
          ) : (
            <div className="app-rundendetail">
              <FehlerHinweis fehler={txFehler} />
              {aktiv === REITER_OHNE ? (
                <TransaktionenKarte zeilen={ohne.map((z) => ({ ...z, runde: null }))} runden={rundenKurz} beschriftung={f.reiterOhne} beschreibung={f.transaktionen.beschreibungOhne} leer={f.transaktionen.keineOhne} lesend={lesend} />
              ) : (
                <TransaktionenKarte zeilen={alle} runden={rundenKurz} beschriftung={f.reiterAlle} beschreibung={f.transaktionen.beschreibungAlle} leer={f.transaktionen.keine} mitRunde lesend={lesend} />
              )}
            </div>
          )}
        </UnterTabs>
      ) : null}
      {dialog?.art === "neu" ? <NeueRundeDialog organisationId={organisationId} fondsId={fondsId} onAngelegt={setGewaehlt} onSchliessen={() => setDialog(null)} /> : null}
      {dialog?.art === "abschliessen" ? <AbschliessenDialog runde={dialog.runde} onSchliessen={() => setDialog(null)} /> : null}
      {dialog?.art === "wieder" ? <WiederDialog runde={dialog.runde} onSchliessen={() => setDialog(null)} /> : null}
      {dialog?.art === "bearbeiten" ? <RundeBearbeitenDialog runde={dialog.runde} onSchliessen={() => setDialog(null)} /> : null}
      {dialog?.art === "positionNeu" ? <PositionDialog runde={dialog.runde} fondsId={fondsId} onSchliessen={() => setDialog(null)} /> : null}
      {dialog?.art === "positionAendern" ? <PositionDialog runde={dialog.runde} fondsId={fondsId} position={dialog.position} onSchliessen={() => setDialog(null)} /> : null}
      {dialog?.art === "zahlung" ? <ZahlungDialog position={dialog.position} onSchliessen={() => setDialog(null)} /> : null}
    </section>
  );
}

function RundeDetail({
  runde: r,
  blaettern,
  fondsId,
  schreiben,
  verwalten,
  lesend,
  sperrt,
  onDialog,
  onFelder,
  onLoeschen,
  onPositionEntfernen,
  transaktionen,
  transaktionenFehler,
}: {
  runde: Finanzierungsrunde;
  /** Pfeile zur zeitlich vorherigen und nächsten Runde; links im Kopf, direkt unter der Reiterleiste. */
  blaettern?: ReactNode;
  fondsId: string;
  schreiben: boolean;
  verwalten: boolean;
  lesend: boolean;
  sperrt: boolean;
  onDialog: (dialog: RundenDialog) => void;
  onFelder?: (runde: { id: string; bezeichnung: string }) => void;
  onLoeschen: () => void;
  onPositionEntfernen: (positionId: string) => void;
  /** Transaktionen der Runde; `null`, solange sie fehlen (nicht geladen oder kein Recht). */
  transaktionen: { zeilen: TransaktionsZeile[]; runden: Rundentransaktionen["runden"] } | null;
  transaktionenFehler: unknown;
}) {
  const t = useT();
  const sprache = useSprache();
  const f = t.finanzierungsrunden;
  const b = t.beteiligung.runden;
  const entwurf = r.status === "entwurf";
  const anteilText = (prozent: string | null) => (prozent === null ? t.gemeinsam.keinWert : formatProzent(prozent, sprache, 2));
  // Summenzeile: Beträge und Anteile exakt als ganze Zahlen summiert; Gezahlt und Offen nur, wenn jede Position einen Wert hat (Fondspositionen haben keinen).
  const summeBetrag = summiere(r.positionen.map((p) => p.betrag));
  const summeAnteile = summiere(r.positionen.map((p) => p.anteile));
  const summeGezahlt = summiere(r.positionen.map((p) => p.gezahlt));
  const summeOffen = summiere(r.positionen.map((p) => p.offen));
  const summeAnteil = summeAnteile === null ? null : anteilNachRunde(alsZahl(summeAnteile), r.anteileGesamtNach);
  const fusszeile: Record<string, ReactNode> = {
    investor: f.summe,
    betrag: summeBetrag === null ? t.gemeinsam.keinWert : formatBetragCent(alsBetrag(summeBetrag), sprache),
    anteile: (
      <>
        {summeAnteile === null ? t.gemeinsam.keinWert : formatAnzahl(alsZahl(summeAnteile), sprache)}
        <span className="app-zelle-zusatz">{anteilText(summeAnteil)}</span>
      </>
    ),
    offen:
      summeOffen === null ? null : (
        <>
          {formatBetragCent(alsBetrag(summeOffen), sprache)}
          {summeGezahlt === null ? null : <span className="app-zelle-zusatz">{`${f.spalten.gezahlt} ${formatBetragCent(alsBetrag(summeGezahlt), sprache)}`}</span>}
        </>
      ),
  };
  const spalten: TabelleSpalte<RundenPosition>[] = [
    {
      schluessel: "investor",
      kopf: f.spalten.investor,
      umbruch: true,
      zelle: (p) => (
        <span className="app-zusammenhang">
          {p.investor.art === "organisation" ? (
            <span>
              {p.vehikel && p.vehikel.name !== p.investor.name ? `${p.vehikel.name} · ` : null}
              <Link to="/organizations/$id" params={{ id: p.investor.id }} search={{ tab: "engagement", unter: "vehikel" }}>
                {p.investor.name}
              </Link>
            </span>
          ) : (
            p.investor.name
          )}
          {p.investor.art === "fonds" && p.investor.id === fondsId ? <Status>{f.diesFonds}</Status> : null}
          {p.instrumentId && p.beteiligungId ? (
            <Link to="/investments/$id" params={{ id: p.beteiligungId }} search={{ tab: "finanzierung", unter: "instrumente" }} aria-label={f.zumInstrumentFuer(positionsName(p))}>
              {f.zumInstrument}
            </Link>
          ) : null}
          {/* Rolle unter dem Namen statt in eigener Spalte, damit die Tabelle bei 1280 px passt. */}
          <span className="app-zelle-zusatz" title={f.spalten.rolle}>{aufzaehlung(t.rundenRolle, p.rolle)}</span>
        </span>
      ),
    },
    { schluessel: "betrag", kopf: f.spalten.betrag, zahl: true, zelle: (p) => formatBetragCent(p.betrag, sprache) },
    {
      schluessel: "anteile",
      kopf: f.spalten.anteile,
      zahl: true,
      zelle: (p) => (
        <>
          {formatAnzahl(p.anteile, sprache)}
          <span className="app-zelle-zusatz" title={f.spalten.anteil}>{anteilText(anteilNachRunde(p.anteile, r.anteileGesamtNach))}</span>
        </>
      ),
    },
    { schluessel: "klasse", kopf: f.spalten.klasse, zelle: (p) => p.anteilsklasse?.name ?? f.stamm },
    {
      schluessel: "offen",
      kopf: f.spalten.offen,
      zahl: true,
      zelle: (p) => (
        <>
          {p.offen === null ? f.gebucht(p.buchungen.length) : formatBetragCent(p.offen, sprache)}
          {p.gezahlt === null ? null : <span className="app-zelle-zusatz">{`${f.spalten.gezahlt} ${formatBetragCent(p.gezahlt, sprache)}`}</span>}
        </>
      ),
    },
  ];
  // Aktionen je Position im Menü „⋯“ (statt Knöpfen in einer eigenen Spalte), damit die Tabelle bei 1280 px passt.
  const positionAktionen = (p: RundenPosition): MenueEintrag[] =>
    schreiben && entwurf
      ? [
          { id: "bearbeiten", label: f.positionBearbeitenFuer(positionsName(p)), onClick: () => onDialog({ art: "positionAendern", runde: r, position: p }) },
          { id: "entfernen", label: f.positionEntfernenFuer(positionsName(p)), gefahr: true, deaktiviert: sperrt, onClick: () => onPositionEntfernen(p.id) },
        ]
      : schreiben && p.investor.art === "organisation"
        ? [
            ...(p.vehikel ? [{ id: "vehikel", label: f.vehikelWechselnFuer(positionsName(p)), onClick: () => onDialog({ art: "positionAendern", runde: r, position: p }) }] : []),
            { id: "zahlung", label: f.zahlungFuer(positionsName(p)), onClick: () => onDialog({ art: "zahlung", runde: r, position: p }) },
          ]
        : [];
  if (r.art === "bruecke") {
    const leer = transaktionen === null || transaktionen.zeilen.length === 0;
    return (
      <article className="app-rundendetail" aria-label={`${r.bezeichnung}, ${formatDatum(r.datum, sprache)}`}>
        {schreiben || onFelder || blaettern ? (
          <header className="app-rundendetail__kopf">
            {blaettern}
            <div className="app-aktionen app-rundendetail__aktionen">
              {onFelder ? (
                <Button variante="sekundaer" aria-label={t.zusatzfelder.feldKnopfFuer(r.bezeichnung)} onClick={() => onFelder({ id: r.id, bezeichnung: r.bezeichnung })}>
                  {t.zusatzfelder.feldKnopf}
                </Button>
              ) : null}
              {schreiben ? (
                <Button variante="sekundaer" onClick={() => onDialog({ art: "bearbeiten", runde: r })}>
                  {f.brueckeBearbeiten}
                </Button>
              ) : null}
              {schreiben && leer ? (
                <Button variante="gefahr" disabled={sperrt} onClick={onLoeschen}>
                  {f.brueckeLoeschen}
                </Button>
              ) : null}
            </div>
          </header>
        ) : null}
        <Hinweis variante="info">{f.brueckeHinweis}</Hinweis>
        <FehlerHinweis fehler={transaktionenFehler} />
        {transaktionen ? <TransaktionenKarte zeilen={transaktionen.zeilen} runden={transaktionen.runden} beschriftung={r.bezeichnung} beschreibung={f.transaktionen.beschreibungRunde} leer={f.transaktionen.keine} lesend={lesend} /> : null}
      </article>
    );
  }
  return (
    <article className="app-rundendetail" aria-label={`${r.bezeichnung}, ${formatDatum(r.datum, sprache)}`}>
      {(schreiben && entwurf) || onFelder || (verwalten && !entwurf) || blaettern ? (
        <header className="app-rundendetail__kopf">
          {blaettern}
          <div className="app-aktionen app-rundendetail__aktionen">
            {schreiben && entwurf ? <Button onClick={() => onDialog({ art: "abschliessen", runde: r })}>{f.abschliessen}</Button> : null}
            {schreiben && entwurf ? (
              <Button variante="sekundaer" onClick={() => onDialog({ art: "bearbeiten", runde: r })}>
                {f.bearbeiten}
              </Button>
            ) : null}
            {schreiben && entwurf ? (
              <Button variante="sekundaer" onClick={() => onDialog({ art: "positionNeu", runde: r })}>
                {f.positionHinzu}
              </Button>
            ) : null}
            {onFelder ? (
              <Button variante="sekundaer" aria-label={t.zusatzfelder.feldKnopfFuer(r.bezeichnung)} onClick={() => onFelder({ id: r.id, bezeichnung: r.bezeichnung })}>
                {t.zusatzfelder.feldKnopf}
              </Button>
            ) : null}
            {verwalten && !entwurf ? (
              <Button variante="sekundaer" onClick={() => onDialog({ art: "wieder", runde: r })}>
                {f.wiedereroeffnen}
              </Button>
            ) : null}
            {schreiben && entwurf ? (
              <Button variante="gefahr" disabled={sperrt} onClick={onLoeschen}>
                {f.loeschen}
              </Button>
            ) : null}
          </div>
        </header>
      ) : null}
      <Fakten
        eintraege={[
          { label: b.preMoney, wert: <span className="app-zahl">{r.preMoney === null ? t.gemeinsam.keinWert : formatBetragCent(r.preMoney, sprache)}</span> },
          { label: b.postMoney, wert: <span className="app-zahl">{r.postMoney === null ? t.gemeinsam.keinWert : formatBetragCent(r.postMoney, sprache)}</span> },
          { label: b.preis, wert: <span className="app-zahl">{r.preisJeAnteil === null ? t.gemeinsam.keinWert : formatPreis(r.preisJeAnteil, sprache)}</span> },
          { label: b.anteileNach, wert: <span className="app-zahl">{r.anteileGesamtNach === null ? t.gemeinsam.keinWert : formatAnzahl(r.anteileGesamtNach, sprache)}</span> },
        ]}
      />
      <Tabelle dicht beschriftung={f.tabelle(`${r.bezeichnung}, ${formatDatum(r.datum, sprache)}`)} spalten={spalten} zeilen={r.positionen} zeilenSchluessel={(p) => p.id} ausgewaehlt={(p) => p.investor.art === "fonds" && p.investor.id === fondsId} fusszeile={fusszeile} aktionen={schreiben ? positionAktionen : undefined} />
      {entwurf ? <Pruefung abweichungen={r.pruefung.abweichungen} vorlaeufig={r.pruefung.bestandAusgeblendet} /> : null}
      <FehlerHinweis fehler={transaktionenFehler} />
      {transaktionen ? <TransaktionenKarte zeilen={transaktionen.zeilen} runden={transaktionen.runden} beschriftung={r.bezeichnung} beschreibung={f.transaktionen.beschreibungRunde} leer={f.transaktionen.keine} lesend={lesend} /> : null}
    </article>
  );
}

/** Stammdaten eines Entwurfs ändern. Nur geänderte Felder gehen an die API; ein geleertes Post-Money oder Anteilsfeld leitet den Wert wieder aus den Positionen ab. */
function RundeBearbeitenDialog({ runde, onSchliessen }: { runde: Finanzierungsrunde; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.finanzierungsrunden.bearbeitenForm;
  const form = t.finanzierungsrunden.form;
  const aendern = useRundeAendern();
  const start = {
    bezeichnung: runde.bezeichnung,
    datum: runde.datum,
    preMoney: betragFuerFeld(runde.preMoney ?? ""),
    preis: runde.preisJeAnteil ?? "",
    postMoney: betragFuerFeld(runde.postMoney ?? ""),
    anteileGesamt: runde.anteileGesamtNach ?? "",
  };
  const { werte, feld, pruefeAlle } = useFormular(start, {
    datum: datumRegel({ pflicht: true }),
    preMoney: betragRegel(),
    preis: betragRegel({ vorzeichen: "positiv", nachkomma: 4, ganzstellen: 14 }),
    postMoney: betragRegel(),
    anteileGesamt: ganzzahlRegel(),
  });
  const fehler = (name: string) => feldText(t, aendern.error, name);
  const bruecke0 = runde.art === "bruecke";
  const koerper = {
    ...(werte.bezeichnung.trim() !== start.bezeichnung ? { bezeichnung: werte.bezeichnung.trim() } : {}),
    ...(werte.datum !== start.datum ? { datum: werte.datum } : {}),
    ...(bruecke0
      ? {}
      : {
          ...(betragOderNichts(werte.preMoney, sprache) !== betragOderNichts(start.preMoney) ? { preMoney: betragOderNichts(werte.preMoney, sprache) ?? "" } : {}),
          ...(werte.preis.trim() !== start.preis ? { preisJeAnteil: betragOderNichts(werte.preis, sprache) ?? "" } : {}),
          ...(betragOderNichts(werte.postMoney, sprache) !== betragOderNichts(start.postMoney) ? { postMoney: betragOderNichts(werte.postMoney, sprache) ?? null } : {}),
          ...(werte.anteileGesamt.trim() !== start.anteileGesamt ? { anteileGesamtNach: textOderNichts(werte.anteileGesamt) ?? null } : {}),
        }),
  };
  const geaendert = Object.keys(koerper).length > 0;
  const bruecke = runde.art === "bruecke";
  const titel = bruecke ? t.finanzierungsrunden.brueckeBearbeitenForm.titel : f.titel;
  return (
    <Seitenpanel titel={titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{titel}</h2>
      <p className="app-leer-text">{bruecke ? t.finanzierungsrunden.brueckeBearbeitenForm.beschreibung : f.beschreibung}</p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!pruefeAlle()) return;
          aendern.mutate({ id: runde.id, ...koerper }, { onSuccess: onSchliessen });
        }}
      >
        <FehlerHinweis fehler={aendern.error} bekannt={["bezeichnung", "datum", "preMoney", "preisJeAnteil", "postMoney", "anteileGesamtNach"]} />
        <Feld label={form.bezeichnung} {...feld("bezeichnung")} fehler={fehler("bezeichnung")} />
        <Feld label={form.datum} type="date" required {...feld("datum", fehler("datum"))} />
        {bruecke ? null : (
          <>
            <BetragFeld label={form.preMoney} {...feld("preMoney", fehler("preMoney"))} />
            <BetragFeld label={form.preis} {...feld("preis", fehler("preisJeAnteil"))} />
            <BetragFeld label={form.postMoney} {...feld("postMoney", fehler("postMoney"))} />
            <Feld label={form.anteileGesamt} zahl inputMode="numeric" {...feld("anteileGesamt", fehler("anteileGesamtNach"))} />
          </>
        )}
        <div>
          <Button type="submit" disabled={aendern.isPending || !geaendert}>
            {bruecke ? t.finanzierungsrunden.brueckeBearbeitenForm.speichern : f.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

/**
 * Position eines Entwurfs hinzufügen oder (mit `position`) ändern; der Investor einer bestehenden Position bleibt, wie er ist. Bei Positionen Dritter
 * lässt sich das Vehikel auf ein anderes desselben Investors umstellen (nur angezeigt, wenn der Investor mehrere hat); in einer abgeschlossenen Runde
 * ist das Vehikel das Einzige, was sich ändern lässt.
 */
function PositionDialog({ runde, fondsId, position, onSchliessen }: { runde: Finanzierungsrunde; fondsId: string; position?: RundenPosition; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.finanzierungsrunden.positionForm;
  const form = t.finanzierungsrunden.form;
  const anlegen = useRundenPositionAnlegen();
  const aendern = useRundenPositionAendern();
  const fonds = useQuery(fondsListe());
  const klassen = useQuery(anteilsklassen(runde.organisationId));
  const nurVehikel = runde.status !== "entwurf";
  const investorVehikel = useQuery({ ...vehikelDesInvestors(position?.investor.id ?? ""), enabled: position?.vehikel != null });
  const vehikelOptionen = investorVehikel.data ?? [];
  const { werte, feld, setWerte, pruefeAlle } = useFormular(
    {
      art: "fonds",
      fondsId,
      vehikelId: position?.vehikel?.id ?? "",
      betrag: position ? betragFuerFeld(position.betrag) : "",
      anteile: position?.anteile ?? "",
      rolle: position?.rolle ?? "co",
      klasseId: position?.anteilsklasse?.id ?? "",
    },
    { betrag: betragRegel({ vorzeichen: "positiv", pflicht: true }), anteile: ganzzahlRegel({ min: 1, pflicht: true }) },
  );
  const [vehikel, setVehikel] = useState<VehikelTreffer | null>(null);
  const [fehlt, setFehlt] = useState(false);
  const aktion = position ? aendern : anlegen;
  const fehler = (name: string) => feldText(t, aktion.error, name);

  function senden() {
    if (nurVehikel && position) {
      aendern.mutate({ id: runde.id, positionId: position.id, vehikelId: werte.vehikelId }, { onSuccess: onSchliessen });
      return;
    }
    if (!pruefeAlle()) return;
    const basis = { betrag: betragOderNichts(werte.betrag, sprache) ?? "", anteile: werte.anteile.trim(), rolle: werte.rolle as Rolle };
    if (position) {
      const wechsel = position.vehikel && werte.vehikelId && werte.vehikelId !== position.vehikel.id ? { vehikelId: werte.vehikelId } : {};
      aendern.mutate({ id: runde.id, positionId: position.id, ...basis, anteilsklasseId: werte.klasseId || null, ...wechsel }, { onSuccess: onSchliessen });
      return;
    }
    const id = werte.art === "fonds" ? werte.fondsId : vehikel?.id;
    if (!id) {
      setFehlt(true);
      return;
    }
    anlegen.mutate({ id: runde.id, ...(werte.art === "fonds" ? { fondsId: id } : vehikel?.art === "organisation" ? { organisationId: id } : { vehikelId: id }), ...basis, ...(werte.klasseId ? { anteilsklasseId: werte.klasseId } : {}) }, { onSuccess: onSchliessen });
  }

  return (
    <Seitenpanel titel={position ? f.titelAendern : f.titelNeu} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{position ? f.titelAendern : f.titelNeu}</h2>
      <p className="app-leer-text">{position ? (nurVehikel ? f.beschreibungVehikel(positionsName(position)) : f.beschreibungAendern(positionsName(position))) : f.beschreibungNeu(runde.bezeichnung)}</p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          senden();
        }}
      >
        <FehlerHinweis fehler={aktion.error} bekannt={["fondsId", "vehikelId", "organisationId", "betrag", "anteile", "rolle", "anteilsklasseId"]} />
        {position && vehikelOptionen.length > 1 ? (
          <Auswahl label={f.vehikel} {...feld("vehikelId")}>
            {vehikelOptionen.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Auswahl>
        ) : null}
        {nurVehikel && position && investorVehikel.isSuccess && vehikelOptionen.length < 2 ? <p className="app-leer-text">{f.keinAnderesVehikel}</p> : null}
        {position ? null : (
          <>
            <Segment<string>
              aria-label={form.investorArt}
              value={werte.art}
              onChange={(neu) => {
                setWerte((alt) => ({ ...alt, art: neu }));
                setFehlt(false);
              }}
              options={[
                { wert: "fonds", label: form.artFonds },
                { wert: "vehikel", label: form.artVehikel },
              ]}
            />
            {werte.art === "fonds" ? (
              <Auswahl label={form.fonds} {...feld("fondsId")}>
                {(fonds.data ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Auswahl>
            ) : (
              <VehikelAuswahl label={form.vehikelSuchen} ausser={runde.organisationId} gewaehlt={vehikel} onWaehlen={setVehikel} fehler={fehlt && !vehikel ? form.investorFehlt : undefined} />
            )}
          </>
        )}
        {nurVehikel && position ? null : <BetragFeld label={form.betrag} required {...feld("betrag", fehler("betrag"))} />}
        {nurVehikel && position ? null : <Feld label={form.anteile} zahl inputMode="numeric" required {...feld("anteile", fehler("anteile"))} />}
        {nurVehikel && position ? null : (
          <Auswahl label={form.rolle} {...feld("rolle")}>
            {ROLLEN.map((r) => (
              <option key={r} value={r}>
                {aufzaehlung(t.rundenRolle, r)}
              </option>
            ))}
          </Auswahl>
        )}
        {!(nurVehikel && position) && (klassen.data ?? []).length > 0 ? (
          <Auswahl label={form.klasse} {...feld("klasseId")}>
            <option value="">{t.finanzierungsrunden.stamm}</option>
            {(klassen.data ?? []).map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </Auswahl>
        ) : null}
        <div>
          <Button type="submit" disabled={aktion.isPending || (nurVehikel && position ? vehikelOptionen.length < 2 : werte.betrag.trim() === "" || werte.anteile.trim() === "")}>
            {position ? f.speichern : f.hinzufuegen}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

interface Eintrag {
  schluessel: string;
  /** `organisation`: Investor ohne Vehikel, gesendet als `organisationId` (die API nimmt sein Standard-Vehikel). */
  art: "fonds" | "vehikel" | "organisation";
  id: string;
  name: string;
  betrag: string;
  anteile: string;
  rolle: Rolle;
  klasseId: string;
  klasseName: string;
}

/** Neue Runde als Entwurf. Die Hinweise kommen live von der Vorschau der API (abgeleitete Werte, Abweichungen); der Dialog rechnet nichts. */
function NeueRundeDialog({ organisationId, fondsId, onAngelegt, onSchliessen }: { organisationId: string; fondsId: string; onAngelegt: (id: string) => void; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.finanzierungsrunden.form;
  const anlegen = useFinanzierungsrundeAnlegen(organisationId);
  const orgAnlegen = useOrganisationAnlegen();
  const vehikelAnlegen = useVehikelAnlegen();
  const fonds = useQuery(fondsListe());
  const klassen = useQuery(anteilsklassen(organisationId));
  const { werte, setWerte, feld, pruefeAlle, gueltig } = useFormular(
    { bezeichnung: "", datum: heuteIso(), preMoney: "", preis: "", postMoney: "", anteileGesamt: "" },
    { datum: datumRegel({ pflicht: true }), preMoney: betragRegel(), preis: betragRegel({ vorzeichen: "positiv", nachkomma: 4, ganzstellen: 14 }), postMoney: betragRegel(), anteileGesamt: ganzzahlRegel() },
  );
  const [eintraege, setEintraege] = useState<Eintrag[]>([]);
  const [rundenArt, setRundenArt] = useState<"eigenkapital" | "bruecke">("eigenkapital");
  const bruecke = rundenArt === "bruecke";
  const [shuffle, setShuffle] = useState(POOL_SHUFFLE_START);
  const [shuffleVersucht, setShuffleVersucht] = useState(false);
  const pools = useQuery({ ...mitarbeiterpools(organisationId), enabled: shuffle.aktiv && !bruecke });
  const poolAufstockung = bruecke ? undefined : poolAufstockungAus(shuffle, pools.data);
  const neuFormular = useFormular({ art: "fonds", fondsId, neuName: "", vehikelName: "", betrag: "", anteile: "", rolle: "co", klasseId: "" });
  const [vehikel, setVehikel] = useState<VehikelTreffer | null>(null);
  const [fehlt, setFehlt] = useState(false);
  const kandidaten = kandidatenAus(orgAnlegen.error);
  const n = neuFormular.werte;

  const positionen: AnlegenPosition[] = eintraege.map((e) => ({
    ...(e.art === "fonds" ? { fondsId: e.id } : e.art === "organisation" ? { organisationId: e.id } : { vehikelId: e.id }),
    betrag: betragOderNichts(e.betrag, sprache) ?? "",
    anteile: e.anteile.trim(),
    rolle: e.rolle,
    ...(e.klasseId ? { anteilsklasseId: e.klasseId } : {}),
  }));
  // Eine Brückenrunde hat nur Bezeichnung und Datum; Bewertungsfelder und Positionen lehnt die API ab.
  const koerper: NeueRunde = bruecke
    ? { art: "bruecke", bezeichnung: werte.bezeichnung.trim(), datum: werte.datum }
    : {
        bezeichnung: werte.bezeichnung.trim(),
        datum: werte.datum,
        preMoney: betragOderNichts(werte.preMoney, sprache) ?? "",
        preisJeAnteil: betragOderNichts(werte.preis, sprache) ?? "",
        ...(betragOderNichts(werte.postMoney, sprache) ? { postMoney: betragOderNichts(werte.postMoney, sprache) } : {}),
        ...(textOderNichts(werte.anteileGesamt) ? { anteileGesamtNach: textOderNichts(werte.anteileGesamt) } : {}),
        positionen,
        ...(poolAufstockung ? { poolAufstockung } : {}),
      };
  const brauchbar = !bruecke && gueltig && betragOderNichts(werte.preMoney, sprache) !== undefined && betragOderNichts(werte.preis, sprache) !== undefined && positionen.every((p) => p.betrag !== "" && p.anteile !== "");
  // Körper und Gültigkeit werden zusammen entprellt: geprüft wird die Eingabe, die auch an die API geht (wie in PoolShuffle).
  const entprellt = JSON.parse(useEntprellt(JSON.stringify({ koerper, brauchbar }), 400)) as { koerper: RundenVorschauEingabe; brauchbar: boolean };
  const vorschau = useQuery(rundenVorschau(organisationId, entprellt.koerper, entprellt.brauchbar));
  const fehler = (name: string) => feldText(t, anlegen.error, name);

  function hinzufuegen() {
    const id = n.art === "fonds" ? n.fondsId : vehikel?.id;
    const name = n.art === "fonds" ? (fonds.data?.find((x) => x.id === n.fondsId)?.name ?? "") : (vehikel?.label ?? "");
    const art: Eintrag["art"] = n.art === "fonds" ? "fonds" : (vehikel?.art ?? "vehikel");
    if (!id || (n.art !== "fonds" && n.art !== "vehikel") || eintraege.some((e) => e.schluessel === `${art}-${id}`)) {
      setFehlt(true);
      return;
    }
    setFehlt(false);
    const klasse = klassen.data?.find((k) => k.id === n.klasseId);
    setEintraege((alt) => [
      ...alt,
      { schluessel: `${art}-${id}`, art, id, name, betrag: n.betrag, anteile: n.anteile, rolle: n.rolle as Rolle, klasseId: n.klasseId, klasseName: klasse?.name ?? "" },
    ]);
    neuFormular.setWerte((alt) => ({ ...alt, betrag: "", anteile: "", klasseId: "" }));
    setVehikel(null);
  }

  /**
   * Nach dem Anlegen oder Wählen eines Investors: mit Namen entsteht gleich ein Vehikel und ist gewählt; ohne Namen ist der Investor gewählt und die API
   * nimmt beim Speichern sein Standard-Vehikel (legt es bei Bedarf mit seinem Namen an).
   */
  function vehikelFuer(investor: { id: string; name: string }) {
    const name = n.vehikelName.trim();
    if (name === "") {
      setVehikel({ id: investor.id, label: investor.name, art: "organisation" });
      neuFormular.setWerte((alt) => ({ ...alt, art: "vehikel", neuName: "", vehikelName: "" }));
      return;
    }
    vehikelAnlegen.mutate(
      { organisationId: investor.id, name },
      {
        onSuccess: (neu) => {
          setVehikel({ id: neu.id, label: vehikelLabel(neu.name, investor.name), art: "vehikel" });
          neuFormular.setWerte((alt) => ({ ...alt, art: "vehikel", neuName: "", vehikelName: "" }));
        },
      },
    );
  }

  function organisationNeu(bestaetigt: boolean) {
    orgAnlegen.mutate({ name: n.neuName.trim(), art: "investor", ...(bestaetigt ? { dubletteBestaetigt: true } : {}) }, { onSuccess: (neu) => vehikelFuer(neu) });
  }

  const spalten: TabelleSpalte<Eintrag>[] = [
    { schluessel: "investor", kopf: t.finanzierungsrunden.spalten.investor, zelle: (e) => e.name },
    { schluessel: "rolle", kopf: t.finanzierungsrunden.spalten.rolle, zelle: (e) => aufzaehlung(t.rundenRolle, e.rolle) },
    { schluessel: "betrag", kopf: t.finanzierungsrunden.spalten.betrag, zahl: true, zelle: (e) => e.betrag },
    { schluessel: "anteile", kopf: t.finanzierungsrunden.spalten.anteile, zahl: true, zelle: (e) => e.anteile },
    { schluessel: "klasse", kopf: t.finanzierungsrunden.spalten.klasse, zelle: (e) => e.klasseName || t.finanzierungsrunden.stamm },
    {
      schluessel: "aktion",
      kopf: t.finanzierungsrunden.spalten.aktion,
      zelle: (e) => (
        <Button variante="sekundaer" aria-label={f.entfernen(e.name)} onClick={() => setEintraege((alt) => alt.filter((x) => x.schluessel !== e.schluessel))}>
          {t.gemeinsam.entfernen}
        </Button>
      ),
    },
  ];

  return (
    <Seitenpanel titel={bruecke ? f.titelBruecke : f.titel} onSchliessen={onSchliessen} breit>
      <h2 className="cw-t-untertitel">{bruecke ? f.titelBruecke : f.titel}</h2>
      <p className="app-leer-text">{bruecke ? f.beschreibungBruecke : f.beschreibung}</p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!pruefeAlle()) return;
          if (!bruecke && !aufstockungGueltig(shuffle)) {
            setShuffleVersucht(true);
            return;
          }
          anlegen.mutate(koerper, {
            onSuccess: (neu) => {
              onAngelegt(neu.id);
              onSchliessen();
            },
          });
        }}
      >
        <FehlerHinweis fehler={anlegen.error} bekannt={["bezeichnung", "datum", "preMoney", "preisJeAnteil", "postMoney", "anteileGesamtNach", "positionen", "poolAufstockung.poolId", "poolAufstockung.neuerPool", "poolAufstockung.anzahl"]} />
        <Segment<"eigenkapital" | "bruecke">
          aria-label={f.art}
          value={rundenArt}
          onChange={setRundenArt}
          options={[
            { wert: "eigenkapital", label: f.artEigenkapital },
            { wert: "bruecke", label: f.artBruecke },
          ]}
        />
        <Feld label={f.bezeichnung} {...feld("bezeichnung")} fehler={fehler("bezeichnung")} />
        <Feld label={f.datum} type="date" required {...feld("datum", fehler("datum"))} />
        {bruecke ? null : (
          <>
            <BetragFeld label={f.preMoney} {...feld("preMoney", fehler("preMoney"))} />
            <BetragFeld label={f.preis} {...feld("preis", fehler("preisJeAnteil"))} />
            <BetragFeld label={f.postMoney} {...feld("postMoney", fehler("postMoney"))} />
            <Feld label={f.anteileGesamt} zahl inputMode="numeric" {...feld("anteileGesamt", fehler("anteileGesamtNach"))} />

            <fieldset className="app-gruppe">
              <legend className="cw-feld__label">{f.investoren}</legend>
              {eintraege.length === 0 ? <p className="app-leer-text">{f.keinePositionen}</p> : <Tabelle beschriftung={f.tabelle} spalten={spalten} zeilen={eintraege} zeilenSchluessel={(e) => e.schluessel} />}
              <Segment<string>
                aria-label={f.investorArt}
                value={n.art}
                onChange={(neu) => {
                  neuFormular.setWerte((alt) => ({ ...alt, art: neu }));
                  orgAnlegen.reset();
                  setFehlt(false);
                }}
                options={[
                  { wert: "fonds", label: f.artFonds },
                  { wert: "vehikel", label: f.artVehikel },
                  { wert: "neu", label: f.artNeu },
                ]}
              />
              {n.art === "fonds" ? (
                <Auswahl label={f.fonds} {...neuFormular.feld("fondsId")}>
                  {(fonds.data ?? []).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Auswahl>
              ) : null}
              {n.art === "vehikel" ? <VehikelAuswahl label={f.vehikelSuchen} ausser={organisationId} gewaehlt={vehikel} onWaehlen={setVehikel} fehler={fehlt && !vehikel ? f.investorFehlt : undefined} /> : null}
              {n.art === "neu" ? (
                <>
                  {kandidaten ? (
                    <DublettenBestaetigung
                      kandidaten={kandidaten}
                      laeuft={orgAnlegen.isPending}
                      onBestaetigen={() => organisationNeu(true)}
                      onVerwenden={(k) => {
                        orgAnlegen.reset();
                        vehikelFuer({ id: k.id, name: k.name });
                      }}
                    />
                  ) : (
                    <FehlerHinweis fehler={orgAnlegen.error ?? vehikelAnlegen.error} bekannt={["name"]} />
                  )}
                  <Feld label={f.organisationName} {...neuFormular.feld("neuName")} fehler={feldText(t, orgAnlegen.error, "name")} />
                  <Feld label={f.vehikelName} {...neuFormular.feld("vehikelName")} fehler={feldText(t, vehikelAnlegen.error, "name")} />
                  <div>
                    <Button variante="sekundaer" disabled={orgAnlegen.isPending || vehikelAnlegen.isPending || n.neuName.trim() === ""} onClick={() => organisationNeu(false)}>
                      {f.organisationAnlegen}
                    </Button>
                  </div>
                </>
              ) : null}
              {n.art !== "neu" ? (
                <>
                  <Feld label={f.betrag} zahl inputMode="decimal" {...neuFormular.feld("betrag")} />
                  <Feld label={f.anteile} zahl inputMode="numeric" {...neuFormular.feld("anteile")} />
                  <Auswahl label={f.rolle} {...neuFormular.feld("rolle")}>
                    {ROLLEN.map((r) => (
                      <option key={r} value={r}>
                        {aufzaehlung(t.rundenRolle, r)}
                      </option>
                    ))}
                  </Auswahl>
                  {(klassen.data ?? []).length > 0 ? (
                    <Auswahl label={f.klasse} {...neuFormular.feld("klasseId")}>
                      <option value="">{t.finanzierungsrunden.stamm}</option>
                      {(klassen.data ?? []).map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.name}
                        </option>
                      ))}
                    </Auswahl>
                  ) : null}
                  <div>
                    <Button variante="sekundaer" disabled={n.betrag.trim() === "" || n.anteile.trim() === ""} onClick={hinzufuegen}>
                      {f.hinzufuegen}
                    </Button>
                  </div>
                </>
              ) : null}
            </fieldset>

            <PoolShuffle
              organisationId={organisationId}
              werte={shuffle}
              onAendern={setShuffle}
              datum={werte.datum}
              preMoney={betragOderNichts(werte.preMoney, sprache)}
              betraege={positionen.map((p) => p.betrag)}
              preis={betragOderNichts(werte.preis, sprache)}
              onPreisUebernehmen={(preis) => setWerte((alt) => ({ ...alt, preis }))}
              pools={pools.data}
              fehlerAnzeigen={shuffleVersucht}
              fehler={anlegen.error}
            />

            <div aria-live="polite" className="app-gruppe">
              {vorschau.data ? (
                <>
                  <p className="app-leer-text">{f.abgeleitet(formatBetragCent(vorschau.data.postMoney, sprache), formatAnzahl(vorschau.data.anteileGesamtNach, sprache))}</p>
                  <Pruefung abweichungen={vorschau.data.pruefung.abweichungen} ok={eintraege.length > 0} vorlaeufig={vorschau.data.pruefung.bestandAusgeblendet} />
                  <RundenDubletten dubletten={vorschau.data.dubletten} />
                </>
              ) : null}
            </div>
          </>
        )}
        <div>
          <Button type="submit" disabled={anlegen.isPending}>
            {bruecke ? f.anlegenBruecke : f.anlegen}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

interface Auszahlung {
  valuta: string;
  betrag: string;
}
interface Wunsch {
  zusage: boolean;
  zusageValuta: string;
  art: InstrumentArtWahl;
  bezeichnung: string;
  /** Hat die Person die Bezeichnung selbst geändert? Sonst folgt der Vorschlag der Art. */
  bezeichnungGeaendert: boolean;
  auszahlungen: Auszahlung[];
}

const INSTRUMENT_ARTEN = ["offene_beteiligung", "stille_beteiligung", "darlehen", "wandeldarlehen", "venture_debt", "gesellschafterdarlehen"] as const;
type InstrumentArtWahl = (typeof INSTRUMENT_ARTEN)[number];

/** Vorschlag der Bezeichnung wie in der API: „<Runde>-Anteile“ für Eigenkapital, sonst „<Art> <Runde>“. */
const bezeichnungsVorschlag = (art: InstrumentArtWahl, runde: string, artName: string) => (art === "offene_beteiligung" ? `${runde}-Anteile` : `${artName} ${runde}`);

/**
 * Abschließen: je Position des eigenen Fonds entsteht ein Instrument (Art und Bezeichnung einstellbar) mit Zusage in Höhe der Position (Vorgabe an),
 * auf Wunsch mit ersten Auszahlungen (die API bucht alles in derselben Transaktion). Hat die Position nach einer Wiedereröffnung schon ihr Instrument, bleibt es.
 */
function AbschliessenDialog({ runde, onSchliessen }: { runde: Finanzierungsrunde; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const a = t.finanzierungsrunden.abschluss;
  const { darf } = useRechte();
  const schliessen = useRundeAbschliessen();
  const eigene = runde.positionen.filter((p) => p.investor.art === "fonds" && darf("bearbeiter", p.investor.id, "portfolio"));
  const artName = (art: string) => aufzaehlung(t.instrument, art);
  const [wuensche, setWuensche] = useState<Record<string, Wunsch>>(() =>
    Object.fromEntries(eigene.map((p) => [p.id, { zusage: !p.instrumentId, zusageValuta: runde.datum, art: "offene_beteiligung" as InstrumentArtWahl, bezeichnung: bezeichnungsVorschlag("offene_beteiligung", runde.bezeichnung, ""), bezeichnungGeaendert: false, auszahlungen: [] }])),
  );
  const [fertig, setFertig] = useState<number | null>(null);
  const aendere = (id: string, teil: Partial<Wunsch>) => setWuensche((alt) => ({ ...alt, [id]: { ...alt[id]!, ...teil } }));
  const abweichungen = schliessen.error instanceof ApiFehler && Array.isArray(schliessen.error.zusatz.abweichungen) ? (schliessen.error.zusatz.abweichungen as PruefMeldung[]) : [];

  function senden() {
    const fondsBuchungen = eigene.flatMap((p) => {
      const w = wuensche[p.id]!;
      const auszahlungen = w.auszahlungen.filter((x) => x.betrag.trim() !== "").map((x) => ({ valuta: x.valuta, betrag: betragOderNichts(x.betrag) ?? "" }));
      // Mit vorhandenem Instrument (erneuter Abschluss) gibt es nur noch Auszahlungen zu buchen.
      if (p.instrumentId) return auszahlungen.length === 0 ? [] : [{ positionId: p.id, zusage: false, auszahlungen }];
      const bezeichnung = w.bezeichnung.trim();
      return [{ positionId: p.id, zusage: w.zusage, ...(w.zusage ? { zusageValuta: w.zusageValuta } : {}), art: w.art, ...(bezeichnung ? { bezeichnung } : {}), auszahlungen }];
    });
    schliessen.mutate({ id: runde.id, fondsBuchungen }, { onSuccess: (antwort) => setFertig(antwort.buchungen.reduce((s, b) => s + b.vorgangIds.length, 0)) });
  }

  return (
    <Seitenpanel titel={a.titel} onSchliessen={onSchliessen} breit>
      <h2 className="cw-t-untertitel">{a.titel}</h2>
      {fertig !== null ? (
        <Hinweis variante="info">{a.fertig(fertig)}</Hinweis>
      ) : (
        <form
          className="app-formular"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            senden();
          }}
        >
          <p className="app-leer-text">{a.beschreibung}</p>
          <FehlerHinweis fehler={schliessen.error} />
          {abweichungen.length > 0 ? (
            <>
              <p className="app-leer-text">{a.abweichungen}</p>
              <Pruefung abweichungen={abweichungen} />
            </>
          ) : null}
          {eigene.length === 0 ? <p className="app-leer-text">{a.keineEigene}</p> : null}
          {eigene.map((p) => {
            const w = wuensche[p.id]!;
            return (
              <fieldset key={p.id} className="app-gruppe">
                <legend className="cw-feld__label">{a.eigenePosition(p.investor.name, formatBetragCent(p.betrag, sprache))}</legend>
                {p.instrumentId ? (
                  <p className="app-leer-text">{a.instrumentVorhanden}</p>
                ) : (
                  <>
                    <Auswahl label={a.instrumentArt} value={w.art} onChange={(e) => aendere(p.id, { art: e.target.value as InstrumentArtWahl, ...(w.bezeichnungGeaendert ? {} : { bezeichnung: bezeichnungsVorschlag(e.target.value as InstrumentArtWahl, runde.bezeichnung, artName(e.target.value)) }) })}>
                      {INSTRUMENT_ARTEN.map((x) => (
                        <option key={x} value={x}>
                          {artName(x)}
                        </option>
                      ))}
                    </Auswahl>
                    <Feld label={a.instrumentBezeichnung} value={w.bezeichnung} onChange={(e) => aendere(p.id, { bezeichnung: e.target.value, bezeichnungGeaendert: true })} />
                    <label className="app-haken">
                      <input type="checkbox" checked={w.zusage} onChange={(e) => aendere(p.id, { zusage: e.target.checked })} /> {a.zusage(formatBetragCent(p.betrag, sprache))}
                    </label>
                  </>
                )}
                {w.zusage && !p.instrumentId ? <Feld label={a.zusageValuta} type="date" value={w.zusageValuta} onChange={(e) => aendere(p.id, { zusageValuta: e.target.value })} /> : null}
                <p className="cw-feld__label">{a.auszahlungen}</p>
                {w.auszahlungen.map((x, i) => (
                  <div key={i} className="app-feldgruppe">
                    <Feld label={a.valuta} type="date" value={x.valuta} onChange={(e) => aendere(p.id, { auszahlungen: w.auszahlungen.map((y, j) => (j === i ? { ...y, valuta: e.target.value } : y)) })} />
                    <Feld label={a.betrag} zahl inputMode="decimal" value={x.betrag} onChange={(e) => aendere(p.id, { auszahlungen: w.auszahlungen.map((y, j) => (j === i ? { ...y, betrag: e.target.value } : y)) })} />
                    <Button variante="sekundaer" aria-label={a.auszahlungEntfernen} onClick={() => aendere(p.id, { auszahlungen: w.auszahlungen.filter((_, j) => j !== i) })}>
                      {t.gemeinsam.entfernen}
                    </Button>
                  </div>
                ))}
                <div>
                  <Button variante="sekundaer" onClick={() => aendere(p.id, { auszahlungen: [...w.auszahlungen, { valuta: runde.datum, betrag: "" }] })}>
                    {a.auszahlungHinzu}
                  </Button>
                </div>
              </fieldset>
            );
          })}
          <div>
            <Button type="submit" disabled={schliessen.isPending}>
              {a.bestaetigen}
            </Button>
          </div>
        </form>
      )}
    </Seitenpanel>
  );
}

function WiederDialog({ runde, onSchliessen }: { runde: Finanzierungsrunde; onSchliessen: () => void }) {
  const t = useT();
  const w = t.finanzierungsrunden.wieder;
  const oeffnen = useRundeWiedereroeffnen();
  const { werte, feld } = useFormular({ grund: "" });
  return (
    <Seitenpanel titel={w.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{w.titel}</h2>
      <p className="app-leer-text">{w.beschreibung}</p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          oeffnen.mutate({ id: runde.id, grund: werte.grund.trim() }, { onSuccess: onSchliessen });
        }}
      >
        <FehlerHinweis fehler={oeffnen.error} bekannt={["grund"]} />
        <Feld label={w.grund} {...feld("grund")} fehler={feldText(t, oeffnen.error, "grund")} />
        <div>
          <Button type="submit" variante="gefahr" disabled={oeffnen.isPending}>
            {w.oeffnen}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

function ZahlungDialog({ position, onSchliessen }: { position: RundenPosition; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const z = t.finanzierungsrunden.zahlung;
  const anlegen = useZahlungAnlegen();
  const { werte, feld } = useFormular({ art: "einzahlung", datum: heuteIso(), betrag: "", bemerkung: "" });
  const [stand, setStand] = useState<string | null>(null);
  return (
    <Seitenpanel titel={z.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">
        {z.titel}: {positionsName(position)}
      </h2>
      <p className="app-leer-text">{z.beschreibung}</p>
      {stand ? (
        <Hinweis variante="info">{stand}</Hinweis>
      ) : (
        <form
          className="app-formular"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            anlegen.mutate(
              { positionId: position.id, art: werte.art as "einzahlung" | "rueckzahlung", datum: werte.datum, betrag: betragOderNichts(werte.betrag) ?? "", bemerkung: textOderNichts(werte.bemerkung) },
              { onSuccess: (antwort) => setStand(z.stand(formatBetragCent(antwort.gezahlt, sprache), formatBetragCent(antwort.offen, sprache))) },
            );
          }}
        >
          <FehlerHinweis fehler={anlegen.error} bekannt={["art", "datum", "betrag", "bemerkung"]} />
          <Auswahl label={z.art} {...feld("art")}>
            {(["einzahlung", "rueckzahlung"] as const).map((a) => (
              <option key={a} value={a}>
                {aufzaehlung(z.arten, a)}
              </option>
            ))}
          </Auswahl>
          <Feld label={z.datum} type="date" {...feld("datum")} fehler={feldText(t, anlegen.error, "datum")} />
          <Feld label={z.betrag} zahl inputMode="decimal" {...feld("betrag")} fehler={feldText(t, anlegen.error, "betrag")} />
          <Feld label={z.bemerkung} {...feld("bemerkung")} fehler={feldText(t, anlegen.error, "bemerkung")} />
          <div>
            <Button type="submit" disabled={anlegen.isPending}>
              {z.erfassen}
            </Button>
          </div>
        </form>
      )}
    </Seitenpanel>
  );
}


/**
 * Runden eines Unternehmens auf der Organisationsseite, ohne Beteiligung als Ausgangspunkt: Welche Rolle gilt, hängt vom Fonds ab, den man
 * wählt (Vorgabe: ein Fonds, an dem die Person bearbeiten darf). Die Liste zeigt, was die API für diese Rolle freigibt.
 */
export function RundenMitFondswahl({ organisationId, lesend = false }: { organisationId: string; lesend?: boolean }) {
  const t = useT();
  const { darf } = useRechte();
  const fonds = useQuery(fondsListe());
  const [gewaehlt, setGewaehlt] = useState("");
  const liste = fonds.data ?? [];
  const vorgabe = liste.find((x) => darf("bearbeiter", x.id, "portfolio"))?.id ?? liste[0]?.id ?? "";
  const fondsId = gewaehlt || vorgabe;
  if (liste.length === 0) return null;
  return (
    <>
      <div className="app-karte">
        <Auswahl label={t.finanzierungsrunden.fondswahl} value={fondsId} onChange={(e) => setGewaehlt(e.target.value)}>
          {liste.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Auswahl>
        <p className="app-leer-text">{t.finanzierungsrunden.fondswahlHilfe}</p>
      </div>
      <RundenAbschnitt organisationId={organisationId} fondsId={fondsId} lesend={lesend} verbotenOkay />
    </>
  );
}
