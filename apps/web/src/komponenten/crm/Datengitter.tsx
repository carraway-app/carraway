import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from "react";
import { observeElementRect, useVirtualizer } from "@tanstack/react-virtual";
import { CaretDownIcon, CaretUpIcon } from "@carraway/ui";
import type { Feld, Konfig, Objekt, Zeile } from "../../api/crm";
import { useSprache, useT } from "../../i18n";
import { Anzeige, Editor, Schnellaktionen, istInlineBearbeitbar } from "./Zelle";
import { ZellenAuswahl } from "./ZellenAuswahl";
import { NAMENSFELD, feldName, schnellName, schnellWerte, zeilenName, zellText } from "./typen";

export interface GitterSpalte {
  feld: Feld;
  breite: number;
}

export const ZEILENHOEHE = 36;
/** Höhe der Kopfzeile; sie klebt oben im selben Scrollbereich wie die Zeilen und verschiebt deren Anfang. */
export const KOPFHOEHE = ZEILENHOEHE;
const FENSTERHOEHE = 560;
const AUSWAHL_BREITE = 40;
/** Eine Spalte darf auf diesen Anteil ihrer Breite schrumpfen, bevor die Tabelle waagerecht scrollt (nie unter 88 px). */
const MIN_ANTEIL = 0.62;
const minBreite = (breite: number) => Math.min(breite, Math.max(88, Math.round(breite * MIN_ANTEIL)));

interface Props {
  objekt: Objekt;
  spalten: GitterSpalte[];
  zeilen: Zeile[];
  gesamt: number;
  bezuege: Record<string, string | null>;
  sortierung: Konfig["sortierung"];
  onSortieren: (feld: string) => void;
  onBreite: (feld: string, breite: number) => void;
  /** Verschiebt eine Spalte per Ziehen im Kopf oder Alt+Pfeiltaste; `nach` ist die Position in der neuen Reihenfolge. Die erste Spalte bleibt vorn. Ohne diese Funktion lassen sich die Köpfe nicht ziehen. */
  onVerschieben?: (feld: string, nach: number) => void;
  auswahl: ReadonlySet<string>;
  onAuswahl: (neu: Set<string>) => void;
  /** Darf die Person dieses Feld dieser Zeile ändern? (Listenfelder dürfen nur Besitzerin oder Besitzer der Liste und Verwalter, Felder des Datensatzes jede Person mit Schreibrecht.) */
  darfSchreiben: (zeile: Zeile, feld: Feld) => boolean;
  /** Schreibt den neuen Wert; ein Fehler wird vom Aufrufer angezeigt. */
  onAendern: (zeile: Zeile, feld: Feld, wert: unknown) => Promise<unknown>;
  ladeMehr: () => void;
  laedtMehr: boolean;
  beschriftung: string;
  /** Wer einen Datensatz öffnet (Eingabetaste im Namensfeld). */
  onOeffnen: (zeile: Zeile) => void;
  /** Höhe des scrollenden Zeilenfensters (Standard 560 px; gruppierte Tabellen nehmen weniger je Gruppe). */
  fensterHoehe?: number;
}

/**
 * Tabelle der Datensätze: virtualisiert (nur sichtbare Zeilen im DOM), mit Tastaturbedienung als `grid` (Pfeiltasten, Pos1/Ende,
 * Eingabe oder F2 bearbeitet die Zelle, Escape bricht ab, Leertaste wählt die Zeile), Sortierung über die Spaltenköpfe, Spaltenbreite
 * per Ziehen oder Pfeiltasten am Griff, Spaltenreihenfolge per Ziehen des Kopfs (oder Alt+Pfeil links/rechts) und Schnellaktionen (Mail, Telefon, Adressen) je Zeile.
 */
