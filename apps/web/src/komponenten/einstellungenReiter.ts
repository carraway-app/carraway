import type { ReactNode } from "react";
import { BellIcon, CalendarCheckIcon, EnvelopeSimpleIcon, LockIcon, MonitorIcon, type IconKomponente, type TabEintrag } from "@carraway/ui";
import { alle } from "../erweiterung";
import type { Texte } from "../i18n";
import { useSichtbar } from "../lib/bereiche";

/** Die Reiter der persönlichen Einstellungen des Kerns in fester Reihenfolge; sie liegen alle auf `/einstellungen/postfach`. */
export const EINSTELLUNGEN_REITER = ["benachrichtigungen", "postfach", "kalender", "darstellung", "sicherheit"] as const;
export type KernReiter = (typeof EINSTELLUNGEN_REITER)[number];

const ICON: Record<KernReiter, IconKomponente> = { benachrichtigungen: BellIcon, postfach: EnvelopeSimpleIcon, kalender: CalendarCheckIcon, darstellung: MonitorIcon, sicherheit: LockIcon };

/** Reiter des Kerns plus die der Erweiterungen (mit eigener Seite, z. B. „Excel“), jeweils hinter dem genannten Reiter des Kerns. */
function alleReiter(): string[] {
  const liste: string[] = [...EINSTELLUNGEN_REITER];
  for (const r of alle("einstellungenReiter")) {
    const nach = liste.indexOf(r.nach);
    liste.splice(nach < 0 ? liste.length : nach + 1, 0, r.id);
  }
  return liste;
}

/** Ziel eines Reiters mit eigener Seite (Erweiterung); `undefined` für die Reiter auf `/einstellungen/postfach`. */
export const eigeneSeite = (id: string): string | undefined => alle("einstellungenReiter").find((r) => r.id === id)?.ziel;

/** Reiter ohne Bereichsrecht (Postfach ohne Kontakte) entfallen, siehe `lib/bereiche.ts`. */
export const useEinstellungenReiterListe = () => useSichtbar("einstellungen", alleReiter().map((id) => ({ id }))).map((e) => e.id);

/** Reiter mit Beschriftung; `inhalte` liefert den Inhalt der Reiter, die auf der aktuellen Seite liegen (die übrigen bleiben leer und führen auf ihre Seite). */
export function useEinstellungenReiter(t: Texte, inhalte: Partial<Record<string, () => ReactNode>>): TabEintrag[] {
  const zusatz = alle("einstellungenReiter");
  return useEinstellungenReiterListe().map((id) => {
    const e = zusatz.find((r) => r.id === id);
    return { id, icon: e ? e.icon : ICON[id as KernReiter], label: e ? e.label(t) : t.tabs[id as KernReiter], ...(inhalte[id] ? { inhalt: inhalte[id] } : {}) };
  });
}
