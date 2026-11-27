import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, auspacken } from "../api/client";
import { useSprache, useT } from "../i18n";
import { FehlerHinweis } from "./FehlerHinweis";

const endpoint = api.api.v1["data-providers"];
const load = () => auspacken(endpoint.$get());
type Row = Awaited<ReturnType<typeof load>>["data"][number];
export default function DataProviderSettings() {
  const query = useQuery({ queryKey: ["data-providers"], queryFn: load });
  return <>{query.error && <FehlerHinweis fehler={query.error} />}{query.data?.data.map(row => <ProviderSettings key={row.id} row={row} />)}</>;
}
function ProviderSettings({ row }: { row: Row }) {
  const lang = useSprache();
  const labels = useT();
  const de = lang === "de";
  const [key, setKey] = useState("");
  const [limit, setLimit] = useState(row.monthlyLimit?.toString() ?? "");
  const client = useQueryClient();
  const api = endpoint[":provider"];
  const param = { provider: row.id };
  const mutation = useMutation({
    mutationFn: async (action: "save" | "test" | "remove") => {
      if (action === "save") await auspacken(api.$put({ param, json: { credential: key || undefined, monthlyLimit: limit ? Number(limit) : null } }));
      if (action === "test") await auspacken(api.test.$post({ param }));
      if (action === "remove") await auspacken(api.$delete({ param }));
    },
    onSuccess: () => setKey(""),
    onSettled: () => client.invalidateQueries({ queryKey: ["data-providers"] }),
  });
  const status = row.lastError ? (labels.fehler as Record<string,string>)[row.lastError] ?? row.lastError :
    !row.configured ? (de ? "Kein Schlüssel" : "No key") : row.checkedAt ? (de ? "Erreichbar" : "Available") : (de ? "Ungeprüft" : "Untested");
  return <section><h3>{row.label}</h3>
    <p role="status">{status}{row.checkedAt && " · " + new Date(row.checkedAt).toLocaleString(lang)}</p>
    <p>{de ? "Abrufe im laufenden Monat (UTC)" : "Requests this month (UTC)"} · {row.calls}</p>
    <form onSubmit={e => { e.preventDefault(); mutation.mutate("save"); }}>
      <fieldset disabled={mutation.isPending}><legend>{de ? "Zugang" : "Access"}</legend>
        <label>{de ? "API-Schlüssel" : "API key"} <input type="password" autoComplete="new-password" required={!row.configured} value={key} onChange={e => setKey(e.target.value)} /></label>
        <label>{de ? "Monatslimit (optional)" : "Monthly cap (optional)"} <input type="number" min="1" max="10000000" value={limit} onChange={e => setLimit(e.target.value)} /></label>
        <button type="submit">{de ? "Speichern" : "Save"}</button>
        {row.configured && <><button type="button" onClick={() => mutation.mutate("test")}>{de ? "Zugang testen" : "Test access"}</button>
          <button type="button" onClick={() => mutation.mutate("remove")}>{de ? "Schlüssel entfernen" : "Remove key"}</button></>}
      </fieldset>
    </form>
    {mutation.error && <FehlerHinweis fehler={mutation.error} />}
  </section>;
}
