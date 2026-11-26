import { ausCrm, kontaktAbruf, ausKontakten } from "./abbildung-kontakte";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { api, auspacken } from "./client";
import { useApiMutation } from "./mutationen";
import { schluessel as basisSchluessel } from "./abfragen";

/**
 * CRM und Dealflow (Etappe 20): Felder, Abfragen, Ansichten, Listen, Aufgaben, Verknüpfungen. Die Antworttypen sind hier ausdrücklich
 * beschrieben, weil Filter und eigene Felder dynamisch sind; die Form der Antworten legt `apps/api/src/crm` fest.
 */

export type Objekt = "organisation" | "person" | "deal";
export type FeldTyp = "text" | "langtext" | "zahl" | "betrag" | "datum" | "auswahl" | "mehrfachauswahl" | "kontrollkaestchen" | "url" | "email" | "telefon" | "benutzer" | "verknuepfung";
export type Farbe = "grau" | "signal" | "blau" | "violett" | "tuerkis" | "rose" | "sand";

export interface Option {
  schluessel: string;
  label: string;
  farbe: Farbe;
}

export interface Feld {
  schluessel: string;
  name: string;
  typ: FeldTyp;
  system: boolean;
  schreibbar: boolean;
  optionen: { optionen?: Option[]; ziel?: Objekt; waehrung?: string };
  operatoren: string[];
  sortierbar: boolean;
  ziel?: Objekt;
  definitionId?: string;
  version?: number;
  listeId?: string | null;
  archiviertAm?: string | null;
}

export interface Bedingung {
  feld: string;
  operator: string;
  wert?: unknown;
}
export interface Gruppe {
  verknuepfung: "und" | "oder";
  elemente: (Bedingung | Gruppe)[];
}
export const istGruppe = (e: Bedingung | Gruppe): e is Gruppe => "elemente" in e;

export interface Konfig {
  filter?: Gruppe | undefined;
  sortierung: { feld: string; richtung: "auf" | "ab" }[];
  spalten: { feld: string; breite?: number | undefined }[];
  gruppierung?: string | null | undefined;
}

export type Zeile = Record<string, unknown> & { id: string };

export interface AbfrageAntwort {
  daten: Zeile[];
  gesamt: number;
  limit: number;
  offset: number;
  bezuege: Record<string, string | null>;
}

export interface Ansicht {
  id: string;
  objekt: Objekt;
  listeId: string | null;
  name: string;
  art: "tabelle" | "kanban";
  konfig: Konfig;
  besitzerId: string;
  geteilt: boolean;
  standard: boolean;
  eigene: boolean;
  bearbeitbar: boolean;
}

export interface Liste {
  id: string;
  name: string;
  beschreibung: string | null;
  objekt: Objekt;
  besitzerId: string | null;
  eintraege: number;
}

export interface Aufgabe {
  id: string;
  titel: string;
  notiz: string | null;
  faellig: string | null;
  erledigtAm: string | null;
  zustaendigId: string | null;
  zustaendigName: string | null;
  organisation: { id: string; name: string } | null;
  person: { id: string; vorname: string; nachname: string } | null;
  deal: { id: string; titel: string } | null;
}

export interface Verweis {
  typ: Objekt;
  id: string;
  name: string;
  art: "relation" | "erwaehnung";
  quelleId: string;
}

export interface BoardSpalte {
  wert: string | null;
  anzahl: number;
  summe: string;
  karten: Zeile[];
}

export interface Datensatz {
  id: string;
  werte: Zeile;
  felder: Feld[];
  bezuege: Record<string, string | null>;
}

export interface Beschaeftigung {
  id: string;
  funktion: string | null;
  von: string | null;
  bis: string | null;
  haupt: boolean;
  person: { id: string; vorname: string; nachname: string; email: string | null; telefon: string | null; linkedin: string | null };
  organisation: { id: string; name: string; email: string | null; telefon: string | null; website: string | null; linkedin: string | null };
}

