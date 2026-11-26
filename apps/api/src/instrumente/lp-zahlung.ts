import { asc, eq } from "drizzle-orm";
import { fondsBewegung, lpZahlung } from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { ladeGebuchteBewegungsaufteilung, speichereAbrufanteile, sperreFonds } from "./fondsbewegung";
import { pruefePeriodensperre } from "./zustand";

type Zahlung = { organisationId: string; valuta: string; betrag: string; belegreferenz?: string | null | undefined };
type Storno = { zahlungId: string; valuta: string; grund: string };

export async function bucheLpZahlung(tx: Tx, protokoll: Protokollant, bewegungId: string, eingabe: Zahlung | Storno) {
  const [abruf] = await tx.select().from(fondsBewegung).where(eq(fondsBewegung.id, bewegungId));
  if (!abruf || abruf.art !== "abruf" || abruf.storniertBewegungId) throw new Fachfehler(404, "call_not_found", "Capital call not found.");
  await sperreFonds(tx, abruf.fondsId);
  const [storno] = await tx.select({ id: fondsBewegung.id }).from(fondsBewegung).where(eq(fondsBewegung.storniertBewegungId, bewegungId));
  if (storno) throw new Fachfehler(409, "movement_reversed", "The capital call is reversed.");
  await pruefePeriodensperre(tx, abruf.fondsId, eingabe.valuta);
  const bisher = await tx.select().from(lpZahlung).where(eq(lpZahlung.bewegungId, bewegungId)).orderBy(asc(lpZahlung.valuta), asc(lpZahlung.id));
  let buchung: typeof lpZahlung.$inferInsert;
  if ("zahlungId" in eingabe) {
    const original = bisher.find((z) => z.id === eingabe.zahlungId);
    if (!original) throw new Fachfehler(404, "payment_not_found", "Incoming payment for the call not found.");
    if (original.storniertZahlungId || bisher.some((z) => z.storniertZahlungId === original.id)) throw new Fachfehler(409, "reversal_not_allowed", "This booking cannot be reversed.");
    if (eingabe.valuta < original.valuta) throw new Fachfehler(400, "reversal_before_payment", "The reversal value date is before the payment.");
    buchung = { bewegungId, organisationId: original.organisationId, valuta: eingabe.valuta, betrag: new Decimal(original.betrag).neg().toFixed(2), grund: eingabe.grund, storniertZahlungId: original.id };
  } else {
    if (eingabe.valuta < abruf.valuta) throw new Fachfehler(400, "payment_before_call", "The value date is before the call.");
    const { aufteilung } = await ladeGebuchteBewegungsaufteilung(tx, abruf);
    const anteil = aufteilung.find((z) => z.organisationId === eingabe.organisationId);
    if (!anteil) throw new Fachfehler(409, "no_call_share", "The investor has no share in this call.");
    // Auch spätere Buchungen berücksichtigen: an keinem Wertstellungstag darf der Anteil überzahlt sein.
    const tage = new Map<string, Decimal>([[eingabe.valuta, new Decimal(eingabe.betrag)]]);
    for (const z of bisher.filter((z) => z.organisationId === eingabe.organisationId)) tage.set(z.valuta, (tage.get(z.valuta) ?? new Decimal(0)).plus(z.betrag));
    let saldo = new Decimal(0);
    for (const tag of [...tage.keys()].sort()) {
      saldo = saldo.plus(tage.get(tag)!);
      if (saldo.gt(anteil.betrag)) throw new Fachfehler(409, "payment_exceeds_call", "The payment exceeds the open call amount.");
    }
    // Bei Altdaten bindet der erste belegte Eingang die bisherige Verteilung für alle Investoren.
    await speichereAbrufanteile(tx, bewegungId, aufteilung);
    buchung = { bewegungId, ...eingabe };
  }
  const [neu] = await tx.insert(lpZahlung).values(buchung).returning();
  if (!neu) throw new Error("Zahlung nicht gebucht");
  await protokoll("anlegen", "lp_zahlung", neu.id, null, neu);
  return neu;
}
