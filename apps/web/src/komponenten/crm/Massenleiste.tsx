import { useState } from "react";
import { Auswahl, Button, Dialog, Feld as Eingabe } from "@carraway/ui";
import type { Feld, Liste, Massenaktion, MassenErgebnis, Objekt } from "../../api/crm";
import { useT } from "../../i18n";
import { PHASEN, feldName, optionenVon } from "./typen";
import { normalisiereZahl } from "./Zelle";

type Offen = null | "liste" | "feld" | "phase" | "archivieren" | "entfernen";

interface Props {
  objekt: Objekt;
  anzahl: number;
  felder: Feld[];
  listen: Liste[];
  /** Die Ansicht zeigt eine Liste: Einträge lassen sich daraus entfernen. */
  inListe: boolean;
  darfSchreiben: boolean;
  laeuft: boolean;
  ergebnis: MassenErgebnis | null;
  onAktion: (aktion: Massenaktion) => Promise<unknown>;
  onEntfernen: () => Promise<unknown>;
  onLeeren: () => void;
}

/** Leiste für Sammelaktionen auf den gewählten Zeilen: zur Liste hinzufügen, Feld setzen, Phase ändern, archivieren (mit Bestätigung). */
export function Massenleiste({ objekt, anzahl, felder, listen, inListe, darfSchreiben, laeuft, ergebnis, onAktion, onEntfernen, onLeeren }: Props) {
  const t = useT();
  const [offen, setOffen] = useState<Offen>(null);
  const [listeId, setListeId] = useState("");
  const [feldKey, setFeldKey] = useState("");
  const [wert, setWert] = useState("");
  const [phase, setPhase] = useState<(typeof PHASEN)[number]>("erstgespraech");
  const setzbar = felder.filter((f) => f.schreibbar && ["text", "zahl", "betrag", "datum", "auswahl", "kontrollkaestchen", "url", "email", "telefon"].includes(f.typ));
  const feld = setzbar.find((f) => f.schluessel === feldKey) ?? setzbar[0];
  const schliesse = () => setOffen(null);

  const wertFuerApi = (f: Feld): unknown => {
    if (f.typ === "kontrollkaestchen") return wert === "ja";
    if (wert.trim() === "") return null;
    return f.typ === "zahl" || f.typ === "betrag" ? normalisiereZahl(wert) : wert.trim();
  };

  return (
    <div className="app-massen" role="region" aria-label={t.crm.massenaktionen}>
      <span className="app-massen__anzahl">{t.crm.ausgewaehlt(anzahl)}</span>
      {darfSchreiben ? (
        <>
          <Button variante="sekundaer" onClick={() => setOffen("liste")}>
            {t.crm.zurListe}
          </Button>
          {inListe ? (
            <Button variante="sekundaer" onClick={() => setOffen("entfernen")}>
              {t.crm.ausListeEntfernen}
            </Button>
          ) : null}
          <Button variante="sekundaer" onClick={() => setOffen("feld")} disabled={setzbar.length === 0}>
            {t.crm.feldSetzen}
          </Button>
          {objekt === "deal" ? (
            <Button variante="sekundaer" onClick={() => setOffen("phase")}>
              {t.crm.phaseAendern}
            </Button>
          ) : (
            <Button variante="gefahr" onClick={() => setOffen("archivieren")}>
              {t.crm.archivieren}
            </Button>
          )}
        </>
      ) : null}
      <Button variante="ruhig" onClick={onLeeren}>
        {t.crm.auswahlAufheben}
      </Button>
      <div role="status" className="app-massen__ergebnis">
        {ergebnis
          ? ergebnis.fehler.length
            ? t.crm.massenTeilweise(ergebnis.erfolgreich, ergebnis.fehler.length, [...new Set(ergebnis.fehler.map((f) => (t.fehler as Record<string, string>)[f.code] ?? f.code))].join("; "))
            : t.crm.massenErfolg(ergebnis.erfolgreich)
          : ""}
      </div>

      {offen === "liste" ? (
        <Dialog
          titel={t.crm.zurListe}
          onSchliessen={schliesse}
          aktionen={
            <>
              <Button variante="sekundaer" onClick={schliesse}>
                {t.crm.abbrechen}
              </Button>
              <Button disabled={!listeId || laeuft} onClick={() => void onAktion({ art: "liste_hinzufuegen", listeId }).then(schliesse)}>
                {t.crm.hinzufuegen}
              </Button>
            </>
          }
        >
          {listen.length === 0 ? (
            <p>{t.crm.keineListen}</p>
          ) : (
            <Auswahl label={t.crm.liste} value={listeId} onChange={(e) => setListeId(e.target.value)}>
              <option value="">{t.crm.waehlen}</option>
              {listen.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Auswahl>
          )}
        </Dialog>
      ) : null}

      {offen === "entfernen" ? (
        <Dialog
          titel={t.crm.ausListeEntfernen}
          onSchliessen={schliesse}
          aktionen={
            <>
              <Button variante="sekundaer" onClick={schliesse}>
                {t.crm.abbrechen}
              </Button>
              <Button variante="gefahr" disabled={laeuft} onClick={() => void onEntfernen().then(schliesse)}>
                {t.crm.ausListeEntfernen}
              </Button>
            </>
          }
        >
          <p>{t.crm.ausListeFrage(anzahl)}</p>
        </Dialog>
      ) : null}

      {offen === "feld" && feld ? (
        <Dialog
          titel={t.crm.feldSetzen}
          onSchliessen={schliesse}
          aktionen={
            <>
              <Button variante="sekundaer" onClick={schliesse}>
                {t.crm.abbrechen}
              </Button>
              <Button disabled={laeuft} onClick={() => void onAktion({ art: "feld_setzen", feld: feld.schluessel, wert: wertFuerApi(feld) }).then(schliesse)}>
                {t.crm.uebernehmen}
              </Button>
            </>
          }
        >
          <div className="app-formular">
            <Auswahl
              label={t.crm.feld}
              value={feld.schluessel}
              onChange={(e) => {
                setFeldKey(e.target.value);
                setWert("");
              }}
            >
              {setzbar.map((f) => (
                <option key={f.schluessel} value={f.schluessel}>
                  {feldName(f, t)}
                </option>
              ))}
            </Auswahl>
            {feld.typ === "auswahl" ? (
              <Auswahl label={t.crm.wert} value={wert} onChange={(e) => setWert(e.target.value)}>
                <option value="">{t.crm.leerSetzen}</option>
                {optionenVon(feld, t).map((o) => (
                  <option key={o.schluessel} value={o.schluessel}>
                    {o.label}
                  </option>
                ))}
              </Auswahl>
            ) : feld.typ === "kontrollkaestchen" ? (
              <Auswahl label={t.crm.wert} value={wert || "nein"} onChange={(e) => setWert(e.target.value)}>
                <option value="ja">{t.crm.ja}</option>
                <option value="nein">{t.crm.nein}</option>
              </Auswahl>
            ) : (
              <Eingabe label={t.crm.wert} type={feld.typ === "datum" ? "date" : "text"} value={wert} hilfe={t.crm.leerLoescht} onChange={(e) => setWert(e.target.value)} />
            )}
          </div>
        </Dialog>
      ) : null}

      {offen === "phase" ? (
        <Dialog
          titel={t.crm.phaseAendern}
          onSchliessen={schliesse}
          aktionen={
            <>
              <Button variante="sekundaer" onClick={schliesse}>
                {t.crm.abbrechen}
              </Button>
              <Button disabled={laeuft} onClick={() => void onAktion({ art: "phase", nachPhase: phase }).then(schliesse)}>
                {t.crm.uebernehmen}
              </Button>
            </>
          }
        >
          <Auswahl label={t.crm.phase} value={phase} hilfe={t.crm.phaseRegel} onChange={(e) => setPhase(e.target.value as (typeof PHASEN)[number])}>
            {PHASEN.map((p) => (
              <option key={p} value={p}>
                {t.dealPhase[p]}
              </option>
            ))}
          </Auswahl>
        </Dialog>
      ) : null}

      {offen === "archivieren" ? (
        <Dialog
          titel={t.crm.archivierenTitel(anzahl)}
          onSchliessen={schliesse}
          aktionen={
            <>
              <Button variante="sekundaer" onClick={schliesse}>
                {t.crm.abbrechen}
              </Button>
              <Button variante="gefahr" disabled={laeuft} onClick={() => void onAktion({ art: "archivieren" }).then(schliesse)}>
                {t.crm.archivieren}
              </Button>
            </>
          }
        >
          <p>{t.crm.archivierenFrage}</p>
        </Dialog>
      ) : null}
    </div>
  );
}
