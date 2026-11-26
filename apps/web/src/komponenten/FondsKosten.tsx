import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Feld, Kennzahl, KennzahlenReihe, Menue, DotsThreeIcon, Segment, Seitenpanel, Status, Tabelle, formatDatum, type MenueEintrag, type TabelleSpalte } from "@carraway/ui";
import { heuteIso } from "../api/datum";
import { fondsKapitalkonten, fondsKosten, ladeKostenVorschau, useKostenBuchen, useKostenStorno, type Kapitalkonten, type KostenEingabe, type Kostenbuchung, type KostenVorschau } from "../api/fondskosten";
import { useSprache, useT } from "../i18n";
import { feldText } from "../i18n/fehler";
import { kostenTexte } from "../i18n/fondskosten";
import { DATENSPRACHE } from "../lib/datensprache";
import { useRechte } from "../lib/rechte";
import { formatBetragCent, formatSatz } from "../lib/zahl";
import { FehlerHinweis } from "./FehlerHinweis";
import { Rechenweg } from "./Rechenweg";
import { Skelettzeilen } from "./Skelett";
import { BetragFeld } from "./BetragFeld";
import { betragOderNichts, textOderNichts } from "./formular";

type Konto = Kapitalkonten["konten"][number];
type Dialog = { typ: "anlegen" } | { typ: "aufteilung" | "storno"; buchung: Kostenbuchung } | { typ: "konto"; konto: Konto };

const cent = (w: string) => Math.round(Number(w) * 100);

/** Prozent („2,5“) als Bruch mit sechs Nachkommastellen („0.025000“); leer oder ungültig = `null`. */
function satzAusProzent(text: string): string | null {
  const zahl = Number(text.trim().replace(",", "."));
  if (!text.trim() || !Number.isFinite(zahl) || zahl <= 0 || zahl >= 100) return null;
  return (zahl / 100).toFixed(6);
}

/**
 * Verwaltungsvergütung und Fondskosten des Fonds (Issue #157) und die Kapitalkonten der Investoren mit Rechenweg. Buchen und Stornieren
 * ab Rolle Bearbeiter im Bereich Finanzen; die API prüft Periodensperre und Aufteilung.
 */
