import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button, Feld, Hinweis } from "@carraway/ui";
import { ApiFehler } from "../api/client";
import type { Organisation } from "../api/abfragen";
import { usePersonAendern, usePersonAnlegen } from "../api/mutationen";
import { feldText } from "../i18n/fehler";
import { useT } from "../i18n";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "./FehlerHinweis";
import { KontaktAuswahl, type Treffer } from "./KontaktAuswahl";
import { textOderNichts, textOderNull, useFormular } from "./formular";

type Person = Organisation["personen"][number];

const FELDER = ["vorname", "nachname", "email", "funktion"];

/** Person anlegen (ohne `person`) oder ändern (mit `person`); gehört immer zur Organisation der Seite. */
export function PersonDialog({ organisationId, person, onSchliessen }: { organisationId?: string; person?: Person; onSchliessen: () => void }) {
  const t = useT();
  const anlegen = usePersonAnlegen(organisationId);
  const aendern = usePersonAendern(organisationId ?? "");
  const [unternehmen, setUnternehmen] = useState<Treffer | null>(null);
  const aktion = person ? aendern : anlegen;
  const { werte, feld } = useFormular({
    vorname: person?.vorname ?? "",
    nachname: person?.nachname ?? "",
    email: person?.email ?? "",
    funktion: person?.funktion ?? "",
  });
  const f = t.personForm;
  const titel = person ? f.titelBearbeiten : f.titelNeu;

  // 409 possible_duplicate: ähnliche Personen zeigen, neu anlegen nur nach ausdrücklicher Bestätigung.
  const kandidaten =
    anlegen.error instanceof ApiFehler && anlegen.error.code === "possible_duplicate" && Array.isArray(anlegen.error.zusatz.kandidaten)
      ? (anlegen.error.zusatz.kandidaten as { id: string; vorname: string; nachname: string; email: string | null; grund: "email" | "name" }[])
      : null;

  function senden(bestaetigt = false) {
    const gemeinsam = { vorname: werte.vorname.trim(), nachname: werte.nachname.trim() };
    if (person) {
      aendern.mutate({ id: person.id, json: { ...gemeinsam, email: textOderNull(werte.email), funktion: textOderNull(werte.funktion) } }, { onSuccess: onSchliessen });
    } else {
      anlegen.mutate({ ...gemeinsam, email: textOderNichts(werte.email), funktion: textOderNichts(werte.funktion), ...(unternehmen ? { organisationId: unternehmen.id } : {}), ...(bestaetigt ? { dubletteBestaetigt: true } : {}) }, { onSuccess: onSchliessen });
    }
  }

  return (
    <Seitenpanel titel={titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{titel}</h2>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          senden();
        }}
      >
        {kandidaten ? (
          <Hinweis variante="fehler" titel={t.personDubletten.titel}>
            {t.personDubletten.bestaetigung}
            <ul className="app-dubletten">
              {kandidaten.map((k) => (
                <li key={k.id}>
                  <Link to="/personen/$id" params={{ id: k.id }} target="_blank" rel="noreferrer">
                    {`${k.vorname} ${k.nachname}`}
                  </Link>
                  <span className="app-dubletten__info">{[k.grund === "email" ? t.personDubletten.grundEmail : t.personDubletten.grundName, k.email].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ul>
            <Button variante="gefahr" onClick={() => senden(true)} disabled={aktion.isPending}>
              {t.personDubletten.trotzdemAnlegen}
            </Button>
          </Hinweis>
        ) : (
          <FehlerHinweis fehler={aktion.error} bekannt={FELDER} />
        )}
        <Feld label={f.vorname} autoComplete="off" {...feld("vorname")} fehler={feldText(t, aktion.error, "vorname")} />
        <Feld label={f.nachname} autoComplete="off" {...feld("nachname")} fehler={feldText(t, aktion.error, "nachname")} />
        <Feld label={f.email} type="email" autoComplete="off" {...feld("email")} fehler={feldText(t, aktion.error, "email")} />
        <Feld label={f.funktion} {...feld("funktion")} fehler={feldText(t, aktion.error, "funktion")} />
        {!organisationId && !person ? <KontaktAuswahl art="organisation" label={t.crm.unternehmenOptional} gewaehlt={unternehmen} onWaehlen={setUnternehmen} /> : null}
        <div>
          <Button type="submit" disabled={aktion.isPending}>
            {person ? f.speichern : f.anlegen}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
