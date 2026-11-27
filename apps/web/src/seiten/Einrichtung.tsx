import { useEffect, useState, type FormEvent } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { Button, Feld, Hinweis } from "@carraway/ui";
import { api, auspacken } from "../api/client";
import { useAnmeldeschritt } from "../komponenten/anmeldeschritt";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { MINDESTLAENGE_PASSWORT } from "../lib/passwort";
import { useT } from "../i18n";

/**
 * Erste Verwalterperson einer leeren Installation. Die API kennt dafür keinen Lesezugriff; ob schon jemand eingerichtet ist,
 * zeigt erst die Antwort (403 `registration_closed`). Danach folgt die Anmeldung, die den zweiten Faktor verlangt.
 */
export function EinrichtungSeite() {
  const t = useT();
  const e = t.einrichtung;
  const router = useRouter();
  const [token, setToken] = useState(() => new URLSearchParams(router.history.location.search).get("token") ?? "");
  useEffect(() => {
    if (new URLSearchParams(router.history.location.search).has("token")) {
      void router.navigate({ to: "/setup", search: {}, replace: true });
    }
  }, [router]);
  const [werte, setWerte] = useState({ name: "", email: "", passwort: "", wiederholt: "" });
  const [versucht, setVersucht] = useState(false);
  const { laeuft, fehler, ausfuehren } = useAnmeldeschritt();
  const zuKurz = werte.passwort.length < MINDESTLAENGE_PASSWORT;
  const ungleich = werte.passwort !== werte.wiederholt;

  function einrichten(ev: FormEvent) {
    ev.preventDefault();
    setVersucht(true);
    if (!token || zuKurz || ungleich) return;
    void ausfuehren(async () => {
      await auspacken(api.api.v1.setup.$post({ json: { token, name: werte.name.trim(), email: werte.email.trim(), password: werte.passwort } }));
      setToken("");
      setWerte({ name: "", email: "", passwort: "", wiederholt: "" });
      await router.navigate({ to: "/sign-in", search: { eingerichtet: true }, replace: true });
    });
  }

  return (
    <section className="app-auth__karte" aria-labelledby="einrichtung-titel">
      <h1 id="einrichtung-titel" className="cw-t-titel">
        {e.titel}
      </h1>
      <Hinweis>{e.einleitung}</Hinweis>
      <form className="app-formular" onSubmit={einrichten} noValidate>
        <FehlerHinweis fehler={fehler} bekannt={["token", "name", "email", "password"]} />
        {/* Das Einrichtungs-Token ist kein Zugang: Passwortmanager bieten hier nichts an (Fachfeld). */}
        <Feld label={e.token} hilfe={e.tokenHilfe} name="token" type="password" value={token}
          onChange={(ev) => setToken(ev.target.value)} maxLength={1024} required />
        <Feld zugang label={e.name} name="name" value={werte.name} onChange={(ev) => setWerte((w) => ({ ...w, name: ev.target.value }))} autoComplete="name" required autoFocus />
        <Feld zugang label={e.email} name="email" type="email" value={werte.email} onChange={(ev) => setWerte((w) => ({ ...w, email: ev.target.value }))} autoComplete="username" required />
        <Feld zugang
          label={e.passwort}
          hilfe={t.passwort.neuHilfe(MINDESTLAENGE_PASSWORT)}
          fehler={versucht && zuKurz ? t.passwort.zuKurz(MINDESTLAENGE_PASSWORT) : undefined}
          name="passwort"
          type="password"
          value={werte.passwort}
          onChange={(ev) => setWerte((w) => ({ ...w, passwort: ev.target.value }))}
          autoComplete="new-password"
          required
        />
        <Feld zugang
          label={t.passwort.wiederholt}
          fehler={versucht && ungleich ? t.passwort.ungleich : undefined}
          name="wiederholt"
          type="password"
          value={werte.wiederholt}
          onChange={(ev) => setWerte((w) => ({ ...w, wiederholt: ev.target.value }))}
          autoComplete="new-password"
          required
        />
        <Button type="submit" disabled={laeuft || !token || werte.name.trim() === "" || werte.email.trim() === "" || werte.passwort === ""}>
          {e.einrichten}
        </Button>
      </form>
      <p className="app-leer-text app-auth__fuss">
        <Link to="/sign-in" search={{}}>
          {e.zurAnmeldung}
        </Link>
      </p>
    </section>
  );
}
