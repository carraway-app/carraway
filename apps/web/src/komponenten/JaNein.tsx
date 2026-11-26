import { Segment } from "@carraway/ui";

/** Ja/Nein-Wahl als beschriftete Gruppe aus zwei Knöpfen (`aria-pressed`). */
export function JaNein({ label, wert, onWahl, ja, nein }: { label: string; wert: boolean; onWahl: (wert: boolean) => void; ja: string; nein: string }) {
  return (
    <fieldset className="app-gruppe">
      <legend className="cw-feld__label">{label}</legend>
      <Segment<"ja" | "nein">
        aria-label={label}
        value={wert ? "ja" : "nein"}
        onChange={(w) => onWahl(w === "ja")}
        options={[
          { wert: "ja", label: ja },
          { wert: "nein", label: nein },
        ]}
      />
    </fieldset>
  );
}
