import { lazy, Suspense, useEffect, useRef, useState, type Key, type ReactNode } from "react";
import { DotsThreeIcon } from "../icons";
import type { MenueEintrag } from "./Menue";

// Das Zeilenmenü lädt erst, wenn eine Tabelle es braucht (nicht jede Seite hat eines).
const Menue = lazy(() => import("./Menue").then((m) => ({ default: m.Menue })));
import { klassen } from "../hilfen";
import { useUiTexte } from "../sprache";

export type Sortierrichtung = "auf" | "ab";

export interface TabelleSpalte<T> {
  schluessel: string;
  kopf: ReactNode;
  zelle: (zeile: T) => ReactNode;
  /** Rechtsbündig in Mono mit festen Ziffernbreiten. */
  zahl?: boolean;
  /** Macht die Kopfzelle zum Knopf (braucht `onSortieren` an der Tabelle). */
  sortierbar?: boolean;
  /**
   * Erlaubt Zeilenumbruch in den Zellen dieser Spalte (Freitext wie Bemerkung, Beschreibung, Grund) mit 16 bis 32 Zeichen Breite.
   * Ohne Angabe bleibt jede Zelle einzeilig; die Tabelle wird dann breiter und scrollt waagerecht.
   */
  umbruch?: boolean;
}

export interface TabelleProps<T> {
  /** Name der Tabelle für Screenreader. */
  beschriftung: string;
  spalten: TabelleSpalte<T>[];
  zeilen: T[];
  zeilenSchluessel: (zeile: T) => Key;
  ausgewaehlt?: (zeile: T) => boolean;
  sortierung?: { schluessel: string; richtung: Sortierrichtung };
  onSortieren?: (schluessel: string) => void;
  className?: string;
  /** Kompakter horizontaler Abstand der Zellen. */
  dicht?: boolean;
  /** Zeigt Platzhalterzeilen statt der Daten. */
  laedt?: boolean;
  /** Leerer Zustand, wenn es keine Zeilen gibt (zum Beispiel `<Leer … />`). Ohne Angabe bleibt die Tabelle leer. */
  leer?: ReactNode;
  /** Aktionen je Zeile als Menü am Zeilenende; eine leere Liste blendet das Menü der Zeile aus. */
  aktionen?: (zeile: T) => MenueEintrag[];
  /** Name der Spalte mit dem Zeilenmenü (nur für Screenreader). */
  aktionenKopf?: string;
  /** Der Kopf bleibt stehen, die Tabelle scrollt ab dieser Zeilenzahl in sich (Standard 14). */
  langAb?: number;
  /**
   * Summenzeile unter den Daten (`<tfoot>`): je Spaltenschlüssel der Inhalt der Zelle. Die erste Spalte wird zur Zeilenkopfzelle
   * (`<th scope="row">`), `zahl`-Spalten stehen rechtsbündig. Ohne Zeilen oder beim Laden entfällt sie.
   */
  fusszeile?: Record<string, ReactNode>;
  /**
   * Anzahl der Spalten links, die beim waagerechten Scrollen stehen bleiben (Standard 1: die Namensspalte; 0 schaltet ab;
   * 2, wenn die erste Spalte eine Auswahlbox ist; mehr als 2 wird auf 2 begrenzt).
   */
  festeSpalten?: number;
}

