import "../seiten/Portfolio.css";
import { useEffect, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { Tabs } from "@carraway/ui";
import { useT } from "../i18n";
import { useSichtbar } from "../lib/bereiche";
import { useRechte } from "../lib/rechte";
import { alle } from "../erweiterung";

export type KernTab = "uebersicht" | "szenarien" | "reserven" | "zinsen" | "kennzahlen" | "bewertungsrunde" | "zielfonds";
/** Bereich des Kerns oder einer Erweiterung (`erweiterung.ts`, Punkt `fondsReiter`). */
export type FondsTab = KernTab | (string & {});

const KERN_TABS: readonly KernTab[] = ["uebersicht", "kennzahlen", "zinsen", "zielfonds", "szenarien", "reserven", "bewertungsrunde"];

/**
 * Inhalt der Fondsseiten unter dem Kopf. Die Bereiche stehen in der Seitenleiste (Fondskontext); „Planung“ hat zwei Reiter (Szenarien, Reserven),
 * jeder mit eigener Adresse. Eine Adresse zu einem Bereich ohne Recht führt zur Übersicht, statt die Fehlermeldung der API zu zeigen.
 */
export function FondsBereiche({ aktiv, fondsId, children }: { aktiv: FondsTab; fondsId: string; children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const { ich } = useRechte();
  const zusatz = alle("fondsReiter");
  const sichtbar = useSichtbar("fonds", [...KERN_TABS, ...zusatz.map((r) => r.id)].map((id) => ({ id })));
  const erlaubt = sichtbar.some((e) => e.id === aktiv);
  useEffect(() => {
    if (ich && !erlaubt && sichtbar.length > 0) void router.navigate({ to: "/funds/$fundId", params: { fundId: fondsId }, search: {}, replace: true });
  }, [ich, erlaubt, sichtbar.length, router, fondsId]);

  if (aktiv === "szenarien" || aktiv === "reserven") {
    return (
      <Tabs
        fest
        aria-label={t.nav.planung}
        aktiv={aktiv}
        onWechsel={(id) => void router.navigate({ to: id === "reserven" ? "/funds/$fundId/reserves" : "/funds/$fundId/scenarios", params: { fundId: fondsId } })}
        tabs={[
          { id: "szenarien", label: t.fondsTabs.szenarien },
          { id: "reserven", label: t.fondsTabs.reserven },
        ]}
      >
        {children}
      </Tabs>
    );
  }
  if (aktiv === "zinsen") return <ZinsReiter aktiv="zinsstand" fondsId={fondsId}>{children}</ZinsReiter>;
  return <div className="app-fondsbereich">{children}</div>;
}

/** Reiter unter „Finanzen → Zinsen“: Zinsläufe (`/interest-runs?fundId=…`) und Zinsstand je Instrument (`/funds/…/interest`), je mit eigener Adresse. */
export function ZinsReiter({ aktiv, fondsId, children }: { aktiv: "zinslaeufe" | "zinsstand"; fondsId: string; children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  return (
    <Tabs
      fest
      aria-label={t.nav.zinsen}
      aktiv={aktiv}
      onWechsel={(id) => void (id === "zinsstand" ? router.navigate({ to: "/funds/$fundId/interest", params: { fundId: fondsId } }) : router.navigate({ to: "/interest-runs", search: { fondsId } }))}
      tabs={[
        { id: "zinslaeufe", label: t.nav.zinslaeufe },
        { id: "zinsstand", label: t.nav.zinsstand },
      ]}
    >
      {children}
    </Tabs>
  );
}
