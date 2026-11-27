import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Feld, Hinweis, formatBetrag, formatDatum } from "@carraway/ui";
import { heuteIso } from "../api/datum";
import { beteiligungZinsen, finanzierungsrunden, type Instrumentdaten } from "../api/abfragen";
import { useStorno, useVorgangAnlegen, type NeuerVorgang } from "../api/mutationen";
import { feldText } from "../i18n/fehler";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { formatBetragCent } from "../lib/zahl";
import { VORGANG_GRUPPEN, erlaubtFuer, trancheOffen, type InstrumentZeile, type VorgangArtWahl } from "../lib/instrumente";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "./FehlerHinweis";
import { FelderEingabe } from "./FelderEingabe";
import { beteiligungWaehrungssicht } from "../api/waehrung";
import { betragOderNichts, textOderNichts, useFormular } from "./formular";
import { BetragFeld } from "./BetragFeld";
import { betragRegel, datumRegel, pflichtRegel } from "../lib/feldpruefung";

type Art = VorgangArtWahl;

const VORGANG_FELDER = ["art", "valuta", "betrag", "betragLokal", "bemerkung", "instrumentId", "rundeId", "trancheId", "meilensteinId", "beglichenVorgangId", "felder"];

/** Wert der Auswahl „Keiner Runde zuordnen“ (eine Runde-ID ist nie leer). */
const KEINE_RUNDE = "";

/** Vorbelegung, wenn der Dialog aus einem Bereich geöffnet wird (zum Beispiel „Zinszahlung erfassen“ unter Zinsen). */
export interface VorgangVorgabe {
  art?: Art;
  instrumentId?: string;
}

/**
 * Vorgang erfassen, gruppiert: Investieren (Auszahlung), Erträge (Zinszahlung, Dividende), Rückflüsse (Tilgung, Verkaufserlös). Das Instrument ist Pflicht
 * (bei nur einem passenden vorbelegt), die Auszahlung kann auf eine offene Tranche des Instruments gebucht werden, eine Zinszahlung eine bestimmte
 * Zinsbuchung begleichen. Eine Zusage geht über „Tranche anlegen“, die Wertberichtigung über Bewertungen.
 */
