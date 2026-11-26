import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, person } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { aufrufe, grundbestand, ID, json, leereAuftraege, protokollZeilen } from "./hilfen-instrumente";

const { db, pool } = oeffneTestdb();
const { get, post, patch } = aufrufe(erstelleTestApp(db));

beforeEach(async () => {
  await grundbestand(db);
  await leereAuftraege(db);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const entwurf = { stichtag: "2025-03-31", wert: "120000.00", methode: "letzte_runde", begruendung: "Runde im Quartal" };
const neu = (koerper: object, akteur = "ersteller") => post(`/beteiligungen/${ID.eigen}/bewertungen`, koerper, akteur);
const FALSCH = "00000000-0000-4000-8000-0000000000ff";

describe("Entwurf ändern (PATCH /bewertungen/:id)", () => {
  it("ändert Wert, Methode und Begründung eines Entwurfs und protokolliert", async () => {
    const d = await json(await neu(entwurf));
    const antwort = await patch(`/bewertungen/${d.bewertung.id}`, { wert: "130000.50", begruendung: "Neue Runde" }, "ersteller");
    expect(antwort.status).toBe(200);
    expect(await json(antwort)).toMatchObject({ id: d.bewertung.id, status: "entwurf", wert: "130000.50", methode: "letzte_runde", begruendung: "Neue Runde" });
    const zeilen = await protokollZeilen(db, "bewertung", "aendern");
    expect(zeilen).toHaveLength(1);
    expect((zeilen[0] as unknown as { vorher: { wert: string } }).vorher.wert).toBe("120000.00");
  });

  it("prüft die Begründungsregel auf dem Stand nach der Änderung", async () => {
    const d = await json(await neu(entwurf));
    expect((await patch(`/bewertungen/${d.bewertung.id}`, { begruendung: null }, "ersteller")).status).toBe(400);
    expect((await patch(`/bewertungen/${d.bewertung.id}`, { methode: "anschaffungskosten", begruendung: null }, "ersteller")).status).toBe(200);
    expect((await patch(`/bewertungen/${d.bewertung.id}`, {}, "ersteller")).status).toBe(400);
    expect((await patch(`/bewertungen/${d.bewertung.id}`, { wert: "-1" }, "ersteller")).status).toBe(400);
  });

  it("nur Entwürfe: freigegebene und verworfene sind 409, Unbekanntes 404", async () => {
    const a = await json(await neu(entwurf));
    await post(`/bewertungen/${a.bewertung.id}/freigeben`, undefined, "pruefer");
    const frei = await patch(`/bewertungen/${a.bewertung.id}`, { wert: "1.00" }, "ersteller");
    expect(frei.status).toBe(409);
    expect((await json(frei)).fehler.code).toBe("BEWERTUNG_STATUS_UNGUELTIG");

    const b = await json(await neu({ ...entwurf, stichtag: "2025-06-30" }));
    await post(`/bewertungen/${b.bewertung.id}/verwerfen`, undefined, "pruefer");
    expect((await patch(`/bewertungen/${b.bewertung.id}`, { wert: "1.00" }, "ersteller")).status).toBe(409);
    expect((await patch(`/bewertungen/${FALSCH}`, { wert: "1.00" }, "ersteller")).status).toBe(404);
  });

  it("Periodensperre gilt auch für die Änderung", async () => {
    const d = await json(await neu(entwurf));
    await db.insert(s.periodensperre).values({ fondsId: ID.fonds, gesperrtBis: "2025-03-31", gesetztVon: "test" });
    const antwort = await patch(`/bewertungen/${d.bewertung.id}`, { wert: "1.00" }, "ersteller");
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).fehler.code).toBe("PERIODE_GESPERRT");
  });

  it("Vier-Augen: wer einen Entwurf ändert, kann ihn nicht allein freigeben", async () => {
    const d = await json(await neu(entwurf, "ersteller"));
    await patch(`/bewertungen/${d.bewertung.id}`, { wert: "999999.00" }, "aendernde");
    const selbst = await post(`/bewertungen/${d.bewertung.id}/freigeben`, undefined, "aendernde");
    expect(selbst.status).toBe(409);
    expect((await json(selbst)).fehler.code).toBe("VIER_AUGEN_VERLETZT");
    expect((await post(`/bewertungen/${d.bewertung.id}/freigeben`, undefined, "ersteller")).status).toBe(200);
  });

  it("Vier-Augen in der Runde: weder Rundenersteller noch Änderer können freigeben, eine dritte Person kann es", async () => {
    const vorher = await json(await post(`/beteiligungen/${ID.darlehen}/bewertungen`, { stichtag: "2025-03-31", wert: "10.00", methode: "anschaffungskosten" }, "x"));
    await post(`/bewertungen/${vorher.bewertung.id}/freigeben`, undefined, "y");
    const runde = await json(await post(`/fonds/${ID.fonds}/bewertungsrunde`, { stichtag: "2025-06-30", vorschlag: "fortschreiben" }, "a"));
    expect(runde.bewertungen).toHaveLength(1);
    await patch(`/bewertungen/${runde.bewertungen[0].id}`, { wert: "55.00" }, "b");
    expect((await post(`/bewertungsrunden/${runde.runde.id}/freigeben`, undefined, "a")).status).toBe(409);
    const durchB = await post(`/bewertungsrunden/${runde.runde.id}/freigeben`, undefined, "b");
    expect(durchB.status).toBe(409);
    expect((await json(durchB)).fehler.code).toBe("VIER_AUGEN_VERLETZT");
    expect((await post(`/bewertungsrunden/${runde.runde.id}/freigeben`, undefined, "c")).status).toBe(200);
  });

  it("Rechte: bearbeiter darf ändern, betrachter und fremder Fonds nicht", async () => {
    const d = await json(await neu(entwurf));
    const betrachter = person("nurlesen", { rollen: { [ID.fonds]: "betrachter" } });
    const bearbeiter = person("bearb", { rollen: { [ID.fonds]: "bearbeiter" } });
    const fremd = person("fremd", { rollen: { [ID.anderer]: "verwalter" } });
    expect((await patch(`/bewertungen/${d.bewertung.id}`, { wert: "1.00" }, betrachter)).status).toBe(403);
    expect((await patch(`/bewertungen/${d.bewertung.id}`, { wert: "1.00" }, fremd)).status).toBe(403);
    expect((await patch(`/bewertungen/${d.bewertung.id}`, { wert: "1.00" }, bearbeiter)).status).toBe(200);
  });
});

