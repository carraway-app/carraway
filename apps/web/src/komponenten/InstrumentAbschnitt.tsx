import { BelegKnopf, BelegPanel } from "./BelegKnopf";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button, CaretDownIcon, Fakten, Hinweis, IconButton, Karte, KartenRaster, Kennzahl, KennzahlenReihe, Kennwerte, Leer, Menue, PencilSimpleIcon, PlusIcon, Status, Tabelle, formatDatum, type MenueEintrag, type TabelleSpalte } from "@carraway/ui";
import { instrumentdaten, type Instrumentdaten } from "../api/abfragen";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { useNamen } from "../lib/namen";
import { useRechte } from "../lib/rechte";
import { formatAnzahl, formatBetragCent, formatPreis, formatSatz } from "../lib/zahl";
import { formatZeitpunkt } from "../lib/zeit";
import { ForderungDialog, UeberschussDialog } from "./InstrumentDialoge";
import { Skelettzeilen } from "./Skelett";
import { FehlerHinweis } from "./FehlerHinweis";
import { HerkunftDialog } from "./HerkunftDialog";
import { Rechenweg } from "./Rechenweg";
import { AnpassungDialog, InsolvenzDialog, VerkaufDialog, VerkaufStornoDialog } from "./VerkaufDialoge";
import type { VorgangVorgabe } from "./VorgangDialoge";
import { heuteIso } from "../api/datum";

type Forderung = Instrumentdaten["forderungen"][number];
type Verkauf = Instrumentdaten["verkaeufe"][number];
type Offen =
  | { art: "ueberschuss"; jahr?: undefined; betrag?: undefined }
  | { art: "ueberschuss"; jahr: number; betrag: string }
  | { art: "forderung"; id: string }
  | { art: "verkaufStorno"; verkauf: Verkauf };

// Die Dialoge der Instrumente und Vorgänge laden erst, wenn jemand sie öffnet.
const VorgangDialog = lazy(() => import("./VorgangDialoge").then((m) => ({ default: m.VorgangDialog })));
const TrancheAnlegenDialog = lazy(() => import("./TrancheDialoge").then((m) => ({ default: m.TrancheAnlegenDialog })));

/** Übersicht der Beteiligung: Buchwert über alle Instrumente, Jahresüberschüsse, Forderungen, Verkäufe und die Aktionen dazu (Konditionen und Tranchen stehen je Instrument im Bereich Instrumente). */
export function InstrumentAbschnitt({ beteiligungId, schreibgeschuetzt, wegenStand = true, children }: { beteiligungId: string; schreibgeschuetzt: boolean; wegenStand?: boolean; children?: ReactNode }) {
  const t = useT();
  const { data, error, isPending } = useQuery(instrumentdaten(beteiligungId));
  const [offen, setOffen] = useState<Offen | null>(null);
  const [herkunft, setHerkunft] = useState(false);
  const schliessen = () => setOffen(null);

  return (
    <section id="abschnitt-instrument" className="app-instrument" aria-label={t.inst.titel}>
      {schreibgeschuetzt && wegenStand ? <Hinweis>{t.inst.wissensstandGesperrt}</Hinweis> : null}
      {isPending ? <Skelettzeilen anzahl={3} /> : null}
      {error ? <FehlerHinweis fehler={error} /> : null}
      {data ? (
        <Inhalt daten={data} schreibgeschuetzt={schreibgeschuetzt} onWahl={setOffen} onHerkunft={() => setHerkunft(true)}>
          {children}
        </Inhalt>
      ) : (
        children
      )}

      {offen?.art === "ueberschuss" ? (
        <UeberschussDialog beteiligungId={beteiligungId} {...(offen.jahr !== undefined ? { jahr: offen.jahr, betrag: offen.betrag } : {})} onSchliessen={schliessen} />
      ) : null}
      {offen?.art === "forderung" ? <ForderungDialog forderungId={offen.id} onSchliessen={schliessen} /> : null}
      {offen?.art === "verkaufStorno" ? <VerkaufStornoDialog verkauf={offen.verkauf} onSchliessen={schliessen} /> : null}
      {data && herkunft ? <HerkunftDialog titel={t.inst.buchwert.titel} stichtag={heuteIso()} schritte={data.buchwert.schritte as never} onSchliessen={() => setHerkunft(false)} /> : null}
    </section>
  );
}

