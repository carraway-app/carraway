import type { ReactNode } from "react";
import type { NavigateOptions } from "@tanstack/react-router";
import {
  AddressBookIcon,
  BankIcon,
  BookOpenIcon,
  CalculatorIcon,
  ChartLineUpIcon,
  ChartPieSliceIcon,
  FileTextIcon,
  HouseIcon,
  KanbanIcon,
  ListMagnifyingGlassIcon,
  PaperPlaneTiltIcon,
  PercentIcon,
  ReceiptIcon,
  ScalesIcon,
  StackIcon,
  UploadSimpleIcon,
  UsersIcon,
} from "@carraway/ui";
import { alle } from "../erweiterung";
import type { Ich } from "../api/anmeldung";
import type { Texte } from "../i18n";
import { hatBereich, hatIrgendwoRolle } from "../lib/rechte";

/** Wo die Person gerade ist: Pfad und der Reiter (`tab`) aus der Adresse. */
export interface Ort {
  pfad: string;
  tab?: string | undefined;
}

/** Ein Eintrag der Seitenleiste: wohin er führt, wann er aktiv ist und welches Zeichen er trägt. */
export interface NavDefinition {
  id: string;
  label: string;
  icon: ReactNode;
  ziel: NavigateOptions;
  aktiv: (ort: Ort) => boolean;
  /** Anzahl hinter dem Namen (zum Beispiel Dokumente). */
  zaehler?: number | undefined;
  /** Reiter des Ortes (für die Suche: „Planung · Reserven“). */
  reiter?: { id: string; label: string; ziel: NavigateOptions }[] | undefined;
}

export interface NavGruppeDefinition {
  id: string;
  /** Leer: Gruppe ohne Kopf (nicht einklappbar). */
  label: string;
  items: NavDefinition[];
}

export interface Brotkrume {
  label: string;
  ziel?: NavigateOptions;
}

/**
 * Kontext der Seitenleiste: global, im Fonds oder im Objekt (Beteiligung, Deal, Organisation, Person). Im Fonds und im Objekt
 * steht oben ein Rückweg und der Kopf des Kontexts mit Umschalter; die Einträge sind die Orte dieses Kontexts.
 */
export interface Kontext {
  art: "global" | "fonds" | "objekt";
  zurueck?: { label: string; ziel: NavigateOptions };
  kopf?: { titel: string; untertitel?: string | undefined; titelSprache?: string | undefined; umschalter?: { label: string; aktuell: string; optionen: { id: string; label: string; ziel: NavigateOptions }[] } | undefined };
  gruppen: NavGruppeDefinition[];
  /** Brotkrumen vor dem aktiven Eintrag (zum Beispiel „Fonds / Beispielfonds I“). */
  pfad: Brotkrume[];
}

/**
 * Bereich je Eintrag der Seitenleiste (Schlüssel wie `BEREICHE` der API). Leer: immer sichtbar. Wer den Bereich nicht hat, sieht den Eintrag
 * nicht; die API lehnt ihn ohnehin ab.
 */
const NAV_BEREICH: Record<string, string> = {
  fonds: "",
  dashboard: "portfolio",
  dealflow: "dealflow",
  kontakte: "kontakte",
  register: "kontakte",
  import: "daten",
  uebersicht: "portfolio",
  kennzahlen: "kennzahlen",
  planung: "portfolio",
  bewertungsrunde: "portfolio",
  zielfonds: "portfolio",
  investoren: "finanzen",
  journal: "finanzen",
  belege: "finanzen",
  zinsen: "finanzen",
  buchhaltung: "finanzen",
  meldungen: "meldewesen",
  berichte: "berichte",
  stammdaten: "",
  dokumente: "dokumente",
};

const sichtbar = (ich: Ich | undefined, gruppen: NavGruppeDefinition[]) =>
  gruppen
    .map((g) => ({ ...g, items: g.items.filter((i) => hatBereich(ich, NAV_BEREICH[i.id] ?? alle("fondsReiter").find((r) => r.id === i.id)?.bereich)) }))
    .filter((g) => g.items.length > 0);

