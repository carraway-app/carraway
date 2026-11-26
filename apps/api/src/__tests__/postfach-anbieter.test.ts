import { describe, expect, it } from "vitest";
import { erstelleGoogle, adressenAusKopf, eigeneAntwortGoogle, zerlegeAdressliste } from "../postfach/google";
import { erstelleImap, type ImapKopf, type ImapVerbindung } from "../postfach/imap";
import { eigeneAntwortGraph, erstelleMicrosoft } from "../postfach/microsoft";
import { textauszug } from "../postfach/mime";
import { baueAutorisierungsUrl, pruefeIdToken, sha256Hex } from "../postfach/oauth";
import { pruefeImapZiel, istPrivateAdresse } from "../postfach/ziel";
import { PostfachFehler, type Zugang } from "../postfach/typen";
import { FAKE_HOSTS, postfachKonfig } from "./hilfen-postfach";

/**
 * Dünne Clients ohne SDK gegen Fake-Antworten im Format der Dokumentation der Anbieter. NICHT gegen die echten Dienste geprüft; die Tests sichern, dass
 * nur die erlaubten Felder angefragt werden, Folgeseiten nur beim selben Host geladen werden und die Antworten richtig gelesen werden.
 */

const oauth: Zugang = { art: "oauth", accessToken: "zugriffstoken", refreshToken: "r", ablaufMs: Date.now() + 3_600_000, adresse: "owner@example.com" };
const antwort = (status: number, koerper: unknown) => new Response(JSON.stringify(koerper), { status, headers: { "content-type": "application/json" } });

interface Aufruf {
  url: URL;
  kopf: Headers;
  init: RequestInit | undefined;
}
function fakeFetch(router: (u: URL, a: Aufruf) => Response | undefined) {
  const aufrufe: Aufruf[] = [];
  const abrufer: typeof fetch = async (eingabe, init) => {
    const url = new URL(typeof eingabe === "string" ? eingabe : eingabe instanceof URL ? eingabe.toString() : eingabe.url);
    const a: Aufruf = { url, kopf: new Headers(init?.headers), init };
    aufrufe.push(a);
    const r = router(url, a);
    if (!r) throw new Error(`Unerwarteter Aufruf an ${url.toString()}`);
    return r;
  };
  return { abrufer, aufrufe };
}

