import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Feld, Kennwerte, Segment } from "@carraway/ui";
import { ApiFehler } from "../api/client";
import { poolVorschlag, type Mitarbeiterpool, type PoolVorschlagEingabe } from "../api/abfragen";
import type { NeueRunde } from "../api/mutationen";
import { feldText } from "../i18n/fehler";
import { useSprache, useT } from "../i18n";
import { formatAnzahl, formatBetragCent, formatPreis, formatSatz, prozentZuAnteil } from "../lib/zahl";
import { betragOderNichts, useEntprellt } from "./formular";

/**
 * Option Pool Shuffle im Dialog „Neue Finanzierungsrunde“: Aufstockung des Pools der Mitarbeiterbeteiligung zur Runde (Pre- oder Post-Money)
 * mit Zielgröße. Vorschlag (Aufstockung, Preis je Anteil) und Kennwerte rechnet die API (`/finanzierungsrunden/pool-vorschlag`); der Dialog
 * rechnet nichts außer der Summe der eingegebenen Beträge. Der Vorschlag lässt sich übernehmen oder überschreiben; beim Anlegen geht die
 * Aufstockung als `poolAufstockung` mit der Runde an die API.
 */

export type PoolBasis = "pre_money" | "post_money";

export interface PoolShuffleWerte {
  aktiv: boolean;
  basis: PoolBasis;
  /** Zielgröße in Prozent der voll verwässerten Anteile nach der Runde (Eingabe). */
  ziel: string;
  /** Ausgegebene Anteile vor der Runde; leer = aus der letzten abgeschlossenen Runde. */
  anteileVorher: string;
  /** Volumen; leer = Summe der Investoren. */
  volumen: string;
  aufstockung: string;
  poolId: string;
  neuerPoolArt: "esop" | "vsop";
  neuerPoolName: string;
}

export const POOL_SHUFFLE_START: PoolShuffleWerte = { aktiv: false, basis: "pre_money", ziel: "", anteileVorher: "", volumen: "", aufstockung: "", poolId: "", neuerPoolArt: "esop", neuerPoolName: "ESOP" };

const GANZ = /^\d{1,18}$/;
const POSITIV = /^[1-9]\d{0,17}$/;
const BRUCH = /^0\.\d{1,6}$/;
const PREIS = /^\d{1,14}(\.\d{1,4})?$/;
const BETRAG = /^\d{1,16}(\.\d{1,2})?$/;

/** Summe von Beträgen der API (`1500000.5`) in Cent, ohne Rundung; ungültige Beträge ergeben nichts. */
export function summeBetraege(betraege: readonly string[]): string | undefined {
  let cent = 0n;
  for (const b of betraege) {
    if (!BETRAG.test(b)) return undefined;
    const [ganz = "0", rest = ""] = b.split(".");
    cent += BigInt(ganz) * 100n + BigInt(rest.padEnd(2, "0"));
  }
  const text = cent.toString().padStart(3, "0");
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
}

