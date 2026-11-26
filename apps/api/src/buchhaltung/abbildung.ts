/** Gemeinsamer Vertrag für Buchhaltungsrouten und ihren Webclient. Freitext und benutzerdefinierte Feldwerte bleiben Daten. */
const felder = {
  abgerufen: "called",
  abschnitt: "section",
  akteur: "actor",
  aktiv: "active",
  am: "at",
  anteil: "share",
  anzahl: "count",
  art: "type",
  artId: "typeId",
  artNameDe: "typeNameDe",
  artNameEn: "typeNameEn",
  arten: "types",
  aufteilung: "allocation",
  ausgetreten: "withdrawn",
  ausuebungId: "exerciseId",
  basisArt: "baseType",
  befunde: "findings",
  beglichenVorgangId: "settledTransactionId",
  beispiele: "examples",
  beitrag: "contribution",
  belegId: "voucherId",
  belegfeld: "voucherField",
  belegnummer: "voucherNumber",
  belegnummerLfd: "voucherSequence",
  belegpraefix: "voucherPrefix",
  bemerkung: "remark",
  beraternummer: "advisorNumber",
  berechnet: "calculated",
  bereitsExportiert: "alreadyExported",
  beteiligungId: "investmentId",
  beteiligungIds: "investmentIds",
  betrag: "amount",
  betragLokal: "localAmount",
  bewegung: "movement",
  bezeichnung: "label",
  bezeichnungDe: "labelDe",
  bezeichnungEn: "labelEn",
  bezugArt: "referenceType",
  bezugId: "referenceId",
  bis: "to",
  bisherAusgezahlt: "previouslyDisbursed",
  blatt: "leaf",
  buSchluessel: "taxKey",
  buchhaltung: "accounting",
  buchungskreis: "companyCode",
  buchungstext: "postingText",
  buchwert: "bookValue",
  dateiGroesse: "fileSize",
  dateiName: "fileName",
  dateiSchluessel: "fileKey",
  dateiSha256: "fileSha256",
  dateiname: "sourceFileName",
  dateityp: "fileType",
  daten: "data",
  datum: "date",
  datumBis: "dateTo",
  datumVon: "dateFrom",
  differenz: "difference",
  eb: "openingBalance",
  ebWert: "openingValue",
  ebene: "level",
  eigeneArtId: "customTypeId",
  elternSchluessel: "parentKey",
  erfasstAm: "recordedAt",
  ergebnis: "result",
  erlaubt: "allowed",
  ersetzt: "replaces",
  ersetztAm: "replacedAt",
  ersetztVonLaufId: "replacedByRunId",
  erstelltAm: "createdAt",
  erstelltVon: "createdBy",
  erwartet: "expected",
  erzeugtAm: "generatedAt",
  erzeugtVon: "generatedBy",
  faelligAm: "dueDate",
  fehler: "errors",
  fehlerAnzahl: "errorCount",
  feld: "field",
  felder: "fields",
  foerderprogramm: "fundingProgram",
  foerderprogrammBezeichnung: "fundingProgramLabel",
  fondsBewegungId: "fundMovementId",
  fondsBewegungIds: "fundMovementIds",
  fondsId: "fundId",
  fondsWaehrung: "fundCurrency",
  freigegebenAm: "approvedAt",
  frist: "deadline",
  fussDe: "footerDe",
  fussEn: "footerEn",
  geaendert: "changed",
  geaendertAm: "updatedAt",
  geaendertVon: "updatedBy",
  gegenkonto: "contraAccount",
  geprueftAm: "reviewedAt",
  geprueftVon: "reviewedBy",
  gesamt: "total",
  gesperrtBis: "lockedUntil",
  groesse: "size",
  grund: "reason",
  gueltigAb: "validFrom",
  gueltigBis: "validTo",
  haben: "credit",
  hochgeladenAm: "uploadedAt",
  hochgeladenVon: "uploadedBy",
  hoechstalterTage: "maxAgeDays",
  investiert: "invested",
  kapitalisiert: "capitalized",
  katalog: "catalog",
  kommentar: "comment",
  konfiguriert: "configured",
  konten: "accounts",
  konto: "account",
  kontoBis: "accountTo",
  kontoNummer: "ledgerAccountNumber",
  kontoVon: "accountFrom",
  kopfDe: "headerDe",
  kopfEn: "headerEn",
  kurs: "exchangeRate",
  kursId: "exchangeRateId",
  lauf: "run",
  laufId: "runId",
  letzterKursDatum: "lastRateDate",
  liquiditaet: "liquidity",
  mandantennummer: "clientNumber",
  manuell: "manual",
  mehrdeutig: "ambiguous",
  meilensteinBetrag: "milestoneAmount",
  meilensteinId: "milestoneId",
  meldeArt: "reportingType",
  meldung: "message",
  mitBeleg: "hasVoucher",
  mitRegelId: "conflictingRuleId",
  mittelarten: "fundingSources",
  mittelherkunft: "sourcesOfFunds",
  nach: "toCurrency",
  naechsteStufe: "nextStage",
  naechsteStufeName: "nextStageName",
  navGruppe: "navGroup",
  neuePositionen: "newItems",
  nichtZugeordnet: "unassigned",
  nr: "sequence",
  nummer: "accountNumber",
  ohneBeleg: "withoutVoucher",
  ohneKonto: "withoutAccount",
  organisation: "organization",
  organisationId: "organizationId",
  partnernummer: "partnerNumber",
  pflicht: "required",
  position: "position",
  positionSchluessel: "itemKey",
  positionen: "items",
  probleme: "issues",
  projektnummer: "projectNumber",
  protokoll: "history",
  quelle: "source",
  quellen: "sources",
  quote: "ratio",
  regel: "rule",
  regelId: "ruleId",
  regelIds: "ruleIds",
  reihenfolge: "order",
  richtung: "direction",
  rundeId: "roundId",
  sachkontenlaenge: "accountNumberLength",
  saldensumme: "balanceSum",
  saldo: "balance",
  schluessel: "key",
  schritte: "steps",
  schweregrad: "severity",
  seite: "side",
  sicht: "view",
  sitzland: "countryOfDomicile",
  soll: "debit",
  spalte: "column",
  sprache: "language",
  stichtag: "asOf",
  storniertBewegungId: "reversedMovementId",
  storniertVorgangId: "reversedTransactionId",
  storno: "reversal",
  stornoAm: "reversedAt",
  stornoGrund: "reversalReason",
  stornoVon: "reversedBy",
  stufe: "stage",
  stufeIndex: "stageIndex",
  stufen: "stages",
  summe: "sum",
  typ: "kind",
  uebernommenAm: "appliedAt",
  uebernommenVon: "appliedBy",
  ueberschneidungen: "overlaps",
  uebertragungId: "transferId",
  valuta: "valueDate",
  verkaufId: "saleId",
  verknuepft: "linked",
  verteilungsbasis: "allocationBasis",
  verteilungsquelle: "allocationSource",
  vertragsnummer: "contractNumber",
  von: "from",
  vorgang: "transaction",
  vorgangId: "transactionId",
  vorgangIds: "transactionIds",
  vorlage: "template",
  waehrung: "currency",
  warnungAnzahl: "warningCount",
  wert: "value",
  wertberichtigungen: "impairments",
  werte: "values",
  wiederholung: "repeat",
  wirtschaftsjahrBeginn: "fiscalYearStart",
  zeichen: "symbol",
  zeichnungId: "subscriptionId",
  zeichnungskapital: "subscribedCapital",
  zeile: "row",
  zeilen: "rows",
  zeitraumBis: "periodTo",
  zeitraumVon: "periodFrom",
  zinslaufId: "interestRunId",
  zusage: "commitment",
} as const;

