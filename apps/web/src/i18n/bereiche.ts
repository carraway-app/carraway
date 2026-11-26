import type { Sprache } from "@carraway/ui";
import { alle } from "../erweiterung";

/**
 * Die großen Wörterbücher je Bereich. Der Rahmen (`kern.de.ts`, `kern.en.ts`) enthält nur, was Start, Anmeldung und Navigation brauchen; ein
 * Bereich (ein oder mehrere Abschnitte der ersten Ebene von `Texte`) kommt als eigenes Paket mit der Seite, die ihn braucht: Der Router lädt die Bereiche
 * einer Adresse vor dem Zeichnen (`bereicheFuerPfad`), damit nie Schlüssel statt Texte aufblitzen. Wer doch einen noch nicht geladenen Bereich liest, hält
 * die Darstellung an (Suspense), bis er da ist.
 */
export const BEREICHE = [
  "buchhaltung",
  "datenuebernahme",
  "dokumente",
  "fondsStamm",
  "kennzahlen",
  "mail",
  "melde",
  "register",
  "szenarien",
  "verwaltung",
  "berichte",
  "runden",
  "instrumente",
  "kontaktimport",
  "journal",
  "stamm",
  "konto",
  "crm",
  "zusatz",
  "waehrung",
  "fehlertexte",
] as const;
export type Bereich = (typeof BEREICHE)[number];

/** Ein geladener Bereich: seine Abschnitte und Fehlertexte (kommen in `fehler`; nur der Bereich `fehlertexte` bringt welche). */
export interface Paket {
  abschnitte: Record<string, object>;
  fehler?: Record<string, string>;
}

type Lader = Record<Sprache, () => Promise<Paket>>;

/** Welche Abschnitte der ersten Ebene von `Texte` ein Bereich liefert (für die Hülle, die einen fehlenden Abschnitt erkennt). */
export const ABSCHNITTE: Record<Bereich, readonly string[]> = {
  buchhaltung: ["buchhaltung"],
  datenuebernahme: ["datenuebernahme"],
  dokumente: ["dokumente"],
  fondsStamm: ["fondsStamm"],
  kennzahlen: ["kennzahlen"],
  mail: ["mail"],
  melde: ["melde"],
  register: ["register"],
  szenarien: ["szenarien"],
  verwaltung: ["verwaltung"],
  berichte: ["bericht", "vorlagen", "berichte"],
  runden: ["finanzierungsrunden", "runde", "wasserfall", "kapital", "mitarbeiter", "bewertungen"],
  instrumente: ["zinslauf", "zinslaeufe", "inst", "zinsmethode", "zinsperiode", "massgeblich", "vorgangForm", "stornoForm", "konditionForm", "instrumentForm", "trancheForm", "instrumenteAbschnitt", "zinsenAbschnitt", "fondsZinsen", "erfuelltForm", "ueberschussForm", "forderungForm", "wandlungForm", "verkaufForm", "verkaufStorno", "anpassungForm", "insolvenzForm", "geplanteBeteiligung", "abgrenzung"],
  kontaktimport: ["kontaktimport", "zusammenfuehren"],
  journal: ["journal"],
  konto: ["anmeldung", "zweiFaktor", "passwort", "einrichtung"],
  stamm: ["fondsVerwaltung", "tabs", "rundenRolle", "organisationArt", "beteiligungStatus", "aktivitaetArt", "beschlussErgebnis", "dealStatus", "foerderSchluessel", "person", "personForm", "aktivitaetForm", "aktivitaeten", "bewertungMethode", "kontaktRolle", "vorgangArt", "absage", "rechte", "dealPhase", "instrument", "auswahl", "kontakte", "beteiligung", "portfolio", "bewegungen", "deal", "auswertungPlus", "auswertung", "beschlussvorlagen", "beziehungen", "dealflow", "organisation", "organisationForm", "neuerDeal", "beschlussvorschlag", "uebernahme", "rollen", "beschlussForm", "personDubletten", "dubletten"],
  crm: ["crm"],
  zusatz: ["zusatzfelder"],
  waehrung: ["waehrung"],
  fehlertexte: [],
};

