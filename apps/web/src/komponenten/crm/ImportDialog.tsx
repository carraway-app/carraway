import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Hinweis, Seitenpanel, Textbereich } from "@carraway/ui";
import { crmFelder, importVorschau, ladeKopfzeile, useCrmImport, type ImportEingabe, type ImportErgebnis } from "../../api/crm";
import { DateiDropzone } from "../DateiDropzone";
import { FehlerHinweis } from "../FehlerHinweis";
import { useT } from "../../i18n";
import { feldName } from "./typen";

type Ziel = "organisation" | "person";

/**
 * CSV-Import mit Zuordnung der Spalten zu Feldern (auch eigenen): Datei wählen oder einfügen, Spalten zuordnen (Vorschlag aus den Kopfzeilen), Vorschau
 * mit Dublettenprüfung und Fehlern je Zeile, dann übernehmen. Dubletten werden übersprungen, ergänzt oder trotzdem angelegt.
 */
export function ImportDialog({ vorgabe, onSchliessen }: { vorgabe: Ziel; onSchliessen: () => void }) {
  const t = useT();
  const [objekt, setObjekt] = useState<Ziel>(vorgabe);
  const [csv, setCsv] = useState("");
  const [dateiname, setDateiname] = useState("");
  const [spalten, setSpalten] = useState<string[] | null>(null);
  const [zuordnung, setZuordnung] = useState<Record<number, string>>({});
  const [dubletten, setDubletten] = useState<ImportEingabe["dubletten"]>("ueberspringen");
  const [unternehmenAnlegen, setUnternehmenAnlegen] = useState(false);
  const [vorschau, setVorschau] = useState<ImportErgebnis | null>(null);
  const [ergebnis, setErgebnis] = useState<ImportErgebnis | null>(null);
  const [fehler, setFehler] = useState<unknown>(null);
  const felder = useQuery(crmFelder(objekt));
  const importieren = useCrmImport();
  const ziele = (felder.data ?? []).filter((f) => (f.schreibbar && f.typ !== "verknuepfung" && f.typ !== "benutzer") || (objekt === "person" && f.schluessel === "unternehmen"));

  const eingabe = (): ImportEingabe => ({
    objekt,
    csv,
    zuordnung: Object.entries(zuordnung)
      .filter(([, feld]) => feld !== "")
      .map(([spalte, feld]) => ({ spalte: Number(spalte), feld })),
    dubletten,
    unternehmenAnlegen,
  });

  async function leseKopf(text: string) {
    setFehler(null);
    setVorschau(null);
    setErgebnis(null);
    try {
      const kopf = await ladeKopfzeile(text);
      setSpalten(kopf);
      // Vorschlag: gleicher Name wie ein Feld (ohne Groß- und Kleinschreibung), sonst nicht zuordnen.
      const vorschlag: Record<number, string> = {};
      const benutzt = new Set<string>();
      kopf.forEach((k, i) => {
        const f = ziele.find((x) => !benutzt.has(x.schluessel) && (feldName(x, t).toLowerCase() === k.toLowerCase() || x.schluessel.toLowerCase() === k.toLowerCase()));
        if (f) {
          vorschlag[i] = f.schluessel;
          benutzt.add(f.schluessel);
        }
      });
      setZuordnung(vorschlag);
    } catch (e) {
      setSpalten(null);
      setFehler(e);
    }
  }

  async function datei(f: File | undefined) {
    if (!f) return;
    const text = await f.text();
    setCsv(text);
    setDateiname(f.name);
    await leseKopf(text);
  }

  async function zeigeVorschau() {
    setFehler(null);
    try {
      setVorschau(await importVorschau(eingabe()));
    } catch (e) {
      setFehler(e);
    }
  }

  const statusText = (s: string) => (t.crm.importStatus as Record<string, string>)[s] ?? s;
  const anzeige = ergebnis ?? vorschau;

  return (
    <Seitenpanel titel={t.crm.importTitel} onSchliessen={onSchliessen} breit>
      <h2 className="cw-t-untertitel">{t.crm.importTitel}</h2>
      <FehlerHinweis fehler={(fehler as Error | null) ?? importieren.error} />
      <Auswahl
        label={t.crm.importObjekt}
        value={objekt}
        onChange={(e) => {
          setObjekt(e.target.value as Ziel);
          setSpalten(null);
          setVorschau(null);
        }}
      >
        <option value="organisation">{t.crm.objekte.organisation}</option>
        <option value="person">{t.crm.objekte.person}</option>
      </Auswahl>
      <DateiDropzone
        id="import-datei"
        label={t.crm.importDatei}
        accept=".csv,text/csv,text/plain"
        dateiname={dateiname}
        deaktiviert={importieren.isPending}
        onDateien={([dateiAuswahl]) => void datei(dateiAuswahl)}
      />
      <Textbereich label={t.crm.importEinfuegen} rows={4} value={csv} onChange={(e) => setCsv(e.target.value)} onBlur={() => csv.trim() && !spalten && void leseKopf(csv)} />
      {csv.trim() && !spalten ? (
        <Button variante="sekundaer" onClick={() => void leseKopf(csv)}>
          {t.crm.importSpaltenLesen}
        </Button>
      ) : null}

      {spalten ? (
        <>
          <h3 className="cw-t-untertitel">{t.crm.importZuordnung}</h3>
          <ul className="app-zuordnung">
            {spalten.map((k, i) => (
              <li key={i}>
                <Auswahl
                  label={t.crm.importSpalte(k || String(i + 1))}
                  value={zuordnung[i] ?? ""}
                  onChange={(e) => {
                    setVorschau(null);
                    setZuordnung((alt) => ({ ...alt, [i]: e.target.value }));
                  }}
                >
                  <option value="">{t.crm.importIgnorieren}</option>
                  {ziele.map((f) => (
                    <option key={f.schluessel} value={f.schluessel}>
                      {feldName(f, t)}
                    </option>
                  ))}
                </Auswahl>
              </li>
            ))}
          </ul>
          <Auswahl label={t.crm.importDubletten} value={dubletten} onChange={(e) => setDubletten(e.target.value as ImportEingabe["dubletten"])}>
            <option value="ueberspringen">{t.crm.dublettenUeberspringen}</option>
            <option value="aktualisieren">{t.crm.dublettenAktualisieren}</option>
            <option value="anlegen">{t.crm.dublettenAnlegen}</option>
          </Auswahl>
          {objekt === "person" ? (
            <label className="app-schalter">
              <input type="checkbox" checked={unternehmenAnlegen} onChange={(e) => setUnternehmenAnlegen(e.target.checked)} />
              {t.crm.importUnternehmenAnlegen}
            </label>
          ) : null}
          <div className="app-fed__fuss">
            <Button variante="sekundaer" onClick={() => void zeigeVorschau()}>
              {t.crm.importVorschau}
            </Button>
            <Button
              disabled={!vorschau || importieren.isPending || ergebnis !== null}
              onClick={() =>
                importieren.mutate(eingabe(), {
                  onSuccess: (r) => setErgebnis(r),
                })
              }
            >
              {t.crm.importAusfuehren}
            </Button>
          </div>
        </>
      ) : null}

      {anzeige ? (
        <section aria-label={t.crm.importErgebnis}>
          <Hinweis>
            {ergebnis ? t.crm.importFertig(anzeige.zusammenfassung.angelegt ?? 0, anzeige.zusammenfassung.aktualisiert ?? 0, anzeige.zusammenfassung.fehler ?? 0) : t.crm.importVorschauZahlen(anzeige.zusammenfassung.neu ?? 0, anzeige.zusammenfassung.dubletten ?? 0, anzeige.zusammenfassung.fehler ?? 0)}
          </Hinweis>
          <div className="cw-tabelle-huelle" role="region" aria-label={t.crm.importZeilen} tabIndex={0}>
          <table className="cw-tabelle cw-tabelle--fest-2 cw-tabelle--dicht" aria-label={t.crm.importZeilen}>
            <thead>
              <tr>
                <th scope="col" className="cw-fest">{t.crm.importZeile}</th>
                <th scope="col" className="cw-fest cw-fest--kante cw-fest--zweite">{t.crm.importName}</th>
                <th scope="col">{t.crm.importStatusSpalte}</th>
                <th scope="col" className="cw-tabelle__umbruch">{t.crm.importHinweis}</th>
              </tr>
            </thead>
            <tbody>
              {anzeige.zeilen
                .filter((z) => z.status !== "leer")
                .slice(0, 100)
                .map((z) => (
                  <tr key={z.zeile}>
                    <td className="app-zahl cw-fest">{z.zeile}</td>
                    <td className="cw-fest cw-fest--kante cw-fest--zweite">{z.name ?? t.gemeinsam.keinWert}</td>
                    <td>{statusText(z.status)}</td>
                    <td className="cw-tabelle__umbruch">
                      {z.dublette ? t.crm.importDublette(z.dublette.name) : ""}
                      {z.fehler.map((f) => f.meldung).join("; ")}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          </div>
        </section>
      ) : null}
    </Seitenpanel>
  );
}