export function VorgangDialog({ daten, vorgabe, onTrancheAnlegen, onSchliessen }: { daten: Instrumentdaten; vorgabe?: VorgangVorgabe | undefined; onTrancheAnlegen?: (() => void) | undefined; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.vorgangForm;
  const anlegen = useVorgangAnlegen(daten.beteiligung.id);
  const aktiv = daten.beteiligung.status === "aktiv";
  const instrumente = daten.instrumente;
  const moegliche = (a: Art) => instrumente.filter((i) => erlaubtFuer(a, i) && (a !== "auszahlung" || i.status === "aktiv"));
  const gruppen = VORGANG_GRUPPEN.map((g) => ({ id: g.id, arten: g.arten.filter((a) => (a !== "auszahlung" || aktiv) && moegliche(a).length > 0) })).filter((g) => g.arten.length > 0);
  const alleArten = gruppen.flatMap((g) => g.arten);
  // Hat die Beteiligung eine andere lokale Währung als der Fonds, lässt sich der Betrag auch lokal erfassen (Etappe 21).
  const { data: ws } = useQuery(beteiligungWaehrungssicht(daten.beteiligung.id, {}));
  const fremd = ws && ws.waehrungen.lokal !== ws.waehrungen.fonds ? ws.waehrungen : null;
  const { werte, feld, pruefeAlle } = useFormular({ art: vorgabe?.art && alleArten.includes(vorgabe.art) ? vorgabe.art : (alleArten[0] ?? "rueckfluss"), instrumentId: vorgabe?.instrumentId ?? "", valuta: heuteIso(), betrag: "", betragLokal: "", bemerkung: "", trancheId: "", beglichenVorgangId: "" },
    {
      valuta: datumRegel({ pflicht: true }),
      // Bei abweichender lokaler Währung genügt einer der beiden Beträge.
      betrag: (w, ws, k) => betragRegel<typeof ws>({ vorzeichen: "positiv", pflicht: !fremd || ws.betragLokal.trim() === "" })(w, ws, k),
      betragLokal: betragRegel({ vorzeichen: "positiv" }),
    },
  );
  const { data: runden } = useQuery(finanzierungsrunden(daten.beteiligung.organisationId));
  // Eigene Wahl der Runde; solange sie fehlt, folgt die Auswahl der Runde des Instruments und es geht keine `rundeId` an die API.
  const [rundeWahl, setRundeWahl] = useState<string | null>(null);
  const [gebucht, setGebucht] = useState<string | null>(null);
  const [eigeneFelder, setEigeneFelder] = useState<Record<string, unknown>>({});
  const fehler = (name: string) => feldText(t, anlegen.error, name);
  const art = werte.art as Art;
  const erlaubte = moegliche(art);
  // Das gewählte Instrument gilt nur, solange es die Art erlaubt; mit genau einem passenden ist es vorbelegt.
  const instrumentId = erlaubte.some((i) => i.id === werte.instrumentId) ? werte.instrumentId : erlaubte.length === 1 ? erlaubte[0]!.id : "";
  const instrument = erlaubte.find((i) => i.id === instrumentId);
  const rundeId = rundeWahl ?? instrument?.runde?.id ?? KEINE_RUNDE;
  const offeneTranchen = art === "auszahlung" && instrument ? instrument.tranchen.filter(trancheOffen) : [];
  const trancheId = offeneTranchen.some((x) => x.id === werte.trancheId) ? werte.trancheId : "";
  const tranche = offeneTranchen.find((x) => x.id === trancheId);
  const gesperrt = tranche !== undefined && tranche.stand.bedingung === "offen";
  const { data: zinsen } = useQuery({ ...beteiligungZinsen(daten.beteiligung.id, heuteIso()), enabled: art === "zinszahlung" && instrumentId !== "" });
  const buchungen = art === "zinszahlung" && instrumentId ? (zinsen?.instrumente.find((i) => i.instrumentId === instrumentId)?.perioden ?? []).filter((p) => p.vorgangId !== null && !p.kapitalisiert && Number(p.offen) > 0) : [];
  const beglichen = buchungen.some((p) => p.vorgangId === werte.beglichenVorgangId) ? werte.beglichenVorgangId : "";
  const statusText = (i: InstrumentZeile) => (i.status === "aktiv" ? null : aufzaehlung(t.instrumenteAbschnitt.status, i.status));

  function absenden() {
    if (!pruefeAlle()) return;
    const lokal = fremd ? betragOderNichts(werte.betragLokal, sprache) : undefined;
    const betrag = betragOderNichts(werte.betrag, sprache);
    const gemeinsam = { valuta: werte.valuta, ...(lokal ? { betragLokal: lokal, ...(betrag ? { betrag } : {}) } : { betrag: betrag ?? "" }), bemerkung: textOderNichts(werte.bemerkung), instrumentId };
    const mitFeldern = Object.keys(eigeneFelder).length > 0 ? { ...gemeinsam, felder: eigeneFelder } : gemeinsam;
    const neu = { art, ...mitFeldern, ...(rundeWahl !== null ? { rundeId: rundeWahl === KEINE_RUNDE ? null : rundeWahl } : {}), ...(trancheId ? { trancheId } : {}), ...(beglichen ? { beglichenVorgangId: beglichen } : {}) } as NeuerVorgang;
    anlegen.mutate(neu, { onSuccess: (ergebnis) => setGebucht(ergebnis.buchwert) });
  }

  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titel}</h2>
      {gebucht !== null ? (
        <Hinweis>{f.buchwertNachher(formatBetragCent(gebucht, sprache))}</Hinweis>
      ) : (
        <form
          className="app-formular"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            absenden();
          }}
        >
          <FehlerHinweis fehler={anlegen.error} bekannt={VORGANG_FELDER} />
          {aktiv && onTrancheAnlegen ? (
            <p className="app-leer-text">
              {f.zusageHinweis}{" "}
              <Button type="button" variante="ruhig" groesse="s" onClick={onTrancheAnlegen}>
                {f.trancheAnlegen}
              </Button>
            </p>
          ) : null}
          <Auswahl label={f.art} {...feld("art")} fehler={fehler("art")}>
            {gruppen.map((g) => (
              <optgroup key={g.id} label={f.gruppen[g.id]}>
                {g.arten.map((a) => (
                  <option key={a} value={a}>
                    {f.artNamen[a]}
                  </option>
                ))}
              </optgroup>
            ))}
          </Auswahl>
          <Auswahl label={f.instrument} {...feld("instrumentId")} value={instrumentId} required fehler={fehler("instrumentId")}>
            {erlaubte.length !== 1 ? <option value="" /> : null}
            {erlaubte.map((i) => (
              <option key={i.id} value={i.id}>
                {f.instrumentOption(i.bezeichnung, statusText(i))}
              </option>
            ))}
          </Auswahl>
          {(runden ?? []).length > 0 ? (
            <Auswahl label={f.runde} hilfe={f.rundeHilfe} name="rundeId" value={rundeId} onChange={(e) => setRundeWahl(e.target.value)} fehler={fehler("rundeId")}>
              <option value={KEINE_RUNDE}>{f.keineRundeZuordnen}</option>
              {(runden ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {f.rundeOption(r.bezeichnung, formatDatum(r.datum, sprache), r.art === "bruecke")}
                </option>
              ))}
            </Auswahl>
          ) : null}
          <Feld label={f.valuta} type="date" required {...feld("valuta", fehler("valuta"))} />
          {fremd ? <BetragFeld label={t.waehrung.betragLokal(fremd.lokal)} hilfe={t.waehrung.betragLokalHilfe(fremd.fonds)} {...feld("betragLokal", fehler("betragLokal"))} /> : null}
          <BetragFeld label={fremd ? `${f.betrag} (${fremd.fonds})` : f.betrag} required={!fremd} {...feld("betrag", fehler("betrag"))} />
          {art === "auszahlung" && offeneTranchen.length > 0 ? (
            <Auswahl label={f.tranche} {...feld("trancheId")} value={trancheId} fehler={fehler("trancheId")} aria-describedby={gesperrt ? "tranche-gesperrt" : undefined}>
              <option value="">{f.keineTranche}</option>
              {offeneTranchen.map((x) => (
                <option key={x.id} value={x.id}>
                  {f.trancheOption(x.nummer ?? 0, x.bezeichnung, formatBetrag(x.stand.offen, sprache), x.stand.bedingung === "offen")}
                </option>
              ))}
            </Auswahl>
          ) : null}
          {gesperrt && tranche ? (
            <Hinweis id="tranche-gesperrt" titel={f.trancheOffenTitel}>
              {f.trancheOffen(tranche.bezeichnung)}
            </Hinweis>
          ) : null}
          {art === "zinszahlung" && buchungen.length > 0 ? (
            <Auswahl label={f.begleicht} {...feld("beglichenVorgangId")} value={beglichen} fehler={fehler("beglichenVorgangId")}>
              <option value="">{f.keineBuchung}</option>
              {buchungen.map((p) => (
                <option key={p.vorgangId} value={p.vorgangId ?? ""}>
                  {f.buchungOption(formatDatum(p.bis, sprache), formatBetrag(p.offen, sprache))}
                </option>
              ))}
            </Auswahl>
          ) : null}
          <Feld label={f.bemerkung} {...feld("bemerkung")} fehler={fehler("bemerkung")} />
          <FelderEingabe objekt="vorgang" onChange={setEigeneFelder} />
          <div>
            <Button type="submit" disabled={anlegen.isPending || gesperrt || instrumentId === "" || alleArten.length === 0} aria-describedby={gesperrt ? "tranche-gesperrt" : undefined}>
              {f.erfassen}
            </Button>
          </div>
        </form>
      )}
    </Seitenpanel>
  );
}