/** Globale Leiste: Fonds, Dashboard, Dealflow und Kontakte, Daten. Die Bereiche eines Fonds stehen im Fondskontext, Verwaltung und Einstellungen im Kontomenü. */
export function globaleNavigation(t: Texte, ich: Ich | undefined): NavGruppeDefinition[] {
  return sichtbar(ich, [
    {
      id: "uebersicht",
      label: "",
      items: [
        { id: "fonds", label: t.nav.fonds, icon: <BankIcon />, ziel: { to: "/funds", search: {} }, aktiv: ({ pfad }) => pfad === "/funds" || pfad.startsWith("/funds/") || pfad === "/" },
        { id: "dashboard", label: t.nav.dashboard, icon: <ChartPieSliceIcon />, ziel: { to: "/portfolio", search: {} }, aktiv: ({ pfad }) => pfad === "/portfolio" },
      ],
    },
    {
      id: "dealflow",
      label: t.nav.gruppen.dealflow,
      items: [
        {
          id: "dealflow",
          label: t.nav.dealflow,
          icon: <KanbanIcon />,
          ziel: { to: "/dealflow" },
          aktiv: ({ pfad }) => pfad.startsWith("/dealflow") || pfad.startsWith("/deals") || pfad.startsWith("/decision-proposals"),
          reiter: [
            { id: "pipeline", label: t.nav.reiter.pipeline, ziel: { to: "/dealflow", search: {} } },
            { id: "meine", label: t.nav.reiter.meineDeals, ziel: { to: "/dealflow", search: { bereich: "meine" } } },
            { id: "eingang", label: t.nav.reiter.ohneZuordnung, ziel: { to: "/dealflow", search: { bereich: "eingang" } } },
            { id: "beschluesse", label: t.nav.detail.beschlussvorlagen, ziel: { to: "/decision-proposals", search: {} } },
            { id: "auswertung", label: t.nav.detail.auswertung, ziel: { to: "/dealflow/analytics", search: {} } },
          ],
        },
        {
          id: "kontakte",
          label: t.nav.kontakte,
          icon: <AddressBookIcon />,
          ziel: { to: "/contacts" },
          aktiv: ({ pfad }) => pfad.startsWith("/contacts") || pfad.startsWith("/people") || pfad.startsWith("/organizations") || pfad.startsWith("/follow-ups"),
          reiter: [
            { id: "unternehmen", label: t.nav.reiter.unternehmen, ziel: { to: "/contacts", search: {} } },
            { id: "personen", label: t.nav.reiter.personen, ziel: { to: "/contacts", search: { objekt: "person" } } },
            ...(hatBereich(ich, "dealflow") ? [{ id: "deals", label: t.nav.reiter.deals, ziel: { to: "/contacts", search: { objekt: "deal" } } as NavigateOptions }] : []),
            { id: "heute", label: t.nav.reiter.heute, ziel: { to: "/contacts", search: { objekt: "heute" } } },
          ],
        },
      ],
    },
    {
      id: "daten",
      label: t.nav.gruppen.daten,
      items: [
        { id: "register", label: t.nav.register, icon: <ListMagnifyingGlassIcon />, ziel: { to: "/register" }, aktiv: ({ pfad }) => pfad.startsWith("/register") },
        ...(ich && hatIrgendwoRolle(ich, "bearbeiter") ? [{ id: "import", label: t.nav.import, icon: <UploadSimpleIcon />, ziel: { to: "/import" } as NavigateOptions, aktiv: ({ pfad }: Ort) => pfad.startsWith("/import") }] : []),
      ],
    },
  ]);
}

/** Reiter der Fondsverwaltung (`/funds?fundId=…&tab=…`), die zum Eintrag „Investoren“ bzw. „Dokumente“ gehören; alle übrigen zu „Stammdaten“. */
export const FONDS_KAPITAL_TABS = ["kapital", "investoren"] as const;

/**
 * Leiste im Fonds: Portfolio, Kapital, Finanzen, Fonds (höchstens etwa 14 Einträge). Die Finanzbereiche hängen am Fonds und stehen deshalb
 * hier; ihre Seiten behalten ihre Adressen (`/vouchers?fundId=…`). Ohne Recht auf das Portfolio des Fonds entfallen dessen Einträge.
 */
