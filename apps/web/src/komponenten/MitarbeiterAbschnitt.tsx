import { useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Dialog, Feld, Hinweis, Karte, Kennwerte, Segment, Seitenpanel, Status, Tabelle, formatDatum, type MenueEintrag, type TabelleSpalte } from "@carraway/ui";
import { finanzierungsrunden, mitarbeiterpools, type Mitarbeiterpool, type Mitarbeiterzuteilung } from "../api/abfragen";
import { heuteIso } from "../api/datum";
import { dokumenteZiel } from "../api/dokumente";
import {
  useAustrittAendern,
  useAustrittAnlegen,
  useAustrittEntfernen,
  usePoolAendern,
  usePoolAenderung,
  usePoolAenderungAendern,
  usePoolAenderungLoeschen,
  usePoolAnlegen,
  useZuteilungAendern,
  useZuteilungAnlegen,
  useZuteilungAnonymisieren,
  useZuteilungLoeschen,
} from "../api/mutationen";
import { feldText } from "../i18n/fehler";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { anteilZuProzent, formatAnzahl, formatPreis, prozentZuAnteil } from "../lib/zahl";
import { FehlerHinweis } from "./FehlerHinweis";
import { betragOderNichts, textOderNichts, useFormular, useZeilenpruefung } from "./formular";
import { MitarbeiterAusuebungen } from "./MitarbeiterAusuebungen";
import { LeaverStufenFelder, VestingStufenFelder, type LeaverZeile, type VestingZeile } from "./MitarbeiterStufen";
import { Skelettzeilen } from "./Skelett";

type Aenderung = Mitarbeiterpool["aenderungen"][number];
type Dialog =
  | { art: "pool" }
  | { art: "schaetzung"; pool: Mitarbeiterpool }
  | { art: "aenderung"; pool: Mitarbeiterpool; aenderung?: Aenderung }
  | { art: "aenderung_loeschen"; pool: Mitarbeiterpool; aenderung: Aenderung }
  | { art: "zuteilung"; pool: Mitarbeiterpool; zuteilung?: Mitarbeiterzuteilung }
  | { art: "zuteilung_anonymisieren" | "zuteilung_loeschen"; pool: Mitarbeiterpool; zuteilung: Mitarbeiterzuteilung };
type Austritt = Mitarbeiterzuteilung["austritte"][number];
const TAKTE = ["1", "3", "6", "12"] as const;
/** Bindung eines Formularfelds aus `useFormular().feld`. */
type FeldBindung = Partial<ComponentProps<typeof Feld>>;

/** Ganze Einheiten als BigInt (exakt, auch über 2^53); leer oder ungültig: null. */
const ganz = (wert: string): bigint | null => (/^\d{1,18}$/.test(wert.trim()) ? BigInt(wert.trim()) : null);

/** Bezeichnung einer Zuteilung in Menüs und Dialogen: Kennung, sonst Kategorie (der Name erscheint nur im Formular). */
function zuteilungsName(m: ReturnType<typeof useT>["mitarbeiter"], z: Mitarbeiterzuteilung): string {
  return z.kennung ?? (z.bezeichnung ? `${aufzaehlung(m.kategorie, z.kategorie)} · ${z.bezeichnung}` : aufzaehlung(m.kategorie, z.kategorie));
}

/**
 * Mitarbeiterbeteiligung eines Unternehmens: je Pool (ESOP oder VSOP) Größe, zugeteilt, frei und ausgeübt zum Stichtag. Ein Pool ist grob erfasst
 * (geschätzt vergebene Einheiten und mittlerer Basispreis) oder einzeln mit Zuteilungen je Person oder Vertrag (Kennung als Standard, Name optional).
 * Einzelzuteilungen sieht nur, wer den Bereich Einzelzuteilungen hat; sonst stehen nur die Summen da.
 */
export function MitarbeiterAbschnitt({ organisationId, stichtag, darfSchreiben }: { organisationId: string; stichtag: string; darfSchreiben: boolean }) {
  const t = useT();
  const m = t.mitarbeiter;
  const { data, error, isPending } = useQuery(mitarbeiterpools(organisationId, stichtag));
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // Nach dem Erfassen eines Austritts lädt die Abfrage neu; der Dialog zeigt die Zuteilung aus den aktuellen Daten.
  const offeneZuteilung =
    dialog?.art === "zuteilung" && dialog.zuteilung ? (data?.find((p) => p.id === dialog.pool.id)?.zuteilungen.find((z) => z.id === dialog.zuteilung?.id) ?? dialog.zuteilung) : undefined;
  const schliessen = () => setDialog(null);

  return (
    <section className="app-karte" aria-labelledby="mitarbeiter-titel">
      <div className="app-karte__kopf">
        <h2 id="mitarbeiter-titel" className="cw-t-untertitel app-karte__titel">
          {m.titel}
        </h2>
        {darfSchreiben ? <Button onClick={() => setDialog({ art: "pool" })}>{m.neu}</Button> : null}
      </div>
      <p className="app-leer-text">{m.beschreibung}</p>
      {isPending ? <Skelettzeilen anzahl={2} /> : null}
      {error ? <FehlerHinweis fehler={error} /> : null}
      {data && data.length === 0 ? <p className="app-leer-text">{m.keine}</p> : null}
      {data?.map((pool) => <PoolKarte key={pool.id} organisationId={organisationId} pool={pool} darfSchreiben={darfSchreiben} onDialog={setDialog} />)}
      {dialog?.art === "pool" ? <PoolDialog organisationId={organisationId} onSchliessen={schliessen} /> : null}
      {dialog?.art === "schaetzung" ? <SchaetzungDialog organisationId={organisationId} pool={dialog.pool} onSchliessen={schliessen} /> : null}
      {dialog?.art === "aenderung" ? <AenderungDialog organisationId={organisationId} pool={dialog.pool} {...(dialog.aenderung ? { aenderung: dialog.aenderung } : {})} onSchliessen={schliessen} /> : null}
      {dialog?.art === "aenderung_loeschen" ? <AenderungLoeschenDialog organisationId={organisationId} pool={dialog.pool} aenderung={dialog.aenderung} onSchliessen={schliessen} /> : null}
      {dialog?.art === "zuteilung" ? <ZuteilungDialog organisationId={organisationId} pool={dialog.pool} {...(offeneZuteilung ? { zuteilung: offeneZuteilung } : {})} onSchliessen={schliessen} /> : null}
      {dialog?.art === "zuteilung_anonymisieren" || dialog?.art === "zuteilung_loeschen" ? (
        <ZuteilungBestaetigen organisationId={organisationId} art={dialog.art} pool={dialog.pool} zuteilung={dialog.zuteilung} onSchliessen={schliessen} />
      ) : null}
    </section>
  );
}

