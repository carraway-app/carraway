import { useState, type ReactNode } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Auswahl, Button, Feld, Hinweis, SortierbareListe, Tabelle } from "@carraway/ui";
import { fondsUebersicht } from "../api/abfragen";
import {
  BUCHUNGSQUELLEN,
  buchungsregeln,
  gliederung,
  konten,
  SACHKONTOARTEN,
  SICHTEN,
  useBuchungsregelSetzen,
  useGliederungSetzen,
  useKontoEntfernen,
  useKontoSetzen,
  type Buchungsquelle,
  type Buchungsregel,
  type GliederungEingabe,
  type SachkontoArt,
} from "../api/buchhaltung";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { feldText } from "../i18n/fehler";
import { aufzaehlung, useSprache, useT } from "../i18n";

/**
 * Stammdaten der Buchhaltung zum Bearbeiten (Etappe 14): Sachkonten, Gliederung je Sicht und Kontenzuordnung des Exports.
 * Die Prüfungen liegen beim Server; die Oberfläche zeigt seine Fehler. Ändern darf die Rolle Verwalter des Fonds.
 */

const SCHLUESSEL_FORMAT = /^[a-z][a-z0-9_.]{0,59}$/;

// Sachkonten --------------------------------------------------------------------------------------------------------------

interface KontoFormular {
  nummer: string;
  bezeichnung: string;
  art: SachkontoArt;
  beteiligungId: string;
}
const LEERES_KONTO: KontoFormular = { nummer: "", bezeichnung: "", art: "aktiv", beteiligungId: "" };

