import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { heute } from "../schreiben";
import { json, leeren, oeffneTestdb, vehikelVon } from "./hilfen";
import { erstelleTestApp, legePersonAn, person } from "./hilfen-auth";
import { aufrufe, grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";
import { vorgaengeEinfuegen } from "./instrument-hilfen";

/** Szenarien, Prognose, Reserven (Etappe 18). Alle Daten sind erfunden; die Rechenregeln prüfen der Rechenkern und seine Python-Referenz. */

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const { get, post, put, patch, delete: del } = aufrufe(t);

const betrachter = person("sz-betrachter", { rollen: { [ID.fonds]: "betrachter" } });
const bearbeiter = person("sz-bearbeiter", { rollen: { [ID.fonds]: "bearbeiter" } });
const freigeber = person("sz-freigeber", { rollen: { [ID.fonds]: "freigeber" } });
const fremd = person("sz-fremd", { rollen: { [ID.anderer]: "bearbeiter" } });

const BASIS = heute();
const JAHR = Number(BASIS.slice(0, 4));
const KLASSE = "00000000-0000-4000-8000-0000000000c1";

async function bestand() {
  await grundbestand(db);
  for (const p of [betrachter, bearbeiter, freigeber, fremd]) await legePersonAn(db, p);
  await vorgaengeEinfuegen(db, [
    { beteiligungId: ID.eigen, art: "zusage", valuta: "2025-01-01", betrag: "2000000.00" },
    { beteiligungId: ID.eigen, art: "auszahlung", valuta: "2025-02-01", betrag: "1500000.00" },
    { beteiligungId: ID.darlehen, art: "zusage", valuta: "2025-01-01", betrag: "1000000.00" },
    { beteiligungId: ID.darlehen, art: "auszahlung", valuta: "2025-03-01", betrag: "800000.00" },
  ]);
  await db.insert(s.bewertung).values([
    { beteiligungId: ID.eigen, stichtag: "2026-06-30", wert: "2500000.00", methode: "sonstige", status: "freigegeben", freigegebenVon: "test", freigegebenAm: new Date() },
    { beteiligungId: ID.darlehen, stichtag: "2026-06-30", wert: "800000.00", methode: "anschaffungskosten", status: "freigegeben", freigegebenVon: "test", freigegebenAm: new Date() },
  ]);
  await db.insert(s.fondsBewegung).values({ fondsId: ID.fonds, art: "abruf", valuta: "2025-01-15", betrag: "2500000.00" });
  await db.execute(sql`DELETE FROM snapshot_auftrag`);
}

/** Kapitaltabelle von Alpha: Fonds und ein fremder Investor halten je 150.000 Anteile Serie A (1x, nicht partizipierend), 700.000 Stammanteile. */
async function kapitaltabelle() {
  await db.insert(s.anteilsklasse).values({ id: KLASSE, organisationId: ID.orgA, name: "Serie A", rang: 1, praeferenzFaktor: "1", partizipierend: false, umwandelbar: true });
  const [runde] = await db
    .insert(s.finanzierungsrunde)
    .values({ organisationId: ID.orgA, bezeichnung: "Serie A", datum: "2025-02-01", preMoney: "7000000.00", postMoney: "10000000.00", preisJeAnteil: "10.0000", anteileGesamtNach: "1000000", status: "abgeschlossen" })
    .returning();
  await db.insert(s.rundenposition).values([
    { rundeId: runde!.id, fondsId: ID.fonds, betrag: "1500000.00", anteile: "150000", rolle: "lead", anteilsklasseId: KLASSE },
    { rundeId: runde!.id, vehikelId: await vehikelVon(db, ID.orgC), betrag: "1500000.00", anteile: "150000", rolle: "co", anteilsklasseId: KLASSE },
  ]);
}

const annahmen = (zusatz: Record<string, unknown> = {}) => ({
  gebuehren: { basis: "zeichnungskapital", satz: "0.02", bisJahr: null, sonstigeJahr: "0" },
  carrySatz: "0",
  beteiligungen: { [ID.eigen]: { ausstieg: { art: "exit", jahr: JAHR + 3, multiple: "2", wahrscheinlichkeit: "1" } } },
  ...zusatz,
});

const legeAn = async (name: string, a: unknown = annahmen(), als = bearbeiter) => post(`/fonds/${ID.fonds}/szenarien`, { name, annahmen: a }, als);

beforeEach(bestand);
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Szenarien anlegen und prüfen", () => {
  it("legt ein Szenario an, listet es und hält den Namen eindeutig", async () => {
    const r = await legeAn("Basis");
    expect(r.status).toBe(201);
    const k = await json(r);
    expect(k).toMatchObject({ name: "Basis", status: "entwurf", basisStichtag: BASIS, ergebnisHash: null });
    const liste = await json(await get(`/fonds/${ID.fonds}/szenarien`, betrachter));
    expect(liste.daten).toHaveLength(1);
    const doppelt = await legeAn("Basis");
    expect(doppelt.status).toBe(409);
    expect((await json(doppelt)).error.code).toBe("scenario_name_exists");
  });

  it("prüft die Annahmen mit Zod (400) und gegen den Fonds (422)", async () => {
    const schlecht = await legeAn("A", { gebuehren: { satz: "0.5" }, beteiligungen: { [ID.eigen]: { ausstieg: { art: "exit", jahr: JAHR + 1 } } } });
    expect(schlecht.status).toBe(400);
    const felder = (await json(schlecht)).error.fields.map((f: { field: string }) => f.field);
    expect(felder).toContain("annahmen.gebuehren.satz");
    expect(felder.some((f: string) => f.startsWith("annahmen.beteiligungen"))).toBe(true);
    const fremdeBeteiligung = await legeAn("B", { beteiligungen: { "00000000-0000-4000-8000-0000000000aa": {} } });
    expect(fremdeBeteiligung.status).toBe(422);
    expect((await json(fremdeBeteiligung)).error.code).toBe("scenario_assumptions_invalid");
    const jahr = await legeAn("C", annahmen({ beteiligungen: { [ID.eigen]: { ausstieg: { art: "exit", jahr: JAHR + 40, multiple: "2" } } } }));
    expect(jahr.status).toBe(422);
    const zukunft = await post(`/fonds/${ID.fonds}/szenarien`, { name: "D", basisStichtag: `${JAHR + 1}-01-01`, annahmen: annahmen() }, bearbeiter);
    expect(zukunft.status).toBe(422);
  });

  it("Rechte: betrachter liest, legt nicht an; fremder Fonds ohne Zugriff", async () => {
    expect((await legeAn("X", annahmen(), betrachter)).status).toBe(403);
    const id = (await json(await legeAn("Y"))).id;
    expect((await get(`/szenarien/${id}`, betrachter)).status).toBe(200);
    expect((await get(`/szenarien/${id}`, fremd)).status).toBe(403);
    expect((await get(`/fonds/${ID.fonds}/szenarien`, fremd)).status).toBe(403);
    expect((await patch(`/szenarien/${id}`, { name: "Z" }, betrachter)).status).toBe(403);
    expect((await patch(`/szenarien/${id}`, { name: "Z" }, bearbeiter)).status).toBe(200);
    expect((await get(`/fonds/${ID.fonds}/szenarien/vorlage`, betrachter)).status).toBe(200);
  });
});