function PoolKarte({ organisationId, pool, darfSchreiben, onDialog }: { organisationId: string; pool: Mitarbeiterpool; darfSchreiben: boolean; onDialog: (d: Dialog) => void }) {
  const t = useT();
  const m = t.mitarbeiter;
  const sprache = useSprache();
  const umstellen = usePoolAendern(organisationId);
  const zahl = (wert: string) => <span className="app-zahl">{formatAnzahl(wert, sprache)}</span>;
  const grob = pool.erfassung === "grob";
  const zuteilungSpalten: TabelleSpalte<Mitarbeiterzuteilung>[] = [
    {
      // Kennung (oder „anonymisiert“) mit Kategorie darunter; der Name steht nicht in der Tabelle.
      schluessel: "kennung",
      kopf: m.spalten.kennung,
      umbruch: true,
      zelle: (z) => (
        <>
          {z.kennung ?? (z.anonymisiertAm ? m.anonymisiert : m.ohneKennung)}
          <span className="app-zelle-zusatz">{z.bezeichnung ? `${aufzaehlung(m.kategorie, z.kategorie)} · ${z.bezeichnung}` : aufzaehlung(m.kategorie, z.kategorie)}</span>
        </>
      ),
    },
    {
      schluessel: "anzahl",
      kopf: m.spalten.anzahl,
      zahl: true,
      umbruch: true,
      zelle: (z) => (
        <>
          {formatAnzahl(z.anzahl, sprache)}
          <span className="app-zelle-zusatz">{`${m.spalten.zugeteilt} ${formatDatum(z.zugeteiltAm, sprache)}`}</span>
        </>
      ),
    },
    { schluessel: "basispreis", kopf: m.spalten.basispreis, zahl: true, zelle: (z) => formatPreis(z.basispreis, sprache) },
    { schluessel: "vesting", kopf: m.spalten.vesting, zelle: (z) => z.vestingStufen?.length ? m.stufenPlan : m.vesting(z.cliffMonate, z.vestingMonate, z.taktMonate) },
    { schluessel: "gevestet", kopf: m.spalten.gevestet, zahl: true, zelle: (z) => formatAnzahl(z.gevestet, sprache) },
    ...(pool.art === "esop"
      ? [{ schluessel: "ausgeuebt", kopf: m.kennwerte.ausgeuebt, zahl: true, zelle: (z: Mitarbeiterzuteilung) => formatAnzahl(z.ausgeuebt, sprache) }]
      : []),
    { schluessel: "beimExit", kopf: m.spalten.beimExit, zahl: true, zelle: (z) => formatAnzahl(z.beimExit, sprache) },
    { schluessel: "verfallen", kopf: m.spalten.verfallen, zahl: true, zelle: (z) => formatAnzahl(String(Number(z.verfallen) + Number(z.rueckgekauft)), sprache) },
    { schluessel: "status", kopf: m.spalten.status, zelle: (z) => <ZuteilungsStatus zuteilung={z} stichtag={pool.stand.stichtag} /> },
  ];
  const zuteilungAktionen = (z: Mitarbeiterzuteilung): MenueEintrag[] => [
    { id: "bearbeiten", label: m.bearbeitenFuer(zuteilungsName(m, z)), onClick: () => onDialog({ art: "zuteilung", pool, zuteilung: z }) },
    ...(z.anonymisiertAm === null && (z.kennung !== null || z.name !== null) ? [{ id: "anonymisieren", label: m.anonymisierenFuer(zuteilungsName(m, z)), onClick: () => onDialog({ art: "zuteilung_anonymisieren", pool, zuteilung: z }) }] : []),
    { id: "loeschen", label: m.loeschenFuer(zuteilungsName(m, z)), onClick: () => onDialog({ art: "zuteilung_loeschen", pool, zuteilung: z }) },
  ];
  const verlaufSpalten: TabelleSpalte<Aenderung>[] = [
    { schluessel: "datum", kopf: m.verlaufSpalten.datum, zelle: (a) => formatDatum(a.datum, sprache) },
    { schluessel: "anzahl", kopf: m.verlaufSpalten.anzahl, zahl: true, zelle: (a) => formatAnzahl(a.anzahl, sprache) },
    { schluessel: "runde", kopf: m.verlaufSpalten.runde, zelle: (a) => (a.basis ? aufzaehlung(m.basis, a.basis) : t.gemeinsam.keinWert) },
    { schluessel: "beschluss", kopf: m.verlaufSpalten.beschluss, zelle: (a) => a.beschluss ?? t.gemeinsam.keinWert },
    ...(darfSchreiben
      ? [
          {
            schluessel: "aktion",
            kopf: m.verlaufSpalten.aktion,
            zelle: (a: Aenderung) => (
              <span className="app-aktionen__knoepfe">
                <Button variante="sekundaer" aria-label={m.aenderung.bearbeitenFuer(formatDatum(a.datum, sprache))} onClick={() => onDialog({ art: "aenderung", pool, aenderung: a })}>
                  {m.aenderung.bearbeiten}
                </Button>
                <Button variante="sekundaer" aria-label={m.aenderung.loeschenFuer(formatDatum(a.datum, sprache))} onClick={() => onDialog({ art: "aenderung_loeschen", pool, aenderung: a })}>
                  {m.aenderung.loeschen}
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];
  const erfasst = (BigInt(pool.stand.ausstehend) + BigInt(pool.stand.ausgeuebt)).toString();
  return (
    <Karte
      ebene={3}
      titel={
        <>
          {pool.bezeichnung} <Status>{aufzaehlung(m.art, pool.art)}</Status> <Status variante="pruefung">{aufzaehlung(m.erfassung, pool.erfassung)}</Status>
        </>
      }
      aktion={
        darfSchreiben ? (
          <span className="app-aktionen__knoepfe">
            <Button variante="sekundaer" aria-label={m.aendernFuer(pool.bezeichnung)} onClick={() => onDialog({ art: "aenderung", pool })}>
              {m.aendern}
            </Button>
            <Button variante="sekundaer" aria-label={m.schaetzungFuer(pool.bezeichnung)} onClick={() => onDialog({ art: "schaetzung", pool })}>
              {m.schaetzung}
            </Button>
            {pool.einzelSichtbar ? (
              <Button variante="sekundaer" aria-label={m.zuteilenFuer(pool.bezeichnung)} onClick={() => onDialog({ art: "zuteilung", pool })}>
                {m.zuteilen}
              </Button>
            ) : null}
          </span>
        ) : undefined
      }
    >
      <p className="app-instrument__meta">
        {[
          aufzaehlung(m.regel, pool.regel),
          ...(pool.obergrenzeJeEinheit !== null ? [m.obergrenzeAnzeige(formatPreis(pool.obergrenzeJeEinheit, sprache))] : []),
          m.stand(formatDatum(pool.stand.stichtag, sprache)),
        ].join(" · ")}
      </p>
      <Kennwerte
        gruppen={[
          {
            id: "stand",
            eintraege: [
              { id: "groesse", label: m.kennwerte.groesse, wert: zahl(pool.stand.groesse), primaer: true },
              { id: "ausstehend", label: grob ? m.kennwerte.vergeben : m.kennwerte.ausstehend, wert: zahl(pool.stand.ausstehend) },
              { id: "frei", label: m.kennwerte.frei, wert: zahl(pool.stand.frei) },
              ...(grob
                ? pool.basispreisMittel
                  ? [{ id: "basispreis", label: m.kennwerte.basispreisMittel, wert: <span className="app-zahl">{formatPreis(pool.basispreisMittel, sprache)}</span> }]
                  : []
                : [
                    { id: "ausgeuebt", label: m.kennwerte.ausgeuebt, wert: zahl(pool.stand.ausgeuebt), ruhig: pool.stand.ausgeuebt === "0" },
                    { id: "verfallen", label: m.kennwerte.verfallen, wert: zahl(String(Number(pool.stand.verfallen) + Number(pool.stand.rueckgekauft))), ruhig: pool.stand.verfallen === "0" && pool.stand.rueckgekauft === "0" },
                  ]),
            ],
          },
        ]}
      />
      {grob ? (
        <>
          <p className="app-leer-text">{m.grobHinweis}</p>
          {darfSchreiben && pool.einzelSichtbar ? (
            <div>
              <Button variante="sekundaer" aria-label={m.umstellenFuer(pool.bezeichnung)} disabled={umstellen.isPending} onClick={() => umstellen.mutate({ poolId: pool.id, erfassung: "einzeln" })}>
                {m.umstellen}
              </Button>
            </div>
          ) : null}
          <FehlerHinweis fehler={umstellen.error} />
        </>
      ) : (
        <>
          {pool.vergeben !== null ? <p className="app-leer-text">{m.vollstaendigkeit(formatAnzahl(erfasst, sprache), formatAnzahl(pool.vergeben, sprache))}</p> : null}
          {!pool.einzelSichtbar ? (
            <Hinweis>{m.einzelVerborgen}</Hinweis>
          ) : pool.zuteilungen.length === 0 ? (
            <p className="app-leer-text">{m.keineZuteilungen}</p>
          ) : (
            <Tabelle beschriftung={`${m.zuteilungen}: ${pool.bezeichnung}`} spalten={zuteilungSpalten} zeilen={pool.zuteilungen} zeilenSchluessel={(z) => z.id} aktionen={darfSchreiben ? zuteilungAktionen : undefined} />
          )}
        </>
      )}
      <Tabelle beschriftung={`${m.verlauf}: ${pool.bezeichnung}`} spalten={verlaufSpalten} zeilen={pool.aenderungen} zeilenSchluessel={(a) => a.id} />
    </Karte>
  );
}

/**
 * Status einer Zuteilung zum Stichtag. Mit Austritten bis zum Stichtag: sind alle Einheiten betroffen, steht nur der Austritt; bei einem
 * Teil der Einheiten der Status der übrigen und daneben der Austritt mit „betroffen von Anzahl“. Verfallen und ausgeübt gehen vor. Ist das
 * Laufzeitende erreicht und noch etwas ausstehend, steht ein Hinweis daneben.
 */
function ZuteilungsStatus({ zuteilung: z, stichtag }: { zuteilung: Mitarbeiterzuteilung; stichtag: string }) {
  const m = useT().mitarbeiter;
  const sprache = useSprache();
  const abgelaufen = z.laufzeitAbgelaufen ? <Status variante="pruefung">{m.laufzeitAbgelaufen}</Status> : null;
  const status = <Status>{aufzaehlung(m.status, z.status)}</Status>;
  const gelten = z.austritte.filter((a) => a.austrittAm <= stichtag);
  const mit = (inhalt: ReactNode) =>
    abgelaufen ? (
      <span className="app-aktionen__knoepfe">
        {inhalt}
        {abgelaufen}
      </span>
    ) : (
      inhalt
    );
  if (z.status === "verfallen" || z.status === "ausgeuebt" || gelten.length === 0) return mit(status);
  const erster = gelten[0]!;
  const text = gelten.length === 1 ? m.leaverAm(aufzaehlung(m.leaverArt, erster.art), formatDatum(erster.austrittAm, sprache)) : m.mehrereAustritte(gelten.length);
  if (z.betroffen === z.anzahl) return mit(<Status>{text}</Status>);
  return mit(
    <span className="app-aktionen__knoepfe">
      {status}
      <Status variante="pruefung">{m.teilweise(text, formatAnzahl(z.betroffen, sprache), formatAnzahl(z.anzahl, sprache))}</Status>
    </span>,
  );
}

/** Runde und Pre- oder Post-Money gehören zusammen (die API prüft das ebenso); bei gewählter Runde steht ein Satz zur Wirkung darunter. */
function RundenWahl({ organisationId, werte, setze }: { organisationId: string; werte: { rundeId: string; basis: string }; setze: (feld: "rundeId" | "basis", wert: string) => void }) {
  const t = useT();
  const f = t.mitarbeiter.form;
  const runden = useQuery(finanzierungsrunden(organisationId));
  const liste = (runden.data ?? []).filter((r) => r.art === "eigenkapital");
  return (
    <>
      <Auswahl label={f.runde} hilfe={f.rundeHilfe} value={werte.rundeId} onChange={(e) => setze("rundeId", e.target.value)}>
        <option value="">{f.keineRunde}</option>
        {liste.map((r) => (
          <option key={r.id} value={r.id}>
            {r.bezeichnung}
          </option>
        ))}
      </Auswahl>
      {werte.rundeId ? (
        <Auswahl label={f.basis} hilfe={aufzaehlung(t.mitarbeiter.wirkung, werte.basis)} value={werte.basis} onChange={(e) => setze("basis", e.target.value)}>
          <option value="pre_money">{t.mitarbeiter.basis.pre_money}</option>
          <option value="post_money">{t.mitarbeiter.basis.post_money}</option>
        </Auswahl>
      ) : null}
    </>
  );
}

/** Beschluss: Freitext mit Hilfetext und optional ein Dokument aus der Ablage des Unternehmens (ohne Leserecht an Dokumenten nur der Freitext). */
function BeschlussFelder({ organisationId, feld, dokumentId, setzeDokument, fehler }: { organisationId: string; feld: FeldBindung; dokumentId: string; setzeDokument: (id: string) => void; fehler: (name: string) => ReactNode }) {
  const f = useT().mitarbeiter.form;
  const dokumente = useQuery({ ...dokumenteZiel("organisation", organisationId), retry: false });
  const liste = dokumente.data ?? [];
  return (
    <>
      <Feld label={f.beschluss} hilfe={f.beschlussHilfe} {...feld} fehler={fehler("beschluss")} />
      {liste.length > 0 || dokumentId ? (
        <Auswahl label={f.dokument} hilfe={f.dokumentHilfe} value={dokumentId} onChange={(e) => setzeDokument(e.target.value)} fehler={fehler("dokumentId")}>
          <option value="">{f.keinDokument}</option>
          {liste.map((d) => (
            <option key={d.id} value={d.id}>
              {d.dateiname}
            </option>
          ))}
        </Auswahl>
      ) : null}
    </>
  );
}

/** Abbrechen und Speichern zusammen im Fuß des Dialogs (gemeinsames Dialogmuster); Speichern sendet das Formular über seine Id. */
function DialogKnoepfe({ formular, speichern, laeuft, onAbbrechen }: { formular: string; speichern: string; laeuft: boolean; onAbbrechen: () => void }) {
  const f = useT().mitarbeiter.form;
  return (
    <>
      <Button variante="sekundaer" onClick={onAbbrechen}>
        {f.abbrechen}
      </Button>
      <Button type="submit" form={formular} disabled={laeuft}>
        {speichern}
      </Button>
    </>
  );
}

function PoolDialog({ organisationId, onSchliessen }: { organisationId: string; onSchliessen: () => void }) {
  const t = useT();
  const f = t.mitarbeiter.form;
  const sprache = useSprache();
  const formularId = useId();
  const anlegen = usePoolAnlegen(organisationId);
  const { werte, feld, setWerte } = useFormular({ art: "esop", bezeichnung: "", regel: "wie_anteile", obergrenzeJeEinheit: "", erfassung: "grob", vergeben: "", basispreisMittel: "", groesse: "", datum: heuteIso(), beschluss: "", dokumentId: "", rundeId: "", basis: "pre_money" });
  const fehler = (name: string) => feldText(t, anlegen.error, name);
  const setze = (name: keyof typeof werte, wert: string) => setWerte((alt) => ({ ...alt, [name]: wert, ...(name === "art" && wert === "esop" ? { regel: "wie_anteile" } : {}) }));
  function absenden() {
    const beschluss = textOderNichts(werte.beschluss);
    const vergeben = textOderNichts(werte.vergeben);
    const basispreisMittel = betragOderNichts(werte.basispreisMittel, sprache);
    anlegen.mutate(
      {
        art: werte.art as "esop" | "vsop",
        bezeichnung: werte.bezeichnung.trim(),
        regel: werte.regel as PoolRegel,
        ...(werte.art === "vsop" ? { obergrenzeJeEinheit: betragOderNichts(werte.obergrenzeJeEinheit, sprache) ?? null } : {}),
        erfassung: werte.erfassung as "grob" | "einzeln",
        groesse: werte.groesse.trim(),
        datum: werte.datum,
        ...(vergeben ? { vergeben } : {}),
        ...(basispreisMittel ? { basispreisMittel } : {}),
        ...(beschluss ? { beschluss } : {}),
        ...(werte.dokumentId ? { dokumentId: werte.dokumentId } : {}),
        ...(werte.rundeId ? { rundeId: werte.rundeId, basis: werte.basis as "pre_money" | "post_money" } : {}),
      },
      { onSuccess: onSchliessen },
    );
  }
  return (
    <Dialog titel={f.titelNeu} onSchliessen={onSchliessen} breit aktionen={<DialogKnoepfe formular={formularId} speichern={f.speichern} laeuft={anlegen.isPending} onAbbrechen={onSchliessen} />}>
      <form
        id={formularId}
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          absenden();
        }}
      >
        <FehlerHinweis fehler={anlegen.error} bekannt={["art", "bezeichnung", "regel", "obergrenzeJeEinheit", "erfassung", "vergeben", "basispreisMittel", "groesse", "datum", "beschluss", "dokumentId", "rundeId", "basis"]} />
        <ErfassungWahl wert={werte.erfassung} setze={(wert) => setze("erfassung", wert)} />
        <div className="cw-formularraster">
          <Auswahl label={f.art} value={werte.art} onChange={(e) => setze("art", e.target.value)}>
            <option value="esop">{t.mitarbeiter.art.esop}</option>
            <option value="vsop">{t.mitarbeiter.art.vsop}</option>
          </Auswahl>
          <Feld label={f.bezeichnung} {...feld("bezeichnung")} fehler={fehler("bezeichnung")} />
          {werte.art === "vsop" ? <VsopFelder regel={werte.regel} setzeRegel={(wert) => setze("regel", wert)} obergrenze={feld("obergrenzeJeEinheit")} fehler={fehler} /> : null}
          <Feld label={f.groesse} zahl inputMode="numeric" {...feld("groesse")} fehler={fehler("groesse")} />
          <SchaetzungFelder feld={feld} fehler={fehler} />
          <Feld label={f.datum} type="date" {...feld("datum")} fehler={fehler("datum")} />
          <BeschlussFelder organisationId={organisationId} feld={feld("beschluss")} dokumentId={werte.dokumentId} setzeDokument={(id) => setze("dokumentId", id)} fehler={fehler} />
          <RundenWahl organisationId={organisationId} werte={werte} setze={(name, wert) => setze(name, wert)} />
        </div>
      </form>
    </Dialog>
  );
}

type PoolRegel = "wie_anteile" | "anteilig" | "vor_verteilung";

function VsopFelder({ regel, setzeRegel, obergrenze, fehler }: { regel: string; setzeRegel: (wert: string) => void; obergrenze: FeldBindung; fehler: (name: string) => ReactNode }) {
  const m = useT().mitarbeiter;
  return (
    <>
      <Auswahl label={m.form.regel} hilfe={m.form.regelHilfe} value={regel} onChange={(e) => setzeRegel(e.target.value)} fehler={fehler("regel")}>
        {Object.entries(m.regel).map(([wert, label]) => <option key={wert} value={wert}>{label}</option>)}
      </Auswahl>
      <Feld label={m.obergrenzeJeEinheit} zahl inputMode="decimal" {...obergrenze} fehler={fehler("obergrenzeJeEinheit")} />
    </>
  );
}

/** Wahl der Erfassung mit Erklärung: nur Pool (grob) oder einzeln. */
function ErfassungWahl({ wert, setze, gesperrt }: { wert: string; setze: (wert: "grob" | "einzeln") => void; gesperrt?: boolean }) {
  const t = useT();
  const f = t.mitarbeiter.form;
  return (
    <div className="app-formular">
      <Segment
        aria-label={f.erfassung}
        value={wert as "grob" | "einzeln"}
        onChange={(w) => (gesperrt ? undefined : setze(w))}
        options={[
          { wert: "grob", label: t.mitarbeiter.erfassung.grob },
          { wert: "einzeln", label: t.mitarbeiter.erfassung.einzeln },
        ]}
      />
      <p className="app-leer-text">{f.erfassungHilfe}</p>
    </div>
  );
}

/** Geschätzt vergebene Einheiten und mittlerer Basispreis (grobe Erfassung; bei einzeln Vergleichswert). */
function SchaetzungFelder({ feld, fehler }: { feld: (name: "vergeben" | "basispreisMittel") => FeldBindung; fehler: (name: string) => ReactNode }) {
  const f = useT().mitarbeiter.form;
  return (
    <>
      <Feld label={f.vergeben} hilfe={f.vergebenHilfe} zahl inputMode="numeric" {...feld("vergeben")} fehler={fehler("vergeben")} />
      <Feld label={f.basispreisMittel} hilfe={f.basispreisMittelHilfe} zahl inputMode="decimal" {...feld("basispreisMittel")} fehler={fehler("basispreisMittel")} />
    </>
  );
}

/** Erfassung, Schätzung und Auszahlungsregeln eines Pools ändern. */
function SchaetzungDialog({ organisationId, pool, onSchliessen }: { organisationId: string; pool: Mitarbeiterpool; onSchliessen: () => void }) {
  const t = useT();
  const f = t.mitarbeiter.form;
  const sprache = useSprache();
  const formularId = useId();
  const aendern = usePoolAendern(organisationId);
  const { werte, feld, setWerte } = useFormular({
    erfassung: pool.erfassung as string,
    vergeben: pool.vergeben ?? "",
    basispreisMittel: pool.basispreisMittel ?? "",
    regel: pool.regel as string,
    obergrenzeJeEinheit: pool.obergrenzeJeEinheit ?? "",
  });
  const fehler = (name: string) => feldText(t, aendern.error, name);
  function absenden() {
    aendern.mutate(
      {
        poolId: pool.id, erfassung: werte.erfassung as "grob" | "einzeln", vergeben: textOderNichts(werte.vergeben) ?? null,
        basispreisMittel: betragOderNichts(werte.basispreisMittel, sprache) ?? null,
        ...(pool.art === "vsop" ? { regel: werte.regel as PoolRegel, obergrenzeJeEinheit: betragOderNichts(werte.obergrenzeJeEinheit, sprache) ?? null } : {}),
      },
      { onSuccess: onSchliessen },
    );
  }
  return (
    <Dialog titel={f.titelSchaetzung} onSchliessen={onSchliessen} aktionen={<DialogKnoepfe formular={formularId} speichern={f.speichern} laeuft={aendern.isPending} onAbbrechen={onSchliessen} />}>
      <p className="app-leer-text">{pool.bezeichnung}</p>
      <form
        id={formularId}
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          absenden();
        }}
      >
        <FehlerHinweis fehler={aendern.error} bekannt={["erfassung", "vergeben", "basispreisMittel", "regel", "obergrenzeJeEinheit"]} />
        <ErfassungWahl wert={werte.erfassung} setze={(wert) => setWerte((alt) => ({ ...alt, erfassung: wert }))} />
        <div className="cw-formularraster">
          {pool.art === "vsop" ? <VsopFelder regel={werte.regel} setzeRegel={(regel) => setWerte((alt) => ({ ...alt, regel }))} obergrenze={feld("obergrenzeJeEinheit")} fehler={fehler} /> : null}
          <SchaetzungFelder feld={feld} fehler={fehler} />
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Größe des Pools ändern: Aufstocken oder Verkleinern mit positiver Anzahl (die API bekommt das Vorzeichen), Vorschau der Größe vorher und
 * nachher, Beschluss mit Hilfetext und optionalem Dokument, bei gewählter Runde Pre- oder Post-Money mit einem Satz zur Wirkung. Mit
 * `aenderung` wird eine bestehende Änderung bearbeitet (die API lässt das für Änderungen einer abgeschlossenen Runde nicht zu).
 */
function AenderungDialog({ organisationId, pool, aenderung, onSchliessen }: { organisationId: string; pool: Mitarbeiterpool; aenderung?: Aenderung; onSchliessen: () => void }) {
  const t = useT();
  const m = t.mitarbeiter;
  const f = m.form;
  const sprache = useSprache();
  const formularId = useId();
  const anlegen = usePoolAenderung(organisationId);
  const bearbeiten = usePoolAenderungAendern(organisationId);
  const aendern = aenderung ? bearbeiten : anlegen;
  const titel = aenderung ? f.titelAenderungBearbeiten : f.titelAendern;
  const alt = aenderung ? BigInt(aenderung.anzahl) : 0n;
  const [richtung, setRichtung] = useState<"aufstocken" | "verkleinern">(alt < 0n ? "verkleinern" : "aufstocken");
  const { werte, feld, setWerte } = useFormular({
    anzahl: aenderung ? (alt < 0n ? -alt : alt).toString() : "",
    datum: aenderung?.datum ?? heuteIso(),
    beschluss: aenderung?.beschluss ?? "",
    dokumentId: aenderung?.dokumentId ?? "",
    rundeId: aenderung?.rundeId ?? "",
    basis: aenderung?.basis ?? "pre_money",
  });
  const fehler = (name: string) => feldText(t, aendern.error, name);
  const betrag = ganz(werte.anzahl);
  const mitVorzeichen = betrag === null ? null : richtung === "verkleinern" ? -betrag : betrag;
  // Vorschau zum Stichtag der Ansicht: bisherige Größe ohne die bearbeitete Änderung, nachher mit dem neuen Wert.
  const vorher = BigInt(pool.stand.groesse);
  const nachher = mitVorzeichen === null ? null : vorher - alt + mitVorzeichen;
  function absenden() {
    const beschluss = textOderNichts(werte.beschluss);
    const anzahl = mitVorzeichen === null ? werte.anzahl.trim() : mitVorzeichen.toString();
    const runde = werte.rundeId ? { rundeId: werte.rundeId, basis: werte.basis as "pre_money" | "post_money" } : null;
    if (aenderung) {
      bearbeiten.mutate(
        { poolId: pool.id, aenderungId: aenderung.id, anzahl, datum: werte.datum, beschluss: beschluss ?? null, dokumentId: werte.dokumentId || null, rundeId: runde?.rundeId ?? null, basis: runde?.basis ?? null },
        { onSuccess: onSchliessen },
      );
      return;
    }
    anlegen.mutate({ poolId: pool.id, anzahl, datum: werte.datum, ...(beschluss ? { beschluss } : {}), ...(werte.dokumentId ? { dokumentId: werte.dokumentId } : {}), ...(runde ?? {}) }, { onSuccess: onSchliessen });
  }
  return (
    <Dialog titel={titel} onSchliessen={onSchliessen} breit aktionen={<DialogKnoepfe formular={formularId} speichern={f.speichern} laeuft={aendern.isPending} onAbbrechen={onSchliessen} />}>
      <p className="app-leer-text">{pool.bezeichnung}</p>
      <form
        id={formularId}
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          absenden();
        }}
      >
        <FehlerHinweis fehler={aendern.error} bekannt={["anzahl", "datum", "beschluss", "dokumentId", "rundeId", "basis"]} />
        <Segment
          aria-label={f.richtung}
          value={richtung}
          onChange={setRichtung}
          options={[
            { wert: "aufstocken", label: m.richtung.aufstocken },
            { wert: "verkleinern", label: m.richtung.verkleinern },
          ]}
        />
        <div className="cw-formularraster">
          <Feld label={f.anzahl} zahl inputMode="numeric" {...feld("anzahl")} fehler={fehler("anzahl")} />
          <Feld label={f.datum} type="date" {...feld("datum")} fehler={fehler("datum")} />
        </div>
        <Kennwerte
          gruppen={[
            {
              id: "vorschau",
              titel: m.vorschau,
              eintraege: [
                { id: "vorher", label: m.vorher, wert: <span className="app-zahl">{formatAnzahl(vorher.toString(), sprache)}</span> },
                { id: "nachher", label: m.nachher, wert: <span className="app-zahl">{nachher === null ? t.gemeinsam.keinWert : formatAnzahl(nachher.toString(), sprache)}</span>, primaer: true },
              ],
            },
          ]}
        />
        <div className="cw-formularraster">
          <BeschlussFelder organisationId={organisationId} feld={feld("beschluss")} dokumentId={werte.dokumentId} setzeDokument={(id) => setWerte((w) => ({ ...w, dokumentId: id }))} fehler={fehler} />
          <RundenWahl organisationId={organisationId} werte={werte} setze={(name, wert) => setWerte((w) => ({ ...w, [name]: wert }))} />
        </div>
      </form>
    </Dialog>
  );
}

