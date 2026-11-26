import "./Dashboard.css";
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Auswahl, Button, Feld, Seitenpanel, Tabelle, formatBetrag, formatDatum, formatMultiple, formatProzent, type TabelleSpalte } from "@carraway/ui";
import { fondsListe } from "../api/abfragen-kern";
import { heuteIso } from "../api/datum";
import {
  alsRechenschritte,
  useZielfondsAnlegen,
  useZielfondsBewegung,
  useZielfondsMeldung,
  useZielfondsStorno,
  zielfondsDetail,
  zielfondsListe,
  type NeueZielfondsBewegung,
  type ZielfondsListe,
} from "../api/portfolio";
import { BetragFeld } from "../komponenten/BetragFeld";
import { Bereichskopf } from "../komponenten/Bereichskopf";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { Rechenweg } from "../komponenten/Rechenweg";
import { Skelettzeilen } from "../komponenten/Skelett";
import { useSprache, useT } from "../i18n";
import { useRechte } from "../lib/rechte";

const route = getRouteApi("/fonds/$fondsId/zielfonds");

type Zeile = ZielfondsListe["data"][number];
type BewegungArt = NeueZielfondsBewegung["type"];

/**
 * Zielfonds eines Dachfonds: Zusagen, Abrufe, Ausschüttungen und Wert je Zielfonds mit Rechenweg, dazu Erfassen von Bewegungen und NAV-Meldungen.
 * Erfassen darf ein Bearbeiter; die Rechnung (Durchrechnung oder fortgeschriebene Meldung) liegt auf dem Server.
 */
export function ZielfondsSeite() {
  const t = useT();
  const z = t.waehrung.zielfonds;
  const sprache = useSprache();
  const { fondsId } = route.useParams();
  const { data, error, isPending } = useQuery(zielfondsListe(fondsId));
  const { darf } = useRechte();
  const schreiben = darf("bearbeiter", fondsId, "portfolio");
  const [offen, setOffen] = useState<string | null>(null);
  const [neu, setNeu] = useState(false);

  const waehrung = data?.currency ?? "EUR";
  const betrag = (w: string | null) => (w === null ? t.gemeinsam.keinWert : formatBetrag(w, sprache, { waehrung }));
  const multiple = (w: string | null) => (w === null ? t.gemeinsam.keinWert : formatMultiple(w, sprache));
  const spalten: TabelleSpalte<Zeile>[] = [
    {
      schluessel: "name",
      kopf: z.name,
      zelle: (r) => (
        <Button variante="ruhig" groesse="s" onClick={() => setOffen(r.id)} title={r.targetFundName ? z.eigenerFonds(r.targetFundName) : undefined}>
          {r.name}
        </Button>
      ),
    },
    { schluessel: "zusage", kopf: z.zusage, zahl: true, zelle: (r) => betrag(r.metrics.commitment.value) },
    { schluessel: "abgerufen", kopf: z.abgerufen, zahl: true, zelle: (r) => betrag(r.metrics.called.value) },
    { schluessel: "offen", kopf: z.offen, zahl: true, zelle: (r) => betrag(r.metrics.unfunded.value) },
    { schluessel: "ausgeschuettet", kopf: z.ausgeschuettet, zahl: true, zelle: (r) => betrag(r.metrics.distributed.value) },
    { schluessel: "wert", kopf: z.wert, zahl: true, zelle: (r) => betrag(r.metrics.value.value) },
    { schluessel: "methode", kopf: z.methode, zelle: (r) => z.methoden[r.metrics.value.method] },
    { schluessel: "tvpi", kopf: z.tvpi, zahl: true, zelle: (r) => multiple(r.metrics.tvpi.value) },
    { schluessel: "irr", kopf: z.irr, zahl: true, zelle: (r) => (r.metrics.irr.value === null ? t.gemeinsam.keinWert : formatProzent(Number(r.metrics.irr.value) * 100, sprache)) },
  ];

  return (
    <div className="app-seite">
      <Bereichskopf titel={z.titel}>
        {schreiben ? (
          <Button groesse="s" onClick={() => setNeu(true)}>
            {z.neu}
          </Button>
        ) : null}
      </Bereichskopf>
      <p className="app-leer-text">{z.beschreibung}</p>
      <section className="app-karte" aria-label={z.titel}>
        {isPending ? (
          <Skelettzeilen anzahl={3} />
        ) : error ? (
          <FehlerHinweis fehler={error} />
        ) : data.data.length === 0 ? (
          <p className="app-leer-text">{z.leer}</p>
        ) : (
          <>
            <Tabelle beschriftung={z.titel} spalten={spalten} zeilen={data.data} zeilenSchluessel={(r) => r.id} />
            <p className="app-zahl">
              {z.summe}: {z.zusage} {betrag(data.totals.commitment)} · {z.abgerufen} {betrag(data.totals.called)} · {z.ausgeschuettet} {betrag(data.totals.distributed)} · {z.wert} {betrag(data.totals.value)}
            </p>
          </>
        )}
      </section>
      {neu ? <NeuerZielfonds fondsId={fondsId} onFertig={() => setNeu(false)} /> : null}
      {offen ? <ZielfondsDetail fondsId={fondsId} id={offen} waehrung={waehrung} schreiben={schreiben} onSchliessen={() => setOffen(null)} /> : null}
    </div>
  );
}

