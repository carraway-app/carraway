import { useId, useState } from "react";
import { Button, Feld, Tabelle, formatDatum, type TabelleSpalte } from "@carraway/ui";
import type { Mitarbeiterzuteilung } from "../api/abfragen";
import { heuteIso } from "../api/datum";
import { useMitarbeiterAusuebungAendern, useMitarbeiterAusuebungAnlegen, useMitarbeiterAusuebungEntfernen } from "../api/mutationen";
import { useSprache, useT } from "../i18n";
import { feldText } from "../i18n/fehler";
import { betragRegel, datumRegel, ganzzahlRegel } from "../lib/feldpruefung";
import { formatAnzahl, formatPreis } from "../lib/zahl";
import { FehlerHinweis } from "./FehlerHinweis";
import { betragOderNichts, useFormular } from "./formular";

type Ausuebung = Mitarbeiterzuteilung["ausuebungen"][number];

interface AusuebungenZiel {
  organisationId: string;
  poolId: string;
  zuteilung: Mitarbeiterzuteilung;
}

export function MitarbeiterAusuebungen({ organisationId, poolId, zuteilung }: AusuebungenZiel) {
  const a = useT().mitarbeiter.ausuebungen;
  const sprache = useSprache();
  const titel = useId();
  const entfernen = useMitarbeiterAusuebungEntfernen(organisationId);
  const [offen, setOffen] = useState<Ausuebung | "neu" | null>(null);
  const gesperrt = zuteilung.status === "ausgeuebt";
  const spalten: TabelleSpalte<Ausuebung>[] = [
    { schluessel: "datum", kopf: a.datum, zelle: (x) => formatDatum(x.datum, sprache) },
    { schluessel: "anzahl", kopf: a.anzahl, zahl: true, zelle: (x) => formatAnzahl(x.anzahl, sprache) },
    { schluessel: "preis", kopf: a.preis, zahl: true, zelle: (x) => formatPreis(x.preis, sprache) },
    {
      schluessel: "aktion",
      kopf: a.aktion,
      zelle: (x) => (
        <span className="app-aktionen__knoepfe">
          <Button variante="sekundaer" aria-label={a.bearbeitenFuer(formatDatum(x.datum, sprache))} onClick={() => setOffen(x)}>{a.bearbeiten}</Button>
          <Button
            variante="sekundaer"
            aria-label={a.entfernenFuer(formatDatum(x.datum, sprache))}
            disabled={entfernen.isPending}
            onClick={() => entfernen.mutate({ poolId, zuteilungId: zuteilung.id, ausuebungId: x.id }, { onSuccess: () => setOffen((alt) => alt !== "neu" && alt?.id === x.id ? null : alt) })}
          >
            {a.entfernen}
          </Button>
        </span>
      ),
    },
  ];
  return (
    <section aria-labelledby={titel}>
      <div className="app-karte__kopf">
        <h3 id={titel} className="cw-t-untertitel app-karte__titel">{a.titel}</h3>
        {offen === null && !gesperrt ? <Button variante="sekundaer" onClick={() => setOffen("neu")}>{a.neu}</Button> : null}
      </div>
      <FehlerHinweis fehler={entfernen.error} />
      {zuteilung.ausuebungen.length > 0 ? (
        <Tabelle beschriftung={a.titel} spalten={spalten} zeilen={zuteilung.ausuebungen} zeilenSchluessel={(x) => x.id} />
      ) : (
        <p className="app-leer-text">{gesperrt ? a.gesperrt : a.keine}</p>
      )}
      {offen && !gesperrt ? (
        <AusuebungFormular key={offen === "neu" ? offen : offen.id} organisationId={organisationId} poolId={poolId} zuteilung={zuteilung} ausuebung={offen === "neu" ? null : offen} onFertig={() => setOffen(null)} />
      ) : null}
    </section>
  );
}

function AusuebungFormular({ organisationId, poolId, zuteilung, ausuebung, onFertig }: AusuebungenZiel & { ausuebung: Ausuebung | null; onFertig: () => void }) {
  const t = useT();
  const a = t.mitarbeiter.ausuebungen;
  const sprache = useSprache();
  const anlegen = useMitarbeiterAusuebungAnlegen(organisationId);
  const aendern = useMitarbeiterAusuebungAendern(organisationId);
  const mutation = ausuebung ? aendern : anlegen;
  const { werte, feld, pruefeAlle } = useFormular(
    { datum: ausuebung?.datum ?? heuteIso(), anzahl: ausuebung?.anzahl ?? "", preis: ausuebung?.preis ?? zuteilung.basispreis },
    {
      datum: datumRegel({ pflicht: true, min: zuteilung.zugeteiltAm }),
      anzahl: ganzzahlRegel({ pflicht: true, min: 1 }),
      preis: betragRegel({ pflicht: true, nachkomma: 4, ganzstellen: 14 }),
    },
  );
  const fehler = (name: string) => feldText(t, mutation.error, name);
  function absenden() {
    if (!pruefeAlle()) return;
    const koerper = {
      poolId, zuteilungId: zuteilung.id, datum: werte.datum,
      anzahl: BigInt(werte.anzahl.replace(/\s/g, "")).toString(),
      preis: betragOderNichts(werte.preis, sprache) ?? "",
    };
    if (ausuebung) aendern.mutate({ ...koerper, ausuebungId: ausuebung.id }, { onSuccess: onFertig });
    else anlegen.mutate(koerper, { onSuccess: onFertig });
  }
  return (
    <form className="app-formular" aria-label={ausuebung ? a.bearbeitenFuer(formatDatum(ausuebung.datum, sprache)) : a.neu} noValidate onSubmit={(e) => { e.preventDefault(); absenden(); }}>
      <FehlerHinweis fehler={mutation.error} bekannt={["datum", "anzahl", "preis"]} />
      <div className="cw-formularraster">
        <Feld label={a.datum} type="date" {...feld("datum", fehler("datum"))} />
        <Feld label={a.anzahl} zahl inputMode="numeric" {...feld("anzahl", fehler("anzahl"))} />
        <Feld label={a.preis} zahl inputMode="decimal" {...feld("preis", fehler("preis"))} />
      </div>
      <div className="app-aktionen__knoepfe">
        <Button type="submit" disabled={mutation.isPending}>{a.speichern}</Button>
        <Button variante="sekundaer" onClick={onFertig}>{a.abbrechen}</Button>
      </div>
    </form>
  );
}
