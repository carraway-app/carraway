import "../../crm.css";
import { useState } from "react";
import { Button, PlusIcon, TrashIcon } from "@carraway/ui";
import { istGruppe, type Bedingung, type Feld, type Gruppe } from "../../api/crm";
import { useT, type Texte } from "../../i18n";
import { normalisiereZahl } from "./Zelle";
import { feldName, optionenVon } from "./typen";

const OHNE_WERT = new Set(["leer", "nicht_leer", "ist_wahr", "ist_falsch"]);
const MEHRERE = new Set(["ist_eines_von", "enthaelt_eines", "enthaelt_alle", "enthaelt_keines"]);
/** Für Personen- und Verknüpfungsfelder bietet die Oberfläche nur „leer“ und „nicht leer“ an (die API kennt mehr, braucht aber IDs). */
const NUR_LEER = new Set(["benutzer", "verknuepfung"]);

const operatorenFuer = (feld: Feld) => (NUR_LEER.has(feld.typ) ? feld.operatoren.filter((o) => o === "leer" || o === "nicht_leer") : feld.operatoren);

/** Eine leere Bedingung für das erste filterbare Feld. */
function neueBedingung(felder: Feld[]): Bedingung {
  const f = felder[0]!;
  return { feld: f.schluessel, operator: operatorenFuer(f)[0]!, ...(OHNE_WERT.has(operatorenFuer(f)[0]!) ? {} : { wert: "" }) };
}

interface WertProps {
  feld: Feld;
  operator: string;
  wert: unknown;
  onChange: (wert: unknown) => void;
  beschriftung: string;
  t: Texte;
}

