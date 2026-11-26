import { Feld } from "@carraway/ui";
import type { BelegVorlageDaten } from "../api/buchhaltung";
import { useSprache } from "../i18n";

export type BelegFeld = BelegVorlageDaten["felder"][number];

export function BelegFeldwert({ feld, wert, onChange }: { feld: BelegFeld; wert: string; onChange: (wert: string) => void }) {
  const sprache = useSprache();
  const name = sprache === "de" ? feld.bezeichnungDe : feld.bezeichnungEn;
  const typ = feld.manuell === "betrag" ? "number" : feld.manuell === "datum" ? "date" : "text";
  return <Feld kompakt label={`${name ?? feld.schluessel}${feld.pflicht ? " *" : ""}`} type={typ} step={typ === "number" ? "0.01" : undefined} maxLength={2000} value={wert} onChange={(e) => onChange(e.target.value)} />;
}