/** Bestätigung zum Löschen einer Änderung der Größe; die API prüft, dass die Zuteilungen weiter in den Pool passen. */
function AenderungLoeschenDialog({ organisationId, pool, aenderung, onSchliessen }: { organisationId: string; pool: Mitarbeiterpool; aenderung: Aenderung; onSchliessen: () => void }) {
  const t = useT();
  const a = t.mitarbeiter.aenderung;
  const sprache = useSprache();
  const loeschen = usePoolAenderungLoeschen(organisationId);
  return (
    <Dialog
      titel={a.loeschenTitel}
      onSchliessen={onSchliessen}
      aktionen={
        <>
          <Button variante="sekundaer" onClick={onSchliessen}>
            {a.abbrechen}
          </Button>
          <Button variante="gefahr" disabled={loeschen.isPending} onClick={() => loeschen.mutate({ poolId: pool.id, aenderungId: aenderung.id }, { onSuccess: onSchliessen })}>
            {a.loeschen}
          </Button>
        </>
      }
    >
      <p>{a.loeschenFrage(formatAnzahl(aenderung.anzahl, sprache), formatDatum(aenderung.datum, sprache))}</p>
      <FehlerHinweis fehler={loeschen.error} />
    </Dialog>
  );
}

/** Bestätigung zum Anonymisieren (Name und Kennung gelöscht) oder Löschen einer Zuteilung. */
function ZuteilungBestaetigen({ organisationId, art, pool, zuteilung, onSchliessen }: { organisationId: string; art: "zuteilung_anonymisieren" | "zuteilung_loeschen"; pool: Mitarbeiterpool; zuteilung: Mitarbeiterzuteilung; onSchliessen: () => void }) {
  const t = useT();
  const m = t.mitarbeiter;
  const anonymisieren = useZuteilungAnonymisieren(organisationId);
  const loeschen = useZuteilungLoeschen(organisationId);
  const mutation = art === "zuteilung_loeschen" ? loeschen : anonymisieren;
  const loescht = art === "zuteilung_loeschen";
  return (
    <Dialog
      titel={loescht ? m.loeschenTitel : m.anonymisierenTitel}
      onSchliessen={onSchliessen}
      aktionen={
        <>
          <Button variante="sekundaer" onClick={onSchliessen}>
            {m.form.abbrechen}
          </Button>
          <Button variante="gefahr" disabled={mutation.isPending} onClick={() => mutation.mutate({ poolId: pool.id, zuteilungId: zuteilung.id }, { onSuccess: onSchliessen })}>
            {loescht ? m.loeschen : m.anonymisieren}
          </Button>
        </>
      }
    >
      <p className="app-leer-text">{zuteilungsName(m, zuteilung)}</p>
      <p>{loescht ? m.loeschenFrage : m.anonymisierenFrage}</p>
      <FehlerHinweis fehler={mutation.error} />
    </Dialog>
  );
}

