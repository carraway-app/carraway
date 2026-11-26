import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { DEMO_ZUGAENGE, entferneDemoZugaenge, erzeugeDemodaten, schreibeDemoZugaenge, schreibeDemodaten, zugangsdokument } from "@carraway/db/demo";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { cookieKopf, erstelleTestApp, idVon, jsonKopf, STANDARD, totpCode } from "./hilfen-auth";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);

let fondsId = "";
let beteiligungId = "";

beforeAll(async () => {
  await schreibeDemodaten(db, erzeugeDemodaten({ seed: 1 }));
  const { daten } = await json(await t.request("/fonds"));
  fondsId = daten[0].id;
  const uebersicht = await json(await t.request(`/fonds/${fondsId}/uebersicht`));
  beteiligungId = uebersicht.beteiligungen.find((b: { status: string }) => b.status === "aktiv").id;
  await db.execute(sql`DELETE FROM aenderung`);
});
afterAll(async () => {
  await entferneDemoZugaenge(db);
  await leeren(db);
  await pool.end();
});

const gelesen = async () =>
  (await db.execute(sql`SELECT akteur, akteur_name, tabelle, datensatz_id, vorher, nachher FROM aenderung WHERE aktion = 'gelesen' ORDER BY am, id`)).rows as {
    akteur: string;
    akteur_name: string | null;
    tabelle: string;
    datensatz_id: string;
    vorher: unknown;
    nachher: Record<string, unknown>;
  }[];

describe("Lese-Protokoll für Berichtsdownloads und Exporte", () => {
  it("jeder Download schreibt eine Zeile mit Aktion gelesen: wer, wann, was", async () => {
    const stand = (await db.execute(sql`SELECT count(*)::int AS n FROM aenderung`)).rows[0] as { n: number };
    const downloads: [string, string, string, Record<string, unknown>][] = [
      [`/fonds/${fondsId}/berichte/fondsbericht?format=pdf&sprache=en`, "fonds", fondsId, { bericht: "fondsbericht", format: "pdf", sprache: "en" }],
      [`/fonds/${fondsId}/berichte/fondsbericht?format=xlsx`, "fonds", fondsId, { bericht: "fondsbericht", format: "xlsx", sprache: "de" }],
      [`/fonds/${fondsId}/berichte/portfolioliste`, "fonds", fondsId, { bericht: "portfolioliste", format: "xlsx" }],
      [`/beteiligungen/${beteiligungId}/berichte/quartalsbericht`, "beteiligung", beteiligungId, { bericht: "quartalsbericht", format: "pdf" }],
      [`/berichte/gremienvorlage`, "bericht", "00000000-0000-0000-0000-000000000000", { bericht: "gremienvorlage", format: "pdf" }],
    ];
    for (const [pfad] of downloads) expect((await t.request(pfad)).status, pfad).toBe(200);
    const zeilen = await gelesen();
    expect(zeilen).toHaveLength(downloads.length);
    zeilen.forEach((z, i) => {
      const [, tabelle, datensatz, was] = downloads[i]!;
      expect(z).toMatchObject({ tabelle, datensatz_id: datensatz, vorher: null, nachher: expect.objectContaining(was) });
    });
    const id = await idVon(db, STANDARD);
    expect(zeilen.every((z) => z.akteur === id && z.akteur_name === STANDARD.name)).toBe(true);
    expect(zeilen[0]!.nachher.stichtag).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM aenderung`)).rows[0]).toEqual({ n: stand.n + downloads.length });
  });

  it("gewöhnliche Lesezugriffe und fehlgeschlagene Downloads schreiben nichts", async () => {
    const vorher = (await gelesen()).length;
    expect((await t.request(`/fonds/${fondsId}/uebersicht`)).status).toBe(200);
    expect((await t.request(`/beteiligungen/${beteiligungId}`)).status).toBe(200);
    expect((await t.request(`/fonds/00000000-0000-4000-8000-0000000000ff/berichte/fondsbericht`)).status).toBe(404);
    expect((await t.request(`/fonds/${fondsId}/berichte/fondsbericht?format=odt`)).status).toBe(400);
    expect((await gelesen()).length).toBe(vorher);
  });

  it("ein verweigerter Download (fehlende Rolle) wird nicht als gelesen protokolliert", async () => {
    const vorher = (await gelesen()).length;
    const antwort = await t.request(`/fonds/${fondsId}/berichte/fondsbericht`, { als: { name: "Ohne Rolle", email: "ohne-rolle-protokoll@test.example" } });
    expect(antwort.status).toBe(403);
    expect((await gelesen()).length).toBe(vorher);
  });

  it("das Protokoll bleibt anhängend: gelesen-Zeilen lassen sich weder ändern noch löschen", async () => {
    await expect(db.execute(sql`UPDATE aenderung SET aktion = 'anlegen' WHERE aktion = 'gelesen'`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM aenderung WHERE aktion = 'gelesen'`)).rejects.toThrow();
  });
});

