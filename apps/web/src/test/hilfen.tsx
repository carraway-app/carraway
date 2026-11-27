import { berichtAnApi, berichtBereich, berichtVonApi } from "@carraway/api/berichte-vertrag";
import { fondsEnumVonApi } from "@carraway/api/fonds-vertrag";
import { fondsFixtureAnApi, fondsFixturePfad, fondsFixtureVonApi } from "@carraway/api/__tests__/fonds-fixtures";
import { portfolioFixtureAnApi, portfolioFixturePfad, portfolioFixtureVonApi } from "@carraway/api/__tests__/portfolio-fixtures";
import { kontaktFixtureJson, kontaktFixtureUrl } from "@carraway/api/__tests__/kontakt-fixtures";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryHistory } from "@tanstack/react-router";
import { expect, vi } from "vitest";
import type { Arbeitsdeal } from "../api/dealflow";
import { istGruppe, type Gruppe } from "../api/crm";
import type { BereichName } from "../api/abbildung";
import { bereichAnApi, stufeAnApi } from "../api/abbildung-verwaltung";
import { Anwendung } from "../anwendung";
import { erstelleQueryClient, erstelleRouter } from "../router";

/** Erfundene Testdaten in der Form der API-Antworten. */
const schritt = (zeichen: string, bezeichnung: string, wert: string) => ({ zeichen, bezeichnung, wert });
const kennzahl = (wert: string | null, schritte: ReturnType<typeof schritt>[] = []) => ({ wert, schritte });

/**
 * Öffnet das Stichtag-Menü im Kopf (falls zu) und gibt das Datumsfeld zurück (`Stichtag` oder `Wissensstand`).
 * `bereich` grenzt die Suche ein, zum Beispiel auf den Seitenkopf.
 */
export async function feldImStichtagMenue(name = "Stichtag", bereich: HTMLElement = document.body) {
  const b = within(bereich);
  const offen = b.queryByLabelText(name, { selector: "input" });
  if (offen) return offen as HTMLInputElement;
  fireEvent.click(await b.findByRole("button", { name: /^(Stichtag|As at|Reporting date)[^:]*:/ }));
  return (await b.findByLabelText(name, { selector: "input" })) as HTMLInputElement;
}

