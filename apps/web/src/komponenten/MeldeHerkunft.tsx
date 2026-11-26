import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Herkunft, Tabelle, formatBetrag, formatDatum, type TabelleSpalte } from "@carraway/ui";
import { meldeHerkunft } from "../api/meldewesen";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { formatSchrittWert, uebersetzeSchritt } from "../i18n/schritte";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "./FehlerHinweis";

/**
 * Herkunft eines Wertes einer Meldung im Seitenpanel: die Rechenschritte (wie bei den Kennzahlen des Fonds), die angewendeten Filter und die
 * Datensätze dahinter (Beteiligungen, Vorgänge, Kennzahlenwerte, Fondsbewegungen).
 */
export function MeldeHerkunftDialog({ laufId, schluessel, titel, onSchliessen }: { laufId: string; schluessel: string; titel: string; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const h = t.melde.lauf.herkunft;
  const { data, error } = useQuery(meldeHerkunft(laufId, schluessel));
  const filterText = (f: Record<string, string[]>) =>
    Object.entries(f)
      .map(([k, v]) => `${k}: ${v.join(", ")}`)
      .join("; ");

  return (
    <Seitenpanel titel={h.titel(titel)} onSchliessen={onSchliessen} breit>
      {error ? <FehlerHinweis fehler={error} /> : null}
      {data ? (
        <>
          <Herkunft
            titel={titel}
            schritte={data.schritte.map((s) => ({ ...s, zeichen: s.zeichen as "" | "+" | "−" | "×" | "÷" | "=", bezeichnung: uebersetzeSchritt(s.bezeichnung, sprache), wert: formatSchrittWert(s.wert, sprache) }))}
          />
          <section aria-label={h.filter}>
            <h3 className="cw-t-label">{h.filter}</h3>
            {data.filter.length === 0 ? <p className="app-leer-text">{h.keinFilter}</p> : <ul>{data.filter.map((f, i) => <li key={i}>{filterText(f)}</li>)}</ul>}
          </section>
          {data.operanden.length > 0 ? (
            <section aria-label={h.operanden}>
              <h3 className="cw-t-label">{h.operanden}</h3>
              <ul>
                {data.operanden.map((o) => (
                  <li key={o.ref}>
                    <code>{o.ref}</code>: {o.wert === null ? t.melde.kein : formatSchrittWert(o.wert, sprache)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {data.beteiligungen.length > 0 ? (
            <Liste
              titel={h.beteiligungen}
              zeilen={data.beteiligungen}
              spalten={[
                {
                  schluessel: "name",
                  kopf: h.spalten.name,
                  zelle: (b) => (
                    <Link to="/beteiligungen/$id" params={{ id: b.id }} search={{}} aria-label={h.beteiligungLink(b.name)}>
                      {b.name}
                    </Link>
                  ),
                },
                { schluessel: "instrument", kopf: h.spalten.instrument, zelle: (b) => aufzaehlung(t.instrument, b.instrument) },
              ]}
              schluessel={(b) => b.id}
              gesamt={data.beteiligungen.length}
            />
          ) : null}
          {data.vorgaenge.length > 0 ? (
            <Liste
              titel={h.vorgaenge}
              zeilen={data.vorgaenge}
              spalten={[
                { schluessel: "datum", kopf: h.spalten.datum, zelle: (v) => formatDatum(v.valuta, sprache) },
                { schluessel: "art", kopf: h.spalten.art, zelle: (v) => aufzaehlung(t.vorgangForm.artNamen, v.art) },
                { schluessel: "betrag", kopf: h.spalten.betrag, zahl: true, zelle: (v) => formatBetrag(v.betrag, sprache) },
                { schluessel: "beteiligung", kopf: h.spalten.beteiligung, zelle: (v) => data.beteiligungen.find((b) => b.id === v.beteiligungId)?.name ?? "" },
              ]}
              schluessel={(v) => v.id}
              gesamt={data.vorgaengeGesamt}
            />
          ) : null}
          {data.kennzahlWerte.length > 0 ? (
            <Liste
              titel={h.kennzahlen}
              zeilen={data.kennzahlWerte}
              spalten={[
                { schluessel: "kennzahl", kopf: h.spalten.kennzahl, zelle: (k) => k.schluessel },
                { schluessel: "zeitraum", kopf: h.spalten.zeitraum, zelle: (k) => `${formatDatum(k.periodeBeginn, sprache)} – ${formatDatum(k.periodeEnde, sprache)}` },
                { schluessel: "szenario", kopf: h.spalten.szenario, zelle: (k) => aufzaehlung(t.kennzahlen.szenario, k.szenario) },
                { schluessel: "wert", kopf: h.spalten.wert, zahl: true, zelle: (k) => k.wert },
                { schluessel: "beteiligung", kopf: h.spalten.beteiligung, zelle: (k) => data.beteiligungen.find((b) => b.id === k.beteiligungId)?.name ?? "" },
              ]}
              schluessel={(k) => k.id}
              gesamt={data.kennzahlWerteGesamt}
            />
          ) : null}
          {data.bewegungen.length > 0 ? (
            <Liste
              titel={h.bewegungen}
              zeilen={data.bewegungen}
              spalten={[
                { schluessel: "datum", kopf: h.spalten.datum, zelle: (b) => formatDatum(b.valuta, sprache) },
                { schluessel: "art", kopf: h.spalten.art, zelle: (b) => aufzaehlung(t.bewegungen.art, b.art) },
                { schluessel: "betrag", kopf: h.spalten.betrag, zahl: true, zelle: (b) => formatBetrag(b.betrag, sprache) },
              ]}
              schluessel={(b) => b.id}
              gesamt={data.bewegungen.length}
            />
          ) : null}
        </>
      ) : null}
    </Seitenpanel>
  );
}

function Liste<T>({ titel, zeilen, spalten, schluessel, gesamt }: { titel: string; zeilen: T[]; spalten: TabelleSpalte<T>[]; schluessel: (z: T) => string; gesamt: number }) {
  const t = useT();
  return (
    <section aria-label={titel}>
      <h3 className="cw-t-label">{titel}</h3>
      <Tabelle beschriftung={titel} spalten={spalten} zeilen={zeilen} zeilenSchluessel={schluessel} />
      {gesamt > zeilen.length ? <p className="app-leer-text">{t.melde.lauf.herkunft.mehr(zeilen.length, gesamt)}</p> : null}
    </section>
  );
}
