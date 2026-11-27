import { alle } from "../erweiterung";
import { useRechte } from "./rechte";

/**
 * Bereich je Abschnitt einer Seite (Rechtemodell, docs/permissions-model.md), an einer Stelle. Schlüssel: Seite, dann Kennung des Eintrags im
 * Inhaltsverzeichnis. Die Bereiche sind die der API (`apps/api/src/rechte/bereiche.ts`): Wer den Bereich nicht hat, bekäme dort 403, darum
 * erscheint der Abschnitt gar nicht erst. Ohne Eintrag gehört der Abschnitt zum Bereich der Seite selbst und ist immer sichtbar.
 */
export const BEREICH_JE_ABSCHNITT: Record<string, Record<string, string>> = {
  // Organisation (Bereich Kontakte): Deals, Beteiligungen, Runden und Dokumente gehören anderen Bereichen.
  organisation: { deals: "dealflow", beteiligungen: "portfolio", runden: "portfolio", dokumente: "dokumente" },
  // Person (Bereich Kontakte): alles gehört dazu.
  person: {},
  // Deal (Bereich Dealflow): Aufgaben, Termine und Verknüpfungen sind CRM-Daten (Kontakte), Kontakte des Deals gehören zum Dealflow.
  deal: { termine: "kontakte", aufgaben: "kontakte", verknuepft: "kontakte", dokumente: "dokumente" },
  // Beteiligung (Bereich Portfolio).
  beteiligung: { zinsen: "finanzen", foerderung: "finanzen", werte: "kennzahlen", dokumente: "dokumente", "felder-beteiligung": "kontakte", "felder-instrument": "kontakte" },
  // Reiter eines Fonds (Rahmen im Portfolio).
  fonds: { kennzahlen: "kennzahlen", zinsen: "finanzen" },
  // Persönliche Einstellungen (Seite für alle): das Postfach ordnet Mails Kontakten zu.
  einstellungen: { postfach: "kontakte" },
  // Fondsverwaltung: die Seite ist für alle da, einzelne Abschnitte nicht.
  fondsverwaltung: { gremien: "portfolio", kapital: "finanzen", abgrenzung: "finanzen", dokumente: "dokumente", felder: "kontakte" },
};

/** Bereich eines Abschnitts nach `BEREICH_JE_ABSCHNITT` oder nach dem Eintrag einer Erweiterung (Reiter von Fonds und Beteiligung); `undefined` ohne Beschränkung. */
export function bereichVon(seite: string, id: string): string | undefined {
  const kern = BEREICH_JE_ABSCHNITT[seite]?.[id];
  if (kern) return kern;
  if (seite === "fonds") return alle("fondsReiter").find((r) => r.id === id)?.bereich;
  if (seite === "beteiligung") return alle("beteiligungReiter").find((r) => r.id === id)?.bereich;
  return undefined;
}

/** Behält die Einträge, deren Bereich die Person hat; die Reihenfolge bleibt. Ein ausgeblendeter Eintrag wird nie aktiv (`useInhalt` fällt auf den ersten zurück). */
export function useSichtbar<E extends { id: string }>(seite: string, eintraege: readonly E[]): E[] {
  const { hatBereich } = useRechte();
  return eintraege.filter((e) => {
    const bereich = bereichVon(seite, e.id);
    return !bereich || hatBereich(bereich);
  });
}
