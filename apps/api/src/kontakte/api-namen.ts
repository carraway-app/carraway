/** Namen an der HTTP-Grenze. Datenbank, Protokoll und gespeicherte CRM-Ansichten behalten ihre Schlüssel. */
const FELDER = {
  abfrage: "query",
  abgesagt: "declined",
  abgeschnitten: "truncated",
  ablauf: "expiresAt",
  absage: "decline",
  absageGemeldet: "declineSent",
  absagegruende: "declineReasons",
  absagegrund: "declineReason",
  abschluss: "closing",
  absender: "sender",
  abweichend: "deviates",
  adresse: "address",
  aenderungen: "changes",
  aktion: "action",
  aktivitaeten: "activities",
  aktualisiertAm: "updatedAt",
  aktuell: "current",
  aktualisiert: "updatedCount",
  am: "at",
  anbieter: "provider",
  angefordert: "requested",
  angelegt: "createdCount",
  angelegtAm: "addedAt",
  anhangId: "attachmentId",
  anzahl: "count",
  anzahlEintraege: "entryCount",
  anzeige: "display",
  archiviert: "archived",
  archiviertAm: "archivedAt",
  art: "kind",
  aufgaben: "tasks",
  auflagen: "approvalConditions",
  auftragId: "jobId",
  ausgangskorb: "outbox",
  ausgehend: "outgoing",
  ausschnitt: "excerpt",
  ausser: "excludeId",
  bearbeitbar: "editable",
  beginn: "start",
  beglichenVorgangId: "settledTransactionId",
  bemerkung: "remark",
  benutzer: "user",
  benutzerId: "userId",
  bereich: "scope",
  bereichFehlt: "missingArea",
  bereiche: "scopes",
  beschaeftigung: "employment",
  beschaeftigungen: "employments",
  beschluesse: "resolutions",
  beschlussBetrag: "resolutionAmount",
  beschlussvorschlag: "resolutionDraft",
  beschreibung: "description",
  besitzerId: "ownerId",
  beteiligung: "investment",
  beteiligungId: "investmentId",
  beteiligungen: "investments",
  betrag: "amount",
  betragLokal: "localAmount",
  betreff: "subject",
  betreuung: "coverage",
  bewertung: "valuation",
  bezeichnungDe: "labelDe",
  bezeichnungEn: "labelEn",
  beziehungen: "relationships",
  bezuege: "references",
  bezugArt: "referenceType",
  bezugId: "referenceId",
  bis: "to",
  breite: "width",
  darfAnlegen: "mayCreate",
  darfAusfuehren: "mayExecute",
  dateiname: "fileName",
  daten: "data",
  datensatzId: "recordId",
  datensatzIds: "recordIds",
  datum: "date",
  dealtyp: "dealType",
  dokument: "document",
  dokumentId: "documentId",
  dokumente: "documents",
  doppelt: "duplicateCount",
  dublette: "duplicate",
  dubletteBestaetigt: "duplicateConfirmed",
  dubletten: "duplicates",
  eigene: "customFields",
  eigeneDomains: "ownDomains",
  eingang: "intake",
  eingangsdatum: "receivedDate",
  eingehend: "incoming",
  einheit: "unit",
  einstellung: "settings",
  eintraege: "entries",
  eintrag: "entry",
  elemente: "conditions",
  empfaenger: "recipients",
  ende: "end",
  entfernt: "removed",
  entscheidungen: "decisions",
  erfasstAm: "recordedAt",
  erfasstVon: "recordedBy",
  erfolgreich: "successful",
  ergaenzt: "enriched",
  ergebnis: "outcome",
  erlaeuterungDe: "explanationDe",
  erlaeuterungEn: "explanationEn",
  erledigtAm: "completedAt",
  erreicht: "reached",
  erstelltAm: "createdAt",
  erstelltVon: "createdBy",
  erstinvestment: "initialInvestment",
  erwartetInvestmentmanagerId: "expectedInvestmentManagerId",
  erwartetProjektleiterId: "expectedProjectLeadId",
  faellig: "dueDate",
  faelligAm: "dueAt",
  farbe: "color",
  fehlend: "missing",
  fehlende: "missingKeys",
  fehler: "errors",
  fehlgeschlagen: "failed",
  feld: "field",
  felder: "fields",
  firma: "companyName",
  fonds: "fund",
  fondsId: "fundId",
  fondsIds: "fundIds",
  freigabeNoetig: "approvalRequired",
  funktion: "jobTitle",
  geaendertSeit: "changedSince",
  gesamt: "total",
  geschaetzt: "estimated",
  gesendetAm: "sentAt",
  gesendetLetzteStunde: "sentLastHour",
  gesperrtBis: "lockedUntil",
  geteilt: "shared",
  gremium: "committee",
  groesse: "size",
  grund: "reason",
  gruppe: "group",
  gruppen: "groups",
  gruppenschluessel: "groupKey",
  gruppierung: "groupBy",
  haupt: "primary",
  herkunft: "origin",
  heute: "today",
  hinweis: "guidance",
  hinzugefuegt: "added",
  inhalt: "content",
  inhaltSpeichern: "storeContent",
  instrumentFelder: "instrumentFields",
  investiert: "invested",
  investmentmanager: "investmentManager",
  investmentmanagerId: "investmentManagerId",
  investmentmanagerName: "investmentManagerName",
  jahr: "year",
  kandidaten: "candidates",
  kapitalisiert: "capitalized",
  karten: "cards",
  kartenProSpalte: "cardsPerColumn",
  kennzahlen: "metrics",
  klassifikation: "classification",
  kommende: "upcoming",
  kommentar: "comment",
  konfig: "config",
  konfiguriert: "configured",
  kontakte: "contacts",
  konversion: "conversion",
  konversionNachBetreuung: "conversionByCoverage",
  konversionNachQuelle: "conversionBySource",
  konversionZurNaechsten: "conversionToNext",
  kurs: "exchangeRate",
  kursId: "exchangeRateId",
  kurzname: "shortName",
  letzteAktivitaet: "lastActivity",
  letzterAbgleichAm: "lastSyncedAt",
  letzterFehler: "lastError",
  limitProStunde: "hourlyLimit",
  leer: "emptyCount",
  listeId: "listId",
  mandate: "mandates",
  meldung: "message",
  mitAnmeldung: "useAuthentication",
  mitKandidaten: "withCandidates",
  modus: "mode",
  monat: "month",
  naceAbschnitt: "naceSection",
  nachPhase: "toStage",
  nachher: "after",
  nachname: "lastName",
  naechsterCursor: "nextCursor",
  naechsterVersuchAm: "nextAttemptAt",
  neu: "new",
  notiz: "note",
  nurAktive: "activeOnly",
  objekt: "object",
  offen: "open",
  operatoren: "operators",
  optionen: "options",
  ordner: "folder",
  organisation: "organization",
  organisationId: "organizationId",
  organisationen: "organizations",
  ort: "city",
  passwort: "password",
  periodeBeginn: "periodFrom",
  periodeEnde: "periodTo",
  personen: "people",
  pflicht: "required",
  phase: "stage",
  phasen: "stages",
  phasenverlauf: "stageHistory",
  phasenwechsel: "stageChanges",
  projektleiter: "projectLead",
  projektleiterId: "projectLeadId",
  projektleiterName: "projectLeadName",
  protokoll: "history",
  quartal: "quarter",
  quellDatei: "sourceFile",
  quelle: "source",
  quelleId: "sourceId",
  quellen: "sources",
  quellenangabe: "sourceReference",
  rechtsform: "legalForm",
  regelwerk: "framework",
  registerEreignisId: "registerEventId",
  richtung: "direction",
  rolle: "role",
  rollen: "roles",
  runden: "rounds",
  rundenpositionen: "roundPositions",
  schluessel: "key",
  schluesselVorhanden: "keyConfigured",
  schreibbar: "writable",
  schreibgeschuetzt: "readOnly",
  seite: "page",
  sektor: "sector",
  selbstUebernehmen: "takeOwnership",
  sicherheit: "security",
  sortierbar: "sortable",
  sortierung: "sort",
  spalte: "column",
  spalten: "columns",
  sperrliste: "blocklist",
  sprache: "language",
  stand: "knowledgeDate",
  standard: "default",
  storniertVorgangId: "reversedTransactionId",
  suche: "search",
  summe: "sum",
  summen: "sums",
  tage: "days",
  teilnehmen: "participating",
  telefon: "phone",
  titel: "title",
  typ: "type",
  ueberfaellig: "overdue",
  uebernommen: "accepted",
  ueberschneidungVerdeckt: "hiddenOverlap",
  ueberschneidungen: "overlaps",
  uebersprungen: "skipped",
  unbekannteSpalten: "unknownColumns",
  unternehmen: "company",
  unternehmenAnlegen: "createCompany",
  unternehmenEmail: "companyEmail",
  unternehmenName: "companyLabel",
  unternehmenTelefon: "companyPhone",
  unternehmenWebsite: "companyWebsite",
  unveraendert: "unchanged",
  vehikelAnzahl: "vehicleCount",
  verbindungen: "connections",
  verdeckteFonds: "hiddenFunds",
  verknuepfung: "conjunction",
  verknuepfungen: "links",
  valuta: "valueDate",
  verschiebt: "moves",
  verschoben: "moved",
  versuche: "attempts",
  verweildauer: "timeInStage",
  von: "from",
  vonOrganisationId: "fromOrganizationId",
  vonPhase: "fromStage",
  vonTyp: "fromType",
  vorhanden: "existing",
  vorher: "before",
  vorlage: "template",
  vorlageId: "templateId",
  vorname: "firstName",
  vorschlag: "suggestion",
  waehrung: "currency",
  wartend: "pending",
  wert: "value",
  werte: "values",
  wiedervorlage: "followUp",
  wiedervorlageErledigtAm: "followUpCompletedAt",
  zeile: "row",
  zeileInDatei: "fileRow",
  zeilen: "rows",
  zeitreihe: "timeSeries",
  ziel: "target",
  zielId: "targetId",
  zuOrganisationId: "toOrganizationId",
  zuTyp: "toType",
  zuordnung: "assignment",
  zusage: "commitment",
  zusammenfassung: "summary",
  zusammengefuehrtAm: "mergedAt",
  zusammengefuehrtIn: "mergedInto",
  zustaendig: "assignee",
  zustaendigId: "assigneeId",
  zustaendigName: "assigneeName",
  zustimmung: "consent",
} as const;

