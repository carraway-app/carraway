import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Hinweis, Kennwerte, Karte, Leer, Status, Tabelle, formatBetrag, formatDatum, type StatusVariante, type TabelleSpalte } from "@carraway/ui";
import { instrumentdaten } from "../api/abfragen";
import { heuteIso } from "../api/datum";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { geltendeKondition, trancheOffen, type InstrumentZeile, type Kondition, type Tranche } from "../lib/instrumente";
import { formatAnzahl, formatBetragCent, formatPreis, formatSatz } from "../lib/zahl";
import { FehlerHinweis } from "./FehlerHinweis";
import { ErfuelltDialog, KonditionDialog } from "./InstrumentDialoge";
import { Skelettzeilen } from "./Skelett";
import type { AusuebungZeile } from "./OptionsscheinDialoge";
import type { WandlungRunde } from "./WandlungDialog";

// Dialoge dieses Bereichs laden erst beim Öffnen.
const TrancheAnlegenDialog = lazy(() => import("./TrancheDialoge").then((m) => ({ default: m.TrancheAnlegenDialog })));
const TrancheBearbeitenDialog = lazy(() => import("./TrancheDialoge").then((m) => ({ default: m.TrancheBearbeitenDialog })));
const InstrumentAnlegenDialog = lazy(() => import("./TrancheDialoge").then((m) => ({ default: m.InstrumentAnlegenDialog })));
const InstrumentBearbeitenDialog = lazy(() => import("./TrancheDialoge").then((m) => ({ default: m.InstrumentBearbeitenDialog })));
const AusuebungDialog = lazy(() => import("./OptionsscheinDialoge").then((m) => ({ default: m.AusuebungDialog })));
const AusuebungStornoDialog = lazy(() => import("./OptionsscheinDialoge").then((m) => ({ default: m.AusuebungStornoDialog })));
const WandlungDialog = lazy(() => import("./WandlungDialog").then((m) => ({ default: m.WandlungDialog })));

const STATUS: Record<string, StatusVariante> = { aktiv: "freigegeben", gewandelt: "entwurf", getilgt: "entwurf", verkauft: "entwurf", abgeschrieben: "fehlt" };
const TRANCHE_STAND: Record<string, StatusVariante> = { zugesagt: "entwurf", teilweise_gezahlt: "pruefung", gezahlt: "freigegeben" };

type Offen =
  | { art: "anlegen" }
  | { art: "tranche"; instrumentId: string }
  | { art: "bearbeiten"; instrument: InstrumentZeile }
  | { art: "kondition"; instrument: InstrumentZeile }
  | { art: "wandlung"; instrument: InstrumentZeile }
  | { art: "ausueben"; instrument: InstrumentZeile }
  | { art: "ausuebungStorno"; instrumentId: string; ausuebung: AusuebungZeile }
  | { art: "erfuellt"; tranche: Tranche }
  | { art: "trancheBearbeiten"; tranche: Tranche };

/** Hat das Instrument nach dem Stand der Seite schon Vorgänge, Tranchen oder Konditionen? Dann lässt die API die Art nicht mehr ändern. */
const artGesperrt = (i: InstrumentZeile, konditionen: Kondition[]) =>
  i.tranchen.length > 0 || konditionen.some((k) => k.instrumentId === i.id) || [i.zusage, i.ausgezahlt, i.tilgungen, i.rueckfluesse, i.zinsen, i.wertberichtigungen, i.gezahlteZinsen, i.dividenden, i.buchwertabgang].some((w) => Number(w) !== 0);

const zahl = (wert: string) => <span className="app-zahl">{wert}</span>;

