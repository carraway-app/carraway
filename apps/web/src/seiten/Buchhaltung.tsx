import { KeinFonds } from "./Platzhalter";
import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Auswahl, Button, ButtonLink, Feld, Hinweis, Inhaltsverzeichnis, Seitenkopf, Status, Tabelle, formatDatum, type TabelleSpalte } from "@carraway/ui";
import { fondsBewegungen, fondsListe, zinslaufListe } from "../api/abfragen";
import {
  abstimmung,
  auswertung,
  auswertungDateiUrl,
  buchhaltungKonfig,
  buchungsexporte,
  exportDateiUrl,
  gliederung,
  kontenregeln,
  mittelarten,
  perioden,
  saldenlaeufe,
  saldenlauf,
  saldenImLauf,
  SICHTEN,
  useExportErstellen,
  useExportVorschau,
  useKonfigSetzen,
  useMittelartenSetzen,
  useRegelAnlegen,
  useSaldenlaufHochladen,
  useSaldenlaufPruefen,
  useSaldenlaufUebernehmen,
  useStandardgliederung,
  MELDE_ARTEN,
  type AuswertungDaten,
  type MeldeArt,
  type SaldenlaufZeile,
} from "../api/buchhaltung";
import { ApiFehler } from "../api/client";
import { DateiDropzone } from "../komponenten/DateiDropzone";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { BuchungsAuswahl, idsAus, type Auswahlstand } from "../komponenten/BuchungsAuswahl";
import { Quellenstand } from "../komponenten/Quellenstand";
import { NurLesen } from "../komponenten/NurLesen";
import { BetragFeld } from "../komponenten/BetragFeld";
import { pruefungText, useFormular } from "../komponenten/formular";
import { datumRegel, ganzzahlRegel, pflichtRegel, prozentRegel } from "../lib/feldpruefung";
import { VorlagenKarte } from "./BuchhaltungVorlagen";
import { BuchungsregelnKarte, GliederungEditor, KontenKarte } from "./BuchhaltungStamm";
import { feldText } from "../i18n/fehler";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { useNamen } from "../lib/namen";
import { wirksamerFonds } from "../lib/fonds";
import { useRechte } from "../lib/rechte";
import { formatBetragCent } from "../lib/zahl";
import { formatZeitpunkt } from "../lib/zeit";
import { useInhalt, type InhaltsEintrag } from "../lib/tabs";
import { merkeFonds } from "../zustand";

const route = getRouteApi("/buchhaltung");

export type Bereich = "saldenlisten" | "auswertung" | "export" | "einstellungen";
export const BEREICHE: readonly Bereich[] = ["saldenlisten", "auswertung", "export", "einstellungen"];
const EINSTELLUNGEN_UNTER = ["konfiguration", "konten", "regeln", "vorlagen"] as const;
type EinstellungenUnter = (typeof EINSTELLUNGEN_UNTER)[number];
type Eintrag = "saldenlisten" | "export" | "auswertung" | EinstellungenUnter;

/** Gliederung des Inhaltsverzeichnisses mit den bisherigen Adressen: `?tab=…`, bei den Einstellungen zusätzlich `&unter=…`. Der erste Eintrag ist der Standard. */
const GRUPPEN: readonly { id: "buchen" | "auswerten" | "einstellungen"; eintraege: readonly (InhaltsEintrag & { id: Eintrag })[] }[] = [
  { id: "buchen", eintraege: [{ id: "saldenlisten", tab: "saldenlisten" }, { id: "export", tab: "export" }] },
  { id: "auswerten", eintraege: [{ id: "auswertung", tab: "auswertung" }] },
  { id: "einstellungen", eintraege: EINSTELLUNGEN_UNTER.map((u) => ({ id: u, tab: "einstellungen", unter: u })) },
];
const EINTRAEGE = GRUPPEN.flatMap((g) => g.eintraege);

/** Buchhaltung eines Fonds: Saldenlisten, Auswertungen mit Herkunft und Abstimmung, DATEV-Export und Einstellungen. */
export function BuchhaltungSeite() {
  const t = useT();
  const { data: fonds } = useSuspenseQuery(fondsListe());
  const suche = route.useSearch();
  const gewaehlt = wirksamerFonds(fonds, suche.fondsId);
  if (!gewaehlt) return <KeinFonds titel={t.buchhaltung.seite.titel} />;
  if (suche.laufId && suche.konto) return <SaldoQuelle fondsId={gewaehlt.id} waehrung={gewaehlt.waehrung} laufId={suche.laufId} konto={suche.konto} />;
  return <BuchhaltungFuerFonds key={gewaehlt.id} fondsId={gewaehlt.id} fondsName={gewaehlt.name} />;
}

function SaldoQuelle({ fondsId, waehrung, laufId, konto }: { fondsId: string; waehrung: string; laufId: string; konto: string }) {
  const t = useT();
  const sprache = useSprache();
  const { stichtag, stand } = route.useSearch();
  const { data: lauf } = useSuspenseQuery(saldenlauf(laufId));
  const { data: salden } = useSuspenseQuery(saldenImLauf(laufId));
  const person = useNamen([lauf.uebernommenVon]);
  const zeile = salden.find((s) => s.konto === konto);
  if (lauf.fondsId !== fondsId || !zeile) return <Hinweis>{t.gemeinsam.keinWert}</Hinweis>;
  return <div className="app-seite">
    <Seitenkopf titel={lauf.dateiname} meta={t.buchhaltung.salden.titel} />
    <Quellenstand stichtag={stichtag} stand={stand} />
    <dl className="app-fakten">
      <div><dt>{t.buchhaltung.auswertung.konto}</dt><dd>{konto} {zeile.bezeichnung}</dd></div>
      <div><dt>{t.buchhaltung.auswertung.saldo}</dt><dd>{formatBetragCent(zeile.saldo, sprache, waehrung)}</dd></div>
      {lauf.uebernommenAm ? <div><dt>{t.buchhaltung.salden.status.uebernommen}</dt><dd>{formatZeitpunkt(lauf.uebernommenAm, sprache)} · {person(lauf.uebernommenVon)}</dd></div> : null}
    </dl>
  </div>;
}

