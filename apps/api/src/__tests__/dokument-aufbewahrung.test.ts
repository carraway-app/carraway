import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { DateiSpeicher, type Speicher } from "../berichte/speicher";
import { ausstehendeLoeschungen, loescheAbgelaufeneDokumente } from "../dokumente/aufbewahrung";
import { bereiteVor, legeDokumentAn } from "../dokumente/speichern";
import { ladeAufbewahrungTage, KonfigurationsFehler } from "../konfiguration";
import { schreibe } from "../schreiben";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, legePersonAn, person, type TestApp, type Testperson } from "./hilfen-auth";
import { erzeugePdf, legeWeltAn, type Welt } from "./hilfen-dokumente";

/**
 * Aufbewahrung gelöschter Dokumente: Frist (`DOKUMENT_AUFBEWAHRUNG_TAGE`, Standard 30), Entfernen der Datei durch den Worker, geteilte Dateien bleiben,
 * solange eine aktive oder noch nicht abgelaufene Zeile, eine Fundstelle, ein Registerauszug oder ein Beleg sie braucht. Alle Daten sind erfunden.
 */

const { db, pool } = oeffneTestdb();
let verzeichnis = "";
let speicher: DateiSpeicher;
let t: TestApp;
let w: Welt;

const BEARB1 = person("auf-bearb1");
const VERWALTER1 = person("auf-verw1");
const ADMIN = person("auf-admin", { globalVerwalter: true });

beforeAll(async () => {
  verzeichnis = await mkdtemp(join(tmpdir(), "carraway-aufbewahrung-"));
  speicher = new DateiSpeicher(verzeichnis);
  t = erstelleTestApp(db, { speicher });
});
beforeEach(async () => {
  await leeren(db);
  w = await legeWeltAn(db);
  Object.assign(BEARB1, { rollen: { [w.fonds1]: "bearbeiter" } });
  Object.assign(VERWALTER1, { rollen: { [w.fonds1]: "verwalter" } });
  for (const p of [BEARB1, VERWALTER1, ADMIN]) await legePersonAn(db, p);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
  await rm(verzeichnis, { recursive: true, force: true });
});

const TAG = 86_400_000;
/** Zeitquelle in der Zukunft: so viele Tage nach jetzt. */
const nach = (tage: number) => () => new Date(Date.now() + tage * TAG);
const lauf = (tage: number, extra: { speicher?: Speicher; seite?: number; max?: number } = {}) =>
  loescheAbgelaufeneDokumente(db, extra.speicher ?? speicher, { tage: 30, jetzt: nach(tage), ...(extra.seite ? { seite: extra.seite } : {}), ...(extra.max ? { max: extra.max } : {}) });
const existiert = (schluessel: string) => access(join(verzeichnis, schluessel)).then(() => true, () => false);

function hochladen(bytes: Uint8Array, name: string, als: Testperson = BEARB1) {
  const f = new FormData();
  f.append("datei", new File([new Uint8Array(bytes)], name));
  f.append("ziele", JSON.stringify([{ typ: "beteiligung", id: w.beteiligung1 }]));
  return t.request("/documents", { method: "POST", body: f, als });
}
async function lege(name = "vertrag.pdf") {
  const pdf = erzeugePdf([`Aufbewahrung ${Math.random().toString(36).slice(2)}`, "Zweite Seite mit Text."]);
  const antwort = await hochladen(pdf, name);
  expect(antwort.status, await antwort.clone().text()).toBe(201);
  const d = (await json(antwort)) as { id: string };
  const [zeile] = await db.select().from(s.dokument).where(eq(s.dokument.id, d.id));
  return { id: d.id, schluessel: zeile!.gespeichertUnter, hash: zeile!.sha256, pdf };
}
const loescheWeich = async (id: string) => expect((await t.request(`/documents/${id}`, { method: "DELETE", als: VERWALTER1 })).status).toBe(204);
const zeile = async (id: string) => (await db.select().from(s.dokument).where(eq(s.dokument.id, id)))[0]!;
/** Eine zweite Zeile, die dieselbe Datei teilt (gleiche Bytes ergeben denselben Schlüssel). */
async function teileDatei(d: { id: string }, status: "aktiv" | "geloescht" = "aktiv", geloeschtVorTagen = 0) {
  const quelle = await zeile(d.id);
  const [neu] = await db
    .insert(s.dokument)
    .values({
      sha256: quelle.sha256,
      dateiname: "kopie.pdf",
      mime: quelle.mime,
      groesse: quelle.groesse,
      gespeichertUnter: quelle.gespeichertUnter,
      hochgeladenVon: "test",
      status,
      ...(status === "geloescht" ? { geloeschtAm: new Date(Date.now() - geloeschtVorTagen * TAG), geloeschtVon: "test" } : {}),
    })
    .returning();
  await db.insert(s.dokumentVerknuepfung).values({ dokumentId: neu!.id, zielTyp: "beteiligung", zielId: w.beteiligung1, erstelltVon: "test" });
  return neu!;
}

