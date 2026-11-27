import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Feld, Hinweis, Markdown, Status, Tabelle, Textbereich, formatBetrag, formatDatum, type StatusVariante, type TabelleSpalte } from "@carraway/ui";
import { beteiligungBewertungen, type BewertungZeile } from "../api/abfragen";
import { heuteIso } from "../api/datum";
import { useBewertungAktion, useBewertungAnlegen, type BewertungAktion } from "../api/mutationen";
import { feldText } from "../i18n/fehler";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { useNamen } from "../lib/namen";
import { useRechte } from "../lib/rechte";
import { formatBetragCent } from "../lib/zahl";
import { formatZeitpunkt } from "../lib/zeit";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "./FehlerHinweis";
import { betragFuerFeld, betragOderNichts, textOderNichts, useFormular } from "./formular";
import { BetragFeld } from "./BetragFeld";
import { betragRegel, datumRegel } from "../lib/feldpruefung";
import { Skelettzeilen } from "./Skelett";
import { beteiligungWaehrungssicht } from "../api/waehrung";

// Der Dialog der Wertberichtigung lädt erst beim Öffnen.
const WertberichtigungDialog = lazy(() => import("./WertberichtigungDialog").then((m) => ({ default: m.WertberichtigungDialog })));

const STATUS: Record<string, StatusVariante> = { entwurf: "entwurf", freigegeben: "freigegeben", ersetzt: "pruefung", verworfen: "fehlt" };
const METHODEN = ["anschaffungskosten", "letzte_runde", "multiplikator", "dcf", "sonstige"] as const;
const FELDER = ["stichtag", "wert", "wertLokal", "methode", "begruendung", "grundlage"];

/** Systembuchungen aus Ereignissen (Verkauf, Wandlung, Insolvenz) tragen diese Kennung statt einer Benutzer-ID. */
const EREIGNIS = "system:ereignis";

/**
 * Bewertungen einer Beteiligung mit Status, Verlauf der Ersetzungen und den Aktionen Erfassen, Korrigieren, Freigeben und Verwerfen.
 * Freigeben und Verwerfen bleiben sichtbar und erklären sich, wenn die Rolle oder das Vier-Augen-Prinzip sie sperrt (Entscheidung 95).
 */
