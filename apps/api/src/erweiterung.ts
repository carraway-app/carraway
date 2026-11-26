import type { Hono } from "hono";
import type { PgBoss } from "pg-boss";
import type { Db } from "@carraway/db";
import type { Auth } from "./anmeldung/auth";
import { registriereBerichtsarten, type Berichtsart } from "./berichte/arten";
import type { Speicher } from "./berichte/speicher";
import type { Logger } from "./beobachtung/protokoll";
import type { Konfiguration } from "./konfiguration";
import type { Regel } from "./rechte/tabelle";

/**
 * Erweiterungspunkte der API (Open Core, docs/open-core.md). Der Kern importiert nie aus `ee/`; eine Erweiterung meldet sich an, indem der
 * Einstieg „Voll“ (`ee/api/src/server.ts`, `ee/api/src/worker.ts`) sie an `erstelleApp` bzw. `starteWorker` übergibt. Jeder Punkt ist optional.
 */

/** Was eine Erweiterung beim Bau der Anwendung bekommt. */
export interface ErweiterungsKontext {
  db: Db;
  auth: Auth;
  konfig: Konfiguration;
  speicher: Speicher;
}

/** Was eine Erweiterung im Worker bekommt. */
export interface WorkerKontext {
  db: Db;
  boss: PgBoss;
  logger: Logger;
}

/** Anbieter für die Anmeldung über Better Auth (`socialProviders`) und die, deren Konten per Adresse verknüpft werden dürfen. */
export interface Anmeldeanbieter {
  socialProviders: Record<string, Record<string, unknown>>;
  vertraut: string[];
}

export interface ApiErweiterung {
  /** Kurzer Name (Protokoll, Fehlermeldungen). */
  name: string;
  /** Zusätzliche Routen, unter `/api/v1` eingehängt (nach den Routen des Kerns). Jede braucht eine Regel in `regeln`. */
  routen?: (k: ErweiterungsKontext) => Hono<any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- jede Hono-Unter-App
  /** Einträge der Berechtigungstabelle für die Routen der Erweiterung (Bausteine aus `rechte/tabelle.ts`, Bereich am besten in der Zeile). */
  regeln?: readonly Regel[];
  /** Anmeldeanbieter (Single Sign-On); mehrere Erweiterungen werden zusammengeführt. */
  anmeldeanbieter?: (konfig: Konfiguration) => Anmeldeanbieter;
  /** Berichtsarten (Datei, Kontrolle, Freitexte, Vorgaben beim Anlegen), siehe `berichte/arten.ts`. */
  berichtsarten?: Record<string, Berichtsart>;
  /** Zusätzliche Angaben im Betriebsstatus (`GET /betrieb/status`), unter `erweiterungen.<name>`. */
  betrieb?: () => Record<string, unknown>;
  /** Warteschlangen in pg-boss anlegen (Worker und Tests, beim Start der Jobs). */
  warteschlangen?: (boss: PgBoss) => Promise<void>;
  /** Arbeiter im Worker anmelden (`boss.work`). */
  worker?: (k: WorkerKontext) => Promise<void>;
  /** Läuft im Takt des Workers neben dem Verteilen der Snapshot-Aufträge (z. B. eigene Ausgangskörbe an pg-boss übergeben). */
  verteilen?: (k: WorkerKontext) => Promise<unknown>;
}

/** Meldet die Berichtsarten der Erweiterungen an (beim Bau der Anwendung und beim Start des Workers). */
export function meldeBerichtsartenAn(erweiterungen: readonly ApiErweiterung[]): void {
  for (const e of erweiterungen) if (e.berichtsarten) registriereBerichtsarten(e.berichtsarten);
}

/** Führt die Anmeldeanbieter aller Erweiterungen zusammen. */
export function anmeldeanbieterAus(erweiterungen: readonly ApiErweiterung[], konfig: Konfiguration): Anmeldeanbieter {
  const ergebnis: Anmeldeanbieter = { socialProviders: {}, vertraut: [] };
  for (const e of erweiterungen) {
    const a = e.anmeldeanbieter?.(konfig);
    if (!a) continue;
    Object.assign(ergebnis.socialProviders, a.socialProviders);
    ergebnis.vertraut.push(...a.vertraut);
  }
  return ergebnis;
}
