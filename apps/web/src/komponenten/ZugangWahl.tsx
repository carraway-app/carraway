import { Auswahl } from "@carraway/ui";
import { useT } from "../i18n";

/** Wahl zwischen Startpasswort und Einladung per Mail; die Einladung gibt es nur bei eingerichtetem Mailversand. */
export function ZugangWahl({ wert, onWahl }: { wert: "passwort" | "einladung"; onWahl: (art: "passwort" | "einladung") => void }) {
  const t = useT();
  const e = t.verwaltung.einladung;
  return (
    <>
      <Auswahl label={e.zugang} value={wert} onChange={(ev) => onWahl(ev.target.value === "einladung" ? "einladung" : "passwort")}>
        <option value="passwort">{e.startpasswort}</option>
        <option value="einladung">{e.perMail}</option>
      </Auswahl>
      {wert === "einladung" ? <p className="app-leer-text">{e.mailHilfe}</p> : null}
    </>
  );
}
