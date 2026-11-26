import { erstelleDb, pruefeSeedErlaubt } from "@carraway/db";
import { demoSpracheAus, STICHTAG_HEUTE } from "@carraway/db/demo";
import { verlangeDatenbankUrl } from "@carraway/db/schutz";
import { erzeugeDemoMeldelaeufe } from "./demo";

// Wie `pnpm db:seed`: im Echtbestand wird nichts geschrieben.
pruefeSeedErlaubt(process.env.CARRAWAY_UMGEBUNG);

const url = verlangeDatenbankUrl(["DATABASE_URL"], "seed:melde");
const { db, pool } = erstelleDb(url);
try {
  const { laeufe } = await erzeugeDemoMeldelaeufe(db, STICHTAG_HEUTE, demoSpracheAus(process.env.DEMO_SPRACHE));
  console.log(`Demo-Meldeläufe angelegt: ${laeufe}`);
} finally {
  await pool.end();
}
