import "../seiten/Portfolio.css";
import { useEffect, type ReactNode } from "react";
import type { NavigateOptions } from "@tanstack/react-router";
import { useRouter } from "@tanstack/react-router";
import { Inhaltsverzeichnis, type VerzeichnisGruppe } from "@carraway/ui";
import { useT } from "../i18n";
import { useSichtbar } from "../lib/bereiche";
import { useRechte } from "../lib/rechte";
import { alle } from "../erweiterung";

export type KernTab = "uebersicht" | "szenarien" | "reserven" | "zinsen" | "kennzahlen" | "bewertungsrunde";
/** Reiter des Kerns oder einer Erweiterung (`erweiterung.ts`, Punkt `fondsReiter`). */
export type FondsTab = KernTab | (string & {});

function ziel(tab: FondsTab, fondsId: string): NavigateOptions {
  const zusatz = alle("fondsReiter").find((r) => r.id === tab);
  if (zusatz) return { to: `/fonds/${fondsId}/${zusatz.pfad}` as never };
  switch (tab as KernTab) {
    case "uebersicht":
      return { to: "/fonds/$fondsId", params: { fondsId }, search: {} };
    case "szenarien":
      return { to: "/fonds/$fondsId/szenarien", params: { fondsId } };
    case "reserven":
      return { to: "/fonds/$fondsId/reserven", params: { fondsId } };
    case "zinsen":
      return { to: "/fonds/$fondsId/zinsen", params: { fondsId } };
    case "kennzahlen":
      return { to: "/fonds/$fondsId/kennzahlen", params: { fondsId } };
    case "bewertungsrunde":
      return { to: "/fonds/$fondsId/bewertungsrunde", params: { fondsId }, search: {} };
  }
}

const KERN_TABS: readonly KernTab[] = ["uebersicht", "kennzahlen", "zinsen", "szenarien", "reserven", "bewertungsrunde"];

/**
 * Inhaltsverzeichnis der Fondsseiten: jeder Eintrag ist eine eigene Adresse, die Seite steht als `children` rechts daneben.
 * Der Rahmen (`Fondsrahmen`) hält das Verzeichnis über Wechsel hinweg eingehängt; den Fokus auf den neuen Bereich setzt das Verzeichnis selbst.
 */
export function Fondsleiste({ aktiv, fondsId, children }: { aktiv: FondsTab; fondsId: string; children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const f = t.fondsTabs;

  function wechseln(id: string) {
    void router.navigate(ziel(id as FondsTab, fondsId));
  }

  // Reiter anderer Bereiche (Kennzahlen, Zinsen, Reiter der Erweiterungen) erscheinen nur mit dem Bereich (`lib/bereiche.ts`).
  const { ich } = useRechte();
  const zusatz = alle("fondsReiter");
  const sichtbar = useSichtbar("fonds", [...KERN_TABS, ...zusatz.map((r) => r.id)].map((id) => ({ id })));
  const eintrag = (id: FondsTab) => ({ id, label: zusatz.find((r) => r.id === id)?.label(t) ?? f[id as KernTab] });
  const nimm = (...ids: FondsTab[]) => ids.filter((id) => sichtbar.some((e) => e.id === id)).map(eintrag);
  const zusatzGruppen = [...new Map(zusatz.map((r) => [r.gruppe.id, r.gruppe])).values()];
  const gruppen: VerzeichnisGruppe[] = [
    { id: "bestand", label: f.gruppeBestand, eintraege: nimm("uebersicht", "kennzahlen", "zinsen") },
    { id: "planung", label: f.gruppePlanung, eintraege: nimm("szenarien", "reserven") },
    { id: "bewertung", label: f.gruppeBewertung, eintraege: nimm("bewertungsrunde") },
    ...zusatzGruppen.map((g) => ({ id: g.id, label: g.label(t), eintraege: nimm(...zusatz.filter((r) => r.gruppe.id === g.id).map((r) => r.id)) })),
  ].filter((g) => g.eintraege.length > 0 || g.id === "bestand");
  // Eine Adresse zu einem ausgeblendeten Reiter führt zur Übersicht, statt die Fehlermeldung der API zu zeigen.
  const erlaubt = sichtbar.some((e) => e.id === aktiv);
  useEffect(() => {
    if (ich && !erlaubt && sichtbar.length > 0) void router.navigate({ ...ziel("uebersicht", fondsId), replace: true });
  }, [ich, erlaubt, sichtbar.length, router, fondsId]);

  return (
    <div className="app-fondsleiste">
      <Inhaltsverzeichnis aria-label={f.beschriftung} gruppen={gruppen} aktiv={aktiv} onWechsel={wechseln}>
        {children}
      </Inhaltsverzeichnis>
    </div>
  );
}
