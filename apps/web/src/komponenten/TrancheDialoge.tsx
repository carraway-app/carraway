import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Feld, Seitenpanel } from "@carraway/ui";
import { anteilsklassen, finanzierungsrunden } from "../api/abfragen";
import { heuteIso } from "../api/datum";
import { useInstrumentAendern, useInstrumentAnlegen, useTrancheAendern, useTrancheAnlegen, type NeuesInstrument } from "../api/mutationen";
import { feldText } from "../i18n/fehler";
import { useSprache, useT } from "../i18n";
import { formatBetragCent } from "../lib/zahl";
import { trancheSumme, type InstrumentZeile, type Tranche } from "../lib/instrumente";
import { FehlerHinweis } from "./FehlerHinweis";
import { betragFuerFeld, betragOderNichts, textOderNichts, textOderNull, useFormular } from "./formular";
import { JaNein } from "./JaNein";
import { BetragFeld } from "./BetragFeld";
import { betragRegel, datumRegel, ganzzahlRegel, prozentRegel } from "../lib/feldpruefung";
import { anteilZuProzent, prozentZuAnteil } from "../lib/zahl";

const cent = (wert: string | undefined) => Math.round(Number(wert ?? "0") * 100);
const alsBetrag = (c: number) => (c / 100).toFixed(2);

const TRANCHE_FELDER = ["bezeichnung", "betrag", "bedingung", "geplantAm", "zusageErhoehen", "zusageValuta"];

/**
 * Tranche anlegen: teilt die Zusage des Instruments in Tranchen auf (Summe höchstens Zusage); legt die Tranche an und, wenn sie die Zusage des Instruments übersteigt, im selben Schritt die fehlende Zusage
 * (`zusageErhoehen`). Die Wahl „Zusage erhöhen“ ist vorbelegt, sobald die Tranchen sonst über die Zusage hinausgingen.
 */
