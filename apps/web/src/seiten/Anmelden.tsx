import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Button, CodeEingabe, Feld, Hinweis, Logo } from "@carraway/ui";
import { umgebungAbfrage } from "../api/anmeldung";
import { authAnfrage } from "../api/client";
import { useAnmeldeschritt, useAnmeldungAbschliessen } from "../komponenten/anmeldeschritt";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { useT } from "../i18n";
import { alle } from "../erweiterung";

const route = getRouteApi("/anmelden");

/** Nur die Form einer Adresse; ob ein Konto dazu besteht, erfährt die Seite nie vor dem Passwort. */
const GUELTIGE_ADRESSE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Anmeldung in drei Schritten: Adresse, Passwort, danach (bei eingerichtetem zweiten Faktor) der Code oder ein Wiederherstellungscode.
 * Zwischen Adresse und Passwort geht keine Anfrage an den Server: Jede gültig geformte Adresse führt zum Passwortschritt, ein Fehler
 * kommt erst nach dem Passwort und immer mit derselben Meldung.
 */
export function AnmeldenSeite() {
  const t = useT();
  const a = t.anmeldung;
  const { weiter, eingerichtet } = route.useSearch();
  const abschliessen = useAnmeldungAbschliessen();
  const { data: umgebung } = useQuery(umgebungAbfrage());
  const [schritt, setSchritt] = useState<"email" | "passwort" | "code">("email");
  const [wiederherstellung, setWiederherstellung] = useState(false);
  const [werte, setWerte] = useState({ email: "", passwort: "", code: "" });
  const [emailFehler, setEmailFehler] = useState(false);
  // Nach einem falschen Code werden die Felder neu aufgebaut: leer, Fokus im ersten.
  const [codeVersuch, setCodeVersuch] = useState(0);
  const { laeuft, fehler, ausfuehren, setFehler } = useAnmeldeschritt();
  // Weitere Anmeldewege (Single Sign-On) bringt eine Erweiterung mit; der Kern kennt nur Adresse, Passwort und zweiten Faktor.
  const weitereWege = alle("anmeldung");

  function adresse(e: FormEvent) {
    e.preventDefault();
    const email = werte.email.trim();
    if (!GUELTIGE_ADRESSE.test(email)) {
      setEmailFehler(true);
      return;
    }
    setEmailFehler(false);
    setWerte((alt) => ({ ...alt, email }));
    setFehler(null);
    setSchritt("passwort");
  }

  function passwort(e: FormEvent) {
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

  function codePruefen(code: string) {
    void ausfuehren(async () => {
      try {
        // Kein „Gerät merken“: Es wird nie `trustDevice` gesendet; jede Anmeldung verlangt den Code (Entscheidung 87).
        await authAnfrage(wiederherstellung ? "/two-factor/verify-backup-code" : "/two-factor/verify-totp", { code: code.trim() });
        await abschliessen(weiter, { cacheLeeren: true });
      } catch (f) {
        if (!wiederherstellung) {
          setWerte((alt) => ({ ...alt, code: "" }));
          setCodeVersuch((n) => n + 1);
        }
        throw f;
      }
    });
  }

  function code(e: FormEvent) {
    e.preventDefault();
    codePruefen(werte.code);
  }

  function zurAdresse() {
    setSchritt("email");
    setWiederherstellung(false);
    setWerte((alt) => ({ ...alt, passwort: "", code: "" }));
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
          {wiederherstellung ? (
            <Feld
              key="wiederherstellung"
              label={a.wiederherstellungsCode}
              name="code"
              value={werte.code}
              onChange={(e) => setWerte((alt) => ({ ...alt, code: e.target.value }))}
              inputMode="text"
              autoComplete="one-time-code"
              autoCapitalize="off"
              spellCheck={false}
              required
              autoFocus
              zahl
            />
          ) : (
            <CodeEingabe
              key={codeVersuch}
              label={a.codeGruppe}
              ziffer={a.ziffer}
              name="code"
              value={werte.code}
              onChange={(c) => setWerte((alt) => ({ ...alt, code: c }))}
              onFertig={codePruefen}
              autoFocus
            />
          )}
          <Button type="submit" disabled={laeuft || (wiederherstellung ? werte.code.trim() === "" : werte.code.length < 6)}>
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
            <Button variante="ruhig" onClick={zurAdresse}>
              {a.zurueck}
            </Button>
          </div>
        </form>
      </section>
    );
  }

  if (schritt === "passwort") {
    return (
      <section className="app-auth__karte" aria-labelledby="anmelden-titel">
        <h1 id="anmelden-titel" className="cw-t-titel">
          {a.titel}
        </h1>
        <div className="app-auth__adresse">
          <span className="app-auth__adresse-text">{werte.email}</span>
          <Button variante="ruhig" onClick={zurAdresse}>
            {a.aendern}
          </Button>
        </div>
        <form className="app-formular" onSubmit={passwort} noValidate>
          <FehlerHinweis fehler={fehler} />
          {/* Für Passwortmanager: Die Adresse bleibt als Benutzername im Formular, auch wenn sie oben nur gelesen wird. */}
          <input type="email" name="email" className="cw-nur-lesen" tabIndex={-1} aria-hidden="true" autoComplete="username" value={werte.email} readOnly />
          <Feld label={a.passwort} name="passwort" type="password" value={werte.passwort} onChange={(e) => setWerte((alt) => ({ ...alt, passwort: e.target.value }))} autoComplete="current-password" required autoFocus />
          <Button type="submit" disabled={laeuft || werte.passwort === ""}>
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
      </section>
    );
  }

  return (
    <section className="app-auth__karte" aria-labelledby="anmelden-titel">
      <Logo nurZeichen className="app-auth__zeichen" />
      <h1 id="anmelden-titel" className="cw-t-titel app-auth__titel">
        {a.titel}
      </h1>
      {eingerichtet ? <Hinweis>{a.eingerichtet}</Hinweis> : null}
      <form className="app-formular" onSubmit={adresse} noValidate>
        <Feld
          label={a.email}
          name="email"
          type="email"
          value={werte.email}
          onChange={(e) => {
            setWerte((alt) => ({ ...alt, email: e.target.value }));
            setEmailFehler(false);
          }}
          fehler={emailFehler ? a.emailUngueltig : undefined}
          autoComplete="username"
          required
          autoFocus
        />
        <Button type="submit">{a.weiter}</Button>
      </form>
      {umgebung?.einrichtungOffen ? (
        <p className="app-leer-text app-auth__fuss">
          {a.neueInstallation} <Link to="/einrichtung">{a.einrichten}</Link>
        </p>
      ) : null}
    </section>
  );
}
