import type { Key } from "react";
import { ArrowLeftIcon, ArrowRightIcon, ArrowsClockwiseIcon, Auswahl, DotsThreeIcon, FilterChips, HandshakeIcon, ListIcon, PercentIcon, Tabelle, type IconKomponente, type MenueEintrag, type TabelleSpalte } from "@carraway/ui";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { TX_FILTER, formatBetragMitCent, TX_GRUPPEN, gruppiere, imFilter, summen, zaehle, type TxFilter, type TxGruppe, type TxSummen, type TxZeile } from "../lib/transaktionen";

interface Props<T extends TxZeile> {
  zeilen: T[];
  spalten: TabelleSpalte<T>[];
  zeilenSchluessel: (zeile: T) => Key;
  ausgewaehlt: (zeile: T) => boolean;
  filter: TxFilter;
  gruppe: TxGruppe;
  onFilter: (filter: TxFilter) => void;
  onGruppe: (gruppe: TxGruppe) => void;
  /** Aktionen je Zeile im Menü „⋯“ (statt Knöpfen in eigenen Spalten, damit die Tabelle in die Breite passt). */
  aktionen?: (zeile: T) => MenueEintrag[];
  /** Summen nur in der Fondswährung: in einer anderen Sicht wären sie mit der Spalte nicht vergleichbar. */
  mitSummen: boolean;
}

/**
 * Transaktionen einer Beteiligung mit Filter nach Art (Reiter mit Anzahl), Gruppierung (Runde, Jahr, Instrument, Art) und Summen.
 * Eine Gruppe ist eine eigene kleine Tabelle mit Kopfzeile im selben Block; die Summe steht in der Kopfzeile der Gruppe, bei einem Filter auf Auszahlungen,
 * Rückflüsse oder Zusagen zusätzlich als Fußzeile (ohne Gruppierung) bzw. als Gesamtzeile (mit Gruppierung).
 */
const TX_ICON: Record<TxFilter, IconKomponente> = { alle: ListIcon, auszahlungen: ArrowRightIcon, rueckfluesse: ArrowLeftIcon, zinsen: PercentIcon, zusagen: HandshakeIcon, wandlung: ArrowsClockwiseIcon, sonstige: DotsThreeIcon };

export function TransaktionenAbschnitt<T extends TxZeile>({ zeilen, spalten, zeilenSchluessel, ausgewaehlt, filter, gruppe, onFilter, onGruppe, mitSummen, aktionen }: Props<T>) {
  const t = useT();
  const sprache = useSprache();
  const b = t.beteiligung.vorgaenge;
  const anzahl = zaehle(zeilen);
  const sichtbar = zeilen.filter((z) => imFilter(z, filter));
  const einzelart = filter === "auszahlungen" || filter === "rueckfluesse" || filter === "zusagen";
  const gruppen = gruppiere(sichtbar, gruppe, (art) => aufzaehlung(t.vorgangArt, art));
  const betragText = (w: string) => formatBetragMitCent(w, sprache);
  const summenText = (s: TxSummen) =>
    (["auszahlungen", "rueckfluesse", "zusagen"] as const)
      .filter((k) => s[k] !== undefined)
      .map((k) => (einzelart ? betragText(s[k]!) : `${b.filterTab[k]} ${betragText(s[k]!)}`))
      .join(" · ");
  const gesamt = einzelart && mitSummen ? summen(sichtbar, filter)[filter as keyof TxSummen] : undefined;
  const gruppenName = (name: string | null) => name ?? (gruppe === "runde" ? b.keineRunde : b.keinInstrument);

  return (
    <>
      <div className="app-tx-leiste">
        {/* Filter der Liste, keine Navigation: Filterchips in der Werkzeugzeile wie in Dealflow und Kontakte (Wahl in der Adresse, `art`). */}
        <FilterChips
          aria-label={b.filterArt}
          chips={TX_FILTER.filter((f) => f === "alle" || anzahl[f] > 0 || f === filter).map((f) => ({ id: f, icon: TX_ICON[f], label: b.filterTab[f], zaehler: anzahl[f] }))}
          wert={filter}
          onWechsel={(id) => onFilter(id as TxFilter)}
        />
        <Auswahl label={b.gruppeLabel} kompakt labelVersteckt value={gruppe} onChange={(e) => onGruppe(e.target.value as TxGruppe)}>
          {TX_GRUPPEN.map((g) => (
            <option key={g} value={g}>
              {b.gruppeOption[g]}
            </option>
          ))}
        </Auswahl>
      </div>
      {sichtbar.length === 0 ? (
        <p className="app-leer-text">{zeilen.length === 0 ? b.keine : b.keineInAnsicht}</p>
      ) : gruppe === "keine" ? (
        <Tabelle
          dicht
          className="app-tx-tabelle"
          beschriftung={b.titel}
          spalten={spalten}
          zeilen={sichtbar}
          zeilenSchluessel={zeilenSchluessel}
          ausgewaehlt={ausgewaehlt}
          aktionen={aktionen}
          fusszeile={gesamt === undefined ? undefined : { [spalten[0]!.schluessel]: `${b.summe} (${sichtbar.length})`, betrag: betragText(gesamt) }}
        />
      ) : (
        <>
          {gruppen.map((g) => {
            const name = gruppenName(g.name);
            return (
              <section key={g.schluessel} className="app-tx-gruppe" aria-label={b.gruppeKopf(name)}>
                <div className="app-tx-gruppe__kopf">
                  <h3 className="app-tx-gruppe__name">{name}</h3>
                  <span className="app-leer-text">{b.anzahl(g.zeilen.length)}</span>
                  {mitSummen && summenText(summen(g.zeilen, filter)) ? <span className="app-zahl app-tx-gruppe__summe">{summenText(summen(g.zeilen, filter))}</span> : null}
                </div>
                <Tabelle dicht className="app-tx-tabelle" beschriftung={`${b.titel}: ${name}`} spalten={spalten} zeilen={g.zeilen} zeilenSchluessel={zeilenSchluessel} ausgewaehlt={ausgewaehlt} aktionen={aktionen} />
              </section>
            );
          })}
          {gesamt !== undefined ? (
            <div className="app-tx-gruppe__kopf app-tx-gesamt">
              <span className="app-tx-gruppe__name">
                {b.summe} ({sichtbar.length})
              </span>
              <span className="app-zahl app-tx-gruppe__summe">{betragText(gesamt)}</span>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