describe("Bewertungsrunde: Übersprungene und bewertungsrundeId", () => {
  const freigegeben = async (beteiligungId: string, stichtag: string) => {
    const d = await json(await post(`/beteiligungen/${beteiligungId}/bewertungen`, { stichtag, wert: "100.00", methode: "anschaffungskosten" }, "x"));
    await post(`/bewertungen/${d.bewertung.id}/freigeben`, undefined, "y");
  };

  it("GET /bewertungsrunden/:id liefert die übersprungenen Beteiligungen mit Grund, auch nach dem Anlegen", async () => {
    await freigegeben(ID.eigen, "2025-03-31");
    const angelegt = await json(await post(`/fonds/${ID.fonds}/bewertungsrunde`, { stichtag: "2025-06-30", vorschlag: "fortschreiben" }, "a"));
    expect(angelegt.uebersprungen.map((u: { grund: string }) => u.grund)).toEqual(["keine_vorherige_bewertung", "keine_vorherige_bewertung"]);
    const gelesen = await json(await get(`/bewertungsrunden/${angelegt.runde.id}`));
    expect(gelesen.uebersprungen).toEqual(angelegt.uebersprungen);
    expect(gelesen.uebersprungen[0]).toMatchObject({ beteiligungId: expect.any(String), organisation: expect.any(String), grund: "keine_vorherige_bewertung" });
    const [zeile] = await db.select().from(s.bewertungsrunde).where(eq(s.bewertungsrunde.id, angelegt.runde.id));
    expect(zeile?.uebersprungen).toHaveLength(2);
  });

  it("ein neu angelegter Entwurf bleibt mit bewertungsrundeId in der Runde", async () => {
    await freigegeben(ID.eigen, "2025-03-31");
    const runde = await json(await post(`/fonds/${ID.fonds}/bewertungsrunde`, { stichtag: "2025-06-30", vorschlag: "fortschreiben" }, "a"));
    const alt = runde.bewertungen[0];
    await post(`/bewertungen/${alt.id}/verwerfen`, undefined, "b");
    const neuer = await neu({ stichtag: "2025-06-30", wert: "5.00", methode: "sonstige", begruendung: "Korrigiert", bewertungsrundeId: runde.runde.id }, "a");
    expect(neuer.status).toBe(201);
    expect((await json(neuer)).bewertung.bewertungsrundeId).toBe(runde.runde.id);
    const gelesen = await json(await get(`/bewertungsrunden/${runde.runde.id}`));
    expect(gelesen.bewertungen.filter((b: { status: string }) => b.status === "entwurf")).toHaveLength(1);
  });

  it("bewertungsrundeId muss eine offene Runde desselben Fonds und Stichtags sein", async () => {
    await freigegeben(ID.eigen, "2025-03-31");
    const runde = await json(await post(`/fonds/${ID.fonds}/bewertungsrunde`, { stichtag: "2025-06-30", vorschlag: "fortschreiben" }, "a"));
    const falscherStichtag = await neu({ stichtag: "2025-09-30", wert: "5.00", methode: "sonstige", begruendung: "x", bewertungsrundeId: runde.runde.id }, "a");
    expect(falscherStichtag.status).toBe(409);
    expect((await json(falscherStichtag)).fehler.code).toBe("BEWERTUNGSRUNDE_PASST_NICHT");
    expect((await neu({ stichtag: "2025-06-30", wert: "5.00", methode: "sonstige", begruendung: "x", bewertungsrundeId: FALSCH }, "a")).status).toBe(404);
    await post(`/bewertungsrunden/${runde.runde.id}/verwerfen`, undefined, "a");
    const geschlossen = await neu({ stichtag: "2025-06-30", wert: "5.00", methode: "sonstige", begruendung: "x", bewertungsrundeId: runde.runde.id }, "a");
    expect(geschlossen.status).toBe(409);
    expect((await json(geschlossen)).fehler.code).toBe("BEWERTUNG_STATUS_UNGUELTIG");
  });
});

