import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Auswahl, Button, Feld, Hinweis, Markdown, Status, Tabelle, Textbereich, formatBetrag, formatDatum, type TabelleSpalte } from "@carraway/ui";
import {
  registerHinweise,
  registerMeldungen,
  registerOrganisation,
  useBeobachtung,
  useEintragErfassen,
  useEreignisErfassen,
  useEreignisErledigen,
  useMeldungGelesen,
  useRegisterAbruf,
  useUebernehmen,
  type RegisterDaten,
  type RegisterHinweis,
} from "../api/register";
import { dokumenteZiel } from "../api/dokumente";
import { formatZeitpunkt } from "../lib/zeit";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { useRechte } from "../lib/rechte";
import { FehlerHinweis } from "./FehlerHinweis";

type Eintrag = NonNullable<RegisterDaten["aktuell"]>;
type Person = { name: string; funktion: string; art?: string | null };
type Abweichung = RegisterDaten["abweichungen"][number];
type Ereignis = RegisterDaten["ereignisse"][number];

const REGISTERARTEN = ["HRA", "HRB", "GnR", "PR", "VR"] as const;
const EREIGNISARTEN = ["neueintragung", "aenderung_geschaeftsfuehrung", "kapitalerhoehung", "sitzverlegung", "insolvenz", "loeschung", "sonstiges"] as const;

const personenText = (liste: unknown) => (liste as Person[]).map((p) => `${p.name} (${p.funktion})`).join("; ");

/** Zeilen „Name | Funktion“ als Liste; leere Zeilen entfallen, ohne Funktion bleibt der Name allein stehen. */
function personenAusText(text: string): Person[] {
  return text
    .split("\n")
    .map((z) => z.trim())
    .filter(Boolean)
    .map((z) => {
      const [name, funktion] = z.split("|").map((x) => x.trim());
      return { name: name ?? z, funktion: funktion || "–" };
    });
}

/**
 * Handelsregister am Unternehmen (Etappe 18): aktueller Stand mit Quelle und Auszug, Abgleich mit den Stammdaten und Übernahme je Feld,
 * Hinweise für Beteiligungen, Bekanntmachungen, Verlauf, Beobachtung und Meldungen. Welche Aktionen erscheinen, folgt den Rollen;
 * die API prüft sie erneut.
 */
