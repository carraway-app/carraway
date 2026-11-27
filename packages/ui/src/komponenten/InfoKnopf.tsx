import type { ReactNode } from "react";
import { klassen } from "../hilfen";
import { InfoIcon } from "../icons/Info";
import { useUiTexte } from "../sprache";
import { Popover } from "./Popover";

/** Erklärtext hinter einem Info-Symbol: ruhig im Kopf, ein Klick (oder Enter) zeigt den Text, Escape schließt. */
export function InfoKnopf({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  const t = useUiTexte();
  return (
    <Popover className={klassen("cw-info", className)} kante="links" aria-label={label ?? t.erklaerung} ausloeserKlasse="cw-info__knopf" ausloeser={<InfoIcon size={16} />}>
      <div className="cw-info__text">{children}</div>
    </Popover>
  );
}
