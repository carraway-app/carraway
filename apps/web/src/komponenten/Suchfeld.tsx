import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Feld } from "@carraway/ui";
import { suchfeldTreffer, wertVorschlaege, type OrganisationArt, type SuchfeldZiel, type VorschlagsFeld } from "../api/abfragen";
import { useT } from "../i18n";
import { useEntprellt } from "./formular";

/** Ein Datensatz im Suchfeld: Name plus Zusatzinfo (Art, Ort, Organisation), damit er eindeutig erkennbar ist. */
export interface SuchfeldTreffer {
  id: string;
  label: string;
  info?: string | undefined;
}

interface Option {
  id: string;
  label: string;
  info?: string | undefined;
  /** Exakter Treffer der Eingabe (Wertfeld). */
  exakt?: boolean;
  /** „Neu anlegen“ und ähnliche Einträge unter den Treffern. */
  aktion?: boolean;
  wahl: () => void;
}

interface ComboboxProps {
  label: string;
  text: string;
  onText: (text: string) => void;
  optionen: Option[];
  laedt?: boolean;
  /** Text unter dem Feld, solange die Liste offen ist und nichts passt. */
  leerText?: string | undefined;
  hilfe?: ReactNode;
  fehler?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  name?: string;
  onVerlassen?: () => void;
}

/**
 * Eingabefeld mit Vorschlagsliste nach dem ARIA-Combobox-Muster: `aria-expanded`, `aria-controls`, `aria-activedescendant`; Pfeiltasten
 * bewegen die Markierung, Enter wählt, Escape schließt die Liste. Der Fokus bleibt im Feld. Passwortmanager bieten hier nichts an.
 */
export function Combobox({ label, text, onText, optionen, laedt, leerText, hilfe, fehler, required, disabled, name, onVerlassen }: ComboboxProps) {
  const t = useT();
  const basis = useId();
  const [offen, setOffen] = useState(false);
  const [aktiv, setAktiv] = useState(0);
  const listeId = `${basis}-liste`;
  const optionId = (i: number) => `${basis}-o${i}`;
  const markiert = Math.min(aktiv, Math.max(0, optionen.length - 1));
  const sichtbar = offen && (optionen.length > 0 || laedt || leerText !== undefined);

  function waehle(o: Option) {
    o.wahl();
    setOffen(false);
  }

  function taste(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      if (!offen) setOffen(true);
      else setAktiv(Math.min(optionen.length - 1, markiert + 1));
    } else if (e.key === "ArrowUp") {
      setAktiv(Math.max(0, markiert - 1));
    } else if (e.key === "Enter" && offen && optionen[markiert]) {
      waehle(optionen[markiert]);
    } else if (e.key === "Escape" && offen) {
      // Schließt nur die Liste, nicht den umgebenden Dialog.
      e.stopPropagation();
      setOffen(false);
    } else return;
    e.preventDefault();
  }

  return (
    <div className="app-suchfeld">
      <Feld
        label={label}
        name={name}
        required={required}
        disabled={disabled}
        hilfe={hilfe}
        fehler={fehler}
        value={text}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={sichtbar && optionen.length > 0}
        aria-controls={listeId}
        aria-activedescendant={sichtbar && optionen.length > 0 ? optionId(markiert) : undefined}
        spellCheck={false}
        onChange={(e) => {
          onText(e.target.value);
          setAktiv(0);
          setOffen(true);
        }}
        onFocus={() => setOffen(true)}
        onBlur={() => {
          setOffen(false);
          onVerlassen?.();
        }}
        onKeyDown={taste}
      />
      <ul id={listeId} role="listbox" aria-label={t.auswahl.trefferZu(label)} className="app-suchfeld__liste" hidden={!sichtbar || optionen.length === 0}>
        {optionen.map((o, i) => (
          <li
            key={o.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === markiert}
            className="app-suchfeld__option"
            data-aktiv={i === markiert || undefined}
            data-exakt={o.exakt || undefined}
            data-aktion={o.aktion || undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => waehle(o)}
          >
            <span className="app-suchfeld__name">{o.label}</span>
            {o.info ? <span className="app-suchfeld__info">{o.info}</span> : null}
          </li>
        ))}
      </ul>
      {sichtbar && optionen.length === 0 ? (
        <p className="app-suchfeld__leer" role="status">{laedt ? "…" : leerText}</p>
      ) : null}
    </div>
  );
}

interface VerknuepfungsFeldProps {
  label: string;
  /** Gewählter Datensatz (`null`: noch keiner). */
  wert: SuchfeldTreffer | null;
  onWahl: (treffer: SuchfeldTreffer | null) => void;
  /** Welche Datensätze die Suche liefert; bei Organisationen optional nur eine Art. */
  ziel: SuchfeldZiel;
  art?: OrganisationArt;
  /** Nur Beteiligungen dieses Fonds (Ziel `beteiligung`). */
  fondsId?: string;
  /** Ids, die nicht zur Wahl stehen (z. B. Investoren mit bereits erfasster Zusage). */
  ausschliessen?: ReadonlySet<string>;
  /** Eintrag „„<Eingabe>“ anlegen“ unter den Treffern. */
  onNeu?: (eingabe: string) => void;
  required?: boolean;
  fehler?: ReactNode;
  name?: string;
}

