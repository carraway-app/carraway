import { MonitorIcon, MoonIcon, SunIcon } from "../icons";
import type { Thema } from "../thema";
import { MenueSegment } from "./MenueSegment";
import { Segment } from "./Segment";

/** Beschriftungen der Wahl; sie kommen vom Aufrufer, weil Anwendung und Portal ihre eigenen Wörterbücher haben. */
export interface ThemaTexte {
  beschriftung: string;
  system: string;
  hell: string;
  dunkel: string;
}

export interface ThemaWahlProps {
  texte: ThemaTexte;
  value: Thema;
  onChange: (thema: Thema) => void;
  /** Die Wahl steht als Block in einem Menü (`Menue`, Eigenschaft `block`): Die Segmente sind dann Einträge des Menüs. */
  inMenue?: boolean;
  /** Verweist auf eine sichtbare Beschriftung; ohne Angabe heißt die Gruppe `texte.beschriftung`. */
  "aria-labelledby"?: string;
}

/** Wahl des Themas „System | Hell | Dunkel“ als Segment mit Zeichen (Monitor, Sonne, Mond). */
export function ThemaWahl({ texte, value, onChange, inMenue, "aria-labelledby": beschriftetVon }: ThemaWahlProps) {
  const eintrag = (wert: Thema, icon: React.ReactNode) => ({
    wert,
    label: (
      <>
        {icon}
        {texte[wert]}
      </>
    ),
  });
  const Wahl = inMenue ? MenueSegment<Thema> : Segment<Thema>;
  return (
    <Wahl
      {...(beschriftetVon ? { "aria-labelledby": beschriftetVon } : { "aria-label": texte.beschriftung })}
      value={value}
      onChange={onChange}
      options={[eintrag("system", <MonitorIcon />), eintrag("hell", <SunIcon />), eintrag("dunkel", <MoonIcon />)]}
    />
  );
}
