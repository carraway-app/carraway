import { useState } from "react";
import { Auswahl, Button, Feld, Hinweis } from "@carraway/ui";
import { heuteIso } from "../api/datum";
import type { Instrumentdaten } from "../api/abfragen";
import { useForderungErfuellt, useJahresueberschuss, useKonditionAnlegen, useTrancheErfuellt, type NeueKondition } from "../api/mutationen";
import { feldText } from "../i18n/fehler";
import { useSprache, useT } from "../i18n";
import { anteilZuProzent, prozentZuAnteil } from "../lib/zahl";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "./FehlerHinweis";
import { betragOderNichts, textOderNichts, useFormular } from "./formular";
import { BetragFeld } from "./BetragFeld";
import { betragRegel, datumRegel, ganzzahlRegel, prozentRegel } from "../lib/feldpruefung";
import { JaNein } from "./JaNein";

export const ZINSMETHODEN = ["30E/360", "act/360", "act/365", "act/act"] as const;
export const ZINSPERIODEN = ["jaehrlich", "quartalsweise", "endfaellig"] as const;
type Kondition = Instrumentdaten["konditionen"][number];
type Methode = NonNullable<NeueKondition["methode"]>;
type Periode = (typeof ZINSPERIODEN)[number];

const KONDITION_FELDER = ["gueltigAb", "satzFix", "methode", "zinsperiode", "anker", "gewinnabhaengigSatz", "kappungSatz", "stundungBis", "kapitalisieren", "faelligAm"];

