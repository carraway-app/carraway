import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Feld, Tabelle, formatDatum, type TabelleSpalte } from "@carraway/ui";
import { fondsListe } from "../api/abfragen";
import { heuteIso } from "../api/datum";
import { kennzahlKatalog, useAusserKraft, useDefinitionAnlegen, useVersionAnlegen, type KatalogEintrag } from "../api/kennzahlen";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { kennzahlName } from "../lib/kennzahlen";
import { useRechte } from "../lib/rechte";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "./FehlerHinweis";
import { KennzahlAuswahl } from "./KennzahlAuswahl";

const TYPEN = ["betrag", "zahl", "prozent", "ja_nein", "text"] as const;
const KATEGORIEN = ["finanzen", "betrieb", "esg_umwelt", "esg_sozial", "esg_governance"] as const;
const PERIODIZITAETEN = ["monat", "quartal", "jahr"] as const;
const AGGREGATIONEN = ["summe", "stand", "durchschnitt"] as const;

/**
 * Verwaltung: Kennzahlenkatalog (nur globale Verwalter ändern ihn) und die Auswahl je Fonds. Jede Änderung ist eine neue Version;
 * ältere Versionen bleiben sichtbar (`alle`), Werte behalten ihre Definition.
 */
export function KennzahlenBereich() {
  const t = useT();
  const sprache = useSprache();
  const c = t.kennzahlen.katalog;
  const { ich } = useRechte();
  const [alle, setAlle] = useState(false);
  const { data: katalog, error } = useQuery(kennzahlKatalog(alle));
  const { data: fondsliste } = useQuery(fondsListe());
  const [dialog, setDialog] = useState<{ version?: KatalogEintrag } | null>(null);
  const ausserKraft = useAusserKraft();
  const [fondsId, setFondsId] = useState("");
  const gewaehlterFonds = fondsId || fondsliste?.[0]?.id || "";
  const kannAendern = ich?.globalVerwalter === true;

  const spalten: TabelleSpalte<KatalogEintrag>[] = [
    { schluessel: "schluessel", kopf: c.spalten.schluessel, zelle: (d) => <code>{d.schluessel}</code> },
    { schluessel: "bezeichnung", kopf: c.spalten.bezeichnung, zelle: (d) => kennzahlName(d, sprache) },
    { schluessel: "kategorie", kopf: c.spalten.kategorie, zelle: (d) => aufzaehlung(t.kennzahlen.kategorie, d.kategorie) },
    { schluessel: "einheit", kopf: c.spalten.einheit, zelle: (d) => d.einheit || t.gemeinsam.keinWert },
    { schluessel: "typ", kopf: c.spalten.typ, zelle: (d) => aufzaehlung(t.kennzahlen.typ, d.typ) },
    { schluessel: "periodizitaet", kopf: c.spalten.periodizitaet, zelle: (d) => aufzaehlung(t.kennzahlen.periodizitaet, d.periodizitaet) },
    { schluessel: "aggregation", kopf: c.spalten.aggregation, zelle: (d) => aufzaehlung(t.kennzahlen.aggregation, d.aggregation) },
    { schluessel: "pflicht", kopf: c.spalten.pflicht, zelle: (d) => (d.pflicht ? c.ja : c.nein) },
    { schluessel: "version", kopf: c.spalten.version, zahl: true, zelle: (d) => d.katalogVersion },
    { schluessel: "gueltig", kopf: c.spalten.gueltig, zelle: (d) => c.gueltig(formatDatum(d.gueltigAb, sprache), d.gueltigBis ? formatDatum(d.gueltigBis, sprache) : null) },
    ...(kannAendern
      ? [
          {
            schluessel: "aktion",
            kopf: c.spalten.aktion,
            zelle: (d: KatalogEintrag) => {
              const neueste = !(katalog ?? []).some((x) => x.schluessel === d.schluessel && x.katalogVersion > d.katalogVersion);
              if (!neueste) return t.gemeinsam.keinWert;
              return (
                <span className="app-zusammenhang">
                  <Button variante="sekundaer" aria-label={c.neueVersionFuer(kennzahlName(d, sprache))} onClick={() => setDialog({ version: d })}>
                    {c.neueVersion}
                  </Button>
                  {d.gueltigBis === null ? (
                    <Button variante="ruhig" aria-label={c.ausserKraftFuer(kennzahlName(d, sprache))} disabled={ausserKraft.isPending} onClick={() => ausserKraft.mutate(d.schluessel)}>
                      {c.ausserKraft}
                    </Button>
                  ) : null}
                </span>
              );
            },
          } satisfies TabelleSpalte<KatalogEintrag>,
        ]
      : []),
  ];

  return (
    <>
      <section className="app-karte">
      <div className="app-karte__kopf">
        <h2 className="cw-t-untertitel app-karte__titel">{c.titel}</h2>
        <div className="app-verlauf__steuerung">
          <label className="app-kz-schalter">
            <input type="checkbox" checked={alle} onChange={(e) => setAlle(e.target.checked)} /> {c.alleVersionen}
          </label>
          {kannAendern ? <Button onClick={() => setDialog({})}>{c.neu}</Button> : null}
        </div>
      </div>
      <p className="app-leer-text">{c.einleitung}</p>
      {error ? <FehlerHinweis fehler={error} /> : null}
      {ausserKraft.error ? <FehlerHinweis fehler={ausserKraft.error} /> : null}
      {katalog ? <Tabelle beschriftung={c.beschriftung} spalten={spalten} zeilen={katalog} zeilenSchluessel={(d) => d.id} /> : null}
      </section>

      <section className="app-karte">
        {fondsliste && fondsliste.length > 0 ? (
          <>
            <Auswahl label={c.auswahlFonds} value={gewaehlterFonds} onChange={(e) => setFondsId(e.target.value)}>
              {fondsliste.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Auswahl>
            <KennzahlAuswahl fondsId={gewaehlterFonds} kannAendern />
          </>
        ) : (
          <p className="app-leer-text">{c.keinFonds}</p>
        )}
      </section>

      {dialog ? <DefinitionDialog {...(dialog.version ? { version: dialog.version } : {})} onSchliessen={() => setDialog(null)} /> : null}
    </>
  );
}

function DefinitionDialog({ version, onSchliessen }: { version?: KatalogEintrag; onSchliessen: () => void }) {
  const t = useT();
  const c = t.kennzahlen.katalog;
  const f = c.felder;
  const neu = useDefinitionAnlegen();
  const neueVersion = useVersionAnlegen();
  const [werte, setWerte] = useState({
    schluessel: version?.schluessel ?? "",
    bezeichnungDe: version?.bezeichnungDe ?? "",
    bezeichnungEn: version?.bezeichnungEn ?? "",
    einheit: version?.einheit ?? "",
    typ: version?.typ ?? "betrag",
    kategorie: version?.kategorie ?? "finanzen",
    periodizitaet: version?.periodizitaet ?? "quartal",
    aggregation: version?.aggregation ?? "stand",
    pflicht: version?.pflicht ?? false,
    gueltigAb: heuteIso(),
  });
  const setze = <K extends keyof typeof werte>(k: K, v: (typeof werte)[K]) => setWerte((alt) => ({ ...alt, [k]: v }));
  const fehler = version ? neueVersion.error : neu.error;
  const titel = version ? c.dialogVersion(version.bezeichnungDe) : c.dialogNeu;

  function senden() {
    if (version) {
      neueVersion.mutate(
        { schluessel: version.schluessel, json: { bezeichnungDe: werte.bezeichnungDe, bezeichnungEn: werte.bezeichnungEn, einheit: werte.einheit, periodizitaet: werte.periodizitaet, aggregation: werte.aggregation, pflicht: werte.pflicht, gueltigAb: werte.gueltigAb } },
        { onSuccess: onSchliessen },
      );
    } else {
      neu.mutate({ ...werte, gueltigAb: werte.gueltigAb }, { onSuccess: onSchliessen });
    }
  }

  return (
    <Seitenpanel titel={titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{titel}</h2>
      {version ? <p className="app-leer-text">{c.versionHinweis}</p> : null}
      <form
        className="app-formular"
        onSubmit={(e) => {
          e.preventDefault();
          senden();
        }}
      >
        {version ? null : <Feld label={f.schluessel} value={werte.schluessel} onChange={(e) => setze("schluessel", e.target.value)} hilfe={c.schluesselHilfe} required pattern="[a-z][a-z0-9_]{1,59}" />}
        <Feld label={f.bezeichnungDe} value={werte.bezeichnungDe} onChange={(e) => setze("bezeichnungDe", e.target.value)} required />
        <Feld label={f.bezeichnungEn} value={werte.bezeichnungEn} onChange={(e) => setze("bezeichnungEn", e.target.value)} required />
        <Feld label={f.einheit} value={werte.einheit} onChange={(e) => setze("einheit", e.target.value)} />
        {version ? null : (
          <>
            <Auswahl label={f.typ} value={werte.typ} onChange={(e) => setze("typ", e.target.value as (typeof TYPEN)[number])}>
              {TYPEN.map((x) => (
                <option key={x} value={x}>
                  {aufzaehlung(t.kennzahlen.typ, x)}
                </option>
              ))}
            </Auswahl>
            <Auswahl label={f.kategorie} value={werte.kategorie} onChange={(e) => setze("kategorie", e.target.value as (typeof KATEGORIEN)[number])}>
              {KATEGORIEN.map((x) => (
                <option key={x} value={x}>
                  {aufzaehlung(t.kennzahlen.kategorie, x)}
                </option>
              ))}
            </Auswahl>
          </>
        )}
        <Auswahl label={f.periodizitaet} value={werte.periodizitaet} onChange={(e) => setze("periodizitaet", e.target.value as (typeof PERIODIZITAETEN)[number])}>
          {PERIODIZITAETEN.map((x) => (
            <option key={x} value={x}>
              {aufzaehlung(t.kennzahlen.periodizitaet, x)}
            </option>
          ))}
        </Auswahl>
        <Auswahl label={f.aggregation} value={werte.aggregation} onChange={(e) => setze("aggregation", e.target.value as (typeof AGGREGATIONEN)[number])}>
          {AGGREGATIONEN.map((x) => (
            <option key={x} value={x}>
              {aufzaehlung(t.kennzahlen.aggregation, x)}
            </option>
          ))}
        </Auswahl>
        <label className="app-kz-schalter">
          <input type="checkbox" checked={werte.pflicht} onChange={(e) => setze("pflicht", e.target.checked)} /> {f.pflicht}
        </label>
        <Feld label={f.gueltigAb} type="date" value={werte.gueltigAb} onChange={(e) => setze("gueltigAb", e.target.value)} required />
        {fehler ? <FehlerHinweis fehler={fehler} /> : null}
        <Button type="submit" disabled={neu.isPending || neueVersion.isPending}>
          {t.kennzahlen.speichern}
        </Button>
      </form>
    </Seitenpanel>
  );
}
