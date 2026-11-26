import type { ComponentType, ReactNode } from "react";
import type { AnyRoute } from "@tanstack/react-router";
import type { IconKomponente } from "@carraway/ui";
import type { BerichtDetail } from "./api/abfragen";
import type { Texte } from "./i18n";

/**
 * Erweiterungspunkte der Oberfläche (Open Core, docs/open-core.md). Der Kern importiert nie aus `ee/`; der Einstieg „Voll“ (`ee/web/src/main.tsx`)
 * meldet die Erweiterungen mit `meldeErweiterungAn` an, bevor er die Anwendung startet. Ohne Erweiterung zeigt der Kern keinen ihrer Einträge.
 */

/** Ein Reiter im Inhaltsverzeichnis eines Fonds mit eigener Adresse unter `/fonds/$fondsId/<pfad>`. */
export interface FondsReiter {
  id: string;
  /** Teil der Adresse nach `/fonds/$fondsId/`; die Route dazu bringt `routen` mit. */
  pfad: string;
  label: (t: Texte) => string;
  gruppe: { id: string; label: (t: Texte) => string };
  /** Bereich des Rechtemodells (`lib/bereiche.ts`); ohne Bereich immer sichtbar. */
  bereich?: string;
}

/** Ein Eintrag im Inhaltsverzeichnis der Beteiligung. */
export interface BeteiligungReiter {
  id: string;
  gruppe: string;
  tab: string;
  unter?: string;
  label: (t: Texte) => string;
  bereich?: string;
  inhalt: (k: { beteiligungId: string; organisationId: string; fondsId: string; name: string; lesend: boolean }) => ReactNode;
}

/** Ein Reiter der persönlichen Einstellungen mit eigener Seite. */
export interface EinstellungenReiter {
  id: string;
  icon: IconKomponente;
  label: (t: Texte) => string;
  /** Adresse der eigenen Seite (Route aus `routen`). */
  ziel: string;
  /** Der Reiter steht hinter diesem Reiter des Kerns. */
  nach: string;
}

/** Ein Bereich der Verwaltung (globale Verwalter). */
export interface VerwaltungBereich {
  id: string;
  /** Gruppe im Inhaltsverzeichnis (`zugaenge`, `vorgaben`, `betrieb`) und der Eintrag des Kerns, hinter dem er steht. */
  gruppe: "zugaenge" | "vorgaben" | "betrieb";
  nach: string;
  label: (t: Texte) => string;
  inhalt: () => ReactNode;
}

/** Eine Zeile im Betriebsstatus der Verwaltung aus den Angaben der Erweiterungen (`erweiterungen.<name>` in `GET /betrieb/status`). */
export interface BetriebZeileZusatz {
  id: string;
  pruefung: string;
  einzelheit: string;
}

/** Ein weiterer Einstieg neben der Anwendung (z. B. das LP-Portal unter `/portal`): eigener Router, eigene Texte. */
export interface Einstieg {
  passt: (pfad: string) => boolean;
  starte: (wurzel: HTMLElement) => Promise<void>;
  /** Startadresse für Investor-Benutzer (`ich.investor`); ohne Angabe bleibt der Einstieg für sie ungenutzt. */
  fuerInvestoren?: string;
}

/** Ein Textbereich (Wörterbuch einer Erweiterung), geladen mit den Seiten, die ihn brauchen. */
export interface Textbereich {
  name: string;
  /** Abschnitte der ersten Ebene, die der Bereich liefert. */
  abschnitte: readonly string[];
  lader: Record<"de" | "en", () => Promise<Record<string, object>>>;
  /** Adressen, deren Seiten den Bereich brauchen. */
  seiten: readonly RegExp[];
  /** Bereiche des Kerns, die eigene Seiten der Erweiterung zusätzlich brauchen (z. B. `stamm` für `/fonds/$fondsId/esg`). */
  kernBereiche?: readonly { muster: RegExp; bereiche: readonly string[] }[];
}

export interface WebErweiterung {
  name: string;
  /** Zusätzliche Routen: Kinder der Wurzel bzw. des Fondsrahmens (`/fonds/$fondsId`). */
  routen?: (eltern: { wurzel: AnyRoute; fondsRahmen: AnyRoute }) => { wurzel?: AnyRoute[]; fondsRahmen?: AnyRoute[] };
  texte?: readonly Textbereich[];
  fondsReiter?: readonly FondsReiter[];
  beteiligungReiter?: readonly BeteiligungReiter[];
  einstellungenReiter?: readonly EinstellungenReiter[];
  verwaltungBereiche?: readonly VerwaltungBereich[];
  betriebZeilen?: (angaben: Record<string, Record<string, unknown>>, t: Texte) => BetriebZeileZusatz[];
  /** Zusätzlicher Abschnitt in Fondsverwaltung → Investoren (unter Zeichnungen und Closings). */
  fondsInvestoren?: ComponentType<{ fondsId: string }>;
  /** Aktion je Dokument in der Dokumentliste (z. B. KI-Auslesung); bekommt das Dokument und ob die Person schreiben darf. */
  dokumentAktion?: ComponentType<{ dokument: { id: string; dateiname: string; textStatus: string; vertraulich: boolean; mime: string }; darfSchreiben: boolean }>;
  /** Zusätzliche Aktion für einen Anhang einer eingehenden Mail. */
  anhangAktion?: ComponentType<{ aktivitaetId: string; anhangId: string }>;
  /** Abschnitt auf der Seite einer Person oder eines Unternehmens (z. B. KI-Vorschläge für Felder); bekommt Objekt, ID und ob die Person schreiben darf. */
  datensatzErgaenzung?: ComponentType<{ objekt: "person" | "organisation"; id: string; darfSchreiben: boolean }>;
  /** Karte in den persönlichen Einstellungen unter Postfach und Kalender (z. B. Freigabe des eigenen Postfachs für eine KI-Funktion). */
  postfachEinstellungen?: ComponentType;
  /** Berichtsarten der Erweiterung: im Auswahlfeld beim Anlegen, mit optionalem Inhaltsreiter auf der Seite des Berichts. */
  berichtsarten?: readonly { art: string; inhalt?: ComponentType<{ b: BerichtDetail; person: (id: string | null | undefined) => string | null }> }[];
  /** Zusätzliche Anmeldewege auf der Anmeldeseite (Single Sign-On). */
  anmeldung?: ComponentType<{ weiter: string | undefined; laeuft: boolean; ausfuehren: (schritt: () => Promise<void>) => Promise<void> }>;
  einstiege?: readonly Einstieg[];
}

const angemeldet: WebErweiterung[] = [];

/** Meldet eine Erweiterung an; nur vor dem Start der Anwendung (Einstieg „Voll“). */
export function meldeErweiterungAn(e: WebErweiterung): void {
  if (!angemeldet.some((x) => x.name === e.name)) angemeldet.push(e);
}

/** Alle angemeldeten Erweiterungen in der Reihenfolge der Anmeldung. */
export const erweiterungen = (): readonly WebErweiterung[] => angemeldet;

/** Die Einträge eines Punktes aus allen Erweiterungen. */
export function alle<K extends keyof WebErweiterung>(punkt: K): NonNullable<WebErweiterung[K]> extends readonly (infer E)[] ? E[] : NonNullable<WebErweiterung[K]>[] {
  return angemeldet.flatMap((e) => {
    const wert = e[punkt];
    if (wert === undefined) return [];
    return Array.isArray(wert) ? wert : [wert];
  }) as never;
}
