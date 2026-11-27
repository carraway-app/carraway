import { useState } from "react";
import { alle } from "../erweiterung";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Button, DotsThreeIcon, Feld, Kennzahl, KennzahlenReihe, Hinweis, Menue, Segment, Seitenpanel, Status, Tabelle, formatDatum, type MenueEintrag, type TabelleSpalte } from "@carraway/ui";
import { heuteIso } from "../api/datum";
import { fondsKapitalstand, type Kapitalart } from "../api/kapitalbewegungen";
import { fondsBewegungen, type BewegungZeile } from "../api/abfragen";
import { useMitteilungenFreigeben } from "../api/mutationen";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { kapitalTexte } from "../i18n/kapitalbewegung";
import { formatBetragCent } from "../lib/zahl";
import { useRechte } from "../lib/rechte";
import { BelegPanel } from "./BelegKnopf";
import { BuchungsStornoDialog } from "./BuchungsStornoDialog";
import { FehlerHinweis } from "./FehlerHinweis";
import { KapitalHerkunft } from "./KapitalHerkunft";
import { KapitalbewegungAnlegen, KapitalbewegungDetails } from "./KapitalbewegungDialoge";
import { Skelettzeilen } from "./Skelett";

const route = getRouteApi("/funds");
type Dialog = { typ: "anlegen"; art: Kapitalart } | { typ: "freigabe" | "storno" | "beleg"; bewegung: BewegungZeile };

/**
 * Kapitalabrufe und Ausschüttungen mit Aufteilung je Investor und Stand der Mitteilungen. „Mitteilungen freigeben“ (ab Rolle Freigeber)
 * erzeugt je Investor eine PDF-Mitteilung in einer gewählten Sprache; das geht einmal je Bewegung und verlangt eine andere Person als die,
 * die die Bewegung erfasst hat (Vier-Augen). Die API prüft beides; die Oberfläche nennt es vorab und zeigt ihre Meldung.
 * Die Liste enthält auch Stornos und stornierte Bewegungen. Bereits freigegebene Mitteilungen bleiben sichtbar.
 */