export function FondsKosten({ fondsId, waehrung, stand, stichtag }: { fondsId: string; waehrung: string; stand?: string; stichtag?: string }) {
  const sprache = useSprache();
  const k = kostenTexte[sprache];
  const { darf } = useRechte();
  const tag = stichtag ?? heuteIso();
  const liste = useQuery(fondsKosten(fondsId, tag, stand));
  // Ohne gewählten Stichtag rechnet die API zum üblichen Stichtag des Fonds (dort gibt es eine Saldenliste und damit einen NAV).
  const konten = useQuery(fondsKapitalkonten(fondsId, stichtag, stand));
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const schliessen = () => setDialog(null);
  const kannBuchen = !stand && darf("bearbeiter", fondsId, "finanzen");
  const geld = (w: string) => formatBetragCent(w, sprache, waehrung);

  const spalten: TabelleSpalte<Kostenbuchung>[] = [
    { schluessel: "valuta", kopf: k.spalten.valuta, zelle: (z) => <span className="app-zahl">{formatDatum(z.valuta, sprache)}</span> },
    { schluessel: "art", kopf: k.spalten.art, zelle: (z) => k.art[z.art] ?? z.art },
    { schluessel: "betrag", kopf: k.spalten.betrag, zahl: true, zelle: (z) => geld(z.betrag) },
    { schluessel: "verteilung", kopf: k.spalten.verteilung, zelle: (z) => k.verteilung[z.verteilung] ?? z.verteilung },
    {
      schluessel: "status",
      kopf: k.spalten.status,
      zelle: (z) => (
        <>
          {z.storniertKostenId ? <Status variante="entwurf">{k.storno}</Status> : null}
          {z.storniertDurchId ? <Status variante="entwurf">{k.storniert}</Status> : null}
        </>
      ),
    },
    {
      schluessel: "aktion",
      kopf: k.spalten.aktion,
      zelle: (z) => {
        const art = k.art[z.art] ?? z.art;
        const valuta = formatDatum(z.valuta, sprache);
        const aktionen: MenueEintrag[] = kannBuchen && !z.storniertKostenId && !z.storniertDurchId
          ? [{ id: "storno", label: k.stornieren, gefahr: true, onClick: () => setDialog({ typ: "storno", buchung: z }) }]
          : [];
        return (
          <div className="app-aktionen__knoepfe">
            <Button variante="ruhig" aria-label={k.aufteilungFuer(art, valuta)} onClick={() => setDialog({ typ: "aufteilung", buchung: z })}>{k.aufteilung}</Button>
            {aktionen.length > 0 ? <Menue portal ausloeser={<DotsThreeIcon />} aria-label={k.stornoFuer(art, valuta)} eintraege={aktionen} /> : null}
          </div>
        );
      },
    },
  ];

  const kontoSpalten: TabelleSpalte<Konto>[] = [
    { schluessel: "investor", kopf: k.investor, zelle: (z) => <span lang={DATENSPRACHE}>{z.investor}</span> },
    { schluessel: "eingezahlt", kopf: k.konten.eingezahlt, zahl: true, zelle: (z) => geld(z.eingezahlt) },
    { schluessel: "ausgeschuettet", kopf: k.konten.ausgeschuettet, zahl: true, zelle: (z) => geld(z.ausgeschuettet) },
    { schluessel: "verwaltungsverguetung", kopf: k.konten.verwaltungsverguetung, zahl: true, zelle: (z) => geld(z.verwaltungsverguetung) },
    { schluessel: "fondskosten", kopf: k.konten.fondskosten, zahl: true, zelle: (z) => geld(z.fondskosten) },
    { schluessel: "navAnteil", kopf: k.konten.navAnteil, zahl: true, zelle: (z) => (z.navAnteil === null ? k.konten.navFehlt : geld(z.navAnteil)) },
    { schluessel: "nettoIrr", kopf: k.konten.nettoIrr, zahl: true, zelle: (z) => (z.nettoIrr === null ? "–" : formatSatz(z.nettoIrr, sprache)) },
    {
      schluessel: "rechenweg",
      kopf: k.konten.rechenweg,
      zelle: (z) => <Button variante="ruhig" aria-label={k.konten.rechenwegFuer(z.investor)} onClick={() => setDialog({ typ: "konto", konto: z })}>{k.konten.rechenweg}</Button>,
    },
  ];

  return (
    <>
      <section className="app-karte" aria-labelledby="kosten-titel">
        <div className="app-karte__kopf">
          <h2 id="kosten-titel" className="cw-t-untertitel app-karte__titel">{k.titel}</h2>
          {kannBuchen ? <Button variante="sekundaer" onClick={() => setDialog({ typ: "anlegen" })}>{k.anlegen}</Button> : null}
        </div>
        <p className="app-leer-text">{k.beschreibung}</p>
        {liste.isPending ? <Skelettzeilen anzahl={2} /> : null}
        <FehlerHinweis fehler={liste.error} />
        {liste.data ? (
          <>
            <KennzahlenReihe aria-label={k.summen}>
              <Kennzahl titel={k.art.verwaltungsverguetung!} wert={geld(liste.data.summen.verwaltungsverguetung)} />
              <Kennzahl titel={k.art.fondskosten!} wert={geld(liste.data.summen.fondskosten)} />
            </KennzahlenReihe>
            {liste.data.buchungen.length === 0 ? <p className="app-leer-text">{k.keine}</p> : <Tabelle dicht beschriftung={k.tabelle} spalten={spalten} zeilen={liste.data.buchungen} zeilenSchluessel={(z) => z.id} />}
          </>
        ) : null}
      </section>
      <section className="app-karte" aria-labelledby="kapitalkonten-titel">
        <div className="app-karte__kopf">
          <h2 id="kapitalkonten-titel" className="cw-t-untertitel app-karte__titel">{k.konten.titel}</h2>
        </div>
        <p className="app-leer-text">{k.konten.beschreibung}</p>
        {konten.data ? <p className="app-leer-text">{k.konten.stichtag(formatDatum(konten.data.stichtag, sprache))}</p> : null}
        {konten.isPending ? <Skelettzeilen anzahl={2} /> : null}
        <FehlerHinweis fehler={konten.error} />
        {konten.data && konten.data.konten.length > 0 ? <Tabelle dicht beschriftung={k.konten.tabelle} spalten={kontoSpalten} zeilen={konten.data.konten} zeilenSchluessel={(z) => z.organisationId} /> : null}
      </section>
      {dialog?.typ === "anlegen" && kannBuchen ? <KostenAnlegen fondsId={fondsId} waehrung={waehrung} onSchliessen={schliessen} /> : null}
      {dialog?.typ === "aufteilung" ? (
        <Seitenpanel titel={k.aufteilung} onSchliessen={schliessen}>
          <h2 className="cw-t-untertitel">{k.aufteilung}</h2>
          <p>{k.art[dialog.buchung.art]} · {formatDatum(dialog.buchung.valuta, sprache)} · {geld(dialog.buchung.betrag)}</p>
          {dialog.buchung.bemerkung ? <p lang={DATENSPRACHE}>{dialog.buchung.bemerkung}</p> : null}
          <AnteilTabelle zeilen={dialog.buchung.anteile} waehrung={waehrung} />
        </Seitenpanel>
      ) : null}
      {dialog?.typ === "storno" && kannBuchen ? <KostenStorno fondsId={fondsId} buchung={dialog.buchung} waehrung={waehrung} onSchliessen={schliessen} /> : null}
      {dialog?.typ === "konto" && konten.data ? (
        <Seitenpanel titel={k.konten.kontoVon(dialog.konto.investor)} onSchliessen={schliessen}>
          <h2 className="cw-t-untertitel">{k.konten.kontoVon(dialog.konto.investor)}</h2>
          <Rechenweg titel={k.konten.rechenweg} stichtag={konten.data.stichtag} schritte={dialog.konto.schritte} />
        </Seitenpanel>
      ) : null}
    </>
  );
}

