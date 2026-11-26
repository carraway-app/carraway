import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Button, Feld, Hinweis } from "@carraway/ui";
import { umgebungAbfrage } from "../api/anmeldung";
import { authAnfrage } from "../api/client";
import { useAnmeldeschritt, useAnmeldungAbschliessen } from "../komponenten/anmeldeschritt";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { useT } from "../i18n";
import { alle } from "../erweiterung";

const route = getRouteApi("/anmelden");

/** Anmeldung in zwei Schritten: Adresse und Passwort, danach (bei eingerichtetem zweiten Faktor) der Code oder ein Wiederherstellungscode. */
export function AnmeldenSeite() {
  const t = useT();
  const a = t.anmeldung;
  const { weiter, eingerichtet } = route.useSearch();
  const abschliessen = useAnmeldungAbschliessen();
  const { data: umgebung } = useQuery(umgebungAbfrage());
  const [schritt, setSchritt] = useState<"zugang" | "code">("zugang");
  const [wiederherstellung, setWiederherstellung] = useState(false);
  const [werte, setWerte] = useState({ email: "", passwort: "", code: "" });
  const { laeuft, fehler, ausfuehren, setFehler } = useAnmeldeschritt();
  // Weitere Anmeldewege (Single Sign-On) bringt eine Erweiterung mit; der Kern kennt nur Adresse, Passwort und zweiten Faktor.
  const weitereWege = alle("anmeldung");

  function zugang(e: FormEvent) {
    e.preventDefault();
    void ausfuehren(async () => {
      const antwort = await authAnfrage<{ twoFactorRedirect?: boolean }>("/sign-in/email", { email: werte.email.trim(), password: werte.passwort });
      // Das Passwort wird nicht länger gehalten als nötig.
      setWerte((alt) => ({ ...alt, passwort: "" }));
      if (antwort.twoFactorRedirect) {
        setSchritt("code");
        return;
      }
      await abschliessen(weiter, { cacheLeeren: true });
    });
  }

  function code(e: FormEvent) {
    e.preventDefault();
    void ausfuehren(async () => {
      // Kein „Gerät merken“: Es wird nie `trustDevice` gesendet; jede Anmeldung verlangt den Code (Entscheidung 87).
      await authAnfrage(wiederherstellung ? "/two-factor/verify-backup-code" : "/two-factor/verify-totp", { code: werte.code.trim() });
      await abschliessen(weiter, { cacheLeeren: true });
    });
  }

  function zurueck() {
    setSchritt("zugang");
    setWiederherstellung(false);
    setWerte((alt) => ({ ...alt, code: "" }));
    setFehler(null);
  }

  if (schritt === "code") {
    return (
      <section className="app-auth__karte" aria-labelledby="anmelden-titel">
        <h1 id="anmelden-titel" className="cw-t-titel">
          {wiederherstellung ? a.wiederherstellungTitel : a.codeTitel}
        </h1>
        <p className="app-leer-text">{wiederherstellung ? a.wiederherstellungText : a.codeText}</p>
        <form className="app-formular" onSubmit={code} noValidate>
          <FehlerHinweis fehler={fehler} />
          <Feld
            key={wiederherstellung ? "wiederherstellung" : "code"}
            label={wiederherstellung ? a.wiederherstellungsCode : a.code}
            name="code"
            value={werte.code}
            onChange={(e) => setWerte((alt) => ({ ...alt, code: e.target.value }))}
            inputMode={wiederherstellung ? "text" : "numeric"}
            autoComplete="one-time-code"
            autoCapitalize="off"
            spellCheck={false}
            required
            autoFocus
            zahl
          />
          <Button type="submit" disabled={laeuft || werte.code.trim() === ""}>
            {laeuft ? a.laeuft : a.bestaetigen}
          </Button>
          <div className="app-aktionen__knoepfe">
            <Button
              variante="ruhig"
              onClick={() => {
                setWiederherstellung((w) => !w);
                setWerte((alt) => ({ ...alt, code: "" }));
                setFehler(null);
              }}
            >
              {wiederherstellung ? a.zumCode : a.wiederherstellung}
            </Button>
            <Button variante="ruhig" onClick={zurueck}>
              {a.zurueck}
            </Button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="app-auth__karte" aria-labelledby="anmelden-titel">
      <h1 id="anmelden-titel" className="cw-t-titel">
        {a.titel}
      </h1>
      <p className="app-leer-text">{a.untertitel}</p>
      {eingerichtet ? <Hinweis>{a.eingerichtet}</Hinweis> : null}
      <form className="app-formular" onSubmit={zugang} noValidate>
        <FehlerHinweis fehler={fehler} />
        <Feld label={a.email} name="email" type="email" value={werte.email} onChange={(e) => setWerte((alt) => ({ ...alt, email: e.target.value }))} autoComplete="username" required autoFocus />
        <Feld label={a.passwort} name="passwort" type="password" value={werte.passwort} onChange={(e) => setWerte((alt) => ({ ...alt, passwort: e.target.value }))} autoComplete="current-password" required />
        <Button type="submit" disabled={laeuft || werte.email.trim() === "" || werte.passwort === ""}>
          {laeuft ? a.laeuft : a.anmelden}
        </Button>
      </form>
      {umgebung?.anmeldung.passwortZuruecksetzen ? (
        <p className="app-leer-text app-auth__fuss">
          <Link to="/passwort-vergessen">{a.passwortVergessen}</Link>
        </p>
      ) : null}
      {weitereWege.map((Weg, i) => (
        <Weg key={i} weiter={weiter} laeuft={laeuft} ausfuehren={ausfuehren} />
      ))}
      {umgebung?.einrichtungOffen ? (
        <p className="app-leer-text app-auth__fuss">
          {a.neueInstallation} <Link to="/einrichtung">{a.einrichten}</Link>
        </p>
      ) : null}
    </section>
  );
}
