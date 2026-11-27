import type { ReactNode } from "react";
import { InfoKnopf } from "@carraway/ui";

/** Kopfzeile eines Bereichs: Überschrift links (mit Erklärung hinter einem Info-Symbol), Aktionen rechts. */
export function Bereichskopf({ id, titel, info, children }: { id?: string; titel: ReactNode; info?: ReactNode; children?: ReactNode }) {
  return (
    <div className="app-portfolio__tabellenkopf">
      <div className="app-bereichskopf__titel">
        <h2 id={id} className="cw-t-untertitel">
          {titel}
        </h2>
        {info ? <InfoKnopf>{info}</InfoKnopf> : null}
      </div>
      {children ? <div className="app-portfolio__aktionen">{children}</div> : null}
    </div>
  );
}
