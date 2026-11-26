import { useEffect, useState } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { useTabs } from "../lib/tabs";
import { ArrowsClockwiseIcon, Auswahl, BookOpenIcon, Button, Feld, formatDatum, Hinweis, Segment, Seitenkopf, Status, Tabelle, Tabs, type StatusVariante, type TabelleSpalte } from "@carraway/ui";
import { fondsListe } from "../api/abfragen";
import { fondsDefinitionen, foerderprogramme, meldeLaeufe, useAktivierung, useLaufAnlegen, type FondsDefinition, type MeldeLaufZeile } from "../api/meldewesen";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { useRechte } from "../lib/rechte";
import { alsStand } from "../lib/zeit";
import { merkeFonds } from "../zustand";

const route = getRouteApi("/fonds/$fondsId/meldungen");

export const LAUF_STATUS: Record<string, StatusVariante> = { entwurf: "entwurf", geprueft: "pruefung", freigegeben: "freigegeben" };

/** Bezeichnung des Zeitraums eines Laufs: Kennung wie `2026-Q3` als „Q3 2026“ lesbar, sonst das Datum. */
export function zeitraumText(kennung: string, sprache: "de" | "en"): string {
  const q = /^(\d{4})-([QH])(\d)$/.exec(kennung);
  if (q) return `${q[2]}${q[3]} ${q[1]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(kennung) ? formatDatum(kennung, sprache) : kennung;
}

/** Seite „Meldungen“ am Fonds: aktivierte Definitionen, Läufe je Zeitraum, neuen Lauf anlegen. */
export function MeldungenSeite() {
  const t = useT();
  const m = t.melde;
  const f = m.fonds;
  const sprache = useSprache();
  const { fondsId } = route.useParams();
  const { data: fondsliste } = useSuspenseQuery(fondsListe());
  const fonds = fondsliste.find((x) => x.id === fondsId);
  const { darf } = useRechte();
  const { data: definitionen } = useQuery(fondsDefinitionen(fondsId));
  const { data: laeufe, error } = useQuery(meldeLaeufe(fondsId));
  const [neu, setNeu] = useState(false);
  const { tab, setzeTab } = useTabs(route.useSearch(), route.useNavigate(), ["laeufe", "definitionen"] as const);
  const kannAnlegen = darf("bearbeiter", fondsId, "meldewesen");
  const aktive = (definitionen ?? []).filter((d) => d.aktiviert);
  useEffect(() => merkeFonds(fondsId), [fondsId]);

  const bezeichnung = (d: { bezeichnungDe: string; bezeichnungEn: string }) => (sprache === "de" ? d.bezeichnungDe : d.bezeichnungEn);

  const spalten: TabelleSpalte<MeldeLaufZeile>[] = [
    { schluessel: "zeitraum", kopf: f.laeufe.spalten.zeitraum, zelle: (l) => zeitraumText(l.periodeKennung, sprache) },
    { schluessel: "definition", kopf: f.laeufe.spalten.definition, zelle: (l) => bezeichnung(l) },
    { schluessel: "fassung", kopf: f.laeufe.spalten.fassung, zahl: true, zelle: (l) => l.fassung },
    { schluessel: "status", kopf: f.laeufe.spalten.status, zelle: (l) => <Status variante={LAUF_STATUS[l.status] ?? "entwurf"}>{aufzaehlung(m.status, l.status)}</Status> },
    {
      schluessel: "stufe",
      kopf: f.laeufe.spalten.stufe,
      zelle: (l) => {
        const stufen = l.freigabestufen as string[];
        return l.status === "freigegeben" ? f.laeufe.alleStufen : f.laeufe.stufe(l.naechsteStufe + 1, stufen.length, stufen[l.naechsteStufe] ?? "");
      },
    },
    { schluessel: "stand", kopf: f.laeufe.spalten.stand, zelle: (l) => formatDatum(l.stand.slice(0, 10), sprache) },
    {
      schluessel: "aktion",
      kopf: f.laeufe.spalten.aktion,
      zelle: (l) => (
        <Link to="/meldungen/$id" params={{ id: l.id }} aria-label={f.laeufe.oeffnenFuer(bezeichnung(l), zeitraumText(l.periodeKennung, sprache))}>
          {f.laeufe.oeffnen}
        </Link>
      ),
    },
  ];

  return (
    <div className="app-seite">
      <Seitenkopf
        meta={
          <Link to="/fonds/$fondsId" params={{ fondsId }} search={{}}>
            {f.zurueck}
          </Link>
        }
        titel={`${f.titel}${fonds ? ` · ${fonds.name}` : ""}`}
        aktionen={kannAnlegen ? <Button onClick={() => setNeu(true)} disabled={aktive.length === 0}>{f.neu.knopf}</Button> : undefined}
      />
      <p className="app-leer-text">{f.einleitung}</p>
      {!kannAnlegen ? <p className="app-leer-text">{f.neu.rolle}</p> : null}

      <Tabs
        aria-label={f.bereiche}
        aktiv={tab}
        onWechsel={setzeTab}
        tabs={[
          {
            id: "laeufe",
            icon: ArrowsClockwiseIcon,
            label: f.laeufe.titel,
            ...(laeufe ? { zaehler: laeufe.length } : {}),
            inhalt: () => (
              <section className="app-karte app-karte--tabelle" aria-label={f.laeufe.titel}>
                {error ? <FehlerHinweis fehler={error} /> : null}
                {laeufe && laeufe.length > 0 ? <Tabelle dicht beschriftung={f.laeufe.beschriftung} spalten={spalten} zeilen={laeufe} zeilenSchluessel={(l) => l.id} /> : <p className="app-leer-text">{f.laeufe.keine}</p>}
              </section>
            ),
          },
          {
            id: "definitionen",
            icon: BookOpenIcon,
            label: f.definitionen.titel,
            inhalt: () => (
              <section className="app-karte app-karte--tabelle" aria-label={f.definitionen.titel}>
                {!darf("verwalter", fondsId, "meldewesen") ? <p className="app-leer-text">{f.definitionen.nurVerwalter}</p> : null}
                <DefinitionenTabelle fondsId={fondsId} definitionen={definitionen ?? []} darfAendern={darf("verwalter", fondsId, "meldewesen")} />
              </section>
            ),
          },
        ]}
      />

      {neu ? <NeuerLauf fondsId={fondsId} definitionen={aktive} onSchliessen={() => setNeu(false)} /> : null}
    </div>
  );
}

function DefinitionenTabelle({ fondsId, definitionen, darfAendern }: { fondsId: string; definitionen: FondsDefinition[]; darfAendern: boolean }) {
  const t = useT();
  const sprache = useSprache();
  const m = t.melde;
  const d = m.fonds.definitionen;
  const { data: programme } = useQuery(foerderprogramme());
  const aktion = useAktivierung(fondsId);
  const [wahl, setWahl] = useState<Record<string, string>>({});
  if (definitionen.length === 0) return <p className="app-leer-text">{d.keine}</p>;
  const name = (x: FondsDefinition) => (sprache === "de" ? x.bezeichnungDe : x.bezeichnungEn);
  const spalten: TabelleSpalte<FondsDefinition>[] = [
    { schluessel: "definition", kopf: d.spalten.definition, zelle: (x) => name(x) },
    { schluessel: "rhythmus", kopf: d.spalten.rhythmus, zelle: (x) => aufzaehlung(m.rhythmus, x.rhythmus) },
    { schluessel: "format", kopf: d.spalten.format, zelle: (x) => aufzaehlung(m.format, x.format) },
    { schluessel: "version", kopf: d.spalten.version, zahl: true, zelle: (x) => x.version },
    { schluessel: "programm", kopf: d.spalten.programm, zelle: (x) => x.foerderprogramm?.bezeichnung ?? d.ohneProgramm },
    { schluessel: "aktiv", kopf: d.spalten.aktiv, zelle: (x) => (x.aktiviert ? d.ja : d.nein) },
    ...(darfAendern
      ? [
          {
            schluessel: "aktion",
            kopf: d.spalten.aktion,
            zelle: (x: FondsDefinition) => (
              <span className="app-zusammenhang">
                {x.aktiviert ? null : (
                  <select className="cw-feld__eingabe app-auswahl--klein" aria-label={`${d.programmWahl}: ${name(x)}`} value={wahl[x.schluessel] ?? ""} onChange={(e) => setWahl((w) => ({ ...w, [x.schluessel]: e.target.value }))}>
                    <option value="">{d.ohneProgramm}</option>
                    {(programme ?? []).map((p) => (
                      <option key={p.id} value={p.schluessel}>
                        {p.bezeichnung}
                      </option>
                    ))}
                  </select>
                )}
                <Button
                  variante="sekundaer"
                  disabled={aktion.isPending}
                  aria-label={x.aktiviert ? d.deaktivierenFuer(name(x)) : d.aktivierenFuer(name(x))}
                  onClick={() => aktion.mutate({ schluessel: x.schluessel, aktiv: !x.aktiviert, ...(x.aktiviert ? {} : { foerderprogramm: wahl[x.schluessel] || null }) })}
                >
                  {x.aktiviert ? d.deaktivieren : d.aktivieren}
                </Button>
              </span>
            ),
          } satisfies TabelleSpalte<FondsDefinition>,
        ]
      : []),
  ];
  return (
    <>
      {aktion.error ? <FehlerHinweis fehler={aktion.error} /> : null}
      <Tabelle dicht beschriftung={d.beschriftung} spalten={spalten} zeilen={definitionen} zeilenSchluessel={(x) => x.schluessel} />
    </>
  );
}

function NeuerLauf({ fondsId, definitionen, onSchliessen }: { fondsId: string; definitionen: FondsDefinition[]; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const n = t.melde.fonds.neu;
  const navigate = useNavigate();
  const anlegen = useLaufAnlegen();
  const [schluessel, setSchluessel] = useState(definitionen[0]?.schluessel ?? "");
  const gewaehlt = definitionen.find((d) => d.schluessel === schluessel) ?? definitionen[0];
  const heute = new Date();
  const [jahr, setJahr] = useState(String(heute.getFullYear()));
  const [nummer, setNummer] = useState("1");
  const [stichtag, setStichtag] = useState("");
  const [lauftext, setLauftext] = useState<"de" | "en">(sprache);
  const [stand, setStand] = useState("");
  const rhythmus = gewaehlt?.rhythmus ?? "quartal";
  const teile = rhythmus === "quartal" ? 4 : 2;

  function senden() {
    if (!gewaehlt) return;
    const standIso = alsStand(stand || undefined);
    anlegen.mutate(
      {
        fondsId,
        definition: gewaehlt.schluessel,
        sprache: lauftext,
        ...(rhythmus === "stichtag" ? { stichtag } : { jahr: Number(jahr), ...(rhythmus === "jahr" ? {} : { nummer: Number(nummer) }) }),
        ...(standIso ? { stand: standIso } : {}),
      },
      { onSuccess: (lauf) => void navigate({ to: "/meldungen/$id", params: { id: lauf.id } }) },
    );
  }

  return (
    <Seitenpanel titel={n.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{n.titel}</h2>
      {definitionen.length === 0 ? <Hinweis>{n.keineAktiviert}</Hinweis> : null}
      <form
        className="app-formular"
        onSubmit={(e) => {
          e.preventDefault();
          senden();
        }}
      >
        <Auswahl label={n.definition} value={schluessel} onChange={(e) => setSchluessel(e.target.value)}>
          {definitionen.map((d) => (
            <option key={d.schluessel} value={d.schluessel}>
              {sprache === "de" ? d.bezeichnungDe : d.bezeichnungEn}
            </option>
          ))}
        </Auswahl>
        {rhythmus === "stichtag" ? (
          <Feld label={n.stichtag} type="date" value={stichtag} onChange={(e) => setStichtag(e.target.value)} required />
        ) : (
          <>
            <Feld label={n.jahr} type="number" min={1990} max={2200} value={jahr} onChange={(e) => setJahr(e.target.value)} required />
            {rhythmus === "jahr" ? null : (
              <Auswahl label={n.nummer} value={nummer} onChange={(e) => setNummer(e.target.value)}>
                {Array.from({ length: teile }, (_, i) => (
                  <option key={i + 1} value={String(i + 1)}>
                    {`${aufzaehlung(t.melde.nummer, rhythmus)} ${i + 1}`}
                  </option>
                ))}
              </Auswahl>
            )}
          </>
        )}
        <div className="cw-feld">
          <span className="cw-feld__label">{n.sprache}</span>
          <Segment
            aria-label={n.sprache}
            options={[
              { wert: "de", label: t.melde.sprachen.de! },
              { wert: "en", label: t.melde.sprachen.en! },
            ]}
            value={lauftext}
            onChange={setLauftext}
          />
        </div>
        <Feld label={n.stand} type="datetime-local" value={stand} onChange={(e) => setStand(e.target.value)} hilfe={n.standHilfe} />
        {anlegen.error ? <FehlerHinweis fehler={anlegen.error} /> : null}
        <Button type="submit" disabled={anlegen.isPending || !gewaehlt}>
          {n.anlegen}
        </Button>
      </form>
    </Seitenpanel>
  );
}