export function TrancheAnlegenDialog({ instrumente, instrumentId, onSchliessen }: { instrumente: InstrumentZeile[]; instrumentId?: string | undefined; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.trancheForm;
  const anlegen = useTrancheAnlegen();
  const waehlbar = instrumente.filter((i) => i.status === "aktiv");
  const { werte, feld, pruefeAlle } = useFormular({ instrumentId: instrumentId ?? waehlbar[0]?.id ?? "", bezeichnung: "", betrag: "", geplantAm: "", bedingung: "", zusageValuta: heuteIso() }, { betrag: betragRegel({ vorzeichen: "positiv", pflicht: true }), geplantAm: datumRegel() });
  const [erhoehenGewaehlt, setErhoehen] = useState<boolean | null>(null);
  const instrument = instrumente.find((i) => i.id === werte.instrumentId);
  const betrag = cent(betragOderNichts(werte.betrag, sprache));
  // Fehlt Zusage: bestehende Tranchen plus diese minus Zusage; nur positiv zählt.
  const fehlt = instrument ? Math.max(0, cent(String(trancheSumme(instrument))) + betrag - cent(instrument.zusage)) : 0;
  const erhoehen = fehlt > 0 && (erhoehenGewaehlt ?? true);
  const fehler = (name: string) => feldText(t, anlegen.error, name);
  const nummer = (instrument?.tranchen.length ?? 0) + 1;

  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titel}</h2>
      <p className="app-leer-text">{f.beschreibung}</p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!instrument || !pruefeAlle()) return;
          anlegen.mutate(
            {
              instrumentId: instrument.id,
              bezeichnung: textOderNichts(werte.bezeichnung) ?? f.vorschlag(nummer),
              betrag: betragOderNichts(werte.betrag, sprache) ?? "",
              ...(textOderNichts(werte.bedingung) ? { bedingung: textOderNichts(werte.bedingung) } : {}),
              ...(textOderNichts(werte.geplantAm) ? { geplantAm: textOderNichts(werte.geplantAm) } : {}),
              ...(erhoehen ? { zusageErhoehen: true, zusageValuta: werte.zusageValuta } : {}),
            },
            { onSuccess: onSchliessen },
          );
        }}
      >
        <FehlerHinweis fehler={anlegen.error} bekannt={TRANCHE_FELDER} />
        <Auswahl label={f.instrument} {...feld("instrumentId")}>
          {waehlbar.map((i) => (
            <option key={i.id} value={i.id}>
              {i.bezeichnung}
            </option>
          ))}
        </Auswahl>
        <Feld label={f.bezeichnung} autoComplete="off" placeholder={f.vorschlag(nummer)} {...feld("bezeichnung")} fehler={fehler("bezeichnung")} />
        <BetragFeld label={f.betrag} required {...feld("betrag", fehler("betrag"))} />
        <Feld label={f.geplantAm} type="date" {...feld("geplantAm", fehler("geplantAm"))} />
        <Feld label={f.bedingung} autoComplete="off" {...feld("bedingung")} fehler={fehler("bedingung")} />
        {fehlt > 0 && instrument ? (
          <>
            <JaNein label={f.erhoehen} wert={erhoehen} onWahl={setErhoehen} ja={f.ja} nein={f.nein} />
            <p className="app-leer-text">{f.erhoehenHilfe(formatBetragCent(instrument.zusage, sprache), formatBetragCent(alsBetrag(cent(String(trancheSumme(instrument)))), sprache), formatBetragCent(alsBetrag(fehlt), sprache))}</p>
            {erhoehen ? <Feld label={f.zusageValuta} type="date" {...feld("zusageValuta")} fehler={fehler("zusageValuta")} /> : null}
          </>
        ) : null}
        <div>
          <Button type="submit" disabled={anlegen.isPending || !instrument}>
            {f.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

/** Tranche ändern: Bezeichnung, Betrag, geplantes Datum und Bedingung (der Betrag nicht unter das Ausgezahlte, nicht über die Zusage). */
export function TrancheBearbeitenDialog({ tranche, onSchliessen }: { tranche: Tranche; onSchliessen: () => void }) {
  const t = useT();
  const f = t.trancheForm;
  const aendern = useTrancheAendern();
  const sprache = useSprache();
  const { werte, feld, pruefeAlle } = useFormular({ bezeichnung: tranche.bezeichnung, betrag: betragFuerFeld(tranche.betrag), geplantAm: tranche.geplantAm ?? "", bedingung: tranche.bedingung ?? "" }, { betrag: betragRegel({ vorzeichen: "positiv", pflicht: true }), geplantAm: datumRegel() });
  const fehler = (name: string) => feldText(t, aendern.error, name);
  return (
    <Seitenpanel titel={f.titelBearbeiten} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titelBearbeiten}</h2>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!pruefeAlle()) return;
          aendern.mutate(
            { id: tranche.id, bezeichnung: werte.bezeichnung.trim(), betrag: betragOderNichts(werte.betrag, sprache) ?? "", bedingung: textOderNull(werte.bedingung), geplantAm: textOderNull(werte.geplantAm) },
            { onSuccess: onSchliessen },
          );
        }}
      >
        <FehlerHinweis fehler={aendern.error} bekannt={TRANCHE_FELDER} />
        <Feld label={f.bezeichnung} autoComplete="off" {...feld("bezeichnung")} fehler={fehler("bezeichnung")} />
        <BetragFeld label={f.betrag} required {...feld("betrag", fehler("betrag"))} />
        <Feld label={f.geplantAm} type="date" {...feld("geplantAm", fehler("geplantAm"))} />
        <Feld label={f.bedingung} autoComplete="off" {...feld("bedingung")} fehler={fehler("bedingung")} />
        <div>
          <Button type="submit" disabled={aendern.isPending}>
            {f.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

const ARTEN = ["offene_beteiligung", "stille_beteiligung", "darlehen", "wandeldarlehen", "venture_debt", "gesellschafterdarlehen", "safe", "optionsschein"] as const;
type Art = NonNullable<NeuesInstrument["art"]>;
/** Eigenkapital und stille Beteiligung gehören nie zu einer Brückenrunde (die API lehnt sie mit `instrument_round_bridge` ab); Darlehensarten dürfen. */
const ANTEILSARTEN = ["offene_beteiligung", "stille_beteiligung"];
const angeboteneRunden = <R extends { art: string }>(runden: R[] | undefined, art: string): R[] => (runden ?? []).filter((r) => r.art !== "bruecke" || !ANTEILSARTEN.includes(art));

const INSTRUMENT_FELDER = ["art", "bezeichnung", "rundeId", "anteilsklasseId", "wandlungsabschlag", "bewertungsobergrenze", "zinsenWandeln", "optionsscheinAnzahl", "ausuebungspreis", "ausgabeAm", "laufzeitBis"];
const ganzzahl = (wert: string) => wert.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "");

