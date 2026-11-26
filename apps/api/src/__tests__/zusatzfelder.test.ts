import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, idVon, legePersonAn, person } from "./hilfen-auth";
import { aufrufe, grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const { get, post, put } = aufrufe(t);

const F1 = ID.fonds;
const F2 = ID.anderer;
const RUNDE = "00000000-0000-4000-8000-0000000000d1";
const ADMIN = person("zf-admin", { globalVerwalter: true });
const bearbeiter = person("zf-bearbeiter", { rollen: { [F1]: "bearbeiter" } });
const betrachter = person("zf-betrachter", { rollen: { [F1]: "betrachter" } });
const fremder = person("zf-fremd", { rollen: { [F2]: "bearbeiter" } });
const verwalter = person("zf-verwalter", { rollen: { [F1]: "verwalter" } });

type Objekt = "fonds" | "runde" | "instrument" | "beteiligung" | "vorgang";
const ids: Record<string, string> = {};

async function definiere(objekt: Objekt, name: string, typ: string, optionen?: unknown) {
  const antwort = await post("/crm/felder", { objekt, name, typ, ...(optionen ? { optionen } : {}) }, ADMIN);
  expect(antwort.status, `${objekt}/${name}: ${await antwort.clone().text()}`).toBe(201);
  return (await json(antwort)).id as string;
}
const setze = (pfad: string, werte: Record<string, unknown>, als = ADMIN) => put(pfad, { werte }, als);

beforeEach(async () => {
  await grundbestand(db);
  for (const p of [ADMIN, bearbeiter, betrachter, fremder, verwalter]) await legePersonAn(db, p);
  await db.insert(s.finanzierungsrunde).values({ id: RUNDE, organisationId: ID.orgA, bezeichnung: "Serie A", datum: "2025-03-01", preMoney: "1000000.00", postMoney: "1500000.00", preisJeAnteil: "10.0000", anteileGesamtNach: "150000", status: "abgeschlossen" });
  await db.insert(s.rundenposition).values({ rundeId: RUNDE, fondsId: F1, betrag: "500000.00", anteile: "50000", rolle: "lead" });
  ids.text = await definiere("fonds", "Strategie", "text");
  ids.zahl = await definiere("fonds", "Mitarbeiter", "zahl");
  ids.betrag = await definiere("fonds", "Lizenzgebühr", "betrag");
  ids.datum = await definiere("fonds", "Prüftermin", "datum");
  ids.wahl = await definiere("fonds", "Risikoklasse", "auswahl", { optionen: [{ schluessel: "niedrig", label: "Niedrig", farbe: "blau" }, { schluessel: "hoch", label: "Hoch", farbe: "rose" }] });
  ids.mehr = await definiere("fonds", "Märkte", "mehrfachauswahl", { optionen: [{ schluessel: "de", label: "DE", farbe: "grau" }, { schluessel: "fr", label: "FR", farbe: "grau" }] });
  ids.haken = await definiere("fonds", "Geprüft", "kontrollkaestchen");
  ids.url = await definiere("fonds", "Merkblatt", "url");
  ids.mail = await definiere("fonds", "Kontaktadresse", "email");
  ids.tel = await definiere("fonds", "Rufnummer", "telefon");
  ids.person = await definiere("fonds", "Zuständig", "benutzer");
  ids.link = await definiere("fonds", "Hauptunternehmen", "verknuepfung", { ziel: "organisation" });
  ids.runde = await definiere("runde", "Lead-Investor", "text");
  ids.beteiligung = await definiere("beteiligung", "Board-Sitz", "kontrollkaestchen");
  ids.instrument = await definiere("instrument", "Sicherheit", "text");
  ids.vorgang = await definiere("vorgang", "Projektnummer", "text");
  ids.vorgangWahl = await definiere("vorgang", "Kostenart", "auswahl", { optionen: [{ schluessel: "recht", label: "Recht", farbe: "grau" }, { schluessel: "dd", label: "Prüfung", farbe: "grau" }] });
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Felddefinitionen für alle Objekte", () => {
  it("globale Verwalter definieren, andere nicht; Schlüssel sind je Objekt eindeutig", async () => {
    expect((await post("/crm/felder", { objekt: "fonds", name: "Neu", typ: "text" }, bearbeiter)).status).toBe(403);
    // gleicher Name an einem anderen Objekt ist kein Konflikt, am selben schon
    expect((await post("/crm/felder", { objekt: "beteiligung", name: "Strategie", typ: "text" }, ADMIN)).status).toBe(201);
    const doppelt = await post("/crm/felder", { objekt: "fonds", name: "Strategie", typ: "text" }, ADMIN);
    expect(doppelt.status).toBe(409);
    expect((await json(doppelt)).fehler.code).toBe("FELD_SCHLUESSEL_VORHANDEN");
    // Felder einer Liste gibt es nur für CRM-Objekte
    const liste = await post("/crm/listen", { name: "Testliste", objekt: "organisation" }, ADMIN);
    expect(liste.status).toBe(201);
    expect((await post("/crm/felder", { objekt: "fonds", listeId: (await json(liste)).id, name: "Zusatz", typ: "text" }, ADMIN)).status).toBe(400);
  });

  it("Definitionen lesen: aktive für alle mit Rolle, archivierte nur für globale Verwalter; Schema nennt Typ und Optionen", async () => {
    const liste = await get("/zusatzfelder/fonds/definitionen", betrachter).then(json);
    expect(liste.daten.map((d: { name: string }) => d.name)).toContain("Risikoklasse");
    expect((await post(`/crm/felder/${ids.haken}/archivieren`, {}, ADMIN)).status).toBe(200);
    expect((await get("/zusatzfelder/fonds/definitionen", betrachter).then(json)).daten.some((d: { id: string }) => d.id === ids.haken)).toBe(false);
    expect((await get("/zusatzfelder/fonds/definitionen?archiviert=1", betrachter).then(json)).daten.some((d: { id: string }) => d.id === ids.haken)).toBe(false);
    expect((await get("/zusatzfelder/fonds/definitionen?archiviert=1", ADMIN).then(json)).daten.some((d: { id: string }) => d.id === ids.haken)).toBe(true);
    const schema = await get("/zusatzfelder/fonds/schema", betrachter).then(json);
    expect(schema.type).toBe("object");
    expect(schema.properties[ids.wahl!]).toMatchObject({ type: "string", enum: ["niedrig", "hoch"], "x-feld-typ": "auswahl" });
    expect(schema.properties[ids.betrag!]).toMatchObject({ type: "string" });
    expect(schema.properties[ids.haken!]).toBeUndefined();
  });
});

describe("Werte am Fonds: je Typ geprüft", () => {
  it("speichert gültige Werte jedes Typs und liest sie mit Definition zurück", async () => {
    const antwort = await setze(`/fonds/${F1}/felder`, {
      [ids.text!]: "Frühphase Software",
      [ids.zahl!]: "12.5",
      [ids.betrag!]: "1000.50",
      [ids.datum!]: "2026-01-31",
      [ids.wahl!]: "hoch",
      [ids.mehr!]: ["de", "fr"],
      [ids.haken!]: true,
      [ids.url!]: "https://beispiel.example/merkblatt",
      [ids.mail!]: "info@beispiel.example",
      [ids.tel!]: "+49 30 1234567",
      [ids.person!]: await idVon(db, bearbeiter),
      [ids.link!]: ID.orgA,
    });
    expect(antwort.status, await antwort.clone().text()).toBe(200);
    const daten = await json(antwort);
    expect(daten.werte[ids.zahl!]).toBe("12.5");
    expect(daten.werte[ids.mehr!]).toEqual(["de", "fr"]);
    const feld = daten.felder.find((f: { id: string }) => f.id === ids.wahl);
    expect(feld).toMatchObject({ name: "Risikoklasse", typ: "auswahl", wert: "hoch", archiviert: false });
  });

  it.each([
    ["text", () => ids.text!, ""],
    ["zahl", () => ids.zahl!, "zwölf"],
    ["betrag", () => ids.betrag!, "10.123"],
    ["datum", () => ids.datum!, "31.01.2026"],
    ["auswahl", () => ids.wahl!, "mittel"],
    ["mehrfachauswahl", () => ids.mehr!, ["de", "de"]],
    ["kontrollkaestchen", () => ids.haken!, "ja"],
    ["url", () => ids.url!, "javascript:alert(1)"],
    ["email", () => ids.mail!, "keine-adresse"],
    ["telefon", () => ids.tel!, "abc"],
    ["benutzer", () => ids.person!, "00000000-0000-4000-8000-00000000dead"],
    ["verknuepfung", () => ids.link!, "00000000-0000-4000-8000-00000000dead"],
  ])("lehnt ungültige Werte ab: %s", async (_typ, id, wert) => {
    const antwort = await setze(`/fonds/${F1}/felder`, { [id()]: wert });
    expect(antwort.status).toBe(400);
    expect((await json(antwort)).fehler.code).toBe("FELDWERT_UNGUELTIG");
    expect((await db.execute(sql`SELECT felder FROM fonds WHERE id = ${F1}`)).rows[0]).toEqual({ felder: {} });
  });

  it("unbekannte und archivierte Felder werden abgelehnt, null entfernt einen Wert, ein Wert eines anderen Objekts passt nicht", async () => {
    expect((await setze(`/fonds/${F1}/felder`, { "00000000-0000-4000-8000-0000000000aa": "x" })).status).toBe(400);
    // Das Feld einer Beteiligung gehört nicht an den Fonds.
    expect((await setze(`/fonds/${F1}/felder`, { [ids.beteiligung!]: true })).status).toBe(400);
    expect((await setze(`/fonds/${F1}/felder`, { [ids.text!]: "A", [ids.haken!]: true })).status).toBe(200);
    const ohne = await setze(`/fonds/${F1}/felder`, { [ids.text!]: null }).then(json);
    expect(ohne.werte).toEqual({ [ids.haken!]: true });
    expect((await post(`/crm/felder/${ids.haken}/archivieren`, {}, ADMIN)).status).toBe(200);
    expect((await setze(`/fonds/${F1}/felder`, { [ids.haken!]: false })).status).toBe(400);
    // archivierte Felder mit Wert bleiben im Lesen sichtbar (die Historie geht nicht verloren)
    const lesen = await get(`/fonds/${F1}/felder`, ADMIN).then(json);
    expect(lesen.felder.find((f: { id: string }) => f.id === ids.haken)).toMatchObject({ archiviert: true, wert: true });
  });

  it("eine Option, die ein Fonds noch verwendet, lässt sich nicht entfernen", async () => {
    await setze(`/fonds/${F1}/felder`, { [ids.wahl!]: "hoch" });
    const antwort = await t.request(`/crm/felder/${ids.wahl}`, { method: "PATCH", als: ADMIN, headers: { "content-type": "application/json" }, body: JSON.stringify({ optionen: { optionen: [{ schluessel: "niedrig", label: "Niedrig", farbe: "blau" }] } }) });
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).fehler.code).toBe("FELD_OPTION_IN_GEBRAUCH");
  });

  it("die Benutzerprüfung folgt der Engine der CRM-Felder: eine Investor-Zugangsperson oder fremde ID ist keine Person im Haus", async () => {
    const antwort = await setze(`/fonds/${F1}/felder`, { [ids.person!]: "00000000-0000-4000-8000-0000000000bb" });
    expect(antwort.status).toBe(400);
  });
});

