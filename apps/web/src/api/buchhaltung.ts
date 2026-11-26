import { buchhaltungsAufruf } from "./abbildung-buchhaltung";
import { queryOptions } from "@tanstack/react-query";
import { schluessel as abfrageSchluessel } from "./abfragen";
import { api, ladeMitSitzung } from "./client";
import { useApiMutation } from "./mutationen";
import { ausBerichteBereich } from "./abbildung-berichte";

const ausMeldewesen = ausBerichteBereich("reporting");

/** Belege und Buchhaltung (Etappe 14). Alle Abfragen liegen unter dem Präfix `buchhaltung`, damit eine Mutation sie gesammelt entwertet. */
const wurzel = ["buchhaltung"] as const;
const schl = {
  belege: [...wurzel, "belege"] as const,
  saldenlaeufe: [...wurzel, "saldenlaeufe"] as const,
  auswertung: [...wurzel, "auswertung"] as const,
  einstellungen: [...wurzel, "einstellungen"] as const,
  export: [...wurzel, "export"] as const,
};

export type BelegArt = "vertragsanlage" | "auszahlung" | "zinsbuchung" | "verkauf" | "wandlung" | "kapitalabruf" | "ausschuettung" | "frei";
export type BezugArt = "vorgang" | "zinslauf" | "verkauf" | "wandlung" | "beteiligung" | "fonds_bewegung";
/** Kategorie einer Mittelart für die Meldeberichte. */
export const MELDE_ARTEN = ["foerdermittel", "kofinanzierung", "eigenmittel", "rueckflussmittel"] as const;
export type MeldeArt = (typeof MELDE_ARTEN)[number];
export type Sicht = "bilanz" | "guv" | "liquiditaet" | "mittelherkunft" | "mittelverwendung" | "portfolio";
export const SICHTEN = ["bilanz", "guv", "liquiditaet", "mittelverwendung", "portfolio"] as const;

const ladeBelege = async (fondsId: string, status?: string) => (await buchhaltungsAufruf((en) => api.api.v1.vouchers.$get(en({ query: { fondsId, ...(status ? { status: status as "entwurf" | "geprueft" | "freigegeben" } : {}) } })))).daten;
const ladeBeleg = (id: string) => buchhaltungsAufruf((en) => api.api.v1.vouchers[":id"].$get(en({ param: { id } })));
const ladePerioden = async (fondsId: string) => (await buchhaltungsAufruf((en) => api.api.v1.funds[":id"].periods.$get(en({ param: { id: fondsId } })))).daten;
const ladeSaldenlaeufe = async (fondsId: string) => (await buchhaltungsAufruf((en) => api.api.v1.funds[":id"]["balance-runs"].$get(en({ param: { id: fondsId } })))).daten;
const ladeSaldenlauf = (id: string) => buchhaltungsAufruf((en) => api.api.v1["balance-runs"][":id"].$get(en({ param: { id } })));
const ladeAuswertung = (fondsId: string, sicht: (typeof SICHTEN)[number], bis: string) =>
  buchhaltungsAufruf((en) => api.api.v1.funds[":id"].evaluation[":view"].$get(en({ param: { id: fondsId, sicht }, query: { bis } })));
