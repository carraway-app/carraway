import { fileURLToPath } from "node:url";
import { LOKALES_ENTWICKLUNGSGEHEIMNIS } from "@carraway/db";
import { ladeSchluesselring, type Schluesselring } from "./geheimnis/krypto";
import { ladeKapitalSicht, type Sicht } from "./kapital/sicht";
import { ladeMailKonfiguration, type MailKonfiguration } from "./mail/konfiguration";
import { ladePostfachKonfiguration, type PostfachKonfiguration } from "./postfach/konfiguration";

/**
 * Einstellungen des Servers. Alles kommt aus Umgebungsvariablen (`ladeKonfiguration`); Tests übergeben ein
 * Objekt statt `process.env` zu verändern.
 */

export const UMGEBUNGEN = ["demo", "test", "echt"] as const;
export type Umgebung = (typeof UMGEBUNGEN)[number];

export interface Konfiguration {
  umgebung: Umgebung;
  /** Erlaubte Ursprünge der Oberfläche; der erste ist die Basis-Adresse der API (Cookies, OIDC-Rückruf). */
  appOrigins: string[];
  geheimnis: string;
  /** Jede Person braucht einen zweiten Faktor (TOTP), sonst 403 `two_factor_required` außer bei der Einrichtung. */
  zweiFaktorPflicht: boolean;
  /** `X-Forwarded-For` auswerten (nur hinter einem vertrauenswürdigen Reverse-Proxy). */
  proxyVertrauen: boolean;
  /** Offene Selbstregistrierung; sonst nur die erste Person (wird globaler Verwalter) und Anlage durch Verwalter. */
  registrierungOffen: boolean;
  anmeldeLimit: { versuche: number; fensterMs: number };
  /** Anfragen zum Zurücksetzen des Passworts je Adresse und je IP im Zeitfenster (jede Anfrage zählt, auch für unbekannte Adressen). */
  passwortLimit: { proAdresse: number; proIp: number; fensterMs: number };
  /** Mindestdauer der Antwort auf `POST /password/forgot`, damit sie nichts über die Adresse verrät. */
  passwortAntwortMinMs: number;
  /**
   * Begrenzung der öffentlichen Abfrage-Endpunkte (`/extern/abfragen/:token`): Anfragen je Token und je IP in der Minute sowie
   * Fehlgriffe (unbekanntes Token) je IP in zehn Minuten.
   */
  externLimit: { tokenProMinute: number; ipProMinute: number; fehlgriffeProZehnMinuten: number };
  /** Token für `GET /metriken` (Prometheus, `Authorization: Bearer`); ohne Token ist der Endpunkt aus (404). */
  metrikenToken?: string;
  /** Verzeichnis der gebauten Oberfläche; gesetzt nur mit `WEB_AUSLIEFERN=1`, dann liefert die API sie vom selben Ursprung aus. */
  webVerzeichnis?: string;
  /** Ausgehende Mail (Etappe 17): SMTP aus der Umgebung; ohne `SMTP_HOST` aus. */
  mail?: MailKonfiguration;
  /** Postfach- und Kalenderanbindung (Etappe 17): App-Registrierungen, IMAP, Abstand der Abgleiche. */
  postfach: PostfachKonfiguration;
  /** Tage, die die Datei eines gelöschten Dokuments in der Ablage bleibt, bevor der Worker sie entfernt (`DOKUMENT_AUFBEWAHRUNG_TAGE`, Vorgabe 30). */
  dokumentAufbewahrungTage: number;
  /** Standard-Sicht der Kapitaltabelle (`KAPITAL_SICHT`: `voll_verwaessert`, Vorgabe, oder `unverwaessert`). */
  kapitalSicht: Sicht;
  /** Schlüsselring für ruhende Geheimnisse (`GEHEIMNIS_SCHLUESSEL`); ohne ihn bleiben Postfachanbindung und Mails mit Link aus. */
  schluessel?: Schluesselring;
}

export class KonfigurationsFehler extends Error {}

export type Umgebungsvariablen = Record<string, string | undefined>;

const istEin = (wert: string | undefined, standard: boolean) => (wert === undefined || wert === "" ? standard : ["1", "true", "ja"].includes(wert.toLowerCase()));

export const STANDARD_AUFBEWAHRUNG_TAGE = 30;

/** Liest `DOKUMENT_AUFBEWAHRUNG_TAGE` (ganze Zahl von 1 bis 3650, Vorgabe 30). */
export function ladeAufbewahrungTage(env: Umgebungsvariablen): number {
  const roh = env.DOKUMENT_AUFBEWAHRUNG_TAGE?.trim();
  if (!roh) return STANDARD_AUFBEWAHRUNG_TAGE;
  const tage = Number(roh);
  if (!Number.isInteger(tage) || tage < 1 || tage > 3650) throw new KonfigurationsFehler("DOKUMENT_AUFBEWAHRUNG_TAGE muss eine ganze Zahl von 1 bis 3650 sein.");
  return tage;
}

