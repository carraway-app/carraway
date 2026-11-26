import type { hc } from "hono/client";
// Nur der Typ kommt aus der API; der Server-Code gelangt nicht ins Bündel.
import type { AppType } from "@carraway/api";

type Anfrageteile = { param?: Record<string, string>; query?: Record<string, unknown>; json?: unknown };

/**
 * Schlanker Ersatz für die Laufzeit von `hono/client` (spart rund 2,5 kB gzip im Anfangsumfang): derselbe Aufruf `api.a.b[":id"].$get({ param, query, json })`
 * mit den Typen von Hono, aber nur den Teilen, die die Oberfläche nutzt (Pfadparameter, Abfrage, JSON-Körper, `$url`). Listen in der Abfrage werden wiederholt.
 */
function baue(pfad: string[]): unknown {
  return new Proxy(() => undefined, {
    get: (_ziel, schluessel) => (typeof schluessel === "string" && schluessel !== "then" ? baue([...pfad, schluessel]) : undefined),
    apply: (_ziel, _dies, [teile]: [Anfrageteile | undefined]) => {
      const methode = pfad[pfad.length - 1]!.slice(1);
      const segmente = pfad.slice(0, -1).filter((s) => s !== "index");
      const param = teile?.param ?? {};
      const adresse = segmente.map((s) => (s.startsWith(":") ? encodeURIComponent(param[s.slice(1)] ?? "") : s)).join("/");
      const suche = new URLSearchParams();
      for (const [k, v] of Object.entries(teile?.query ?? {})) for (const w of Array.isArray(v) ? v : [v]) if (w !== undefined) suche.append(k, String(w));
      const abfrage = suche.toString();
      const url = `${window.location.origin}/${adresse}${abfrage ? `?${abfrage}` : ""}`;
      if (methode === "url") return new URL(url);
      const hatKoerper = teile?.json !== undefined;
      return ladeMitSitzung(url, {
        method: methode.toUpperCase(),
        ...(hatKoerper ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(teile.json) } : {}),
      });
    },
  });
}

export const api = baue([]) as ReturnType<typeof hc<AppType>>;

/** Jede Anfrage trägt das Sitzungs-Cookie mit (`credentials: "include"`); das Cookie ist HttpOnly und nie im Skript sichtbar. */
export function ladeMitSitzung(eingabe: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(eingabe, { ...init, credentials: "include" });
}

/** Fehler eines einzelnen Feldes (400 `EINGABE_UNGUELTIG`); `code` ist der Prüfschritt, z. B. `too_small`. */
export interface Feldfehler {
  feld: string;
  code: string;
  meldung: string;
}

/**
 * Fehler der API oder der Verbindung. `code` ist der maschinenlesbare Code, die Oberfläche übersetzt ihn.
 * `felder` und `zusatz` tragen, was die API noch mitschickt (Feldfehler, `kandidaten`, `beteiligungId`, `beschlussBetrag`).
 */
export class ApiFehler extends Error {
  readonly code: string;
  readonly status: number;
  readonly felder: Feldfehler[];
  readonly zusatz: Record<string, unknown>;
  /** Wartezeit in Sekunden aus dem Kopf `Retry-After` (429 `ZU_VIELE_VERSUCHE`), sonst `null`. */
  readonly wartenSekunden: number | null;
  constructor(code: string, status: number, meldung?: string, extra: { felder?: Feldfehler[]; zusatz?: Record<string, unknown>; wartenSekunden?: number | null } = {}) {
    super(meldung ?? code);
    this.name = "ApiFehler";
    this.code = code;
    this.status = status;
    this.felder = extra.felder ?? [];
    this.zusatz = extra.zusatz ?? {};
    this.wartenSekunden = extra.wartenSekunden ?? null;
  }
}

function alsFeldfehler(wert: unknown): Feldfehler[] {
  if (!Array.isArray(wert)) return [];
  return wert.flatMap((eintrag: unknown) => {
    const e = eintrag as { feld?: unknown; code?: unknown; meldung?: unknown } | null;
    return typeof e?.feld === "string" && typeof e.code === "string" ? [{ feld: e.feld, code: e.code, meldung: typeof e.meldung === "string" ? e.meldung : "" }] : [];
  });
}

type Erfolg<R> = R extends { json(): Promise<infer J> } ? Exclude<J, { fehler: unknown }> : never;

/** Wartet auf die Antwort, liefert bei Erfolg den Körper und wirft sonst einen `ApiFehler` mit dem Code der API. */
export async function auspacken<R extends { ok: boolean; status: number; json(): Promise<unknown>; headers?: Headers }>(anfrage: Promise<R>): Promise<Erfolg<R>> {
  let antwort: R;
  try {
    antwort = await anfrage;
  } catch {
    throw new ApiFehler("NETZWERK", 0);
  }
  // 204 hat keinen Körper (z. B. Rolle entziehen).
  if (antwort.ok) return (antwort.status === 204 ? undefined : await antwort.json()) as Erfolg<R>;
  let code = "UNBEKANNT";
  let meldung: string | undefined;
  let felder: Feldfehler[] = [];
  let zusatz: Record<string, unknown> = {};
  try {
    // Eigene Fehler der API stehen unter `fehler`; Better Auth (`/auth/*`) antwortet mit `{ code, message }` auf oberster Ebene.
    const koerper = (await antwort.json()) as { fehler?: Record<string, unknown>; code?: unknown; message?: unknown };
    if (!koerper.fehler && typeof koerper.code === "string") {
      code = koerper.code;
      if (typeof koerper.message === "string") meldung = koerper.message;
    }
    if (typeof koerper.fehler?.code === "string") code = koerper.fehler.code;
    if (typeof koerper.fehler?.meldung === "string") meldung = koerper.fehler.meldung;
    if (koerper.fehler) {
      const { code: _code, meldung: _meldung, felder: roheFelder, ...rest } = koerper.fehler;
      felder = alsFeldfehler(roheFelder);
      zusatz = rest;
    }
  } catch {
    // kein JSON (z. B. Fehlerseite eines Proxys): Code bleibt UNBEKANNT
  }
  const warten = Number(antwort.headers?.get("Retry-After"));
  throw new ApiFehler(code, antwort.status, meldung, { felder, zusatz, wartenSekunden: Number.isFinite(warten) && warten > 0 ? warten : null });
}

/** Auswahl der Antworten der Better-Auth-Wege, die die Oberfläche braucht; Fehler werden zu `ApiFehler` mit dem Code der Bibliothek. */
export async function authAnfrage<T = Record<string, unknown>>(pfad: string, koerper: unknown = {}): Promise<T> {
  return (await auspacken(
    ladeMitSitzung(`${window.location.origin}/api/v1/auth${pfad}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(koerper) }),
  )) as T;
}
