import { useState } from "react";
import { Auswahl, Button, DownloadSimpleIcon, Feld, FunnelIcon, ListIcon, Popover, Seitenpanel, StackIcon } from "@carraway/ui";
import { exportiereCsv, type Feld as CrmFeld, useAnsichtAendern, useAnsichtLoeschen, useAnsichtSpeichern, type AbfrageEingabe, type Objekt } from "../../api/crm";
import { FehlerHinweis } from "../FehlerHinweis";
import { useT } from "../../i18n";
import { Ansichtenleiste, SpaltenDialog } from "./Ansichten";
import { FilterEditor } from "./FilterEditor";
import { feldName } from "./typen";
import type { AnsichtZustand } from "./zustand";
import { istGruppe, type Bedingung, type Gruppe } from "../../api/crm";

const zaehleBedingungen = (g: Gruppe | undefined): number => (g ? g.elemente.reduce((n, e) => n + (istGruppe(e) ? zaehleBedingungen(e) : 1), 0) : 0);

/** Lädt Text als Datei herunter (jsdom kennt keine Objekt-URLs; dort bleibt es beim Aufruf der API). */
function speichereDatei(name: string, inhalt: string) {
  if (typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(new Blob([inhalt], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface Props {
  z: AnsichtZustand;
  objekt: Objekt;
  listeId?: string | undefined;
  suche: string;
  onSuche: (wert: string) => void;
  onAnsicht: (id: string | null) => void;
  istVerwalter: boolean;
  /** Mit Spaltenwahl (Tabellenansicht). */
  mitSpalten: boolean;
  /** Eingabe für den Export: die Konfiguration mit allen sichtbaren Spalten. */
  exportEingabe: AbfrageEingabe;
}

/** Werkzeugzeile einer Ansicht: Suche, Filter (UND/ODER), Spalten, gespeicherte Ansichten und CSV-Export. */
export function Werkzeuge({ z, objekt, listeId, suche, onSuche, onAnsicht, istVerwalter, mitSpalten, exportEingabe }: Props) {
  const t = useT();
  const [offen, setOffen] = useState<null | "filter" | "spalten">(null);
  const [exportFehler, setExportFehler] = useState<unknown>(null);
  const speichern = useAnsichtSpeichern(objekt, listeId);
  const aendern = useAnsichtAendern(objekt, listeId);
  const loeschen = useAnsichtLoeschen(objekt, listeId);
  const bedingungen = zaehleBedingungen(z.konfig.filter);

  return (
    <div className="cw-crm-werkzeuge">
      <FehlerHinweis fehler={(speichern.error ?? aendern.error ?? loeschen.error ?? exportFehler) as Error | null} />
      <div className="cw-crm-werkzeuge__zeile">
        <Feld type="search" label={t.crm.suche} value={suche} autoComplete="off" onChange={(e) => onSuche(e.target.value)} className="cw-crm-werkzeuge__suche" />
        <Button variante="sekundaer" groesse="s" icon={<FunnelIcon />} onClick={() => setOffen("filter")}>
          {bedingungen ? t.crm.filterMitAnzahl(bedingungen) : t.crm.filter}
        </Button>
        {mitSpalten ? (
          <Button variante="sekundaer" groesse="s" icon={<ListIcon />} onClick={() => setOffen("spalten")}>
            {t.crm.spalten}
          </Button>
        ) : null}
        {mitSpalten ? <GruppierenWahl felder={z.felder} wert={z.konfig.gruppierung ?? null} board={z.art === "kanban"} onChange={(schluessel) => z.setzeKonfig({ gruppierung: schluessel })} /> : null}
        {/* Nur Symbol (Name und Tooltip „Als CSV exportieren“), damit die Werkzeugleiste bei 1440 px in einer Zeile bleibt. */}
        <Button
          variante="sekundaer"
          groesse="s"
          icon={<DownloadSimpleIcon />}
          aria-label={t.crm.exportCsv}
          title={t.crm.exportCsv}
          onClick={() => {
            setExportFehler(null);
            void exportiereCsv(objekt, exportEingabe)
              .then((csv) => speichereDatei(`${objekt}-export.csv`, csv))
              .catch(setExportFehler);
          }}
        />
      </div>
      <Ansichtenleiste
        ansichten={z.ansichten}
        aktuell={z.aktuell}
        geaendert={z.geaendert}
        istVerwalter={istVerwalter}
        onWaehlen={(id) => {
          z.verwerfen();
          onAnsicht(id);
        }}
        onNeu={(name, geteilt) =>
          speichern.mutateAsync({ objekt, ...(listeId ? { listeId } : {}), name, art: z.art, konfig: z.konfig, geteilt }).then((neu) => {
            z.verwerfen();
            onAnsicht(neu.id);
          })
        }
        onSpeichern={() => aendern.mutateAsync({ id: z.aktuell!.id, konfig: z.konfig, art: z.art }).then(() => z.verwerfen())}
        onLoeschen={() => loeschen.mutateAsync(z.aktuell!.id).then(() => onAnsicht(null))}
        onTeilen={(geteilt) => aendern.mutateAsync({ id: z.aktuell!.id, geteilt })}
        onStandard={(standard) => aendern.mutateAsync({ id: z.aktuell!.id, standard })}
      />
      {offen === "filter" ? (
        <Seitenpanel titel={t.crm.filterTitel} onSchliessen={() => setOffen(null)} breit>
          <h2 className="cw-t-untertitel">{t.crm.filterTitel}</h2>
          <FilterEditor
            felder={z.felder.filter((f) => f.operatoren.length > 0)}
            filter={z.konfig.filter}
            onAnwenden={(g) => {
              z.setzeKonfig({ filter: g as Gruppe | undefined });
              setOffen(null);
            }}
          />
        </Seitenpanel>
      ) : null}
      {offen === "spalten" ? <SpaltenDialog felder={z.felder} spalten={z.konfig.spalten} onAendern={(spalten) => z.setzeKonfig({ spalten })} onSchliessen={() => setOffen(null)} /> : null}
    </div>
  );
}

/** Felder, nach denen sich die Tabelle gruppieren lässt (Auswahl, Mehrfachauswahl, Person im Haus, Verknüpfung, Kontrollkästchen). */
export const istGruppierbar = (f: CrmFeld) => (f.typ === "auswahl" || f.typ === "mehrfachauswahl" || f.typ === "benutzer" || f.typ === "verknuepfung" || f.typ === "kontrollkaestchen") && !f.archiviertAm;

/** Gruppierung der Tabelle wählen; die Wahl steht in der Konfiguration der Ansicht und wird mit ihr gespeichert. */
function GruppierenWahl({ felder, wert, board, onChange }: { felder: CrmFeld[]; wert: string | null; board: boolean; onChange: (schluessel: string | null) => void }) {
  const t = useT();
  // Im Board bilden nur Auswahlfelder Spalten; in der Tabelle sind es auch Mehrfachauswahl, Person im Haus, Verknüpfung und Kontrollkästchen.
  const moegliche = felder.filter((f) => istGruppierbar(f) && (!board || f.typ === "auswahl"));
  const gewaehlt = moegliche.find((f) => f.schluessel === wert);
  if (moegliche.length === 0) return null;
  const text = board ? (gewaehlt ? `${t.crm.spaltenNach}: ${feldName(gewaehlt, t)}` : t.crm.spaltenNach) : gewaehlt ? t.crm.gruppiertNach(feldName(gewaehlt, t)) : t.crm.gruppieren;
  return (
    <Popover
      ausloeser={
        <>
          <StackIcon />
          {text}
        </>
      }
      aria-label={board ? t.crm.darstellungBoard : t.crm.gruppieren}
      ausloeserLabel={text}
      ausloeserKlasse="cw-button cw-button--s cw-button--sekundaer"
      aktiv={Boolean(gewaehlt)}
      kante="links"
    >
      <Auswahl label={board ? t.crm.spaltenNach : t.crm.gruppierenNach} value={gewaehlt?.schluessel ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        {board ? null : <option value="">{t.crm.keineGruppierung}</option>}
        {moegliche.map((f) => (
          <option key={f.schluessel} value={f.schluessel}>
            {feldName(f, t)}
          </option>
        ))}
      </Auswahl>
    </Popover>
  );
}

export type { Bedingung };
