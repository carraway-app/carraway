import { and, desc, eq, sql } from "drizzle-orm";
import { ladeDefinition, meldeZeitraum, werteAus, type Rhythmus } from "@carraway/berichte";
import { foerderprogramm, fonds, meldeAktivierung, meldeDefinition, meldeLauf, meldeWert, type MeldeLauf } from "@carraway/db";
import { ladeFreigabestufen } from "../berichte/vorlagen";
import { Fachfehler } from "../fehler";
import { geltendeVersion } from "../routen/meldewesen";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { ladeWerte } from "./lauf";
import { ladeAuswertungsEingabe } from "./quellen";

/** Eingabe zum Anlegen eines Laufs (HTTP und Demo teilen sich diesen Weg). */
export interface NeuerLaufEingabe {
  fondsId: string;
  definition: string;
  version?: number | undefined;
  jahr?: number | undefined;
  nummer?: number | undefined;
  stichtag?: string | undefined;
  sprache: "de" | "en";
  stand?: string | undefined;
}

/** Wissensstand „jetzt“, eine Millisekunde aufgerundet (Zeitstempel der Datenbank haben Mikrosekunden). */
const jetzt = () => new Date(Date.now() + 1);

const fehlerhaft = (feld: string, code: string, meldung: string) => new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", { felder: [{ feld, code, meldung }] });

async function versionOderNull(tx: Tx, schluessel: string, version: number) {
  const [d] = await tx.select().from(meldeDefinition).where(and(eq(meldeDefinition.schluessel, schluessel), eq(meldeDefinition.version, version)));
  return d ?? null;
}

/**
 * Legt einen Meldelauf an und rechnet ihn: Definition (die Version, die am Ende des Zeitraums gilt), Fonds, Zeitraum, Wissensstand. Die Definition muss für den
 * Fonds aktiviert sein. Gibt es für Fonds, Definition und Zeitraum schon einen Lauf, ist der neue die nächste Fassung; Eingaben von Hand der letzten Fassung werden übernommen.
 */
