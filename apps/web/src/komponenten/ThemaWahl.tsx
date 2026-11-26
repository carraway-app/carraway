import { ThemaWahl as Wahl, type ThemaTexte } from "@carraway/ui";
import { useThemaWahl } from "../api/thema";

/**
 * Wahl des Themas der Anwendung: wirkt sofort und wird je Person gespeichert (`useThemaWahl`). Im Kontomenü (`inMenue`) sind die Segmente
 * Einträge des Menüs; in den Einstellungen hängt die Beschriftung über `aria-labelledby` an.
 */
export function ThemaWahl({ texte, inMenue, "aria-labelledby": beschriftetVon }: { texte: ThemaTexte; inMenue?: boolean; "aria-labelledby"?: string }) {
  const { thema, waehle } = useThemaWahl();
  return <Wahl texte={texte} value={thema} onChange={waehle} {...(inMenue ? { inMenue: true } : {})} {...(beschriftetVon ? { "aria-labelledby": beschriftetVon } : {})} />;
}
