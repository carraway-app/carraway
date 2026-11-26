import { z } from "zod";
import { Decimal } from "@carraway/rechenkern";

/**
 * Annahmen eines Szenarios (Etappe 18). Das JSON wird beim Anlegen und Ändern gegen dieses Schema geprüft; der Bezug zu den Beteiligungen
 * des Fonds und die Jahre prüft die Berechnung (`rechnen.ts`). Beträge sind Zeichenketten, Anteile Brüche (0.02 = 2 %).
 */

const betrag = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, "Betrag mit höchstens zwei Nachkommastellen erwartet");
const anteil = (max = "1") => z.string().regex(/^\d(\.\d{1,6})?$/, "Bruch mit höchstens sechs Nachkommastellen erwartet").refine((w) => Number(w) <= Number(max), { message: `höchstens ${max}` });
const faktor = z.string().regex(/^\d{1,4}(\.\d{1,4})?$/, "Faktor mit höchstens vier Nachkommastellen erwartet");
const jahr = z.number().int().min(1990).max(2100);

const exit = z
  .object({
    art: z.literal("exit"),
    jahr,
    /** Exit-Wert des Unternehmens (Erlös nach Kosten wird daraus gerechnet), über die Kapitaltabelle verteilt. */
    wert: betrag.optional(),
    /** Vielfaches des aktuellen Wertansatzes der Beteiligung als Erlös des Fonds. */
    multiple: faktor.optional(),
    wahrscheinlichkeit: anteil().default("1"),
    /** Exit-Kosten, vor der Verteilung vom Exit-Wert abgezogen (nur bei `wert`). */
    kosten: betrag.default("0"),
  })
  .refine((e) => (e.wert === undefined) !== (e.multiple === undefined), { message: "Entweder Exit-Wert oder Multiple angeben", path: ["wert"] });

const abschreibung = z.object({ art: z.literal("abschreibung"), jahr });

const folge = z.object({ jahr, betrag: betrag.refine((b) => Number(b) > 0, { message: "Betrag größer als null" }) });

const beteiligungAnnahme = z.object({
  ausstieg: z.discriminatedUnion("art", [exit, abschreibung]).nullable().optional(),
  /** Anteil des Fonds am Unternehmen, nur als Rückfall, wenn es keine Kapitaltabelle des Fonds gibt. */
  quote: anteil().optional(),
  folgeinvestitionen: z.array(folge).max(20).default([]),
});

const neuinvestition = z.object({
  name: z.string().trim().min(1).max(200),
  jahr,
  betrag: betrag.refine((b) => Number(b) > 0, { message: "Betrag größer als null" }),
  ausstiegJahr: jahr.optional(),
  multiple: faktor.optional(),
});

/**
 * Bewertungsszenarien (Etappe 21): je Beteiligung mindestens zwei Fälle (Basis, Bär, Bulle oder eigene) mit Wahrscheinlichkeit und Methode. Die Gewichte sind Brüche und
 * ergeben je Beteiligung genau 1. Beträge sind in Fondswährung. Fehlt der Abschnitt, rechnet das Szenario wie vor Etappe 21 (Ergebnis und Prüfsumme bleiben gleich).
 */
const fallSchluessel = z.string().regex(/^[a-z][a-z0-9_]{0,19}$/, "Kleinbuchstaben, Ziffern und Unterstrich, höchstens 20 Zeichen");
const gewicht = z.string().regex(/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/, "Wahrscheinlichkeit als Bruch von 0 bis 1 mit höchstens sechs Nachkommastellen erwartet");
const abschlag = z
  .string()
  .regex(/^-?(0(\.\d{1,6})?|1(\.0{1,6})?)$/, "Abschlag als Bruch mit höchstens sechs Nachkommastellen erwartet (negativ = Aufschlag)")
  .refine((w) => Number(w) < 1, { message: "kleiner als 1" });
const bewertungsMethode = z.discriminatedUnion("art", [
  /** Unternehmenswert = Kennzahl × Multiple − Abzug (nicht unter null), mal Anteil des Fonds (ausdrücklich oder aus der Kapitaltabelle). */
  z.object({ art: z.literal("multiple"), kennzahl: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, "Schlüssel einer Kennzahl erwartet"), multiple: faktor, abzug: betrag.default("0"), anteil: anteil().optional() }),
  /** Preis je Anteil der letzten Runde × Anteile des Fonds × (1 − Abschlag). */
  z.object({ art: z.literal("letzte_runde"), abschlag: abschlag.default("0") }),
  z.object({ art: z.literal("wert"), betrag }),
]);
const bewertungsFall = z.object({ schluessel: fallSchluessel, name: z.string().trim().min(1).max(60).optional(), gewicht, methode: bewertungsMethode });
const bewertungBeteiligung = z
  .object({ faelle: z.array(bewertungsFall).min(2).max(6) })
  .superRefine((w, ctx) => {
    const schluessel = w.faelle.map((f) => f.schluessel);
    if (new Set(schluessel).size !== schluessel.length) ctx.addIssue({ code: "custom", message: "Fallschlüssel müssen eindeutig sein", path: ["faelle"] });
    const summe = w.faelle.reduce((s, f) => s.plus(f.gewicht), new Decimal(0));
    if (!summe.equals(1)) ctx.addIssue({ code: "custom", message: `Die Wahrscheinlichkeiten ergeben ${summe.toFixed()}, erwartet genau 1 (100 %)`, path: ["faelle"], params: { summe: summe.toFixed() } });
  });
export const bewertungsAnnahmenSchema = z.object({ beteiligungen: z.record(z.uuid(), bewertungBeteiligung) });
export type BewertungsAnnahmen = z.infer<typeof bewertungsAnnahmenSchema>;

export const annahmenSchema = z.object({
  /** Letztes Prognosejahr; ohne Angabe Basisjahr + 10. */
  endJahr: jahr.optional(),
  wertpfad: z.enum(["linear", "konstant"]).default("linear"),
  gebuehren: z
    .object({
      basis: z.enum(["zeichnungskapital", "investiert"]).default("zeichnungskapital"),
      satz: anteil("0.1").default("0"),
      bisJahr: jahr.nullable().default(null),
      sonstigeJahr: betrag.default("0"),
    })
    .default({ basis: "zeichnungskapital", satz: "0", bisJahr: null, sonstigeJahr: "0" }),
  carrySatz: anteil().default("0"),
  beteiligungen: z.record(z.uuid(), beteiligungAnnahme).default({}),
  neuinvestitionen: z.array(neuinvestition).max(50).default([]),
  /** Bewertungsszenarien je Beteiligung (Etappe 21); optional, ohne Standardwert. */
  bewertung: bewertungsAnnahmenSchema.optional(),
});

export type Annahmen = z.infer<typeof annahmenSchema>;
export type BeteiligungAnnahme = z.infer<typeof beteiligungAnnahme>;