export function fondsNavigation(t: Texte, ich: Ich | undefined, fondsId: string, darfPortfolio: boolean): NavGruppeDefinition[] {
  const fp = (unter: string): NavigateOptions => ({ to: `/funds/$fundId/${unter}` as never, params: { fundId: fondsId } as never, search: {} as never });
  const imFonds = (pfad: string, unter: string) => new RegExp(`^/funds/[^/]+/${unter}(/|$)`).test(pfad);
  const verwaltung = (tab?: string): NavigateOptions => ({ to: "/funds", search: { fondsId, ...(tab ? { tab } : {}) } });
  const inVerwaltung = (ort: Ort) => ort.pfad === "/funds";
  const zusatz = alle("fondsReiter");
  const portfolio: NavDefinition[] = darfPortfolio
    ? [
        { id: "uebersicht", label: t.fondsTabs.uebersicht, icon: <HouseIcon />, ziel: { to: "/funds/$fundId", params: { fundId: fondsId }, search: {} }, aktiv: ({ pfad }) => /^\/funds\/[^/]+\/?$/.test(pfad) || imFonds(pfad, "capital-source") },
        { id: "kennzahlen", label: t.fondsTabs.kennzahlen, icon: <ChartLineUpIcon />, ziel: fp("metrics"), aktiv: ({ pfad }) => imFonds(pfad, "metrics") },
        ...zusatz.map((r) => ({ id: r.id, label: r.label(t), icon: <ChartLineUpIcon />, ziel: fp(r.pfad), aktiv: ({ pfad }: Ort) => imFonds(pfad, r.pfad) })),
        { id: "planung", label: t.nav.planung, icon: <ChartPieSliceIcon />, ziel: fp("scenarios"), aktiv: ({ pfad }) => imFonds(pfad, "scenarios") || imFonds(pfad, "reserves"), reiter: [{ id: "szenarien", label: t.fondsTabs.szenarien, ziel: fp("scenarios") }, { id: "reserven", label: t.fondsTabs.reserven, ziel: fp("reserves") }] },
        { id: "bewertungsrunde", label: t.fondsTabs.bewertungsrunde, icon: <ScalesIcon />, ziel: fp("valuation-round"), aktiv: ({ pfad }) => imFonds(pfad, "valuation-round") },
        { id: "zielfonds", label: t.fondsTabs.zielfonds, icon: <StackIcon />, ziel: fp("target-funds"), aktiv: ({ pfad }) => imFonds(pfad, "target-funds") },
      ]
    : [];
  return sichtbar(ich, [
    { id: "portfolio", label: t.nav.gruppen.portfolio, items: portfolio },
    {
      id: "kapital",
      label: t.nav.gruppen.kapital,
      items: [{ id: "investoren", label: t.nav.investoren, icon: <UsersIcon />, ziel: verwaltung("kapital"), aktiv: (ort) => inVerwaltung(ort) && FONDS_KAPITAL_TABS.includes(ort.tab as never), reiter: [{ id: "kapital", label: t.nav.reiter.kapital, ziel: verwaltung("kapital") }, { id: "investoren", label: t.nav.reiter.zugaenge, ziel: verwaltung("investoren") }] }],
    },
    {
      id: "finanzen",
      label: t.nav.gruppen.finanzen,
      items: [
        { id: "journal", label: t.nav.journal, icon: <BookOpenIcon />, ziel: fp("journal"), aktiv: ({ pfad }) => imFonds(pfad, "journal") },
        { id: "belege", label: t.nav.belege, icon: <ReceiptIcon />, ziel: { to: "/vouchers", search: { fondsId } }, aktiv: ({ pfad }) => pfad.startsWith("/vouchers") },
        { id: "zinsen", label: t.nav.zinsen, icon: <PercentIcon />, ziel: { to: "/interest-runs", search: { fondsId } }, aktiv: ({ pfad }) => pfad.startsWith("/interest-runs") || imFonds(pfad, "interest"), reiter: darfPortfolio ? [{ id: "zinslaeufe", label: t.nav.zinslaeufe, ziel: { to: "/interest-runs", search: { fondsId } } }, { id: "zinsstand", label: t.nav.zinsstand, ziel: fp("interest") }] : undefined },
        {
          id: "buchhaltung",
          label: t.nav.buchhaltung,
          icon: <CalculatorIcon />,
          ziel: { to: "/accounting", search: { fondsId } },
          aktiv: ({ pfad }) => pfad.startsWith("/accounting"),
          reiter: (["saldenlisten", "export", "auswertung", "einstellungen"] as const).map((id) => ({
            id,
            label: t.nav.reiter[id === "export" ? "buchungsexport" : id === "auswertung" ? "auswertungen" : id],
            ziel: { to: "/accounting", search: { fondsId, ...(id === "saldenlisten" ? {} : { tab: id }) } } as NavigateOptions,
          })),
        },
        { id: "meldungen", label: t.nav.meldungen, icon: <PaperPlaneTiltIcon />, ziel: fp("filings"), aktiv: ({ pfad }) => imFonds(pfad, "filings") || pfad.startsWith("/filings/") },
        { id: "berichte", label: t.nav.berichte, icon: <ChartLineUpIcon />, ziel: { to: "/reports", search: { fondsId } }, aktiv: ({ pfad }) => pfad.startsWith("/reports") },
      ],
    },
    {
      id: "fonds",
      label: t.nav.gruppen.fonds,
      items: [
        { id: "stammdaten", label: t.nav.stammdaten, icon: <BankIcon />, ziel: verwaltung(), aktiv: (ort) => inVerwaltung(ort) && !FONDS_KAPITAL_TABS.includes(ort.tab as never) && ort.tab !== "dokumente" },
        { id: "dokumente", label: t.nav.dokumente, icon: <FileTextIcon />, ziel: verwaltung("dokumente"), aktiv: (ort) => inVerwaltung(ort) && ort.tab === "dokumente" },
      ],
    },
  ]);
}

