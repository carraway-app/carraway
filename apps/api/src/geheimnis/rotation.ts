import { sql } from "drizzle-orm";
import type { Db } from "@carraway/db";
import type { Schluesselring } from "./krypto";
import { verifierAad, zugangAad } from "../postfach/zugang";
import { geheimnisAad } from "../webhooks/zustellung";

/**
 * Schlüsselwechsel: verschlüsselt alle ruhenden Geheimnisse mit dem aktuellen Schlüssel des Rings neu (Ablauf in `krypto.ts`). Werte, die schon mit
 * dem aktuellen Schlüssel verschlüsselt sind, bleiben unberührt; Werte, die sich nicht mehr entschlüsseln lassen (Schlüssel fehlt), werden gezählt
 * und nie überschrieben. Läuft auch parallel zum Betrieb: jede Zeile wird einzeln und nur dann geschrieben, wenn sie sich seit dem Lesen nicht geändert hat.
 */

export interface RotationsErgebnis {
  neuVerschluesselt: number;
  schonAktuell: number;
  unlesbar: number;
}

interface Ziel {
  tabelle: string;
  spalte: string;
  aad: (id: string) => string;
}

const ZIELE: Ziel[] = [
  { tabelle: "postfach_verbindung", spalte: "zugang_verschluesselt", aad: zugangAad },
  { tabelle: "mail_auftrag", spalte: "inhalt_verschluesselt", aad: (id) => `mail_auftrag:${id}` },
  { tabelle: "oauth_zustand", spalte: "verifier_verschluesselt", aad: verifierAad },
  { tabelle: "webhook", spalte: "geheimnis_verschluesselt", aad: geheimnisAad },
];

export async function rotiereGeheimnisse(db: Db, ring: Schluesselring): Promise<RotationsErgebnis> {
  const ergebnis: RotationsErgebnis = { neuVerschluesselt: 0, schonAktuell: 0, unlesbar: 0 };
  for (const z of ZIELE) {
    const tabelle = sql.identifier(z.tabelle);
    const spalte = sql.identifier(z.spalte);
    const { rows } = await db.execute<{ id: string; wert: string }>(sql`SELECT id, ${spalte} AS wert FROM ${tabelle} WHERE ${spalte} IS NOT NULL`);
    for (const r of rows) {
      if (!ring.brauchtRotation(r.wert)) {
        ergebnis.schonAktuell++;
        continue;
      }
      let neu: string;
      try {
        neu = ring.verschluessele(ring.entschluessele(r.wert, z.aad(r.id)), z.aad(r.id));
      } catch {
        ergebnis.unlesbar++;
        continue;
      }
      const aktualisiert = await db.execute(sql`UPDATE ${tabelle} SET ${spalte} = ${neu} WHERE id = ${r.id} AND ${spalte} = ${r.wert}`);
      if ((aktualisiert.rowCount ?? 0) > 0) ergebnis.neuVerschluesselt++;
    }
  }
  return ergebnis;
}
