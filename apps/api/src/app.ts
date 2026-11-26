import { sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Db } from "@carraway/db";
import { timingSafeEqual, createHash } from "node:crypto";
import { erstelleAuth } from "./anmeldung/auth";
import { authRouten, ursprungPruefung } from "./anmeldung/schutz";
import { passwortRouten } from "./anmeldung/zuruecksetzen";
import { fehlerAntwort, Fachfehler } from "./fehler";
import { ladeKonfiguration, type Konfiguration } from "./konfiguration";
import { rechtePruefung } from "./rechte/pruefen";
import { erstelleRegelwerk } from "./rechte/tabelle";
import { anmeldeanbieterAus, meldeBerichtsartenAn, type ApiErweiterung } from "./erweiterung";
import { apiSchluesselRouten } from "./routen/api-schluessel";
import { benutzerRouten, einrichtungRouten } from "./routen/benutzer";
import { rechteRouten } from "./routen/rechte";
import { kontoRouten } from "./routen/konto";
import { kontoSicherheitRouten } from "./routen/konto-sicherheit";
import { fondsInvestorRouten } from "./routen/investoren";
import { bewegungRouten } from "./routen/bewegungen";
import { berichteRouten } from "./routen/berichte";
import { berichtFreigabeRouten } from "./routen/berichtsfreigabe";
import { foerderprogrammRouten, fondsMeldewesenRouten, meldedefinitionRouten, organisationMeldedatenRouten } from "./routen/meldewesen";
import { meldelaufRouten } from "./routen/meldelaeufe";
import { erstelleStandardSpeicher, type Speicher } from "./berichte/speicher";
import { aenderungenRouten } from "./routen/aenderungen";
import { exportRoute } from "./routen/export";
import { openapiRouten } from "./routen/openapi";
import { stapelRouten } from "./routen/stapel";
import { idempotenz } from "./idempotenz";
import { importRouten } from "./routen/import";
import { externRouten } from "./routen/extern";
import { kennzahlRouten } from "./routen/kennzahlen";
import { beteiligungRouten } from "./routen/beteiligungen";
import { aktivitaetRouten, wiedervorlageRouten } from "./routen/aktivitaeten";
import { dealflowRouten } from "./routen/dealflow";
import { crmRouten } from "./routen/crm";
import { dealRouten } from "./routen/deals";
import { beschlussvorlageRouten } from "./routen/beschlussvorlagen";
import { kontaktimportRouten } from "./routen/kontaktimport";
import { kontaktrolleRouten } from "./routen/kontaktrollen";
import { beziehungRouten } from "./routen/organisationsbeziehungen";
import { vehikelRouten } from "./routen/vehikel";
import { sucheRouten } from "./routen/suche";
import { betriebRouten } from "./routen/betrieb";
import { dokumentRouten } from "./routen/dokumente";
import { fondsRouten } from "./routen/fonds";
import { rundenpositionRouten } from "./routen/kapital";
import { setzeStandardSicht } from "./kapital/sicht";
import { fondsbewegungRouten } from "./routen/buchungen";
import { positionZahlungRouten, rundenRouten } from "./routen/runden";
import { organisationRouten } from "./routen/organisationen";
import { reserveRouten, szenarioFondsRouten, szenarioRouten } from "./routen/szenarien";
import { registerBeteiligungRouten, registerOrganisationRouten, registerRouten } from "./routen/register";
import { erstelleRegisterAnbieter, type RegisterAnbieter } from "./register/anbieter";
import { personRouten } from "./routen/personen";
import { forderungRouten, verkaufRouten } from "./routen/verkauf";
import { bewertungRouten, bewertungsrundeRouten } from "./routen/bewertungen";
import { zinslaufRouten } from "./routen/zinslaeufe";
import { belegRouten } from "./routen/belege";
import { beteiligungBuchhaltungRouten, fondsBuchhaltungRouten, kontenregelRouten } from "./routen/buchhaltung";
import { buchungsexportRouten, fondsExportRouten } from "./routen/buchungsexport";
import { fondsSaldenRouten, saldenlaufRouten } from "./routen/saldenlaeufe";
import { meilensteinRouten, vorgangRouten } from "./routen/vorgaenge";
import { instrumentRouten, trancheRouten } from "./routen/instrumente";
import { beteiligungWaehrungRouten, fondsWaehrungRouten, wechselkursRouten } from "./routen/waehrung";
import { beteiligungFelderRouten, fondsFelderRouten, rundenFelderRouten, vorgangFelderRouten, zusatzfelderRouten } from "./routen/zusatzfelder";
import { leseBetriebszustand } from "./beobachtung/betrieb";
import { Metriken, type Poolstand } from "./beobachtung/metriken";
import { fehlerFelder, loggerAusUmgebung, type Logger } from "./beobachtung/protokoll";
import { zugriffsbeobachtung } from "./beobachtung/zugriff";
import { statischeDateien } from "./statisch";
import { mailRouten } from "./routen/mail";
import { einstellungenRouten } from "./routen/einstellungen";
import { themaRouten } from "./routen/thema";
import { kalenderOeffentlichRouten } from "./routen/kalender";
import { postfachRouten } from "./routen/postfach";
import { terminRouten } from "./routen/termine";
import { anhangRouten } from "./routen/anhaenge";
import { erstelleEchteImapVerbindung, type ImapFabrik } from "./postfach/imap";
import type { Aufloeser } from "./postfach/ziel";
import { lese } from "./zeitlimit";

