import { useMutation, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import type { InferRequestType } from "hono/client";
import { api, auspacken } from "./client";
import { dealDetail, dealListe, schluessel, type Deal, type DealDetail } from "./abfragen";
import type { Berichtsart } from "../lib/berichte";

/**
 * Schreibende Aufrufe der API als TanStack-Query-Mutationen. Jede Mutation nennt, welche Abfragen sie
 * bei Erfolg entwertet (`invalidiert`); mehr wird nicht neu geladen. Der Akteur im Änderungsprotokoll
 * setzt der Server (Entscheidung 39), die Oberfläche sendet keinen `X-Akteur`-Header.
 */

interface MutationsOptionen<E, R, K> {
  aufruf: (eingabe: E) => Promise<R>;
  invalidiert: (ergebnis: R, eingabe: E) => readonly QueryKey[];
  /** Optimistische Änderung vor der Antwort; der Rückgabewert geht an `zurueck`. */
  vorher?: (eingabe: E, qc: QueryClient) => K | Promise<K>;
  /** Macht die optimistische Änderung bei einem Fehler rückgängig. */
  zurueck?: (kontext: K, eingabe: E, qc: QueryClient) => void;
}

export function useApiMutation<E, R, K = undefined>({ aufruf, invalidiert, vorher, zurueck }: MutationsOptionen<E, R, K>) {
  const qc = useQueryClient();
  return useMutation<R, Error, E, K | undefined>({
    mutationFn: aufruf,
    onMutate: vorher ? (eingabe) => vorher(eingabe, qc) : undefined,
    onError: (_fehler, eingabe, kontext) => {
      if (zurueck && kontext !== undefined) zurueck(kontext, eingabe, qc);
    },
    onSuccess: async (ergebnis, eingabe) => {
      await Promise.all(invalidiert(ergebnis, eingabe).map((queryKey) => qc.invalidateQueries({ queryKey })));
    },
  });
}

type Eingabe<F extends (...args: never[]) => unknown> = InferRequestType<F>;

export type NeueOrganisation = Eingabe<typeof api.api.v1.organisationen.$post>["json"];
export type OrganisationAenderung = Eingabe<(typeof api.api.v1.organisationen)[":id"]["$patch"]>["json"];
export type NeuePerson = Eingabe<typeof api.api.v1.personen.$post>["json"];
export type PersonAenderung = Eingabe<(typeof api.api.v1.personen)[":id"]["$patch"]>["json"];
export type NeueAktivitaet = Eingabe<typeof api.api.v1.aktivitaeten.$post>["json"];
export type NeuerDeal = Eingabe<typeof api.api.v1.deals.$post>["json"];
export type DealAenderung = Eingabe<(typeof api.api.v1.deals)[":id"]["$patch"]>["json"];
export type DealPhase = Eingabe<(typeof api.api.v1.deals)[":id"]["phase"]["$post"]>["json"]["nachPhase"];
export type NeuerBeschluss = Eingabe<(typeof api.api.v1.deals)[":id"]["beschluesse"]["$post"]>["json"];
export type NeueBeteiligung = Eingabe<(typeof api.api.v1.deals)[":id"]["beteiligung"]["$post"]>["json"];

export const useOrganisationAnlegen = () =>
  useApiMutation({
    aufruf: (json: NeueOrganisation) => auspacken(api.api.v1.organisationen.$post({ json })),
    invalidiert: () => [schluessel.organisationListe],
  });

export const useOrganisationAendern = (id: string) =>
  useApiMutation({
    aufruf: (json: OrganisationAenderung) => auspacken(api.api.v1.organisationen[":id"].$patch({ param: { id }, json })),
    // Der Name steht auch in den Deals und in den Beteiligungen der Fondsübersicht.
    invalidiert: () => [schluessel.organisationDetail(id), schluessel.organisationListe, schluessel.dealListe, schluessel.dealArbeitsliste, schluessel.deals, schluessel.fonds, schluessel.beteiligungen],
  });

/** Ohne `organisationId` entsteht ein Kontakt ohne Unternehmen (oder mit dem im Körper gewählten). */
export const usePersonAnlegen = (organisationId?: string) =>
  useApiMutation({
    aufruf: (json: NeuePerson) => auspacken(api.api.v1.personen.$post({ json: { ...json, ...(organisationId ? { organisationId } : {}) } })),
    invalidiert: () => [...(organisationId ? [schluessel.organisationDetail(organisationId)] : [schluessel.organisationen]), schluessel.personen, ["crm"] as const, [...schluessel.deals, "detail"]],
  });

export const usePersonAendern = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ id, json }: { id: string; json: PersonAenderung }) => auspacken(api.api.v1.personen[":id"].$patch({ param: { id }, json })),
    invalidiert: () => [schluessel.organisationDetail(organisationId), schluessel.personen, ["crm"] as const, [...schluessel.deals, "detail"]],
  });

export type NeueRolle = Eingabe<typeof api.api.v1.kontaktrollen.$post>["json"];
export type NeueBeziehung = Eingabe<typeof api.api.v1.organisationsbeziehungen.$post>["json"];
export type KontaktimportEingabe = Eingabe<typeof api.api.v1.kontaktimport.$post>["json"];
export type NeueVorlage = Eingabe<typeof api.api.v1.beschlussvorlagen.$post>["json"];
export type VorlageAenderung = Eingabe<(typeof api.api.v1.beschlussvorlagen)[":id"]["$patch"]>["json"];
export type OrganisationenZusammenfuehren = Eingabe<(typeof api.api.v1.organisationen)[":id"]["zusammenfuehren"]["$post"]>["json"];
export type PersonenZusammenfuehren = Eingabe<(typeof api.api.v1.personen)[":id"]["zusammenfuehren"]["$post"]>["json"];

