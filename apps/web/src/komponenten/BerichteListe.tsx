import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Auswahl, Button, Feld, Segment, Status, Tabelle, formatDatum, type StatusVariante, type TabelleSpalte } from "@carraway/ui";
import { fondsUebersicht, berichtListe, type BerichtZeile } from "../api/abfragen";
import { useBerichtAnlegen } from "../api/mutationen";
import { feldCodeText, feldText } from "../i18n/fehler";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { feldpruefungTexte } from "../i18n/feldpruefung";
import { anlegbareArten, FORMATE, SICHT_ARTEN, stufenNamen, type Berichtsart } from "../lib/berichte";
import { useNamen } from "../lib/namen";
import { alsDatetimeLocal, alsStand, formatZeitpunkt } from "../lib/zeit";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "./FehlerHinweis";
import { useFormular } from "./formular";
import { Skelettzeilen } from "./Skelett";
import { FONDS_SICHT, istWaehrungscode, sichtAnfrage, WaehrungssichtWahl, type SichtZustand } from "./WaehrungssichtWahl";

export const BERICHT_STATUS: Record<string, StatusVariante> = { entwurf: "entwurf", geprueft: "pruefung", freigegeben: "freigegeben" };
const FELDER = ["art", "format", "fondsId", "beteiligungId", "stichtag", "sprache", "stand", "waehrungssicht", "vergleichswaehrung"];

/** Berichte des Fonds mit Status und aktueller Stufe; „Bericht anlegen“ legt einen Entwurf an und öffnet ihn. */
export function BerichteListe({ fondsId }: { fondsId: string }) {
  const t = useT();
  const sprache = useSprache();
  const l = t.bericht.liste;
  const { data, error, isPending } = useQuery(berichtListe(fondsId));
  const zeilen = data ?? [];
  const person = useNamen(zeilen.map((z) => z.erstelltVon));

  const spalten: TabelleSpalte<BerichtZeile>[] = [
    { schluessel: "art", kopf: l.spalten.art, zelle: (z) => aufzaehlung(t.bericht.art, z.art) },
    { schluessel: "stichtag", kopf: l.spalten.stichtag, zelle: (z) => <span className="app-zahl">{formatDatum(z.stichtag, sprache)}</span> },
    { schluessel: "sprache", kopf: l.spalten.sprache, zelle: (z) => aufzaehlung(t.bericht.sprachen, z.sprache) },
    { schluessel: "status", kopf: l.spalten.status, zelle: (z) => <Status variante={BERICHT_STATUS[z.status] ?? "entwurf"}>{aufzaehlung(t.bericht.status, z.status)}</Status> },
    {
      schluessel: "stufe",
      kopf: l.spalten.stufe,
      zelle: (z) => {
        const stufen = stufenNamen(z);
        const name = stufen[z.naechsteStufe];
        return z.status === "freigegeben" || name === undefined ? l.abgeschlossen : l.stufe(z.naechsteStufe + 1, stufen.length, name);
      },
    },
    { schluessel: "erstellt", kopf: l.spalten.erstellt, zelle: (z) => `${person(z.erstelltVon) ?? ""}, ${formatZeitpunkt(z.erstelltAm, sprache)}` },
    {
      schluessel: "aktion",
      kopf: l.spalten.aktion,
      zelle: (z) => (
        <Link to="/berichte/$id" params={{ id: z.id }} aria-label={l.oeffnen(aufzaehlung(t.bericht.art, z.art), formatDatum(z.stichtag, sprache))}>
          {l.oeffnenKurz}
        </Link>
      ),
    },
  ];

  return (
    <div className="app-karte">
      <p className="app-leer-text">{l.beschreibung}</p>
      {isPending ? <Skelettzeilen anzahl={3} /> : null}
      {error ? <FehlerHinweis fehler={error} /> : null}
      {data && data.length === 0 ? <p className="app-leer-text">{l.keine}</p> : null}
      {data && data.length > 0 ? <Tabelle beschriftung={l.tabelle} spalten={spalten} zeilen={data} zeilenSchluessel={(z) => z.id} /> : null}
    </div>
  );
}

