import { ausFonds, type FondsEingabe } from "./abbildung-fonds";
import { ausKontakten, type Deutsch } from "./abbildung-kontakte";
import { buchhaltungsAufruf } from "./abbildung-buchhaltung";
import type { Deutsch as BuchhaltungDeutsch } from "@carraway/api/buchhaltung/abbildung";
import { auspackenPortfolio, type PortfolioEingabe } from "./abbildung-portfolio";
import { useMutation, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import type { InferRequestType } from "hono/client";
import { api, auspacken } from "./client";
import { dealDetail, dealListe, schluessel, type Deal, type DealDetail } from "./abfragen";
import type { Berichtsart } from "../lib/berichte";
import { ausBerichteBereich, type BerichteEingabe } from "./abbildung-berichte";

const ausBeschlussvorlagen = ausBerichteBereich("resolution");
const ausBerichten = ausBerichteBereich("report");

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

export type NeueOrganisation = Deutsch<Eingabe<(typeof api.api.v1.organizations)["$post"]>["json"]>;
export type OrganisationAenderung = Deutsch<Eingabe<(typeof api.api.v1.organizations)[":id"]["$patch"]>["json"]>;
export type NeuePerson = Deutsch<Eingabe<(typeof api.api.v1.people)["$post"]>["json"]>;
export type PersonAenderung = Deutsch<Eingabe<(typeof api.api.v1.people)[":id"]["$patch"]>["json"]>;
export type NeueAktivitaet = Deutsch<Eingabe<(typeof api.api.v1.activities)["$post"]>["json"]>;
export type NeuerDeal = Deutsch<Eingabe<(typeof api.api.v1.deals)["$post"]>["json"]>;
export type DealAenderung = Deutsch<Eingabe<(typeof api.api.v1.deals)[":id"]["$patch"]>["json"]>;
export type DealPhase = Deutsch<Eingabe<(typeof api.api.v1.deals)[":id"]["stage"]["$post"]>["json"]>["nachPhase"];
export type NeuerBeschluss = Deutsch<Eingabe<(typeof api.api.v1.deals)[":id"]["resolutions"]["$post"]>["json"]>;
export type NeueBeteiligung = Deutsch<Eingabe<(typeof api.api.v1.deals)[":id"]["investment"]["$post"]>["json"]>;

export const useOrganisationAnlegen = () =>
  useApiMutation({
    aufruf: (json: NeueOrganisation) => ausKontakten(api.api.v1.organizations.$post, { json }),
    invalidiert: () => [schluessel.organisationListe],
  });

export const useOrganisationAendern = (id: string) =>
  useApiMutation({
    aufruf: (json: OrganisationAenderung) => ausKontakten(api.api.v1.organizations[":id"].$patch, { param: { id }, json }),
    // Der Name steht auch in den Deals und in den Beteiligungen der Fondsübersicht.
    invalidiert: () => [schluessel.organisationDetail(id), schluessel.organisationListe, schluessel.dealListe, schluessel.dealArbeitsliste, schluessel.deals, schluessel.fonds, schluessel.beteiligungen],
  });

/** Ohne `organisationId` entsteht ein Kontakt ohne Unternehmen (oder mit dem im Körper gewählten). */
export const usePersonAnlegen = (organisationId?: string) =>
  useApiMutation({
    aufruf: (json: NeuePerson) => ausKontakten(api.api.v1.people.$post, { json: { ...json, ...(organisationId ? { organisationId } : {}) } }),
    invalidiert: () => [...(organisationId ? [schluessel.organisationDetail(organisationId)] : [schluessel.organisationen]), schluessel.personen, ["crm"] as const, [...schluessel.deals, "detail"]],
  });

export const usePersonAendern = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ id, json }: { id: string; json: PersonAenderung }) => ausKontakten(api.api.v1.people[":id"].$patch, { param: { id }, json }),
    invalidiert: () => [schluessel.organisationDetail(organisationId), schluessel.personen, ["crm"] as const, [...schluessel.deals, "detail"]],
  });

export type NeueRolle = Deutsch<Eingabe<(typeof api.api.v1["contact-roles"])["$post"]>["json"]>;
export type NeueBeziehung = Deutsch<Eingabe<(typeof api.api.v1["organization-relationships"])["$post"]>["json"]>;
export type KontaktimportEingabe = Deutsch<Eingabe<(typeof api.api.v1["contact-import"])["$post"]>["json"]>;
export type NeueVorlage = BerichteEingabe<"resolution", (typeof api.api.v1["resolution-templates"])["$post"]>["json"];
export type VorlageAenderung = BerichteEingabe<"resolution", (typeof api.api.v1["resolution-templates"])[":id"]["$patch"]>["json"];
export type OrganisationenZusammenfuehren = Deutsch<Eingabe<(typeof api.api.v1.organizations)[":id"]["merge"]["$post"]>["json"]>;
export type PersonenZusammenfuehren = Deutsch<Eingabe<(typeof api.api.v1.people)[":id"]["merge"]["$post"]>["json"]>;

/** Rollen und Beziehungen stehen auf Organisation, Person und Deal (Personenliste). */
const kontaktdaten = [schluessel.organisationen, schluessel.personen, [...schluessel.deals, "detail"]] as const;

export const useRolleAnlegen = () =>
  useApiMutation({ aufruf: (json: NeueRolle) => ausKontakten(api.api.v1["contact-roles"].$post, { json }), invalidiert: () => kontaktdaten });
export const useRolleLoeschen = () =>
  useApiMutation({ aufruf: (id: string) => ausKontakten(api.api.v1["contact-roles"][":id"].$delete, { param: { id } }), invalidiert: () => kontaktdaten });
export const useBeziehungAnlegen = () =>
  useApiMutation({ aufruf: (json: NeueBeziehung) => ausKontakten(api.api.v1["organization-relationships"].$post, { json }), invalidiert: () => [schluessel.organisationen] });
export const useBeziehungLoeschen = () =>
  useApiMutation({ aufruf: (id: string) => ausKontakten(api.api.v1["organization-relationships"][":id"].$delete, { param: { id } }), invalidiert: () => [schluessel.organisationen] });

