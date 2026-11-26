import { z } from "zod";
import { registerArt, registerEreignisArt } from "@carraway/db";
import { optionalerText, textEingabe } from "../schreiben";

/** Eingabeformen der Registerdaten (Etappe 18), gemeinsam für Routen, Import und Anbieter. Alle Texte sind Freitext der Register. */

export const REGISTERARTEN = registerArt.enumValues;
export const EREIGNISARTEN = registerEreignisArt.enumValues;

export const datumEingabe = z.iso.date();

const personEintrag = z.object({
  name: textEingabe(200),
  funktion: textEingabe(100),
  /** Vertretungsbefugnis, z. B. „einzelvertretungsberechtigt“. */
  art: textEingabe(100).nullable().optional(),
});
export type VertretungEintrag = z.infer<typeof personEintrag>;

const kapitalEingabe = z
  .string()
  .regex(/^\d{1,16}(\.\d{1,2})?$/, "Betrag mit höchstens zwei Nachkommastellen erwartet")
  .nullable()
  .optional();

/** Inhalt eines Registereintrags ohne Organisation, Quelle und Erfassung. */
export const eintragWerte = z.object({
  gericht: textEingabe(200),
  registerart: z.enum(REGISTERARTEN),
  nummer: textEingabe(50),
  firma: textEingabe(300),
  rechtsform: optionalerText(100),
  sitz: optionalerText(200),
  anschrift: optionalerText(500),
  gegenstand: optionalerText(2000),
  kapital: kapitalEingabe,
  kapitalWaehrung: z.string().regex(/^[A-Z]{3}$/).default("EUR"),
  vertretung: z.array(personEintrag).max(50).default([]),
  prokura: z.array(personEintrag).max(50).default([]),
  standDatum: datumEingabe,
});
export type EintragWerte = z.infer<typeof eintragWerte>;

export const neuerEintrag = eintragWerte.extend({
  /** Registerauszug als Dokument (Etappe 13), optional. */
  dokumentId: z.uuid().nullable().optional(),
});

export const ereignisWerte = z.object({
  datum: datumEingabe,
  art: z.enum(EREIGNISARTEN),
  text: textEingabe(4000),
  externeId: textEingabe(200).nullable().optional(),
});
export type EreignisWerte = z.infer<typeof ereignisWerte>;

export const UEBERNAHME_FELDER = ["firma", "sitz", "rechtsform", "geschaeftsfuehrung"] as const;
export type UebernahmeFeld = (typeof UEBERNAHME_FELDER)[number];

/** Ereignisarten, die auf der Beteiligung einen Hinweis erzeugen (keine automatische Buchung). */
export const HINWEIS_ARTEN = ["insolvenz", "kapitalerhoehung", "loeschung"] as const;
