/**
 * Kursdateien lesen (Etappe 21): nur Dateien, die jemand hochlädt oder einfügt, kein Abruf aus dem Netz. Zwei Aufbauten werden erkannt:
 *
 * 1. **EZB-Aufbau (breit)**, wie die Referenzkurs-Datei der EZB: Kopfzeile `Date,USD,JPY,…` (erste Spalte `Date` oder `Datum`, danach Währungscodes), je Zeile ein Tag
 *    im Format `JJJJ-MM-TT` und je Währung der Kurs in Einheiten der Währung je 1 EUR; `N/A` und leere Felder bedeuten „kein Kurs an diesem Tag“; ein Komma am Zeilenende
 *    ist erlaubt. Basis ist immer EUR.
 * 2. **Langer Aufbau**: eine Zeile je Kurs mit den Spalten `Datum` (oder `Date`), `Basis` (`Base`), `Quote` (`Waehrung`, `Currency`) und `Kurs` (`Rate`). Das Datum steht als
 *    `JJJJ-MM-TT` oder `TT.MM.JJJJ`, der Kurs mit Punkt oder (bei Semikolon als Trennzeichen) Komma als Dezimalzeichen.
 *
 * Trennzeichen (Komma, Semikolon, Tabulator) werden an der Kopfzeile erkannt. Kurse haben höchstens acht Nachkommastellen und sind größer als null.
 */

export interface KursEintrag {
  datum: string;
  basis: string;
  quote: string;
  kurs: string;
}

const KURSDATEI_FEHLER = {
  empty_file: () => "The file is empty",
  invalid_header: () => "Expected Date,USD,… (ECB layout) or Date;Base;Quote;Rate",
  invalid_date: (value: string) => `Invalid date “${value}”`,
  invalid_rate: (value: string) => `Invalid rate “${value}”`,
  invalid_rate_for_currency: (value: string) => `Invalid rate for ${value}`,
  invalid_currency_pair: (value: string) => `Invalid currency pair “${value}”`,
  conflicting_rates: (value: string) => `The file contains different rates for ${value}`,
} as const;

export type KursdateiFehlercode = keyof typeof KURSDATEI_FEHLER;

export interface Dateifehler {
  zeile: number;
  meldung: string;
  code: KursdateiFehlercode;
  wert: string;
}

const dateifehler = (zeile: number, code: KursdateiFehlercode, wert = ""): Dateifehler => ({
  zeile, code, wert, meldung: KURSDATEI_FEHLER[code](wert),
});

export interface GeleseneKurse {
  format: "ezb" | "lang";
  eintraege: KursEintrag[];
  fehler: Dateifehler[];
  /** Anzahl der Datenzeilen (ohne Kopf und Leerzeilen). */
  zeilen: number;
}

const KURS = /^\d{1,10}(\.\d{1,8})?$/;
const CODE = /^[A-Z]{3}$/;

function trenner(kopf: string): string {
  const zaehle = (z: string) => kopf.split(z).length - 1;
  const kandidaten = [",", ";", "\t"].map((z) => [z, zaehle(z)] as const).sort((a, b) => b[1] - a[1]);
  return kandidaten[0]![1] > 0 ? kandidaten[0]![0] : ",";
}

function datum(roh: string): string | null {
  const t = roh.trim();
  let iso: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) iso = t;
  else {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(t);
    if (m) iso = `${m[3]}-${m[2]}-${m[1]}`;
  }
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

function kurs(roh: string, komma: boolean): string | null {
  let t = roh.trim();
  if (komma) t = t.replace(/\./g, "").replace(",", ".");
  return KURS.test(t) && Number(t) > 0 ? t : null;
}

const SPALTEN: Record<string, "datum" | "basis" | "quote" | "kurs"> = { datum: "datum", date: "datum", basis: "basis", base: "basis", quote: "quote", waehrung: "quote", "währung": "quote", currency: "quote", nach: "quote", kurs: "kurs", rate: "kurs" };