/** Die Vorschau schreibt nichts. */
export const useOrganisationenVorschau = () =>
  useApiMutation({
    aufruf: ({ id, quelleId }: { id: string; quelleId: string }) => ausKontakten(api.api.v1.organizations[":id"].merge.preview.$post, { param: { id }, json: { quelleId } }),
    invalidiert: () => [],
  });
export const useOrganisationenZusammenfuehren = () =>
  useApiMutation({
    aufruf: ({ id, json }: { id: string; json: OrganisationenZusammenfuehren }) => ausKontakten(api.api.v1.organizations[":id"].merge.$post, { param: { id }, json }),
    // Verweise wechseln den Besitzer: Kontakte, Deals, Fonds, Beteiligungen, Aktivitäten, Wiedervorlagen
    invalidiert: () => [...kontaktdaten, schluessel.deals, schluessel.fonds, schluessel.beteiligungen, schluessel.aktivitaeten, schluessel.wiedervorlagen, ["suche"]],
  });
export const usePersonenVorschau = () =>
  useApiMutation({
    aufruf: ({ id, quelleId }: { id: string; quelleId: string }) => ausKontakten(api.api.v1.people[":id"].merge.preview.$post, { param: { id }, json: { quelleId } }),
    invalidiert: () => [],
  });
export const usePersonenZusammenfuehren = () =>
  useApiMutation({
    aufruf: ({ id, json }: { id: string; json: PersonenZusammenfuehren }) => ausKontakten(api.api.v1.people[":id"].merge.$post, { param: { id }, json }),
    invalidiert: () => [...kontaktdaten, schluessel.aktivitaeten, schluessel.wiedervorlagen, ["suche"]],
  });

export const useKontaktimportVorschau = () =>
  useApiMutation({
    aufruf: (json: KontaktimportEingabe) => ausKontakten(api.api.v1["contact-import"].preview.$post, { json }),
    invalidiert: () => [],
  });
export const useKontaktimport = () =>
  useApiMutation({
    aufruf: (json: KontaktimportEingabe) => ausKontakten(api.api.v1["contact-import"].$post, { json }),
    invalidiert: () => [...kontaktdaten, ["suche"]],
  });

export const useWiedervorlageZurueckstellen = () =>
  useApiMutation({
    aufruf: ({ id, datum }: { id: string; datum: string }) => ausKontakten(api.api.v1.activities[":id"].reschedule.$post, { param: { id }, json: { datum } }),
    invalidiert: () => [schluessel.wiedervorlagen, schluessel.aktivitaeten, [...schluessel.deals, "detail"]],
  });

export const useVorlageAnlegen = () =>
  useApiMutation({ aufruf: (json: NeueVorlage) => ausBeschlussvorlagen(api.api.v1["resolution-templates"].$post, { json }), invalidiert: () => [schluessel.beschlussvorlagen] });
export const useVorlageAendern = () =>
  useApiMutation({
    aufruf: ({ id, json }: { id: string; json: VorlageAenderung }) => ausBeschlussvorlagen(api.api.v1["resolution-templates"][":id"].$patch, { param: { id }, json }),
    invalidiert: () => [schluessel.beschlussvorlagen],
  });
export const useVorlageLoeschen = () =>
  useApiMutation({ aufruf: (id: string) => ausBeschlussvorlagen(api.api.v1["resolution-templates"][":id"].$delete, { param: { id } }), invalidiert: () => [schluessel.beschlussvorlagen] });
export const useBeschlussvorschlagAusVorlage = (id: string) =>
  useApiMutation({
    aufruf: (json: { vorlageId: string; instrument?: NeueBeteiligung["instrument"] | undefined; sprache: "de" | "en" }) =>
      ausKontakten(api.api.v1.deals[":id"]["draft-resolution"].$post, { param: { id }, json: { vorlageId: json.vorlageId, sprache: json.sprache, ...(json.instrument ? { instrument: json.instrument } : {}) } }),
    invalidiert: () => [schluessel.dealDetail(id)],
  });

export const useAktivitaetAnlegen = () =>
  useApiMutation({
    aufruf: (json: NeueAktivitaet) => ausKontakten(api.api.v1.activities.$post, { json }),
    invalidiert: (_neu, eingabe) => [
      schluessel.aktivitaeten,
      ...(eingabe.dealId ? [schluessel.dealDetail(eingabe.dealId)] : []),
      ...(eingabe.wiedervorlage ? [schluessel.wiedervorlagen] : []),
    ],
  });

export const useWiedervorlageErledigt = () =>
  useApiMutation({
    aufruf: (id: string) => ausKontakten(api.api.v1.activities[":id"].complete.$post, { param: { id } }),
    invalidiert: () => [schluessel.wiedervorlagen, schluessel.aktivitaeten, [...schluessel.deals, "detail"]],
  });

export const useDealAnlegen = () =>
  useApiMutation({
    aufruf: (json: NeuerDeal) => ausKontakten(api.api.v1.deals.$post, { json }),
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
    aufruf: (json: DealAenderung) => ausKontakten(api.api.v1.deals[":id"].$patch, { param: { id }, json }),
    invalidiert: (_neu, eingabe) => [
      schluessel.dealDetail(id), schluessel.dealListe, schluessel.dealArbeitsliste, [...schluessel.organisationen, "detail"],
      ...(eingabe.dealtyp !== undefined ? [["crm", "board", "deal"], ["crm", "abfrage", "deal"], ["crm", "datensatz", "deal", id]] : []),
    ],
  });

/** Phasenwechsel: Liste und Detail springen sofort, bei einem Fehler kehren beide zurück. */
export const usePhaseAendern = () =>
  useApiMutation({
    aufruf: ({ id, nachPhase }: { id: string; nachPhase: DealPhase }) => ausKontakten(api.api.v1.deals[":id"].stage.$post, { param: { id }, json: { nachPhase } }),
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
    aufruf: (grund: string) => ausKontakten(api.api.v1.deals[":id"].decline.$post, { param: { id }, json: { grund } }),
    invalidiert: () => [["crm", "board", "deal"], schluessel.dealDetail(id), schluessel.dealListe, schluessel.dealArbeitsliste, schluessel.trichter, [...schluessel.organisationen, "detail"]],
  });

