import { Auswahl, type AuswahlProps } from "@carraway/ui";
import { useSprache } from "../i18n";
import { feldpruefungTexte } from "../i18n/feldpruefung";
import { waehrungsOptionen } from "../lib/waehrungen";

export interface WaehrungAuswahlProps extends Omit<AuswahlProps, "children"> {
  /** Text der leeren Option (zum Beispiel „wie Fonds“); ohne Angabe gibt es sie nur, solange noch nichts gewählt ist. */
  leer?: string;
}

/**
 * Währung als Auswahl der Codes, die die Anwendung kennt (ISO 4217, mit Name in der Sprache der Anwendung), statt Freitext. Ein gespeicherter Code, der nicht in
 * der Liste steht, bleibt als Option erhalten. Der Wert ist immer der Code in Großbuchstaben oder leer.
 */
export function WaehrungAuswahl({ leer, value, ...rest }: WaehrungAuswahlProps) {
  const sprache = useSprache();
  const aktuell = typeof value === "string" ? value : "";
  const optionen = waehrungsOptionen(sprache, aktuell ? [aktuell] : []);
  const zeigeLeer = leer !== undefined || aktuell === "";
  return (
    <Auswahl {...rest} value={aktuell}>
      {zeigeLeer ? <option value="">{leer ?? feldpruefungTexte[sprache].waehrungWaehlen}</option> : null}
      {optionen.map((o) => (
        <option key={o.code} value={o.code}>
          {o.label}
        </option>
      ))}
    </Auswahl>
  );
}
