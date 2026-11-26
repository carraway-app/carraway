import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import type { Speicher } from "../berichte/speicher";
import { belegnummern } from "../buchhaltung/belegnummern";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { buchhaltungAufsetzen, mittelartenAufsetzen } from "./hilfen-buchhaltung";
import { aufrufe, grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";
import { erstelleTestApp, legePersonAn, person, type Testperson } from "./hilfen-auth";

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

const erst = person("n1-erst", { rollen: { [F1]: "freigeber" } });
const pruefer = person("n1-pruefer", { rollen: { [F1]: "freigeber" } });
const freigeber = person("n1-freigeber", { rollen: { [F1]: "freigeber" } });
const bearbeiter = person("n1-bearbeiter", { rollen: { [F1]: "bearbeiter" } });
const betrachter = person("n1-betrachter", { rollen: { [F1]: "betrachter" } });

const anfrage = (methode: string, pfad: string, als: Testperson, body?: unknown) =>
  t.request(pfad, { method: methode, als, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const stufe = (id: string, name: string, als: Testperson) => anfrage("POST", `/belege/${id}/stufe`, als, { stufe: name, ergebnis: "ok" });
const storno = (id: string, als: Testperson, grund: string | null = "Betrag war falsch erfasst") => anfrage("POST", `/belege/${id}/storno`, als, grund === null ? {} : { grund });

async function auszahlungAnlegen(): Promise<string> {
  await post(`/beteiligungen/${ID.darlehen}/vorgaenge`, { art: "zusage", valuta: "2026-01-01", betrag: "200000" });
  const antwort = await post(`/beteiligungen/${ID.darlehen}/vorgaenge`, { art: "auszahlung", valuta: "2026-03-31", betrag: "100000" });
  expect(antwort.status).toBe(201);
  return (await json(antwort)).vorgang.id;
}
const belegAnlegen = async (bezugId: string, als: Testperson = erst) => {
  const antwort = await anfrage("POST", "/belege", als, { sprache: "de", art: "auszahlung", bezugArt: "vorgang", bezugId });
  return { antwort, beleg: await json(antwort) };
};
/** Legt einen Beleg an und gibt ihn mit zwei Stufen frei. */
async function freigegebenerBeleg(bezugId: string) {
  const { beleg } = await belegAnlegen(bezugId);
  expect((await stufe(beleg.id, "Prüfung", pruefer)).status).toBe(200);
  const frei = await json(await stufe(beleg.id, "Freigabe", freigeber));
  expect(frei.status).toBe("freigegeben");
  return frei;
}

beforeEach(async () => {
  await grundbestand(db);
  await buchhaltungAufsetzen(db, F1);
  await mittelartenAufsetzen(db, F1);
  for (const p of [erst, pruefer, freigeber, bearbeiter, betrachter]) await legePersonAn(db, p);
  speicher.dateien.clear();
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Beleg stornieren", () => {
  it("nur Freigeber, mit Grund, nur ein freigegebener Beleg; Nummer, Datei und Protokoll bleiben", async () => {
    const vorgangId = await auszahlungAnlegen();
    const { beleg: entwurf } = await belegAnlegen(vorgangId);
    // Ein Entwurf wird nicht storniert, sondern neu befüllt oder zurückgegeben.
    expect(await json(await storno(entwurf.id, freigeber))).toMatchObject({ fehler: { code: "BELEG_NICHT_FREIGEGEBEN" } });
    await stufe(entwurf.id, "Prüfung", pruefer);
    const frei = await json(await stufe(entwurf.id, "Freigabe", freigeber));
    expect(frei).toMatchObject({ status: "freigegeben", belegnummer: "B-000001" });

    expect((await storno(frei.id, bearbeiter)).status).toBe(403);
    expect((await storno(frei.id, betrachter)).status).toBe(403);
    expect((await storno(frei.id, freigeber, "")).status).toBe(400);
    expect((await storno(frei.id, freigeber, null)).status).toBe(400);

    const antwort = await storno(frei.id, freigeber, "Betrag war falsch erfasst");
    expect(antwort.status).toBe(200);
    const nachher = await json(antwort);
    expect(nachher).toMatchObject({ status: "storniert", belegnummer: "B-000001", stornoGrund: "Betrag war falsch erfasst", dateiSha256: frei.dateiSha256 });
    expect(nachher.stornoVon).toBeTruthy();
    expect(nachher.stornoAm).toBeTruthy();
    expect((await protokollZeilen(db, "beleg", "stornieren")).map((z) => z.akteur)).toEqual([nachher.stornoVon]);

    // Die unveränderliche Datei bleibt abrufbar (gleicher Hash), das Detail zeigt Status und Grund.
    const datei = await anfrage("GET", `/belege/${frei.id}/datei`, betrachter);
    expect(datei.status).toBe(200);
    expect(datei.headers.get("x-datei-sha256")).toBe(frei.dateiSha256);
    expect(await json(await anfrage("GET", `/belege/${frei.id}`, betrachter))).toMatchObject({ status: "storniert", stornoGrund: "Betrag war falsch erfasst", belegnummer: "B-000001", naechsteStufeName: null });

    // Ein stornierter Beleg ändert sich nicht mehr: weder über die API noch in der Datenbank.
    expect(await json(await storno(frei.id, freigeber))).toMatchObject({ fehler: { code: "BELEG_STORNIERT" } });
    expect(await json(await anfrage("POST", `/belege/${frei.id}/neu-befuellen`, bearbeiter))).toMatchObject({ fehler: { code: "BELEG_STORNIERT" } });
    expect(await json(await stufe(frei.id, "Prüfung", pruefer))).toMatchObject({ fehler: { code: "BELEG_STORNIERT" } });
    await expect(db.update(s.beleg).set({ stornoGrund: "anders" }).where(eq(s.beleg.id, frei.id))).rejects.toThrow();
    await expect(db.delete(s.beleg).where(eq(s.beleg.id, frei.id))).rejects.toThrow();
  });

  it("die Datenbank erlaubt am freigegebenen Beleg nur die Stornierung, keine andere Änderung", async () => {
    const vorgangId = await auszahlungAnlegen();
    const frei = await freigegebenerBeleg(vorgangId);
    await expect(db.update(s.beleg).set({ sprache: "en" }).where(eq(s.beleg.id, frei.id))).rejects.toThrow();
    // Storno mit gleichzeitiger anderer Änderung ist abgelehnt.
    await expect(db.update(s.beleg).set({ status: "storniert", stornoAm: new Date(), stornoVon: "x", stornoGrund: "g", sprache: "en" }).where(eq(s.beleg.id, frei.id))).rejects.toThrow();
    // Ein Entwurf lässt sich nicht stornieren (Check: nur freigegebene haben eine Nummer).
    const vorgang2 = await auszahlungAnlegen();
    const { beleg: entwurf } = await belegAnlegen(vorgang2);
    await expect(db.update(s.beleg).set({ status: "storniert", stornoAm: new Date(), stornoVon: "x", stornoGrund: "g" }).where(eq(s.beleg.id, entwurf.id))).rejects.toThrow();
    expect((await db.select().from(s.beleg).where(eq(s.beleg.id, frei.id)))[0]!.status).toBe("freigegeben");
  });

  it("für denselben Vorfall darf danach ein neuer Beleg entstehen; die Nummer des stornierten bleibt vergeben, die Folge ist lückenlos", async () => {
    const vorgangId = await auszahlungAnlegen();
    const erster = await freigegebenerBeleg(vorgangId);
    expect(erster.belegnummer).toBe("B-000001");
    // Solange der Beleg gilt, gibt es für den Vorfall keinen zweiten.
    const doppelt = await belegAnlegen(vorgangId, bearbeiter);
    expect(doppelt.antwort.status).toBe(409);
    expect(doppelt.beleg.fehler.code).toBe("BELEG_VORHANDEN");
    expect((await storno(erster.id, freigeber)).status).toBe(200);

    const neu = await belegAnlegen(vorgangId);
    expect(neu.antwort.status).toBe(201);
    expect(neu.beleg).toMatchObject({ status: "entwurf", belegnummer: null });
    await stufe(neu.beleg.id, "Prüfung", pruefer);
    const zweiter = await json(await stufe(neu.beleg.id, "Freigabe", freigeber));
    expect(zweiter.belegnummer).toBe("B-000002");

    // Auch der neue ist nun der einzige gültige; ein dritter wird abgelehnt.
    expect((await belegAnlegen(vorgangId)).beleg.fehler.code).toBe("BELEG_VORHANDEN");
    // Die Liste zeigt beide mit Status.
    const liste = (await json(await anfrage("GET", `/belege?fondsId=${F1}`, betrachter))).daten as { belegnummer: string; status: string; stornoGrund: string | null }[];
    expect(liste.map((z) => [z.belegnummer, z.status]).sort()).toEqual([["B-000001", "storniert"], ["B-000002", "freigegeben"]]);
    expect(liste.find((z) => z.status === "storniert")!.stornoGrund).toBe("Betrag war falsch erfasst");
    expect((await json(await anfrage("GET", `/belege?fondsId=${F1}&status=storniert`, betrachter))).daten).toHaveLength(1);

    // Die Datenbank erlaubt je Vorfall höchstens einen nicht stornierten Beleg.
    const [kopie] = await db.select().from(s.beleg).where(eq(s.beleg.id, zweiter.id));
    const { id: _id, belegnummer: _n, belegnummerLfd: _l, freigegebenAm: _f, status: _s, ...rest } = kopie!;
    await expect(db.insert(s.beleg).values({ ...rest, status: "entwurf" })).rejects.toThrow();
  });

  it("Exporte und Journal sehen nur die Nummer des gültigen Belegs", async () => {
    const vorgangId = await auszahlungAnlegen();
    const erster = await freigegebenerBeleg(vorgangId);
    expect([...(await db.transaction((tx) => belegnummern(tx, F1, [vorgangId]))).values()]).toEqual(["B-000001"]);
    await storno(erster.id, freigeber);
    expect((await db.transaction((tx) => belegnummern(tx, F1, [vorgangId]))).size).toBe(0);
    const { beleg } = await belegAnlegen(vorgangId);
    await stufe(beleg.id, "Prüfung", pruefer);
    await stufe(beleg.id, "Freigabe", freigeber);
    expect([...(await db.transaction((tx) => belegnummern(tx, F1, [vorgangId]))).values()]).toEqual(["B-000002"]);
  });
});
