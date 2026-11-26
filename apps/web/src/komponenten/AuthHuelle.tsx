import { Outlet } from "@tanstack/react-router";
import { Logo, Segment, type Sprache } from "@carraway/ui";
import { useSetzeSprache, useSprache, useT } from "../i18n";
import { Umgebungsbanner } from "./Umgebungsbanner";

/** Rahmen der Seiten vor der Anmeldung: Logo, Sprachschalter, eine Spalte. Kein Zugriff auf Fonds oder Daten. */
export function AuthHuelle() {
  const t = useT();
  const sprache = useSprache();
  const setzeSprache = useSetzeSprache();
  return (
    <>
      <Umgebungsbanner />
      <div className="app-auth">
        <a className="app-sprung" href="#inhalt">
          {t.uebersprungLink}
        </a>
        <header className="app-auth__kopf">
          <Logo />
          <Segment<Sprache>
            aria-label={t.kopf.sprache}
            value={sprache}
            onChange={setzeSprache}
            options={[
              { wert: "de", label: t.kopf.sprachen.de },
              { wert: "en", label: t.kopf.sprachen.en },
            ]}
          />
        </header>
        <main id="inhalt" tabIndex={-1} className="app-auth__inhalt">
          <Outlet />
        </main>
      </div>
    </>
  );
}