function BuchhaltungFuerFonds({ fondsId, fondsName }: { fondsId: string; fondsName: string }) {
  const t = useT();
  const s = t.buchhaltung.seite;
  const suche = route.useSearch();
  const navigate = route.useNavigate();
  const { aktiv, setzeAktiv } = useInhalt(suche, navigate, EINTRAEGE);
  merkeFonds(fondsId);
  const inhalt = (id: Eintrag): React.ReactNode => {
    switch (id) {
      case "saldenlisten":
        return <Saldenlisten fondsId={fondsId} />;
      case "auswertung":
        return <Auswertungen fondsId={fondsId} />;
      case "export":
        return <Buchungsexport fondsId={fondsId} />;
      default:
        return <Einstellungen fondsId={fondsId} unter={id} />;
    }
  };
  return (
    <div className="app-seite">
      <Seitenkopf meta={`${fondsName} · ${s.etikett}`} titel={s.titel} />
      <Inhaltsverzeichnis
        aria-label={s.bereiche}
        aktiv={aktiv}
        onWechsel={setzeAktiv}
        gruppen={GRUPPEN.map((g) => ({
          id: g.id,
          label: s.gruppen[g.id],
          eintraege: g.eintraege.map((e) => ({
            id: e.id,
            label: e.unter ? t.buchhaltung.einstellungen.unter[e.unter as EinstellungenUnter] : s.reiter[e.id as "saldenlisten" | "export" | "auswertung"],
            inhalt: () => inhalt(e.id),
          })),
        }))}
      />
    </div>
  );
}

// Saldenlisten -------------------------------------------------------------------------------------------------------------

function Saldenlisten({ fondsId }: { fondsId: string }) {
  const t = useT();
  const sprache = useSprache();
  const d = t.buchhaltung.salden;
  const { darf } = useRechte();
  const { data: laeufe } = useSuspenseQuery(saldenlaeufe(fondsId));
  const hochladen = useSaldenlaufHochladen(fondsId);
  const { werte, feld, pruefeAlle } = useFormular(
    { von: "", bis: "" },
    { von: datumRegel({ pflicht: true }), bis: (w, ws, k) => datumRegel<typeof ws>({ pflicht: true, min: ws.von || undefined })(w, ws, k) },
  );
  const [datei, setDatei] = useState<File | null>(null);
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);

  const spalten: TabelleSpalte<SaldenlaufZeile>[] = [
    { schluessel: "zeitraum", kopf: d.spalten.zeitraum, zelle: (l) => `${formatDatum(l.zeitraumVon, sprache)} – ${formatDatum(l.zeitraumBis, sprache)}` },
    { schluessel: "datei", kopf: d.spalten.datei, zelle: (l) => l.dateiname },
    {
      schluessel: "status",
      kopf: d.spalten.status,
      zelle: (l) => (
        <Status variante={l.status === "uebernommen" ? (l.ersetztAm ? "fehlt" : "freigegeben") : l.status === "geprueft" ? "pruefung" : "entwurf"}>
          {aufzaehlung(d.status, l.status)}
          {l.status === "uebernommen" ? ` (${l.ersetztAm ? d.ersetzt : d.gueltig})` : ""}
        </Status>
      ),
    },
    { schluessel: "konten", kopf: d.spalten.konten, zahl: true, zelle: (l) => String((l.summe as { konten?: number } | null)?.konten ?? t.gemeinsam.keinWert) },
    { schluessel: "befunde", kopf: d.spalten.befunde, zelle: (l) => (l.fehlerAnzahl === null ? t.gemeinsam.keinWert : `${l.fehlerAnzahl} / ${l.warnungAnzahl}`) },
    { schluessel: "aktion", kopf: d.spalten.aktion, zelle: (l) => <LaufAktionen lauf={l} onBefunde={() => setGewaehlt(l.id)} /> },
  ];

  return (
    <>
      <section className="app-karte" aria-label={d.titel}>
        <h2 className="cw-t-untertitel app-karte__titel">{d.titel}</h2>
        <p className="app-leer-text">{d.beschreibung}</p>
        {darf("bearbeiter", fondsId, "finanzen") ? (
          <form
            className="app-formular"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!datei || hochladen.isPending || !pruefeAlle()) return;
              hochladen.mutate({ datei, von: werte.von, bis: werte.bis }, { onSuccess: () => setDatei(null) });
            }}
          >
            <FehlerHinweis fehler={hochladen.error} bekannt={["zeitraumVon", "zeitraumBis"]} />
            <DateiDropzone label={d.datei} accept=".xlsx,.csv" deaktiviert={hochladen.isPending} dateiname={datei?.name} onDateien={([datei]) => setDatei(datei ?? null)} />
            <Feld label={d.von} type="date" {...feld("von", feldText(t, hochladen.error, "zeitraumVon"))} />
            <Feld label={d.bis} type="date" {...feld("bis", feldText(t, hochladen.error, "zeitraumBis"))} />
            <div>
              <Button type="submit" disabled={hochladen.isPending || !datei}>
                {d.hochladen}
              </Button>
            </div>
          </form>
        ) : (
          <NurLesen fondsId={fondsId} bereich="finanzen" />
        )}
      </section>
      <section className="app-karte">
        {laeufe.length === 0 ? <p className="app-leer-text">{d.keine}</p> : <Tabelle beschriftung={d.liste} spalten={spalten} zeilen={laeufe} zeilenSchluessel={(l) => l.id} />}
      </section>
      {gewaehlt ? <LaufBefunde id={gewaehlt} /> : null}
    </>
  );
}

