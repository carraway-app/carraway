import "../../crm.css";
import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { Button, DotsSixVerticalIcon, PlusIcon, formatBetrag } from "@carraway/ui";
import type { BoardSpalte, Objekt, Option, Zeile } from "../../api/crm";
import { Datensatzlink } from "./Datensatzlink";
import { useSprache, useT } from "../../i18n";

export interface BoardProps {
  /** Spalten in der Reihenfolge der Optionen (Phasen); `null` ist die Spalte ohne Wert. */
  optionen: Option[];
  spalten: BoardSpalte[];
  bezuege: Record<string, string | null>;
  beschriftung: string;
  /** Unterscheidet gleichnamige Spalten bei mehreren nebeneinander lesbaren Boards. */
  spaltenZusatz?: string;
  /** Darf die Karte verschoben werden (Schreibrecht am Fonds, Deal offen)? */
  darfVerschieben: (karte: Zeile) => boolean;
  /** Verschiebt; ein Fehler (zum Beispiel fehlender Beschluss) wird vom Aufrufer gezeigt, die Karte bleibt dann in der alten Spalte. */
  onVerschieben: (karte: Zeile, nachWert: string) => Promise<unknown>;
  /** Schnellanlage in einer Spalte (nur wenn angeboten). */
  onNeu?: (wert: string) => void;
  /** Spalten ohne Schnellanlage (zum Beispiel das Closing, das einen Beschluss verlangt). */
  ohneNeu?: string[];
  /** Inhalt der Karte unter dem Namen. */
  karte: (z: Zeile, bezuege: Record<string, string | null>) => ReactNode;
  /** Titel der Karte, wenn der Name verlinkt ist. */
  kartenTitel: (z: Zeile, bezuege: Record<string, string | null>) => { text: string; id: string };
  /** Ob der Name der Spalte mit dem Anzahl-Zähler zugleich die Summe zeigt (Betrag in Euro). */
  summe: boolean;
  /** Objekt der Karten (Standard Deal): bestimmt das Ziel des Links am Namen. */
  objekt?: Objekt;
  /** Beschriftungen für Boards mit anderen Karten als Deals (Anzahl in der Spalte, „keine Karten“, „ohne Wert“, Schnellanlage). */
  texte?: { anzahl: (n: number) => string; leer: string; ohneWert: string; neu: (spalte: string) => string; neuKurz: string };
}

/**
 * Board (Kanban) nach einem Auswahlfeld. Karten lassen sich ziehen (Maus, Touch) und per Tastatur verschieben: Der Griff der Karte nimmt sie
 * mit Eingabe oder Leertaste auf, Pfeiltasten links und rechts wählen die Spalte, Eingabe legt ab, Escape bricht ab. Jede Aufnahme, Auswahl
 * und Ablage wird in einer Statusmeldung angesagt. Spalten zeigen Anzahl (Umlauf je Phase) und Summe.
 */
