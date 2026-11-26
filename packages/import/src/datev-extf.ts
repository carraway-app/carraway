import { Decimal } from "@carraway/rechenkern";

/**
 * Schreiber für DATEV-Format, Formatkategorie 21 „Buchungsstapel“ (EXTF), Versionsnummer 700, Formatversion 13.
 *
 * STAND DER PRÜFUNG: Anzahl, Reihenfolge und Grenzen der Felder (31 Kopffelder, 125 Spalten, Belegdatum `TTMM`, Belegfeld 1 bis 36
 * Zeichen aus `A-Z a-z 0-9 $ & % * + - /`, Buchungstext bis 60 Zeichen) sind gegen eine öffentliche Open-Source-Umsetzung samt
 * Beispieldatei abgeglichen, nicht gegen die Seiten von DATEV (nicht abrufbar) und nicht gegen einen echten Import. Die Schreibweise
 * einzelner Überschriften in Zeile 2 und der Schlüssel der Kontenrahmen im Kopf sind offen. Einzelheiten: docs/buchhaltung/datev-extf.md.
 *
 * Format: Windows-1252, Semikolon, Dezimalkomma ohne Tausendertrenner, Zeilenende CR LF, Textfelder in Anführungszeichen. Zeile 1 ist
 * die Kopfzeile mit 31 Feldern, Zeile 2 die Spaltenüberschriften (125 Felder), danach eine Zeile je Buchung, alle Zeilen in voller Breite.
 */

export const EXTF_VERSIONSNUMMER = 700;
export const EXTF_FORMATKATEGORIE = 21;
export const EXTF_FORMATNAME = "Buchungsstapel";
export const EXTF_FORMATVERSION = 13;
/** Kennung im Datensatz (`buchungsexport.format_version`). */
export const EXTF_KENNUNG = `EXTF ${EXTF_VERSIONSNUMMER} / ${EXTF_FORMATNAME} ${EXTF_FORMATVERSION}`;

/** Kleinste zulässige Beraternummer im Kopf. */
export const MIN_BERATERNUMMER = 1001;

/** Die 31 Felder der Kopfzeile in Reihenfolge (Namen nur zur Beschreibung, die Datei trägt keine Namen). */
export const EXTF_KOPFFELDER = [
  "Kennzeichen",
  "Versionsnummer",
  "Formatkategorie",
  "Formatname",
  "Formatversion",
  "Erzeugt am",
  "Importiert",
  "Herkunft",
  "Exportiert von",
  "Importiert von",
  "Berater",
  "Mandant",
  "WJ-Beginn",
  "Sachkontenlänge",
  "Datum vom",
  "Datum bis",
  "Bezeichnung",
  "Diktatkürzel",
  "Buchungstyp",
  "Rechnungslegungszweck",
  "Festschreibung",
  "WKZ",
  "reserviert 23",
  "Derivatskennzeichen",
  "reserviert 25",
  "reserviert 26",
  "SKR",
  "Branchenlösung-Id",
  "reserviert 29",
  "reserviert 30",
  "Anwendungsinformation",
] as const;

const beleginfo = Array.from({ length: 8 }, (_, i) => [`Beleginfo – Art ${i + 1}`, `Beleginfo – Inhalt ${i + 1}`]).flat();
const zusatz = Array.from({ length: 20 }, (_, i) => [`Zusatzinformation – Art ${i + 1}`, `Zusatzinformation – Inhalt ${i + 1}`]).flat();

