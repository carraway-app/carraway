import { beteiligung, bewertung } from "@carraway/db";
import { definitionSchema, STANDARD_MELDEDEFINITIONEN } from "@carraway/berichte";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { erstelleTestApp } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { aufrufe, grundbestand, ID, json } from "./hilfen-instrumente";
import { ladeAuswertungsEingabe } from "../melde/quellen";
import { ladeBeteiligungSicht, ladeFondsSicht } from "../waehrung/sicht";

/**
 * Wirksamer Beteiligungsstatus in Meldewesen und Währungssicht (Issue 122; ESG in ee/api): Stichtag und Wissensstand der Auswertung entscheiden, nicht
 * die Statusspalte von heute. Alle Daten sind erfunden.
 */

const { db, pool } = oeffneTestdb();
const { post } = aufrufe(erstelleTestApp(db));
const b = ID.eigen;
const verkaufen = (koerper: object) => post(`/beteiligungen/${b}/verkauf`, koerper, "bearbeiter");
const pause = () => new Promise((r) => setTimeout(r, 15));
const jetzt = async () => {
  await pause();
  const t = new Date().toISOString();
  await pause();
  return t;
};

const definition = definitionSchema.parse(STANDARD_MELDEDEFINITIONEN[0]!.definition);
const melde = async (ende: string, stand?: string) => {
  const e = await db.transaction((tx) =>
    ladeAuswertungsEingabe(tx, { fondsId: ID.fonds, programm: null, definition, periode: { beginn: "2024-01-01", ende, kennung: "test" } as never, stand: stand ?? new Date().toISOString(), manuell: {} }),
  );
  return e.beteiligungen.find((x) => x.id === b)!;
};
const sicht = async (stichtag: string, stand?: string) => (await db.transaction((tx) => ladeBeteiligungSicht(tx, b, { stichtag, stand })))!;
const fondssicht = async (stichtag: string, stand?: string) => (await db.transaction((tx) => ladeFondsSicht(tx, ID.fonds, { stichtag, stand }))).zeilen.find((z) => z.beteiligungId === b)!;

beforeEach(async () => {
  await grundbestand(db);
  await db.update(beteiligung).set({ erstinvestment: "2024-01-01" });
  await post(`/beteiligungen/${b}/vorgaenge`, { art: "zusage", valuta: "2024-01-01", betrag: "1000000" });
  await post(`/beteiligungen/${b}/vorgaenge`, { art: "auszahlung", valuta: "2024-02-01", betrag: "500000" });
  await db.insert(bewertung).values({ beteiligungId: b, stichtag: "2024-12-31", wert: "450000.00", methode: "letzte_runde", status: "freigegeben" as const });
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Ausstieg durch Vollverkauf zum 30.06.2025", () => {
  beforeEach(async () => {
    expect((await verkaufen({ datum: "2025-06-30", kaufpreis: "700000", anteilVerkauft: 1 })).status).toBe(201);
  });

  it("Meldewesen: vor dem Ausstieg aktiv, ab dem Ausstieg ausgeschieden", async () => {
    expect(await melde("2024-12-31")).toMatchObject({ status: "aktiv", ausgeschieden: false });
    expect(await melde("2025-06-29")).toMatchObject({ status: "aktiv", ausgeschieden: false });
    expect(await melde("2025-06-30")).toMatchObject({ status: "exit", ausgeschieden: true });
    expect(await melde("2025-12-31")).toMatchObject({ status: "exit", ausgeschieden: true });
  });

  it("Währungssicht: Zeitwert vor dem Ausstieg mit der Bewertung, danach null (Beteiligung und Fonds)", async () => {
    expect((await sicht("2024-12-31")).kennzahlen.bewertung!.fonds).toBe("450000.00");
    expect((await sicht("2025-06-29")).kennzahlen.bewertung!.fonds).toBe("450000.00");
    expect((await sicht("2025-12-31")).kennzahlen.bewertung!.fonds).toBe("0.00");
    expect((await fondssicht("2025-06-29")).bewertung!.fonds).toBe("450000.00");
    expect((await fondssicht("2025-12-31")).bewertung!.fonds).toBe("0.00");
  });
});