describe("Einstellung", () => {
  it("DOKUMENT_AUFBEWAHRUNG_TAGE: Standard 30, ganze Zahl von 1 bis 3650", () => {
    expect(ladeAufbewahrungTage({})).toBe(30);
    expect(ladeAufbewahrungTage({ DOKUMENT_AUFBEWAHRUNG_TAGE: "90" })).toBe(90);
    for (const falsch of ["0", "-3", "2.5", "abc", "4000"]) expect(() => ladeAufbewahrungTage({ DOKUMENT_AUFBEWAHRUNG_TAGE: falsch })).toThrow(KonfigurationsFehler);
  });
});

describe("Ablage", () => {
  it("loesche entfernt die Datei, ein fehlender Schlüssel ist kein Fehler, ein ungültiger wird abgelehnt", async () => {
    await speicher.schreibe("dokumente/ab/test-loeschen", new TextEncoder().encode("x"));
    await speicher.loesche("dokumente/ab/test-loeschen");
    expect(await existiert("dokumente/ab/test-loeschen")).toBe(false);
    await speicher.loesche("dokumente/ab/test-loeschen");
    await expect(speicher.loesche("../ausserhalb")).rejects.toThrow();
  });
});

describe("Aufbewahrungslauf", () => {
  it("vor Ablauf der Frist bleibt die Datei; danach entfernt der Lauf sie, die Metadaten bleiben, der Seitentext geht", async () => {
    const d = await lege();
    await loescheWeich(d.id);
    expect(await lauf(29)).toEqual({ geloescht: 0, dokumente: 0, gehalten: 0 });
    expect(await existiert(d.schluessel)).toBe(true);

    expect(await lauf(31)).toEqual({ geloescht: 1, dokumente: 1, gehalten: 0 });
    expect(await existiert(d.schluessel)).toBe(false);
    const z = await zeile(d.id);
    expect(z.status).toBe("endgueltig_geloescht");
    expect(z.endgueltigGeloeschtAm).not.toBeNull();
    expect(z.dateiname).toBe("vertrag.pdf");
    expect(z.sha256).toBe(d.hash);
    expect(await db.select().from(s.dokumentSeite).where(eq(s.dokumentSeite.dokumentId, d.id))).toHaveLength(0);
    // Protokoll: Anlegen, weiches Löschen, endgültiges Löschen mit Hash, aber ohne Inhalt
    const aktionen = await db.select().from(s.aenderung).where(sql`${s.aenderung.tabelle} = 'dokument' AND ${s.aenderung.datensatzId} = ${d.id}`).orderBy(s.aenderung.am, s.aenderung.id);
    expect(aktionen.map((a) => a.aktion)).toEqual(["anlegen", "loeschen", "endgueltig_loeschen"]);
    expect(aktionen[2]!.nachher).toMatchObject({ status: "endgueltig_geloescht", sha256: d.hash });
    // ein zweiter Lauf ändert nichts
    expect(await lauf(40)).toEqual({ geloescht: 0, dokumente: 0, gehalten: 0 });
  });

  it("Zugriff danach: Download 410, nur Verwalter sehen das Dokument, weiteres Löschen ändert nichts", async () => {
    const d = await lege();
    await loescheWeich(d.id);
    await lauf(31);
    const datei = await t.request(`/documents/${d.id}/file`, { als: ADMIN });
    expect(datei.status).toBe(410);
    expect((await json(datei)).error.code).toBe("document_permanently_deleted");
    expect((await t.request(`/documents/${d.id}`, { als: BEARB1 })).status).toBe(404);
    expect((await t.request(`/documents/${d.id}/file`, { als: BEARB1 })).status).toBe(404);
    const liste = await json(await t.request("/documents?status=endgueltig_geloescht", { als: VERWALTER1 }));
    expect(liste.daten.map((x: { id: string }) => x.id)).toEqual([d.id]);
    expect(liste.daten[0].endgueltigGeloeschtAm).toBeTruthy();
    expect((await json(await t.request("/documents?status=endgueltig_geloescht", { als: BEARB1 }))).daten).toEqual([]);
    expect((await t.request(`/documents/${d.id}`, { method: "DELETE", als: VERWALTER1 })).status).toBe(204);
    expect((await zeile(d.id)).status).toBe("endgueltig_geloescht");
  });

  it("eine geteilte Datei bleibt, solange eine aktive oder noch nicht abgelaufene Zeile sie braucht, und fällt mit der letzten weg", async () => {
    const d = await lege();
    const kopie = await teileDatei(d, "aktiv");
    await loescheWeich(d.id);
    // Die erste Zeile ist seit 40 Tagen gelöscht, die Kopie ist aber noch aktiv.
    await db.update(s.dokument).set({ geloeschtAm: new Date(Date.now() - 40 * TAG) }).where(eq(s.dokument.id, d.id));
    expect(await lauf(0)).toEqual({ geloescht: 0, dokumente: 0, gehalten: 1 });
    expect(await existiert(d.schluessel)).toBe(true);
    expect((await zeile(d.id)).status).toBe("geloescht");
    // die aktive Kopie ist weiter lesbar
    expect((await t.request(`/documents/${kopie.id}/file`, { als: ADMIN })).status).toBe(200);

    // Die Kopie wird gelöscht: Solange ihre Frist läuft, bleibt die Datei auch für die abgelaufene Zeile.
    await loescheWeich(kopie.id);
    expect(await lauf(25)).toEqual({ geloescht: 0, dokumente: 0, gehalten: 1 });
    expect(await existiert(d.schluessel)).toBe(true);
    // Danach entfernt der Lauf die Datei einmal und schließt beide Zeilen ab.
    expect(await lauf(31)).toEqual({ geloescht: 1, dokumente: 2, gehalten: 0 });
    expect(await existiert(d.schluessel)).toBe(false);
    expect((await zeile(d.id)).status).toBe("endgueltig_geloescht");
    expect((await zeile(kopie.id)).status).toBe("endgueltig_geloescht");
  });

  it("eine ersetzte Zeile mit derselben Datei hält sie ebenfalls", async () => {
    const d = await lege();
    const kopie = await teileDatei(d, "aktiv");
    await db.update(s.dokument).set({ status: "ersetzt", ersetztAm: new Date() }).where(eq(s.dokument.id, kopie.id));
    await loescheWeich(d.id);
    expect((await lauf(31)).gehalten).toBe(1);
    expect(await existiert(d.schluessel)).toBe(true);
  });

  it("eine Fundstelle (Quelle eines Werts) hält die Datei", async () => {
    const d = await lege();
    await db.insert(s.wertQuelle).values({ objektTyp: "beteiligung", objektId: w.beteiligung1, feld: "zusage", wert: "100000.00", dokumentId: d.id, seite: 1, zitat: "Zusage 100.000 EUR", erstelltVon: "test" });
    await loescheWeich(d.id);
    expect(await lauf(31)).toEqual({ geloescht: 0, dokumente: 0, gehalten: 1 });
    expect(await existiert(d.schluessel)).toBe(true);
    const aus = await db.transaction((tx) => ausstehendeLoeschungen(tx, 30, nach(31)()));
    expect(aus.daten.find((x) => x.id === d.id)).toMatchObject({ faellig: true, haltegrund: "fundstelle" });
  });

  it("ein Registerauszug mit dem Dokument hält die Datei", async () => {
    const d = await lege();
    await db.insert(s.registereintrag).values({ organisationId: w.org1, gericht: "Beispielstadt", registerart: "HRB", nummer: "1234", firma: "Nordlicht Technik GmbH", standDatum: "2026-01-01", quelle: "dokument", dokumentId: d.id });
    await loescheWeich(d.id);
    expect((await lauf(31)).gehalten).toBe(1);
    expect(await existiert(d.schluessel)).toBe(true);
    const aus = await db.transaction((tx) => ausstehendeLoeschungen(tx, 30, nach(31)()));
    expect(aus.daten[0]!.haltegrund).toBe("register");
  });

  it("ein Beleg mit demselben Dateischlüssel hält die Datei", async () => {
    const d = await lege();
    await db.insert(s.beleg).values({ fondsId: w.fonds1, art: "auszahlung", bezugArt: "beteiligung", bezugId: w.beteiligung1, sprache: "de", vorlage: {}, daten: {}, erstelltVon: "test", dateiSchluessel: d.schluessel, dateiName: "beleg.pdf" });
    await loescheWeich(d.id);
    expect((await lauf(31)).gehalten).toBe(1);
    expect(await existiert(d.schluessel)).toBe(true);
    const aus = await db.transaction((tx) => ausstehendeLoeschungen(tx, 30, nach(31)()));
    expect(aus.daten[0]!.haltegrund).toBe("beleg");
  });

  it("dieselben Bytes in einem Beleg unter anderem Schlüssel halten die Datei ebenfalls (Vergleich der Prüfsumme)", async () => {
    const d = await lege();
    await db.insert(s.beleg).values({ fondsId: w.fonds1, art: "auszahlung", bezugArt: "beteiligung", bezugId: w.beteiligung1, sprache: "de", vorlage: {}, daten: {}, erstelltVon: "test", dateiSchluessel: `belege/${w.fonds1}/${d.hash}.pdf`, dateiSha256: d.hash, dateiName: "beleg.pdf" });
    await loescheWeich(d.id);
    expect((await lauf(31)).gehalten).toBe(1);
    expect(await existiert(d.schluessel)).toBe(true);
  });

  it("gehaltene Dateien verstopfen den Lauf nicht: Auch hinter vielen gehaltenen kommt die entfernbare Datei an die Reihe", async () => {
    const gehalten = [];
    for (let i = 0; i < 5; i++) {
      const d = await lege(`gehalten-${i}.pdf`);
      await teileDatei(d, "aktiv");
      await loescheWeich(d.id);
      gehalten.push(d);
    }
    const frei = await lege("frei.pdf");
    await loescheWeich(frei.id);
    // kleine Seiten: Die Kandidaten laufen über mehrere Seiten, gleich in welcher Reihenfolge die Schlüssel liegen
    expect(await lauf(31, { seite: 2 })).toEqual({ geloescht: 1, dokumente: 1, gehalten: 5 });
    expect(await existiert(frei.schluessel)).toBe(false);
    for (const g of gehalten) expect(await existiert(g.schluessel)).toBe(true);
    // Die Obergrenze zählt geprüfte Dateien, auch gehaltene.
    expect((await lauf(31, { seite: 2, max: 3 })).gehalten).toBe(3);
  });

  it("nur Dateien der Dokumentablage werden entfernt; ein anderer Schlüssel bleibt unberührt", async () => {
    const d = await lege();
    await loescheWeich(d.id);
    await db.execute(sql`UPDATE dokument SET gespeichert_unter = 'berichte/x/abc.pdf' WHERE id = ${d.id}`);
    await speicher.schreibe("berichte/x/abc.pdf", new TextEncoder().encode("bericht"));
    expect(await lauf(31)).toEqual({ geloescht: 0, dokumente: 0, gehalten: 0 });
    expect(await existiert("berichte/x/abc.pdf")).toBe(true);
  });

  it("scheitert das Entfernen der Datei, bleibt alles wie es war, und der nächste Lauf versucht es noch einmal", async () => {
    const d = await lege();
    await loescheWeich(d.id);
    const kaputt: Speicher = { schreibe: (k, b) => speicher.schreibe(k, b), lese: (k) => speicher.lese(k), loesche: async () => { throw new Error("Platte voll"); } };
    expect(await lauf(31, { speicher: kaputt })).toEqual({ geloescht: 0, dokumente: 0, gehalten: 0 });
    expect((await zeile(d.id)).status).toBe("geloescht");
    expect(await existiert(d.schluessel)).toBe(true);
    expect(await lauf(31)).toEqual({ geloescht: 1, dokumente: 1, gehalten: 0 });
  });

  it("ohne Löschfunktion der Ablage bleibt die Datei liegen", async () => {
    const d = await lege();
    await loescheWeich(d.id);
    const ohne: Speicher = { schreibe: (k, b) => speicher.schreibe(k, b), lese: (k) => speicher.lese(k) };
    expect(await lauf(31, { speicher: ohne })).toEqual({ geloescht: 0, dokumente: 0, gehalten: 0 });
    expect((await zeile(d.id)).status).toBe("geloescht");
  });

  it("lädt jemand dieselben Bytes hoch, nachdem der Lauf die Datei entfernt hat, legt das Anlegen sie wieder an", async () => {
    const d = await lege();
    await loescheWeich(d.id);
    // Der Upload hat die Datei geprüft (sie lag noch da), aber noch keine Zeile angelegt ...
    const vorbereitet = await bereiteVor(speicher, d.pdf, "neu.pdf");
    // ... da entfernt der Lauf sie.
    expect((await lauf(31)).geloescht).toBe(1);
    expect(await existiert(d.schluessel)).toBe(false);
    const neu = await schreibe(db, "test", (tx, protokoll) =>
      legeDokumentAn(tx, protokoll, { id: "test", name: null }, vorbereitet, { klassifikation: "sonstiges", vertraulich: false, ziele: [{ typ: "beteiligung", id: w.beteiligung1 }] }),
    );
    expect(neu.id).not.toBe(d.id);
    expect(await existiert(d.schluessel)).toBe(true);
    expect((await t.request(`/documents/${neu.id}/file`, { als: ADMIN })).status).toBe(200);
  });

  it("nebenläufig: ein Lauf und ein Anlegen derselben Bytes lassen die Datei nie ohne Zeile zurück oder eine aktive Zeile ohne Datei", async () => {
    const d = await lege();
    await loescheWeich(d.id);
    const vorbereitet = await bereiteVor(speicher, d.pdf, "neu.pdf");
    const [, neu] = await Promise.all([
      lauf(31),
      schreibe(db, "test", (tx, protokoll) =>
        legeDokumentAn(tx, protokoll, { id: "test", name: null }, vorbereitet, { klassifikation: "sonstiges", vertraulich: false, ziele: [{ typ: "beteiligung", id: w.beteiligung1 }] }),
      ),
    ]);
    expect(neu.status).toBe("aktiv");
    expect(await existiert(d.schluessel)).toBe(true);
  });
});

