import { useState, type FormEvent } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { Button, Feld, Hinweis } from "@carraway/ui";
import { authAnfrage } from "../api/client";
import { useAbmelden } from "../komponenten/abmelden";
import { useAnmeldeschritt, useAnmeldungAbschliessen } from "../komponenten/anmeldeschritt";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { MINDESTLAENGE_PASSWORT } from "../lib/passwort";
import { useT } from "../i18n";

const route = getRouteApi("/passwort-aendern");

/** Startpasswort ersetzen: Bis dahin antwortet die API auf alles andere mit 403 `PASSWORT_AENDERN`. */
export function PasswortAendernSeite() {
  const t = useT();
  const p = t.passwort;
  const { weiter } = route.useSearch();
  const abschliessen = useAnmeldungAbschliessen();
  const abmelden = useAbmelden();
  const [werte, setWerte] = useState({ alt: "", neu: "", wiederholt: "" });
  const [versucht, setVersucht] = useState(false);
  const { laeuft, fehler, ausfuehren } = useAnmeldeschritt();
  const zuKurz = werte.neu.length < MINDESTLAENGE_PASSWORT;
  const ungleich = werte.neu !== werte.wiederholt;
  const gleichAlt = werte.neu !== "" && werte.neu === werte.alt;

  function speichern(e: FormEvent) {
    e.preventDefault();
    setVersucht(true);
    if (zuKurz || ungleich || gleichAlt) return;
    void ausfuehren(async () => {
      await authAnfrage("/change-password", { currentPassword: werte.alt, newPassword: werte.neu, revokeOtherSessions: true });
      setWerte({ alt: "", neu: "", wiederholt: "" });
      await abschliessen(weiter);
    });
  }

  return (
    <section className="app-auth__karte" aria-labelledby="pw-titel">
      <h1 id="pw-titel" className="cw-t-titel">
        {p.titel}
      </h1>
      <Hinweis>{p.einleitung}</Hinweis>
      <form className="app-formular" onSubmit={speichern} noValidate>
        <FehlerHinweis fehler={fehler} />
        <Feld label={p.alt} name="alt" type="password" value={werte.alt} onChange={(e) => setWerte((w) => ({ ...w, alt: e.target.value }))} autoComplete="current-password" required autoFocus />
        <Feld
          label={p.neu}
          hilfe={p.neuHilfe(MINDESTLAENGE_PASSWORT)}
          fehler={versucht && zuKurz ? p.zuKurz(MINDESTLAENGE_PASSWORT) : versucht && gleichAlt ? p.gleichAlt : undefined}
          name="neu"
          type="password"
          value={werte.neu}
          onChange={(e) => setWerte((w) => ({ ...w, neu: e.target.value }))}
          autoComplete="new-password"
          required
        />
        <Feld
          label={p.wiederholt}
          fehler={versucht && ungleich ? p.ungleich : undefined}
          name="wiederholt"
          type="password"
          value={werte.wiederholt}
          onChange={(e) => setWerte((w) => ({ ...w, wiederholt: e.target.value }))}
          autoComplete="new-password"
          required
        />
        <Button type="submit" disabled={laeuft || werte.alt === "" || werte.neu === ""}>
          {p.speichern}
        </Button>
      </form>
      <div>
        <Button variante="ruhig" disabled={abmelden.laeuft} onClick={() => void abmelden.abmelden()}>
          {t.konto.abmelden}
        </Button>
      </div>
    </section>
  );
}
