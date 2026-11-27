import { connections } from "./integrationen/routes";
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
import { fondsKostenRouten } from "./routen/fondskosten";
import { berichteFuerFonds, berichteRouten } from "./routen/berichte";
import { berichtFreigabeRouten } from "./routen/berichtsfreigabe";
import { foerderprogrammRouten, fondsMeldewesenRouten, meldedefinitionRouten, organisationMeldedatenRouten } from "./routen/meldewesen";
import { meldelaufRouten } from "./routen/meldelaeufe";
import { erstelleStandardSpeicher, type Speicher } from "./berichte/speicher";
import { aenderungenRouten } from "./routen/aenderungen";
import { webhookRouten } from "./routen/webhooks";
import { liveRouten } from "./live/route";
import { exportRoute } from "./routen/export";
import { openapiRouten } from "./routen/openapi";
import { stapelRouten } from "./routen/stapel";
import { idempotenz } from "./idempotenz";
import { importRouten } from "./routen/import";
import { vorsystemRouten } from "./routen/vorsystem";
import { externRouten } from "./routen/extern";
import { kennzahlRouten } from "./routen/kennzahlen";
import { beteiligungRouten } from "./routen/beteiligungen";
import { aktivitaetRouten, wiedervorlageRouten } from "./routen/aktivitaeten";
import { dealflowRouten } from "./routen/dealflow";
import { dataRoutes } from "./data-providers/routes";
import { crmRouten } from "./routen/crm";
import { dealRouten } from "./routen/deals";
import { beschlussvorlageRouten } from "./routen/beschlussvorlagen";
import { kontaktimportRouten } from "./routen/kontaktimport";
import { kontaktrolleRouten } from "./routen/kontaktrollen";
import { beziehungRouten } from "./routen/organisationsbeziehungen";
import { organisationVehikelRouten, vehikelRouten } from "./routen/vehikel";
import { beteiligungMandatRouten, fondsMandatRouten } from "./routen/mandate";
import { sucheRouten } from "./routen/suche";
import { betriebRouten, workerAnApi } from "./routen/betrieb";
import { dokumentRouten } from "./routen/dokumente";
import { berichtsvorlagenRouten, freigabestufenRouten } from "./routen/berichtsvorlagen";
import { fondsRouten } from "./routen/fonds";
import { rundenpositionRouten } from "./routen/kapital";
import { setzeStandardSicht } from "./kapital/sicht";
import { fondsbewegungRouten, fondsBuchungRouten } from "./routen/buchungen";
import { positionZahlungRouten, rundenRouten } from "./routen/runden";
import { organisationPortfolioRouten, organisationRouten } from "./routen/organisationen";
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
import { beteiligungVorgangRouten, meilensteinRouten, vorgangRouten } from "./routen/vorgaenge";
import { instrumentRouten, trancheRouten } from "./routen/instrumente";
import { beteiligungWaehrungRouten, fondsWaehrungRouten, wechselkursRouten } from "./routen/waehrung";
import { managerProfilRouten, portfolioRouten, zielfondsRouten } from "./routen/portfolio";
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
import { kontaktvorschlaegeRouten } from "./routen/kontaktvorschlaege";
import { postfachRouten } from "./routen/postfach";
import { terminRouten } from "./routen/termine";
import { anhangRouten, erstelleAnhangDienst } from "./routen/anhaenge";
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
    if (fehler.status === 404) return fehlerAntwort(c, 404, "not_found", "The requested resource does not exist.");
    if (fehler.status === 400) return fehlerAntwort(c, 400, "invalid_input", "The request is invalid.");
  }
  if (hatFehlercode(fehler, "CM001")) return fehlerAntwort(c, 409, "provider_managed", "This record is managed by its CRM provider.");
  if (istPeriodensperre(fehler)) {
    // Der Trigger legt das Sperrdatum in `DETAIL` (PostgreSQL-Fehler `detail`), wie die API-Prüfung nennt sie `gesperrtBis`.
    const gesperrtBis = sperrdatumAus(fehler);
    return fehlerAntwort(c, 409, "period_locked", gesperrtBis ? `The period is locked until ${gesperrtBis}.` : "The period is locked.", undefined, gesperrtBis ? { gesperrtBis } : undefined);
  }
  if (istInvestorAusschluss(fehler)) return fehlerAntwort(c, 409, "investor_user", "Investor users of the LP portal cannot receive fund roles or admin rights.");
  if (istZeitueberschreitung(fehler)) return fehlerAntwort(c, 503, "query_too_long", "The query took too long.");
  if (istSperrzeitueberschreitung(fehler)) return fehlerAntwort(c, 503, "lock_too_long", "The record is currently locked; please try again.");
  logger("error", "unbehandelter Fehler", { anfrageId: c.get("anfrageId"), methode: c.req.method, ...fehlerFelder(fehler) });
  return fehlerAntwort(c, 500, "internal_error", "Internal error.");
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
  providerHttp?: import("./http/oeffentlicher-abruf").AbrufOptionen;
  registerAnbieter?: RegisterAnbieter | null;
  /** Erweiterungen (Open Core, `ee/`): Routen, Regeln, Anmeldeanbieter, Angaben im Betriebsstatus. Der Kern allein läuft ohne. */
  erweiterungen?: readonly ApiErweiterung[];
}

