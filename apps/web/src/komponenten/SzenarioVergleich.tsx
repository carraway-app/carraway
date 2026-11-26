import { useQuery } from "@tanstack/react-query";
import { Tabelle, formatBetrag, formatDatum, formatMultiple, formatProzent, type TabelleSpalte } from "@carraway/ui";
import { szenarienVergleich, vergleichBerichtUrl, type SzenarienVergleich } from "../api/szenarien";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { FehlerHinweis } from "./FehlerHinweis";
import { Jkurve } from "./Jkurve";

type Kennzahlzeile = SzenarienVergleich["vergleich"]["kennzahlen"][number];
type Szenario = SzenarienVergleich["szenarien"][number];

const ART: Record<string, "betrag" | "multiple" | "prozent" | "jahr"> = {
  abgerufenEnde: "betrag",
  ausschuettungenEnde: "betrag",
  navNettoEnde: "betrag",
  dpiEnde: "multiple",
  tvpiEnde: "multiple",
  irrNettoEnde: "prozent",
  tvpiBruttoEnde: "multiple",
  irrBruttoEnde: "prozent",
  gebuehrenSumme: "betrag",
  carrySumme: "betrag",
  ausschuettungenBruttoSumme: "betrag",
  tvpiTiefpunkt: "multiple",
  tvpiTiefpunktJahr: "jahr",
};

/**
 * Vergleich von bis zu drei Szenarien: Kennzahlentabelle und J-Kurve, Erlöse je Beteiligung, Befunde und Berichtslinks. Alle Zahlen
 * kommen fertig von der API (`vergleich`), die Oberfläche formatiert sie nur.
 */
export function SzenarioVergleich({ fondsId, ids }: { fondsId: string; ids: string[] }) {
  const t = useT();
  const v = t.szenarien.vergleich;
  const sprache = useSprache();
  const { data, error, isPending } = useQuery(szenarienVergleich(fondsId, ids));
  if (ids.length === 0) return null;
  if (isPending) return null;
  if (error || !data) return <FehlerHinweis fehler={error} />;
  const namen = data.szenarien.map((s) => s.name);
  const waehrungText = (w: string) => formatBetrag(w, sprache);
  const zeige = (z: Kennzahlzeile, wert: string | null) => {
    if (wert === null) return t.gemeinsam.keinWert;
    const art = ART[z.schluessel] ?? "betrag";
    return art === "betrag" ? waehrungText(wert) : art === "multiple" ? formatMultiple(wert, sprache) : art === "prozent" ? formatProzent(Number(wert) * 100, sprache) : wert;
  };
  const spalten: TabelleSpalte<Kennzahlzeile>[] = [
    { schluessel: "kennzahl", kopf: v.kennzahl, zelle: (z) => aufzaehlung(v.kennzahlen, z.schluessel) },
    ...namen.map((name, i) => ({ schluessel: `s${i}`, kopf: name, zahl: true, zelle: (z: Kennzahlzeile) => zeige(z, z.werte[i] ?? null) })),
  ];
  const sz = (s: Szenario) => s.ergebnis;

  return (
    <section className="app-karte" aria-labelledby="vergleich-titel">
      <div className="app-karte__kopf">
        <h2 id="vergleich-titel" className="cw-t-untertitel app-karte__titel">
          {v.titel}
        </h2>
        <div className="app-aktionen__knoepfe">
          {(["pdf", "xlsx"] as const).map((format) => (
            <a key={format} className="cw-button cw-button--sekundaer" href={vergleichBerichtUrl(fondsId, ids, format, sprache)} download aria-label={v.exportFuer(v.export[format])}>
              {v.export[format]}
            </a>
          ))}
        </div>
      </div>
      <div className="app-szenario-tabelle">
        <Tabelle beschriftung={`${v.titel} · ${v.kennzahl}`} spalten={spalten} zeilen={data.vergleich.kennzahlen} zeilenSchluessel={(z) => z.schluessel} />
      </div>
      <p className="app-leer-text">{v.nettoHinweis}</p>
      <ul className="app-liste-klein">
        {data.szenarien.map((s) => (
          <li key={s.id}>
            {s.name}: {aufzaehlung(t.szenarien.status, s.status)}, {t.szenarien.editor.basisStichtag} {formatDatum(s.basisStichtag, sprache)}
          </li>
        ))}
      </ul>

      <Jkurve namen={namen} zeilen={data.vergleich.jkurve} />

      {data.szenarien.map((s) => (
        <div key={s.id}>
          <h3 className="app-gruppen-titel">
            {s.name} · {v.beteiligungenTitel}
          </h3>
          {sz(s).beteiligungen.length === 0 ? null : (
            <Tabelle
              beschriftung={`${s.name}: ${v.beteiligungenTitel}`}
              spalten={[
                { schluessel: "unternehmen", kopf: v.spaltenBeteiligung.unternehmen, zelle: (b: Szenario["ergebnis"]["beteiligungen"][number]) => b.name },
                { schluessel: "ausstieg", kopf: v.spaltenBeteiligung.ausstieg, zelle: (b) => (b.ausstiegsJahr === null ? t.gemeinsam.keinWert : String(b.ausstiegsJahr)) },
                { schluessel: "erloes", kopf: v.spaltenBeteiligung.erloes, zahl: true, zelle: (b) => waehrungText(b.erloesBeiAusstieg) },
                { schluessel: "p", kopf: v.spaltenBeteiligung.wahrscheinlichkeit, zahl: true, zelle: (b) => formatProzent(Number(b.wahrscheinlichkeit) * 100, sprache) },
                { schluessel: "erwartet", kopf: v.spaltenBeteiligung.erwartet, zahl: true, zelle: (b) => waehrungText(b.erwarteterErloes) },
                { schluessel: "quelle", kopf: v.spaltenBeteiligung.quelle, zelle: (b) => aufzaehlung(v.quellen, b.erloesQuelle) },
              ]}
              zeilen={sz(s).beteiligungen}
              zeilenSchluessel={(b) => b.id}
            />
          )}
        </div>
      ))}

      <h3 className="app-gruppen-titel">{v.befunde.titel}</h3>
      {data.szenarien.every((s) => sz(s).befunde.length === 0) ? (
        <p className="app-leer-text">{v.befunde.keine}</p>
      ) : (
        data.szenarien.map((s) => {
          const namenJeId = new Map(sz(s).beteiligungen.map((b) => [b.id, b.name]));
          return (
            <ul key={s.id} className="app-liste-klein" aria-label={`${v.befunde.titel}: ${s.name}`}>
              {sz(s).befunde.map((b, i) => {
                const text = v.befunde.codes[b.code];
                const params = { ...(b.params ?? {}), ...(typeof b.params?.betrag === "string" ? { betrag: waehrungText(b.params.betrag) } : {}) };
                return (
                  <li key={`${b.code}-${b.beteiligungId ?? i}-${i}`}>
                    {s.name}: {text ? text(b.beteiligungId ? (namenJeId.get(b.beteiligungId) ?? "") : "", params) : b.code}
                  </li>
                );
              })}
            </ul>
          );
        })
      )}
    </section>
  );
}