/** Rollen und Beziehungen stehen auf Organisation, Person und Deal (Personenliste). */
const kontaktdaten = [schluessel.organisationen, schluessel.personen, [...schluessel.deals, "detail"]] as const;

export const useRolleAnlegen = () =>
  useApiMutation({ aufruf: (json: NeueRolle) => auspacken(api.api.v1.kontaktrollen.$post({ json })), invalidiert: () => kontaktdaten });
export const useRolleLoeschen = () =>
  useApiMutation({ aufruf: (id: string) => auspacken(api.api.v1.kontaktrollen[":id"].$delete({ param: { id } })), invalidiert: () => kontaktdaten });
export const useBeziehungAnlegen = () =>
  useApiMutation({ aufruf: (json: NeueBeziehung) => auspacken(api.api.v1.organisationsbeziehungen.$post({ json })), invalidiert: () => [schluessel.organisationen] });
export const useBeziehungLoeschen = () =>
  useApiMutation({ aufruf: (id: string) => auspacken(api.api.v1.organisationsbeziehungen[":id"].$delete({ param: { id } })), invalidiert: () => [schluessel.organisationen] });

/** Die Vorschau schreibt nichts. */
export const useOrganisationenVorschau = () =>
  useApiMutation({
    aufruf: ({ id, quelleId }: { id: string; quelleId: string }) => auspacken(api.api.v1.organisationen[":id"].zusammenfuehren.vorschau.$post({ param: { id }, json: { quelleId } })),
    invalidiert: () => [],
  });
export const useOrganisationenZusammenfuehren = () =>
  useApiMutation({
    aufruf: ({ id, json }: { id: string; json: OrganisationenZusammenfuehren }) => auspacken(api.api.v1.organisationen[":id"].zusammenfuehren.$post({ param: { id }, json })),
    // Verweise wechseln den Besitzer: Kontakte, Deals, Fonds, Beteiligungen, Aktivitäten, Wiedervorlagen
    invalidiert: () => [...kontaktdaten, schluessel.deals, schluessel.fonds, schluessel.beteiligungen, schluessel.aktivitaeten, schluessel.wiedervorlagen, ["suche"]],
  });
export const usePersonenVorschau = () =>
  useApiMutation({
    aufruf: ({ id, quelleId }: { id: string; quelleId: string }) => auspacken(api.api.v1.personen[":id"].zusammenfuehren.vorschau.$post({ param: { id }, json: { quelleId } })),
    invalidiert: () => [],
  });
export const usePersonenZusammenfuehren = () =>
  useApiMutation({
    aufruf: ({ id, json }: { id: string; json: PersonenZusammenfuehren }) => auspacken(api.api.v1.personen[":id"].zusammenfuehren.$post({ param: { id }, json })),
    invalidiert: () => [...kontaktdaten, schluessel.aktivitaeten, schluessel.wiedervorlagen, ["suche"]],
  });

export const useKontaktimportVorschau = () =>
  useApiMutation({
    aufruf: (json: KontaktimportEingabe) => auspacken(api.api.v1.kontaktimport.vorschau.$post({ json })),
    invalidiert: () => [],
  });
export const useKontaktimport = () =>
  useApiMutation({
    aufruf: (json: KontaktimportEingabe) => auspacken(api.api.v1.kontaktimport.$post({ json })),
    invalidiert: () => [...kontaktdaten, ["suche"]],
  });

export const useWiedervorlageZurueckstellen = () =>
  useApiMutation({
    aufruf: ({ id, datum }: { id: string; datum: string }) => auspacken(api.api.v1.aktivitaeten[":id"].zurueckstellen.$post({ param: { id }, json: { datum } })),
    invalidiert: () => [schluessel.wiedervorlagen, schluessel.aktivitaeten, [...schluessel.deals, "detail"]],
  });

export const useVorlageAnlegen = () =>
  useApiMutation({ aufruf: (json: NeueVorlage) => auspacken(api.api.v1.beschlussvorlagen.$post({ json })), invalidiert: () => [schluessel.beschlussvorlagen] });
export const useVorlageAendern = () =>
  useApiMutation({
    aufruf: ({ id, json }: { id: string; json: VorlageAenderung }) => auspacken(api.api.v1.beschlussvorlagen[":id"].$patch({ param: { id }, json })),
    invalidiert: () => [schluessel.beschlussvorlagen],
  });
export const useVorlageLoeschen = () =>
  useApiMutation({ aufruf: (id: string) => auspacken(api.api.v1.beschlussvorlagen[":id"].$delete({ param: { id } })), invalidiert: () => [schluessel.beschlussvorlagen] });
export const useBeschlussvorschlagAusVorlage = (id: string) =>
  useApiMutation({
    aufruf: (json: { vorlageId: string; instrument?: NeueBeteiligung["instrument"] | undefined; sprache: "de" | "en" }) =>
      auspacken(api.api.v1.deals[":id"].beschlussvorschlag.$post({ param: { id }, json: { vorlageId: json.vorlageId, sprache: json.sprache, ...(json.instrument ? { instrument: json.instrument } : {}) } })),
    invalidiert: () => [schluessel.dealDetail(id)],
  });

export const useAktivitaetAnlegen = () =>
  useApiMutation({
    aufruf: (json: NeueAktivitaet) => auspacken(api.api.v1.aktivitaeten.$post({ json })),
    invalidiert: (_neu, eingabe) => [
      schluessel.aktivitaeten,
      ...(eingabe.dealId ? [schluessel.dealDetail(eingabe.dealId)] : []),
      ...(eingabe.wiedervorlage ? [schluessel.wiedervorlagen] : []),
    ],
  });

