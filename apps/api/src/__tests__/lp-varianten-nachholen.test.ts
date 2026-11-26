import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { DateiSpeicher, sha256 as sha256Hex } from "../berichte/speicher";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, legePersonAn, person, type TestApp } from "./hilfen-auth";

/**
 * Fassungen je Investor für LP-Berichte, die vor den Fassungen freigegeben wurden (Verwaltungsaktion): aus den Daten des festgehaltenen
 * Wissensstands, unveränderlich gespeichert, protokolliert, wiederholbar. Alle Daten sind erfunden.
 */

const { db, pool } = oeffneTestdb();
let verzeichnis = "";
let speicher: DateiSpeicher;
let t: TestApp;

const admin = person("nach-admin", { globalVerwalter: true });
const bearbeiter = person("nach-bearbeiter");
const STUFEN = ["Investmentmanager", "Teamleitung", "Geschäftsführung"];
const senden = (methode: string) => (pfad: string, koerper?: unknown, als?: string | ReturnType<typeof person>) =>
  t.request(pfad, { method: methode, headers: { "content-type": "application/json" }, body: koerper === undefined ? undefined : JSON.stringify(koerper), ...(als ? { als: typeof als === "string" ? person(als, { globalVerwalter: true }) : als } : {}) });
const post = senden("POST");

async function pdfText(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  return (await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true })).text.replace(/\s+/g, " ").trim();
}

let fondsId = "";
let orgA = "";
let orgB = "";
const NAME_A = "Alpha Investor Beispiel";
const NAME_B = "Beta Investor Beispiel";

beforeAll(async () => {
  verzeichnis = await mkdtemp(join(tmpdir(), "carraway-nachholen-"));
  speicher = new DateiSpeicher(verzeichnis);
  t = erstelleTestApp(db, { speicher });
});
beforeEach(async () => {
  await leeren(db);
  for (const p of [admin, bearbeiter]) await legePersonAn(db, p);
  orgA = randomUUID();
  orgB = randomUUID();
  await db.insert(s.organisation).values([
    { id: orgA, name: NAME_A, art: "investor" },
    { id: orgB, name: NAME_B, art: "investor" },
  ]);
  [fondsId] = (await db.insert(s.fonds).values({ name: "Nachholfonds", kurzname: "NHF", vintage: 2024, zeichnungskapital: "1000000.00" }).returning({ id: s.fonds.id })).map((f) => f.id) as [string];
  await db.insert(s.fondsZeichnung).values([
    { fondsId, organisationId: orgA, zusage: "600000.00", anteil: "0.600000" },
    { fondsId, organisationId: orgB, zusage: "400000.00", anteil: "0.400000" },
  ]);
  await db.insert(s.fondsBewegung).values([
    { fondsId, art: "abruf", valuta: "2026-01-15", betrag: "100000.01" },
    { fondsId, art: "ausschuettung", valuta: "2026-02-15", betrag: "20000.00" },
  ]);
  await db.execute(sql`DELETE FROM snapshot_auftrag`);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
  await rm(verzeichnis, { recursive: true, force: true });
});

async function lpFreigeben(): Promise<string> {
  const neu = await json(await post("/berichte", { art: "lp_bericht", fondsId, stichtag: "2026-03-01", sprache: "de" }, "nach-autor"));
  let letzte: Response | undefined;
  for (const [i, k] of ["n1", "n2", "n3"].entries()) letzte = await post(`/berichte/${neu.id}/stufe`, { stufe: STUFEN[i], ergebnis: "ok", ...(i === 2 ? { kontrolleUeberschreiben: { grund: "Test ohne Bewertungen" } } : {}) }, k);
  expect(letzte!.status, await letzte!.clone().text()).toBe(200);
  return neu.id;
}
/** Simuliert einen Bericht aus der Zeit vor den Fassungen: Die Fassungen (nur anhängend, Trigger) werden mit ausgeschaltetem Trigger entfernt. */
async function alsAltBericht(berichtId: string) {
  const vorher = await db.select().from(s.berichtVariante).where(eq(s.berichtVariante.berichtId, berichtId));
  await db.execute(sql`ALTER TABLE bericht_variante DISABLE TRIGGER bericht_variante_kein_update_delete`);
  try {
    await db.execute(sql`DELETE FROM bericht_variante WHERE bericht_id = ${berichtId}`);
  } finally {
    await db.execute(sql`ALTER TABLE bericht_variante ENABLE TRIGGER bericht_variante_kein_update_delete`);
  }
  return vorher;
}
const nachholen = (als = admin, koerper: object = {}) => post("/berichte/varianten-nachholen", koerper, als);
const fassungenVon = (berichtId: string) => db.select().from(s.berichtVariante).where(eq(s.berichtVariante.berichtId, berichtId));

