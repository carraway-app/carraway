import { bearer, gleicherHost, rufeAuf, rufeBinaerAuf, type Abrufer } from "./http";
import type { OAuthAnbieter } from "./konfiguration";
import { ERSTER_ABGLEICH_TAGE, MAX_MAILS_JE_ABGLEICH, PostfachFehler, type MailAbruf, type MailKopf, type PostfachAnbieter, type Termin, type Zugang } from "./typen";

/**
 * Microsoft Graph (v1.0), nur lesend, ohne SDK. NICHT gegen den echten Dienst geprüft (siehe oauth.ts).
 * Nachrichten: Posteingang (nach `receivedDateTime`) und gesendete Elemente (nach `sentDateTime`), nur Kopfdaten (`$select` ohne Text). Den Text
 * holt `holeMailText` erst für Nachrichten, die zu bekannten Kontakten passen. Termine über `calendarView` (zeitlicher Ausschnitt, Serien
 * aufgelöst).
 */

interface Adresse {
  emailAddress?: { address?: string };
}
interface GraphMail {
  id: string;
  internetMessageId?: string | null;
  subject?: string | null;
  receivedDateTime?: string;
  sentDateTime?: string;
  from?: Adresse;
  toRecipients?: Adresse[];
  ccRecipients?: Adresse[];
}
interface GraphTermin {
  id: string;
  iCalUId?: string;
  subject?: string | null;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  organizer?: Adresse;
  attendees?: Adresse[];
  isCancelled?: boolean;
  type?: string;
  originalStart?: string | null;
}
interface Seite<T> {
  value?: T[];
  "@odata.nextLink"?: string;
}

