import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, person } from "./hilfen-auth";
import { json, leeren, oeffneTestdb } from "./hilfen";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);

const ID = {
  fondsA: "00000000-0000-4000-8000-0000000000a1",
  fondsB: "00000000-0000-4000-8000-0000000000b1",
};
const ADMIN = person("crm2-admin", { globalVerwalter: true });
const BEA_A = person("crm2-bea-a", { rollen: { [ID.fondsA]: "bearbeiter" } });
const BET_A = person("crm2-bet-a", { rollen: { [ID.fondsA]: "betrachter" } });
const BEA_B = person("crm2-bea-b", { rollen: { [ID.fondsB]: "bearbeiter" } });

const senden = (methode: string) => (pfad: string, body?: unknown, als = ADMIN) =>
  t.request(`/crm${pfad}`, { method: methode, als, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const post = senden("POST");
const patch = senden("PATCH");
const del = senden("DELETE");
const get = (pfad: string, als = ADMIN) => t.request(`/crm${pfad}`, { als });

const o: Record<string, string> = {};
const p: Record<string, string> = {};
const d: Record<string, string> = {};

beforeAll(async () => {
  await leeren(db);
  await db.insert(s.fonds).values([
    { id: ID.fondsA, name: "Fonds A", kurzname: "FA", vintage: 2024, zeichnungskapital: "1000000.00" },
    { id: ID.fondsB, name: "Fonds B", kurzname: "FB", vintage: 2024, zeichnungskapital: "1000000.00" },
  ]);
  for (const name of ["Muster Alpha GmbH", "Muster Beta AG", "Muster Gamma KG"]) {
    const [r] = await db.insert(s.organisation).values({ name, art: "unternehmen" }).returning();
    o[name] = r!.id;
  }
  for (const [vor, nach, org] of [["Anna", "Alt", "Muster Alpha GmbH"], ["Ben", "Bauer", "Muster Alpha GmbH"], ["Cara", "Christ", null]] as const) {
    const [r] = await db.insert(s.person).values({ vorname: vor, nachname: nach, email: `${vor.toLowerCase()}@muster.example`, ...(org ? { organisationId: o[org] } : {}) }).returning();
    p[vor] = r!.id;
    if (org) await db.insert(s.beschaeftigung).values({ personId: r!.id, organisationId: o[org]!, haupt: true });
  }
  const dealWerte = [
    { titel: "Deal Offen A", fondsId: ID.fondsA, ticket: "100000.00", phase: "anfrage" as const },
    { titel: "Deal Offen B", fondsId: ID.fondsB, ticket: "250000.00", phase: "pruefung" as const },
    { titel: "Deal Ohne Fonds", fondsId: null, ticket: "50000.00", phase: "anfrage" as const },
  ];
  for (const w of dealWerte) {
    const [r] = await db.insert(s.deal).values({ organisationId: o["Muster Alpha GmbH"]!, ...w }).returning();
    d[w.titel] = r!.id;
  }
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Ansichten", () => {
  let privat = "";
  let geteilt = "";
  const konfig = { filter: { verknuepfung: "und", elemente: [{ feld: "art", operator: "ist", wert: "unternehmen" }] }, sortierung: [{ feld: "name", richtung: "ab" }], spalten: [{ feld: "name", breite: 240 }, { feld: "ort" }] };

  it("speichert privat, lädt, prüft Felder und hält Fremde heraus", async () => {
    const neu = await post("/ansichten", { objekt: "organisation", name: "Meine Sicht", konfig }, BEA_A);
    expect(neu.status).toBe(201);
    privat = (await json(neu)).id;
    const unbekannt = await post("/ansichten", { objekt: "organisation", name: "Kaputt", konfig: { ...konfig, spalten: [{ feld: "gibtsnicht" }] } }, BEA_A);
    expect(unbekannt.status).toBe(400);
    const eigene = await json(await get("/ansichten?objekt=organisation", BEA_A));
    expect(eigene.daten.map((a: { name: string }) => a.name)).toEqual(["Meine Sicht"]);
    expect((await json(await get("/ansichten?objekt=organisation", BEA_B))).daten).toEqual([]);
    expect((await patch(`/ansichten/${privat}`, { name: "Fremd" }, BEA_B)).status).toBe(404);
    expect((await del(`/ansichten/${privat}`, undefined, BEA_B)).status).toBe(404);
  });

  it("geteilte Ansichten sehen alle, ändern nur Besitzer und globale Verwalter", async () => {
    const neu = await post("/ansichten", { objekt: "organisation", name: "Team-Sicht", konfig, geteilt: true }, BEA_A);
    geteilt = (await json(neu)).id;
    const fremd = await json(await get("/ansichten?objekt=organisation", BEA_B));
    expect(fremd.daten.map((a: { name: string; bearbeitbar: boolean }) => [a.name, a.bearbeitbar])).toEqual([["Team-Sicht", false]]);
    const verboten = await patch(`/ansichten/${geteilt}`, { name: "Gekapert" }, BEA_B);
    expect(verboten.status).toBe(403);
    expect((await json(verboten)).fehler.code).toBe("ANSICHT_FREMD");
    expect((await del(`/ansichten/${geteilt}`, undefined, BEA_B)).status).toBe(403);
    expect((await patch(`/ansichten/${geteilt}`, { name: "Team-Sicht 2" }, BEA_A)).status).toBe(200);
    expect((await patch(`/ansichten/${geteilt}`, { name: "Team-Sicht 3" }, ADMIN)).status).toBe(200);
    expect((await patch(`/ansichten/${geteilt}`, { standard: true }, BEA_A)).status).toBe(403);
    const standard = await patch(`/ansichten/${geteilt}`, { standard: true }, ADMIN);
    expect((await json(standard)).standard).toBe(true);
    const liste = await json(await get("/ansichten?objekt=organisation", BEA_B));
    expect(liste.daten[0].standard).toBe(true);
  });

  it("die gespeicherte Konfiguration liefert dieselben Zeilen wie die direkte Abfrage", async () => {
    const gespeichert = (await json(await get("/ansichten?objekt=organisation", BEA_A))).daten.find((a: { id: string }) => a.id === privat);
    const antwort = await json(await post("/objekte/organisation/abfrage", gespeichert.konfig, BEA_A));
    expect(antwort.daten.map((z: { name: string }) => z.name)).toEqual(["Muster Gamma KG", "Muster Beta AG", "Muster Alpha GmbH"]);
  });

  it("Besitzer löscht", async () => {
    expect((await del(`/ansichten/${privat}`, undefined, BEA_A)).status).toBe(204);
  });
});

describe("Sichtbarkeit der Deals", () => {
  it("Abfrage, Detail, Verknüpfungen und Aufgaben zeigen keine Deals fremder Fonds", async () => {
    const abfrage = async (als: ReturnType<typeof person>) =>
      (await json(await post("/objekte/deal/abfrage", { spalten: [{ feld: "titel" }], filter: { verknuepfung: "oder", elemente: [{ feld: "titel", operator: "enthaelt", wert: "deal" }, { feld: "phase", operator: "ist", wert: "pruefung" }] } }, als))).daten.map((z: { titel: string }) => z.titel).sort();
    expect(await abfrage(BEA_A)).toEqual(["Deal Offen A", "Deal Ohne Fonds"]);
    expect(await abfrage(BEA_B)).toEqual(["Deal Offen B", "Deal Ohne Fonds"]);
    expect(await abfrage(ADMIN)).toEqual(["Deal Offen A", "Deal Offen B", "Deal Ohne Fonds"]);
    expect((await get(`/datensaetze/deal/${d["Deal Offen B"]}`, BEA_A)).status).toBe(404);
    expect((await get(`/datensaetze/deal/${d["Deal Offen A"]}`, BEA_A)).status).toBe(200);
    expect((await patch(`/datensaetze/deal/${d["Deal Offen B"]}`, { system: { quelle: "x" } }, BEA_A)).status).toBe(404);
    // Betrachter darf nicht schreiben
    expect((await patch(`/datensaetze/deal/${d["Deal Offen A"]}`, { system: { quelle: "x" } }, BET_A)).status).toBe(403);
    expect((await post("/aufgaben", { titel: "Heimlich", dealId: d["Deal Offen B"] }, BEA_A)).status).toBe(404);
  });

  it("OR-Zweige im Filter umgehen die Sichtbarkeit nicht", async () => {
    const antwort = await json(await post("/objekte/deal/abfrage", { spalten: [{ feld: "titel" }], filter: { verknuepfung: "oder", elemente: [{ feld: "titel", operator: "nicht_leer" }, { feld: "ticket", operator: "groesser", wert: "0" }] } }, BEA_A));
    expect(antwort.daten.map((z: { titel: string }) => z.titel).sort()).toEqual(["Deal Offen A", "Deal Ohne Fonds"]);
    expect(antwort.gesamt).toBe(2);
  });

  it("Verknüpfungsfeld zeigt den Namen eines fremden Deals nicht", async () => {
    const feldAntwort = await post("/felder", { objekt: "organisation", name: "Wichtigster Deal", typ: "verknuepfung", optionen: { ziel: "deal" } });
    const feld = (await json(feldAntwort)).id;
    expect((await patch(`/datensaetze/organisation/${o["Muster Beta AG"]}`, { eigene: { [feld]: d["Deal Offen B"] } })).status).toBe(200);
    const sicht = await json(await post("/objekte/organisation/abfrage", { spalten: [{ feld: "name" }, { feld: feld }], filter: { verknuepfung: "und", elemente: [{ feld: "name", operator: "ist", wert: "Muster Beta AG" }] } }, BEA_A));
    expect(sicht.bezuege[`deal:${d["Deal Offen B"]}`]).toBeNull();
    const admin = await json(await post("/objekte/organisation/abfrage", { spalten: [{ feld: "name" }, { feld: feld }], filter: { verknuepfung: "und", elemente: [{ feld: "name", operator: "ist", wert: "Muster Beta AG" }] } }));
    expect(admin.bezuege[`deal:${d["Deal Offen B"]}`]).toBe("Deal Offen B");
  });
});

describe("Listen", () => {
  let liste = "";
  it("legt an, verhindert Namensdoppel, fügt hinzu und zeigt Listenfelder", async () => {
    const neu = await post("/listen", { name: "Co-Investoren 2026", objekt: "organisation" }, BEA_A);
    expect(neu.status).toBe(201);
    liste = (await json(neu)).id;
    expect((await post("/listen", { name: "co-investoren 2026", objekt: "organisation" }, BEA_A)).status).toBe(409);
    expect((await post("/listen", { name: "Nur Betrachter", objekt: "organisation" }, BET_A)).status).toBe(403);
    const hin = await json(await post(`/listen/${liste}/eintraege`, { datensatzIds: [o["Muster Alpha GmbH"], o["Muster Beta AG"], p["Anna"], "00000000-0000-4000-8000-000000000099"] }, BEA_A));
    expect(hin).toEqual({ hinzugefuegt: 2, uebersprungen: 2 });
    expect((await json(await post(`/listen/${liste}/eintraege`, { datensatzIds: [o["Muster Alpha GmbH"]] }, BEA_A)))).toEqual({ hinzugefuegt: 0, uebersprungen: 1 });
    // Listenfeld: Besitzer darf, fremder Bearbeiter nicht
    expect((await post("/felder", { objekt: "organisation", listeId: liste, name: "Status Gespräch", typ: "auswahl", optionen: { optionen: [{ schluessel: "offen", label: "Offen", farbe: "signal" }, { schluessel: "erledigt", label: "Erledigt", farbe: "grau" }] } }, BEA_B)).status).toBe(403);
    const feldAntwort = await post("/felder", { objekt: "organisation", listeId: liste, name: "Status Gespräch", typ: "auswahl", optionen: { optionen: [{ schluessel: "offen", label: "Offen", farbe: "signal" }, { schluessel: "erledigt", label: "Erledigt", farbe: "grau" }] } }, BEA_A);
    expect(feldAntwort.status).toBe(201);
    const feld = (await json(feldAntwort)).id;
    expect((await patch(`/listen/${liste}/eintraege/${o["Muster Alpha GmbH"]}`, { felder: { [feld]: "offen" } }, BEA_A)).status).toBe(200);
    expect((await patch(`/listen/${liste}/eintraege/${o["Muster Alpha GmbH"]}`, { felder: { [feld]: "nope" } }, BEA_A)).status).toBe(400);
    const ansicht = await json(await post("/objekte/organisation/abfrage", { listeId: liste, spalten: [{ feld: "name" }, { feld }], sortierung: [{ feld: "name", richtung: "auf" }] }, BEA_A));
    expect(ansicht.daten.map((z: Record<string, unknown>) => [z.name, z[feld]])).toEqual([["Muster Alpha GmbH", "offen"], ["Muster Beta AG", null]]);
    expect(ansicht.gesamt).toBe(2);
    const gefiltert = await json(await post("/objekte/organisation/abfrage", { listeId: liste, spalten: [{ feld: "name" }], filter: { verknuepfung: "und", elemente: [{ feld, operator: "ist", wert: "offen" }] } }, BEA_A));
    expect(gefiltert.daten.map((z: { name: string }) => z.name)).toEqual(["Muster Alpha GmbH"]);
    // Listenfeld außerhalb der Liste unbekannt
    expect((await post("/objekte/organisation/abfrage", { spalten: [{ feld }] }, BEA_A)).status).toBe(400);
    expect((await post("/objekte/person/abfrage", { listeId: liste }, BEA_A)).status).toBe(400);
  });

  it("entfernt Einträge und archiviert nur als Besitzer oder Verwalter", async () => {
    expect((await json(await post(`/listen/${liste}/eintraege/entfernen`, { datensatzIds: [o["Muster Beta AG"]] }, BEA_A))).entfernt).toBe(1);
    expect((await post(`/listen/${liste}/archivieren`, undefined, BEA_B)).status).toBe(403);
    expect((await post(`/listen/${liste}/archivieren`, undefined, BEA_A)).status).toBe(204);
    expect((await get(`/listen/${liste}`)).status).toBe(404);
  });

  it("Deals nur sichtbarer Fonds kommen in eine Deal-Liste", async () => {
    const neu = await post("/listen", { name: "LP-Pipeline", objekt: "deal" }, BEA_A);
    const id = (await json(neu)).id;
    const hin = await json(await post(`/listen/${id}/eintraege`, { datensatzIds: [d["Deal Offen A"], d["Deal Offen B"]] }, BEA_A));
    expect(hin.hinzugefuegt).toBe(1);
  });
});

describe("Rechte an Listen", () => {
  it("nur Besitzer und globale Verwalter ändern eine geteilte Liste", async () => {
    const id = (await json(await post("/listen", { name: "Geteilte Liste", objekt: "organisation" }, BEA_A))).id;
    const verboten = await patch(`/listen/${id}`, { name: "Umbenannt" }, BEA_B);
    expect(verboten.status).toBe(403);
    expect((await json(verboten)).fehler.code).toBe("LISTE_BERECHTIGUNG");
    expect((await patch(`/listen/${id}`, { beschreibung: "neu" }, BEA_B)).status).toBe(403);
    expect((await post(`/listen/${id}/eintraege`, { datensatzIds: [o["Muster Alpha GmbH"]] }, BEA_B)).status).toBe(403);
    expect((await post(`/listen/${id}/eintraege/entfernen`, { datensatzIds: [o["Muster Alpha GmbH"]] }, BEA_B)).status).toBe(403);
    expect((await patch(`/listen/${id}/eintraege/${o["Muster Alpha GmbH"]}`, { felder: {} }, BEA_B)).status).toBe(403);
    expect((await post("/objekte/organisation/massenaktion", { ids: [o["Muster Alpha GmbH"]], aktion: { art: "liste_hinzufuegen", listeId: id } }, BEA_B)).status).toBe(403);
    expect((await post("/felder", { objekt: "organisation", listeId: id, name: "Fremdfeld", typ: "text" }, BEA_B)).status).toBe(403);
    expect((await post(`/listen/${id}/archivieren`, undefined, BEA_B)).status).toBe(403);
    // lesen darf jede Person mit Rolle
    expect((await get(`/listen/${id}`, BEA_B)).status).toBe(200);
    expect((await patch(`/listen/${id}`, { name: "Verwaltet" }, ADMIN)).status).toBe(200);
    expect((await patch(`/listen/${id}`, { name: "Eigene" }, BEA_A)).status).toBe(200);
  });

  it("Deals fremder Fonds in einer geteilten Liste: nicht sichtbar, nicht zählbar, nicht änderbar", async () => {
    const id = (await json(await post("/listen", { name: "Gemischte Deals", objekt: "deal" }, BEA_A))).id;
    await post(`/listen/${id}/eintraege`, { datensatzIds: [d["Deal Offen A"]] }, BEA_A);
    // Die Verwalterin legt einen Deal des Fonds B dazu, den Fonds-A-Nutzer nicht sehen darf.
    expect((await json(await post(`/listen/${id}/eintraege`, { datensatzIds: [d["Deal Offen B"]] }, ADMIN))).hinzugefuegt).toBe(1);
    const spalten = [{ feld: "titel" }];
    const sicht = async (als: ReturnType<typeof person>) => (await json(await post("/objekte/deal/abfrage", { listeId: id, spalten }, als)));
    expect((await sicht(BEA_A)).daten.map((z: { titel: string }) => z.titel)).toEqual(["Deal Offen A"]);
    expect((await sicht(BEA_A)).gesamt).toBe(1);
    expect((await sicht(ADMIN)).gesamt).toBe(2);
    expect((await json(await get(`/listen/${id}`, BEA_A))).eintraege).toBe(1);
    expect((await json(await get("/listen?objekt=deal", BEA_A))).daten.find((l: { id: string }) => l.id === id).eintraege).toBe(1);
    expect((await json(await get(`/listen/${id}`, ADMIN))).eintraege).toBe(2);
    // Hinzufügen und Entfernen laufen ins Leere, ohne den Eintrag zu berühren.
    expect(await json(await post(`/listen/${id}/eintraege`, { datensatzIds: [d["Deal Offen B"]] }, BEA_A))).toEqual({ hinzugefuegt: 0, uebersprungen: 1 });
    expect(await json(await post(`/listen/${id}/eintraege/entfernen`, { datensatzIds: [d["Deal Offen B"]] }, BEA_A))).toEqual({ entfernt: 0 });
    expect((await sicht(ADMIN)).gesamt).toBe(2);
    expect((await patch(`/listen/${id}/eintraege/${d["Deal Offen B"]}`, { felder: {} }, BEA_A)).status).toBe(404);
    // Der Export einer Liste enthält ebenfalls nur Sichtbares.
    const csv = await (await post("/objekte/deal/export", { listeId: id, spalten }, BEA_A)).text();
    expect(csv).toContain("Deal Offen A");
    expect(csv).not.toContain("Deal Offen B");
    // Betrachter am Fonds A darf den eigenen sichtbaren Deal nicht entfernen (Schreibrecht fehlt)
    const eigene = (await json(await post("/listen", { name: "Betrachter-Liste", objekt: "deal" }, ADMIN))).id;
    await post(`/listen/${eigene}/eintraege`, { datensatzIds: [d["Deal Offen A"]] }, ADMIN);
    expect((await post(`/listen/${eigene}/eintraege/entfernen`, { datensatzIds: [d["Deal Offen A"]] }, BET_A)).status).toBe(403);
  });
});

describe("Aufgaben", () => {
  it("legt an, filtert, erledigt und öffnet wieder", async () => {
    const neu = await post("/aufgaben", { titel: "Anrufen", faellig: "2026-12-01", organisationId: o["Muster Alpha GmbH"] }, BEA_A);
    expect(neu.status).toBe(201);
    const aufgabe = await json(neu);
    expect(aufgabe.zustaendig).toBeTruthy();
    expect((await post("/aufgaben", { titel: "Ohne Bezug" }, BEA_A)).status).toBe(400);
    expect((await post("/aufgaben", { titel: "Zuständig falsch", organisationId: o["Muster Alpha GmbH"], zustaendigId: "00000000-0000-4000-8000-000000000007" }, BEA_A)).status).toBe(400);
    const offen = await json(await get(`/aufgaben?organisationId=${o["Muster Alpha GmbH"]}`, BEA_A));
    expect(offen.daten.map((a: { titel: string }) => a.titel)).toEqual(["Anrufen"]);
    expect((await post(`/aufgaben/${aufgabe.id}/erledigt`, undefined, BEA_A)).status).toBe(200);
    expect((await json(await get(`/aufgaben?organisationId=${o["Muster Alpha GmbH"]}`, BEA_A))).daten).toEqual([]);
    expect((await json(await get(`/aufgaben?organisationId=${o["Muster Alpha GmbH"]}&status=erledigt`, BEA_A))).daten).toHaveLength(1);
    expect((await post(`/aufgaben/${aufgabe.id}/wieder-oeffnen`, undefined, BEA_A)).status).toBe(200);
    expect((await patch(`/aufgaben/${aufgabe.id}`, { titel: "Anrufen!", faellig: null }, BEA_A)).status).toBe(200);
    expect((await post(`/aufgaben/${aufgabe.id}/erledigt`, undefined, BET_A)).status).toBe(403);
    expect((await del(`/aufgaben/${aufgabe.id}`, undefined, BEA_A)).status).toBe(204);
    expect((await post(`/aufgaben/${aufgabe.id}/erledigt`, undefined, BEA_A)).status).toBe(404);
  });
});

describe("Erwähnungen in Notizen", () => {
  it("werden zu Verknüpfungen mit Rückverweis; ungültige Ziele entfallen", async () => {
    const text = `Gespräch mit @[Ben Bauer](person:${p["Ben"]}) über @[Beta](organisation:${o["Muster Beta AG"]}) und @[Weg](person:00000000-0000-4000-8000-000000000042) <b>fett</b>`;
    const antwort = await t.request("/aktivitaeten", { method: "POST", als: ADMIN, headers: { "content-type": "application/json" }, body: JSON.stringify({ art: "notiz", datum: "2026-11-01", titel: "Notiz", notiz: text, organisationId: o["Muster Alpha GmbH"] }) });
    expect(antwort.status).toBe(201);
    const aktivitaetId = (await json(antwort)).id;
    const beta = await json(await get(`/datensaetze/organisation/${o["Muster Beta AG"]}/verknuepfungen`));
    expect(beta.eingehend.map((v: { name: string; art: string }) => [v.name, v.art])).toEqual([["Muster Alpha GmbH", "erwaehnung"]]);
    const ben = await json(await get(`/datensaetze/person/${p["Ben"]}/verknuepfungen`));
    expect(ben.eingehend).toHaveLength(1);
    const alpha = await json(await get(`/datensaetze/organisation/${o["Muster Alpha GmbH"]}/verknuepfungen`));
    expect(alpha.ausgehend.map((v: { name: string }) => v.name).sort()).toEqual(["Ben Bauer", "Muster Beta AG"]);
    const zeilen = await db.select().from(s.datensatzLink).where(eq(s.datensatzLink.quelleId, aktivitaetId));
    expect(zeilen).toHaveLength(2);
  });
});

describe("Beschäftigungen und Deal-Kontakte", () => {
  it("n:m mit einer Hauptzeile, Spiegel in person.organisation_id", async () => {
    const zweite = await post("/beschaeftigungen", { personId: p["Anna"], organisationId: o["Muster Beta AG"], funktion: "Beirätin", haupt: false });
    expect(zweite.status).toBe(201);
    const ausgangsHaupt = await db.select().from(s.person).where(eq(s.person.id, p["Anna"]!));
    expect(ausgangsHaupt[0]!.organisationId).toBe(o["Muster Alpha GmbH"]);
    const wechsel = await json(await post("/beschaeftigungen", { personId: p["Anna"], organisationId: o["Muster Beta AG"], funktion: "CFO", haupt: true }));
    expect(wechsel.haupt).toBe(true);
    const nachher = await db.select().from(s.person).where(eq(s.person.id, p["Anna"]!));
    expect(nachher[0]!.organisationId).toBe(o["Muster Beta AG"]);
    const haupt = await db.select().from(s.beschaeftigung).where(sql`${s.beschaeftigung.personId} = ${p["Anna"]} AND ${s.beschaeftigung.haupt}`);
    expect(haupt).toHaveLength(1);
    expect((await post("/beschaeftigungen", { personId: p["Anna"], organisationId: o["Muster Beta AG"], von: "2026-05-01", bis: "2026-01-01" })).status).toBe(400);
    const liste = await json(await get(`/beschaeftigungen?personId=${p["Anna"]}`));
    expect(liste.daten[0].haupt).toBe(true);
    // Eine Person ohne Unternehmen bleibt möglich
    expect((await db.select().from(s.person).where(eq(s.person.id, p["Cara"]!)))[0]!.organisationId).toBeNull();
    // Haupt löschen rückt nach
    expect((await del(`/beschaeftigungen/${wechsel.id}`)).status).toBe(204);
    expect((await db.select().from(s.person).where(eq(s.person.id, p["Anna"]!)))[0]!.organisationId).not.toBeNull();
  });

  it("der bestehende Weg über /personen pflegt die Beschäftigung mit", async () => {
    const antwort = await t.request("/personen", { method: "POST", als: ADMIN, headers: { "content-type": "application/json" }, body: JSON.stringify({ vorname: "Dora", nachname: "Dorn", organisationId: o["Muster Gamma KG"], funktion: "CEO", dubletteBestaetigt: true }) });
    const id = (await json(antwort)).id;
    const z = await db.select().from(s.beschaeftigung).where(eq(s.beschaeftigung.personId, id));
    expect(z).toMatchObject([{ organisationId: o["Muster Gamma KG"], haupt: true, funktion: "CEO" }]);
  });

  it("Deal-Kontakte: Sichtbarkeit und Rechte", async () => {
    expect((await post(`/deals/${d["Deal Offen A"]}/kontakte`, { personId: p["Ben"], rolle: "Gründer" }, BEA_A)).status).toBe(201);
    const liste = await json(await get(`/deals/${d["Deal Offen A"]}/kontakte`, BEA_A));
    expect(liste.daten.map((k: { nachname: string; rolle: string }) => [k.nachname, k.rolle])).toEqual([["Bauer", "Gründer"]]);
    expect((await post(`/deals/${d["Deal Offen A"]}/kontakte`, { personId: p["Ben"] }, BEA_B)).status).toBe(403);
    expect((await del(`/deals/${d["Deal Offen A"]}/kontakte/${p["Ben"]}`, undefined, BEA_A)).status).toBe(204);
  });
});

describe("Zusammenführen zieht CRM-Daten mit", () => {
  it("Organisationen: Felder, Aufgaben, Listen, Beschäftigungen und Verknüpfungen", async () => {
    const [ziel] = await db.insert(s.organisation).values({ name: "Merge Ziel", art: "unternehmen" }).returning();
    const [quelle] = await db.insert(s.organisation).values({ name: "Merge Quelle", art: "unternehmen", telefon: "+49 30 111111" }).returning();
    const feld = (await json(await post("/felder", { objekt: "organisation", name: "Merge Feld", typ: "text" }))).id;
    await patch(`/datensaetze/organisation/${quelle!.id}`, { eigene: { [feld]: "von Quelle" } });
    await post("/aufgaben", { titel: "Quelle-Aufgabe", organisationId: quelle!.id });
    const l = (await json(await post("/listen", { name: "Merge Liste", objekt: "organisation" }))).id;
    await post(`/listen/${l}/eintraege`, { datensatzIds: [quelle!.id, ziel!.id] });
    const [pers] = await db.insert(s.person).values({ vorname: "Mia", nachname: "Merge" }).returning();
    await post("/beschaeftigungen", { personId: pers!.id, organisationId: quelle!.id, haupt: true });
    const antwort = await t.request(`/organisationen/${ziel!.id}/zusammenfuehren`, { method: "POST", als: ADMIN, headers: { "content-type": "application/json" }, body: JSON.stringify({ quelleId: quelle!.id }) });
    expect(antwort.status).toBe(200);
    const z = (await db.select().from(s.organisation).where(eq(s.organisation.id, ziel!.id)))[0]!;
    expect(z.felder[feld]).toBe("von Quelle");
    expect(z.telefon).toBe("+49 30 111111");
    expect((await db.select().from(s.aufgabe).where(eq(s.aufgabe.organisationId, ziel!.id))).length).toBe(1);
    expect((await db.select().from(s.listeEintrag).where(eq(s.listeEintrag.listeId, l))).map((e) => e.datensatzId)).toEqual([ziel!.id]);
    expect((await db.select().from(s.beschaeftigung).where(eq(s.beschaeftigung.personId, pers!.id)))[0]!.organisationId).toBe(ziel!.id);
    expect((await db.select().from(s.person).where(eq(s.person.id, pers!.id)))[0]!.organisationId).toBe(ziel!.id);
  });
});

describe("Massenaktionen und Dealflow", () => {
  it("Phase per Massenaktion folgt den Regeln: Closing nur mit zustimmendem Beschluss", async () => {
    const ergebnis = await json(await post("/objekte/deal/massenaktion", { ids: [d["Deal Offen A"], d["Deal Ohne Fonds"]], aktion: { art: "phase", nachPhase: "closing" } }, BEA_A));
    expect(ergebnis.erfolgreich).toBe(0);
    expect(ergebnis.fehler.map((f: { code: string }) => f.code)).toEqual(["BESCHLUSS_FEHLT", "BESCHLUSS_FEHLT"]);
    await db.insert(s.beschluss).values({ dealId: d["Deal Ohne Fonds"]!, gremium: "IA", datum: "2026-10-01", ergebnis: "zugestimmt" });
    const zweite = await json(await post("/objekte/deal/massenaktion", { ids: [d["Deal Offen A"], d["Deal Ohne Fonds"]], aktion: { art: "phase", nachPhase: "closing" } }, BEA_A));
    expect(zweite.erfolgreich).toBe(1);
    expect(zweite.fehler).toHaveLength(1);
    expect((await db.select().from(s.deal).where(eq(s.deal.id, d["Deal Ohne Fonds"]!)))[0]!.phase).toBe("closing");
    const wechsel = await db.select().from(s.dealPhasenwechsel).where(eq(s.dealPhasenwechsel.dealId, d["Deal Ohne Fonds"]!));
    expect(wechsel.some((w) => w.nachPhase === "closing")).toBe(true);
    // fremder Fonds: sichtbar nicht, also Fehler je Zeile
    const fremd = await json(await post("/objekte/deal/massenaktion", { ids: [d["Deal Offen B"]], aktion: { art: "phase", nachPhase: "erstgespraech" } }, BEA_A));
    expect(fremd.fehler).toEqual([{ id: d["Deal Offen B"], code: "DEAL_NICHT_GEFUNDEN" }]);
    expect((await db.select().from(s.deal).where(eq(s.deal.id, d["Deal Offen B"]!)))[0]!.phase).toBe("pruefung");
  });

  it("Board: Spalten mit Anzahl und Summe je Phase, Sichtbarkeit beachtet", async () => {
    const board = await json(await post("/objekte/deal/board", { gruppe: "phase", summe: "ticket", spalten: [{ feld: "titel" }, { feld: "ticket" }], filter: { verknuepfung: "und", elemente: [{ feld: "status", operator: "ist", wert: "offen" }] } }, BEA_A));
    const spalte = (w: string) => board.spalten.find((x: { wert: string }) => x.wert === w);
    expect(spalte("anfrage")).toMatchObject({ anzahl: 1, summe: "100000.00" });
    expect(spalte("pruefung")).toMatchObject({ anzahl: 0, summe: "0" });
    expect(spalte("closing").anzahl).toBe(1);
    const admin = await json(await post("/objekte/deal/board", { gruppe: "phase", summe: "ticket", spalten: [{ feld: "titel" }] }));
    expect(admin.spalten.find((x: { wert: string }) => x.wert === "pruefung")).toMatchObject({ anzahl: 1, summe: "250000.00" });
    expect((await post("/objekte/deal/board", { gruppe: "titel" })).status).toBe(400);
    expect((await post("/objekte/deal/board", { gruppe: "phase", summe: "titel" })).status).toBe(400);
  });

  it("Schnellanlage in einer Spalte: Startphase außer Closing", async () => {
    const ok = await t.request("/deals", { method: "POST", als: ADMIN, headers: { "content-type": "application/json" }, body: JSON.stringify({ titel: "Schnell", organisationId: o["Muster Gamma KG"], phase: "due_diligence" }) });
    expect(ok.status).toBe(201);
    expect((await json(ok)).phase).toBe("due_diligence");
    const closing = await t.request("/deals", { method: "POST", als: ADMIN, headers: { "content-type": "application/json" }, body: JSON.stringify({ titel: "Schnell2", organisationId: o["Muster Gamma KG"], phase: "closing" }) });
    expect(closing.status).toBe(400);
  });

  it("Feld setzen und Liste füllen für viele Zeilen, Archivieren schützt Referenzierte", async () => {
    const feld = (await json(await post("/felder", { objekt: "organisation", name: "Rang", typ: "zahl" }))).id;
    const gesetzt = await json(await post("/objekte/organisation/massenaktion", { ids: [o["Muster Beta AG"], o["Muster Gamma KG"]], aktion: { art: "feld_setzen", feld, wert: "4" } }));
    expect(gesetzt.erfolgreich).toBe(2);
    const nurTreffer = await json(await post("/objekte/organisation/massenaktion", { abfrage: { filter: { verknuepfung: "und", elemente: [{ feld, operator: "gleich", wert: "4" }] } }, aktion: { art: "feld_setzen", feld, wert: "5" } }));
    expect(nurTreffer.erfolgreich).toBe(2);
    const fehler = await json(await post("/objekte/organisation/massenaktion", { ids: [o["Muster Beta AG"]], aktion: { art: "feld_setzen", feld, wert: "x" } }));
    expect(fehler.fehler[0].code).toBe("FELDWERT_UNGUELTIG");
    const arch = await json(await post("/objekte/organisation/massenaktion", { ids: [o["Muster Alpha GmbH"], p["Cara"]!], aktion: { art: "archivieren" } }));
    expect(arch.fehler.map((f: { code: string }) => f.code)).toEqual(["DATENSATZ_REFERENZIERT", "DATENSATZ_NICHT_GEFUNDEN"]);
    const personArch = await json(await post("/objekte/person/massenaktion", { ids: [p["Cara"]!], aktion: { art: "archivieren" } }));
    expect(personArch.erfolgreich).toBe(1);
    const sichtbar = await json(await post("/objekte/person/abfrage", { spalten: [{ feld: "name" }] }));
    expect(sichtbar.daten.map((z: { name: string }) => z.name)).not.toContain("Cara Christ");
    expect((await post("/objekte/organisation/massenaktion", { ids: [o["Muster Beta AG"]], aktion: { art: "phase", nachPhase: "closing" } })).status).toBe(400);
  });
});

describe("Export", () => {
  it("CSV je Ansicht mit Schutz vor Formeln, Protokolleintrag und Rechten", async () => {
    const kopf = await post("/objekte/organisation/abfrage", { limit: 1 });
    expect(kopf.status).toBe(200);
    await db.update(s.organisation).set({ name: "=HYPERLINK(\"x\")" }).where(eq(s.organisation.id, o["Muster Gamma KG"]!));
    const antwort = await post("/objekte/organisation/export", { spalten: [{ feld: "name" }, { feld: "art" }], filter: { verknuepfung: "und", elemente: [{ feld: "name", operator: "enthaelt", wert: "hyperlink" }] } }, BEA_A);
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("content-type")).toContain("text/csv");
    const csv = await antwort.text();
    expect(csv).toBe(`Name,Art\n"'=HYPERLINK(""x"")",unternehmen\n`);
    const n = ((await db.execute(sql`SELECT count(*)::int AS n FROM aenderung WHERE aktion = 'gelesen' AND tabelle = 'crm_export'`)).rows[0] as { n: number }).n;
    expect(n).toBeGreaterThan(0);
    // Deals fremder Fonds nicht im Export
    const dealCsv = await (await post("/objekte/deal/export", { spalten: [{ feld: "titel" }] }, BEA_A)).text();
    expect(dealCsv).not.toContain("Deal Offen B");
    expect(dealCsv).toContain("Deal Offen A");
  });
});
