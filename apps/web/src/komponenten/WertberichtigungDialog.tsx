import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Feld, Hinweis, Seitenpanel } from "@carraway/ui";
import { instrumentdaten } from "../api/abfragen";
import { heuteIso } from "../api/datum";
import { useVorgangAnlegen } from "../api/mutationen";
import { feldText } from "../i18n/fehler";
import { useSprache, useT } from "../i18n";
import { formatBetragCent } from "../lib/zahl";
import { FehlerHinweis } from "./FehlerHinweis";
import { betragOderNichts, textOderNichts, useFormular } from "./formular";
import { BetragFeld } from "./BetragFeld";
import { betragRegel, datumRegel } from "../lib/feldpruefung";

const FELDER = ["valuta", "betrag", "bemerkung", "instrumentId"];

/**
 * Bilanzielle Wertberichtigung eines Instruments: Technisch ein Vorgang `wertberichtigung`, fachlich gehört sie zur Bewertung. Sie senkt den Buchwert
 * (Zuführung positiv, Auflösung negativ), nicht den beizulegenden Wert.
 */
export function WertberichtigungDialog({ beteiligungId, onSchliessen }: { beteiligungId: string; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.bewertungen.wertberichtigung;
  const { data } = useQuery(instrumentdaten(beteiligungId));
  const anlegen = useVorgangAnlegen(beteiligungId);
  const instrumente = (data?.instrumente ?? []).filter((i) => i.status === "aktiv");
  const { werte, feld, pruefeAlle } = useFormular({ instrumentId: "", valuta: heuteIso(), betrag: "", begruendung: "" }, { valuta: datumRegel({ pflicht: true }), betrag: betragRegel({ vorzeichen: "ungleichNull", pflicht: true }) });
  const [buchwert, setBuchwert] = useState<string | null>(null);
  const fehler = (name: string) => feldText(t, anlegen.error, name);
  // Mit genau einem Instrument ist es vorbelegt.
  const instrumentId = instrumente.some((i) => i.id === werte.instrumentId) ? werte.instrumentId : instrumente.length === 1 ? instrumente[0]!.id : "";

  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titel}</h2>
      {buchwert !== null ? (
        <Hinweis>{f.gebucht(formatBetragCent(buchwert, sprache))}</Hinweis>
      ) : (
        <form
          className="app-formular"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!pruefeAlle()) return;
            anlegen.mutate(
              { art: "wertberichtigung", valuta: werte.valuta, betrag: betragOderNichts(werte.betrag, sprache) ?? "", instrumentId, ...(textOderNichts(werte.begruendung) ? { bemerkung: textOderNichts(werte.begruendung) } : {}) },
              { onSuccess: (ergebnis) => setBuchwert(ergebnis.buchwert) },
            );
          }}
        >
          <p className="app-leer-text">{f.hinweis}</p>
          <FehlerHinweis fehler={anlegen.error} bekannt={FELDER} />
          <Auswahl label={f.instrument} {...feld("instrumentId")} value={instrumentId} required fehler={fehler("instrumentId")}>
            {instrumente.length !== 1 ? <option value="" /> : null}
            {instrumente.map((i) => (
              <option key={i.id} value={i.id}>
                {i.bezeichnung}
              </option>
            ))}
          </Auswahl>
          <Feld label={f.valuta} type="date" required {...feld("valuta", fehler("valuta"))} />
          <BetragFeld label={f.betrag} required {...feld("betrag", fehler("betrag"))} />
          <Feld label={f.begruendung} autoComplete="off" {...feld("begruendung")} fehler={fehler("bemerkung")} />
          <div>
            <Button type="submit" disabled={anlegen.isPending || instrumentId === ""}>
              {f.speichern}
            </Button>
          </div>
        </form>
      )}
    </Seitenpanel>
  );
}
