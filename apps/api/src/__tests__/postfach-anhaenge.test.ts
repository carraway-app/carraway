import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { DateiSpeicher } from "../berichte/speicher";
import { Schluesselring } from "../geheimnis/krypto";
import { externHash } from "../postfach/abgleich";
import { leseZugang, verschluesseleZugang } from "../postfach/zugang";
import type { Zugang } from "../postfach/typen";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, idVon, legePersonAn, person, type Testperson } from "./hilfen-auth";
import { erzeugePdf } from "./hilfen-dokumente";
import { grundbestand, ID } from "./hilfen-instrumente";
import { FAKE_HOSTS, postfachKonfig } from "./hilfen-postfach";

/**
 * Anhänge synchronisierter Mails auf ausdrücklichen Klick: nur die Besitzerin der Verbindung, Anbieter nur live (kein Anhang wird beim Abgleich gelesen), Übernahme als
 * Dokument mit Rechteprüfung am Ziel. Der Anbieter ist ein Fake (`fetch` mit Graph-Antworten); kein Test erreicht einen echten Dienst.
 */

const { db, pool } = oeffneTestdb();
const ring = new Schluesselring(randomBytes(32));
const vera = person("an-vera", { rollen: { [ID.fonds]: "bearbeiter" } });
const bernd = person("an-bernd", { rollen: { [ID.fonds]: "bearbeiter" } });
const betrachterVera = person("an-betrachter", { rollen: { [ID.fonds]: "betrachter" } });
const DEAL = "00000000-0000-4000-8000-0000000000d1";
const PDF = erzeugePdf(["Vertrag Beispiel"]);

interface Aufruf {
  url: URL;
}
let aufrufe: Aufruf[] = [];
let anhangListe: { id: string; name: string; size: number; contentType: string; isInline?: boolean; "@odata.type"?: string }[] = [];
let inhalt: Uint8Array = PDF;
const abrufer: typeof fetch = async (eingabe) => {
  const url = new URL(typeof eingabe === "string" ? eingabe : eingabe instanceof URL ? eingabe.toString() : eingabe.url);
  aufrufe.push({ url });
  if (url.origin !== new URL(FAKE_HOSTS.graph).origin) throw new Error(`Unerwarteter Host ${url.origin}`);
  if (url.pathname.endsWith("/$value")) return new Response(Buffer.from(inhalt), { status: 200, headers: { "content-type": "application/octet-stream" } });
  if (url.pathname.endsWith("/attachments")) return new Response(JSON.stringify({ value: anhangListe }), { status: 200, headers: { "content-type": "application/json" } });
  return new Response("{}", { status: 404 });
};

let speicherPfad = "";
let t: ReturnType<typeof erstelleTestApp>;
const aufruf = (methode: string, pfad: string, als: Testperson) => t.request(pfad, { method: methode, als });

async function verbinde(als: Testperson, zugang: Partial<Extract<Zugang, { art: "oauth" }>> = {}) {
  const id = crypto.randomUUID();
  const z: Zugang = { art: "oauth", accessToken: "zugriffstoken", refreshToken: "r", ablaufMs: Date.now() + 3_600_000, adresse: "vera@fonds.example.org", ...zugang };
  await db.insert(s.postfachVerbindung).values({ id, benutzerId: await idVon(db, als), bereich: "mail", anbieter: "microsoft", zugangVerschluesselt: verschluesseleZugang(ring, id, z) });
  return id;
}
async function mail(besitzer: Testperson, extra: Partial<typeof s.aktivitaet.$inferInsert> = {}, sync: Partial<typeof s.aktivitaetSync.$inferInsert> = {}) {
  const [a] = await db.insert(s.aktivitaet).values({ art: "mail", datum: "2026-11-10", titel: "Vertrag anbei", organisationId: ID.orgA, dealId: DEAL, ...extra }).returning();
  await db.insert(s.aktivitaetSync).values({ aktivitaetId: a!.id, benutzerId: await idVon(db, besitzer), anbieter: "microsoft", anbieterId: "graph-msg-1", externHash: externHash("mail", crypto.randomUUID()), beginn: new Date("2026-11-10T09:00:00Z"), personIds: [], richtung: "eingehend", ...sync });
  return a!.id;
}

beforeAll(async () => {
  speicherPfad = await mkdtemp(join(tmpdir(), "carraway-anhaenge-"));
  t = erstelleTestApp(db, { schluessel: ring, postfach: postfachKonfig(), abrufer, speicher: new DateiSpeicher(speicherPfad) });
});
beforeEach(async () => {
  await grundbestand(db);
  await db.insert(s.deal).values({ id: DEAL, organisationId: ID.orgA, titel: "Runde Alpha", fondsId: ID.fonds });
  for (const p of [vera, bernd, betrachterVera]) await legePersonAn(db, p);
  await db.execute(sql`TRUNCATE TABLE postfach_verbindung CASCADE`);
  aufrufe = [];
  inhalt = PDF;
  anhangListe = [
    { id: "att-1", name: "Vertrag.pdf", size: PDF.length, contentType: "application/pdf", "@odata.type": "#microsoft.graph.fileAttachment" },
    { id: "att-2", name: "logo.png", size: 100, contentType: "image/png", isInline: true, "@odata.type": "#microsoft.graph.fileAttachment" },
    { id: "att-3", name: "Weitergeleitet", size: 100, contentType: "message/rfc822", "@odata.type": "#microsoft.graph.itemAttachment" },
  ];
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
  await rm(speicherPfad, { recursive: true, force: true });
});

