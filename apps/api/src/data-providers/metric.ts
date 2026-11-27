import { and, eq } from "drizzle-orm";
import { beteiligung, providerSuggestion } from "@carraway/db";
import { Fachfehler } from "../fehler";
import { legeKennzahlEntwurfAn } from "../kpi/wert";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { activeCompany, review, stale } from "./reconcile";

export async function importMetric(tx: Tx, audit: Protokollant, investmentId: string, suggestionId: string, metricKey: string, periodStart: string, providers: readonly string[]) {
  const [holding] = await tx.select().from(beteiligung).where(eq(beteiligung.id, investmentId));
  if (!holding) throw new Fachfehler(404, "investment_not_found", "Investment not found.");
  await activeCompany(tx, holding.organisationId, true);
  const [row] = await tx.select().from(providerSuggestion).where(and(eq(providerSuggestion.id, suggestionId), eq(providerSuggestion.organizationId, holding.organisationId))).for("update");
  if (!row?.current || row.status !== "pending") throw stale();
  const financial = /^financial\.(.+)\.(\d{4}-\d{2}-\d{2})(?:\.consolidated)?$/.exec(row.field);
  const amount = /^(-?\d+(?:\.\d+)?)(?: (.+))?$/.exec(row.value);
  if (!financial || !amount) throw new Fachfehler(400, "invalid_input", "A numeric account indicator is required.");
  const { zeile, definition } = await legeKennzahlEntwurfAn(tx, audit, investmentId, {
    schluessel: metricKey, periodeBeginn: periodStart, periodeEnde: financial[2]!, wert: amount[1]!, szenario: "ist",
    quellenangabe: [row.provider, row.reference, row.field, row.sourceUrl].join(" · "),
  }, "import");
  const unit = amount[2] ?? "";
  if (!["zahl", "betrag"].includes(definition.typ) || (definition.einheit !== unit && !(unit === "" && definition.typ === "zahl"))) {
    throw new Fachfehler(400, "invalid_input", "Select a numeric definition in the reported unit.");
  }
  await review(tx, audit, holding.organisationId, suggestionId, "accepted", providers);
  await tx.update(providerSuggestion).set({ metricValueId: zeile.id }).where(eq(providerSuggestion.id, row.id));
  return zeile.id;
}