/** Sucht in der Ursachenkette (Drizzle verpackt den Treiberfehler) nach einem Postgres-Fehlercode. */
export function hatFehlercode(fehler: unknown, code: string): boolean {
  for (let e: unknown = fehler, tiefe = 0; e && tiefe < 5; tiefe++, e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === code) return true;
  }
  return false;
}

/** Trigger des Ausschlusses von Investor-Benutzern und internen Rechten (Migration 0028) meldet den eigenen SQLSTATE `IV001`. */
export const istInvestorAusschluss = (fehler: unknown) => hatFehlercode(fehler, "IV001");

/** `statement_timeout` meldet Postgres mit 57014, `lock_timeout` mit 55P03. */
const istZeitueberschreitung = (fehler: unknown) => hatFehlercode(fehler, "57014");
const istSperrzeitueberschreitung = (fehler: unknown) => hatFehlercode(fehler, "55P03");
/** Trigger der Periodensperre (Migration 0012) meldet den eigenen SQLSTATE `PS001`. */
export const istPeriodensperre = (fehler: unknown) => hatFehlercode(fehler, "PS001");

/** Sperrdatum aus dem `DETAIL` des Trigger-Fehlers `PS001` (Fehlerkette), `null` wenn es kein Datum ist. */
export function sperrdatumAus(fehler: unknown): string | null {
  for (let e: unknown = fehler, tiefe = 0; e && tiefe < 5; tiefe++, e = (e as { cause?: unknown }).cause) {
    const detail = (e as { detail?: unknown }).detail;
    if (typeof detail === "string" && /^\d{4}-\d{2}-\d{2}$/.test(detail)) return detail;
  }
  return null;
}

const standardLogger = loggerAusUmgebung("api");

/** Antwort auf einen Fehler außerhalb der Fachlogik: Fachfehler, Eingabefehler, Sperren und Zeitgrenzen der Datenbank; sonst 500. */
export function behandleFehler(fehler: unknown, c: Context, logger: Logger = standardLogger) {
  if (fehler instanceof Fachfehler) return fehlerAntwort(c, fehler.status, fehler.code, fehler.message, undefined, fehler.zusatz);
  if (fehler instanceof HTTPException) {
    if (fehler.status === 404) return fehlerAntwort(c, 404, "NICHT_GEFUNDEN", "Die angeforderte Ressource gibt es nicht.");
    if (fehler.status === 400) return fehlerAntwort(c, 400, "EINGABE_UNGUELTIG", "Die Anfrage ist ungültig.");
  }
  if (istPeriodensperre(fehler)) {
    // Der Trigger legt das Sperrdatum in `DETAIL` (PostgreSQL-Fehler `detail`), wie die API-Prüfung nennt sie `gesperrtBis`.
    const gesperrtBis = sperrdatumAus(fehler);
    return fehlerAntwort(c, 409, "PERIODE_GESPERRT", gesperrtBis ? `Die Periode ist bis ${gesperrtBis} gesperrt.` : "Die Periode ist gesperrt.", undefined, gesperrtBis ? { gesperrtBis } : undefined);
  }
  if (istInvestorAusschluss(fehler)) return fehlerAntwort(c, 409, "INVESTOR_BENUTZER", "Investor-Benutzer des LP-Portals erhalten keine Fondsrollen und keine Verwalterrechte.");
  if (istZeitueberschreitung(fehler)) return fehlerAntwort(c, 503, "ABFRAGE_ZU_LANG", "Die Abfrage hat zu lange gedauert.");
  if (istSperrzeitueberschreitung(fehler)) return fehlerAntwort(c, 503, "SPERRE_ZU_LANG", "Der Datensatz ist gerade gesperrt, bitte erneut versuchen.");
  logger("error", "unbehandelter Fehler", { anfrageId: c.get("anfrageId"), methode: c.req.method, ...fehlerFelder(fehler) });
  return fehlerAntwort(c, 500, "INTERNER_FEHLER", "Interner Fehler.");
}

