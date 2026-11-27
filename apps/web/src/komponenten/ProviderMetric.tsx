import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, auspacken } from "../api/client";
import { kennzahlKatalog } from "../api/kennzahlen";
import { useSprache } from "../i18n";
import { FehlerHinweis } from "./FehlerHinweis";

export type MetricTarget = { id: string; label: string };
export function ProviderMetric({ targets, suggestionId, organizationId, field, value }: {
  targets: MetricTarget[]; suggestionId: string; organizationId: string; field: string; value: string;
}) {
  const de = useSprache() === "de";
  const [open, setOpen] = useState(false);
  const [investmentId, setInvestment] = useState(targets[0]?.id ?? "");
  const [metricKey, setMetric] = useState("");
  const [periodStart, setStart] = useState("");
  const catalog = useQuery({ ...kennzahlKatalog(), enabled: open });
  const unit = value.split(" ")[1] ?? "";
  const end = field.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  const client = useQueryClient();
  const save = useMutation({ mutationFn: () => auspacken(api.api.v1.investments[":id"].metrics["provider-values"].$post({
    param: { id: investmentId }, json: { metricKey, suggestionId, periodStart },
  })), onSuccess: async () => {
    await client.invalidateQueries({ queryKey: ["provider-data", organizationId] });
    await client.invalidateQueries({ queryKey: ["kennzahlen"] });
  } });
  if (!open) return <button onClick={() => setOpen(true)}>{de ? "Als Kennzahl übernehmen" : "Import as metric"}</button>;
  return <form onSubmit={e => { e.preventDefault(); save.mutate(); }}>
    <label>{de ? "Beteiligung" : "Investment"} <select value={investmentId} onChange={e => setInvestment(e.target.value)}>{targets.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}</select></label>
    <label>{de ? "Kennzahl" : "Metric"} <select required value={metricKey} onChange={e => setMetric(e.target.value)}>
      <option value="">{de ? "Auswählen" : "Select"}</option>
      {catalog.data?.filter(m => ["zahl", "betrag"].includes(m.typ) && (m.einheit === unit || (!unit && m.typ === "zahl"))).map(m =>
        <option key={m.schluessel} value={m.schluessel}>{de ? m.bezeichnungDe : m.bezeichnungEn} ({m.einheit})</option>)}
    </select></label>
    <label>{de ? "Beginn der Berichtsperiode" : "Reporting period start"} <input type="date" max={end} required value={periodStart} onChange={e => setStart(e.target.value)} /></label>
    <button disabled={save.isPending}>{de ? "Kennzahlenentwurf speichern" : "Save draft metric"}</button>
    <button type="button" onClick={() => setOpen(false)}>{de ? "Abbrechen" : "Cancel"}</button>
    {(catalog.error || save.error) && <FehlerHinweis fehler={catalog.error ?? save.error} />}
  </form>;
}
