import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getAuthoritativeSessionFromCtx } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins/two-factor";
import { and, eq, like, sql } from "drizzle-orm";
import { benutzer, konto, sitzung, verifizierung, zweiFaktor, type Db } from "@carraway/db";
import { schreibe } from "../schreiben";
import type { Anmeldeanbieter } from "../erweiterung";
import type { Konfiguration } from "../konfiguration";
import { IP_KOPF, fehlversuche, merkeFehlversuch, reserviereVersuch } from "./begrenzung";

/** Mindestlänge des Passworts; NIST rät zu Länge statt Zusammensetzungsregeln. */
export const MINDESTLAENGE_PASSWORT = 12;

/**
 * Token zum Passwortsetzen liegen als SHA-256 in `verifizierung`, die Kennung mit diesem Präfix: So lassen sich die Token einer Person gezielt
 * entfernen, ohne andere Einträge zu treffen (der wartende zweite Faktor einer Anmeldung hat dieselbe Benutzer-ID als Wert).
 */
export const RESET_KENNUNG_PRAEFIX = "pw1:";
const hashResetKennung = async (kennung: string) => `${RESET_KENNUNG_PRAEFIX}${createHash("sha256").update(kennung).digest("base64url")}`;

const ZWEITER_FAKTOR_PFADE = ["/two-factor/verify-totp", "/two-factor/verify-backup-code"];

/**
 * Wege, die ein Passwort oder einen Code prüfen und deshalb in dieselbe Fehlversuchsbegrenzung zählen. Auch
 * `/two-factor/enable` und `/change-password` verlangen das aktuelle Passwort: Sie wären sonst ein Weg, ein
 * gestohlenes Sitzungs-Cookie ohne Grenze auf das Passwort zu raten.
 */
const zuVieleVersuche = () => new APIError("TOO_MANY_REQUESTS", { message: "Too many failed attempts. Please try again later.", code: "too_many_attempts" });
const BEGRENZT = ["/sign-in/email", "/two-factor/verify-totp", "/two-factor/verify-backup-code", "/two-factor/enable", "/change-password", "/verify-password", "/reset-password"];

/** Schlüssel der Fehlversuchszähler zu einem Pfad: je IP, bei der Anmeldung zusätzlich je Konto; sonst leer. */
async function begrenzungsSchluessel(ctx: Parameters<typeof getAuthoritativeSessionFromCtx>[0]): Promise<string[]> {
  const pfad = ctx.path;
  if (!BEGRENZT.includes(pfad)) return [];
  const schluessel = [`ip:${ctx.headers?.get(IP_KOPF) ?? "unbekannt"}`];
  const email = pfad === "/verify-password" ? (await getAuthoritativeSessionFromCtx(ctx))?.user.email
    : pfad === "/sign-in/email" ? (ctx.body as { email?: unknown } | undefined)?.email : undefined;
  if (typeof email === "string") schluessel.push(`konto:${email.trim().toLowerCase().slice(0, 320)}`);
  return schluessel;
}

/**
 * Better Auth für die Anwendung. `oidc` sind die Anmeldeanbieter der Erweiterungen (Single Sign-On, `ee/`); der Kern selbst kennt nur
 * Adresse und Passwort mit zweitem Faktor.
 */