describe("Berechnung", () => {
  it("rechnet Gebühren, Ausstieg mit Multiple und Kennzahlen auf Basis des Ledgers", async () => {
    const id = (await json(await legeAn("Basis"))).id;
    const d = await json(await get(`/szenarien/${id}`, betrachter));
    const e = d.ergebnis;
    expect(e.zeichnungskapital).toBe("10000000.00");
    expect(e.jahre[0]).toMatchObject({ ist: true, abgerufenKum: "2500000.00", ausschuettungenKum: "0.00" });
    // Ausgangsstand: NAV = 2.500.000 (Alpha) + 800.000 (Darlehen)
    expect(e.jahre[0].nav).toBe("3300000.00");
    const ausstiegsjahr = e.jahre.find((j: { jahr: number; ist: boolean }) => j.jahr === JAHR + 3 && !j.ist);
    expect(ausstiegsjahr.ausschuettungenBrutto).toBe("5000000.00");
    const zweites = e.jahre.find((j: { jahr: number; ist: boolean }) => j.jahr === JAHR + 1 && !j.ist);
    expect(zweites.gebuehren).toBe("200000.00");
    expect(e.beteiligungen.find((b: { id: string }) => b.id === ID.eigen)).toMatchObject({ erloesBeiAusstieg: "5000000.00", erwarteterErloes: "5000000.00", erloesQuelle: "multiple" });
    const codes = e.befunde.map((b: { code: string }) => b.code);
    expect(codes).toContain("KEINE_ANNAHME"); // Darlehen ohne Annahme
    expect(e.summen.carry).toBe("0.00");
    expect(e.schritte.at(-1).bezeichnung).toBe("IRR (netto, XIRR)");
    // J-Kurve: TVPI sinkt zunächst durch Gebühren und steigt mit dem Ausstieg
    const tvpi = e.jahre.map((j: { tvpi: string }) => Number(j.tvpi));
    expect(Math.max(...tvpi.slice(-3))).toBeGreaterThan(Math.min(...tvpi.slice(0, 3)));
    expect(e.jahre.at(-1).dpi).not.toBeNull();
  });

  it("nutzt für den Exit-Wert den Exit-Wasserfall, wenn der Fonds Anteile aus Runden hält", async () => {
    await kapitaltabelle();
    const a = annahmen({ beteiligungen: { [ID.eigen]: { ausstieg: { art: "exit", jahr: JAHR + 2, wert: "4000000", wahrscheinlichkeit: "0.5" }, quote: "0.15" } } });
    const id = (await json(await legeAn("Wasserfall", a))).id;
    const e = (await json(await get(`/szenarien/${id}`, betrachter))).ergebnis;
    const b = e.beteiligungen.find((x: { id: string }) => x.id === ID.eigen);
    // Präferenz 1x je Serie-A-Position (1,5 Mio.); Umwandlung lohnt nicht (30 % von 4 Mio. = 1,2 Mio.): der Fonds bekommt 1,5 Mio., nicht 15 % von 4 Mio.
    expect(b).toMatchObject({ erloesBeiAusstieg: "1500000.00", erloesQuelle: "wasserfall", wahrscheinlichkeit: "0.5", erwarteterErloes: "750000.00" });
    expect(e.befunde.map((x: { code: string }) => x.code)).not.toContain("WASSERFALL_FALLBACK_QUOTE");
  });

  it("fällt ohne Kapitaltabelle auf Quote × Exit-Wert zurück und meldet den Befund; ohne Quote ist der Erlös 0", async () => {
    const a = annahmen({ beteiligungen: { [ID.eigen]: { ausstieg: { art: "exit", jahr: JAHR + 2, wert: "4000000", kosten: "100000" }, quote: "0.2" }, [ID.darlehen]: { ausstieg: { art: "exit", jahr: JAHR + 1, wert: "1000000" } } } });
    const id = (await json(await legeAn("Rueckfall", a))).id;
    const e = (await json(await get(`/szenarien/${id}`, betrachter))).ergebnis;
    expect(e.beteiligungen.find((x: { id: string }) => x.id === ID.eigen)).toMatchObject({ erloesBeiAusstieg: "780000.00", erloesQuelle: "quote" });
    expect(e.beteiligungen.find((x: { id: string }) => x.id === ID.darlehen)).toMatchObject({ erloesBeiAusstieg: "0.00" });
    const befunde = e.befunde.map((x: { code: string; beteiligungId?: string }) => `${x.code}:${x.beteiligungId}`);
    expect(befunde).toContain(`WASSERFALL_FALLBACK_QUOTE:${ID.eigen}`);
    expect(befunde).toContain(`QUOTE_FEHLT:${ID.darlehen}`);
  });

  it("Abschreibung, Folgeinvestition, Neuinvestition und Carry fließen ein; Überschreitung der Zusage wird gemeldet", async () => {
    const a = annahmen({
      carrySatz: "0.2",
      gebuehren: { basis: "investiert", satz: "0.02", bisJahr: JAHR + 2, sonstigeJahr: "10000" },
      beteiligungen: {
        [ID.eigen]: { ausstieg: { art: "exit", jahr: JAHR + 3, multiple: "4" }, folgeinvestitionen: [{ jahr: JAHR + 1, betrag: "400000" }] },
        [ID.darlehen]: { ausstieg: { art: "abschreibung", jahr: JAHR + 2 } },
      },
      neuinvestitionen: [{ name: "Neues Unternehmen", jahr: JAHR + 1, betrag: "7500000", ausstiegJahr: JAHR + 5, multiple: "3" }],
    });
    const id = (await json(await legeAn("Voll", a))).id;
    const e = (await json(await get(`/szenarien/${id}`, betrachter))).ergebnis;
    expect(e.beteiligungen.find((x: { id: string }) => x.id === ID.darlehen).erloesQuelle).toBe("abschreibung");
    expect(Number(e.summen.carry)).toBeGreaterThan(0);
    expect(e.summen.investitionen).toBe("7900000.00");
    expect(e.befunde.map((x: { code: string }) => x.code)).toContain("ZUSAGE_UEBERSCHRITTEN");
    expect(e.beteiligungen.at(-1)).toMatchObject({ name: "Neues Unternehmen", erwarteterErloes: "22500000.00" });
  });
});

