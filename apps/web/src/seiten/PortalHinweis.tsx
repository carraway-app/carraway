import { Button } from "@carraway/ui";
import { useT } from "../i18n";
import { useAbmelden } from "../komponenten/abmelden";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";

export function PortalHinweis() {
  const t = useT();
  const { abmelden, laeuft, fehler } = useAbmelden();
  return (
    <section className="app-auth__karte" aria-labelledby="portal-hinweis">
      <h1 id="portal-hinweis" className="cw-t-titel">{t.portalFehlt}</h1>
      <p>{t.fehler.portal_only}</p>
      <FehlerHinweis fehler={fehler} />
      <Button onClick={() => void abmelden()} disabled={laeuft}>{t.konto.abmelden}</Button>
    </section>
  );
}
