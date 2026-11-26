import type { Sprache } from "@carraway/ui";
import type { SzenarioAnnahmen, SzenarioVorlage } from "../api/szenarien";
import { zahlNormalisiert } from "./feldpruefung";

/**
 * Eingabeformen des Szenario-Editors. Hier wird nichts gerechnet: Prozentangaben der Eingabe werden nur als Zeichenkette in einen Bruch
 * der API verschoben (zwei Stellen) und zurück, ohne Gleitkomma. Die Annahmen prüft und rechnet der Server.
 */

/** „2,5“ oder „2.5“ (Prozent) → „0.025“; leer → `undefined`; ungültig → `null`. */
export function prozentZuBruch(text: string): string | undefined | null {
  const t = text.trim().replace(",", ".");
  if (t === "") return undefined;
  const m = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(t);
  if (!m) return null;
  // Prozent mit genau vier Nachkommastellen als ganze Zahl N; der Bruch ist N ÷ 10^6.
  const n = `${m[1]}${(m[2] ?? "").padEnd(4, "0")}`.replace(/^0+(?=\d)/, "");
  const s = n.padStart(7, "0");
  const ganz = s.slice(0, s.length - 6);
  const rest = s.slice(-6).replace(/0+$/, "");
  return rest ? `${ganz}.${rest}` : ganz;
}

/** „0.025“ → „2.5“ (Prozent) für das Eingabefeld. */
export function bruchZuProzent(bruch: string): string {
  const m = /^(\d)(?:\.(\d{1,6}))?$/.exec(bruch);
  if (!m) return bruch;
  const stellen = `${m[1]}${(m[2] ?? "").padEnd(6, "0")}`; // sieben Ziffern: eine vor, sechs nach dem Komma
  const prozentGanz = stellen.slice(0, 3).replace(/^0+(?=\d)/, "");
  const prozentRest = stellen.slice(3).replace(/0+$/, "");
  return prozentRest ? `${prozentGanz}.${prozentRest}` : prozentGanz;
}

export type AusstiegArt = "keiner" | "multiple" | "wert" | "abschreibung";

export interface ZeilenForm {
  art: AusstiegArt;
  jahr: string;
  angabe: string;
  wahrscheinlichkeit: string;
  quote: string;
  kosten: string;
  folgeJahr: string;
  folgeBetrag: string;
}

export interface SzenarioForm {
  name: string;
  basisStichtag: string;
  endJahr: string;
  wertpfad: "linear" | "konstant";
  gebuehrenBasis: "zeichnungskapital" | "investiert";
  satz: string;
  bisJahr: string;
  sonstige: string;
  carry: string;
  zeilen: Record<string, ZeilenForm>;
  /** Geplante Neuinvestitionen des Fonds (Unternehmen, die es noch nicht im Portfolio gibt). */
  neuinvestitionen: NeuinvestitionForm[];
  /** Bewertungsszenarien (Etappe 21): werden hier nicht bearbeitet, aber unverändert durchgereicht, damit das Speichern sie nicht löscht. */
  bewertung?: SzenarioAnnahmen["bewertung"];
}

export interface NeuinvestitionForm {
  name: string;
  jahr: string;
  betrag: string;
  /** Optional: Jahr des Ausstiegs und Vielfaches des investierten Betrags als Erlös. */
  ausstiegJahr: string;
  multiple: string;
}

export const leereNeuinvestition = (): NeuinvestitionForm => ({ name: "", jahr: "", betrag: "", ausstiegJahr: "", multiple: "" });

export const leereZeile = (): ZeilenForm => ({ art: "keiner", jahr: "", angabe: "", wahrscheinlichkeit: "100", quote: "", kosten: "", folgeJahr: "", folgeBetrag: "" });

export const leeresFormular = (basisStichtag: string, vorlage: SzenarioVorlage | undefined): SzenarioForm => ({
  name: "",
  basisStichtag,
  endJahr: "",
  wertpfad: "linear",
  gebuehrenBasis: "zeichnungskapital",
  satz: "",
  bisJahr: "",
  sonstige: "",
  carry: "",
  zeilen: Object.fromEntries((vorlage?.beteiligungen ?? []).map((b) => [b.id, leereZeile()])),
  neuinvestitionen: [],
});

const zahlOderUndefined = (t: string) => (t.trim() === "" ? undefined : Number(t));

