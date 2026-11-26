import { bearer, gleicherHost, rufeAuf, type Abrufer } from "./http";
import type { OAuthAnbieter } from "./konfiguration";
import { ERSTER_ABGLEICH_TAGE, istMassenmail, MASSEN_KOPFZEILEN, namenAus, optional, MAX_MAILS_JE_ABGLEICH, PostfachFehler, type MailAbruf, type MailKopf, type PostfachAnbieter, type Termin, type Zugang } from "./typen";

/**
 * Gmail API und Google Kalender API, nur lesend, ohne SDK. NICHT gegen die echten Dienste geprüft (siehe oauth.ts).
 * Nachrichten: erst die Liste der IDs seit dem Stand, dann je Nachricht nur die Kopfzeilen (`format=metadata` mit Whitelist der Kopfzeilen).
 * Den Text holt `holeMailText` erst für Nachrichten, die zu bekannten Kontakten passen.
 */

interface GmailListe {
  messages?: { id: string }[];
  nextPageToken?: string;
}
interface GmailNachricht {
  id: string;
  labelIds?: string[];
  internalDate?: string;
  snippet?: string;
  payload?: { headers?: { name: string; value: string }[]; mimeType?: string; body?: { data?: string }; parts?: GmailTeil[] };
}
interface GmailTeil {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailTeil[];
}
interface GoogleTermin {
  id: string;
  iCalUID?: string;
  summary?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: { email?: string; displayName?: string; self?: boolean; responseStatus?: string }[];
  recurringEventId?: string;
  originalStartTime?: { dateTime?: string; date?: string };
}

/**
 * Zerlegt eine Adressliste nach RFC 5322 in Einträge: Kommas in Anführungszeichen, Kommentaren und spitzen Klammern trennen nicht. Je Eintrag gilt die Adresse in spitzen
 * Klammern (`angle-addr`), sonst der Eintrag selbst ohne Kommentare; der Anzeigename zählt nie als Adresse (`"chef@firma.example" <x@y.example>` ergibt `x@y.example`).
 */
