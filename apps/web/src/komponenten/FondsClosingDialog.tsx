import { useState } from "react";
import { Button, Feld, Hinweis, Seitenpanel, Textbereich } from "@carraway/ui";
import { heuteIso } from "../api/datum";
import { useFondsClosingAnlegen, useFondsClosingKorrigieren } from "../api/verwaltung";
import { useSprache, useT } from "../i18n";
import { feldText } from "../i18n/fehler";
import { betragRegel, datumRegel, pflichtRegel } from "../lib/feldpruefung";
import { formatBetragCent } from "../lib/zahl";
import { BetragFeld } from "./BetragFeld";
import { FehlerHinweis } from "./FehlerHinweis";
import { VerknuepfungsFeld, type SuchfeldTreffer } from "./Suchfeld";
import { betragFuerFeld, betragOderNichts, textOderNichts, useFormular, useZeilenpruefung } from "./formular";

interface Props {
  fondsId: string;
  zeichnungskapital: string;
  waehrung: string;
  /** Investor-Organisationen, die schon eine Zusage im Fonds haben (Aufstockung statt Beitritt). */
  bestehende: Set<string>;
  /** Korrektur eines Closings (Issue #126): Das alte wird storniert und mit diesen Angaben vorbelegt neu erfasst. */
  korrektur?: {
    closingId: string;
    wirksamAm: string;
    bemerkung: string | null;
    zusagen: { organisationId: string; name: string; zusage: string; ausgleichBetrag: string | null; ausgleichDatum: string | null }[];
  };
  onSchliessen: () => void;
  onErfolg: () => void;
}

const zusageRegel = betragRegel({ vorzeichen: "positiv", pflicht: true });
const ausgleichRegel = betragRegel({ vorzeichen: "positiv" });
const leereZeile = (id: number): Zeile => ({ id, organisation: null, zusage: "", ausgleich: "", ausgleichDatum: "" });
interface Zeile { id: number; organisation: SuchfeldTreffer | null; zusage: string; ausgleich: string; ausgleichDatum: string }

