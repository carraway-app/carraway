import { Logo, OHNE_PASSWORTMANAGER } from "@carraway/ui";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  anzeigeWert,
  formatDatum,
  ladeAbfrage,
  parseWert,
  reicheEin,
  speichereEntwurf,
  wertFuerFeld,
  ExternerApiFehler,
  type Abrufer,
  type EntwurfsWert,
  type ExterneAbfrage,
  type ExterneKennzahl,
  type ExternerFehler,
  type WertFehler,
} from "./abfrage";
import { EXTERN_TEXTE, type ExterneSprache } from "./texte";

/**
 * Öffentliche Formularseite für Unternehmen (`/external/requests/:token`), ohne Anmeldung, Navigation und Konto. Ein Formular mit den
 * angeforderten Kennzahlen: Entwurf speichern, einreichen, danach nur lesen. Zugänglich: sichtbare Beschriftungen, Fehlertexte am Feld
 * (`aria-describedby`, `aria-invalid`), Statusmeldungen in einer `aria-live`-Zone, Fokus auf das erste fehlerhafte Feld, einspaltig und
 * mit großen Eingabefeldern für Mobilgeräte.
 */

interface Props {
  token: string;
  /** Für Tests; sonst `fetch`. */
  abrufer?: Abrufer;
  /** Startsprache bis die Anfrage geladen ist. */
  startSprache?: ExterneSprache;
}

function navigatorSprache(): ExterneSprache {
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("en") ? "en" : "de";
}

const bezeichnung = (k: ExterneKennzahl, sprache: ExterneSprache) => (sprache === "de" ? k.bezeichnungDe : k.bezeichnungEn);
const einheitAnzeige = (k: ExterneKennzahl) => (k.typ === "ja_nein" || k.typ === "text" ? "" : k.einheit);
const erlaeuterung = (k: ExterneKennzahl, sprache: ExterneSprache) => (sprache === "de" ? k.erlaeuterungDe : k.erlaeuterungEn) ?? null;
/** Zu ESG-Datenpunkten gehören Erläuterung, Schätzkennzeichen und Quelle; im ESG-Fragebogen gilt das für jede Angabe (auch den Umsatz). */
const istEsg = (k: ExterneKennzahl, a: Pick<ExterneAbfrage, "art">) => k.esg === true || a.art === "esg";

const standardAbrufer: Abrufer = (...a) => fetch(...a);

