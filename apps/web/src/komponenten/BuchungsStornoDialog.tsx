import { Button, Feld, Seitenpanel, formatDatum } from "@carraway/ui";
import type { JournalZeile } from "../api/abfragen";
import { useBewegungStorno, useStorno } from "../api/mutationen";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { feldText } from "../i18n/fehler";
import { formatBetragCent } from "../lib/zahl";
import { FehlerHinweis } from "./FehlerHinweis";
import { textOderNichts, useFormular } from "./formular";

type StornierbareBuchung = Pick<JournalZeile, "quelle" | "id" | "valuta" | "typ" | "betrag">;

/** Storno eines Beteiligungsvorgangs oder einer Fondsbewegung mit Grund und optionaler Valuta. */
export function BuchungsStornoDialog({ zeile, waehrung, onSchliessen, onErfolg }: { zeile: StornierbareBuchung; waehrung: string | undefined; onSchliessen: () => void; onErfolg: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.stornoForm;
  const vorgang = useStorno();
  const bewegung = useBewegungStorno();
  const mutation = zeile.quelle === "fondsbewegung" ? bewegung : vorgang;
  const { werte, feld } = useFormular({ grund: "", valuta: "" });
  return (
    <Seitenpanel titel={t.journal.stornoTitel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{t.journal.stornoTitel}</h2>
      <p className="app-leer-text">{f.beschreibung(aufzaehlung(t.journal.typen, zeile.typ), formatDatum(zeile.valuta, sprache), formatBetragCent(zeile.betrag ?? "0", sprache, waehrung))}</p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate({ id: zeile.id, grund: werte.grund.trim(), valuta: textOderNichts(werte.valuta) }, { onSuccess: onErfolg });
        }}
      >
        <FehlerHinweis fehler={mutation.error} bekannt={["grund", "valuta"]} />
        <Feld label={f.grund} {...feld("grund")} fehler={feldText(t, mutation.error, "grund")} />
        <Feld label={f.valuta} type="date" min={zeile.valuta} hilfe={f.valutaHilfe} {...feld("valuta")} fehler={feldText(t, mutation.error, "valuta")} />
        <div>
          <Button type="submit" variante="gefahr" disabled={mutation.isPending}>
            {f.stornieren}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
