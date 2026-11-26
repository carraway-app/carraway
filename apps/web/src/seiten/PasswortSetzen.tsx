import { useState, type FormEvent } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { Button, Feld, Hinweis } from "@carraway/ui";
import { ApiFehler, authAnfrage } from "../api/client";
import { useAnmeldeschritt } from "../komponenten/anmeldeschritt";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { MINDESTLAENGE_PASSWORT } from "../lib/passwort";
import { useT } from "../i18n";

/** Das Token steht im Fragment der Adresse (`#token=…`): Es erreicht weder den Server noch ein Zugriffsprotokoll noch den Referer. */
const tokenAus = (hash: string): string => /(?:^|[#&])token=([A-Za-z0-9_-]+)/.exec(hash)?.[1] ?? "";

/**
 * Neues Passwort mit dem Link aus der Mail festlegen: Zurücksetzen und Einladung teilen sich diese Seite. Danach folgt die Anmeldung wie immer mit dem
 * zweiten Faktor (bei einer Einladung mit dessen Einrichtung). Ein ungültiger oder abgelaufener Link wird als solcher gemeldet.
 */
export function PasswortSetzenSeite() {
  const t = useT();
  const s = t.anmeldung.setzen;
  const hash = useLocation({ select: (ort) => ort.hash });
  // Einmal beim Öffnen gelesen: Das Token bleibt auch bestehen, falls die Adresse später wechselt.
  const [token] = useState(() => tokenAus(hash));
  const [werte, setWerte] = useState({ neu: "", wiederholt: "" });
  const [versucht, setVersucht] = useState(false);
  const [fertig, setFertig] = useState(false);
  const { laeuft, fehler, ausfuehren } = useAnmeldeschritt();
  const zuKurz = werte.neu.length < MINDESTLAENGE_PASSWORT;
  const ungleich = werte.neu !== werte.wiederholt;
  const ungueltig = token === "" || (fehler instanceof ApiFehler && fehler.code === "INVALID_TOKEN");

  function speichern(e: FormEvent) {
    e.preventDefault();
    setVersucht(true);
    if (zuKurz || ungleich) return;
    void ausfuehren(async () => {
      await authAnfrage("/reset-password", { token, newPassword: werte.neu });
      setWerte({ neu: "", wiederholt: "" });
      setFertig(true);
    });
  }

  if (fertig) {
    return (
      <section className="app-auth__karte" aria-labelledby="setzen-titel">
        <h1 id="setzen-titel" className="cw-t-titel">
          {s.fertigTitel}
        </h1>
        <Hinweis>{s.fertigText}</Hinweis>
        <p className="app-leer-text app-auth__fuss">
          <Link to="/anmelden" search={{}}>
            {t.anmeldung.zurueck}
          </Link>
        </p>
      </section>
    );
  }
  if (ungueltig) {
    return (
      <section className="app-auth__karte" aria-labelledby="setzen-titel">
        <h1 id="setzen-titel" className="cw-t-titel">
          {s.ungueltigTitel}
        </h1>
        <Hinweis>{s.ungueltigText}</Hinweis>
        <p className="app-leer-text app-auth__fuss">
          <Link to="/anmelden" search={{}}>
            {t.anmeldung.zurueck}
          </Link>
        </p>
      </section>
    );
  }
  return (
    <section className="app-auth__karte" aria-labelledby="setzen-titel">
      <h1 id="setzen-titel" className="cw-t-titel">
        {s.titel}
      </h1>
      <Hinweis>{s.einleitung}</Hinweis>
      <form className="app-formular" onSubmit={speichern} noValidate>
        <FehlerHinweis fehler={fehler} />
        <Feld
          label={t.passwort.neu}
          hilfe={t.passwort.neuHilfe(MINDESTLAENGE_PASSWORT)}
          fehler={versucht && zuKurz ? t.passwort.zuKurz(MINDESTLAENGE_PASSWORT) : undefined}
          name="neu"
          type="password"
          value={werte.neu}
          onChange={(e) => setWerte((w) => ({ ...w, neu: e.target.value }))}
          autoComplete="new-password"
          required
          autoFocus
        />
        <Feld
          label={t.passwort.wiederholt}
          fehler={versucht && ungleich ? t.passwort.ungleich : undefined}
          name="wiederholt"
          type="password"
          value={werte.wiederholt}
          onChange={(e) => setWerte((w) => ({ ...w, wiederholt: e.target.value }))}
          autoComplete="new-password"
          required
        />
        <Button type="submit" disabled={laeuft || werte.neu === ""}>
          {s.senden}
        </Button>
      </form>
    </section>
  );
}
