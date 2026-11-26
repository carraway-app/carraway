import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button, Feld, Hinweis } from "@carraway/ui";
import { umgebungAbfrage } from "../api/anmeldung";
import { api, auspacken } from "../api/client";
import { useAnmeldeschritt } from "../komponenten/anmeldeschritt";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { useSprache, useT } from "../i18n";

/**
 * Anfrage eines Links zum Zurücksetzen des Passworts. Die Seite zeigt nach dem Absenden immer dieselbe Bestätigung; ob es die Adresse gibt, erfährt
 * nur, wer die Mail erhält. Ohne eingerichteten Mailversand gibt es die Seite nicht (die Anmeldeseite verlinkt sie dann nicht).
 */
export function PasswortVergessenSeite() {
  const t = useT();
  const v = t.anmeldung.vergessen;
  const sprache = useSprache();
  const { data: umgebung } = useQuery(umgebungAbfrage());
  const [email, setEmail] = useState("");
  const [gesendet, setGesendet] = useState(false);
  const { laeuft, fehler, ausfuehren } = useAnmeldeschritt();

  function senden(e: FormEvent) {
    e.preventDefault();
    void ausfuehren(async () => {
      await auspacken(api.api.v1.password.forgot.$post({ json: { email: email.trim(), language: sprache } }));
      setGesendet(true);
    });
  }

  return (
    <section className="app-auth__karte" aria-labelledby="vergessen-titel">
      <h1 id="vergessen-titel" className="cw-t-titel">
        {v.titel}
      </h1>
      {gesendet ? (
        <Hinweis titel={v.gesendetTitel}>{v.gesendetText}</Hinweis>
      ) : umgebung && !umgebung.anmeldung.passwortZuruecksetzen ? (
        <Hinweis>{v.keinMail}</Hinweis>
      ) : (
        <>
          <p className="app-leer-text">{v.einleitung}</p>
          <form className="app-formular" onSubmit={senden} noValidate>
            <FehlerHinweis fehler={fehler} />
            <Feld label={t.anmeldung.email} name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />
            <Button type="submit" disabled={laeuft || email.trim() === ""}>
              {laeuft ? t.anmeldung.laeuft : v.senden}
            </Button>
          </form>
        </>
      )}
      <p className="app-leer-text app-auth__fuss">
        <Link to="/anmelden" search={{}}>
          {v.zurAnmeldung}
        </Link>
      </p>
    </section>
  );
}
