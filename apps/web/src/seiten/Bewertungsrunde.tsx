import { Bereichskopf } from "../komponenten/Bereichskopf";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Auswahl, Button, Feld, Hinweis, Markdown, Segment, Status, Tabelle, Textbereich, formatBetrag, formatDatum, type StatusVariante, type TabelleSpalte, Leer } from "@carraway/ui";
import { rundeDetail, rundenListe, type RundeDetail, type RundeZeile } from "../api/abfragen";
import { heuteIso } from "../api/datum";
import { useBewertungAendern, useRundeAktion, useRundeAnlegen } from "../api/mutationen";
import { Seitenpanel } from "@carraway/ui";
import { betragFuerFeld, betragOderNichts, textOderNull, useFormular } from "../komponenten/formular";
import { BetragFeld } from "../komponenten/BetragFeld";
import { betragRegel, datumRegel, pflichtRegel } from "../lib/feldpruefung";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { Skelettzeilen } from "../komponenten/Skelett";
import { feldText } from "../i18n/fehler";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { useNamen } from "../lib/namen";
import { useRechte } from "../lib/rechte";
import { formatZeitpunkt } from "../lib/zeit";

const route = getRouteApi("/funds/$fundId/valuation-round");

type Vorschlag = "fortschreiben" | "letzte_runde";
type Entwurf = RundeDetail["bewertungen"][number];
const METHODEN = ["anschaffungskosten", "letzte_runde", "multiplikator", "dcf", "sonstige"] as const;

const STATUS: Record<string, StatusVariante> = { entwurf: "pruefung", freigegeben: "freigegeben", verworfen: "fehlt" };

/**
 * Bewertungsrunde eines Fonds: Runde zu einem Stichtag anlegen, die Entwürfe ansehen, alle gemeinsam freigeben (Vier-Augen) oder
 * verwerfen. Die Werte offener Entwürfe lassen sich ändern; die Liste der übersprungenen Beteiligungen speichert die API mit der Runde.
 */
export function BewertungsrundeSeite() {
  const t = useT();
  const sprache = useSprache();
  const r = t.runde;
  const { fundId: fondsId } = route.useParams();
  const { stichtag } = route.useSearch();
  const { data: runden, error, isPending } = useQuery(rundenListe(fondsId));
  const { darf } = useRechte();
  const anlegen = useRundeAnlegen(fondsId);
  const [vorschlag, setVorschlag] = useState<Vorschlag>("fortschreiben");
  const { werte: rundenwerte, feld: rundenfeld, pruefeAlle: rundePruefen } = useFormular({ datum: stichtag ?? heuteIso() }, { datum: datumRegel({ pflicht: true }) });
  const datum = rundenwerte.datum;
  const [meldung, setMeldung] = useState<string | null>(null);

  const offene = (runden ?? []).filter((x) => x.status === "entwurf");
  const fruehere = (runden ?? []).filter((x) => x.status !== "entwurf");
  const person = useNamen((runden ?? []).map((x) => x.erstelltVon));

  function starten() {
    setMeldung(null);
    anlegen.mutate(
      { stichtag: datum, vorschlag },
      {
        onSuccess: (antwort) => {
          setMeldung(r.angelegt(antwort.bewertungen.length, antwort.uebersprungen.length));
        },
      },
    );
  }

  const fruehereSpalten: TabelleSpalte<RundeZeile>[] = [
    { schluessel: "stichtag", kopf: r.fruehereSpalten.stichtag, zelle: (x) => formatDatum(x.stichtag, sprache) },
    { schluessel: "vorschlag", kopf: r.fruehereSpalten.vorschlag, zelle: (x) => aufzaehlung(r.vorschlaege, x.vorschlag) },
    { schluessel: "status", kopf: r.fruehereSpalten.status, zelle: (x) => <Status variante={STATUS[x.status] ?? "entwurf"}>{aufzaehlung(r.status, x.status)}</Status> },
    { schluessel: "erstelltVon", kopf: r.fruehereSpalten.erstelltVon, zelle: (x) => r.erstelltVon(person(x.erstelltVon) ?? "", formatZeitpunkt(x.erstelltAm, sprache)) },
  ];

  return (
    <div className="app-seite">
      <Bereichskopf info={r.beschreibung} titel={r.titel} />
      {meldung ? <Hinweis>{meldung}</Hinweis> : null}

      {darf("bearbeiter", fondsId, "portfolio") ? (
        <section className="app-karte" aria-labelledby="runde-neu-titel">
          <h2 id="runde-neu-titel" className="cw-t-untertitel app-karte__titel">
            {r.neu}
          </h2>
          <form
            className="app-formular"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!rundePruefen()) return;
              starten();
            }}
          >
            <FehlerHinweis fehler={anlegen.error} bekannt={["stichtag", "vorschlag"]} />
            <Feld label={r.stichtag} type="date" {...rundenfeld("datum", feldText(t, anlegen.error, "stichtag"))} />
              <div className="app-gruppe">
                <span className="cw-feld__label" id="runde-vorschlag">
                  {r.vorschlag}
                </span>
                <Segment<Vorschlag>
                  aria-labelledby="runde-vorschlag"
                  value={vorschlag}
                  onChange={setVorschlag}
                  options={(["fortschreiben", "letzte_runde"] as const).map((w) => ({ wert: w, label: aufzaehlung(r.vorschlaege, w) }))}
                />
                <span className="cw-feld__hilfe">{aufzaehlung(r.vorschlagHilfe, vorschlag)}</span>
              </div>
            <div>
              <Button type="submit" disabled={anlegen.isPending}>
                {r.anlegen}
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      {isPending ? <Skelettzeilen anzahl={3} /> : null}
      {error ? <FehlerHinweis fehler={error} /> : null}
      {runden && offene.length === 0 ? (
        <section className="app-karte" aria-labelledby="runde-offen-titel">
          <h2 id="runde-offen-titel" className="cw-t-untertitel app-karte__titel">
            {r.offenTitel}
          </h2>
          <Leer kompakt titel={r.keineOffene} beschreibung={r.keineOffeneHilfe} />
        </section>
      ) : null}
      {offene.map((runde) => (
        <OffeneRunde key={runde.id} runde={runde} fondsId={fondsId} onMeldung={setMeldung} />
      ))}

      {fruehere.length > 0 ? (
        <section className="app-karte" aria-labelledby="runde-fruehere-titel">
          <h2 id="runde-fruehere-titel" className="cw-t-untertitel app-karte__titel">
            {r.fruehere}
          </h2>
          <Tabelle dicht beschriftung={r.fruehereTabelle} spalten={fruehereSpalten} zeilen={fruehere} zeilenSchluessel={(x) => x.id} />
        </section>
      ) : null}
    </div>
  );
}