describe("Festschreiben", () => {
  it("friert Eingaben und Ergebnis ein (SHA-256), danach unveränderlich", async () => {
    const id = (await json(await legeAn("Basis"))).id;
    expect((await post(`/szenarien/${id}/festschreiben`, undefined, bearbeiter)).status).toBe(403);
    const ok = await post(`/szenarien/${id}/festschreiben`, undefined, freigeber);
    expect(ok.status).toBe(200);
    const k = await json(ok);
    expect(k.status).toBe("festgeschrieben");
    expect(k.ergebnisHash).toMatch(/^[0-9a-f]{64}$/);
    const vorher = await json(await get(`/szenarien/${id}`, betrachter));
    expect(vorher.pruefsumme).toMatchObject({ gueltig: true, gespeichert: k.ergebnisHash });

    // Neue Buchungen ändern die Ansicht eines Entwurfs, nicht die des festgeschriebenen Szenarios.
    await db.insert(s.fondsBewegung).values({ fondsId: ID.fonds, art: "abruf", valuta: "2026-10-01", betrag: "100000.00" });
    const danach = await json(await get(`/szenarien/${id}`, betrachter));
    expect(danach.ergebnis).toEqual(vorher.ergebnis);
    const entwurfId = (await json(await legeAn("Neu"))).id;
    const neu = await json(await get(`/szenarien/${entwurfId}`, betrachter));
    expect(neu.ergebnis.jahre[0].abgerufenKum).toBe("2600000.00");

    const zweites = await post(`/szenarien/${id}/festschreiben`, undefined, freigeber);
    expect(zweites.status).toBe(409);
    expect((await json(zweites)).error.code).toBe("scenario_locked");
    expect((await patch(`/szenarien/${id}`, { name: "Anders" }, bearbeiter)).status).toBe(409);
    expect((await del(`/szenarien/${id}`, undefined, bearbeiter)).status).toBe(409);
    await expect(db.execute(sql`UPDATE szenario SET annahmen = '{}'::jsonb WHERE id = ${id}`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE szenario SET ergebnis = '{}'::jsonb WHERE id = ${id}`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM szenario WHERE id = ${id}`)).rejects.toThrow();
    const z = await protokollZeilen(db, "szenario", "festschreiben");
    expect(z).toHaveLength(1);
    expect(z[0]!.akteur_name).toBe(freigeber.name);
  });

  it("entdeckt eine veränderte Prüfsumme (Umgehung der Trigger)", async () => {
    const id = (await json(await legeAn("Basis"))).id;
    await post(`/szenarien/${id}/festschreiben`, undefined, freigeber);
    await db.transaction(async (tx) => {
      await tx.execute(sql`ALTER TABLE szenario DISABLE TRIGGER szenario_schutz`);
      await tx.execute(sql`UPDATE szenario SET ergebnis = jsonb_set(ergebnis, '{endJahr}', '1999') WHERE id = ${id}`);
      await tx.execute(sql`ALTER TABLE szenario ENABLE TRIGGER szenario_schutz`);
    });
    expect((await json(await get(`/szenarien/${id}`, betrachter))).pruefsumme.gueltig).toBe(false);
  });

  it("Entwürfe lassen sich ändern, duplizieren und löschen; das Protokoll hält es fest", async () => {
    const id = (await json(await legeAn("Basis"))).id;
    const neuerName = await patch(`/szenarien/${id}`, { name: "Basis 2", annahmen: annahmen({ carrySatz: "0.1" }) }, bearbeiter);
    expect(neuerName.status).toBe(200);
    const kopie = await post(`/szenarien/${id}/duplizieren`, {}, bearbeiter);
    expect(kopie.status).toBe(201);
    expect((await json(kopie)).name).toBe("Basis 2 (Kopie)");
    expect((await del(`/szenarien/${id}`, undefined, bearbeiter)).status).toBe(204);
    expect((await get(`/szenarien/${id}`, betrachter)).status).toBe(404);
    expect((await protokollZeilen(db, "szenario")).map((z) => z.aktion)).toEqual(["anlegen", "aendern", "anlegen", "loeschen"]);
    const [pz] = await db.execute(sql`SELECT fonds_id FROM aenderung WHERE tabelle = 'szenario' LIMIT 1`).then((r) => r.rows as { fonds_id: string }[]);
    expect(pz!.fonds_id).toBe(ID.fonds);
  });
});

