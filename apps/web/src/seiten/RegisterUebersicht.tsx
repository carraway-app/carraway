import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Auswahl, Button, Feld, FolderOpenIcon, Hinweis, ListChecksIcon, MagnifyingGlassIcon, Seitenkopf, Tabelle, Tabs, type TabelleSpalte } from "@carraway/ui";
import { alleRegisterMeldungen, registerStatus, registerSuche, useMeldungGelesenGesamt, useRegisterImport, type RegisterTreffer, type SammelMeldung } from "../api/register";
import { ApiFehler } from "../api/client";
import { DateiDropzone } from "../komponenten/DateiDropzone";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { Skelettzeilen } from "../komponenten/Skelett";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { useRechte } from "../lib/rechte";
import { formatZeitpunkt } from "../lib/zeit";

/**
 * Register über alle Unternehmen (Etappe 18): Meldungen mit „gelesen“, Sammelaktualisierung aus einer Datei (mit „Nur prüfen“) und die
 * Suche beim eingerichteten Anbieter. Die Registerdaten eines einzelnen Unternehmens stehen an der Organisation.
 */
export function RegisterUebersichtSeite() {
  const t = useT();
  const u = t.register.uebersicht;
  const [tab, setTab] = useState("meldungen");
  return (
    <div className="app-seite">
      <Seitenkopf meta={u.etikett} titel={u.titel} />
      <p className="app-leer-text app-lesetext">{u.beschreibung}</p>
      <Tabs
        aria-label={t.tabs.bereiche}
        aktiv={tab}
        onWechsel={setTab}
        tabs={[
          { id: "meldungen", icon: ListChecksIcon, label: u.meldungen.titel, inhalt: () => <MeldungenKarte /> },
          { id: "datei", icon: FolderOpenIcon, label: u.datei.titel, inhalt: () => <DateiKarte /> },
          { id: "suche", icon: MagnifyingGlassIcon, label: u.suche.titel, inhalt: () => <SucheKarte /> },
        ]}
      />
    </div>
  );
}

function MeldungenKarte() {
  const t = useT();
  const sprache = useSprache();
  const m = t.register.uebersicht.meldungen;
  const [nurUngelesen, setNurUngelesen] = useState(true);
  const { data, error, isPending } = useQuery(alleRegisterMeldungen(nurUngelesen));
  const gelesen = useMeldungGelesenGesamt();

  const spalten: TabelleSpalte<SammelMeldung>[] = [
    { schluessel: "datum", kopf: m.spalten.datum, zelle: (x) => formatZeitpunkt(x.erstelltAm, sprache) },
    {
      schluessel: "org",
      kopf: m.spalten.unternehmen,
      zelle: (x) => (
        <Link to="/organisationen/$id" params={{ id: x.organisationId }}>
          {x.organisation}
        </Link>
      ),
    },
    { schluessel: "art", kopf: m.spalten.art, zelle: (x) => aufzaehlung(m.arten, x.art) },
    { schluessel: "text", kopf: m.spalten.text, umbruch: true, zelle: (x) => x.text },
    {
      schluessel: "aktion",
      kopf: m.spalten.aktion,
      zelle: (x) =>
        x.gelesenAm ? (
          <span className="app-leer-text">{m.gelesenAm(formatZeitpunkt(x.gelesenAm, sprache))}</span>
        ) : (
          <Button variante="sekundaer" aria-label={t.register.meldungen.gelesenFuer(x.text)} disabled={gelesen.isPending} onClick={() => gelesen.mutate(x.id)}>
            {t.register.meldungen.gelesen}
          </Button>
        ),
    },
  ];

  return (
    <section className="app-karte" aria-labelledby="register-meldungen-titel">
      <h2 id="register-meldungen-titel" className="cw-t-untertitel app-karte__titel">
        {m.titel}
      </h2>
      <label className="app-kz-schalter">
        <input type="checkbox" checked={nurUngelesen} onChange={(e) => setNurUngelesen(e.target.checked)} />
        <span>{m.nurUngelesen}</span>
      </label>
      <FehlerHinweis fehler={error ?? gelesen.error} />
      {isPending ? (
        <Skelettzeilen anzahl={3} />
      ) : data && data.length === 0 ? (
        <p className="app-leer-text">{nurUngelesen ? m.keineUngelesen : m.keine}</p>
      ) : data ? (
        <Tabelle beschriftung={m.titel} spalten={spalten} zeilen={data} zeilenSchluessel={(x) => x.id} />
      ) : null}
    </section>
  );
}