export const useWiedervorlageErledigt = () =>
  useApiMutation({
    aufruf: (id: string) => auspacken(api.api.v1.aktivitaeten[":id"].erledigt.$post({ param: { id } })),
    invalidiert: () => [schluessel.wiedervorlagen, schluessel.aktivitaeten, [...schluessel.deals, "detail"]],
  });

export const useDealAnlegen = () =>
  useApiMutation({
    aufruf: (json: NeuerDeal) => auspacken(api.api.v1.deals.$post({ json })),
    invalidiert: (neu, eingabe) => [
      schluessel.dealListe,
      schluessel.dealArbeitsliste,
      ["crm"] as const,
      schluessel.organisationDetail(neu.organisation.id),
      schluessel.trichter,
      ...(eingabe.organisation ? [schluessel.organisationListe] : []),
    ],
  });

export const useDealAendern = (id: string) =>
  useApiMutation({
    aufruf: (json: DealAenderung) => auspacken(api.api.v1.deals[":id"].$patch({ param: { id }, json })),
    invalidiert: (_neu, eingabe) => [
      schluessel.dealDetail(id), schluessel.dealListe, schluessel.dealArbeitsliste, [...schluessel.organisationen, "detail"],
      ...(eingabe.dealtyp !== undefined ? [["crm", "board", "deal"], ["crm", "abfrage", "deal"], ["crm", "datensatz", "deal", id]] : []),
    ],
  });

/** Phasenwechsel: Liste und Detail springen sofort, bei einem Fehler kehren beide zurück. */
export const usePhaseAendern = () =>
  useApiMutation({
    aufruf: ({ id, nachPhase }: { id: string; nachPhase: DealPhase }) => auspacken(api.api.v1.deals[":id"].phase.$post({ param: { id }, json: { nachPhase } })),
    vorher: async ({ id, nachPhase }, qc) => {
      // Laufende Abfragen würden die optimistische Änderung überschreiben.
      await Promise.all([qc.cancelQueries({ queryKey: schluessel.dealListe }), qc.cancelQueries({ queryKey: schluessel.dealDetail(id) })]);
      const liste = qc.getQueryData<Deal[]>(dealListe().queryKey);
      const detail = qc.getQueryData<DealDetail>(dealDetail(id).queryKey);
      if (liste) qc.setQueryData<Deal[]>(dealListe().queryKey, liste.map((d) => (d.id === id ? { ...d, phase: nachPhase } : d)));
      if (detail) qc.setQueryData<DealDetail>(dealDetail(id).queryKey, { ...detail, phase: nachPhase });
      return { liste, detail };
    },
    zurueck: ({ liste, detail }, { id }, qc) => {
      if (liste) qc.setQueryData(dealListe().queryKey, liste);
      if (detail) qc.setQueryData(dealDetail(id).queryKey, detail);
    },
    invalidiert: (_ergebnis, { id }) => [["crm", "board", "deal"], schluessel.dealListe, schluessel.dealArbeitsliste, schluessel.dealDetail(id), schluessel.trichter, [...schluessel.organisationen, "detail"]],
  });

export const useDealAbsagen = (id: string) =>
  useApiMutation({
    aufruf: (grund: string) => auspacken(api.api.v1.deals[":id"].absage.$post({ param: { id }, json: { grund } })),
    invalidiert: () => [["crm", "board", "deal"], schluessel.dealDetail(id), schluessel.dealListe, schluessel.dealArbeitsliste, schluessel.trichter, [...schluessel.organisationen, "detail"]],
  });

export const useDealWiederaufnehmen = (id: string) =>
  useApiMutation({
    aufruf: () => auspacken(api.api.v1.deals[":id"].wiederaufnahme.$post({ param: { id } })),
    invalidiert: () => [["crm", "board", "deal"], schluessel.dealDetail(id), schluessel.dealListe, schluessel.dealArbeitsliste, schluessel.trichter, [...schluessel.organisationen, "detail"]],
  });

export const useBeschlussAnlegen = (id: string) =>
  useApiMutation({
    aufruf: (json: NeuerBeschluss) => auspacken(api.api.v1.deals[":id"].beschluesse.$post({ param: { id }, json })),
    invalidiert: () => [schluessel.dealDetail(id)],
  });

/** Übergang ins Portfolio: neue Beteiligung, Deal wird „investiert“, die Fondsübersicht ändert sich. */
export const useInsPortfolio = (id: string) =>
  useApiMutation({
    aufruf: (json: NeueBeteiligung) => auspacken(api.api.v1.deals[":id"].beteiligung.$post({ param: { id }, json })),
    invalidiert: () => [["crm", "board", "deal"], schluessel.dealDetail(id), schluessel.dealListe, schluessel.dealArbeitsliste, schluessel.fonds, schluessel.beteiligungen, schluessel.trichter, [...schluessel.organisationen, "detail"]],
  });

/**
 * Fordert die Neuberechnung des Snapshots an (202). Der Worker rechnet im Hintergrund; die Seite fragt danach
 * die Übersicht in Abständen neu ab, bis sich `berechnetAm` ändert (siehe `Portfolio.tsx`). Deshalb entwertet die Mutation nichts.
 */
export const useNeuberechnen = (fondsId: string) =>
  useApiMutation({
    aufruf: (stichtag: string) => auspacken(api.api.v1.fonds[":id"].neuberechnen.$post({ param: { id: fondsId }, query: { stichtag } })),
    invalidiert: () => [],
  });

// Instrumente und Zinsen (Etappe 4) ---------------------------------------------------------------------------------

