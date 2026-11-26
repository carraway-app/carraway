import { Hinweis } from "@carraway/ui";
import { aufzaehlung, useT } from "../i18n";
import { rolleAm, useRechte, type FondsRolle } from "../lib/rechte";

/**
 * Kurzer Hinweis über einer Seite, auf der die Rolle der Person nicht zum Ändern reicht: Schreibende Aktionen sind dort
 * ausgeblendet. Die API prüft jede Anfrage selbst; das hier verhindert nur Angebote, die sie ablehnen würde.
 * `bereich`: Bereiche je Fonds zählen die Stufe an diesem Fonds und Bereich. `fondsId` leer: die Rolle an irgendeinem Fonds zählt (Kontakte, Deals vor der Zuordnung).
 */
export function NurLesen({ fondsId, mindest = "bearbeiter", bereich }: { fondsId?: string | null; mindest?: FondsRolle; bereich?: string }) {
  const t = useT();
  const { ich, darf } = useRechte();
  if (!ich || darf(mindest, fondsId, bereich)) return null;
  const rolle = fondsId ? rolleAm(ich, fondsId, bereich) : null;
  return <Hinweis>{rolle ? t.rechte.nurLesenRolle(aufzaehlung(t.rolle, rolle)) : t.rechte.nurLesen}</Hinweis>;
}
