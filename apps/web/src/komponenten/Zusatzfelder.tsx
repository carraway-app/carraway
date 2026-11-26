import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Hinweis, PencilSimpleIcon, Textbereich, XIcon } from "@carraway/ui";
import { alsCrmFeld, useZusatzWerteSetzen, zusatzWerte, type PortfolioObjekt, type ZusatzFeld } from "../api/zusatzfelder";
import type { Feld } from "../api/crm";
import { useT } from "../i18n";
import { useRechte } from "../lib/rechte";
import { Anzeige, Editor, istInlineBearbeitbar, wertAusEingabe } from "./crm/Zelle";
import { BenutzerSuche, DatensatzSuche } from "./crm/Sucheingabe";
import { FelderDialog } from "./crm/FelderDialog";
import { FehlerHinweis } from "./FehlerHinweis";

/**
 * Eigene Felder eines Objekts des Portfolios (Etappe 21) als Liste aus Beschriftung und Wert, jedes Feld einzeln bearbeitbar, wo die Rolle es erlaubt.
 * Ohne `schreibbar` oder mit Wissensstand (`stand`) nur Anzeige; Vorgänge sind unveränderlich und zeigen nur ihre Werte. Globale Verwalter pflegen
 * die Felder selbst über „Felder verwalten“. Die Bausteine sind dieselben wie bei den Attributen im CRM (Anzeige, Editor).
 */
export function Zusatzfelder({ objekt, id, fondsId, stand, schreibbar = true, ohneKopf = false }: { objekt: PortfolioObjekt; id: string; fondsId: string; stand?: string | undefined; schreibbar?: boolean; ohneKopf?: boolean }) {
  const t = useT();
  const z = t.zusatzfelder;
  const { darf, ich } = useRechte();
  const abfrage = useQuery(zusatzWerte(objekt, id, stand));
  const setzen = useZusatzWerteSetzen(objekt, id);
  const [bearbeitet, setBearbeitet] = useState<string | null>(null);
  const [verwalten, setVerwalten] = useState(false);
  const darfSchreiben = schreibbar && objekt !== "vorgang" && !stand && darf("bearbeiter", fondsId);
  const istVerwalter = Boolean(ich?.globalVerwalter);

  if (abfrage.isPending) return <p aria-busy="true">{z.laedt}</p>;
  if (abfrage.isError) return <FehlerHinweis fehler={abfrage.error} />;
  const { felder, bezuege } = abfrage.data;

  const schreibe = (f: ZusatzFeld, wert: unknown) =>
    setzen.mutateAsync({ [f.id]: wert }).then(
      () => setBearbeitet(null),
      () => undefined,
    );

  return (
    <div className={ohneKopf ? "app-zusatzfelder" : "app-zusatzfelder app-karte"}>
      {ohneKopf ? null : (
        <div className="app-attribute__kopf">
          <h2 className="cw-t-untertitel">{z.titel}</h2>
          {istVerwalter && !stand ? (
            <Button variante="sekundaer" groesse="s" onClick={() => setVerwalten(true)}>
              {z.verwalten}
            </Button>
          ) : null}
        </div>
      )}
      {stand ? <Hinweis>{z.stand}</Hinweis> : null}
      {objekt === "vorgang" ? <p className="app-leer-text">{z.vorgangHinweis}</p> : null}
      <FehlerHinweis fehler={setzen.error} />
      {felder.length === 0 ? (
        <p className="app-leer-text">{istVerwalter ? z.leerVerwalter : z.leer}</p>
      ) : (
        <dl className="app-attribute__liste">
          {felder.map((zf) => {
            const f: Feld = alsCrmFeld(zf, darfSchreiben && !zf.archiviert);
            const wert = zf.wert;
            const bearbeitbar = f.schreibbar && (istInlineBearbeitbar(f) || f.typ === "langtext");
            const imEditor = bearbeitet === zf.id;
            return (
              <div key={zf.id} className="app-attribute__zeile">
                <dt>
                  {zf.name}
                  {zf.archiviert ? ` (${z.archiviert})` : ""}
                </dt>
                <dd>
                  {imEditor ? (
                    f.typ === "langtext" ? (
                      <LangtextEditor wert={typeof wert === "string" ? wert : ""} beschriftung={zf.name} onFertig={(neu) => (neu === undefined ? setBearbeitet(null) : void schreibe(zf, neu))} />
                    ) : f.typ === "verknuepfung" ? (
                      <div className="app-gruppe">
                        <DatensatzSuche ziel={f.ziel ?? "organisation"} onWaehlen={(x) => void schreibe(zf, x.id)} onAbbrechen={() => setBearbeitet(null)} />
                        <Button variante="ruhig" onClick={() => setBearbeitet(null)}>
                          {t.crm.abbrechen}
                        </Button>
                      </div>
                    ) : f.typ === "benutzer" ? (
                      <div className="app-gruppe">
                        <BenutzerSuche onWaehlen={(x) => void schreibe(zf, x.id)} onAbbrechen={() => setBearbeitet(null)} />
                        <Button variante="ruhig" onClick={() => setBearbeitet(null)}>
                          {t.crm.abbrechen}
                        </Button>
                      </div>
                    ) : (
                      <Editor feld={f} wert={wert} t={t} beschriftung={zf.name} onFertig={(neu) => (neu === undefined ? setBearbeitet(null) : void schreibe(zf, neu))} />
                    )
                  ) : (
                    <span className="app-attribute__wert">
                      <Anzeige objekt="organisation" feld={f} wert={wert} zeileId={id} bezuege={bezuege} />
                      {bearbeitbar || (f.schreibbar && (f.typ === "verknuepfung" || f.typ === "benutzer")) ? (
                        <button
                          type="button"
                          className="app-attribute__bearbeiten"
                          aria-label={z.bearbeiten(zf.name)}
                          onClick={() => {
                            if (f.typ === "kontrollkaestchen") void schreibe(zf, wert === true ? false : true);
                            else setBearbeitet(zf.id);
                          }}
                        >
                          <PencilSimpleIcon />
                        </button>
                      ) : null}
                      {f.schreibbar && wert !== null && wert !== undefined && wert !== "" ? (
                        <button type="button" className="app-attribute__bearbeiten app-attribute__bearbeiten--zweit" aria-label={z.leeren(zf.name)} onClick={() => void schreibe(zf, null)}>
                          <XIcon />
                        </button>
                      ) : null}
                    </span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {verwalten ? <FelderDialog objekt={objekt} onSchliessen={() => setVerwalten(false)} /> : null}
    </div>
  );
}

function LangtextEditor({ wert, beschriftung, onFertig }: { wert: string; beschriftung: string; onFertig: (neu: string | null | undefined) => void }) {
  const t = useT();
  const [text, setText] = useState(wert);
  return (
    <div className="app-gruppe">
      <Textbereich label={beschriftung} value={text} rows={4} onChange={(e) => setText(e.target.value)} />
      <div className="app-fed__fuss">
        <Button onClick={() => onFertig(wertAusEingabe({ typ: "langtext" } as Feld, text) as string | null)}>{t.crm.speichern}</Button>
        <Button variante="sekundaer" onClick={() => onFertig(undefined)}>
          {t.crm.abbrechen}
        </Button>
      </div>
    </div>
  );
}