export const BEREICH_LADER: Record<Bereich, Lader> = {
  buchhaltung: {
    de: () => import("./buchhaltung").then((m) => ({ abschnitte: { buchhaltung: m.buchhaltungDe } })),
    en: () => import("./buchhaltung.en").then((m) => ({ abschnitte: { buchhaltung: m.buchhaltungEn } })),
  },
  datenuebernahme: {
    de: () => import("./datenuebernahme").then((m) => ({ abschnitte: { datenuebernahme: m.datenuebernahmeDe } })),
    en: () => import("./datenuebernahme.en").then((m) => ({ abschnitte: { datenuebernahme: m.datenuebernahmeEn } })),
  },
  dokumente: {
    de: () => import("./dokumente").then((m) => ({ abschnitte: { dokumente: m.dokumenteDe } })),
    en: () => import("./dokumente.en").then((m) => ({ abschnitte: { dokumente: m.dokumenteEn } })),
  },
  fondsStamm: {
    de: () => import("./bereich.fonds-stamm").then((m) => ({ abschnitte: { fondsStamm: m.fondsStammDe } })),
    en: () => import("./bereich.fonds-stamm.en").then((m) => ({ abschnitte: { fondsStamm: m.fondsStammEn } })),
  },
  kennzahlen: {
    de: () => import("./kennzahlen").then((m) => ({ abschnitte: { kennzahlen: m.kennzahlenDe } })),
    en: () => import("./kennzahlen.en").then((m) => ({ abschnitte: { kennzahlen: m.kennzahlenEn } })),
  },
  mail: {
    de: () => import("./mail").then((m) => ({ abschnitte: { mail: m.mailDe } })),
    en: () => import("./mail.en").then((m) => ({ abschnitte: { mail: m.mailEn } })),
  },
  melde: {
    de: () => import("./melde").then((m) => ({ abschnitte: { melde: m.meldeDe } })),
    en: () => import("./melde.en").then((m) => ({ abschnitte: { melde: m.meldeEn } })),
  },
  register: {
    de: () => import("./register").then((m) => ({ abschnitte: { register: m.registerDe } })),
    en: () => import("./register.en").then((m) => ({ abschnitte: { register: m.registerEn } })),
  },
  szenarien: {
    de: () => import("./szenarien").then((m) => ({ abschnitte: { szenarien: m.szenarienDe } })),
    en: () => import("./szenarien.en").then((m) => ({ abschnitte: { szenarien: m.szenarienEn } })),
  },
  verwaltung: {
    de: () => import("./verwaltung").then((m) => ({ abschnitte: { verwaltung: m.verwaltungDe } })),
    en: () => import("./verwaltung.en").then((m) => ({ abschnitte: { verwaltung: m.verwaltungEn } })),
  },
  berichte: {
    de: () => import("./bereich.berichte").then((m) => ({ abschnitte: m.berichteBereichDe })),
    en: () => import("./bereich.berichte.en").then((m) => ({ abschnitte: m.berichteBereichEn })),
  },
  runden: {
    de: () => import("./bereich.runden").then((m) => ({ abschnitte: m.rundenBereichDe })),
    en: () => import("./bereich.runden.en").then((m) => ({ abschnitte: m.rundenBereichEn })),
  },
  instrumente: {
    de: () => import("./bereich.instrumente").then((m) => ({ abschnitte: m.instrumenteBereichDe })),
    en: () => import("./bereich.instrumente.en").then((m) => ({ abschnitte: m.instrumenteBereichEn })),
  },
  kontaktimport: {
    de: () => import("./bereich.kontaktimport").then((m) => ({ abschnitte: m.kontaktimportBereichDe })),
    en: () => import("./bereich.kontaktimport.en").then((m) => ({ abschnitte: m.kontaktimportBereichEn })),
  },
  journal: {
    de: () => import("./bereich.journal").then((m) => ({ abschnitte: m.journalBereichDe })),
    en: () => import("./bereich.journal.en").then((m) => ({ abschnitte: m.journalBereichEn })),
  },
  konto: {
    de: () => import("./bereich.konto").then((m) => ({ abschnitte: m.kontoBereichDe })),
    en: () => import("./bereich.konto.en").then((m) => ({ abschnitte: m.kontoBereichEn })),
  },
  stamm: {
    de: () => import("./bereich.stamm").then((m) => ({ abschnitte: m.stammBereichDe })),
    en: () => import("./bereich.stamm.en").then((m) => ({ abschnitte: m.stammBereichEn })),
  },
  crm: {
    de: () => import("./bereich.crm").then((m) => ({ abschnitte: m.crmBereichDe })),
    en: () => import("./bereich.crm.en").then((m) => ({ abschnitte: m.crmBereichEn })),
  },
  zusatz: {
    de: () => import("./bereich.zusatz").then((m) => ({ abschnitte: m.zusatzBereichDe })),
    en: () => import("./bereich.zusatz.en").then((m) => ({ abschnitte: m.zusatzBereichEn })),
  },
  waehrung: {
    de: () => import("./bereich.waehrung").then((m) => ({ abschnitte: m.waehrungBereichDe })),
    en: () => import("./bereich.waehrung.en").then((m) => ({ abschnitte: m.waehrungBereichEn })),
  },
  // Alle Fehlertexte der API außerhalb des Rahmens: die allgemeinen und die der Bereiche (in eigenen kleinen Modulen, ohne die Bereichs-Wörterbücher).
  fehlertexte: {
    de: () =>
      Promise.all([import("./fehlertexte"), import("./fehler.buchhaltung"), import("./fehler.crm"), import("./fehler.dokumente"), import("./fehler.mail"), import("./fehler.register"), import("./fehler.szenarien"), import("./fehler.waehrung")]).then(
        ([allgemein, buchhaltung, crm, dokumente, mail, register, szenarien, waehrung]) => ({
          abschnitte: {},
          fehler: { ...crm.crmFehlerDe, ...buchhaltung.buchhaltungFehlerDe, ...allgemein.fehlertexteDe, ...dokumente.dokumenteFehlerDe, ...mail.mailFehlerDe, ...register.registerFehlerDe, ...szenarien.szenarienFehlerDe, ...waehrung.waehrungFehlerDe },
        }),
      ),
    en: () =>
      Promise.all([import("./fehlertexte.en"), import("./fehler.buchhaltung.en"), import("./fehler.crm.en"), import("./fehler.dokumente.en"), import("./fehler.mail.en"), import("./fehler.register.en"), import("./fehler.szenarien.en"), import("./fehler.waehrung.en")]).then(
        ([allgemein, buchhaltung, crm, dokumente, mail, register, szenarien, waehrung]) => ({
          abschnitte: {},
          fehler: { ...crm.crmFehlerEn, ...buchhaltung.buchhaltungFehlerEn, ...allgemein.fehlertexteEn, ...dokumente.dokumenteFehlerEn, ...mail.mailFehlerEn, ...register.registerFehlerEn, ...szenarien.szenarienFehlerEn, ...waehrung.waehrungFehlerEn },
        }),
      ),
  },
};

