import { PostfachFehler } from "./typen";

/** Austauschbarer `fetch` (Tests übergeben eine Fake-Funktion, kein Test erreicht je einen echten Host). */
export type Abrufer = typeof fetch;

const ZEITLIMIT_MS = 20_000;

/**
 * Ein Aufruf an die API eines Anbieters: ohne Weiterleitungen (ein Token darf nicht an einen anderen Host wandern), mit Zeitlimit.
 * 401 und 403 bedeuten einen ungültigen Zugang, alles andere außer Erfolg einen vorübergehenden Fehler. Antworten werden nie in
 * Fehlermeldungen übernommen (sie können Mailinhalte oder Tokens enthalten); es bleibt nur ein Code.
 */
export async function rufeAuf(abrufer: Abrufer, url: string, init: RequestInit = {}): Promise<unknown> {
  let antwort: Response;
  try {
    antwort = await abrufer(url, { ...init, redirect: "error", signal: AbortSignal.timeout(ZEITLIMIT_MS) });
  } catch {
    throw new PostfachFehler("ANBIETER_NICHT_ERREICHBAR");
  }
  if (antwort.status === 401 || antwort.status === 403) throw new PostfachFehler("ZUGANG_UNGUELTIG", true);
  if (antwort.status === 429) throw new PostfachFehler("ANBIETER_BEGRENZT");
  if (!antwort.ok) throw new PostfachFehler(`ANBIETER_FEHLER_${antwort.status}`);
  try {
    return await antwort.json();
  } catch {
    throw new PostfachFehler("ANBIETER_ANTWORT_UNGUELTIG");
  }
}

/** Folgeseiten (`nextLink`, `nextPageToken`) nur beim selben Host wie die Basisadresse, damit eine Antwort uns nicht auf einen fremden Host lenkt. */
export function gleicherHost(basis: string, url: string): boolean {
  try {
    return new URL(basis).origin === new URL(url).origin;
  } catch {
    return false;
  }
}

/** Bearer-Kopf für API-Aufrufe. */
export const bearer = (token: string, zusatz: Record<string, string> = {}): RequestInit => ({ headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...zusatz } });

/** Wie `rufeAuf`, liefert aber die rohen Bytes (Anhänge) und lehnt Antworten über `maxBytes` ab, bevor sie vollständig geladen sind. */
export async function rufeBinaerAuf(abrufer: Abrufer, url: string, init: RequestInit, maxBytes: number): Promise<Uint8Array> {
  let antwort: Response;
  try {
    antwort = await abrufer(url, { ...init, redirect: "error", signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new PostfachFehler("ANBIETER_NICHT_ERREICHBAR");
  }
  if (antwort.status === 401 || antwort.status === 403) throw new PostfachFehler("ZUGANG_UNGUELTIG", true);
  if (!antwort.ok) throw new PostfachFehler(`ANBIETER_FEHLER_${antwort.status}`);
  const laenge = Number(antwort.headers.get("content-length"));
  if (Number.isFinite(laenge) && laenge > maxBytes) throw new PostfachFehler("ANHANG_ZU_GROSS");
  const bytes = new Uint8Array(await antwort.arrayBuffer());
  if (bytes.length > maxBytes) throw new PostfachFehler("ANHANG_ZU_GROSS");
  return bytes;
}
