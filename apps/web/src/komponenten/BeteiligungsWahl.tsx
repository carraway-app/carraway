import { Auswahl } from "@carraway/ui";
import type { ReactNode } from "react";
import { VerknuepfungsFeld } from "./Suchfeld";

/** Ab so vielen Beteiligungen eines Fonds ersetzt das Suchfeld die Auswahlliste. */
export const BETEILIGUNGEN_MIT_SUCHE = 15;
export const mitBeteiligungsSuche = (anzahl: number) => anzahl > BETEILIGUNGEN_MIT_SUCHE;

interface BeteiligungsWahlProps {
  label: string;
  fondsId: string;
  /** Die dem Fonds bekannten Beteiligungen (Name der Organisation); bestimmt, ob Liste oder Suche erscheint. */
  beteiligungen: readonly { id: string; organisation: { name: string } }[];
  /** Gewählte Beteiligung (`""`: keine). */
  wert: string;
  onWahl: (id: string) => void;
  /** Eintrag der Auswahlliste für „keine Beteiligung“ (nur bei optionalen Feldern). */
  leerOption?: string | undefined;
  /** Beteiligungen, die nicht zur Wahl stehen (z. B. beendete); die Suche blendet sie aus. */
  ausschliessen?: ReadonlySet<string>;
  /** Dichte Darstellung für Filterleisten (nur die Auswahlliste). */
  kompakt?: boolean;
  required?: boolean;
  fehler?: ReactNode;
  name?: string;
}

/**
 * Wahl einer Beteiligung eines Fonds: bei wenigen die Auswahlliste, bei vielen das Suchfeld (Issue #296). Das Suchfeld sucht
 * serverseitig nach dem Namen des Unternehmens, nur in diesem Fonds und nur, wo die Person Portfolio sieht.
 */
export function BeteiligungsWahl({ label, fondsId, beteiligungen, wert, onWahl, leerOption, ausschliessen, kompakt, required, fehler, name }: BeteiligungsWahlProps) {
  if (!mitBeteiligungsSuche(beteiligungen.length)) {
    return (
      <Auswahl kompakt={kompakt} label={label} name={name} value={wert} required={required} fehler={fehler} onChange={(e) => onWahl(e.target.value)}>
        {leerOption !== undefined ? <option value="">{leerOption}</option> : null}
        {beteiligungen.map((b) => (
          <option key={b.id} value={b.id}>
            {b.organisation.name}
          </option>
        ))}
      </Auswahl>
    );
  }
  const gewaehlt = beteiligungen.find((b) => b.id === wert);
  return (
    <VerknuepfungsFeld
      label={label}
      name={name}
      ziel="beteiligung"
      fondsId={fondsId}
      ausschliessen={ausschliessen}
      required={required}
      fehler={fehler}
      wert={gewaehlt ? { id: gewaehlt.id, label: gewaehlt.organisation.name } : null}
      onWahl={(treffer) => onWahl(treffer?.id ?? "")}
    />
  );
}
