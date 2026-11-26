import { useEffect, useState, type ChangeEvent, type FocusEvent, type ReactNode } from "react";
import { formatDatum, type Sprache } from "@carraway/ui";
import { useSprache } from "../i18n";
import { feldpruefungTexte } from "../i18n/feldpruefung";
import { zahlNormalisiert, type Pruefung, type Regel } from "../lib/feldpruefung";

type Eingabeelement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** Meldungstext zu einer Prüfung (`i18n/feldpruefung.ts`). */
export function pruefungText(sprache: Sprache, p: Pruefung): string {
  const f = feldpruefungTexte[sprache];
  const w = p.werte ?? [];
  switch (p.code) {
    case "nachkomma":
      return f.nachkomma(Number(w[0] ?? 2));
    case "bereich":
      return f.bereich(Number(w[0] ?? 0), Number(w[1] ?? 100));
    case "datumFrueh":
      return f.datumFrueh(formatDatum(String(w[0]), sprache));
    case "datumSpaet":
      return f.datumSpaet(formatDatum(String(w[0]), sprache));
    default:
      return f[p.code];
  }
}

export type Regeln<T extends Record<string, string>> = { [K in keyof T]?: Regel<T> };

/**
 * Hält die Werte eines Formulars als Zeichenketten; `feld(name)` liefert `name`, `value` und `onChange` für ein Feld.
 *
 * Mit `regeln` (siehe `lib/feldpruefung.ts`) prüft das Formular direkt am Feld: `feld(name, serverFehler)` liefert dann zusätzlich `onBlur` und `fehler`.
 * Die Meldung erscheint beim Verlassen des Feldes und danach bei jeder Eingabe, ein Fehler, den weiteres Tippen nicht behebt (falsches Zeichen, zu viele
 * Nachkommastellen), schon beim Tippen. Der Fehler der API (`serverFehler`) bleibt am Feld stehen, solange die Eingabe sonst in Ordnung ist.
 * `pruefeAlle()` markiert beim Absenden alle Felder als geprüft und sagt, ob das Formular abgeschickt werden darf; `gueltig` sagt dasselbe ohne Markierung.
 */
export function useFormular<T extends Record<string, string>>(start: T | (() => T), regeln?: Regeln<T>) {
  const sprache = useSprache();
  const [werte, setWerte] = useState<T>(start);
  const [beruehrt, setBeruehrt] = useState<Record<string, boolean>>({});
  const pruefung = (name: keyof T & string): Pruefung | undefined => regeln?.[name]?.(werte[name] as string, werte, { sprache });
  const meldung = (name: keyof T & string): ReactNode => {
    const p = pruefung(name);
    return p && (beruehrt[name] || p.sofort) ? pruefungText(sprache, p) : undefined;
  };
  const feld = (name: keyof T & string, serverFehler?: ReactNode) => {
    const basis = {
      name,
      value: werte[name],
      onChange: (e: ChangeEvent<Eingabeelement>) => setWerte((alt) => ({ ...alt, [name]: e.target.value })),
    };
    if (!regeln?.[name]) return serverFehler === undefined ? basis : { ...basis, fehler: serverFehler };
    return { ...basis, onBlur: (_e: FocusEvent<Eingabeelement>) => setBeruehrt((alt) => (alt[name] ? alt : { ...alt, [name]: true })), fehler: meldung(name) ?? serverFehler };
  };
  const pruefeAlle = (): boolean => {
    if (!regeln) return true;
    const namen = Object.keys(regeln) as (keyof T & string)[];
    setBeruehrt(Object.fromEntries(namen.map((n) => [n, true])));
    return namen.every((n) => pruefung(n) === undefined);
  };
  const gueltig = !regeln || (Object.keys(regeln) as (keyof T & string)[]).every((n) => pruefung(n) === undefined);
  /** Nimmt die Markierung „geprüft“ zurück (zum Beispiel nach erfolgreichem Speichern in einem Formular, das stehen bleibt). */
  const zuruecksetzen = () => setBeruehrt({});
  return { werte, setWerte, feld, pruefeAlle, gueltig, zuruecksetzen };
}

/**
 * Prüfung am Feld für Formulare mit dynamischen Zeilen (Szenarien, Zeichnungen), die nicht in `useFormular` passen. `pruefe(schluessel, regel, wert)` liefert
 * `onBlur` und `fehler` für das Feld: die Meldung erscheint beim Verlassen des Feldes, beim Absenden und bei nicht behebbaren Eingaben sofort. Was beim Rendern
 * geprüft wird, merkt sich der Hook; `pruefeAlle()` markiert alles als geprüft und sagt, ob nichts offen ist.
 */
export function useZeilenpruefung() {
  const sprache = useSprache();
  const [versucht, setVersucht] = useState(false);
  const [beruehrt, setBeruehrt] = useState<Record<string, boolean>>({});
  const offen: string[] = [];
  const pruefe = (schluessel: string, regel: Regel, wert: string): { onBlur?: () => void; fehler?: ReactNode } => {
    const p = regel(wert, {}, { sprache });
    if (!p) return {};
    offen.push(schluessel);
    return { onBlur: () => setBeruehrt((alt) => (alt[schluessel] ? alt : { ...alt, [schluessel]: true })), fehler: versucht || beruehrt[schluessel] || p.sofort ? pruefungText(sprache, p) : undefined };
  };
  const pruefeAlle = (): boolean => {
    setVersucht(true);
    return offen.length === 0;
  };
  return { pruefe, pruefeAlle };
}

/** Leere Eingaben werden zu `undefined` (Feld weglassen), sonst der getrimmte Text. */
export const textOderNichts = (wert: string): string | undefined => (wert.trim() === "" ? undefined : wert.trim());

/** Beim Ändern leert `null` ein Feld; leere Eingaben werden zu `null`. */
export const textOderNull = (wert: string): string | null => (wert.trim() === "" ? null : wert.trim());

/**
 * Betrag aus der Eingabe in der Schreibweise der API (`2450000` oder `2450000.50`): Leerzeichen und Tausenderpunkte weg, Komma wird Punkt (`sprache`
 * bestimmt, was Tausender- und was Dezimalzeichen ist). Eine Eingabe, die keine Zahl ist, bleibt unverändert, damit das Feld sie meldet.
 */
export const betragOderNichts = (wert: string, sprache: Sprache = "de"): string | undefined => {
  const roh = wert.replace(/\s/g, "");
  if (roh === "") return undefined;
  return zahlNormalisiert(roh, sprache) ?? roh.replace(",", ".");
};

/** Betrag der API für das Eingabefeld: ohne `.00` am Ende. */
export const betragFuerFeld = (wert: string | null | undefined): string => (wert ? wert.replace(/\.00$/, "") : "");

/** Gibt `wert` erst nach `ms` Ruhe weiter, damit nicht jeder Tastendruck eine Anfrage auslöst. */
export function useEntprellt<T>(wert: T, ms = 300): T {
  const [verzoegert, setVerzoegert] = useState(wert);
  useEffect(() => {
    const timer = setTimeout(() => setVerzoegert(wert), ms);
    return () => clearTimeout(timer);
  }, [wert, ms]);
  return verzoegert;
}
