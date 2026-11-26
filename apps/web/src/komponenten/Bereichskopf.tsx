import type { ReactNode } from "react";

/** Kopfzeile eines Fondsbereichs neben dem Inhaltsverzeichnis: Überschrift links, Aktionen rechts. */
export function Bereichskopf({ id, titel, children }: { id?: string; titel: ReactNode; children?: ReactNode }) {
  return (
    <div className="app-portfolio__tabellenkopf">
      <h2 id={id} className="cw-t-untertitel">
        {titel}
      </h2>
      {children ? <div className="app-portfolio__aktionen">{children}</div> : null}
    </div>
  );
}