const ladeAbstimmung = (fondsId: string, bis: string) => buchhaltungsAufruf((en) => api.api.v1.funds[":id"].reconciliation.$get(en({ param: { id: fondsId }, query: { bis } })));
const ladeKonfig = (fondsId: string) => buchhaltungsAufruf((en) => api.api.v1.funds[":id"].accounting.$get(en({ param: { id: fondsId } })));
const ladeMittelarten = async (fondsId: string) => (await buchhaltungsAufruf((en) => api.api.v1.funds[":id"]["funding-sources"].$get(en({ param: { id: fondsId } })))).daten;
const ladeSchluessel = (beteiligungId: string) => buchhaltungsAufruf((en) => api.api.v1.investments[":id"]["accounting-keys"].$get(en({ param: { id: beteiligungId } })));
const ladeKonten = async (fondsId: string) => (await buchhaltungsAufruf((en) => api.api.v1.funds[":id"].accounts.$get(en({ param: { id: fondsId } })))).daten;
const ladeGliederung = async (fondsId: string) => (await buchhaltungsAufruf((en) => api.api.v1.funds[":id"].layout.$get(en({ param: { id: fondsId } })))).daten;
const ladeRegeln = async (fondsId: string) => (await buchhaltungsAufruf((en) => api.api.v1.funds[":id"]["account-rules"].$get(en({ param: { id: fondsId }, query: {} })))).daten;
const ladeVorlagen = async (fondsId: string) => (await buchhaltungsAufruf((en) => api.api.v1.funds[":id"]["voucher-templates"].$get(en({ param: { id: fondsId } })))).daten;
const ladeBuchungsregeln = async (fondsId: string) => (await buchhaltungsAufruf((en) => api.api.v1.funds[":id"]["posting-rules"].$get(en({ param: { id: fondsId } })))).daten;
const ladeExporte = async (fondsId: string) => (await buchhaltungsAufruf((en) => api.api.v1.funds[":id"]["posting-exports"].$get(en({ param: { id: fondsId } })))).daten;

export type BelegZeile = Awaited<ReturnType<typeof ladeBelege>>[number];
export type BelegDetail = Awaited<ReturnType<typeof ladeBeleg>>;
export type Periode = Awaited<ReturnType<typeof ladePerioden>>[number];
export type SaldenlaufZeile = Awaited<ReturnType<typeof ladeSaldenlaeufe>>[number];
export type SaldenlaufDetail = Awaited<ReturnType<typeof ladeSaldenlauf>>;
export type AuswertungDaten = Awaited<ReturnType<typeof ladeAuswertung>>;
export type AbstimmungDaten = Awaited<ReturnType<typeof ladeAbstimmung>>;
export type KonfigDaten = Awaited<ReturnType<typeof ladeKonfig>>;
export type Mittelart = Awaited<ReturnType<typeof ladeMittelarten>>[number];
export type BeteiligungSchluessel = Awaited<ReturnType<typeof ladeSchluessel>>;
export type Konto = Awaited<ReturnType<typeof ladeKonten>>[number];
export type GliederungPosition = Awaited<ReturnType<typeof ladeGliederung>>[number];
export type Kontenregel = Awaited<ReturnType<typeof ladeRegeln>>[number];
export type BelegVorlageDaten = Awaited<ReturnType<typeof ladeVorlagen>>[number];
export type Buchungsregel = Awaited<ReturnType<typeof ladeBuchungsregeln>>[number];
export type ExportZeile = Awaited<ReturnType<typeof ladeExporte>>[number];