export function BewertungenAbschnitt({ beteiligungId, fondsId, stichtag, lesend, bewertungId, stand, waehrung }: { waehrung?: string; bewertungId?: string; stand?: string; beteiligungId: string; fondsId: string; stichtag: string; lesend: boolean }) {
  const t = useT();
  const sprache = useSprache();
  const b = t.bewertungen;
  const { ich, darf } = useRechte();
  const { data, error, isPending } = useQuery(beteiligungBewertungen(beteiligungId, bewertungId ? { bewertungId, stichtag, stand } : undefined));
  const aktion = useBewertungAktion();
  const [dialog, setDialog] = useState<{ vorlage?: BewertungZeile } | null>(null);
  const [wertberichtigung, setWertberichtigung] = useState(false);
  const zeilen = data ?? [];
  const person = useNamen(zeilen.flatMap((z) => [z.erstelltVon, z.freigegebenVon]));
  const wer = (id: string | null) => (id === EREIGNIS ? t.rechte.ereignis : (person(id) ?? ""));
  const nachId = new Map(zeilen.map((z) => [z.id, z]));
  const offeneStichtage = new Set(zeilen.filter((z) => z.status === "entwurf").map((z) => z.stichtag));
  const darfErfassen = darf("bearbeiter", fondsId, "portfolio") && !lesend;
  const darfFreigeben = darf("freigeber", fondsId, "portfolio");

  function loese(z: BewertungZeile, a: BewertungAktion) {
    aktion.mutate({ id: z.id, aktion: a });
  }

  const spalten: TabelleSpalte<BewertungZeile>[] = [
    { schluessel: "stichtag", kopf: b.spalten.stichtag, zelle: (z) => <span className="app-zahl">{formatDatum(z.stichtag, sprache)}</span> },
    { schluessel: "wert", kopf: b.spalten.wert, zahl: true, zelle: (z) => bewertungId ? formatBetragCent(z.wert, sprache, waehrung) : formatBetrag(z.wert, sprache) },
    { schluessel: "methode", kopf: b.spalten.methode, zelle: (z) => aufzaehlung(t.bewertungMethode, z.methode) },
    { schluessel: "begruendung", kopf: b.spalten.begruendung, umbruch: true, zelle: (z) => (z.begruendung ? <Markdown text={z.begruendung} /> : t.gemeinsam.keinWert) },
    {
      // Status und Verlauf in einer Spalte: der Verlauf steht klein unter dem Status, damit die Tabelle bei 1280 px ohne Scrollen passt.
      schluessel: "status",
      kopf: b.spalten.status,
      umbruch: true,
      zelle: (z) => {
        const vorgaenger = z.ersetztBewertungId ? nachId.get(z.ersetztBewertungId) : undefined;
        return (
          <div className="app-status-verlauf">
            <Status variante={STATUS[z.status] ?? "entwurf"}>{aufzaehlung(b.status, z.status)}</Status>
            <ul className="app-liste-klein app-verlauf-liste" aria-label={b.spalten.verlauf}>
              <li>{b.erfasstVon(wer(z.erstelltVon))}</li>
              {z.freigegebenVon && z.freigegebenAm ? <li>{b.freigegebenVon(wer(z.freigegebenVon), formatZeitpunkt(z.freigegebenAm, sprache))}</li> : null}
              {z.ersetztAm ? <li>{b.ersetztAm(formatZeitpunkt(z.ersetztAm, sprache))}</li> : null}
              {vorgaenger && z.status === "entwurf" ? <li>{b.ersetztBeiFreigabe(formatBetrag(vorgaenger.wert, sprache))}</li> : null}
              {vorgaenger && z.status === "freigegeben" ? <li>{b.ersetztVorgaenger(formatBetrag(vorgaenger.wert, sprache), vorgaenger.freigegebenAm ? formatZeitpunkt(vorgaenger.freigegebenAm, sprache) : null)}</li> : null}
            </ul>
          </div>
        );
      },
    },
    ...(lesend
      ? []
      : [
          {
            schluessel: "aktion",
            kopf: b.spalten.aktion,
            zelle: (z: BewertungZeile) => {
              const datum = formatDatum(z.stichtag, sprache);
              if (z.status === "entwurf") {
                const selbst = ich !== undefined && z.erstelltVon === ich.id;
                const grund = !darfFreigeben ? t.rechte.braucht(aufzaehlung(t.rolle, "freigeber")) : selbst ? t.rechte.vierAugenBewertung : null;
                const grundId = `bewertung-grund-${z.id}`;
                return (
                  <div className="app-aktion-spalte">
                    <div className="app-aktionen__knoepfe">
                      <Button variante="sekundaer" disabled={aktion.isPending || grund !== null} aria-describedby={grund ? grundId : undefined} aria-label={b.aktionFuer(b.freigeben, datum)} onClick={() => loese(z, "freigeben")}>
                        {b.freigeben}
                      </Button>
                      <Button variante="ruhig" disabled={aktion.isPending || !darfFreigeben} aria-label={b.aktionFuer(b.verwerfen, datum)} onClick={() => loese(z, "verwerfen")}>
                        {b.verwerfen}
                      </Button>
                    </div>
                    {grund ? (
                      <span id={grundId} className="app-leer-text">
                        {grund}
                      </span>
                    ) : null}
                  </div>
                );
              }
              if (z.status === "freigegeben" && darfErfassen) {
                return offeneStichtage.has(z.stichtag) ? (
                  <span className="app-leer-text">{b.entwurfOffen}</span>
                ) : (
                  <Button variante="sekundaer" aria-label={b.aktionFuer(b.korrigieren, datum)} onClick={() => setDialog({ vorlage: z })}>
                    {b.korrigieren}
                  </Button>
                );
              }
              return t.gemeinsam.keinWert;
            },
          },
        ]),
  ];

  return (
    <section className="app-karte" aria-labelledby="bewertungen-titel">
      <div className="app-karte__kopf">
        <h2 id="bewertungen-titel" className="cw-t-untertitel app-karte__titel">
          {b.titel}
        </h2>
        {darfErfassen ? (
          <div className="app-knoepfe">
            <Button variante="sekundaer" onClick={() => setWertberichtigung(true)}>
              {b.wertberichtigung.knopf}
            </Button>
            <Button onClick={() => setDialog({})}>{b.erfassen}</Button>
          </div>
        ) : null}
      </div>
      <p className="app-leer-text">{b.beschreibung}</p>
      {lesend ? <Hinweis>{b.stand}</Hinweis> : null}
      <FehlerHinweis fehler={aktion.error} />
      {isPending ? <Skelettzeilen anzahl={3} /> : null}
      {error ? <FehlerHinweis fehler={error} /> : null}
      {data && zeilen.length === 0 ? <p className="app-leer-text">{b.keine}</p> : null}
      {zeilen.length > 0 ? <Tabelle beschriftung={b.tabelle} className="app-bewertungen-tabelle" spalten={spalten} zeilen={zeilen} zeilenSchluessel={(z) => z.id} /> : null}
      {wertberichtigung ? (
        <Suspense fallback={null}>
          <WertberichtigungDialog beteiligungId={beteiligungId} onSchliessen={() => setWertberichtigung(false)} />
        </Suspense>
      ) : null}
      {dialog ? <BewertungDialog beteiligungId={beteiligungId} stichtag={stichtag} {...(dialog.vorlage ? { vorlage: dialog.vorlage } : {})} onSchliessen={() => setDialog(null)} /> : null}
    </section>
  );
}