/**
 * Verknüpfungsfeld (Issue #274): tippen, passende Datensätze kommen aus der Suche des Servers (entprellt, höchstens zehn, mit den
 * Leserechten der Suche). Auswahl per Tastatur oder Maus; der gewählte Datensatz steht mit Zusatzinfo unter dem Feld.
 */
export function VerknuepfungsFeld({ label, wert, onWahl, ziel, art, fondsId, ausschliessen, onNeu, required, fehler, name }: VerknuepfungsFeldProps) {
  const t = useT();
  const [text, setText] = useState(wert?.label ?? "");
  const [gewaehlt, setGewaehlt] = useState(wert);
  // Ein von außen gesetzter Wert (z. B. nach „Neu anlegen“ oder Zurücksetzen) übernimmt die Anzeige.
  if (wert?.id !== gewaehlt?.id) {
    setGewaehlt(wert);
    setText(wert?.label ?? "");
  }
  const suchtext = wert ? "" : text.trim();
  const q = useEntprellt(suchtext, 200);
  const abfrage = useQuery({ ...suchfeldTreffer(q, ziel, art, fondsId), enabled: q.length >= 2 });
  const treffer: SuchfeldTreffer[] =
    q.length < 2 || !abfrage.data
      ? []
      : ziel === "organisation"
        ? abfrage.data.organisationen.map((o) => ({ id: o.id, label: o.name, info: [t.organisationArt[o.art], o.ort].filter(Boolean).join(" · ") }))
        : ziel === "person"
          ? abfrage.data.personen.map((p) => ({ id: p.id, label: `${p.vorname} ${p.nachname}`, info: p.organisation?.name ?? t.suche.ohneOrganisation }))
          : ziel === "beteiligung"
            ? abfrage.data.beteiligungen.map((b) => ({ id: b.id, label: b.organisation.name, info: [t.instrument[b.instrument], b.organisation.ort].filter(Boolean).join(" · ") }))
            : abfrage.data.deals.map((d) => ({ id: d.id, label: d.titel, info: d.organisation.name }));
  const optionen: Option[] = treffer
    .filter((x) => !ausschliessen?.has(x.id))
    .map((x) => ({ ...x, wahl: () => onWahl(x) }));
  if (onNeu && suchtext.length >= 2 && !abfrage.isFetching && q === suchtext) {
    optionen.push({ id: "neu", label: t.auswahl.anlegen(suchtext), aktion: true, wahl: () => onNeu(suchtext) });
  }
  return (
    <Combobox
      label={label}
      name={name}
      required={required}
      fehler={fehler}
      hilfe={wert ? t.auswahl.gewaehlt([wert.label, wert.info].filter(Boolean).join(" · ")) : undefined}
      text={text}
      onText={(neu) => {
        setText(neu);
        if (wert) {
          // Tippen löst die Auswahl; der Text bleibt als neue Suche stehen.
          setGewaehlt(null);
          onWahl(null);
        }
      }}
      onVerlassen={() => {
        // Ohne Auswahl bleibt kein halber Suchtext stehen, der wie ein gewählter Datensatz aussieht.
        if (!wert) return;
        setText(wert.label);
      }}
      optionen={optionen}
      laedt={suchtext.length >= 2 && (abfrage.isFetching || q !== suchtext)}
      leerText={suchtext.length < 2 ? t.auswahl.hinweis : t.auswahl.keine}
    />
  );
}

interface VorschlagFeldProps {
  label: string;
  value: string;
  onChange: (wert: string) => void;
  /** Stammdatenfeld, dessen erfasste Werte vorgeschlagen werden (Sektor und Ort der Organisationen, Funktion der Personen). */
  feld: VorschlagsFeld;
  fehler?: ReactNode;
  name?: string;
}

/**
 * Wertfeld mit Vorschlägen (Issue #274): schlägt erfasste Werte des Mandanten vor (häufigste zuerst), damit keine Schreibvarianten
 * entstehen. Freie Eingabe bleibt möglich; ein exakter Treffer ist hervorgehoben.
 */
export function VorschlagFeld({ label, value, onChange, feld, fehler, name }: VorschlagFeldProps) {
  const t = useT();
  const q = useEntprellt(value.trim(), 200);
  const abfrage = useQuery(wertVorschlaege(feld, q));
  const vergleich = value.trim().toLocaleLowerCase();
  const optionen: Option[] = (abfrage.data ?? [])
    .filter((v) => v.wert !== value)
    .map((v) => ({ id: v.wert, label: v.wert, exakt: v.wert.toLocaleLowerCase() === vergleich, info: v.wert.toLocaleLowerCase() === vergleich ? t.auswahl.vorhanden : undefined, wahl: () => onChange(v.wert) }))
    .sort((a, b) => Number(Boolean(b.exakt)) - Number(Boolean(a.exakt)));
  return <Combobox label={label} name={name} fehler={fehler} text={value} onText={onChange} optionen={optionen} />;
}