/**
 * Erzeugt die Anwendung ohne Port, damit Tests sie mit `app.request(...)` aufrufen können. `optionen` überschreibt
 * die Konfiguration aus den Umgebungsvariablen (Tests, ohne `process.env` zu verändern).
 */
export function erstelleApp(db: Db, optionen: Partial<Konfiguration> & AppOptionen = {}) {
  const { speicher, logger, pool, abrufer, imapFabrik, aufloeser, registerAnbieter, providerHttp, erweiterungen = [], ...konfigOptionen } = optionen;
  const anbieter = registerAnbieter === undefined ? erstelleRegisterAnbieter() : registerAnbieter;
  const konfig: Konfiguration = { ...ladeKonfiguration(), ...konfigOptionen };
  setzeStandardSicht(konfig.kapitalSicht);
  const anmeldeanbieter = anmeldeanbieterAus(erweiterungen, konfig);
  const auth = erstelleAuth(db, konfig, anmeldeanbieter);
  const dateiSpeicher = speicher ?? erstelleStandardSpeicher();
  const anhaenge = erstelleAnhangDienst(db, { konfig, abrufer: abrufer ?? fetch, imapFabrik: imapFabrik ?? erstelleEchteImapVerbindung, speicher: dateiSpeicher });
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

  app.notFound((c) => fehlerAntwort(c, 404, "not_found", "The requested resource does not exist."));

  app.onError((fehler, c) => behandleFehler(fehler, c, logger));

  /** Stapel und Erweiterungen durchlaufen für jeden internen Aufruf die fertige App. */
  const apiAnfrage = (anfrage: Request) => app.fetch(anfrage);
  const v1 = new Hono()
    .use("*", ursprungPruefung(konfig))
    .use("*", async (c, next) => {
      // Mail-Einstellungen für Routen, die Aufträge anlegen (Etappe 17).
      c.set("mail", { konfig: konfig.mail, ring: konfig.schluessel, appBasis: konfig.appOrigins[0]! });
      await next();
    })
    .use("*", rechtePruefung(db, auth, konfig, regelwerk))
    .use("*", idempotenz(db))
    .get("/health", async (c) => {
      try {
        await lese(db, (tx) => tx.execute(sql`SELECT 1`));
      } catch {
        return c.json({ ok: false as const, database: false as const }, 503);
      }
      // 200/503 hängen nur an der Datenbank: Ein Worker-Ausfall macht die API nicht unbereit, er steht im Feld `worker`.
      const betrieb = await leseBetriebszustand(db);
      return c.json(
        {
          ok: true as const,
          database: true as const,
          worker: workerAnApi(betrieb.worker),
          queue: {
            waiting: betrieb.warteschlange?.wartend ?? null,
            oldestWaitingSeconds: betrieb.warteschlange?.aeltesterWartenderSekunden ?? null,
            outbox: betrieb.ausgangskorb?.anzahl ?? null,
            outboxOldestSeconds: betrieb.ausgangskorb?.aeltesterSekunden ?? null,
          },
        },
        200,
      );
    })
    .route("/", kontoRouten(konfig, db, Object.keys(anmeldeanbieter.socialProviders)))
    .route("/account", kontoSicherheitRouten(db, auth, konfig))
    .route("/auth", authRouten(auth, konfig))
    .route("/setup", einrichtungRouten(db, konfig))
    .route("/password", passwortRouten(db, auth, konfig))
    .route("/users", benutzerRouten(db, auth))
    .route("/permissions", rechteRouten(db))
    .route("/operations", betriebRouten(db, dateiSpeicher, konfig, erweiterungen))
    .route("/api-keys", apiSchluesselRouten(db))
    .route("/funds/:fundId/investor-access", fondsInvestorRouten(db))
    .route("/funds", fondsRouten(db))
    .route("/funds", bewegungRouten(db, dateiSpeicher))
    .route("/funds", fondsKostenRouten(db))
    .route("/funds", fondsBuchungRouten(db))
    .route("/funds/:id", freigabestufenRouten(db))
    .route("/funds/:id", berichtsvorlagenRouten(db))
    .route("/funds/:id/reports", berichteFuerFonds(db))
    .route("/investments/:id", beteiligungVorgangRouten(db))
    .route("/funds", fondsBuchhaltungRouten(db))
    .route("/funds", fondsSaldenRouten(db))
    .route("/funds", fondsExportRouten(db, dateiSpeicher))
    .route("/account-rules", kontenregelRouten(db))
    .route("/vouchers", belegRouten(db, dateiSpeicher))
    .route("/balance-runs", saldenlaufRouten(db))
    .route("/posting-exports", buchungsexportRouten(db, dateiSpeicher))
    .route("/investments", beteiligungBuchhaltungRouten(db))
    .route("/funds", fondsMeldewesenRouten(db))
    .route("/investments", beteiligungRouten(db))
    .route("/reports", berichteRouten(db))
    .route("/reports", berichtFreigabeRouten(db, dateiSpeicher))
    .route("/reporting-definitions", meldedefinitionRouten(db))
    .route("/funding-programs", foerderprogrammRouten(db))
    .route("/reporting-runs", meldelaufRouten(db, dateiSpeicher))
    .route("/deals", dealRouten(db))
    .route("/organizations", organisationRouten(db))
    .route("/organizations", organisationPortfolioRouten(db))
    .route("/organizations/:id", organisationVehikelRouten(db))
    .route("/organizations", organisationMeldedatenRouten(db))
    .route("/organizations", registerOrganisationRouten(db, anbieter))
    .route("/register", registerRouten(db, anbieter))
    .route("/investments", registerBeteiligungRouten(db))
    .route("/funds", szenarioFondsRouten(db))
    .route("/scenarios", szenarioRouten(db))
    .route("/investments", reserveRouten(db))
    .route("/investments", beteiligungMandatRouten(db))
    .route("/funds", fondsMandatRouten(db))
    .route("/round-positions", rundenpositionRouten(db))
    .route("/round-positions", positionZahlungRouten(db))
    .route("/financing-rounds", rundenRouten(db))
    .route("/people", personRouten(db))
    .route("/contact-roles", kontaktrolleRouten(db))
    .route("/organization-relationships", beziehungRouten(db))
    .route("/vehicles", vehikelRouten(db))
    .route("/contact-import", kontaktimportRouten(db))
    .route("/search", sucheRouten(db))
    .route("/documents", dokumentRouten(db, dateiSpeicher, konfig.dokumentAufbewahrungTage))
    .route("/resolution-templates", beschlussvorlageRouten(db))
    .route("/activities", aktivitaetRouten(db))
    .route("/activities", anhangRouten(anhaenge))
    .route("/follow-ups", wiedervorlageRouten(db))
    .route("/dealflow", dealflowRouten(db))
    .route("/", dataRoutes(db, konfig.schluessel, erweiterungen.flatMap(e => e.dataProviders ?? []), providerHttp))
    .route("/integrations", connections(db, konfig.schluessel, erweiterungen.some(e => e.name === "crm-sync")))
    .route("/crm", crmRouten(db))
    .route("/transactions", vorgangRouten(db))
    .route("/transactions", vorgangFelderRouten(db))
    .route("/custom-fields", zusatzfelderRouten(db))
    .route("/exchange-rates", wechselkursRouten(db))
    .route("/investments", beteiligungWaehrungRouten(db))
    .route("/funds", fondsWaehrungRouten(db))
    .route("/funds", zielfondsRouten(db))
    .route("/manager-profile", managerProfilRouten(db))
    .route("/portfolio", portfolioRouten(db))
    .route("/funds", fondsFelderRouten(db))
    .route("/investments", beteiligungFelderRouten(db))
    .route("/financing-rounds", rundenFelderRouten(db))
    .route("/fund-movements", fondsbewegungRouten(db))
    .route("/milestones", meilensteinRouten(db))
    .route("/instruments", instrumentRouten(db))
    .route("/tranches", trancheRouten(db))
    .route("/interest-runs", zinslaufRouten(db))
    .route("/receivables", forderungRouten(db))
    .route("/sales", verkaufRouten(db))
    .route("/valuations", bewertungRouten(db))
    .route("/valuation-rounds", bewertungsrundeRouten(db))
    .route("/metrics", kennzahlRouten(db))
    .route("/external", externRouten(db, konfig))
    .route("/mail", mailRouten(db))
    .route("/settings", einstellungenRouten(db))
    .route("/theme", themaRouten(db))
    .route("/contact-suggestions", kontaktvorschlaegeRouten(db))
    .route("/mailbox", postfachRouten(db, { konfig, abrufer: abrufer ?? fetch, imapFabrik: imapFabrik ?? erstelleEchteImapVerbindung, aufloeser }))
    .route("/meetings", terminRouten(db))
    .route("/calendar", kalenderOeffentlichRouten(db, konfig))
    .route("/import/sources", vorsystemRouten(db, konfig.schluessel, erweiterungen.flatMap((e) => e.vorsysteme ?? []), providerHttp))
    .route("/import", importRouten(db))
    .route("/export", exportRoute(db, dateiSpeicher))
    .route("/changes", aenderungenRouten(db))
    .route("/webhooks", webhookRouten(db, { ring: konfig.schluessel, aufloeser }))
    .route("/live", liveRouten(konfig))
    .route("/", openapiRouten(() => app, regelwerk))
    .route("/batch", stapelRouten(db, apiAnfrage));
  // Routen der Erweiterungen hängen hinter denen des Kerns; ihre Regeln stehen im Regelwerk oben. Der Typ `AppType` kennt nur den Kern.
  for (const e of erweiterungen) if (e.routen) v1.route("/", e.routen({ apiAnfrage, db, auth, konfig, speicher: dateiSpeicher, anhaenge }));

  if (konfig.webVerzeichnis) app.use(
      "*",
      statischeDateien(konfig.webVerzeichnis, {
        hsts: konfig.appOrigins.every((o) => o.startsWith("https://")),
      }),
    );

  // Metriken im Prometheus-Format, außerhalb von `/api/v1` und der Rechteprüfung, mit eigenem Token.
  app.get("/metriken", async (c) => {
    if (!konfig.metrikenToken) return fehlerAntwort(c, 404, "not_found", "The requested resource does not exist.");
    if (!tokenGleich(c.req.header("Authorization"), konfig.metrikenToken)) return fehlerAntwort(c, 401, "not_authenticated", "Metrics token is missing or incorrect.");
    const betrieb = await leseBetriebszustand(db).catch(() => undefined);
    return c.body(metriken.rendere(pool, betrieb), 200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", "Cache-Control": "no-store" });
  });

  return app.route("/api/v1", v1);
}

/** Vergleicht `Authorization: Bearer <token>` in konstanter Zeit (Vergleich über SHA-256, damit die Länge nichts verrät). */
function tokenGleich(kopf: string | undefined, erwartet: string): boolean {
  const m = /^Bearer (.+)$/i.exec(kopf ?? "");
  const hash = (t: string) => createHash("sha256").update(t).digest();
  return timingSafeEqual(hash(m?.[1] ?? ""), hash(erwartet)) && m !== null;
}

export type AppType = ReturnType<typeof erstelleApp>;
