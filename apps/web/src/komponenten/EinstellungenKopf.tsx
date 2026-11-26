import type { ReactNode } from "react";
import { Seitenkopf, Tabs } from "@carraway/ui";
import { useT } from "../i18n";
import { useEinstellungenReiter } from "./einstellungenReiter";

/**
 * Gemeinsamer Rahmen aller Reiter der persönlichen Einstellungen: Titel, Untertitel „Konto“ und Reiterleiste. Die Seiten der Reiter (Kern auf
 * `/einstellungen/postfach`, Erweiterungen mit eigener Seite wie „Excel“) verwenden alle diese Komponente, damit Höhe und Abstände beim Wechsel gleich
 * bleiben. Beschreibende Texte gehören in den jeweiligen Reiter unter die Leiste, nicht in den Kopf.
 *
 * `inhalte` liefert den Inhalt der Reiter dieser Seite, `children` den Inhalt des aktiven Reiters, wenn er nicht dort steht; `vorReitern` steht zwischen
 * Kopf und Leiste (z. B. die Meldung nach der Rückkehr von der Anbieterseite).
 */
export function EinstellungenKopf({
  aktiv,
  onWechsel,
  inhalte = {},
  vorReitern,
  children,
}: {
  aktiv: string;
  onWechsel: (id: string) => void;
  inhalte?: Partial<Record<string, () => ReactNode>>;
  vorReitern?: ReactNode;
  children?: ReactNode;
}) {
  const t = useT();
  const reiter = useEinstellungenReiter(t, inhalte);
  return (
    <div className="app-seite">
      <Seitenkopf meta={t.konto.beschriftung} titel={t.nav.einstellungen} />
      {vorReitern}
      <Tabs aria-label={t.tabs.bereiche} aktiv={aktiv} onWechsel={onWechsel} tabs={reiter}>
        {children}
      </Tabs>
    </div>
  );
}