const adressen = (l: Adresse[] | undefined) => (l ?? []).map((a) => a.emailAddress?.address?.trim().toLowerCase() ?? "").filter((a) => a.includes("@"));
/** Graph liefert mit `Prefer: outlook.timezone="UTC"` Zeiten ohne Versatz, die UTC sind. */
const alsUtc = (s: string | undefined) => (s ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`) : null);

export function erstelleMicrosoft(k: OAuthAnbieter, abrufer: Abrufer): PostfachAnbieter {
  const token = (z: Zugang) => {
    if (z.art !== "oauth") throw new PostfachFehler("ZUGANG_FALSCH");
    return z.accessToken;
  };

  async function alleSeiten<T>(startUrl: string, z: Zugang, zusatz: Record<string, string> = {}, max = 2000): Promise<T[]> {
    const treffer: T[] = [];
    let url: string | undefined = startUrl;
    while (url && treffer.length < max) {
      if (!gleicherHost(k.apiBasis, url)) throw new PostfachFehler("ANBIETER_ANTWORT_UNGUELTIG");
      const s = (await rufeAuf(abrufer, url, bearer(token(z), zusatz))) as Seite<T>;
      treffer.push(...(s.value ?? []));
      url = s["@odata.nextLink"];
    }
    return treffer;
  }

  return {
    async holeMailKoepfe(z, stand): Promise<MailAbruf> {
      const seit = stand ? new Date(Date.parse(stand) - 3_600_000) : new Date(Date.now() - ERSTER_ABGLEICH_TAGE * 86_400_000);
      const felder = "id,internetMessageId,subject,receivedDateTime,sentDateTime,from,toRecipients,ccRecipients";
      const holen = async (ordner: "inbox" | "sentitems", feld: "receivedDateTime" | "sentDateTime") => {
        const u = new URL(`${k.apiBasis}/me/mailFolders/${ordner}/messages`);
        u.searchParams.set("$select", felder);
        u.searchParams.set("$filter", `${feld} ge ${seit.toISOString()}`);
        u.searchParams.set("$orderby", `${feld} asc`);
        u.searchParams.set("$top", "100");
        return alleSeiten<GraphMail>(u.toString(), z, {}, MAX_MAILS_JE_ABGLEICH);
      };
      const [eingang, gesendet] = [await holen("inbox", "receivedDateTime"), await holen("sentitems", "sentDateTime")];
      const koepfe: MailKopf[] = [];
      const letzte = (liste: GraphMail[]): Date | null => {
        let spaet: Date | null = null;
        for (const m of liste) {
          const d = new Date(m.receivedDateTime ?? m.sentDateTime ?? "");
          if (!Number.isNaN(d.getTime()) && (!spaet || d > spaet)) spaet = d;
        }
        return spaet;
      };
      for (const m of [...eingang, ...gesendet]) {
        const datum = new Date(m.receivedDateTime ?? m.sentDateTime ?? "");
        if (Number.isNaN(datum.getTime())) continue;
        koepfe.push({
          id: m.id,
          nachrichtenId: m.internetMessageId?.trim() || null,
          datum,
          betreff: (m.subject ?? "").trim(),
          von: adressen(m.from ? [m.from] : undefined)[0] ?? "",
          an: adressen(m.toRecipients),
          cc: adressen(m.ccRecipients),
        });
      }
      koepfe.sort((a, b) => a.datum.getTime() - b.datum.getTime());
      // Beide Ordner kommen aufsteigend und gekappt. Hat ein Ordner die Obergrenze erreicht, fehlt ihm alles nach seiner letzten Nachricht: Der Stand darf nicht
      // über diesen Zeitpunkt hinausrücken, auch wenn der andere Ordner neuere Nachrichten lieferte (sonst gingen die Nachrichten dazwischen verloren).
      const gekappt = [eingang, gesendet].filter((l) => l.length >= MAX_MAILS_JE_ABGLEICH).map(letzte).filter((d): d is Date => d !== null);
      const stand2 = gekappt.length ? new Date(Math.min(...gekappt.map((d) => d.getTime()))) : (koepfe.at(-1)?.datum ?? seit);
      return { koepfe, stand: stand2.toISOString() };
    },

    async holeMailText(z, kopf, max) {
      const u = new URL(`${k.apiBasis}/me/messages/${encodeURIComponent(kopf.id)}`);
      u.searchParams.set("$select", "body");
      const m = (await rufeAuf(abrufer, u.toString(), bearer(token(z), { Prefer: 'outlook.body-content-type="text"' }))) as { body?: { content?: string } };
      return (m.body?.content ?? "").slice(0, max);
    },

    async listeAnhaenge(z, kopfId) {
      const u = new URL(`${k.apiBasis}/me/messages/${encodeURIComponent(kopfId)}/attachments`);
      u.searchParams.set("$select", "id,name,size,contentType,isInline");
      const l = (await rufeAuf(abrufer, u.toString(), bearer(token(z)))) as { value?: { id: string; name?: string; size?: number; contentType?: string; isInline?: boolean; "@odata.type"?: string }[] };
      // Nur echte Dateianhänge: keine Bilder im Text, keine eingebetteten Nachrichten oder Verweise.
      return (l.value ?? [])
        .filter((a) => !a.isInline && (a["@odata.type"] === undefined || a["@odata.type"] === "#microsoft.graph.fileAttachment"))
        .map((a) => ({ id: a.id, name: a.name ?? "Anhang", groesse: a.size ?? 0, typ: a.contentType ?? "application/octet-stream" }));
    },

    async holeAnhang(z, kopfId, anhangId, maxBytes) {
      const url = `${k.apiBasis}/me/messages/${encodeURIComponent(kopfId)}/attachments/${encodeURIComponent(anhangId)}/$value`;
      return rufeBinaerAuf(abrufer, url, bearer(token(z)), maxBytes);
    },

    async holeTermine(z, von, bis): Promise<Termin[]> {
      const u = new URL(`${k.apiBasis}/me/calendarView`);
      u.searchParams.set("startDateTime", von.toISOString());
      u.searchParams.set("endDateTime", bis.toISOString());
      u.searchParams.set("$select", "id,iCalUId,subject,start,end,organizer,attendees,isCancelled,type,originalStart");
      u.searchParams.set("$top", "100");
      const liste = await alleSeiten<GraphTermin>(u.toString(), z, { Prefer: 'outlook.timezone="UTC"' }, 1000);
      const termine: Termin[] = [];
      for (const t of liste) {
        const beginn = alsUtc(t.start?.dateTime);
        if (!beginn) continue;
        termine.push({
          id: t.iCalUId || t.id,
          instanz: t.type === "occurrence" || t.type === "exception" ? (alsUtc(t.originalStart ?? undefined)?.toISOString() ?? beginn.toISOString()) : null,
          titel: (t.subject ?? "").trim(),
          beginn,
          ende: alsUtc(t.end?.dateTime),
          teilnehmer: [...adressen(t.organizer ? [t.organizer] : undefined), ...adressen(t.attendees)],
          organisator: adressen(t.organizer ? [t.organizer] : undefined)[0] ?? null,
          abgesagt: t.isCancelled === true,
        });
      }
      return termine;
    },
  };
}
