import type { FondsRolle } from "@carraway/db";
import { bereichVon, type RegelBereich } from "./bereiche";

/**
 * Die eine Berechtigungstabelle. Jede Route der API steht hier mit der Mindestrolle, und zwar unter genau dem
 * Pfadmuster, das Hono für sie kennt. Was nicht in der Tabelle steht, wird abgelehnt (403), und ein Test schlägt fehl,
 * sobald eine Route fehlt oder die Tabelle eine Route nennt, die es nicht gibt.
 *
 * Rollen je Fonds: betrachter < bearbeiter < freigeber < verwalter. Lesen = betrachter, Schreiben = bearbeiter,
 * Freigeben = freigeber, Einstellungen, Rollen und Periodensperre = verwalter. Globale Verwalter sind überall Verwalter.
 */

export type Methode = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Woher die Fonds-ID kommt und wie sie aufgelöst wird (Datensatz → Fonds). */
export type Aufloesung =
  | "fonds"
  | "beteiligung"
  | "vorgang"
  | "fondsbewegung"
  | "meilenstein"
  | "instrument"
  | "forderung"
  | "zinslauf"
  | "deal"
  | "aktivitaet"
  | "bewertung"
  | "bewertungsrunde"
  | "szenario"
  | "verkauf"
  | "bericht"
  | "beschlussvorlage"
  | "beziehung"
  // Datensätze ohne einzelnen Fonds: Es genügt die Rolle an irgendeinem Fonds, der eine Beteiligung an der Organisation hält
  // (`organisationHalter`; bei `rundenpositionHalter` über die Organisation der Runde). Hält kein Fonds sie, gibt es 403
  // (globale Verwalter ausgenommen).
  | "organisationHalter"
  | "rundenpositionHalter"
  | "kennzahlwert"
  | "kennzahlabfrage"
  | "beleg"
  | "saldenlauf"
  | "kontenregel"
  | "buchungsexport"
  | "meldelauf";

export interface Ziel {
  ort: "pfad" | "koerper" | "abfrage";
  feld: string;
  ueber: Aufloesung;
}

export interface Regel {
  methode: Methode;
  muster: string;
  /**
   * `oeffentlich`: ohne Anmeldung; `angemeldet`: jede angemeldete Person, auch ohne zweiten Faktor oder Rolle;
   * `rolle`: Mindestrolle `rolle` an allen genannten `ziele` (ohne Ziele: an irgendeinem Fonds);
   * `globalverwalter`: nur globale Verwalter (Benutzer- und Schlüsselverwaltung);
   * `investor`: nur Investor-Benutzer des LP-Portals (Routen unter `/portal`); die Handler beschränken auf die Organisationen des Zugangs.
   * Umgekehrt lehnt die Prüfung Investor-Benutzer an jeder anderen Regel außer `oeffentlich` und `angemeldet` ab (403 `portal_only`).
   */
  zugriff: "oeffentlich" | "angemeldet" | "rolle" | "globalverwalter" | "investor";
  rolle?: FondsRolle;
  ziele?: Ziel[];
  /** Freigaben brauchen Menschen: technische Benutzer (API-Schlüssel) bekommen 403 `technical_user`. */
  nurMensch?: boolean;
  /** Nur hier darf ein explizit freigeschalteter Werteschlüssel höhere Fondsrollen verwenden. */
  werteSchreiben?: boolean;
  /** Eigenständiges Leseprotokoll über HTTP: nur API-Schlüssel, jede Anfrage einzeln und mit aktuellen Rechten. */
  leseTransport?: boolean;
  /**
   * Bereich der Anwendung (nur bei `rolle`): Personen in Nutzergruppen brauchen ihn zusätzlich zur Fondsrolle, siehe `bereiche.ts` und
   * docs/permissions-model.md. Ohne Angabe in der Zeile gilt die Zuordnung nach Pfadmuster aus `bereiche.ts`.
   */
  bereich?: RegelBereich;
  /**
   * Die Stufe einer Gruppe ohne Fonds genügt als „Rolle irgendwo“ (Daten ohne Fonds). Gesetzt für die Bereiche Kontakte, Dealflow und allgemein (`OHNE_FONDS`); die
   * Ziele (Fonds eines Deals, haltende Fonds einer Organisation) prüft die Regel trotzdem.
   */
  ohneFondsErlaubt?: boolean;
}

// Bausteine der Regeln; Erweiterungen (`ee/`) schreiben ihre Regeln mit denselben Bausteinen und geben sie über `ApiErweiterung.regeln` an.
export const pfad = (ueber: Aufloesung, feld = "id"): Ziel => ({ ort: "pfad", feld, ueber });
export const koerper = (feld: string, ueber: Aufloesung = "fonds"): Ziel => ({ ort: "koerper", feld, ueber });
export const abfrage = (feld: string, ueber: Aufloesung = "fonds"): Ziel => ({ ort: "abfrage", feld, ueber });

export const regel = (methode: Methode, muster: string, rolle: FondsRolle, ziele: Ziel[] = [], zusatz: Partial<Regel> = {}): Regel => ({
  methode,
  muster,
  zugriff: "rolle",
  rolle,
  ziele,
  ...zusatz,
});
const offen = (methode: Methode, muster: string): Regel => ({ methode, muster, zugriff: "oeffentlich" });
export const global = (methode: Methode, muster: string): Regel => ({ methode, muster, zugriff: "globalverwalter" });
export const portal = (methode: Methode, muster: string): Regel => ({ methode, muster, zugriff: "investor" });

