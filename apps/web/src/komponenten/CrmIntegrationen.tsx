import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSprache } from "../i18n";
import { api, auspacken, ladeMitSitzung } from "../api/client";
import { FehlerHinweis } from "./FehlerHinweis";
import type { Mapping, Resource } from "@carraway/api/integrationen/provider";

const endpoint = api.api.v1.integrations;
const load = () => auspacken(endpoint.$get());
type Settings = Awaited<ReturnType<typeof load>>;
const initial: Mapping = { deals: true, notes: true, lists: [], fields: [], stages: {} };
const stages = ["inbound", "initial_meeting", "screening", "due_diligence", "investment_committee", "closing"] as const;
const targets = { organization: ["name", "domain"], person: ["firstName", "lastName", "email", "organizationId"], deal: ["name", "organizationId", "stage"], note: ["name", "body"] };
const texts = {
  de: { title: "CRM-Anbindungen", provider: "Anbieter", token: "API-Schlüssel oder Zugriffstoken", mapping: "Feldzuordnung", defaults: "Name und Domain von Organisationen sowie Name und E-Mail von Personen werden automatisch zugeordnet.", lists: "Pipeline-Listen (IDs, durch Komma getrennt)", deals: "Deals übernehmen", notes: "Notizen übernehmen", source: "Quellattribut", target: "Zielfeld", add: "Feld zuordnen", stage: "Phasen zuordnen", originStage: "Phase im CRM", addStage: "Phase hinzufügen", remove: "Entfernen", save: "Verbindung speichern", preview: "Vorschau starten", apply: "Vorschau übernehmen", cancel: "Lauf abbrechen", sync: "Synchronisierung starten", stop: "Synchronisierung beenden", runs: "Läufe", sample: "Vorschau der ersten Datensätze", skipped: "Übersprungen", counts: "Gelesen / bereits vorhanden / verarbeitet", current: "Modus", import: "Einmaliger Import", syncMode: "Laufender Abgleich", date: "Beginn", status: "Status", empty: "Bisher keine Läufe.", resource: "Datensatzart", reading: "Wird gelesen", applying: "Wird übernommen", completed: "Abgeschlossen", cancelled: "Abgebrochen", failed: "Fehlgeschlagen", ready: "Zur Freigabe", organization: "Organisation", person: "Person", deal: "Deal", note: "Notiz" },
  en: { title: "CRM integrations", provider: "Provider", token: "API key or access token", mapping: "Field mapping", defaults: "Organization name and domain, and person name and email are mapped automatically.", lists: "Pipeline lists (comma-separated IDs)", deals: "Include deals", notes: "Include notes", source: "Source attribute", target: "Target field", add: "Map a field", stage: "Map stages", originStage: "CRM stage", addStage: "Add stage", remove: "Remove", save: "Save connection", preview: "Start preview", apply: "Approve preview", cancel: "Cancel run", sync: "Start synchronization", stop: "Stop synchronization", runs: "Runs", sample: "Preview of the first records", skipped: "Skipped", counts: "Read / already present / processed", current: "Mode", import: "One-time import", syncMode: "Continuous sync", date: "Started", status: "Status", empty: "No runs yet.", resource: "Record type", reading: "Reading", applying: "Applying", completed: "Completed", cancelled: "Cancelled", failed: "Failed", ready: "Awaiting approval", organization: "Organization", person: "Person", deal: "Deal", note: "Note" },
};
const fieldLabels: Record<string, [string, string]> = {
  name: ["Name", "Name"], domain: ["Domain", "Domain"], firstName: ["Vorname", "First name"], lastName: ["Nachname", "Last name"], email: ["E-Mail", "Email"],
  organizationId: ["Organisations-ID", "Organization ID"], stage: ["Phase", "Stage"], body: ["Notiztext", "Note text"], inbound: ["Anfrage", "Inbound"],
  initial_meeting: ["Erstgespräch", "Initial meeting"], screening: ["Prüfung", "Screening"], due_diligence: ["Due Diligence", "Due diligence"],
  investment_committee: ["Investitionsausschuss", "Investment committee"], closing: ["Closing", "Closing"],
};
const runErrors: Record<string, [string, string]> = {
  provider_rate_limit: ["Abruflimit erreicht.", "Provider rate limit reached."], missing_related_record: ["Ein verknüpfter Quelldatensatz fehlt.", "A linked source record is missing."],
  ambiguous_duplicate: ["Mehrere lokale Datensätze passen zur Domain oder E-Mail.", "Several local records match the domain or email."],
  invalid_custom_value: ["Ein Wert passt nicht zum gewählten Feldtyp.", "A value does not fit the selected field type."],
  invalid_custom_field: ["Das Zielfeld ist unbekannt oder archiviert.", "The target field is unknown or archived."],
  deal_requires_company_and_title: ["Dem Deal fehlt eine Organisation oder ein Titel.", "The deal needs a company and a title."],
  provider_http_401: ["Der Anbieter hat die Zugangsdaten abgelehnt.", "The provider rejected the credential."],
  provider_http_403: ["Dem Token fehlen Leserechte.", "The token lacks read access."],
  resolution_missing: ["Für das Closing fehlt ein zustimmender Beschluss.", "Closing requires an approving resolution."],
  missing_name: ["Der Name fehlt.", "The name is missing."],
  invalid_record: ["Der Quelldatensatz enthält ungültige Werte.", "The source record contains invalid values."],
  invalid_field_value: ["Der Anbieterwert passt nicht zum Zielfeld.", "The source value does not fit the target field."],
  invalid_domain: ["Die Domain ist ungültig.", "The domain is invalid."],
  restricted_record: ["Die Leseberechtigung für den Datensatz fehlt.", "Read access to the record is missing."],
  locally_archived: ["Der lokale Datensatz ist archiviert.", "The local record is archived."],
  missing_external_id: ["Die externe ID fehlt.", "The external ID is missing."],
  note_requires_parent: ["Für die Notiz fehlt ein Bezugsdatensatz.", "The note needs a related record."],
  provider_owner_conflict: ["Eine andere Quelle führt den Datensatz.", "Another source manages this record."],
  provider_processing_failed: ["Die Verarbeitung ist fehlgeschlagen.", "Processing failed."],
};
export default function CrmIntegrationen() {
  const settings = useQuery({ queryKey: ["integrations"], queryFn: load });
  const [choice, select] = useState("");
  const t = texts[useSprache()];
  if (settings.error) return <FehlerHinweis fehler={settings.error} />;
  if (!settings.data) return <section aria-busy="true" />;
  const provider = choice || settings.data.providers[0];
  return <><h2>{t.title}</h2><label>{t.provider} <select value={provider ?? ""} onChange={e => select(e.target.value)}>{settings.data.providers.map(id => <option key={id} value={id}>{id === "attio" ? "Attio" : id === "affinity" ? "Affinity" : id}</option>)}</select></label>
    {provider && <Connection key={provider} provider={provider} settings={settings.data} />}</>;
}
function Connection({ provider, settings }: { provider: string; settings: Settings }) {
  const language = useSprache();
  const t = texts[language];
  const column = language === "de" ? 0 : 1;
  const client = useQueryClient();
  const conn = settings.data.find(c => c.provider === provider);
  const [mapping, set] = useState<Mapping>(() => conn?.mapping as Mapping ?? initial);
  const [listText, setLists] = useState(mapping.lists.join(", "));
  const [stageRows, setStages] = useState(Object.entries(mapping.stages));
  const [credential, token] = useState("");
  const runs = useQuery({ queryKey: ["integrations", provider, "runs"], queryFn: () => auspacken(endpoint[":provider"].runs.$get({ param: { provider } })), enabled: !!conn, refetchInterval: conn ? 3000 : false });
  const action = useMutation({ mutationFn: async ({ path, method, body }: { path: string; method: string; body?: object }) => {
    await auspacken(ladeMitSitzung(new URL("/api/v1/integrations/" + path, window.location.origin).href, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) }));
  }, onSuccess: async () => { token(""); await client.invalidateQueries({ queryKey: ["integrations"] }); } });
  const latest = runs.data?.data[0];
  const active = latest && ["reading", "preview", "applying"].includes(latest.status);
  const sync = conn?.mode === "sync";
  const busy = action.isPending;
  function updateField(index: number, update: Partial<Mapping["fields"][number]>) {
    set({ ...mapping, fields: mapping.fields.map((f, i) => i === index ? { ...f, ...update } : f) });
  }
  const post = (path: string) => action.mutate({ path, method: "POST" });
  return <>
    <p>{t.current} · {sync ? t.syncMode : t.import}</p>
    <form onSubmit={e => { e.preventDefault(); action.mutate({ path: provider, method: "PUT", body: { credential: credential || undefined, mapping: { ...mapping, lists: listText.split(",").map(s => s.trim()).filter(Boolean), stages: Object.fromEntries(stageRows) } } }); }}>
      <fieldset disabled={!!active || busy || sync}><legend>{t.mapping}</legend>
        <label>{t.token} <input type="password" autoComplete="new-password" required={!conn} value={credential} onChange={e => token(e.target.value)} /></label>
        <p>{t.defaults}</p>
        <label><input type="checkbox" checked={mapping.deals} onChange={e => set({ ...mapping, deals: e.target.checked })} />{t.deals}</label>
        <label><input type="checkbox" checked={mapping.notes} onChange={e => set({ ...mapping, notes: e.target.checked })} />{t.notes}</label>
        <p><label>{t.lists} <input value={listText} onChange={e => setLists(e.target.value)} /></label></p>
        {mapping.fields.map((f, i) => <div key={i}>
          <select aria-label={t.resource} value={f.resource} onChange={e => { const resource = e.target.value as Resource; updateField(i, { resource, target: targets[resource][0]! }); }}>{Object.keys(targets).map(r => <option key={r} value={r}>{t[r as Resource]}</option>)}</select>
          <input aria-label={t.source} placeholder={t.source} value={f.source} required onChange={e => updateField(i, { source: e.target.value })} />
          <select aria-label={t.target} value={f.target} onChange={e => updateField(i, { target: e.target.value })}>{targets[f.resource].map(k => <option key={k} value={k}>{fieldLabels[k]?.[column] ?? k}</option>)}{settings.customFields.filter(d => d.resource === f.resource).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <button type="button" onClick={() => set({ ...mapping, fields: mapping.fields.filter((_, idx) => i !== idx) })}>{t.remove}</button>
        </div>)}
        <button type="button" onClick={() => set({ ...mapping, fields: [...mapping.fields, { resource: "organization", source: "", target: "name" }] })}>{t.add}</button>
        <h3>{t.stage}</h3>{stageRows.map(([from, to], i) => <div key={i}>
          <input aria-label={t.originStage} placeholder={t.originStage} value={from} required onChange={e => setStages(stageRows.map((row, idx) => idx === i ? [e.target.value, to] : row))} />
          <select aria-label={t.target} value={to} onChange={e => setStages(stageRows.map((row, idx) => idx === i ? [from, e.target.value as typeof to] : row))}>{stages.map(s => <option key={s} value={s}>{fieldLabels[s]?.[column] ?? s}</option>)}</select>
          <button type="button" onClick={() => setStages(stageRows.filter((_, idx) => idx !== i))}>{t.remove}</button>
        </div>)}<button type="button" onClick={() => setStages([...stageRows, ["", "inbound"]])}>{t.addStage}</button>
        <p><button type="submit">{t.save}</button></p>
      </fieldset>
    </form>
    {conn && <p>{!sync && !active && <button disabled={busy} onClick={() => post(provider + "/preview")}>{t.preview}</button>}
      {settings.syncAvailable && (sync || !active) && <button disabled={busy} onClick={() => action.mutate({ path: provider + "/mode", method: "PUT", body: { mode: sync ? "import" : "sync" } })}>{sync ? t.stop : t.sync}</button>}
      {latest?.status === "preview" && <button disabled={busy} onClick={() => post("runs/" + latest.id + "/apply")}>{t.apply}</button>}
      {active && <button disabled={busy} onClick={() => post("runs/" + latest.id + "/cancel")}>{t.cancel}</button>}</p>}
    {action.error && <FehlerHinweis fehler={action.error} />}{runs.error && <FehlerHinweis fehler={runs.error} />}
    {!!runs.data?.sample.length && <details open><summary>{t.sample}</summary>{runs.data.sample.map((s,i) => <pre key={i}>{JSON.stringify(s.record, null, 2)}</pre>)}</details>}
    {conn && <><h3>{t.runs}</h3>{!latest ? <p>{t.empty}</p> : <table><thead><tr><th>{t.date}</th><th>{t.status}</th><th>{t.counts}</th><th>{t.skipped}</th></tr></thead><tbody>{runs.data?.data.map(r => <tr key={r.id}><td>{new Date(r.createdAt).toLocaleString(language)}</td><td>{t[r.status === "preview" ? "ready" : r.status as "reading"]} {r.error && (runErrors[r.error]?.[column] ?? r.error)}</td><td>{r.received} / {r.matched} / {r.applied}</td>
      <td>{r.skipped}{Object.entries(r.skipReasons).map(([reason, count]) => <div key={reason}>{count} × {runErrors[reason]?.[column] ?? reason}</div>)}</td></tr>)}</tbody></table>}</>}
  </>;
}