describe("Demo-Zugänge und Seed", () => {
  const anmelden = async (z: Pick<(typeof DEMO_ZUGAENGE)[number], "email" | "passwort" | "totpGeheimnis">) => {
    const anmeldung = await t.app.request("/api/v1/auth/sign-in/email", { method: "POST", headers: jsonKopf(), body: JSON.stringify({ email: z.email, password: z.passwort }) });
    expect(anmeldung.status, z.email).toBe(200);
    const code = await t.app.request("/api/v1/auth/two-factor/verify-totp", {
      method: "POST",
      headers: jsonKopf(cookieKopf(anmeldung.headers.getSetCookie())),
      body: JSON.stringify({ code: totpCode(z.totpGeheimnis) }),
    });
    expect(code.status, `${z.email} TOTP`).toBe(200);
    return cookieKopf(code.headers.getSetCookie());
  };
  const rufe = (cookie: string, methode: string, pfad: string) =>
    t.app.request(`/api/v1${pfad}`, { method: methode, headers: jsonKopf(cookie), ...(methode === "GET" ? {} : { body: "{}" }) });

  it("alle Zugänge aus demo-zugaenge.md melden sich mit Passwort und TOTP-Code an und haben die beschriebenen Rechte", async () => {
    const fonds = (await db.select({ id: s.fonds.id }).from(s.fonds).orderBy(s.fonds.vintage, s.fonds.name)).map((f) => f.id);
    await schreibeDemoZugaenge(db, fonds);
    const cookies = new Map<string, string>();
    for (const z of DEMO_ZUGAENGE) cookies.set(z.email, await anmelden(z));
    const von = (kuerzel: string) => cookies.get(`${kuerzel}@beispiel.example`)!;

    expect((await json(await rufe(von("vera"), "GET", "/fonds"))).daten).toHaveLength(fonds.length);
    expect((await json(await rufe(von("bernd"), "GET", "/fonds"))).daten.map((f: { id: string }) => f.id)).toEqual([fonds[0]]);
    expect((await rufe(von("bernd"), "GET", `/fonds/${fonds[1]}/uebersicht`)).status).toBe(403);
    expect((await rufe(von("berta"), "POST", `/fonds/${fonds[0]}/neuberechnen`)).status).toBe(202);
    expect((await rufe(von("berta"), "GET", `/fonds/${fonds[0]}/periodensperre`)).status).toBe(403);
    expect((await rufe(von("vera"), "GET", `/fonds/${fonds[0]}/periodensperre`)).status).toBe(200);
    expect((await json(await rufe(von("vera"), "GET", "/ich"))).globalVerwalter).toBe(true);
    // Beispielgruppen (Rechtemodell): Rita nur Kontakte, Carl Controlling des ersten Fonds plus Ausnahme am zweiten.
    expect((await rufe(von("rita"), "GET", "/organisationen")).status).toBe(200);
    expect((await rufe(von("rita"), "GET", `/fonds/${fonds[0]}/uebersicht`)).status).toBe(403);
    expect((await json(await rufe(von("rita"), "GET", "/ich"))).bereiche).toEqual(["kontakte"]);
    expect((await rufe(von("carl"), "GET", `/fonds/${fonds[0]}/journal`)).status).toBe(200);
    expect((await rufe(von("carl"), "GET", `/fonds/${fonds[1]}/uebersicht`)).status).toBe(200);
    expect((await rufe(von("carl"), "POST", `/fonds/${fonds[1]}/neuberechnen`)).status).toBe(403);
    expect((await rufe(von("carl"), "GET", "/organisationen")).status).toBe(403);

    // Der Vier-Augen-Ablauf aus der Anleitung: Frieda prüft, Frieda darf nicht freigeben, Friedrich gibt frei.
    const [lauf] = await db.insert(s.zinslauf).values({ fondsId: fonds[0]!, stichtag: "2026-12-31", berechnetVon: "demo" }).returning();
    expect((await rufe(von("berta"), "POST", `/zinslaeufe/${lauf!.id}/pruefen`)).status).toBe(403);
    expect((await rufe(von("frieda"), "POST", `/zinslaeufe/${lauf!.id}/pruefen`)).status).toBe(200);
    const selbe = await rufe(von("frieda"), "POST", `/zinslaeufe/${lauf!.id}/freigeben`);
    expect(selbe.status).toBe(409);
    expect((await json(selbe)).fehler.code).toBe("VIER_AUGEN_VERLETZT");
    expect((await rufe(von("friedrich"), "POST", `/zinslaeufe/${lauf!.id}/freigeben`)).status).toBe(200);
  });

  it("jeder Wiederherstellungscode aus der Datei funktioniert genau einmal", async () => {
    const z = DEMO_ZUGAENGE[0]!;
    const code = z.wiederherstellungscodes[0]!;
    const zwischen = async () => cookieKopf((await t.app.request("/api/v1/auth/sign-in/email", { method: "POST", headers: jsonKopf(), body: JSON.stringify({ email: z.email, password: z.passwort }) })).headers.getSetCookie());
    const einsetzen = async () => (await t.app.request("/api/v1/auth/two-factor/verify-backup-code", { method: "POST", headers: jsonKopf(await zwischen()), body: JSON.stringify({ code }) })).status;
    expect(await einsetzen()).toBe(200);
    expect(await einsetzen()).toBe(401);
  });

  it("demo-zugaenge.md entspricht dem, was das Seed-Skript schreibt, und trägt den Hinweis auf die lokale Entwicklung", () => {
    const datei = readFileSync(fileURLToPath(new URL("../../../../packages/db/demo-zugaenge.md", import.meta.url)), "utf8");
    expect(datei).toBe(zugangsdokument());
    expect(datei).toMatch(/Nur für die lokale Entwicklung/);
    expect(datei).toMatch(/erfunden/);
  });

  it("das Seed-Skript lehnt CARRAWAY_UMGEBUNG=echt ab, bevor es die Datenbank anfasst", () => {
    expect(() => s.pruefeSeedErlaubt("echt")).toThrow(/Seed abgelehnt/);
    for (const erlaubt of ["demo", "test", undefined]) expect(() => s.pruefeSeedErlaubt(erlaubt)).not.toThrow();

    const ergebnis = spawnSync("pnpm", ["exec", "tsx", "scripts/seed.ts"], {
      cwd: fileURLToPath(new URL("../../../../packages/db", import.meta.url)),
      env: { ...process.env, CARRAWAY_UMGEBUNG: "echt", DATABASE_URL: "postgres://carraway:carraway@localhost:5432/carraway_gibt_es_nicht" },
      encoding: "utf8",
    });
    expect(ergebnis.status).not.toBe(0);
    expect(ergebnis.stderr).toContain("Seed abgelehnt");
    expect(ergebnis.stderr).not.toMatch(/ECONNREFUSED|does not exist/); // die Verbindung wurde gar nicht erst versucht
  });
});

