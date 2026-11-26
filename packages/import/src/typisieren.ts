import { kappeParams, type Befund, type BefundParams, type Gelesen, type RohZeile } from "./lesen";
import { BLAETTER, BLATT_NAMEN, SPALTEN, auswahlWert, type Blatt, type Spalte } from "./spec";

/**
 * Prüft die Felder jeder Zeile gegen die Beschreibung der Vorlage (Pflicht, Auswahl, Datum, Beträge, Sätze, Formate) und liefert
 * die Zeilen in kanonischer Form: Beträge mit zwei Nachkommastellen (`1234.50`), Datum als `JJJJ-MM-TT`, Auswahlwerte intern,
 * Ja/Nein als `ja`/`nein`. Zeilen mit Fehlern bleiben mit ihrem Schlüssel erhalten (`gueltig: false`), damit Verweise darauf
 * keine Folgefehler erzeugen.
 */

export interface Zeile {
  /** Zeilennummer in der Datei. */
  zeile: number;
  /** Kanonische Werte; fehlende optionale Felder fehlen. */
  w: Record<string, string>;
  /** Alle Felder der Zeile waren gültig. */
  gueltig: boolean;
}

export type Typisiert = Record<Blatt, Zeile[]>;

const MAX_LAENGE: Record<string, number> = { name: 300, bezeichnung: 300, begruendung: 2000, grundlage: 2000, bemerkung: 1000, website: 300, email: 300 };
const STANDARD_LAENGE = 200;

export const leereTypisiert = (): Typisiert => Object.fromEntries(BLAETTER.map((b) => [b, [] as Zeile[]])) as unknown as Typisiert;

// Einzelne Werte ------------------------------------------------------------------------------------------------------

/** Datum als `JJJJ-MM-TT` (auch `TT.MM.JJJJ` und ISO mit Uhrzeit); `null`, wenn es kein echtes Datum zwischen 1900 und 2200 ist. */
export function parseDatum(text: string): string | null {
  let j: number, m: number, t: number;
  let treffer = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(text);
  if (treffer) [j, m, t] = [Number(treffer[1]), Number(treffer[2]), Number(treffer[3])];
  else {
    treffer = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
    if (!treffer) return null;
    [t, m, j] = [Number(treffer[1]), Number(treffer[2]), Number(treffer[3])];
  }
  if (j < 1900 || j > 2200) return null;
  const d = new Date(Date.UTC(j, m - 1, t));
  if (d.getUTCFullYear() !== j || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== t) return null;
  return `${String(j).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(t).padStart(2, "0")}`;
}

/**
 * Zahl als kanonische Dezimalzeichenkette (`-1234.5`); `null`, wenn es keine Zahl ist. Dezimalkomma und Dezimalpunkt,
 * Tausendertrenner (Punkt, Komma, Leerzeichen, Apostroph) und Währungszeichen werden verstanden. Steht nur ein Trenner im Text,
 * gilt er als Dezimaltrenner, außer er ist offensichtlich ein Tausendertrenner (genau drei Ziffern danach in einer Gruppenfolge
 * und mehr als zwei Nachkommastellen wären ohnehin ungültig).
 */
