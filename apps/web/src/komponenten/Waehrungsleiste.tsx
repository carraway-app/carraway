import { useQuery } from "@tanstack/react-query";
import { Auswahl, Hinweis, Segment, formatDatum } from "@carraway/ui";
import { kursWaehrungen, type KursInfo, type SichtLuecke } from "../api/waehrung";
import { useSprache, useT } from "../i18n";
import type { Sicht, WaehrungSuche, Waehrungen } from "../lib/waehrung";

interface Props {
  sicht: Sicht;
  suche: WaehrungSuche;
  waehrungen: Waehrungen;
  /** Setzt `sicht` und `vergleich` in der Adresse. */
  onAendern: (neu: WaehrungSuche) => void;
  luecken: readonly SichtLuecke[];
  /** Kurse hinter dem Zeitwert der gewählten Sicht (Kurs und Datum werden immer genannt). */
  kurse: readonly KursInfo[];
  /** Mit Wissensstand: Hinweis, dass die damals erfassten Kurse gelten. */
  mitStand?: boolean;
  /** Erklärt, was in der Fondswährung bleibt (Multiple, IRR, TVPI, …). */
  hinweisFondsOnly?: boolean;
  /** Kurze Angabe der aktiven Tabellenwährung und Auswahl nur in der Vergleichssicht. */
  tabellenWaehrung?: string;
}

/**
 * Leiste „Lokal | Fonds | Vergleich“ mit Wahl der Vergleichswährung. Zeigt, welche Währungen im Spiel sind, nennt Kurs und Datum hinter den Zeitwerten und
 * listet fehlende Kurse (Lücken): Die Seite zeigt dann keine Zahl, sondern „Kurs fehlt“. Kein Wert wird geschätzt oder stillschweigend gemischt.
 */
export function Waehrungsleiste({ sicht, suche, waehrungen, onAendern, luecken, kurse, mitStand, hinweisFondsOnly = true, tabellenWaehrung }: Props) {
  const t = useT();
  const w = t.waehrung;
  const sprache = useSprache();
  const { data: verfuegbar } = useQuery(kursWaehrungen());
  const vergleichbar = (verfuegbar ?? []).map((x) => x.waehrung).filter((x) => x !== waehrungen.fonds || waehrungen.lokal !== waehrungen.fonds);
  const kandidaten = [...new Set([...vergleichbar, ...(suche.vergleich ? [suche.vergleich] : [])])].filter((x) => x !== waehrungen.fonds || suche.vergleich === x);
  const standard = kandidaten.find((x) => x !== waehrungen.fonds) ?? null;
  const waehle = (neu: Sicht) => {
    if (neu === "fonds") onAendern({ ...(suche.vergleich ? { vergleich: suche.vergleich } : {}) });
    else if (neu === "lokal") onAendern({ sicht: "lokal", ...(suche.vergleich ? { vergleich: suche.vergleich } : {}) });
    else if (neu === "haus") onAendern({ sicht: "haus", ...(suche.vergleich ? { vergleich: suche.vergleich } : {}) });
    else onAendern({ sicht: "vergleich", ...(suche.vergleich ?? standard ? { vergleich: (suche.vergleich ?? standard)! } : {}) });
  };
  return (
    <section className="app-waehrungsleiste" aria-label={w.sicht}>
      <div className="app-waehrungsleiste__zeile">
        <Segment
          aria-label={w.sicht}
          value={sicht}
          onChange={waehle}
          options={[
            { wert: "lokal", label: w.sichten.lokal },
            { wert: "fonds", label: w.sichten.fonds },
            { wert: "vergleich", label: w.sichten.vergleich },
            ...(waehrungen.haus ? [{ wert: "haus" as const, label: w.sichtHaus(waehrungen.haus) }] : []),
          ]}
        />
        {sicht === "vergleich" || (tabellenWaehrung === undefined && kandidaten.length > 0) ? (
          <Auswahl
            kompakt
            labelVersteckt
            label={w.vergleichswaehrung}
            value={suche.vergleich ?? ""}
            disabled={kandidaten.length === 0}
            onChange={(e) => onAendern({ ...(sicht === "lokal" || sicht === "haus" ? { sicht } : { sicht: "vergleich" as const }), ...(e.target.value ? { vergleich: e.target.value } : {}) })}
          >
            {suche.vergleich ? null : <option value="">{kandidaten.length === 0 ? w.keineVergleichswaehrung : w.vergleichswaehrung}</option>}
            {kandidaten.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Auswahl>
        ) : null}
        <span className="app-waehrungsleiste__info">{tabellenWaehrung ?? w.waehrungen(waehrungen.fonds, waehrungen.lokal)}</span>
      </div>
      {kurse.length > 0 && sicht !== "fonds" ? (
        <ul className="app-waehrungsleiste__kurse" aria-label={w.kursZeile(w.verwendung.zeitwert)}>
          {kurse.map((k, i) => (
            <li key={i} className="app-zahl">
              {w.kursVom(k.von, formatKurs(k.kurs, sprache), k.nach, formatDatum(k.kursDatum, sprache), formatDatum(k.tag, sprache))}
            </li>
          ))}
        </ul>
      ) : null}
      {luecken.length > 0 && sicht !== "fonds" ? (
        <Hinweis titel={w.lueckenTitel(luecken.length)}>
          <ul className="app-waehrungsleiste__luecken">
            {luecken.slice(0, 6).map((l, i) => (
              <li key={i}>{w.lueckenText(l.von, l.nach, formatDatum(l.tag, sprache), l.grund, l.letzterKursDatum ? formatDatum(l.letzterKursDatum, sprache) : null)}</li>
            ))}
          </ul>
        </Hinweis>
      ) : null}
      {sicht !== "fonds" && hinweisFondsOnly ? <p className="app-leer-text">{w.nurFondsWaehrung}</p> : null}
      {sicht !== "fonds" && mitStand ? <p className="app-leer-text">{w.wissensstandHinweis}</p> : null}
    </section>
  );
}

/** Kurs mit bis zu acht Nachkommastellen und mindestens vier, in der Zahlenschreibweise der Sprache. */
export function formatKurs(kurs: string, sprache: "de" | "en"): string {
  return new Intl.NumberFormat(sprache === "de" ? "de-DE" : "en-GB", { minimumFractionDigits: 4, maximumFractionDigits: 8 }).format(Number(kurs));
}