/** Felder der Optionsscheine (Anzahl und Ausübungspreis Pflicht), Preis bis vier Nachkommastellen wie die API. */
const optionsscheinRegeln = { optionsscheinAnzahl: ganzzahlRegel({ min: 1, pflicht: true }), ausuebungspreis: betragRegel({ nachkomma: 4, ganzstellen: 14, pflicht: true }), ausgabeAm: datumRegel(), laufzeitBis: datumRegel() };
function OptionsscheinFelder({ feld, fehler }: { feld: (name: "optionsscheinAnzahl" | "ausuebungspreis" | "ausgabeAm" | "laufzeitBis", fehler?: string | undefined) => object; fehler: (name: string) => string | undefined }) {
  const t = useT();
  const o = t.instrumentForm.optionsschein;
  return (
    <fieldset className="app-gruppe">
      <legend className="cw-feld__label">{o.titel}</legend>
      <p className="app-leer-text">{o.hilfe}</p>
      <BetragFeld label={o.anzahl} inputMode="numeric" {...feld("optionsscheinAnzahl", fehler("optionsscheinAnzahl"))} />
      <BetragFeld label={o.preis} hilfe={o.preisHilfe} {...feld("ausuebungspreis", fehler("ausuebungspreis"))} />
      <Feld label={o.ausgabe} type="date" {...feld("ausgabeAm", fehler("ausgabeAm"))} />
      <Feld label={o.laufzeit} type="date" {...feld("laufzeitBis", fehler("laufzeitBis"))} />
    </fieldset>
  );
}

/**
 * Instrument anlegen (Art, Bezeichnung, optional Runde und Anteilsklasse) mit optionaler erster Tranche samt Zusage. Das sind zwei Aufrufe:
 * Schlägt der zweite fehl, bleibt das angelegte Instrument erhalten und ein erneutes Speichern legt nur noch die Tranche an (kein Duplikat).
 */