const werte = {
  mitteilungen: "notices",
  kein_kurs: "no_rate",
  veraltet: "stale",
  automatisch: "automatic",
  generisch: "generic",
  geschaetzt: "estimated",
  gewandelt: "converted",
  getilgt: "repaid",
  verkauft: "sold",
  abgeschrieben: "written_off",
  offene_beteiligung: "equity",
  stille_beteiligung: "silent_participation",
  darlehen: "loan",
  wandeldarlehen: "convertible_loan",
  gesellschafterdarlehen: "shareholder_loan",
  optionsschein: "warrant",
  EXPORT_BELEGFELD_UNGUELTIG: "invalid_voucher_field",
  EXPORT_BETRAG_NULL: "zero_amount",
  EXPORT_KONTO_LAENGE: "invalid_account_length",
  EXPORT_ZEICHEN_NICHT_DARSTELLBAR: "unsupported_character",
  EXPORT_ZEITRAUM_ZU_GROSS: "period_too_long",
  Freigabe: "approval",
  Prüfung: "review",
  SUSA_BETRAG_UNGUELTIG: "invalid_amount",
  SUSA_ERSETZT_VORHANDENE: "replaces_existing",
  SUSA_KEINE_ZEILEN: "no_rows",
  SUSA_KEIN_KONTENRAHMEN: "missing_chart_of_accounts",
  SUSA_KONTO_DOPPELT: "duplicate_account",
  SUSA_KONTO_OHNE_REGEL: "missing_account_rule",
  SUSA_KONTO_UNBEKANNT: "unknown_account",
  SUSA_KONTO_UNBEKANNT_WEITERE: "more_unknown_accounts",
  SUSA_KONTO_UNGUELTIG: "invalid_account",
  SUSA_SALDENSUMME_UNGLEICH_NULL: "unbalanced_trial_balance",
  SUSA_SALDO_ABWEICHEND: "balance_mismatch",
  SUSA_SPALTE_FEHLT: "missing_column",
  SUSA_ZEITRAUM_UEBERLAPPT: "overlapping_period",
  abruf: "capital_call",
  aktiv: "asset",
  anderes_instrument: "other_instrument",
  anteil: "share",
  aufwand: "expense",
  ausschuettung: "distribution",
  auszahlung: "disbursement",
  berechnet: "calculated",
  bereich_ungueltig: "invalid_range",
  beteiligung: "investment",
  betrag: "amount",
  bewegungsart: "movement_type",
  bilanz: "balance_sheet",
  datum: "date",
  dividende: "dividend",
  doppelt: "duplicate",
  eigenmittel: "own_funds",
  eltern_unbekannt: "unknown_parent",
  entwurf: "draft",
  ertrag: "income",
  fehler: "error",
  festgehalten: "recorded",
  foerdermittel: "public_funds",
  fonds_bewegung: "fund_movement",
  fondsbewegung: "fund_posting",
  frei: "custom",
  freigegeben: "approved",
  gebucht: "posted",
  geprueft: "reviewed",
  guv: "income_statement",
  haben: "credit",
  hochgeladen: "uploaded",
  kapitalabruf: "capital_call_voucher",
  keine_zinsbuchung: "not_interest_posting",
  kofinanzierung: "co_financing",
  kopf: "header",
  liquiditaet: "liquidity",
  manuell: "manual",
  mittelverwendung: "use_of_funds",
  nicht_gefunden: "not_found",
  passiv: "liability",
  rueckfluss: "return_flow",
  rueckflussmittel: "returned_funds",
  soll: "debit",
  storniert: "reversed",
  tilgung: "repayment",
  uebernommen: "applied",
  unbekannt: "unknown",
  ungueltig: "invalid",
  verkauf: "sale",
  vertragsanlage: "contract_attachment",
  verworfen: "discarded",
  vorbereitet: "prepared",
  vorgang: "transaction",
  vorgangsart: "transaction_type",
  vorschau: "preview",
  wandlung: "conversion",
  warnung: "warning",
  wertberichtigung: "impairment",
  zahl: "number",
  zins: "interest",
  zinsbuchung: "interest_posting",
  zinslauf: "interest_run",
  zinszahlung: "interest_payment",
  zurueck: "returned",
  zusage: "commitment",
  zyklus: "cycle",
} as const;

