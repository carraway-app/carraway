import { useId, type ReactNode } from "react";
import { Auswahl, Button, Feld } from "@carraway/ui";
import { useT } from "../i18n";
import { datumRegel, ganzzahlRegel, prozentRegel } from "../lib/feldpruefung";
import type { useZeilenpruefung } from "./formular";

export interface VestingZeile {
  id: number;
  art: "monate" | "datum";
  monate: string;
  datum: string;
  prozent: string;
}

export interface LeaverZeile {
  id: number;
  art: "good_leaver" | "bad_leaver";
  monate: string;
  prozent: string;
}

interface StufenFelder<T> {
  zeilen: readonly T[];
  setzen: (zeilen: T[]) => void;
  neu: () => T;
  pruefe: ReturnType<typeof useZeilenpruefung>["pruefe"];
  fehler: ReactNode;
}

const monatRegel = ganzzahlRegel({ pflicht: true, max: 240 });
const milestoneDatum = datumRegel({ pflicht: true });
const trancheProzent = prozentRegel({ pflicht: true, nachkomma: 2, ueberMin: true });
const leaverProzent = prozentRegel({ pflicht: true, nachkomma: 2 });

export function VestingStufenFelder({ zeilen, setzen, neu, pruefe, fehler }: StufenFelder<VestingZeile>) {
  const p = useT().mitarbeiter.planen;
  const titel = useId();
  return (
    <section className="app-formular" aria-labelledby={titel}>
      <h3 className="cw-t-untertitel" id={titel}>{p.vesting}</h3>
      {zeilen.length > 0 ? <p className="app-leer-text">{p.vestingHilfe}</p> : null}
      {fehler ? <p role="alert">{fehler}</p> : null}
      {zeilen.map((zeile, index) => {
        const name = p.vestingZeile(index + 1);
        const aendern = (wert: Partial<VestingZeile>) => setzen(zeilen.map((z) => z.id === zeile.id ? { ...z, ...wert } : z));
        return (
          <div key={zeile.id} role="group" aria-label={name} className="cw-formularraster">
            <Auswahl label={p.zeitpunkt} value={zeile.art} onChange={(e) => aendern({ art: e.target.value === "datum" ? "datum" : "monate" })}>
              <option value="monate">{p.monate}</option>
              <option value="datum">{p.datum}</option>
            </Auswahl>
            {zeile.art === "datum" ? (
              <Feld label={p.datum} type="date" value={zeile.datum} onChange={(e) => aendern({ datum: e.target.value })} {...pruefe(`vesting-${zeile.id}-datum`, milestoneDatum, zeile.datum)} />
            ) : (
              <Feld label={p.monate} zahl inputMode="numeric" value={zeile.monate} onChange={(e) => aendern({ monate: e.target.value })} {...pruefe(`vesting-${zeile.id}-monate`, monatRegel, zeile.monate)} />
            )}
            <Feld label={p.anteil} zahl inputMode="decimal" value={zeile.prozent} onChange={(e) => aendern({ prozent: e.target.value })} {...pruefe(`vesting-${zeile.id}-prozent`, trancheProzent, zeile.prozent)} />
            <div className="app-knoepfe">
              <Button variante="sekundaer" aria-label={p.entfernenFuer(name)} onClick={() => setzen(zeilen.filter((z) => z.id !== zeile.id))}>{p.entfernen}</Button>
            </div>
          </div>
        );
      })}
      <div><Button variante="sekundaer" onClick={() => setzen([...zeilen, neu()])} disabled={zeilen.length >= 240}>{p.vestingNeu}</Button></div>
    </section>
  );
}

export function LeaverStufenFelder({ zeilen, setzen, neu, pruefe, fehler }: StufenFelder<LeaverZeile>) {
  const m = useT().mitarbeiter;
  const p = m.planen;
  const titel = useId();
  return (
    <section className="app-formular" aria-labelledby={titel}>
      <h3 className="cw-t-untertitel" id={titel}>{p.leaver}</h3>
      {zeilen.length > 0 ? <p className="app-leer-text">{p.leaverHilfe}</p> : null}
      {fehler ? <p role="alert">{fehler}</p> : null}
      {zeilen.map((zeile, index) => {
        const name = p.leaverZeile(index + 1);
        const aendern = (wert: Partial<LeaverZeile>) => setzen(zeilen.map((z) => z.id === zeile.id ? { ...z, ...wert } : z));
        return (
          <div key={zeile.id} role="group" aria-label={name} className="cw-formularraster">
            <Auswahl label={m.austritte.art} value={zeile.art} onChange={(e) => aendern({ art: e.target.value === "bad_leaver" ? "bad_leaver" : "good_leaver" })}>
              <option value="good_leaver">{m.leaverArt.good_leaver}</option>
              <option value="bad_leaver">{m.leaverArt.bad_leaver}</option>
            </Auswahl>
            <Feld label={p.mindestMonate} zahl inputMode="numeric" value={zeile.monate} onChange={(e) => aendern({ monate: e.target.value })} {...pruefe(`leaver-${zeile.id}-monate`, monatRegel, zeile.monate)} />
            <Feld label={p.bleibt} zahl inputMode="decimal" value={zeile.prozent} onChange={(e) => aendern({ prozent: e.target.value })} {...pruefe(`leaver-${zeile.id}-prozent`, leaverProzent, zeile.prozent)} />
            <div className="app-knoepfe">
              <Button variante="sekundaer" aria-label={p.entfernenFuer(name)} onClick={() => setzen(zeilen.filter((z) => z.id !== zeile.id))}>{p.entfernen}</Button>
            </div>
          </div>
        );
      })}
      <div><Button variante="sekundaer" onClick={() => setzen([...zeilen, neu()])} disabled={zeilen.length >= 240}>{p.leaverNeu}</Button></div>
    </section>
  );
}
