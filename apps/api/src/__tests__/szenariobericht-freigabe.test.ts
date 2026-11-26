import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { DateiSpeicher } from "../berichte/speicher";
import { heute } from "../schreiben";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, legePersonAn, person, type Testperson, type TestApp } from "./hilfen-auth";
import { grundbestand, ID } from "./hilfen-instrumente";
import { vorgaengeEinfuegen } from "./instrument-hilfen";

/** Szenariobericht über die Berichtsfreigabe: nur festgeschriebene Szenarien, Stufen mit Vier-Augen, unveränderliche Datei. Alle Daten sind erfunden. */

const { db, pool } = oeffneTestdb();
let verzeichnis = "";
let t: TestApp;

const bearbeiter = person("szb-bearbeiter", { rollen: { [ID.fonds]: "bearbeiter" } });
const alsPerson = (als: string | Testperson): Testperson => (typeof als === "string" ? person(als, { globalVerwalter: true }) : als);
const senden = (methode: string) => (pfad: string, koerper?: unknown, als?: string | Testperson) =>
  t.request(pfad, { method: methode, headers: { "content-type": "application/json" }, body: koerper === undefined ? undefined : JSON.stringify(koerper), ...(als ? { als: alsPerson(als) } : {}) });
const get = (pfad: string, als?: string | Testperson) => t.request(pfad, als ? { als: alsPerson(als) } : {});
const post = senden("POST");
const STUFEN = ["Investmentmanager", "Teamleitung", "Geschäftsführung"];
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytesVon = async (antwort: Response) => new Uint8Array(await antwort.arrayBuffer());
async function pdfText(bytes: Uint8Array) {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true });
  return text.replace(/\s+/g, " ");
}

const JAHR = Number(heute().slice(0, 4));
const annahmen = (multiple: string) => ({
  gebuehren: { basis: "zeichnungskapital", satz: "0.02", bisJahr: null, sonstigeJahr: "0" },
  carrySatz: "0",
  beteiligungen: { [ID.eigen]: { ausstieg: { art: "exit", jahr: JAHR + 3, multiple, wahrscheinlichkeit: "1" } } },
});
async function szenario(name: string, multiple: string, festschreiben: boolean) {
  const r = await post(`/fonds/${ID.fonds}/szenarien`, { name, annahmen: annahmen(multiple) }, bearbeiter);
  expect(r.status, await r.clone().text()).toBe(201);
  const id = (await json(r)).id as string;
  if (festschreiben) expect((await post(`/szenarien/${id}/festschreiben`, undefined, "szb-verwalter")).status).toBe(200);
  return id;
}
const anlegen = (szenarioIds: string[], extra: object = {}) => post("/reports", { art: "szenariobericht", fondsId: ID.fonds, sprache: "de", szenarioIds, ...extra }, "szb-autor");
async function freigeben(id: string) {
  let letzte: Response | undefined;
  for (const [i, akteur] of ["szb-a1", "szb-a2", "szb-a3"].entries()) letzte = await post(`/reports/${id}/stage`, { stufe: STUFEN[i], ergebnis: "ok" }, akteur);
  return letzte!;
}

beforeAll(async () => {
  verzeichnis = await mkdtemp(join(tmpdir(), "carraway-szb-"));
  t = erstelleTestApp(db, { speicher: new DateiSpeicher(verzeichnis) });
});
beforeEach(async () => {
  await grundbestand(db);
  await legePersonAn(db, bearbeiter);
  await vorgaengeEinfuegen(db, [
    { beteiligungId: ID.eigen, art: "zusage", valuta: "2025-01-01", betrag: "2000000.00" },
    { beteiligungId: ID.eigen, art: "auszahlung", valuta: "2025-02-01", betrag: "1500000.00" },
  ]);
  await db.insert(s.bewertung).values({ beteiligungId: ID.eigen, stichtag: "2026-06-30", wert: "2500000.00", methode: "sonstige", status: "freigegeben", freigegebenVon: "test", freigegebenAm: new Date() });
  await db.insert(s.fondsBewegung).values({ fondsId: ID.fonds, art: "abruf", valuta: "2025-01-15", betrag: "2500000.00" });
  await db.execute(sql`DELETE FROM snapshot_auftrag`);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
  await rm(verzeichnis, { recursive: true, force: true });
});

