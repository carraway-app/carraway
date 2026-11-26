import { useState } from "react";
import { Auswahl, Button, Feld, Hinweis, Segment, Seitenpanel, Textbereich } from "@carraway/ui";
import { heuteIso } from "../api/datum";
import { useFondsZusageAendern } from "../api/verwaltung";
import { useSprache, useT } from "../i18n";
import { feldText } from "../i18n/fehler";
import { betragRegel, datumRegel } from "../lib/feldpruefung";
import { formatBetragCent } from "../lib/zahl";
import { BetragFeld } from "./BetragFeld";
import { FehlerHinweis } from "./FehlerHinweis";
import { betragOderNichts, textOderNichts, useFormular, useZeilenpruefung } from "./formular";

interface Props {
  fondsId: string;
  zeichnungskapital: string;
  waehrung: string;
  /** Investoren mit Zusage im Fonds, die noch nicht ausgetreten sind; `abgerufen` ist die Untergrenze einer verringerten Zusage. */
  investoren: { id: string; name: string; zusage: string; abgerufen: string }[];
  onSchliessen: () => void;
  onErfolg: () => void;
}

const zusageRegel = betragRegel({ vorzeichen: "positiv", pflicht: true });
const ausgleichRegel = betragRegel({ vorzeichen: "positiv" });
const leereZeile = (id: number) => ({ id, organisationId: "", neueZusage: "", ausgleich: "", ausgleichDatum: "" });

