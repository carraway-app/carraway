import { useRouter } from "@tanstack/react-router";
import { Button, Hinweis } from "@carraway/ui";
import { ApiFehler } from "../api/client";
import { aufzaehlung, useT } from "../i18n";

/** Zeigt den übersetzten Text zum API-Fehlercode; unbekannte Codes fallen auf die allgemeine Meldung zurück. */
export function Fehleransicht({ error, reset }: { error: unknown; reset?: () => void }) {
  const t = useT();
  const router = useRouter();
  const code = error instanceof ApiFehler ? error.code : "UNBEKANNT";
  const meldung = aufzaehlung(t.fehler, code) === code ? t.fehler.unbekannt : aufzaehlung(t.fehler, code);
  return (
    <div className="app-seite">
      <Hinweis variante="fehler" titel={t.fehler.titel}>
        {meldung}
      </Hinweis>
      <div>
        <Button
          variante="sekundaer"
          onClick={() => {
            reset?.();
            void router.invalidate();
          }}
        >
          {t.gemeinsam.erneutVersuchen}
        </Button>
      </div>
    </div>
  );
}
