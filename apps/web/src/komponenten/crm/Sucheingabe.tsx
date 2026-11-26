import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { suche } from "../../api/abfragen";
import { crmZustaendige, type Objekt } from "../../api/crm";
import { useT } from "../../i18n";
import { useEntprellt } from "../formular";

export interface SuchTreffer {
  id: string;
  label: string;
  info?: string | undefined;
}

interface Props {
  /** Beschriftung der Sucheingabe (für Screenreader und als Platzhalter). */
  label: string;
  treffer: SuchTreffer[];
  laedt?: boolean;
  /** Text unter der Liste, wenn es keine Treffer gibt (`undefined`: nichts anzeigen, etwa solange noch nicht gesucht wird). */
  leerText?: string | undefined;
  onSuche: (eingabe: string) => void;
  onWaehlen: (treffer: SuchTreffer) => void;
  /** Escape in der Eingabe. */
  onAbbrechen?: (() => void) | undefined;
  /** Zusätzliche Einträge unter den Treffern (zum Beispiel „Niemand“); werden wie Treffer per Tastatur gewählt. */
  extras?: { id: string; label: string; onWaehlen: () => void }[];
  autoFokus?: boolean;
  /** Aktuell gewählter Wert (nur Anzeige im Hilfetext). */
  gewaehlt?: ReactNode;
}

/**
 * Suchfeld mit Trefferliste als Combobox (ARIA 1.2): Pfeiltasten bewegen die Markierung, Eingabe wählt, Escape bricht ab.
 * Die Liste hält den Fokus im Feld (`aria-activedescendant`). Wird in Popovern, Zellen und Formularen verwendet.
 */
export function Sucheingabe({ label, treffer, laedt, leerText, onSuche, onWaehlen, onAbbrechen, extras = [], autoFokus, gewaehlt }: Props) {
  const basis = useId();
  const [text, setText] = useState("");
  const [aktiv, setAktiv] = useState(0);
  const eingabe = useRef<HTMLInputElement>(null);
  const alle = [...treffer.map((x) => ({ ...x, wahl: () => onWaehlen(x) })), ...extras.map((x) => ({ id: x.id, label: x.label, info: undefined, wahl: x.onWaehlen }))];
  const optionId = (i: number) => `${basis}-o${i}`;
  const markiert = Math.min(aktiv, Math.max(0, alle.length - 1));

  function taste(e: KeyboardEvent) {
    if (e.key === "ArrowDown") setAktiv(Math.min(alle.length - 1, markiert + 1));
    else if (e.key === "ArrowUp") setAktiv(Math.max(0, markiert - 1));
    else if (e.key === "Home" && e.ctrlKey) setAktiv(0);
    else if (e.key === "End" && e.ctrlKey) setAktiv(Math.max(0, alle.length - 1));
    else if (e.key === "Enter") alle[markiert]?.wahl();
    else if (e.key === "Escape" && onAbbrechen) {
      e.stopPropagation();
      onAbbrechen();
    } else return;
    e.preventDefault();
  }

  return (
    <div className="app-sucheingabe">
      <input
        ref={eingabe}
        type="text"
        role="combobox"
        className="app-sucheingabe__feld"
        aria-label={label}
        placeholder={label}
        aria-expanded={alle.length > 0}
        aria-controls={`${basis}-liste`}
        aria-activedescendant={alle.length > 0 ? optionId(markiert) : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        autoFocus={autoFokus}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setAktiv(0);
          onSuche(e.target.value.trim());
        }}
        onKeyDown={taste}
      />
      <ul id={`${basis}-liste`} role="listbox" aria-label={label} className="app-sucheingabe__liste">
        {alle.map((x, i) => (
          <li
            key={x.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === markiert}
            className="app-sucheingabe__treffer"
            data-aktiv={i === markiert || undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => x.wahl()}
          >
            <span>{x.label}</span>
            {x.info ? <span className="app-dubletten__info">{x.info}</span> : null}
          </li>
        ))}
      </ul>
      {gewaehlt ? <p className="app-leer-text">{gewaehlt}</p> : null}
      {laedt ? (
        <p className="app-leer-text" role="status">
          …
        </p>
      ) : leerText && alle.length === 0 ? (
        <p className="app-leer-text">{leerText}</p>
      ) : null}
    </div>
  );
}

