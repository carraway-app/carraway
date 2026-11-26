import type { HTMLAttributes, ReactNode } from "react";
import { klassen } from "../hilfen";
import { InfoIcon, WarningIcon } from "../icons";
import { useUiTexte } from "../sprache";

export interface HinweisProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  variante?: "info" | "fehler";
  titel?: ReactNode;
}

export function Hinweis({ variante = "info", titel, children, className, ...rest }: HinweisProps) {
  const t = useUiTexte();
  const fehler = variante === "fehler";
  return (
    <div role={fehler ? "alert" : "status"} className={klassen("cw-hinweis", fehler && "cw-hinweis--fehler", className)} {...rest}>
      {fehler ? <WarningIcon /> : <InfoIcon />}
      <div>
        <span className="cw-nur-lesen">{fehler ? t.hinweisFehler : t.hinweisInfo}: </span>
        {titel ? <strong>{titel} </strong> : null}
        <span className="cw-hinweis__text">{children}</span>
      </div>
    </div>
  );
}
