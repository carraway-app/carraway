import { createHash, randomBytes } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { benutzer, benutzerEinstellung, konto, verifizierung, type Db } from "@carraway/db";
import { Fachfehler } from "../fehler";
import { legeMailAn, verlangeMail, type MailKontext } from "../mail/auftraege";
import type { Sprache } from "../mail/vorlagen";
import { pruefe } from "../pruefung";
import { schreibe } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";
import type { Konfiguration } from "../konfiguration";
import { RESET_KENNUNG_PRAEFIX, type Auth } from "./auth";
import { clientIp } from "./schutz";
import { fehlversuche, merkeFehlversuch } from "./begrenzung";

/**
 * Passwort zurücksetzen und Einladung per Mail. Beides nutzt denselben Weg von Better Auth zum Setzen des Passworts
 * (`POST /auth/reset-password` mit dem Token): Das Token gilt einmal, steht in der Datenbank nur als Hash (`verification.storeIdentifier`, Präfix `pw1:`),
 * läuft ab (Zurücksetzen 30 Minuten, Einladung 72 Stunden) und beendet beim Einlösen alle Sitzungen der Person. Der zweite Faktor wird nie angefasst:
 * Wer ihn eingerichtet hat, muss ihn nach dem Zurücksetzen weiter eingeben.
 *
 * Die Anfrage zum Zurücksetzen antwortet für jede Adresse gleich (Status, Körper, Dauer): Für unbekannte, gesperrte und technische Konten läuft
 * dieselbe Arbeit mit einer zurückgerollten Transaktion, und die Antwort wartet mindestens `passwortAntwortMinMs`. Begrenzt wird je IP und
 * je Adresse, unabhängig davon, ob es sie gibt.
 */

export const ZURUECKSETZEN_SEKUNDEN = 30 * 60;
export const EINLADUNG_SEKUNDEN = 72 * 60 * 60;

/** Vor dem Token steht in der Datenbank immer dieses Präfix (so verlangt es Better Auth); gespeichert wird nur der Hash des Ganzen. */
const KENNUNG = (token: string) => `reset-password:${token}`;

const anfrage = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
  /** Sprache der Oberfläche; gilt nur, wenn die Person keine eigene Mail-Sprache gespeichert hat. */
  language: z.enum(["de", "en"]).optional(),
});

const neuesToken = () => randomBytes(24).toString("base64url");
const KEIN_BENUTZER = "00000000-0000-0000-0000-000000000000";
const schlafe = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const adressHash = (email: string) => createHash("sha256").update(email).digest("hex").slice(0, 32);

class ZurueckrollenAbsicht extends Error {}

/** Link der Oberfläche zum Festlegen des Passworts; das Token steht im Fragment und gelangt damit weder in Zugriffsprotokolle noch in den Referer. */
export const passwortLink = (basis: string, token: string) => `${basis}/passwort-setzen#token=${token}`;

/**
 * Legt ein neues Token für die Person an (frühere Token der Person verfallen) und gibt es zurück.
 * Better Auth speichert die Kennung gehasht; der Wert ist die Benutzer-ID.
 */
export async function legeTokenAn(db: Db, auth: Auth, benutzerId: string, sekunden: number): Promise<string> {
  const kontext = await auth.$context;
  const token = neuesToken();
  await loescheTokenVon(db, benutzerId);
  await kontext.internalAdapter.createVerificationValue({ identifier: KENNUNG(token), value: benutzerId, expiresAt: new Date(Date.now() + sekunden * 1000) });
  return token;
}

/** Offene Token einer Person zum Passwortsetzen; Einträge anderer Art mit derselben Benutzer-ID (etwa der wartende zweite Faktor) bleiben. */
export async function loescheTokenVon(db: Db, benutzerId: string): Promise<void> {
  await db.delete(verifizierung).where(and(eq(verifizierung.value, benutzerId), like(verifizierung.identifier, `${RESET_KENNUNG_PRAEFIX}%`)));
}

/** Eine Person kann zurückgesetzt oder eingeladen werden, wenn sie aktiv, kein technischer Benutzer und entweder mit Passwort oder noch ohne Zugang ist. */
async function bereitFuerLink(tx: Tx, email: string) {
  const [person] = await tx.select().from(benutzer).where(eq(benutzer.email, email));
  if (!person || !person.aktiv || person.technisch) return null;
  const konten = await tx.select({ anbieter: konto.providerId }).from(konto).where(eq(konto.userId, person.id));
  // Nur Anmeldung über Microsoft oder Google: Das Passwort ist dort nicht vorgesehen.
  if (konten.length > 0 && !konten.some((k) => k.anbieter === "credential")) return null;
  return person;
}

async function sprachWahl(tx: Tx, benutzerId: string, hinweis: Sprache | undefined): Promise<Sprache> {
  const [e] = await tx.select({ sprache: benutzerEinstellung.sprache }).from(benutzerEinstellung).where(eq(benutzerEinstellung.benutzerId, benutzerId));
  if (e?.sprache === "en" || e?.sprache === "de") return e.sprache;
  return hinweis ?? "de";
}

