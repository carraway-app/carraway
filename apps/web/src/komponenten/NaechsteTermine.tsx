import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Etikett } from "@carraway/ui";
import { naechsteTermine, type TermineFilter } from "../api/mail";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { formatZeitpunkt } from "../lib/zeit";
import { QuelleZeichen } from "./QuelleZeichen";

/**
 * Nächste Termine aus den angebundenen Kalendern (synchronisierte Termine mit bekannten Kontakten), aufsteigend. Fehlt die Berechtigung oder gibt die API
 * einen Fehler, bleibt die Kachel leer, statt die Seite zu stören. Mit `eigene` nur Termine aus dem eigenen Kalender (Übersicht).
 */
export function NaechsteTermine({ filter, mitBezug = false }: { filter: TermineFilter; mitBezug?: boolean }) {
  const t = useT();
  const sprache = useSprache();
  const abfrage = useQuery(naechsteTermine(filter));
  if (abfrage.isError) return null;
  const termine = abfrage.data ?? [];
  return (
    <section className="app-karte app-termine" aria-labelledby="termine-titel">
      <h2 id="termine-titel" className="cw-t-untertitel app-karte__titel">
        {t.mail.termine.titel}
        {abfrage.data ? <span className="app-board__anzahl"> {termine.length}</span> : null}
      </h2>
      {abfrage.isPending ? (
        <div className="app-skelett app-skelett--zeile" aria-hidden="true" />
      ) : termine.length === 0 ? (
        <p className="app-leer-text">{t.mail.termine.keine}</p>
      ) : (
        <ul className="app-termine__liste" aria-label={t.mail.termine.tabelle}>
          {termine.map((x) => (
            <li key={x.id} className="app-termine__eintrag">
              <QuelleZeichen art="termin" />
              <time className="app-zahl" dateTime={x.beginn}>
                {formatZeitpunkt(x.beginn, sprache)}
              </time>
              <span className="app-termine__text">
                <strong>{x.titel}</strong>
                {mitBezug ? (
                  <>
                    {" "}
                    {x.deal ? (
                      <Link to="/deals/$id" params={{ id: x.deal.id }}>
                        {x.deal.titel}
                      </Link>
                    ) : x.organisation ? (
                      <Link to="/organisationen/$id" params={{ id: x.organisation.id }}>
                        {x.organisation.name}
                      </Link>
                    ) : null}
                  </>
                ) : null}
              </span>
              <Etikett>{aufzaehlung(t.mail.einstellungen.postfach.anbieter, x.anbieter)}</Etikett>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
