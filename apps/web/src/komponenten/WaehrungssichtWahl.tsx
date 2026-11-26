import { Segment } from "@carraway/ui";
import { WaehrungAuswahl } from "./WaehrungAuswahl";

export type SichtArt = "fonds" | "lokal" | "vergleich";

/** Währungssicht eines Berichts: Fondswährung (Standard), lokal je Beteiligung oder Vergleich in einer gewählten Währung. */
export interface SichtZustand {
  sicht: SichtArt;
  /** Gewählter Code der Vergleichswährung (nur bei `vergleich`). */
  vergleich: string;
}

export const FONDS_SICHT: SichtZustand = { sicht: "fonds", vergleich: "" };

/** Gültiger Währungscode: drei Großbuchstaben (die Eingabe wird großgeschrieben). */
export const istWaehrungscode = (w: string) => /^[A-Z]{3}$/.test(w);

/** Teile der Anfrage zur Sicht: nichts bei der Fondswährung, `waehrungssicht` und bei Vergleich `vergleichswaehrung`. */
export const sichtAnfrage = (z: SichtZustand): { waehrungssicht?: "lokal" | "vergleich"; vergleichswaehrung?: string } =>
  z.sicht === "fonds" ? {} : z.sicht === "lokal" ? { waehrungssicht: "lokal" } : { waehrungssicht: "vergleich", vergleichswaehrung: z.vergleich };

export interface SichtTexte {
  beschriftung: string;
  fonds: string;
  lokal: string;
  vergleich: string;
  vergleichswaehrung: string;
  hilfe: string;
}

/** Umschalter Fonds | Lokal | Vergleich mit Feld für die Vergleichswährung, wie an Beteiligung und Fonds-Portfolio. */
export function WaehrungssichtWahl({ id, wert, onChange, texte, fehler }: { id: string; wert: SichtZustand; onChange: (neu: SichtZustand) => void; texte: SichtTexte; fehler?: string | undefined }) {
  return (
    <div className="app-gruppe app-gruppe--zeile" title={texte.hilfe}>
      <span className="cw-feld__label" id={`${id}-sicht`}>
        {texte.beschriftung}
      </span>
      <Segment<SichtArt>
        aria-labelledby={`${id}-sicht`}
        value={wert.sicht}
        onChange={(sicht) => onChange({ ...wert, sicht })}
        options={[
          { wert: "fonds", label: texte.fonds },
          { wert: "lokal", label: texte.lokal },
          { wert: "vergleich", label: texte.vergleich },
        ]}
      />
      {wert.sicht === "vergleich" ? (
        <WaehrungAuswahl
          kompakt
          labelVersteckt
          label={texte.vergleichswaehrung}
          title={texte.vergleichswaehrung}
          value={wert.vergleich}
          onChange={(e) => onChange({ ...wert, vergleich: e.target.value })}
          fehler={fehler}
        />
      ) : null}
    </div>
  );
}