export const belegListe = (fondsId: string, status?: string) => queryOptions({ queryKey: [...schl.belege, "liste", fondsId, status ?? null], queryFn: () => ladeBelege(fondsId, status) });
export const belegDetail = (id: string) => queryOptions({ queryKey: [...schl.belege, "detail", id], queryFn: () => ladeBeleg(id) });
export const perioden = (fondsId: string) => queryOptions({ queryKey: [...schl.saldenlaeufe, "perioden", fondsId], queryFn: () => ladePerioden(fondsId) });
export const saldenlaeufe = (fondsId: string) => queryOptions({ queryKey: [...schl.saldenlaeufe, "liste", fondsId], queryFn: () => ladeSaldenlaeufe(fondsId) });
export const saldenImLauf = (id: string) => queryOptions({ queryKey: [...schl.saldenlaeufe, "lauf", id, "salden"], queryFn: async () => (await buchhaltungsAufruf((en) => api.api.v1["balance-runs"][":id"].balances.$get(en({ param: { id } })))).daten });
export const saldenlauf = (id: string) => queryOptions({ queryKey: [...schl.saldenlaeufe, "lauf", id], queryFn: () => ladeSaldenlauf(id) });
export const auswertung = (fondsId: string, sicht: (typeof SICHTEN)[number], bis: string) => queryOptions({ queryKey: [...schl.auswertung, fondsId, sicht, bis], queryFn: () => ladeAuswertung(fondsId, sicht, bis) });
export const abstimmung = (fondsId: string, bis: string) => queryOptions({ queryKey: [...schl.auswertung, "abstimmung", fondsId, bis], queryFn: () => ladeAbstimmung(fondsId, bis) });
export const buchhaltungKonfig = (fondsId: string) => queryOptions({ queryKey: [...schl.einstellungen, "konfig", fondsId], queryFn: () => ladeKonfig(fondsId) });
export const mittelarten = (fondsId: string) => queryOptions({ queryKey: [...schl.einstellungen, "mittelarten", fondsId], queryFn: () => ladeMittelarten(fondsId) });
/** Förder- und Buchhaltungsschlüssel einer Beteiligung samt Sitzland und Region der Organisation. */
export const beteiligungSchluessel = (beteiligungId: string) => queryOptions({ queryKey: [...schl.einstellungen, "schluessel", beteiligungId], queryFn: () => ladeSchluessel(beteiligungId) });
/** Sitzland und Region einer Organisation (Meldeberichte); die Bearbeitung der Organisation zeigt sie neben dem NACE-Abschnitt. */
export const organisationMeldedaten = (organisationId: string) =>
  queryOptions({ queryKey: [...schl.einstellungen, "meldedaten", organisationId], queryFn: () => ausMeldewesen(api.api.v1.organizations[":id"]["reporting-data"].$get, { param: { id: organisationId } }) });
export const konten = (fondsId: string) => queryOptions({ queryKey: [...schl.einstellungen, "konten", fondsId], queryFn: () => ladeKonten(fondsId) });
export const gliederung = (fondsId: string) => queryOptions({ queryKey: [...schl.einstellungen, "gliederung", fondsId], queryFn: () => ladeGliederung(fondsId) });
export const kontenregeln = (fondsId: string) => queryOptions({ queryKey: [...schl.einstellungen, "regeln", fondsId], queryFn: () => ladeRegeln(fondsId) });
export const belegvorlagen = (fondsId: string) => queryOptions({ queryKey: [...schl.einstellungen, "vorlagen", fondsId], queryFn: () => ladeVorlagen(fondsId) });
/** Kontenzuordnung des DATEV-Exports je Vorgangs- und Bewegungsart. */
export const buchungsregeln = (fondsId: string) => queryOptions({ queryKey: [...schl.einstellungen, "buchungsregeln", fondsId], queryFn: () => ladeBuchungsregeln(fondsId) });
export const buchungsexporte = (fondsId: string) => queryOptions({ queryKey: [...schl.export, "liste", fondsId], queryFn: () => ladeExporte(fondsId) });

/** Pfade der Downloads (normale Links; Cookie und Rechte prüft die API). */
export const belegDateiUrl = (id: string) => `/api/v1/vouchers/${id}/file`;
const ansichten = { bilanz: "balance_sheet", guv: "income_statement", liquiditaet: "liquidity", mittelverwendung: "use_of_funds", portfolio: "portfolio" } as const;
export const auswertungDateiUrl = (fondsId: string, sicht: keyof typeof ansichten, bis: string, format: "pdf" | "xlsx", sprache: "de" | "en") =>
  `/api/v1/funds/${fondsId}/evaluation/${ansichten[sicht]}/file?to=${bis}&format=${format}&language=${sprache}`;
export const exportDateiUrl = (id: string) => `/api/v1/posting-exports/${id}/file`;

// Mutationen -------------------------------------------------------------------------------------------------------------

export const useBelegErzeugen = () =>
  useApiMutation({
    aufruf: (json: { art: BelegArt; eigeneArtId?: string; werte?: Record<string, string>; bezugArt: BezugArt; bezugId: string; sprache: "de" | "en" }) => buchhaltungsAufruf((en) => api.api.v1.vouchers.$post(en({ json }))),
    invalidiert: () => [schl.belege],
  });

