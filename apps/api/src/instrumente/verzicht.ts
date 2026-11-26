import { and, eq, gte, isNull, or } from "drizzle-orm";
import { darlehenVerzicht, verkauf, vorgang } from "@carraway/db";
import { darlehensverzicht, Decimal } from "@carraway/rechenkern";
import type { Akteur } from "../anmeldung/akteur";
import { sichtbareDokumentIds } from "../dokumente/ziele";
import { Fachfehler } from "../fehler";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { ladeInstrument, verlangeInstrumentAktiv } from "./instrumente";
import { pruefeStichtag } from "./stichtag";
import { ladeBuchwertabgang } from "./verkaeufe";
import { storniereVorgang } from "./verkauf";
import { ordneRundeZu } from "./vorgang-runde";
import { korrigiereNullperioden } from "./zinsperioden";
import { berechneAbgrenzung, ladeZinskontexte } from "./zinsen";
import { berechneZustand, buchwertVon, offenesKapital, pruefePeriodensperre, sperreBeteiligung, verlangeAktiv, verlangeDarlehensartig } from "./zustand";

interface Eingabe {
  date: string;
  principal: string;
  interest: string;
  reason: string;
  documentId?: string | undefined;
}

export async function verzichte(tx: Tx, id: string, e: Eingabe, akteur: Akteur, protokoll?: Protokollant) {
  const instrument = await ladeInstrument(tx, id);
  if (protokoll) await sperreBeteiligung(tx, instrument.beteiligungId);
  verlangeDarlehensartig(instrument.art);
  const [k] = await ladeZinskontexte(tx, { instrumentIds: [id] });
  if (!k) throw new Fachfehler(409, "instrument_mismatch", "A waiver requires a loan.");
  verlangeAktiv(k.beteiligung);
  verlangeInstrumentAktiv(k.instrument);
  await pruefePeriodensperre(tx, k.beteiligung.fondsId, e.date);
  await pruefeStichtag(tx, k.beteiligung.fondsId, e.date, "date");
  if (e.documentId && !(await sichtbareDokumentIds(tx, akteur, [e.documentId])).has(e.documentId)) {
    throw new Fachfehler(404, "document_not_found", "Document not found.");
  }
  const aufgehoben = new Set(k.vorgaenge.map((v) => v.storniertVorgangId));
  if (k.vorgaenge.some((v) => v.valuta > e.date && v.art !== "zusage" && !v.storniertVorgangId && !aufgehoben.has(v.id)) || k.markierte.some((tag) => tag > e.date)) {
    throw new Fachfehler(409, "loan_event_dependent", "Later loan transactions must be resolved before the waiver.");
  }
  const z = berechneZustand(k.vorgaenge, await ladeBuchwertabgang(tx, instrument.beteiligungId, id));
  const kapital = offenesKapital(z);
  const buchwert = buchwertVon(z).wert;
  const offen = z.zinsen.minus(z.kapitalisiert).minus(z.zinszahlungen).minus(z.gebuchteZinsenErlassen);
  const zinsen = new Decimal(e.interest);
  const a = zinsen.gt(Decimal.max(offen, 0)) ? berechneAbgrenzung(k, e.date) : null;
  const perioden = a ? [...a.offenePerioden, a.laufend].map((p) => ({ bis: p.bis, betrag: p.betragGebucht })) : [];
  const verzicht = new Decimal(e.principal);
  let plan;
  try {
    plan = darlehensverzicht({ kapital, buchwert, wertberichtigung: z.wertberichtigungen, gebuchteZinsen: offen, aufgelaufeneZinsen: perioden }, verzicht, zinsen);
  } catch {
    throw new Fachfehler(400, "waiver_amount_invalid", "The waiver must be positive and within outstanding principal and interest.");
  }
  if (plan.restbuchwert.isNegative()) {
    throw new Fachfehler(409, "book_value_negative", "The carrying amount would fall below zero.", { bookValue: plan.restbuchwert.toFixed(2) });
  }
  const result = {
    principal: verzicht.toFixed(2), interest: zinsen.toFixed(2), remainingPrincipal: plan.restkapital.toFixed(2),
    impairmentUsed: plan.verbrauch.toFixed(2), loss: plan.verlust.toFixed(2), remainingCarryingAmount: plan.restbuchwert.toFixed(2),
    steps: plan.schritte.map((s) => ({ sign: s.zeichen, label: s.bezeichnung, value: s.wert, sources: [id] })),
  };
  if (!protokoll) return { waiverId: null, result };
  const [w] = await tx.insert(darlehenVerzicht).values({ instrumentId: id, datum: e.date, grund: e.reason, dokumentId: e.documentId, schritte: result.steps }).returning();
  await protokoll("anlegen", "darlehen_verzicht", w!.id, null, w);
  const zeilen: { art: "wertberichtigung" | "tilgung" | "interest_waiver"; betrag: Decimal; bis?: string }[] = [
    { art: "wertberichtigung", betrag: plan.verbrauch.neg() },
    { art: "tilgung", betrag: verzicht },
    { art: "interest_waiver", betrag: plan.gebucht },
    ...plan.aufgelaufen.map((p) => ({ art: "interest_waiver" as const, ...p })),
  ];
  for (const zeile of zeilen.filter((v) => !v.betrag.isZero())) {
    const [v] = await tx.insert(vorgang).values({
      beteiligungId: instrument.beteiligungId, instrumentId: id, valuta: e.date, art: zeile.art, betrag: zeile.betrag.toFixed(2),
      verzichtId: w!.id, zinsverzichtBis: zeile.bis, bemerkung: `Verzicht: ${e.reason}`,
    }).returning();
    await protokoll("anlegen", "vorgang", v!.id, null, v);
    await ordneRundeZu(tx, protokoll, v!);
  }
  return { waiverId: w!.id, result };
}

