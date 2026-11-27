import { useEffect, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Button, ButtonLink, Fakten, Hinweis, Karte, KartenRaster, Markdown, Schrittfolge, Seitenpanel, Seitenkopf, Status, Tabelle, Textbereich, formatDatum, type Sprache, type TabelleSpalte } from "@carraway/ui";
import { fondsListe } from "../api/abfragen";
import { belegDateiUrl, belegDetail, useBelegFeldwerte, useBelegNeuBefuellen, useBelegStornieren, useBelegStufe, type BelegDetail } from "../api/buchhaltung";
import { BelegFeldwert, type BelegFeld } from "../komponenten/BelegFeldwert";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { feldText } from "../i18n/fehler";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { useNamen } from "../lib/namen";
import { useRechte } from "../lib/rechte";
import { formatBetragCent, formatSatz } from "../lib/zahl";
import { formatZeitpunkt } from "../lib/zeit";
import { merkeFonds } from "../zustand";
import { BELEG_STATUS } from "./Belege";

const route = getRouteApi("/vouchers/$id");

type Protokoll = BelegDetail["protokoll"][number];

const BETRAEGE = new Set(["betrag", "zusage", "ausgezahlt_gesamt", "offene_zusage", "summe_kapitalisiert", "kaufpreis", "kosten", "treuhand_betrag", "verkaeuferdarlehen_betrag", "buchwert_abgang", "erloes", "ergebnis", "barzufluss", "wandlungsbetrag", "nominal", "agio", "spitzenbetrag", "zinsen_gebucht", "zeichnungskapital", "summe_bis_datum"]);
const DATEN = new Set(["belegdatum", "erstinvestment", "faellig_am", "stichtag", "cutoff"]);
const ANTEILE = new Set(["zinssatz", "anteil_verkauft"]);

/** Wert eines Feldes für die Anzeige, nach der Art des Feldes in der Sprache der Oberfläche. */
function feldWert(feld: BelegFeld, wert: string, sprache: Sprache, waehrung: string): string {
  if (feld.manuell === "betrag" || BETRAEGE.has(feld.schluessel)) return formatBetragCent(wert, sprache, waehrung);
  if (feld.manuell === "datum" || DATEN.has(feld.schluessel)) return formatDatum(wert, sprache);
  if (ANTEILE.has(feld.schluessel)) return formatSatz(wert, sprache);
  return wert;
}

/** Gültige Stufen nach Wiedergabe des Protokolls: ein `ok` fügt hinzu, ein `zurueck` nimmt die zuletzt erteilte zurück (wie in der API). */
function aktiveStufen(protokoll: Protokoll[]): Protokoll[] {
  const aktiv: Protokoll[] = [];
  for (const p of protokoll) {
    if (p.ergebnis === "ok") aktiv.push(p);
    else aktiv.pop();
  }
  return aktiv;
}

/** Beleg: Angaben, fehlende Pflichtfelder, Mittelherkunft, zwei Stufen, Datei und Protokoll. Die API entscheidet über jede Stufe. */
export function BelegSeite() {
  const { id } = route.useParams();
  return <BelegInhalt key={id} id={id} />;
}