describe("Vergleich und Bericht", () => {
  it("vergleicht bis zu drei Szenarien mit Kennzahlentabelle und J-Kurve", async () => {
    const a = (await json(await legeAn("Basis"))).id;
    const b = (await json(await legeAn("Oben", annahmen({ beteiligungen: { [ID.eigen]: { ausstieg: { art: "exit", jahr: JAHR + 3, multiple: "4" } } } })))).id;
    const c = (await json(await legeAn("Unten", annahmen({ beteiligungen: { [ID.eigen]: { ausstieg: { art: "abschreibung", jahr: JAHR + 3 } } } })))).id;
    await post(`/szenarien/${a}/festschreiben`, undefined, freigeber);
    const r = await get(`/fonds/${ID.fonds}/szenarien/vergleich?ids=${a},${b},${c}`, betrachter);
    expect(r.status).toBe(200);
    const k = await json(r);
    expect(k.szenarien.map((x: { name: string }) => x.name)).toEqual(["Basis", "Oben", "Unten"]);
    const tvpi = k.vergleich.kennzahlen.find((x: { schluessel: string }) => x.schluessel === "tvpiEnde").werte.map(Number);
    expect(tvpi[1]).toBeGreaterThan(tvpi[0]);
    expect(tvpi[0]).toBeGreaterThan(tvpi[2]);
    expect(k.vergleich.jkurve.length).toBe(k.vergleich.jahre.length);
    expect(k.vergleich.jkurve[0].werte).toHaveLength(3);
    const viele = await get(`/fonds/${ID.fonds}/szenarien/vergleich?ids=${a},${b},${c},${a}`, betrachter);
    expect(viele.status).toBe(400);
    const unbekannt = await get(`/fonds/${ID.fonds}/szenarien/vergleich?ids=00000000-0000-4000-8000-0000000000aa`, betrachter);
    expect(unbekannt.status).toBe(404);
    expect((await get(`/fonds/${ID.anderer}/szenarien/vergleich?ids=${a}`, verwalterAnderer())).status).toBe(404);
  });

  it("liefert den Bericht als PDF und Excel in beiden Sprachen und protokolliert den Abruf", async () => {
    const a = (await json(await legeAn("Basis"))).id;
    const b = (await json(await legeAn("Oben", annahmen({ beteiligungen: { [ID.eigen]: { ausstieg: { art: "exit", jahr: JAHR + 3, multiple: "4" } } } })))).id;
    const pdf = await get(`/szenarien/${a}/bericht?sprache=en`, betrachter);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toContain("scenarios-");
    expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    const xlsx = await get(`/fonds/${ID.fonds}/szenarien/bericht?ids=${a},${b}&format=xlsx`, betrachter);
    expect(xlsx.headers.get("content-type")).toContain("spreadsheetml");
    expect(xlsx.headers.get("content-disposition")).toContain("szenarien-");
    expect((await protokollZeilen(db, "szenario", "gelesen")).length).toBe(1);
    // Der Vergleich über mehrere Szenarien wird am Fonds protokolliert (wie die übrigen Fondsberichte), mit Fonds im Protokoll.
    const fondsLesen = await protokollZeilen(db, "fonds", "gelesen");
    expect(fondsLesen).toHaveLength(1);
    expect(fondsLesen[0]!.datensatz_id).toBe(ID.fonds);
    expect((await get(`/szenarien/${a}/bericht`, fremd)).status).toBe(403);
  });
});

