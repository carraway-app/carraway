import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, auspacken } from "../api/client";
import { useSprache } from "../i18n";
import { ProviderMetric, type MetricTarget } from "./ProviderMetric";
import { FehlerHinweis } from "./FehlerHinweis";

const endpoint = api.api.v1.organizations[":id"]["provider-data"];
const fields: Record<string, [string,string]> = {
  name: ["Name","Name"], city: ["Sitz","Location"], legalForm: ["Rechtsform","Legal form"], sector: ["Sektor","Sector"],
  registerCourt: ["Registergericht","Register court"], registerNumber: ["Registernummer","Register number"],
  companyStatus: ["Unternehmensstatus","Company status"], representatives: ["Vertretungsberechtigte","Officers"],
};
function Retrieval({ id, name, provider }: { id: string; name: string; provider: { id: string; label: string; searchable: boolean; reference: string | null } }) {
  const de = useSprache() === "de";
  const client = useQueryClient();
  const [query, setQuery] = useState(name);
  const param = { id };
  const search = useMutation({ mutationFn: () => auspacken(endpoint.search.$post({ param, json: { provider: provider.id, query } })) });
  const fetch = useMutation({ mutationFn: (reference?: string) => auspacken(endpoint.fetch.$post({ param, json: { provider: provider.id, reference } })),
    onSuccess: async () => {
      search.reset();
      for (const key of [["provider-data", id], ["register"], ["external-funding-rounds", id]]) await client.invalidateQueries({ queryKey: key });
    } });
  return <fieldset disabled={search.isPending || fetch.isPending}><legend>{provider.label}</legend>
    {provider.searchable ? <form onSubmit={e => { e.preventDefault(); search.mutate(); }}>
      <label>{de ? "Firma oder Registernummer" : "Company name or number"} <input required value={query} onChange={e => { setQuery(e.target.value); search.reset(); }} /></label>
      <button>{de ? "Suchen" : "Search"}</button>
    </form> : <button onClick={() => fetch.mutate(undefined)}>{de ? "Unternehmenswebsite auslesen" : "Read company website"}</button>}
    {provider.reference && <button onClick={() => fetch.mutate(provider.reference!)}>{de ? "Verknüpften Registereintrag abrufen" : "Refresh linked register record"} · {provider.reference}</button>}
    {search.data?.data.length === 0 && <p>{de ? "Keine Treffer." : "No matches."}</p>}
    {search.data?.data.map(hit => <p key={hit.reference}>{[hit.name, hit.reference, hit.location].filter(Boolean).join(" · ")} <button onClick={() => fetch.mutate(hit.reference)}>{de ? "Daten abrufen" : "Retrieve data"}</button></p>)}
    {fetch.isSuccess && <p role="status">{de ? "Abruf abgeschlossen." : "Retrieval complete."}</p>}
    {(search.error || fetch.error) && <FehlerHinweis fehler={search.error ?? fetch.error} />}
  </fieldset>;
}
export default function CompanyProviders({ id, name, edit, targets }: { id: string; name: string; edit: boolean; targets: MetricTarget[] }) {
  const lang = useSprache();
  const de = lang === "de";
  const client = useQueryClient();
  const data = useQuery({ queryKey: ["provider-data", id], queryFn: () => auspacken(endpoint.$get({ param: { id } })) });
  const review = useMutation({ mutationFn: ({ suggestionId, decision }: { suggestionId: string; decision: "accepted" | "rejected" }) =>
    auspacken(endpoint[":suggestionId"].review.$post({ param: { id, suggestionId }, json: { decision } })),
    onSuccess: async () => {
      for (const key of [["provider-data", id], ["organisationen"], ["register"]]) await client.invalidateQueries({ queryKey: key });
    } });
  if (data.error) return <FehlerHinweis fehler={data.error} />;
  if (!data.data || (!data.data.providers.length && !data.data.data.length)) return null;
  return <section><h3>{de ? "Datenanbieter" : "Data providers"}</h3>
    {edit && data.data.providers.map(p => <Retrieval key={p.id + id} id={id} name={name} provider={p} />)}
    {!!data.data.data.length && <table><caption>{de ? "Feldvorschläge und Herkunft" : "Field suggestions and provenance"}</caption><thead><tr>
      {(de ? ["Feld", "Bisher", "Anbieterwert", "Quelle und Abruf", "Prüfung"] : ["Field", "Previous value", "Provider value", "Source and retrieval", "Review"]).map(t => <th key={t}>{t}</th>)}
    </tr></thead><tbody>{data.data.data.map(s => <tr key={s.id}><th>{fields[s.field]?.[de ? 0 : 1] ?? s.field.replace(/^financial\./, "").replaceAll(".", " · ")}</th>
      <td>{s.previousValue ?? "—"}</td><td style={{ whiteSpace: "pre-line" }}>{s.value}</td>
      <td><a href={s.sourceUrl} target="_blank" rel="noreferrer">{data.data.providers.find(p => p.id === s.provider)?.label ?? s.provider}</a><br/>{new Date(s.retrievedAt).toLocaleString(lang)}</td>
      <td>{s.status === "pending" && edit && s.current ? <><button disabled={review.isPending} onClick={() => review.mutate({ suggestionId: s.id, decision: "accepted" })}>{de ? "Übernehmen" : "Accept"}</button>
        <button disabled={review.isPending} onClick={() => review.mutate({ suggestionId: s.id, decision: "rejected" })}>{de ? "Verwerfen" : "Reject"}</button>
        {!!targets.length && s.field.startsWith("financial.") && <ProviderMetric targets={targets} field={s.field} value={s.value} organizationId={id} suggestionId={s.id} />}</> :
        s.status === "accepted" ? (de ? "Übernommen" : "Accepted") : s.status === "rejected" ? (de ? "Verworfen" : "Rejected") : (de ? "Offen" : "Pending")}</td>
    </tr>)}</tbody></table>}
    {!!data.data.provenance.length && <details><summary>{de ? "Herkunft der übernommenen Felder" : "Sources of accepted company fields"}</summary>
      <ul>{data.data.provenance.map(s => <li key={s.id}>{fields[s.field]?.[de ? 0 : 1] ?? s.field} · {s.value} · <a href={s.sourceUrl} target="_blank" rel="noreferrer">{s.provider}</a> · {new Date(s.retrievedAt).toLocaleString(lang)}</li>)}</ul>
    </details>}
    {review.error && <FehlerHinweis fehler={review.error} />}
  </section>;
}