export function Tabelle<T>({ beschriftung, spalten, zeilen, zeilenSchluessel, ausgewaehlt, sortierung, onSortieren, className, dicht, laedt, leer, aktionen, aktionenKopf, langAb = 14, fusszeile, festeSpalten = 1 }: TabelleProps<T>) {
  const t = useUiTexte();
  const spaltenzahl = spalten.length + (aktionen ? 1 : 0);
  const fest = Math.max(0, Math.min(2, Math.floor(festeSpalten), spalten.length));
  /** Klassen je Spalte: Zahl, Umbruch, feste Spalte (die letzte feste trägt die Kante). */
  // Breite Tabellen scrollen waagerecht in ihrem eigenen Rahmen; eine Kante zeigt, dass links oder rechts noch Spalten folgen.
  const huelle = useRef<HTMLDivElement>(null);
  const [kanten, setKanten] = useState({ links: false, rechts: false });
  useEffect(() => {
    const el = huelle.current;
    if (!el) return;
    const pruefe = () => {
      const links = el.scrollLeft > 1;
      const rechts = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setKanten((alt) => (alt.links === links && alt.rechts === rechts ? alt : { links, rechts }));
    };
    pruefe();
    el.addEventListener("scroll", pruefe, { passive: true });
    const beobachter = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(pruefe);
    beobachter?.observe(el);
    if (el.firstElementChild) beobachter?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", pruefe);
      beobachter?.disconnect();
    };
  }, []);
  const zellKlasse = (s: TabelleSpalte<T>, i: number) =>
    klassen(s.zahl && "cw-zahl", s.umbruch && "cw-tabelle__umbruch", i < fest && "cw-fest", i < fest && i === fest - 1 && "cw-fest--kante", i === 1 && fest === 2 && "cw-fest--zweite") || undefined;
  return (
    <div className="cw-tabelle-rahmen" data-links={kanten.links || undefined} data-rechts={kanten.rechts || undefined}>
    <div ref={huelle} className={klassen("cw-tabelle-huelle", zeilen.length > langAb && "cw-tabelle-huelle--lang")} role="region" aria-label={beschriftung} tabIndex={0}>
      <table className={klassen("cw-tabelle", fest === 2 && "cw-tabelle--fest-2", dicht && "cw-tabelle--dicht", className)} aria-busy={laedt ? true : undefined}>
        <thead>
          <tr>
            {spalten.map((s, i) => {
              const aktiv = sortierung?.schluessel === s.schluessel;
              const ariaSort = aktiv ? (sortierung.richtung === "auf" ? "ascending" : "descending") : undefined;
              const knopf = s.sortierbar && onSortieren;
              return (
                <th key={s.schluessel} scope="col" aria-sort={ariaSort} className={zellKlasse(s, i)}>
                  {knopf ? (
                    <button
                      type="button"
                      className="cw-tabelle__sortierung"
                      aria-label={t.sortierenNach(typeof s.kopf === "string" ? s.kopf : s.schluessel)}
                      onClick={() => onSortieren(s.schluessel)}
                    >
                      {s.kopf}
                      {aktiv ? <span aria-hidden="true">{sortierung.richtung === "auf" ? "▲" : "▼"}</span> : null}
                    </button>
                  ) : (
                    <>
                      {s.kopf}
                      {aktiv ? <span aria-hidden="true"> {sortierung.richtung === "auf" ? "▲" : "▼"}</span> : null}
                    </>
                  )}
                </th>
              );
            })}
            {aktionen ? (
              <th scope="col" className="cw-tabelle__aktion">
                <span className="cw-nur-lesen">{aktionenKopf ?? t.weitereAktionen}</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {laedt
            ? [0, 1, 2].map((i) => (
                <tr key={i} className="cw-tabelle__laden">
                  <td colSpan={spaltenzahl}>
                    <span className="cw-skelett" aria-hidden="true" />
                  </td>
                </tr>
              ))
            : null}
          {!laedt && zeilen.length === 0 && leer ? (
            <tr className="cw-tabelle__leer">
              <td colSpan={spaltenzahl}>{leer}</td>
            </tr>
          ) : null}
          {laedt
            ? null
            : zeilen.map((z) => {
                const eintraege = aktionen?.(z) ?? [];
                return (
                  <tr key={zeilenSchluessel(z)} aria-current={ausgewaehlt?.(z) ? "true" : undefined}>
                    {spalten.map((s, i) => (
                      <td key={s.schluessel} className={zellKlasse(s, i)}>
                        {s.zelle(z)}
                      </td>
                    ))}
                    {aktionen ? (
                      <td className="cw-tabelle__aktion">
                        {eintraege.length > 0 ? (
                          <Suspense fallback={null}>
                            <Menue aria-label={t.weitereAktionen} ausloeser={<DotsThreeIcon />} ausloeserKlasse="cw-button cw-button--ruhig cw-button--icon cw-button--s" eintraege={eintraege} />
                          </Suspense>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
        </tbody>
        {fusszeile && !laedt && zeilen.length > 0 ? (
          <tfoot>
            <tr>
              {spalten.map((s, i) =>
                i === 0 ? (
                  <th key={s.schluessel} scope="row" className={zellKlasse(s, i)}>
                    {fusszeile[s.schluessel]}
                  </th>
                ) : (
                  <td key={s.schluessel} className={zellKlasse(s, i)}>
                    {fusszeile[s.schluessel]}
                  </td>
                ),
              )}
              {aktionen ? <td className="cw-tabelle__aktion" /> : null}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
    </div>
  );
}