const WERTE = {
  aktion: { anlegen: "create", archivieren: "archive", feld_setzen: "set_field", liste_hinzufuegen: "add_to_list", phase: "stage", ueberspringen: "skip", zusammenfuehren: "merge" },
  art: { archivieren: "archive", auszahlung: "disbursement", berater: "advisor", dividende: "dividend", erwaehnung: "mention", feld_setzen: "set_field", gespraech: "conversation", kennzahlen: "metrics", liste_hinzufuegen: "add_to_list", notiz: "note", phase: "stage", quelle: "source", rueckfluss: "proceeds", sonstige: "other", tabelle: "table", termin: "meeting", tilgung: "principal_repayment", unternehmen: "company", wertberichtigung: "write_down", ziel: "target", zins: "interest", zinszahlung: "interest_payment", zusage: "commitment" },
  bereich: { kalender: "calendar" },
  bereichFehlt: { berichte: "reports", daten: "data", dokumente: "documents", finanzen: "finance", fondsverwaltung: "fund_administration", kennzahlen: "metrics", kontakte: "contacts", meldewesen: "regulatory_reporting" },
  bereiche: { kalender: "calendar" },
  bezugArt: { bericht: "report", beteiligung: "investment", fonds: "fund", fonds_bewegung: "fund_movement", kennzahl_abfrage: "metric_request", melde_lauf: "reporting_run", organisation: "organization", register_ereignis: "register_event", testmail: "test_email" },
  dealtyp: { anschlussinvestment: "follow_on", erstinvestment: "initial" },
  dubletten: { aktualisieren: "update", anlegen: "create", ueberspringen: "skip" },
  ergebnis: { abgelehnt: "rejected", angelegt: "created", ergaenzt: "enriched", fehler: "error", uebersprungen: "skipped", unveraendert: "unchanged", vertagt: "deferred", zugestimmt: "approved" },
  felder: { quelle: "source", ziel: "target" },
  fehler: {
    art_fehlt: "kind_required",
    art_unbekannt: "unknown_kind",
    datum_ungueltig: "invalid_date",
    email_ungueltig: "invalid_email",
    funktion_zu_lang: "job_title_too_long",
    nachname_fehlt: "last_name_required",
    nachname_zu_lang: "last_name_too_long",
    name_fehlt: "name_required",
    name_zu_lang: "name_too_long",
    ort_zu_lang: "city_too_long",
    rolle_ohne_organisation: "role_requires_organization",
    rolle_unbekannt: "unknown_role",
    sektor_zu_lang: "sector_too_long",
    typ_unbekannt: "unknown_type",
    vorname_fehlt: "first_name_required",
    vorname_zu_lang: "first_name_too_long",
    website_ungueltig: "invalid_website",
    zeitraum_ungueltig: "invalid_period",
    ziel_fehlt: "target_required",
  },
  farbe: { blau: "blue", grau: "gray", tuerkis: "teal", violett: "purple" },
  herkunft: { anfrage: "inbound" },
  instrument: { darlehen: "loan", gesellschafterdarlehen: "shareholder_loan", offene_beteiligung: "equity", optionsschein: "warrant", stille_beteiligung: "silent_participation", wandeldarlehen: "convertible_loan" },
  klassifikation: { beleg: "voucher", bericht: "report", beschluss: "resolution", bewertung: "valuation", sonstiges: "miscellaneous", vertrag: "contract" },
  letzterFehler: {
    ABGLEICH_FEHLER: "sync_failed",
    ANBIETER_ANTWORT_UNGUELTIG: "invalid_provider_response",
    ANBIETER_BEGRENZT: "provider_rate_limited",
    ANBIETER_NICHT_EINGERICHTET: "provider_not_configured",
    ANBIETER_NICHT_ERREICHBAR: "provider_unreachable",
    ANHANG_ZU_GROSS: "attachment_too_large",
    GEHEIMNIS_FEHLER: "secret_error",
    ZIEL_NICHT_AUFLOESBAR: "target_resolution_failed",
    ZIEL_VERBOTEN: "target_forbidden",
    ZUGANG_FALSCH: "incorrect_credentials",
    ZUGANG_UNGUELTIG: "invalid_credentials",
  },
  modus: { aus: "off", direkt: "automatic", vorschlag: "suggestion" },
  nachPhase: { anfrage: "inbound", erstgespraech: "initial_meeting", investitionsausschuss: "investment_committee", pruefung: "screening" },
  objekt: { beteiligung: "investment", fonds: "fund", organisation: "organization", runde: "round", vorgang: "transaction" },
  operator: { ab: "on_or_after", beginnt_mit: "starts_with", bis: "on_or_before", enthaelt: "contains", enthaelt_alle: "contains_all", enthaelt_eines: "contains_any", enthaelt_keines: "contains_none", enthaelt_nicht: "does_not_contain", gleich: "equals", groesser: "greater_than", groesser_gleich: "greater_than_or_equal", ist: "is", ist_eines_von: "is_one_of", ist_falsch: "is_false", ist_nicht: "is_not", ist_wahr: "is_true", kleiner: "less_than", kleiner_gleich: "less_than_or_equal", leer: "empty", nach: "after", nicht_leer: "not_empty", ungleich: "not_equal", vor: "before", zwischen: "between" },
  operatoren: { ab: "on_or_after", beginnt_mit: "starts_with", bis: "on_or_before", enthaelt: "contains", enthaelt_alle: "contains_all", enthaelt_eines: "contains_any", enthaelt_keines: "contains_none", enthaelt_nicht: "does_not_contain", gleich: "equals", groesser: "greater_than", groesser_gleich: "greater_than_or_equal", ist: "is", ist_eines_von: "is_one_of", ist_falsch: "is_false", ist_nicht: "is_not", ist_wahr: "is_true", kleiner: "less_than", kleiner_gleich: "less_than_or_equal", leer: "empty", nach: "after", nicht_leer: "not_empty", ungleich: "not_equal", vor: "before", zwischen: "between" },
  phase: { anfrage: "inbound", erstgespraech: "initial_meeting", investitionsausschuss: "investment_committee", pruefung: "screening" },
  richtung: { ab: "desc", auf: "asc", aus: "off", ein: "on" },
  rolle: { berater: "advisor", geschaeftsfuehrung: "executive", gruender: "founder", sonstige: "other" },
  sicherheit: { keine: "none" },
  status: { verbunden: "connected", erneut_anmelden: "reauthentication_required", abgesagt: "declined", abgeschrieben: "written_off", aktiv: "active", aktualisiert: "updated", alle: "all", angelegt: "created", bestaetigt: "confirmed", dublette: "duplicate", eingereicht: "submitted", erledigt: "completed", exit: "exited", fehler: "error", fehlgeschlagen: "failed", gesendet: "sent", investiert: "invested", leer: "empty", neu: "new", offen: "open", uebersprungen: "skipped", vorhanden: "existing", wartend: "pending", widerrufen: "revoked" },
  tls: { keine: "none" },
  typ: { auswahl: "select", benutzer: "user", beteiligung: "investment", betrag: "amount", bewertung: "valuation", datum: "date", finanzierungsrunde: "financing_round", fonds: "fund", ja_nein: "yes_no", kontrollkaestchen: "checkbox", langtext: "long_text", mehrfachauswahl: "multi_select", organisation: "organization", prozent: "percentage", telefon: "phone", verknuepfung: "link", vorgang: "transaction", zahl: "number" },
  verknuepfung: { oder: "or", und: "and" },
  vorlage: { bericht_freigegeben: "report_approved", esg_abfrage: "esg_request", kennzahl_abfrage: "metric_request", lp_mitteilung: "lp_notice", register_ereignis: "register_event", testmail: "test_email" },
  vonPhase: { anfrage: "inbound", erstgespraech: "initial_meeting", investitionsausschuss: "investment_committee", pruefung: "screening" },
  vonTyp: { organisation: "organization" },
  vorschlag: { anlegen: "create", quelle: "source", ueberspringen: "skip", ziel: "target", zusammenfuehren: "merge" },
  ziel: { organisation: "organization" },
  zuTyp: { organisation: "organization" },
  zuordnung: { datei: "file", vorhanden: "existing" },
  zustaendig: { alle: "all", ich: "me" },
} as const;