/** Bereich „Instrumente“: je Instrument eine Karte mit Zusage, Ausgezahltem, Konditionen und den Tranchen; Aktionen zum Anlegen von Tranchen, Ändern und Wandeln. */
export function InstrumenteAbschnitt({ beteiligungId, organisationId, runden, schreibgeschuetzt, wegenStand }: { beteiligungId: string; organisationId: string; runden: WandlungRunde[]; schreibgeschuetzt: boolean; wegenStand: boolean }) {
  const t = useT();
  const a = t.instrumenteAbschnitt;
  const { data, error, isPending } = useQuery(instrumentdaten(beteiligungId));
  const [offen, setOffen] = useState<Offen | null>(null);
  const schliessen = () => setOffen(null);
  const aktiv = data?.beteiligung.status === "aktiv";
  const schreiben = !schreibgeschuetzt && aktiv;

  return (
    <section className="app-instrument" aria-label={a.titel}>
      <div className="app-abschnittskopf">
        <h2 className="cw-t-untertitel app-karte__titel">{a.titel}</h2>
        {schreiben ? <Button onClick={() => setOffen({ art: "anlegen" })}>{a.anlegen}</Button> : null}
      </div>
      {schreibgeschuetzt && wegenStand ? <Hinweis>{t.inst.wissensstandGesperrt}</Hinweis> : null}
      <p className="app-leer-text app-klein">{a.hinweis}</p>
      {isPending ? <Skelettzeilen anzahl={3} /> : null}
      {error ? <FehlerHinweis fehler={error} /> : null}
      {data && data.instrumente.length === 0 ? <Leer kompakt beschreibung={a.keine} /> : null}
      {data
        ? data.instrumente.map((i) => (
            <InstrumentKarte key={i.id} instrument={i} konditionen={data.konditionen} schreiben={schreiben} waehrung={data.beteiligung.waehrung} onWahl={setOffen} />
          ))
        : null}

      <Suspense fallback={null}>
        {offen?.art === "anlegen" ? <InstrumentAnlegenDialog beteiligungId={beteiligungId} organisationId={organisationId} onSchliessen={schliessen} /> : null}
        {data && offen?.art === "tranche" ? <TrancheAnlegenDialog instrumente={data.instrumente} instrumentId={offen.instrumentId} onSchliessen={schliessen} /> : null}
        {offen?.art === "bearbeiten" ? <InstrumentBearbeitenDialog instrument={offen.instrument} organisationId={organisationId} artGesperrt={data ? artGesperrt(offen.instrument, data.konditionen) : true} waehrung={data?.beteiligung.waehrung} onSchliessen={schliessen} /> : null}
        {offen?.art === "trancheBearbeiten" ? <TrancheBearbeitenDialog tranche={offen.tranche} onSchliessen={schliessen} /> : null}
        {offen?.art === "wandlung" ? <WandlungDialog beteiligungId={beteiligungId} organisationId={organisationId} instrumentId={offen.instrument.id} vorbelegung={offen.instrument} safe={offen.instrument.art === "safe"} runden={runden} onSchliessen={schliessen} /> : null}
        {offen?.art === "ausueben" ? <AusuebungDialog instrument={offen.instrument} onSchliessen={schliessen} /> : null}
        {offen?.art === "ausuebungStorno" ? <AusuebungStornoDialog instrumentId={offen.instrumentId} ausuebung={offen.ausuebung} onSchliessen={schliessen} /> : null}
      </Suspense>
      {data && offen?.art === "kondition" ? (
        <KonditionDialog beteiligungId={beteiligungId} instrumentId={offen.instrument.id} konditionen={data.konditionen.filter((k) => k.instrumentId === offen.instrument.id)} onSchliessen={schliessen} />
      ) : null}
      {offen?.art === "erfuellt" ? <ErfuelltDialog tranche={offen.tranche} onSchliessen={schliessen} /> : null}
    </section>
  );
}

