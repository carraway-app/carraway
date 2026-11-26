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
   * Umgekehrt lehnt die Prüfung Investor-Benutzer an jeder anderen Regel außer `oeffentlich` und `angemeldet` ab (403 `NUR_PORTAL`).
   */
  zugriff: "oeffentlich" | "angemeldet" | "rolle" | "globalverwalter" | "investor";
  rolle?: FondsRolle;
  ziele?: Ziel[];
  /** Freigaben brauchen Menschen: technische Benutzer (API-Schlüssel) bekommen 403 `TECHNISCHER_BENUTZER`. */
  nurMensch?: boolean;
  /**
   * Bereich der Anwendung (nur bei `rolle`): Personen in Nutzergruppen brauchen ihn zusätzlich zur Fondsrolle, siehe `bereiche.ts` und
   * docs/rechte-modell.md. Ohne Angabe in der Zeile gilt die Zuordnung nach Pfadmuster aus `bereiche.ts`.
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
  offen("GET", "/gesundheit"),
  offen("GET", "/umgebung"),
  offen("GET", "/auth/*"),
  offen("POST", "/auth/*"),
  offen("POST", "/einrichtung"), // nur solange es noch keine Person gibt
  offen("POST", "/passwort/vergessen"), // Passwort zurücksetzen per Mail: gleiche Antwort für jede Adresse, begrenzt je IP und Adresse
  offen("GET", "/openapi.json"),
  offen("GET", "/docs"),
  // Link ohne Konto: das Token in der Adresse ist der Zugang, genau zu einer Anfrage. Begrenzung, Prüfung und Protokoll in `routen/extern.ts`.
  offen("GET", "/extern/abfragen/:token"),
  offen("PUT", "/extern/abfragen/:token"),
  offen("POST", "/extern/abfragen/:token/einreichen"),
  // Kalenderabonnement (ICS) einer Person (Etappe 17): Das Token vor `.ics` ist der Zugang, nur als Hash gespeichert und widerrufbar. Begrenzung, Prüfung und Antwort in `routen/kalender.ts`.
  offen("GET", "/kalender/:datei"),

  { methode: "GET", muster: "/ich", zugriff: "angemeldet" },
  // Thema der Oberfläche: nur der eigene Wert, auch für Investor-Benutzer des Portals; ein API-Schlüssel bekommt im Handler 403.
  { methode: "GET", muster: "/thema", zugriff: "angemeldet" },
  { methode: "PATCH", muster: "/thema", zugriff: "angemeldet" },

  // Eigene Sicherheit (Passwort, Sitzungen, zweiter Faktor): nur die eigene Person, nur mit Sitzung (die Handler lehnen API-Schlüssel ab).
  // „angemeldet“, damit auch ein Startpasswort oder ein fehlender zweiter Faktor hier behoben werden kann.
  { methode: "GET", muster: "/konto/sicherheit", zugriff: "angemeldet" },
  { methode: "POST", muster: "/konto/passwort", zugriff: "angemeldet" },
  { methode: "GET", muster: "/konto/sitzungen", zugriff: "angemeldet" },
  { methode: "POST", muster: "/konto/sitzungen/andere-beenden", zugriff: "angemeldet" },
  { methode: "DELETE", muster: "/konto/sitzungen/:id", zugriff: "angemeldet" },
  { methode: "POST", muster: "/konto/zwei-faktor/neu", zugriff: "angemeldet" },
  { methode: "POST", muster: "/konto/zwei-faktor/neu/bestaetigen", zugriff: "angemeldet" },
  { methode: "POST", muster: "/konto/wiederherstellungscodes", zugriff: "angemeldet" },

  // Benutzer und API-Schlüssel: globale Verwalter ---------------------------------------------------------------------
  global("GET", "/benutzer"),
  global("POST", "/benutzer"),
  global("PATCH", "/benutzer/:id"),
  global("POST", "/benutzer/:id/einladung"),
  // Rollen, Nutzergruppen und Fondszugriff (Rechtemodell, docs/rechte-modell.md): nur globale Verwalter. Wirksame Rechte einer Person zur Kontrolle.
  global("GET", "/benutzer/:id/rechte"),
  global("GET", "/rechte"),
  global("PUT", "/rechte/einstellung"),
  global("POST", "/rechte/rollen"),
  global("PATCH", "/rechte/rollen/:id"),
  global("DELETE", "/rechte/rollen/:id"),
  global("POST", "/rechte/gruppen"),
  global("PATCH", "/rechte/gruppen/:id"),
  global("DELETE", "/rechte/gruppen/:id"),
  // Anzeigenamen: jede Person mit einer Rolle; die Handler-Logik begrenzt auf Personen, die einen Fonds teilen.
  regel("GET", "/benutzer/namen", "betrachter"),
  // Betriebsstatus (Verwaltung → Betrieb): Migrationsstand, Worker, Rückstände, Ablage, SMTP, Angaben der Erweiterungen.
  global("GET", "/betrieb/status"),
  global("GET", "/api-schluessel"),
  global("POST", "/api-schluessel"),
  global("DELETE", "/api-schluessel/:id"),

  // Zeichnungen, Closings und Zusageänderungen der Investoren eines Fonds (Etappe 12): ansehen = verwalter des Fonds, ändern = globale Verwalter.
  // Zugänge zum LP-Portal (Investor-Benutzer) bringt die Erweiterung LP-Portal mit (`ee/`).
  regel("GET", "/fonds/:fondsId/investorenzugaenge", "verwalter", [pfad("fonds", "fondsId")], { nurMensch: true }),
  global("POST", "/fonds/:fondsId/investorenzugaenge/zeichnungen"),
  global("POST", "/fonds/:fondsId/investorenzugaenge/closings"),
  global("POST", "/fonds/:fondsId/investorenzugaenge/zusageaenderungen"),
  global("POST", "/fonds/:fondsId/investorenzugaenge/closings/:closingId/storno"),
  global("POST", "/fonds/:fondsId/investorenzugaenge/closings/:closingId/korrektur"),

  // Fonds ---------------------------------------------------------------------------------------------------------------
  regel("GET", "/fonds", "betrachter"), // Liste: nur Fonds mit Rolle
  global("POST", "/fonds"),
  regel("GET", "/fonds/:id", "betrachter", [pfad("fonds")]),
  regel("PATCH", "/fonds/:id", "verwalter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/nav-einzelwerte", "betrachter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/uebersicht", "betrachter", [pfad("fonds")]),
  regel("POST", "/fonds/:id/neuberechnen", "bearbeiter", [pfad("fonds")]),
  // Einheitliche Erfassung (Etappe 4b): alle von Hand buchbaren Arten. Bei Vorgängen prüft die Regel auch die Rolle am Fonds der Beteiligung
  // im Körper, der Handler lehnt eine Beteiligung eines anderen Fonds ab. Storno einer Fondsbewegung wie Storno eines Vorgangs.
  regel("POST", "/fonds/:id/buchungen", "bearbeiter", [pfad("fonds"), koerper("beteiligungId", "beteiligung")]),
  regel("GET", "/fonds/:id/fondsbewegungen/vorschau", "bearbeiter", [pfad("fonds")]),
  // Journal: lesen = betrachter; eine Beteiligung im Filter muss zu einem Fonds gehören, den die Person sehen darf. Export schreibt eine Zeile `gelesen`.
  regel("GET", "/fonds/:id/journal", "betrachter", [pfad("fonds"), abfrage("beteiligungId", "beteiligung")]),
  // Wie die Kapitalkonten: interne Betrachter des jeweiligen Fonds. Investor-Benutzer bleiben auf das LP-Portal beschränkt.
  regel("GET", "/fondsbewegungen/:id", "betrachter", [pfad("fondsbewegung")]),
  regel("GET", "/fondsbewegungen/:id/zahlungen", "betrachter", [pfad("fondsbewegung")]),
  regel("POST", "/fondsbewegungen/:id/zahlungen", "bearbeiter", [pfad("fondsbewegung")]),
  regel("POST", "/fondsbewegungen/:id/zahlungen/storno", "bearbeiter", [pfad("fondsbewegung")]),
  regel("POST", "/fondsbewegungen/:id/storno", "bearbeiter", [pfad("fondsbewegung")]),
  regel("GET", "/fonds/:id/abgrenzung", "betrachter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/zinsen", "betrachter", [pfad("fonds")]), // Zinsansicht je Instrument (Portfolio-Modell)
  regel("GET", "/fonds/:id/berichte/fondsbericht", "betrachter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/berichte/portfolioliste", "betrachter", [pfad("fonds")]),
  // Bewertungsrunden: anlegen = bearbeiter, lesen = betrachter (freigeben und verwerfen unter `/bewertungsrunden/:id`).
  regel("POST", "/fonds/:id/bewertungsrunde", "bearbeiter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/bewertungsrunden", "betrachter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/bewertungen", "betrachter", [pfad("fonds")]),
  // Vorlagen und Freigabestufen je Fonds: lesen = betrachter, ändern = verwalter des Fonds.
  regel("GET", "/fonds/:id/berichtsvorlagen", "betrachter", [pfad("fonds")]),
  regel("PUT", "/fonds/:id/berichtsvorlagen/:art", "verwalter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/freigabestufen", "betrachter", [pfad("fonds")]),
  regel("PUT", "/fonds/:id/freigabestufen", "verwalter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/periodensperre", "verwalter", [pfad("fonds")]),
  regel("PUT", "/fonds/:id/periodensperre", "verwalter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/rollen", "verwalter", [pfad("fonds")]),
  regel("PUT", "/fonds/:id/rollen/:benutzerId", "verwalter", [pfad("fonds")]),
  regel("DELETE", "/fonds/:id/rollen/:benutzerId", "verwalter", [pfad("fonds")]),
  // Kapitalabrufe und Ausschüttungen des Fonds (Etappe 12): lesen = betrachter; die Mitteilungen an die Investoren freigeben = freigeber (nur Menschen,
  // eine andere Person als die, die die Bewegung erfasst hat; der Handler prüft zusätzlich, dass die Bewegung zum Fonds gehört).
  regel("GET", "/fonds/:id/bewegungen/herkunft", "betrachter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/bewegungen/mitteilungen/:mitteilungId/datei", "betrachter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/bewegungen/kapitalstand", "betrachter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/bewegungen", "betrachter", [pfad("fonds")]),
  regel("POST", "/fonds/:id/bewegungen/:bewegungId/mitteilungen/freigeben", "freigeber", [pfad("fonds")], { nurMensch: true }),

  // Beteiligungen -------------------------------------------------------------------------------------------------------
  regel("GET", "/beteiligungen/:id", "betrachter", [pfad("beteiligung")]),
  regel("GET", "/beteiligungen/:id/berichte/quartalsbericht", "betrachter", [pfad("beteiligung")]),
  regel("GET", "/beteiligungen/:id/instrumentdaten", "betrachter", [pfad("beteiligung")]),
  regel("GET", "/beteiligungen/:id/zinsen", "betrachter", [pfad("beteiligung")]), // Zinsansicht je Instrument (Portfolio-Modell)
  regel("GET", "/beteiligungen/:id/runden", "betrachter", [pfad("beteiligung")]),
  // Exit-Wasserfall (Etappe 10): reine Berechnung ohne Schreibzugriff, daher auch das POST nur betrachter.
  regel("GET", "/beteiligungen/:id/kapitaltabelle", "betrachter", [pfad("beteiligung")]),
  regel("POST", "/beteiligungen/:id/wasserfall", "betrachter", [pfad("beteiligung")]),
  regel("GET", "/beteiligungen/:id/wasserfall/kurve", "betrachter", [pfad("beteiligung")]),
  regel("POST", "/beteiligungen/:id/vorgaenge", "bearbeiter", [pfad("beteiligung")]),
  regel("POST", "/beteiligungen/:id/konditionen", "bearbeiter", [pfad("beteiligung")]),
  regel("POST", "/beteiligungen/:id/meilensteine", "bearbeiter", [pfad("beteiligung")]),
  // Instrumente und Tranchen (Portfolio-Modell): lesen = betrachter, anlegen und ändern = bearbeiter, wie die übrigen Schreibwege der Beteiligung.
  regel("GET", "/beteiligungen/:id/instrumente", "betrachter", [pfad("beteiligung")]),
  regel("POST", "/beteiligungen/:id/instrumente", "bearbeiter", [pfad("beteiligung")]),
  regel("GET", "/instrumente/:id", "betrachter", [pfad("instrument")]),
  regel("PATCH", "/instrumente/:id", "bearbeiter", [pfad("instrument")]),
  regel("GET", "/instrumente/:id/tranchen", "betrachter", [pfad("instrument")]),
  regel("POST", "/instrumente/:id/tranchen", "bearbeiter", [pfad("instrument")]),
  regel("PATCH", "/tranchen/:id", "bearbeiter", [pfad("meilenstein")]),
  regel("POST", "/tranchen/:id/erfuellt", "bearbeiter", [pfad("meilenstein")]),
  regel("PUT", "/beteiligungen/:id/jahresueberschuss/:jahr", "bearbeiter", [pfad("beteiligung")]),
  regel("POST", "/beteiligungen/:id/wandlung/vorschau", "bearbeiter", [pfad("beteiligung")]),
  regel("POST", "/beteiligungen/:id/wandlung", "bearbeiter", [pfad("beteiligung")]),
  regel("POST", "/beteiligungen/:id/verkauf/vorschau", "bearbeiter", [pfad("beteiligung")]),
  regel("POST", "/beteiligungen/:id/verkauf", "bearbeiter", [pfad("beteiligung")]),
  regel("POST", "/verkaeufe/:id/storno", "bearbeiter", [pfad("verkauf")]),
  // Bewertungen: Entwurf anlegen = bearbeiter, lesen = betrachter, freigeben und verwerfen = freigeber (nur Menschen).
  regel("POST", "/beteiligungen/:id/bewertungen", "bearbeiter", [pfad("beteiligung")]),
  regel("GET", "/beteiligungen/:id/bewertungen", "betrachter", [pfad("beteiligung")]),
  regel("GET", "/bewertungen/:id", "betrachter", [pfad("bewertung")]),
  regel("PATCH", "/bewertungen/:id", "bearbeiter", [pfad("bewertung")]),
  regel("POST", "/bewertungen/:id/freigeben", "freigeber", [pfad("bewertung")], { nurMensch: true }),
  regel("POST", "/bewertungen/:id/verwerfen", "freigeber", [pfad("bewertung")], { nurMensch: true }),
  regel("GET", "/bewertungsrunden/:id", "betrachter", [pfad("bewertungsrunde")]),
  regel("POST", "/bewertungsrunden/:id/freigeben", "freigeber", [pfad("bewertungsrunde")], { nurMensch: true }),
  regel("POST", "/bewertungsrunden/:id/verwerfen", "freigeber", [pfad("bewertungsrunde")], { nurMensch: true }),
  regel("POST", "/beteiligungen/:id/kaufpreisanpassung", "bearbeiter", [pfad("beteiligung")]),
  regel("POST", "/beteiligungen/:id/insolvenz", "bearbeiter", [pfad("beteiligung")]),
  regel("POST", "/vorgaenge/:id/storno", "bearbeiter", [pfad("vorgang")]),
  regel("PUT", "/vorgaenge/:id/runde", "bearbeiter", [pfad("vorgang")]),
  regel("POST", "/meilensteine/:id/erfuellt", "bearbeiter", [pfad("meilenstein")]),
  regel("POST", "/forderungen/:id/erfuellt", "bearbeiter", [pfad("forderung")]),

  // Zinsläufe: berechnen = bearbeiter, prüfen, freigeben, verwerfen und buchen = freigeber (nur Menschen) -----------
  regel("GET", "/zinslaeufe", "betrachter", [abfrage("fondsId")]),
  regel("GET", "/zinslaeufe/:id", "betrachter", [pfad("zinslauf")]),
  regel("GET", "/zinslaeufe/:id/kontrolle", "betrachter", [pfad("zinslauf")]),
  regel("POST", "/zinslaeufe", "bearbeiter", [koerper("fondsId")]),
  regel("POST", "/zinslaeufe/:id/pruefen", "freigeber", [pfad("zinslauf")], { nurMensch: true }),
  regel("POST", "/zinslaeufe/:id/freigeben", "freigeber", [pfad("zinslauf")], { nurMensch: true }),
  regel("POST", "/zinslaeufe/:id/verwerfen", "freigeber", [pfad("zinslauf")], { nurMensch: true }),
  regel("POST", "/zinslaeufe/:id/buchen", "freigeber", [pfad("zinslauf")], { nurMensch: true }),

  // Deals: ohne Fonds genügt die Rolle an irgendeinem Fonds ---------
  regel("GET", "/deals", "betrachter"), // Liste: Deals ohne Fonds und Deals der Fonds mit Rolle
  regel("GET", "/deals/:id", "betrachter", [pfad("deal")]),
  regel("GET", "/deals/:id/zustaendige", "betrachter", [pfad("deal")]),
  regel("PATCH", "/deals/:id/zuordnung", "bearbeiter", [pfad("deal")]),
  regel("POST", "/deals", "bearbeiter", [koerper("fondsId")]),
  regel("PATCH", "/deals/:id", "bearbeiter", [pfad("deal"), koerper("fondsId")]),
  regel("POST", "/deals/:id/phase", "bearbeiter", [pfad("deal")]),
  regel("POST", "/deals/:id/absage", "bearbeiter", [pfad("deal")]),
  regel("POST", "/deals/:id/wiederaufnahme", "bearbeiter", [pfad("deal")]),
  // Ablehnen und Vertagen: bearbeiter. Ein zustimmender Beschluss (`ergebnis = zugestimmt`) braucht im Handler zusätzlich
  // die Rolle freigeber am Fonds des Deals und einen Menschen (Funktionstrennung, Entscheidung 86).
  regel("POST", "/deals/:id/beschluesse", "bearbeiter", [pfad("deal")]),
  regel("POST", "/deals/:id/beteiligung", "bearbeiter", [pfad("deal"), koerper("fondsId")]),
  // Beschlussvorschlag aus einer Vorlage: Bearbeiter am Fonds des Deals; die Rolle an der Vorlage prüft der Handler.
  regel("POST", "/deals/:id/beschlussvorschlag", "bearbeiter", [pfad("deal")]),
  regel("GET", "/dealflow/arbeitsliste", "betrachter"),
  regel("GET", "/dealflow/kartenfelder", "betrachter", [], { nurMensch: true }),
  regel("PUT", "/dealflow/kartenfelder", "betrachter", [], { nurMensch: true }),
  regel("GET", "/dealflow/trichter", "betrachter", [abfrage("fondsId")]),
  regel("GET", "/dealflow/trichter/export", "betrachter", [abfrage("fondsId")]),

  // Beschlussvorlagen je Fonds: lesen = betrachter, pflegen = verwalter des Fonds ---------------------------------------
  regel("GET", "/beschlussvorlagen", "betrachter", [abfrage("fondsId")]),
  regel("POST", "/beschlussvorlagen", "verwalter", [koerper("fondsId")]),
  regel("PATCH", "/beschlussvorlagen/:id", "verwalter", [pfad("beschlussvorlage")]),
  regel("DELETE", "/beschlussvorlagen/:id", "verwalter", [pfad("beschlussvorlage")]),

  // Kontakte: ohne Fonds, Rolle an irgendeinem Fonds ----------------------------------------------------------------
  regel("GET", "/organisationen/dubletten", "betrachter"),
  regel("GET", "/organisationen", "betrachter"),
  regel("GET", "/organisationen/:id", "betrachter"),
  regel("POST", "/organisationen", "bearbeiter"),
  regel("PATCH", "/organisationen/:id", "bearbeiter"),
  // Zusammenführen: Bearbeiter genügt für Kontakte; Organisationen mit Beteiligungen prüft der Handler zusätzlich auf Freigeber an jedem betroffenen Fonds.
  regel("POST", "/organisationen/:id/zusammenfuehren/vorschau", "bearbeiter"),
  regel("POST", "/organisationen/:id/zusammenfuehren", "bearbeiter"),
  // Handelsregister (Etappe 18): lesen wie die Organisation (Rolle an irgendeinem Fonds), übernehmen und erfassen = bearbeiter, Beobachtung = verwalter.
  regel("GET", "/organisationen/:id/register", "betrachter"),
  regel("POST", "/organisationen/:id/register/eintraege", "bearbeiter"),
  regel("POST", "/organisationen/:id/register/ereignisse", "bearbeiter"),
  regel("POST", "/organisationen/:id/register/ereignisse/:ereignisId/erledigen", "bearbeiter"),
  regel("POST", "/organisationen/:id/register/uebernehmen", "bearbeiter"),
  regel("POST", "/organisationen/:id/register/abruf", "bearbeiter"),
  regel("PUT", "/organisationen/:id/register/beobachtung", "verwalter"),
  regel("GET", "/register/status", "betrachter"),
  regel("GET", "/register/suche", "betrachter"),
  regel("POST", "/register/import", "bearbeiter"),
  regel("GET", "/register/meldungen", "betrachter"),
  regel("POST", "/register/meldungen/:id/gelesen", "betrachter"),
  regel("GET", "/beteiligungen/:id/register-hinweise", "betrachter", [pfad("beteiligung")]),
  // Szenarien und Reserven (Etappe 18): lesen = betrachter, anlegen und ändern = bearbeiter am Fonds, festschreiben = freigeber (nur Menschen).
  regel("GET", "/fonds/:id/szenarien", "betrachter", [pfad("fonds")]),
  regel("POST", "/fonds/:id/szenarien", "bearbeiter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/szenarien/vorlage", "betrachter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/szenarien/vergleich", "betrachter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/szenarien/bericht", "betrachter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/reserven", "betrachter", [pfad("fonds")]),
  regel("GET", "/szenarien/:id", "betrachter", [pfad("szenario")]),
  regel("PATCH", "/szenarien/:id", "bearbeiter", [pfad("szenario")]),
  regel("DELETE", "/szenarien/:id", "bearbeiter", [pfad("szenario")]),
  regel("POST", "/szenarien/:id/duplizieren", "bearbeiter", [pfad("szenario")]),
  regel("POST", "/szenarien/:id/festschreiben", "freigeber", [pfad("szenario")], { nurMensch: true }),
  regel("GET", "/szenarien/:id/bericht", "betrachter", [pfad("szenario")]),
  regel("GET", "/beteiligungen/:id/reserve", "betrachter", [pfad("beteiligung")]),
  regel("PUT", "/beteiligungen/:id/reserve", "bearbeiter", [pfad("beteiligung")]),
  // Anteilsklassen eines Unternehmens (Etappe 10): lesen = betrachter, anlegen und ändern = bearbeiter, jeweils an einem Fonds,
  // der eine Beteiligung an der Organisation hält. Die Klasse einer Runde setzt der Bearbeiter eines solchen Fonds.
  regel("GET", "/organisationen/:id/anteilsklassen", "betrachter", [pfad("organisationHalter")]),
  regel("POST", "/organisationen/:id/anteilsklassen", "bearbeiter", [pfad("organisationHalter")]),
  regel("PATCH", "/organisationen/:id/anteilsklassen/:klasseId", "bearbeiter", [pfad("organisationHalter")]),
  // Mitarbeiterbeteiligung eines Unternehmens (Pools, Änderungen, Zuteilungen): Pool sichtbar = Runden sichtbar (Entscheidung 486). Die Tabelle
  // verlangt die Mindestrolle irgendwo; die Handler prüfen wie bei den Runden (lesen: `verlangeRundenLeserecht`, schreiben: `verlangeRundenrecht` bearbeiter).
  regel("GET", "/organisationen/:id/mitarbeiterpools", "betrachter"),
  regel("POST", "/organisationen/:id/mitarbeiterpools", "bearbeiter"),
  regel("PATCH", "/organisationen/:id/mitarbeiterpools/:poolId", "bearbeiter"),
  regel("POST", "/organisationen/:id/mitarbeiterpools/:poolId/aenderungen", "bearbeiter"),
  regel("PATCH", "/organisationen/:id/mitarbeiterpools/:poolId/aenderungen/:aenderungId", "bearbeiter"),
  regel("DELETE", "/organisationen/:id/mitarbeiterpools/:poolId/aenderungen/:aenderungId", "bearbeiter"),
  regel("POST", "/organisationen/:id/mitarbeiterpools/:poolId/zuteilungen", "bearbeiter"),
  regel("PATCH", "/organisationen/:id/mitarbeiterpools/:poolId/zuteilungen/:zuteilungId", "bearbeiter"),
  regel("POST", "/organisationen/:id/mitarbeiterpools/:poolId/zuteilungen/:zuteilungId/austritte", "bearbeiter"),
  regel("PATCH", "/organisationen/:id/mitarbeiterpools/:poolId/zuteilungen/:zuteilungId/austritte/:austrittId", "bearbeiter"),
  regel("DELETE", "/organisationen/:id/mitarbeiterpools/:poolId/zuteilungen/:zuteilungId/austritte/:austrittId", "bearbeiter"),
  regel("PATCH", "/rundenpositionen/:id", "bearbeiter", [pfad("rundenpositionHalter")]),
  // Finanzierungsrunden von Hand (Etappe 4b): Die Tabelle verlangt die Mindestrolle irgendwo, die Handler prüfen genauer (Rolle an einem Fonds,
  // der das Unternehmen hält oder in einer Runde eine Position hat, beim Anlegen auch an einem einsteigenden Fonds; Positionen eines Fonds
  // verlangen bearbeiter an diesem Fonds). Die Vorschau rechnet nur und schreibt nichts: betrachter.
  regel("GET", "/organisationen/:id/finanzierungsrunden", "betrachter"),
  regel("GET", "/organisationen/:id/rundentransaktionen", "betrachter"),
  regel("POST", "/organisationen/:id/finanzierungsrunden/vorschau", "betrachter"),
  regel("POST", "/organisationen/:id/finanzierungsrunden/pool-vorschlag", "betrachter"),
  regel("POST", "/organisationen/:id/finanzierungsrunden", "bearbeiter"),
  // Vehikel der Co-Investoren: Kontaktdaten; die Positionen je Vehikel filtert der Handler wie die Rundenliste.
  regel("GET", "/organisationen/:id/vehikel", "betrachter"),
  regel("POST", "/organisationen/:id/vehikel", "bearbeiter"),
  regel("GET", "/vehikel", "betrachter"),
  regel("PATCH", "/vehikel/:id", "bearbeiter"),
  regel("DELETE", "/vehikel/:id", "bearbeiter"),
  regel("GET", "/finanzierungsrunden/:id", "betrachter"),
  regel("PATCH", "/finanzierungsrunden/:id", "bearbeiter"),
  regel("DELETE", "/finanzierungsrunden/:id", "bearbeiter"),
  regel("POST", "/finanzierungsrunden/:id/positionen", "bearbeiter"),
  regel("PATCH", "/finanzierungsrunden/:id/positionen/:positionId", "bearbeiter"),
  regel("DELETE", "/finanzierungsrunden/:id/positionen/:positionId", "bearbeiter"),
  regel("POST", "/finanzierungsrunden/:id/abschliessen", "bearbeiter"),
  regel("POST", "/finanzierungsrunden/:id/wiedereroeffnen", "verwalter"),
  // Zahlungen der Co-Investoren auf ihre Position: informativ, Handler prüft Rolle an einem verwandten Fonds.
  regel("GET", "/rundenpositionen/:id/zahlungen", "betrachter"),
  regel("POST", "/rundenpositionen/:id/zahlungen", "bearbeiter"),
  regel("DELETE", "/rundenpositionen/:id/zahlungen/:zahlungId", "bearbeiter"),
  regel("GET", "/personen", "betrachter"),
  regel("GET", "/personen/dubletten", "betrachter"),
  regel("GET", "/personen/:id", "betrachter"),
  regel("POST", "/personen", "bearbeiter"),
  regel("PATCH", "/personen/:id", "bearbeiter"),
  regel("POST", "/personen/:id/zusammenfuehren/vorschau", "bearbeiter"),
  regel("POST", "/personen/:id/zusammenfuehren", "bearbeiter"),
  regel("GET", "/kontaktrollen", "betrachter"),
  regel("POST", "/kontaktrollen", "bearbeiter"),
  regel("PATCH", "/kontaktrollen/:id", "bearbeiter"),
  regel("DELETE", "/kontaktrollen/:id", "bearbeiter"),
  regel("GET", "/organisationsbeziehungen", "betrachter"),
  regel("POST", "/organisationsbeziehungen", "bearbeiter", [koerper("fondsId")]),
  regel("DELETE", "/organisationsbeziehungen/:id", "bearbeiter", [pfad("beziehung")]),
  regel("GET", "/kontaktimport/vorlage", "betrachter"),
  regel("POST", "/kontaktimport/vorschau", "bearbeiter"),
  regel("POST", "/kontaktimport", "bearbeiter"),
  regel("GET", "/suche", "betrachter"),
  // CRM (Etappe 20): Objekte, Felder, Ansichten, Listen, Aufgaben. Wo ein Deal im Spiel ist, prüft der Handler Sichtbarkeit und Schreibrecht je Datensatz
  // (die Pfade tragen das Objekt als Parameter oder Listen von IDs, die sich nicht auf einen Fonds auflösen lassen).
  regel("GET", "/crm/objekte/:objekt/felder", "betrachter"),
  regel("POST", "/crm/objekte/:objekt/abfrage", "betrachter"),
  regel("POST", "/crm/objekte/:objekt/board", "betrachter"),
  regel("POST", "/crm/objekte/:objekt/gruppen", "betrachter"),
  regel("POST", "/crm/objekte/:objekt/export", "betrachter"),
  regel("POST", "/crm/objekte/:objekt/massenaktion", "bearbeiter"),
  regel("GET", "/crm/datensaetze/:objekt/:id", "betrachter"),
  regel("PATCH", "/crm/datensaetze/:objekt/:id", "bearbeiter"),
  regel("GET", "/crm/datensaetze/:objekt/:id/verknuepfungen", "betrachter"),
  regel("GET", "/crm/datensaetze/:objekt/:id/karte", "betrachter"),
  // Felddefinitionen: globale Verwalter; Felder einer Liste auch deren Besitzer (der Handler entscheidet).
  // Eigene Felder an Fonds, Runde, Instrument, Beteiligung und Vorgang (Etappe 21): Definitionen wie die Felder des CRM (global, nur globale Verwalter ändern sie);
  // Werte lesen = betrachter, setzen = bearbeiter am Fonds (Runden: der Handler prüft wie bei den übrigen Wegen der Runde). Vorgänge tragen ihre Werte ab dem Anlegen.
  regel("GET", "/zusatzfelder/:objekt/definitionen", "betrachter"),
  regel("GET", "/zusatzfelder/:objekt/schema", "betrachter"),
  regel("GET", "/fonds/:id/felder", "betrachter", [pfad("fonds")]),
  regel("PUT", "/fonds/:id/felder", "bearbeiter", [pfad("fonds")]),
  regel("GET", "/beteiligungen/:id/felder", "betrachter", [pfad("beteiligung")]),
  regel("PUT", "/beteiligungen/:id/felder", "bearbeiter", [pfad("beteiligung")]),
  regel("GET", "/beteiligungen/:id/instrumentfelder", "betrachter", [pfad("beteiligung")]),
  regel("PUT", "/beteiligungen/:id/instrumentfelder", "bearbeiter", [pfad("beteiligung")]),
  regel("GET", "/finanzierungsrunden/:id/felder", "betrachter"),
  regel("PUT", "/finanzierungsrunden/:id/felder", "bearbeiter"),
  regel("GET", "/vorgaenge/:id/felder", "betrachter", [pfad("vorgang")]),
  // Währungen (Etappe 21): Kurstabelle nur durch globale Verwalter (sie gilt für alle Fonds), Lesen mit einer Rolle; Währungssicht je Beteiligung und Fonds lesen = betrachter,
  // die lokale Währung einer Beteiligung setzen = bearbeiter am Fonds.
  regel("GET", "/wechselkurse", "betrachter"),
  regel("GET", "/wechselkurse/waehrungen", "betrachter"),
  global("POST", "/wechselkurse"),
  global("POST", "/wechselkurse/import"),
  regel("GET", "/beteiligungen/:id/waehrungssicht", "betrachter", [pfad("beteiligung")]),
  regel("PUT", "/beteiligungen/:id/waehrung", "bearbeiter", [pfad("beteiligung")]),
  regel("GET", "/fonds/:id/waehrungssicht", "betrachter", [pfad("fonds")]),
  regel("POST", "/crm/felder", "bearbeiter"),
  regel("PATCH", "/crm/felder/:id", "bearbeiter"),
  regel("POST", "/crm/felder/:id/archivieren", "bearbeiter"),
  regel("POST", "/crm/felder/:id/wiederherstellen", "bearbeiter"),
  // Ansichten sind privat (oder geteilt); jede Person mit einer Rolle darf eigene anlegen. Ändern: Besitzer und globale Verwalter.
  regel("GET", "/crm/ansichten", "betrachter"),
  regel("POST", "/crm/ansichten", "betrachter"),
  regel("PATCH", "/crm/ansichten/:id", "betrachter"),
  regel("DELETE", "/crm/ansichten/:id", "betrachter"),
  regel("GET", "/crm/listen", "betrachter"),
  regel("POST", "/crm/listen", "bearbeiter"),
  regel("GET", "/crm/listen/:id", "betrachter"),
  regel("PATCH", "/crm/listen/:id", "bearbeiter"),
  regel("POST", "/crm/listen/:id/archivieren", "bearbeiter"),
  regel("POST", "/crm/listen/:id/eintraege", "bearbeiter"),
  regel("POST", "/crm/listen/:id/eintraege/entfernen", "bearbeiter"),
  regel("PATCH", "/crm/listen/:id/eintraege/:datensatzId", "bearbeiter"),
  regel("GET", "/crm/zustaendige", "betrachter", [abfrage("dealId", "deal")]),
  regel("GET", "/crm/aufgaben", "betrachter"),
  regel("POST", "/crm/aufgaben", "bearbeiter"),
  regel("PATCH", "/crm/aufgaben/:id", "bearbeiter"),
  regel("POST", "/crm/aufgaben/:id/erledigt", "bearbeiter"),
  regel("POST", "/crm/aufgaben/:id/wieder-oeffnen", "bearbeiter"),
  regel("DELETE", "/crm/aufgaben/:id", "bearbeiter"),
  regel("GET", "/crm/beschaeftigungen", "betrachter"),
  regel("POST", "/crm/beschaeftigungen", "bearbeiter"),
  regel("PATCH", "/crm/beschaeftigungen/:id", "bearbeiter"),
  regel("DELETE", "/crm/beschaeftigungen/:id", "bearbeiter"),
  regel("GET", "/crm/deals/:id/kontakte", "betrachter", [pfad("deal")]),
  regel("POST", "/crm/deals/:id/kontakte", "bearbeiter", [pfad("deal")]),
  regel("DELETE", "/crm/deals/:id/kontakte/:personId", "bearbeiter", [pfad("deal")]),
  regel("POST", "/crm/import/kopfzeile", "bearbeiter"),
  regel("POST", "/crm/import/vorschau", "bearbeiter"),
  regel("POST", "/crm/import", "bearbeiter"),

  regel("GET", "/aktivitaeten", "betrachter", [abfrage("dealId", "deal")]),
  regel("POST", "/aktivitaeten", "bearbeiter", [koerper("dealId", "deal")]),
  regel("POST", "/aktivitaeten/:id/erledigt", "bearbeiter", [pfad("aktivitaet")]),
  regel("POST", "/aktivitaeten/:id/zurueckstellen", "bearbeiter", [pfad("aktivitaet")]),
  regel("GET", "/wiedervorlagen", "betrachter"),
  regel("GET", "/wiedervorlagen/anzahl", "betrachter"),
  regel("GET", "/wiedervorlagen/zusammenfassung", "betrachter"),
  // Mail und Kalender (Etappe 17). Postfach-Anbindung und Einstellungen gelten nur für die angemeldete Person (die Handler filtern nach ihrer ID), nur Menschen.
  // Entfernen einer synchronisierten Aktivität: nur die Person, deren Abgleich sie angelegt hat (Handler); die Tabelle prüft die Sicht auf den Deal.
  regel("POST", "/aktivitaeten/:id/sync-entfernen", "betrachter", [pfad("aktivitaet")], { nurMensch: true }),
  // Anhänge einer synchronisierten Mail nur auf ausdrücklichen Klick der Person, deren Postfach sie angelegt hat (Handler); Übernehmen verlangt Bearbeiter am Ziel.
  regel("GET", "/aktivitaeten/:id/anhaenge", "betrachter", [pfad("aktivitaet")], { nurMensch: true }),
  regel("POST", "/aktivitaeten/:id/anhaenge/:anhangId/importieren", "bearbeiter", [pfad("aktivitaet")], { nurMensch: true }),
  regel("GET", "/termine", "betrachter", [abfrage("dealId", "deal")]),
  regel("GET", "/einstellungen", "betrachter", [], { nurMensch: true }),
  regel("PUT", "/einstellungen", "betrachter", [], { nurMensch: true }),
  regel("GET", "/einstellungen/kalender-link", "betrachter", [], { nurMensch: true }),
  regel("POST", "/einstellungen/kalender-link", "betrachter", [], { nurMensch: true }),
  regel("DELETE", "/einstellungen/kalender-link", "betrachter", [], { nurMensch: true }),
  regel("GET", "/postfach", "betrachter", [], { nurMensch: true }),
  regel("POST", "/postfach/oauth/start", "betrachter", [], { nurMensch: true }),
  regel("GET", "/postfach/rueckruf", "betrachter", [], { nurMensch: true }),
  regel("POST", "/postfach/imap", "betrachter", [], { nurMensch: true }),
  regel("PATCH", "/postfach/:id", "betrachter", [], { nurMensch: true }),
  regel("POST", "/postfach/:id/abgleichen", "betrachter", [], { nurMensch: true }),
  regel("DELETE", "/postfach/:id", "betrachter", [], { nurMensch: true }),
  // Mailversand verwalten (Etappe 17): nur globale Verwalter, nur Menschen. Status ohne Geheimnisse, Testmail an die eigene Adresse, Ausgangskorb ohne Inhalte.
  { methode: "GET", muster: "/mail/status", zugriff: "globalverwalter", nurMensch: true },
  { methode: "POST", muster: "/mail/test", zugriff: "globalverwalter", nurMensch: true },
  { methode: "GET", muster: "/mail/auftraege", zugriff: "globalverwalter", nurMensch: true },

  // Import: Vorlage und Läufe. Hochladen und Prüfen = bearbeiter, Übernehmen = freigeber (nur Menschen, andere Person als
  // Hochladende und Prüfende). Die Handler prüfen zusätzlich die Rolle an jedem Fonds, den die Datei berührt (Entscheidung 120).
  regel("GET", "/import/vorlage", "bearbeiter"),
  regel("POST", "/import/laeufe", "bearbeiter"),
  regel("GET", "/import/laeufe", "betrachter"),
  regel("GET", "/import/laeufe/:id", "betrachter"),
  regel("GET", "/import/laeufe/:id/befunde", "betrachter"),
  regel("GET", "/import/laeufe/:id/protokoll", "betrachter"), // schreibt eine Zeile `gelesen` ins Protokoll
  regel("POST", "/import/laeufe/:id/pruefen", "bearbeiter"),
  regel("POST", "/import/laeufe/:id/uebernehmen", "freigeber", [], { nurMensch: true }),

  // Vollexport: alle Daten aller Fonds, deshalb nur globale Verwalter. Schreibt eine Zeile `gelesen` ins Protokoll.
  global("GET", "/export"),

  // Schreib-API: Änderungsabfrage (gefiltert nach den Fonds der Person) und Stapel. Der Stapel prüft Rechte je Operation über die
  // Routen, die er aufruft; hier genügt die Rolle bearbeiter an irgendeinem Fonds.
  regel("GET", "/aenderungen", "betrachter"),
  regel("POST", "/stapel", "bearbeiter"),

  // Kennzahlen der Portfoliounternehmen: lesen = betrachter, Werte und Anfragen schreiben und bestätigen = bearbeiter (intern, nie über den Link),
  // Auswahl je Fonds = verwalter des Fonds; der Katalog gilt für alle Fonds und lässt sich nur durch globale Verwalter ändern.
  regel("GET", "/kennzahlen/katalog", "betrachter"),
  global("POST", "/kennzahlen/katalog"),
  global("POST", "/kennzahlen/katalog/:schluessel/versionen"),
  global("DELETE", "/kennzahlen/katalog/:schluessel"),
  regel("PATCH", "/kennzahlen/werte/:id", "bearbeiter", [pfad("kennzahlwert")]),
  regel("POST", "/kennzahlen/werte/:id/bestaetigen", "bearbeiter", [pfad("kennzahlwert")]),
  regel("POST", "/kennzahlen/werte/:id/verwerfen", "bearbeiter", [pfad("kennzahlwert")]),
  regel("GET", "/kennzahlen/abfragen/:id", "betrachter", [pfad("kennzahlabfrage")]),
  regel("POST", "/kennzahlen/abfragen/:id/widerrufen", "bearbeiter", [pfad("kennzahlabfrage")]),
  regel("POST", "/kennzahlen/abfragen/:id/neuer-link", "bearbeiter", [pfad("kennzahlabfrage")]),
  regel("POST", "/kennzahlen/abfragen/:id/per-mail", "bearbeiter", [pfad("kennzahlabfrage")]), // Link per Mail (Etappe 17), neuer Link wie `neuer-link`
  regel("POST", "/kennzahlen/abfragen/:id/bestaetigen", "bearbeiter", [pfad("kennzahlabfrage")]),
  regel("GET", "/beteiligungen/:id/kennzahlen", "betrachter", [pfad("beteiligung")]),
  regel("POST", "/beteiligungen/:id/kennzahlen/werte", "bearbeiter", [pfad("beteiligung")]),
  regel("GET", "/beteiligungen/:id/kennzahlen/abfragen", "betrachter", [pfad("beteiligung")]),
  regel("POST", "/beteiligungen/:id/kennzahlen/abfragen", "bearbeiter", [pfad("beteiligung")]),
  regel("GET", "/fonds/:id/kennzahlen/auswahl", "betrachter", [pfad("fonds")]),
  regel("PUT", "/fonds/:id/kennzahlen/auswahl", "verwalter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/kennzahlen/abfragen", "betrachter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/kennzahlen/uebersicht", "betrachter", [pfad("fonds")]),
  // Dokumente (Etappe 13): Die Tabelle prüft die Grundrolle, die Handler prüfen die Ziele des Dokuments. Lesen sieht ein Dokument, wer mindestens
  // ein verknüpftes Ziel sehen darf (sonst 404); hochladen, ändern, ersetzen und verknüpfen braucht Bearbeiter an jedem Ziel, löschen Verwalter.
  regel("GET", "/dokumente", "betrachter"),
  regel("GET", "/dokumente/suche", "betrachter"),
  global("GET", "/dokumente/aufbewahrung"), // gelöschte Dokumente mit Ablaufdatum der Datei, nur Verwaltung
  regel("POST", "/dokumente", "bearbeiter"),
  regel("GET", "/dokumente/:id", "betrachter"),
  regel("PATCH", "/dokumente/:id", "bearbeiter"),
  regel("DELETE", "/dokumente/:id", "verwalter"),
  regel("GET", "/dokumente/:id/datei", "betrachter"), // schreibt eine Zeile `gelesen` ins Protokoll
  regel("GET", "/dokumente/:id/seiten/:seite", "betrachter"),
  regel("POST", "/dokumente/:id/ersetzen", "bearbeiter"),
  regel("POST", "/dokumente/:id/texterkennung", "bearbeiter"), // fordert die lokale Texterkennung an (nur mit OCR=lokal), die der Worker ausführt
  regel("POST", "/dokumente/:id/verknuepfungen", "bearbeiter"),
  regel("DELETE", "/dokumente/:id/verknuepfungen/:typ/:zielId", "bearbeiter"),

  // Belegvorlagen und Buchhaltung (Etappe 14). Stammdaten (Konfiguration, Mittelarten, Konten, Gliederung, Kontenregeln, Belegvorlagen,
  // Kontenzuordnung des Exports) lesen = betrachter, ändern = verwalter des Fonds; Schlüssel der Beteiligung ändern = bearbeiter.
  regel("GET", "/fonds/:id/buchhaltung", "betrachter", [pfad("fonds")]),
  regel("PUT", "/fonds/:id/buchhaltung", "verwalter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/mittelarten", "betrachter", [pfad("fonds")]),
  regel("PUT", "/fonds/:id/mittelarten", "verwalter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/konten", "betrachter", [pfad("fonds")]),
  regel("PUT", "/fonds/:id/konten", "verwalter", [pfad("fonds")]),
  regel("DELETE", "/fonds/:id/konten/:nummer", "verwalter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/gliederung", "betrachter", [pfad("fonds")]),
  regel("POST", "/fonds/:id/gliederung/standard", "verwalter", [pfad("fonds")]),
  regel("PUT", "/fonds/:id/gliederung/:sicht", "verwalter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/kontenregeln", "betrachter", [pfad("fonds")]),
  regel("POST", "/fonds/:id/kontenregeln", "verwalter", [pfad("fonds")]),
  regel("POST", "/kontenregeln/:id/beenden", "verwalter", [pfad("kontenregel")]),
  regel("GET", "/fonds/:id/belegvorlagen", "betrachter", [pfad("fonds")]),
  regel("PUT", "/fonds/:id/belegvorlagen/:art", "verwalter", [pfad("fonds")]),
  // Eigene Belegarten (Issue #52): Name und Basis-Art anlegen, ändern, löschen = verwalter, wie die Vorlagen.
  regel("POST", "/fonds/:id/belegarten", "verwalter", [pfad("fonds")]),
  regel("PUT", "/fonds/:id/belegarten/:artId", "verwalter", [pfad("fonds")]),
  regel("DELETE", "/fonds/:id/belegarten/:artId", "verwalter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/buchungsregeln", "betrachter", [pfad("fonds")]),
  regel("PUT", "/fonds/:id/buchungsregeln/:quelle", "verwalter", [pfad("fonds")]),
  regel("GET", "/beteiligungen/:id/buchhaltungsschluessel", "betrachter", [pfad("beteiligung")]),
  regel("PUT", "/beteiligungen/:id/buchhaltungsschluessel", "bearbeiter", [pfad("beteiligung")]),
  // Belege: erzeugen und neu befüllen = bearbeiter (beim Erzeugen prüft der Handler die Rolle am Fonds des Vorfalls), Stufen = freigeber (nur Menschen).
  regel("POST", "/belege", "bearbeiter"),
  regel("GET", "/belege", "betrachter", [abfrage("fondsId")]),
  regel("GET", "/belege/:id", "betrachter", [pfad("beleg")]),
  regel("PATCH", "/belege/:id/feldwerte", "bearbeiter", [pfad("beleg")]),
  regel("POST", "/belege/:id/neu-befuellen", "bearbeiter", [pfad("beleg")]),
  regel("GET", "/belege/:id/datei", "betrachter", [pfad("beleg")]), // schreibt eine Zeile `gelesen` ins Protokoll
  regel("POST", "/belege/:id/stufe", "freigeber", [pfad("beleg")], { nurMensch: true }),
  regel("POST", "/belege/:id/storno", "freigeber", [pfad("beleg")], { nurMensch: true }),
  // Saldenlisten: hochladen und prüfen = bearbeiter, übernehmen = freigeber (nur Menschen, andere Person); Auswertungen lesen = betrachter, exportieren = bearbeiter.
  regel("POST", "/fonds/:id/saldenlaeufe", "bearbeiter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/saldenlaeufe", "betrachter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/perioden", "betrachter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/auswertung/:sicht", "betrachter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/auswertung/:sicht/datei", "bearbeiter", [pfad("fonds")]), // schreibt eine Zeile `gelesen` ins Protokoll
  regel("GET", "/fonds/:id/abstimmung", "betrachter", [pfad("fonds")]),
  regel("GET", "/saldenlaeufe/:id", "betrachter", [pfad("saldenlauf")]),
  regel("GET", "/saldenlaeufe/:id/salden", "betrachter", [pfad("saldenlauf")]),
  regel("POST", "/saldenlaeufe/:id/pruefen", "bearbeiter", [pfad("saldenlauf")]),
  regel("POST", "/saldenlaeufe/:id/uebernehmen", "freigeber", [pfad("saldenlauf")], { nurMensch: true }),
  // Buchungsexport (DATEV): Vorschau und Export = bearbeiter, Abruf der Datei = bearbeiter mit Zeile `gelesen`.
  regel("POST", "/fonds/:id/buchungsexport/vorschau", "bearbeiter", [pfad("fonds")]),
  regel("POST", "/fonds/:id/buchungsexport", "bearbeiter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/buchungsexporte", "betrachter", [pfad("fonds")]),
  regel("GET", "/buchungsexporte/:id/datei", "bearbeiter", [pfad("buchungsexport")]),

  // Berichte ohne Fonds -----------------------------------------------------------------------------------------------
  regel("GET", "/berichte/gremienvorlage", "betrachter"),

  // Berichte mit Freigabe in Stufen: anlegen und Abschnitte bearbeiten = bearbeiter, lesen und Datei = betrachter,
  // jede Stufe (auch die Rückgabe) = freigeber (nur Menschen). Die Liste ohne `fondsId` zeigt nur sichtbare Fonds.
  global("POST", "/berichte/varianten-nachholen"), // Fassungen je Investor für früher freigegebene LP-Berichte, nur Verwaltung
  regel("POST", "/berichte", "bearbeiter", [koerper("fondsId"), koerper("beteiligungId", "beteiligung")]),
  regel("GET", "/berichte", "betrachter", [abfrage("fondsId")]),
  regel("GET", "/berichte/:id", "betrachter", [pfad("bericht")]),
  regel("GET", "/berichte/:id/datei", "betrachter", [pfad("bericht")]), // schreibt eine Zeile `gelesen` ins Protokoll
  regel("GET", "/berichte/:id/kontrolle", "betrachter", [pfad("bericht")]),
  regel("PUT", "/berichte/:id/abschnitte/:schluessel", "bearbeiter", [pfad("bericht")]),
  regel("POST", "/berichte/:id/berichtigung", "bearbeiter", [pfad("bericht")]),
  regel("POST", "/berichte/:id/stufe", "freigeber", [pfad("bericht")], { nurMensch: true }),

  // Förder- und Meldeberichte (Etappe 15). Definitionen und Förderprogramme: lesen = betrachter, schreiben = globale Verwalter. Aktivierung je Fonds = verwalter,
  // Förder- und Buchhaltungsschlüssel der Beteiligung stehen unter `/beteiligungen/:id/buchhaltungsschluessel` (bearbeiter), Sitzland und Region unter `/organisationen/:id/meldedaten`. Läufe: anlegen, Eingaben und Kommentare = bearbeiter, jede Stufe = freigeber (nur Menschen), lesen und Dateien = betrachter.
  regel("GET", "/meldedefinitionen", "betrachter"),
  global("POST", "/meldedefinitionen"),
  global("POST", "/meldedefinitionen/pruefen"),
  regel("GET", "/meldedefinitionen/:schluessel", "betrachter"),
  global("POST", "/meldedefinitionen/:schluessel/versionen"),
  regel("GET", "/meldedefinitionen/:schluessel/versionen/:version", "betrachter"),
  regel("GET", "/foerderprogramme", "betrachter"),
  global("POST", "/foerderprogramme"),
  regel("GET", "/fonds/:id/meldedefinitionen", "betrachter", [pfad("fonds")]),
  regel("PUT", "/fonds/:id/meldedefinitionen/:schluessel", "verwalter", [pfad("fonds")]),
  regel("GET", "/fonds/:id/melde-zuordnungen", "betrachter", [pfad("fonds")]),
  regel("GET", "/organisationen/:id/meldedaten", "betrachter", [pfad("organisationHalter")]),
  regel("PUT", "/organisationen/:id/meldedaten", "bearbeiter", [pfad("organisationHalter")]),
  regel("POST", "/meldelaeufe", "bearbeiter", [koerper("fondsId")]),
  regel("GET", "/meldelaeufe", "betrachter", [abfrage("fondsId")]),
  regel("GET", "/meldelaeufe/:id", "betrachter", [pfad("meldelauf")]),
  regel("GET", "/meldelaeufe/:id/herkunft", "betrachter", [pfad("meldelauf")]),
  regel("GET", "/meldelaeufe/:id/befunde", "betrachter", [pfad("meldelauf")]),
  regel("GET", "/meldelaeufe/:id/datei", "betrachter", [pfad("meldelauf")]), // schreibt eine Zeile `gelesen` ins Protokoll
  regel("PUT", "/meldelaeufe/:id/eingaben", "bearbeiter", [pfad("meldelauf")]),
  regel("PUT", "/meldelaeufe/:id/befunde/:regelId/kommentar", "bearbeiter", [pfad("meldelauf")]),
  regel("POST", "/meldelaeufe/:id/stufe", "freigeber", [pfad("meldelauf")], { nurMensch: true }),
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
