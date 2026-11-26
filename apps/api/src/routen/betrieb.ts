import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "@carraway/db";
import { pruefeMigrationszustand } from "@carraway/db/migrationen";
import type { Speicher } from "../berichte/speicher";
import { HERZSCHLAG_GRENZE_SEKUNDEN, leseBetriebszustand, type Betriebszustand } from "../beobachtung/betrieb";
import type { ApiErweiterung } from "../erweiterung";
import type { Konfiguration } from "../konfiguration";
import { lese } from "../zeitlimit";

/**
 * Betriebsstatus für globale Verwalter (`GET /operations/status`, Verwaltung → Betrieb). Anders als `/health` (ohne Anmeldung, nur
 * Datenbank und Worker) nennt er Einzelheiten: Migrationsstand, Rückstände der Warteschlangen, Ablage, SMTP und die Angaben der Erweiterungen
 * (`extensions.<name>`, z. B. der KI-Anbieter).
 * Er enthält keine Adressen, Zugangsdaten oder Inhalte; ein Wert, der sich nicht lesen ließ, ist `null` bzw. `false`, nie ein Fehler.
 */

export type Ampel = "ok" | "warning" | "error";

/** Ab so vielen Sekunden Verzug gilt ein Rückstand als auffällig (`warnung`). */
export const RUECKSTAND_WARNUNG_SEKUNDEN = 300;

/** Worker-Zustand in der Antwort (`ok`, `down`, `unknown`). */
export const workerAnApi = (w: Betriebszustand["worker"]) => ({
  status: ({ ok: "ok", ausgefallen: "down", unbekannt: "unknown" } as const)[w.status],
  heartbeatAgeSeconds: w.herzschlagAlterSekunden,
});

/** Rückstand in der Antwort; `null` bleibt `null` (nicht lesbar oder nicht eingerichtet). */
const rueckstandAnApi = (r: Betriebszustand["mail"]) => (r === null ? null : { count: r.anzahl, oldestSeconds: r.aeltesterSekunden });

/** Prüft, ob die Dateiablage beschreibbar ist: schreibt eine kleine Probedatei und entfernt sie wieder. */
export async function speicherBeschreibbar(speicher: Speicher): Promise<boolean> {
  const schluessel = `betrieb/probe-${randomUUID()}`;
  try {
    await speicher.schreibe(schluessel, new TextEncoder().encode("probe"));
    await speicher.loesche?.(schluessel);
    return true;
  } catch {
    return false;
  }
}

export function betriebRouten(db: Db, speicher: Speicher, konfig: Pick<Konfiguration, "mail">, erweiterungen: readonly ApiErweiterung[] = []) {
  return new Hono().get("/status", async (c) => {
    const datenbank = await lese(db, (tx) => tx.execute(sql`SELECT 1`)).then(
      () => true,
      () => false,
    );
    const [migrationen, betrieb, beschreibbar] = await Promise.all([pruefeMigrationszustand(db), leseBetriebszustand(db), speicherBeschreibbar(speicher)]);
    const rueckstaende = {
      snapshots: betrieb.ausgangskorb,
      mail: betrieb.mail,
      extraction: betrieb.auslesung,
      register: betrieb.register,
    };
    const rueckstandAuffaellig = Object.values(rueckstaende).some((r) => r !== null && r.anzahl > 0 && r.aeltesterSekunden > RUECKSTAND_WARNUNG_SEKUNDEN);
    const status: Ampel = !datenbank || !migrationen.ok || !beschreibbar ? "error" : betrieb.worker.status !== "ok" || rueckstandAuffaellig ? "warning" : "ok";
    return c.json(
      {
        status,
        generatedAt: new Date().toISOString(),
        database: { reachable: datenbank },
        migrations: { ok: migrationen.ok, known: migrationen.bekannt, applied: migrationen.angewendet, message: migrationen.meldung },
        worker: { ...workerAnApi(betrieb.worker), thresholdSeconds: HERZSCHLAG_GRENZE_SEKUNDEN },
        backlogs: {
          snapshots: rueckstandAnApi(rueckstaende.snapshots),
          mail: rueckstandAnApi(rueckstaende.mail),
          extraction: rueckstandAnApi(rueckstaende.extraction),
          register: rueckstandAnApi(rueckstaende.register),
          warningSeconds: RUECKSTAND_WARNUNG_SEKUNDEN,
        },
        storage: { writable: beschreibbar },
        smtp: { configured: konfig.mail !== undefined },
        extensions: Object.fromEntries(erweiterungen.flatMap((e) => (e.betrieb ? [[e.name, e.betrieb()]] : []))) as Record<string, Record<string, unknown>>,
      },
      200,
    );
  });
}
