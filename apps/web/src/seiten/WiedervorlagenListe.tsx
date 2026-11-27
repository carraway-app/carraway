import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Button, Feld, Leer, Segment, Seitenkopf, Status, Tabelle, formatDatum, type TabelleSpalte } from "@carraway/ui";
import { wiedervorlagenListe, type WiedervorlageZeile } from "../api/abfragen";
import { useWiedervorlageErledigt, useWiedervorlageZurueckstellen } from "../api/mutationen";
import { heuteIso } from "../api/datum";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { NurLesen } from "../komponenten/NurLesen";
import { useNamen } from "../lib/namen";
import { useRechte } from "../lib/rechte";
import { useSprache, useT } from "../i18n";
import { Datensatzlink } from "../komponenten/crm/Datensatzlink";

const route = getRouteApi("/follow-ups");

function Bezug({ z }: { z: WiedervorlageZeile }) {
  if (z.deal?.id)
    return (
      <Datensatzlink objekt="deal" id={z.deal.id}>
        {z.deal.titel}
      </Datensatzlink>
    );
  if (z.organisation?.id)
    return (
      <Datensatzlink objekt="organisation" id={z.organisation.id}>
        {z.organisation.name}
      </Datensatzlink>
    );
  return z.person?.id ? (
    <Datensatzlink objekt="person" id={z.person.id}>{`${z.person.vorname} ${z.person.nachname}`}</Datensatzlink>
  ) : null;
}

/** Liste der offenen Wiedervorlagen mit Filtern (meine oder alle, fällig bis), Erledigen und Zurückstellen. */
export function WiedervorlagenSeite() {
  const t = useT();
  const w = t.wiedervorlagenSeite;
  const sprache = useSprache();
  const { zustaendig = "ich", bis } = route.useSearch();
  const navigate = route.useNavigate();
  const { darf } = useRechte();
  const abfrage = useQuery(wiedervorlagenListe({ zustaendig, bis }));
  const erledigt = useWiedervorlageErledigt();
  const zurueck = useWiedervorlageZurueckstellen();
  const [stellen, setStellen] = useState<{ id: string; titel: string; datum: string } | null>(null);
  const zeilen = abfrage.data ?? [];
  const name = useNamen(zeilen.map((z) => z.zustaendigId));
  const schreiben = darf("bearbeiter", null, "kontakte");

  const spalten: TabelleSpalte<WiedervorlageZeile>[] = [
    {
      schluessel: "faellig",
      kopf: w.spalten.faellig,
      zelle: (z) => (
        <>
          <time className="app-zahl" dateTime={z.wiedervorlage ?? undefined}>
            {z.wiedervorlage ? formatDatum(z.wiedervorlage, sprache) : t.gemeinsam.keinWert}
          </time>{" "}
          {z.ueberfaellig ? <Status variante="fehlt">{w.ueberfaellig}</Status> : null}
        </>
      ),
    },
    { schluessel: "titel", kopf: w.spalten.titel, umbruch: true, zelle: (z) => z.titel },
    { schluessel: "bezug", kopf: w.spalten.bezug, zelle: (z) => <Bezug z={z} /> },
    { schluessel: "zustaendig", kopf: w.spalten.zustaendig, zelle: (z) => name(z.zustaendigId) ?? t.gemeinsam.keinWert },
    {
      schluessel: "aktion",
      kopf: <span className="cw-nur-lesen">{w.spalten.aktion}</span>,
      zelle: (z) =>
        schreiben ? (
          <span className="app-knoepfe">
            <Button variante="sekundaer" disabled={erledigt.isPending} aria-label={t.wiedervorlagen.erledigtMelden(z.titel)} onClick={() => erledigt.mutate(z.id)}>
              {w.erledigt}
            </Button>
            <Button variante="ruhig" aria-label={w.zurueckstellenName(z.titel)} onClick={() => setStellen({ id: z.id, titel: z.titel, datum: heuteIso() })}>
              {w.zurueckstellen}
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <div className="app-seite">
      <Seitenkopf meta={w.etikett} titel={w.titel} />
      <NurLesen />
      <section className="app-karte" aria-label={w.filter}>
        <div className="app-filter">
          <div className="app-filter__gruppe">
            <span className="app-kopf__beschriftung" id="wv-zustaendig">
              {w.zustaendig}
            </span>
            <Segment<"ich" | "alle">
              aria-labelledby="wv-zustaendig"
              value={zustaendig}
              onChange={(wert) => void navigate({ search: (alt) => ({ ...alt, zustaendig: wert }), replace: true })}
              options={[
                { wert: "ich", label: w.ich },
                { wert: "alle", label: w.alle },
              ]}
            />
          </div>
          <Feld type="date" label={w.bis} value={bis ?? ""} onChange={(e) => void navigate({ search: (alt) => ({ ...alt, bis: e.target.value || undefined }), replace: true })} />
        </div>
      </section>
      <FehlerHinweis fehler={abfrage.error ?? erledigt.error ?? zurueck.error} />
      <section className="app-karte" aria-busy={abfrage.isFetching}>
        <h2 className="cw-t-untertitel app-karte__titel">
          {w.titel}
          {abfrage.data ? <span className="app-board__anzahl"> {zeilen.length}</span> : null}
        </h2>
        {abfrage.isPending ? (
          <div className="app-skelett app-skelett--zeile" aria-hidden="true" />
        ) : !abfrage.data ? null : zeilen.length === 0 ? (
          <Leer titel={w.keine} beschreibung="" />
        ) : (
          <Tabelle beschriftung={w.titel} spalten={spalten} zeilen={zeilen} zeilenSchluessel={(z) => z.id} />
        )}
      </section>
      {stellen ? (
        <section className="app-karte" aria-label={w.zurueckstellenName(stellen.titel)}>
          <form
            className="app-aktionen"
            onSubmit={(e) => {
              e.preventDefault();
              zurueck.mutate({ id: stellen.id, datum: stellen.datum }, { onSuccess: () => setStellen(null) });
            }}
          >
            <Feld type="date" label={w.neuesDatum} min={heuteIso()} value={stellen.datum} onChange={(e) => setStellen({ ...stellen, datum: e.target.value })} />
            <div className="app-aktionen__knoepfe">
              <Button type="submit" disabled={zurueck.isPending || stellen.datum === ""}>
                {w.speichern}
              </Button>
              <Button variante="sekundaer" onClick={() => setStellen(null)}>
                {w.abbrechen}
              </Button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
