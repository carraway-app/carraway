import { queryOptions } from "@tanstack/react-query";
import { schluessel as abfrageSchluessel } from "./abfragen";
import { api, auspacken, ladeMitSitzung } from "./client";
import { useApiMutation } from "./mutationen";

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

const ladeBelege = async (fondsId: string, status?: string) => (await auspacken(api.api.v1.belege.$get({ query: { fondsId, ...(status ? { status: status as "entwurf" | "geprueft" | "freigegeben" } : {}) } }))).daten;
const ladeBeleg = (id: string) => auspacken(api.api.v1.belege[":id"].$get({ param: { id } }));
const ladePerioden = async (fondsId: string) => (await auspacken(api.api.v1.fonds[":id"].perioden.$get({ param: { id: fondsId } }))).daten;
const ladeSaldenlaeufe = async (fondsId: string) => (await auspacken(api.api.v1.fonds[":id"].saldenlaeufe.$get({ param: { id: fondsId } }))).daten;
const ladeSaldenlauf = (id: string) => auspacken(api.api.v1.saldenlaeufe[":id"].$get({ param: { id } }));
const ladeAuswertung = (fondsId: string, sicht: (typeof SICHTEN)[number], bis: string) =>
  auspacken(api.api.v1.fonds[":id"].auswertung[":sicht"].$get({ param: { id: fondsId, sicht }, query: { bis } }));
const ladeAbstimmung = (fondsId: string, bis: string) => auspacken(api.api.v1.fonds[":id"].abstimmung.$get({ param: { id: fondsId }, query: { bis } }));
const ladeKonfig = (fondsId: string) => auspacken(api.api.v1.fonds[":id"].buchhaltung.$get({ param: { id: fondsId } }));
const ladeMittelarten = async (fondsId: string) => (await auspacken(api.api.v1.fonds[":id"].mittelarten.$get({ param: { id: fondsId } }))).daten;
const ladeSchluessel = (beteiligungId: string) => auspacken(api.api.v1.beteiligungen[":id"].buchhaltungsschluessel.$get({ param: { id: beteiligungId } }));
const ladeKonten = async (fondsId: string) => (await auspacken(api.api.v1.fonds[":id"].konten.$get({ param: { id: fondsId } }))).daten;
const ladeGliederung = async (fondsId: string) => (await auspacken(api.api.v1.fonds[":id"].gliederung.$get({ param: { id: fondsId } }))).daten;
const ladeRegeln = async (fondsId: string) => (await auspacken(api.api.v1.fonds[":id"].kontenregeln.$get({ param: { id: fondsId }, query: {} }))).daten;
const ladeVorlagen = async (fondsId: string) => (await auspacken(api.api.v1.fonds[":id"].belegvorlagen.$get({ param: { id: fondsId } }))).daten;
const ladeBuchungsregeln = async (fondsId: string) => (await auspacken(api.api.v1.fonds[":id"].buchungsregeln.$get({ param: { id: fondsId } }))).daten;
const ladeExporte = async (fondsId: string) => (await auspacken(api.api.v1.fonds[":id"].buchungsexporte.$get({ param: { id: fondsId } }))).daten;

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
export const saldenImLauf = (id: string) => queryOptions({ queryKey: [...schl.saldenlaeufe, "lauf", id, "salden"], queryFn: async () => (await auspacken(api.api.v1.saldenlaeufe[":id"].salden.$get({ param: { id } }))).daten });
export const saldenlauf = (id: string) => queryOptions({ queryKey: [...schl.saldenlaeufe, "lauf", id], queryFn: () => ladeSaldenlauf(id) });
export const auswertung = (fondsId: string, sicht: (typeof SICHTEN)[number], bis: string) => queryOptions({ queryKey: [...schl.auswertung, fondsId, sicht, bis], queryFn: () => ladeAuswertung(fondsId, sicht, bis) });
export const abstimmung = (fondsId: string, bis: string) => queryOptions({ queryKey: [...schl.auswertung, "abstimmung", fondsId, bis], queryFn: () => ladeAbstimmung(fondsId, bis) });
export const buchhaltungKonfig = (fondsId: string) => queryOptions({ queryKey: [...schl.einstellungen, "konfig", fondsId], queryFn: () => ladeKonfig(fondsId) });
export const mittelarten = (fondsId: string) => queryOptions({ queryKey: [...schl.einstellungen, "mittelarten", fondsId], queryFn: () => ladeMittelarten(fondsId) });
/** Förder- und Buchhaltungsschlüssel einer Beteiligung samt Sitzland und Region der Organisation. */
export const beteiligungSchluessel = (beteiligungId: string) => queryOptions({ queryKey: [...schl.einstellungen, "schluessel", beteiligungId], queryFn: () => ladeSchluessel(beteiligungId) });
/** Sitzland und Region einer Organisation (Meldeberichte); die Bearbeitung der Organisation zeigt sie neben dem NACE-Abschnitt. */
export const organisationMeldedaten = (organisationId: string) =>
  queryOptions({ queryKey: [...schl.einstellungen, "meldedaten", organisationId], queryFn: () => auspacken(api.api.v1.organisationen[":id"].meldedaten.$get({ param: { id: organisationId } })) });