export const useDealWiederaufnehmen = (id: string) =>
  useApiMutation({
    aufruf: () => ausKontakten(api.api.v1.deals[":id"].reopen.$post, { param: { id } }),
    invalidiert: () => [["crm", "board", "deal"], schluessel.dealDetail(id), schluessel.dealListe, schluessel.dealArbeitsliste, schluessel.trichter, [...schluessel.organisationen, "detail"]],
  });

export const useBeschlussAnlegen = (id: string) =>
  useApiMutation({
    aufruf: (json: NeuerBeschluss) => ausKontakten(api.api.v1.deals[":id"].resolutions.$post, { param: { id }, json }),
    invalidiert: () => [schluessel.dealDetail(id)],
  });

/** Übergang ins Portfolio: neue Beteiligung, Deal wird „investiert“, die Fondsübersicht ändert sich. */
export const useInsPortfolio = (id: string) =>
  useApiMutation({
    aufruf: (json: NeueBeteiligung) => ausKontakten(api.api.v1.deals[":id"].investment.$post, { param: { id }, json }),
    invalidiert: () => [["crm", "board", "deal"], schluessel.dealDetail(id), schluessel.dealListe, schluessel.dealArbeitsliste, schluessel.fonds, schluessel.beteiligungen, schluessel.trichter, [...schluessel.organisationen, "detail"]],
  });

/**
 * Fordert die Neuberechnung des Snapshots an (202). Der Worker rechnet im Hintergrund; die Seite fragt danach
 * die Übersicht in Abständen neu ab, bis sich `berechnetAm` ändert (siehe `Portfolio.tsx`). Deshalb entwertet die Mutation nichts.
 */
export const useNeuberechnen = (fondsId: string) =>
  useApiMutation({
    aufruf: (stichtag: string) => ausFonds(api.api.v1.funds[":id"].recalculate.$post, { param: { id: fondsId }, query: { stichtag } }),
    invalidiert: () => [],
  });

// Instrumente und Zinsen (Etappe 4) ---------------------------------------------------------------------------------

type BeteiligungsRoute = (typeof api.api.v1.investments)[":id"];
export type NeuerVorgang = BuchhaltungDeutsch<Eingabe<(typeof api.api.v1.investments)[":id"]["transactions"]["$post"]>["json"]>;
export type NeueKondition = PortfolioEingabe<BeteiligungsRoute["terms"]["$post"]>["json"];
export type NeuesInstrument = PortfolioEingabe<BeteiligungsRoute["instruments"]["$post"]>["json"];
export type InstrumentAenderung = PortfolioEingabe<(typeof api.api.v1.instruments)[":id"]["$patch"]>["json"];
export type NeueTranche = PortfolioEingabe<(typeof api.api.v1.instruments)[":id"]["tranches"]["$post"]>["json"];
export type TrancheAenderung = FondsEingabe<(typeof api.api.v1.tranches)[":id"]["$patch"]>["json"];
export type WandlungEingabe = PortfolioEingabe<BeteiligungsRoute["conversion"]["$post"]>["json"];
export type VerkaufEingabe = PortfolioEingabe<BeteiligungsRoute["sale"]["$post"]>["json"];
export type AnpassungEingabe = PortfolioEingabe<BeteiligungsRoute["purchase-price-adjustment"]["$post"]>["json"];
export type InsolvenzEingabe = PortfolioEingabe<BeteiligungsRoute["insolvency"]["$post"]>["json"];

/** Eine Änderung an Vorgängen, Konditionen oder Beständen verschiebt Kennzahlen, Buchwert, Abgrenzung und Zinsläufe. */
const bestand = [schluessel.beteiligungen, schluessel.fonds, schluessel.zinslaeufe] as const;
/** Anlegen, Ändern und Löschen einer Runde können die Pools der Mitarbeiterbeteiligung ändern (Aufstockung, Datum, leerer Pool). */
const bestandMitPools = [...bestand, schluessel.organisationen] as const;

export const useVorgangAnlegen = (id: string) =>
  useApiMutation({
    aufruf: (json: NeuerVorgang) => buchhaltungsAufruf((en) => api.api.v1.investments[":id"].transactions.$post(en({ param: { id }, json }))),
    invalidiert: () => bestand,
  });

/** Ordnet einen Vorgang einer Runde des Unternehmens zu (`null` = keiner Runde); die Zuordnung steht unter `beteiligungen` (Rundentransaktionen). */
export const useVorgangRundeAendern = () =>
  useApiMutation({
    aufruf: ({ id, rundeId }: { id: string; rundeId: string | null }) => buchhaltungsAufruf((en) => api.api.v1.transactions[":id"].round.$put(en({ param: { id }, json: { rundeId } }))),
    invalidiert: () => bestand,
  });

export const useStorno = () =>
  useApiMutation({
    aufruf: ({ id, grund, valuta }: { id: string; grund: string; valuta?: string | undefined }) =>
      buchhaltungsAufruf((en) => api.api.v1.transactions[":id"].reverse.$post(en({ param: { id }, json: { grund, ...(valuta ? { valuta } : {}) } }))),
    invalidiert: () => bestand,
  });

export const useKonditionAnlegen = (id: string) =>
  useApiMutation({
    aufruf: (json: NeueKondition) => auspackenPortfolio(api.api.v1.investments[":id"].terms.$post, { param: { id }, json }),
    invalidiert: () => bestand,
  });

/** Ein neues Instrument, eine Tranche (mit ihrer Zusage) oder deren Änderung verschiebt Zusage, Buchwert und Kennzahlen. */
export const useInstrumentAnlegen = (beteiligungId: string) =>
  useApiMutation({
    aufruf: (json: NeuesInstrument) => auspackenPortfolio(api.api.v1.investments[":id"].instruments.$post, { param: { id: beteiligungId }, json }),
    invalidiert: () => bestand,
  });

