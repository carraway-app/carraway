import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, CaretDownIcon, CaretRightIcon, Leer, Status, Tabelle, formatBetrag, type StatusVariante, type TabelleSpalte } from "@carraway/ui";
import type { Deal } from "../api/abfragen";
import { crmAbfrage, crmBoard, crmGruppen, type AbfrageEingabe, type Zeile } from "../api/crm";
import { useSprache, useT } from "../i18n";
import { DEALTYPEN, dealtypName, type Dealtyp } from "../lib/dealtyp";
import { Board, type BoardProps } from "./crm/Board";
import { Datensatzlink } from "./crm/Datensatzlink";
import { mitBedingung } from "./crm/Gruppen";
import { FehlerHinweis } from "./FehlerHinweis";

const DEALTYPGRUPPEN = [...DEALTYPEN, null];
export type PipelineDealtyp = Dealtyp | null;
export const STATUS_VARIANTE: Record<Deal["status"], StatusVariante> = { offen: "pruefung", investiert: "freigegeben", abgesagt: "fehlt" };

const LISTENFELDER = ["titel", "unternehmen", "dealtyp", "phase", "status", "ticket", "investmentmanager", "projektleiter"];
const SEITENGROESSE = 50;

interface ErgebnisProps {
  basis: AbfrageEingabe;
  darstellung: "board" | "liste";
  gruppiert: boolean;
  bereit: boolean;
  board: Omit<BoardProps, "spalten" | "bezuege" | "beschriftung" | "onNeu">;
  onNeu?: (phase?: string, dealtyp?: PipelineDealtyp) => void;
  onListe: () => void;
  onSortieren: (feld: string) => void;
}

