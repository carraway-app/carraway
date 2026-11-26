import { eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";
import { aenderung, deal, fonds, organisation, person, type Db } from "@carraway/db";
import { Fachfehler, bereitsZusammengefuehrtFehler } from "./fehler";
import { stapelSpeicher, type Tx } from "./zeitlimit";

/**
 * Akteur für das Änderungsprotokoll: die ID des angemeldeten Benutzers, bei einem API-Schlüssel die
 * ID seines technischen Benutzers. Ohne angemeldete Person (nur Aufrufe außerhalb der Routen) ist es `system`.
 * Nur mit `AKTEUR_HEADER_VERTRAUEN=1` (hinter einem vertrauenswürdigen Reverse-Proxy, der Client-Header entfernt und
 * selbst setzt) gilt dort ein gesendeter `X-Akteur` (höchstens 200 Zeichen); sonst bleibt er unbeachtet.
 */
export function akteurAus(c: Context): string {
  const akteur = c.get("akteur");
  if (akteur) return akteur.id;
  const wert = c.req.header("X-Akteur")?.trim();
  if (wert && process.env.AKTEUR_HEADER_VERTRAUEN === "1") return wert.slice(0, 200);
  return "system";
}

/** Anzeigename des Akteurs zum Zeitpunkt der Änderung (wird im Protokoll mitgeschrieben). */
export function akteurNameAus(c: Context): string | null {
  return c.get("akteur")?.name ?? null;
}

/** Heutiges Datum in Berliner Ortszeit als `YYYY-MM-DD`. */
export function heute(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
}

/** Schreibt eine Zeile ins Änderungsprotokoll; `akteur` ist der Akteur der Anfrage (für Vier-Augen-Prüfungen und Zuordnungen). */
export type Protokollant = ((aktion: string, tabelle: string, datensatzId: string, vorher: unknown, nachher: unknown) => Promise<void>) & {
  readonly akteur: string;
  /** Viele Zeilen in Blöcken auf einmal (Import); gleiche Wirkung wie je Zeile ein Aufruf. */
  readonly mehrere: (zeilen: { aktion: string; tabelle: string; datensatzId: string; vorher?: unknown; nachher?: unknown }[]) => Promise<void>;
};

function protokollant(tx: Tx, akteur: string, akteurName: string | null): Protokollant {
  const schreibeZeile = async (aktion: string, tabelle: string, datensatzId: string, vorher: unknown, nachher: unknown) => {
    await tx.insert(aenderung).values({ akteur, akteurName, aktion, tabelle, datensatzId, vorher: vorher ?? null, nachher: nachher ?? null });
  };
  const mehrere = async (zeilen: { aktion: string; tabelle: string; datensatzId: string; vorher?: unknown; nachher?: unknown }[]) => {
    for (let i = 0; i < zeilen.length; i += 1000) {
      await tx.insert(aenderung).values(zeilen.slice(i, i + 1000).map((z) => ({ akteur, akteurName, aktion: z.aktion, tabelle: z.tabelle, datensatzId: z.datensatzId, vorher: z.vorher ?? null, nachher: z.nachher ?? null })));
    }
  };
  return Object.assign(schreibeZeile, { akteur, mehrere });
}

/** Höchstdauer einer Abfrage und des Wartens auf eine Sperre in Schreibtransaktionen (Millisekunden). */
export const SCHREIB_STATEMENT_TIMEOUT_MS = 5000;
export const SCHREIB_LOCK_TIMEOUT_MS = 2000;

/**
 * Führt eine Schreibanfrage in einer Transaktion aus. Fachfehler (`Fachfehler`) rollen alles zurück
 * und werden vom Fehlerbehandler der App zur Antwort. Jeder Schreibweg läuft hierüber, damit er die
 * Zeitgrenzen und das Änderungsprotokoll bekommt. Der Worker (kein HTTP-Kontext) übergibt statt des
 * Kontexts den Akteur, z. B. `system`.
 */
export function schreibe<T>(db: Db, quelle: Context | string, fn: (tx: Tx, protokoll: Protokollant) => Promise<T>): Promise<T> {
  const akteur = typeof quelle === "string" ? quelle : akteurAus(quelle);
  const akteurName = typeof quelle === "string" ? null : akteurNameAus(quelle);
  const stapel = stapelSpeicher.getStore();
  // Im Stapel: Savepoint der Transaktion des Stapels. Ein Fehler rollt nur diese Operation zurück, der Stapel entscheidet über alles.
  const transaktion = <R>(arbeit: (tx: Tx) => Promise<R>): Promise<R> => (stapel ? stapel.tx.transaction(arbeit) : db.transaction(arbeit));
  return transaktion(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${SCHREIB_STATEMENT_TIMEOUT_MS}`));
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = ${SCHREIB_LOCK_TIMEOUT_MS}`));
    return fn(tx, protokollant(tx, akteur, akteurName));
  });
}

