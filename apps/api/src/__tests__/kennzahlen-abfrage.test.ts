import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { leseZip } from "./hilfen-zip";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, legePersonAn, person, type Testperson } from "./hilfen-auth";
import { grundbestand, ID } from "./hilfen-instrumente";

/** Abfrage bei den Unternehmen: Link ohne Konto, Token, Begrenzung, Protokoll, Prüfung. Alle Daten sind erfunden. */

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
/** App mit kleinen Grenzen für die Tests der Begrenzung. */
const knapp = erstelleTestApp(db, { externLimit: { tokenProMinute: 4, ipProMinute: 1000, fehlgriffeProZehnMinuten: 3 } });

const betrachter = person("ab-betrachter", { rollen: { [ID.fonds]: "betrachter" } });
const bearbeiter = person("ab-bearbeiter", { rollen: { [ID.fonds]: "bearbeiter" } });
const verwalter = person("ab-verwalter", { rollen: { [ID.fonds]: "verwalter" } });
const fremd = person("ab-fremd", { rollen: { [ID.anderer]: "bearbeiter" } });

const B2 = "00000000-0000-4000-8000-0000000000c2"; // Beteiligung im zweiten Fonds

const senden = (app: typeof t, methode: string) => (pfad: string, koerper?: unknown, als?: Testperson | null) =>
  app.request(pfad, { method: methode, headers: { "content-type": "application/json" }, body: koerper === undefined ? undefined : JSON.stringify(koerper), ...(als !== undefined ? { als } : {}) });
const get = (pfad: string, als?: Testperson | null) => t.request(pfad, als !== undefined ? { als } : {});
const post = senden(t, "POST");
const put = senden(t, "PUT");

const Q3 = { periodeBeginn: "2026-07-01", periodeEnde: "2026-09-30" };
const faellig = () => new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
const sha = (x: string) => createHash("sha256").update(x).digest("hex");