function LaufAktionen({ lauf, onBefunde }: { lauf: SaldenlaufZeile; onBefunde: () => void }) {
  const t = useT();
  const d = t.buchhaltung.salden;
  const { ich, darf } = useRechte();
  const pruefen = useSaldenlaufPruefen(lauf.id);
  const uebernehmen = useSaldenlaufUebernehmen(lauf.id);
  const uebernommen = lauf.status === "uebernommen";
  const darfUebernehmen = !!ich && darf("freigeber", lauf.fondsId, "finanzen") && ich.id !== lauf.hochgeladenVon && ich.id !== lauf.geprueftVon;
  return (
    <div className="app-aktionen__knoepfe">
      {lauf.fehlerAnzahl !== null ? (
        <Button variante="sekundaer" onClick={onBefunde}>
          {d.befunde}
        </Button>
      ) : null}
      {!uebernommen && darf("bearbeiter", lauf.fondsId, "finanzen") ? (
        <Button variante="sekundaer" disabled={pruefen.isPending} onClick={() => pruefen.mutate()}>
          {d.pruefen}
        </Button>
      ) : null}
      {!uebernommen ? (
        <Button disabled={uebernehmen.isPending || lauf.status !== "geprueft" || !darfUebernehmen} aria-describedby={!darfUebernehmen && lauf.status === "geprueft" ? `ue-${lauf.id}` : undefined} onClick={() => uebernehmen.mutate()}>
          {d.uebernehmen}
        </Button>
      ) : null}
      {!uebernommen && lauf.status === "geprueft" && !darfUebernehmen ? (
        <span id={`ue-${lauf.id}`} className="app-leer-text">
          {d.sperreUebernehmen}
        </span>
      ) : null}
      <FehlerHinweis fehler={pruefen.error ?? uebernehmen.error} />
    </div>
  );
}

