import { ImapFlow } from "imapflow";
import { textauszug } from "./mime";
import { pruefeImapZiel, type Aufloeser } from "./ziel";
import { ERSTER_ABGLEICH_TAGE, MAX_MAILS_JE_ABGLEICH, PostfachFehler, type MailAbruf, type MailKopf, type PostfachAnbieter, type Termin, type Zugang } from "./typen";

/**
 * Allgemeiner IMAP-Adapter (nur lesend) für Selbsthoster, ohne OAuth. Nutzt imapflow; die Verbindung kommt über eine austauschbare Fabrik
 * (`ImapFabrik`), damit Tests ohne Netzwerk laufen. Es werden nur Hüllendaten (Envelope) gelesen und der Text erst für passende Nachrichten
 * (die ersten 64 KB der Nachricht, ohne Anhänge). Kalender gibt es über IMAP nicht. NICHT gegen echte Server geprüft.
 *
 * Stand je Ordner: `<UIDVALIDITY>:<letzte UID>`; ändert sich UIDVALIDITY, beginnt der Ordner neu (letzte 30 Tage, Dubletten fängt die Prüfung ab).
 */

export interface ImapKopf {
  uid: number;
  nachrichtenId: string | null;
  datum: Date;
  betreff: string;
  von: string;
  an: string[];
  cc: string[];
}

export interface ImapVerbindung {
  /** Öffnet den Ordner schreibgeschützt. */
  oeffne(ordner: string): Promise<{ uidValidity: string }>;
  /** UIDs größer als `abUid` (0 = alle), neueste zuletzt. */
  uidsNach(abUid: number): Promise<number[]>;
  uidsSeit(datum: Date): Promise<number[]>;
  koepfe(uids: number[]): Promise<ImapKopf[]>;
  rohtext(uid: number, maxBytes: number): Promise<string>;
  schliesse(): Promise<void>;
}

/** `servername` ist der Name für die TLS-Prüfung, wenn `host` die geprüfte IP-Adresse ist (DNS-Rebinding-Schutz, siehe `ziel.ts`). */
export type ImapZugang = Extract<Zugang, { art: "imap" }> & { servername?: string };
export type ImapFabrik = (zugang: ImapZugang) => Promise<ImapVerbindung>;

const adressen = (l: { address?: string }[] | undefined) => (l ?? []).map((a) => a.address?.trim().toLowerCase() ?? "").filter((a) => a.includes("@"));