/**
 * Aktionen der Beteiligung im Seitenkopf: „Vorgang erfassen“ als Hauptknopf, alles Weitere (Beleg, Verkauf, Kaufpreisanpassung, Insolvenz)
 * im Menü „Weitere Aktionen“. Hält die Dialoge dieser Aktionen selbst; die Wandlung gehört zum Instrument (Bereich Instrumente).
 */
export function InstrumentAktionen({ beteiligungId, schreibgeschuetzt }: { beteiligungId: string; schreibgeschuetzt: boolean }) {
  const t = useT();
  const a = t.inst.aktionen;
  const { data } = useQuery(instrumentdaten(beteiligungId));
  const { darf } = useRechte();
  const [offen, setOffen] = useState<"vorgang" | "tranche" | "verkauf" | "anpassung" | "insolvenz" | "beleg" | null>(null);
  const schliessen = () => setOffen(null);
  if (!data || schreibgeschuetzt) return null;
  const aktiv = data.beteiligung.status === "aktiv";
  const eintraege: MenueEintrag[] = [
    ...(darf("bearbeiter", data.beteiligung.fondsId, "finanzen") ? [{ id: "beleg", label: t.buchhaltung.erzeugen.knopf, onClick: () => setOffen("beleg") }] : []),
    ...(aktiv ? [{ id: "verkauf", label: a.verkauf, onClick: () => setOffen("verkauf") }] : []),
    ...(data.verkaeufe.length > 0 ? [{ id: "anpassung", label: a.anpassung, onClick: () => setOffen("anpassung") }] : []),
    ...(aktiv ? [{ id: "insolvenz", label: a.insolvenz, onClick: () => setOffen("insolvenz"), gefahr: true, trennerDavor: true }] : []),
  ];
  return (
    <>
      <Button onClick={() => setOffen("vorgang")}>{a.vorgang}</Button>
      {eintraege.length > 0 ? (
        <Menue
          aria-label={a.weitere}
          ausloeser={
            <>
              {a.weitere}
              <CaretDownIcon />
            </>
          }
          ausloeserKlasse="cw-button cw-button--sekundaer"
          eintraege={eintraege}
        />
      ) : null}
      <Suspense fallback={null}>
        {offen === "vorgang" ? <VorgangDialog daten={data} onTrancheAnlegen={() => setOffen("tranche")} onSchliessen={schliessen} /> : null}
        {offen === "tranche" ? <TrancheAnlegenDialog instrumente={data.instrumente} onSchliessen={schliessen} /> : null}
      </Suspense>
      {offen === "beleg" ? <BelegPanel art="vertragsanlage" bezugArt="beteiligung" bezugId={data.beteiligung.id} fondsId={data.beteiligung.fondsId} onSchliessen={schliessen} /> : null}
      {offen === "verkauf" ? <VerkaufDialog beteiligungId={beteiligungId} instrumente={data.instrumente} onSchliessen={schliessen} /> : null}
      {offen === "anpassung" ? <AnpassungDialog beteiligungId={beteiligungId} verkaeufe={data.verkaeufe} onSchliessen={schliessen} /> : null}
      {offen === "insolvenz" ? <InsolvenzDialog beteiligungId={beteiligungId} onSchliessen={schliessen} /> : null}
    </>
  );
}

/** Vorgang erfassen, aus einem Bereich geöffnet (zum Beispiel „Zinszahlung erfassen“ unter Zinsen) mit Vorbelegung. */
export function VorgangErfassen({ beteiligungId, vorgabe, onSchliessen }: { beteiligungId: string; vorgabe?: VorgangVorgabe; onSchliessen: () => void }) {
  const { data } = useQuery(instrumentdaten(beteiligungId));
  const [tranche, setTranche] = useState(false);
  if (!data) return null;
  return (
    <Suspense fallback={null}>
      {tranche ? <TrancheAnlegenDialog instrumente={data.instrumente} onSchliessen={onSchliessen} /> : <VorgangDialog daten={data} vorgabe={vorgabe} onTrancheAnlegen={() => setTranche(true)} onSchliessen={onSchliessen} />}
    </Suspense>
  );
}

const zahl = (wert: string) => <span className="app-zahl">{wert}</span>;

/** Icon-Button in einem Kartenkopf: Name wie der frühere Textknopf, Zeichen zeigt die Art. */
function KartenAktion({ label, onClick, art = "plus" }: { label: string; onClick: () => void; art?: "plus" | "stift" }) {
  return <IconButton variante="ruhig" groesse="s" icon={art === "plus" ? <PlusIcon /> : <PencilSimpleIcon />} aria-label={label} title={label} onClick={onClick} />;
}