/** Die 125 Spaltenüberschriften der Zeile 2. */
export const EXTF_SPALTEN: readonly string[] = [
  "Umsatz (ohne Soll/Haben-Kz)",
  "Soll/Haben-Kennzeichen",
  "WKZ Umsatz",
  "Kurs",
  "Basisumsatz",
  "WKZ Basisumsatz",
  "Konto",
  "Gegenkonto (ohne BU-Schlüssel)",
  "BU-Schlüssel",
  "Belegdatum",
  "Belegfeld 1",
  "Belegfeld 2",
  "Skonto",
  "Buchungstext",
  "Postensperre",
  "Diverse Adressnummer",
  "Geschäftspartnerbank",
  "Sachverhalt",
  "Zinssperre",
  "Beleglink",
  ...beleginfo,
  "KOST1 – Kostenstelle",
  "KOST2 – Kostenstelle",
  "Kost Menge",
  "EU-Land u. USt-IdNr.",
  "EU-Steuersatz",
  "Abw. Versteuerungsart",
  "Sachverhalt L+L",
  "Funktionsergänzung L+L",
  "BU 49 Hauptfunktionstyp",
  "BU 49 Hauptfunktionsnummer",
  "BU 49 Funktionsergänzung",
  ...zusatz,
  "Stück",
  "Gewicht",
  "Zahlweise",
  "Forderungsart",
  "Veranlagungsjahr",
  "Zugeordnete Fälligkeit",
  "Skontotyp",
  "Auftragsnummer",
  "Buchungstyp",
  "USt-Schlüssel (Anzahlungen)",
  "EU-Mitgliedstaat (Anzahlungen)",
  "Sachverhalt L+L (Anzahlungen)",
  "EU-Steuersatz (Anzahlungen)",
  "Erlöskonto (Anzahlungen)",
  "Herkunft-Kz",
  "Leerfeld",
  "KOST-Datum",
  "SEPA-Mandatsreferenz",
  "Skontosperre",
  "Gesellschaftername",
  "Beteiligtennummer",
  "Identifikationsnummer",
  "Zeichnernummer",
  "Postensperre bis",
  "Bezeichnung SoBil-Sachverhalt",
  "Kennzeichen SoBil-Buchung",
  "Festschreibung",
  "Leistungsdatum",
  "Datum Zuord.Steuerperiode",
  "Fälligkeit",
  "Generalumkehr (GU)",
  "Steuersatz",
  "Land",
  "Abrechnungsreferenz",
  "BVV-Position",
  "EU-Mitgliedstaat u. UStID (Ursprung)",
  "EU-Steuersatz (Ursprung)",
  "Abw. Skontokonto",
];

export const MAX_BELEGFELD1 = 36;
export const MAX_BUCHUNGSTEXT = 60;
export const MAX_STAPELBEZEICHNUNG = 30;

// Windows-1252 ----------------------------------------------------------------------------------------------------------

/** Zeichen im Bereich 0x80 bis 0x9F, in dem sich Windows-1252 von Latin-1 unterscheidet. */
const CP1252_OBEN: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e,
  "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

/** Kodiert nach Windows-1252. Nicht darstellbare Zeichen werden `?` und in `nichtDarstellbar` gemeldet. */
export function kodiereWindows1252(text: string): { bytes: Uint8Array; nichtDarstellbar: string[] } {
  const bytes: number[] = [];
  const fehlend = new Set<string>();
  for (const z of text) {
    const cp = z.codePointAt(0)!;
    if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) bytes.push(cp);
    else if (CP1252_OBEN[z] !== undefined) bytes.push(CP1252_OBEN[z]!);
    else {
      bytes.push(0x3f);
      fehlend.add(z);
    }
  }
  return { bytes: Uint8Array.from(bytes), nichtDarstellbar: [...fehlend] };
}

// Schreiben --------------------------------------------------------------------------------------------------------------

export interface ExtfKopf {
  /** Berater- und Mandantennummer (ganze Zahlen). */
  berater: number;
  mandant: number;
  /** Beginn des Wirtschaftsjahres als Datum (`JJJJ-MM-TT`). */
  wirtschaftsjahrBeginn: string;
  sachkontenlaenge: number;
  datumVon: string;
  datumBis: string;
  bezeichnung: string;
  erzeugtAm: Date;
}

export interface ExtfBuchung {
  /** Betrag mit Vorzeichen; ein negativer Betrag wird als positiver Umsatz mit vertauschtem Soll/Haben-Kennzeichen geschrieben. */
  betrag: string;
  /** Seite des Kontos, wenn der Betrag positiv ist. */
  richtung: "S" | "H";
  konto: string;
  gegenkonto: string;
  buSchluessel: string | null;
  belegdatum: string;
  belegfeld1: string;
  buchungstext: string;
}

export interface ExtfProblem {
  code: "EXPORT_KONTO_LAENGE" | "EXPORT_BELEGFELD_UNGUELTIG" | "EXPORT_ZEICHEN_NICHT_DARSTELLBAR" | "EXPORT_ZEITRAUM_ZU_GROSS" | "EXPORT_BETRAG_NULL";
  zeile: number | null;
  params: Record<string, string | number>;
}

export interface ExtfErgebnis {
  bytes: Uint8Array;
  text: string;
  anzahl: number;
  probleme: ExtfProblem[];
}

const text = (w: string) => `"${w.replaceAll('"', '""')}"`;
const jjjjmmtt = (iso: string) => iso.replaceAll("-", "");
const ddmm = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}`;
const zeitstempel = (d: Date) => {
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}${p(d.getUTCMilliseconds(), 3)}`;
};
const komma = (d: Decimal) => d.toFixed(2).replace(".", ",");

/** Erlaubte Zeichen für Belegfeld 1 (Buchstaben, Ziffern und `$ & % * + - /`), höchstens 36. */
export const BELEGFELD_ERLAUBT = /^[A-Za-z0-9$&%*+\-/]{1,36}$/;

