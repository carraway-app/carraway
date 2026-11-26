import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, person } from "./hilfen-auth";
import { leeren, oeffneTestdb, vehikelVon } from "./hilfen";
import { aufrufe, grundbestand, ID, json } from "./hilfen-instrumente";

// Sichtbarkeit nach Fondsrechten: Optionsscheine, Ausübungen und Übertragungen eines Fonds, den die Person nicht sieht, erscheinen in Kapitaltabelle,
// Wasserfall und Übertragungsliste nur zusammengefasst, ohne Id, Name, Preis und Laufzeit; die Rechnung bleibt gleich. Beträge erfunden.
const { db, pool } = oeffneTestdb();
const { get, post } = aufrufe(erstelleTestApp(db));

const X = "00000000-0000-4000-8000-0000000000e1";
const ANDERE_BETEILIGUNG = "00000000-0000-4000-8000-0000000000b9";
const leser = person("leser-sicht", { rollen: { [ID.fonds]: "betrachter" } });
let optionsschein = "";
let ausuebung = "";
let uebertragung = "";
let weiterverkauf = "";
let klasseId = "";

beforeAll(async () => {
  await grundbestand(db);
  await db.insert(s.organisation).values({ id: X, name: "Investor X Beispiel", art: "investor" });
  const [runde] = await db
    .insert(s.finanzierungsrunde)
    .values({ organisationId: ID.orgA, bezeichnung: "Serie A", datum: "2026-03-01", preMoney: "7000000", postMoney: "10000000", preisJeAnteil: "12.5000", anteileGesamtNach: "800000" })
    .returning();
  const haupt = (await db.select().from(s.instrument).where(eq(s.instrument.beteiligungId, ID.eigen)))[0]!.id;
  await db.insert(s.rundenposition).values([
    { rundeId: runde!.id, vehikelId: await vehikelVon(db, X), betrag: "2000000.00", anteile: "160000", rolle: "lead" },
    { rundeId: runde!.id, fondsId: ID.fonds, betrag: "1000000.00", anteile: "80000", rolle: "co", instrumentId: haupt },
  ]);
  // Der andere Fonds hält Optionsscheine am selben Unternehmen, übt einen Teil aus und kauft Stammanteile.
  await db.insert(s.beteiligung).values({ id: ANDERE_BETEILIGUNG, fondsId: ID.anderer, organisationId: ID.orgA, instrument: "optionsschein", erstinvestment: "2026-01-15" });
  const os = await json(await post(`/beteiligungen/${ANDERE_BETEILIGUNG}/instrumente`, { art: "optionsschein", bezeichnung: "Geheime Optionsscheine", optionsscheinAnzahl: "20000", ausuebungspreis: "1.2345", ausgabeAm: "2026-01-15", laufzeitBis: "2031-01-14" }));
  optionsschein = os.id;
  ausuebung = (await json(await post(`/instrumente/${optionsschein}/exercises`, { date: "2026-05-01", shares: "5000" }))).exercise.id;
  uebertragung = (await json(await post(`/organisationen/${ID.orgA}/share-transfers`, { date: "2026-05-01", source: "stamm", buyerFundId: ID.anderer, shares: "10000", pricePerShare: "9.87" }))).id;
  // Zweite Optionsscheine auf Vorzugsanteile (mit Präferenz), ganz ausgeübt; der andere Fonds verkauft 4.000 seiner gekauften Anteile an Investor X weiter.
  const [k] = await db.insert(s.anteilsklasse).values({ organisationId: ID.orgA, name: "Vorzug", rang: 1, praeferenzFaktor: "1" }).returning();
  klasseId = k!.id;
  const os2 = await json(await post(`/beteiligungen/${ANDERE_BETEILIGUNG}/instrumente`, { art: "optionsschein", bezeichnung: "Geheime Vorzugsscheine", anteilsklasseId: klasseId, optionsscheinAnzahl: "3000", ausuebungspreis: "2.3456", ausgabeAm: "2026-01-15", laufzeitBis: "2031-01-14" }));
  await post(`/instrumente/${os2.id}/exercises`, { date: "2026-05-02", shares: "3000" });
  weiterverkauf = (await json(await post(`/organisationen/${ID.orgA}/share-transfers`, { date: "2026-06-01", source: `uebertragung:${uebertragung}`, buyerOrganizationId: X, shares: "4000", pricePerShare: "8.76" }))).id;
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const verraeterisch = (text: string) => [optionsschein, ausuebung, uebertragung, ANDERE_BETEILIGUNG, "Testfonds Zwei", "Geheime Optionsscheine", "1.2345", "2031-01-14", "9.87", "98700", "Geheime Vorzugsscheine", "2.3456", "7036.8", "8.76", "35040"].filter((x) => text.includes(x));

describe("Sichtbarkeit von Optionsscheinen und Übertragungen nach Fondsrechten", () => {
  it("Kapitaltabelle: ohne Recht am anderen Fonds nur Sammelzeilen, gleiche Summen", async () => {
    const voll = await json(await get(`/beteiligungen/${ID.eigen}/kapitaltabelle?stichtag=2026-07-01`));
    expect(voll.zeilen.some((z: { id: string }) => z.id === `optionsschein:${optionsschein}`)).toBe(true);
    const antwort = await get(`/beteiligungen/${ID.eigen}/kapitaltabelle?stichtag=2026-07-01`, leser);
    expect(antwort.status).toBe(200);
    const text = await antwort.clone().text();
    expect(verraeterisch(text)).toEqual([]);
    const d = await json(antwort);
    expect([d.anteileUnverwaessert, d.anteileVollVerwaessert]).toEqual([voll.anteileUnverwaessert, voll.anteileVollVerwaessert]);
    const zeile = (id: string) => d.zeilen.find((z: { id: string }) => z.id === id);
    expect(zeile("optionsschein:verdeckt")).toMatchObject({ anteile: "15000", halter: { art: "optionsschein", id: null, name: "" }, diesesFonds: false });
    expect(zeile("ausuebung:verdeckt:stamm")).toMatchObject({ anteile: "5000", investiert: "0.00", halter: { art: "fonds", id: null, name: "" } });
    expect(zeile("uebertragung:verdeckt:stamm:")).toMatchObject({ anteile: "6000", uebertragung: null, halter: { id: null } });
    expect(zeile(`ausuebung:verdeckt:${klasseId}`)).toMatchObject({ anteile: "3000", investiert: "0.00" });
    // Weiterverkauf an einen sichtbaren Käufer aus dem Bestand des verdeckten Fonds: Zeile bleibt, ohne Preis, Quelle und Rechenschritte.
    expect(zeile(`uebertragung:${weiterverkauf}`)).toMatchObject({ anteile: "4000", uebertragung: null, halter: { id: X } });
    expect(d.diesesFonds).toEqual(voll.diesesFonds);
  });

  it("Wasserfall: gleicher Rückfluss des Fonds, keine Angaben zum anderen Fonds", async () => {
    const eingabe = { exitwert: "41000000", exitdatum: "2026-07-01" };
    const voll = await json(await post(`/beteiligungen/${ID.eigen}/wasserfall`, eingabe));
    const antwort = await post(`/beteiligungen/${ID.eigen}/wasserfall`, eingabe, leser);
    expect(antwort.status).toBe(200);
    expect(verraeterisch(await antwort.clone().text())).toEqual([]);
    const w = await json(antwort);
    expect(w.fonds).toEqual(voll.fonds);
    const summe = (zeilen: { gesamt: string }[]) => zeilen.reduce((a, z) => a + Math.round(Number(z.gesamt) * 100), 0);
    expect(summe(w.zeilen)).toBe(summe(voll.zeilen));
    expect(w.zeilen.find((z: { id: string }) => z.id === "optionsschein:verdeckt")).toMatchObject({ anteile: "15000", optionsschein: null, multiple: null });
    // Verdeckte Ausübung mit Präferenz: weder Investition noch Anspruch oder Präferenz; Rechenweg nur als Hinweis
    expect(w.zeilen.find((z: { id: string }) => z.id === `ausuebung:verdeckt:${klasseId}`)).toMatchObject({ investiert: "0.00", anspruch: "0.00", praeferenz: "0.00" });
    expect(w.schritte).toHaveLength(1);
    // Gesamtgrößen, aus denen der verdeckte Wert folgte, entfallen
    expect([w.restNachPraeferenzen, w.preisJeAnteil, w.minderungsfaktor]).toEqual([null, null, null]);
    expect(voll.restNachPraeferenzen).not.toBeNull();
    expect(voll.preisJeAnteil).not.toBeNull();
    expect(voll.schritte.length).toBeGreaterThan(1);
    const klasse = (x: { klassen: { id: string | null; investiert: string }[] }) => x.klassen.find((k) => k.id === klasseId);
    expect(klasse(w)?.investiert).toBe("0.00");
    expect(klasse(voll)?.investiert).toBe("7036.80");
  });

  it("Wasserfall-Kurve: ohne Recht am anderen Fonds keine Knickpunkte, die Ausübungspreise verraten; Punkte gleich", async () => {
    const pfad = `/beteiligungen/${ID.eigen}/wasserfall/kurve?exitdatum=2026-07-01&bis=41000000`;
    const voll = await json(await get(pfad));
    // Mit allen Rechten entstehen Knickpunkte aus den offenen Optionsscheinen (Ausübungspreis als Schwelle).
    expect(voll.knicke.length).toBeGreaterThan(0);
    const antwort = await get(pfad, leser);
    expect(antwort.status).toBe(200);
    expect(verraeterisch(await antwort.clone().text())).toEqual([]);
    const d = await json(antwort);
    expect(d.knicke).toEqual([]);
    expect(d.punkte).toEqual(voll.punkte);
    expect([d.investiert, d.postMoney]).toEqual([voll.investiert, voll.postMoney]);
  });

  it("Übertragungsliste: Käufer ohne Namen, ohne Preis und Instrument", async () => {
    const antwort = await get(`/organisationen/${ID.orgA}/share-transfers`, leser);
    expect(antwort.status).toBe(200);
    // Die Id der Übertragung selbst bleibt (sie nennt keinen Fonds); alles andere zum Käuferfonds fehlt.
    // Die Ids der Übertragungen selbst bleiben (sie nennen keinen Fonds); alles andere zum anderen Fonds fehlt.
    expect(verraeterisch(await antwort.clone().text()).filter((x) => x !== uebertragung)).toEqual([]);
    const [u, weiter] = (await json(antwort)).data;
    expect(weiter).toMatchObject({ id: weiterverkauf, source: null, seller: { type: "fund", id: null }, buyer: { id: X }, purchasePrice: null, pricePerShare: null, saleId: null });
    expect(u).toMatchObject({ buyer: { type: "fund", id: null, name: "" }, seller: { type: "common" }, pricePerShare: null, purchasePrice: null, buyerInstrumentId: null, shares: "10000" });
    // Mit Recht am anderen Fonds alles sichtbar
    const voll = (await json(await get(`/organisationen/${ID.orgA}/share-transfers`))).data[0];
    expect(voll).toMatchObject({ buyer: { id: ID.anderer }, purchasePrice: "98700.00" });
  });
});
