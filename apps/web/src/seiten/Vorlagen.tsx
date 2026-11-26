import { KeinFonds } from "./Platzhalter";
import { useEffect, useRef, useState } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Auswahl, Button, Feld, Hinweis, Segment, Seitenkopf, SortierbareListe, Status } from "@carraway/ui";
import { berichtsvorlagen, fondsListe, freigabestufen, type Vorlage } from "../api/abfragen";
import { kennzahlAuswahl } from "../api/kennzahlen";
import { zusatzDefinitionen } from "../api/zusatzfelder";
import { useStufenSetzen, useVorlageSetzen } from "../api/mutationen";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { NurLesen } from "../komponenten/NurLesen";
import { Skelettzeilen } from "../komponenten/Skelett";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { kennzahlName } from "../lib/kennzahlen";
import { anlegbareArten, type Berichtsart } from "../lib/berichte";
import { wirksamerFonds } from "../lib/fonds";
import { useRechte } from "../lib/rechte";
import { merkeFonds } from "../zustand";

const route = getRouteApi("/berichte/vorlagen");

/** Die wählbaren Listen und die gespeicherte Konfiguration kommen aus der API (`erlaubt`); die Oberfläche führt keine eigene Abschrift. */
type Erlaubt = Vorlage["erlaubt"];
type Einheit = Erlaubt["einheiten"][number];
interface Konfiguration {
  einheit: Einheit;
  abschnitte: string[];
  kennzahlen: string[];
  spalten: string[];
  /** Nur Quartalsbericht: Schlüssel der Unternehmenskennzahlen; leer = Auswahl des Fonds (Pflege über die API). */
  unternehmenskennzahlen: string[];
  /** IDs eigener Felder, die als weitere Spalten erscheinen (Fondsbericht, LP-Bericht, Portfolioliste, Exitliste). */
  zusatzfelder: string[];
}

/** Liest die gespeicherte Konfiguration der API; Einträge, die die API nicht (mehr) erlaubt, fallen weg. */
function alsKonfiguration(roh: Vorlage["konfiguration"], erlaubt: Erlaubt): Konfiguration {
  const nurErlaubte = (liste: readonly string[] | undefined, moeglich: readonly string[]) => (liste ?? []).filter((x) => moeglich.includes(x));
  return {
    einheit: erlaubt.einheiten.includes(roh.einheit) ? roh.einheit : "EUR",
    abschnitte: nurErlaubte(roh.abschnitte, erlaubt.abschnitte),
    kennzahlen: nurErlaubte(roh.kennzahlen, erlaubt.kennzahlen),
    spalten: nurErlaubte(roh.spalten, erlaubt.spalten),
    unternehmenskennzahlen: [...(roh.unternehmenskennzahlen ?? [])],
    zusatzfelder: [...(roh.zusatzfelder ?? [])],
  };
}

/** Die Standardkonfiguration der API: alle erlaubten Einträge in der üblichen Reihenfolge, Beträge in Euro. */
const standardKonfiguration = (erlaubt: Erlaubt): Konfiguration => ({ einheit: "EUR", abschnitte: [...erlaubt.abschnitte], kennzahlen: [...erlaubt.kennzahlen], spalten: [...erlaubt.spalten], unternehmenskennzahlen: [], zusatzfelder: [] });

/** Vorlagen je Berichtsart und Namen der Freigabestufen eines Fonds; ändern dürfen nur Verwalter des Fonds. */
export function VorlagenSeite() {
  const t = useT();
  const { data: fonds } = useSuspenseQuery(fondsListe());
  const { fondsId } = route.useSearch();
  const gewaehlt = wirksamerFonds(fonds, fondsId);
  if (!gewaehlt) return <KeinFonds titel={t.vorlagen.titel} />;
  return <VorlagenFuerFonds key={gewaehlt.id} fondsId={gewaehlt.id} fondsName={gewaehlt.name} />;
}

