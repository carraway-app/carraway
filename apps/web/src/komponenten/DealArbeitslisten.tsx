import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button, Hinweis, Tabelle, formatDatum, type Sortierrichtung, type TabelleSpalte } from "@carraway/ui";
import { istZuordnungskonflikt, useDealZuordnen, type Arbeitsdeal } from "../api/dealflow";
import { useSprache, useT } from "../i18n";
import { Datensatzlink } from "./crm/Datensatzlink";
import { DealZuordnungDialog } from "./DealZuordnungDialog";
import { FehlerHinweis } from "./FehlerHinweis";

export const istUnzugeordnet = (deal: Arbeitsdeal) => deal.investmentmanagerId === null && deal.projektleiterId === null;

type Bereich = "eingang" | "meine";
type Sortierfeld = "titel" | "unternehmenName" | "eingangsdatum" | "herkunft" | "quelle" | "phase";
type Sortierung = { schluessel: Sortierfeld; richtung: Sortierrichtung };

export function DealArbeitslisten({ bereich, deals, benutzerId, darfZuordnen, laedt, fehler }: {
  bereich: Bereich;
  deals: Arbeitsdeal[];
  benutzerId: string | undefined;
  darfZuordnen: (id: string) => boolean;
  laedt: boolean;
  fehler: Error | null;
}) {
  const t = useT();
  const sprache = useSprache();
  const f = t.dealflow;
  const [sortierung, setSortierung] = useState<Sortierung>({ schluessel: "eingangsdatum", richtung: "auf" });
  const [zuordnen, setZuordnen] = useState<Arbeitsdeal | null>(null);
  const [meldung, setMeldung] = useState("");
  const uebernehmen = useDealZuordnen();
  const kopf = useRef<HTMLHeadingElement>(null);
  const eingang = bereich === "eingang";
  const titel = eingang ? f.eingang : f.meineDeals;
  const keinWert = t.gemeinsam.keinWert;
  const sortierwert = (deal: Arbeitsdeal, feld: Sortierfeld) => {
    if (feld === "herkunft") return deal.herkunft ? f.herkuenfte[deal.herkunft] : null;
    if (feld === "phase") return t.dealPhase[deal.phase];
    return deal[feld];
  };

  const meine = deals.filter((deal) => deal.investmentmanagerId === benutzerId || deal.projektleiterId === benutzerId);
  const gruppen = eingang
    ? [{ titel, deals: deals.filter(istUnzugeordnet) }]
    : [
        { titel: f.beideRollen, deals: meine.filter((deal) => deal.investmentmanagerId === benutzerId && deal.projektleiterId === benutzerId) },
        { titel: f.investmentmanager, deals: meine.filter((deal) => deal.investmentmanagerId === benutzerId && deal.projektleiterId !== benutzerId) },
        { titel: f.projektleiter, deals: meine.filter((deal) => deal.projektleiterId === benutzerId && deal.investmentmanagerId !== benutzerId) },
      ].filter((gruppe) => gruppe.deals.length > 0);

  const spalten: TabelleSpalte<Arbeitsdeal>[] = [
    { schluessel: "titel", kopf: f.spalten.titel, sortierbar: true, zelle: (d) => <Datensatzlink objekt="deal" id={d.id}>{d.titel}</Datensatzlink> },
    { schluessel: "unternehmenName", kopf: f.spalten.organisation, sortierbar: true, zelle: (d) => d.unternehmenName },
    { schluessel: "eingangsdatum", kopf: f.eingangsdatum, sortierbar: true, zelle: (d) => d.eingangsdatum ? <time dateTime={d.eingangsdatum}>{formatDatum(d.eingangsdatum, sprache)}</time> : keinWert },
    { schluessel: "herkunft", kopf: f.herkunft, sortierbar: true, zelle: (d) => d.herkunft ? f.herkuenfte[d.herkunft] : keinWert },
    { schluessel: "quelle", kopf: f.quelle, sortierbar: true, zelle: (d) => d.quelle ?? keinWert },
    { schluessel: "phase", kopf: f.spalten.phase, sortierbar: true, zelle: (d) => t.dealPhase[d.phase] },
    ...(!eingang ? [
      { schluessel: "investmentmanager", kopf: f.investmentmanager, zelle: (d: Arbeitsdeal) => d.investmentmanagerName ?? keinWert },
      { schluessel: "projektleiter", kopf: f.projektleiter, zelle: (d: Arbeitsdeal) => d.projektleiterName ?? keinWert },
    ] : []),
    ...(gruppen.some((g) => g.deals.some((d) => d.betreuung)) ? [{ schluessel: "betreuung", kopf: f.altBetreuung, zelle: (d: Arbeitsdeal) => d.betreuung ?? keinWert }] : []),
    ...(gruppen.some((g) => g.deals.some((d) => darfZuordnen(d.id))) ? [{
      schluessel: "aktionen", kopf: t.deal.aktionen, zelle: (d: Arbeitsdeal) => darfZuordnen(d.id) ? (
        <div className="app-dealflow__zeilenaktionen">
          {eingang && benutzerId ? (
            <Button groesse="s" variante="sekundaer" aria-label={f.uebernehmenFuer(d.titel)} disabled={uebernehmen.isPending} onClick={() => {
              setMeldung("");
              uebernehmen.mutate({ deal: d, investmentmanagerId: benutzerId }, {
                onSuccess: () => {
                  setMeldung(f.uebernommen(d.titel));
                  kopf.current?.focus();
                },
                onError: (fehler) => {
                  if (istZuordnungskonflikt(fehler)) kopf.current?.focus();
                },
              });
            }}>{f.uebernehmen}</Button>
          ) : null}
          <Button groesse="s" variante="ruhig" aria-label={eingang ? f.zuweisenFuer(d.titel) : f.zuordnenFuer(d.titel)} onClick={() => {
            uebernehmen.reset();
            setMeldung("");
            setZuordnen(d);
          }}>{eingang ? f.zuweisen : f.zuordnen}</Button>
        </div>
      ) : null,
    }] : []),
  ];

  function tabelle(name: string, daten: Arbeitsdeal[]) {
    const zeilen = daten.toSorted((a, b) => {
      const links = sortierwert(a, sortierung.schluessel);
      const rechts = sortierwert(b, sortierung.schluessel);
      if (links === null) return rechts === null ? a.id.localeCompare(b.id) : 1;
      if (rechts === null) return -1;
      const vergleich = links.localeCompare(rechts, sprache, { numeric: true });
      return vergleich * (sortierung.richtung === "ab" ? -1 : 1) || a.id.localeCompare(b.id);
    });
    return <Tabelle beschriftung={name} dicht spalten={spalten} zeilen={zeilen} zeilenSchluessel={(d) => d.id}
      sortierung={sortierung} onSortieren={(schluessel) => setSortierung({
        schluessel: schluessel as Sortierfeld,
        richtung: schluessel === sortierung.schluessel && sortierung.richtung === "auf" ? "ab" : "auf",
      })}
      laedt={laedt} leer={fehler ? undefined : f.leerEingang}
    />;
  }

  return (
    <div className="app-dealflow__arbeitsliste">
      <div className="app-pipeline-arbeitskopf">
        <h2 className="cw-t-untertitel" ref={kopf} tabIndex={-1}>{titel}</h2>
        {!eingang ? <Link to="/dealflow" search={(alt) => ({ ...alt, bereich: undefined, umfang: "meine" })}
          className="cw-button cw-button--sekundaer cw-button--s">{t.crm.pipelinePersoenlich}</Link> : null}
      </div>
      <div className="cw-nur-lesen" role="status">{meldung}</div>
      {istZuordnungskonflikt(uebernehmen.error) ? (
        <Hinweis variante="fehler" titel={t.fehler.DEAL_ZUORDNUNG_KONFLIKT}>{f.konfliktUebernehmen}</Hinweis>
      ) : <FehlerHinweis fehler={uebernehmen.error} />}
      <FehlerHinweis fehler={fehler} />
      {eingang ? tabelle(titel, gruppen[0]?.deals ?? []) : (
        gruppen.length > 0 ? gruppen.map((g) => (
          <details key={g.titel} open className="app-dealflow__rollengruppe">
            <summary><h3>{g.titel} <span>{g.deals.length}</span></h3></summary>
            {tabelle(g.titel, g.deals)}
          </details>
        )) : laedt ? tabelle(titel, []) : fehler ? null : <p className="app-leer-text">{f.leerMeine}</p>
      )}
      {zuordnen ? <DealZuordnungDialog deal={zuordnen} onSchliessen={() => setZuordnen(null)} onGespeichert={() => {
        setMeldung(f.zuordnungGespeichert(zuordnen.titel));
        setZuordnen(null);
        // Der Deal kann nach dem Speichern aus der aktuellen Liste verschwinden.
        requestAnimationFrame(() => {
          if (document.activeElement === document.body) kopf.current?.focus();
        });
      }} /> : null}
    </div>
  );
}
