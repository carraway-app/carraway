import type { BerichtDetail } from "../api/abfragen";
import { alle } from "../erweiterung";

export const BERICHTSARTEN = ["fondsbericht", "lp_bericht", "quartalsbericht", "gremienvorlage", "portfolioliste", "exitliste", "pai_erklaerung", "szenariobericht"] as const;
export type Berichtsart = (typeof BERICHTSARTEN)[number];
/** Arten, die eine Erweiterung mitbringt (PAI-Erklärung der Erweiterung ESG); ohne sie bietet die Oberfläche sie nicht an. */
const ARTEN_AUS_ERWEITERUNGEN: readonly Berichtsart[] = ["pai_erklaerung"];

/**
 * Arten, die der Dialog „Bericht anlegen“ und die Vorlagen anbieten: die des Kerns plus die angemeldeter Erweiterungen (`erweiterung.ts`, Punkt
 * `berichtsarten`). Der Szenariobericht entsteht aus festgeschriebenen Szenarien (Seite Szenarien).
 */
export function anlegbareArten(): Berichtsart[] {
  const zusatz = new Set(alle("berichtsarten").map((a) => a.art));
  return BERICHTSARTEN.filter((a) => a !== "szenariobericht" && (!ARTEN_AUS_ERWEITERUNGEN.includes(a) || zusatz.has(a)));
}

/** Formate je Art (wie `FORMATE` der API); das erste ist die Vorgabe. */
export const FORMATE: Record<Berichtsart, readonly ("pdf" | "xlsx")[]> = {
  fondsbericht: ["pdf", "xlsx"],
  lp_bericht: ["pdf"],
  quartalsbericht: ["pdf"],
  gremienvorlage: ["pdf"],
  portfolioliste: ["pdf", "xlsx"],
  exitliste: ["pdf", "xlsx"],
  pai_erklaerung: ["pdf", "xlsx"],
  szenariobericht: ["pdf", "xlsx"],
};

/** Arten mit Währungssicht (wie `SICHT_ARTEN` der API): Berichte mit Zeilen je Beteiligung. */
export const SICHT_ARTEN: readonly Berichtsart[] = ["fondsbericht", "lp_bericht", "portfolioliste", "exitliste"];

/** Freitextabschnitte des LP-Berichts (wie `FREITEXT_SCHLUESSEL` der API). */
export const FREITEXTE = ["vorwort", "marktumfeld", "ausblick"] as const;
export type Freitext = (typeof FREITEXTE)[number];

export interface ProtokollEintrag {
  ergebnis: string;
  akteur: string;
}

/**
 * Gültige Freigaben nach Wiedergabe des Protokolls, wie die API sie zählt: Ein `ok` fügt eine Stufe hinzu, jede Rückgabe nimmt die
 * zuletzt erteilte zurück. Das Protokoll kommt von der API in der Reihenfolge der Zeitpunkte.
 */
export function aktiveStufen<T extends ProtokollEintrag>(protokoll: readonly T[]): T[] {
  const aktiv: T[] = [];
  for (const eintrag of protokoll) {
    if (eintrag.ergebnis === "ok") aktiv.push(eintrag);
    else aktiv.pop();
  }
  return aktiv;
}

/** Stufennamen des Berichts (zum Zeitpunkt der Anlage festgehalten). */
export const stufenNamen = (bericht: Pick<BerichtDetail, "freigabestufen">): string[] => (Array.isArray(bericht.freigabestufen) ? bericht.freigabestufen.map(String) : []);

/** Abschnitte der festgehaltenen Vorlage. */
export function vorlagenAbschnitte(bericht: Pick<BerichtDetail, "konfiguration">): string[] {
  const k = bericht.konfiguration as { abschnitte?: unknown } | null;
  return Array.isArray(k?.abschnitte) ? k.abschnitte.map(String) : [];
}

/**
 * Personen, die nach den sichtbaren Angaben keine Stufe erteilen dürfen: Ersteller, letzte Bearbeiter der Abschnitte und
 * Personen mit gültiger Freigabe. Frühere Bearbeiter, deren Text überschrieben wurde, kennt die Oberfläche nicht; die API prüft die ganze Geschichte.
 */
export function ausgeschlosseneStufen(bericht: Pick<BerichtDetail, "erstelltVon" | "abschnitte" | "protokoll">) {
  const ersteller = bericht.erstelltVon;
  const bearbeiter = [...new Set((bericht.abschnitte as { geaendertVon: string }[]).map((a) => a.geaendertVon))];
  const freigeber = [...new Set(aktiveStufen(bericht.protokoll as ProtokollEintrag[]).map((p) => p.akteur))];
  return { ersteller, bearbeiter, freigeber };
}
