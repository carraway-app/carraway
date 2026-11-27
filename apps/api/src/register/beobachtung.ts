import { Fachfehler } from "../fehler";
import { asc, eq, sql } from "drizzle-orm";
import { registerBeobachtung } from "@carraway/db";
import type { Db } from "@carraway/db";
import type { MailKontext } from "../mail/auftraege";
import { schreibe } from "../schreiben";
import { lese } from "../zeitlimit";
import type { RegisterAnbieter } from "./anbieter";
import { aktuellerEintrag, legeEintragAn, legeEreignisAn, meldeEintrag, meldeEreignis } from "./dienst";

/**
 * Beobachtung: Der Worker fragt den konfigurierten Anbieter für beobachtete Unternehmen ab, legt neue Registerstände und Ereignisse an und
 * erzeugt Meldungen. Je Lauf höchstens `max` Unternehmen (Begrenzung der Abrufe, Vorgabe 20) mit Pause dazwischen. Ohne Anbieter oder
 * ohne Plan (`REGISTER_PRUEFUNG_CRON`) läuft nichts: Die Beobachtung ist standardmäßig aus.
 */

export const REGISTER_PRUEFUNG = "register-pruefung";

export interface PruefErgebnis {
  geprueft: number;
  neueEintraege: number;
  neueEreignisse: number;
  fehler: number;
}

const warte = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

export async function pruefeBeobachtung(db: Db, anbieter: RegisterAnbieter | { name: string; refresh: (companyId: string) => Promise<{ status: string; entries: number; events: number }> }, optionen: { max?: number; pauseMs?: number; mail?: MailKontext } = {}): Promise<PruefErgebnis> {
  const max = optionen.max ?? 20;
  const quelle = `anbieter:${anbieter.name}`;
  const ziele = await lese(db, async (tx) =>
    tx
      .select({ organisationId: registerBeobachtung.organisationId })
      .from(registerBeobachtung)
      .where(eq(registerBeobachtung.aktiv, true))
      .orderBy(sql`${registerBeobachtung.letztePruefungAm} ASC NULLS FIRST`, asc(registerBeobachtung.organisationId))
      .limit(max),
  );
  const ergebnis: PruefErgebnis = { geprueft: 0, neueEintraege: 0, neueEreignisse: 0, fehler: 0 };
  for (const [i, ziel] of ziele.entries()) {
    if (i > 0) await warte(optionen.pauseMs ?? 0);
    if ("refresh" in anbieter) {
      let status: string;
      try {
        const updated = await anbieter.refresh(ziel.organisationId);
        ergebnis.neueEintraege += updated.entries;
        ergebnis.neueEreignisse += updated.events;
        status = updated.status;
      } catch (error) {
        status = error instanceof Fachfehler ? error.code : "provider_unavailable";
        ergebnis.fehler++;
      }
      await db.update(registerBeobachtung).set({ letztePruefungAm: new Date(), letztesErgebnis: status }).where(eq(registerBeobachtung.organisationId, ziel.organisationId));
      ergebnis.geprueft++;
      continue;
    }
    const referenz = await lese(db, async (tx) => {
      const e = await aktuellerEintrag(tx, ziel.organisationId);
      return e ? { gericht: e.gericht, registerart: e.registerart, nummer: e.nummer } : undefined;
    });
    let meldung = "ok";
    let abruf = null;
    if (!referenz) meldung = "kein_eintrag";
    else {
      try {
        abruf = await anbieter.abruf(referenz);
        if (!abruf) meldung = "nicht_gefunden";
      } catch (fehler) {
        meldung = `fehler: ${(fehler instanceof Error ? fehler.message : String(fehler)).slice(0, 200)}`;
        ergebnis.fehler++;
      }
    }
    await schreibe(db, "system", async (tx, protokoll) => {
      if (abruf) {
        const { eintrag, neu } = await legeEintragAn(tx, protokoll, ziel.organisationId, abruf.eintrag, quelle);
        if (neu) {
          ergebnis.neueEintraege++;
          await meldeEintrag(tx, ziel.organisationId, eintrag.firma, eintrag.standDatum);
        }
        for (const e of abruf.ereignisse) {
          const r = await legeEreignisAn(tx, protokoll, ziel.organisationId, e, quelle, eintrag.id);
          if (r.neu) {
            ergebnis.neueEreignisse++;
            await meldeEreignis(tx, ziel.organisationId, r.ereignis, eintrag.firma, { protokoll, kontext: optionen.mail });
          }
        }
      }
      await tx.update(registerBeobachtung).set({ letztePruefungAm: new Date(), letztesErgebnis: meldung }).where(eq(registerBeobachtung.organisationId, ziel.organisationId));
    });
    ergebnis.geprueft++;
  }
  return ergebnis;
}