describe("Rechte", () => {
  it("Betrachter lesen, Bearbeiter schreiben, Fremde sehen nichts, Verwalter dürfen ebenfalls", async () => {
    expect((await setze(`/fonds/${F1}/felder`, { [ids.text!]: "Eins" }, betrachter)).status).toBe(403);
    expect((await get(`/fonds/${F1}/felder`, betrachter)).status).toBe(200);
    expect((await setze(`/fonds/${F1}/felder`, { [ids.text!]: "Zwei" }, bearbeiter)).status).toBe(200);
    expect((await get(`/fonds/${F1}/felder`, fremder)).status).toBe(403);
    expect((await setze(`/fonds/${F1}/felder`, { [ids.text!]: "Drei" }, fremder)).status).toBe(403);
    expect((await setze(`/fonds/${F1}/felder`, { [ids.text!]: "Vier" }, verwalter)).status).toBe(200);
    expect((await json(await get(`/fonds/${F1}/felder`, ADMIN))).werte[ids.text!]).toBe("Vier");
  });

  it("Beteiligung und Instrument haben getrennte Werte, jeweils mit der Rolle am Fonds", async () => {
    expect((await setze(`/beteiligungen/${ID.eigen}/felder`, { [ids.beteiligung!]: true }, bearbeiter)).status).toBe(200);
    expect((await setze(`/beteiligungen/${ID.eigen}/instrumentfelder`, { [ids.instrument!]: "Erstrangig" }, bearbeiter)).status).toBe(200);
    // Das Feld des Instruments gehört nicht an die Beteiligung und umgekehrt.
    expect((await setze(`/beteiligungen/${ID.eigen}/felder`, { [ids.instrument!]: "x" }, bearbeiter)).status).toBe(400);
    expect((await setze(`/beteiligungen/${ID.eigen}/instrumentfelder`, { [ids.beteiligung!]: true }, bearbeiter)).status).toBe(400);
    const zeile = (await db.execute(sql`SELECT felder, instrument_felder FROM beteiligung WHERE id = ${ID.eigen}`)).rows[0];
    expect(zeile).toEqual({ felder: { [ids.beteiligung!]: true }, instrument_felder: { [ids.instrument!]: "Erstrangig" } });
    expect((await setze(`/beteiligungen/${ID.eigen}/felder`, { [ids.beteiligung!]: false }, fremder)).status).toBe(403);
    expect((await setze(`/beteiligungen/${ID.eigen}/felder`, { [ids.beteiligung!]: false }, betrachter)).status).toBe(403);
    expect((await get(`/beteiligungen/${ID.eigen}/instrumentfelder`, betrachter)).status).toBe(200);
  });
});

