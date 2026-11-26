import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Feld } from "../../api/crm";
import { useT } from "../../i18n";
import { BenutzerSuche, DatensatzSuche } from "./Sucheingabe";

interface Props {
  feld: Feld;
  /** Zugänglicher Name der Fläche. */
  beschriftung: string;
  /** Aktuelle Anzeige der Zelle (Name der gewählten Person oder des Datensatzes). */
  anzeige: string;
  hatWert: boolean;
  /** Ergebnis: Kennung (oder `null` zum Leeren), `undefined` beim Abbrechen. */
  onFertig: (wert: string | null | undefined) => void;
}

/**
 * Bearbeiten einer Person- oder Verknüpfungszelle: ein Popover mit Suche am Zellenrand (im Dokument eingehängt, damit es
 * weder von der scrollenden Tabelle noch von den verschobenen Zeilen abgeschnitten wird). Die Wahl gilt sofort, Escape oder ein
 * Klick daneben bricht ab. Die Prüfung der Werte übernimmt die API wie bei der Datensatzseite.
 */
export function ZellenAuswahl({ feld, beschriftung, anzeige, hatWert, onFertig }: Props) {
  const t = useT();
  const anker = useRef<HTMLSpanElement>(null);
  const flaeche = useRef<HTMLDivElement>(null);
  const [lage, setLage] = useState<{ top: number; left: number } | null>(null);
  const fertig = useRef(false);
  const beende = (wert: string | null | undefined) => {
    if (fertig.current) return;
    fertig.current = true;
    onFertig(wert);
  };

  // Die Fläche folgt der Zelle, wenn die Tabelle oder die Seite scrollt; verschwindet die Zelle aus dem Bild, schließt sie.
  useLayoutEffect(() => {
    const messe = () => {
      const r = anker.current?.getBoundingClientRect();
      if (!r) return;
      if (r.bottom < 0 || r.top > window.innerHeight) return beende(undefined);
      const breite = 280;
      setLage({ top: r.bottom + 2, left: Math.max(8, Math.min(r.left, window.innerWidth - breite - 8)) });
    };
    messe();
    window.addEventListener("resize", messe);
    window.addEventListener("scroll", messe, true);
    return () => {
      window.removeEventListener("resize", messe);
      window.removeEventListener("scroll", messe, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const beiKlick = (e: MouseEvent) => {
      if (e.target instanceof Node && !flaeche.current?.contains(e.target) && !anker.current?.contains(e.target)) beende(undefined);
    };
    document.addEventListener("mousedown", beiKlick);
    return () => document.removeEventListener("mousedown", beiKlick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const extras = hatWert ? [{ id: "leeren", label: t.crm.wertLoeschen, onWaehlen: () => beende(null) }] : [];
  const wahl = (x: { id: string; name: string }) => beende(x.id);
  return (
    <>
      <span ref={anker} className="app-zellenanker">
        {anzeige || t.gemeinsam.keinWert}
      </span>
      {lage
        ? createPortal(
            <div ref={flaeche} role="group" aria-label={beschriftung} className="app-zellenpopover" style={{ top: lage.top, left: lage.left }}>
              {feld.typ === "benutzer" ? (
                <BenutzerSuche onWaehlen={wahl} onAbbrechen={() => beende(undefined)} extras={extras} />
              ) : (
                <DatensatzSuche ziel={feld.ziel ?? "organisation"} onWaehlen={wahl} onAbbrechen={() => beende(undefined)} extras={extras} />
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
