import type { ReactNode } from "react";
import { Tabelle, formatDatum } from "@carraway/ui";
import { useSprache, useT } from "../i18n";
import { formatBetragCent } from "../lib/zahl";

export interface EinzelwertZeile {
  id: string;
  quelle: ReactNode;
  datum: string;
  betrag: string;
}

export function EinzelwertTabelle({ titel, zeilen, waehrung }: { titel: string; zeilen: EinzelwertZeile[]; waehrung?: string }) {
  const t = useT();
  const sprache = useSprache();
  return <Tabelle dicht beschriftung={titel} zeilen={zeilen} zeilenSchluessel={(z) => z.id} spalten={[
    { schluessel: "quelle", kopf: t.portfolio.quelle, umbruch: true, zelle: (z) => z.quelle },
    { schluessel: "datum", kopf: t.portfolio.wirksam, zelle: (z) => formatDatum(z.datum, sprache) },
    { schluessel: "betrag", kopf: t.beteiligung.vorgaenge.spalten.betrag, zahl: true, zelle: (z) => formatBetragCent(z.betrag, sprache, waehrung) },
  ]} />;
}