describe("Finanzierungsrunde", () => {
  it("Werte an einer abgeschlossenen Runde sind änderbar (die Zahlen der Runde bleiben gesperrt)", async () => {
    const antwort = await setze(`/finanzierungsrunden/${RUNDE}/felder`, { [ids.runde!]: "Beispiel Ventures" }, bearbeiter);
    expect(antwort.status, await antwort.clone().text()).toBe(200);
    expect((await json(antwort)).werte[ids.runde!]).toBe("Beispiel Ventures");
    expect((await get(`/finanzierungsrunden/${RUNDE}/felder`, betrachter)).status).toBe(200);
    expect((await get(`/finanzierungsrunden/${RUNDE}/felder`, fremder)).status).toBe(403);
    expect((await setze(`/finanzierungsrunden/${RUNDE}/felder`, { [ids.runde!]: "x" }, betrachter)).status).toBe(403);
    expect((await setze(`/finanzierungsrunden/${RUNDE}/felder`, { [ids.runde!]: "x" }, fremder)).status).toBe(403);
  });

  it("liegt das Rundendatum in einer gesperrten Periode eines beteiligten Fonds, ist das Setzen gesperrt", async () => {
    expect((await put(`/fonds/${F1}/periodensperre`, { gesperrtBis: "2025-12-31" }, verwalter)).status).toBe(200);
    const antwort = await setze(`/finanzierungsrunden/${RUNDE}/felder`, { [ids.runde!]: "Gesperrt" }, bearbeiter);
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).fehler.code).toBe("PERIODE_GESPERRT");
    expect((await db.execute(sql`SELECT felder FROM finanzierungsrunde WHERE id = ${RUNDE}`)).rows[0]).toEqual({ felder: {} });
  });
});