export function KontenKarte({ fondsId, aenderbar }: { fondsId: string; aenderbar: boolean }) {
  const t = useT();
  const e = t.buchhaltung.einstellungen;
  const k = e.sachkonten;
  const { data } = useSuspenseQuery(konten(fondsId));
  const { data: uebersicht } = useSuspenseQuery(fondsUebersicht(fondsId));
  const setzen = useKontoSetzen(fondsId);
  const entfernen = useKontoEntfernen(fondsId);
  const [form, setForm] = useState<KontoFormular | null>(null);
  const [bearbeitet, setBearbeitet] = useState<string | null>(null);
  const [frage, setFrage] = useState<string | null>(null);
  const beteiligungen = uebersicht.beteiligungen;
  const beteiligungName = (id: string | null) => (id ? (beteiligungen.find((b) => b.id === id)?.organisation.name ?? id) : "");

  function oeffne(konto: KontoFormular, nummer: string | null) {
    setzen.reset();
    entfernen.reset();
    setFrage(null);
    setBearbeitet(nummer);
    setForm(konto);
  }

  return (
    <section className="app-karte" aria-label={k.region}>
      <h3 className="app-gruppen-titel">{e.kontenrahmen}</h3>
      {aenderbar ? <p className="app-leer-text">{k.hilfe}</p> : null}
      {data.length === 0 ? (
        <p className="app-leer-text">{e.keineKonten}</p>
      ) : (
        <Tabelle
          beschriftung={e.kontenrahmen}
          spalten={[
            { schluessel: "nr", kopf: e.kontoSpalten.nummer, zelle: (z: (typeof data)[number]) => z.nummer },
            { schluessel: "bez", kopf: e.kontoSpalten.bezeichnung, zelle: (z) => z.bezeichnung },
            { schluessel: "art", kopf: e.kontoSpalten.art, zelle: (z) => aufzaehlung(e.kontoArt, z.art) },
            { schluessel: "bet", kopf: k.beteiligung, zelle: (z) => beteiligungName(z.beteiligungId) },
            ...(aenderbar
              ? [
                  {
                    schluessel: "aktion",
                    kopf: k.aktion,
                    zelle: (z: (typeof data)[number]) => (
                      <span className="app-aktionen__knoepfe">
                        <Button variante="ruhig" aria-label={k.bearbeiten(z.nummer)} onClick={() => oeffne({ nummer: z.nummer, bezeichnung: z.bezeichnung, art: z.art as SachkontoArt, beteiligungId: z.beteiligungId ?? "" }, z.nummer)}>
                          {k.bearbeitenKurz}
                        </Button>
                        <Button
                          variante="ruhig"
                          aria-label={k.entfernen(z.nummer)}
                          onClick={() => {
                            setzen.reset();
                            entfernen.reset();
                            setFrage(z.nummer);
                          }}
                        >
                          {k.entfernenKurz}
                        </Button>
                      </span>
                    ),
                  },
                ]
              : []),
          ]}
          zeilen={data}
          zeilenSchluessel={(z) => z.id}
        />
      )}
      {frage ? (
        <Hinweis titel={k.entfernenFrage(frage)}>
          <span className="app-aktionen__knoepfe">
            <Button
              disabled={entfernen.isPending}
              onClick={() => entfernen.mutate(frage, { onSuccess: () => setFrage(null) })}
            >
              {k.entfernenBestaetigen(frage)}
            </Button>
            <Button variante="sekundaer" onClick={() => setFrage(null)}>
              {k.abbrechen}
            </Button>
          </span>
        </Hinweis>
      ) : null}
      <FehlerHinweis fehler={entfernen.error} />
      {entfernen.isSuccess && !frage ? <Hinweis>{k.entfernt}</Hinweis> : null}
      {aenderbar ? (
        form ? (
          <form
            className="app-formular"
            noValidate
            aria-label={bearbeitet ? k.bearbeiten(bearbeitet) : k.neu}
            onSubmit={(ev) => {
              ev.preventDefault();
              setzen.mutate({ nummer: form.nummer.trim(), bezeichnung: form.bezeichnung.trim(), art: form.art, beteiligungId: form.beteiligungId === "" ? null : form.beteiligungId }, { onSuccess: () => setForm(null) });
            }}
          >
            <h4 className="app-gruppen-titel">{bearbeitet ? k.bearbeiten(bearbeitet) : k.neu}</h4>
            <FehlerHinweis fehler={setzen.error} bekannt={["konten"]} />
            <Feld label={e.kontoSpalten.nummer} inputMode="numeric" value={form.nummer} disabled={bearbeitet !== null} onChange={(ev) => setForm({ ...form, nummer: ev.target.value })} fehler={feldText(t, setzen.error, "konten.0.nummer")} />
            <Feld label={e.kontoSpalten.bezeichnung} value={form.bezeichnung} onChange={(ev) => setForm({ ...form, bezeichnung: ev.target.value })} fehler={feldText(t, setzen.error, "konten.0.bezeichnung")} />
            <Auswahl label={e.kontoSpalten.art} value={form.art} onChange={(ev) => setForm({ ...form, art: ev.target.value as SachkontoArt })}>
              {SACHKONTOARTEN.map((a) => (
                <option key={a} value={a}>
                  {aufzaehlung(e.kontoArt, a)}
                </option>
              ))}
            </Auswahl>
            <Auswahl label={k.beteiligung} value={form.beteiligungId} onChange={(ev) => setForm({ ...form, beteiligungId: ev.target.value })}>
              <option value="">{k.ohneBeteiligung}</option>
              {beteiligungen.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.organisation.name}
                </option>
              ))}
            </Auswahl>
            <div className="app-aktionen__knoepfe">
              <Button type="submit" disabled={setzen.isPending || form.nummer.trim() === "" || form.bezeichnung.trim() === ""}>
                {k.speichern}
              </Button>
              <Button type="button" variante="sekundaer" onClick={() => setForm(null)}>
                {k.abbrechen}
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button variante="sekundaer" onClick={() => oeffne(LEERES_KONTO, null)}>
              {k.neu}
            </Button>
            {setzen.isSuccess ? <Hinweis>{k.gespeichert}</Hinweis> : null}
          </div>
        )
      ) : null}
    </section>
  );
}

// Gliederung ---------------------------------------------------------------------------------------------------------------

interface PositionFormular {
  /** `null` = neue Position; sonst der Schlüssel der bearbeiteten (der Schlüssel bleibt dann fest). */
  bearbeitet: string | null;
  schluessel: string;
  bezeichnungDe: string;
  bezeichnungEn: string;
  seite: "soll" | "haben";
  eltern: string;
}

/** Alle Nachkommen einer Position (für die Wahl der Oberposition: nie sich selbst oder einen Nachkommen). */
function nachkommen(positionen: GliederungEingabe[], schluessel: string): Set<string> {
  const menge = new Set<string>([schluessel]);
  let geaendert = true;
  while (geaendert) {
    geaendert = false;
    for (const p of positionen) {
      if (p.elternSchluessel !== null && menge.has(p.elternSchluessel) && !menge.has(p.schluessel)) {
        menge.add(p.schluessel);
        geaendert = true;
      }
    }
  }
  return menge;
}

