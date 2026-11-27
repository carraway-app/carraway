import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Auswahl, Button, Feld, Hinweis, formatDatum, type HerkunftProps } from "@carraway/ui";
import { heuteIso } from "../api/datum";
import type { Instrumentdaten } from "../api/abfragen";
import { useInsolvenz, useKaufpreisanpassung, useVerkauf, useVerkaufStorno, useVerkaufVorschau, type VerkaufEingabe } from "../api/mutationen";
import { feldText } from "../i18n/fehler";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { formatBetragCent, prozentZuAnteil } from "../lib/zahl";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "./FehlerHinweis";
import { betragOderNichts, textOderNichts, useFormular } from "./formular";
import { BetragFeld } from "./BetragFeld";
import { betragRegel, datumRegel, pflichtRegel, prozentRegel, tagNach, type Regel } from "../lib/feldpruefung";
import { JaNein } from "./JaNein";
import { ZINSMETHODEN } from "./InstrumentDialoge";
import { Rechenweg } from "./Rechenweg";

const VERKAUF_FELDER = [
  "datum",
  "kaufpreis",
  "kosten",
  "anteilVerkauft",
  "treuhand",
  "treuhand.betrag",
  "treuhand.freigabeAm",
  "verkaeuferdarlehen",
  "verkaeuferdarlehen.betrag",
  "verkaeuferdarlehen.satz",
  "verkaeuferdarlehen.methode",
  "verkaeuferdarlehen.faelligAm",
];

type VerkaufWerte = Record<"instrumentId" | "datum" | "kaufpreis" | "kosten" | "anteil" | "treuhand" | "treuhandFreigabe" | "darlehen" | "satz" | "methode" | "faellig", string>;

interface Auswertung {
  principalDisposed?: string;
  buchwertVorher: string;
  buchwertAbgang: string;
  erloes: string;
  ergebnis: string;
  barzufluss: string;
  schritte: HerkunftProps["schritte"];
}

interface VerkaufAntwort {
  ergebnis: Auswertung;
  forderung: unknown;
  verkaeuferdarlehenBeteiligungId: string | null;
  status: string;
}

/** Antwort der Vorschau: dieselbe Auswertung wie beim Buchen, dazu was gebucht würde. */
interface VorschauAntwort {
  ergebnis: Auswertung;
  forderung: { art: string; betrag: string; faelligAm: string } | null;
  verkaeuferdarlehen: { betrag: string; schuldnerOrganisationId: string | null } | null;
  status: string;
}

/** Auswertung des Verkaufs (Vorschau und Buchung): Buchwert, Abgang, Erlös, Ergebnis, Barzufluss und der Rechenweg des Servers. */
function AuswertungAnsicht({ ergebnis, status, datum }: { ergebnis: Auswertung; status: string; datum: string }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.verkaufForm;
  return (
    <>
      <dl className="app-fakten">
        <Fakt titel={f.buchwertVorher} wert={formatBetragCent(ergebnis.buchwertVorher, sprache)} />
        <Fakt titel={f.buchwertAbgang} wert={formatBetragCent(ergebnis.buchwertAbgang, sprache)} />
        {ergebnis.principalDisposed && ergebnis.principalDisposed !== "0.00" ? <Fakt titel={t.verzicht.kapitalabgang} wert={formatBetragCent(ergebnis.principalDisposed, sprache)} /> : null}
        <Fakt titel={f.erloes} wert={formatBetragCent(ergebnis.erloes, sprache)} />
        <Fakt titel={ergebnis.ergebnis.startsWith("-") ? f.verlust : f.gewinn} wert={formatBetragCent(ergebnis.ergebnis, sprache)} />
        <Fakt titel={f.barzufluss} wert={formatBetragCent(ergebnis.barzufluss, sprache)} />
        <Fakt titel={f.status} wert={aufzaehlung(t.beteiligungStatus, status)} zahl={false} />
      </dl>
      <Rechenweg titel={f.rechenweg} stichtag={datum} schritte={ergebnis.schritte} />
    </>
  );
}