export async function legeLaufAn(tx: Tx, protokoll: Protokollant, e: NeuerLaufEingabe): Promise<MeldeLauf> {
  const [f] = await tx.select().from(fonds).where(eq(fonds.id, e.fondsId));
  if (!f) throw new Fachfehler(404, "FONDS_NICHT_GEFUNDEN", "Fonds nicht gefunden.");
  const [aktiv] = await tx.select().from(meldeAktivierung).where(and(eq(meldeAktivierung.fondsId, e.fondsId), eq(meldeAktivierung.schluessel, e.definition)));
  if (!aktiv) throw new Fachfehler(409, "MELDEDEFINITION_NICHT_AKTIVIERT", "Die Meldedefinition ist für diesen Fonds nicht aktiviert.", { schluessel: e.definition });

  // Rhythmus kennt die Definition; der Zeitraum hängt von ihm ab. Die Version wird zum Ende des Zeitraums bestimmt, deshalb zuerst eine Version des Schlüssels lesen.
  const { rows: rhythmusZeile } = await tx.execute<{ rhythmus: Rhythmus }>(sql`SELECT rhythmus FROM melde_definition WHERE schluessel = ${e.definition} ORDER BY version DESC LIMIT 1`);
  const rhythmus = rhythmusZeile[0]?.rhythmus;
  if (!rhythmus) throw new Fachfehler(404, "MELDEDEFINITION_NICHT_GEFUNDEN", "Meldedefinition nicht gefunden.", { schluessel: e.definition });
  const periode = meldeZeitraum(rhythmus, { jahr: e.jahr, nummer: e.nummer, stichtag: e.stichtag });
  if (!periode) throw new Fachfehler(400, "MELDEZEITRAUM_UNGUELTIG", "Der Zeitraum passt nicht zum Rhythmus der Definition.", { rhythmus });

  const gewaehlt = e.version ? await versionOderNull(tx, e.definition, e.version) : await geltendeVersion(tx, e.definition, periode.ende);
  if (!gewaehlt) throw new Fachfehler(409, "MELDEDEFINITION_NICHT_GUELTIG", "Für diesen Zeitraum gibt es keine gültige Version der Definition.", { schluessel: e.definition, ende: periode.ende });
  if (gewaehlt.format === "xml") throw new Fachfehler(409, "MELDEFORMAT_NICHT_UNTERSTUETZT", "Für das Format xml gibt es noch keine Erzeugung.", { format: "xml" });
  const inhalt = ladeDefinition(gewaehlt.definition);

  const standVorgabe = e.stand ? new Date(e.stand) : null;
  if (standVorgabe && standVorgabe.getTime() > Date.now()) throw fehlerhaft("stand", "stand_in_zukunft", "Der Wissensstand darf nicht in der Zukunft liegen");
  const stand = standVorgabe ?? jetzt();

  const [programm] = aktiv.foerderprogrammId ? await tx.select().from(foerderprogramm).where(eq(foerderprogramm.id, aktiv.foerderprogrammId)) : [];

  const vorherige = await tx
    .select()
    .from(meldeLauf)
    .where(and(eq(meldeLauf.fondsId, e.fondsId), eq(meldeLauf.definitionSchluessel, e.definition), eq(meldeLauf.periodeKennung, periode.kennung)))
    .orderBy(desc(meldeLauf.fassung))
    .limit(1);
  const vorgaenger = vorherige[0] ?? null;
  const manuell: Record<string, string | null> = {};
  // Übernommene Eingaben behalten ihren Urheber (Vier-Augen: wer sie eingegeben hat, darf auch die neue Fassung nicht freigeben).
  const urheber = new Map<string, string | null>();
  if (vorgaenger) {
    for (const w of await ladeWerte(tx, vorgaenger.id)) {
      if (!w.manuell) continue;
      manuell[w.schluessel] = w.wert;
      urheber.set(w.schluessel, w.geaendertVon);
    }
  }

  const eingabe = await ladeAuswertungsEingabe(tx, { fondsId: e.fondsId, programm: programm ? { id: programm.id, schluessel: programm.schluessel, bezeichnung: programm.bezeichnung } : null, definition: inhalt, periode, stand: stand.toISOString(), manuell });
  const ergebnis = werteAus(eingabe);
  const stufen = await ladeFreigabestufen(tx, e.fondsId);

  const [lauf] = await tx
    .insert(meldeLauf)
    .values({
      fondsId: e.fondsId,
      foerderprogrammId: programm?.id ?? null,
      definitionId: gewaehlt.id,
      definitionSchluessel: gewaehlt.schluessel,
      definitionVersion: gewaehlt.version,
      definition: { meta: { schluessel: gewaehlt.schluessel, version: gewaehlt.version, bezeichnungDe: gewaehlt.bezeichnungDe, bezeichnungEn: gewaehlt.bezeichnungEn, herausgeber: gewaehlt.herausgeber, rhythmus: gewaehlt.rhythmus, format: gewaehlt.format }, inhalt },
      format: gewaehlt.format,
      sprache: e.sprache,
      periodeArt: gewaehlt.rhythmus,
      periodeKennung: periode.kennung,
      periodeBeginn: periode.beginn,
      periodeEnde: periode.ende,
      fassung: (vorgaenger?.fassung ?? 0) + 1,
      vorgaengerId: vorgaenger?.id ?? null,
      standVorgabe,
      stand,
      freigabestufen: stufen,
      erstelltVon: protokoll.akteur,
    })
    .returning();
  for (let i = 0; i < ergebnis.werte.length; i += 500) {
    await tx.insert(meldeWert).values(
      ergebnis.werte.slice(i, i + 500).map((w) => ({
        laufId: lauf!.id,
        schluessel: w.schluessel,
        art: w.art,
        reihenfolge: w.reihenfolge,
        wert: w.wert,
        herkunft: w.herkunft,
        manuell: w.manuell,
        geaendertVon: w.manuell && w.wert !== null ? (urheber.get(w.schluessel) ?? protokoll.akteur) : null,
      })),
    );
  }
  // `fondsId` im Stand ordnet die Zeile im Änderungsprotokoll dem Fonds zu.
  const { definition: _d, ...stand_ } = lauf!;
  await protokoll("anlegen", "melde_lauf", lauf!.id, null, { ...stand_, fondsId: e.fondsId, werte: ergebnis.werte.length });
  return lauf!;
}