/** Ersetzt die Geschwister einer Oberposition durch ihre neue Reihenfolge; sie behalten die Plätze, die sie in der Gliederung schon einnahmen. */
function ordneGeschwister(positionen: GliederungEingabe[], eltern: string | null, neu: GliederungEingabe[]): GliederungEingabe[] {
  const folge = [...neu];
  return positionen.map((p) => (p.elternSchluessel === eltern ? (folge.shift() ?? p) : p));
}

export function GliederungEditor({ fondsId }: { fondsId: string }) {
  const t = useT();
  const e = t.buchhaltung.einstellungen;
  const g = e.gliederungEditor;
  const [sicht, setSicht] = useState<(typeof SICHTEN)[number]>("bilanz");
  return (
    <section className="app-karte" aria-label={g.titel}>
      <h3 className="app-gruppen-titel">{g.titel}</h3>
      <p className="app-leer-text">{g.hilfe}</p>
      <Auswahl label={g.sicht} value={sicht} onChange={(ev) => setSicht(ev.target.value as (typeof SICHTEN)[number])}>
        {SICHTEN.map((s) => (
          <option key={s} value={s}>
            {aufzaehlung(t.buchhaltung.sichten, s)}
          </option>
        ))}
      </Auswahl>
      <SichtEditor key={sicht} fondsId={fondsId} sicht={sicht} />
    </section>
  );
}