const wurzel = ["crm"] as const;
export const crmSchluessel = {
  wurzel,
  felder: (objekt: Objekt, listeId?: string) => [...wurzel, "felder", objekt, listeId ?? null] as const,
  abfrage: (objekt: Objekt) => [...wurzel, "abfrage", objekt] as const,
  board: (objekt: Objekt) => [...wurzel, "board", objekt] as const,
  ansichten: (objekt: Objekt, listeId?: string) => [...wurzel, "ansichten", objekt, listeId ?? null] as const,
  listen: [...wurzel, "listen"] as const,
  datensatz: (objekt: Objekt, id: string) => [...wurzel, "datensatz", objekt, id] as const,
  verknuepfungen: (objekt: Objekt, id: string) => [...wurzel, "verknuepfungen", objekt, id] as const,
  karte: (objekt: Objekt, id: string) => [...wurzel, "karte", objekt, id] as const,
  aufgaben: [...wurzel, "aufgaben"] as const,
  zustaendige: [...wurzel, "zustaendige"] as const,
  beschaeftigungen: [...wurzel, "beschaeftigungen"] as const,
  dealKontakte: (id: string) => [...wurzel, "deal-kontakte", id] as const,
};

const als = <T>(p: Promise<unknown>) => p as Promise<T>;

export const crmFelder = (objekt: Objekt, listeId?: string, archiviert = false) =>
  queryOptions({
    queryKey: [...crmSchluessel.felder(objekt, listeId), archiviert],
    queryFn: async () => (await als<{ daten: Feld[] }>(ausCrm(api.api.v1.crm.objects[":object"].fields.$get, { param: { objekt }, query: { ...(listeId ? { listeId } : {}), ...(archiviert ? { archiviert: "1" as const } : {}) } }))).daten,
    staleTime: 30_000,
  });

export interface AbfrageEingabe extends Partial<Konfig> {
  suche?: string | undefined;
  listeId?: string | undefined;
  limit?: number;
  offset?: number;
}

const aufbereiten = (e: AbfrageEingabe) => ({ ...e, sortierung: e.sortierung ?? [], spalten: e.spalten ?? [] });

export const crmAbfrage = (objekt: Objekt, eingabe: AbfrageEingabe) =>
  queryOptions({
    queryKey: [...crmSchluessel.abfrage(objekt), eingabe],
    queryFn: () => als<AbfrageAntwort>(ausCrm(api.api.v1.crm.objects[":object"].query.$post, { param: { objekt }, json: aufbereiten(eingabe) as never })),
    placeholderData: keepPreviousData,
  });

/** Eine Seite einer Abfrage (für virtuelles Nachladen); die Seiten liegen unter einem gemeinsamen Schlüssel je Konfiguration. */
export const ladeAbfrageSeite = (objekt: Objekt, eingabe: AbfrageEingabe) => als<AbfrageAntwort>(ausCrm(api.api.v1.crm.objects[":object"].query.$post, { param: { objekt }, json: aufbereiten(eingabe) as never }));

export interface Gruppenzeile {
  /** Optionsschlüssel bzw. Benutzer-ID; `null` = ohne Wert. */
  wert: string | null;
  anzahl: number;
  /** Summen je Feld als Dezimalzeichenkette. */
  summen: Record<string, string>;
}
export interface GruppenAntwort {
  /** `true`, wenn es mehr Gruppen gibt als die Obergrenze; es fehlen dann die kleinsten. */
  abgeschnitten?: boolean;
  gruppen: Gruppenzeile[];
  gesamt: number;
  bezuege: Record<string, string | null>;
}

/** Gruppen einer Tabelle (Anzahl und Summen je Wert); die Eingabe ist dieselbe wie bei der Abfrage, ohne Seitenangaben. */
export const crmGruppen = (objekt: Objekt, eingabe: AbfrageEingabe, gruppe: string, summen: string[]) =>
  queryOptions({
    queryKey: [...crmSchluessel.abfrage(objekt), "gruppen", eingabe, gruppe, summen],
    queryFn: () => als<GruppenAntwort>(ausCrm(api.api.v1.crm.objects[":object"].groups.$post, { param: { objekt }, json: { ...aufbereiten(eingabe), gruppe, summen } as never })),
    placeholderData: keepPreviousData,
  });

export const crmBoard = (objekt: Objekt, eingabe: AbfrageEingabe, gruppe: string, summe: string | null) =>
  queryOptions({
    queryKey: [...crmSchluessel.board(objekt), eingabe, gruppe, summe],
    queryFn: () => als<{ spalten: BoardSpalte[]; bezuege: Record<string, string | null> }>(ausCrm(api.api.v1.crm.objects[":object"].board.$post, { param: { objekt }, json: { ...aufbereiten(eingabe), gruppe, summe, kartenProSpalte: 50 } as never })),
    placeholderData: keepPreviousData,
  });