type Feldnamen = typeof FELDER;
type Wertnamen = typeof WERTE;
type Umkehr<T> = { [K in keyof T as T[K] & string]: K };
type Feldname<K, V> = K extends "eigene"
  ? V extends boolean | "true" | "false" ? "own" : "customFields"
  : K extends "benutzer"
    ? V extends string ? "username" : V extends readonly unknown[] ? "users" : "user"
    : K extends keyof Feldnamen ? Feldnamen[K] : K;
type DeutscherName<K> = K extends "own" ? "eigene" : K extends "users" | "username" ? "benutzer" : K extends keyof Umkehr<Feldnamen> ? Umkehr<Feldnamen>[K] : K;
type EnumWert<T, K> = K extends keyof Wertnamen ? T extends keyof Wertnamen[K] ? Wertnamen[K][T] : T : T;
type Feldkontext<K, P, T, Seiten> = [K] extends ["felder"]
  ? [K] extends [never] ? P : T extends Seiten ? "felder" : P
  : P;
type DeutscherWert<T, K> = K extends keyof Wertnamen ? T extends keyof Umkehr<Wertnamen[K]> ? Umkehr<Wertnamen[K]>[T] : T : T;

export type Englisch<T, K = never, D extends unknown[] = []> =
  D["length"] extends 7 ? T :
  T extends Date ? T :
  T extends readonly unknown[] ? { [I in keyof T]: Englisch<T[I], K, [...D, unknown]> } :
  T extends object ? string extends keyof T ? T : { [P in keyof T as Feldname<P, T[P]>]: Englisch<T[P], Feldkontext<K, P, T[P], "ziel" | "quelle">, [...D, unknown]> } :
  [K] extends [never] ? T : EnumWert<T, K>;