function SichtEditor({ fondsId, sicht }: { fondsId: string; sicht: (typeof SICHTEN)[number] }) {
  const t = useT();
  const sprache = useSprache();
  const g = t.buchhaltung.einstellungen.gliederungEditor;
  const { data } = useSuspenseQuery(gliederung(fondsId));
  const setzen = useGliederungSetzen(fondsId, sicht);
  const gespeichert: GliederungEingabe[] = data
    .filter((p) => p.sicht === sicht)
    .map((p) => ({ schluessel: p.schluessel, elternSchluessel: p.elternSchluessel, bezeichnungDe: p.bezeichnungDe, bezeichnungEn: p.bezeichnungEn, seite: p.seite as "soll" | "haben" }));
  const [positionen, setPositionen] = useState<GliederungEingabe[]>(gespeichert);
  const [form, setForm] = useState<PositionFormular | null>(null);
  const [lokal, setLokal] = useState<string | null>(null);
  const geaendert = JSON.stringify(positionen) !== JSON.stringify(gespeichert);
  const name = (p: GliederungEingabe) => (sprache === "de" ? p.bezeichnungDe : p.bezeichnungEn);

  function neuePosition(eltern: string | null) {
    setLokal(null);
    setForm({ bearbeitet: null, schluessel: "", bezeichnungDe: "", bezeichnungEn: "", seite: eltern ? (positionen.find((p) => p.schluessel === eltern)?.seite ?? "soll") : "soll", eltern: eltern ?? "" });
  }
  function bearbeite(p: GliederungEingabe) {
    setLokal(null);
    setForm({ bearbeitet: p.schluessel, schluessel: p.schluessel, bezeichnungDe: p.bezeichnungDe, bezeichnungEn: p.bezeichnungEn, seite: p.seite, eltern: p.elternSchluessel ?? "" });
  }
  function uebernehmen() {
    if (!form) return;
    const schluessel = form.schluessel.trim();
    const de = form.bezeichnungDe.trim();
    const en = form.bezeichnungEn.trim();
    if (schluessel === "" || de === "" || en === "") return setLokal(g.pflicht);
    if (!SCHLUESSEL_FORMAT.test(schluessel)) return setLokal(g.schluesselFormat);
    if (form.bearbeitet === null && positionen.some((p) => p.schluessel === schluessel)) return setLokal(g.schluesselDoppelt);
    const eintrag: GliederungEingabe = { schluessel, elternSchluessel: form.eltern === "" ? null : form.eltern, bezeichnungDe: de, bezeichnungEn: en, seite: form.seite };
    setLokal(null);
    setzen.reset();
    if (form.bearbeitet === null) {
      // Neue Position: direkt hinter die letzte Position derselben Oberposition (sonst ans Ende).
      const kopie = [...positionen];
      const geschwister = kopie.filter((p) => p.elternSchluessel === eintrag.elternSchluessel);
      const nach = geschwister.at(-1);
      kopie.splice(nach ? kopie.indexOf(nach) + 1 : kopie.length, 0, eintrag);
      setPositionen(kopie);
    } else {
      setPositionen(positionen.map((p) => (p.schluessel === form.bearbeitet ? eintrag : p)));
    }
    setForm(null);
  }
  function entferne(p: GliederungEingabe) {
    setzen.reset();
    setPositionen(positionen.filter((x) => x.schluessel !== p.schluessel));
  }

  const baum = (eltern: string | null, tiefe: number): ReactNode => (
    <SortierbareListe
      className="app-baum"
      aria-label={eltern === null ? g.baum : name(positionen.find((p) => p.schluessel === eltern)!)}
      eintraege={positionen.filter((p) => p.elternSchluessel === eltern)}
      schluessel={(p) => p.schluessel}
      name={name}
      onAendern={(neu) => {
        setzen.reset();
        setPositionen(ordneGeschwister(positionen, eltern, neu));
      }}
      texte={{ griff: g.griff, hinweis: g.bedienung, aufgenommen: g.aufgenommen, verschoben: g.verschoben, abgelegt: g.abgelegt, abgebrochen: g.abgebrochen }}
      zeile={(p) => {
        const hatKinder = positionen.some((x) => x.elternSchluessel === p.schluessel);
        return (
          <div className="app-baum__eintrag">
            <div className="app-reihenfolge">
              <span>
                {name(p)} <span className="app-leer-text">({p.schluessel}, {aufzaehlung(g.seiten, p.seite)})</span>
              </span>
              <span className="app-aktionen__knoepfe">
                <Button variante="ruhig" aria-label={g.unterposition(name(p))} onClick={() => neuePosition(p.schluessel)}>
                  +
                </Button>
                <Button variante="ruhig" aria-label={g.bearbeiten(name(p))} onClick={() => bearbeite(p)}>
                  {g.bearbeitenKurz}
                </Button>
                <Button variante="ruhig" disabled={hatKinder} title={hatKinder ? g.entfernenGesperrt : undefined} aria-label={g.entfernen(name(p))} onClick={() => entferne(p)}>
                  ×
                </Button>
              </span>
            </div>
            {hatKinder ? <div style={{ paddingInlineStart: `${tiefe + 1}rem` }}>{baum(p.schluessel, tiefe + 1)}</div> : null}
          </div>
        );
      }}
    />
  );

  const waehlbareEltern = form?.bearbeitet ? nachkommen(positionen, form.bearbeitet) : new Set<string>();

  return (
    <>
      {positionen.length === 0 ? <p className="app-leer-text">{g.keine}</p> : baum(null, 0)}
      {form ? (
        <form
          className="app-formular"
          noValidate
          aria-label={form.bearbeitet ? g.bearbeiten(form.bearbeitet) : g.neu}
          onSubmit={(ev) => {
            ev.preventDefault();
            uebernehmen();
          }}
        >
          {lokal ? <Hinweis variante="fehler">{lokal}</Hinweis> : null}
          <Feld label={g.schluessel} hilfe={g.schluesselHilfe} value={form.schluessel} disabled={form.bearbeitet !== null} onChange={(ev) => setForm({ ...form, schluessel: ev.target.value })} />
          <Feld label={t.buchhaltung.einstellungen.bezeichnungDe} value={form.bezeichnungDe} onChange={(ev) => setForm({ ...form, bezeichnungDe: ev.target.value })} />
          <Feld label={t.buchhaltung.einstellungen.bezeichnungEn} value={form.bezeichnungEn} onChange={(ev) => setForm({ ...form, bezeichnungEn: ev.target.value })} />
          <Auswahl label={g.seite} value={form.seite} onChange={(ev) => setForm({ ...form, seite: ev.target.value as "soll" | "haben" })}>
            <option value="soll">{g.seiten.soll}</option>
            <option value="haben">{g.seiten.haben}</option>
          </Auswahl>
          <Auswahl label={g.eltern} value={form.eltern} onChange={(ev) => setForm({ ...form, eltern: ev.target.value })}>
            <option value="">{g.obersteEbene}</option>
            {positionen
              .filter((p) => !waehlbareEltern.has(p.schluessel))
              .map((p) => (
                <option key={p.schluessel} value={p.schluessel}>
                  {name(p)}
                </option>
              ))}
          </Auswahl>
          <div className="app-aktionen__knoepfe">
            <Button type="submit">{g.uebernehmen}</Button>
            <Button type="button" variante="sekundaer" onClick={() => setForm(null)}>
              {g.abbrechen}
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button variante="sekundaer" onClick={() => neuePosition(null)}>
            {g.neu}
          </Button>
        </div>
      )}
      <FehlerHinweis fehler={setzen.error} />
      {geaendert ? <p className="app-leer-text">{g.ungespeichert}</p> : null}
      {setzen.isSuccess && !geaendert ? <Hinweis>{g.gespeichert}</Hinweis> : null}
      <div className="app-aktionen__knoepfe">
        <Button
          disabled={setzen.isPending || !geaendert || positionen.length === 0}
          onClick={() => {
            setzen.mutate(positionen);
          }}
        >
          {g.speichern}
        </Button>
        <Button variante="sekundaer" disabled={!geaendert} onClick={() => (setPositionen(gespeichert), setForm(null), setzen.reset())}>
          {g.verwerfen}
        </Button>
      </div>
    </>
  );
}