export const crmAnsichten = (objekt: Objekt, listeId?: string) =>
  queryOptions({
    queryKey: crmSchluessel.ansichten(objekt, listeId),
    queryFn: async () => (await als<{ daten: Ansicht[] }>(ausCrm(api.api.v1.crm.views.$get, { query: { objekt, ...(listeId ? { listeId } : {}) } }))).daten,
  });

export const crmListen = (objekt?: Objekt) =>
  queryOptions({
    queryKey: [...crmSchluessel.listen, objekt ?? null],
    queryFn: async () => (await als<{ daten: Liste[] }>(ausCrm(api.api.v1.crm.lists.$get, { query: objekt ? { objekt } : {} }))).daten,
  });

export const crmDatensatz = (objekt: Objekt, id: string) =>
  queryOptions({ queryKey: crmSchluessel.datensatz(objekt, id), queryFn: () => als<Datensatz>(ausCrm(api.api.v1.crm.records[":object"][":id"].$get, { param: { objekt, id } })) });

export const crmVerknuepfungen = (objekt: Objekt, id: string) =>
  queryOptions({
    queryKey: crmSchluessel.verknuepfungen(objekt, id),
    queryFn: () => als<{ eingehend: Verweis[]; ausgehend: Verweis[] }>(ausCrm(api.api.v1.crm.records[":object"][":id"].links.$get, { param: { objekt, id } })),
  });

/** Kurzkarte eines Datensatzes für die Vorschau an Verweisen (Name, Unternehmen, Kontaktwege). */
export interface Kurzkarte {
  objekt: Objekt;
  id: string;
  name: string;
  firma: { id: string; name: string } | null;
  art: string | null;
  phase: string | null;
  funktion: string | null;
  email: string | null;
  telefon: string | null;
  linkedin: string | null;
  website: string | null;
}

/** Wird beim ersten Überfahren eines Verweises geladen und eine Minute lang aus dem Zwischenspeicher bedient. */
export const crmKarte = (objekt: Objekt, id: string) =>
  queryOptions({
    queryKey: crmSchluessel.karte(objekt, id),
    queryFn: () => als<Kurzkarte>(ausCrm(api.api.v1.crm.records[":object"][":id"].card.$get, { param: { objekt, id } })),
    staleTime: 60_000,
    retry: false,
  });

export interface AufgabenFilter {
  organisationId?: string;
  personId?: string;
  dealId?: string;
  zustaendig?: "ich" | "alle";
  status?: "offen" | "erledigt" | "alle";
}

export const crmAufgaben = (filter: AufgabenFilter) =>
  queryOptions({
    queryKey: [...crmSchluessel.aufgaben, filter],
    queryFn: async () => (await als<{ daten: Aufgabe[] }>(ausCrm(api.api.v1.crm.tasks.$get, { query: { ...filter } as never }))).daten,
  });

