import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { DateiSpeicher } from "../berichte/speicher";
import { json, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, legePersonAn, person, type Testperson, type TestApp } from "./hilfen-auth";
import { ID, grundbestand } from "./hilfen-instrumente";
import { vorgaengeEinfuegen } from "./instrument-hilfen";

/**
 * Zusammenspiel der Meldeberichte (Etappe 15) mit Buchhaltung und Mittelherkunft (Etappe 14): das Änderungsprotokoll der Meldetabellen nach
 * Fondsrechten (auch gelöschte Zeilen) und die Aufteilung der Beträge nach den Quoten der Mittelarten je Zeitraum gegen unabhängige SQL.
 */

const { db, pool } = oeffneTestdb();
let verzeichnis = "";
let t: TestApp;
const F1 = ID.fonds;
const F2 = ID.anderer;
const admin = person("mz-admin", { globalVerwalter: true });
const verwalterF1 = person("mz-verwalter-f1", { rollen: { [F1]: "verwalter" } });
const bearbeiterF1 = person("mz-bearbeiter-f1", { rollen: { [F1]: "bearbeiter" } });
const verwalterF2 = person("mz-verwalter-f2", { rollen: { [F2]: "verwalter" } });
const anfrage = (methode: string, pfad: string, als: Testperson, body?: unknown) =>
  t.request(pfad, { method: methode, als, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

beforeAll(async () => {
  verzeichnis = await mkdtemp(join(tmpdir(), "carraway-melde-zs-"));
  t = erstelleTestApp(db, { speicher: new DateiSpeicher(verzeichnis) });
  await grundbestand(db);
  for (const p of [admin, verwalterF1, bearbeiterF1, verwalterF2]) await legePersonAn(db, p);
});
afterAll(async () => {
  await db.execute(sql`DELETE FROM foerderprogramm WHERE schluessel LIKE 'test\_%'`);
  await pool.end();
  await rm(verzeichnis, { recursive: true, force: true });
});

describe("Änderungsprotokoll der Meldeberichte nach Fondsrechten", () => {
  it("ein Benutzer des Fonds B sieht keine Änderungen an Lauf, Wert, Aktivierung und Schlüsseln des Fonds A, auch keine gelöschten Zeilen", async () => {
    const SCHLUESSEL = "foerderbericht_quartal";
    expect((await anfrage("POST", "/foerderprogramme", admin, { schluessel: "test_zs", bezeichnung: "Programm Zusammenspiel" })).status).toBe(201);
    const aktivieren = (aktiv: boolean) => anfrage("PUT", `/fonds/${F1}/meldedefinitionen/${SCHLUESSEL}`, verwalterF1, { aktiv });
    expect((await aktivieren(true)).status).toBe(200);
    expect((await aktivieren(false)).status).toBe(200); // Löschzeile der Aktivierung
    expect((await aktivieren(true)).status).toBe(200);
    // Schlüssel der Beteiligung: Anlegen und Ändern
    const pfad = `/beteiligungen/${ID.darlehen}/buchhaltungsschluessel`;
    expect((await anfrage("PUT", pfad, bearbeiterF1, { foerderprogramm: "test_zs", projektnummer: "P-1" })).status).toBe(200);
    expect((await anfrage("PUT", pfad, bearbeiterF1, { foerderprogramm: null, projektnummer: "P-2" })).status).toBe(200);
    expect((await anfrage("PUT", `/organisationen/${ID.orgB}/meldedaten`, bearbeiterF1, { sitzland: "DE", region: null })).status).toBe(200);
    const lauf = await anfrage("POST", "/meldelaeufe", bearbeiterF1, { fondsId: F1, definition: SCHLUESSEL, jahr: 2026, nummer: 3 });
    expect(lauf.status, await lauf.clone().text()).toBe(201);
    const laufJson = await json(lauf);
    expect((await anfrage("PUT", `/meldelaeufe/${laufJson.id}/eingaben`, bearbeiterF1, { schluessel: "stammdaten.verantwortlich", wert: "Erika Beispiel" })).status).toBe(200);

    const lies = async (als: Testperson, tabelle?: string) =>
      (await json(await anfrage("GET", `/aenderungen?limit=1000${tabelle ? `&tabelle=${tabelle}` : ""}`, als))).daten as { aktion: string; tabelle: string; datensatzId: string; fondsId: string | null }[];
    const MIT_FONDS = ["melde_aktivierung", "melde_lauf", "melde_wert", "beteiligung_buchhaltung"];
    for (const tabelle of MIT_FONDS) {
      const eigene = await lies(verwalterF1, tabelle);
      expect(eigene.length, `${tabelle} für Fonds A`).toBeGreaterThan(0);
      expect(eigene.every((z) => z.fondsId === F1), `${tabelle} trägt den Fonds`).toBe(true);
      expect(await lies(verwalterF2, tabelle), `${tabelle} für Fonds B`).toEqual([]);
    }
    expect((await lies(verwalterF1, "melde_aktivierung")).map((z) => z.aktion)).toContain("deaktivieren");
    expect((await lies(verwalterF1, "melde_lauf")).map((z) => z.datensatzId)).toContain(laufJson.id);
    // ohne Tabellenfilter: keine Zeile dieser Tabellen für Fonds B
    expect((await lies(verwalterF2)).filter((z) => MIT_FONDS.includes(z.tabelle))).toEqual([]);
    // Stammdaten ohne Fonds (Programm, Meldedaten der Organisation) sehen alle mit einer Rolle
    expect((await lies(verwalterF2, "foerderprogramm")).length).toBeGreaterThan(0);
    expect((await lies(verwalterF2, "organisation_meldedaten")).length).toBeGreaterThan(0);
  });
});

describe("Mittelherkunft: Beträge nach den Quoten je Zeitraum, gegen unabhängige SQL", () => {
  const SCHLUESSEL = "efre_indikatoren";
  const ALT = new Date("2000-01-01T00:00:00Z");

  /** Auszahlungen, einer davon storniert (der Storno fällt später, die Quoten wechseln dazwischen). */
  async function aufsetzen() {
    await grundbestand(db);
    await db.execute(sql`UPDATE beteiligung SET erstellt_am = '2000-01-01T00:00:00Z'`);
    for (const p of [admin]) await legePersonAn(db, p);
    // Bis Ende Juni 55/35/10 (die letzte Mittelart ohne Meldeart), ab Juli 50/50
    await db.insert(s.fondsMittelart).values([
      { fondsId: F1, schluessel: "foerderung", bezeichnungDe: "Förderung", bezeichnungEn: "Funding", quote: "0.550000", meldeArt: "foerdermittel", gueltigAb: "2026-01-01", gueltigBis: "2026-06-30" },
      { fondsId: F1, schluessel: "kofi", bezeichnungDe: "Kofinanzierung", bezeichnungEn: "Co-financing", quote: "0.350000", meldeArt: "kofinanzierung", gueltigAb: "2026-01-01", gueltigBis: "2026-06-30" },
      { fondsId: F1, schluessel: "sonst", bezeichnungDe: "Sonstige", bezeichnungEn: "Other", quote: "0.100000", meldeArt: null, gueltigAb: "2026-01-01", gueltigBis: "2026-06-30" },
      { fondsId: F1, schluessel: "foerderung", bezeichnungDe: "Förderung", bezeichnungEn: "Funding", quote: "0.500000", meldeArt: "foerdermittel", gueltigAb: "2026-07-01" },
      { fondsId: F1, schluessel: "kofi", bezeichnungDe: "Kofinanzierung", bezeichnungEn: "Co-financing", quote: "0.500000", meldeArt: "kofinanzierung", gueltigAb: "2026-07-01" },
    ]);
    const [storniert] = await vorgaengeEinfuegen(db, { beteiligungId: ID.eigen, art: "auszahlung", valuta: "2026-06-30", betrag: "333.33", erfasstAm: ALT });
    await vorgaengeEinfuegen(db, [
      { beteiligungId: ID.eigen, art: "auszahlung", valuta: "2026-01-02", betrag: "1000.00", erfasstAm: ALT },
      { beteiligungId: ID.eigen, art: "auszahlung", valuta: "2026-05-20", betrag: "777.77", erfasstAm: ALT },
      { beteiligungId: ID.darlehen, art: "auszahlung", valuta: "2026-07-01", betrag: "333.33", erfasstAm: ALT },
      { beteiligungId: ID.darlehen, art: "auszahlung", valuta: "2026-09-15", betrag: "99.99", erfasstAm: ALT },
      { beteiligungId: ID.eigen, art: "auszahlung", valuta: "2026-09-03", betrag: "-333.33", storniertVorgangId: storniert!.id, erfasstAm: ALT },
    ]);
    expect((await anfrage("PUT", `/fonds/${F1}/meldedefinitionen/${SCHLUESSEL}`, admin, { aktiv: true })).status).toBe(200);
  }

  /**
   * Unabhängige Rechnung in SQL: Betrag mal Quote der Mittelart, die am Valuta des Originals gilt (ein Storno folgt seinem Original), ohne Rundung.
   * Die API teilt auf den Cent genau auf (größter Rest); je Betrag weicht sie höchstens um einen Cent ab.
   */
  const sqlAnteil = async (bedingung: string): Promise<number> =>
    Number(
      (
        await db.execute(
          sql.raw(`SELECT coalesce(sum(v.betrag * m.quote), 0)::text AS s
            FROM vorgang v JOIN beteiligung b ON b.id = v.beteiligung_id
            JOIN vorgang o ON o.id = coalesce(v.storniert_vorgang_id, v.id)
            JOIN fonds_mittelart m ON m.fonds_id = b.fonds_id AND o.valuta >= m.gueltig_ab AND (m.gueltig_bis IS NULL OR o.valuta <= m.gueltig_bis)
            WHERE v.art = 'auszahlung' AND b.fonds_id = '${F1}' AND v.valuta BETWEEN '2026-01-01' AND '2026-12-31' AND ${bedingung}`),
        )
      ).rows[0]?.s,
    );
  const sqlGesamt = async (): Promise<number> =>
    Number((await db.execute(sql.raw(`SELECT coalesce(sum(v.betrag), 0)::text AS s FROM vorgang v JOIN beteiligung b ON b.id = v.beteiligung_id WHERE v.art = 'auszahlung' AND b.fonds_id = '${F1}' AND v.valuta BETWEEN '2026-01-01' AND '2026-12-31'`))).rows[0]?.s);

  it("Fördermittel und Kofinanzierung folgen den Quoten ihres Valuta; ein Storno folgt seinem Original; der Rest ohne Meldeart zählt nirgends", async () => {
    await aufsetzen();
    const l = await json(await anfrage("POST", "/meldelaeufe", admin, { fondsId: F1, definition: SCHLUESSEL, jahr: 2026 }));
    const wert = (schluessel: string) => Number(l.werte.find((w: { schluessel: string }) => w.schluessel === schluessel)?.wert);
    const foerder = wert("finanzinstrument.foerdermittel_periode");
    const kofi = wert("finanzinstrument.kofinanzierung_periode");
    const erwartetFoerder = await sqlAnteil("m.melde_art = 'foerdermittel'");
    const erwartetKofi = await sqlAnteil("m.melde_art = 'kofinanzierung'");
    const erwartetSonst = await sqlAnteil("m.melde_art IS NULL");
    // Handrechnung: 1000 · 0,55 + 777,77 · 0,55 + (333,33 − 333,33) · 0,55 + 333,33 · 0,5 + 99,99 · 0,5 = 550 + 427,7735 + 0 + 166,665 + 49,995
    expect(erwartetFoerder).toBeCloseTo(1194.4335, 4);
    // je Betrag höchstens ein Cent Abweichung (vier Beträge ohne Storno-Paar, das Paar hebt sich auf)
    expect(Math.abs(foerder - erwartetFoerder)).toBeLessThanOrEqual(0.04);
    expect(Math.abs(kofi - erwartetKofi)).toBeLessThanOrEqual(0.04);
    // Alles zusammen ergibt den Betrag der Auszahlungen: Fördermittel + Kofinanzierung + Rest ohne Meldeart
    const gesamt = await sqlGesamt();
    expect(erwartetFoerder + erwartetKofi + erwartetSonst).toBeCloseTo(gesamt, 6);
    expect(foerder + kofi).toBeLessThanOrEqual(gesamt + 0.01);
    expect(gesamt - foerder - kofi).toBeCloseTo(erwartetSonst, 1);
  });

  it("Anteile ergeben je Betrag genau den Betrag, auch wenn die Quoten krumme Cent erzeugen (333,33 bei 55/35/10)", async () => {
    // Aufteilung auf den Cent: 333,33 · 0,55 = 183,3315; · 0,35 = 116,6655; · 0,10 = 33,333; größter Rest: 183,33 + 116,67 + 33,33 = 333,33
    const { ladeMittelherkunft } = await import("../melde/quellen");
    const herkunft = await ladeMittelherkunft(db, F1, "2026-09-30");
    const anteile = herkunft.anteile("2026-06-30", "333.33");
    expect(anteile).toEqual({ foerdermittel: "183.33", kofinanzierung: "116.67" });
    expect(Number(anteile!.foerdermittel) + Number(anteile!.kofinanzierung) + 33.33).toBeCloseTo(333.33, 6);
    expect(herkunft.anteile("2026-07-01", "333.33")).toEqual({ foerdermittel: "166.67", kofinanzierung: "166.66" });
    expect(herkunft.quoten).toEqual({ foerdermittel: "0.5", kofinanzierung: "0.5" });
    // ohne Mittelarten am Datum keine Anteile
    expect(herkunft.anteile("2025-12-31", "100.00")).toBeUndefined();
  });
});