type BeteiligungsRoute = (typeof api.api.v1.beteiligungen)[":id"];
export type NeuerVorgang = Eingabe<BeteiligungsRoute["vorgaenge"]["$post"]>["json"];
export type NeueKondition = Eingabe<BeteiligungsRoute["konditionen"]["$post"]>["json"];
export type NeuesInstrument = Eingabe<BeteiligungsRoute["instrumente"]["$post"]>["json"];
export type InstrumentAenderung = Eingabe<(typeof api.api.v1.instrumente)[":id"]["$patch"]>["json"];
export type NeueTranche = Eingabe<(typeof api.api.v1.instrumente)[":id"]["tranchen"]["$post"]>["json"];
export type TrancheAenderung = Eingabe<(typeof api.api.v1.tranchen)[":id"]["$patch"]>["json"];
export type WandlungEingabe = Eingabe<BeteiligungsRoute["wandlung"]["$post"]>["json"];
export type VerkaufEingabe = Eingabe<BeteiligungsRoute["verkauf"]["$post"]>["json"];
export type AnpassungEingabe = Eingabe<BeteiligungsRoute["kaufpreisanpassung"]["$post"]>["json"];
export type InsolvenzEingabe = Eingabe<BeteiligungsRoute["insolvenz"]["$post"]>["json"];

/** Eine Änderung an Vorgängen, Konditionen oder Beständen verschiebt Kennzahlen, Buchwert, Abgrenzung und Zinsläufe. */
const bestand = [schluessel.beteiligungen, schluessel.fonds, schluessel.zinslaeufe] as const;
/** Anlegen, Ändern und Löschen einer Runde können die Pools der Mitarbeiterbeteiligung ändern (Aufstockung, Datum, leerer Pool). */
const bestandMitPools = [...bestand, schluessel.organisationen] as const;

export const useVorgangAnlegen = (id: string) =>
  useApiMutation({
    aufruf: (json: NeuerVorgang) => auspacken(api.api.v1.beteiligungen[":id"].vorgaenge.$post({ param: { id }, json })),
    invalidiert: () => bestand,
  });

/** Ordnet einen Vorgang einer Runde des Unternehmens zu (`null` = keiner Runde); die Zuordnung steht unter `beteiligungen` (Rundentransaktionen). */
export const useVorgangRundeAendern = () =>
  useApiMutation({
    aufruf: ({ id, rundeId }: { id: string; rundeId: string | null }) => auspacken(api.api.v1.vorgaenge[":id"].runde.$put({ param: { id }, json: { rundeId } })),
    invalidiert: () => bestand,
  });

export const useStorno = () =>
  useApiMutation({
    aufruf: ({ id, grund, valuta }: { id: string; grund: string; valuta?: string | undefined }) =>
      auspacken(api.api.v1.vorgaenge[":id"].storno.$post({ param: { id }, json: { grund, ...(valuta ? { valuta } : {}) } })),
    invalidiert: () => bestand,
  });

export const useKonditionAnlegen = (id: string) =>
  useApiMutation({
    aufruf: (json: NeueKondition) => auspacken(api.api.v1.beteiligungen[":id"].konditionen.$post({ param: { id }, json })),
    invalidiert: () => bestand,
  });

/** Ein neues Instrument, eine Tranche (mit ihrer Zusage) oder deren Änderung verschiebt Zusage, Buchwert und Kennzahlen. */
export const useInstrumentAnlegen = (beteiligungId: string) =>
  useApiMutation({
    aufruf: (json: NeuesInstrument) => auspacken(api.api.v1.beteiligungen[":id"].instrumente.$post({ param: { id: beteiligungId }, json })),
    invalidiert: () => bestand,
  });

export const useInstrumentAendern = () =>
  useApiMutation({
    aufruf: ({ id, ...json }: { id: string } & InstrumentAenderung) => auspacken(api.api.v1.instrumente[":id"].$patch({ param: { id }, json })),
    invalidiert: () => bestand,
  });

export const useTrancheAnlegen = () =>
  useApiMutation({
    aufruf: ({ instrumentId, ...json }: { instrumentId: string } & NeueTranche) => auspacken(api.api.v1.instrumente[":id"].tranchen.$post({ param: { id: instrumentId }, json })),
    invalidiert: () => bestand,
  });

export const useTrancheAendern = () =>
  useApiMutation({
    aufruf: ({ id, ...json }: { id: string } & TrancheAenderung) => auspacken(api.api.v1.tranchen[":id"].$patch({ param: { id }, json })),
    invalidiert: () => bestand,
  });

export const useTrancheErfuellt = () =>
  useApiMutation({
    aufruf: ({ id, datum, nachweis }: { id: string; datum?: string | undefined; nachweis?: string | undefined }) =>
      auspacken(api.api.v1.tranchen[":id"].erfuellt.$post({ param: { id }, json: { ...(datum ? { datum } : {}), ...(nachweis ? { nachweis } : {}) } })),
    invalidiert: () => [schluessel.beteiligungen],
  });

export const useJahresueberschuss = (id: string) =>
  useApiMutation({
    aufruf: ({ jahr, betrag }: { jahr: number; betrag: string }) =>
      auspacken(api.api.v1.beteiligungen[":id"].jahresueberschuss[":jahr"].$put({ param: { id, jahr: String(jahr) }, json: { betrag } })),
    invalidiert: () => [schluessel.beteiligungen, schluessel.fonds],
  });

export const useForderungErfuellt = () =>
  useApiMutation({
    aufruf: ({ id, datum }: { id: string; datum?: string | undefined }) => auspacken(api.api.v1.forderungen[":id"].erfuellt.$post({ param: { id }, json: datum ? { datum } : {} })),
    invalidiert: () => bestand,
  });

/** Die Vorschau schreibt nichts und entwertet nichts. */
export const useWandlungVorschau = (id: string) =>
  useApiMutation({
    aufruf: (json: WandlungEingabe) => auspacken(api.api.v1.beteiligungen[":id"].wandlung.vorschau.$post({ param: { id }, json })),
    invalidiert: () => [],
  });