/** Formular → Annahmen der API. Ungültige Prozentangaben bleiben leer (der Server meldet fehlende Pflichtangaben). */
export function bauAnnahmen(f: SzenarioForm, sprache: Sprache = "de"): SzenarioAnnahmen {
  /** Betrag in der Schreibweise der API; eine Eingabe, die keine Zahl ist, bleibt unverändert (der Editor meldet sie am Feld). */
  const zahl = (t: string) => zahlNormalisiert(t, sprache) ?? t.trim();
  const bruch = (t: string) => {
    const b = prozentZuBruch(t);
    return b === null ? undefined : b;
  };
  const beteiligungen: NonNullable<SzenarioAnnahmen["beteiligungen"]> = {};
  for (const [id, z] of Object.entries(f.zeilen)) {
    const folge = z.folgeJahr.trim() && z.folgeBetrag.trim() ? [{ jahr: Number(z.folgeJahr), betrag: zahl(z.folgeBetrag) }] : [];
    if (z.art === "keiner" && folge.length === 0 && !z.quote.trim()) continue;
    const quote = bruch(z.quote);
    beteiligungen[id] = {
      ...(z.art === "keiner" ? { ausstieg: null } : {}),
      ...(z.art === "abschreibung" ? { ausstieg: { art: "abschreibung" as const, jahr: Number(z.jahr) } } : {}),
      ...(z.art === "multiple" ? { ausstieg: { art: "exit" as const, jahr: Number(z.jahr), multiple: zahl(z.angabe), wahrscheinlichkeit: bruch(z.wahrscheinlichkeit) ?? "1", kosten: "0" } } : {}),
      ...(z.art === "wert" ? { ausstieg: { art: "exit" as const, jahr: Number(z.jahr), wert: zahl(z.angabe), wahrscheinlichkeit: bruch(z.wahrscheinlichkeit) ?? "1", kosten: z.kosten.trim() ? zahl(z.kosten) : "0" } } : {}),
      ...(quote !== undefined ? { quote } : {}),
      folgeinvestitionen: folge,
    };
  }
  const endJahr = zahlOderUndefined(f.endJahr);
  const bisJahr = zahlOderUndefined(f.bisJahr);
  return {
    ...(endJahr !== undefined ? { endJahr } : {}),
    wertpfad: f.wertpfad,
    gebuehren: { basis: f.gebuehrenBasis, satz: bruch(f.satz) ?? "0", bisJahr: bisJahr ?? null, sonstigeJahr: f.sonstige.trim() ? zahl(f.sonstige) : "0" },
    carrySatz: bruch(f.carry) ?? "0",
    beteiligungen,
    ...(f.bewertung ? { bewertung: f.bewertung } : {}),
    neuinvestitionen: f.neuinvestitionen
      .filter((n) => Object.values(n).some((w) => w.trim() !== ""))
      .map((n) => ({
        name: n.name.trim(),
        jahr: Number(n.jahr),
        betrag: zahl(n.betrag),
        ...(n.ausstiegJahr.trim() ? { ausstiegJahr: Number(n.ausstiegJahr) } : {}),
        ...(n.multiple.trim() ? { multiple: zahl(n.multiple) } : {}),
      })),
  } as SzenarioAnnahmen;
}

type Gespeichert = { name: string; basisStichtag: string; annahmen: unknown };

/** Gespeicherte Annahmen → Formular zum Bearbeiten. */
export function formAusSzenario(s: Gespeichert, vorlage: SzenarioVorlage | undefined): SzenarioForm {
  const a = s.annahmen as {
    endJahr?: number;
    wertpfad?: "linear" | "konstant";
    gebuehren?: { basis?: "zeichnungskapital" | "investiert"; satz?: string; bisJahr?: number | null; sonstigeJahr?: string };
    carrySatz?: string;
    neuinvestitionen?: { name: string; jahr: number; betrag: string; ausstiegJahr?: number; multiple?: string }[];
    bewertung?: SzenarioAnnahmen["bewertung"];
    beteiligungen?: Record<string, { ausstieg?: { art: string; jahr: number; wert?: string; multiple?: string; wahrscheinlichkeit?: string; kosten?: string } | null; quote?: string; folgeinvestitionen?: { jahr: number; betrag: string }[] }>;
  };
  const f = leeresFormular(s.basisStichtag, vorlage);
  f.name = s.name;
  f.endJahr = a.endJahr ? String(a.endJahr) : "";
  f.wertpfad = a.wertpfad ?? "linear";
  f.gebuehrenBasis = a.gebuehren?.basis ?? "zeichnungskapital";
  f.satz = bruchZuProzent(a.gebuehren?.satz ?? "0");
  f.bisJahr = a.gebuehren?.bisJahr ? String(a.gebuehren.bisJahr) : "";
  f.sonstige = a.gebuehren?.sonstigeJahr && a.gebuehren.sonstigeJahr !== "0" ? a.gebuehren.sonstigeJahr : "";
  f.carry = bruchZuProzent(a.carrySatz ?? "0");
  if (a.bewertung) f.bewertung = a.bewertung;
  f.neuinvestitionen = (a.neuinvestitionen ?? []).map((n) => ({ name: n.name, jahr: String(n.jahr), betrag: n.betrag, ausstiegJahr: n.ausstiegJahr === undefined ? "" : String(n.ausstiegJahr), multiple: n.multiple ?? "" }));
  for (const [id, b] of Object.entries(a.beteiligungen ?? {})) {
    const z = f.zeilen[id] ?? leereZeile();
    const x = b.ausstieg;
    if (x?.art === "abschreibung") Object.assign(z, { art: "abschreibung", jahr: String(x.jahr) });
    if (x?.art === "exit") Object.assign(z, { art: x.multiple !== undefined ? "multiple" : "wert", jahr: String(x.jahr), angabe: x.multiple ?? x.wert ?? "", wahrscheinlichkeit: bruchZuProzent(x.wahrscheinlichkeit ?? "1"), kosten: x.kosten && x.kosten !== "0" ? x.kosten : "" });
    if (b.quote) z.quote = bruchZuProzent(b.quote);
    const folge = b.folgeinvestitionen?.[0];
    if (folge) Object.assign(z, { folgeJahr: String(folge.jahr), folgeBetrag: folge.betrag });
    f.zeilen[id] = z;
  }
  return f;
}
