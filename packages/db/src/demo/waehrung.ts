import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../index";
import * as s from "../schema";
import type { DemoSprache } from "./texte";

/**
 * Demo-Daten für Etappe 21 (alles erfunden): Zwei Beteiligungen des ersten Fonds haben eine lokale Währung (USD und GBP), dazu gibt es wöchentliche Kurse
 * für EUR/USD und EUR/GBP mit erfundenen Verläufen, und die Portfolio-Objekte tragen eigene Felder. Die Beträge in Fondswährung bleiben unverändert (lokale Werte werden
 * aus den Kursen abgeleitet), damit die übrigen Demo-Zahlen gleich bleiben. Eigener Aufruf nach den Zugängen (`schreibeDemoWaehrung`), nicht Teil von `schreibeDemodaten`.
 */

const wochenKurse = (von: string, bis: string) => {
  const aus: { datum: string; basis: string; quote: string; kurs: string }[] = [];
  let tag = Date.parse(`${von}T00:00:00Z`);
  const ende = Date.parse(`${bis}T00:00:00Z`);
  for (let woche = 0; tag <= ende; woche++, tag += 7 * 86_400_000) {
    const datum = new Date(tag).toISOString().slice(0, 10);
    aus.push({ datum, basis: "EUR", quote: "USD", kurs: (1.1 + 0.08 * Math.sin(woche / 20)).toFixed(4) });
    aus.push({ datum, basis: "EUR", quote: "GBP", kurs: (0.86 + 0.03 * Math.cos(woche / 15)).toFixed(4) });
  }
  return aus;
};

const FELDER = (de: boolean) =>
  [
    { objekt: "fonds", schluessel: "strategie", name: de ? "Strategie" : "Strategy", typ: "text", optionen: {} },
    { objekt: "fonds", schluessel: "risikoklasse", name: de ? "Risikoklasse" : "Risk class", typ: "auswahl", optionen: { optionen: [{ schluessel: "niedrig", label: de ? "Niedrig" : "Low", farbe: "blau" }, { schluessel: "mittel", label: de ? "Mittel" : "Medium", farbe: "sand" }, { schluessel: "hoch", label: de ? "Hoch" : "High", farbe: "rose" }] } },
    { objekt: "runde", schluessel: "lead_investor", name: de ? "Lead-Investor" : "Lead investor", typ: "text", optionen: {} },
    { objekt: "beteiligung", schluessel: "board_sitz", name: de ? "Beiratssitz" : "Board seat", typ: "kontrollkaestchen", optionen: {} },
    { objekt: "instrument", schluessel: "sicherheit", name: de ? "Sicherheit" : "Collateral", typ: "text", optionen: {} },
    { objekt: "vorgang", schluessel: "projektnummer", name: de ? "Projektnummer" : "Project number", typ: "text", optionen: {} },
  ] as const;

export async function schreibeDemoWaehrung(db: Db, optionen: { sprache?: DemoSprache } = {}): Promise<{ kurse: number; beteiligungen: number }> {
  const de = (optionen.sprache ?? "de") === "de";
  const [erster] = await db.select().from(s.fonds).orderBy(asc(s.fonds.vintage), asc(s.fonds.name)).limit(1);
  if (!erster) return { kurse: 0, beteiligungen: 0 };
  const kurse = wochenKurse("2019-01-07", "2026-12-28");
  await db.transaction(async (tx) => {
    for (let i = 0; i < kurse.length; i += 1000) await tx.insert(s.wechselkurs).values(kurse.slice(i, i + 1000).map((k) => ({ ...k, quelle: "manuell" as const, erfasstVon: "demo" })));
    const defs = await tx.insert(s.feldDefinition).values(FELDER(de).map((f, i) => ({ ...f, optionen: f.optionen as Record<string, unknown>, position: i }))).returning();
    const id = (obj: string, key: string) => defs.find((d) => d.objekt === obj && d.schluessel === key)!.id;
    await tx.update(s.fonds).set({ felder: { [id("fonds", "strategie")]: de ? "Frühphase, Software und Energie" : "Early stage, software and energy", [id("fonds", "risikoklasse")]: "hoch" } }).where(eq(s.fonds.id, erster.id));
    const aktive = await tx
      .select()
      .from(s.beteiligung)
      .where(and(eq(s.beteiligung.fondsId, erster.id), eq(s.beteiligung.status, "aktiv"), eq(s.beteiligung.instrument, "offene_beteiligung")))
      .orderBy(asc(s.beteiligung.erstinvestment), asc(s.beteiligung.id))
      .limit(2);
    for (const [i, b] of aktive.entries()) {
      await tx.update(s.beteiligung).set({ waehrung: i === 0 ? "USD" : "GBP", felder: { [id("beteiligung", "board_sitz")]: i === 0 } }).where(eq(s.beteiligung.id, b.id));
    }
    const [runde] = await tx.execute<{ id: string }>(sql`SELECT id FROM finanzierungsrunde ORDER BY datum LIMIT 1`).then((r) => r.rows);
    if (runde) await tx.update(s.finanzierungsrunde).set({ felder: { [id("runde", "lead_investor")]: de ? "Beispiel Ventures" : "Example Ventures" } }).where(eq(s.finanzierungsrunde.id, runde.id));
  });
  return { kurse: kurse.length, beteiligungen: 2 };
}
