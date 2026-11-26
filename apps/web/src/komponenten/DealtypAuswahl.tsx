import { Auswahl } from "@carraway/ui";
import { useSprache } from "../i18n";
import { DEALTYPEN, dealtypName, dealtypTexte, type Dealtyp } from "../lib/dealtyp";

export function DealtypAuswahl({ wert, onWechsel, fehler, deaktiviert }: {
  wert: Dealtyp | null;
  onWechsel: (wert: Dealtyp | null) => void;
  fehler?: string | undefined;
  deaktiviert?: boolean;
}) {
  const sprache = useSprache();
  return (
    <Auswahl
      name="dealtyp"
      label={dealtypTexte[sprache].feld}
      value={wert ?? ""}
      fehler={fehler}
      disabled={deaktiviert}
      onChange={(e) => onWechsel(DEALTYPEN.find((typ) => typ === e.target.value) ?? null)}
    >
      <option value="">{dealtypName(null, sprache)}</option>
      {DEALTYPEN.map((typ) => <option key={typ} value={typ}>{dealtypName(typ, sprache)}</option>)}
    </Auswahl>
  );
}