function verwalterAnderer() {
  return person("sz-v2", { rollen: { [ID.anderer]: "verwalter" } });
}

describe("Ledger als Grundlage", () => {
  it("rechnet mit gebuchtem Stand: Storno-Paare, Entwürfe von Bewertungen und Runden verändern Szenario und Reserven nicht", async () => {
    await kapitaltabelle();
    const a = annahmen({ beteiligungen: { [ID.eigen]: { ausstieg: { art: "exit", jahr: JAHR + 2, wert: "4000000", wahrscheinlichkeit: "1" } } } });
    await put(`/beteiligungen/${ID.eigen}/reserve`, { betrag: "1000000", gueltigAb: "2026-01-01" }, bearbeiter);
    const vorher = await json(await get(`/szenarien/${(await json(await legeAn("Vorher", a))).id}`, betrachter));
    const reserveVorher = await json(await get(`/fonds/${ID.fonds}/reserven`, betrachter));

    // Ein Abruf mit seinem Storno (Fondsbewegungen aus dem Ledger): zählt in keiner Ist-Zahl.
    const [abruf] = await db.insert(s.fondsBewegung).values({ fondsId: ID.fonds, art: "abruf", valuta: "2025-06-01", betrag: "100000.00" }).returning();
    await db.insert(s.fondsBewegung).values({ fondsId: ID.fonds, art: "abruf", valuta: "2025-06-02", betrag: "-100000.00", storniertBewegungId: abruf!.id });
    // Entwurf einer Bewertung und Entwurf einer Finanzierungsrunde mit Position des Fonds: nirgends wirksam.
    await db.insert(s.bewertung).values({ beteiligungId: ID.eigen, stichtag: "2026-09-30", wert: "9000000.00", methode: "sonstige", status: "entwurf" });
    const [entwurf] = await db
      .insert(s.finanzierungsrunde)
      .values({ organisationId: ID.orgA, bezeichnung: "Serie B (Entwurf)", datum: "2026-03-01", preMoney: "20000000.00", postMoney: "25000000.00", preisJeAnteil: "20.0000", anteileGesamtNach: "1250000", status: "entwurf" })
      .returning();
    await db.insert(s.rundenposition).values({ rundeId: entwurf!.id, fondsId: ID.fonds, betrag: "3000000.00", anteile: "150000", rolle: "lead" });

    const nachher = await json(await get(`/szenarien/${(await json(await legeAn("Nachher", a))).id}`, betrachter));
    expect(nachher.ergebnis).toEqual(vorher.ergebnis);
    const reserveNachher = await json(await get(`/fonds/${ID.fonds}/reserven`, betrachter));
    expect(reserveNachher.reserven).toEqual(reserveVorher.reserven);
    expect(reserveNachher.verfuegbar).toBe(reserveVorher.verfuegbar);
    expect(reserveNachher.abgerufen).toBe(reserveVorher.abgerufen);
  });

  it("Ist-Zahlen kommen aus den Fondsbewegungen: ein echter Abruf ändert den Ausgangsstand", async () => {
    const vorher = (await json(await get(`/szenarien/${(await json(await legeAn("A"))).id}`, betrachter))).ergebnis;
    await db.insert(s.fondsBewegung).values({ fondsId: ID.fonds, art: "abruf", valuta: "2026-02-01", betrag: "200000.00" });
    const nachher = (await json(await get(`/szenarien/${(await json(await legeAn("B"))).id}`, betrachter))).ergebnis;
    expect(Number(nachher.jahre[0].abgerufenKum) - Number(vorher.jahre[0].abgerufenKum)).toBe(200000);
    await db.insert(s.fondsBewegung).values({ fondsId: ID.fonds, art: "ausschuettung", valuta: "2026-03-01", betrag: "50000.00" });
    const danach = (await json(await get(`/szenarien/${(await json(await legeAn("C"))).id}`, betrachter))).ergebnis;
    expect(Number(danach.jahre[0].ausschuettungenKum)).toBe(50000);
  });
});