function Inhalt({ daten, schreibgeschuetzt, onWahl, onHerkunft, children }: { daten: Instrumentdaten; schreibgeschuetzt: boolean; onWahl: (o: Offen) => void; onHerkunft: () => void; children?: ReactNode }) {
  const t = useT();
  const sprache = useSprache();
  const darlehensartig = daten.instrumente.some((i) => i.darlehensartig);
  const z = daten.zustand;
  const b = t.inst.buchwert;
  const schreiben = !schreibgeschuetzt;
  const aktiv = daten.beteiligung.status === "aktiv";
  // Ausgeschieden, aber Buchwert oder offenes Kapital nicht null (z. B. aus einer Datenübernahme): Hinweis statt stiller Nullsetzung.
  const exitMitRest = daten.beteiligung.status === "exit" && (Number(daten.buchwert.wert) !== 0 || daten.instrumente.some((i) => i.darlehensartig && Number(i.offenesKapital ?? 0) !== 0));
  const ohneUeberschuesse = darlehensartig && daten.jahresueberschuesse.length === 0;

  return (
    <>
      {!aktiv ? <Hinweis>{t.inst.nichtAktiv}</Hinweis> : null}
      {exitMitRest ? <Hinweis>{t.inst.exitMitRest}</Hinweis> : null}
      <p className="app-leer-text app-klein">{t.inst.stand}</p>
      <KennzahlenReihe aria-label={b.titel}>
        <Kennzahl titel={b.titel} wert={formatBetragCent(daten.buchwert.wert, sprache)} hervorgehoben onHerkunft={onHerkunft} />
        <Kennzahl titel={b.investiert} wert={formatBetragCent(z.investiert, sprache)} />
        <Kennzahl titel={b.offeneZusage} wert={formatBetragCent(z.offeneZusage, sprache)} />
        {darlehensartig ? <Kennzahl titel={b.offenesKapital} wert={formatBetragCent(z.offenesKapital, sprache)} /> : null}
      </KennzahlenReihe>
      <Kennwerte
        kompakt
        gruppen={[
          {
            titel: b.gruppe,
            eintraege: [
              { id: "zusage", label: b.zusage, wert: zahl(formatBetragCent(z.zusage, sprache)) },
              { id: "tilgungen", label: b.tilgungen, wert: zahl(formatBetragCent(z.tilgungen, sprache)), ruhig: Number(z.tilgungen) === 0 },
              { id: "wb", label: b.wertberichtigungen, wert: zahl(formatBetragCent(z.wertberichtigungen, sprache)), ruhig: Number(z.wertberichtigungen) === 0 },
              { id: "kap", label: b.kapitalisiert, wert: zahl(formatBetragCent(z.kapitalisiert, sprache)), ruhig: Number(z.kapitalisiert) === 0 },
              { id: "abgang", label: b.abgang, wert: zahl(formatBetragCent(z.buchwertabgang, sprache)), ruhig: Number(z.buchwertabgang) === 0 },
            ],
          },
        ]}
      />


      {!darlehensartig ? <Leer kompakt beschreibung={t.inst.nichtDarlehen} /> : null}
      {ohneUeberschuesse ? <NochNicht schreiben={schreiben} teile={[{ id: "ueberschuss", titel: t.inst.ueberschuesse.titel, aktion: t.inst.ueberschuesse.erfassen, onWahl: () => onWahl({ art: "ueberschuss" }) }]} /> : null}

      <KartenRaster>
        {darlehensartig && !ohneUeberschuesse ? <Ueberschuesse daten={daten} schreiben={schreiben} onWahl={onWahl} /> : null}
        {children}
        {daten.forderungen.length > 0 ? <Forderungen daten={daten} schreiben={schreiben} onWahl={onWahl} /> : null}
        {daten.verkaeufe.map((x) => (
          <VerkaufKarte key={x.id} daten={daten} verkauf={x} schreibgeschuetzt={schreibgeschuetzt} onWahl={onWahl} />
        ))}
        {daten.wandlung ? (
          <Karte titel={t.inst.wandlung.titel}>
            <Fakten
              darstellung="liste"
              eintraege={[
                { label: t.inst.wandlung.cutoff, wert: zahl(formatDatum(daten.wandlung.cutoff, sprache)) },
                { label: t.inst.wandlung.betrag, wert: zahl(formatBetragCent(daten.wandlung.wandlungsbetrag, sprache)) },
                { label: t.inst.wandlung.anteile, wert: zahl(formatAnzahl(daten.wandlung.anzahlAnteile, sprache)) },
                { label: t.inst.wandlung.preis, wert: zahl(formatPreis(daten.wandlung.preisJeAnteil, sprache)) },
                { label: t.inst.wandlung.regel, wert: aufzaehlung(t.massgeblich, daten.wandlung.massgeblich) },
              ]}
            />
            <div className="app-knoepfe">
              <BelegKnopf art="wandlung" bezugArt="wandlung" bezugId={daten.wandlung.id} fondsId={daten.beteiligung.fondsId} />
              {/* Das Ziel ist ein neues Instrument derselben Beteiligung; nur bei Altdaten liegt es in einer anderen Beteiligung. */}
              {daten.wandlung.zielBeteiligungId && daten.wandlung.zielBeteiligungId !== daten.wandlung.darlehenBeteiligungId ? (
                <Link to="/beteiligungen/$id" params={{ id: daten.wandlung.zielBeteiligungId }} search={{}}>
                  {t.inst.wandlung.ziel}
                </Link>
              ) : daten.wandlung.zielInstrumentId ? (
                <Link to="/beteiligungen/$id" params={{ id: daten.beteiligung.id }} search={{ tab: "finanzierung", unter: "instrumente" }} hash={`instrument-${daten.wandlung.zielInstrumentId}`}>
                  {t.inst.wandlung.zumInstrument}
                </Link>
              ) : null}
            </div>
          </Karte>
        ) : null}
      </KartenRaster>
    </>
  );
}