export function erstelleAuth(db: Db, konfig: Konfiguration, oidc: Anmeldeanbieter = { socialProviders: {}, vertraut: [] }) {
  const passwortVersuche = new WeakMap<object, () => Promise<void>>();
  const basis = konfig.appOrigins[0]!;
  const sicher = basis.startsWith("https://");
  const faktor = twoFactor({ issuer: "Carraway", allowPasswordless: true });
  // Better Auth prüft den zweiten Faktor von Haus aus nur bei der Passwortanmeldung.
  // Auch OIDC verwendet denselben signierten Zwischenzustand und dieselbe TOTP-Prüfung.
  const faktorMitSso = {
    ...faktor,
    hooks: { after: faktor.hooks.after.map(haken => ({
      ...haken,
      matcher: (ctx: Parameters<typeof haken.matcher>[0]) => haken.matcher(ctx) ||
        ((ctx.path === "/sign-in/social" || ctx.path === "/callback/:id") && haken.matcher({ ...ctx, path: "/sign-in/email" })),
    })) },
  };
  return betterAuth({
    appName: "Carraway",
    baseURL: basis,
    basePath: "/api/v1/auth",
    secret: konfig.geheimnis,
    trustedOrigins: konfig.appOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user: benutzer, session: sitzung, account: konto, verification: verifizierung, twoFactor: zweiFaktor },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !konfig.registrierungOffen,
      minPasswordLength: MINDESTLAENGE_PASSWORT,
      maxPasswordLength: 128,
      // Das Zurücksetzen läuft über `/password/forgot` (`zuruecksetzen.ts`); hier gilt nur das Einlösen des Tokens. Ein Token gilt einmal.
      resetPasswordTokenExpiresIn: 30 * 60,
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => {
        // Wer ein Passwort gesetzt hat (auch aus einer Einladung), muss kein Startpasswort mehr ändern; der zweite Faktor bleibt unberührt.
        // Weitere offene Token der Person verfallen.
        await db.delete(verifizierung).where(and(eq(verifizierung.value, user.id), like(verifizierung.identifier, `${RESET_KENNUNG_PRAEFIX}%`)));
        await db.update(benutzer).set({ passwortAendern: false, updatedAt: new Date() }).where(eq(benutzer.id, user.id));
        await schreibe(db, user.id, (_tx, protokoll) => protokoll("passwort_zuruecksetzen", "benutzer", user.id, null, { sitzungenBeendet: true, zweiterFaktorBleibt: true }));
      },
    },
    // Kennungen der Token (Passwort setzen) liegen nur als Hash in der Datenbank; alles andere bleibt, wie die Bibliothek es ablegt.
    verification: { storeIdentifier: { default: "plain", overrides: { "reset-password:": { hash: hashResetKennung } } } },
    socialProviders: oidc.socialProviders,
    account: { accountLinking: { enabled: oidc.vertraut.length > 0 || Object.values(oidc.bestaetigteAdresse ?? {}).includes(true), trustedProviders: oidc.vertraut as never } },
    session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 30 },
    user: {
      validateUserInfo: ({ source }) => {
        const anbieter = source.oauth?.providerId;
        if (!anbieter) return;
        const verknuepfen = oidc.bestaetigteAdresse?.[anbieter];
        if (verknuepfen !== undefined && source.oauth?.profile?.email_verified !== true) return { error: "email_not_verified" };
        if (source.action === "link-account" && !oidc.vertraut.includes(anbieter) && !verknuepfen) return { error: "account_not_linked" };
      },
      additionalFields: {
        aktiv: { type: "boolean", defaultValue: true, input: false },
        technisch: { type: "boolean", defaultValue: false, input: false },
        globalVerwalter: { type: "boolean", defaultValue: false, input: false },
      },
    },
    rateLimit: { enabled: false },
    // Begrenzung der Fehlversuche je IP und je Konto in Postgres. Sie hängt an `ctx.path`, dem von der Bibliothek
    // normalisierten Pfad, und gilt damit für jede Schreibweise, die den Handler erreicht.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/link-social") {
          const anbieter = (ctx.body as { provider?: string } | undefined)?.provider;
          if (anbieter && !oidc.vertraut.includes(anbieter) && !oidc.bestaetigteAdresse?.[anbieter]) {
            throw new APIError("FORBIDDEN", { code: "account_not_linked", message: "Account linking is disabled for this provider." });
          }
        }
        if (ctx.path === "/change-password") {
          const { newPassword, currentPassword } = (ctx.body ?? {}) as { newPassword?: unknown; currentPassword?: unknown };
          if (typeof newPassword === "string" && newPassword === currentPassword) {
            throw new APIError("BAD_REQUEST", { message: "The new password must differ from the previous one.", code: "password_unchanged" });
          }
        }
        // Zuerst die Sperre, dann das Umschreiben: Ein früher Rückgabewert darf die Prüfung nie überspringen.
        const schluessel = await begrenzungsSchluessel(ctx);
        const { versuche, fensterMs } = konfig.anmeldeLimit;
        if (ctx.path === "/verify-password") {
          const freigeben = await reserviereVersuch(db, schluessel, konfig.anmeldeLimit);
          if (!freigeben) throw zuVieleVersuche();
          passwortVersuche.set(ctx.request ?? ctx.context, freigeben);
          return;
        }
        for (const s of schluessel) {
          if ((await fehlversuche(db, s, fensterMs)) >= versuche) {
            throw zuVieleVersuche();
          }
        }
        // Kein "Gerät merken" (Entscheidung 87): Jede Anmeldung verlangt den Code. Ein mitgesendetes `trustDevice` wird
        // entfernt, damit Better Auth weder Cookie noch Vertrauenseintrag anlegt.
        if (ZWEITER_FAKTOR_PFADE.includes(ctx.path) && (ctx.body as { trustDevice?: unknown } | undefined)?.trustDevice !== undefined) {
          return { context: { ...ctx, body: { ...(ctx.body as object), trustDevice: false } } };
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/verify-password") {
          if (!(ctx.context.returned instanceof APIError)) await passwortVersuche.get(ctx.request ?? ctx.context)?.();
          return;
        }
        const schluessel = await begrenzungsSchluessel(ctx);
        if (schluessel.length > 0 && ctx.context.returned instanceof APIError) await merkeFehlversuch(db, schluessel, konfig.anmeldeLimit.fensterMs);
      }),
    },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: sicher,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: sicher },
      ipAddress: { ipAddressHeaders: konfig.proxyVertrauen ? ["x-forwarded-for"] : [], disableIpTracking: !konfig.proxyVertrauen },
    },
    plugins: [
      // OIDC-Konten ohne Passwort dürfen den zweiten Faktor ohne Passwortabfrage einrichten.
      faktorMitSso,
      {
        id: "sso-zweiter-faktor",
        hooks: { after: [{
          matcher: ctx => ctx.path === "/callback/:id",
          handler: createAuthMiddleware(async ctx => {
            if (!(ctx.context.returned as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) return;
            const rueckkehr = new URL(ctx.context.responseHeaders?.get("location") ?? "/", basis);
            const ziel = new URL("/sign-in", konfig.appOrigins.includes(rueckkehr.origin) ? rueckkehr.origin : basis);
            ziel.searchParams.set("twoFactor", "true");
            if (rueckkehr.origin === ziel.origin) ziel.searchParams.set("next", rueckkehr.pathname + rueckkehr.search + rueckkehr.hash);
            throw ctx.redirect(ziel.href);
          }),
        }] },
      },
    ],
    databaseHooks: {
      // Ändert jemand das Passwort (Better Auth: change-password, reset), ist das Startpasswort erledigt.
      account: {
        update: {
          after: async (k) => {
            if (k.providerId === "credential" && typeof k.password === "string" && typeof k.userId === "string") {
              await db.update(benutzer).set({ passwortAendern: false, updatedAt: new Date() }).where(eq(benutzer.id, k.userId));
            }
          },
        },
      },
      user: {
        create: {
          // Auch bei offener Registrierung und OIDC entsteht die erste Person ausschließlich über /setup.
          before: async () => {
            const { rows } = await db.execute(sql`SELECT 1 FROM benutzer WHERE NOT technisch LIMIT 1`);
            if (!rows.length) throw new APIError("FORBIDDEN", { code: "setup_required", message: "Complete initial setup first." });
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof erstelleAuth>;