export function Board({ optionen, spalten, bezuege, beschriftung, spaltenZusatz, darfVerschieben, onVerschieben, onNeu, ohneNeu = [], karte, kartenTitel, summe, objekt = "deal", texte }: BoardProps) {
  const t = useT();
  const txt = texte ?? { anzahl: t.crm.boardAnzahl, leer: t.crm.boardLeer, ohneWert: t.crm.ohneWert, neu: t.crm.boardNeu, neuKurz: t.crm.boardNeuKurz };
  const sprache = useSprache();
  const boardId = useId();
  const SpaltenTitel = spaltenZusatz ? "h3" : "h2";
  const KartenTitel = spaltenZusatz ? "h4" : "h3";
  const [meldung, setMeldung] = useState("");
  const [aufgenommen, setAufgenommen] = useState<{ id: string; von: number; ziel: number; name: string } | null>(null);
  const [ziehend, setZiehend] = useState<{ id: string; von: string | null } | null>(null);
  const [darueber, setDarueber] = useState<string | null>(null);
  const [fokusId, setFokusId] = useState<string | null>(null);
  const wurzel = useRef<HTMLDivElement>(null);

  const reihe = optionen.map((o) => o.schluessel);
  const dazu = new Map(spalten.map((s) => [s.wert, s]));
  const ohneWert = dazu.get(null);
  const alle: { wert: string | null; name: string; spalte: BoardSpalte | undefined }[] = [
    ...optionen.map((o) => ({ wert: o.schluessel as string | null, name: o.label, spalte: dazu.get(o.schluessel) })),
    ...(ohneWert && ohneWert.anzahl > 0 ? [{ wert: null, name: txt.ohneWert, spalte: ohneWert }] : []),
  ];

  // Nach dem Ablegen steht die Karte in einer anderen Spalte; der Fokus kehrt auf ihren Griff zurück.
  useEffect(() => {
    if (!fokusId) return;
    const ziel = wurzel.current?.querySelector<HTMLElement>(`[data-griff="${fokusId}"]`);
    if (ziel) {
      ziel.focus();
      setFokusId(null);
    }
  }, [fokusId, spalten]);

  const spaltenName = (i: number) => optionen[i]?.label ?? "";

  async function lege(kartenZeile: Zeile, name: string, nachWert: string) {
    const label = optionen.find((o) => o.schluessel === nachWert)?.label ?? nachWert;
    try {
      await onVerschieben(kartenZeile, nachWert);
      setMeldung(t.crm.boardAbgelegt(name, label));
    } catch {
      setMeldung(t.crm.boardNichtVerschoben(name));
    }
  }

  function beiGriffTaste(e: KeyboardEvent, z: Zeile, wert: string | null) {
    const { text: name } = kartenTitel(z, bezuege);
    const von = reihe.indexOf(wert ?? "");
    if (!aufgenommen) {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setAufgenommen({ id: z.id, von, ziel: von, name });
        setMeldung(t.crm.boardAufgenommen(name, spaltenName(von), von + 1, reihe.length));
      }
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const ziel = Math.max(0, Math.min(reihe.length - 1, aufgenommen.ziel + (e.key === "ArrowRight" ? 1 : -1)));
      setAufgenommen({ ...aufgenommen, ziel });
      setMeldung(t.crm.boardZiel(spaltenName(ziel), ziel + 1, reihe.length));
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      const { ziel } = aufgenommen;
      setAufgenommen(null);
      if (ziel === von) setMeldung(t.crm.boardUnveraendert(name, spaltenName(von)));
      else {
        setFokusId(z.id);
        void lege(z, name, reihe[ziel]!);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setAufgenommen(null);
      setMeldung(t.crm.boardAbgebrochen(name));
    }
  }

  function beiAblegen(e: DragEvent, wert: string | null) {
    e.preventDefault();
    setDarueber(null);
    const id = ziehend?.id ?? e.dataTransfer.getData("application/x-carraway-karte");
    const quelle = spalten.flatMap((s) => s.karten).find((k) => k.id === id);
    setZiehend(null);
    if (!quelle || !darfVerschieben(quelle) || wert === null) return;
    const von = spalten.find((s) => s.karten.some((k) => k.id === id))?.wert ?? null;
    if (von === wert) return;
    setFokusId(quelle.id);
    void lege(quelle, kartenTitel(quelle, bezuege).text, wert);
  }

  return (
    <div ref={wurzel} className="app-board" role="region" aria-label={beschriftung} tabIndex={0}>
      <div className="cw-nur-lesen" role="status" aria-live="assertive">
        {meldung}
      </div>
      {alle.map(({ wert, name, spalte }, index) => {
        const id = `${boardId}-spalte-${wert ?? "leer"}`;
        const anzahl = spalte?.anzahl ?? 0;
        const istZiel = wert !== null && (aufgenommen?.ziel === index || darueber === wert);
        return (
          <section
            key={wert ?? "leer"}
            className="app-board__spalte"
            aria-labelledby={id}
            data-ziel={istZiel || undefined}
            onDragOver={(e) => {
              if (ziehend && wert !== null) {
                e.preventDefault();
                setDarueber(wert);
              }
            }}
            onDragLeave={() => setDarueber((alt) => (alt === wert ? null : alt))}
            onDrop={(e) => beiAblegen(e, wert)}
          >
            <SpaltenTitel id={id} className="app-board__titel">
              <span>{name}</span>
              <span className="app-board__anzahl" aria-label={txt.anzahl(anzahl)}>
                {anzahl}
              </span>
              {spaltenZusatz ? <span className="cw-nur-lesen">{spaltenZusatz}</span> : null}
            </SpaltenTitel>
            {summe ? <p className="app-board__summe app-zahl">{formatBetrag(spalte?.summe ?? "0", sprache)}</p> : null}
            {onNeu && wert !== null && !ohneNeu.includes(wert) ? (
              <Button className="app-board__neu" variante="ruhig" icon={<PlusIcon />} aria-label={txt.neu(name)} onClick={() => onNeu(wert)}>
                {txt.neuKurz}
              </Button>
            ) : onNeu ? <div className="app-board__anlage-platz" aria-hidden="true" /> : null}
            {anzahl === 0 ? (
              <p className="app-board__leer">{txt.leer}</p>
            ) : (
              <ul className="app-board__liste">
                {(spalte?.karten ?? []).map((z) => {
                  const titel = kartenTitel(z, bezuege);
                  const verschiebbar = darfVerschieben(z);
                  const inBewegung = aufgenommen?.id === z.id;
                  return (
                    <li key={z.id}>
                      <article
                        className="app-deal"
                        draggable={verschiebbar}
                        data-bewegt={inBewegung || ziehend?.id === z.id || undefined}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("application/x-carraway-karte", z.id);
                          e.dataTransfer.effectAllowed = "move";
                          setZiehend({ id: z.id, von: wert });
                        }}
                        onDragEnd={() => {
                          setZiehend(null);
                          setDarueber(null);
                        }}
                      >
                        <div className="app-deal__kopf">
                          <KartenTitel className="app-deal__name">
                            <Datensatzlink objekt={objekt} id={titel.id} draggable={false}>
                              {titel.text}
                            </Datensatzlink>
                          </KartenTitel>
                          {verschiebbar ? (
                            <button
                              type="button"
                              className="app-deal__griff"
                              data-griff={z.id}
                              aria-label={t.crm.boardVerschieben(titel.text)}
                              aria-pressed={inBewegung}
                              onKeyDown={(e) => beiGriffTaste(e, z, wert)}
                              onBlur={() => inBewegung && setAufgenommen(null)}
                            >
                              <DotsSixVerticalIcon />
                            </button>
                          ) : null}
                        </div>
                        {karte(z, bezuege)}
                      </article>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
