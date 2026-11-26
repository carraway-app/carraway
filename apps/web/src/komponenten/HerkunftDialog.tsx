import type { ReactNode } from "react";
import { Herkunft, type HerkunftProps } from "@carraway/ui";
import { useSprache, useT } from "../i18n";
import { formatSchrittWert, uebersetzeSchritt } from "../i18n/schritte";
import { Seitenpanel } from "@carraway/ui";

/** Herkunft einer Kennzahl im Seitenpanel: Rechenschritte mit übersetzten Bezeichnungen und formatierten Werten. */
export function HerkunftDialog({ titel, stichtag, schritte, quellen, details, hinweis, onSchliessen }: { titel: string; stichtag: string; schritte: HerkunftProps["schritte"]; quellen?: HerkunftProps["quellen"]; details?: HerkunftProps["details"]; hinweis?: ReactNode; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  return (
    <Seitenpanel titel={t.portfolio.herkunftDialog(titel)} onSchliessen={onSchliessen}>
      {hinweis}
      <Herkunft
        details={details}
        titel={titel}
        stichtag={stichtag}
        {...(quellen && quellen.length > 0 ? { quellen } : {})}
        schritte={schritte.map((schritt) => ({
          ...schritt,
          bezeichnung: uebersetzeSchritt(schritt.bezeichnung, sprache),
          wert: formatSchrittWert(schritt.wert, sprache),
        }))}
      />
    </Seitenpanel>
  );
}
