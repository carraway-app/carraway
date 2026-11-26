import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { crmBoard, type AbfrageEingabe, type Feld, type Objekt, type Zeile } from "../../api/crm";
import { useSprache, useT } from "../../i18n";
import { FehlerHinweis } from "../FehlerHinweis";
import { Board } from "./Board";
import type { GitterSpalte } from "./Datengitter";
import { NAMENSFELD, feldName, optionenVon, zellText } from "./typen";
import { Schnellaktionen } from "./Zelle";

interface Props {
  objekt: Objekt;
  basis: AbfrageEingabe;
  /** Das Auswahlfeld, nach dem die Spalten gebildet werden (Feld des Datensatzes oder der Liste). */
  feld: Feld;
  spalten: GitterSpalte[];
  /** Darf die Karte in eine andere Spalte? */
  darfVerschieben: (karte: Zeile) => boolean;
  /** Schreibt den neuen Wert des Feldes; ein Fehler wird vom Aufrufer angezeigt, die Karte bleibt dann stehen. */
  onVerschieben: (karte: Zeile, wert: string) => Promise<unknown>;
  beschriftung: string;
}

/**
 * Kanban nach einem eigenen Auswahlfeld (zum Beispiel die Stufe einer Liste): eine Spalte je Option mit Anzahl und, wenn die Ansicht ein Betragsfeld zeigt, der Summe;
 * Karten ziehen oder mit Tastatur verschieben schreibt den Wert des Feldes. Auf den Karten stehen Name, die übrigen Spalten der Ansicht und die Schnellaktionen.
 */
export function KontaktBoard({ objekt, basis, feld, spalten, darfVerschieben, onVerschieben, beschriftung }: Props) {
  const t = useT();
  const sprache = useSprache();
  const name = NAMENSFELD[objekt];
  const summenFeld = spalten.map((s) => s.feld).find((f) => f.typ === "betrag" && f.schluessel !== feld.schluessel);
  const kartenFelder = spalten.map((s) => s.feld).filter((f) => f.schluessel !== name && f.schluessel !== feld.schluessel).slice(0, 4);
  const abfrage = useQuery(crmBoard(objekt, basis, feld.schluessel, summenFeld?.schluessel ?? null));
  if (abfrage.isError) return <FehlerHinweis fehler={abfrage.error} />;
  if (!abfrage.data) {
    return (
      <div aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="app-skelett app-skelett--zeile" />
        ))}
      </div>
    );
  }
  const keinWert = t.gemeinsam.keinWert;
  return (
    <Board
      objekt={objekt}
      optionen={optionenVon(feld, t)}
      spalten={abfrage.data.spalten}
      bezuege={abfrage.data.bezuege}
      beschriftung={beschriftung}
      summe={Boolean(summenFeld)}
      darfVerschieben={darfVerschieben}
      onVerschieben={onVerschieben}
      texte={{ anzahl: t.crm.boardEintraege, leer: t.crm.boardKeineEintraege, ohneWert: t.crm.gruppeOhneWert, neu: t.crm.boardNeu, neuKurz: t.crm.boardNeuKurz }}
      kartenTitel={(k) => ({ text: String(k[name] ?? ""), id: k.id })}
      karte={(k, bezuege) => (
        <>
          {kartenFelder.length ? (
            <dl className="app-deal__daten">
              {kartenFelder.map((f) => (
                <Fragment key={f.schluessel}>
                  <dt>{feldName(f, t)}</dt>
                  <dd>{zellText(f, k[f.schluessel], bezuege, t, sprache) || keinWert}</dd>
                </Fragment>
              ))}
            </dl>
          ) : null}
          <Schnellaktionen werte={k} name={String(k[name] ?? "")} />
        </>
      )}
    />
  );
}
