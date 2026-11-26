import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { kapitalHerkunft } from "../api/kapitalbewegungen";
import { useSprache, useT } from "../i18n";
import { kapitalTexte } from "../i18n/kapitalbewegung";
import { formatBetragCent } from "../lib/zahl";
import { EinzelwertTabelle } from "./EinzelwertTabelle";
import { FehlerHinweis } from "./FehlerHinweis";
import { HerkunftDialog } from "./HerkunftDialog";
import { Quellenstand } from "./Quellenstand";
import { Skelettzeilen } from "./Skelett";

export function KapitalHerkunft({ kennzahl, fondsId, waehrung, stichtag, stand, wert, onSchliessen }: {
  kennzahl: "abgerufen" | "eingezahlt"; fondsId: string; waehrung: string; stichtag: string; stand: string; wert: string; onSchliessen: () => void;
}) {
  const t = useT();
  const sprache = useSprache();
  const k = kapitalTexte[sprache];
  const { data, error, isPending } = useQuery(kapitalHerkunft(fondsId, stichtag, stand));
  const zeilen = (data?.[kennzahl] ?? []).map((p) => ({
    id: p.bewegungId + p.id, datum: p.datum, betrag: p.betrag,
    quelle: <Link to="/fonds/$fondsId/kapitalquelle/$kennzahl/$bewegungId/$positionId"
      params={{ fondsId, kennzahl, bewegungId: p.bewegungId, positionId: p.id }} search={{ stichtag, stand }}>
      {[k.quelleArt[p.art], p.investor, p.storniert && k.storniert].filter(Boolean).join(" · ")}
    </Link>,
  }));
  return <HerkunftDialog titel={k[kennzahl]} stichtag={stichtag} onSchliessen={onSchliessen}
    schritte={[{ zeichen: "=", bezeichnung: k[kennzahl], wert: formatBetragCent(wert, sprache, waehrung) }]}
    hinweis={<><Quellenstand stichtag={stichtag} stand={stand} /><FehlerHinweis fehler={error} />{isPending ? <Skelettzeilen anzahl={2} /> : null}</>}
    details={[zeilen.length ? <EinzelwertTabelle titel={t.portfolio.einzelwerte} zeilen={zeilen} waehrung={waehrung} /> : null]} />;
}