const katalog = {
  agio: "premium",
  anteil_verkauft: "shareSold",
  anzahl_anteile: "shareCount",
  anzahl_perioden: "periodCount",
  ausgezahlt_gesamt: "totalDisbursed",
  barzufluss: "cashInflow",
  belegdatum: "voucherDate",
  bemerkung: "remark",
  betrag: "amount",
  buchungskreis: "companyCode",
  buchwert_abgang: "bookValueDisposed",
  ergebnis: "gainOrLoss",
  erloes: "proceeds",
  erstinvestment: "initialInvestment",
  faellig_am: "maturityDate",
  foerderprogramm: "fundingProgram",
  fonds_name: "fundName",
  kaufpreis: "purchasePrice",
  kosten: "costs",
  offene_zusage: "openCommitment",
  organisation_name: "organizationName",
  partnernummer: "partnerNumber",
  preis_je_anteil: "pricePerShare",
  projektnummer: "projectNumber",
  spitzenbetrag: "fractionalAmount",
  stichtag: "asOf",
  summe_bis_datum: "totalToDate",
  summe_kapitalisiert: "capitalizedTotal",
  treuhand_betrag: "escrowAmount",
  verkaeuferdarlehen_betrag: "vendorLoan",
  vertragsnummer: "contractNumber",
  wandlungsbetrag: "conversionAmount",
  zeichnungskapital: "subscribedCapital",
  zinsen_gebucht: "postedInterest",
  zinsmethode: "dayCountMethod",
  zinssatz: "interestRate",
  zusage: "commitment",
} as const;

