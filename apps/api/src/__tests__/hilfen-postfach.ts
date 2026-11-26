import { createHash, randomBytes } from "node:crypto";
import type { PostfachKonfiguration } from "../postfach/konfiguration";

/**
 * Bausteine für die Tests der Postfach-Anbindung: ein Fake-Autorisierungsserver (nur als `fetch`-Funktion, kein Netzwerk) und eine Konfiguration mit
 * Fake-Adressen. Der Fake prüft PKCE (S256), Client-Zugang, Weiterleitungsadresse, Einmaligkeit des Codes und die Rotation der Refresh-Tokens.
 */

export const FAKE_HOSTS = {
  autorisierung: "https://login.fake.example/authorize",
  token: "https://login.fake.example/token",
  graph: "https://graph.fake.example/v1.0",
  gmail: "https://gmail.fake.example/gmail/v1",
  kalender: "https://calendar.fake.example/calendar/v3",
};

export const postfachKonfig = (zusatz: Partial<PostfachKonfiguration> = {}): PostfachKonfiguration => ({
  microsoft: { clientId: "client-ms", clientSecret: "secret-ms", autorisierungUrl: FAKE_HOSTS.autorisierung, tokenUrl: FAKE_HOSTS.token, apiBasis: FAKE_HOSTS.graph },
  imap: true,
  privateZiele: false,
  intervallMinuten: 15,
  ...zusatz,
});

const sha256Base64Url = (t: string) => createHash("sha256").update(t).digest("base64url");
const base64Url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

export interface AutorisierungsAnfrage {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  nonce: string;
  challenge: string;
  challengeMethode: string;
  zusatz: Record<string, string>;
}

export function liesAutorisierungsUrl(url: string): AutorisierungsAnfrage {
  const u = new URL(url);
  const p = u.searchParams;
  const bekannt = new Set(["client_id", "redirect_uri", "scope", "state", "nonce", "code_challenge", "code_challenge_method", "response_type"]);
  return {
    clientId: p.get("client_id")!,
    redirectUri: p.get("redirect_uri")!,
    scope: p.get("scope")!,
    state: p.get("state")!,
    nonce: p.get("nonce")!,
    challenge: p.get("code_challenge")!,
    challengeMethode: p.get("code_challenge_method")!,
    zusatz: Object.fromEntries([...p.entries()].filter(([k]) => !bekannt.has(k))),
  };
}

export interface FakeOAuthOptionen {
  clientId?: string;
  clientSecret?: string;
  adresse?: string;
  /** Liefert ein ID-Token mit falschem `nonce`. */
  falscheNonce?: boolean;
  /** Liefert beim Code-Tausch kein Refresh-Token. */
  ohneRefreshToken?: boolean;
  /** Lebensdauer der Zugriffstoken in Sekunden. */
  lebensdauer?: number;
}

/** Fake-Autorisierungsserver: `abrufer` ist die `fetch`-Funktion der App, `autorisiere` erzeugt den Code, den die Anbieterseite an die Rückruf-Adresse hängen würde. */
export function erstelleFakeOAuth(o: FakeOAuthOptionen = {}) {
  const clientId = o.clientId ?? "client-ms";
  const clientSecret = o.clientSecret ?? "secret-ms";
  const adresse = o.adresse ?? "owner@example.com";
  const codes = new Map<string, AutorisierungsAnfrage>();
  const gueltigeRefresh = new Set<string>();
  const aufrufe: { url: string; felder: Record<string, string> }[] = [];
  let zaehler = 0;

  const tokens = (anfrage: AutorisierungsAnfrage | null) => {
    zaehler++;
    const refresh = `refresh-${zaehler}-${randomBytes(6).toString("hex")}`;
    gueltigeRefresh.add(refresh);
    const idToken = anfrage
      ? `${base64Url({ alg: "none" })}.${base64Url({ aud: clientId, exp: Math.floor(Date.now() / 1000) + 600, nonce: o.falscheNonce ? "falsch" : anfrage.nonce, email: adresse })}.x`
      : undefined;
    return { access_token: `access-${zaehler}-${randomBytes(6).toString("hex")}`, refresh_token: o.ohneRefreshToken && anfrage ? undefined : refresh, expires_in: o.lebensdauer ?? 3600, id_token: idToken };
  };

  const antwort = (status: number, koerper: unknown) => new Response(JSON.stringify(koerper), { status, headers: { "content-type": "application/json" } });

  const abrufer: typeof fetch = async (eingabe, init) => {
    const url = typeof eingabe === "string" ? eingabe : eingabe instanceof URL ? eingabe.toString() : eingabe.url;
    if (url !== FAKE_HOSTS.token) throw new Error(`Unerwarteter Aufruf an ${url}: Tests erreichen nur Fake-Hosts`);
    const felder = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
    aufrufe.push({ url, felder });
    if (felder.client_id !== clientId || felder.client_secret !== clientSecret) return antwort(401, { error: "invalid_client" });
    if (felder.grant_type === "authorization_code") {
      const anfrage = codes.get(felder.code ?? "");
      if (!anfrage) return antwort(400, { error: "invalid_grant" });
      codes.delete(felder.code!); // einmalig
      if (felder.redirect_uri !== anfrage.redirectUri) return antwort(400, { error: "invalid_grant" });
      if (anfrage.challengeMethode !== "S256" || sha256Base64Url(felder.code_verifier ?? "") !== anfrage.challenge) return antwort(400, { error: "invalid_grant" });
      return antwort(200, tokens(anfrage));
    }
    if (felder.grant_type === "refresh_token") {
      if (!gueltigeRefresh.has(felder.refresh_token ?? "")) return antwort(400, { error: "invalid_grant" });
      gueltigeRefresh.delete(felder.refresh_token!); // rotierend: das alte Token ist danach ungültig
      return antwort(200, tokens(null));
    }
    return antwort(400, { error: "unsupported_grant_type" });
  };

  return {
    abrufer,
    aufrufe,
    /** Wie ein Klick auf „Zustimmen“: gibt den Code zurück, der zur Anfrage gehört. */
    autorisiere(url: string): { code: string; anfrage: AutorisierungsAnfrage } {
      const anfrage = liesAutorisierungsUrl(url);
      const code = `code-${randomBytes(8).toString("hex")}`;
      codes.set(code, anfrage);
      return { code, anfrage };
    },
    /** Widerruft alle Refresh-Tokens (Nutzer hat den Zugriff beim Anbieter entzogen). */
    widerrufeAlles() {
      gueltigeRefresh.clear();
    },
    refreshTokenAnzahl: () => gueltigeRefresh.size,
  };
}
