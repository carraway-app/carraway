import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Feld } from "@carraway/ui";
import { suche } from "../api/abfragen";
import { useT } from "../i18n";
import { useEntprellt } from "./formular";

export interface Treffer {
  id: string;
  label: string;
}

/** Sucht Organisationen oder Personen über die globale Suche der API und lässt eine auswählen. */
export function KontaktAuswahl({
  art,
  label,
  ausser,
  gewaehlt,
  onWaehlen,
  fehler,
}: {
  art: "organisation" | "person";
  label: string;
  ausser?: string | undefined;
  gewaehlt: Treffer | null;
  onWaehlen: (treffer: Treffer) => void;
  fehler?: string | undefined;
}) {
  const t = useT();
  const [eingabe, setEingabe] = useState("");
  const q = useEntprellt(eingabe.trim(), 250);
  const abfrage = useQuery({ ...suche(q), enabled: q.length >= 2 });
  const treffer: (Treffer & { info: string })[] =
    q.length < 2
      ? []
      : art === "organisation"
        ? (abfrage.data?.organisationen ?? []).map((o) => ({ id: o.id, label: o.name, info: [t.organisationArt[o.art], o.ort].filter(Boolean).join(" · ") }))
        : (abfrage.data?.personen ?? []).map((p) => ({ id: p.id, label: `${p.vorname} ${p.nachname}`, info: p.organisation?.name ?? t.suche.ohneOrganisation }));
  const sichtbar = treffer.filter((x) => x.id !== ausser);
  return (
    <div className="app-gruppe">
      <Feld
        type="search"
        label={label}
        value={eingabe}
        onChange={(e) => setEingabe(e.target.value)}
        hilfe={gewaehlt ? t.auswahl.gewaehlt(gewaehlt.label) : t.auswahl.hinweis}
        fehler={fehler}
      />
      <ul className="app-auswahlliste" aria-label={t.auswahl.treffer}>
        {sichtbar.map((x) => (
          <li key={x.id}>
            <button type="button" className="app-auswahlliste__knopf" aria-pressed={gewaehlt?.id === x.id} onClick={() => onWaehlen({ id: x.id, label: x.label })}>
              {x.label}
              <span className="app-dubletten__info">{x.info}</span>
            </button>
          </li>
        ))}
      </ul>
      {q.length >= 2 && !abfrage.isFetching && sichtbar.length === 0 ? <p className="app-leer-text">{t.auswahl.keine}</p> : null}
    </div>
  );
}
