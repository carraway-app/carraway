/**
 * Gemeinsame Typen der Postfach- und Kalenderanbindung. Die Anbieter (Microsoft Graph, Gmail, IMAP, Demo) liefern nur diese schmalen
 * Formen: Kopfdaten von Nachrichten, Termine, auf Anforderung einen Textauszug. Anhänge, Empfängerlisten in Klartext und vollständige
 * Nachrichten verlassen die Anbieter-Adapter nie; was nicht zu bekannten CRM-Kontakten passt, wird verworfen, bevor es gespeichert wird (mit eingeschalteten
 * Kontakten aus Postfach und Kalender bleiben von echten Gegenübern nur Adresse und Anzeigename als Vorschlag, siehe `kontakte.ts`).
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
  /** Anzeigenamen aus den Adressfeldern (kleingeschriebene Adresse → Name), wenn der Anbieter sie nennt; nur für Kontakte aus Postfach und Kalender. */
  namen?: Record<string, string>;
  /**
   * Die Nachricht stammt aus dem Gesendet-Ordner des Postfachs (Anbieterfakt: Gmail-Label `SENT`, Graph-Ordner `sentitems`, IMAP-Ordner mit Sonderverwendung `\\Sent`),
   * nicht aus der fälschbaren From-Zeile. Nur solche Nachrichten ergeben Kontakte aus Postfach und Kalender.
   */
  gesendet?: boolean;
  /** Listen- oder Massenmail (Kopfzeilen `List-Id`, `List-Unsubscribe`, `Precedence: bulk|list|junk`, `Auto-Submitted`), wenn der Anbieter sie nennt. */
  massenmail?: boolean;
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
  /**
   * Antwort der Person selbst (Anbieterfakt): `organisator` (sie hat den Termin angelegt), `angenommen`, `vorbehalt`, `abgelehnt` oder `offen` (Einladung ohne Antwort).
   * Nur organisierte und angenommene Termine ergeben Kontakte aus Postfach und Kalender: Eine Einladung allein kann jeder Fremde schicken.
   */
  eigeneAntwort?: "organisator" | "angenommen" | "vorbehalt" | "abgelehnt" | "offen";
  /** Anzeigenamen der Teilnehmer (kleingeschriebene Adresse → Name), wenn der Anbieter sie nennt. */
  namen?: Record<string, string>;
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

/** Feld nur setzen, wenn ein Wert da ist (optionale Felder bleiben sonst ganz weg). */
export const optional = <K extends string, V>(schluessel: K, wert: V | undefined): { [P in K]?: V } => (wert === undefined ? {} : ({ [schluessel]: wert } as { [P in K]?: V }));

/** Anzeigenamen je kleingeschriebener Adresse (leere und adressgleiche Namen fallen weg); `undefined`, wenn keiner bleibt. */
export function namenAus(paare: readonly { adresse?: string | null; name?: string | null }[]): Record<string, string> | undefined {
  const aus: Record<string, string> = {};
  for (const p of paare) {
    const a = p.adresse?.trim().toLowerCase();
    const n = p.name?.trim().replace(/^["']|["']$/g, "").trim();
    if (a && a.includes("@") && n && !n.includes("@") && !aus[a]) aus[a] = n.slice(0, 200);
  }
  return Object.keys(aus).length ? aus : undefined;
}

/** Listen- oder Massenmail nach Kopfzeilen: `List-Id`, `List-Unsubscribe`, `Precedence: bulk|list|junk`, `Auto-Submitted` (außer `no`). */
export function istMassenmail(kopf: (name: string) => string | undefined): boolean {
  if (kopf("List-Id") || kopf("List-Unsubscribe")) return true;
  if (/^\s*(bulk|list|junk)\b/i.test(kopf("Precedence") ?? "")) return true;
  const auto = kopf("Auto-Submitted")?.trim().toLowerCase();
  return Boolean(auto && auto !== "no");
}

/** Kopfzeilen, die `istMassenmail` liest. */
export const MASSEN_KOPFZEILEN = ["List-Id", "List-Unsubscribe", "Precedence", "Auto-Submitted"] as const;

/** Tage, die der erste Abgleich zurückschaut. */
export const ERSTER_ABGLEICH_TAGE = 30;
/** Höchstzahl Nachrichten je Abgleich und Verbindung (Schutz vor Lawinen; der Rest folgt im nächsten Lauf). */
export const MAX_MAILS_JE_ABGLEICH = 500;

/**
 * Erweiterungspunkt (Open Core): Neue eingehende Mails bekannter Personen nach dem Speichern. Der Kern ruft ihn nur auf, wenn eine Erweiterung ihn mitbringt, und fängt jeden
 * Fehler ab (der Abgleich läuft weiter). Den Text holt die Erweiterung selbst und nur bei Bedarf (`holeText`); der Kern speichert ihn nicht.
 */
export interface NeueMailBekannterPerson {
  /** Die Person (bei zusammengeführten das Ziel), deren Adresse als Absender steht. Die From-Zeile ist fälschbar: Ergebnisse daraus dürfen nur Vorschläge sein. */
  personId: string;
  absender: string;
  datum: Date;
  /** Klartext der Nachricht, höchstens `max` Zeichen, aus dem Postfach der Person (nicht gespeichert). */
  holeText(max: number): Promise<string>;
}
export interface NachNeuenMails {
  (e: { verbindungId: string; benutzerId: string; anbieter: string; mails: NeueMailBekannterPerson[] }): Promise<void>;
}