/** Adresse der Datenbank aus `DATABASE_URL`; nur lokal gibt es eine Vorgabe, bei `NODE_ENV=production` ist sie Pflicht. */
export function datenbankUrl(env: Umgebungsvariablen = process.env): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.NODE_ENV === "production") throw new KonfigurationsFehler("DATABASE_URL fehlt.");
  return "postgres://carraway:carraway@localhost:5432/carraway_dev";
}

export function ladeKonfiguration(env: Umgebungsvariablen = process.env): Konfiguration {
  const roh = env.CARRAWAY_UMGEBUNG;
  if (roh === undefined && env.NODE_ENV === "production") {
    throw new KonfigurationsFehler("CARRAWAY_UMGEBUNG fehlt (demo, test oder echt).");
  }
  const umgebung = (roh ?? "demo") as Umgebung;
  if (!UMGEBUNGEN.includes(umgebung)) throw new KonfigurationsFehler(`CARRAWAY_UMGEBUNG "${roh}" ungültig (demo, test oder echt).`);

  const appOrigins = (env.APP_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (appOrigins.length === 0 || appOrigins.some((o) => !/^https?:\/\/[^/]+$/.test(o))) {
    throw new KonfigurationsFehler("APP_ORIGIN muss eine oder mehrere Adressen wie https://fonds.example.org enthalten (ohne Pfad).");
  }

  let geheimnis = env.BETTER_AUTH_SECRET;
  if (umgebung === "echt") {
    if (!geheimnis || geheimnis.length < 32) throw new KonfigurationsFehler("BETTER_AUTH_SECRET (mindestens 32 Zeichen) ist im Echtbestand Pflicht.");
    if (!appOrigins.every((o) => o.startsWith("https://"))) throw new KonfigurationsFehler("Im Echtbestand muss APP_ORIGIN mit https:// beginnen.");
  }
  // Das öffentliche Entwicklungsgeheimnis ist nur für Rechner gedacht, auf denen die Oberfläche unter localhost läuft.
  const lokal = appOrigins.every((o) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o));
  if (!lokal && (!geheimnis || geheimnis.length < 32)) throw new KonfigurationsFehler("BETTER_AUTH_SECRET (mindestens 32 Zeichen) ist Pflicht, sobald APP_ORIGIN nicht localhost ist.");
  // Ein Produktionsprozess läuft nie mit dem öffentlichen Entwicklungsgeheimnis, auch nicht hinter localhost.
  if (env.NODE_ENV === "production" && (!geheimnis || geheimnis.length < 32 || geheimnis === LOKALES_ENTWICKLUNGSGEHEIMNIS)) {
    throw new KonfigurationsFehler("BETTER_AUTH_SECRET (mindestens 32 Zeichen, nicht das Entwicklungsgeheimnis) ist Pflicht bei NODE_ENV=production.");
  }
  geheimnis ??= LOKALES_ENTWICKLUNGSGEHEIMNIS;

  const metrikenToken = env.METRIKEN_TOKEN || undefined;
  if (metrikenToken !== undefined && metrikenToken.length < 24) throw new KonfigurationsFehler("METRIKEN_TOKEN muss mindestens 24 Zeichen lang sein.");
  const webVerzeichnis = istEin(env.WEB_AUSLIEFERN, false) ? (env.WEB_VERZEICHNIS || fileURLToPath(new URL("../../web/dist", import.meta.url))) : undefined;

  return {
    umgebung,
    appOrigins,
    geheimnis,
    zweiFaktorPflicht: istEin(env.ZWEI_FAKTOR_PFLICHT, true),
    proxyVertrauen: istEin(env.PROXY_VERTRAUEN, false),
    registrierungOffen: istEin(env.REGISTRIERUNG_OFFEN, false),
    anmeldeLimit: { versuche: 10, fensterMs: 15 * 60 * 1000 },
    passwortLimit: { proAdresse: 3, proIp: 10, fensterMs: 60 * 60 * 1000 },
    passwortAntwortMinMs: 400,
    externLimit: { tokenProMinute: 60, ipProMinute: 120, fehlgriffeProZehnMinuten: 20 },
    metrikenToken,
    webVerzeichnis,
    mail: ladeMailKonfiguration(env, umgebung),
    postfach: ladePostfachKonfiguration(env),
    dokumentAufbewahrungTage: ladeAufbewahrungTage(env),
    kapitalSicht: (() => {
      try {
        return ladeKapitalSicht(env);
      } catch (fehler) {
        throw new KonfigurationsFehler((fehler as Error).message);
      }
    })(),
    schluessel: ladeSchluesselring(env, umgebung),
  };
}