describe("Microsoft Graph", () => {
  const k = postfachKonfig().microsoft!;

  it("liest Posteingang und gesendete Elemente nur als Kopfdaten (kein Text, kein Anhang), mit Bearer und ohne Weiterleitungen", async () => {
    const { abrufer, aufrufe } = fakeFetch((u) => {
      if (u.searchParams.get("$skiptoken") === "2") return antwort(200, { value: [] });
      if (u.pathname.endsWith("/mailFolders/inbox/messages")) {
        return antwort(200, {
          value: [
            { id: "e1", internetMessageId: "<e1@x>", subject: "Eingang", receivedDateTime: "2026-03-01T10:00:00Z", from: { emailAddress: { address: "Anna@Alpha.example.com" } }, toRecipients: [{ emailAddress: { address: "owner@example.com" } }], ccRecipients: [{ emailAddress: { address: "cc@alpha.example.com" } }] },
          ],
          "@odata.nextLink": `${FAKE_HOSTS.graph}/me/mailFolders/inbox/messages?$skiptoken=2`,
        });
      }
      if (u.pathname.endsWith("/mailFolders/sentitems/messages")) {
        return antwort(200, { value: [{ id: "g1", internetMessageId: "<g1@x>", subject: "Gesendet", sentDateTime: "2026-03-02T09:00:00Z", from: { emailAddress: { address: "owner@example.com" } }, toRecipients: [{ emailAddress: { address: "anna@alpha.example.com" } }] }] });
      }
      return undefined;
    });
    const r = await erstelleMicrosoft(k, abrufer).holeMailKoepfe(oauth, null);
    expect(r.koepfe.map((m) => [m.id, m.nachrichtenId, m.von, m.an, m.cc])).toEqual([
      ["e1", "<e1@x>", "anna@alpha.example.com", ["owner@example.com"], ["cc@alpha.example.com"]],
      ["g1", "<g1@x>", "owner@example.com", ["anna@alpha.example.com"], []],
    ]);
    expect(r.stand).toBe("2026-03-02T09:00:00.000Z");
    // Gesendet nur aus dem Ordner „Gesendete Elemente“ (Anbieterfakt), nie aus der From-Zeile
    expect(r.koepfe.map((m) => m.gesendet ?? false)).toEqual([false, true]);
    for (const a of aufrufe) {
      expect(a.kopf.get("authorization")).toBe("Bearer zugriffstoken");
      expect(a.init?.redirect).toBe("error");
      const select = a.url.searchParams.get("$select");
      if (select) {
        expect(select).not.toMatch(/body|bodyPreview|attachments/);
        expect(select).toContain("internetMessageId");
      }
      expect(a.url.origin).toBe(new URL(FAKE_HOSTS.graph).origin);
      expect(a.init?.method ?? "GET").toBe("GET"); // nur lesend
    }
  });

  it("Stand bei gekapptem Ordner: der Stand rückt nie über die letzte geladene Nachricht eines gekappten Ordners hinaus, auch wenn gesendete Elemente neuer sind", async () => {
    const tag = 86_400_000;
    const basis = Date.UTC(2026, 2, 1);
    const eingang = Array.from({ length: 500 }, (_, i) => ({ id: `e${i}`, internetMessageId: `<e${i}@x>`, subject: `Eingang ${i}`, receivedDateTime: new Date(basis + i * 60_000).toISOString(), from: { emailAddress: { address: "anna@alpha.example.com" } }, toRecipients: [{ emailAddress: { address: "owner@example.com" } }] }));
    const spaeteste = new Date(basis + 20 * tag).toISOString();
    const { abrufer } = fakeFetch((u) =>
      u.pathname.endsWith("/inbox/messages")
        ? antwort(200, { value: eingang })
        : antwort(200, { value: [{ id: "g1", internetMessageId: "<g1@x>", subject: "Gesendet viel später", sentDateTime: spaeteste, from: { emailAddress: { address: "owner@example.com" } }, toRecipients: [{ emailAddress: { address: "anna@alpha.example.com" } }] }] }),
    );
    const r = await erstelleMicrosoft(k, abrufer).holeMailKoepfe(oauth, null);
    expect(r.koepfe).toHaveLength(501);
    // Ohne Kappung wäre der Stand der Zeitpunkt der gesendeten Nachricht; so bleibt er bei der letzten Nachricht des Posteingangs.
    expect(r.stand).toBe(new Date(basis + 499 * 60_000).toISOString());
    // Nicht gekappt: der Stand ist die neueste Nachricht beider Ordner.
    const { abrufer: kurz } = fakeFetch((u) => (u.pathname.endsWith("/inbox/messages") ? antwort(200, { value: eingang.slice(0, 3) }) : antwort(200, { value: [{ id: "g1", internetMessageId: "<g1@x>", subject: "G", sentDateTime: spaeteste, from: { emailAddress: { address: "owner@example.com" } }, toRecipients: [] }] })));
    expect((await erstelleMicrosoft(k, kurz).holeMailKoepfe(oauth, null)).stand).toBe(spaeteste);
  });

  it("Folgeseiten bei einem fremden Host werden nicht geladen (kein Token an fremde Adresse)", async () => {
    const { abrufer, aufrufe } = fakeFetch((u) => (u.pathname.endsWith("/inbox/messages") ? antwort(200, { value: [], "@odata.nextLink": "https://boese.example.net/steal" }) : antwort(200, { value: [] })));
    await expect(erstelleMicrosoft(k, abrufer).holeMailKoepfe(oauth, null)).rejects.toMatchObject({ code: "ANBIETER_ANTWORT_UNGUELTIG" });
    expect(aufrufe.every((a) => a.url.origin === new URL(FAKE_HOSTS.graph).origin)).toBe(true);
  });

  it("Textauszug erst auf Anforderung, als Klartext und auf die gewünschte Länge gekürzt", async () => {
    const { abrufer, aufrufe } = fakeFetch(() => antwort(200, { body: { content: "x".repeat(900) } }));
    const text = await erstelleMicrosoft(k, abrufer).holeMailText(oauth, { id: "e1/..", nachrichtenId: null, datum: new Date(), betreff: "", von: "", an: [], cc: [] }, 500);
    expect(text).toHaveLength(500);
    expect(aufrufe[0]!.kopf.get("prefer")).toContain('outlook.body-content-type="text"');
    expect(aufrufe[0]!.url.pathname).toContain("e1%2F..");
    expect(aufrufe[0]!.url.searchParams.get("$select")).toBe("body");
  });

  it("Termine: calendarView in UTC, Serieninstanzen, Absagen, Organisator und Teilnehmer", async () => {
    const { abrufer, aufrufe } = fakeFetch(() =>
      antwort(200, {
        value: [
          { id: "ev1", iCalUId: "uid-1", subject: "Gespräch", start: { dateTime: "2026-03-05T09:00:00.0000000" }, end: { dateTime: "2026-03-05T10:00:00.0000000" }, organizer: { emailAddress: { address: "Org@Alpha.example.com" } }, attendees: [{ emailAddress: { address: "owner@example.com" } }], type: "singleInstance", responseStatus: { response: "accepted" } },
          { id: "ev2", iCalUId: "uid-2", subject: "Serie", start: { dateTime: "2026-03-06T09:00:00.0000000" }, end: { dateTime: "2026-03-06T10:00:00.0000000" }, attendees: [], type: "occurrence", originalStart: "2026-03-06T09:00:00Z", isCancelled: true },
        ],
      }),
    );
    const termine = await erstelleMicrosoft(k, abrufer).holeTermine(oauth, new Date("2026-03-01T00:00:00Z"), new Date("2026-06-01T00:00:00Z"));
    expect(aufrufe[0]!.kopf.get("prefer")).toContain('outlook.timezone="UTC"');
    expect(aufrufe[0]!.url.searchParams.get("$select")).toContain("isOrganizer,responseStatus");
    expect(aufrufe[0]!.url.searchParams.get("startDateTime")).toBe("2026-03-01T00:00:00.000Z");
    expect(termine).toEqual([
      { id: "uid-1", instanz: null, titel: "Gespräch", beginn: new Date("2026-03-05T09:00:00Z"), ende: new Date("2026-03-05T10:00:00Z"), teilnehmer: ["org@alpha.example.com", "owner@example.com"], organisator: "org@alpha.example.com", eigeneAntwort: "angenommen", abgesagt: false },
      { id: "uid-2", instanz: "2026-03-06T09:00:00.000Z", titel: "Serie", beginn: new Date("2026-03-06T09:00:00Z"), ende: new Date("2026-03-06T10:00:00Z"), teilnehmer: [], organisator: null, eigeneAntwort: "offen", abgesagt: true },
    ]);
  });

  it("401 und 403 gelten als ungültiger Zugang (erneut anmelden), 429 und 5xx als vorübergehend", async () => {
    const mit = (status: number) => erstelleMicrosoft(k, fakeFetch(() => antwort(status, {})).abrufer).holeMailKoepfe(oauth, null).catch((e: unknown) => e as PostfachFehler);
    expect(await mit(401)).toMatchObject({ code: "ZUGANG_UNGUELTIG", erneutAnmelden: true });
    expect(await mit(403)).toMatchObject({ code: "ZUGANG_UNGUELTIG", erneutAnmelden: true });
    expect(await mit(429)).toMatchObject({ code: "ANBIETER_BEGRENZT", erneutAnmelden: false });
    expect(await mit(503)).toMatchObject({ code: "ANBIETER_FEHLER_503", erneutAnmelden: false });
    const netz = erstelleMicrosoft(k, async () => {
      throw new TypeError("fetch failed: owner@example.com");
    });
    const f = (await netz.holeMailKoepfe(oauth, null).catch((e: unknown) => e)) as PostfachFehler;
    expect(f.code).toBe("ANBIETER_NICHT_ERREICHBAR");
    expect(f.message).not.toContain("owner@example.com");
  });
});