/** Echte Verbindung über imapflow (Zertifikate werden geprüft, nur lesend). */
export const erstelleEchteImapVerbindung: ImapFabrik = async (z) => {
  const client = new ImapFlow({
    host: z.host,
    port: z.port,
    secure: z.sicherheit === "tls",
    doSTARTTLS: z.sicherheit === "starttls" ? true : z.sicherheit === "keine" ? false : undefined,
    auth: { user: z.benutzer, pass: z.passwort },
    logger: false,
    tls: { rejectUnauthorized: true, servername: z.servername ?? z.host },
    servername: z.servername ?? z.host,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
  client.on("error", () => undefined);
  try {
    await client.connect();
  } catch (fehler) {
    const authentifizierung = (fehler as { authenticationFailed?: boolean }).authenticationFailed === true;
    throw new PostfachFehler(authentifizierung ? "ZUGANG_UNGUELTIG" : "ANBIETER_NICHT_ERREICHBAR", authentifizierung);
  }
  let sperre: { release(): void } | null = null;
  return {
    async oeffne(ordner) {
      sperre?.release();
      sperre = await client.getMailboxLock(ordner, { readOnly: true });
      const box = client.mailbox;
      return { uidValidity: box ? String(box.uidValidity) : "0" };
    },
    async uidsNach(abUid) {
      const r = await client.search({ uid: `${abUid + 1}:*` }, { uid: true });
      return (r || []).filter((u) => u > abUid).sort((a, b) => a - b);
    },
    async uidsSeit(datum) {
      const r = await client.search({ since: datum }, { uid: true });
      return (r || []).sort((a, b) => a - b);
    },
    async koepfe(uids) {
      const ergebnis: ImapKopf[] = [];
      if (uids.length === 0) return ergebnis;
      for await (const m of client.fetch(uids.join(","), { uid: true, envelope: true, internalDate: true }, { uid: true })) {
        const e = m.envelope;
        const roh = e?.date ?? m.internalDate;
        const datum = roh ? new Date(roh) : null;
        if (!datum || Number.isNaN(datum.getTime())) continue;
        ergebnis.push({
          uid: m.uid,
          nachrichtenId: e?.messageId?.trim() || null,
          datum,
          betreff: (e?.subject ?? "").trim(),
          von: adressen(e?.from)[0] ?? "",
          an: adressen(e?.to),
          cc: adressen(e?.cc),
        });
      }
      return ergebnis;
    },
    async rohtext(uid, maxBytes) {
      const m = await client.fetchOne(String(uid), { source: { maxLength: maxBytes } }, { uid: true });
      return m && m.source ? m.source.toString("latin1") : "";
    },
    async schliesse() {
      sperre?.release();
      sperre = null;
      await client.logout().catch(() => undefined);
    },
  };
};

export function erstelleImap(opt: { fabrik: ImapFabrik; privateZiele: boolean; aufloeser?: Aufloeser }): PostfachAnbieter {
  let verbindung: ImapVerbindung | null = null;
  const verbinde = async (z: Zugang) => {
    if (z.art !== "imap") throw new PostfachFehler("ZUGANG_FALSCH");
    if (verbindung) return { v: verbindung, z };
    // Einmal auflösen, prüfen und mit genau dieser Adresse verbinden (der Name bleibt der Servername der TLS-Prüfung).
    const ip = await pruefeImapZiel(z.host, z.port, opt.privateZiele, opt.aufloeser);
    verbindung = await opt.fabrik(ip === z.host ? z : { ...z, host: ip, servername: z.host });
    return { v: verbindung, z };
  };
  /** Kopf-ID: `<Ordner-Nummer>:<UID>`; so findet `holeMailText` den Ordner wieder. */
  const kopfId = (ordnerNr: number, uid: number) => `${ordnerNr}:${uid}`;

  return {
    async holeMailKoepfe(zugang, stand): Promise<MailAbruf> {
      const { v, z } = await verbinde(zugang);
      const standJe: Record<string, string> = stand ? (JSON.parse(stand) as Record<string, string>) : {};
      const neu: Record<string, string> = {};
      const koepfe: MailKopf[] = [];
      for (const [nr, ordner] of z.ordner.entries()) {
        const { uidValidity } = await v.oeffne(ordner);
        const [altValidity, altUid] = (standJe[ordner] ?? "").split(":");
        const weiter = altValidity === uidValidity && altUid !== undefined;
        const seit = new Date(Date.now() - ERSTER_ABGLEICH_TAGE * 86_400_000);
        let uids = weiter ? await v.uidsNach(Number(altUid)) : await v.uidsSeit(seit);
        // Bei einer Lawine zuerst die ältesten: Der Stand rückt nur so weit vor, wie verarbeitet wurde.
        uids = uids.slice(0, MAX_MAILS_JE_ABGLEICH);
        const liste = await v.koepfe(uids);
        for (const k of liste) koepfe.push({ id: kopfId(nr, k.uid), nachrichtenId: k.nachrichtenId, datum: k.datum, betreff: k.betreff, von: k.von, an: k.an, cc: k.cc });
        const hoechste = uids.length ? Math.max(...uids) : weiter ? Number(altUid) : 0;
        neu[ordner] = `${uidValidity}:${hoechste}`;
      }
      return { koepfe, stand: JSON.stringify(neu) };
    },

    async holeMailText(zugang, kopf, max) {
      const { v, z } = await verbinde(zugang);
      const [nr, uid] = kopf.id.split(":").map(Number) as [number, number];
      const ordner = z.ordner[nr];
      if (ordner === undefined || !Number.isInteger(uid)) return "";
      await v.oeffne(ordner);
      return textauszug(await v.rohtext(uid, 65_536), max);
    },

    async holeTermine(): Promise<Termin[]> {
      return [];
    },

    async schliesse() {
      const v = verbindung;
      verbindung = null;
      await v?.schliesse();
    },
  };
}
