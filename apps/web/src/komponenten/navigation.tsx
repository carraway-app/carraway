import type { ReactNode } from "react";
import type { NavigateOptions } from "@tanstack/react-router";
import {
  AddressBookIcon,
  BankIcon,
  BookOpenIcon,
  CalculatorIcon,
  ChartLineUpIcon,
  HouseIcon,
  KanbanIcon,
  ListMagnifyingGlassIcon,
  PaperPlaneTiltIcon,
  PercentIcon,
  ReceiptIcon,
  UploadSimpleIcon,
} from "@carraway/ui";
import { alle } from "../erweiterung";
import type { Ich } from "../api/anmeldung";
import type { Texte } from "../i18n";
import { hatBereich, hatIrgendwoRolle } from "../lib/rechte";

/** Ein Eintrag der Seitenleiste: wohin er führt, wann er aktiv ist und welches Zeichen er trägt. */
export interface NavDefinition {
  id: string;
  label: string;
  icon: ReactNode;
  ziel: NavigateOptions;
  aktiv: (pfad: string) => boolean;
}

export interface NavGruppeDefinition {
  id: string;
  /** Leer: Gruppe ohne Kopf (nicht einklappbar). */
  label: string;
  items: NavDefinition[];
}

/**
 * Gruppierung der Seitenleiste. Fondsbezogene Seiten (Journal, Meldungen) gibt es nur, solange ein Fonds im Kontext ist.
 * Die Seiten eines Fonds (Kennzahlen, ESG, Szenarien …) stehen als Reiter im Fonds, nicht hier. Verwaltung und Einstellungen
 * liegen im Kontomenü.
 */
export function navigationsgruppen(t: Texte, ich: Ich | undefined, fondsId: string | undefined, portfolio: NavigateOptions): NavGruppeDefinition[] {
  const fonds = (unter: "journal" | "meldungen"): NavigateOptions => ({ to: unter === "journal" ? "/fonds/$fondsId/journal" : "/fonds/$fondsId/meldungen", params: { fondsId: fondsId ?? "" }, search: {} });
  const finanzen: NavDefinition[] = [
    ...(fondsId ? [{ id: "journal", label: t.nav.journal, icon: <BookOpenIcon />, ziel: fonds("journal"), aktiv: (p: string) => p.endsWith("/journal") }] : []),
    { id: "zinsen", label: t.nav.zinsen, icon: <PercentIcon />, ziel: { to: "/zinslaeufe" }, aktiv: (p) => p.startsWith("/zinslaeufe") },
    { id: "belege", label: t.nav.belege, icon: <ReceiptIcon />, ziel: { to: "/belege" }, aktiv: (p) => p.startsWith("/belege") },
    { id: "buchhaltung", label: t.nav.buchhaltung, icon: <CalculatorIcon />, ziel: { to: "/buchhaltung", search: { fondsId } }, aktiv: (p) => p.startsWith("/buchhaltung") },
    ...(fondsId ? [{ id: "meldungen", label: t.nav.meldungen, icon: <PaperPlaneTiltIcon />, ziel: fonds("meldungen"), aktiv: (p: string) => p.endsWith("/meldungen") || p.startsWith("/meldungen/") }] : []),
    { id: "berichte", label: t.nav.berichte, icon: <ChartLineUpIcon />, ziel: { to: "/berichte", search: { fondsId } }, aktiv: (p) => p.startsWith("/berichte") },
  ];
  const daten: NavDefinition[] = [
    { id: "register", label: t.nav.register, icon: <ListMagnifyingGlassIcon />, ziel: { to: "/register" }, aktiv: (p) => p.startsWith("/register") },
    ...(ich && hatIrgendwoRolle(ich, "bearbeiter") ? [{ id: "import", label: t.nav.import, icon: <UploadSimpleIcon />, ziel: { to: "/import" } as NavigateOptions, aktiv: (p: string) => p.startsWith("/import") }] : []),
  ];
  const gruppen: NavGruppeDefinition[] = [
    {
      id: "uebersicht",
      label: "",
      items: [
        { id: "fonds", label: t.nav.fonds, icon: <BankIcon />, ziel: { to: "/fonds", search: {} }, aktiv: (p) => p === "/fonds" },
        {
          id: "portfolio",
          label: t.nav.portfolio,
          icon: <HouseIcon />,
          ziel: portfolio,
          aktiv: (p) => p === "/" || (p.startsWith("/fonds/") && !p.endsWith("/journal") && !p.endsWith("/meldungen")) || p.startsWith("/beteiligungen"),
        },
      ],
    },
    {
      id: "dealflow",
      label: t.nav.gruppen.dealflow,
      items: [
        { id: "dealflow", label: t.nav.dealflow, icon: <KanbanIcon />, ziel: { to: "/dealflow" }, aktiv: (p) => p.startsWith("/dealflow") || p.startsWith("/deals") },
        { id: "kontakte", label: t.nav.kontakte, icon: <AddressBookIcon />, ziel: { to: "/kontakte" }, aktiv: (p) => p.startsWith("/kontakte") || p.startsWith("/personen") || p.startsWith("/organisationen") },
      ],
    },
    { id: "finanzen", label: t.nav.gruppen.finanzen, items: finanzen },
    { id: "daten", label: t.nav.gruppen.daten, items: daten },
  ];
  // Bereiche ohne Recht (Rollen der Nutzergruppen) entfallen; die API lehnt sie ohnehin ab.
  return gruppen.map((g) => ({ ...g, items: g.items.filter((i) => hatBereich(ich, NAV_BEREICH[i.id] ?? (g.id === "finanzen" ? g.id : i.id))) })).filter((g) => g.items.length > 0);
}