type Format = "json" | "csv";
interface ImportFehler {
  zeile: number;
  feld: string;
  meldung: string;
}

function DateiKarte() {
  const t = useT();
  const d = t.register.uebersicht.datei;
  const { darf } = useRechte();
  const importieren = useRegisterImport();
  const [dateiName, setDateiName] = useState("");
  const [inhalt, setInhalt] = useState<string | null>(null);
  const [format, setFormat] = useState<Format>("json");
  const [lokal, setLokal] = useState<string | null>(null);
  const [ergebnis, setErgebnis] = useState<{ nurGeprueft: boolean; zeilen: number; angelegt: number; unveraendert: number; ereignisse: number } | null>(null);

  async function waehle(datei: File | undefined) {
    setErgebnis(null);
    setLokal(null);
    importieren.reset();
    if (!datei) {
      setDateiName("");
      setInhalt(null);
      return;
    }
    setDateiName(datei.name);
    setFormat(datei.name.toLowerCase().endsWith(".csv") ? "csv" : "json");
    setInhalt(await datei.text());
  }

  function senden(nurPruefen: boolean) {
    setLokal(null);
    setErgebnis(null);
    if (inhalt === null) return setLokal(d.keineDatei);
    importieren.mutate(
      { format, inhalt, nurPruefen },
      {
        onSuccess: (r) =>
          setErgebnis(
            r.uebernommen
              ? { nurGeprueft: false, zeilen: r.zeilen, angelegt: r.angelegt, unveraendert: r.unveraendert, ereignisse: r.ereignisse }
              : { nurGeprueft: true, zeilen: r.zeilen, angelegt: 0, unveraendert: 0, ereignisse: 0 },
          ),
      },
    );
  }

  const fehlerZeilen: ImportFehler[] = importieren.error instanceof ApiFehler && Array.isArray(importieren.error.zusatz.zeilen) ? (importieren.error.zusatz.zeilen as ImportFehler[]) : [];
  const anzahlFehler = importieren.error instanceof ApiFehler && typeof importieren.error.zusatz.anzahlFehler === "number" ? importieren.error.zusatz.anzahlFehler : fehlerZeilen.length;

  return (
    <section className="app-karte" aria-labelledby="register-datei-titel">
      <h2 id="register-datei-titel" className="cw-t-untertitel app-karte__titel">
        {d.titel}
      </h2>
      <p className="app-leer-text app-lesetext">{d.beschreibung}</p>
      {!darf("bearbeiter") ? (
        <Hinweis>{d.nurBearbeiter}</Hinweis>
      ) : (
        <div className="app-formular">
          <DateiDropzone label={d.datei} accept=".json,.csv,application/json,text/csv" dateiname={dateiName} deaktiviert={importieren.isPending} onDateien={([datei]) => void waehle(datei)} />
          <Auswahl label={d.format} value={format} onChange={(e) => setFormat(e.target.value === "csv" ? "csv" : "json")}>
            {(["json", "csv"] as const).map((f) => (
              <option key={f} value={f}>
                {aufzaehlung(d.formate, f)}
              </option>
            ))}
          </Auswahl>
          {lokal ? <Hinweis variante="fehler">{lokal}</Hinweis> : null}
          <FehlerHinweis fehler={importieren.error} />
          {fehlerZeilen.length > 0 ? (
            <>
              <h3 className="app-gruppen-titel">{d.fehlerTitel(anzahlFehler)}</h3>
              <Tabelle
                beschriftung={d.fehlerTitel(anzahlFehler)}
                spalten={[
                  { schluessel: "zeile", kopf: d.fehlerSpalten.zeile, zahl: true, zelle: (f: ImportFehler) => String(f.zeile) },
                  { schluessel: "feld", kopf: d.fehlerSpalten.feld, zelle: (f) => f.feld },
                  { schluessel: "meldung", kopf: d.fehlerSpalten.meldung, umbruch: true, zelle: (f) => f.meldung },
                ]}
                zeilen={fehlerZeilen}
                zeilenSchluessel={(f) => `${f.zeile}-${f.feld}-${f.meldung}`}
              />
            </>
          ) : null}
          {ergebnis ? <Hinweis>{ergebnis.nurGeprueft ? d.geprueft(ergebnis.zeilen) : d.uebernommen(ergebnis.zeilen, ergebnis.angelegt, ergebnis.unveraendert, ergebnis.ereignisse)}</Hinweis> : null}
          <div className="app-aktionen__knoepfe">
            <Button variante="sekundaer" disabled={importieren.isPending} onClick={() => senden(true)}>
              {d.pruefen}
            </Button>
            <Button disabled={importieren.isPending} onClick={() => senden(false)}>
              {d.importieren}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function SucheKarte() {
  const t = useT();
  const s = t.register.uebersicht.suche;
  const status = useQuery(registerStatus());
  const [firma, setFirma] = useState("");
  const [nummer, setNummer] = useState("");
  const [frage, setFrage] = useState<{ firma?: string; nummer?: string } | null>(null);
  const [lokal, setLokal] = useState<string | null>(null);
  const treffer = useQuery({ ...registerSuche(frage ?? {}), enabled: frage !== null && Boolean(status.data?.anbieterEingerichtet) });

  const spalten: TabelleSpalte<RegisterTreffer>[] = [
    { schluessel: "firma", kopf: s.spalten.firma, zelle: (x) => x.firma },
    { schluessel: "register", kopf: s.spalten.register, zelle: (x) => `${x.gericht}, ${x.registerart} ${x.nummer}` },
    { schluessel: "sitz", kopf: s.spalten.sitz, zelle: (x) => x.sitz ?? t.gemeinsam.keinWert },
    { schluessel: "rechtsform", kopf: s.spalten.rechtsform, zelle: (x) => x.rechtsform ?? t.gemeinsam.keinWert },
  ];

  return (
    <section className="app-karte" aria-labelledby="register-suche-titel">
      <h2 id="register-suche-titel" className="cw-t-untertitel app-karte__titel">
        {s.titel}
      </h2>
      {status.isPending ? (
        <Skelettzeilen anzahl={2} />
      ) : status.error ? (
        <FehlerHinweis fehler={status.error} />
      ) : !status.data.anbieterEingerichtet ? (
        <Hinweis>{s.keinAnbieter}</Hinweis>
      ) : (
        <form
          className="app-formular"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const f = firma.trim();
            const n = nummer.trim();
            if (f === "" && n === "") return setLokal(s.eingabe);
            setLokal(null);
            setFrage({ ...(f ? { firma: f } : {}), ...(n ? { nummer: n } : {}) });
          }}
        >
          {status.data.anbieter ? <p className="app-leer-text">{s.anbieter(status.data.anbieter)}</p> : null}
          <Feld label={s.firma} value={firma} onChange={(e) => setFirma(e.target.value)} />
          <Feld label={s.nummer} value={nummer} onChange={(e) => setNummer(e.target.value)} />
          {lokal ? <Hinweis variante="fehler">{lokal}</Hinweis> : null}
          <FehlerHinweis fehler={treffer.error} />
          <div>
            <Button type="submit" disabled={treffer.isFetching}>
              {s.suchen}
            </Button>
          </div>
          {treffer.data && treffer.data.length === 0 ? <p className="app-leer-text">{s.keineTreffer}</p> : null}
          {treffer.data && treffer.data.length > 0 ? <Tabelle beschriftung={s.titel} spalten={spalten} zeilen={treffer.data} zeilenSchluessel={(x) => `${x.gericht}|${x.registerart}|${x.nummer}`} /> : null}
        </form>
      )}
    </section>
  );
}