export type Deutsch<T, K = never, D extends unknown[] = []> =
  D["length"] extends 7 ? T :
  T extends readonly unknown[] ? { [I in keyof T]: Deutsch<T[I], K, [...D, unknown]> } :
  T extends object ? string extends keyof T ? T : { [P in keyof T as DeutscherName<P>]: Deutsch<T[P], Feldkontext<K, DeutscherName<P>, T[P], "target" | "source">, [...D, unknown]> } :
  [K] extends [never] ? T : DeutscherWert<T, K>;

type Namen = Readonly<Record<string, string>>;
const umkehren = (namen: Namen): Namen => Object.fromEntries(Object.entries(namen).map(([de, en]) => [en, de]));
const DEUTSCHE_FELDER = { ...umkehren(FELDER), own: "eigene", users: "benutzer", username: "benutzer" };
const DEUTSCHE_WERTE = Object.fromEntries(Object.entries(WERTE).map(([feld, werte]) => [feld, umkehren(werte)]));
const werteJeFeld: Readonly<Record<string, Namen>> = WERTE;
const name = (namen: Namen | undefined, wert: string) => namen && Object.hasOwn(namen, wert) ? namen[wert]! : wert;
export const englischerFeldname = (feld: string) => name(FELDER, feld);

function feldname(feld: string, wert: unknown): string {
  if (feld === "eigene" && (typeof wert === "boolean" || wert === "true" || wert === "false")) return "own";
  if (feld === "benutzer" && typeof wert === "string") return "username";
  if (feld === "benutzer" && Array.isArray(wert)) return "users";
  return englischerFeldname(feld);
}
export const englischerEnumWert = (feld: string, wert: string) => name(werteJeFeld[feld], wert);