describe("Reserven", () => {
  it("vergleicht geplante Reserve mit den Auszahlungen seit Planbeginn und rechnet den verfügbaren Betrag", async () => {
    const leer = await json(await get(`/fonds/${ID.fonds}/reserven`, betrachter));
    expect(leer.befunde.map((b: { code: string }) => b.code)).toContain("KEINE_GEBUEHRENANNAHME");
    expect(leer.verfuegbar).toBe("7500000.00"); // 10 Mio. − max(abgerufen 2,5 Mio.; investiert 2,3 Mio.)

    const geplant = await put(`/beteiligungen/${ID.eigen}/reserve`, { betrag: "1000000", gueltigAb: "2026-01-01", bemerkung: "Folgerunde" }, bearbeiter);
    expect(geplant.status).toBe(201);
    expect((await put(`/beteiligungen/${ID.eigen}/reserve`, { betrag: "1000000", gueltigAb: "2026-01-01" }, betrachter)).status).toBe(403);
    await vorgaengeEinfuegen(db, { beteiligungId: ID.eigen, art: "auszahlung", valuta: "2026-05-01", betrag: "250000.00" });
    const r = await json(await get(`/fonds/${ID.fonds}/reserven`, betrachter));
    expect(r.reserven).toHaveLength(1);
    expect(r.reserven[0]).toMatchObject({ geplant: "1000000.00", verbraucht: "250000.00", offen: "750000.00", bemerkung: "Folgerunde" });
    // belegt = max(abgerufen 2,5 Mio.; investiert 2,55 Mio.)
    expect(r.belegt).toBe("2550000.00");
    expect(r.verfuegbar).toBe("6700000.00");

    // Gebührenprognose eines Szenarios mindert den verfügbaren Betrag (Zeichnungsbasis 2 % über 11 Jahre, erstes Jahr anteilig)
    const sz = await json(await legeAn("Gebuehren", annahmen({ gebuehren: { basis: "zeichnungskapital", satz: "0.01", bisJahr: JAHR, sonstigeJahr: "0" } })));
    const mit = await json(await get(`/fonds/${ID.fonds}/reserven?szenarioId=${sz.id}`, betrachter));
    expect(mit.szenario).toMatchObject({ name: "Gebuehren" });
    expect(Number(mit.gebuehrenPrognose)).toBeGreaterThan(0);
    expect(Number(mit.verfuegbar)).toBeCloseTo(6700000 - Number(mit.gebuehrenPrognose), 2);
    expect(mit.schritte.at(-1).bezeichnung).toBe("Verfügbar für Neuinvestments");
    const verlauf = await json(await get(`/beteiligungen/${ID.eigen}/reserve`, betrachter));
    expect(verlauf.daten).toHaveLength(1);
  });

  it("meldet eine überplante Reserve als negativ verfügbar", async () => {
    await put(`/beteiligungen/${ID.eigen}/reserve`, { betrag: "9000000", gueltigAb: "2026-01-01" }, bearbeiter);
    const r = await json(await get(`/fonds/${ID.fonds}/reserven`, betrachter));
    expect(r.befunde.map((b: { code: string }) => b.code)).toContain("VERFUEGBAR_NEGATIV");
    expect(r.verfuegbar.startsWith("-")).toBe(true);
    expect((await get(`/fonds/${ID.fonds}/reserven`, fremd)).status).toBe(403);
  });
});
