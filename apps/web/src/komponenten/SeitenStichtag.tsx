import { useEffect, useState } from "react";
import { Feld } from "@carraway/ui";
import { useT } from "../i18n";

/** Der lesbare Stichtag einer Ansicht. Ein leeres Datum verwendet wieder den fachlichen Standard. */
export function SeitenStichtag({ value, onChange, label, title }: {
  value: string;
  onChange: (wert: string | undefined) => void;
  label?: string;
  title?: string;
}) {
  const t = useT();
  const [eingabe, setEingabe] = useState(value);
  useEffect(() => setEingabe(value), [value]);
  return (
    <Feld
      kompakt
      className="app-seitenstichtag"
      type="date"
      label={label ?? t.kopf.stichtag}
      title={title}
      value={eingabe}
      onChange={(e) => {
        const datum = e.currentTarget.value;
        setEingabe(datum);
        onChange(datum || undefined);
      }}
      onBlur={() => { if (!eingabe) setEingabe(value); }}
    />
  );
}
