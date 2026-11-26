/**
 * Postfach- und Kalenderanbindung je Installation. Die App-Registrierungen bei Microsoft und Google gehören der Installation (nicht dem
 * Produkt): Client-ID und Geheimnis kommen aus der Umgebung und sind getrennt von denen der Anmeldung (`OIDC_*`), weil sie andere
 * Berechtigungen (nur Lesen von Mail und Kalender) verlangen. Die Endpunkte sind überschreibbar (Tests und Demo gegen einen Fake).
 *
 * Alle Clients sind dünne HTTP-Aufrufe ohne SDK und ohne Prüfung gegen die echten Dienste (siehe docs/sicherheit/Mail-und-Kalender.md).
 */

export interface OAuthAnbieter {
  clientId: string;
  clientSecret: string;
  autorisierungUrl: string;
  tokenUrl: string;
  /** Basisadresse der API (Graph bzw. Gmail). */
  apiBasis: string;
  /** Nur Google: Basisadresse der Kalender-API. */
  kalenderBasis?: string;
}

export interface PostfachKonfiguration {
  microsoft?: OAuthAnbieter;
  google?: OAuthAnbieter;
  /** IMAP für Selbsthoster; Vorgabe an. */
  imap: boolean;
  /** Erlaubt IMAP-Ziele in privaten und lokalen Adressbereichen (Vorgabe aus, Schutz vor Abfragen interner Dienste). */
  privateZiele: boolean;
  /** Abstand der Abgleiche je Verbindung in Minuten. */
  intervallMinuten: number;
}

type Umgebungsvariablen = Record<string, string | undefined>;

export function ladePostfachKonfiguration(env: Umgebungsvariablen): PostfachKonfiguration {
  const k: PostfachKonfiguration = {
    imap: !["0", "false", "nein"].includes((env.POSTFACH_IMAP ?? "1").toLowerCase()),
    privateZiele: ["1", "true", "ja"].includes((env.POSTFACH_PRIVATE_ZIELE ?? "0").toLowerCase()),
    intervallMinuten: Math.max(1, Math.min(1440, Number(env.POSTFACH_INTERVALL_MINUTEN || 15) || 15)),
  };
  if (env.POSTFACH_MICROSOFT_CLIENT_ID && env.POSTFACH_MICROSOFT_CLIENT_SECRET) {
    const tenant = env.POSTFACH_MICROSOFT_TENANT_ID || "common";
    k.microsoft = {
      clientId: env.POSTFACH_MICROSOFT_CLIENT_ID,
      clientSecret: env.POSTFACH_MICROSOFT_CLIENT_SECRET,
      autorisierungUrl: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`,
      tokenUrl: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
      apiBasis: "https://graph.microsoft.com/v1.0",
    };
  }
  if (env.POSTFACH_GOOGLE_CLIENT_ID && env.POSTFACH_GOOGLE_CLIENT_SECRET) {
    k.google = {
      clientId: env.POSTFACH_GOOGLE_CLIENT_ID,
      clientSecret: env.POSTFACH_GOOGLE_CLIENT_SECRET,
      autorisierungUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      apiBasis: "https://gmail.googleapis.com/gmail/v1",
      kalenderBasis: "https://www.googleapis.com/calendar/v3",
    };
  }
  return k;
}

export const KEINE_POSTFACH_ANBINDUNG: PostfachKonfiguration = { imap: false, privateZiele: false, intervallMinuten: 15 };
