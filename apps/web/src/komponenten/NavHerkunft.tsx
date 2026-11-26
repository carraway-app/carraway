import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { HerkunftProps } from "@carraway/ui";
import { api, auspacken } from "../api/client";
import { formatBetragCent } from "../lib/zahl";
import { useSprache, useT } from "../i18n";
import { EinzelwertTabelle, type EinzelwertZeile } from "./EinzelwertTabelle";
import { FehlerHinweis } from "./FehlerHinweis";
import { HerkunftDialog } from "./HerkunftDialog";
import { Quellenstand } from "./Quellenstand";
import { Skelettzeilen } from "./Skelett";

export default function NavHerkunft({ fondsId, waehrung, stichtag, stand, schritte, onSchliessen }: {
  fondsId: string; waehrung?: string; stichtag: string; stand: string; schritte: HerkunftProps["schritte"]; onSchliessen: () => void;
}) {
  const t = useT();
  const sprache = useSprache();
  const schnitt = { stichtag, stand };
  const { data, error, isLoading } = useQuery({
    queryKey: ["fonds", fondsId, "nav-einzelwerte", stichtag, stand],
    queryFn: () => auspacken(api.api.v1.fonds[":id"]["nav-einzelwerte"].$get({ param: { id: fondsId }, query: schnitt })),
    enabled: !!stand,
  });
  const portfolio: EinzelwertZeile[] = (data?.portfolio ?? []).map((p) => ({
    id: p.bewertungId, datum: p.datum, betrag: p.wert,
    quelle: <>
      <Link to="/beteiligungen/$id" params={{ id: p.beteiligungId }} search={{ ...schnitt, tab: "bewertung", unter: "bewertungen", bewertungId: p.bewertungId }}>{p.bezeichnung}</Link>
      {p.nachweise.map((n) => <div key={n.dokumentId + n.seite}>
        <Link to="/dokumente/$id" params={{ id: n.dokumentId }} search={{ ...schnitt, seite: n.seite ?? undefined }}>{n.seite ? t.dokumente.fundstelle.aus(n.dateiname, n.seite) : n.dateiname}</Link>
      </div>)}
    </>,
  }));
  const gruppen = [portfolio, ...["bank", "sonstiges", "schulden"].map((gruppe) =>
    (data?.salden ?? []).filter((s) => s.gruppe === gruppe).map((s) => ({
      id: s.id, datum: stichtag, betrag: s.saldo,
      quelle: <Link to="/buchhaltung" search={{ ...schnitt, fondsId, laufId: s.laufId, konto: s.konto }}>{s.konto} {s.bezeichnung}</Link>,
    })))];
  return <HerkunftDialog titel={t.portfolio.nav} stichtag={stichtag} schritte={schritte.map((s) => ({ ...s, wert: /^-?\d/.test(s.wert) ? formatBetragCent(s.wert, sprache, waehrung) : s.wert }))} onSchliessen={onSchliessen}
    hinweis={<><Quellenstand {...schnitt} /><FehlerHinweis fehler={error} />{isLoading ? <Skelettzeilen anzahl={2} /> : null}</>}
    details={gruppen.map((zeilen) => zeilen.length > 0 ? <EinzelwertTabelle titel={t.portfolio.einzelwerte} zeilen={zeilen} waehrung={waehrung} /> : null)} />;
}
