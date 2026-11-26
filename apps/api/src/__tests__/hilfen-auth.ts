import { createHmac } from "node:crypto";
import { hashPassword, symmetricEncrypt } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import * as s from "@carraway/db";
import { erstelleApp, type AppOptionen } from "../app";
import { ladeKonfiguration, type Konfiguration } from "../konfiguration";

/**
 * Anmeldung für Tests. Alle Personen sind erfunden. Die Tests melden über die echten Wege an (Anmeldung, zweiter
 * Faktor mit berechnetem TOTP-Code); die Passwort-Hashes entstehen nur einmal je Prozess.
 */

export const TESTPASSWORT = "Test-Passwort-nur-lokal-1";
/** TOTP-Geheimnis aller Testpersonen (Base32); nur die Tests kennen es, die Datenbank hält es verschlüsselt. */
export const TESTGEHEIMNIS = "KRSXG5CTMVRXEZLUKN2XAZLSNFXGO4TF";

const basis = ladeKonfiguration();
export const TESTORIGIN = basis.appOrigins[0]!;
const passwortHash = await hashPassword(TESTPASSWORT);

// RFC 6238 (TOTP, SHA-1) ----------------------------------------------------------------------------------------------

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Dekodieren(text: string): Buffer {
  let bits = "";
  for (const z of text.replace(/=+$/, "").toUpperCase()) bits += BASE32.indexOf(z).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** Sechsstelliger TOTP-Code nach RFC 6238 (30 Sekunden, SHA-1); `versatz` in Zeitfenstern. */
export function totpCode(geheimnisBase32: string, versatz = 0, zeit = Date.now()): string {
  const zaehler = Math.floor(zeit / 30_000) + versatz;
  const puffer = Buffer.alloc(8);
  puffer.writeBigUInt64BE(BigInt(zaehler));
  const hmac = createHmac("sha1", base32Dekodieren(geheimnisBase32)).update(puffer).digest();
  const o = hmac[hmac.length - 1]! & 0x0f;
  const zahl = ((hmac[o]! & 0x7f) << 24) | (hmac[o + 1]! << 16) | (hmac[o + 2]! << 8) | hmac[o + 3]!;
  return String(zahl % 1_000_000).padStart(6, "0");
}

// Personen --------------------------------------------------------------------------------------------------------------

export interface Testperson {
  name: string;
  email: string;
  globalVerwalter?: boolean;
  /** Rollen je Fonds-ID. */
  rollen?: Record<string, s.FondsRolle>;
  /** Standard `true`; `false` = Konto ohne zweiten Faktor. */
  zweiFaktor?: boolean;
  aktiv?: boolean;
}

export const person = (kuerzel: string, zusatz: Partial<Testperson> = {}): Testperson => ({
  name: `Testperson ${kuerzel}`,
  email: `${kuerzel.toLowerCase()}@test.example`,
  ...zusatz,
});

/** Die Person, die ohne weitere Angabe handelt: Verwalter aller Fonds. */
export const STANDARD = person("standard", { globalVerwalter: true });

type Db = ReturnType<typeof s.erstelleDb>["db"];

/** Legt die Person an oder setzt sie zurück (gleiche Adresse = gleiche ID, Rollen werden neu geschrieben). Gibt die ID zurück. */
export async function legePersonAn(db: Db, p: Testperson, geheimnis: string = basis.geheimnis): Promise<string> {
  const [zeile] = await db
    .insert(s.benutzer)
    .values({ name: p.name, email: p.email, emailVerified: true, twoFactorEnabled: p.zweiFaktor !== false, globalVerwalter: p.globalVerwalter === true, aktiv: p.aktiv !== false })
    .onConflictDoUpdate({
      target: s.benutzer.email,
      set: { name: p.name, twoFactorEnabled: p.zweiFaktor !== false, globalVerwalter: p.globalVerwalter === true, aktiv: p.aktiv !== false },
    })
    .returning();
  const id = zeile!.id;
  await db.delete(s.konto).where(sql`${s.konto.userId} = ${id}`);
  await db.insert(s.konto).values({ accountId: id, providerId: "credential", userId: id, password: passwortHash });
  await db.delete(s.zweiFaktor).where(sql`${s.zweiFaktor.userId} = ${id}`);
  if (p.zweiFaktor !== false) {
    await db.insert(s.zweiFaktor).values({
      userId: id,
      secret: await symmetricEncrypt({ key: geheimnis, data: `base32:${TESTGEHEIMNIS}` }),
      backupCodes: await symmetricEncrypt({ key: geheimnis, data: JSON.stringify([`ersatz-${id.slice(0, 8)}`]) }),
      verified: true,
    });
  }
  await db.delete(s.fondsrolle).where(sql`${s.fondsrolle.benutzerId} = ${id}`);
  const rollen = Object.entries(p.rollen ?? {});
  if (rollen.length) await db.insert(s.fondsrolle).values(rollen.map(([fondsId, rolle]) => ({ benutzerId: id, fondsId, rolle })));
  return id;
}

/** Legt einen Investor-Benutzer des LP-Portals an (ohne Fondsrollen) und verknüpft ihn mit den Organisationen; vorhandene Verknüpfungen werden ersetzt. */
export async function legeInvestorAn(db: Db, p: Testperson, organisationIds: string[], geheimnis?: string): Promise<string> {
  const id = await legePersonAn(db, { ...p, rollen: {}, globalVerwalter: false }, geheimnis);
  await db.insert(s.investorBenutzer).values({ benutzerId: id, erstelltVon: "test" }).onConflictDoNothing();
  await db.delete(s.investorZugang).where(sql`${s.investorZugang.benutzerId} = ${id}`);
  if (organisationIds.length) await db.insert(s.investorZugang).values(organisationIds.map((organisationId) => ({ benutzerId: id, organisationId, erstelltVon: "test" })));
  return id;
}

export async function idVon(db: Db, p: Testperson): Promise<string> {
  return (await db.select({ id: s.benutzer.id }).from(s.benutzer).where(sql`${s.benutzer.email} = ${p.email}`))[0]!.id;
}

// Sitzungen -----------------------------------------------------------------------------------------------------------

/** `name=wert`-Paare aus Set-Cookie-Kopfzeilen als Cookie-Kopf; gelöschte Cookies (leer) entfallen. */
export function cookieKopf(setCookies: string[]): string {
  return setCookies
    .map((c) => c.split(";")[0]!)
    .filter((c) => !c.endsWith("="))
    .join("; ");
}

export const jsonKopf = (cookie?: string, origin: string | null = TESTORIGIN): Record<string, string> => ({
  "content-type": "application/json",
  ...(origin ? { origin } : {}),
  ...(cookie ? { cookie } : {}),
});

/** Meldet die Person über die API an (Passwort, bei aktivem zweiten Faktor mit TOTP-Code) und gibt den Cookie-Kopf zurück. */
export async function meldeAn(app: Hono, p: Testperson): Promise<string> {
  const anmeldung = await app.request("/api/v1/auth/sign-in/email", {
    method: "POST",
    headers: jsonKopf(),
    body: JSON.stringify({ email: p.email, password: TESTPASSWORT }),
  });
  if (anmeldung.status !== 200) throw new Error(`Anmeldung von ${p.email} fehlgeschlagen: ${anmeldung.status} ${await anmeldung.text()}`);
  const zwischen = cookieKopf(anmeldung.headers.getSetCookie());
  if (p.zweiFaktor === false) return zwischen;
  const bestaetigt = await app.request("/api/v1/auth/two-factor/verify-totp", {
    method: "POST",
    headers: jsonKopf(zwischen),
    body: JSON.stringify({ code: totpCode(TESTGEHEIMNIS) }),
  });
  if (bestaetigt.status !== 200) throw new Error(`Zweiter Faktor von ${p.email} fehlgeschlagen: ${bestaetigt.status} ${await bestaetigt.text()}`);
  return cookieKopf(bestaetigt.headers.getSetCookie());
}

// Test-App ----------------------------------------------------------------------------------------------------------------

export interface TestAnfrage extends RequestInit {
  /** Wer anfragt: Standard ist `STANDARD`; `null` = nicht angemeldet. */
  als?: Testperson | null;
  /** Ursprung (`Origin`); Standard ist der konfigurierte; `null` = ohne Kopfzeile. */
  origin?: string | null;
}

export interface TestApp {
  /** Die echte App ohne Zutaten (für Tests der Anmeldung selbst). */
  app: Hono;
  request: (pfad: string, init?: TestAnfrage) => Promise<Response>;
}

/**
 * App für Tests: `request` meldet als `als` an (Standard: Verwalter aller Fonds), setzt Cookie und `Origin` und
 * behält die Sitzungen je Person. Pfade ohne Präfix `/api` werden unter `/api/v1` aufgerufen.
 */
export function erstelleTestApp(db: Db, optionen: Partial<Konfiguration> & AppOptionen = {}): TestApp {
  const app = erstelleApp(db, optionen);
  const cookies = new Map<string, Promise<string>>();
  const angelegt = new Set<string>();
  const cookieFuer = (p: Testperson) => {
    let eintrag = cookies.get(p.email);
    if (!eintrag) {
      eintrag = (async () => {
        if (!angelegt.has(p.email)) {
          await legePersonAn(db, p, optionen.geheimnis);
          angelegt.add(p.email);
        }
        return meldeAn(app, p);
      })();
      cookies.set(p.email, eintrag);
    }
    return eintrag;
  };
  return {
    app,
    request: async (pfad, { als, origin, headers, ...init } = {}) => {
      const kopf = new Headers(headers);
      const methode = (init.method ?? "GET").toUpperCase();
      const person = als === undefined ? STANDARD : als;
      if (person) kopf.set("cookie", await cookieFuer(person));
      if (methode !== "GET" && methode !== "HEAD") {
        const ursprung = origin === undefined ? TESTORIGIN : origin;
        if (ursprung) kopf.set("origin", ursprung);
      }
      return app.request(pfad.startsWith("/api/") ? pfad : `/api/v1${pfad}`, { ...init, headers: kopf });
    },
  };
}