/** Weiteres Closing: neue oder bestehende Investoren mit Wirksamkeitsdatum, optional mit vereinbartem Ausgleich je Investor. */
export function FondsClosingDialog({ fondsId, zeichnungskapital, waehrung, bestehende, korrektur, onSchliessen, onErfolg }: Props) {
  const t = useT();
  const sprache = useSprache();
  const v = t.verwaltung.investoren;
  const c = v.fonds.closing;
  const neu = useFondsClosingAnlegen(fondsId);
  const korrigieren = useFondsClosingKorrigieren(fondsId);
  const anlegen = korrektur ? korrigieren : neu;
  const kopf = useFormular(
    { wirksamAm: korrektur?.wirksamAm ?? heuteIso(), bemerkung: korrektur?.bemerkung ?? "", grund: "" },
    { wirksamAm: datumRegel({ pflicht: true }), ...(korrektur ? { grund: pflichtRegel() } : {}) },
  );
  const [zeilen, setZeilen] = useState<Zeile[]>(() =>
    korrektur
      ? korrektur.zusagen.map((z, id) => ({ id, organisation: { id: z.organisationId, label: z.name }, zusage: betragFuerFeld(z.zusage), ausgleich: betragFuerFeld(z.ausgleichBetrag), ausgleichDatum: z.ausgleichDatum ?? "" }))
      : [leereZeile(0)],
  );
  const [naechsteId, setNaechsteId] = useState(korrektur ? korrektur.zusagen.length : 1);
  const zeilenpruefung = useZeilenpruefung();

  function aendern(id: number, werte: Partial<Omit<Zeile, "id">>) {
    setZeilen((alt) => alt.map((zeile) => (zeile.id === id ? { ...zeile, ...werte } : zeile)));
  }
  // Ausgleich und Datum gehören zusammen: das eine ohne das andere ist ein Fehler am fehlenden Feld.
  const ausgleichPflicht = (wert: string, anderes: string) => (wert.trim() === "" && anderes.trim() !== "" ? { code: "pflicht" as const } : undefined);

  return (
    <Seitenpanel titel={korrektur ? c.korrigierenTitel : c.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{korrektur ? c.korrigierenTitel : c.titel}</h2>
      <p>{korrektur ? c.korrigierenBeschreibung : c.beschreibung}</p>
      <Hinweis>{c.wirkung}</Hinweis>
      <p>{c.kapital} <strong>{formatBetragCent(zeichnungskapital, sprache, waehrung)}</strong></p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const kopfOk = kopf.pruefeAlle();
          const zeilenOk = zeilenpruefung.pruefeAlle();
          if (!kopfOk || !zeilenOk || zeilen.some((z) => z.organisation === null)) return;
          const eingabe = {
            wirksamAm: kopf.werte.wirksamAm,
            ...(textOderNichts(kopf.werte.bemerkung) ? { bemerkung: textOderNichts(kopf.werte.bemerkung)! } : {}),
            zusagen: zeilen.map((z) => ({
              organisationId: z.organisation!.id,
              zusage: betragOderNichts(z.zusage, sprache) ?? "",
              ...(betragOderNichts(z.ausgleich, sprache) ? { ausgleich: { betrag: betragOderNichts(z.ausgleich, sprache)!, datum: z.ausgleichDatum } } : {}),
            })),
          };
          if (korrektur) korrigieren.mutate({ ...eingabe, closingId: korrektur.closingId, grund: kopf.werte.grund.trim() }, { onSuccess: onErfolg });
          else neu.mutate(eingabe, { onSuccess: onErfolg });
        }}
      >
        <FehlerHinweis fehler={anlegen.error} bekannt={["wirksamAm", "bemerkung", "grund"]} />
        <div className="cw-formularraster">
          <Feld label={c.wirksamAm} type="date" required {...kopf.feld("wirksamAm", feldText(t, anlegen.error, "wirksamAm"))} />
        </div>
        <Textbereich label={c.bemerkung} {...kopf.feld("bemerkung")} fehler={feldText(t, anlegen.error, "bemerkung")} />
        {korrektur ? <Feld label={c.korrekturGrund} required {...kopf.feld("grund", feldText(t, anlegen.error, "grund"))} /> : null}
        {zeilen.map(({ id, organisation, zusage, ausgleich, ausgleichDatum }, index) => (
          <fieldset className="app-formular" key={id}>
            <div className="cw-formularraster">
              {/* Suche über die Investor-Organisationen; Investoren anderer Zeilen stehen nicht zur Wahl. */}
              <div>
                <VerknuepfungsFeld
                  label={v.form.organisation}
                  name={`organisation-${id}`}
                  required
                  ziel="organisation"
                  art="investor"
                  ausschliessen={new Set(zeilen.flatMap((andere) => (andere.id !== id && andere.organisation ? [andere.organisation.id] : [])))}
                  wert={organisation}
                  onWahl={(gewaehlt) => aendern(id, { organisation: gewaehlt })}
                  fehler={zeilenpruefung.pruefe(`o${id}`, (w) => (w === "" ? { code: "pflicht" } : undefined), organisation?.id ?? "").fehler}
                />
                {organisation ? <p className="app-leer-text">{bestehende.has(organisation.id) ? c.aufstockung : c.beitritt}</p> : null}
              </div>
              <BetragFeld
                label={c.zusage}
                required
                name={`zusage-${id}`}
                value={zusage}
                onChange={(e) => aendern(id, { zusage: e.target.value })}
                {...zeilenpruefung.pruefe(`z${id}`, zusageRegel, zusage)}
                {...(feldText(t, anlegen.error, `zusagen.${index}.zusage`) ? { fehler: feldText(t, anlegen.error, `zusagen.${index}.zusage`) } : {})}
              />
            </div>
            <div className="cw-formularraster">
              <BetragFeld
                label={c.ausgleich}
                hilfe={c.ausgleichHilfe}
                name={`ausgleich-${id}`}
                value={ausgleich}
                onChange={(e) => aendern(id, { ausgleich: e.target.value })}
                {...zeilenpruefung.pruefe(`a${id}`, (w, ws, k) => ausgleichRegel(w, ws, k) ?? ausgleichPflicht(w, ausgleichDatum), ausgleich)}
              />
              <Feld
                label={c.ausgleichDatum}
                type="date"
                name={`ausgleich-datum-${id}`}
                value={ausgleichDatum}
                onChange={(e) => aendern(id, { ausgleichDatum: e.target.value })}
                {...zeilenpruefung.pruefe(`d${id}`, (w, ws, k) => (w.trim() === "" ? ausgleichPflicht(w, ausgleich) : datumRegel()(w, ws, k)), ausgleichDatum)}
              />
            </div>
            {zeilen.length > 1 ? <div><Button variante="ruhig" onClick={() => setZeilen((alt) => alt.filter((zeile) => zeile.id !== id))}>{t.gemeinsam.entfernen}</Button></div> : null}
          </fieldset>
        ))}
        <div className="app-knoepfe">
          <Button
            variante="sekundaer"
            disabled={zeilen.length >= 200}
            onClick={() => {
              setZeilen((alt) => [...alt, leereZeile(naechsteId)]);
              setNaechsteId(naechsteId + 1);
            }}
          >
            {v.fonds.zeichnungen.weitere}
          </Button>
          <Button type="submit" disabled={anlegen.isPending}>{korrektur ? c.korrigieren : c.speichern}</Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