const SYSTEMFELDER = new Set([
  "art", "sektor", "ort", "rechtsform", "telefon", "kontakte", "erstelltAm", "vorname", "nachname",
  "unternehmen", "funktion", "titel", "phase", "eingangsdatum", "herkunft", "dealtyp", "fonds", "fondsId",
  "investmentmanagerId", "projektleiterId", "investmentmanager", "projektleiter", "unternehmenEmail",
  "unternehmenTelefon", "unternehmenWebsite", "quelle", "betreuung", "aktualisiertAm",
]);
const SYSTEMFELDER_EN = new Set([...SYSTEMFELDER].map(englischerFeldname));

/** Eigene Feld- und Optionsschlüssel stammen von Aufrufenden und bleiben unverändert. */
function feldschluessel(wert: string, nachEnglisch: boolean, ungueltig?: (pfad: string[]) => void, pfad: string[] = []): string {
  if (nachEnglisch) return SYSTEMFELDER.has(wert) ? englischerFeldname(wert) : wert;
  if (SYSTEMFELDER_EN.has(wert)) return name(DEUTSCHE_FELDER, wert);
  if (SYSTEMFELDER.has(wert)) ungueltig?.(pfad);
  return wert;
}

const IMPORT_MELDUNGEN = [
  ["Ja oder Nein erwartet", "Expected yes or no"],
  ["Ungültiger Wert", "Invalid value"],
  ["Verknüpfungs- und Personenfelder lassen sich nicht importieren", "Link and user fields cannot be imported"],
  ["Name fehlt", "Name is required"],
  ["Vor- und Nachname werden gebraucht", "First and last name are required"],
] as const;