function VorlagenFuerFonds({ fondsId, fondsName }: { fondsId: string; fondsName: string }) {
  const t = useT();
  const { darf } = useRechte();
  useEffect(() => merkeFonds(fondsId), [fondsId]);
  const verwalter = darf("verwalter", fondsId, "berichte");
  return (
    <div className="app-seite">
      <Seitenkopf
        meta={
          <>
            <Link to="/berichte" search={{ fondsId }}>
              {t.vorlagen.zurueck}
            </Link>
            {" · "}
            {fondsName}
          </>
        }
        titel={t.vorlagen.titel}
      />
      <NurLesen fondsId={fondsId} mindest="verwalter" bereich="berichte" />
      {verwalter ? (
        <>
          <Hinweis>{t.vorlagen.geltung}</Hinweis>
          <StufenEditor fondsId={fondsId} />
          <VorlagenEditor fondsId={fondsId} />
        </>
      ) : (
        <Hinweis>{t.vorlagen.nurVerwalter}</Hinweis>
      )}
    </div>
  );
}

function StufenEditor({ fondsId }: { fondsId: string }) {
  const t = useT();
  const s = t.vorlagen.stufen;
  const { data, isPending, error } = useQuery(freigabestufen(fondsId));
  // Die Mutation lebt hier, nicht im Formular: Nach dem Speichern baut sich das Formular mit den neuen Werten neu auf (`key`), die Meldung „gespeichert“ bliebe sonst weg.
  const speichern = useStufenSetzen(fondsId);
  return (
    <section className="app-karte" aria-labelledby="stufen-editor-titel">
      <h2 id="stufen-editor-titel" className="cw-t-untertitel app-karte__titel">
        {s.titel}
      </h2>
      <p className="app-leer-text">{s.beschreibung}</p>
      {isPending ? <Skelettzeilen anzahl={3} /> : null}
      {error ? <FehlerHinweis fehler={error} /> : null}
      {data ? <StufenFormular key={data.join("|")} speichern={speichern} start={data} /> : null}
    </section>
  );
}

function StufenFormular({ speichern, start }: { speichern: ReturnType<typeof useStufenSetzen>; start: string[] }) {
  const t = useT();
  const s = t.vorlagen.stufen;
  // Jede Stufe hat eine stabile Kennung, damit die Zeilen beim Ordnen ihre Eingaben behalten.
  const naechste = useRef(start.length);
  const [stufen, setStufenRoh] = useState(() => start.map((name, id) => ({ id, name })));
  // Eine weitere Änderung nimmt die Meldung „gespeichert“ zurück.
  const setStufen: typeof setStufenRoh = (neu) => (speichern.reset(), setStufenRoh(neu));
  const [lokal, setLokal] = useState<string | null>(null);
  const anzeige = (name: string) => name || s.leerAnzeige;

  function absenden() {
    const getrimmt = stufen.map((x) => x.name.trim());
    setLokal(null);
    if (getrimmt.some((n) => n === "")) return setLokal(s.leer);
    if (getrimmt.length < 2) return setLokal(s.minimum);
    if (new Set(getrimmt.map((n) => n.toLowerCase())).size !== getrimmt.length) return setLokal(s.doppelt);
    speichern.mutate(getrimmt);
  }

  return (
    <form
      className="app-formular"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        absenden();
      }}
    >
      {lokal ? <Hinweis variante="fehler">{lokal}</Hinweis> : null}
      <FehlerHinweis fehler={speichern.error} />
      <SortierbareListe
        className="app-stufenliste"
        aria-label={s.titel}
        eintraege={stufen}
        schluessel={(x) => String(x.id)}
        name={(x) => anzeige(x.name)}
        onAendern={setStufen}
        texte={{ griff: s.griff, hinweis: s.bedienung, aufgenommen: s.aufgenommen, verschoben: s.verschoben, abgelegt: s.abgelegt, abgebrochen: s.abgebrochen }}
        zeile={(x) => (
          <div className="app-stufenzeile">
            <Feld label={s.name(stufen.findIndex((y) => y.id === x.id) + 1)} autoComplete="off" value={x.name} onChange={(e) => setStufen((alt) => alt.map((y) => (y.id === x.id ? { ...y, name: e.target.value } : y)))} />
            <Button variante="ruhig" disabled={stufen.length <= 2} aria-label={s.entfernen(anzeige(x.name))} onClick={() => setStufen((alt) => alt.filter((y) => y.id !== x.id))}>
              ×
            </Button>
          </div>
        )}
      />
      {speichern.isSuccess ? (
        <p className="app-leer-text" role="status">
          {s.gespeichert}
        </p>
      ) : null}
      <div className="app-aktionen__knoepfe">
        <Button variante="sekundaer" disabled={stufen.length >= 6} onClick={() => setStufen((alt) => [...alt, { id: naechste.current++, name: "" }])}>
          {s.hinzufuegen}
        </Button>
        <Button type="submit" disabled={speichern.isPending}>
          {s.speichern}
        </Button>
      </div>
    </form>
  );
}