describe("Gmail und Google Kalender", () => {
  const k = { ...postfachKonfig().microsoft!, apiBasis: FAKE_HOSTS.gmail, kalenderBasis: FAKE_HOSTS.kalender };

  it("holt erst die IDs, dann je Nachricht nur die Kopfzeilen auf der Whitelist; Adressen aus Kopfzeilen mit Namen", async () => {
    const { abrufer, aufrufe } = fakeFetch((u) => {
      if (u.pathname.endsWith("/users/me/messages")) return antwort(200, { messages: [{ id: "a" }, { id: "b" }] });
      const id = u.pathname.split("/").pop();
      return antwort(200, {
        id,
        labelIds: id === "a" ? ["INBOX"] : ["SENT"],
        internalDate: String(Date.parse(id === "a" ? "2026-03-03T10:00:00Z" : "2026-03-04T10:00:00Z")),
        payload: { headers: [{ name: "From", value: '"Anna Alpha" <Anna@alpha.example.com>' }, { name: "To", value: "owner@example.com, Bruno <b@beta.example.com>" }, { name: "Subject", value: `Betreff ${id}` }, { name: "Message-ID", value: `<${id}@g>` }, ...(id === "b" ? [{ name: "List-Unsubscribe", value: "<https://liste.example/ab>" }] : [])] },
      });
    });
    const r = await erstelleGoogle(k, abrufer).holeMailKoepfe(oauth, "2026-03-01T00:00:00.000Z");
    // Anzeigenamen und Massenmail-Kennung nur für Kontakte aus Postfach und Kalender
    expect(r.koepfe.map((m) => [m.namen, m.massenmail ?? false])).toEqual([
      [{ "anna@alpha.example.com": "Anna Alpha", "b@beta.example.com": "Bruno" }, false],
      [{ "anna@alpha.example.com": "Anna Alpha", "b@beta.example.com": "Bruno" }, true],
    ]);
    expect(r.koepfe.map((m) => m.gesendet ?? false)).toEqual([false, true]);
    expect(r.koepfe.map((m) => [m.id, m.von, m.an, m.betreff, m.nachrichtenId])).toEqual([
      ["a", "anna@alpha.example.com", ["owner@example.com", "b@beta.example.com"], "Betreff a", "<a@g>"],
      ["b", "anna@alpha.example.com", ["owner@example.com", "b@beta.example.com"], "Betreff b", "<b@g>"],
    ]);
    expect(r.stand).toBe("2026-03-04T10:00:00.000Z");
    const liste = aufrufe[0]!.url;
    expect(liste.searchParams.get("q")).toMatch(/^after:\d+$/);
    for (const a of aufrufe.slice(1)) {
      expect(a.url.searchParams.get("format")).toBe("metadata");
      expect(a.url.searchParams.getAll("metadataHeaders").sort()).toEqual(["Auto-Submitted", "Cc", "From", "List-Id", "List-Unsubscribe", "Message-ID", "Precedence", "Subject", "To"]);
    }
    expect(aufrufe.every((a) => a.kopf.get("authorization") === "Bearer zugriffstoken" && (a.init?.method ?? "GET") === "GET")).toBe(true);
  });

  it("Textauszug aus dem text/plain-Teil, sonst aus dem Snippet", async () => {
    const teil = (data: string) => ({ payload: { mimeType: "multipart/alternative", parts: [{ mimeType: "text/html", body: { data: Buffer.from("<b>html</b>").toString("base64url") } }, { mimeType: "text/plain", body: { data: Buffer.from(data).toString("base64url") } }] } });
    const kopf = { id: "a", nachrichtenId: null, datum: new Date(), betreff: "", von: "", an: [], cc: [] };
    expect(await erstelleGoogle(k, fakeFetch(() => antwort(200, teil("Hallo Welt, schöne Grüße"))).abrufer).holeMailText(oauth, kopf, 500)).toBe("Hallo Welt, schöne Grüße");
    expect(await erstelleGoogle(k, fakeFetch(() => antwort(200, { snippet: "Nur ein Snippet", payload: { mimeType: "text/html" } })).abrufer).holeMailText(oauth, kopf, 500)).toBe("Nur ein Snippet");
  });

  it("Termine: Einzelinstanzen, Serien, Absagen, ganztägige Termine", async () => {
    const { abrufer, aufrufe } = fakeFetch(() =>
      antwort(200, {
        items: [
          { id: "g1", iCalUID: "ical-1@google.com", summary: "Gespräch", start: { dateTime: "2026-03-05T10:00:00+01:00" }, end: { dateTime: "2026-03-05T11:00:00+01:00" }, organizer: { email: "Org@alpha.example.com" }, attendees: [{ email: "owner@example.com", self: true, responseStatus: "needsAction" }] },
          { id: "g2_20260306", iCalUID: "ical-2@google.com", summary: "Serie", recurringEventId: "g2", originalStartTime: { dateTime: "2026-03-06T10:00:00+01:00" }, start: { dateTime: "2026-03-06T12:00:00+01:00" }, end: { dateTime: "2026-03-06T13:00:00+01:00" }, status: "cancelled" },
          { id: "g3", summary: "Ganztags", start: { date: "2026-03-09" }, end: { date: "2026-03-10" }, organizer: { email: "owner@example.com", self: true } },
        ],
      }),
    );
    const termine = await erstelleGoogle(k, abrufer).holeTermine(oauth, new Date("2026-03-01T00:00:00Z"), new Date("2026-06-01T00:00:00Z"));
    expect(termine.map((x) => [x.id, x.instanz, x.titel, x.abgesagt, x.teilnehmer])).toEqual([
      ["ical-1@google.com", null, "Gespräch", false, ["org@alpha.example.com", "owner@example.com"]],
      ["ical-2@google.com", "2026-03-06T09:00:00.000Z", "Serie", true, []],
      ["g3", null, "Ganztags", false, ["owner@example.com"]],
    ]);
    // Eigene Antwort aus Anbieterfakten: offene Einladung, selbst organisiert
    expect(termine.map((x) => x.eigeneAntwort)).toEqual(["offen", "offen", "organisator"]);
    expect(termine[0]!.beginn.toISOString()).toBe("2026-03-05T09:00:00.000Z");
    expect(aufrufe[0]!.url.pathname).toBe("/calendar/v3/calendars/primary/events");
    expect(aufrufe[0]!.url.searchParams.get("singleEvents")).toBe("true");
  });

  it("Anhänge: Liste aus den Teilen der Nachricht (nur mit Dateiname und Anhangs-ID), Download als Bytes, Größenlimit", async () => {
    const { abrufer, aufrufe } = fakeFetch((u) => {
      if (u.pathname.endsWith("/attachments/anh-1")) return antwort(200, { data: Buffer.from("PDF-Inhalt").toString("base64url"), size: 10 });
      if (u.pathname.endsWith("/attachments/anh-gross")) return antwort(200, { data: "AAAA", size: 99_000_000 });
      return antwort(200, {
        id: "a",
        payload: { mimeType: "multipart/mixed", parts: [{ mimeType: "text/plain", body: { data: "eA" } }, { mimeType: "multipart/related", parts: [{ mimeType: "application/pdf", filename: "Vertrag.pdf", body: { attachmentId: "anh-1", size: 10 } }] }, { mimeType: "image/png", filename: "", body: { attachmentId: "bild" } }] },
      });
    });
    const g = erstelleGoogle(k, abrufer);
    expect(await g.listeAnhaenge!(oauth, "a")).toEqual([{ id: "anh-1", name: "Vertrag.pdf", groesse: 10, typ: "application/pdf" }]);
    expect(Buffer.from(await g.holeAnhang!(oauth, "a", "anh-1", 1000)).toString()).toBe("PDF-Inhalt");
    await expect(g.holeAnhang!(oauth, "a", "anh-gross", 1000)).rejects.toMatchObject({ code: "ANHANG_ZU_GROSS" });
    expect(aufrufe.every((a) => (a.init?.method ?? "GET") === "GET")).toBe(true);
  });

  it("Graph: Anhang als Bytes mit Größenlimit schon am Kopf `content-length`", async () => {
    const m = postfachKonfig().microsoft!;
    const klein = erstelleMicrosoft(m, fakeFetch(() => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-length": "3" } })).abrufer);
    expect([...(await klein.holeAnhang!(oauth, "m1", "a1", 100))]).toEqual([1, 2, 3]);
    const gross = erstelleMicrosoft(m, fakeFetch(() => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-length": "5000" } })).abrufer);
    await expect(gross.holeAnhang!(oauth, "m1", "a1", 100)).rejects.toMatchObject({ code: "ANHANG_ZU_GROSS" });
    const ohneKopf = erstelleMicrosoft(m, fakeFetch(() => new Response(new Uint8Array(500), { status: 200 })).abrufer);
    await expect(ohneKopf.holeAnhang!(oauth, "m1", "a1", 100)).rejects.toMatchObject({ code: "ANHANG_ZU_GROSS" });
  });

  it("eigene Antwort auf Termine: nur organisiert oder angenommen zählt als gemeinsamer Termin", () => {
    expect(eigeneAntwortGraph({ isOrganizer: true })).toBe("organisator");
    expect(eigeneAntwortGraph({ responseStatus: { response: "accepted" } })).toBe("angenommen");
    expect(eigeneAntwortGraph({ responseStatus: { response: "tentativelyAccepted" } })).toBe("vorbehalt");
    expect(eigeneAntwortGraph({ responseStatus: { response: "declined" } })).toBe("abgelehnt");
    expect(eigeneAntwortGraph({ responseStatus: { response: "notResponded" } })).toBe("offen");
    expect(eigeneAntwortGoogle({ attendees: [{ self: false, responseStatus: "accepted" }, { self: true, responseStatus: "declined" }] })).toBe("abgelehnt");
    expect(eigeneAntwortGoogle({ attendees: [{ self: true, responseStatus: "accepted" }] })).toBe("angenommen");
    expect(eigeneAntwortGoogle({})).toBe("offen");
  });

  it("Adresslisten nach RFC 5322: Adresse aus spitzen Klammern, nie aus dem Anzeigenamen", () => {
    expect(zerlegeAdressliste('"owner@example.com" <fremd@angreifer.example>')).toEqual([{ adresse: "fremd@angreifer.example", name: "owner@example.com" }]);
    expect(adressenAusKopf('owner@example.com <fremd@angreifer.example>')).toEqual(["fremd@angreifer.example"]);
    expect(adressenAusKopf('"Muster, (Erika)" <e@x.example>, Bert (Büro) <b@y.example>, c@z.example (Kommentar)')).toEqual(["e@x.example", "b@y.example", "c@z.example"]);
    expect(adressenAusKopf("Gruppe: a@x.example, b@y.example;")).toEqual(["a@x.example", "b@y.example"]);
    expect(adressenAusKopf("kein Eintrag, <kaputt>")).toEqual([]);
  });

  it("adressenAusKopf liest Namen und Listen", () => {
    expect(adressenAusKopf('"Alpha, Anna" <A@x.example.com>, b@y.example.org;')).toEqual(["a@x.example.com", "b@y.example.org"]);
    expect(adressenAusKopf(undefined)).toEqual([]);
  });
});

describe("OAuth-Bausteine", () => {
  const a = postfachKonfig().microsoft!;
  it("Autorisierungsadresse: Google verlangt Offline-Zugriff, Microsoft nicht; keine Geheimnisse in der Adresse", () => {
    const google = baueAutorisierungsUrl(a, "google", "kalender", { redirectUri: "https://x.example/cb", state: "s", nonce: "n", challenge: "c" });
    const g = new URL(google).searchParams;
    expect(g.get("access_type")).toBe("offline");
    expect(g.get("scope")).toContain("calendar.readonly");
    expect(g.get("scope")).not.toMatch(/calendar(?!\.readonly)(?:\s|$)/);
    expect(google).not.toContain(a.clientSecret);
    const ms = new URL(baueAutorisierungsUrl(a, "microsoft", "mail", { redirectUri: "https://x.example/cb", state: "s", nonce: "n", challenge: "c" })).searchParams;
    expect(ms.get("access_type")).toBeNull();
    expect(ms.get("scope")).toContain("offline_access");
  });

  it("ID-Token: Zielgruppe, Ablauf, nonce und Adresse werden geprüft", () => {
    const token = (nutzlast: object) => `x.${Buffer.from(JSON.stringify(nutzlast)).toString("base64url")}.y`;
    const heute = Math.floor(Date.now() / 1000);
    const gut = { aud: "client-ms", exp: heute + 100, nonce: "abc", email: "Owner@Example.com" };
    const p = { clientId: "client-ms", nonceHash: sha256Hex("abc") };
    expect(pruefeIdToken(token(gut), p)).toEqual({ adresse: "owner@example.com" });
    expect(pruefeIdToken(token({ ...gut, email: undefined, preferred_username: "upn@example.com" }), p)).toEqual({ adresse: "upn@example.com" });
    expect(() => pruefeIdToken(token({ ...gut, aud: "anderer" }), p)).toThrow(PostfachFehler);
    expect(() => pruefeIdToken(token({ ...gut, exp: heute - 10 }), p)).toThrow(PostfachFehler);
    expect(() => pruefeIdToken(token({ ...gut, nonce: "xyz" }), p)).toThrow(/NONCE/);
    expect(() => pruefeIdToken(token({ ...gut, nonce: undefined }), p)).toThrow(/NONCE/);
    expect(() => pruefeIdToken(token({ ...gut, email: "keine-adresse" }), p)).toThrow(PostfachFehler);
    expect(() => pruefeIdToken(null, p)).toThrow(/ID_TOKEN_FEHLT/);
    expect(() => pruefeIdToken("kaputt", p)).toThrow(PostfachFehler);
  });
});

describe("IMAP-Adapter", () => {
  const zugang = (ordner = ["INBOX"]): Zugang => ({ art: "imap", host: "imap.example.org", port: 993, sicherheit: "tls", benutzer: "u", passwort: "p", adresse: "owner@example.org", ordner });
  const kopf = (uid: number, tage: number): ImapKopf => ({ uid, nachrichtenId: `<${uid}@imap>`, datum: new Date(Date.now() - tage * 86_400_000), betreff: `Mail ${uid}`, von: "anna@alpha.example.com", an: ["owner@example.org"], cc: [] });
  const oeffentlich = async () => ["93.184.216.34"];

  function fakeVerbindung(ordner: Record<string, { validity: string; mails: ImapKopf[]; gesendet?: boolean }>, sentOrdner?: string | null) {
    const log: string[] = [];
    let offen = "";
    const v: ImapVerbindung = {
      async oeffne(o) {
        offen = o;
        log.push(`oeffne ${o}`);
        return { uidValidity: ordner[o]!.validity, ...(ordner[o]!.gesendet ? { gesendet: true } : {}) };
      },
      async uidsNach(ab) {
        log.push(`nach ${ab}`);
        return ordner[offen]!.mails.map((m) => m.uid).filter((u) => u > ab);
      },
      async uidsSeit() {
        log.push("seit");
        return ordner[offen]!.mails.map((m) => m.uid);
      },
      async koepfe(uids) {
        return ordner[offen]!.mails.filter((m) => uids.includes(m.uid));
      },
      ...(sentOrdner === undefined ? {} : { gesendetOrdner: async () => sentOrdner }),
      async rohtext() {
        return "Content-Type: text/plain; charset=utf-8\r\n\r\nHallo aus IMAP";
      },
      async schliesse() {
        log.push("zu");
      },
    };
    return { v, log };
  }

  it("Gesendet nur aus dem Ordner mit Sonderverwendung \\Sent, nie aus der From-Zeile", async () => {
    const gefaelscht = { ...kopf(1, 1), von: "owner@example.org", an: ["fremd@angreifer.example"] };
    const ordner = { INBOX: { validity: "7", mails: [gefaelscht] }, Gesendet: { validity: "9", mails: [kopf(5, 1)], gesendet: true } };
    const { v } = fakeVerbindung(ordner);
    const adapter = erstelleImap({ fabrik: async () => v, privateZiele: false, aufloeser: oeffentlich });
    const r = await adapter.holeMailKoepfe(zugang(["INBOX", "Gesendet"]), null);
    expect(r.koepfe.map((m) => [m.id, m.gesendet ?? false])).toEqual([
      ["0:1", false],
      ["1:5", true],
    ]);
  });

  it("Gesendet-Ordner (SPECIAL-USE \\Sent) wird automatisch mit abgeglichen, auch für den Text, ohne Doppelung", async () => {
    const ordner = { INBOX: { validity: "7", mails: [kopf(1, 1)] }, "Gesendete Objekte": { validity: "9", mails: [kopf(5, 1)], gesendet: true } };
    const { v, log } = fakeVerbindung(ordner, "Gesendete Objekte");
    const adapter = erstelleImap({ fabrik: async () => v, privateZiele: false, aufloeser: oeffentlich });
    const r = await adapter.holeMailKoepfe(zugang(["INBOX"]), null);
    expect(r.koepfe.map((m) => [m.id, m.gesendet ?? false])).toEqual([
      ["0:1", false],
      ["1:5", true],
    ]);
    expect(JSON.parse(r.stand!)).toEqual({ INBOX: "7:1", "Gesendete Objekte": "9:5" });
    expect(await adapter.holeMailText(zugang(["INBOX"]), r.koepfe[1]!, 100)).toContain("Hallo aus IMAP");
    expect(log).toContain("oeffne Gesendete Objekte");
    // Schon eingerichtet (andere Schreibweise): kein zweites Mal.
    const { v: v2 } = fakeVerbindung(ordner, "gesendete objekte");
    const a2 = erstelleImap({ fabrik: async () => v2, privateZiele: false, aufloeser: oeffentlich });
    expect((await a2.holeMailKoepfe(zugang(["INBOX", "Gesendete Objekte"]), null)).koepfe.map((m) => m.id)).toEqual(["0:1", "1:5"]);
    // Kein Gesendet-Ordner oder Fehler bei der Ordnerliste: nur die eingerichteten Ordner.
    const { v: v3 } = fakeVerbindung(ordner, null);
    const a3 = erstelleImap({ fabrik: async () => v3, privateZiele: false, aufloeser: oeffentlich });
    expect((await a3.holeMailKoepfe(zugang(["INBOX"]), null)).koepfe.map((m) => m.id)).toEqual(["0:1"]);
    const { v: v4 } = fakeVerbindung(ordner, "Gesendete Objekte");
    v4.gesendetOrdner = async () => Promise.reject(new Error("LIST nicht erlaubt"));
    const a4 = erstelleImap({ fabrik: async () => v4, privateZiele: false, aufloeser: oeffentlich });
    expect((await a4.holeMailKoepfe(zugang(["INBOX"]), null)).koepfe.map((m) => m.id)).toEqual(["0:1"]);
  });

  it("erster Abgleich: letzte 30 Tage je Ordner; danach nur neue UIDs; ändert sich UIDVALIDITY, beginnt der Ordner neu", async () => {
    const ordner = { INBOX: { validity: "7", mails: [kopf(1, 3), kopf(2, 2)] }, Sent: { validity: "9", mails: [kopf(5, 1)] } };
    const { v, log } = fakeVerbindung(ordner);
    const adapter = erstelleImap({ fabrik: async () => v, privateZiele: false, aufloeser: oeffentlich });
    const erster = await adapter.holeMailKoepfe(zugang(["INBOX", "Sent"]), null);
    expect(erster.koepfe.map((m) => m.id)).toEqual(["0:1", "0:2", "1:5"]);
    expect(erster.koepfe[0]).toMatchObject({ nachrichtenId: "<1@imap>", von: "anna@alpha.example.com" });
    expect(JSON.parse(erster.stand)).toEqual({ INBOX: "7:2", Sent: "9:5" });
    expect(log.filter((l) => l === "seit")).toHaveLength(2);
    await adapter.schliesse!();

    ordner.INBOX.mails.push(kopf(3, 0));
    const { v: v2, log: log2 } = fakeVerbindung(ordner);
    const a2 = erstelleImap({ fabrik: async () => v2, privateZiele: false, aufloeser: oeffentlich });
    const zweiter = await a2.holeMailKoepfe(zugang(["INBOX", "Sent"]), erster.stand);
    expect(zweiter.koepfe.map((m) => m.id)).toEqual(["0:3"]);
    expect(log2).toContain("nach 2");
    expect(log2).toContain("nach 5");
    expect(log2).not.toContain("seit");

    // Neue UIDVALIDITY: Der Ordner gilt als neu aufgebaut.
    ordner.INBOX.validity = "8";
    const { v: v3, log: log3 } = fakeVerbindung(ordner);
    const a3 = erstelleImap({ fabrik: async () => v3, privateZiele: false, aufloeser: oeffentlich });
    const dritter = await a3.holeMailKoepfe(zugang(["INBOX", "Sent"]), zweiter.stand);
    expect(log3).toContain("seit");
    expect(dritter.koepfe.map((m) => m.id)).toEqual(["0:1", "0:2", "0:3"]);
  });

  it("Textauszug über Ordner-Nummer und UID; Kalender gibt es nicht; das Ziel wird vor dem Verbinden geprüft", async () => {
    const { v } = fakeVerbindung({ INBOX: { validity: "1", mails: [kopf(1, 1)] } });
    const adapter = erstelleImap({ fabrik: async () => v, privateZiele: false, aufloeser: oeffentlich });
    expect(await adapter.holeMailText(zugang(), { id: "0:1", nachrichtenId: null, datum: new Date(), betreff: "", von: "", an: [], cc: [] }, 500)).toBe("Hallo aus IMAP");
    expect(await adapter.holeTermine(zugang(), new Date(), new Date())).toEqual([]);
    let verbunden = false;
    const privat = erstelleImap({ fabrik: async () => ((verbunden = true), v), privateZiele: false, aufloeser: async () => ["192.168.0.4"] });
    await expect(privat.holeMailKoepfe(zugang(), null)).rejects.toMatchObject({ code: "ZIEL_VERBOTEN" });
    expect(verbunden).toBe(false);
  });
});

describe("Textauszug aus roher Nachricht", () => {
  it("einfache Nachricht, Quoted-Printable mit Umlauten, Base64, Latin-1", () => {
    expect(textauszug("Subject: x\r\n\r\nHallo\r\nWelt", 100)).toBe("Hallo\nWelt");
    expect(textauszug("Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nGr=C3=BC=C3=9Fe aus M=C3=BCnchen =\r\nund Berlin", 100)).toBe("Grüße aus München und Berlin");
    expect(textauszug(`Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from("Zählung läuft").toString("base64")}`, 100)).toBe("Zählung läuft");
    expect(textauszug("Content-Type: text/plain; charset=iso-8859-1\r\n\r\nSch\xf6ne Gr\xfc\xdfe", 100)).toBe("Schöne Grüße");
  });

  it("multipart: erster text/plain-Teil, HTML und Anhänge werden übergangen; Kürzung auf die Länge", () => {
    const roh = [
      "Content-Type: multipart/mixed; boundary=\"GRENZE\"",
      "",
      "--GRENZE",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>nur html</p>",
      "--GRENZE",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Disposition: attachment; filename=a.txt",
      "",
      "ANHANG",
      "--GRENZE",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Der eigentliche Text der Nachricht.",
      "--GRENZE--",
    ].join("\r\n");
    expect(textauszug(roh, 100)).toBe("Der eigentliche Text der Nachricht.");
    expect(textauszug(roh, 9)).toBe("Der eigen");
    expect(textauszug("Content-Type: text/html\r\n\r\n<b>nur html</b>", 100)).toBe("");
  });
});

describe("Schutz vor Abfragen interner Ziele", () => {
  it("erkennt Sonderbereiche in allen Schreibweisen: IPv4, abgebildetes IPv4 (auch hex), ::/96, NAT64, 6to4, Teredo, Multicast, Dokumentation, Link-Local", () => {
    const gesperrt = [
      "0.0.0.0", "0.1.2.3", "127.0.0.1", "127.255.255.254", "10.1.2.3", "100.64.0.1", "100.127.255.255", "169.254.169.254", "172.16.0.1", "172.31.255.255",
      "192.168.0.1", "192.0.0.8", "192.0.2.5", "198.18.0.1", "198.19.255.255", "198.51.100.7", "203.0.113.9", "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
      "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:7F00:0001", "0:0:0:0:0:ffff:a00:1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "::ffff:c0a8:1",
      "::7f00:1", "::127.0.0.1", "::10.0.0.1", "64:ff9b::7f00:1", "64:ff9b::a00:1", "64:ff9b::169.254.169.254", "64:ff9b::c0a8:101",
      "2002:7f00:1::1", "2002:a00:1::", "2002:c0a8:101::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001:db8::1", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0", "febf::1", "fec0::1", "ff02::1", "ff00::", "100::1",
      "kein-ip", "1.2.3", "::ffff:999.1.1.1", ":::", "1:2:3:4:5:6:7:8:9",
    ];
    for (const ip of gesperrt) expect(istPrivateAdresse(ip), ip).toBe(true);
    for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "100.128.0.1", "198.20.0.1", "169.255.0.1", "11.0.0.1", "2606:2800:220:1:248:1893:25c8:1946", "2a00:1450:4001:81b::200e", "::ffff:5db8:d822", "64:ff9b::5db8:d822"]) {
      expect(istPrivateAdresse(ip), ip).toBe(false);
    }
  });

  it("prüft Name, Port und Auflösung, gibt die geprüfte Adresse zurück und erlaubt private Ziele nur mit Schalter", async () => {
    await expect(pruefeImapZiel("imap.example.org", 993, false, async () => ["93.184.216.34"])).resolves.toBe("93.184.216.34");
    await expect(pruefeImapZiel("imap.example.org", 993, false, async () => ["93.184.216.34", "10.0.0.1"])).rejects.toMatchObject({ code: "ZIEL_VERBOTEN" });
    await expect(pruefeImapZiel("imap.example.org", 993, false, async () => ["::ffff:7f00:1"])).rejects.toMatchObject({ code: "ZIEL_VERBOTEN" });
    await expect(pruefeImapZiel("[::ffff:7f00:1]", 993, false)).rejects.toMatchObject({ code: "ZIEL_VERBOTEN" });
    await expect(pruefeImapZiel("::ffff:7f00:1", 993, false)).rejects.toMatchObject({ code: "ZIEL_VERBOTEN" });
    await expect(pruefeImapZiel("2002:7f00:1::1", 993, false)).rejects.toMatchObject({ code: "ZIEL_VERBOTEN" });
    await expect(pruefeImapZiel("imap.example.org", 993, false, async () => [])).rejects.toMatchObject({ code: "ZIEL_VERBOTEN" });
    await expect(pruefeImapZiel("imap.example.org", 993, false, async () => Promise.reject(new Error("nxdomain")))).rejects.toMatchObject({ code: "ZIEL_NICHT_AUFLOESBAR" });
    await expect(pruefeImapZiel("host mit leerzeichen", 993, true)).rejects.toMatchObject({ code: "ZIEL_VERBOTEN" });
    await expect(pruefeImapZiel("imap.example.org", 70000, true)).rejects.toMatchObject({ code: "ZIEL_VERBOTEN" });
    await expect(pruefeImapZiel("localhost", 143, true)).resolves.toBe("localhost");
  });

  it("DNS-Rebinding: aufgelöst wird einmal, verbunden wird mit genau der geprüften Adresse (der Name bleibt nur Servername der TLS-Prüfung)", async () => {
    let aufloesungen = 0;
    const aufloeser = async () => (++aufloesungen === 1 ? ["93.184.216.34"] : ["127.0.0.1"]); // zweite Antwort wäre ein Angriff
    let verbundenMit: { host: string; servername?: string } | null = null;
    const v: ImapVerbindung = { oeffne: async () => ({ uidValidity: "1" }), uidsNach: async () => [], uidsSeit: async () => [], koepfe: async () => [], rohtext: async () => "", schliesse: async () => undefined };
    const adapter = erstelleImap({
      fabrik: async (z) => {
        verbundenMit = { host: z.host, servername: z.servername };
        return v;
      },
      privateZiele: false,
      aufloeser,
    });
    await adapter.holeMailKoepfe({ art: "imap", host: "imap.example.org", port: 993, sicherheit: "tls", benutzer: "u", passwort: "p", adresse: "o@example.org", ordner: ["INBOX"] }, null);
    expect(aufloesungen).toBe(1);
    expect(verbundenMit).toEqual({ host: "93.184.216.34", servername: "imap.example.org" });
  });
});
