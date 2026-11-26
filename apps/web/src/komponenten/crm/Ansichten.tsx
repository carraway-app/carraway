import { useState, type FormEvent } from "react";
import { Auswahl, Button, Dialog, Feld as Eingabe, SortierbareListe } from "@carraway/ui";
import type { Ansicht, Feld, Konfig } from "../../api/crm";
import { useT } from "../../i18n";
import { feldName } from "./typen";

/** Spalten einer Ansicht: oben die angezeigten (per Ziehgriff oder Tastatur sortierbar), darunter die ausgeblendeten (alphabetisch); Einblenden hängt unten an. */
export function SpaltenDialog({ felder, spalten, onAendern, onSchliessen }: { felder: Feld[]; spalten: Konfig["spalten"]; onAendern: (s: Konfig["spalten"]) => void; onSchliessen: () => void }) {
  const t = useT();
  const [suche, setSuche] = useState("");
  const sichtbar = spalten.flatMap((s) => {
    const feld = felder.find((f) => f.schluessel === s.feld);
    return feld ? [feld] : [];
  });
  const gezeigt = new Set(spalten.map((s) => s.feld));
  const unbekannt = spalten.filter((s) => !felder.some((f) => f.schluessel === s.feld));
  const suchtext = suche.trim().toLocaleLowerCase();
  // Ausgeblendete Felder stehen alphabetisch, die Suche filtert nur sie (die angezeigten bleiben vollständig sortierbar).
  const ausgeblendet = felder
    .filter((f) => !gezeigt.has(f.schluessel))
    .sort((a, b) => feldName(a, t).localeCompare(feldName(b, t)))
    .filter((f) => !suchtext || feldName(f, t).toLocaleLowerCase().includes(suchtext));
  const schalte = (f: Feld, an: boolean) => onAendern(an ? [...spalten, { feld: f.schluessel }] : spalten.filter((s) => s.feld !== f.schluessel));
  // Neue Reihenfolge der angezeigten Spalten; Breiten bleiben an ihren Spalten, unbekannte Einträge bleiben hinten.
  const ordne = (neu: Feld[]) => onAendern([...neu.flatMap((f) => spalten.filter((s) => s.feld === f.schluessel)), ...unbekannt]);
  return (
    <Dialog titel={t.crm.spaltenTitel} onSchliessen={onSchliessen}>
      <p className="app-leer-text">{t.crm.spaltenHinweis}</p>
      {felder.length > 10 ? <Eingabe kompakt labelVersteckt type="search" label={t.crm.spaltenSuche} placeholder={t.crm.spaltenSuche} value={suche} onChange={(e) => setSuche(e.target.value)} /> : null}
      <h3 className="app-spaltenliste__titel">{t.crm.spaltenAngezeigt}</h3>
      <SortierbareListe
        className="app-spaltenliste"
        aria-label={t.crm.spaltenAngezeigt}
        eintraege={sichtbar}
        schluessel={(f) => f.schluessel}
        name={(f) => feldName(f, t)}
        onAendern={ordne}
        texte={{
          griff: t.crm.spalteGriff,
          hinweis: t.crm.spalteBedienung,
          aufgenommen: t.crm.spalteAufgenommen,
          verschoben: t.crm.spalteVerschoben,
          abgelegt: t.crm.spalteAbgelegt,
          abgebrochen: t.crm.spalteAbgebrochen,
        }}
        zeile={(f) => (
          <label className="app-spaltenliste__name">
            <input type="checkbox" checked disabled={sichtbar.length === 1} onChange={() => schalte(f, false)} />
            {feldName(f, t)}
          </label>
        )}
      />
      <h3 className="app-spaltenliste__titel">{t.crm.spaltenAusgeblendet}</h3>
      {ausgeblendet.length === 0 ? (
        <p className="app-leer-text">{suchtext ? t.crm.spaltenKeineTreffer : t.crm.spaltenKeineAusgeblendeten}</p>
      ) : (
        <ul className="app-spaltenliste" aria-label={t.crm.spaltenAusgeblendet}>
          {ausgeblendet.map((f) => (
            <li key={f.schluessel}>
              <label className="app-spaltenliste__name">
                <input type="checkbox" checked={false} onChange={() => schalte(f, true)} />
                {feldName(f, t)}
              </label>
            </li>
          ))}
        </ul>
      )}
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