function ZuteilungDialog({ organisationId, pool, zuteilung, onSchliessen }: { organisationId: string; pool: Mitarbeiterpool; zuteilung?: Mitarbeiterzuteilung; onSchliessen: () => void }) {
  const t = useT();
  const m = t.mitarbeiter;
  const f = m.form;
  const anlegen = useZuteilungAnlegen(organisationId);
  const aendern = useZuteilungAendern(organisationId);
  const mutation = zuteilung ? aendern : anlegen;
  const anonym = zuteilung?.anonymisiertAm != null;
  const { werte, feld, setWerte } = useFormular({
    kategorie: (zuteilung?.kategorie ?? "mitarbeitende") as string,
    kennung: zuteilung?.kennung ?? "",
    name: zuteilung?.name ?? "",
    bezeichnung: zuteilung?.bezeichnung ?? "",
    anzahl: zuteilung?.anzahl ?? "",
    basispreis: zuteilung ? zuteilung.basispreis.replace(/\.?0+$/, "") : "0",
    zugeteiltAm: zuteilung?.zugeteiltAm ?? heuteIso(),
    vestingBeginn: zuteilung?.vestingBeginn ?? "",
    cliff: String(zuteilung?.cliffMonate ?? 12),
    dauer: String(zuteilung?.vestingMonate ?? 48),
    takt: String(zuteilung?.taktMonate ?? 1),
    beschleunigung: zuteilung ? anteilZuProzent(zuteilung.beschleunigung) : "0",
    ausloeser: (zuteilung?.ausloeser ?? "einfach") as string,
    status: (zuteilung?.status ?? "zugeteilt") as string,
    statusAm: zuteilung?.statusAm ?? "",
    ausuebungsfrist: zuteilung?.ausuebungsfristMonate == null ? "" : String(zuteilung.ausuebungsfristMonate),
    laufzeitBis: zuteilung?.laufzeitBis ?? "",
    leaver: zuteilung?.leaverRegel ?? "",
  });
  const [vestingStufen, setVestingStufen] = useState<VestingZeile[]>(() => (zuteilung?.vestingStufen ?? []).map((s, id) => ({
    id,
    ...("datum" in s ? { art: "datum" as const, datum: s.datum, monate: "" } : { art: "monate" as const, datum: "", monate: String(s.monate) }),
    prozent: anteilZuProzent(s.anteil),
  })));
  const [leaverStufen, setLeaverStufen] = useState<LeaverZeile[]>(() => (zuteilung?.leaverStufen ?? []).map((s, id) => ({
    id, art: s.art, monate: String(s.mindestMonate), prozent: anteilZuProzent(s.anteil),
  })));
  const naechsteZeile = useRef(Math.max(vestingStufen.length, leaverStufen.length));
  const stufenPruefung = useZeilenpruefung();
  const fehler = (name: string) => feldText(t, mutation.error, name);
  const titel = zuteilung ? f.titelZuteilungAendern : f.titelZuteilung;
  const mitDatum = werte.status === "verfallen" || werte.status === "ausgeuebt";
  const auswahl = (name: "kategorie" | "status" | "takt" | "ausloeser") => ({ value: werte[name], onChange: (e: { target: { value: string } }) => setWerte((alt) => ({ ...alt, [name]: e.target.value })) });
  function absenden() {
    if (!stufenPruefung.pruefeAlle()) return;
    const koerper = {
      kategorie: werte.kategorie as "gruender" | "fuehrung" | "mitarbeitende" | "beirat" | "sonstige",
      // Nach dem Anonymisieren bleiben Kennung und Name leer (die API lehnt neue Werte ab).
      ...(anonym ? {} : { kennung: textOderNichts(werte.kennung) ?? null, name: textOderNichts(werte.name) ?? null }),
      bezeichnung: textOderNichts(werte.bezeichnung) ?? null,
      anzahl: werte.anzahl.trim(),
      basispreis: betragOderNichts(werte.basispreis) ?? "0",
      zugeteiltAm: werte.zugeteiltAm,
      vestingBeginn: werte.vestingBeginn || null,
      cliffMonate: Number(werte.cliff),
      vestingMonate: Number(werte.dauer),
      taktMonate: Number(werte.takt),
      beschleunigung: werte.beschleunigung.trim() === "" ? "0" : prozentZuAnteil(werte.beschleunigung),
      ausloeser: werte.ausloeser as "einfach" | "doppelt",
      status: werte.status as "zugeteilt" | "gevestet" | "verfallen" | "ausgeuebt",
      statusAm: mitDatum ? werte.statusAm || null : null,
      ausuebungsfristMonate: werte.ausuebungsfrist.trim() === "" ? null : Number(werte.ausuebungsfrist),
      laufzeitBis: werte.laufzeitBis || null,
      leaverRegel: textOderNichts(werte.leaver) ?? null,
      vestingStufen: vestingStufen.length ? vestingStufen.map((s) => {
        const anteil = prozentZuAnteil(s.prozent);
        return s.art === "datum" ? { datum: s.datum, anteil } : { monate: Number(s.monate), anteil };
      }) : null,
      leaverStufen: leaverStufen.length ? leaverStufen.map((s) => ({
        art: s.art, mindestMonate: Number(s.monate), anteil: prozentZuAnteil(s.prozent),
      })) : null,
    };
    if (zuteilung) aendern.mutate({ poolId: pool.id, zuteilungId: zuteilung.id, ...koerper }, { onSuccess: onSchliessen });
    else anlegen.mutate({ poolId: pool.id, ...koerper }, { onSuccess: onSchliessen });
  }
  return (
    <Seitenpanel titel={titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{titel}</h2>
      <p className="app-leer-text">{pool.bezeichnung}</p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          absenden();
        }}
      >
        <FehlerHinweis
          fehler={mutation.error}
          bekannt={["kategorie", "kennung", "name", "bezeichnung", "anzahl", "basispreis", "zugeteiltAm", "vestingBeginn", "cliffMonate", "vestingMonate", "taktMonate", "beschleunigung", "ausloeser", "status", "statusAm", "ausuebungsfristMonate", "laufzeitBis", "leaverRegel", "vestingStufen", "leaverStufen"]}
        />
        <div className="cw-formularraster">
          {anonym ? null : (
            <>
              <Feld label={f.kennung} hilfe={f.kennungHilfe} {...feld("kennung")} fehler={fehler("kennung")} />
              <Feld label={f.name} hilfe={f.nameHilfe} autoComplete="off" {...feld("name")} fehler={fehler("name")} />
            </>
          )}
          <Auswahl label={f.kategorie} {...auswahl("kategorie")}>
            {Object.entries(m.kategorie).map(([wert, label]) => (
              <option key={wert} value={wert}>
                {label}
              </option>
            ))}
          </Auswahl>
          <Feld label={f.zuteilungBezeichnung} {...feld("bezeichnung")} fehler={fehler("bezeichnung")} />
          <Feld label={f.zuteilungAnzahl} zahl inputMode="numeric" {...feld("anzahl")} fehler={fehler("anzahl")} />
          <Feld label={f.basispreis} zahl inputMode="decimal" {...feld("basispreis")} fehler={fehler("basispreis")} />
          <Feld label={f.zugeteiltAm} type="date" {...feld("zugeteiltAm")} fehler={fehler("zugeteiltAm")} />
          <Feld label={f.vestingBeginn} type="date" {...feld("vestingBeginn")} fehler={fehler("vestingBeginn")} />
          <Feld label={f.cliff} zahl inputMode="numeric" {...feld("cliff")} fehler={fehler("cliffMonate")} />
          {vestingStufen.length === 0 ? (
            <>
              <Feld label={f.dauer} zahl inputMode="numeric" {...feld("dauer")} fehler={fehler("vestingMonate")} />
              <Auswahl label={f.takt} {...auswahl("takt")} fehler={fehler("taktMonate")}>
                {TAKTE.map((takt) => (
                  <option key={takt} value={takt}>
                    {aufzaehlung(m.takt, takt)}
                  </option>
                ))}
              </Auswahl>
            </>
          ) : null}
          <Feld label={f.beschleunigung} hilfe={f.beschleunigungHilfe} zahl inputMode="decimal" {...feld("beschleunigung")} fehler={fehler("beschleunigung")} />
          <Auswahl label={f.ausloeser} hilfe={f.ausloeserHilfe} {...auswahl("ausloeser")}>
            {Object.entries(m.ausloeser).map(([wert, label]) => (
              <option key={wert} value={wert}>
                {label}
              </option>
            ))}
          </Auswahl>
          <Auswahl label={f.status} {...auswahl("status")} fehler={fehler("status")}>
            {Object.entries(m.status).filter(([wert]) => wert !== "ausgeuebt" || !zuteilung?.ausuebungen.length).map(([wert, label]) => (
              <option key={wert} value={wert}>
                {label}
              </option>
            ))}
          </Auswahl>
          {mitDatum ? <Feld label={f.statusAm} type="date" {...feld("statusAm")} fehler={fehler("statusAm")} /> : null}
          <Feld label={f.ausuebungsfrist} hilfe={f.ausuebungsfristHilfe} zahl inputMode="numeric" {...feld("ausuebungsfrist")} fehler={fehler("ausuebungsfristMonate")} />
          <Feld label={f.laufzeitBis} hilfe={f.laufzeitBisHilfe} type="date" {...feld("laufzeitBis")} fehler={fehler("laufzeitBis")} />
          <Feld label={f.leaver} {...feld("leaver")} fehler={fehler("leaverRegel")} />
        </div>
        <VestingStufenFelder zeilen={vestingStufen} setzen={setVestingStufen} pruefe={stufenPruefung.pruefe}
          neu={() => ({ id: naechsteZeile.current++, art: "monate", monate: "", datum: "", prozent: "" })} fehler={fehler("vestingStufen")} />
        <LeaverStufenFelder zeilen={leaverStufen} setzen={setLeaverStufen} pruefe={stufenPruefung.pruefe}
          neu={() => ({ id: naechsteZeile.current++, art: "bad_leaver", monate: "", prozent: "" })} fehler={fehler("leaverStufen")} />
        <div className="app-knoepfe">
          <Button variante="sekundaer" onClick={onSchliessen}>
            {f.abbrechen}
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {f.speichern}
          </Button>
        </div>
      </form>
      {zuteilung ? <AustritteAbschnitt organisationId={organisationId} pool={pool} zuteilung={zuteilung} /> : <p className="app-leer-text">{f.austritteSpaeter}</p>}
      {pool.art === "esop" ? (
        zuteilung ? <MitarbeiterAusuebungen organisationId={organisationId} poolId={pool.id} zuteilung={zuteilung} /> : <p className="app-leer-text">{m.ausuebungen.spaeter}</p>
      ) : null}
    </Seitenpanel>
  );
}