describe("Szenariobericht mit Freigabe", () => {
  it("nur festgeschriebene Szenarien dieses Fonds, ein bis drei, jedes nur einmal", async () => {
    const entwurf = await szenario("Entwurfsszenario", "2", false);
    const fest = await szenario("Basis", "2.5", true);
    const abgelehnt = await anlegen([entwurf]);
    expect(abgelehnt.status).toBe(409);
    expect((await json(abgelehnt)).error.code).toBe("scenario_not_locked");
    expect((await anlegen([fest, entwurf])).status).toBe(409);
    expect((await anlegen([])).status).toBe(400);
    expect((await anlegen([fest, fest])).status).toBe(400);
    expect((await anlegen(["00000000-0000-4000-8000-000000000999"])).status).toBe(404);
    expect((await post("/reports", { art: "fondsbericht", fondsId: ID.fonds, sprache: "de", szenarioIds: [fest] }, "szb-autor")).status).toBe(400);
    const { rows } = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM bericht WHERE art = 'szenariobericht'`);
    expect(rows[0]!.n).toBe("0");
  });

  it("Entwurf mit Wasserzeichen, drei Stufen mit anderen Personen, danach unveränderliche Datei mit SHA-256 ohne Wasserzeichen", async () => {
    const a = await szenario("Basis", "2.5", true);
    const b = await szenario("Vorsichtig", "1.5", true);
    const antwort = await anlegen([a, b]);
    expect(antwort.status, await antwort.clone().text()).toBe(201);
    const bericht = await json(antwort);
    expect(bericht).toMatchObject({ art: "szenariobericht", status: "entwurf", format: "pdf" });
    const { rows } = await db.execute<{ parameter: { szenarioIds: string[] }; stichtag: string }>(sql`SELECT parameter, stichtag::text FROM bericht WHERE id = ${bericht.id}`);
    expect(rows[0]!.parameter).toEqual({ szenarioIds: [a, b] });

    const entwurfsDatei = await pdfText(await bytesVon(await get(`/reports/${bericht.id}/file`, "szb-autor")));
    expect(entwurfsDatei).toContain("ENTWURF");
    expect(entwurfsDatei).toContain("Basis");
    expect(entwurfsDatei).toContain("Vorsichtig");

    // der Ersteller gibt nicht frei
    expect((await post(`/reports/${bericht.id}/stage`, { stufe: STUFEN[0], ergebnis: "ok" }, "szb-autor")).status).toBe(409);
    const letzte = await freigeben(bericht.id);
    expect(letzte.status, await letzte.clone().text()).toBe(200);
    const frei = await json(letzte);
    expect(frei).toMatchObject({ status: "freigegeben", naechsteStufe: 3 });
    expect(frei.dateiSha256).toMatch(/^[0-9a-f]{64}$/);
    const datei = await get(`/reports/${bericht.id}/file`, "szb-autor");
    const bytes = await bytesVon(datei);
    expect(sha(bytes)).toBe(frei.dateiSha256);
    expect(datei.headers.get("X-File-Sha256")).toBe(frei.dateiSha256);
    const text = await pdfText(bytes);
    expect(text).not.toContain("ENTWURF");
    expect(text).toContain("Basis");

    // Spätere Änderungen an den Bewegungen des Fonds ändern die freigegebene Datei nicht
    await db.insert(s.fondsBewegung).values({ fondsId: ID.fonds, art: "abruf", valuta: "2026-01-15", betrag: "100000.00" });
    expect(sha(await bytesVon(await get(`/reports/${bericht.id}/file`, "szb-autor")))).toBe(frei.dateiSha256);
    await expect(db.execute(sql`UPDATE bericht SET sprache = 'en' WHERE id = ${bericht.id}`)).rejects.toThrow();
    // protokolliert
    const zeilen = (await db.execute(sql`SELECT aktion FROM aenderung WHERE tabelle = 'bericht' AND datensatz_id = ${bericht.id}`)).rows.map((r) => (r as { aktion: string }).aktion);
    expect(zeilen).toContain("anlegen");
  });

  it("auch als Excel; der Direktabruf eines Entwurfs bleibt mit Wasserzeichen möglich", async () => {
    const a = await szenario("Basis", "2.5", true);
    const antwort = await anlegen([a], { format: "xlsx" });
    expect(antwort.status, await antwort.clone().text()).toBe(201);
    const frei = await json(await freigeben((await json(antwort)).id));
    expect(frei).toMatchObject({ status: "freigegeben", format: "xlsx" });
    const entwurf = await szenario("Noch offen", "2", false);
    const direkt = await get(`/szenarien/${entwurf}/bericht?format=pdf`, "szb-autor");
    expect(direkt.status).toBe(200);
    expect(await pdfText(await bytesVon(direkt))).toContain("ENTWURF");
  });
});