export const useBelegFeldwerte = (id: string) =>
  useApiMutation({
    aufruf: (werte: Record<string, string>) => buchhaltungsAufruf((en) => api.api.v1.vouchers[":id"]["field-values"].$patch(en({ param: { id }, json: { werte } }))),
    invalidiert: () => [schl.belege],
  });

export const useBelegStufe = (id: string) =>
  useApiMutation({
    aufruf: (json: { stufe: "Prüfung" | "Freigabe"; ergebnis: "ok" | "zurueck"; kommentar?: string }) => buchhaltungsAufruf((en) => api.api.v1.vouchers[":id"].stage.$post(en({ param: { id }, json }))),
    invalidiert: () => [schl.belege],
  });

/** Storniert einen freigegebenen Beleg (Freigeber, Grund ist Pflicht); die Nummer bleibt vergeben, die Datei bleibt erhalten. */
export const useBelegStornieren = (id: string) =>
  useApiMutation({
    aufruf: (json: { grund: string }) => buchhaltungsAufruf((en) => api.api.v1.vouchers[":id"].reverse.$post(en({ param: { id }, json }))),
    invalidiert: () => [schl.belege, schl.auswertung, schl.export],
  });

export const useBelegNeuBefuellen = (id: string) =>
  useApiMutation({
    aufruf: () => buchhaltungsAufruf((en) => api.api.v1.vouchers[":id"].refill.$post(en({ param: { id } }))),
    invalidiert: () => [schl.belege],
  });

/** Lädt die Saldenliste als multipart hoch (Felder `file`, `periodFrom`, `periodTo`). */
export const useSaldenlaufHochladen = (fondsId: string) =>
  useApiMutation({
    aufruf: ({ datei, von, bis }: { datei: File; von: string; bis: string }) => {
      const formular = new FormData();
      formular.append("file", datei);
      formular.append("periodFrom", von);
      formular.append("periodTo", bis);
      return buchhaltungsAufruf(() => ladeMitSitzung(`${window.location.origin}/api/v1/funds/${fondsId}/balance-runs`, { method: "POST", body: formular })) as Promise<SaldenlaufZeile>;
    },
    invalidiert: () => [schl.saldenlaeufe],
  });

export const useSaldenlaufPruefen = (id: string) =>
  useApiMutation({
    aufruf: () => buchhaltungsAufruf((en) => api.api.v1["balance-runs"][":id"].validate.$post(en({ param: { id } }))),
    invalidiert: () => [schl.saldenlaeufe],
  });

export const useSaldenlaufUebernehmen = (id: string) =>
  useApiMutation({
    aufruf: () => buchhaltungsAufruf((en) => api.api.v1["balance-runs"][":id"].apply.$post(en({ param: { id } }))),
    invalidiert: () => [schl.saldenlaeufe, schl.auswertung, abfrageSchluessel.fonds, abfrageSchluessel.berichte, ["waehrung"]],
  });

/** Was exportiert wird: ein gebuchter Zinslauf oder ausgewählte Fondsbewegungen (Abruf, Ausschüttung). */
export interface ExportAuswahl {
  zinslaufId?: string;
  /** Einzelne Vorgänge (freie Auswahl); zusammen mit `fondsBewegungIds` möglich. */
  vorgangIds?: string[];
  fondsBewegungIds?: string[];
  wiederholung: boolean;
}

export const useExportVorschau = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: ExportAuswahl) => buchhaltungsAufruf((en) => api.api.v1.funds[":id"]["posting-exports"].preview.$post(en({ param: { id: fondsId }, json }))),
    invalidiert: () => [],
  });

export const useExportErstellen = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: ExportAuswahl & { grund?: string }) => buchhaltungsAufruf((en) => api.api.v1.funds[":id"]["posting-exports"].$post(en({ param: { id: fondsId }, json }))),
    // Auch das Journal: Die Auswahl der Buchungen zeigt dort „exportiert am“ und blendet Exportiertes aus.
    invalidiert: () => [schl.export, [...abfrageSchluessel.fonds, fondsId, "journal"]],
  });

