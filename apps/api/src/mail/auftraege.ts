import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { mailAuftrag, type Db } from "@carraway/db";
import { Fachfehler } from "../fehler";
import type { Schluesselring } from "../geheimnis/krypto";
import type { Logger } from "../beobachtung/protokoll";
import { schreibe, type Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { ADRESSE, type MailKonfiguration } from "./konfiguration";
import { MailFehler, type Mailer } from "./mailer";
import { rendereVorlage, type Sprache, type Vorlage, type VorlagenParameter } from "./vorlagen";

/**
 * Ausgangskorb für Mails (Muster wie der Korb der Snapshots): Die Zeile `mail_auftrag` entsteht in der Transaktion der Fachaktion, der Worker
 * (`verarbeiteMailAuftraege`) versendet. Damit geht keine Mail verloren, wenn der Prozess zwischen Aktion und Versand stirbt, und es wird
 * keine Mail für eine zurückgerollte Aktion gesendet. Ein Auftrag wird erst übernommen (kurze Transaktion), dann außerhalb jeder
 * Transaktion gesendet, dann abgeschlossen; so hält kein Sperr- oder Zeitlimit der Datenbank einen SMTP-Aufruf fest.
 */

/** Zusammenfassung der Mail-Einstellungen für Routen, die Aufträge anlegen. */
export interface MailKontext {
  konfig: MailKonfiguration | undefined;
  ring: Schluesselring | undefined;
  /** Basisadresse der Oberfläche (`APP_ORIGIN`, ohne Pfad) für Links in Mails. */
  appBasis: string;
}

declare module "hono" {
  interface ContextVariableMap {
    mail?: MailKontext;
  }
}

export const MAX_VERSUCHE = 5;
/** Wartezeit bis zum nächsten Versuch nach dem n-ten Fehlschlag (Minuten). */
export const WARTEZEIT_MINUTEN = [1, 5, 30, 120];
const SPERRE_MS = 5 * 60_000;
/** Die Datenbank schreibt Zeitpunkte mit Mikrosekunden, JavaScript mit Millisekunden: ohne Spielraum wäre ein eben angelegter Auftrag "noch nicht fällig". */
const TOLERANZ_MS = 1000;

export interface MailEingabe<V extends Vorlage> {
  an: string;
  sprache: Sprache;
  vorlage: V;
  parameter: VorlagenParameter[V];
  bezug?: { art: string; id: string };
}

/** Prüft, dass Versand und Verschlüsselung eingerichtet sind; sonst 409 `mail_not_configured`. */
export function verlangeMail(kontext: MailKontext | undefined): asserts kontext is MailKontext & { konfig: MailKonfiguration; ring: Schluesselring } {
  if (!kontext?.konfig || !kontext.ring) throw new Fachfehler(409, "mail_not_configured", "Mail sending is not configured.");
}

/** Legt einen Auftrag im Ausgangskorb an (in der Transaktion des Aufrufers) und gibt seine ID zurück. */
export async function legeMailAn<V extends Vorlage>(tx: Tx, protokoll: Protokollant, kontext: MailKontext | undefined, e: MailEingabe<V>): Promise<string> {
  verlangeMail(kontext);
  const an = e.an.trim();
  if (!ADRESSE.test(an) || an.length > 254) throw new Fachfehler(400, "mail_address_invalid", "The email address is invalid.");
  const gerendert = rendereVorlage(e.vorlage, e.sprache, e.parameter);
  const id = randomUUID();
  const inhalt = kontext.ring.verschluessele(JSON.stringify({ text: gerendert.text, html: gerendert.html }), `mail_auftrag:${id}`);
  await tx.insert(mailAuftrag).values({
    id,
    empfaenger: an,
    sprache: e.sprache,
    vorlage: e.vorlage,
    betreff: gerendert.betreff,
    bezugArt: e.bezug?.art ?? null,
    bezugId: e.bezug?.id ?? null,
    inhaltVerschluesselt: inhalt,
    erstelltVon: protokoll.akteur,
  });
  await protokoll("anlegen", "mail_auftrag", id, null, { empfaenger: an, vorlage: e.vorlage, bezugArt: e.bezug?.art ?? null, bezugId: e.bezug?.id ?? null });
  return id;
}

export interface VerarbeitungsOptionen {
  mailer: Mailer;
  ring: Schluesselring;
  limitProStunde: number;
  /** Zeitquelle (Tests). */
  jetzt?: () => Date;
  logger?: Logger;
  /** Höchstzahl je Durchlauf (Standard 20). */
  max?: number;
  /** Gesendete und fehlgeschlagene Aufträge werden nach so vielen Tagen gelöscht (Standard 90). */
  aufbewahrungTage?: number;
}

export interface VerarbeitungsErgebnis {
  gesendet: number;
  wiederholt: number;
  fehlgeschlagen: number;
  /** Aufträge, die wegen des Stundenlimits liegen blieben. */
  begrenzt: boolean;
}

type Uebernommen = {
  id: string;
  empfaenger: string;
  vorlage: string;
  bezug_art: string | null;
  bezug_id: string | null;
  betreff: string;
  inhalt_verschluesselt: string | null;
  versuche: number;
};

/** Sendet fällige Aufträge: Stundenlimit je Installation, Wiederholung mit Wartezeit, endgültiges Fehlschlagen nach `MAX_VERSUCHE`. */
export async function verarbeiteMailAuftraege(db: Db, opt: VerarbeitungsOptionen): Promise<VerarbeitungsErgebnis> {
  const jetzt = opt.jetzt ?? (() => new Date());
  const ergebnis: VerarbeitungsErgebnis = { gesendet: 0, wiederholt: 0, fehlgeschlagen: 0, begrenzt: false };
  // Aufbewahrung: abgeschlossene Aufträge (ohne Inhalt) verschwinden nach 90 Tagen; das Änderungsprotokoll bleibt.
  const grenze = new Date(jetzt().getTime() - (opt.aufbewahrungTage ?? 90) * 86_400_000);
  await schreibe(db, "system", (tx) => tx.execute(sql`DELETE FROM mail_auftrag WHERE status <> 'wartend' AND erstellt_am < ${grenze.toISOString()}`));
  const stundeZuvor = new Date(jetzt().getTime() - 3_600_000);
  const frei = await schreibe(db, "system", async (tx) => {
    const { rows } = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM mail_auftrag WHERE gesendet_am > ${stundeZuvor.toISOString()}`);
    return opt.limitProStunde - (rows[0]?.n ?? 0);
  });
  if (frei <= 0) {
    ergebnis.begrenzt = true;
    return ergebnis;
  }
  const menge = Math.min(opt.max ?? 20, frei);
  const start = jetzt();
  const uebernommen = await schreibe(db, "system", async (tx) => {
    const { rows } = await tx.execute<Uebernommen>(sql`
      UPDATE mail_auftrag SET gesperrt_bis = ${new Date(start.getTime() + SPERRE_MS).toISOString()}, versuche = versuche + 1
      WHERE id IN (
        SELECT id FROM mail_auftrag
        WHERE status = 'wartend' AND naechster_versuch_am <= ${new Date(start.getTime() + TOLERANZ_MS).toISOString()} AND (gesperrt_bis IS NULL OR gesperrt_bis < ${start.toISOString()})
        ORDER BY naechster_versuch_am, erstellt_am LIMIT ${menge} FOR UPDATE SKIP LOCKED)
      RETURNING id, empfaenger, vorlage, bezug_art, bezug_id, betreff, inhalt_verschluesselt, versuche`);
    return rows;
  });
  if (uebernommen.length === menge && menge === frei) ergebnis.begrenzt = true;

  for (const a of uebernommen) {
    let fehler: MailFehler | null = null;
    try {
      if (!a.inhalt_verschluesselt) throw new MailFehler("INHALT_FEHLT", true);
      let inhalt: { text: string; html: string };
      try {
        inhalt = JSON.parse(opt.ring.entschluessele(a.inhalt_verschluesselt, `mail_auftrag:${a.id}`)) as { text: string; html: string };
      } catch {
        throw new MailFehler("GEHEIMNIS_FEHLER", true);
      }
      await opt.mailer.senden({ an: a.empfaenger, betreff: a.betreff, text: inhalt.text, html: inhalt.html });
    } catch (e) {
      fehler = e instanceof MailFehler ? e : new MailFehler("SENDEN_FEHLGESCHLAGEN", false);
      // Nur Code und Klasse in den Log: Fehlertexte von SMTP-Servern und Anbietern können Adressen oder Inhalte enthalten.
      opt.logger?.("warn", "Mail nicht gesendet", { auftragId: a.id, code: fehler.code, versuche: a.versuche, ...(e instanceof MailFehler ? {} : { fehlerArt: e instanceof Error ? e.name : typeof e }) });
    }
    const bezug = { bezugArt: a.bezug_art, bezugId: a.bezug_id };
    if (!fehler) {
      await schreibe(db, "system", async (tx, protokoll) => {
        await tx.execute(sql`UPDATE mail_auftrag SET status = 'gesendet', gesendet_am = ${jetzt().toISOString()}, inhalt_verschluesselt = NULL, gesperrt_bis = NULL, letzter_fehler = NULL WHERE id = ${a.id}`);
        await protokoll("gesendet", "mail_auftrag", a.id, null, { empfaenger: a.empfaenger, vorlage: a.vorlage, ...bezug, versuche: a.versuche });
      });
      ergebnis.gesendet++;
    } else if (fehler.dauerhaft || a.versuche >= MAX_VERSUCHE) {
      await schreibe(db, "system", async (tx, protokoll) => {
        await tx.execute(sql`UPDATE mail_auftrag SET status = 'fehlgeschlagen', inhalt_verschluesselt = NULL, gesperrt_bis = NULL, letzter_fehler = ${fehler!.code} WHERE id = ${a.id}`);
        await protokoll("fehlgeschlagen", "mail_auftrag", a.id, null, { empfaenger: a.empfaenger, vorlage: a.vorlage, ...bezug, versuche: a.versuche, fehler: fehler!.code });
      });
      ergebnis.fehlgeschlagen++;
    } else {
      const warte = WARTEZEIT_MINUTEN[Math.min(a.versuche - 1, WARTEZEIT_MINUTEN.length - 1)]!;
      await schreibe(db, "system", async (tx) => {
        await tx.execute(sql`UPDATE mail_auftrag SET gesperrt_bis = NULL, letzter_fehler = ${fehler!.code}, naechster_versuch_am = ${new Date(jetzt().getTime() + warte * 60_000).toISOString()} WHERE id = ${a.id}`);
      });
      ergebnis.wiederholt++;
    }
  }
  return ergebnis;
}
