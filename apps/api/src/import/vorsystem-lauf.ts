import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { providerConnection } from "@carraway/db";
import { kappeParams, type Befund } from "@carraway/import";
import type { Akteur } from "../anmeldung/akteur";
import type { Tx } from "../zeitlimit";
import { Abrufkontext, bildeAb, leseVorsystem, QuellFehler, type Abbildung, type Abgebildet, type VorsystemAdapter } from "@carraway/import/vorsystem";
import { AbrufFehler, type AbrufOptionen } from "../http/oeffentlicher-abruf";
import { Fachfehler } from "../fehler";
import { requestFor } from "../integrationen/http";
import { ProviderError } from "../integrationen/provider";
import { transient } from "../integrationen/retry";

/**
 * Lesen eines Vorsystems über seinen Adapter: Transport über den geprüften HTTPS-Abruf der Integrationen (Zielprüfung, Ursprung,
 * erlaubte Pfade, Größengrenze), Wiederholung und Ratenbegrenzung über den Abrufkontext, danach Zusammenführung und Abbildung auf
 * die Importvorlage. Weder Zugangsdaten noch Antworten der Quelle gelangen in Fehler, Protokoll oder Befunde; dort stehen nur Codes.
 */

/** Präfix der Verbindungen in `provider_connection.provider`. */
export const ANBIETER_PRAEFIX = "import-source:";

/** Höchstzahl der Hinweise der Quelle, die mit dem Lauf gespeichert werden (die Anzahlen zählen alle). */
export const MAX_QUELL_BEFUNDE = 1000;

/** Angaben zur Quelle eines Laufs (`import_lauf.vorschau.source`); bleiben bei jeder erneuten Prüfung erhalten. */
export interface QuellAngaben {
  adapter: string;
  label: string;
  funds: number;
  requests: number;
  retries: number;
  readAt: string;
  findings: Befund[];
  /** Personen, die die Verbindung seit dem letzten Setzen von Zugang oder Ursprung gespeichert haben; keine darf den Lauf übernehmen. */
  editors?: string[];
  /** Stand der Verbindung beim Lesen (Prüfsumme aus Einstellungen und Zugang); weicht er beim Übernehmen ab, wird die Übernahme gesperrt. */
  connection?: string;
}

/** Stand einer Verbindung: ändert sich mit jeder gespeicherten Einstellung, jedem neuen Zugang und jeder neuen Person, die sie speichert. */
export const verbindungsStand = (conn: { mapping: unknown; credential: string }) => createHash("sha256").update(JSON.stringify(conn.mapping)).update("\0").update(conn.credential).digest("hex");

/**
 * Vier-Augen-Prinzip für Läufe aus einem Vorsystem: Wer die Verbindung seit dem letzten Setzen von Zugang oder Ursprung gespeichert hat,
 * übernimmt nicht (wie Hochladende und Prüfende),
 * und eine nach dem Lesen geänderte Verbindung sperrt die Übernahme (neuer Prüflauf nötig).
 */
export async function pruefeQuellVerbindung(tx: Tx, akteur: Akteur, quelle: QuellAngaben): Promise<void> {
  // Ohne Angaben, wer die Verbindung bearbeitet hat, lässt sich das Vier-Augen-Prinzip nicht prüfen: dann keine Übernahme.
  if (!Array.isArray(quelle.editors) || quelle.editors.length === 0) {
    throw new Fachfehler(409, "import_source_changed", "It is not recorded who edited the source connection; save the connection again and start a new dry run.");
  }
  if (quelle.editors.includes(akteur.id)) {
    throw new Fachfehler(409, "four_eyes_violated", "The import must be applied by a different person than the one who configured the source connection.");
  }
  const [conn] = await tx.select({ mapping: providerConnection.mapping, credential: providerConnection.credential }).from(providerConnection).where(eq(providerConnection.provider, ANBIETER_PRAEFIX + quelle.adapter)).for("share");
  if (!conn || !quelle.connection || verbindungsStand(conn) !== quelle.connection) {
    throw new Fachfehler(409, "import_source_changed", "The source connection has changed since this run was read; start a new dry run.");
  }
}

/** Die Angaben zur Quelle aus der gespeicherten Vorschau eines Laufs; `null` bei einem hochgeladenen Lauf. */
export function quelleAus(vorschau: unknown): (QuellAngaben & { befunde: Befund[] }) | null {
  if (!vorschau || typeof vorschau !== "object") return null;
  const q = (vorschau as { source?: QuellAngaben }).source;
  if (!q || typeof q !== "object" || !Array.isArray(q.findings)) return null;
  return { ...q, befunde: q.findings };
}

/** Speicherbare Form der Angaben (ohne den Hilfsnamen `befunde`). */
export const quelleZumSpeichern = (q: QuellAngaben & { befunde?: Befund[] }): QuellAngaben => ({ adapter: q.adapter, label: q.label, funds: q.funds, requests: q.requests, retries: q.retries, readAt: q.readAt, findings: q.findings, ...(Array.isArray(q.editors) ? { editors: q.editors } : {}), ...(q.connection ? { connection: q.connection } : {}) });

/** Fehlercode einer gescheiterten Leseoperation, ohne Inhalte der Quelle. */
function lesecode(fehler: unknown): string {
  if (fehler instanceof QuellFehler || fehler instanceof ProviderError) return fehler.code;
  if (fehler instanceof AbrufFehler) return fehler.code === "ABRUF_ZIEL_VERBOTEN" || fehler.code === "ABRUF_ADRESSE_UNGUELTIG" ? "source_address_blocked" : "source_unreachable";
  if (fehler instanceof Error && (fehler.name === "TimeoutError" || fehler.name === "AbortError")) return "source_unreachable";
  return "source_processing_failed";
}

export interface Lesung {
  abgebildet: Abgebildet;
  angaben: QuellAngaben;
}

/** Liest die gewählten Fonds des Vorsystems und bildet sie ab. Ein Lesefehler wird zu 502 `import_source_read_failed` mit dem Code als Grund. */
export async function leseUndBildeAb(adapter: VorsystemAdapter, ursprung: string, zugang: string, wunschFonds: string[], abbildung: Omit<Abbildung, "quelle">, http: AbrufOptionen = {}): Promise<Lesung> {
  const anbieter = { id: adapter.id, origin: ursprung, allowsPath: adapter.erlaubterPfad ?? (() => true), credentials: adapter.kopfzeilen };
  const k = new Abrufkontext(requestFor(anbieter, zugang, http), {
    rate: adapter.rate,
    voruebergehend: transient,
    wartezeit: (f) => (f instanceof ProviderError ? f.retrySeconds : undefined),
  });
  let gelesen;
  try {
    gelesen = await leseVorsystem(adapter, k, { fonds: wunschFonds });
  } catch (fehler) {
    throw new Fachfehler(502, "import_source_read_failed", "The source system could not be read.", { reason: lesecode(fehler) });
  }
  const abgebildet = bildeAb(gelesen, { ...abbildung, quelle: adapter.id });
  const findings = abgebildet.befunde.slice(0, MAX_QUELL_BEFUNDE).map((b) => ({ ...b, params: kappeParams(b.params) }));
  return { abgebildet, angaben: { adapter: adapter.id, label: adapter.bezeichnung, funds: abgebildet.bestand.fonds.length, requests: k.zaehler.anfragen, retries: k.zaehler.wiederholungen, readAt: new Date().toISOString(), findings } };
}
