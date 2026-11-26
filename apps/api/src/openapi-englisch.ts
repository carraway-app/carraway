import type { OpenApiDokument } from "./openapi";

/**
 * Prüfung, dass die öffentliche Schnittstelle englisch bleibt (Issue 182, Entscheidung 520). Geprüft werden im erzeugten OpenAPI-Dokument
 * alle Pfadsegmente, Pfad- und Abfrageparameter sowie die Eigenschaften der Schemata von Parametern und Körpern (rekursiv).
 *
 * Ein Bezeichner gilt als deutsch, wenn er einen Umlaut oder ß enthält, ein Wortbestandteil (camelCase, kebab-case, snake_case getrennt)
 * ein bekanntes deutsches Wort ist, einen deutschen Wortstamm enthält oder die Umschrift `ae` bzw. `oe` trägt. Die Listen decken die
 * Begriffe der Schnittstelle ab, wie sie vor der Umstellung hießen; neue deutsche Wörter fallen über Stämme und Umschrift meist mit auf.
 *
 * Noch nicht umgestellte Bereiche stehen als Pfadpräfixe in einer Ausnahmeliste (Kern: `AUSNAHMEN_KERN`, Erweiterungen: in `ee/api`).
 * Jedes Bereichs-Issue streicht seine Einträge; am Ende ist die Liste leer. Ein Eintrag, der keinen Verstoß mehr deckt, lässt die
 * Prüfung scheitern, damit die Liste nicht veraltet.
 */

/** Deutsche Wörter, die als ganzer Wortbestandteil vorkommen (klein geschrieben, Umlaute umschrieben). */
const DEUTSCHE_WOERTER = new Set(
  (
    "ab abfrage abfragen abgleichen abgrenzung ablauf abruf absage abschlag abschliessen abschnitt abschnitte abstimmung abzug adresse " +
    "aktion aktiv aktuell alle am anbieter andere anhang anker anlegen annahmen anschrift ansicht ansichten anteil anteile anzahl " +
    "arbeitsliste archivieren archiviert art auf aufbewahrung aufgabe aufgaben auflagen aufstockung auftrag aus ausgleich auslesung " +
    "auslesungen ausser ausstieg austritt austritte auswahl auswertung auszahlung auszahlungen basispreis bedingung beenden befund befunde " +
    "beginn beglichen begruendung bemerkung benutzer beobachtung bereich bereiche beschleunigung beschreibung bestaetigen bestaetigt betrag " +
    "betreuung betrieb bezeichnung bezug bis blatt breite buchen darlehen datei dateiname datensatz datum dubletten duplizieren eigene " +
    "eingaben einheit einladung einreichen einrichtung einstellung einstellungen einzelwerte elemente eltern ende entfernen " +
    "entscheidungen ereignis ereignisse erfuellt ergebnis erhoehen erlaubt erledigen erledigt ersetzen ersetzt erwartet externe fachlich " +
    "faelle faellig faktor feld felder firma frist funktion fuss gebuehren gegenstand gelesen geplant gericht gesamt geschaetzt gesperrt " +
    "gesundheit geteilt gewicht gremium groesse grund grundlage gruppe gruppen gruppierung gueltig haupt herausgeber herkunft hinweis hinweise " +
    "ich importieren inhalt jahr jahre je kapital karte karten katalog kategorie kaufpreis klasse koerper kommentar konfig konten konto " +
    "kontrolle kopf korrektur korrigiert kosten kumulierte kurs kurve kurzname laeufe liste listen lokal manuell methode mitglieder " +
    "monate nach nachholen nachname nachweis namen neu neue neuer notiz nummer nur objekt objekte oeffnen offen offene operationen " +
    "optionen ordner organisation organisationen ort partizipierend periode perioden personen pfad pflicht positionen preis protokoll " +
    "pruefen punkte quelle quellen recht rechte regel reihenfolge reserven rhythmus richtung rolle rollen runde runden satz schluessel " +
    "schuldner seit seite seiten selbst sicherheit sicht sitz sonstige sortierung spalte spalten speichern sprache stand stapel stufe " +
    "stufen suche summe summen tabelle tage termin termine texte thema titel typ umgebung ungelesen unternehmen ursprung valuta vergessen vergleich " +
    "verkauf verkauft vertraulich vertretung verwalter verwerfen vor vorgang vorher vorlage vorname vorschau vorschlag wandeln wert werte " +
    "wieder wiederholung wirksam zahlung zahlungen zeile zeitraum ziel ziele zinsen zu zugeteilt zuordnung zusage zusagen zustaendig " +
    "zuteilung zwei dealtyp definitionen erstinvestment extern gevestet insolvenz instrumente investmentmanager investoren kalender " +
    "kappung ki passwort portfolioliste prokura sektor sitzland stundung treuhand trichter varianten vehikel versionen volumen von " +
    "widerrufen befuellen tranchen"
  ).split(" "),
);