export const useWandlung = (id: string) =>
  useApiMutation({
    aufruf: (json: WandlungEingabe) => auspacken(api.api.v1.beteiligungen[":id"].wandlung.$post({ param: { id }, json })),
    invalidiert: () => [...bestand, schluessel.deals],
  });

export const useVerkauf = (id: string) =>
  useApiMutation({
    aufruf: (json: VerkaufEingabe) => auspacken(api.api.v1.beteiligungen[":id"].verkauf.$post({ param: { id }, json })),
    invalidiert: () => bestand,
  });

export const useKaufpreisanpassung = (id: string) =>
  useApiMutation({
    aufruf: (json: AnpassungEingabe) => auspacken(api.api.v1.beteiligungen[":id"].kaufpreisanpassung.$post({ param: { id }, json })),
    invalidiert: () => bestand,
  });

export const useInsolvenz = (id: string) =>
  useApiMutation({
    aufruf: (json: InsolvenzEingabe) => auspacken(api.api.v1.beteiligungen[":id"].insolvenz.$post({ param: { id }, json })),
    invalidiert: () => bestand,
  });

export const useZinslaufAnlegen = () =>
  useApiMutation({
    aufruf: (json: { fondsId: string; stichtag: string }) => auspacken(api.api.v1.zinslaeufe.$post({ json })),
    invalidiert: () => [schluessel.zinslaeufe],
  });

export type ZinslaufAktion = "pruefen" | "freigeben" | "verwerfen" | "buchen";

/** Statusübergang eines Zinslaufs; Buchen verändert außerdem Vorgänge, Kennzahlen und Abgrenzung. */
export const useZinslaufAktion = (id: string) =>
  useApiMutation({
    aufruf: (aktion: ZinslaufAktion) => auspacken(api.api.v1.zinslaeufe[":id"][aktion].$post({ param: { id } })),
    invalidiert: (_ergebnis, aktion) => (aktion === "buchen" ? bestand : [schluessel.zinslaeufe]),
  });

// Bewertungen, Runden und Berichte (Etappe 5) ------------------------------------------------------------------------

export type NeueBewertung = Eingabe<BeteiligungsRoute["bewertungen"]["$post"]>["json"];
export type NeuerBericht = Eingabe<typeof api.api.v1.berichte.$post>["json"];
export type BerichtStufeEingabe = Eingabe<(typeof api.api.v1.berichte)[":id"]["stufe"]["$post"]>["json"];

/** Eine freigegebene Bewertung ändert NAV, Kennzahlen, Verlauf, Snapshots und die Kontrolle der Berichte. */
const bewertet = [schluessel.bewertungen, schluessel.runden, schluessel.beteiligungen, schluessel.fonds, schluessel.berichte] as const;

export const useBewertungAnlegen = (beteiligungId: string) =>
  useApiMutation({
    aufruf: (json: NeueBewertung) => auspacken(api.api.v1.beteiligungen[":id"].bewertungen.$post({ param: { id: beteiligungId }, json })),
    invalidiert: () => [schluessel.bewertungen, schluessel.runden, schluessel.berichte],
  });

export type BewertungAenderung = Eingabe<(typeof api.api.v1.bewertungen)[":id"]["$patch"]>["json"];

/** Ändert den Entwurf einer Bewertung (auch in einer Runde); nichts davon zählt, solange er nicht freigegeben ist. */
export const useBewertungAendern = () =>
  useApiMutation({
    aufruf: ({ id, ...json }: { id: string } & BewertungAenderung) => auspacken(api.api.v1.bewertungen[":id"].$patch({ param: { id }, json })),
    invalidiert: () => [schluessel.bewertungen, schluessel.runden, schluessel.berichte],
  });

export type BewertungAktion = "freigeben" | "verwerfen";

export const useBewertungAktion = () =>
  useApiMutation({
    aufruf: async ({ id, aktion }: { id: string; aktion: BewertungAktion }) => {
      const param = { param: { id } };
      return aktion === "freigeben" ? auspacken(api.api.v1.bewertungen[":id"].freigeben.$post(param)) : auspacken(api.api.v1.bewertungen[":id"].verwerfen.$post(param));
    },
    invalidiert: (_ergebnis, { aktion }) => (aktion === "freigeben" ? bewertet : [schluessel.bewertungen, schluessel.runden, schluessel.berichte]),
  });

export const useRundeAnlegen = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: { stichtag: string; vorschlag: "fortschreiben" | "letzte_runde" }) => auspacken(api.api.v1.fonds[":id"].bewertungsrunde.$post({ param: { id: fondsId }, json })),
    invalidiert: () => [schluessel.runden, schluessel.bewertungen],
  });

export const useRundeAktion = () =>
  useApiMutation({
    aufruf: async ({ id, aktion }: { id: string; aktion: BewertungAktion }) => {
      const param = { param: { id } };
      return aktion === "freigeben" ? auspacken(api.api.v1.bewertungsrunden[":id"].freigeben.$post(param)) : auspacken(api.api.v1.bewertungsrunden[":id"].verwerfen.$post(param));
    },
    invalidiert: (_ergebnis, { aktion }) => (aktion === "freigeben" ? bewertet : [schluessel.runden, schluessel.bewertungen, schluessel.berichte]),
  });

export const useBerichtAnlegen = () =>
  useApiMutation({
    aufruf: (json: NeuerBericht) => auspacken(api.api.v1.berichte.$post({ json })),
    invalidiert: () => [schluessel.berichte],
  });