/**
 * Mail zum Zurücksetzen in den Ausgangskorb und Protokoll. Für Adressen ohne Konto (und gesperrte oder technische) läuft dieselbe Arbeit mit
 * einem Wegwerf-Token und wird zurückgerollt; so unterscheiden sich Datenbankzugriffe und Dauer nicht merklich.
 */
async function stelleZuruecksetzenAus(db: Db, auth: Auth, kontext: MailKontext, email: string, hinweis: Sprache | undefined) {
  const person = await lese(db, (tx) => bereitFuerLink(tx, email));
  const adapter = (await auth.$context).internalAdapter;
  let token: string;
  if (person) token = await legeTokenAn(db, auth, person.id, ZURUECKSETZEN_SEKUNDEN);
  else {
    token = neuesToken();
    await loescheTokenVon(db, KEIN_BENUTZER);
    await adapter.findVerificationValue(KENNUNG(token));
  }
  try {
    await schreibe(db, "system", async (tx, protokoll) => {
      const id = person?.id ?? KEIN_BENUTZER;
      await legeMailAn(tx, protokoll, kontext, {
        an: email,
        sprache: await sprachWahl(tx, id, hinweis),
        vorlage: "passwort_zuruecksetzen",
        parameter: { link: passwortLink(kontext.appBasis, token), gueltigMinuten: ZURUECKSETZEN_SEKUNDEN / 60 },
        bezug: { art: "benutzer", id },
      });
      await protokoll("passwort_anfordern", "benutzer", id, null, { ablaufSekunden: ZURUECKSETZEN_SEKUNDEN });
      if (!person) throw new ZurueckrollenAbsicht();
    });
  } catch (fehler) {
    if (!(fehler instanceof ZurueckrollenAbsicht)) throw fehler;
  }
}

/** Öffentliche Wege rund ums Passwort (ohne Anmeldung). */
export function passwortRouten(db: Db, auth: Auth, konfig: Konfiguration) {
  return new Hono().post("/forgot", pruefe("json", anfrage), async (c) => {
    const kontext = c.get("mail");
    verlangeMail(kontext);
    const { email, language: sprache } = c.req.valid("json");
    const start = performance.now();
    // Jede Anfrage zählt, ob es die Adresse gibt oder nicht; sonst ließe sich an der Sperre erkennen, welche Adressen es gibt.
    const schluessel = [`reset:ip:${clientIp(c, konfig)}`, `reset:adr:${adressHash(email)}`];
    const { proAdresse, proIp, fensterMs } = konfig.passwortLimit;
    const [ipAnzahl, adressAnzahl] = await Promise.all(schluessel.map((s) => fehlversuche(db, s, fensterMs)));
    if ((ipAnzahl ?? 0) >= proIp || (adressAnzahl ?? 0) >= proAdresse) {
      c.header("Retry-After", String(Math.round(fensterMs / 1000)));
      throw new Fachfehler(429, "too_many_attempts", "Too many requests. Please try again later.");
    }
    await merkeFehlversuch(db, schluessel, fensterMs);
    await stelleZuruecksetzenAus(db, auth, kontext, email, sprache);
    const rest = konfig.passwortAntwortMinMs - (performance.now() - start);
    if (rest > 0) await schlafe(rest);
    return c.json({ ok: true as const }, 200);
  });
}

/** Einladung (Verwalter): Token mit 72 Stunden und Mail in den Ausgangskorb, in der Transaktion des Aufrufers. */
export async function stelleEinladungAus(
  tx: Tx,
  db: Db,
  auth: Auth,
  protokoll: Parameters<typeof legeMailAn>[1],
  kontext: MailKontext,
  e: { benutzerId: string; name: string; email: string; sprache: Sprache },
): Promise<void> {
  const token = await legeTokenAn(db, auth, e.benutzerId, EINLADUNG_SEKUNDEN);
  await legeMailAn(tx, protokoll, kontext, {
    an: e.email,
    sprache: e.sprache,
    vorlage: "einladung",
    parameter: { name: e.name, link: passwortLink(kontext.appBasis, token), gueltigStunden: EINLADUNG_SEKUNDEN / 3600 },
    bezug: { art: "benutzer", id: e.benutzerId },
  });
  await protokoll("einladen", "benutzer", e.benutzerId, null, { ablaufSekunden: EINLADUNG_SEKUNDEN });
}

/** `true`, solange die Person noch kein Passwort und keinen Zugang über einen Anbieter hat (Einladung offen). */
export async function einladungOffen(tx: Tx, benutzerId: string): Promise<boolean> {
  const { rows } = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ${konto} WHERE ${konto.userId} = ${benutzerId}`);
  return (rows[0]?.n ?? 0) === 0;
}
