import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import type { Speicher } from "../berichte/speicher";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { buchhaltungAufsetzen, csvDatei, ladeSusaHoch, susaCsv } from "./hilfen-buchhaltung";
import { aufrufe, grundbestand, ID } from "./hilfen-instrumente";
import { erstelleTestApp, legePersonAn, person, type Testperson } from "./hilfen-auth";

/**
 * Zusammenspiel der Buchhaltung (Etappe 14) mit dem einheitlichen Journal und den Fondsbewegungen (Etappe 4b):
 * Storno im Export, Fondsbewegungen als Buchungseinheit, Belege zu Fondsbewegungen, Belegnummer und Exportstand im Journal,
 * Abstimmung der Liquidität mit Storno-Paaren und das Änderungsprotokoll der neuen Tabellen nach Fondsrechten.
 */

const { db, pool } = oeffneTestdb();
class TestSpeicher implements Speicher {
  readonly dateien = new Map<string, Uint8Array>();
  async schreibe(schluessel: string, daten: Uint8Array) {
    this.dateien.set(schluessel, daten);
  }
  async lese(schluessel: string) {
    const d = this.dateien.get(schluessel);
    if (!d) throw new Error("fehlt");
    return d;
  }
}
const speicher = new TestSpeicher();
const t = erstelleTestApp(db, { speicher });
const { post } = aufrufe(t);
const F1 = ID.fonds;
const F2 = ID.anderer;