export function ExternesFormular({ token, abrufer = standardAbrufer, startSprache }: Props) {
  const [sprache, setSprache] = useState<ExterneSprache>(startSprache ?? navigatorSprache());
  const [abfrage, setAbfrage] = useState<ExterneAbfrage | null>(null);
  const [ladefehler, setLadefehler] = useState<ExternerFehler | null>(null);
  const [werte, setWerte] = useState<Record<string, string>>({});
  const [anmerkungen, setAnmerkungen] = useState<Record<string, string>>({});
  const [geschaetzt, setGeschaetzt] = useState<Record<string, boolean>>({});
  const [quellen, setQuellen] = useState<Record<string, string>>({});
  const [fehler, setFehler] = useState<Record<string, WertFehler | "pflicht">>({});
  const [meldung, setMeldung] = useState<{ art: "ok" | "fehler"; text: string } | null>(null);
  const [arbeitet, setArbeitet] = useState(false);
  const [danke, setDanke] = useState(false);
  const formular = useRef<HTMLFormElement>(null);
  const t = EXTERN_TEXTE[sprache];

  // Sprache der Seite für Vorlesegeräte und Silbentrennung, Titel des Tabs
  useEffect(() => {
    document.documentElement.lang = sprache;
    document.title = t.seiteTitel;
  }, [sprache, t.seiteTitel]);

  const uebernehme = useCallback((a: ExterneAbfrage, s: ExterneSprache) => {
    setAbfrage(a);
    setWerte(Object.fromEntries(a.kennzahlen.map((k) => [k.schluessel, wertFuerFeld(k.typ, k.wert, s)])));
    setAnmerkungen(Object.fromEntries(a.kennzahlen.map((k) => [k.schluessel, k.kommentar ?? ""])));
    setGeschaetzt(Object.fromEntries(a.kennzahlen.map((k) => [k.schluessel, k.geschaetzt === true])));
    setQuellen(Object.fromEntries(a.kennzahlen.map((k) => [k.schluessel, k.quellenangabe ?? ""])));
  }, []);

  useEffect(() => {
    let aktiv = true;
    ladeAbfrage(abrufer, token).then(
      (a) => {
        if (!aktiv) return;
        // Die Sprache der Anfrage gilt beim Öffnen, außer die Person hat schon gewählt (startSprache).
        const s = startSprache ?? a.sprache;
        setSprache(s);
        uebernehme(a, s);
        if (a.schreibgeschuetzt) setDanke(false);
      },
      (e: unknown) => aktiv && setLadefehler(e instanceof ExternerApiFehler ? e.art : "allgemein"),
    );
    return () => {
      aktiv = false;
    };
  }, [abrufer, token, startSprache, uebernehme]);

  function wechsleSprache(neu: ExterneSprache) {
    if (!abfrage || neu === sprache) return setSprache(neu);
    // Zahlen in den Feldern werden in die Schreibweise der neuen Sprache umgeschrieben, soweit sie gültig sind.
    setWerte((alt) =>
      Object.fromEntries(
        abfrage.kennzahlen.map((k) => {
          const roh = alt[k.schluessel] ?? "";
          if (k.typ === "ja_nein" || k.typ === "text" || roh.trim() === "") return [k.schluessel, roh];
          const geparst = parseWert(k.typ, roh, sprache);
          return [k.schluessel, "wert" in geparst ? wertFuerFeld(k.typ, geparst.wert, neu) : roh];
        }),
      ),
    );
    setFehler({});
    setSprache(neu);
  }

  /** Prüft alle Felder; gibt die Werte für die API zurück oder `null` bei Fehlern (Fokus auf das erste). */
  function pruefe(pflichtVerlangen: boolean): EntwurfsWert[] | null {
    if (!abfrage) return null;
    const neu: Record<string, WertFehler | "pflicht"> = {};
    const aus: EntwurfsWert[] = [];
    for (const k of abfrage.kennzahlen) {
      const roh = (werte[k.schluessel] ?? "").trim();
      const anmerkung = (anmerkungen[k.schluessel] ?? "").trim();
      if (roh === "") {
        if (pflichtVerlangen && k.pflicht) neu[k.schluessel] = "pflicht";
        aus.push({ schluessel: k.schluessel, wert: null, kommentar: null });
        continue;
      }
      const g = parseWert(k.typ, roh, sprache);
      if ("fehler" in g) neu[k.schluessel] = g.fehler;
      else {
        const quelle = (quellen[k.schluessel] ?? "").trim();
        aus.push({
          schluessel: k.schluessel,
          typ: k.typ,
          wert: g.wert,
          kommentar: anmerkung === "" ? null : anmerkung.slice(0, 1000),
          ...(istEsg(k, abfrage) ? { geschaetzt: geschaetzt[k.schluessel] === true, quellenangabe: quelle === "" ? null : quelle.slice(0, 500) } : {}),
        });
      }
    }
    setFehler(neu);
    const erstes = abfrage.kennzahlen.find((k) => neu[k.schluessel]);
    if (erstes) {
      const fehlend = abfrage.kennzahlen.filter((k) => neu[k.schluessel] === "pflicht").map((k) => bezeichnung(k, sprache));
      setMeldung({ art: "fehler", text: fehlend.length > 0 ? t.fehlerPflicht(fehlend.join(", ")) : t.fehlerPruefen });
      queueMicrotask(() => formular.current?.querySelector<HTMLElement>(`[data-kennzahl="${erstes.schluessel}"] input, [data-kennzahl="${erstes.schluessel}"] textarea`)?.focus());
      return null;
    }
    return aus;
  }

  async function aktion(einreichen: boolean) {
    setMeldung(null);
    const eintraege = pruefe(einreichen);
    if (!eintraege) return;
    setArbeitet(true);
    try {
      let a = await speichereEntwurf(abrufer, token, eintraege);
      if (einreichen) {
        a = await reicheEin(abrufer, token);
        uebernehme(a, sprache);
        setDanke(true);
      } else {
        uebernehme(a, sprache);
        setMeldung({ art: "ok", text: t.entwurfGespeichert });
      }
    } catch (e) {
      const art = e instanceof ExternerApiFehler ? e.art : "allgemein";
      if (art === "pflicht" && e instanceof ExternerApiFehler && abfrage) {
        setFehler(Object.fromEntries(e.fehlend.map((s) => [s, "pflicht" as const])));
        setMeldung({ art: "fehler", text: t.fehlerPflicht(abfrage.kennzahlen.filter((k) => e.fehlend.includes(k.schluessel)).map((k) => bezeichnung(k, sprache)).join(", ")) });
      } else if (art === "link" || art === "widerrufen" || art === "abgelaufen") setLadefehler(art);
      else setMeldung({ art: "fehler", text: meldungFuer(art, t) });
    } finally {
      setArbeitet(false);
    }
  }

  const absenden = (e: FormEvent) => {
    e.preventDefault();
    void aktion(true);
  };

  return (
    <div className="extern" lang={sprache}>
      <header className="extern__kopf">
        <Logo />
        <div role="group" aria-label={t.sprache} className="extern__sprache">
          {(["de", "en"] as const).map((s) => (
            <button key={s} type="button" className="extern__sprache-knopf" aria-pressed={sprache === s} lang={s} onClick={() => wechsleSprache(s)}>
              {s === "de" ? t.deutsch : t.englisch}
            </button>
          ))}
        </div>
      </header>
      <main className="extern__haupt" id="inhalt">
        {ladefehler ? (
          <p role="alert" className="extern__fehler">
            {ladefehlerText(ladefehler, t)}
          </p>
        ) : !abfrage ? (
          <p role="status">{t.laedt}</p>
        ) : danke ? (
          <section aria-labelledby="extern-danke">
            <h1 id="extern-danke" className="extern__titel">
              {t.danke}
            </h1>
            <p>{t.dankeText}</p>
            <Lesen abfrage={abfrage} sprache={sprache} />
          </section>
        ) : (
          <>
            <h1 className="extern__titel">{abfrage.art === "esg" ? t.esgTitel(abfrage.unternehmen) : t.titel(abfrage.unternehmen)}</h1>
            <p>{t.einleitung(formatDatum(abfrage.periodeBeginn, sprache), formatDatum(abfrage.periodeEnde, sprache))}</p>
            {abfrage.art === "esg" ? <p className="extern__hinweis">{t.esgEinleitung}</p> : null}
            <p className="extern__frist">
              <strong>{t.faellig(formatDatum(abfrage.faelligAm, sprache))}</strong> {t.gueltigBis(formatDatum(abfrage.ablauf, sprache))}
            </p>
            <p className="extern__klein">{t.ohneKonto}</p>
            {abfrage.hinweis ? <p className="extern__hinweis">{abfrage.hinweis}</p> : null}
            {abfrage.schreibgeschuetzt ? (
              <>
                <p role="status">{t.eingereichtHinweis}</p>
                <Lesen abfrage={abfrage} sprache={sprache} />
              </>
            ) : (
              <form ref={formular} onSubmit={absenden} noValidate aria-describedby="extern-meldung">
                {abfrage.kennzahlen.map((k) => (
                  <Feldgruppe
                    key={k.schluessel}
                    k={k}
                    sprache={sprache}
                    esg={istEsg(k, abfrage)}
                    wert={werte[k.schluessel] ?? ""}
                    anmerkung={anmerkungen[k.schluessel] ?? ""}
                    geschaetzt={geschaetzt[k.schluessel] === true}
                    quelle={quellen[k.schluessel] ?? ""}
                    fehler={fehler[k.schluessel]}
                    onWert={(w) => setWerte((alt) => ({ ...alt, [k.schluessel]: w }))}
                    onAnmerkung={(w) => setAnmerkungen((alt) => ({ ...alt, [k.schluessel]: w }))}
                    onGeschaetzt={(g) => setGeschaetzt((alt) => ({ ...alt, [k.schluessel]: g }))}
                    onQuelle={(w) => setQuellen((alt) => ({ ...alt, [k.schluessel]: w }))}
                  />
                ))}
                <div className="extern__aktionen">
                  <button type="button" className="cw-button cw-button--sekundaer cw-button--l" disabled={arbeitet} onClick={() => void aktion(false)}>
                    {t.entwurfSpeichern}
                  </button>
                  <button type="submit" className="cw-button cw-button--l" disabled={arbeitet}>
                    {t.einreichen}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
        <div id="extern-meldung" aria-live="polite" className={meldung?.art === "fehler" ? "extern__fehler" : "extern__ok"}>
          {arbeitet ? t.speichert : (meldung?.text ?? "")}
        </div>
      </main>
    </div>
  );
}

function meldungFuer(art: ExternerFehler, t: (typeof EXTERN_TEXTE)["de"]): string {
  switch (art) {
    case "zuViele":
      return t.fehlerZuViele;
    case "eingereicht":
      return t.fehlerEingereicht;
    case "ungueltig":
      return t.fehlerPruefen;
    default:
      return t.fehlerAllgemein;
  }
}

function ladefehlerText(art: ExternerFehler, t: (typeof EXTERN_TEXTE)["de"]): string {
  switch (art) {
    case "link":
      return t.fehlerLink;
    case "widerrufen":
      return t.fehlerWiderrufen;
    case "abgelaufen":
      return t.fehlerAbgelaufen;
    default:
      return meldungFuer(art, t);
  }
}

function fehlerText(f: WertFehler | "pflicht", t: (typeof EXTERN_TEXTE)["de"]): string {
  if (f === "pflicht") return `${t.pflicht}: ${t.fehlerWert}`;
  return { betrag: t.fehlerBetrag, zahl: t.fehlerZahl, jaNein: t.fehlerJaNein, text: t.fehlerText, wert: t.fehlerWert }[f];
}

interface FeldProps {
  k: ExterneKennzahl;
  sprache: ExterneSprache;
  /** ESG-Datenpunkt: Erläuterung, Schätzkennzeichen und Quelle anzeigen. */
  esg: boolean;
  wert: string;
  anmerkung: string;
  geschaetzt: boolean;
  quelle: string;
  fehler: WertFehler | "pflicht" | undefined;
  onWert: (wert: string) => void;
  onAnmerkung: (wert: string) => void;
  onGeschaetzt: (geschaetzt: boolean) => void;
  onQuelle: (quelle: string) => void;
}

function Feldgruppe({ k, sprache, esg, wert, anmerkung, geschaetzt, quelle, fehler, onWert, onAnmerkung, onGeschaetzt, onQuelle }: FeldProps) {
  const t = EXTERN_TEXTE[sprache];
  const id = `kz-${k.schluessel}`;
  const meldungId = `${id}-meldung`;
  const name = t.wertLabel(bezeichnung(k, sprache), einheitAnzeige(k));
  const markierung = k.pflicht ? t.pflicht : t.freiwillig;
  const hilfe = k.typ === "text" ? t.eingabeHilfeText : k.typ === "ja_nein" ? undefined : t.eingabeHilfeZahl;
  const meldung = fehler ? fehlerText(fehler, t) : hilfe;
  const klasse = `extern__feld${fehler ? " extern__feld--fehler" : ""}`;
  const erklaerung = esg ? erlaeuterung(k, sprache) : null;
  const erklaerungId = `${id}-erlaeuterung`;
  const beschreibung = [erklaerung || k.regelwerk ? erklaerungId : null, meldung ? meldungId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={klasse} data-kennzahl={k.schluessel}>
      {k.typ === "ja_nein" ? (
        <fieldset aria-describedby={beschreibung} aria-invalid={fehler ? true : undefined}>
          <legend>
            {name} <span className="extern__marke">({markierung})</span>
          </legend>
          <label className="extern__radio">
            <input type="radio" name={id} value="ja" checked={wert === "ja"} onChange={() => onWert("ja")} /> {t.ja}
          </label>
          <label className="extern__radio">
            <input type="radio" name={id} value="nein" checked={wert === "nein"} onChange={() => onWert("nein")} /> {t.nein}
          </label>
          {wert !== "" && !k.pflicht ? (
            <button type="button" className="cw-button cw-button--ruhig" onClick={() => onWert("")}>
              {t.keineAngabe}
            </button>
          ) : null}
        </fieldset>
      ) : (
        <>
          <label htmlFor={id} className="extern__label">
            {name} <span className="extern__marke">({markierung})</span>
          </label>
          <input id={id} className="extern__eingabe" type="text" inputMode={k.typ === "text" ? "text" : "decimal"} {...OHNE_PASSWORTMANAGER} spellCheck={k.typ === "text"} value={wert} onChange={(e) => onWert(e.target.value)} aria-invalid={fehler ? true : undefined} aria-required={k.pflicht || undefined} aria-describedby={beschreibung} />
        </>
      )}
      {erklaerung || (esg && k.regelwerk) ? (
        <div id={erklaerungId} className="extern__klein">
          {erklaerung}
          {esg && k.regelwerk ? <span className="extern__grundlage"> {t.grundlage(k.regelwerk)}</span> : null}
        </div>
      ) : null}
      {meldung ? (
        <div id={meldungId} className={fehler ? "extern__feld-fehler" : "extern__klein"}>
          {meldung}
        </div>
      ) : null}
      {esg ? (
        <div className="extern__esg">
          <label className="extern__radio">
            <input type="checkbox" checked={geschaetzt} onChange={(e) => onGeschaetzt(e.target.checked)} /> {t.geschaetzt}
          </label>
          <label className="extern__label" htmlFor={`${id}-quelle`}>
            {t.quelle}
          </label>
          <input id={`${id}-quelle`} className="extern__eingabe" type="text" {...OHNE_PASSWORTMANAGER} maxLength={500} value={quelle} onChange={(e) => onQuelle(e.target.value)} />
        </div>
      ) : null}
      <details className="extern__anmerkung">
        <summary>{t.anmerkung}</summary>
        <label className="extern__label" htmlFor={`${id}-anmerkung`}>
          {t.anmerkung}
        </label>
        <textarea id={`${id}-anmerkung`} className="extern__eingabe" rows={2} maxLength={1000} value={anmerkung} onChange={(e) => onAnmerkung(e.target.value)} />
      </details>
    </div>
  );
}

function Lesen({ abfrage, sprache }: { abfrage: ExterneAbfrage; sprache: ExterneSprache }) {
  const t = EXTERN_TEXTE[sprache];
  return (
    <dl className="extern__lesen">
      {abfrage.kennzahlen.map((k) => (
        <div key={k.schluessel} className="extern__lesen-zeile">
          <dt>{t.wertLabel(bezeichnung(k, sprache), einheitAnzeige(k))}</dt>
          <dd>
            {k.wert === null ? t.keineAngabe : anzeigeWert(k.typ, k.wert, sprache, t.ja, t.nein)}
            {k.wert !== null && k.geschaetzt ? <span className="extern__klein"> ({t.geschaetztMarke})</span> : null}
            {k.quellenangabe ? <span className="extern__klein"> – {t.quelleLesen(k.quellenangabe)}</span> : null}
            {k.kommentar ? <span className="extern__klein"> – {k.kommentar}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
