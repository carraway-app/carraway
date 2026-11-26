import { sql } from "drizzle-orm";
import * as s from "@carraway/db";
import { person, type Testperson, type TestApp } from "./hilfen-auth";
import { json, leeren } from "./hilfen";
import { legeHauptinstrumentAn } from "../instrumente/hauptinstrument";
import { vorgaengeEinfuegen } from "./instrument-hilfen";

/** Gemeinsame Bausteine der Etappe-4-Tests: Grundbestand, Aufrufe mit angemeldeter Person, Zähler. Alle Daten sind erfunden. */

export const ID = {
  fonds: "00000000-0000-4000-8000-0000000000f1",
  anderer: "00000000-0000-4000-8000-0000000000f2",
  orgA: "00000000-0000-4000-8000-00000000000a",
  orgB: "00000000-0000-4000-8000-00000000000b",
  orgC: "00000000-0000-4000-8000-00000000000c",
  eigen: "00000000-0000-4000-8000-0000000000b1",
  darlehen: "00000000-0000-4000-8000-0000000000b2",
  wandel: "00000000-0000-4000-8000-0000000000b3",
  darlehen2: "00000000-0000-4000-8000-0000000000b4",
};

type Db = ReturnType<typeof s.erstelleDb>["db"];

/** Wer handelt: eine Testperson oder ein Kürzel (`"a"`, `"b"`), das eine eigene Person mit Verwaltung aller Fonds ergibt. */
export type Akteurin = Testperson | string;
const alsPerson = (als: Akteurin): Testperson => (typeof als === "string" ? person(als, { globalVerwalter: true }) : als);

export function aufrufe(app: TestApp) {
  const senden = (methode: string) => async (pfad: string, koerper?: unknown, als?: Akteurin) =>
    app.request(pfad, {
      method: methode,
      headers: { "content-type": "application/json" },
      body: koerper === undefined ? undefined : JSON.stringify(koerper),
      ...(als ? { als: alsPerson(als) } : {}),
    });
  return { get: async (pfad: string, als?: Akteurin) => app.request(pfad, als ? { als: alsPerson(als) } : {}), post: senden("POST"), put: senden("PUT"), patch: senden("PATCH"), delete: senden("DELETE") };
}

export async function grundbestand(db: Db) {
  await leeren(db);
  await db.insert(s.organisation).values([
    { id: ID.orgA, name: "Alpha Beispiel", art: "unternehmen", sektor: "Software" },
    { id: ID.orgB, name: "Beta Beispiel", art: "unternehmen", sektor: "Energie" },
    { id: ID.orgC, name: "Gamma Beispiel", art: "unternehmen", sektor: "Medizin" },
  ]);
  await db.insert(s.fonds).values([
    { id: ID.fonds, name: "Testfonds Eins", kurzname: "TF1", vintage: 2024, zeichnungskapital: "10000000.00" },
    { id: ID.anderer, name: "Testfonds Zwei", kurzname: "TF2", vintage: 2024, zeichnungskapital: "10000000.00" },
  ]);
  const beteiligungen = await db
    .insert(s.beteiligung)
    .values([
      { id: ID.eigen, fondsId: ID.fonds, organisationId: ID.orgA, instrument: "offene_beteiligung", erstinvestment: "2025-01-01" },
      { id: ID.darlehen, fondsId: ID.fonds, organisationId: ID.orgB, instrument: "darlehen", erstinvestment: "2025-01-01" },
      { id: ID.wandel, fondsId: ID.fonds, organisationId: ID.orgC, instrument: "wandeldarlehen", erstinvestment: "2025-01-01" },
    ])
    .returning();
  // Wie in der Anwendung hat jede Beteiligung von Anfang an ihr Instrument (Zinsen und Wandlung lesen es, nicht die Spiegelspalte der Beteiligung).
  for (const b of beteiligungen) await legeHauptinstrumentAn(db, b);
  await db.execute(sql`DELETE FROM snapshot_auftrag`);
}

/** Zusage und Auszahlung direkt in der Datenbank (ohne Aufruf der API), `erfasstAm` bleibt der aktuelle Zeitpunkt. */
export async function vorgaengeAnlegen(db: Db, zeilen: Omit<typeof s.vorgang.$inferInsert, "instrumentId">[]) {
  await vorgaengeEinfuegen(db, zeilen);
}

export const anzahl = async (db: Db, tabelle: string, bedingung = "true") =>
  Number((await db.execute(sql.raw(`SELECT count(*)::int AS n FROM "${tabelle}" WHERE ${bedingung}`))).rows[0]?.n);

export const protokollZeilen = async (db: Db, tabelle: string, aktion?: string) =>
  (
    await db.execute(
      sql`SELECT akteur, akteur_name, aktion, tabelle, datensatz_id, vorher, nachher FROM aenderung WHERE tabelle = ${tabelle} ${aktion ? sql`AND aktion = ${aktion}` : sql``} ORDER BY am, id`,
    )
  ).rows as { akteur: string; akteur_name: string | null; aktion: string; tabelle: string; datensatz_id: string; vorher: unknown; nachher: unknown }[];

export const auftraege = async (db: Db) => anzahl(db, "snapshot_auftrag");
export const leereAuftraege = (db: Db) => db.execute(sql`DELETE FROM snapshot_auftrag`);

export { json };
