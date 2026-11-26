import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Feld, Hinweis } from "@carraway/ui";
import { zusatzDefinitionen, type PortfolioObjekt, type ZusatzDefinition } from "../api/zusatzfelder";
import { useT } from "../i18n";
import { normalisiereZahl } from "./crm/Zelle";
import { BetragFeld } from "./BetragFeld";
import { useZeilenpruefung } from "./formular";
import { betragRegel, datumRegel } from "../lib/feldpruefung";

type Roh = Record<string, string | string[] | boolean>;

/** Typen, die sich im Formular beim Anlegen eingeben lassen; Personen und Verknüpfungen setzt man danach an der Seite des Objekts. */
const IM_FORMULAR = new Set(["text", "langtext", "zahl", "betrag", "datum", "auswahl", "mehrfachauswahl", "kontrollkaestchen", "url", "email", "telefon"]);

/** Aus den Eingaben die Werte für die API: leere Felder entfallen, Zahlen mit Dezimalkomma werden normalisiert. */
export function felderFuerApi(defs: readonly ZusatzDefinition[], roh: Roh): Record<string, unknown> {
  const aus: Record<string, unknown> = {};
  for (const d of defs) {
    const w = roh[d.id];
    if (w === undefined || w === "" || (Array.isArray(w) && w.length === 0) || w === false) continue;
    aus[d.id] = typeof w === "string" ? (d.typ === "zahl" || d.typ === "betrag" ? normalisiere(w) : w.trim()) : w;
  }
  return aus;
}

const normalisiere = (w: string) => normalisiereZahl(w.trim());

/**
 * Eingabe der eigenen Felder beim Anlegen eines Objekts (Etappe 21, bisher für Vorgänge: Werte sind danach unveränderlich). Meldet bei jeder Änderung die
 * fertigen Werte für die API. Ohne Definitionen erscheint nichts.
 */
export function FelderEingabe({ objekt, onChange }: { objekt: PortfolioObjekt; onChange: (werte: Record<string, unknown>) => void }) {
  const t = useT();
  const z = t.zusatzfelder;
  const { data: defs } = useQuery(zusatzDefinitionen(objekt));
  const [roh, setRoh] = useState<Roh>({});
  // Zahlen und Beträge werden am Feld geprüft (Beträge mit höchstens zwei, Zahlen mit höchstens sechs Nachkommastellen, wie die API); die Werte gehen als fertige Zeichenketten nach oben.
  const { pruefe } = useZeilenpruefung();
  const felder = (defs ?? []).filter((d) => IM_FORMULAR.has(d.typ));
  if (felder.length === 0) return null;
  const setze = (id: string, wert: string | string[] | boolean) => {
    const neu = { ...roh, [id]: wert };
    setRoh(neu);
    onChange(felderFuerApi(felder, neu));
  };
  return (
    <fieldset className="app-gruppe app-felderformular">
      <legend className="cw-t-beschriftung">{z.formular}</legend>
      <Hinweis>{z.formularHinweis}</Hinweis>
      {felder.map((d) => {
        const wert = roh[d.id];
        if (d.typ === "auswahl")
          return (
            <Auswahl key={d.id} label={d.name} value={typeof wert === "string" ? wert : ""} onChange={(e) => setze(d.id, e.target.value)}>
              <option value="">{t.gemeinsam.keinWert}</option>
              {(d.optionen.optionen ?? []).map((o) => (
                <option key={o.schluessel} value={o.schluessel}>
                  {o.label}
                </option>
              ))}
            </Auswahl>
          );
        if (d.typ === "mehrfachauswahl")
          return (
            <fieldset key={d.id} className="app-zellenmehrfach app-zellenmehrfach--formular">
              <legend className="cw-t-beschriftung">{d.name}</legend>
              {(d.optionen.optionen ?? []).map((o) => {
                const gewaehlt = Array.isArray(wert) ? wert : [];
                return (
                  <label key={o.schluessel}>
                    <input type="checkbox" checked={gewaehlt.includes(o.schluessel)} onChange={(e) => setze(d.id, e.target.checked ? [...gewaehlt, o.schluessel] : gewaehlt.filter((x) => x !== o.schluessel))} />
                    {o.label}
                  </label>
                );
              })}
            </fieldset>
          );
        if (d.typ === "kontrollkaestchen")
          return (
            <label key={d.id} className="app-kontrollkaestchen">
              <input type="checkbox" checked={wert === true} onChange={(e) => setze(d.id, e.target.checked)} />
              {d.name}
            </label>
          );
        if (d.typ === "zahl" || d.typ === "betrag")
          return <BetragFeld key={d.id} label={d.name} value={typeof wert === "string" ? wert : ""} onChange={(e) => setze(d.id, e.target.value)} {...pruefe(d.id, betragRegel(d.typ === "zahl" ? { vorzeichen: "beliebig", nachkomma: 6, ganzstellen: 18 } : { vorzeichen: "beliebig" }), typeof wert === "string" ? wert : "")} />;
        if (d.typ === "datum")
          return <Feld key={d.id} label={d.name} type="date" value={typeof wert === "string" ? wert : ""} onChange={(e) => setze(d.id, e.target.value)} {...pruefe(d.id, datumRegel(), typeof wert === "string" ? wert : "")} />;
        const art = d.typ === "email" ? "email" : d.typ === "url" ? "url" : d.typ === "telefon" ? "tel" : "text";
        return <Feld key={d.id} label={d.name} type={art} autoComplete="off" value={typeof wert === "string" ? wert : ""} onChange={(e) => setze(d.id, e.target.value)} />;
      })}
    </fieldset>
  );
}