/** Eine Zeile für alles, was noch fehlt: „Noch nicht erfasst: Konditionen erfassen · Meilensteine erfassen“. */
function NochNicht({ schreiben, teile }: { schreiben: boolean; teile: { id: string; titel: string; hinweis?: string; aktion: string; onWahl: () => void }[] }) {
  const t = useT();
  return (
    <Leer
      kompakt
      beschreibung={
        <>
          {t.inst.nochNicht}{" "}
          {teile.map((x, i) => (
            <span key={x.id} title={x.hinweis}>
              {i > 0 ? " · " : ""}
              {x.titel}
              {schreiben ? (
                <>
                  {" "}
                  <Button variante="ruhig" groesse="s" aria-label={`${x.titel} ${t.inst.erfassen}`} onClick={x.onWahl}>
                    {t.inst.erfassen}
                  </Button>
                </>
              ) : null}
            </span>
          ))}
        </>
      }
    />
  );
}

function Ueberschuesse({ daten, schreiben, onWahl }: { daten: Instrumentdaten; schreiben: boolean; onWahl: (o: Offen) => void }) {
  const t = useT();
  const sprache = useSprache();
  const u = t.inst.ueberschuesse;
  type Zeile = Instrumentdaten["jahresueberschuesse"][number];
  const spalten: TabelleSpalte<Zeile>[] = [
    { schluessel: "jahr", kopf: u.spalten.jahr, zelle: (v) => String(v.jahr) },
    { schluessel: "betrag", kopf: u.spalten.betrag, zahl: true, zelle: (v) => formatBetragCent(v.betrag, sprache) },
    ...(schreiben
      ? [
          {
            schluessel: "aktion",
            kopf: u.spalten.aktion,
            zelle: (v: Zeile) => (
              <Button variante="sekundaer" groesse="s" aria-label={u.aendernFuer(v.jahr)} onClick={() => onWahl({ art: "ueberschuss", jahr: v.jahr, betrag: v.betrag })}>
                {u.aendern}
              </Button>
            ),
          },
        ]
      : []),
  ];
  return (
    <Karte titel={u.titel} aktion={schreiben ? <KartenAktion label={u.erfassen} onClick={() => onWahl({ art: "ueberschuss" })} /> : null}>
      <Tabelle dicht beschriftung={u.titel} spalten={spalten} zeilen={daten.jahresueberschuesse} zeilenSchluessel={(v) => v.jahr} />
    </Karte>
  );
}

