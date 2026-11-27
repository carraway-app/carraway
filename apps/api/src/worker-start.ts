import { northData } from "./data-providers/north-data";
import { companiesHouse } from "./data-providers/companies-house";
import { refreshLinked } from "./data-providers/monitor";
import { loescheAbgelaufeneSchluessel } from "./idempotenz";
import { processPage } from "./integrationen/runs";
import { writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { erstelleDb } from "@carraway/db";
import { richteHerzschlagEin, schreibeHerzschlag } from "./beobachtung/betrieb";
import { fehlerFelder, loggerAusUmgebung } from "./beobachtung/protokoll";
import { NEUBERECHNUNG, starteJobs, verarbeiteNeuberechnung, verteileAuftraege, type NeuberechnungsJob } from "./jobs";
import { datenbankUrl } from "./konfiguration";
import { verlangeMigrationsstandBeimStart } from "./migrationsstand";
import { erstelleRegisterAnbieter } from "./register/anbieter";
import { pruefeBeobachtung, REGISTER_PRUEFUNG } from "./register/beobachtung";
import { ladeSchluesselring } from "./geheimnis/krypto";
import { ladeMailKonfiguration } from "./mail/konfiguration";
import { SmtpMailer } from "./mail/mailer";
import { verarbeiteMailAuftraege } from "./mail/auftraege";
import { ladePostfachKonfiguration } from "./postfach/konfiguration";
import { erstelleAnbieterFabrik } from "./postfach/anbieter";
import { erstelleEchteImapVerbindung } from "./postfach/imap";
import { gleicheAb } from "./postfach/sync";
import type { NachNeuenMails } from "./postfach/typen";
import { ladeDemoKontakte } from "./demo/postfach";
import { erstelleStandardSpeicher } from "./berichte/speicher";
import { loescheAbgelaufeneDokumente } from "./dokumente/aufbewahrung";
import { ladeAufbewahrungTage } from "./konfiguration";
import { verarbeiteOfficeTexte, verarbeiteTexterkennung } from "./dokumente/nachverarbeitung";
import { IsolierterErkenner } from "./dokumente/isoliert";
import { ladeOcrKonfiguration } from "./dokumente/ocr";
import { meldeBerichtsartenAn, type ApiErweiterung, type WorkerKontext } from "./erweiterung";
import type { JobWithMetadata } from "pg-boss";
import { raeumeZustellungenAuf, stelleZu, verteileWebhooks, WEBHOOK_ZUSTELLUNG, type ZustellJob } from "./webhooks/zustellung";
import { privateZieleErlaubt } from "./webhooks/ziel";

/**
 * Worker für die Kennzahlen-Snapshots: reiht Aufträge aus dem Ausgangskorb in pg-boss ein und rechnet die Jobs ab.
 * Start: `pnpm --filter @carraway/api worker` (Entwicklung) oder `node dist/worker.js` nach dem Bauen (Einstieg „Kern“ in `worker.ts`,
 * „Voll“ in `ee/api/src/worker.ts`). Erweiterungen bringen eigene Warteschlangen, Arbeiter und Verteilschritte mit (`ApiErweiterung`).
 *
 * Mail und Kalender (Etappe 17): versendet den Ausgangskorb `mail_auftrag` über SMTP (Wiederholung mit Wartezeit, Stundenlimit) und gleicht
 * die Postfächer und Kalender der Personen ab, die sie angebunden haben. Beides braucht `GEHEIMNIS_SCHLUESSEL`; ohne SMTP-Einrichtung bleibt der Versand aus.
 *
 * Herzschlag: alle `WORKER_HERZSCHLAG_MS` (Vorgabe 5000) eine Zeile in `pgboss.carraway_herzschlag` für `/api/v1/health`
 * und `/metriken`, dazu eine Datei (`WORKER_HERZSCHLAG_DATEI`) für den Health-Check des Containers.
 */
export async function starteWorker(erweiterungen: readonly ApiErweiterung[] = []): Promise<void> {
  const url = datenbankUrl();
  const logger = loggerAusUmgebung("worker");
  const intervallMs = Number(process.env.WORKER_INTERVALL_MS ?? 2000);
  const herzschlagMs = Number(process.env.WORKER_HERZSCHLAG_MS ?? 5000);
  const herzschlagDatei = process.env.WORKER_HERZSCHLAG_DATEI ?? "/tmp/carraway-worker-herzschlag";
  const name = `worker@${hostname()}`;

  const { db, pool } = erstelleDb(url);
  await verlangeMigrationsstandBeimStart(db, "worker", logger);
  const boss = await starteJobs(url, logger, erweiterungen);
  await richteHerzschlagEin(db);

  meldeBerichtsartenAn(erweiterungen);
  const kontext: WorkerKontext = { db, boss, logger };
  for (const e of erweiterungen) await e.worker?.(kontext);
  let verarbeitet = 0;
  // Mailkonfiguration für die Registerhinweise und den Mail-Ausgang weiter unten.
  const umgebung = process.env.CARRAWAY_UMGEBUNG ?? "demo";
  const mailKonfig = ladeMailKonfiguration(process.env, umgebung);
  const ring = ladeSchluesselring(process.env, umgebung);
  // Registerbeobachtung: aus, solange kein Plan (`REGISTER_PRUEFUNG_CRON`, z. B. `0 5 * * *`) und kein Anbieter eingerichtet sind.
  const adapter = [northData, companiesHouse].find(p => p.id === process.env.REGISTER_ANBIETER);
  const registerAnbieter = adapter ? { name: adapter.id, refresh: (id: string) => refreshLinked(db, ring, adapter, id) } : erstelleRegisterAnbieter();
  const registerPlan = process.env.REGISTER_PRUEFUNG_CRON?.trim();
  if (registerAnbieter && registerPlan) {
    await boss.schedule(REGISTER_PRUEFUNG, registerPlan, {});
    await boss.work(REGISTER_PRUEFUNG, { pollingIntervalSeconds: 30, localConcurrency: 1 }, async () => {
      const ergebnis = await pruefeBeobachtung(db, registerAnbieter, { max: Number(process.env.REGISTER_ABRUFE_PRO_LAUF ?? 20), pauseMs: Number(process.env.REGISTER_PAUSE_MS ?? 3000), mail: { konfig: mailKonfig, ring, appBasis: (process.env.APP_ORIGIN ?? "http://localhost:5173").split(",")[0]!.trim() } });
      logger("info", "Registerbeobachtung gelaufen", { ...ergebnis });
    });
  }
  await boss.work<NeuberechnungsJob>(NEUBERECHNUNG, { pollingIntervalSeconds: 1, localConcurrency: 2 }, async (jobs) => {
    for (const job of jobs) {
      const start = performance.now();
      const stichtage = await verarbeiteNeuberechnung(db, job.data);
      verarbeitet++;
      logger("info", "Snapshot neu berechnet", { fondsId: job.data.fondsId, stichtage: stichtage.length, dauerMs: Math.round(performance.now() - start) });
    }
  });

  // Webhooks (#154): je Job ein Versuch; `retry` wirft, damit pg-boss mit Wartezeit wiederholt. Rechte und Ziel prüft `stelleZu` bei jedem Versuch.
  const webhookPrivat = privateZieleErlaubt(process.env);
  await boss.work(WEBHOOK_ZUSTELLUNG, { pollingIntervalSeconds: 2, localConcurrency: 4, includeMetadata: true }, async (jobs: JobWithMetadata<ZustellJob>[]) => {
    for (const job of jobs) {
      const ergebnis = await stelleZu(db, job.data.zustellungId, { ring, privateErlaubt: webhookPrivat, letzterVersuch: job.retryCount >= job.retryLimit });
      if (ergebnis === "retry") throw new Error("Webhook-Zustellung gescheitert, wird wiederholt");
      if (ergebnis === "failed") logger("warn", "Webhook-Zustellung endgültig gescheitert", { zustellungId: job.data.zustellungId });
    }
  });
  const bereinigeIdempotenz = () => loescheAbgelaufeneSchluessel(db).catch((fehler) => logger("error", "Idempotenzspeicher nicht aufgeräumt", fehlerFelder(fehler)));
  await bereinigeIdempotenz();
  const webhookAufraeumen = setInterval(() => {
    void bereinigeIdempotenz();
    raeumeZustellungenAuf(db).catch((fehler) => logger("error", "Zustellprotokoll nicht aufgeräumt", fehlerFelder(fehler)));
  }, 6 * 60 * 60_000);

  let laeuft = false;
  const takt = setInterval(() => {
    if (laeuft) return;
    laeuft = true;
    Promise.all([processPage(db, ring), verteileAuftraege(db, boss), verteileWebhooks(db, (job) => boss.send(WEBHOOK_ZUSTELLUNG, job)), ...erweiterungen.map((e) => e.verteilen?.(kontext))])
      .catch((fehler) => logger("error", "Verteilen fehlgeschlagen", fehlerFelder(fehler)))
      .finally(() => {
        laeuft = false;
      });
  }, intervallMs);

  // Mail-Ausgang und Postfach-Abgleich laufen in eigenen Takten, damit ein langsamer SMTP-Server oder Anbieter die Snapshots nicht aufhält.
  const postfachKonfig = ladePostfachKonfiguration(process.env);
  const mailer = mailKonfig ? new SmtpMailer(mailKonfig) : null;
  const anbieterFabrik = erstelleAnbieterFabrik({
    konfig: postfachKonfig,
    abrufer: fetch,
    imapFabrik: erstelleEchteImapVerbindung,
    umgebung,
    demoKontakte: () => ladeDemoKontakte(db),
  });
  let mailLaeuft = false;
  const mailTakt = setInterval(() => {
    if (mailLaeuft || !mailer || !mailKonfig || !ring) return;
    mailLaeuft = true;
    verarbeiteMailAuftraege(db, { mailer, ring, limitProStunde: mailKonfig.limitProStunde, logger })
      .then((e) => {
        if (e.gesendet + e.wiederholt + e.fehlgeschlagen > 0) logger("info", "Mails verarbeitet", { gesendet: e.gesendet, wiederholt: e.wiederholt, fehlgeschlagen: e.fehlgeschlagen, begrenzt: e.begrenzt });
      })
      .catch((fehler) => logger("error", "Mailversand fehlgeschlagen", fehlerFelder(fehler)))
      .finally(() => {
        mailLaeuft = false;
      });
  }, intervallMs);
  // Aufbewahrung gelöschter Dokumente: entfernt Dateien, deren Frist (`DOKUMENT_AUFBEWAHRUNG_TAGE`, Vorgabe 30) abgelaufen ist und die nichts mehr braucht.
  const aufbewahrungTage = ladeAufbewahrungTage(process.env);
  const dateiSpeicher = erstelleStandardSpeicher();
  const aufbewahrungMs = Number(process.env.DOKUMENT_AUFBEWAHRUNG_INTERVALL_MS ?? 60 * 60_000);
  let aufbewahrungLaeuft = false;
  const aufbewahrungLauf = () => {
    if (aufbewahrungLaeuft) return;
    aufbewahrungLaeuft = true;
    loescheAbgelaufeneDokumente(db, dateiSpeicher, { tage: aufbewahrungTage, logger })
      .then((e) => {
        if (e.geloescht + e.gehalten > 0) logger("info", "Aufbewahrung gelöschter Dokumente", { dateienEntfernt: e.geloescht, dokumente: e.dokumente, gehalten: e.gehalten });
      })
      .catch((fehler) => logger("error", "Aufbewahrungslauf fehlgeschlagen", fehlerFelder(fehler)))
      .finally(() => {
        aufbewahrungLaeuft = false;
      });
  };
  const aufbewahrungTakt = setInterval(aufbewahrungLauf, aufbewahrungMs);
  // Textauszug aus Office-Dokumenten (DOCX, XLSX): nur im Worker, mit Zeitlimit je Dokument.
  let officeLaeuft = false;
  const officeTakt = setInterval(() => {
    if (officeLaeuft) return;
    officeLaeuft = true;
    verarbeiteOfficeTexte(db, dateiSpeicher, { logger })
      .then((e) => {
        if (e.verarbeitet + e.fehler > 0) logger("info", "Office-Texte ausgezogen", { ...e });
      })
      .catch((fehler) => logger("error", "Textauszug aus Office-Dateien fehlgeschlagen", fehlerFelder(fehler)))
      .finally(() => {
        officeLaeuft = false;
      });
  }, intervallMs);
  setTimeout(aufbewahrungLauf, 30_000).unref();
  // Lokale Texterkennung für Scans und Bilder: nur mit `OCR=lokal`, ein Dokument je Durchgang, jeweils in einem Thread mit hartem Zeitlimit.
  const ocrKonfig = ladeOcrKonfiguration();
  const ocrErkenner = new IsolierterErkenner();
  let ocrLaeuft = false;
  const ocrTakt = setInterval(() => {
    if (ocrKonfig.modus !== "lokal" || ocrLaeuft) return;
    ocrLaeuft = true;
    verarbeiteTexterkennung(db, dateiSpeicher, ocrErkenner, ocrKonfig, { logger })
      .then((e) => {
        if (e.verarbeitet + e.kein_text + e.fehler > 0) logger("info", "Texterkennung gelaufen", { ...e });
      })
      .catch((fehler) => logger("error", "Texterkennung fehlgeschlagen", fehlerFelder(fehler)))
      .finally(() => {
        ocrLaeuft = false;
      });
  }, intervallMs);
  const nachMailHaken = erweiterungen.flatMap((e) => e.postfachMails?.(kontext) ?? []);
  const nachNeuenMails = nachMailHaken.length === 0 ? undefined : async (e: Parameters<NachNeuenMails>[0]) => void (await Promise.all(nachMailHaken.map((h) => h(e))));
  let abgleichLaeuft = false;
  const abgleichTakt = setInterval(() => {
    if (abgleichLaeuft || !ring) return;
    abgleichLaeuft = true;
    gleicheAb(db, { ring, konfig: postfachKonfig, abrufer: fetch, anbieter: anbieterFabrik, logger, nachNeuenMails })
      .then((e) => {
        if (e.verbindungen > 0) logger("info", "Postfächer abgeglichen", { verbindungen: e.verbindungen, mails: e.mails, termine: e.termine, fehler: e.fehler });
      })
      .catch((fehler) => logger("error", "Postfach-Abgleich fehlgeschlagen", fehlerFelder(fehler)))
      .finally(() => {
        abgleichLaeuft = false;
      });
  }, Math.max(intervallMs, 15_000));

  const schlag = async () => {
    try {
      await schreibeHerzschlag(db, name, verarbeitet);
      await writeFile(herzschlagDatei, String(Date.now()));
    } catch (fehler) {
      logger("warn", "Herzschlag nicht geschrieben", fehlerFelder(fehler));
    }
  };
  await schlag();
  const herzschlag = setInterval(() => void schlag(), herzschlagMs);

  logger("info", "Worker gestartet", { name });

  const beenden = async () => {
    logger("info", "Worker beendet sich");
    clearInterval(takt);
    clearInterval(webhookAufraeumen);
    clearInterval(mailTakt);
    clearInterval(abgleichTakt);
    clearInterval(aufbewahrungTakt);
    clearInterval(officeTakt);
    clearInterval(ocrTakt);
    clearInterval(herzschlag);
    await boss.stop({ graceful: true, timeout: 10_000 });
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void beenden());
  process.on("SIGTERM", () => void beenden());
}