export interface KonfigEingabe {
  beraternummer: number | null;
  mandantennummer: number | null;
  wirtschaftsjahrBeginn: number;
  sachkontenlaenge: number;
  belegpraefix: string;
}
export const useKonfigSetzen = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: KonfigEingabe) => buchhaltungsAufruf((en) => api.api.v1.funds[":id"].accounting.$put(en({ param: { id: fondsId }, json }))),
    invalidiert: () => [schl.einstellungen],
  });

export const useMittelartenSetzen = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: { gueltigAb: string; mittelarten: { schluessel: string; bezeichnungDe: string; bezeichnungEn: string; quote: string; meldeArt: MeldeArt | null }[] }) => buchhaltungsAufruf((en) => api.api.v1.funds[":id"]["funding-sources"].$put(en({ param: { id: fondsId }, json }))),
    invalidiert: () => [schl.einstellungen],
  });

export const useStandardgliederung = (fondsId: string) =>
  useApiMutation({
    aufruf: () => buchhaltungsAufruf((en) => api.api.v1.funds[":id"].layout.standard.$post(en({ param: { id: fondsId } }))),
    invalidiert: () => [schl.einstellungen],
  });

export const useRegelAnlegen = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: { sicht: (typeof SICHTEN)[number]; kontoVon: string; kontoBis?: string; positionSchluessel: string; gueltigAb: string }) => buchhaltungsAufruf((en) => api.api.v1.funds[":id"]["account-rules"].$post(en({ param: { id: fondsId }, json }))),
    invalidiert: () => [schl.einstellungen, schl.auswertung],
  });

/** `art`: Name einer festen Belegart oder Id einer eigenen. */
export const useVorlageSetzen = (fondsId: string, art: string) =>
  useApiMutation({
    aufruf: (json: { felder: BelegVorlageDaten["felder"]; kopfDe: string; kopfEn: string; fussDe: string; fussEn: string }) =>
      buchhaltungsAufruf((en) => api.api.v1.funds[":id"]["voucher-templates"][":type"].$put(en({ param: { id: fondsId, art }, json }))),
    invalidiert: () => [schl.einstellungen],
  });

/** Eigene Belegarten: anlegen, Name und Stilllegung ändern, löschen. Die Vorlagenliste und die Belegliste ändern sich mit. */
export const useBelegartAnlegen = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: { basisArt: BelegArt; bezeichnungDe: string; bezeichnungEn: string }) => buchhaltungsAufruf((en) => api.api.v1.funds[":id"]["voucher-types"].$post(en({ param: { id: fondsId }, json }))),
    invalidiert: () => [schl.einstellungen],
  });
export const useBelegartAendern = (fondsId: string, artId: string) =>
  useApiMutation({
    aufruf: (json: { bezeichnungDe: string; bezeichnungEn: string; aktiv: boolean }) => buchhaltungsAufruf((en) => api.api.v1.funds[":id"]["voucher-types"][":typeId"].$put(en({ param: { id: fondsId, artId }, json }))),
    invalidiert: () => [schl.einstellungen, schl.belege],
  });
export const useBelegartLoeschen = (fondsId: string, artId: string) =>
  useApiMutation({
    aufruf: () => buchhaltungsAufruf((en) => api.api.v1.funds[":id"]["voucher-types"][":typeId"].$delete(en({ param: { id: fondsId, artId } }))),
    invalidiert: () => [schl.einstellungen],
  });