export function Datengitter({ objekt, spalten, zeilen, gesamt, bezuege, sortierung, onSortieren, onBreite, onVerschieben, auswahl, onAuswahl, darfSchreiben, onAendern, ladeMehr, laedtMehr, beschriftung, onOeffnen, fensterHoehe = FENSTERHOEHE }: Props) {
  const t = useT();
  const sprache = useSprache();
  // Ein einziger Scrollbereich für Kopf und Zeilen (waagerecht und senkrecht): Kopfzeile, erste Spalte und Aktionsspalte kleben darin am Rand.
  const [fenster, setFenster] = useState<HTMLDivElement | null>(null);
  const wurzel = useRef<HTMLDivElement | null>(null);
  const setzeWurzel = useCallback((el: HTMLDivElement | null) => {
    wurzel.current = el;
    setFenster(el);
  }, []);
  const [aktiv, setAktiv] = useState({ zeile: 0, spalte: 0 });
  const [bearbeitet, setBearbeitet] = useState<{ zeile: number; spalte: number } | null>(null);
  const [fokusNoetig, setFokusNoetig] = useState(false);
  // Kantenschatten der klebenden Ränder nur, solange tatsächlich Inhalt darunter liegt.
  const [kanten, setKanten] = useState({ links: false, rechts: false });
  const messeKanten = useCallback(() => {
    const el = wurzel.current;
    if (!el) return;
    const links = el.scrollLeft > 0.5;
    const rechts = el.scrollLeft + el.clientWidth < el.scrollWidth - 1.5;
    setKanten((alt) => (alt.links === links && alt.rechts === rechts ? alt : { links, rechts }));
  }, []);
  // Spaltenreihenfolge im Kopf: gezogene Spalte, Einfügeposition (1 bis n), Ansage für Screenreader.
  const [kopfZiehend, setKopfZiehend] = useState<string | null>(null);
  const [kopfZiel, setKopfZiel] = useState<number | null>(null);
  const [meldung, setMeldung] = useState("");
  const breitenZug = useRef(false);
  const fokusKopf = useRef<string | null>(null);

  const virtuell = useVirtualizer({
    count: zeilen.length,
    getScrollElement: () => fenster,
    estimateSize: () => ZEILENHOEHE,
    overscan: 10,
    scrollMargin: KOPFHOEHE,
    scrollPaddingStart: KOPFHOEHE,
    // Umgebungen ohne Layout (Tests, versteckte Reiter) messen 0 × 0; dann gilt die Sollgröße, sonst würde die Tabelle keine Zeile zeichnen.
    initialRect: { width: 1100, height: fensterHoehe },
    observeElementRect: (instanz, rueckruf) => observeElementRect(instanz, (rect) => rueckruf(rect.height === 0 ? { width: rect.width || 1100, height: fensterHoehe } : rect)),
  });
  const eintraege = virtuell.getVirtualItems();

  const spaltenAnzahl = spalten.length;
  const vorlage = useMemo(() => `${AUSWAHL_BREITE}px ${spalten.map((s) => `minmax(${minBreite(s.breite)}px, ${s.breite}px)`).join(" ")} var(--app-gitter-aktion)`, [spalten]);
  // Mindestbreite der Tabelle: schmale Fenster (1440 px mit Seitenleiste) quetschen die Spalten bis zur Mindestbreite, erst darunter scrollt die Tabelle,
  // damit die Spalte der Schnellaktionen am rechten Rand nicht abgeschnitten wird.
  const gesamtBreite = `calc(${AUSWAHL_BREITE + spalten.reduce((n, s) => n + minBreite(s.breite), 0)}px + var(--app-gitter-aktion))`;

  useEffect(() => {
    messeKanten();
    if (!fenster || typeof ResizeObserver === "undefined") return;
    const beobachter = new ResizeObserver(messeKanten);
    beobachter.observe(fenster);
    if (fenster.firstElementChild) beobachter.observe(fenster.firstElementChild);
    return () => beobachter.disconnect();
  }, [fenster, vorlage, messeKanten]);

  // Nach dem Verschieben per Tastatur behält die Spalte den Fokus (der Knoten wird umgesetzt).
  useEffect(() => {
    if (!fokusKopf.current) return;
    wurzel.current?.querySelector<HTMLElement>(`[data-kopf="${CSS.escape(fokusKopf.current)}"] :is(button, [tabindex])`)?.focus();
    fokusKopf.current = null;
  }, [spalten]);

  // Weitere Seiten nachladen, sobald das Ende in Sicht kommt.
  const letzter = eintraege.at(-1)?.index ?? -1;
  useEffect(() => {
    if (!laedtMehr && zeilen.length < gesamt && letzter >= zeilen.length - 12) ladeMehr();
  }, [letzter, zeilen.length, gesamt, laedtMehr, ladeMehr]);

  // Fokus auf die aktive Zelle setzen, nachdem sie gezeichnet ist (auch nach dem Scrollen zu einer noch nicht gezeichneten Zeile).
  useEffect(() => {
    if (!fokusNoetig || bearbeitet) return;
    const ziel = wurzel.current?.querySelector<HTMLElement>(`[data-z="${aktiv.zeile}:${aktiv.spalte}"]`);
    if (ziel) {
      ziel.focus();
      setFokusNoetig(false);
    } else virtuell.scrollToIndex(aktiv.zeile);
  }, [fokusNoetig, aktiv, bearbeitet, eintraege.length, virtuell]);

  const gehe = useCallback(
    (zeile: number, spalte: number) => {
      setAktiv({ zeile: Math.max(0, Math.min(zeilen.length - 1, zeile)), spalte: Math.max(0, Math.min(spaltenAnzahl - 1, spalte)) });
      setFokusNoetig(true);
    },
    [zeilen.length, spaltenAnzahl],
  );

  const beginneBearbeiten = (r: number, c: number) => {
    const z = zeilen[r];
    const s = spalten[c];
    if (!z || !s || !istInlineBearbeitbar(s.feld) || !darfSchreiben(z, s.feld)) return false;
    if (s.feld.typ === "kontrollkaestchen") {
      void onAendern(z, s.feld, z[s.feld.schluessel] === true ? false : true).catch(() => {});
      return true;
    }
    setAktiv({ zeile: r, spalte: c });
    setBearbeitet({ zeile: r, spalte: c });
    return true;
  };

  function beiTaste(e: KeyboardEvent) {
    if (bearbeitet) return;
    const ziel = e.target as HTMLElement;
    // Tasten in Links, Knöpfen und Eingaben innerhalb der Zeile gehören ihnen, nur die Zelle selbst steuert das Gitter.
    if (!ziel.hasAttribute("data-z")) return;
    const { zeile, spalte } = aktiv;
    const seite = Math.max(1, Math.floor(fensterHoehe / ZEILENHOEHE) - 1);
    switch (e.key) {
      case "ArrowDown":
        gehe(zeile + 1, spalte);
        break;
      case "ArrowUp":
        gehe(zeile - 1, spalte);
        break;
      case "ArrowRight":
        gehe(zeile, spalte + 1);
        break;
      case "ArrowLeft":
        gehe(zeile, spalte - 1);
        break;
      case "Home":
        gehe(e.ctrlKey ? 0 : zeile, 0);
        break;
      case "End":
        gehe(e.ctrlKey ? zeilen.length - 1 : zeile, spaltenAnzahl - 1);
        break;
      case "PageDown":
        gehe(zeile + seite, spalte);
        break;
      case "PageUp":
        gehe(zeile - seite, spalte);
        break;
      case " ": {
        const z = zeilen[zeile];
        if (z) {
          const neu = new Set(auswahl);
          if (neu.has(z.id)) neu.delete(z.id);
          else neu.add(z.id);
          onAuswahl(neu);
        }
        break;
      }
      case "Enter":
      case "F2": {
        const z = zeilen[zeile];
        const s = spalten[spalte];
        if (!z || !s) return;
        if (!beginneBearbeiten(zeile, spalte) && s.feld.system && s.feld.schluessel === NAMENSFELD[objekt]) onOeffnen(z);
        break;
      }
      default:
        return;
    }
    e.preventDefault();
  }

  function beiBreitenGriff(e: KeyboardEvent, s: GitterSpalte) {
    if (e.altKey) return;
    const schritt = e.shiftKey ? 48 : 16;
    if (e.key === "ArrowRight") onBreite(s.feld.schluessel, s.breite + schritt);
    else if (e.key === "ArrowLeft") onBreite(s.feld.schluessel, s.breite - schritt);
    else return;
    e.preventDefault();
  }

  function ziehe(e: PointerEvent, s: GitterSpalte) {
    e.preventDefault();
    // Der Breitengriff liegt im ziehbaren Kopf: solange er gezogen wird, darf der Kopf keine Spaltenbewegung beginnen.
    breitenZug.current = true;
    const start = e.clientX;
    const ausgang = s.breite;
    const bewege = (ev: globalThis.PointerEvent) => onBreite(s.feld.schluessel, ausgang + ev.clientX - start);
    const ende = () => {
      breitenZug.current = false;
      window.removeEventListener("pointermove", bewege);
      window.removeEventListener("pointerup", ende);
    };
    window.addEventListener("pointermove", bewege);
    window.addEventListener("pointerup", ende);
  }

  const verschiebe = (c: number, nach: number, ansage: (name: string, nr: number, von: number) => string) => {
    const s = spalten[c];
    if (!onVerschieben || !s || c === 0) return;
    const ziel = Math.max(1, Math.min(spaltenAnzahl - 1, nach));
    if (ziel === c) return;
    setMeldung(ansage(feldName(s.feld, t), ziel + 1, spaltenAnzahl));
    onVerschieben(s.feld.schluessel, ziel);
  };

  function beiKopfTaste(e: KeyboardEvent, c: number) {
    if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const s = spalten[c];
    if (!s) return;
    fokusKopf.current = s.feld.schluessel;
    verschiebe(c, c + (e.key === "ArrowLeft" ? -1 : 1), t.crm.spalteVerschoben);
  }

  function beiKopfUeber(e: DragEvent, c: number) {
    if (!kopfZiehend) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setKopfZiel(Math.max(1, c + (e.clientX > rect.left + rect.width / 2 ? 1 : 0)));
  }

  function beiKopfAblegen(e: DragEvent) {
    e.preventDefault();
    const von = spalten.findIndex((s) => s.feld.schluessel === kopfZiehend);
    const ziel = kopfZiel;
    setKopfZiehend(null);
    setKopfZiel(null);
    if (von < 1 || ziel === null) return;
    verschiebe(von, ziel > von ? ziel - 1 : ziel, t.crm.spalteAbgelegt);
  }

  const alleGewaehlt = zeilen.length > 0 && zeilen.every((z) => auswahl.has(z.id));
  const sortRichtung = (schluessel: string) => sortierung.find((s) => s.feld === schluessel)?.richtung;

  return (
    <div className="app-gitter-aussen">
    <div
      ref={setzeWurzel}
      className="app-gitter"
      role="grid"
      aria-label={beschriftung}
      aria-rowcount={gesamt + 1}
      aria-colcount={spaltenAnzahl + 2}
      aria-multiselectable="true"
      onKeyDown={beiTaste}
      onScroll={messeKanten}
      data-kante-links={kanten.links || undefined}
      data-kante-rechts={kanten.rechts || undefined}
      style={{ height: KOPFHOEHE + Math.min(fensterHoehe, Math.max(ZEILENHOEHE * 2, zeilen.length * ZEILENHOEHE)) }}
    >
      <div className="app-gitter__scroll" style={{ minWidth: gesamtBreite }}>
        <div role="row" aria-rowindex={1} className="app-gitter__zeile app-gitter__kopf" style={{ gridTemplateColumns: vorlage, height: KOPFHOEHE }}>
          <div role="columnheader" className="app-gitter__auswahl app-gitter__links">
            <input
              type="checkbox"
              aria-label={t.crm.alleWaehlen}
              checked={alleGewaehlt}
              onChange={(e) => {
                // Nur die Zeilen dieser Tabelle ändern die Auswahl (bei gruppierten Tabellen gehören die anderen Gruppen dazu).
                const neu = new Set(auswahl);
                for (const z of zeilen) {
                  if (e.target.checked) neu.add(z.id);
                  else neu.delete(z.id);
                }
                onAuswahl(neu);
              }}
            />
          </div>
          {spalten.map((s, c) => {
            const richtung = sortRichtung(s.feld.schluessel);
            const ziehbar = Boolean(onVerschieben) && c > 0;
            const vonIndex = kopfZiehend ? spalten.findIndex((x) => x.feld.schluessel === kopfZiehend) : -1;
            // Einfügemarke nur, wenn sich die Reihenfolge dadurch ändern würde.
            const aendert = kopfZiel !== null && vonIndex > 0 && kopfZiel !== vonIndex && kopfZiel !== vonIndex + 1;
            const marke = aendert ? (kopfZiel === c ? "vor" : kopfZiel === c + 1 && c === spaltenAnzahl - 1 ? "nach" : undefined) : undefined;
            return (
              <div
                key={s.feld.schluessel}
                data-kopf={s.feld.schluessel}
                draggable={ziehbar || undefined}
                data-gezogen={kopfZiehend === s.feld.schluessel || undefined}
                data-einfuegen={marke}
                aria-keyshortcuts={ziehbar ? "Alt+ArrowLeft Alt+ArrowRight" : undefined}
                onKeyDown={(e) => beiKopfTaste(e, c)}
                onDragStart={(e) => {
                  if (!ziehbar || breitenZug.current) {
                    e.preventDefault();
                    return;
                  }
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", s.feld.schluessel);
                  setKopfZiehend(s.feld.schluessel);
                }}
                onDragOver={(e) => beiKopfUeber(e, c)}
                onDrop={beiKopfAblegen}
                onDragEnd={() => {
                  setKopfZiehend(null);
                  setKopfZiel(null);
                }}
                role="columnheader"
                aria-sort={richtung === "auf" ? "ascending" : richtung === "ab" ? "descending" : "none"}
                data-zahl={s.feld.typ === "zahl" || s.feld.typ === "betrag" || undefined}
                className={c === 0 ? "app-gitter__kopfzelle app-gitter__links app-gitter__erste" : "app-gitter__kopfzelle"}
              >
                {s.feld.sortierbar ? (
                  <button type="button" className="app-gitter__sortieren" onClick={() => onSortieren(s.feld.schluessel)}>
                    <span>{feldName(s.feld, t)}</span>
                    {richtung === "auf" ? <CaretUpIcon /> : richtung === "ab" ? <CaretDownIcon /> : null}
                  </button>
                ) : (
                  <span className="app-gitter__sortieren">{feldName(s.feld, t)}</span>
                )}
                <span
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t.crm.spaltenbreite(feldName(s.feld, t))}
                  aria-valuenow={s.breite}
                  aria-valuemin={80}
                  aria-valuemax={800}
                  tabIndex={0}
                  className="app-gitter__griff"
                  onPointerDown={(e) => ziehe(e, s)}
                  onKeyDown={(e) => beiBreitenGriff(e, s)}
                />
              </div>
            );
          })}
          <div role="columnheader" className="app-gitter__rechts">
            <span className="cw-nur-lesen">{t.crm.aktionen}</span>
          </div>
        </div>

        <div style={{ height: virtuell.getTotalSize(), position: "relative" }} role="rowgroup">
          {eintraege.map((v) => {
            const z = zeilen[v.index]!;
            const name = zeilenName(objekt, z);
            const gewaehlt = auswahl.has(z.id);
            return (
              <div
                key={z.id}
                role="row"
                aria-rowindex={v.index + 2}
                aria-selected={gewaehlt}
                className="app-gitter__zeile"
                data-gewaehlt={gewaehlt || undefined}
                style={{ gridTemplateColumns: vorlage, position: "absolute", top: 0, left: 0, width: "100%", height: ZEILENHOEHE, transform: `translateY(${v.start - KOPFHOEHE}px)` }}
              >
                <div role="gridcell" className="app-gitter__auswahl app-gitter__links">
                  <input
                    type="checkbox"
                    aria-label={t.crm.zeileWaehlen(name)}
                    checked={gewaehlt}
                    onChange={(e) => {
                      const neu = new Set(auswahl);
                      if (e.target.checked) neu.add(z.id);
                      else neu.delete(z.id);
                      onAuswahl(neu);
                    }}
                  />
                </div>
                {spalten.map((s, c) => {
                  const istAktiv = aktiv.zeile === v.index && aktiv.spalte === c;
                  const editiert = bearbeitet?.zeile === v.index && bearbeitet.spalte === c;
                  const bearbeitbar = istInlineBearbeitbar(s.feld) && darfSchreiben(z, s.feld);
                  return (
                    <div
                      key={s.feld.schluessel}
                      role="gridcell"
                      data-z={`${v.index}:${c}`}
                      tabIndex={istAktiv && !editiert ? 0 : -1}
                      aria-colindex={c + 2}
                      aria-readonly={!bearbeitbar || undefined}
                      className={c === 0 ? "app-gitter__zelle app-gitter__links app-gitter__erste" : "app-gitter__zelle"}
                      data-zahl={s.feld.typ === "zahl" || s.feld.typ === "betrag" || undefined}
                      data-aktiv={istAktiv || undefined}
                      onFocus={(e) => {
                        if (e.target === e.currentTarget && !istAktiv) setAktiv({ zeile: v.index, spalte: c });
                      }}
                      onDoubleClick={() => beginneBearbeiten(v.index, c)}
                    >
                      {editiert && (s.feld.typ === "benutzer" || s.feld.typ === "verknuepfung") ? (
                        <ZellenAuswahl
                          feld={s.feld}
                          beschriftung={`${feldName(s.feld, t)}: ${name}`}
                          anzeige={zellText(s.feld, z[s.feld.schluessel], bezuege, t, sprache)}
                          hatWert={z[s.feld.schluessel] !== null && z[s.feld.schluessel] !== undefined}
                          onFertig={(neu) => {
                            setBearbeitet(null);
                            setFokusNoetig(true);
                            if (neu !== undefined && neu !== (z[s.feld.schluessel] ?? null)) void onAendern(z, s.feld, neu).catch(() => {});
                          }}
                        />
                      ) : editiert ? (
                        <Editor
                          feld={s.feld}
                          wert={z[s.feld.schluessel]}
                          t={t}
                          beschriftung={`${feldName(s.feld, t)}: ${name}`}
                          onFertig={(neu) => {
                            setBearbeitet(null);
                            setFokusNoetig(true);
                            if (neu !== undefined && JSON.stringify(neu) !== JSON.stringify(z[s.feld.schluessel] ?? null)) void onAendern(z, s.feld, neu).catch(() => {});
                          }}
                        />
                      ) : (
                        <Anzeige objekt={objekt} feld={s.feld} wert={z[s.feld.schluessel]} zeileId={z.id} bezuege={bezuege} />
                      )}
                    </div>
                  );
                })}
                <div role="gridcell" className="app-gitter__aktionen app-gitter__rechts">
                  <Schnellaktionen raster werte={schnellWerte(objekt, z)} name={schnellName(objekt, z, bezuege)} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
      <div className="cw-nur-lesen" role="status" aria-live="assertive">
        {meldung}
      </div>
      <div className="app-gitter__fuss" aria-live="polite">
        {t.crm.zeilenVon(zeilen.length, gesamt)}
        {laedtMehr ? ` · ${t.gemeinsam.laedt}` : ""}
      </div>
    </div>
  );
}