/** Liest eine Kursdatei; Fehler stehen je Zeile, ein gelesener Eintrag ist immer gültig. */
export function leseKursdatei(inhalt: string): GeleseneKurse {
  const text = inhalt.replace(/^\uFEFF/, "");
  const zeilen = text.split(/\r\n|\n|\r/);
  const ersteNummer = zeilen.findIndex((z) => z.trim() !== "");
  if (ersteNummer === -1) return { format: "lang", eintraege: [], fehler: [dateifehler(1, "empty_file")], zeilen: 0 };
  const kopfZeile = zeilen[ersteNummer]!;
  const t = trenner(kopfZeile);
  const kopf = kopfZeile.split(t).map((z) => z.trim().replace(/^"|"$/g, ""));
  const fehler: Dateifehler[] = [];
  const eintraege: KursEintrag[] = [];
  const gesehen = new Map<string, string>();
  let daten = 0;
  const aufnehmen = (nr: number, e: KursEintrag) => {
    const schluessel = `${e.datum}|${e.basis}|${e.quote}`;
    const vorher = gesehen.get(schluessel);
    if (vorher !== undefined) {
      if (Number(vorher) !== Number(e.kurs)) fehler.push(dateifehler(nr, "conflicting_rates", `${e.basis}/${e.quote} (${e.datum})`));
      return;
    }
    gesehen.set(schluessel, e.kurs);
    eintraege.push(e);
  };

  const erste = kopf[0]!.toLowerCase();
  if ((erste === "date" || erste === "datum") && kopf.slice(1).filter((c) => c !== "").every((c) => CODE.test(c)) && kopf.length > 1 && !kopf.slice(1).some((c) => SPALTEN[c.toLowerCase()])) {
    for (let i = ersteNummer + 1; i < zeilen.length; i++) {
      if (zeilen[i]!.trim() === "") continue;
      daten++;
      const zellen = zeilen[i]!.split(t).map((z) => z.trim().replace(/^"|"$/g, ""));
      const tag = datum(zellen[0] ?? "");
      if (!tag) {
        fehler.push(dateifehler(i + 1, "invalid_date", zellen[0]));
        continue;
      }
      for (let c = 1; c < kopf.length; c++) {
        const code = kopf[c]!;
        const wert = zellen[c] ?? "";
        if (code === "" || wert === "" || wert.toUpperCase() === "N/A") continue;
        const k = kurs(wert, t === ";");
        if (!k) fehler.push(dateifehler(i + 1, "invalid_rate_for_currency", `${code} (${wert})`));
        else if (code === "EUR") fehler.push(dateifehler(i + 1, "invalid_currency_pair", "EUR/EUR"));
        else aufnehmen(i + 1, { datum: tag, basis: "EUR", quote: code, kurs: k });
      }
    }
    return { format: "ezb", eintraege, fehler, zeilen: daten };
  }

  const spalte: Partial<Record<"datum" | "basis" | "quote" | "kurs", number>> = {};
  kopf.forEach((c, i) => {
    const art = SPALTEN[c.toLowerCase()];
    if (art && spalte[art] === undefined) spalte[art] = i;
  });
  if (spalte.datum === undefined || spalte.basis === undefined || spalte.quote === undefined || spalte.kurs === undefined) {
    return {
      format: "lang",
      eintraege: [],
      fehler: [dateifehler(ersteNummer + 1, "invalid_header")],
      zeilen: 0,
    };
  }
  for (let i = ersteNummer + 1; i < zeilen.length; i++) {
    if (zeilen[i]!.trim() === "") continue;
    daten++;
    const zellen = zeilen[i]!.split(t).map((z) => z.trim().replace(/^"|"$/g, ""));
    const tag = datum(zellen[spalte.datum] ?? "");
    const basis = (zellen[spalte.basis] ?? "").toUpperCase();
    const quote = (zellen[spalte.quote] ?? "").toUpperCase();
    const k = kurs(zellen[spalte.kurs] ?? "", t === ";");
    if (!tag) fehler.push(dateifehler(i + 1, "invalid_date", zellen[spalte.datum]));
    else if (!CODE.test(basis) || !CODE.test(quote) || basis === quote) fehler.push(dateifehler(i + 1, "invalid_currency_pair", `${basis}/${quote}`));
    else if (!k) fehler.push(dateifehler(i + 1, "invalid_rate", zellen[spalte.kurs]));
    else aufnehmen(i + 1, { datum: tag, basis, quote, kurs: k });
  }
  return { format: "lang", eintraege, fehler, zeilen: daten };
}