/** Ganze Zahl aus der Eingabe: Leerzeichen und Tausendertrenner (Punkt, Komma, Apostroph) weg; Nachkommastellen gibt es bei Anteilen nicht. */
const ganzzahl = (wert: string) => wert.replace(/[\s.,'’]/g, "");

/** Ist die Aufstockung erfasst, wenn das Häkchen gesetzt ist? Sonst blockiert der Dialog das Anlegen (statt sie still wegzulassen). */
export const aufstockungGueltig = (w: PoolShuffleWerte): boolean => !w.aktiv || POSITIV.test(ganzzahl(w.aufstockung));

/** Körperteil `poolAufstockung` für Vorschau und Anlegen; nur mit einer Aufstockung über null. */
export function poolAufstockungAus(w: PoolShuffleWerte, pools: readonly Pick<Mitarbeiterpool, "id">[] | undefined): NeueRunde["poolAufstockung"] {
  const anzahl = ganzzahl(w.aufstockung);
  if (!w.aktiv || !POSITIV.test(anzahl)) return undefined;
  const ohnePool = pools !== undefined && pools.length === 0;
  return {
    basis: w.basis,
    anzahl,
    ...(w.poolId ? { poolId: w.poolId } : {}),
    ...(ohnePool && w.neuerPoolName.trim() ? { neuerPool: { art: w.neuerPoolArt, bezeichnung: w.neuerPoolName.trim() } } : {}),
  };
}

interface Props {
  organisationId: string;
  werte: PoolShuffleWerte;
  onAendern: (neu: PoolShuffleWerte) => void;
  datum: string;
  /** Pre-Money in der Schreibweise der API. */
  preMoney: string | undefined;
  /** Beträge der Investoren (API). */
  betraege: readonly string[];
  /** Preis je Anteil aus dem Formular (API); überschreibt den Vorschlag in den Kennwerten. */
  preis: string | undefined;
  onPreisUebernehmen: (preis: string) => void;
  pools: Mitarbeiterpool[] | undefined;
  /** Nach einem Versuch anzulegen: fehlende oder ungültige Aufstockung am Feld melden. */
  fehlerAnzeigen: boolean;
  /** Fehler des Anlegens (Feldfehler `poolAufstockung.*`). */
  fehler: unknown;
}

export function PoolShuffle({ organisationId, werte: w, onAendern, datum, preMoney, betraege, preis, onPreisUebernehmen, pools, fehlerAnzeigen, fehler }: Props) {
  const t = useT();
  const sprache = useSprache();
  const f = t.finanzierungsrunden.poolShuffle;
  const setze = (teil: Partial<PoolShuffleWerte>) => onAendern({ ...w, ...teil });

  const zielAnteil = prozentZuAnteil(w.ziel);
  const volumen = betragOderNichts(w.volumen, sprache) ?? summeBetraege(betraege);
  const anteileVorher = ganzzahl(w.anteileVorher);
  const aufstockung = ganzzahl(w.aufstockung);
  const eingabe: PoolVorschlagEingabe = {
    datum,
    preMoney: preMoney ?? "",
    volumen: volumen ?? "",
    zielAnteil,
    basis: w.basis,
    ...(POSITIV.test(anteileVorher) ? { anteileVorher } : {}),
    ...(GANZ.test(aufstockung) ? { aufstockung } : {}),
    ...(preis && PREIS.test(preis) && Number(preis) > 0 ? { preisJeAnteil: preis } : {}),
  };
  const entprellt = JSON.parse(useEntprellt(JSON.stringify(eingabe), 400)) as PoolVorschlagEingabe;
  // Geprüft wird die entprellte Eingabe, die auch an die API geht.
  const brauchbar = w.aktiv && BETRAG.test(entprellt.preMoney) && BETRAG.test(entprellt.volumen) && BRUCH.test(entprellt.zielAnteil) && /^\d{4}-\d{2}-\d{2}$/.test(entprellt.datum);
  const vorschlag = useQuery(poolVorschlag(organisationId, entprellt, brauchbar));
  const v = brauchbar ? vorschlag.data : undefined;
  const ohneRecht = vorschlag.error instanceof ApiFehler && vorschlag.error.status === 403;

  const k = v?.kennwerte;
  const anzahl = (x: string) => formatAnzahl(x, sprache);

  return (
    <fieldset className="app-gruppe">
      <legend className="cw-feld__label">{f.titel}</legend>
      <label className="app-haken">
        <input type="checkbox" checked={w.aktiv} onChange={(e) => setze({ aktiv: e.target.checked })} /> {f.aktiv}
      </label>
      {w.aktiv ? (
        <>
          <p className="app-leer-text">{f.beschreibung}</p>
          <Segment<PoolBasis>
            aria-label={f.basis}
            value={w.basis}
            onChange={(basis) => setze({ basis })}
            options={[
              { wert: "pre_money", label: f.preMoney },
              { wert: "post_money", label: f.postMoney },
            ]}
          />
          <Feld label={f.ziel} zahl inputMode="decimal" autoComplete="off" value={w.ziel} onChange={(e) => setze({ ziel: e.target.value })} />
          <Feld
            label={f.anteileVorher}
            zahl
            inputMode="numeric"
            autoComplete="off"
            value={w.anteileVorher}
            onChange={(e) => setze({ anteileVorher: e.target.value })}
            hilfe={v?.anteileVorherQuelle === "runde" && v.anteileVorher ? f.anteileAusRunde(anzahl(v.anteileVorher)) : f.anteileHilfe}
          />
          <Feld label={f.volumen} zahl inputMode="decimal" autoComplete="off" value={w.volumen} onChange={(e) => setze({ volumen: e.target.value })} hilfe={summeBetraege(betraege) ? f.volumenHilfe(formatBetragCent(summeBetraege(betraege)!, sprache)) : undefined} />
          {pools && pools.length > 1 ? (
            <Auswahl label={f.pool} value={w.poolId} onChange={(e) => setze({ poolId: e.target.value })} fehler={feldText(t, fehler, "poolAufstockung.poolId")}>
              <option value="">{f.poolWaehlen}</option>
              {pools.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.bezeichnung}
                </option>
              ))}
            </Auswahl>
          ) : null}
          {pools && pools.length === 1 ? <p className="app-leer-text">{f.poolEiner(pools[0]!.bezeichnung)}</p> : null}
          {pools && pools.length === 0 ? (
            <>
              <p className="app-leer-text">{f.poolNeu}</p>
              <Segment<"esop" | "vsop">
                aria-label={f.poolArt}
                value={w.neuerPoolArt}
                onChange={(neuerPoolArt) => setze({ neuerPoolArt, neuerPoolName: w.neuerPoolName === "ESOP" || w.neuerPoolName === "VSOP" ? neuerPoolArt.toUpperCase() : w.neuerPoolName })}
                options={[
                  { wert: "esop", label: "ESOP" },
                  { wert: "vsop", label: "VSOP" },
                ]}
              />
              <Feld label={f.poolName} autoComplete="off" value={w.neuerPoolName} onChange={(e) => setze({ neuerPoolName: e.target.value })} fehler={feldText(t, fehler, "poolAufstockung.neuerPool")} />
            </>
          ) : null}
          <Feld
            label={f.aufstockung}
            zahl
            inputMode="numeric"
            autoComplete="off"
            value={w.aufstockung}
            onChange={(e) => setze({ aufstockung: e.target.value })}
            fehler={fehlerAnzeigen && !aufstockungGueltig(w) ? f.aufstockungFehlt : feldText(t, fehler, "poolAufstockung.anzahl")}
          />
          <div aria-live="polite" className="app-gruppe">
            {ohneRecht ? <p className="app-leer-text">{f.ohneRecht}</p> : null}
            {v?.vorschlag ? (
              <>
                <p className="app-leer-text">{f.vorschlag(anzahl(v.vorschlag.aufstockung), formatPreis(v.vorschlag.preisJeAnteil, sprache))}</p>
                <div>
                  <Button
                    variante="sekundaer"
                    onClick={() => {
                      setze({ aufstockung: v.vorschlag!.aufstockung });
                      onPreisUebernehmen(v.vorschlag!.preisJeAnteil);
                    }}
                  >
                    {f.uebernehmen}
                  </Button>
                </div>
              </>
            ) : null}
            {v?.grund ? <p className="app-leer-text">{f.gruende[v.grund] ?? f.gruende.ziel_ungueltig}</p> : null}
            {k ? (
              <Kennwerte
                kompakt
                gruppen={[
                  {
                    titel: f.kennwerte,
                    eintraege: [
                      { label: f.neueAnteile, wert: anzahl(k.neueAnteile) },
                      { label: f.poolVorher, wert: anzahl(k.poolVorher) },
                      { label: f.poolNachher, wert: anzahl(k.poolNachher), hinweis: f.poolAnteil(formatSatz(k.poolAnteilNachher, sprache)) },
                      { label: f.preis, wert: formatPreis(k.preisJeAnteil, sprache) },
                      { label: f.effektivePreMoney, wert: formatBetragCent(k.effektivePreMoney, sprache), primaer: true },
                    ],
                  },
                ]}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </fieldset>
  );
}