/**
 * Name eines Bereichs: einer des Kerns oder ein Textbereich einer Erweiterung (`erweiterung.ts`, Punkt `texte`). Die Erweiterungen bringen ihre
 * Wörterbücher selbst mit; der Kern kennt nur ihre Namen zur Laufzeit.
 */
export type BereichName = Bereich | (string & {});

/** Lader eines Bereichs (Kern oder Erweiterung); `undefined` für unbekannte Namen. */
export function laderFuer(bereich: BereichName): Lader | undefined {
  if ((BEREICHE as readonly string[]).includes(bereich)) return BEREICH_LADER[bereich as Bereich];
  const zusatz = alle("texte").find((t) => t.name === bereich);
  return zusatz ? { de: () => zusatz.lader.de().then((abschnitte) => ({ abschnitte })), en: () => zusatz.lader.en().then((abschnitte) => ({ abschnitte })) } : undefined;
}

/** Der Bereich, der einen Abschnitt der ersten Ebene liefert (`null`, wenn der Abschnitt zum Rahmen gehört). */
const BEREICH_VON_ABSCHNITT = new Map<string, Bereich>(BEREICHE.flatMap((b) => ABSCHNITTE[b].map((a): [string, Bereich] => [a, b])));
export const bereichVonAbschnitt = (name: string): BereichName | null => BEREICH_VON_ABSCHNITT.get(name) ?? alle("texte").find((t) => t.abschnitte.includes(name))?.name ?? null;

/**
 * Welche Bereiche eine Seite braucht, samt der Dialoge, die sie öffnen kann. Ermittelt aus den Importen der Seiten (jeder Abschnitt, der in der Seite oder
 * ihren Bausteinen gelesen wird); `bereiche.test.ts` rendert die Seiten ohne vorab geladene Bereiche und meldet jeden, der nachgeladen werden musste.
 */
