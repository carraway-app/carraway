import "../../crm.css";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Feld, Markdown } from "@carraway/ui";
import { suche } from "../../api/abfragen";
import type { Objekt } from "../../api/crm";
import { Datensatzlink } from "./Datensatzlink";
import { useT } from "../../i18n";
import { useEntprellt } from "../formular";

/** Erwähnung in einer Notiz: `@[Anzeigename](typ:id)`, dieselbe Schreibweise wie in `apps/api/src/crm/verknuepfungen.ts`; im Markdown ein Link mit dieser Adresse. */
const ERWAEHNUNG = /^(organisation|person|deal):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/**
 * Text einer Notiz als Markdown (sicher gerendert, nie als HTML), erwähnte Datensätze als Links auf Seiten der Anwendung.
 */
export function NotizText({ text, className }: { text: string; className?: string }) {
  return (
    <Markdown
      text={text}
      className={className ?? "app-zeitstrahl__notiz"}
      renderLink={(href, kinder) => {
        const m = ERWAEHNUNG.exec(href);
        if (!m) return undefined;
        return (
          <Datensatzlink objekt={m[1] as Objekt} id={m[2]!} className="app-erwaehnung">
            {kinder}
          </Datensatzlink>
        );
      }}
    />
  );
}

/** Entfernt Zeichen, die die Schreibweise der Erwähnung stören würden. */
const saeubere = (name: string) => name.replace(/[[\]()\n\r]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);

export const erwaehnung = (typ: Objekt, id: string, name: string) => `@[${saeubere(name)}](${typ}:${id})`;

/** Sucht Unternehmen, Kontakte und Deals und fügt die Erwähnung des gewählten in den Text ein (über `onWaehlen`). */
export function ErwaehnenAuswahl({ onWaehlen }: { onWaehlen: (text: string) => void }) {
  const t = useT();
  const [offen, setOffen] = useState(false);
  const [eingabe, setEingabe] = useState("");
  const q = useEntprellt(eingabe.trim(), 250);
  const abfrage = useQuery({ ...suche(q), enabled: offen && q.length >= 2 });
  const treffer: { typ: Objekt; id: string; name: string; info: string }[] = [
    ...(abfrage.data?.organisationen ?? []).map((o) => ({ typ: "organisation" as const, id: o.id, name: o.name, info: t.crm.objekte.organisation })),
    ...(abfrage.data?.personen ?? []).map((p) => ({ typ: "person" as const, id: p.id, name: `${p.vorname} ${p.nachname}`, info: t.crm.objekte.person })),
    ...(abfrage.data?.deals ?? []).map((d) => ({ typ: "deal" as const, id: d.id, name: d.titel, info: t.crm.objekte.deal })),
  ];
  if (!offen)
    return (
      <Button variante="sekundaer" onClick={() => setOffen(true)}>
        {t.crm.erwaehnen}
      </Button>
    );
  return (
    <div className="app-gruppe">
      <Feld type="search" label={t.crm.erwaehnenSuche} autoComplete="off" value={eingabe} hilfe={t.crm.erwaehnenHinweis} onChange={(e) => setEingabe(e.target.value)} />
      <ul className="app-auswahlliste" aria-label={t.auswahl.treffer}>
        {treffer.map((x) => (
          <li key={`${x.typ}:${x.id}`}>
            <button
              type="button"
              className="app-auswahlliste__knopf"
              onClick={() => {
                onWaehlen(erwaehnung(x.typ, x.id, x.name));
                setOffen(false);
                setEingabe("");
              }}
            >
              {x.name}
              <span className="app-dubletten__info">{x.info}</span>
            </button>
          </li>
        ))}
      </ul>
      <Button variante="ruhig" onClick={() => setOffen(false)}>
        {t.crm.abbrechen}
      </Button>
    </div>
  );
}