export function zerlegeAdressliste(wert: string | undefined): { adresse: string; name: string }[] {
  if (!wert) return [];
  const teile: string[] = [];
  let aktuell = "";
  let inZitat = false;
  let klammer = 0;
  let kommentar = 0;
  for (let i = 0; i < wert.length; i++) {
    const z = wert[i]!;
    if (inZitat) {
      if (z === "\\") {
        aktuell += z + (wert[i + 1] ?? "");
        i++;
        continue;
      }
      if (z === '"') inZitat = false;
    } else if (kommentar > 0) {
      if (z === "(") kommentar++;
      else if (z === ")") kommentar--;
    } else if (z === '"') inZitat = true;
    else if (z === "(") kommentar++;
    else if (z === "<") klammer++;
    else if (z === ">") klammer = Math.max(0, klammer - 1);
    else if (z === "," && klammer === 0) {
      teile.push(aktuell);
      aktuell = "";
      continue;
    }
    aktuell += z;
  }
  teile.push(aktuell);
  const ADRESSE = /^[^\s@<>()",;:]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
  const aus: { adresse: string; name: string }[] = [];
  for (const roh of teile) {
    // Spitze Klammer außerhalb von Anführungszeichen suchen (die letzte gilt).
    let start = -1;
    let ende = -1;
    let zitat = false;
    for (let i = 0; i < roh.length; i++) {
      const z = roh[i]!;
      if (z === "\\" && zitat) {
        i++;
        continue;
      }
      if (z === '"') zitat = !zitat;
      else if (!zitat && z === "<") start = i;
      else if (!zitat && z === ">" && start >= 0) ende = i;
    }
    const ohneKommentar = (t: string) => t.replace(/\([^()]*\)/g, "").trim();
    const adresse = (start >= 0 && ende > start ? roh.slice(start + 1, ende) : ohneKommentar(roh).replace(/^[^:<"@]*:/, "").replace(/;+$/, "")).trim().toLowerCase();
    if (!ADRESSE.test(adresse)) continue;
    const name = start >= 0 ? ohneKommentar(roh.slice(0, start)).replace(/^"|"$/g, "").replace(/\\(.)/g, "$1").trim() : "";
    aus.push({ adresse, name });
  }
  return aus;
}

/** Adressen aus einer Kopfzeile wie `Name <a@b.example>, c@d.example` (RFC 5322, siehe `zerlegeAdressliste`). */
export function adressenAusKopf(wert: string | undefined): string[] {
  return zerlegeAdressliste(wert).map((e) => e.adresse);
}

/** Anzeigenamen aus einer Kopfzeile wie `"Nachname, Vorname" <a@b.example>, Name <c@d.example>`. */
export const namenAusKopf = (wert: string | undefined) => zerlegeAdressliste(wert).filter((e) => e.name);

/** Antwort der Person selbst auf einen Termin (`organizer.self`, sonst `responseStatus` des Teilnehmers mit `self`). */
export function eigeneAntwortGoogle(t: { organizer?: { self?: boolean }; attendees?: { self?: boolean; responseStatus?: string }[] }): NonNullable<Termin["eigeneAntwort"]> {
  if (t.organizer?.self === true) return "organisator";
  const r = t.attendees?.find((a) => a.self === true)?.responseStatus;
  return r === "accepted" ? "angenommen" : r === "tentative" ? "vorbehalt" : r === "declined" ? "abgelehnt" : "offen";
}

function textAusTeil(t: GmailTeil | GmailNachricht["payload"]): string | null {
  if (!t) return null;
  if (t.mimeType === "text/plain" && t.body?.data) return Buffer.from(t.body.data, "base64url").toString("utf8");
  for (const p of t.parts ?? []) {
    const r = textAusTeil(p);
    if (r !== null) return r;
  }
  return null;
}

const datumOderTag = (v: { dateTime?: string; date?: string } | undefined) => (v?.dateTime ? new Date(v.dateTime) : v?.date ? new Date(`${v.date}T00:00:00Z`) : null);

export function erstelleGoogle(k: OAuthAnbieter, abrufer: Abrufer): PostfachAnbieter {
  const token = (z: Zugang) => {
    if (z.art !== "oauth") throw new PostfachFehler("ZUGANG_FALSCH");
    return z.accessToken;
  };

  return {
    async holeMailKoepfe(z, stand): Promise<MailAbruf> {
      const seit = stand ? new Date(Date.parse(stand) - 3_600_000) : new Date(Date.now() - ERSTER_ABGLEICH_TAGE * 86_400_000);
      const ids: string[] = [];
      let seite: string | undefined;
      do {
        const u = new URL(`${k.apiBasis}/users/me/messages`);
        u.searchParams.set("q", `after:${Math.floor(seit.getTime() / 1000)}`);
        u.searchParams.set("maxResults", "100");
        if (seite) u.searchParams.set("pageToken", seite);
        if (!gleicherHost(k.apiBasis, u.toString())) throw new PostfachFehler("ANBIETER_ANTWORT_UNGUELTIG");
        const l = (await rufeAuf(abrufer, u.toString(), bearer(token(z)))) as GmailListe;
        ids.push(...(l.messages ?? []).map((m) => m.id));
        seite = l.nextPageToken;
      } while (seite && ids.length < MAX_MAILS_JE_ABGLEICH);
      const koepfe: MailKopf[] = [];
      for (const id of ids.slice(0, MAX_MAILS_JE_ABGLEICH)) {
        const u = new URL(`${k.apiBasis}/users/me/messages/${encodeURIComponent(id)}`);
        u.searchParams.set("format", "metadata");
        for (const h of ["From", "To", "Cc", "Subject", "Message-ID", ...MASSEN_KOPFZEILEN]) u.searchParams.append("metadataHeaders", h);
        const m = (await rufeAuf(abrufer, u.toString(), bearer(token(z)))) as GmailNachricht;
        const kopf = (name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
        const datum = new Date(Number(m.internalDate));
        if (Number.isNaN(datum.getTime())) continue;
        koepfe.push({
          id: m.id,
          nachrichtenId: kopf("Message-ID")?.trim() || null,
          datum,
          betreff: (kopf("Subject") ?? "").trim(),
          von: adressenAusKopf(kopf("From"))[0] ?? "",
          an: adressenAusKopf(kopf("To")),
          cc: adressenAusKopf(kopf("Cc")),
          ...optional("namen", namenAus(["From", "To", "Cc"].flatMap((h) => namenAusKopf(kopf(h))))),
          ...(istMassenmail(kopf) ? { massenmail: true } : {}),
          ...(m.labelIds?.includes("SENT") ? { gesendet: true } : {}),
        });
      }
      koepfe.sort((a, b) => a.datum.getTime() - b.datum.getTime());
      // Die Liste kommt neueste zuerst: Erreicht sie die Obergrenze, fehlen nur ältere Nachrichten des ersten Abgleichs, nie neue.
      const stand2 = koepfe.at(-1)?.datum ?? seit;
      return { koepfe, stand: stand2.toISOString() };
    },

    async holeMailText(z, kopf, max) {
      const u = new URL(`${k.apiBasis}/users/me/messages/${encodeURIComponent(kopf.id)}`);
      u.searchParams.set("format", "full");
      const m = (await rufeAuf(abrufer, u.toString(), bearer(token(z)))) as GmailNachricht;
      return (textAusTeil(m.payload) ?? m.snippet ?? "").slice(0, max);
    },

    async listeAnhaenge(z, kopfId) {
      const u = new URL(`${k.apiBasis}/users/me/messages/${encodeURIComponent(kopfId)}`);
      u.searchParams.set("format", "full");
      const m = (await rufeAuf(abrufer, u.toString(), bearer(token(z)))) as GmailNachricht;
      const liste: { id: string; name: string; groesse: number; typ: string }[] = [];
      const gehe = (t: GmailTeil | undefined) => {
        if (!t) return;
        if (t.filename && t.body?.attachmentId) liste.push({ id: t.body.attachmentId, name: t.filename, groesse: t.body.size ?? 0, typ: t.mimeType ?? "application/octet-stream" });
        for (const p of t.parts ?? []) gehe(p);
      };
      gehe(m.payload);
      return liste;
    },

    async holeAnhang(z, kopfId, anhangId, maxBytes) {
      const u = new URL(`${k.apiBasis}/users/me/messages/${encodeURIComponent(kopfId)}/attachments/${encodeURIComponent(anhangId)}`);
      const r = (await rufeAuf(abrufer, u.toString(), bearer(token(z)))) as { data?: string; size?: number };
      if (typeof r.data !== "string") throw new PostfachFehler("ANBIETER_ANTWORT_UNGUELTIG");
      if ((r.size ?? 0) > maxBytes || r.data.length > Math.ceil((maxBytes * 4) / 3) + 4) throw new PostfachFehler("ANHANG_ZU_GROSS");
      return new Uint8Array(Buffer.from(r.data, "base64url"));
    },

    async holeTermine(z, von, bis): Promise<Termin[]> {
      const basis = k.kalenderBasis;
      if (!basis) throw new PostfachFehler("ANBIETER_NICHT_EINGERICHTET");
      const u = new URL(`${basis}/calendars/primary/events`);
      u.searchParams.set("timeMin", von.toISOString());
      u.searchParams.set("timeMax", bis.toISOString());
      u.searchParams.set("singleEvents", "true");
      u.searchParams.set("orderBy", "startTime");
      u.searchParams.set("maxResults", "250");
      u.searchParams.set("showDeleted", "true");
      const l = (await rufeAuf(abrufer, u.toString(), bearer(token(z)))) as { items?: GoogleTermin[] };
      const termine: Termin[] = [];
      for (const t of l.items ?? []) {
        const beginn = datumOderTag(t.start);
        if (!beginn) continue;
        termine.push({
          id: t.iCalUID || t.id,
          instanz: t.recurringEventId ? (datumOderTag(t.originalStartTime) ?? beginn).toISOString() : null,
          titel: (t.summary ?? "").trim(),
          beginn,
          ende: datumOderTag(t.end),
          teilnehmer: [t.organizer?.email, ...(t.attendees ?? []).map((a) => a.email)].filter((e): e is string => typeof e === "string" && e.includes("@")).map((e) => e.toLowerCase()),
          organisator: typeof t.organizer?.email === "string" && t.organizer.email.includes("@") ? t.organizer.email.toLowerCase() : null,
          ...optional("namen", namenAus([t.organizer, ...(t.attendees ?? [])].map((a) => ({ adresse: a?.email, name: a?.displayName })))),
          eigeneAntwort: eigeneAntwortGoogle(t),
          abgesagt: t.status === "cancelled",
        });
      }
      return termine;
    },
  };
}
