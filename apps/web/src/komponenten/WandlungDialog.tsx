import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Auswahl, Button, Feld, Hinweis, Segment, Tabelle, formatDatum, type HerkunftProps, type TabelleSpalte } from "@carraway/ui";
import { anteilsklassen, finanzierungsrunden } from "../api/abfragen";
import { heuteIso } from "../api/datum";
import { useWandlung, useWandlungVorschau, type WandlungEingabe } from "../api/mutationen";
import { feldText } from "../i18n/fehler";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { anteilZuProzent, formatAnzahl, formatBetragCent, formatPreis, prozentZuAnteil } from "../lib/zahl";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "./FehlerHinweis";
import { betragFuerFeld, betragOderNichts, textOderNichts, useFormular } from "./formular";
import { BetragFeld } from "./BetragFeld";
import { betragRegel, datumRegel, ganzzahlRegel, pflichtRegel, prozentRegel, type Regel } from "../lib/feldpruefung";
import { Rechenweg } from "./Rechenweg";

export interface WandlungRunde {
  id: string;
  bezeichnung: string;
  datum: string;
  /** Der Fonds hält in dieser Runde schon eine Position: sie ist nicht wählbar. */
  belegt: boolean;
}

/** Form der Antwort von Vorschau und Buchung; die API-Typen führen die Dezimalzahlen des Rechenkerns noch als Objekte. */
interface Ergebnis {
  ergebnis: {
    wandlungsbetrag: string;
    preisJeAnteil: string;
    massgeblich: string;
    anzahlAnteile: string;
    schritte: HerkunftProps["schritte"];
    restkapital?: string;
    zinsenGebucht?: string;
    darlehenGewandelt?: string;
    zinsenGewandelt?: string;
    darlehenRest?: string;
    zinsenRest?: string;
    restbehandlung?: { darlehen: Rest | null; zinsen: Rest | null };
  };
  gebucht: { zinsen: string; spitzenbetrag: string; umgewandelt: string; nominal: string; agio: string };
  vorgaenge?: { beteiligung: "darlehen" | "ziel"; art: string; valuta: string; betrag: string; schluessel?: string }[];
  zielBeteiligungId: string | null;
  zielInstrumentId?: string | null;
}

type Rest = "zurueckgezahlt" | "erlassen";

const FELDER = [
  "cutoff",
  "zinsenWandeln",
  "gewandeltesDarlehen",
  "gewandelteZinsen",
  "darlehenRest",
  "zinsenRest",
  "preisregel",
  "preisregel.rundenpreisJeAnteil",
  "preisregel.discount",
  "preisregel.bewertungsobergrenze",
  "preisregel.bewertungsobergrenze.betrag",
  "preisregel.bewertungsobergrenze.anteileVorRunde",
  "nennwertJeAnteil",
  "runde",
  "runde.id",
  "runde.neu",
  "runde.neu.bezeichnung",
  "runde.neu.datum",
  "runde.neu.preMoney",
  "runde.neu.postMoney",
  "runde.neu.preisJeAnteil",
  "runde.neu.anteileGesamtNach",
  "rolle",
  "anteilsklasseId",
];

type Modus = "bestehend" | "neu";
type Werte = Record<"cutoff" | "rundenpreis" | "discount" | "obergrenze" | "obergrenzeAnteile" | "nennwert" | "rundeId" | "rolle" | "gewandeltesDarlehen" | "gewandelteZinsen" | "neuBezeichnung" | "neuDatum" | "preMoney" | "postMoney" | "preis" | "anteileNach", string>;
const ganzzahl = (wert: string) => wert.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "");

/** Wandlungsparameter am Instrument (API-Form: Abschlag als Bruch, Betrag als Zahl in Text); leer = nicht erfasst. Sie belegen das Formular vor, die Eingabe bleibt änderbar. */
export interface WandlungVorbelegung {
  wandlungsabschlag: string | null;
  bewertungsobergrenze: string | null;
  zinsenWandeln: boolean | null;
}

/**
 * Wandlung eines Wandeldarlehens. Die Vorschau rechnet der Server (Rechenkern); gebucht wird nur nach einer Vorschau
 * mit unveränderten Eingaben. Die Oberfläche rechnet nichts, sie zeigt `schritte` und `gebucht` der API.
 */