function VorlagenEditor({ fondsId }: { fondsId: string }) {
  const t = useT();
  const v = t.vorlagen.vorlage;
  const { data, isPending, error } = useQuery(berichtsvorlagen(fondsId));
  const [art, setArt] = useState<Berichtsart>("lp_bericht");
  const eintrag = data?.find((x) => x.art === art);
  // Die Mutation lebt hier, nicht im Formular: Nach dem Speichern baut sich das Formular mit der neuen Konfiguration neu auf (`key`), die Meldung „gespeichert“ bliebe sonst weg.
  const speichern = useVorlageSetzen(fondsId);
  return (
    <section className="app-karte" aria-labelledby="vorlagen-editor-titel">
      <h2 id="vorlagen-editor-titel" className="cw-t-untertitel app-karte__titel">
        {v.titel}
      </h2>
      <p className="app-leer-text">{v.beschreibung}</p>
      <Auswahl label={v.art} value={art} onChange={(e) => (speichern.reset(), setArt(e.target.value as Berichtsart))}>
        {anlegbareArten().map((a) => (
          <option key={a} value={a}>
            {aufzaehlung(t.bericht.art, a)}
          </option>
        ))}
      </Auswahl>
      {isPending ? <Skelettzeilen anzahl={4} /> : null}
      {error ? <FehlerHinweis fehler={error} /> : null}
      {eintrag ? (
        <>
          <p>
            <Status variante={eintrag.angepasst ? "freigegeben" : "entwurf"}>{eintrag.angepasst ? v.angepasst : v.standard}</Status>
          </p>
          <KonfigurationsFormular key={`${art}-${JSON.stringify(eintrag.konfiguration)}`} fondsId={fondsId} speichern={speichern} art={art} erlaubt={eintrag.erlaubt} start={alsKonfiguration(eintrag.konfiguration, eintrag.erlaubt)} />
        </>
      ) : null}
    </section>
  );
}

