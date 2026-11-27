import { Link } from "@tanstack/react-router";
import { Leer, Seitenkopf } from "@carraway/ui";
import { useT } from "../i18n";

import { useRechte } from "../lib/rechte";

export function KeinFonds({ titel }: { titel?: string }) {
  const t = useT();
  const { ich } = useRechte();
  return (
    <div className="app-seite">
      <Seitenkopf titel={titel ?? t.nav.portfolio} />
      <Leer titel={t.platzhalter.keinFondsTitel} beschreibung={ich?.globalVerwalter ? t.platzhalter.fondsAnlegen : t.platzhalter.keinFondsBeschreibung} aktion={ich?.globalVerwalter ? <Link to="/funds" search={{}}>{t.nav.fonds}</Link> : null} />
    </div>
  );
}
