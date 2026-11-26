import { and, desc, eq, like, ne, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { symmetricDecrypt, symmetricEncrypt, generateRandomString } from "better-auth/crypto";
import { z } from "zod";
import { benutzer, konto, sitzung, verifizierung, zweiFaktor, type Db } from "@carraway/db";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { MINDESTLAENGE_PASSWORT, RESET_KENNUNG_PRAEFIX, type Auth } from "../anmeldung/auth";
import { clientIp } from "../anmeldung/schutz";
import { totpAdresse, totpPasst } from "../anmeldung/totp";
import { Fachfehler } from "../fehler";
import type { Konfiguration } from "../konfiguration";
import { pruefe } from "../pruefung";
import { schreibe } from "../schreiben";
import { lese } from "../zeitlimit";

/**
 * Eigene Sicherheit einer angemeldeten Person (Einstellungen → Sicherheit): Passwort ändern, aktive Sitzungen sehen und beenden, zweiten Faktor
 * neu einrichten, Wiederherstellungscodes erneuern. Alles gilt nur für die eigene Person und nur mit Sitzung (nie mit API-Schlüssel).
 *
 * Wege, die das Passwort prüfen, zählen Fehlversuche in dieselbe Begrenzung wie die Anmeldung (je IP und je Person). Geheimnisse (Passwort,
 * TOTP-Geheimnis, Codes) stehen weder im Änderungsprotokoll noch in Antworten außer den Wiederherstellungscodes, die genau einmal erscheinen.
 * Die Neueinrichtung des zweiten Faktors ersetzt das alte Geheimnis erst, wenn ein Code des neuen gültig ist; bis dahin hält die Datenbank
 * den Ansatz verschlüsselt in `verifizierung` (15 Minuten).
 */

const NEU_SEKUNDEN = 15 * 60;
const NEU_KENNUNG = (benutzerId: string) => `zf-neu:${benutzerId}`;

const passwortFeld = z.string().min(1).max(128);
const aendernPasswort = z.object({ currentPassword: passwortFeld, newPassword: z.string().min(MINDESTLAENGE_PASSWORT).max(128), endOtherSessions: z.boolean().default(true) }).strict();
const mitPasswort = z.object({ password: passwortFeld.optional() }).strict();
const bestaetigen = z.object({ code: z.string().trim().min(6).max(12), endOtherSessions: z.boolean().default(false) }).strict();
const sitzungsId = z.object({ id: z.uuid() });

function codeListe(): string[] {
  return Array.from({ length: 10 }, () => generateRandomString(10, "a-z", "0-9", "A-Z")).map((c) => `${c.slice(0, 5)}-${c.slice(5)}`);
}

export function kontoSicherheitRouten(db: Db, auth: Auth, konfig: Konfiguration) {
  const nurPerson = (c: Context) => {
    const akteur = aktuellerAkteur(c);
    if (akteur.quelle !== "sitzung" || akteur.technisch) throw new Fachfehler(403, "technical_user", "These settings apply only to signed-in persons, not to API keys.");
    return akteur;
  };
  const aktuelleSitzungId = async (c: Context): Promise<string> => {
    const daten = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!daten) throw new Fachfehler(401, "not_authenticated", "Please sign in.");
    return daten.session.id;
  };
  const schluessel = async () => (await auth.$context).secretConfig;

  /**
   * Reserviert einen Versuch, bevor Passwort oder Code geprüft werden: Zählen und Eintragen laufen unter Sperren je Zähler (in fester Reihenfolge)
   * in einer Transaktion, damit gleichzeitige Anfragen die Grenze nicht gemeinsam unterlaufen. Wirft 429, wenn sie erreicht ist. Gelingt die Prüfung,
   * gibt `freigeben` die reservierten Einträge wieder frei (nur Fehlversuche zählen); sonst bleiben sie stehen.
   */
  const pruefeSperre = async (c: Context, benutzerId: string) => {
    const zaehler = [`ip:${clientIp(c, konfig)}`, `konto-sicherheit:${benutzerId}`].sort();
    const { versuche, fensterMs } = konfig.anmeldeLimit;
    const ids = await db.transaction(async (tx) => {
      for (const z of zaehler) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${z}, 0))`);
      for (const z of zaehler) {
        const { rows } = await tx.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM anmeldeversuch WHERE schluessel = ${z} AND am > now() - ${`${Math.round(fensterMs / 1000)} seconds`}::interval`,
        );
        if ((rows[0]?.n ?? 0) >= versuche) return null;
      }
      const eingetragen: string[] = [];
      for (const z of zaehler) {
        const { rows } = await tx.execute<{ id: string }>(sql`INSERT INTO anmeldeversuch (schluessel) VALUES (${z}) RETURNING id`);
        eingetragen.push(rows[0]!.id);
      }
      return eingetragen;
    });
    if (!ids) {
      c.header("Retry-After", String(Math.round(fensterMs / 1000)));
      throw new Fachfehler(429, "too_many_attempts", "Too many failed attempts. Please try again later.");
    }
    return async () => {
      await db.execute(sql`DELETE FROM anmeldeversuch WHERE id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
    };
  };

  const passwortZeile = (benutzerId: string) =>
    lese(db, async (tx) => (await tx.select().from(konto).where(and(eq(konto.userId, benutzerId), eq(konto.providerId, "credential"))))[0]);

  /** Prüft das aktuelle Passwort; ohne Passwort-Zugang (nur Anmeldung über einen Anbieter) entfällt die Abfrage. */
  const bestaetigePasswort = async (c: Context, benutzerId: string, passwort: string | undefined) => {
    const freigeben = await pruefeSperre(c, benutzerId);
    const zeile = await passwortZeile(benutzerId);
    if (!zeile?.password) {
      await freigeben();
      return { hatPasswort: false };
    }
    const ok = passwort !== undefined && (await (await auth.$context).password.verify({ hash: zeile.password, password: passwort }));
    if (!ok) throw new Fachfehler(400, "password_incorrect", "The current password is not correct.");
    await freigeben();
    return { hatPasswort: true };
  };

  const zweiFaktorZeile = (benutzerId: string) => lese(db, async (tx) => (await tx.select().from(zweiFaktor).where(eq(zweiFaktor.userId, benutzerId)))[0]);

  return new Hono()
    .get("/security", async (c) => {
      const akteur = nurPerson(c);
      const [konten, zeile, sitzungen] = await lese(db, async (tx) =>
        Promise.all([
          tx.select({ anbieter: konto.providerId, aktualisiertAm: konto.updatedAt, passwort: konto.password }).from(konto).where(eq(konto.userId, akteur.id)),
          tx.select().from(zweiFaktor).where(eq(zweiFaktor.userId, akteur.id)),
          tx.select({ id: sitzung.id }).from(sitzung).where(eq(sitzung.userId, akteur.id)),
        ]),
      );
      let codesUebrig: number | null = null;
      const z = zeile[0];
      if (akteur.zweiFaktorAktiv && z) {
        try {
          const roh = JSON.parse(await symmetricDecrypt({ key: await schluessel(), data: z.backupCodes })) as unknown;
          codesUebrig = Array.isArray(roh) ? roh.length : null;
        } catch {
          codesUebrig = null;
        }
      }
      const pw = konten.find((k) => k.anbieter === "credential" && k.passwort);
      return c.json(
        {
          passwordSet: Boolean(pw),
          passwordChangedAt: pw?.aktualisiertAm.toISOString() ?? null,
          providers: konten.filter((k) => k.anbieter !== "credential").map((k) => k.anbieter),
          twoFactorEnabled: akteur.zweiFaktorAktiv,
          twoFactorRequired: konfig.zweiFaktorPflicht,
          recoveryCodesRemaining: codesUebrig,
          sessionCount: sitzungen.length,
        },
        200,
      );
    })
    .post("/password", pruefe("json", aendernPasswort), async (c) => {
      const akteur = nurPerson(c);
      const { currentPassword: aktuell, newPassword: neu, endOtherSessions: andereSitzungenBeenden } = c.req.valid("json");
      const aktuelleId = await aktuelleSitzungId(c);
      const { hatPasswort } = await bestaetigePasswort(c, akteur.id, aktuell);
      if (!hatPasswort) throw new Fachfehler(400, "no_password", "This sign-in uses a provider and has no password.");
      if (neu === aktuell) throw new Fachfehler(400, "password_unchanged", "The new password must differ from the previous one.");
      const hash = await (await auth.$context).password.hash(neu);
      const beendet = await schreibe(db, c, async (tx, protokoll) => {
        await tx.update(konto).set({ password: hash, updatedAt: new Date() }).where(and(eq(konto.userId, akteur.id), eq(konto.providerId, "credential")));
        await tx.update(benutzer).set({ passwortAendern: false, updatedAt: new Date() }).where(eq(benutzer.id, akteur.id));
        // Offene Token zum Zurücksetzen oder Einladen sind mit dem neuen Passwort überholt.
        await tx.delete(verifizierung).where(and(eq(verifizierung.value, akteur.id), like(verifizierung.identifier, `${RESET_KENNUNG_PRAEFIX}%`)));
        const weg = andereSitzungenBeenden ? await tx.delete(sitzung).where(and(eq(sitzung.userId, akteur.id), ne(sitzung.id, aktuelleId))).returning({ id: sitzung.id }) : [];
        await protokoll("passwort_aendern", "benutzer", akteur.id, null, { andereSitzungenBeendet: weg.length });
        return weg.length;
      });
      return c.json({ ok: true as const, otherSessionsEnded: beendet }, 200);
    })
    .get("/sessions", async (c) => {
      const akteur = nurPerson(c);
      const aktuelleId = await aktuelleSitzungId(c);
      const zeilen = await lese(db, (tx) =>
        tx
          .select({ id: sitzung.id, erstelltAm: sitzung.createdAt, zuletztAktivAm: sitzung.updatedAt, laeuftAbAm: sitzung.expiresAt, ip: sitzung.ipAddress, geraet: sitzung.userAgent })
          .from(sitzung)
          .where(eq(sitzung.userId, akteur.id))
          .orderBy(desc(sitzung.updatedAt)),
      );
      const jetzt = Date.now();
      return c.json(
        zeilen
          .filter((z) => z.laeuftAbAm.getTime() > jetzt)
          .map((z) => ({
            id: z.id,
            current: z.id === aktuelleId,
            createdAt: z.erstelltAm.toISOString(),
            lastActiveAt: z.zuletztAktivAm.toISOString(),
            expiresAt: z.laeuftAbAm.toISOString(),
            ip: z.ip,
            device: z.geraet?.slice(0, 300) ?? null,
          })),
        200,
      );
    })
    // Zuerst die feste Adresse, damit `end-others` nicht als Kennung gelesen wird.
    .post("/sessions/end-others", async (c) => {
      const akteur = nurPerson(c);
      const aktuelleId = await aktuelleSitzungId(c);
      const anzahl = await schreibe(db, c, async (tx, protokoll) => {
        const weg = await tx.delete(sitzung).where(and(eq(sitzung.userId, akteur.id), ne(sitzung.id, aktuelleId))).returning({ id: sitzung.id });
        if (weg.length > 0) await protokoll("sitzungen_beenden", "benutzer", akteur.id, null, { anzahl: weg.length });
        return weg.length;
      });
      return c.json({ ended: anzahl }, 200);
    })
    .delete("/sessions/:id", pruefe("param", sitzungsId), async (c) => {
      const akteur = nurPerson(c);
      const { id } = c.req.valid("param");
      if (id === (await aktuelleSitzungId(c))) throw new Fachfehler(400, "session_current", "The current session is ended with 'Sign out'.");
      await schreibe(db, c, async (tx, protokoll) => {
        const weg = await tx.delete(sitzung).where(and(eq(sitzung.id, id), eq(sitzung.userId, akteur.id))).returning({ id: sitzung.id });
        if (weg.length === 0) throw new Fachfehler(404, "not_found", "The session does not exist.");
        await protokoll("sitzung_beenden", "sitzung", id, null, null);
      });
      return c.body(null, 204);
    })
    .post("/two-factor/restart", pruefe("json", mitPasswort), async (c) => {
      const akteur = nurPerson(c);
      if (!akteur.zweiFaktorAktiv) throw new Fachfehler(400, "two_factor_disabled", "The second factor is not set up; the initial setup runs through the setup page.");
      await bestaetigePasswort(c, akteur.id, c.req.valid("json").password);
      const geheimnis = generateRandomString(32);
      const codes = codeListe();
      const key = await schluessel();
      const wert = await symmetricEncrypt({ key, data: JSON.stringify({ geheimnis, codes }) });
      await schreibe(db, c, async (tx, protokoll) => {
        await tx.delete(verifizierung).where(eq(verifizierung.identifier, NEU_KENNUNG(akteur.id)));
        await tx.insert(verifizierung).values({ identifier: NEU_KENNUNG(akteur.id), value: wert, expiresAt: new Date(Date.now() + NEU_SEKUNDEN * 1000) });
        await protokoll("zwei_faktor_neu_beginnen", "benutzer", akteur.id, null, { ablaufSekunden: NEU_SEKUNDEN });
      });
      return c.json({ totpUri: totpAdresse(geheimnis, "Carraway", akteur.email), recoveryCodes: codes, expiresInSeconds: NEU_SEKUNDEN }, 200);
    })
    .post("/two-factor/restart/confirm", pruefe("json", bestaetigen), async (c) => {
      const akteur = nurPerson(c);
      const { code, endOtherSessions: andereSitzungenBeenden } = c.req.valid("json");
      const aktuelleId = await aktuelleSitzungId(c);
      const freigeben = await pruefeSperre(c, akteur.id);
      const [offen] = await lese(db, (tx) => tx.select().from(verifizierung).where(eq(verifizierung.identifier, NEU_KENNUNG(akteur.id))));
      if (!offen || offen.expiresAt.getTime() <= Date.now()) throw new Fachfehler(400, "setup_expired", "The new setup has expired or was not started. Please start again.");
      const key = await schluessel();
      const { geheimnis, codes } = JSON.parse(await symmetricDecrypt({ key, data: offen.value })) as { geheimnis: string; codes: string[] };
      if (!totpPasst(geheimnis, code)) throw new Fachfehler(400, "code_invalid", "The code is not correct. Please enter the current code from the app.");
      await freigeben();
      const geheim = await symmetricEncrypt({ key, data: geheimnis });
      const codesVerschluesselt = await symmetricEncrypt({ key, data: JSON.stringify(codes) });
      const vorhanden = await zweiFaktorZeile(akteur.id);
      const beendet = await schreibe(db, c, async (tx, protokoll) => {
        if (vorhanden) await tx.update(zweiFaktor).set({ secret: geheim, backupCodes: codesVerschluesselt, verified: true, failedVerificationCount: 0, lockedUntil: null }).where(eq(zweiFaktor.id, vorhanden.id));
        else await tx.insert(zweiFaktor).values({ userId: akteur.id, secret: geheim, backupCodes: codesVerschluesselt, verified: true });
        await tx.update(benutzer).set({ twoFactorEnabled: true, updatedAt: new Date() }).where(eq(benutzer.id, akteur.id));
        await tx.delete(verifizierung).where(eq(verifizierung.identifier, NEU_KENNUNG(akteur.id)));
        const weg = andereSitzungenBeenden ? await tx.delete(sitzung).where(and(eq(sitzung.userId, akteur.id), ne(sitzung.id, aktuelleId))).returning({ id: sitzung.id }) : [];
        await protokoll("zwei_faktor_neu", "benutzer", akteur.id, null, { andereSitzungenBeendet: weg.length });
        return weg.length;
      });
      return c.json({ ok: true as const, otherSessionsEnded: beendet }, 200);
    })
    .post("/recovery-codes", pruefe("json", mitPasswort), async (c) => {
      const akteur = nurPerson(c);
      if (!akteur.zweiFaktorAktiv) throw new Fachfehler(400, "two_factor_disabled", "The second factor is not set up.");
      await bestaetigePasswort(c, akteur.id, c.req.valid("json").password);
      const zeile = await zweiFaktorZeile(akteur.id);
      if (!zeile) throw new Fachfehler(400, "two_factor_disabled", "The second factor is not set up.");
      const codes = codeListe();
      const verschluesselt = await symmetricEncrypt({ key: await schluessel(), data: JSON.stringify(codes) });
      await schreibe(db, c, async (tx, protokoll) => {
        await tx.update(zweiFaktor).set({ backupCodes: verschluesselt }).where(eq(zweiFaktor.id, zeile.id));
        await protokoll("wiederherstellungscodes_erneuern", "benutzer", akteur.id, null, { anzahl: codes.length });
      });
      return c.json({ recoveryCodes: codes }, 200);
    });
}
