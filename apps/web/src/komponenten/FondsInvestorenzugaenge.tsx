import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Dialog, Feld, Hinweis, Status, Tabelle, formatDatum } from "@carraway/ui";
import { fondsInvestorenzugaenge, useFondsClosingStornieren } from "../api/verwaltung";
import { alle } from "../erweiterung";
import { useSprache, useT } from "../i18n";
import { feldText } from "../i18n/fehler";
import { useRechte } from "../lib/rechte";
import { formatBetragCent, formatSatz } from "../lib/zahl";
import { FehlerHinweis } from "./FehlerHinweis";
import { FondsClosingDialog } from "./FondsClosingDialog";
import { pruefungText } from "./formular";
import { FondsZeichnungDialog } from "./FondsZeichnungDialog";
import { FondsZusageAenderungDialog } from "./FondsZusageAenderungDialog";
import { ZusagenAbdeckung } from "./ZusagenAbdeckung";

export default function FondsInvestorenzugaenge({ fondsId }: { fondsId: string }) {
  const { ich, darf } = useRechte();
  const t = useT();
  if (!ich) return <p className="app-leer-text">{t.gemeinsam.laedt}</p>;
  if (!darf("verwalter", fondsId, "fondsverwaltung")) return <p className="app-leer-text">{t.verwaltung.investoren.fonds.keinZugriff}</p>;
  return <Zugaenge key={fondsId} fondsId={fondsId} verwalten={ich.globalVerwalter} />;
}

