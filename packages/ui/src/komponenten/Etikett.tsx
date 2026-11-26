import type { HTMLAttributes } from "react";
import { klassen } from "../hilfen";

export function Etikett({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={klassen("cw-etikett", className)} {...rest} />;
}