/**
 * Verkauf mit Vorschau: Der Server rechnet die Auswertung (Buchwertabgang, Erlös, Ergebnis) über die Vorschau, ohne zu buchen
 * (Entscheidung 118, ändert Nr. 80). Gebucht wird nur mit den Eingaben der letzten Vorschau; die Oberfläche rechnet nichts.
 */
export function VerkaufDialog({ beteiligungId, instrumente, onSchliessen }: { beteiligungId: string; instrumente: Instrumentdaten["instrumente"]; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.verkaufForm;
  const verkaufen = useVerkauf(beteiligungId);
  const vorschauen = useVerkaufVorschau(beteiligungId);
  // Freigabe, Satz und Fälligkeit gehören zu Treuhand bzw. Verkäuferdarlehen: sind diese angegeben, sind sie Pflicht.
  const wennGesetzt = (partner: keyof VerkaufWerte, regel: (pflicht: boolean) => Regel<VerkaufWerte>): Regel<VerkaufWerte> => (wert, alle, k) => regel(alle[partner].trim() !== "")(wert, alle, k);
  const { werte, feld, pruefeAlle } = useFormular<VerkaufWerte>(
    {
      instrumentId: "",
      datum: heuteIso(),
      kaufpreis: "",
      kosten: "",
      anteil: "100",
      treuhand: "",
      treuhandFreigabe: "",
      darlehen: "",
      satz: "",
      methode: "act/365",
      faellig: "",
    },
    {
      datum: datumRegel({ pflicht: true }),
      anteil: prozentRegel({ pflicht: true, ueberMin: true }),
      kaufpreis: betragRegel({ pflicht: true }),
      kosten: betragRegel(),
      treuhand: betragRegel({ vorzeichen: "positiv" }),
      treuhandFreigabe: wennGesetzt("treuhand", (pflicht) => (wert, alle, k) => datumRegel<VerkaufWerte>({ pflicht, min: alle.datum || undefined })(wert, alle, k)),
      darlehen: betragRegel({ vorzeichen: "positiv" }),
      satz: wennGesetzt("darlehen", (pflicht) => prozentRegel({ pflicht })),
      faellig: wennGesetzt("darlehen", (pflicht) => (wert, alle, k) => datumRegel<VerkaufWerte>({ pflicht, min: tagNach(alle.datum) })(wert, alle, k)),
    },
  );
  const [geprueft, setGeprueft] = useState<string | null>(null);
  const aktiverFehler = verkaufen.error ?? vorschauen.error;
  const fehler = (name: string) => feldText(t, aktiverFehler, name);
  const antwort = verkaufen.data as unknown as VerkaufAntwort | undefined;
  const vorschau = vorschauen.data as unknown as VorschauAntwort | undefined;

  const eingabe = (): VerkaufEingabe => ({
    ...(werte.instrumentId ? { instrumentId: werte.instrumentId } : {}),
    datum: werte.datum,
    kaufpreis: betragOderNichts(werte.kaufpreis, sprache) ?? "",
    anteilVerkauft: prozentZuAnteil(werte.anteil),
    ...(textOderNichts(werte.kosten) ? { kosten: betragOderNichts(werte.kosten, sprache) ?? "" } : {}),
    ...(textOderNichts(werte.treuhand) ? { treuhand: { betrag: betragOderNichts(werte.treuhand, sprache) ?? "", freigabeAm: werte.treuhandFreigabe } } : {}),
    ...(textOderNichts(werte.darlehen)
      ? {
          verkaeuferdarlehen: {
            betrag: betragOderNichts(werte.darlehen, sprache) ?? "",
            satz: prozentZuAnteil(werte.satz),
            methode: werte.methode as (typeof ZINSMETHODEN)[number],
            faelligAm: werte.faellig,
          },
        }
      : {}),
  });
  const schluessel = JSON.stringify(eingabe());
  const aktuell = vorschau !== undefined && geprueft === schluessel;
  const veraltet = vorschau !== undefined && !aktuell;

  function berechneVorschau() {
    const e = eingabe();
    const key = JSON.stringify(e);
    verkaufen.reset();
    vorschauen.mutate(e, { onSuccess: () => setGeprueft(key) });
  }

  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen} breit>
      <h2 className="cw-t-untertitel">{f.titel}</h2>
      {antwort ? (
        <>
          <Hinweis>{f.erfolg}</Hinweis>
          <div className="app-ergebnis">
            <h3 className="app-gruppen-titel">{f.ergebnisTitel}</h3>
            <AuswertungAnsicht ergebnis={antwort.ergebnis} status={antwort.status} datum={werte.datum} />
            {antwort.forderung ? <p className="app-leer-text">{f.forderung}</p> : null}
            {antwort.verkaeuferdarlehenBeteiligungId ? (
              <p>
                {f.darlehenAngelegt}:{" "}
                <Link to="/investments/$id" params={{ id: antwort.verkaeuferdarlehenBeteiligungId }} search={{}}>
                  {f.zumDarlehen}
                </Link>
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <p className="app-leer-text">{f.beschreibung}</p>
          <form
            className="app-formular"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!pruefeAlle()) return;
              berechneVorschau();
            }}
          >
            <FehlerHinweis fehler={aktiverFehler} bekannt={VERKAUF_FELDER} />
            <div className="app-feldgruppe">
              {instrumente.length > 1 ? <Auswahl label={f.instrument} {...feld("instrumentId")}>
                <option value="">{f.ganzeBeteiligung}</option>
                {instrumente.filter((i) => i.status === "aktiv").map((i) => <option key={i.id} value={i.id}>{i.bezeichnung}</option>)}
              </Auswahl> : null}
              <Feld label={f.datum} type="date" {...feld("datum", fehler("datum"))} />
              <BetragFeld label={f.anteil} hilfe={f.anteilHilfe} {...feld("anteil", fehler("anteilVerkauft"))} />
              <BetragFeld label={f.kaufpreis} {...feld("kaufpreis", fehler("kaufpreis"))} />
              <BetragFeld label={f.kosten} {...feld("kosten", fehler("kosten"))} />
              <BetragFeld label={f.treuhand} {...feld("treuhand", fehler("treuhand.betrag"))} />
              <Feld label={f.treuhandFreigabe} type="date" {...feld("treuhandFreigabe", fehler("treuhand.freigabeAm"))} />
              <BetragFeld label={f.darlehen} {...feld("darlehen", fehler("verkaeuferdarlehen.betrag"))} />
              <BetragFeld label={f.darlehenSatz} {...feld("satz", fehler("verkaeuferdarlehen.satz"))} />
              <Auswahl label={f.darlehenMethode} {...feld("methode", fehler("verkaeuferdarlehen.methode"))}>
                {ZINSMETHODEN.map((m) => (
                  <option key={m} value={m}>
                    {t.zinsmethode[m]}
                  </option>
                ))}
              </Auswahl>
              <Feld label={f.darlehenFaellig} type="date" {...feld("faellig", fehler("verkaeuferdarlehen.faelligAm"))} />
            </div>
            <div>
              <Button type="submit" variante="sekundaer" disabled={vorschauen.isPending}>
                {f.vorschau}
              </Button>
            </div>
          </form>
          {vorschau ? (
            <div className="app-ergebnis" aria-label={f.vorschauTitel} role="group">
              <h3 className="app-gruppen-titel">{f.vorschauTitel}</h3>
              {veraltet ? <Hinweis variante="fehler">{f.veraltet}</Hinweis> : <Hinweis>{f.vorschauHinweis}</Hinweis>}
              <AuswertungAnsicht ergebnis={vorschau.ergebnis} status={vorschau.status} datum={werte.datum} />
              {vorschau.forderung ? <p className="app-leer-text">{f.forderungVorschau(formatBetragCent(vorschau.forderung.betrag, sprache), formatDatum(vorschau.forderung.faelligAm, sprache))}</p> : null}
              {vorschau.verkaeuferdarlehen ? <p className="app-leer-text">{f.darlehenVorschau(formatBetragCent(vorschau.verkaeuferdarlehen.betrag, sprache))}</p> : null}
              <div>
                <Button disabled={!aktuell || verkaufen.isPending} onClick={() => verkaufen.mutate(eingabe())}>
                  {f.buchen}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </Seitenpanel>
  );
}

/** Storno des ganzen Verkaufs mit Grund; die API lehnt Fälle ab, die sich nicht sauber zurückdrehen lassen, und nennt den Grund als Code. */
export function VerkaufStornoDialog({ verkauf, onSchliessen }: { verkauf: { id: string; datum: string; kaufpreis: string }; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.verkaufStorno;
  const storno = useVerkaufStorno();
  const { werte, feld, pruefeAlle } = useFormular({ grund: "" }, { grund: pflichtRegel() });
  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titel}</h2>
      <p className="app-leer-text">{f.beschreibung(formatDatum(verkauf.datum, sprache), formatBetragCent(verkauf.kaufpreis, sprache))}</p>
      <Hinweis>{f.folgen}</Hinweis>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!pruefeAlle()) return;
          storno.mutate({ id: verkauf.id, grund: werte.grund.trim() }, { onSuccess: onSchliessen });
        }}
      >
        <FehlerHinweis fehler={storno.error} bekannt={["grund"]} />
        <Feld label={f.grund} {...feld("grund", feldText(t, storno.error, "grund"))} />
        <div>
          <Button type="submit" variante="gefahr" disabled={storno.isPending}>
            {f.stornieren}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