/** Gibt die Mitteilungen zu einer Kapitalbewegung frei: je Investor eine PDF, eine Sprache für alle, einmal je Bewegung. */
export const useMitteilungenFreigeben = (fondsId: string) =>
  useApiMutation({
    aufruf: ({ bewegungId, sprache, perMail = false }: { bewegungId: string; sprache: "de" | "en"; perMail?: boolean }) =>
      auspacken(api.api.v1.fonds[":id"].bewegungen[":bewegungId"].mitteilungen.freigeben.$post({ param: { id: fondsId, bewegungId }, json: { sprache, ...(perMail ? { perMail } : {}) } })),
    // Die Bewegungsliste zeigt den Stand der Mitteilungen; die Änderungsabfrage bleibt unberührt.
    invalidiert: () => [[...schluessel.bewegungen, fondsId]],
  });

export const useAbschnittSetzen = (berichtId: string) =>
  useApiMutation({
    aufruf: ({ schluessel: name, textDe, textEn }: { schluessel: string; textDe?: string; textEn?: string }) =>
      auspacken(api.api.v1.berichte[":id"].abschnitte[":schluessel"].$put({ param: { id: berichtId, schluessel: name }, json: { ...(textDe !== undefined ? { textDe } : {}), ...(textEn !== undefined ? { textEn } : {}) } })),
    invalidiert: () => [[...schluessel.berichte, "detail", berichtId]],
  });

/** Eine Stufe erteilen oder zurückgeben; die letzte Stufe erzeugt die Datei und hält den Stand fest. */
export const useBerichtigungAnlegen = (id: string) =>
  useApiMutation({
    aufruf: (grund: string) => auspacken(api.api.v1.berichte[":id"].berichtigung.$post({ param: { id }, json: { grund } })),
    invalidiert: () => [schluessel.berichte],
  });

export const useBerichtStufe = (berichtId: string) =>
  useApiMutation({
    aufruf: (json: BerichtStufeEingabe) => auspacken(api.api.v1.berichte[":id"].stufe.$post({ param: { id: berichtId }, json })),
    invalidiert: () => [schluessel.berichte],
  });

export const useVorlageSetzen = (fondsId: string) =>
  useApiMutation({
    aufruf: ({ art, konfiguration }: { art: Berichtsart; konfiguration: Record<string, unknown> }) =>
      auspacken(api.api.v1.fonds[":id"].berichtsvorlagen[":art"].$put({ param: { id: fondsId, art }, json: konfiguration })),
    invalidiert: () => [[...schluessel.vorlagen, "vorlagen", fondsId]],
  });

export const useStufenSetzen = (fondsId: string) =>
  useApiMutation({
    aufruf: (stufen: string[]) => auspacken(api.api.v1.fonds[":id"].freigabestufen.$put({ param: { id: fondsId }, json: { stufen } })),
    invalidiert: () => [[...schluessel.vorlagen, "stufen", fondsId]],
  });

/** Die Vorschau des Verkaufs schreibt nichts (Entscheidung 118). */
export const useVerkaufVorschau = (id: string) =>
  useApiMutation({
    aufruf: (json: VerkaufEingabe) => auspacken(api.api.v1.beteiligungen[":id"].verkauf.vorschau.$post({ param: { id }, json })),
    invalidiert: () => [],
  });

export const useVerkaufStorno = () =>
  useApiMutation({
    aufruf: ({ id, grund }: { id: string; grund: string }) => auspacken(api.api.v1.verkaeufe[":id"].storno.$post({ param: { id }, json: { grund } })),
    invalidiert: () => [...bestand, schluessel.bewertungen, schluessel.berichte],
  });

// Anteilsklassen und Exit-Wasserfall (Etappe 10) ---------------------------------------------------------------------------

export type NeueAnteilsklasse = Eingabe<(typeof api.api.v1.organisationen)[":id"]["anteilsklassen"]["$post"]>["json"];
export type AnteilsklasseAenderung = Eingabe<(typeof api.api.v1.organisationen)[":id"]["anteilsklassen"][":klasseId"]["$patch"]>["json"];
export type WasserfallEingabe = Eingabe<(typeof api.api.v1.beteiligungen)[":id"]["wasserfall"]["$post"]>["json"];

/** Klassen und Positionen ändern Kapitaltabelle und Kurve der Beteiligungen des Unternehmens. */
const kapitalGeaendert = [schluessel.organisationen, schluessel.beteiligungen] as const;

export type NeuesVehikel = Eingabe<(typeof api.api.v1.organisationen)[":id"]["vehikel"]["$post"]>["json"];
export type VehikelAenderung = Eingabe<(typeof api.api.v1.vehikel)[":id"]["$patch"]>["json"];

/** Vehikel stehen in Organisationen, Runden und Kapitaltabellen: beide Bereiche neu laden. */
export const useVehikelAnlegen = () =>
  useApiMutation({
    aufruf: ({ organisationId, ...json }: { organisationId: string } & NeuesVehikel) => auspacken(api.api.v1.organisationen[":id"].vehikel.$post({ param: { id: organisationId }, json })),
    invalidiert: () => kapitalGeaendert,
  });

export const useVehikelAendern = () =>
  useApiMutation({
    aufruf: ({ id, ...json }: { id: string } & VehikelAenderung) => auspacken(api.api.v1.vehikel[":id"].$patch({ param: { id }, json })),
    invalidiert: () => kapitalGeaendert,
  });

export const useVehikelLoeschen = () =>
  useApiMutation({
    aufruf: async (id: string) => {
      await auspacken(api.api.v1.vehikel[":id"].$delete({ param: { id } }));
    },
    invalidiert: () => kapitalGeaendert,
  });

