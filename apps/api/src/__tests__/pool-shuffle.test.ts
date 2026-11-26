import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { sql } from "drizzle-orm";
import { erstelleTestApp, legePersonAn, person } from "./hilfen-auth";
import { leeren, oeffneTestdb, vehikelVon } from "./hilfen";
import { aufrufe, grundbestand, ID, json, protokollZeilen } from "./hilfen-instrumente";

// Option Pool Shuffle im Rundendialog: Vorschlag (Aufstockung, Preis, Kennwerte) und Anlegen der Aufstockung mit der Runde. Zahlen erfunden.

const { db, pool } = oeffneTestdb();
const { get, post, patch, delete: loesche } = aufrufe(erstelleTestApp(db));

const R1 = "00000000-0000-4000-8000-0000000000e1";
const R2 = "00000000-0000-4000-8000-0000000000e2";

const bearbeiter = person("ps-bearbeiter", { rollen: { [ID.fonds]: "bearbeiter" } });
const betrachter = person("ps-betrachter", { rollen: { [ID.fonds]: "betrachter" } });
const fremd = person("ps-fremd", { rollen: { [ID.anderer]: "bearbeiter" } });
const beide = person("ps-beide", { rollen: { [ID.fonds]: "bearbeiter", [ID.anderer]: "bearbeiter" } });