/** Zusätzliche Optionen der Anwendung (Tests). */
export interface AppOptionen {
  /** Ablage freigegebener Berichtsdateien; Standard ist das Verzeichnis `STORAGE_DIR` (oder `./storage`). */
  speicher?: Speicher;
  /** Zeilen für Zugriffe und Fehler; ohne Angabe gibt es keine Zugriffszeilen, Fehler gehen an den Standard-Logger. */
  logger?: Logger;
  /** Datenbank-Pool der API für `/metriken` (Verbindungen gesamt, frei, wartend). */
  pool?: Poolstand;
  /** `fetch` für Aufrufe an Anbieter (OAuth-Token); Tests übergeben eine Fake-Funktion, damit nie ein echter Host erreicht wird. */
  abrufer?: typeof fetch;
  /** Verbindung zu IMAP-Servern; Tests übergeben eine Fake-Fabrik. */
  imapFabrik?: ImapFabrik;
  /** DNS-Auflösung für die Prüfung der IMAP-Ziele (Tests). */
  aufloeser?: Aufloeser;
  /** Quelle für Registerdaten (Etappe 18); ohne Angabe aus der Umgebung (`REGISTER_ANBIETER`), sonst keine. */
  registerAnbieter?: RegisterAnbieter | null;
  /** Erweiterungen (Open Core, `ee/`): Routen, Regeln, Anmeldeanbieter, Angaben im Betriebsstatus. Der Kern allein läuft ohne. */
  erweiterungen?: readonly ApiErweiterung[];
}

/**
 * Erzeugt die Anwendung ohne Port, damit Tests sie mit `app.request(...)` aufrufen können. `optionen` überschreibt
 * die Konfiguration aus den Umgebungsvariablen (Tests, ohne `process.env` zu verändern).
 */
