import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Feld, Hinweis, Kennwerte, Status, Tabelle, type TabelleSpalte } from "@carraway/ui";
import {
  passwortAendern,
  sicherheitEntwerten,
  sicherheitUebersicht,
  sitzungenListe,
  useAndereSitzungenBeenden,
  useSitzungBeenden,
  wiederherstellungscodesErneuern,
  type Sicherheit,
  type Sitzung,
} from "../api/sicherheit";
import { MINDESTLAENGE_PASSWORT } from "../lib/passwort";
import { geraetAus } from "../lib/geraet";
import { formatZeitpunkt } from "../lib/zeit";
import { useSprache, useT } from "../i18n";
import { FehlerHinweis } from "./FehlerHinweis";
import { Skelettzeilen } from "./Skelett";
import { useAnmeldeschritt } from "./anmeldeschritt";
import { CodeListe, ZweiFaktorAblauf } from "./ZweiFaktorAblauf";

/** Die Karten der Seite „Sicherheit“: Übersicht mit Kennwerten, Passwort, zweiter Faktor, aktive Anmeldungen. */
export default function SicherheitKarten() {
  const { data, error, isPending } = useQuery(sicherheitUebersicht());
  return (
    <>
      <FehlerHinweis fehler={error} />
      {isPending ? <Skelettzeilen anzahl={3} /> : null}
      {data ? (
        <>
          <UebersichtKarte daten={data} />
          <PasswortKarte daten={data} />
          <ZweiFaktorKarte daten={data} />
          <SitzungenKarte />
        </>
      ) : null}
    </>
  );
}

function UebersichtKarte({ daten }: { daten: Sicherheit }) {
  const t = useT();
  const sprache = useSprache();
  const u = t.anmeldung.sicherheit.uebersicht;
  return (
    <section className="app-karte" aria-labelledby="sich-uebersicht">
      <h2 id="sich-uebersicht" className="cw-t-untertitel app-karte__titel">
        {u.titel}
      </h2>
      <Kennwerte
        gruppen={[
          {
            id: "zugang",
            eintraege: [
              {
                id: "pw",
                label: u.passwort,
                wert: daten.passwortVorhanden ? u.passwortVorhanden : u.passwortKein,
                ...(daten.passwortGeaendertAm ? { hinweis: u.passwortGeaendert(formatZeitpunkt(daten.passwortGeaendertAm, sprache)) } : {}),
                ruhig: !daten.passwortVorhanden,
              },
              { id: "zf", label: u.zweiFaktor, wert: daten.zweiFaktorAktiv ? u.zweiFaktorAn : u.zweiFaktorAus, ruhig: !daten.zweiFaktorAktiv },
              { id: "codes", label: u.codes, wert: daten.codesUebrig === null ? t.gemeinsam.keinWert : u.codesUebrig(daten.codesUebrig), ruhig: daten.codesUebrig === null },
              { id: "sitz", label: u.sitzungen, wert: String(daten.sitzungenAnzahl) },
              ...(daten.anbieter.length > 0 ? [{ id: "anbieter", label: u.anbieter, wert: daten.anbieter.join(", ") }] : []),
            ],
          },
        ]}
      />
    </section>
  );
}

