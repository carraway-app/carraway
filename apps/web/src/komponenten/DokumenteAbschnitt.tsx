import { useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Auswahl, Button, Dialog, Hinweis, Tabelle, formatDatum, type TabelleSpalte } from "@carraway/ui";
import { dokumenteZiel, dokumentDateiUrl, KLASSIFIKATIONEN, MAX_DOKUMENT, useDokumentErsetzen, useDokumentHochladen, useDokumentLoeschen, type DokumentZeile, type Klassifikation, type ZielTyp } from "../api/dokumente";
import { ApiFehler } from "../api/client";
import { fehlerText } from "../i18n/fehler";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { useRechte } from "../lib/rechte";
import { DateiDropzone } from "./DateiDropzone";
import { FehlerHinweis } from "./FehlerHinweis";
import { alle } from "../erweiterung";
import { Skelettzeilen } from "./Skelett";

const DOKUMENTFORMATE = ".pdf,.png,.jpg,.jpeg,.docx,.xlsx";

export const groesseText = (bytes: number, sprache: "de" | "en"): string => {
  const f = (n: number) => n.toLocaleString(sprache === "de" ? "de-DE" : "en-GB", { maximumFractionDigits: 1 });
  return bytes >= 1024 * 1024 ? `${f(bytes / 1024 / 1024)} MB` : `${f(Math.max(1, bytes / 1024))} KB`;
};

/**
 * Dokumente an einem Datensatz (Beteiligung, Deal, Organisation, Fonds): Liste, Hochladen mit Drag and drop, neue Version, weiches Löschen
 * und die Aktionen der Erweiterungen (z. B. die KI-Auslesung). Welche Dokumente erscheinen, entscheidet die API nach den Rechten an den Zielen; die Oberfläche
 * bietet nur an, was die Rolle erlaubt (`fondsId` leer: die Rolle an irgendeinem Fonds).
 */
