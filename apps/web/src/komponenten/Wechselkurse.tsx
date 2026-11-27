import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Feld, Hinweis, Seitenpanel, Status, Tabelle, Textbereich, formatDatum, type TabelleSpalte } from "@carraway/ui";
import { kursListe, useKursAnlegen, useKursImport, type Kurs, type KursImportErgebnis } from "../api/waehrung";
import { heuteIso } from "../api/datum";
import { useSprache, useT } from "../i18n";
import { formatZeitpunkt } from "../lib/zeit";
import { DateiDropzone } from "./DateiDropzone";
import { BetragFeld } from "./BetragFeld";
import { WaehrungAuswahl } from "./WaehrungAuswahl";
import { betragOderNichts, useFormular } from "./formular";
import { feldText } from "../i18n/fehler";
import { betragRegel, datumRegel, waehrungRegel } from "../lib/feldpruefung";
import { FehlerHinweis } from "./FehlerHinweis";
import { formatKurs } from "./Waehrungsleiste";

/**
 * Kurstabelle für globale Verwalter (Etappe 21): Kurse ansehen, von Hand erfassen, korrigieren (neuer Eintrag mit Grund, der alte bleibt) und aus einer Datei
 * importieren (erst prüfen, dann übernehmen). Es gibt keinen Abruf aus dem Netz.
 */
export function Wechselkurse() {
  const t = useT();
  const k = t.waehrung.kurse;
  const sprache = useSprache();
  const [alle, setAlle] = useState(false);
  const [dialog, setDialog] = useState<null | { korrektur?: Kurs } | "import">(null);
  const { data, error, isPending } = useQuery(kursListe({ alle }));
  const spalten: TabelleSpalte<Kurs>[] = [
    { schluessel: "datum", kopf: k.spalten.datum, zelle: (z) => <span className="app-zahl">{formatDatum(z.datum, sprache)}</span> },
    { schluessel: "paar", kopf: k.spalten.paar, zelle: (z) => `${z.basis}/${z.quote}` },
    { schluessel: "kurs", kopf: k.spalten.kurs, zahl: true, zelle: (z) => formatKurs(z.kurs, sprache) },
    { schluessel: "quelle", kopf: k.spalten.quelle, zelle: (z) => (z.quelleDatei ? `${k.quelle[z.quelle] ?? z.quelle}: ${z.quelleDatei}` : (k.quelle[z.quelle] ?? z.quelle)) },
    { schluessel: "erfasst", kopf: k.spalten.erfasst, zelle: (z) => formatZeitpunkt(z.erfasstAm, sprache) },
    { schluessel: "status", kopf: t.waehrung.kurse.gilt, zelle: (z) => <Status variante={z.gilt ? "freigegeben" : "pruefung"}>{z.gilt ? k.gilt : k.ersetzt}</Status> },
    {
      schluessel: "aktion",
      kopf: <span className="cw-nur-lesen">{k.spalten.aktion}</span>,
      zelle: (z) =>
        z.gilt ? (
          <Button variante="ruhig" aria-label={k.korrigierenFuer(`${z.basis}/${z.quote}`, formatDatum(z.datum, sprache))} onClick={() => setDialog({ korrektur: z })}>
            {k.korrigieren}
          </Button>
        ) : (
          t.gemeinsam.keinWert
        ),
    },
  ];
  return (
    <section className="app-gruppe" aria-label={k.titel}>
      <h2 className="cw-t-untertitel">{k.titel}</h2>
      <p className="app-leer-text">{k.beschreibung}</p>
      <p className="app-leer-text">{k.regel}</p>
      <div className="app-aktionen__knoepfe">
        <Button onClick={() => setDialog({})}>{k.erfassen}</Button>
        <Button variante="sekundaer" onClick={() => setDialog("import")}>
          {k.importieren}
        </Button>
        <Button variante="ruhig" aria-pressed={alle} onClick={() => setAlle(!alle)}>
          {alle ? k.nurGueltige : k.mitErsetzten}
        </Button>
      </div>
      {error ? <FehlerHinweis fehler={error} /> : null}
      {isPending ? <p aria-busy="true">{t.gemeinsam.laedt}</p> : null}
      {data && data.length === 0 ? <p className="app-leer-text">{k.keine}</p> : null}
      {data && data.length > 0 ? <Tabelle dicht beschriftung={k.tabelle} spalten={spalten} zeilen={data} zeilenSchluessel={(z) => z.id} /> : null}
      {dialog === "import" ? <ImportDialog onSchliessen={() => setDialog(null)} /> : dialog ? <KursDialog {...(dialog.korrektur ? { korrektur: dialog.korrektur } : {})} onSchliessen={() => setDialog(null)} /> : null}
    </section>
  );
}