/** Unternehmen A: nach der Serie A 1.250.000 ausgegebene Anteile; ESOP mit 100.000 Einheiten (60.000 zugeteilt). */
beforeEach(async () => {
  await grundbestand(db);
  for (const p of [bearbeiter, betrachter, fremd, beide]) await legePersonAn(db, p);
  await db.execute(sql`DELETE FROM nutzergruppe`);
  await db.execute(sql`DELETE FROM rechterolle`);
  await db.insert(s.finanzierungsrunde).values([
    { id: R1, organisationId: ID.orgA, bezeichnung: "Seed", datum: "2025-01-10", preMoney: "2000000.00", postMoney: "2300000.00", preisJeAnteil: "2.0000", anteileGesamtNach: "1150000" },
    { id: R2, organisationId: ID.orgA, bezeichnung: "Serie A", datum: "2025-09-01", preMoney: "5750000.00", postMoney: "6250000.00", preisJeAnteil: "5.0000", anteileGesamtNach: "1250000" },
  ]);
  await db.insert(s.rundenposition).values([
    { rundeId: R1, fondsId: ID.fonds, betrag: "100000.00", anteile: "50000", rolle: "lead" },
    { rundeId: R2, vehikelId: await vehikelVon(db, ID.orgB), betrag: "300000.00", anteile: "60000", rolle: "co" },
  ]);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const pools = `/organisationen/${ID.orgA}/mitarbeiterpools`;
const vorschlagPfad = `/organisationen/${ID.orgA}/finanzierungsrunden/pool-vorschlag`;
const rundenPfad = `/organisationen/${ID.orgA}/finanzierungsrunden`;

async function esop(bezeichnung = "ESOP 2025") {
  const p = await json(await post(pools, { art: "esop", bezeichnung, groesse: "100000", datum: "2025-03-01" }, bearbeiter));
  expect((await post(`${pools}/${p.id}/zuteilungen`, { kategorie: "mitarbeitende", anzahl: "60000", zugeteiltAm: "2025-03-01" }, bearbeiter)).status).toBe(201);
  return p.id as string;
}

// Pre-Money 13,5 Mio, Volumen 1,5 Mio, Ziel 15 %: k = 0,15 × 15 ÷ 13,5 = 1/6, Pool nach = k × 1.250.000 ÷ (1 − k) = 250.000, Aufstockung 150.000,
// Preis 13,5 Mio ÷ 1.500.000 = 9 €
const eingabe = { datum: "2026-03-01", preMoney: "13500000.00", volumen: "1500000.00", zielAnteil: "0.15", basis: "pre_money" };
const serieB = (poolAufstockung?: object, fondsId: string = ID.fonds) => ({
  bezeichnung: "Serie B",
  datum: "2026-03-01",
  preMoney: "13500000.00",
  preisJeAnteil: "9.0000",
  positionen: [{ fondsId, betrag: "1500000.00", anteile: "166667", rolle: "lead" }],
  ...(poolAufstockung ? { poolAufstockung } : {}),
});

describe("Vorschlag zum Option Pool Shuffle", () => {
  it("Pre-Money: Aufstockung und Preis aus Zielgröße, Kennwerte; Anteile vor der Runde aus der letzten Runde", async () => {
    await esop();
    const antwort = await post(vorschlagPfad, eingabe, betrachter);
    expect(antwort.status).toBe(200);
    expect(await json(antwort)).toEqual({
      anteileVorher: "1250000",
      anteileVorherQuelle: "runde",
      poolVorher: "100000",
      vorschlag: { aufstockung: "150000", preisJeAnteil: "9.0000" },
      grund: null,
      kennwerte: { neueAnteile: "166666", poolVorher: "100000", poolNachher: "250000", poolAnteilNachher: "0.150000", vollVerwaessertNachher: "1666666", preisJeAnteil: "9.0000", effektivePreMoney: "12150000.00" },
    });
  });

  it("Post-Money: Preis ohne Aufstockung, effektive Pre-Money gleich dem Pre-Money; überschriebene Werte gehen in die Kennwerte", async () => {
    await esop();
    const v = await json(await post(vorschlagPfad, { ...eingabe, basis: "post_money" }, betrachter));
    // Preis 13,5 Mio ÷ 1.350.000 = 10 €, 150.000 neue Anteile; (100.000 + X) = 0,15 × (1.500.000 + X): X = 147.059
    expect(v.vorschlag).toEqual({ aufstockung: "147059", preisJeAnteil: "10.0000" });
    expect(v.kennwerte).toMatchObject({ neueAnteile: "150000", poolNachher: "247059", effektivePreMoney: "13500000.00" });
    const ueber = await json(await post(vorschlagPfad, { ...eingabe, aufstockung: "100000", preisJeAnteil: "8.5000" }, betrachter));
    expect(ueber.vorschlag).toEqual({ aufstockung: "150000", preisJeAnteil: "9.0000" });
    expect(ueber.kennwerte).toMatchObject({ neueAnteile: "176470", poolNachher: "200000", preisJeAnteil: "8.5000", effektivePreMoney: "11475000.00" });
  });

  it("ohne abgeschlossene Runde kein Vorschlag, bis die Anteile vor der Runde angegeben sind; Ziel zu groß ergibt einen Grund", async () => {
    const pfad = `/organisationen/${ID.orgC}/finanzierungsrunden/pool-vorschlag`;
    const ohne = await json(await post(pfad, eingabe, bearbeiter));
    expect(ohne).toMatchObject({ anteileVorher: null, anteileVorherQuelle: null, poolVorher: "0", vorschlag: null, grund: "ohne_anteile", kennwerte: null });
    const mit = await json(await post(pfad, { ...eingabe, anteileVorher: "1000000" }, bearbeiter));
    expect(mit).toMatchObject({ anteileVorherQuelle: "eingabe", grund: null, vorschlag: { aufstockung: "200000" } });
    expect((await json(await post(vorschlagPfad, { ...eingabe, zielAnteil: "0.95" }, bearbeiter))).grund).toBe("ziel_unerreichbar");
    expect((await post(vorschlagPfad, { ...eingabe, zielAnteil: "1.0" }, bearbeiter)).status).toBe(400);
    expect((await post(vorschlagPfad, { ...eingabe, zielAnteil: "0.0" }, bearbeiter)).status).toBe(400);
  });

  it("verrät Pool und Anteile nur mit Leserecht an den Runden", async () => {
    await esop();
    expect((await post(vorschlagPfad, eingabe, fremd)).status).toBe(403);
  });
});

describe("Aufstockung beim Anlegen der Runde", () => {
  it("Pre-Money: Änderung zur Runde in derselben Transaktion, Anteile gesamt ohne den Pool abgeleitet, Vorschau = angelegte Runde", async () => {
    const poolId = await esop();
    const aufstockung = { basis: "pre_money", anzahl: "150000", beschluss: "Beschluss zur Serie B" };
    const vorschau = await json(await post(`${rundenPfad}/vorschau`, serieB(aufstockung), bearbeiter));
    const antwort = await post(rundenPfad, serieB(aufstockung), bearbeiter);
    expect(antwort.status).toBe(201);
    const runde = await json(antwort);
    // 15 Mio ÷ 9 € = 1.666.667 voll verwässert, davon 250.000 Pool nach der Runde
    expect(runde.anteileGesamtNach).toBe("1416667");
    expect(vorschau.anteileGesamtNach).toBe(runde.anteileGesamtNach);
    expect(runde.pruefung).toMatchObject({ schliessbar: true, preisBasis: "voll_verwaessert", poolAnteile: "250000", abweichungen: [] });
    expect(vorschau.pruefung).toEqual(runde.pruefung);
    const p = (await json(await get(`${pools}?stichtag=2026-03-01`, bearbeiter))).daten[0];
    expect(p.id).toBe(poolId);
    expect(p.aenderungen[1]).toMatchObject({ datum: "2026-03-01", anzahl: "150000", rundeId: runde.id, basis: "pre_money", beschluss: "Beschluss zur Serie B" });
    expect(p.stand.groesse).toBe("250000");
    expect((await protokollZeilen(db, "pool_aenderung")).length).toBe(2);
  });

  it("Post-Money: die Aufstockung zählt nicht zum Pool der Prüfung", async () => {
    await esop();
    const runde = await json(await post(rundenPfad, { ...serieB({ basis: "post_money", anzahl: "147059" }), preisJeAnteil: "10.0000", positionen: [{ fondsId: ID.fonds, betrag: "1500000.00", anteile: "150000", rolle: "lead" }] }, bearbeiter));
    expect(runde.anteileGesamtNach).toBe("1400000");
    expect(runde.pruefung).toMatchObject({ schliessbar: true, preisBasis: "voll_verwaessert", poolAnteile: "100000" });
  });

  it("ohne Pool entsteht einer mit der Aufstockung als Schaffung; ohne Angaben dazu 400; bei mehreren Pools ist einer zu wählen", async () => {
    expect((await post(rundenPfad, serieB({ basis: "pre_money", anzahl: "150000" }), bearbeiter)).status).toBe(400);
    expect((await db.select().from(s.finanzierungsrunde)).length).toBe(2);
    const runde = await json(await post(rundenPfad, serieB({ basis: "pre_money", anzahl: "150000", neuerPool: { art: "esop", bezeichnung: "ESOP 2026" } }), bearbeiter));
    const liste = (await json(await get(`${pools}?stichtag=2026-03-01`, bearbeiter))).daten;
    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({ bezeichnung: "ESOP 2026", aenderungen: [{ anzahl: "150000", rundeId: runde.id, basis: "pre_money" }] });
    await esop("ESOP 2");
    const mehrere = await post(rundenPfad, { ...serieB({ basis: "pre_money", anzahl: "1000" }), bezeichnung: "Serie C" }, bearbeiter);
    expect(mehrere.status).toBe(400);
    expect(JSON.stringify(await json(mehrere))).toContain("pool_waehlen");
    const gewaehlt = await post(rundenPfad, { ...serieB({ basis: "pre_money", anzahl: "1000", poolId: liste[0].id }), bezeichnung: "Serie C" }, bearbeiter);
    expect(gewaehlt.status).toBe(201);
  });

  it("Rechte: ein einsteigender Fonds darf die Runde anlegen, die Aufstockung des Pools aber nicht", async () => {
    await esop();
    expect((await post(rundenPfad, serieB({ basis: "pre_money", anzahl: "150000" }, ID.anderer), fremd)).status).toBe(403);
    expect((await db.select().from(s.finanzierungsrunde)).length).toBe(2);
    expect((await post(rundenPfad, serieB(undefined, ID.anderer), fremd)).status).toBe(201);
  });

  it("keine Aufstockung bei einer Brückenrunde", async () => {
    expect((await post(rundenPfad, { art: "bruecke", bezeichnung: "Brücke", datum: "2026-01-01", poolAufstockung: { basis: "pre_money", anzahl: "1000" } }, bearbeiter)).status).toBe(400);
  });

  it("Löschen eines Entwurfs mit Aufstockung verlangt das Recht am Pool, nicht nur an der Runde", async () => {
    await esop();
    // Angelegt von jemandem mit Recht am Pool; einzige Position ist die des anderen Fonds
    const runde = await json(await post(rundenPfad, serieB({ basis: "pre_money", anzahl: "150000" }, ID.anderer), beide));
    expect(runde.id).toBeTruthy();
    // Der andere Fonds ist nur über diesen Entwurf verbunden: Er darf die Runde sehen, aber die Aufstockung nicht mitlöschen
    const verweigert = await loesche(`/finanzierungsrunden/${runde.id}`, undefined, fremd);
    expect(verweigert.status).toBe(403);
    expect((await db.select().from(s.poolAenderung)).length).toBe(2);
    expect((await loesche(`/finanzierungsrunden/${runde.id}`, undefined, beide)).status).toBe(204);
  });

  it("Grenzen der Eingabe: Zielgröße höchstens 0,99, Anteile vor der Runde höchstens 15 Stellen", async () => {
    expect((await post(vorschlagPfad, { ...eingabe, zielAnteil: "0.995" }, bearbeiter)).status).toBe(400);
    expect((await post(vorschlagPfad, { ...eingabe, anteileVorher: "1234567890123456" }, bearbeiter)).status).toBe(400);
    expect((await post(vorschlagPfad, { ...eingabe, zielAnteil: "0.99", basis: "post_money" }, bearbeiter)).status).toBe(200);
  });

  it("Löschen des Entwurfs nimmt die Aufstockung mit, solange die Zuteilungen in den Pool passen", async () => {
    const poolId = await esop();
    const runde = await json(await post(rundenPfad, serieB({ basis: "pre_money", anzahl: "150000" }), bearbeiter));
    expect((await loesche(`/finanzierungsrunden/${runde.id}`, undefined, bearbeiter)).status).toBe(204);
    const p = (await json(await get(`${pools}?stichtag=2026-03-01`, bearbeiter))).daten[0];
    expect(p.aenderungen).toHaveLength(1);
    // Mit einer Zuteilung, die nur mit der Aufstockung in den Pool passt, bleibt der Entwurf
    const zweite = await json(await post(rundenPfad, serieB({ basis: "pre_money", anzahl: "150000" }), bearbeiter));
    expect((await post(`${pools}/${poolId}/zuteilungen`, { kategorie: "fuehrung", anzahl: "100000", zugeteiltAm: "2026-03-02" }, bearbeiter)).status).toBe(201);
    const verweigert = await loesche(`/finanzierungsrunden/${zweite.id}`, undefined, bearbeiter);
    expect(verweigert.status).toBe(409);
    expect((await json(verweigert)).fehler.code).toBe("ZUTEILUNG_UEBER_POOL");
  });
});

describe("Aufstockung folgt dem Entwurf", () => {
  const rundePfad = (id: string) => `/finanzierungsrunden/${id}`;
  const poolListe = async () => (await json(await get(`${pools}?stichtag=2026-12-31`, bearbeiter))).daten;

  it("neues Rundendatum: die Aufstockung zieht mit, eine von Hand zugeordnete Änderung mit eigenem Datum bleibt", async () => {
    const poolId = await esop();
    const runde = await json(await post(rundenPfad, serieB({ basis: "pre_money", anzahl: "150000" }), bearbeiter));
    expect((await post(`${pools}/${poolId}/aenderungen`, { datum: "2026-04-15", anzahl: "1000", rundeId: runde.id, basis: "pre_money" }, bearbeiter)).status).toBe(201);
    const antwort = await patch(rundePfad(runde.id), { datum: "2026-05-01" }, bearbeiter);
    expect(antwort.status).toBe(200);
    expect((await json(antwort)).datum).toBe("2026-05-01");
    const aenderungen = (await poolListe())[0].aenderungen.filter((a: { rundeId: string | null }) => a.rundeId === runde.id);
    expect(aenderungen.map((a: { datum: string; anzahl: string }) => [a.datum, a.anzahl]).sort()).toEqual([
      ["2026-04-15", "1000"],
      ["2026-05-01", "150000"],
    ]);
    const protokoll = await protokollZeilen(db, "pool_aenderung", "aendern");
    expect(protokoll).toHaveLength(1);
    expect(protokoll[0]!.nachher).toMatchObject({ datum: "2026-05-01", rundeId: runde.id });
  });

  it("passen die Zuteilungen mit dem neuen Datum nicht mehr in den Pool, bleibt alles beim Alten", async () => {
    const poolId = await esop();
    const runde = await json(await post(rundenPfad, serieB({ basis: "pre_money", anzahl: "150000" }), bearbeiter));
    expect((await post(`${pools}/${poolId}/zuteilungen`, { kategorie: "fuehrung", anzahl: "100000", zugeteiltAm: "2026-03-02" }, bearbeiter)).status).toBe(201);
    const verweigert = await patch(rundePfad(runde.id), { datum: "2026-04-01" }, bearbeiter);
    expect(verweigert.status).toBe(409);
    expect((await json(verweigert)).fehler.code).toBe("ZUTEILUNG_UEBER_POOL");
    expect((await json(await get(rundePfad(runde.id), bearbeiter))).datum).toBe("2026-03-01");
    expect((await poolListe())[0].aenderungen[1]).toMatchObject({ datum: "2026-03-01", rundeId: runde.id });
    // Ein früheres Datum passt
    expect((await patch(rundePfad(runde.id), { datum: "2026-02-15" }, bearbeiter)).status).toBe(200);
  });

  it("Rechte: das Datum mit Aufstockung verlangt das Recht am Pool, die Bezeichnung nicht", async () => {
    await esop();
    const runde = await json(await post(rundenPfad, serieB({ basis: "pre_money", anzahl: "150000" }, ID.anderer), beide));
    expect((await patch(rundePfad(runde.id), { datum: "2026-05-01" }, fremd)).status).toBe(403);
    expect((await poolListe())[0].aenderungen[1].datum).toBe("2026-03-01");
    expect((await patch(rundePfad(runde.id), { bezeichnung: "Serie B neu" }, fremd)).status).toBe(200);
    expect((await patch(rundePfad(runde.id), { datum: "2026-05-01" }, beide)).status).toBe(200);
  });

  it("Umstellen auf eine Brückenrunde: mit Aufstockung abgelehnt, ohne erlaubt", async () => {
    await esop();
    const mit = await json(await post(rundenPfad, { ...serieB({ basis: "pre_money", anzahl: "150000" }), positionen: [] }, bearbeiter));
    const verweigert = await patch(rundePfad(mit.id), { art: "bruecke" }, bearbeiter);
    expect(verweigert.status).toBe(409);
    expect((await json(verweigert)).fehler.code).toBe("RUNDE_MIT_AUFSTOCKUNG");
    expect(await json(await get(rundePfad(mit.id), bearbeiter))).toMatchObject({ art: "eigenkapital", status: "entwurf" });
    expect((await poolListe())[0].aenderungen).toHaveLength(2);
    const ohne = await json(await post(rundenPfad, { ...serieB(), bezeichnung: "Serie C", positionen: [] }, bearbeiter));
    const umgestellt = await patch(rundePfad(ohne.id), { art: "bruecke" }, bearbeiter);
    expect(umgestellt.status).toBe(200);
    expect((await json(umgestellt)).art).toBe("bruecke");
  });

  it("Löschen eines Entwurfs, der den Pool geschaffen hat: der leere Pool geht mit", async () => {
    const runde = await json(await post(rundenPfad, serieB({ basis: "pre_money", anzahl: "150000", neuerPool: { art: "esop", bezeichnung: "ESOP 2026" } }), bearbeiter));
    const poolId = (await poolListe())[0].id;
    expect((await loesche(rundePfad(runde.id), undefined, bearbeiter)).status).toBe(204);
    expect(await poolListe()).toEqual([]);
    expect(await db.select().from(s.mitarbeiterpool)).toHaveLength(0);
    const protokoll = await protokollZeilen(db, "mitarbeiterpool", "loeschen");
    expect(protokoll.map((z) => z.datensatz_id)).toEqual([poolId]);
  });

  it("Löschen eines Entwurfs, der den Pool geschaffen hat: mit einer weiteren Änderung bleibt der Pool", async () => {
    const runde = await json(await post(rundenPfad, serieB({ basis: "pre_money", anzahl: "150000", neuerPool: { art: "esop", bezeichnung: "ESOP 2026" } }), bearbeiter));
    const poolId = (await poolListe())[0].id;
    expect((await post(`${pools}/${poolId}/aenderungen`, { datum: "2026-01-15", anzahl: "20000" }, bearbeiter)).status).toBe(201);
    expect((await loesche(rundePfad(runde.id), undefined, bearbeiter)).status).toBe(204);
    const liste = await poolListe();
    expect(liste).toHaveLength(1);
    expect(liste[0].aenderungen).toEqual([expect.objectContaining({ datum: "2026-01-15", anzahl: "20000", rundeId: null })]);
  });

  it("Löschen eines Entwurfs, der den Pool geschaffen hat: mit einer Zuteilung im Pool bleibt der Entwurf", async () => {
    const runde = await json(await post(rundenPfad, serieB({ basis: "pre_money", anzahl: "150000", neuerPool: { art: "esop", bezeichnung: "ESOP 2026" } }), bearbeiter));
    const poolId = (await poolListe())[0].id;
    expect((await post(`${pools}/${poolId}/zuteilungen`, { kategorie: "mitarbeitende", anzahl: "1000", zugeteiltAm: "2026-03-02" }, bearbeiter)).status).toBe(201);
    const verweigert = await loesche(rundePfad(runde.id), undefined, bearbeiter);
    expect(verweigert.status).toBe(409);
    expect((await json(verweigert)).fehler.code).toBe("ZUTEILUNG_UEBER_POOL");
    expect(await poolListe()).toHaveLength(1);
  });
});