export const useInstrumentAendern = () =>
  useApiMutation({
    aufruf: ({ id, ...json }: { id: string } & InstrumentAenderung) => auspackenPortfolio(api.api.v1.instruments[":id"].$patch, { param: { id }, json }),
    invalidiert: () => bestand,
  });

export const useTrancheAnlegen = () =>
  useApiMutation({
    aufruf: ({ instrumentId, ...json }: { instrumentId: string } & NeueTranche) => auspackenPortfolio(api.api.v1.instruments[":id"].tranches.$post, { param: { id: instrumentId }, json }),
    invalidiert: () => bestand,
  });

export const useTrancheAendern = () =>
  useApiMutation({
    aufruf: ({ id, ...json }: { id: string } & TrancheAenderung) => ausFonds(api.api.v1.tranches[":id"].$patch, { param: { id }, json }),
    invalidiert: () => bestand,
  });

export const useTrancheErfuellt = () =>
  useApiMutation({
    aufruf: ({ id, datum, nachweis }: { id: string; datum?: string | undefined; nachweis?: string | undefined }) =>
      ausFonds(api.api.v1.tranches[":id"].fulfill.$post, { param: { id }, json: { ...(datum ? { datum } : {}), ...(nachweis ? { nachweis } : {}) } }),
    invalidiert: () => [schluessel.beteiligungen],
  });

export const useJahresueberschuss = (id: string) =>
  useApiMutation({
    aufruf: ({ jahr, betrag }: { jahr: number; betrag: string }) =>
      auspackenPortfolio(api.api.v1.investments[":id"]["net-income"][":year"].$put, { param: { id, jahr: String(jahr) }, json: { betrag } }),
    invalidiert: () => [schluessel.beteiligungen, schluessel.fonds],
  });

export const useForderungErfuellt = () =>
  useApiMutation({
    aufruf: ({ id, datum }: { id: string; datum?: string | undefined }) => ausFonds(api.api.v1.receivables[":id"].settle.$post, { param: { id }, json: datum ? { datum } : {} }),
    invalidiert: () => bestand,
  });

/** Die Vorschau schreibt nichts und entwertet nichts. */
export const useWandlungVorschau = (id: string) =>
  useApiMutation({
    aufruf: (json: WandlungEingabe) => auspackenPortfolio(api.api.v1.investments[":id"].conversion.preview.$post, { param: { id }, json }),
    invalidiert: () => [],
  });

export const useWandlung = (id: string) =>
  useApiMutation({
    aufruf: (json: WandlungEingabe) => auspackenPortfolio(api.api.v1.investments[":id"].conversion.$post, { param: { id }, json }),
    invalidiert: () => [...bestand, schluessel.deals],
  });

export const useVerkauf = (id: string) =>
  useApiMutation({
    aufruf: (json: VerkaufEingabe) => auspackenPortfolio(api.api.v1.investments[":id"].sale.$post, { param: { id }, json }),
    invalidiert: () => bestand,
  });

export const useKaufpreisanpassung = (id: string) =>
  useApiMutation({
    aufruf: (json: AnpassungEingabe) => auspackenPortfolio(api.api.v1.investments[":id"]["purchase-price-adjustment"].$post, { param: { id }, json }),
    invalidiert: () => bestand,
  });

export const useInsolvenz = (id: string) =>
  useApiMutation({
    aufruf: (json: InsolvenzEingabe) => auspackenPortfolio(api.api.v1.investments[":id"].insolvency.$post, { param: { id }, json }),
    invalidiert: () => bestand,
  });

export const useZinslaufAnlegen = () =>
  useApiMutation({
    aufruf: (json: { fondsId: string; stichtag: string }) => ausFonds(api.api.v1["interest-runs"].$post, { json }),
    invalidiert: () => [schluessel.zinslaeufe],
  });

const zinslaufAktionen = { pruefen: "review", freigeben: "approve", verwerfen: "discard", buchen: "post" } as const;
export type ZinslaufAktion = keyof typeof zinslaufAktionen;

/** Statusübergang eines Zinslaufs; Buchen verändert außerdem Vorgänge, Kennzahlen und Abgrenzung. */
export const useZinslaufAktion = (id: string) =>
  useApiMutation({
    aufruf: (aktion: ZinslaufAktion) => ausFonds(api.api.v1["interest-runs"][":id"][zinslaufAktionen[aktion]].$post, { param: { id } }),
    invalidiert: (_ergebnis, aktion) => (aktion === "buchen" ? bestand : [schluessel.zinslaeufe]),
  });

// Bewertungen, Runden und Berichte (Etappe 5) ------------------------------------------------------------------------

export type NeueBewertung = PortfolioEingabe<BeteiligungsRoute["valuations"]["$post"]>["json"];
export type NeuerBericht = BerichteEingabe<"report", typeof api.api.v1.reports.$post>["json"];
export type BerichtStufeEingabe = BerichteEingabe<"report", (typeof api.api.v1.reports)[":id"]["stage"]["$post"]>["json"];

/** Eine freigegebene Bewertung ändert NAV, Kennzahlen, Verlauf, Snapshots und die Kontrolle der Berichte. */
const bewertet = [schluessel.bewertungen, schluessel.runden, schluessel.beteiligungen, schluessel.fonds, schluessel.berichte] as const;

export const useBewertungAnlegen = (beteiligungId: string) =>
  useApiMutation({
    aufruf: (json: NeueBewertung) => auspackenPortfolio(api.api.v1.investments[":id"].valuations.$post, { param: { id: beteiligungId }, json }),
    invalidiert: () => [schluessel.bewertungen, schluessel.runden, schluessel.berichte],
  });

export type BewertungAenderung = PortfolioEingabe<(typeof api.api.v1.valuations)[":id"]["$patch"]>["json"];

/** Ändert den Entwurf einer Bewertung (auch in einer Runde); nichts davon zählt, solange er nicht freigegeben ist. */
export const useBewertungAendern = () =>
  useApiMutation({
    aufruf: ({ id, ...json }: { id: string } & BewertungAenderung) => auspackenPortfolio(api.api.v1.valuations[":id"].$patch, { param: { id }, json }),
    invalidiert: () => [schluessel.bewertungen, schluessel.runden, schluessel.berichte],
  });