function OffeneRunde({ runde, fondsId, onMeldung }: { runde: RundeZeile; fondsId: string; onMeldung: (text: string | null) => void }) {
  const t = useT();
  const sprache = useSprache();
  const r = t.runde;
  const { ich, darf } = useRechte();
  const { data, error, isPending } = useQuery(rundeDetail(runde.id));
  const aktion = useRundeAktion();
  const person = useNamen([runde.erstelltVon]);
  const [aendern, setAendern] = useState<Entwurf | null>(null);
  const darfFreigeben = darf("freigeber", fondsId, "portfolio");
  const darfAendern = darf("bearbeiter", fondsId, "portfolio");
  const selbst = ich !== undefined && runde.erstelltVon === ich.id;
  // Die API verlangt für jeden Entwurf eine andere Person als seinen Urheber (wer ändert, wird Urheber).
  const eigenerEntwurf = ich !== undefined && (data?.bewertungen ?? []).some((x) => x.status === "entwurf" && x.erstelltVon === ich.id);
  const grund = !darfFreigeben ? t.rechte.braucht(aufzaehlung(t.rolle, "freigeber")) : selbst ? t.rechte.vierAugenRunde : eigenerEntwurf ? r.vierAugenEntwurf : null;
  const uebersprungen = data?.uebersprungen ?? [];

  const spalten: TabelleSpalte<Entwurf>[] = [
    {
      schluessel: "unternehmen",
      kopf: r.spalten.unternehmen,
      zelle: (x) => (
        <Link to="/investments/$id" params={{ id: x.beteiligungId }} search={{ stichtag: runde.stichtag }} aria-label={r.zurBeteiligung(x.organisation)}>
          {x.organisation}
        </Link>
      ),
    },
    { schluessel: "wert", kopf: r.spalten.wert, zahl: true, zelle: (x) => formatBetrag(x.wert, sprache) },
    { schluessel: "methode", kopf: r.spalten.methode, zelle: (x) => aufzaehlung(t.bewertungMethode, x.methode) },
    { schluessel: "begruendung", kopf: r.spalten.begruendung, umbruch: true, zelle: (x) => (x.begruendung ? <Markdown text={x.begruendung} /> : t.gemeinsam.keinWert) },
    { schluessel: "status", kopf: t.bewertungen.spalten.status, zelle: (x) => <Status variante={x.status === "freigegeben" ? "freigegeben" : x.status === "verworfen" ? "fehlt" : "pruefung"}>{aufzaehlung(t.bewertungen.status, x.status)}</Status> },
    ...(darfAendern
      ? [
          {
            schluessel: "aktion",
            kopf: r.spalten.aktion,
            zelle: (x: Entwurf) =>
              x.status === "entwurf" ? (
                <Button variante="sekundaer" aria-label={r.aendernFuer(x.organisation)} onClick={() => setAendern(x)}>
                  {r.aendern}
                </Button>
              ) : (
                t.gemeinsam.keinWert
              ),
          },
        ]
      : []),
  ];

  function ausfuehren(a: "freigeben" | "verwerfen") {
    onMeldung(null);
    aktion.mutate(
      { id: runde.id, aktion: a },
      {
        onSuccess: (antwort) => {
          if (a === "freigeben" && "freigegeben" in antwort) onMeldung(r.freigegeben(antwort.freigegeben));
          else onMeldung(r.verworfenMeldung);
        },
      },
    );
  }

  return (
    <section className="app-karte" aria-labelledby={`runde-${runde.id}`}>
      <div className="app-karte__kopf">
        <h2 id={`runde-${runde.id}`} className="cw-t-untertitel app-karte__titel">
          {r.offeneRunde(formatDatum(runde.stichtag, sprache))}
        </h2>
        <Status variante="pruefung">{aufzaehlung(r.vorschlaege, runde.vorschlag)}</Status>
      </div>
      <p className="app-leer-text">{r.erstelltVon(person(runde.erstelltVon) ?? "", formatZeitpunkt(runde.erstelltAm, sprache))}</p>
      <h3 className="app-gruppen-titel">{r.entwuerfe}</h3>
      {isPending ? <Skelettzeilen anzahl={3} /> : null}
      {error ? <FehlerHinweis fehler={error} /> : null}
      {data && data.bewertungen.length === 0 ? <p className="app-leer-text">{r.keineEntwuerfe}</p> : null}
      {data && data.bewertungen.length > 0 ? <Tabelle beschriftung={r.entwuerfeTabelle} spalten={spalten} zeilen={data.bewertungen} zeilenSchluessel={(x) => x.id} /> : null}
      <p className="app-leer-text">{r.lesen}</p>

      {data && uebersprungen.length > 0 ? (
        <>
          <h3 className="app-gruppen-titel">{r.uebersprungen}</h3>
          <ul className="app-liste-klein" aria-label={r.uebersprungen}>
            {uebersprungen.map((u) => (
              <li key={u.beteiligungId}>
                <Link to="/investments/$id" params={{ id: u.beteiligungId }} search={{ stichtag: runde.stichtag }}>
                  {u.organisation}
                </Link>
                : {aufzaehlung(r.gruende, u.grund)}
              </li>
            ))}
          </ul>
        </>
      ) : data ? (
        <p className="app-leer-text">{r.keineUebersprungen}</p>
      ) : null}

      <FehlerHinweis fehler={aktion.error} />
      <div className="app-aktionen__knoepfe">
        <Button disabled={aktion.isPending || grund !== null} aria-describedby={grund ? `runde-grund-${runde.id}` : undefined} onClick={() => ausfuehren("freigeben")}>
          {r.freigeben}
        </Button>
        <Button variante="gefahr" disabled={aktion.isPending || !darfFreigeben} onClick={() => ausfuehren("verwerfen")}>
          {r.verwerfen}
        </Button>
      </div>
      {grund ? (
        <p id={`runde-grund-${runde.id}`} className="app-leer-text">
          {grund}
        </p>
      ) : null}
      {aendern ? <EntwurfAendernDialog entwurf={aendern} onSchliessen={() => setAendern(null)} /> : null}
    </section>
  );
}