function InstrumentKarte({ instrument: i, konditionen, schreiben, waehrung, onWahl }: { instrument: InstrumentZeile; konditionen: Kondition[]; schreiben: boolean; waehrung: string; onWahl: (o: Offen) => void }) {
  const t = useT();
  const sprache = useSprache();
  const a = t.instrumenteAbschnitt;
  const meine = konditionen.filter((k) => k.instrumentId === i.id);
  const aktuell = geltendeKondition(konditionen, i.id, heuteIso());
  const aktiv = i.status === "aktiv";
  const fuer = (aktion: string) => a.aktionFuer(aktion, i.bezeichnung);
  const gezahlt = i.tranchen.filter((x) => !trancheOffen(x)).length;
  const aktionen = schreiben ? (
    <div className="app-knoepfe">
      {aktiv ? (
        <Button variante="sekundaer" groesse="s" aria-label={fuer(a.aktionen.trancheAnlegen)} onClick={() => onWahl({ art: "tranche", instrumentId: i.id })}>
          {a.aktionen.trancheAnlegen}
        </Button>
      ) : null}
      {i.darlehensartig ? (
        <Button variante="sekundaer" groesse="s" aria-label={fuer(a.aktionen.konditionen)} onClick={() => onWahl({ art: "kondition", instrument: i })}>
          {a.aktionen.konditionen}
        </Button>
      ) : null}
      {aktiv && i.art === "wandeldarlehen" ? (
        <Button variante="sekundaer" groesse="s" aria-label={fuer(a.aktionen.wandlung)} onClick={() => onWahl({ art: "wandlung", instrument: i })}>
          {a.aktionen.wandlung}
        </Button>
      ) : null}
      {aktiv && i.art === "safe" ? (
        <Button variante="sekundaer" groesse="s" aria-label={fuer(t.optionsschein.wandeln)} onClick={() => onWahl({ art: "wandlung", instrument: i })}>
          {t.optionsschein.wandeln}
        </Button>
      ) : null}
      {aktiv && i.optionsschein && Number(i.optionsschein.offen) > 0 ? (
        <Button variante="sekundaer" groesse="s" aria-label={fuer(t.optionsschein.ausueben)} onClick={() => onWahl({ art: "ausueben", instrument: i })}>
          {t.optionsschein.ausueben}
        </Button>
      ) : null}
      <Button variante="ruhig" groesse="s" aria-label={fuer(a.aktionen.bearbeiten)} onClick={() => onWahl({ art: "bearbeiten", instrument: i })}>
        {a.aktionen.bearbeiten}
      </Button>
    </div>
  ) : null;

  return (
    <>
      <Karte
        id={`instrument-${i.id}`}
        breit
        titel={
          <>
            {i.bezeichnung} <Status variante={STATUS[i.status] ?? "entwurf"}>{aufzaehlung(a.status, i.status)}</Status>
          </>
        }
        aktion={aktionen}
      >
        <p className="app-instrument__meta">
          {[aufzaehlung(t.instrument, i.art), i.runde ? `${a.runde}: ${i.runde.bezeichnung}` : null, i.anteilsklasse ? `${a.klasse}: ${i.anteilsklasse.name}` : null].filter(Boolean).join(" · ")}
        </p>
        <Kennwerte
          gedaempft={!aktiv}
          gruppen={[
            {
              id: "kapital",
              titel: a.gruppen.kapital,
              eintraege: [
                ...(i.offenesKapital !== null ? [{ id: "ok", label: a.offenesKapital, wert: zahl(formatBetragCent(i.offenesKapital, sprache)), primaer: true }] : []),
                { id: "bw", label: a.buchwert, wert: zahl(formatBetragCent(i.buchwert, sprache)), primaer: true },
                { id: "zu", label: a.zusage, wert: zahl(formatBetragCent(i.zusage, sprache)) },
                { id: "au", label: a.ausgezahlt, wert: zahl(formatBetragCent(i.ausgezahlt, sprache)) },
                { id: "oz", label: a.offeneZusage, wert: zahl(formatBetragCent(i.offeneZusage, sprache)), ruhig: Number(i.offeneZusage) === 0 },
                { id: "tr", label: a.fortschritt, wert: a.fortschrittWert(gezahlt, i.tranchen.length), ruhig: i.tranchen.length === 0 },
              ],
            },
            ...(i.art === "wandeldarlehen" || i.art === "safe" ? [{ id: "wandlung", titel: a.gruppen.wandlung, eintraege: wandlungEintraege(i, t, sprache, waehrung) }] : []),
            ...(i.optionsschein ? [{ id: "optionsschein", titel: t.optionsschein.gruppe, eintraege: optionsscheinEintraege(i.optionsschein, t, sprache, waehrung) }] : []),
            ...(i.darlehensartig && aktuell ? [{ id: "konditionen", titel: a.gruppen.konditionen, eintraege: konditionenEintraege(aktuell, t, sprache) }] : []),
          ]}
        />
        {i.darlehensartig && !aktuell ? <KonditionenZeile aktuell={aktuell} name={i.bezeichnung} schreiben={schreiben} onErfassen={() => onWahl({ art: "kondition", instrument: i })} /> : null}
        {i.optionsschein ? <Ausuebungen instrumentId={i.id} optionsschein={i.optionsschein} name={i.bezeichnung} schreiben={schreiben} onWahl={onWahl} /> : null}
        <Tranchen instrument={i} schreiben={schreiben} onWahl={onWahl} />
      </Karte>
      {meine.length > 1 ? <KonditionenVerlauf konditionen={meine} aktuell={aktuell} name={i.bezeichnung} /> : null}
    </>
  );
}