export const konten = (fondsId: string) => queryOptions({ queryKey: [...schl.einstellungen, "konten", fondsId], queryFn: () => ladeKonten(fondsId) });
export const gliederung = (fondsId: string) => queryOptions({ queryKey: [...schl.einstellungen, "gliederung", fondsId], queryFn: () => ladeGliederung(fondsId) });
export const kontenregeln = (fondsId: string) => queryOptions({ queryKey: [...schl.einstellungen, "regeln", fondsId], queryFn: () => ladeRegeln(fondsId) });
export const belegvorlagen = (fondsId: string) => queryOptions({ queryKey: [...schl.einstellungen, "vorlagen", fondsId], queryFn: () => ladeVorlagen(fondsId) });
/** Kontenzuordnung des DATEV-Exports je Vorgangs- und Bewegungsart. */
export const buchungsregeln = (fondsId: string) => queryOptions({ queryKey: [...schl.einstellungen, "buchungsregeln", fondsId], queryFn: () => ladeBuchungsregeln(fondsId) });
export const buchungsexporte = (fondsId: string) => queryOptions({ queryKey: [...schl.export, "liste", fondsId], queryFn: () => ladeExporte(fondsId) });

/** Pfade der Downloads (normale Links; Cookie und Rechte prüft die API). */
export const belegDateiUrl = (id: string) => `/api/v1/belege/${id}/datei`;
export const auswertungDateiUrl = (fondsId: string, sicht: string, bis: string, format: "pdf" | "xlsx", sprache: "de" | "en") =>
  `/api/v1/fonds/${fondsId}/auswertung/${sicht}/datei?bis=${bis}&format=${format}&sprache=${sprache}`;
export const exportDateiUrl = (id: string) => `/api/v1/buchungsexporte/${id}/datei`;

// Mutationen -------------------------------------------------------------------------------------------------------------

export const useBelegErzeugen = () =>
  useApiMutation({
    aufruf: (json: { art: BelegArt; eigeneArtId?: string; werte?: Record<string, string>; bezugArt: BezugArt; bezugId: string; sprache: "de" | "en" }) => auspacken(api.api.v1.belege.$post({ json })),
    invalidiert: () => [schl.belege],
  });

export const useBelegFeldwerte = (id: string) =>
  useApiMutation({
    aufruf: (werte: Record<string, string>) => auspacken(api.api.v1.belege[":id"].feldwerte.$patch({ param: { id }, json: { werte } })),
    invalidiert: () => [schl.belege],
  });

export const useBelegStufe = (id: string) =>
  useApiMutation({
    aufruf: (json: { stufe: string; ergebnis: "ok" | "zurueck"; kommentar?: string }) => auspacken(api.api.v1.belege[":id"].stufe.$post({ param: { id }, json })),
    invalidiert: () => [schl.belege],
  });

/** Storniert einen freigegebenen Beleg (Freigeber, Grund ist Pflicht); die Nummer bleibt vergeben, die Datei bleibt erhalten. */
export const useBelegStornieren = (id: string) =>
  useApiMutation({
    aufruf: (json: { grund: string }) => auspacken(api.api.v1.belege[":id"].storno.$post({ param: { id }, json })),
    invalidiert: () => [schl.belege, schl.auswertung, schl.export],
  });

export const useBelegNeuBefuellen = (id: string) =>
  useApiMutation({
    aufruf: () => auspacken(api.api.v1.belege[":id"]["neu-befuellen"].$post({ param: { id } })),
    invalidiert: () => [schl.belege],
  });

/** Lädt die Saldenliste als multipart hoch (Felder `datei`, `zeitraumVon`, `zeitraumBis`). */
export const useSaldenlaufHochladen = (fondsId: string) =>
  useApiMutation({
    aufruf: ({ datei, von, bis }: { datei: File; von: string; bis: string }) => {
      const formular = new FormData();
      formular.append("datei", datei);
      formular.append("zeitraumVon", von);
      formular.append("zeitraumBis", bis);
      return auspacken(ladeMitSitzung(`${window.location.origin}/api/v1/fonds/${fondsId}/saldenlaeufe`, { method: "POST", body: formular })) as Promise<SaldenlaufZeile>;
    },
    invalidiert: () => [schl.saldenlaeufe],
  });

export const useSaldenlaufPruefen = (id: string) =>
  useApiMutation({
    aufruf: () => auspacken(api.api.v1.saldenlaeufe[":id"].pruefen.$post({ param: { id } })),
    invalidiert: () => [schl.saldenlaeufe],
  });

export const useSaldenlaufUebernehmen = (id: string) =>
  useApiMutation({
    aufruf: () => auspacken(api.api.v1.saldenlaeufe[":id"].uebernehmen.$post({ param: { id } })),
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
    aufruf: (json: ExportAuswahl) => auspacken(api.api.v1.fonds[":id"].buchungsexport.vorschau.$post({ param: { id: fondsId }, json })),
    invalidiert: () => [],
  });