function Zugaenge({ fondsId, verwalten }: { fondsId: string; verwalten: boolean }) {
  const t = useT();
  const v = t.verwaltung.investoren;
  const f = v.fonds;
  const sprache = useSprache();
  const { data, isPending, error } = useQuery(fondsInvestorenzugaenge(fondsId));
  const [aktion, setAktion] = useState<"zeichnungen" | "closing" | "aenderung" | null>(null);
  const [erfolg, setErfolg] = useState<string | null>(null);
  const [closingAktion, setClosingAktion] = useState<{ art: "storno" | "korrektur"; closingId: string } | null>(null);

  const zuKorrigieren = closingAktion?.art === "korrektur" ? data?.closings.find((cl) => cl.id === closingAktion.closingId) : undefined;

  function abgeschlossen(text: string) {
    setAktion(null);
    setErfolg(text);
  }

  return (
    <>
      <FehlerHinweis fehler={error} />
      {erfolg ? <Hinweis>{erfolg}</Hinweis> : null}
      {isPending ? <p className="app-leer-text">{t.gemeinsam.laedt}</p> : null}
      {data ? (
        <section className="app-karte" aria-labelledby="fonds-zeichnungen-titel">
          <div className="app-karte__kopf">
            <h2 id="fonds-zeichnungen-titel" className="cw-t-untertitel app-karte__titel">{f.zeichnungen.titel}</h2>
            {verwalten && data.erfassungMoeglich ? (
              <Button variante={data.zeichnungen.length > 0 ? "sekundaer" : "primaer"} onClick={() => setAktion("zeichnungen")}>{data.zeichnungen.length > 0 ? f.zeichnungen.bearbeitenAktion : f.zeichnungen.anlegen}</Button>
            ) : null}
            {verwalten && data.closingMoeglich ? (
              <div className="app-knoepfe">
                <Button variante="sekundaer" onClick={() => setAktion("aenderung")}>{f.closing.aenderung.anlegen}</Button>
                <Button variante="sekundaer" onClick={() => setAktion("closing")}>{f.closing.anlegen}</Button>
              </div>
            ) : null}
          </div>
          {data.vollstaendig !== false ? null : (
            <ZusagenAbdeckung
              abgedeckt={data.abgedeckt}
              zeichnungskapital={data.zeichnungskapital}
              waehrung={data.waehrung}
              aktion={verwalten && data.erfassungMoeglich ? <Button variante="ruhig" onClick={() => setAktion("zeichnungen")}>{t.portfolio.zusagen.zumVervollstaendigen}</Button> : undefined}
            />
          )}
          {data.zeichnungen.length > 0 ? (
            <Tabelle
              beschriftung={f.zeichnungen.titel}
              zeilen={data.zeichnungen}
              zeilenSchluessel={(zeichnung) => zeichnung.id}
              spalten={[
                { schluessel: "name", kopf: v.form.organisation, zelle: (zeichnung) => zeichnung.name },
                { schluessel: "zusage", kopf: f.zeichnungen.zusage, zahl: true, zelle: (zeichnung) => formatBetragCent(zeichnung.zusage, sprache, data.waehrung) },
                { schluessel: "anteil", kopf: f.zeichnungen.anteil, zahl: true, zelle: (zeichnung) => formatSatz(zeichnung.anteil, sprache) },
                ...(data.zeichnungen.some((zeichnung) => zeichnung.ausgetreten)
                  ? [{ schluessel: "status", kopf: f.closing.status, zelle: (zeichnung: { ausgetreten: boolean }) => (zeichnung.ausgetreten ? <Status variante="fehlt">{f.closing.statusAusgetreten}</Status> : <Status variante="freigegeben">{f.closing.statusAktiv}</Status>) }]
                  : []),
              ]}
            />
          ) : (
            <p className="app-leer-text">{verwalten && !data.erfassungMoeglich ? f.zeichnungen.gesperrt : f.keineOrganisationen}</p>
          )}
        </section>
      ) : null}
      {data && data.closings.length > 0 ? (
        <section className="app-karte" aria-labelledby="fonds-closings-titel">
          <div className="app-karte__kopf">
            <h2 id="fonds-closings-titel" className="cw-t-untertitel app-karte__titel">{f.closing.tabelle}</h2>
          </div>
          <Tabelle
            beschriftung={f.closing.tabelle}
            zeilen={data.closings.flatMap((cl) => cl.zusagen.map((z, i) => ({ ...z, art: cl.art, wirksamAm: cl.wirksamAm, closingId: cl.id, storno: cl.storno, stornierbar: cl.stornierbar, erste: i === 0 })))}
            zeilenSchluessel={(z) => `${z.closingId}:${z.organisationId}`}
            spalten={[
              { schluessel: "wirksamAm", kopf: f.closing.spalten.wirksamAm, zelle: (z) => formatDatum(z.wirksamAm, sprache) },
              { schluessel: "name", kopf: f.closing.spalten.investor, zelle: (z) => z.name },
              { schluessel: "art", kopf: f.closing.spalten.art, zelle: (z) => (z.art === "austritt" ? f.closing.artAustritt : z.art === "verringerung" ? f.closing.artVerringerung : z.beitritt ? f.closing.artBeitritt : f.closing.artAufstockung) },
              { schluessel: "zusage", kopf: f.closing.spalten.zusage, zahl: true, zelle: (z) => (z.art === "verringerung" || z.art === "austritt" ? "−" : "") + formatBetragCent(z.zusage, sprache, data.waehrung) },
              { schluessel: "ausgleich", kopf: f.closing.spalten.ausgleich, zahl: true, zelle: (z) => (z.ausgleichBetrag ? formatBetragCent(z.ausgleichBetrag, sprache, data.waehrung) : "–") },
              { schluessel: "ausgleichDatum", kopf: f.closing.spalten.ausgleichDatum, zelle: (z) => (z.ausgleichDatum ? formatDatum(z.ausgleichDatum, sprache) : "–") },
              {
                schluessel: "status",
                kopf: f.closing.status,
                zelle: (z) => (z.storno ? <Status variante="fehlt">{f.closing.statusStorniert}</Status> : <Status variante="freigegeben">{f.closing.statusAktiv}</Status>),
              },
              { schluessel: "stornogrund", kopf: f.closing.stornogrund, zelle: (z) => (z.storno ? z.storno.grund : "–") },
              ...(verwalten
                ? [{
                    schluessel: "aktion",
                    kopf: <span className="cw-nur-lesen">{v.spalten.aktion}</span>,
                    zelle: (z: { erste: boolean; stornierbar: boolean; closingId: string; wirksamAm: string; art: string }) =>
                      z.erste && z.stornierbar ? (
                        <div className="app-knoepfe">
                          {z.art !== "verringerung" && z.art !== "austritt" ? <Button variante="ruhig" aria-label={`${f.closing.korrigieren} ${formatDatum(z.wirksamAm, sprache)}`} onClick={() => setClosingAktion({ art: "korrektur", closingId: z.closingId })}>{f.closing.korrigieren}</Button> : null}
                          <Button variante="ruhig" aria-label={`${f.closing.stornieren} ${formatDatum(z.wirksamAm, sprache)}`} onClick={() => setClosingAktion({ art: "storno", closingId: z.closingId })}>{f.closing.stornieren}</Button>
                        </div>
                      ) : null,
                  }]
                : []),
            ]}
          />
        </section>
      ) : null}
      {/* Abschnitte der Erweiterungen (Zugänge der Investoren zum LP-Portal). */}
      {alle("fondsInvestoren").map((Abschnitt, i) => (
        <Abschnitt key={i} fondsId={fondsId} />
      ))}
      {verwalten && data && aktion === "zeichnungen" ? (
        <FondsZeichnungDialog
          fondsId={fondsId}
          zeichnungskapital={data.zeichnungskapital}
          waehrung={data.waehrung}
          zeichnungen={data.zeichnungen}
          abgedeckt={data.abgedeckt}
          onSchliessen={() => setAktion(null)}
        />
      ) : null}
      {verwalten && data && aktion === "closing" ? (
        <FondsClosingDialog
          fondsId={fondsId}
          zeichnungskapital={data.zeichnungskapital}
          waehrung={data.waehrung}
          bestehende={new Set(data.zeichnungen.map((z) => z.id))}
          onSchliessen={() => setAktion(null)}
          onErfolg={() => abgeschlossen(f.closing.gespeichert)}
        />
      ) : null}
      {verwalten && data && aktion === "aenderung" ? (
        <FondsZusageAenderungDialog
          fondsId={fondsId}
          zeichnungskapital={data.zeichnungskapital}
          waehrung={data.waehrung}
          investoren={data.zeichnungen.filter((z) => !z.ausgetreten).map(({ id, name, zusage, abgerufen }) => ({ id, name, zusage, abgerufen }))}
          onSchliessen={() => setAktion(null)}
          onErfolg={() => abgeschlossen(f.closing.aenderung.gespeichert)}
        />
      ) : null}
      {verwalten && data && zuKorrigieren ? (
        <FondsClosingDialog
          fondsId={fondsId}
          zeichnungskapital={data.zeichnungskapital}
          waehrung={data.waehrung}
          bestehende={new Set(data.zeichnungen.filter((z) => !zuKorrigieren.zusagen.some((x) => x.organisationId === z.id && x.beitritt)).map((z) => z.id))}
          korrektur={{ ...zuKorrigieren, closingId: zuKorrigieren.id }}
          onSchliessen={() => setClosingAktion(null)}
          onErfolg={() => {
            setClosingAktion(null);
            setErfolg(f.closing.korrigiertText);
          }}
        />
      ) : null}
      {verwalten && data && closingAktion?.art === "storno" ? (
        <ClosingStornoDialog
          fondsId={fondsId}
          closingId={closingAktion.closingId}
          wirksamAm={formatDatum(data.closings.find((cl) => cl.id === closingAktion.closingId)?.wirksamAm ?? "", sprache)}
          onSchliessen={() => setClosingAktion(null)}
          onErfolg={() => {
            setClosingAktion(null);
            setErfolg(f.closing.storniert);
          }}
        />
      ) : null}
    </>
  );
}

