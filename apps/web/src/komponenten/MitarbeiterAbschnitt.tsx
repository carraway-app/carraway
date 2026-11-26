import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Dialog, Feld, Karte, Kennwerte, Seitenpanel, Status, Tabelle, formatDatum, type TabelleSpalte } from "@carraway/ui";
import { finanzierungsrunden, mitarbeiterpools, type Mitarbeiterpool, type Mitarbeiterzuteilung } from "../api/abfragen";
import { heuteIso } from "../api/datum";
import { useAustrittAendern, useAustrittAnlegen, useAustrittEntfernen, usePoolAenderung, usePoolAenderungAendern, usePoolAenderungLoeschen, usePoolAnlegen, useZuteilungAendern, useZuteilungAnlegen } from "../api/mutationen";
import { feldText } from "../i18n/fehler";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { anteilZuProzent, formatAnzahl, formatPreis, prozentZuAnteil } from "../lib/zahl";
import { FehlerHinweis } from "./FehlerHinweis";
import { betragOderNichts, textOderNichts, useFormular } from "./formular";
import { Skelettzeilen } from "./Skelett";

type Aenderung = Mitarbeiterpool["aenderungen"][number];
type Dialog = { art: "pool" } | { art: "aenderung"; pool: Mitarbeiterpool; aenderung?: Aenderung } | { art: "aenderung_loeschen"; pool: Mitarbeiterpool; aenderung: Aenderung } | { art: "zuteilung"; pool: Mitarbeiterpool; zuteilung?: Mitarbeiterzuteilung };
type Austritt = Mitarbeiterzuteilung["austritte"][number];

/**
 * Mitarbeiterbeteiligung eines Unternehmens: je Pool (ESOP oder VSOP) Größe, zugeteilt, frei und ausgeübt zum Stichtag, die Zuteilungen nach
 * Kategorie (ohne Namen) mit Vesting und dem Verlauf der Größe. Bearbeiter legen Pools an, ändern die Größe und pflegen Zuteilungen mit
 * ihren Austritten (Leaver, auch mehrere je aggregierter Zuteilung).
 */
export function MitarbeiterAbschnitt({ organisationId, stichtag, darfSchreiben }: { organisationId: string; stichtag: string; darfSchreiben: boolean }) {
  const t = useT();
  const m = t.mitarbeiter;
  const { data, error, isPending } = useQuery(mitarbeiterpools(organisationId, stichtag));
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // Nach dem Erfassen eines Austritts lädt die Abfrage neu; der Dialog zeigt die Zuteilung aus den aktuellen Daten.
  const offeneZuteilung =
    dialog?.art === "zuteilung" && dialog.zuteilung ? (data?.find((p) => p.id === dialog.pool.id)?.zuteilungen.find((z) => z.id === dialog.zuteilung?.id) ?? dialog.zuteilung) : undefined;

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
      {data?.map((pool) => <PoolKarte key={pool.id} pool={pool} darfSchreiben={darfSchreiben} onDialog={setDialog} />)}
      {dialog?.art === "pool" ? <PoolDialog organisationId={organisationId} onSchliessen={() => setDialog(null)} /> : null}
      {dialog?.art === "aenderung" ? <AenderungDialog organisationId={organisationId} pool={dialog.pool} {...(dialog.aenderung ? { aenderung: dialog.aenderung } : {})} onSchliessen={() => setDialog(null)} /> : null}
      {dialog?.art === "aenderung_loeschen" ? <AenderungLoeschenDialog organisationId={organisationId} pool={dialog.pool} aenderung={dialog.aenderung} onSchliessen={() => setDialog(null)} /> : null}
      {dialog?.art === "zuteilung" ? <ZuteilungDialog organisationId={organisationId} pool={dialog.pool} {...(offeneZuteilung ? { zuteilung: offeneZuteilung } : {})} onSchliessen={() => setDialog(null)} /> : null}
    </section>
  );
}

