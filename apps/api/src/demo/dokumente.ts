import { asc, eq } from "drizzle-orm";
import { beteiligung, dokument, organisation, type Db } from "@carraway/db";
import type { Speicher } from "../berichte/speicher";
import { bereiteVor, legeDokumentAn, type Klassifikation } from "../dokumente/speichern";
import { schreibe } from "../schreiben";
import { beteiligungsvertragSeiten, bewertungsnachweisSeiten, erzeugeDemoPdf, registerauszugSeiten, wandeldarlehenSeiten } from "./vertraege";

/**
 * Demo-Dokumente: Beteiligungsvertrag, Wandeldarlehensvertrag, Bewertungsnachweis und ein Registerauszug (erfunden, mit Typst gesetzt), verknüpft mit Demo-Unternehmen,
 * damit sich der Weg der Auslesung mit dem regelbasierten Anbieter (`KI_ANBIETER=lokal`) zeigen lässt. Läuft nach `pnpm db:seed`
 * (`pnpm --filter @carraway/api demo:dokumente`); doppelte Läufe legen nichts doppelt an (gleicher SHA-256).
 */
export async function legeDemoDokumenteAn(db: Db, speicher: Speicher): Promise<{ angelegt: string[]; vorhanden: string[] }> {
  const zeilen = await db
    .select({ id: beteiligung.id, instrument: beteiligung.instrument, organisationId: beteiligung.organisationId, name: organisation.name })
    .from(beteiligung)
    .innerJoin(organisation, eq(organisation.id, beteiligung.organisationId))
    .orderBy(asc(organisation.name), asc(beteiligung.id));
  const wahl = (art: string[], ausser: string[] = []) => zeilen.find((z) => art.includes(z.instrument) && !ausser.includes(z.id)) ?? zeilen.find((z) => !ausser.includes(z.id));
  const runde = wahl(["offene_beteiligung"]);
  const darlehen = wahl(["wandeldarlehen", "darlehen"], runde ? [runde.id] : []);
  const bewertung = wahl(["offene_beteiligung", "stille_beteiligung"], [runde?.id, darlehen?.id].filter((x): x is string => !!x));
  const vorhaben: { titel: string; datei: string; klasse: Klassifikation; ziel: typeof runde; zielTyp?: "beteiligung" | "organisation"; pdf: Uint8Array }[] = [];
  if (runde) vorhaben.push({ titel: "Beteiligungsvertrag", datei: "beteiligungsvertrag-serie-a.pdf", klasse: "vertrag", ziel: runde, pdf: erzeugeDemoPdf(beteiligungsvertragSeiten(), "Beteiligungsvertrag") });
  if (darlehen) vorhaben.push({ titel: "Wandeldarlehensvertrag", datei: "wandeldarlehensvertrag.pdf", klasse: "vertrag", ziel: darlehen, pdf: erzeugeDemoPdf(wandeldarlehenSeiten(), "Wandeldarlehensvertrag") });
  if (bewertung) vorhaben.push({ titel: "Bewertungsnachweis", datei: "bewertungsnachweis.pdf", klasse: "bewertung", ziel: bewertung, pdf: erzeugeDemoPdf(bewertungsnachweisSeiten(), "Bewertungsnachweis") });

  // Der Registerauszug hängt am Unternehmen selbst (Ziel Organisation), damit sich daraus ein Registereintrag mit Quelle Dokument anlegen lässt.
  const auszugOrg = zeilen[0];
  if (auszugOrg) vorhaben.push({ titel: "Registerauszug", datei: "registerauszug.pdf", klasse: "sonstiges", ziel: { ...auszugOrg, id: auszugOrg.organisationId }, zielTyp: "organisation", pdf: erzeugeDemoPdf(registerauszugSeiten(`${auszugOrg.name} GmbH`, "Beispielstadt"), "Registerauszug") });

  const angelegt: string[] = [];
  const vorhanden: string[] = [];
  for (const v of vorhaben) {
    const vorbereitet = await bereiteVor(speicher, v.pdf, v.datei);
    const doppelt = await db.select({ id: dokument.id }).from(dokument).where(eq(dokument.sha256, vorbereitet.hash));
    if (doppelt.length > 0) {
      vorhanden.push(v.datei);
      continue;
    }
    await schreibe(db, "system", (tx, protokoll) =>
      legeDokumentAn(tx, protokoll, { id: "system", name: "Demo" }, vorbereitet, { klassifikation: v.klasse, vertraulich: false, ziele: [{ typ: v.zielTyp ?? "beteiligung", id: v.ziel!.id }] }),
    );
    angelegt.push(`${v.datei} → ${v.ziel!.name}`);
  }
  return { angelegt, vorhanden };
}
