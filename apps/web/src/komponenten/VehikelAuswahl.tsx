import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Feld } from "@carraway/ui";
import { suche, vehikelAuswahl } from "../api/abfragen";
import { useT } from "../i18n";
import { useEntprellt } from "./formular";
import type { Treffer } from "./KontaktAuswahl";

/** Auswahl: ein Vehikel oder eine Organisation ohne Vehikel (dann nimmt die API ihr Standard-Vehikel und legt es bei Bedarf an). */
export interface VehikelTreffer extends Treffer {
  art: "vehikel" | "organisation";
}

/** Anzeige eines Vehikels mit seinem Investor: „Vehikel · Investor“ (gleicher Name nur einmal). */
export const vehikelLabel = (vehikel: string, investor: string) => (vehikel === investor ? vehikel : `${vehikel} · ${investor}`);

/**
 * Sucht Vehikel von Co-Investoren (in Vehikel- und Investornamen) und lässt eines auswählen. Organisationen ohne Vehikel stehen darunter: Für sie
 * entsteht beim Speichern der Position das Standard-Vehikel. `ausser` blendet eine Organisation aus (das Unternehmen der Runde investiert nicht in sich selbst).
 */
export function VehikelAuswahl({ label, ausser, gewaehlt, onWaehlen, fehler }: { label: string; ausser?: string | undefined; gewaehlt: Treffer | null; onWaehlen: (treffer: VehikelTreffer) => void; fehler?: string | undefined }) {
  const t = useT();
  const v = t.finanzierungsrunden.vehikel;
  const [eingabe, setEingabe] = useState("");
  const q = useEntprellt(eingabe.trim(), 250);
  const abfrage = useQuery({ ...vehikelAuswahl(q), enabled: q.length >= 2 });
  const organisationen = useQuery({ ...suche(q), enabled: q.length >= 2 });
  const treffer = q.length < 2 ? [] : (abfrage.data ?? []).filter((x) => x.investor.id !== ausser);
  const mitVehikel = new Set((abfrage.data ?? []).map((x) => x.investor.id));
  const ohneVehikel = q.length < 2 || !abfrage.data ? [] : (organisationen.data?.organisationen ?? []).filter((o) => o.id !== ausser && !mitVehikel.has(o.id));
  return (
    <div className="app-gruppe">
      <Feld type="search" label={label} autoComplete="off" value={eingabe} onChange={(e) => setEingabe(e.target.value)} hilfe={gewaehlt ? t.auswahl.gewaehlt(gewaehlt.label) : t.auswahl.hinweis} fehler={fehler} />
      <ul className="app-auswahlliste" aria-label={t.auswahl.treffer}>
        {treffer.map((x) => {
          const anzeige = vehikelLabel(x.name, x.investor.name);
          return (
            <li key={x.id}>
              <button type="button" className="app-auswahlliste__knopf" aria-pressed={gewaehlt?.id === x.id} onClick={() => onWaehlen({ id: x.id, label: anzeige, art: "vehikel" })}>
                {anzeige}
                <span className="app-dubletten__info">{[v.arten[x.art] ?? x.art, x.auflagejahr, x.standard ? v.standard : null].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          );
        })}
        {ohneVehikel.map((o) => (
          <li key={o.id}>
            <button type="button" className="app-auswahlliste__knopf" aria-pressed={gewaehlt?.id === o.id} onClick={() => onWaehlen({ id: o.id, label: o.name, art: "organisation" })}>
              {o.name}
              <span className="app-dubletten__info">{[t.organisationArt[o.art], v.ohneVehikel].filter(Boolean).join(" · ")}</span>
            </button>
          </li>
        ))}
      </ul>
      {q.length >= 2 && !abfrage.isFetching && !organisationen.isFetching && treffer.length === 0 && ohneVehikel.length === 0 ? <p className="app-leer-text">{t.auswahl.keine}</p> : null}
    </div>
  );
}