const SEITEN: [RegExp, readonly Bereich[]][] = [
  [/^\/(anmelden|einrichtung|passwort-vergessen|passwort-setzen|passwort-aendern|zwei-faktor-einrichten)\/?$/, ["konto"]],
  [/^\/dealflow\/?$/, ["crm", "stamm"]],
  [/^\/(dealflow\/auswertung|beschlussvorlagen|wiedervorlagen)\/?$/, ["stamm"]],
  [/^\/fonds\/?$/, ["buchhaltung", "journal", "fondsStamm", "stamm", "instrumente", "runden", "dokumente", "zusatz", "verwaltung", "konto", "mail", "berichte"]],
  [/^\/fonds\/[^/]+\/?$/, ["berichte", "crm", "dokumente", "instrumente", "kennzahlen", "mail", "melde", "runden", "szenarien", "stamm", "waehrung", "zusatz"]],
  [/^\/fonds\/[^/]+\/kennzahlen\/?$/, ["kennzahlen", "mail", "stamm"]],
  [/^\/fonds\/[^/]+\/meldungen\/?$/, ["melde", "stamm"]],
  [/^\/meldungen\/[^/]+\/?$/, ["instrumente", "kennzahlen", "melde", "stamm"]],
  [/^\/fonds\/[^/]+\/szenarien\/?$/, ["kennzahlen", "runden", "szenarien", "stamm"]],
  [/^\/fonds\/[^/]+\/reserven\/?$/, ["runden", "szenarien", "stamm"]],
  [/^\/fonds\/[^/]+\/zinsen\/?$/, ["instrumente", "stamm"]],
  [/^\/fonds\/[^/]+\/bewertungsrunde\/?$/, ["runden", "stamm"]],
  [/^\/fonds\/[^/]+\/journal\/?$/, ["buchhaltung", "instrumente", "journal", "stamm"]],
  [/^\/organisationen\/[^/]+\/?$/, ["crm", "dokumente", "kontaktimport", "mail", "register", "runden", "stamm"]],
  [/^\/deals\/[^/]+\/?$/, ["crm", "dokumente", "mail", "runden", "stamm"]],
  [/^\/register\/?$/, ["register", "stamm"]],
  [/^\/kontakte\/?$/, ["crm", "kontaktimport", "mail", "stamm"]],
  [/^\/personen\/[^/]+\/?$/, ["crm", "kontaktimport", "mail", "stamm"]],
  [/^\/kontakte\/import\/?$/, ["kontaktimport", "stamm"]],
  [/^\/beteiligungen\/[^/]+\/?$/, ["buchhaltung", "crm", "dokumente", "instrumente", "kennzahlen", "mail", "register", "runden", "stamm", "waehrung", "zusatz"]],
  [/^\/dokumente\/[^/]+\/?$/, ["dokumente", "runden", "stamm"]],
  [/^\/berichte\/?$/, ["berichte", "stamm"]],
  [/^\/berichte\/vorlagen\/?$/, ["berichte", "kennzahlen", "stamm"]],
  [/^\/berichte\/[^/]+\/?$/, ["berichte", "stamm"]],
  [/^\/zinslaeufe\/?$/, ["instrumente", "stamm"]],
  [/^\/zinslaeufe\/[^/]+\/?$/, ["buchhaltung", "instrumente", "stamm"]],
  [/^\/belege(\/[^/]+)?\/?$/, ["buchhaltung", "stamm"]],
  [/^\/buchhaltung\/?$/, ["buchhaltung", "journal", "melde", "stamm"]],
  [/^\/import(\/[^/]+)?\/?$/, ["datenuebernahme", "stamm"]],
  [/^\/einstellungen\/postfach\/?$/, ["berichte", "konto", "mail", "stamm"]],
  [/^\/verwaltung\/mail\/?$/, ["mail", "stamm"]],
  [/^\/verwaltung\/?$/, ["datenuebernahme", "kennzahlen", "konto", "melde", "verwaltung", "stamm", "waehrung"]],
];

/** Seiten ohne Anmeldung: Sie brauchen nur den Rahmen, die Fehlertexte der übrigen Seiten kommen erst nach der Anmeldung. */
const OHNE_ANMELDUNG = /^\/(anmelden|einrichtung|passwort-vergessen|passwort-setzen|passwort-aendern|zwei-faktor-einrichten)\/?$/;

/** Bereiche, die der Rahmen und die Seite zur Adresse brauchen (für unbekannte Adressen nur die Fehlertexte), samt Textbereichen der Erweiterungen. */
export function bereicheFuerPfad(pfad: string): readonly BereichName[] {
  const seite: BereichName[] = [...(SEITEN.find(([muster]) => muster.test(pfad))?.[1] ?? [])];
  for (const t of alle("texte")) {
    for (const k of t.kernBereiche ?? []) if (k.muster.test(pfad)) for (const b of k.bereiche) if (!seite.includes(b)) seite.push(b);
    if (t.seiten.some((muster) => muster.test(pfad))) seite.push(t.name);
  }
  return OHNE_ANMELDUNG.test(pfad) ? seite : [...seite, "fehlertexte"];
}