function AnteilTabelle({ zeilen, waehrung }: { zeilen: { organisationId: string; investor: string; betrag: string }[]; waehrung: string }) {
  const sprache = useSprache();
  const k = kostenTexte[sprache];
  return (
    <Tabelle
      dicht
      beschriftung={k.aufteilung}
      zeilen={zeilen}
      zeilenSchluessel={(z) => z.organisationId}
      spalten={[
        { schluessel: "investor", kopf: k.investor, zelle: (z) => <span lang={DATENSPRACHE}>{z.investor}</span> },
        { schluessel: "betrag", kopf: k.betragInvestor, zahl: true, zelle: (z) => formatBetragCent(z.betrag, sprache, waehrung) },
      ]}
    />
  );
}

function KostenAnlegen({ fondsId, waehrung, onSchliessen }: { fondsId: string; waehrung: string; onSchliessen: () => void }) {
  const t = useT();
  const sprache = useSprache();
  const k = kostenTexte[sprache];
  const f = k.formular;
  const [art, setArt] = useState<"verwaltungsverguetung" | "fondskosten">("verwaltungsverguetung");
  const [valuta, setValuta] = useState(heuteIso());
  const [modus, setModus] = useState<"betrag" | "satz">("betrag");
  const [betrag, setBetrag] = useState("");
  const [satz, setSatz] = useState("");
  const [von, setVon] = useState("");
  const [bis, setBis] = useState("");
  const [verteilung, setVerteilung] = useState<"grundlage" | "manuell">("grundlage");
  const [manuell, setManuell] = useState<Record<string, string>>({});
  const [bemerkung, setBemerkung] = useState("");
  const buchen = useKostenBuchen(fondsId);
  const vorschau = useMutation({ mutationFn: (json: KostenEingabe) => ladeKostenVorschau(fondsId, json) });

  const grund: KostenEingabe = {
    art,
    valuta,
    verteilung: "grundlage",
    ...(modus === "betrag" ? { betrag: betragOderNichts(betrag, sprache) ?? "" } : { berechnung: { satz: satzAusProzent(satz) ?? "", von, bis } }),
  };
  const schluesselVon = (e: KostenEingabe) => JSON.stringify({ ...e, bemerkung: undefined, anteile: undefined, verteilung: undefined });
  const geprueft: KostenVorschau | null = vorschau.data && vorschau.variables && schluesselVon(vorschau.variables) === schluesselVon(grund) ? vorschau.data : null;
  // Unveränderte Zeilen behalten den Betrag der Vorschau (API-Format); nur eingegebene Werte laufen durch die Eingabeprüfung der Sprache.
  const anteile = geprueft?.aufteilung.map((a) => {
    const eingabe = manuell[a.organisationId];
    return { organisationId: a.organisationId, betrag: eingabe === undefined ? a.betrag : betragOderNichts(eingabe, sprache) ?? "" };
  }) ?? [];
  const summe = anteile.reduce((s, a) => s + cent(a.betrag || "0"), 0);
  const passt = !geprueft || verteilung === "grundlage" || summe === cent(geprueft.betrag);
  const fehler = buchen.error ?? vorschau.error;

  return (
    <Seitenpanel breit titel={k.anlegen} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{k.anlegen}</h2>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (vorschau.isPending || buchen.isPending) return;
          if (!geprueft) {
            buchen.reset();
            vorschau.mutate(grund);
            return;
          }
          if (!passt) return;
          const eingabe: KostenEingabe = { ...grund, verteilung, ...(verteilung === "manuell" ? { anteile } : {}), bemerkung: textOderNichts(bemerkung) };
          if (modus === "betrag") eingabe.betrag = geprueft.betrag;
          buchen.mutate(eingabe, { onSuccess: onSchliessen });
        }}
      >
        <FehlerHinweis fehler={fehler} bekannt={["valuta", "betrag", "bemerkung"]} />
        <Auswahl label={f.art} value={art} onChange={(e) => setArt(e.target.value as typeof art)}>
          <option value="verwaltungsverguetung">{k.art.verwaltungsverguetung}</option>
          <option value="fondskosten">{k.art.fondskosten}</option>
        </Auswahl>
        <Feld label={f.valuta} type="date" required value={valuta} onChange={(e) => setValuta(e.target.value)} fehler={feldText(t, fehler, "valuta")} />
        <div className="app-gruppe">
          <span className="cw-feld__label" id="kosten-eingabe">{f.eingabe}</span>
          <Segment<"betrag" | "satz"> aria-labelledby="kosten-eingabe" value={modus} onChange={setModus} options={[{ wert: "betrag", label: f.eingabeBetrag }, { wert: "satz", label: f.eingabeSatz }]} />
        </div>
        {modus === "betrag" ? (
          <BetragFeld label={f.betrag(waehrung)} required value={betrag} onChange={(e) => setBetrag(e.target.value)} fehler={feldText(t, fehler, "betrag")} />
        ) : (
          <>
            <BetragFeld label={f.satz} hilfe={f.satzHilfe} required value={satz} onChange={(e) => setSatz(e.target.value)} />
            <div className="cw-formularraster">
              <Feld label={f.von} type="date" required value={von} onChange={(e) => setVon(e.target.value)} />
              <Feld label={f.bis} type="date" required min={von} value={bis} onChange={(e) => setBis(e.target.value)} />
            </div>
          </>
        )}
        <div className="app-gruppe">
          <span className="cw-feld__label" id="kosten-verteilung">{f.verteilung}</span>
          <Segment<"grundlage" | "manuell"> aria-labelledby="kosten-verteilung" value={verteilung} onChange={setVerteilung} options={[{ wert: "grundlage", label: k.verteilung.grundlage! }, { wert: "manuell", label: k.verteilung.manuell! }]} />
        </div>
        <Feld label={f.bemerkung} maxLength={1000} value={bemerkung} onChange={(e) => setBemerkung(e.target.value)} fehler={feldText(t, fehler, "bemerkung")} />
        {geprueft?.berechnung ? <Rechenweg titel={f.berechnung} schritte={geprueft.berechnung} /> : null}
        {geprueft && verteilung === "grundlage" ? <AnteilTabelle zeilen={geprueft.aufteilung} waehrung={waehrung} /> : null}
        {geprueft && verteilung === "manuell" ? (
          <div className="app-gruppe">
            <p className="app-leer-text">{f.manuellHilfe}</p>
            {geprueft.aufteilung.map((a) => (
              <BetragFeld key={a.organisationId} label={a.investor} value={manuell[a.organisationId] ?? a.betrag.replace(".", sprache === "de" ? "," : ".")} onChange={(e) => setManuell((m) => ({ ...m, [a.organisationId]: e.target.value }))} />
            ))}
            {!passt ? <p role="alert">{f.summeAbweichung(formatBetragCent(summe / 100, sprache, waehrung), formatBetragCent(geprueft.betrag, sprache, waehrung))}</p> : null}
          </div>
        ) : null}
        {vorschau.isPending ? <p role="status">{t.gemeinsam.laedt}</p> : null}
        <div>
          <Button type="submit" disabled={vorschau.isPending || buchen.isPending || !passt}>{geprueft ? f.buchen : f.vorschau}</Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

function KostenStorno({ fondsId, buchung, waehrung, onSchliessen }: { fondsId: string; buchung: Kostenbuchung; waehrung: string; onSchliessen: () => void }) {
  const sprache = useSprache();
  const k = kostenTexte[sprache];
  const storno = useKostenStorno(fondsId);
  const [grund, setGrund] = useState("");
  return (
    <Seitenpanel titel={k.stornieren} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{k.stornieren}</h2>
      <p>{k.art[buchung.art]} · {formatDatum(buchung.valuta, sprache)} · {formatBetragCent(buchung.betrag, sprache, waehrung)}</p>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!grund.trim() || storno.isPending) return;
          storno.mutate({ kostenId: buchung.id, grund: grund.trim() }, { onSuccess: onSchliessen });
        }}
      >
        <FehlerHinweis fehler={storno.error} />
        <Feld label={k.grund} required maxLength={500} value={grund} onChange={(e) => setGrund(e.target.value)} />
        <div>
          <Button type="submit" variante="gefahr" disabled={storno.isPending || !grund.trim()}>{k.stornoBuchen}</Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