/** Endungen deutscher Substantive; sie gelten erst ab sieben Zeichen, damit englische Wörter wie `young` durchgehen. */
const DEUTSCHE_ENDUNGEN = ["ung", "ungen", "keit", "keiten", "schaft", "schaften"];

/** Deutsche Wortstämme, die auch innerhalb zusammengesetzter Wortbestandteile anschlagen (z. B. `kapitalkonto`, `vergleichswaehrung`). */
const DEUTSCHE_STAEMME = (
  "abfrag abruf abschnitt aenderung aktivitaet anteil auflage auftraeg ausschuett auswert beleg bericht beschluss beteilig betrag " +
  "bewegung bewert bezeichn buchhalt buchung darlehen dokument dublette einstellung empfaeng erlaeuter fonds forderung freigab " +
  "gliederung gremi jahres kapital kaufpreis kennzahl konditio kontakt konten kontroll laeuf meilenstein melde mitarbeiter mitteilung " +
  "nummer organisation pruef quartal rechnung rechtsform registerart runde salden schluessel sitzung stichtag storno " +
  "texterkennung umwandel uebernehm ueberschreib uebersicht verknuepf vertrag verzinsung vorgaeng vorlage waehrung wandlung " +
  "wasserfall wechselkurs wiedervorlage wirtschaft zahlung zeichnung zins zugaeng zusammen zusatz zustaendig zuteilung beschlue datum " +
  "wert schreib investition freige gewandelt daten felder klassifik zeile massen meldung mittel berechn sperre postfach preis regel " +
  "projekt quelle angabe rueck schwere szenari jahr wieder zuordnung zurueck stimmung konto"
).split(" ");

/** Englische Wörter mit `oe`, die keine Umschrift sind. */
const OE_ENGLISCH = new Set(["does", "doe", "goes", "shoe", "shoes", "toe", "toes", "canoe"]);

/** Zerlegt einen Bezeichner in klein geschriebene Wortbestandteile (camelCase, kebab-case, snake_case, Punkte). */
export function wortbestandteile(bezeichner: string): string[] {
  return bezeichner
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9äöüÄÖÜß]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

/** Grund, warum ein Bezeichner deutsch ist, sonst `null`. */
export function deutscherBestandteil(bezeichner: string): string | null {
  if (/[äöüÄÖÜß]/.test(bezeichner)) return "Umlaut";
  for (const t of wortbestandteile(bezeichner)) {
    if (DEUTSCHE_WOERTER.has(t)) return `Wort „${t}“`;
    const stamm = DEUTSCHE_STAEMME.find((s) => t.includes(s));
    if (stamm) return `Stamm „${stamm}“ in „${t}“`;
    const endung = t.length >= 7 ? DEUTSCHE_ENDUNGEN.find((e) => t.endsWith(e)) : undefined;
    if (endung) return `Endung „-${endung}“ in „${t}“`;
    if (t.includes("ae")) return `Umschrift „ae“ in „${t}“`;
    if (t.includes("oe") && !OE_ENGLISCH.has(t)) return `Umschrift „oe“ in „${t}“`;
  }
  return null;
}

export interface Verstoss {
  /** `GET /fonds/{id}` */
  operation: string;
  /** Pfad, Parameter oder Eigenschaft samt Lage, z. B. `query zeitraumVon` oder `body betrag`. */
  wo: string;
  bezeichner: string;
  grund: string;
}

type Schema = Record<string, unknown>;

function eigenschaften(schema: unknown, ort: string, aus: (wo: string, name: string) => void, gesehen = new Set<unknown>()) {
  if (!schema || typeof schema !== "object" || gesehen.has(schema)) return;
  gesehen.add(schema);
  if (Array.isArray(schema)) {
    for (const s of schema) eigenschaften(s, ort, aus, gesehen);
    return;
  }
  const s = schema as Schema;
  if (s.properties && typeof s.properties === "object") {
    for (const [name, unter] of Object.entries(s.properties as Schema)) {
      aus(ort, name);
      eigenschaften(unter, ort, aus, gesehen);
    }
  }
  for (const [schluessel, wert] of Object.entries(s)) if (schluessel !== "properties") eigenschaften(wert, ort, aus, gesehen);
}