/** Aktive Personen mit Zugriff (bei Aufgaben zu einem Deal nur, wer den Deal sehen darf), nach Name durchsucht. */
export function BenutzerSuche({
  dealId,
  onWaehlen,
  onAbbrechen,
  extras,
  autoFokus = true,
}: {
  dealId?: string | undefined;
  onWaehlen: (b: { id: string; name: string }) => void;
  onAbbrechen?: (() => void) | undefined;
  extras?: { id: string; label: string; onWaehlen: () => void }[];
  autoFokus?: boolean;
}) {
  const t = useT();
  const [eingabe, setEingabe] = useState("");
  const q = useEntprellt(eingabe, 200);
  const abfrage = useQuery(crmZustaendige({ ...(q ? { q } : {}), ...(dealId ? { dealId } : {}) }));
  return (
    <Sucheingabe
      label={t.crm.personSuchen}
      treffer={(abfrage.data ?? []).map((b) => ({ id: b.id, label: b.name }))}
      laedt={abfrage.isFetching && !abfrage.data}
      leerText={t.auswahl.keine}
      onSuche={setEingabe}
      onWaehlen={(x) => onWaehlen({ id: x.id, name: x.label })}
      onAbbrechen={onAbbrechen}
      {...(extras ? { extras } : {})}
      autoFokus={autoFokus}
    />
  );
}

/** Unternehmen, Kontakte oder Deals über die globale Suche (nur, was die Person sehen darf), ab zwei Zeichen. */
export function DatensatzSuche({
  ziel,
  onWaehlen,
  onAbbrechen,
  extras,
  autoFokus = true,
}: {
  ziel: Objekt;
  onWaehlen: (b: { id: string; name: string }) => void;
  onAbbrechen?: (() => void) | undefined;
  extras?: { id: string; label: string; onWaehlen: () => void }[];
  autoFokus?: boolean;
}) {
  const t = useT();
  const [eingabe, setEingabe] = useState("");
  const q = useEntprellt(eingabe, 250);
  const abfrage = useQuery({ ...suche(q), enabled: q.length >= 2 });
  const treffer: SuchTreffer[] =
    q.length < 2
      ? []
      : ziel === "organisation"
        ? (abfrage.data?.organisationen ?? []).map((o) => ({ id: o.id, label: o.name, info: [t.organisationArt[o.art], o.ort].filter(Boolean).join(" · ") }))
        : ziel === "person"
          ? (abfrage.data?.personen ?? []).map((p) => ({ id: p.id, label: `${p.vorname} ${p.nachname}`, info: p.organisation?.name ?? t.suche.ohneOrganisation }))
          : (abfrage.data?.deals ?? []).map((d) => ({ id: d.id, label: d.titel, info: d.organisation.name }));
  return (
    <Sucheingabe
      label={ziel === "organisation" ? t.crm.unternehmenWaehlen : ziel === "person" ? t.crm.kontaktWaehlen : t.crm.dealWaehlen}
      treffer={treffer}
      laedt={q.length >= 2 && abfrage.isFetching && !abfrage.data}
      leerText={q.length < 2 ? t.auswahl.hinweis : abfrage.isFetching ? undefined : t.auswahl.keine}
      onSuche={setEingabe}
      onWaehlen={(x) => onWaehlen({ id: x.id, name: x.label })}
      onAbbrechen={onAbbrechen}
      {...(extras ? { extras } : {})}
      autoFokus={autoFokus}
    />
  );
}