export const useAnteilsklasseAnlegen = (organisationId: string) =>
  useApiMutation({
    aufruf: (json: NeueAnteilsklasse) => auspacken(api.api.v1.organisationen[":id"].anteilsklassen.$post({ param: { id: organisationId }, json })),
    invalidiert: () => kapitalGeaendert,
  });

export const useAnteilsklasseAendern = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ klasseId, ...json }: { klasseId: string } & AnteilsklasseAenderung) =>
      auspacken(api.api.v1.organisationen[":id"].anteilsklassen[":klasseId"].$patch({ param: { id: organisationId, klasseId }, json })),
    invalidiert: () => kapitalGeaendert,
  });

/** Klasse einer Position der Runde setzen; `null` macht sie zu Stammanteilen. */
export const usePositionKlasse = () =>
  useApiMutation({
    aufruf: ({ id, anteilsklasseId }: { id: string; anteilsklasseId: string | null }) => auspacken(api.api.v1.rundenpositionen[":id"].$patch({ param: { id }, json: { anteilsklasseId } })),
    invalidiert: () => kapitalGeaendert,
  });

// Mitarbeiterbeteiligung (Pools, Änderungen, Zuteilungen): ändert Kapitaltabelle, Wasserfall und Rundenprüfung.

type Pools = (typeof api.api.v1.organisationen)[":id"]["mitarbeiterpools"];
export type NeuerPool = Eingabe<Pools["$post"]>["json"];
export type NeuePoolAenderung = Eingabe<Pools[":poolId"]["aenderungen"]["$post"]>["json"];
export type PoolAenderungAenderung = Eingabe<Pools[":poolId"]["aenderungen"][":aenderungId"]["$patch"]>["json"];
export type NeueZuteilung = Eingabe<Pools[":poolId"]["zuteilungen"]["$post"]>["json"];
export type ZuteilungAenderung = Eingabe<Pools[":poolId"]["zuteilungen"][":zuteilungId"]["$patch"]>["json"];
type Austritte = Pools[":poolId"]["zuteilungen"][":zuteilungId"]["austritte"];
export type NeuerAustritt = Eingabe<Austritte["$post"]>["json"];
export type AustrittAenderung = Eingabe<Austritte[":austrittId"]["$patch"]>["json"];
type AustrittZiel = { poolId: string; zuteilungId: string };

export const usePoolAnlegen = (organisationId: string) =>
  useApiMutation({
    aufruf: (json: NeuerPool) => auspacken(api.api.v1.organisationen[":id"].mitarbeiterpools.$post({ param: { id: organisationId }, json })),
    invalidiert: () => kapitalGeaendert,
  });

export const usePoolAenderung = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ poolId, ...json }: { poolId: string } & NeuePoolAenderung) =>
      auspacken(api.api.v1.organisationen[":id"].mitarbeiterpools[":poolId"].aenderungen.$post({ param: { id: organisationId, poolId }, json })),
    invalidiert: () => kapitalGeaendert,
  });

/** Einzelne Änderung der Größe ändern oder löschen (Entscheidung 506). */
export const usePoolAenderungAendern = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ poolId, aenderungId, ...json }: { poolId: string; aenderungId: string } & PoolAenderungAenderung) =>
      auspacken(api.api.v1.organisationen[":id"].mitarbeiterpools[":poolId"].aenderungen[":aenderungId"].$patch({ param: { id: organisationId, poolId, aenderungId }, json })),
    invalidiert: () => kapitalGeaendert,
  });

export const usePoolAenderungLoeschen = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ poolId, aenderungId }: { poolId: string; aenderungId: string }) =>
      auspacken(api.api.v1.organisationen[":id"].mitarbeiterpools[":poolId"].aenderungen[":aenderungId"].$delete({ param: { id: organisationId, poolId, aenderungId } })),
    invalidiert: () => kapitalGeaendert,
  });

export const useZuteilungAnlegen = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ poolId, ...json }: { poolId: string } & NeueZuteilung) =>
      auspacken(api.api.v1.organisationen[":id"].mitarbeiterpools[":poolId"].zuteilungen.$post({ param: { id: organisationId, poolId }, json })),
    invalidiert: () => kapitalGeaendert,
  });

export const useZuteilungAendern = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ poolId, zuteilungId, ...json }: { poolId: string; zuteilungId: string } & ZuteilungAenderung) =>
      auspacken(api.api.v1.organisationen[":id"].mitarbeiterpools[":poolId"].zuteilungen[":zuteilungId"].$patch({ param: { id: organisationId, poolId, zuteilungId }, json })),
    invalidiert: () => kapitalGeaendert,
  });

/** Austritte (Leaver) einer Zuteilung: Antwort ist jeweils die ganze Zuteilung. */
export const useAustrittAnlegen = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ poolId, zuteilungId, ...json }: AustrittZiel & NeuerAustritt) =>
      auspacken(api.api.v1.organisationen[":id"].mitarbeiterpools[":poolId"].zuteilungen[":zuteilungId"].austritte.$post({ param: { id: organisationId, poolId, zuteilungId }, json })),
    invalidiert: () => kapitalGeaendert,
  });

export const useAustrittAendern = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ poolId, zuteilungId, austrittId, ...json }: AustrittZiel & { austrittId: string } & AustrittAenderung) =>
      auspacken(api.api.v1.organisationen[":id"].mitarbeiterpools[":poolId"].zuteilungen[":zuteilungId"].austritte[":austrittId"].$patch({ param: { id: organisationId, poolId, zuteilungId, austrittId }, json })),
    invalidiert: () => kapitalGeaendert,
  });

export const useAustrittEntfernen = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ poolId, zuteilungId, austrittId }: AustrittZiel & { austrittId: string }) =>
      auspacken(api.api.v1.organisationen[":id"].mitarbeiterpools[":poolId"].zuteilungen[":zuteilungId"].austritte[":austrittId"].$delete({ param: { id: organisationId, poolId, zuteilungId, austrittId } })),
    invalidiert: () => kapitalGeaendert,
  });