function KonfigurationsFormular({ fondsId, speichern, art, erlaubt, start }: { fondsId: string; speichern: ReturnType<typeof useVorlageSetzen>; art: Berichtsart; erlaubt: Erlaubt; start: Konfiguration }) {
  const t = useT();
  const v = t.vorlagen.vorlage;
  const [k, setKRoh] = useState<Konfiguration>(start);
  // Eine weitere Änderung nimmt die Meldung „gespeichert“ zurück.
  const setK: typeof setKRoh = (neu) => (speichern.reset(), setKRoh(neu));
  const [lokal, setLokal] = useState<string | null>(null);
  const hatAbschnitte = erlaubt.abschnitte.length > 0;
  const hatKennzahlen = erlaubt.kennzahlen.length > 0;
  const hatSpalten = erlaubt.spalten.length > 0;

  function absenden() {
    setLokal(null);
    if ((hatAbschnitte && k.abschnitte.length === 0) || (hatSpalten && k.spalten.length === 0)) return setLokal(v.mindestensEins);
    // Die API ersetzt die ganze Konfiguration: Fehlendes würde auf den Standard zurückfallen, deshalb geht immer alles mit.
    speichern.mutate({ art, konfiguration: { einheit: k.einheit, abschnitte: k.abschnitte, kennzahlen: k.kennzahlen, spalten: k.spalten, ...(art === "quartalsbericht" ? { unternehmenskennzahlen: k.unternehmenskennzahlen } : {}), ...(erlaubt.zusatzfelder ? { zusatzfelder: k.zusatzfelder } : {}) } });
  }

  return (
    <form
      className="app-formular"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        absenden();
      }}
    >
      {lokal ? <Hinweis variante="fehler">{lokal}</Hinweis> : null}
      <FehlerHinweis fehler={speichern.error} />
      <div className="app-gruppe">
        <span className="cw-feld__label" id={`einheit-${art}`}>
          {v.einheit}
        </span>
        <Segment<Einheit>
          aria-labelledby={`einheit-${art}`}
          value={k.einheit}
          onChange={(einheit) => setK((alt) => ({ ...alt, einheit }))}
          options={erlaubt.einheiten.map((e) => ({ wert: e, label: aufzaehlung(v.einheiten, e) }))}
        />
      </div>
      {!hatAbschnitte && !hatKennzahlen && !hatSpalten ? <p className="app-leer-text">{v.nurEinheit}</p> : null}
      {hatAbschnitte ? <Auswahlliste titel={v.abschnitte} alle={erlaubt.abschnitte} gewaehlt={k.abschnitte} name={(x) => aufzaehlung(v.abschnittNamen, x)} onChange={(abschnitte) => setK((alt) => ({ ...alt, abschnitte }))} /> : null}
      {art === "quartalsbericht" && k.abschnitte.includes("unternehmenskennzahlen") ? <UnternehmenskennzahlenAuswahl fondsId={fondsId} gewaehlt={k.unternehmenskennzahlen} onChange={(unternehmenskennzahlen) => setK((alt) => ({ ...alt, unternehmenskennzahlen }))} /> : null}
      {hatKennzahlen ? <Auswahlliste titel={v.kennzahlen} alle={erlaubt.kennzahlen} gewaehlt={k.kennzahlen} name={(x) => aufzaehlung(v.kennzahlNamen, x)} onChange={(kennzahlen) => setK((alt) => ({ ...alt, kennzahlen }))} /> : null}
      {hatSpalten ? <Auswahlliste titel={v.spalten} alle={erlaubt.spalten} gewaehlt={k.spalten} name={(x) => aufzaehlung(v.spaltenNamen, x)} onChange={(spalten) => setK((alt) => ({ ...alt, spalten }))} /> : null}
      {erlaubt.zusatzfelder ? <ZusatzfelderAuswahl gewaehlt={k.zusatzfelder} onChange={(zusatzfelder) => setK((alt) => ({ ...alt, zusatzfelder }))} /> : null}
      {speichern.isSuccess ? (
        <p className="app-leer-text" role="status">
          {v.gespeichert}
        </p>
      ) : null}
      <div className="app-aktionen__knoepfe">
        <Button variante="sekundaer" onClick={() => setK(standardKonfiguration(erlaubt))}>
          {v.standardEinsetzen}
        </Button>
        <Button type="submit" disabled={speichern.isPending}>
          {v.speichern}
        </Button>
      </div>
    </form>
  );
}

/**
 * Eigene Felder von Fonds, Runde, Instrument und Beteiligung als weitere Spalten: Angeboten werden die aktiven Definitionen der vier Objekte;
 * eine gewählte Definition, die es nicht mehr gibt, bleibt mit ihrer Kennung sichtbar und lässt sich abwählen.
 */