/** Kandidaten für Zuständigkeiten (Aufgaben, Felder „Person im Haus“): nur Kennung und Name; mit `dealId` nur, wer den Deal sehen darf. */
export const crmZustaendige = (f: { q?: string; dealId?: string }) =>
  queryOptions({
    queryKey: [...crmSchluessel.zustaendige, f],
    queryFn: async () => (await als<{ daten: { id: string; name: string }[] }>(ausCrm(api.api.v1.crm.assignees.$get, { query: { ...f } as never }))).daten,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

export const crmBeschaeftigungen = (f: { personId?: string; organisationId?: string }) =>
  queryOptions({
    queryKey: [...crmSchluessel.beschaeftigungen, f],
    queryFn: async () => (await als<{ daten: Beschaeftigung[] }>(ausCrm(api.api.v1.crm.employments.$get, { query: { ...f } as never }))).daten,
  });

export interface DealKontakt {
  personId: string;
  vorname: string;
  nachname: string;
  email: string | null;
  telefon: string | null;
  funktion: string | null;
  rolle: string | null;
}

export const crmDealKontakte = (id: string) =>
  queryOptions({
    queryKey: crmSchluessel.dealKontakte(id),
    queryFn: async () => (await als<{ daten: DealKontakt[] }>(ausCrm(api.api.v1.crm.deals[":id"].contacts.$get, { param: { id } }))).daten,
  });

// Mutationen ------------------------------------------------------------------------------------------------------

/** Nach Änderungen an Datensätzen gelten Tabellen, Boards, Detailansichten und die klassischen Listen als veraltet. */
const datenAlt = [crmSchluessel.wurzel, basisSchluessel.organisationListe, basisSchluessel.dealListe, basisSchluessel.deals, basisSchluessel.fonds] as const;

export const useDatensatzAendern = (objekt: Objekt) =>
  useApiMutation({
    aufruf: ({ id, system, eigene }: { id: string; system?: Record<string, unknown>; eigene?: Record<string, unknown> }) =>
      ausCrm(api.api.v1.crm.records[":object"][":id"].$patch, { param: { objekt, id }, json: { ...(system ? { system } : {}), ...(eigene ? { eigene } : {}) } }),
    invalidiert: ({ id }) => [crmSchluessel.abfrage(objekt), crmSchluessel.board(objekt), crmSchluessel.datensatz(objekt, id), crmSchluessel.verknuepfungen(objekt, id), ...datenAlt.slice(1)],
  });

export type Massenaktion =
  | { art: "liste_hinzufuegen"; listeId: string }
  | { art: "feld_setzen"; feld: string; wert: unknown }
  | { art: "phase"; nachPhase: "anfrage" | "erstgespraech" | "pruefung" | "due_diligence" | "investitionsausschuss" | "closing" }
  | { art: "archivieren" };

export interface MassenErgebnis {
  erfolgreich: number;
  hinzugefuegt: number;
  fehler: { id: string; code: string }[];
}

export const useMassenaktion = (objekt: Objekt) =>
  useApiMutation({
    aufruf: (eingabe: { ids?: string[]; abfrage?: AbfrageEingabe; aktion: Massenaktion }) =>
      als<MassenErgebnis>(ausCrm(api.api.v1.crm.objects[":object"]["bulk-actions"].$post, { param: { objekt }, json: { ...eingabe, ...(eingabe.abfrage ? { abfrage: aufbereiten(eingabe.abfrage) } : {}) } as never })),
    invalidiert: () => [...datenAlt],
  });

export interface FeldEingabe {
  /** CRM-Objekt oder Objekt des Portfolios (Etappe 21: Fonds, Runde, Instrument, Beteiligung, Vorgang). */
  objekt: Objekt | "fonds" | "runde" | "instrument" | "beteiligung" | "vorgang";
  listeId?: string;
  name: string;
  typ: FeldTyp;
  optionen?: Record<string, unknown>;
}

export const useFeldAnlegen = () =>
  useApiMutation({
    aufruf: (json: FeldEingabe) => ausCrm(api.api.v1.crm.fields.$post, { json: json as never }),
    invalidiert: () => [crmSchluessel.wurzel, ["zusatzfelder"]],
  });

export const useFeldAendern = () =>
  useApiMutation({
    aufruf: ({ id, ...json }: { id: string; name?: string; optionen?: Record<string, unknown>; position?: number }) => ausCrm(api.api.v1.crm.fields[":id"].$patch, { param: { id }, json }),
    invalidiert: () => [crmSchluessel.wurzel, ["zusatzfelder"]],
  });

export const useFeldArchivieren = () =>
  useApiMutation({
    aufruf: ({ id, wiederherstellen }: { id: string; wiederherstellen?: boolean }) =>
      wiederherstellen ? ausCrm(api.api.v1.crm.fields[":id"].restore.$post, { param: { id } }) : ausCrm(api.api.v1.crm.fields[":id"].archive.$post, { param: { id } }),
    invalidiert: () => [crmSchluessel.wurzel, ["zusatzfelder"]],
  });

export interface AnsichtEingabe {
  objekt: Objekt;
  listeId?: string;
  name: string;
  art: "tabelle" | "kanban";
  konfig: Konfig;
  geteilt: boolean;
}

export const useAnsichtSpeichern = (objekt: Objekt, listeId?: string) =>
  useApiMutation({
    aufruf: (json: AnsichtEingabe) => als<Ansicht>(ausCrm(api.api.v1.crm.views.$post, { json: json as never })),
    invalidiert: () => [crmSchluessel.ansichten(objekt, listeId)],
  });

export const useAnsichtAendern = (objekt: Objekt, listeId?: string) =>
  useApiMutation({
    aufruf: ({ id, ...json }: { id: string; name?: string; art?: "tabelle" | "kanban"; konfig?: Konfig; geteilt?: boolean; standard?: boolean }) =>
      als<Ansicht>(ausCrm(api.api.v1.crm.views[":id"].$patch, { param: { id }, json: json as never })),
    invalidiert: () => [crmSchluessel.ansichten(objekt, listeId)],
  });

export const useAnsichtLoeschen = (objekt: Objekt, listeId?: string) =>
  useApiMutation({
    aufruf: (id: string) => ausCrm(api.api.v1.crm.views[":id"].$delete, { param: { id } }),
    invalidiert: () => [crmSchluessel.ansichten(objekt, listeId)],
  });

export const useListeAnlegen = () =>
  useApiMutation({
    aufruf: (json: { name: string; objekt: Objekt; beschreibung?: string }) => als<Liste>(ausCrm(api.api.v1.crm.lists.$post, { json })),
    invalidiert: () => [crmSchluessel.listen],
  });

export const useListeEintraege = (listeId: string) =>
  useApiMutation({
    aufruf: ({ datensatzIds, entfernen }: { datensatzIds: string[]; entfernen?: boolean }) =>
      entfernen
        ? als<unknown>(ausCrm(api.api.v1.crm.lists[":id"].entries.remove.$post, { param: { id: listeId }, json: { datensatzIds } }))
        : als<unknown>(ausCrm(api.api.v1.crm.lists[":id"].entries.$post, { param: { id: listeId }, json: { datensatzIds } })),
    invalidiert: () => [crmSchluessel.wurzel],
  });

/** Werte der Listenfelder eines Eintrags ändern (nur Besitzerin oder Besitzer der Liste und globale Verwalter, entscheidet die API). */
export const useListeEintragFelder = () =>
  useApiMutation({
    aufruf: ({ listeId, datensatzId, felder }: { listeId: string; datensatzId: string; felder: Record<string, unknown> }) =>
      als<unknown>(ausCrm(api.api.v1.crm.lists[":id"].entries[":recordId"].$patch, { param: { id: listeId, datensatzId }, json: { felder } })),
    invalidiert: () => [crmSchluessel.wurzel],
  });

export const useAufgabeAnlegen = () =>
  useApiMutation({
    aufruf: (json: { titel: string; faellig?: string | null; zustaendigId?: string | null; organisationId?: string; personId?: string; dealId?: string; notiz?: string | null }) => ausCrm(api.api.v1.crm.tasks.$post, { json }),
    invalidiert: () => [crmSchluessel.aufgaben],
  });

export const useAufgabeAendern = () =>
  useApiMutation({
    aufruf: ({ id, ...json }: { id: string; titel?: string; faellig?: string | null; zustaendigId?: string | null }) => ausCrm(api.api.v1.crm.tasks[":id"].$patch, { param: { id }, json }),
    invalidiert: () => [crmSchluessel.aufgaben],
  });

export const useAufgabeErledigen = () =>
  useApiMutation({
    aufruf: ({ id, erledigt }: { id: string; erledigt: boolean }) =>
      erledigt ? ausCrm(api.api.v1.crm.tasks[":id"].complete.$post, { param: { id } }) : ausCrm(api.api.v1.crm.tasks[":id"].reopen.$post, { param: { id } }),
    invalidiert: () => [crmSchluessel.aufgaben],
  });

export const useBeschaeftigungAnlegen = () =>
  useApiMutation({
    aufruf: (json: { personId: string; organisationId: string; funktion?: string | null; von?: string | null; bis?: string | null; haupt?: boolean }) => ausCrm(api.api.v1.crm.employments.$post, { json }),
    invalidiert: () => [crmSchluessel.wurzel, basisSchluessel.organisationen, basisSchluessel.personen],
  });

export const useBeschaeftigungAendern = () =>
  useApiMutation({
    aufruf: ({ id, ...json }: { id: string; funktion?: string | null; von?: string | null; bis?: string | null; haupt?: boolean }) => ausCrm(api.api.v1.crm.employments[":id"].$patch, { param: { id }, json }),
    invalidiert: () => [crmSchluessel.wurzel, basisSchluessel.organisationen, basisSchluessel.personen],
  });

export const useBeschaeftigungLoeschen = () =>
  useApiMutation({
    aufruf: (id: string) => ausCrm(api.api.v1.crm.employments[":id"].$delete, { param: { id } }),
    invalidiert: () => [crmSchluessel.wurzel, basisSchluessel.organisationen, basisSchluessel.personen],
  });

export const useDealKontaktHinzufuegen = (dealId: string) =>
  useApiMutation({
    aufruf: (json: { personId: string; rolle?: string | null }) => ausCrm(api.api.v1.crm.deals[":id"].contacts.$post, { param: { id: dealId }, json }),
    invalidiert: () => [crmSchluessel.dealKontakte(dealId)],
  });

export interface ImportBefund {
  zeile: number;
  status: string;
  name: string | null;
  dublette?: { id: string; name: string; score: number };
  fehler: { feld: string; meldung: string }[];
}
export interface ImportErgebnis {
  zusammenfassung: Record<string, number>;
  zeilen: ImportBefund[];
}
export interface ImportEingabe {
  objekt: "organisation" | "person";
  csv: string;
  zuordnung: { spalte: number; feld: string }[];
  dubletten: "ueberspringen" | "aktualisieren" | "anlegen";
  unternehmenAnlegen: boolean;
}

export const ladeKopfzeile = async (csv: string) => (await als<{ spalten: string[] }>(ausCrm(api.api.v1.crm.import.headers.$post, { json: { csv } }))).spalten;
export const importVorschau = (json: ImportEingabe) => als<ImportErgebnis>(ausCrm(api.api.v1.crm.import.preview.$post, { json }));
export const useCrmImport = () =>
  useApiMutation({
    aufruf: (json: ImportEingabe) => als<ImportErgebnis>(ausCrm(api.api.v1.crm.import.$post, { json })),
    invalidiert: () => [...datenAlt],
  });

/** Export einer Ansicht als CSV: Der Browser lädt die Antwort als Datei. */
export async function exportiereCsv(objekt: Objekt, eingabe: AbfrageEingabe): Promise<string> {
  const antwort = await kontaktAbruf(api.api.v1.crm.objects[":object"].export.$post, { param: { objekt }, json: aufbereiten(eingabe) as never });
  if (!antwort.ok) await auspacken(Promise.resolve(antwort));
  return antwort.text();
}

// Dealflow ---------------------------------------------------------------------------------------------------------

type BoardDaten = { spalten: BoardSpalte[]; bezuege: Record<string, string | null> };
type Phase = "anfrage" | "erstgespraech" | "pruefung" | "due_diligence" | "investitionsausschuss" | "closing";

const inCent = (betrag: string | null | undefined): bigint => {
  const [ganz = "0", rest = ""] = String(betrag ?? "0").split(".");
  return BigInt(ganz) * 100n + BigInt(rest.padEnd(2, "0").slice(0, 2));
};
const ausCent = (c: bigint) => `${c / 100n}.${String(c % 100n).padStart(2, "0")}`;

/** Verschiebt die Karte im Zwischenspeicher aller Boards (sofortige Rückmeldung); bei einem Fehler kehrt der alte Stand zurück. */
function verschiebeLokal(daten: BoardDaten, id: string, nach: Phase): BoardDaten {
  const karte = daten.spalten.flatMap((s) => s.karten).find((k) => k.id === id);
  if (!karte) return daten;
  const ticket = inCent(typeof karte.ticket === "string" ? karte.ticket : null);
  return {
    ...daten,
    spalten: daten.spalten.map((s) => {
      if (s.karten.some((k) => k.id === id)) return { ...s, anzahl: s.anzahl - 1, summe: ausCent(inCent(s.summe) - ticket), karten: s.karten.filter((k) => k.id !== id) };
      if (s.wert === nach) return { ...s, anzahl: s.anzahl + 1, summe: ausCent(inCent(s.summe) + ticket), karten: [{ ...karte, phase: nach }, ...s.karten] };
      return s;
    }),
  };
}

/**
 * Phasenwechsel eines Deals auf dem Board: gleiche Regeln wie überall (Closing nur mit zustimmendem Beschluss; der Server entscheidet). Die Karte springt sofort
 * in die neue Spalte; lehnt der Server ab, kehrt sie zurück und der Fehler wird gemeldet.
 */
export const useDealVerschieben = () =>
  useApiMutation({
    aufruf: ({ id, nachPhase }: { id: string; nachPhase: Phase }) => ausKontakten(api.api.v1.deals[":id"].stage.$post, { param: { id }, json: { nachPhase } }),
    vorher: async ({ id, nachPhase }, qc) => {
      await qc.cancelQueries({ queryKey: crmSchluessel.board("deal") });
      const alt = qc.getQueriesData<BoardDaten>({ queryKey: crmSchluessel.board("deal") });
      for (const [key, daten] of alt) if (daten) qc.setQueryData<BoardDaten>(key, verschiebeLokal(daten, id, nachPhase));
      return alt;
    },
    zurueck: (alt, _eingabe, qc) => {
      for (const [key, daten] of alt) qc.setQueryData(key, daten);
    },
    invalidiert: (_ergebnis, { id }) => [crmSchluessel.wurzel, basisSchluessel.dealListe, basisSchluessel.dealDetail(id), basisSchluessel.dealArbeitsliste, basisSchluessel.trichter],
  });