export type BewertungAktion = "freigeben" | "verwerfen";

export const useBewertungAktion = () =>
  useApiMutation({
    aufruf: async ({ id, aktion }: { id: string; aktion: BewertungAktion }) => {
      const param = { param: { id } };
      return aktion === "freigeben" ? auspackenPortfolio(api.api.v1.valuations[":id"].approve.$post, param) : auspackenPortfolio(api.api.v1.valuations[":id"].discard.$post, param);
    },
    invalidiert: (_ergebnis, { aktion }) => (aktion === "freigeben" ? bewertet : [schluessel.bewertungen, schluessel.runden, schluessel.berichte]),
  });

export const useRundeAnlegen = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: { stichtag: string; vorschlag: "fortschreiben" | "letzte_runde" }) => auspackenPortfolio(api.api.v1.funds[":id"]["valuation-rounds"].$post, { param: { id: fondsId }, json }),
    invalidiert: () => [schluessel.runden, schluessel.bewertungen],
  });

export const useRundeAktion = () =>
  useApiMutation({
    aufruf: async ({ id, aktion }: { id: string; aktion: BewertungAktion }) => {
      const param = { param: { id } };
      return aktion === "freigeben" ? auspackenPortfolio(api.api.v1["valuation-rounds"][":id"].approve.$post, param) : auspackenPortfolio(api.api.v1["valuation-rounds"][":id"].discard.$post, param);
    },
    invalidiert: (_ergebnis, { aktion }) => (aktion === "freigeben" ? bewertet : [schluessel.runden, schluessel.bewertungen, schluessel.berichte]),
  });

export const useBerichtAnlegen = () =>
  useApiMutation({
    aufruf: (json: NeuerBericht) => ausBerichten(api.api.v1.reports.$post, { json }),
    invalidiert: () => [schluessel.berichte],
  });

/** Gibt die Mitteilungen zu einer Kapitalbewegung frei: je Investor eine PDF, eine Sprache für alle, einmal je Bewegung. */
export const useMitteilungenFreigeben = (fondsId: string) =>
  useApiMutation({
    aufruf: ({ bewegungId, sprache, perMail = false }: { bewegungId: string; sprache: "de" | "en"; perMail?: boolean }) =>
      ausFonds(api.api.v1.funds[":id"].movements[":movementId"].notices.approve.$post, { param: { id: fondsId, bewegungId }, json: { sprache, ...(perMail ? { perMail } : {}) } }),
    // Die Bewegungsliste zeigt den Stand der Mitteilungen; die Änderungsabfrage bleibt unberührt.
    invalidiert: () => [[...schluessel.bewegungen, fondsId]],
  });

export const useAbschnittSetzen = (berichtId: string) =>
  useApiMutation({
    aufruf: ({ schluessel: name, textDe, textEn }: { schluessel: string; textDe?: string; textEn?: string }) =>
      ausBerichten(api.api.v1.reports[":id"].sections[":key"].$put, { param: { id: berichtId, schluessel: name }, json: { ...(textDe !== undefined ? { textDe } : {}), ...(textEn !== undefined ? { textEn } : {}) } }),
    invalidiert: () => [[...schluessel.berichte, "detail", berichtId]],
  });

/** Eine Stufe erteilen oder zurückgeben; die letzte Stufe erzeugt die Datei und hält den Stand fest. */
export const useBerichtigungAnlegen = (id: string) =>
  useApiMutation({
    aufruf: (grund: string) => ausBerichten(api.api.v1.reports[":id"].correction.$post, { param: { id }, json: { grund } }),
    invalidiert: () => [schluessel.berichte],
  });

export const useBerichtStufe = (berichtId: string) =>
  useApiMutation({
    aufruf: (json: BerichtStufeEingabe) => ausBerichten(api.api.v1.reports[":id"].stage.$post, { param: { id: berichtId }, json }),
    invalidiert: () => [schluessel.berichte],
  });

export const useVorlageSetzen = (fondsId: string) =>
  useApiMutation({
    aufruf: ({ art, konfiguration }: { art: Berichtsart; konfiguration: Record<string, unknown> }) =>
      ausBerichten(api.api.v1.funds[":id"]["report-templates"][":reportType"].$put, { param: { id: fondsId, art }, json: konfiguration }),
    invalidiert: () => [[...schluessel.vorlagen, "vorlagen", fondsId]],
  });

export const useStufenSetzen = (fondsId: string) =>
  useApiMutation({
    aufruf: (stufen: string[]) => auspacken(api.api.v1.funds[":id"]["approval-stages"].$put({ param: { id: fondsId }, json: { stages: stufen } })),
    invalidiert: () => [[...schluessel.vorlagen, "stufen", fondsId]],
  });

/** Die Vorschau des Verkaufs schreibt nichts (Entscheidung 118). */
export const useVerkaufVorschau = (id: string) =>
  useApiMutation({
    aufruf: (json: VerkaufEingabe) => auspackenPortfolio(api.api.v1.investments[":id"].sale.preview.$post, { param: { id }, json }),
    invalidiert: () => [],
  });

export const useVerkaufStorno = () =>
  useApiMutation({
    aufruf: ({ id, grund }: { id: string; grund: string }) => auspackenPortfolio(api.api.v1.sales[":id"].reverse.$post, { param: { id }, json: { grund } }),
    invalidiert: () => [...bestand, schluessel.bewertungen, schluessel.berichte],
  });

// Anteilsklassen und Exit-Wasserfall (Etappe 10) ---------------------------------------------------------------------------

export type NeueAnteilsklasse = PortfolioEingabe<(typeof api.api.v1.organizations)[":id"]["share-classes"]["$post"]>["json"];
export type AnteilsklasseAenderung = PortfolioEingabe<(typeof api.api.v1.organizations)[":id"]["share-classes"][":classId"]["$patch"]>["json"];
export type WasserfallEingabe = PortfolioEingabe<(typeof api.api.v1.investments)[":id"]["waterfall"]["$post"]>["json"];

/** Klassen und Positionen ändern Kapitaltabelle und Kurve der Beteiligungen des Unternehmens. */
const kapitalGeaendert = [schluessel.organisationen, schluessel.beteiligungen] as const;

