import { Button, Feld, Seitenpanel, formatDatum } from "@carraway/ui";
import { heuteIso } from "../api/datum";
import { useAusuebung, useAusuebungStorno } from "../api/mutationen";
import { feldText } from "../i18n/fehler";
import { useSprache, useT } from "../i18n";
import { betragRegel, datumRegel, ganzzahlRegel } from "../lib/feldpruefung";
import type { InstrumentZeile } from "../lib/instrumente";
import { formatAnzahl } from "../lib/zahl";
import { BetragFeld } from "./BetragFeld";
import { FehlerHinweis } from "./FehlerHinweis";
import { betragOderNichts, textOderNichts, useFormular } from "./formular";

type Optionsschein = NonNullable<InstrumentZeile["optionsschein"]>;
export type AusuebungZeile = Optionsschein["ausuebungen"][number];

const FELDER = ["date", "shares", "amount", "note"];
const ganzzahl = (wert: string) => wert.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "");

/** Optionsscheine ausüben: Datum, Anzahl, bei abweichender Währung der gezahlte Fondsbetrag. Die API bucht Zusage und Auszahlung des Ausübungsbetrags. */
export function AusuebungDialog({ instrument, onSchliessen }: { instrument: InstrumentZeile; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.optionsschein.form;
  const ausueben = useAusuebung(instrument.id);
  const offen = instrument.optionsschein?.offen ?? "0";
  const { werte, feld, pruefeAlle } = useFormular(
    { date: heuteIso(), shares: "", amount: "", note: "" },
    { date: datumRegel({ pflicht: true }), shares: ganzzahlRegel({ min: 1, pflicht: true }), amount: betragRegel({ vorzeichen: "nichtNegativ" }) },
  );
  const fehler = (name: string) => feldText(t, ausueben.error, name);
  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titel}</h2>
      <p className="app-leer-text">{f.beschreibung}</p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!pruefeAlle()) return;
          ausueben.mutate(
            {
              date: werte.date,
              shares: ganzzahl(werte.shares),
              ...(betragOderNichts(werte.amount, sprache) ? { amount: betragOderNichts(werte.amount, sprache) } : {}),
              ...(textOderNichts(werte.note) ? { note: textOderNichts(werte.note) } : {}),
            },
            { onSuccess: onSchliessen },
          );
        }}
      >
        <FehlerHinweis fehler={ausueben.error} bekannt={FELDER} />
        <Feld label={f.datum} type="date" max={heuteIso()} {...feld("date", fehler("date"))} />
        <BetragFeld label={f.anzahl} inputMode="numeric" hilfe={f.anzahlHilfe(formatAnzahl(offen, sprache))} {...feld("shares", fehler("shares"))} />
        <BetragFeld label={f.betrag} hilfe={f.betragHilfe} {...feld("amount", fehler("amount"))} />
        <Feld label={f.bemerkung} autoComplete="off" {...feld("note", fehler("note"))} />
        <div>
          <Button type="submit" disabled={ausueben.isPending}>
            {f.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

/** Storno einer Ausübung als Ganzes mit Grund. */
export function AusuebungStornoDialog({ instrumentId, ausuebung, onSchliessen }: { instrumentId: string; ausuebung: AusuebungZeile; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.optionsschein.storno;
  const storno = useAusuebungStorno(instrumentId);
  const { werte, feld } = useFormular({ grund: "" });
  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titel}</h2>
      <p className="app-leer-text">{f.beschreibung(formatDatum(ausuebung.datum, sprache), formatAnzahl(ausuebung.anzahl, sprache))}</p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          storno.mutate({ exerciseId: ausuebung.id, reason: werte.grund.trim() }, { onSuccess: onSchliessen });
        }}
      >
        <FehlerHinweis fehler={storno.error} bekannt={["reason"]} />
        <Feld label={f.grund} autoComplete="off" {...feld("grund")} fehler={feldText(t, storno.error, "reason")} />
        <div>
          <Button type="submit" variante="gefahr" disabled={storno.isPending}>
            {f.stornieren}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