export function RegisterAbschnitt({ organisationId }: { organisationId: string }) {
  const t = useT();
  const r = t.register;
  const sprache = useSprache();
  const { darf } = useRechte();
  const { data, error, isPending } = useQuery(registerOrganisation(organisationId));
  const meldungen = useQuery(registerMeldungen(organisationId));
  const uebernehmen = useUebernehmen(organisationId);
  const erledigen = useEreignisErledigen(organisationId);
  const beobachtung = useBeobachtung(organisationId);
  const abruf = useRegisterAbruf(organisationId);
  const gelesen = useMeldungGelesen(organisationId);
  const [formular, setFormular] = useState<null | "eintrag" | "ereignis">(null);
  const [meldung, setMeldung] = useState<string | null>(null);
  const schreiben = darf("bearbeiter");
  const quelleText = (quelle: string) => (quelle.startsWith("anbieter:") ? r.quelle.anbieter(quelle.slice(9)) : aufzaehlung(r.quelle as unknown as Record<string, string>, quelle));

  if (isPending) return null;
  if (error || !data) return <FehlerHinweis fehler={error} />;
  const a = data.aktuell;

  const abweichungSpalten: TabelleSpalte<Abweichung>[] = [
    { schluessel: "feld", kopf: r.abweichungen.spalten.feld, zelle: (x) => aufzaehlung(r.abweichungen.felder, x.feld) },
    {
      schluessel: "crm",
      kopf: r.abweichungen.spalten.crm,
      zelle: (x) => (
        <>
          {x.crm ?? t.gemeinsam.keinWert}
          {x.nichtImRegister && x.nichtImRegister.length > 0 ? <>{" · "}<span className="app-leer-text">{r.abweichungen.nichtImRegister(x.nichtImRegister.join(", "))}</span></> : null}
        </>
      ),
    },
    {
      schluessel: "register",
      kopf: r.abweichungen.spalten.register,
      zelle: (x) => (
        <>
          {x.register ?? t.gemeinsam.keinWert}
          {x.fehltImCrm && x.fehltImCrm.length > 0 ? <>{" · "}<span className="app-leer-text">{r.abweichungen.fehltImCrm(x.fehltImCrm.join(", "))}</span></> : null}
          <>{" · "}<span className="app-leer-text">{aufzaehlung(r.abweichungen.codes, x.code)}</span></>
        </>
      ),
    },
    {
      schluessel: "aktion",
      kopf: <span className="cw-nur-lesen">{r.abweichungen.spalten.aktion}</span>,
      zelle: (x) =>
        schreiben ? (
          <Button variante="sekundaer" aria-label={r.abweichungen.uebernehmenFuer(aufzaehlung(r.abweichungen.felder, x.feld))} disabled={uebernehmen.isPending} onClick={() => uebernehmen.mutate([x.feld], { onSuccess: () => setMeldung(r.abweichungen.fertig) })}>
            {r.abweichungen.uebernehmen}
          </Button>
        ) : null,
    },
  ];

  const ereignisSpalten: TabelleSpalte<Ereignis>[] = [
    { schluessel: "datum", kopf: r.ereignisse.spalten.datum, zelle: (e) => formatDatum(e.datum, sprache) },
    { schluessel: "art", kopf: r.ereignisse.spalten.art, zelle: (e) => aufzaehlung(r.ereignisse.art, e.art) },
    { schluessel: "text", kopf: r.ereignisse.spalten.text, umbruch: true, zelle: (e) => <Markdown text={e.text} /> },
    { schluessel: "quelle", kopf: r.ereignisse.spalten.quelle, zelle: (e) => quelleText(e.quelle) },
    {
      schluessel: "status",
      kopf: r.ereignisse.spalten.status,
      zelle: (e) =>
        e.erledigtAm ? (
          <Status variante="freigegeben">{r.ereignisse.erledigt}</Status>
        ) : schreiben ? (
          <Button variante="ruhig" aria-label={r.hinweise.erledigenFuer(e.text)} disabled={erledigen.isPending} onClick={() => erledigen.mutate(e.id)}>
            {r.hinweise.erledigen}
          </Button>
        ) : (
          <Status variante="pruefung">{r.ereignisse.offen}</Status>
        ),
    },
  ];

  return (
    <section className="app-karte" aria-labelledby="abschnitt-register">
      <div className="app-karte__kopf">
        <h2 id="abschnitt-register" className="cw-t-untertitel app-karte__titel">
          {r.titel}
        </h2>
        {schreiben ? (
          <div className="app-aktionen__knoepfe">
            <Button variante="sekundaer" onClick={() => setFormular(formular === "eintrag" ? null : "eintrag")}>
              {r.erfassen}
            </Button>
            {data.anbieterEingerichtet ? (
              <Button variante="sekundaer" disabled={abruf.isPending} onClick={() => abruf.mutate(undefined, { onSuccess: (x) => setMeldung(r.abruf.ergebnis(x.neu, x.ereignisse)) })}>
                {r.abruf.knopf}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <p className="app-leer-text">{r.beschreibung}</p>
      <FehlerHinweis fehler={uebernehmen.error ?? erledigen.error ?? beobachtung.error ?? abruf.error ?? gelesen.error} />
      {meldung ? <Hinweis>{meldung}</Hinweis> : null}

      {formular === "eintrag" ? <EintragFormular organisationId={organisationId} vorbelegt={a} onFertig={(neu) => { setFormular(null); setMeldung(neu ? r.gespeichert : r.unveraendert); }} onAbbrechen={() => setFormular(null)} /> : null}

      {a ? (
        <>
          <h3 className="app-gruppen-titel">
            {r.aktuell} · {r.stand(formatDatum(a.standDatum, sprache))}
          </h3>
          <dl className="app-daten">
            <Zeile label={r.felder.firma} wert={a.firma} />
            <Zeile label={r.felder.registerart} wert={`${a.registerart} ${a.nummer}, ${a.gericht}`} />
            <Zeile label={r.felder.rechtsform} wert={a.rechtsform} />
            <Zeile label={r.felder.sitz} wert={a.sitz} />
            <Zeile label={r.felder.anschrift} wert={a.anschrift} />
            <Zeile label={r.felder.gegenstand} wert={a.gegenstand} />
            <Zeile label={r.felder.kapital} wert={a.kapital === null ? null : formatBetrag(a.kapital, sprache)} />
            <Zeile label={r.felder.vertretung} wert={personenText(a.vertretung) || null} />
            <Zeile label={r.felder.prokura} wert={personenText(a.prokura) || null} />
            <Zeile label={r.felder.quelle} wert={quelleText(a.quelle)} />
            <div>
              <dt>{r.felder.auszug}</dt>
              <dd>{data.auszug ? <Link to="/documents/$id" params={{ id: data.auszug.id }} search={{}}>{r.auszugLink(data.auszug.dateiname)}</Link> : r.auszugKein}</dd>
            </div>
          </dl>

          <h3 className="app-gruppen-titel">{r.abweichungen.titel}</h3>
          {data.abweichungen.length === 0 ? (
            <p className="app-leer-text">{r.abweichungen.keine}</p>
          ) : (
            <>
              <Tabelle beschriftung={r.abweichungen.titel} spalten={abweichungSpalten} zeilen={data.abweichungen} zeilenSchluessel={(x) => x.feld} />
              {schreiben ? <p className="app-leer-text">{r.abweichungen.uebernahmeHinweis}</p> : null}
            </>
          )}
        </>
      ) : (
        <p className="app-leer-text">{r.keinEintrag}</p>
      )}

      {data.hinweise.length > 0 ? (
        <>
          <h3 className="app-gruppen-titel">{r.hinweise.titel}</h3>
          <p className="app-leer-text">{r.hinweise.beschreibung}</p>
          <ul className="app-liste-klein">
            {data.hinweise.map((h) => (
              <li key={`${h.ereignisId}-${h.beteiligungId}`}>
                {r.hinweise.zeile(h.fondsName, aufzaehlung(r.hinweise.art, h.art), formatDatum(h.datum, sprache))} ·{" "}
                {h.aktion === "runde" ? (
                  <Link to="/organizations/$id" params={{ id: organisationId }} hash="runden-titel">
                    {aufzaehlung(r.hinweise.aktion, h.aktion)}
                  </Link>
                ) : (
                  <Link to="/investments/$id" params={{ id: h.beteiligungId }} search={{}} hash={h.aktion === "insolvenz" ? "abschnitt-instrument" : undefined}>
                    {aufzaehlung(r.hinweise.aktion, h.aktion)}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="app-karte__kopf">
        <h3 className="app-gruppen-titel">{r.ereignisse.titel}</h3>
        {schreiben ? (
          <Button variante="ruhig" onClick={() => setFormular(formular === "ereignis" ? null : "ereignis")}>
            {r.ereignisse.erfassen}
          </Button>
        ) : null}
      </div>
      {formular === "ereignis" ? <EreignisFormular organisationId={organisationId} onFertig={() => setFormular(null)} /> : null}
      {data.ereignisse.length === 0 ? <p className="app-leer-text">{r.ereignisse.keine}</p> : <Tabelle beschriftung={r.ereignisse.titel} spalten={ereignisSpalten} zeilen={data.ereignisse} zeilenSchluessel={(e) => e.id} />}

      <h3 className="app-gruppen-titel">{r.historie.titel}</h3>
      {data.historie.length === 0 ? (
        <p className="app-leer-text">{r.historie.keine}</p>
      ) : (
        <Tabelle
          beschriftung={r.historie.titel}
          spalten={[
            { schluessel: "stand", kopf: r.historie.spalten.stand, zelle: (h: Eintrag) => formatDatum(h.standDatum, sprache) },
            { schluessel: "firma", kopf: r.historie.spalten.firma, zelle: (h: Eintrag) => h.firma },
            { schluessel: "sitz", kopf: r.historie.spalten.sitz, zelle: (h: Eintrag) => h.sitz ?? t.gemeinsam.keinWert },
            { schluessel: "quelle", kopf: r.historie.spalten.quelle, zelle: (h: Eintrag) => quelleText(h.quelle) },
            { schluessel: "erfasst", kopf: r.historie.spalten.erfasst, zelle: (h: Eintrag) => formatDatum(h.erfasstAm.slice(0, 10), sprache) },
          ]}
          zeilen={data.historie as Eintrag[]}
          zeilenSchluessel={(h) => h.id}
        />
      )}

      <h3 className="app-gruppen-titel">{r.beobachtung.titel}</h3>
      <label className="app-schalter">
        <input type="checkbox" checked={data.beobachtung.aktiv} disabled={!darf("verwalter") || beobachtung.isPending} onChange={(e) => beobachtung.mutate(e.target.checked)} />
        <span>{r.beobachtung.label}</span>
      </label>
      <p className="app-leer-text">{r.beobachtung.erklaerung}</p>
      {!darf("verwalter") ? <p className="app-leer-text">{r.beobachtung.nurVerwalter}</p> : null}
      {!data.anbieterEingerichtet && !data.monitoringProvider ? <p className="app-leer-text">{r.beobachtung.keinAnbieter}</p> : null}
      <p className="app-leer-text">{data.beobachtung.letztePruefungAm ? r.beobachtung.letztePruefung(formatZeitpunkt(data.beobachtung.letztePruefungAm, sprache), data.beobachtung.letztesErgebnis ?? t.gemeinsam.keinWert) : r.beobachtung.nochNie}</p>

      {meldungen.data && meldungen.data.length > 0 ? (
        <>
          <h3 className="app-gruppen-titel">{r.meldungen.titel}</h3>
          <ul className="app-liste-klein">
            {meldungen.data.map((m) => (
              <li key={m.id}>
                {m.text}{" "}
                {m.gelesenAm ? null : (
                  <Button variante="ruhig" aria-label={r.meldungen.gelesenFuer(m.text)} disabled={gelesen.isPending} onClick={() => gelesen.mutate(m.id)}>
                    {r.meldungen.gelesen}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function Zeile({ label, wert }: { label: string; wert: string | null | undefined }) {
  const t = useT();
  return (
    <div>
      <dt>{label}</dt>
      <dd>{wert ? wert : t.gemeinsam.keinWert}</dd>
    </div>
  );
}

function EintragFormular({ organisationId, vorbelegt, onFertig, onAbbrechen }: { organisationId: string; vorbelegt: Eintrag | null; onFertig: (neu: boolean) => void; onAbbrechen: () => void }) {
  const t = useT();
  const r = t.register;
  const erfassen = useEintragErfassen(organisationId);
  const dokumente = useQuery(dokumenteZiel("organisation", organisationId));
  const [feld, setFeld] = useState({
    gericht: vorbelegt?.gericht ?? "",
    registerart: (vorbelegt?.registerart ?? "HRB") as (typeof REGISTERARTEN)[number],
    nummer: vorbelegt?.nummer ?? "",
    firma: vorbelegt?.firma ?? "",
    rechtsform: vorbelegt?.rechtsform ?? "",
    sitz: vorbelegt?.sitz ?? "",
    anschrift: vorbelegt?.anschrift ?? "",
    kapital: vorbelegt?.kapital ?? "",
    standDatum: "",
    vertretung: ((vorbelegt?.vertretung as Person[] | undefined) ?? []).map((p) => `${p.name} | ${p.funktion}`).join("\n"),
    prokura: ((vorbelegt?.prokura as Person[] | undefined) ?? []).map((p) => `${p.name} | ${p.funktion}`).join("\n"),
    dokumentId: "",
  });
  const setze = (name: keyof typeof feld) => (e: { target: { value: string } }) => setFeld((f) => ({ ...f, [name]: e.target.value }));

  function senden(e: FormEvent) {
    e.preventDefault();
    erfassen.mutate(
      {
        gericht: feld.gericht,
        registerart: feld.registerart,
        nummer: feld.nummer,
        firma: feld.firma,
        rechtsform: feld.rechtsform || null,
        sitz: feld.sitz || null,
        anschrift: feld.anschrift || null,
        kapital: feld.kapital || null,
        vertretung: personenAusText(feld.vertretung),
        prokura: personenAusText(feld.prokura),
        standDatum: feld.standDatum,
        dokumentId: feld.dokumentId || null,
      },
      { onSuccess: (x) => onFertig(x.neu) },
    );
  }

  return (
    <form className="app-formular" onSubmit={senden} aria-label={r.erfassen}>
      <FehlerHinweis fehler={erfassen.error} />
      <Feld label={r.felder.gericht} value={feld.gericht} onChange={setze("gericht")} required />
      <Auswahl label={r.felder.registerart} value={feld.registerart} onChange={setze("registerart")}>
        {REGISTERARTEN.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </Auswahl>
      <Feld label={r.felder.nummer} value={feld.nummer} onChange={setze("nummer")} required />
      <Feld label={r.felder.firma} value={feld.firma} onChange={setze("firma")} required />
      <Feld label={r.felder.rechtsform} value={feld.rechtsform} onChange={setze("rechtsform")} />
      <Feld label={r.felder.sitz} value={feld.sitz} onChange={setze("sitz")} />
      <Feld label={r.felder.anschrift} value={feld.anschrift} onChange={setze("anschrift")} />
      <Feld label={r.felder.kapital} value={feld.kapital} onChange={setze("kapital")} inputMode="decimal" zahl />
      <Feld label={r.felder.standDatum} type="date" value={feld.standDatum} onChange={setze("standDatum")} required />
      <Textbereich label={r.felder.vertretung} hilfe={r.vertretungHilfe} value={feld.vertretung} onChange={setze("vertretung")} rows={3} />
      <Textbereich label={r.felder.prokura} hilfe={r.vertretungHilfe} value={feld.prokura} onChange={setze("prokura")} rows={2} />
      <Auswahl label={r.felder.auszug} value={feld.dokumentId} onChange={setze("dokumentId")}>
        <option value="">{r.auszugKein}</option>
        {(dokumente.data ?? []).map((d) => (
          <option key={d.id} value={d.id}>
            {d.dateiname}
          </option>
        ))}
      </Auswahl>
      <div className="app-aktionen__knoepfe">
        <Button type="submit" disabled={erfassen.isPending}>
          {r.speichern}
        </Button>
        <Button type="button" variante="sekundaer" onClick={onAbbrechen}>
          {r.abbrechen}
        </Button>
      </div>
    </form>
  );
}

function EreignisFormular({ organisationId, onFertig }: { organisationId: string; onFertig: () => void }) {
  const t = useT();
  const r = t.register;
  const erfassen = useEreignisErfassen(organisationId);
  const [datum, setDatum] = useState("");
  const [art, setArt] = useState<(typeof EREIGNISARTEN)[number]>("sonstiges");
  const [text, setText] = useState("");
  return (
    <form
      className="app-formular"
      aria-label={r.ereignisse.erfassen}
      onSubmit={(e) => {
        e.preventDefault();
        erfassen.mutate({ datum, art, text }, { onSuccess: onFertig });
      }}
    >
      <FehlerHinweis fehler={erfassen.error} />
      <Feld label={r.ereignisse.felder.datum} type="date" value={datum} onChange={(e) => setDatum(e.target.value)} required />
      <Auswahl label={r.ereignisse.felder.art} value={art} onChange={(e) => setArt(e.target.value as typeof art)}>
        {EREIGNISARTEN.map((a) => (
          <option key={a} value={a}>
            {aufzaehlung(r.ereignisse.art, a)}
          </option>
        ))}
      </Auswahl>
      <Textbereich markdown label={r.ereignisse.felder.text} value={text} onChange={(e) => setText(e.target.value)} rows={3} required />
      <Button type="submit" disabled={erfassen.isPending}>
        {r.speichern}
      </Button>
    </form>
  );
}

/** Hinweis auf der Beteiligung: offene Registerereignisse (Insolvenz, Kapitalerhöhung, Löschung) mit Verweis auf den Ablauf. Es wird nichts gebucht. */
export function RegisterHinweise({ beteiligungId, organisationId }: { beteiligungId: string; organisationId: string }) {
  const t = useT();
  const sprache = useSprache();
  const { data } = useQuery(registerHinweise(beteiligungId));
  if (!data || data.length === 0) return null;
  const r = t.register.hinweise;
  return (
    <Hinweis titel={r.titel}>
      {data.map((h: RegisterHinweis) => (
        <span key={h.ereignisId} className="app-hinweis-zeile">
          {r.beiBeteiligung(aufzaehlung(r.art, h.art), formatDatum(h.datum, sprache))}.{" "}
          {h.aktion === "insolvenz" ? (
            <a href="#abschnitt-instrument">{aufzaehlung(r.aktion, h.aktion)}</a>
          ) : h.aktion === "runde" ? (
            <Link to="/organizations/$id" params={{ id: organisationId }} hash="runden-titel">
              {aufzaehlung(r.aktion, h.aktion)}
            </Link>
          ) : null}{" "}
        </span>
      ))}
      <span>{r.beschreibung}</span>
    </Hinweis>
  );
}