function NeuerZielfonds({ fondsId, onFertig }: { fondsId: string; onFertig: () => void }) {
  const t = useT();
  const z = t.waehrung.zielfonds;
  const { data: fonds } = useQuery(fondsListe());
  const [name, setName] = useState("");
  const [ziel, setZiel] = useState("");
  const anlegen = useZielfondsAnlegen(fondsId);
  const absenden = (e: FormEvent) => {
    e.preventDefault();
    anlegen.mutate({ name: name.trim(), ...(ziel ? { targetFundId: ziel } : {}) }, { onSuccess: onFertig });
  };
  return (
    <Seitenpanel titel={z.neu} onSchliessen={onFertig}>
      <form className="app-formular" onSubmit={absenden}>
        <Feld label={z.name} value={name} onChange={(e) => setName(e.currentTarget.value)} required maxLength={200} />
        <Auswahl label={z.zielfondsWahl} value={ziel} onChange={(e) => setZiel(e.currentTarget.value)}>
          <option value="">{z.keiner}</option>
          {(fonds ?? []).filter((f) => f.id !== fondsId).map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Auswahl>
        {anlegen.error ? <FehlerHinweis fehler={anlegen.error} /> : null}
        <Button type="submit" disabled={!name.trim() || anlegen.isPending}>
          {z.anlegen}
        </Button>
      </form>
    </Seitenpanel>
  );
}

function ZielfondsDetail({ fondsId, id, waehrung, schreiben, onSchliessen }: { fondsId: string; id: string; waehrung: string; schreiben: boolean; onSchliessen: () => void }) {
  const t = useT();
  const z = t.waehrung.zielfonds;
  const sprache = useSprache();
  const { data, error } = useQuery(zielfondsDetail(fondsId, id));
  const bewegung = useZielfondsBewegung(fondsId, id);
  const storno = useZielfondsStorno(fondsId, id);
  const meldung = useZielfondsMeldung(fondsId, id);
  const [art, setArt] = useState<BewegungArt>("capital_call");
  const [valuta, setValuta] = useState(heuteIso());
  const [betrag, setBetrag] = useState("");
  const [stichtag, setStichtag] = useState(heuteIso());
  const [nav, setNav] = useState("");
  const [anteil, setAnteil] = useState("");
  const geld = (w: string | null) => (w === null ? t.gemeinsam.keinWert : formatBetrag(w, sprache, { waehrung }));
  if (error) return <Seitenpanel titel={z.details} onSchliessen={onSchliessen}><FehlerHinweis fehler={error} /></Seitenpanel>;
  if (!data) return <Seitenpanel titel={z.details} onSchliessen={onSchliessen}><Skelettzeilen anzahl={3} /></Seitenpanel>;
  type B = (typeof data.movements)[number];
  type M = (typeof data.navReports)[number];
  const bewegungsSpalten: TabelleSpalte<B>[] = [
    { schluessel: "valuta", kopf: z.valuta, zelle: (b) => <span className="app-zahl">{formatDatum(b.valueDate, sprache)}</span> },
    { schluessel: "art", kopf: z.art, zelle: (b) => (b.reversesId ? `${z.stornoBuchung}: ${z.arten[b.type]}` : z.arten[b.type]) },
    { schluessel: "betrag", kopf: z.betrag, zahl: true, zelle: (b) => geld(b.amount) },
    {
      schluessel: "aktion",
      kopf: "",
      zelle: (b) =>
        b.reversed ? z.storniert : schreiben && !b.reversesId ? (
          <Button variante="ruhig" groesse="s" disabled={storno.isPending} onClick={() => storno.mutate(b.id)}>
            {z.storno}
          </Button>
        ) : null,
    },
  ];
  const meldungsSpalten: TabelleSpalte<M>[] = [
    { schluessel: "stichtag", kopf: z.meldestichtag, zelle: (m) => <span className="app-zahl">{formatDatum(m.asOf, sprache)}</span> },
    { schluessel: "nav", kopf: z.meldungNav, zahl: true, zelle: (m) => geld(m.nav) },
    { schluessel: "anteil", kopf: z.meldungAnteil, zahl: true, zelle: (m) => (m.share === null ? t.gemeinsam.keinWert : formatProzent(Number(m.share) * 100, sprache, 4)) },
  ];
  return (
    <Seitenpanel titel={data.name} onSchliessen={onSchliessen}>
      {data.metrics ? <Rechenweg titel={z.rechenweg(data.name)} stichtag={data.asOf} schritte={alsRechenschritte(data.metrics.value)} /> : null}
      <h3 className="cw-t-untertitel">{z.bewegungen}</h3>
      <Tabelle beschriftung={z.bewegungen} spalten={bewegungsSpalten} zeilen={data.movements} zeilenSchluessel={(b) => b.id} />
      {schreiben ? (
        <form
          className="app-zielfonds__formular"
          onSubmit={(e) => {
            e.preventDefault();
            bewegung.mutate({ type: art, valueDate: valuta, amount: betrag.replace(",", ".") }, { onSuccess: () => setBetrag("") });
          }}
        >
          <Auswahl label={z.art} value={art} onChange={(e) => setArt(e.currentTarget.value as BewegungArt)}>
            {(["commitment", "capital_call", "distribution"] as const).map((a) => (
              <option key={a} value={a}>
                {z.arten[a]}
              </option>
            ))}
          </Auswahl>
          <Feld label={z.valuta} type="date" value={valuta} onChange={(e) => setValuta(e.currentTarget.value)} required />
          <BetragFeld label={z.betrag} value={betrag} onChange={(e) => setBetrag(e.currentTarget.value)} required />
          <Button type="submit" disabled={!betrag || bewegung.isPending}>
            {z.buchen}
          </Button>
        </form>
      ) : null}
      {bewegung.error ? <FehlerHinweis fehler={bewegung.error} /> : null}
      {storno.error ? <FehlerHinweis fehler={storno.error} /> : null}
      <h3 className="cw-t-untertitel">{z.meldungen}</h3>
      <Tabelle beschriftung={z.meldungen} spalten={meldungsSpalten} zeilen={data.navReports} zeilenSchluessel={(m) => m.id} />
      {schreiben ? (
        <form
          className="app-zielfonds__formular"
          onSubmit={(e) => {
            e.preventDefault();
            meldung.mutate({ asOf: stichtag, ...(nav ? { nav: nav.replace(",", ".") } : {}), ...(anteil ? { share: anteil.replace(",", ".") } : {}) }, { onSuccess: () => { setNav(""); setAnteil(""); } });
          }}
        >
          <Feld label={z.meldestichtag} type="date" value={stichtag} onChange={(e) => setStichtag(e.currentTarget.value)} required />
          <BetragFeld label={z.meldungNav} value={nav} onChange={(e) => setNav(e.currentTarget.value)} />
          {data.targetFundId ? <Feld label={z.meldungAnteil} inputMode="decimal" value={anteil} onChange={(e) => setAnteil(e.currentTarget.value)} /> : null}
          <Button type="submit" disabled={(!nav && !anteil) || meldung.isPending}>
            {z.melden}
          </Button>
        </form>
      ) : null}
      {meldung.error ? <FehlerHinweis fehler={meldung.error} /> : null}
    </Seitenpanel>
  );
}