function importMeldung(meldung: string, englisch: boolean): string {
  if (englisch) {
    const option = /^Unbekannte Option „(.*)“$/.exec(meldung);
    if (option) return `Unknown option: “${option[1]}”`;
    const doppelt = /^Doppelt in der Datei \(Zeile (\d+)\)$/.exec(meldung);
    if (doppelt) return `Duplicate in file (row ${doppelt[1]})`;
    const fehlt = /^Unternehmen „(.*)“ gibt es nicht$/.exec(meldung);
    if (fehlt) return `Organization “${fehlt[1]}” does not exist`;
    return IMPORT_MELDUNGEN.find(([de]) => de === meldung)?.[1] ?? meldung;
  }
  const option = /^Unknown option: “(.*)”$/.exec(meldung);
  if (option) return `Unbekannte Option „${option[1]}“`;
  const doppelt = /^Duplicate in file \(row (\d+)\)$/.exec(meldung);
  if (doppelt) return `Doppelt in der Datei (Zeile ${doppelt[1]})`;
  const fehlt = /^Organization “(.*)” does not exist$/.exec(meldung);
  if (fehlt) return `Unternehmen „${fehlt[1]}“ gibt es nicht`;
  return IMPORT_MELDUNGEN.find(([, en]) => en === meldung)?.[0] ?? meldung;
}

