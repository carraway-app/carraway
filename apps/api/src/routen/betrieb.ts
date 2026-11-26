import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "@carraway/db";
import { pruefeMigrationszustand } from "@carraway/db/migrationen";
import type { Speicher } from "../berichte/speicher";
import { HERZSCHLAG_GRENZE_SEKUNDEN, leseBetriebszustand } from "../beobachtung/betrieb";
import type { ApiErweiterung } from "../erweiterung";
import type { Konfiguration } from "../konfiguration";
import { lese } from "../zeitlimit";

/**
 * Betriebsstatus für globale Verwalter (`GET /betrieb/status`, Verwaltung → Betrieb). Anders als `/gesundheit` (ohne Anmeldung, nur
 * Datenbank und Worker) nennt er Einzelheiten: Migrationsstand, Rückstände der Warteschlangen, Ablage, SMTP und die Angaben der Erweiterungen
 * (`erweiterungen.<name>`, z. B. der KI-Anbieter).
 * Er enthält keine Adressen, Zugangsdaten oder Inhalte; ein Wert, der sich nicht lesen ließ, ist `null` bzw. `false`, nie ein Fehler.
 */

export type Ampel = "ok" | "warnung" | "fehler";

/** Ab so vielen Sekunden Verzug gilt ein Rückstand als auffällig (`warnung`). */
export const RUECKSTAND_WARNUNG_SEKUNDEN = 300;

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
      auslesung: betrieb.auslesung,
      register: betrieb.register,
    };
    const rueckstandAuffaellig = Object.values(rueckstaende).some((r) => r !== null && r.anzahl > 0 && r.aeltesterSekunden > RUECKSTAND_WARNUNG_SEKUNDEN);
    const ampel: Ampel = !datenbank || !migrationen.ok || !beschreibbar ? "fehler" : betrieb.worker.status !== "ok" || rueckstandAuffaellig ? "warnung" : "ok";
    return c.json(
      {
        ampel,
        erzeugtAm: new Date().toISOString(),
        datenbank: { erreichbar: datenbank },
        migrationen: { ok: migrationen.ok, bekannt: migrationen.bekannt, angewendet: migrationen.angewendet, meldung: migrationen.meldung },
        worker: { ...betrieb.worker, grenzeSekunden: HERZSCHLAG_GRENZE_SEKUNDEN },
        rueckstaende: { ...rueckstaende, warnungSekunden: RUECKSTAND_WARNUNG_SEKUNDEN },
        speicher: { beschreibbar },
        smtp: { konfiguriert: konfig.mail !== undefined },
        erweiterungen: Object.fromEntries(erweiterungen.flatMap((e) => (e.betrieb ? [[e.name, e.betrieb()]] : []))) as Record<string, Record<string, unknown>>,
      },
      200,
    );
  });
}
