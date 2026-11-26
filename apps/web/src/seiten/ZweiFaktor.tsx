import { useState, type FormEvent } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { Button, Feld, Hinweis } from "@carraway/ui";
import { authAnfrage } from "../api/client";
import { useAbmelden } from "../komponenten/abmelden";
import { useAnmeldeschritt, useAnmeldungAbschliessen } from "../komponenten/anmeldeschritt";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { QrCode } from "../komponenten/QrCode";
import { useT } from "../i18n";

const route = getRouteApi("/zwei-faktor-einrichten");

interface Einrichtung {
  totpURI: string;
  backupCodes: string[];
}

/** Geheimnis aus der Einrichtungsadresse, in Vierergruppen zum Abtippen, falls der Scan nicht geht. */
function geheimnisAus(uri: string): string | null {
  try {
    const roh = new URL(uri).searchParams.get("secret");
    return roh ? (roh.match(/.{1,4}/g) ?? [roh]).join(" ") : null;
  } catch {
    return null;
  }
}

/**
 * Zweiter Faktor einrichten (Pflicht, solange `/ich` `zweiFaktorErforderlich` meldet): erst das Passwort, dann QR-Code und
 * Wiederherstellungscodes. Die Codes stehen nur hier im Zustand der Seite, werden genau einmal gezeigt und nie zwischengespeichert.
 * Aktiv wird der Faktor erst mit einem gültigen Code aus der App.
 */
export function ZweiFaktorSeite() {
  const t = useT();
  const z = t.zweiFaktor;
  const { weiter } = route.useSearch();
  const abschliessen = useAnmeldungAbschliessen();
  const abmelden = useAbmelden();
  const [passwort, setPasswort] = useState("");
  const [einrichtung, setEinrichtung] = useState<Einrichtung | null>(null);
  const [code, setCode] = useState("");
  const [gesichert, setGesichert] = useState(false);
  const [kopiert, setKopiert] = useState<boolean | null>(null);
  const { laeuft, fehler, ausfuehren } = useAnmeldeschritt();

  function starten(e: FormEvent) {
    e.preventDefault();
    void ausfuehren(async () => {
      setEinrichtung(await authAnfrage<Einrichtung>("/two-factor/enable", { password: passwort }));
      setPasswort("");
    });
  }

  function aktivieren(e: FormEvent) {
    e.preventDefault();
    void ausfuehren(async () => {
      await authAnfrage("/two-factor/verify-totp", { code: code.trim() });
      setEinrichtung(null);
      await abschliessen(weiter);
    });
  }

  async function kopieren(codes: string[]) {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setKopiert(true);
    } catch {
      setKopiert(false);
    }
  }

  const geheimnis = einrichtung ? geheimnisAus(einrichtung.totpURI) : null;

  return (
    <section className="app-auth__karte app-auth__karte--breit" aria-labelledby="zf-titel">
      <h1 id="zf-titel" className="cw-t-titel">
        {z.titel}
      </h1>
      {!einrichtung ? (
        <>
          <p className="app-leer-text">{z.einleitung}</p>
          <form className="app-formular" onSubmit={starten} noValidate>
            <FehlerHinweis fehler={fehler} />
            <Feld label={z.passwort} hilfe={z.passwortHilfe} name="passwort" type="password" value={passwort} onChange={(e) => setPasswort(e.target.value)} autoComplete="current-password" required autoFocus />
            <Button type="submit" disabled={laeuft || passwort === ""}>
              {z.starten}
            </Button>
          </form>
        </>
      ) : (
        <form className="app-formular" onSubmit={aktivieren} noValidate>
          <ol className="app-schritte">
            <li>
              <h2 className="cw-t-untertitel">{z.schritt1}</h2>
              <p className="app-leer-text">{z.schritt1Text}</p>
              <QrCode wert={einrichtung.totpURI} />
              {geheimnis ? (
                <p className="app-leer-text">
                  {z.geheimnis} <code className="app-code">{geheimnis}</code>
                </p>
              ) : null}
            </li>
            <li>
              <h2 className="cw-t-untertitel">{z.schritt2}</h2>
              <Hinweis titel={z.codesTitel}>{z.codesText}</Hinweis>
              <ul className="app-codes" aria-label={z.codesTitel}>
                {einrichtung.backupCodes.map((c) => (
                  <li key={c}>
                    <code className="app-code">{c}</code>
                  </li>
                ))}
              </ul>
              <div className="app-aktionen__knoepfe">
                <Button variante="sekundaer" onClick={() => void kopieren(einrichtung.backupCodes)}>
                  {z.kopieren}
                </Button>
                <span role="status" className="app-leer-text">
                  {kopiert === true ? z.kopiert : kopiert === false ? z.kopierenFehlt : ""}
                </span>
              </div>
              <label className="app-haken">
                <input type="checkbox" checked={gesichert} onChange={(e) => setGesichert(e.target.checked)} />
                <span>{z.gesichert}</span>
              </label>
            </li>
            <li>
              <h2 className="cw-t-untertitel">{z.schritt3}</h2>
              <FehlerHinweis fehler={fehler} />
              <Feld label={z.code} hilfe={z.codeHilfe} name="code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" spellCheck={false} required zahl />
              <Button type="submit" disabled={laeuft || !gesichert || code.trim() === ""} aria-describedby={gesichert ? undefined : "zf-gesichert-hinweis"}>
                {z.aktivieren}
              </Button>
              {gesichert ? null : (
                <p id="zf-gesichert-hinweis" className="app-leer-text">
                  {z.erstSichern}
                </p>
              )}
            </li>
          </ol>
        </form>
      )}
      <div>
        <Button variante="ruhig" disabled={abmelden.laeuft} onClick={() => void abmelden.abmelden()}>
          {t.konto.abmelden}
        </Button>
      </div>
    </section>
  );
}
