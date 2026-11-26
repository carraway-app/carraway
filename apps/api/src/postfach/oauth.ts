import { createHash, randomBytes } from "node:crypto";
import type { OAuthAnbieter } from "./konfiguration";
import type { Abrufer } from "./http";
import { PostfachFehler } from "./typen";

/**
 * OAuth 2.0 mit Autorisierungscode und PKCE (S256) für Microsoft 365 (Graph) und Google (Gmail, Kalender). Dünne HTTP-Aufrufe ohne SDK.
 *
 * Berechtigungen: nur lesen (`Mail.Read`, `Calendars.Read` bzw. `gmail.readonly`, `calendar.readonly`). Dazu `openid email`, damit der Token-Aufruf
 * ein ID-Token mit der Adresse des Postfachs liefert (eigene Adresse für den Ausschluss, `nonce` wird geprüft), und für das Erneuern ohne Anmeldung
 * `offline_access` (Microsoft) bzw. `access_type=offline` (Google). Das ID-Token kommt direkt vom Token-Endpunkt über TLS; seine Signatur wird
 * deshalb nicht geprüft (zulässig nach OpenID Connect Core 3.1.3.7), Aussteller-Zielgruppe (`aud`), Ablauf und `nonce` schon.
 *
 * NICHT gegen die echten Dienste geprüft: App-Registrierung, Zustimmungsablauf und Antwortformen sind nach der Dokumentation der Anbieter gebaut.
 */

export type Anbietername = "microsoft" | "google";
export type Bereich = "mail" | "kalender";

export const SCOPES: Record<Anbietername, Record<Bereich, string[]>> = {
  microsoft: {
    mail: ["openid", "email", "offline_access", "Mail.Read"],
    kalender: ["openid", "email", "offline_access", "Calendars.Read"],
  },
  google: {
    mail: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"],
    kalender: ["openid", "email", "https://www.googleapis.com/auth/calendar.readonly"],
  },
};

export const sha256Hex = (text: string) => createHash("sha256").update(text).digest("hex");
export const zufall = () => randomBytes(32).toString("base64url");

export function pkcePaar(): { verifier: string; challenge: string } {
  const verifier = zufall();
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function baueAutorisierungsUrl(
  a: OAuthAnbieter,
  name: Anbietername,
  bereich: Bereich,
  p: { redirectUri: string; state: string; nonce: string; challenge: string },
): string {
  const u = new URL(a.autorisierungUrl);
  u.searchParams.set("client_id", a.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES[name][bereich].join(" "));
  u.searchParams.set("state", p.state);
  u.searchParams.set("nonce", p.nonce);
  u.searchParams.set("code_challenge", p.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  if (name === "google") {
    u.searchParams.set("access_type", "offline");
    u.searchParams.set("prompt", "consent");
    u.searchParams.set("include_granted_scopes", "false");
  } else {
    u.searchParams.set("response_mode", "query");
    u.searchParams.set("prompt", "select_account");
  }
  return u.toString();
}

export interface Token {
  accessToken: string;
  /** Beim Erneuern kann der Anbieter kein neues Refresh-Token liefern; dann gilt das bisherige. */
  refreshToken: string | null;
  ablaufMs: number;
  idToken: string | null;
}

async function tokenAufruf(abrufer: Abrufer, a: OAuthAnbieter, felder: Record<string, string>, jetzt: number): Promise<Token> {
  let antwort: Response;
  try {
    antwort = await abrufer(a.tokenUrl, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: a.clientId, client_secret: a.clientSecret, ...felder }).toString(),
    });
  } catch {
    throw new PostfachFehler("ANBIETER_NICHT_ERREICHBAR");
  }
  const koerper = (await antwort.json().catch(() => null)) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; id_token?: unknown; error?: unknown } | null;
  if (!antwort.ok) {
    // Nur der Fehlercode des Protokolls (`invalid_grant`, ...), nie weitere Felder der Antwort.
    if (koerper?.error === "invalid_grant" || koerper?.error === "invalid_client" || antwort.status === 401) throw new PostfachFehler("ZUGANG_UNGUELTIG", true);
    throw new PostfachFehler(`ANBIETER_FEHLER_${antwort.status}`);
  }
  if (typeof koerper?.access_token !== "string") throw new PostfachFehler("ANBIETER_ANTWORT_UNGUELTIG");
  const dauer = typeof koerper.expires_in === "number" ? koerper.expires_in : 3600;
  return {
    accessToken: koerper.access_token,
    refreshToken: typeof koerper.refresh_token === "string" ? koerper.refresh_token : null,
    ablaufMs: jetzt + dauer * 1000,
    idToken: typeof koerper.id_token === "string" ? koerper.id_token : null,
  };
}

export function tauscheCode(abrufer: Abrufer, a: OAuthAnbieter, p: { code: string; redirectUri: string; verifier: string }, jetzt = Date.now()): Promise<Token> {
  return tokenAufruf(abrufer, a, { grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri, code_verifier: p.verifier }, jetzt);
}

export function erneuere(abrufer: Abrufer, a: OAuthAnbieter, refreshToken: string, jetzt = Date.now()): Promise<Token> {
  return tokenAufruf(abrufer, a, { grant_type: "refresh_token", refresh_token: refreshToken }, jetzt);
}

/** Liest und prüft das ID-Token (`aud`, Ablauf, `nonce`) und gibt die Adresse des Postfachs zurück. */
export function pruefeIdToken(idToken: string | null, p: { clientId: string; nonceHash: string; jetzt?: number }): { adresse: string } {
  if (!idToken) throw new PostfachFehler("ID_TOKEN_FEHLT");
  const teile = idToken.split(".");
  if (teile.length !== 3) throw new PostfachFehler("ID_TOKEN_UNGUELTIG");
  let nutzlast: { aud?: unknown; exp?: unknown; nonce?: unknown; email?: unknown; preferred_username?: unknown };
  try {
    nutzlast = JSON.parse(Buffer.from(teile[1]!, "base64url").toString("utf8")) as typeof nutzlast;
  } catch {
    throw new PostfachFehler("ID_TOKEN_UNGUELTIG");
  }
  const aud = Array.isArray(nutzlast.aud) ? nutzlast.aud : [nutzlast.aud];
  if (!aud.includes(p.clientId)) throw new PostfachFehler("ID_TOKEN_UNGUELTIG");
  if (typeof nutzlast.exp === "number" && nutzlast.exp * 1000 < (p.jetzt ?? Date.now())) throw new PostfachFehler("ID_TOKEN_UNGUELTIG");
  if (typeof nutzlast.nonce !== "string" || sha256Hex(nutzlast.nonce) !== p.nonceHash) throw new PostfachFehler("NONCE_UNGUELTIG");
  const adresse = typeof nutzlast.email === "string" ? nutzlast.email : typeof nutzlast.preferred_username === "string" ? nutzlast.preferred_username : null;
  if (!adresse || !adresse.includes("@")) throw new PostfachFehler("ID_TOKEN_UNGUELTIG");
  return { adresse: adresse.toLowerCase() };
}
