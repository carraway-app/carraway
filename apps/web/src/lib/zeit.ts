import type { Sprache } from "@carraway/ui";

const LOCALE: Record<Sprache, string> = { de: "de-DE", en: "en-GB" };

/** Zeitpunkt in Ortszeit für Anzeigen, z. B. `20.11.2026, 10:15` bzw. `20/11/2026, 10:15`. */
export function formatZeitpunkt(iso: string, sprache: Sprache): string {
  const datum = new Date(iso);
  if (Number.isNaN(datum.getTime())) return iso;
  return new Intl.DateTimeFormat(LOCALE[sprache], { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(datum);
}

const zwei = (n: number) => String(n).padStart(2, "0");

/** ISO-Zeitstempel als Wert für `<input type="datetime-local">` (Ortszeit, ohne Sekunden). */
export function alsDatetimeLocal(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}T${zwei(d.getHours())}:${zwei(d.getMinutes())}`;
}

/**
 * Wissensstand als ISO-Zeitstempel in UTC (`2026-11-20T09:15:00Z`), ohne Millisekunden. Die UTC-Form kommt ohne `+`
 * aus, das in einer URL als Leerzeichen gelesen werden könnte. Ungültige Eingaben liefern `undefined`.
 */
export function alsStand(eingabe: string | undefined): string | undefined {
  if (!eingabe) return undefined;
  const d = new Date(eingabe);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

const ISO_MIT_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Liest `?knowledgeDate=` aus der URL: nur Zeitstempel mit Zeitzone, sonst `undefined`. Ein `+` im Versatz, das als Leerzeichen ankam, wird zurückgeholt. */
export function standAusUrl(wert: unknown): string | undefined {
  if (typeof wert !== "string") return undefined;
  const text = wert.replace(/ (\d{2}:\d{2})$/, "+$1");
  if (!ISO_MIT_ZONE.test(text)) return undefined;
  const utc = alsStand(text);
  // Den Datenbankschnitt bis auf Mikrosekunden durch die Navigation erhalten.
  const bruch = text.match(/\.(\d+)/)?.[1];
  return utc && bruch ? utc.replace(/Z$/, `.${bruch}Z`) : utc;
}