export function DealPipelineErgebnisse(props: ErgebnisProps) {
  const { basis, darstellung, gruppiert, bereit, board, onNeu, onListe, onSortieren } = props;
  const t = useT();
  const sprache = useSprache();
  const gruppenId = useId();
  const [geoeffnet, setGeoeffnet] = useState<Record<string, boolean>>({});
  const gruppen = useQuery({
    ...crmGruppen("deal", { suche: basis.suche, filter: basis.filter }, "dealtyp", []),
    enabled: gruppiert && bereit,
    placeholderData: undefined,
  });

  const ergebnis = (filter: AbfrageEingabe["filter"], typ?: PipelineDealtyp) => {
    const eingabe = { ...basis, filter };
    const gruppeName = typ === undefined ? undefined : dealtypName(typ, sprache);
    if (darstellung === "liste") {
      return <DealPipelineListe
        key={JSON.stringify(eingabe)}
        basis={eingabe}
        label={gruppeName ? `${t.crm.pipelineListenname} · ${gruppeName}` : t.crm.pipelineListenname}
        onSortieren={onSortieren}
      />;
    }
    return <DealPipelineBoard
      basis={eingabe}
      label={gruppeName ? `${t.dealflow.board} · ${gruppeName}` : t.dealflow.board}
      gruppeName={gruppeName}
      board={board}
      onNeu={onNeu ? (phase) => onNeu(phase, typ) : undefined}
      onListe={onListe}
    />;
  };

  if (!bereit) return <PipelineLaden />;
  if (!gruppiert) return ergebnis(basis.filter);
  if (gruppen.isError) return <FehlerHinweis fehler={gruppen.error} />;
  if (!gruppen.data) return <PipelineLaden />;

  const anzahlNachTyp = new Map(gruppen.data.gruppen.map((g) => [g.wert, g.anzahl]));
  const standardGruppe = DEALTYPGRUPPEN.find((typ) => (anzahlNachTyp.get(typ) ?? 0) > 0);

  return (
    <div className="app-gruppen app-pipeline-gruppen">
      {DEALTYPGRUPPEN.map((typ) => {
        const key = typ ?? "ohne";
        const name = dealtypName(typ, sprache);
        const anzahl = anzahlNachTyp.get(typ) ?? 0;
        const offen = geoeffnet[key] ?? typ === standardGruppe;
        const id = `${gruppenId}-${key}`;
        return (
          <div className="app-gruppe-block" key={key}>
            <h2 className="app-gruppe-block__kopf">
              <button type="button" className="app-gruppe-block__knopf" aria-expanded={offen} aria-controls={id}
                aria-label={`${name} ${t.dealflow.etikett(anzahl)}`}
                onClick={() => setGeoeffnet((alt) => ({ ...alt, [key]: !offen }))}>
                {offen ? <CaretDownIcon /> : <CaretRightIcon />}
                <span className="app-gruppe-block__name">{name}</span>{" "}
                <span className="app-gruppe-block__anzahl">{anzahl}</span>
              </button>
            </h2>
            <div id={id} hidden={!offen}>
              {offen ? ergebnis(mitBedingung(basis.filter, typ
                ? { feld: "dealtyp", operator: "ist", wert: typ }
                : { feld: "dealtyp", operator: "leer" }), typ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DealPipelineBoard({ basis, label, gruppeName, board, onNeu, onListe }: {
  basis: AbfrageEingabe;
  label: string;
  gruppeName?: string;
  board: ErgebnisProps["board"];
  onNeu?: (phase?: string) => void;
  onListe: () => void;
}) {
  const t = useT();
  const abfrage = useQuery({ ...crmBoard("deal", basis, "phase", "ticket"), placeholderData: undefined });
  if (abfrage.isError) return <FehlerHinweis fehler={abfrage.error} />;
  if (!abfrage.data) return <PipelineLaden />;

  const { spalten, bezuege } = abfrage.data;
  const anzahl = spalten.reduce((summe, spalte) => summe + spalte.anzahl, 0);
  const ausserhalb = anzahl - spalten.reduce((summe, spalte) => summe + spalte.karten.length, 0);
  if (anzahl === 0 && !gruppeName) {
    return <Leer zeichen="D" titel={t.dealflow.keineDeals} beschreibung={t.dealflow.keineDealsBeschreibung}
      aktion={onNeu ? <Button onClick={() => onNeu()}>{t.dealflow.neuerDeal}</Button> : undefined} />;
  }
  return (
    <div className="app-pipeline-board">
      <Board {...board} beschriftung={label} spaltenZusatz={gruppeName} spalten={spalten} bezuege={bezuege} onNeu={onNeu} />
      {ausserhalb > 0 ? <Button variante="ruhig" groesse="s" onClick={onListe}>{t.crm.pipelineKartenlimit(ausserhalb)}</Button> : null}
    </div>
  );
}

function DealPipelineListe({ basis, label, onSortieren }: {
  basis: AbfrageEingabe;
  label: string;
  onSortieren: (feld: string) => void;
}) {
  const t = useT();
  const sprache = useSprache();
  const [offset, setOffset] = useState(0);
  const abfrage = useQuery(crmAbfrage("deal", {
    ...basis,
    spalten: LISTENFELDER.map((feld) => ({ feld })),
    limit: SEITENGROESSE,
    offset,
  }));

  if (abfrage.isError) return <FehlerHinweis fehler={abfrage.error} />;
  if (!abfrage.data) return <PipelineLaden />;

  const { daten, gesamt, bezuege } = abfrage.data;
  const f = t.dealflow;
  const s = t.crm.systemfelder;
  const ohne = t.gemeinsam.keinWert;
  const sortierung = basis.sortierung?.[0];
  const spalten: TabelleSpalte<Zeile>[] = [
    { schluessel: "titel", kopf: f.spalten.titel, sortierbar: true, zelle: (d) => <Datensatzlink objekt="deal" id={d.id}>{String(d.titel ?? "")}</Datensatzlink> },
    { schluessel: "unternehmen", kopf: s.unternehmen, sortierbar: true, zelle: (d) => typeof d.unternehmen === "string" ? (
      <Datensatzlink objekt="organisation" id={d.unternehmen}>{bezuege[`organisation:${d.unternehmen}`] ?? ohne}</Datensatzlink>
    ) : ohne },
    { schluessel: "dealtyp", kopf: s.dealtyp, sortierbar: true, zelle: (d) => dealtypName((d.dealtyp ?? null) as PipelineDealtyp, sprache) },
    { schluessel: "phase", kopf: f.spalten.phase, sortierbar: true, zelle: (d) => t.dealPhase[d.phase as Deal["phase"]] ?? ohne },
    { schluessel: "status", kopf: f.spalten.status, sortierbar: true, zelle: (d) => {
      const status = d.status as Deal["status"];
      return t.dealStatus[status] ? <Status variante={STATUS_VARIANTE[status]}>{t.dealStatus[status]}</Status> : ohne;
    } },
    { schluessel: "ticket", kopf: s.ticket, sortierbar: true, zahl: true, zelle: (d) => typeof d.ticket === "string" ? formatBetrag(d.ticket, sprache) : ohne },
    { schluessel: "investmentmanager", kopf: s.investmentmanager, sortierbar: true, zelle: (d) => String(d.investmentmanager ?? ohne) },
    { schluessel: "projektleiter", kopf: s.projektleiter, sortierbar: true, zelle: (d) => String(d.projektleiter ?? ohne) },
  ];

  return (
    <div className="app-pipeline-liste" aria-busy={abfrage.isPlaceholderData}>
      <Tabelle key={abfrage.data.offset} beschriftung={label} spalten={spalten} zeilen={daten} zeilenSchluessel={(d) => d.id}
        sortierung={sortierung && { schluessel: sortierung.feld, richtung: sortierung.richtung }}
        onSortieren={onSortieren} dicht leer={f.keineDealsBeschreibung}
      />
      {gesamt > SEITENGROESSE || offset > 0 ? (
        <div className="app-pipeline-liste__navigation">
          <span role="status">{t.crm.pipelineAnzeige(daten.length > 0 ? abfrage.data.offset + 1 : 0, abfrage.data.offset + daten.length, gesamt)}</span>
          <Button groesse="s" variante="sekundaer" disabled={offset === 0 || abfrage.isPlaceholderData}
            onClick={() => setOffset((alt) => Math.max(0, alt - SEITENGROESSE))}>{t.crm.pipelineZurueck}</Button>
          <Button groesse="s" variante="sekundaer" disabled={offset + SEITENGROESSE >= gesamt || abfrage.isPlaceholderData}
            onClick={() => setOffset((alt) => alt + SEITENGROESSE)}>{t.crm.pipelineWeiter}</Button>
        </div>
      ) : null}
    </div>
  );
}

function PipelineLaden() {
  return <div aria-hidden="true">
    {Array.from({ length: 4 }, (_, i) => <div key={i} className="app-skelett app-skelett--zeile" />)}
  </div>;
}
