import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { alle } from "../erweiterung";
import { useRechte } from "../lib/rechte";
import { Hinweis, Seitenkopf, formatDatum } from "@carraway/ui";
import { dokumentDateiUrl, dokumentDetail } from "../api/dokumente";
import { Skelettzeilen } from "../komponenten/Skelett";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { Quellenstand } from "../komponenten/Quellenstand";
import { groesseText } from "../komponenten/DokumenteAbschnitt";
import { aufzaehlung, useSprache, useT } from "../i18n";

/** PDF.js ist ein eigener Block und wird nur auf dieser Seite geladen. */
const PdfBetrachter = lazy(() => import("../komponenten/PdfBetrachter"));

const route = getRouteApi("/dokumente/$id");

/**
 * Betrachter eines Dokuments: das Dokument im Rahmen des Browsers (PDF und Bilder, mit Sandbox ohne Rechte und strenger Schutzkopfzeile der API,
 * ohne Dienste von außen), geöffnet an der Seite aus der Fundstelle (`#page=`). Office-Dateien gibt es nur als Download.
 */
export function DokumentSeite() {
  const t = useT();
  const d = t.dokumente;
  const { darf } = useRechte();
  const sprache = useSprache();
  const { id } = route.useParams();
  const { seite, stichtag, stand } = route.useSearch();
  const { data, error, isPending } = useQuery(dokumentDetail(id, stand));
  if (isPending) return <Skelettzeilen anzahl={4} />;
  if (error || !data) return <FehlerHinweis fehler={error ?? new Error("weg")} />;
  const anzeigbar = data.mime === "application/pdf" || data.mime.startsWith("image/");
  const rahmen = dokumentDateiUrl(id, { inline: true });
  const istPdf = data.mime === "application/pdf";
  return (
    <div className="app-seite">
      <Seitenkopf meta={d.ansicht.etikett} titel={data.dateiname} />
      <Quellenstand stichtag={stichtag} stand={stand} />
      <section className="app-karte" aria-label={d.ansicht.metadaten}>
        <dl className="app-fakten">
          <div>
            <dt>{d.spalten.klassifikation}</dt>
            <dd>
              {aufzaehlung(d.klassifikation, data.klassifikation)}
              {data.vertraulich ? ` · ${d.vertraulich}` : ""}
            </dd>
          </div>
          <div>
            <dt>{d.spalten.groesse}</dt>
            <dd>{groesseText(data.groesse, sprache)}</dd>
          </div>
          <div>
            <dt>{d.spalten.verknuepfungen}</dt>
            <dd>{data.verknuepfungen.map((v) => `${aufzaehlung(d.zielTyp, v.typ)}: ${v.name ?? t.gemeinsam.keinWert}`).join(", ")}</dd>
          </div>
        </dl>
        <p className="app-leer-text">{d.ansicht.hochgeladenVon(data.hochgeladenVonName ?? data.hochgeladenVon, formatDatum(data.hochgeladenAm.slice(0, 10), sprache))}</p>
        {data.ersetztDurch ? (
          <Hinweis>
            {d.ansicht.ersetztDurch}{" "}
            <Link to="/dokumente/$id" params={{ id: data.ersetztDurch }} search={{ stand, stichtag }}>
              {d.ansicht.neuereVersion}
            </Link>
          </Hinweis>
        ) : null}
        {seite ? <p className="app-leer-text">{d.ansicht.anSeite(seite)}</p> : null}
        <p>
          <a href={dokumentDateiUrl(id)} download>
            {d.herunterladen}
          </a>
        </p>
        {!stand && !stichtag && data.status === "aktiv" && alle("dokumentAktion").map((Aktion, i) => <Aktion key={i} dokument={data} darfSchreiben={darf("bearbeiter", null, "dokumente")} />)}
      </section>
      {anzeigbar ? (
        <section className="app-karte">
          {istPdf ? (
            <Suspense fallback={<Skelettzeilen anzahl={4} />}>
              <PdfBetrachter url={rahmen} seite={seite} titel={d.ansicht.rahmen(data.dateiname)} />
            </Suspense>
          ) : (
            <iframe key={rahmen} title={d.ansicht.rahmen(data.dateiname)} src={rahmen} sandbox="" className="app-betrachter" />
          )}
          <p className="app-leer-text">{istPdf ? d.ansicht.betrachterHinweis : d.ansicht.rahmenHinweis}</p>
        </section>
      ) : null}
      <section className="app-karte" aria-labelledby="dok-fundstellen">
        <h2 id="dok-fundstellen" className="cw-t-untertitel app-karte__titel">
          {d.ansicht.fundstellen}
        </h2>
        {data.fundstellen.length === 0 ? <p className="app-leer-text">{d.ansicht.keineFundstellen}</p> : null}
        <ul className="app-liste-klein">
          {data.fundstellen.map((f, i) => (
            <li key={i}>
              <Link to="/dokumente/$id" params={{ id }} search={{ stand, stichtag, seite: f.seite }}>
                {d.ansicht.fundstelle(f.feld, f.wert, f.seite)}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      {data.vorgaenger.length > 0 ? (
        <section className="app-karte">
          <h2 className="cw-t-untertitel app-karte__titel">{d.ansicht.frueher}</h2>
          <ul className="app-liste-klein">
            {data.vorgaenger.map((v) => (
              <li key={v.id}>
                <Link to="/dokumente/$id" params={{ id: v.id }} search={{ stand, stichtag }}>
                  {v.dateiname}
                </Link>{" "}
                · {formatDatum(v.hochgeladenAm.slice(0, 10), sprache)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
