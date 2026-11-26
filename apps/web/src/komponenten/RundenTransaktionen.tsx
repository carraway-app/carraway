import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Auswahl, Button, Seitenpanel, Status, Tabelle, formatDatum, type TabelleSpalte } from "@carraway/ui";
import type { RundenTransaktion, Rundentransaktionen } from "../api/abfragen";
import { useVorgangRundeAendern } from "../api/mutationen";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { artRang } from "../lib/instrumente";
import { useRechte } from "../lib/rechte";
import { formatAnzahl, formatBetragCent } from "../lib/zahl";
import { FehlerHinweis } from "./FehlerHinweis";

type RundeKurz = Rundentransaktionen["runden"][number];
/** Eine Zeile der Tabelle; `runde` ist die Runde der Zuordnung (`null` ohne Runde), wird in der Liste „Alle“ als Spalte gezeigt. */
export interface TransaktionsZeile extends RundenTransaktion {
  runde: Pick<RundeKurz, "id" | "bezeichnung" | "art"> | null;
}

/** Alle Transaktionen der Gruppen in zeitlicher Reihenfolge (aufsteigend nach Valuta, am selben Tag Zusage vor Auszahlung vor Zins vor Tilgung …, danach nach Erfassung und Id), je mit ihrer Runde. */
export function alleTransaktionen(daten: Rundentransaktionen): TransaktionsZeile[] {
  const zeilen: TransaktionsZeile[] = [...daten.runden.flatMap((r) => r.transaktionen.map((z) => ({ ...z, runde: { id: r.id, bezeichnung: r.bezeichnung, art: r.art } }))), ...daten.ohneRunde.map((z) => ({ ...z, runde: null }))];
  return zeilen.sort((a, b) => a.valuta.localeCompare(b.valuta) || artRang(a.art) - artRang(b.art) || (a.erfasstAm ?? "").localeCompare(b.erfasstAm ?? "") || a.id.localeCompare(b.id));
}

/**
 * Karte „Transaktionen“ einer Runde, der Vorgänge ohne Runde oder (mit `mitRunde`) aller Vorgänge des Unternehmens: Datum, Fonds, Instrument, Art, Tranche, Betrag,
 * Anteile und „Runde ändern“ für Personen, die am Fonds des Vorgangs buchen dürfen. Stornierte Vorgänge sind durchgestrichen und tragen die Marke „Storniert“.
 */
