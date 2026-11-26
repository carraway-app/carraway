import { asc, eq } from "drizzle-orm";
import { darlehenKondition, type zinsmethode, type zinsperiodenart } from "@carraway/db";
import { Fachfehler } from "../fehler";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { loeseDarlehensinstrument } from "./instrumente";
import { pruefeDatumsfenster } from "./stichtag";
import { sperreBeteiligung, verlangeDarlehensartig } from "./zustand";

export interface NeueKonditionEingabe {
  gueltigAb: string;
  satzFix: string;
  methode: (typeof zinsmethode.enumValues)[number];
  zinsperiode?: (typeof zinsperiodenart.enumValues)[number] | undefined;
  anker?: string | undefined;
  gewinnabhaengigSatz?: string | undefined;
  kappungSatz?: string | undefined;
  stundungBis?: string | undefined;
  kapitalisieren: boolean;
  faelligAm?: string | undefined;
  /** Das darlehensartige Instrument; ohne Angabe das einzige der Beteiligung (bei mehreren Pflicht). */
  instrumentId?: string | undefined;
}

/**
 * Neue Version der Konditionen eines Darlehens (Vertragsänderung = neue Zeile) mit allen Prüfungen: Darlehensart, Datumsfenster,
 * ein Datum nur einmal, Raster (Zinsperiode, Anker) bleibt über die Versionen gleich. Der Weg der Route `POST /beteiligungen/:id/konditionen`
 * und der Bestätigung einer KI-Auslesung.
 */
export async function legeKonditionAn(tx: Tx, protokoll: Protokollant, id: string, eingabe: NeueKonditionEingabe) {
  const b = await sperreBeteiligung(tx, id);
  const instrument = await loeseDarlehensinstrument(tx, b, eingabe.instrumentId);
  verlangeDarlehensartig(instrument.art);
  pruefeDatumsfenster("gueltigAb", eingabe.gueltigAb);
  pruefeDatumsfenster("anker", eingabe.anker ?? eingabe.gueltigAb);
  if (eingabe.faelligAm) pruefeDatumsfenster("faelligAm", eingabe.faelligAm);
  if (eingabe.stundungBis) pruefeDatumsfenster("stundungBis", eingabe.stundungBis);
  const vorhandene = await tx.select().from(darlehenKondition).where(eq(darlehenKondition.instrumentId, instrument.id)).orderBy(asc(darlehenKondition.gueltigAb));
  const erste = vorhandene[0];
  if (vorhandene.some((k) => k.gueltigAb === eingabe.gueltigAb)) {
    throw new Fachfehler(409, "KONDITION_VORHANDEN", "Für dieses Datum gibt es bereits Konditionen.");
  }
  const zinsperiode = eingabe.zinsperiode ?? erste?.zinsperiode;
  const anker = eingabe.anker ?? (zinsperiode === "endfaellig" ? eingabe.faelligAm : undefined) ?? erste?.anker;
  const fehlt = (feld: string, meldung: string) =>
    new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", { felder: [{ feld, code: "invalid_value", meldung }] });
  if (!zinsperiode) throw fehlt("zinsperiode", "Zinsperiode ist bei der ersten Version erforderlich");
  if (!anker) throw fehlt("anker", "Anker (bei endfällig auch faelligAm) ist bei der ersten Version erforderlich");
  if (erste && zinsperiode !== erste.zinsperiode) {
    throw new Fachfehler(409, "KONDITION_RASTER_UNGLEICH", "Die Zinsperiode darf sich in späteren Versionen nicht ändern.", { zinsperiode: erste.zinsperiode });
  }
  if (erste && zinsperiode !== "endfaellig" && anker !== erste.anker) {
    throw new Fachfehler(409, "KONDITION_RASTER_UNGLEICH", "Der Anker darf sich in späteren Versionen nur bei endfälliger Verzinsung ändern.", { anker: erste.anker });
  }
  const [zeile] = await tx
    .insert(darlehenKondition)
    .values({
      beteiligungId: id,
      instrumentId: instrument.id,
      gueltigAb: eingabe.gueltigAb,
      satzFix: eingabe.satzFix,
      methode: eingabe.methode,
      zinsperiode,
      anker,
      gewinnabhaengigSatz: eingabe.gewinnabhaengigSatz ?? null,
      kappungSatz: eingabe.kappungSatz ?? null,
      stundungBis: eingabe.stundungBis ?? null,
      kapitalisieren: eingabe.kapitalisieren,
      faelligAm: eingabe.faelligAm ?? null,
    })
    .returning();
  if (!zeile) throw new Error("Konditionen nicht angelegt");
  await protokoll("anlegen", "darlehen_kondition", zeile.id, null, zeile);
  return zeile;
}