function PasswortKarte({ daten }: { daten: Sicherheit }) {
  const t = useT();
  const p = t.anmeldung.sicherheit.passwort;
  const qc = useQueryClient();
  const [werte, setWerte] = useState({ aktuell: "", neu: "", wiederholt: "" });
  const [andere, setAndere] = useState(true);
  const [versucht, setVersucht] = useState(false);
  const [fertig, setFertig] = useState<number | null>(null);
  const { laeuft, fehler, ausfuehren } = useAnmeldeschritt();
  const zuKurz = werte.neu.length < MINDESTLAENGE_PASSWORT;
  const ungleich = werte.neu !== werte.wiederholt;
  const gleich = werte.neu !== "" && werte.neu === werte.aktuell;

  function speichern(e: FormEvent) {
    e.preventDefault();
    setVersucht(true);
    setFertig(null);
    if (zuKurz || ungleich || gleich) return;
    void ausfuehren(async () => {
      const antwort = await passwortAendern({ aktuell: werte.aktuell, neu: werte.neu, andereSitzungenBeenden: andere });
      setWerte({ aktuell: "", neu: "", wiederholt: "" });
      setVersucht(false);
      setFertig(antwort.otherSessionsEnded);
      await sicherheitEntwerten(qc);
    });
  }

  return (
    <section className="app-karte" aria-labelledby="sich-passwort">
      <h2 id="sich-passwort" className="cw-t-untertitel app-karte__titel">
        {p.titel}
      </h2>
      {!daten.passwortVorhanden ? (
        <p className="app-leer-text">{p.keinPasswort}</p>
      ) : (
        <form className="app-formular" onSubmit={speichern} noValidate>
          <p className="app-leer-text">{p.einleitung}</p>
          <FehlerHinweis fehler={fehler} />
          <Feld zugang label={p.aktuell} name="pw-aktuell" type="password" value={werte.aktuell} onChange={(e) => setWerte((w) => ({ ...w, aktuell: e.target.value }))} autoComplete="current-password" required />
          <Feld zugang
            label={p.neu}
            hilfe={p.neuHilfe(MINDESTLAENGE_PASSWORT)}
            fehler={versucht && zuKurz ? p.zuKurz(MINDESTLAENGE_PASSWORT) : versucht && gleich ? p.gleich : undefined}
            name="pw-neu"
            type="password"
            value={werte.neu}
            onChange={(e) => setWerte((w) => ({ ...w, neu: e.target.value }))}
            autoComplete="new-password"
            required
          />
          <Feld zugang label={p.wiederholt} fehler={versucht && ungleich ? p.ungleich : undefined} name="pw-wiederholt" type="password" value={werte.wiederholt} onChange={(e) => setWerte((w) => ({ ...w, wiederholt: e.target.value }))} autoComplete="new-password" required />
          <label className="app-haken">
            <input type="checkbox" checked={andere} onChange={(e) => setAndere(e.target.checked)} />
            <span>
              {p.andere}
              <span className="app-leer-text"> {p.andereHilfe}</span>
            </span>
          </label>
          <div className="app-aktionen__knoepfe">
            <Button type="submit" disabled={laeuft || werte.aktuell === "" || werte.neu === ""}>
              {p.speichern}
            </Button>
          </div>
          <p role="status">{fertig !== null ? p.gespeichertAndere(fertig) : ""}</p>
        </form>
      )}
    </section>
  );
}

type Zweig = null | "erst" | "neu" | "codes";

function ZweiFaktorKarte({ daten }: { daten: Sicherheit }) {
  const t = useT();
  const z = t.anmeldung.sicherheit.zweiFaktor;
  const [zweig, setZweig] = useState<Zweig>(null);
  const [fertig, setFertig] = useState(false);
  const schliessen = () => setZweig(null);
  return (
    <section className="app-karte" aria-labelledby="sich-zf">
      <div className="app-karte__kopf">
        <h2 id="sich-zf" className="cw-t-untertitel app-karte__titel">
          {z.titel}
        </h2>
        <Status variante={daten.zweiFaktorAktiv ? "freigegeben" : "fehlt"}>{daten.zweiFaktorAktiv ? t.anmeldung.sicherheit.uebersicht.zweiFaktorAn : t.anmeldung.sicherheit.uebersicht.zweiFaktorAus}</Status>
      </div>
      {zweig === null ? (
        <div className="app-formular">
          <p className="app-leer-text">{z.einleitung}</p>
          {daten.zweiFaktorPflicht ? <p className="app-leer-text">{z.pflicht}</p> : null}
          {fertig ? <Hinweis>{z.fertig}</Hinweis> : null}
          <div className="app-aktionen__knoepfe">
            {daten.zweiFaktorAktiv ? (
              <>
                <Button variante="sekundaer" onClick={() => { setFertig(false); setZweig("neu"); }}>
                  {z.neu}
                </Button>
                <Button variante="sekundaer" onClick={() => { setFertig(false); setZweig("codes"); }}>
                  {z.codesErneuern}
                </Button>
              </>
            ) : (
              <Button onClick={() => setZweig("erst")}>{z.einrichten}</Button>
            )}
          </div>
        </div>
      ) : null}
      {zweig === "erst" || zweig === "neu" ? (
        <ZweiFaktorAblauf
          modus={zweig}
          passwortNoetig={daten.passwortVorhanden}
          onAbbrechen={schliessen}
          onFertig={() => {
            setFertig(true);
            schliessen();
          }}
        />
      ) : null}
      {zweig === "codes" ? <CodesErneuern passwortNoetig={daten.passwortVorhanden} onSchliessen={schliessen} /> : null}
    </section>
  );
}