describe("Vorgänge: Werte nur beim Anlegen", () => {
  const buchen = (koerper: Record<string, unknown>, als = bearbeiter) => post(`/beteiligungen/${ID.eigen}/vorgaenge`, koerper, als);

  it("Werte beim Anlegen werden geprüft und gespeichert, auch über die einheitliche Erfassung", async () => {
    const ok = await buchen({ art: "zusage", valuta: "2025-02-01", betrag: "100000.00", felder: { [ids.vorgang!]: "P-100", [ids.vorgangWahl!]: "recht" } });
    expect(ok.status, await ok.clone().text()).toBe(201);
    const vorgangId = (await json(ok)).vorgang.id as string;
    const gelesen = await get(`/vorgaenge/${vorgangId}/felder`, betrachter).then(json);
    expect(gelesen.werte).toEqual({ [ids.vorgang!]: "P-100", [ids.vorgangWahl!]: "recht" });
    const falsch = await buchen({ art: "auszahlung", valuta: "2025-02-02", betrag: "1.00", felder: { [ids.vorgangWahl!]: "nix" } });
    expect(falsch.status).toBe(400);
    // Ein Feld eines anderen Objekts gehört nicht an einen Vorgang, und der abgelehnte Vorgang ist nicht entstanden.
    expect((await buchen({ art: "auszahlung", valuta: "2025-02-02", betrag: "1.00", felder: { [ids.text!]: "x" } })).status).toBe(400);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM vorgang`)).rows[0]).toEqual({ n: 1 });
    const einheitlich = await post(`/fonds/${F1}/buchungen`, { typ: "auszahlung", beteiligungId: ID.eigen, valuta: "2025-02-03", betrag: "5.00", felder: { [ids.vorgang!]: "P-200" } }, bearbeiter);
    expect(einheitlich.status).toBe(201);
    expect((await json(await get(`/vorgaenge/${(await json(einheitlich)).vorgang.id}/felder`, ADMIN))).werte).toEqual({ [ids.vorgang!]: "P-200" });
  });

  it("die Zeile ist unveränderlich (Trigger), und es gibt keine Schreibroute für Vorgangswerte", async () => {
    const vorgangId = (await json(await buchen({ art: "zusage", valuta: "2025-02-01", betrag: "100.00", felder: { [ids.vorgang!]: "P-1" } }))).vorgang.id as string;
    await expect(pool.query(`UPDATE vorgang SET felder = '{}'::jsonb WHERE id = $1`, [vorgangId])).rejects.toMatchObject({ code: "23001" });
    const put405 = await setze(`/vorgaenge/${vorgangId}/felder`, { [ids.vorgang!]: "P-2" });
    expect([403, 404, 405]).toContain(put405.status);
    expect((await db.execute(sql`SELECT felder FROM vorgang WHERE id = ${vorgangId}`)).rows[0]).toEqual({ felder: { [ids.vorgang!]: "P-1" } });
  });

  it("ein Storno trägt die Werte des Originals", async () => {
    const vorgangId = (await json(await buchen({ art: "zusage", valuta: "2025-02-01", betrag: "100.00", felder: { [ids.vorgang!]: "P-9", [ids.vorgangWahl!]: "dd" } }))).vorgang.id as string;
    const storno = await post(`/vorgaenge/${vorgangId}/storno`, { grund: "Fehlbuchung" }, bearbeiter);
    expect(storno.status, await storno.clone().text()).toBe(201);
    const stornoId = (await json(storno)).storno.id as string;
    expect((await json(await get(`/vorgaenge/${stornoId}/felder`, ADMIN))).werte).toEqual({ [ids.vorgang!]: "P-9", [ids.vorgangWahl!]: "dd" });
  });

  it("die Periodensperre gilt auch für Vorgänge mit Werten; archivierte Felder sind beim Anlegen nicht erlaubt", async () => {
    expect((await put(`/fonds/${F1}/periodensperre`, { gesperrtBis: "2025-12-31" }, verwalter)).status).toBe(200);
    const gesperrt = await buchen({ art: "zusage", valuta: "2025-02-01", betrag: "10.00", felder: { [ids.vorgang!]: "P-3" } });
    expect(gesperrt.status).toBe(409);
    expect((await json(gesperrt)).fehler.code).toBe("PERIODE_GESPERRT");
    expect((await post(`/crm/felder/${ids.vorgang}/archivieren`, {}, ADMIN)).status).toBe(200);
    expect((await buchen({ art: "zusage", valuta: "2026-01-01", betrag: "10.00", felder: { [ids.vorgang!]: "P-4" } })).status).toBe(400);
  });

  it("ein unbekannter Vorgang und ein Stand vor der Erfassung geben 404", async () => {
    expect((await get(`/vorgaenge/00000000-0000-4000-8000-00000000dead/felder`, ADMIN)).status).toBe(404);
    const vorgangId = (await json(await buchen({ art: "zusage", valuta: "2025-02-01", betrag: "100.00", felder: { [ids.vorgang!]: "P-7" } }))).vorgang.id as string;
    expect((await get(`/vorgaenge/${vorgangId}/felder?stand=2000-01-01T00:00:00Z`, ADMIN)).status).toBe(404);
    expect((await get(`/vorgaenge/${vorgangId}/felder?stand=2999-01-01T00:00:00Z`, ADMIN)).status).toBe(200);
  });
});

describe("Wissensstand und Änderungsprotokoll", () => {
  it("jede Änderung steht mit Vorher und Nachher im Protokoll; ?stand= liefert die Werte der jeweiligen Zeit", async () => {
    await setze(`/fonds/${F1}/felder`, { [ids.text!]: "Erster Stand" }, bearbeiter);
    const t1 = new Date(Date.now() + 5).toISOString();
    await new Promise((r) => setTimeout(r, 25));
    await setze(`/fonds/${F1}/felder`, { [ids.text!]: "Zweiter Stand", [ids.zahl!]: "3" }, bearbeiter);
    const t2 = new Date(Date.now() + 5).toISOString();
    await new Promise((r) => setTimeout(r, 25));
    await setze(`/fonds/${F1}/felder`, { [ids.text!]: null }, bearbeiter);

    const log = await protokollZeilen(db, "fonds", "felder_setzen");
    expect(log).toHaveLength(3);
    expect(log[1]).toMatchObject({ akteur: await idVon(db, bearbeiter), vorher: { objekt: "fonds", felder: { [ids.text!]: "Erster Stand" } }, nachher: { objekt: "fonds", felder: { [ids.text!]: "Zweiter Stand", [ids.zahl!]: "3" } } });

    const lies = async (stand?: string) => (await json(await get(`/fonds/${F1}/felder${stand ? `?stand=${encodeURIComponent(stand)}` : ""}`, ADMIN))).werte;
    expect(await lies()).toEqual({ [ids.zahl!]: "3" });
    expect(await lies(t2)).toEqual({ [ids.text!]: "Zweiter Stand", [ids.zahl!]: "3" });
    expect(await lies(t1)).toEqual({ [ids.text!]: "Erster Stand" });
    // vor der ersten Änderung: der ursprüngliche Zustand (leer)
    expect(await lies("2000-01-01T00:00:00Z")).toEqual({});
  });

  it("eine Änderung ohne Wirkung schreibt kein Protokoll; Fonds mit Rolle sehen das Protokoll je Fonds", async () => {
    await setze(`/fonds/${F1}/felder`, { [ids.text!]: "Gleich" });
    await setze(`/fonds/${F1}/felder`, { [ids.text!]: "Gleich" });
    expect(await protokollZeilen(db, "fonds", "felder_setzen")).toHaveLength(1);
    const aenderungen = await get(`/aenderungen?fondsId=${F1}`, betrachter);
    expect(aenderungen.status).toBe(200);
  });

  it("Instrument- und Beteiligungswerte haben je ein eigenes Protokoll (Objekt im Inhalt) und eigenen Stand", async () => {
    await setze(`/beteiligungen/${ID.eigen}/felder`, { [ids.beteiligung!]: true });
    await new Promise((r) => setTimeout(r, 25));
    const dazwischen = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 25));
    await setze(`/beteiligungen/${ID.eigen}/instrumentfelder`, { [ids.instrument!]: "Erstrangig" });
    const instrument = await json(await get(`/beteiligungen/${ID.eigen}/instrumentfelder?stand=${encodeURIComponent(dazwischen)}`, ADMIN));
    expect(instrument.werte).toEqual({});
    expect((await json(await get(`/beteiligungen/${ID.eigen}/felder?stand=${encodeURIComponent(dazwischen)}`, ADMIN))).werte).toEqual({ [ids.beteiligung!]: true });
    expect((await json(await get(`/beteiligungen/${ID.eigen}/instrumentfelder`, ADMIN))).werte).toEqual({ [ids.instrument!]: "Erstrangig" });
  });
});

describe("Export und Schnittstelle", () => {
  it("der Vollexport enthält Definitionen und Werte (Spalten felder, instrument_felder)", async () => {
    const { EXPORT_TABELLEN } = await import("../export/vollexport");
    expect(EXPORT_TABELLEN.map((x) => x.name)).toEqual(expect.arrayContaining(["feld_definition", "fonds", "beteiligung", "vorgang", "finanzierungsrunde"]));
    await setze(`/fonds/${F1}/felder`, { [ids.text!]: "Im Export" });
    const zip = await t.request("/export?format=zip", { als: ADMIN });
    expect(zip.status).toBe(200);
    const { leseZip } = await import("./hilfen-zip");
    const dateien = leseZip(Buffer.from(await zip.arrayBuffer()));
    const schema = JSON.parse(dateien.get("schema.json")!.toString("utf8")) as { tabellen: Record<string, { spalten: { name: string }[] }> };
    for (const tabelle of ["fonds", "finanzierungsrunde", "beteiligung", "vorgang"]) expect(schema.tabellen[tabelle]!.spalten.map((x) => x.name)).toContain("felder");
    expect(schema.tabellen.beteiligung!.spalten.map((x) => x.name)).toContain("instrument_felder");
    expect(dateien.get("tabellen/fonds.csv")!.toString("utf8")).toContain("Im Export");
  });

  it("die OpenAPI beschreibt die Routen und das Schema der Werte", async () => {
    const doc = await json(await t.request("/openapi.json", { als: null }));
    for (const pfad of ["/fonds/{id}/felder", "/beteiligungen/{id}/felder", "/beteiligungen/{id}/instrumentfelder", "/finanzierungsrunden/{id}/felder", "/vorgaenge/{id}/felder", "/zusatzfelder/{objekt}/schema", "/zusatzfelder/{objekt}/definitionen"]) {
      expect(doc.paths[pfad], pfad).toBeDefined();
    }
    expect(doc.components.schemas.Zusatzfelder).toMatchObject({ type: "object", additionalProperties: true });
    const felder = doc.paths["/beteiligungen/{id}/vorgaenge"].post.requestBody.content["application/json"].schema;
    expect(JSON.stringify(felder)).toContain("felder");
  });
});
