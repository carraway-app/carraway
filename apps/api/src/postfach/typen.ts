/**
 * Gemeinsame Typen der Postfach- und Kalenderanbindung. Die Anbieter (Microsoft Graph, Gmail, IMAP, Demo) liefern nur diese schmalen
 * Formen: Kopfdaten von Nachrichten, Termine, auf Anforderung einen Textauszug. Anhänge, Empfängerlisten in Klartext und vollständige
 * Nachrichten verlassen die Anbieter-Adapter nie; was nicht zu bekannten CRM-Kontakten passt, wird verworfen, bevor es gespeichert wird.
 */

export type ImapSicherheit = "tls" | "starttls" | "keine";

export type Zugang =
  | { art: "oauth"; accessToken: string; refreshToken: string; /** Ablauf des Zugriffstokens in ms seit 1970. */ ablaufMs: number; adresse: string }
  | { art: "imap"; host: string; port: number; sicherheit: ImapSicherheit; benutzer: string; passwort: string; adresse: string; ordner: string[] }
  | { art: "demo"; adresse: string };

export interface MailKopf {
  /** ID beim Anbieter (zum Nachladen des Textes). */
  id: string;
  /** Message-ID-Header, wenn vorhanden (Grundlage der Dublettenprüfung über Postfächer hinweg). */
  nachrichtenId: string | null;
  datum: Date;
  betreff: string;
  von: string;
  an: string[];
  cc: string[];
}

export interface Termin {
  /** Stabile ID über alle Teilnehmer (iCalUID bzw. Termin-ID). */
  id: string;
  /** Bei Serientermin-Instanzen der ursprüngliche Beginn, sonst `null`. */
  instanz: string | null;
  titel: string;
  beginn: Date;
  ende: Date | null;
  /** Mailadressen der Teilnehmer und des Organisators. */
  teilnehmer: string[];
  /** Adresse des Organisators, wenn der Anbieter sie nennt; Teil des Namensraums für die Dublettenprüfung. */
  organisator?: string | null;
  abgesagt: boolean;
}

export interface MailAbruf {
  koepfe: MailKopf[];
  /** Neuer Stand für den nächsten Abgleich (undurchsichtiger Text je Anbieter). */
  stand: string;
}

/** Anhang einer Nachricht (nur Angaben, nie der Inhalt); wird auf ausdrücklichen Klick angezeigt und übernommen. */
export interface Anhang {
  id: string;
  name: string;
  groesse: number;
  typ: string;
}

export interface PostfachAnbieter {
  /** Kopfdaten seit dem Stand (`null` = erster Abgleich: letzte 30 Tage). */
  holeMailKoepfe(zugang: Zugang, stand: string | null): Promise<MailAbruf>;
  /** Höchstens `max` Zeichen Klartext einer Nachricht (nur für Nachrichten, die zu bekannten Kontakten passen). */
  holeMailText(zugang: Zugang, kopf: MailKopf, max: number): Promise<string>;
  holeTermine(zugang: Zugang, von: Date, bis: Date): Promise<Termin[]>;
  /** Anhänge einer Nachricht (nur für Anbieter, die das können; `kopfId` ist die ID beim Anbieter). */
  listeAnhaenge?(zugang: Zugang, kopfId: string): Promise<Anhang[]>;
  /** Lädt einen Anhang, höchstens `maxBytes`; größere Anhänge werden abgelehnt. */
  holeAnhang?(zugang: Zugang, kopfId: string, anhangId: string, maxBytes: number): Promise<Uint8Array>;
  /** Gibt gehaltene Verbindungen frei (IMAP). */
  schliesse?(): Promise<void>;
}

/** Fehler eines Anbieters: `erneutAnmelden` heißt, der Zugang ist dauerhaft ungültig (Widerruf, abgelaufenes Refresh-Token, falsches Passwort). */
export class PostfachFehler extends Error {
  constructor(
    readonly code: string,
    readonly erneutAnmelden = false,
  ) {
    super(code);
  }
}

/** Tage, die der erste Abgleich zurückschaut. */
export const ERSTER_ABGLEICH_TAGE = 30;
/** Höchstzahl Nachrichten je Abgleich und Verbindung (Schutz vor Lawinen; der Rest folgt im nächsten Lauf). */
export const MAX_MAILS_JE_ABGLEICH = 500;