type Abbildung = { englisch: boolean; crm: boolean; gruppenfeld?: string; ungueltig?: (pfad: string[]) => void };
const FELDVERWEISE = new Set(["feld", "felder", "gruppierung", "gruppe", "summe", "summen"]);
const BEZUGSTYPEN = { organisation: "organization", benutzer: "user" };
const DEUTSCHE_BEZUGSTYPEN = umkehren(BEZUGSTYPEN);

function bezuege(wert: Record<string, unknown>, englisch: boolean) {
  return Object.fromEntries(Object.entries(wert).map(([schluessel, eintrag]) => {
    const [typ, id] = schluessel.split(":");
    return [id ? `${name(englisch ? BEZUGSTYPEN : DEUTSCHE_BEZUGSTYPEN, typ!)}:${id}` : schluessel, eintrag];
  }));
}

function abbilden(wert: unknown, a: Abbildung, pfad: string[] = [], feld?: string, eltern?: Record<string, unknown>): unknown {
  if (Array.isArray(wert)) return wert.map((eintrag, i) => abbilden(eintrag, a, [...pfad, String(i)], feld, eltern));
  if (typeof wert === "string" && feld) {
    if (a.crm && feld === "rolle") return wert;
    if (a.crm && feld === "meldung") return importMeldung(wert, a.englisch);
    if (feld === "letzterFehler" && (a.englisch ? wert.startsWith("SMTP_") : wert.startsWith("smtp_"))) {
      return a.englisch ? (wert === "SMTP_FEHLER" ? "smtp_error" : wert.toLowerCase()) : (wert === "smtp_error" ? "SMTP_FEHLER" : wert.toUpperCase());
    }
    if ((a.crm || (feld === "feld" && Object.hasOwn(eltern ?? {}, a.englisch ? "abweichend" : "deviates"))) && (FELDVERWEISE.has(feld) || (feld === "schluessel" && (Object.hasOwn(eltern ?? {}, "system"))))) {
      return feldschluessel(wert, a.englisch, a.ungueltig, pfad);
    }
    const systemFeld = eltern?.[a.englisch ? "feld" : "field"];
    const gruppenwert = a.gruppenfeld && feld === "wert" && Object.hasOwn(eltern ?? {}, a.englisch ? "anzahl" : "count");
    const vergleich = (feld === "quelle" || feld === "ziel") && Object.hasOwn(eltern ?? {}, a.englisch ? "abweichend" : "deviates");
    const enumFeld = typeof systemFeld === "string" && ((a.crm && feld === "wert") || vergleich)
      ? (a.englisch ? systemFeld : name(DEUTSCHE_FELDER, systemFeld))
      : gruppenwert ? a.gruppenfeld! : feld;
    const auswahl = pfad.length === 2 && (pfad[0] === "felder" || pfad[0] === "fields");
    const werteSchluessel = auswahl ? "felder" : enumFeld;
    const enumNamen = werteJeFeld[werteSchluessel];
    const namen = a.englisch ? enumNamen : DEUTSCHE_WERTE[werteSchluessel];
    if (!a.englisch && !Object.hasOwn(namen ?? {}, wert) && Object.hasOwn(enumNamen ?? {}, wert)) a.ungueltig?.(pfad);
    return name(namen, wert);
  }
  if (wert === null || typeof wert !== "object" || wert instanceof Date) return wert;

  const objekt = wert as Record<string, unknown>;
  return Object.fromEntries(Object.entries(objekt).map(([schluessel, eintrag]) => {
    const deutsch = a.englisch ? schluessel : name(DEUTSCHE_FELDER, schluessel);
    const ziel = a.englisch ? feldname(schluessel, eintrag) : deutsch;
    const teilpfad = [...pfad, schluessel];
    if (!a.englisch && schluessel !== feldname(deutsch, eintrag)) a.ungueltig?.(teilpfad);
    // UUID-Schlüssel und benutzerdefinierte Werte in diesen Wörterbüchern sind undurchsichtig.
    if (a.crm && deutsch === "optionen" && eintrag && typeof eintrag === "object" && objekt.system === true) {
      const key = objekt[a.englisch ? "schluessel" : "key"];
      const optionen = (eintrag as Record<string, unknown>)[a.englisch ? "optionen" : "options"];
      if (typeof key === "string" && Array.isArray(optionen)) {
        const system = a.englisch ? key : name(DEUTSCHE_FELDER, key);
        const namen = a.englisch ? werteJeFeld[system] : DEUTSCHE_WERTE[system];
        const eintraege = optionen.map((o: Record<string, unknown>) => {
          const optionKey = o[a.englisch ? "schluessel" : "key"];
          if (typeof optionKey !== "string") return o;
          const abgebildet = name(namen, optionKey);
          return { ...o, [a.englisch ? "schluessel" : "key"]: abgebildet, label: o.label === optionKey ? abgebildet : o.label };
        });
        return [ziel, abbilden({ ...eintrag, [a.englisch ? "optionen" : "options"]: eintraege }, a, teilpfad, deutsch, objekt)];
      }
    }
    if (eintrag !== null && typeof eintrag === "object" && !Array.isArray(eintrag)) {
      if (deutsch === "bezuege") return [ziel, bezuege(eintrag as Record<string, unknown>, a.englisch)];
      const importZeile = Object.hasOwn(objekt, a.englisch ? "zeile" : "row") && Object.hasOwn(objekt, a.englisch ? "aktion" : "action");
      if (deutsch === "eigene" || (deutsch === "werte" && !a.crm && !importZeile) || (deutsch === "felder" && !Object.hasOwn(objekt, a.englisch ? "quelleId" : "sourceId"))) {
        return [ziel, eintrag];
      }
    }
    return [ziel, abbilden(eintrag, a, teilpfad, deutsch, objekt)];
  }));
}

export function aufEnglisch<T>(wert: T, crm = false, gruppenfeld?: string): Englisch<T> {
  return abbilden(wert, { englisch: true, crm, ...(gruppenfeld ? { gruppenfeld } : {}) }) as Englisch<T>;
}

export function aufDeutsch<T>(wert: T, crm = false, ungueltig?: (pfad: string[]) => void, gruppenfeld?: string): Deutsch<T> {
  return abbilden(wert, { englisch: false, crm, ...(gruppenfeld ? { gruppenfeld } : {}), ...(ungueltig ? { ungueltig } : {}) }) as Deutsch<T>;
}

export function englischerFeldpfad(wert: string): string {
  return wert.split(".").map(englischerFeldname).join(".");
}

export function deutscherFeldpfad(wert: string): string {
  return wert.split(".").map((teil) => name(DEUTSCHE_FELDER, teil)).join(".");
}