/** Verringerung der Zusage oder Austritt (Issue #132): datierter Vorgang mit optional dokumentierter Rückzahlung oder Abfindung je Investor. */
export function FondsZusageAenderungDialog({ fondsId, zeichnungskapital, waehrung, investoren, onSchliessen, onErfolg }: Props) {
  const t = useT();
  const sprache = useSprache();
  const c = t.verwaltung.investoren.fonds.closing;
  const a = c.aenderung;
  const speichern = useFondsZusageAendern(fondsId);
  const [art, setArt] = useState<"verringerung" | "austritt">("verringerung");
  const kopf = useFormular({ wirksamAm: heuteIso(), bemerkung: "" }, { wirksamAm: datumRegel({ pflicht: true }) });
  const [zeilen, setZeilen] = useState([leereZeile(0)]);
  const [naechsteId, setNaechsteId] = useState(1);
  const zeilenpruefung = useZeilenpruefung();
  const je = new Map(investoren.map((i) => [i.id, i]));

  function aendern(id: number, werte: Partial<Omit<ReturnType<typeof leereZeile>, "id">>) {
    setZeilen((alt) => alt.map((zeile) => (zeile.id === id ? { ...zeile, ...werte } : zeile)));
  }
  const ausgleichPflicht = (wert: string, anderes: string) => (wert.trim() === "" && anderes.trim() !== "" ? { code: "pflicht" as const } : undefined);

  return (
    <Seitenpanel titel={a.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{a.titel}</h2>
      <p>{a.beschreibung}</p>
      <Hinweis>{art === "austritt" ? a.wirkungAustritt : a.wirkungVerringerung}</Hinweis>
      <p>{c.kapital} <strong>{formatBetragCent(zeichnungskapital, sprache, waehrung)}</strong></p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const kopfOk = kopf.pruefeAlle();
          const zeilenOk = zeilenpruefung.pruefeAlle();
          if (!kopfOk || !zeilenOk || zeilen.some((z) => z.organisationId === "")) return;
          speichern.mutate(
            {
              art,
              wirksamAm: kopf.werte.wirksamAm,
              ...(textOderNichts(kopf.werte.bemerkung) ? { bemerkung: textOderNichts(kopf.werte.bemerkung)! } : {}),
              investoren: zeilen.map((z) => ({
                organisationId: z.organisationId,
                ...(art === "verringerung" ? { neueZusage: betragOderNichts(z.neueZusage, sprache) ?? "" } : {}),
                ...(betragOderNichts(z.ausgleich, sprache) ? { ausgleich: { betrag: betragOderNichts(z.ausgleich, sprache)!, datum: z.ausgleichDatum } } : {}),
              })),
            },
            { onSuccess: onErfolg },
          );
        }}
      >
        <FehlerHinweis fehler={speichern.error} bekannt={["wirksamAm", "bemerkung"]} />
        <Segment
          aria-label={a.art}
          value={art}
          onChange={setArt}
          options={[{ wert: "verringerung", label: c.artVerringerung }, { wert: "austritt", label: c.artAustritt }]}
        />
        <div className="cw-formularraster">
          <Feld label={c.wirksamAm} type="date" required {...kopf.feld("wirksamAm", feldText(t, speichern.error, "wirksamAm"))} />
        </div>
        <Textbereich label={c.bemerkung} {...kopf.feld("bemerkung")} fehler={feldText(t, speichern.error, "bemerkung")} />
        {zeilen.map(({ id, organisationId, neueZusage, ausgleich, ausgleichDatum }) => {
          const gewaehlt = je.get(organisationId);
          return (
            <fieldset className="app-formular" key={id}>
              <div className="cw-formularraster">
                <Auswahl
                  label={t.verwaltung.investoren.form.organisation}
                  required
                  value={organisationId}
                  onChange={(e) => aendern(id, { organisationId: e.target.value })}
                  hilfe={gewaehlt ? a.stand(formatBetragCent(gewaehlt.zusage, sprache, waehrung), formatBetragCent(gewaehlt.abgerufen, sprache, waehrung)) : undefined}
                  fehler={zeilenpruefung.pruefe(`o${id}`, (w) => (w === "" ? { code: "pflicht" } : undefined), organisationId).fehler}
                >
                  <option value="">{t.verwaltung.investoren.organisationWaehlen}</option>
                  {investoren.map((o) => (
                    <option key={o.id} value={o.id} disabled={zeilen.some((andere) => andere.id !== id && andere.organisationId === o.id)}>
                      {o.name}
                    </option>
                  ))}
                </Auswahl>
                {art === "verringerung" ? (
                  <BetragFeld
                    label={a.neueZusage}
                    required
                    name={`neue-zusage-${id}`}
                    value={neueZusage}
                    onChange={(e) => aendern(id, { neueZusage: e.target.value })}
                    {...zeilenpruefung.pruefe(`z${id}`, zusageRegel, neueZusage)}
                  />
                ) : null}
              </div>
              <div className="cw-formularraster">
                <BetragFeld
                  label={a.ausgleich}
                  hilfe={a.ausgleichHilfe}
                  name={`abfindung-${id}`}
                  value={ausgleich}
                  onChange={(e) => aendern(id, { ausgleich: e.target.value })}
                  {...zeilenpruefung.pruefe(`a${id}`, (w, ws, k) => ausgleichRegel(w, ws, k) ?? ausgleichPflicht(w, ausgleichDatum), ausgleich)}
                />
                <Feld
                  label={a.ausgleichDatum}
                  type="date"
                  name={`abfindung-datum-${id}`}
                  value={ausgleichDatum}
                  onChange={(e) => aendern(id, { ausgleichDatum: e.target.value })}
                  {...zeilenpruefung.pruefe(`d${id}`, (w, ws, k) => (w.trim() === "" ? ausgleichPflicht(w, ausgleich) : datumRegel()(w, ws, k)), ausgleichDatum)}
                />
              </div>
              {zeilen.length > 1 ? <div><Button variante="ruhig" onClick={() => setZeilen((alt) => alt.filter((zeile) => zeile.id !== id))}>{t.gemeinsam.entfernen}</Button></div> : null}
            </fieldset>
          );
        })}
        <div className="app-knoepfe">
          <Button
            variante="sekundaer"
            disabled={zeilen.length >= Math.min(200, investoren.length)}
            onClick={() => {
              setZeilen((alt) => [...alt, leereZeile(naechsteId)]);
              setNaechsteId(naechsteId + 1);
            }}
          >
            {t.verwaltung.investoren.fonds.zeichnungen.weitere}
          </Button>
          <Button type="submit" disabled={speichern.isPending}>{a.speichern}</Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
