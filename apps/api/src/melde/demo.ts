import { and, asc, eq, sql } from "drizzle-orm";
import { letzterAbgeschlossenerZeitraum } from "@carraway/berichte";
import { demoTexte, type DemoSprache } from "@carraway/db/demo";
import { beteiligung, beteiligungBuchhaltung, foerderprogramm, fonds, meldeAktivierung, meldeLauf, organisation, organisationMeldedaten, type Db } from "@carraway/db";
import { schreibe } from "../schreiben";
import { befundeAus, ladeWerte, schnappschussVon } from "./lauf";
import { legeLaufAn } from "./anlegen";

/**
 * Demo-Läufe der Meldungen: Förderprogramme (sind schon aus `pnpm db:seed` da, hier nur zur Sicherheit), Förder- und Buchhaltungsschlüssel für die Beteiligungen, die noch keine haben
 * (die Buchhaltung der Demo hat sie für die ersten fünf je Fonds), und Sitzland (alles erfunden) für die Demo-Beteiligungen, der Förderbericht je Quartal für
 * jeden Fonds aktiviert und für das letzte abgeschlossene Quartal vor dem Demo-Stichtag als Entwurf gerechnet. Der Lauf kommt aus dem echten Rechenweg
 * (`legeLaufAn`), nicht aus handgeschriebenen Zeilen. Wiederholtes Aufrufen ändert nichts (vorhandene Läufe bleiben).
 */

export const DEMO_AKTEUR = "system:demo";
export const DEMO_DEFINITION = "foerderbericht_quartal";
const PROGRAMME = [
  { schluessel: "demo_wachstum", bezeichnung: "Beispielprogramm Wachstum" },
  { schluessel: "demo_innovation", bezeichnung: "Beispielprogramm Innovation" },
];
const LAENDER = [
  { sitzland: "DE", region: "Bayern" },
  { sitzland: "DE", region: "Berlin" },
  { sitzland: "DE", region: "Nordrhein-Westfalen" },
  { sitzland: "AT", region: "Wien" },
];

export async function erzeugeDemoMeldelaeufe(db: Db, demoStichtag: string, sprache: DemoSprache = "de"): Promise<{ laeufe: number }> {
  const texte = demoTexte(sprache);
  await db.insert(foerderprogramm).values(PROGRAMME.map((p) => ({ ...p, erstelltVon: DEMO_AKTEUR }))).onConflictDoNothing();
  const programme = await db.select().from(foerderprogramm).where(sql`${foerderprogramm.schluessel} IN ('demo_wachstum', 'demo_innovation')`);
  const alleFonds = await db.select({ id: fonds.id }).from(fonds).orderBy(asc(fonds.vintage), asc(fonds.name));
  const zeitraum = letzterAbgeschlossenerZeitraum("quartal", demoStichtag);
  let laeufe = 0;

  for (const [i, f] of alleFonds.entries()) {
    const bs = await db.select({ id: beteiligung.id, organisationId: beteiligung.organisationId }).from(beteiligung).innerJoin(organisation, eq(organisation.id, beteiligung.organisationId)).where(eq(beteiligung.fondsId, f.id)).orderBy(asc(organisation.name), asc(beteiligung.id));
    for (const [j, b] of bs.entries()) {
      // zwei von drei Beteiligungen gehören zu einem Programm, die übrigen bleiben ohne Zuordnung
      const programm = j % 3 === 2 ? null : (programme[(i + j) % programme.length] ?? null);
      await db
        .insert(beteiligungBuchhaltung)
        .values({
          beteiligungId: b.id,
          foerderprogrammId: programm?.id ?? null,
          projektnummer: programm ? `DEMO-${String(i + 1).padStart(2, "0")}-${String(j + 1).padStart(3, "0")}` : null,
          geaendertVon: DEMO_AKTEUR,
        })
        .onConflictDoNothing();
      const land = LAENDER[(i + j) % LAENDER.length]!;
      await db.insert(organisationMeldedaten).values({ organisationId: b.organisationId, sitzland: land.sitzland, region: land.region, geaendertVon: DEMO_AKTEUR }).onConflictDoNothing();
    }
    await db.insert(meldeAktivierung).values({ fondsId: f.id, schluessel: DEMO_DEFINITION, foerderprogrammId: null, aktiviertVon: DEMO_AKTEUR }).onConflictDoNothing();
    const [vorhanden] = await db.select({ id: meldeLauf.id }).from(meldeLauf).where(and(eq(meldeLauf.fondsId, f.id), eq(meldeLauf.definitionSchluessel, DEMO_DEFINITION), eq(meldeLauf.periodeKennung, zeitraum.kennung))).limit(1);
    if (vorhanden) continue;
    const [fondsZeile] = await db.select({ vintage: fonds.vintage }).from(fonds).where(eq(fonds.id, f.id));
    // Fonds, die erst nach dem Zeitraum beginnen, haben nichts zu melden
    if ((fondsZeile?.vintage ?? 0) > Number(zeitraum.ende.slice(0, 4))) continue;
    await schreibe(db, DEMO_AKTEUR, async (tx, protokoll) => {
      const lauf = await legeLaufAn(tx, protokoll, { fondsId: f.id, definition: DEMO_DEFINITION, jahr: Number(zeitraum.kennung.slice(0, 4)), nummer: Number(zeitraum.kennung.slice(-1)), sprache });
      // Ein Kommentar zur ersten offenen Warnung, in der Sprache der Demo (Freitext, wird nicht übersetzt).
      const warnung = befundeAus(schnappschussVon(lauf).inhalt, await ladeWerte(tx, lauf.id), lauf.befundKommentare).find((b) => b.schwere === "warnung");
      if (warnung) {
        const kommentar = { text: texte.meldelauf.kommentar, von: DEMO_AKTEUR, am: new Date().toISOString() };
        await tx.update(meldeLauf).set({ befundKommentare: { [warnung.regelId]: kommentar } }).where(eq(meldeLauf.id, lauf.id));
      }
    });
    laeufe++;
  }
  return { laeufe };
}