/** Kopfzeile (Zeile 1) als Feldliste, Textfelder bereits in Anführungszeichen. */
export function extfKopfzeile(k: ExtfKopf): string[] {
  const felder: string[] = new Array(31).fill("");
  felder[0] = text("EXTF");
  felder[1] = String(EXTF_VERSIONSNUMMER);
  felder[2] = String(EXTF_FORMATKATEGORIE);
  felder[3] = text(EXTF_FORMATNAME);
  felder[4] = String(EXTF_FORMATVERSION);
  felder[5] = zeitstempel(k.erzeugtAm);
  felder[7] = text("CA");
  felder[8] = text("Carraway");
  felder[10] = String(k.berater);
  felder[11] = String(k.mandant);
  felder[12] = jjjjmmtt(k.wirtschaftsjahrBeginn);
  felder[13] = String(k.sachkontenlaenge);
  felder[14] = jjjjmmtt(k.datumVon);
  felder[15] = jjjjmmtt(k.datumBis);
  felder[16] = text(k.bezeichnung.slice(0, MAX_STAPELBEZEICHNUNG));
  felder[18] = "1";
  felder[19] = "0";
  felder[20] = "0";
  felder[21] = text("EUR");
  felder[30] = text("Carraway");
  return felder;
}

/** Eine Datenzeile in voller Breite (125 Felder). */
export function extfZeile(b: ExtfBuchung): string[] {
  const betrag = new Decimal(b.betrag);
  const kennzeichen = betrag.isNegative() ? (b.richtung === "S" ? "H" : "S") : b.richtung;
  const felder: string[] = new Array(EXTF_SPALTEN.length).fill("");
  felder[0] = komma(betrag.abs());
  felder[1] = text(kennzeichen);
  felder[2] = text("EUR");
  felder[6] = b.konto;
  felder[7] = b.gegenkonto;
  felder[8] = b.buSchluessel ?? "";
  felder[9] = ddmm(b.belegdatum);
  felder[10] = text(b.belegfeld1);
  felder[13] = text(b.buchungstext.slice(0, MAX_BUCHUNGSTEXT));
  return felder;
}

/**
 * Schreibt die Datei. Probleme (Kontolänge, Belegfeld, nicht darstellbare Zeichen, Zeitraum über zwölf Monate wegen des Belegdatums
 * ohne Jahr) werden gemeldet; der Aufrufer entscheidet, ob er trotzdem ausliefert. Beträge von null werden nicht geschrieben.
 */
export function schreibeExtf(kopf: ExtfKopf, buchungen: ExtfBuchung[]): ExtfErgebnis {
  const probleme: ExtfProblem[] = [];
  const von = new Date(`${kopf.datumVon}T00:00:00Z`);
  const bis = new Date(`${kopf.datumBis}T00:00:00Z`);
  const monate = (bis.getUTCFullYear() - von.getUTCFullYear()) * 12 + bis.getUTCMonth() - von.getUTCMonth();
  if (monate >= 12) probleme.push({ code: "EXPORT_ZEITRAUM_ZU_GROSS", zeile: null, params: { von: kopf.datumVon, bis: kopf.datumBis } });
  const zeilen: string[] = [extfKopfzeile(kopf).join(";"), EXTF_SPALTEN.join(";")];
  let n = 0;
  buchungen.forEach((b, i) => {
    const zeile = i + 3;
    if (new Decimal(b.betrag).isZero()) {
      probleme.push({ code: "EXPORT_BETRAG_NULL", zeile, params: { belegfeld: b.belegfeld1 } });
      return;
    }
    for (const k of [b.konto, b.gegenkonto]) {
      if (k.length !== kopf.sachkontenlaenge) probleme.push({ code: "EXPORT_KONTO_LAENGE", zeile, params: { konto: k, erwartet: kopf.sachkontenlaenge } });
    }
    if (!BELEGFELD_ERLAUBT.test(b.belegfeld1)) probleme.push({ code: "EXPORT_BELEGFELD_UNGUELTIG", zeile, params: { belegfeld: b.belegfeld1 } });
    zeilen.push(extfZeile(b).join(";"));
    n += 1;
  });
  const inhalt = `${zeilen.join("\r\n")}\r\n`;
  const { bytes, nichtDarstellbar } = kodiereWindows1252(inhalt);
  if (nichtDarstellbar.length) probleme.push({ code: "EXPORT_ZEICHEN_NICHT_DARSTELLBAR", zeile: null, params: { zeichen: nichtDarstellbar.join("") } });
  return { bytes, text: inhalt, anzahl: n, probleme };
}