export interface StornoZiel {
  id: string;
  art: string;
  valuta: string;
  betrag: string;
}

/** Storno eines Vorgangs: Grund ist Pflicht, die Valuta nicht vor der des Originals (die API prüft, das Feld zeigt den Fehler). */
export function StornoDialog({ vorgang, onSchliessen }: { vorgang: StornoZiel; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.stornoForm;
  const storno = useStorno();
  const { werte, feld, pruefeAlle } = useFormular({ grund: "", valuta: "" }, { grund: pflichtRegel(), valuta: datumRegel({ min: vorgang.valuta }) });
  const fehler = (name: string) => feldText(t, storno.error, name);
  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titel}</h2>
      <p className="app-leer-text">{f.beschreibung(aufzaehlung(t.vorgangArt, vorgang.art), formatDatum(vorgang.valuta, sprache), formatBetrag(vorgang.betrag, sprache))}</p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!pruefeAlle()) return;
          storno.mutate({ id: vorgang.id, grund: werte.grund.trim(), valuta: textOderNichts(werte.valuta) }, { onSuccess: onSchliessen });
        }}
      >
        <FehlerHinweis fehler={storno.error} bekannt={["grund", "valuta"]} />
        <Feld label={f.grund} required {...feld("grund", fehler("grund"))} />
        <Feld label={f.valuta} type="date" min={vorgang.valuta} hilfe={f.valutaHilfe} {...feld("valuta", fehler("valuta"))} />
        <div>
          <Button type="submit" variante="gefahr" disabled={storno.isPending}>
            {f.stornieren}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