export function InstrumentAnlegenDialog({ beteiligungId, organisationId, onSchliessen }: { beteiligungId: string; organisationId: string; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.instrumentForm;
  const tf = t.trancheForm;
  const anlegen = useInstrumentAnlegen(beteiligungId);
  const tranche = useTrancheAnlegen();
  const { data: runden } = useQuery(finanzierungsrunden(organisationId));
  const { data: klassen } = useQuery(anteilsklassen(organisationId));
  const [wirdOptionsschein, setWirdOptionsschein] = useState(false);
  const { werte, feld, pruefeAlle } = useFormular(
    { art: "offene_beteiligung", bezeichnung: "", rundeId: "", anteilsklasseId: "", betrag: "", geplantAm: "", bedingung: "", optionsscheinAnzahl: "", ausuebungspreis: "", ausgabeAm: "", laufzeitBis: "" },
    { betrag: betragRegel({ vorzeichen: "positiv" }), geplantAm: datumRegel(), ...(wirdOptionsschein ? optionsscheinRegeln : {}) },
  );
  const [angelegt, setAngelegt] = useState<string | null>(null);
  const [trancheFehler, setTrancheFehler] = useState(false);
  const fehler = (name: string) => feldText(t, anlegen.error, name);
  const hatTranche = betragOderNichts(werte.betrag, sprache) !== undefined;
  const eigenkapital = werte.art === "offene_beteiligung";
  const optionsschein = werte.art === "optionsschein";
  if (optionsschein !== wirdOptionsschein) setWirdOptionsschein(optionsschein);
  const rundenAngebot = angeboteneRunden(runden, werte.art);
  const rundeId = rundenAngebot.some((r) => r.id === werte.rundeId) ? werte.rundeId : "";

  async function speichern() {
    if (!pruefeAlle()) return;
    setTrancheFehler(false);
    let id = angelegt;
    if (!id) {
      try {
        const neu = await anlegen.mutateAsync({
          art: werte.art as Art,
          ...(textOderNichts(werte.bezeichnung) ? { bezeichnung: textOderNichts(werte.bezeichnung) } : {}),
          ...(rundeId ? { rundeId } : {}),
          ...(eigenkapital && werte.anteilsklasseId ? { anteilsklasseId: werte.anteilsklasseId } : {}),
          ...(optionsschein
            ? {
                optionsscheinAnzahl: ganzzahl(werte.optionsscheinAnzahl),
                ausuebungspreis: betragOderNichts(werte.ausuebungspreis, sprache) ?? "",
                ...(textOderNichts(werte.ausgabeAm) ? { ausgabeAm: textOderNichts(werte.ausgabeAm) } : {}),
                ...(textOderNichts(werte.laufzeitBis) ? { laufzeitBis: textOderNichts(werte.laufzeitBis) } : {}),
              }
            : {}),
        });
        id = neu.id;
        setAngelegt(id);
      } catch {
        return;
      }
    }
    if (!hatTranche) return onSchliessen();
    try {
      await tranche.mutateAsync({
        instrumentId: id,
        bezeichnung: tf.vorschlag(1),
        betrag: betragOderNichts(werte.betrag, sprache) ?? "",
        zusageErhoehen: true,
        ...(textOderNichts(werte.bedingung) ? { bedingung: textOderNichts(werte.bedingung) } : {}),
        ...(textOderNichts(werte.geplantAm) ? { geplantAm: textOderNichts(werte.geplantAm) } : {}),
      });
      onSchliessen();
    } catch {
      setTrancheFehler(true);
    }
  }

  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titel}</h2>
      <p className="app-leer-text">{f.beschreibung}</p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void speichern();
        }}
      >
        <FehlerHinweis fehler={anlegen.error} bekannt={INSTRUMENT_FELDER} />
        {trancheFehler ? <p role="alert" className="app-leer-text">{f.trancheFehlt}</p> : null}
        <FehlerHinweis fehler={tranche.error} bekannt={TRANCHE_FELDER} />
        <Auswahl label={f.art} disabled={angelegt !== null} {...feld("art")} fehler={fehler("art")}>
          {ARTEN.map((a) => (
            <option key={a} value={a}>
              {f.arten[a]}
            </option>
          ))}
        </Auswahl>
        <Feld label={f.bezeichnung} hilfe={f.bezeichnungHilfe} autoComplete="off" disabled={angelegt !== null} {...feld("bezeichnung")} fehler={fehler("bezeichnung")} />
        <Auswahl label={f.runde} disabled={angelegt !== null} {...feld("rundeId")} value={rundeId} fehler={fehler("rundeId")}>
          <option value="">{f.keineRunde}</option>
          {rundenAngebot.map((r) => (
            <option key={r.id} value={r.id}>
              {r.art === "bruecke" ? f.rundeBruecke(r.bezeichnung) : r.bezeichnung}
            </option>
          ))}
        </Auswahl>
        {eigenkapital ? (
          <Auswahl label={f.klasse} disabled={angelegt !== null} {...feld("anteilsklasseId")} fehler={fehler("anteilsklasseId")}>
            <option value="">{f.keineKlasse}</option>
            {(klassen ?? []).map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </Auswahl>
        ) : null}
        {optionsschein ? <OptionsscheinFelder feld={(name, f) => (feld as (n: string, f?: string) => object)(name, f)} fehler={fehler} /> : null}
        <fieldset className="app-gruppe">
          <legend className="cw-feld__label">{f.zusage}</legend>
          <p className="app-leer-text">{f.zusageHilfe}</p>
          <BetragFeld label={f.betrag} {...feld("betrag")} />
          <Feld label={f.geplantAm} type="date" {...feld("geplantAm")} />
          <Feld label={f.bedingung} autoComplete="off" {...feld("bedingung")} />
        </fieldset>
        <div>
          <Button type="submit" disabled={anlegen.isPending || tranche.isPending}>
            {f.anlegen}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

/**
 * Instrument bearbeiten: Art, Bezeichnung, Runde und Anteilsklasse. Die Art lässt sich nur ändern, solange das Instrument keine Vorgänge, Tranchen
 * oder Konditionen hat (`artGesperrt`, aus dem Stand der Seite abgeleitet; die API entscheidet endgültig mit `instrument_type_locked`).
 */
export function InstrumentBearbeitenDialog({ instrument, organisationId, artGesperrt, waehrung = "EUR", onSchliessen }: { instrument: InstrumentZeile; organisationId: string; artGesperrt: boolean; waehrung?: string | undefined; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.instrumentForm;
  const aendern = useInstrumentAendern();
  const { data: runden } = useQuery(finanzierungsrunden(organisationId));
  const { data: klassen } = useQuery(anteilsklassen(organisationId));
  const { werte, feld, pruefeAlle } = useFormular(
    {
      art: instrument.art,
      bezeichnung: instrument.bezeichnung,
      rundeId: instrument.runde?.id ?? "",
      anteilsklasseId: instrument.anteilsklasse?.id ?? "",
      wandlungsabschlag: anteilZuProzent(instrument.wandlungsabschlag),
      bewertungsobergrenze: betragFuerFeld(instrument.bewertungsobergrenze),
      zinsenWandeln: instrument.zinsenWandeln === null ? "" : instrument.zinsenWandeln ? "ja" : "nein",
      optionsscheinAnzahl: instrument.optionsschein?.anzahl ?? "",
      ausuebungspreis: (instrument.optionsschein?.ausuebungspreis ?? "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""),
      ausgabeAm: instrument.optionsschein?.ausgabeAm ?? "",
      laufzeitBis: instrument.optionsschein?.laufzeitBis ?? "",
    },
    // Abschlag in Prozent; 100 Prozent lehnt die API am Feld ab (Bruch unter 1).
    { wandlungsabschlag: prozentRegel(), bewertungsobergrenze: betragRegel({ vorzeichen: "positiv" }), ...(instrument.art === "optionsschein" ? optionsscheinRegeln : {}) },
  );
  const fehler = (name: string) => feldText(t, aendern.error, name);
  // SAFE: Abschlag und Bewertungsobergrenze wie beim Wandeldarlehen, aber ohne Zinsen.
  const wandel = werte.art === "wandeldarlehen" || werte.art === "safe";
  const safe = werte.art === "safe";
  const optionsschein = werte.art === "optionsschein";
  const artGeaendert = werte.art !== instrument.art;
  const eigenkapital = werte.art === "offene_beteiligung";
  const rundenAngebot = angeboteneRunden(runden, werte.art);
  const rundeId = rundenAngebot.some((r) => r.id === werte.rundeId) ? werte.rundeId : "";
  return (
    <Seitenpanel titel={f.titelBearbeiten} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titelBearbeiten}</h2>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!pruefeAlle()) return;
          aendern.mutate(
            {
              id: instrument.id,
              bezeichnung: werte.bezeichnung.trim(),
              // Die Parameter gehören nur an das Wandeldarlehen; leer = nicht erfasst (null leert den Wert).
              ...(wandel
                ? {
                    wandlungsabschlag: textOderNichts(werte.wandlungsabschlag) ? prozentZuAnteil(werte.wandlungsabschlag) : null,
                    bewertungsobergrenze: betragOderNichts(werte.bewertungsobergrenze, sprache) ?? null,
                    ...(safe ? {} : { zinsenWandeln: werte.zinsenWandeln === "" ? null : werte.zinsenWandeln === "ja" }),
                  }
                : {}),
              ...(optionsschein
                ? {
                    optionsscheinAnzahl: ganzzahl(werte.optionsscheinAnzahl),
                    ausuebungspreis: betragOderNichts(werte.ausuebungspreis, sprache) ?? "",
                    ausgabeAm: textOderNull(werte.ausgabeAm),
                    laufzeitBis: textOderNull(werte.laufzeitBis),
                  }
                : {}),
              rundeId: rundeId || null,
              ...(artGeaendert ? { art: werte.art as Art } : {}),
              ...(eigenkapital ? { anteilsklasseId: werte.anteilsklasseId || null } : instrument.anteilsklasse ? { anteilsklasseId: null } : {}),
            },
            { onSuccess: onSchliessen },
          );
        }}
      >
        <FehlerHinweis fehler={aendern.error} bekannt={INSTRUMENT_FELDER} />
        <Auswahl label={f.art} disabled={artGesperrt} hilfe={artGesperrt ? f.artGesperrt : undefined} {...feld("art")} fehler={fehler("art")}>
          {ARTEN.map((a) => (
            <option key={a} value={a}>
              {f.arten[a]}
            </option>
          ))}
        </Auswahl>
        <Feld label={f.bezeichnungName} autoComplete="off" {...feld("bezeichnung")} fehler={fehler("bezeichnung")} />
        <Auswahl label={f.runde} {...feld("rundeId")} value={rundeId} fehler={fehler("rundeId")}>
          <option value="">{f.keineRunde}</option>
          {rundenAngebot.map((r) => (
            <option key={r.id} value={r.id}>
              {r.art === "bruecke" ? f.rundeBruecke(r.bezeichnung) : r.bezeichnung}
            </option>
          ))}
        </Auswahl>
        {eigenkapital ? (
          <Auswahl label={f.klasse} {...feld("anteilsklasseId")} fehler={fehler("anteilsklasseId")}>
            <option value="">{f.keineKlasse}</option>
            {(klassen ?? []).map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </Auswahl>
        ) : null}
        {wandel ? (
          <fieldset className="app-gruppe">
            <legend className="cw-feld__label">{f.wandlung.titel}</legend>
            <p className="app-leer-text">{f.wandlung.hilfe}</p>
            <BetragFeld label={f.wandlung.abschlag} hilfe={f.wandlung.abschlagHilfe} {...feld("wandlungsabschlag", fehler("wandlungsabschlag"))} />
            <BetragFeld label={f.wandlung.obergrenze(waehrung)} hilfe={f.wandlung.obergrenzeHilfe} {...feld("bewertungsobergrenze", fehler("bewertungsobergrenze"))} />
            {safe ? null : (
              <Auswahl label={f.wandlung.zinsen} hilfe={f.wandlung.zinsenHilfe} {...feld("zinsenWandeln")} fehler={fehler("zinsenWandeln")}>
                <option value="">{f.wandlung.zinsenOffen}</option>
                <option value="ja">{f.wandlung.ja}</option>
                <option value="nein">{f.wandlung.nein}</option>
              </Auswahl>
            )}
          </fieldset>
        ) : null}
        {optionsschein ? <OptionsscheinFelder feld={(name, f) => (feld as (n: string, f?: string) => object)(name, f)} fehler={fehler} /> : null}
        <div>
          <Button type="submit" disabled={aendern.isPending}>
            {f.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