beforeEach(async () => {
  await grundbestand(db);
  await db.insert(s.beteiligung).values({ id: B2, fondsId: ID.anderer, organisationId: ID.orgA, instrument: "offene_beteiligung", erstinvestment: "2025-01-01" });
  for (const p of [betrachter, bearbeiter, verwalter, fremd]) await legePersonAn(db, p);
  await db.execute(sql`DELETE FROM abfrage_zugriff`);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

/** Legt eine Anfrage an und gibt Zeile und Token zurück. */
async function neueAbfrage(beteiligungId = ID.eigen, schluessel = ["umsatz", "ebitda", "mitarbeitende_vzae"], extra: object = {}, als = bearbeiter) {
  const antwort = await post(`/beteiligungen/${beteiligungId}/kennzahlen/abfragen`, { ...Q3, faelligAm: faellig(), schluessel, ...extra }, als);
  expect(antwort.status, await antwort.clone().text()).toBe(201);
  const daten = await json(antwort);
  return { abfrage: daten.abfrage as { id: string; status: string; tokenAblauf: string }, token: daten.link.token as string, link: daten.link as { token: string; pfad: string; ablauf: string } };
}
const extern = (token: string) => `/extern/abfragen/${token}`;
const oeffentlich = (pfad: string, methode = "GET", koerper?: unknown, app = t) =>
  app.request(pfad, { method: methode, als: null, ...(koerper !== undefined ? { headers: { "content-type": "application/json" }, body: typeof koerper === "string" ? koerper : JSON.stringify(koerper) } : {}) });

describe("Token", () => {
  it("256 Bit zufällig, nur der SHA-256 steht in der Datenbank, nirgends der Klartext oder der Hash in Antworten", async () => {
    const { abfrage, token, link } = await neueAbfrage();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 Byte als Base64url
    expect(link.pfad).toBe(`/extern/abfrage/${token}`);
    const zeile = (await db.execute(sql`SELECT * FROM kennzahl_abfrage WHERE id = ${abfrage.id}`)).rows[0] as Record<string, unknown>;
    expect(zeile.token_hash).toBe(sha(token));
    expect(Object.values(zeile).some((w) => typeof w === "string" && w.includes(token))).toBe(false);
    // Weder in der Anfrageantwort noch in Liste, Detail, Protokoll, Änderungsabfrage noch im Export steht Hash oder Klartext.
    const alles: string[] = [];
    alles.push(await (await get(`/kennzahlen/abfragen/${abfrage.id}`, betrachter)).text());
    alles.push(await (await get(`/fonds/${ID.fonds}/kennzahlen/abfragen`, betrachter)).text());
    alles.push(await (await get(`/beteiligungen/${ID.eigen}/kennzahlen/abfragen`, betrachter)).text());
    alles.push(await (await get(`/fonds/${ID.fonds}/kennzahlen/uebersicht?periode=2026-Q3`, betrachter)).text());
    alles.push(await (await get(`/aenderungen?limit=1000`, verwalter)).text());
    alles.push(JSON.stringify((await db.execute(sql`SELECT vorher, nachher FROM aenderung`)).rows));
    const ex = await t.request("/export?format=zip", { als: person("ab-global", { globalVerwalter: true }) });
    expect(ex.status).toBe(200);
    const zip = leseZip(new Uint8Array(await ex.arrayBuffer()));
    expect(zip.get("tabellen/kennzahl_abfrage.csv")!.toString("utf8").split("\n")[0]).not.toContain("token_hash");
    for (const [name, inhalt] of zip) if (name.endsWith(".csv") || name.endsWith(".json")) alles.push(inhalt.toString("utf8"));
    for (const text of alles) {
      expect(text).not.toContain(token);
      expect(text).not.toContain(sha(token));
    }
    expect(alles.join("").length).toBeGreaterThan(1000);
  });

  it("Ablauf höchstens 30 Tage (Standard 30), kürzer auf Wunsch, länger ist ungültig", async () => {
    const standard = await neueAbfrage();
    const tage = (Date.parse(standard.abfrage.tokenAblauf) - Date.now()) / 86_400_000;
    expect(tage).toBeGreaterThan(29.9);
    expect(tage).toBeLessThanOrEqual(30);
    const kurz = await neueAbfrage(ID.darlehen, ["umsatz"], { gueltigTage: 2 });
    expect((Date.parse(kurz.abfrage.tokenAblauf) - Date.now()) / 86_400_000).toBeLessThanOrEqual(2);
    const zuLang = await post(`/beteiligungen/${ID.wandel}/kennzahlen/abfragen`, { ...Q3, faelligAm: faellig(), schluessel: ["umsatz"], gueltigTage: 31 }, bearbeiter);
    expect(zuLang.status).toBe(400);
  });

  it("jedes Anlegen und jeder neue Link erzeugt ein anderes Token; je Anfrage gilt nur das letzte", async () => {
    const a = await neueAbfrage();
    const b = await post(`/kennzahlen/abfragen/${a.abfrage.id}/neuer-link`, undefined, bearbeiter);
    expect(b.status).toBe(200);
    const neu = (await json(b)).link.token as string;
    expect(neu).not.toBe(a.token);
    expect((await oeffentlich(extern(a.token))).status).toBe(404);
    expect((await oeffentlich(extern(neu))).status).toBe(200);
    const hashes = (await db.execute(sql`SELECT token_hash FROM kennzahl_abfrage WHERE id = ${a.abfrage.id}`)).rows as { token_hash: string }[];
    expect(hashes).toEqual([{ token_hash: sha(neu) }]);
    expect((await post(`/kennzahlen/abfragen/${a.abfrage.id}/neuer-link`, undefined, betrachter)).status).toBe(403);
  });

  it("widerrufen: der Link antwortet 410, offene Entwürfe sind verworfen, ein zweites Widerrufen ist ein Konflikt", async () => {
    const a = await neueAbfrage();
    expect((await oeffentlich(extern(a.token), "PUT", { werte: [{ schluessel: "umsatz", wert: "5" }] })).status).toBe(200);
    expect((await post(`/kennzahlen/abfragen/${a.abfrage.id}/widerrufen`, undefined, betrachter)).status).toBe(403);
    expect((await post(`/kennzahlen/abfragen/${a.abfrage.id}/widerrufen`, undefined, bearbeiter)).status).toBe(200);
    for (const [methode, pfad, koerper] of [["GET", extern(a.token)], ["PUT", extern(a.token), { werte: [] }], ["POST", `${extern(a.token)}/einreichen`, {}]] as const) {
      const antwort = await oeffentlich(pfad, methode, koerper);
      expect(antwort.status, methode).toBe(410);
      expect((await json(antwort)).fehler.code).toBe("ABFRAGE_WIDERRUFEN");
    }
    expect((await post(`/kennzahlen/abfragen/${a.abfrage.id}/widerrufen`, undefined, bearbeiter)).status).toBe(409);
    expect((await post(`/kennzahlen/abfragen/${a.abfrage.id}/neuer-link`, undefined, bearbeiter)).status).toBe(409);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM kennzahl_wert WHERE abfrage_id = ${a.abfrage.id} AND verworfen_am IS NULL`)).rows[0]).toMatchObject({ n: 0 });
    // nach dem Widerruf lässt sich für denselben Zeitraum eine neue Anfrage stellen
    await neueAbfrage();
  });

  it("abgelaufen: 410, auch zum Lesen", async () => {
    const a = await neueAbfrage();
    await db.execute(sql`UPDATE kennzahl_abfrage SET token_ablauf = now() - interval '1 minute' WHERE id = ${a.abfrage.id}`);
    const antwort = await oeffentlich(extern(a.token));
    expect(antwort.status).toBe(410);
    expect((await json(antwort)).fehler.code).toBe("ABFRAGE_ABGELAUFEN");
    expect((await oeffentlich(extern(a.token), "PUT", { werte: [] })).status).toBe(410);
  });

  it("unbekannt oder in falscher Form: 404 ohne Hinweis", async () => {
    for (const token of ["x", "A".repeat(43), "ä".repeat(43), "A".repeat(200)]) expect((await oeffentlich(extern(encodeURIComponent(token)))).status, token).toBe(404);
  });
});

describe("Öffentliche Seite: Inhalt und Geltungsbereich", () => {
  it("ohne Anmeldung: Unternehmen, Zeitraum, Fälligkeit und angeforderte Kennzahlen in Deutsch und Englisch, nichts sonst", async () => {
    const a = await neueAbfrage(ID.eigen, ["umsatz", "ebitda", "mitarbeitende_vzae"], { hinweis: "Bitte bis zum Fälligkeitstag.", sprache: "en" });
    const antwort = await oeffentlich(extern(a.token));
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("cache-control")).toBe("no-store");
    expect(antwort.headers.get("referrer-policy")).toBe("no-referrer");
    expect(antwort.headers.get("x-robots-tag")).toContain("noindex");
    expect(antwort.headers.get("set-cookie")).toBeNull();
    const d = await json(antwort);
    expect(d).toMatchObject({ unternehmen: "Alpha Beispiel", ...Q3, sprache: "en", hinweis: "Bitte bis zum Fälligkeitstag.", status: "offen", schreibgeschuetzt: false });
    expect(d.kennzahlen.map((k: { schluessel: string }) => k.schluessel)).toEqual(["umsatz", "ebitda", "mitarbeitende_vzae"]);
    expect(d.kennzahlen[0]).toMatchObject({ bezeichnungDe: "Umsatz", bezeichnungEn: "Revenue", einheit: "EUR", typ: "betrag", pflicht: true, wert: null });
    // Keine Kennungen und Fremddaten
    const roh = JSON.stringify(d);
    for (const verboten of [ID.eigen, ID.fonds, "Testfonds", "TF1", a.abfrage.id, "erstelltVon"]) expect(roh).not.toContain(verboten);
    expect(Object.keys(d).sort()).toEqual(["ablauf", "art", "faelligAm", "hinweis", "kennzahlen", "periodeBeginn", "periodeEnde", "schreibgeschuetzt", "sprache", "status", "unternehmen"]);
  });

  it("das Token einer Anfrage öffnet nur diese: andere Unternehmen, Zeiträume und Kennzahlen sind nicht erreichbar", async () => {
    const a = await neueAbfrage(ID.eigen, ["umsatz"]);
    const b = await neueAbfrage(ID.darlehen, ["umsatz", "ebitda"]);
    expect((await json(await oeffentlich(extern(a.token)))).unternehmen).toBe("Alpha Beispiel");
    expect((await json(await oeffentlich(extern(b.token)))).unternehmen).toBe("Beta Beispiel");
    // Angabe einer nicht angeforderten Kennzahl (auch wenn sie in einer anderen Anfrage steht) wird abgelehnt, nichts wird geschrieben.
    const fremdeKennzahl = await oeffentlich(extern(a.token), "PUT", { werte: [{ schluessel: "ebitda", wert: "1" }] });
    expect(fremdeKennzahl.status).toBe(400);
    expect((await json(fremdeKennzahl)).fehler.code).toBe("KENNZAHL_NICHT_ANGEFORDERT");
    // Nicht angegebene Felder wie Beteiligung, Zeitraum, Szenario oder Status lassen sich nicht mitschicken.
    for (const extra of [{ beteiligungId: ID.darlehen }, { periodeBeginn: "2026-01-01" }, { szenario: "plan" }, { status: "bestaetigt" }, { abfrageId: b.abfrage.id }]) {
      const antwort = await oeffentlich(extern(a.token), "PUT", { werte: [{ schluessel: "umsatz", wert: "1", ...extra }] });
      expect(antwort.status, JSON.stringify(extra)).toBe(400);
    }
    expect((await oeffentlich(extern(a.token), "PUT", { werte: [], beteiligungId: ID.darlehen })).status).toBe(400);
    expect((await oeffentlich(extern(a.token), "PUT", { werte: [{ schluessel: "umsatz", wert: "1" }, { schluessel: "umsatz", wert: "2" }] })).status).toBe(400);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM kennzahl_wert`)).rows[0]).toMatchObject({ n: 0 });
    // Gespeichert wird immer unter dem Unternehmen, dem Zeitraum und dem Szenario der eigenen Anfrage.
    expect((await oeffentlich(extern(a.token), "PUT", { werte: [{ schluessel: "umsatz", wert: "7.50" }] })).status).toBe(200);
    expect((await db.execute(sql`SELECT beteiligung_id, periode_beginn::text AS b, periode_ende::text AS e, szenario, quelle, status, abfrage_id FROM kennzahl_wert`)).rows).toEqual([
      { beteiligung_id: ID.eigen, b: "2026-07-01", e: "2026-09-30", szenario: "ist", quelle: "unternehmen", status: "entwurf", abfrage_id: a.abfrage.id },
    ]);
    expect((await json(await oeffentlich(extern(b.token)))).kennzahlen.every((k: { wert: string | null }) => k.wert === null)).toBe(true);
  });

  it("andere Pfade und Methoden: ohne Token-Pfad keine Ausgabe, interne Wege verlangen weiter eine Anmeldung", async () => {
    const a = await neueAbfrage();
    for (const [methode, pfad] of [["GET", `/beteiligungen/${ID.eigen}/kennzahlen`], ["GET", "/fonds"], ["POST", `/kennzahlen/abfragen/${a.abfrage.id}/bestaetigen`], ["POST", `/kennzahlen/abfragen/${a.abfrage.id}/widerrufen`], ["POST", `/kennzahlen/abfragen/${a.abfrage.id}/neuer-link`], ["GET", `/kennzahlen/abfragen/${a.abfrage.id}`], ["PATCH", "/kennzahlen/werte/00000000-0000-4000-8000-000000000001"], ["POST", "/kennzahlen/werte/00000000-0000-4000-8000-000000000001/bestaetigen"]] as const) {
      const antwort = await t.request(pfad, { method: methode, als: null, ...(methode !== "GET" ? { headers: { "content-type": "application/json" }, body: "{}" } : {}) });
      expect(antwort.status, `${methode} ${pfad}`).toBe(401);
    }
    expect((await oeffentlich(`${extern(a.token)}/nebenan`)).status).toBe(401); // nicht in der Berechtigungstabelle
    expect((await oeffentlich(extern(a.token), "DELETE")).status).toBe(401);
    // Ein mitgesendetes Anmeldecookie ändert nichts am Zugriff: der Link wirkt immer ohne Konto.
    const mitCookie = await t.request(extern(a.token), { als: verwalter });
    expect(mitCookie.status).toBe(200);
    expect(Object.keys(await json(mitCookie))).not.toContain("fondsId");
  });
});

