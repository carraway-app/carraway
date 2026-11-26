import { and, eq, isNotNull } from "drizzle-orm";
import { benutzer, person, postfachVerbindung, type Db } from "@carraway/db";
import type { Schluesselring } from "../geheimnis/krypto";
import type { DemoKontakt } from "../postfach/fake";
import { erstelleAnbieterFabrik } from "../postfach/anbieter";
import { KEINE_POSTFACH_ANBINDUNG } from "../postfach/konfiguration";
import { gleicheAb } from "../postfach/sync";
import type { Zugang } from "../postfach/typen";
import { verschluesseleZugang } from "../postfach/zugang";

/**
 * Demo für Mail und Kalender ohne Konto bei einem Anbieter: Der Anbieter `demo` ist ein Fake im Prozess (Daten aus `postfach/fake.ts`, mit den ersten
 * Kontakten der Demo-Daten als Beteiligte, plus einem unbekannten Absender, der nie gespeichert wird). Er gilt nur außerhalb des Echtbestands.
 */

export const DEMO_PERSON = "vera@beispiel.example";

/** Die ersten Kontakte der Demo-Daten mit Mailadresse (stabile Reihenfolge nach Adresse). */
export async function ladeDemoKontakte(db: Db): Promise<DemoKontakt[]> {
  const zeilen = await db.select({ email: person.email, vorname: person.vorname, nachname: person.nachname }).from(person).where(isNotNull(person.email)).orderBy(person.email).limit(8);
  return zeilen.flatMap((z) => (z.email ? [{ email: z.email, vorname: z.vorname, nachname: z.nachname }] : []));
}

export interface DemoPostfachErgebnis {
  verbindungen: number;
  mails: number;
  termine: number;
}

/** Verbindet Postfach und Kalender der Demo-Person Vera mit dem Demo-Anbieter und gleicht sofort ab. Vorhandene Demo-Verbindungen werden ersetzt. */
export async function legeDemoPostfachAn(db: Db, ring: Schluesselring, umgebung: string): Promise<DemoPostfachErgebnis> {
  if (umgebung === "echt") throw new Error("Der Demo-Anbieter gibt es im Echtbestand nicht.");
  const [vera] = await db.select({ id: benutzer.id }).from(benutzer).where(eq(benutzer.email, DEMO_PERSON));
  if (!vera) throw new Error(`Die Demo-Person ${DEMO_PERSON} gibt es nicht: zuerst \`pnpm db:seed\`.`);
  const zugang: Zugang = { art: "demo", adresse: DEMO_PERSON };
  await db.delete(postfachVerbindung).where(and(eq(postfachVerbindung.benutzerId, vera.id), eq(postfachVerbindung.anbieter, "demo")));
  for (const bereich of ["mail", "kalender"] as const) {
    const id = crypto.randomUUID();
    await db.insert(postfachVerbindung).values({ id, benutzerId: vera.id, bereich, anbieter: "demo", zugangVerschluesselt: verschluesseleZugang(ring, id, zugang), inhaltSpeichern: bereich === "mail" });
  }
  const e = await gleicheAb(db, {
    ring,
    konfig: KEINE_POSTFACH_ANBINDUNG,
    abrufer: fetch,
    anbieter: erstelleAnbieterFabrik({ konfig: KEINE_POSTFACH_ANBINDUNG, abrufer: fetch, imapFabrik: async () => Promise.reject(new Error("Kein IMAP in der Demo")), umgebung, demoKontakte: () => ladeDemoKontakte(db) }),
  });
  return { verbindungen: e.verbindungen, mails: e.mails, termine: e.termine };
}
