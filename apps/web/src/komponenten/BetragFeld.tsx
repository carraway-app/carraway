import { Feld, type FeldProps } from "@carraway/ui";

/**
 * Eingabefeld für Beträge und Dezimalzahlen: Mono-Ziffern, Zifferntastatur auf Mobilgeräten, keine Browser-Vorschläge.
 * Die Prüfung kommt aus `useFormular` mit `betragRegel` (`feld(name, serverFehler)` liefert `fehler` und `onBlur`).
 */
export function BetragFeld(props: Omit<FeldProps, "zahl" | "type">) {
  return <Feld zahl inputMode="decimal" spellCheck={false} {...props} />;
}
