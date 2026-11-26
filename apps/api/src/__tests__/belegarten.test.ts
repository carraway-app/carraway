import { eq } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import type { Speicher } from "../berichte/speicher";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { buchhaltungAufsetzen, mittelartenAufsetzen } from "./hilfen-buchhaltung";
import { aufrufe, grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";
import { erstelleTestApp, idVon, legePersonAn, person, type Testperson } from "./hilfen-auth";

/** Eigene Belegarten (Issue #52): Anlegen, Rechte, Vorlage, Erzeugung, Nummernkreis, PDF. */

const { db, pool } = oeffneTestdb();
const dateien = new Map<string, Uint8Array>();
const speicher: Speicher = {
  async schreibe(k, d) {
    dateien.set(k, d);
  },
  async lese(k) {
    const d = dateien.get(k);
    if (!d) throw new Error("fehlt");
    return d;
  },
};
const t = erstelleTestApp(db, { speicher });
const { post } = aufrufe(t);
const F1 = ID.fonds;
const F2 = ID.anderer;

const verwalter = person("ba-verwalter", { rollen: { [F1]: "verwalter" } });
const erst = person("ba-erst", { rollen: { [F1]: "freigeber" } });
const pruefer = person("ba-pruefer", { rollen: { [F1]: "freigeber" } });
const freigeber = person("ba-freigeber", { rollen: { [F1]: "freigeber" } });
const bearbeiter = person("ba-bearbeiter", { rollen: { [F1]: "bearbeiter" } });
const betrachter = person("ba-betrachter", { rollen: { [F1]: "betrachter" } });
const fremd = person("ba-fremd", { rollen: { [F2]: "verwalter" } });

const anfrage = (methode: string, pfad: string, als: Testperson, body?: unknown) =>
  t.request(pfad, { method: methode, als, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const text = async (bytes: Uint8Array) => (await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true })).text.toLowerCase();

const artAnlegen = async (extra: object = {}, als: Testperson = verwalter) => anfrage("POST", `/fonds/${F1}/belegarten`, als, { basisArt: "auszahlung", bezeichnungDe: "Abruf Sonderprogramm", bezeichnungEn: "Special programme call", ...extra });

async function auszahlungAnlegen(): Promise<string> {
  await post(`/beteiligungen/${ID.darlehen}/vorgaenge`, { art: "zusage", valuta: "2026-01-01", betrag: "200000" });
  const antwort = await post(`/beteiligungen/${ID.darlehen}/vorgaenge`, { art: "auszahlung", valuta: "2026-03-31", betrag: "100000" });
  expect(antwort.status).toBe(201);
  return (await json(antwort)).vorgang.id;
}
const belegAnlegen = async (body: object, als: Testperson = erst) => {
  const antwort = await anfrage("POST", "/belege", als, { sprache: "de", ...body });
  return { antwort, beleg: await json(antwort) };
};

beforeEach(async () => {
  await grundbestand(db);
  await buchhaltungAufsetzen(db, F1);
  await mittelartenAufsetzen(db, F1);
  for (const p of [verwalter, erst, pruefer, freigeber, bearbeiter, betrachter, fremd]) await legePersonAn(db, p);
  dateien.clear();
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Eigene Belegarten anlegen und verwalten", () => {
  it("anlegen: nur verwalter des Fonds; Eingabe wird geprüft; Name je Fonds eindeutig; im Protokoll", async () => {
    for (const p of [freigeber, bearbeiter, betrachter, fremd]) expect((await artAnlegen({}, p)).status, p.name).toBe(403);
    const antwort = await artAnlegen();
    expect(antwort.status).toBe(201);
    const art = await json(antwort);
    expect(art).toMatchObject({ fondsId: F1, basisArt: "auszahlung", bezeichnungDe: "Abruf Sonderprogramm", bezeichnungEn: "Special programme call", aktiv: true });
    expect((await protokollZeilen(db, "beleg_art_eigen", "anlegen")).length).toBe(1);
    expect((await artAnlegen({ bezeichnungDe: "ABRUF sonderprogramm" })).status).toBe(400);
    expect((await artAnlegen({ basisArt: "gibt_es_nicht", bezeichnungDe: "X" })).status).toBe(400);
    expect((await artAnlegen({ bezeichnungDe: "  " })).status).toBe(400);
    expect((await artAnlegen({ bezeichnungEn: "" , bezeichnungDe: "Zwei" })).status).toBe(400);
  });

  it("Liste: feste Arten zuerst unverändert, danach die eigene mit Basis-Art, Katalog der Basis-Art und Standardvorlage", async () => {
    const art = await json(await artAnlegen());
    const liste = (await json(await anfrage("GET", `/fonds/${F1}/belegvorlagen`, betrachter))).daten as { art: string; eigeneArtId: string | null; standard: boolean; aktiv: boolean; bezeichnungDe: string | null; katalog: unknown[]; felder: unknown[] }[];
    expect(liste.slice(0, 7).map((v) => v.eigeneArtId)).toEqual(Array(7).fill(null));
    const eigene = liste[7]!;
    expect(liste).toHaveLength(8);
    expect(eigene).toMatchObject({ art: "auszahlung", eigeneArtId: art.id, standard: true, aktiv: true, bezeichnungDe: "Abruf Sonderprogramm" });
    expect(eigene.katalog).toEqual(liste.find((v) => v.art === "auszahlung")!.katalog);
    // Ein anderer Fonds sieht sie nicht.
    expect((await anfrage("GET", `/fonds/${F1}/belegvorlagen`, fremd)).status).toBe(403);
  });

  it("ändern und stilllegen: Basis-Art bleibt; fremder Fonds und unbekannte Id sind 404", async () => {
    const art = await json(await artAnlegen());
    const neu = { bezeichnungDe: "Abruf Plus", bezeichnungEn: "Call plus", aktiv: false };
    expect((await anfrage("PUT", `/fonds/${F1}/belegarten/${art.id}`, bearbeiter, neu)).status).toBe(403);
    const geaendert = await anfrage("PUT", `/fonds/${F1}/belegarten/${art.id}`, verwalter, neu);
    expect(geaendert.status).toBe(200);
    expect(await json(geaendert)).toMatchObject({ ...neu, basisArt: "auszahlung" });
    const verwalter2 = person("ba-verwalter2", { rollen: { [F2]: "verwalter" } });
    await legePersonAn(db, verwalter2);
    expect((await anfrage("PUT", `/fonds/${F2}/belegarten/${art.id}`, verwalter2, neu)).status).toBe(404);
    expect((await anfrage("PUT", `/fonds/${F1}/belegarten/${ID.fonds}`, verwalter, neu)).status).toBe(404);
  });

  it("Vorlage einer eigenen Art: eigene Felder und Pflicht, Kopf- und Fußtext; die Standardvorlage der festen Art bleibt unberührt", async () => {
    const art = await json(await artAnlegen());
    const vorlage = { felder: [{ schluessel: "betrag", abschnitt: "kopf", pflicht: true }, { schluessel: "projektnummer", abschnitt: "details", pflicht: true, bezeichnungDe: "Vorhaben", bezeichnungEn: "Project" }], kopfDe: "Kopf eigen", kopfEn: "Header", fussDe: "Fuß eigen", fussEn: "Footer" };
    expect((await anfrage("PUT", `/fonds/${F1}/belegvorlagen/${art.id}`, freigeber, vorlage)).status).toBe(403);
    expect((await anfrage("PUT", `/fonds/${F1}/belegvorlagen/${art.id}`, verwalter, vorlage)).status).toBe(200);
    // Feld, das es in der Basis-Art nicht gibt
    const falsch = await anfrage("PUT", `/fonds/${F1}/belegvorlagen/${art.id}`, verwalter, { ...vorlage, felder: [{ schluessel: "kaufpreis", abschnitt: "kopf", pflicht: false }] });
    expect(falsch.status).toBe(400);
    expect((await anfrage("PUT", `/fonds/${F1}/belegvorlagen/${F1}`, verwalter, vorlage)).status).toBe(404);
    const liste = (await json(await anfrage("GET", `/fonds/${F1}/belegvorlagen`, betrachter))).daten as { art: string; eigeneArtId: string | null; standard: boolean; felder: unknown[]; kopfDe: string }[];
    expect(liste.find((v) => v.eigeneArtId === art.id)).toMatchObject({ standard: false, kopfDe: "Kopf eigen" });
    expect(liste.find((v) => v.art === "auszahlung" && v.eigeneArtId === null)).toMatchObject({ standard: true, kopfDe: "" });
    // zweimal speichern ändert dieselbe Zeile
    expect((await anfrage("PUT", `/fonds/${F1}/belegvorlagen/${art.id}`, verwalter, { ...vorlage, kopfDe: "Neu" })).status).toBe(200);
    expect(await db.select().from(s.belegVorlage).where(eq(s.belegVorlage.eigeneArtId, art.id))).toHaveLength(1);
  });

  it("löschen: nur ohne Belege (sonst 409, dann stilllegen); die Vorlage entfällt mit", async () => {
    const art = await json(await artAnlegen());
    await anfrage("PUT", `/fonds/${F1}/belegvorlagen/${art.id}`, verwalter, { felder: [{ schluessel: "betrag", abschnitt: "kopf", pflicht: true }], kopfDe: "", kopfEn: "", fussDe: "", fussEn: "" });
    const vorgangId = await auszahlungAnlegen();
    const { beleg } = await belegAnlegen({ art: "auszahlung", eigeneArtId: art.id, bezugArt: "vorgang", bezugId: vorgangId });
    expect((await anfrage("DELETE", `/fonds/${F1}/belegarten/${art.id}`, freigeber)).status).toBe(403);
    const gesperrt = await anfrage("DELETE", `/fonds/${F1}/belegarten/${art.id}`, verwalter);
    expect(gesperrt.status).toBe(409);
    expect((await json(gesperrt)).fehler.code).toBe("BELEGART_IN_VERWENDUNG");
    await db.delete(s.belegStufe);
    await db.delete(s.beleg).where(eq(s.beleg.id, beleg.id));
    expect((await anfrage("DELETE", `/fonds/${F1}/belegarten/${art.id}`, verwalter)).status).toBe(204);
    expect(await db.select().from(s.belegVorlage).where(eq(s.belegVorlage.eigeneArtId, art.id))).toHaveLength(0);
    expect((await anfrage("DELETE", `/fonds/${F1}/belegarten/${art.id}`, verwalter)).status).toBe(404);
  });
});

describe("Belege einer eigenen Art", () => {
  it("erzeugt wie die Basis-Art (Vorbefüllung), mit Vorlage der eigenen Art; Standard- und eigener Beleg zum selben Vorgang koexistieren, doppelt ist 409", async () => {
    const art = await json(await artAnlegen());
    await anfrage("PUT", `/fonds/${F1}/belegvorlagen/${art.id}`, verwalter, {
      felder: [{ schluessel: "betrag", abschnitt: "kopf", pflicht: true }, { schluessel: "projektnummer", abschnitt: "details", pflicht: true }],
      kopfDe: "Kopf eigen", kopfEn: "", fussDe: "Fuß eigen", fussEn: "",
    });
    const vorgangId = await auszahlungAnlegen();
    const { antwort, beleg } = await belegAnlegen({ art: "auszahlung", eigeneArtId: art.id, bezugArt: "vorgang", bezugId: vorgangId });
    expect(antwort.status).toBe(201);
    expect(beleg).toMatchObject({ art: "auszahlung", eigeneArtId: art.id, beteiligungId: ID.darlehen });
    expect(beleg.daten.werte.betrag).toBe("100000.00");
    expect(beleg.vorlage.kopfDe).toBe("Kopf eigen");
    // Pflichtfeld der eigenen Vorlage fehlt (keine Projektnummer): Befund
    expect(beleg.befunde).toEqual([{ feld: "projektnummer", code: "pflichtfeld_fehlt" }]);
    expect((await belegAnlegen({ art: "auszahlung", eigeneArtId: art.id, bezugArt: "vorgang", bezugId: vorgangId })).antwort.status).toBe(409);
    // Der Standardbeleg zum selben Vorgang bleibt möglich und nutzt die Standardvorlage.
    const standard = await belegAnlegen({ art: "auszahlung", bezugArt: "vorgang", bezugId: vorgangId });
    expect(standard.antwort.status).toBe(201);
    expect(standard.beleg).toMatchObject({ eigeneArtId: null });
    expect(standard.beleg.vorlage.kopfDe).toBe("");
    expect((await belegAnlegen({ art: "auszahlung", bezugArt: "vorgang", bezugId: vorgangId })).antwort.status).toBe(409);
  });

  it("Bezug muss zur Basis-Art passen; Art und eigene Art müssen zusammenpassen; stillgelegt und fremde Art werden abgelehnt", async () => {
    const art = await json(await artAnlegen());
    const vorgangId = await auszahlungAnlegen();
    const falscheArt = await belegAnlegen({ art: "zinsbuchung", eigeneArtId: art.id, bezugArt: "vorgang", bezugId: vorgangId });
    expect(falscheArt.antwort.status).toBe(400);
    const unbekannt = await belegAnlegen({ art: "auszahlung", eigeneArtId: F1, bezugArt: "vorgang", bezugId: vorgangId });
    expect(unbekannt.antwort.status).toBe(404);
    expect(unbekannt.beleg.fehler.code).toBe("BELEGART_NICHT_GEFUNDEN");
    // Bezugsart der Basis-Art gilt weiter: eine Auszahlung braucht einen Vorgang.
    expect((await belegAnlegen({ art: "auszahlung", eigeneArtId: art.id, bezugArt: "zinslauf", bezugId: vorgangId })).antwort.status).toBe(404);
    await anfrage("PUT", `/fonds/${F1}/belegarten/${art.id}`, verwalter, { bezeichnungDe: "Abruf Sonderprogramm", bezeichnungEn: "x", aktiv: false });
    const still = await belegAnlegen({ art: "auszahlung", eigeneArtId: art.id, bezugArt: "vorgang", bezugId: vorgangId });
    expect(still.antwort.status).toBe(409);
    expect(still.beleg.fehler.code).toBe("BELEGART_STILLGELEGT");
  });

  it("Freigabe teilt den Nummernkreis des Fonds mit den festen Arten; das PDF trägt Namen, Kopf- und Fußtext; Liste und Detail nennen den Namen", async () => {
    const art = await json(await artAnlegen());
    await anfrage("PUT", `/fonds/${F1}/belegvorlagen/${art.id}`, verwalter, {
      felder: [{ schluessel: "betrag", abschnitt: "kopf", pflicht: true }],
      kopfDe: "Kopfzeile Sonderprogramm", kopfEn: "", fussDe: "Fusszeile Sonderprogramm", fussEn: "",
    });
    const vorgangId = await auszahlungAnlegen();
    const standard = (await belegAnlegen({ art: "auszahlung", bezugArt: "vorgang", bezugId: vorgangId })).beleg;
    const eigen = (await belegAnlegen({ art: "auszahlung", eigeneArtId: art.id, bezugArt: "vorgang", bezugId: vorgangId })).beleg;
    for (const b of [standard, eigen]) {
      expect((await anfrage("POST", `/belege/${b.id}/stufe`, pruefer, { stufe: "Prüfung", ergebnis: "ok" })).status).toBe(200);
      expect((await anfrage("POST", `/belege/${b.id}/stufe`, freigeber, { stufe: "Freigabe", ergebnis: "ok" })).status).toBe(200);
    }
    const nummern = await db.select({ id: s.beleg.id, nummer: s.beleg.belegnummer }).from(s.beleg);
    expect(nummern.map((n) => n.nummer).sort()).toEqual(["B-000001", "B-000002"]);

    const pdf = await anfrage("GET", `/belege/${eigen.id}/datei`, betrachter);
    expect(pdf.status).toBe(200);
    const inhalt = await text(new Uint8Array(await pdf.arrayBuffer()));
    expect(inhalt).toContain("abruf sonderprogramm");
    expect(inhalt).toContain("kopfzeile sonderprogramm");
    expect(inhalt).toContain("fusszeile sonderprogramm");
    const standardPdf = await text(new Uint8Array(await (await anfrage("GET", `/belege/${standard.id}/datei`, betrachter)).arrayBuffer()));
    expect(standardPdf).not.toContain("abruf sonderprogramm");

    const detail = await json(await anfrage("GET", `/belege/${eigen.id}`, betrachter));
    expect(detail).toMatchObject({ eigeneArtId: art.id, artNameDe: "Abruf Sonderprogramm", artNameEn: "Special programme call" });
    const liste = (await json(await anfrage("GET", `/belege?fondsId=${F1}&eigeneArtId=${art.id}`, betrachter))).daten as { id: string; artNameDe: string }[];
    expect(liste.map((b) => [b.id, b.artNameDe])).toEqual([[eigen.id, "Abruf Sonderprogramm"]]);
    // Eine später umbenannte oder stillgelegte Art ändert das freigegebene PDF nicht (unveränderliche Datei).
    const vorher = (await db.select({ h: s.beleg.dateiSha256 }).from(s.beleg).where(eq(s.beleg.id, eigen.id)))[0]!.h;
    await anfrage("PUT", `/fonds/${F1}/belegarten/${art.id}`, verwalter, { bezeichnungDe: "Neuer Name", bezeichnungEn: "New", aktiv: false });
    expect(vorher).toBe((await db.select({ h: s.beleg.dateiSha256 }).from(s.beleg).where(eq(s.beleg.id, eigen.id)))[0]!.h);
  });

  it("neu befüllen behält die eigene Art und nimmt die aktuelle Vorlage der eigenen Art", async () => {
    const art = await json(await artAnlegen());
    const vorgangId = await auszahlungAnlegen();
    const { beleg } = await belegAnlegen({ art: "auszahlung", eigeneArtId: art.id, bezugArt: "vorgang", bezugId: vorgangId });
    await anfrage("PUT", `/fonds/${F1}/belegvorlagen/${art.id}`, verwalter, { felder: [{ schluessel: "betrag", abschnitt: "kopf", pflicht: true }], kopfDe: "Neuer Kopf", kopfEn: "", fussDe: "", fussEn: "" });
    const neu = await json(await anfrage("POST", `/belege/${beleg.id}/neu-befuellen`, bearbeiter));
    expect(neu).toMatchObject({ eigeneArtId: art.id });
    expect(neu.vorlage.kopfDe).toBe("Neuer Kopf");
  });
});

describe("Manuelle Belegfelder und freie Vorgangsbezüge", () => {
  const feld = (manuell: string, pflicht = false) => ({ schluessel: `eigen_${manuell}`, manuell, abschnitt: "details", pflicht, bezeichnungDe: `Zusatz ${manuell}`, bezeichnungEn: `Additional ${manuell}` });
  const vorlage = { felder: [feld("text", true), feld("betrag"), feld("datum")], kopfDe: "", kopfEn: "", fussDe: "", fussEn: "" };
  async function freieVorlage() {
    const art = await json(await artAnlegen({ basisArt: "frei" }));
    const pfad = `/fonds/${F1}/belegvorlagen/${art.id}`;
    expect((await anfrage("PUT", pfad, verwalter, vorlage)).status).toBe(200);
    const zusage = await json(await post(`/beteiligungen/${ID.darlehen}/vorgaenge`, { art: "zusage", valuta: "2026-02-12", betrag: "3000" }));
    return { pfad, bezug: { art: "frei", eigeneArtId: art.id, bezugArt: "vorgang", bezugId: zusage.vorgang.id } };
  }

  it("prüft eigene Felddefinitionen und schützt feste Arten und Geschäftsfelder", async () => {
    const { pfad, bezug } = await freieVorlage();
    expect((await anfrage("PUT", `/fonds/${F1}/belegvorlagen/auszahlung`, verwalter, vorlage)).status).toBe(400);
    for (const f of [{ ...feld("text"), schluessel: "betrag" }, feld("zahl"), { ...feld("text"), bezeichnungDe: "" }]) {
      expect((await anfrage("PUT", pfad, verwalter, { ...vorlage, felder: [f] })).status).toBe(400);
    }
    expect((await belegAnlegen({ ...bezug, eigeneArtId: undefined })).antwort.status).toBe(400);
    expect((await belegAnlegen({ ...bezug, art: "auszahlung", eigeneArtId: undefined })).antwort.status).toBe(409);
    for (const werte of [{ eigen_datum: "2026-02-29" }, { eigen_betrag: "1.234" }, { eigen_text: 42 }, { betrag: "99" }, { eigen_fremd: "x" }]) {
      expect((await belegAnlegen({ ...bezug, werte })).antwort.status).toBe(400);
    }
  });

  it("prüft Pflicht und Typ am Entwurf, erhält Werte beim Neubefüllen und schützt den geprüften Stand", async () => {
    const { bezug, pfad } = await freieVorlage();
    const { antwort, beleg } = await belegAnlegen({ ...bezug, werte: { eigen_text: "  ", eigen_betrag: "0", eigen_datum: "2028-02-29" } });
    expect(antwort.status).toBe(201);
    expect(beleg.daten.werte).toMatchObject({ betrag: "3000.00", eigen_text: null, eigen_betrag: "0.00", eigen_datum: "2028-02-29" });
    expect(beleg.befunde).toEqual([{ feld: "eigen_text", code: "pflichtfeld_fehlt" }]);
    const pruefen = () => anfrage("POST", `/belege/${beleg.id}/stufe`, pruefer, { stufe: "Prüfung", ergebnis: "ok" });
    expect((await json(await pruefen())).fehler.code).toBe("BELEG_PFLICHTFELD_FEHLT");
    const aendern = (wer: Testperson, werte: object) => anfrage("PATCH", `/belege/${beleg.id}/feldwerte`, wer, { werte });
    for (const wer of [betrachter, fremd]) expect((await aendern(wer, { eigen_text: "x" })).status).toBe(403);
    const [rolle] = await db.insert(s.rechterolle).values({ name: "Portfolio", bereiche: ["portfolio"] }).returning();
    const [gruppe] = await db.insert(s.nutzergruppe).values({ name: "Portfolio", stufe: "verwalter", fondsBeschraenkt: false }).returning();
    await db.insert(s.nutzergruppeRolle).values({ gruppeId: gruppe!.id, rolleId: rolle!.id });
    await db.insert(s.nutzergruppeMitglied).values({ gruppeId: gruppe!.id, benutzerId: await idVon(db, erst) });
    expect((await aendern(erst, { eigen_text: "x" })).status).toBe(403);
    expect((await belegAnlegen(bezug, erst)).antwort.status).toBe(403);
    expect((await aendern(bearbeiter, { eigen_betrag: "ungültig" })).status).toBe(400);
    expect(await json(await aendern(bearbeiter, { eigen_text: " Eingangsbeleg " }))).toMatchObject({ befunde: [], daten: { werte: { eigen_text: "Eingangsbeleg", eigen_betrag: "0.00" } } });
    await anfrage("PUT", pfad, verwalter, { ...vorlage, felder: [feld("text", true), { ...feld("betrag"), manuell: "datum" }] });
    const neu = await json(await anfrage("POST", `/belege/${beleg.id}/neu-befuellen`, bearbeiter));
    expect(neu.daten.werte).toMatchObject({ eigen_text: "Eingangsbeleg" });
    expect(neu.daten.werte.eigen_betrag).toBeUndefined();
    expect(neu.daten.werte.eigen_datum).toBeUndefined();
    expect((await pruefen()).status).toBe(200);
    expect((await aendern(bearbeiter, { eigen_text: "Änderung" })).status).toBe(409);
    const pdf = await anfrage("GET", `/belege/${beleg.id}/datei`, betrachter);
    expect(await text(new Uint8Array(await pdf.arrayBuffer()))).toContain("eingangsbeleg");
  });
});