/** Konditionen eines Instruments als neue Version (`konditionen`: nur die Versionen dieses Instruments). Ab der zweiten Version sind Zinsperiode und Anker festgelegt und werden nicht gesendet (außer dem Anker bei endfälliger Verzinsung). */
export function KonditionDialog({ beteiligungId, instrumentId, konditionen, onSchliessen }: { beteiligungId: string; instrumentId: string; konditionen: Kondition[]; onSchliessen: () => void }) {
  const t = useT();
  const k = t.inst.konditionen;
  const f = t.konditionForm;
  const anlegen = useKonditionAnlegen(beteiligungId);
  const letzte = konditionen.at(-1);
  const erste = konditionen[0];
  const { werte, feld, pruefeAlle } = useFormular({
    gueltigAb: heuteIso(),
    satzFix: anteilZuProzent(letzte?.satzFix),
    methode: letzte?.methode ?? "act/365",
    zinsperiode: letzte?.zinsperiode ?? "jaehrlich",
    anker: letzte?.anker ?? "",
    gewinn: anteilZuProzent(letzte?.gewinnabhaengigSatz),
    kappung: anteilZuProzent(letzte?.kappungSatz),
    stundungBis: "",
    faelligAm: letzte?.faelligAm ?? "",
  },
  {
    gueltigAb: datumRegel({ pflicht: true }),
    satzFix: prozentRegel({ pflicht: true }),
    gewinn: prozentRegel(),
    kappung: prozentRegel(),
    anker: datumRegel(),
    faelligAm: datumRegel(),
    stundungBis: datumRegel(),
  });
  const [kapitalisieren, setKapitalisieren] = useState(letzte?.kapitalisieren ?? false);
  const fehler = (name: string) => feldText(t, anlegen.error, name);
  const raster = erste !== undefined;
  const endfaellig = (raster ? erste.zinsperiode : werte.zinsperiode) === "endfaellig";

  function absenden() {
    if (!pruefeAlle()) return;
    const neu: NeueKondition = {
      gueltigAb: werte.gueltigAb,
      satzFix: prozentZuAnteil(werte.satzFix),
      methode: werte.methode as Methode,
      kapitalisieren,
      instrumentId,
      ...(!raster ? { zinsperiode: werte.zinsperiode as Periode } : {}),
      ...((!raster || endfaellig) && textOderNichts(werte.anker) ? { anker: werte.anker } : {}),
      ...(textOderNichts(werte.gewinn) !== undefined ? { gewinnabhaengigSatz: prozentZuAnteil(werte.gewinn) } : {}),
      ...(textOderNichts(werte.kappung) !== undefined ? { kappungSatz: prozentZuAnteil(werte.kappung) } : {}),
      ...(textOderNichts(werte.stundungBis) ? { stundungBis: werte.stundungBis } : {}),
      ...(textOderNichts(werte.faelligAm) ? { faelligAm: werte.faelligAm } : {}),
    };
    anlegen.mutate(neu, { onSuccess: onSchliessen });
  }

  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen} breit>
      <h2 className="cw-t-untertitel">{f.titel}</h2>
      <p className="app-leer-text">{f.beschreibung}</p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          absenden();
        }}
      >
        <FehlerHinweis fehler={anlegen.error} bekannt={KONDITION_FELDER} />
        <div className="app-feldgruppe">
          <Feld label={k.gueltigAb} type="date" required {...feld("gueltigAb", fehler("gueltigAb"))} />
          <BetragFeld label={k.satzFix} required hilfe={f.satzHilfe} {...feld("satzFix", fehler("satzFix"))} />
          <Auswahl label={k.methode} {...feld("methode")} fehler={fehler("methode")}>
            {ZINSMETHODEN.map((m) => (
              <option key={m} value={m}>
                {t.zinsmethode[m]}
              </option>
            ))}
          </Auswahl>
          <Auswahl label={k.zinsperiode} disabled={raster} hilfe={raster ? f.festgelegt : undefined} {...(raster ? { value: erste.zinsperiode, onChange: () => {} } : feld("zinsperiode"))} fehler={fehler("zinsperiode")}>
            {ZINSPERIODEN.map((p) => (
              <option key={p} value={p}>
                {t.zinsperiode[p]}
              </option>
            ))}
          </Auswahl>
          <Feld
            label={k.anker}
            type="date"
            disabled={raster && !endfaellig}
            hilfe={raster && !endfaellig ? f.festgelegt : f.ankerHilfe}
            {...(raster && !endfaellig ? { value: erste.anker, onChange: () => {}, fehler: fehler("anker") } : feld("anker", fehler("anker")))}
          />
          <Feld label={k.faelligAm} type="date" {...feld("faelligAm", fehler("faelligAm"))} />
          <BetragFeld label={k.gewinn} hilfe={f.gewinnHilfe} {...feld("gewinn", fehler("gewinnabhaengigSatz"))} />
          <BetragFeld label={k.kappung} hilfe={f.kappungHilfe} {...feld("kappung", fehler("kappungSatz"))} />
          <Feld label={k.stundung} type="date" {...feld("stundungBis", fehler("stundungBis"))} />
        </div>
        <JaNein label={k.kapitalisieren} wert={kapitalisieren} onWahl={setKapitalisieren} ja={k.ja} nein={k.nein} />
        <div>
          <Button type="submit" disabled={anlegen.isPending}>
            {f.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

/** Bedingung einer Tranche als erfüllt markieren (Datum, optional Nachweis). */
export function ErfuelltDialog({ tranche, onSchliessen }: { tranche: { id: string; bezeichnung: string }; onSchliessen: () => void }) {
  const t = useT();
  const f = t.erfuelltForm;
  const erfuellt = useTrancheErfuellt();
  const { werte, feld, pruefeAlle } = useFormular({ datum: heuteIso(), nachweis: "" }, { datum: datumRegel() });
  const fehler = (name: string) => feldText(t, erfuellt.error, name);
  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titel}</h2>
      <p className="app-leer-text">{tranche.bezeichnung}</p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!pruefeAlle()) return;
          erfuellt.mutate({ id: tranche.id, datum: textOderNichts(werte.datum), nachweis: textOderNichts(werte.nachweis) }, { onSuccess: onSchliessen });
        }}
      >
        <FehlerHinweis fehler={erfuellt.error} bekannt={["datum", "nachweis"]} />
        <Feld label={f.datum} type="date" {...feld("datum", fehler("datum"))} />
        <Feld label={f.nachweis} {...feld("nachweis")} fehler={fehler("nachweis")} />
        <div>
          <Button type="submit" disabled={erfuellt.isPending}>
            {f.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

/** Jahresüberschuss eines Jahres setzen oder ersetzen; `jahr` ist vorbelegt beim Ändern. */
export function UeberschussDialog({ beteiligungId, jahr, betrag, onSchliessen }: { beteiligungId: string; jahr?: number; betrag?: string; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.ueberschussForm;
  const speichern = useJahresueberschuss(beteiligungId);
  const { werte, feld, pruefeAlle } = useFormular(
    { jahr: jahr ? String(jahr) : String(new Date().getFullYear() - 1), betrag: betrag ? betrag.replace(/\.00$/, "") : "" },
    { jahr: ganzzahlRegel({ min: 1900, max: 2200, stellen: 4, pflicht: true }), betrag: betragRegel({ vorzeichen: "beliebig", pflicht: true }) },
  );
  const fehler = (name: string) => feldText(t, speichern.error, name);
  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titel}</h2>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!pruefeAlle()) return;
          speichern.mutate({ jahr: Number(werte.jahr), betrag: betragOderNichts(werte.betrag, sprache) ?? "" }, { onSuccess: onSchliessen });
        }}
      >
        <FehlerHinweis fehler={speichern.error} bekannt={["jahr", "betrag"]} />
        <BetragFeld label={f.jahr} inputMode="numeric" readOnly={jahr !== undefined} {...feld("jahr", fehler("jahr"))} />
        <BetragFeld label={f.betrag} hilfe={f.betragHilfe} {...feld("betrag", fehler("betrag"))} />
        <div>
          <Button type="submit" disabled={speichern.isPending}>
            {f.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

export function ForderungDialog({ forderungId, onSchliessen }: { forderungId: string; onSchliessen: () => void }) {
  const t = useT();
  const f = t.forderungForm;
  const erfuellen = useForderungErfuellt();
  const { werte, feld, pruefeAlle } = useFormular({ datum: heuteIso() }, { datum: datumRegel() });
  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titel}</h2>
      <Hinweis>{f.hilfe}</Hinweis>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!pruefeAlle()) return;
          erfuellen.mutate({ id: forderungId, datum: textOderNichts(werte.datum) }, { onSuccess: onSchliessen });
        }}
      >
        <FehlerHinweis fehler={erfuellen.error} bekannt={["datum"]} />
        <Feld label={f.datum} type="date" {...feld("datum", feldText(t, erfuellen.error, "datum"))} />
        <div>
          <Button type="submit" disabled={erfuellen.isPending}>
            {f.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
