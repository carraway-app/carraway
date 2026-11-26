import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { asc, inArray } from "drizzle-orm";
import { benutzer, erstelleDb, fonds, pruefeSeedErlaubt } from "../src/index";
import { verlangeDatenbankUrl } from "../src/schutz";
import { DEMO_ZUGAENGE, demoSpracheAus, erzeugeDemodaten, schreibeDemoCrmNachZugaengen, schreibeDemoDachfonds, schreibeDemoPortfolio, schreibeDemoWaehrung, schreibeDemoZugaenge, schreibeDemodaten, zugangsdokument } from "../src/demo/index";

// Vor allem anderen: Im Echtbestand wird weder geschrieben noch gelöscht.
pruefeSeedErlaubt(process.env.CARRAWAY_UMGEBUNG);

// Der Seed leert die Datenbank: nie gegen eine angenommene Vorgabe.
const url = verlangeDatenbankUrl(["DATABASE_URL"], "Seed");
const sprache = demoSpracheAus(process.env.DEMO_SPRACHE);
const daten = erzeugeDemodaten({ seed: 1, sprache });
const { db, pool } = erstelleDb(url);
try {
  await schreibeDemodaten(db, daten);
  const fondsIds = (await db.select({ id: fonds.id }).from(fonds).orderBy(asc(fonds.vintage), asc(fonds.name))).map((f) => f.id);
  await schreibeDemoZugaenge(db, fondsIds, undefined, daten.organisationen.filter((o) => o.art === "investor").map((o) => o.id));
  // Gemeinsame Ansichten, Betreuung und Zuständigkeiten im CRM brauchen Benutzer: erst nach den Zugängen, Besitzerin ist die verwaltende Person.
  const intern = DEMO_ZUGAENGE.slice(0, 3);
  const personen = await db.select({ id: benutzer.id, email: benutzer.email }).from(benutzer).where(inArray(benutzer.email, intern.map((z) => z.email)));
  const nachEmail = new Map(personen.map((p) => [p.email, p.id]));
  const verwalterin = nachEmail.get(DEMO_ZUGAENGE.find((z) => z.globalVerwalter)!.email);
  if (verwalterin) await schreibeDemoCrmNachZugaengen(db, { besitzerId: verwalterin, betreuerIds: intern.flatMap((z) => nachEmail.get(z.email) ?? []), sprache });
  await schreibeDemoWaehrung(db, { sprache });
  await schreibeDemoPortfolio(db);
  // Dachfonds und Manager-Profil zuletzt: ein zusätzlicher Fonds, die übrigen Zahlen bleiben unverändert.
  await schreibeDemoDachfonds(db, { sprache });
} finally {
  await pool.end();
}
writeFileSync(fileURLToPath(new URL("../demo-zugaenge.md", import.meta.url)), zugangsdokument());
for (const [name, zeilen] of Object.entries(daten)) console.log(`${name.padEnd(20)} ${zeilen.length}`);
console.log("Demo-Zugänge: packages/db/demo-zugaenge.md (nur lokale Entwicklung)");
