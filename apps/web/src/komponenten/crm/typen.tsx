import { formatBetrag, formatDatum, type Sprache } from "@carraway/ui";
import type { Feld, Objekt, Option, Zeile } from "../../api/crm";
import type { Texte } from "../../i18n";

/** Zeile der Phase im Board: Reihenfolge der Spalten ist die der Pipeline. */
export const PHASEN = ["anfrage", "erstgespraech", "pruefung", "due_diligence", "investitionsausschuss", "closing"] as const;

/** Farben der Optionen: gespeicherte Schlüssel der Palette (kein Orange; `signal` zeigt Grün), Klassen stehen in `crm.css`, Werte in den Kategorie-Tokens. */
export const FARBEN = ["grau", "signal", "blau", "violett", "tuerkis", "rose", "sand"] as const;

const SYSTEM_FARBEN: Record<string, Option["farbe"]> = {
  anfrage: "grau",
  erstgespraech: "blau",
  pruefung: "violett",
  due_diligence: "tuerkis",
  investitionsausschuss: "sand",
  closing: "signal",
  offen: "blau",
  investiert: "signal",
  abgesagt: "rose",
};

/** Optionen eines Auswahlfeldes mit übersetzten Bezeichnungen bei Systemfeldern (Art, Phase, Status). */
export function optionenVon(feld: Feld, t: Texte): Option[] {
  const roh = feld.optionen.optionen ?? [];
  if (!feld.system) return roh;
  const woerter: Record<string, Record<string, string> | undefined> = {
    art: t.organisationArt as Record<string, string>,
    phase: t.dealPhase as Record<string, string>,
    status: t.dealStatus as Record<string, string>,
    herkunft: t.dealflow.herkuenfte,
    dealtyp: t.crm.dealtypen,
  };
  const tabelle = woerter[feld.schluessel];
  return roh.map((o) => ({ ...o, label: tabelle?.[o.schluessel] ?? o.label, farbe: SYSTEM_FARBEN[o.schluessel] ?? "grau" }));
}

/** Name eines Feldes: Systemfelder übersetzt, eigene Felder so, wie sie definiert sind. */
export function feldName(feld: Feld, t: Texte): string {
  if (!feld.system) return feld.name;
  const tabelle = t.crm.systemfelder as Record<string, string>;
  return tabelle[feld.schluessel] ?? feld.name;
}

/** Text einer Zelle ohne Verknüpfungen (für Eingabefelder, Sortierung und Tests). */
export function zellText(feld: Feld, wert: unknown, bezuege: Record<string, string | null>, t: Texte, sprache: Sprache): string {
  if (wert === null || wert === undefined || wert === "") return "";
  switch (feld.typ) {
    case "betrag":
      return formatBetrag(String(wert), sprache);
    case "zahl":
      return new Intl.NumberFormat(sprache === "de" ? "de-DE" : "en-GB", { maximumFractionDigits: 6 }).format(Number(wert));
    case "datum":
      return formatDatum(String(wert), sprache);
    case "kontrollkaestchen":
      return wert ? t.crm.ja : t.crm.nein;
    case "auswahl":
      return optionenVon(feld, t).find((o) => o.schluessel === wert)?.label ?? String(wert);
    case "mehrfachauswahl":
      return Array.isArray(wert) ? wert.map((w) => optionenVon(feld, t).find((o) => o.schluessel === w)?.label ?? String(w)).join(", ") : "";
    case "verknuepfung":
      return feld.ziel ? (bezuege[`${feld.ziel}:${String(wert)}`] ?? t.crm.keinZugriff) : "";
    case "benutzer":
      return bezuege[`benutzer:${String(wert)}`] ?? "";
    default:
      return String(wert);
  }
}

export function recordLink(objekt: Objekt, id: string): { to: "/organisationen/$id" | "/personen/$id" | "/deals/$id"; params: { id: string } } {
  return { to: objekt === "organisation" ? "/organisationen/$id" : objekt === "person" ? "/personen/$id" : "/deals/$id", params: { id } };
}

/** Das Feld, dessen Zelle den Datensatz öffnet (Name bzw. Titel). */
export const NAMENSFELD: Record<Objekt, string> = { organisation: "name", person: "name", deal: "titel" };

/** Namen der Zeile für Beschriftungen von Aktionen. */
export const zeilenName = (objekt: Objekt, z: Zeile): string => String(z[NAMENSFELD[objekt]] ?? z.id);

/** Schnellaktionen eines Feldes (Mail, Telefon, Adresse): `mailto:`, `tel:` oder die sichere Adresse; sonst `null`. */
export function schnellLink(feld: Pick<Feld, "typ">, wert: unknown, sichere: (u: string) => string | null): string | null {
  if (typeof wert !== "string" || wert === "") return null;
  if (feld.typ === "email") return `mailto:${wert}`;
  if (feld.typ === "telefon") return `tel:${wert.replace(/[^+0-9]/g, "")}`;
  if (feld.typ === "url") return sichere(wert);
  return null;
}

/**
 * Werte für die Schnellaktionen einer Zeile: Unternehmen und Kontakte tragen ihre Kontaktwege selbst, bei Deals sind es die des Unternehmens
 * (Mail, Telefon, Website), damit jede Zeile und jede Karte dieselben Aktionen bietet.
 */
export function schnellWerte(objekt: Objekt, z: Record<string, unknown>): Record<string, unknown> {
  if (objekt !== "deal") return z;
  return { email: z.unternehmenEmail ?? null, telefon: z.unternehmenTelefon ?? null, website: z.unternehmenWebsite ?? null };
}

/** Name, den die Schnellaktionen in ihrer Beschriftung nennen: bei Deals das Unternehmen, an das sich die Aktion richtet. */
export function schnellName(objekt: Objekt, z: Record<string, unknown>, bezuege: Record<string, string | null>): string {
  if (objekt === "deal" && typeof z.unternehmen === "string") return bezuege[`organisation:${z.unternehmen}`] ?? String(z.titel ?? z.id);
  return String(z[NAMENSFELD[objekt]] ?? z.id);
}