export interface SchluesselEingabe {
  projektnummer: string | null;
  vertragsnummer: string | null;
  partnernummer: string | null;
  buchungskreis: string | null;
  /** Schlüssel des Förderprogramms. */
  foerderprogramm: string | null;
}
/** Speichert die Schlüssel der Beteiligung; Förderprogramm, Meldedaten und Meldeläufe lesen sie von dort. */
export const useSchluesselSetzen = (beteiligungId: string) =>
  useApiMutation({
    aufruf: (json: SchluesselEingabe) => buchhaltungsAufruf((en) => api.api.v1.investments[":id"]["accounting-keys"].$put(en({ param: { id: beteiligungId }, json }))),
    invalidiert: () => [schl.einstellungen, schl.belege, ["melde"]],
  });
/** Sitzland (ISO 3166-1) und Region eines Unternehmens für die Meldeberichte. */
export const useMeldedatenSetzen = (organisationId: string) =>
  useApiMutation({
    aufruf: (json: { sitzland: string | null; region: string | null }) => ausMeldewesen(api.api.v1.organizations[":id"]["reporting-data"].$put, { param: { id: organisationId }, json }),
    invalidiert: () => [schl.einstellungen, ["melde"]],
  });

/** Quellen der Kontenzuordnung des Exports (Vorgangsarten und Bewegungsarten des Fonds). */
export const BUCHUNGSQUELLEN = ["zins", "auszahlung", "rueckfluss", "tilgung", "zusage", "wertberichtigung", "abruf", "ausschuettung", "zinszahlung", "dividende", "impairment_disposal", "principal_disposal", "principal_waiver", "interest_waiver"] as const;
export type Buchungsquelle = (typeof BUCHUNGSQUELLEN)[number];
export type SachkontoArt = "aktiv" | "passiv" | "aufwand" | "ertrag";
export const SACHKONTOARTEN: readonly SachkontoArt[] = ["aktiv", "passiv", "aufwand", "ertrag"];

export interface BuchungsregelEingabe {
  konto: string;
  gegenkonto: string;
  richtung: "S" | "H";
  buSchluessel: string | null;
  buchungstext: string;
}
export const useBuchungsregelSetzen = (fondsId: string, quelle: Buchungsquelle) =>
  useApiMutation({
    aufruf: (json: BuchungsregelEingabe) => buchhaltungsAufruf((en) => api.api.v1.funds[":id"]["posting-rules"][":source"].$put(en({ param: { id: fondsId, quelle }, json }))),
    invalidiert: () => [schl.einstellungen],
  });

export interface KontoEingabe {
  nummer: string;
  bezeichnung: string;
  art: SachkontoArt;
  beteiligungId: string | null;
}
/** Legt ein Konto an oder ändert es (Schlüssel ist die Kontonummer). */
export const useKontoSetzen = (fondsId: string) =>
  useApiMutation({
    aufruf: (konto: KontoEingabe) => buchhaltungsAufruf((en) => api.api.v1.funds[":id"].accounts.$put(en({ param: { id: fondsId }, json: { konten: [konto] } }))),
    invalidiert: () => [schl.einstellungen, schl.auswertung],
  });
export const useKontoEntfernen = (fondsId: string) =>
  useApiMutation({
    aufruf: (nummer: string) => buchhaltungsAufruf((en) => api.api.v1.funds[":id"].accounts[":accountNumber"].$delete(en({ param: { id: fondsId, nummer } }))),
    invalidiert: () => [schl.einstellungen, schl.auswertung],
  });

export interface GliederungEingabe {
  schluessel: string;
  elternSchluessel: string | null;
  bezeichnungDe: string;
  bezeichnungEn: string;
  seite: "soll" | "haben";
}
/** Ersetzt die Positionen einer Sicht; die Reihenfolge der Liste ist die Reihenfolge der Gliederung. */
export const useGliederungSetzen = (fondsId: string, sicht: (typeof SICHTEN)[number]) =>
  useApiMutation({
    aufruf: (positionen: GliederungEingabe[]) => buchhaltungsAufruf((en) => api.api.v1.funds[":id"].layout[":view"].$put(en({ param: { id: fondsId, sicht }, json: { positionen } }))),
    invalidiert: () => [schl.einstellungen, schl.auswertung],
  });
