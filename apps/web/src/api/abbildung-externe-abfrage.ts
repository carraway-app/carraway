import { aufDeutsch, aufEnglisch } from "@carraway/api/kontakte/api-namen";
import { ExternerApiFehler, type Abrufer, type ExterneAbfrage, type ExternerFehler } from "../extern/abfrage";

const CODES: Record<string, ExternerFehler> = {
  metric_request_not_found: "link",
  metric_request_revoked: "widerrufen",
  metric_request_expired: "abgelaufen",
  too_many_requests: "zuViele",
  metric_request_submitted: "eingereicht",
  metric_required_missing: "pflicht",
  metric_value_invalid: "ungueltig",
  invalid_input: "ungueltig",
  metric_not_requested: "ungueltig",
};

export async function externeAnfrage(abrufer: Abrufer, token: string, methode: "GET" | "PUT" | "POST", pfad: string, koerper?: unknown): Promise<ExterneAbfrage> {
  let antwort: Response;
  try {
    antwort = await abrufer(`/api/v1/external/requests/${encodeURIComponent(token)}${pfad}`, {
      method: methode,
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: koerper === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      ...(koerper === undefined ? {} : { body: JSON.stringify(aufEnglisch(koerper)) }),
    });
  } catch {
    throw new ExternerApiFehler("allgemein");
  }
  if (antwort.ok) {
    const ergebnis = aufDeutsch(await antwort.json()) as ExterneAbfrage;
    for (const kennzahl of ergebnis.kennzahlen) {
      if (kennzahl.typ === "ja_nein" && kennzahl.wert !== null) kennzahl.wert = kennzahl.wert === "yes" ? "ja" : "nein";
    }
    return ergebnis;
  }
  let code = "";
  let fehlend: string[] = [];
  try {
    const roh = (await antwort.json()) as { error?: { code?: string; missing?: string[] } };
    code = roh.error?.code ?? "";
    fehlend = roh.error?.missing ?? [];
  } catch {
    // keine lesbare Fehlerantwort: allgemeiner Fehler
  }
  throw new ExternerApiFehler(CODES[code] ?? (antwort.status === 429 ? "zuViele" : "allgemein"), fehlend);
}