const ROH: Regel[] = [
  // Ohne Anmeldung --------------------------------------------------------------------------------------------------
  offen("GET", "/health"),
  offen("GET", "/environment"),
  offen("GET", "/auth/*"),
  offen("POST", "/auth/*"),
  offen("POST", "/setup"), // nur solange es noch keine Person gibt
  offen("POST", "/password/forgot"), // Passwort zurücksetzen per Mail: gleiche Antwort für jede Adresse, begrenzt je IP und Adresse
  offen("GET", "/openapi.json"),
  offen("GET", "/docs"),
  // Link ohne Konto: das Token in der Adresse ist der Zugang, genau zu einer Anfrage. Begrenzung, Prüfung und Protokoll in `routen/extern.ts`.
  offen("GET", "/external/requests/:token"),
  offen("PUT", "/external/requests/:token"),
  offen("POST", "/external/requests/:token/submit"),
  // Kalenderabonnement (ICS) einer Person (Etappe 17): Das Token vor `.ics` ist der Zugang, nur als Hash gespeichert und widerrufbar. Begrenzung, Prüfung und Antwort in `routen/kalender.ts`.
  offen("GET", "/calendar/:file"),

  { methode: "GET", muster: "/me", zugriff: "angemeldet" },
  // Thema der Oberfläche: nur der eigene Wert, auch für Investor-Benutzer des Portals; ein API-Schlüssel bekommt im Handler 403.
  { methode: "GET", muster: "/theme", zugriff: "angemeldet" },
  { methode: "PATCH", muster: "/theme", zugriff: "angemeldet" },

  // Eigene Sicherheit (Passwort, Sitzungen, zweiter Faktor): nur die eigene Person, nur mit Sitzung (die Handler lehnen API-Schlüssel ab).
  // „angemeldet“, damit auch ein Startpasswort oder ein fehlender zweiter Faktor hier behoben werden kann.
  { methode: "GET", muster: "/account/security", zugriff: "angemeldet" },
  { methode: "POST", muster: "/account/password", zugriff: "angemeldet" },
  { methode: "GET", muster: "/account/sessions", zugriff: "angemeldet" },
  { methode: "POST", muster: "/account/sessions/end-others", zugriff: "angemeldet" },
  { methode: "DELETE", muster: "/account/sessions/:id", zugriff: "angemeldet" },
  { methode: "POST", muster: "/account/two-factor/restart", zugriff: "angemeldet" },
  { methode: "POST", muster: "/account/two-factor/restart/confirm", zugriff: "angemeldet" },
  { methode: "POST", muster: "/account/recovery-codes", zugriff: "angemeldet" },

  // Benutzer und API-Schlüssel: globale Verwalter ---------------------------------------------------------------------
  global("GET", "/users"),
  global("POST", "/users"),
  global("PATCH", "/users/:id"),
  global("POST", "/users/:id/invitation"),
  // Rollen, Nutzergruppen und Fondszugriff (Rechtemodell, docs/permissions-model.md): nur globale Verwalter. Wirksame Rechte einer Person zur Kontrolle.
  global("GET", "/users/:id/permissions"),
  global("GET", "/permissions"),
  global("PUT", "/permissions/settings"),
  global("POST", "/permissions/roles"),
  global("PATCH", "/permissions/roles/:id"),
  global("DELETE", "/permissions/roles/:id"),
  global("POST", "/permissions/groups"),
  global("PATCH", "/permissions/groups/:id"),
  global("DELETE", "/permissions/groups/:id"),
  // Anzeigenamen: jede Person mit einer Rolle; die Handler-Logik begrenzt auf Personen, die einen Fonds teilen.
  regel("GET", "/users/names", "betrachter"),
  // Betriebsstatus (Verwaltung → Betrieb): Migrationsstand, Worker, Rückstände, Ablage, SMTP, Angaben der Erweiterungen.
  global("GET", "/operations/status"),
  global("GET", "/data-providers"),
  global("PUT", "/data-providers/:provider"),
  global("DELETE", "/data-providers/:provider"),
  global("POST", "/data-providers/:provider/test"),
  regel("GET", "/organizations/:id/provider-data", "betrachter"),
  regel("POST", "/organizations/:id/provider-data/search", "bearbeiter", [], { nurMensch: true }),
  regel("POST", "/organizations/:id/provider-data/fetch", "bearbeiter", [], { nurMensch: true }),
  regel("POST", "/organizations/:id/provider-data/:suggestionId/review", "bearbeiter", [], { nurMensch: true }),
  global("GET", "/integrations"),
  global("PUT", "/integrations/:provider"),
  global("POST", "/integrations/:provider/preview"),
  global("GET", "/integrations/:provider/runs"),
  global("POST", "/integrations/runs/:id/apply"),
  global("POST", "/integrations/runs/:id/cancel"),
  global("GET", "/api-keys"),
  global("POST", "/api-keys"),
  global("DELETE", "/api-keys/:id"),

  // Zeichnungen, Closings und Zusageänderungen der Investoren eines Fonds (Etappe 12): ansehen = verwalter des Fonds, ändern = globale Verwalter.
  // Zugänge zum LP-Portal (Investor-Benutzer) bringt die Erweiterung LP-Portal mit (`ee/`).
  regel("GET", "/funds/:fundId/investor-access", "verwalter", [pfad("fonds", "fundId")], { nurMensch: true }),
  global("POST", "/funds/:fundId/investor-access/subscriptions"),
  global("PATCH", "/funds/:fundId/investor-access/subscriptions/:organizationId"),
  global("DELETE", "/funds/:fundId/investor-access/subscriptions/:organizationId"),
  global("POST", "/funds/:fundId/investor-access/closings"),
  global("POST", "/funds/:fundId/investor-access/commitment-changes"),
  global("POST", "/funds/:fundId/investor-access/closings/:closingId/reverse"),
  global("POST", "/funds/:fundId/investor-access/closings/:closingId/correct"),

  // Fonds ---------------------------------------------------------------------------------------------------------------
  regel("GET", "/funds", "betrachter"), // Liste: nur Fonds mit Rolle
  global("POST", "/funds"),
  regel("GET", "/funds/:id", "betrachter", [pfad("fonds")]),
  regel("PATCH", "/funds/:id", "verwalter", [pfad("fonds")]),
  regel("GET", "/funds/:id/nav-components", "betrachter", [pfad("fonds")]),
  regel("GET", "/funds/:id/overview", "betrachter", [pfad("fonds")]),
  // Zielfonds eines Dachfonds (Zusagen, Abrufe, Ausschüttungen, NAV-Meldungen): lesen = betrachter, erfassen und stornieren = bearbeiter.
  regel("GET", "/funds/:id/target-funds", "betrachter", [pfad("fonds")]),
  regel("POST", "/funds/:id/target-funds", "bearbeiter", [pfad("fonds")]),
  regel("GET", "/funds/:id/target-funds/:targetFundId", "betrachter", [pfad("fonds")]),
  regel("PATCH", "/funds/:id/target-funds/:targetFundId", "bearbeiter", [pfad("fonds")]),
  regel("POST", "/funds/:id/target-funds/:targetFundId/movements", "bearbeiter", [pfad("fonds")]),
  regel("POST", "/funds/:id/target-funds/:targetFundId/movements/:movementId/reverse", "bearbeiter", [pfad("fonds")]),
  regel("POST", "/funds/:id/target-funds/:targetFundId/nav-reports", "bearbeiter", [pfad("fonds")]),
  // Manager-Profil und Portfolio-Dashboard: Rolle an irgendeinem Fonds; die Summen umfassen nur die Fonds, an denen die Person Portfolio sieht.
  regel("GET", "/manager-profile", "betrachter", [], { bereich: "portfolio" }),
  global("PUT", "/manager-profile"),
  regel("GET", "/portfolio/dashboard", "betrachter", [], { bereich: "portfolio" }),
  regel("POST", "/funds/:id/recalculate", "bearbeiter", [pfad("fonds")]),
  // Einheitliche Erfassung (Etappe 4b): alle von Hand buchbaren Arten. Bei Vorgängen prüft die Regel auch die Rolle am Fonds der Beteiligung
  // im Körper, der Handler lehnt eine Beteiligung eines anderen Fonds ab. Storno einer Fondsbewegung wie Storno eines Vorgangs.
  regel("POST", "/funds/:id/postings", "bearbeiter", [pfad("fonds"), koerper("investmentId", "beteiligung")]),
  regel("GET", "/funds/:id/fund-movements/preview", "bearbeiter", [pfad("fonds")]),
  // Journal: lesen = betrachter; eine Beteiligung im Filter muss zu einem Fonds gehören, den die Person sehen darf. Export schreibt eine Zeile `gelesen`.
  regel("GET", "/funds/:id/journal", "betrachter", [pfad("fonds"), abfrage("investmentId", "beteiligung")]),
  // Wie die Kapitalkonten: interne Betrachter des jeweiligen Fonds. Investor-Benutzer bleiben auf das LP-Portal beschränkt.
  regel("GET", "/fund-movements/:id", "betrachter", [pfad("fondsbewegung")]),
  regel("GET", "/fund-movements/:id/payments", "betrachter", [pfad("fondsbewegung")]),
  regel("POST", "/fund-movements/:id/payments", "bearbeiter", [pfad("fondsbewegung")]),
  regel("POST", "/fund-movements/:id/payments/reverse", "bearbeiter", [pfad("fondsbewegung")]),
  regel("POST", "/fund-movements/:id/reverse", "bearbeiter", [pfad("fondsbewegung")]),
  regel("GET", "/funds/:id/accruals", "betrachter", [pfad("fonds")]),
  regel("GET", "/funds/:id/interest", "betrachter", [pfad("fonds")]), // Zinsansicht je Instrument (Portfolio-Modell)
  regel("GET", "/funds/:id/reports/fund-report", "betrachter", [pfad("fonds")]),
  regel("GET", "/funds/:id/reports/portfolio-list", "betrachter", [pfad("fonds")]),
  // Bewertungsrunden: anlegen = bearbeiter, lesen = betrachter (freigeben und verwerfen unter `/bewertungsrunden/:id`).
  regel("POST", "/funds/:id/valuation-rounds", "bearbeiter", [pfad("fonds")]),
  regel("GET", "/funds/:id/valuation-rounds", "betrachter", [pfad("fonds")]),
  regel("GET", "/funds/:id/valuations", "betrachter", [pfad("fonds")]),
  // Vorlagen und Freigabestufen je Fonds: lesen = betrachter, ändern = verwalter des Fonds.
  regel("GET", "/funds/:id/report-templates", "betrachter", [pfad("fonds")]),
  regel("PUT", "/funds/:id/report-templates/:reportType", "verwalter", [pfad("fonds")]),
  regel("GET", "/funds/:id/approval-stages", "betrachter", [pfad("fonds")]),
  regel("PUT", "/funds/:id/approval-stages", "verwalter", [pfad("fonds")]),
  regel("GET", "/funds/:id/period-lock", "verwalter", [pfad("fonds")]),
  regel("PUT", "/funds/:id/period-lock", "verwalter", [pfad("fonds")]),
  regel("GET", "/funds/:id/roles", "verwalter", [pfad("fonds")]),
  regel("PUT", "/funds/:id/roles/:userId", "verwalter", [pfad("fonds")]),
  regel("DELETE", "/funds/:id/roles/:userId", "verwalter", [pfad("fonds")]),
  // Kapitalabrufe und Ausschüttungen des Fonds (Etappe 12): lesen = betrachter; die Mitteilungen an die Investoren freigeben = freigeber (nur Menschen,
  // eine andere Person als die, die die Bewegung erfasst hat; der Handler prüft zusätzlich, dass die Bewegung zum Fonds gehört).
  regel("GET", "/funds/:id/movements/sources", "betrachter", [pfad("fonds")]),
  regel("GET", "/funds/:id/movements/notices/:noticeId/file", "betrachter", [pfad("fonds")]),
  regel("GET", "/funds/:id/movements/capital-position", "betrachter", [pfad("fonds")]),
  regel("GET", "/funds/:id/movements", "betrachter", [pfad("fonds")]),
  regel("POST", "/funds/:id/movements/:movementId/notices/approve", "freigeber", [pfad("fonds")], { nurMensch: true }),
  // Verwaltungsvergütung und Fondskosten (Issue #157): lesen = betrachter, buchen, Vorschau und Storno = bearbeiter. Kapitalkonten wie im LP-Bericht.
  regel("GET", "/funds/:id/fees-and-expenses", "betrachter", [pfad("fonds")]),
  regel("POST", "/funds/:id/fees-and-expenses/preview", "bearbeiter", [pfad("fonds")]),
  regel("POST", "/funds/:id/fees-and-expenses", "bearbeiter", [pfad("fonds")]),
  regel("POST", "/funds/:id/fees-and-expenses/:costEntryId/reverse", "bearbeiter", [pfad("fonds")]),
  regel("GET", "/funds/:id/capital-accounts", "betrachter", [pfad("fonds")]),

  // Beteiligungen -------------------------------------------------------------------------------------------------------
  regel("GET", "/investments/:id", "betrachter", [pfad("beteiligung")]),
  regel("GET", "/investments/:id/reports/quarterly-report", "betrachter", [pfad("beteiligung")]),
  regel("GET", "/investments/:id/instrument-data", "betrachter", [pfad("beteiligung")]),
  regel("GET", "/investments/:id/interest", "betrachter", [pfad("beteiligung")]), // Zinsansicht je Instrument (Portfolio-Modell)
  regel("GET", "/investments/:id/rounds", "betrachter", [pfad("beteiligung")]),
  // Gremienmandate (Issue #156): lesen = betrachter, pflegen = bearbeiter; der Handler prüft, dass das Mandat zur Beteiligung gehört.
  regel("GET", "/investments/:id/board-mandates", "betrachter", [pfad("beteiligung")]),
  regel("POST", "/investments/:id/board-mandates", "bearbeiter", [pfad("beteiligung")]),
  regel("PATCH", "/investments/:id/board-mandates/:mandateId", "bearbeiter", [pfad("beteiligung")]),
  regel("DELETE", "/investments/:id/board-mandates/:mandateId", "bearbeiter", [pfad("beteiligung")]),
  regel("GET", "/funds/:id/board-mandates", "betrachter", [pfad("fonds")]),
  // Exit-Wasserfall (Etappe 10): reine Berechnung ohne Schreibzugriff, daher auch das POST nur betrachter.
  regel("GET", "/investments/:id/cap-table", "betrachter", [pfad("beteiligung")]),
  regel("POST", "/investments/:id/waterfall", "betrachter", [pfad("beteiligung")]),
  regel("GET", "/investments/:id/waterfall/curve", "betrachter", [pfad("beteiligung")]),
  regel("POST", "/investments/:id/transactions", "bearbeiter", [pfad("beteiligung")]),
  regel("POST", "/investments/:id/terms", "bearbeiter", [pfad("beteiligung")]),
  regel("POST", "/investments/:id/milestones", "bearbeiter", [pfad("beteiligung")]),
  // Instrumente und Tranchen (Portfolio-Modell): lesen = betrachter, anlegen und ändern = bearbeiter, wie die übrigen Schreibwege der Beteiligung.
  regel("GET", "/investments/:id/instruments", "betrachter", [pfad("beteiligung")]),
  regel("POST", "/investments/:id/instruments", "bearbeiter", [pfad("beteiligung")]),
  regel("GET", "/instruments/:id", "betrachter", [pfad("instrument")]),
  regel("PATCH", "/instruments/:id", "bearbeiter", [pfad("instrument")]),
  regel("GET", "/instruments/:id/tranches", "betrachter", [pfad("instrument")]),
  regel("POST", "/instruments/:id/tranches", "bearbeiter", [pfad("instrument")]),
  regel("GET", "/instruments/:id/waivers", "betrachter", [pfad("instrument")]),
  regel("POST", "/instruments/:id/waivers", "bearbeiter", [pfad("instrument")]),
  regel("POST", "/instruments/:id/waivers/preview", "bearbeiter", [pfad("instrument")]),
  regel("POST", "/instruments/:id/waivers/:waiverId/reverse", "bearbeiter", [pfad("instrument")]),
  regel("POST", "/instruments/:id/exercises", "bearbeiter", [pfad("instrument")]),
  regel("POST", "/instruments/:id/exercises/:exerciseId/reverse", "bearbeiter", [pfad("instrument")]),
  regel("PATCH", "/tranches/:id", "bearbeiter", [pfad("meilenstein")]),
  regel("POST", "/tranches/:id/fulfill", "bearbeiter", [pfad("meilenstein")]),
  regel("PUT", "/investments/:id/net-income/:year", "bearbeiter", [pfad("beteiligung")]),
  regel("POST", "/investments/:id/conversion/preview", "bearbeiter", [pfad("beteiligung")]),
  regel("POST", "/investments/:id/conversion", "bearbeiter", [pfad("beteiligung")]),
  regel("POST", "/investments/:id/sale/preview", "bearbeiter", [pfad("beteiligung")]),
  regel("POST", "/investments/:id/sale", "bearbeiter", [pfad("beteiligung")]),
  regel("POST", "/sales/:id/reverse", "bearbeiter", [pfad("verkauf")]),
  // Bewertungen: Entwurf anlegen = bearbeiter, lesen = betrachter, freigeben und verwerfen = freigeber (nur Menschen).
  regel("POST", "/investments/:id/valuations", "bearbeiter", [pfad("beteiligung")]),
  regel("GET", "/investments/:id/valuations", "betrachter", [pfad("beteiligung")]),
  regel("GET", "/valuations/:id", "betrachter", [pfad("bewertung")]),
  regel("PATCH", "/valuations/:id", "bearbeiter", [pfad("bewertung")]),
  regel("POST", "/valuations/:id/approve", "freigeber", [pfad("bewertung")], { nurMensch: true }),
  regel("POST", "/valuations/:id/discard", "freigeber", [pfad("bewertung")], { nurMensch: true }),
  regel("GET", "/valuation-rounds/:id", "betrachter", [pfad("bewertungsrunde")]),
  regel("POST", "/valuation-rounds/:id/approve", "freigeber", [pfad("bewertungsrunde")], { nurMensch: true }),
  regel("POST", "/valuation-rounds/:id/discard", "freigeber", [pfad("bewertungsrunde")], { nurMensch: true }),
  regel("POST", "/investments/:id/purchase-price-adjustment", "bearbeiter", [pfad("beteiligung")]),
  regel("POST", "/investments/:id/insolvency", "bearbeiter", [pfad("beteiligung")]),
  regel("POST", "/transactions/:id/reverse", "bearbeiter", [pfad("vorgang")]),
  regel("PUT", "/transactions/:id/round", "bearbeiter", [pfad("vorgang")]),
  regel("POST", "/milestones/:id/fulfill", "bearbeiter", [pfad("meilenstein")]),
  regel("POST", "/receivables/:id/settle", "bearbeiter", [pfad("forderung")]),

  // Zinsläufe: berechnen = bearbeiter, prüfen, freigeben, verwerfen und buchen = freigeber (nur Menschen) -----------
  regel("GET", "/interest-runs", "betrachter", [abfrage("fundId")]),
  regel("GET", "/interest-runs/:id", "betrachter", [pfad("zinslauf")]),
  regel("GET", "/interest-runs/:id/checks", "betrachter", [pfad("zinslauf")]),
  regel("POST", "/interest-runs", "bearbeiter", [koerper("fundId")]),
  regel("POST", "/interest-runs/:id/review", "freigeber", [pfad("zinslauf")], { nurMensch: true }),
  regel("POST", "/interest-runs/:id/approve", "freigeber", [pfad("zinslauf")], { nurMensch: true }),
  regel("POST", "/interest-runs/:id/discard", "freigeber", [pfad("zinslauf")], { nurMensch: true }),
  regel("POST", "/interest-runs/:id/post", "freigeber", [pfad("zinslauf")], { nurMensch: true }),

  // Deals: ohne Fonds genügt die Rolle an irgendeinem Fonds ---------
  regel("GET", "/deals", "betrachter"), // Liste: Deals ohne Fonds und Deals der Fonds mit Rolle
  regel("GET", "/deals/:id", "betrachter", [pfad("deal")]),
  regel("GET", "/deals/:id/assignees", "betrachter", [pfad("deal")]),
  regel("PATCH", "/deals/:id/assignment", "bearbeiter", [pfad("deal")]),
  regel("POST", "/deals", "bearbeiter", [koerper("fundId")]),
  regel("PATCH", "/deals/:id", "bearbeiter", [pfad("deal"), koerper("fundId")]),
  regel("POST", "/deals/:id/stage", "bearbeiter", [pfad("deal")]),
  regel("POST", "/deals/:id/decline", "bearbeiter", [pfad("deal")]),
  regel("POST", "/deals/:id/reopen", "bearbeiter", [pfad("deal")]),
  // Ablehnen und Vertagen: bearbeiter. Ein zustimmender Beschluss (`ergebnis = zugestimmt`) braucht im Handler zusätzlich
  // die Rolle freigeber am Fonds des Deals und einen Menschen (Funktionstrennung, Entscheidung 86).
  regel("POST", "/deals/:id/resolutions", "bearbeiter", [pfad("deal")]),
  regel("POST", "/deals/:id/investment", "bearbeiter", [pfad("deal"), koerper("fundId")]),
  // Beschlussvorschlag aus einer Vorlage: Bearbeiter am Fonds des Deals; die Rolle an der Vorlage prüft der Handler.
  regel("POST", "/deals/:id/draft-resolution", "bearbeiter", [pfad("deal")]),
  regel("GET", "/dealflow/worklist", "betrachter"),
  regel("GET", "/dealflow/card-fields", "betrachter", [], { nurMensch: true }),
  regel("PUT", "/dealflow/card-fields", "betrachter", [], { nurMensch: true }),
  regel("GET", "/dealflow/funnel", "betrachter", [abfrage("fundId")]),
  regel("GET", "/dealflow/funnel/export", "betrachter", [abfrage("fundId")]),

  // Beschlussvorlagen je Fonds: lesen = betrachter, pflegen = verwalter des Fonds ---------------------------------------
  regel("GET", "/resolution-templates", "betrachter", [abfrage("fundId")]),
  regel("POST", "/resolution-templates", "verwalter", [koerper("fundId")]),
  regel("PATCH", "/resolution-templates/:id", "verwalter", [pfad("beschlussvorlage")]),
  regel("DELETE", "/resolution-templates/:id", "verwalter", [pfad("beschlussvorlage")]),

  // Kontakte: ohne Fonds, Rolle an irgendeinem Fonds ----------------------------------------------------------------
  regel("GET", "/organizations/duplicates", "betrachter"),
  regel("GET", "/organizations/values", "betrachter"),
  regel("GET", "/organizations", "betrachter"),
  regel("GET", "/organizations/:id", "betrachter"),
  regel("POST", "/organizations", "bearbeiter"),
  regel("PATCH", "/organizations/:id", "bearbeiter"),
  // Zusammenführen: Bearbeiter genügt für Kontakte; Organisationen mit Beteiligungen prüft der Handler zusätzlich auf Freigeber an jedem betroffenen Fonds.
  regel("POST", "/organizations/:id/merge/preview", "bearbeiter"),
  regel("POST", "/organizations/:id/merge", "bearbeiter"),
  // Handelsregister (Etappe 18): lesen wie die Organisation (Rolle an irgendeinem Fonds), übernehmen und erfassen = bearbeiter, Beobachtung = verwalter.
  regel("GET", "/organizations/:id/register", "betrachter"),
  regel("POST", "/organizations/:id/register/entries", "bearbeiter"),
  regel("POST", "/organizations/:id/register/events", "bearbeiter"),
  regel("POST", "/organizations/:id/register/events/:eventId/resolve", "bearbeiter"),
  regel("POST", "/organizations/:id/register/apply", "bearbeiter"),
  regel("POST", "/organizations/:id/register/fetch", "bearbeiter"),
  regel("PUT", "/organizations/:id/register/monitoring", "verwalter"),
  regel("GET", "/register/status", "betrachter"),
  regel("GET", "/register/search", "betrachter"),
  regel("POST", "/register/import", "bearbeiter"),
  regel("GET", "/register/notifications", "betrachter"),
  regel("POST", "/register/notifications/:id/mark-read", "betrachter"),
  regel("GET", "/investments/:id/register-notices", "betrachter", [pfad("beteiligung")]),
  // Szenarien und Reserven (Etappe 18): lesen = betrachter, anlegen und ändern = bearbeiter am Fonds, festschreiben = freigeber (nur Menschen).
  regel("GET", "/funds/:id/scenarios", "betrachter", [pfad("fonds")]),
  regel("POST", "/funds/:id/scenarios", "bearbeiter", [pfad("fonds")]),
  regel("GET", "/funds/:id/scenarios/template", "betrachter", [pfad("fonds")]),
  regel("GET", "/funds/:id/scenarios/comparison", "betrachter", [pfad("fonds")]),
  regel("GET", "/funds/:id/scenarios/report", "betrachter", [pfad("fonds")]),
  regel("GET", "/funds/:id/reserves", "betrachter", [pfad("fonds")]),
  regel("GET", "/scenarios/:id", "betrachter", [pfad("szenario")]),
  regel("PATCH", "/scenarios/:id", "bearbeiter", [pfad("szenario")]),
  regel("DELETE", "/scenarios/:id", "bearbeiter", [pfad("szenario")]),
  regel("POST", "/scenarios/:id/duplicate", "bearbeiter", [pfad("szenario")]),
  regel("POST", "/scenarios/:id/lock", "freigeber", [pfad("szenario")], { nurMensch: true }),
  regel("GET", "/scenarios/:id/report", "betrachter", [pfad("szenario")]),
  regel("GET", "/investments/:id/reserve", "betrachter", [pfad("beteiligung")]),
  regel("PUT", "/investments/:id/reserve", "bearbeiter", [pfad("beteiligung")]),
  // Anteilsklassen eines Unternehmens (Etappe 10): lesen = betrachter, anlegen und ändern = bearbeiter, jeweils an einem Fonds,
  // der eine Beteiligung an der Organisation hält. Die Klasse einer Runde setzt der Bearbeiter eines solchen Fonds.
  regel("GET", "/organizations/:id/share-classes", "betrachter", [pfad("organisationHalter")]),
  regel("POST", "/organizations/:id/share-classes", "bearbeiter", [pfad("organisationHalter")]),
  regel("PATCH", "/organizations/:id/share-classes/:classId", "bearbeiter", [pfad("organisationHalter")]),
  // Mitarbeiterbeteiligung eines Unternehmens (Pools, Änderungen, Zuteilungen): Pool sichtbar = Runden sichtbar (Entscheidung 486), Zuteilungen
  // im eigenen Bereich `einzelzuteilungen` (Entscheidung 522). Die Tabelle
  // verlangt die Mindestrolle irgendwo; die Handler prüfen wie bei den Runden (lesen: `verlangeRundenLeserecht`, schreiben: `verlangeRundenrecht` bearbeiter).
  regel("GET", "/organizations/:id/employee-pools", "betrachter"),
  regel("POST", "/organizations/:id/employee-pools", "bearbeiter"),
  regel("PATCH", "/organizations/:id/employee-pools/:poolId", "bearbeiter"),
  regel("POST", "/organizations/:id/employee-pools/:poolId/changes", "bearbeiter"),
  regel("PATCH", "/organizations/:id/employee-pools/:poolId/changes/:changeId", "bearbeiter"),
  regel("DELETE", "/organizations/:id/employee-pools/:poolId/changes/:changeId", "bearbeiter"),
  regel("POST", "/organizations/:id/employee-pools/:poolId/grants", "bearbeiter"),
  regel("PATCH", "/organizations/:id/employee-pools/:poolId/grants/:grantId", "bearbeiter"),
  regel("DELETE", "/organizations/:id/employee-pools/:poolId/grants/:grantId", "bearbeiter"),
  regel("POST", "/organizations/:id/employee-pools/:poolId/grants/:grantId/anonymize", "bearbeiter"),
  regel("POST", "/organizations/:id/employee-pools/:poolId/grants/:grantId/departures", "bearbeiter"),
  regel("PATCH", "/organizations/:id/employee-pools/:poolId/grants/:grantId/departures/:departureId", "bearbeiter"),
  regel("DELETE", "/organizations/:id/employee-pools/:poolId/grants/:grantId/departures/:departureId", "bearbeiter"),
  regel("PATCH", "/round-positions/:id", "bearbeiter", [pfad("rundenpositionHalter")]),
  // Finanzierungsrunden von Hand (Etappe 4b): Die Tabelle verlangt die Mindestrolle irgendwo, die Handler prüfen genauer (Rolle an einem Fonds,
  // der das Unternehmen hält oder in einer Runde eine Position hat, beim Anlegen auch an einem einsteigenden Fonds; Positionen eines Fonds
  // verlangen bearbeiter an diesem Fonds). Die Vorschau rechnet nur und schreibt nichts: betrachter.
  regel("GET", "/organizations/:id/financing-rounds", "betrachter"),
  regel("GET", "/organizations/:id/round-transactions", "betrachter"),
  // Anteilsübertragungen (Secondary): Mindestrolle irgendwo, die Handler prüfen wie bei den Runden und je eigenem Fonds.
  regel("GET", "/organizations/:id/share-transfers", "betrachter"),
  regel("POST", "/organizations/:id/share-transfers", "bearbeiter"),
  regel("POST", "/organizations/:id/share-transfers/:transferId/reverse", "bearbeiter"),
  regel("POST", "/organizations/:id/financing-rounds/preview", "betrachter"),
  regel("POST", "/organizations/:id/financing-rounds/pool-suggestion", "betrachter"),
  regel("POST", "/organizations/:id/financing-rounds", "bearbeiter"),
  // Vehikel der Co-Investoren: Kontaktdaten; die Positionen je Vehikel filtert der Handler wie die Rundenliste.
  regel("GET", "/organizations/:id/vehicles", "betrachter"),
  regel("POST", "/organizations/:id/vehicles", "bearbeiter"),
  regel("GET", "/vehicles", "betrachter"),
  regel("PATCH", "/vehicles/:id", "bearbeiter"),
  regel("DELETE", "/vehicles/:id", "bearbeiter"),
  regel("GET", "/financing-rounds/:id", "betrachter"),
  regel("PATCH", "/financing-rounds/:id", "bearbeiter"),
  regel("DELETE", "/financing-rounds/:id", "bearbeiter"),
  regel("POST", "/financing-rounds/:id/positions", "bearbeiter"),
  regel("PATCH", "/financing-rounds/:id/positions/:positionId", "bearbeiter"),
  regel("DELETE", "/financing-rounds/:id/positions/:positionId", "bearbeiter"),
  regel("POST", "/financing-rounds/:id/close", "bearbeiter"),
  regel("POST", "/financing-rounds/:id/reopen", "verwalter"),
  // Zahlungen der Co-Investoren auf ihre Position: informativ, Handler prüft Rolle an einem verwandten Fonds.
  regel("GET", "/round-positions/:id/payments", "betrachter"),
  regel("POST", "/round-positions/:id/payments", "bearbeiter"),
  regel("DELETE", "/round-positions/:id/payments/:paymentId", "bearbeiter"),
  regel("GET", "/people", "betrachter"),
  regel("GET", "/people/duplicates", "betrachter"),
  regel("GET", "/people/values", "betrachter"),
  regel("GET", "/people/:id", "betrachter"),
  regel("POST", "/people", "bearbeiter"),
  regel("PATCH", "/people/:id", "bearbeiter"),
  regel("POST", "/people/:id/merge/preview", "bearbeiter"),
  regel("POST", "/people/:id/merge", "bearbeiter"),
  regel("GET", "/contact-roles", "betrachter"),
  regel("POST", "/contact-roles", "bearbeiter"),
  regel("PATCH", "/contact-roles/:id", "bearbeiter"),
  regel("DELETE", "/contact-roles/:id", "bearbeiter"),
  regel("GET", "/organization-relationships", "betrachter"),
  regel("POST", "/organization-relationships", "bearbeiter", [koerper("fundId")]),
  regel("DELETE", "/organization-relationships/:id", "bearbeiter", [pfad("beziehung")]),
  regel("GET", "/contact-import/template", "betrachter"),
  regel("POST", "/contact-import/preview", "bearbeiter"),
  regel("POST", "/contact-import", "bearbeiter"),
  regel("GET", "/search", "betrachter"),
  // CRM (Etappe 20): Objekte, Felder, Ansichten, Listen, Aufgaben. Wo ein Deal im Spiel ist, prüft der Handler Sichtbarkeit und Schreibrecht je Datensatz
  // (die Pfade tragen das Objekt als Parameter oder Listen von IDs, die sich nicht auf einen Fonds auflösen lassen).
  regel("GET", "/crm/objects/:object/fields", "betrachter"),
  regel("POST", "/crm/objects/:object/query", "betrachter"),
  regel("POST", "/crm/objects/:object/board", "betrachter"),
  regel("POST", "/crm/objects/:object/groups", "betrachter"),
  regel("POST", "/crm/objects/:object/export", "betrachter"),
  regel("POST", "/crm/objects/:object/bulk-actions", "bearbeiter"),
  regel("GET", "/crm/records/:object/:id", "betrachter"),
  regel("PATCH", "/crm/records/:object/:id", "bearbeiter"),
  regel("GET", "/crm/records/:object/:id/links", "betrachter"),
  regel("GET", "/crm/records/:object/:id/card", "betrachter"),
  // Felddefinitionen: globale Verwalter; Felder einer Liste auch deren Besitzer (der Handler entscheidet).
  // Eigene Felder an Fonds, Runde, Instrument, Beteiligung und Vorgang (Etappe 21): Definitionen wie die Felder des CRM (global, nur globale Verwalter ändern sie);
  // Werte lesen = betrachter, setzen = bearbeiter am Fonds (Runden: der Handler prüft wie bei den übrigen Wegen der Runde). Vorgänge tragen ihre Werte ab dem Anlegen.
  regel("GET", "/custom-fields/:object/definitions", "betrachter"),
  regel("GET", "/custom-fields/:object/schema", "betrachter"),
  regel("GET", "/funds/:id/fields", "betrachter", [pfad("fonds")]),
  regel("PUT", "/funds/:id/fields", "bearbeiter", [pfad("fonds")]),
  regel("GET", "/investments/:id/fields", "betrachter", [pfad("beteiligung")]),
  regel("PUT", "/investments/:id/fields", "bearbeiter", [pfad("beteiligung")]),
  regel("GET", "/investments/:id/instrument-fields", "betrachter", [pfad("beteiligung")]),
  regel("PUT", "/investments/:id/instrument-fields", "bearbeiter", [pfad("beteiligung")]),
  regel("GET", "/financing-rounds/:id/fields", "betrachter"),
  regel("PUT", "/financing-rounds/:id/fields", "bearbeiter"),
  regel("GET", "/transactions/:id/fields", "betrachter", [pfad("vorgang")]),
  // Währungen (Etappe 21): Kurstabelle nur durch globale Verwalter (sie gilt für alle Fonds), Lesen mit einer Rolle; Währungssicht je Beteiligung und Fonds lesen = betrachter,
  // die lokale Währung einer Beteiligung setzen = bearbeiter am Fonds.
  regel("GET", "/exchange-rates", "betrachter"),
  regel("GET", "/exchange-rates/currencies", "betrachter"),
  global("POST", "/exchange-rates"),
  global("POST", "/exchange-rates/import"),
  regel("GET", "/investments/:id/currency-view", "betrachter", [pfad("beteiligung")]),
  regel("PUT", "/investments/:id/currency", "bearbeiter", [pfad("beteiligung")]),
  regel("GET", "/funds/:id/currency-view", "betrachter", [pfad("fonds")]),
  regel("POST", "/crm/fields", "bearbeiter"),
  regel("PATCH", "/crm/fields/:id", "bearbeiter"),
  regel("POST", "/crm/fields/:id/archive", "bearbeiter"),
  regel("POST", "/crm/fields/:id/restore", "bearbeiter"),
  // Ansichten sind privat (oder geteilt); jede Person mit einer Rolle darf eigene anlegen. Ändern: Besitzer und globale Verwalter.
  regel("GET", "/crm/views", "betrachter"),
  regel("POST", "/crm/views", "betrachter"),
  regel("PATCH", "/crm/views/:id", "betrachter"),
  regel("DELETE", "/crm/views/:id", "betrachter"),
  regel("GET", "/crm/lists", "betrachter"),
  regel("POST", "/crm/lists", "bearbeiter"),
  regel("GET", "/crm/lists/:id", "betrachter"),
  regel("PATCH", "/crm/lists/:id", "bearbeiter"),
  regel("POST", "/crm/lists/:id/archive", "bearbeiter"),
  regel("POST", "/crm/lists/:id/entries", "bearbeiter"),
  regel("POST", "/crm/lists/:id/entries/remove", "bearbeiter"),
  regel("PATCH", "/crm/lists/:id/entries/:recordId", "bearbeiter"),
  regel("GET", "/crm/assignees", "betrachter", [abfrage("dealId", "deal")]),
  regel("GET", "/crm/tasks", "betrachter"),
  regel("POST", "/crm/tasks", "bearbeiter"),
  regel("PATCH", "/crm/tasks/:id", "bearbeiter"),
  regel("POST", "/crm/tasks/:id/complete", "bearbeiter"),
  regel("POST", "/crm/tasks/:id/reopen", "bearbeiter"),
  regel("DELETE", "/crm/tasks/:id", "bearbeiter"),
  regel("GET", "/crm/employments", "betrachter"),
  regel("POST", "/crm/employments", "bearbeiter"),
  regel("PATCH", "/crm/employments/:id", "bearbeiter"),
  regel("DELETE", "/crm/employments/:id", "bearbeiter"),
  regel("GET", "/crm/deals/:id/contacts", "betrachter", [pfad("deal")]),
  regel("POST", "/crm/deals/:id/contacts", "bearbeiter", [pfad("deal")]),
  regel("DELETE", "/crm/deals/:id/contacts/:personId", "bearbeiter", [pfad("deal")]),
  regel("POST", "/crm/import/headers", "bearbeiter"),
  regel("POST", "/crm/import/preview", "bearbeiter"),
  regel("POST", "/crm/import", "bearbeiter"),

  regel("GET", "/activities", "betrachter", [abfrage("dealId", "deal")]),
  regel("POST", "/activities", "bearbeiter", [koerper("dealId", "deal")]),
  regel("POST", "/activities/:id/complete", "bearbeiter", [pfad("aktivitaet")]),
  regel("POST", "/activities/:id/reschedule", "bearbeiter", [pfad("aktivitaet")]),
  regel("GET", "/follow-ups", "betrachter"),
  regel("GET", "/follow-ups/count", "betrachter"),
  regel("GET", "/follow-ups/summary", "betrachter"),
  // Mail und Kalender (Etappe 17). Postfach-Anbindung und Einstellungen gelten nur für die angemeldete Person (die Handler filtern nach ihrer ID), nur Menschen.
  // Entfernen einer synchronisierten Aktivität: nur die Person, deren Abgleich sie angelegt hat (Handler); die Tabelle prüft die Sicht auf den Deal.
  regel("POST", "/activities/:id/remove-sync", "betrachter", [pfad("aktivitaet")], { nurMensch: true }),
  // Anhänge einer synchronisierten Mail nur auf ausdrücklichen Klick der Person, deren Postfach sie angelegt hat (Handler); Übernehmen verlangt Bearbeiter am Ziel.
  regel("GET", "/activities/:id/attachments", "betrachter", [pfad("aktivitaet")], { nurMensch: true }),
  regel("POST", "/activities/:id/attachments/:attachmentId/import", "bearbeiter", [pfad("aktivitaet")], { nurMensch: true }),
  regel("GET", "/meetings", "betrachter", [abfrage("dealId", "deal")]),
  regel("GET", "/settings", "betrachter", [], { nurMensch: true }),
  regel("PUT", "/settings", "betrachter", [], { nurMensch: true }),
  regel("GET", "/settings/calendar-link", "betrachter", [], { nurMensch: true }),
  regel("POST", "/settings/calendar-link", "betrachter", [], { nurMensch: true }),
  regel("DELETE", "/settings/calendar-link", "betrachter", [], { nurMensch: true }),
  regel("GET", "/mailbox", "betrachter", [], { nurMensch: true }),
  // Kontakte aus Postfach und Kalender: eigene Teilnahme und Sperrliste (nur die Person selbst).
  regel("GET", "/mailbox/contacts", "betrachter", [], { nurMensch: true }),
  regel("PUT", "/mailbox/contacts", "betrachter", [], { nurMensch: true }),
  regel("POST", "/mailbox/oauth/start", "betrachter", [], { nurMensch: true }),
  regel("GET", "/mailbox/callback", "betrachter", [], { nurMensch: true }),
  regel("POST", "/mailbox/imap", "betrachter", [], { nurMensch: true }),
  regel("PATCH", "/mailbox/:id", "betrachter", [], { nurMensch: true }),
  regel("POST", "/mailbox/:id/sync", "betrachter", [], { nurMensch: true }),
  regel("DELETE", "/mailbox/:id", "betrachter", [], { nurMensch: true }),
  // Einstellung der Installation für Kontakte aus Postfach und Kalender (Modus, eigene Domains, Sperrliste): Verwaltung, nur globale Verwalter.
  global("GET", "/contact-suggestions/settings"),
  global("PUT", "/contact-suggestions/settings"),
  // Vorschläge: Die Liste zeigt nur Vorschläge aus dem eigenen Postfach und Kalender (Handler). Übernehmen und Zusammenführen legen Kontakte an oder ändern sie,
  // darum Bearbeiter im Bereich Kontakte, auch für die Liste und das Verwerfen (wer nicht anlegen darf, hat mit der Liste nichts zu tun).
  regel("GET", "/contact-suggestions", "bearbeiter", [], { nurMensch: true }),
  regel("POST", "/contact-suggestions/:id/accept", "bearbeiter", [], { nurMensch: true }),
  regel("POST", "/contact-suggestions/:id/merge", "bearbeiter", [], { nurMensch: true }),
  regel("POST", "/contact-suggestions/:id/dismiss", "bearbeiter", [], { nurMensch: true }),
  // Mailversand verwalten (Etappe 17): nur globale Verwalter, nur Menschen. Status ohne Geheimnisse, Testmail an die eigene Adresse, Ausgangskorb ohne Inhalte.
  { methode: "GET", muster: "/mail/status", zugriff: "globalverwalter", nurMensch: true },
  { methode: "POST", muster: "/mail/test", zugriff: "globalverwalter", nurMensch: true },
  { methode: "GET", muster: "/mail/jobs", zugriff: "globalverwalter", nurMensch: true },

  // Import: Vorlage und Läufe. Hochladen und Prüfen = bearbeiter, Übernehmen = freigeber (nur Menschen, andere Person als
  // Hochladende und Prüfende). Die Handler prüfen zusätzlich die Rolle an jedem Fonds, den die Datei berührt (Entscheidung 120).
  global("GET", "/import/sources"),
  { ...global("PUT", "/import/sources/:source"), nurMensch: true },
  { ...global("POST", "/import/sources/:source/runs"), nurMensch: true },
  regel("GET", "/import/template", "bearbeiter"),
  regel("POST", "/import/runs", "bearbeiter"),
  regel("GET", "/import/runs", "betrachter"),
  regel("GET", "/import/runs/:id", "betrachter"),
  regel("GET", "/import/runs/:id/findings", "betrachter"),
  regel("GET", "/import/runs/:id/log", "betrachter"), // schreibt eine Zeile `gelesen` ins Protokoll
  regel("POST", "/import/runs/:id/validate", "bearbeiter"),
  regel("POST", "/import/runs/:id/apply", "freigeber", [], { nurMensch: true }),

  // Vollexport: alle Daten aller Fonds, deshalb nur globale Verwalter. Schreibt eine Zeile `gelesen` ins Protokoll.
  global("GET", "/export"),

  // Schreib-API: Änderungsabfrage (gefiltert nach den Fonds der Person) und Stapel. Der Stapel prüft Rechte je Operation über die
  // Routen, die er aufruft; hier genügt die Rolle bearbeiter an irgendeinem Fonds.
  regel("GET", "/changes", "betrachter"),
  regel("POST", "/batch", "bearbeiter"),
  // Webhooks und Live-Aktualisierung (#154, #161): gleiche Daten wie die Änderungsabfrage, deshalb Bereich `alle` wie dort. Endpunkte gehören dem
  // anlegenden Zugang (Person oder API-Schlüssel); die Handler beschränken auf eigene Endpunkte (globale Verwalter: alle, nur abschalten und löschen).
  regel("GET", "/webhooks", "betrachter", [], { bereich: "alle" }),
  regel("POST", "/webhooks", "betrachter", [], { bereich: "alle" }),
  regel("GET", "/webhooks/:id", "betrachter", [], { bereich: "alle" }),
  regel("PATCH", "/webhooks/:id", "betrachter", [], { bereich: "alle" }),
  regel("DELETE", "/webhooks/:id", "betrachter", [], { bereich: "alle" }),
  regel("POST", "/webhooks/:id/rotate-secret", "betrachter", [], { bereich: "alle" }),
  regel("POST", "/webhooks/:id/test", "betrachter", [], { bereich: "alle" }),
  regel("GET", "/webhooks/:id/deliveries", "betrachter", [], { bereich: "alle" }),
  regel("GET", "/live", "betrachter", [], { bereich: "alle" }),

  // Kennzahlen der Portfoliounternehmen: lesen = betrachter, Werte und Anfragen schreiben und bestätigen = bearbeiter (intern, nie über den Link),
  // Auswahl je Fonds = verwalter des Fonds; der Katalog gilt für alle Fonds und lässt sich nur durch globale Verwalter ändern.
  regel("GET", "/metrics/catalog", "betrachter"),
  global("POST", "/metrics/catalog"),
  global("POST", "/metrics/catalog/:metricKey/versions"),
  global("DELETE", "/metrics/catalog/:metricKey"),
  regel("PATCH", "/metrics/values/:id", "bearbeiter", [pfad("kennzahlwert")]),
  regel("POST", "/metrics/values/:id/confirm", "bearbeiter", [pfad("kennzahlwert")]),
  regel("POST", "/metrics/values/:id/discard", "bearbeiter", [pfad("kennzahlwert")]),
  regel("GET", "/metrics/metric-requests/:id", "betrachter", [pfad("kennzahlabfrage")]),
  regel("POST", "/metrics/metric-requests/:id/revoke", "bearbeiter", [pfad("kennzahlabfrage")]),
  regel("POST", "/metrics/metric-requests/:id/renew-link", "bearbeiter", [pfad("kennzahlabfrage")]),
  regel("POST", "/metrics/metric-requests/:id/send-email", "bearbeiter", [pfad("kennzahlabfrage")]), // Link per Mail (Etappe 17), neuer Link wie `neuer-link`
  regel("POST", "/metrics/metric-requests/:id/confirm", "bearbeiter", [pfad("kennzahlabfrage")]),
  regel("GET", "/investments/:id/metrics", "betrachter", [pfad("beteiligung")]),
  regel("POST", "/investments/:id/metrics/provider-values", "bearbeiter", [pfad("beteiligung")], { nurMensch: true }),
  regel("POST", "/investments/:id/metrics/values", "bearbeiter", [pfad("beteiligung")]),
  regel("GET", "/investments/:id/metrics/metric-requests", "betrachter", [pfad("beteiligung")]),
  regel("POST", "/investments/:id/metrics/metric-requests", "bearbeiter", [pfad("beteiligung")]),
  regel("GET", "/funds/:id/metrics/selection", "betrachter", [pfad("fonds")]),
  regel("PUT", "/funds/:id/metrics/selection", "verwalter", [pfad("fonds")]),
  regel("GET", "/funds/:id/metrics/metric-requests", "betrachter", [pfad("fonds")]),
  regel("GET", "/funds/:id/metrics/overview", "betrachter", [pfad("fonds")]),
  // Dokumente (Etappe 13): Die Tabelle prüft die Grundrolle, die Handler prüfen die Ziele des Dokuments. Lesen sieht ein Dokument, wer mindestens
  // ein verknüpftes Ziel sehen darf (sonst 404); hochladen, ändern, ersetzen und verknüpfen braucht Bearbeiter an jedem Ziel, löschen Verwalter.
  regel("GET", "/documents", "betrachter"),
  regel("GET", "/documents/search", "betrachter"),
  global("GET", "/documents/retention"), // gelöschte Dokumente mit Ablaufdatum der Datei, nur Verwaltung
  regel("POST", "/documents", "bearbeiter"),
  regel("GET", "/documents/:id", "betrachter"),
  regel("PATCH", "/documents/:id", "bearbeiter"),
  regel("DELETE", "/documents/:id", "verwalter"),
  regel("GET", "/documents/:id/file", "betrachter"), // schreibt eine Zeile `gelesen` ins Protokoll
  regel("GET", "/documents/:id/pages/:page", "betrachter"),
  regel("POST", "/documents/:id/replace", "bearbeiter"),
  regel("POST", "/documents/:id/ocr", "bearbeiter"), // fordert die lokale Texterkennung an (nur mit OCR=lokal), die der Worker ausführt
  regel("POST", "/documents/:id/links", "bearbeiter"),
  regel("DELETE", "/documents/:id/links/:type/:targetId", "bearbeiter"),

  // Belegvorlagen und Buchhaltung (Etappe 14). Stammdaten (Konfiguration, Mittelarten, Konten, Gliederung, Kontenregeln, Belegvorlagen,
  // Kontenzuordnung des Exports) lesen = betrachter, ändern = verwalter des Fonds; Schlüssel der Beteiligung ändern = bearbeiter.
  regel("GET", "/funds/:id/accounting", "betrachter", [pfad("fonds")]),
  regel("PUT", "/funds/:id/accounting", "verwalter", [pfad("fonds")]),
  regel("GET", "/funds/:id/funding-sources", "betrachter", [pfad("fonds")]),
  regel("PUT", "/funds/:id/funding-sources", "verwalter", [pfad("fonds")]),
  regel("GET", "/funds/:id/accounts", "betrachter", [pfad("fonds")]),
  regel("PUT", "/funds/:id/accounts", "verwalter", [pfad("fonds")]),
  regel("DELETE", "/funds/:id/accounts/:accountNumber", "verwalter", [pfad("fonds")]),
  regel("GET", "/funds/:id/layout", "betrachter", [pfad("fonds")]),
  regel("POST", "/funds/:id/layout/standard", "verwalter", [pfad("fonds")]),
  regel("PUT", "/funds/:id/layout/:view", "verwalter", [pfad("fonds")]),
  regel("GET", "/funds/:id/account-rules", "betrachter", [pfad("fonds")]),
  regel("POST", "/funds/:id/account-rules", "verwalter", [pfad("fonds")]),
  regel("POST", "/account-rules/:id/end", "verwalter", [pfad("kontenregel")]),
  regel("GET", "/funds/:id/voucher-templates", "betrachter", [pfad("fonds")]),
  regel("PUT", "/funds/:id/voucher-templates/:type", "verwalter", [pfad("fonds")]),
  // Eigene Belegarten (Issue #52): Name und Basis-Art anlegen, ändern, löschen = verwalter, wie die Vorlagen.
  regel("POST", "/funds/:id/voucher-types", "verwalter", [pfad("fonds")]),
  regel("PUT", "/funds/:id/voucher-types/:typeId", "verwalter", [pfad("fonds")]),
  regel("DELETE", "/funds/:id/voucher-types/:typeId", "verwalter", [pfad("fonds")]),
  regel("GET", "/funds/:id/posting-rules", "betrachter", [pfad("fonds")]),
  regel("PUT", "/funds/:id/posting-rules/:source", "verwalter", [pfad("fonds")]),
  regel("GET", "/investments/:id/accounting-keys", "betrachter", [pfad("beteiligung")]),
  regel("PUT", "/investments/:id/accounting-keys", "bearbeiter", [pfad("beteiligung")]),
  // Belege: erzeugen und neu befüllen = bearbeiter (beim Erzeugen prüft der Handler die Rolle am Fonds des Vorfalls), Stufen = freigeber (nur Menschen).
  regel("POST", "/vouchers", "bearbeiter"),
  regel("GET", "/vouchers", "betrachter", [abfrage("fundId")]),
  regel("GET", "/vouchers/:id", "betrachter", [pfad("beleg")]),
  regel("PATCH", "/vouchers/:id/field-values", "bearbeiter", [pfad("beleg")]),
  regel("POST", "/vouchers/:id/refill", "bearbeiter", [pfad("beleg")]),
  regel("GET", "/vouchers/:id/file", "betrachter", [pfad("beleg")]), // schreibt eine Zeile `gelesen` ins Protokoll
  regel("POST", "/vouchers/:id/stage", "freigeber", [pfad("beleg")], { nurMensch: true }),
  regel("POST", "/vouchers/:id/reverse", "freigeber", [pfad("beleg")], { nurMensch: true }),
  // Saldenlisten: hochladen und prüfen = bearbeiter, übernehmen = freigeber (nur Menschen, andere Person); Auswertungen lesen = betrachter, exportieren = bearbeiter.
  regel("POST", "/funds/:id/balance-runs", "bearbeiter", [pfad("fonds")]),
  regel("GET", "/funds/:id/balance-runs", "betrachter", [pfad("fonds")]),
  regel("GET", "/funds/:id/periods", "betrachter", [pfad("fonds")]),
  regel("GET", "/funds/:id/evaluation/:view", "betrachter", [pfad("fonds")]),
  regel("GET", "/funds/:id/evaluation/:view/file", "bearbeiter", [pfad("fonds")]), // schreibt eine Zeile `gelesen` ins Protokoll
  regel("GET", "/funds/:id/reconciliation", "betrachter", [pfad("fonds")]),
  regel("GET", "/balance-runs/:id", "betrachter", [pfad("saldenlauf")]),
  regel("GET", "/balance-runs/:id/balances", "betrachter", [pfad("saldenlauf")]),
  regel("POST", "/balance-runs/:id/validate", "bearbeiter", [pfad("saldenlauf")]),
  regel("POST", "/balance-runs/:id/apply", "freigeber", [pfad("saldenlauf")], { nurMensch: true }),
  // Buchungsexport (DATEV): Vorschau und Export = bearbeiter, Abruf der Datei = bearbeiter mit Zeile `gelesen`.
  regel("POST", "/funds/:id/posting-exports/preview", "bearbeiter", [pfad("fonds")]),
  regel("POST", "/funds/:id/posting-exports", "bearbeiter", [pfad("fonds")]),
  regel("GET", "/funds/:id/posting-exports", "betrachter", [pfad("fonds")]),
  regel("GET", "/posting-exports/:id/file", "bearbeiter", [pfad("buchungsexport")]),

  // Berichte ohne Fonds -----------------------------------------------------------------------------------------------
  regel("GET", "/reports/committee-pack", "betrachter"),

  // Berichte mit Freigabe in Stufen: anlegen und Abschnitte bearbeiten = bearbeiter, lesen und Datei = betrachter,
  // jede Stufe (auch die Rückgabe) = freigeber (nur Menschen). Die Liste ohne `fondsId` zeigt nur sichtbare Fonds.
  global("POST", "/reports/backfill-variants"), // Fassungen je Investor für früher freigegebene LP-Berichte, nur Verwaltung
  regel("POST", "/reports", "bearbeiter", [koerper("fundId"), koerper("investmentId", "beteiligung")]),
  regel("GET", "/reports", "betrachter", [abfrage("fundId")]),
  regel("GET", "/reports/:id", "betrachter", [pfad("bericht")]),
  regel("GET", "/reports/:id/file", "betrachter", [pfad("bericht")]), // schreibt eine Zeile `gelesen` ins Protokoll
  regel("GET", "/reports/:id/checks", "betrachter", [pfad("bericht")]),
  regel("PUT", "/reports/:id/sections/:key", "bearbeiter", [pfad("bericht")]),
  regel("POST", "/reports/:id/correction", "bearbeiter", [pfad("bericht")]),
  regel("POST", "/reports/:id/stage", "freigeber", [pfad("bericht")], { nurMensch: true }),

  // Förder- und Meldeberichte (Etappe 15). Definitionen und Förderprogramme: lesen = betrachter, schreiben = globale Verwalter. Aktivierung je Fonds = verwalter,
  // Förder- und Buchhaltungsschlüssel der Beteiligung stehen unter `/investments/:id/accounting-keys` (bearbeiter), Sitzland und Region unter `/organizations/:id/reporting-data`. Läufe: anlegen, Eingaben und Kommentare = bearbeiter, jede Stufe = freigeber (nur Menschen), lesen und Dateien = betrachter.
  regel("GET", "/reporting-definitions", "betrachter"),
  global("POST", "/reporting-definitions"),
  global("POST", "/reporting-definitions/validate"),
  regel("GET", "/reporting-definitions/:key", "betrachter"),
  global("POST", "/reporting-definitions/:key/versions"),
  regel("GET", "/reporting-definitions/:key/versions/:version", "betrachter"),
  regel("GET", "/funding-programs", "betrachter"),
  global("POST", "/funding-programs"),
  regel("GET", "/funds/:id/reporting-definitions", "betrachter", [pfad("fonds")]),
  regel("PUT", "/funds/:id/reporting-definitions/:key", "verwalter", [pfad("fonds")]),
  regel("GET", "/funds/:id/reporting-assignments", "betrachter", [pfad("fonds")]),
  regel("GET", "/organizations/:id/reporting-data", "betrachter", [pfad("organisationHalter")]),
  regel("PUT", "/organizations/:id/reporting-data", "bearbeiter", [pfad("organisationHalter")]),
  regel("POST", "/reporting-runs", "bearbeiter", [koerper("fundId")]),
  regel("GET", "/reporting-runs", "betrachter", [abfrage("fundId")]),
  regel("GET", "/reporting-runs/:id", "betrachter", [pfad("meldelauf")]),
  regel("GET", "/reporting-runs/:id/provenance", "betrachter", [pfad("meldelauf")]),
  regel("GET", "/reporting-runs/:id/findings", "betrachter", [pfad("meldelauf")]),
  regel("GET", "/reporting-runs/:id/file", "betrachter", [pfad("meldelauf")]), // schreibt eine Zeile `gelesen` ins Protokoll
  regel("PUT", "/reporting-runs/:id/inputs", "bearbeiter", [pfad("meldelauf")]),
  regel("PUT", "/reporting-runs/:id/findings/:ruleId/comment", "bearbeiter", [pfad("meldelauf")]),
  regel("POST", "/reporting-runs/:id/stage", "freigeber", [pfad("meldelauf")], { nurMensch: true }),
];