/** Wechselt den Fonds über den Umschalter im Kopf der Seitenleiste (Fondskontext). */
export async function waehleFonds(name: string) {
  fireEvent.click(await screen.findByRole("button", { name: /, (Fonds auswählen|Select a fund)$/ }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name }));
  // Warten, bis der Kontext den neuen Fonds zeigt (die Seite hat dann neu gezeichnet).
  await screen.findByRole("button", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( .*)?, `) });
}

/** Öffnet im Dealflow die Auswahl (Status, Fonds, Zuständige, Gruppierung, Kartenfelder), falls sie zu ist. */
export async function dealflowAuswahl() {
  if (screen.queryByRole("group", { name: /^(Auswahl|Selection)$/ })) return;
  fireEvent.click(await screen.findByRole("button", { name: /^(Auswahl|Selection)/ }));
  await screen.findByRole("group", { name: /^(Auswahl|Selection)$/ });
}

/** Öffnet das Menü „⋯“ im Kopf und wählt einen Eintrag. */
export async function weitereAktion(name: string | RegExp) {
  fireEvent.click(await screen.findByRole("button", { name: /^(Weitere Aktionen|More actions)$/ }));
  fireEvent.click(await screen.findByRole("menuitem", { name }));
}

/**
 * Zeilenaktion einer Tabelle: Aktionen je Zeile stehen im Menü „⋯“. Öffnet die Zeilenmenüs der Reihe nach, bis der Eintrag `name`
 * erscheint, und liefert ihn (ohne zu klicken); `null`, wenn keine Zeile ihn hat.
 */
export async function zeilenAktion(name: string | RegExp, bereich: HTMLElement = document.body): Promise<HTMLElement | null> {
  // Die Zeilenmenüs laden nach (lazy); erst warten, bis Zeilen ihren Knopf haben.
  const knoepfe = () => within(bereich).queryAllByRole("button", { name: /^(Weitere Aktionen|More actions)$/ }).filter((k) => k.closest("td"));
  await waitFor(() => expect(knoepfe().length).toBeGreaterThan(0));
  for (const knopf of knoepfe()) {
    fireEvent.click(knopf);
    const eintrag = screen.queryByRole("menuitem", { name });
    if (eintrag) return eintrag;
    fireEvent.click(knopf);
  }
  return null;
}

export const FONDS_ID = "11111111-1111-4111-8111-111111111111";
export const BET_ID = "b1";
export const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export const fondsDaten = { daten: [{ id: FONDS_ID, name: "Beispielfonds I", kurzname: "BF I", vintage: 2019, zeichnungskapital: "60000000.00", waehrung: "EUR" }] };

const beteiligung = (id: string, org: string, name: string, bewertung: string | null, multiple: string | null, status = "aktiv") => ({
  id,
  organisation: { id: org, name, sektor: "Energie" },
  instrument: "wandeldarlehen",
  status,
  erstinvestment: "2021-05-31",
  zusage: "1000000.00",
  investiert: "1000000.00",
  rueckfluesse: "0.00",
  letzteBewertung: bewertung ? { stichtag: "2026-09-30", wert: bewertung, methode: "letzte_runde" } : null,
  multiple: kennzahl(multiple),
});

export const uebersichtDaten = {
  portfoliowert: "25000000.00",
  quellenstand: "2026-11-20T09:00:00Z",
  stichtag: "2026-09-30",
  snapshot: { berechnetAm: "2026-11-20T09:00:00.000Z", veraltet: false } as { berechnetAm: string; veraltet: boolean } | null,
  kennzahlen: {
    abgerufen: kennzahl("41717200"),
    ausschuettungen: kennzahl("20437200"),
    nav: kennzahl("25796900", [
      schritt("", "Portfoliowert", "25000000"),
      schritt("+", "Bankguthaben laut Saldenliste", "796900"),
      schritt("=", "Fonds-NAV", "25796900"),
    ]),
    tvpi: kennzahl("1.1082742849", [schritt("", "NAV", "25796900"), schritt("=", "TVPI", "1.1082742849")]),
    dpi: kennzahl("0.4898986509"),
    rvpi: kennzahl("0.6183756340"),
    irr: kennzahl("0.0229230483", [schritt("+", "NAV als Endwert am 2026-09-30", "25796900"), schritt("=", "IRR (XIRR, act/365)", "0.0229230483")]),
  },
  beteiligungen: [
    beteiligung(BET_ID, ORG_A, "Alpha Energie", "2000000.00", "2.0"),
    beteiligung("b2", ORG_B, "Beta Medizin", "4500000.00", "0.9"),
    beteiligung("b3", "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "Gamma Logistik", null, null, "insolvent"),
  ],
};

export const vorgang = (id: string, art: string, valuta: string, betrag: string, extra: Record<string, unknown> = {}) => ({
  id,
  art,
  valuta,
  betrag,
  bemerkung: null,
  erfasstAm: `${valuta}T08:00:00.000Z`,
  storniertVorgangId: null,
  istStorno: false,
  storniert: false,
  stornoVorgangId: null,
  instrumentId: INSTR_ID as string | null,
  instrumentBezeichnung: "Wandeldarlehen 2021" as string | null,
  trancheId: null as string | null,
  runde: null as { id: string; bezeichnung: string; art: string; datum: string } | null,
  kapitalisiert: false,
  beglichenVorgangId: null as string | null,
  ohneGeldfluss: false,
  ...extra,
});

export const INSTR_ID = "i1";
export const MS_OFFEN = "m-offen";
export const MS_ERFUELLT = "m-erfuellt";
/** Tranche in der Form der API (Stand: zugesagt, teilweise gezahlt, gezahlt; Bedingung offen oder erfüllt). */
export const trancheZeile = (id: string, instrumentId: string, nummer: number, bezeichnung: string, betrag: string, extra: Record<string, unknown> = {}, stand: Record<string, unknown> = {}) => ({
  id,
  beteiligungId: BET_ID,
  instrumentId,
  nummer,
  bezeichnung,
  bedingung: null as string | null,
  geplantAm: null as string | null,
  frist: null as string | null,
  betrag,
  erfuelltAm: null as string | null,
  nachweis: null,
  erstelltAm: "2021-05-31T08:00:00.000Z",
  stand: { zahlung: "zugesagt", bedingung: null as string | null, ausgezahlt: "0.00", offen: betrag, ...stand },
  ...extra,
});
/** Ein Instrument der Beteiligung in der Form der API (`ladeInstrumentUebersicht`); `extra` überschreibt Felder. */
export const instrumentZeile = (id: string, bezeichnung: string, art: string, extra: Record<string, unknown> = {}) => {
  const darlehensartig = art !== "offene_beteiligung";
  return {
    id,
    beteiligungId: BET_ID,
    art,
    bezeichnung,
    status: "aktiv",
    istHauptinstrument: true,
    darlehensartig,
    runde: null as { id: string; bezeichnung: string } | null,
    anteilsklasse: null as { id: string; name: string } | null,
    felder: {},
    wandlungsabschlag: null as string | null,
    bewertungsobergrenze: null as string | null,
    zinsenWandeln: null as boolean | null,
    erstelltAm: "2021-05-31T08:00:00.000Z",
    zusage: "1000000.00",
    ausgezahlt: "1000000.00",
    offeneZusage: "0.00",
    offenesKapital: darlehensartig ? "1012000.00" : null,
    tilgungen: "0.00",
    rueckfluesse: "0.00",
    kapitalisiert: "12000.00",
    zinsen: "12000.00",
    wertberichtigungen: "0.00",
    gezahlteZinsen: "0.00",
    dividenden: "0.00",
    offeneZinsen: "0.00",
    buchwertabgang: "0.00",
    buchwert: "1012000.00",
    tranchen: [
      trancheZeile(MS_ERFUELLT, id, 1, "Produktfreigabe", "400000.00", { bedingung: "Zulassung liegt vor", geplantAm: "2022-03-31", frist: "2022-03-31", erfuelltAm: "2022-03-15" }, { zahlung: "teilweise_gezahlt", bedingung: "erfuellt", ausgezahlt: "100000.00", offen: "300000.00" }),
      trancheZeile(MS_OFFEN, id, 2, "Umsatzziel", "600000.00", { bedingung: "Umsatz über 2 Mio. €", geplantAm: "2027-03-31", frist: "2027-03-31" }, { bedingung: "offen" }),
    ],
    ...extra,
  };
};
export const hauptInstrument = instrumentZeile(INSTR_ID, "Wandeldarlehen 2021", "wandeldarlehen");

/** Detail der Beteiligung `b1` zum Stichtag 30.09.2026, mit einem Storno-Paar, zwei Investoren in der Runde und einer Bewertung nach dem Stichtag. */
export const beteiligungDaten = {
  stichtag: "2026-09-30",
  stand: null as string | null,
  beteiligung: { id: BET_ID, instrument: "wandeldarlehen", erstinvestment: "2021-05-31", status: "aktiv", erstelltAm: "2021-05-31T08:00:00.000Z" },
  organisation: { id: ORG_A, name: "Alpha Energie", art: "unternehmen", sektor: "Energie", ort: "Hamburg", website: null },
  fonds: { id: FONDS_ID, name: "Beispielfonds I", kurzname: "BF I" },
  deal: { id: "d1", titel: "Alpha, Wachstum", phase: "closing", status: "investiert" } as { id: string; titel: string; phase: string; status: string } | null,
  vorgaenge: [
    vorgang("v1", "zusage", "2021-05-31", "1000000.00"),
    vorgang("v2", "auszahlung", "2021-06-30", "600000.00", { storniert: true, stornoVorgangId: "v3" }),
    vorgang("v3", "auszahlung", "2021-07-15", "-600000.00", { istStorno: true, storniertVorgangId: "v2", bemerkung: "Falscher Betrag" }),
    vorgang("v4", "auszahlung", "2021-07-31", "1000000.00"),
  ],
  bewertungsverlauf: [
    { stichtag: "2024-09-30", wert: "1500000.00", methode: "anschaffungskosten", begruendung: null, erfasstAm: "2024-10-05T08:00:00.000Z" },
    { stichtag: "2025-09-30", wert: "1800000.00", methode: "letzte_runde", begruendung: "Runde Serie A", erfasstAm: "2025-10-05T08:00:00.000Z" },
    { stichtag: "2026-09-30", wert: "2000000.00", methode: "letzte_runde", begruendung: null, erfasstAm: "2026-10-05T08:00:00.000Z" },
    { stichtag: "2027-03-31", wert: "9000000.00", methode: "multiplikator", begruendung: null, erfasstAm: "2027-04-05T08:00:00.000Z" },
  ],
  instrumente: [hauptInstrument] as (typeof hauptInstrument)[],
  runden: [
    {
      id: "r1",
      bezeichnung: "Seed",
      datum: "2021-05-31",
      preMoney: "8000000.00",
      postMoney: "10000000.00",
      preisJeAnteil: "12.3457",
      anteileGesamtNach: "810000.0000",
      positionen: [
        { id: "p1", investor: { art: "fonds", id: FONDS_ID, name: "Beispielfonds I" }, betrag: "1000000.00", anteile: "81000.0000", rolle: "lead", diesesFonds: true },
        { id: "p2", investor: { art: "organisation", id: ORG_B, name: "Beta Medizin" }, betrag: "500000.00", anteile: "40500.0000", rolle: "co", diesesFonds: false },
      ],
    },
  ],
  kennzahlen: {
    investiert: kennzahl("1000000", [
      schritt("", "Auszahlungen bis zum Stichtag (Anzahl, inklusive Stornos)", "3"),
      schritt("", "davon Stornobuchungen", "1"),
      schritt("=", "Investiertes Kapital (Summe der Auszahlungen nach Storno)", "1000000"),
    ]),
    rueckfluesse: kennzahl("250000", [
      schritt("", "Rückflüsse und Tilgungen bis zum Stichtag (Anzahl)", "1"),
      schritt("=", "Rückflüsse kumuliert (ohne Zinsen)", "250000"),
    ]),
    bewertung: kennzahl("2000000", [
      schritt("", "Letzte Bewertung am 2026-09-30 (letzte_runde)", "2000000"),
      schritt("=", "Bewertung zum Stichtag", "2000000"),
    ]),
    multiple: kennzahl("2.25", [schritt("=", "Multiple", "2.25")]),
    irr: kennzahl("0.1234", [
      schritt("−", "Auszahlungen (1 Zahlungen, ohne aufgehobene Paare)", "1000000"),
      schritt("+", "Bewertung als Endwert am 2026-09-30", "2000000"),
      schritt("=", "IRR der Beteiligung (XIRR, act/365)", "0.1234"),
    ]),
  },
};

export const dealDaten = {
  daten: [
    { id: "d1", titel: "Alpha, Wachstum", organisation: { id: ORG_A, name: "Alpha Energie" }, phase: "anfrage", fondsId: FONDS_ID, investmentmanagerId: null, projektleiterId: null, status: "offen", ticket: "2450000.00", betreuung: "Anna Berger", quelle: "Empfehlung", aktualisiertAm: "2026-09-29T12:00:00.000Z" },
    { id: "d2", titel: "Beta, Serie A", organisation: { id: ORG_B, name: "Beta Medizin" }, phase: "due_diligence", fondsId: null, investmentmanagerId: null, projektleiterId: null, status: "abgesagt", ticket: "1000000.00", betreuung: "Jonas Keller", quelle: "Messe", aktualisiertAm: "2026-09-20T12:00:00.000Z" },
  ],
};

export const arbeitsdealDaten: Arbeitsdeal = {
  id: "d1",
  titel: "Alpha, Wachstum",
  unternehmenName: "Alpha Energie",
  fondsId: FONDS_ID,
  eingangsdatum: "2026-09-01",
  herkunft: "anfrage",
  dealtyp: null,
  quelle: "Empfehlung",
  investmentmanagerId: null,
  investmentmanagerName: null,
  projektleiterId: null,
  projektleiterName: null,
  phase: "anfrage",
  betreuung: "Anna Berger",
};

export const organisationDaten = {
  id: ORG_A,
  name: "Alpha Energie",
  art: "unternehmen",
  sektor: "Energie",
  ort: "Hamburg",
  website: null,
  erstelltAm: "2020-01-01T00:00:00.000Z",
  zusammengefuehrtIn: null as string | null,
  rollen: [] as unknown[],
  beziehungen: [] as unknown[],
  vehikelAnzahl: 0,
  personen: [{ id: "p1", vorname: "Eva", nachname: "Muster", email: "eva@example.org", funktion: "Geschäftsführung" }],
  deals: [{ id: "d1", titel: "Alpha, Wachstum", phase: "anfrage", status: "offen", ticket: "2450000.00", aktualisiertAm: "2026-09-29T12:00:00.000Z" }],
  beteiligungen: [{ id: "b1", fonds: { id: FONDS_ID, name: "Beispielfonds I", kurzname: "BF I" }, instrument: "wandeldarlehen", status: "aktiv", erstinvestment: "2021-05-31" }],
};

export const DEAL_ID = "d1";
export const NEUE_ORG_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

export const organisationListeDaten = {
  daten: [
    { id: ORG_A, name: "Alpha Energie", art: "unternehmen", sektor: "Energie", ort: "Hamburg", website: null },
    { id: ORG_B, name: "Beta Medizin", art: "unternehmen", sektor: "Medizin", ort: "Berlin", website: null },
  ],
  naechsterCursor: null,
};

export const aktivitaetDaten = {
  id: "a1",
  art: "gespraech",
  datum: "2026-09-10",
  titel: "Erstes Gespräch",
  notiz: "Kennenlernen am Telefon",
  organisationId: ORG_A,
  personId: null,
  dealId: DEAL_ID,
  wiedervorlage: "2026-10-01",
  wiedervorlageErledigtAm: null,
  erstelltAm: "2026-09-10T08:00:00.000Z",
};

export const dealDetailDaten = {
  id: DEAL_ID,
  organisationId: ORG_A,
  fondsId: null,
  titel: "Alpha, Wachstum",
  dealtyp: null,
  phase: "pruefung",
  status: "offen",
  quelle: "Empfehlung",
  ticket: "2450000.00",
  betreuung: "Anna Berger",
  absagegrund: null,
  beschlussvorschlag: null as string | null,
  erstelltAm: "2026-09-01T08:00:00.000Z",
  aktualisiertAm: "2026-09-29T12:00:00.000Z",
  organisation: { id: ORG_A, name: "Alpha Energie", art: "unternehmen", sektor: "Energie", ort: "Hamburg", website: null, erstelltAm: "2020-01-01T00:00:00.000Z" },
  fonds: null,
  personen: [{ id: "p1", vorname: "Eva", nachname: "Muster", email: "eva@example.org", funktion: "Geschäftsführung" }],
  phasenverlauf: [
    { id: "w1", dealId: DEAL_ID, vonPhase: null, nachPhase: "anfrage", am: "2026-09-01", bemerkung: null, erfasstAm: "2026-09-01T08:00:00.000Z" },
    { id: "w2", dealId: DEAL_ID, vonPhase: "anfrage", nachPhase: "pruefung", am: "2026-09-15", bemerkung: "Unterlagen sind vollständig", erfasstAm: "2026-09-15T08:00:00.000Z" },
  ],
  aktivitaeten: [aktivitaetDaten],
  beschluesse: [] as unknown[],
  beteiligungen: [] as unknown[],
};

export const zustimmung = {
  id: "bs1",
  dealId: DEAL_ID,
  gremium: "Investitionsausschuss",
  datum: "2026-10-10",
  ergebnis: "zugestimmt",
  betrag: "2000000.00",
  auflagen: "Rechtliche Prüfung abschließen",
  protokoll: "Einstimmig beschlossen.",
  erfasstVon: null as string | null,
  erstelltAm: "2026-10-10T08:00:00.000Z",
};

export const wiedervorlageDaten = {
  id: "a1",
  art: "gespraech",
  titel: "Erstes Gespräch",
  datum: "2026-09-10",
  wiedervorlage: "2026-10-01",
  deal: { id: DEAL_ID, titel: "Alpha, Wachstum" },
  organisation: { id: ORG_A, name: "Alpha Energie" },
  person: null,
};

export const trichterDaten = {
  filter: { von: null, bis: null, fondsId: null },
  gesamt: { deals: 10, offen: 6, abgesagt: 3, investiert: 1 },
  phasen: [
    { phase: "anfrage", erreicht: 10, aktuell: 2, konversionZurNaechsten: 0.8 },
    { phase: "erstgespraech", erreicht: 8, aktuell: 2, konversionZurNaechsten: 0.5 },
    { phase: "pruefung", erreicht: 4, aktuell: 1, konversionZurNaechsten: 0.5 },
    { phase: "due_diligence", erreicht: 2, aktuell: 1, konversionZurNaechsten: 0.5 },
    { phase: "investitionsausschuss", erreicht: 1, aktuell: 0, konversionZurNaechsten: 1 },
    { phase: "closing", erreicht: 1, aktuell: 0, konversionZurNaechsten: null },
  ],
  quellen: [
    { quelle: "Empfehlung", anzahl: 6 },
    { quelle: "Messe", anzahl: 3 },
    { quelle: null, anzahl: 1 },
  ],
  absagegruende: [
    { absagegrund: "Bewertung zu hoch", anzahl: 2 },
    { absagegrund: null, anzahl: 1 },
  ],
  zeitreihe: [
    { quartal: "2026-Q1", eingang: 4, abschluss: 0, absage: 1 },
    { quartal: "2026-Q2", eingang: 5, abschluss: 1, absage: 1 },
    { quartal: "2026-Q3", eingang: 1, abschluss: 0, absage: 1 },
  ],
  verweildauer: [
    { phase: "anfrage", anzahl: 8, tage: 12.5 },
    { phase: "erstgespraech", anzahl: 4, tage: 20 },
    { phase: "pruefung", anzahl: 2, tage: 31.5 },
    { phase: "due_diligence", anzahl: 1, tage: 45 },
    { phase: "investitionsausschuss", anzahl: 1, tage: 14 },
    { phase: "closing", anzahl: 0, tage: null },
  ],
  konversionNachQuelle: [
    { quelle: "Empfehlung", deals: 6, offen: 4, abgesagt: 1, investiert: 1, konversion: 0.1667 },
    { quelle: "Messe", deals: 3, offen: 2, abgesagt: 1, investiert: 0, konversion: 0 },
    { quelle: null, deals: 1, offen: 0, abgesagt: 1, investiert: 0, konversion: 0 },
  ],
  konversionNachBetreuung: [
    { betreuung: "Anna Berger", deals: 7, offen: 4, abgesagt: 2, investiert: 1, konversion: 0.1429 },
    { betreuung: null, deals: 3, offen: 2, abgesagt: 1, investiert: 0, konversion: 0 },
  ],
};

/** Instrumentdaten der Beteiligung `b1`: Wandeldarlehen mit Konditionen, zwei Tranchen (eine mit offener Bedingung), einem Jahresüberschuss. */
export const instrumentDaten = {
  beteiligung: { id: BET_ID, fondsId: FONDS_ID, organisationId: ORG_A, instrument: "wandeldarlehen", status: "aktiv", erstinvestment: "2021-05-31" },
  konditionen: [
    {
      id: "k1",
      beteiligungId: BET_ID,
      instrumentId: INSTR_ID,
      gueltigAb: "2021-05-31",
      satzFix: "0.060000",
      methode: "act/365",
      zinsperiode: "jaehrlich",
      anker: "2021-12-31",
      gewinnabhaengigSatz: null,
      kappungSatz: null,
      stundungBis: null,
      kapitalisieren: false,
      faelligAm: "2027-12-31",
      erfasstAm: "2021-05-31T08:00:00.000Z",
    },
    {
      id: "k2",
      beteiligungId: BET_ID,
      instrumentId: INSTR_ID,
      gueltigAb: "2023-01-01",
      satzFix: "0.065000",
      methode: "act/365",
      zinsperiode: "jaehrlich",
      anker: "2021-12-31",
      gewinnabhaengigSatz: "0.100000",
      kappungSatz: "0.020000",
      stundungBis: null,
      kapitalisieren: true,
      faelligAm: "2027-12-31",
      erfasstAm: "2023-01-01T08:00:00.000Z",
    },
  ],
  jahresueberschuesse: [{ jahr: 2025, betrag: "250000.00" }],
  meilensteine: hauptInstrument.tranchen.map(({ stand: _stand, ...m }) => m),
  instrumente: [hauptInstrument] as (typeof hauptInstrument)[],
  zustand: {
    zusage: "1000000.00",
    investiert: "1000000.00",
    offeneZusage: "0.00",
    tilgungen: "0.00",
    rueckfluesse: "0.00",
    wertberichtigungen: "0.00",
    kapitalisiert: "12000.00",
    zinsen: "12000.00",
    offenesKapital: "1012000.00",
    buchwertabgang: "0.00",
  },
  buchwert: {
    wert: "1012000.00",
    schritte: [
      { zeichen: "", bezeichnung: "Investiert (Auszahlungen nach Storno)", wert: "1000000" },
      { zeichen: "+", bezeichnung: "Kapitalisierte Zinsen", wert: "12000" },
      { zeichen: "=", bezeichnung: "Buchwert", wert: "1012000" },
    ],
  },
  verkaeufe: [] as unknown[],
  forderungen: [] as unknown[],
  wandlung: null as unknown,
};

/** Zinsen der Beteiligung `b1` zum Stichtag 30.09.2026: eine bezahlte, eine offene Buchung und das laufende Stück. */
export const zinsenDaten = {
  beteiligungId: BET_ID,
  stichtag: "2026-09-30",
  stand: null as string | null,
  instrumente: [
    {
      beteiligungId: BET_ID,
      instrumentId: INSTR_ID,
      organisation: { id: ORG_A, name: "Alpha Energie" },
      bezeichnung: "Wandeldarlehen 2021",
      art: "wandeldarlehen",
      status: "aktiv",
      konditionen: { gueltigAb: "2023-01-01", satzFix: "0.065000", methode: "act/365", zinsperiode: "jaehrlich", anker: "2021-12-31", kapitalisieren: false, gewinnabhaengigSatz: "0.100000", kappungSatz: "0.020000", stundungBis: null as string | null, versionen: 2 },
      aufgelaufen: "48500.00",
      gebucht: "125000.00",
      kapitalisiert: "0.00",
      gezahlt: "100000.00",
      gewandelt: "0.00",
      offen: "25000.00",
      naechsteFaelligkeit: "2026-12-31" as string | null,
      perioden: [
        { von: "2024-01-01", bis: "2024-12-31", faellig: "2024-12-31", betrag: "100000.00", gezahlt: "100000.00", gewandelt: "0.00", offen: "0.00", kapitalisiert: false, status: "gezahlt", laufend: false, vorgangId: "z1" },
        { von: "2025-01-01", bis: "2025-12-31", faellig: "2025-12-31", betrag: "25000.00", gezahlt: "0.00", gewandelt: "0.00", offen: "25000.00", kapitalisiert: false, status: "offen", laufend: false, vorgangId: "z2" },
        { von: "2026-01-01", bis: "2026-09-30", faellig: null as string | null, betrag: "48500.00", gezahlt: "0.00", gewandelt: "0.00", offen: "48500.00", kapitalisiert: false, status: "aufgelaufen", laufend: true, vorgangId: null as string | null },
      ],
      fehler: null as string | null,
      fehlerCode: null as string | null,
    },
  ],
  summe: { aufgelaufen: "48500.00", gebucht: "125000.00", kapitalisiert: "0.00", gezahlt: "100000.00", gewandelt: "0.00", offen: "25000.00" },
};

/** Zinsen des Fonds zum Stichtag 30.09.2026: dasselbe Instrument wie `zinsenDaten`, dazu ein Darlehen ohne Konditionen. */
export const fondsZinsenDaten = {
  fondsId: FONDS_ID,
  stichtag: "2026-09-30",
  stand: null as string | null,
  instrumente: [
    zinsenDaten.instrumente[0]!,
    {
      ...zinsenDaten.instrumente[0]!,
      beteiligungId: "b2",
      instrumentId: "i2",
      organisation: { id: "o2", name: "Beta Beispiel" },
      bezeichnung: "Darlehen 2024",
      art: "darlehen",
      konditionen: null,
      aufgelaufen: null as string | null,
      gebucht: "0.00",
      kapitalisiert: "0.00",
      gezahlt: "0.00",
      gewandelt: "0.00",
      offen: "0.00",
      naechsteFaelligkeit: null as string | null,
      perioden: [] as (typeof zinsenDaten.instrumente)[0]["perioden"],
    },
  ],
  summe: { aufgelaufen: "48500.00", gebucht: "125000.00", kapitalisiert: "0.00", gezahlt: "100000.00", gewandelt: "0.00", offen: "25000.00" },
};

export const abgrenzungDaten = {
  fondsId: FONDS_ID,
  stichtag: "2026-09-30",
  darlehen: [
    {
      beteiligungId: BET_ID,
      organisation: "Alpha Energie",
      instrument: "wandeldarlehen",
      fehlendeKonditionen: false,
      offenePerioden: [{ von: "2025-12-31", bis: "2026-12-31", betragGebucht: "0.00", kapitalisiert: true }],
      offen: "12000.00",
      laufend: { von: "2026-06-30", bis: "2026-09-30", betragGebucht: "15200.50" },
      gesamt: "27200.50",
      schritte: [{ zeichen: "=", bezeichnung: "Abgrenzung (auf Cent, kaufmännisch)", wert: "15200.5" }],
      fehler: null,
    },
    { beteiligungId: "b9", organisation: "Delta Optik", instrument: "darlehen", fehler: "Berechnung nicht möglich: Jahresüberschuss 2025 fehlt", fehlerCode: "calculation_failed", fehlerParams: { beteiligungId: "b9", grund: "Jahresüberschuss 2025 fehlt" } },
  ],
  summe: { offen: "12000.00", gesamt: "27200.50" },
};

export const ZL_ID = "zl1";
export const zinslaufDaten = {
  id: ZL_ID,
  fondsId: FONDS_ID,
  stichtag: "2026-09-30",
  status: "geprueft",
  berechnetVon: "system",
  berechnetAm: "2026-11-20T09:00:00.000Z",
  geprueftVon: "system",
  geprueftAm: "2026-11-20T09:05:00.000Z",
  freigegebenVon: null,
  freigegebenAm: null,
  gebuchtVon: null,
  gebuchtAm: null,
  verworfenVon: null,
  verworfenAm: null,
  abgedeckt: [],
  positionen: [
    {
      id: "p1",
      zinslaufId: ZL_ID,
      beteiligungId: BET_ID,
      konditionId: "k2",
      von: "2025-12-31",
      bis: "2026-12-31",
      faelligAm: "2026-12-31",
      gestundet: true,
      betragFix: "15000.123456",
      betragGewinn: "1200.5",
      betragGesamt: "16200.623456",
      betragGebucht: "16200.62",
      kapitalisiert: true,
      kapitalien: [
        { von: "2025-12-31", bis: "2026-06-30", kapital: "1000000" },
        { von: "2026-06-30", bis: "2026-12-31", kapital: "1012000" },
      ],
      schritte: [
        { zeichen: "+", bezeichnung: "Fester Zins 2025-12-31 bis 2026-06-30 auf 1000000", wert: "7000" },
        { zeichen: "=", bezeichnung: "Zinsbetrag", wert: "16200.623456" },
      ],
      organisation: { id: ORG_A, name: "Alpha Energie" },
    },
  ],
  summe: { anzahl: 1, gebucht: "16200.62" },
};
export const kontrolleDaten = {
  zinslaufId: ZL_ID,
  status: "geprueft",
  stichtag: "2026-09-30",
  gesamt: "abweichung",
  pruefungen: [
    {
      schluessel: "summe_positionen_gleich_buchungen",
      code: "ZINSLAUF_SUMME_ABWEICHUNG",
      bezeichnung: "Summe der Positionen entspricht der Summe der Buchungen",
      status: "ok",
      hinweis: "Lauf ist geprueft, es gibt noch keine Buchungen",
      hinweisCode: "ZINSLAUF_NOCH_NICHT_GEBUCHT",
      hinweisParams: { status: "geprueft", summePositionen: "16200.62" },
      params: { status: "geprueft", summePositionen: "16200.62" },
    },
    { schluessel: "keine_periode_doppelt", code: "ZINSPERIODE_DOPPELT", bezeichnung: "Keine Zinsperiode ist doppelt gebucht", status: "ok", params: {} },
    { schluessel: "alle_darlehen_abgedeckt", code: "DARLEHEN_NICHT_ABGEDECKT", bezeichnung: "Jedes aktive Darlehen mit Konditionen ist im Lauf abgedeckt", status: "ok", params: {} },
    {
      schluessel: "darlehen_mit_konditionen",
      code: "DARLEHEN_OHNE_KONDITIONEN",
      bezeichnung: "Jedes aktive Darlehen hat Konditionen",
      status: "abweichung",
      params: { anzahl: 1 },
      details: [{ beteiligungId: "b9", organisation: "Delta Optik" }],
    },
    { schluessel: "kapital_null", code: "KAPITAL_NULL", bezeichnung: "Keine Position und kein Darlehen mit Kapital null", status: "ok", params: {} },
  ],
};
export const zinslaufListeDaten = {
  daten: [{ id: ZL_ID, fondsId: FONDS_ID, stichtag: "2026-09-30", status: "geprueft", berechnetVon: "system", berechnetAm: "2026-11-20T09:00:00.000Z", geprueftVon: "system", freigegebenVon: null, gebuchtAm: null, anzahlPositionen: 1, summeGebucht: "16200.62" }],
};

export const kandidat = { id: ORG_A, name: "Alpha Energie", art: "unternehmen", ort: "Hamburg", score: 0.8 };

/** Angemeldete Standardperson der Tests: globale Verwalterin, also mit allen Rechten (wie vor der Anmeldung). */
export const ICH_ID = "99999999-9999-4999-8999-999999999999";
export const ichDaten = {
  id: ICH_ID,
  name: "Vera Beispiel",
  email: "vera@beispiel.example",
  technisch: false,
  globalVerwalter: true,
  zweiFaktorAktiv: true,
  passwortAendern: false,
  zweiFaktorErforderlich: false,
  rollen: [] as { fondsId: string; rolle: "betrachter" | "bearbeiter" | "freigeber" | "verwalter" }[],
  bereiche: null as string[] | null,
  stufeOhneFonds: null as "betrachter" | "bearbeiter" | "freigeber" | "verwalter" | null,
  bereicheJeFonds: null as Record<string, Partial<Record<string, "betrachter" | "bearbeiter" | "freigeber" | "verwalter">>> | null,
  stufeOhneFondsJeBereich: null as Partial<Record<string, "betrachter" | "bearbeiter" | "freigeber" | "verwalter">> | null,
};
export const BEWEGUNG_OFFEN_ID = "22222222-2222-4222-8222-222222222201";
export const BEWEGUNG_FERTIG_ID = "22222222-2222-4222-8222-222222222202";
/** Kapitalbewegungen des Standardfonds, neueste zuerst: ein Abruf ohne Mitteilungen, eine Ausschüttung mit freigegebenen Mitteilungen. */
export const bewegungenDaten = {
  daten: [
    { id: BEWEGUNG_OFFEN_ID, art: "abruf" as const, valuta: "2026-03-15", betrag: "250000.00", bemerkung: null as string | null, erfasstAm: "2026-03-10T09:00:00.000Z", anzahlMitteilungen: 0, istStorno: false, storniert: false },
    { id: BEWEGUNG_FERTIG_ID, art: "ausschuettung" as const, valuta: "2026-01-20", betrag: "40000.00", bemerkung: null as string | null, erfasstAm: "2026-01-15T09:00:00.000Z", anzahlMitteilungen: 5, istStorno: false, storniert: false },
  ],
};
/** Eine angemeldete Person ohne globale Verwaltung, mit den genannten Rollen am Standardfonds. */
/** `/me` in der englischen Form der Schnittstelle (die Fixtures der Tests nennen die Begriffe der Oberfläche). */
export const ichAlsApi = (i: typeof ichDaten & { investor?: boolean }) => ({
  id: i.id,
  name: i.name,
  email: i.email,
  technicalUser: i.technisch,
  globalAdmin: i.globalVerwalter,
  twoFactorEnabled: i.zweiFaktorAktiv,
  passwordChangeRequired: i.passwortAendern,
  twoFactorSetupRequired: i.zweiFaktorErforderlich,
  roles: i.rollen.map((r) => ({ fundId: r.fondsId, role: stufeAnApi(r.rolle) })),
  areas: i.bereiche == null ? null : i.bereiche.map((b) => bereichAnApi(b as BereichName)),
  levelWithoutFund: i.stufeOhneFonds == null ? null : stufeAnApi(i.stufeOhneFonds),
  areaLevelsPerFund:
    i.bereicheJeFonds == null ? null : Object.fromEntries(Object.entries(i.bereicheJeFonds).map(([f, w]) => [f, Object.fromEntries(Object.entries(w).map(([b, s]) => [bereichAnApi(b as BereichName), stufeAnApi(s!)]))])),
  levelWithoutFundPerArea: i.stufeOhneFondsJeBereich == null ? null : Object.fromEntries(Object.entries(i.stufeOhneFondsJeBereich).map(([b, s]) => [bereichAnApi(b as BereichName), stufeAnApi(s!)])),
  investor: i.investor ?? false,
});
export const alsRolle = (rolle: "betrachter" | "bearbeiter" | "freigeber" | "verwalter", extra: Partial<typeof ichDaten> = {}) => ({
  koerper: ichAlsApi({ ...ichDaten, globalVerwalter: false, rollen: [{ fondsId: FONDS_ID, rolle }], ...extra }),
});
export const umgebungDaten = { umgebung: "echt" as "demo" | "test" | "echt", einrichtungOffen: false, pseudonymisiert: false, anmeldung: { zweiFaktorPflicht: true, registrierungOffen: false, anbieter: [] as ("microsoft" | "google")[], passwortZuruecksetzen: false } };
/** `/environment` in der englischen Form der Schnittstelle. */
export const umgebungAlsApi = (u: typeof umgebungDaten) => ({
  environment: u.umgebung === "echt" ? ("production" as const) : u.umgebung,
  pseudonymized: u.pseudonymisiert,
  setupOpen: u.einrichtungOffen,
  signIn: { twoFactorRequired: u.anmeldung.zweiFaktorPflicht, registrationOpen: u.anmeldung.registrierungOffen, providers: u.anmeldung.anbieter, passwordResetAvailable: u.anmeldung.passwortZuruecksetzen },
});

// Etappe 5: Bewertungen, Runden, Berichte, Vorlagen ---------------------------------------------------------------------

/** Eine zweite Person (Vier-Augen-Gegenüber der Standardperson). */
export const ANDERE_ID = "88888888-8888-4888-8888-888888888888";
export const DRITTE_ID = "77777777-7777-4777-8777-777777777777";
export const namenDaten = { daten: [{ id: ICH_ID, name: "Vera Beispiel" }, { id: ANDERE_ID, name: "Berta Beispiel" }, { id: DRITTE_ID, name: "Friedrich Beispiel" }] };

export const bewertungZeile = (id: string, stichtag: string, wert: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  beteiligungId: BET_ID,
  stichtag,
  wert,
  methode: "letzte_runde",
  begruendung: "Runde Serie A",
  grundlage: null,
  status,
  erstelltVon: ANDERE_ID,
  freigegebenVon: null,
  freigegebenAm: null,
  ersetztAm: null,
  ersetztBewertungId: null,
  bewertungsrundeId: null,
  erfasstAm: `${stichtag}T08:00:00.000Z`,
  ...extra,
});

/** Bewertungen der Beteiligung `b1`: eine geltende mit offenem Korrekturentwurf der Standardperson, eine ersetzte Folge und ein fremder Entwurf. */
export const bewertungenDaten = {
  daten: [
    bewertungZeile("w4", "2026-12-31", "2500000.00", "entwurf"),
    bewertungZeile("w2", "2026-09-30", "2200000.00", "entwurf", { erstelltVon: ICH_ID, ersetztBewertungId: "w1" }),
    bewertungZeile("w1", "2026-09-30", "2000000.00", "freigegeben", { freigegebenVon: ANDERE_ID, freigegebenAm: "2026-10-05T08:00:00.000Z" }),
    bewertungZeile("w0b", "2025-09-30", "1900000.00", "freigegeben", { freigegebenVon: ANDERE_ID, freigegebenAm: "2025-10-06T08:00:00.000Z", ersetztBewertungId: "w0" }),
    bewertungZeile("w0", "2025-09-30", "1800000.00", "ersetzt", { freigegebenVon: "system:ereignis", freigegebenAm: "2025-10-05T08:00:00.000Z", ersetztAm: "2025-10-06T08:00:00.000Z" }),
  ],
};

export const RUNDE_ID = "ru1";
export const rundenListeDaten = {
  daten: [
    { id: RUNDE_ID, fondsId: FONDS_ID, stichtag: "2026-12-31", vorschlag: "fortschreiben", status: "entwurf", erstelltVon: ANDERE_ID, erstelltAm: "2026-12-31T08:00:00.000Z", freigegebenVon: null, freigegebenAm: null, uebersprungen: [] },
    { id: "ru0", fondsId: FONDS_ID, stichtag: "2026-09-30", vorschlag: "letzte_runde", status: "freigegeben", erstelltVon: ANDERE_ID, erstelltAm: "2026-09-30T08:00:00.000Z", freigegebenVon: DRITTE_ID, freigegebenAm: "2026-10-01T08:00:00.000Z", uebersprungen: [] },
  ],
};
export const rundeDetailDaten = {
  runde: rundenListeDaten.daten[0]!,
  bewertungen: [
    { ...bewertungZeile("rw1", "2026-12-31", "2000000.00", "entwurf", { bewertungsrundeId: RUNDE_ID, begruendung: "Fortgeschrieben vom 2026-09-30" }), organisation: "Alpha Energie" },
    { ...bewertungZeile("rw2", "2026-12-31", "4500000.00", "entwurf", { bewertungsrundeId: RUNDE_ID, beteiligungId: "b2", begruendung: "Fortgeschrieben vom 2026-09-30" }), organisation: "Beta Medizin" },
  ],
  uebersprungen: [{ beteiligungId: "b3", organisation: "Gamma Logistik", grund: "keine_vorherige_bewertung" }],
};

export const BERICHT_ID = "be1";
const ABSCHNITTE_LP = ["vorwort", "kennzahlen", "marktumfeld", "kapitalkonten", "portfolio", "realisierungen", "bewertung", "ausblick", "herkunft"];
const ABSCHNITTE_QUARTAL = ["bewertungsverlauf", "vorgaenge", "unternehmenskennzahlen"];
export const berichtZeile = {
  id: BERICHT_ID,
  art: "lp_bericht",
  format: "pdf",
  fondsId: FONDS_ID,
  beteiligungId: null,
  stichtag: "2026-09-30",
  sprache: "de",
  standVorgabe: null,
  stand: null,
  status: "entwurf",
  parameter: {},
  konfiguration: { einheit: "EUR", abschnitte: ABSCHNITTE_LP, kennzahlen: ["nav", "tvpi"], spalten: ["unternehmen", "bewertung"] },
  freigabestufen: ["Investmentmanager", "Teamleitung", "Geschäftsführung"],
  naechsteStufe: 0,
  erstelltVon: ANDERE_ID,
  erstelltAm: "2026-11-20T09:00:00.000Z",
  erzeugtAm: null,
  dateiName: null,
  dateiSchluessel: null,
  dateiSha256: null,
  dateiGroesse: null,
  kontrolleUeberschrieben: null as unknown,
};
export const berichtDetailDaten = { ...berichtZeile, protokoll: [] as unknown[], abschnitte: [] as unknown[], naechsteStufeName: "Investmentmanager" as string | null };
export const berichtListeDaten = { daten: [berichtZeile, { ...berichtZeile, id: "be2", art: "fondsbericht", status: "freigegeben", naechsteStufe: 3, dateiName: "fondsbericht.pdf", dateiSha256: "ab".repeat(32) }] };

const pruefung = (schluessel: string, code: string, bezeichnung: string, status: "ok" | "abweichung", params: Record<string, unknown> = {}, details?: unknown[]) => ({
  schluessel,
  code,
  bezeichnung,
  status,
  params,
  ...(details ? { details } : {}),
});
export const berichtKontrolleGruen = {
  berichtId: BERICHT_ID,
  stichtag: "2026-09-30",
  stand: null,
  gesamt: "ok",
  pruefungen: [pruefung("portfolio_summe", "PORTFOLIO_SUMME_ABWEICHUNG", "Summe", "ok"), pruefung("nav_summe", "NAV_ABWEICHUNG", "NAV", "ok")],
};
export const berichtKontrolleRot = {
  berichtId: BERICHT_ID,
  stichtag: "2026-09-30",
  stand: null,
  gesamt: "abweichung",
  pruefungen: [
    pruefung("portfolio_summe", "PORTFOLIO_SUMME_ABWEICHUNG", "Summe", "ok"),
    pruefung("bewertung_je_beteiligung", "BEWERTUNG_FEHLT", "Bewertung", "abweichung", { anzahl: 1 }, [{ beteiligungId: "b2", organisation: "Beta Medizin" }]),
    pruefung("nav_summe", "NAV_ABWEICHUNG", "NAV", "abweichung", { anzahl: 1 }, [{ nav: "25796900.00", eigenkapital: "25000000.00", differenz: "796900.00" }]),
  ],
};
export const protokollZeile = (stufeIndex: number, stufe: string, ergebnis: "ok" | "zurueck", akteur: string, extra: Record<string, unknown> = {}) => ({
  id: `pz${stufeIndex}${ergebnis}`,
  berichtId: BERICHT_ID,
  stufeIndex,
  stufe,
  ergebnis,
  kommentar: null,
  akteur,
  am: `2026-11-2${stufeIndex}T10:00:00.000Z`,
  kontrolleUeberschreibung: null,
  ...extra,
});

const KENNZAHLEN_ALLE = ["nav", "tvpi", "dpi", "rvpi", "irr", "abgerufen", "ausschuettungen", "zeichnungskapital"];
const SPALTEN_PORTFOLIO = ["unternehmen", "instrument", "status", "investiert", "rueckfluesse", "bewertung", "multiple"];
const SPALTEN_LISTE = ["unternehmen", "sektor", "phase", "instrument", "betreuung", "zusage", "investiert", "buchwert", "wertberichtigung", "offeneZusage", "bewertung", "multiple"];
const SPALTEN_EXIT = ["unternehmen", "art", "datum", "investiert", "erloes", "multiple", "irr", "offeneForderungen"];
const erlaubt = (abschnitte: string[], kennzahlen: string[], spalten: string[]) => ({ abschnitte, kennzahlen, spalten, einheiten: ["EUR", "TEUR"] });

export const vorlagenDaten = {
  daten: [
    {
      art: "fondsbericht",
      angepasst: false,
      konfiguration: { einheit: "EUR", abschnitte: ["kennzahlen", "portfolio", "realisierungen", "herkunft"], kennzahlen: KENNZAHLEN_ALLE, spalten: SPALTEN_PORTFOLIO },
      erlaubt: erlaubt(["kennzahlen", "portfolio", "realisierungen", "herkunft"], KENNZAHLEN_ALLE, SPALTEN_PORTFOLIO),
    },
    {
      art: "quartalsbericht",
      angepasst: false,
      konfiguration: { einheit: "EUR", abschnitte: ABSCHNITTE_QUARTAL, kennzahlen: [], spalten: [], unternehmenskennzahlen: [] },
      erlaubt: erlaubt(ABSCHNITTE_QUARTAL, [], []),
    },
    {
      art: "lp_bericht",
      angepasst: true,
      konfiguration: { einheit: "TEUR", abschnitte: ABSCHNITTE_LP, kennzahlen: ["nav", "tvpi"], spalten: ["unternehmen", "bewertung"] },
      erlaubt: erlaubt(ABSCHNITTE_LP, KENNZAHLEN_ALLE, SPALTEN_PORTFOLIO),
    },
    { art: "gremienvorlage", angepasst: false, konfiguration: { einheit: "EUR", abschnitte: ["deals", "beschluesse"], kennzahlen: [], spalten: [] }, erlaubt: erlaubt(["deals", "beschluesse"], [], []) },
    { art: "portfolioliste", angepasst: false, konfiguration: { einheit: "EUR", abschnitte: ["liste"], kennzahlen: [], spalten: SPALTEN_LISTE }, erlaubt: erlaubt(["liste"], [], SPALTEN_LISTE) },
    { art: "exitliste", angepasst: false, konfiguration: { einheit: "EUR", abschnitte: ["liste"], kennzahlen: [], spalten: SPALTEN_EXIT }, erlaubt: erlaubt(["liste"], [], SPALTEN_EXIT) },
  ],
};
export const stufenDaten = { stages: ["Investmentmanager", "Teamleitung", "Geschäftsführung"] };

// Etappe 10: Anteilsklassen, Kapitaltabelle, Exit-Wasserfall -------------------------------------------------------------------

export const KLASSE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const klasseDaten = {
  id: KLASSE_ID,
  organisationId: ORG_A,
  name: "Seed-Vorzugsanteile",
  rang: 1,
  praeferenzFaktor: "1.0000",
  partizipierend: false,
  capFaktor: null as string | null,
  kumulierteVerzinsung: null as string | null,
  umwandelbar: true,
  verwendet: 2,
};
export const anteilsklassenDaten = { daten: [klasseDaten] };

/** Anteile einer Zeile in beiden Sichten: voll verwässert mit dem Pool von 50.000 Einheiten (1.050.000 Anteile). */
const vollVon = (anteile: string) => (Number(anteile) / 1050000).toFixed(6);
const kapitalZeile = (id: string, halter: { art: string; id: string | null; name: string; vehikel?: { id: string; name: string } | null }, klasse: string | null, anteile: string, anteil: string | null, investiert: string, diesesFonds = false) => ({
  id,
  halter: { vehikel: null, ...halter },
  klasseId: klasse,
  klasseName: klasse ? "Seed-Vorzugsanteile" : null,
  runde: id === "stamm" ? null : { id: "r1", bezeichnung: "Seed", datum: "2021-05-31" },
  anteile,
  anteilUnverwaessert: anteil,
  anteilVollVerwaessert: vollVon(anteile),
  investiert,
  diesesFonds,
  ausgegeben: anteil !== null,
});
/**
 * Kapitaltabelle von `b1`: 1.000.000 ausgegebene Anteile, 81.000 beim Fonds, 40.500 beim Co-Investor, Rest Gründer und übrige; dazu ein
 * ESOP-Pool mit 30.000 zugeteilten und 20.000 freien Einheiten (voll verwässert 1.050.000).
 */
/** Schätzung einer offenen Wandlung in der Kapitaltabelle (Antwortform der API). */
export interface OffeneWandlungDaten {
  instrumentId: string;
  bezeichnung: string;
  beteiligungId: string;
  fonds: { id: string; name: string };
  diesesFonds: boolean;
  status: "geschaetzt" | "offen";
  grund: "kein_kapital" | "keine_parameter" | "kein_referenzpreis" | "ungueltige_parameter" | "parameter_mehrdeutig" | null;
  fehlend: ("abschlag" | "bewertungsobergrenze")[];
  hinweise: "ohne_zinsen"[];
  kapital: string;
  zinsen: string;
  betrag: string;
  abschlag: string | null;
  bewertungsobergrenze: string | null;
  preisJeAnteil: string | null;
  massgeblich: "rundenpreis" | "abschlag" | "bewertungsobergrenze" | null;
  anteile: string | null;
}

export const kapitalDaten = {
  beteiligungId: BET_ID,
  organisation: { id: ORG_A, name: "Alpha Energie" },
  stichtag: "2026-09-30",
  letzteRunde: { id: "r1", bezeichnung: "Seed", datum: "2021-05-31", postMoney: "10000000.00", preisJeAnteil: "12.3457" },
  standardSicht: "voll_verwaessert" as "voll_verwaessert" | "unverwaessert",
  anteileGesamt: "1000000",
  anteileUnverwaessert: "1000000",
  anteileVollVerwaessert: "1050000",
  anteileMitWandlungen: "1050000",
  mitWandlungen: false,
  offeneWandlungen: { zinsenWandeln: true, referenzpreis: "12.3457" as string | null, anteileVorWandlung: "1050000", anteile: "0", liste: [] as OffeneWandlungDaten[] },
  mitPool: true,
  klassen: [
    { art: "klasse" as "klasse" | "stamm" | "pool", id: KLASSE_ID as string | null, name: "Seed-Vorzugsanteile" as string | null, rang: 1 as number | null, praeferenzFaktor: "1.0000" as string | null, partizipierend: false as boolean | null, capFaktor: null as string | null, kumulierteVerzinsung: null as string | null, umwandelbar: true as boolean | null, anteile: "121500", anteilUnverwaessert: "0.121500" as string | null, anteilVollVerwaessert: vollVon("121500"), investiert: "1500000.00" },
    { art: "stamm" as "klasse" | "stamm" | "pool", id: null as string | null, name: null as string | null, rang: null as number | null, praeferenzFaktor: null as string | null, partizipierend: null as boolean | null, capFaktor: null as string | null, kumulierteVerzinsung: null as string | null, umwandelbar: null as boolean | null, anteile: "878500", anteilUnverwaessert: "0.878500" as string | null, anteilVollVerwaessert: vollVon("878500"), investiert: "0.00" },
    { art: "pool" as "klasse" | "stamm" | "pool", id: null as string | null, name: null as string | null, rang: null as number | null, praeferenzFaktor: null as string | null, partizipierend: null as boolean | null, capFaktor: null as string | null, kumulierteVerzinsung: null as string | null, umwandelbar: null as boolean | null, anteile: "50000", anteilUnverwaessert: null as string | null, anteilVollVerwaessert: vollVon("50000"), investiert: "0.00" },
  ],
  zeilen: [
    kapitalZeile("stamm", { art: "stamm", id: null, name: "" }, null, "838000", "0.838000", "0.00"),
    kapitalZeile("p1", { art: "fonds", id: FONDS_ID, name: "Beispielfonds I" }, KLASSE_ID, "81000", "0.081000", "1000000.00", true),
    kapitalZeile("p2", { art: "organisation", id: ORG_B, name: "Beta Medizin", vehikel: { id: "v1", name: "Beta Medizin" } }, KLASSE_ID, "40500", "0.040500", "500000.00"),
    kapitalZeile("p3", { art: "organisation", id: ORG_B, name: "Beta Medizin", vehikel: { id: "v2", name: "Beta Medizin Fonds II" } }, null, "40500", "0.040500", "500000.00"),
    kapitalZeile("pool:esop:zugeteilt", { art: "pool_zugeteilt", id: "esop", name: "ESOP" }, null, "30000", null, "0.00"),
    kapitalZeile("pool:esop:frei", { art: "pool_frei", id: "esop", name: "ESOP" }, null, "20000", null, "0.00"),
  ],
  inhaber: [
    { halter: { art: "stamm", id: null, name: "" }, vehikel: [], positionen: 0, anteile: "838000", anteilUnverwaessert: "0.838000" as string | null, anteilVollVerwaessert: vollVon("838000"), investiert: "0.00", diesesFonds: false, ausgegeben: true },
    { halter: { art: "fonds", id: FONDS_ID, name: "Beispielfonds I" }, vehikel: [], positionen: 1, anteile: "81000", anteilUnverwaessert: "0.081000" as string | null, anteilVollVerwaessert: vollVon("81000"), investiert: "1000000.00", diesesFonds: true, ausgegeben: true },
    {
      halter: { art: "organisation", id: ORG_B, name: "Beta Medizin" },
      vehikel: [
        { id: "v1", name: "Beta Medizin" },
        { id: "v2", name: "Beta Medizin Fonds II" },
      ],
      positionen: 2,
      anteile: "81000",
      anteilUnverwaessert: "0.081000" as string | null,
      anteilVollVerwaessert: vollVon("81000"),
      investiert: "1000000.00",
      diesesFonds: false,
      ausgegeben: true,
    },
    { halter: { art: "pool_zugeteilt", id: "esop", name: "ESOP" }, vehikel: [], positionen: 1, anteile: "30000", anteilUnverwaessert: null as string | null, anteilVollVerwaessert: vollVon("30000"), investiert: "0.00", diesesFonds: false, ausgegeben: false },
    { halter: { art: "pool_frei", id: "esop", name: "ESOP" }, vehikel: [], positionen: 1, anteile: "20000", anteilUnverwaessert: null as string | null, anteilVollVerwaessert: vollVon("20000"), investiert: "0.00", diesesFonds: false, ausgegeben: false },
  ],
  diesesFonds: { anteile: "81000", anteilUnverwaessert: "0.081000" as string | null, anteilVollVerwaessert: vollVon("81000"), investiert: "1000000.00" },
};

/** Ein ESOP-Pool des Unternehmens mit einer Zuteilung an Mitarbeitende. */
export const mitarbeiterpoolDaten = {
  daten: [
    {
      id: "esop",
      organisationId: ORG_A,
      art: "esop" as "esop" | "vsop",
      bezeichnung: "ESOP",
      regel: "wie_anteile" as "wie_anteile" | "anteilig",
      notiz: null,
      erfassung: "einzeln" as "grob" | "einzeln",
      vergeben: null as string | null,
      basispreisMittel: null as string | null,
      einzelSichtbar: true,
      stand: { stichtag: "2026-09-30", groesse: "50000", ausstehend: "30000", ausgeuebt: "0", verfallen: "0", rueckgekauft: "0", frei: "20000", vollVerwaessert: "50000" },
      aenderungen: [{ id: "a1", datum: "2022-01-01", anzahl: "50000", beschluss: "Gesellschafterbeschluss", dokumentId: null as string | null, rundeId: null as string | null, basis: null as "pre_money" | "post_money" | null }],
      zuteilungen: [
        { id: "z1", kategorie: "mitarbeitende" as const, bezeichnung: null, anzahl: "30000", basispreis: "1.0000", zugeteiltAm: "2022-02-01", vestingBeginn: null, cliffMonate: 12, vestingMonate: 48, beschleunigung: "0.0000", status: "zugeteilt" as const, statusAm: null, leaverRegel: null, kennung: "M-001" as string | null, name: null as string | null, anonymisiertAm: null as string | null, taktMonate: 1, ausloeser: "einfach" as "einfach" | "doppelt", ausuebungsfristMonate: null as number | null, laufzeitBis: null as string | null, laufzeitAbgelaufen: false, austritte: [] as { id: string; art: "good_leaver" | "bad_leaver"; austrittAm: string; anzahl: string; gevestet: "bleiben" | "verfallen" | "rueckkauf"; rueckkaufpreis: string | null }[], betroffen: "0", gevestet: "30000", beimExit: "30000", verfallen: "0", rueckgekauft: "0", verbleibend: "30000", rueckkaufBetrag: "0.00" },
      ],
    },
  ],
};

const wf = (id: string, halter: { art: string; id: string | null; name: string }, klasse: string | null, anteile: string, investiert: string, praeferenz: string, beteiligung: string, gesamt: string, multiple: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  halter,
  klasseId: klasse,
  klasseName: klasse ? "Seed-Vorzugsanteile" : null,
  runde: id === "stamm" ? null : { id: "r1", bezeichnung: "Seed", datum: "2021-05-31" },
  anteile,
  investiert,
  anspruch: praeferenz,
  praeferenz,
  beteiligung,
  gesamt,
  treuhand: "0.00",
  sofort: gesamt,
  multiple,
  gewandelt: false,
  gedeckelt: false,
  diesesFonds: false,
  mitarbeiter: null as null | { poolId: string; pool: string; art: "esop" | "vsop"; regel: "wie_anteile" | "anteilig"; kategorie: string | null; anzahl: string | null; basispreis: string | null; imGeld: boolean },
  ...extra,
});
const wfSchritte = [
  schritt("", "Verteilbarer Erlös (netto nach Kosten)", "10000000"),
  schritt("", "Umwandlung Seed-Vorzugsanteile: Rückfluss bei Umwandlung", "1215000"),
  schritt("", "Umwandlung Seed-Vorzugsanteile: Rückfluss ohne Umwandlung", "1500000"),
  schritt("=", "Entscheidung Seed-Vorzugsanteile: behält die Präferenz", "1500000"),
  schritt("", "Anspruch Seed-Vorzugsanteile (Rang 1)", "1500000"),
  schritt("−", "Rang 1: gezahlte Präferenzen", "1500000"),
  schritt("=", "Rest nach Präferenzen", "8500000"),
  schritt("=", "Summe der Rückflüsse (auf Cent)", "10000000"),
];
/** Exit über 10 Mio. Euro nach Kosten: die Seed-Klasse behält ihre Präferenz (12,15 % von 10 Mio. = 1,215 Mio. < 1,5 Mio.). */
function wfInhaber(halter: { art: string; id: string | null; name: string }, positionen: number, anteile: string, investiert: string, praeferenz: string, beteiligung: string, gesamt: string, multiple: string | null, diesesFonds = false) {
  return { halter, vehikel: [] as { id: string; name: string }[], positionen, anteile, investiert, praeferenz, beteiligung, gesamt, treuhand: "0.00", sofort: gesamt, multiple, diesesFonds };
}
export const wasserfallDaten = {
  beteiligungId: BET_ID,
  eingabe: { exitwert: "10000000.00", kosten: "0.00", nettoErloes: "10000000.00", exitdatum: "2026-11-20", treuhandAnteil: "0.0000" },
  zeilen: [
    wf("stamm", { art: "stamm", id: null, name: "" }, null, "838000", "0.00", "0.00", "7100000.00", "7100000.00", null),
    wf("p1", { art: "fonds", id: FONDS_ID, name: "Beispielfonds I" }, KLASSE_ID, "81000", "1000000.00", "1000000.00", "0.00", "1000000.00", "1.0000", { diesesFonds: true }),
    wf("p2", { art: "organisation", id: ORG_B, name: "Beta Medizin" }, KLASSE_ID, "40500", "500000.00", "500000.00", "0.00", "500000.00", "1.0000"),
    wf("p3", { art: "organisation", id: ORG_B, name: "Beta Medizin" }, null, "40500", "500000.00", "0.00", "1400000.00", "1400000.00", "2.8000"),
  ],
  klassen: [
    { art: "klasse" as "klasse" | "stamm" | "mitarbeiter", id: KLASSE_ID as string | null, name: "Seed-Vorzugsanteile" as string | null, rang: 1 as number | null, anteile: "121500", investiert: "1500000.00", anspruch: "1500000.00", praeferenz: "1500000.00", beteiligung: "0.00", gesamt: "1500000.00", multiple: "1.0000" as string | null, gewandelt: false, gedeckelt: false },
    { art: "stamm" as "klasse" | "stamm" | "mitarbeiter", id: null as string | null, name: null as string | null, rang: null as number | null, anteile: "878500", investiert: "500000.00", anspruch: "0.00", praeferenz: "0.00", beteiligung: "8500000.00", gesamt: "8500000.00", multiple: "17.0000" as string | null, gewandelt: false, gedeckelt: false },
  ],
  inhaber: [
    wfInhaber({ art: "stamm", id: null, name: "" }, 0, "838000", "0.00", "0.00", "7100000.00", "7100000.00", null),
    wfInhaber({ art: "fonds", id: FONDS_ID, name: "Beispielfonds I" }, 1, "81000", "1000000.00", "1000000.00", "0.00", "1000000.00", "1.0000", true),
    wfInhaber({ art: "organisation", id: ORG_B, name: "Beta Medizin" }, 2, "81000", "1000000.00", "500000.00", "1400000.00", "1900000.00", "1.9000"),
  ],
  fonds: { investiert: "1000000.00", praeferenz: "1000000.00", beteiligung: "0.00", gesamt: "1000000.00", treuhand: "0.00", sofort: "1000000.00", multiple: "1.0000" as string | null },
  mitarbeiter: null as null | { einheiten: string; imGeld: string; gesamt: string },
  minderungsfaktor: null as string | null,
  gewandelt: [] as string[],
  restNachPraeferenzen: "8500000.00",
  preisJeAnteil: "9.675700" as string | null,
  nichtVerteilt: "0.00",
  schritte: wfSchritte,
};
/** Dasselbe bei 20 Mio. Euro: die Seed-Klasse wandelt um. */
export const wasserfallGewandeltDaten = {
  ...wasserfallDaten,
  eingabe: { ...wasserfallDaten.eingabe, exitwert: "20000000.00", nettoErloes: "20000000.00" },
  zeilen: wasserfallDaten.zeilen.map((z) => (z.klasseId ? { ...z, praeferenz: "0.00", beteiligung: z.id === "p1" ? "1620000.00" : "810000.00", gesamt: z.id === "p1" ? "1620000.00" : "810000.00", gewandelt: true } : z)),
  klassen: wasserfallDaten.klassen.map((k) => (k.id ? { ...k, gewandelt: true, gesamt: "2430000.00", praeferenz: "0.00", beteiligung: "2430000.00" } : k)),
  fonds: { ...wasserfallDaten.fonds, gesamt: "1620000.00", praeferenz: "0.00", beteiligung: "1620000.00", sofort: "1620000.00", multiple: "1.6200" },
  gewandelt: [KLASSE_ID],
  schritte: [
    schritt("", "Verteilbarer Erlös (netto nach Kosten)", "20000000"),
    schritt("=", "Entscheidung Seed-Vorzugsanteile: wandelt um", "2430000"),
    schritt("=", "Summe der Rückflüsse (auf Cent)", "20000000"),
  ],
};
/** Kurve von 0 bis 50 Mio. Euro (das 5-Fache der letzten Post-Money-Bewertung) mit zwei Knicken. */
export const kurveDaten = {
  beteiligungId: BET_ID,
  exitdatum: "2026-11-20",
  bis: "50000000.00",
  hoechstwert: "1000000000.00",
  postMoney: "10000000.00",
  investiert: "1000000.00",
  punkte: [
    { exitwert: "0.00", rueckfluss: "0.00", multiple: "0.0000" },
    { exitwert: "12500000.00", rueckfluss: "1000000.00", multiple: "1.0000" },
    { exitwert: "25000000.00", rueckfluss: "2025000.00", multiple: "2.0250" },
    { exitwert: "37500000.00", rueckfluss: "3037500.00", multiple: "3.0375" },
    { exitwert: "50000000.00", rueckfluss: "4050000.00", multiple: "4.0500" },
  ],
  knicke: [
    { exitwert: "1500000.00", rueckfluss: "1000000.00", multiple: "1.0000", ereignisse: [{ art: "praeferenz_voll", klasseId: null, klasseName: null, rang: 1 }] },
    { exitwert: "12345679.00", rueckfluss: "1000000.00", multiple: "1.0000", ereignisse: [{ art: "umwandlung", klasseId: KLASSE_ID, klasseName: "Seed-Vorzugsanteile", rang: 1 }] },
  ],
};

/** Eine aufgezeichnete Anfrage an die gespielte API. */
export interface Anfrage {
  methode: string;
  pfad: string;
  query: URLSearchParams;
  koerper: unknown;
  /** Das gesendete Formular bei multipart-Anfragen (Datei-Upload). */
  formular?: FormData;
  credentials: RequestCredentials;
}
type Antwort = { status?: number; koerper: unknown; kopf?: Record<string, string> };
type Antworten = Record<string, Antwort | ((anfrage: Anfrage) => Antwort | Promise<Antwort>)>;

/**
 * Ersetzt `fetch`: Die Komponenten und der Hono-Client laufen echt, nur die Verbindung ist gespielt.
 * Schlüssel sind `/pfad` oder `METHODE /pfad`; Werte sind Antworten oder Funktionen, die aus der Anfrage eine Antwort machen.
 * `mock.aufrufe` sammelt alle Anfragen, damit Tests Körper und Abfrageparameter prüfen können.
 */

// CRM (Etappe 20) -----------------------------------------------------------------------------------------------------

const OPERATOREN: Record<string, string[]> = {
  text: ["enthaelt", "enthaelt_nicht", "ist", "ist_nicht", "beginnt_mit", "leer", "nicht_leer"],
  url: ["enthaelt", "enthaelt_nicht", "ist", "ist_nicht", "leer", "nicht_leer"],
  email: ["enthaelt", "enthaelt_nicht", "ist", "ist_nicht", "beginnt_mit", "leer", "nicht_leer"],
  telefon: ["enthaelt", "enthaelt_nicht", "ist", "ist_nicht", "leer", "nicht_leer"],
  zahl: ["gleich", "ungleich", "groesser", "groesser_gleich", "kleiner", "kleiner_gleich", "zwischen", "leer", "nicht_leer"],
  betrag: ["gleich", "ungleich", "groesser", "groesser_gleich", "kleiner", "kleiner_gleich", "zwischen", "leer", "nicht_leer"],
  datum: ["gleich", "vor", "nach", "bis", "ab", "zwischen", "leer", "nicht_leer"],
  auswahl: ["ist", "ist_nicht", "ist_eines_von", "leer", "nicht_leer"],
  mehrfachauswahl: ["enthaelt_eines", "enthaelt_alle", "enthaelt_keines", "leer", "nicht_leer"],
  kontrollkaestchen: ["ist_wahr", "ist_falsch"],
  verknuepfung: ["ist", "ist_nicht", "ist_eines_von", "leer", "nicht_leer"],
};
const sysFeld = (schluessel: string, name: string, typ: string, extra: Record<string, unknown> = {}) => ({
  schluessel,
  name,
  typ,
  system: true,
  schreibbar: false,
  optionen: {},
  operatoren: OPERATOREN[typ] ?? [],
  sortierbar: true,
  ...extra,
});
const opts = (...keys: string[]) => ({ optionen: keys.map((k) => ({ schluessel: k, label: k, farbe: "grau" })) });

export const crmFelderDaten: Record<"organisation" | "person" | "deal", ReturnType<typeof sysFeld>[]> = {
  organisation: [
    sysFeld("name", "Name", "text", { schreibbar: true }),
    sysFeld("art", "Art", "auswahl", { schreibbar: true, optionen: opts("unternehmen", "investor", "berater", "sonstige") }),
    sysFeld("sektor", "Sektor", "text", { schreibbar: true }),
    sysFeld("ort", "Ort", "text", { schreibbar: true }),
    sysFeld("rechtsform", "Rechtsform", "text", { schreibbar: true }),
    sysFeld("website", "Website", "url", { schreibbar: true }),
    sysFeld("email", "E-Mail", "email", { schreibbar: true }),
    sysFeld("telefon", "Telefon", "telefon", { schreibbar: true }),
    sysFeld("linkedin", "LinkedIn", "url", { schreibbar: true }),
    sysFeld("kontakte", "Kontakte", "zahl"),
    sysFeld("erstelltAm", "Angelegt", "datum"),
  ],
  person: [
    sysFeld("name", "Name", "text"),
    sysFeld("vorname", "Vorname", "text", { schreibbar: true }),
    sysFeld("nachname", "Nachname", "text", { schreibbar: true }),
    sysFeld("unternehmen", "Unternehmen", "verknuepfung", { ziel: "organisation", optionen: { ziel: "organisation" } }),
    sysFeld("funktion", "Funktion", "text", { schreibbar: true }),
    sysFeld("email", "E-Mail", "email", { schreibbar: true }),
    sysFeld("telefon", "Telefon", "telefon", { schreibbar: true }),
    sysFeld("linkedin", "LinkedIn", "url", { schreibbar: true }),
    sysFeld("erstelltAm", "Angelegt", "datum"),
  ],
  deal: [
    sysFeld("titel", "Titel", "text", { schreibbar: true }),
    sysFeld("unternehmen", "Unternehmen", "verknuepfung", { ziel: "organisation", optionen: { ziel: "organisation" } }),
    sysFeld("phase", "Phase", "auswahl", { optionen: opts("anfrage", "erstgespraech", "pruefung", "due_diligence", "investitionsausschuss", "closing") }),
    sysFeld("status", "Status", "auswahl", { optionen: opts("offen", "abgesagt", "investiert") }),
    sysFeld("ticket", "Ticket", "betrag", { schreibbar: true }),
    sysFeld("fonds", "Fonds", "text"),
    sysFeld("fondsId", "Fonds-ID", "text"),
    sysFeld("eingangsdatum", "Eingang", "datum"),
    sysFeld("herkunft", "Herkunft", "auswahl", { optionen: opts("anfrage", "sourcing") }),
    sysFeld("dealtyp", "Dealtyp", "auswahl", { optionen: opts("erstinvestment", "anschlussinvestment") }),
    sysFeld("investmentmanager", "Investmentmanagement", "text"),
    sysFeld("investmentmanagerId", "Investmentmanagement-ID", "text"),
    sysFeld("projektleiter", "Projektleitung", "text"),
    sysFeld("projektleiterId", "Projektleitung-ID", "text"),
    sysFeld("quelle", "Quelle", "text", { schreibbar: true }),
    sysFeld("betreuung", "Betreuung", "text", { schreibbar: true }),
    sysFeld("aktualisiertAm", "Aktualisiert", "datum"),
    sysFeld("erstelltAm", "Angelegt", "datum"),
  ],
};

export const crmZeilenDaten = {
  organisation: [
    { id: ORG_A, name: "Alpha Energie", art: "unternehmen", sektor: "Energie", ort: "Hamburg", rechtsform: "GmbH", website: "https://alpha.example", email: "info@alpha.example", telefon: "+49 40 123456", linkedin: null, kontakte: "2", erstelltAm: "2026-01-02" },
    { id: ORG_B, name: "Beta Medizin", art: "investor", sektor: "Medizin", ort: "Berlin", rechtsform: null, website: null, email: null, telefon: null, linkedin: null, kontakte: "0", erstelltAm: "2026-02-03" },
  ],
  person: [
    { id: "p1", name: "Anna Berger", vorname: "Anna", nachname: "Berger", unternehmen: ORG_A, funktion: "CFO", email: "anna@alpha.example", telefon: "+49 40 111", linkedin: null, erstelltAm: "2026-01-05" },
    { id: "p2", name: "Jonas Keller", vorname: "Jonas", nachname: "Keller", unternehmen: null, funktion: null, email: null, telefon: null, linkedin: null, erstelltAm: "2026-01-06" },
  ],
  deal: [
    { id: "d1", titel: "Alpha, Wachstum", unternehmen: ORG_A, phase: "anfrage", status: "offen", ticket: "2450000.00", quelle: "Empfehlung", betreuung: "Anna Berger", fondsId: FONDS_ID, fonds: "Beispielfonds I", eingangsdatum: "2026-09-01", herkunft: "anfrage", investmentmanager: null, investmentmanagerId: null, projektleiter: null, projektleiterId: null, aktualisiertAm: "2026-09-29", erstelltAm: "2026-09-01" },
    { id: "d2", titel: "Beta, Serie A", unternehmen: ORG_B, phase: "due_diligence", status: "abgesagt", ticket: "1000000.00", quelle: "Messe", betreuung: "Jonas Keller", fondsId: null, fonds: null, eingangsdatum: "2026-08-01", herkunft: "sourcing", investmentmanager: null, investmentmanagerId: null, projektleiter: null, projektleiterId: null, aktualisiertAm: "2026-09-20", erstelltAm: "2026-08-01" },
  ],
};
const crmBezuege = { [`organisation:${ORG_A}`]: "Alpha Energie", [`organisation:${ORG_B}`]: "Beta Medizin" };

type CrmTestZeile = Record<string, unknown> & { id: string };

function crmFilterPasst(zeile: CrmTestZeile, gruppe: Gruppe): boolean {
  const treffer = gruppe.elemente.map((bedingung) => {
    if (istGruppe(bedingung)) return crmFilterPasst(zeile, bedingung);
    const wert = zeile[bedingung.feld];
    if (bedingung.operator === "ist") return wert === bedingung.wert;
    if (bedingung.operator === "leer") return wert === null || wert === undefined || wert === "";
    return true;
  });
  return gruppe.verknuepfung === "und" ? treffer.every(Boolean) : treffer.some(Boolean);
}

function crmTreffer(zeilen: CrmTestZeile[], body: { filter?: Gruppe; suche?: string }) {
  const q = body.suche?.toLowerCase();
  const filter = body.filter;
  return zeilen.filter((z) =>
    (!filter || crmFilterPasst(z, filter)) && (!q || Object.values(z).some((w) => typeof w === "string" && w.toLowerCase().includes(q)))
  );
}

const crmAbfrageAntwort = (zeilen: CrmTestZeile[], filterAuswerten = false) => (a: Anfrage): Antwort => {
  const body = (a.koerper ?? {}) as { suche?: string; filter?: Gruppe; limit?: number; offset?: number };
  const daten = crmTreffer(zeilen, { suche: body.suche, filter: filterAuswerten ? body.filter : undefined });
  const { limit = 100, offset = 0 } = body;
  return { koerper: { daten: daten.slice(offset, offset + limit), gesamt: daten.length, limit, offset, bezuege: crmBezuege } };
};

const crmBoardAntwort = (zeilen: CrmTestZeile[]) => (a: Anfrage): Antwort => {
  const body = (a.koerper ?? {}) as { suche?: string; filter?: Gruppe; kartenProSpalte?: number };
  const deals = crmTreffer(zeilen, body);
  const phasen = ["anfrage", "erstgespraech", "pruefung", "due_diligence", "investitionsausschuss", "closing"];
  return {
    koerper: {
      spalten: phasen.map((phase) => {
        const karten = deals.filter((d) => d.phase === phase);
        const summe = karten.reduce((n, d) => n + Math.round(Number(d.ticket ?? 0) * 100), 0);
        return { wert: phase, anzahl: karten.length, summe: (summe / 100).toFixed(2), karten: karten.slice(0, body.kartenProSpalte ?? 50) };
      }),
      bezuege: crmBezuege,
    },
  };
};

export function crmDealAntworten(zeilen: CrmTestZeile[]): Antworten {
  return {
    "POST /api/v1/crm/objekte/deal/abfrage": crmAbfrageAntwort(zeilen, true),
    "POST /api/v1/crm/objekte/deal/board": crmBoardAntwort(zeilen),
    "POST /api/v1/crm/objekte/deal/gruppen": (a: Anfrage) => {
      const body = a.koerper as { gruppe: string; filter?: Gruppe; suche?: string };
      const deals = crmTreffer(zeilen, body);
      const zaehler = new Map<string | null, number>();
      for (const deal of deals) {
        const wert = typeof deal[body.gruppe] === "string" ? String(deal[body.gruppe]) : null;
        zaehler.set(wert, (zaehler.get(wert) ?? 0) + 1);
      }
      return { koerper: { gruppen: Array.from(zaehler, ([wert, anzahl]) => ({ wert, anzahl, summen: {} })), gesamt: deals.length, bezuege: crmBezuege } };
    },
  };
}

const crmDetail = (objekt: "organisation" | "person" | "deal", zeile: Record<string, unknown>): Antwort => ({
  koerper: { id: zeile.id, werte: zeile, felder: crmFelderDaten[objekt], bezuege: crmBezuege },
});

export const crmStandardAntworten: Antworten = {
  [`/api/v1/crm/datensaetze/organisation/${ORG_A}`]: crmDetail("organisation", crmZeilenDaten.organisation[0]!),
  [`/api/v1/crm/datensaetze/organisation/${ORG_B}`]: crmDetail("organisation", crmZeilenDaten.organisation[1]!),
  "/api/v1/crm/datensaetze/person/p1": crmDetail("person", crmZeilenDaten.person[0]!),
  "/api/v1/crm/datensaetze/person/p2": crmDetail("person", crmZeilenDaten.person[1]!),
  "/api/v1/crm/datensaetze/deal/d1": crmDetail("deal", crmZeilenDaten.deal[0]!),
  "/api/v1/crm/datensaetze/deal/d2": crmDetail("deal", crmZeilenDaten.deal[1]!),
  [`/api/v1/crm/datensaetze/organisation/${ORG_A}/verknuepfungen`]: { koerper: { eingehend: [], ausgehend: [] } },
  "/api/v1/crm/datensaetze/person/p1/verknuepfungen": { koerper: { eingehend: [], ausgehend: [] } },
  "/api/v1/crm/datensaetze/deal/d1/verknuepfungen": { koerper: { eingehend: [], ausgehend: [] } },
  "/api/v1/crm/objekte/organisation/felder": { koerper: { daten: crmFelderDaten.organisation } },
  "/api/v1/crm/objekte/person/felder": { koerper: { daten: crmFelderDaten.person } },
  "/api/v1/crm/objekte/deal/felder": { koerper: { daten: crmFelderDaten.deal } },
  "POST /api/v1/crm/objekte/organisation/abfrage": crmAbfrageAntwort(crmZeilenDaten.organisation),
  "POST /api/v1/crm/objekte/person/abfrage": crmAbfrageAntwort(crmZeilenDaten.person),
  ...crmDealAntworten(crmZeilenDaten.deal),
  "/api/v1/crm/ansichten": { koerper: { daten: [] } },
  "/api/v1/crm/listen": { koerper: { daten: [] } },
  "/api/v1/crm/aufgaben": { koerper: { daten: [] } },
  "/api/v1/crm/beschaeftigungen": { koerper: { daten: [] } },
  "/api/v1/crm/deals/d1/kontakte": { koerper: { daten: [] } },
};

export function spieleApi(abweichend: Antworten = {}) {
  const standard: Antworten = {
    "/api/v1/me": { koerper: ichAlsApi(ichDaten) },
    "/api/v1/environment": { koerper: umgebungAlsApi(umgebungDaten) },
    "/api/v1/theme": { koerper: { theme: "system" } },
    "/api/v1/fonds": { koerper: fondsDaten },
    [`/api/v1/fonds/${FONDS_ID}`]: { koerper: fondsDaten.daten[0] },
    [`/api/v1/fonds/${FONDS_ID}/uebersicht`]: { koerper: uebersichtDaten },
    [`/api/v1/fonds/${FONDS_ID}/nav-einzelwerte`]: { koerper: { portfolio: [], salden: [] } },
    [`/api/v1/beteiligungen/${BET_ID}`]: { koerper: beteiligungDaten },
    "/api/v1/deals": { koerper: dealDaten },
    [`/api/v1/deals/${DEAL_ID}`]: { koerper: dealDetailDaten },
    "/api/v1/organisationen": { koerper: organisationListeDaten },
    "/api/v1/organisationen/dubletten": { koerper: { daten: [] } },
    [`/api/v1/organisationen/${ORG_A}`]: { koerper: organisationDaten },
    "/api/v1/aktivitaeten": { koerper: { daten: [aktivitaetDaten] } },
    "/api/v1/wiedervorlagen": { koerper: { daten: [wiedervorlageDaten] } },
    "/api/v1/termine": { koerper: { daten: [] } },
    "/api/v1/wiedervorlagen/anzahl": { koerper: { ueberfaellig: 1, heute: 1, gesamt: 2 } },
    "/api/v1/dealflow/arbeitsliste": { koerper: { deals: [arbeitsdealDaten], benutzerId: ICH_ID } },
    "/api/v1/dealflow/kartenfelder": { koerper: { felder: ["ticket", "investmentmanager"] } },
    "/api/v1/deals/d1/zustaendige": { koerper: { benutzer: namenDaten.daten } },
    "/api/v1/dealflow/trichter": { koerper: trichterDaten },
    [`/api/v1/beteiligungen/${BET_ID}/instrumentdaten`]: { koerper: instrumentDaten },
    [`/api/v1/beteiligungen/${BET_ID}/zinsen`]: { koerper: zinsenDaten },
    [`/api/v1/fonds/${FONDS_ID}/zinsen`]: { koerper: fondsZinsenDaten },
    [`/api/v1/fonds/${FONDS_ID}/bewegungen/kapitalstand`]: { koerper: { quellenstand: "2026-10-01T10:11:12.345678Z", fonds: { abgerufen: "500.00", eingezahlt: "400.00", offen: "100.00", ueberfaellig: "0.00", ungeklaert: "0.00" }, konten: [] } },
    [`/api/v1/fonds/${FONDS_ID}/bewegungen`]: { koerper: bewegungenDaten },
    [`/api/v1/fonds/${FONDS_ID}/abgrenzung`]: { koerper: { ...abgrenzungDaten, darlehen: [], summe: { offen: "0.00", gesamt: "0.00" } } },
    "/api/v1/users/names": { koerper: namenDaten },
    [`/api/v1/fonds/${FONDS_ID}/kennzahlen/auswahl`]: { koerper: { daten: [] } },
    [`/api/v1/funds/${FONDS_ID}/posting-rules`]: { koerper: { data: [] } },
    "/api/v1/documents": { koerper: { daten: [] } },
    [`/api/v1/investments/${BET_ID}/accounting-keys`]: { koerper: { investmentId: BET_ID, projectNumber: null, contractNumber: null, partnerNumber: null, companyCode: null, fundingProgram: null, fundingProgramLabel: null, updatedBy: null, updatedAt: null, organizationId: ORG_A, countryOfDomicile: null, region: null } },
    "/api/v1/funding-programs": { koerper: { daten: [{ id: "00000000-0000-4000-8000-0000000000e1", schluessel: "demo_wachstum", bezeichnung: "Beispielprogramm Wachstum", erstelltVon: "demo", erstelltAm: "2026-01-01T00:00:00.000Z" }] } },
    "/api/v1/ai/status": { koerper: { aktiv: false, anbieter: "aus", region: null, modell: null } },
    ...crmStandardAntworten,
    [`/api/v1/beteiligungen/${BET_ID}/bewertungen`]: { koerper: bewertungenDaten },
    [`/api/v1/beteiligungen/${BET_ID}/kapitaltabelle`]: { koerper: kapitalDaten },
    [`/api/v1/beteiligungen/${BET_ID}/wasserfall/kurve`]: { koerper: kurveDaten },
    [`/api/v1/beteiligungen/${BET_ID}/wasserfall`]: { koerper: wasserfallDaten },
    [`/api/v1/organisationen/${ORG_A}/anteilsklassen`]: { koerper: anteilsklassenDaten },
    [`/api/v1/organisationen/${ORG_A}/mitarbeiterpools`]: { koerper: mitarbeiterpoolDaten },
    [`/api/v1/organisationen/${ORG_A}/finanzierungsrunden`]: { koerper: { daten: [] } },
    [`/api/v1/organisationen/${ORG_A}/share-transfers`]: { koerper: { data: [] } },
    [`/api/v1/organisationen/${ORG_A}/rundentransaktionen`]: { koerper: { organisationId: ORG_A, runden: [], ohneRunde: [] } },
    [`/api/v1/fonds/${FONDS_ID}/bewertungsrunden`]: { koerper: rundenListeDaten },
    [`/api/v1/bewertungsrunden/${RUNDE_ID}`]: { koerper: rundeDetailDaten },
    "/api/v1/reports": { koerper: berichtListeDaten },
    [`/api/v1/reports/${BERICHT_ID}`]: { koerper: berichtDetailDaten },
    [`/api/v1/reports/${BERICHT_ID}/checks`]: { koerper: berichtKontrolleGruen },
    [`/api/v1/funds/${FONDS_ID}/report-templates`]: { koerper: vorlagenDaten },
    [`/api/v1/funds/${FONDS_ID}/approval-stages`]: { koerper: stufenDaten },
    "/api/v1/zinslaeufe": { koerper: zinslaufListeDaten },
    [`/api/v1/zinslaeufe/${ZL_ID}`]: { koerper: zinslaufDaten },
    [`/api/v1/zinslaeufe/${ZL_ID}/kontrolle`]: { koerper: kontrolleDaten },
  };
  const fixturePfad = (pfad: string) => {
    if (berichtBereich(pfad) || kontaktFixtureUrl(pfad, true)) return pfad;
    const fonds = fondsFixturePfad(pfad);
    if (fonds.fonds) return fonds.pfad;
    return kontaktFixtureUrl(pfad, false)?.pfad ?? fondsFixturePfad(portfolioFixturePfad(pfad).pfad).pfad;
  };
  const antworten = Object.fromEntries(Object.entries({ ...standard, ...abweichend }).map(([k, v]) => {
    const match = k.match(/^([A-Z]+ )?(.*)$/)!;
    return [(match[1] ?? "") + fixturePfad(match[2]!), v];
  }));
  const aufrufe: Anfrage[] = [];
  const mock = vi.fn(async (eingabe: RequestInfo | URL, init?: RequestInit) => {
    const anfrage = new Request(eingabe instanceof URL ? eingabe.href : eingabe, init);
    const url = new URL(anfrage.url);
    const formular = init?.body instanceof FormData ? init.body : undefined;
    const text = formular ? "" : await anfrage.clone().text();
    const bereich = berichtBereich(url.pathname);
    const fixture = bereich ? undefined : kontaktFixtureUrl(url.pathname + url.search, false);
    const { format } = portfolioFixturePfad(url.pathname, true);
    const roh: unknown = text ? JSON.parse(text) : undefined;
    const fonds = !bereich && fondsFixturePfad(url.pathname).fonds;
    const koerper = bereich ? berichtVonApi(bereich, roh) : fonds ? fondsFixtureVonApi(roh) : fixture ? kontaktFixtureJson(roh, false, fixture.crm) : portfolioFixtureVonApi(roh, format);
    const query = bereich ? new URLSearchParams(berichtVonApi(bereich, Object.fromEntries(url.searchParams))) : fonds ? new URLSearchParams(fondsFixtureVonApi(Object.fromEntries(url.searchParams)) as Record<string, string>) : fixture?.query ?? (format === "portfolio"
      ? new URLSearchParams(portfolioFixtureVonApi(Object.fromEntries(url.searchParams), format) as Record<string, string>)
      : url.searchParams);
    if (fonds && query.has("typ")) query.set("typ", query.get("typ")!.split(",").map(fondsEnumVonApi).join(","));
    const aufruf: Anfrage = { methode: anfrage.method, pfad: fonds ? url.pathname : fixture?.pfad ?? url.pathname, query, koerper, ...(formular ? { formular } : {}), credentials: anfrage.credentials };
    aufrufe.push(aufruf);
    const treffer = antworten[`${anfrage.method} ${aufruf.pfad}`] ?? antworten[aufruf.pfad];
    if (!treffer) return Response.json({ error: { code: "not_found", message: "weg" } }, { status: 404 });
    const antwort = typeof treffer === "function" ? await treffer(aufruf) : treffer;
    // 204 hat keinen Körper.
    if (antwort.status === 204) return new Response(null, { status: 204 });
    const gruppe = (aufruf.koerper as { gruppe?: string } | undefined)?.gruppe;
    const koerperApi = bereich ? berichtAnApi(bereich, antwort.koerper) : fonds ? fondsFixtureAnApi(antwort.koerper) : fixture
      ? kontaktFixtureJson(antwort.koerper, true, fixture.crm, gruppe)
      : portfolioFixtureAnApi((antwort.status ?? 200) < 400 ? alsApiAntwort(anfrage.method, url.pathname, antwort.koerper) : antwort.koerper, format);
    return Response.json(koerperApi, { status: antwort.status ?? 200, ...(antwort.kopf ? { headers: antwort.kopf } : {}) });
  });
  vi.stubGlobal("fetch", mock);
  return Object.assign(mock, {
    aufrufe,
    /** Alle Anfragen mit dieser Methode und diesem Pfad. */
    anfragen: (methode: string, pfad: string) => aufrufe.filter((a) => a.methode === methode && a.pfad === fixturePfad(pfad)),
  });
}

// Antworten in der englischen Form der Schnittstelle ----------------------------------------------------------------------
// Die Fixtures der Tests nennen die Begriffe der Oberfläche (`rollen`, `aktiv` …), wie die Seiten sie verwenden; die Schnittstelle antwortet
// englisch (Issue 184). `alsApiAntwort` übersetzt die Körper der betroffenen Routen beim Ausliefern, Fixtures, die schon englisch sind, bleiben
// unverändert. Anfragen zeichnen die Tests dagegen so auf, wie die Oberfläche sie sendet (englisch).

type Roh = Record<string, unknown>;
const stufeApi = (r: unknown) => stufeAnApi(r as "betrachter");
const mitDaten = (k: Roh, f: (z: Roh) => Roh) => (Array.isArray(k.daten) ? { data: (k.daten as Roh[]).map(f) } : k);
const benutzerApi = (b: Roh) =>
  "active" in b
    ? b
    : {
        id: b.id,
        name: b.name,
        email: b.email,
        active: b.aktiv,
        technicalUser: b.technisch,
        globalAdmin: b.globalVerwalter,
        twoFactorEnabled: b.zweiFaktorAktiv,
        passwordChangeRequired: b.passwortAendern,
        invitationPending: b.einladungOffen,
        roles: ((b.rollen ?? []) as Roh[]).map((r) => ({ fundId: r.fondsId, role: stufeApi(r.rolle) })),
        groupIds: b.gruppen ?? [],
      };
const schluesselApi = (z: Roh) =>
  "expiresAt" in z
    ? z
    : {
        id: z.id,
        name: z.name,
        userId: z.benutzerId,
        preview: z.vorschau,
        scopes: ((z.scopes ?? []) as Roh[]).map((x) => ({ fundId: x.fondsId, permission: x.recht === "lesen" ? "read" : "write" })),
        fundIds: z.fondsIds,
        expiresAt: z.ablauf,
        createdAt: z.erstelltAm,
        lastUsedAt: z.zuletztGenutzt,
        revokedAt: z.widerrufenAm,
        status: ({ aktiv: "active", abgelaufen: "expired", widerrufen: "revoked" } as Record<string, string>)[z.status as string] ?? z.status,
        ...(z.schluessel === undefined ? {} : { key: z.schluessel }),
      };
const rueckstandApi = (r: unknown) => (r === null || r === undefined ? r : { count: (r as Roh).anzahl, oldestSeconds: (r as Roh).aeltesterSekunden });

function alsApiAntwort(methode: string, pfad: string, k: unknown): unknown {
  if (Array.isArray(k) && pfad === "/api/v1/account/sessions") {
    return (k as Roh[]).map((x) => ("current" in x ? x : { id: x.id, current: x.aktuell, createdAt: x.erstelltAm, lastActiveAt: x.zuletztAktivAm, expiresAt: x.laeuftAbAm, ip: x.ip, device: x.geraet }));
  }
  if (k === null || typeof k !== "object" || Array.isArray(k)) return k;
  const o = k as Roh;
  const p = pfad.replace("/api/v1", "");
  if (p === "/me" && !("roles" in o)) return ichAlsApi(o as never);
  if (p === "/environment" && !("environment" in o)) return umgebungAlsApi(o as never);
  if (p === "/theme" && "thema" in o) return { theme: ({ system: "system", hell: "light", dunkel: "dark" } as Record<string, string>)[o.thema as string] };
  if (p === "/users/names") return mitDaten(o, (z) => z);
  if (p === "/users" && methode === "GET") return mitDaten(o, benutzerApi);
  if (/^\/users(\/[^/]+)?$/.test(p) && methode !== "GET" && "aktiv" in o)
    return { id: o.id, name: o.name, email: o.email, active: o.aktiv, globalAdmin: o.globalVerwalter, ...("einladung" in o ? { invited: o.einladung } : {}) };
  if (/^\/funds\/[^/]+\/roles$/.test(p)) return mitDaten(o, (z) => ("userId" in z ? z : { userId: z.benutzerId, name: z.name, email: z.email, active: z.aktiv, role: stufeApi(z.rolle) }));
  if (/^\/funds\/[^/]+\/roles\/[^/]+$/.test(p) && "rolle" in o) return { userId: o.benutzerId, fundId: o.fondsId, role: stufeApi(o.rolle) };
  if (p === "/api-keys" && methode === "GET") return mitDaten(o, schluesselApi);
  if (/^\/api-keys(\/[^/]+)?$/.test(p) && "ablauf" in o) return schluesselApi(o);
  if (p === "/value-keys" && methode === "GET") return mitDaten(o, schluesselApi);
  if (/^\/value-keys(\/[^/]+)?$/.test(p) && "ablauf" in o) return schluesselApi(o);
  if (p === "/account/security" && "passwortVorhanden" in o)
    return { passwordSet: o.passwortVorhanden, passwordChangedAt: o.passwortGeaendertAm, providers: o.anbieter, twoFactorEnabled: o.zweiFaktorAktiv, twoFactorRequired: o.zweiFaktorPflicht, recoveryCodesRemaining: o.codesUebrig, sessionCount: o.sitzungenAnzahl };
  if (p === "/account/password" && "andereSitzungenBeendet" in o) return { ok: true, otherSessionsEnded: o.andereSitzungenBeendet };
  if (p === "/account/two-factor/restart" && "backupCodes" in o) return { totpUri: o.totpURI, recoveryCodes: o.backupCodes, expiresInSeconds: o.ablaufSekunden };
  if (p === "/account/recovery-codes" && "backupCodes" in o) return { recoveryCodes: o.backupCodes };
  if (p === "/operations/status" && "ampel" in o) {
    const b = o as { ampel: string; erzeugtAm: string; datenbank: Roh; migrationen: Roh; worker: Roh; rueckstaende: Roh; speicher: Roh; smtp: Roh; erweiterungen: Roh };
    return {
      status: ({ ok: "ok", warnung: "warning", fehler: "error" } as Record<string, string>)[b.ampel],
      generatedAt: b.erzeugtAm,
      database: { reachable: b.datenbank.erreichbar },
      migrations: { ok: b.migrationen.ok, known: b.migrationen.bekannt, applied: b.migrationen.angewendet, message: b.migrationen.meldung },
      worker: { status: ({ ok: "ok", ausgefallen: "down", unbekannt: "unknown" } as Record<string, string>)[b.worker.status as string], heartbeatAgeSeconds: b.worker.herzschlagAlterSekunden, thresholdSeconds: b.worker.grenzeSekunden },
      backlogs: { snapshots: rueckstandApi(b.rueckstaende.snapshots), mail: rueckstandApi(b.rueckstaende.mail), extraction: rueckstandApi(b.rueckstaende.auslesung), register: rueckstandApi(b.rueckstaende.register), warningSeconds: b.rueckstaende.warnungSekunden },
      storage: { writable: b.speicher.beschreibbar },
      smtp: { configured: b.smtp.konfiguriert },
      extensions: Object.fromEntries(Object.entries(b.erweiterungen ?? {}).map(([n, w]) => [n, "anbieter" in (w as Roh) ? { provider: (w as Roh).anbieter } : w])),
    };
  }
  if (p === "/settings" && "sprache" in o) return { language: o.sprache, mailOnReportApproved: o.mailBerichtFreigegeben, mailOnRegisterEvent: o.mailRegisterEreignis, mailAvailable: o.mailVerfuegbar };
  if (p === "/settings/calendar-link" && "aktiv" in o) return { active: o.aktiv, createdAt: o.erstelltAm, lastAccessAt: o.letzterZugriffAm };
  if (p === "/settings/calendar-link" && "pfad" in o) return { token: o.token, path: o.pfad, url: o.url };
  if (p === "/permissions" && "fondsOffen" in o) {
    const r = o as { fondsOffen: boolean; bereiche: string[]; rollen: Roh[]; gruppen: Roh[] };
    const b = (l: unknown) => ((l ?? []) as string[]).map((x) => bereichAnApi(x as BereichName));
    const jeBereich = (w: unknown) => Object.fromEntries(Object.entries((w ?? {}) as Record<string, string>).map(([k2, v]) => [bereichAnApi(k2 as BereichName), stufeApi(v)]));
    return {
      fundsOpen: r.fondsOffen,
      areas: b(r.bereiche),
      roles: r.rollen.map((x) => ({ id: x.id, name: x.name, description: x.beschreibung, areas: b(x.bereiche), areaLevels: jeBereich(x.bereichStufen), createdAt: x.erstelltAm })),
      groups: r.gruppen.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.beschreibung,
        level: stufeApi(g.stufe),
        fundsRestricted: g.fondsBeschraenkt,
        areasPerFund: g.bereicheJeFonds,
        fundIds: g.fondsIds,
        fundAreas: Object.fromEntries(Object.entries((g.fondsBereiche ?? {}) as Record<string, string[]>).map(([f, l]) => [f, b(l)])),
        roleIds: g.rollenIds,
        memberIds: g.mitglieder,
        createdAt: g.erstelltAm,
      })),
    };
  }
  return k;
}

/** Fehlerantwort der API im einheitlichen Format. */
export const fehler = (status: number, code: string, zusatz: Record<string, unknown> = {}): Antwort => {
  // Feldfehler schreiben die Tests wie die Oberfläche (`{ feld, code, meldung }`); die API schickt sie als `fields: [{ field, code, message }]`.
  const { felder, ...rest } = zusatz as { felder?: unknown };
  const feldfehler = Array.isArray(felder) && felder.length > 0 && felder.every((f) => typeof (f as { feld?: unknown })?.feld === "string");
  const fields = feldfehler ? (felder as { feld: string; code: string; meldung?: string }[]).map((f) => ({ field: f.feld, code: f.code, message: f.meldung ?? "" })) : undefined;
  return { status, koerper: { error: { code, message: code, ...(fields ? { fields } : felder !== undefined ? { felder } : {}), ...rest } } };
};

/** Fehlerantwort von Better Auth (`/auth/*`): `{ code, message }` auf oberster Ebene. */
export const authFehler = (status: number, code: string): Antwort => ({ status, koerper: { code, message: code } });

export function rendereApp(url: string) {
  const queryClient = erstelleQueryClient({ wiederholen: false });
  const router = erstelleRouter(queryClient, createMemoryHistory({ initialEntries: [url] }));
  return { router, queryClient, ...render(<Anwendung queryClient={queryClient} router={router} />) };
}

/** Löst eine Aktion der Beteiligung im Seitenkopf aus: „Vorgang erfassen“ ist der Hauptknopf, alles andere steht im Menü „Weitere Aktionen“. */
export async function waehleAktion(nutzer: { click: (e: Element) => Promise<void> }, name: string) {
  if (name === "Vorgang erfassen" || name === "Record transaction") {
    await nutzer.click(await screen.findByRole("button", { name }));
    return;
  }
  await nutzer.click(await screen.findByRole("button", { name: /Weitere Aktionen|More actions/ }));
  await nutzer.click(await screen.findByRole("menuitem", { name }));
}

/** Die innerste Region dieses Namens: Der Bereich einer Detailseite trägt den Namen seines Eintrags, und der Abschnitt darin trägt oft denselben Namen. */
export const letzteRegion = async (name: string | RegExp) => (await screen.findAllByRole("region", { name })).at(-1)!;
