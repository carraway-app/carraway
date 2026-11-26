import { useState, type FormEvent } from "react";
import { Auswahl, Button, CaretDownIcon, CaretUpIcon, Dialog, Feld as Eingabe } from "@carraway/ui";
import type { Ansicht, Feld, Konfig } from "../../api/crm";
import { useT } from "../../i18n";
import { feldName } from "./typen";

/** Spalten einer Ansicht: sichtbar machen, ausblenden und ordnen (mit Knöpfen, nicht nur per Maus). */
export function SpaltenDialog({ felder, spalten, onAendern, onSchliessen }: { felder: Feld[]; spalten: Konfig["spalten"]; onAendern: (s: Konfig["spalten"]) => void; onSchliessen: () => void }) {
  const t = useT();
  const sichtbar = spalten.map((s) => s.feld);
  const reihenfolge = [...spalten.map((s) => felder.find((f) => f.schluessel === s.feld)).filter((f): f is Feld => Boolean(f)), ...felder.filter((f) => !sichtbar.includes(f.schluessel))];
  const schalte = (f: Feld, an: boolean) => onAendern(an ? [...spalten, { feld: f.schluessel }] : spalten.filter((s) => s.feld !== f.schluessel));
  const verschiebe = (f: Feld, richtung: -1 | 1) => {
    const i = spalten.findIndex((s) => s.feld === f.schluessel);
    const j = i + richtung;
    if (i < 0 || j < 0 || j >= spalten.length) return;
    const neu = [...spalten];
    [neu[i], neu[j]] = [neu[j]!, neu[i]!];
    onAendern(neu);
  };
  return (
    <Dialog titel={t.crm.spaltenTitel} onSchliessen={onSchliessen}>
      <p className="app-leer-text">{t.crm.spaltenHinweis}</p>
      <ul className="app-spaltenliste">
        {reihenfolge.map((f) => {
          const an = sichtbar.includes(f.schluessel);
          const i = sichtbar.indexOf(f.schluessel);
          return (
            <li key={f.schluessel}>
              <label>
                <input type="checkbox" checked={an} disabled={an && spalten.length === 1} onChange={(e) => schalte(f, e.target.checked)} />
                {feldName(f, t)}
              </label>
              {an ? (
                <span className="app-spaltenliste__knoepfe">
                  <Button variante="ruhig" icon={<CaretUpIcon />} aria-label={t.crm.spalteNachOben(feldName(f, t))} disabled={i === 0} onClick={() => verschiebe(f, -1)} />
                  <Button variante="ruhig" icon={<CaretDownIcon />} aria-label={t.crm.spalteNachUnten(feldName(f, t))} disabled={i === spalten.length - 1} onClick={() => verschiebe(f, 1)} />
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

interface LeisteProps {
  ansichten: Ansicht[];
  aktuell: Ansicht | null;
  /** Die Konfiguration auf dem Bildschirm weicht von der gewählten Ansicht ab. */
  geaendert: boolean;
  istVerwalter: boolean;
  onWaehlen: (id: string | null) => void;
  onNeu: (name: string, geteilt: boolean) => Promise<unknown>;
  onSpeichern: () => Promise<unknown>;
  onLoeschen: () => Promise<unknown>;
  onTeilen: (geteilt: boolean) => Promise<unknown>;
  onStandard: (standard: boolean) => Promise<unknown>;
}

/** Auswahl und Pflege gespeicherter Ansichten: privat oder geteilt, ändern nur Besitzer und Verwalter. */
export function Ansichtenleiste({ ansichten, aktuell, geaendert, istVerwalter, onWaehlen, onNeu, onSpeichern, onLoeschen, onTeilen, onStandard }: LeisteProps) {
  const t = useT();
  const [dialog, setDialog] = useState<null | "neu" | "loeschen">(null);
  const [name, setName] = useState("");
  const [geteilt, setGeteilt] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function sende(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setFehler(t.crm.ansichtNameFehlt);
      return;
    }
    await onNeu(name.trim(), geteilt);
    setDialog(null);
    setName("");
    setGeteilt(false);
  }

  return (
    <div className="app-ansichten" role="group" aria-label={t.crm.ansichten}>
      <Auswahl label={t.crm.ansicht} className="app-ansichten__wahl" value={aktuell?.id ?? ""} onChange={(e) => onWaehlen(e.target.value || null)}>
        <option value="">{t.crm.standardAnsicht}</option>
        {ansichten.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
            {a.standard ? ` (${t.crm.standard})` : a.geteilt ? ` (${t.crm.geteilt})` : ` (${t.crm.privat})`}
          </option>
        ))}
      </Auswahl>
      {aktuell?.bearbeitbar && geaendert ? (
        <Button variante="sekundaer" onClick={() => void onSpeichern()}>
          {t.crm.ansichtAktualisieren}
        </Button>
      ) : null}
      <Button variante="sekundaer" onClick={() => setDialog("neu")}>
        {t.crm.ansichtSpeichern}
      </Button>
      {aktuell?.bearbeitbar ? (
        <>
          <Button variante="ruhig" onClick={() => void onTeilen(!aktuell.geteilt)}>
            {aktuell.geteilt ? t.crm.ansichtPrivat : t.crm.ansichtTeilen}
          </Button>
          <Button variante="ruhig" onClick={() => setDialog("loeschen")}>
            {t.crm.ansichtLoeschen}
          </Button>
        </>
      ) : null}
      {aktuell && istVerwalter ? (
        <Button variante="ruhig" onClick={() => void onStandard(!aktuell.standard)}>
          {aktuell.standard ? t.crm.standardAufheben : t.crm.standardSetzen}
        </Button>
      ) : null}

      {dialog === "neu" ? (
        <Dialog
          titel={t.crm.ansichtSpeichern}
          onSchliessen={() => setDialog(null)}
          aktionen={
            <>
              <Button variante="sekundaer" onClick={() => setDialog(null)}>
                {t.crm.abbrechen}
              </Button>
              <Button type="submit" form="ansicht-neu">
                {t.crm.speichern}
              </Button>
            </>
          }
        >
          <form id="ansicht-neu" className="app-formular" onSubmit={(e) => void sende(e)} noValidate>
            <Eingabe label={t.crm.ansichtName} value={name} fehler={fehler ?? undefined} onChange={(e) => setName(e.target.value)} />
            <label className="app-schalter">
              <input type="checkbox" checked={geteilt} onChange={(e) => setGeteilt(e.target.checked)} />
              {t.crm.ansichtTeilenHinweis}
            </label>
          </form>
        </Dialog>
      ) : null}
      {dialog === "loeschen" && aktuell ? (
        <Dialog
          titel={t.crm.ansichtLoeschenTitel(aktuell.name)}
          onSchliessen={() => setDialog(null)}
          aktionen={
            <>
              <Button variante="sekundaer" onClick={() => setDialog(null)}>
                {t.crm.abbrechen}
              </Button>
              <Button
                variante="gefahr"
                onClick={() => {
                  void onLoeschen().then(() => setDialog(null));
                }}
              >
                {t.crm.ansichtLoeschen}
              </Button>
            </>
          }
        >
          <p>{t.crm.ansichtLoeschenFrage}</p>
        </Dialog>
      ) : null}
    </div>
  );
}