describe("Entwurf, Einreichen, danach nur lesbar, Protokoll", () => {
  it("speichern, ändern, leeren; die Werte kommen in der Antwort und beim erneuten Öffnen zurück", async () => {
    const a = await neueAbfrage();
    const erst = await oeffentlich(extern(a.token), "PUT", { werte: [{ schluessel: "umsatz", wert: "125000.50", kommentar: "ohne Sonderposten" }, { schluessel: "ebitda", wert: "-4000" }] });
    expect(erst.status).toBe(200);
    expect((await json(erst)).kennzahlen.map((k: { wert: string | null; kommentar: string | null }) => [k.wert, k.kommentar])).toEqual([["125000.5", "ohne Sonderposten"], ["-4000", null], [null, null]]);
    await oeffentlich(extern(a.token), "PUT", { werte: [{ schluessel: "umsatz", wert: "126000" }, { schluessel: "ebitda", wert: null }] });
    const d = await json(await oeffentlich(extern(a.token)));
    expect(d.kennzahlen.map((k: { wert: string | null }) => k.wert)).toEqual(["126000", null, null]);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM kennzahl_wert WHERE abfrage_id = ${a.abfrage.id} AND verworfen_am IS NULL`)).rows[0]).toMatchObject({ n: 1 });
  });

  it("jeder Wert wird nach seinem Typ geprüft (kein Dezimalkomma, keine Exponenten, Ja/Nein, Text)", async () => {
    const a = await neueAbfrage(ID.eigen, ["umsatz", "mitarbeitende_vzae", "esg_verstoesse_ungc"], { periodeBeginn: "2026-01-01", periodeEnde: "2026-12-31" });
    const speichere = (schluessel: string, wert: string) => oeffentlich(extern(a.token), "PUT", { werte: [{ schluessel, wert }] });
    for (const [k, w] of [["umsatz", "12,5"], ["umsatz", "1e3"], ["umsatz", "1.234"], ["umsatz", "NaN"], ["mitarbeitende_vzae", "-"], ["esg_verstoesse_ungc", "Ja"], ["umsatz", "x".repeat(2001)]] as const) {
      const antwort = await speichere(k, w);
      expect(antwort.status, `${k}=${w.slice(0, 10)}`).toBe(400);
    }
    expect((await speichere("umsatz", "1234567.89")).status).toBe(200);
    expect((await speichere("mitarbeitende_vzae", "12.5")).status).toBe(200);
    expect((await speichere("esg_verstoesse_ungc", "nein")).status).toBe(200);
  });

  it("einreichen verlangt alle Pflichtkennzahlen; danach ist der Link nur lesbar, im Protokoll steht extern:<id>", async () => {
    const a = await neueAbfrage(); // Pflicht: umsatz, ebitda, mitarbeitende_vzae
    const leer = await oeffentlich(`${extern(a.token)}/einreichen`, "POST", {});
    expect(leer.status).toBe(400);
    expect((await json(leer)).fehler.code).toBe("KENNZAHL_PFLICHT_FEHLT");
    await oeffentlich(extern(a.token), "PUT", { werte: [{ schluessel: "umsatz", wert: "100" }, { schluessel: "mitarbeitende_vzae", wert: "12" }] });
    const fehlt = await oeffentlich(`${extern(a.token)}/einreichen`, "POST", {});
    expect(fehlt.status).toBe(400);
    expect((await json(fehlt)).fehler.fehlend).toEqual(["ebitda"]);
    await oeffentlich(extern(a.token), "PUT", { werte: [{ schluessel: "ebitda", wert: "-5" }] });
    const ok = await oeffentlich(`${extern(a.token)}/einreichen`, "POST", {});
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ status: "eingereicht", schreibgeschuetzt: true });

    // nur noch lesbar
    const nachher = await oeffentlich(extern(a.token));
    expect(nachher.status).toBe(200);
    expect((await json(nachher)).kennzahlen.map((k: { wert: string }) => k.wert)).toEqual(["100", "-5", "12"]);
    for (const [methode, pfad, koerper] of [["PUT", extern(a.token), { werte: [{ schluessel: "umsatz", wert: "999" }] }], ["POST", `${extern(a.token)}/einreichen`, {}]] as const) {
      const antwort = await oeffentlich(pfad, methode, koerper);
      expect(antwort.status, methode).toBe(409);
      expect((await json(antwort)).fehler.code).toBe("ABFRAGE_EINGEREICHT");
    }
    expect((await db.execute(sql`SELECT wert FROM kennzahl_wert WHERE abfrage_id = ${a.abfrage.id} ORDER BY wert`)).rows.map((r) => (r as { wert: string }).wert)).toEqual(["-5", "100", "12"]);
    expect((await db.execute(sql`SELECT status::text AS s FROM kennzahl_abfrage WHERE id = ${a.abfrage.id}`)).rows[0]).toMatchObject({ s: "eingereicht" });

    // Protokoll: jeder externe Schreibzugriff mit dem Akteur extern:<Anfrage-ID>, nie als Benutzer
    const zeilen = (await db.execute(sql`SELECT akteur, akteur_name, aktion, tabelle, fonds_id FROM aenderung WHERE akteur LIKE 'extern:%' ORDER BY am, id`)).rows as { akteur: string; akteur_name: string | null; aktion: string; tabelle: string; fonds_id: string }[];
    expect(zeilen).toHaveLength(7); // 3 Entwürfe, 3 Einreichungen der Werte, 1 der Anfrage
    expect(zeilen.every((z) => z.akteur === `extern:${a.abfrage.id}` && z.akteur_name === null)).toBe(true);
    expect(zeilen.every((z) => z.fonds_id === ID.fonds)).toBe(true);
    expect(zeilen.map((z) => `${z.tabelle}:${z.aktion}`)).toEqual(expect.arrayContaining(["kennzahl_wert:anlegen", "kennzahl_wert:aendern".replace("aendern", "einreichen"), "kennzahl_abfrage:einreichen"]));
    // alle Schreibzugriffe über den Link sind protokolliert: Zeilen mit anderem Akteur an diesen Werten gibt es nur von den internen Prüfenden (hier keine)
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM aenderung WHERE tabelle = 'kennzahl_wert' AND akteur NOT LIKE 'extern:%'`)).rows[0]).toMatchObject({ n: 0 });
  });

  it("zu große oder falsche Körper: 413, 400, ohne Schreibzugriff", async () => {
    const a = await neueAbfrage();
    const riesig = await oeffentlich(extern(a.token), "PUT", JSON.stringify({ werte: [{ schluessel: "umsatz", wert: "1", kommentar: "x".repeat(70_000) }] }));
    expect(riesig.status).toBe(413);
    expect((await json(riesig)).fehler.code).toBe("ANFRAGE_ZU_GROSS");
    expect((await oeffentlich(extern(a.token), "PUT", "{kaputt")).status).toBe(400);
    expect((await oeffentlich(extern(a.token), "PUT", { werte: "nein" })).status).toBe(400);
    expect((await oeffentlich(extern(a.token), "PUT", { werte: [{ schluessel: "umsatz", wert: 5 }] })).status).toBe(400);
    expect((await oeffentlich(extern(a.token), "PUT", { werte: [{ schluessel: "umsatz", wert: "1", kommentar: "k".repeat(1001) }] })).status).toBe(400);
    expect((await oeffentlich(extern(a.token), "PUT", { werte: Array.from({ length: 101 }, () => ({ schluessel: "umsatz", wert: "1" })) })).status).toBe(400);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM kennzahl_wert`)).rows[0]).toMatchObject({ n: 0 });
  });
});

describe("Prüfung durch das Haus", () => {
  async function eingereicht() {
    const a = await neueAbfrage();
    await oeffentlich(extern(a.token), "PUT", { werte: [{ schluessel: "umsatz", wert: "100" }, { schluessel: "ebitda", wert: "-5" }, { schluessel: "mitarbeitende_vzae", wert: "12" }] });
    expect((await oeffentlich(`${extern(a.token)}/einreichen`, "POST", {})).status).toBe(200);
    return a;
  }

  it("ein Entwurf des Unternehmens lässt sich nicht bestätigen, ein eingereichter durch Bearbeiter; Betrachter und fremde Fonds nicht", async () => {
    const a = await neueAbfrage();
    await oeffentlich(extern(a.token), "PUT", { werte: [{ schluessel: "umsatz", wert: "100" }] });
    const [wert] = (await db.execute(sql`SELECT id FROM kennzahl_wert WHERE abfrage_id = ${a.abfrage.id}`)).rows as { id: string }[];
    const frueh = await post(`/kennzahlen/werte/${wert!.id}/bestaetigen`, undefined, bearbeiter);
    expect(frueh.status).toBe(409);
    expect((await json(frueh)).fehler.code).toBe("KENNZAHL_WERT_NICHT_EINGEREICHT");
    await oeffentlich(extern(a.token), "PUT", { werte: [{ schluessel: "ebitda", wert: "1" }, { schluessel: "mitarbeitende_vzae", wert: "1" }] });
    await oeffentlich(`${extern(a.token)}/einreichen`, "POST", {});
    expect((await post(`/kennzahlen/werte/${wert!.id}/bestaetigen`, undefined, betrachter)).status).toBe(403);
    expect((await post(`/kennzahlen/werte/${wert!.id}/bestaetigen`, undefined, fremd)).status).toBe(403);
    const ok = await post(`/kennzahlen/werte/${wert!.id}/bestaetigen`, undefined, bearbeiter);
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ status: "bestaetigt", quelle: "unternehmen" });
    const z = (await db.execute(sql`SELECT bestaetigt_von, erfasst_von FROM kennzahl_wert WHERE id = ${wert!.id}`)).rows[0] as { bestaetigt_von: string; erfasst_von: string };
    expect(z.bestaetigt_von).not.toMatch(/^extern:/);
    expect(z.erfasst_von).toBe(`extern:${a.abfrage.id}`);
  });

  it("alle Werte der Anfrage bestätigen: Status bestätigt, Werte zählen in der Zeitreihe und mit Abweichung gegen den Plan", async () => {
    const a = await eingereicht();
    const plan = await post(`/beteiligungen/${ID.eigen}/kennzahlen/werte`, { schluessel: "umsatz", szenario: "plan", wert: "80", ...Q3 }, bearbeiter);
    await post(`/kennzahlen/werte/${(await json(plan)).id}/bestaetigen`, undefined, bearbeiter);
    expect((await post(`/kennzahlen/abfragen/${a.abfrage.id}/bestaetigen`, undefined, betrachter)).status).toBe(403);
    const ok = await post(`/kennzahlen/abfragen/${a.abfrage.id}/bestaetigen`, undefined, bearbeiter);
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ status: "bestaetigt" });
    expect((await post(`/kennzahlen/abfragen/${a.abfrage.id}/bestaetigen`, undefined, bearbeiter)).status).toBe(409);
    const reihe = await json(await get(`/beteiligungen/${ID.eigen}/kennzahlen?von=2026-01-01&bis=2026-12-31`, betrachter));
    const umsatz = reihe.kennzahlen.find((k: { schluessel: string }) => k.schluessel === "umsatz");
    expect(umsatz.punkte[0]).toMatchObject({ ist: { wert: "100", quelle: "unternehmen" }, plan: { wert: "80" }, abweichung: { absolut: "20", prozent: "25.00" } });
    expect(reihe.offen).toEqual([]);
    // Der Link bleibt nach der Bestätigung lesbar und schreibgeschützt
    expect(await json(await oeffentlich(extern(a.token)))).toMatchObject({ status: "eingereicht", schreibgeschuetzt: true });
    const uebersicht = await json(await get(`/fonds/${ID.fonds}/kennzahlen/uebersicht?periode=2026-Q3`, betrachter));
    expect(uebersicht.unternehmen.find((u: { beteiligungId: string }) => u.beteiligungId === ID.eigen).abfrage).toMatchObject({ id: a.abfrage.id, status: "bestaetigt" });
  });

  it("einzelne Werte bestätigen oder verwerfen; sind alle erledigt, gilt die Anfrage als bestätigt", async () => {
    const a = await eingereicht();
    const ids = ((await db.execute(sql`SELECT id FROM kennzahl_wert WHERE abfrage_id = ${a.abfrage.id} ORDER BY wert`)).rows as { id: string }[]).map((r) => r.id);
    expect((await post(`/kennzahlen/werte/${ids[0]}/bestaetigen`, undefined, bearbeiter)).status).toBe(200);
    expect((await post(`/kennzahlen/werte/${ids[1]}/verwerfen`, undefined, bearbeiter)).status).toBe(200);
    expect((await json(await get(`/kennzahlen/abfragen/${a.abfrage.id}`, betrachter))).abfrage.status).toBe("eingereicht");
    expect((await post(`/kennzahlen/werte/${ids[2]}/bestaetigen`, undefined, bearbeiter)).status).toBe(200);
    const detail = await json(await get(`/kennzahlen/abfragen/${a.abfrage.id}`, betrachter));
    expect(detail.abfrage.status).toBe("bestaetigt");
    expect(detail.organisation).toBe("Alpha Beispiel");
    expect(detail.kennzahlen.filter((k: { wert: { status: string } | null }) => k.wert?.status === "bestaetigt")).toHaveLength(2);
    expect(detail.kennzahlen.filter((k: { wert: unknown }) => k.wert === null)).toHaveLength(1);
  });
});

describe("Anlegen der Anfrage", () => {
  it("Rechte, Standardauswahl des Fonds, Zeitraum, Fälligkeit, doppelte laufende Anfrage, fremder Fonds", async () => {
    const koerper = { ...Q3, faelligAm: faellig() };
    expect((await post(`/beteiligungen/${ID.eigen}/kennzahlen/abfragen`, { ...koerper, schluessel: ["umsatz"] }, betrachter)).status).toBe(403);
    expect((await post(`/beteiligungen/${ID.eigen}/kennzahlen/abfragen`, { ...koerper, schluessel: ["umsatz"] }, fremd)).status).toBe(403);
    // ohne Auswahl im Fonds und ohne Angabe: Fehler
    const ohne = await post(`/beteiligungen/${ID.eigen}/kennzahlen/abfragen`, koerper, bearbeiter);
    expect((await json(ohne)).fehler.code).toBe("ABFRAGE_OHNE_KENNZAHLEN");
    await put(`/fonds/${ID.fonds}/kennzahlen/auswahl`, { schluessel: ["liquiditaet", "umsatz", "esg_thg_scope1"] }, verwalter);
    // Ausdrücklich genannt, passt die Jahreskennzahl nicht zu einem Quartal ...
    expect((await json(await post(`/beteiligungen/${ID.eigen}/kennzahlen/abfragen`, { ...koerper, schluessel: ["esg_thg_scope1"] }, bearbeiter))).fehler.code).toBe("KENNZAHL_PERIODE_ZU_FEIN");
    // ... und ohne Angabe wird sie aus der Auswahl des Fonds ausgelassen (wie in der Übersicht)
    const ok = await post(`/beteiligungen/${ID.eigen}/kennzahlen/abfragen`, koerper, bearbeiter);
    expect(ok.status).toBe(201);
    const id = (await json(ok)).abfrage.id;
    expect((await json(await get(`/kennzahlen/abfragen/${id}`, betrachter))).kennzahlen.map((k: { schluessel: string }) => k.schluessel)).toEqual(["umsatz", "liquiditaet"]);
    // Auswahl nur mit Jahreskennzahlen: für ein Quartal gibt es nichts anzufragen
    await put(`/fonds/${ID.fonds}/kennzahlen/auswahl`, { schluessel: ["esg_thg_scope1"] }, verwalter);
    const leer = await post(`/beteiligungen/${ID.darlehen}/kennzahlen/abfragen`, koerper, bearbeiter);
    expect(leer.status).toBe(400);
    expect((await json(leer)).fehler.code).toBe("ABFRAGE_OHNE_KENNZAHLEN");
    await put(`/fonds/${ID.fonds}/kennzahlen/auswahl`, { schluessel: ["liquiditaet", "umsatz", "esg_thg_scope1"] }, verwalter);
    const doppelt = await post(`/beteiligungen/${ID.eigen}/kennzahlen/abfragen`, koerper, bearbeiter);
    expect(doppelt.status).toBe(409);
    expect((await json(doppelt)).fehler).toMatchObject({ code: "ABFRAGE_VORHANDEN", abfrageId: id });
    expect((await post(`/beteiligungen/${ID.eigen}/kennzahlen/abfragen`, { ...koerper, periodeBeginn: "2026-07-01", periodeEnde: "2026-08-31", schluessel: ["umsatz"] }, bearbeiter)).status).toBe(400);
    expect((await post(`/beteiligungen/${ID.eigen}/kennzahlen/abfragen`, { ...koerper, faelligAm: "2020-01-01", schluessel: ["umsatz"] }, bearbeiter)).status).toBe(400);
    expect((await post(`/beteiligungen/${ID.eigen}/kennzahlen/abfragen`, { ...koerper, periodeBeginn: "2026-10-01", periodeEnde: "2026-12-31", schluessel: ["umsatz", "umsatz"] }, bearbeiter)).status).toBe(400);
    expect((await post(`/beteiligungen/${ID.eigen}/kennzahlen/abfragen`, { ...koerper, periodeBeginn: "2026-10-01", periodeEnde: "2026-12-31", schluessel: ["gibt_es_nicht"] }, bearbeiter)).status).toBe(404);
    expect((await post(`/beteiligungen/00000000-0000-4000-8000-0000000000ff/kennzahlen/abfragen`, { ...koerper, schluessel: ["umsatz"] }, verwalter)).status).toBe(404);
  });

  it("Liste je Fonds mit Status je Unternehmen und Erinnerungen (überfällig, bald)", async () => {
    const a = await neueAbfrage(ID.eigen, ["umsatz"]);
    const b = await neueAbfrage(ID.darlehen, ["umsatz"], { faelligAm: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10) });
    const c = await neueAbfrage(ID.wandel, ["umsatz"]);
    await db.execute(sql`UPDATE kennzahl_abfrage SET faellig_am = '2020-01-01' WHERE id = ${c.abfrage.id}`);
    const liste = (await json(await get(`/fonds/${ID.fonds}/kennzahlen/abfragen`, betrachter))).daten as { id: string; organisation: string; status: string; erinnerung: string | null; anzahlKennzahlen: number }[];
    expect(liste).toHaveLength(3);
    expect(liste.find((x) => x.id === a.abfrage.id)).toMatchObject({ organisation: "Alpha Beispiel", status: "offen", erinnerung: null, anzahlKennzahlen: 1 });
    expect(liste.find((x) => x.id === b.abfrage.id)!.erinnerung).toBe("bald");
    expect(liste.find((x) => x.id === c.abfrage.id)!.erinnerung).toBe("ueberfaellig");
    expect((await get(`/fonds/${ID.fonds}/kennzahlen/abfragen`, fremd)).status).toBe(403);
    const nurOffen = (await json(await get(`/fonds/${ID.fonds}/kennzahlen/abfragen?status=eingereicht`, betrachter))).daten;
    expect(nurOffen).toEqual([]);
    expect((await json(await get(`/beteiligungen/${ID.eigen}/kennzahlen/abfragen`, betrachter))).daten).toHaveLength(1);
  });
});

describe("Begrenzung der öffentlichen Wege", () => {
  it("je Token: die fünfte Anfrage in der Minute ist 429 mit Retry-After, ein anderes Token ist davon unberührt", async () => {
    const a = await neueAbfrage();
    const b = await neueAbfrage(ID.darlehen, ["umsatz"]);
    for (let i = 0; i < 4; i++) expect((await oeffentlich(extern(a.token), "GET", undefined, knapp)).status).toBe(200);
    const zuViel = await oeffentlich(extern(a.token), "GET", undefined, knapp);
    expect(zuViel.status).toBe(429);
    expect(zuViel.headers.get("retry-after")).toBe("60");
    expect((await json(zuViel)).fehler.code).toBe("ZU_VIELE_ANFRAGEN");
    expect((await oeffentlich(extern(b.token), "GET", undefined, knapp)).status).toBe(200);
    // schreibende Wege zählen mit
    expect((await oeffentlich(extern(a.token), "PUT", { werte: [] }, knapp)).status).toBe(429);
    // die Zähler halten nur Schlüssel, nie das Token
    const zeilen = (await db.execute(sql`SELECT schluessel FROM abfrage_zugriff`)).rows as { schluessel: string }[];
    expect(zeilen.some((z) => z.schluessel.includes(a.token))).toBe(false);
    expect(zeilen.some((z) => z.schluessel === `token:${sha(a.token).slice(0, 16)}`)).toBe(true);
  });

  it("je IP: unbekannte Token zählen als Fehlgriff, nach drei ist auch ein gültiges Token gesperrt", async () => {
    const a = await neueAbfrage();
    for (let i = 0; i < 3; i++) expect((await oeffentlich(extern(`${"A".repeat(42)}${i}`), "GET", undefined, knapp)).status).toBe(404);
    const gesperrt = await oeffentlich(extern(a.token), "GET", undefined, knapp);
    expect(gesperrt.status).toBe(429);
    expect((await json(gesperrt)).fehler.code).toBe("ZU_VIELE_ANFRAGEN");
    // Die normale App (Standardgrenzen) bleibt für diese IP-Zähler erreichbar: die Grenze gilt je Konfiguration, die Zähler sind gemeinsam.
    await db.execute(sql`DELETE FROM abfrage_zugriff`);
    expect((await oeffentlich(extern(a.token), "GET", undefined, knapp)).status).toBe(200);
  });

  it("je IP: die Anfragen je Minute sind begrenzt, die IP kommt hinter einem Proxy aus X-Forwarded-For", async () => {
    const proxy = erstelleTestApp(db, { proxyVertrauen: true, externLimit: { tokenProMinute: 100, ipProMinute: 3, fehlgriffeProZehnMinuten: 100 } });
    const a = await neueAbfrage();
    const mitIp = (ip: string) => proxy.request(extern(a.token), { als: null, headers: { "x-forwarded-for": ip } });
    for (let i = 0; i < 3; i++) expect((await mitIp("203.0.113.7")).status).toBe(200);
    expect((await mitIp("203.0.113.7")).status).toBe(429);
    expect((await mitIp("203.0.113.8")).status).toBe(200);
  });
});
