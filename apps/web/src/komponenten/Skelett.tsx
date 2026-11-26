import { useT } from "../i18n";

/** Platzhalter in der Größe der echten Seite, damit beim Laden nichts springt. */
export function Seitenskelett({ kacheln = 0, zeilen = 6 }: { kacheln?: number; zeilen?: number }) {
  const t = useT();
  return (
    <div className="app-seite" aria-busy="true">
      <span className="cw-nur-lesen" role="status">
        {t.gemeinsam.laedt}
      </span>
      <div className="app-skelett app-skelett--kopf" aria-hidden="true" />
      {kacheln > 0 ? (
        <div className="app-kennzahlen" aria-hidden="true">
          {Array.from({ length: kacheln }, (_, i) => (
            <div key={i} className="app-skelett app-skelett--kachel" />
          ))}
        </div>
      ) : null}
      <div className="app-karte" aria-hidden="true">
        {Array.from({ length: zeilen }, (_, i) => (
          <div key={i} className="app-skelett app-skelett--zeile" />
        ))}
      </div>
    </div>
  );
}

/** Einige Platzhalterzeilen innerhalb einer Kachel, solange Daten eines Abschnitts laden. */
export function Skelettzeilen({ anzahl = 3 }: { anzahl?: number }) {
  const t = useT();
  return (
    <div aria-busy="true">
      <span className="cw-nur-lesen" role="status">
        {t.gemeinsam.laedt}
      </span>
      {Array.from({ length: anzahl }, (_, i) => (
        <div key={i} className="app-skelett app-skelett--zeile" aria-hidden="true" />
      ))}
    </div>
  );
}