/** Wandlungsparameter des Wandeldarlehens als Kennwerte; was nicht erfasst ist, steht gedämpft als „kein Wert“. */
function wandlungEintraege(i: InstrumentZeile, t: ReturnType<typeof useT>, sprache: ReturnType<typeof useSprache>, waehrung: string) {
  const w = t.instrumenteAbschnitt.wandlung;
  const keinWert = t.gemeinsam.keinWert;
  const ohneZinsen = i.art === "safe";
  return [
    { id: "abschlag", label: w.abschlag, wert: i.wandlungsabschlag === null ? keinWert : zahl(formatSatz(i.wandlungsabschlag, sprache)), ruhig: i.wandlungsabschlag === null },
    { id: "cap", label: w.obergrenze, wert: i.bewertungsobergrenze === null ? keinWert : zahl(formatBetragCent(i.bewertungsobergrenze, sprache, waehrung)), ruhig: i.bewertungsobergrenze === null },
    ...(ohneZinsen ? [] : [{ id: "zinsen", label: w.zinsen, wert: i.zinsenWandeln === null ? keinWert : i.zinsenWandeln ? w.ja : w.nein, ruhig: i.zinsenWandeln === null }]),
  ];
}

/** Optionsscheine als Kennwerte: Bedingungen und Stand zum Tag der Seite (ausgeübt, offen, verfallen). */
function optionsscheinEintraege(o: NonNullable<InstrumentZeile["optionsschein"]>, t: ReturnType<typeof useT>, sprache: ReturnType<typeof useSprache>, waehrung: string) {
  const c = t.optionsschein;
  const keinWert = t.gemeinsam.keinWert;
  return [
    { id: "anzahl", label: c.anzahl, wert: zahl(formatAnzahl(o.anzahl, sprache)), primaer: true },
    { id: "ausgeuebt", label: c.ausgeuebt, wert: zahl(formatAnzahl(o.ausgeuebt, sprache)), ruhig: Number(o.ausgeuebt) === 0 },
    { id: "offen", label: c.offen, wert: zahl(formatAnzahl(o.offen, sprache)), hinweis: `${aufzaehlung(c.status, o.status)} · ${c.stand(formatDatum(o.stichtag, sprache))}`, ruhig: Number(o.offen) === 0 },
    ...(Number(o.verfallen) > 0 ? [{ id: "verfallen", label: c.verfallen, wert: zahl(formatAnzahl(o.verfallen, sprache)), ruhig: true }] : []),
    { id: "preis", label: c.preis, wert: zahl(`${formatPreis(o.ausuebungspreis, sprache)} ${waehrung}`) },
    { id: "ausgabe", label: c.ausgabe, wert: o.ausgabeAm ? zahl(formatDatum(o.ausgabeAm, sprache)) : keinWert, ruhig: !o.ausgabeAm },
    { id: "laufzeit", label: c.laufzeit, wert: o.laufzeitBis ? zahl(formatDatum(o.laufzeitBis, sprache)) : keinWert, ruhig: !o.laufzeitBis },
  ];
}

/** Ausübungen der Optionsscheine; jede lässt sich als Ganzes stornieren. */
function Ausuebungen({ instrumentId, optionsschein, name, schreiben, onWahl }: { instrumentId: string; optionsschein: NonNullable<InstrumentZeile["optionsschein"]>; name: string; schreiben: boolean; onWahl: (o: Offen) => void }) {
  const t = useT();
  const sprache = useSprache();
  const m = t.optionsschein.ausuebungen;
  if (optionsschein.ausuebungen.length === 0) return <p className="app-leer-text">{m.keine}</p>;
  const spalten: TabelleSpalte<AusuebungZeile>[] = [
    { schluessel: "datum", kopf: m.spalten.datum, zelle: (x) => formatDatum(x.datum, sprache) },
    { schluessel: "anzahl", kopf: m.spalten.anzahl, zahl: true, zelle: (x) => formatAnzahl(x.anzahl, sprache) },
    { schluessel: "preis", kopf: m.spalten.preis, zahl: true, zelle: (x) => formatPreis(x.preisJeAnteil, sprache) },
    { schluessel: "betrag", kopf: m.spalten.betrag, zahl: true, zelle: (x) => formatBetragCent(x.betrag, sprache) },
    ...(schreiben
      ? [
          {
            schluessel: "aktion",
            kopf: m.spalten.aktion,
            zelle: (x: AusuebungZeile) => (
              <Button variante="ruhig" groesse="s" aria-label={m.stornierenFuer(formatDatum(x.datum, sprache), formatAnzahl(x.anzahl, sprache))} onClick={() => onWahl({ art: "ausuebungStorno", instrumentId, ausuebung: x })}>
                {m.stornieren}
              </Button>
            ),
          },
        ]
      : []),
  ];
  return <Tabelle dicht beschriftung={`${m.titel}: ${name}`} spalten={spalten} zeilen={optionsschein.ausuebungen} zeilenSchluessel={(x) => x.id} />;
}

