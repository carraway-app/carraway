import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Auswahl, Button, Feld, Hinweis } from "@carraway/ui";
import { beteiligungSchluessel, useSchluesselSetzen, type BeteiligungSchluessel } from "../api/buchhaltung";
import { foerderprogramme } from "../api/meldewesen";
import { formatZeitpunkt } from "../lib/zeit";
import { feldText } from "../i18n/fehler";
import { useSprache, useT } from "../i18n";
import { useRechte } from "../lib/rechte";
import { FehlerHinweis } from "./FehlerHinweis";
import { useFormular, textOderNull } from "./formular";
import { Skelettzeilen } from "./Skelett";

/**
 * „Förderung und Buchhaltung“ an der Beteiligung: die einzige Stelle, an der Förderprogramm, Projekt-, Vertrags- und Partnernummer sowie Buchungskreis
 * stehen. Sitzland und Region des Unternehmens sind Stammdaten der Organisation: Hier erscheinen sie nur zur Ansicht
 * mit Verweis auf die Organisation. Belege, Buchungsexport und Meldeberichte lesen diese Schlüssel; es gilt der heutige Stand.
 * Ändern darf die Rolle Bearbeiter am Fonds (nicht in der Ansicht zu einem früheren Wissensstand).
 */
export function SchluesselAbschnitt({ beteiligungId, fondsId, lesend = false }: { beteiligungId: string; fondsId: string; lesend?: boolean }) {
  const t = useT();
  const s = t.foerderSchluessel;
  const { data, error, isPending } = useQuery(beteiligungSchluessel(beteiligungId));
  return (
    <section className="app-karte" aria-labelledby="abschnitt-schluessel">
      <h2 id="abschnitt-schluessel" className="cw-t-untertitel app-karte__titel">
        {s.titel}
      </h2>
      <p className="app-leer-text">{s.einleitung}</p>
      {error ? <FehlerHinweis fehler={error} /> : null}
      {isPending ? <Skelettzeilen anzahl={2} /> : null}
      {data ? <SchluesselFormular key={`${data.geaendertAm ?? "neu"}|${data.sitzland ?? ""}|${data.region ?? ""}`} daten={data} beteiligungId={beteiligungId} fondsId={fondsId} lesend={lesend} /> : null}
    </section>
  );
}

function SchluesselFormular({ daten, beteiligungId, fondsId, lesend }: { daten: BeteiligungSchluessel; beteiligungId: string; fondsId: string; lesend: boolean }) {
  const t = useT();
  const s = t.foerderSchluessel;
  const sprache = useSprache();
  const { darf } = useRechte();
  const aenderbar = darf("bearbeiter", fondsId, "finanzen") && !lesend;
  const programme = useQuery(foerderprogramme());
  const speichern = useSchluesselSetzen(beteiligungId);
  const { werte, feld } = useFormular({
    foerderprogramm: daten.foerderprogramm ?? "",
    projektnummer: daten.projektnummer ?? "",
    vertragsnummer: daten.vertragsnummer ?? "",
    partnernummer: daten.partnernummer ?? "",
    buchungskreis: daten.buchungskreis ?? "",
  });
  const [fertig, setFertig] = useState(false);
  const pending = speichern.isPending;
  const fehler = speichern.error;

  async function absenden() {
    setFertig(false);
    await speichern.mutateAsync({
      foerderprogramm: textOderNull(werte.foerderprogramm),
      projektnummer: textOderNull(werte.projektnummer),
      vertragsnummer: textOderNull(werte.vertragsnummer),
      partnernummer: textOderNull(werte.partnernummer),
      buchungskreis: textOderNull(werte.buchungskreis),
    });
    setFertig(true);
  }

  return (
    <form
      className="app-formular"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void absenden().catch(() => undefined);
      }}
    >
      {aenderbar ? null : <p className="app-leer-text">{s.lesen}</p>}
      <fieldset className="app-kz-auswahl cw-formularraster" disabled={!aenderbar || pending}>
        <legend className="cw-nur-lesen">{s.titel}</legend>
        <Auswahl breit label={s.felder.foerderprogramm} hilfe={s.programmeHinweis} {...feld("foerderprogramm")} fehler={feldText(t, speichern.error, "foerderprogramm")}>
          <option value="">{s.keinProgramm}</option>
          {(programme.data ?? []).map((p) => (
            <option key={p.id} value={p.schluessel}>
              {p.bezeichnung}
            </option>
          ))}
          {/* Ein Programm, das (noch) nicht in der Liste steht, bleibt wählbar, damit die Auswahl nichts verschluckt. */}
          {daten.foerderprogramm && !(programme.data ?? []).some((p) => p.schluessel === daten.foerderprogramm) ? <option value={daten.foerderprogramm}>{daten.foerderprogrammBezeichnung ?? daten.foerderprogramm}</option> : null}
        </Auswahl>
        <Feld label={s.felder.projektnummer} {...feld("projektnummer")} fehler={feldText(t, speichern.error, "projektnummer")} />
        <Feld label={s.felder.vertragsnummer} {...feld("vertragsnummer")} fehler={feldText(t, speichern.error, "vertragsnummer")} />
        <Feld label={s.felder.partnernummer} {...feld("partnernummer")} fehler={feldText(t, speichern.error, "partnernummer")} />
        <Feld label={s.felder.buchungskreis} {...feld("buchungskreis")} fehler={feldText(t, speichern.error, "buchungskreis")} />
      </fieldset>
      <p className="app-leer-text">
        {s.stammdaten.titel}: {s.stammdaten.land} {daten.sitzland ?? s.stammdaten.keine}, {s.stammdaten.region} {daten.region ?? s.stammdaten.keine}
        {" · "}
        <Link to="/organisationen/$id" params={{ id: daten.organisationId }}>
          {s.stammdaten.beiOrganisation}
        </Link>
      </p>
      {fehler ? <FehlerHinweis fehler={fehler} bekannt={["foerderprogramm", "projektnummer", "vertragsnummer", "partnernummer", "buchungskreis"]} /> : null}
      {daten.geaendertAm || aenderbar ? (
        <div className="app-formular__fuss">
          <span className="app-leer-text">{daten.geaendertAm ? s.geaendertVon(formatZeitpunkt(daten.geaendertAm, sprache)) : null}</span>
          {aenderbar ? (
            <Button type="submit" disabled={pending}>
              {s.speichern}
            </Button>
          ) : null}
        </div>
      ) : null}
      {fertig ? <Hinweis>{s.gespeichert}</Hinweis> : null}
    </form>
  );
}