export function TransaktionenKarte({
  zeilen,
  runden,
  beschriftung,
  beschreibung,
  leer,
  mitRunde = false,
  lesend,
}: {
  zeilen: TransaktionsZeile[];
  /** Alle Runden des Unternehmens (Auswahl in „Runde ändern“). */
  runden: RundeKurz[];
  beschriftung: string;
  beschreibung: string;
  leer: string;
  mitRunde?: boolean;
  lesend: boolean;
}) {
  const t = useT();
  const sprache = useSprache();
  const f = t.finanzierungsrunden.transaktionen;
  const { darf } = useRechte();
  const [aendern, setAendern] = useState<TransaktionsZeile | null>(null);
  const durchgestrichen = (z: TransaktionsZeile, inhalt: ReactNode) => (z.storniert ? <span className="app-storniert">{inhalt}</span> : inhalt);
  const artName = (z: TransaktionsZeile) => aufzaehlung(t.vorgangArt, z.art);

  const spalten: TabelleSpalte<TransaktionsZeile>[] = [
    { schluessel: "datum", kopf: f.spalten.datum, zelle: (z) => durchgestrichen(z, formatDatum(z.valuta, sprache)) },
    { schluessel: "fonds", kopf: f.spalten.fonds, zelle: (z) => durchgestrichen(z, z.fonds.name) },
    {
      schluessel: "instrument",
      kopf: f.spalten.instrument,
      zelle: (z) =>
        durchgestrichen(
          z,
          <Link to="/beteiligungen/$id" params={{ id: z.beteiligungId }} search={{ tab: "finanzierung", unter: "instrumente" }} aria-label={f.zumInstrument(z.instrument.bezeichnung)}>
            {z.instrument.bezeichnung}
          </Link>,
        ),
    },
    {
      schluessel: "art",
      kopf: f.spalten.art,
      zelle: (z) => (
        <span className="app-zusammenhang">
          {durchgestrichen(z, artName(z))}
          {z.storniert ? <Status variante="fehlt">{f.storniert}</Status> : null}
        </span>
      ),
    },
    { schluessel: "tranche", kopf: f.spalten.tranche, zelle: (z) => durchgestrichen(z, z.tranche ? (z.tranche.nummer !== null ? `${z.tranche.nummer}. ${z.tranche.bezeichnung}` : z.tranche.bezeichnung) : t.gemeinsam.keinWert) },
    { schluessel: "betrag", kopf: f.spalten.betrag, zahl: true, zelle: (z) => durchgestrichen(z, formatBetragCent(z.betrag, sprache)) },
    { schluessel: "anteile", kopf: f.spalten.anteile, zahl: true, zelle: (z) => durchgestrichen(z, z.anteile === null ? t.gemeinsam.keinWert : formatAnzahl(z.anteile, sprache)) },
    ...(mitRunde
      ? [
          {
            schluessel: "runde",
            kopf: f.spalten.runde,
            zelle: (z: TransaktionsZeile) =>
              z.runde ? (
                <span className="app-zusammenhang">
                  {z.runde.bezeichnung}
                  {z.runde.art === "bruecke" ? <Status>{t.finanzierungsrunden.bruecke}</Status> : null}
                </span>
              ) : (
                f.keineRunde
              ),
          } satisfies TabelleSpalte<TransaktionsZeile>,
        ]
      : []),
    ...(lesend
      ? []
      : [
          {
            schluessel: "aktion",
            kopf: f.spalten.aktion,
            zelle: (z: TransaktionsZeile) =>
              darf("bearbeiter", z.fonds.id, "portfolio") ? (
                <Button variante="sekundaer" aria-label={f.aendernFuer(artName(z), formatDatum(z.valuta, sprache))} onClick={() => setAendern(z)}>
                  {f.aendern}
                </Button>
              ) : null,
          } satisfies TabelleSpalte<TransaktionsZeile>,
        ]),
  ];

  return (
    <section className="app-karte app-transaktionen" aria-label={f.titel}>
      <header className="app-transaktionen__kopf">
        <h3 className="cw-t-untertitel">{f.titel}</h3>
        <p className="app-leer-text">{beschreibung}</p>
      </header>
      {zeilen.length === 0 ? <p className="app-leer-text">{leer}</p> : <Tabelle dicht beschriftung={f.tabelle(beschriftung)} spalten={spalten} zeilen={zeilen} zeilenSchluessel={(z) => z.id} />}
      {aendern ? <RundeAendernDialog zeile={aendern} runden={runden} onSchliessen={() => setAendern(null)} /> : null}
    </section>
  );
}

/** „Runde ändern“ eines Vorgangs: alle Runden des Unternehmens und „Keiner Runde zuordnen“; der Vorgang selbst bleibt unverändert. */
function RundeAendernDialog({ zeile, runden, onSchliessen }: { zeile: TransaktionsZeile; runden: RundeKurz[]; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const d = t.finanzierungsrunden.transaktionen.dialog;
  const aendern = useVorgangRundeAendern();
  const [wahl, setWahl] = useState(zeile.runde?.id ?? "");
  const geaendert = wahl !== (zeile.runde?.id ?? "");
  return (
    <Seitenpanel titel={d.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{d.titel}</h2>
      <p className="app-leer-text">{d.beschreibung(aufzaehlung(t.vorgangArt, zeile.art), formatDatum(zeile.valuta, sprache), formatBetragCent(zeile.betrag, sprache))}</p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          aendern.mutate({ id: zeile.id, rundeId: wahl === "" ? null : wahl }, { onSuccess: onSchliessen });
        }}
      >
        <FehlerHinweis fehler={aendern.error} />
        <Auswahl label={d.runde} name="rundeId" value={wahl} onChange={(e) => setWahl(e.target.value)}>
          <option value="">{d.keineRunde}</option>
          {runden.map((r) => (
            <option key={r.id} value={r.id}>
              {d.option(r.bezeichnung, formatDatum(r.datum, sprache), r.art === "bruecke")}
            </option>
          ))}
        </Auswahl>
        <div>
          <Button type="submit" disabled={aendern.isPending || !geaendert}>
            {d.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