/** Konditionen als Kennwerte: Zins mit Methode und Periode in einem Eintrag; Standardwerte gedämpft. */
function konditionenEintraege(k: Kondition, t: ReturnType<typeof useT>, sprache: ReturnType<typeof useSprache>) {
  const c = t.inst.konditionen;
  const keinWert = t.gemeinsam.keinWert;
  return [
    { id: "zins", label: t.instrumenteAbschnitt.zins, wert: zahl(t.instrumenteAbschnitt.zinsFest(formatSatz(k.satzFix, sprache))), hinweis: `${aufzaehlung(t.zinsmethode, k.methode)} · ${aufzaehlung(t.zinsperiode, k.zinsperiode)}`, primaer: true },
    { id: "faellig", label: c.faelligAm, wert: k.faelligAm ? zahl(formatDatum(k.faelligAm, sprache)) : keinWert, ruhig: !k.faelligAm },
    { id: "gewinn", label: c.gewinn, wert: k.gewinnabhaengigSatz ? zahl(`${formatSatz(k.gewinnabhaengigSatz, sprache)} / ${c.kappung} ${formatSatz(k.kappungSatz, sprache)}`) : c.keinGewinn, ruhig: !k.gewinnabhaengigSatz },
    { id: "stundung", label: c.stundung, wert: k.stundungBis ? zahl(formatDatum(k.stundungBis, sprache)) : keinWert, ruhig: !k.stundungBis },
    { id: "kap", label: c.kapitalisieren, wert: k.kapitalisieren ? c.ja : c.nein, ruhig: !k.kapitalisieren },
  ];
}

