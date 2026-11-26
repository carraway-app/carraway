import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { EXTF_SPALTEN, BELEGFELD_ERLAUBT } from "@carraway/import";
import type { Speicher } from "../berichte/speicher";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { buchhaltungAufsetzen } from "./hilfen-buchhaltung";
import { aufrufe, grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";
import { erstelleTestApp, legePersonAn, person, type Testperson } from "./hilfen-auth";
import { vorgaengeEinfuegen } from "./instrument-hilfen";

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

const bearbeiter = person("e14-ex-bearbeiter", { rollen: { [F1]: "bearbeiter" } });
const betrachter = person("e14-ex-betrachter", { rollen: { [F1]: "betrachter" } });
const verwalter = person("e14-ex-verwalter", { rollen: { [F1]: "verwalter" } });
const fremd = person("e14-ex-fremd", { rollen: { [F2]: "verwalter" } });
const anfrage = (methode: string, pfad: string, als: Testperson, body?: unknown) =>
  t.request(pfad, { method: methode, als, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const KONDITION = { gueltigAb: "2025-01-01", satzFix: "0.06", methode: "30E/360", zinsperiode: "jaehrlich", anker: "2026-01-01" };

/** Zwei Darlehen (je 100.000 am 01.01.2025, 6 %): ein Zinslauf zum 01.01.2026 ergibt zwei Zinsbuchungen zu je 6.000,00. */
async function zinslaufGebucht(stichtag = "2026-01-01"): Promise<string> {
  for (const b of [ID.darlehen, ID.wandel]) {
    await post(`/beteiligungen/${b}/vorgaenge`, { art: "zusage", valuta: "2025-01-01", betrag: "200000" });
    await post(`/beteiligungen/${b}/vorgaenge`, { art: "auszahlung", valuta: "2025-01-01", betrag: "100000" });
    await post(`/beteiligungen/${b}/konditionen`, KONDITION);
  }
  const lauf = await json(await post("/zinslaeufe", { fondsId: F1, stichtag }, "rechner"));
  await post(`/zinslaeufe/${lauf.id}/pruefen`, {}, "a");
  await post(`/zinslaeufe/${lauf.id}/freigeben`, {});
  expect((await post(`/zinslaeufe/${lauf.id}/buchen`, {}, "c")).status).toBe(200);
  return lauf.id;
}

const regeln = () =>
  db.insert(s.buchungsregel).values([
    { fondsId: F1, quelle: "zins", konto: "1200", gegenkonto: "4200", richtung: "S", buSchluessel: null, buchungstext: "Zins {organisation} {valuta}", geaendertVon: "test" },
    { fondsId: F1, quelle: "auszahlung", konto: "0150", gegenkonto: "1200", richtung: "S", buSchluessel: null, buchungstext: "Auszahlung {organisation}", geaendertVon: "test" },
  ]);
const exportieren = (als: Testperson, body: object) => anfrage("POST", `/fonds/${F1}/buchungsexport`, als, body);
const vorschau = (als: Testperson, body: object) => anfrage("POST", `/fonds/${F1}/buchungsexport/vorschau`, als, body);
const dekodiere = (bytes: Uint8Array) => new TextDecoder("windows-1252").decode(bytes);

beforeEach(async () => {
  await grundbestand(db);
  await db.update(s.beteiligung).set({ status: "aktiv" }).where(eq(s.beteiligung.id, ID.wandel));
  await buchhaltungAufsetzen(db, F1);
  await regeln();
  for (const p of [bearbeiter, betrachter, verwalter, fremd]) await legePersonAn(db, p);
  speicher.dateien.clear();
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Vorschau", () => {
  it("zeigt Konten, Belegfeld und Buchungstext je Vorgang und schreibt nichts", async () => {
    const lauf = await zinslaufGebucht();
    const v = await json(await vorschau(bearbeiter, { zinslaufId: lauf }));
    expect(v).toMatchObject({ datumVon: "2026-01-01", datumBis: "2026-01-01", wirtschaftsjahrBeginn: "2026-01-01", sachkontenlaenge: 4, anzahl: 2, probleme: [] });
    expect(v.zeilen).toHaveLength(2);
    expect(v.zeilen[0]).toMatchObject({ art: "zins", betrag: "6000.00", konto: "1200", gegenkonto: "4200", richtung: "S", mitBeleg: false, bereitsExportiert: false });
    expect(v.zeilen[0].belegfeld).toMatch(/^FND-[0-9A-F]{8}$/);
    expect(v.zeilen.map((z: { buchungstext: string }) => z.buchungstext).sort()).toEqual(["Zins Beta Beispiel 2026-01-01", "Zins Gamma Beispiel 2026-01-01"]);
    expect(v.ohneBeleg).toHaveLength(2);
    expect(await db.select().from(s.buchungsexport)).toHaveLength(0);
    expect((await vorschau(betrachter, { zinslaufId: lauf })).status).toBe(403);
  });
});

describe("Export", () => {
  it("Kopfzeile, Spaltenzeile und Zeilen entsprechen der Feldliste (Windows-1252, Semikolon, Dezimalkomma, volle Breite)", async () => {
    const lauf = await zinslaufGebucht();
    // freigegebener Beleg zum Zinslauf: sein Belegnummer steht im Belegfeld
    await db.insert(s.beleg).values({ fondsId: F1, art: "zinsbuchung", bezugArt: "zinslauf", bezugId: lauf, sprache: "de", status: "freigegeben", vorlage: {}, daten: {}, belegnummer: "B-000042", belegnummerLfd: 42, erstelltVon: "x" });
    const antwort = await exportieren(bearbeiter, { zinslaufId: lauf });
    expect(antwort.status).toBe(201);
    const x = await json(antwort);
    expect(x).toMatchObject({ anzahl: 2, summe: "12000.00", wiederholung: false, formatVersion: "EXTF 700 / Buchungsstapel 13", ohneBeleg: [] });
    const datei = await anfrage("GET", `/buchungsexporte/${x.id}/datei`, bearbeiter);
    expect(datei.status).toBe(200);
    expect(datei.headers.get("content-type")).toBe("text/csv; charset=windows-1252");
    expect(datei.headers.get("x-datei-sha256")).toBe(x.dateiSha256);
    const bytes = new Uint8Array(await datei.arrayBuffer());
    const zeilen = dekodiere(bytes).split("\r\n");
    expect(zeilen.at(-1)).toBe("");
    expect(zeilen).toHaveLength(5);

    const kopf = zeilen[0]!.split(";");
    expect(kopf).toHaveLength(31);
    expect(kopf.slice(0, 5)).toEqual(['"EXTF"', "700", "21", '"Buchungsstapel"', "13"]);
    expect(kopf[5]).toMatch(/^\d{17}$/);
    expect(kopf.slice(10, 16)).toEqual(["1234567", "12345", "20260101", "4", "20260101", "20260101"]);
    expect(kopf[16]).toBe('"TF1 2026-01"');
    expect(kopf[21]).toBe('"EUR"');

    expect(zeilen[1]!.split(";")).toEqual([...EXTF_SPALTEN]);
    for (const zeile of zeilen.slice(2, 4)) {
      const f = zeile.split(";");
      expect(f).toHaveLength(EXTF_SPALTEN.length);
      expect(f[0]).toMatch(/^\d+,\d{2}$/); // Umsatz ohne Vorzeichen, Dezimalkomma, kein Tausenderpunkt
      expect(f[1]).toMatch(/^"[SH]"$/);
      expect(f[2]).toBe('"EUR"');
      expect(f[6]).toHaveLength(4); // Konto = Sachkontenlänge
      expect(f[7]).toHaveLength(4);
      expect(f[9]).toMatch(/^\d{4}$/); // Belegdatum TTMM
      const belegfeld = f[10]!.slice(1, -1);
      expect(belegfeld).toBe("B-000042");
      expect(BELEGFELD_ERLAUBT.test(belegfeld)).toBe(true);
      expect(f[13]!.length - 2).toBeLessThanOrEqual(60);
    }
    expect(zeilen[2]!.split(";").slice(0, 14)).toEqual(["6000,00", '"S"', '"EUR"', "", "", "", "1200", "4200", "", "0101", '"B-000042"', "", "", expect.stringMatching(/^"Zins (Beta|Gamma) Beispiel 2026-01-01"$/)]);
    // Datei im Speicher, unveränderlich und mit Hash
    expect(speicher.dateien.size).toBe(1);
    expect((await protokollZeilen(db, "buchungsexport", "exportieren")).length).toBe(1);
    expect((await protokollZeilen(db, "buchungsexport", "gelesen")).length).toBe(1);
    const liste = await json(await anfrage("GET", `/fonds/${F1}/buchungsexporte`, betrachter));
    expect(liste.daten).toHaveLength(1);
    expect(liste.daten[0]).toMatchObject({ id: x.id, anzahl: 2, summe: "12000.00" });
    expect((await anfrage("GET", `/buchungsexporte/${x.id}/datei`, betrachter)).status).toBe(403);
    expect((await anfrage("GET", `/buchungsexporte/${x.id}/datei`, fremd)).status).toBe(403);
    speicher.dateien.set([...speicher.dateien.keys()][0]!, Uint8Array.from([1]));
    expect((await anfrage("GET", `/buchungsexporte/${x.id}/datei`, bearbeiter)).status).toBe(500);
  });

  it("kein doppelter Export: ein zweiter Lauf verlangt die ausdrückliche Wiederholung mit Grund; die Markierung geht auf den neuen Lauf über", async () => {
    const lauf = await zinslaufGebucht();
    const erster = await json(await exportieren(bearbeiter, { zinslaufId: lauf }));
    const zweiter = await exportieren(bearbeiter, { zinslaufId: lauf });
    expect(zweiter.status).toBe(409);
    expect(await json(zweiter)).toMatchObject({ fehler: { code: "BUCHUNGSEXPORT_BEREITS_EXPORTIERT", vorgangIds: expect.any(Array) } });
    expect((await vorschau(bearbeiter, { zinslaufId: lauf })).status).toBe(409);
    expect((await exportieren(bearbeiter, { zinslaufId: lauf, wiederholung: true })).status).toBe(400); // Grund fehlt
    const nochmal = await exportieren(bearbeiter, { zinslaufId: lauf, wiederholung: true, grund: "Konten im Programm korrigiert" });
    expect(nochmal.status).toBe(201);
    const neu = await json(nochmal);
    expect(neu).toMatchObject({ wiederholung: true, grund: "Konten im Programm korrigiert" });
    const aktiv = await db.select().from(s.buchungsexportPosition).where(eq(s.buchungsexportPosition.aktiv, true));
    expect(aktiv).toHaveLength(2);
    expect(new Set(aktiv.map((a) => a.exportId))).toEqual(new Set([neu.id]));
    expect(await db.select().from(s.buchungsexportPosition)).toHaveLength(4);
    expect((await db.select().from(s.buchungsexport)).map((e) => e.id).sort()).toEqual([erster.id, neu.id].sort());
    // Vorschau mit Wiederholung kennzeichnet bereits Exportiertes
    expect((await json(await vorschau(bearbeiter, { zinslaufId: lauf, wiederholung: true }))).zeilen.every((z: { bereitsExportiert: boolean }) => z.bereitsExportiert)).toBe(true);
  });

  it("zwei gleichzeitige Exporte desselben Zinslaufs: genau einer gelingt", async () => {
    const lauf = await zinslaufGebucht();
    const antworten = await Promise.all([exportieren(bearbeiter, { zinslaufId: lauf }), exportieren(bearbeiter, { zinslaufId: lauf })]);
    expect(antworten.map((a) => a.status).sort()).toEqual([201, 409]);
    expect(await db.select().from(s.buchungsexportPosition)).toHaveLength(2);
    // die Datenbank sperrt eine zweite aktive Markierung auch am Export vorbei
    const [vorgang] = await db.select().from(s.buchungsexportPosition);
    const [anderer] = await db.select().from(s.buchungsexport);
    await expect(db.insert(s.buchungsexportPosition).values({ exportId: anderer!.id, vorgangId: vorgang!.vorgangId, belegfeld: "X", betrag: "1.00" })).rejects.toThrow();
  });

  it("ausgewählte Vorgänge: Storno vertauscht das Soll-Haben-Kennzeichen, fehlende Kontenzuordnung und fremde Fonds werden abgelehnt", async () => {
    const v = await json(await post(`/beteiligungen/${ID.darlehen}/vorgaenge`, { art: "zusage", valuta: "2025-01-01", betrag: "200000" }));
    const a = await json(await post(`/beteiligungen/${ID.darlehen}/vorgaenge`, { art: "auszahlung", valuta: "2025-03-31", betrag: "12345.67" }));
    const storno = await json(await post(`/vorgaenge/${a.vorgang.id}/storno`, { grund: "Betrag falsch erfasst", valuta: "2025-04-10" }));
    expect(v.vorgang.id).toBeTruthy();
    const antwort = await exportieren(bearbeiter, { vorgangIds: [a.vorgang.id, storno.storno.id] });
    expect(antwort.status).toBe(201);
    const x = await json(antwort);
    expect(x.summe).toBe("0.00");
    const zeilen = dekodiere(new Uint8Array(await (await anfrage("GET", `/buchungsexporte/${x.id}/datei`, bearbeiter)).arrayBuffer())).split("\r\n");
    const f = zeilen.slice(2, 4).map((z) => z.split(";"));
    expect(f.map((z) => [z[0], z[1]])).toEqual([["12345,67", '"S"'], ["12345,67", '"H"']]);
    // Rückfluss ohne Kontenzuordnung
    const r = await json(await post(`/beteiligungen/${ID.darlehen}/vorgaenge`, { art: "rueckfluss", valuta: "2025-04-30", betrag: "10" }));
    const fehlt = await exportieren(bearbeiter, { vorgangIds: [r.vorgang.id] });
    expect(fehlt.status).toBe(409);
    expect(await json(fehlt)).toMatchObject({ fehler: { code: "BUCHUNGSREGEL_FEHLT", arten: ["rueckfluss"] } });
    // Vorgang eines anderen Fonds
    const [bet] = await db.insert(s.beteiligung).values({ fondsId: F2, organisationId: ID.orgA, instrument: "darlehen", erstinvestment: "2025-01-01" }).returning();
    const [fremderVorgang] = await vorgaengeEinfuegen(db, { beteiligungId: bet!.id, art: "auszahlung", valuta: "2025-05-01", betrag: "5.00" });
    const fremdAntwort = await exportieren(bearbeiter, { vorgangIds: [fremderVorgang!.id] });
    const fehlendAntwort = await exportieren(bearbeiter, { vorgangIds: ["00000000-0000-4000-8000-0000000000aa"] });
    expect(fremdAntwort.status).toBe(404);
    expect(await json(fremdAntwort)).toEqual(await json(fehlendAntwort)); // fremd und nicht vorhanden sind nicht zu unterscheiden
    expect((await json(await exportieren(bearbeiter, {}))).fehler.code).toBe("BUCHUNGSEXPORT_LEER");
  });

  it("nur gebuchte Zinsläufe; Konfiguration nötig; Probleme (Zeitraum über zwölf Monate, Kontolänge, Zeichen) verhindern die Datei", async () => {
    // nicht gebucht
    for (const b of [ID.darlehen]) {
      await post(`/beteiligungen/${b}/vorgaenge`, { art: "zusage", valuta: "2025-01-01", betrag: "200000" });
      await post(`/beteiligungen/${b}/vorgaenge`, { art: "auszahlung", valuta: "2025-01-01", betrag: "100000" });
      await post(`/beteiligungen/${b}/konditionen`, KONDITION);
    }
    const offen = await json(await post("/zinslaeufe", { fondsId: F1, stichtag: "2027-01-01" }, "rechner"));
    const roh = await exportieren(bearbeiter, { zinslaufId: offen.id });
    expect(roh.status).toBe(409);
    expect((await json(roh)).fehler.code).toBe("ZINSLAUF_STATUS_UNGUELTIG");
    await post(`/zinslaeufe/${offen.id}/pruefen`, {}, "a");
    await post(`/zinslaeufe/${offen.id}/freigeben`, {});
    await post(`/zinslaeufe/${offen.id}/buchen`, {}, "c");
    // zwei Zinsperioden von 01.01.2026 bis 01.01.2027: das Belegdatum TTMM wäre mehrdeutig
    const zuGross = await exportieren(bearbeiter, { zinslaufId: offen.id });
    expect(zuGross.status).toBe(409);
    expect((await json(zuGross)).fehler).toMatchObject({ code: "BUCHUNGSEXPORT_PROBLEME", probleme: [{ code: "EXPORT_ZEITRAUM_ZU_GROSS" }] });
    const zins = await db.select().from(s.vorgang).where(eq(s.vorgang.art, "zins"));
    const einzeln = zins.sort((x, y) => x.valuta.localeCompare(y.valuta))[0]!;
    // falsche Kontolänge
    await db.update(s.buchungsregel).set({ konto: "12000" }).where(eq(s.buchungsregel.quelle, "zins"));
    expect((await json(await exportieren(bearbeiter, { vorgangIds: [einzeln.id] }))).fehler.probleme[0]).toMatchObject({ code: "EXPORT_KONTO_LAENGE", params: { konto: "12000", erwartet: 4 } });
    await db.update(s.buchungsregel).set({ konto: "1200" }).where(eq(s.buchungsregel.quelle, "zins"));
    // Zeichen außerhalb von Windows-1252
    await db.update(s.organisation).set({ name: "Beta 日本 GmbH" }).where(eq(s.organisation.id, ID.orgB));
    expect((await json(await exportieren(bearbeiter, { vorgangIds: [einzeln.id] }))).fehler.probleme.map((p: { code: string }) => p.code)).toEqual(["EXPORT_ZEICHEN_NICHT_DARSTELLBAR"]);
    await db.update(s.organisation).set({ name: "Beta Müller – Größe GmbH" }).where(eq(s.organisation.id, ID.orgB));
    const ok = await exportieren(bearbeiter, { vorgangIds: [einzeln.id] });
    expect(ok.status).toBe(201);
    const bytes = new Uint8Array(await (await anfrage("GET", `/buchungsexporte/${(await json(ok)).id}/datei`, bearbeiter)).arrayBuffer());
    expect(dekodiere(bytes)).toContain("Zins Beta Müller – Größe GmbH 2026-01-01");
    expect([...bytes]).toContain(0xfc); // ü in Windows-1252, nicht UTF-8
    // ohne Konfiguration
    await db.delete(s.fondsBuchhaltung);
    const ohneKonfig = await exportieren(bearbeiter, { vorgangIds: [zins.find((z) => z.id !== einzeln.id)!.id] });
    expect((await json(ohneKonfig)).fehler.code).toBe("BUCHHALTUNG_NICHT_KONFIGURIERT");
  });

  it("Rechte: Export und Vorschau ab Bearbeiter; Wirtschaftsjahr mit abweichendem Beginn", async () => {
    const lauf = await zinslaufGebucht();
    expect((await exportieren(betrachter, { zinslaufId: lauf })).status).toBe(403);
    expect((await exportieren(fremd, { zinslaufId: lauf })).status).toBe(403);
    await db.update(s.fondsBuchhaltung).set({ wirtschaftsjahrBeginn: 7 });
    const v = await json(await vorschau(verwalter, { zinslaufId: lauf }));
    expect(v.wirtschaftsjahrBeginn).toBe("2025-07-01"); // Januar 2026 liegt im Wirtschaftsjahr ab Juli 2025
  });
});