function CodesErneuern({ passwortNoetig, onSchliessen }: { passwortNoetig: boolean; onSchliessen: () => void }) {
  const z = useT().anmeldung.sicherheit.zweiFaktor;
  const qc = useQueryClient();
  const [passwort, setPasswort] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const { laeuft, fehler, ausfuehren } = useAnmeldeschritt();
  function erzeugen(e: FormEvent) {
    e.preventDefault();
    void ausfuehren(async () => {
      setCodes(await wiederherstellungscodesErneuern(passwort, qc));
      setPasswort("");
    });
  }
  if (codes) {
    return (
      <div className="app-formular">
        <Hinweis titel={z.codesTitel}>{z.codesText}</Hinweis>
        <CodeListe codes={codes} beschriftung={z.codesTitel} />
        <p role="status" className="app-leer-text">
          {z.codesFertig}
        </p>
        <div className="app-aktionen__knoepfe">
          <Button onClick={onSchliessen}>{z.schliessen}</Button>
        </div>
      </div>
    );
  }
  return (
    <form className="app-formular" onSubmit={erzeugen} noValidate>
      <p className="app-leer-text">{z.codesErneuernEinleitung}</p>
      <FehlerHinweis fehler={fehler} />
      {passwortNoetig ? <Feld zugang label={z.passwort} name="codes-passwort" type="password" value={passwort} onChange={(e) => setPasswort(e.target.value)} autoComplete="current-password" required autoFocus /> : null}
      <div className="app-aktionen__knoepfe">
        <Button type="submit" disabled={laeuft || (passwortNoetig && passwort === "")}>
          {z.codesErzeugen}
        </Button>
        <Button variante="ruhig" onClick={onSchliessen}>
          {z.abbrechen}
        </Button>
      </div>
    </form>
  );
}

function SitzungenKarte() {
  const t = useT();
  const sprache = useSprache();
  const s = t.anmeldung.sicherheit.sitzungen;
  const { data, error, isPending } = useQuery(sitzungenListe());
  const beenden = useSitzungBeenden();
  const andereBeenden = useAndereSitzungenBeenden();
  const [sicher, setSicher] = useState<string | null>(null);
  const [alleSicher, setAlleSicher] = useState(false);
  const name = (x: Sitzung) => {
    const g = geraetAus(x.geraet);
    return g ? s.geraetWert(g.browser, g.system) : s.unbekannt;
  };
  const andere = (data ?? []).filter((x) => !x.aktuell).length;

  const spalten: TabelleSpalte<Sitzung>[] = [
    {
      schluessel: "geraet",
      kopf: s.spalten.geraet,
      zelle: (x) => (
        <>
          {name(x)} {x.aktuell ? <Status variante="freigegeben">{s.aktuell}</Status> : null}
        </>
      ),
    },
    { schluessel: "adresse", kopf: s.spalten.adresse, zelle: (x) => x.ip ?? t.gemeinsam.keinWert },
    { schluessel: "angemeldet", kopf: s.spalten.angemeldet, zelle: (x) => formatZeitpunkt(x.erstelltAm, sprache) },
    { schluessel: "aktiv", kopf: s.spalten.aktiv, zelle: (x) => formatZeitpunkt(x.zuletztAktivAm, sprache) },
    {
      schluessel: "aktion",
      kopf: <span className="cw-nur-lesen">{s.spalten.aktion}</span>,
      zelle: (x) =>
        x.aktuell ? null : sicher === x.id ? (
          <span className="app-knoepfe">
            <Button variante="gefahr" disabled={beenden.isPending} aria-label={s.beendenFuer(name(x))} onClick={() => beenden.mutate(x.id, { onSettled: () => setSicher(null) })}>
              {s.endgueltig}
            </Button>
            <Button variante="ruhig" onClick={() => setSicher(null)}>
              {s.abbrechen}
            </Button>
          </span>
        ) : (
          <Button variante="sekundaer" aria-label={s.beendenFuer(name(x))} onClick={() => setSicher(x.id)}>
            {s.beenden}
          </Button>
        ),
    },
  ];

  return (
    <section className="app-karte" aria-labelledby="sich-sitzungen">
      <div className="app-karte__kopf">
        <h2 id="sich-sitzungen" className="cw-t-untertitel app-karte__titel">
          {s.titel}
        </h2>
        {andere > 0 ? (
          alleSicher ? (
            <span className="app-knoepfe">
              <Button variante="gefahr" disabled={andereBeenden.isPending} onClick={() => andereBeenden.mutate(undefined, { onSettled: () => setAlleSicher(false) })}>
                {s.andereBestaetigen}
              </Button>
              <Button variante="ruhig" onClick={() => setAlleSicher(false)}>
                {s.abbrechen}
              </Button>
            </span>
          ) : (
            <Button variante="sekundaer" onClick={() => setAlleSicher(true)}>
              {s.andereBeenden}
            </Button>
          )
        ) : null}
      </div>
      <p className="app-leer-text">{s.einleitung}</p>
      <FehlerHinweis fehler={error ?? beenden.error ?? andereBeenden.error} />
      {isPending ? <Skelettzeilen anzahl={2} /> : null}
      {data && data.length === 0 ? <p className="app-leer-text">{s.keine}</p> : null}
      {data && data.length > 0 ? <Tabelle beschriftung={s.titel} spalten={spalten} zeilen={data} zeilenSchluessel={(x) => x.id} /> : null}
    </section>
  );
}
