import type { ErrorHandler } from "hono";
import { Fachfehler, fehlerAntwort, type Feldfehler } from "../fehler";
import { enumWert, feldpfad, insEnglische } from "./abbildung";

// Der Rechenkern liefert für den Kapitalverlauf auch Datum und Betrag im Freitext.
function kapitalFehler(grund: unknown) {
  const text = typeof grund === "string" ? grund : "";
  const tag = text.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  const datum = tag ? { valueDate: tag } : {};
  if (text.startsWith("Offenes Kapital")) {
    const betrag = text.match(/\((-[\d.]+)\)$/)?.[1];
    return { ...datum, reason: "negative_outstanding_capital", ...(betrag ? { amount: betrag } : {}) };
  }
  if (text.startsWith("Die erste Bewegung")) return { ...datum, reason: "first_movement_must_be_disbursement" };
  if (text.startsWith("Betrag der Bewegung")) return { ...datum, reason: "amount_must_be_positive" };
  return { ...datum, reason: "invalid_capital_history" };
}

/** Fachfehler derselben Berechnung können auch von Routen mit anderem Vertrag kommen. */
export const buchhaltungsFehler: ErrorHandler = (fehler, c) => {
  if (!(fehler instanceof Fachfehler)) throw fehler;
  const { felder, grund, ...rest } = fehler.zusatz ?? {};
  const zusatz = insEnglische(rest);
  if (typeof rest.feld === "string") zusatz.field = feldpfad(rest.feld, true);
  let meldung = fehler.message;
  if (fehler.code === "capital_history_invalid") {
    Object.assign(zusatz, kapitalFehler(grund));
    meldung = "The transactions do not form a valid capital history.";
  } else if (typeof grund === "string") {
    zusatz.reason = enumWert(grund);
  }
  const feldfehler = Array.isArray(felder) ? (felder as Feldfehler[]).map((f) => ({
    feld: feldpfad(f.feld, true),
    code: enumWert(f.code),
    meldung: f.meldung,
  })) : undefined;
  return fehlerAntwort(c, fehler.status, fehler.code, meldung, feldfehler, zusatz);
};
