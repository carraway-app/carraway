import { ApiFehler } from "./client";

/** Was eine Antwort der API über die Sitzung verrät, nachdem die Seite schon geladen war. */
export type SitzungsEreignis = "abgemeldet" | "passwort" | "zweiFaktor";

let handler: ((ereignis: SitzungsEreignis) => void) | null = null;

/** Der Router meldet sich hier an; die Abfrage- und Mutations-Caches rufen ihn bei 401 und bei den beiden 403-Sperren. */
export function setzeSitzungsHandler(neu: ((ereignis: SitzungsEreignis) => void) | null): void {
  handler = neu;
}

export function ereignisZuFehler(fehler: unknown): SitzungsEreignis | null {
  if (!(fehler instanceof ApiFehler)) return null;
  if (fehler.status === 401 && fehler.code === "not_authenticated") return "abgemeldet";
  if (fehler.status === 403 && fehler.code === "password_change_required") return "passwort";
  if (fehler.status === 403 && fehler.code === "two_factor_required") return "zweiFaktor";
  return null;
}

export function meldeSitzungsFehler(fehler: unknown): void {
  const ereignis = ereignisZuFehler(fehler);
  if (ereignis) handler?.(ereignis);
}