export const useExportErstellen = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: ExportAuswahl & { grund?: string }) => auspacken(api.api.v1.fonds[":id"].buchungsexport.$post({ param: { id: fondsId }, json })),
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
    aufruf: (json: KonfigEingabe) => auspacken(api.api.v1.fonds[":id"].buchhaltung.$put({ param: { id: fondsId }, json })),
    invalidiert: () => [schl.einstellungen],
  });

export const useMittelartenSetzen = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: { gueltigAb: string; mittelarten: { schluessel: string; bezeichnungDe: string; bezeichnungEn: string; quote: string; meldeArt: MeldeArt | null }[] }) => auspacken(api.api.v1.fonds[":id"].mittelarten.$put({ param: { id: fondsId }, json })),
    invalidiert: () => [schl.einstellungen],
  });

export const useStandardgliederung = (fondsId: string) =>
  useApiMutation({
    aufruf: () => auspacken(api.api.v1.fonds[":id"].gliederung.standard.$post({ param: { id: fondsId } })),
    invalidiert: () => [schl.einstellungen],
  });

export const useRegelAnlegen = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: { sicht: (typeof SICHTEN)[number]; kontoVon: string; kontoBis?: string; positionSchluessel: string; gueltigAb: string }) => auspacken(api.api.v1.fonds[":id"].kontenregeln.$post({ param: { id: fondsId }, json })),
    invalidiert: () => [schl.einstellungen, schl.auswertung],
  });

/** `art`: Name einer festen Belegart oder Id einer eigenen. */
export const useVorlageSetzen = (fondsId: string, art: string) =>
  useApiMutation({
    aufruf: (json: { felder: BelegVorlageDaten["felder"]; kopfDe: string; kopfEn: string; fussDe: string; fussEn: string }) =>
      auspacken(api.api.v1.fonds[":id"].belegvorlagen[":art"].$put({ param: { id: fondsId, art }, json })),
    invalidiert: () => [schl.einstellungen],
  });

/** Eigene Belegarten: anlegen, Name und Stilllegung ändern, löschen. Die Vorlagenliste und die Belegliste ändern sich mit. */
export const useBelegartAnlegen = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: { basisArt: BelegArt; bezeichnungDe: string; bezeichnungEn: string }) => auspacken(api.api.v1.fonds[":id"].belegarten.$post({ param: { id: fondsId }, json })),
    invalidiert: () => [schl.einstellungen],
  });
export const useBelegartAendern = (fondsId: string, artId: string) =>
  useApiMutation({
    aufruf: (json: { bezeichnungDe: string; bezeichnungEn: string; aktiv: boolean }) => auspacken(api.api.v1.fonds[":id"].belegarten[":artId"].$put({ param: { id: fondsId, artId }, json })),
    invalidiert: () => [schl.einstellungen, schl.belege],
  });
export const useBelegartLoeschen = (fondsId: string, artId: string) =>
  useApiMutation({
    aufruf: () => auspacken(api.api.v1.fonds[":id"].belegarten[":artId"].$delete({ param: { id: fondsId, artId } })),
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
    aufruf: (json: SchluesselEingabe) => auspacken(api.api.v1.beteiligungen[":id"].buchhaltungsschluessel.$put({ param: { id: beteiligungId }, json })),
    invalidiert: () => [schl.einstellungen, schl.belege, ["melde"]],
  });
/** Sitzland (ISO 3166-1) und Region eines Unternehmens für die Meldeberichte. */
export const useMeldedatenSetzen = (organisationId: string) =>
  useApiMutation({
    aufruf: (json: { sitzland: string | null; region: string | null }) => auspacken(api.api.v1.organisationen[":id"].meldedaten.$put({ param: { id: organisationId }, json })),
    invalidiert: () => [schl.einstellungen, ["melde"]],
  });

/** Quellen der Kontenzuordnung des Exports (Vorgangsarten und Bewegungsarten des Fonds). */
export const BUCHUNGSQUELLEN = ["zins", "auszahlung", "rueckfluss", "tilgung", "zusage", "wertberichtigung", "abruf", "ausschuettung", "zinszahlung", "dividende"] as const;
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
    aufruf: (json: BuchungsregelEingabe) => auspacken(api.api.v1.fonds[":id"].buchungsregeln[":quelle"].$put({ param: { id: fondsId, quelle }, json })),
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
    aufruf: (konto: KontoEingabe) => auspacken(api.api.v1.fonds[":id"].konten.$put({ param: { id: fondsId }, json: { konten: [konto] } })),
    invalidiert: () => [schl.einstellungen, schl.auswertung],
  });
export const useKontoEntfernen = (fondsId: string) =>
  useApiMutation({
    aufruf: (nummer: string) => auspacken(api.api.v1.fonds[":id"].konten[":nummer"].$delete({ param: { id: fondsId, nummer } })),
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
    aufruf: (positionen: GliederungEingabe[]) => auspacken(api.api.v1.fonds[":id"].gliederung[":sicht"].$put({ param: { id: fondsId, sicht }, json: { positionen } })),
    invalidiert: () => [schl.einstellungen, schl.auswertung],
  });