/**
 * Bereich je Eintrag der Seitenleiste (Schlüssel wie `BEREICHE` der API), wo er nicht der Kennung des Eintrags entspricht (Portfolio, Dealflow,
 * Kontakte, Berichte) oder in der Gruppe Finanzen nicht `finanzen` ist. Leer: immer sichtbar.
 */
const NAV_BEREICH: Record<string, string> = { fonds: "", register: "kontakte", meldungen: "meldewesen", berichte: "berichte", import: "daten" };

export interface Brotkrume {
  label: string;
  ziel?: NavigateOptions;
}

/** Seiten unterhalb eines Bereichs, in der Reihenfolge der Prüfung (die längere Vorsilbe zuerst). */
const DETAILS: [RegExp, keyof Texte["nav"]["detail"]][] = [
  [/^\/beteiligungen\//, "beteiligung"],
  [/^\/organisationen\//, "organisation"],
  [/^\/deals\//, "deal"],
  [/^\/personen\//, "person"],
  [/^\/berichte\/vorlagen/, "vorlagen"],
  [/^\/berichte\/[^/]+/, "bericht"],
  [/^\/belege\/[^/]+/, "beleg"],
  [/^\/zinslaeufe\/[^/]+/, "zinslauf"],
  [/^\/meldungen\//, "meldelauf"],
  [/^\/import\/[^/]+/, "uebernahme"],
  [/^\/dokumente\//, "dokument"],
  [/^\/dealflow\/auswertung/, "auswertung"],
  [/^\/wiedervorlagen/, "wiedervorlagen"],
  [/^\/beschlussvorlagen/, "beschlussvorlagen"],
  [/^\/kontakte\/import/, "kontaktImport"],
  [/^\/fonds\/[^/]+\/kennzahlen/, "kennzahlen"],
  [/^\/fonds\/[^/]+\/szenarien/, "szenarien"],
  [/^\/fonds\/[^/]+\/reserven/, "reserven"],
  [/^\/fonds\/[^/]+\/zinsen/, "zinsen"],
  [/^\/fonds\/[^/]+\/bewertungsrunde/, "bewertungsrunde"],
];

/**
 * Pfad zur aktuellen Seite für die Kopfzeile: Gruppe, Bereich (mit Link, wenn die Seite darunter liegt) und die Art der Seite.
 * Der Name des Datensatzes steht im Titel der Seite, nicht hier.
 */
export function brotkruemel(t: Texte, pfad: string, gruppen: NavGruppeDefinition[]): Brotkrume[] {
  if (pfad.startsWith("/verwaltung/mail")) return [{ label: t.nav.verwaltung, ziel: { to: "/verwaltung" } }, { label: t.nav.mailversand }];
  if (pfad.startsWith("/verwaltung")) return [{ label: t.nav.verwaltung }];
  if (pfad.startsWith("/einstellungen")) return [{ label: t.nav.einstellungen }];
  for (const g of gruppen) {
    const eintrag = g.items.find((i) => i.aktiv(pfad));
    if (!eintrag) continue;
    const detail = DETAILS.find(([muster]) => muster.test(pfad))?.[1];
    // Reiter eines Fonds aus einer Erweiterung (z. B. ESG): Beschriftung aus dem Reiter.
    const zusatz = alle("fondsReiter").find((r) => pfad.startsWith("/fonds/") && pfad.split("/")[3] === r.pfad);
    const detailLabel = detail ? t.nav.detail[detail] : zusatz?.label(t);
    const kette: Brotkrume[] = [];
    if (g.label) kette.push({ label: g.label });
    if (detailLabel) {
      kette.push({ label: eintrag.label, ziel: eintrag.ziel }, { label: detailLabel });
    } else kette.push({ label: eintrag.label });
    return kette;
  }
  const detail = DETAILS.find(([muster]) => muster.test(pfad))?.[1];
  return detail ? [{ label: t.nav.detail[detail] }] : [];
}