export function BerichtDialog({ fondsId, stichtag, stand, onSchliessen }: { fondsId: string; stichtag: string | undefined; stand: string | undefined; onSchliessen: () => void }) {
  const t = useT();
  const uiSprache = useSprache();
  const f = t.bericht.neu;
  const anlegen = useBerichtAnlegen();
  const navigate = useNavigate();
  const { werte, feld } = useFormular({ art: "fondsbericht", stichtag: "", format: "pdf", beteiligungId: "", stand: "" });
  const [sprache, setSprache] = useState<"de" | "en">(uiSprache);
  const [standFehler, setStandFehler] = useState<string | undefined>();
  const [sicht, setSicht] = useState<SichtZustand>(FONDS_SICHT);
  const [sichtFehler, setSichtFehler] = useState<string | undefined>();
  const art = werte.art as Berichtsart;
  const formate = FORMATE[art];
  const format = formate.includes(werte.format as "pdf" | "xlsx") ? werte.format : "pdf";
  const mitBeteiligung = art === "quartalsbericht";
  const auswahl = useQuery({ ...fondsUebersicht(fondsId, stichtag, stand), enabled: mitBeteiligung });
  const beteiligungen = auswahl.data?.beteiligungen ?? [];
  const beteiligungId = beteiligungen.find((eintrag) => eintrag.id === werte.beteiligungId)?.id ?? beteiligungen[0]?.id;
  const fehler = (name: string) => feldText(t, anlegen.error, name);

  function absenden() {
    if (mitBeteiligung && !beteiligungId) return;
    const stand = alsStand(werte.stand);
    // Der Wissensstand ist ein Zeitpunkt, der schon da war: ein Wert in der Zukunft geht gar nicht erst an die API.
    if (stand && new Date(stand).getTime() > Date.now()) {
      setStandFehler(feldCodeText(t, "stand_in_zukunft"));
      return;
    }
    setStandFehler(undefined);
    // Die Währungssicht gilt nur für Berichte mit Zeilen je Beteiligung; Vergleich braucht einen gültigen Währungscode.
    const mitSicht = SICHT_ARTEN.includes(art) && sicht.sicht !== "fonds";
    if (mitSicht && sicht.sicht === "vergleich" && !istWaehrungscode(sicht.vergleich)) {
      setSichtFehler(feldpruefungTexte[uiSprache].waehrung);
      return;
    }
    setSichtFehler(undefined);
    anlegen.mutate(
      {
        art,
        format: format as "pdf" | "xlsx",
        sprache,
        ...(mitBeteiligung && beteiligungId ? { beteiligungId } : { fondsId }),
        ...(werte.stichtag && art !== "gremienvorlage" ? { stichtag: werte.stichtag } : {}),
        ...(stand ? { stand } : {}),
        ...(mitSicht ? sichtAnfrage(sicht) : {}),
      },
      { onSuccess: (neu) => void navigate({ to: "/berichte/$id", params: { id: neu.id } }) },
    );
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
          absenden();
        }}
      >
        <FehlerHinweis fehler={anlegen.error} bekannt={FELDER} />
        <Auswahl label={f.art} {...feld("art")} fehler={fehler("art")}>
          {anlegbareArten().map((a) => (
            <option key={a} value={a}>
              {aufzaehlung(t.bericht.art, a)}
            </option>
          ))}
        </Auswahl>
        {mitBeteiligung ? (
          auswahl.isPending ? <Skelettzeilen anzahl={1} /> : auswahl.isError ? (
            <div>
              <FehlerHinweis fehler={auswahl.error} />
              <Button variante="sekundaer" onClick={() => void auswahl.refetch()}>{t.gemeinsam.erneutVersuchen}</Button>
            </div>
          ) : beteiligungen.length > 0 ? (
            <Auswahl label={f.beteiligung} {...feld("beteiligungId")} value={beteiligungId ?? ""} fehler={fehler("beteiligungId")}>
              {beteiligungen.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.organisation.name}
                </option>
              ))}
            </Auswahl>
          ) : (
            <p className="app-leer-text">{f.keineBeteiligung}</p>
          )
        ) : null}
        {formate.length > 1 ? (
          <Auswahl label={f.format} {...feld("format")} value={format} fehler={fehler("format")}>
            {formate.map((x) => (
              <option key={x} value={x}>
                {x === "pdf" ? "PDF" : "Excel"}
              </option>
            ))}
          </Auswahl>
        ) : null}
        <Feld label={f.stichtag} type="date" hilfe={art === "pai_erklaerung" ? f.stichtagHilfePai : f.stichtagHilfe} disabled={art === "gremienvorlage"} {...feld("stichtag")} fehler={fehler("stichtag")} />
        <div className="app-gruppe">
          <span className="cw-feld__label" id="bericht-sprache">
            {f.sprache}
          </span>
          <Segment<"de" | "en">
            aria-labelledby="bericht-sprache"
            value={sprache}
            onChange={setSprache}
            options={[
              { wert: "de", label: aufzaehlung(t.bericht.sprachen, "de") },
              { wert: "en", label: aufzaehlung(t.bericht.sprachen, "en") },
            ]}
          />
        </div>
        {SICHT_ARTEN.includes(art) ? (
          <WaehrungssichtWahl
            id="bericht"
            wert={sicht}
            onChange={setSicht}
            texte={{ beschriftung: f.waehrung, fonds: t.berichte.sicht.fonds, lokal: t.berichte.sicht.lokal, vergleich: t.berichte.sicht.vergleich, vergleichswaehrung: f.vergleichswaehrung, hilfe: f.waehrungHilfe }}
            fehler={sichtFehler && !istWaehrungscode(sicht.vergleich) ? sichtFehler : fehler("vergleichswaehrung")}
          />
        ) : null}
        <Feld label={f.stand} type="datetime-local" max={alsDatetimeLocal(new Date().toISOString())} hilfe={f.standHilfe} {...feld("stand")} fehler={standFehler ?? fehler("stand")} />
        <div>
          <Button type="submit" disabled={anlegen.isPending || (mitBeteiligung && (!beteiligungId || auswahl.isError))}>
            {f.anlegen}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
