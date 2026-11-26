import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erzeugeIcs } from "../routen/kalender";
import { heute } from "../schreiben";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, idVon, legeInvestorAn, legePersonAn, person, type Testperson } from "./hilfen-auth";
import { grundbestand, ID } from "./hilfen-instrumente";

/** Kalenderabonnement (ICS) der Wiedervorlagen: Token wie bei den Links der Kennzahlen-Abfrage (nur Hash, widerrufbar), Inhalt nur für die eigene Person. */

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const knapp = erstelleTestApp(db, { externLimit: { tokenProMinute: 3, ipProMinute: 1000, fehlgriffeProZehnMinuten: 3 } });

const anna = person("ics-anna", { rollen: { [ID.fonds]: "bearbeiter" } });
const bernd = person("ics-bernd", { rollen: { [ID.fonds]: "bearbeiter" } });
const investor = person("ics-investor");
const sha = (x: string) => createHash("sha256").update(x).digest("hex");
const tag = (n: number) => {
  const d = new Date(`${heute()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const link = async (als: Testperson) => {
  const antwort = await t.request("/einstellungen/kalender-link", { method: "POST", als });
  expect(antwort.status).toBe(201);
  return (await json(antwort)) as { token: string; pfad: string; url: string };
};
const ics = (token: string, app = t) => app.request(`/api/v1/kalender/${token}.ics`);
const wiedervorlage = (titel: string, benutzerId: string, zusatz: Partial<typeof s.aktivitaet.$inferInsert> = {}) =>
  db.insert(s.aktivitaet).values({ art: "notiz", datum: tag(-3), titel, organisationId: ID.orgA, wiedervorlage: tag(2), zustaendig: benutzerId, ...zusatz }).returning();

beforeEach(async () => {
  await grundbestand(db);
  for (const p of [anna, bernd]) await legePersonAn(db, p);
  await legeInvestorAn(db, investor, [ID.orgA]);
  await db.execute(sql`TRUNCATE TABLE abfrage_zugriff, kalender_token`);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Token", () => {
  it("256 Bit zufällig, nur der Hash in der Datenbank, nirgends im Protokoll; ein neuer Link ersetzt den alten", async () => {
    const a = await link(anna);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.pfad).toBe(`/api/v1/kalender/${a.token}.ics`);
    expect(a.url).toBe(`http://localhost:5173${a.pfad}`);
    const zeilen = (await db.execute(sql`SELECT * FROM kalender_token`)).rows as Record<string, unknown>[];
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!.token_hash).toBe(sha(a.token));
    expect(JSON.stringify(zeilen)).not.toContain(a.token);
    const protokoll = JSON.stringify((await db.execute(sql`SELECT * FROM aenderung WHERE tabelle = 'kalender_token'`)).rows);
    expect(protokoll).not.toContain(a.token);
    expect(protokoll).not.toContain(sha(a.token));
    const status = await json(await t.request("/einstellungen/kalender-link", { als: anna }));
    expect(status).toMatchObject({ aktiv: true, letzterZugriffAm: null });
    expect(JSON.stringify(status)).not.toContain(a.token);

    const b = await link(anna);
    expect(b.token).not.toBe(a.token);
    expect((await ics(a.token)).status).toBe(404);
    expect((await ics(b.token)).status).toBe(200);
    expect((await db.select().from(s.kalenderToken)).filter((z) => z.widerrufenAm === null)).toHaveLength(1);
  });

  it("widerrufen: sofort 404; ohne Link meldet der Status `aktiv: false`", async () => {
    const a = await link(anna);
    expect((await ics(a.token)).status).toBe(200);
    expect((await t.request("/einstellungen/kalender-link", { method: "DELETE", als: anna })).status).toBe(204);
    expect((await ics(a.token)).status).toBe(404);
    expect(await json(await t.request("/einstellungen/kalender-link", { als: anna }))).toMatchObject({ aktiv: false });
    expect((await t.request("/einstellungen/kalender-link", { method: "DELETE", als: anna })).status).toBe(204); // idempotent
  });

  it("jede Person verwaltet nur ihren eigenen Link; Investor-Benutzer und fremde Abrufe haben keinen Zugriff", async () => {
    const a = await link(anna);
    expect(await json(await t.request("/einstellungen/kalender-link", { als: bernd }))).toMatchObject({ aktiv: false });
    await t.request("/einstellungen/kalender-link", { method: "DELETE", als: bernd });
    expect((await ics(a.token)).status).toBe(200); // Berndes Widerruf trifft Annas Link nicht
    const inv = await t.request("/einstellungen/kalender-link", { method: "POST", als: investor });
    expect(inv.status).toBe(403);
    expect((await json(inv)).fehler.code).toBe("NUR_PORTAL");
  });
});