/** Konditionen des Instruments als eine Zeile (gültige Version) oder der Hinweis, dass keine erfasst sind. */
function KonditionenZeile({ aktuell, name, schreiben, onErfassen }: { aktuell: Kondition | undefined; name: string; schreiben: boolean; onErfassen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const a = t.instrumenteAbschnitt;
  if (!aktuell) {
    return (
      <Leer
        kompakt
        beschreibung={
          <>
            {a.konditionenKeine}{" "}
            {schreiben ? (
              <Button variante="ruhig" groesse="s" aria-label={a.aktionFuer(a.konditionenErfassen, name)} onClick={onErfassen}>
                {a.konditionenErfassen}
              </Button>
            ) : null}
          </>
        }
      />
    );
  }
  return <Kennwerte gruppen={[{ titel: t.inst.konditionen.titel, eintraege: konditionenEintraege(aktuell, t, sprache) }]} />;
}

function KonditionenVerlauf({ konditionen, aktuell, name }: { konditionen: Kondition[]; aktuell: Kondition | undefined; name: string }) {
  const t = useT();
  const sprache = useSprache();
  const k = t.inst.konditionen;
  const keinWert = t.gemeinsam.keinWert;
  const spalten: TabelleSpalte<Kondition>[] = [
    { schluessel: "gueltigAb", kopf: k.gueltigAb, zelle: (v) => formatDatum(v.gueltigAb, sprache) },
    { schluessel: "satzFix", kopf: k.satzFix, zahl: true, zelle: (v) => formatSatz(v.satzFix, sprache) },
    { schluessel: "methode", kopf: k.methode, zelle: (v) => aufzaehlung(t.zinsmethode, v.methode) },
    { schluessel: "zinsperiode", kopf: k.zinsperiode, zelle: (v) => aufzaehlung(t.zinsperiode, v.zinsperiode) },
    { schluessel: "gewinn", kopf: k.gewinn, zahl: true, zelle: (v) => (v.gewinnabhaengigSatz ? `${formatSatz(v.gewinnabhaengigSatz, sprache)} / ${k.kappung} ${formatSatz(v.kappungSatz, sprache)}` : k.keinGewinn) },
    { schluessel: "stundung", kopf: k.stundung, zelle: (v) => (v.stundungBis ? formatDatum(v.stundungBis, sprache) : keinWert) },
    { schluessel: "kapitalisieren", kopf: k.kapitalisieren, zelle: (v) => (v.kapitalisieren ? k.ja : k.nein) },
    { schluessel: "faelligAm", kopf: k.faelligAm, zelle: (v) => (v.faelligAm ? formatDatum(v.faelligAm, sprache) : keinWert) },
  ];
  return (
    <Karte titel={`${k.verlauf} · ${name}`} breit>
      <Tabelle dicht beschriftung={`${k.verlauf} · ${name}`} spalten={spalten} zeilen={konditionen} zeilenSchluessel={(v) => v.id} ausgewaehlt={(v) => v.id === aktuell?.id} />
    </Karte>
  );
}

function Tranchen({ instrument: i, schreiben, onWahl }: { instrument: InstrumentZeile; schreiben: boolean; onWahl: (o: Offen) => void }) {
  const t = useT();
  const sprache = useSprache();
  const a = t.instrumenteAbschnitt;
  const m = a.tranchen;
  const keinWert = t.gemeinsam.keinWert;
  if (i.tranchen.length === 0) return <p className="app-leer-text">{m.keine}</p>;
  const spalten: TabelleSpalte<Tranche>[] = [
    { schluessel: "nummer", kopf: m.spalten.nummer, zelle: (x) => <span className="app-zahl">{x.nummer}</span> },
    { schluessel: "bezeichnung", kopf: m.spalten.bezeichnung, zelle: (x) => x.bezeichnung },
    { schluessel: "geplantAm", kopf: m.spalten.geplantAm, zelle: (x) => (x.geplantAm ? formatDatum(x.geplantAm, sprache) : keinWert) },
    { schluessel: "bedingung", kopf: m.spalten.bedingung, umbruch: true, zelle: (x) => x.bedingung ?? keinWert },
    { schluessel: "betrag", kopf: m.spalten.betrag, zahl: true, zelle: (x) => formatBetrag(x.betrag, sprache) },
    { schluessel: "gezahlt", kopf: m.spalten.gezahlt, zahl: true, zelle: (x) => formatBetrag(x.stand.ausgezahlt, sprache) },
    { schluessel: "stand", kopf: m.spalten.stand, zelle: (x) => <Status variante={TRANCHE_STAND[x.stand.zahlung] ?? "entwurf"}>{aufzaehlung(m.stand, x.stand.zahlung)}</Status> },
    {
      schluessel: "bedingungStand",
      kopf: m.spalten.bedingungStand,
      zelle: (x) =>
        x.stand.bedingung === null ? (
          keinWert
        ) : x.stand.bedingung === "erfuellt" ? (
          <Status variante="freigegeben">{x.erfuelltAm ? m.bedingungErfuellt(formatDatum(x.erfuelltAm, sprache)) : keinWert}</Status>
        ) : (
          <Status variante="pruefung">{m.bedingungOffen}</Status>
        ),
    },
    ...(schreiben
      ? [
          {
            schluessel: "aktion",
            kopf: m.spalten.aktion,
            zelle: (x: Tranche) => (
              <span className="app-aktionen__knoepfe">
                {x.stand.bedingung === "offen" ? (
                  <Button variante="sekundaer" groesse="s" aria-label={m.erfuellenFuer(x.bezeichnung)} onClick={() => onWahl({ art: "erfuellt", tranche: x })}>
                    {m.erfuellen}
                  </Button>
                ) : null}
                <Button variante="ruhig" groesse="s" aria-label={m.bearbeitenFuer(x.bezeichnung)} onClick={() => onWahl({ art: "trancheBearbeiten", tranche: x })}>
                  {m.bearbeiten}
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];
  return <Tabelle dicht beschriftung={`${m.titel}: ${i.bezeichnung}`} spalten={spalten} zeilen={i.tranchen} zeilenSchluessel={(x) => x.id} />;
}