const enumFelder = ["instrument", "art", "basisArt", "typ", "bezugArt", "status", "abschnitt", "manuell", "meldeArt", "quelle", "seite", "sicht", "stufe", "stufen", "naechsteStufeName", "ergebnis", "schweregrad", "verteilungsbasis", "verteilungsquelle", "code", "erwartet", "erlaubt", "arten", "format"] as const;
const enumNamen = new Set<string>(enumFelder);
const richtung = { S: "debit", H: "credit" } as const;
type Tabelle = Record<string, string>;
type Invers<M extends Tabelle> = { [K in keyof M as M[K]]: K };
type Name<K, M> = K extends keyof M ? M[K] : K;
type EnumFeld = (typeof enumFelder)[number];
type Uebersetze<T, F extends Tabelle, W extends Tabelle, R extends Tabelle, E, D, K = never> =
  T extends Date ? T :
  T extends readonly (infer I)[] ? Uebersetze<I, F, W, R, E, D, K>[] :
  T extends object ? { [P in keyof T as Name<P, F> & PropertyKey]: Uebersetze<T[P], F, W, R, E, D, P> } :
  K extends D ? Name<T, R> : K extends E ? Name<T, W> : T;
export type Englisch<T> = Uebersetze<T, typeof felder, typeof werte, typeof richtung, EnumFeld, "richtung">;
export type Deutsch<T> = Uebersetze<T, Invers<typeof felder>, Invers<typeof werte>, Invers<typeof richtung>, Name<EnumFeld, typeof felder>, "direction">;

export function enumWert<T extends string>(intern: T): Name<T, typeof werte> {
  return name(werte, intern) as Name<T, typeof werte>;
}

/** Die OpenAPI-Enums folgen denselben Namen wie die Antworten. */
export function enumWerte<T extends string>(intern: readonly T[]): Name<T, typeof werte>[] {
  return intern.map(enumWert<T>);
}

/** Katalogschlüssel sind vorgegeben. Eigene Belegfelder haben einen eigenen Namensraum. */
export function istBelegfeld(key: string): boolean {
  return Object.hasOwn(de.katalog, key) || ["cutoff", "nominal", "instrument"].includes(key) || /^custom_[a-z0-9_-]+$/.test(key);
}

const invers = (t: Tabelle): Tabelle => Object.fromEntries(Object.entries(t).map(([k, v]) => [v, k]));
const de = { felder: invers(felder), werte: invers(werte), richtung: invers(richtung), katalog: invers(katalog) };
const en = { felder, werte, richtung, katalog };
const name = (t: Tabelle, k: string) => Object.hasOwn(t, k) ? t[k]! : k;

export function katalogname(k: string, englisch: boolean): string {
  const t = englisch ? en : de;
  return name(t.katalog, k).replace(englisch ? /^eigen_/ : /^custom_/, englisch ? "custom_" : "eigen_");
}

function abbilden(wert: unknown, englisch: boolean, feld = "", katalogfeld = false): unknown {
  const t = englisch ? en : de;
  if (Array.isArray(wert)) return wert.map((w) => abbilden(w, englisch, feld, katalogfeld));
  if (typeof wert === "string") {
    if (katalogfeld) return katalogname(wert, englisch);
    if (feld === "spalte") return name(t.felder, englisch ? wert.toLowerCase() : wert);
    if (feld === "richtung") return name(t.richtung, wert);
    if (enumNamen.has(feld)) return name(t.werte, wert);
    return wert;
  }
  if (!wert || typeof wert !== "object" || wert instanceof Date) return wert;
  if (feld === "werte") return Object.fromEntries(Object.entries(wert).map(([k, v]) => [katalogname(k, englisch), v]));
  // Zusatzfelder der Finanzvorgänge sind freie JSON-Daten. Vorlagenfelder dagegen sind eine Liste.
  if (feld === "felder" && !katalogfeld) return wert;
  return Object.fromEntries(Object.entries(wert).map(([k, v]) => {
    const ziel = name(t.felder, k);
    const intern = englisch ? k : ziel;
    const istKatalog = intern === "schluessel" && ("abschnitt" in wert || "section" in wert || "typ" in wert || "kind" in wert);
    return [ziel, abbilden(v, englisch, intern, istKatalog || intern === "feld" || (intern === "felder" && Array.isArray(v)))];
  }));
}

export function insEnglische<const T>(daten: T): Englisch<T> {
  return abbilden(daten, true) as Englisch<T>;
}

export function insDeutsche<const T>(daten: T): Deutsch<T> {
  return abbilden(daten, false) as Deutsch<T>;
}

/** Ein Feldfehler kann den Pfad bis zu einem einzelnen Belegfeld enthalten. */
export function feldpfad(pfad: string, englisch: boolean): string {
  const t = englisch ? en : de;
  const teile = pfad.split(".");
  return teile.map((k, index) => {
    if (index > 0 && ["werte", "values", "felder", "fields"].includes(teile[index - 1]!)) {
      return katalogname(k, englisch);
    }
    return name(t.felder, k);
  }).join(".");
}