describe("Inhalt", () => {
  it("nur die offenen Wiedervorlagen der Person, als ganztägige Termine mit stabiler UID; nichts von anderen Personen oder Erledigtes", async () => {
    const annaId = await idVon(db, anna);
    const berndId = await idVon(db, bernd);
    const [meins] = await wiedervorlage("Nachfragen, wegen Runde; ernst", annaId);
    await wiedervorlage("Erledigt", annaId, { wiedervorlageErledigtAm: new Date() });
    await wiedervorlage("Gehört Bernd", berndId);
    await wiedervorlage("Ohne Wiedervorlage", annaId, { wiedervorlage: null, zustaendig: null });
    const a = await link(anna);
    const antwort = await ics(a.token);
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(antwort.headers.get("cache-control")).toBe("no-store");
    expect(antwort.headers.get("referrer-policy")).toBe("no-referrer");
    expect(antwort.headers.get("x-robots-tag")).toContain("noindex");
    const text = await antwort.text();
    expect(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    const tagOhne = tag(2).replaceAll("-", "");
    expect(text).toContain(`UID:wiedervorlage-${meins!.id}@carraway`);
    expect(text).toContain(`DTSTART;VALUE=DATE:${tagOhne}`);
    expect(text).toContain("SUMMARY:Wiedervorlage: Nachfragen\\, wegen Runde\\; ernst");
    expect(text).toContain("DESCRIPTION:Alpha Beispiel");
    expect(text).not.toMatch(/Gehört Bernd|Erledigt|Ohne Wiedervorlage/);
    // der Abruf wird festgehalten
    expect(await json(await t.request("/einstellungen/kalender-link", { als: anna }))).toMatchObject({ aktiv: true });
    expect((await db.select().from(s.kalenderToken))[0]!.letzterZugriffAm).toBeInstanceOf(Date);
  });

  it("Deals fremder Fonds erscheinen nicht, und eine verlorene Rolle leert den Kalender bei jedem Abruf neu", async () => {
    const annaId = await idVon(db, anna);
    const [dealAnderer] = await db.insert(s.deal).values({ organisationId: ID.orgB, titel: "Runde im anderen Fonds", fondsId: ID.anderer }).returning();
    const [dealEigen] = await db.insert(s.deal).values({ organisationId: ID.orgC, titel: "Runde im eigenen Fonds", fondsId: ID.fonds }).returning();
    await wiedervorlage("Zum fremden Deal", annaId, { dealId: dealAnderer!.id, organisationId: null });
    await wiedervorlage("Zum eigenen Deal", annaId, { dealId: dealEigen!.id, organisationId: null });
    const a = await link(anna);
    const text = await (await ics(a.token)).text();
    expect(text).toContain("Zum eigenen Deal");
    expect(text).not.toContain("Zum fremden Deal");
    expect(text).toContain("DESCRIPTION:Gamma Beispiel – Runde im eigenen Fonds");
    // Rolle entzogen: Der nächste Abruf zeigt nichts mehr (kein zwischengespeicherter Zustand).
    await db.delete(s.fondsrolle).where(eq(s.fondsrolle.benutzerId, annaId));
    expect((await (await ics(a.token)).text()).match(/BEGIN:VEVENT/g)).toBeNull();
  });

  it("gesperrte Personen und Personen, die inzwischen Investor-Benutzer sind, bekommen 404; der Link selbst bleibt gespeichert", async () => {
    const wechsler = person("ics-wechsler", { rollen: { [ID.fonds]: "bearbeiter" } });
    await legePersonAn(db, wechsler);
    const a = await link(wechsler);
    const id = await idVon(db, wechsler);
    await db.update(s.benutzer).set({ aktiv: false }).where(eq(s.benutzer.id, id));
    expect((await ics(a.token)).status).toBe(404);
    await db.update(s.benutzer).set({ aktiv: true }).where(eq(s.benutzer.id, id));
    expect((await ics(a.token)).status).toBe(200);
    await db.execute(sql`DELETE FROM fondsrolle WHERE benutzer_id = ${id}`);
    await db.insert(s.investorBenutzer).values({ benutzerId: id, erstelltVon: "test" });
    expect((await ics(a.token)).status).toBe(404);
    await db.execute(sql`DELETE FROM investor_benutzer WHERE benutzer_id = ${id}`);
  });

  it("erzeugeIcs: Zeilen über 75 Oktette werden gefaltet (auch bei Umlauten), Zeilenenden CRLF, Sonderzeichen maskiert", () => {
    const text = erzeugeIcs([{ id: "1", titel: "Ä".repeat(80) + ", Komma; Semikolon\nZeile", tag: "2026-03-05", beschreibung: "" }], new Date("2026-03-01T10:00:00Z"));
    const zeilen = text.split("\r\n");
    for (const z of zeilen) expect(Buffer.byteLength(z)).toBeLessThanOrEqual(75);
    expect(text).not.toMatch(/[^\r]\n/);
    const entfaltet = text.replace(/\r\n /g, "");
    expect(entfaltet).toContain("\\, Komma\\; Semikolon\\nZeile");
    expect(entfaltet).toContain("DTSTAMP:20260301T100000Z");
    expect(entfaltet).toContain("DTEND;VALUE=DATE:20260306");
    expect(entfaltet).not.toContain("DESCRIPTION:");
  });
});

describe("Begrenzung und Fehlgriffe", () => {
  it("falsche Form oder unbekanntes Token: 404 (nie 401), Fehlgriffe zählen, danach 429 mit Retry-After; öffentlich ohne Cookie", async () => {
    const falsch = ["kurz", `${"A".repeat(43)}`, `${"A".repeat(43)}.txt`, `${"A".repeat(44)}.ics`];
    const antworten: Response[] = [];
    for (const f of falsch.slice(0, 3)) antworten.push(await knapp.app.request(`/api/v1/kalender/${f}`));
    expect(antworten.map((a) => a.status)).toEqual([404, 404, 404]);
    expect((await json(antworten[0]!)).fehler.code).toBe("NICHT_GEFUNDEN");
    const gesperrt = await knapp.app.request(`/api/v1/kalender/${falsch[3]}`);
    expect(gesperrt.status).toBe(429);
    expect(gesperrt.headers.get("retry-after")).toBe("60");
    expect((await json(gesperrt)).fehler.code).toBe("ZU_VIELE_ANFRAGEN");
  });

  it("je Token höchstens so viele Abrufe pro Minute wie konfiguriert", async () => {
    const a = await link(anna);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await ics(a.token, knapp)).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
  });

  it("der Abruf braucht keine Anmeldung und nimmt kein Cookie an: ein fremdes Cookie ändert nichts", async () => {
    const a = await link(anna);
    const antwort = await t.app.request(`/api/v1/kalender/${a.token}.ics`, { headers: { cookie: "better-auth.session_token=egal" } });
    expect(antwort.status).toBe(200);
  });
});