/** Seiten unterhalb eines Eintrags, in der Reihenfolge der Prüfung (die längere Vorsilbe zuerst). */
const DETAILS: [RegExp, keyof Texte["nav"]["detail"]][] = [
  [/^\/organizations\//, "organisation"],
  [/^\/deals\//, "deal"],
  [/^\/people\//, "person"],
  [/^\/reports\/templates/, "vorlagen"],
  [/^\/reports\/[^/]+/, "bericht"],
  [/^\/vouchers\/[^/]+/, "beleg"],
  [/^\/interest-runs\/[^/]+/, "zinslauf"],
  [/^\/filings\//, "meldelauf"],
  [/^\/import\/[^/]+/, "uebernahme"],
  [/^\/documents\//, "dokument"],
  [/^\/dealflow\/analytics/, "auswertung"],
  [/^\/follow-ups/, "wiedervorlagen"],
  [/^\/decision-proposals/, "beschlussvorlagen"],
  [/^\/contacts\/import/, "kontaktImport"],
  [/^\/funds\/[^/]+\/reserves/, "reserven"],
  [/^\/funds\/[^/]+\/interest/, "zinsen"],
];

/**
 * Pfad zur aktuellen Seite für die Kopfzeile: der Pfad des Kontexts (im Fonds „Fonds / Name“), der aktive Eintrag (mit Link, wenn die Seite
 * darunter liegt) und die Art der Seite. Der Name des Datensatzes steht im Titel der Seite.
 */
export function brotkruemel(t: Texte, ort: Ort, kontext: Kontext): Brotkrume[] {
  if (ort.pfad.startsWith("/administration")) return [{ label: t.nav.verwaltung }];
  if (ort.pfad.startsWith("/settings")) return [{ label: t.nav.einstellungen }];
  const kette: Brotkrume[] = [...kontext.pfad];
  for (const g of kontext.gruppen) {
    const eintrag = g.items.find((i) => i.aktiv(ort));
    if (!eintrag) continue;
    // Im Objekt nennt der Pfad das Objekt schon; dahinter steht nur noch der aktive Ort.
    const detail = kontext.art === "objekt" ? undefined : DETAILS.find(([muster]) => muster.test(ort.pfad))?.[1];
    if (kontext.art === "global" && g.label) kette.push({ label: g.label });
    if (detail) kette.push({ label: eintrag.label, ziel: eintrag.ziel }, { label: t.nav.detail[detail] });
    else kette.push({ label: eintrag.label });
    return kette;
  }
  const detail = DETAILS.find(([muster]) => muster.test(ort.pfad))?.[1];
  return detail ? [...kette, { label: t.nav.detail[detail] }] : kette;
}

/**
 * Ziele der Leiste und ihrer Reiter als flache Liste für die Suche (⌘K), mit dem Zusammenhang im Namen („Finanzen · Belege“,
 * „Planung · Reserven“); keine Aktionen.
 */
export function leistenZiele(kontext: Kontext): { schluessel: string; label: string; ziel: NavigateOptions }[] {
  const vor = kontext.kopf?.titel ? `${kontext.kopf.titel} · ` : "";
  return kontext.gruppen.flatMap((g) =>
    g.items.flatMap((i) => [
      { schluessel: `${kontext.art}-${i.id}`, label: `${vor}${g.label ? `${g.label} · ` : ""}${i.label}`, ziel: i.ziel },
      ...(i.reiter ?? []).map((r) => ({ schluessel: `${kontext.art}-${i.id}-${r.id}`, label: `${vor}${i.label} · ${r.label}`, ziel: r.ziel })),
    ]),
  );
}