/** Alle deutschen Bezeichner des Dokuments, je Operation. */
export function findeDeutscheBezeichner(doc: Pick<OpenApiDokument, "paths">): Verstoss[] {
  const verstoesse: Verstoss[] = [];
  for (const [pfad, methoden] of Object.entries(doc.paths)) {
    for (const [methode, op] of Object.entries(methoden)) {
      const operation = `${methode.toUpperCase()} ${pfad}`;
      const pruefe = (wo: string, bezeichner: string) => {
        const grund = deutscherBestandteil(bezeichner);
        if (grund) verstoesse.push({ operation, wo, bezeichner, grund });
      };
      for (const segment of pfad.split("/").filter(Boolean)) pruefe("path", segment.replace(/^\{|\}$/g, ""));
      for (const p of (op.parameters as Schema[] | undefined) ?? []) {
        if (typeof p.name !== "string" || p.in === "header") continue;
        if (p.in !== "path") pruefe(String(p.in), p.name);
        eigenschaften(p.schema, String(p.in), pruefe);
      }
      for (const [typ, inhalt] of Object.entries((op.requestBody as { content?: Record<string, { schema?: unknown }> } | undefined)?.content ?? {})) {
        eigenschaften(inhalt.schema, `body ${typ}`, pruefe);
      }
    }
  }
  return verstoesse;
}

/** Ausnahmen je Bereichs-Issue: Pfadpräfixe im OpenAPI-Format; `{…}` steht für einen beliebigen Pfadparameter. */
export type Ausnahmen = Record<string, readonly string[]>;

const segmente = (pfad: string) => pfad.split("/").filter(Boolean);
const segmentPasst = (muster: string, segment: string) => (muster.startsWith("{") ? segment.startsWith("{") : muster === segment);

/** Längster passender Eintrag für einen Pfad, sonst `undefined`. */
function eintragFuer(pfad: string, eintraege: readonly { praefix: string; bereich: string }[]) {
  const ist = segmente(pfad);
  let treffer: { praefix: string; bereich: string } | undefined;
  for (const e of eintraege) {
    const muster = segmente(e.praefix);
    if (muster.length > ist.length || !muster.every((m, i) => segmentPasst(m, ist[i]!))) continue;
    if (!treffer || muster.length > segmente(treffer.praefix).length) treffer = e;
  }
  return treffer;
}

export interface Pruefergebnis {
  /** Verstöße außerhalb der Ausnahmen: Diese Bezeichner müssen englisch werden. */
  offen: Verstoss[];
  /** Einträge der Ausnahmeliste, die keinen Verstoß mehr decken und gestrichen werden müssen. */
  ueberfluessig: string[];
  /** Gedeckte Verstöße je Bereich (zur Übersicht). */
  gedeckt: Record<string, number>;
}

/** Prüft das Dokument gegen die Ausnahmen. Ein Verstoß gehört zum längsten passenden Präfix; jedes Präfix muss mindestens einen decken. */
export function pruefeEnglisch(doc: Pick<OpenApiDokument, "paths">, ...listen: Ausnahmen[]): Pruefergebnis {
  const eintraege = listen.flatMap((l) => Object.entries(l).flatMap(([bereich, praefixe]) => praefixe.map((praefix) => ({ praefix, bereich }))));
  const benutzt = new Set<string>();
  const gedeckt: Record<string, number> = {};
  const offen: Verstoss[] = [];
  for (const v of findeDeutscheBezeichner(doc)) {
    const e = eintragFuer(v.operation.slice(v.operation.indexOf(" ") + 1), eintraege);
    if (!e) {
      offen.push(v);
      continue;
    }
    benutzt.add(e.praefix);
    gedeckt[e.bereich] = (gedeckt[e.bereich] ?? 0) + 1;
  }
  const ueberfluessig = eintraege.filter((e) => !benutzt.has(e.praefix)).map((e) => `${e.bereich}: ${e.praefix}`);
  return { offen, ueberfluessig, gedeckt };
}

/**
 * Noch nicht englische Bereiche des Kerns, gruppiert nach den Bereichs-Issues von #182. Wer einen Bereich umstellt, streicht seine
 * Einträge. Benennt ein Issue einen gemeinsamen Mount-Punkt um (z. B. `/fonds` → `/funds`), passt es die Präfixe der anderen Bereiche
 * darunter an (`/fonds/{id}/saldenlaeufe` → `/funds/{id}/saldenlaeufe`).
 */
export const AUSNAHMEN_KERN = {} as const satisfies Ausnahmen;
