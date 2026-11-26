import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Seitenpanel } from "@carraway/ui";
import { crmDatensatz, type Feld, type Zeile } from "../api/crm";
import { useDealKartenfelderSpeichern } from "../api/dealflow";
import { useSprache, useT } from "../i18n";
import { feldName, zellText } from "./crm/typen";
import { FehlerHinweis } from "./FehlerHinweis";

export const STANDARD_KARTENFELDER = ["ticket", "investmentmanager"];
const STRUKTURFELDER = new Set(["titel", "unternehmen", "phase", "status", "betreuung", "unternehmenEmail", "unternehmenTelefon", "unternehmenWebsite", "fondsId", "investmentmanagerId", "projektleiterId"]);
const MAX_KARTENFELDER = 35;

export const waehlbareKartenfelder = (felder: Feld[]) => felder.filter((feld) => !STRUKTURFELDER.has(feld.schluessel));

export function kartenUnternehmen(werte: Zeile, bezuege: Record<string, string | null>) {
  if (typeof werte.unternehmen !== "string") return null;
  const name = bezuege[`organisation:${werte.unternehmen}`];
  const wortfolge = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const titel = wortfolge(String(werte.titel ?? ""));
  return name && !` ${titel} `.includes(` ${wortfolge(name)} `) ? name : null;
}

export function DealKartenwerte({ felder, werte, bezuege }: {
  felder: Feld[];
  werte: Zeile;
  bezuege: Record<string, string | null>;
}) {
  const t = useT();
  const sprache = useSprache();
  const sichtbar = felder.flatMap((feld) => {
    const text = zellText(feld, werte[feld.schluessel], bezuege, t, sprache);
    return text.trim() ? [{ feld, text }] : [];
  });
  return sichtbar.length > 0 ? (
    <dl className="app-deal__daten">
      {sichtbar.map(({ feld, text }) => (
        <div key={feld.schluessel} data-zahl={feld.typ === "betrag" || feld.typ === "zahl" || undefined}>
          <dt>{feldName(feld, t)}</dt>
          <dd className={feld.typ === "betrag" || feld.typ === "zahl" ? "app-zahl" : undefined}>{text}</dd>
        </div>
      ))}
    </dl>
  ) : null;
}

export function DealKartenfelderDialog({ katalog, aktiv, vorschauId, onSchliessen, onGespeichert }: {
  katalog: Feld[];
  aktiv: string[];
  vorschauId?: string;
  onSchliessen: () => void;
  onGespeichert: () => void;
}) {
  const t = useT();
  const f = t.dealflow;
  const [felder, setFelder] = useState(aktiv);
  const speichern = useDealKartenfelderSpeichern();
  const vorschau = useQuery({ ...crmDatensatz("deal", vorschauId ?? ""), enabled: Boolean(vorschauId) });
  const unternehmen = vorschau.data ? kartenUnternehmen(vorschau.data.werte, vorschau.data.bezuege) : null;
  const gewaehlt = felder.flatMap((id) => {
    const feld = katalog.find((k) => k.schluessel === id);
    return feld ? [feld] : [];
  });

  return (
    <Seitenpanel titel={f.kartenfelder} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.kartenfelder}</h2>
      <form className="app-formular" onSubmit={(e) => {
        e.preventDefault();
        if (!speichern.isPending && felder.length <= MAX_KARTENFELDER) speichern.mutate(felder, { onSuccess: onGespeichert });
      }}>
        <FehlerHinweis fehler={speichern.error} />
        <p>{f.kartenfelderHilfe}</p>
        <fieldset className="app-dealflow__felder" disabled={speichern.isPending}>
          <legend className="cw-nur-lesen">{f.kartenfelder}</legend>
          {katalog.map((feld) => {
            const id = feld.schluessel;
            const gewaehlt = felder.includes(id);
            return (
              <label key={id} className="app-dealflow__kontrollfeld">
                <input
                  type="checkbox"
                  checked={gewaehlt}
                  disabled={!gewaehlt && felder.length >= MAX_KARTENFELDER}
                  onChange={(e) => setFelder(e.target.checked ? [...felder, id] : felder.filter((k) => k !== id))}
                />
                {feldName(feld, t)}
              </label>
            );
          })}
        </fieldset>
        {felder.length >= MAX_KARTENFELDER ? <p role="status">{f.kartenfelderGrenze(MAX_KARTENFELDER)}</p> : null}
        <section className="app-dealflow__vorschau" aria-label={f.kartenvorschau}>
          <h3>{f.kartenvorschau}</h3>
          {!vorschauId ? <p>{f.kartenvorschauLeer}</p> : vorschau.isPending ? <p role="status">{t.gemeinsam.laedt}</p> : null}
          <FehlerHinweis fehler={vorschau.error} />
          {vorschau.data ? (
            <article className="app-deal">
              <h4 className="app-deal__name">{String(vorschau.data.werte.titel ?? "")}</h4>
              {unternehmen ? <p className="app-deal__titel">{unternehmen}</p> : null}
              <DealKartenwerte felder={gewaehlt} werte={vorschau.data.werte} bezuege={vorschau.data.bezuege} />
            </article>
          ) : null}
        </section>
        <div><Button type="submit" disabled={speichern.isPending || felder.length > MAX_KARTENFELDER}>{t.crm.speichern}</Button></div>
      </form>
    </Seitenpanel>
  );
}
