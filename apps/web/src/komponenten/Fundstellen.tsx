import { Link } from "@tanstack/react-router";
import { Karte } from "@carraway/ui";
import type { BeteiligungDetail } from "../api/abfragen";
import { useT } from "../i18n";

type Liste = BeteiligungDetail["fundstellen"];

/** Quellen für die Herkunftsansicht eines Werts: ein Link je Dokument und Seite („Aus Dokument X, Seite 3“) zum Betrachter an dieser Seite. */
export function fundstellenLinks(fundstellen: Liste | undefined, objektTyp: string, beschriftung: (name: string, seite: number) => string) {
  const gesehen = new Set<string>();
  return (fundstellen ?? [])
    .filter((f) => f.objektTyp === objektTyp)
    .flatMap((f) => {
      const href = `/dokumente/${f.dokumentId}?seite=${f.seite}`;
      if (gesehen.has(href)) return [];
      gesehen.add(href);
      return [{ label: beschriftung(f.dateiname, f.seite), href }];
    });
}

/** Alle Werte der Beteiligung (Bewertung, Konditionen, Runde, Vertragswerte), zu denen es ein Quelldokument gibt, mit Link auf die Seite. */
export function Fundstellen({ fundstellen }: { fundstellen: Liste | undefined }) {
  const t = useT();
  const d = t.dokumente;
  if (!fundstellen || fundstellen.length === 0) return null;
  return (
    <Karte titel={d.fundstelle.titel} breit>
      <ul className="app-liste-klein">
        {fundstellen.map((f, i) => (
          <li key={`${f.objektId}${f.feld}${i}`}>
            {f.feld}: <span className="app-zahl">{f.wert}</span> ·{" "}
            <Link to="/dokumente/$id" params={{ id: f.dokumentId }} search={{ seite: f.seite }}>
              {d.fundstelle.aus(f.dateiname, f.seite)}
            </Link>
            {f.zitatQuelle === "ocr" ? <span className="app-leer-text"> ({d.fundstelle.ocr})</span> : null}
          </li>
        ))}
      </ul>
    </Karte>
  );
}
