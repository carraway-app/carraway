import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { DotsSixVerticalIcon } from "../icons";

export interface SortierbareListeTexte {
  /** Beschriftung des Ziehgriffs einer Zeile, z. B. „Verschieben: Ort“. */
  griff: (name: string) => string;
  /** Kurzer Bedienhinweis für Screenreader (Leertaste nimmt auf, Pfeiltasten verschieben, Leertaste legt ab, Escape bricht ab). */
  hinweis: string;
  aufgenommen: (name: string, nr: number, von: number) => string;
  verschoben: (name: string, nr: number, von: number) => string;
  abgelegt: (name: string, nr: number, von: number) => string;
  abgebrochen: (name: string) => string;
}

export interface SortierbareListeProps<T> {
  eintraege: readonly T[];
  /** Stabile Kennung eines Eintrags. */
  schluessel: (eintrag: T) => string;
  /** Name für Griff und Ansagen. */
  name: (eintrag: T) => string;
  /** Inhalt der Zeile neben dem Griff. */
  zeile: (eintrag: T) => ReactNode;
  /** Neue Reihenfolge, erst beim Ablegen (nicht bei jedem Schritt der Tastatur). */
  onAendern: (neu: T[]) => void;
  texte: SortierbareListeTexte;
  "aria-label"?: string;
  className?: string;
}

const verschiebeIn = <T,>(liste: readonly T[], von: number, nach: number): T[] => {
  const neu = [...liste];
  const [e] = neu.splice(von, 1);
  neu.splice(Math.max(0, Math.min(neu.length, nach)), 0, e!);
  return neu;
};

/**
 * Sortierbare Liste mit Ziehgriff. Maus: natives Drag and Drop am Griff (Einfügelinie an der Zielposition, ohne Bibliothek);
 * Tastatur: Griff fokussieren, Leertaste nimmt auf, Pfeiltasten (auch Pos1 und Ende) verschieben, Leertaste legt ab, Escape bricht ab.
 * Jeder Schritt wird in einer Live-Region angesagt. Die Zeile bestimmt der Aufrufer; die Liste meldet die neue Reihenfolge erst beim Ablegen.
 */
