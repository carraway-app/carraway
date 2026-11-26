import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Feld, Fakten, Seitenpanel, formatDatum } from "@carraway/ui";
import { api, auspacken } from "../api/client";
import { heuteIso } from "../api/datum";
import { dokumenteZiel, dokumentSeiteUrl } from "../api/dokumente";
import { useApiMutation } from "../api/mutationen";
import { schluessel } from "../api/abfragen";
import { useSprache, useT } from "../i18n";
import { betragRegel, datumRegel, pflichtRegel } from "../lib/feldpruefung";
import type { InstrumentZeile } from "../lib/instrumente";
import { formatBetragCent } from "../lib/zahl";
import { BetragFeld } from "./BetragFeld";
import { FehlerHinweis } from "./FehlerHinweis";
import { betragOderNichts, useFormular } from "./formular";
import { Rechenweg } from "./Rechenweg";

export default function VerzichtDialog({ instrument, beteiligungId, onSchliessen }: { instrument: InstrumentZeile; beteiligungId: string; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.verzicht;
  const dokumente = useQuery(dokumenteZiel("beteiligung", beteiligungId));
  const route = api.api.v1.instruments[":id"].waivers;
  const param = { id: instrument.id };
  const key = ["waivers", instrument.id];
  const bestand = useQuery({ queryKey: key, queryFn: () => auspacken(route.$get({ param })) });
  const invalidiert = () => [key, schluessel.beteiligungen, schluessel.fonds, schluessel.zinslaeufe];
  const { werte, feld, pruefeAlle } = useFormular(
    { date: heuteIso(), principal: "", interest: "", reason: "", documentId: "" },
    { date: datumRegel({ pflicht: true }), principal: betragRegel(), interest: betragRegel(), reason: pflichtRegel() },
  );
  const eingabe = { date: werte.date, principal: betragOderNichts(werte.principal, sprache) ?? "0", interest: betragOderNichts(werte.interest, sprache) ?? "0", reason: werte.reason.trim(), ...(werte.documentId ? { documentId: werte.documentId } : {}) };
  const vorschau = useApiMutation({ aufruf: (json: typeof eingabe) => auspacken(route.preview.$post({ param, json })), invalidiert: () => [] });
  const buchen = useApiMutation({ aufruf: (json: typeof eingabe) => auspacken(route.$post({ param, json })), invalidiert });
  const storno = useApiMutation({ aufruf: ({ waiverId, reason }: { waiverId: string; reason: string }) => auspacken(route[":waiverId"].reverse.$post({ param: { ...param, waiverId }, json: { reason } })), invalidiert });
  const [stornoId, setStornoId] = useState("");
  const [grund, setGrund] = useState("");
  const plan = JSON.stringify(vorschau.variables) === JSON.stringify(eingabe) ? vorschau.data?.result : undefined;
  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titel} · {instrument.bezeichnung}</h2>
      <form className="app-formular" onSubmit={(e) => {
        e.preventDefault();
        if (!pruefeAlle()) return;
        if (plan) buchen.mutate(eingabe, { onSuccess: onSchliessen });
        else vorschau.mutate(eingabe);
      }}>
        <FehlerHinweis fehler={buchen.error ?? vorschau.error} />
        <Feld type="date" label={f.datum} {...feld("date")} />
        <BetragFeld label={f.kapital} {...feld("principal")} />
        <BetragFeld label={f.zinsen} {...feld("interest")} />
        <Feld label={f.grund} {...feld("reason")} maxLength={500} />
        <Auswahl label={f.dokument} {...feld("documentId")}>
          <option value="">{t.gemeinsam.keinWert}</option>
          {dokumente.data?.map((d) => <option key={d.id} value={d.id}>{d.dateiname}</option>)}
        </Auswahl>
        {plan ? <>
          <Fakten eintraege={[
            { label: f.rest, wert: formatBetragCent(plan.remainingPrincipal, sprache) },
            { label: f.buchwert, wert: formatBetragCent(plan.remainingCarryingAmount, sprache) },
            { label: f.berichtigung, wert: formatBetragCent(plan.impairmentUsed, sprache) },
            { label: f.verlust, wert: formatBetragCent(plan.loss, sprache) },
          ]} />
          <Rechenweg titel={f.rechenweg} stichtag={werte.date} schritte={plan.steps.map((s) => ({ zeichen: s.sign, bezeichnung: s.label, wert: s.value, quellen: s.sources }))} />
        </> : null}
        <Button type="submit" disabled={vorschau.isPending || buchen.isPending}>{plan ? f.buchen : f.vorschau}</Button>
      </form>
      <FehlerHinweis fehler={bestand.error ?? storno.error} />
      {bestand.data?.data.map((w) => <div key={w.id}>
        <p>{formatDatum(w.date, sprache)} · {w.reason}</p>
        {w.documentId ? <a href={dokumentSeiteUrl(w.documentId)}>{dokumente.data?.find((d) => d.id === w.documentId)?.dateiname ?? f.dokument}</a> : null}
        {stornoId === w.id ? <form onSubmit={(e) => {
          e.preventDefault();
          storno.mutate({ waiverId: w.id, reason: grund.trim() }, { onSuccess: onSchliessen });
        }}>
          <Feld label={f.grund} required value={grund} onChange={(e) => setGrund(e.target.value)} />
          <Button type="submit" variante="gefahr" disabled={!grund.trim() || storno.isPending}>{f.storno}</Button>
        </form> : <Button variante="ruhig" onClick={() => { setStornoId(w.id); setGrund(""); }}>{f.storno}</Button>}
      </div>)}
    </Seitenpanel>
  );
}