describe("Anhänge auf Klick", () => {
  it("listet nur echte Dateianhänge (keine Bilder im Text, keine eingebetteten Nachrichten), live beim Anbieter, nur Name, Größe und Typ", async () => {
    await verbinde(vera);
    const id = await mail(vera);
    const r = await aufruf("GET", `/aktivitaeten/${id}/anhaenge`, vera);
    expect(r.status).toBe(200);
    expect(await json(r)).toEqual({ daten: [{ id: "att-1", name: "Vertrag.pdf", groesse: PDF.length, typ: "application/pdf" }] });
    expect(aufrufe.map((a) => a.url.pathname)).toEqual(["/v1.0/me/messages/graph-msg-1/attachments"]);
    expect(aufrufe[0]!.url.searchParams.get("$select")).toBe("id,name,size,contentType,isInline");
  });

  it("übernimmt einen Anhang als vertrauliches Dokument am Deal der Mail; ein zweites Mal meldet 409 DOKUMENT_VORHANDEN", async () => {
    await verbinde(vera);
    const id = await mail(vera);
    const r = await aufruf("POST", `/aktivitaeten/${id}/anhaenge/att-1/importieren`, vera);
    expect(r.status, await r.clone().text()).toBe(201);
    const { dokumentId, dateiname } = await json(r);
    expect(dateiname).toBe("Vertrag.pdf");
    const [d] = await db.select().from(s.dokument).where(eq(s.dokument.id, dokumentId));
    expect(d).toMatchObject({ klassifikation: "sonstiges", vertraulich: true, hochgeladenVon: await idVon(db, vera) });
    const verknuepfungen = await db.select().from(s.dokumentVerknuepfung).where(eq(s.dokumentVerknuepfung.dokumentId, dokumentId));
    expect(verknuepfungen.map((v) => [v.zielTyp, v.zielId])).toEqual([["deal", DEAL]]);
    const protokoll = JSON.stringify((await db.execute(sql`SELECT aktion, nachher FROM aenderung WHERE tabelle = 'aktivitaet' AND aktion = 'anhang_uebernehmen'`)).rows);
    expect(protokoll).toContain(dokumentId);
    expect(protokoll).not.toContain("Vertrag.pdf");
    const nochmal = await aufruf("POST", `/aktivitaeten/${id}/anhaenge/att-1/importieren`, vera);
    expect(nochmal.status).toBe(409);
    expect((await json(nochmal)).fehler.code).toBe("DOKUMENT_VORHANDEN");
  });

  it("ohne Deal hängt das Dokument an der Organisation; die Angaben zum Anhang kommen vom Anbieter, nie vom Aufrufer", async () => {
    await verbinde(vera);
    const id = await mail(vera, { dealId: null });
    const r = await aufruf("POST", `/aktivitaeten/${id}/anhaenge/att-1/importieren`, vera);
    expect(r.status).toBe(201);
    const [v] = await db.select().from(s.dokumentVerknuepfung);
    expect([v!.zielTyp, v!.zielId]).toEqual(["organisation", ID.orgA]);
    // eine ID, die der Anbieter nicht kennt
    const fremd = await aufruf("POST", `/aktivitaeten/${id}/anhaenge/erfunden/importieren`, vera);
    expect(fremd.status).toBe(404);
    expect((await json(fremd)).fehler.code).toBe("ANHANG_NICHT_GEFUNDEN");
  });

  it("nur die Person, deren Postfach die Mail angelegt hat: andere (auch mit Rolle, auch Verwalter) bekommen 403 und der Anbieter wird nicht gefragt", async () => {
    await verbinde(vera);
    const id = await mail(vera);
    for (const als of [bernd, person("an-global", { globalVerwalter: true })]) {
      for (const [methode, pfad] of [["GET", `/aktivitaeten/${id}/anhaenge`], ["POST", `/aktivitaeten/${id}/anhaenge/att-1/importieren`]] as const) {
        const r = await aufruf(methode, pfad, als);
        expect(r.status, `${methode} ${als.name}`).toBe(403);
        expect((await json(r)).fehler.code).toBe("FREMDE_SYNC_AKTIVITAET");
      }
    }
    expect(aufrufe).toHaveLength(0);
  });

  it("Rechte: Betrachter sehen die Liste ihrer eigenen Mails, übernehmen aber nichts (Bearbeiter am Ziel nötig); ohne Anmeldung 401", async () => {
    await verbinde(betrachterVera);
    const id = await mail(betrachterVera);
    expect((await aufruf("GET", `/aktivitaeten/${id}/anhaenge`, betrachterVera)).status).toBe(200);
    expect((await aufruf("POST", `/aktivitaeten/${id}/anhaenge/att-1/importieren`, betrachterVera)).status).toBe(403);
    expect((await t.request(`/aktivitaeten/${id}/anhaenge`, { als: null })).status).toBe(401);
    expect(await db.select().from(s.dokument)).toHaveLength(0);
  });

  it("manuelle Aktivitäten, Termine, IMAP und Mails ohne Anbieter-ID unterstützen keine Anhänge", async () => {
    await verbinde(vera);
    const [manuell] = await db.insert(s.aktivitaet).values({ art: "mail", datum: "2026-11-10", titel: "Von Hand", organisationId: ID.orgA }).returning();
    const a = await aufruf("GET", `/aktivitaeten/${manuell!.id}/anhaenge`, vera);
    expect(a.status).toBe(409);
    expect((await json(a)).fehler.code).toBe("KEINE_SYNC_AKTIVITAET");
    const termin = await mail(vera, { art: "termin" });
    expect((await json(await aufruf("GET", `/aktivitaeten/${termin}/anhaenge`, vera))).fehler.code).toBe("KEINE_SYNC_AKTIVITAET");
    const imap = await mail(vera, {}, { anbieter: "imap" });
    expect((await json(await aufruf("GET", `/aktivitaeten/${imap}/anhaenge`, vera))).fehler.code).toBe("ANHANG_NICHT_UNTERSTUETZT");
    const ohneId = await mail(vera, {}, { anbieterId: null });
    expect((await json(await aufruf("GET", `/aktivitaeten/${ohneId}/anhaenge`, vera))).fehler.code).toBe("ANHANG_NICHT_UNTERSTUETZT");
    expect(aufrufe).toHaveLength(0);
  });

  it("abgelaufenes Zugriffstoken: kein Erneuern aus der Anfrage (das macht allein der Worker), stattdessen wird ein Abgleich angefordert und 409 gemeldet", async () => {
    const vid = await verbinde(vera, { ablaufMs: Date.now() - 1000 });
    await db.update(s.postfachVerbindung).set({ naechsterAbgleichAm: new Date(Date.now() + 3_600_000) });
    const id = await mail(vera);
    const r = await aufruf("GET", `/aktivitaeten/${id}/anhaenge`, vera);
    expect(r.status).toBe(409);
    expect((await json(r)).fehler.code).toBe("POSTFACH_ZUGANG_ABGELAUFEN");
    expect(aufrufe).toHaveLength(0);
    const [v] = await db.select().from(s.postfachVerbindung).where(eq(s.postfachVerbindung.id, vid));
    expect(v!.naechsterAbgleichAm.getTime()).toBeLessThanOrEqual(Date.now());
    // das Token blieb unverändert
    expect(leseZugang(ring, vid, v!.zugangVerschluesselt)).toMatchObject({ accessToken: "zugriffstoken" });
  });

  it("getrenntes Postfach: 404 POSTFACH_NICHT_GEFUNDEN; zu große Anhänge und unzulässige Dateitypen werden abgelehnt, ohne etwas zu speichern", async () => {
    const id = await mail(vera);
    const getrennt = await aufruf("GET", `/aktivitaeten/${id}/anhaenge`, vera);
    expect(getrennt.status).toBe(404);
    expect((await json(getrennt)).fehler.code).toBe("POSTFACH_NICHT_GEFUNDEN");

    await verbinde(vera);
    anhangListe = [{ id: "gross", name: "riesig.pdf", size: 26 * 1024 * 1024, contentType: "application/pdf", "@odata.type": "#microsoft.graph.fileAttachment" }];
    const gross = await aufruf("POST", `/aktivitaeten/${id}/anhaenge/gross/importieren`, vera);
    expect(gross.status).toBe(413);
    expect((await json(gross)).fehler.code).toBe("DOKUMENT_ZU_GROSS");

    anhangListe = [{ id: "exe", name: "programm.exe", size: 10, contentType: "application/octet-stream", "@odata.type": "#microsoft.graph.fileAttachment" }];
    inhalt = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3]);
    const exe = await aufruf("POST", `/aktivitaeten/${id}/anhaenge/exe/importieren`, vera);
    expect(exe.status).toBeGreaterThanOrEqual(400);
    expect(exe.status).toBeLessThan(500);
    expect(await db.select().from(s.dokument)).toHaveLength(0);
  });

  it("Fehler des Anbieters erscheinen als 502 ohne Anbieter-Text", async () => {
    await verbinde(vera);
    const id = await mail(vera);
    const kaputt = erstelleTestApp(db, {
      schluessel: ring,
      postfach: postfachKonfig(),
      abrufer: async () => new Response("Geheimer Fehlertext mit vera@fonds.example.org", { status: 500 }),
      speicher: new DateiSpeicher(speicherPfad),
    });
    const r = await kaputt.request(`/aktivitaeten/${id}/anhaenge`, { als: vera });
    expect(r.status).toBe(502);
    const text = await r.text();
    expect(JSON.parse(text).fehler.code).toBe("POSTFACH_VERBINDUNG_FEHLGESCHLAGEN");
    expect(text).not.toContain("Geheimer");
  });
});