export function SortierbareListe<T>({ eintraege, schluessel, name, zeile, onAendern, texte, className, ...rest }: SortierbareListeProps<T>) {
  const hinweisId = useId();
  // Während die Tastatur eine Zeile bewegt, gilt `vorlaeufig`; erst das Ablegen meldet die Reihenfolge nach außen.
  const [aufgenommen, setAufgenommen] = useState<{ id: string; vorlaeufig: T[] } | null>(null);
  const [ziehend, setZiehend] = useState<string | null>(null);
  const [einfuegen, setEinfuegen] = useState<number | null>(null);
  const [meldung, setMeldung] = useState("");
  const griffe = useRef(new Map<string, HTMLButtonElement>());
  const zeilen = useRef(new Map<string, HTMLLIElement>());
  const anzeige = aufgenommen?.vorlaeufig ?? eintraege;
  const indexVon = (liste: readonly T[], id: string) => liste.findIndex((e) => schluessel(e) === id);

  // Der Griff behält den Fokus, wenn die Zeile wandert (React setzt den Knoten um, manche Browser verlieren dabei den Fokus).
  useEffect(() => {
    if (!aufgenommen) return;
    const griff = griffe.current.get(aufgenommen.id);
    if (griff && document.activeElement !== griff) griff.focus();
  }, [aufgenommen]);

  const sage = (id: string, liste: readonly T[], fn: (name: string, nr: number, von: number) => string) => {
    const i = indexVon(liste, id);
    const e = liste[i];
    if (e) setMeldung(fn(name(e), i + 1, liste.length));
  };

  function brichAb() {
    if (!aufgenommen) return;
    const e = eintraege.find((x) => schluessel(x) === aufgenommen.id);
    if (e) setMeldung(texte.abgebrochen(name(e)));
    setAufgenommen(null);
  }

  function beiGriffTaste(e: KeyboardEvent, id: string) {
    if (!aufgenommen) {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setAufgenommen({ id, vorlaeufig: [...eintraege] });
        sage(id, eintraege, texte.aufgenommen);
      }
      return;
    }
    const liste = aufgenommen.vorlaeufig;
    const i = indexVon(liste, aufgenommen.id);
    let ziel = -1;
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") ziel = Math.max(0, i - 1);
    else if (e.key === "ArrowDown" || e.key === "ArrowRight") ziel = Math.min(liste.length - 1, i + 1);
    else if (e.key === "Home") ziel = 0;
    else if (e.key === "End") ziel = liste.length - 1;
    if (ziel >= 0) {
      e.preventDefault();
      if (ziel === i) return;
      const neu = verschiebeIn(liste, i, ziel);
      setAufgenommen({ id: aufgenommen.id, vorlaeufig: neu });
      sage(aufgenommen.id, neu, texte.verschoben);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      sage(aufgenommen.id, liste, texte.abgelegt);
      if (liste.some((x, k) => schluessel(x) !== schluessel(eintraege[k]!))) onAendern(liste);
      setAufgenommen(null);
    } else if (e.key === "Escape") {
      // Ein Dialog darüber schließt bei Escape nur, wenn niemand die Taste schon verbraucht hat.
      e.preventDefault();
      brichAb();
    }
  }

  function beiUeber(e: DragEvent, i: number) {
    if (!ziehend) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    setEinfuegen(i + (e.clientY > rect.top + rect.height / 2 ? 1 : 0));
  }

  function beiAblegen(e: DragEvent) {
    e.preventDefault();
    const von = ziehend ? indexVon(eintraege, ziehend) : -1;
    const ziel = einfuegen;
    setZiehend(null);
    setEinfuegen(null);
    if (von < 0 || ziel === null) return;
    const nach = ziel > von ? ziel - 1 : ziel;
    if (nach === von) return;
    setMeldung(texte.abgelegt(name(eintraege[von]!), nach + 1, eintraege.length));
    onAendern(verschiebeIn(eintraege, von, nach));
  }

  // Eine Einfügelinie an der alten Stelle (direkt vor oder hinter der gezogenen Zeile) wäre irreführend.
  const vonIndex = ziehend ? indexVon(eintraege, ziehend) : -1;
  const linie = einfuegen !== null && vonIndex >= 0 && einfuegen !== vonIndex && einfuegen !== vonIndex + 1 ? einfuegen : null;

  return (
    <>
      <ul
        className={["cw-sortierbar", className].filter(Boolean).join(" ")}
        aria-label={rest["aria-label"]}
        onDragOver={(e) => {
          if (ziehend) e.preventDefault();
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEinfuegen(null);
        }}
        onDrop={beiAblegen}
      >
        {anzeige.map((eintrag, i) => {
          const id = schluessel(eintrag);
          const n = name(eintrag);
          return (
            <li
              key={id}
              ref={(el) => {
                if (el) zeilen.current.set(id, el);
                else zeilen.current.delete(id);
              }}
              className="cw-sortierbar__zeile"
              data-gezogen={ziehend === id || undefined}
              data-aufgenommen={aufgenommen?.id === id || undefined}
              data-einfuegen={linie === i ? "vor" : linie === i + 1 && i === anzeige.length - 1 ? "nach" : undefined}
              onDragOver={(e) => beiUeber(e, i)}
            >
              <button
                type="button"
                ref={(el) => {
                  if (el) griffe.current.set(id, el);
                  else griffe.current.delete(id);
                }}
                className="cw-sortierbar__griff"
                draggable
                aria-label={texte.griff(n)}
                aria-describedby={hinweisId}
                aria-pressed={aufgenommen?.id === id}
                onKeyDown={(e) => beiGriffTaste(e, id)}
                onBlur={() => {
                  if (aufgenommen?.id === id) brichAb();
                }}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", id);
                  const li = zeilen.current.get(id);
                  if (li && e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(li, 16, li.offsetHeight / 2);
                  setZiehend(id);
                }}
                onDragEnd={() => {
                  setZiehend(null);
                  setEinfuegen(null);
                }}
              >
                <DotsSixVerticalIcon />
              </button>
              <div className="cw-sortierbar__inhalt">{zeile(eintrag)}</div>
            </li>
          );
        })}
      </ul>
      <span id={hinweisId} className="cw-nur-lesen">
        {texte.hinweis}
      </span>
      <div className="cw-nur-lesen" role="status" aria-live="assertive">
        {meldung}
      </div>
    </>
  );
}