/** Ganze Einheiten einer Zuteilung ohne Austritt (exakt, auch über 2^53). */
function ohneAustritt(zuteilung: Mitarbeiterzuteilung, ausser?: string): bigint {
  return zuteilung.austritte.filter((a) => a.id !== ausser).reduce((rest, a) => rest - BigInt(a.anzahl), BigInt(zuteilung.anzahl));
}

/** Austritte einer Zuteilung: Liste mit Ändern und Entfernen, darunter das Formular für einen neuen oder geänderten Austritt. */
function AustritteAbschnitt({ organisationId, pool, zuteilung }: { organisationId: string; pool: Mitarbeiterpool; zuteilung: Mitarbeiterzuteilung }) {
  const t = useT();
  const m = t.mitarbeiter;
  const a = m.austritte;
  const sprache = useSprache();
  const entfernen = useAustrittEntfernen(organisationId);
  const [offen, setOffen] = useState<Austritt | "neu" | null>(null);
  const frei = ohneAustritt(zuteilung);
  const spalten: TabelleSpalte<Austritt>[] = [
    { schluessel: "datum", kopf: a.spalten.datum, zelle: (x) => formatDatum(x.austrittAm, sprache) },
    { schluessel: "art", kopf: a.spalten.art, zelle: (x) => aufzaehlung(m.leaverArt, x.art) },
    { schluessel: "anzahl", kopf: a.spalten.anzahl, zahl: true, zelle: (x) => formatAnzahl(x.anzahl, sprache) },
    { schluessel: "gevestet", kopf: a.spalten.gevestet, zelle: (x) => (x.gevestet === "rueckkauf" && x.rueckkaufpreis ? a.rueckkaufZu(formatPreis(x.rueckkaufpreis, sprache)) : aufzaehlung(m.leaverGevestet, x.gevestet)) },
    {
      schluessel: "aktion",
      kopf: a.spalten.aktion,
      zelle: (x) => (
        <span className="app-aktionen__knoepfe">
          <Button variante="sekundaer" aria-label={a.bearbeitenFuer(formatDatum(x.austrittAm, sprache))} onClick={() => setOffen(x)}>
            {a.bearbeiten}
          </Button>
          <Button
            variante="sekundaer"
            aria-label={a.entfernenFuer(formatDatum(x.austrittAm, sprache))}
            disabled={entfernen.isPending}
            onClick={() => entfernen.mutate({ poolId: pool.id, zuteilungId: zuteilung.id, austrittId: x.id }, { onSuccess: () => setOffen((alt) => (alt !== "neu" && alt?.id === x.id ? null : alt)) })}
          >
            {a.entfernen}
          </Button>
        </span>
      ),
    },
  ];
  return (
    <section aria-labelledby="austritte-titel">
      <div className="app-karte__kopf">
        <h3 id="austritte-titel" className="cw-t-untertitel app-karte__titel">
          {a.titel}
        </h3>
        {offen === null && frei > 0n ? (
          <Button variante="sekundaer" onClick={() => setOffen("neu")}>
            {a.neu}
          </Button>
        ) : null}
      </div>
      <FehlerHinweis fehler={entfernen.error} />
      {zuteilung.austritte.length === 0 ? <p className="app-leer-text">{a.keine}</p> : <Tabelle beschriftung={`${a.titel}: ${aufzaehlung(m.kategorie, zuteilung.kategorie)}`} spalten={spalten} zeilen={zuteilung.austritte} zeilenSchluessel={(x) => x.id} />}
      {offen ? (
        <AustrittFormular
          key={offen === "neu" ? "neu" : offen.id}
          organisationId={organisationId}
          pool={pool}
          zuteilung={zuteilung}
          {...(offen === "neu" ? {} : { austritt: offen })}
          onFertig={() => setOffen(null)}
        />
      ) : null}
    </section>
  );
}

