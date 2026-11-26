import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, CodeEingabe, Feld, Hinweis } from "@carraway/ui";
import { zweiFaktorErst, zweiFaktorNeu, type ZweiFaktorAnsatz } from "../api/sicherheit";
import { useT } from "../i18n";
import { FehlerHinweis } from "./FehlerHinweis";
import { QrCode } from "./QrCode";
import { useAnmeldeschritt } from "./anmeldeschritt";

/** Geheimnis aus der Einrichtungsadresse, in Vierergruppen zum Abtippen, falls der Scan nicht geht. */
function geheimnisAus(uri: string): string | null {
  try {
    const roh = new URL(uri).searchParams.get("secret");
    return roh ? (roh.match(/.{1,4}/g) ?? [roh]).join(" ") : null;
  } catch {
    return null;
  }
}

/** Wiederherstellungscodes, genau einmal gezeigt: Sie stehen nur im Zustand des Aufrufers, nie im Cache. */
export function CodeListe({ codes, beschriftung }: { codes: string[]; beschriftung: string }) {
  const z = useT().anmeldung.sicherheit.zweiFaktor;
  const [kopiert, setKopiert] = useState<boolean | null>(null);
  async function kopieren() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setKopiert(true);
    } catch {
      setKopiert(false);
    }
  }
  return (
    <>
      <ul className="app-codes" aria-label={beschriftung}>
        {codes.map((c) => (
          <li key={c}>
            <code className="app-code">{c}</code>
          </li>
        ))}
      </ul>
      <div className="app-aktionen__knoepfe">
        <Button variante="sekundaer" onClick={() => void kopieren()}>
          {z.kopieren}
        </Button>
        <span role="status" className="app-leer-text">
          {kopiert === true ? z.kopiert : kopiert === false ? z.kopierenFehlt : ""}
        </span>
      </div>
    </>
  );
}

/**
 * Einrichtung des zweiten Faktors in den Einstellungen: erst das Passwort (entfällt ohne Passwort-Zugang), dann QR-Code und Wiederherstellungscodes,
 * zuletzt ein Code der App. `erst` richtet den Faktor zum ersten Mal ein, `neu` ersetzt Schlüssel und Codes eines aktiven Faktors; der bisherige
 * Schlüssel gilt bis zur Bestätigung.
 */
export function ZweiFaktorAblauf({ modus, passwortNoetig, onFertig, onAbbrechen }: { modus: "erst" | "neu"; passwortNoetig: boolean; onFertig: () => void; onAbbrechen: () => void }) {
  const t = useT();
  const z = t.anmeldung.sicherheit.zweiFaktor;
  const qc = useQueryClient();
  const [passwort, setPasswort] = useState("");
  const [ansatz, setAnsatz] = useState<ZweiFaktorAnsatz | null>(null);
  const [code, setCode] = useState("");
  const [gesichert, setGesichert] = useState(false);
  const [andere, setAndere] = useState(false);
  const { laeuft, fehler, ausfuehren } = useAnmeldeschritt();

  function starten(e: FormEvent) {
    e.preventDefault();
    void ausfuehren(async () => {
      setAnsatz(await (modus === "erst" ? zweiFaktorErst.starten(passwort) : zweiFaktorNeu.starten(passwort)));
      setPasswort("");
    });
  }

  function bestaetigen(e: FormEvent) {
    e.preventDefault();
    void ausfuehren(async () => {
      if (modus === "erst") await zweiFaktorErst.bestaetigen(code.trim(), qc);
      else await zweiFaktorNeu.bestaetigen(code.trim(), andere, qc);
      setAnsatz(null);
      onFertig();
    });
  }

  if (!ansatz) {
    return (
      <form className="app-formular" onSubmit={starten} noValidate>
        <p className="app-leer-text">{modus === "erst" ? z.ausEinleitung : z.neuEinleitung}</p>
        <FehlerHinweis fehler={fehler} />
        {passwortNoetig ? <Feld label={z.passwort} name="zf-passwort" type="password" value={passwort} onChange={(e) => setPasswort(e.target.value)} autoComplete="current-password" required autoFocus /> : null}
        <div className="app-aktionen__knoepfe">
          <Button type="submit" disabled={laeuft || (passwortNoetig && passwort === "")}>
            {z.starten}
          </Button>
          <Button variante="ruhig" onClick={onAbbrechen}>
            {z.abbrechen}
          </Button>
        </div>
      </form>
    );
  }
  const geheimnis = geheimnisAus(ansatz.totpURI);
  return (
    <form className="app-formular" onSubmit={bestaetigen} noValidate>
      <ol className="app-schritte">
        <li>
          <h3 className="cw-t-untertitel">{z.schritt1}</h3>
          <p className="app-leer-text">{z.schritt1Text}</p>
          <QrCode wert={ansatz.totpURI} />
          {geheimnis ? (
            <p className="app-leer-text">
              {z.geheimnis} <code className="app-code">{geheimnis}</code>
            </p>
          ) : null}
        </li>
        <li>
          <h3 className="cw-t-untertitel">{z.schritt2}</h3>
          <Hinweis titel={z.codesTitel}>{z.codesText}</Hinweis>
          <CodeListe codes={ansatz.backupCodes} beschriftung={z.codesTitel} />
          <label className="app-haken">
            <input type="checkbox" checked={gesichert} onChange={(e) => setGesichert(e.target.checked)} />
            <span>{z.gesichert}</span>
          </label>
        </li>
        <li>
          <h3 className="cw-t-untertitel">{z.schritt3}</h3>
          <FehlerHinweis fehler={fehler} />
          <p className="app-leer-text">{z.codeHilfe}</p>
          <CodeEingabe label={z.code} ziffer={t.anmeldung.ziffer} name="zf-code" value={code} onChange={setCode} />
          {modus === "neu" ? (
            <label className="app-haken">
              <input type="checkbox" checked={andere} onChange={(e) => setAndere(e.target.checked)} />
              <span>{z.andere}</span>
            </label>
          ) : null}
          <div className="app-aktionen__knoepfe">
            <Button type="submit" disabled={laeuft || !gesichert || code.length < 6} aria-describedby={gesichert ? undefined : "zf-gesichert-hinweis"}>
              {z.aktivieren}
            </Button>
            <Button variante="ruhig" onClick={onAbbrechen}>
              {z.abbrechen}
            </Button>
          </div>
          {gesichert ? null : (
            <p id="zf-gesichert-hinweis" className="app-leer-text">
              {z.erstSichern}
            </p>
          )}
        </li>
      </ol>
    </form>
  );
}
