import { formatDatum } from "@carraway/ui";
import { useSprache, useT } from "../i18n";
import { formatWissensstand } from "../lib/wissensstand";

export function Quellenstand({ stichtag, stand }: { stichtag?: string; stand?: string }) {
  const t = useT();
  const sprache = useSprache();
  if (!stichtag || !stand) return null;
  return <p className="app-leer-text">{t.kopf.stichtag} {formatDatum(stichtag, sprache)} · {t.wissensstand.label} {formatWissensstand(stand, sprache)}</p>;
}