interface DialogAktionen {
  fondsId: string;
  onSchliessen: () => void;
  onErfolg: () => void;
}

/** Bestätigung der Stornierung eines weiteren Closings mit Pflichtgrund (Issue #126). */
function ClosingStornoDialog({ fondsId, closingId, wirksamAm, onSchliessen, onErfolg }: DialogAktionen & { closingId: string; wirksamAm: string }) {
  const t = useT();
  const sprache = useSprache();
  const c = t.verwaltung.investoren.fonds.closing;
  const storno = useFondsClosingStornieren(fondsId);
  const [grund, setGrund] = useState("");
  const [geprueft, setGeprueft] = useState(false);
  const fehlt = grund.trim() === "";
  return (
    <Dialog
      titel={c.stornoTitel}
      onSchliessen={onSchliessen}
      aktionen={
        <>
          <Button variante="sekundaer" onClick={onSchliessen}>{t.gemeinsam.schliessen}</Button>
          <Button
            variante="gefahr"
            disabled={storno.isPending}
            onClick={() => {
              setGeprueft(true);
              if (!fehlt) storno.mutate({ closingId, grund: grund.trim() }, { onSuccess: onErfolg });
            }}
          >
            {c.stornoTitel}
          </Button>
        </>
      }
    >
      <p>{c.stornoText(wirksamAm)}</p>
      <Feld label={c.stornoGrund} required value={grund} onChange={(e) => setGrund(e.target.value)} fehler={geprueft && fehlt ? pruefungText(sprache, { code: "pflicht" }) : feldText(t, storno.error, "grund")} />
      <FehlerHinweis fehler={storno.error} bekannt={["grund"]} />
    </Dialog>
  );
}