export async function storniereVerzicht(tx: Tx, protokoll: Protokollant, instrumentId: string, waiverId: string, grund: string) {
  const i = await ladeInstrument(tx, instrumentId);
  const b = await sperreBeteiligung(tx, i.beteiligungId);
  const [w] = await tx.select().from(darlehenVerzicht).where(and(eq(darlehenVerzicht.id, waiverId), eq(darlehenVerzicht.instrumentId, instrumentId)));
  if (!w) throw new Fachfehler(404, "transaction_not_found", "Waiver not found.");
  if (w.storniertAm) throw new Fachfehler(409, "already_reversed", "The waiver is already reversed.");
  await pruefePeriodensperre(tx, b.fondsId, w.datum);
  const [verkauft] = await tx.select({ id: verkauf.id }).from(verkauf).where(and(eq(verkauf.beteiligungId, b.id), or(isNull(verkauf.instrumentId), eq(verkauf.instrumentId, i.id)), gte(verkauf.erfasstAm, w.erfasstAm), isNull(verkauf.storniertAm)));
  const [k] = await ladeZinskontexte(tx, { instrumentIds: [i.id] });
  const aufgehoben = new Set(k?.vorgaenge.map((v) => v.storniertVorgangId));
  if (i.status !== "aktiv" || verkauft || k?.vorgaenge.some((v) => v.verzichtId !== waiverId && !v.storniertVorgangId && !aufgehoben.has(v.id) && v.erfasstAm > w.erfasstAm && (v.art === "zins" || v.verzichtId))) {
    throw new Fachfehler(409, "reversal_not_allowed", "Reverse dependent interest bookings, sales or waivers first.");
  }
  const originale = await tx.select().from(vorgang).where(eq(vorgang.verzichtId, waiverId));
  // Zuerst das Kapital wiederherstellen, danach die zugehörige Wertberichtigung.
  for (const v of originale.sort((a, b) => Number(a.art === "wertberichtigung") - Number(b.art === "wertberichtigung"))) {
    await storniereVorgang(tx, protokoll, b, v, grund);
  }
  await korrigiereNullperioden(tx, instrumentId, w.erfasstAm);
  const [nachher] = await tx.update(darlehenVerzicht).set({ storniertAm: new Date() }).where(eq(darlehenVerzicht.id, waiverId)).returning();
  await protokoll("stornieren", "darlehen_verzicht", waiverId, w, { ...nachher, grund });
  return { waiverId, reversedAt: nachher!.storniertAm!.toISOString() };
}