export function Kapitalbewegungen({ fondsId, waehrung, stand, stichtag }: { fondsId: string; waehrung: string; stand?: string; stichtag?: string }) {
  const t = useT();
  const sprache = useSprache();
  const b = t.bewegungen;
  const k = kapitalTexte[sprache];
  const detailId = route.useSearch({ select: (suche) => suche.bewegungId });
  const navigate = route.useNavigate();
  const detailsWaehlen = (id?: string) => void navigate({ search: (suche) => ({ ...suche, bewegungId: id }), replace: id === undefined });
  const { darf } = useRechte();
  const { data: zeilen, error, isPending } = useQuery(fondsBewegungen(fondsId));
  const [tag, setTag] = useState(stichtag ?? heuteIso());
  const kapital = useQuery(fondsKapitalstand(fondsId, tag, stand));
  const [herkunft, setHerkunft] = useState<"abgerufen" | "eingezahlt" | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const schliessen = () => setDialog(null);
  const kannAufteilungSehen = darf("betrachter", fondsId, "finanzen");
  const kannBuchen = !stand && darf("bearbeiter", fondsId, "finanzen");
  const istFreigeber = darf("freigeber", fondsId, "finanzen");
  const kannFreigeben = !stand && istFreigeber;
  const istOffen = (zeile: BewegungZeile) => zeile.anzahlMitteilungen === 0 && !zeile.istStorno && !zeile.storniert;

  const spalten: TabelleSpalte<BewegungZeile>[] = [
    { schluessel: "valuta", kopf: b.spalten.valuta, zelle: (z) => <span className="app-zahl">{formatDatum(z.valuta, sprache)}</span> },
    { schluessel: "art", kopf: b.spalten.art, zelle: (z) => aufzaehlung(b.art, z.art) },
    { schluessel: "betrag", kopf: b.spalten.betrag, zelle: (z) => <span className="app-zahl">{formatBetragCent(z.betrag, sprache, waehrung)}</span> },
    {
      schluessel: "status",
      kopf: b.spalten.status,
      zelle: (z) => (
        <>
          {z.anzahlMitteilungen > 0 ? <Status variante="freigegeben">{b.freigegeben(z.anzahlMitteilungen)}</Status> : null}
          {z.istStorno ? <Status variante="entwurf">{b.storno}</Status> : null}
          {z.storniert ? <Status variante="entwurf">{z.anzahlMitteilungen > 0 ? b.storniert : b.storniertOhneMitteilungen}</Status> : null}
          {istOffen(z) ? <Status variante="entwurf">{b.offen}</Status> : null}
        </>
      ),
    },
    {
      schluessel: "aktion",
      kopf: b.spalten.aktion,
      zelle: (z) => {
        const art = aufzaehlung(b.art, z.art);
        const valuta = formatDatum(z.valuta, sprache);
        const aktionen: MenueEintrag[] = [];
        if (kannBuchen) {
          aktionen.push({ id: "beleg", label: t.buchhaltung.erzeugen.knopf, onClick: () => setDialog({ typ: "beleg", bewegung: z }) });
          if (!z.istStorno && !z.storniert) {
            aktionen.push({ id: "storno", label: t.stornoForm.knopf, gefahr: true, onClick: () => setDialog({ typ: "storno", bewegung: z }) });
          }
        }
        return (
          <div className="app-aktionen__knoepfe">
            {kannAufteilungSehen ? <Button variante="ruhig" aria-label={k.aufteilungFuer(art, valuta)} onClick={() => detailsWaehlen(z.id)}>{k.aufteilung}</Button> : null}
            {istOffen(z) && kannFreigeben ? (
              <Button variante="sekundaer" aria-label={b.freigebenFuer(art, valuta)} onClick={() => setDialog({ typ: "freigabe", bewegung: z })}>
                {b.freigeben}
              </Button>
            ) : null}
            {aktionen.length > 0 ? (
              <Menue portal ausloeser={<DotsThreeIcon />} aria-label={k.aktionenFuer(art, valuta)} eintraege={aktionen} />
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <section className="app-karte" aria-labelledby="bewegungen-titel">
      <div className="app-karte__kopf">
        <h2 id="bewegungen-titel" className="cw-t-untertitel app-karte__titel">{b.titel}</h2>
        {kannBuchen ? (
          <div className="app-aktionen__knoepfe">
            <Button onClick={() => setDialog({ typ: "anlegen", art: "abruf" })}>{k.anlegen.abruf}</Button>
            <Button variante="sekundaer" onClick={() => setDialog({ typ: "anlegen", art: "ausschuettung" })}>{k.anlegen.ausschuettung}</Button>
          </div>
        ) : null}
      </div>
      <div className="cw-formularraster"><Feld type="date" label={k.stichtag} value={tag} onChange={(e) => { if (e.target.value) setTag(e.target.value); }} /></div>
      <FehlerHinweis fehler={kapital.error} />
      {kapital.data && <>
        <KennzahlenReihe aria-label={k.kapitalstandFonds}>
          {(["abgerufen", "eingezahlt", "offen", "ueberfaellig", "ungeklaert"] as const).filter((feld) => feld !== "ungeklaert" || Number(kapital.data.fonds.ungeklaert) > 0).map((feld) =>
            <Kennzahl key={feld} titel={k[feld]} onHerkunft={feld === "abgerufen" || feld === "eingezahlt" ? () => setHerkunft(feld) : undefined} wert={formatBetragCent(kapital.data.fonds[feld], sprache, waehrung)} />)}
        </KennzahlenReihe>
        {herkunft && <KapitalHerkunft kennzahl={herkunft} fondsId={fondsId} waehrung={waehrung} stichtag={tag}
          stand={stand ?? kapital.data.quellenstand} wert={kapital.data.fonds[herkunft]} onSchliessen={() => setHerkunft(null)} />}
        {kapital.data.konten.length > 0 && <Tabelle dicht beschriftung={k.kapitalstand} zeilen={kapital.data.konten} zeilenSchluessel={(z) => z.organisationId} spalten={[
          { schluessel: "investor", kopf: k.investor, zelle: (z) => z.investor },
          ...(["abgerufen", "eingezahlt", "offen", "ueberfaellig"] as const).map((feld) => ({
            schluessel: feld, kopf: k[feld], zahl: true, zelle: (z: typeof kapital.data.konten[number]) => formatBetragCent(z[feld], sprache, waehrung),
          })),
        ]} />}
      </>}
      <p className="app-leer-text">{b.beschreibung}</p>
      {zeilen?.some(istOffen) && !stand && !istFreigeber ? <Hinweis>{b.nurFreigeber}</Hinweis> : null}
      {isPending ? <Skelettzeilen anzahl={2} /> : null}
      {error ? <FehlerHinweis fehler={error} /> : null}
      {zeilen && zeilen.length === 0 ? <p className="app-leer-text">{b.keine}</p> : null}
      {zeilen && zeilen.length > 0 ? <Tabelle beschriftung={b.tabelle} spalten={spalten} zeilen={zeilen} zeilenSchluessel={(z) => z.id} /> : null}
      {kannAufteilungSehen && detailId && zeilen?.some((z) => z.id === detailId) ? <KapitalbewegungDetails key={detailId} fondsId={fondsId} id={detailId} stand={stand} stichtag={tag} onSchliessen={() => detailsWaehlen()} /> : null}
      {dialog?.typ === "anlegen" && kannBuchen ? <KapitalbewegungAnlegen fondsId={fondsId} art={dialog.art} waehrung={waehrung} onSchliessen={schliessen} /> : null}
      {dialog?.typ === "freigabe" && kannFreigeben ? <FreigabeDialog fondsId={fondsId} waehrung={waehrung} bewegung={dialog.bewegung} onSchliessen={schliessen} /> : null}
      {dialog?.typ === "storno" && kannBuchen ? (
        <BuchungsStornoDialog
          zeile={{ ...dialog.bewegung, quelle: "fondsbewegung", typ: dialog.bewegung.art }}
          waehrung={waehrung}
          onSchliessen={schliessen}
          onErfolg={schliessen}
        />
      ) : null}
      {dialog?.typ === "beleg" && kannBuchen ? (
        <BelegPanel
          art={dialog.bewegung.art === "abruf" ? "kapitalabruf" : "ausschuettung"}
          bezugArt="fonds_bewegung"
          bezugId={dialog.bewegung.id}
          fondsId={fondsId}
          onSchliessen={schliessen}
        />
      ) : null}
    </section>
  );
}

function FreigabeDialog({ fondsId, waehrung, bewegung, onSchliessen }: { fondsId: string; waehrung: string; bewegung: BewegungZeile; onSchliessen: () => void }) {
  const t = useT();
  const uiSprache = useSprache();
  const d = t.bewegungen.dialog;
  const freigeben = useMitteilungenFreigeben(fondsId);
  const [sprache, setSprache] = useState<"de" | "en">(uiSprache);
  const [perMail, setPerMail] = useState(false);
  const art = aufzaehlung(t.bewegungen.art, bewegung.art);
  return (
    <Seitenpanel titel={d.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{d.titel}</h2>
      <p className="app-leer-text">{d.einleitung(art, formatDatum(bewegung.valuta, uiSprache), formatBetragCent(bewegung.betrag, uiSprache, waehrung))}</p>
      <Hinweis>{d.vierAugen}</Hinweis>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          freigeben.mutate({ bewegungId: bewegung.id, sprache, perMail }, { onSuccess: onSchliessen });
        }}
      >
        <FehlerHinweis fehler={freigeben.error} />
        <div className="app-gruppe">
          <span className="cw-feld__label" id="mitteilung-sprache">
            {d.sprache}
          </span>
          <Segment<"de" | "en">
            aria-labelledby="mitteilung-sprache"
            value={sprache}
            onChange={setSprache}
            options={[
              { wert: "de", label: aufzaehlung(t.bericht.sprachen, "de") },
              { wert: "en", label: aufzaehlung(t.bericht.sprachen, "en") },
            ]}
          />
          <p className="app-leer-text">{d.spracheHilfe}</p>
        </div>
        {alle("mitteilungMail").map((MitteilungMail, i) => <MitteilungMail key={i} wert={perMail} onChange={setPerMail} />)}
        <div>
          <Button type="submit" disabled={freigeben.isPending}>
            {d.freigeben}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
