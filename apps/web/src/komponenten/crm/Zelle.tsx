import "../../crm.css";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CopyIcon, EnvelopeSimpleIcon, GlobeSimpleIcon, LinkedinLogoIcon, PhoneIcon } from "@carraway/ui";
import type { Feld, Objekt } from "../../api/crm";
import { useSprache, useT, type Texte } from "../../i18n";
import { sichereUrl } from "../../lib/sichereUrl";
import { Datensatzlink } from "./Datensatzlink";
import { NAMENSFELD, optionenVon, schnellLink, zellText } from "./typen";

/** Kleines farbiges Etikett für Auswahloptionen (Farben aus der Palette, nie Orange). */
export function Chip({ farbe, title, children }: { farbe: string; title?: string; children: ReactNode }) {
  return (
    <span className="app-chip" data-farbe={farbe} {...(title ? { title } : {})}>
      {children}
    </span>
  );
}

/** Kopiert Text in die Zwischenablage; ohne Berechtigung des Browsers bleibt es still (der Wert steht ohnehin sichtbar da). */
export async function kopiere(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Mail, Telefon, LinkedIn, Website eines Datensatzes als Schnellaktionen: Mail öffnen oder kopieren, anrufen, Adresse öffnen. */
export function Schnellaktionen({ werte, name, raster = false }: { werte: Record<string, unknown>; name: string; raster?: boolean }) {
  const t = useT();
  const mail = typeof werte.email === "string" && werte.email ? werte.email : null;
  const telefon = typeof werte.telefon === "string" && werte.telefon ? werte.telefon : null;
  const linkedin = sichereUrl(typeof werte.linkedin === "string" ? werte.linkedin : null);
  const website = sichereUrl(typeof werte.website === "string" ? werte.website : null);
  const [kopiert, setKopiert] = useState(false);
  const leer = !mail && !telefon && !linkedin && !website;
  if (leer && !raster) return null;
  // Im Raster der Tabelle hat jede Aktion ihren festen Platz (leere Plätze bleiben unsichtbar und unbedienbar), damit gleiche Symbole untereinander stehen.
  const platz = (key: string) => <span key={key} className="app-schnell__platz" aria-hidden="true" />;
  return (
    <span className="app-schnell" data-raster={raster ? "" : undefined} {...(leer ? { "aria-hidden": true } : { role: "group", "aria-label": t.crm.schnellaktionenFuer(name) })}>
      {raster && !mail ? [platz("m"), platz("k")] : null}
      {mail ? (
        <>
          <a className="app-schnell__knopf" href={`mailto:${mail}`} aria-label={t.crm.mailAn(name)} title={mail}>
            <EnvelopeSimpleIcon />
          </a>
          <button
            type="button"
            className="app-schnell__knopf"
            aria-label={t.crm.mailKopieren(name)}
            title={t.crm.mailKopieren(name)}
            onClick={() => void kopiere(mail).then((ok) => setKopiert(ok))}
          >
            <CopyIcon />
          </button>
        </>
      ) : null}
      {telefon ? (
        <a className="app-schnell__knopf" href={`tel:${telefon.replace(/[^+0-9]/g, "")}`} aria-label={t.crm.anrufen(name)} title={telefon}>
          <PhoneIcon />
        </a>
      ) : raster ? (
        platz("t")
      ) : null}
      {linkedin ? (
        <a className="app-schnell__knopf" href={linkedin} target="_blank" rel="noopener noreferrer" aria-label={t.crm.linkedinVon(name)}>
          <LinkedinLogoIcon />
        </a>
      ) : raster ? (
        platz("l")
      ) : null}
      {website ? (
        <a className="app-schnell__knopf" href={website} target="_blank" rel="noopener noreferrer" aria-label={t.crm.websiteVon(name)}>
          <GlobeSimpleIcon />
        </a>
      ) : raster ? (
        platz("w")
      ) : null}
      <span className="cw-nur-lesen" role="status">
        {kopiert ? t.crm.kopiert : ""}
      </span>
    </span>
  );
}

interface AnzeigeProps {
  objekt: Objekt;
  feld: Feld;
  wert: unknown;
  /** ID des Datensatzes der Zeile (für den Link am Namensfeld). */
  zeileId: string;
  bezuege: Record<string, string | null>;
}

/** Wert einer Zelle: Namen verlinken den Datensatz, Mail, Telefon und Adressen werden zu Links, Auswahlen zu Etiketten. */
export function Anzeige({ objekt, feld, wert, zeileId, bezuege }: AnzeigeProps) {
  const t = useT();
  const sprache = useSprache();
  const leer = wert === null || wert === undefined || wert === "" || (Array.isArray(wert) && wert.length === 0);
  if (feld.typ === "kontrollkaestchen") return <span>{wert === true ? t.crm.ja : wert === false ? t.crm.nein : t.gemeinsam.keinWert}</span>;
  if (leer) return <span className="app-zelle__leer">{t.gemeinsam.keinWert}</span>;
  if (feld.system && feld.schluessel === NAMENSFELD[objekt]) {
    return (
      <Datensatzlink objekt={objekt} id={zeileId} className="app-zelle__name">
        {String(wert)}
      </Datensatzlink>
    );
  }
  switch (feld.typ) {
    case "auswahl": {
      const o = optionenVon(feld, t).find((x) => x.schluessel === wert);
      return <Chip farbe={o?.farbe ?? "grau"}>{o?.label ?? String(wert)}</Chip>;
    }
    case "mehrfachauswahl":
      return (
        <span className="app-chips">
          {(wert as string[]).map((k) => {
            const o = optionenVon(feld, t).find((x) => x.schluessel === k);
            return (
              <Chip key={k} farbe={o?.farbe ?? "grau"}>
                {o?.label ?? k}
              </Chip>
            );
          })}
        </span>
      );
    case "verknuepfung": {
      const ziel = feld.ziel ?? "organisation";
      const name = bezuege[`${ziel}:${String(wert)}`];
      return name ? <Datensatzlink objekt={ziel} id={String(wert)}>{name}</Datensatzlink> : <span className="app-zelle__leer">{t.crm.keinZugriff}</span>;
    }
    case "email":
    case "telefon":
    case "url": {
      const link = schnellLink(feld, wert, sichereUrl);
      return link ? (
        <a href={link} {...(feld.typ === "url" ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {String(wert)}
        </a>
      ) : (
        <span>{String(wert)}</span>
      );
    }
    case "zahl":
    case "betrag":
      return <span className="app-zahl">{zellText(feld, wert, bezuege, t, sprache)}</span>;
    default:
      return <span>{zellText(feld, wert, bezuege, t, sprache)}</span>;
  }
}

/** Typen, die sich in der Tabelle direkt bearbeiten lassen (Personen und Verknüpfungen über ein Popover mit Suche); nur lange Texte gehören auf die Datensatzseite. */
export const INLINE_TYPEN = new Set(["text", "zahl", "betrag", "datum", "auswahl", "mehrfachauswahl", "kontrollkaestchen", "url", "email", "telefon", "benutzer", "verknuepfung"]);
export const istInlineBearbeitbar = (feld: Feld) => feld.schreibbar && INLINE_TYPEN.has(feld.typ);

/** Eingabe der Zahl mit Dezimalkomma oder -punkt als Zeichenkette für die API (`1.234,5` und `1234.5` sind beide gültig). */
export function normalisiereZahl(roh: string): string {
  const t = roh.replace(/\s/g, "");
  return t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
}

/** Wandelt die Eingabe in den Wert der API; `null` leert das Feld. Fehler zeigt die API am Feld (400 `field_value_invalid`). */
export function wertAusEingabe(feld: Feld, text: string): unknown {
  const s = text.trim();
  if (s === "") return null;
  return feld.typ === "zahl" || feld.typ === "betrag" ? normalisiereZahl(s) : s;
}

interface EditorProps {
  feld: Feld;
  wert: unknown;
  t: Texte;
  /** Ergebnis: neuer Wert (auch `null`) oder `undefined` beim Abbrechen. */
  onFertig: (wert: unknown) => void;
  beschriftung: string;
}

/** Editor einer Zelle: je Typ ein Eingabefeld, Eingabe übernimmt, Escape verwirft. */
export function Editor({ feld, wert, t, onFertig, beschriftung }: EditorProps) {
  const eingabe = useRef<HTMLInputElement & HTMLSelectElement>(null);
  const [text, setText] = useState(typeof wert === "string" ? wert : wert === null || wert === undefined ? "" : String(wert));
  const [auswahl, setAuswahl] = useState<string[]>(Array.isArray(wert) ? (wert as string[]) : []);
  const fertig = useRef(false);
  useEffect(() => {
    eingabe.current?.focus();
    eingabe.current?.select?.();
  }, []);
  const beende = (neu: unknown) => {
    if (fertig.current) return;
    fertig.current = true;
    onFertig(neu);
  };
  const taste = (e: KeyboardEvent, wertFuerEnter: () => unknown) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      beende(undefined);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      beende(wertFuerEnter());
    }
  };

  if (feld.typ === "auswahl") {
    const optionen = optionenVon(feld, t);
    return (
      <select
        ref={eingabe}
        className="app-zelleneingabe"
        aria-label={beschriftung}
        value={typeof wert === "string" ? wert : ""}
        onChange={(e) => beende(e.target.value === "" ? null : e.target.value)}
        onBlur={() => beende(undefined)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            beende(undefined);
          }
        }}
      >
        <option value="">{t.gemeinsam.keinWert}</option>
        {optionen.map((o) => (
          <option key={o.schluessel} value={o.schluessel}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (feld.typ === "mehrfachauswahl") {
    const optionen = optionenVon(feld, t);
    return (
      <fieldset
        className="app-zellenmehrfach"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) beende(auswahl.length ? auswahl : null);
        }}
        onKeyDown={(e) => taste(e, () => (auswahl.length ? auswahl : null))}
      >
        <legend className="cw-nur-lesen">{beschriftung}</legend>
        {optionen.map((o, i) => (
          <label key={o.schluessel}>
            <input
              ref={i === 0 ? eingabe : undefined}
              type="checkbox"
              checked={auswahl.includes(o.schluessel)}
              onChange={(e) => setAuswahl((alt) => (e.target.checked ? [...alt, o.schluessel] : alt.filter((x) => x !== o.schluessel)))}
            />
            {o.label}
          </label>
        ))}
      </fieldset>
    );
  }
  const art = feld.typ === "datum" ? "date" : feld.typ === "email" ? "email" : feld.typ === "url" ? "url" : feld.typ === "telefon" ? "tel" : "text";
  return (
    <input
      ref={eingabe}
      className="app-zelleneingabe"
      type={art}
      inputMode={feld.typ === "zahl" || feld.typ === "betrag" ? "decimal" : undefined}
      aria-label={beschriftung}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => beende(wertAusEingabe(feld, text))}
      onKeyDown={(e) => taste(e, () => wertAusEingabe(feld, text))}
    />
  );
}