describe("Fassungen für früher freigegebene LP-Berichte nachholen", () => {
  it("nur globale Verwalter; Bearbeiter und Fremde werden abgewiesen", async () => {
    expect((await nachholen(bearbeiter)).status).toBe(403);
    expect((await t.request("/berichte/varianten-nachholen", { method: "POST", als: null })).status).toBe(401);
  });

  it("legt je Zeichnung eine Fassung mit dem Konto des Investors an, gleich der ursprünglich ausgelieferten, ohne fremde Konten; protokolliert; wiederholbar", async () => {
    const berichtId = await lpFreigeben();
    const ursprung = await alsAltBericht(berichtId);
    expect(ursprung).toHaveLength(2);
    expect(await fassungenVon(berichtId)).toHaveLength(0);

    const antwort = await nachholen();
    expect(antwort.status, await antwort.clone().text()).toBe(200);
    expect(await json(antwort)).toEqual({ geprueft: 1, angelegt: [{ berichtId, varianten: 2 }], uebersprungen: [] });

    const neu = await fassungenVon(berichtId);
    expect(neu.map((v) => v.organisationId).sort()).toEqual([orgA, orgB].sort());
    for (const v of neu) {
      // unveränderlich gespeichert: Schlüssel mit Hash, Bytes passen zum Hash, Datenbank sperrt Änderungen
      expect(v.dateiSchluessel).toBe(`berichte/${berichtId}/varianten/${v.organisationId}/${v.dateiSha256}.pdf`);
      const bytes = await speicher.lese(v.dateiSchluessel);
      expect(sha256Hex(bytes)).toBe(v.dateiSha256);
      const text = await pdfText(bytes);
      const eigen = v.organisationId === orgA ? NAME_A : NAME_B;
      const fremd = v.organisationId === orgA ? NAME_B : NAME_A;
      expect(text).toContain(eigen);
      expect(text).not.toContain(fremd);
      // gleich der ursprünglich ausgelieferten Fassung dieses Investors (eingefrorene Verteilung)
      const alt = ursprung.find((u) => u.organisationId === v.organisationId)!;
      expect(text).toBe(await pdfText(await speicher.lese(alt.dateiSchluessel)));
    }
    expect(await db.execute(sql`UPDATE bericht_variante SET datei_name = 'x' WHERE bericht_id = ${berichtId}`).catch((e: { cause?: { code?: string } }) => e.cause?.code)).toBe("23001");
    const protokoll = await db.select().from(s.aenderung).where(and(eq(s.aenderung.tabelle, "bericht_variante"), eq(s.aenderung.aktion, "variante_nachholen"), eq(s.aenderung.fondsId, fondsId)));
    expect(protokoll).toHaveLength(2);
    expect(protokoll.every((z) => z.akteur !== "system")).toBe(true);

    // zweiter Lauf: nichts mehr zu tun, nichts neu, nichts verändert
    const vorherHashes = neu.map((v) => v.dateiSha256).sort();
    expect(await json(await nachholen())).toEqual({ geprueft: 0, angelegt: [], uebersprungen: [] });
    expect((await fassungenVon(berichtId)).map((v) => v.dateiSha256).sort()).toEqual(vorherHashes);
    expect(await db.select().from(s.aenderung).where(and(eq(s.aenderung.tabelle, "bericht_variante"), eq(s.aenderung.aktion, "variante_nachholen")))).toHaveLength(2);
  });

  it("haben sich die Daten seit der Freigabe geändert, entstehen keine Fassungen aus dem Heute: der Bericht wird als nicht reproduzierbar gemeldet", async () => {
    const berichtId = await lpFreigeben();
    const ursprung = await alsAltBericht(berichtId);
    // Nach der Freigabe kommen eine Bewegung und eine neue Zeichnung dazu
    await db.insert(s.fondsBewegung).values({ fondsId, art: "abruf", valuta: "2026-01-20", betrag: "77777.77" });
    const orgC = randomUUID();
    await db.insert(s.organisation).values({ id: orgC, name: "Gamma Investor Beispiel", art: "investor" });
    await db.insert(s.fondsZeichnung).values({ fondsId, organisationId: orgC, zusage: "100000.00", anteil: "0.100000" });

    // Die heutigen Daten ergeben eine andere Hauptdatei als die gespeicherte: Es entsteht nichts (kein Rechnen aus dem Heute), der Bericht wird gemeldet.
    const erg = await json(await nachholen());
    expect(erg).toEqual({ geprueft: 1, angelegt: [], uebersprungen: [{ berichtId, grund: "nicht_reproduzierbar" }] });
    expect(await fassungenVon(berichtId)).toHaveLength(0);
    expect(ursprung).toHaveLength(2);
  });

  it("eine veränderte oder fehlende Hauptdatei verhindert die Fassungen; Berichte ohne Kapitalkonten und Entwürfe bleiben unberührt", async () => {
    const berichtId = await lpFreigeben();
    await alsAltBericht(berichtId);
    const [b] = await db.select().from(s.bericht).where(eq(s.bericht.id, berichtId));
    await speicher.loesche!(b!.dateiSchluessel!);
    expect(await json(await nachholen())).toEqual({ geprueft: 1, angelegt: [], uebersprungen: [{ berichtId, grund: "datei_fehlt" }] });
    expect(await fassungenVon(berichtId)).toHaveLength(0);
    // Entwurf eines LP-Berichts: wird nicht angefasst
    await post("/berichte", { art: "lp_bericht", fondsId, stichtag: "2026-03-01", sprache: "de" }, "nach-autor");
    expect((await json(await nachholen())).geprueft).toBe(1);
  });
});