export type NeuesVehikel = FondsEingabe<(typeof api.api.v1.organizations)[":id"]["vehicles"]["$post"]>["json"];
export type VehikelAenderung = FondsEingabe<(typeof api.api.v1.vehicles)[":id"]["$patch"]>["json"];

/** Vehikel stehen in Organisationen, Runden und Kapitaltabellen: beide Bereiche neu laden. */
export const useVehikelAnlegen = () =>
  useApiMutation({
    aufruf: ({ organisationId, ...json }: { organisationId: string } & NeuesVehikel) => ausFonds(api.api.v1.organizations[":id"].vehicles.$post, { param: { id: organisationId }, json }),
    invalidiert: () => kapitalGeaendert,
  });

export const useVehikelAendern = () =>
  useApiMutation({
    aufruf: ({ id, ...json }: { id: string } & VehikelAenderung) => ausFonds(api.api.v1.vehicles[":id"].$patch, { param: { id }, json }),
    invalidiert: () => kapitalGeaendert,
  });

export const useVehikelLoeschen = () =>
  useApiMutation({
    aufruf: async (id: string) => {
      await ausFonds(api.api.v1.vehicles[":id"].$delete, { param: { id } });
    },
    invalidiert: () => kapitalGeaendert,
  });

export const useAnteilsklasseAnlegen = (organisationId: string) =>
  useApiMutation({
    aufruf: (json: NeueAnteilsklasse) => auspackenPortfolio(api.api.v1.organizations[":id"]["share-classes"].$post, { param: { id: organisationId }, json }),
    invalidiert: () => kapitalGeaendert,
  });

export const useAnteilsklasseAendern = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ klasseId, ...json }: { klasseId: string } & AnteilsklasseAenderung) =>
      auspackenPortfolio(api.api.v1.organizations[":id"]["share-classes"][":classId"].$patch, { param: { id: organisationId, klasseId }, json }),
    invalidiert: () => kapitalGeaendert,
  });

/** Klasse einer Position der Runde setzen; `null` macht sie zu Stammanteilen. */
export const usePositionKlasse = () =>
  useApiMutation({
    aufruf: ({ id, anteilsklasseId }: { id: string; anteilsklasseId: string | null }) => auspackenPortfolio(api.api.v1["round-positions"][":id"].$patch, { param: { id }, json: { anteilsklasseId } }),
    invalidiert: () => kapitalGeaendert,
  });

// Mitarbeiterbeteiligung (Pools, Änderungen, Zuteilungen): ändert Kapitaltabelle, Wasserfall und Rundenprüfung.

type Pools = (typeof api.api.v1.organizations)[":id"]["employee-pools"];
export type NeuerPool = PortfolioEingabe<Pools["$post"]>["json"];
export type NeuePoolAenderung = PortfolioEingabe<Pools[":poolId"]["changes"]["$post"]>["json"];
export type PoolAenderungAenderung = PortfolioEingabe<Pools[":poolId"]["changes"][":changeId"]["$patch"]>["json"];
export type NeueZuteilung = PortfolioEingabe<Pools[":poolId"]["grants"]["$post"]>["json"];
export type ZuteilungAenderung = PortfolioEingabe<Pools[":poolId"]["grants"][":grantId"]["$patch"]>["json"];
type Austritte = Pools[":poolId"]["grants"][":grantId"]["departures"];
export type NeuerAustritt = PortfolioEingabe<Austritte["$post"]>["json"];
export type AustrittAenderung = PortfolioEingabe<Austritte[":departureId"]["$patch"]>["json"];
type AustrittZiel = { poolId: string; zuteilungId: string };
type MitarbeiterAusuebungen = Pools[":poolId"]["grants"][":grantId"]["exercises"];
type NeueMitarbeiterAusuebung = PortfolioEingabe<MitarbeiterAusuebungen["$post"]>["json"];
type MitarbeiterAusuebungAenderung = PortfolioEingabe<MitarbeiterAusuebungen[":exerciseId"]["$patch"]>["json"];
type MitarbeiterAusuebungZiel = AustrittZiel & { ausuebungId: string };

export const usePoolAnlegen = (organisationId: string) =>
  useApiMutation({
    aufruf: (json: NeuerPool) => auspackenPortfolio(api.api.v1.organizations[":id"]["employee-pools"].$post, { param: { id: organisationId }, json }),
    invalidiert: () => kapitalGeaendert,
  });

export type PoolStammAenderung = PortfolioEingabe<Pools[":poolId"]["$patch"]>["json"];

/** Stammdaten und Erfassung eines Pools (grob oder einzeln, Schätzung). */
export const usePoolAendern = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ poolId, ...json }: { poolId: string } & PoolStammAenderung) => auspackenPortfolio(api.api.v1.organizations[":id"]["employee-pools"][":poolId"].$patch, { param: { id: organisationId, poolId }, json }),
    invalidiert: () => kapitalGeaendert,
  });

export const usePoolAenderung = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ poolId, ...json }: { poolId: string } & NeuePoolAenderung) =>
      auspackenPortfolio(api.api.v1.organizations[":id"]["employee-pools"][":poolId"].changes.$post, { param: { id: organisationId, poolId }, json }),
    invalidiert: () => kapitalGeaendert,
  });

/** Einzelne Änderung der Größe ändern oder löschen (Entscheidung 506). */
export const usePoolAenderungAendern = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ poolId, aenderungId, ...json }: { poolId: string; aenderungId: string } & PoolAenderungAenderung) =>
      auspackenPortfolio(api.api.v1.organizations[":id"]["employee-pools"][":poolId"].changes[":changeId"].$patch, { param: { id: organisationId, poolId, aenderungId }, json }),
    invalidiert: () => kapitalGeaendert,
  });

export const usePoolAenderungLoeschen = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ poolId, aenderungId }: { poolId: string; aenderungId: string }) =>
      auspackenPortfolio(api.api.v1.organizations[":id"]["employee-pools"][":poolId"].changes[":changeId"].$delete, { param: { id: organisationId, poolId, aenderungId } }),
    invalidiert: () => kapitalGeaendert,
  });

