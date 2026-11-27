import { queryOptions } from "@tanstack/react-query";
import { api, auspacken } from "./client";

/** Wer angemeldet ist, ändert sich nur durch Anmelden, Abmelden oder Einrichten; kurz halten, damit Sperren (Passwort, zweiter Faktor) zeitnah auffallen. */
const ICH_FRISCHE = 30_000;
/** Die Umgebung ändert sich bis zum Neustart des Servers nicht. */
const UMGEBUNG_FRISCHE = 5 * 60_000;

const ladeIch = async () => (await import("./abbildung-ich")).ich(await auspacken(api.api.v1.me.$get()));
const ladeUmgebung = async () => (await import("./abbildung-umgebung")).umgebung(await auspacken(api.api.v1.environment.$get()));
const ladeNamen = async (ids: string[]) => (await auspacken(api.api.v1.users.names.$get({ query: { ids: ids.join(",") } }))).data;

export type Ich = Awaited<ReturnType<typeof ladeIch>>;
export type Umgebung = Awaited<ReturnType<typeof ladeUmgebung>>;

export const schluesselAnmeldung = {
  ich: ["ich"] as const,
  umgebung: ["umgebung"] as const,
  namen: ["namen"] as const,
};

export const ichAbfrage = () => queryOptions({ queryKey: schluesselAnmeldung.ich, queryFn: ladeIch, staleTime: ICH_FRISCHE });
export const umgebungAbfrage = () => queryOptions({ queryKey: schluesselAnmeldung.umgebung, queryFn: ladeUmgebung, staleTime: UMGEBUNG_FRISCHE });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nur echte IDs gehen an die API (sie lehnt anderes mit 400 ab); Altbestand trägt `system`. */
export const istBenutzerId = (wert: string | null | undefined): wert is string => typeof wert === "string" && UUID.test(wert);

/** Anzeigenamen zu Benutzer-IDs; die API liefert nur Personen, die die anfragende Person sehen darf. */
export const benutzerNamen = (ids: readonly string[]) => {
  const sortiert = [...new Set(ids.filter(istBenutzerId))].sort().slice(0, 100);
  return queryOptions({ queryKey: [...schluesselAnmeldung.namen, sortiert], queryFn: () => ladeNamen(sortiert), enabled: sortiert.length > 0, staleTime: 5 * 60_000 });
};

/** Nur Pfade der eigenen Oberfläche sind als Rücksprungziel erlaubt (kein `//`, kein Schema, kein Rückwärtsschrägstrich). */
export function sicheresZiel(wert: unknown): string | undefined {
  if (typeof wert !== "string" || !wert.startsWith("/") || wert.startsWith("//") || wert.includes("\\") || [...wert].some((z) => z.charCodeAt(0) < 32)) return undefined;
  const pfad = wert.split(/[?#]/)[0] ?? "";
  return AUTH_SEITEN.includes(pfad) ? undefined : wert;
}

/** Seiten ohne Rahmen der Anwendung; sie brauchen keine fertig angemeldete Person. */
export const AUTH_SEITEN: readonly string[] = ["/sign-in", "/setup", "/change-password", "/forgot-password", "/set-password", "/two-factor-setup", "/portal-notice"];