describe("Verwaltung: anstehende Löschungen", () => {
  it("nur globale Verwalter sehen sie; Frist, Ablaufdatum und endgültig gelöschte stehen in der Antwort", async () => {
    const offen = await lege("offen.pdf");
    const alt = await lege("alt.pdf");
    await loescheWeich(offen.id);
    await loescheWeich(alt.id);
    await db.update(s.dokument).set({ geloeschtAm: new Date(Date.now() - 40 * TAG) }).where(eq(s.dokument.id, alt.id));
    expect((await t.request("/documents/retention", { als: VERWALTER1 })).status).toBe(403);
    expect((await t.request("/documents/retention", { als: BEARB1 })).status).toBe(403);
    const antwort = await t.request("/documents/retention", { als: ADMIN });
    expect(antwort.status).toBe(200);
    const k = await json(antwort);
    expect(k.aufbewahrungTage).toBe(30);
    expect(k.endgueltigGeloescht).toBe(0);
    expect(k.daten).toHaveLength(2);
    const [aeltestes, juengstes] = k.daten;
    expect(aeltestes).toMatchObject({ id: alt.id, dateiname: "alt.pdf", faellig: true, haltegrund: null });
    expect(juengstes).toMatchObject({ id: offen.id, faellig: false, haltegrund: null });
    const tage = (new Date(juengstes.entferntAb).getTime() - new Date(juengstes.geloeschtAm).getTime()) / TAG;
    expect(tage).toBeCloseTo(30, 5);

    await lauf(0);
    const danach = await json(await t.request("/documents/retention", { als: ADMIN }));
    expect(danach.endgueltigGeloescht).toBe(1);
    expect(danach.daten.map((x: { id: string }) => x.id)).toEqual([offen.id]);
  });

  it("ohne Anmeldung 401", async () => {
    expect((await t.request("/documents/retention", { als: null })).status).toBe(401);
  });
});

