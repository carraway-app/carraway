import "../../crm.css";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { crmKarte, type Kurzkarte, type Objekt } from "../../api/crm";
import { aufzaehlung, useT } from "../../i18n";
import { Schnellaktionen } from "./Zelle";

interface Props {
  objekt: Objekt;
  id: string;
  anker: RefObject<HTMLElement | null>;
  /** Kennung des Textteils; der Verweis nennt sie in `aria-describedby`. */
  karteId: string;
  /** Meldet, ob der Zeiger auf der Karte steht (sie bleibt dann offen, damit sich die Aktionen anklicken lassen). */
  onZeiger: (drin: boolean) => void;
}

const BREITE = 280;
const ABSTAND = 4;

/**
 * Kleine Karte zu einem Verweis: Name, Unternehmen, Mail, Telefon und die Schnellaktionen des Datensatzes. Geladen wird erst beim Öffnen (Abfrage im Zwischenspeicher);
 * die Karte hängt im Dokument, damit scrollende Tabellen sie nicht abschneiden, und folgt dem Verweis. Sie nimmt keinen Fokus und ist nur Beschreibung des Verweises.
 */
export default function Vorschaukarte({ objekt, id, anker, karteId, onZeiger }: Props) {
  const t = useT();
  const abfrage = useQuery(crmKarte(objekt, id));
  const flaeche = useRef<HTMLDivElement>(null);
  const [lage, setLage] = useState<{ top: number; left: number } | null>(null);

  // Unter dem Verweis, bei zu wenig Platz darüber; folgt dem Verweis beim Scrollen. Neu messen, sobald sich die Höhe der Karte ändert (Daten da).
  useLayoutEffect(() => {
    const messe = () => {
      const r = anker.current?.getBoundingClientRect();
      if (!r) return;
      const hoehe = flaeche.current?.offsetHeight ?? 0;
      const unten = r.bottom + ABSTAND;
      const top = unten + hoehe > window.innerHeight - 8 && r.top - ABSTAND - hoehe >= 8 ? r.top - ABSTAND - hoehe : unten;
      setLage({ top, left: Math.max(8, Math.min(r.left, window.innerWidth - BREITE - 8)) });
    };
    messe();
    window.addEventListener("resize", messe);
    window.addEventListener("scroll", messe, true);
    return () => {
      window.removeEventListener("resize", messe);
      window.removeEventListener("scroll", messe, true);
    };
  }, [anker, abfrage.status]);

  return createPortal(
    <div
      ref={flaeche}
      className="app-vorschau"
      data-bereit={lage !== null}
      style={lage ? { top: lage.top, left: lage.left } : { top: 0, left: 0 }}
      onPointerEnter={() => onZeiger(true)}
      onPointerLeave={() => onZeiger(false)}
    >
      {abfrage.data ? (
        <Inhalt karte={abfrage.data} karteId={karteId} />
      ) : (
        <p id={karteId} className="app-dubletten__info app-vorschau__leer" role="status">
          {abfrage.isError ? t.crm.vorschauNichtVerfuegbar : t.crm.vorschauLaedt}
        </p>
      )}
    </div>,
    document.body,
  );
}

function Inhalt({ karte, karteId }: { karte: Kurzkarte; karteId: string }) {
  const t = useT();
  const art = karte.art ? aufzaehlung(t.organisationArt, karte.art) : null;
  const phase = karte.phase ? aufzaehlung(t.dealPhase, karte.phase) : null;
  const zeilen = [
    art,
    karte.funktion,
    phase,
    karte.firma?.name ?? null,
    karte.email,
    karte.telefon,
  ].filter((z): z is string => Boolean(z));
  return (
    <>
      <div id={karteId} className="app-vorschau__text">
        <span className="app-vorschau__name">{karte.name}</span>
        {zeilen.map((z, i) => (
          <span key={i} className="app-vorschau__zeile">
            {z}
          </span>
        ))}
      </div>
      <Schnellaktionen werte={{ ...karte }} name={karte.name} />
    </>
  );
}
