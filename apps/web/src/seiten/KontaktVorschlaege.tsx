import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button, Dialog, Hinweis, Leer, Seitenkopf, Tabelle, type TabelleSpalte } from "@carraway/ui";
import { kontaktvorschlaege, useVorschlagUebernehmen, useVorschlagVerwerfen, useVorschlagZusammenfuehren, type Kontaktvorschlag } from "../api/kontaktvorschlaege";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { VerknuepfungsFeld, type SuchfeldTreffer } from "../komponenten/Suchfeld";
import { useT } from "../i18n";
import { useRechte } from "../lib/rechte";

/**
 * „Neue Kontakte aus Postfach und Kalender“: offene Vorschläge aus dem eigenen Postfach und Kalender. Übernehmen legt Person (und bei Bedarf Unternehmen) an,
 * Zusammenführen ordnet die Adresse einer vorhandenen Person zu, Verwerfen gilt dauerhaft. Die API zeigt nur Vorschläge der angemeldeten Person.
 */
export function KontaktVorschlaegeSeite() {
  const t = useT();
  const k = t.mail.kontakte;
  const { darf } = useRechte();
  const erlaubt = darf("bearbeiter", null, "kontakte");
  const abfrage = useQuery({ ...kontaktvorschlaege(), enabled: erlaubt });
  const uebernehmen = useVorschlagUebernehmen();
  const verwerfen = useVorschlagVerwerfen();
  const [zusammen, setZusammen] = useState<Kontaktvorschlag | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);

  const spalten: TabelleSpalte<Kontaktvorschlag>[] = [
    { schluessel: "name", kopf: k.spalten.name, zelle: (v) => v.name ?? <span className="app-leer-text">{k.ohneName}</span> },
    { schluessel: "adresse", kopf: k.spalten.adresse, zelle: (v) => v.adresse },
    {
      schluessel: "unternehmen",
      kopf: k.spalten.unternehmen,
      zelle: (v) =>
        v.unternehmen === null ? (
          <span className="app-leer-text">{k.ohneUnternehmen}</span>
        ) : v.unternehmen.id ? (
          <Link to="/organizations/$id" params={{ id: v.unternehmen.id }}>
            {v.unternehmen.name}
          </Link>
        ) : (
          k.unternehmenNeu(v.unternehmen.name)
        ),
    },
    { schluessel: "quelle", kopf: k.spalten.quelle, zelle: (v) => v.bereiche.map((b) => k.quelle[b] ?? b).join(", ") },
    {
      schluessel: "aktionen",
      kopf: k.spalten.aktionen,
      zelle: (v) => (
        <div className="app-aktionen">
          <Button
            groesse="s"
            aria-label={k.uebernehmenFuer(v.adresse)}
            disabled={uebernehmen.isPending}
            onClick={() => {
              setMeldung(null);
              uebernehmen.mutate(v.id, { onSuccess: () => setMeldung(k.uebernommen) });
            }}
          >
            {k.uebernehmen}
          </Button>
          <Button groesse="s" variante="sekundaer" aria-label={k.zusammenfuehrenFuer(v.adresse)} onClick={() => setZusammen(v)}>
            {k.zusammenfuehren}
          </Button>
          <Button groesse="s" variante="sekundaer" aria-label={k.verwerfenFuer(v.adresse)} disabled={verwerfen.isPending} onClick={() => verwerfen.mutate(v.id)}>
            {k.verwerfen}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="app-seite">
      <Seitenkopf meta={t.crm.etikett} titel={k.listeTitel} aktionen={<Link to="/contacts">{k.zuKontakten}</Link>} />
      <p className="app-leer-text">{k.listeEinleitung}</p>
      <FehlerHinweis fehler={abfrage.error ?? uebernehmen.error ?? verwerfen.error} />
      {meldung ? <Hinweis>{meldung}</Hinweis> : null}
      {abfrage.data && abfrage.data.modus !== "vorschlag" && abfrage.data.daten.length === 0 ? <p className="app-leer-text">{k.listeAus}</p> : null}
      {erlaubt ? (
        <section className="app-karte">
          <Tabelle beschriftung={k.listeTitel} spalten={spalten} zeilen={abfrage.data?.daten ?? []} zeilenSchluessel={(v) => v.id} laedt={abfrage.isPending} leer={<Leer titel={k.leer} />} />
        </section>
      ) : null}
      {zusammen ? (
        <ZusammenfuehrenDialog
          vorschlag={zusammen}
          onSchliessen={() => setZusammen(null)}
          onFertig={() => {
            setZusammen(null);
            setMeldung(k.uebernommen);
          }}
        />
      ) : null}
    </div>
  );
}

function ZusammenfuehrenDialog({ vorschlag, onSchliessen, onFertig }: { vorschlag: Kontaktvorschlag; onSchliessen: () => void; onFertig: () => void }) {
  const k = useT().mail.kontakte;
  const zusammenfuehren = useVorschlagZusammenfuehren();
  const [ziel, setZiel] = useState<SuchfeldTreffer | null>(null);
  return (
    <Dialog
      titel={k.zusammenfuehrenTitel}
      onSchliessen={onSchliessen}
      aktionen={
        <>
          <Button variante="sekundaer" onClick={onSchliessen}>
            {k.abbrechen}
          </Button>
          <Button disabled={!ziel || zusammenfuehren.isPending} onClick={() => ziel && zusammenfuehren.mutate({ id: vorschlag.id, personId: ziel.id }, { onSuccess: onFertig })}>
            {k.zusammenfuehren}
          </Button>
        </>
      }
    >
      <p>{vorschlag.name ? `${vorschlag.name} (${vorschlag.adresse})` : vorschlag.adresse}</p>
      <p className="app-leer-text">{k.zusammenfuehrenHilfe}</p>
      <FehlerHinweis fehler={zusammenfuehren.error} />
      <VerknuepfungsFeld ziel="person" label={k.zielPerson} wert={ziel} onWahl={setZiel} />
    </Dialog>
  );
}
