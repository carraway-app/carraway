import { KeinFonds } from "./Platzhalter";
import { useState } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Button, Feld, Hinweis, Seitenkopf, Status, Tabelle, formatDatum, type StatusVariante, type TabelleSpalte } from "@carraway/ui";
import { fondsListe, fondsUebersicht, zinslaufListe, type ZinslaufZeile } from "../api/abfragen";
import { heuteIso } from "../api/datum";
import { useZinslaufAnlegen } from "../api/mutationen";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { NurLesen } from "../komponenten/NurLesen";
import { useFormular } from "../komponenten/formular";
import { datumRegel } from "../lib/feldpruefung";
import { feldText } from "../i18n/fehler";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { wirksamerFonds } from "../lib/fonds";
import { useRechte } from "../lib/rechte";
import { formatBetragCent } from "../lib/zahl";
import { formatZeitpunkt } from "../lib/zeit";
import { merkeFonds } from "../zustand";

const route = getRouteApi("/zinslaeufe");

export const LAUF_STATUS: Record<string, StatusVariante> = { berechnet: "entwurf", geprueft: "pruefung", freigegeben: "pruefung", gebucht: "freigegeben", verworfen: "fehlt" };

export function ZinslaeufeSeite() {
  const t = useT();
  const { data: fonds } = useSuspenseQuery(fondsListe());
  const { fondsId } = route.useSearch();
  const gewaehlt = wirksamerFonds(fonds, fondsId);
  if (!gewaehlt) return <KeinFonds titel={t.zinslaeufe.titel} />;
  return <ZinslaeufeFuerFonds key={gewaehlt.id} fondsId={gewaehlt.id} fondsName={gewaehlt.name} />;
}

function ZinslaeufeFuerFonds({ fondsId, fondsName }: { fondsId: string; fondsName: string }) {
  const t = useT();
  const sprache = useSprache();
  const z = t.zinslaeufe;
  const { data: laeufe } = useSuspenseQuery(zinslaufListe(fondsId));
  const { darf } = useRechte();
  const [neu, setNeu] = useState(false);
  merkeFonds(fondsId);

  const spalten: TabelleSpalte<ZinslaufZeile>[] = [
    { schluessel: "stichtag", kopf: z.spalten.stichtag, zelle: (l) => formatDatum(l.stichtag, sprache) },
    { schluessel: "status", kopf: z.spalten.status, zelle: (l) => <Status variante={LAUF_STATUS[l.status] ?? "entwurf"}>{aufzaehlung(t.zinslauf.schritte, l.status === "verworfen" ? "" : l.status) || t.zinslauf.akteure.verworfen}</Status> },
    { schluessel: "positionen", kopf: z.spalten.positionen, zahl: true, zelle: (l) => String(l.anzahlPositionen) },
    { schluessel: "summe", kopf: z.spalten.summe, zahl: true, zelle: (l) => formatBetragCent(l.summeGebucht, sprache) },
    { schluessel: "berechnet", kopf: z.spalten.berechnet, zelle: (l) => formatZeitpunkt(l.berechnetAm, sprache) },
    {
      schluessel: "aktion",
      kopf: z.spalten.aktion,
      zelle: (l) => (
        <Link to="/zinslaeufe/$id" params={{ id: l.id }} aria-label={z.oeffnenFuer(formatDatum(l.stichtag, sprache))}>
          {z.oeffnen}
        </Link>
      ),
    },
  ];

  return (
    <div className="app-seite">
      <Seitenkopf
        meta={`${fondsName} · ${z.etikett}`}
        titel={z.titel}
        aktionen={darf("bearbeiter", fondsId, "finanzen") ? <Button onClick={() => setNeu(true)}>{z.neu}</Button> : undefined}
      />
      <NurLesen fondsId={fondsId} bereich="finanzen" />
      <section className="app-karte" aria-label={z.etikett}>
        {laeufe.length === 0 ? <p className="app-leer-text">{z.keine}</p> : <Tabelle dicht beschriftung={z.liste} spalten={spalten} zeilen={laeufe} zeilenSchluessel={(l) => l.id} />}
      </section>
      {neu ? <NeuerLaufDialog fondsId={fondsId} onSchliessen={() => setNeu(false)} /> : null}
    </div>
  );
}

interface Angelegt {
  id: string;
  hinweise: { ohneKonditionen: string[] };
}

/** Neuer Zinslauf; nur die POST-Antwort trägt `hinweise.ohneKonditionen`, deshalb steht die Liste in der Erfolgsansicht. */
function NeuerLaufDialog({ fondsId, onSchliessen }: { fondsId: string; onSchliessen: () => void }) {
  const t = useT();
  const f = t.zinslaeufe.form;
  const anlegen = useZinslaufAnlegen();
  const { werte, feld, pruefeAlle } = useFormular({ stichtag: heuteIso() }, { stichtag: datumRegel({ pflicht: true }) });
  const uebersicht = useQuery(fondsUebersicht(fondsId));
  const angelegt = anlegen.data as unknown as Angelegt | undefined;
  const name = (id: string) => uebersicht.data?.beteiligungen.find((b) => b.id === id)?.organisation.name ?? id;
  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titel}</h2>
      {angelegt ? (
        <>
          <Hinweis>{f.angelegt}</Hinweis>
          {angelegt.hinweise.ohneKonditionen.length > 0 ? (
            <Hinweis>
              {f.ohneKonditionen(angelegt.hinweise.ohneKonditionen.length)}{" "}
              {angelegt.hinweise.ohneKonditionen.map((id, i) => (
                <span key={id}>
                  {i > 0 ? ", " : ""}
                  <Link to="/beteiligungen/$id" params={{ id }} search={{}}>
                    {name(id)}
                  </Link>
                </span>
              ))}
            </Hinweis>
          ) : null}
          <p>
            <Link to="/zinslaeufe/$id" params={{ id: angelegt.id }}>
              {f.oeffnen}
            </Link>
          </p>
        </>
      ) : (
        <>
          <p className="app-leer-text">{f.beschreibung}</p>
          <form
            className="app-formular"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!pruefeAlle()) return;
              anlegen.mutate({ fondsId, stichtag: werte.stichtag });
            }}
          >
            <FehlerHinweis fehler={anlegen.error} bekannt={["stichtag", "fondsId"]} />
            <Feld label={f.stichtag} type="date" hilfe={f.stichtagHilfe} {...feld("stichtag", feldText(t, anlegen.error, "stichtag"))} />
            <div>
              <Button type="submit" disabled={anlegen.isPending}>
                {f.berechnen}
              </Button>
            </div>
          </form>
        </>
      )}
    </Seitenpanel>
  );
}
