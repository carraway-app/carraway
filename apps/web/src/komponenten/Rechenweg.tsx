import { Herkunft, type HerkunftProps } from "@carraway/ui";
import { useSprache } from "../i18n";
import { formatSchrittWert, uebersetzeSchritt } from "../i18n/schritte";

/** Rechenschritte der API als `Herkunft` im Fluss der Seite (ohne eigenen Dialog): übersetzte Bezeichnungen, formatierte Werte. */
export function Rechenweg({ titel, stichtag, schritte }: { titel: string; stichtag?: string; schritte: HerkunftProps["schritte"] }) {
  const sprache = useSprache();
  return (
    <Herkunft
      titel={titel}
      {...(stichtag ? { stichtag } : {})}
      schritte={schritte.map((s) => ({ ...s, bezeichnung: uebersetzeSchritt(s.bezeichnung, sprache), wert: formatSchrittWert(s.wert, sprache) }))}
    />
  );
}