describe("Rückwirkend erfasster Verkauf (Wissensstand)", () => {
  let davor = "";
  let danach = "";
  beforeEach(async () => {
    davor = await jetzt();
    expect((await verkaufen({ datum: "2025-06-30", kaufpreis: "700000", anteilVerkauft: 1 })).status).toBe(201);
    danach = await jetzt();
  });

  it("Meldewesen: mit dem damaligen Wissensstand aktiv, mit dem aktuellen ausgeschieden", async () => {
    expect(await melde("2025-12-31", davor)).toMatchObject({ status: "aktiv", ausgeschieden: false });
    expect(await melde("2025-12-31", danach)).toMatchObject({ status: "exit", ausgeschieden: true });
  });
  it("Währungssicht: Zeitwert mit dem damaligen Wissensstand mit Bewertung, mit dem aktuellen null", async () => {
    expect((await sicht("2025-12-31", davor)).kennzahlen.bewertung!.fonds).toBe("450000.00");
    expect((await sicht("2025-12-31", danach)).kennzahlen.bewertung!.fonds).toBe("0.00");
  });
});

describe("Stornierter Verkauf", () => {
  let vorStorno = "";
  let nachStorno = "";
  beforeEach(async () => {
    const d = await json(await verkaufen({ datum: "2025-06-30", kaufpreis: "700000", anteilVerkauft: 1 }));
    vorStorno = await jetzt();
    expect((await post(`/verkaeufe/${d.verkauf.id}/storno`, { grund: "Kaufvertrag nicht vollzogen" }, "bearbeiter")).status).toBe(201);
    nachStorno = await jetzt();
  });

  it("Meldewesen: damals ausgeschieden, mit dem Wissen nach dem Storno und heute aktiv", async () => {
    expect(await melde("2025-12-31", vorStorno)).toMatchObject({ status: "exit", ausgeschieden: true });
    expect(await melde("2025-12-31", nachStorno)).toMatchObject({ status: "aktiv", ausgeschieden: false });
    expect(await melde("2025-12-31")).toMatchObject({ status: "aktiv", ausgeschieden: false });
  });
  it("Währungssicht: damals Zeitwert null, danach mit Bewertung", async () => {
    expect((await sicht("2025-12-31", vorStorno)).kennzahlen.bewertung!.fonds).toBe("0.00");
    expect((await sicht("2025-12-31", nachStorno)).kennzahlen.bewertung!.fonds).toBe("450000.00");
    expect((await sicht("2025-12-31")).kennzahlen.bewertung!.fonds).toBe("450000.00");
  });
});

describe("Teilverkauf", () => {
  beforeEach(async () => {
    expect((await verkaufen({ datum: "2025-06-30", kaufpreis: "300000", anteilVerkauft: 0.4 })).status).toBe(201);
    expect((await verkaufen({ datum: "2026-06-30", kaufpreis: "400000", anteilVerkauft: 1 })).status).toBe(201);
  });

  it("Meldewesen: die Restposition bleibt im Bestand, bis der Vollverkauf wirksam ist", async () => {
    expect(await melde("2025-12-31")).toMatchObject({ status: "aktiv", ausgeschieden: false });
    expect(await melde("2026-12-31")).toMatchObject({ status: "exit", ausgeschieden: true });
  });
});

describe("Vollverkauf ohne Rückfluss (Kaufpreis null)", () => {
  beforeEach(async () => {
    expect((await verkaufen({ datum: "2025-06-30", kaufpreis: "0", anteilVerkauft: 1 })).status).toBe(201);
  });

  it("Währungssicht: ab dem Verkaufsdatum Zeitwert null, davor mit Bewertung", async () => {
    expect((await sicht("2025-06-29")).kennzahlen.bewertung!.fonds).toBe("450000.00");
    expect((await sicht("2025-12-31")).kennzahlen.bewertung!.fonds).toBe("0.00");
  });
});