export const useZuteilungAnlegen = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ poolId, ...json }: { poolId: string } & NeueZuteilung) =>
      auspackenPortfolio(api.api.v1.organizations[":id"]["employee-pools"][":poolId"].grants.$post, { param: { id: organisationId, poolId }, json }),
    invalidiert: () => kapitalGeaendert,
  });

export const useZuteilungAendern = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ poolId, zuteilungId, ...json }: { poolId: string; zuteilungId: string } & ZuteilungAenderung) =>
      auspackenPortfolio(api.api.v1.organizations[":id"]["employee-pools"][":poolId"].grants[":grantId"].$patch, { param: { id: organisationId, poolId, zuteilungId }, json }),
    invalidiert: () => kapitalGeaendert,
  });

/** Zuteilung entfernen (mit ihren Austritten) oder anonymisieren (Name und Kennung gelöscht, Zahlen bleiben). */
export const useZuteilungLoeschen = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ poolId, zuteilungId }: AustrittZiel) => auspackenPortfolio(api.api.v1.organizations[":id"]["employee-pools"][":poolId"].grants[":grantId"].$delete, { param: { id: organisationId, poolId, zuteilungId } }),
    invalidiert: () => kapitalGeaendert,
  });

export const useZuteilungAnonymisieren = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ poolId, zuteilungId }: AustrittZiel) => auspackenPortfolio(api.api.v1.organizations[":id"]["employee-pools"][":poolId"].grants[":grantId"].anonymize.$post, { param: { id: organisationId, poolId, zuteilungId } }),
    invalidiert: () => kapitalGeaendert,
  });

/** Austritte (Leaver) einer Zuteilung: Antwort ist jeweils die ganze Zuteilung. */
export const useAustrittAnlegen = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ poolId, zuteilungId, ...json }: AustrittZiel & NeuerAustritt) =>
      auspackenPortfolio(api.api.v1.organizations[":id"]["employee-pools"][":poolId"].grants[":grantId"].departures.$post, { param: { id: organisationId, poolId, zuteilungId }, json }),
    invalidiert: () => kapitalGeaendert,
  });

export const useAustrittAendern = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ poolId, zuteilungId, austrittId, ...json }: AustrittZiel & { austrittId: string } & AustrittAenderung) =>
      auspackenPortfolio(api.api.v1.organizations[":id"]["employee-pools"][":poolId"].grants[":grantId"].departures[":departureId"].$patch, { param: { id: organisationId, poolId, zuteilungId, austrittId }, json }),
    invalidiert: () => kapitalGeaendert,
  });

export const useAustrittEntfernen = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ poolId, zuteilungId, austrittId }: AustrittZiel & { austrittId: string }) =>
      auspackenPortfolio(api.api.v1.organizations[":id"]["employee-pools"][":poolId"].grants[":grantId"].departures[":departureId"].$delete, { param: { id: organisationId, poolId, zuteilungId, austrittId } }),
    invalidiert: () => kapitalGeaendert,
  });

export const useMitarbeiterAusuebungAnlegen = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ poolId, zuteilungId, ...json }: AustrittZiel & NeueMitarbeiterAusuebung) =>
      auspackenPortfolio(api.api.v1.organizations[":id"]["employee-pools"][":poolId"].grants[":grantId"].exercises.$post, { param: { id: organisationId, poolId, zuteilungId }, json }),
    invalidiert: () => kapitalGeaendert,
  });

export const useMitarbeiterAusuebungAendern = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ poolId, zuteilungId, ausuebungId, ...json }: MitarbeiterAusuebungZiel & MitarbeiterAusuebungAenderung) =>
      auspackenPortfolio(api.api.v1.organizations[":id"]["employee-pools"][":poolId"].grants[":grantId"].exercises[":exerciseId"].$patch, { param: { id: organisationId, poolId, zuteilungId, ausuebungId }, json }),
    invalidiert: () => kapitalGeaendert,
  });

export const useMitarbeiterAusuebungEntfernen = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ poolId, zuteilungId, ausuebungId }: MitarbeiterAusuebungZiel) =>
      auspackenPortfolio(api.api.v1.organizations[":id"]["employee-pools"][":poolId"].grants[":grantId"].exercises[":exerciseId"].$delete, { param: { id: organisationId, poolId, zuteilungId, ausuebungId } }),
    invalidiert: () => kapitalGeaendert,
  });

/** Der Wasserfall ist eine Berechnung per POST, sie schreibt nichts und entwertet nichts. */
export const useWasserfall = (beteiligungId: string) =>
  useApiMutation({
    aufruf: (json: WasserfallEingabe) => auspackenPortfolio(api.api.v1.investments[":id"].waterfall.$post, { param: { id: beteiligungId }, json }),
    invalidiert: () => [],
  });

// Finanzierungsrunden von Hand und Journal (Etappe 4b) ---------------------------------------------------------------------------

export type NeueRunde = PortfolioEingabe<(typeof api.api.v1.organizations)[":id"]["financing-rounds"]["$post"]>["json"];
export type RundenAbschluss = PortfolioEingabe<(typeof api.api.v1["financing-rounds"])[":id"]["close"]["$post"]>["json"];
export type RundenAenderung = PortfolioEingabe<(typeof api.api.v1["financing-rounds"])[":id"]["$patch"]>["json"];
export type NeueRundenPosition = PortfolioEingabe<(typeof api.api.v1["financing-rounds"])[":id"]["positions"]["$post"]>["json"];
export type RundenPositionAenderung = PortfolioEingabe<(typeof api.api.v1["financing-rounds"])[":id"]["positions"][":positionId"]["$patch"]>["json"];
export type NeueBuchung = BuchhaltungDeutsch<Eingabe<(typeof api.api.v1.funds)[":id"]["postings"]["$post"]>["json"]>;
export type NeueZahlung = PortfolioEingabe<(typeof api.api.v1["round-positions"])[":id"]["payments"]["$post"]>["json"];