function KursDialog({ korrektur, onSchliessen }: { korrektur?: Kurs; onSchliessen: () => void }) {
  const t = useT();
  const f = t.waehrung.kurse.form;
  const anlegen = useKursAnlegen();
  const sprache = useSprache();
  const { werte, feld, pruefeAlle } = useFormular(
    { datum: korrektur?.datum ?? heuteIso(), basis: korrektur?.basis ?? "EUR", quote: korrektur?.quote ?? "USD", kurs: korrektur?.kurs ?? "", grund: "" },
    {
      datum: datumRegel({ pflicht: true }),
      basis: waehrungRegel({ pflicht: true }),
      quote: (w, ws, k) => waehrungRegel<typeof ws>({ pflicht: true })(w, ws, k) ?? (w === ws.basis ? { code: "waehrungGleich" } : undefined),
      // Wie die API: höchstens zehn Stellen vor und acht nach dem Komma, größer als null.
      kurs: betragRegel({ vorzeichen: "positiv", pflicht: true, nachkomma: 8, ganzstellen: 10 }),
      grund: (w) => (korrektur && w.trim() === "" ? { code: "pflicht" } : undefined),
    },
  );
  const fehler = (name: string) => feldText(t, anlegen.error, name);
  const titel = korrektur ? f.titelKorrektur : f.titelNeu;
  const vorhanden = anlegen.error && "code" in anlegen.error && (anlegen.error as { code: string }).code === "rate_exists" ? String((anlegen.error as { zusatz?: { kurs?: string } }).zusatz?.kurs ?? "") : null;
  return (
    <Seitenpanel titel={titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{titel}</h2>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!pruefeAlle()) return;
          anlegen.mutate(
            {
              datum: werte.datum,
              basis: werte.basis.trim().toUpperCase(),
              quote: werte.quote.trim().toUpperCase(),
              kurs: betragOderNichts(werte.kurs, sprache) ?? "",
              ...(korrektur ? { korrigiertKursId: korrektur.id, grund: werte.grund.trim() } : {}),
            },
            { onSuccess: onSchliessen },
          );
        }}
      >
        <FehlerHinweis fehler={anlegen.error} bekannt={["datum", "basis", "quote", "kurs", "grund"]} />
        {vorhanden ? <Hinweis>{f.vorhanden(vorhanden)}</Hinweis> : null}
        <Feld label={f.datum} type="date" required {...feld("datum", fehler("datum"))} readOnly={Boolean(korrektur)} />
        <WaehrungAuswahl label={f.basis} required {...feld("basis", fehler("basis"))} disabled={Boolean(korrektur)} />
        <WaehrungAuswahl label={f.quote} required {...feld("quote", fehler("quote"))} disabled={Boolean(korrektur)} />
        <BetragFeld label={f.kurs} hilfe={f.kursHilfe} required {...feld("kurs", fehler("kurs"))} />
        {korrektur ? <Textbereich label={f.grund} rows={2} required {...feld("grund", fehler("grund"))} /> : null}
        <div>
          <Button type="submit" disabled={anlegen.isPending}>
            {korrektur ? f.korrekturSpeichern : f.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

function ImportDialog({ onSchliessen }: { onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const i = t.waehrung.kurse.import;
  const importieren = useKursImport();
  const [inhalt, setInhalt] = useState<{ name: string; text: string } | null>(null);
  const [waehrungen, setWaehrungen] = useState("");
  const [ab, setAb] = useState("");
  const [ergebnis, setErgebnis] = useState<KursImportErgebnis | null>(null);
  const [leer, setLeer] = useState(false);

  const optionen = () => ({
    waehrungen: waehrungen
      .split(/[\s,;]+/)
      .map((x) => x.trim().toUpperCase())
      .filter((x) => x !== ""),
    ...(ab ? { ab } : {}),
  });
  const los = (vorschau: boolean) => {
    if (!inhalt) {
      setLeer(true);
      return;
    }
    setLeer(false);
    const o = optionen();
    importieren.mutate({ inhalt: inhalt.text, dateiname: inhalt.name, vorschau, ...(o.waehrungen.length ? { waehrungen: o.waehrungen } : {}), ...(o.ab ? { ab: o.ab } : {}) }, { onSuccess: setErgebnis });
  };
  return (
    <Seitenpanel titel={i.titel} onSchliessen={onSchliessen} breit>
      <h2 className="cw-t-untertitel">{i.titel}</h2>
      <p className="app-leer-text">{i.beschreibung}</p>
      <div className="app-formular">
        <FehlerHinweis fehler={importieren.error} />
        <DateiDropzone
          label={i.datei}
          accept=".csv,.txt,text/csv,text/plain"
          dateiname={inhalt?.name}
          deaktiviert={importieren.isPending}
          onDateien={async ([datei]) => {
            setErgebnis(null);
            if (datei) setInhalt({ name: datei.name, text: await datei.text() });
          }}
        />
        {leer ? <Hinweis>{i.dateiLeer}</Hinweis> : null}
        <Feld label={i.waehrungen} hilfe={i.waehrungenHilfe} value={waehrungen} onChange={(e) => setWaehrungen(e.target.value)} />
        <Feld label={i.ab} type="date" value={ab} onChange={(e) => setAb(e.target.value)} />
        <div className="app-aktionen__knoepfe">
          <Button variante="sekundaer" disabled={importieren.isPending} onClick={() => los(true)}>
            {i.pruefen}
          </Button>
          <Button disabled={importieren.isPending || !ergebnis || ergebnis.uebernommen || ergebnis.neu === 0} onClick={() => los(false)}>
            {i.uebernehmen}
          </Button>
        </div>
        {ergebnis ? (
          <div className="app-gruppe" role="status">
            <p>
              <strong>{i.format[ergebnis.format] ?? ergebnis.format}</strong>: {ergebnis.uebernommen ? i.uebernommen(ergebnis.neu) : i.ergebnis(ergebnis.neu, ergebnis.unveraendert, ergebnis.abweichendAnzahl)}
            </p>
            {ergebnis.abweichend.length > 0 ? (
              <Hinweis titel={i.abweichendTitel}>
                <ul className="app-waehrungsleiste__luecken">
                  {ergebnis.abweichend.slice(0, 8).map((a, n) => (
                    <li key={n}>{i.abweichendZeile(`${a.basis}/${a.quote}`, formatDatum(a.datum, sprache), formatKurs(a.kurs, sprache), formatKurs(a.vorhanden, sprache))}</li>
                  ))}
                </ul>
              </Hinweis>
            ) : null}
            {ergebnis.dateifehler.length > 0 ? (
              <Hinweis titel={i.fehlerTitel}>
                <ul className="app-waehrungsleiste__luecken">
                  {ergebnis.dateifehler.slice(0, 8).map((f, n) => (
                    <li key={n}>{i.fehlerZeile(f.zeile, i.dateifehler[f.code]?.(f.wert) ?? f.meldung)}</li>
                  ))}
                </ul>
              </Hinweis>
            ) : null}
          </div>
        ) : null}
      </div>
    </Seitenpanel>
  );
}