/** Bereiche, deren Daten keinen Fonds brauchen (oder nach sichtbaren Fonds filtern): dort zählt auch die Stufe einer Gruppe ohne Fonds. */
const OHNE_FONDS: ReadonlySet<RegelBereich> = new Set<RegelBereich>(["kontakte", "dealflow", "allgemein"]);

/** Regel mit Fondsrolle samt Bereich (aus der Zeile oder nach Pfadmuster aus `bereiche.ts`). */
function mitBereich(r: Regel): Regel {
  if (r.zugriff !== "rolle") return r;
  const bereich = r.bereich ?? bereichVon(r.methode, r.muster);
  if (!bereich) return r;
  return { ...r, bereich, ...(OHNE_FONDS.has(bereich) ? { ohneFondsErlaubt: true } : {}) };
}

/** Die Regeln des Kerns; Regeln mit Fondsrolle tragen ihren Bereich (aus der Zeile oder nach Pfadmuster). */
export const REGELN: Regel[] = ROH.map(mitBereich);

const sonderzeichen = /[.+?^${}()|[\]\\]/g;

function alsRegex(muster: string): RegExp {
  const teile = muster.split("/").map((teil) => {
    if (teil === "*") return ".*";
    if (teil.startsWith(":")) return "[^/]+";
    return teil.replace(sonderzeichen, "\\$&");
  });
  return new RegExp(`^${teile.join("/")}/?$`);
}

