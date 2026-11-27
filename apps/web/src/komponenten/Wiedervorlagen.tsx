import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button, formatDatum } from "@carraway/ui";
import { wiedervorlagen, type Wiedervorlage } from "../api/abfragen";
import { useWiedervorlageErledigt } from "../api/mutationen";
import { useSprache, useT } from "../i18n";
import { useRechte } from "../lib/rechte";
import { FehlerHinweis } from "./FehlerHinweis";

function Bezug({ eintrag }: { eintrag: Wiedervorlage }) {
  if (eintrag.deal) {
    return (
      <Link to="/deals/$id" params={{ id: eintrag.deal.id }}>
        {eintrag.deal.titel}
      </Link>
    );
  }
  if (eintrag.organisation) {
    return (
      <Link to="/organizations/$id" params={{ id: eintrag.organisation.id }}>
        {eintrag.organisation.name}
      </Link>
    );
  }
  return eintrag.person ? <span>{`${eintrag.person.vorname} ${eintrag.person.nachname}`}</span> : null;
}

/** Fällige Wiedervorlagen (bis heute) mit „erledigt“. Die Kachel hat eine feste Mindesthöhe, damit beim Laden nichts springt. */
export function Wiedervorlagen() {
  const t = useT();
  const sprache = useSprache();
  const abfrage = useQuery(wiedervorlagen());
  const erledigt = useWiedervorlageErledigt();
  const { darf } = useRechte();
  const eintraege = abfrage.data ?? [];

  return (
    <section className="app-karte app-wiedervorlagen">
      <h2 id="wiedervorlagen-titel" className="cw-t-untertitel app-karte__titel">
        {t.wiedervorlagen.titel}
        {abfrage.data ? <span className="app-board__anzahl"> {eintraege.length}</span> : null}
      </h2>
      <FehlerHinweis fehler={abfrage.error ?? erledigt.error} />
      {abfrage.isPending ? (
        <div className="app-skelett app-skelett--zeile" aria-hidden="true" />
      ) : eintraege.length === 0 ? (
        <p className="app-leer-text">{t.wiedervorlagen.keine}</p>
      ) : (
        <ul className="app-wiedervorlagen__liste">
          {eintraege.map((e) => (
            <li key={e.id} className="app-wiedervorlagen__eintrag">
              <time className="app-zahl" dateTime={e.wiedervorlage ?? undefined}>
                {e.wiedervorlage ? formatDatum(e.wiedervorlage, sprache) : t.gemeinsam.keinWert}
              </time>
              <span className="app-wiedervorlagen__text">
                <strong>{e.titel}</strong> <Bezug eintrag={e} />
              </span>
              {darf("bearbeiter") ? (
                <Button variante="sekundaer" aria-label={t.wiedervorlagen.erledigtMelden(e.titel)} disabled={erledigt.isPending} onClick={() => erledigt.mutate(e.id)}>
                  {t.wiedervorlagen.erledigt}
                </Button>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