/** Der Wasserfall ist eine Berechnung per POST, sie schreibt nichts und entwertet nichts. */
export const useWasserfall = (beteiligungId: string) =>
  useApiMutation({
    aufruf: (json: WasserfallEingabe) => auspacken(api.api.v1.beteiligungen[":id"].wasserfall.$post({ param: { id: beteiligungId }, json })),
    invalidiert: () => [],
  });

// Finanzierungsrunden von Hand und Journal (Etappe 4b) ---------------------------------------------------------------------------

export type NeueRunde = Eingabe<(typeof api.api.v1.organisationen)[":id"]["finanzierungsrunden"]["$post"]>["json"];
export type RundenAbschluss = Eingabe<(typeof api.api.v1.finanzierungsrunden)[":id"]["abschliessen"]["$post"]>["json"];
export type RundenAenderung = Eingabe<(typeof api.api.v1.finanzierungsrunden)[":id"]["$patch"]>["json"];
export type NeueRundenPosition = Eingabe<(typeof api.api.v1.finanzierungsrunden)[":id"]["positionen"]["$post"]>["json"];
export type RundenPositionAenderung = Eingabe<(typeof api.api.v1.finanzierungsrunden)[":id"]["positionen"][":positionId"]["$patch"]>["json"];
export type NeueBuchung = Eingabe<(typeof api.api.v1.fonds)[":id"]["buchungen"]["$post"]>["json"];
export type NeueZahlung = Eingabe<(typeof api.api.v1.rundenpositionen)[":id"]["zahlungen"]["$post"]>["json"];

/** Runden und Positionen stehen unter `beteiligungen`; ein Abschluss kann Vorgänge buchen, daher auch Fonds und Zinsläufe. */
export const useFinanzierungsrundeAnlegen = (organisationId: string) =>
  useApiMutation({
    aufruf: (json: NeueRunde) => auspacken(api.api.v1.organisationen[":id"].finanzierungsrunden.$post({ param: { id: organisationId }, json })),
    invalidiert: () => bestandMitPools,
  });

/** Entwurf ändern: Stammdaten der Runde (`null` leitet Post-Money und Anteile nach der Runde wieder aus den Positionen ab). */
export const useRundeAendern = () =>
  useApiMutation({
    aufruf: ({ id, ...json }: { id: string } & RundenAenderung) => auspacken(api.api.v1.finanzierungsrunden[":id"].$patch({ param: { id }, json })),
    invalidiert: () => bestandMitPools,
  });

export const useRundenPositionAnlegen = () =>
  useApiMutation({
    aufruf: ({ id, ...json }: { id: string } & NeueRundenPosition) => auspacken(api.api.v1.finanzierungsrunden[":id"].positionen.$post({ param: { id }, json })),
    invalidiert: () => bestand,
  });

export const useRundenPositionAendern = () =>
  useApiMutation({
    aufruf: ({ id, positionId, ...json }: { id: string; positionId: string } & RundenPositionAenderung) =>
      auspacken(api.api.v1.finanzierungsrunden[":id"].positionen[":positionId"].$patch({ param: { id, positionId }, json })),
    invalidiert: () => bestand,
  });

export const useRundenPositionEntfernen = () =>
  useApiMutation({
    aufruf: ({ id, positionId }: { id: string; positionId: string }) => auspacken(api.api.v1.finanzierungsrunden[":id"].positionen[":positionId"].$delete({ param: { id, positionId } })),
    invalidiert: () => bestand,
  });

export const useRundeAbschliessen = () =>
  useApiMutation({
    aufruf: ({ id, ...json }: { id: string } & RundenAbschluss) => auspacken(api.api.v1.finanzierungsrunden[":id"].abschliessen.$post({ param: { id }, json })),
    invalidiert: () => bestand,
  });

export const useRundeWiedereroeffnen = () =>
  useApiMutation({
    aufruf: ({ id, grund }: { id: string; grund: string }) => auspacken(api.api.v1.finanzierungsrunden[":id"].wiedereroeffnen.$post({ param: { id }, json: { grund } })),
    invalidiert: () => bestand,
  });

export const useRundeLoeschen = () =>
  useApiMutation({
    aufruf: ({ id }: { id: string }) => auspacken(api.api.v1.finanzierungsrunden[":id"].$delete({ param: { id } })),
    invalidiert: () => bestandMitPools,
  });

export const useZahlungAnlegen = () =>
  useApiMutation({
    aufruf: ({ positionId, ...json }: { positionId: string } & NeueZahlung) => auspacken(api.api.v1.rundenpositionen[":id"].zahlungen.$post({ param: { id: positionId }, json })),
    invalidiert: () => bestand,
  });

/** Einheitliche Buchung (alle Arten); entwertet Fonds und Beteiligungen und damit das Journal. */
export const useBuchungAnlegen = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: NeueBuchung) => auspacken(api.api.v1.fonds[":id"].buchungen.$post({ param: { id: fondsId }, json })),
    invalidiert: (_ergebnis, json) => (json.typ === "fondsbewegung" ? [...bestand, [...schluessel.bewegungen, fondsId]] : bestand),
  });

export const useBewegungStorno = () =>
  useApiMutation({
    aufruf: ({ id, grund, valuta }: { id: string; grund: string; valuta?: string | undefined }) =>
      auspacken(api.api.v1.fondsbewegungen[":id"].storno.$post({ param: { id }, json: { grund, ...(valuta ? { valuta } : {}) } })),
    invalidiert: () => [...bestand, schluessel.bewegungen],
  });