export function WandlungDialog({ beteiligungId, organisationId, instrumentId, vorbelegung, runden, onSchliessen }: { beteiligungId: string; organisationId: string; instrumentId?: string | undefined; vorbelegung?: WandlungVorbelegung | undefined; runden: WandlungRunde[]; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.wandlungForm;
  const vorschau = useWandlungVorschau(beteiligungId);
  const buchen = useWandlung(beteiligungId);
  const frei = runden.filter((r) => !r.belegt);
  const [modus, setModus] = useState<Modus>(frei.length > 0 ? "bestehend" : "neu");
  const [zinsenWandeln, setZinsenWandeln] = useState(vorbelegung?.zinsenWandeln === false ? "nein" : "ja");
  const [darlehenRest, setDarlehenRest] = useState<Rest>("zurueckgezahlt");
  const [zinsenRest, setZinsenRest] = useState<Rest>("zurueckgezahlt");
  // Preis mit bis zu vier Nachkommastellen und 14 Stellen vor dem Komma, größer als null (wie die API).
  const preisRegel = betragRegel<Werte>({ vorzeichen: "positiv", nachkomma: 4, ganzstellen: 14 });
  // Bewertungsobergrenze: Betrag und Anteile vor der Runde gehören zusammen, ist eines angegeben, ist das andere Pflicht.
  const mitPartner = (partner: keyof Werte, regel: (pflicht: boolean) => Regel<Werte>): Regel<Werte> => (wert, alle, k) => regel(alle[partner].trim() !== "")(wert, alle, k);
  const { werte, feld, pruefeAlle } = useFormular<Werte>(
    {
    cutoff: heuteIso(),
    rundenpreis: "",
    discount: anteilZuProzent(vorbelegung?.wandlungsabschlag),
    obergrenze: betragFuerFeld(vorbelegung?.bewertungsobergrenze),
    obergrenzeAnteile: "",
    nennwert: "",
    rundeId: frei[0]?.id ?? "",
    rolle: "co",
    gewandeltesDarlehen: "",
    gewandelteZinsen: "",
    neuBezeichnung: "",
    neuDatum: "",
    preMoney: "",
    postMoney: "",
    preis: "",
    anteileNach: "",
    },
    {
      cutoff: datumRegel({ pflicht: true }),
      nennwert: betragRegel({ vorzeichen: "positiv", pflicht: true }),
      rundenpreis: preisRegel,
      discount: prozentRegel(),
      gewandeltesDarlehen: betragRegel({ vorzeichen: "nichtNegativ" }),
      gewandelteZinsen: betragRegel({ vorzeichen: "nichtNegativ" }),
      obergrenze: mitPartner("obergrenzeAnteile", (pflicht) => betragRegel({ vorzeichen: "positiv", pflicht })),
      obergrenzeAnteile: mitPartner("obergrenze", (pflicht) => ganzzahlRegel({ min: 1, pflicht })),
      ...(modus === "bestehend"
        ? runden.length > 0 ? { rundeId: pflichtRegel<Werte>() } : {}
        : {
            neuBezeichnung: pflichtRegel<Werte>(),
            neuDatum: datumRegel<Werte>(),
            preMoney: betragRegel<Werte>({ vorzeichen: "positiv", pflicht: true }),
            postMoney: betragRegel<Werte>({ vorzeichen: "positiv", pflicht: true }),
            preis: betragRegel<Werte>({ vorzeichen: "positiv", nachkomma: 4, ganzstellen: 14, pflicht: true }),
            anteileNach: ganzzahlRegel<Werte>({ min: 1, pflicht: true }),
          }),
    },
  );
  const { data: klassen } = useQuery(anteilsklassen(organisationId));
  // Ohne eigene Wahl folgt die Klasse der gewählten Runde (soweit eindeutig).
  const [klasseWahl, setKlasseWahl] = useState<string | null>(null);
  const { data: alleRunden } = useQuery(finanzierungsrunden(organisationId));
  const rundenKlassen = new Set((alleRunden?.find((r) => r.id === werte.rundeId)?.positionen ?? []).flatMap((p) => (p.anteilsklasse ? [p.anteilsklasse.id] : [])));
  const rundenKlasse = modus === "bestehend" && rundenKlassen.size === 1 ? [...rundenKlassen][0]! : "";
  const klasseId = klasseWahl ?? rundenKlasse;
  const [geprueft, setGeprueft] = useState<string | null>(null);

  const eingabe = (): WandlungEingabe => ({
    ...(instrumentId ? { instrumentId } : {}),
    cutoff: werte.cutoff,
    zinsenWandeln: zinsenWandeln === "ja",
    preisregel: {
      ...(textOderNichts(werte.rundenpreis) ? { rundenpreisJeAnteil: betragOderNichts(werte.rundenpreis, sprache) ?? "" } : {}),
      ...(textOderNichts(werte.discount) ? { discount: prozentZuAnteil(werte.discount) } : {}),
      ...(textOderNichts(werte.obergrenze) || textOderNichts(werte.obergrenzeAnteile)
        ? { bewertungsobergrenze: { betrag: betragOderNichts(werte.obergrenze, sprache) ?? "", anteileVorRunde: ganzzahl(werte.obergrenzeAnteile) } }
        : {}),
    },
    nennwertJeAnteil: betragOderNichts(werte.nennwert, sprache) ?? "",
    runde:
      modus === "bestehend"
        ? { id: werte.rundeId }
        : {
            neu: {
              bezeichnung: werte.neuBezeichnung.trim(),
              ...(textOderNichts(werte.neuDatum) ? { datum: werte.neuDatum } : {}),
              preMoney: betragOderNichts(werte.preMoney, sprache) ?? "",
              postMoney: betragOderNichts(werte.postMoney, sprache) ?? "",
              preisJeAnteil: betragOderNichts(werte.preis, sprache) ?? "",
              anteileGesamtNach: ganzzahl(werte.anteileNach),
            },
          },
    rolle: werte.rolle as WandlungEingabe["rolle"],
    // Abweichende Beträge nur, wenn angegeben; die Art des Rests nur dazu (leer = wie errechnet).
    ...(textOderNichts(werte.gewandeltesDarlehen) ? { gewandeltesDarlehen: betragOderNichts(werte.gewandeltesDarlehen, sprache) ?? "", darlehenRest } : {}),
    ...(textOderNichts(werte.gewandelteZinsen) ? { gewandelteZinsen: betragOderNichts(werte.gewandelteZinsen, sprache) ?? "", zinsenRest } : {}),
    ...(klasseId ? { anteilsklasseId: klasseId } : {}),
  });
  const schluessel = JSON.stringify(eingabe());
  const ergebnis = vorschau.data as unknown as Ergebnis | undefined;
  const aktuell = ergebnis !== undefined && geprueft === schluessel;
  const veraltet = ergebnis !== undefined && !aktuell && !buchen.isSuccess;
  const gebucht = buchen.data as unknown as Ergebnis | undefined;
  const aktiveFehler = buchen.error ?? vorschau.error;
  const fehler = (name: string) => feldText(t, aktiveFehler, name);

  const spalten: TabelleSpalte<NonNullable<Ergebnis["vorgaenge"]>[number]>[] = [
    { schluessel: "beteiligung", kopf: f.buchungSpalten.beteiligung, zelle: (v) => aufzaehlung(t.geplanteBeteiligung, v.beteiligung) },
    { schluessel: "art", kopf: f.buchungSpalten.art, zelle: (v) => aufzaehlung(t.vorgangArt, v.art) },
    { schluessel: "valuta", kopf: f.buchungSpalten.valuta, zelle: (v) => formatDatum(v.valuta, sprache) },
    { schluessel: "betrag", kopf: f.buchungSpalten.betrag, zahl: true, zelle: (v) => formatBetragCent(v.betrag, sprache) },
  ];

  const ansicht = (e: Ergebnis, mitBuchungen: boolean) => (
    <div className="app-ergebnis">
      <dl className="app-fakten">
        <Fakt titel={f.zinsenBis} wert={formatBetragCent(e.gebucht.zinsen, sprache)} />
        <Fakt titel={f.wandlungsbetrag} wert={formatBetragCent(e.ergebnis.wandlungsbetrag, sprache)} />
        <Fakt titel={f.preisJeAnteil} wert={formatPreis(e.ergebnis.preisJeAnteil, sprache)} />
        <Fakt titel={f.regel} wert={aufzaehlung(t.massgeblich, e.ergebnis.massgeblich)} zahl={false} />
        <Fakt titel={f.anzahlAnteile} wert={formatAnzahl(e.ergebnis.anzahlAnteile, sprache)} />
        <Fakt titel={f.spitzenbetrag} wert={formatBetragCent(e.gebucht.spitzenbetrag, sprache)} />
        {rest(e.ergebnis.darlehenRest) ? <Fakt titel={f.restDarlehen} wert={`${formatBetragCent(e.ergebnis.darlehenRest!, sprache)} · ${aufzaehlung(f.restArt, e.ergebnis.restbehandlung?.darlehen ?? "zurueckgezahlt")}`} /> : null}
        {rest(e.ergebnis.zinsenRest) ? <Fakt titel={f.restZinsen} wert={`${formatBetragCent(e.ergebnis.zinsenRest!, sprache)} · ${aufzaehlung(f.restArt, e.ergebnis.restbehandlung?.zinsen ?? "zurueckgezahlt")}`} /> : null}
        <Fakt titel={f.nominal} wert={formatBetragCent(e.gebucht.nominal, sprache)} />
        <Fakt titel={f.agio} wert={formatBetragCent(e.gebucht.agio, sprache)} />
      </dl>
      {mitBuchungen && e.vorgaenge ? (
        <>
          <h3 className="app-gruppen-titel">{f.buchungen}</h3>
          <Tabelle beschriftung={f.buchungen} spalten={spalten} zeilen={e.vorgaenge} zeilenSchluessel={(v) => `${v.beteiligung}-${v.schluessel ?? v.art}-${v.betrag}`} />
        </>
      ) : null}
      <Rechenweg titel={f.rechenweg} stichtag={werte.cutoff} schritte={e.ergebnis.schritte} />
    </div>
  );

  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen} breit>
      <h2 className="cw-t-untertitel">{f.titel}</h2>
      {gebucht ? (
        <>
          <Hinweis>{f.erfolg}</Hinweis>
          {ansicht(gebucht, false)}
          {gebucht.zielBeteiligungId && gebucht.zielBeteiligungId !== beteiligungId ? (
            <p>
              <Link to="/beteiligungen/$id" params={{ id: gebucht.zielBeteiligungId }} search={{}}>
                {f.zurZiel}
              </Link>
            </p>
          ) : gebucht.zielInstrumentId ? (
            <p>
              <Link to="/beteiligungen/$id" params={{ id: beteiligungId }} search={{ tab: "finanzierung", unter: "instrumente" }} hash={`instrument-${gebucht.zielInstrumentId}`}>
                {f.zumInstrument}
              </Link>
            </p>
          ) : null}
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
              const body = eingabe();
              vorschau.mutate(body, { onSuccess: () => setGeprueft(JSON.stringify(body)) });
            }}
          >
            <FehlerHinweis fehler={aktiveFehler} bekannt={FELDER} />
            <div className="app-feldgruppe">
              <Feld label={f.cutoff} type="date" max={heuteIso()} hilfe={f.cutoffHilfe} {...feld("cutoff", fehler("cutoff"))} />
              <Auswahl label={f.zinsen} value={zinsenWandeln} onChange={(e) => setZinsenWandeln(e.target.value)} fehler={fehler("zinsenWandeln")}>
                <option value="ja">{f.zinsenGewandelt}</option>
                <option value="nein">{f.zinsenAusgezahlt}</option>
              </Auswahl>
              <BetragFeld label={f.nennwert} {...feld("nennwert", fehler("nennwertJeAnteil"))} />
              <BetragFeld label={f.rundenpreis} hilfe={f.rundenpreisHilfe} {...feld("rundenpreis", fehler("preisregel.rundenpreisJeAnteil"))} />
              <BetragFeld label={f.discount} {...feld("discount", fehler("preisregel.discount"))} />
              <BetragFeld label={f.obergrenze} {...feld("obergrenze", fehler("preisregel.bewertungsobergrenze.betrag"))} />
              <BetragFeld label={f.obergrenzeAnteile} inputMode="numeric" {...feld("obergrenzeAnteile", fehler("preisregel.bewertungsobergrenze.anteileVorRunde"))} />
            </div>

            <fieldset className="app-gruppe">
              <legend className="cw-feld__label">{f.abweichung}</legend>
              <p className="app-leer-text">{f.abweichungHilfe}</p>
              <div className="app-feldgruppe">
                <BetragFeld label={f.gewandeltesDarlehen} {...feld("gewandeltesDarlehen", fehler("gewandeltesDarlehen"))} />
                <Auswahl label={f.restDarlehenWahl} value={darlehenRest} onChange={(e) => setDarlehenRest(e.target.value as Rest)} fehler={fehler("darlehenRest")}>
                  <option value="zurueckgezahlt">{f.restArt.zurueckgezahlt}</option>
                  <option value="erlassen">{f.restArt.erlassen}</option>
                </Auswahl>
                <BetragFeld label={f.gewandelteZinsen} {...feld("gewandelteZinsen", fehler("gewandelteZinsen"))} />
                <Auswahl label={f.restZinsenWahl} value={zinsenRest} onChange={(e) => setZinsenRest(e.target.value as Rest)} fehler={fehler("zinsenRest")}>
                  <option value="zurueckgezahlt">{f.restArt.zurueckgezahlt}</option>
                  <option value="erlassen">{f.restArt.erlassen}</option>
                </Auswahl>
              </div>
            </fieldset>

            <fieldset className="app-gruppe">
              <legend className="cw-feld__label">{f.runde}</legend>
              <Segment<Modus>
                aria-label={f.runde}
                value={modus}
                onChange={setModus}
                options={[
                  { wert: "bestehend", label: f.rundeBestehend },
                  { wert: "neu", label: f.rundeNeu },
                ]}
              />
            </fieldset>
            {modus === "bestehend" ? (
              frei.length === 0 && runden.length === 0 ? (
                <Hinweis>{f.keineRunde}</Hinweis>
              ) : (
                <Auswahl label={f.rundeWaehlen} {...feld("rundeId", fehler("runde.id") ?? fehler("runde"))}>
                  {runden.map((r) => (
                    <option key={r.id} value={r.id} disabled={r.belegt}>
                      {r.belegt ? f.rundeBelegt(`${r.bezeichnung} · ${formatDatum(r.datum, sprache)}`) : `${r.bezeichnung} · ${formatDatum(r.datum, sprache)}`}
                    </option>
                  ))}
                </Auswahl>
              )
            ) : (
              <div className="app-feldgruppe">
                <Feld label={f.neueBezeichnung} autoComplete="off" {...feld("neuBezeichnung", fehler("runde.neu.bezeichnung") ?? fehler("runde"))} />
                <Feld label={f.neuDatum} type="date" {...feld("neuDatum", fehler("runde.neu.datum"))} />
                <BetragFeld label={f.preMoney} {...feld("preMoney", fehler("runde.neu.preMoney"))} />
                <BetragFeld label={f.postMoney} {...feld("postMoney", fehler("runde.neu.postMoney"))} />
                <BetragFeld label={f.preis} {...feld("preis", fehler("runde.neu.preisJeAnteil"))} />
                <BetragFeld label={f.anteileNach} inputMode="numeric" {...feld("anteileNach", fehler("runde.neu.anteileGesamtNach"))} />
              </div>
            )}
            <Auswahl label={f.rolle} {...feld("rolle")} fehler={fehler("rolle")}>
              {(["lead", "co_lead", "co"] as const).map((r) => (
                <option key={r} value={r}>
                  {t.rundenRolle[r]}
                </option>
              ))}
            </Auswahl>

            <Auswahl label={f.klasse} value={klasseId} onChange={(e) => setKlasseWahl(e.target.value)} fehler={fehler("anteilsklasseId")}>
              <option value="">{f.keineKlasse}</option>
              {(klassen ?? []).map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </Auswahl>

            <div className="app-knoepfe">
              <Button type="submit" variante="sekundaer" disabled={vorschau.isPending}>
                {f.vorschau}
              </Button>
              <Button disabled={!aktuell || buchen.isPending} aria-describedby="wandlung-buchen-hinweis" onClick={() => buchen.mutate(eingabe())}>
                {f.buchen}
              </Button>
            </div>
            <p id="wandlung-buchen-hinweis" className="app-leer-text" role={veraltet ? "alert" : undefined}>
              {veraltet ? f.veraltet : aktuell ? "" : f.nichtBuchbar}
            </p>
          </form>
          {ergebnis ? (
            <section aria-label={f.vorschauTitel}>
              <h3 className="app-gruppen-titel">{f.vorschauTitel}</h3>
              {ansicht(ergebnis, true)}
            </section>
          ) : null}
        </>
      )}
    </Seitenpanel>
  );
}

/** Ein Rest größer null (Zeichenkette der API, auch „0“ und „0.00“ als null). */
const rest = (betrag: string | undefined) => betrag !== undefined && Number(betrag) > 0;

function Fakt({ titel, wert, zahl = true }: { titel: string; wert: string; zahl?: boolean }) {
  return (
    <div>
      <dt>{titel}</dt>
      <dd className={zahl ? "app-zahl" : undefined}>{wert}</dd>
    </div>
  );
}