describe("Berichtsvorlagen mit erlaubter Auswahl", () => {
  it("GET /fonds/:id/berichtsvorlagen nennt je Art Abschnitte, Kennzahlen, Spalten und Einheiten", async () => {
    const d = await json(await get(`/fonds/${ID.fonds}/berichtsvorlagen`));
    expect(d.daten).toHaveLength(7);
    const lp = d.daten.find((v: { art: string }) => v.art === "lp_bericht");
    expect(lp.erlaubt.abschnitte).toContain("kapitalkonten");
    expect(lp.erlaubt.kennzahlen).toContain("tvpi");
    expect(lp.erlaubt.spalten).toContain("multiple");
    expect(lp.erlaubt.einheiten).toEqual(["EUR", "TEUR"]);
    expect(lp.erlaubt.abschnitte).toEqual(lp.konfiguration.abschnitte);
    const quartal = d.daten.find((v: { art: string }) => v.art === "quartalsbericht");
    expect(quartal.erlaubt).toMatchObject({ abschnitte: ["bewertungsverlauf", "vorgaenge", "unternehmenskennzahlen"], kennzahlen: [], spalten: [] });
    const exit = d.daten.find((v: { art: string }) => v.art === "exitliste");
    expect(exit.erlaubt.spalten).toContain("offeneForderungen");
  });
});
