import { createContext, useContext, type ReactNode } from "react";
import { texte, type Sprache, type UiTexte } from "./texte";

const SpracheKontext = createContext<Sprache>("de");

/** Legt die Sprache der eingebauten Texte und Formate für den Teilbaum fest (Standard: Deutsch). */
export function UiSprache({ sprache, children }: { sprache: Sprache; children: ReactNode }) {
  return <SpracheKontext.Provider value={sprache}>{children}</SpracheKontext.Provider>;
}

export function useUiSprache(): Sprache {
  return useContext(SpracheKontext);
}

export function useUiTexte(): UiTexte {
  return texte[useContext(SpracheKontext)];
}