/** Neuer Entwurf oder Korrektur (neuer Entwurf zum selben Stichtag, der die geltende Bewertung bei der Freigabe ersetzt). */
function BewertungDialog({ beteiligungId, stichtag, vorlage, onSchliessen }: { beteiligungId: string; stichtag: string; vorlage?: BewertungZeile; onSchliessen: () => void }) {
  const t = useT();
  const f = t.bewertungen.form;
  const anlegen = useBewertungAnlegen(beteiligungId);
  // Bei abweichender lokaler Währung lässt sich der Wert auch lokal erfassen; der Kurs der Tabelle zum Stichtag rechnet ihn um (Etappe 21).
  const { data: ws } = useQuery(beteiligungWaehrungssicht(beteiligungId, {}));
  const fremd = ws && ws.waehrungen.lokal !== ws.waehrungen.fonds ? ws.waehrungen : null;
  const sprache = useSprache();
  const { werte, feld, pruefeAlle } = useFormular({
    stichtag: vorlage?.stichtag ?? stichtag ?? heuteIso(),
    wert: betragFuerFeld(vorlage?.wert),
    wertLokal: "",
    methode: vorlage?.methode ?? "letzte_runde",
    begruendung: vorlage?.begruendung ?? "",
    grundlage: vorlage?.grundlage ?? "",
  },
  {
    stichtag: datumRegel({ pflicht: true }),
    // Bei abweichender lokaler Währung genügt einer der beiden Werte.
    wert: (w, ws, k) => betragRegel<typeof ws>({ pflicht: !fremd || ws.wertLokal.trim() === "" })(w, ws, k),
    wertLokal: betragRegel(),
  });
  const pflicht = werte.methode !== "anschaffungskosten";
  const fehler = (name: string) => feldText(t, anlegen.error, name);
  const titel = vorlage ? f.titelKorrektur : f.titelNeu;
  return (
    <Seitenpanel titel={titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{titel}</h2>
      <p className="app-leer-text">{vorlage ? f.beschreibungKorrektur : f.beschreibungNeu}</p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!pruefeAlle()) return;
          anlegen.mutate(
            {
              stichtag: werte.stichtag,
              ...(fremd && betragOderNichts(werte.wertLokal, sprache) ? { wertLokal: betragOderNichts(werte.wertLokal, sprache)!, ...(betragOderNichts(werte.wert, sprache) ? { wert: betragOderNichts(werte.wert, sprache)! } : {}) } : { wert: betragOderNichts(werte.wert, sprache) ?? "" }),
              methode: werte.methode as (typeof METHODEN)[number],
              ...(textOderNichts(werte.begruendung) ? { begruendung: textOderNichts(werte.begruendung) } : {}),
              ...(textOderNichts(werte.grundlage) ? { grundlage: textOderNichts(werte.grundlage) } : {}),
            },
            { onSuccess: onSchliessen },
          );
        }}
      >
        <FehlerHinweis fehler={anlegen.error} bekannt={FELDER} />
        <Feld label={f.stichtag} type="date" required {...feld("stichtag", fehler("stichtag"))} readOnly={vorlage !== undefined} />
        {fremd ? <BetragFeld label={t.waehrung.wertLokal(fremd.lokal)} hilfe={t.waehrung.wertLokalHilfe(fremd.fonds)} {...feld("wertLokal", fehler("wertLokal"))} /> : null}
        <BetragFeld label={fremd ? `${f.wert} (${fremd.fonds})` : f.wert} required={!fremd} {...feld("wert", fehler("wert"))} />
        <Auswahl label={f.methode} {...feld("methode")} fehler={fehler("methode")}>
          {METHODEN.map((m) => (
            <option key={m} value={m}>
              {aufzaehlung(t.bewertungMethode, m)}
            </option>
          ))}
        </Auswahl>
        <Textbereich label={f.begruendung} hilfe={pflicht ? f.begruendungHilfePflicht : f.begruendungHilfeFrei} {...feld("begruendung")} required={pflicht} fehler={fehler("begruendung")} />
        <Feld label={f.grundlage} {...feld("grundlage")} fehler={fehler("grundlage")} />
        <div>
          <Button type="submit" disabled={anlegen.isPending}>
            {f.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