export function AnpassungDialog({ beteiligungId, verkaeufe, onSchliessen }: { beteiligungId: string; verkaeufe: Instrumentdaten["verkaeufe"]; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.anpassungForm;
  const anpassen = useKaufpreisanpassung(beteiligungId);
  const { werte, feld, pruefeAlle } = useFormular(
    { datum: heuteIso(), betrag: "", grund: "", verkaufId: verkaeufe.at(-1)?.id ?? "" },
    { datum: datumRegel({ pflicht: true }), betrag: betragRegel({ vorzeichen: "ungleichNull", pflicht: true }), grund: pflichtRegel() },
  );
  const fehler = (name: string) => feldText(t, anpassen.error, name);
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
          anpassen.mutate({ datum: werte.datum, betrag: betragOderNichts(werte.betrag, sprache) ?? "", grund: werte.grund.trim(), ...(werte.verkaufId ? { verkaufId: werte.verkaufId } : {}) }, { onSuccess: onSchliessen });
        }}
      >
        <FehlerHinweis fehler={anpassen.error} bekannt={["datum", "betrag", "grund", "verkaufId"]} />
        {verkaeufe.length > 1 ? (
          <Auswahl label={f.verkauf} {...feld("verkaufId", fehler("verkaufId"))}>
            {verkaeufe.map((v) => (
              <option key={v.id} value={v.id}>
                {f.verkaufOption(formatDatum(v.datum, sprache), formatBetragCent(v.kaufpreis, sprache))}
              </option>
            ))}
          </Auswahl>
        ) : null}
        <Feld label={f.datum} type="date" {...feld("datum", fehler("datum"))} />
        <BetragFeld label={f.betrag} {...feld("betrag", fehler("betrag"))} />
        <Feld label={f.grund} {...feld("grund", fehler("grund"))} />
        <div>
          <Button type="submit" disabled={anpassen.isPending}>
            {f.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

export function InsolvenzDialog({ beteiligungId, onSchliessen }: { beteiligungId: string; onSchliessen: () => void }) {
  const t = useT();
  const f = t.insolvenzForm;
  const melden = useInsolvenz(beteiligungId);
  const { werte, feld, pruefeAlle } = useFormular({ datum: heuteIso() }, { datum: datumRegel({ pflicht: true }) });
  const [aufNull, setAufNull] = useState(false);
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
          melden.mutate({ datum: werte.datum, wertberichtigungAufNull: aufNull }, { onSuccess: onSchliessen });
        }}
      >
        <FehlerHinweis fehler={melden.error} bekannt={["datum", "wertberichtigungAufNull"]} />
        <Feld label={f.datum} type="date" {...feld("datum", feldText(t, melden.error, "datum"))} />
        <JaNein label={f.wertberichtigung} wert={aufNull} onWahl={setAufNull} ja={f.ja} nein={f.nein} />
        <div>
          <Button type="submit" variante="gefahr" disabled={melden.isPending}>
            {f.melden}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

function Fakt({ titel, wert, zahl = true }: { titel: string; wert: string; zahl?: boolean }) {
  return (
    <div>
      <dt>{titel}</dt>
      <dd className={zahl ? "app-zahl" : undefined}>{wert}</dd>
    </div>
  );
}