function Forderungen({ daten, schreiben, onWahl }: { daten: Instrumentdaten; schreiben: boolean; onWahl: (o: Offen) => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.inst.forderungen;
  const keinWert = t.gemeinsam.keinWert;
  const spalten: TabelleSpalte<Forderung>[] = [
    { schluessel: "art", kopf: f.spalten.art, zelle: (v) => aufzaehlung(f.art, v.art) },
    { schluessel: "betrag", kopf: f.spalten.betrag, zahl: true, zelle: (v) => formatBetragCent(v.betrag, sprache) },
    { schluessel: "faellig", kopf: f.spalten.faellig, zelle: (v) => formatDatum(v.faelligAm, sprache) },
    { schluessel: "status", kopf: f.spalten.status, zelle: (v) => (v.erfuelltAm ? <Status variante="freigegeben">{f.erfuellt(formatDatum(v.erfuelltAm, sprache))}</Status> : <Status variante="pruefung">{f.offen}</Status>) },
    ...(schreiben
      ? [
          {
            schluessel: "aktion",
            kopf: f.spalten.aktion,
            zelle: (v: Forderung) =>
              v.erfuelltAm ? (
                keinWert
              ) : (
                <Button variante="sekundaer" groesse="s" aria-label={f.erfuellenFuer(aufzaehlung(f.art, v.art))} onClick={() => onWahl({ art: "forderung", id: v.id })}>
                  {f.erfuellen}
                </Button>
              ),
          },
        ]
      : []),
  ];
  return (
    <Karte titel={f.titel} breit>
      <Tabelle dicht beschriftung={f.titel} spalten={spalten} zeilen={daten.forderungen} zeilenSchluessel={(v) => v.id} />
    </Karte>
  );
}

function VerkaufKarte({ daten, verkauf: x, schreibgeschuetzt, onWahl }: { daten: Instrumentdaten; verkauf: Verkauf; schreibgeschuetzt: boolean; onWahl: (o: Offen) => void }) {
  const t = useT();
  const sprache = useSprache();
  const v = t.inst.verkaeufe;
  const person = useNamen([x.storniertVon]);
  return (
    <Karte
      titel={
        <>
          {v.titel} · {formatDatum(x.datum, sprache)} {x.storniertAm ? <Status variante="fehlt">{v.storniert}</Status> : null}
        </>
      }
    >
      {x.storniertAm ? <p className="app-leer-text">{v.storniertAm(person(x.storniertVon) ?? "", formatZeitpunkt(x.storniertAm, sprache))}</p> : null}
      <Fakten
        darstellung="liste"
        eintraege={[
          { label: v.anteil, wert: zahl(formatSatz(x.anteilVerkauft, sprache)) },
          { label: v.kaufpreis, wert: zahl(formatBetragCent(x.kaufpreis, sprache)) },
          { label: v.kosten, wert: zahl(formatBetragCent(x.kosten, sprache)) },
          ...(Number(x.principalDisposed) > 0 ? [{ label: t.verzicht.kapitalabgang, wert: zahl(formatBetragCent(x.principalDisposed, sprache)) }] : []),
          { label: v.buchwertAbgang, wert: zahl(formatBetragCent(x.buchwertAbgang, sprache)) },
          { label: v.ergebnis, wert: zahl(formatBetragCent(x.ergebnis, sprache)) },
          ...(x.anpassungen.length > 0 ? [{ label: v.ergebnisMitAnpassungen, wert: zahl(formatBetragCent(x.ergebnisMitAnpassungen, sprache)) }] : []),
        ]}
      />
      {x.anpassungen.length > 0 ? (
        <ul className="app-liste-klein" aria-label={v.anpassungen}>
          {x.anpassungen.map((a) => (
            <li key={a.id}>
              {formatDatum(a.datum, sprache)}: <span className="app-zahl">{formatBetragCent(a.betrag, sprache)}</span>, {a.grund}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="app-knoepfe">
        {!x.storniertAm ? <BelegKnopf art="verkauf" bezugArt="verkauf" bezugId={x.id} fondsId={daten.beteiligung.fondsId} /> : null}
        {!x.storniertAm && !schreibgeschuetzt ? (
          <Button variante="gefahr" aria-label={v.stornierenFuer(formatDatum(x.datum, sprache))} onClick={() => onWahl({ art: "verkaufStorno", verkauf: x })}>
            {v.stornieren}
          </Button>
        ) : null}
      </div>
      <details>
        <summary>{v.herkunft}</summary>
        <Rechenweg titel={v.titel} stichtag={x.datum} schritte={x.schritte as never} />
      </details>
    </Karte>
  );
}