export function parseZahl(roh: string): string | null {
  let t = roh.replace(/[\s'’€$]|EUR/gi, "");
  if (t === "") return null;
  let vorzeichen = "";
  if (t.startsWith("-") || t.startsWith("+")) {
    vorzeichen = t.startsWith("-") ? "-" : "";
    t = t.slice(1);
  } else if (/^\(.*\)$/.test(t)) {
    vorzeichen = "-";
    t = t.slice(1, -1);
  }
  const punkte = (t.match(/\./g) ?? []).length;
  const kommas = (t.match(/,/g) ?? []).length;
  let ganz: string;
  let dezimal = "";
  if (punkte > 0 && kommas > 0) {
    const dezimalZeichen = t.lastIndexOf(",") > t.lastIndexOf(".") ? "," : ".";
    const ts = dezimalZeichen === "," ? "." : ",";
    const stelle = t.lastIndexOf(dezimalZeichen);
    if (t.slice(0, stelle).includes(dezimalZeichen)) return null;
    ganz = t.slice(0, stelle).split(ts).join("");
    dezimal = t.slice(stelle + 1);
  } else if (punkte > 0 || kommas > 0) {
    const z = punkte > 0 ? "." : ",";
    const anzahl = punkte > 0 ? punkte : kommas;
    const teile = t.split(z);
    const gruppen = teile.length > 1 && /^[1-9]\d{0,2}$/.test(teile[0]!) && teile.slice(1).every((g) => /^\d{3}$/.test(g));
    if (anzahl > 1) {
      if (!gruppen) return null;
      ganz = teile.join("");
    } else if (gruppen && teile[1]!.length === 3 && z === ".") {
      // „1.234“: höchstens zwei Nachkommastellen sind erlaubt, also Tausendertrenner.
      ganz = teile.join("");
    } else {
      ganz = teile[0]!;
      dezimal = teile[1]!;
    }
  } else {
    ganz = t;
  }
  if (!/^\d+$/.test(ganz) || (dezimal !== "" && !/^\d+$/.test(dezimal))) return null;
  ganz = ganz.replace(/^0+(?=\d)/, "");
  dezimal = dezimal.replace(/0+$/, "");
  return `${vorzeichen}${ganz}${dezimal === "" ? "" : `.${dezimal}`}`;
}

const nachkommastellen = (zahl: string) => zahl.split(".")[1]?.length ?? 0;

/** Zahl mit genau `stellen` Nachkommastellen (nur wenn sie höchstens so viele hat). */
function festeStellen(zahl: string, stellen: number): string {
  const [g, d = ""] = zahl.split(".");
  const vorzeichen = g!.startsWith("-") ? "-" : "";
  const ganz = g!.replace("-", "");
  return `${vorzeichen}${ganz}${stellen > 0 ? `.${d.padEnd(stellen, "0")}` : ""}`;
}

const istNull = (zahl: string) => /^-?0+(\.0+)?$/.test(zahl);
const istNegativ = (zahl: string) => zahl.startsWith("-") && !istNull(zahl);

const JA = new Set(["ja", "j", "yes", "y", "true", "1", "wahr"]);
const NEIN = new Set(["nein", "n", "no", "false", "0", "falsch"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Ergebnis = { wert: string } | { fehler: { code: string; meldung: string; params: BefundParams } };

function pruefeWert(spalte: Spalte, roh: string): Ergebnis {
  const fehler = (code: string, meldung: string, params: BefundParams = {}): Ergebnis => ({ fehler: { code, meldung, params: kappeParams(params) } });
  const max = MAX_LAENGE[spalte.schluessel] ?? STANDARD_LAENGE;
  switch (spalte.typ) {
    case "text":
      return roh.length > max ? fehler("TEXT_ZU_LANG", `Der Text ist länger als ${max} Zeichen.`, { max }) : { wert: roh };
    case "enum": {
      const wert = auswahlWert(spalte.auswahl ?? [], roh);
      return wert ? { wert } : fehler("AUSWAHL_UNGUELTIG", `„${roh}“ ist kein erlaubter Wert; erlaubt: ${(spalte.auswahl ?? []).map((x) => x.de).join(", ")}.`, { wert: roh, erlaubtDe: (spalte.auswahl ?? []).map((x) => x.de).join(", "), erlaubtEn: (spalte.auswahl ?? []).map((x) => x.en).join(", ") });
    }
    case "datum": {
      const datum = parseDatum(roh);
      return datum ? { wert: datum } : fehler("DATUM_UNGUELTIG", `„${roh}“ ist kein gültiges Datum (JJJJ-MM-TT oder TT.MM.JJJJ).`, { wert: roh });
    }
    case "jaNein": {
      const n = roh.toLowerCase();
      if (JA.has(n)) return { wert: "ja" };
      if (NEIN.has(n)) return { wert: "nein" };
      return fehler("JA_NEIN_UNGUELTIG", `„${roh}“ ist weder ja noch nein.`, { wert: roh });
    }
    case "email":
      return EMAIL.test(roh) && roh.length <= max ? { wert: roh } : fehler("EMAIL_UNGUELTIG", `„${roh}“ ist keine gültige E-Mail-Adresse.`, { wert: roh });
    case "url": {
      try {
        const url = new URL(roh);
        if ((url.protocol === "http:" || url.protocol === "https:") && roh.length <= max) return { wert: roh };
      } catch {
        // unten gemeldet
      }
      return fehler("URL_UNGUELTIG", `„${roh}“ ist keine Adresse mit http:// oder https://.`, { wert: roh });
    }
    case "uuid":
      return UUID.test(roh) ? { wert: roh.toLowerCase() } : fehler("UUID_UNGUELTIG", `„${roh}“ ist keine gültige ID.`, { wert: roh });
    case "waehrung":
      return /^[A-Z]{3}$/.test(roh.toUpperCase()) ? { wert: roh.toUpperCase() } : fehler("WAEHRUNG_UNGUELTIG", `„${roh}“ ist kein dreibuchstabiger Währungscode.`, { wert: roh });
    case "ganzzahl": {
      const zahl = parseZahl(roh);
      if (zahl === null || nachkommastellen(zahl) > 0 || istNegativ(zahl) || zahl.length > 18) return fehler("ZAHL_UNGUELTIG", `„${roh}“ ist keine ganze Zahl von null an.`, { wert: roh, art: "ganzzahl" });
      return { wert: zahl };
    }
    case "satz": {
      const zahl = parseZahl(roh);
      if (zahl === null) return fehler("ZAHL_UNGUELTIG", `„${roh}“ ist keine Zahl.`, { wert: roh, art: "zahl" });
      if (nachkommastellen(zahl) > 6 || istNegativ(zahl) || Number(zahl) > 1) return fehler("SATZ_UNGUELTIG", `„${roh}“ ist kein Anteil von 0 bis 1 mit höchstens sechs Nachkommastellen (6 % = 0,06).`, { wert: roh });
      return { wert: zahl };
    }
    case "preis": {
      const zahl = parseZahl(roh);
      if (zahl === null) return fehler("ZAHL_UNGUELTIG", `„${roh}“ ist keine Zahl.`, { wert: roh, art: "zahl" });
      if (nachkommastellen(zahl) > 4) return fehler("BETRAG_NACHKOMMASTELLEN", `„${roh}“ hat mehr als vier Nachkommastellen.`, { wert: roh, max: 4 });
      if (istNegativ(zahl) || istNull(zahl)) return fehler("BETRAG_UNGUELTIG", "Der Preis muss größer als null sein.", { grund: "nicht_positiv" });
      return { wert: festeStellen(zahl, 4) };
    }
    case "betrag":
    case "betragOhneNull":
    case "betragVorzeichen": {
      if (/^[+-]?\d{1,3}\.\d{3}$/.test(roh.replace(/[\s€]/g, ""))) {
        return fehler("ZAHL_MEHRDEUTIG", `„${roh}“ ist mehrdeutig (Tausenderpunkt oder drei Nachkommastellen); Beträge haben höchstens zwei Nachkommastellen, bitte mit Dezimalkomma schreiben (z. B. 1234,00).`, { wert: roh });
      }
      const zahl = parseZahl(roh);
      if (zahl === null) return fehler("ZAHL_UNGUELTIG", `„${roh}“ ist keine Zahl.`, { wert: roh, art: "zahl" });
      if (nachkommastellen(zahl) > 2) return fehler("BETRAG_NACHKOMMASTELLEN", `„${roh}“ hat mehr als zwei Nachkommastellen.`, { wert: roh, max: 2 });
      if (zahl.replace(/[-.]/g, "").length > 18) return fehler("BETRAG_UNGUELTIG", "Der Betrag ist zu groß.", { grund: "zu_gross" });
      if (spalte.typ === "betrag" && (istNegativ(zahl) || istNull(zahl))) return fehler("BETRAG_UNGUELTIG", "Der Betrag muss größer als null sein.", { grund: "nicht_positiv" });
      if (spalte.typ === "betragOhneNull" && istNegativ(zahl)) return fehler("BETRAG_UNGUELTIG", "Der Betrag darf nicht negativ sein.", { grund: "negativ" });
      if (spalte.typ === "betragVorzeichen" && istNull(zahl)) return fehler("BETRAG_UNGUELTIG", "Der Betrag darf nicht null sein.", { grund: "null" });
      return { wert: festeStellen(zahl, 2).replace(/^-(0\.00)$/, "$1") };
    }
  }
}

// Blätter -------------------------------------------------------------------------------------------------------------

function typisiereZeile(blatt: Blatt, name: string, roh: RohZeile, befunde: Befund[]): Zeile {
  const w: Record<string, string> = {};
  let gueltig = true;
  for (const spalte of SPALTEN[blatt]) {
    const wert = roh.werte[spalte.schluessel];
    if (wert === undefined) {
      if (spalte.pflicht) {
        gueltig = false;
        befunde.push({ blatt, blattName: name, zeile: roh.zeile, spalte: spalte.schluessel, code: "PFLICHTFELD_FEHLT", schweregrad: "fehler", meldung: `Das Pflichtfeld „${spalte.schluessel}“ ist leer.`, params: kappeParams({ spalte: spalte.schluessel }) });
      }
      continue;
    }
    const ergebnis = pruefeWert(spalte, wert);
    if ("fehler" in ergebnis) {
      gueltig = false;
      befunde.push({ blatt, blattName: name, zeile: roh.zeile, spalte: spalte.schluessel, code: ergebnis.fehler.code, schweregrad: "fehler", meldung: ergebnis.fehler.meldung, params: ergebnis.fehler.params });
    } else w[spalte.schluessel] = ergebnis.wert;
  }
  return { zeile: roh.zeile, w, gueltig };
}

/** Typisiert alle gelesenen Blätter; Befunde der Felder kommen in `befunde`. */
export function typisiere(gelesen: Gelesen, befunde: Befund[]): Typisiert {
  const aus = leereTypisiert();
  for (const blatt of BLAETTER) {
    const roh = gelesen.blaetter[blatt];
    if (!roh) continue;
    aus[blatt] = roh.zeilen.map((z) => typisiereZeile(blatt, roh.name, z, befunde));
  }
  return aus;
}

/** Name des Blattes für Befunde (so, wie es in der Datei steht, sonst der deutsche Name). */
export const blattName = (gelesen: Gelesen, blatt: Blatt): string => gelesen.blaetter[blatt]?.name ?? BLATT_NAMEN[blatt].de;