function AustrittFormular({ organisationId, pool, zuteilung, austritt, onFertig }: { organisationId: string; pool: Mitarbeiterpool; zuteilung: Mitarbeiterzuteilung; austritt?: Austritt; onFertig: () => void }) {
  const t = useT();
  const m = t.mitarbeiter;
  const a = m.austritte;
  const sprache = useSprache();
  const anlegen = useAustrittAnlegen(organisationId);
  const aendern = useAustrittAendern(organisationId);
  const mutation = austritt ? aendern : anlegen;
  const { werte, feld, setWerte } = useFormular({
    art: (austritt?.art ?? "good_leaver") as string,
    austrittAm: austritt?.austrittAm ?? heuteIso(),
    anzahl: austritt?.anzahl ?? "",
    gevestet: (austritt?.gevestet ?? "bleiben") as string,
    rueckkaufpreis: austritt?.rueckkaufpreis ? austritt.rueckkaufpreis.replace(/\.?0+$/, "") : "",
  });
  const fehler = (name: string) => feldText(t, mutation.error, name);
  const mitRueckkauf = werte.gevestet === "rueckkauf";
  const titel = austritt ? a.titelAendern : a.titelNeu;
  // Übliche Vorgabe je Art: Good Leaver behält die gevesteten Einheiten, beim Bad Leaver verfallen sie.
  const setzeArt = (art: string) => setWerte((alt) => ({ ...alt, art, ...(art !== alt.art ? { gevestet: art === "good_leaver" ? "bleiben" : "verfallen" } : {}) }));
  function absenden() {
    const anzahl = textOderNichts(werte.anzahl);
    const koerper = {
      art: werte.art as "good_leaver" | "bad_leaver",
      austrittAm: werte.austrittAm,
      gevestet: werte.gevestet as "bleiben" | "verfallen" | "rueckkauf",
      rueckkaufpreis: mitRueckkauf ? (betragOderNichts(werte.rueckkaufpreis) ?? null) : null,
      ...(anzahl ? { anzahl } : {}),
    };
    const ziel = { poolId: pool.id, zuteilungId: zuteilung.id };
    if (austritt) aendern.mutate({ ...ziel, austrittId: austritt.id, ...koerper }, { onSuccess: onFertig });
    else anlegen.mutate({ ...ziel, ...koerper }, { onSuccess: onFertig });
  }
  return (
    <form
      className="app-formular"
      aria-label={titel}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        absenden();
      }}
    >
      <FehlerHinweis fehler={mutation.error} bekannt={["art", "austrittAm", "anzahl", "gevestet", "rueckkaufpreis"]} />
      <div className="cw-formularraster">
        <Auswahl label={a.art} value={werte.art} onChange={(e) => setzeArt(e.target.value)}>
          {Object.entries(m.leaverArt).map(([wert, label]) => (
            <option key={wert} value={wert}>
              {label}
            </option>
          ))}
        </Auswahl>
        <Feld label={a.austrittAm} type="date" {...feld("austrittAm")} fehler={fehler("austrittAm")} />
        <Feld label={austritt ? a.anzahlAendern : a.anzahl} hilfe={a.anzahlHilfe(formatAnzahl(ohneAustritt(zuteilung, austritt?.id).toString(), sprache))} zahl inputMode="numeric" {...feld("anzahl")} fehler={fehler("anzahl")} />
        <Auswahl label={a.gevestet} hilfe={a.gevestetHilfe} value={werte.gevestet} onChange={(e) => setWerte((alt) => ({ ...alt, gevestet: e.target.value }))}>
          {Object.entries(m.leaverGevestet).map(([wert, label]) => (
            <option key={wert} value={wert}>
              {label}
            </option>
          ))}
        </Auswahl>
        {mitRueckkauf ? <Feld label={a.rueckkaufpreis} zahl inputMode="decimal" {...feld("rueckkaufpreis")} fehler={fehler("rueckkaufpreis")} /> : null}
      </div>
      <div className="app-aktionen__knoepfe">
        <Button type="submit" disabled={mutation.isPending}>
          {a.speichern}
        </Button>
        <Button type="button" variante="sekundaer" onClick={onFertig}>
          {a.abbrechen}
        </Button>
      </div>
    </form>
  );
}
