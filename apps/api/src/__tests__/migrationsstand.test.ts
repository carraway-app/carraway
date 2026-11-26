import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { erstelleLogger } from "../beobachtung/protokoll";
import { verlangeMigrationsstandBeimStart } from "../migrationsstand";
import { oeffneTestdb } from "./hilfen";

const { db, pool } = oeffneTestdb();
const arbeit = mkdtempSync(join(tmpdir(), "carraway-migrationsstand-"));
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await pool.end();
  rmSync(arbeit, { recursive: true, force: true });
});

const logger = () => {
  const zeilen: Record<string, unknown>[] = [];
  return { zeilen, logger: erstelleLogger("api", { ausgabe: (z) => zeilen.push(JSON.parse(z)) }) };
};
const beenden = () => {
  const aufrufe: number[] = [];
  return {
    aufrufe,
    beenden: ((code: number) => {
      aufrufe.push(code);
      return undefined as never;
    }) as (code: number) => never,
  };
};

describe("Migrationsstand beim Start", () => {
  it("startet, wenn die Datenbank genau die bekannten Migrationen hat", async () => {
    const l = logger();
    const b = beenden();
    await verlangeMigrationsstandBeimStart(db, "api", l.logger, b.beenden);
    expect(b.aufrufe).toEqual([]);
    expect(l.zeilen).toEqual([]);
  });

  it("beendet sich mit klarer Zeile, wenn die Datenbank Migrationen hat, die der Code nicht kennt", async () => {
    const leer = join(arbeit, "leer");
    mkdirSync(join(leer, "meta"), { recursive: true });
    writeFileSync(join(leer, "meta", "_journal.json"), JSON.stringify({ version: "7", dialect: "postgresql", entries: [] }));
    vi.stubEnv("MIGRATIONEN_VERZEICHNIS", leer);
    const l = logger();
    const b = beenden();
    await verlangeMigrationsstandBeimStart(db, "worker", l.logger, b.beenden);
    expect(b.aufrufe).toEqual([1]);
    expect(l.zeilen).toHaveLength(1);
    expect(l.zeilen[0]).toMatchObject({ stufe: "error", meldung: "worker startet nicht: Migrationsstand passt nicht zum Code" });
    expect(String(l.zeilen[0]!.grund)).toMatch(/die der Code nicht kennt/);
  });
});
