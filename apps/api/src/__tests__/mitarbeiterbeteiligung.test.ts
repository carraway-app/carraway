import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import { erstelleTestApp, legePersonAn, person } from "./hilfen-auth";
import { sql } from "drizzle-orm";
import { leeren, oeffneTestdb, vehikelVon } from "./hilfen";
import { aufrufe, grundbestand, ID, json, protokollZeilen } from "./hilfen-instrumente";

const { db, pool } = oeffneTestdb();
const { get, post, patch, delete: entferne } = aufrufe(erstelleTestApp(db));

const R1 = "00000000-0000-4000-8000-0000000000e1";
const R2 = "00000000-0000-4000-8000-0000000000e2";
const P_FONDS_1 = "00000000-0000-4000-8000-0000000000c1";

const bearbeiterHalter = person("mp-bearbeiter", { rollen: { [ID.fonds]: "bearbeiter" } });
const betrachterHalter = person("mp-betrachter", { rollen: { [ID.fonds]: "betrachter" } });
const bearbeiterFremd = person("mp-fremd", { rollen: { [ID.anderer]: "bearbeiter" } });
const nurKontakte = person("mp-nur-kontakte");
const mitPortfolio = person("mp-portfolio");

/** Unternehmen A wie im Wasserfall-Test: Seed und Serie A, nach der Serie A 1.250.000 ausgegebene Anteile zu 5 € (Post-Money 6,25 Mio). */
beforeEach(async () => {
  await grundbestand(db);
  for (const p of [bearbeiterHalter, betrachterHalter, bearbeiterFremd]) await legePersonAn(db, p);
  await db.execute(sql`DELETE FROM nutzergruppe`);
  await db.execute(sql`DELETE FROM rechterolle`);
  await db.insert(s.finanzierungsrunde).values([
    { id: R1, organisationId: ID.orgA, bezeichnung: "Seed", datum: "2025-01-10", preMoney: "2000000.00", postMoney: "2300000.00", preisJeAnteil: "2.0000", anteileGesamtNach: "1150000" },
    { id: R2, organisationId: ID.orgA, bezeichnung: "Serie A", datum: "2025-09-01", preMoney: "5750000.00", postMoney: "6250000.00", preisJeAnteil: "5.0000", anteileGesamtNach: "1250000" },
  ]);
  await db.insert(s.rundenposition).values([
    { id: P_FONDS_1, rundeId: R1, fondsId: ID.fonds, betrag: "100000.00", anteile: "50000", rolle: "lead" },
    { rundeId: R1, vehikelId: await vehikelVon(db, ID.orgB), betrag: "200000.00", anteile: "100000", rolle: "co" },
    { rundeId: R2, fondsId: ID.fonds, betrag: "200000.00", anteile: "40000", rolle: "lead" },
    { rundeId: R2, vehikelId: await vehikelVon(db, ID.orgB), betrag: "300000.00", anteile: "60000", rolle: "co" },
  ]);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const pfad = `/organisationen/${ID.orgA}/mitarbeiterpools`;
const esop = { art: "esop", bezeichnung: "ESOP 2025", groesse: "100000", datum: "2025-03-01", beschluss: "Gesellschafterbeschluss vom 01.03.2025" };

/** Pool mit 100.000 Einheiten, Zuteilung an Mitarbeitende (40.000 zu 2 €, 1 Jahr Cliff, 4 Jahre) und an Gründer (20.000, voll gevestet, ohne Basispreis). */
async function poolMitZuteilungen() {
  const p = await json(await post(pfad, esop, bearbeiterHalter));
  const z1 = await post(`${pfad}/${p.id}/zuteilungen`, { kategorie: "mitarbeitende", anzahl: "40000", basispreis: "2", zugeteiltAm: "2025-03-01", cliffMonate: 12, vestingMonate: 48 }, bearbeiterHalter);
  expect(z1.status).toBe(201);
  const z2 = await post(`${pfad}/${p.id}/zuteilungen`, { kategorie: "gruender", anzahl: "20000", zugeteiltAm: "2025-03-01", status: "gevestet" }, bearbeiterHalter);
  expect(z2.status).toBe(201);
  return { poolId: p.id as string, z1: (await json(z1)).id as string };
}

describe("Pools und Zuteilungen", () => {
  it("legt einen Pool an, teilt nach Kategorie zu (ohne Namen), zeigt Stand und Vesting und protokolliert", async () => {
    const antwort = await post(pfad, esop, bearbeiterHalter);
    expect(antwort.status).toBe(201);
    const p = await json(antwort);
    expect(p).toMatchObject({ art: "esop", regel: "wie_anteile", stand: { groesse: "100000", ausstehend: "0", frei: "100000" }, aenderungen: [{ datum: "2025-03-01", anzahl: "100000", rundeId: null, basis: null }] });
    const z = await json(await post(`${pfad}/${p.id}/zuteilungen`, { kategorie: "beirat", anzahl: "4800", zugeteiltAm: "2025-03-15" }, bearbeiterHalter));
    expect(z).toMatchObject({ kategorie: "beirat", bezeichnung: null, basispreis: "0.0000", cliffMonate: 12, vestingMonate: 48, status: "zugeteilt" });
    const liste = await json(await get(`${pfad}?stichtag=2026-07-31`, betrachterHalter));
    expect(liste.daten).toHaveLength(1);
    // 16 volle Monate von 48: 1.600 gevestet
    expect(liste.daten[0].zuteilungen[0]).toMatchObject({ gevestet: "1600", beimExit: "1600" });
    expect(liste.daten[0].stand).toMatchObject({ groesse: "100000", ausstehend: "4800", frei: "95200", vollVerwaessert: "100000" });
    expect((await protokollZeilen(db, "mitarbeiterpool")).length).toBe(1);
    expect((await protokollZeilen(db, "mitarbeiterzuteilung")).length).toBe(1);
  });

  it("Aufstockung in einer Runde (Pre-Money) mit Verlauf; Regeln: nie negativ, Zuteilungen nie über dem Pool", async () => {
    const { poolId, z1 } = await poolMitZuteilungen();
    const auf = await post(`${pfad}/${poolId}/aenderungen`, { anzahl: "50000", datum: "2025-09-01", rundeId: R2, basis: "pre_money" }, bearbeiterHalter);
    expect(auf.status).toBe(201);
    expect(await json(auf)).toMatchObject({ anzahl: "50000", rundeId: R2, basis: "pre_money" });
    // Runde ohne Basis oder Basis ohne Runde
    expect((await post(`${pfad}/${poolId}/aenderungen`, { anzahl: "1", datum: "2025-10-01", rundeId: R2 }, bearbeiterHalter)).status).toBe(400);
    // Verkleinerung unter null und unter die Zuteilungen
    const negativ = await post(`${pfad}/${poolId}/aenderungen`, { anzahl: "-200000", datum: "2025-10-01" }, bearbeiterHalter);
    expect(negativ.status).toBe(409);
    expect((await json(negativ)).fehler.code).toBe("POOL_NEGATIV");
    const unter = await post(`${pfad}/${poolId}/aenderungen`, { anzahl: "-100000", datum: "2025-10-01" }, bearbeiterHalter);
    expect((await json(unter)).fehler.code).toBe("ZUTEILUNG_UEBER_POOL");
    // Zu viel zugeteilt vor der Aufstockung (100.000 − 60.000 frei), danach passt es
    const zuViel = await post(`${pfad}/${poolId}/zuteilungen`, { kategorie: "fuehrung", anzahl: "50000", zugeteiltAm: "2025-06-01" }, bearbeiterHalter);
    expect((await json(zuViel)).fehler.code).toBe("ZUTEILUNG_UEBER_POOL");
    expect((await post(`${pfad}/${poolId}/zuteilungen`, { kategorie: "fuehrung", anzahl: "50000", zugeteiltAm: "2025-10-01" }, bearbeiterHalter)).status).toBe(201);
    // Verfallen braucht ein Datum; danach ist der Teil wieder frei
    expect((await patch(`${pfad}/${poolId}/zuteilungen/${z1}`, { status: "verfallen" }, bearbeiterHalter)).status).toBe(400);
    const verfallen = await patch(`${pfad}/${poolId}/zuteilungen/${z1}`, { status: "verfallen", statusAm: "2026-02-01" }, bearbeiterHalter);
    expect(verfallen.status).toBe(200);
    const liste = await json(await get(`${pfad}?stichtag=2026-03-01`));
    expect(liste.daten[0].stand).toMatchObject({ groesse: "150000", ausstehend: "70000", frei: "80000" });
  });

  it("Regel anteilig nur bei VSOP, Bezeichnung eindeutig, Rechte wie bei den Anteilsklassen", async () => {
    expect((await post(pfad, { ...esop, regel: "anteilig" }, bearbeiterHalter)).status).toBe(400);
    expect((await post(pfad, { ...esop, art: "vsop", bezeichnung: "VSOP", regel: "anteilig" }, bearbeiterHalter)).status).toBe(201);
    expect((await json(await post(pfad, { ...esop, art: "vsop", bezeichnung: "VSOP" }, bearbeiterHalter))).fehler.code).toBe("MITARBEITERPOOL_NAME_VORHANDEN");
    expect((await post(pfad, esop, betrachterHalter)).status).toBe(403);
    expect((await post(pfad, esop, bearbeiterFremd)).status).toBe(403);
    expect((await get(pfad, bearbeiterFremd)).status).toBe(403);
    expect((await get(pfad, betrachterHalter)).status).toBe(200);
  });
});

describe("Austritte (Leaver)", () => {
  const austritte = (poolId: string, z1: string) => `${pfad}/${poolId}/zuteilungen/${z1}/austritte`;

  it("Good Leaver mit Teilverfall: Vorgabe bleiben, Vesting friert ein, Rest verfällt in den freien Pool; Rückkauf zu eigenem Preis", async () => {
    const { poolId, z1 } = await poolMitZuteilungen();
    // 10.000 der 40.000 Einheiten scheiden am 01.09.2026 aus (18 volle Monate von 48: 3.750 gevestet, 6.250 verfallen)
    const good = await post(austritte(poolId, z1), { art: "good_leaver", austrittAm: "2026-09-01", anzahl: "10000" }, bearbeiterHalter);
    expect(good.status).toBe(201);
    const zuteilung = await json(good);
    expect(zuteilung.austritte).toEqual([{ id: expect.any(String), art: "good_leaver", austrittAm: "2026-09-01", anzahl: "10000", gevestet: "bleiben", rueckkaufpreis: null }]);
    const austrittId = zuteilung.austritte[0].id as string;
    // Stichtag 01.03.2027 (24 Monate): übrige 30.000 vesten zur Hälfte (15.000), dazu 3.750 des Leavers
    const liste = await json(await get(`${pfad}?stichtag=2027-03-01`, betrachterHalter));
    expect(liste.daten[0].zuteilungen.find((z: { id: string }) => z.id === z1)).toMatchObject({ betroffen: "10000", gevestet: "18750", verfallen: "6250", rueckgekauft: "0", verbleibend: "33750", rueckkaufBetrag: "0.00" });
    expect(liste.daten[0].stand).toMatchObject({ groesse: "100000", ausstehend: "53750", verfallen: "6250", rueckgekauft: "0", frei: "46250", vollVerwaessert: "100000" });
    // Vor dem Austritt gilt der Plan, der Austritt steht schon in der Liste
    const vorher = (await json(await get(`${pfad}?stichtag=2026-08-31`))).daten[0];
    expect(vorher.stand).toMatchObject({ ausstehend: "60000", verfallen: "0" });
    expect(vorher.zuteilungen.find((z: { id: string }) => z.id === z1)).toMatchObject({ betroffen: "0", austritte: [{ id: austrittId }] });
    // Rückkauf zu 1,50 € statt zum Basispreis
    const rueckkauf = await json(await patch(`${austritte(poolId, z1)}/${austrittId}`, { gevestet: "rueckkauf", rueckkaufpreis: "1.5" }, bearbeiterHalter));
    expect(rueckkauf.austritte[0]).toMatchObject({ gevestet: "rueckkauf", rueckkaufpreis: "1.5000" });
    const nachRueckkauf = await json(await get(`${pfad}?stichtag=2027-03-01`));
    expect(nachRueckkauf.daten[0].zuteilungen.find((z: { id: string }) => z.id === z1)).toMatchObject({ gevestet: "15000", verfallen: "6250", rueckgekauft: "3750", verbleibend: "30000", rueckkaufBetrag: "5625.00" });
    // Zurück auf bleiben: der Rückkaufpreis entfällt; Art wechseln ohne Regel: Vorgabe der neuen Art
    expect((await json(await patch(`${austritte(poolId, z1)}/${austrittId}`, { gevestet: "bleiben" }, bearbeiterHalter))).austritte[0]).toMatchObject({ rueckkaufpreis: null });
    expect((await json(await patch(`${austritte(poolId, z1)}/${austrittId}`, { art: "bad_leaver" }, bearbeiterHalter))).austritte[0]).toMatchObject({ art: "bad_leaver", gevestet: "verfallen" });
    // Entfernen: keine Austritte mehr
    const ohne = await entferne(`${austritte(poolId, z1)}/${austrittId}`, undefined, bearbeiterHalter);
    expect(ohne.status).toBe(200);
    expect(await json(ohne)).toMatchObject({ austritte: [], betroffen: "0", verfallen: "0" });
    expect((await entferne(`${austritte(poolId, z1)}/${austrittId}`, undefined, bearbeiterHalter)).status).toBe(404);
    expect((await protokollZeilen(db, "zuteilung_austritt")).length).toBe(5);
  });

  it("mehrere Austritte zu verschiedenen Daten: je Austritt eigene Regel, die Summe der Einheiten höchstens die Anzahl", async () => {
    const { poolId, z1 } = await poolMitZuteilungen();
    // 40.000 ab 01.03.2025 zu 2 €: 10.000 Good Leaver am 01.09.2026 (18 Monate), 4.000 Bad Leaver am 15.04.2026 (13 Monate),
    // 6.000 Rückkauf zum Basispreis am 01.03.2027 (24 Monate); Stichtag 01.03.2028 (36 Monate)
    expect((await post(austritte(poolId, z1), { art: "good_leaver", austrittAm: "2026-09-01", anzahl: "10000" }, bearbeiterHalter)).status).toBe(201);
    expect((await post(austritte(poolId, z1), { art: "bad_leaver", austrittAm: "2026-04-15", anzahl: "4000" }, bearbeiterHalter)).status).toBe(201);
    const dritter = await json(await post(austritte(poolId, z1), { art: "bad_leaver", austrittAm: "2027-03-01", anzahl: "6000", gevestet: "rueckkauf" }, bearbeiterHalter));
    expect(dritter.austritte.map((a: { austrittAm: string }) => a.austrittAm)).toEqual(["2026-04-15", "2026-09-01", "2027-03-01"]);
    const z = (await json(await get(`${pfad}?stichtag=2028-03-01`))).daten[0].zuteilungen.find((x: { id: string }) => x.id === z1);
    // übrige 20.000 × 36/48 = 15.000; Good 3.750 bleiben (6.250 verfallen); Bad 4.000 verfallen; Rückkauf 3.000 (3.000 verfallen), 6.000 €
    expect(z).toMatchObject({ betroffen: "20000", gevestet: "18750", verfallen: "13250", rueckgekauft: "3000", verbleibend: "23750", rueckkaufBetrag: "6000.00" });
    // Zwischen dem ersten und zweiten Austritt zählt nur der erste
    expect((await json(await get(`${pfad}?stichtag=2026-06-01`))).daten[0].zuteilungen.find((x: { id: string }) => x.id === z1)).toMatchObject({ betroffen: "4000", verfallen: "4000" });
    // Ohne Einheiten: alle übrigen (hier 20.000); danach ist nichts mehr frei
    const rest = await json(await post(austritte(poolId, z1), { art: "good_leaver", austrittAm: "2028-01-01" }, bearbeiterHalter));
    expect(rest.austritte.at(-1)).toMatchObject({ anzahl: "20000", gevestet: "bleiben" });
    const code = async (antwort: Response) => (await json(antwort)).fehler?.felder?.[0]?.code;
    expect(await code(await post(austritte(poolId, z1), { art: "good_leaver", austrittAm: "2028-01-01" }, bearbeiterHalter))).toBe("ueber_anzahl");
    expect(await code(await post(austritte(poolId, z1), { art: "good_leaver", austrittAm: "2028-01-01", anzahl: "1" }, bearbeiterHalter))).toBe("ueber_anzahl");
    // Ändern über die Anzahl hinaus geht nicht; die Zuteilung lässt sich nicht unter die Summe der Austritte kürzen
    expect(await code(await patch(`${austritte(poolId, z1)}/${rest.austritte.at(-1).id}`, { anzahl: "20001" }, bearbeiterHalter))).toBe("ueber_anzahl");
    expect(await code(await patch(`${pfad}/${poolId}/zuteilungen/${z1}`, { anzahl: "39999" }, bearbeiterHalter))).toBe("unter_austritten");
    expect(await code(await patch(`${pfad}/${poolId}/zuteilungen/${z1}`, { zugeteiltAm: "2026-05-01" }, bearbeiterHalter))).toBe("nach_austritt");
    expect(await code(await patch(`${pfad}/${poolId}/zuteilungen/${z1}`, { status: "ausgeuebt", statusAm: "2028-02-01" }, bearbeiterHalter))).toBe("ausgeuebt_mit_leaver");
  });

  it("prüft die Angaben: nicht vor der Zuteilung, Preis nur mit Rückkauf, nicht bei ausgeübten, Rechte, fremde Zuteilung", async () => {
    const { poolId, z1 } = await poolMitZuteilungen();
    const code = async (koerper: object) => (await json(await post(austritte(poolId, z1), koerper, bearbeiterHalter))).fehler?.felder?.[0]?.code;
    expect((await post(austritte(poolId, z1), { austrittAm: "2026-01-01" }, bearbeiterHalter)).status).toBe(400);
    expect(await code({ art: "bad_leaver", austrittAm: "2025-01-01" })).toBe("vor_zuteilung");
    expect(await code({ art: "bad_leaver", austrittAm: "2026-01-01", anzahl: "40001" })).toBe("ueber_anzahl");
    expect(await code({ art: "bad_leaver", austrittAm: "2026-01-01", gevestet: "verfallen", rueckkaufpreis: "1" })).toBe("preis_ohne_rueckkauf");
    const ausgeuebt = await json(await post(`${pfad}/${poolId}/zuteilungen`, { kategorie: "sonstige", anzahl: "1000", zugeteiltAm: "2025-04-01", status: "ausgeuebt", statusAm: "2025-06-01" }, bearbeiterHalter));
    expect((await json(await post(austritte(poolId, ausgeuebt.id), { art: "bad_leaver", austrittAm: "2025-05-01" }, bearbeiterHalter))).fehler.felder[0].code).toBe("ausgeuebt_mit_leaver");
    expect((await post(austritte(poolId, z1), { art: "bad_leaver", austrittAm: "2026-01-01" }, betrachterHalter)).status).toBe(403);
    expect((await post(austritte(poolId, z1), { art: "bad_leaver", austrittAm: "2026-01-01" }, bearbeiterFremd)).status).toBe(403);
    expect((await json(await post(austritte(poolId, "00000000-0000-4000-8000-0000000000ff"), { art: "bad_leaver", austrittAm: "2026-01-01" }, bearbeiterHalter))).fehler.code).toBe("ZUTEILUNG_NICHT_GEFUNDEN");
    const neu = await json(await post(`${pfad}/${poolId}/zuteilungen`, { kategorie: "sonstige", anzahl: "1000", zugeteiltAm: "2025-04-01" }, bearbeiterHalter));
    const bad = await json(await post(austritte(poolId, neu.id), { art: "bad_leaver", austrittAm: "2025-06-01" }, bearbeiterHalter));
    expect(bad).toMatchObject({ austritte: [{ anzahl: "1000", gevestet: "verfallen" }], betroffen: "1000", gevestet: "0", verfallen: "1000", verbleibend: "0" });
    // Austritt einer anderen Zuteilung über diese Zuteilung: nicht gefunden
    expect((await json(await patch(`${austritte(poolId, z1)}/${bad.austritte[0].id}`, { anzahl: "1" }, bearbeiterHalter))).fehler.code).toBe("AUSTRITT_NICHT_GEFUNDEN");
  });

  it("Bad Leaver: verfallene Einheiten zurück in den Pool (voll verwässert unverändert), Platz für neue Zuteilungen, nicht im Wasserfall", async () => {
    const { poolId, z1 } = await poolMitZuteilungen();
    const angelegt = await post(austritte(poolId, z1), { art: "bad_leaver", austrittAm: "2026-01-01" }, bearbeiterHalter);
    expect(angelegt.status).toBe(201);
    const austrittId = (await json(angelegt)).austritte[0].id as string;
    // Frei: vor dem Austritt 40.000, danach 80.000
    expect((await json(await post(`${pfad}/${poolId}/zuteilungen`, { kategorie: "fuehrung", anzahl: "70000", zugeteiltAm: "2025-12-01" }, bearbeiterHalter))).fehler.code).toBe("ZUTEILUNG_UEBER_POOL");
    expect((await post(`${pfad}/${poolId}/zuteilungen`, { kategorie: "fuehrung", anzahl: "70000", zugeteiltAm: "2026-02-01" }, bearbeiterHalter)).status).toBe(201);
    // Den Austritt zurücknehmen oder verschieben geht nicht mehr: die Zuteilungen lägen über dem Pool
    expect((await json(await entferne(`${austritte(poolId, z1)}/${austrittId}`, undefined, bearbeiterHalter))).fehler.code).toBe("ZUTEILUNG_UEBER_POOL");
    expect((await json(await patch(`${austritte(poolId, z1)}/${austrittId}`, { austrittAm: "2026-03-01" }, bearbeiterHalter))).fehler.code).toBe("ZUTEILUNG_UEBER_POOL");
    const d = await json(await get(`/beteiligungen/${ID.eigen}/kapitaltabelle?stichtag=2026-01-15`, betrachterHalter));
    expect(d).toMatchObject({ anteileUnverwaessert: "1250000", anteileVollVerwaessert: "1350000" });
    expect(d.zeilen.find((z: { halter: { art: string } }) => z.halter.art === "pool_zugeteilt")).toMatchObject({ anteile: "20000" });
    expect(d.zeilen.find((z: { halter: { art: string } }) => z.halter.art === "pool_frei")).toMatchObject({ anteile: "80000" });
    const w = await json(await post(`/beteiligungen/${ID.eigen}/wasserfall`, { exitwert: "12500000", exitdatum: "2026-01-15" }, betrachterHalter));
    // Ganz verfallen: keine Zeile im Wasserfall (wie Status verfallen)
    expect(w.zeilen.find((z: { mitarbeiter: { kategorie: string } | null }) => z.mitarbeiter?.kategorie === "mitarbeitende")).toBeUndefined();
    expect(w.mitarbeiter).toMatchObject({ einheiten: "20000" });
  });
});

describe("Kapitaltabelle unverwässert und voll verwässert", () => {
  it("Pool als eigene Zeilen (zugeteilt, frei), Anteil des Fonds in beiden Sichten", async () => {
    await poolMitZuteilungen();
    const d = await json(await get(`/beteiligungen/${ID.eigen}/kapitaltabelle?stichtag=2026-01-01`, betrachterHalter));
    expect(d).toMatchObject({ anteileUnverwaessert: "1250000", anteileVollVerwaessert: "1350000", mitPool: true, standardSicht: "voll_verwaessert" });
    const zugeteilt = d.zeilen.find((z: { halter: { art: string } }) => z.halter.art === "pool_zugeteilt");
    const frei = d.zeilen.find((z: { halter: { art: string } }) => z.halter.art === "pool_frei");
    expect(zugeteilt).toMatchObject({ halter: { name: "ESOP 2025" }, anteile: "60000", anteilUnverwaessert: null, anteilVollVerwaessert: "0.044444", ausgegeben: false });
    expect(frei).toMatchObject({ anteile: "40000", anteilUnverwaessert: null, ausgegeben: false });
    expect(d.diesesFonds).toEqual({ anteile: "90000", anteilUnverwaessert: "0.072000", anteilVollVerwaessert: "0.066667", investiert: "300000.00" });
    expect(d.klassen.find((k: { art: string }) => k.art === "pool")).toMatchObject({ anteile: "100000", anteilUnverwaessert: null });
    // Summe aller Gruppen = voll verwässert, ohne Pool = unverwässert
    expect(d.klassen.reduce((summe: number, k: { anteile: string }) => summe + Number(k.anteile), 0)).toBe(1350000);
    expect(d.klassen.filter((k: { art: string }) => k.art !== "pool").reduce((summe: number, k: { anteile: string }) => summe + Number(k.anteile), 0)).toBe(1250000);
  });

  it("ausgeübte Optionen nach der letzten Runde sind ausgegebene Anteile", async () => {
    const { poolId } = await poolMitZuteilungen();
    const z = await json(await post(`${pfad}/${poolId}/zuteilungen`, { kategorie: "sonstige", anzahl: "10000", basispreis: "1", zugeteiltAm: "2025-04-01", status: "ausgeuebt", statusAm: "2025-12-01" }, bearbeiterHalter));
    expect(z.status).toBe("ausgeuebt");
    const d = await json(await get(`/beteiligungen/${ID.eigen}/kapitaltabelle?stichtag=2026-01-01`));
    expect(d.zeilen.find((x: { halter: { art: string } }) => x.halter.art === "ausgeuebt")).toMatchObject({ anteile: "10000", investiert: "10000.00", ausgegeben: true });
    // ausgegeben 1.260.000; Pool: 60.000 ausstehend, frei 100.000 − 60.000 − 10.000
    expect(d).toMatchObject({ anteileUnverwaessert: "1260000", anteileVollVerwaessert: "1350000" });
  });
});

describe("Wasserfall mit Mitarbeiterbeteiligung", () => {
  it("nur gevestete Einheiten, Basispreis abgezogen, freier Pool ohne Erlös; Ergebnis je Inhaber", async () => {
    await poolMitZuteilungen();
    const antwort = await post(`/beteiligungen/${ID.eigen}/wasserfall`, { exitwert: "12500000", exitdatum: "2026-06-30" }, betrachterHalter);
    expect(antwort.status).toBe(200);
    const d = await json(antwort);
    // 15 volle Monate von 48: 12.500 Einheiten zu 2 €; Gründer 20.000 voll gevestet ohne Basispreis. p = (12,5 Mio + 25.000) ÷ 1.282.500
    const p = new Decimal("12525000").div("1282500");
    const mitarbeitende = d.zeilen.find((z: { mitarbeiter: { kategorie: string } | null }) => z.mitarbeiter?.kategorie === "mitarbeitende");
    expect(mitarbeitende).toMatchObject({ halter: { art: "mitarbeiter", name: "ESOP 2025" }, anteile: "12500", mitarbeiter: { art: "esop", basispreis: "2.0000", anzahl: "40000", imGeld: true } });
    expect(new Decimal(mitarbeitende.gesamt).minus(p.minus(2).times(12500)).abs().lessThanOrEqualTo("0.01")).toBe(true);
    const fonds = d.zeilen.find((z: { id: string }) => z.id === P_FONDS_1);
    expect(new Decimal(fonds.gesamt).minus(p.times(50000)).abs().lessThanOrEqualTo("0.01")).toBe(true);
    expect(d.zeilen.reduce((summe: Decimal, z: { gesamt: string }) => summe.plus(z.gesamt), new Decimal(0)).toFixed(2)).toBe("12500000.00");
    expect(d.mitarbeiter).toMatchObject({ einheiten: "32500", imGeld: "32500" });
    expect(d.klassen.map((k: { art: string }) => k.art)).toEqual(["stamm", "mitarbeiter"]);
    expect(d.minderungsfaktor).toBeNull();
    // Je Investor: Pool der Mitarbeiterbeteiligung als eine Gruppe, Summen decken sich mit Positionen und Mitarbeiter-Summe
    const pool = d.inhaber.find((x: { halter: { art: string } }) => x.halter.art === "mitarbeiter");
    expect(pool).toMatchObject({ halter: { art: "mitarbeiter", name: "ESOP 2025" }, anteile: "32500", investiert: "0.00" });
    expect(pool.positionen).toBeGreaterThanOrEqual(1);
    expect(pool.gesamt).toBe(d.mitarbeiter.gesamt);
    expect(d.inhaber.reduce((summe: Decimal, x: { gesamt: string }) => summe.plus(x.gesamt), new Decimal(0)).toFixed(2)).toBe("12500000.00");
  });

  it("Kurve: der Knick „im Geld“ erscheint", async () => {
    await poolMitZuteilungen();
    const d = await json(await get(`/beteiligungen/${ID.eigen}/wasserfall/kurve?exitdatum=2026-06-30&bis=10000000`));
    expect(d.knicke.some((k: { ereignisse: { art: string }[] }) => k.ereignisse.some((e) => e.art === "im_geld"))).toBe(true);
  });
});

describe("Runden auf voll verwässerter Basis", () => {
  it("Vorschau: Preis voll verwässert, die ausgegebenen Anteile ergeben sich ohne den Pool", async () => {
    await poolMitZuteilungen();
    // Voll verwässert vor der Runde 1.350.000 Anteile, Pre-Money 13,5 Mio: 10 € je Anteil
    const v = await json(
      await post(
        `/organisationen/${ID.orgA}/finanzierungsrunden/vorschau`,
        { bezeichnung: "Serie B", datum: "2026-03-01", preMoney: "13500000.00", preisJeAnteil: "10.0000", positionen: [{ fondsId: ID.fonds, betrag: "1000000.00", anteile: "100000", rolle: "lead" }] },
        bearbeiterHalter,
      ),
    );
    expect(v).toMatchObject({ postMoney: "14500000.00", anteileGesamtNach: "1350000" });
    expect(v.pruefung).toMatchObject({ schliessbar: true, preisBasis: "voll_verwaessert", poolAnteile: "100000", abweichungen: [] });
  });

  it("Pool sichtbar = Runden sichtbar: ohne Recht am Unternehmen 403, mit einer Position in einer Runde Pool und Rundenprüfung mit Pool", async () => {
    await poolMitZuteilungen();
    const vorschau = { bezeichnung: "Serie B", datum: "2026-03-01", preMoney: "13500000.00", preisJeAnteil: "10.0000", positionen: [{ organisationId: ID.orgB, betrag: "1000000.00", anteile: "100000", rolle: "lead" }] };
    // Ohne Recht am Unternehmen: Vorschau, Runden und Pool gesperrt
    expect((await json(await post(`/organisationen/${ID.orgA}/finanzierungsrunden/vorschau`, vorschau, bearbeiterFremd))).pruefung.poolAnteile).toBeUndefined();
    // Ein eigener, nicht verbundener Fonds im Körper verschafft kein Leserecht: Die Vorschau rechnet dann ohne Pool und nennt ihn nicht
    const mitEigenemFonds = { ...vorschau, positionen: [{ fondsId: ID.anderer, betrag: "1000000.00", anteile: "100000", rolle: "lead" }] };
    const ohnePool = await json(await post(`/organisationen/${ID.orgA}/finanzierungsrunden/vorschau`, mitEigenemFonds, bearbeiterFremd));
    expect(ohnePool.anteileGesamtNach).toBe("1450000");
    expect(ohnePool.pruefung.poolAnteile).toBeUndefined();
    expect(ohnePool.pruefung.preisBasis).toBeUndefined();
    expect((await get(`/organisationen/${ID.orgA}/finanzierungsrunden`, bearbeiterFremd)).status).toBe(403);
    expect((await get(pfad, bearbeiterFremd)).status).toBe(403);
    // Mit einer Position in der Serie A: Runden und Pool lesbar, die Prüfung nennt den Pool
    await db.insert(s.rundenposition).values({ rundeId: R2, fondsId: ID.anderer, betrag: "0.00", anteile: "0", rolle: "co" });
    const runden = await json(await get(`/organisationen/${ID.orgA}/finanzierungsrunden`, bearbeiterFremd));
    expect(runden.daten.find((r: { id: string }) => r.id === R2).pruefung).toMatchObject({ preisBasis: "unverwaessert", poolAnteile: "100000" });
    expect((await get(pfad, bearbeiterFremd)).status).toBe(200);
    const v = await json(await post(`/organisationen/${ID.orgA}/finanzierungsrunden/vorschau`, vorschau, bearbeiterFremd));
    expect(v).toMatchObject({ anteileGesamtNach: "1350000", pruefung: { preisBasis: "voll_verwaessert", poolAnteile: "100000" } });
    // Schreiben verlangt bearbeiter wie beim Anlegen einer Runde
    expect((await post(pfad, { ...esop, bezeichnung: "ESOP 2" }, betrachterHalter)).status).toBe(403);
  });

  it("Anlegen durch verschiedene Personen: gleiche gespeicherte Werte und gleiche Abschließbarkeit", async () => {
    await poolMitZuteilungen();
    await db.insert(s.rundenposition).values({ rundeId: R2, fondsId: ID.anderer, betrag: "0.00", anteile: "0", rolle: "co" });
    const runde = (bezeichnung: string, fondsId: string) => ({ bezeichnung, datum: "2026-03-01", preMoney: "13500000.00", preisJeAnteil: "10.0000", positionen: [{ fondsId, betrag: "1000000.00", anteile: "100000", rolle: "lead" }] });
    const mit = await post(`/organisationen/${ID.orgA}/finanzierungsrunden`, runde("Serie B", ID.fonds), bearbeiterHalter);
    const ohne = await post(`/organisationen/${ID.orgA}/finanzierungsrunden`, runde("Serie B2", ID.anderer), bearbeiterFremd);
    expect(mit.status).toBe(201);
    expect(ohne.status).toBe(201);
    const a = await json(mit);
    const b = await json(ohne);
    expect([b.postMoney, b.anteileGesamtNach, b.pruefung.schliessbar]).toEqual([a.postMoney, a.anteileGesamtNach, a.pruefung.schliessbar]);
    expect(a.anteileGesamtNach).toBe("1350000");
    expect(a.pruefung).toMatchObject({ preisBasis: "voll_verwaessert", poolAnteile: "100000" });
    expect(b.pruefung).toMatchObject({ preisBasis: "voll_verwaessert", poolAnteile: "100000" });
  });

  it("eine Runde mit Preis auf unverwässerter Basis bekommt einen Hinweis, keinen Fehler", async () => {
    await poolMitZuteilungen();
    const runden = await json(await get(`/organisationen/${ID.orgA}/finanzierungsrunden`, betrachterHalter));
    const serieA = (runden.daten ?? runden).find((r: { id: string }) => r.id === R2);
    expect(serieA.pruefung).toMatchObject({ schliessbar: true, preisBasis: "unverwaessert", poolAnteile: "100000" });
    expect(serieA.pruefung.abweichungen.map((a: { code: string }) => a.code)).toContain("PREIS_UNVERWAESSERT");
    // Die Seed-Runde liegt vor dem Pool: keine Abweichung
    const seed = (runden.daten ?? runden).find((r: { id: string }) => r.id === R1);
    expect(seed.pruefung.preisBasis).toBeUndefined();
  });
});

describe("Bereiche je Fonds", () => {
  it("Pool wie Runden im Bereich Portfolio: ohne Portfolio am Fonds 403, mit Portfolio lesbar", async () => {
    await poolMitZuteilungen();
    const kontakteId = await legePersonAn(db, nurKontakte);
    const portfolioId = await legePersonAn(db, mitPortfolio);
    const rolle = await json(await post("/rechte/rollen", { name: "Alles", bereiche: ["portfolio", "kontakte"] }));
    const gruppe = (name: string, bereiche: string[], mitglied: string) =>
      post("/rechte/gruppen", { name, stufe: "bearbeiter", fondsBeschraenkt: true, bereicheJeFonds: true, fondsIds: [ID.fonds], fondsBereiche: { [ID.fonds]: bereiche }, rollenIds: [rolle.id], mitglieder: [mitglied] });
    expect((await gruppe("Nur Kontakte", ["kontakte"], kontakteId)).status).toBe(201);
    expect((await gruppe("Portfolio", ["portfolio"], portfolioId)).status).toBe(201);
    expect((await get(pfad, nurKontakte)).status).toBe(403);
    expect((await get(`/organisationen/${ID.orgA}/finanzierungsrunden`, nurKontakte)).status).toBe(403);
    expect((await post(pfad, { ...esop, bezeichnung: "ESOP K" }, nurKontakte)).status).toBe(403);
    expect((await get(pfad, mitPortfolio)).status).toBe(200);
    expect((await get(`/organisationen/${ID.orgA}/finanzierungsrunden`, mitPortfolio)).status).toBe(200);
    expect((await post(pfad, { ...esop, bezeichnung: "ESOP P" }, mitPortfolio)).status).toBe(201);
  });
});

describe("Einzelne Änderungen eines Pools", () => {
  const RB = "00000000-0000-4000-8000-0000000000e3";
  const RE = "00000000-0000-4000-8000-0000000000e4";
  const aenderungPfad = (poolId: string, id: string) => `${pfad}/${poolId}/aenderungen/${id}`;
  const verlauf = async (poolId: string) => (await json(await get(pfad))).daten.find((p: { id: string }) => p.id === poolId).aenderungen as { id: string; anzahl: string; datum: string; rundeId: string | null; basis: string | null }[];
  async function mitRunden() {
    await db.insert(s.finanzierungsrunde).values([
      { id: RB, organisationId: ID.orgA, art: "bruecke", bezeichnung: "Brücke", datum: "2026-01-01" },
      { id: RE, organisationId: ID.orgA, bezeichnung: "Serie B", datum: "2026-06-01", status: "entwurf", preMoney: "9000000.00", postMoney: "10000000.00", preisJeAnteil: "8.0000", anteileGesamtNach: "1250000" },
    ]);
  }

  it("lehnt die Zuordnung zu einer Brückenrunde ab (Anlegen, Ändern, Neuer Pool)", async () => {
    await mitRunden();
    const { poolId } = await poolMitZuteilungen();
    const anlegen = await post(`${pfad}/${poolId}/aenderungen`, { anzahl: "1000", datum: "2026-01-01", rundeId: RB, basis: "pre_money" }, bearbeiterHalter);
    expect(anlegen.status).toBe(409);
    expect((await json(anlegen)).fehler.code).toBe("POOL_AENDERUNG_BRUECKE");
    const neu = await post(pfad, { ...esop, bezeichnung: "ESOP B", rundeId: RB, basis: "post_money" }, bearbeiterHalter);
    expect((await json(neu)).fehler.code).toBe("POOL_AENDERUNG_BRUECKE");
    const ok = await json(await post(`${pfad}/${poolId}/aenderungen`, { anzahl: "1000", datum: "2026-02-01" }, bearbeiterHalter));
    const ziel = await patch(aenderungPfad(poolId, ok.id), { rundeId: RB, basis: "post_money" }, bearbeiterHalter);
    expect((await json(ziel)).fehler.code).toBe("POOL_AENDERUNG_BRUECKE");
    expect((await verlauf(poolId)).find((a) => a.id === ok.id)?.rundeId).toBeNull();
  });

  it("ändert eine Änderung, prüft den Bestand, protokolliert und verlangt das Recht", async () => {
    const { poolId } = await poolMitZuteilungen();
    const a = await json(await post(`${pfad}/${poolId}/aenderungen`, { anzahl: "50000", datum: "2025-09-01" }, bearbeiterHalter));
    // Die Zuteilungen (60.000 ab 01.03.2025) passen weiter in 100.000
    const geaendert = await patch(aenderungPfad(poolId, a.id), { anzahl: "30000", beschluss: "Nachtrag" }, bearbeiterHalter);
    expect(geaendert.status).toBe(200);
    expect(await json(geaendert)).toMatchObject({ id: a.id, anzahl: "30000", datum: "2025-09-01", beschluss: "Nachtrag" });
    expect((await protokollZeilen(db, "pool_aenderung")).filter((z) => z.aktion === "aendern").length).toBe(1);
    // Negative Größe und Zuteilung über dem Pool werden abgelehnt, nichts ändert sich
    expect((await json(await patch(aenderungPfad(poolId, a.id), { anzahl: "-150000" }, bearbeiterHalter))).fehler.code).toBe("POOL_NEGATIV");
    expect((await json(await patch(aenderungPfad(poolId, a.id), { anzahl: "-50000" }, bearbeiterHalter))).fehler.code).toBe("ZUTEILUNG_UEBER_POOL");
    // Datum vor die Zuteilung gezogen: Aufstockung zählt früher, passt
    expect((await patch(aenderungPfad(poolId, a.id), { datum: "2025-01-01" }, bearbeiterHalter)).status).toBe(200);
    expect((await verlauf(poolId)).find((x) => x.id === a.id)).toMatchObject({ anzahl: "30000", datum: "2025-01-01" });
    // Runde ohne Basis, leere Eingabe, fremde Änderung, unbekannte Änderung, Rechte
    expect((await patch(aenderungPfad(poolId, a.id), { rundeId: R2 }, bearbeiterHalter)).status).toBe(400);
    expect((await patch(aenderungPfad(poolId, a.id), {}, bearbeiterHalter)).status).toBe(400);
    expect((await json(await patch(aenderungPfad(poolId, "00000000-0000-4000-8000-0000000000aa"), { anzahl: "1" }, bearbeiterHalter))).fehler.code).toBe("POOL_AENDERUNG_NICHT_GEFUNDEN");
    expect((await patch(aenderungPfad(poolId, a.id), { anzahl: "1" }, betrachterHalter)).status).toBe(403);
    expect((await patch(aenderungPfad(poolId, a.id), { anzahl: "1" }, bearbeiterFremd)).status).toBe(403);
  });

  it("löscht eine Änderung nur, wenn der Bestand passt; die erste Änderung bleibt", async () => {
    const { poolId } = await poolMitZuteilungen();
    const erste = (await verlauf(poolId))[0]!;
    const a = await json(await post(`${pfad}/${poolId}/aenderungen`, { anzahl: "50000", datum: "2025-09-01" }, bearbeiterHalter));
    const b = await json(await post(`${pfad}/${poolId}/aenderungen`, { anzahl: "-50000", datum: "2025-10-01" }, bearbeiterHalter));
    // Ohne die Aufstockung blieben 100.000 minus 50.000 = 50.000 unter den 60.000 Zuteilungen
    expect((await json(await entferne(aenderungPfad(poolId, a.id), undefined, bearbeiterHalter))).fehler.code).toBe("ZUTEILUNG_UEBER_POOL");
    expect((await entferne(aenderungPfad(poolId, b.id), undefined, betrachterHalter)).status).toBe(403);
    expect((await entferne(aenderungPfad(poolId, b.id), undefined, bearbeiterHalter)).status).toBe(204);
    expect((await entferne(aenderungPfad(poolId, a.id), undefined, bearbeiterHalter)).status).toBe(204);
    expect((await entferne(aenderungPfad(poolId, a.id), undefined, bearbeiterHalter)).status).toBe(404);
    expect((await json(await entferne(aenderungPfad(poolId, erste.id), undefined, bearbeiterHalter))).fehler.code).toBe("POOL_LETZTE_AENDERUNG");
    expect((await verlauf(poolId)).map((x) => x.id)).toEqual([erste.id]);
    expect((await protokollZeilen(db, "pool_aenderung")).filter((z) => z.aktion === "loeschen").length).toBe(2);
  });

  it("Änderungen mit Runde folgen ihr: Ändern und Löschen nur im Entwurf der Runde", async () => {
    await mitRunden();
    const { poolId } = await poolMitZuteilungen();
    const a = await json(await post(`${pfad}/${poolId}/aenderungen`, { anzahl: "10000", datum: "2026-06-01", rundeId: RE, basis: "pre_money" }, bearbeiterHalter));
    const imEntwurf = await patch(aenderungPfad(poolId, a.id), { anzahl: "20000", basis: "post_money" }, bearbeiterHalter);
    expect(imEntwurf.status).toBe(200);
    expect(await json(imEntwurf)).toMatchObject({ anzahl: "20000", basis: "post_money", rundeId: RE });
    // Neue Zuordnung beim Ändern nur zu einem Entwurf (R2 ist abgeschlossen); das Anlegen darf auf eine frühere Runde verweisen
    const lose = await json(await post(`${pfad}/${poolId}/aenderungen`, { anzahl: "1000", datum: "2026-02-01" }, bearbeiterHalter));
    const zuAbgeschlossen = await patch(aenderungPfad(poolId, lose.id), { rundeId: R2, basis: "pre_money" }, bearbeiterHalter);
    expect(zuAbgeschlossen.status).toBe(409);
    expect((await json(zuAbgeschlossen)).fehler.code).toBe("POOL_AENDERUNG_RUNDE_FEST");
    expect((await post(`${pfad}/${poolId}/aenderungen`, { anzahl: "1000", datum: "2025-09-01", rundeId: R2, basis: "post_money" }, bearbeiterHalter)).status).toBe(201);
    expect((await patch(aenderungPfad(poolId, lose.id), { rundeId: RE, basis: "pre_money" }, bearbeiterHalter)).status).toBe(200);
    // Zuordnung lösen: beide Felder zusammen
    expect((await patch(aenderungPfad(poolId, a.id), { basis: null }, bearbeiterHalter)).status).toBe(400);
    // Abgeschlossen: weder ändern noch löschen
    await db.update(s.finanzierungsrunde).set({ status: "abgeschlossen" }).where(sql`id = ${RE}`);
    for (const antwort of [await patch(aenderungPfad(poolId, a.id), { anzahl: "1" }, bearbeiterHalter), await entferne(aenderungPfad(poolId, a.id), undefined, bearbeiterHalter)]) {
      expect(antwort.status).toBe(409);
      expect((await json(antwort)).fehler.code).toBe("POOL_AENDERUNG_RUNDE_FEST");
    }
    // Wieder Entwurf: Zuordnung lösen und löschen gehen
    await db.update(s.finanzierungsrunde).set({ status: "entwurf" }).where(sql`id = ${RE}`);
    expect((await patch(aenderungPfad(poolId, a.id), { rundeId: null, basis: null }, bearbeiterHalter)).status).toBe(200);
    expect((await entferne(aenderungPfad(poolId, a.id), undefined, bearbeiterHalter)).status).toBe(204);
  });
});