const erst = person("e14z-erst", { rollen: { [F1]: "freigeber" } });
const pruefer = person("e14z-pruefer", { rollen: { [F1]: "freigeber" } });
const freigeber = person("e14z-freigeber", { rollen: { [F1]: "freigeber" } });
const bearbeiter = person("e14z-bearbeiter", { rollen: { [F1]: "bearbeiter" } });
const verwalterF1 = person("e14z-verwalter-f1", { rollen: { [F1]: "verwalter" } });
const betrachterF1 = person("e14z-betrachter-f1", { rollen: { [F1]: "betrachter" } });
const verwalterF2 = person("e14z-verwalter-f2", { rollen: { [F2]: "verwalter" } });
const anfrage = (methode: string, pfad: string, als: Testperson, body?: unknown) =>
  t.request(pfad, { method: methode, als, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const dekodiere = (bytes: Uint8Array) => new TextDecoder("windows-1252").decode(bytes);
const datei = async (exportId: string) => dekodiere(new Uint8Array(await (await anfrage("GET", `/buchungsexporte/${exportId}/datei`, bearbeiter)).arrayBuffer()));
const exportieren = (body: object, als: Testperson = bearbeiter) => anfrage("POST", `/fonds/${F1}/buchungsexport`, als, body);
const buche = (body: object) => anfrage("POST", `/fonds/${F1}/buchungen`, bearbeiter, body);

const regeln = (quellen: string[] = ["auszahlung", "abruf", "ausschuettung"]) =>
  db.insert(s.buchungsregel).values(
    quellen.map((quelle) => ({
      fondsId: F1,
      quelle: quelle as (typeof s.buchungsquelle.enumValues)[number],
      konto: quelle === "ausschuettung" ? "2000" : "1200",
      gegenkonto: quelle === "abruf" ? "2000" : quelle === "ausschuettung" ? "1200" : "0150",
      richtung: "S",
      buSchluessel: null,
      buchungstext: quelle === "auszahlung" ? "Auszahlung {organisation}" : "Fonds {art} {valuta}",
      geaendertVon: "test",
    })),
  );

beforeEach(async () => {
  await grundbestand(db);
  await buchhaltungAufsetzen(db, F1);
  for (const p of [erst, pruefer, freigeber, bearbeiter, verwalterF1, betrachterF1, verwalterF2]) await legePersonAn(db, p);
  speicher.dateien.clear();
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

async function auszahlung(betrag = "12345.67", valuta = "2025-03-31"): Promise<string> {
  await post(`/beteiligungen/${ID.darlehen}/vorgaenge`, { art: "zusage", valuta: "2025-01-01", betrag: "200000" });
  const a = await json(await post(`/beteiligungen/${ID.darlehen}/vorgaenge`, { art: "auszahlung", valuta, betrag }));
  return a.vorgang.id;
}

describe("Storno im Buchungsexport", () => {
  it("ein schon exportierter Vorgang wird später storniert: das Storno ist exportierbar und wird als Umkehrbuchung geschrieben", async () => {
    await regeln();
    const original = await auszahlung();
    const erster = await exportieren({ vorgangIds: [original] });
    expect(erster.status).toBe(201);
    // Das Original bleibt gesperrt, solange keine Wiederholung verlangt wird.
    expect((await exportieren({ vorgangIds: [original] })).status).toBe(409);
    const storno = await json(await post(`/vorgaenge/${original}/storno`, { grund: "Betrag falsch erfasst", valuta: "2025-04-10" }));
    const zweiter = await exportieren({ vorgangIds: [storno.storno.id] });
    expect(zweiter.status).toBe(201);
    const x = await json(zweiter);
    expect(x.summe).toBe("-12345.67");
    const zeilen = (await datei(x.id)).split("\r\n");
    const felder = zeilen[2]!.split(";");
    // positiver Umsatz, Soll/Haben gegenüber der Regel (S) vertauscht
    expect([felder[0], felder[1]]).toEqual(["12345,67", '"H"']);
    // Original und Storno tragen je eine aktive Markierung
    expect(await db.select().from(s.buchungsexportPosition).where(eq(s.buchungsexportPosition.aktiv, true))).toHaveLength(2);
  });
});

describe("Fondsbewegungen im Buchungsexport", () => {
  it("Abruf, Ausschüttung und ein Storno werden mit ihrer Regel exportiert; ohne Regel, mit fremdem Fonds und doppelt wird abgelehnt", async () => {
    const abruf = await json(await buche({ typ: "fondsbewegung", art: "abruf", valuta: "2025-03-01", betrag: "2500000" }));
    const ausschuettung = await json(await buche({ typ: "fondsbewegung", art: "ausschuettung", valuta: "2025-09-01", betrag: "100000" }));
    const abrufId = abruf.bewegung.id as string;
    const ausId = ausschuettung.bewegung.id as string;
    // keine Regel
    const fehlt = await exportieren({ fondsBewegungIds: [abrufId] });
    expect(fehlt.status).toBe(409);
    expect(await json(fehlt)).toMatchObject({ fehler: { code: "BUCHUNGSREGEL_FEHLT", arten: ["abruf"] } });
    await regeln();
    const vorschau = await json(await anfrage("POST", `/fonds/${F1}/buchungsexport/vorschau`, bearbeiter, { fondsBewegungIds: [abrufId, ausId] }));
    expect(vorschau.zeilen.map((z: { art: string; vorgangId: string | null; fondsBewegungId: string | null }) => [z.art, z.vorgangId, z.fondsBewegungId])).toEqual([["abruf", null, abrufId], ["ausschuettung", null, ausId]]);
    const antwort = await exportieren({ fondsBewegungIds: [abrufId, ausId] });
    expect(antwort.status).toBe(201);
    const x = await json(antwort);
    const zeilen = (await datei(x.id)).split("\r\n");
    const f1 = zeilen[2]!.split(";");
    const f2 = zeilen[3]!.split(";");
    expect([f1[0], f1[1], f1[6], f1[7], f1[13]]).toEqual(["2500000,00", '"S"', "1200", "2000", '"Fonds abruf 2025-03-01"']);
    expect([f2[0], f2[1], f2[6], f2[7]]).toEqual(["100000,00", '"S"', "2000", "1200"]);
    // doppelt
    expect((await exportieren({ fondsBewegungIds: [abrufId] })).status).toBe(409);
    // Storno einer exportierten Bewegung: eigener Datensatz, Umkehrbuchung
    const storno = await json(await anfrage("POST", `/fondsbewegungen/${abrufId}/storno`, bearbeiter, { grund: "Falscher Betrag", valuta: "2025-03-05" }));
    const stornoId = (storno.storno?.id ?? storno.bewegung?.id) as string;
    expect(stornoId).toBeTruthy();
    const nachStorno = await exportieren({ fondsBewegungIds: [stornoId] });
    expect(nachStorno.status).toBe(201);
    const sf = (await datei((await json(nachStorno)).id)).split("\r\n")[2]!.split(";");
    expect([sf[0], sf[1]]).toEqual(["2500000,00", '"H"']);
    // Bewegung eines anderen Fonds antwortet wie eine unbekannte
    const [fremd] = await db.insert(s.fondsBewegung).values({ fondsId: F2, art: "abruf", valuta: "2025-03-01", betrag: "10.00" }).returning();
    const fremdAntwort = await exportieren({ fondsBewegungIds: [fremd!.id] });
    const unbekannt = await exportieren({ fondsBewegungIds: ["00000000-0000-4000-8000-0000000000aa"] });
    expect(fremdAntwort.status).toBe(404);
    expect(await json(fremdAntwort)).toEqual(await json(unbekannt));
    // genau eines von beiden je Markierung (Datenbank)
    await expect(db.insert(s.buchungsexportPosition).values({ exportId: x.id, belegfeld: "X", betrag: "1.00" })).rejects.toThrow();
  });

  it("eine Wiederholung mit Grund ersetzt die Markierung einer Bewegung", async () => {
    await regeln();
    const abruf = (await json(await buche({ typ: "fondsbewegung", art: "abruf", valuta: "2025-03-01", betrag: "1000" }))).bewegung.id as string;
    expect((await exportieren({ fondsBewegungIds: [abruf] })).status).toBe(201);
    expect((await exportieren({ fondsBewegungIds: [abruf], wiederholung: true })).status).toBe(400);
    expect((await exportieren({ fondsBewegungIds: [abruf], wiederholung: true, grund: "Konto korrigiert" })).status).toBe(201);
    const aktiv = await db.select().from(s.buchungsexportPosition).where(and(eq(s.buchungsexportPosition.aktiv, true), eq(s.buchungsexportPosition.fondsBewegungId, abruf)));
    expect(aktiv).toHaveLength(1);
  });
});

describe("Belege zu Fondsbewegungen", () => {
  const belegAnlegen = async (body: object, als: Testperson = erst) => {
    const antwort = await anfrage("POST", "/belege", als, { sprache: "de", ...body });
    return { antwort, beleg: await json(antwort) };
  };
  const stufe = (id: string, name: string, als: Testperson) => anfrage("POST", `/belege/${id}/stufe`, als, { stufe: name, ergebnis: "ok" });

  it("Kapitalabruf und Ausschüttung als Beleg; Art und Bewegung müssen zusammenpassen; die Belegnummer steht im Belegfeld des Exports und im Journal", async () => {
    await regeln();
    const abruf = (await json(await buche({ typ: "fondsbewegung", art: "abruf", valuta: "2025-03-01", betrag: "2500000" }))).bewegung.id as string;
    const ausschuettung = (await json(await buche({ typ: "fondsbewegung", art: "ausschuettung", valuta: "2025-09-01", betrag: "100000" }))).bewegung.id as string;
    const falsch = await belegAnlegen({ art: "ausschuettung", bezugArt: "fonds_bewegung", bezugId: abruf });
    expect(falsch.antwort.status).toBe(409);
    expect(falsch.beleg.fehler.code).toBe("BELEG_BEZUG_PASST_NICHT");
    const nichtBewegung = await belegAnlegen({ art: "kapitalabruf", bezugArt: "vorgang", bezugId: abruf });
    expect(nichtBewegung.antwort.status).toBe(404); // kein Vorgang mit dieser ID
    const { antwort, beleg } = await belegAnlegen({ art: "kapitalabruf", bezugArt: "fonds_bewegung", bezugId: abruf });
    expect(antwort.status).toBe(201);
    expect(beleg).toMatchObject({ status: "entwurf", art: "kapitalabruf", fondsId: F1, beteiligungId: null, befunde: [] });
    expect(beleg.daten.werte).toMatchObject({ fonds_name: "Testfonds Eins", belegdatum: "2025-03-01", betrag: "2500000.00", zeichnungskapital: "10000000.00", summe_bis_datum: "2500000.00" });
    expect((await belegAnlegen({ art: "ausschuettung", bezugArt: "fonds_bewegung", bezugId: ausschuettung })).antwort.status).toBe(201);
    // Ein Beleg je Art und Bezug
    expect((await belegAnlegen({ art: "kapitalabruf", bezugArt: "fonds_bewegung", bezugId: abruf })).antwort.status).toBe(409);
    // Fremder Fonds: Rolle vor Inhalt, gleiche Antwort wie bei unbekanntem Bezug
    const [fremd] = await db.insert(s.fondsBewegung).values({ fondsId: F2, art: "abruf", valuta: "2025-03-01", betrag: "10.00" }).returning();
    const f = await belegAnlegen({ art: "kapitalabruf", bezugArt: "fonds_bewegung", bezugId: fremd!.id });
    const u = await belegAnlegen({ art: "kapitalabruf", bezugArt: "fonds_bewegung", bezugId: "00000000-0000-4000-8000-0000000000aa" });
    expect(f.antwort.status).toBe(u.antwort.status);
    expect(f.beleg).toEqual(u.beleg);

    // Vor der Freigabe: Journal zeigt keine Belegnummer
    const journal = async () => (await json(await anfrage("GET", `/fonds/${F1}/journal?typ=abruf,ausschuettung`, betrachterF1))).daten as { id: string; buchhaltung: { belegnummer: string | null; exportiertAm: string | null } | null }[];
    expect((await journal()).find((z) => z.id === abruf)!.buchhaltung).toEqual({ belegnummer: null, exportiertAm: null });
    expect((await stufe(beleg.id, "Prüfung", pruefer)).status).toBe(200);
    const frei = await stufe(beleg.id, "Freigabe", freigeber);
    expect(frei.status).toBe(200);
    const nummer = (await json(frei)).belegnummer as string;
    expect(nummer).toMatch(/^B-\d{6}$/);
    expect((await journal()).find((z) => z.id === abruf)!.buchhaltung).toEqual({ belegnummer: nummer, exportiertAm: null });

    // Export: Belegfeld 1 ist die Belegnummer, die Bewegung ohne Beleg trägt eine Ersatzkennung
    const x = await json(await exportieren({ fondsBewegungIds: [abruf, ausschuettung] }));
    expect(x.ohneBeleg).toEqual([ausschuettung]);
    const zeilen = (await datei(x.id)).split("\r\n");
    expect(zeilen[2]!.split(";")[10]).toBe(`"${nummer}"`);
    const nachExport = (await journal()).find((z) => z.id === abruf)!.buchhaltung!;
    expect(nachExport.belegnummer).toBe(nummer);
    expect(nachExport.exportiertAm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("Journal: Vorgänge zeigen Belegnummer und Exportstand, Bewertungen und Ereignisse nicht", async () => {
    await regeln();
    const vorgangId = await auszahlung();
    const journal = async () => (await json(await anfrage("GET", `/fonds/${F1}/journal`, betrachterF1))).daten as { id: string; typ: string; buchhaltung: { belegnummer: string | null; exportiertAm: string | null } | null }[];
    expect((await journal()).find((z) => z.id === vorgangId)!.buchhaltung).toEqual({ belegnummer: null, exportiertAm: null });
    const { beleg } = await belegAnlegen({ art: "auszahlung", bezugArt: "vorgang", bezugId: vorgangId });
    await stufe(beleg.id, "Prüfung", pruefer);
    const nummer = (await json(await stufe(beleg.id, "Freigabe", freigeber))).belegnummer as string;
    await exportieren({ vorgangIds: [vorgangId] });
    const zeile = (await journal()).find((z) => z.id === vorgangId)!;
    expect(zeile.buchhaltung?.belegnummer).toBe(nummer);
    expect(zeile.buchhaltung?.exportiertAm).not.toBeNull();
  });
});

describe("Abstimmung der Liquidität mit Storno-Paaren", () => {
  it("ein Storno nach dem Periodenende zählt nicht, ein Storno bis zum Periodenende hebt sein Original auf", async () => {
    const abruf = (await json(await buche({ typ: "fondsbewegung", art: "abruf", valuta: "2025-03-01", betrag: "1000" }))).bewegung.id as string;
    await buche({ typ: "fondsbewegung", art: "abruf", valuta: "2025-03-15", betrag: "500" });
    await db.insert(s.fondsBewegung).values({ fondsId: F1, art: "abruf", valuta: "2025-05-01", betrag: "-1000", storniertBewegungId: abruf });
    // Hochladen = bearbeiter, Prüfen = erst, Übernehmen = freigeber (drei verschiedene Personen)
    const lauf = async (von: string, bis: string) => {
      const antwort = await ladeSusaHoch(t, F1, csvDatei(susaCsv()), von, bis, bearbeiter);
      expect(antwort.status).toBe(201);
      const id = (await json(antwort)).id as string;
      expect((await anfrage("POST", `/saldenlaeufe/${id}/pruefen`, erst)).status).toBe(200);
      expect((await anfrage("POST", `/saldenlaeufe/${id}/uebernehmen`, freigeber)).status).toBe(200);
    };
    const carraway = async (bis: string) => {
      const a = await json(await anfrage("GET", `/fonds/${F1}/abstimmung?bis=${bis}`, betrachterF1));
      return a.liquiditaet.carraway as string;
    };
    // Periodenende vor dem Storno: beide Abrufe zählen
    await lauf("2025-01-01", "2025-03-31");
    expect(await carraway("2025-03-31")).toBe("1500.00");
    // Periodenende nach dem Storno: Original und Storno fallen gemeinsam heraus
    await lauf("2025-04-01", "2025-05-31");
    expect(await carraway("2025-05-31")).toBe("500.00");
  });
});

describe("Änderungsprotokoll der Buchhaltung nach Fondsrechten", () => {
  it("ein Benutzer des Fonds B sieht keine Änderungen an Beleg, Saldenlauf, Konto und Kontenzuordnung des Fonds A, auch keine gelöschten Zeilen", async () => {
    await regeln();
    const vorgangId = await auszahlung();
    const { beleg } = await (async () => {
      const antwort = await anfrage("POST", "/belege", erst, { art: "auszahlung", bezugArt: "vorgang", bezugId: vorgangId, sprache: "de" });
      return { beleg: await json(antwort) };
    })();
    const susa = await ladeSusaHoch(t, F1, csvDatei(susaCsv()), "2025-01-01", "2025-03-31", verwalterF1);
    expect(susa.status).toBe(201);
    const saldenlaufId = (await json(susa)).id as string;
    // Konto anlegen und löschen (Löschzeile im Protokoll), Kontenzuordnung ändern
    expect((await anfrage("PUT", `/fonds/${F1}/konten`, verwalterF1, { konten: [{ nummer: "9999", bezeichnung: "Testkonto", art: "aktiv" }] })).status).toBe(200);
    expect((await anfrage("DELETE", `/fonds/${F1}/konten/9999`, verwalterF1)).status).toBe(204);
    expect((await anfrage("PUT", `/fonds/${F1}/buchungsregeln/zins`, verwalterF1, { konto: "1200", gegenkonto: "4200", richtung: "S", buSchluessel: null, buchungstext: "Zins" })).status).toBe(200);
    await exportieren({ vorgangIds: [vorgangId] });

    const lies = async (als: Testperson, tabelle: string) => (await json(await anfrage("GET", `/aenderungen?tabelle=${tabelle}&limit=1000`, als))).daten as { aktion: string; datensatzId: string; fondsId: string | null }[];
    const TABELLEN = ["beleg", "saldenlauf", "sachkonto", "buchungsregel", "buchungsexport"];
    for (const tabelle of TABELLEN) {
      const eigen = await lies(verwalterF1, tabelle);
      expect(eigen.length, `${tabelle} für Fonds A`).toBeGreaterThan(0);
      expect(eigen.every((z) => z.fondsId === F1), `${tabelle} trägt den Fonds`).toBe(true);
      expect(await lies(verwalterF2, tabelle), `${tabelle} für Fonds B`).toEqual([]);
    }
    expect((await lies(verwalterF1, "beleg")).map((z) => z.datensatzId)).toContain(beleg.id);
    expect((await lies(verwalterF1, "saldenlauf")).map((z) => z.datensatzId)).toContain(saldenlaufId);
    expect((await lies(verwalterF1, "sachkonto")).map((z) => z.aktion)).toContain("loeschen");
    // ohne Tabellenfilter: keine Zeile dieser Tabellen für Fonds B
    const alles = (await json(await anfrage("GET", `/aenderungen?limit=1000`, verwalterF2))).daten as { tabelle: string }[];
    expect(alles.filter((z) => TABELLEN.includes(z.tabelle))).toEqual([]);
    // Zeilen ohne Fonds (Stufenprotokoll, Salden, Exportpositionen) erscheinen weder für Fonds B noch ohne Filter
    const ohne = await json(await anfrage("GET", `/aenderungen?limit=1000`, verwalterF2));
    expect(JSON.stringify(ohne)).not.toContain(saldenlaufId);
  });
});
