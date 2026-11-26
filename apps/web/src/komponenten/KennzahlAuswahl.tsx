import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Hinweis } from "@carraway/ui";
import { kennzahlAuswahl, kennzahlKatalog, useAuswahlSetzen } from "../api/kennzahlen";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { kennzahlName } from "../lib/kennzahlen";
import { FehlerHinweis } from "./FehlerHinweis";

/**
 * Auswahl der Kennzahlen, die ein Fonds von seinen Unternehmen anfordert (und im Quartalsbericht zeigt). Ändern dürfen Verwalter des Fonds;
 * alle anderen sehen die Auswahl nur. Die Kennzahlen kommen aus dem Katalog (Version, die heute gilt).
 */
export function KennzahlAuswahl({ fondsId, kannAendern }: { fondsId: string; kannAendern: boolean }) {
  const t = useT();
  const sprache = useSprache();
  const a = t.kennzahlen.auswahl;
  const { data: katalog } = useQuery(kennzahlKatalog());
  const { data: auswahl } = useQuery(kennzahlAuswahl(fondsId));
  const setzen = useAuswahlSetzen(fondsId);
  const [gewaehlt, setGewaehlt] = useState<string[] | null>(null);
  const [gespeichert, setGespeichert] = useState(false);
  const aktuell = auswahl?.map((z) => z.schluessel) ?? [];
  const liste = gewaehlt ?? aktuell;
  // Neue Daten vom Server (nach Speichern, Wechsel des Fonds) ersetzen die Eingabe.
  useEffect(() => {
    setGewaehlt(null);
  }, [fondsId, auswahl]);

  if (!katalog || !auswahl) return null;
  const veraltet = auswahl.filter((z) => !z.gueltig);

  function umschalten(schluessel: string) {
    setGespeichert(false);
    setGewaehlt(liste.includes(schluessel) ? liste.filter((s) => s !== schluessel) : [...liste, schluessel]);
  }

  return (
    <section className="app-karte" aria-labelledby="kz-auswahl-titel">
      <h2 id="kz-auswahl-titel" className="cw-t-untertitel app-karte__titel">
        {a.titel}
      </h2>
      <p className="app-leer-text">{a.einleitung}</p>
      {kannAendern ? null : <Hinweis>{a.keinRecht}</Hinweis>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // Reihenfolge wie im Katalog
          const reihenfolge = [...katalog.map((d) => d.schluessel), ...veraltet.map((z) => z.schluessel)];
          setzen.mutate(reihenfolge.filter((s) => liste.includes(s) && katalog.some((d) => d.schluessel === s)), { onSuccess: () => setGespeichert(true) });
        }}
      >
        <fieldset className="app-kz-auswahl" disabled={!kannAendern}>
          <legend>{a.gruppe}</legend>
          {katalog.map((d) => (
            <label key={d.schluessel}>
              <input type="checkbox" checked={liste.includes(d.schluessel)} onChange={() => umschalten(d.schluessel)} />
              <span>
                {kennzahlName(d, sprache)} <span className="app-kz-einheit">({aufzaehlung(t.kennzahlen.kategorie, d.kategorie)}{d.einheit && d.typ !== "ja_nein" && d.typ !== "text" ? `, ${d.einheit}` : ""})</span>
              </span>
            </label>
          ))}
          {veraltet.map((z) => (
            <p key={z.schluessel} className="app-leer-text">
              {kennzahlName(z.definition, sprache)}: {a.ausserKraft}
            </p>
          ))}
        </fieldset>
        {kannAendern ? (
          <Button type="submit" disabled={setzen.isPending}>
            {a.speichern}
          </Button>
        ) : null}
        {gespeichert ? <p role="status">{a.gespeichert}</p> : null}
        {setzen.error ? <FehlerHinweis fehler={setzen.error} /> : null}
      </form>
    </section>
  );
}
