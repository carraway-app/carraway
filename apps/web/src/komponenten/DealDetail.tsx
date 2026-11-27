import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Auswahl, Button, Detailbereich, Fakten, Status, formatBetrag, formatDatum } from "@carraway/ui";
import { dealDetail } from "../api/abfragen";
import type { Arbeitsdeal } from "../api/dealflow";
import { usePhaseAendern, type DealPhase } from "../api/mutationen";
import { PHASEN } from "./crm/typen";
import { STATUS_VARIANTE } from "./DealPipelineErgebnisse";
import { Schnellaktionen } from "./crm/Zelle";
import { DealZuordnungDialog } from "./DealZuordnungDialog";
import { FehlerHinweis } from "./FehlerHinweis";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { DATENSPRACHE } from "../lib/datensprache";
import { useNamen } from "../lib/namen";
import { useRechte } from "../lib/rechte";

/**
 * Deal im Detailbereich des Dealflows: Eckdaten, letzte Aktivität und die häufigen Aktionen sichtbar (Phase ändern, Zuweisen); „Deal öffnen“
 * führt auf die volle Seite.
 */
export function DealDetail({ id, arbeitsdeal, darfZuordnen, onSchliessen }: { id: string; arbeitsdeal?: Arbeitsdeal | undefined; darfZuordnen: boolean; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.dealflow;
  const { data: d, error } = useQuery(dealDetail(id));
  const phaseAendern = usePhaseAendern();
  const { darf } = useRechte();
  const [zuordnen, setZuordnen] = useState(false);
  const name = useNamen(d ? [d.investmentmanagerId, d.projektleiterId] : []);
  const keinWert = t.gemeinsam.keinWert;
  if (error) return <Detailbereich titel={keinWert} onSchliessen={onSchliessen}><FehlerHinweis fehler={error} /></Detailbereich>;
  if (!d) return <Detailbereich titel={arbeitsdeal?.titel ?? t.gemeinsam.laedt} onSchliessen={onSchliessen}><div className="app-skelett app-skelett--zeile" /></Detailbereich>;
  const schreiben = d.status === "offen" && darf("bearbeiter", d.fondsId, "dealflow");
  const letzte = d.aktivitaeten[0];
  return (
    <>
      <Detailbereich
        titel={d.titel}
        titelSprache={DATENSPRACHE}
        onSchliessen={onSchliessen}
        meta={
          <>
            <Status variante={STATUS_VARIANTE[d.status]}>{aufzaehlung(t.dealStatus, d.status)}</Status>
            <span>{aufzaehlung(t.dealPhase, d.phase)}</span>
            {d.organisation && "email" in d.organisation ? <Schnellaktionen werte={{ email: d.organisation.email, telefon: d.organisation.telefon, website: d.organisation.website, linkedin: d.organisation.linkedin }} name={d.organisation.name} /> : null}
          </>
        }
        aktionen={
          <>
            <Link to="/deals/$id" params={{ id: d.id }} className="cw-button cw-button--s">
              {f.dealOeffnen}
            </Link>
            {arbeitsdeal && darfZuordnen ? (
              <Button groesse="s" variante="sekundaer" onClick={() => setZuordnen(true)}>
                {f.zuweisen}
              </Button>
            ) : null}
          </>
        }
      >
        <FehlerHinweis fehler={phaseAendern.error} />
        {schreiben ? (
          <Auswahl kompakt label={t.deal.phaseAendern} value={d.phase} onChange={(e) => phaseAendern.mutate({ id: d.id, nachPhase: e.target.value as DealPhase })}>
            {PHASEN.map((p) => (
              <option key={p} value={p}>
                {t.dealPhase[p]}
              </option>
            ))}
          </Auswahl>
        ) : null}
        <Fakten
          darstellung="liste"
          eintraege={[
            { label: t.deal.ticket, wert: d.ticket === null ? keinWert : formatBetrag(d.ticket, sprache) },
            { label: t.beteiligung.organisation, wert: d.organisation ? <Link to="/organizations/$id" params={{ id: d.organisation.id }}>{d.organisation.name}</Link> : keinWert },
            { label: t.deal.quelle, wert: d.quelle ?? keinWert },
            { label: t.deal.fonds, wert: d.fonds?.name ?? keinWert },
            { label: f.investmentmanager, wert: name(d.investmentmanagerId) ?? keinWert },
            { label: f.projektleiter, wert: name(d.projektleiterId) ?? keinWert },
          ]}
        />
        {letzte ? (
          <p className="app-leer-text">
            {f.letzteAktivitaet}: {formatDatum(letzte.datum, sprache)} · {letzte.titel}
          </p>
        ) : null}
      </Detailbereich>
      {zuordnen && arbeitsdeal ? <DealZuordnungDialog deal={arbeitsdeal} onSchliessen={() => setZuordnen(false)} onGespeichert={() => setZuordnen(false)} /> : null}
    </>
  );
}
