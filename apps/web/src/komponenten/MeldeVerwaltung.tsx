import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Feld, Hinweis, Tabelle, Textbereich, formatDatum, type TabelleSpalte } from "@carraway/ui";
import { ApiFehler } from "../api/client";
import { heuteIso } from "../api/datum";
import {
  foerderprogramme,
  meldeDefinitionen,
  meldeVersion,
  meldeVersionen,
  pruefeDefinitionRemote,
  useDefinitionAnlegen,
  useDefinitionVersion,
  useProgrammAnlegen,
  type DefinitionsFehler,
  type DefinitionsKopf,
  type Foerderprogramm,
  type MeldeDefinition,
} from "../api/meldewesen";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { useRechte } from "../lib/rechte";
import { Seitenpanel } from "@carraway/ui";
import { DateiDropzone } from "./DateiDropzone";
import { FehlerHinweis } from "./FehlerHinweis";

/**
 * Verwaltung: Meldedefinitionen (nur globale Verwalter ändern sie) und Förderprogramme. Eine Version lässt sich lesen (JSON mit Aufbau);
 * der Editor nimmt JSON entgegen (Text oder Datei), prüft es mit der API und zeigt jeden Fehler mit Pfad und Meldung.
 */
export function MeldewesenBereich() {
  const t = useT();
  const sprache = useSprache();
  const v = t.melde.verwaltung;
  const { ich } = useRechte();
  const { data, error } = useQuery(meldeDefinitionen());
  const [ansicht, setAnsicht] = useState<MeldeDefinition | null>(null);
  const [editor, setEditor] = useState<{ version?: MeldeDefinition } | null>(null);
  const kannAendern = ich?.globalVerwalter === true;
  const name = (d: MeldeDefinition) => (sprache === "de" ? d.bezeichnungDe : d.bezeichnungEn);

  const spalten: TabelleSpalte<MeldeDefinition>[] = [
    { schluessel: "schluessel", kopf: v.spalten.schluessel, zelle: (d) => <code>{d.schluessel}</code> },
    {
      schluessel: "bezeichnung",
      kopf: v.spalten.bezeichnung,
      zelle: (d) => (
        <>
          {name(d)}
          {d.hinweis ? <span className="app-leer-text"> · {t.melde.vorlage}</span> : null}
        </>
      ),
    },
    { schluessel: "rhythmus", kopf: v.spalten.rhythmus, zelle: (d) => aufzaehlung(t.melde.rhythmus, d.rhythmus) },
    { schluessel: "format", kopf: v.spalten.format, zelle: (d) => aufzaehlung(t.melde.format, d.format) },
    { schluessel: "version", kopf: v.spalten.version, zahl: true, zelle: (d) => d.version },
    { schluessel: "gueltig", kopf: v.spalten.gueltig, zelle: (d) => v.gueltig(formatDatum(d.gueltigAb, sprache), d.gueltigBis ? formatDatum(d.gueltigBis, sprache) : null) },
    {
      schluessel: "aktion",
      kopf: v.spalten.aktion,
      zelle: (d) => (
        <span className="app-zusammenhang">
          <Button variante="sekundaer" aria-label={v.oeffnenFuer(name(d))} onClick={() => setAnsicht(d)}>
            {v.oeffnen}
          </Button>
          {kannAendern ? (
            <Button variante="sekundaer" aria-label={v.neueVersionFuer(name(d))} onClick={() => setEditor({ version: d })}>
              {v.neueVersion}
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <>
      <section className="app-karte">
      <div className="app-karte__kopf">
        <h2 className="cw-t-untertitel app-karte__titel">{v.titel}</h2>
        {kannAendern ? <Button onClick={() => setEditor({})}>{v.neu}</Button> : null}
      </div>
      <p className="app-leer-text">{v.einleitung}</p>
      {error ? <FehlerHinweis fehler={error} /> : null}
      {data ? <Tabelle beschriftung={v.beschriftung} spalten={spalten} zeilen={data} zeilenSchluessel={(d) => d.schluessel} /> : null}
      </section>
      <ProgrammeBereich kannAendern={kannAendern} />
      {ansicht ? <VersionAnsicht definition={ansicht} onSchliessen={() => setAnsicht(null)} /> : null}
      {editor ? <Editor {...(editor.version ? { version: editor.version } : {})} onSchliessen={() => setEditor(null)} /> : null}
    </>
  );
}

function VersionAnsicht({ definition, onSchliessen }: { definition: MeldeDefinition; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const a = t.melde.verwaltung.version;
  const { data: versionen } = useQuery(meldeVersionen(definition.schluessel));
  const [gewaehlt, setGewaehlt] = useState(definition.version);
  const { data, error } = useQuery(meldeVersion(definition.schluessel, gewaehlt));
  const name = sprache === "de" ? definition.bezeichnungDe : definition.bezeichnungEn;
  return (
    <Seitenpanel titel={a.titel(name, gewaehlt)} onSchliessen={onSchliessen} breit>
      <h2 className="cw-t-untertitel">{a.titel(name, gewaehlt)}</h2>
      <Auswahl label={a.versionen} value={String(gewaehlt)} onChange={(e) => setGewaehlt(Number(e.target.value))}>
        {(versionen ?? [{ version: definition.version, gueltigAb: definition.gueltigAb, gueltigBis: definition.gueltigBis }]).map((x) => (
          <option key={x.version} value={x.version}>
            {`${x.version} (${t.melde.verwaltung.gueltig(formatDatum(x.gueltigAb, sprache), x.gueltigBis ? formatDatum(x.gueltigBis, sprache) : null)})`}
          </option>
        ))}
      </Auswahl>
      {error ? <FehlerHinweis fehler={error} /> : null}
      {data ? (
        <>
          {data.definition.hinweis ? <Hinweis>{data.definition.hinweis[sprache]}</Hinweis> : null}
          <h3 className="cw-t-label">{a.struktur}</h3>
          <ul>
            {data.vorschau.map((x) => (
              <li key={x.id}>
                {a.abschnitt(x.titel[sprache], aufzaehlung(a.typ, x.typ), x.anzahl)}
                <ul>
                  {x.felder.map((f) => (
                    <li key={f.id}>
                      {f.bezeichnung[sprache]} <span className="app-leer-text">({a.quelle}: {f.quelle}, {a.format}: {f.format})</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <h3 className="cw-t-label">{a.json}</h3>
          <pre className="app-code" tabIndex={0} aria-label={a.json}>
            {JSON.stringify(data.definition, null, 2)}
          </pre>
        </>
      ) : null}
      <Button variante="sekundaer" onClick={onSchliessen}>
        {a.schliessen}
      </Button>
    </Seitenpanel>
  );
}

const RHYTHMEN = ["quartal", "halbjahr", "jahr", "stichtag"] as const;
const FORMATE = ["xlsx", "csv", "pdf", "xml"] as const;

/** Fehler der Definition als Liste: übersetzt nach Code und Parametern, sonst die Meldung der API. */
export function DefinitionsFehlerListe({ fehler }: { fehler: DefinitionsFehler[] }) {
  const t = useT();
  const e = t.melde.verwaltung.editor;
  if (fehler.length === 0) return null;
  const text = (f: DefinitionsFehler) => {
    const uebersetzer = e.codes[f.code];
    const p = f.params ?? {};
    const erster = Object.values(p)[0];
    return uebersetzer ? uebersetzer(erster === undefined ? "" : String(erster)) : f.meldung;
  };
  return (
    <Hinweis variante="fehler" titel={e.fehlerTitel(fehler.length)}>
      <ul>
        {fehler.map((f, i) => (
          <li key={i}>{e.fehlerZeile(f.pfad, text(f))}</li>
        ))}
      </ul>
    </Hinweis>
  );
}

function Editor({ version, onSchliessen }: { version?: MeldeDefinition; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const e = t.melde.verwaltung.editor;
  const neu = useDefinitionAnlegen();
  const neueVersion = useDefinitionVersion();
  const [werte, setWerte] = useState({
    schluessel: version?.schluessel ?? "",
    bezeichnungDe: version?.bezeichnungDe ?? "",
    bezeichnungEn: version?.bezeichnungEn ?? "",
    herausgeber: version?.herausgeber ?? "",
    rhythmus: (version?.rhythmus ?? "quartal") as DefinitionsKopf["rhythmus"],
    format: (version?.format ?? "xlsx") as DefinitionsKopf["format"],
    gueltigAb: heuteIso(),
  });
  const [json, setJson] = useState("");
  const [dateiname, setDateiname] = useState("");
  const [meldung, setMeldung] = useState<{ art: "ok" | "kaputt" } | null>(null);
  const [probleme, setProbleme] = useState<DefinitionsFehler[]>([]);
  const setze = <K extends keyof typeof werte>(k: K, w: (typeof werte)[K]) => setWerte((alt) => ({ ...alt, [k]: w }));
  const speichernFehler = version ? neueVersion.error : neu.error;
  const apiProbleme = speichernFehler instanceof ApiFehler && Array.isArray(speichernFehler.zusatz.definitionsfehler) ? (speichernFehler.zusatz.definitionsfehler as DefinitionsFehler[]) : [];

  function lies(): unknown | undefined {
    try {
      return JSON.parse(json);
    } catch {
      setMeldung({ art: "kaputt" });
      setProbleme([]);
      return undefined;
    }
  }

  async function pruefen() {
    const definition = lies();
    if (definition === undefined) return;
    const r = await pruefeDefinitionRemote(definition);
    setProbleme(r.fehler);
    setMeldung(r.ok ? { art: "ok" } : null);
  }

  function speichern() {
    const definition = lies();
    if (definition === undefined) return;
    const kopf: DefinitionsKopf = { bezeichnungDe: werte.bezeichnungDe, bezeichnungEn: werte.bezeichnungEn, herausgeber: werte.herausgeber, rhythmus: werte.rhythmus, format: werte.format, gueltigAb: werte.gueltigAb, definition };
    if (version) neueVersion.mutate({ schluessel: version.schluessel, json: kopf }, { onSuccess: onSchliessen });
    else neu.mutate({ ...kopf, schluessel: werte.schluessel }, { onSuccess: onSchliessen });
  }

  async function datei(f: File | undefined) {
    if (!f) return;
    setJson(await f.text());
    setDateiname(f.name);
    setMeldung(null);
    setProbleme([]);
  }

  const titel = version ? e.titelVersion(sprache === "de" ? version.bezeichnungDe : version.bezeichnungEn) : e.titelNeu;
  return (
    <Seitenpanel titel={titel} onSchliessen={onSchliessen} breit>
      <h2 className="cw-t-untertitel">{titel}</h2>
      <form
        className="app-formular"
        onSubmit={(ev) => {
          ev.preventDefault();
          speichern();
        }}
      >
        {version ? null : <Feld label={e.schluessel} value={werte.schluessel} onChange={(x) => setze("schluessel", x.target.value)} required pattern="[a-z][a-z0-9_]{1,59}" />}
        <Feld label={e.bezeichnungDe} value={werte.bezeichnungDe} onChange={(x) => setze("bezeichnungDe", x.target.value)} required />
        <Feld label={e.bezeichnungEn} value={werte.bezeichnungEn} onChange={(x) => setze("bezeichnungEn", x.target.value)} required />
        <Feld label={e.herausgeber} value={werte.herausgeber} onChange={(x) => setze("herausgeber", x.target.value)} required />
        <Auswahl label={e.rhythmus} value={werte.rhythmus} onChange={(x) => setze("rhythmus", x.target.value as DefinitionsKopf["rhythmus"])}>
          {RHYTHMEN.map((r) => (
            <option key={r} value={r}>
              {aufzaehlung(t.melde.rhythmus, r)}
            </option>
          ))}
        </Auswahl>
        <Auswahl label={e.format} value={werte.format} onChange={(x) => setze("format", x.target.value as DefinitionsKopf["format"])}>
          {FORMATE.map((r) => (
            <option key={r} value={r}>
              {aufzaehlung(t.melde.format, r)}
            </option>
          ))}
        </Auswahl>
        <Feld label={e.gueltigAb} type="date" value={werte.gueltigAb} onChange={(x) => setze("gueltigAb", x.target.value)} required />
        <DateiDropzone
          label={e.datei}
          accept="application/json,.json"
          dateiname={dateiname}
          deaktiviert={neu.isPending || neueVersion.isPending}
          onDateien={([dateiAuswahl]) => void datei(dateiAuswahl)}
        />
        <Textbereich label={e.json} rows={12} value={json} onChange={(x) => (setJson(x.target.value), setMeldung(null))} spellCheck={false} required />
        {meldung?.art === "kaputt" ? <Hinweis variante="fehler">{e.jsonKaputt}</Hinweis> : null}
        {meldung?.art === "ok" ? <Hinweis>{e.gueltig}</Hinweis> : null}
        <DefinitionsFehlerListe fehler={probleme.length ? probleme : apiProbleme} />
        {speichernFehler && apiProbleme.length === 0 ? <FehlerHinweis fehler={speichernFehler} /> : null}
        <div className="app-knoepfe">
          <Button type="button" variante="sekundaer" onClick={() => void pruefen()}>
            {e.pruefen}
          </Button>
          <Button type="submit" disabled={neu.isPending || neueVersion.isPending}>
            {e.speichern}
          </Button>
          <Button type="button" variante="ruhig" onClick={onSchliessen}>
            {e.abbrechen}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

function ProgrammeBereich({ kannAendern }: { kannAendern: boolean }) {
  const t = useT();
  const p = t.melde.verwaltung.programme;
  const { data, error } = useQuery(foerderprogramme());
  const anlegen = useProgrammAnlegen();
  const [offen, setOffen] = useState(false);
  const [schluessel, setSchluessel] = useState("");
  const [bezeichnung, setBezeichnung] = useState("");
  const spalten: TabelleSpalte<Foerderprogramm>[] = [
    { schluessel: "schluessel", kopf: p.spalten.schluessel, zelle: (x) => <code>{x.schluessel}</code> },
    { schluessel: "bezeichnung", kopf: p.spalten.bezeichnung, zelle: (x) => x.bezeichnung },
  ];
  return (
    <section className="app-karte">
      <div className="app-karte__kopf">
        <h2 className="cw-t-untertitel app-karte__titel">{p.titel}</h2>
        {kannAendern ? <Button onClick={() => setOffen(true)}>{p.neu}</Button> : null}
      </div>
      <p className="app-leer-text">{p.einleitung}</p>
      {error ? <FehlerHinweis fehler={error} /> : null}
      {data && data.length > 0 ? <Tabelle beschriftung={p.beschriftung} spalten={spalten} zeilen={data} zeilenSchluessel={(x) => x.id} /> : <p className="app-leer-text">{p.keine}</p>}
      {offen ? (
        <Seitenpanel titel={p.neu} onSchliessen={() => setOffen(false)}>
          <h2 className="cw-t-untertitel">{p.neu}</h2>
          <form
            className="app-formular"
            onSubmit={(ev) => {
              ev.preventDefault();
              anlegen.mutate({ schluessel, bezeichnung }, { onSuccess: () => setOffen(false) });
            }}
          >
            <Feld label={p.schluessel} value={schluessel} onChange={(x) => setSchluessel(x.target.value)} required pattern="[a-z][a-z0-9_]{1,59}" />
            <Feld label={p.bezeichnung} value={bezeichnung} onChange={(x) => setBezeichnung(x.target.value)} required />
            {anlegen.error ? <FehlerHinweis fehler={anlegen.error} /> : null}
            <Button type="submit" disabled={anlegen.isPending}>
              {p.speichern}
            </Button>
          </form>
        </Seitenpanel>
      ) : null}
    </section>
  );
}