/** Platzhalter-ID für Lesezugriffe ohne einzelnen Datensatz (z. B. die Gremienvorlage über mehrere Deals). */
export const KEIN_DATENSATZ = "00000000-0000-0000-0000-000000000000";

/**
 * Lese-Protokoll für sensible Lesezugriffe (Berichtsdownloads, Gesamtexporte): eine Zeile mit Aktion `gelesen` im
 * Änderungsprotokoll, wer wann was heruntergeladen hat. Läuft über `schreibe()`, weil Lesetransaktionen schreibgeschützt sind.
 */
export function protokolliereLesen(db: Db, c: Context, tabelle: string, datensatzId: string, was: Record<string, unknown>): Promise<void> {
  return schreibe(db, c, (_tx, protokoll) => protokoll("gelesen", tabelle, datensatzId, null, was));
}

// Eingabe-Bausteine ----------------------------------------------------------------------------------------------

/** Beträge kommen als Zeichenkette mit höchstens zwei Nachkommastellen (Entscheidung 7), größer als null. */
export const betragEingabe = z
  .string()
  .regex(/^(?!0+(\.0+)?$)\d{1,16}(\.\d{1,2})?$/, "Expected an amount greater than zero with at most two decimal places");

/** Text ohne Leerraum am Rand; leer ist ungültig. */
export const textEingabe = (max = 500) => z.string().trim().min(1).max(max);

/** Optionale Textfelder dürfen beim Ändern mit `null` geleert werden. */
export const optionalerText = (max = 500) => textEingabe(max).nullable().optional();

/** Website: absolute URL, nur `http:` oder `https:` (kein `javascript:` o. Ä.); beim Ändern mit `null` leerbar. */
export const websiteEingabe = textEingabe(300)
  .refine(
    (wert) => {
      try {
        const url = new URL(wert);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Expected an absolute URL with http: or https:" },
  )
  .nullable()
  .optional();

export const idParam = z.object({ id: z.uuid() });

/** Bei Änderungen muss mindestens ein Feld mitgeschickt werden. */
export const mindestensEins = (werte: object) => Object.values(werte).some((w) => w !== undefined);
export const MINDESTENS_EIN_FELD = { message: "At least one field must be given", path: [] as string[] };

/** Entfernt `undefined`, damit nur mitgeschickte Felder geändert werden. */
export function nurGesetzte<T extends Record<string, unknown>>(werte: T): Partial<T> {
  return Object.fromEntries(Object.entries(werte).filter(([, w]) => w !== undefined)) as Partial<T>;
}

// Existenzprüfungen ----------------------------------------------------------------------------------------------

export async function ladeOrganisation(tx: Tx, id: string) {
  const [zeile] = await tx.select().from(organisation).where(eq(organisation.id, id));
  if (!zeile) throw new Fachfehler(404, "organization_not_found", "Organization not found.");
  if (zeile.zusammengefuehrtIn) throw bereitsZusammengefuehrtFehler(zeile.zusammengefuehrtIn);
  return zeile;
}

export async function ladePerson(tx: Tx, id: string) {
  const [zeile] = await tx.select().from(person).where(eq(person.id, id));
  if (!zeile) throw new Fachfehler(404, "person_not_found", "Person not found.");
  if (zeile.zusammengefuehrtIn) throw bereitsZusammengefuehrtFehler(zeile.zusammengefuehrtIn);
  return zeile;
}

/** Lädt den Deal und sperrt die Zeile bis zum Ende der Transaktion. */
export async function ladeDeal(tx: Tx, id: string) {
  const [zeile] = await tx.select().from(deal).where(eq(deal.id, id)).for("update");
  if (!zeile) throw new Fachfehler(404, "deal_not_found", "Deal not found.");
  return zeile;
}

export async function ladeFonds(tx: Tx, id: string) {
  const [zeile] = await tx.select().from(fonds).where(eq(fonds.id, id));
  if (!zeile) throw new Fachfehler(404, "fund_not_found", "Fund not found.");
  return zeile;
}