/** Runden und Positionen stehen unter `beteiligungen`; ein Abschluss kann Vorgänge buchen, daher auch Fonds und Zinsläufe. */
export const useFinanzierungsrundeAnlegen = (organisationId: string) =>
  useApiMutation({
    aufruf: (json: NeueRunde) => auspackenPortfolio(api.api.v1.organizations[":id"]["financing-rounds"].$post, { param: { id: organisationId }, json }),
    invalidiert: () => bestandMitPools,
  });

/** Entwurf ändern: Stammdaten der Runde (`null` leitet Post-Money und Anteile nach der Runde wieder aus den Positionen ab). */
export const useRundeAendern = () =>
  useApiMutation({
    aufruf: ({ id, ...json }: { id: string } & RundenAenderung) => auspackenPortfolio(api.api.v1["financing-rounds"][":id"].$patch, { param: { id }, json }),
    invalidiert: () => bestandMitPools,
  });

export const useRundenPositionAnlegen = () =>
  useApiMutation({
    aufruf: ({ id, ...json }: { id: string } & NeueRundenPosition) => auspackenPortfolio(api.api.v1["financing-rounds"][":id"].positions.$post, { param: { id }, json }),
    invalidiert: () => bestand,
  });

export const useRundenPositionAendern = () =>
  useApiMutation({
    aufruf: ({ id, positionId, ...json }: { id: string; positionId: string } & RundenPositionAenderung) =>
      auspackenPortfolio(api.api.v1["financing-rounds"][":id"].positions[":positionId"].$patch, { param: { id, positionId }, json }),
    invalidiert: () => bestand,
  });

export const useRundenPositionEntfernen = () =>
  useApiMutation({
    aufruf: ({ id, positionId }: { id: string; positionId: string }) => auspackenPortfolio(api.api.v1["financing-rounds"][":id"].positions[":positionId"].$delete, { param: { id, positionId } }),
    invalidiert: () => bestand,
  });

export const useRundeAbschliessen = () =>
  useApiMutation({
    aufruf: ({ id, ...json }: { id: string } & RundenAbschluss) => auspackenPortfolio(api.api.v1["financing-rounds"][":id"].close.$post, { param: { id }, json }),
    invalidiert: () => bestand,
  });

export const useRundeWiedereroeffnen = () =>
  useApiMutation({
    aufruf: ({ id, grund }: { id: string; grund: string }) => auspackenPortfolio(api.api.v1["financing-rounds"][":id"].reopen.$post, { param: { id }, json: { grund } }),
    invalidiert: () => bestand,
  });

export const useRundeLoeschen = () =>
  useApiMutation({
    aufruf: ({ id }: { id: string }) => auspackenPortfolio(api.api.v1["financing-rounds"][":id"].$delete, { param: { id } }),
    invalidiert: () => bestandMitPools,
  });

export const useZahlungAnlegen = () =>
  useApiMutation({
    aufruf: ({ positionId, ...json }: { positionId: string } & NeueZahlung) => auspackenPortfolio(api.api.v1["round-positions"][":id"].payments.$post, { param: { id: positionId }, json }),
    invalidiert: () => bestand,
  });

/** Einheitliche Buchung (alle Arten); entwertet Fonds und Beteiligungen und damit das Journal. */
export const useBuchungAnlegen = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: NeueBuchung) => buchhaltungsAufruf((en) => api.api.v1.funds[":id"].postings.$post(en({ param: { id: fondsId }, json }))),
    invalidiert: (_ergebnis, json) => (json.typ === "fondsbewegung" ? [...bestand, [...schluessel.bewegungen, fondsId]] : bestand),
  });

export const useBewegungStorno = () =>
  useApiMutation({
    aufruf: ({ id, grund, valuta }: { id: string; grund: string; valuta?: string | undefined }) =>
      ausFonds(api.api.v1["fund-movements"][":id"].reverse.$post, { param: { id }, json: { grund, ...(valuta ? { valuta } : {}) } }),
    invalidiert: () => [...bestand, schluessel.bewegungen],
  });

// Anteilsübertragung und Optionsscheine (Ausübung) ---------------------------------------------------------------------------

export type NeueUebertragung = Eingabe<(typeof api.api.v1.organizations)[":id"]["share-transfers"]["$post"]>["json"];
export type NeueAusuebung = Eingabe<(typeof api.api.v1.instruments)[":id"]["exercises"]["$post"]>["json"];

/** Eine Übertragung verschiebt Kapitaltabelle, Wasserfall und bei eigenen Fonds Buchwert, Vorgänge und Verkäufe. */
const uebertragungGeaendert = [...bestand, schluessel.organisationen, schluessel.bewertungen, schluessel.berichte] as const;

export const useUebertragungAnlegen = (organisationId: string) =>
  useApiMutation({
    aufruf: async (json: NeueUebertragung) => {
      const { kapitalQuelleAnApi } = await import("@carraway/api/portfolio-vertrag");
      return auspacken(api.api.v1.organizations[":id"]["share-transfers"].$post({
        param: { id: organisationId },
        json: { ...json, source: kapitalQuelleAnApi(json.source) },
      }));
    },
    invalidiert: () => uebertragungGeaendert,
  });

export const useUebertragungStorno = (organisationId: string) =>
  useApiMutation({
    aufruf: ({ transferId, reason }: { transferId: string; reason: string }) =>
      auspacken(api.api.v1.organizations[":id"]["share-transfers"][":transferId"].reverse.$post({ param: { id: organisationId, transferId }, json: { reason } })),
    invalidiert: () => uebertragungGeaendert,
  });

export const useAusuebung = (instrumentId: string) =>
  useApiMutation({
    aufruf: (json: NeueAusuebung) => auspacken(api.api.v1.instruments[":id"].exercises.$post({ param: { id: instrumentId }, json })),
    invalidiert: () => uebertragungGeaendert,
  });

export const useAusuebungStorno = (instrumentId: string) =>
  useApiMutation({
    aufruf: ({ exerciseId, reason }: { exerciseId: string; reason: string }) =>
      auspacken(api.api.v1.instruments[":id"].exercises[":exerciseId"].reverse.$post({ param: { id: instrumentId, exerciseId }, json: { reason } })),
    invalidiert: () => uebertragungGeaendert,
  });