export function erstelleApp(db: Db, optionen: Partial<Konfiguration> & AppOptionen = {}) {
  const { speicher, logger, pool, abrufer, imapFabrik, aufloeser, registerAnbieter, erweiterungen = [], ...konfigOptionen } = optionen;
  const anbieter = registerAnbieter === undefined ? erstelleRegisterAnbieter() : registerAnbieter;
  const konfig: Konfiguration = { ...ladeKonfiguration(), ...konfigOptionen };
  setzeStandardSicht(konfig.kapitalSicht);
  const anmeldeanbieter = anmeldeanbieterAus(erweiterungen, konfig);
  const auth = erstelleAuth(db, konfig, anmeldeanbieter);
  const dateiSpeicher = speicher ?? erstelleStandardSpeicher();
  const regelwerk = erstelleRegelwerk(erweiterungen.flatMap((e) => e.regeln ?? []));
  meldeBerichtsartenAn(erweiterungen);
  const app = new Hono();

  const metriken = new Metriken();
  app.use("*", zugriffsbeobachtung({ logger, metriken }));

  app.use("*", async (c, next) => {
    const start = performance.now();
    await next();
    c.res.headers.set("Server-Timing", `app;dur=${(performance.now() - start).toFixed(1)}`);
  });

  app.notFound((c) => fehlerAntwort(c, 404, "NICHT_GEFUNDEN", "Die angeforderte Ressource gibt es nicht."));

  app.onError((fehler, c) => behandleFehler(fehler, c, logger));

  /** Der Stapel ruft die fertige App für jede Operation auf; gesetzt, sobald sie gebaut ist. */
  const aufrufer: { fetch?: (anfrage: Request) => Promise<Response> | Response; app?: Hono } = {};
  const v1 = new Hono()
    .use("*", ursprungPruefung(konfig))
    .use("*", async (c, next) => {
      // Mail-Einstellungen für Routen, die Aufträge anlegen (Etappe 17).
      c.set("mail", { konfig: konfig.mail, ring: konfig.schluessel, appBasis: konfig.appOrigins[0]! });
      await next();
    })
    .use("*", rechtePruefung(db, auth, konfig, regelwerk))
    .use("*", idempotenz(db))
    .get("/gesundheit", async (c) => {
      try {
        await lese(db, (tx) => tx.execute(sql`SELECT 1`));
      } catch {
        return c.json({ ok: false as const, datenbank: false as const }, 503);
      }
      // 200/503 hängen nur an der Datenbank: Ein Worker-Ausfall macht die API nicht unbereit, er steht im Feld `worker`.
      const betrieb = await leseBetriebszustand(db);
      return c.json(
        {
          ok: true as const,
          datenbank: true as const,
          worker: betrieb.worker,
          warteschlange: {
            wartend: betrieb.warteschlange?.wartend ?? null,
            aeltesterWartenderSekunden: betrieb.warteschlange?.aeltesterWartenderSekunden ?? null,
            ausgangskorb: betrieb.ausgangskorb?.anzahl ?? null,
            ausgangskorbAeltesterSekunden: betrieb.ausgangskorb?.aeltesterSekunden ?? null,
          },
        },
        200,
      );
    })
    .route("/", kontoRouten(konfig, db, Object.keys(anmeldeanbieter.socialProviders)))
    .route("/konto", kontoSicherheitRouten(db, auth, konfig))
    .route("/auth", authRouten(auth, konfig))
    .route("/einrichtung", einrichtungRouten(db))
    .route("/passwort", passwortRouten(db, auth, konfig))
    .route("/benutzer", benutzerRouten(db, auth))
    .route("/rechte", rechteRouten(db))
    .route("/betrieb", betriebRouten(db, dateiSpeicher, konfig, erweiterungen))
    .route("/api-schluessel", apiSchluesselRouten(db))
    .route("/fonds/:fondsId/investorenzugaenge", fondsInvestorRouten(db))
    .route("/fonds", fondsRouten(db))
    .route("/fonds", bewegungRouten(db, dateiSpeicher))
    .route("/fonds", fondsBuchhaltungRouten(db))
    .route("/fonds", fondsSaldenRouten(db))
    .route("/fonds", fondsExportRouten(db, dateiSpeicher))
    .route("/kontenregeln", kontenregelRouten(db))
    .route("/belege", belegRouten(db, dateiSpeicher))
    .route("/saldenlaeufe", saldenlaufRouten(db))
    .route("/buchungsexporte", buchungsexportRouten(db, dateiSpeicher))
    .route("/beteiligungen", beteiligungBuchhaltungRouten(db))
    .route("/fonds", fondsMeldewesenRouten(db))
    .route("/beteiligungen", beteiligungRouten(db))
    .route("/berichte", berichteRouten(db))
    .route("/berichte", berichtFreigabeRouten(db, dateiSpeicher))
    .route("/meldedefinitionen", meldedefinitionRouten(db))
    .route("/foerderprogramme", foerderprogrammRouten(db))
    .route("/meldelaeufe", meldelaufRouten(db, dateiSpeicher))
    .route("/deals", dealRouten(db))
    .route("/organisationen", organisationRouten(db))
    .route("/organisationen", organisationMeldedatenRouten(db))
    .route("/organisationen", registerOrganisationRouten(db, anbieter))
    .route("/register", registerRouten(db, anbieter))
    .route("/beteiligungen", registerBeteiligungRouten(db))
    .route("/fonds", szenarioFondsRouten(db))
    .route("/szenarien", szenarioRouten(db))
    .route("/beteiligungen", reserveRouten(db))
    .route("/rundenpositionen", rundenpositionRouten(db))
    .route("/rundenpositionen", positionZahlungRouten(db))
    .route("/finanzierungsrunden", rundenRouten(db))
    .route("/personen", personRouten(db))
    .route("/kontaktrollen", kontaktrolleRouten(db))
    .route("/organisationsbeziehungen", beziehungRouten(db))
    .route("/vehikel", vehikelRouten(db))
    .route("/kontaktimport", kontaktimportRouten(db))
    .route("/suche", sucheRouten(db))
    .route("/dokumente", dokumentRouten(db, dateiSpeicher, konfig.dokumentAufbewahrungTage))
    .route("/beschlussvorlagen", beschlussvorlageRouten(db))
    .route("/aktivitaeten", aktivitaetRouten(db))
    .route("/aktivitaeten", anhangRouten(db, { konfig, abrufer: abrufer ?? fetch, imapFabrik: imapFabrik ?? erstelleEchteImapVerbindung, speicher: dateiSpeicher }))
    .route("/wiedervorlagen", wiedervorlageRouten(db))
    .route("/dealflow", dealflowRouten(db))
    .route("/crm", crmRouten(db))
    .route("/vorgaenge", vorgangRouten(db))
    .route("/vorgaenge", vorgangFelderRouten(db))
    .route("/zusatzfelder", zusatzfelderRouten(db))
    .route("/wechselkurse", wechselkursRouten(db))
    .route("/beteiligungen", beteiligungWaehrungRouten(db))
    .route("/fonds", fondsWaehrungRouten(db))
    .route("/fonds", fondsFelderRouten(db))
    .route("/beteiligungen", beteiligungFelderRouten(db))
    .route("/finanzierungsrunden", rundenFelderRouten(db))
    .route("/fondsbewegungen", fondsbewegungRouten(db))
    .route("/meilensteine", meilensteinRouten(db))
    .route("/instrumente", instrumentRouten(db))
    .route("/tranchen", trancheRouten(db))
    .route("/zinslaeufe", zinslaufRouten(db))
    .route("/forderungen", forderungRouten(db))
    .route("/verkaeufe", verkaufRouten(db))
    .route("/bewertungen", bewertungRouten(db))
    .route("/bewertungsrunden", bewertungsrundeRouten(db))
    .route("/kennzahlen", kennzahlRouten(db))
    .route("/extern", externRouten(db, konfig))
    .route("/mail", mailRouten(db))
    .route("/einstellungen", einstellungenRouten(db))
    .route("/thema", themaRouten(db))
    .route("/postfach", postfachRouten(db, { konfig, abrufer: abrufer ?? fetch, imapFabrik: imapFabrik ?? erstelleEchteImapVerbindung, aufloeser }))
    .route("/termine", terminRouten(db))
    .route("/kalender", kalenderOeffentlichRouten(db, konfig))
    .route("/import", importRouten(db))
    .route("/export", exportRoute(db, dateiSpeicher))
    .route("/aenderungen", aenderungenRouten(db))
    .route("/", openapiRouten(() => aufrufer.app!, regelwerk))
    .route("/stapel", stapelRouten(db, (anfrage) => aufrufer.fetch!(anfrage)));
  // Routen der Erweiterungen hängen hinter denen des Kerns; ihre Regeln stehen im Regelwerk oben. Der Typ `AppType` kennt nur den Kern.
  for (const e of erweiterungen) if (e.routen) v1.route("/", e.routen({ db, auth, konfig, speicher: dateiSpeicher }));

  if (konfig.webVerzeichnis) app.use(
      "*",
      statischeDateien(konfig.webVerzeichnis, {
        hsts: konfig.appOrigins.every((o) => o.startsWith("https://")),
      }),
    );

  // Metriken im Prometheus-Format, außerhalb von `/api/v1` und der Rechteprüfung, mit eigenem Token.
  app.get("/metriken", async (c) => {
    if (!konfig.metrikenToken) return fehlerAntwort(c, 404, "NICHT_GEFUNDEN", "Die angeforderte Ressource gibt es nicht.");
    if (!tokenGleich(c.req.header("Authorization"), konfig.metrikenToken)) return fehlerAntwort(c, 401, "NICHT_ANGEMELDET", "Metriken-Token fehlt oder ist falsch.");
    const betrieb = await leseBetriebszustand(db).catch(() => undefined);
    return c.body(metriken.rendere(pool, betrieb), 200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", "Cache-Control": "no-store" });
  });

  const gesamt = app.route("/api/v1", v1);
  aufrufer.fetch = (anfrage) => gesamt.fetch(anfrage);
  aufrufer.app = gesamt;
  return gesamt;
}

/** Vergleicht `Authorization: Bearer <token>` in konstanter Zeit (Vergleich über SHA-256, damit die Länge nichts verrät). */
function tokenGleich(kopf: string | undefined, erwartet: string): boolean {
  const m = /^Bearer (.+)$/i.exec(kopf ?? "");
  const hash = (t: string) => createHash("sha256").update(t).digest();
  return timingSafeEqual(hash(m?.[1] ?? ""), hash(erwartet)) && m !== null;
}

export type AppType = ReturnType<typeof erstelleApp>;