// Kontenzuordnung des Exports ----------------------------------------------------------------------------------------------

export function BuchungsregelnKarte({ fondsId, aenderbar }: { fondsId: string; aenderbar: boolean }) {
  const t = useT();
  const b = t.buchhaltung.einstellungen.buchungsregeln;
  const { data } = useSuspenseQuery(buchungsregeln(fondsId));
  return (
    <section className="app-karte" aria-label={b.titel}>
      <h3 className="app-gruppen-titel">{b.titel}</h3>
      <p className="app-leer-text">{b.hilfe}</p>
      {BUCHUNGSQUELLEN.map((q) => (
        <BuchungsregelZeile key={`${q}-${data.find((r) => r.quelle === q)?.geaendertAm ?? ""}`} fondsId={fondsId} quelle={q} regel={data.find((r) => r.quelle === q)} aenderbar={aenderbar} />
      ))}
    </section>
  );
}

function BuchungsregelZeile({ fondsId, quelle, regel, aenderbar }: { fondsId: string; quelle: Buchungsquelle; regel: Buchungsregel | undefined; aenderbar: boolean }) {
  const t = useT();
  const b = t.buchhaltung.einstellungen.buchungsregeln;
  const e = t.buchhaltung.einstellungen;
  const setzen = useBuchungsregelSetzen(fondsId, quelle);
  const [w, setW] = useState({ konto: regel?.konto ?? "", gegenkonto: regel?.gegenkonto ?? "", richtung: (regel?.richtung ?? "S") as "S" | "H", buSchluessel: regel?.buSchluessel ?? "", buchungstext: regel?.buchungstext ?? "" });
  const name = aufzaehlung(b.quellen, quelle);
  return (
    <form
      className="app-formular"
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault();
        setzen.mutate({ konto: w.konto.trim(), gegenkonto: w.gegenkonto.trim(), richtung: w.richtung, buSchluessel: w.buSchluessel.trim() === "" ? null : w.buSchluessel.trim(), buchungstext: w.buchungstext.trim() });
      }}
    >
      <fieldset className="app-kz-auswahl" disabled={!aenderbar}>
        <legend>{`${name}${regel ? "" : ` (${b.nochNicht})`}`}</legend>
        <FehlerHinweis fehler={setzen.error} bekannt={["konto", "gegenkonto", "buSchluessel", "buchungstext"]} />
        <Feld label={`${b.konto}: ${name}`} inputMode="numeric" value={w.konto} onChange={(ev) => setW({ ...w, konto: ev.target.value })} fehler={feldText(t, setzen.error, "konto")} />
        <Feld label={`${b.gegenkonto}: ${name}`} inputMode="numeric" value={w.gegenkonto} onChange={(ev) => setW({ ...w, gegenkonto: ev.target.value })} fehler={feldText(t, setzen.error, "gegenkonto")} />
        <Auswahl label={`${b.richtung}: ${name}`} value={w.richtung} onChange={(ev) => setW({ ...w, richtung: ev.target.value as "S" | "H" })}>
          <option value="S">{b.richtungen.S}</option>
          <option value="H">{b.richtungen.H}</option>
        </Auswahl>
        <Feld label={`${b.buSchluessel}: ${name}`} inputMode="numeric" value={w.buSchluessel} onChange={(ev) => setW({ ...w, buSchluessel: ev.target.value })} fehler={feldText(t, setzen.error, "buSchluessel")} />
        <Feld label={`${b.buchungstext}: ${name}`} value={w.buchungstext} onChange={(ev) => setW({ ...w, buchungstext: ev.target.value })} fehler={feldText(t, setzen.error, "buchungstext")} />
        {setzen.isSuccess ? <Hinweis>{e.gespeichert}</Hinweis> : null}
        {aenderbar ? (
          <div>
            <Button type="submit" disabled={setzen.isPending || w.konto.trim() === "" || w.gegenkonto.trim() === "" || w.buchungstext.trim() === ""}>
              {b.speichern(name)}
            </Button>
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}