/** Die Regeln einer Anwendung: die des Kerns plus die der angemeldeten Erweiterungen. */
export interface Regelwerk {
  regeln: readonly Regel[];
  /** Die Regel zu Methode und Pfad (ohne `/api/v1`); bei Treffern mehrerer Muster gewinnt das genauere (ohne Platzhalter zuerst). */
  finde(methode: string, pfad: string): Regel | undefined;
}

/** Regelwerk aus den Regeln des Kerns und `zusatz` (Regeln der Erweiterungen; ohne Bereich in der Zeile gilt die Zuordnung nach Pfadmuster). */
export function erstelleRegelwerk(zusatz: readonly Regel[] = []): Regelwerk {
  const regeln = [...REGELN, ...zusatz.map(mitBereich)];
  const uebersetzt = regeln.map((r) => ({ regel: r, regex: alsRegex(r.muster) }));
  return {
    regeln,
    finde(methode, pfad) {
      const treffer = uebersetzt.filter((u) => u.regel.methode === methode && u.regex.test(pfad));
      treffer.sort((a, b) => (a.regel.muster.match(/[:*]/g)?.length ?? 0) - (b.regel.muster.match(/[:*]/g)?.length ?? 0));
      return treffer[0]?.regel;
    },
  };
}

const KERN = erstelleRegelwerk();

/** Die Regel des Kerns zu Methode und Pfad, siehe `Regelwerk.finde`. */
export function findeRegel(methode: string, pfad: string): Regel | undefined {
  return KERN.finde(methode, pfad);
}