export function DokumenteAbschnitt({ zielTyp, zielId, fondsId, lesend = false }: { zielTyp: ZielTyp; zielId: string; fondsId?: string | null; lesend?: boolean }) {
  const t = useT();
  const d = t.dokumente;
  const sprache = useSprache();
  const { darf } = useRechte();
  const { data, error, isPending } = useQuery(dokumenteZiel(zielTyp, zielId));
  const hochladen = useDokumentHochladen();
  const ersetzen = useDokumentErsetzen();
  const loeschen = useDokumentLoeschen();
  const [klassifikation, setKlassifikation] = useState<Klassifikation>("sonstiges");
  const [vertraulich, setVertraulich] = useState(false);
  const [laedt, setLaedt] = useState(false);
  const laedtRef = useRef(false);
  const [versionFuer, setVersionFuer] = useState<DokumentZeile | null>(null);
  const [versionsfehler, setVersionsfehler] = useState<string | null>(null);
  const [meldungen, setMeldungen] = useState<{ art: "fehler" | "erfolg"; text: string }[]>([]);
  const [loeschFrage, setLoeschFrage] = useState<string | null>(null);
  const vertraulichId = useId();
  const vertraulichHinweisId = `${vertraulichId}-hinweis`;
  const darfSchreiben = darf("bearbeiter", fondsId, "dokumente") && !lesend;
  const darfLoeschen = darf("verwalter", fondsId, "dokumente") && !lesend;
  // Aktionen der Erweiterungen je Dokument (z. B. die KI-Auslesung); sie entscheiden selbst, ob sie erscheinen.
  const zusatzAktionen = alle("dokumentAktion");

  function grund(fehler: unknown) {
    return fehlerText(t, fehler instanceof ApiFehler ? fehler : new ApiFehler("UNBEKANNT", 0));
  }

  async function ladeHoch(dateien: File[]) {
    if (!darfSchreiben || versionFuer || laedtRef.current || dateien.length === 0) return;
    laedtRef.current = true;
    setLaedt(true);
    setMeldungen([]);
    const neu: typeof meldungen = [];
    let ok = 0;
    try {
      for (const datei of dateien) {
        if (datei.size > MAX_DOKUMENT) {
          neu.push({ art: "fehler", text: d.hochladen.fehlerFuer(datei.name, d.hochladen.zuGross) });
          continue;
        }
        try {
          await hochladen.mutateAsync({ datei, ziele: [{ typ: zielTyp, id: zielId }], klassifikation, vertraulich });
          ok++;
        } catch (fehler) {
          neu.push({ art: "fehler", text: d.hochladen.fehlerFuer(datei.name, grund(fehler)) });
        }
      }
      if (ok > 0) neu.unshift({ art: "erfolg", text: d.hochladen.fertig(ok) });
      setMeldungen(neu);
    } finally {
      laedtRef.current = false;
      setLaedt(false);
    }
  }

  async function ladeVersionHoch(dateien: File[]) {
    if (!darfSchreiben || !versionFuer || laedtRef.current || dateien.length === 0) return;
    if (dateien.length !== 1) {
      setVersionsfehler(d.version.einzeln);
      return;
    }
    const datei = dateien[0]!;
    if (datei.size > MAX_DOKUMENT) {
      setVersionsfehler(d.hochladen.fehlerFuer(datei.name, d.hochladen.zuGross));
      return;
    }
    laedtRef.current = true;
    setLaedt(true);
    setVersionsfehler(null);
    try {
      await ersetzen.mutateAsync({ id: versionFuer.id, datei });
      setVersionFuer(null);
      setMeldungen([{ art: "erfolg", text: d.version.fertig(versionFuer.dateiname) }]);
    } catch (fehler) {
      setVersionsfehler(d.hochladen.fehlerFuer(datei.name, grund(fehler)));
    } finally {
      laedtRef.current = false;
      setLaedt(false);
    }
  }

  function schliesseVersion() {
    if (!laedtRef.current) setVersionFuer(null);
  }

  const spalten: TabelleSpalte<DokumentZeile>[] = [
    {
      schluessel: "name",
      kopf: d.spalten.name,
      zelle: (z) => (
        <>
          <Link to="/documents/$id" params={{ id: z.id }} search={{}}>
            {z.dateiname}
          </Link>
          {z.vertraulich ? <>{" · "}<span className="app-leer-text">{d.vertraulich}</span></> : null}
          <>{" · "}<span className="app-leer-text">{aufzaehlung(d.textStatus, z.textStatus)}</span></>
        </>
      ),
    },
    { schluessel: "klassifikation", kopf: d.spalten.klassifikation, zelle: (z) => aufzaehlung(d.klassifikation, z.klassifikation) },
    { schluessel: "groesse", kopf: d.spalten.groesse, zahl: true, zelle: (z) => groesseText(z.groesse, sprache) },
    {
      schluessel: "verknuepfungen",
      kopf: d.spalten.verknuepfungen,
      zelle: (z) => (
        <ul className="app-liste-klein">
          {z.verknuepfungen.map((v) => (
            <li key={`${v.typ}${v.id}`}>
              {aufzaehlung(d.zielTyp, v.typ)}: {v.name ?? t.gemeinsam.keinWert}
            </li>
          ))}
        </ul>
      ),
    },
    { schluessel: "hochgeladen", kopf: d.spalten.hochgeladen, zelle: (z) => `${formatDatum(z.hochgeladenAm.slice(0, 10), sprache)}${z.hochgeladenVonName ? ` · ${z.hochgeladenVonName}` : ""}` },
    {
      schluessel: "aktion",
      kopf: d.spalten.aktion,
      zelle: (z) => (
        <div className="app-aktionen__knoepfe">
          <a className="cw-button cw-button--ruhig" href={dokumentDateiUrl(z.id)} download aria-label={d.aktionFuer(d.herunterladen, z.dateiname)}>
            {d.herunterladen}
          </a>
          {darfSchreiben ? (
            <Button
              variante="ruhig"
              aria-label={d.aktionFuer(d.ersetzen, z.dateiname)}
              disabled={laedt}
              onClick={() => {
                setVersionsfehler(null);
                setVersionFuer(z);
              }}
            >
              {d.ersetzen}
            </Button>
          ) : null}
          {zusatzAktionen.map((Aktion, i) => (
            <Aktion key={i} dokument={z} darfSchreiben={darfSchreiben} />
          ))}
          {darfLoeschen ? (
            loeschFrage === z.id ? (
              <span role="group" aria-label={d.loeschenFrage(z.dateiname)}>
                <Button
                  variante="ruhig"
                  onClick={() => {
                    setLoeschFrage(null);
                    loeschen.mutate(z.id);
                  }}
                >
                  {d.loeschenJa}
                </Button>
                <Button variante="ruhig" onClick={() => setLoeschFrage(null)}>
                  {d.abbrechen}
                </Button>
              </span>
            ) : (
              <Button variante="ruhig" aria-label={d.aktionFuer(d.loeschen, z.dateiname)} onClick={() => setLoeschFrage(z.id)}>
                {d.loeschen}
              </Button>
            )
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <section className="app-karte">
      <div className="app-karte__kopf">
        <h2 id={`dokumente-titel-${zielTyp}`} className="cw-t-untertitel app-karte__titel">
          {d.titel}
        </h2>
      </div>
      <p className="app-leer-text">{d.beschreibung}</p>
      {darfSchreiben ? (
        <div className="app-dokument-upload">
          <div className="app-dokument-upload__optionen">
            <Auswahl kompakt label={d.hochladen.klassifikation} value={klassifikation} disabled={laedt} onChange={(e) => setKlassifikation(e.target.value as Klassifikation)}>
              {KLASSIFIKATIONEN.map((k) => (
                <option key={k} value={k}>
                  {aufzaehlung(d.klassifikation, k)}
                </option>
              ))}
            </Auswahl>
            <label className="app-dokument-upload__vertraulich">
              <input
                type="checkbox"
                checked={vertraulich}
                disabled={laedt}
                aria-labelledby={vertraulichId}
                aria-describedby={vertraulichHinweisId}
                onChange={(e) => setVertraulich(e.target.checked)}
              />
              <span>
                <span id={vertraulichId}>{d.hochladen.vertraulichFeld}</span>
                <span id={vertraulichHinweisId} className="app-dokument-upload__hinweis">{d.hochladen.vertraulichHinweis}</span>
              </span>
            </label>
          </div>
          <DateiDropzone
            label={d.hochladen.datei}
            hinweis={d.hochladen.erlaubt}
            auswahlText={laedt && !versionFuer ? d.hochladen.laeuft : d.hochladen.datei}
            accept={DOKUMENTFORMATE}
            mehrfach
            deaktiviert={laedt || Boolean(versionFuer)}
            testId="dokument-ablage"
            onDateien={(dateien) => void ladeHoch(dateien)}
          />
        </div>
      ) : null}
      {meldungen.map((m, i) => (
        <Hinweis key={i} variante={m.art === "fehler" ? "fehler" : "info"}>
          {m.text}
        </Hinweis>
      ))}
      <FehlerHinweis fehler={loeschen.error} />
      {isPending ? <Skelettzeilen anzahl={2} /> : null}
      {error ? <FehlerHinweis fehler={error} /> : null}
      {data && data.length === 0 ? <p className="app-leer-text">{d.keine}</p> : null}
      {data && data.length > 0 ? <Tabelle beschriftung={d.tabelle} spalten={spalten} zeilen={data} zeilenSchluessel={(z) => z.id} /> : null}
      {darfSchreiben && versionFuer ? (
        <Dialog
          titel={d.aktionFuer(d.ersetzen, versionFuer.dateiname)}
          onSchliessen={schliesseVersion}
          aktionen={<Button variante="sekundaer" disabled={laedt} onClick={schliesseVersion}>{d.abbrechen}</Button>}
        >
          <DateiDropzone
            label={d.version.datei}
            mehrfachAblage
            hinweis={d.hochladen.erlaubt}
            auswahlText={laedt ? d.hochladen.laeuft : d.version.datei}
            accept={DOKUMENTFORMATE}
            deaktiviert={laedt}
            testId="dokument-versionsablage"
            onDateien={(dateien) => void ladeVersionHoch(dateien)}
          />
          {versionsfehler ? <Hinweis variante="fehler">{versionsfehler}</Hinweis> : null}
        </Dialog>
      ) : null}
    </section>
  );
}