/** Wert, Methode und Begründung eines offenen Entwurfs ändern (PATCH); die Begründung bleibt außer bei Anschaffungskosten Pflicht. */
function EntwurfAendernDialog({ entwurf, onSchliessen }: { entwurf: Entwurf; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const f = t.bewertungen.form;
  const r = t.runde;
  const aendern = useBewertungAendern();
  const pflicht = entwurf.methode !== "anschaffungskosten";
  const { werte, feld, pruefeAlle } = useFormular(
    { wert: betragFuerFeld(entwurf.wert), methode: entwurf.methode as string, begruendung: entwurf.begruendung ?? "" },
    // Die Begründung ist außer bei Anschaffungskosten Pflicht; die Methode kann im Formular wechseln.
    { wert: betragRegel({ pflicht: true }), begruendung: (w, ws, k) => (ws.methode !== "anschaffungskosten" ? pflichtRegel<typeof ws>()(w, ws, k) : undefined) },
  );
  const fehler = (name: string) => feldText(t, aendern.error, name);
  return (
    <Seitenpanel titel={r.aendernForm.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{r.aendernForm.titel}</h2>
      <p className="app-leer-text">{r.aendernForm.beschreibung(entwurf.organisation)}</p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!pruefeAlle()) return;
          aendern.mutate(
            { id: entwurf.id, wert: betragOderNichts(werte.wert, sprache) ?? "", methode: werte.methode as (typeof METHODEN)[number], begruendung: textOderNull(werte.begruendung) },
            { onSuccess: onSchliessen },
          );
        }}
      >
        <FehlerHinweis fehler={aendern.error} bekannt={["wert", "methode", "begruendung"]} />
        <BetragFeld label={f.wert} {...feld("wert", fehler("wert"))} />
        <Auswahl label={f.methode} {...feld("methode")} fehler={fehler("methode")}>
          {METHODEN.map((m) => (
            <option key={m} value={m}>
              {aufzaehlung(t.bewertungMethode, m)}
            </option>
          ))}
        </Auswahl>
        <Textbereich markdown label={f.begruendung} hilfe={pflicht ? f.begruendungHilfePflicht : f.begruendungHilfeFrei} {...feld("begruendung", fehler("begruendung"))} required={pflicht} />
        <div>
          <Button type="submit" disabled={aendern.isPending}>
            {r.aendernForm.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