function LaufBefunde({ id }: { id: string }) {
  const t = useT();
  const d = t.buchhaltung.salden;
  const { data: lauf } = useSuspenseQuery(saldenlauf(id));
  const summe = lauf.summe as { konten: number; saldensumme: string } | null;
  return (
    <section className="app-karte" aria-label={d.befunde}>
      <h2 className="cw-t-untertitel app-karte__titel">{d.befunde}</h2>
      {summe ? <p className="app-leer-text">{d.summeKonten(summe.konten, formatBetragCent(summe.saldensumme, "de"))} · {lauf.format === "datev" ? d.formatDatev : d.formatGenerisch}</p> : null}
      {lauf.befunde.length === 0 ? (
        <p className="app-leer-text">{d.keineBefunde}</p>
      ) : (
        <ul className="app-liste">
          {lauf.befunde.map((b) => (
            <li key={b.nr}>
              <Status variante={b.schweregrad === "fehler" ? "fehlt" : "pruefung"}>{b.schweregrad === "fehler" ? d.fehler : d.warnung}</Status>{" "}
              {aufzaehlung(t.buchhaltung.befundCodes, b.code)}
              {b.params && typeof (b.params as Record<string, unknown>).konto === "string" ? ` (${String((b.params as Record<string, unknown>).konto)})` : ""}
              {b.zeile ? ` – ${d.zeile(b.zeile)}` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Auswertungen -------------------------------------------------------------------------------------------------------------

function Auswertungen({ fondsId }: { fondsId: string }) {
  const t = useT();
  const sprache = useSprache();
  const d = t.buchhaltung.auswertung;
  const { darf } = useRechte();
  const { data: liste } = useSuspenseQuery(perioden(fondsId));
  const [sicht, setSicht] = useState<(typeof SICHTEN)[number]>("bilanz");
  const [bisGewaehlt, setBis] = useState("");
  const [ausgabeSprache, setAusgabeSprache] = useState<"de" | "en">(sprache);
  const bis = liste.some((p) => p.zeitraumBis === bisGewaehlt) ? bisGewaehlt : (liste[0]?.zeitraumBis ?? "");
  if (liste.length === 0) return <Hinweis>{d.keinZeitraum}</Hinweis>;
  return (
    <>
      <section className="app-karte" aria-label={d.titel}>
        <div className="app-aktionen">
          <Auswahl label={d.sicht} value={sicht} onChange={(e) => setSicht(e.target.value as (typeof SICHTEN)[number])}>
            {SICHTEN.map((s) => (
              <option key={s} value={s}>
                {aufzaehlung(t.buchhaltung.sichten, s)}
              </option>
            ))}
          </Auswahl>
          <Auswahl label={d.zeitraum} value={bis} onChange={(e) => setBis(e.target.value)}>
            {liste.map((p) => (
              <option key={p.laufId} value={p.zeitraumBis}>
                {`${formatDatum(p.zeitraumVon, sprache)} – ${formatDatum(p.zeitraumBis, sprache)}`}
              </option>
            ))}
          </Auswahl>
          {darf("bearbeiter", fondsId, "finanzen") ? (
            <>
              <Auswahl label={t.buchhaltung.seite.spracheBericht} value={ausgabeSprache} onChange={(e) => setAusgabeSprache(e.target.value === "en" ? "en" : "de")}>
                <option value="de">Deutsch</option>
                <option value="en">English</option>
              </Auswahl>
              <ButtonLink href={auswertungDateiUrl(fondsId, sicht, bis, "pdf", ausgabeSprache)} download variante="sekundaer">
                {`${d.ausgabe}: ${d.pdf}`}
              </ButtonLink>
              <ButtonLink href={auswertungDateiUrl(fondsId, sicht, bis, "xlsx", ausgabeSprache)} download variante="sekundaer">
                {`${d.ausgabe}: ${d.excel}`}
              </ButtonLink>
            </>
          ) : null}
        </div>
      </section>
      <AuswertungTabelle key={`${sicht}-${bis}`} fondsId={fondsId} sicht={sicht} bis={bis} />
      {sicht === "portfolio" || sicht === "liquiditaet" ? <AbstimmungKarte fondsId={fondsId} bis={bis} sicht={sicht} /> : null}
    </>
  );
}

function AuswertungTabelle({ fondsId, sicht, bis }: { fondsId: string; sicht: (typeof SICHTEN)[number]; bis: string }) {
  const t = useT();
  const sprache = useSprache();
  const d = t.buchhaltung.auswertung;
  const { data } = useSuspenseQuery(auswertung(fondsId, sicht, bis));
  const [offen, setOffen] = useState<Set<string>>(new Set());
  const name = (z: { bezeichnungDe: string; bezeichnungEn: string }) => (sprache === "de" ? z.bezeichnungDe : z.bezeichnungEn);
  type Zeile = AuswertungDaten["zeilen"][number];
  const schalten = (k: string) => setOffen((alt) => { const n = new Set(alt); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const spalten: TabelleSpalte<Zeile>[] = [
    { schluessel: "position", kopf: d.position, zelle: (z) => <span style={{ paddingInlineStart: `${z.ebene * 16}px`, fontWeight: z.blatt ? undefined : 600 }}>{name(z)}</span> },
    { schluessel: "betrag", kopf: d.betrag, zahl: true, zelle: (z) => formatBetragCent(z.wert, sprache) },
    {
      schluessel: "herkunft",
      kopf: d.herkunft,
      zelle: (z) =>
        z.konten.length === 0 ? null : (
          <Button variante="sekundaer" aria-expanded={offen.has(z.schluessel)} aria-label={offen.has(z.schluessel) ? d.herkunftSchliessen(name(z)) : d.herkunftOeffnen(name(z))} onClick={() => schalten(z.schluessel)}>
            {d.herkunft}
          </Button>
        ),
    },
  ];
  const offene = data.zeilen.filter((z) => offen.has(z.schluessel));
  return (
    <>
      <section className="app-karte" aria-label={d.zeilen}>
        <p className="app-leer-text">{d.quelleListe(data.lauf.dateiname, data.lauf.uebernommenAm ? formatZeitpunkt(data.lauf.uebernommenAm, sprache) : "")}</p>
        <Tabelle beschriftung={`${aufzaehlung(t.buchhaltung.sichten, sicht)}: ${d.zeilen}`} spalten={spalten} zeilen={data.zeilen} zeilenSchluessel={(z) => z.schluessel} />
        {data.mehrdeutig.length > 0 ? <Hinweis>{data.mehrdeutig.length}</Hinweis> : null}
      </section>
      {offene.map((z) => (
        <section key={z.schluessel} className="app-karte">
          <h3 className="app-gruppen-titel">{`${d.herkunft}: ${name(z)}`}</h3>
          <p className="app-leer-text">{d.saldoHinweis}</p>
          <Tabelle
            beschriftung={`${d.herkunft}: ${name(z)}`}
            spalten={[
              { schluessel: "konto", kopf: d.konto, zelle: (k: Zeile["konten"][number]) => k.konto },
              { schluessel: "bez", kopf: d.bezeichnung, zelle: (k) => k.bezeichnung ?? "" },
              { schluessel: "saldo", kopf: d.saldo, zahl: true, zelle: (k) => formatBetragCent(k.saldo, sprache) },
              { schluessel: "beitrag", kopf: d.beitrag, zahl: true, zelle: (k) => formatBetragCent(k.beitrag, sprache) },
            ]}
            zeilen={z.konten}
            zeilenSchluessel={(k) => k.konto}
          />
        </section>
      ))}
      {data.nichtZugeordnet.length > 0 ? (
        <section className="app-karte">
          <Hinweis variante="fehler" titel={d.nichtZugeordnet}>
            {d.nichtZugeordnetHinweis(data.nichtZugeordnet.length)}
          </Hinweis>
          <Tabelle
            beschriftung={d.nichtZugeordnet}
            spalten={[
              { schluessel: "konto", kopf: d.konto, zelle: (k: (typeof data.nichtZugeordnet)[number]) => k.konto },
              { schluessel: "bez", kopf: d.bezeichnung, zelle: (k) => k.bezeichnung ?? "" },
              { schluessel: "saldo", kopf: d.saldo, zahl: true, zelle: (k) => formatBetragCent(k.saldo, sprache) },
            ]}
            zeilen={data.nichtZugeordnet}
            zeilenSchluessel={(k) => k.konto}
          />
        </section>
      ) : null}
    </>
  );
}

function AbstimmungKarte({ fondsId, bis, sicht }: { fondsId: string; bis: string; sicht: "portfolio" | "liquiditaet" }) {
  const t = useT();
  const sprache = useSprache();
  const d = t.buchhaltung.auswertung;
  const { data } = useSuspenseQuery(abstimmung(fondsId, bis));
  type Z = { schluessel: string; bezeichnung: string; carraway: string; buchhaltung: string; differenz: string; schritte: { zeichen: string; bezeichnung: string; wert: string }[] };
  const zeilen: Z[] = sicht === "portfolio" ? [...(data.portfolio.gesamt ? [data.portfolio.gesamt] : []), ...data.portfolio.zeilen] : data.liquiditaet ? [data.liquiditaet] : [];
  const spalten: TabelleSpalte<Z>[] = [
    { schluessel: "pos", kopf: d.position, zelle: (z) => z.bezeichnung },
    { schluessel: "f", kopf: d.carraway, zahl: true, zelle: (z) => formatBetragCent(z.carraway, sprache) },
    { schluessel: "b", kopf: d.buchhaltung, zahl: true, zelle: (z) => formatBetragCent(z.buchhaltung, sprache) },
    {
      schluessel: "d",
      kopf: d.differenz,
      zahl: true,
      zelle: (z) => (
        <span>
          {formatBetragCent(z.differenz, sprache)} <Status variante={Number(z.differenz) === 0 ? "freigegeben" : "fehlt"}>{Number(z.differenz) === 0 ? d.keineDifferenz : d.mitDifferenz}</Status>
        </span>
      ),
    },
  ];
  const ohneKonto = sicht === "portfolio" ? data.portfolio.ohneKonto : [];
  return (
    <section className="app-karte" aria-label={d.abstimmung}>
      <h2 className="cw-t-untertitel app-karte__titel">{sicht === "portfolio" ? d.abstimmungPortfolio : d.abstimmungLiquiditaet}</h2>
      {sicht === "liquiditaet" ? <p className="app-leer-text">{d.liquiditaetHinweis}</p> : null}
      <Tabelle beschriftung={`${d.abstimmung}: ${d.position}`} spalten={spalten} zeilen={zeilen} zeilenSchluessel={(z) => z.schluessel} />
      {ohneKonto.length > 0 ? (
        <>
          <h3 className="app-gruppen-titel">{d.ohneKonto}</h3>
          <ul className="app-liste">
            {ohneKonto.map((b) => (
              <li key={b.beteiligungId}>{`${b.bezeichnung}: ${formatBetragCent(b.buchwert, sprache)}`}</li>
            ))}
          </ul>
        </>
      ) : null}
      {zeilen[0] ? (
        <>
          <h3 className="app-gruppen-titel">{d.rechenweg}</h3>
          <ul className="app-liste">
            {zeilen[0].schritte.map((s, i) => (
              <li key={i}>{`${s.zeichen} ${s.bezeichnung}: ${formatBetragCent(s.wert, sprache)}`}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

// Buchungsexport -----------------------------------------------------------------------------------------------------------

interface VorschauZeile {
  vorgangId: string | null;
  fondsBewegungId: string | null;
  organisation: string;
  art: string;
  valuta: string;
  betrag: string;
  konto: string;
  gegenkonto: string;
  richtung: string;
  belegfeld: string;
  buchungstext: string;
}

function Buchungsexport({ fondsId }: { fondsId: string }) {
  const t = useT();
  const sprache = useSprache();
  const d = t.buchhaltung.export;
  const { darf } = useRechte();
  const { data: laeufe } = useSuspenseQuery(zinslaufListe(fondsId));
  const { data: exporte } = useSuspenseQuery(buchungsexporte(fondsId));
  const { data: bewegungen } = useSuspenseQuery(fondsBewegungen(fondsId));
  const gebucht = laeufe.filter((l) => l.status === "gebucht");
  const [quelle, setQuelle] = useState<"zinslauf" | "bewegungen" | "auswahl">("zinslauf");
  const [stand, setStand] = useState<Auswahlstand>({});
  const [bewegungIds, setBewegungIds] = useState<string[]>([]);
  const [lauf, setLauf] = useState("");
  const [wiederholung, setWiederholung] = useState(false);
  const [grund, setGrund] = useState("");
  const vorschau = useExportVorschau(fondsId);
  const erstellen = useExportErstellen(fondsId);
  const gewaehlt = gebucht.some((l) => l.id === lauf) ? lauf : (gebucht[0]?.id ?? "");
  const gewaehlteIds = idsAus(stand);
  const auswahl =
    quelle === "zinslauf"
      ? { zinslaufId: gewaehlt, wiederholung }
      : quelle === "bewegungen"
        ? { fondsBewegungIds: bewegungIds, wiederholung }
        : { vorgangIds: gewaehlteIds.vorgangIds, fondsBewegungIds: gewaehlteIds.fondsBewegungIds, wiederholung };
  const nichtsGewaehlt = quelle === "zinslauf" ? !gewaehlt : quelle === "bewegungen" ? bewegungIds.length === 0 : Object.keys(stand).length === 0;
  const ergebnis = vorschau.data as unknown as { zeilen: VorschauZeile[]; probleme: { code: string }[]; ohneBeleg: string[] } | undefined;
  const fehlerProbleme = erstellen.error instanceof ApiFehler && Array.isArray(erstellen.error.zusatz.probleme) ? (erstellen.error.zusatz.probleme as { code: string }[]) : [];

  const spalten: TabelleSpalte<VorschauZeile>[] = [
    { schluessel: "org", kopf: d.spalten.organisation, zelle: (z) => z.organisation },
    { schluessel: "art", kopf: d.spalten.art, zelle: (z) => z.art },
    { schluessel: "valuta", kopf: d.spalten.valuta, zelle: (z) => formatDatum(z.valuta, sprache) },
    { schluessel: "betrag", kopf: d.spalten.betrag, zahl: true, zelle: (z) => formatBetragCent(z.betrag, sprache) },
    { schluessel: "konto", kopf: d.spalten.konto, zelle: (z) => z.konto },
    { schluessel: "gegen", kopf: d.spalten.gegenkonto, zelle: (z) => z.gegenkonto },
    { schluessel: "sh", kopf: d.spalten.seite, zelle: (z) => z.richtung },
    { schluessel: "beleg", kopf: d.spalten.belegfeld, zelle: (z) => z.belegfeld },
    { schluessel: "text", kopf: d.spalten.text, umbruch: true, zelle: (z) => z.buchungstext },
  ];

  return (
    <>
      <section className="app-karte" aria-label={d.titel}>
        <h2 className="cw-t-untertitel app-karte__titel">{d.titel}</h2>
        <p className="app-leer-text">{d.beschreibung}</p>
        <Hinweis>{d.hinweisPruefung}</Hinweis>
        {darf("bearbeiter", fondsId, "finanzen") ? (
          <div className="app-formular">
            <Auswahl label={d.quelle} value={quelle} onChange={(e) => setQuelle(e.target.value as "zinslauf" | "bewegungen" | "auswahl")}>
              <option value="zinslauf">{d.quellen.zinslauf}</option>
              <option value="bewegungen">{d.quellen.bewegungen}</option>
              <option value="auswahl">{d.quellen.auswahl}</option>
            </Auswahl>
            {quelle === "zinslauf" ? (
              gebucht.length === 0 ? (
                <p className="app-leer-text">{d.keineGebuchten}</p>
              ) : (
                <Auswahl label={d.zinslauf} value={gewaehlt} onChange={(e) => setLauf(e.target.value)}>
                  {gebucht.map((l) => (
                    <option key={l.id} value={l.id}>
                      {`${formatDatum(l.stichtag, sprache)} (${l.anzahlPositionen})`}
                    </option>
                  ))}
                </Auswahl>
              )
            ) : quelle === "auswahl" ? (
              <>
                <p className="app-leer-text">{d.auswahl.hinweis}</p>
                <BuchungsAuswahl fondsId={fondsId} stand={stand} onStand={setStand} />
              </>
            ) : bewegungen.length === 0 ? (
              <p className="app-leer-text">{d.keineBewegungen}</p>
            ) : (
              <fieldset className="app-kz-auswahl">
                <legend>{d.bewegungen}</legend>
                {bewegungen.map((b) => (
                  <label key={b.id} className="app-kz-schalter">
                    <input type="checkbox" checked={bewegungIds.includes(b.id)} onChange={(e) => setBewegungIds((alt) => (e.target.checked ? [...alt, b.id] : alt.filter((x) => x !== b.id)))} />
                    <span>{d.bewegung(aufzaehlung(d.bewegungArt, b.art), formatDatum(b.valuta, sprache), formatBetragCent(b.betrag, sprache), b.istStorno ? d.storno : b.storniert ? d.storniert : null)}</span>
                  </label>
                ))}
              </fieldset>
            )}
            <label className="app-kz-schalter">
              <input type="checkbox" checked={wiederholung} onChange={(e) => setWiederholung(e.target.checked)} />
              <span>
                {d.wiederholung} <span className="app-leer-text">{d.wiederholungHilfe}</span>
              </span>
            </label>
            {wiederholung ? <Feld label={d.grund} value={grund} onChange={(e) => setGrund(e.target.value)} fehler={feldText(t, erstellen.error, "grund")} /> : null}
            <FehlerHinweis fehler={vorschau.error ?? erstellen.error} bekannt={["grund"]} />
            {fehlerProbleme.length > 0 ? (
              <ul className="app-liste" aria-label={d.probleme}>
                {fehlerProbleme.map((p, i) => (
                  <li key={i}>{aufzaehlung(d.problemCodes, p.code)}</li>
                ))}
              </ul>
            ) : null}
            {erstellen.isSuccess ? <Hinweis>{d.erstellt}</Hinweis> : null}
            <div className="app-aktionen__knoepfe">
              <Button variante="sekundaer" disabled={vorschau.isPending || nichtsGewaehlt} onClick={() => vorschau.mutate(auswahl)}>
                {d.vorschau}
              </Button>
              <Button disabled={erstellen.isPending || nichtsGewaehlt || (wiederholung && grund.trim() === "")} onClick={() => erstellen.mutate({ ...auswahl, ...(wiederholung ? { grund: grund.trim() } : {}) }, { onSuccess: () => setStand({}) })}>
                {d.exportieren}
              </Button>
            </div>
          </div>
        ) : (
          <NurLesen fondsId={fondsId} bereich="finanzen" />
        )}
        {ergebnis ? (
          <>
            {ergebnis.ohneBeleg.length > 0 ? <Hinweis>{d.ohneBeleg(ergebnis.ohneBeleg.length)}</Hinweis> : null}
            {ergebnis.probleme.length > 0 ? (
              <Hinweis variante="fehler" titel={d.probleme}>
                {ergebnis.probleme.map((p) => aufzaehlung(d.problemCodes, p.code)).join(" ")}
              </Hinweis>
            ) : null}
            <Tabelle beschriftung={d.zeilen} spalten={spalten} zeilen={ergebnis.zeilen} zeilenSchluessel={(z) => z.vorgangId ?? z.fondsBewegungId ?? ""} />
          </>
        ) : null}
      </section>
      <section className="app-karte">
        <h2 className="cw-t-untertitel app-karte__titel">{d.liste}</h2>
        {exporte.length === 0 ? (
          <p className="app-leer-text">{d.keineExporte}</p>
        ) : (
          <Tabelle
            beschriftung={d.liste}
            spalten={[
              { schluessel: "zeit", kopf: d.exportSpalten.zeit, zelle: (x: (typeof exporte)[number]) => `${formatZeitpunkt(x.erzeugtAm, sprache)}${x.wiederholung ? ` (${d.wiederholt})` : ""}` },
              { schluessel: "zeitraum", kopf: d.exportSpalten.zeitraum, zelle: (x) => `${formatDatum(x.datumVon, sprache)} – ${formatDatum(x.datumBis, sprache)}` },
              { schluessel: "anzahl", kopf: d.exportSpalten.anzahl, zahl: true, zelle: (x) => String(x.anzahl) },
              { schluessel: "summe", kopf: d.exportSpalten.summe, zahl: true, zelle: (x) => formatBetragCent(x.summe, sprache) },
              { schluessel: "datei", kopf: d.exportSpalten.datei, zelle: (x) => x.dateiName },
              {
                schluessel: "aktion",
                kopf: d.exportSpalten.aktion,
                zelle: (x) =>
                  darf("bearbeiter", fondsId, "finanzen") ? (
                    <a href={exportDateiUrl(x.id)} download>
                      {d.herunterladen}
                    </a>
                  ) : null,
              },
            ]}
            zeilen={exporte}
            zeilenSchluessel={(x) => x.id}
          />
        )}
      </section>
    </>
  );
}

// Einstellungen ------------------------------------------------------------------------------------------------------------

/** Ein Unterbereich der Einstellungen; jeder steht als eigener Eintrag im Inhaltsverzeichnis. */
function Einstellungen({ fondsId, unter }: { fondsId: string; unter: EinstellungenUnter }) {
  const t = useT();
  const e = t.buchhaltung.einstellungen;
  const { darf } = useRechte();
  const aenderbar = darf("verwalter", fondsId, "finanzen");
  const inhalte: Record<EinstellungenUnter, () => React.ReactNode> = {
    konfiguration: () => (
      <>
        <KonfigKarte fondsId={fondsId} aenderbar={aenderbar} />
        <MittelartenKarte fondsId={fondsId} aenderbar={aenderbar} />
      </>
    ),
    konten: () => (
      <>
        <KontenKarte fondsId={fondsId} aenderbar={aenderbar} />
        {aenderbar ? <GliederungEditor fondsId={fondsId} /> : null}
        <GliederungKarte fondsId={fondsId} aenderbar={aenderbar} />
      </>
    ),
    regeln: () => <BuchungsregelnKarte fondsId={fondsId} aenderbar={aenderbar} />,
    vorlagen: () => <VorlagenKarte fondsId={fondsId} aenderbar={aenderbar} />,
  };
  return (
    <>
      {!aenderbar ? <Hinweis>{e.nurVerwalter}</Hinweis> : null}
      {inhalte[unter]()}
    </>
  );
}

function KonfigKarte({ fondsId, aenderbar }: { fondsId: string; aenderbar: boolean }) {
  const t = useT();
  const e = t.buchhaltung.einstellungen;
  const { data } = useSuspenseQuery(buchhaltungKonfig(fondsId));
  const setzen = useKonfigSetzen(fondsId);
  const { werte, feld, pruefeAlle } = useFormular({ berater: data.beraternummer?.toString() ?? "", mandant: data.mandantennummer?.toString() ?? "", wj: String(data.wirtschaftsjahrBeginn), laenge: String(data.sachkontenlaenge), praefix: data.belegpraefix },
    {
      berater: ganzzahlRegel({ min: 1001, max: 9_999_999, stellen: 7 }),
      mandant: ganzzahlRegel({ min: 1, max: 99_999, stellen: 5 }),
      wj: ganzzahlRegel({ min: 1, max: 12, stellen: 2, pflicht: true }),
      laenge: ganzzahlRegel({ min: 4, max: 8, stellen: 1, pflicht: true }),
    },
  );
  const zahl = (w: string) => (w.trim() === "" ? null : Number(w));
  return (
    <section className="app-karte" aria-label={e.konfiguration}>
      <h3 className="app-gruppen-titel">{e.konfiguration}</h3>
      <form
        className="app-formular"
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!pruefeAlle()) return;
          setzen.mutate({ beraternummer: zahl(werte.berater), mandantennummer: zahl(werte.mandant), wirtschaftsjahrBeginn: Number(werte.wj), sachkontenlaenge: Number(werte.laenge), belegpraefix: werte.praefix });
        }}
      >
        <FehlerHinweis fehler={setzen.error} />
        <Feld label={e.beraternummer} inputMode="numeric" disabled={!aenderbar} {...feld("berater", feldText(t, setzen.error, "beraternummer"))} />
        <Feld label={e.mandantennummer} inputMode="numeric" disabled={!aenderbar} {...feld("mandant", feldText(t, setzen.error, "mandantennummer"))} />
        <Feld label={e.wirtschaftsjahr} inputMode="numeric" disabled={!aenderbar} {...feld("wj", feldText(t, setzen.error, "wirtschaftsjahrBeginn"))} />
        <Feld label={e.sachkontenlaenge} inputMode="numeric" disabled={!aenderbar} {...feld("laenge", feldText(t, setzen.error, "sachkontenlaenge"))} />
        <Feld label={e.belegpraefix} disabled={!aenderbar} {...feld("praefix")} />
        {setzen.isSuccess ? <Hinweis>{e.gespeichert}</Hinweis> : null}
        {aenderbar ? (
          <div>
            <Button type="submit" disabled={setzen.isPending}>
              {e.speichern}
            </Button>
          </div>
        ) : null}
      </form>
    </section>
  );
}

interface MittelZeile {
  schluessel: string;
  bezeichnungDe: string;
  bezeichnungEn: string;
  quote: string;
  meldeArt: string;
}

/** Quote als Anteil (`0.600000`) in Prozent für das Feld und zurück, nur durch Stellenverschiebung im Text. */
const anteilAlsProzent = (a: string) => {
  const n = Number(a) * 100;
  return Number.isFinite(n) ? String(Math.round(n * 1e4) / 1e4) : "";
};
const prozentAlsAnteil = (p: string) => (Number(p.replace(",", ".")) / 100).toFixed(6);

function MittelartenKarte({ fondsId, aenderbar }: { fondsId: string; aenderbar: boolean }) {
  const t = useT();
  const e = t.buchhaltung.einstellungen;
  const { data } = useSuspenseQuery(mittelarten(fondsId));
  const setzen = useMittelartenSetzen(fondsId);
  const aktuelle = data.filter((m) => m.gueltigBis === null);
  const [zeilen, setZeilen] = useState<MittelZeile[]>(() => (aktuelle.length ? aktuelle.map((m) => ({ schluessel: m.schluessel, bezeichnungDe: m.bezeichnungDe, bezeichnungEn: m.bezeichnungEn, quote: anteilAlsProzent(m.quote), meldeArt: m.meldeArt ?? "" })) : [{ schluessel: "", bezeichnungDe: "", bezeichnungEn: "", quote: "100", meldeArt: "" }]));
  const sprache = useSprache();
  const { werte: abWerte, feld: abFeld, pruefeAlle: abPruefen } = useFormular({ ab: "" }, { ab: datumRegel({ pflicht: true }) });
  const ab = abWerte.ab;
  // Die Quoten stehen in dynamischen Zeilen (kein `useFormular`): sie werden beim Absenden und bei nicht behebbaren Fehlern gemeldet.
  const [versucht, setVersucht] = useState(false);
  const quotePruefung = (quote: string) => prozentRegel({ pflicht: true })(quote, {}, { sprache });
  const aendern = (i: number, k: keyof MittelZeile, w: string) => setZeilen((alt) => alt.map((z, j) => (j === i ? { ...z, [k]: w } : z)));
  return (
    <section className="app-karte" aria-label={e.mittelarten}>
      <h3 className="app-gruppen-titel">{e.mittelarten}</h3>
      <p className="app-leer-text">{e.mittelartenHilfe}</p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          setVersucht(true);
          const datumOk = abPruefen();
          if (!datumOk || zeilen.some((z) => quotePruefung(z.quote) !== undefined)) return;
          setzen.mutate({ gueltigAb: ab, mittelarten: zeilen.map((z) => ({ schluessel: z.schluessel, bezeichnungDe: z.bezeichnungDe, bezeichnungEn: z.bezeichnungEn, quote: prozentAlsAnteil(z.quote), meldeArt: z.meldeArt === "" ? null : (z.meldeArt as MeldeArt) })) });
        }}
      >
        <FehlerHinweis fehler={setzen.error} bekannt={["gueltigAb"]} />
        {zeilen.map((z, i) => (
          <fieldset key={i} className="app-kz-auswahl" disabled={!aenderbar}>
            <legend>{`${e.mittelarten} ${i + 1}`}</legend>
            <Feld label={e.schluessel} value={z.schluessel} onChange={(ev) => aendern(i, "schluessel", ev.target.value)} />
            <Feld label={e.bezeichnungDe} value={z.bezeichnungDe} onChange={(ev) => aendern(i, "bezeichnungDe", ev.target.value)} />
            <Feld label={e.bezeichnungEn} value={z.bezeichnungEn} onChange={(ev) => aendern(i, "bezeichnungEn", ev.target.value)} />
            <BetragFeld
              label={e.quote}
              value={z.quote}
              onChange={(ev) => aendern(i, "quote", ev.target.value)}
              fehler={(() => {
                const p = quotePruefung(z.quote);
                return p && (versucht || p.sofort) ? pruefungText(sprache, p) : undefined;
              })()}
            />
            <Auswahl label={e.meldeArt} value={z.meldeArt} onChange={(ev) => aendern(i, "meldeArt", ev.target.value)}>
              <option value="">{e.ohneMeldeart}</option>
              {MELDE_ARTEN.map((a) => (
                <option key={a} value={a}>
                  {t.melde.mittelart[a] ?? a}
                </option>
              ))}
            </Auswahl>
          </fieldset>
        ))}
        {aenderbar ? (
          <>
            <Feld label={e.gueltigAb} type="date" {...abFeld("ab", feldText(t, setzen.error, "gueltigAb"))} />
            <div className="app-aktionen__knoepfe">
              <Button type="button" variante="sekundaer" onClick={() => setZeilen((alt) => [...alt, { schluessel: "", bezeichnungDe: "", bezeichnungEn: "", quote: "0", meldeArt: "" }])}>
                {e.zeileHinzu}
              </Button>
              <Button type="submit" disabled={setzen.isPending}>
                {e.speichern}
              </Button>
            </div>
          </>
        ) : null}
        {setzen.isSuccess ? <Hinweis>{e.gespeichert}</Hinweis> : null}
      </form>
    </section>
  );
}

function GliederungKarte({ fondsId, aenderbar }: { fondsId: string; aenderbar: boolean }) {
  const t = useT();
  const sprache = useSprache();
  const e = t.buchhaltung.einstellungen;
  const { data: positionen } = useSuspenseQuery(gliederung(fondsId));
  const { data: regeln } = useSuspenseQuery(kontenregeln(fondsId));
  const standard = useStandardgliederung(fondsId);
  const anlegen = useRegelAnlegen(fondsId);
  const [sicht, setSicht] = useState<(typeof SICHTEN)[number]>("bilanz");
  const { werte, feld, pruefeAlle } = useFormular(
    { von: "", bis: "", position: "", ab: "" },
    { von: pflichtRegel(), position: pflichtRegel(), ab: datumRegel({ pflicht: true }) },
  );
  const blaetter = positionen.filter((p) => p.sicht === sicht && !positionen.some((q) => q.sicht === sicht && q.elternSchluessel === p.schluessel));
  const name = (schluessel: string, s: string) => {
    const p = positionen.find((x) => x.sicht === s && x.schluessel === schluessel);
    return p ? (sprache === "de" ? p.bezeichnungDe : p.bezeichnungEn) : schluessel;
  };
  return (
    <section className="app-karte" aria-label={e.gliederung}>
      <h3 className="app-gruppen-titel">{e.gliederung}</h3>
      {aenderbar ? (
        <div>
          <p className="app-leer-text">{e.standardHilfe}</p>
          <Button variante="sekundaer" disabled={standard.isPending} onClick={() => standard.mutate()}>
            {e.standardAnlegen}
          </Button>
          {standard.data ? <Hinweis>{e.standardAngelegt(standard.data.neuePositionen)}</Hinweis> : null}
          <FehlerHinweis fehler={standard.error} />
        </div>
      ) : null}
      <h3 className="app-gruppen-titel">{e.regeln}</h3>
      {regeln.length === 0 ? (
        <p className="app-leer-text">{e.keineRegeln}</p>
      ) : (
        <Tabelle
          beschriftung={e.regeln}
          spalten={[
            { schluessel: "sicht", kopf: e.regelSpalten.sicht, zelle: (r: (typeof regeln)[number]) => aufzaehlung(t.buchhaltung.sichten, r.sicht) },
            { schluessel: "konten", kopf: e.regelSpalten.konten, zelle: (r) => (r.kontoVon === r.kontoBis ? r.kontoVon : `${r.kontoVon} – ${r.kontoBis}`) },
            { schluessel: "pos", kopf: e.regelSpalten.position, zelle: (r) => name(r.positionSchluessel, r.sicht) },
            { schluessel: "gueltig", kopf: e.regelSpalten.gueltig, zelle: (r) => `${formatDatum(r.gueltigAb, sprache)} ${e.bis} ${r.gueltigBis ? formatDatum(r.gueltigBis, sprache) : e.unbegrenzt}` },
          ]}
          zeilen={regeln}
          zeilenSchluessel={(r) => r.id}
        />
      )}
      {aenderbar ? (
        <form
          className="app-formular"
          noValidate
          onSubmit={(ev) => {
            ev.preventDefault();
            if (!pruefeAlle()) return;
            anlegen.mutate({ sicht, kontoVon: werte.von, ...(werte.bis ? { kontoBis: werte.bis } : {}), positionSchluessel: werte.position, gueltigAb: werte.ab });
          }}
        >
          <h3 className="app-gruppen-titel">{e.regelNeu}</h3>
          <FehlerHinweis fehler={anlegen.error} bekannt={["kontoVon", "kontoBis", "positionSchluessel", "gueltigAb"]} />
          <Auswahl label={t.buchhaltung.auswertung.sicht} value={sicht} onChange={(ev) => setSicht(ev.target.value as (typeof SICHTEN)[number])}>
            {SICHTEN.map((s) => (
              <option key={s} value={s}>
                {aufzaehlung(t.buchhaltung.sichten, s)}
              </option>
            ))}
          </Auswahl>
          <Feld label={e.kontoVon} {...feld("von", feldText(t, anlegen.error, "kontoVon"))} />
          <Feld label={e.kontoBis} {...feld("bis")} fehler={feldText(t, anlegen.error, "kontoBis")} />
          <Auswahl label={e.position} {...feld("position", feldText(t, anlegen.error, "positionSchluessel"))}>
            <option value="" />
            {blaetter.map((p) => (
              <option key={p.id} value={p.schluessel}>
                {sprache === "de" ? p.bezeichnungDe : p.bezeichnungEn}
              </option>
            ))}
          </Auswahl>
          <Feld label={e.gueltigAb} type="date" {...feld("ab", feldText(t, anlegen.error, "gueltigAb"))} />
          <div>
            <Button type="submit" disabled={anlegen.isPending}>
              {e.regelNeu}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