function ZusatzfelderAuswahl({ gewaehlt, onChange }: { gewaehlt: string[]; onChange: (neu: string[]) => void }) {
  const t = useT();
  const v = t.vorlagen.vorlage;
  const fonds = useQuery(zusatzDefinitionen("fonds"));
  const runde = useQuery(zusatzDefinitionen("runde"));
  const instrument = useQuery(zusatzDefinitionen("instrument"));
  const beteiligung = useQuery(zusatzDefinitionen("beteiligung"));
  const abfragen = [fonds, runde, instrument, beteiligung];
  if (abfragen.some((a) => a.isPending)) return <Skelettzeilen anzahl={2} />;
  const fehler = abfragen.find((a) => a.error)?.error;
  if (fehler) return <FehlerHinweis fehler={fehler} />;
  const definitionen = abfragen.flatMap((a) => a.data ?? []);
  const namen = new Map(definitionen.map((d) => [d.id, `${d.name} (${aufzaehlung(v.zusatzfeldObjekt, d.objekt)})`]));
  return (
    <>
      <Auswahlliste titel={v.zusatzfelder} alle={definitionen.map((d) => d.id)} gewaehlt={gewaehlt} name={(x) => namen.get(x) ?? x} onChange={onChange} />
      <p className="app-leer-text">{definitionen.length === 0 ? v.zusatzfelderKeine : v.zusatzfelderHilfe}</p>
    </>
  );
}

/**
 * Kennzahlen der Unternehmen im gleichnamigen Abschnitt des Quartalsberichts: Angeboten wird die Auswahl des Fonds (Etappe 11);
 * ohne Haken zeigt der Bericht die ganze Auswahl des Fonds.
 */
function UnternehmenskennzahlenAuswahl({ fondsId, gewaehlt, onChange }: { fondsId: string; gewaehlt: string[]; onChange: (neu: string[]) => void }) {
  const t = useT();
  const sprache = useSprache();
  const v = t.vorlagen.vorlage;
  const { data: auswahl, isPending, error } = useQuery(kennzahlAuswahl(fondsId));
  if (isPending) return <Skelettzeilen anzahl={2} />;
  if (error) return <FehlerHinweis fehler={error} />;
  const namen = new Map(auswahl.map((z) => [z.schluessel, kennzahlName(z.definition, sprache)]));
  const alle = auswahl.filter((z) => z.gueltig).map((z) => z.schluessel);
  return (
    <>
      <Auswahlliste titel={v.unternehmenskennzahlen} alle={alle} gewaehlt={gewaehlt} name={(x) => namen.get(x) ?? x} onChange={onChange} />
      <p className="app-leer-text">{alle.length === 0 ? v.unternehmenskennzahlenKeine : v.unternehmenskennzahlenHilfe}</p>
    </>
  );
}

/**
 * Auswahl mit Reihenfolge: Angehakte Einträge stehen oben in der gewählten Reihenfolge und lassen sich verschieben,
 * die übrigen darunter.
 */
function Auswahlliste({ titel, alle, gewaehlt, name, onChange }: { titel: string; alle: readonly string[]; gewaehlt: string[]; name: (schluessel: string) => string; onChange: (neu: string[]) => void }) {
  const t = useT();
  const v = t.vorlagen.vorlage;
  const uebrige = alle.filter((x) => !gewaehlt.includes(x));
  return (
    <fieldset className="app-gruppe">
      <legend className="cw-feld__label">{titel}</legend>
      <span className="cw-feld__hilfe">{v.reihenfolgeHilfe}</span>
      <SortierbareListe
        className="app-liste"
        aria-label={titel}
        eintraege={gewaehlt}
        schluessel={(x) => x}
        name={name}
        onAendern={onChange}
        texte={{ griff: v.griff, hinweis: v.bedienung, aufgenommen: v.aufgenommen, verschoben: v.verschoben, abgelegt: v.abgelegt, abgebrochen: v.abgebrochen }}
        zeile={(x) => (
          <label className="app-haken">
            <input type="checkbox" checked onChange={() => onChange(gewaehlt.filter((g) => g !== x))} />
            <span>{name(x)}</span>
          </label>
        )}
      />
      <ul className="app-liste">
        {uebrige.map((x) => (
          <li key={x} className="app-reihenfolge">
            <label className="app-haken">
              <input type="checkbox" checked={false} onChange={() => onChange([...gewaehlt, x])} />
              <span>{name(x)}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
