import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Feld, Hinweis, Markdown, Textbereich, formatDatum } from "@carraway/ui";
import { heuteIso } from "../api/datum";
import { periodensperre, useSperreSetzen } from "../api/verwaltung";
import { useSprache, useT } from "../i18n";
import { feldText } from "../i18n/fehler";
import { formatZeitpunkt } from "../lib/zeit";
import { FehlerHinweis } from "./FehlerHinweis";
import { useFormular } from "./formular";
import { datumRegel, pflichtRegel } from "../lib/feldpruefung";

export default function FondsPeriodensperre({ fondsId }: { fondsId: string }) {
  const t = useT();
  const sprache = useSprache();
  const v = t.verwaltung.sperre;
  const { data, isPending, error } = useQuery(periodensperre(fondsId));
  const setzen = useSperreSetzen(fondsId);
  const aktuell = data?.gesperrtBis ?? null;
  // Ohne eigene Eingabe gilt die aktuelle Sperre; das Datum wird so geprüft, wie es gesetzt würde.
  const { werte, feld, pruefeAlle, zuruecksetzen } = useFormular(
    { gesperrtBis: "", grund: "" },
    {
      gesperrtBis: (wert, alle, k) => datumRegel<Record<string, string>>({ pflicht: true, max: heuteIso() })(wert || aktuell || "", alle, k),
      // Wer die Sperre zurücknimmt, muss einen Grund angeben.
      grund: (wert, alle, k) => (aktuell !== null && (alle.gesperrtBis || aktuell) < aktuell ? pflichtRegel<Record<string, string>>()(wert, alle, k) : undefined),
    },
  );
  const [fertig, setFertig] = useState(false);
  const datum = werte.gesperrtBis || aktuell || "";
  const zurueck = aktuell !== null && datum !== "" && datum < aktuell;

  return (
    <>
      {isPending ? <p className="app-leer-text">{t.gemeinsam.laedt}</p> : null}
      <FehlerHinweis fehler={error} />
      {data ? (
        <dl className="app-fakten">
          <div>
            <dt>{v.aktuell}</dt>
            <dd>{aktuell ? formatDatum(aktuell, sprache) : v.keine}</dd>
          </div>
          {data.gesetztAm ? (
            <div>
              <dt>{v.gesetzt}</dt>
              <dd>{v.gesetztVon(data.gesetztVonName ?? t.rechte.unbekanntePerson, formatZeitpunkt(data.gesetztAm, sprache))}</dd>
            </div>
          ) : null}
          {data.grund ? (
            <div>
              <dt>{v.grund}</dt>
              <dd>
                <Markdown text={data.grund} />
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setFertig(false);
          if (!pruefeAlle()) return;
          setzen.mutate({ gesperrtBis: datum, ...(werte.grund.trim() ? { grund: werte.grund.trim() } : {}) }, {
              onSuccess: () => {
                setFertig(true);
                zuruecksetzen();
              },
            });
        }}
      >
        <FehlerHinweis fehler={setzen.error} bekannt={["gesperrtBis", "grund"]} />
        {fertig ? <Hinweis>{v.gesetztMeldung}</Hinweis> : null}
        <Feld
          label={v.datum}
          type="date"
          max={heuteIso()}
          hilfe={v.datumHilfe}
          {...feld("gesperrtBis", feldText(t, setzen.error, "gesperrtBis"))}
          value={datum}
        />
        <Textbereich
          markdown
          label={zurueck ? v.grundPflicht : v.grundOptional}
          rows={3}
          hilfe={zurueck ? v.zurueckHinweis : undefined}
          {...feld("grund", feldText(t, setzen.error, "grund"))}
          aria-required={zurueck || undefined}
        />
        <div>
          <Button type="submit" disabled={setzen.isPending}>
            {zurueck ? v.zuruecknehmen : v.setzen}
          </Button>
        </div>
      </form>
    </>
  );
}