function PoolKarte({ pool, darfSchreiben, onDialog }: { pool: Mitarbeiterpool; darfSchreiben: boolean; onDialog: (d: Dialog) => void }) {
  const t = useT();
  const m = t.mitarbeiter;
  const sprache = useSprache();
  const zahl = (wert: string) => <span className="app-zahl">{formatAnzahl(wert, sprache)}</span>;
  const zuteilungSpalten: TabelleSpalte<Mitarbeiterzuteilung>[] = [
    { schluessel: "kategorie", kopf: m.spalten.kategorie, zelle: (z) => (z.bezeichnung ? `${aufzaehlung(m.kategorie, z.kategorie)} · ${z.bezeichnung}` : aufzaehlung(m.kategorie, z.kategorie)) },
    { schluessel: "anzahl", kopf: m.spalten.anzahl, zahl: true, zelle: (z) => formatAnzahl(z.anzahl, sprache) },
    { schluessel: "basispreis", kopf: m.spalten.basispreis, zahl: true, zelle: (z) => formatPreis(z.basispreis, sprache) },
    { schluessel: "zugeteilt", kopf: m.spalten.zugeteilt, zelle: (z) => formatDatum(z.zugeteiltAm, sprache) },
    { schluessel: "vesting", kopf: m.spalten.vesting, zelle: (z) => m.vesting(z.cliffMonate, z.vestingMonate) },
    { schluessel: "gevestet", kopf: m.spalten.gevestet, zahl: true, zelle: (z) => formatAnzahl(z.gevestet, sprache) },
    { schluessel: "beimExit", kopf: m.spalten.beimExit, zahl: true, zelle: (z) => formatAnzahl(z.beimExit, sprache) },
    { schluessel: "verfallen", kopf: m.spalten.verfallen, zahl: true, zelle: (z) => formatAnzahl(String(Number(z.verfallen) + Number(z.rueckgekauft)), sprache) },
    { schluessel: "status", kopf: m.spalten.status, zelle: (z) => <ZuteilungsStatus zuteilung={z} stichtag={pool.stand.stichtag} /> },
    ...(darfSchreiben
      ? [
          {
            schluessel: "aktion",
            kopf: m.spalten.aktion,
            zelle: (z: Mitarbeiterzuteilung) => (
              <Button variante="sekundaer" aria-label={m.bearbeitenFuer(aufzaehlung(m.kategorie, z.kategorie))} onClick={() => onDialog({ art: "zuteilung", pool, zuteilung: z })}>
                {m.bearbeiten}
              </Button>
            ),
          },
        ]
      : []),
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
  return (
    <Karte
      ebene={3}
      titel={
        <>
          {pool.bezeichnung} <Status>{aufzaehlung(m.art, pool.art)}</Status>
        </>
      }
      aktion={
        darfSchreiben ? (
          <span className="app-aktionen__knoepfe">
            <Button variante="sekundaer" aria-label={m.aendernFuer(pool.bezeichnung)} onClick={() => onDialog({ art: "aenderung", pool })}>
              {m.aendern}
            </Button>
            <Button variante="sekundaer" aria-label={m.zuteilenFuer(pool.bezeichnung)} onClick={() => onDialog({ art: "zuteilung", pool })}>
              {m.zuteilen}
            </Button>
          </span>
        ) : undefined
      }
    >
      <p className="app-instrument__meta">{[aufzaehlung(m.regel, pool.regel), m.stand(formatDatum(pool.stand.stichtag, sprache))].join(" · ")}</p>
      <Kennwerte
        gruppen={[
          {
            id: "stand",
            eintraege: [
              { id: "groesse", label: m.kennwerte.groesse, wert: zahl(pool.stand.groesse), primaer: true },
              { id: "ausstehend", label: m.kennwerte.ausstehend, wert: zahl(pool.stand.ausstehend) },
              { id: "frei", label: m.kennwerte.frei, wert: zahl(pool.stand.frei) },
              { id: "ausgeuebt", label: m.kennwerte.ausgeuebt, wert: zahl(pool.stand.ausgeuebt), ruhig: pool.stand.ausgeuebt === "0" },
              { id: "verfallen", label: m.kennwerte.verfallen, wert: zahl(String(Number(pool.stand.verfallen) + Number(pool.stand.rueckgekauft))), ruhig: pool.stand.verfallen === "0" && pool.stand.rueckgekauft === "0" },
            ],
          },
        ]}
      />
      {pool.zuteilungen.length === 0 ? <p className="app-leer-text">{m.keineZuteilungen}</p> : <Tabelle beschriftung={`${m.zuteilungen}: ${pool.bezeichnung}`} spalten={zuteilungSpalten} zeilen={pool.zuteilungen} zeilenSchluessel={(z) => z.id} />}
      <Tabelle beschriftung={`${m.verlauf}: ${pool.bezeichnung}`} spalten={verlaufSpalten} zeilen={pool.aenderungen} zeilenSchluessel={(a) => a.id} />
    </Karte>
  );
}

/**
 * Status einer Zuteilung zum Stichtag. Mit Austritten bis zum Stichtag: sind alle Einheiten betroffen, steht nur der Austritt; bei einem
 * Teil der Einheiten der Status der übrigen und daneben der Austritt mit „betroffen von Anzahl“. Verfallen und ausgeübt gehen vor.
 */
function ZuteilungsStatus({ zuteilung: z, stichtag }: { zuteilung: Mitarbeiterzuteilung; stichtag: string }) {
  const m = useT().mitarbeiter;
  const sprache = useSprache();
  const status = <Status>{aufzaehlung(m.status, z.status)}</Status>;
  const gelten = z.austritte.filter((a) => a.austrittAm <= stichtag);
  if (z.status === "verfallen" || z.status === "ausgeuebt" || gelten.length === 0) return status;
  const erster = gelten[0]!;
  const text = gelten.length === 1 ? m.leaverAm(aufzaehlung(m.leaverArt, erster.art), formatDatum(erster.austrittAm, sprache)) : m.mehrereAustritte(gelten.length);
  if (z.betroffen === z.anzahl) return <Status>{text}</Status>;
  return (
    <span className="app-aktionen__knoepfe">
      {status}
      <Status variante="pruefung">{m.teilweise(text, formatAnzahl(z.betroffen, sprache), formatAnzahl(z.anzahl, sprache))}</Status>
    </span>
  );
}

/** Runde und Pre- oder Post-Money gehören zusammen (die API prüft das ebenso). */
function RundenWahl({ organisationId, werte, setze }: { organisationId: string; werte: { rundeId: string; basis: string }; setze: (feld: "rundeId" | "basis", wert: string) => void }) {
  const t = useT();
  const f = t.mitarbeiter.form;
  const runden = useQuery(finanzierungsrunden(organisationId));
  const liste = (runden.data ?? []).filter((r) => r.art === "eigenkapital");
  return (
    <>
      <Auswahl label={f.runde} value={werte.rundeId} onChange={(e) => setze("rundeId", e.target.value)}>
        <option value="">{f.keineRunde}</option>
        {liste.map((r) => (
          <option key={r.id} value={r.id}>
            {r.bezeichnung}
          </option>
        ))}
      </Auswahl>
      {werte.rundeId ? (
        <Auswahl label={f.basis} value={werte.basis} onChange={(e) => setze("basis", e.target.value)}>
          <option value="pre_money">{t.mitarbeiter.basis.pre_money}</option>
          <option value="post_money">{t.mitarbeiter.basis.post_money}</option>
        </Auswahl>
      ) : null}
    </>
  );
}

function PoolDialog({ organisationId, onSchliessen }: { organisationId: string; onSchliessen: () => void }) {
  const t = useT();
  const f = t.mitarbeiter.form;
  const anlegen = usePoolAnlegen(organisationId);
  const { werte, feld, setWerte } = useFormular({ art: "esop", bezeichnung: "", regel: "wie_anteile", groesse: "", datum: heuteIso(), beschluss: "", rundeId: "", basis: "pre_money" });
  const fehler = (name: string) => feldText(t, anlegen.error, name);
  const setze = (name: keyof typeof werte, wert: string) => setWerte((alt) => ({ ...alt, [name]: wert, ...(name === "art" && wert === "esop" ? { regel: "wie_anteile" } : {}) }));
  function absenden() {
    const beschluss = textOderNichts(werte.beschluss);
    anlegen.mutate(
      {
        art: werte.art as "esop" | "vsop",
        bezeichnung: werte.bezeichnung.trim(),
        regel: werte.regel as "wie_anteile" | "anteilig",
        groesse: werte.groesse.trim(),
        datum: werte.datum,
        ...(beschluss ? { beschluss } : {}),
        ...(werte.rundeId ? { rundeId: werte.rundeId, basis: werte.basis as "pre_money" | "post_money" } : {}),
      },
      { onSuccess: onSchliessen },
    );
  }
  return (
    <Seitenpanel titel={f.titelNeu} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titelNeu}</h2>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          absenden();
        }}
      >
        <FehlerHinweis fehler={anlegen.error} bekannt={["art", "bezeichnung", "regel", "groesse", "datum", "beschluss", "rundeId", "basis"]} />
        <div className="cw-formularraster">
          <Auswahl label={f.art} value={werte.art} onChange={(e) => setze("art", e.target.value)}>
            <option value="esop">{t.mitarbeiter.art.esop}</option>
            <option value="vsop">{t.mitarbeiter.art.vsop}</option>
          </Auswahl>
          <Feld label={f.bezeichnung} autoComplete="off" {...feld("bezeichnung")} fehler={fehler("bezeichnung")} />
          {werte.art === "vsop" ? (
            <Auswahl label={f.regel} hilfe={f.regelHilfe} value={werte.regel} onChange={(e) => setze("regel", e.target.value)}>
              <option value="wie_anteile">{t.mitarbeiter.regel.wie_anteile}</option>
              <option value="anteilig">{t.mitarbeiter.regel.anteilig}</option>
            </Auswahl>
          ) : null}
          <Feld label={f.groesse} zahl inputMode="numeric" {...feld("groesse")} fehler={fehler("groesse")} />
          <Feld label={f.datum} type="date" {...feld("datum")} fehler={fehler("datum")} />
          <Feld label={f.beschluss} autoComplete="off" {...feld("beschluss")} fehler={fehler("beschluss")} />
          <RundenWahl organisationId={organisationId} werte={werte} setze={(name, wert) => setze(name, wert)} />
        </div>
        <div>
          <Button type="submit" disabled={anlegen.isPending}>
            {f.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

/** Neue Änderung der Größe oder, mit `aenderung`, eine bestehende bearbeiten (die API lässt das für Änderungen einer abgeschlossenen Runde nicht zu). */
function AenderungDialog({ organisationId, pool, aenderung, onSchliessen }: { organisationId: string; pool: Mitarbeiterpool; aenderung?: Aenderung; onSchliessen: () => void }) {
  const t = useT();
  const f = t.mitarbeiter.form;
  const anlegen = usePoolAenderung(organisationId);
  const bearbeiten = usePoolAenderungAendern(organisationId);
  const aendern = aenderung ? bearbeiten : anlegen;
  const titel = aenderung ? f.titelAenderungBearbeiten : f.titelAendern;
  const { werte, feld, setWerte } = useFormular({ anzahl: aenderung?.anzahl ?? "", datum: aenderung?.datum ?? heuteIso(), beschluss: aenderung?.beschluss ?? "", rundeId: aenderung?.rundeId ?? "", basis: aenderung?.basis ?? "pre_money" });
  const fehler = (name: string) => feldText(t, aendern.error, name);
  function absenden() {
    const beschluss = textOderNichts(werte.beschluss);
    const runde = werte.rundeId ? { rundeId: werte.rundeId, basis: werte.basis as "pre_money" | "post_money" } : null;
    if (aenderung) {
      bearbeiten.mutate({ poolId: pool.id, aenderungId: aenderung.id, anzahl: werte.anzahl.trim(), datum: werte.datum, beschluss: beschluss ?? null, rundeId: runde?.rundeId ?? null, basis: runde?.basis ?? null }, { onSuccess: onSchliessen });
      return;
    }
    anlegen.mutate({ poolId: pool.id, anzahl: werte.anzahl.trim(), datum: werte.datum, ...(beschluss ? { beschluss } : {}), ...(runde ?? {}) }, { onSuccess: onSchliessen });
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
        <FehlerHinweis fehler={aendern.error} bekannt={["anzahl", "datum", "beschluss", "rundeId", "basis"]} />
        <div className="cw-formularraster">
          <Feld label={f.anzahl} zahl inputMode="numeric" {...feld("anzahl")} fehler={fehler("anzahl")} />
          <Feld label={f.datum} type="date" {...feld("datum")} fehler={fehler("datum")} />
          <Feld label={f.beschluss} autoComplete="off" {...feld("beschluss")} fehler={fehler("beschluss")} />
          <RundenWahl organisationId={organisationId} werte={werte} setze={(name, wert) => setWerte((alt) => ({ ...alt, [name]: wert }))} />
        </div>
        <div>
          <Button type="submit" disabled={aendern.isPending}>
            {f.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
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

function ZuteilungDialog({ organisationId, pool, zuteilung, onSchliessen }: { organisationId: string; pool: Mitarbeiterpool; zuteilung?: Mitarbeiterzuteilung; onSchliessen: () => void }) {
  const t = useT();
  const f = t.mitarbeiter.form;
  const anlegen = useZuteilungAnlegen(organisationId);
  const aendern = useZuteilungAendern(organisationId);
  const mutation = zuteilung ? aendern : anlegen;
  const { werte, feld, setWerte } = useFormular({
    kategorie: (zuteilung?.kategorie ?? "mitarbeitende") as string,
    bezeichnung: zuteilung?.bezeichnung ?? "",
    anzahl: zuteilung?.anzahl ?? "",
    basispreis: zuteilung ? zuteilung.basispreis.replace(/\.?0+$/, "") : "0",
    zugeteiltAm: zuteilung?.zugeteiltAm ?? heuteIso(),
    vestingBeginn: zuteilung?.vestingBeginn ?? "",
    cliff: String(zuteilung?.cliffMonate ?? 12),
    dauer: String(zuteilung?.vestingMonate ?? 48),
    beschleunigung: zuteilung ? anteilZuProzent(zuteilung.beschleunigung) : "0",
    status: (zuteilung?.status ?? "zugeteilt") as string,
    statusAm: zuteilung?.statusAm ?? "",
    leaver: zuteilung?.leaverRegel ?? "",
  });
  const fehler = (name: string) => feldText(t, mutation.error, name);
  const titel = zuteilung ? f.titelZuteilungAendern : f.titelZuteilung;
  const mitDatum = werte.status === "verfallen" || werte.status === "ausgeuebt";
  function absenden() {
    const koerper = {
      kategorie: werte.kategorie as "gruender" | "fuehrung" | "mitarbeitende" | "beirat" | "sonstige",
      bezeichnung: textOderNichts(werte.bezeichnung) ?? null,
      anzahl: werte.anzahl.trim(),
      basispreis: betragOderNichts(werte.basispreis) ?? "0",
      zugeteiltAm: werte.zugeteiltAm,
      vestingBeginn: werte.vestingBeginn || null,
      cliffMonate: Number(werte.cliff),
      vestingMonate: Number(werte.dauer),
      beschleunigung: werte.beschleunigung.trim() === "" ? "0" : prozentZuAnteil(werte.beschleunigung),
      status: werte.status as "zugeteilt" | "gevestet" | "verfallen" | "ausgeuebt",
      statusAm: mitDatum ? werte.statusAm || null : null,
      leaverRegel: textOderNichts(werte.leaver) ?? null,
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
        <FehlerHinweis fehler={mutation.error} bekannt={["kategorie", "bezeichnung", "anzahl", "basispreis", "zugeteiltAm", "vestingBeginn", "cliffMonate", "vestingMonate", "beschleunigung", "status", "statusAm", "leaverRegel"]} />
        <div className="cw-formularraster">
          <Auswahl label={f.kategorie} value={werte.kategorie} onChange={(e) => setWerte((alt) => ({ ...alt, kategorie: e.target.value }))}>
            {Object.entries(t.mitarbeiter.kategorie).map(([wert, label]) => (
              <option key={wert} value={wert}>
                {label}
              </option>
            ))}
          </Auswahl>
          <Feld label={f.zuteilungBezeichnung} autoComplete="off" {...feld("bezeichnung")} fehler={fehler("bezeichnung")} />
          <Feld label={f.zuteilungAnzahl} zahl inputMode="numeric" {...feld("anzahl")} fehler={fehler("anzahl")} />
          <Feld label={f.basispreis} zahl inputMode="decimal" {...feld("basispreis")} fehler={fehler("basispreis")} />
          <Feld label={f.zugeteiltAm} type="date" {...feld("zugeteiltAm")} fehler={fehler("zugeteiltAm")} />
          <Feld label={f.vestingBeginn} type="date" {...feld("vestingBeginn")} fehler={fehler("vestingBeginn")} />
          <Feld label={f.cliff} zahl inputMode="numeric" {...feld("cliff")} fehler={fehler("cliffMonate")} />
          <Feld label={f.dauer} zahl inputMode="numeric" {...feld("dauer")} fehler={fehler("vestingMonate")} />
          <Feld label={f.beschleunigung} hilfe={f.beschleunigungHilfe} zahl inputMode="decimal" {...feld("beschleunigung")} fehler={fehler("beschleunigung")} />
          <Auswahl label={f.status} value={werte.status} onChange={(e) => setWerte((alt) => ({ ...alt, status: e.target.value }))}>
            {Object.entries(t.mitarbeiter.status).map(([wert, label]) => (
              <option key={wert} value={wert}>
                {label}
              </option>
            ))}
          </Auswahl>
          {mitDatum ? <Feld label={f.statusAm} type="date" {...feld("statusAm")} fehler={fehler("statusAm")} /> : null}
          <Feld label={f.leaver} autoComplete="off" {...feld("leaver")} fehler={fehler("leaverRegel")} />
        </div>
        <div>
          <Button type="submit" disabled={mutation.isPending}>
            {f.speichern}
          </Button>
        </div>
      </form>
      {zuteilung ? <AustritteAbschnitt organisationId={organisationId} pool={pool} zuteilung={zuteilung} /> : <p className="app-leer-text">{f.austritteSpaeter}</p>}
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