function BelegInhalt({ id }: { id: string }) {
  const t = useT();
  const sprache = useSprache();
  const d = t.buchhaltung.beleg;
  const { data: b } = useSuspenseQuery(belegDetail(id));
  const { data: fonds } = useSuspenseQuery(fondsListe());
  const { ich, darf } = useRechte();
  const person = useNamen([b.erstelltVon, ...(b.stornoVon ? [b.stornoVon] : []), ...b.protokoll.map((p) => p.akteur)]);
  const stufe = useBelegStufe(id);
  const feldwerte = useBelegFeldwerte(id);
  const [eingabe, setEingabe] = useState<Record<string, string>>({});
  const neu = useBelegNeuBefuellen(id);
  const stornieren = useBelegStornieren(id);
  const [stornoGrund, setStornoGrund] = useState("");
  const [stornoOffen, setStornoOffen] = useState(false);
  const [kommentar, setKommentar] = useState("");
  const [lokal, setLokal] = useState<string | null>(null);
  useEffect(() => merkeFonds(b.fondsId), [b.fondsId]);

  const belegFonds = fonds.find((f) => f.id === b.fondsId);
  const fondsName = belegFonds?.name ?? "";
  const waehrung = belegFonds?.waehrung ?? "EUR";
  const daten = b.daten as { werte: Record<string, string | null>; mittelherkunft: { schluessel: string; bezeichnungDe: string; bezeichnungEn: string; quote: string; betrag: string }[]; datum: string; betrag: string | null };
  const vorlage = b.vorlage as { felder: BelegFeld[] };
  const eingeben = b.status === "entwurf" && darf("bearbeiter", b.fondsId, "finanzen");
  const befunde = b.befunde as { feld: string; code: string }[];
  const aktiv = aktiveStufen(b.protokoll);
  const storniert = b.status === "storniert";
  /** Freigegeben (auch später storniert): Nummer und unveränderliche Datei liegen vor, die Stufen sind abgeschlossen. */
  const freigegeben = b.status === "freigegeben" || storniert;
  const art = (sprache === "de" ? b.artNameDe : b.artNameEn) ?? aufzaehlung(t.buchhaltung.belegArt, b.art);
  const feldName = (f: { schluessel: string; bezeichnungDe?: string; bezeichnungEn?: string }) => (sprache === "de" ? f.bezeichnungDe : f.bezeichnungEn) ?? aufzaehlung(t.buchhaltung.felder, f.schluessel);

  const sperrgrund = !ich
    ? null
    : !darf("freigeber", b.fondsId, "finanzen")
      ? d.sperreRolle
      : ich.id === b.erstelltVon
        ? d.sperreUrheber
        : aktiv.some((a) => a.akteur === ich.id)
          ? d.sperreSchonErteilt
          : befunde.length > 0
            ? d.sperreBefunde
            : null;

  function ausfuehren(ergebnis: "ok" | "zurueck") {
    setLokal(null);
    if (ergebnis === "zurueck" && kommentar.trim() === "") {
      setLokal(d.kommentarPflicht);
      return;
    }
    if (!b.naechsteStufeName) return;
    stufe.mutate({ stufe: b.naechsteStufeName, ergebnis, ...(kommentar.trim() ? { kommentar: kommentar.trim() } : {}) }, { onSuccess: () => setKommentar("") });
  }

  const schritte = [
    ...b.stufen.map((name, i) => {
      const erteilt = aktiv[i];
      return {
        id: `s${i}`,
        label: (
          <span className="app-stufe">
            <span>{name}</span>
            <span className="app-stufe__zeit">{erteilt ? d.erteilt(person(erteilt.akteur) ?? "", formatZeitpunkt(erteilt.am, sprache)) : d.ausstehend}</span>
          </span>
        ),
      };
    }),
    { id: "fertig", label: <span className="app-stufe">{d.freigegebenLabel}</span> },
  ];

  const protokollSpalten: TabelleSpalte<Protokoll>[] = [
    { schluessel: "stufe", kopf: d.protokollSpalten.stufe, zelle: (p) => p.stufe },
    { schluessel: "ergebnis", kopf: d.protokollSpalten.ergebnis, zelle: (p) => aufzaehlung(d.ergebnis, p.ergebnis) },
    { schluessel: "person", kopf: d.protokollSpalten.person, zelle: (p) => person(p.akteur) ?? "" },
    { schluessel: "zeit", kopf: d.protokollSpalten.zeitpunkt, zelle: (p) => formatZeitpunkt(p.am, sprache) },
    { schluessel: "kommentar", kopf: d.protokollSpalten.kommentar, umbruch: true, zelle: (p) => (p.kommentar ? <Markdown text={p.kommentar} /> : "") },
  ];

  return (
    <div className="app-seite">
      <Seitenkopf
        meta={
          <>
            <Link to="/vouchers" search={{ fondsId: b.fondsId }}>
              {d.zurListe}
            </Link>
            {fondsName ? ` · ${fondsName}` : ""}
            <Status variante={BELEG_STATUS[b.status] ?? "entwurf"}>{aufzaehlung(t.buchhaltung.belegStatus, b.status)}</Status>
          </>
        }
        titel={`${art} ${b.belegnummer ?? ""}`.trim()}
        aktionen={
          <>
            {!freigegeben && darf("bearbeiter", b.fondsId, "finanzen") ? (
              <Button variante="sekundaer" groesse="s" disabled={neu.isPending} onClick={() => neu.mutate(undefined, { onSuccess: () => setEingabe({}) })}>
                {d.neuBefuellen}
              </Button>
            ) : null}
            <ButtonLink href={belegDateiUrl(b.id)} download variante="sekundaer" groesse="s">
              {freigegeben ? d.datei : d.dateiEntwurf}
            </ButtonLink>
          </>
        }
      />

      <section className="app-instrument" aria-label={art}>
        <Fakten
          darstellung="reihe"
          eintraege={[
            { label: d.nummer, wert: <span className="app-zahl">{b.belegnummer ?? t.buchhaltung.belege.ohneNummer}</span> },
            { label: d.datum, wert: <span className="app-zahl">{formatDatum(daten.datum, sprache)}</span> },
            { label: d.betrag, wert: <span className="app-zahl">{daten.betrag ? formatBetragCent(daten.betrag, sprache, waehrung) : t.gemeinsam.keinWert}</span> },
            { label: d.sprache, wert: b.sprache === "en" ? "English" : "Deutsch" },
          ]}
        />
        {befunde.length > 0 ? (
          <Hinweis variante="fehler" titel={d.befundeTitel}>
            {d.befundeText(befunde.map((x) => feldName(vorlage.felder.find((f) => f.schluessel === x.feld) ?? { schluessel: x.feld })).join(", "))}
          </Hinweis>
        ) : null}
        <KartenRaster>
          <Karte titel={d.angaben} breit={daten.mittelherkunft.length === 0}>
            <Tabelle
              dicht
              beschriftung={d.angaben}
              spalten={[
                { schluessel: "feld", kopf: d.feld, zelle: (f: (typeof vorlage.felder)[number]) => `${feldName(f)}${f.pflicht ? " *" : ""}` },
                {
                  schluessel: "wert",
                  kopf: d.wert,
                  zelle: (f) => {
                    const wert = daten.werte[f.schluessel];
                    if (eingeben && f.manuell) return <BelegFeldwert feld={f} wert={eingabe[f.schluessel] ?? wert ?? ""} onChange={(neu) => setEingabe((alt) => ({ ...alt, [f.schluessel]: neu }))} />;
                    return wert === null || wert === undefined || wert === "" ? d.angabeFehlt : feldWert(f, wert, sprache, waehrung);
                  },
                },
              ]}
              zeilen={vorlage.felder}
              zeilenSchluessel={(f) => f.schluessel}
            />
            {eingeben && vorlage.felder.some((f) => f.manuell) ? (
              <div>
                <Button disabled={feldwerte.isPending || !Object.keys(eingabe).length} onClick={() => feldwerte.mutate(eingabe, { onSuccess: () => setEingabe({}) })}>{t.buchhaltung.einstellungen.eigeneArt.werteSpeichern}</Button>
                <FehlerHinweis fehler={feldwerte.error} />
              </div>
            ) : null}
          </Karte>
          {daten.mittelherkunft.length > 0 ? (
            <Karte titel={d.mittelherkunft}>
              <Tabelle
                dicht
                beschriftung={d.mittelherkunft}
                spalten={[
                  { schluessel: "art", kopf: d.mittelart, zelle: (m: (typeof daten.mittelherkunft)[number]) => (sprache === "de" ? m.bezeichnungDe : m.bezeichnungEn) },
                  { schluessel: "quote", kopf: d.quote, zahl: true, zelle: (m) => formatSatz(m.quote, sprache) },
                  { schluessel: "betrag", kopf: d.mittelBetrag, zahl: true, zelle: (m) => formatBetragCent(m.betrag, sprache, waehrung) },
                ]}
                zeilen={daten.mittelherkunft}
                zeilenSchluessel={(m) => m.schluessel}
              />
            </Karte>
          ) : null}
        </KartenRaster>
        {!freigegeben ? <p className="app-leer-text">{d.dateiHinweis}</p> : null}
        {!freigegeben && darf("bearbeiter", b.fondsId, "finanzen") ? <p className="app-leer-text">{d.neuBefuellenHilfe}</p> : null}
        <FehlerHinweis fehler={neu.error} />
        {freigegeben && b.dateiSha256 ? (
          <p className="app-leer-text">
            {d.hash}: <code className="app-hash">{b.dateiSha256}</code>
          </p>
        ) : null}
      </section>

      <section className="app-karte" aria-labelledby="beleg-stufen-titel">
        <h2 id="beleg-stufen-titel" className="cw-t-untertitel app-karte__titel">
          {d.stufenTitel}
        </h2>
        <Schrittfolge aria-label={d.stufenBeschriftung} aktuell={freigegeben ? "fertig" : `s${aktiv.length}`} schritte={schritte} />
        {storniert && b.belegnummer ? (
          <Hinweis variante="fehler" titel={d.storniertTitel}>
            {d.storniertText(b.belegnummer, person(b.stornoVon ?? "") ?? "", b.stornoAm ? formatZeitpunkt(b.stornoAm, sprache) : "", b.stornoGrund ?? "")}
          </Hinweis>
        ) : null}
        {b.status === "freigegeben" && b.belegnummer ? <Hinweis>{d.freigegeben(b.belegnummer)}</Hinweis> : null}
        {!freigegeben ? (
          <div className="app-formular" role="group" aria-label={d.stufenTitel}>
            <p className="app-leer-text">{d.regel}</p>
            <Textbereich markdown label={d.kommentar} hilfe={d.kommentarHilfe} rows={3} value={kommentar} onChange={(e) => setKommentar(e.target.value)} fehler={lokal ?? feldText(t, stufe.error, "kommentar")} />
            <FehlerHinweis fehler={stufe.error} bekannt={["kommentar", "stufe", "ergebnis"]} />
            <div className="app-aktionen__knoepfe">
              <Button disabled={stufe.isPending || sperrgrund !== null} aria-describedby={sperrgrund ? "beleg-sperrgrund" : undefined} onClick={() => ausfuehren("ok")}>
                {d.erteilen(b.naechsteStufeName ?? "")}
              </Button>
              <Button variante="sekundaer" disabled={stufe.isPending || sperrgrund !== null} aria-describedby={sperrgrund ? "beleg-sperrgrund" : undefined} onClick={() => ausfuehren("zurueck")}>
                {d.zurueck}
              </Button>
            </div>
            {sperrgrund ? (
              <p id="beleg-sperrgrund" className="app-leer-text">
                {sperrgrund}
              </p>
            ) : null}
          </div>
        ) : null}
        {b.status === "freigegeben" && darf("freigeber", b.fondsId, "finanzen") ? (
          <div>
            <Button variante="sekundaer" onClick={() => setStornoOffen(true)}>
              {d.stornoOeffnen}
            </Button>
          </div>
        ) : null}
        {stornoOffen ? (
          <Seitenpanel titel={d.stornoTitel} onSchliessen={() => setStornoOffen(false)}>
            <h2 className="cw-t-untertitel">{d.stornoTitel}</h2>
            <form
              className="app-formular"
              noValidate
              aria-label={d.stornoTitel}
              onSubmit={(e) => {
                e.preventDefault();
                stornieren.mutate(
                  { grund: stornoGrund.trim() },
                  {
                    onSuccess: () => {
                      setStornoGrund("");
                      setStornoOffen(false);
                    },
                  },
                );
              }}
            >
              <p className="app-leer-text">{d.stornoHilfe}</p>
              <Textbereich label={d.stornoGrund} rows={3} value={stornoGrund} onChange={(e) => setStornoGrund(e.target.value)} fehler={feldText(t, stornieren.error, "grund")} />
              <FehlerHinweis fehler={stornieren.error} bekannt={["grund"]} />
              <div className="app-aktionen__knoepfe">
                <Button type="submit" disabled={stornieren.isPending || stornoGrund.trim() === ""}>
                  {d.stornoKnopf}
                </Button>
                <Button type="button" variante="sekundaer" onClick={() => setStornoOffen(false)}>
                  {t.buchhaltung.erzeugen.abbrechen}
                </Button>
              </div>
            </form>
          </Seitenpanel>
        ) : null}
        {b.protokoll.length > 0 ? <Tabelle beschriftung={d.protokoll} spalten={protokollSpalten} zeilen={b.protokoll} zeilenSchluessel={(p) => p.id} /> : null}
      </section>
    </div>
  );
}