function Wert({ feld, operator, wert, onChange, beschriftung, t }: WertProps) {
  if (OHNE_WERT.has(operator)) return null;
  if (feld.typ === "auswahl" || feld.typ === "mehrfachauswahl") {
    const optionen = optionenVon(feld, t);
    if (MEHRERE.has(operator)) {
      const gewaehlt = Array.isArray(wert) ? (wert as string[]) : [];
      return (
        <fieldset className="app-fed__optionen">
          <legend className="cw-nur-lesen">{beschriftung}</legend>
          {optionen.map((o) => (
            <label key={o.schluessel}>
              <input type="checkbox" checked={gewaehlt.includes(o.schluessel)} onChange={(e) => onChange(e.target.checked ? [...gewaehlt, o.schluessel] : gewaehlt.filter((x) => x !== o.schluessel))} />
              {o.label}
            </label>
          ))}
        </fieldset>
      );
    }
    return (
      <select className="app-auswahl" aria-label={beschriftung} value={typeof wert === "string" ? wert : ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t.crm.waehlen}</option>
        {optionen.map((o) => (
          <option key={o.schluessel} value={o.schluessel}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  const zahlenartig = feld.typ === "zahl" || feld.typ === "betrag";
  const eingabeart = feld.typ === "datum" ? "date" : "text";
  const einzel = (w: unknown, i: number | null) => (
    <input
      key={i ?? 0}
      className="app-fed__eingabe"
      type={eingabeart}
      inputMode={zahlenartig ? "decimal" : undefined}
      aria-label={i === null ? beschriftung : `${beschriftung} ${i + 1}`}
      value={typeof w === "string" ? w : ""}
      onChange={(e) => {
        const v = zahlenartig ? normalisiereZahl(e.target.value) : e.target.value;
        if (i === null) onChange(v);
        else {
          const alt = Array.isArray(wert) ? [...(wert as string[])] : ["", ""];
          alt[i] = v;
          onChange(alt);
        }
      }}
    />
  );
  if (operator === "zwischen") {
    const paar = Array.isArray(wert) ? (wert as string[]) : ["", ""];
    return (
      <span className="app-fed__zwischen">
        {einzel(paar[0], 0)}
        <span aria-hidden="true">–</span>
        {einzel(paar[1], 1)}
      </span>
    );
  }
  return einzel(wert, null);
}

interface GruppeProps {
  felder: Feld[];
  gruppe: Gruppe;
  onChange: (g: Gruppe) => void;
  onEntfernen?: () => void;
  tiefe: number;
}

function GruppeEditor({ felder, gruppe, onChange, onEntfernen, tiefe }: GruppeProps) {
  const t = useT();
  const setze = (i: number, e: Bedingung | Gruppe) => onChange({ ...gruppe, elemente: gruppe.elemente.map((x, j) => (j === i ? e : x)) });
  const entferne = (i: number) => onChange({ ...gruppe, elemente: gruppe.elemente.filter((_, j) => j !== i) });
  return (
    <div className="app-fed__gruppe" role="group" aria-label={tiefe === 1 ? t.crm.filterBedingungen : t.crm.filterGruppe}>
      <div className="app-fed__kopf">
        <select className="app-auswahl app-auswahl--klein" aria-label={t.crm.filterVerknuepfung} value={gruppe.verknuepfung} onChange={(e) => onChange({ ...gruppe, verknuepfung: e.target.value as "und" | "oder" })}>
          <option value="und">{t.crm.filterUnd}</option>
          <option value="oder">{t.crm.filterOder}</option>
        </select>
        {onEntfernen ? <Button variante="ruhig" icon={<TrashIcon />} aria-label={t.crm.filterGruppeEntfernen} onClick={onEntfernen} /> : null}
      </div>
      {gruppe.elemente.map((e, i) => {
        if (istGruppe(e)) return <GruppeEditor key={i} felder={felder} gruppe={e} tiefe={tiefe + 1} onChange={(g) => setze(i, g)} onEntfernen={() => entferne(i)} />;
        const feld = felder.find((f) => f.schluessel === e.feld) ?? felder[0]!;
        const operatoren = operatorenFuer(feld);
        const nr = i + 1;
        return (
          <div key={i} className="app-fed__bedingung">
            <select
              className="app-auswahl app-auswahl--klein"
              aria-label={t.crm.filterFeld(nr)}
              value={feld.schluessel}
              onChange={(ev) => {
                const neu = felder.find((f) => f.schluessel === ev.target.value)!;
                const op = operatorenFuer(neu)[0]!;
                setze(i, { feld: neu.schluessel, operator: op, ...(OHNE_WERT.has(op) ? {} : { wert: "" }) });
              }}
            >
              {felder.map((f) => (
                <option key={f.schluessel} value={f.schluessel}>
                  {feldName(f, t)}
                </option>
              ))}
            </select>
            <select
              className="app-auswahl app-auswahl--klein"
              aria-label={t.crm.filterOperator(nr)}
              value={e.operator}
              onChange={(ev) => setze(i, { feld: e.feld, operator: ev.target.value, ...(OHNE_WERT.has(ev.target.value) ? {} : { wert: MEHRERE.has(ev.target.value) ? [] : "" }) })}
            >
              {operatoren.map((o) => (
                <option key={o} value={o}>
                  {(t.crm.operatoren as Record<string, string>)[o] ?? o}
                </option>
              ))}
            </select>
            <Wert feld={feld} operator={e.operator} wert={e.wert} onChange={(w) => setze(i, { ...e, wert: w })} beschriftung={t.crm.filterWert(nr)} t={t} />
            <Button variante="ruhig" icon={<TrashIcon />} aria-label={t.crm.filterBedingungEntfernen(nr)} onClick={() => entferne(i)} />
          </div>
        );
      })}
      <div className="app-fed__aktionen">
        <Button variante="sekundaer" icon={<PlusIcon />} onClick={() => onChange({ ...gruppe, elemente: [...gruppe.elemente, neueBedingung(felder)] })}>
          {t.crm.filterBedingung}
        </Button>
        {tiefe < 3 ? (
          <Button variante="sekundaer" icon={<PlusIcon />} onClick={() => onChange({ ...gruppe, elemente: [...gruppe.elemente, { verknuepfung: gruppe.verknuepfung === "und" ? "oder" : "und", elemente: [neueBedingung(felder)] }] })}>
            {t.crm.filterGruppeNeu}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Ob eine Bedingung vollständig ist (Wert vorhanden, wo einer gebraucht wird); unvollständige werden beim Anwenden ausgelassen. */
function vollstaendig(b: Bedingung): boolean {
  if (OHNE_WERT.has(b.operator)) return true;
  if (b.operator === "zwischen") return Array.isArray(b.wert) && b.wert.length === 2 && b.wert.every((x) => typeof x === "string" && x !== "");
  if (Array.isArray(b.wert)) return b.wert.length > 0;
  return typeof b.wert === "string" && b.wert !== "";
}

export function bereinige(g: Gruppe): Gruppe | undefined {
  const elemente = g.elemente.flatMap((e): (Bedingung | Gruppe)[] => {
    if (istGruppe(e)) {
      const r = bereinige(e);
      return r ? [r] : [];
    }
    return vollstaendig(e) ? [e] : [];
  });
  return elemente.length ? { verknuepfung: g.verknuepfung, elemente } : undefined;
}

/** Filter einer Ansicht: UND/ODER-Gruppen mit Bedingungen je Feldtyp; „Anwenden“ übernimmt die vollständigen Bedingungen. */
export function FilterEditor({ felder, filter, onAnwenden }: { felder: Feld[]; filter: Gruppe | undefined; onAnwenden: (g: Gruppe | undefined) => void }) {
  const t = useT();
  const filterbar = felder;
  const [entwurf, setEntwurf] = useState<Gruppe>(filter ?? { verknuepfung: "und", elemente: [] });
  return (
    <div className="app-fed">
      <GruppeEditor felder={filterbar} gruppe={entwurf} onChange={setEntwurf} tiefe={1} />
      <div className="app-fed__fuss">
        <Button onClick={() => onAnwenden(bereinige(entwurf))}>{t.crm.filterAnwenden}</Button>
        <Button
          variante="sekundaer"
          onClick={() => {
            setEntwurf({ verknuepfung: "und", elemente: [] });
            onAnwenden(undefined);
          }}
        >
          {t.crm.filterZuruecksetzen}
        </Button>
      </div>
    </div>
  );
}
